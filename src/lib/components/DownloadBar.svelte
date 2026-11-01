<script lang="ts">
  import type { createQueue } from '../queue.svelte';
  import { formatBytes, outputName } from '../names';
  import Icons from './Icons.svelte';
  let { queue }: { queue: ReturnType<typeof createQueue> } = $props();
  const done = $derived(queue.jobs.filter(job => job.status === 'done' && job.result));
  // Hidden when every row failed: nothing to download.
  const show = $derived(!queue.settled || done.length > 0);
  // Settled with exactly one done row: link straight to that file, no zip.
  const single = $derived(queue.settled && done.length === 1 ? done[0] : undefined);
  const zipReady = $derived(queue.zip.status === 'ready' && !!queue.zip.url && done.length >= 2);
  const ready = $derived(!!single || zipReady);
  const singleName = $derived(single ? outputName(single.name, queue.format) : '');
</script>

{#if show}
  <div class="bar">
    <div class="pill" class:ready>
      <span class="labels">
        <span class:active={!queue.settled && queue.fileCount === 1}>Converting…</span>
        <span class:active={!queue.settled && queue.fileCount > 1}>Converting · {queue.doneCount} of {queue.fileCount}</span>
        <span class:active={!!single}><Icons name="download" size={16} />Download · {formatBytes(single?.result?.bytes ?? 0)}</span>
        <span class:active={!single && queue.settled && !zipReady}>Preparing zip…</span>
        <span class:active={zipReady && !queue.failedCount}><Icons name="download" size={16} />Download all · {formatBytes(queue.bytesOut)}</span>
        <span class:active={zipReady && queue.failedCount > 0}><Icons name="download" size={16} />Download {queue.doneCount} files · {formatBytes(queue.bytesOut)}</span>
      </span>
      {#if ready}
        <a class="cover" href={single ? single.result!.url : queue.zip.url!}
          download={single ? singleName : 'converted.zip'}
          aria-label={single ? `Download ${singleName}` : queue.failedCount ? `Download ${queue.doneCount} files` : 'Download all'}></a>
      {/if}
    </div>
  </div>
{/if}

<style>
  .bar { view-transition-name: actions; display: flex; justify-content: flex-end; margin-top: 28px; }
  .pill { position: relative; display: inline-flex; align-items: center; border-radius: 999px; background: var(--rule); color: var(--muted); transition: background var(--standard) var(--ease-out), color var(--standard) var(--ease-out); }
  .pill.ready { background: var(--teal); color: var(--on-teal); }
  /* Stacked cell: every label occupies one grid cell, so the pill height never
     changes and the quiet -> ready swap crossfades. */
  .labels { display: grid; padding: 12px 20px; font-size: 14px; font-weight: 500; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .labels span { grid-area: 1 / 1; justify-self: center; display: inline-flex; align-items: center; gap: 8px; }
  .labels span:not(.active) { visibility: hidden; }
  .cover { position: absolute; inset: 0; border-radius: 999px; }
  @media (prefers-reduced-motion: no-preference) {
    .labels span { transition: opacity var(--fast) var(--ease-out), visibility var(--fast); }
    .labels span:not(.active) { opacity: 0; }
  }
  @media (max-width: 719px) {
    .bar { position: sticky; bottom: 0; z-index: 1; margin: auto -20px 0; padding: 12px 20px calc(12px + env(safe-area-inset-bottom)); background: var(--bg); border-top: 1px solid var(--rule); }
    .pill { width: 100%; }
    .labels { width: 100%; height: 52px; padding: 0 20px; justify-content: center; font-size: 16px; }
  }
</style>
