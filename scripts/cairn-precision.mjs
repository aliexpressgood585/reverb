#!/usr/bin/env node
/**
 * CAIRN — is a jump as accurate as it can be?
 *
 * Three separate questions, none of which the acceptance suite answers at
 * volume, and all of which decide whether a missed jump is the player's fault.
 *
 *   A  DOES THE DRAWN ARC TELL THE TRUTH?
 *      The game draws the exact flight while you aim. If the arc and the
 *      flight ever disagree, the game is lying at the only moment the player
 *      is making a decision. `predict()` calls the same `_flight` the game
 *      runs, so on flat ground this is true by construction — but "by
 *      construction" is what the two-integrator bug in DECISIONS.md §4 also
 *      looked like, right up until it diverged by twenty-two units. Measured
 *      here from the ground AND from a wall cling.
 *
 *   B  HOW MUCH SLOP DOES A JUMP TOLERATE?
 *      For a real jump on a real tower: how far can the launch angle be wrong
 *      before the body dies, and how far before it misses the ledge it was
 *      aimed at. Answered in degrees, per jump, over thousands of jumps.
 *
 *   C  IS THAT SLOP BIGGER THAN A THUMB?
 *      A drag of `r` pixels resolves one pixel as (180/pi)/r degrees. If a jump
 *      demands finer aim than one pixel can express, it is not a hard jump, it
 *      is an unaimable one. B is only meaningful next to this number.
 *
 * Usage:
 *   node scripts/cairn-precision.mjs
 *   node scripts/cairn-precision.mjs --seeds=40 --attempts=25 --every=6
 */

import { FEEL, COLUMN } from '../cairn/src/feel.js';
import { Sim, PHASE, predict } from '../cairn/src/sim.js';
import { SKILLS, plan, candidates, assist, rng32 } from './cairn-balance.mjs';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const SEEDS = +(args.seeds ?? 40);
const ATTEMPTS = +(args.attempts ?? 25);
const EVERY = +(args.every ?? 6);        // sample one jump in this many

const q = (a, p) => {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  return s[clamp(Math.round((s.length - 1) * p), 0, s.length - 1)];
};

// ---------------------------------------------------------------------------
// A. does the drawn arc tell the truth?
// ---------------------------------------------------------------------------

/**
 * Fly the body for real with no air control, which is exactly what `predict`
 * assumes, and report where it actually ended up.
 */
function flyForReal(sim) {
  for (let f = 0; f < 3000; f++) {
    sim.tick(0);
    if (sim.phase !== PHASE.PLAY) return { died: true };
    if (sim.body.grounded) {
      return { died: false, solid: sim.body.standing, x: sim.body.x, y: sim.body.y };
    }
  }
  return { died: false, solid: null, x: sim.body.x, y: sim.body.y, ranOut: true };
}

/** Put the body into a live wall cling: airborne, touching a column wall. */
function reachWallCling(sim, side, angleDeg) {
  const th = angleDeg * DEG;
  sim.launch(side * Math.cos(th) * FEEL.launch.maxSpeed,
             Math.sin(th) * FEEL.launch.maxSpeed);
  for (let f = 0; f < 400; f++) {
    sim.tick(0);
    if (sim.phase !== PHASE.PLAY) return false;
    if (sim.body.grounded) return false;
    if (sim.body.onWall !== 0 && sim.canLaunch()) return true;
  }
  return false;
}

