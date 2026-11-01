<script lang="ts">
  import { tick } from 'svelte';
  import { slide, fade } from 'svelte/transition';
  import type { createQueue } from '../queue.svelte';
  import { formatBytes } from '../names';
  import FileRow from './FileRow.svelte';
  let { queue, onclear, onremovelast }: {
    queue: ReturnType<typeof createQueue>; onclear: () => void; onremovelast: (id: string) => void;
  } = $props();
  let header: HTMLHeadingElement;
  let list: HTMLUListElement;
  // This set tracks only insertion animation membership, never conversion state.
  const seen = new Set<string>();
  let addedThisFrame = 0;
  let resetPending = false;
  function insertion(node: Element) {
    const id = (node as HTMLElement).dataset.job!;
    if (seen.has(id)) return {};
    seen.add(id);
    const index = addedThisFrame++;
    if (!resetPending) { resetPending = true; requestAnimationFrame(() => { addedThisFrame = 0; resetPending = false; }); }
    (node as HTMLElement).style.setProperty('--row-delay', `calc(${index} * var(--row-stagger))`);
    if (index < 8) node.classList.add('insert');
    return { destroy() { seen.delete(id); } };
  }
  function removal(node: Element) {
    const duration = parseFloat(getComputedStyle(node).getPropertyValue('--fast'));
    return matchMedia('(prefers-reduced-motion: reduce)').matches ? fade(node, { duration }) : slide(node, { duration });
  }
  async function remove(id: string) {
    // Removing the last row returns to the empty state through App's morph.
    if (queue.fileCount === 1) { onremovelast(id); return; }
    const next = queue.jobs[queue.jobs.findIndex(job => job.id === id) + 1]?.id;
    queue.remove(id);
    await tick();
    const button = next ? Array.from(list.querySelectorAll<HTMLButtonElement>('[data-remove]')).find(item => item.dataset.remove === next) : undefined;
    (button ?? header).focus();
  }
</script>

<section aria-labelledby="file-count">
  <div class="toolbar">
    <div class="summary" aria-live="polite">
      <h2 id="file-count" tabindex="-1" bind:this={header}>{queue.fileCount} {queue.fileCount === 1 ? 'file' : 'files'}</h2>
      <span class="nums">{#if !queue.settled}{formatBytes(queue.bytesIn)} in · {queue.doneCount} of {queue.fileCount} done
        {:else if queue.failedCount}{queue.doneCount} ready · {queue.failedCount} need attention
        {:else}{formatBytes(queue.bytesIn)} → {formatBytes(queue.bytesOut)} · all done{/if}</span>
    </div>
    <button class="clear" onclick={onclear}>Clear all</button>
  </div>
  <ul bind:this={list}>
    {#each queue.jobs as job (job.id)}
      <li data-job={job.id} use:insertion out:removal>
        <FileRow {job} format={queue.format} server={queue.mode === 'server'} single={queue.fileCount === 1}
          onremove={() => remove(job.id)} ondownscale={() => queue.convertDownscaled(job.id)} />
      </li>
    {/each}
  </ul>
</section>

<style>
  section { view-transition-name: list; margin-top: 40px; }
  .toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid var(--ink); }
  .summary { display: flex; align-items: baseline; flex: 1; min-width: 0; gap: 14px; }
  h2 { font: 400 30px var(--serif); margin: 0; white-space: nowrap; }
  .nums { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .clear { min-height: 44px; padding: 0 10px; border-radius: 999px; font-size: 13px; color: var(--muted); white-space: nowrap; }
  ul { list-style: none; padding: 0; margin: 0; }
  li:global(.insert) { animation: row-opacity var(--standard) var(--ease-out) var(--row-delay) backwards; }
  /* The transitioned add runs inside a view transition: no double choreography. */
  :global(html.morphing) li:global(.insert) { animation: none; }
  @keyframes row-opacity { from { opacity: 0; } to { opacity: 1; } }
  @media (prefers-reduced-motion: no-preference) {
    li:global(.insert) { animation-name: row-rise; }
    @keyframes row-rise { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  }
  @media (max-width: 719px) {
    section { margin-top: 28px; padding-bottom: 24px; }
    .toolbar { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 0 12px; }
    .summary { flex-wrap: wrap; gap: 6px 14px; }
    h2 { font-size: 24px; }
    .clear { grid-column: 2; grid-row: 1; }
  }
</style>
