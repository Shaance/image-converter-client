import { derived, writable } from 'svelte/store';
import { tweened } from "svelte/motion";
import { cubicOut } from "svelte/easing";

export enum ConversionStatus {
  INITIAL = "INITIAL",
  CREATED = "CREATED",
  CONVERTING = "CONVERTING",
  ZIPPING = "ZIPPING",
  DONE = "DONE",
}

export interface ConvertFormat {
  text: string;
  position: number;
  mimeType: string;
}

export const totalFiles = writable(0);
export const processedFiles = writable(0);
export const uploadedFiles = writable(0);
export const conversionStatus = writable(ConversionStatus.INITIAL);
export const processing = derived(
	conversionStatus,
	$conversionStatus => $conversionStatus !== ConversionStatus.INITIAL && $conversionStatus !== ConversionStatus.DONE
);
export const requestId = writable<string>();
export const progress = tweened(0, {
  duration: 400,
  easing: cubicOut,
});
export const targetFormat = writable<ConvertFormat>({ position: 0, mimeType: "image/jpeg", text: "jpeg"});
export const downloadLink = writable<string>(undefined);
export const interval = writable(undefined)