function arcFidelity() {
  const arc = [];
  const rows = { ground: [], wall: [] };
  let wallSamples = 0;

  for (let s = 0; s < 200; s++) {
    const seed = (0x1a2b3c + s * 0x9e3779b1) | 0;

    // --- from the ground -----------------------------------------------
    for (let k = 0; k < 12; k++) {
      const sim = new Sim(seed);
      sim.phase = PHASE.PLAY;
      const ang = (25 + ((s * 7 + k * 11) % 130)) * DEG;
      const sp = FEEL.launch.minSpeed
        + ((s * 13 + k * 29) % 100) / 100 * (FEEL.launch.maxSpeed - FEEL.launch.minSpeed);
      const vx = Math.cos(ang) * sp, vy = Math.sin(ang) * sp;

      const pSolid = predict(sim, vx, vy, arc);
      const pX = arc.length ? arc[arc.length - 2] : NaN;
      const pY = arc.length ? arc[arc.length - 1] : NaN;

      sim.launch(vx, vy);
      const real = flyForReal(sim);

      const agree = (!!pSolid) === (!real.died) && pSolid === (real.solid ?? null);
      // A landing error only means anything when both agree there WAS a landing.
      const both = agree && !real.died;
      rows.ground.push({ agree, dx: both ? Math.abs(pX - real.x) : 0,
                         dy: both ? Math.abs(pY - real.y) : 0 });
    }

    // --- from a wall cling ---------------------------------------------
    for (const side of [-1, 1]) {
      const sim = new Sim(seed);
      sim.phase = PHASE.PLAY;
      if (!reachWallCling(sim, side, 22 + (s % 40))) continue;
      wallSamples++;

      const ang = (55 + (s % 60)) * DEG;
      const sp = FEEL.launch.maxSpeed * (0.6 + (s % 40) / 100);
      const vx = -side * Math.cos(ang) * sp, vy = Math.sin(ang) * sp;

      const pSolid = predict(sim, vx, vy, arc);
      const pX = arc.length ? arc[arc.length - 2] : NaN;
      const pY = arc.length ? arc[arc.length - 1] : NaN;

      sim.launch(vx, vy);
      const real = flyForReal(sim);

      const agree = (!!pSolid) === (!real.died) && pSolid === (real.solid ?? null);
      const both = agree && !real.died;
      rows.wall.push({ agree, dx: both ? Math.abs(pX - real.x) : 0,
                       dy: both ? Math.abs(pY - real.y) : 0 });
    }
  }

  const sum = (r) => ({
    n: r.length,
    disagree: r.filter((x) => !x.agree).length,
    worstDx: r.length ? Math.max(...r.map((x) => x.dx)) : 0,
    worstDy: r.length ? Math.max(...r.map((x) => x.dy)) : 0,
    medDx: q(r.map((x) => x.dx), 0.5),
  });
  return { ground: sum(rows.ground), wall: sum(rows.wall), wallSamples };
}

// ---------------------------------------------------------------------------
// D. is the previewed body where the real one lands?
// ---------------------------------------------------------------------------

/**
 * When a launch cannot land, the game draws the silhouette you are about to
 * become at the apex. That preview is only worth drawing if it is exact: it is
 * the whole basis of deciding WHERE to die, which on this tower is a real
 * decision, because the body is the step the next attempt uses.
 */
function ghostFidelity() {
  const arc = [];
  let n = 0, worst = 0, missing = 0;

  for (let s = 0; s < 400; s++) {
    const seed = (0x1a2b3c + s * 0x9e3779b1) | 0;
    for (let k = 0; k < 8; k++) {
      const sim = new Sim(seed);
      sim.phase = PHASE.PLAY;
      // Aim low and sideways on purpose: these are the launches that die.
      const ang = (8 + ((s * 5 + k * 13) % 34)) * DEG * (k % 2 ? 1 : -1);
      const sp = FEEL.launch.maxSpeed * (0.55 + ((s + k) % 45) / 100);
      const vx = Math.cos(ang) * sp, vy = Math.abs(Math.sin(ang)) * sp;

      const landed = predict(sim, vx, vy, arc);
      if (landed || !sim.predictPeak.dies) continue;
      const px = sim.predictPeak.x, py = sim.predictPeak.y;

      sim.launch(vx, vy);
      const real = flyForReal(sim);
      if (!real.died) continue;

      let corpse = null;
      for (const sol of sim.world.solids) {
        if (sol.corpse && (!corpse || sol.order > corpse.order)) corpse = sol;
      }
      if (!corpse) { missing++; continue; }
      n++;
      worst = Math.max(worst, Math.hypot(corpse.x - px, corpse.y - py));
    }
  }
  return { n, worst, missing };
}

// ---------------------------------------------------------------------------
// B. how much slop does a jump tolerate?
// ---------------------------------------------------------------------------

/**
 * Walk outward from a launch that works until it stops working, by bisection.
 * `ok(v)` must be true at `good` and is assumed to fail somewhere before
 * `good + span`. Returns the offset at which it stops.
 */
function edge(ok, good, span, iters = 16) {
  if (ok(good + span)) return span;                 // wider than we bothered to look
  let lo = 0, hi = span;
  for (let i = 0; i < iters; i++) {
    const mid = (lo + hi) * 0.5;
    if (ok(good + mid)) lo = mid; else hi = mid;
  }
  return lo;
}

