<script lang="ts">
  let { name, size = 16 }: { name: 'upload' | 'download' | 'check' | 'remove' | 'lock'; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
  stroke-width={name === 'check' ? 1.75 : 1.5} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'upload'}<path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10" />
  {:else if name === 'download'}<path d="M8 3v8M4.5 7.5 8 11l3.5-3.5M3 13h10" />
  {:else if name === 'check'}<path d="M3 8.5 6.5 12 13 4.5" />
  {:else if name === 'remove'}<path d="M4 4l8 8M12 4l-8 8" />
  {:else}<rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />{/if}
</svg>

<style>svg { flex-shrink: 0; }</style>
