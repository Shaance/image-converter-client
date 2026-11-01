<script lang="ts">
  import type { ConversionMode } from '../queue.svelte';
  let { mode, onchange, disabled = false }: {
    mode: ConversionMode; onchange: (mode: ConversionMode) => void; disabled?: boolean;
  } = $props();
</script>

<fieldset class="switch" class:server={mode === 'server'} aria-label="Conversion mode">
  <span class="thumb" aria-hidden="true"></span>
  <label class:selected={mode === 'device'}><input class="visually-hidden" type="radio" name="mode"
    value="device" checked={mode === 'device'} {disabled} onchange={() => onchange('device')} />On device</label>
  <label class:selected={mode === 'server'}><input class="visually-hidden" type="radio" name="mode"
    value="server" checked={mode === 'server'} {disabled} onchange={() => onchange('server')} />Server</label>
</fieldset>

<style>
  /* Equal-width segments with one sliding ink thumb: the switch keeps its size
     in both modes, so nothing below the header moves. */
  .switch { position: relative; display: grid; grid-template-columns: 1fr 1fr; min-width: 0; margin: 0; padding: 3px; border: 1px solid var(--rule); border-radius: 999px; font-size: 13px; }
  .thumb { position: absolute; top: 3px; bottom: 3px; left: 3px; width: calc((100% - 6px) / 2); border-radius: 999px; background: var(--ink); }
  .switch.server .thumb { transform: translateX(100%); }
  label { position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; padding: 7px 14px; border-radius: 999px; white-space: nowrap; font-weight: 500; color: var(--muted); cursor: pointer; }
  /* Same weight in both states, so the segments never change width. */
  .selected { color: var(--bg); }
  label:has(:focus-visible) { outline: 2px solid var(--teal); outline-offset: 2px; }
  label:has(input:disabled) { color: var(--faint); cursor: default; }
  @media (prefers-reduced-motion: no-preference) {
    .thumb { transition: transform var(--standard) var(--ease-out); }
    label { transition: color var(--standard) var(--ease-out); }
  }
  @media (max-width: 719px) { label { padding: 6px 11px; } }
  @media (max-width: 389px) { label { padding: 6px 9px; } }
</style>
