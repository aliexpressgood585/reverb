/**
 * Re-take a subset of stills without paying for the whole set.
 *   node scripts/reshoot.mjs 12 13
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const want = new Set(process.argv.slice(2));
const PORT = 4199;
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
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/?lm=1024&msaa=0&nosound=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.REVERB);
await page.evaluate(() => window.REVERB.setFixedStep(1 / 60));

const step = (n) => page.evaluate((k) => { for (let i = 0; i < k; i++) window.REVERB.frame(); }, n);
const enter = (l, o) => page.evaluate(({ l, o }) => window.REVERB.debugEnter(l, o), { l, o });
const shot = async (n) => {
  const t = Date.now();
  await page.screenshot({ path: `shots/${n}.png`, timeout: 300000 });
  console.log('  ->', n, Date.now() - t + 'ms');
};

if (want.has('08')) {
  await enter(0, { x: 3.0, z: 4, yaw: 0, pitch: -0.02 });
  await page.evaluate(() => {
    const g = window.REVERB, e = g.enemies[0];
    e.position.set(9.0, -0.95, 10.0);
    e.state = 'HUNT'; e.memory = 9; e.target.set(9.0, -0.95, -6); e.stepTimer = 0.02;
    const p = g.player.position;
    g.player.yaw = Math.atan2(-(e.position.x - p.x), -(e.position.z - p.z));
  });
  await step(30);
  await shot('08-enemy');
}

if (want.has('10')) {
  await enter(4, { x: 0, z: -16, yaw: Math.PI, pitch: -0.20 });
  await step(12);
  await page.evaluate(() => window.REVERB.player.fire());
  await step(26);
  await shot('10-the-deep');
}

if (want.has('12')) {
  await enter(3, { x: -13.4, z: -4.0, yaw: 0, pitch: -0.06 });
  await page.evaluate(() => {
    // Line the plant up so the still lands inside a cycle rather than between
    // two, and face the machine that is about to fire.
    const g = window.REVERB;
    g.machinePhase = g.machinePhase.map(() => 0.02);
    const m = g.level.def.machines[0];
    const p = g.player.position;
    g.player.yaw = Math.atan2(-(m.x - p.x), -(m.z - p.z));
  });
  await step(26);
  await shot('12-maintenance');
}

if (want.has('13')) {
  await enter(2, { x: 0.9, z: -19, yaw: Math.PI, pitch: 0.06 });
  await page.evaluate(() => {
    const g = window.REVERB, e = g.enemies[0];
    e.position.set(-0.9, 0, -14.2);
    e.state = 'HUNT'; e.memory = 9; e.target.set(-0.9, 0, -24); e.stepTimer = 0.02;
    const p = g.player.position;
    g.player.yaw = Math.atan2(-(e.position.x - p.x), -(e.position.z - p.z));
  });
  await step(20);
  await shot('13-sentinel');
}

await browser.close();
process.exit(0);
