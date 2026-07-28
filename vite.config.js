import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
    // Two games, one deploy. REVERB stays at the root and CAIRN sits at
    // /cairn/, so a push publishes both and neither can break the other. They
    // share the toolchain and nothing else.
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        cairn: resolve(root, 'cairn/index.html'),
      },
    },
  },
  server: { host: '127.0.0.1', port: 5173 },
  preview: { host: '127.0.0.1', port: 4173 },
});