function tolerance(sim, p, scratch) {
  const sp0 = Math.hypot(p.vx, p.vy);
  const a0 = Math.atan2(p.vy, p.vx);
  const target = predict(sim, p.vx, p.vy, scratch);
  if (!target) return null;

  const shoot = (ang, sp) => predict(sim, Math.cos(ang) * sp, Math.sin(ang) * sp, scratch);

  // survival: any landing at all. You cannot land below your take-off in this
  // game, so "predict returned a solid" is exactly "you did not die".
  const liveA = (ang) => !!shoot(ang, sp0);
  // progress: landed somewhere higher than the perch. Survival overstates the
  // case, because landing back on the ledge you left counts as not dying.
  const gainA = (ang) => {
    const r = shoot(ang, sp0);
    return !!r && r.y + r.hh > sim.body.y + 0.5;
  };
  // precision: the ledge you actually aimed at.
  const hitA = (ang) => shoot(ang, sp0) === target;

  const aLiveHi = edge(liveA, a0, 20 * DEG) / DEG;
  const aLiveLo = edge(liveA, a0, -20 * DEG) / DEG;
  const aGainHi = edge(gainA, a0, 20 * DEG) / DEG;
  const aGainLo = edge(gainA, a0, -20 * DEG) / DEG;
  const aHitHi = edge(hitA, a0, 20 * DEG) / DEG;
  const aHitLo = edge(hitA, a0, -20 * DEG) / DEG;

  // power, clipped to what a thumb can produce
  const L = FEEL.launch;
  const headroom = L.maxSpeed - sp0;
  const footroom = L.minSpeed - sp0;
  const liveS = (sp) => !!shoot(a0, clamp(sp, L.minSpeed, L.maxSpeed));
  const sLiveHi = headroom > 0.01 ? edge(liveS, sp0, headroom) : 0;
  const sLiveLo = footroom < -0.01 ? -edge(liveS, sp0, footroom) : 0;

  return {
    angLive: Math.abs(aLiveHi) + Math.abs(aLiveLo),
    angGain: Math.abs(aGainHi) + Math.abs(aGainLo),
    angHit: Math.abs(aHitHi) + Math.abs(aHitLo),
    spdLive: (sLiveHi + sLiveLo) / sp0,        // as a fraction of launch speed
    atMaxPower: headroom <= 0.01,
    y: sim.body.y,
  };
}

function slopSurvey() {
  const S = SKILLS.expert;
  const scratch = [];
  const cands = [];
  const out = [];
  const byHeight = new Map();

  for (let s = 0; s < SEEDS; s++) {
    const seed = (0x1a2b3c + s * 0x9e3779b1) | 0;
    const sim = new Sim(seed);
    const rnd = rng32((seed ^ 0x5bf03635) >>> 0);
    sim.phase = PHASE.PLAY;

    for (let a = 0; a < ATTEMPTS; a++) {
      let k = 0;
      while (sim.phase === PHASE.PLAY && k < 400) {
        sim.tick(0);
        if (sim.phase !== PHASE.PLAY) break;
        candidates(sim, cands);
        const p = plan(sim, S, cands, scratch);

        if (!p.desperate && k % EVERY === 0) {
          const t = tolerance(sim, p, scratch);
          if (t) {
            out.push(t);
            const band = Math.floor(t.y / 200) * 200;
            if (!byHeight.has(band)) byHeight.set(band, []);
            byHeight.get(band).push(t);
          }
        }

        // fly it for real, with the same aim error a hand has
        let sp = Math.hypot(p.vx, p.vy);
        let ang = Math.atan2(p.vy, p.vx);
        ang += (rnd() - 0.5) * 2 * S.angSd * DEG;
        sp = clamp(sp * (1 + (rnd() - 0.5) * 2 * S.powSd),
                   FEEL.launch.minSpeed, FEEL.launch.maxSpeed);
        const shot = assist(sim, Math.cos(ang) * sp, Math.sin(ang) * sp, scratch);
        sim.launch(shot.vx, shot.vy);
        for (let f = 0; f < 2000; f++) {
          sim.tick(0);
          if (sim.phase !== PHASE.PLAY || sim.body.grounded) break;
        }
        if (sim.body.grounded && sim.body.y > sim.best) sim.best = sim.body.y;
        k++;
      }
      if (sim.phase === PHASE.PLAY) break;
      sim.respawn();
    }
  }
  return { out, byHeight };
}

// ---------------------------------------------------------------------------
// E. and how much slop does a jump off a WALL tolerate?
// ---------------------------------------------------------------------------

/**
 * THE ONE PLACE SECTION B HAS NEVER LOOKED.
 *
 * B samples the expert bot's own line, and the bot leaves from the ground on
 * every jump it takes — so 4,000-odd measured jumps say nothing whatsoever
 * about a launch off a cling, which is a thing every player does. Section A
 * proves the ARC is honest from a wall (it was not, once: `launchVelocity`
 * existed because the kick was added in `_fire` and `predict` did not know, and
 * a cling launch flew 16 u/s further sideways than the line the player aimed
 * with). Honest and forgiving are different properties.
 *
 * The cling is entered for real rather than faked: the body is put in the air
 * beside a wall moving into it, and ticked until the sim itself reports
 * `onWall !== 0 && canLaunch()`. Anything that does not get there in time is
 * discarded rather than measured, and the discard count is reported — a survey
 * that quietly measured near-wall AIR launches would read almost exactly like a
 * ground launch and look like good news.
 *
 * `tolerance()` is reused unchanged. It reads `sim.body` wherever it is, and
 * `predict` routes through `launchVelocity`, so the kick is in every number
 * below by construction.
 */
