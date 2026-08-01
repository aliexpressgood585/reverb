import { FEEL, COLUMN, BIOME_SPAN } from './feel.js';

/** @typedef {import('./types.js').Solid} Solid */
/** @typedef {import('./types.js').Body} Body */
/** @typedef {import('./types.js').Launch} Launch */

/**
 * The simulation. No DOM, no canvas, no audio — this file could run in a
 * worker or in Node, and the headless acceptance harness drives exactly this
 * code rather than a reimplementation of it.
 *
 * The one rule, which everything else exists to serve:
 *
 *   MISS A JUMP AND YOU FREEZE AT THE HIGHEST POINT YOU REACHED, AND WHAT IS
 *   LEFT BEHIND IS SOLID.
 *
 * Determinism is a hard requirement, not an aspiration. Every tick is exactly
 * FEEL.sim.dt seconds; the accumulator lives in the caller. Two identical
 * launches from an identical world state produce bit-identical landings, and
 * the harness asserts it.
 */

const { dt: DT } = FEEL.sim;
/** @type {(v: number, a: number, b: number) => number} */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * EROSION — the fix for the design flaw that killed the loop.
 *
 * Corpses used to be permanently solid. Thirty attempts in, the first 150 m is
 * a staircase; sixty in, the exact band where you keep dying is trivial. The
 * difficulty curve INVERTS — the game gets easier precisely where it should get
 * harder — and the run stops meaning anything inside one session.
 *
 * Solidity decays. Presence does not. A corpse is measured in how many deaths
 * have happened since it fell:
 *
 *   FRESH  0-6    full platform, full glow
 *   THIN   7-14   45% width. A precise ledge, visibly cracked.
 *   TOP    15-24  landable from above, but no longer a wall to cling to. Dim.
 *   MEMORY 25+    no collision at all. Still drawn, faint and gold, forever.
 *
 * So the visible tower still holds every self you have ever left. The PLAYABLE
 * tower is only the recent ones. The screenshot promise survives intact and the
 * challenge comes back.
 */
export const EROSION = { FRESH: 0, THIN: 1, TOP: 2, MEMORY: 3 };

/**
 * Which stage a corpse has decayed to.
 *
 * Takes the SIM, not a copied `deaths`. Erosion is a function of world state,
 * and every caller that hand-carried one field was a caller that could quietly
 * carry a different one than the renderer did — the exact shape of bug this
 * file's one-integrator rule exists to prevent. A missing argument now throws
 * instead of silently ageing a corpse differently in the physics than on screen.
 */
/**
 * @param {Solid} solid
 * @param {Sim} sim
 * @returns {number} one of EROSION
 */
export function erosionOf(solid, sim) {
  if (!solid.corpse) return EROSION.FRESH;
  const E = FEEL.erosion;
  let age = sim.deaths - (solid.bornDeath ?? 0);
  if (E.deepScale !== 1) {
    const t = clamp(Math.max(0, sim.best - solid.y) / E.deepSpan, 0, 1);
    age *= 1 + (E.deepScale - 1) * t;
  }
  if (age < E.fresh) return EROSION.FRESH;
  if (age < E.thin) return EROSION.THIN;
  if (age < E.top) return EROSION.TOP;
  return EROSION.MEMORY;
}

/** Half-width a corpse still offers as a landing, given its stage. */
/**
 * @param {Solid} solid
 * @param {Sim} sim
 * @returns {number}
 */
export function solidHalfWidth(solid, sim) {
  if (!solid.corpse) return solid.hw;
  const st = erosionOf(solid, sim);
  if (st === EROSION.MEMORY) return 0;
  return st === EROSION.FRESH ? solid.hw : solid.hw * 0.45;
}

// --------------------------------------------------------------------- rng

/** xorshift32. A seed is a tower, on every device and every run. */
/**
 * @param {number} seed
 * @returns {() => number} uniform in [0,1)
 */
export function makeRng(seed) {
  let s = (seed | 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 1000000) / 1000000;
  };
}

// ------------------------------------------------------------------ solids

/**
 * A solid is an axis-aligned slab you can stand on and, if it is a corpse, can
 * also cling to the sides of. Pooled: the array only ever grows.
 */
/** @returns {Solid} */
function newSolid() {
  return {
    x: 0, y: 0, hw: 0, hh: 0,
    corpse: false, live: false,
    // Was this ledge cut out of a flight rather than placed by the curve? Only
    // an audit reads it, and an audit that has to guess which gaps are the hard
    // ones is an audit that cannot prove they are all crossable.
    hard: false,
    // THE BIOME VERBS. `crumble` is the ASH hold that gives way once stood on;
    // `drift` is the BLOOM ledge that will not hold still; `updraft` is the
    // SIGNAL column of rising air standing on top of this ledge. `baseX` is
    // where a drifting ledge was PLACED, which is the position the generator
    // verified and the position every route proof is about — `x` is where it
    // is now.
    crumble: false,
    crumbleAt: 0,          // sim time it goes, or 0 while nobody has touched it
    drift: 0,              // amplitude in units, 0 for a ledge that stays put
    driftPhase: 0,
    updraft: false,
    baseX: 0,
    // Half-width as PLACED. A crumbled hold sets `hw` to 0 — which is the whole
    // truth about its collision and the reason nothing has to be reindexed —
    // and the renderer draws the outline it used to have from this. Without it
    // a hold does not give way, it teleports out of the world.
    baseHw: 0,
    // corpse presentation state, carried here so the renderer needs no lookup
    order: 0, bornAt: 0, bornDeath: 0, rot: 0, pose: 0, glow: 0,
  };
}

// Solids are bucketed by height so a collision query touches a handful of
// candidates instead of every corpse in the tower. Without this the predicted
// arc — which runs the real physics for up to two and a half seconds, several
// times per aiming frame — is O(ticks x corpses) and falls off 60 fps somewhere
// around the fortieth death, which is precisely when the game gets good.
const BUCKET = 32;

// Half-height of a rock ledge. A ledge's LANDABLE SURFACE is `y + hh`, and the
// hard-gap constructor has to place a surface at a height the physics reached,
// so this needed a name rather than being written out twice.
const LEDGE_HH = 2.4;

export class World {
  /** @param {number} seed */
  constructor(seed = 0x1a2b3c) {
    this.seed = seed;
    this.rng = makeRng(seed);
    /** @type {Solid[]} */
    this.solids = [];
    /** @type {Solid[]} the free list; solids are pooled and never dropped */
    this.pool = [];
    /** @type {Map<number, Solid[]>} height buckets, `BUCKET` units tall */
    this.buckets = new Map();
    this.builtTo = 0;
    this.lastX = COLUMN * 0.5;
    this.lastHw = 14;
    this.corpseCount = 0;
    /** @type {Solid[]} one scratch array, so `near` allocates nothing */
    this._q = [];
    /** @type {Solid|null} the ledge a new gap is measured from */
    this.lastLedge = null;
    /**
     * Installed by `Sim`, because verification needs the physics and the world
     * does not have any. Null in a bare `World`, which is what the poster and
     * the store checks build.
     * @type {((from: Solid, to: Solid) => boolean)|null}
     */
    this.verify = null;
    /** @type {((from: Solid, rise: number, width: number, dir: number) => {x:number,y:number}|null)|null} */
    this.step = null;
  }

