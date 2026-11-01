import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueue } from './queue.svelte';
import { SERVER_URL } from './server';
import type { CancelRequest, ConvertRequest, WorkerRequest, WorkerResponse } from './pipeline';

class FakeWorker extends EventTarget {
  requests: ConvertRequest[] = [];
  cancels: CancelRequest[] = [];
  terminated = false;
  postMessage(message: WorkerRequest) {
    if (message.type === 'cancel') { this.cancels.push(message); return; }
    this.requests.push(message);
  }
  terminate() { this.terminated = true; }
  send(message: WorkerResponse) { this.dispatchEvent(new MessageEvent('message', { data: message })); }
  done(request = this.requests.at(-1)!, where: 'server' | 'device' = 'device', withThumbnail = true) {
    this.send({ type: 'done', id: request.id, attempt: request.attempt,
      blob: new Blob(['converted']), ...(withThumbnail ? { thumbnail: new Blob(['thumbnail']) } : {}),
      width: 640, height: 480, downscaled: request.downscale, where });
  }
  tooLarge(request = this.requests.at(-1)!, limit: number | undefined = 16e6) {
    this.send({ type: 'error', id: request.id, attempt: request.attempt,
      code: 'too-large', pixels: 48e6, limit });
  }
}
const file = (name = 'photo.jpg') => new File([new Uint8Array([255, 216, 255, 224])], name);
const turn = () => new Promise(resolve => setTimeout(resolve, 0));
let worker: FakeWorker;
let queue: ReturnType<typeof createQueue>;
let urls: Map<string, Blob>;
let nextUrl: number;
beforeEach(() => {
  urls = new Map(); nextUrl = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
    const url = `blob:test-${nextUrl++}`; urls.set(url, blob as Blob); return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => { urls.delete(url); });
  worker = new FakeWorker();
  queue = createQueue({ worker: worker as unknown as Worker, maxArea: 16e6 });
});
afterEach(() => { queue.dispose(); vi.restoreAllMocks(); });

