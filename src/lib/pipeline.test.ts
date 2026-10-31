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
// Re-registers the standard codec mocks after a test overrode them with vi.doMock.
function restoreCodecMocks() {
  vi.doMock('@jsquash/jpeg/encode.js', () => ({ default: jsquash.jpeg.encode, init: jsquash.jpeg.init }));
  vi.doMock('@jsquash/oxipng/codec/pkg/squoosh_oxipng.js', () => ({ default: jsquash.oxipng.init, optimise: jsquash.oxipng.optimise }));
  vi.resetModules();
}
let canvases: FakeCanvas[];
let bitmaps: { width: number; height: number; closed: boolean; close(): void }[];
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
  canvases = []; bitmaps = []; nativeMime = 'image/webp'; encodeFailure = false; contextFails = false;
  jsquash.avif.init.mockClear(); jsquash.avif.encode.mockClear();
  jsquash.jxl.init.mockClear(); jsquash.jxl.encode.mockClear();
  jsquash.jpeg.init.mockClear(); jsquash.jpeg.encode.mockClear();
  jsquash.oxipng.init.mockClear(); jsquash.oxipng.optimise.mockClear();
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  vi.stubGlobal('createImageBitmap', async (_: Blob, options: ImageBitmapOptions) => {
    const bitmap = { width: options.resizeWidth ?? 8, height: options.resizeHeight ?? 8,
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
