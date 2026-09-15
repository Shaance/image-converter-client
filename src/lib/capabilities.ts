export function supported(): boolean {
  return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined'
    && typeof createImageBitmap === 'function';
}

export async function probeMaxArea(): Promise<number | null> {
  try {
    const { default: canvasSize } = await import('canvas-size');
    const result = await canvasSize.maxArea({ usePromise: true, useWorker: true });
    return result && result.success ? result.width * result.height : null;
  } catch {
    return null;
  }
}
