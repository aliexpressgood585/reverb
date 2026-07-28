/**
 * CAIRN, measured.
 *
 *   node scripts/cairn-check.mjs
 *
 * The whole design rests on one claim: **a failed jump fills the gap it failed
 * at, so no attempt is wasted and no player can be permanently stuck.** That is
 * a testable claim, not a feeling, and this drives the real game loop to test
 * it three ways.
 *
 *  1. A competent climber gets high. If a good bot cannot climb, the jump arc
 *     or the tower generator is wrong.
 *  2. A CLUMSY climber still gets high — a bot with thirty percent random error
 *     on every launch, which is a genuinely bad player. It must make real
 *     progress purely on the bodies it leaves behind. This is the claim.
 *  3. The invariant underneath the claim: every single death leaves a platform
 *     STRICTLY ABOVE the ledge it launched from. This is the literal promise,
 *     and it is checked on every death rather than sampled.
 *  4. Nothing the generator produces is unreachable, so the tower can never
 *     hand you a gap that a full-power launch cannot cross.
 *
 * An earlier draft asserted the looser claim — that no player can ever be stuck
 * — and a bot that undershot every jump by exactly a third disproved it in one
 * run: it converged on a pile at 4 m and stayed there forever. The claim in the
 * code is now the one that survives.
 *
 * It fails non-zero on any of the three, and reports the toll — how many of you
 * it cost to get where you got — because that number is the game.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4196;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
process.on('exit', () => { try { server.kill('SIGTERM'); } catch {} });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/cairn/`)).ok) break; } catch {}
  await delay(400);
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(180000);

const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text().split('\n')[0]); });

await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);

/**
 * Drive the real loop with a bot of a given competence. `skill` 1 aims at the
 * next ledge; 0.66 undershoots every single jump by a third, forever.
 */
const climb = (error, jumps) => page.evaluate(({ error, jumps }) => {
  const G = window.CAIRN;
  const { state, solids, step } = G;
  G.begin();

  const GRAV = G.GRAVITY;
  const MAXV = G.MAX_POWER;
  let deaths0 = state.deaths;
  let unreachable = 0;
  let brokeInvariant = 0;
  // Reproducible clumsiness.
  let seed = 12345;
  const wobble = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return 1 + ((seed % 2000) / 1000 - 1) * error;
  };

  for (let j = 0; j < jumps; j++) {
    // Pick the lowest thing above us that is not what we are standing on.
    let target = null;
    for (const s of solids) {
      if (s === state.standing) continue;
      if (s.y <= state.y + 0.4) continue;
      if (!target || s.y < target.y) target = s;
    }
    if (!target) break;

    // The launch that lands on it: fixed 45-degree-ish arc, solved for range.
    const dx = target.x - state.x;
    const dy = target.y - state.y;
    const dist = Math.hypot(dx, dy) || 1e-6;
    let vy = Math.sqrt(Math.max(1, -2 * GRAV * (dy + dist * 0.42)));
    const tUp = vy / -GRAV;
    const tTot = tUp + Math.sqrt(Math.max(0.01, 2 * (vy * tUp + 0.5 * GRAV * tUp * tUp - dy) / -GRAV));
    let vx = dx / tTot;
    if (Math.hypot(vx, vy) > MAXV) {
      unreachable++;
      const k = MAXV / Math.hypot(vx, vy);
      vx *= k; vy *= k;
    }

    state.vx = vx * wobble();
    state.vy = vy * wobble();
    state.airborne = true;
    const from = state.y;
    const before = state.deaths;
    const nSolids = solids.length;

    for (let f = 0; f < 900 && state.airborne; f++) step(1 / 60);

    // The invariant: a death must leave something to stand on, above the ledge
    // it launched from. Checked on every death, not sampled.
    if (state.deaths > before) {
      // The tower keeps generating during the flight, so the body is somewhere
      // among the new solids rather than reliably the last one.
      const added = solids.slice(nSolids);
      if (!added.some((s) => s.body && s.y > from)) brokeInvariant++;
    }
  }

  return {
    height: Math.round(state.best),
    deaths: state.deaths - deaths0,
    unreachable,
    brokeInvariant,
    solids: solids.length,
    bodies: solids.filter((s) => s.body).length,
  };
}, { error, jumps });

