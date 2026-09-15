import { OUTPUT_FORMATS, type OutputFormat } from './formats';

export function outputName(inputName: string, format: OutputFormat): string {
  const name = inputName.replace(/[\\/]/g, '');
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem}.${OUTPUT_FORMATS.find(f => f.id === format)!.extension}`;
}

export function uniqueNames(names: string[]): string[] {
  const reserved = new Set(names);
  const used = new Set<string>();
  return names.map(name => {
    let candidate = name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : '';
    if (used.has(candidate)) {
      let n = 2;
      do { candidate = `${stem} (${n++})${extension}`; }
      while (reserved.has(candidate) || used.has(candidate));
    }
    used.add(candidate);
    return candidate;
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const unit = Math.min(Math.floor(Math.log10(bytes) / 3), 3);
  return `${(bytes / 1000 ** unit).toFixed(1)} ${['B', 'kB', 'MB', 'GB'][unit]}`;
}
