<script lang="ts">
  import Icons from './Icons.svelte';
  let { variant = 'hero', message, disabled = false, onadd }: {
    variant?: 'hero' | 'compact'; message?: string; disabled?: boolean; onadd: (files: File[]) => void;
  } = $props();
  let dragging = $state(false);
  let depth = 0;
  let input = $state<HTMLInputElement>();
  let notice = $state<HTMLParagraphElement>();
  export function focus() { (message ? notice : input)?.focus(); }
  function drop(event: DragEvent) {
    event.preventDefault(); dragging = false; depth = 0;
    if (!disabled && event.dataTransfer) onadd(Array.from(event.dataTransfer.files));
  }
</script>

{#if message}
  <p bind:this={notice} tabindex="-1" class="notice">{message}</p>
{:else}
  <label class:hero={variant === 'hero'} class:compact={variant === 'compact'} class:dragging
    ondragenter={event => { event.preventDefault(); if (!disabled) { depth++; dragging = true; } }}
    ondragover={event => event.preventDefault()}
    ondragleave={() => { if (--depth <= 0) { depth = 0; dragging = false; } }} ondrop={drop}>
    <input bind:this={input} class="visually-hidden" type="file" multiple {disabled}
      accept="image/*,.heic,.heif,image/heic,image/heif"
      onchange={event => { onadd(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ''; }} />
    <span class="icon"><Icons name="upload" /></span>
    <span class="prompt">{variant === 'hero' ? 'Drop images here, or' : 'Drop more images here, or'} <span class="browse">browse</span></span>
    {#if variant === 'hero'}<span class="hint">HEIC, JPEG, PNG, WebP, GIF, BMP</span>{/if}
  </label>
{/if}

<style>
  label { display: flex; align-items: center; justify-content: center; border: 1.5px dashed var(--dashed); border-radius: 12px; background: var(--surface); color: var(--muted); cursor: pointer; transition: border-color var(--fast) var(--ease-out), background var(--fast) var(--ease-out); }
  label:has(:focus-visible), .notice:focus { outline: 2px solid var(--teal); outline-offset: 2px; }
  .hero { min-height: 260px; flex-direction: column; gap: 12px; }
  .compact { margin-top: 40px; padding: 18px; gap: 10px; font-size: 14px; }
  .hero .prompt { font-size: 17px; }
  .prompt { color: var(--ink); }
  .icon { display: flex; color: var(--teal); }
  .browse { color: var(--teal); border-bottom: 1px solid currentColor; }
  .hint, .notice { font-size: 13px; color: var(--muted); }
  .notice { padding: 18px; border: 1px solid var(--rule); border-radius: 12px; }
  .dragging { border-style: solid; border-color: var(--teal); background: var(--rule); }
  @media (max-width: 719px) { .compact { margin-top: 24px; padding: 16px; gap: 8px; } }
  @media (prefers-reduced-motion: no-preference) { label { transition: border-color var(--fast) var(--ease-out), background var(--fast) var(--ease-out), transform var(--press) var(--ease-out); } }
</style>