  /** @returns {Solid} */
  _take() {
    const s = this.pool.pop() || newSolid();
    s.live = true;
    this.solids.push(s);
    return s;
  }

  /** Remove one solid from its height bucket. O(1) in the bucket's length. */
  /** @param {Solid} s */
  _unindex(s) {
    const arr = this.buckets.get(Math.floor(s.y / BUCKET));
    if (!arr) return;
    const i = arr.indexOf(s);
    if (i >= 0) arr.splice(i, 1);
  }

  /** @param {Solid} s */
  _index(s) {
    const k = Math.floor(s.y / BUCKET);
    let arr = this.buckets.get(k);
    if (!arr) { arr = []; this.buckets.set(k, arr); }
    arr.push(s);
  }

  /** Candidates whose slab may intersect [lo, hi]. Reuses one scratch array. */
  /**
   * @param {number} lo
   * @param {number} hi
   * @returns {Solid[]}
   */
  near(lo, hi) {
    const out = this._q;
    out.length = 0;
    const k0 = Math.floor(lo / BUCKET) - 1;
    const k1 = Math.floor(hi / BUCKET) + 1;
    for (let k = k0; k <= k1; k++) {
      const arr = this.buckets.get(k);
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) out.push(arr[i]);
    }
    return out;
  }

  /** @param {number} seed */
  reset(seed = this.seed) {
    for (const s of this.solids) { s.live = false; this.pool.push(s); }
    this.solids.length = 0;
    this.buckets.clear();
    this.rng = makeRng(seed);
    this.builtTo = 0;
    this.lastX = COLUMN * 0.5;
    this.lastHw = 14;
    this.corpseCount = 0;
    this.lastLedge = this.ledge(COLUMN * 0.5, 0, FEEL.tower.baseWidth);
  }

  /**
   * @param {number} x centre
   * @param {number} y centre; the surface is `y + LEDGE_HH`
   * @param {number} w full width
   * @returns {Solid}
   */
  ledge(x, y, w) {
    const s = this._take();
    s.x = x; s.y = y; s.hw = w * 0.5; s.hh = LEDGE_HH;
    s.corpse = false;
    s.hard = false;
    s.crumble = false;
    s.crumbleAt = 0;
    s.drift = 0;
    s.driftPhase = 0;
    s.updraft = false;
    s.baseX = x;
    s.baseHw = s.hw;
    this._index(s);
    return s;
  }

  /**
   * @param {number} x
   * @param {number} y centre; the surface is `y + hh` and sits at the apex reached
   * @param {number} rot
   * @param {number} pose
   * @param {number} at sim time
   * @param {number} deathIndex the death this body was left by; erosion ages against it
   * @returns {Solid}
   */
  corpse(x, y, rot, pose, at, deathIndex = 0) {
    const s = this._take();
    s.x = x; s.y = y;
    s.hw = FEEL.tower.corpseW * 0.5;
    s.hh = FEEL.tower.corpseH * 0.5;
    s.corpse = true;
    s.crumble = false;
    s.crumbleAt = 0;
    s.drift = 0;
    s.updraft = false;
    s.baseX = x;
    s.baseHw = s.hw;
    s.order = this.corpseCount++;
    s.bornAt = at;
    s.bornDeath = deathIndex;
    s.rot = rot;
    s.pose = pose;
    s.glow = 1;
    this._index(s);
    return s;
  }

  /**
   * THE SHIFTING ROOF.
   *
   * Everything above the player's all-time best is thrown away and regenerated
   * from a fresh seed at the start of every attempt. Below that line the world
   * is stable and the tower you built out of yourself is meaningful; above it,
   * the terrain has never been climbed and your corpses cannot carry you there.
   *
   * The record line therefore stops being a number and becomes a frontier: new
   * height is always earned on ground nobody has stood on.
   *
   * Corpses are never regenerated. They are history and history does not move.
   */
  /**
   * @param {number} y keep everything at or below this
   * @param {number} seed
   */
  regenerateAbove(y, seed) {
    const keep = [];
    for (let i = 0; i < this.solids.length; i++) {
      const s = this.solids[i];
      if (s.corpse || s.y <= y) keep.push(s);
      else { s.live = false; this.pool.push(s); }
    }
    this.solids = keep;
    this.buckets.clear();

    let top = 0, topX = COLUMN * 0.5, topHw = 15, topLedge = null;
    for (let i = 0; i < keep.length; i++) {
      const s = keep[i];
      this._index(s);
      if (!s.corpse && s.y >= top) { top = s.y; topX = s.x; topHw = s.hw; topLedge = s; }
    }
    this.builtTo = top;
    this.lastX = topX;
    this.lastHw = topHw;
    this.lastLedge = topLedge;
    this.rng = makeRng(seed);
  }

  /**
   * Grow the tower to `upTo`.
   *
   * A REACHABLE ledge sits inside the reach envelope of a full-power launch —
   * dy + |(dx,dy)| <= v²/g, scaled by `reachSafety` — minus half the ledge you
   * might be standing on the far edge of. Most ledges are reachable.
   *
   * Some, deliberately, are not. See `tower.overreachFrom`: past a certain
   * difficulty a share of gaps are placed beyond the envelope, and the only way
   * across is to fail at one, freeze at the apex out in the middle of the gap,
   * and stand on yourself next time. Making every gap crossable is what turned
   * the corpse — the entire premise of the game — into scenery.
   *
   * Every number this function reads comes from FEEL.tower.
   */
  /**
   * THE BIOME VERBS, assigned as the ledge is built.
   *
   * One per biome so each is learned in isolation, and none before the on-ramp
   * or before `verbs.from` of difficulty — PHASE3 §7 asks for both, and for never
   * introducing two new verbs within 100 m of each other, which six biomes of
   * 150 m gives for free.
   *
   * A gap CUT OUT OF A FLIGHT never gets one. Its whole guarantee is that a
   * specific launch lands on a specific surface, and a surface that crumbles or
   * drifts is not that surface.
   *
   * @param {Solid} led
   * @param {number} diff
   * @param {boolean} cut  was this a hard gap
   */
  _verbs(led, diff, cut) {
    const V = FEEL.verbs;
    // Both rolls always happen, so the random stream — and therefore the tower —
    // does not depend on which biome this ledge landed in.
    const roll = this.rng();
    const phase = this.rng();
    if (cut || diff < V.from || led.y < FEEL.tower.openingSpan) return;

    const biome = Math.floor(led.y / BIOME_SPAN) % 6;
    if (biome === 0 && diff >= V.crumbleFrom && roll < V.crumbleRate) {
      led.crumble = true;
    } else if (biome === 1 && roll < V.updraftRate) {
      // A column of rising air standing on this ledge. It is only ever a bonus:
      // route proofs fly with it switched off (see `_probeFlight`), so every gap
      // the generator promised is still crossable if the player ignores it.
      led.updraft = true;
    } else if (biome === 2 && roll < V.driftRate) {
      // A drifting ledge cannot move out of a route that was proved against
      // `baseX`, and the margin that guarantees it is the 30% of the physical
      // reach envelope every ordinary gap is placed inside — NOT the 3 u of
      // landing forgiveness, which `driftAmp` is already wider than.
      // `cairn-verbs-check.mjs` sweeps the whole cycle and finds the first wall
      // between 12 and 16 u.
      led.drift = V.driftAmp;
      led.driftPhase = phase * Math.PI * 2;
    }
  }

  /** @param {number} upTo world height to build to */
  generate(upTo) {
    const T = FEEL.tower;
    const g = FEEL.gravityRise;
    // The PHYSICAL envelope of a full-power launch, and the conservative one
    // ordinary ledges are placed inside. The difference between the two used to
    // be the whole of "difficulty", which is why nothing was ever hard: a gap at
    // the safe limit is only 70% of a gap the body can actually clear.
    const hard = (FEEL.launch.maxSpeed ** 2) / g;
    const reach = hard * T.reachSafety;
    // Straight up, ignoring the apex hang, which only ever adds. A ledge above
    // this cannot be reached however wide the column is — which is the point.
    const lift = (FEEL.launch.maxSpeed ** 2) / (2 * g);

    while (this.builtTo < upTo) {
      const h = this.builtTo;
      // No ceiling. `clamp(h / 900, 0, 1)` had one and the tower above it was a
      // flat, survivable constant; this approaches 1 and never reaches it.
      const diff = 1 - Math.exp(-Math.max(0, h) / T.diffScale);

      // THE GAPS YOU CANNOT CROSS — decided first, because a gap that is too
      // high changes every number below it.
      const over = Math.max(0, diff - T.overreachFrom) / Math.max(1e-6, 1 - T.overreachFrom);
      // Never inside the on-ramp. The difficulty curve already puts the first
      // overreach gap near 92 m, but a curve is a number and this is a promise.
      const unreachable = h >= T.openingSpan && this.rng() < over * T.overreachRate;

      // THE GAPS A BODY MAKES EASY. Rolled here, next to the mechanic it
      // replaced, and never on the on-ramp.
      //
      // The roll is drawn UNCONDITIONALLY and tested afterwards. `&&`
      // short-circuits, so folding it into the condition would make the number of
      // random draws depend on `overreachRate` and on height — and the tower is
      // the random stream. It would still be deterministic; it would just quietly
      // become a different tower the next time someone touches an unrelated knob.
      const hardRoll = this.rng();
      const hardT = Math.max(0, diff - T.hardFrom) / Math.max(1e-6, 1 - T.hardFrom);
      const hardGap = !unreachable && h >= T.openingSpan
        && hardRoll < hardT * T.hardRate;

      const rise = unreachable
        ? lift * (T.overreachLift + this.rng() * T.overreachLiftSpan)
        : T.minRise + this.rng() * (T.maxRise - T.minRise)
          * (T.riseEase + (1 - T.riseEase) * diff);

      const room = reach - rise;
      const maxDx = room > 0 ? Math.sqrt(Math.max(0, room * room - rise * rise)) : 0;
      const usable = Math.max(4, maxDx - this.lastHw);
      const span = T.gapNear + (T.gapFar - T.gapNear) * diff;

      let width = T.maxWidth - (T.maxWidth - T.minWidth) * diff
        * (T.widthEase + (1 - T.widthEase) * this.rng());

      // The on-ramp: generous at the base, blending into the curve by
      // `openingSpan`. `open` is 0 at the very bottom and 1 past the ramp.
      const open = clamp(h / T.openingSpan, 0, 1);
      if (open < 1) width = T.openingWidth + (width - T.openingWidth) * open;

      // An unreachable ledge stays nearly overhead, so the body left below it is
      // a step toward it rather than a body stranded out in a gap.
      let want = unreachable
        ? usable * T.overreachDrift * this.rng()
        : usable * span * (1 - T.gapJitter + this.rng() * T.gapJitter);
      if (open < 1) want *= T.openingGap + (1 - T.openingGap) * open;

      const dir = this.rng() < 0.5 ? -1 : 1;
      let nx = this.lastX + want * dir;
      const lo = T.edgePad + width * 0.5;
      const hi = COLUMN - T.edgePad - width * 0.5;
      if (nx < lo || nx > hi) nx = this.lastX - want * dir;
      nx = clamp(nx, lo, hi);

      this.builtTo = h + rise;
      const from = this.lastLedge;

      // A HARD GAP IS NOT PLACED AND THEN CHECKED. IT IS CUT OUT OF A FLIGHT.
      //
      // Overreach placed a ledge past the envelope and asked afterwards whether a
      // body could bridge it; roughly half the time nothing could, and that is
      // where every wall this game ever had came from. This asks the opposite
      // question first: fly the real physics off the worst footing on the ledge
      // below, and put the new surface exactly where the body was, at the far end
      // of the arc. A jump that lands it is then not a hope, it is the flight the
      // ledge was cut from — and the arc the player aims with is that same
      // integrator, so what they see is what was measured.
      //
      // `hardSlack` pulls it a few units back from the end, because a gap at the
      // exact limit forgives only launches that fall short.
      let cut = false;
      if (hardGap && this.step && from) {
        const p = this.step(from, rise * T.hardRiseScale, width, dir)
          || this.step(from, rise * T.hardRiseScale, width, -dir);
        // Strictly higher than the ledge below, or it is not a rise at all: the
        // constructed surface lands on a tick boundary and can sit up to one
        // tick of fall under the height that was asked for.
        if (p && p.y - LEDGE_HH > h) { nx = p.x; this.builtTo = p.y - LEDGE_HH; cut = true; }
      }

      const led = this.ledge(nx, this.builtTo, width);
      led.hard = cut;
      this._verbs(led, diff, cut);

      // THE PROMISE: NO LEDGE YOU CANNOT LEAVE.
      //
      // An unreachable gap is the point of this game — you die in it and stand
      // on the body — but only when a body actually bridges it. Roughly half of
      // them did not, for a reason a great deal of measurement never explained,
      // and a player hit one three separate times and was stuck.
      //
      // So the generator proves it now instead of assuming it. `verify` runs the
      // real physics; if it cannot demonstrate a route, the ledge drops to an
      // ordinary rise. The test is deliberately CONSERVATIVE and cheap: a false
      // negative costs one hard gap, a false positive would cost the run, and a
      // physics-verified positive cannot be false.
      if (unreachable && this.verify && from && !this.verify(from, led)) {
        this._unindex(led);
        led.y = h + T.minRise + this.rng() * (T.maxRise - T.minRise);
        this.builtTo = led.y;
        this._index(led);
      }

      this.lastX = nx;
      this.lastHw = width * 0.5;
      this.lastLedge = led;
    }
  }
}

