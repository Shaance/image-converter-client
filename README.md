# Image converter

Convert photos to JPEG, PNG, WebP and more without uploading them.
Everything happens in your browser, so your files never leave your device.

**Try it: [images.hashcode.dev](https://images.hashcode.dev)**

## What it does

- Drop in HEIC, JPEG, PNG, WebP, GIF, BMP or AVIF files and they convert immediately, no button to press.
- Pick JPEG, PNG, WebP, PDF, GIF or TIFF as the output. Changing the format re-converts the whole batch.
- Download each file on its own, or grab everything as one zip.
- Converted files carry no EXIF or location data.
- Works on phones, including HEIC photos straight from an iPhone camera roll.

There is a "Server" mode in the interface. It is a placeholder for a future backend and is disabled for now.

## How it works

The page hands each file to a web worker, which decodes it, draws it onto an
`OffscreenCanvas` and encodes the result. Codecs the browser does not provide
are loaded on demand so the initial page stays small:

| Need | Library |
| --- | --- |
| HEIC and HEIF decoding | [heic-to](https://github.com/hoppergee/heic-to) |
| WebP encoding where the browser cannot | [@jsquash/webp](https://github.com/jamsinclair/jSquash) |
| GIF encoding | [gifenc](https://github.com/mattdesl/gifenc) |
| TIFF encoding | [UTIF](https://github.com/photopea/UTIF.js) |
| PDF output | [pdf-lib](https://pdf-lib.js.org) |
| Zip download | [client-zip](https://github.com/Touffy/client-zip) |

Very large images can exceed what a browser canvas will draw. The app probes
that limit once at startup and, when a photo is over it, offers to convert at a
reduced size instead of failing silently.

A few things are deliberately out of scope: inputs a browser cannot decode
(RAW, PSD, and so on), animated output, and any server-side processing.

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

Deployed on Vercel from the `main` branch.
