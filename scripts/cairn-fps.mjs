#!/usr/bin/env node
/**
 * CAIRN — THE FRAME RATE A PLAYER ACTUALLY GETS.
 *
 *   node scripts/cairn-fps.mjs
 *
 * WHY NOT TIME `draw()` DIRECTLY. The first attempt wrapped `city.draw` in
 * performance.now() and reported 6 ms empty / 30 ms full. Those numbers were
 * wrong and the control proved it: hiding the stones made the frame SLOWER
 * (2.5 -> 16 ms) and hiding the skyline slower still (28 ms). Hiding work
 * cannot cost time. WebGL calls are asynchronous — timing them from JS measures
 * SUBMISSION to the command queue, not execution, so a tight loop just measures
 * how far the GPU has fallen behind.
 *
 * So this measures the only thing that is not an artifact: the interval between
 * real animation frames, in the live game loop, over a real span of seconds.
 * That is what a player feels, it includes everything (sim, draw, post, GPU),
 * and it cannot be fooled by queue depth.
 *
 * Software raster here, so absolute FPS is far below a phone's. The comparison
 * that carries meaning is EMPTY TOWER vs FULL TOWER on the same machine: that
 * ratio is the thing CAIRN's design depends on, because the tower only grows.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4253;
const SECONDS = 4;
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
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
});
page.on('pageerror', (e) => console.log('  PAGE ERROR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);
await delay(700);
await page.touchscreen.tap(195, 520);
await delay(600);

/** Sample real frame intervals for `ms` milliseconds. */
const sample = (ms) => page.evaluate((span) => new Promise((done) => {
  /** @type {number[]} */ const gaps = [];
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    gaps.push(now - last);
    last = now;
    if (now - start < span) requestAnimationFrame(tick);
    else {
      gaps.sort((a, b) => a - b);
      const med = gaps[gaps.length >> 1];
      const p95 = gaps[Math.floor(gaps.length * 0.95)];
      done({
        frames: gaps.length,
        medianMs: +med.toFixed(2),
        p95Ms: +p95.toFixed(2),
        fps: +(1000 / med).toFixed(1),
      });
    }
  };
  const start = performance.now();
  requestAnimationFrame(tick);
}), ms);

const empty = await sample(SECONDS * 1000);

const n = await page.evaluate(() => {
  const { sim, camera } = /** @type {any} */ (window).CAIRN;
  const cy = camera.y;
  // Spread through the visible band so nothing is culled away — the worst
  // honest case, a tower dense around the player.
  for (let i = 0; i < 130; i++) {
    sim.world.corpse(14 + (i * 37) % 72, cy - 140 + i * 2.1, (i % 5 - 2) * 0.1, i & 3, 0, i);
  }
  sim.deaths += 130;
  return sim.world.solids.length;
});
await delay(400);
const full = await sample(SECONDS * 1000);

console.log('\n  CAIRN — real frame pacing (live loop, software raster)\n');
const row = (l, r) => console.log(
  `  ${l.padEnd(16)} ${String(r.fps).padStart(6)} fps    median ${String(r.medianMs).padStart(6)} ms` +
  `    p95 ${String(r.p95Ms).padStart(6)} ms    (${r.frames} frames)`);
row('empty tower', empty);
row('130 corpses', full);
const drop = +(100 - (full.fps / empty.fps) * 100).toFixed(1);
console.log(`\n  cost of a full tower: ${drop > 0 ? '-' : '+'}${Math.abs(drop)}% frame rate   (solids in world: ${n})`);
console.log('  a phone GPU is far faster in absolute terms; the RATIO is the finding.\n');
await browser.close();
