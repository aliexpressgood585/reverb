#!/usr/bin/env node
/**
 * CAIRN — the balance harness.
 *
 * PHASE3 §1 asks four questions about the difficulty curve and none of them can
 * be answered by playing. They need tens of thousands of climbs, so this file
 * drives `cairn/src/sim.js` directly in Node — the real physics, the real
 * generator, the real erosion — with a bot standing in for a thumb.
 *
 * THE BOT PLAYS BY A THUMB'S RULES.
 *
 * Everything the bot is allowed to do, `input.js` can do:
 *
 *   - a launch is an angle plus a speed in [minSpeed, maxSpeed]. Nothing else.
 *     No sub-minimum taps, no over-power.
 *   - it sees the predicted arc, because the game draws it. Planning with
 *     `predict()` is not cheating, it is reading the screen.
 *   - it receives the same soft angular assist `input.js._assist` gives a
 *     player, re-implemented here rather than approximated, for the same reason
 *     the game has one integrator: a second copy of a rule is a rule that
 *     drifts.
 *   - air control is a held thumb, so only the skills that would know about it
 *     use it.
 *
 * SKILL IS TWO THINGS, BOTH HUMAN.
 *
 *   1. execution — gaussian error on the launch, expressed in DEGREES and in
 *      PERCENT OF POWER, because those are the units a hand misses in. The
 *      existing acceptance bot uses a ±65% per-component multiplier, which is
 *      fine as a smoke test and meaningless as a difficulty measurement.
 *   2. reading — how far up the tower the plan looks. A novice jumps at the
 *      next ledge. An expert skips one when skipping one is on.
 *
 * These numbers are TEST SCAFFOLDING, not game feel, so they live here and not
 * in feel.js. feel.js is what the game is; this is what we measure it with.
 *
 * Usage:
 *   node scripts/cairn-balance.mjs --skill=average --seeds=200 --attempts=50
 *   node scripts/cairn-balance.mjs --all --out=balance.json
 *   node scripts/cairn-balance.mjs --all --tune='{"overreachRate":0.28}'
 *   node scripts/cairn-balance.mjs --skill=expert --trace=3900   # a stuck climb
 *
 * `--tune` patches FEEL.tower in memory for one run, so a parameter sweep does
 * not have to write the file it is searching over. The winning values go into
 * feel.js by hand and get re-measured from the file.
 */

import { writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FEEL, COLUMN } from '../cairn/src/feel.js';
import { Sim, PHASE, solidHalfWidth, predict } from '../cairn/src/sim.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// --------------------------------------------------------------------- skill

export const SKILLS = {
  novice: {
    // A first-session player. Roughly a thumb's width of angular slop at arm's
    // length and a power estimate that is right to about one part in eight.
    angSd: 6.5,          // degrees, 1 sigma
    powSd: 0.115,        // fraction of launch speed, 1 sigma
    lookahead: 2,        // barely looks past the next landable surface
    margins: [3, 8],     // apex clearance above the target it tries
    airControl: false,   // does not know a held thumb steers
    riskAfter: 3,        // stalled launches before taking a wild one
  },
  average: {
    angSd: 3.2,
    powSd: 0.055,
    lookahead: 2,
    margins: [2, 5, 9],
    airControl: true,
    riskAfter: 4,
  },
  expert: {
    angSd: 1.1,
    powSd: 0.022,
    lookahead: 3,
    margins: [1.5, 4, 7],
    airControl: true,
    riskAfter: 6,
  },
};

// ----------------------------------------------------------------- utilities

/** Deterministic float rng — mulberry32, independent of the world's xorshift. */
export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller, one value per call, cached pair. */
export function gaussian(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const median = (a) => {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) * 0.5;
};

const quantile = (a, q) => {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const i = clamp(Math.round((s.length - 1) * q), 0, s.length - 1);
  return s[i];
};

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

// -------------------------------------------------------------------- flight

