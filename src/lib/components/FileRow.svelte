<script lang="ts">
  import { fade } from 'svelte/transition';
  import type { Job } from '../queue.svelte';
  import { OUTPUT_FORMATS, type OutputFormat } from '../formats';
  import { formatBytes, outputName } from '../names';
  import Icons from './Icons.svelte';
  let { job, format, onremove, ondownscale }: {
    job: Job; format: OutputFormat; onremove: () => void; ondownscale: () => void;
  } = $props();
  const label = $derived(OUTPUT_FORMATS.find(item => item.id === format)!.label);
  const name = $derived(outputName(job.name, format));
  const kind = $derived(job.kind === 'unrecognized' ? '' : job.kind === 'webp' ? 'WebP' : job.kind.toUpperCase());
  const error = $derived.by(() => {
    switch (job.error?.code) {
      case 'unrecognized': return 'Not an image we can read';
      case 'worker-lost': return 'The converter stopped. Reload the page to continue.';
      case 'failed': return "Couldn't convert this file";
      case 'too-large': return job.error.pixels && job.error.limit
        ? `Too large for this browser (${Math.round(job.error.pixels / 1e6)} MP, limit ${Math.round(job.error.limit / 1e6)} MP)`
        : 'Too large for this browser';
      default: return '';
    }
  });
  function crossfade(node: Element) {
    return fade(node, { duration: parseFloat(getComputedStyle(node).getPropertyValue('--fast')) });
  }
</script>

<div class="row">
  <div class="thumbnail">
    {#if job.thumbnailUrl}<img src={job.thumbnailUrl} alt="" width="44" height="44" />{:else}<span>{kind}</span>{/if}
  </div>
  <div class="details">
    <div class="name" title={job.name}>{job.name}</div>
    <div class="meta">{kind ? `${kind} · ` : ''}{formatBytes(job.bytes)}{#if job.status === 'done' && job.result}{' → '}{formatBytes(job.result.bytes)}{#if job.result.downscaled} · resized to {Math.round(job.result.width * job.result.height / 1e6)} MP{/if}{/if}</div>
  </div>
  <div class="status" class:error={!!error}>
    {#key job.status === 'done'}
      <div class="status-content" transition:crossfade>
        {#if job.status === 'done'}<span class="done"><Icons name="check" /> Done</span>
        {:else if job.status === 'converting'}
          <span>{job.kind === 'heic' && job.phase === 'loading-codec' ? 'Loading HEIC decoder…' : 'Converting…'}</span>
          <div class="track" aria-hidden="true"><span></span></div>
        {:else if job.status === 'queued'}Queued
        {:else}{error}{/if}
        {#if job.status === 'awaiting-downscale'}
          <button class="downscale" onclick={ondownscale}>Convert at {Math.round(job.error!.limit! / 1e6)} MP</button>
        {/if}
      </div>
    {/key}
  </div>
  <div class="actions">
    {#if job.status === 'done' && job.result}
      <a href={job.result.url} download={name} aria-label={`Download ${name}`}><Icons name="download" /><span>{label}</span></a>
    {/if}
    <button class="remove" data-remove={job.id} aria-label={`Remove ${job.name}`} onclick={onremove}><Icons name="remove" size={14} /></button>
  </div>
</div>

<style>
  .row { display: grid; grid-template-columns: 44px 1fr 120px 200px 120px; align-items: center; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--rule); scroll-margin-bottom: 160px; }
  .thumbnail { width: 44px; height: 44px; border-radius: 6px; background: var(--surface); overflow: hidden; display: grid; place-items: center; color: var(--muted); font-size: 13px; }
  img { width: 100%; height: 100%; object-fit: cover; }
  .details { min-width: 0; }
  .name { font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { font-size: 13px; color: var(--muted); margin-top: 2px; overflow-wrap: anywhere; }
  .status { display: grid; font-size: 13px; color: var(--muted); grid-column: 3 / 5; }
  .status-content { grid-area: 1 / 1; max-width: 200px; }
  .done { display: flex; align-items: center; gap: 6px; color: var(--teal); }
  .error, .downscale { color: var(--terracotta); }
  .downscale { display: block; padding: 0; margin-top: 6px; text-decoration: underline; text-underline-offset: 2px; text-align: left; }
  .track { height: 3px; background: var(--rule); overflow: hidden; margin-top: 6px; width: 120px; }
  .track span { display: block; width: 40%; height: 100%; background: var(--teal); }
  .actions { grid-column: 5; display: flex; justify-content: flex-end; align-items: center; gap: 6px; }
  a { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
  .remove { width: 32px; height: 32px; display: grid; place-items: center; padding: 0; color: var(--muted); flex-shrink: 0; }
  @media (prefers-reduced-motion: no-preference) {
    .track span { width: 30%; animation: progress var(--progress) linear infinite; }
    @keyframes progress { from { transform: translateX(-100%); } to { transform: translateX(334%); } }
  }
  @media (max-width: 719px) {
    .row { grid-template-columns: 40px 1fr auto; gap: 6px 12px; padding: 12px 0; }
    .thumbnail { width: 40px; height: 40px; }
    .status { grid-column: 2; grid-row: 2; }
    .actions { grid-column: 3; grid-row: 1 / 3; }
    a { padding: 10px 0; gap: 4px; }
    .actions a span { display: none; }
  }
</style>
