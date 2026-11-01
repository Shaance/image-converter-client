<script lang="ts">
  import { OUTPUT_FORMATS, type OutputFormat } from '../formats';
  let { value, onchange, smaller, onsmaller, server = false, compact = false, disabled = false }: {
    value: OutputFormat; onchange: (format: OutputFormat) => void;
    smaller: boolean; onsmaller: (on: boolean) => void; server?: boolean; compact?: boolean; disabled?: boolean;
  } = $props();
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
  <div role="radiogroup" aria-label="Output format" class:compact>
    {#each OUTPUT_FORMATS as format, index}
      <button type="button" role="radio" aria-checked={value === format.id}
        tabindex={value === format.id ? 0 : -1} {disabled}
        onclick={() => onchange(format.id)} onkeydown={event => navigate(event, index)}>{format.label}</button>
    {/each}
  </div>
  {#if (value === 'jpeg' || value === 'png') && !server}
    <div class="smaller">
      <label class="toggle">
        <input type="checkbox" aria-describedby="smaller-hint" checked={smaller} {disabled}
          onchange={event => onsmaller(event.currentTarget.checked)} />
        Smaller files
      </label>
      <span class="hint" id="smaller-hint">Takes longer, especially for large PNGs</span>
    </div>
  {/if}
</div>

<style>
  .chips { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
  [role="radiogroup"] { display: flex; flex-wrap: wrap; gap: 6px; }
  .smaller { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
  .toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); white-space: nowrap; cursor: pointer; }
  .toggle:has(input:disabled) { cursor: default; }
  .toggle input { width: 14px; height: 14px; flex-shrink: 0; margin: 0; accent-color: var(--teal); }
  .hint { font-size: 12px; color: var(--muted); padding-left: 22px; }
  button { padding: 8px 14px; border: 1px solid var(--rule); border-radius: 999px; color: var(--muted); font-size: 13px; transition: background var(--fast) var(--ease-out), color var(--fast) var(--ease-out); }
  button[aria-checked="true"] { background: var(--ink); border-color: var(--ink); color: var(--bg); font-weight: 500; }
  button:disabled { color: var(--faint); }
  .compact button { padding: 7px 12px; }
  @media (prefers-reduced-motion: no-preference) { button { transition: background var(--fast) var(--ease-out), color var(--fast) var(--ease-out), transform var(--press) var(--ease-out); } }
</style>
