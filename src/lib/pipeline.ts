import { OUTPUT_FORMATS, type InputKind, type OutputFormat } from './formats';

export type ConversionError = {
  code: 'unrecognized' | 'too-large' | 'failed' | 'worker-lost';
  pixels?: number;
  limit?: number;
};
export type ConvertRequest = {
  type: 'convert'; id: string; attempt: number; file: File; kind: InputKind;
  format: OutputFormat; maxArea: number | null; downscale: boolean;
};
export type WorkerResponse =
  | { type: 'phase'; id: string; attempt: number; phase: 'loading-codec' | 'converting' }
  | { type: 'done'; id: string; attempt: number; blob: Blob; thumbnail: Blob;
      width: number; height: number; downscaled: boolean }
  | ({ type: 'error'; id: string; attempt: number } & ConversionError);

type Fit = { width: number; height: number };
type Phase = (phase: 'loading-codec' | 'converting') => void;

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

export async function encode(bitmap: ImageBitmap, format: OutputFormat, phase: Phase): Promise<Blob> {
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
  let bitmap: ImageBitmap | undefined;
  let pixels: number | undefined;
  let downscaled = false;
  try {
    if (request.kind === 'heic') phase('loading-codec');
    bitmap = await decode(request.file, request.kind);
    phase('converting');
    pixels = bitmap.width * bitmap.height;
    if (request.maxArea !== null && pixels > request.maxArea) {
      if (!request.downscale) throw { code: 'too-large', pixels, limit: request.maxArea };
      let fit: Fit;
      try {
        const scale = Math.sqrt(request.maxArea / pixels);
        fit = { width: Math.max(1, Math.floor(bitmap.width * scale)),
          height: Math.max(1, Math.floor(bitmap.height * scale)) };
      } finally {
        // Release the full-size decode before allocating the resized bitmap.
        bitmap.close(); bitmap = undefined;
      }
      bitmap = await decode(request.file, request.kind, fit);
      downscaled = true;
      if (bitmap.width * bitmap.height > request.maxArea) {
        throw { code: 'too-large', pixels, limit: request.maxArea };
      }
    }
    const blob = await encode(bitmap, request.format, phase);
    const preview = await thumbnail(bitmap);
    return { blob, thumbnail: preview, width: bitmap.width, height: bitmap.height, downscaled };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error
        && error.code === 'too-large') {
      throw { code: 'too-large', pixels, ...(request.maxArea === null ? {} : { limit: request.maxArea }) };
    }
    // Canvas allocation/serialization failures are the browser's size boundary.
    if (error instanceof DOMException && ['IndexSizeError', 'EncodingError'].includes(error.name)) {
      throw { code: 'too-large', pixels, ...(request.maxArea === null ? {} : { limit: request.maxArea }) };
    }
    throw { code: 'failed' };
  } finally {
    bitmap?.close();
  }
}