/**
 * The launch that carries the body from where it stands through (dx, dy) with
 * `margin` units of apex clearance. Rise and fall use their own gravities, so
 * this is close but never exact — the apex hang alone adds horizontal travel.
 * Exactness is not the point: every candidate is verified with `predict()`,
 * which IS the physics, and the best verified one is the one that flies.
 */
export function solve(dx, dy, margin) {
  const peak = Math.max(dy + margin, 0.5);
  const vy = Math.sqrt(2 * FEEL.gravityRise * peak);
  const tUp = vy / FEEL.gravityRise;
  const tDown = Math.sqrt((2 * Math.max(peak - dy, 0)) / FEEL.gravityFall);
  const t = Math.max(tUp + tDown, 1e-3);
  return { vx: dx / t, vy };
}

/** Fold a launch back into what a thumb can actually produce. */
export function legal(vx, vy) {
  const L = FEEL.launch;
  let sp = Math.hypot(vx, vy);
  if (sp < 1e-6) return { vx: 0, vy: L.minSpeed };
  const k = clamp(sp, L.minSpeed, L.maxSpeed) / sp;
  return { vx: vx * k, vy: vy * k };
}

/**
 * `input.js._assist`, re-implemented. Same fan, same window, same cap. The
 * player gets this help on every launch; a bot that did not would measure a
 * harder game than the one that ships.
 */
export function assist(sim, vx, vy, scratch) {
  const L = FEEL.launch;
  if (L.snapWindowDeg <= 0) return { vx, vy };
  const speed = Math.hypot(vx, vy);
  const angle = Math.atan2(vy, vx);
  if (predict(sim, vx, vy, scratch)) return { vx, vy };

  const win = L.snapWindowDeg * DEG;
  let bestOff = 0, bestAbs = Infinity;
  for (let i = 1; i <= 3; i++) {
    const off = (win * i) / 3;
    for (const sgn of [-1, 1]) {
      const a = angle + off * sgn;
      if (predict(sim, Math.cos(a) * speed, Math.sin(a) * speed, scratch)
          && Math.abs(off) < bestAbs) { bestAbs = Math.abs(off); bestOff = off * sgn; }
    }
    if (bestAbs < Infinity) break;
  }
  if (bestOff === 0) return { vx, vy };
  const capped = Math.sign(bestOff) * Math.min(Math.abs(bestOff), L.snapMaxDeg * DEG);
  const a = angle + capped;
  return { vx: Math.cos(a) * speed, vy: Math.sin(a) * speed };
}

// The highest a full-power launch can lift the body, ignoring the apex hang,
// which only ever adds. Used to bound the candidate scan, nothing else.
const LIFT = (FEEL.launch.maxSpeed ** 2) / (2 * FEEL.gravityRise);

/** Landable surfaces above the feet, nearest first. */
export function candidates(sim, out) {
  const b = sim.body;
  out.length = 0;
  const near = sim.world.near(b.y - 2, b.y + LIFT * 1.6);
  for (let i = 0; i < near.length; i++) {
    const s = near[i];
    const top = s.y + s.hh;
    if (top <= b.y + 0.5) continue;
    if (top - b.y > LIFT * 1.5) continue;
    if (solidHalfWidth(s, sim.deaths) <= 0) continue;
    out.push(s);
  }
  out.sort((p, q) => (p.y + p.hh) - (q.y + q.hh));
  return out;
}

/**
 * Choose the launch. Returns { vx, vy, aimX } — `aimX` is where the plan
 * expects to come down, which is what a held thumb steers toward.
 */
