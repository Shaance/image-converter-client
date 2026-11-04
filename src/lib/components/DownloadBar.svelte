<script lang="ts">
  import { onMount } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { cubicOut, cubicIn } from 'svelte/easing';
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
  // Overall progress glides inside the pill: each settled row eases the fill.
  const progress = $derived(queue.fileCount ? queue.doneCount / queue.fileCount : 0);
  // Milestone toast when the download becomes available; auto-dismisses.
  let toastVisible = $state(false);
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  onMount(() => () => clearTimeout(toastTimer));
  $effect(() => {
    if (ready) {
      toastVisible = true;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toastVisible = false; }, 4000);
    } else {
      toastVisible = false;
    }
  });
  function toastTransition(node: Element, intro: boolean) {
    const fast = parseFloat(getComputedStyle(node).getPropertyValue('--fast'));
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return fade(node, { duration: fast });
    return intro ? fly(node, { y: 14, duration: 260, easing: cubicOut })
      : fly(node, { y: 8, duration: 200, easing: cubicIn });
  }
</script>

{#if show}
  <div class="bar">
    <div class="pill" class:ready>
      <span class="fill" style="--p:{progress}" aria-hidden="true"></span>
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
{#if toastVisible && ready}
  <a class="toast" href={single ? single.result!.url : queue.zip.url!} download={single ? singleName : 'converted.zip'}
    in:toastTransition={true} out:toastTransition={false}>
    <Icons name="check" size={14} /> {single ? `Ready — ${singleName}` : 'Archive ready — converted.zip'}
  </a>
{/if}

<style>
  .bar { view-transition-name: actions; display: flex; justify-content: flex-end; margin-top: 28px; }
  .pill { position: relative; overflow: hidden; display: inline-flex; align-items: center; border-radius: 999px; background: var(--rule); color: var(--muted); transition: background var(--standard) var(--ease-out), color var(--standard) var(--ease-out); }
  .pill.ready { background: var(--teal); color: var(--on-teal); }
  /* Progress fill: a quiet teal wash that eases with each settled row, hidden
     once the pill itself turns teal. */
  .fill { position: absolute; inset: 0; border-radius: 999px; background: var(--teal); opacity: .16; transform: scaleX(var(--p, 0)); transform-origin: left; }
  /* Stacked cell: every label occupies one grid cell, so the pill height never
     changes and the quiet -> ready swap crossfades. */
  .labels { position: relative; display: grid; padding: 12px 20px; font-size: 14px; font-weight: 500; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .labels span { grid-area: 1 / 1; justify-self: center; display: inline-flex; align-items: center; gap: 8px; }
  .labels span:not(.active) { visibility: hidden; }
  .cover { position: absolute; inset: 0; z-index: 1; border-radius: 999px; }
  .toast { position: fixed; right: 24px; bottom: 24px; z-index: 10; display: inline-flex; align-items: center; gap: 8px;
    background: var(--ink); color: var(--bg); font-size: 13px; padding: 10px 16px; border-radius: 10px;
    box-shadow: 0 8px 24px rgb(0 0 0 / .18); }
  .toast :global(svg) { color: var(--teal); }
  @media (prefers-reduced-motion: no-preference) {
    .fill { transition: transform 280ms var(--ease-out), opacity var(--fast) var(--ease-out); }
    .pill.ready .fill { opacity: 0; }
    .labels span { transition: opacity var(--fast) var(--ease-out), visibility var(--fast); }
    .labels span:not(.active) { opacity: 0; }
  }
  @media (max-width: 719px) {
    .bar { position: sticky; bottom: 0; z-index: 1; margin: auto -20px 0; padding: 12px 20px calc(12px + env(safe-area-inset-bottom)); background: var(--bg); border-top: 1px solid var(--rule); }
    .pill { width: 100%; }
    .labels { width: 100%; height: 52px; padding: 0 20px; justify-content: center; font-size: 16px; }
    .toast { left: 16px; right: 16px; bottom: calc(88px + env(safe-area-inset-bottom)); justify-content: center; }
  }
</style>
