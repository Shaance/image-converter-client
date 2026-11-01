import { convert, type ConversionError, type WorkerRequest, type WorkerResponse } from './pipeline';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};
// One AbortController per in-flight (id, attempt); `cancel` aborts it.
const controllers = new Map<string, AbortController>();
const key = (id: string, attempt: number) => `${id}:${attempt}`;

scope.onmessage = async ({ data }) => {
  if (data.type === 'cancel') {
    controllers.get(key(data.id, data.attempt))?.abort();
    return;
  }
  const { id, attempt } = data;
  const controller = new AbortController();
  controllers.set(key(id, attempt), controller);
  try {
    const result = await convert(data, phase => scope.postMessage({ type: 'phase', id, attempt, phase }), controller.signal);
    scope.postMessage({ type: 'done', id, attempt, ...result });
  } catch (error) {
    // A cancelled job lands here as a plain 'failed' so the queue's
    // one-at-a-time dispatch is released; the queue ignores the stale result.
    scope.postMessage({ type: 'error', id, attempt, ...error as ConversionError });
  } finally {
    controllers.delete(key(id, attempt));
  }
};
