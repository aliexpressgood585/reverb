/**
 * CAIRN, measured.
 *
 *   node scripts/cairn-check.mjs
 *
 * Four promises, each of which the game would otherwise only be assumed to
 * keep. All four are checked by driving the real loop, never a copy of it.
 *
 *  1. **Precision.** "As precise as it gets" has to mean something testable, so
 *     it means this: the identical launch lands on the identical centimetre
 *     regardless of frame rate. The same climb is played at a steady 60 Hz, a
 *     steady 120 Hz and a deliberately stuttering cadence, and any disagreement
 *     at all fails the build. Before the fixed 120 Hz step, the jump you got
 *     depended on the device you were holding.
 *
 *  2. **Every level is finishable inside its stone budget.** A level that
 *     cannot be beaten is worse than one that is too hard.
 *
 *  3. **The one rule holds.** Every death must leave a platform strictly above
 *     the ledge it launched from. Checked on every death, not sampled. (The
 *     looser claim — that nobody can ever be stuck — is false, and an earlier
 *     bot proved it: a climber who under-pulls every jump converges on a pile
 *     at 4 m and stays there. The claim in the code is the one that survives.)
 *
 *  4. **A clumsy climber still gets somewhere.** Thirty percent random error on
 *     every launch, which is a genuinely bad player, on the bodies it leaves.
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

/** Play one level to a conclusion, at a given frame cadence and clumsiness. */
const play = (lvl, error, cadence) => page.evaluate(({ lvl, error, cadence }) => {
  const G = window.CAIRN;
  const s = G.state;
  G.loadLevel(lvl);

  let seed = 4242;
  const wobble = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return 1 + ((seed % 2000) / 1000 - 1) * error;
  };
  let ci = 0;

  // Aim at the next thing above us.
  //
  // The lazy arc is a roughly 45-degree lob that overshoots slightly, because
  // aiming past the target survives a shaky hand. When that costs more than a
  // full-power launch the bot falls back to the MINIMUM-SPEED solution, which
  // is the true test of whether a gap is crossable at all:
  //
  //     v_min² = g · (dy + |(dx, dy)|)
  //
  // Only when that exceeds MAX_POWER is a gap genuinely impossible. Reporting
  // the lazy arc's failures as "unreachable" blamed the level generator for
  // the bot's own laziness, which is what the first run of this did.
  const g = -G.GRAVITY;
  const aim = (t) => {
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const r = Math.hypot(dx, dy) || 1e-6;

    const vy = Math.sqrt(Math.max(1, 2 * g * (dy + r * 0.42)));
    const tUp = vy / g;
    const tTot = tUp + Math.sqrt(Math.max(0.01, 2 * (vy * tUp - 0.5 * g * tUp * tUp - dy) / g));
    const vx = dx / tTot;
    if (Math.hypot(vx, vy) <= G.MAX_POWER) return { vx, vy, over: false };

    const vmin = Math.sqrt(g * (dy + r));
    if (vmin > G.MAX_POWER) return { vx: vx, vy: vy, over: true };
    // A hair over the minimum, because the minimum-speed arc arrives
    // tangentially — it grazes the target rather than descending onto it, and
    // the landing test needs a crossing.
    const sp2 = Math.min(G.MAX_POWER, vmin * 1.08);
    const th = Math.atan2(dy + r, Math.abs(dx) || 1e-6);
    return { vx: Math.sign(dx) * sp2 * Math.cos(th), vy: sp2 * Math.sin(th), over: false };
  };

  let unreachable = 0;
  let brokeInvariant = 0;
  let jumps = 0;

  while (s.phase === 'climb' && jumps < 400) {
    let target = null;
    for (const sol of G.solids()) {
      if (sol === s.standing) continue;
      if (sol.y <= s.y + 0.4) continue;
      if (!target || sol.y < target.y) target = sol;
    }
    if (!target) break;

    const a = aim(target);
    if (a.over) unreachable++;

    const from = s.y;
    const spent0 = s.spent;
    const n0 = G.solids().length;
    G.launch({ vx: a.vx * wobble(), vy: a.vy * wobble() });
    jumps++;

    let guard = 0;
    while (s.airborne && s.phase === 'climb' && guard++ < 4000) {
      G.advance(cadence[ci++ % cadence.length]);
    }

    if (s.spent > spent0) {
      const added = G.solids().slice(n0);
      if (!added.some((x) => x.body && x.y > from)) brokeInvariant++;
    }
  }

  return {
    name: G.LEVELS[lvl].name,
    phase: s.phase,
    spent: s.spent,
    budget: G.LEVELS[lvl].stones,
    par: G.LEVELS[lvl].par,
    summit: Math.round(G.summit()),
    reached: Math.round(s.best),
    jumps, unreachable, brokeInvariant,
    endX: +s.x.toFixed(6),
    endY: +s.y.toFixed(6),
  };
}, { lvl, error, cadence });

