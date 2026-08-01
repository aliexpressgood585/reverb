#!/usr/bin/env node
/**
 * CAIRN — do the four biome verbs happen, and does any of them build a wall?
 *
 *   node scripts/cairn-verbs-check.mjs
 *   node scripts/cairn-verbs-check.mjs --seeds=24 --span=2400
 *
 * A real player climbed to 11,045 m and said the design between the stages
 * repeats itself. He was right, and the reason was structural: six biomes were
 * six colour schemes over one identical verb — jump the gap. PHASE3 §7 asks for
 * one verb per biome, and this is the gate on them.
 *
 *   ASH     the hold gives way once you stand on it
 *   SIGNAL  a column of rising air, reach for free if you are inside it
 *   BLOOM   the ledge will not hold still
 *   VOID    you see what your own light reaches — renderer only, not here
 *
 * The thing that has gone wrong in this repository over and over is a test that
 * passes without ever entering the state it claims to cover. So three of these
 * five are written against that specific failure:
 *
 *   1  each verb OCCURS, only in its own biome, never on the on-ramp and never
 *      on a gap that was cut out of a flight.
 *   2  the updraft actually changes a flight — AND is invisible to the
 *      generator's probe, which is the whole reason it cannot create a wall.
 *      Both halves are asserted; either one alone is satisfiable by dead code.
 *   3  THE GATE. Every gap is still crossable in one launch from the WORST
 *      footing, with the updraft's help switched off and the drifting ledges
 *      sampled across their entire cycle — including the phase that is furthest
 *      from where the generator proved them.
 *   4  the crumble clock fires in PLAY, not merely in the generator.
 *   5  the same seed builds the same verbs, bit for bit.
 *
 * Falsify it on demand — a gate nobody has seen fail is a gate nobody knows the
 * shape of:
 *
 *   --tune='{"verbs.crumbleRate":0}'   turns 1 red  (a verb that never happens)
 *   --tune='{"verbs.driftAmp":26}'     turns 3 red  (a ledge out of reach)
 *   --tune='{"verbs.updraftAccel":0}'  turns 2 red  (an updraft that does nothing)
 *
 * Paths must be written in full, because `cairn-balance.mjs` reads the same flag
 * on import and defaults a bare key to `tower`.
 *
 * No browser, no DOM: this drives `cairn/src/sim.js` in Node.
 */

import { FEEL, BIOME_SPAN, BIOMES } from '../cairn/src/feel.js';
import { Sim, PHASE, predict } from '../cairn/src/sim.js';
import { SKILLS, climb, rng32 } from './cairn-balance.mjs';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
if (args.tune) {
  for (const [k, v] of Object.entries(JSON.parse(args.tune))) {
    const path = k.includes('.') ? k.split('.') : ['verbs', k];
    let node = FEEL;
    for (const seg of path.slice(0, -1)) node = node[seg];
    const leaf = path[path.length - 1];
    if (!(leaf in node)) throw new Error(`unknown FEEL path: ${k}`);
    node[leaf] = v;
  }
}

const SEEDS = +(args.seeds ?? 20);
const SPAN = +(args.span ?? 1800);
const V = FEEL.verbs;

const fails = [];
const check = (ok, msg) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails.push(msg);
};

/** Which biome a height sits in, by the same arithmetic the generator uses. */
const biomeOf = (y) => Math.floor(y / BIOME_SPAN) % BIOMES.length;
const NAME = BIOMES.map((b) => b.name);

console.log('CAIRN verbs\n');

// ── the towers, built once and reused by every test below ────────────────────
const towers = [];
for (let s = 0; s < SEEDS; s++) {
  const sim = new Sim((0x51a7c3 + s * 0x9e3779b1) | 0);
  sim.phase = PHASE.PLAY;
  sim.world.generate(SPAN);
  towers.push(sim);
}