export function plan(sim, S, cands, scratch) {
  const b = sim.body;
  let best = null;
  const n = Math.min(S.lookahead, cands.length);

  for (let i = 0; i < n; i++) {
    const t = cands[i];
    const tx = t.x, ty = t.y + t.hh;
    for (const m of S.margins) {
      const raw = solve(tx - b.x, ty - b.y, m);
      const { vx, vy } = legal(raw.vx, raw.vy);
      const hit = predict(sim, vx, vy, scratch);
      if (!hit) continue;
      const top = hit.y + hit.hh;
      if (top <= b.y + 0.5) continue;           // a sideways hop is not progress
      // Height first, but not blindly. A corpse is a 5 u perch and a ledge can
      // be seventeen; a player who takes the nearest surface every time lands on
      // corpses they did not need and dies more the longer they play. The bonus
      // is capped below a single rise, so it breaks ties and never overrules
      // going higher.
      const score = top + Math.min(solidHalfWidth(hit, sim.deaths), 8) * 0.6;
      if (!best || score > best.score) best = { vx, vy, score, aimX: hit.x };
    }
  }
  if (best) return best;

  // Nothing lands. The gap is past the envelope, which is the point — so throw
  // yourself at it properly. Full power, and of the angles available take the
  // one whose APEX comes down closest to the far ledge, because the apex is
  // where the body freezes and the corpse is the step the next attempt uses.
  // A player who understands the game aims their death.
  const t = cands.length ? cands[cands.length - 1] : null;
  const V = FEEL.launch.maxSpeed;
  if (!t) return { vx: 0, vy: V, aimX: b.x, desperate: true };
  const tx = t.x - b.x, ty = t.y + t.hh - b.y;
  // The throw has to actually leave the ledge, or the body lands back where it
  // started and the climb never ends. Only angles that carry the apex clear of
  // the perch are on the table.
  const clear = (b.standing ? solidHalfWidth(b.standing, sim.deaths) : 0)
    + FEEL.body.w * 0.5 + 1;
  let bv = null, bd = Infinity;
  for (let a = 15; a <= 85; a += 2.5) {
    const th = a * DEG * Math.sign(tx || 1);
    const vx = Math.cos(th) * V, vy = Math.sin(th) * V;
    const ax = (vx * vy) / FEEL.gravityRise;        // apex, ideal-gravity form
    const ay = (vy * vy) / (2 * FEEL.gravityRise);
    if (Math.abs(ax) < clear) continue;
    const d = Math.hypot(ax - tx, ay - ty);
    if (d < bd) { bd = d; bv = { vx, vy }; }
  }
  if (!bv) {
    const s = Math.sign(tx || 1);
    bv = { vx: s * V, vy: 0 };                      // straight into the gap
  }
  return { ...bv, aimX: t.x, desperate: true };
}

// -------------------------------------------------------------------- a climb

const MAX_LAUNCHES = 4000;
const MAX_AIR_TICKS = 2400;

/**
 * One attempt, from the base ledge to the death that ends it.
 * Returns the apex height of the death — where the body froze, which is the
 * height the corpse is left at and the honest answer to "how high did I get".
 */
