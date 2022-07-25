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

const validHeicMimeTypeTarget = new Set(["image/png", "image/jpeg", "image/jpg"])

function resetState() {
  processedFiles.set(0);
  totalFiles.set(0);
  uploadedFiles.set(0);
  clearInterval(get(interval));
}

function getExtensionFromFile(fileName: string) {
  const tmp = fileName.split('.')
  if (tmp.length == 0) {
    // @ts-ignore
    window.pushToast("Can't handle files without extension");
    return
  }
  return tmp[tmp.length - 1]
}

// heic only supports as target JPG and PNG
function targetFormatIsValid(files: File[]) {
  const mimeTarget = get(targetFormat).mimeType
  return files.every((f) => {
    const extension = getExtensionFromFile(f.name)
    if (!extension) {
      return false
    }
    if (extension === "heic") {
      return validHeicMimeTypeTarget.has(mimeTarget)
    }
    return true
  })
}

export async function handleFiles(files: File[]) {
  if (!files) {
    return;
  }

  if (!targetFormatIsValid(files)) {
    // @ts-ignore
    window.pushToast("Heic files can only be converted to jpeg and png format");
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