// ── 1. each verb happens, and only where it is allowed to ───────────────────
{
  const count = { crumble: 0, updraft: 0, drift: 0 };
  /** verb occurrences outside their own biome, keyed by verb */
  const wrongBiome = { crumble: 0, updraft: 0, drift: 0 };
  let onRamp = 0, onHard = 0, ledges = 0;
  const perBiome = BIOMES.map(() => 0);

  for (const sim of towers) {
    for (const s of sim.world.solids) {
      if (s.corpse) continue;
      ledges++;
      const b = biomeOf(s.y);
      const verbs = [];
      if (s.crumble) verbs.push('crumble');
      if (s.updraft) verbs.push('updraft');
      if (s.drift > 0) verbs.push('drift');
      if (!verbs.length) continue;
      perBiome[b] += verbs.length;
      for (const v of verbs) {
        count[v]++;
        const want = v === 'crumble' ? 0 : v === 'updraft' ? 1 : 2;
        if (b !== want) wrongBiome[v]++;
        if (s.y < FEEL.tower.openingSpan) onRamp++;
        if (s.hard) onHard++;
      }
    }
  }

  const each = count.crumble > 0 && count.updraft > 0 && count.drift > 0;
  check(each, `all three placed verbs occur over ${SEEDS} towers to ${SPAN} m — ` +
    `crumble ${count.crumble}, updraft ${count.updraft}, drift ${count.drift} ` +
    `(of ${ledges} ledges)`);
  const stray = wrongBiome.crumble + wrongBiome.updraft + wrongBiome.drift;
  check(stray === 0, `${stray} verbs outside their own biome — ` +
    `a verb learned in isolation is a verb that can be learned at all`);
  check(onRamp === 0, `${onRamp} verbs inside the ${FEEL.tower.openingSpan} m on-ramp`);
  check(onHard === 0, `${onHard} verbs on a gap CUT OUT OF A FLIGHT — its whole ` +
    `guarantee is that one launch lands on one surface, and a surface that ` +
    `crumbles or drifts is not that surface`);
  console.log('        verbs per biome: ' +
    perBiome.map((n, i) => `${NAME[i]} ${n}`).join('  '));
  console.log('        VOID\'s verb is darkness and lives entirely in the renderer; ' +
    'CINDER and GLACIER carry none by design');
}

// ── 2. the updraft lifts the player, and does not lift the generator ────────
//
// Two assertions, and neither is optional. Only the first would pass on an
// updraft that also helped the probe — which would mean the generator had cut
// its gaps against a lift that a future tuning pass could take away, stranding
// every tower already on a phone. Only the second would pass on an updraft that
// does nothing at all, which is the dead-code case this repository has shipped
// before.
{
  let sampled = 0, lifted = 0, probeDrift = 0;
  const arc = [];
  const lift = V.updraftAccel;

  for (const sim of towers) {
    for (const s of sim.world.solids) {
      if (!s.updraft) continue;
      sampled++;
      const b = sim.body;
      const put = () => {
        b.x = b.px = s.x; b.y = b.py = s.y + s.hh;
        b.vx = b.vy = 0; b.grounded = true; b.standing = s;
        b.onWall = 0; b.wallTimer = 0; b.coyote = FEEL.coyoteTime;
        b.takeoff = b.y; b.peakX = b.x; b.peakY = b.y; b.hangTimer = 0;
      };
      // Straight up the middle of the column, at half power so the apex is well
      // inside `updraftH` and the difference is the lift rather than the ceiling.
      const sp = (FEEL.launch.minSpeed + FEEL.launch.maxSpeed) * 0.5;
      // The apex is read off the DRAWN ARC, not off `predictPeak` — that field
      // is only written when a launch dies, so a launch that lands leaves the
      // previous run's value sitting there and the comparison silently becomes
      // a number against itself. Which is how the first version of this test
      // reported 0 of 46 on a working updraft.
      const apex = () => { let m = -Infinity; for (let k = 1; k < arc.length; k += 2) if (arc[k] > m) m = arc[k]; return m; };

      put();
      predict(sim, 0.001, sp, arc);
      const withLift = apex();
      const probeWith = sim._probeFlight(b.x, b.y, 0.001, sp, s);

      V.updraftAccel = 0;
      put();
      predict(sim, 0.001, sp, arc);
      const without = apex();
      const probeWithout = sim._probeFlight(b.x, b.y, 0.001, sp, s);
      V.updraftAccel = lift;

      if (withLift > without + 0.5) lifted++;
      if (probeWith !== probeWithout) probeDrift++;
    }
  }
  check(sampled > 0 && lifted === sampled,
    `${lifted} of ${sampled} updrafts lift a real launch higher than the same ` +
    `launch without one`);
  check(probeDrift === 0,
    `${probeDrift} of ${sampled} updrafts change where the GENERATOR'S PROBE ` +
    `lands — every route this world promises is proved without help, so a ` +
    `column can only ever widen what was already crossable`);
}

