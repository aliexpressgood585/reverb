#!/usr/bin/env node
/**
 * CAIRN — the numbers a store release is judged on.
 *
 *   node scripts/cairn-profile.mjs [--minutes=10]
 *
 * Load time, bundle size, frame rate at a 4x CPU throttle, and heap growth over
 * a long session. Everything here is measured through the CDP protocol against
 * the real built bundle, not against a dev server.
 *
 * THE ONE THING THIS CONTAINER CANNOT TELL YOU is frames per second. WebGL here
 * is software-rasterised and 20-40x slower than a phone GPU, so the whole-frame
 * number is a floor and is reported as one. What IS honest from here:
 *
 *   - CPU cost of the simulation and the scene pass, which is the part that
 *     scales with the tower and the part a phone also has to pay
 *   - heap growth, which is hardware-independent
 *   - bundle bytes and load time on a throttled network, likewise
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readdirSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const MINUTES = +(args.minutes ?? 10);
const PORT = 4201;

// ------------------------------------------------------------------- bundle

console.log('CAIRN profile\n');
console.log('  bundle');
let totalRaw = 0, totalGz = 0;
const assets = readdirSync('dist/assets').filter((f) => /cairn|modulepreload/.test(f));
for (const f of [...assets.map((a) => `dist/assets/${a}`), 'dist/cairn/index.html']) {
  const buf = readFileSync(f);
  const gz = gzipSync(buf).length;
  totalRaw += buf.length; totalGz += gz;
  console.log(`    ${f.replace('dist/', '').padEnd(38)} ${String(buf.length).padStart(7)} B   ${String(gz).padStart(6)} B gz`);
}
console.log(`    ${'TOTAL'.padEnd(38)} ${String(totalRaw).padStart(7)} B   ${String(totalGz).padStart(6)} B gz` +
  `   (budget 2 MB: ${((totalGz / (2 * 1024 * 1024)) * 100).toFixed(2)}% used)`);

// ------------------------------------------------------------------- server

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', () => {});
const shutdown = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', shutdown);
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/cairn/`)).ok) break; } catch { /* not up */ }
  await delay(400);
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--mute-audio', '--js-flags=--expose-gc'],
});

// ------------------------------------------------------- load, on slow 4G

{
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  // Slow 4G, the profile Lighthouse uses for mobile.
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8, connectionType: 'cellular4g',
  });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.CAIRN);
  const loaded = Date.now() - t0;
  // Time to first input: the game must accept a touch, not merely have painted.
  const ttfi = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return { dcl: Math.round(nav.domContentLoadedEventEnd), fp: Math.round(nav.responseEnd) };
  });
  console.log(`\n  load, simulated slow 4G (1.6 Mbps, 150 ms RTT)`);
  console.log(`    interactive (window.CAIRN present)   ${loaded} ms   (budget 2000)`);
  console.log(`    domContentLoaded                     ${ttfi.dcl} ms`);
  await page.close();
}

// ------------------------------------------------- frame cost at 1x and 4x

const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);
await page.touchscreen.tap(195, 500);
await delay(300);

const cdp = await page.context().newCDPSession(page);

/** Build a tower of `n` bodies so the measurement is of a played game. */
async function tower(n) {
  await page.evaluate((count) => {
    const { sim } = window.CAIRN;
    sim.reset(true); sim.phase = 1;
    let s = 11;
    const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 10000) / 10000; };
    for (let i = 0; i < count; i++) sim.world.corpse(8 + r() * 84, 5 + i * 3.1, (r() - 0.5), i & 3, 0, 0);
    sim.best = count * 3.1;
    sim.world.generate(sim.best + 400);
  }, n);
}

/**
 * The SIMULATION cost per tick and the SCENE pass per frame, separately.
 * These are the two things that scale with the tower and the two things a phone
 * pays as well; the WebGL grade is four fullscreen draws and is not measured
 * here because this container cannot measure it honestly.
 */
async function cost() {
  return page.evaluate(() => {
    const { sim, renderer, camera, ui } = window.CAIRN;
    // The simulation is cheap enough to need many samples; a software-rasterised
    // scene pass costs ~200 ms here, so it gets few. Both are medians of what
    // they measure, not of what a phone would do — see the header.
    const SIM_N = 400, DRAW_N = 12;
    let t = performance.now();
    for (let i = 0; i < SIM_N; i++) sim.tick(0);
    const simMs = (performance.now() - t) / SIM_N;
    t = performance.now();
    for (let i = 0; i < DRAW_N; i++) {
      renderer.step(1 / 60);
      renderer.draw(sim, camera, null, ui, 1 / 60, false);
    }
    const drawMs = (performance.now() - t) / DRAW_N;
    return { simMs: +simMs.toFixed(4), drawMs: +drawMs.toFixed(3) };
  });
}

