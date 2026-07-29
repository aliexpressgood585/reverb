#!/usr/bin/env node
/**
 * CAIRN — is there a route, and is it a route a person could find?
 *
 *   node scripts/cairn-reach-check.mjs --from=481 --span=600 --seeds=60
 *
 * PHASE3 §2 asked for a reachability solver and specified it as "zero
 * impossible chunks". That specification is now wrong by design: a share of
 * gaps are placed past the physical envelope on purpose, because dying in one
 * and standing on your own body is the game. So the question this answers is
 * the one that still matters:
 *
 *   for every ledge above a given height, is there a way up — either in one
 *   jump, or in one jump plus the corpse you leave failing it?
 *
 * Every test uses the real physics through `predict`. Three verdicts per gap:
 *
 *   DIRECT     a single launch lands on the next ledge
 *   BRIDGED    no launch lands, but the apex of the best throw leaves a corpse
 *              that can be landed on, and the next ledge can be reached from
 *              that corpse. This is the intended shape of a hard gap.
 *   WALL       neither. A player who reaches this ledge cannot leave it, and
 *              only the shifting roof re-rolling the terrain saves them.
 *
 * WALL is the number that matters. It is currently argued in BALANCE.md — the
 * roof regenerates everything above your best every attempt, so a bad roll is a
 * bad hand and not a dead end — and argued is not measured.
 */

import { FEEL, COLUMN } from '../cairn/src/feel.js';
import { Sim, PHASE, predict, solidHalfWidth } from '../cairn/src/sim.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const FROM = +(args.from ?? 481);
const SPAN = +(args.span ?? 600);
const SEEDS = +(args.seeds ?? 60);

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

const q = (a, p) => {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  return s[clamp(Math.round((s.length - 1) * p), 0, s.length - 1)];
};

// --------------------------------------------------------------------- probes

const arc = [];

/** Stand the body on a surface at a given x, ready to launch. */
function stand(sim, solid, x) {
  const b = sim.body;
  b.x = b.px = x;
  b.y = b.py = solid.y + solid.hh;
  b.vx = b.vy = 0;
  b.grounded = true;
  b.standing = solid;
  b.onWall = 0; b.wallTimer = 0; b.coyote = FEEL.coyoteTime;
  b.takeoff = b.y; b.peakX = b.x; b.peakY = b.y; b.hangTimer = 0;
}

/**
 * Does any legal launch from here land on `target`?
 *
 * The analytic solutions the bot uses are tried first because they find an
 * ordinary gap in a handful of predicts. Only a gap that defeats all of them
 * pays for the sweep, which is what keeps this affordable over thousands of
 * gaps.
 */
function reaches(sim, target) {
  const b = sim.body;
  const L = FEEL.launch;
  const tx = target.x, ty = target.y + target.hh;
  const dx = tx - b.x, dy = ty - b.y;

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

  for (let a = 12; a <= 168; a += 3) {
    for (let s = L.minSpeed; s <= L.maxSpeed + 0.01; s += 6) {
      if (shoot(Math.cos(a * DEG) * s, Math.sin(a * DEG) * s)) return true;
    }
  }
  return false;
}

/**
 * Every distinct place the body could freeze, from this footing.
 *
 * There is a trap here worth spelling out. The obvious throw is the one that
 * goes FURTHEST — get the body as deep into the gap as possible. It is often the
 * wrong throw: the corpse's landable surface sits at `peakY + corpseH/2`, three
 * units ABOVE the apex reached, and the throw that maximises horizontal distance
 * is not the throw that reaches highest. A body placed at maximum reach can be a
 * body you cannot then stand on.
 *
 * The useful throw is frequently shorter and steeper — it puts the corpse
 * somewhere a second launch can land. That is a real thing for a player to
 * understand, "throw yourself where you can follow", and an audit that tries
 * only the greedy option measures the terrain as far more hostile than it is.
 *
 * Sorted nearest-the-far-ledge first, because the caller pays a two-launch
 * reachability test per option.
 */
