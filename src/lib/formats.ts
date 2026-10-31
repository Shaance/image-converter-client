export const OUTPUT_FORMATS = [
  { id: 'jpeg', label: 'JPEG', mime: 'image/jpeg', extension: 'jpg' },
  { id: 'png', label: 'PNG', mime: 'image/png', extension: 'png' },
  { id: 'webp', label: 'WebP', mime: 'image/webp', extension: 'webp' },
  { id: 'avif', label: 'AVIF', mime: 'image/avif', extension: 'avif' },
  { id: 'jxl', label: 'JPEG XL', mime: 'image/jxl', extension: 'jxl' },
  { id: 'pdf', label: 'PDF', mime: 'application/pdf', extension: 'pdf' },
  { id: 'gif', label: 'GIF', mime: 'image/gif', extension: 'gif' },
  { id: 'tiff', label: 'TIFF', mime: 'image/tiff', extension: 'tiff' },
] as const;
export type OutputFormat = typeof OUTPUT_FORMATS[number]['id'];
export type InputKind = 'heic' | 'jpeg' | 'png' | 'webp' | 'gif' | 'bmp' | 'avif' | 'raw';

// The single-threaded JXL wasm heap is fixed at 2 GB; larger encodes abort.
export const JXL_MAX_PIXELS = 20_000_000;
// The wlibraw wasm heap is fixed at 2 GB too; a 101 MP decode used ~1.5 GB, so
// RAW input stops at 110 MP.
export const RAW_MAX_PIXELS = 110_000_000;

export function sniff(header: Uint8Array): InputKind | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => header[i] === b);
  const text = (start: number, end: number) =>
    String.fromCharCode(...header.subarray(start, end));
  if (starts(0xff, 0xd8, 0xff)) return 'jpeg';
  if (starts(137, 80, 78, 71, 13, 10, 26, 10)) return 'png';
  if (text(0, 4) === 'RIFF' && text(8, 12) === 'WEBP') return 'webp';
  if (['GIF87a', 'GIF89a'].includes(text(0, 6))) return 'gif';
  if (starts(0x42, 0x4d)) return 'bmp';
  // TIFF-based RAW (CR2, NEF, ARW, DNG, PEF, SRW, IIQ, ...). A plain TIFF also
  // matches; LibRaw rejects it at decode time as not a raw file.
  if (starts(0x49, 0x49, 0x2a, 0x00) || starts(0x4d, 0x4d, 0x00, 0x2a)) return 'raw';
  if (starts(0x49, 0x49, 0x55, 0x00)) return 'raw'; // Panasonic RW2
  if (['IIRO', 'IIRS', 'MMOR'].includes(text(0, 4))) return 'raw'; // Olympus ORF
  if (text(0, 15) === 'FUJIFILMCCD-RAW') return 'raw'; // Fujifilm RAF
  if (header.length >= 16 && text(4, 8) === 'ftyp') {
    const size = new DataView(header.buffer, header.byteOffset, header.byteLength).getUint32(0);
    const end = size === 0 ? header.length : Math.min(size, header.length);
    if (end < 16) return null;
    const brands = [text(8, 12)];
    for (let i = 16; i + 4 <= end; i += 4) brands.push(text(i, i + 4));
    if (brands.some(b => b === 'crx ')) return 'raw'; // Canon CR3
    if (brands.some(b => ['avif', 'avis'].includes(b))) return 'avif';
    if (brands.some(b => ['heic', 'heix', 'hevc', 'mif1', 'msf1'].includes(b))) return 'heic';
  }
  return null;
}
