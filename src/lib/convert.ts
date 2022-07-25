import { createNewUploadRequest, getPresignUrlFromLambda, getStatus, uploadFile } from "./apis";
import {
  totalFiles,
  processedFiles,
  requestId,
  conversionStatus,
  ConversionStatus,
  progress,
  uploadedFiles,
  targetFormat,
  downloadLink,
  interval
} from "./stores";
import { get } from 'svelte/store';
import { devMode, logDebug } from "./utils";

function resetState() {
  processedFiles.set(0);
  totalFiles.set(0);
  uploadedFiles.set(0);
  clearInterval(get(interval));
}

export async function handleFiles(files: File[]) {
  if (!files) {
    return;
  }

  if (files.length > 50) {
    // @ts-ignore
    window.pushToast("Can't upload more than 50 pictures");
    return;
  }

  if (get(downloadLink)) {
    downloadLink.set(undefined);
    progress.set(0);
  }

  const nbFiles = files.length;
  totalFiles.set(nbFiles);
  const requestResponseBody = await createNewUploadRequest(nbFiles);
  requestId.set(requestResponseBody.requestId);
  downloadLink.set(requestResponseBody.getObjectSignedUrl);
  if (devMode()) {
    console.time(`upload-${get(requestId)}`);
  }
  conversionStatus.set(ConversionStatus.CONVERTING);
  interval.set(setInterval(
    () => getStatus(get(requestId), get(totalFiles), resetState, interval),
    1000
  ));
  try {
    await Promise.all(
      files.map(async (f) => {
        const response = await getPresignUrlFromLambda(
          f.name,
          get(requestId),
          get(targetFormat).mimeType
        );
        const body = await response.json();
        return uploadFile(body.putObjectSignedUrl, f);
      })
    );
  } catch (err) {
    logDebug(err)
    resetState();
    conversionStatus.set(ConversionStatus.INITIAL);
    // @ts-ignore
    window.pushToast("Error when uploading your pictures, please try again");
  }
  if (devMode()) {
    console.timeEnd(`upload-${get(requestId)}`);
  }
}