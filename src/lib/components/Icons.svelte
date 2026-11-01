<script lang="ts">
  let { name, size = 16 }: { name: 'upload' | 'download' | 'check' | 'remove' | 'lock' | 'github'; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 16 16" fill={name === 'github' ? 'currentColor' : 'none'} stroke={name === 'github' ? 'none' : 'currentColor'}
  stroke-width={name === 'check' ? 1.75 : 1.5} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'upload'}<path d="M8 11V3M4.5 6.5 8 3l3.5 3.5M3 13h10" />
  {:else if name === 'download'}<path d="M8 3v8M4.5 7.5 8 11l3.5-3.5M3 13h10" />
  {:else if name === 'check'}<path d="M3 8.5 6.5 12 13 4.5" />
  {:else if name === 'remove'}<path d="M4 4l8 8M12 4l-8 8" />
  {:else if name === 'github'}<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
  {:else}<rect x="3.5" y="7" width="9" height="6.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />{/if}
</svg>

<style>svg { flex-shrink: 0; }</style>
