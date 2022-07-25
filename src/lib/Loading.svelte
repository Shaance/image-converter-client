<script lang="ts">
  import { totalFiles, processedFiles, conversionStatus, ConversionStatus, uploadedFiles } from "./stores";
  import { fade } from "svelte/transition";
  import ProgressBar from "./ProgressBar.svelte";

  $: uploadedText = `Uploaded: ${$uploadedFiles} / ${$totalFiles}`
  $: processedText = `Processed: ${$processedFiles} / ${$totalFiles}`
</script>

<div>
  {#if $conversionStatus === ConversionStatus.CREATED || $conversionStatus === ConversionStatus.CONVERTING}
    <p transition:fade|local class="labelText"> Image conversion status</p>
    <ProgressBar />
    <p transition:fade|local class="helperText"> {uploadedText} </p>
    <p transition:fade|local class="helperText"> {processedText} </p>
  {:else if $conversionStatus === ConversionStatus.ZIPPING}
    <p transition:fade|local class="zipping">Zipping your pictures..</p>
  {/if}
</div>

<style>

  div {
    height: 200px;
  }

  .zipping {
    color: #d1d0d0;
    font-weight: 400;
  }
  .labelText {
    color: #d1d0d0;
    font-weight: 400;
  }

  .helperText {
    color: #9d9c9d;
    font-size: 12px;
  }
</style>