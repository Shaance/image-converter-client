import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { convertOnServer, SERVER_URL, serverEligible, serverPath, type ServerOutcome } from './server';
import type { InputKind, OutputFormat } from './formats';

// A file whose File.type deliberately disagrees with the sniffed kind, like an
// iOS-mislabeled photo: the upload must use the kind's MIME instead.
const file = (name = 'photo.jpg', type = 'application/octet-stream') => new File(['img bytes'], name, { type });
const ok = (body = 'result bytes', type = 'image/png') =>
  new Response(new Blob([body], { type }), { status: 200, headers: { 'content-type': type, 'cache-control': 'no-store' } });
const status = (code: number, headers: Record<string, string> = {}) =>
  new Response(null, { status: code, headers });

let fetchMock: ReturnType<typeof vi.fn>;
let phases: string[];
const phase = (p: 'waiting' | 'converting') => { phases.push(p); };
const call = (over: { kind?: InputKind; format?: OutputFormat; server?: string; f?: File; signal?: AbortSignal } = {}) =>
  convertOnServer({
    server: over.server ?? SERVER_URL,
    file: over.f ?? file(),
    kind: over.kind ?? 'jpeg',
    format: over.format ?? 'png',
    phase,
    signal: over.signal,
  });

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  phases = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('defaults SERVER_URL to the production converter without a trailing slash', () => {
  expect(SERVER_URL).toBe('https://convert.hashcode.dev');
});

describe('eligibility and paths', () => {
  it.each([
    ['jpeg', '/unsafe/filters:format(jpeg):quality(90)/'],
    ['webp', '/unsafe/filters:format(webp):quality(85)/'],
    ['avif', '/unsafe/filters:format(avif):quality(50)/'],
    ['jxl', '/unsafe/filters:format(jxl):quality(75)/'],
    ['png', '/unsafe/filters:format(png)/'],
    ['gif', '/unsafe/filters:format(gif)/'],
    ['tiff', '/unsafe/filters:format(tiff)/'],
  ] as [OutputFormat, string][])('builds the %s path as %s', (format, path) => {
    expect(serverPath(format)).toBe(path);
  });
  it.each([
    ['jpeg', 'png', true], ['heic', 'jxl', true], ['avif', 'tiff', true],
    ['raw', 'png', false], ['bmp', 'png', false], ['jpeg', 'pdf', false],
  ] as [InputKind, OutputFormat, boolean][])('eligibility of %s → %s is %s', (kind, format, expected) => {
    expect(serverEligible(kind, format)).toBe(expected);
  });
});

