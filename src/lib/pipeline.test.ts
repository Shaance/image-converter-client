import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { convert, encode, type ConvertRequest } from './pipeline';

vi.mock('@jsquash/webp/encode.js', () => ({
  default: async () => new TextEncoder().encode('fallback WebP').buffer,
}));
const jsquash = vi.hoisted(() => ({
  avif: { init: vi.fn(async () => ({})), encode: vi.fn(async () => new TextEncoder().encode('AVIF bytes').buffer) },
  jxl: { init: vi.fn(async () => ({})), encode: vi.fn(async () => new TextEncoder().encode('JXL bytes').buffer) },
  jpeg: { init: vi.fn(async () => ({})), encode: vi.fn(async () => new TextEncoder().encode('MozJPEG bytes').buffer) },
  oxipng: { init: vi.fn(async () => ({})),
    optimise: vi.fn((_data: Uint8Array, _level: number, _interlace: boolean, _alpha: boolean) => new TextEncoder().encode('OxiPNG bytes')) },
}));
vi.mock('@jsquash/avif/encode.js', () => ({ default: jsquash.avif.encode, init: jsquash.avif.init }));
vi.mock('@jsquash/jxl/encode.js', () => ({ default: jsquash.jxl.encode, init: jsquash.jxl.init }));
vi.mock('@jsquash/jpeg/encode.js', () => ({ default: jsquash.jpeg.encode, init: jsquash.jpeg.init }));
vi.mock('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js', () => ({ default: jsquash.oxipng.init, optimise: jsquash.oxipng.optimise }));
// Mocked wlibraw: a module-load counter plus per-file open/decode/close records.
const wlibraw = vi.hoisted(() => ({
  moduleLoads: 0,
  inits: 0,
  metadata: { width: 6000, height: 4000 },
  openError: null as unknown,
  decodeError: null as unknown,
  decodeOptions: [] as Record<string, unknown>[],
  files: [] as { metadata: { width: number; height: number }; decode: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    image?: { toImageData: () => { data: Uint8ClampedArray; width: number; height: number };
      free: ReturnType<typeof vi.fn> } }[],
}));
vi.mock('@wasmedia/wlibraw', () => {
  wlibraw.moduleLoads++;
  return {
    initWLibraw: vi.fn(async () => {
      wlibraw.inits++;
      return {
        open: (_bytes: Uint8Array) => {
          if (wlibraw.openError) throw wlibraw.openError;
          const meta = wlibraw.metadata;
          const file: (typeof wlibraw.files)[number] = {
            metadata: { ...meta },
            decode: vi.fn((options: { halfSize?: boolean }) => {
              wlibraw.decodeOptions.push(options);
              if (wlibraw.decodeError) throw wlibraw.decodeError;
              const width = options.halfSize ? Math.floor(meta.width / 2) : meta.width;
              const height = options.halfSize ? Math.floor(meta.height / 2) : meta.height;
              file.image = {
                toImageData: () => ({ data: new Uint8ClampedArray(width * height * 4), width, height }),
                free: vi.fn(),
              };
              return file.image;
            }),
            close: vi.fn(),
          };
          wlibraw.files.push(file);
          return file;
        },
      };
    }),
  };
});
// Re-registers the standard codec mocks after a test overrode them with vi.doMock.
function restoreCodecMocks() {
  vi.doMock('@jsquash/jpeg/encode.js', () => ({ default: jsquash.jpeg.encode, init: jsquash.jpeg.init }));
  vi.doMock('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js', () => ({ default: jsquash.oxipng.init, optimise: jsquash.oxipng.optimise }));
  vi.resetModules();
}
let canvases: FakeCanvas[];
let bitmaps: { width: number; height: number; closed: boolean; close(): void }[];
let bitmapCalls: { source: unknown; options: ImageBitmapOptions | undefined }[];
let nativeMime: string;
let encodeFailure: boolean;
let contextFails: boolean;
class FakeCanvas {
  fillRectCalls = 0;
  convertToBlobCalls = 0;
  constructor(public width: number, public height: number) { canvases.push(this); }
  getContext() {
    if (contextFails) return null;
    const canvas = this;
    return { fillStyle: '', fillRect() { canvas.fillRectCalls++; }, drawImage() {},
      getImageData: () => ({ data: new Uint8ClampedArray([200, 100, 50, 128]), width: 1, height: 1 }) };
  }
  async convertToBlob({ type }: { type: string }) {
    this.convertToBlobCalls++;
    if (encodeFailure) throw new Error('encode failed');
    return new Blob(['native'], { type: type === 'image/webp' ? nativeMime : type });
  }
}
const request: ConvertRequest = { type: 'convert', id: 'one', attempt: 0,
  file: new File(['image'], 'image.jpg'), kind: 'jpeg', format: 'png', maxArea: 16, downscale: false, smaller: false };