export function climb(sim, S, rnd, scratch, cands, trace) {
  let noGain = 0;
  let lastY = sim.body.y;
  // Was the fatal launch one the bot knew could not land? That separates "the
  // tower asked for a corpse" from "the hand missed", which are different games.
  let lastThrown = false;
  let launched = 0;

  for (let k = 0; k < MAX_LAUNCHES && sim.phase === PHASE.PLAY; k++) {
    // Settle on the ledge for a tick so friction and world generation run
    // exactly as they do in main.js.
    sim.tick(0);
    if (sim.phase !== PHASE.PLAY) break;

    candidates(sim, cands);
    let p = plan(sim, S, cands, scratch);

    // A climber who has stopped gaining ground stops being careful. After
    // `riskAfter * 2` launches with nothing to show for them, they commit.
    if (sim.body.y <= lastY + 0.5) noGain++; else noGain = 0;
    lastY = sim.body.y;
    if (noGain > S.riskAfter * 2) {
      // Not a step off the edge — you cannot fall off a ledge in this game, the
      // landing check re-catches you every tick and the clamp pins you at the
      // lip. Getting off a dead perch takes a real throw, so: full power, forty
      // degrees, toward whichever wall is further away. It lands somewhere else
      // or it kills you, and either one ends the stall.
      const s = sim.body.x < COLUMN * 0.5 ? 1 : -1;
      const th = 40 * DEG;
      p = { vx: s * Math.cos(th) * FEEL.launch.maxSpeed,
            vy: Math.sin(th) * FEEL.launch.maxSpeed,
            aimX: sim.body.x + s * 40, desperate: true };
    }

    // Execution error, in the units a hand misses in.
    let sp = Math.hypot(p.vx, p.vy);
    let ang = Math.atan2(p.vy, p.vx);
    ang += gaussian(rnd) * S.angSd * DEG;
    sp *= 1 + gaussian(rnd) * S.powSd;
    sp = clamp(sp, FEEL.launch.minSpeed, FEEL.launch.maxSpeed);
    const shot = assist(sim, Math.cos(ang) * sp, Math.sin(ang) * sp, scratch);

    sim.launch(shot.vx, shot.vy);
    lastThrown = !!p.desperate;
    launched++;

    for (let f = 0; f < MAX_AIR_TICKS; f++) {
      const b = sim.body;
      const dir = S.airControl && !b.grounded
        ? Math.sign(p.aimX - b.x) * (Math.abs(p.aimX - b.x) > 1.5 ? 1 : 0)
        : 0;
      sim.tick(dir);
      if (sim.phase !== PHASE.PLAY) break;
      if (sim.body.grounded) break;
    }
    if (sim.phase !== PHASE.PLAY) break;

    if (sim.body.grounded && sim.body.y > sim.best) sim.best = sim.body.y;
    if (trace && k > trace) {
      console.log(`    k=${k} y=${sim.body.y.toFixed(1)} noGain=${noGain} ` +
        `desperate=${!!p.desperate} cands=${cands.length} ` +
        `hw=${sim.body.standing ? solidHalfWidth(sim.body.standing, sim.deaths).toFixed(1) : '-'}`);
    }
  }

  // A climb that hit the launch cap without dying is a harness failure, not a
  // result. Report it as such rather than folding it into the numbers.
  if (sim.phase === PHASE.PLAY) return null;
  return { h: sim.body.peakY, thrown: lastThrown, launches: launched };
}

// ---------------------------------------------------------------- the sweep

function run(skillName, seeds, attempts, seed0, trace = 0) {
  const S = SKILLS[skillName];
  const scratch = [];
  const cands = [];

  const deathsByAttempt = Array.from({ length: attempts }, () => []);
  const bestByAttempt = Array.from({ length: attempts }, () => []);
  const allDeaths = [];
  const firstAttempt = [];
  const finalBest = [];
  let stuck = 0;
  let thrownDeaths = 0;
  let launchTotal = 0;

  for (let s = 0; s < seeds; s++) {
    const worldSeed = (seed0 + s * 0x9e3779b1) | 0;
    const sim = new Sim(worldSeed);
    const rnd = rng32((worldSeed ^ 0x5bf03635) >>> 0);
    sim.phase = PHASE.PLAY;

    for (let a = 0; a < attempts; a++) {
      const r = climb(sim, S, rnd, scratch, cands, trace);
      if (r === null) {
        stuck++;
        if (trace) {
          console.log(`    STUCK seed#${s} attempt ${a} ` +
            `y=${sim.body.y.toFixed(1)} deaths=${sim.deaths}`);
        }
        break;
      }
      const h = r.h;
      if (r.thrown) thrownDeaths++;
      launchTotal += r.launches;
      deathsByAttempt[a].push(h);
      allDeaths.push(h);
      if (a === 0) firstAttempt.push(h);
      bestByAttempt[a].push(sim.best);
      sim.respawn();
    }
    finalBest.push(sim.best);
  }

  return { skillName, seeds, attempts, deathsByAttempt, bestByAttempt,
           allDeaths, firstAttempt, finalBest, stuck, thrownDeaths, launchTotal };
}

// ----------------------------------------------------------------- the targets

/**
 * Band histogram. PHASE3 target 4: no single 10 m band holds more than 12% of
 * all deaths. A spike is a generator bug — a height where the tower reliably
 * produces a gap nobody can cross — and it is the one target that is a
 * correctness check rather than a taste judgement.
 */