describe('queue state and worker boundary', () => {
  it('exposes the worker phase on the converting job and clears it on settle', async () => {
    await queue.add([file('photo.heic')]); await turn();
    const request = worker.requests.at(-1)!;
    worker.send({ type: 'phase', id: request.id, attempt: request.attempt, phase: 'loading-codec' });
    expect(queue.jobs[0].phase).toBe('loading-codec');
    worker.done(request);
    expect(queue.jobs[0].phase).toBeUndefined();
  });
  it('only moves a phase forward within an attempt, and starts fresh on a new attempt', async () => {
    await queue.add([file()]); await turn();
    const request = worker.requests.at(-1)!;
    worker.send({ type: 'phase', id: request.id, attempt: request.attempt, phase: 'loading-codec' });
    expect(queue.jobs[0].phase).toBe('loading-codec');
    worker.send({ type: 'phase', id: request.id, attempt: request.attempt, phase: 'converting' });
    expect(queue.jobs[0].phase).toBe('converting');
    // An output encoder loading after the decode must not rewind the phase.
    worker.send({ type: 'phase', id: request.id, attempt: request.attempt, phase: 'loading-codec' });
    expect(queue.jobs[0].phase).toBe('converting');
    worker.done(request);
    expect(queue.jobs[0].phase).toBeUndefined();
    queue.setFormat('png'); await turn();
    const next = worker.requests.at(-1)!;
    expect(next.attempt).toBe(request.attempt + 1);
    worker.send({ type: 'phase', id: next.id, attempt: next.attempt, phase: 'loading-codec' });
    expect(queue.jobs[0].phase).toBe('loading-codec');
  });
  it('adds duplicate files as separate queued jobs and dispatches only one', async () => {
    const input = file();
    const adding = queue.add([input, input]);
    expect(queue.jobs.map(job => job.status)).toEqual(['queued', 'queued']);
    expect(queue.jobs[0].id).not.toBe(queue.jobs[1].id);
    await adding; await turn();
    expect(queue.jobs.map(job => job.status)).toEqual(['converting', 'queued']);
    expect(queue.fileCount).toBe(2);
    expect(queue.bytesIn).toBe(8);
    const first = worker.requests[0];
    worker.done(first); await turn();
    expect(queue.jobs.map(job => job.status)).toEqual(['done', 'converting']);
    expect(worker.requests.at(-1)?.id).toBe(queue.jobs[1].id);
    expect(queue.jobs[0].result).toMatchObject({ bytes: 9, width: 640, height: 480, downscaled: false });
    expect(await queue.jobs[0].result!.blob.text()).toBe('converted');
    expect(urls.get(queue.jobs[0].thumbnailUrl!)?.size).toBe(9);
    expect(queue.workerStatus.status).toBe('ready');
    expect(queue.doneCount).toBe(1);
    expect(queue.bytesOut).toBe(9);
    expect(queue.settled).toBe(false);
  });
  it('fails zero-byte and text files from bytes, regardless of MIME or extension', async () => {
    await queue.add([new File([], 'zero.jpg'), new File(['hello'], 'fake.heic', { type: 'image/heic' })]);
    await turn();
    expect(queue.jobs.map(job => [job.kind, job.status, job.error?.code]))
      .toEqual([['unrecognized', 'failed', 'unrecognized'], ['unrecognized', 'failed', 'unrecognized']]);
    expect(queue.failedCount).toBe(2);
    expect(queue.settled).toBe(true);
    expect(queue.zip.status).toBe('idle');
    queue.setFormat('png'); await turn();
    expect(queue.jobs.every(job => job.status === 'failed')).toBe(true);
  });
  it('ignores old attempts on format switch and waits for the occupied worker', async () => {
    await queue.add([file(), file('second.jpg')]); await turn();
    const old = worker.requests[0];
    queue.setFormat('png');
    expect(queue.jobs.map(job => [job.status, job.attempt])).toEqual([['queued', 1], ['queued', 1]]);
    await turn();
    expect(queue.jobs.every(job => job.status === 'queued')).toBe(true);
    worker.done(old); await turn();
    expect(queue.jobs.map(job => job.status)).toEqual(['converting', 'queued']);
    expect(queue.jobs[0].result).toBeUndefined();
    expect(worker.requests.at(-1)).toMatchObject({ format: 'png', attempt: 1 });
    worker.done(old); await turn();
    expect(queue.jobs[0].status).toBe('converting');
    worker.done(); await turn();
    expect(queue.jobs[0].status).toBe('done');
  });
  it('ignores a removed in-flight result, then processes the next row', async () => {
    await queue.add([file(), file()]); await turn();
    const old = worker.requests[0];
    queue.remove(old.id);
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0].status).toBe('queued');
    worker.done(old); await turn();
    expect(queue.jobs[0].status).toBe('converting');
    expect(queue.jobs[0].result).toBeUndefined();
    expect(urls.size).toBe(0);
  });
  it('requires downscale consent, then starts a new attempt and resets consent on format change', async () => {
    await queue.add([file()]); await turn();
    worker.tooLarge(); await turn();
    const job = queue.jobs[0];
    expect(job.status).toBe('awaiting-downscale');
    expect(job.error).toMatchObject({ code: 'too-large', pixels: 48e6, limit: 16e6 });
    expect(queue.failedCount).toBe(1);
    queue.convertDownscaled(job.id);
    expect(job.status).toBe('queued');
    await turn();
    expect(worker.requests.at(-1)).toMatchObject({ downscale: true, attempt: 1 });
    worker.done(); await turn();
    expect(job.result?.downscaled).toBe(true);
    queue.setFormat('png'); await turn();
    expect(worker.requests.at(-1)?.downscale).toBe(false);
    worker.tooLarge(); await turn();
    expect(job.status).toBe('awaiting-downscale');
    queue.convertDownscaled(job.id); await turn();
    worker.tooLarge(); await turn();
    expect(job.status).toBe('failed');
  });
  it('does not offer downscale when there is no measured limit', async () => {
    await queue.add([file()]); await turn();
    const request = worker.requests[0];
    worker.send({ type: 'error', id: request.id, attempt: request.attempt, code: 'too-large' });
    await turn();
    expect(queue.jobs[0].status).toBe('failed');
    queue.convertDownscaled(request.id);
    expect(queue.jobs[0].status).toBe('failed');
  });
  it('marks queued and converting jobs worker-lost and keeps completed results', async () => {
    await queue.add([file(), file(), file()]); await turn();
    worker.done(); await turn();
    worker.dispatchEvent(new Event('error'));
    expect(queue.jobs.map(job => job.status)).toEqual(['done', 'failed', 'failed']);
    expect(queue.jobs.slice(1).map(job => job.error?.code)).toEqual(['worker-lost', 'worker-lost']);
    expect(queue.workerStatus.status).toBe('unavailable');
    expect(queue.settled).toBe(true);
    worker.done(); await turn();
    expect(queue.doneCount).toBe(1);
    await queue.add([file()]);
    expect(queue.jobs.at(-1)?.error?.code).toBe('worker-lost');
  });
  it('builds a real zip on settle and revokes zip/results when changed', async () => {
    await queue.add([file(), new File(['text'], 'bad')]); await turn();
    worker.done();
    await vi.waitFor(() => expect(queue.zip.status).toBe('ready'));
    const zipUrl = queue.zip.url!;
    const resultUrl = queue.jobs[0].result!.url;
    const thumbnailUrl = queue.jobs[0].thumbnailUrl!;
    const archive = new Uint8Array(await urls.get(zipUrl)!.arrayBuffer());
    expect(Array.from(archive.slice(0, 4))).toEqual([80, 75, 3, 4]);
    expect(new TextDecoder().decode(archive)).toContain('photo.jpg');
    queue.setFormat('png');
    expect(queue.zip.status).toBe('idle');
    expect(urls.has(zipUrl)).toBe(false);
    expect(urls.has(resultUrl)).toBe(false);
    expect(urls.has(thumbnailUrl)).toBe(true);
    expect(queue.jobs[0].result).toBeUndefined();
    await turn(); worker.done();
    await vi.waitFor(() => expect(queue.zip.status).toBe('ready'));
    const nextZip = queue.zip.url!;
    queue.remove(queue.jobs[1].id);
    expect(urls.has(nextZip)).toBe(false);
    queue.clear(); await turn();
    expect(queue.jobs).toEqual([]);
    expect(queue.zip.status).toBe('idle');
    expect(urls.size).toBe(0);
  });
  it('sends smaller in every convert request and restarts every job when it changes on jpeg', async () => {
    await queue.add([file(), file('second.jpg')]); await turn();
    const old = worker.requests[0];
    expect(worker.requests.at(-1)).toMatchObject({ smaller: false });
    worker.done(old); await turn();
    expect(queue.jobs.map(job => job.status)).toEqual(['done', 'converting']);
    queue.setSmaller(true);
    expect(queue.smaller).toBe(true);
    expect(queue.jobs.map(job => [job.status, job.attempt, job.result]))
      .toEqual([['queued', 1, undefined], ['queued', 1, undefined]]);
    await turn();
    expect(queue.jobs.every(job => job.status === 'queued')).toBe(true);
    worker.done(); await turn();
    expect(worker.requests.at(-1)).toMatchObject({ smaller: true, attempt: 1, format: 'jpeg' });
    worker.done(); await turn();
    expect(queue.jobs[0].status).toBe('done');
    queue.setSmaller(false);
    expect(queue.smaller).toBe(false);
    expect(queue.jobs.map(job => [job.status, job.attempt])).toEqual([['queued', 2], ['queued', 2]]);
    await turn();
    worker.done(); await turn();
    expect(worker.requests.at(-1)).toMatchObject({ smaller: false, attempt: 2 });
  });
  it('only records smaller when another format is selected, and sends it once that format is picked', async () => {
    await queue.add([file()]); await turn();
    worker.done(); await turn();
    queue.setFormat('webp'); await turn();
    const attempt = queue.jobs[0].attempt;
    worker.done(); await turn();
    queue.setSmaller(true);
    expect(queue.jobs[0].attempt).toBe(attempt);
    expect(queue.jobs[0].status).toBe('done');
    expect(worker.requests).toHaveLength(2);
    queue.setFormat('png'); await turn();
    expect(worker.requests.at(-1)).toMatchObject({ format: 'png', smaller: true, attempt: attempt + 1 });
  });
  it('discards a pending zip after clear and releases the owned worker on dispose', async () => {
    await queue.add([file()]); await turn();
    worker.done();
    await Promise.resolve();
    expect(queue.zip.status).toBe('preparing');
    queue.clear(); await turn();
    expect(queue.zip.status).toBe('idle');
    expect(urls.size).toBe(0);
    queue.dispose();
    expect(worker.terminated).toBe(true);
  });
});

