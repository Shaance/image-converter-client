<script lang="ts">
  import { SERVER_URL } from '../server';
  import type { ConversionMode } from '../queue.svelte';
  let { mode, onchange, disabled = false }: {
    mode: ConversionMode; onchange: (mode: ConversionMode) => void; disabled?: boolean;
  } = $props();
  const host = $derived(new URL(SERVER_URL).host);
</script>

<div class="switch">
  <fieldset aria-label="Conversion mode">
    <label class:selected={mode === 'device'}><input class="visually-hidden" type="radio" name="mode"
      value="device" checked={mode === 'device'} {disabled} onchange={() => onchange('device')} />On device</label>
    <label class:selected={mode === 'server'}><input class="visually-hidden" type="radio" name="mode"
      value="server" checked={mode === 'server'} {disabled} onchange={() => onchange('server')} />Server</label>
  </fieldset>
  {#if mode === 'server'}
    <p class="server-note">Photos are uploaded to {host}, converted, and deleted right away.</p>
  {/if}
</div>

<style>
  .switch { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
  fieldset { display: flex; margin: 0; border: 1px solid var(--rule); border-radius: 999px; padding: 3px; gap: 2px; font-size: 13px; }
  label { padding: 7px 14px; border-radius: 999px; display: flex; align-items: center; gap: 6px; }
  .selected { background: var(--ink); color: var(--bg); font-weight: 500; }
  label:has(:focus-visible) { outline: 2px solid var(--teal); outline-offset: 2px; }
  label:has(input:disabled) { color: var(--faint); }
  .server-note { margin: 0; font-size: 12px; color: var(--muted); text-align: right; }
  @media (max-width: 719px) {
    label { padding: 6px 11px; }
    .server-note { text-align: left; }
  }
</style>
