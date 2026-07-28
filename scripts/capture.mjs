/**
 * Headless capture rig.
 *
 * Runs the built game in Chromium with a software GL backend, drives it on a
 * fixed clock so every still is reproducible, and writes PNGs to ./shots.
 *
 *   node scripts/capture.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4173;
const OUT = 'shots';
const W = 1600;
const H = 900;

mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
server.stderr.on('data', (d) => process.stderr.write(d));

const stop = () => { try { server.kill('SIGTERM'); } catch {} };
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/`);
      if (r.ok) return;
    } catch {}
    await delay(400);
  }
  throw new Error('preview server never came up');
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: [
    '--headless=new',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
  ],
});

await waitForServer();

const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`  [page ${m.type()}]`, m.text());
});
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));

await page.goto(`http://127.0.0.1:${PORT}/?lm=1024&msaa=0`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.REVERB, null, { timeout: 30000 });
await page.evaluate(() => window.REVERB.setFixedStep(1 / 60));

const step = (n) => page.evaluate((k) => {
  for (let i = 0; i < k; i++) window.REVERB.frame();
}, n);

const hold = (keys, on) => page.evaluate(({ keys, on }) => {
  for (const k of keys) window.REVERB.input.synth(k, on);
}, { keys, on });

const shot = async (name) => {
  const t0 = Date.now();
  await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 300000 });
  console.log('  ->', name, `${Date.now() - t0}ms`);
};

const enter = (lvl, opts) => page.evaluate(({ lvl, opts }) => {
  window.REVERB.debugEnter(lvl, opts);
}, { lvl, opts });

console.log('capturing...');

// 01 — the title, caught at the crest of its wavefront
await step(90);
await shot('01-title');

// 02 — level card
await page.evaluate(() => {
  window.REVERB.sound.init();
  window.REVERB.loadLevel(0);
});
await step(70);
await shot('02-level-card');

// 03 — the very first footstep drawing the platform under you
await enter(0, { x: 0, z: -14, yaw: Math.PI, pitch: -0.14 });
await step(20);
await hold(['forward'], true);
await step(34);
await shot('03-first-step');

// 04 — mid-stride, several wavefronts overlapping down the platform
await step(70);
await shot('04-walking');

// 05 — stopped dead. Only the imprint is left, fading.
await hold(['forward'], false);
await step(70);
await shot('05-imprint-only');

// 06 — a thrown stone landing away from you: light where you are not
await page.evaluate(() => {
  const g = window.REVERB;
  g.player.yaw = Math.PI;
  g.player.pitch = 0.08;
  g.player.throwStone();
});
await step(46);
await shot('06-stone');

// 07 — the gunshot. The whole platform, for a quarter of a second.
await enter(0, { x: 0, z: 2, yaw: Math.PI, pitch: -0.05 });
await step(10);
await page.evaluate(() => window.REVERB.player.fire());
await step(11);
await shot('07-gunshot');

// 08 — a creature caught mid-stride, lit only by the noise it is making
await enter(0, { x: 3.0, z: 4, yaw: 0, pitch: -0.02 });
await page.evaluate(() => {
  const g = window.REVERB;
  const e = g.enemies[0];
  e.position.set(9.0, -0.95, 10.0);
  e.state = 'HUNT';
  e.memory = 9;
  e.target.set(9.0, -0.95, -6);
  e.stepTimer = 0.02;
  const p = g.player.position;
  g.player.yaw = Math.atan2(-(e.position.x - p.x), -(e.position.z - p.z));
});
await step(30);
await shot('08-enemy');

// 09 — THE TUNNEL: gravel, a long ring running away down the bore
await enter(2, { x: 0, z: -20, yaw: Math.PI, pitch: -0.06 });
await step(14);
await hold(['forward'], true);
await step(46);
await hold(['forward'], false);
await shot('09-tunnel');

// 10 — THE DEEP: nothing to stop the wave
await enter(4, { x: 0, z: -20, yaw: Math.PI, pitch: -0.02 });
await step(12);
await page.evaluate(() => window.REVERB.player.fire());
await step(16);
await shot('10-the-deep');

// 11 — sneaking: almost nothing, on purpose
await enter(1, { x: 0, z: -12, yaw: Math.PI, pitch: -0.1 });
await step(12);
await hold(['forward', 'sneak'], true);
await step(60);
await hold(['forward', 'sneak'], false);
await shot('11-sneaking');

// 12 — MAINTENANCE, caught on a machine cycle
await enter(3, { x: -15, z: -6, yaw: Math.PI * 0.5, pitch: -0.05 });
await step(90);
await shot('12-maintenance');

// 13 — a Sentinel at close range: the picture you get right before it is over
await enter(2, { x: 0.4, z: -18, yaw: Math.PI, pitch: 0.02 });
await page.evaluate(() => {
  const g = window.REVERB;
  const e = g.enemies[0];
  e.position.set(-1.2, 0, -13.0);
  e.state = 'HUNT';
  e.memory = 9;
  e.target.set(-1.2, 0, -22);
  e.stepTimer = 0.02;
});
await step(26);
await shot('13-sentinel');

const diag = await page.evaluate(() => ({
  pulses: window.REVERB.pulses.count,
  level: window.REVERB.level.def.name,
  gl: (() => {
    const g = window.REVERB.renderer.getContext();
    return g.getParameter(g.VERSION);
  })(),
}));
console.log('diag:', diag);

await browser.close();
stop();
console.log('done');
process.exit(0);
