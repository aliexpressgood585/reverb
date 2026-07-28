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

// --- the mark: take it, die, and come back to it ----------------------------
for (const lvl of [2, 3, 4]) {
  const r = await ev((l) => {
    const g = window.REVERB;
    g.debugEnter(l, {});
    const c = g.level.def.checkpoint;
    // Stand on real ground inside the band and let a frame notice. The centre
    // of MAINTENANCE's band is the spine wall itself, so ask the navigation
    // bake for somewhere a body actually fits rather than assuming.
    const nav = g.level.nav;
    let px = (c.x0 + c.x1) / 2;
    let pz = (c.z0 + c.z1) / 2;
    if (!nav.openAt(px, pz)) {
      search:
      for (let z = c.z0; z <= c.z1; z += 0.25) {
        for (let x = c.x0; x <= c.x1; x += 0.25) {
          if (nav.openAt(x, z)) { px = x; pz = z; break search; }
        }
      }
    }
    g.player.position.x = px;
    g.player.position.z = pz;
    g.player.shots = 2;
    g.sound.noiseScore = 17.5;
    g.frame();
    const took = !!g.checkpoint;
    // Whatever the mark actually captured is the contract. A creature can
    // reach you inside that frame — THE DEEP's Screamer patrols across the
    // band — and its hit adds hurt-noise before the mark is taken.
    const mark = took ? { ...g.checkpoint } : null;

    // That same hit also leaves a mercy window, which would swallow the
    // killing blow below and leave the run alive.
    g.player.invuln = 0;
    g.player.hurt(99, g.player.position);
    const died = g.state === 'dead';
    g.deadTime = 2;
    g.input.synth('confirm', true);
    g.frame();
    g.input.synth('confirm', false);

    return {
      level: g.level.def.name,
      took, died, mark,
      backAt: [+g.player.position.x.toFixed(2), +g.player.position.z.toFixed(2)],
      at: [+mark.x.toFixed(2), +mark.z.toFixed(2)],
      health: g.player.health,
      shots: g.player.shots,
      noise: +g.sound.noiseScore.toFixed(2),
    };
  }, lvl);
  console.log('mark', JSON.stringify({ ...r, mark: undefined }));
  if (!r.took) problems.push(`${r.level}: standing on the checkpoint band did not take the mark`);
  if (!r.died) problems.push(`${r.level}: fatal damage did not reach the death screen`);
  if (r.backAt[0] !== r.at[0] || r.backAt[1] !== r.at[1]) {
    problems.push(`${r.level}: resumed at ${r.backAt} rather than the mark at ${r.at}`);
  }
  if (r.health !== 3) problems.push(`${r.level}: resumed on ${r.health} health`);
  // The shots you fired and the noise you made survive the death exactly.
  if (r.mark.shots !== 2) problems.push(`${r.level}: the mark recorded ${r.mark.shots} shots, not 2`);
  if (r.mark.noise < 17.5) problems.push(`${r.level}: the mark recorded ${r.mark.noise} noise, under the 17.5 already made`);
  if (r.shots !== r.mark.shots || Math.abs(r.noise - r.mark.noise) > 0.01) {
    problems.push(`${r.level}: death laundered the score (shots ${r.shots} vs ${r.mark.shots}, noise ${r.noise} vs ${r.mark.noise})`);
  }
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
