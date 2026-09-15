/// <reference types="vite/client" />

declare module 'canvas-size' {
  const canvasSize: {
    maxArea(options: { usePromise: boolean; useWorker: boolean }):
      Promise<{ success: boolean; width: number; height: number }> | false;
  };
  export default canvasSize;
}
declare module 'gifenc' {
  export function quantize(rgba: Uint8ClampedArray, colors: number,
    options: { format: 'rgb565' }): number[][];
  export function applyPalette(rgba: Uint8ClampedArray, palette: number[][],
    format: 'rgb565'): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number,
      options: { palette: number[][] }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}
declare module 'utif' {
  const UTIF: { encodeImage(rgba: ArrayBufferLike, width: number, height: number, metadata: { t338: number[]; t305: string[] }): ArrayBuffer };
  export default UTIF;
}
