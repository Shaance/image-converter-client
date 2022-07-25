<script lang="ts">
  import { progress } from "../stores";
  import { fade } from 'svelte/transition';
</script>

<!-- svelte-ignore component-name-lowercase -->
<progress value={$progress} transition:fade />

<style>
  progress {
    display: block;
    width: 100%;
  }
</style>