beforeEach(() => {
  canvases = []; bitmaps = []; bitmapCalls = []; nativeMime = 'image/webp'; encodeFailure = false; contextFails = false;
  jsquash.avif.init.mockClear(); jsquash.avif.encode.mockClear();
  jsquash.jxl.init.mockClear(); jsquash.jxl.encode.mockClear();
  jsquash.jpeg.init.mockClear(); jsquash.jpeg.encode.mockClear();
  jsquash.oxipng.init.mockClear(); jsquash.oxipng.optimise.mockClear();
  wlibraw.moduleLoads = 0; wlibraw.inits = 0; wlibraw.decodeOptions = []; wlibraw.files = [];
  wlibraw.metadata = { width: 6000, height: 4000 }; wlibraw.openError = null; wlibraw.decodeError = null;
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  vi.stubGlobal('ImageData', class ImageData {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  });
  vi.stubGlobal('createImageBitmap', async (source: unknown, options: ImageBitmapOptions) => {
    bitmapCalls.push({ source, options });
    const src = source as { width?: number; height?: number };
    const bitmap = { width: options?.resizeWidth ?? src.width ?? 8, height: options?.resizeHeight ?? src.height ?? 8,
      closed: false, close() { this.closed = true; } };
    bitmaps.push(bitmap);
    return bitmap;
  });
});
afterEach(() => vi.unstubAllGlobals());

