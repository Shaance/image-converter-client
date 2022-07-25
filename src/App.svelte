<script lang="ts">
  import {
    conversionStatus,
    ConversionStatus,
    processing,
    downloadLink,
  } from "./lib/stores";
  import { handleFiles } from "./lib/convert";
  import CustomFileDrop from "./lib/components/CustomFileDrop.svelte";
  import Loading from "./lib/components/Loading.svelte";
  import DownloadBtn from "./lib/components/DownloadBtn.svelte";
  import Toast from "./lib/components/Toast.svelte";
  import Dropdown from "./lib/components/Dropdown.svelte";
  import AboutFooter from "./lib/components/AboutFooter.svelte";
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
