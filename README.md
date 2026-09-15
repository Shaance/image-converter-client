# Image converter
An on-device image converter built with Svelte 5 and TypeScript.
Everything runs in your browser; image bytes are never uploaded.
Inputs: HEIC/HEIF, JPEG, PNG, WebP, GIF, BMP, and browser-decodable AVIF.
Outputs: JPEG, PNG, WebP, PDF, GIF, and TIFF; animated inputs become a still image.
Requires module workers, OffscreenCanvas, and createImageBitmap.
Install: `npm install`.
Develop: `npm run dev`.
Validate: `npm run check` and `npm test`.
Build: `npm run build`; serve the build: `npm run preview`.