// ── 3. THE GATE: no verb turns a crossable gap into a wall ──────────────────
//
// The audit runs with the updraft's help switched off, because the generator
// proved its gaps that way and an audit that accepts help is an audit that can
// miss the wall. Drifting ledges are swept across their whole cycle, so the
// phase furthest from where the route was proved is the phase that gets tested.
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
    // The analytic lines first — they resolve almost everything in six tries.
    for (const m of [1, 2.5, 5, 8, 12, 18]) {
      const peak = Math.max(dy + m, 0.5);
      const vy = Math.sqrt(2 * FEEL.gravityRise * peak);
      const t = vy / FEEL.gravityRise
        + Math.sqrt((2 * Math.max(peak - dy, 0)) / FEEL.gravityFall);
      if (shoot(dx / Math.max(t, 1e-3), vy)) return true;
    }
    for (let a = 12; a <= 168; a += 2) {
      for (let s = L.minSpeed; s <= L.maxSpeed + 0.01; s += 2) {
        if (shoot(Math.cos(a * DEG) * s, Math.sin(a * DEG) * s)) return true;
      }
    }
    return false;
  };

  const PHASES = 12;                    // one full drift cycle, sampled evenly
  const cycle = 1 / V.driftHz;
  const lift = V.updraftAccel;
  V.updraftAccel = 0;

  let checked = 0, drifting = 0, walls = 0, worstPhaseWalls = 0;
  const stuckAt = [];
  const t0 = Date.now();

  for (const sim of towers) {
    const ledges = sim.world.solids.filter((x) => !x.corpse).sort((a, b) => a.y - b.y);
    for (let i = 0; i + 1 < ledges.length; i++) {
      const from = ledges[i], to = ledges[i + 1];
      // Only the gaps a verb touches. The rest of the tower is already the
      // subject of cairn-reach-check.mjs, and repeating it here would double a
      // two-minute run to say nothing new.
      if (!(from.crumble || from.updraft || from.drift > 0
            || to.crumble || to.updraft || to.drift > 0)) continue;
      checked++;
      const dir = Math.sign(to.x - from.x || 1);

      if (from.drift > 0 || to.drift > 0) {
        drifting++;
        let bad = 0;
        for (let p = 0; p < PHASES; p++) {
          sim.verbTime = (p / PHASES) * cycle;
          // Through the sim's own stepper, so the position audited here and the
          // position the player lands on come from one source.
          sim._stepVerbs();
          stand(sim, from, from.x - dir * from.hw);
          if (!reaches(sim, to)) bad++;
        }
        if (bad > 0) { worstPhaseWalls++; stuckAt.push(`${Math.round(to.y)}m@${bad}/${PHASES}`); }
        sim.verbTime = 0;
        sim._stepVerbs();
      } else {
        stand(sim, from, from.x - dir * from.hw);
        if (!reaches(sim, to)) { walls++; stuckAt.push(`${Math.round(to.y)}m`); }
      }
    }
  }
  V.updraftAccel = lift;
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  check(checked > 0 && walls === 0 && worstPhaseWalls === 0,
    `${checked} gaps touched by a verb, ${drifting} of them across a drifting ` +
    `ledge sampled at ${PHASES} phases of its cycle — ` +
    `${walls + worstPhaseWalls} that one launch cannot cross from the WORST ` +
    `footing, with the updraft's help off (${secs}s)`);
  if (stuckAt.length) console.log(`        walls at: ${stuckAt.slice(0, 20).join(', ')}`);
  console.log(`        drift is ${V.driftAmp} u either side, which is WIDER than the ` +
    `${FEEL.landing.forgiveness} u of landing forgiveness — what holds is the 30% of ` +
    `the reach envelope every ordinary gap sits inside. The first wall appears ` +
    `between 12 and 16 u.`);
}

