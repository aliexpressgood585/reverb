/**
 * Fast visual iteration: three diagnostic frames, small viewport, no fuss.
 *   node scripts/iterate.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4188;
mkdirSync('shots/iter', { recursive: true });

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
    '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('ERR', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[err]', m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/?lm=1024&msaa=0`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.REVERB);
await page.evaluate(() => window.REVERB.setFixedStep(1 / 60));

const step = (n) => page.evaluate((k) => { for (let i = 0; i < k; i++) window.REVERB.frame(); }, n);
const hold = (keys, on) => page.evaluate(({ keys, on }) => {
  for (const k of keys) window.REVERB.input.synth(k, on);
}, { keys, on });
const shot = async (n) => {
  const t = Date.now();
  await page.screenshot({ path: `shots/iter/${n}.png`, timeout: 300000 });
  console.log('  ->', n, Date.now() - t + 'ms');
};
const enter = (l, o) => page.evaluate(({ l, o }) => window.REVERB.debugEnter(l, o), { l, o });

// A — walking on the platform, wavefronts live
await enter(0, { x: 0, z: -12, yaw: Math.PI, pitch: -0.16 });
await step(16);
await hold(['forward'], true);
await step(58);
await shot('a-walk');

// B — stopped, imprint only
await hold(['forward'], false);
await step(48);
await shot('b-imprint');

// C — gunshot mid-expansion
await enter(0, { x: 0, z: 2, yaw: Math.PI, pitch: -0.05 });
await step(8);
await page.evaluate(() => window.REVERB.player.fire());
await step(14);
await shot('c-shot');

// D — enemy on the move, close
await enter(0, { x: 3.0, z: 4, yaw: 0, pitch: -0.02 });
await page.evaluate(() => {
  const g = window.REVERB;
  const e = g.enemies[0];
  e.position.set(9.0, -0.95, 10.0);
  e.state = 'HUNT'; e.memory = 9; e.target.set(9.0, -0.95, -6);
  e.stepTimer = 0.02;
  const p = g.player.position;
  g.player.yaw = Math.atan2(-(e.position.x - p.x), -(e.position.z - p.z));
});
await step(30);
await shot('d-enemy');

// E — the tunnel, gravel
await enter(2, { x: 0, z: -20, yaw: Math.PI, pitch: -0.05 });
await step(10);
await hold(['forward'], true);
await step(50);
await hold(['forward'], false);
await shot('e-tunnel');

console.log(await page.evaluate(() => ({
  level: window.REVERB.level.def.name,
  pos: window.REVERB.player.position.toArray().map(v => +v.toFixed(2)),
  noise: +window.REVERB.sound.noiseScore.toFixed(2),
  pulses: window.REVERB.pulses.count,
  alive: window.REVERB.pulses.slots.filter(s => s.alive).length,
  surf: window.REVERB.surfaceAt(window.REVERB.player.position.x, window.REVERB.player.position.z),
  floors: window.REVERB.level.floors.length,
  quads: window.REVERB.level.geometry.attributes.position.count / 4,
})));

await browser.close();
console.log('ok');
process.exit(0);
