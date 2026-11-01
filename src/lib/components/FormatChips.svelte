<script lang="ts">
  import { OUTPUT_FORMATS, type OutputFormat } from '../formats';
  let { value, onchange, smaller, onsmaller, server = false, disabled = false }: {
    value: OutputFormat; onchange: (format: OutputFormat) => void;
    smaller: boolean; onsmaller: (on: boolean) => void; server?: boolean; disabled?: boolean;
  } = $props();
  // The stored preference survives: when not applicable the switch is disabled
  // and shown off, but `smaller` itself is kept for when it applies again.
  const applicable = $derived((value === 'jpeg' || value === 'png') && !server);
  const shown = $derived(smaller && applicable);
  function navigate(event: KeyboardEvent, index: number) {
    const direction = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const next = (index + direction + OUTPUT_FORMATS.length) % OUTPUT_FORMATS.length;
    onchange(OUTPUT_FORMATS[next].id);
    const group = (event.currentTarget as HTMLElement).parentElement!;
    group.querySelectorAll<HTMLButtonElement>('button')[next].focus();
  }
</script>

<div class="chips">
  <div role="radiogroup" aria-label="Output format">
    {#each OUTPUT_FORMATS as format, index}
      <button type="button" role="radio" aria-checked={value === format.id}
        tabindex={value === format.id ? 0 : -1} {disabled}
        onclick={() => onchange(format.id)} onkeydown={event => navigate(event, index)}>{format.label}</button>
    {/each}
  </div>
  <div class="smaller">
    <label class="toggle">
      <input type="checkbox" role="switch" aria-describedby="smaller-hint" checked={shown}
        disabled={!applicable || disabled} onchange={event => onsmaller(event.currentTarget.checked)} />
      Compress files
    </label>
    <span class="hint" id="smaller-hint">
      <span class:active={value === 'jpeg' && !server}>Smaller files at slightly lower quality. Slower.</span>
      <span class:active={value === 'png' && !server}>Smaller files, same quality. Slower.</span>
      <span class:active={value !== 'jpeg' && value !== 'png' && !server}>Available for JPEG and PNG</span>
      <span class:active={server}>Available on device only</span>
    </span>
  </div>
</div>

<style>
  .chips { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
  [role="radiogroup"] { display: flex; flex-wrap: wrap; gap: 6px; }
  .smaller { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
  .toggle { display: flex; align-items: center; gap: 10px; min-height: 44px; width: fit-content; font-size: 13px; color: var(--muted); white-space: nowrap; cursor: pointer; }
  .toggle:has(input:disabled) { cursor: default; color: var(--faint); }
  .toggle input { appearance: none; -webkit-appearance: none; position: relative; width: 36px; height: 22px; margin: 0; flex-shrink: 0; border: 1px solid var(--dashed); border-radius: 999px; background: var(--rule); cursor: pointer; --knob: #fff; }
  .toggle input::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--knob); box-shadow: 0 1px 2px rgb(0 0 0 / .2); }
  .toggle input:checked { background: var(--ink); border-color: var(--ink); }
  .toggle input:checked::after { transform: translateX(14px); background: var(--bg); }
  .toggle input:disabled { cursor: default; opacity: .5; }
  @media (prefers-color-scheme: dark) { .toggle input { --knob: var(--muted); } }
  /* Stacked cell: all four strings occupy one grid cell, so the hint height never changes. */
  .hint { display: grid; padding-left: 46px; font-size: 12px; color: var(--muted); }
  .hint span { grid-area: 1 / 1; }
  .hint span:not(.active) { visibility: hidden; }
  button { padding: 8px 14px; border: 1px solid var(--rule); border-radius: 999px; color: var(--muted); font-size: 13px; transition: background var(--fast) var(--ease-out), color var(--fast) var(--ease-out); }
  button[aria-checked="true"] { background: var(--ink); border-color: var(--ink); color: var(--bg); font-weight: 500; }
  button:disabled { color: var(--faint); }
  @media (prefers-reduced-motion: no-preference) {
    .toggle input, .toggle input::after { transition: background var(--fast) var(--ease-out), border-color var(--fast) var(--ease-out), transform var(--fast) var(--ease-out); }
    .hint span { transition: opacity var(--fast) var(--ease-out), visibility var(--fast); }
    .hint span:not(.active) { opacity: 0; }
    button { transition: background var(--fast) var(--ease-out), color var(--fast) var(--ease-out), transform var(--press) var(--ease-out); }
  }
</style>
