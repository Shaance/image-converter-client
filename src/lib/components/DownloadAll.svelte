<script lang="ts">
  import type { ZipState } from '../queue.svelte';
  import { formatBytes } from '../names';
  import Icons from './Icons.svelte';
  let { zip, bytes }: { zip: ZipState; bytes: number } = $props();
</script>

<div class="download-all">
  <div class="pill" class:ready={zip.status === 'ready'}>
  {#if zip.status === 'ready' && zip.url}
    <a download="converted.zip" href={zip.url}><Icons name="download" />Download all · {formatBytes(bytes)}</a>
  {:else}
    <button disabled><Icons name="download" />{zip.status === 'preparing' ? 'Preparing zip…' : 'Download all · zip'}</button>
  {/if}
  </div>
  <p>{zip.status === 'ready' ? 'One zip with every converted file. Or tap a file to save it alone.' : 'Download all becomes available when every file is done.'}</p>
</div>

<style>
  .download-all { display: flex; align-items: center; justify-content: space-between; gap: 24px; margin-top: 28px; }
  a, button { display: flex; align-items: center; justify-content: center; gap: 10px; padding: 12px 20px; border-radius: 999px; font-size: 14px; font-weight: 500; white-space: nowrap;  }
  .pill { border-radius: 999px; background: var(--rule); color: var(--faint); transition: background var(--standard) var(--ease-out), color var(--standard) var(--ease-out); }
  .pill.ready { background: var(--teal); color: var(--on-teal); }
  a, button, a:hover { color: inherit; }
  p { order: -1; margin: 0; color: var(--muted); font-size: 13px; }
  @media (max-width: 719px) {
    .download-all { position: sticky; bottom: 0; z-index: 1; flex-direction: column; gap: 12px; margin-top: auto; padding: 12px 0 env(safe-area-inset-bottom); background: var(--bg); }
    .pill { width: 100%; }
    a, button { width: 100%; height: 52px; font-size: 16px; }
    p { order: 0; text-align: center; }
  }
</style>