// ------------------------------------------------------------------- player

/** @returns {Body} */
export function newBody() {
  return {
    x: COLUMN * 0.5, y: 0,
    px: COLUMN * 0.5, py: 0,     // previous tick, for render interpolation
    rx: COLUMN * 0.5, ry: 0,     // interpolated for the renderer; never read by physics
    vx: 0, vy: 0,
    grounded: true,
    /** @type {Solid|null} */
    standing: null,
    onWall: 0,                   // -1 left contact, +1 right, 0 none
    wallTimer: 0,
    coyote: 0,
    takeoff: 0,
    peakX: 0, peakY: 0,
    airTime: 0,
    hangTimer: 0,
    // THE BODY'S OWN CLOCK, in `verbTime`'s units. The real body's tracks the
    // world's; the ghost's and the probe's run ahead through the flight being
    // previewed, which is the only reason a drifting ledge lands where the arc
    // drew it. Set at every launch, advanced once per tick by `_flight`.
    t: 0,
  };
}

// --------------------------------------------------------------------- game

export const PHASE = { TITLE: 0, PLAY: 1, DYING: 2, RESET: 3 };

export class Sim {
  /** @param {number} [seed] */
  constructor(seed) {
    this.world = new World(seed);
    this.body = newBody();
    this.phase = PHASE.TITLE;
    this.time = 0;
    this.deaths = 0;
    this.best = 0;
    this.runBest = 0;
    /**
     * The UTC date of the Daily Climb, or null in endless. The seed is DERIVED
     * from this rather than stored, so a share card carrying the date is enough
     * to hand someone the identical tower.
     * @type {string|null}
     */
    this.dailyDate = null;
    /** @type {Launch|null} a launch queued in the air, spent on landing */
    this.buffered = null;
    this.bufferTimer = 0;
    /** @type {number[]} flat [kind, a, b, c, ...], drained by the presentation layer */
    this.events = [];
    this.hitStop = 0;
    // The longest single sub-step ever taken, for the tunnelling test.
    this.maxSubStep = 0;
    // A full body used as the scratch for predicted flight, allocated once.
    this._ghost = newBody();
    // Scratch for launchVelocity, so aiming allocates nothing per frame.
    this._lv = { vx: 0, vy: 0 };
    // Where a predicted launch would freeze. Filled by `predict`, read by the
    // renderer to draw the body you are about to leave. Allocated once.
    this.predictPeak = { x: 0, y: 0, dies: false };
    // A second scratch body, for proving routes while the player is in the air.
    this._probe = newBody();
    /**
     * VERB TIME. Drifting ledges move on this rather than on `time`, because
     * `time` also advances during the death transition and while a prediction is
     * being computed — and a ledge that slid sideways between the arc being drawn
     * and the launch being fired would make the preview a liar, which is the one
     * thing this codebase will not have. It advances only in `tick`.
     */
    this.verbTime = 0;
    /** Ledges that crumbled this tick, drained by the presentation layer. */
    this.crumbled = 0;
    // Where a constructed hard gap puts its landing surface. Allocated once,
    // because generation runs inside `tick`.
    this._hs = { x: 0, y: 0 };
    this.world.verify = (from, to) => this.routeExists(from, to);
    this.world.step = (from, rise, width, dir) => this.hardStep(from, rise, width, dir);
    this.reset(true);
  }

