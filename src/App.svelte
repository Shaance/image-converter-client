<script lang="ts">
  import CustomFileDrop from "./lib/CustomFileDrop.svelte";
  import {
    conversionStatus,
    ConversionStatus,
    processing,
    downloadLink
  } from "./lib/stores";
  import Loading from "./lib/Loading.svelte";
  import DownloadBtn from "./lib/DownloadBtn.svelte";
  import Toast from "./lib/Toast.svelte";
  import Dropdown from "./lib/Dropdown.svelte";
  import { handleFiles } from "./lib/convert";
  import AboutFooter from "./lib/AboutFooter.svelte";
</script>

<main>
  <h1>Image converter</h1>
  <CustomFileDrop {handleFiles} />
  {#if $processing}
    <Loading />
  {:else}
    <Dropdown />
    {#if $conversionStatus === ConversionStatus.DONE}
      <DownloadBtn zipDataUrl={$downloadLink} />
    {/if}
  {/if}
  <Toast retainMs={5000} />
  <AboutFooter />
</main>

<style>
  :root {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
      Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
  }

  :global(body) {
    background-color: rgb(57, 57, 57);
  }

  main {
    text-align: center;
    padding: 1em;
    margin: 0 auto;
  }

  h1 {
    color: #082233;
    text-transform: uppercase;
    font-size: 3.5rem;
    font-weight: 100;
    line-height: 1.1;
    margin: 2rem auto;
    max-width: 30rem;
    margin-bottom: 50px;
  }

  @media (min-width: 480px) {
    h1 {
      max-width: none;
    }
  }
</style>
