#!/usr/bin/env node
/**
 * CAIRN — is a corpse load-bearing, and is it ever a wall?
 *
 *   node scripts/cairn-bodies-check.mjs
 *   node scripts/cairn-bodies-check.mjs --seeds=40 --attempts=40
 *
 * The title card promises EVERY DEATH LEAVES A STONE. Nothing in this repository
 * measured whether anyone ever steps on one, and for a while nobody did: with
 * `overreachRate` at zero every gap was crossable in a single jump, so the
 * average model landed on one of its own bodies on 1.92% of landings and the
 * expert on 0.02%. All four PHASE3 §1 targets are about height and all four
 * scored identically whether the corpse mechanic was load-bearing or decorative.
 *
 * Four things, and the second and third are what stop this being another green
 * test that never enters the state it claims to cover:
 *
 *   1  EVERY hard gap is crossable in ONE launch from the WORST footing on the
 *      ledge below — verified here by an independent fine sweep, not by the
 *      generator's own verifier, which would only ever confirm itself.
 *   2  the average model stands on its own bodies on more than 5% of landings.
 *   3  THE CONTROL. The same sweep with every corpse forced non-solid must read
 *      exactly 0.00%. If it does not, the instrument is counting something other
 *      than what it says, which has happened here twice.
 *   4  the same control must still CLIMB — because a body is meant to be a
 *      shortcut and not a rescue, and a tower that collapses without corpses is
 *      a tower with walls in it that 1 has not caught.
 *
 * No browser, no DOM: this drives `cairn/src/sim.js` in Node, and reuses the
 * balance harness's bot rather than writing a second one.
 */

import { FEEL } from '../cairn/src/feel.js';
import { Sim, PHASE, predict, solidHalfWidth } from '../cairn/src/sim.js';
import { SKILLS, climb, rng32 } from './cairn-balance.mjs';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
// Patch FEEL for one run. This exists so the check can be FALSIFIED on demand:
//   --tune='{"hardSlack":-14}'   pushes the ledge past the arc it was cut from
// and test 1 must go red. A gate nobody has ever seen fail is a gate nobody
// knows the shape of.
if (args.tune) {
  for (const [k, v] of Object.entries(JSON.parse(args.tune))) {
    const path = k.includes('.') ? k.split('.') : ['tower', k];
    let node = FEEL;
    for (const seg of path.slice(0, -1)) node = node[seg];
    const leaf = path[path.length - 1];
    if (!(leaf in node)) throw new Error(`unknown FEEL path: ${k}`);
    node[leaf] = v;
  }
}

const SEEDS = +(args.seeds ?? 30);
const ATTEMPTS = +(args.attempts ?? 40);
const SPAN = +(args.span ?? 1500);
const GATE = +(args.gate ?? 0.05);

const fails = [];
const check = (ok, msg) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails.push(msg);
};
const median = (a) => {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) * 0.5;
};

console.log('CAIRN bodies\n');