// 1 — a competent climber
const good = await climb(0.0, 60);
console.log(`competent climber   ${String(good.height).padStart(4)}m in 60 jumps, ` +
  `${good.deaths} deaths, ${good.bodies} bodies left`);
if (good.height < 80) problems.push(`a competent climber only reached ${good.height}m in 60 jumps`);

// 2 — the claim: a bad climber still climbs, on its own corpses
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);
const bad = await climb(0.30, 140);
console.log(`clumsy, 30% error   ${String(bad.height).padStart(4)}m in 140 jumps, ` +
  `${bad.deaths} deaths, ${bad.bodies} bodies left`);
if (bad.height < 60) {
  problems.push(`THE CLAIM FAILS: a clumsy climber reached only ${bad.height}m in 140 jumps`);
}
for (const [who, r] of [['competent', good], ['clumsy', bad]]) {
  if (r.brokeInvariant > 0) {
    problems.push(`THE INVARIANT FAILS: ${r.brokeInvariant} of the ${who} climber's deaths left no platform above their take-off`);
  }
}
if (bad.deaths === 0) problems.push('the bad climber never died, so the test proved nothing');
if (bad.bodies === 0) problems.push('deaths left no bodies behind');

// 3 — the generator never asks for a jump that cannot be made
if (good.unreachable > 0 || bad.unreachable > 0) {
  problems.push(`${good.unreachable + bad.unreachable} generated gaps need more than full power`);
}

// 4 — THE ARC MUST NOT LIE
//
// In a precision jumper, an aim line that disagrees with the physics does not
// read as a bad aim line — it reads as bad controls, and every death feels
// like the game cheated rather than like you missed. Playtest verdict on the
// first build was exactly that: "the jumps are not accurate."
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);
const aim = await page.evaluate(() => {
  const G = window.CAIRN;
  const { state, step, predict } = G;
  G.begin();
  const errs = [];
  let missed = 0;
  let seed = 999;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 1000) / 1000; };

  for (let n = 0; n < 120; n++) {
    const v = { vx: (rnd() - 0.5) * 22, vy: 6 + rnd() * 13 };
    const said = predict(v, []);
    state.vx = v.vx; state.vy = v.vy;
    state.airborne = true;
    state.takeoff = state.y;
    state.peakX = state.x; state.peakY = state.y;
    const from = state.standing;
    for (let f = 0; f < 900 && state.airborne; f++) step(1 / 60);
    const didLand = state.standing !== from;
    if (!said && !didLand) continue;          // both agree: this one falls
    if (!said || !didLand) { missed++; continue; }
    errs.push(Math.hypot(said.x - state.x, said.y - state.y));
  }
  errs.sort((a, b) => a - b);
  return {
    n: errs.length,
    median: +(errs[errs.length >> 1] ?? 0).toFixed(4),
    worst: +(errs[errs.length - 1] ?? 0).toFixed(4),
    disagreed: missed,
  };
});
console.log(`aim line vs physics  ${aim.n} landings, median error ` +
  `${(aim.median * 100).toFixed(1)}cm, worst ${(aim.worst * 100).toFixed(1)}cm, ` +
  `${aim.disagreed} outright disagreements`);
if (aim.worst > 0.05) problems.push(`the aim line is off by up to ${(aim.worst * 100).toFixed(0)}cm — it is lying to the player`);
if (aim.disagreed > 0) problems.push(`${aim.disagreed} jumps landed somewhere the aim line did not predict at all`);

// 5 — the loop actually renders on a phone-shaped viewport
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);
await page.evaluate(() => window.CAIRN.begin());
await delay(700);
await page.screenshot({ path: 'shots/cairn.png' });
console.log('\n frame -> shots/cairn.png');

await browser.close();

if (problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of [...new Set(problems)]) console.log(' -', p);
  process.exit(1);
}
console.log('\ncairn: clean — every death leaves a platform above the ledge it launched from');
process.exit(0);
