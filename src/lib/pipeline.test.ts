import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { convert, encode, type ConvertRequest } from './pipeline';

vi.mock('@jsquash/webp/encode.js', () => ({
  default: async () => new TextEncoder().encode('fallback WebP').buffer,
}));
let canvases: FakeCanvas[];
let bitmaps: { width: number; height: number; closed: boolean; close(): void }[];
let nativeMime: string;
let encodeFailure: boolean;
class FakeCanvas {
  constructor(public width: number, public height: number) { canvases.push(this); }
  getContext() {
    return { fillStyle: '', fillRect() {}, drawImage() {},
      getImageData: () => ({ data: new Uint8ClampedArray([200, 100, 50, 128]), width: 1, height: 1 }) };
  }
  async convertToBlob({ type }: { type: string }) {
    if (encodeFailure) throw new Error('encode failed');
    return new Blob(['native'], { type: type === 'image/webp' ? nativeMime : type });
  }
}
const request: ConvertRequest = { type: 'convert', id: 'one', attempt: 0,
  file: new File(['image'], 'image.jpg'), kind: 'jpeg', format: 'png', maxArea: 16, downscale: false };
beforeEach(() => {
  canvases = []; bitmaps = []; nativeMime = 'image/webp'; encodeFailure = false;
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
