import { downloadZip } from 'client-zip';
import { uniqueNames } from './names';

export async function buildZip(rows: { name: string; blob: Blob }[]): Promise<Blob> {
  const names = uniqueNames(rows.map(row => row.name));
  return downloadZip(rows.map((row, i) => ({ name: names[i], input: row.blob }))).blob();
}
