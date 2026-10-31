import { JXL_MAX_PIXELS, OUTPUT_FORMATS, RAW_MAX_PIXELS, type InputKind, type OutputFormat } from './formats';

export type ConversionError = {
  code: 'unrecognized' | 'too-large' | 'failed' | 'worker-lost';
  pixels?: number;
  limit?: number;
};
export type ConvertRequest = {
  type: 'convert'; id: string; attempt: number; file: File; kind: InputKind;
  format: OutputFormat; maxArea: number | null; downscale: boolean; smaller: boolean;
};
export type WorkerResponse =
  | { type: 'phase'; id: string; attempt: number; phase: 'loading-codec' | 'converting' }
  | { type: 'done'; id: string; attempt: number; blob: Blob; thumbnail: Blob;
      width: number; height: number; downscaled: boolean }
  | ({ type: 'error'; id: string; attempt: number } & ConversionError);

type Fit = { width: number; height: number };
type Phase = (phase: 'loading-codec' | 'converting') => void;

const AVIF_ENCODE_OPTIONS = { quality: 50, speed: 6 };
const JXL_ENCODE_OPTIONS = { quality: 75, effort: 5 };
const MOZJPEG_ENCODE_OPTIONS = { quality: 85, progressive: true };
// Set when a codec's last encode threw; its cached jSquash module may be broken.
const codecFailed: Record<'avif' | 'jxl' | 'jpeg', boolean> = { avif: false, jxl: false, jpeg: false };

// LibRaw's LIBRAW_FILE_UNSUPPORTED: wlibraw throws it (as a WLibRawError with
// this code) when the bytes are not a raw camera file. A plain TIFF also
// matches the TIFF magic in sniff(), so this is what tells it apart.
const LIBRAW_FILE_UNSUPPORTED = -2;
function isUnsupportedRaw(error: unknown): boolean {
  return typeof error === 'object' && error !== null
    && (error as { name?: unknown }).name === 'WLibRawError'
    && (error as { code?: unknown }).code === LIBRAW_FILE_UNSUPPORTED;
}

type RawDecode = { bitmap: ImageBitmap; pixels: number; downscaled: boolean };

// Decodes one camera RAW file. A fresh wlibraw instance is created per file and
// dropped when this returns: the wasm heap stays at the decode's high-water
// mark (up to ~1.5 GB at 101 MP), so a kept instance would hold that between
// files, while a fresh instance costs ~20-40 ms against seconds of decoding.
async function decodeRaw(file: File, limit: number, downscale: boolean, phase: Phase): Promise<RawDecode> {
  const { initWLibraw } = await import('@wasmedia/wlibraw');
  const wl = await initWLibraw();
  // The module is loaded; the open + full decode below is the long part.
  phase('converting');
  const rawFile = wl.open(new Uint8Array(await file.arrayBuffer()));
  try {
    const pixels = rawFile.metadata.width * rawFile.metadata.height;
    // Size check on the metadata, before the full decode: without consent an
    // oversize RAW fails without spending the decode.
    if (pixels > limit && !downscale) throw { code: 'too-large', pixels, limit };
    // Half-size when the quarter area keeps at least half the allowed pixels
    // (about 4x less wasm heap, accepted when the result still carries at least
    // half the limit), or when a full decode would exhaust the 2 GB heap;
    // otherwise decode full size and resize the bitmap to fit below.
    const halfSize = downscale && pixels > limit && (pixels / 4 >= limit / 2 || pixels > RAW_MAX_PIXELS);
    const image = rawFile.decode({ useCameraWb: true, outputBps: 8, ...(halfSize ? { halfSize: true } : {}) });
    try {
      const { data, width, height } = image.toImageData();
      const decoded = width * height;
      const resize = downscale && decoded > limit;
      const options: ImageBitmapOptions = resize ? {
        resizeWidth: Math.max(1, Math.floor(width * Math.sqrt(limit / decoded))),
        resizeHeight: Math.max(1, Math.floor(height * Math.sqrt(limit / decoded))),
        resizeQuality: 'high',
      } : {};
      return {
        bitmap: await createImageBitmap(new ImageData(data as Uint8ClampedArray<ArrayBuffer>, width, height), options),
        pixels,
        downscaled: halfSize || resize,
      };
    } finally {
      image.free();
    }
  } finally {
    rawFile.close();
  }
}