function bands(deaths, w = 10) {
  const h = new Map();
  for (const d of deaths) {
    const k = Math.floor(Math.max(0, d) / w);
    h.set(k, (h.get(k) || 0) + 1);
  }
  let topK = 0, topN = 0;
  for (const [k, n] of h) if (n > topN) { topN = n; topK = k; }
  const rows = [...h.entries()].sort((a, b) => a[0] - b[0]);
  const heaviest = [...h.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, n]) => [k * w, +(n / deaths.length * 100).toFixed(2)]);
  return { rows, heaviest, topBand: topK * w, topShare: topN / deaths.length, count: deaths.length };
}

/**
 * PHASE3 target 2 is phrased "no plateau > 40 m", which is ambiguous: a stall in
 * a curve of medians against attempt number has a length in attempts, not in
 * metres. Both readings are reported and BALANCE.md states which is which.
 *
 *   stallAttempts — the longest run of consecutive attempts whose medians all
 *                   sit inside a 5 m band. The curve has stopped moving.
 *   stallSpan     — the height that run sits at, so a stall can be located.
 *   band40        — the longest run of consecutive attempts whose medians all
 *                   sit inside a 40 m band, which is the literal reading.
 */
function plateau(curve, width) {
  let best = 0, at = 0;
  for (let i = 0; i < curve.length; i++) {
    let lo = curve[i], hi = curve[i];
    for (let j = i; j < curve.length; j++) {
      lo = Math.min(lo, curve[j]); hi = Math.max(hi, curve[j]);
      if (hi - lo > width) break;
      if (j - i + 1 > best) { best = j - i + 1; at = curve[i]; }
    }
  }
  return { run: best, at };
}

function report(R) {
  const S = SKILLS[R.skillName];
  const medDeath = R.deathsByAttempt.map((a) => median(a));
  const medBest = R.bestByAttempt.map((a) => median(a));
  const b = bands(R.allDeaths);

  const at = (k, arr) => (k - 1 < arr.length ? arr[k - 1] : []);
  const frac = (arr, t) => (arr.length ? arr.filter((v) => v >= t).length / arr.length : 0);

  const out = {
    skill: R.skillName,
    params: S,
    seeds: R.seeds,
    attempts: R.attempts,
    climbs: R.allDeaths.length,
    stuckSeeds: R.stuck,
    launches: R.launchTotal,
    launchesPerClimb: +(R.launchTotal / Math.max(1, R.allDeaths.length)).toFixed(2),
    // deaths on a launch the bot knew could not land — the tower demanding a corpse
    thrownShare: R.thrownDeaths / Math.max(1, R.allDeaths.length),

    deathHeight: {
      median: median(R.allDeaths),
      p10: quantile(R.allDeaths, 0.10),
      p90: quantile(R.allDeaths, 0.90),
      max: Math.max(...R.allDeaths),
      mean: mean(R.allDeaths),
    },
    firstAttempt: {
      median: median(R.firstAttempt),
      p90: quantile(R.firstAttempt, 0.90),
      max: Math.max(...R.firstAttempt),
      over600: frac(R.firstAttempt, 600),
    },
    medianDeathByAttempt: medDeath.map((v) => +v.toFixed(1)),
    medianBestByAttempt: medBest.map((v) => +v.toFixed(1)),

    // target 1 — reachable early ground
    best5: { median: median(at(5, R.bestByAttempt)), over50: frac(at(5, R.bestByAttempt), 50) },
    best25: { median: median(at(25, R.bestByAttempt)), over150: frac(at(25, R.bestByAttempt), 150) },

    // target 2 — a curve that keeps moving
    plateau5: plateau(medDeath, 5),
    plateau40: plateau(medDeath, 40),
    riseFirstToLast: +(medDeath[medDeath.length - 1] - medDeath[0]).toFixed(1),

    // target 3 — a ceiling that exists but is not free
    over600: frac(R.finalBest, 600),
    finalBest: { median: median(R.finalBest), p90: quantile(R.finalBest, 0.90),
                 max: Math.max(...R.finalBest) },

    // target 4 — no generator spike
    band: { top: b.topBand, share: b.topShare, heaviest: b.heaviest },
    bandRows: b.rows,
  };
  return out;
}