const STEADY60 = [1 / 60];
const STEADY120 = [1 / 120];
const STUTTER = [1 / 60, 1 / 61, 1 / 30, 1 / 144, 0.05, 1 / 90, 1 / 47];

// --------------------------------------------------------------- 1. precision
console.log('precision — the same climb at three frame rates');
const a = await play(3, 0.0, STEADY60);
const b = await play(3, 0.0, STEADY120);
const c = await play(3, 0.0, STUTTER);
for (const [label, r] of [['60Hz    ', a], ['120Hz   ', b], ['stutter ', c]]) {
  console.log(`  ${label} ends at ${r.endX}, ${r.endY}   ${r.spent} stones, ${r.jumps} jumps`);
}
const same = (p, q) => p.endX === q.endX && p.endY === q.endY && p.spent === q.spent && p.jumps === q.jumps;
if (!same(a, b) || !same(a, c)) {
  problems.push('the same climb ends somewhere different at a different frame rate — physics is not frame-independent');
} else {
  console.log('  identical to the last decimal at every cadence');
}

// -------------------------------------------------- 2 & 3. every level, cleanly
console.log('\ncompetent climber');
for (let i = 0; i < 8; i++) {
  const r = await play(i, 0.0, STEADY60);
  const ok = r.phase === 'cleared';
  console.log(`  ${String(r.name).padEnd(12)} ${ok ? 'topped out' : 'FAILED    '} ` +
    `${String(r.reached).padStart(3)}/${r.summit}m  ${r.spent}/${r.budget} stones (par ${r.par})  ${r.jumps} jumps`);
  if (!ok) problems.push(`${r.name} could not be finished inside its budget of ${r.budget} stones`);
  if (r.unreachable > 0) problems.push(`${r.name}: ${r.unreachable} gaps need more than a full-power launch`);
  if (r.brokeInvariant > 0) {
    problems.push(`THE ONE RULE FAILS on ${r.name}: ${r.brokeInvariant} deaths left no platform above their take-off`);
  }
}

// ------------------------------------------------------------ 4. clumsy climber
console.log('\nclumsy climber, 30% random error on every launch');
let cleared = 0;
for (let i = 0; i < 8; i++) {
  const r = await play(i, 0.30, STEADY60);
  if (r.phase === 'cleared') cleared++;
  console.log(`  ${String(r.name).padEnd(12)} ${r.phase === 'cleared' ? 'topped out' : 'ran out   '} ` +
    `${String(r.reached).padStart(3)}/${r.summit}m  ${r.spent}/${r.budget} stones`);
  if (r.brokeInvariant > 0) {
    problems.push(`THE ONE RULE FAILS on ${r.name} under clumsiness: ${r.brokeInvariant} deaths left nothing`);
  }
}
console.log(`  ${cleared} of 8 topped out while missing constantly`);
if (cleared === 8) console.log('  NOTE: clearing everything while missing constantly means it is too generous');

// ----------------------------------------------------------------- 5. it renders
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);
await page.evaluate(() => window.CAIRN.loadLevel(2));
await delay(800);
await page.screenshot({ path: 'shots/cairn.png' });
console.log('\n frame -> shots/cairn.png');

await browser.close();

if (problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of [...new Set(problems)]) console.log(' -', p);
  process.exit(1);
}
console.log('\ncairn: clean');
process.exit(0);
