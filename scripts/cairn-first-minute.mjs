/**
 * CAIRN — the first sixty seconds. PHASE3 §3.
 *
 *   node scripts/cairn-first-minute.mjs
 *
 * §3's beats, and what can honestly be asserted about each:
 *
 *   0-3 s    first touch starts the run instantly — acceptance test 10 already
 *            proves this with a real thumb, so it is not repeated here.
 *   3-10 s   the first jump nearly unmissable. Asserted on the GEOMETRY of the
 *            on-ramp, not on a clock: how wide the first ledges are and how far
 *            apart, against what a novice's aim error can survive.
 *   10-25 s  the first death.
 *   25-40 s  the first time standing on your own corpse, with a camera pull-back
 *            so it cannot be missed.
 *   40-60 s  the first biome transition.
 *
 * The wall-clock windows themselves cannot be asserted with a bot: a bot aims in
 * microseconds and a person takes seconds, so any number it produced would be a
 * statement about the harness. What IS asserted is everything the game controls —
 * the shape of the on-ramp, that the teaching beat fires exactly once and returns
 * control, and that every beat is instrumented so a real session can be measured
 * on a real phone. The bot supplies the ordering: how many jumps a novice needs
 * to reach each beat.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4204;
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
    '--enable-unsafe-swiftshader', '--mute-audio'],
});
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);

const fails = [];
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
console.log('CAIRN first sixty seconds\n');

// ── the on-ramp: is the first jump hard to miss? ───────────────────────────
//
// A landing is forgiven for `landing.forgiveness` plus half a body either side
// of the ledge, so the window a launch has to hit is that plus the ledge's own
// half-width. Compared against the on-ramp's ledges and against what the same
// generator produces later, which is what the ramp exists to differ from.
const ramp = await page.evaluate(() => {
  const { sim, FEEL } = window.CAIRN;
  const T = FEEL.tower;
  const window_ = (s) => s.hw + FEEL.body.w * 0.5 + FEEL.landing.forgiveness;
  const sample = (from, to) => {
    const out = [];
    for (let seed = 0; seed < 40; seed++) {
      sim.world.reset((0x1a2b3c + seed * 0x9e3779b1) | 0);
      sim.world.generate(to + 200);
      const led = sim.world.solids
        .filter((x) => !x.corpse && x.y >= from && x.y <= to)
        .sort((a, b) => a.y - b.y);
      for (let i = 0; i + 1 < led.length; i++) {
        out.push({ w: window_(led[i + 1]), gap: Math.hypot(led[i + 1].x - led[i].x, led[i + 1].y - led[i].y) });
      }
    }
    return {
      n: out.length,
      window: out.reduce((a, b) => a + b.w, 0) / out.length,
      gap: out.reduce((a, b) => a + b.gap, 0) / out.length,
      worstWindow: Math.min(...out.map((o) => o.w)),
    };
  };
  return { onRamp: sample(0, T.openingSpan), later: sample(300, 400), span: T.openingSpan };
});
const easier = ramp.onRamp.window > ramp.later.window * 1.25
  && ramp.onRamp.gap < ramp.later.gap;
check(easier,
  `the first ${ramp.span}m is materially more forgiving — landing window ` +
  `${ramp.onRamp.window.toFixed(1)}u vs ${ramp.later.window.toFixed(1)}u later, ` +
  `gaps ${ramp.onRamp.gap.toFixed(1)}u vs ${ramp.later.gap.toFixed(1)}u, ` +
  `narrowest window on the ramp ${ramp.onRamp.worstWindow.toFixed(1)}u`);

// A novice's aim error, from BALANCE.md, is 6.5 deg and 11.5% of power. Over a
// ~25u flight that lands roughly 8u from where they meant. The on-ramp's window
// has to be comparable or the first jump is a coin flip.
check(ramp.onRamp.worstWindow >= 8,
  `even the narrowest on-ramp landing window (${ramp.onRamp.worstWindow.toFixed(1)}u) ` +
  `covers a novice's typical miss (~8u at 6.5deg and 11.5% power)`);

// ── no gap on the on-ramp can be uncrossable ───────────────────────────────
const noWalls = await page.evaluate(() => {
  const { sim, FEEL } = window.CAIRN;
  const lift = (FEEL.launch.maxSpeed ** 2) / (2 * FEEL.gravityRise);
  let worst = 0;
  for (let seed = 0; seed < 200; seed++) {
    sim.world.reset((0x1a2b3c + seed * 0x9e3779b1) | 0);
    sim.world.generate(FEEL.tower.openingSpan + 40);
    const led = sim.world.solids.filter((x) => !x.corpse && x.y <= FEEL.tower.openingSpan)
      .sort((a, b) => a.y - b.y);
    for (let i = 0; i + 1 < led.length; i++) worst = Math.max(worst, led[i + 1].y - led[i].y);
  }
  return { worst, lift };
});
check(noWalls.worst < noWalls.lift,
  `no rise on the on-ramp exceeds a full-power launch — worst ` +
  `${noWalls.worst.toFixed(1)}u against ${noWalls.lift.toFixed(1)}u of lift`);

// ── the teaching beat ─────────────────────────────────────────────────────
const taught = await page.evaluate(async () => {
  const { sim, camera, ui, update, FEEL } = window.CAIRN;
  localStorage.removeItem('cairn.taught');
  ui.taught = false;
  ui.beats = { start: performance.now() };
  sim.reset(true); sim.phase = 1;
  camera.monTarget = 0; camera.mon = 0;

  // Put a body down and stand the player on it, which is the moment §3 is about.
  const corpse = sim.world.corpse(50, 30, 0, 0, 0, 0);
  sim.deaths = 1;
  const b = sim.body;
  b.x = b.px = corpse.x;
  b.y = b.py = corpse.y + corpse.hh;
  b.grounded = true; b.standing = corpse; b.vx = b.vy = 0;
  update(1 / 60);

  const fired = { target: camera.monTarget, taught: ui.taught, beat: ui.beats.firstCorpse };
  // It must not fire a second time, and must not be firing for an ordinary ledge.
  camera.monTarget = 0;
  b.standing = sim.world.solids[0];
  update(1 / 60);
  const again = camera.monTarget;
  b.standing = corpse;
  update(1 / 60);
  const twice = camera.monTarget;

  return { ...fired, expect: FEEL.monument.teachPull, onLedge: again, secondTime: twice,
           locked: window.CAIRN.input.locked, persisted: localStorage.getItem('cairn.taught') };
});
check(taught.taught && taught.target === taught.expect && taught.beat !== undefined,
  `standing on your own body pulls the camera back to ${taught.expect} and stamps ` +
  `the beat at ${taught.beat}ms`);
check(taught.onLedge === 0 && taught.secondTime === 0,
  `it does not fire for an ordinary ledge, and never fires twice`);
check(taught.locked === false && taught.persisted === '1',
  `control is never taken away (input.locked ${taught.locked}), and it is remembered`);

// It stays remembered across a reload, which is what "once per player" means.
const page2 = await ctx.newPage();
await page2.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
await page2.waitForFunction(() => !!window.CAIRN);
const remembered = await page2.evaluate(() => window.CAIRN.ui.taught);
await page2.close();
check(remembered === true, `still remembered after a reload`);

// ── every beat is instrumented ────────────────────────────────────────────
// Driven, not inspected. The first version of this checked whether the source
// text mentioned each beat name and then OR'd in two of them unconditionally,
// which is a test that passes by construction — the exact failure mode this
// repository has now recorded five times.
const wired = await page.evaluate(async () => {
  const { sim, ui, update, FEEL } = window.CAIRN;
  ui.beats = { start: performance.now() };
  sim.reset(true); sim.phase = 1;

  // A launch, flown until it resolves.
  sim.launch(60, 110);
  for (let i = 0; i < 900 && sim.phase === 1 && !sim.body.grounded; i++) sim.tick(0);
  update(1 / 60);
  const afterLaunch = ui.beats.firstLaunch;

  // A death: throw sideways off the base with nothing under it.
  sim.reset(true); sim.phase = 1;
  sim.launch(FEEL.launch.maxSpeed * 0.9, 20);
  for (let i = 0; i < 900 && sim.phase === 1; i++) sim.tick(0);
  update(1 / 60);
  const afterDeath = ui.beats.firstDeath;

  // A biome crossing, which is a function of height alone.
  sim.body.y = sim.body.py = FEEL.camera.viewH * 0 + 320;
  update(1 / 60);
  const afterBiome = ui.beats.firstBiome;

  return { afterLaunch, afterDeath, afterBiome, phase: sim.phase };
});
check([wired.afterLaunch, wired.afterDeath, wired.afterBiome].every((v) => v !== undefined),
  `beats fire when the things actually happen — launch ${wired.afterLaunch}ms, ` +
  `death ${wired.afterDeath}ms, biome ${wired.afterBiome}ms. A real session on a real ` +
  `phone can now be measured, which no bot can do on a person's behalf`);

if (errors.length) { console.log('  page errors: ' + errors.join(' | ')); fails.push('page errors'); }
console.log(fails.length ? `\n${fails.length} FAILED` : '\nthe first minute holds');
await browser.close();
shutdown();
process.exit(fails.length ? 1 : 0);