// The caller owns the returned bitmap and closes it in finally.
export async function decode(file: File, kind: InputKind, fitTo?: Fit): Promise<ImageBitmap> {
  const options: ImageBitmapOptions = fitTo ? {
    resizeWidth: fitTo.width, resizeHeight: fitTo.height, resizeQuality: 'high',
  } : {};
  if (kind === 'heic') {
    const { heicTo } = await import('heic-to/csp');
    return heicTo({ blob: file, type: 'bitmap', options });
  }
  return createImageBitmap(file, options);
}

export async function encode(bitmap: ImageBitmap, format: OutputFormat, phase: Phase, smaller = false): Promise<Blob> {
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  try {
    const context = canvas.getContext('2d');
    if (!context) throw { code: 'too-large' };
    if (['jpeg', 'pdf', 'gif'].includes(format)) {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0);
    const mime = OUTPUT_FORMATS.find(f => f.id === format)!.mime;
    if (format === 'jpeg' && smaller) {
      phase('loading-codec');
      try {
        const codec = await import('@jsquash/jpeg/encode.js');
        // Re-init only after a failed encode: one abort must not break the cached
        // module, but healthy batches reuse the single compiled instance.
        if (codecFailed.jpeg) {
          await codec.init();
          codecFailed.jpeg = false;
        }
        phase('converting');
        return new Blob([await codec.default(context.getImageData(0, 0, width, height), MOZJPEG_ENCODE_OPTIONS)], { type: mime });
      } catch (error) {
        codecFailed.jpeg = true;
        // Chunk fetch, init and encode failures all fall back to the native JPEG.
        return await canvas.convertToBlob({ type: mime, quality: 0.9 });
      }
    }
    if (format === 'png' && smaller) {
      const native = await canvas.convertToBlob({ type: mime, quality: 0.9 });
      phase('loading-codec');
      try {
        // Single-threaded wasm-bindgen entry, so the parallel wasm and its worker
        // are never bundled; the site is not cross-origin isolated.
        const { default: init, optimise } = await import('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js');
        await init();
        phase('converting');
        // level 2, interlace false, optimize_alpha false (the library defaults).
        const optimised = optimise(new Uint8Array(await native.arrayBuffer()), 2, false, false);
        return new Blob([optimised as Uint8Array<ArrayBuffer>], { type: mime });
      } catch {
        // wasm-bindgen init caches its instance, so re-init is not a recovery;
        // the native PNG is.
        return native;
      }
    }
    if (format === 'jpeg' || format === 'png') {
      return await canvas.convertToBlob({ type: mime, quality: 0.9 });
    }
    if (format === 'webp') {
      const native = await canvas.convertToBlob({ type: mime, quality: 0.85 });
      if (native.type === 'image/webp') return native;
      phase('loading-codec');
      const { default: webp } = await import('@jsquash/webp/encode.js');
      phase('converting');
      return new Blob([await webp(context.getImageData(0, 0, width, height), { quality: 85 })], { type: mime });
    }
    if (format === 'avif' || format === 'jxl') {
      phase('loading-codec');
      const codec = format === 'avif'
        ? await import('@jsquash/avif/encode.js')
        : await import('@jsquash/jxl/encode.js');
      // Re-init only after a failed encode: one abort must not break the cached
      // module, but healthy batches reuse the single compiled instance.
      if (codecFailed[format]) {
        await codec.init();
        codecFailed[format] = false;
      }
      phase('converting');
      const options = format === 'avif' ? AVIF_ENCODE_OPTIONS : JXL_ENCODE_OPTIONS;
      try {
        return new Blob([await codec.default(context.getImageData(0, 0, width, height), options)], { type: mime });
      } catch (error) {
        codecFailed[format] = true;
        throw error;
      }
    }
    phase('loading-codec');
    if (format === 'pdf') {
      const { PDFDocument } = await import('pdf-lib');
      phase('converting');
      const jpeg = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      const pdf = await PDFDocument.create({ updateMetadata: false });
      const image = await pdf.embedJpg(await jpeg.arrayBuffer());
      const pageWidth = width * 72 / 300;
      const pageHeight = height * 72 / 300;
      pdf.addPage([pageWidth, pageHeight]).drawImage(image, {
        x: 0, y: 0, width: pageWidth, height: pageHeight,
      });
      return new Blob([new Uint8Array(await pdf.save())], { type: mime });
    }
    if (format === 'gif') {
      const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
      phase('converting');
      const rgba = context.getImageData(0, 0, width, height).data;
      const palette = quantize(rgba, 256, { format: 'rgb565' });
      const gif = GIFEncoder();
      gif.writeFrame(applyPalette(rgba, palette, 'rgb565'), width, height, { palette });
      gif.finish();
      return new Blob([new Uint8Array(gif.bytes())], { type: mime });
    }
    const { default: UTIF } = await import('utif');
    phase('converting');
    const rgba = context.getImageData(0, 0, width, height).data;
    return new Blob([UTIF.encodeImage(rgba.buffer, width, height, { t338: [2], t305: [''] })], { type: mime });
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export async function thumbnail(bitmap: ImageBitmap): Promise<Blob> {
  const scale = Math.min(1, 88 / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.max(1, Math.floor(bitmap.width * scale)),
    Math.max(1, Math.floor(bitmap.height * scale)));
  try {
    const context = canvas.getContext('2d');
    if (!context) throw { code: 'too-large' };
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export async function convert(request: ConvertRequest, phase: Phase) {
  let maxArea = request.maxArea;
  if (request.format === 'jxl') maxArea = Math.min(maxArea ?? JXL_MAX_PIXELS, JXL_MAX_PIXELS);
  if (request.kind === 'raw') maxArea = Math.min(maxArea ?? RAW_MAX_PIXELS, RAW_MAX_PIXELS);
  let bitmap: ImageBitmap | undefined;
  let pixels: number | undefined;
  let downscaled = false;
  try {
    if (request.kind === 'heic' || request.kind === 'raw') phase('loading-codec');
    if (request.kind === 'raw') {
      // RAW decodes through wlibraw; its oversize check runs on the file
      // metadata before the full decode, inside decodeRaw, which also emits
      // phase('converting') once the codec module is loaded.
      const limit = maxArea ?? RAW_MAX_PIXELS;
      const raw = await decodeRaw(request.file, limit, request.downscale, phase);
      bitmap = raw.bitmap;
      pixels = raw.pixels;
      downscaled = raw.downscaled;
      if (bitmap.width * bitmap.height > limit) throw { code: 'too-large', pixels, limit };
    } else {
      bitmap = await decode(request.file, request.kind);
      phase('converting');
      pixels = bitmap.width * bitmap.height;
      if (maxArea !== null && pixels > maxArea) {
        if (!request.downscale) throw { code: 'too-large', pixels, limit: maxArea };
        let fit: Fit;
        try {
          const scale = Math.sqrt(maxArea / pixels);
          fit = { width: Math.max(1, Math.floor(bitmap.width * scale)),
            height: Math.max(1, Math.floor(bitmap.height * scale)) };
        } finally {
          // Release the full-size decode before allocating the resized bitmap.
          bitmap.close(); bitmap = undefined;
        }
        bitmap = await decode(request.file, request.kind, fit);
        downscaled = true;
        if (bitmap.width * bitmap.height > maxArea) {
          throw { code: 'too-large', pixels, limit: maxArea };
        }
      }
    }
    const blob = await encode(bitmap, request.format, phase, request.smaller);
    const preview = await thumbnail(bitmap);
    return { blob, thumbnail: preview, width: bitmap.width, height: bitmap.height, downscaled };
  } catch (error) {
    // A RAW oversize is known from the file metadata before any bitmap exists.
    if (pixels === undefined && typeof error === 'object' && error !== null
        && 'code' in error && error.code === 'too-large' && 'pixels' in error
        && typeof error.pixels === 'number') {
      pixels = error.pixels;
    }
    // Report the effective limit only when downscaling to it would actually shrink
    // the image; otherwise fall back to the probed browser limit (omitted when null).
    const limit = pixels !== undefined && maxArea !== null && pixels > maxArea ? maxArea : request.maxArea;
    if (typeof error === 'object' && error !== null && 'code' in error
        && error.code === 'too-large') {
      throw { code: 'too-large', pixels, ...(limit === null ? {} : { limit }) };
    }
    // Canvas allocation/serialization failures are the browser's size boundary.
    if (error instanceof DOMException && ['IndexSizeError', 'EncodingError'].includes(error.name)) {
      throw { code: 'too-large', pixels, ...(limit === null ? {} : { limit }) };
    }
    // A file that matches a RAW magic but is not a raw camera file (a plain
    // TIFF) reads as "Not an image we can read".
    if (isUnsupportedRaw(error)) throw { code: 'unrecognized' };
    throw { code: 'failed' };
  } finally {
    bitmap?.close();
  }
}