  /**
   * @param {number} kind one of EV
   * @param {number} [a]
   * @param {number} [b]
   * @param {number} [c]
   */
  emit(kind, a = 0, b = 0, c = 0) { this.events.push(kind, a, b, c); }

  /**
   * Fly the PROBE — never the player — and report what it landed on.
   *
   * The generator runs while the real body is mid-flight, so verification gets
   * its own scratch body. `_flight` only ever touches the body it is handed and
   * the world, which is what makes this safe.
   */
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} vx
   * @param {number} vy
   * @param {Solid|null} standing
   * @returns {Solid|null} what it landed on, or null for died / still flying
   */
  _probeFlight(x, y, vx, vy, standing) {
    const p = this._probe;
    p.x = p.px = x; p.y = p.py = y;
    p.vx = vx; p.vy = vy;
    p.takeoff = y; p.peakX = x; p.peakY = y;
    p.hangTimer = 0; p.onWall = 0; p.wallTimer = 0;
    p.grounded = false; p.standing = standing;
    p.t = this.verbTime;
    for (let i = 0; i < 360; i++) {
      const r = this._flight(p, 0);
      if (r === 'die') return null;
      if (r) return r;
    }
    return null;
  }

  /** Does any launch from (x, y) land on `target`? Coarse and conservative. */
  /**
   * @param {number} x
   * @param {number} y
   * @param {Solid|null} standing
   * @param {Solid} target
   * @returns {boolean}
   */
  _reaches(x, y, standing, target) {
    const L = FEEL.launch;
    const dx = target.x - x, dy = target.y + target.hh - y;
    for (const m of [1.5, 5, 10, 16]) {
      const peak = Math.max(dy + m, 0.5);
      const vy = Math.sqrt(2 * FEEL.gravityRise * peak);
      const t = vy / FEEL.gravityRise
        + Math.sqrt((2 * Math.max(peak - dy, 0)) / FEEL.gravityFall);
      const vx = dx / Math.max(t, 1e-3);
      const sp = Math.hypot(vx, vy);
      if (sp > 1e-6) {
        const k = clamp(sp, L.minSpeed, L.maxSpeed) / sp;
        if (this._probeFlight(x, y, vx * k, vy * k, standing) === target) return true;
      }
    }
    for (let a = 25; a <= 155; a += 10) {
      const th = a * Math.PI / 180;
      for (let f = 1; f >= 0.39; f -= 0.2) {
        const sp = L.minSpeed + (L.maxSpeed - L.minSpeed) * f;
        if (this._probeFlight(x, y, Math.cos(th) * sp, Math.sin(th) * sp, standing) === target) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Fly the probe and report the tick-end at which it first FALLS PAST `atY`.
   *
   * That point is landable by construction: put a surface there and the very
   * same tick of the very same integrator crosses it downward, so `_surfaceUnder`
   * catches it. Returns null if the flight ended first, or if the apex never got
   * that high — in which case the point would be an apex, not a descent, and the
   * gap would be a different gap from the one asked for.
   */
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} vx
   * @param {number} vy
   * @param {number} atY
   * @returns {Body|null}
   */
  _descendTo(x, y, vx, vy, atY) {
    const p = this._probe;
    p.x = p.px = x; p.y = p.py = y;
    p.vx = vx; p.vy = vy;
    p.takeoff = y; p.peakX = x; p.peakY = y;
    p.hangTimer = 0; p.onWall = 0; p.wallTimer = 0;
    p.grounded = false; p.standing = null;
    p.t = this.verbTime;
    for (let i = 0; i < 360; i++) {
      if (this._flight(p, 0)) return null;      // landed on something, or died
      if (p.vy < 0 && p.y <= atY) return p.peakY < atY ? null : p;
    }
    return null;
  }

  /**
   * THE HARD GAP — cut out of a flight rather than placed and hoped for.
   *
   * Launches off the WORST footing on `from`: the far edge, the side away from
   * where the ledge is going. That is deliberate and it is the whole safety
   * argument. A gap verified from the near edge is a gap that becomes unleavable
   * whenever the player happens to land on the wrong end of the perch, which is
   * exactly the report — "I could not get off this ledge" — that this game has
   * already been through once.
   *
   * Of every legal launch that gets high enough, take the one that ends up
   * FURTHEST away. The ledge goes there, minus `hardSlack`. So the jump is at the
   * edge of what the body can do, one launch in a narrow fan makes it, and the
   * failure is not a wall: you freeze at the apex, out in the gap and below the
   * ledge, which is the step.
   *
   * Returns the LANDING SURFACE height and centre, or null when no launch this
   * side of the column can produce one.
   */
  /**
   * @param {Solid} from
   * @param {number} wantRise
   * @param {number} width
   * @param {number} dir -1 or +1
   * @returns {{x: number, y: number}|null} the LANDING SURFACE, or null
   */
  hardStep(from, wantRise, width, dir) {
    const L = FEEL.launch;
    const T = FEEL.tower;
    const fx = from.x - dir * from.hw;
    const fy = from.y + from.hh;
    const atY = fy + wantRise;
    const lo = T.edgePad + width * 0.5;
    const hi = COLUMN - T.edgePad - width * 0.5;

    let bx = 0, by = 0, bvx = 0, bvy = 0, bd = -1;
    for (let f = 1; f >= 0.84; f -= 0.08) {
      const sp = L.minSpeed + (L.maxSpeed - L.minSpeed) * f;
      for (let a = 30; a <= 78; a += 4) {
        const th = a * Math.PI / 180;
        const vx = Math.cos(th) * sp * dir, vy = Math.sin(th) * sp;
        const p = this._descendTo(fx, fy, vx, vy, atY);
        if (!p) continue;
        // Back off the very end of the arc, and only then ask whether the point
        // is a legal ledge centre — a pulled-back point can be legal where the
        // end of the arc was against the wall.
        const px = p.x - dir * T.hardSlack;
        if (px < lo || px > hi) continue;
        const d = Math.abs(px - fx);
        if (d > bd) { bd = d; bx = px; by = p.y; bvx = vx; bvy = vy; }
      }
    }
    if (bd < 0) return null;

    // THE PROOF, TAKEN BACK.
    //
    // Pulling the surface `hardSlack` sideways means the flight it was cut from no
    // longer ends on it, so the construction is an argument again and arguments
    // are what put walls in this game. Fly it: the winning launch off the worst
    // footing has to land on the ledge that is actually there, and from the near
    // footing — where the same launch overshoots by the width of the perch — some
    // weaker launch on the same line has to land on it too. Anything this cannot
    // demonstrate goes back to being an ordinary gap.
    const led = this.world.ledge(bx, by - LEDGE_HH, width);
    const nx = from.x + dir * from.hw;
    let ok = this._probeFlight(fx, fy, bvx, bvy, from) === led;
    if (ok) {
      ok = false;
      for (let k = 1; k >= 0.76 && !ok; k -= 0.02) {
        if (Math.hypot(bvx, bvy) * k < L.minSpeed) break;
        ok = this._probeFlight(nx, fy, bvx * k, bvy * k, from) === led;
      }
    }
    // THE SECOND ROUTE IS NOT A CONDITION OF BEING HARD, AND THAT WAS MEASURED
    // RATHER THAN ASSUMED.
    //
    // Requiring `_bodyRoute` to prove a two-jump route here as well looked
    // obviously right — "one hard jump or two easy ones" is the design sentence.
    // It destroys the mechanic. The gaps a single apex body can bridge are the
    // SHORT ones, so the filter kept those and threw away the long ones: median
    // span fell 42.6 u to 25.7 u, the surviving gaps forgave more angular error
    // than ordinary gaps did, and the average model's landings on its own bodies
    // fell from 6.54% to 3.45%. The requirement selected against the thing it was
    // meant to guarantee.
    //
    // It is also not needed for safety. The promise this mechanic has to keep is
    // that no ledge is ever unleavable, and that is carried entirely by the direct
    // proof above. The body is measured, not decreed:
    // `scripts/cairn-bodies-check.mjs` reports what share of hard gaps a body
    // bridges, and reports the share of landings that actually happen on one.
    this.world._unindex(led);
    const at = this.world.solids.indexOf(led);
    if (at >= 0) this.world.solids.splice(at, 1);
    led.live = false;
    this.world.pool.push(led);
    if (!ok) return null;

    const out = this._hs;
    out.x = bx; out.y = by;
    return out;
  }

  /**
   * Is there a way from `from` to `to` — directly, or by dying once and standing
   * on the body it leaves? Installed on the world as `verify`.
   */
  /**
   * @param {Solid} from
   * @param {Solid} to
   * @returns {boolean}
   */
  routeExists(from, to) {
    const edge = from.x + Math.sign(to.x - from.x || 1) * from.hw;
    const y = from.y + from.hh;
    if (this._reaches(edge, y, from, to)) return true;
    return this._bodyRoute(from, edge, y, to);
  }

  /**
   * Can `to` be reached from `from` by DYING ONCE — leaving a body in the gap and
   * standing on it?
   *
   * Called by `routeExists`, which asks it about a gap no launch can cross, and
   * by `hardStep`, which asks it about a gap a launch CAN cross and wants the
   * second route to exist anyway. Same question, one implementation: the shortcut
   * and the rescue are the same geometry, and two copies of it would drift.
   *
   * The throw that goes FURTHEST is not the useful one — a corpse's surface sits
   * at the apex reached, so a body placed at maximum height leaves nothing above
   * it to aim for. Shorter, steeper throws come first for exactly that reason.
   */
  /**
   * @param {Solid} from
   * @param {number} edge
   * @param {number} y
   * @param {Solid} to
   * @returns {boolean}
   */
  _bodyRoute(from, edge, y, to) {
    const L = FEEL.launch;
    for (let a = 88; a >= 40; a -= 8) {
      for (let f = 0.55; f <= 1.001; f += 0.15) {
        const sp = L.minSpeed + (L.maxSpeed - L.minSpeed) * f;
        const th = a * Math.PI / 180 * Math.sign(to.x - from.x || 1);
        if (this._probeFlight(edge, y, Math.cos(th) * sp, Math.sin(th) * sp, from)) continue;
        const px = this._probe.peakX, py = this._probe.peakY;
        if (py <= y + 1) continue;

        const c = this.world.corpse(px, py - FEEL.tower.corpseH * 0.5, 0, 0, 0, this.deaths);
        let ok = this._reaches(edge, y, from, c);
        if (ok) {
          const ch = solidHalfWidth(c, this);
          const cx = c.x + Math.sign(to.x - c.x || 1) * ch;
          ok = this._reaches(cx, c.y + c.hh, c, to);
        }
        this.world._unindex(c);
        const at = this.world.solids.indexOf(c);
        if (at >= 0) this.world.solids.splice(at, 1);
        this.world.corpseCount--;
        c.live = false;
        this.world.pool.push(c);
        if (ok) return true;
      }
    }
    return false;
  }

  /** Full restart: bare rock, no history. Corpses are restored separately. */
  /** @param {boolean} [hard] wipe deaths and time as well as the terrain */
  reset(hard) {
    this.world.reset(this.world.seed);
    this.world.generate(FEEL.camera.viewH * 2.2);
    this._stand();
    this.runBest = 0;
    if (hard) { this.deaths = 0; this.time = 0; }
  }

  /** Restart the attempt while keeping every corpse in place. */
  respawn() {
    // A fresh roof for every attempt, but a DETERMINISTIC one: the seed is a
    // function of the world seed and the attempt number, so the same tower
    // played the same way is still bit-identical on any device.
    this.world.regenerateAbove(this.best, (this.world.seed ^ (this.deaths * 0x9e3779b1)) | 0);
    this.world.generate(Math.max(this.best, 0) + FEEL.camera.viewH * 2.2);
    this._stand();
    this.runBest = 0;
    this.phase = PHASE.PLAY;
  }

  /** Place the body standing on the surface of the base ledge, not inside it. */
  _stand() {
    const b = this.body;
    const base = this.world.solids[0];
    b.x = b.px = base.x;
    b.y = b.py = base.y + base.hh;
    b.vx = b.vy = 0;
    b.grounded = true;
    b.standing = base;
    b.onWall = 0; b.wallTimer = 0; b.coyote = FEEL.coyoteTime;
    b.airTime = 0; b.hangTimer = 0;
    b.t = this.verbTime;
    b.takeoff = b.y;
  }

  // ------------------------------------------------------------- the launch

  canLaunch() {
    const b = this.body;
    return this.phase === PHASE.PLAY && (b.grounded || b.coyote > 0 || b.onWall !== 0);
  }

  /**
   * Fire, or buffer. A launch requested up to `jumpBuffer` before touching
   * down is honoured on contact, which removes the single most common source
   * of "the game ate my input".
   */
  /**
   * @param {number} vx
   * @param {number} vy
   * @returns {boolean} true if it fired now, false if it was buffered or refused
   */
  launch(vx, vy) {
    if (this.phase !== PHASE.PLAY) return false;
    if (!this.canLaunch()) {
      this.buffered = this.buffered || { vx: 0, vy: 0 };
      this.buffered.vx = vx; this.buffered.vy = vy;
      this.bufferTimer = FEEL.jumpBuffer;
      return false;
    }
    return this._fire(vx, vy);
  }

  /**
   * The velocity a launch ACTUALLY leaves with, wall kick included.
   *
   * ONE SOURCE, for the same reason there is one integrator. `_fire` used to
   * add the kick itself and `predict` did not know about it, so every launch off
   * a cling flew 16 u/s further sideways than the arc the player was aiming
   * with. On the ground the arc was exact — measured over 2,400 launches — and
   * off a wall it disagreed on 59 of 400. A preview that is right except when
   * you are clinging to something is worse than no preview, because the player
   * learns to trust it first.
   *
   * Writes into `out` so the aim path allocates nothing.
   */
  /**
   * @param {Body} b
   * @param {number} vx
   * @param {number} vy
   * @param {Launch} out
   * @returns {Launch}
   */
  launchVelocity(b, vx, vy, out) {
    out.vx = vx;
    out.vy = vy;
    if (b.onWall !== 0 && !b.grounded) out.vx += -b.onWall * FEEL.wall.kickX * 0.35;
    return out;
  }

  /**
   * @param {number} vx
   * @param {number} vy
   * @returns {boolean}
   */
  _fire(vx, vy) {
    const b = this.body;
    const v = this.launchVelocity(b, vx, vy, this._lv);
    b.vx = v.vx; b.vy = v.vy;
    b.grounded = false;
    b.coyote = 0;
    b.onWall = 0;
    b.wallTimer = 0;
    b.takeoff = b.y;
    b.peakX = b.x;
    b.peakY = b.y;
    b.airTime = 0;
    b.hangTimer = 0;
    // The real body starts its clock at the world's, and the two advance
    // together forever after — so a drifting ledge is collided at exactly the
    // position `_stepVerbs` drew it at.
    b.t = this.verbTime;
    this.buffered = null;
    this.emit(EV.LAUNCH, Math.hypot(b.vx, b.vy));
    return true;
  }

  // ------------------------------------------------------------ integration

  /** Gravity for the current instant, including the apex hang. */
  /**
   * @param {Body} b
   * @returns {number}
   */
  _gravity(b) {
    const A = FEEL.apexHang;
    let g = b.vy > 0 ? FEEL.gravityRise : FEEL.gravityFall;
    if (Math.abs(b.vy) < A.vyBand && b.hangTimer < A.window * 2) g *= A.scale;
    return g;
  }

  /**
   * Advance a body ONE TICK OF FLIGHT against the world.
   *
   * This is the only place flight is ever integrated. The game calls it with
   * the player; `predict` calls it with a scratch body. That is the entire
   * reason the aim line is exact rather than approximately right — an earlier
   * build had two integrators and they diverged by twenty-two units, which on
   * a phone reads as "the jumps are not accurate" and not as "the preview is
   * subtly wrong".
   *
   * Movement is swept: the delta is walked in sub-steps no longer than half the
   * body, so nothing passes through a corpse between two frames however fast it
   * is travelling.
   *
   * @returns the solid landed on, the string 'die', or null for still flying.
   */
  /**
   * @param {Body} b
   * @param {number} aimDir -1, 0 or +1 of held air control
   * @returns {Solid|'die'|null}
   */
  _flight(b, aimDir) {
    // Subtle drift toward the aim. Enough to save a jump, never enough to make
    // aiming optional.
    if (aimDir !== 0) {
      const cap = FEEL.launch.maxSpeed * FEEL.airControl;
      const want = aimDir * cap;
      if (Math.sign(want) !== Math.sign(b.vx) || Math.abs(b.vx) < Math.abs(want)) {
        b.vx += Math.sign(want - b.vx) * FEEL.airControlAccel * DT;
      }
    }

    const g = this._gravity(b);
    if (Math.abs(b.vy) < FEEL.apexHang.vyBand) b.hangTimer += DT; else b.hangTimer = 0;
    // The updraft is part of the flight, so `predict` sees it too and the arc
    // stays honest inside a column. One integrator, one source.
    //
    // The generator's probe is the one body it does NOT lift. Every route this
    // world promises is proved without help, so a column can only ever widen
    // what was already crossable — and switching updrafts off tomorrow cannot
    // strand anybody standing in a tower built today.
    const lift = b === this._probe ? 0 : this.updraftAt(b.x, b.y);
    b.vy -= (g - lift) * DT;
    if (b.vy < -FEEL.maxFallSpeed) b.vy = -FEEL.maxFallSpeed;

    // THE BODY'S OWN CLOCK. For the real body this tracks `verbTime` exactly,
    // because both advance one DT per tick. For `_ghost` and `_probe` it runs
    // ahead into the future the launch is being flown through, which is what
    // makes a drifting ledge land where the arc said it would.
    b.t += DT;

    let dx = b.vx * DT;
    let dy = b.vy * DT;
    const span = Math.hypot(dx, dy);
    const limit = Math.min(FEEL.body.w, FEEL.body.h) * FEEL.body.sweepFraction;
    const steps = clamp(Math.ceil(span / limit), 1, FEEL.sim.maxSubSteps);
    dx /= steps; dy /= steps;
    const stepLen = span / steps;
    if (stepLen > this.maxSubStep) this.maxSubStep = stepLen;

    const halfW = FEEL.body.w * 0.5;
    for (let i = 0; i < steps; i++) {
      const fromY = b.y;
      b.x += dx;
      b.y += dy;
      if (b.y > b.peakY) { b.peakY = b.y; b.peakX = b.x; }

      if (b.x < halfW) { b.x = halfW; if (b.vx < 0) b.vx = 0; this._wall(b, -1); }
      else if (b.x > COLUMN - halfW) { b.x = COLUMN - halfW; if (b.vx > 0) b.vx = 0; this._wall(b, 1); }
      else b.onWall = 0;

      if (b.vy <= 0) {
        const s = this._surfaceUnder(fromY, b.y, b.x, b.t);
        if (s) return s;
      }
      this._sides(b);
      if (b.vy < 0 && b.y < b.takeoff) return 'die';
    }
    return null;
  }

  /** One fixed tick of the whole game. */
  /**
   * Move every drifting ledge to where it is at `verbTime`, and retire any hold
   * whose time has run out.
   *
   * Runs ONCE per tick, before the body moves, so a prediction and the flight it
   * predicts see the world in the same place. Only ledges near the player are
   * touched — the rest of the tower is not on screen and nothing can land on it.
   */
  _stepVerbs() {
    const b = this.body;
    const near = this.world.near(b.y - FEEL.camera.viewH, b.y + FEEL.camera.viewH);
    for (let i = 0; i < near.length; i++) {
      const s = near[i];
      if (s.drift > 0) s.x = this.driftXAt(s, this.verbTime);
      if (s.crumble && s.crumbleAt > 0 && this.verbTime >= s.crumbleAt) {
        // `hw = 0` is the entire truth about its collision, and it needs no
        // reindexing because the height buckets are keyed on y. It does not
        // vanish: the renderer keeps drawing its outline from `baseHw`, which
        // is the same sentence MEMORY says about an old corpse — present, and
        // not a platform.
        s.crumble = false;
        s.crumbleAt = 0;
        s.hw = 0;
        this.crumbled++;
        this.emit(EV.CRUMBLE, s.x, s.y);
        if (b.standing === s) { b.grounded = false; b.standing = null; b.coyote = 0; }
      }
    }
  }

  /**
   * WHERE A DRIFTING LEDGE IS AT A GIVEN SIM TIME.
   *
   * The one source. `_stepVerbs` writes `s.x` from it for the renderer, and
   * every collision query inside `_flight` reads it at the FLIGHT'S OWN time —
   * which for the aim arc is up to two seconds in the future.
   *
   * Without that second caller the arc lied on 71.8% of drifting ledges: the
   * preview froze the world at the instant the thumb was down, the real flight
   * moved the ledge for a second and a half underneath it, and the two landed
   * in different places. Exactly the shape of DECISIONS.md §4 and §19, arriving
   * through a third new hole. Acceptance test 2 cannot see it — all 94 of its
   * launches leave from the ground onto ledges that do not move.
   *
   * @param {Solid} s
   * @param {number} t sim time, in the same clock as `verbTime`
   * @returns {number}
   */
  driftXAt(s, t) {
    if (s.drift <= 0) return s.x;
    const V = FEEL.verbs;
    return s.baseX + Math.sin(t * V.driftHz * Math.PI * 2 + s.driftPhase) * s.drift;
  }

  /**
   * Upward acceleration from a SIGNAL updraft at this position, or 0.
   *
   * Derived from the world rather than stored: an updraft sits above the ledge
   * that carries it, so there is nothing to keep in step and nothing to persist.
   * It can only ever ADD reach, which is why it cannot turn a crossable gap into
   * a wall — the whole generator is verified without one.
   *
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  updraftAt(x, y) {
    const V = FEEL.verbs;
    if (V.updraftRate <= 0) return 0;
    const near = this.world.near(y - V.updraftH, y + 4);
    for (let i = 0; i < near.length; i++) {
      const s = near[i];
      if (!s.updraft) continue;
      const top = s.y + s.hh;
      if (y < top || y > top + V.updraftH) continue;
      if (Math.abs(x - s.x) > V.updraftW) continue;
      // Strongest at the mouth, fading out at the top so it never feels like a
      // lift you ride to the ceiling.
      return V.updraftAccel * (1 - (y - top) / V.updraftH);
    }
    return 0;
  }

  /** @param {number} [aimDir] -1, 0 or +1 of held air control */
  tick(aimDir = 0) {
    this.time += DT;
    this.verbTime += DT;
    this._stepVerbs();
    if (this.hitStop > 0) { this.hitStop -= DT; return; }
    if (this.phase !== PHASE.PLAY) return;

    const b = this.body;
    b.px = b.x; b.py = b.y;

    if (this.bufferTimer > 0) {
      this.bufferTimer -= DT;
      if (this.bufferTimer <= 0) this.buffered = null;
    }

    if (b.grounded) {
      b.vx *= FEEL.landing.friction;
      if (Math.abs(b.vx) < 0.4) b.vx = 0;
      b.coyote = FEEL.coyoteTime;
      this.world.generate(b.y + FEEL.camera.viewH * 2.2);
      return;
    }

    b.coyote -= DT;
    b.airTime += DT;

    const r = this._flight(b, aimDir);
    if (r === 'die') { this._die(); return; }
    if (r) { this._land(r); return; }

    this.world.generate(b.y + FEEL.camera.viewH * 2.2);
  }

  /**
   * The highest surface the body's feet crossed downward through, including
   * `landing.forgiveness` of horizontal grace — a near miss while falling is
   * pulled onto the ledge rather than punished, because a player who was
   * clearly going for a platform meant to be on it.
   */
  /**
   * @param {number} fromY
   * @param {number} toY
   * @param {number} x
   * @param {number} t sim time of this body, for ledges that drift
   * @returns {Solid|null}
   */
  _surfaceUnder(fromY, toY, x, t) {
    const solids = this.world.near(toY - 4, fromY + 4);
    const half = FEEL.body.w * 0.5;
    let best = null;
    let bestSlack = Infinity;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      const top = s.y + s.hh;
      if (fromY < top || toY > top) continue;
      const hw = solidHalfWidth(s, this);
      if (hw <= 0) continue;                       // a MEMORY is not a platform
      const over = Math.abs(x - this.driftXAt(s, t)) - (hw + half);
      if (over > FEEL.landing.forgiveness) continue;
      if (!best || top > best.y + best.hh || (over < bestSlack && top === best.y + best.hh)) {
        best = s; bestSlack = over;
      }
    }
    return best;
  }

  /** @param {Solid} s */
  _land(s) {
    const b = this.body;
    const impact = Math.abs(b.vy);
    const top = s.y + s.hh;
    b.y = top;
    const lhw = solidHalfWidth(s, this);
    const sx = this.driftXAt(s, b.t);
    b.x = clamp(b.x, sx - lhw - FEEL.landing.forgiveness, sx + lhw + FEEL.landing.forgiveness);
    b.vy = 0;
    b.vx *= FEEL.landing.friction;
    b.grounded = true;
    b.standing = s;
    b.onWall = 0;
    b.coyote = FEEL.coyoteTime;
    if (b.y > this.runBest) this.runBest = b.y;
    // ASH: the hold starts failing the moment it takes your weight, and only
    // then. An untouched crumbling ledge is a normal ledge forever.
    if (s.crumble && s.crumbleAt === 0) {
      s.crumbleAt = this.verbTime + FEEL.verbs.crumbleMs / 1000;
      this.emit(EV.CRUMBLE_START, s.x, s.y);
    }
    if (impact > FEEL.landing.hardImpactVy) this.hitStop = FEEL.juice.hitStopLand;
    this.emit(EV.LAND, impact, b.x, b.y);
    if (this.buffered && this.bufferTimer > 0) {
      const q = this.buffered;
      this._fire(q.vx, q.vy);
    }
  }

  /**
   * @param {Body} b
   * @param {number} side
   */
  _wall(b, side) {
    b.onWall = side;
    b.wallTimer += DT;
    if (b.wallTimer > FEEL.wall.grabWindow && b.vy < -FEEL.wall.slideSpeed) {
      b.vy = -FEEL.wall.slideSpeed;
    }
  }

  /** Cling to the vertical face of a ledge or a corpse. */
  /** @param {Body} b */
  _sides(b) {
    if (b.vy > 0) return;
    const solids = this.world.near(b.y - 2, b.y + FEEL.body.h + 2);
    const half = FEEL.body.w * 0.5;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      // From TOP onward a corpse is a shelf, not a wall: you can land on it,
      // you can no longer cling to its side.
      if (s.corpse && erosionOf(s, this) >= EROSION.TOP) continue;
      if (b.y > s.y + s.hh || b.y + FEEL.body.h < s.y - s.hh) continue;
      const sx = this.driftXAt(s, b.t);
      const dx = b.x - sx;
      const hw = solidHalfWidth(s, this);
      if (hw <= 0) continue;
      const overlap = hw + half - Math.abs(dx);
      if (overlap <= 0 || overlap > half) continue;
      const side = dx > 0 ? 1 : -1;
      b.x = sx + side * (s.hw + half);
      if (Math.sign(b.vx) === -side) b.vx = 0;
      this._wall(b, side);
      return;
    }
  }

  /**
   * The one rule. You freeze at the apex of the arc — out in the gap and above
   * the ledge you left — so a failed jump does not cost you the gap, it fills
   * it. Every death therefore leaves a platform strictly above its own
   * take-off, and the harness checks that on every single death.
   */
  _die() {
    const b = this.body;
    const rot = (this.world.rng() - 0.5) * 1.1;
    const pose = Math.floor(this.world.rng() * 4);
    // THE BODY'S TOP SITS AT THE APEX, NOT ITS CENTRE.
    //
    // This used to pass `peakY` as the centre, which put the corpse's landable
    // surface `corpseH / 2` — three units — ABOVE the highest point the body ever
    // reached. That is a small lie about the one rule the game has, and it had a
    // large consequence: the body you leave at maximum height is a body you can
    // never stand on, because standing on it requires reaching higher than you
    // just proved you could. Roughly half of all uncrossable gaps had no route
    // for exactly this reason, and a player at 391 m hit one.
    //
    // Now the surface is exactly where you froze. Throw, freeze, and the top of
    // what is left is the height you earned.
    this.world.corpse(b.peakX, b.peakY - FEEL.tower.corpseH * 0.5,
                      rot, pose, this.time, this.deaths);
    this.deaths++;
    this.hitStop = FEEL.juice.hitStopDeath;
    this.phase = PHASE.DYING;
    this.emit(EV.DEATH, b.peakX, b.peakY, rot);
  }
}

