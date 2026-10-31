# Image converter, on-device rebuild

Status: contract v2, 2026-09-15. Implements the three mocks on page 2 of the design
canvas (empty, busy, phone). Where this document and a mock disagree, this document
wins; the overrides are listed under "Mock overrides".

## Goal

A single-page web app at images.hashcode.dev that converts photos in the browser.
No account, no tracking. A mode switch offers "On device" (the default, files never
leave the device) and "Server" (each file is uploaded one at a time to an imagor
server at convert.hashcode.dev, which converts it and deletes it right away;
anything the server cannot do falls back to on-device conversion). Server mode is
a per-session choice and is always off on page load.

## Product decisions

- One journey: pick an output format (JPEG default), drop or pick files, every file
  converts immediately, each row gets its own download link, and one primary
  "Download all" zip link becomes available when the batch settles.
- No Convert button. Switching the output format while files are present starts a
  fresh attempt for every file and discards previous results.
- Input: HEIC/HEIF (primary image only), JPEG, PNG, WebP, GIF (first frame), BMP,
  AVIF where the browser decodes it, and camera RAW files (CR2, CR3, NEF, ARW,
  RAF, ORF, RW2, DNG and other LibRaw formats), decoded on the device. A file is
  identified by magic bytes (bounded header read), never by extension or
  `File.type` (iOS Safari 17 mislabels JPEGs as HEIC). RAW magics: TIFF
  `II*\0`/`MM\0*`, Panasonic `IIU\0`, Olympus `IIRO`/`IIRS`/`MMOR`, Fujifilm
  `FUJIFILMCCD-RAW`, and an ISO-BMFF `ftyp` box with the `crx ` brand (CR3).
  Animated inputs become one still frame.
- Output: JPEG, PNG, WebP, AVIF, JPEG XL, PDF, GIF, TIFF, the same eight in every
  supported browser and every state. Every gap is filled by a lazily loaded
  library, so no "unsupported format" state exists. BMP output is dropped.
- Output files carry no metadata (no EXIF, no GPS, no colour profile); the footer
  says so in one line. Transparency is flattened onto white for JPEG, PDF and GIF;
  PNG, WebP, AVIF, JPEG XL and TIFF keep alpha. JPEG quality 0.9, WebP quality 0.85,
  AVIF quality 50 / speed 6, JPEG XL quality 75 / effort 5. PDF: one
  page per file, page size = pixels / 300 per inch.
- "Smaller files" is an opt-in checkbox under the format chips (in both the empty
  and busy states), shown only when the selected output is JPEG or PNG. When on,
  JPEG is encoded with MozJPEG (quality 85, progressive) and PNG is the native PNG
  passed through OxiPNG (level 2, lossless); if the codec chunk, its init or the
  encode fails, the native encoder's result is used instead of failing the file.
  Off by default, not
  persisted across reloads. Changing it while JPEG or PNG is selected re-converts
  the batch exactly like a format change; on any other format it only records the
  value for when JPEG or PNG is picked.
- Supported browsers: `OffscreenCanvas`, `createImageBitmap`, module workers.
  API floors: Safari 16.4, Chrome 80, Firefox 114; product floor Safari 17 / iOS 17.
  Detection is synchronous feature checks plus the worker's `error` event. An
  unsupported browser sees one message in place of the drop zone: "On-device
  conversion needs a newer browser (Safari 17, Chrome 80 or Firefox 114)." No
  main-thread fallback.
- Large images: the maximum canvas area is probed once at startup on the main
  thread with `canvas-size` (`maxArea({ usePromise: true, useWorker: true })`,
  it refuses to run inside a worker) and passed to the pipeline worker. While it
  runs the drop zone reads "Getting ready…" but stays live: files added before
  the queue exists are buffered in `App.svelte` and added once it is. A decoded
  bitmap whose pixel count exceeds it is not drawn; the row reads "Too large for
  this browser (48 MP, limit 16 MP)" with the action "Convert at 16 MP" that
  re-decodes with `createImageBitmap(..., { resizeWidth, resizeHeight,
  resizeQuality: 'high' })` to fit the area. Downscaling is an attempt: if it still
  fails the row fails. If the probe itself fails, no limit is invented, oversize
  rows just fail with "Too large for this browser" and no downscale action.
  JPEG XL output also caps at 20 MP, because the single-threaded encoder's wasm
  heap is fixed at 2 GB and larger encodes abort; oversize rows read "Too large
  for JPEG XL (24 MP, limit 20 MP)" and get the same downscale action
  ("Convert at 20 MP").