describe('server mode', () => {
  it('defaults to device mode and sends server: null in every request', async () => {
    expect(queue.mode).toBe('device');
    await queue.add([file()]); await turn();
    expect(worker.requests[0].server).toBeNull();
    worker.done(); await turn();
    expect(queue.jobs[0].result?.where).toBe('device');
  });
  it('setMode restarts every job and sends SERVER_URL in server mode', async () => {
    await queue.add([file(), file('second.jpg')]); await turn();
    const old = worker.requests[0];
    queue.setMode('server');
    expect(queue.mode).toBe('server');
    expect(queue.jobs.map(job => [job.status, job.attempt, job.result]))
      .toEqual([['queued', 1, undefined], ['queued', 1, undefined]]);
    await turn();
    expect(worker.requests).toHaveLength(1); // the old in-flight attempt still occupies the worker
    worker.done(old); await turn(); // stale attempt-0 result ignored, new attempt dispatched
    expect(worker.requests.at(-1)).toMatchObject({ server: SERVER_URL, attempt: 1 });
    worker.done(); await turn();
    worker.done(undefined, 'server'); await turn();
    expect(queue.jobs.map(job => [job.status, job.result?.where]))
      .toEqual([['done', 'device'], ['done', 'server']]);
    queue.setMode('device');
    expect(queue.mode).toBe('device');
    await turn();
    expect(worker.requests.at(-1)).toMatchObject({ server: null, attempt: 2 });
    queue.setMode('device'); // no-op
    expect(queue.jobs[0].attempt).toBe(2);
  });
  it('sends smaller: false in server mode even when the preference is on', async () => {
    await queue.add([file()]); await turn();
    const first = worker.requests[0];
    worker.done(first); await turn();
    queue.setSmaller(true); await turn();
    const second = worker.requests.at(-1)!;
    expect(second).toMatchObject({ smaller: true, server: null });
    queue.setMode('server');
    worker.done(second); await turn(); // stale attempt-1 answer releases the dispatch
    expect(worker.requests.at(-1)).toMatchObject({ server: SERVER_URL, smaller: false, attempt: 2 });
  });
  it('accepts the waiting phase and lets it interleave with converting', async () => {
    await queue.add([file()]); await turn();
    const request = worker.requests[0];
    worker.send({ type: 'phase', id: request.id, attempt: request.attempt, phase: 'converting' });
    expect(queue.jobs[0].phase).toBe('converting');
    worker.send({ type: 'phase', id: request.id, attempt: request.attempt, phase: 'waiting' });
    expect(queue.jobs[0].phase).toBe('waiting');
    worker.send({ type: 'phase', id: request.id, attempt: request.attempt, phase: 'converting' });
    expect(queue.jobs[0].phase).toBe('converting');
    worker.send({ type: 'phase', id: request.id, attempt: request.attempt, phase: 'waiting' });
    expect(queue.jobs[0].phase).toBe('waiting');
    // loading-codec may not rewind a waiting or converting phase.
    worker.send({ type: 'phase', id: request.id, attempt: request.attempt, phase: 'loading-codec' });
    expect(queue.jobs[0].phase).toBe('waiting');
    worker.done(); await turn();
    expect(queue.jobs[0].phase).toBeUndefined();
  });
  it('stores where on the result and tolerates a missing thumbnail', async () => {
    await queue.add([file()]); await turn();
    const request = worker.requests[0];
    worker.done(request, 'server', false);
    await turn();
    expect(queue.jobs[0].status).toBe('done');
    expect(queue.jobs[0].result?.where).toBe('server');
    expect(queue.jobs[0].thumbnailUrl).toBeUndefined();
  });
  it('sends cancel for the in-flight job on setFormat, setMode, remove and clear', async () => {
    await queue.add([file(), file('second.jpg')]); await turn();
    const first = worker.requests[0];
    queue.setFormat('png');
    expect(worker.cancels).toEqual([{ type: 'cancel', id: first.id, attempt: first.attempt }]);
    worker.done(first); await turn(); // the stale answer releases the dispatch
    const second = worker.requests.at(-1)!;
    queue.setMode('server');
    expect(worker.cancels.at(-1)).toEqual({ type: 'cancel', id: second.id, attempt: second.attempt });
    worker.done(second); await turn();
    const third = worker.requests.at(-1)!;
    queue.remove(third.id);
    expect(worker.cancels.at(-1)).toEqual({ type: 'cancel', id: third.id, attempt: third.attempt });
    worker.done(third); await turn();
    await queue.add([file('third.jpg')]); await turn();
    const fourth = worker.requests.at(-1)!;
    queue.clear();
    expect(worker.cancels.at(-1)).toEqual({ type: 'cancel', id: fourth.id, attempt: fourth.attempt });
  });
});
