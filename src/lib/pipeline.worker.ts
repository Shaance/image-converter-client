import { convert, type ConversionError, type ConvertRequest, type WorkerResponse } from './pipeline';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ConvertRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
};
scope.onmessage = async ({ data }) => {
  const { id, attempt } = data;
  try {
    const result = await convert(data, phase => scope.postMessage({ type: 'phase', id, attempt, phase }));
    scope.postMessage({ type: 'done', id, attempt, ...result });
  } catch (error) {
    scope.postMessage({ type: 'error', id, attempt, ...error as ConversionError });
  }
};
