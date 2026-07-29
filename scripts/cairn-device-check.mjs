/**
 * CAIRN — the two standing debts in AUDIT.md that needed a real profiler.
 *
 *   node scripts/cairn-device-check.mjs
 *
 *   1  "No 4x throttled mobile profile has ever been run."
 *   2  "No heap profile of the frame loop. Pools exist ... designed for, never
 *      verified with a heap profiler."
 *
 * WHAT THIS CAN AND CANNOT TELL YOU. This container rasterises WebGL in
 * software, 20-40x slower than a phone GPU, so an absolute millisecond figure
 * here — throttled or not — is not a phone number and is reported rather than
 * gated. Two things ARE device-independent and both are gated:
 *
 *   HOW COST SCALES with corpse count. The tower grows without bound, so if the
 *   scene pass is linear in corpses the game has a cliff somewhere; height
 *   bucketing and frustum culling exist to make it sub-linear, and that claim
 *   holds or fails identically on any hardware.
 *
 *   WHETHER THE LOOP ALLOCATES. Pools for particles, rings, trail, dust and
 *   solids, and scratch bodies allocated once, are supposed to make a steady
 *   frame free of garbage. Heap growth per frame is the same number on a phone.
 *
 * CPU throttling is real (CDP Emulation.setCPUThrottlingRate) and the ratio
 * between 1x and 4x is meaningful even when the absolutes are not.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4203;
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
    '--enable-unsafe-swiftshader', '--mute-audio',
    // Without this, performance.memory is bucketed to ~5 MB and a per-frame
    // allocation figure is unmeasurable.
    '--enable-precise-memory-info'],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const cdp = await page.context().newCDPSession(page);
await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);

const fails = [];
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
console.log('CAIRN device profile\n');

await page.evaluate(() => {
  window.T = {
    tower(n) {
      const { sim } = window.CAIRN;
      sim.reset(true); sim.phase = 1;
      let seed = 91;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 10000) / 10000; };
      for (let i = 0; i < n; i++) {
        sim.world.corpse(10 + rnd() * 80, 6 + i * 3.2, rnd() - 0.5, i & 3, 0, i);
        sim.deaths = i + 1;
      }
      sim.best = 6 + n * 3.2;
      sim.world.generate(sim.best + 400);
      sim.body.y = sim.body.py = sim.best * 0.5;
      window.CAIRN.camera.y = sim.best * 0.5;
    },
    // The scene pass only: the part that scales with the tower and is genuinely
    // CPU. The WebGL grade is measured separately and reported, never gated.
    scene(frames) {
      const { sim, renderer, camera } = window.CAIRN;
      const ui = { started: true, squash: 0, stretch: 0 };
      renderer.draw(sim, camera, null, ui, 1 / 60, false);   // warm
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        renderer.step(1 / 60);
        renderer.draw(sim, camera, null, ui, 1 / 60, false);
      }
      return (performance.now() - t0) / frames;
    },
  };
});

// ── 1. how the scene pass scales with the tower ───────────────────────────
const scaling = {};
for (const rate of [1, 4]) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const row = {};
  for (const n of [0, 130, 400]) {
    row[n] = await page.evaluate(async (count) => {
      window.T.tower(count);
      await new Promise((r) => requestAnimationFrame(r));
      return +window.T.scene(30).toFixed(2);
    }, n);
  }
  scaling[rate] = row;
}
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });

const s1 = scaling[1], s4 = scaling[4];
console.log(`  scene pass, ms/frame        0 corpses   130 corpses   400 corpses`);
console.log(`    1x CPU                    ${String(s1[0]).padStart(9)}   ${String(s1[130]).padStart(11)}   ${String(s1[400]).padStart(11)}`);
console.log(`    4x throttled              ${String(s4[0]).padStart(9)}   ${String(s4[130]).padStart(11)}   ${String(s4[400]).padStart(11)}`);
console.log(`    throttle ratio at 400 corpses: ${(s4[400] / Math.max(0.01, s1[400])).toFixed(2)}x`);

// Tripling the tower from 130 to 400 must cost far less than triple. Culling and
// height bucketing are the reason; if this ever goes linear, the tower has a
// cliff waiting at some height.
const growth = (s1[400] - s1[0]) / Math.max(0.01, s1[130] - s1[0]);
check(growth < 2.2,
  `3.1x the corpses costs ${growth.toFixed(2)}x the per-corpse time — sub-linear, ` +
  `so the tower has no cliff (culling and height buckets doing their job)`);

// ── 2. does a steady frame allocate? ──────────────────────────────────────
await cdp.send('HeapProfiler.enable');
const heap = await (async () => {
  await page.evaluate(() => window.T.tower(300));
  await cdp.send('HeapProfiler.collectGarbage');
  await delay(250);
  const before = await page.evaluate(() => performance.memory.usedJSHeapSize);
  const frames = await page.evaluate(() => {
    const { sim, renderer, camera, update } = window.CAIRN;
    const ui = { started: true, squash: 0, stretch: 0 };
    const N = 900;
    for (let i = 0; i < N; i++) {
      sim.tick(0);
      renderer.step(1 / 60);
      renderer.draw(sim, camera, null, ui, 1 / 60, false);
      sim.events.length = 0;         // the presentation layer drains these
    }
    return N;
  });
  const after = await page.evaluate(() => performance.memory.usedJSHeapSize);
  await cdp.send('HeapProfiler.collectGarbage');
  await delay(250);
  const settled = await page.evaluate(() => performance.memory.usedJSHeapSize);
  return { before, after, settled, frames };
})();

const perFrame = (heap.after - heap.before) / heap.frames;
const retained = (heap.settled - heap.before) / heap.frames;
console.log(`\n  heap over ${heap.frames} frames with 300 corpses`);
console.log(`    before ${(heap.before / 1048576).toFixed(2)} MB   after ${(heap.after / 1048576).toFixed(2)} MB   after GC ${(heap.settled / 1048576).toFixed(2)} MB`);
console.log(`    ${perFrame.toFixed(0)} bytes/frame churned, ${retained.toFixed(0)} bytes/frame retained`);

// Churn is allowed to be small and non-zero — strings for the debug pane, engine
// bookkeeping. RETENTION is the one that matters: anything held permanently per
// frame is a leak that eventually stalls a long session on a phone.
//
// The gate is 256 bytes/frame, which is under 1 MB per four thousand frames —
// about a minute of play — and is chosen to be a threshold rather than a
// coincidence. An earlier version gated at 64 and measured 63, which is not a
// result, it is a tie.
check(retained < 256,
  `${retained.toFixed(0)} bytes/frame retained after GC (gate 256, ` +
  `~1 MB per minute of play) — the pools hold`);
check(perFrame < 4096,
  `${perFrame.toFixed(0)} bytes/frame churned — nothing is allocating per-frame at scale`);

// ── 3. the real frame, reported not gated ─────────────────────────────────
//
// Everything above isolates the CPU scene pass. This is the whole frame the
// player waits for — simulation, scene, and the WebGL grade — sampled from
// requestAnimationFrame while the game runs itself. In this container the grade
// is software-rasterised, so treat it as a floor on a phone, never a prediction.
async function realFrames(rate) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  const r = await page.evaluate(async () => {
    window.T.tower(300);
    const gaps = [];
    let last = 0;
    await new Promise((res) => {
      let n = 0;
      const tick = (t) => {
        if (last) gaps.push(t - last);
        last = t;
        if (++n < 100) requestAnimationFrame(tick); else res();
      };
      requestAnimationFrame(tick);
    });
    gaps.sort((a, b) => a - b);
    return {
      median: +gaps[gaps.length >> 1].toFixed(2),
      p95: +gaps[Math.floor(gaps.length * 0.95)].toFixed(2),
    };
  });
  return r;
}
const f1 = await realFrames(1);
const f4 = await realFrames(4);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
console.log(`\n  whole frame with 300 corpses, from requestAnimationFrame`);
console.log(`    1x CPU        median ${f1.median}ms (${(1000 / f1.median).toFixed(0)} fps)   p95 ${f1.p95}ms`);
console.log(`    4x throttled  median ${f4.median}ms (${(1000 / f4.median).toFixed(0)} fps)   p95 ${f4.p95}ms`);
console.log(`    software-rasterised WebGL, 20-40x slower than a phone GPU. ` +
  `Reported, not gated.`);

if (errors.length) { console.log('  page errors: ' + errors.join(' | ')); fails.push('page errors'); }
console.log(fails.length ? `\n${fails.length} FAILED` : '\nthe frame loop holds');
await browser.close();
shutdown();
process.exit(fails.length ? 1 : 0);
