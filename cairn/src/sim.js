import { FEEL, COLUMN } from './feel.js';

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
export function erosionOf(solid, sim) {
  if (!solid.corpse) return EROSION.FRESH;
  const E = FEEL.erosion;
  let age = sim.deaths - solid.bornDeath;
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
export function solidHalfWidth(solid, sim) {
  if (!solid.corpse) return solid.hw;
  const st = erosionOf(solid, sim);
  if (st === EROSION.MEMORY) return 0;
  return st === EROSION.FRESH ? solid.hw : solid.hw * 0.45;
}

// --------------------------------------------------------------------- rng

/** xorshift32. A seed is a tower, on every device and every run. */
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
function newSolid() {
  return {
    x: 0, y: 0, hw: 0, hh: 0,
    corpse: false, live: false,
    // corpse presentation state, carried here so the renderer needs no lookup
    order: 0, bornAt: 0, rot: 0, pose: 0, glow: 0,
  };
}

// Solids are bucketed by height so a collision query touches a handful of
// candidates instead of every corpse in the tower. Without this the predicted
// arc — which runs the real physics for up to two and a half seconds, several
// times per aiming frame — is O(ticks x corpses) and falls off 60 fps somewhere
// around the fortieth death, which is precisely when the game gets good.
const BUCKET = 32;

export class World {
  constructor(seed = 0x1a2b3c) {
    this.seed = seed;
    this.rng = makeRng(seed);
    this.solids = [];
    this.pool = [];
    this.buckets = new Map();
    this.builtTo = 0;
    this.lastX = COLUMN * 0.5;
    this.lastHw = 14;
    this.corpseCount = 0;
    this._q = [];
  }

  _take() {
    const s = this.pool.pop() || newSolid();
    s.live = true;
    this.solids.push(s);
    return s;
  }

  _index(s) {
    const k = Math.floor(s.y / BUCKET);
    let arr = this.buckets.get(k);
    if (!arr) { arr = []; this.buckets.set(k, arr); }
    arr.push(s);
  }

  /** Candidates whose slab may intersect [lo, hi]. Reuses one scratch array. */
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

  reset(seed = this.seed) {
    for (const s of this.solids) { s.live = false; this.pool.push(s); }
    this.solids.length = 0;
    this.buckets.clear();
    this.rng = makeRng(seed);
    this.builtTo = 0;
    this.lastX = COLUMN * 0.5;
    this.lastHw = 14;
    this.corpseCount = 0;
    this.ledge(COLUMN * 0.5, 0, FEEL.tower.baseWidth);
  }

  ledge(x, y, w) {
    const s = this._take();
    s.x = x; s.y = y; s.hw = w * 0.5; s.hh = 2.4;
    s.corpse = false;
    this._index(s);
    return s;
  }

  corpse(x, y, rot, pose, at, deathIndex = 0) {
    const s = this._take();
    s.x = x; s.y = y;
    s.hw = FEEL.tower.corpseW * 0.5;
    s.hh = FEEL.tower.corpseH * 0.5;
    s.corpse = true;
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
  regenerateAbove(y, seed) {
    const keep = [];
    for (let i = 0; i < this.solids.length; i++) {
      const s = this.solids[i];
      if (s.corpse || s.y <= y) keep.push(s);
      else { s.live = false; this.pool.push(s); }
    }
    this.solids = keep;
    this.buckets.clear();

    let top = 0, topX = COLUMN * 0.5, topHw = 15;
    for (let i = 0; i < keep.length; i++) {
      const s = keep[i];
      this._index(s);
      if (!s.corpse && s.y > top) { top = s.y; topX = s.x; topHw = s.hw; }
    }
    this.builtTo = top;
    this.lastX = topX;
    this.lastHw = topHw;
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
      const unreachable = this.rng() < over * T.overreachRate;

      const rise = unreachable
        ? lift * (T.overreachLift + this.rng() * T.overreachLiftSpan)
        : T.minRise + this.rng() * (T.maxRise - T.minRise)
          * (T.riseEase + (1 - T.riseEase) * diff);

      const room = reach - rise;
      const maxDx = room > 0 ? Math.sqrt(Math.max(0, room * room - rise * rise)) : 0;
      const usable = Math.max(4, maxDx - this.lastHw);
      const span = T.gapNear + (T.gapFar - T.gapNear) * diff;

      const width = T.maxWidth - (T.maxWidth - T.minWidth) * diff
        * (T.widthEase + (1 - T.widthEase) * this.rng());

      // An unreachable ledge stays nearly overhead, so the body left below it is
      // a step toward it rather than a body stranded out in a gap.
      const want = unreachable
        ? usable * T.overreachDrift * this.rng()
        : usable * span * (1 - T.gapJitter + this.rng() * T.gapJitter);

      const dir = this.rng() < 0.5 ? -1 : 1;
      let nx = this.lastX + want * dir;
      const lo = T.edgePad + width * 0.5;
      const hi = COLUMN - T.edgePad - width * 0.5;
      if (nx < lo || nx > hi) nx = this.lastX - want * dir;
      nx = clamp(nx, lo, hi);

      this.builtTo = h + rise;
      this.lastX = nx;
      this.lastHw = width * 0.5;
      this.ledge(nx, this.builtTo, width);
    }
  }
}

// ------------------------------------------------------------------- player

export function newBody() {
  return {
    x: COLUMN * 0.5, y: 0,
    px: COLUMN * 0.5, py: 0,     // previous tick, for render interpolation
    vx: 0, vy: 0,
    grounded: true,
    standing: null,
    onWall: 0,                   // -1 left contact, +1 right, 0 none
    wallTimer: 0,
    coyote: 0,
    takeoff: 0,
    peakX: 0, peakY: 0,
    airTime: 0,
    hangTimer: 0,
  };
}

// --------------------------------------------------------------------- game

export const PHASE = { TITLE: 0, PLAY: 1, DYING: 2, RESET: 3 };

export class Sim {
  constructor(seed) {
    this.world = new World(seed);
    this.body = newBody();
    this.phase = PHASE.TITLE;
    this.time = 0;
    this.deaths = 0;
    this.best = 0;
    this.runBest = 0;
    this.buffered = null;       // a launch queued in the air, spent on landing
    this.bufferTimer = 0;
    this.events = [];           // drained by the presentation layer each frame
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
    this.reset(true);
  }

  emit(kind, a = 0, b = 0, c = 0) { this.events.push(kind, a, b, c); }

  /** Full restart: bare rock, no history. Corpses are restored separately. */
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
  launchVelocity(b, vx, vy, out) {
    out.vx = vx;
    out.vy = vy;
    if (b.onWall !== 0 && !b.grounded) out.vx += -b.onWall * FEEL.wall.kickX * 0.35;
    return out;
  }

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
    this.buffered = null;
    this.emit(EV.LAUNCH, Math.hypot(b.vx, b.vy));
    return true;
  }

  // ------------------------------------------------------------ integration

  /** Gravity for the current instant, including the apex hang. */
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
    b.vy -= g * DT;
    if (b.vy < -FEEL.maxFallSpeed) b.vy = -FEEL.maxFallSpeed;

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
        const s = this._surfaceUnder(fromY, b.y, b.x);
        if (s) return s;
      }
      this._sides(b);
      if (b.vy < 0 && b.y < b.takeoff) return 'die';
    }
    return null;
  }

  /** One fixed tick of the whole game. */
  tick(aimDir) {
    this.time += DT;
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
  _surfaceUnder(fromY, toY, x) {
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
      const over = Math.abs(x - s.x) - (hw + half);
      if (over > FEEL.landing.forgiveness) continue;
      if (!best || top > best.y + best.hh || (over < bestSlack && top === best.y + best.hh)) {
        best = s; bestSlack = over;
      }
    }
    return best;
  }

  _land(s) {
    const b = this.body;
    const impact = Math.abs(b.vy);
    const top = s.y + s.hh;
    b.y = top;
    const lhw = solidHalfWidth(s, this);
    b.x = clamp(b.x, s.x - lhw - FEEL.landing.forgiveness, s.x + lhw + FEEL.landing.forgiveness);
    b.vy = 0;
    b.vx *= FEEL.landing.friction;
    b.grounded = true;
    b.standing = s;
    b.onWall = 0;
    b.coyote = FEEL.coyoteTime;
    if (b.y > this.runBest) this.runBest = b.y;
    if (impact > FEEL.landing.hardImpactVy) this.hitStop = FEEL.juice.hitStopLand;
    this.emit(EV.LAND, impact, b.x, b.y);
    if (this.buffered && this.bufferTimer > 0) {
      const q = this.buffered;
      this._fire(q.vx, q.vy);
    }
  }

  _wall(b, side) {
    b.onWall = side;
    b.wallTimer += DT;
    if (b.wallTimer > FEEL.wall.grabWindow && b.vy < -FEEL.wall.slideSpeed) {
      b.vy = -FEEL.wall.slideSpeed;
    }
  }

  /** Cling to the vertical face of a ledge or a corpse. */
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
      const dx = b.x - s.x;
      const hw = solidHalfWidth(s, this);
      if (hw <= 0) continue;
      const overlap = hw + half - Math.abs(dx);
      if (overlap <= 0 || overlap > half) continue;
      const side = dx > 0 ? 1 : -1;
      b.x = s.x + side * (s.hw + half);
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

export const EV = { LAUNCH: 0, LAND: 1, DEATH: 2, BEST: 3, BIOME: 4 };

/**
 * Simulate a launch forward and report the arc and where it first lands, using
 * THE SAME tick the game runs. Not an approximation of the physics — the
 * physics. A predicted arc computed a second way is a predicted arc that lies,
 * and an earlier build of this game shipped exactly that bug.
 *
 * Writes flat [x,y,...] into `outArc` and returns the landing solid or null.
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
