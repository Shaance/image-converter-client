export const OUTPUT_FORMATS = [
  { id: 'jpeg', label: 'JPEG', mime: 'image/jpeg', extension: 'jpg' },
  { id: 'png', label: 'PNG', mime: 'image/png', extension: 'png' },
  { id: 'webp', label: 'WebP', mime: 'image/webp', extension: 'webp' },
  { id: 'pdf', label: 'PDF', mime: 'application/pdf', extension: 'pdf' },
  { id: 'gif', label: 'GIF', mime: 'image/gif', extension: 'gif' },
  { id: 'tiff', label: 'TIFF', mime: 'image/tiff', extension: 'tiff' },
] as const;
export type OutputFormat = typeof OUTPUT_FORMATS[number]['id'];
export type InputKind = 'heic' | 'jpeg' | 'png' | 'webp' | 'gif' | 'bmp' | 'avif';

export function sniff(header: Uint8Array): InputKind | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => header[i] === b);
  const text = (start: number, end: number) =>
    String.fromCharCode(...header.subarray(start, end));
  if (starts(0xff, 0xd8, 0xff)) return 'jpeg';
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'png';
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'webp';
  if (['GIF87a', 'GIF89a'].includes(text(0, 6))) return 'gif';
  if (starts(0x42, 0x4d)) return 'bmp';
  if (header.length >= 16 && text(4, 8) === 'ftyp') {
    const size = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(0);
    const end = size === 0 ? header.length : Math.min(size, header.length);
    if (end < 16) return null;
    const brands = [text(8, 12)];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(text(i, i + 4));
    if (brands.some(b => ['avif', 'avis'].includes(b))) return 'avif';
    if (brands.some(b => ['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(b))) return 'heic';
  }
  return null;
}