function clingSlop() {
  const scratch = [];
  const out = [];
  let tried = 0, clung = 0, aimless = 0;
  const halfW = FEEL.body.w * 0.5;

  for (let s = 0; s < SEEDS; s++) {
    const seed = (0x1a2b3c + s * 0x9e3779b1) | 0;
    const sim = new Sim(seed);
    sim.phase = PHASE.PLAY;
    sim.world.generate(900);

    for (let h = 90; h <= 780; h += 30) {
      for (const side of [-1, 1]) {
        tried++;
        const b = sim.body;
        b.x = b.px = side < 0 ? halfW + 1.5 : COLUMN - halfW - 1.5;
        b.y = b.py = h;
        b.vx = side * 30; b.vy = -6;
        b.grounded = false; b.standing = null;
        b.onWall = 0; b.wallTimer = 0; b.coyote = 0;
        // Well below the placement, or `_flight` calls this a death on tick one.
        b.takeoff = h - 200;
        b.peakX = b.x; b.peakY = b.y; b.hangTimer = 0; b.airTime = 0;
        b.t = sim.verbTime;

        let ok = false;
        for (let f = 0; f < 40; f++) {
          sim.tick(0);
          if (sim.phase !== PHASE.PLAY || sim.body.grounded) break;
          if (sim.body.onWall !== 0 && sim.canLaunch()) { ok = true; break; }
        }
        if (sim.phase !== PHASE.PLAY) { sim.phase = PHASE.PLAY; continue; }
        if (!ok) continue;
        clung++;

        // A launch from here that lands on something. Swept rather than
        // planned, because `plan` is written for a bot standing on a ledge.
        let best = null;
        for (let a = 25; a <= 155 && !best; a += 2) {
          for (let sp = FEEL.launch.maxSpeed; sp >= FEEL.launch.minSpeed; sp -= 4) {
            const vx = Math.cos(a * DEG) * sp, vy = Math.sin(a * DEG) * sp;
            const land = predict(sim, vx, vy, scratch);
            if (land && land.y + land.hh > sim.body.y + 0.5) { best = { vx, vy }; break; }
          }
        }
        if (!best) { aimless++; continue; }
        const t = tolerance(sim, best, scratch);
        if (t) out.push(t);
      }
    }
  }
  return { out, tried, clung, aimless };
}

// ---------------------------------------------------------------------------
// C. what can a thumb express?
// ---------------------------------------------------------------------------

/**
 * One pixel of drag, in degrees, at a given drag radius. The aim ray is the
 * drag vector, so angular resolution is pure geometry: the further the thumb is
 * from where the drag began, the finer one pixel becomes. That is the precision
 * mechanic in `input.js` stated as a number.
 */
const degPerPx = (r) => (180 / Math.PI) / r;

/** u/s of launch speed per pixel of pull, at a given fraction of full power. */
function speedPerPx(raw, screenH) {
  const L = FEEL.launch;
  const maxPull = screenH * L.maxPullScreenFrac;
  const dEased = L.powerEase * Math.pow(1 - raw, L.powerEase - 1);
  return (L.maxSpeed - L.minSpeed) * dEased / (maxPull - L.deadZonePx);
}

// ---------------------------------------------------------------------------

const PHONE_H = 844;
const maxPull = PHONE_H * FEEL.launch.maxPullScreenFrac;

console.log('CAIRN precision\n');

console.log('A. does the drawn arc tell the truth?');
const fid = arcFidelity();
for (const [name, r] of [['from the ground', fid.ground], ['from a wall cling', fid.wall]]) {
  if (!r.n) { console.log(`   ${name.padEnd(18)} no samples`); continue; }
  const verdict = r.disagree === 0 ? 'exact' : `${r.disagree} DISAGREEMENTS`;
  console.log(`   ${name.padEnd(18)} ${String(r.n).padStart(5)} launches   ` +
    `${verdict}   worst landing error ${r.worstDx.toFixed(3)}u across, ` +
    `${r.worstDy.toFixed(3)}u up`);
}