export const EV = {
  LAUNCH: 0, LAND: 1, DEATH: 2, BEST: 3, BIOME: 4,
  CRUMBLE_START: 5, CRUMBLE: 6, CLOSE: 7,
};

/**
 * Simulate a launch forward and report the arc and where it first lands, using
 * THE SAME tick the game runs. Not an approximation of the physics — the
 * physics. A predicted arc computed a second way is a predicted arc that lies,
 * and an earlier build of this game shipped exactly that bug.
 *
 * Writes flat [x,y,...] into `outArc` and returns the landing solid or null.
 */
/**
 * @param {Sim} sim
 * @param {number} vx
 * @param {number} vy
 * @param {number[]} outArc flat [x, y, ...], cleared and refilled
 * @returns {Solid|null} what the launch lands on, or null if it dies
 */
export function predict(sim, vx, vy, outArc) {
  const b = sim.body;
  const p = sim._ghost;
  p.x = b.x; p.y = b.y; p.px = b.x; p.py = b.y;
  // Through the same function `_fire` will use, so a cling launch previews the
  // kick it is actually going to get.
  const v = sim.launchVelocity(b, vx, vy, sim._lv);
  p.vx = v.vx; p.vy = v.vy;
  p.takeoff = b.y;
  p.peakX = b.x; p.peakY = b.y;
  p.hangTimer = 0; p.onWall = 0; p.wallTimer = 0;
  p.grounded = false; p.standing = b.standing;
  p.t = sim.verbTime;

  outArc.length = 0;
  const peak = sim.predictPeak;
  peak.dies = false;
  const ticks = Math.ceil(FEEL.aim.arcSeconds / DT);
  for (let i = 0; i < ticks; i++) {
    const r = sim._flight(p, 0);
    if (i % FEEL.aim.arcDotEvery === 0) outArc.push(p.x, p.y);
    if (r === 'die') {
      outArc.push(p.x, p.y);
      // The same two fields `_die` hands to `world.corpse`, so the previewed
      // body and the real one are the same body. One source, again: a preview
      // of where you will land that is merely close is a preview that lies.
      peak.x = p.peakX; peak.y = p.peakY; peak.dies = true;
      return null;
    }
    if (r) {
      const rhw = solidHalfWidth(r, sim);
      const lx = clamp(p.x, r.x - rhw - FEEL.landing.forgiveness, r.x + rhw + FEEL.landing.forgiveness);
      outArc.push(lx, r.y + r.hh);
      return r;
    }
  }
  return null;
}