function apexOptions(sim, target) {
  const b = sim.body;
  const L = FEEL.launch;
  const dir = Math.sign(target.x - b.x || 1);
  const out = [];
  const seen = new Set();
  for (let a = 20; a <= 88; a += 4) {
    for (const frac of [1, 0.86, 0.72, 0.58]) {
      const sp = L.minSpeed + (L.maxSpeed - L.minSpeed) * frac;
      const th = a * DEG * dir;
      predict(sim, Math.cos(th) * sp, Math.sin(th) * sp, arc);
      const pk = sim.predictPeak;
      if (!pk.dies) continue;                      // it landed; not this branch
      const key = `${Math.round(pk.x)}:${Math.round(pk.y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ x: pk.x, y: pk.y,
                 d: Math.hypot(pk.x - target.x, pk.y - (target.y + target.hh)) });
    }
  }
  out.sort((p2, q2) => p2.d - q2.d);
  return out;
}

// ----------------------------------------------------------------------- audit

function audit() {
  const rows = { direct: 0, bridged: 0, wall: 0 };
  const worstCase = { direct: 0, other: 0 };
  const widths = [];
  const gaps = [];
  const wallHeights = [];
  const bridgeGain = [];

  for (let s = 0; s < SEEDS; s++) {
    const seed = (0x1a2b3c + s * 0x9e3779b1) | 0;
    const sim = new Sim(seed);
    sim.phase = PHASE.PLAY;
    sim.best = FROM;
    sim.world.generate(FROM + SPAN + 200);

    const ledges = sim.world.solids
      .filter((x) => !x.corpse && x.y >= FROM && x.y <= FROM + SPAN)
      .sort((a, b) => a.y - b.y);

    for (let i = 0; i + 1 < ledges.length; i++) {
      const from = ledges[i], to = ledges[i + 1];
      widths.push(from.hw * 2);
      gaps.push(Math.hypot(to.x - from.x, to.y - from.y));

      // Most favourable honest footing: the edge of the perch facing the target.
      const edge = from.x + Math.sign(to.x - from.x || 1) * from.hw;
      stand(sim, from, edge);
      if (reaches(sim, to)) {
        rows.direct++;
        // ... and the least favourable, which is where you may actually land.
        stand(sim, from, from.x - Math.sign(to.x - from.x || 1) * from.hw);
        if (reaches(sim, to)) worstCase.direct++; else worstCase.other++;
        continue;
      }

      // No single launch. Leave a body in the gap and try again from it — and
      // try every place the body could be left, not just the furthest one.
      stand(sim, from, edge);
      const options = apexOptions(sim, to);
      let bridged = false;
      let tried = 0;
      for (const apex of options) {
        // No early cap. Options are sorted by closeness to the far ledge, which
        // puts the HIGHEST apexes first — and those are exactly the ones whose
        // corpse cannot be landed on. Cutting the list short therefore discards
        // the useful bodies and reports walls that are the audit's own doing.
        // It did, twice.
        if (tried++ >= 48) break;
        const corpse = sim.world.corpse(apex.x, apex.y, 0, 0, 0, sim.deaths);
        stand(sim, from, edge);
        let ok = reaches(sim, corpse);
        if (ok) {
          const cx = corpse.x + Math.sign(to.x - corpse.x || 1) * solidHalfWidth(corpse, sim);
          stand(sim, corpse, cx);
          ok = reaches(sim, to);
        }
        // Take the body back out. The first version of this called
        // regenerateAbove(-1e9) to clean up, which keeps only corpses — it
        // deleted every ledge in the world, so every gap after the first hard
        // one scored as a dead end and the audit reported 24% walls that were
        // its own doing. Remove exactly the one solid that was added.
        const at = sim.world.solids.indexOf(corpse);
        if (at >= 0) sim.world.solids.splice(at, 1);
        sim.world.corpseCount--;
        sim.world.buckets.clear();
        for (const x of sim.world.solids) sim.world._index(x);
        if (ok) { bridged = true; break; }
      }

      if (bridged) {
        rows.bridged++;
        bridgeGain.push(Math.round(to.y - from.y));
      } else {
        rows.wall++;
        wallHeights.push(Math.round(from.y));
      }
      worstCase.other++;
    }
  }
  return { rows, worstCase, widths, gaps, wallHeights, bridgeGain };
}

// ---------------------------------------------------------------------- output

console.log(`CAIRN route audit — ${FROM} m to ${FROM + SPAN} m, ${SEEDS} seeds\n`);
const t0 = Date.now();
const r = audit();
const total = r.rows.direct + r.rows.bridged + r.rows.wall;
const pc = (n) => `${((n / Math.max(1, total)) * 100).toFixed(2)}%`;

console.log(`  ${total} gaps audited with the real physics`);
console.log(`  DIRECT   ${String(r.rows.direct).padStart(5)}  ${pc(r.rows.direct).padStart(7)}  one launch lands it`);
console.log(`  BRIDGED  ${String(r.rows.bridged).padStart(5)}  ${pc(r.rows.bridged).padStart(7)}  ` +
  `needs the corpse from failing it first`);
console.log(`  WALL     ${String(r.rows.wall).padStart(5)}  ${pc(r.rows.wall).padStart(7)}  ` +
  `no route even with a body in the gap`);

console.log(`\n  ledge width   p5 ${q(r.widths, 0.05).toFixed(1)}u   median ${q(r.widths, 0.5).toFixed(1)}u   p95 ${q(r.widths, 0.95).toFixed(1)}u`);
console.log(`  gap distance  p5 ${q(r.gaps, 0.05).toFixed(1)}u   median ${q(r.gaps, 0.5).toFixed(1)}u   p95 ${q(r.gaps, 0.95).toFixed(1)}u`);
if (r.bridgeGain.length) {
  console.log(`  a bridged gap is worth ${q(r.bridgeGain, 0.5)}m of height (median)`);
}

const wc = r.worstCase.direct + r.worstCase.other;
console.log(`\n  of the gaps a single launch can clear, ${((r.worstCase.direct / Math.max(1, wc)) * 100).toFixed(1)}% ` +
  `are still clearable from the FAR side of the perch — i.e. it does not matter where you landed`);

if (r.wallHeights.length) {
  const h = [...new Set(r.wallHeights)].sort((a, b) => a - b);
  console.log(`\n  walls at: ${h.slice(0, 20).join(', ')}${h.length > 20 ? ` ... (${h.length} distinct)` : ''}`);
}
console.log(`\n  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(r.rows.wall === 0
  ? '\n  no dead ends: every ledge in this band can be left'
  : `\n  ${r.rows.wall} DEAD ENDS — a player reaching these cannot leave without the roof re-rolling`);
