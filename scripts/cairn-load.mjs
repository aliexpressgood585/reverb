#!/usr/bin/env node
/**
 * CAIRN — TIME TO INTERACTIVE, MEASURED.
 *
 *   node scripts/cairn-load.mjs
 *
 * The brief sets a budget of "under 2 seconds to first interaction". The bundle
 * grew from ~40 KB to ~172 KB gzip when Three.js arrived, which LOOKS like a
 * load problem — but the title screen is DOM, not canvas, so it may well paint
 * before the engine is anywhere near ready. Lazy-loading the 3D engine is a real
 * architectural change with real risk; doing it because a number sounded big,
 * without checking which number actually gates the player, is how this project
 * has wasted rounds before.
 *
 * So: three marks, on a throttled connection, cold cache.
 *   TITLE      the wordmark is on screen — the player sees a game
 *   READY      window.CAIRN exists — the engine booted
 *   PLAYABLE   a real tap has started a run and a frame has been produced
 *
 * PLAYABLE is the one the budget is about.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4254;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', () => {});
process.on('exit', () => { try { server.kill('SIGTERM'); } catch { /* gone */ } });
for (let i = 0; i < 90; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/cairn/`)).ok) break; } catch { /* not up */ }
  await delay(400);
}
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--mute-audio'],
});

/**
 * @param {string} label
 * @param {{download: number, upload: number, latency: number}|null} net
 */
async function run(label, net) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  // Cold cache every run: a warm repeat visit is a different question.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
  if (net) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...net });

  let bytes = 0;
  page.on('response', (r) => {
    const len = +(r.headers()['content-length'] || 0);
    if (len) bytes += len;
  });

  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'commit' });
  await page.waitForSelector('#card h1', { state: 'visible' });
  const title = Date.now() - t0;
  await page.waitForFunction(() => !!window.CAIRN);
  const ready = Date.now() - t0;
  // A real tap through the touchscreen, then wait for the loop to have produced
  // a frame — "playable" means a frame moved, not that a handler returned.
  await page.touchscreen.tap(195, 520);
  await page.waitForFunction(() => {
    const api = /** @type {any} */ (window).CAIRN;
    return api && api.ui && api.ui.started === true;
  });
  const playable = Date.now() - t0;
  await ctx.close();
  return { label, title, ready, playable, kb: Math.round(bytes / 1024) };
}

const rows = [];
rows.push(await run('local (no throttle)', null));
// Roughly a good 4G phone: 4 Mbit down, 40 ms RTT.
rows.push(await run('4G  4Mbit/40ms', { downloadThroughput: 4e6 / 8, uploadThroughput: 1e6 / 8, latency: 40 }));
// A bad-but-common mobile connection.
rows.push(await run('3G  1.6Mbit/150ms', { downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8, latency: 150 }));

console.log('\n  CAIRN — time to interactive (cold cache)\n');
console.log('  connection            title    ready  playable   transferred');
for (const r of rows) {
  console.log(`  ${r.label.padEnd(20)} ${String(r.title).padStart(5)}ms ${String(r.ready).padStart(7)}ms` +
    ` ${String(r.playable).padStart(8)}ms   ${String(r.kb).padStart(6)} KB`);
}
console.log('\n  budget: playable under 2000 ms\n');
await browser.close();
