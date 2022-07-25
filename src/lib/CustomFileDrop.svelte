<script lang="ts">
  import { FileDrop } from "svelte-droplet";
  import { processing } from "./stores";

  export let handleFiles;
  $: text = $processing
    ? "Wait for conversion's end to convert more"
    : "Select or drop your images here";

  const acceptedMimes = [
    "image/heic",
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/gif",
    "image/tif",
    "image/tiff",
    "image/bmp",
    "application/pdf",
  ];
</script>

<div class="content">
  <FileDrop {acceptedMimes} {handleFiles} disabled={$processing} let:droppable>
    <div class="zone" class:droppable>{text}</div>
  </FileDrop>
</div>

<style>
  .content {
    margin-left: 40px;
    margin-right: 40px;
  }
  .zone {
    background-color: #373b45;
    padding: 30px;
    border: 2px solid rgb(69, 64, 104);
    border-radius: 2px;
    border-style: dotted;
    margin-bottom: 50px;
    font-weight: 250;
    border-radius: 5px;
    color: #b8b8bc;
  }
  .droppable {
    border-color: #1f79ff;
  }
</style>