it('does not draw an oversized bitmap before consent and closes it', async () => {
  await expect(convert(request, () => {})).rejects.toEqual({ code: 'too-large', pixels: 64, limit: 16 });
  expect(bitmaps[0].closed).toBe(true);
  expect(canvases).toEqual([]);
});
it('re-decodes to fit after consent and releases both bitmaps and every canvas', async () => {
  const result = await convert({ ...request, downscale: true }, () => {});
  expect(result).toMatchObject({ width: 4, height: 4, downscaled: true });
  expect(result.blob.type).toBe('image/png');
  expect(result.thumbnail.type).toBe('image/jpeg');
  expect(bitmaps.map(b => [b.width, b.closed])).toEqual([[8, true], [4, true]]);
  expect(canvases.map(c => [c.width, c.height])).toEqual([[0, 0], [0, 0]]);
});
it('releases the bitmap and canvas when encoding fails', async () => {
  encodeFailure = true;
  await expect(convert({ ...request, maxArea: null }, () => {})).rejects.toEqual({ code: 'failed' });
  expect(bitmaps[0].closed).toBe(true);
  expect(canvases[0].width).toBe(0);
});
it.each(['image/webp', 'image/png', ''])('accepts only the exact native WebP MIME: %s', async mime => {
  nativeMime = mime;
  const bitmap = { width: 1, height: 1 } as ImageBitmap;
  const blob = await encode(bitmap, 'webp', () => {});
  expect(blob.type).toBe('image/webp');
  expect(await blob.text()).toBe(mime === 'image/webp' ? 'native' : 'fallback WebP');
});
it.each([
  ['avif', 'image/avif', 'AVIF bytes', { quality: 50, speed: 6 }] as const,
  ['jxl', 'image/jxl', 'JXL bytes', { quality: 75, effort: 5 }] as const,
])('encodes %s via the lazy WASM codec, keeping alpha and skipping the native encoder', async (format, mime, text, options) => {
  const codec = format === 'avif' ? jsquash.avif : jsquash.jxl;
  const phases: string[] = [];
  const blob = await encode({ width: 1, height: 1 } as ImageBitmap, format, p => phases.push(p));
  expect(blob.type).toBe(mime);
  expect(await blob.text()).toBe(text);
  expect(codec.encode).toHaveBeenCalledTimes(1);
  expect(codec.encode).toHaveBeenCalledWith(
    { data: new Uint8ClampedArray([200, 100, 50, 128]), width: 1, height: 1 }, options);
  expect(codec.init).not.toHaveBeenCalled();
  expect(canvases).toHaveLength(1);
  expect(canvases[0].fillRectCalls).toBe(0);
  expect(canvases[0].convertToBlobCalls).toBe(0);
  expect(phases).toEqual(['loading-codec', 'converting']);
});
it('reuses one compiled codec instance while encodes succeed', async () => {
  vi.resetModules();
  const { encode: freshEncode } = await import('./pipeline');
  await freshEncode({ width: 1, height: 1 } as ImageBitmap, 'avif', () => {});
  await freshEncode({ width: 1, height: 1 } as ImageBitmap, 'avif', () => {});
  expect(jsquash.avif.encode).toHaveBeenCalledTimes(2);
  expect(jsquash.avif.init).not.toHaveBeenCalled();
});
it('re-initialises a codec only after its encode failed', async () => {
  vi.resetModules();
  const { encode: freshEncode } = await import('./pipeline');
  jsquash.jxl.encode.mockRejectedValueOnce(new Error('aborted'));
  await expect(freshEncode({ width: 1, height: 1 } as ImageBitmap, 'jxl', () => {}))
    .rejects.toThrow('aborted');
  expect(jsquash.jxl.init).not.toHaveBeenCalled();
  await freshEncode({ width: 1, height: 1 } as ImageBitmap, 'jxl', () => {});
  expect(jsquash.jxl.init).toHaveBeenCalledTimes(1);
  expect(jsquash.jxl.init.mock.invocationCallOrder[0])
    .toBeLessThan(jsquash.jxl.encode.mock.invocationCallOrder[1]);
  await freshEncode({ width: 1, height: 1 } as ImageBitmap, 'jxl', () => {});
  expect(jsquash.jxl.init).toHaveBeenCalledTimes(1);
});
it('does not re-initialise the other codec after a failure', async () => {
  vi.resetModules();
  const { encode: freshEncode } = await import('./pipeline');
  jsquash.avif.encode.mockRejectedValueOnce(new Error('aborted'));
  await expect(freshEncode({ width: 1, height: 1 } as ImageBitmap, 'avif', () => {}))
    .rejects.toThrow('aborted');
  await freshEncode({ width: 1, height: 1 } as ImageBitmap, 'jxl', () => {});
  expect(jsquash.jxl.init).not.toHaveBeenCalled();
  await freshEncode({ width: 1, height: 1 } as ImageBitmap, 'avif', () => {});
  expect(jsquash.avif.init).toHaveBeenCalledTimes(1);
  expect(jsquash.avif.init.mock.invocationCallOrder[0])
    .toBeLessThan(jsquash.avif.encode.mock.invocationCallOrder[1]);
});
it('caps JPEG XL at 20 MP even when the browser probe failed', async () => {
  vi.stubGlobal('createImageBitmap', async (_: Blob, options: ImageBitmapOptions) => {
    const bitmap = { width: options.resizeWidth ?? 5000, height: options.resizeHeight ?? 5000,
      closed: false, close() { this.closed = true; } };
    bitmaps.push(bitmap);
    return bitmap;
  });
  await expect(convert({ ...request, format: 'jxl', maxArea: null }, () => {}))
    .rejects.toEqual({ code: 'too-large', pixels: 25_000_000, limit: 20_000_000 });
  expect(bitmaps[0].closed).toBe(true);
});
it('keeps the smaller browser limit for JPEG XL', async () => {
  vi.stubGlobal('createImageBitmap', async (_: Blob, options: ImageBitmapOptions) => {
    const bitmap = { width: options.resizeWidth ?? 5000, height: options.resizeHeight ?? 5000,
      closed: false, close() { this.closed = true; } };
    bitmaps.push(bitmap);
    return bitmap;
  });
  await expect(convert({ ...request, format: 'jxl', maxArea: 16 }, () => {}))
    .rejects.toEqual({ code: 'too-large', pixels: 25_000_000, limit: 16 });
});
it('downscales an oversize JPEG XL to fit 20 MP after consent', async () => {
  vi.stubGlobal('createImageBitmap', async (_: Blob, options: ImageBitmapOptions) => {
    const bitmap = { width: options.resizeWidth ?? 5000, height: options.resizeHeight ?? 5000,
      closed: false, close() { this.closed = true; } };
    bitmaps.push(bitmap);
    return bitmap;
  });
  const result = await convert({ ...request, format: 'jxl', maxArea: null, downscale: true }, () => {});
  expect(result.downscaled).toBe(true);
  expect(result.width * result.height).toBeLessThanOrEqual(20_000_000);
  expect(result.blob.type).toBe('image/jxl');
});
it('does not cap AVIF at 20 MP when the browser probe failed', async () => {
  vi.stubGlobal('createImageBitmap', async (_: Blob, options: ImageBitmapOptions) => {
    const bitmap = { width: options.resizeWidth ?? 5000, height: options.resizeHeight ?? 5000,
      closed: false, close() { this.closed = true; } };
    bitmaps.push(bitmap);
    return bitmap;
  });
  const result = await convert({ ...request, format: 'avif', maxArea: null }, () => {});
  expect(result.width * result.height).toBe(25_000_000);
  expect(result.blob.type).toBe('image/avif');
});
it('reports no invented limit for a canvas failure on JPEG XL when the probe failed', async () => {
  contextFails = true;
  await expect(convert({ ...request, format: 'jxl', maxArea: null }, () => {}))
    .rejects.toEqual({ code: 'too-large', pixels: 64 });
});
it('reports the probed browser limit, not the 20 MP cap, for a canvas failure on JPEG XL', async () => {
  contextFails = true;
  await expect(convert({ ...request, format: 'jxl', maxArea: 30_000_000 }, () => {}))
    .rejects.toEqual({ code: 'too-large', pixels: 64, limit: 30_000_000 });
});
it('encodes jpeg via MozJPEG when smaller is on, keeping the white fill', async () => {
  const phases: string[] = [];
  const blob = await encode({ width: 1, height: 1 } as ImageBitmap, 'jpeg', p => phases.push(p), true);
  expect(blob.type).toBe('image/jpeg');
  expect(await blob.text()).toBe('MozJPEG bytes');
  expect(jsquash.jpeg.encode).toHaveBeenCalledTimes(1);
  expect(jsquash.jpeg.encode).toHaveBeenCalledWith(
    { data: new Uint8ClampedArray([200, 100, 50, 128]), width: 1, height: 1 },
    { quality: 85, progressive: true });
  expect(jsquash.jpeg.init).not.toHaveBeenCalled();
  expect(jsquash.oxipng.optimise).not.toHaveBeenCalled();
  expect(canvases).toHaveLength(1);
  expect(canvases[0].fillRectCalls).toBe(1);
  expect(phases).toEqual(['loading-codec', 'converting']);
});
it('falls back to the native JPEG when MozJPEG throws, then re-inits once on the next encode', async () => {
  vi.resetModules();
  const { encode: freshEncode } = await import('./pipeline');
  jsquash.jpeg.encode.mockRejectedValueOnce(new Error('aborted'));
  const phases: string[] = [];
  const blob = await freshEncode({ width: 1, height: 1 } as ImageBitmap, 'jpeg', p => phases.push(p), true);
  expect(blob.type).toBe('image/jpeg');
  expect(await blob.text()).toBe('native');
  expect(phases).toEqual(['loading-codec', 'converting']);
  expect(jsquash.jpeg.init).not.toHaveBeenCalled();
  await freshEncode({ width: 1, height: 1 } as ImageBitmap, 'jpeg', () => {}, true);
  expect(jsquash.jpeg.init).toHaveBeenCalledTimes(1);
  expect(jsquash.jpeg.init.mock.invocationCallOrder[0])
    .toBeLessThan(jsquash.jpeg.encode.mock.invocationCallOrder[1]);
  await freshEncode({ width: 1, height: 1 } as ImageBitmap, 'jpeg', () => {}, true);
  expect(jsquash.jpeg.init).toHaveBeenCalledTimes(1);
});
it('passes the native PNG bytes through single-threaded OxiPNG when smaller is on', async () => {
  const phases: string[] = [];
  const blob = await encode({ width: 1, height: 1 } as ImageBitmap, 'png', p => phases.push(p), true);
  expect(blob.type).toBe('image/png');
  expect(await blob.text()).toBe('OxiPNG bytes');
  expect(jsquash.oxipng.init).toHaveBeenCalledTimes(1);
  expect(jsquash.oxipng.optimise).toHaveBeenCalledTimes(1);
  const [data, level, interlace, alpha] = jsquash.oxipng.optimise.mock.calls[0];
  expect(new TextDecoder().decode(data)).toBe('native');
  expect([level, interlace, alpha]).toEqual([2, false, false]);
  expect(jsquash.jpeg.encode).not.toHaveBeenCalled();
  expect(canvases[0].fillRectCalls).toBe(0);
  expect(phases).toEqual(['loading-codec', 'converting']);
});
it('returns the native PNG when OxiPNG throws, after attempting optimise', async () => {
  jsquash.oxipng.optimise.mockImplementationOnce(() => { throw new Error('aborted'); });
  const blob = await encode({ width: 1, height: 1 } as ImageBitmap, 'png', () => {}, true);
  expect(jsquash.oxipng.optimise).toHaveBeenCalledTimes(1);
  const [data, level] = jsquash.oxipng.optimise.mock.calls[0];
  expect(new TextDecoder().decode(data)).toBe('native');
  expect(level).toBe(2);
  expect(blob.type).toBe('image/png');
  expect(await blob.text()).toBe('native');
});
it('returns the native JPEG when the MozJPEG chunk fails to load', async () => {
  vi.resetModules();
  vi.doMock('@jsquash/jpeg/encode.js', () => { throw new Error('chunk fetch failed'); });
  try {
    const { encode: freshEncode } = await import('./pipeline');
    const phases: string[] = [];
    const blob = await freshEncode({ width: 1, height: 1 } as ImageBitmap, 'jpeg', p => phases.push(p), true);
    expect(blob.type).toBe('image/jpeg');
    expect(await blob.text()).toBe('native');
    expect(jsquash.jpeg.encode).not.toHaveBeenCalled();
    expect(phases).toEqual(['loading-codec']);
  } finally {
    restoreCodecMocks();
  }
});
it('returns the native JPEG when MozJPEG init throws on a retry', async () => {
  vi.resetModules();
  const { encode: freshEncode } = await import('./pipeline');
  jsquash.jpeg.encode.mockRejectedValueOnce(new Error('aborted'));
  const first = await freshEncode({ width: 1, height: 1 } as ImageBitmap, 'jpeg', () => {}, true);
  expect(await first.text()).toBe('native');
  jsquash.jpeg.init.mockRejectedValueOnce(new Error('init failed'));
  const second = await freshEncode({ width: 1, height: 1 } as ImageBitmap, 'jpeg', () => {}, true);
  expect(jsquash.jpeg.init).toHaveBeenCalledTimes(1);
  expect(await second.text()).toBe('native');
});
it('returns the native PNG when the OxiPNG chunk fails to load', async () => {
  vi.resetModules();
  vi.doMock('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js', () => { throw new Error('chunk fetch failed'); });
  try {
    const { encode: freshEncode } = await import('./pipeline');
    const blob = await freshEncode({ width: 1, height: 1 } as ImageBitmap, 'png', () => {}, true);
    expect(blob.type).toBe('image/png');
    expect(await blob.text()).toBe('native');
    expect(jsquash.oxipng.optimise).not.toHaveBeenCalled();
  } finally {
    restoreCodecMocks();
  }
});
it.each(['jpeg', 'png'] as const)('loads neither codec module for %s when smaller is off', async format => {
  vi.resetModules();
  const loads = { jpeg: 0, oxipng: 0 };
  vi.doMock('@jsquash/jpeg/encode.js', () => {
    loads.jpeg++;
    return { default: jsquash.jpeg.encode, init: jsquash.jpeg.init };
  });
  vi.doMock('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js', () => {
    loads.oxipng++;
    return { default: jsquash.oxipng.init, optimise: jsquash.oxipng.optimise };
  });
  try {
    const { encode: freshEncode } = await import('./pipeline');
    const blob = await freshEncode({ width: 1, height: 1 } as ImageBitmap, format, () => {});
    expect(blob.type).toBe(`image/${format}`);
    expect(await blob.text()).toBe('native');
    expect(loads.jpeg).toBe(0);
    expect(loads.oxipng).toBe(0);
  } finally {
    restoreCodecMocks();
  }
});
it.each(['webp', 'avif', 'tiff'] as const)('loads neither codec module for %s even when smaller is on', async format => {
  vi.resetModules();
  const loads = { jpeg: 0, oxipng: 0 };
  vi.doMock('@jsquash/jpeg/encode.js', () => {
    loads.jpeg++;
    return { default: jsquash.jpeg.encode, init: jsquash.jpeg.init };
  });
  vi.doMock('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js', () => {
    loads.oxipng++;
    return { default: jsquash.oxipng.init, optimise: jsquash.oxipng.optimise };
  });
  try {
    const { encode: freshEncode } = await import('./pipeline');
    await freshEncode({ width: 1, height: 1 } as ImageBitmap, format, () => {}, true);
    expect(loads.jpeg).toBe(0);
    expect(loads.oxipng).toBe(0);
  } finally {
    restoreCodecMocks();
  }
});
it('forwards smaller from the convert request to the encoder', async () => {
  const result = await convert({ ...request, format: 'jpeg', maxArea: null, smaller: true }, () => {});
  expect(result.blob.type).toBe('image/jpeg');
  expect(await result.blob.text()).toBe('MozJPEG bytes');
  expect(jsquash.jpeg.encode).toHaveBeenCalledTimes(1);
});
it('encodes actual TIFF bytes with straight alpha and no source metadata', async () => {
  const blob = await encode({ width: 1, height: 1 } as ImageBitmap, 'tiff', () => {});
  const data = await blob.arrayBuffer();
  const view = new DataView(data);
  expect(view.getUint32(0)).toBe(0x4d4d002a);
  const offset = view.getUint32(4);
  const entries = view.getUint16(offset);
  const tags = new Map<number, number>();
  for (let i = 0; i < entries; i++) {
    const entry = offset + 2 + i * 12;
    tags.set(view.getUint16(entry), view.getUint16(entry + 8));
  }
  expect(tags.get(338)).toBe(2);
  expect(tags.has(34665)).toBe(false); // EXIF
  expect(tags.has(34853)).toBe(false); // GPS
  expect(tags.has(34675)).toBe(false); // ICC profile
  expect(Array.from(new Uint8Array(data).slice(1000))).toEqual([200, 100, 50, 128]);
});

