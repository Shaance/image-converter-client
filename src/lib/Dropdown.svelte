<script lang="ts">
  import { targetFormat, ConvertFormat } from "./stores";
  export let onChange = (event) => {
    targetFormat.set(selected);
  };

  const options: ConvertFormat[] = [
    { text: "jpeg", position: 0, mimeType: "image/jpeg" },
    { text: "png", position: 1, mimeType: "image/png" },
    { text: "pdf", position: 2, mimeType: "application/pdf" },
    { text: "gif", position: 3, mimeType: "image/gif" },
    { text: "tif", position: 4, mimeType: "image/tif" },
    { text: "bmp", position: 5, mimeType: "image/bmp" },
  ];

  let selected = options[$targetFormat.position];
</script>

<div>
  <!-- svelte-ignore a11y-label-has-associated-control -->
  <p>Convert to</p>
  <select id="convertion-format" bind:value={selected} on:change={onChange}>
    {#each options as option}
      <option value={option}>
        {option.text}
      </option>
    {/each}
  </select>
</div>

<style>
  p {
    color: #9d9c9d;
    font-size: 12px;
  }

  select {
    background-color: #d1d1d1;
    padding-left: 5px;
    padding-right: 5px;
    padding-top: 2px;
    padding-bottom: 2px;
  }

  div {
    margin-bottom: 50px;
  }
</style>