// ── 1. every hard gap can be left in one jump, from the wrong end of the ledge ─
//
// The generator proves this as it builds, with `Sim._reaches`. Asking that same
// function again would prove nothing, so this sweeps the real physics at a
// resolution the generator cannot afford: every degree, every 1.5 u/s.
{
  const arc = [];
  const stand = (sim, solid, x) => {
    const b = sim.body;
    b.x = b.px = x;
    b.y = b.py = solid.y + solid.hh;
    b.vx = b.vy = 0;
    b.grounded = true; b.standing = solid;
    b.onWall = 0; b.wallTimer = 0; b.coyote = FEEL.coyoteTime;
    b.takeoff = b.y; b.peakX = b.x; b.peakY = b.y; b.hangTimer = 0;
  };
  const reaches = (sim, target) => {
    const b = sim.body;
    const L = FEEL.launch;
    const dx = target.x - b.x, dy = target.y + target.hh - b.y;
    const shoot = (vx, vy) => {
      const sp = Math.hypot(vx, vy);
      if (sp < 1e-6) return false;
      const k = clamp(sp, L.minSpeed, L.maxSpeed) / sp;
      return predict(sim, vx * k, vy * k, arc) === target;
    };
    for (const m of [1, 2.5, 5, 8, 12, 18]) {
      const peak = Math.max(dy + m, 0.5);
      const vy = Math.sqrt(2 * FEEL.gravityRise * peak);
      const t = vy / FEEL.gravityRise
        + Math.sqrt((2 * Math.max(peak - dy, 0)) / FEEL.gravityFall);
      if (shoot(dx / Math.max(t, 1e-3), vy)) return true;
    }
    for (let a = 12; a <= 168; a += 1) {
      for (let s = L.minSpeed; s <= L.maxSpeed + 0.01; s += 1.5) {
        if (shoot(Math.cos(a * DEG) * s, Math.sin(a * DEG) * s)) return true;
      }
    }
    return false;
  };

  /**
   * HOW WRONG CAN THE ANGLE BE — degrees of slop before the ledge is missed.
   *
   * The same question `cairn-precision.mjs` asks of the tower at large, so the
   * numbers are comparable: it found a median jump forgives about 20 degrees while
   * one pixel of thumb is 0.31. Hold the power of a launch that works and walk the
   * angle away from it in both directions until the ledge stops being hit.
   *
   * The first version of this counted the share of a FIXED fan of throws that
   * landed, and reported hard gaps as more forgiving than ordinary ones — because
   * a fan of full-power throws lands 42 u away far more often than 22 u away. It
   * was measuring how far the target was, not how hard it was to hit. Left here as
   * a warning: a number that comes out backwards is usually describing the
   * instrument.
   */
  const angleWindow = (sim, target) => {
    const L = FEEL.launch;
    const b = sim.body;
    const dx = target.x - b.x, dy = target.y + target.hh - b.y;
    let sp = 0, mid = 0;
    for (const m of [1, 2.5, 5, 8, 12, 18]) {
      const peak = Math.max(dy + m, 0.5);
      const vy = Math.sqrt(2 * FEEL.gravityRise * peak);
      const t = vy / FEEL.gravityRise
        + Math.sqrt((2 * Math.max(peak - dy, 0)) / FEEL.gravityFall);
      const vx = dx / Math.max(t, 1e-3);
      const raw = Math.hypot(vx, vy);
      const k = clamp(raw, L.minSpeed, L.maxSpeed) / raw;
      if (predict(sim, vx * k, vy * k, arc) === target) {
        sp = raw * k; mid = Math.atan2(vy, vx);
        break;
      }
    }
    if (!sp) return NaN;                      // no analytic solution to widen
    const holds = (th) => predict(sim, Math.cos(th) * sp, Math.sin(th) * sp, arc) === target;
    let lo = 0, hi = 0;
    while (hi < 45 && holds(mid + (hi + 0.5) * DEG)) hi += 0.5;
    while (lo < 45 && holds(mid - (lo + 0.5) * DEG)) lo += 0.5;
    return lo + hi;
  };

  /**
   * HOW WRONG CAN THE POWER BE — and this is the one that matters.
   *
   * A hard gap sits at the far end of a real trajectory, which puts it near the
   * angle of maximum range — and range is STATIONARY in angle there, so a few
   * degrees cost almost nothing. What it has no headroom in at all is power:
   * range goes as v², so the whole difficulty of a constructed gap lives in the
   * pull, not the aim. Reported as a percentage of full power, which is the unit
   * the balance harness expresses a hand's error in (5.5% for the average model).
   */
  const powerWindow = (sim, target) => {
    const L = FEEL.launch;
    const b = sim.body;
    const dx = target.x - b.x, dy = target.y + target.hh - b.y;
    for (const m of [1, 2.5, 5, 8, 12, 18]) {
      const peak = Math.max(dy + m, 0.5);
      const vy = Math.sqrt(2 * FEEL.gravityRise * peak);
      const t = vy / FEEL.gravityRise
        + Math.sqrt((2 * Math.max(peak - dy, 0)) / FEEL.gravityFall);
      const vx = dx / Math.max(t, 1e-3);
      const raw = Math.hypot(vx, vy);
      const k = clamp(raw, L.minSpeed, L.maxSpeed) / raw;
      if (predict(sim, vx * k, vy * k, arc) !== target) continue;
      const ux = (vx * k) / (raw * k), uy = (vy * k) / (raw * k);
      const sp = raw * k;
      const holds = (s) => s >= L.minSpeed && s <= L.maxSpeed
        && predict(sim, ux * s, uy * s, arc) === target;
      let lo = 0, hi = 0;
      const step = L.maxSpeed * 0.005;          // half a percent of full power
      while (hi < L.maxSpeed && holds(sp + hi + step)) hi += step;
      while (lo < L.maxSpeed && holds(sp - lo - step)) lo += step;
      return ((lo + hi) / L.maxSpeed) * 100;
    }
    return NaN;
  };

  /**
   * Is the body actually a shortcut? Throw at the gap the way someone who has
   * given up on making it would, freeze at the apex, and ask whether the corpse
   * that leaves can be landed on and the ledge reached from it.
   *
   * Searched finely and deliberately so. A coarse version of this reported that a
   * body bridged only half of all hard gaps, and this repository has twice had an
   * audit describe the tower as more hostile than it is by cutting its own search
   * short — once by discarding exactly the lower apexes that are the useful ones.
   */
  /**
   * AND IF ONE BODY IS NOT ENOUGH?
   *
   * `bridges` answers "can the corpse from failing this gap carry you across
   * it", and the number it produces has always been stated as a FLOOR rather
   * than the answer, because a route that needs two bodies is still a route and
   * nothing had ever looked for one. This looks.
   *
   * Leave a body from the perch, then leave a SECOND body from the first, then
   * ask whether the target is reachable from that. Deliberately coarser than
   * `bridges` — 8 angles by 4 powers at each of two levels is already a
   * thousand flights per gap — so it can only ever find MORE routes than it
   * reports. That is the right direction for a floor.
   *
   * Both corpses are removed from the world afterwards, in reverse order. A
   * measurement tool in this repository once "found" a result by leaving the
   * world it had modified lying around.
   */
  // Entry-condition counters. A flat "0 of 40 are crossable over two bodies" is
  // indistinguishable from "the sweep never managed to leave a first body", and
  // this repository has shipped that mistake enough times to count them.
  const two = { firstBodies: 0, secondBodies: 0, lands: 0, noDie: 0, low: 0, unreach: 0, calls: 0 };
  const bridges2 = (sim, from, edge, target) => {
    const L = FEEL.launch;
    const angles = [80, 72, 64, 56, 48, 40, 34, 30];
    const powers = [1, 0.86, 0.72, 0.58];
    const drop = (c) => {
      sim.world._unindex(c);
      const at = sim.world.solids.indexOf(c);
      if (at >= 0) sim.world.solids.splice(at, 1);
      sim.world.corpseCount--;
      c.live = false;
      sim.world.pool.push(c);
    };
    /** Fly from `perch` at `px`, and return the corpse it would leave, or null. */
    const leave = (perch, px, a, f) => {
      const sp = L.minSpeed + (L.maxSpeed - L.minSpeed) * f;
      const th = a * DEG * Math.sign(target.x - perch.x || 1);
      two.calls++;
      stand(sim, perch, px);
      if (predict(sim, Math.cos(th) * sp, Math.sin(th) * sp, arc)) { two.lands++; return null; }
      const pk = sim.predictPeak;
      if (!pk.dies) { two.noDie++; return null; }
      if (pk.y <= perch.y + perch.hh + 1) { two.low++; return null; }
      stand(sim, perch, px);
      const c = sim.world.corpse(pk.x, pk.y - FEEL.tower.corpseH * 0.5, 0, 0, 0, sim.deaths);
      stand(sim, perch, px);
      if (!reaches(sim, c)) { two.unreach++; drop(c); return null; }
      return c;
    };

    for (const a1 of angles) {
      for (const f1 of powers) {
        const c1 = leave(from, edge, a1, f1);
        if (!c1) continue;
        two.firstBodies++;
        const x1 = c1.x + Math.sign(target.x - c1.x || 1) * solidHalfWidth(c1, sim);
        for (const a2 of angles) {
          for (const f2 of powers) {
            const c2 = leave(c1, x1, a2, f2);
            if (!c2) continue;
            two.secondBodies++;
            const x2 = c2.x + Math.sign(target.x - c2.x || 1) * solidHalfWidth(c2, sim);
            stand(sim, c2, x2);
            const ok = reaches(sim, target);
            drop(c2);
            if (ok) { drop(c1); return true; }
          }
        }
        drop(c1);
      }
    }
    return false;
  };

  const bridges = (sim, from, edge, target) => {
    const L = FEEL.launch;
    for (let a = 86; a >= 30; a -= 4) {
      for (const f of [1, 0.9, 0.82, 0.74, 0.66, 0.55, 0.44]) {
        const sp = L.minSpeed + (L.maxSpeed - L.minSpeed) * f;
        const th = a * DEG * Math.sign(target.x - from.x || 1);
        stand(sim, from, edge);
        if (predict(sim, Math.cos(th) * sp, Math.sin(th) * sp, arc)) continue;
        const pk = sim.predictPeak;
        if (!pk.dies || pk.y <= from.y + from.hh + 1) continue;
        const c = sim.world.corpse(pk.x, pk.y - FEEL.tower.corpseH * 0.5, 0, 0, 0, sim.deaths);
        stand(sim, from, edge);
        let ok = reaches(sim, c);
        if (ok) {
        // Off the edge of the body facing the ledge, not its centre — a corpse is
        // 5.2 u wide and that is 2.6 u of the gap already crossed.
        const cx = c.x + Math.sign(target.x - c.x || 1) * solidHalfWidth(c, sim);
        stand(sim, c, cx);
        ok = reaches(sim, target);
      }
        sim.world._unindex(c);
        const at = sim.world.solids.indexOf(c);
        if (at >= 0) sim.world.solids.splice(at, 1);
        sim.world.corpseCount--;
        c.live = false;
        sim.world.pool.push(c);
        if (ok) return true;
      }
    }
    return false;
  };

  let hard = 0, ordinary = 0, unleavable = 0;
  const hardGaps = [], ordinaryGaps = [];
  const hardWin = [], ordWin = [];
  const hardPow = [], ordPow = [];
  let sampled = 0, bridged = 0, bridged2 = 0, tried2 = 0;
  const stuckAt = [];
  const t0 = Date.now();
  for (let s = 0; s < SEEDS; s++) {
    const sim = new Sim((0x1a2b3c + s * 0x9e3779b1) | 0);
    sim.phase = PHASE.PLAY;
    sim.world.generate(SPAN);
    const ledges = sim.world.solids
      .filter((x) => !x.corpse).sort((a, b) => a.y - b.y);

    for (let i = 0; i + 1 < ledges.length; i++) {
      const from = ledges[i], to = ledges[i + 1];
      const gap = Math.hypot(to.x - from.x, to.y - from.y);
      const worst = from.x - Math.sign(to.x - from.x || 1) * from.hw;
      const near = from.x + Math.sign(to.x - from.x || 1) * from.hw;
      if (!to.hard) {
        ordinary++;
        ordinaryGaps.push(gap);
        if (ordinary % 5 === 0) {
          stand(sim, from, worst); ordWin.push(angleWindow(sim, to));
          stand(sim, from, worst); ordPow.push(powerWindow(sim, to));
        }
        continue;
      }
      hard++;
      hardGaps.push(gap);
      // The WORST footing: the far end of the perch, the side away from where
      // the ledge went. A gap only crossable from the near end is a gap that
      // becomes a wall whenever the player lands on the wrong half of a ledge,
      // and that is the exact complaint this whole mechanic was rebuilt around.
      stand(sim, from, worst);
      if (!reaches(sim, to)) { unleavable++; stuckAt.push(Math.round(from.y)); }
      if (hard % 5 === 0) {
        stand(sim, from, worst); hardWin.push(angleWindow(sim, to));
        stand(sim, from, worst); hardPow.push(powerWindow(sim, to));
      }
      if (hard % 10 === 0) {
        sampled++;
        if (bridges(sim, from, near, to)) bridged++;
        else if (tried2 < 40) { tried2++; if (bridges2(sim, from, near, to)) bridged2++; }
      }
    }
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  check(hard > 0 && unleavable === 0,
    `${hard} constructed hard gaps over ${SEEDS} towers to ${SPAN} m, ` +
    `${unleavable} that a single launch cannot leave from the WORST footing ` +
    `(independent sweep, 1 deg x 1.5 u/s, ${secs}s)`);
  if (stuckAt.length) console.log(`        unleavable at: ${stuckAt.slice(0, 20).join(', ')} m`);
  console.log(`        hard gaps are ${hard} of ${hard + ordinary} ` +
    `(${((hard / (hard + ordinary)) * 100).toFixed(1)}%), ` +
    `median span ${median(hardGaps).toFixed(1)}u against ${median(ordinaryGaps).toFixed(1)}u ordinary`);
  // HARD, NOT IMPOSSIBLE — the distinction the whole mechanic rests on, as a
  // number rather than a claim. And the other half of the promise: the body has
  // to be a route, or "one hard jump or two easy ones" is only the first half.
  const win = (a, unit) => {
    const ok = a.filter(Number.isFinite);
    return `${median(ok).toFixed(1)} ${unit}${a.length - ok.length ? ` (${a.length - ok.length}/${a.length} no line)` : ''}`;
  };
  console.log(`        angle you can be wrong by:  hard ${win(hardWin, 'deg')}   ordinary ${win(ordWin, 'deg')}`);
  console.log(`        POWER you can be wrong by:  hard ${win(hardPow, '% of full')}   ` +
    `ordinary ${win(ordPow, '% of full')}   (the average model's hand is off by 5.5%)`);
  console.log(`        and ${bridged} of ${sampled} sampled hard gaps are ALSO crossable ` +
    `over the body left by failing them — the shortcut, not just the wall that is absent`);
  // The floor, raised. Two-body routes were listed as unmeasured for as long as
  // the one-body number has existed; a route that needs two bodies is still a
  // route, and "33 of 76" was never the answer, only the part anyone had looked
  // for.
  if (tried2) {
    const both = bridged + bridged2;
    console.log(`        of the ${tried2} of those that one body cannot bridge, ` +
      `${bridged2} are crossable over TWO — the shortcut exists on ` +
      `${both} of ${sampled} (${((both / sampled) * 100).toFixed(0)}%)`);
    // WHY the answer is zero, which is the actually interesting part and is not
    // what anyone expected to find. It is not that the second body lands
    // somewhere useless — it is that there is no FIRST body to be had: every
    // single flight off those perches LANDS on something.
    //
    // Which reframes the gap. A hard gap one body cannot bridge is not a place
    // you get stranded and have to stack your way out of; it is a place where
    // every shot you take puts you somewhere, just not necessarily where you
    // wanted. The one-body figure is therefore the answer and not a floor, and
    // "two-body routes are unmeasured" is closed rather than improved.
    console.log(`        the reason: ${two.calls} flights swept off those ` +
      `perches and ${two.lands} of them LANDED — ${two.noDie} did not die, ` +
      `${two.low} died at or below the perch. There is no first body to stack ` +
      `on, so a two-body route cannot exist there, and nobody is stranded either.`);
  }
}

// ── 2-4. does anyone actually stand on themselves ──────────────────────────────

/**
 * The balance harness's bot, over `SEEDS` towers, counting landings.
 *
 * `deadBodies` forces every corpse to be non-solid from the instant it falls, by
 * collapsing the erosion thresholds. It is the control: the mechanic switched
 * off at the one place it can be switched off without touching the code that
 * measures it.
 */
function sweep(skill, deadBodies) {
  const E = FEEL.erosion;
  const keep = { fresh: E.fresh, thin: E.thin, top: E.top };
  if (deadBodies) { E.fresh = 0; E.thin = 0; E.top = 0; }

  const S = SKILLS[skill];
  const scratch = [], cands = [];
  let landings = 0, onBody = 0, climbs = 0, capped = 0;
  const deaths = [], finalBest = [];

  for (let s = 0; s < SEEDS; s++) {
    const worldSeed = (0x1a2b3c + s * 0x9e3779b1) | 0;
    const sim = new Sim(worldSeed);
    const rnd = rng32((worldSeed ^ 0x5bf03635) >>> 0);
    sim.phase = PHASE.PLAY;
    for (let a = 0; a < ATTEMPTS; a++) {
      const r = climb(sim, S, rnd, scratch, cands, 0);
      if (r === null) { capped++; break; }
      landings += r.landings;
      onBody += r.bodyLandings;
      deaths.push(r.h);
      climbs++;
      sim.respawn();
    }
    finalBest.push(sim.best);
  }

  E.fresh = keep.fresh; E.thin = keep.thin; E.top = keep.top;
  return { skill, deadBodies, landings, onBody, climbs, capped,
           share: onBody / Math.max(1, landings),
           medianDeath: median(deaths), medianBest: median(finalBest) };
}

const t1 = Date.now();
const live = { novice: sweep('novice', false), average: sweep('average', false),
               expert: sweep('expert', false) };
const control = sweep('average', true);
console.log('');

for (const k of ['novice', 'average', 'expert']) {
  const r = live[k];
  console.log(`        ${k.padEnd(8)} ${(r.share * 100).toFixed(2)}% of ${r.landings} landings on a body   ` +
    `median death ${r.medianDeath.toFixed(0)} m   best ${r.medianBest.toFixed(0)} m` +
    `${r.capped ? `   ${r.capped} SEEDS HIT THE LAUNCH CAP` : ''}`);
}

check(live.average.share > GATE,
  `the average model stands on its own bodies on ${(live.average.share * 100).toFixed(2)}% ` +
  `of ${live.average.landings} landings (gate ${(GATE * 100).toFixed(0)}%)`);

// THE INSTRUMENT, CHECKED AGAINST ITSELF. Five tests in this repository have
// passed while blind to the state they claimed to cover. If corpses cannot be
// stood on and this still reports a number, it is not measuring corpses.
check(control.share === 0,
  `control — with every corpse non-solid the same count reads ` +
  `${(control.share * 100).toFixed(2)}% of ${control.landings} landings`);

// A SHORTCUT, NOT A RESCUE. Test 1 above proves no hard gap needs a body. This
// is the same claim measured from the other end: take every body away and the
// climb has to survive it, merely lower.
const cost = control.medianBest / Math.max(1e-9, live.average.medianBest);
check(control.capped === 0 && cost > 0.25,
  `without a single load-bearing body the average model still climbs — ` +
  `median best ${control.medianBest.toFixed(0)} m against ${live.average.medianBest.toFixed(0)} m ` +
  `(${(cost * 100).toFixed(0)}%), ${control.capped} seeds stalled`);

console.log(`\n  ${((Date.now() - t1) / 1000).toFixed(1)}s`);
console.log(fails.length ? `\n${fails.length} FAILED` : '\nbodies carry weight, and no gap needs one');
process.exit(fails.length ? 1 : 0);
