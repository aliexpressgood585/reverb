/**
 * Headless smoke test: walks the real state machine end to end, drives every
 * level with input, and fails loudly on any page error or shader error.
 *   node scripts/smoke.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4195;
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
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(300000);

const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push('console: ' + m.text().split('\n')[0]);
});

await page.goto(`http://127.0.0.1:${PORT}/?lm=512&msaa=0&nosound=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.REVERB);
await page.evaluate(() => {
  window.REVERB.setFixedStep(1 / 60);
  window.REVERB.setHeadlessLogicOnly(true);
});

const ev = (fn, arg) => page.evaluate(fn, arg);
const run = (n) => ev((k) => { for (let i = 0; i < k; i++) window.REVERB.frame(); }, n);

// --- the real flow: title -> intro -> play ----------------------------------
await run(20);
let state = await ev(() => window.REVERB.state);
console.log('state after boot:', state);

await ev(() => window.REVERB.input.synth('confirm', true));
await run(2);
await ev(() => window.REVERB.input.synth('confirm', false));
await run(4);
console.log('state after ENTER:', await ev(() => window.REVERB.state));
await run(400); // intro auto-advances after 5.5s
console.log('state after intro:', await ev(() => window.REVERB.state));

// --- every level: drive it, then walk to the exit ---------------------------
for (let lvl = 0; lvl < 5; lvl++) {
  await ev((l) => window.REVERB.debugEnter(l, {}), lvl);

  // random-ish input for 12 simulated seconds
  const keys = ['forward', 'left', 'right', 'back', 'sneak', 'crouch', 'sprint'];
  for (let burst = 0; burst < 12; burst++) {
    await ev(({ keys, seed }) => {
      const g = window.REVERB;
      for (const k of keys) g.input.synth(k, false);
      g.input.synth(keys[seed % 4], true);
      if (seed % 3 === 0) g.input.synth('sneak', true);
      g.player.look((seed % 7) * 9 - 27, 0);
      if (seed % 5 === 0) g.player.throwStone();
      if (seed % 11 === 0) g.player.fire();
    }, { keys, seed: burst * 7 + lvl });
    await run(60);
  }
  await ev(({ keys }) => { for (const k of keys) window.REVERB.input.synth(k, false); }, { keys });

  const mid = await ev(() => ({
    level: window.REVERB.level.def.name,
    state: window.REVERB.state,
    health: window.REVERB.player.health,
    noise: +window.REVERB.sound.noiseScore.toFixed(1),
    hunting: window.REVERB.enemies.filter((e) => e.state === 'HUNT').length,
    alive: window.REVERB.enemies.filter((e) => e.alive).length,
    stuckInWall: window.REVERB.enemies.some((e) => {
      const w = window.REVERB.level.walls.some((wl) => {
        if (!wl.solid || wl.y1 <= 0.45) return false;
        const dx = wl.x1 - wl.x0, dz = wl.z1 - wl.z0;
        const l2 = dx * dx + dz * dz;
        let t = l2 > 0 ? ((e.position.x - wl.x0) * dx + (e.position.z - wl.z0) * dz) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(e.position.x - (wl.x0 + dx * t), e.position.z - (wl.z0 + dz * t)) < 0.2;
      });
      return w;
    }),
  }));
  console.log(`L${lvl + 1}`, JSON.stringify(mid));

  // teleport onto the exit and confirm the level resolves
  await ev(() => {
    const g = window.REVERB;
    if (g.state !== 'play') g.debugEnter(g.levelIndex, {});
    const ex = g.level.def.exit;
    g.player.position.x = ex.x;
    g.player.position.z = ex.z;
  });
  await run(4);
  const after = await ev(() => window.REVERB.state);
  if (after !== 'results') problems.push(`L${lvl + 1}: exit did not resolve (state=${after})`);
}

// --- the rendering path, once, with the GPU back on -------------------------
await ev(() => { window.REVERB.setHeadlessLogicOnly(false); window.REVERB.debugEnter(0, {}); });
await run(6);
await ev(() => window.REVERB.hud.setVisible(false));
await run(2);
await ev(() => window.REVERB.hud.setVisible(true));

await browser.close();

if (problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of [...new Set(problems)]) console.log(' -', p);
  process.exit(1);
}
console.log('\nsmoke: clean');
process.exit(0);
