<script lang="ts">
  import { fade } from "svelte/transition";
  export let zipDataUrl: string;
  export let onClick = () => {};
</script>

<a href={zipDataUrl}>
  <button class="tertiary" transition:fade on:click={onClick}>
    Download
  </button>
</a>

<style>
  button {
    border: 2px solid rgb(69, 64, 104);
    background-color: #373b45;

    font-size: 0.875rem;
    line-height: 1.28572;
    letter-spacing: 0.16px;
    position: relative;
    display: inline-flex;
    max-width: 20rem;
    min-height: 3rem;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    margin: 0;
    border-radius: 0;
    cursor: pointer;
    outline: none;
    text-align: left;
    text-decoration: none;
  }

  .tertiary {
    min-height: 2rem;
    border-width: 1px;
    border-style: solid;
    border-color: #fff;
    background-color: rgba(0, 0, 0, 0);
    color: #fff;
    height: 20px;
    padding: 12px;
  }

  a {
    text-decoration: none;
  }

  button:hover {
    background-color: white;
    color: black !important;
  }
</style>
