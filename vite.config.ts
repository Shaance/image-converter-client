import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  plugins: [svelte()],
  worker: { format: 'es' },
  build: { target: ['chrome80', 'firefox114', 'safari17'] },
  optimizeDeps: { exclude: ['@jsquash/webp', '@jsquash/avif', '@jsquash/jxl', '@jsquash/jpeg', '@jsquash/oxipng', '@wasmedia/wlibraw'] },
  // Tests run against a fixed placeholder server, never a real one.
  test: { environment: 'node', env: { VITE_SERVER_URL: 'https://converter.test/' } },
});