console.log('\nD. is the previewed body where the real one lands?');
const gh = ghostFidelity();
console.log(`   ${gh.n} launches that die   worst preview-to-corpse error ` +
  `${gh.worst.toFixed(3)}u${gh.missing ? `   ${gh.missing} WITH NO CORPSE` : ''}`);

console.log('\nB. how much slop does a jump tolerate?');
const { out, byHeight } = slopSurvey();
const live = out.map((t) => t.angLive);
const gain = out.map((t) => t.angGain);
const hit = out.map((t) => t.angHit);
const spd = out.map((t) => t.spdLive * 100);
console.log(`   ${out.length} jumps sampled on real towers, expert line`);
const show = (label, a, unit) => console.log(
  `   ${label.padEnd(28)} p1 ${q(a, 0.01).toFixed(2)}${unit}   ` +
  `p5 ${q(a, 0.05).toFixed(2)}${unit}   median ${q(a, 0.5).toFixed(2)}${unit}   ` +
  `p95 ${q(a, 0.95).toFixed(2)}${unit}`);
show('angle before you die', live, ' deg');
show('angle before you stop climbing', gain, ' deg');
show('angle before you miss the ledge', hit, ' deg');
show('power before you die', spd, '%');

console.log('\nE. and off a WALL?  (the one footing B never samples)');
const cl = clingSlop();
if (!cl.out.length) {
  console.log(`   no cling samples — ${cl.tried} attempts, ${cl.clung} reached a ` +
    `wall, ${cl.aimless} had no landing launch`);
} else {
  const cLive = cl.out.map((t) => t.angLive);
  const cGain = cl.out.map((t) => t.angGain);
  console.log(`   ${cl.out.length} launches measured from a real cling ` +
    `(${cl.clung} of ${cl.tried} placements reached a wall, ` +
    `${cl.aimless} of those had nothing to aim at)`);
  const cmp = (label, ground, cling, unit) => console.log(
    `   ${label.padEnd(28)} ground median ${q(ground, 0.5).toFixed(2)}${unit}   ` +
    `cling median ${q(cling, 0.5).toFixed(2)}${unit}   ` +
    `cling p5 ${q(cling, 0.05).toFixed(2)}${unit}`);
  cmp('angle before you die', live, cLive, ' deg');
  cmp('angle before you stop climbing', gain, cGain, ' deg');
  const ratio = q(cGain, 0.5) / Math.max(1e-6, q(gain, 0.5));
  console.log(`   a cling launch forgives ${(ratio * 100).toFixed(0)}% of what a ` +
    `ground launch forgives, by median climb window`);
}

console.log('\nC. what can a thumb express?  (390x844 phone)');
console.log(`   power saturates at ${maxPull.toFixed(0)} px of pull ` +
  `(${(FEEL.launch.maxPullScreenFrac * 100).toFixed(0)}% of screen height)`);
for (const r of [maxPull, maxPull * 1.5, maxPull * 2]) {
  console.log(`   one pixel at ${r.toFixed(0).padStart(3)} px of pull = ` +
    `${degPerPx(r).toFixed(3)} deg`);
}
for (const raw of [0.25, 0.6, 0.9]) {
  console.log(`   one pixel at ${(raw * 100).toFixed(0)}% power = ` +
    `${speedPerPx(raw, PHONE_H).toFixed(3)} u/s ` +
    `(${(speedPerPx(raw, PHONE_H) / FEEL.launch.maxSpeed * 100).toFixed(2)}% of max)`);
}

console.log('\n   verdict');
const px = degPerPx(maxPull);
for (const [n, lim] of [['1 px', px], ['3 px', px * 3], ['10 px', px * 10]]) {
  const sl = live.filter((v) => v < lim).length / live.length;
  const sg = gain.filter((v) => v < lim).length / gain.length;
  console.log(`   narrower than ${n.padEnd(5)} (${lim.toFixed(2)} deg):  ` +
    `survival ${(sl * 100).toFixed(2)}%   climb ${(sg * 100).toFixed(2)}%`);
}

console.log('\n   by height');
for (const band of [...byHeight.keys()].sort((a, b) => a - b).slice(0, 10)) {
  const r = byHeight.get(band);
  console.log(`   ${String(band).padStart(5)}-${String(band + 200).padEnd(5)} m  ` +
    `n=${String(r.length).padStart(5)}  ` +
    `median climb window ${q(r.map((t) => t.angGain), 0.5).toFixed(2)} deg   ` +
    `p5 ${q(r.map((t) => t.angGain), 0.05).toFixed(2)} deg   ` +
    `at max power ${(r.filter((t) => t.atMaxPower).length / r.length * 100).toFixed(0)}%`);
}
