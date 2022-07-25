import { withQueryParams, fetchWithRetries } from "./utils";
import {
  processedFiles,
  conversionStatus,
  ConversionStatus,
  progress,
  uploadedFiles,
} from "./stores";

const statusEndpoint = import.meta.env.VITE_STATUS_URL;
const requestsEndpoint = import.meta.env.VITE_REQUESTS_URL;
const presignEndpoint = import.meta.env.VITE_PRESIGN_URL;

interface RequestAPIResponseBody {
  requestId: string;
  getObjectSignedUrl: string;
}

export async function getStatus(requestId: string, totalFiles: number, resetFn) {
  const options = {
    method: "GET",
  };

  const queryParams = new Map([["requestId", requestId]]);
  return fetch(withQueryParams(statusEndpoint, queryParams), options).then(
    async (resp) => {
      const status = await resp.json();
      conversionStatus.set(status.status);
      if (status.status === ConversionStatus.DONE) {
        resetFn();
      } else {
        processedFiles.set(status.processed);
        progress.set(status.processed / totalFiles);
        uploadedFiles.set(status.uploaded);
      }
    }
  );
}

export async function createNewUploadRequest(nbFiles: number): Promise<RequestAPIResponseBody> {
  const options = { method: "GET" };
  const queryParams = new Map([["nbFiles", nbFiles.toString()]]);

  const resp = await fetchWithRetries(
    withQueryParams(requestsEndpoint, queryParams),
    options
  );
  const body = await resp.json();
  return body;
}

export async function getPresignUrlFromLambda(fileName: string, requestId: string, targetMime: string) {
  const options = { method: "GET" };

  const queryParams = new Map([
    ["requestId", requestId],
    ["fileName", fileName],
    ["targetMime", targetMime],
  ]);

  return fetch(withQueryParams(presignEndpoint, queryParams), options);
}

export async function uploadFile(presignUrl: string, file: File): Promise<Response> {
  const options = {
    method: "PUT",
    body: file,
  };

  return fetchWithRetries(presignUrl, options);
}