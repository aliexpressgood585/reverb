import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * The Android build. CAIRN alone, at the root of its own output.
 *
 * The web deploy serves two games from one tree — REVERB at `/` and CAIRN at
 * `/cairn/` — so `dist/cairn/index.html` reaches its bundle through `../assets/`.
 * Capacitor copies `webDir` to the APK's asset root and opens `index.html` from
 * there, and `../` from an asset root is outside the WebView's world.
 *
 * So the app build sets `root` to `cairn/`, which makes CAIRN's index the only
 * entry and puts its assets alongside it. REVERB is not in the app; the store
 * listing is for one game.
 *
 * `public/` is deliberately NOT copied: the only thing in it is the service
 * worker tombstone, and a packaged app has no service worker to unregister —
 * it is served from the filesystem. See DECISIONS.md §21.
 */
export default defineConfig({
  root: resolve(root, 'cairn'),
  base: './',
  publicDir: false,
  build: {
    target: 'es2020',
    outDir: resolve(root, 'dist-android'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
  },
});