const rawRequest = (over: Partial<ConvertRequest> = {}): ConvertRequest => ({
  ...request, kind: 'raw', file: new File(['raw bytes'], 'photo.cr3'), format: 'png',
  maxArea: null, downscale: false, ...over,
});
const unsupportedRaw = () => Object.assign(
  new Error('libraw_open_buffer: Unsupported file format (-2)'), { name: 'WLibRawError', code: -2 });

it('decodes a RAW file through one lazily loaded wlibraw instance and frees everything', async () => {
  vi.resetModules();
  const { convert: freshConvert } = await import('./pipeline');
  const phases: string[] = [];
  const result = await freshConvert(rawRequest(), p => phases.push(p));
  expect(wlibraw.moduleLoads).toBe(1);
  expect(wlibraw.inits).toBe(1);
  expect(wlibraw.decodeOptions).toEqual([{ useCameraWb: true, outputBps: 8, gamma: [2.4, 12.92] }]);
  expect(wlibraw.files[0].image!.free).toHaveBeenCalledTimes(1);
  expect(wlibraw.files[0].close).toHaveBeenCalledTimes(1);
  expect(result).toMatchObject({ width: 6000, height: 4000, downscaled: false });
  expect(result.blob.type).toBe('image/png');
  expect(phases).toEqual(['loading-codec', 'converting']);
  expect(bitmaps[0].closed).toBe(true);
});
it.each(['jpeg', 'png', 'avif', 'webp'] as const)('never loads wlibraw for %s input', async kind => {
  vi.resetModules();
  const { convert: freshConvert } = await import('./pipeline');
  await freshConvert({ ...request, kind, maxArea: null }, () => {});
  expect(wlibraw.moduleLoads).toBe(0);
  expect(wlibraw.inits).toBe(0);
});
it('rejects an oversize RAW from its metadata without decoding', async () => {
  wlibraw.metadata = { width: 12000, height: 12500 }; // 150 MP, over the 110 MP cap
  await expect(convert(rawRequest(), () => {}))
    .rejects.toEqual({ code: 'too-large', pixels: 150_000_000, limit: 110_000_000 });
  expect(wlibraw.decodeOptions).toEqual([]);
  expect(wlibraw.files[0].close).toHaveBeenCalledTimes(1);
  expect(bitmaps).toEqual([]);
});
it('combines the RAW cap with the JPEG XL cap, smallest wins', async () => {
  wlibraw.metadata = { width: 5000, height: 5000 }; // 25 MP
  await expect(convert(rawRequest({ format: 'jxl' }), () => {}))
    .rejects.toEqual({ code: 'too-large', pixels: 25_000_000, limit: 20_000_000 });
  expect(wlibraw.decodeOptions).toEqual([]);
});
it('keeps the probed browser limit for RAW when it is smaller than the cap', async () => {
  wlibraw.metadata = { width: 5000, height: 5000 }; // 25 MP
  await expect(convert(rawRequest({ maxArea: 16_000_000 }), () => {}))
    .rejects.toEqual({ code: 'too-large', pixels: 25_000_000, limit: 16_000_000 });
});
it('decodes with halfSize when the quarter area keeps at least half the limit, then resizes to fit', async () => {
  wlibraw.metadata = { width: 10000, height: 10000 }; // 100 MP, limit 20 MP: quarter is 25 MP >= 10 MP
  const result = await convert(rawRequest({ maxArea: 20_000_000, downscale: true }), () => {});
  expect(wlibraw.decodeOptions).toEqual([{ useCameraWb: true, outputBps: 8, gamma: [2.4, 12.92], halfSize: true }]);
  // The half decode is 5000x5000 (25 MP), still over 20 MP, so it is resized.
  expect(bitmapCalls[0].options).toEqual({ resizeWidth: 4472, resizeHeight: 4472, resizeQuality: 'high' });
  expect(result.downscaled).toBe(true);
  expect(result.width * result.height).toBeLessThanOrEqual(20_000_000);
});
it('decodes a 61 MP RAW with halfSize at an iPhone-class 16.7 MP limit, without resizing', async () => {
  wlibraw.metadata = { width: 8960, height: 6800 }; // 61 MP, limit 16,777,216: quarter is 15.2 MP >= 8.4 MP
  const result = await convert(rawRequest({ maxArea: 16_777_216, downscale: true }), () => {});
  expect(wlibraw.decodeOptions).toEqual([{ useCameraWb: true, outputBps: 8, gamma: [2.4, 12.92], halfSize: true }]);
  // The half decode is 4480x3400 (15.2 MP), already within the limit.
  expect(bitmapCalls[0].options).toEqual({});
  expect(result).toMatchObject({ width: 4480, height: 3400, downscaled: true });
});
it('decodes a 24 MP RAW at full size at a 16.7 MP limit, then resizes to fit', async () => {
  wlibraw.metadata = { width: 6000, height: 4000 }; // 24 MP: quarter is 6 MP < 8.4 MP
  const result = await convert(rawRequest({ maxArea: 16_777_216, downscale: true }), () => {});
  expect(wlibraw.decodeOptions).toEqual([{ useCameraWb: true, outputBps: 8, gamma: [2.4, 12.92] }]);
  expect(bitmapCalls[0].options).toEqual({ resizeWidth: 5016, resizeHeight: 3344, resizeQuality: 'high' });
  expect(result.downscaled).toBe(true);
  expect(result.width * result.height).toBeLessThanOrEqual(16_777_216);
});
it('always decodes with halfSize above the RAW cap, even when the quarter area is below half the limit', async () => {
  wlibraw.metadata = { width: 12000, height: 10000 }; // 120 MP, over the 110 MP cap
  const result = await convert(rawRequest({ downscale: true }), () => {});
  expect(wlibraw.decodeOptions).toEqual([{ useCameraWb: true, outputBps: 8, gamma: [2.4, 12.92], halfSize: true }]);
  expect(bitmapCalls[0].options).toEqual({});
  expect(result).toMatchObject({ width: 6000, height: 5000, downscaled: true });
});
it('maps a LibRaw unsupported-format error to unrecognized, whether thrown at open or decode', async () => {
  wlibraw.openError = unsupportedRaw();
  await expect(convert(rawRequest(), () => {})).rejects.toEqual({ code: 'unrecognized' });
  wlibraw.openError = null;
  wlibraw.decodeError = unsupportedRaw();
  await expect(convert(rawRequest(), () => {})).rejects.toEqual({ code: 'unrecognized' });
});
it('maps any other RAW failure to failed and creates a fresh instance for the next file', async () => {
  wlibraw.decodeError = new Error('aborted');
  await expect(convert(rawRequest(), () => {})).rejects.toEqual({ code: 'failed' });
  wlibraw.decodeError = null;
  const result = await convert(rawRequest(), () => {});
  expect(result.width).toBe(6000);
  expect(wlibraw.inits).toBe(2); // no wlibraw instance is kept between files
});
