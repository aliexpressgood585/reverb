import { defineConfig } from 'vitest/config';

/**
 * Logic tests only. The game's physics, generator, save format and i18n all run
 * in Node with no DOM — that is a property of the architecture, not a testing
 * trick — so these are milliseconds, and the browser-driven acceptance suite in
 * `scripts/cairn-check.mjs` stays where it is for anything that needs a real
 * pointer or a real canvas.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: { provider: 'v8', include: ['cairn/src/**/*.js'], reporter: ['text-summary'] },
  },
});