console.log(`\n  cost per frame, by tower size (CPU only)`);
console.log(`    bodies      sim/tick    scene/frame      sim/tick 4x    scene/frame 4x`);
for (const n of [0, 200, 400]) {
  await tower(n);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const a = await cost();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const b = await cost();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  console.log(`    ${String(n).padStart(6)}  ${a.simMs.toFixed(4)} ms   ${a.drawMs.toFixed(2)} ms` +
    `        ${b.simMs.toFixed(4)} ms      ${b.drawMs.toFixed(2)} ms`);
}

// A 60 Hz frame has 16.67 ms. At 120 Hz physics that is two ticks plus one draw.
{
  await tower(200);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const c = await cost();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const budget = c.simMs * 2 + c.drawMs;
  console.log(`\n    a 60 Hz frame at 4x throttle with 200 bodies costs ${budget.toFixed(2)} ms of CPU ` +
    `(${((budget / 16.67) * 100).toFixed(1)}% of the 16.67 ms budget), before the GPU grade`);
}

// ------------------------------------------------------------ heap over time

{
  await tower(300);
  console.log(`\n  heap over ${MINUTES} simulated minutes of play (300 bodies)`);
  const read = async () => {
    await page.evaluate(() => { if (window.gc) window.gc(); });
    const m = await cdp.send('Runtime.getHeapUsage');
    return m.usedSize;
  };
  const before = await read();
  // Drive the real loop at a fixed cadence rather than waiting on a software
  // rasteriser: 60 fps x 60 s x MINUTES frames of actual game logic.
  //
  // `update` and `renderer.step` run EVERY frame — they are the simulation, the
  // particle pools, the trail ring and the event drain, which is where an
  // allocation leak would actually live. `renderer.draw` runs every 10th frame,
  // because a software-rasterised draw costs ~200 ms here and 36,000 of them is
  // two hours for a number that `cairn-device-check.mjs` already measures over
  // 900 consecutive draws. Stated rather than hidden: this is a 10-minute
  // profile of the game logic, not of the rasteriser.
  const frames = 60 * 60 * MINUTES;
  const t0 = Date.now();
  const played = await page.evaluate((n) => {
    const { sim, renderer, camera, ui, update, fire } = window.CAIRN;
    // THE BODY HAS TO ACTUALLY PLAY.
    //
    // The first version of this ran 36,000 frames in under a second, because the
    // body was standing on the base ledge the whole time: no flight, no trail, no
    // particles, no deaths, no respawn. It was a heap profile of an idle game,
    // which is the one state that cannot leak. Now it launches whenever it is on
    // the ground, so the pools, the trail ring, the event queue and the death
    // transition are all exercised — which is where a leak would live.
    let launches = 0;
    const d0 = sim.deaths;
    let s = 99;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 10000) / 10000; };
    for (let i = 0; i < n; i++) {
      if (sim.phase === 1 && sim.body.grounded && ui.dead === 0) {
        const a = (25 + rnd() * 120) * Math.PI / 180;
        const sp = 60 + rnd() * 70;
        if (fire(Math.cos(a) * sp, Math.sin(a) * sp)) launches++;
      }
      update(1 / 60);
      renderer.step(1 / 60);
      if (i % 60 === 0) renderer.draw(sim, camera, null, ui, 1 / 60, false);
    }
    return { launches, deaths: sim.deaths - d0, parts: renderer.partN, trail: renderer.trailN };
  }, frames);
  const after = await read();
  const mb = (b) => (b / 1024 / 1024).toFixed(2);
  const perFrame = (after - before) / frames;
  console.log(`    ${frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s wall — ` +
    `${played.launches} launches, ${played.deaths} deaths, ` +
    `${played.parts} live particles, ${played.trail} trail points at the end`);
  if (played.launches < frames / 500) {
    console.log('    WARNING: the body barely played. This is not a profile of anything.');
  }
  console.log(`    heap before ${mb(before)} MB   after GC ${mb(after)} MB   ` +
    `retained ${perFrame.toFixed(1)} B/frame`);
  console.log(`    extrapolated over an hour of play: ${mb(perFrame * 60 * 60 * 60)} MB`);
}

await browser.close();
shutdown();
