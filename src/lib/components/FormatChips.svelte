<script lang="ts">
  import { OUTPUT_FORMATS, type OutputFormat } from '../formats';
  let { value, onchange, compact = false, disabled = false }: {
    value: OutputFormat; onchange: (format: OutputFormat) => void; compact?: boolean; disabled?: boolean;
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

<div role="radiogroup" aria-label="Output format" class:compact>
  {#each OUTPUT_FORMATS as format, index}
    <button type="button" role="radio" aria-checked={value === format.id}
      tabindex={value === format.id ? 0 : -1} {disabled}
      onclick={() => onchange(format.id)} onkeydown={event => navigate(event, index)}>{format.label}</button>
  {/each}
</div>

<style>
  div { display: flex; flex-wrap: wrap; gap: 6px; }
  button { padding: 8px 14px; border: 1px solid var(--rule); border-radius: 999px; color: var(--muted); font-size: 13px; transition: background var(--fast) var(--ease-out), color var(--fast) var(--ease-out); }
  button[aria-checked="true"] { background: var(--ink); border-color: var(--ink); color: var(--bg); font-weight: 500; }
  button:disabled { color: var(--faint); }
  .compact button { padding: 7px 12px; }
  @media (prefers-reduced-motion: no-preference) { button { transition: background var(--fast) var(--ease-out), color var(--fast) var(--ease-out), transform var(--press) var(--ease-out); } }
</style>
