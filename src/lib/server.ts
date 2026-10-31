import { kindMime, OUTPUT_FORMATS, type InputKind, type OutputFormat } from './formats';

// Server-mode config. VITE_SERVER_URL lets local and preview builds point at
// another imagor host; the default is the production converter.
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL ?? 'https://convert.hashcode.dev')
  .replace(/\/+$/, '');

// What the server can take and produce. RAW/BMP inputs and PDF output always
// convert on the device.
const SERVER_KINDS: ReadonlySet<InputKind> = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'heic']);
const SERVER_FORMATS: ReadonlySet<OutputFormat> = new Set(['jpeg', 'png', 'webp', 'avif', 'jxl', 'gif', 'tiff']);
export function serverEligible(kind: InputKind, format: OutputFormat): boolean {
  return SERVER_KINDS.has(kind) && SERVER_FORMATS.has(format);
}

// Server-side qualities, fixed by the server contract; png/gif/tiff send none.
const SERVER_QUALITY: Partial<Record<OutputFormat, number>> = { jpeg: 90, webp: 85, avif: 50, jxl: 75 };
export function serverPath(format: OutputFormat): string {
  const quality = SERVER_QUALITY[format];
  return quality === undefined
    ? `/unsafe/filters:format(${format})/`
    : `/unsafe/filters:format(${format}):quality(${quality})/`;
}

export type ServerOutcome = { blob: Blob } | { fallback: true };
type ServerPhase = (phase: 'waiting' | 'converting') => void;

const REQUEST_TIMEOUT_MS = 60_000;
// Wall-clock budget per file, counted from the first attempt (request time
// included, via Date.now()): a stuck server can never hold a file on the server
// path longer than this plus at most one in-flight 60 s request.
const WAIT_BUDGET_MS = 90_000;
const BACKOFF_START_MS = 1_000;
const BACKOFF_CAP_MS = 15_000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Retry-After as seconds or an HTTP-date, in milliseconds from now.
function retryAfterMs(response: Response): number | null {
  const value = response.headers.get('retry-after');
  if (!value) return null;
  const seconds = Number(value);
  if (value.trim() !== '' && Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

// Exponential backoff with full jitter, capped per wait. The 1 ms floor keeps
// a zero-jitter streak from busy-looping against a 429-ing server.
function backoffMs(attempt: number): number {
  const cap = Math.min(BACKOFF_CAP_MS, BACKOFF_START_MS * 2 ** attempt);
  return Math.max(1, Math.random() * cap);
}

// Uploads one file to the imagor server and returns the converted bytes.
// 408 (queued request that outlived imagor's 30 s request timeout), 429 and 503
// are retried while waiting; anything else (including timeouts, network/CORS
// errors and failed body reads) signals an immediate on-device fallback.
export async function convertOnServer({ server, file, kind, format, phase }: {
  server: string; file: File; kind: InputKind; format: OutputFormat; phase: ServerPhase;
}): Promise<ServerOutcome> {
  const url = server + serverPath(format);
  const mime = kindMime(kind);
  if (!mime) return { fallback: true };
  const outputMime = OUTPUT_FORMATS.find(f => f.id === format)!.mime;
  const start = Date.now();
  let attempt = 0;
  for (;;) {
    // Never start a new attempt once the wall-clock budget is spent.
    if (Date.now() - start >= WAIT_BUDGET_MS) return { fallback: true };
    const body = new FormData();
    // The part must carry the sniffed image/* MIME, never File.type.
    body.append('image', new Blob([file], { type: mime }), file.name);
    let response: Response;
    try {
      phase('converting');
      response = await fetch(url, {
        method: 'POST',
        credentials: 'omit',
        mode: 'cors',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body,
      });
    } catch {
      return { fallback: true }; // timeout, network or CORS failure
    }
    if (response.status === 200) {
      try {
        const bytes = await response.blob();
        return { blob: new Blob([bytes], { type: outputMime }) };
      } catch {
        return { fallback: true }; // body read failed: dropped connection, timeout mid-read
      }
    }
    if (response.status === 408 || response.status === 429 || response.status === 503) {
      const wait = retryAfterMs(response) ?? backoffMs(attempt);
      attempt++;
      if (Date.now() - start + wait > WAIT_BUDGET_MS) return { fallback: true };
      phase('waiting');
      await sleep(wait);
      continue;
    }
    return { fallback: true };
  }
}
