/**
 * Can a creature actually get to the sound it heard?
 *
 *   node scripts/hunt-check.mjs
 *
 * scripts/nav-check.mjs proves a route exists on the grid. This proves the
 * creature walks it, in the real game loop, through the real collision pass.
 * Every enemy in every level is locked into HUNT with the player's spawn as its
 * target and given thirty seconds; the number recorded is its closest approach.
 *
 * The run is done twice — once with the grid and once with `level.nav` cleared,
 * which is the same straight-line-and-slide behaviour that existed before it —
 * so the improvement is a measurement rather than a claim.
 *
 * It fails if any creature ends up further than two metres from a target the
 * grid says is reachable.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4197;
const SECONDS = 30;
const ARRIVED = 2.0;

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

await page.goto(`http://127.0.0.1:${PORT}/?lm=512&msaa=0&nosound=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.REVERB);
await page.evaluate(() => {
  window.REVERB.setFixedStep(1 / 60);
  window.REVERB.setHeadlessLogicOnly(true);
});

const trial = (lvl, withNav) => page.evaluate(({ lvl, withNav, SECONDS }) => {
  const g = window.REVERB;
  g.debugEnter(lvl, {});
  const nav = g.level.nav;
  if (!withNav) g.level.nav = null;

  const probe = { x: g.level.def.spawn.x, z: g.level.def.spawn.z };
  // Park the player somewhere nothing can touch, so a creature reaching the
  // probe point does not end the run by killing them.
  g.player.position.set(1e5, 0, 1e5);

  const start = g.enemies.map((e) => ({ x: e.position.x, z: e.position.z }));
  const best = g.enemies.map(() => Infinity);
  const steps = Math.round(SECONDS * 60);
  for (let f = 0; f < steps; f++) {
    for (let i = 0; i < g.enemies.length; i++) {
      const e = g.enemies[i];
      if (!e.alive) continue;
      e.state = 'HUNT';
      e.memory = 7.0;
      e.confidence = 1.6;
      e.target.set(probe.x, e.position.y, probe.z);
      e.update(1 / 60, g.player);
      const d = Math.hypot(e.position.x - probe.x, e.position.z - probe.z);
      if (d < best[i]) best[i] = d;
    }
    g.pulses.update(1 / 60);
  }

  return g.enemies.map((e, i) => ({
    type: e.type,
    from: `${start[i].x.toFixed(0)},${start[i].z.toFixed(0)}`,
    closest: +best[i].toFixed(2),
    reachable: nav.reachable(start[i].x, start[i].z, probe.x, probe.z),
  }));
}, { lvl, withNav, SECONDS });

const names = ['PLATFORM', 'TURNSTILES', 'THE TUNNEL', 'MAINTENANCE', 'THE DEEP'];
let improved = 0;
let total = 0;

for (let lvl = 0; lvl < 5; lvl++) {
  const withNav = await trial(lvl, true);
  const without = await trial(lvl, false);
  console.log(`\n${names[lvl]}  (closest approach to the player's spawn in ${SECONDS}s)`);
  for (let i = 0; i < withNav.length; i++) {
    const a = withNav[i], b = without[i];
    const mark = a.closest <= ARRIVED ? 'arrives' : 'stops short';
    console.log(
      `  ${a.type.padEnd(9)} from ${a.from.padEnd(9)} ` +
      `straight line ${b.closest.toFixed(2).padStart(7)}m  →  grid ${a.closest.toFixed(2).padStart(7)}m   ${mark}`
    );
    total++;
    if (b.closest - a.closest > 1.0) improved++;
    if (a.reachable && a.closest > ARRIVED) {
      problems.push(`${names[lvl]}: ${a.type} from ${a.from} only got within ${a.closest}m of a reachable target`);
    }
  }
}

console.log(`\n${improved} of ${total} creatures get more than a metre closer with the grid than without it.`);

await browser.close();

if (problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of problems) console.log(' -', p);
  process.exit(1);
}
console.log('hunt: clean');
process.exit(0);