// ── 4. the crumble clock fires in PLAY ──────────────────────────────────────
//
// Everything above this line reads the generator. This one plays the game: the
// difficulty-collapse test in cairn-check.mjs once measured nothing at all for
// exactly this reason, so the mechanic has to be caught happening rather than
// caught existing.
{
  const scratch = [], cands = [];
  /** @param {string} model */
  const play = (model) => {
    let crumbled = 0, height = 0, attempts = 0;
    for (let s = 0; s < Math.min(SEEDS, 12); s++) {
      const worldSeed = (0x51a7c3 + s * 0x9e3779b1) | 0;
      const sim = new Sim(worldSeed);
      const rnd = rng32((worldSeed ^ 0x5bf03635) >>> 0);
      sim.phase = PHASE.PLAY;
      for (let a = 0; a < 30; a++) {
        const r = climb(sim, SKILLS[model], rnd, scratch, cands, false);
        if (r === null) break;
        attempts++;
        height = Math.max(height, r.h);
      }
      crumbled += sim.crumbled;
    }
    return { crumbled, height, attempts };
  };

  // The gate is run against the EXPERT, because the crumbling hold now waits
  // for the second ASH lap at 900 m and the average model tops out near there —
  // a gate that only just reaches the state it tests is a gate that goes red on
  // noise rather than on code.
  const x = play('expert');
  check(x.crumbled > 0,
    `${x.crumbled} holds gave way under an expert bot over ${x.attempts} attempts ` +
    `(best ${x.height.toFixed(0)} m) — the clock starts on a landing, so a zero ` +
    `here means nobody ever stood on one`);
  // And the honest number underneath it: the average player mostly never meets
  // this verb, because it lives above where they die. Reported, not hidden.
  const a = play('average');
  console.log(`        the average model met it ${a.crumbled} times over ` +
    `${a.attempts} attempts (best ${a.height.toFixed(0)} m) — this verb lives ` +
    `above where an ordinary run ends`);
}

// ── 5. the same seed builds the same verbs ─────────────────────────────────
{
  let diff = 0, compared = 0;
  for (let s = 0; s < 6; s++) {
    const seed = (0x51a7c3 + s * 0x9e3779b1) | 0;
    const a = new Sim(seed), b = new Sim(seed);
    a.phase = b.phase = PHASE.PLAY;
    a.world.generate(SPAN); b.world.generate(SPAN);
    const A = a.world.solids.filter((x) => !x.corpse);
    const B = b.world.solids.filter((x) => !x.corpse);
    if (A.length !== B.length) { diff++; continue; }
    for (let i = 0; i < A.length; i++) {
      compared++;
      if (A[i].crumble !== B[i].crumble || A[i].updraft !== B[i].updraft
          || A[i].drift !== B[i].drift || A[i].driftPhase !== B[i].driftPhase) diff++;
    }
  }
  check(diff === 0, `${compared} ledges compared across 6 seeds built twice, ` +
    `${diff} whose verbs differ — both rolls are drawn unconditionally, so the ` +
    `random stream does not depend on which biome a ledge landed in`);
}

// ── 6. the order you meet them in ──────────────────────────────────────────
//
// PHASE3 §7 asks that verbs arrive one at a time. The biome layout gives that
// for free — six biomes of 150 m and one verb each — but it also decides the
// ORDER, and nobody chose it deliberately. So it is measured: the verb that
// GIVES you something has to be met before the verb that takes the floor away.
// ASH is biome 0, which sits at 0-150 m where difficulty is still under
// `verbs.from`, so the crumbling hold defers to the second lap at 900 m while
// the updraft arrives on the first at 150. That is the right lesson plan and it
// happened by accident, which is exactly why it needs a gate under it.
{
  const first = (led, k) => {
    const f = led.find((x) => (k === 'drift' ? x.drift > 0 : x[k]));
    return f ? f.y : Infinity;
  };
  const heights = { crumble: [], updraft: [], drift: [] };
  let inverted = 0, seeds = 0;
  for (const sim of towers) {
    const led = sim.world.solids.filter((x) => !x.corpse).sort((a, b) => a.y - b.y);
    const c = first(led, 'crumble'), u = first(led, 'updraft'), d = first(led, 'drift');
    if (!Number.isFinite(c) || !Number.isFinite(u)) continue;
    seeds++;
    heights.crumble.push(c); heights.updraft.push(u); heights.drift.push(d);
    if (c < u) inverted++;
  }
  check(seeds > 0 && inverted === 0,
    `${inverted} of ${seeds} towers introduce the hold that GIVES WAY before the ` +
    `column that GIVES REACH`);
  const med = (a) => {
    const s = a.filter(Number.isFinite).sort((x, y) => x - y);
    return s.length ? s[s.length >> 1].toFixed(0) : 'never';
  };
  console.log(`        median first sighting — updraft ${med(heights.updraft)} m, ` +
    `drift ${med(heights.drift)} m, crumble ${med(heights.crumble)} m`);
}