- Camera RAW input caps at 110 MP, because the wlibraw wasm heap is also fixed
  at 2 GB and a 101 MP decode used about 1.5 GB of it; oversize RAW rows read
  "Too large for RAW decoding (150 MP, limit 110 MP)" and get the same downscale
  action ("Convert at 110 MP"). The RAW size check runs on the file metadata
  before the full decode, so an oversize RAW fails without spending the decode.
  With consent, a RAW decodes half-size when the half-size area (about a quarter
  of the pixels) keeps at least half the allowed pixels (about 4x less wasm
  heap), or when a full decode would exceed the
  heap, and is otherwise decoded full size; the decoded bitmap is then resized
  to fit the limit when it still exceeds it. The RAW cap combines with the JPEG
  XL cap (smallest wins).
- No file-count cap. The header shows the running totals. Known limit, not
  mitigated in this build: very large batches on a phone can exhaust memory
  (results are kept as Blobs, the zip is a second copy). Copy never promises "any
  size, any number".
- Files never leave the device in the default "On device" mode. Codec chunks and
  Google Fonts still load from the network; no file bytes are ever sent anywhere.
  In "Server" mode each eligible file is uploaded once to the configured imagor
  server (see "Server mode" under Rules), converted there and deleted by the
  server immediately after responding; RAW/BMP inputs and PDF output always
  convert on the device.

## Journey

