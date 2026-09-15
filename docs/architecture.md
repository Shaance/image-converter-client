# Image converter, on-device rebuild

Status: contract v2, 2026-09-15. Implements the three mocks on page 2 of the design
canvas (empty, busy, phone). Where this document and a mock disagree, this document
wins; the overrides are listed under "Mock overrides".

## Goal

A single-page web app at images.hashcode.dev that converts photos in the browser.
No upload, no account, no tracking. A "Server" mode is shown but disabled
("coming back soon") until the backend is rebuilt.

## Product decisions

- One journey: pick an output format (JPEG default), drop or pick files, every file
  converts immediately, each row gets its own download link, and one primary
  "Download all" zip link becomes available when the batch settles.
- No Convert button. Switching the output format while files are present starts a
  fresh attempt for every file and discards previous results.
- Input: HEIC/HEIF (primary image only), JPEG, PNG, WebP, GIF (first frame), BMP,
  AVIF where the browser decodes it. A file is identified by magic bytes (bounded
  header read), never by extension or `File.type` (iOS Safari 17 mislabels JPEGs
  as HEIC). Animated inputs become one still frame.
- Output: JPEG, PNG, WebP, PDF, GIF, TIFF, the same six in every supported browser
  and every state. Every gap is filled by a lazily loaded library, so no
  "unsupported format" state exists. BMP output is dropped.
- Output files carry no metadata (no EXIF, no GPS, no colour profile); the footer
  says so in one line. Transparency is flattened onto white for JPEG, PDF and GIF;
  PNG, WebP and TIFF keep alpha. JPEG quality 0.9, WebP quality 0.85. PDF: one
  page per file, page size = pixels / 300 per inch.
- Supported browsers: `OffscreenCanvas`, `createImageBitmap`, module workers.
  API floors: Safari 16.4, Chrome 80, Firefox 114; product floor Safari 17 / iOS 17.
  Detection is synchronous feature checks plus the worker's `error` event. An
  unsupported browser sees one message in place of the drop zone: "On-device
  conversion needs a newer browser (Safari 17, Chrome 80 or Firefox 114)." No
  main-thread fallback.
- Large images: the maximum canvas area is probed once at startup on the main
  thread with `canvas-size` (`maxArea({ usePromise: true, useWorker: true })`,
  it refuses to run inside a worker) and passed to the pipeline worker. A decoded
  bitmap whose pixel count exceeds it is not drawn; the row reads "Too large for
  this browser (48 MP, limit 16 MP)" with the action "Convert at 16 MP" that
  re-decodes with `createImageBitmap(..., { resizeWidth, resizeHeight,
  resizeQuality: 'high' })` to fit the area. Downscaling is an attempt: if it still
  fails the row fails. If the probe itself fails, no limit is invented, oversize
  rows just fail with "Too large for this browser" and no downscale action.
- No file-count cap. The header shows the running totals. Known limit, not
  mitigated in this build: very large batches on a phone can exhaust memory
  (results are kept as Blobs, the zip is a second copy). Copy never promises "any
  size, any number".
- Files never leave the device. Codec chunks and Google Fonts still load from the
  network; no file bytes are ever sent anywhere.

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
phase?: 'loading-codec' | 'converting' (set from worker phase messages while converting, cleared on settle),
thumbnailUrl?, result?: { blob, url, bytes, width, height, downscaled },
error?: { code, pixels?, limit? } }`

Statuses: `queued`, `converting`, `done`, `failed`, `awaiting-downscale`.

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
- setFormat(f) → every non-removed job gets a new `attempt` number and returns to
  queued; results, thumbnails stay, result URLs are revoked.
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
    pipeline.ts           worker-side processing: decode(file, kind, fitTo?) → ImageBitmap, encode(bitmap, format) → Blob, thumbnail(bitmap) → Blob
    pipeline.worker.ts    module worker: message loop around pipeline.ts, lazy codec imports
    queue.svelte.ts       the state above; owns the Worker instance and the zip
    zip.ts                buildZip(rows) → Blob via client-zip
    components/
      ModeSwitch.svelte, DropZone.svelte, FormatChips.svelte, FileList.svelte, FileRow.svelte, DownloadAll.svelte
```

