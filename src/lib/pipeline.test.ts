import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { convert, encode, type ConvertRequest } from './pipeline';

vi.mock('@jsquash/webp/encode.js', () => ({
  default: async () => new TextEncoder().encode('fallback WebP').buffer,
}));
const jsquash = vi.hoisted(() => ({
  avif: { init: vi.fn(async () => ({})), encode: vi.fn(async () => new TextEncoder().encode('AVIF bytes').buffer) },
  jxl: { init: vi.fn(async () => ({})), encode: vi.fn(async () => new TextEncoder().encode('JXL bytes').buffer) },
}));
vi.mock('@jsquash/avif/encode.js', () => ({ default: jsquash.avif.encode, init: jsquash.avif.init }));
vi.mock('@jsquash/jxl/encode.js', () => ({ default: jsquash.jxl.encode, init: jsquash.jxl.init }));
let canvases: FakeCanvas[];
let bitmaps: { width: number; height: number; closed: boolean; close(): void }[];
let nativeMime: string;
let encodeFailure: boolean;
class FakeCanvas {
  fillRectCalls = 0;
  convertToBlobCalls = 0;
  constructor(public width: number, public height: number) { canvases.push(this); }
  getContext() {
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
  file: new File(['image'], 'image.jpg'), kind: 'jpeg', format: 'png', maxArea: 16, downscale: false };
beforeEach(() => {
  canvases = []; bitmaps = []; nativeMime = 'image/webp'; encodeFailure = false;
  jsquash.avif.init.mockClear(); jsquash.avif.encode.mockClear();
  jsquash.jxl.init.mockClear(); jsquash.jxl.encode.mockClear();
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
