/**
 * Palette discipline, measured.
 *
 * The rule: warm colour belongs to living things and nothing else. This reads
 * the rendered framebuffer and counts how much of it is warm, how tightly that
 * warmth is clustered, and how much of the frame is genuinely black.
 *
 *   node scripts/palette-check.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4203;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
process.on('exit', () => { try { server.kill('SIGTERM'); } catch {} });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; } catch {}
  await delay(400);
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/?lm=512&msaa=0&nosound=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.REVERB);
await page.evaluate(() => window.REVERB.setFixedStep(1 / 60));

/** Read the framebuffer and classify every pixel. */
const measure = () => page.evaluate(() => {
  const c = window.REVERB.canvas;
  const tmp = document.createElement('canvas');
  tmp.width = c.width; tmp.height = c.height;
  tmp.getContext('2d').drawImage(c, 0, 0);
  const d = tmp.getContext('2d').getImageData(0, 0, tmp.width, tmp.height).data;
  const n = d.length / 4;
  let warm = 0, cold = 0, black = 0, lit = 0;
  let wx = 0, wy = 0, wxx = 0, wyy = 0;
  let warmPeak = 0, coldPeak = 0;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    const v = Math.max(r, g, b);
    if (v <= 2) { black++; continue; }
    lit++;
    // Warm = red clearly dominant. Cold = blue at or above red.
    if (r - b > 24 && r > 26) {
      warm++;
      const px = i % tmp.width, py = (i / tmp.width) | 0;
      wx += px; wy += py; wxx += px * px; wyy += py * py;
      if (v > warmPeak) warmPeak = v;
    } else if (b >= r) {
      cold++;
      if (v > coldPeak) coldPeak = v;
    }
  }
  const res = {
    warmPct: +(100 * warm / n).toFixed(2),
    coldPct: +(100 * cold / n).toFixed(2),
    blackPct: +(100 * black / n).toFixed(2),
    litPct: +(100 * lit / n).toFixed(2),
    warmPeak, coldPeak,
  };
  if (warm > 20) {
    const mx = wx / warm, my = wy / warm;
    // Spread as a fraction of the frame diagonal: small means one object.
    const sd = Math.sqrt(Math.max(0, wxx / warm - mx * mx) + Math.max(0, wyy / warm - my * my));
    res.warmSpread = +(sd / Math.hypot(tmp.width, tmp.height)).toFixed(3);
  } else {
    res.warmSpread = null;
  }
  return res;
});

const step = (n) => page.evaluate((k) => { for (let i = 0; i < k; i++) window.REVERB.frame(); }, n);
const enter = (l, o) => page.evaluate(({ l, o }) => window.REVERB.debugEnter(l, o), { l, o });

const scenes = [];

// A — the player alone: nothing warm may exist in this frame at all.
await enter(0, { x: 0, z: -12, yaw: Math.PI, pitch: -0.16 });
await page.evaluate(() => { window.REVERB.enemies.forEach((e) => { e.alive = false; window.REVERB.scene.remove(e.group); }); });
await step(16);
await page.evaluate(() => window.REVERB.input.synth('forward', true));
await step(56);
await page.evaluate(() => window.REVERB.input.synth('forward', false));
scenes.push(['player alone, walking', await measure(), { warmPct: [0, 0.35] }]);

// B — a creature centre frame.
await enter(0, { x: 3.0, z: 4, yaw: 0, pitch: -0.02 });
await page.evaluate(() => {
  const g = window.REVERB, e = g.enemies[0];
  e.position.set(9.0, -0.95, 10.0);
  e.state = 'HUNT'; e.memory = 9; e.target.set(9.0, -0.95, -6); e.stepTimer = 0.02;
  const p = g.player.position;
  g.player.yaw = Math.atan2(-(e.position.x - p.x), -(e.position.z - p.z));
});
await step(30);
scenes.push(['creature centre frame', await measure(), { warmPct: [0.3, 12], warmSpread: [0, 0.14] }]);

// C — the same creature pushed to the edge of vision.
await page.evaluate(() => {
  const g = window.REVERB;
  g.player.yaw += 0.52; // roughly the frame edge at 74 deg vertical fov
});
await step(6);
scenes.push(['creature at frame edge', await measure(), { warmPct: [0.1, 12], warmSpread: [0, 0.16] }]);

// D — a gunshot: the loudest, whitest moment must stay neutral.
await enter(0, { x: 0, z: 2, yaw: Math.PI, pitch: -0.05 });
await step(8);
await page.evaluate(() => window.REVERB.player.fire());
await step(14);
scenes.push(['gunshot', await measure(), { warmPct: [0, 0.6] }]);

// E — a wounded player: the heartbeat is the player's own light and must be cold.
await enter(0, { x: 0, z: -8, yaw: Math.PI, pitch: -0.1 });
await page.evaluate(() => {
  const g = window.REVERB;
  g.enemies.forEach((e) => { e.alive = false; g.scene.remove(e.group); });
  g.player.health = 1; g.player.heartTimer = 0.02;
});
await step(20);
scenes.push(['wounded, heartbeat', await measure(), { warmPct: [0, 0.35] }]);

await browser.close();

// -------------------------------------------------------------- reporting
const fails = [];
const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 8) => String(v).padStart(n);

console.log('\n== palette ===========================================');
console.log(pad('scene', 24), num('warm%'), num('cold%'), num('black%'), num('spread'), '  verdict');
for (const [name, m, want] of scenes) {
  let ok = true;
  const reasons = [];
  for (const [key, [lo, hi]] of Object.entries(want)) {
    const v = m[key];
    if (v === null || v < lo || v > hi) {
      ok = false;
      reasons.push(`${key}=${v} outside ${lo}..${hi}`);
    }
  }
  if (!ok) fails.push(`${name} — ${reasons.join('; ')}`);
  console.log(pad(name, 24), num(m.warmPct), num(m.coldPct), num(m.blackPct),
    num(m.warmSpread ?? '-'), ' ', ok ? ' ok ' : 'FAIL');
}

console.log('\n warm  = R-B > 24/255 and lit: reserved for living things');
console.log(' spread= std deviation of warm pixels / frame diagonal; small means one object');

console.log('\n======================================================');
if (fails.length) {
  console.log(`${fails.length} FAILED:`);
  for (const f of fails) console.log('  -', f);
  process.exit(1);
}
console.log('palette: warm colour belongs to creatures only');
process.exit(0);