// ── 7. THE ARC DOES NOT LIE ABOUT A LEDGE THAT MOVES ───────────────────────
//
// This one found a real bug, and it is the third time this repository has been
// bitten by the same shape (DECISIONS.md §4, §19, §26): the drawn arc and the
// flight it draws disagreeing through a brand-new hole.
//
// `predict` runs `_flight` many times inside one aiming frame, and `_stepVerbs`
// runs once per TICK — so the preview froze the tower at the instant the thumb
// went down while the real flight moved a BLOOM ledge underneath it for a
// second and a half. Measured at the time: **the arc lied on 71.8% of drifting
// ledges.** Acceptance test 2 asserts arc-matches-flight and passed throughout,
// because all 94 of its launches leave from the ground onto ledges that do not
// move.
//
// The fix was `Sim.driftXAt` plus a clock on every body, so a query about a
// drifting ledge is always a query about a TIME. This is the gate on it.
{
  const arc = [];
  const L = FEEL.launch;
  const cycle = 1 / V.driftHz;
  let tested = 0, lied = 0, moved = 0, worstMove = 0;

  for (const sim of towers) {
    const led = sim.world.solids.filter((x) => !x.corpse).sort((a, b) => a.y - b.y);
    for (let i = 0; i + 1 < led.length; i++) {
      const from = led[i], to = led[i + 1];
      if (!(to.drift > 0)) continue;
      for (let p = 0; p < 4; p++) {
        sim.verbTime = (p / 4) * cycle;
        sim._stepVerbs();
        const b = sim.body;
        const put = () => {
          b.x = b.px = from.x; b.y = b.py = from.y + from.hh;
          b.vx = b.vy = 0; b.grounded = true; b.standing = from;
          b.onWall = 0; b.wallTimer = 0; b.coyote = FEEL.coyoteTime;
          b.takeoff = b.y; b.peakX = b.x; b.peakY = b.y;
          b.hangTimer = 0; b.airTime = 0; b.t = sim.verbTime;
        };
        // Any launch the PREVIEW claims lands on the drifting ledge.
        let shot = null;
        outer: for (let a = 15; a <= 165; a += 3) {
          for (let sp = L.minSpeed; sp <= L.maxSpeed; sp += 2) {
            put();
            const vx = Math.cos(a * DEG) * sp, vy = Math.sin(a * DEG) * sp;
            if (predict(sim, vx, vy, arc) === to) { shot = [vx, vy]; break outer; }
          }
        }
        if (!shot) continue;
        tested++;
        const xAtLaunch = to.x;

        // Now fly it for real, through `tick`, which moves the tower.
        put();
        const v = sim.launchVelocity(b, shot[0], shot[1], sim._lv);
        b.vx = v.vx; b.vy = v.vy;
        b.grounded = false; b.standing = null; b.takeoff = b.y;
        let landed = null;
        for (let k = 0; k < 400; k++) {
          sim.tick(0);
          if (b.grounded) { landed = b.standing; break; }
          if (sim.phase !== PHASE.PLAY) break;
        }
        if (landed !== to) lied++;
        // THE GUARD AGAINST A VACUOUS PASS. If the ledge never actually moved
        // between the launch and the landing, this test proves nothing at all —
        // which is the exact failure mode of the old difficulty-collapse test.
        const shift = Math.abs(to.x - xAtLaunch);
        if (shift > 1) moved++;
        if (shift > worstMove) worstMove = shift;
      }
      sim.verbTime = 0;
      sim._stepVerbs();
    }
  }
  check(tested > 0 && lied === 0,
    `${tested} launches the AIM ARC says land on a drifting ledge, ${lied} that ` +
    `the real flight does not — it was 71.8% before bodies got a clock`);
  check(moved > 0,
    `the ledge moved more than 1 u during ${moved} of those ${tested} flights ` +
    `(worst ${worstMove.toFixed(1)} u) — without motion this test proves nothing`);
}

console.log();
if (fails.length) {
  console.log(`  ${fails.length} FAILED`);
  for (const f of fails) console.log(`    ${f}`);
} else {
  console.log('  the four verbs are real, contained, and none of them is a wall');
}
process.exit(fails.length ? 1 : 0);