// ------------------------------------------------------------------ printing

function line(o) {
  const p = (n, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : 'n/a');
  return [
    `--- ${o.skill}  (${o.climbs} climbs, ${o.seeds} seeds x ${o.attempts} attempts` +
      `${o.stuckSeeds ? `, ${o.stuckSeeds} SEEDS HIT THE LAUNCH CAP` : ''})`,
    `  death height     median ${p(o.deathHeight.median)} m   ` +
      `p10 ${p(o.deathHeight.p10)}   p90 ${p(o.deathHeight.p90)}   max ${p(o.deathHeight.max)}`,
    `  attempt 1        median ${p(o.firstAttempt.median)} m   ` +
      `p90 ${p(o.firstAttempt.p90)}   max ${p(o.firstAttempt.max)}   ` +
      `>=600 m ${(o.firstAttempt.over600 * 100).toFixed(2)}%`,
    `  best after 5     median ${p(o.best5.median)} m   >=50 m in ${(o.best5.over50 * 100).toFixed(1)}% of seeds`,
    `  best after 25    median ${p(o.best25.median)} m   >=150 m in ${(o.best25.over150 * 100).toFixed(1)}% of seeds`,
    `  best after ${String(o.attempts).padEnd(2)}    median ${p(o.finalBest.median)} m   ` +
      `p90 ${p(o.finalBest.p90)}   max ${p(o.finalBest.max)}   >=600 m in ${(o.over600 * 100).toFixed(1)}% of seeds`,
    `  median curve     ${p(o.medianDeathByAttempt[0])} -> ${p(o.medianDeathByAttempt.at(-1))} m ` +
      `(rise ${p(o.riseFirstToLast)} m)   longest 5 m stall ${o.plateau5.run} attempts at ${p(o.plateau5.at)} m` +
      `   longest 40 m stall ${o.plateau40.run} attempts`,
    `  worst 10 m band  ${o.band.top}-${o.band.top + 10} m holds ${(o.band.share * 100).toFixed(2)}% of deaths`,
    `  heaviest bands   ${o.band.heaviest.map(([m, p]) => `${m}m ${p}%`).join('  ')}`,
    `  jumps per climb  ${o.launchesPerClimb}   deaths thrown into an impossible gap ${(o.thrownShare * 100).toFixed(1)}%`,
  ].join('\n');
}

// ---------------------------------------------------------------------- main

// Importable: scripts/cairn-precision.mjs reuses this bot to reach real game
// states. The sweep only runs when this file is the process entry point.
const isMain = process.argv[1]
  && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v === undefined ? true : v];
  }),
);

// Tuning sweep: patch FEEL.tower in memory so a search does not have to write
// the file it is searching over. Nothing here ships; the winning values are
// copied into feel.js by hand and re-measured from the file.
if (args.tune) {
  const patch = JSON.parse(args.tune);
  for (const [k, v] of Object.entries(patch)) {
    if (!(k in FEEL.tower)) throw new Error(`unknown tower key: ${k}`);
    FEEL.tower[k] = v;
  }
}

const seeds = +(args.seeds ?? 200);
const attempts = +(args.attempts ?? 50);
const seed0 = +(args.seed0 ?? 0x1a2b3c);
const which = args.all ? ['novice', 'average', 'expert']
  : [args.skill ?? 'average'];

const results = [];
for (const s of isMain ? which : []) {
  const t0 = Date.now();
  const R = run(s, seeds, attempts, seed0, +(args.trace ?? 0));
  const o = report(R);
  o.wallSeconds = +((Date.now() - t0) / 1000).toFixed(1);
  results.push(o);
  console.log(line(o) + `\n  ${o.wallSeconds}s`);
}

if (isMain && args.out) {
  mkdirSync(args.out.replace(/\/[^/]*$/, ''), { recursive: true });
  writeFileSync(args.out, JSON.stringify(results, null, 1));
  console.log(`\nwrote ${args.out}`);
}
