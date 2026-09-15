import { sniff, type InputKind, type OutputFormat } from './formats';
import { outputName } from './names';
import { buildZip } from './zip';
import type { ConversionError, ConvertRequest, WorkerResponse } from './pipeline';

export type Job = {
  id: string; attempt: number; file: File; name: string; bytes: number;
  kind: InputKind | 'unrecognized';
  status: 'queued' | 'converting' | 'done' | 'failed' | 'awaiting-downscale';
  phase?: 'loading-codec' | 'converting';
  thumbnailUrl?: string;
  result?: { blob: Blob; url: string; bytes: number; width: number; height: number; downscaled: boolean };
  error?: ConversionError;
};
export type ZipState = { status: 'idle' | 'preparing' | 'ready'; url?: string };

export function createQueue({ worker, maxArea }: { worker: Worker; maxArea: number | null }) {
  let jobs = $state<Job[]>([]);
  let format = $state<OutputFormat>('jpeg');
  let zip = $state<ZipState>({ status: 'idle' });
  let workerStatus = $state<{ status: 'starting' | 'ready' | 'unavailable' }>({ status: 'starting' });
  const fileCount = $derived(jobs.length);
  const bytesIn = $derived(jobs.reduce((sum, job) => sum + job.bytes, 0));
  const bytesOut = $derived(jobs.reduce((sum, job) => sum + (job.result?.bytes ?? 0), 0));
  const doneCount = $derived(jobs.filter(job => job.status === 'done').length);
  const failedCount = $derived(jobs.filter(job => job.status === 'failed' || job.status === 'awaiting-downscale').length);
  const settled = $derived(jobs.every(job => job.status !== 'queued' && job.status !== 'converting'));
  const reading = new Set<string>();
  const consent = new Set<string>();
  let inFlight: { id: string; attempt: number } | undefined;
  let zipRevision = 0;
  let disposed = false;

  function invalidateZip() {
    zipRevision++;
    if (zip.url) URL.revokeObjectURL(zip.url);
    zip = { status: 'idle' };
  }
  function dropResult(job: Job, thumbnail = false) {
    if (job.result) URL.revokeObjectURL(job.result.url);
    job.result = undefined;
    if (thumbnail && job.thumbnailUrl) {
      URL.revokeObjectURL(job.thumbnailUrl);
      job.thumbnailUrl = undefined;
    }
  }
  function prepareZip() {
    if (!settled || doneCount === 0 || zip.status !== 'idle' || disposed) return;
    const revision = zipRevision;
    const rows = jobs.filter(job => job.status === 'done').map(job => ({
      name: outputName(job.name, format), blob: job.result!.blob,
    }));
    zip = { status: 'preparing' };
    void buildZip(rows).then(blob => {
      if (revision === zipRevision && !disposed) {
        zip = { status: 'ready', url: URL.createObjectURL(blob) };
      }
    }).catch(() => {
      if (revision === zipRevision && !disposed) zip = { status: 'idle' };
    });
  }
  function dispatch() {
    if (disposed || inFlight || workerStatus.status === 'unavailable') return;
    const job = jobs.find(job => job.status === 'queued');
    if (!job) { prepareZip(); return; }
    if (reading.has(job.id)) return;
    job.status = 'converting'; job.phase = undefined;
    inFlight = { id: job.id, attempt: job.attempt };
    const message: ConvertRequest = { type: 'convert', ...inFlight, file: job.file,
      kind: job.kind as InputKind, format, maxArea, downscale: consent.has(job.id) };
    try { worker.postMessage(message); }
    catch { workerLost(); }
  }
  function advance() { queueMicrotask(() => { dispatch(); prepareZip(); }); }
  function workerLost() {
    workerStatus = { status: 'unavailable' };
    inFlight = undefined;
    for (const job of jobs) {
      if (job.status === 'queued' || job.status === 'converting') {
        job.status = 'failed'; job.error = { code: 'worker-lost' };
      }
    }
    prepareZip();
  }
  function receive({ data }: MessageEvent<WorkerResponse>) {
    if (disposed || workerStatus.status === 'unavailable'
      || data.id !== inFlight?.id || data.attempt !== inFlight.attempt) return;
    workerStatus = { status: 'ready' };
    const job = jobs.find(job => job.id === data.id && job.attempt === data.attempt);
    if (data.type === 'phase') { if (job) job.phase = data.phase; return; }
    inFlight = undefined;
    if (job) {
      job.phase = undefined;
      if (data.type === 'done') {
        dropResult(job, true);
        job.result = { blob: data.blob, url: URL.createObjectURL(data.blob), bytes: data.blob.size,
          width: data.width, height: data.height, downscaled: data.downscaled };
        job.thumbnailUrl = URL.createObjectURL(data.thumbnail);
        job.status = 'done'; job.error = undefined;
      } else {
        job.error = { code: data.code, pixels: data.pixels, limit: data.limit };
        job.status = data.code === 'too-large' && data.limit !== undefined && !consent.has(job.id)
          ? 'awaiting-downscale' : 'failed';
      }
    }
    advance();
  }
  worker.addEventListener('message', receive);
  worker.addEventListener('error', workerLost);

  async function add(files: Iterable<File>) {
    if (disposed) return;
    invalidateZip();
    const added = Array.from(files, file => {
      const id = crypto.randomUUID();
      reading.add(id);
      return { id, attempt: 0, file, name: file.name, bytes: file.size,
        kind: 'unrecognized', status: 'queued' } satisfies Job;
    });
    jobs.push(...added);
    // Only bounded headers are read here, sequentially. Full files wait for dispatch.
    for (const entry of added) {
      let kind: InputKind | null = null;
      try { kind = sniff(new Uint8Array(await entry.file.slice(0, 4096).arrayBuffer())); }
      catch { /* Unreadable headers have the same user action as unknown inputs. */ }
      reading.delete(entry.id);
      const job = jobs.find(job => job.id === entry.id);
      if (!job) continue;
      job.kind = kind ?? 'unrecognized';
      if (workerStatus.status === 'unavailable') {
        job.status = 'failed'; job.error = { code: 'worker-lost' };
      } else if (!kind) {
        job.status = 'failed'; job.error = { code: 'unrecognized' };
      }
      advance();
    }
  }
  function remove(id: string) {
    invalidateZip();
    const job = jobs.find(job => job.id === id);
    if (job) dropResult(job, true);
    jobs = jobs.filter(job => job.id !== id);
    consent.delete(id);
    advance();
  }
  function clear() {
    invalidateZip();
    jobs.forEach(job => dropResult(job, true));
    jobs = [];
    consent.clear();
  }
  function setFormat(id: OutputFormat) {
    if (id === format) return;
    invalidateZip();
    format = id;
    consent.clear();
    for (const job of jobs) {
      dropResult(job);
      job.attempt++;
      job.error = undefined;
      job.status = 'queued';
      if (workerStatus.status === 'unavailable' || (job.kind === 'unrecognized' && !reading.has(job.id))) {
        job.status = 'failed';
        job.error = { code: workerStatus.status === 'unavailable' ? 'worker-lost' : 'unrecognized' };
      }
    }
    advance();
  }
  function convertDownscaled(id: string) {
    const job = jobs.find(job => job.id === id);
    if (!job || job.status !== 'awaiting-downscale' || workerStatus.status === 'unavailable') return;
    invalidateZip();
    consent.add(id);
    job.attempt++;
    job.error = undefined;
    job.status = 'queued';
    advance();
  }
  function dispose() {
    disposed = true;
    clear();
    worker.removeEventListener('message', receive);
    worker.removeEventListener('error', workerLost);
    worker.terminate();
  }
  return {
    get jobs() { return jobs; }, get format() { return format; }, get zip() { return zip; },
    get workerStatus() { return workerStatus; }, get fileCount() { return fileCount; },
    get bytesIn() { return bytesIn; }, get bytesOut() { return bytesOut; },
    get doneCount() { return doneCount; }, get failedCount() { return failedCount; },
    get settled() { return settled; }, add, remove, clear, setFormat, convertDownscaled, dispose,
  };
}
