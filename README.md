# Image converter

Convert photos to JPEG, PNG, WebP and more. By default everything happens in
your browser, so your files never leave your device.

**Try it: [images.hashcode.dev](https://images.hashcode.dev)**

## What it does

- Drop in HEIC, JPEG, PNG, WebP, GIF, BMP, AVIF or camera RAW files (CR2, CR3, NEF, ARW, RAF, DNG and more) and they convert immediately, no button to press.
- Pick JPEG, PNG, WebP, AVIF, JPEG XL, PDF, GIF or TIFF as the output. Changing the format re-converts the whole batch.
- For JPEG and PNG output, an optional "Smaller files" toggle encodes with MozJPEG and runs PNGs through OxiPNG for smaller files, at the cost of slower conversions.
- Download each file on its own, or grab everything as one zip.
- Converted files carry no EXIF or location data.
- Works on phones, including HEIC photos straight from an iPhone camera roll.

There is also an optional "Server" mode in the mode switch, off by default on
every page load. With it on, each eligible photo (JPEG, PNG, WebP, GIF, AVIF,
HEIC) is uploaded one at a time to the converter server at
[convert.hashcode.dev](https://convert.hashcode.dev), converted there, and
deleted by the server immediately after responding — no account, no storage, no tracking, and no cookies are sent.
RAW and BMP inputs and PDF output always convert on the device, and anything the
server cannot do (rate limits after a short wait, oversize or unsupported files,
outages) automatically falls back to on-device conversion, which the file's row
marks with "on this device".

## How it works

The page hands each file to a web worker, which decodes it, draws it onto an
`OffscreenCanvas` and encodes the result. Codecs the browser does not provide
are loaded on demand so the initial page stays small:

| Need | Library |
| --- | --- |
| HEIC and HEIF decoding | [heic-to](https://github.com/hoppergee/heic-to) |
| Camera RAW decoding | [@wasmedia/wlibraw](https://gitlab.com/wasmedia/wlibraw) |
| WebP encoding where the browser cannot | [@jsquash/webp](https://github.com/jamsinclair/jSquash) |
| AVIF encoding | [@jsquash/avif](https://github.com/jamsinclair/jSquash) 2.1.1 |
| JPEG XL encoding | [@jsquash/jxl](https://github.com/jamsinclair/jSquash) 1.3.0 |
| Smaller JPEG output (opt-in toggle) | [@jsquash/jpeg](https://github.com/jamsinclair/jSquash) |
| Lossless PNG optimisation (opt-in toggle) | [@jsquash/oxipng](https://github.com/jamsinclair/jSquash) |
| GIF encoding | [gifenc](https://github.com/mattdesl/gifenc) |
| TIFF encoding | [UTIF](https://github.com/photopea/UTIF.js) |
| PDF output | [pdf-lib](https://pdf-lib.js.org) |
| Zip download | [client-zip](https://github.com/Touffy/client-zip) |

LibRaw, the RAW decoder behind @wasmedia/wlibraw, is LGPL-2.1/CDDL licensed and is only loaded when a RAW file is added.

Very large images can exceed what a browser canvas will draw. The app probes
that limit once at startup and, when a photo is over it, offers to convert at a
reduced size instead of failing silently. JPEG XL output is also capped at 20 MP
(the encoder's wasm heap is fixed at 2 GB); oversize photos get the same
reduced-size offer.

A few things are deliberately out of scope: inputs a browser cannot decode
(PSD and so on), animated output, and server-side processing beyond the optional
Server mode described above.

## Third-party notices

LibRaw (dual-licensed LGPL-2.1 or CDDL-1.0, <https://www.libraw.org>, source at
<https://github.com/LibRaw/LibRaw>) is compiled to WebAssembly by
[@wasmedia/wlibraw](https://gitlab.com/wasmedia/wlibraw) (LGPL-2.1) and is loaded
as a separate, unmodified wasm file only when a RAW file is added. The wlibraw
build also contains LittleCMS 2 (MIT), mozjpeg (IJG/BSD-style) and zlib-ng
(zlib licence); their licence texts ship in
`node_modules/@wasmedia/wlibraw/dist/licenses`.

## Requirements

A browser with module workers, `OffscreenCanvas` and `createImageBitmap`:
Safari 17, Chrome 80 or Firefox 114 and newer.

## Development

Built with Svelte 5, Vite and TypeScript.

```bash
npm install
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server |
| `npm run check` | Type-check Svelte and TypeScript |
| `npm test` | Run the unit tests |
| `npm run build` | Build for production |
| `npm run preview` | Serve the production build locally |

### Server mode configuration

The converter server is set at build time with `VITE_SERVER_URL`; nothing is
hardcoded. Production gets it from the Vercel project's environment variables
(`https://convert.hashcode.dev`). A build without it, such as a plain
`npm run dev`, hides the mode switch and converts on the device only. To try
Server mode locally, copy `.env.example` to `.env.local` and point it at an
imagor server that allows your origin (the production server only accepts
requests from images.hashcode.dev).

Deployed on Vercel from the `main` branch.