Rules:

- `pipeline.ts` has no Svelte and no DOM beyond `OffscreenCanvas`; it is the only
  module that touches codecs. Lazy `import()`: `@jsquash/webp` (only when the
  native probe returns a blob whose `type !== 'image/webp'`), `heic-to/csp` with
  `type: 'bitmap'` (only for HEIC; note it spawns its own nested worker), `gifenc`,
  `utif`, `pdf-lib` (only for that output).
- Memory: `ImageBitmap.close()` in `finally`; canvases set to 0×0 after use;
  intermediate RGBA arrays are not retained; only thumbnails (≤ 88 px, JPEG) and
  result Blobs live past a job. Revoking a URL always accompanies dropping the Blob
  reference.
- Worker protocol (no RPC library):
  in `{ type: 'convert', id, attempt, file, kind, format, maxArea, downscale }`
  out `{ type: 'phase', id, attempt, phase: 'loading-codec' | 'converting' }`,
  `{ type: 'done', id, attempt, blob, thumbnail, width, height, downscaled }`,
  `{ type: 'error', id, attempt, code, pixels?, limit? }`.
  The queue dispatches the next job only after the previous one settles.
- Vite: `new Worker(new URL('./pipeline.worker.ts', import.meta.url), { type: 'module' })`,
  `worker: { format: 'es' }`, `optimizeDeps: { exclude: ['@jsquash/webp'] }`.
  The production build must be checked for the lazy codec chunks and the wasm
  assets actually being fetched.
- No user-agent sniffing anywhere.
- Names: output = input stem + new extension, Unicode preserved, path separators
  stripped, extensionless names get the extension appended. Inside the zip,
  collisions get ` (2)`, ` (3)` against the full set of already reserved names.
- Server mode: the mode switch is a native radio group whose "Server" option is
  disabled (`disabled` attribute, plus the "coming back soon" tag in its label).
  Nothing else exists for it. No interface, no stub.
- The file input `accept` lists `image/*,.heic,.heif,image/heic,image/heif` so
  iOS hands over HEIC originals instead of transcoding.

## Accessibility

Native controls only: `<button>`, `<input type="file">` behind a `<label>` drop
zone, a `role="radiogroup"` of format chips (`aria-checked`, arrow keys), the mode
switch as a radio group with the Server option `disabled`. Remove buttons are
labelled "Remove IMG_4821.HEIC", download links "Download IMG_4821.jpg". The header
count line is `aria-live="polite"`; rows are not announced individually. Visible
focus rings (2px teal outline, 2px offset) everywhere. Status is always text, never
colour alone. Small text uses `--muted` (#5c564d, 7:1); `--faint` (#8a8378, 3.5:1)
is reserved for disabled states.

## Mock overrides

- Six format chips in every state and viewport; they wrap on phones.
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
| Encode JPEG/PNG | `OffscreenCanvas.convertToBlob` |
| Encode WebP | native when `blob.type === 'image/webp'`, else @jsquash/webp 1.5.0 |
| Encode GIF | gifenc 1.0.3 (`quantize` rgb565, `applyPalette`, one frame) |
| Encode TIFF | utif 3.1.0 `encodeImage(rgba, w, h)` |
| Encode PDF | pdf-lib 1.17.1 (`embedJpg`, one page) |
| Max canvas area | canvas-size 2.0.0 (main thread) |
| Zip | client-zip 2.5.1 |

## Verification

- `npm run check`, `npm run build`, `npm test` (vitest: sniff on real header
  bytes, output naming and zip de-duplication, queue transitions including the
  format-switch race and ignored stale results).
- Built site (`vite preview`), Chromium and Safari, plus iOS Simulator Safari:
  each of the six outputs from a JPEG, HEIC → JPEG, PNG with alpha → JPEG/PNG,
  EXIF orientation 6 JPEG, a 48 MP image, a .mov dropped in, remove in flight,
  format switch mid-batch, Download all, dark mode, 390 px width, reduced motion,
  keyboard-only run. Lazy codec chunk requests observed in the network panel.
- Not covered in this build: Firefox (not installed here), physical iPhone memory
  behaviour on large batches.
