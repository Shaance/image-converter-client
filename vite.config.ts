import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  plugins: [svelte()],
  worker: { format: 'es' },
  build: { target: ['chrome80', 'firefox114', 'safari17'] },
  optimizeDeps: { exclude: ['@jsquash/webp'] },
  test: { environment: 'node' },
});