1. Empty: title, one-line promise, dashed drop zone ("Drop images here, or
   browse"), format chips under it, footer with the lock line, the metadata line
   and the GitHub link. On touch devices the drop zone is a tap target that opens
   the picker.
2. Files added: the drop zone collapses to a slim "Drop more images here, or
   browse" strip; a header line reads "6 files · 41.2 MB in · 3 of 6 done"; one row
   per file with thumbnail, name, "HEIC · 6.1 MB → 2.4 MB", a status cell, and
   trailing actions: a download link once done, and always a remove (×) button.
3. Batch settled (nothing queued or converting): header reads
   "41.2 MB → 14.8 MB · all done", or "4 ready · 2 need attention" when some rows
   failed. "Download all · zip" is a real `<a download>` link, enabled when at
   least one row is done. On phones it is full width, sticky at the bottom (safe
   area respected), with the hint "One zip with every converted file. Or tap a
   file to save it alone."
4. Errors are per row, in words, with the one action that resolves them
   (remove, or the downscale opt-in). A failed row never blocks other rows or the
   zip (the zip holds the done rows).
5. "Clear all" (all viewports) empties the list and revokes every object URL.
   Focus moves to the drop zone after clear, and to the next row's remove button
   (or the header) after a single remove.

## State model (`queue.svelte.ts` is the only state owner)

Job: `{ id, attempt, file, name, bytes, kind: InputKind | 'unrecognized', status,
phase?: 'loading-codec' | 'converting' | 'waiting' (set from worker phase messages while converting, cleared on settle),
thumbnailUrl?, result?: { blob, url, bytes, width, height, downscaled, where: 'server' | 'device' },
error?: { code, pixels?, limit? } }`

Statuses: `queued`, `converting`, `done`, `failed`, `awaiting-downscale`.

Queue-level settings: `format` (default `'jpeg'`), `smaller` (default `false`,
the "Smaller files" toggle; not persisted), and `mode` (`'device' | 'server'`,
default `'device'`; never persisted, so Server mode is off on every page load).

Error codes: `unrecognized` (sniff failed or zero bytes: "Not an image we can
read"), `too-large` (with pixels and limit; limit absent when the probe failed),
`failed` (decode, encode or codec load failed: "Couldn't convert this file"),
`worker-lost` ("The converter stopped. Reload the page to continue.").

Transitions:

- add(files) → one job per file, even for duplicates (reset the input so the same
  file can be picked again); sniff runs on add; unrecognized files go straight to
  `failed`. 500 files queue 500 lightweight File references; nothing is read or
  decoded ahead of its turn.
- queued → converting (one job dispatched at a time, in order).
- converting → done | failed | awaiting-downscale.
- awaiting-downscale + consent → queued with `downscale: true` for that attempt.
  A format change resets consent (fresh attempt, may ask again).
- setFormat(f) → sends `cancel` for the in-flight job, then every non-removed job
  gets a new `attempt` number and returns to queued; results, thumbnails stay,
  result URLs are revoked.
- setMode(m) → records the mode and restarts every job exactly like setFormat
  (the dispatch then sends `server: SERVER_URL` in server mode, `null` otherwise).
  The mode is never written to localStorage.
- setSmaller(on) → records the value; when the selected format is `jpeg` or `png`
  it restarts every job exactly like setFormat (new attempt, results dropped, zip
  invalidated, consent cleared), on any other format jobs are untouched.
- remove(id) / clear() from any status; an in-flight job is dropped from state and
  its worker result is ignored on arrival (matched by `id` + `attempt`).
- Worker `error` event → every queued/converting job → failed `worker-lost`;
  the drop zone shows the same message.

Zip: `{ status: 'idle' | 'preparing' | 'ready', url? }`, owned by the queue. When
the batch settles with ≥1 done row, the queue builds the zip (client-zip) from a
snapshot of the done rows and exposes a URL; any list change or format change
revokes it and returns to idle. The button is an `<a download>` only when ready,
otherwise a disabled button with the "becomes available when every file is done"
hint. No synthetic clicks anywhere.

Worker: `{ status: 'starting' | 'ready' | 'unavailable' }`.

## Architecture

Svelte 5 (runes) + Vite + TypeScript, static build, Vercel as is.

```
src/
  main.ts                 mounts App
  app.css                 tokens (light + dark), fonts, reset, motion tokens
  App.svelte              composition root: header, mode switch, drop zone, list, footer
  lib/
    formats.ts            OUTPUT_FORMATS table (id, label, mime, extension), sniff(bytes) → InputKind | null
    names.ts              outputName(inputName, format), uniqueNames(names) for the zip, formatBytes
    capabilities.ts       supported(): boolean; probeMaxArea(): Promise<number | null> (canvas-size, main thread)
    pipeline.ts           worker-side processing: decode(file, kind, fitTo?) → ImageBitmap, encode(bitmap, format, smaller?) → Blob, thumbnail(bitmap) → Blob; convert() tries the server first when the request carries one
    server.ts             the imagor HTTP contract: SERVER_URL config, eligibility, upload with backoff, fallback signal (called from pipeline.ts, never the other way round)
    pipeline.worker.ts    module worker: message loop around pipeline.ts, lazy codec imports
    queue.svelte.ts       the state above; owns the Worker instance and the zip
    zip.ts                buildZip(rows) → Blob via client-zip
    components/
      ModeSwitch.svelte, DropZone.svelte, FormatChips.svelte, FileList.svelte, FileRow.svelte, DownloadAll.svelte
```

Rules:

- `pipeline.ts` has no Svelte and no DOM beyond `OffscreenCanvas`; it is the only
  module that touches codecs. Lazy `import()`: `@jsquash/webp` (only when the
  native probe returns a blob whose `type !== 'image/webp'`), `@jsquash/avif` and
  `@jsquash/jxl` (only for that output), `@jsquash/jpeg` and
  `@jsquash/oxipng/codec/pkg/squoosh_oxipng.js` (only when `smaller` is on and the
  output is JPEG or PNG; the single-threaded wasm-bindgen entry, so the parallel
  wasm and its worker are never bundled), `heic-to/csp` with
  `type: 'bitmap'` (only for HEIC; note it spawns its own nested worker),
  `@wasmedia/wlibraw` (only for RAW input; a fresh instance is created per file,
  and each file decodes with camera white balance, 8-bit output and the sRGB
  tone curve `gamma: [2.4, 12.92]`, because the decoded bytes become sRGB
  ImageData and LibRaw's default BT.709 gamma would darken them),
  `gifenc`,
  `utif`, `pdf-lib` (only for that output).
- Memory: `ImageBitmap.close()` in `finally`; canvases set to 0×0 after use;
  intermediate RGBA arrays are not retained; only thumbnails (≤ 88 px, JPEG) and
  result Blobs live past a job. Revoking a URL always accompanies dropping the Blob
  reference. AVIF, JPEG XL and MozJPEG re-initialise the codec (`init()`) only after
  a failed encode, so one aborted encode cannot leave the cached module broken for
  later files, while healthy batches reuse one compiled module. OxiPNG instead
  falls back to the native PNG blob on any failure (chunk fetch, init, optimise),
  because wasm-bindgen's `init()` caches the instance and re-init would be a no-op.
  The wlibraw instance is dropped after every RAW file (only the local reference
  inside the decode): its wasm heap stays at the decode's high-water mark, up to
  ~1.5 GB at 101 MP, while a fresh instance costs ~20-40 ms against seconds of
  decoding. A file that matches a RAW magic but is not a raw camera file (a plain
  TIFF) makes LibRaw fail with LIBRAW_FILE_UNSUPPORTED; that surfaces as
  `unrecognized` ("Not an image we can read"), any other RAW failure as `failed`.
- Worker protocol (no RPC library):
  in `{ type: 'convert', id, attempt, file, kind, format, maxArea, downscale, smaller, server }`
  (`server` is the imagor base URL in server mode, `null` in device mode)
  and `{ type: 'cancel', id, attempt }` — sent by the queue whenever the in-flight
  job is invalidated (setFormat, setMode, the setSmaller restart, remove, clear).
  The worker keeps one AbortController per in-flight (id, attempt); `cancel` aborts
  it, the server path stops uploading immediately (fetch and backoff sleep both
  honour the signal), the job never falls back to on-device work, and the worker
  answers with a normal `{ type: 'error', code: 'failed' }` for that (id, attempt)
  so the queue's one-at-a-time dispatch is released (the stale answer is ignored).
  On-device conversion itself is not cancellable.
  out `{ type: 'phase', id, attempt, phase: 'loading-codec' | 'converting' | 'waiting' }`,
  `{ type: 'done', id, attempt, blob, thumbnail?, width, height, downscaled, where: 'server' | 'device' }`
  (`thumbnail` is absent when neither the server result nor the source decodes in
  this browser; `where` records where the conversion ran),
  `{ type: 'error', id, attempt, code, pixels?, limit? }`.
  The queue dispatches the next job only after the previous one settles, so at most
  one file is uploaded at a time. A phase only moves forward within an attempt
  (`loading-codec` → `converting`), except that `waiting` (server busy) may
  interleave with `converting`.
- Vite: `new Worker(new URL('./pipeline.worker.ts', import.meta.url), { type: 'module' })`,
  `worker: { format: 'es' }`,
  `optimizeDeps: { exclude: ['@jsquash/webp', '@jsquash/avif', '@jsquash/jxl', '@jsquash/jpeg', '@jsquash/oxipng', '@wasmedia/wlibraw'] }`.
  The production build must be checked for the lazy codec chunks and the wasm
  assets actually being fetched.
- No user-agent sniffing anywhere.
- Names: output = input stem + new extension, Unicode preserved, path separators
  stripped, extensionless names get the extension appended. Inside the zip,
  collisions get ` (2)`, ` (3)` against the full set of already reserved names.
- Server mode (`src/lib/server.ts`, called from `convert()` in pipeline.ts):
  `SERVER_URL` comes from `VITE_SERVER_URL`, default `https://convert.hashcode.dev`,
  trailing slashes stripped. A job is eligible when the request carries a server
  AND the sniffed kind is jpeg/png/webp/gif/avif/heic AND the output is
  jpeg/png/webp/avif/jxl/gif/tiff; RAW/BMP inputs and PDF output always convert on
  the device. Eligible jobs are uploaded one at a time (the queue already dispatches
  one job at a time) with `POST {SERVER_URL}/unsafe/filters:format(<fmt>)/` or
  `POST {SERVER_URL}/unsafe/filters:format(<fmt>):quality(<q>)/` (qualities: jpeg 90,
  webp 85, avif 50, jxl 75; png/gif/tiff send none), body multipart/form-data with a
  single `image` field whose Blob type is the sniffed kind's image/* MIME — never
  `File.type`, which iOS mislabels and the server rejects with 406. Fetch uses
  `credentials: 'omit'`, `mode: 'cors'`, `referrerPolicy: 'no-referrer'`,
  `cache: 'no-store'` and a 60 s per-attempt timeout (`AbortSignal.timeout`); no
  credentials or cookies are ever sent. A 200 returns the response blob retyped with
  the output MIME (a failed body read — dropped connection, timeout mid-read —
  falls back too). 408 (imagor answers 408 when a queued request has not started
  within its 30 s request timeout), 429 and 503 set phase `waiting` and retry: the
  wait is `Retry-After` (seconds or HTTP-date) when present, else exponential
  backoff with full jitter starting at 1 s, doubling, capped at 15 s per wait,
  floored at 1 ms. The budget is a strict 90 s of wall-clock time per file,
  counted from the first attempt via `Date.now()`: each attempt's timeout is
  `min(60 s, remaining budget)`, no attempt starts with less than 1 s remaining,
  and when the next wait would push elapsed past 90 s the job falls back — so a
  file always leaves the server path within 90 s, no matter how the server
  answers (repeated 30 s 408s included). Any other status, a timeout, or a
  network/CORS error falls back
  immediately. Falling back emits phase `converting` first (a row never stays on
  "Waiting for the server…" during local decoding) and then runs the existing
  on-device `convert()` for the same
  file and reports `where: 'device'`, so the too-large/downscale journey, RAW and
  "Smaller files" behave exactly as in device mode; a stuck server can never stall
  the batch: a file leaves the server path within 90 s and then converts on the
  device.
  Thumbnail/dimensions for a server result are best effort: decode the result blob
  with `createImageBitmap`, else decode the source file, else no thumbnail and
  width/height 0; `downscaled` is false for server results. The server strips
  metadata, stores nothing and deletes everything after responding; CORS allows only
  the site origin.
- Privacy copy: while Server mode is on, the hero, the line under the mode switch
  ("Photos are uploaded to <host>, converted, and deleted right away.") and the
  footer ("No accounts, no tracking. Server mode uploads each photo for conversion
  only.") must never claim files stay on the device; in device mode the copy is
  unchanged ("No uploads, no accounts, no tracking."). The "Smaller files" checkbox
  is hidden in Server mode (MozJPEG/OxiPNG are on-device only) but its value is
  kept for when the user switches back. A done row that fell back shows
  "· on this device" in its meta line; a `waiting` phase reads "Waiting for the
  server…".
- The file input `accept` lists `image/*,.heic,.heif,image/heic,image/heif` plus
  the RAW extensions `.dng,.cr2,.cr3,.nef,.arw,.raf,.orf,.rw2,.pef,.srw,.iiq,image/x-adobe-dng`
  so iOS hands over HEIC originals instead of transcoding and pickers on all
  platforms offer RAW files.

## Accessibility

Native controls only: `<button>`, `<input type="file">` behind a `<label>` drop
zone, a `role="radiogroup"` of format chips (`aria-checked`, arrow keys), the mode
switch as a real radio group with both options enabled (disabled only until the
queue exists). Remove buttons are
labelled "Remove IMG_4821.HEIC", download links "Download IMG_4821.jpg". The header
count line is `aria-live="polite"`; rows are not announced individually. Visible
focus rings (2px teal outline, 2px offset) everywhere. Status is always text, never
colour alone. Small text uses `--muted` (#5c564d, 7:1); `--faint` (#8a8378, 3.5:1)
is reserved for disabled states.

## Mock overrides

- Eight format chips in every state and viewport; they wrap on phones.
- "any size, any number" is removed from the drop-zone hint.
- "Only formats this browser can produce are listed" is removed.
- Progress is an indeterminate bar, not a percentage.
- Done rows keep a remove (×) button after the download link.
- Phone has "Clear all" in the header line and a sticky footer with safe-area
  padding; the list gets bottom padding so the footer never covers a focused row.
- Every row has a thumbnail slot: a tinted square with the format tag while queued
  or failed, the worker-made thumbnail once done.

## Motion (tokens from hashcode.dev; reduced motion keeps opacity/colour only)

`--ease-out: cubic-bezier(0.23, 1, 0.32, 1)`, `--fast: 160ms`, `--standard: 220ms`,
`--reveal: 700ms`.

- Page load: header, hero, drop zone fade in with an 8px rise, 700 ms, 80 ms stagger.
- Row insertion: fade + 4px rise, 220 ms, 40 ms stagger for the first 8 rows of an
  add; later rows appear instantly.
- Row removal: Svelte `slide`, 160 ms.
- Drop-zone dragover: border solid teal + background tint, 160 ms.
- Converting: 3px track, a 30% teal segment sliding left→right on a 1.2 s linear
  loop; reduced motion shows a static 40% segment.
- Done: status crossfade 160 ms. Download all: colour transition 220 ms when it
  becomes ready. Pressables: `scale(0.98)` 100 ms down-state; chip selection
  background 160 ms.
- Nothing else animates. No hover lift on rows, no celebration, no layout
  animation between empty and busy.

## Libraries (pinned)

| Need | Library |
|---|---|
| Decode JPEG/PNG/WebP/GIF/BMP/AVIF | `createImageBitmap(Blob)` (default `imageOrientation`, verified with oriented JPEGs) |
| Decode HEIC | heic-to 1.5.2, `heic-to/csp`, `type: "bitmap"` |
| Decode camera RAW | @wasmedia/wlibraw 0.3.0 (LibRaw 0.22.2, LGPL-2.1, single-threaded + SIMD) |
| Encode JPEG/PNG | `OffscreenCanvas.convertToBlob` |
| Encode WebP | native when `blob.type === 'image/webp'`, else @jsquash/webp 1.5.0 |
| Encode AVIF | @jsquash/avif 2.1.1 (single-threaded build; the site is not cross-origin isolated) |
| Encode JPEG XL | @jsquash/jxl 1.3.0 (same) |
| Encode JPEG smaller, opt-in | @jsquash/jpeg 1.6.0 (MozJPEG, same) |
| Optimise PNG losslessly, opt-in | @jsquash/oxipng 2.3.0 (same) |
| Encode GIF | gifenc 1.0.3 (`quantize` rgb565, `applyPalette`, one frame) |
| Encode TIFF | utif 3.1.0 `encodeImage(rgba, w, h)` |
| Encode PDF | pdf-lib 1.17.1 (`embedJpg`, one page) |
| Max canvas area | canvas-size 2.0.0 (main thread) |
| Zip | client-zip 2.5.1 |

## Verification

- `npm run check`, `npm run build`, `npm test` (vitest: sniff on real header
  bytes, output naming and zip de-duplication, queue transitions including the
  format-switch race and ignored stale results, the server module with a mocked
  fetch — request shape, MIME from the sniffed kind, Retry-After and jittered
  backoff within the 90 s budget, immediate fallback on other statuses, timeouts
  and network errors — and server-mode convert/queue behaviour: `where`,
  `server` field, `waiting` phase, optional thumbnail).
- Built site (`vite preview`), Chromium and Safari, plus iOS Simulator Safari:
  each of the eight outputs from a JPEG, HEIC → JPEG, PNG with alpha → JPEG/PNG,
  the "Smaller files" toggle off and on for JPEG and PNG (MozJPEG/OxiPNG chunks
  fetched, native fallback intact),
  EXIF orientation 6 JPEG, a 48 MP image, a 24 MP JPEG → JPEG XL offers
  "Convert at 20 MP", then converts, and a later 12 MP file still converts,
  a CR3 and a DNG → JPEG (wlibraw chunk and wasm fetched, "Loading RAW decoder…"
  phase visible), a 150 MP RAW offers "Convert at 110 MP" and converts half-size,
  a plain TIFF reads "Not an image we can read",
  a .mov dropped in, remove in flight,
  format switch mid-batch, Download all, dark mode, 390 px width, reduced motion,
  keyboard-only run. Lazy codec chunk requests observed in the network panel.
- Server mode against a real imagor behind the planned Traefik config: a JPEG →
  each server output (jpeg/png/webp/avif/jxl/gif/tiff) with the right
  `filters:format(...):quality(...)` path and an image/* part MIME, 200 → done row
  without "· on this device"; a 408/429/503 with Retry-After shows "Waiting for the
  server…" then retries, and a server that only ever answers 408 after its 30 s
  request timeout falls back within the 90 s wall-clock budget; a 413/406/422 or a
  stopped server falls back and the row
  reads "· on this device"; a RAW file and PDF output never upload (no request in
  the network panel); mode switch back to "On device" sends `server: null`; a
  reload always starts in device mode; the "Smaller files" checkbox is hidden in
  Server mode and returns with its value when switching back.
- Not covered in this build: Firefox (not installed here), physical iPhone memory
  behaviour on large batches.