describe('request shape', () => {
  it.each([
    ['jpeg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp'],
    ['gif', 'image/gif'], ['avif', 'image/avif'], ['heic', 'image/heic'],
  ] as [InputKind, string][])('uploads a %s file as %s, not File.type', async (kind, mime) => {
    fetchMock.mockResolvedValue(ok());
    await call({ kind, f: file('photo.bin', 'image/heic') });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${SERVER_URL}/unsafe/filters:format(png)/`);
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('omit');
    expect(init.mode).toBe('cors');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    const entries = Array.from(body.entries());
    expect(entries.map(([key]) => key)).toEqual(['image']);
    const part = entries[0][1] as File;
    expect(part).toBeInstanceOf(Blob);
    expect(part.type).toBe(mime);
    expect(part.name).toBe('photo.bin');
  });
  it('returns the 200 blob typed with the output MIME', async () => {
    fetchMock.mockResolvedValue(ok('converted!', 'image/webp'));
    const result = await call({ format: 'webp' });
    expect(result).toEqual({ blob: expect.any(Blob) });
    const blob = (result as { blob: Blob }).blob;
    expect(blob.type).toBe('image/webp');
    expect(await blob.text()).toBe('converted!');
  });
  it('falls back without a request for kinds with no upload MIME', async () => {
    expect(await call({ kind: 'raw' })).toEqual({ fallback: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('retry and fallback', () => {
  it('treats 408 (busy) like 429: backs off, waits, then retries', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1); // first backoff wait = 1000 ms
    fetchMock.mockResolvedValueOnce(status(408, { 'content-type': 'application/json' }))
      .mockResolvedValueOnce(ok());
    const promise = call();
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await promise).toEqual({ blob: expect.any(Blob) });
    expect(phases).toEqual(['converting', 'waiting', 'converting']);
  });
  it('waits Retry-After seconds on a 429, then retries', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(status(429, { 'retry-after': '3' })).mockResolvedValueOnce(ok());
    const promise = call();
    await vi.advanceTimersByTimeAsync(2999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await promise).toEqual({ blob: expect.any(Blob) });
    expect(phases).toEqual(['converting', 'waiting', 'converting']);
  });
  it('accepts an HTTP-date Retry-After', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    fetchMock.mockResolvedValueOnce(status(503, { 'retry-after': new Date(1_700_000_000_000 + 5000).toUTCString() }))
      .mockResolvedValueOnce(ok());
    const promise = call();
    await vi.advanceTimersByTimeAsync(4999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await promise).toEqual({ blob: expect.any(Blob) });
  });
  it('backs off with capped full jitter on a 503 and falls back within the 90 s budget', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1); // every wait at its cap
    const times: number[] = [];
    fetchMock.mockImplementation(() => {
      times.push(Date.now());
      return Promise.resolve(status(503));
    });
    const promise = call();
    await vi.advanceTimersByTimeAsync(200_000);
    expect(await promise).toEqual({ fallback: true });
    // 1 s, 2 s, 4 s, 8 s, then the 15 s cap: 8 waits totalling 75 s; the 9th
    // attempt starts at t=75 s but no further wait fits the 90 s wall-clock
    // budget, and no new attempt starts once elapsed reaches 90 s.
    const waits = times.slice(1).map((t, i) => t - times[i]);
    expect(waits).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000, 15000]);
    expect(waits.every(w => w >= 0 && w <= 15_000)).toBe(true);
    expect(waits.reduce((a, b) => a + b, 0)).toBe(75_000);
    expect(fetchMock).toHaveBeenCalledTimes(9);
    expect(phases.filter(p => p === 'waiting')).toHaveLength(9);
  });
  it('stays within [0, cap] with jitter below 1 and still respects the budget', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const times: number[] = [];
    fetchMock.mockImplementation(() => {
      times.push(Date.now());
      return Promise.resolve(status(429));
    });
    const promise = call();
    await vi.advanceTimersByTimeAsync(200_000);
    expect(await promise).toEqual({ fallback: true });
    const waits = times.slice(1).map((t, i) => t - times[i]);
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.every(w => w >= 0 && w <= 15_000)).toBe(true);
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(90_000);
  });
  it('falls back when reading the 200 body fails', async () => {
    const response = new Response(new Blob(['partial']), { status: 200 });
    vi.spyOn(response, 'blob').mockRejectedValue(new TypeError('connection dropped mid-body'));
    fetchMock.mockResolvedValue(response);
    expect(await call()).toEqual({ fallback: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(['converting']);
  });
  it('falls back once 90 s of wall-clock time have passed against a server that answers 408 only after a 30 s delay', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(1); // deterministic backoff: 1 s, 2 s, 4 s, ...
    const times: number[] = [];
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      times.push(Date.now());
      // imagor holds a queued request for its 30 s request timeout, then answers 408.
      const timer = setTimeout(() => resolve(status(408)), 30_000);
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal!.reason); }, { once: true });
    }));
    let doneAt = -1;
    const promise = call().then(result => { doneAt = Date.now(); return result; });
    await vi.advanceTimersByTimeAsync(400_000);
    expect(await promise).toEqual({ fallback: true });
    // Attempts at t=0, 31 s, 63 s; the third is aborted by its budget-capped
    // timeout at exactly t=90 s.
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
    expect(doneAt - times[0]).toBeLessThanOrEqual(90_000); // strict wall-clock budget
    expect(phases.filter(p => p === 'waiting')).toHaveLength(2);
  });
  it.each([413, 406, 415, 422, 500, 502])('falls back immediately on %s without retrying', async code => {
    fetchMock.mockResolvedValue(status(code));
    expect(await call()).toEqual({ fallback: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(['converting']);
  });
  it('falls back exactly when the 60 s per-attempt timeout fires', async () => {
    vi.useFakeTimers();
    // The mocked fetch stays pending until its own signal aborts.
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    let settled: ServerOutcome | undefined;
    const promise = call().then(result => { settled = result; });
    await vi.advanceTimersByTimeAsync(59_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(settled).toBeUndefined(); // still waiting one tick before the deadline
    await vi.advanceTimersByTimeAsync(1);
    await promise;
    expect(settled).toEqual({ fallback: true }); // aborted at the 60 s deadline
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('a cancel during the backoff sleep throws without any further fetch', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(status(429, { 'retry-after': '30' }));
    const promise = call({ signal: controller.signal });
    await vi.advanceTimersByTimeAsync(1); // first attempt answered 429, now sleeping
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(phases).toEqual(['converting', 'waiting']);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(120_000); // never uploads again
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('a cancel during the fetch aborts it and throws instead of falling back', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    const promise = call({ signal: controller.signal });
    expect(fetchMock).toHaveBeenCalledTimes(1); // the upload started
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('falls back on a network/CORS error', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await call()).toEqual({ fallback: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
