import { describe, expect, it } from 'vitest';
import { OUTPUT_FORMATS, sniff } from './formats';
import { outputName, uniqueNames, formatBytes } from './names';

const bytes = (text: string) => new TextEncoder().encode(text);
function ftyp(major: string, ...compatible: string[]) {
  const header = new Uint8Array(16 + compatible.length * 4);
  new DataView(header.buffer).setUint32(0, header.length);
  header.set(bytes('ftyp' + major), 4);
  compatible.forEach((brand, i) => header.set(bytes(brand), 16 + i * 4));
  return header;
}

describe('magic bytes', () => {
  it.each([
    ['jpeg', new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0])],
    ['png', new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])],
    ['webp', new Uint8Array([82, 73, 70, 70, 26, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 32])],
    ['gif', bytes('GIF89a\x01\x00\x01\x00')],
    ['gif', bytes('GIF87a\x01\x00\x01\x00')],
    ['bmp', new Uint8Array([66, 77, 58, 0, 0, 0, 0, 0, 0, 0, 54, 0, 0, 0])],
    ['heic', ftyp('heic', 'mif1')],
    ['avif', ftyp('avif', 'mif1')],
    [null, new Uint8Array()],
    [null, bytes('This is a text file, not an image.')],
  ])('identifies %s without a filename or MIME type', (kind, header) => {
    expect(sniff(header as Uint8Array)).toBe(kind);
  });
  it.each(['heic', 'heix', 'hevc', 'mif1', 'msf1'])('recognizes HEIF brand %s', brand => {
    expect(sniff(ftyp(brand))).toBe('heic');
    expect(sniff(ftyp('xxxx', brand))).toBe('heic');
  });
  it.each(['avif', 'avis'])('prioritizes AVIF brand %s over generic HEIF', brand => {
    expect(sniff(ftyp('mif1', brand))).toBe('avif');
  });
  it('does not inspect bytes outside the ftyp box', () => {
    const header = ftyp('xxxx', 'heic');
    new DataView(header.buffer).setUint32(0, 16);
    expect(sniff(header)).toBeNull();
  });
  it('keeps the six output interfaces in the frozen order', () => {
    expect(OUTPUT_FORMATS.map(f => f.id)).toEqual(['jpeg', 'png', 'webp', 'pdf', 'gif', 'tiff']);
    expect(OUTPUT_FORMATS[0]).toEqual({ id: 'jpeg', label: 'JPEG', mime: 'image/jpeg', extension: 'jpg' });
  });
});

describe('download names', () => {
  it.each([
    ['photo.HEIC', 'photo.jpg'], ['photo', 'photo.jpg'], ['a.b.png', 'a.b.jpg'],
    ['.hidden', '.hidden.jpg'], ['a/b\\c.png', 'abc.jpg'],
    ['旅の写真 🌱.HEIC', '旅の写真 🌱.jpg'],
  ])('renames %s', (input, expected) => expect(outputName(input, 'jpeg')).toBe(expected));
  it('reserves original numbered names, even when they appear later', () => {
    expect(uniqueNames(['a.jpg', 'a.jpg', 'a (2).jpg', 'a.jpg', 'a (2).jpg']))
      .toEqual(['a.jpg', 'a (3).jpg', 'a (2).jpg', 'a (4).jpg', 'a (2) (2).jpg']);
  });
  it('handles extensionless and Unicode collisions without changing unique names', () => {
    expect(uniqueNames(['旅', '旅', '旅 (2)', 'a.png', 'a.jpg']))
      .toEqual(['旅', '旅 (3)', '旅 (2)', 'a.png', 'a.jpg']);
  });
  it('formats byte totals', () => {
    expect([0, 999, 1500, 1e6].map(formatBytes)).toEqual(['0 B', '999 B', '1.5 kB', '1.0 MB']);
  });
});
