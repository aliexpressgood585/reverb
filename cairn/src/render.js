import { FEEL, COLUMN, BIOME_SPAN, BIOMES, biomeAt, newBiomeSlot, MEMORY_GOLD } from './feel.js';
import { landmarksIn } from './sim.js';
import { makeRng, erosionOf, EROSION } from './sim.js';

/** @typedef {import('./sim.js').Sim} Sim */
/** @typedef {import('./types.js').Solid} Solid */
/** @typedef {import('./feel.js').BiomeSlot} BiomeSlot */
/** @typedef {import('./input.js').Input} Input */
/**
 * The presentation-layer state main.js owns and the renderer reads.
 * @typedef {object} UiState
 * @property {number} squash
 * @property {number} flash
 * @property {number} bestFlash
 * @property {number} dead
 * @property {number} wash
 * @property {boolean} started
 * @property {boolean} monument
 * @property {boolean} [daily]
 * @property {number} [runLaunches] launches this attempt; the ghost's index
 */

/**
 * The scene, drawn in Canvas2D. The post chain lives in post.js; everything
 * here produces the raw image it grades.
 *
 * ART DIRECTION, in one sentence: a dark weightless void lit by a single living
 * light, which is the player. Nothing in the frame is a flat undifferentiated
 * value — the background is always a gradient, geometry brightness is always a
 * function of distance to the player, and every colour on screen comes from the
 * three-hue biome palette for the current altitude.
 *
 * The corpses are the hero visual and are treated as such: each holds the pose
 * and rotation it died in, stores its age, glows with the accent when fresh and
 * cools toward gold as it recedes into history, rim-lights when the player's
 * light passes, and is joined to the next in death order by a thread of light.
 * The tower reads as one continuous line of attempts, which is the whole game.
 *
 * Performance: no allocation in the loop. Parallax bands are point arrays
 * generated once and redrawn as paths (cheaper than tinting cached bitmaps and
 * fully dynamic across biome cross-fades). Dust and particles are pooled. The
 * background gradient is rebuilt only when the biome moves materially.
 */

const TAU = Math.PI * 2;
/** @type {(v: number, a: number, b: number) => number} */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** @type {(a: number, b: number, t: number) => number} */
const lerp = (a, b, t) => a + (b - a) * t;

/** @type {(c: number[], a: number|string) => string} */
const rgb = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/**
 * THE SILHOUETTE LANGUAGE OF EACH BIOME, in the order BIOMES declares them.
 *
 * Colour tells you which biome you are in. Shape is what stops the twelfth pass
 * through it looking like the first.
 */
const BAND_KINDS = ['spire', 'block', 'dome', 'needle', 'shard', 'facet'];

/**
 * Which biome darkness belongs to, found by NAME rather than written as 3.
 * Insert a biome one day and a hard-coded index puts the dark in the wrong
 * place with nothing to catch it; this moves with the palette.
 */
const VOID_BIOME = BIOMES.findIndex((b) => b.name === 'VOID');

/**
 * One parallax layer's outline, in a biome's own geometry.
 *
 * Returns `n + 1` points as a flat [x0, y0, x1, y1, ...] with x ascending from 0
 * to 1 and y a height fraction. EVERY KIND MUST RETURN THE SAME LENGTH for a
 * given `n`, because two of them are interpolated against each other while a
 * biome crossfades — a shape that changes its point count would have to pop.
 *
 * @param {string} kind
 * @param {number} level  0 is the furthest and tallest, 2 the nearest
 * @param {number} n      segments; the array is (n + 1) points
 * @param {() => number} rng
 * @returns {Float32Array}
 */
function bandShape(kind, level, n, rng) {
  const out = new Float32Array((n + 1) * 2);
  const amp = 0.42 - level * 0.09;
  /** @type {(i: number, y: number) => void} */
  const put = (i, y) => { out[i * 2] = i / n; out[i * 2 + 1] = clamp(y, 0.01, 0.98); };

  if (kind === 'block') {
    // SIGNAL. Stepped plateaus with vertical walls — architecture, not rock.
    // A run of points holds one height, then jumps.
    let h = 0.1 + rng() * amp;
    let hold = 0;
    for (let i = 0; i <= n; i++) {
      if (hold-- <= 0) { h = 0.06 + rng() * amp; hold = 2 + Math.floor(rng() * 3); }
      put(i, h);
    }
  } else if (kind === 'dome') {
    // BLOOM. Overlapping rounded humps — organic, swollen, no sharp corners.
    const humps = 3 + level;
    /** @type {number[][]} */
    const hs = [];
    for (let k = 0; k < humps; k++) hs.push([rng(), 0.10 + rng() * 0.22, 0.14 + rng() * amp]);
    for (let i = 0; i <= n; i++) {
      const x = i / n;
      let y = 0.05;
      for (const [cx, w, hh] of hs) {
        const d = Math.abs(x - (cx ?? 0)) / (w ?? 0.2);
        if (d < 1) y = Math.max(y, (hh ?? 0.2) * Math.cos(d * Math.PI * 0.5) ** 0.7);
      }
      put(i, y);
    }
  } else if (kind === 'needle') {
    // VOID. Mostly empty, with rare thin spikes. The emptiest biome should LOOK
    // like the emptiest biome rather than like a dark version of a busy one.
    for (let i = 0; i <= n; i++) {
      const spike = rng() < 0.13;
      put(i, spike ? 0.2 + rng() * amp * 1.5 : 0.02 + rng() * 0.05);
    }
  } else if (kind === 'shard') {
    // CINDER. Asymmetric sawtooth: a slow rise then a vertical drop. Broken.
    let h = 0.08;
    for (let i = 0; i <= n; i++) {
      h += amp * 0.34 * rng();
      if (h > amp || rng() < 0.12) { put(i, h); h = 0.04 + rng() * 0.06; continue; }
      put(i, h);
    }
  } else if (kind === 'facet') {
    // GLACIER. Long straight runs meeting at points — crystal, not noise.
    let i = 0;
    let h = 0.1 + rng() * amp;
    while (i <= n) {
      const run = 3 + Math.floor(rng() * 6);
      const to = 0.06 + rng() * amp;
      for (let k = 0; k <= run && i <= n; k++, i++) put(i, h + (to - h) * (k / run));
      h = to;
    }
  } else {
    // ASH, and the fallback. The original jagged noise, kept exactly, because it
    // is the silhouette the art direction was tuned against.
    for (let i = 0; i <= n; i++) put(i, rng() * amp + 0.05);
  }
  return out;
}

// ------------------------------------------------------------------- camera

export class Camera {
  constructor() {
    this.x = COLUMN * 0.5;
    this.y = 0;
    this.viewH = FEEL.camera.viewH;
    this.zoom = 1;
    this.rot = 0;
    this.rotVel = 0;
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.t = 0;

    // Monument view: 0 is playing, 1 is the whole lifetime tower on one screen.
    this.mon = 0;
    this.monTarget = 0;
    this.monTop = 0;        // the summit to frame, world units
  }

  /** @param {number} force 0..1 */
  kick(force) {
    const C = FEEL.camera;
    this.rotVel += (Math.random() < 0.5 ? -1 : 1) * C.impactRotDeg * clamp(force, 0, 1) * 0.06;
    this.shake = Math.min(C.shakeMax, this.shake + C.shakeMax * clamp(force, 0, 1));
  }

  /**
   * Smooth follow with velocity lookahead and a vertical dead zone, zooming out
   * as speed rises. Shake is decaying value noise rather than random jitter, so
   * it reads as a physical wobble instead of a broken television.
   */
  /**
   * @param {number} dt
   * @param {{x: number, y: number, vx: number, vy: number}} body
   * @param {boolean} reduced
   */
  update(dt, body, reduced) {
    const C = FEEL.camera;
    this.t += dt;

    const wantX = clamp(body.x + body.vx * C.lookaheadX, COLUMN * 0.5 - 22, COLUMN * 0.5 + 22);
    let wantY = body.y + body.vy * C.lookaheadY;
    if (Math.abs(wantY - this.y) < C.deadZoneY) wantY = this.y;

    this.x += (wantX - this.x) * Math.min(1, dt * C.followX);
    this.y += (wantY - this.y) * Math.min(1, dt * C.followY);

    const speed = Math.min(1, Math.abs(body.vy) / FEEL.maxFallSpeed);
    const wantZoom = 1 + (C.zoomAtSpeed - 1) * speed;
    this.zoom += (wantZoom - this.zoom) * Math.min(1, dt * C.zoomEase);
    this.viewH = C.viewH * this.zoom;

    // Rotation settles as a critically damped spring over ~300ms.
    const k = 1000 / C.impactRotDecay;
    this.rotVel -= this.rot * k * k * dt;
    this.rotVel -= this.rotVel * 2 * k * dt;
    this.rot += this.rotVel * dt;

    this.shake = Math.max(0, this.shake - this.shake * C.shakeDecay * dt);
    if (reduced) { this.shake = 0; this.rot *= 0.0; }
    const s = this.shake;
    this.shakeX = (noise1(this.t * 21.7) - 0.5) * 2 * s;
    this.shakeY = (noise1(this.t * 18.3 + 40) - 0.5) * 2 * s;

    // MONUMENT VIEW.
    //
    // Everything above is the playing camera. This blends it toward a single
    // frame holding the entire tower — every body, from the base — and takes
    // the shake and the impact roll out on the way, because the point of the
    // shot is that it is still. It is applied here rather than in main.js so
    // there is one place that decides where the camera is.
    const M = FEEL.monument;
    this.mon += (this.monTarget - this.mon) * Math.min(1, dt * M.ease);
    if (this.mon < 0.0008) { this.mon = this.monTarget < 0.5 ? 0 : this.mon; return; }

    const t = this.mon * this.mon * (3 - 2 * this.mon);       // smoothstep
    const span = Math.max(this.monTop * M.pad, M.minSpan);
    this.viewH = lerp(this.viewH, span, t);
    this.x = lerp(this.x, COLUMN * 0.5, t);
    this.y = lerp(this.y, span * M.centre, t);
    this.rot *= 1 - t;
    this.shakeX *= 1 - t;
    this.shakeY *= 1 - t;
  }
}

/** Value noise with smooth interpolation — decaying, never a random jitter. */
/**
 * @param {number} x
 * @returns {number}
 */
function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i), hash1(i + 1), u);
}
/**
 * @param {number} i
 * @returns {number}
 */
function hash1(i) {
  let h = (i | 0) * 374761393;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// -------------------------------------------------------------------- dust

const DUST = 90;

// ----------------------------------------------------------------- renderer

export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('CAIRN: no 2D context for the scene canvas');
    this.ctx = ctx;

    // The camera-to-screen transform, rebuilt by `_setup` every frame. Seeded
    // here because `strictPropertyInitialization` is right to ask: a draw that
    // ran before the first `_setup` would put every coordinate at NaN.
    this.scale = 1;
    this.originX = 0;
    this.originY = 0;
    this.w = 1; this.h = 1; this.dpr = 1;
    this.biome = newBiomeSlot();

    /*
     * PARALLAX BANDS — one silhouette LANGUAGE per biome, not one silhouette.
     *
     * This used to be three jagged polygons generated once from a fixed seed and
     * tiled forever, with only the colour changing by altitude. A player at
     * 11,045 m reported it as "the design between the stages is boring, it
     * repeats" and he was exactly right: the biome cycle is six biomes of 150 m,
     * so at 11 km he had seen the same three shapes in the same six colours
     * TWELVE times. Hue is not variety.
     *
     * Each biome now has its own geometry — spires, blocks, domes, needles,
     * shards, facets — and every layer of every biome has the same POINT COUNT so
     * the crossfade between two biomes can interpolate the silhouettes as well as
     * the colours. Shapes are still generated once at construction; what happens
     * per frame is a lerp into a preallocated scratch array, so the draw loop
     * still allocates nothing.
     */
    this.bands = [];
    for (let l = 0; l < 3; l++) {
      const n = 26 + l * 10;
      /** @type {Float32Array[]} one silhouette per biome, all the same length */
      const shapes = [];
      for (let b = 0; b < BAND_KINDS.length; b++) {
        shapes.push(bandShape(BAND_KINDS[b] ?? 'spire', l, n, makeRng(0x51ce07 + b * 7919 + l)));
      }
      this.bands.push({
        shapes,
        /** filled each frame by lerping two shapes; never reallocated */
        pts: new Float32Array((n + 1) * 2),
        n,
        par: [0.15, 0.35, 0.6][l],
        span: 260 - l * 60,
      });
    }

    // Dust, pooled and wrapped into view rather than respawned. Its own seed:
    // it used to share the bands' generator, so reshaping the bands would have
    // silently moved every dust mote as well.
    const rng = makeRng(0xd057);
    this.dust = new Float32Array(DUST * 5);   // x, y, layer, phase, size
    for (let i = 0; i < DUST; i++) {
      const o = i * 5;
      this.dust[o] = rng() * COLUMN;
      this.dust[o + 1] = rng() * 400;
      this.dust[o + 2] = 0.2 + rng() * 0.8;
      this.dust[o + 3] = rng() * TAU;
      this.dust[o + 4] = 0.25 + rng() * 0.8;
    }

    // Trail ribbon.
    this.trail = new Float32Array(FEEL.juice.trailPoints * 3); // x, y, age
    this.trailN = 0;

    // Impact rings and death particles, both pooled.
    this.rings = new Float32Array(12 * 4);    // x, y, age, force
    this.ringN = 0;
    this.parts = new Float32Array(160 * 7);   // x,y,vx,vy,age,life,seed
    this.partN = 0;

    this._bgKey = -1;
    this._bg = null;
    this._lit = [0, 0, 0];   // scratch: rock tinted by the light on it

    // MOMENTUM, eased, 0-1. The counter itself lives in the sim; this is the
    // only thing the frame is allowed to know about it, and it is deliberately
    // not a number anyone can read off the screen — it widens the light you
    // cast and lengthens the trail behind you, and that is the whole display.
    this.momentum = 0;

    /**
     * Scratch for `landmarksIn`, so the landmark pass allocates nothing.
     * @type {{y: number, x: number, kind: number, phase: number}[]}
     */
    this._marks = [];
  }

  /**
   * @param {number} w CSS px
   * @param {number} h CSS px
   * @param {number} dpr
   */
  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this._bgKey = -1;
  }

  // ------------------------------------------------------------ world → px

  /** @param {Camera} cam */
  _setup(cam) {
    const ctx = this.ctx;
    const scale = (this.h / cam.viewH);
    this.scale = scale;
    this.originX = this.w * 0.5 - cam.x * scale + cam.shakeX * scale;
    this.originY = this.h * (0.5 - FEEL.camera.playerOffsetY) + cam.y * scale + cam.shakeY * scale;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (cam.rot !== 0) {
      ctx.translate(this.w * 0.5, this.h * 0.5);
      ctx.rotate(cam.rot * Math.PI / 180);
      ctx.translate(-this.w * 0.5, -this.h * 0.5);
    }
  }

  /** @param {number} wx */
  X(wx) { return this.originX + wx * this.scale; }
  /** @param {number} wy */
  Y(wy) { return this.originY - wy * this.scale; }

  // -------------------------------------------------------------- emitters

  /**
   * @param {number} x
   * @param {number} y
   */
  pushTrail(x, y) {
    const T = FEEL.juice.trailPoints;
    for (let i = Math.min(this.trailN, T - 1); i > 0; i--) {
      this.trail[i * 3] = this.trail[(i - 1) * 3];
      this.trail[i * 3 + 1] = this.trail[(i - 1) * 3 + 1];
      this.trail[i * 3 + 2] = this.trail[(i - 1) * 3 + 2];
    }
    this.trail[0] = x; this.trail[1] = y; this.trail[2] = 0;
    this.trailN = Math.min(this.trailN + 1, T);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} force
   */
  ring(x, y, force) {
    const i = this.ringN < 12 ? this.ringN++ : 0;
    const o = i * 4;
    this.rings[o] = x; this.rings[o + 1] = y; this.rings[o + 2] = 0; this.rings[o + 3] = force;
  }

  /**
   * Death reads as crystallisation, not detonation: the shards burst outward,
   * stall, and are drawn back INTO the body as it solidifies. `life` runs 0→1
   * and the motion reverses at 0.45.
   */
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} n
   */
  burst(x, y, n) {
    for (let k = 0; k < n && this.partN < 160; k++) {
      const o = this.partN++ * 7;
      const a = (k / n) * TAU + Math.random() * 0.4;
      const sp = 18 + Math.random() * 34;
      this.parts[o] = x; this.parts[o + 1] = y;
      this.parts[o + 2] = Math.cos(a) * sp;
      this.parts[o + 3] = Math.sin(a) * sp;
      this.parts[o + 4] = 0;
      this.parts[o + 5] = 0.55 + Math.random() * 0.35;
      this.parts[o + 6] = Math.random();
    }
  }

  /**
   * @param {number} dt
   * @param {number} [momentum] 0-1 target; eased here so a reset fades rather
   *   than snaps, and so a rebuilt streak arrives as a swell.
   */
  step(dt, momentum = 0) {
    this.momentum += (momentum - this.momentum)
      * Math.min(1, dt * FEEL.momentum.ease);
    for (let i = 0; i < this.trailN; i++) this.trail[i * 3 + 2] += dt;
    for (let i = this.ringN - 1; i >= 0; i--) {
      const o = i * 4;
      this.rings[o + 2] += dt;
      if (this.rings[o + 2] > FEEL.juice.ringMs / 1000) {
        const l = --this.ringN * 4;
        for (let k = 0; k < 4; k++) this.rings[o + k] = this.rings[l + k];
      }
    }
    for (let i = this.partN - 1; i >= 0; i--) {
      const o = i * 7;
      const t = (this.parts[o + 4] += dt) / this.parts[o + 5];
      if (t >= 1) {
        const l = --this.partN * 7;
        for (let k = 0; k < 7; k++) this.parts[o + k] = this.parts[l + k];
        continue;
      }
      // Outward, then pulled home.
      const pull = t < 0.45 ? 1 : -2.4 * (t - 0.45);
      this.parts[o] += this.parts[o + 2] * dt * pull;
      this.parts[o + 1] += this.parts[o + 3] * dt * pull;
    }
  }

  // ------------------------------------------------------------------ draw

  /**
   * @param {Sim} sim
   * @param {Camera} cam
   * @param {Input|null} input
   * @param {UiState} ui
   * @param {number} dt
   * @param {boolean} reduced
   * @returns {BiomeSlot}
   */
  draw(sim, cam, input, ui, dt, reduced) {
    const ctx = this.ctx;
    const B = biomeAt(Math.max(0, sim.body.y), this.biome);
    this._setup(cam);

    this._background(ctx, B, cam);

    // MONUMENT VIEW IS A PORTRAIT, NOT A PLACE.
    //
    // Parallax ridges, light shafts, drifting dust and the enormous background
    // height all exist to give the PLAYING camera depth, and all of them are
    // sized against the view span — so at full pull-back they stop being
    // atmosphere and become clutter drawn straight across the monument. They
    // fade out with the pull-back rather than cutting, so the move still reads
    // as one gesture.
    const depth = 1 - (cam.mon || 0);
    if (depth > 0.01) {
      ctx.globalAlpha = depth;
      this._bands(ctx, B, cam);
      if (ui.started) this._bigNumber(ctx, B, Math.max(0, sim.body.ry ?? sim.body.y));
      if (!reduced) this._shafts(ctx, B, cam);
      this._dust(ctx, B, cam, dt);
      ctx.globalAlpha = 1;
    }

    // Behind the ledges, in front of the parallax. Unheld ones fade out with
    // the monument pull-back like the rest of the atmosphere — at full zoom the
    // tower is a portrait of the bodies in it and a skyline across that is
    // clutter. A HELD one stays, because it is not scenery: it is something the
    // player did that almost nobody knows is possible, and this is the image
    // they share. `_landmarks` decides per structure; `depth` goes in as a
    // parameter rather than as a globalAlpha wrapped round the whole pass.
    this._landmarks(ctx, B, cam, sim, depth);

    this._threads(ctx, B, sim);
    this._updrafts(ctx, B, sim);
    this._solids(ctx, B, sim, cam);
    // VOID's darkness falls on the WORLD, not on the player. It is drawn after
    // the geometry and before the body, the trail and the aim arc, so what it
    // takes away is knowledge of where the next ledge is — never the ability to
    // read your own launch. A biome that hides the controls is not a biome, it
    // is a bug with a name.
    if (depth > 0.01) this._dark(ctx, B, sim, depth);
    this._rings(ctx, B);
    this._parts(ctx, B);
    this._trail(ctx, B);
    this._ghostRun(ctx, B, sim, ui, dt);
    this._player(ctx, B, sim, ui);
    if (input && input.aiming) this._aim(ctx, B, input, sim);
    this._bestLine(ctx, B, sim);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return B;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Camera} _cam unused; kept so every layer has one call shape
   */
  _background(ctx, B, _cam) {
    // Never flat: a vertical gradient, rebuilt only when the biome moves enough
    // to be visible, which is a handful of times per climb.
    const key = Math.round(B.index * 100 + B.blend * 60);
    if (key !== this._bgKey) {
      this._bgKey = key;
      const g = ctx.createLinearGradient(0, 0, 0, this.h);
      g.addColorStop(0, rgb(B.bgTop, 1));
      g.addColorStop(1, rgb(B.bgBot, 1));
      this._bg = g;
    }
    if (this._bg) ctx.fillStyle = this._bg;
    ctx.fillRect(-40, -40, this.w + 80, this.h + 80);
  }

  /**
   * The height, enormous and almost invisible, behind the play. It is the only
   * number in the game that is allowed to be large, and it sits at 8% opacity
   * so it reads as an atmosphere rather than as a readout.
   */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {number} y
   */
  _bigNumber(ctx, B, y) {
    const n = Math.round(y);
    const scale = 1 + (n % 10) * 0.002;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `200 ${Math.round(this.h * 0.26 * scale)}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.fillStyle = rgb(B.rock, 0.055);
    ctx.fillText(String(n), this.w * 0.5, this.h * 0.34);
    ctx.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Camera} cam
   */
  _bands(ctx, B, cam) {
    // Silhouetted geometry, never empty, never contrasty. Each band repeats
    // vertically so the tower has depth at any height.
    //
    // TWO THINGS STOP IT REPEATING. The silhouette is the current biome's, blended
    // into the next one exactly as the colours blend — so a biome boundary is a
    // change of geometry and not only of hue. And the SCALE of that geometry
    // drifts continuously with altitude on two frequencies that do not divide
    // into each other, so the combination of colour, shape and scale has no short
    // period. Twelve passes through six biomes used to be twelve identical
    // pictures; it now takes kilometres before anything looks like itself again.
    const kinds = this.bands[0] ? this.bands[0].shapes.length : 1;
    const i0 = ((B.index % kinds) + kinds) % kinds;
    const i1 = (i0 + 1) % kinds;
    const blend = B.blend;
    const drift = 1
      + 0.42 * Math.sin(cam.y * 0.00055)
      + 0.20 * Math.sin(cam.y * 0.00017 + 1.7);

    for (let l = 0; l < this.bands.length; l++) {
      const band = this.bands[l];
      const par = band.par;
      const a = 0.11 + l * 0.075;
      const spanPx = band.span * drift * this.scale;

      // Lerp the two silhouettes into the scratch array. No allocation.
      const from = band.shapes[i0], to = band.shapes[i1], pts = band.pts;
      for (let i = 0; i < pts.length; i += 2) {
        pts[i] = from[i] ?? 0;
        pts[i + 1] = (from[i + 1] ?? 0) + ((to[i + 1] ?? 0) - (from[i + 1] ?? 0)) * blend;
      }
      const off = ((cam.y * par * this.scale) % spanPx + spanPx) % spanPx;
      for (let rep = -1; rep <= Math.ceil(this.h / spanPx) + 1; rep++) {
        const baseY = this.h - off + rep * spanPx;
        const foot = baseY + spanPx * 1.1;
        // Opacity lives in the jagged tips; the body of the band is nearly
        // empty. Filling the whole polygon evenly stacked three layers and
        // several repeats into a milky haze over the lower half of the frame.
        const g = ctx.createLinearGradient(0, baseY - spanPx * 0.46, 0, baseY + spanPx * 0.22);
        g.addColorStop(0, rgb(B.rock, a));
        g.addColorStop(0.55, rgb(B.rock, a * 0.34));
        g.addColorStop(1, rgb(B.rock, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-20, foot);
        for (let i = 0; i < pts.length; i += 2) {
          ctx.lineTo(-20 + pts[i] * (this.w + 40), baseY - pts[i + 1] * spanPx);
        }
        ctx.lineTo(this.w + 20, foot);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Camera} cam
   */
  _shafts(ctx, B, cam) {
    // Volumetric light from above, drifting. Intensity is a biome property.
    const n = 3;
    for (let i = 0; i < n; i++) {
      const t = cam.t * 0.045 + i * 2.1;
      const cx = this.w * (0.2 + 0.3 * i) + Math.sin(t) * this.w * 0.16;
      const wide = this.w * (0.18 + 0.08 * Math.sin(t * 0.7 + i));
      const g = ctx.createLinearGradient(cx, -this.h * 0.1, cx + wide * 0.4, this.h);
      g.addColorStop(0, rgb(B.accent, B.shaft * 0.20));
      g.addColorStop(0.55, rgb(B.accent, B.shaft * 0.05));
      g.addColorStop(1, rgb(B.accent, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx - wide * 0.35, -20);
      ctx.lineTo(cx + wide * 0.35, -20);
      ctx.lineTo(cx + wide, this.h + 20);
      ctx.lineTo(cx + wide * 0.28, this.h + 20);
      ctx.closePath();
      ctx.fill();
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Camera} cam
   * @param {number} dt
   */
  _dust(ctx, B, cam, dt) {
    const top = cam.y + cam.viewH * 0.7;
    const bot = cam.y - cam.viewH * 0.7;
    for (let i = 0; i < DUST; i++) {
      const o = i * 5;
      const layer = this.dust[o + 2];
      this.dust[o + 3] += dt * (0.4 + layer);
      const drift = Math.sin(this.dust[o + 3]) * 0.06;
      this.dust[o] += drift;
      this.dust[o + 1] += dt * (1.6 + layer * 3.2);

      const wy = this.dust[o + 1];
      const span = cam.viewH * 1.4;
      // Parallax by layer, then wrap into view.
      const py = bot + (((wy - bot * layer) % span) + span) % span;
      if (wy > top + span) this.dust[o + 1] = bot;

      const px = this.X(this.dust[o]);
      const py2 = this.Y(py);
      if (py2 < -20 || py2 > this.h + 20) continue;
      ctx.fillStyle = rgb(B.accent, 0.06 + layer * 0.10);
      const r = this.dust[o + 4] * layer * this.dpr * 0.9;
      ctx.fillRect(px, py2, r, r);
    }
  }

  /**
   * THE TOWER'S NOUNS.
   *
   * One structure per biome, drawn behind the ledges and in front of the
   * parallax bands, in world units so it zooms with everything else. It has no
   * collision, the generator does not know it exists, and nothing about a route
   * changes because one is here — see `landmarkOf` for why that is the whole
   * safety argument rather than an implementation detail.
   *
   * Six shapes, one per biome, each a silhouette that says what this place is
   * in the time it takes to look at it: a collapsed stair, a lattice mast, a
   * root system, a hanging chain, a furnace mouth, a frozen fall. They are
   * drawn as strokes rather than fills, because a filled mass at this size
   * competes with the ledges for the eye and the ledges have to win.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {{y: number, viewH: number}} cam
   * @param {Sim} sim
   * @param {number} depth 1 while playing, 0 at full monument pull-back
   */
  _landmarks(ctx, B, cam, sim, depth = 1) {
    const L = FEEL.landmark;
    const lo = cam.y - cam.viewH, hi = cam.y + cam.viewH;
    landmarksIn(lo, hi, sim.world.seed, this._marks);
    if (!this._marks.length) return;

    const sc = this.scale;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < this._marks.length; i++) {
      const m = this._marks[i];
      // Fade with distance so a landmark ARRIVES rather than popping in at the
      // edge of the view, and so two of them never fight at a biome border.
      const d = Math.abs(m.y - cam.y);
      const fade = clamp(1 - (d - L.spanU * 0.5) / L.fadeU, 0, 1);
      // ... and recedes again once you are inside it. Full strength at the
      // centre put the scenery on top of the corpses at exactly the distance
      // where reading their erosion stage matters most.
      const inside = clamp(1 - d / (L.spanU * 0.5), 0, 1);
      const near = fade * (1 - inside * L.insideFade);
      if (near <= 0.02) continue;
      // A HELD LANDMARK ANSWERS. One of your bodies is inside it, so it stops
      // being rock the colour of rock and takes the living accent, brighter,
      // with a light at its heart. Six of them exist and nothing anywhere says
      // so — see FEEL.landmark.heartU.
      const held = sim.claimed.has(Math.floor(m.y / BIOME_SPAN));
      // Unheld: gone by full pull-back. Held: never below `monHeld`.
      const mon = held ? Math.max(depth, L.monHeld) : depth;
      if (mon <= 0.01) continue;
      ctx.globalAlpha = (held ? L.claimAlpha : L.alpha) * near * mon;
      ctx.strokeStyle = rgb(held ? B.accent : B.rock, 1);
      ctx.lineWidth = Math.max(1, L.lineU * sc * (held ? 1.25 : 1));
      ctx.save();
      ctx.translate(this.X(m.x), this.Y(m.y));
      if (held) {
        const r = L.claimLightU * sc;
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, rgb(B.accent, 0.30 * near * mon));
        g.addColorStop(1, rgb(B.accent, 0));
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.restore();
      }
      this._landmarkPath(ctx, m, L.widthU * sc, L.spanU * sc, B);
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /**
   * One shape, centred on the origin, `w` by `h` in device pixels. Everything
   * here is a stroked path and a handful of trig — no gradients, no per-element
   * fills, no allocation — because this draws every frame underneath a scene
   * that already has a frame budget.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {{kind: number, phase: number}} m
   * @param {number} w
   * @param {number} h
   * @param {BiomeSlot} B
   */
  _landmarkPath(ctx, m, w, h, B) {
    const n = FEEL.landmark.detail;
    const hw = w * 0.5, hh = h * 0.5;
    const ph = m.phase;

    switch (m.kind) {
      // ASH — A COLLAPSED STAIR. It went somewhere once.
      //
      // The first draft drew treads as detached L-brackets scattered along a
      // diagonal and it read as debris, not as a stair. A stair is legible only
      // as ONE CONTINUOUS ZIGZAG — riser, tread, riser, tread — so this walks a
      // single polyline up and to the right, and the collapse is a real break
      // in that line with the upper flight offset sideways from the lower one.
      // The gap is the thing worth drawing; it needs the intact run either side
      // of it to be a gap at all.
      case 0: {
        const steps = n + 3;
        const gone = 2 + ((ph * 3) | 0);           // which step the flight fails at
        const rise = h / steps, run = w * 0.66 / steps;
        /**
         * @param {number} from @param {number} to
         * @param {number} x0 @param {number} y0
         */
        const flight = (from, to, x0, y0) => {
          ctx.beginPath();
          let x = x0, y = y0;
          ctx.moveTo(x, y);
          for (let i = from; i < to; i++) {
            y -= rise;  ctx.lineTo(x, y);          // riser
            x += run;   ctx.lineTo(x, y);          // tread
          }
          ctx.stroke();
          return { x, y };
        };
        const lower = flight(0, gone, -hw * 0.72, hh);
        // The upper flight survived, out of line with what used to carry it.
        const upX = lower.x + run * 2.6, upY = lower.y - rise * 2.2;
        flight(gone + 1, steps, upX, upY);
        // The stringer that used to run under the whole thing, snapped.
        ctx.beginPath();
        ctx.moveTo(-hw * 0.72, hh);
        ctx.lineTo(lower.x, lower.y + rise * 0.9);
        ctx.moveTo(upX, upY + rise * 0.9);
        ctx.lineTo(upX + run * (steps - gone), upY - rise * (steps - gone) + rise);
        ctx.stroke();
        break;
      }

      // SIGNAL — A LATTICE MAST, still lit.
      case 1: {
        /** @param {number} t */
        const taper = (t) => hw * 0.30 * (1 - t * 0.72);
        ctx.beginPath();
        ctx.moveTo(-taper(0), hh); ctx.lineTo(-taper(1), -hh);
        ctx.moveTo(taper(0), hh); ctx.lineTo(taper(1), -hh);
        for (let i = 0; i <= n; i++) {
          const t = i / n, y = hh - t * h, a = taper(t);
          ctx.moveTo(-a, y); ctx.lineTo(a, y);
          if (i < n) {
            const t2 = (i + 1) / n, y2 = hh - t2 * h, a2 = taper(t2);
            ctx.moveTo(-a, y); ctx.lineTo(a2, y2);
          }
        }
        // Guy-wires to the ground, which is what makes it read as a mast and
        // not as a ladder.
        ctx.moveTo(-taper(0.72), hh - h * 0.72); ctx.lineTo(-hw, hh);
        ctx.moveTo(taper(0.72), hh - h * 0.72); ctx.lineTo(hw, hh);
        ctx.stroke();
        // The lamp. The one filled thing in any of these shapes, because a
        // light at the top of a mast is the whole reason a mast is drawn.
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgb(B.accent, 0.5);
        ctx.beginPath();
        ctx.arc(0, -hh, Math.max(1.5, w * 0.018), 0, TAU);
        ctx.fill();
        ctx.restore();
        break;
      }

      // BLOOM — A ROOT SYSTEM. It has to come FROM somewhere.
      //
      // The first draft drew parallel strands from edge to edge and they read as
      // cables. Roots read as roots when they converge to a single mass at the
      // top and divide on the way down, so this draws a trunk, splits it, and
      // splits the splits.
      case 2: {
        ctx.beginPath();
        ctx.moveTo(0, -hh);
        ctx.lineTo(0, -hh + h * 0.18);
        const forks = Math.max(3, (n / 2) | 0);
        for (let i = 0; i < forks; i++) {
          const t = forks === 1 ? 0.5 : i / (forks - 1);
          const spread = (t - 0.5) * w * 0.92;
          const wob = Math.sin((t + ph) * 7.0) * w * 0.07;
          // trunk -> primary
          ctx.moveTo(0, -hh + h * 0.18);
          ctx.bezierCurveTo(spread * 0.25 + wob, -hh + h * 0.42,
                            spread * 0.80 - wob, hh - h * 0.30,
                            spread, hh);
          // primary -> a fine root that leaves it half way down
          const bx = spread * 0.62, by = hh - h * 0.46;
          ctx.moveTo(bx, by);
          ctx.quadraticCurveTo(bx + wob * 1.6, by + h * 0.20,
                               bx + (t < 0.5 ? -1 : 1) * w * 0.14, hh - h * 0.06);
        }
        ctx.stroke();
        break;
      }

      // VOID — A CHAIN, and whatever it is holding is out of sight.
      case 3: {
        const link = h / (n * 2);
        ctx.beginPath();
        for (let i = 0; i < n * 2; i++) {
          const y = -hh + i * link;
          const sway = Math.sin((i * 0.5 + ph * 6)) * w * 0.05;
          ctx.ellipse(sway, y + link * 0.5, w * 0.045, link * 0.52,
                      0, 0, TAU);
        }
        ctx.stroke();
        // The ring it ends in.
        ctx.beginPath();
        ctx.arc(Math.sin((n + ph * 6)) * w * 0.05, hh, w * 0.10, 0, TAU);
        ctx.stroke();
        break;
      }

      // CINDER — A FURNACE MOUTH.
      case 4: {
        ctx.beginPath();
        ctx.moveTo(-hw * 0.8, hh);
        ctx.lineTo(-hw * 0.8, hh - h * 0.28);
        ctx.quadraticCurveTo(0, -hh, hw * 0.8, hh - h * 0.28);
        ctx.lineTo(hw * 0.8, hh);
        ctx.stroke();
        // Courses of brick, kept strictly INSIDE the arch so they read as
        // masonry rather than as scanlines laid across the screen — which is
        // exactly how they read while the shape was wider than the glass.
        ctx.beginPath();
        for (let i = 1; i < n; i++) {
          const t = i / n;
          const y = hh - t * h * 0.72;
          const spanX = hw * 0.78 * Math.sqrt(Math.max(0, 1 - t * t * 0.94));
          if (spanX < w * 0.04) continue;
          ctx.moveTo(-spanX, y); ctx.lineTo(spanX, y);
          // A perpend every other course, so the courses are bricks and not
          // stripes.
          if (i % 2 === 0) {
            const px2 = spanX * 0.45;
            ctx.moveTo(-px2, y); ctx.lineTo(-px2, y + h * 0.72 / n);
            ctx.moveTo(px2, y); ctx.lineTo(px2, y + h * 0.72 / n);
          }
        }
        ctx.stroke();
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgb(B.accent, 0.16);
        ctx.beginPath();
        ctx.moveTo(-hw * 0.62, hh);
        ctx.quadraticCurveTo(0, -hh * 0.55, hw * 0.62, hh);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }

      // GLACIER — A FROZEN FALL, mid-pour.
      //
      // Stroked lines of constant weight read as pipes. Ice reads as ice when it
      // TAPERS, so each column is a filled triangle from the lip down to a
      // point, with the strokes kept only for the lip it poured over.
      default: {
        ctx.save();
        ctx.fillStyle = ctx.strokeStyle;
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          const x = (t - 0.5) * w * 0.92;
          const len = h * (0.35 + 0.65 * Math.abs(Math.sin((t + ph) * 5.1)));
          const halfW = w * 0.030 * (0.5 + Math.abs(Math.sin((t + ph * 2) * 3.3)));
          const lean = Math.sin((t + ph) * 3.0) * w * 0.02;
          ctx.beginPath();
          ctx.moveTo(x - halfW, -hh);
          ctx.lineTo(x + halfW, -hh);
          ctx.lineTo(x + lean, -hh + len);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        // The lip it poured over, and the shelf behind it.
        ctx.beginPath();
        ctx.moveTo(-hw * 0.98, -hh);
        ctx.lineTo(hw * 0.98, -hh);
        ctx.moveTo(-hw * 0.72, -hh - h * 0.06);
        ctx.lineTo(hw * 0.72, -hh - h * 0.06);
        ctx.stroke();
        break;
      }
    }
  }

  /**
   * The thread of light joining each corpse to the next in death order. It is
   * what makes a hundred separate failures read as one continuous history, and
   * it fades in as the camera pulls back so it never competes with the jump you
   * are about to make.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} _B unused; the thread is always memory-gold
   * @param {Sim} sim
   */
  _threads(ctx, _B, sim) {
    const solids = sim.world.solids;
    const strength = clamp((this.scale > 0 ? 1 : 0) * (1 - (FEEL.camera.viewH / (this.h / this.scale))), 0, 1);
    const a = 0.05 + strength * 0.12;
    if (a <= 0.01) return;
    ctx.strokeStyle = rgb(MEMORY_GOLD, a);
    ctx.lineWidth = 1;
    ctx.beginPath();
    let prev = null;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!s.corpse) continue;
      const x = this.X(s.x), y = this.Y(s.y);
      if (y < -80 || y > this.h + 80) { prev = s; continue; }
      if (prev && prev.corpse) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      prev = s;
    }
    ctx.stroke();
  }

  /**
   * Ledges and corpses. Brightness is a function of distance to the player —
   * the lighting pass — so the single living light in the scene is you, and
   * geometry emerges from the dark as you approach it.
   */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Sim} sim
   * @param {Camera} _cam unused; culling is done against `this.h`
   */
  _solids(ctx, B, sim, _cam) {
    const solids = sim.world.solids;
    const bx = sim.body.rx ?? sim.body.x;
    const by = sim.body.ry ?? sim.body.y;
    const total = Math.max(1, sim.world.corpseCount);
    const reach = 78;

    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      const sy = this.Y(s.y);
      if (sy < -120 || sy > this.h + 120) continue;       // frustum cull
      const sx = this.X(s.x);
      const d = Math.hypot(s.x - bx, s.y - by);
      const lit = clamp(1 - d / reach, 0, 1);

      // A crumbling hold whose clock has started. 0 until the warning window,
      // then a flicker that quickens. Time is encoded in BRIGHTNESS, because
      // width is reserved for saying what the collision is.
      let urgent = 0;
      if (s.crumble && s.crumbleAt > 0) {
        const left = (s.crumbleAt - sim.verbTime) * 1000;
        const warn = FEEL.verbs.crumbleWarnMs;
        if (left < warn) {
          const k = clamp(1 - left / warn, 0, 1);
          urgent = k * (0.55 + 0.45 * Math.sin(sim.verbTime * (14 + k * 40)));
        }
      }

      if (!s.corpse && s.hw <= 0 && s.baseHw > 0) {
        // A hold that has already given way. It is drawn, and it is not a
        // platform — the same sentence MEMORY says about an old corpse, in the
        // same visual language: an outline with nothing inside it. Without this
        // a crumbling ledge does not give way, it teleports out of the world,
        // and the player learns nothing from having stood on one.
        const w = s.baseHw * 2 * this.scale;
        const top = sy - s.hh * this.scale;
        ctx.strokeStyle = rgb(B.rock, 0.10 + lit * 0.10);
        ctx.lineWidth = Math.max(0.7, this.dpr * 0.7);
        ctx.setLineDash([3 * this.dpr, 4 * this.dpr]);
        ctx.strokeRect(sx - w * 0.5, top, w, s.hh * 2 * this.scale);
        ctx.setLineDash([]);
        continue;
      }

      if (!s.corpse) {
        // Rock, pulled toward the accent by how lit it is. Geometry in this
        // game is never its own colour in isolation — it is always somewhere
        // between the rock hue and the light falling on it, which is what keeps
        // it off neutral.
        const rr = lerp(B.rock[0], B.accent[0], lit * 0.30);
        const rg = lerp(B.rock[1], B.accent[1], lit * 0.30);
        const rb = lerp(B.rock[2], B.accent[2], lit * 0.30);
        this._lit[0] = rr; this._lit[1] = rg; this._lit[2] = rb;
        const w = s.hw * 2 * this.scale;
        const h = s.hh * 2 * this.scale;
        const top = sy - s.hh * this.scale;
        // Body: a dark slab that never reaches flat — a vertical gradient from
        // the lit crest down into the background colour.
        const skirt = h * 1.35;
        const g = ctx.createLinearGradient(0, top, 0, top + skirt);
        g.addColorStop(0, rgb(this._lit, 0.22 + lit * 0.36));
        g.addColorStop(0.35, rgb(this._lit, 0.07 + lit * 0.11));
        g.addColorStop(1, rgb(this._lit, 0));
        ctx.fillStyle = g;
        ctx.fillRect(sx - w * 0.5, top, w, skirt);
        // Crest: the lit edge, and the only thing you actually aim at.
        ctx.fillStyle = rgb(B.accent, 0.16 + lit * 0.70);
        ctx.fillRect(sx - w * 0.5, top, w, Math.max(1, 1.5 * this.dpr));
        // A short bloom-catching bar on the crest, so the landing line reads
        // even when the player's light is nowhere near it.
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgb(B.accent, 0.05 + lit * 0.22 + urgent * 0.55);
        ctx.fillRect(sx - w * 0.5, top - 1.5 * this.dpr, w, 3 * this.dpr);
        ctx.globalCompositeOperation = 'source-over';

        if (s.crumble) {
          // ASH: this one gives way.
          //
          // THE FIRST VERSION OF THIS DREW BLACK CRACKS ACROSS THE SLAB, AND
          // THE SLAB IS ALREADY BLACK. A screenshot settled it in one look: the
          // only part of a ledge you can actually see is the lit crest, so the
          // tell has to live there. Broken teeth hanging off the crest, in the
          // accent, which is the one colour that reads against this background.
          //
          // The WIDTH of the crest is never touched — by this or by `urgent`.
          // The corpse shelf obeys the same rule: colour and brightness say what
          // state a surface is in, width says what the collision is, and a hold
          // drawn narrower than it catches is the one lie this art direction is
          // not allowed to tell.
          ctx.fillStyle = rgb(B.accent, 0.22 + lit * 0.30 + urgent * 0.4);
          const teeth = 5;
          for (let k = 0; k < teeth; k++) {
            const f = (k + 0.5) / teeth - 0.5;
            const drop = h * (0.5 + ((k * 7) % 5) * 0.28);
            ctx.fillRect(sx + w * f - this.dpr * 0.6, top,
              Math.max(1, this.dpr * 1.2), drop);
          }
        }
        if (s.drift > 0) {
          // BLOOM: the track it travels, end to end, as a dashed rail. Dashed
          // so it cannot be mistaken for a ledge, and bright enough to be seen —
          // the first version was 0.05 alpha and did not survive a screenshot.
          // Without it a drifting ledge is a moving target with no way to know
          // where it will be; with it, the whole path is something you can aim
          // at while it is still somewhere else.
          const t0 = this.X(s.baseX - s.drift) - w * 0.5;
          const t1 = this.X(s.baseX + s.drift) + w * 0.5;
          ctx.strokeStyle = rgb(B.accent, 0.16 + lit * 0.20);
          ctx.lineWidth = Math.max(1, this.dpr);
          ctx.setLineDash([2.5 * this.dpr, 3.5 * this.dpr]);
          ctx.beginPath();
          ctx.moveTo(t0, top - 3 * this.dpr);
          ctx.lineTo(t1, top - 3 * this.dpr);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        continue;
      }

      // A corpse. Two independent things are being said at once:
      //   COLOUR says how long ago this was you — accent when fresh, cooling to
      //          gold as it recedes into history.
      //   FORM says whether it will still hold your weight — full, narrowed and
      //          cracked, a bare shelf, or an outline you will fall straight
      //          through.
      // The player learns the erosion rule by looking, never by being told.
      const st = erosionOf(s, sim);
      const age = total > 1 ? 1 - s.order / (total - 1) : 0;
      const cool = clamp(age * 1.15, 0, 1);
      const cr = lerp(B.accent[0], MEMORY_GOLD[0], cool);
      const cg = lerp(B.accent[1], MEMORY_GOLD[1], cool);
      const cb = lerp(B.accent[2], MEMORY_GOLD[2], cool);
      s.glow = Math.max(0, s.glow - 0.02);
      const rimlight = lit * 0.75 + s.glow * 0.4;

      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(s.rot);

      if (st === EROSION.MEMORY) {
        // Present, permanently. Load-bearing, never again. Pure gold outline,
        // no fill at all — the read is "this is a picture, not a place".
        ctx.strokeStyle = rgb(MEMORY_GOLD, 0.20 + lit * 0.16);
        ctx.lineWidth = Math.max(0.7, this.dpr * 0.7);
        this._figurePath(ctx, s.hw * this.scale, s.hh * this.scale, s.pose);
        ctx.stroke();
      } else {
        const narrow = st === EROSION.FRESH ? 1 : 0.45;
        // FRESH AND THIN WERE NEARLY THE SAME BRIGHTNESS.
        //
        // Solidity used to run 1 / 0.66 / 0.34, and once `rimlight` is up — which
        // it is whenever the player's light is anywhere near — a FRESH fill and a
        // THIN fill land within a tenth of each other. Acceptance test 13 was
        // passing on a margin of 4.2 against a threshold of 3, which is not a
        // pass, it is a coin landing on its edge. An external reviewer had already
        // said it in words: "it is not clear which bodies still hold weight".
        // The spread is wider now, and it is widest on the shelf bar below,
        // because the shelf IS the hitbox.
        const solidity = st === EROSION.FRESH ? 1 : st === EROSION.THIN ? 0.5 : 0.24;
        const fill = `rgba(${cr | 0},${cg | 0},${cb | 0},${(0.10 + solidity * (0.22 + rimlight * 0.5)).toFixed(3)})`;
        const rim = `rgba(${cr | 0},${cg | 0},${cb | 0},${(0.08 + solidity * (0.16 + rimlight * 0.8)).toFixed(3)})`;
        const hwPx = s.hw * this.scale * narrow;
        const hhPx = s.hh * this.scale;

        this._figurePath(ctx, hwPx, hhPx, s.pose);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = rim;
        ctx.lineWidth = Math.max(0.8, this.dpr * (st === EROSION.TOP ? 0.6 : 0.9));
        ctx.stroke();

        // The load-bearing surface, drawn as a bright bar exactly as wide as the
        // collision actually is. Fresh corpses get a full shelf; eroded ones a
        // visibly shorter one. This is the tell that reads fastest.
        ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${(0.16 + solidity * 0.80).toFixed(3)})`;
        ctx.fillRect(-hwPx, -hhPx, hwPx * 2,
                     Math.max(1, (st === EROSION.FRESH ? 2.1 : 1.2) * this.dpr));

        if (st === EROSION.THIN) {
          // Cracks. Three hairlines through the body, seeded off the pose so a
          // given corpse always cracks the same way.
          ctx.strokeStyle = `rgba(0,0,0,0.55)`;
          ctx.lineWidth = Math.max(0.7, this.dpr * 0.6);
          for (let k = 0; k < 3; k++) {
            const t = -0.5 + (k + (s.pose & 3) * 0.17) * 0.42;
            ctx.beginPath();
            ctx.moveTo(-hwPx, hhPx * t);
            ctx.lineTo(hwPx * 0.4, hhPx * (t + 0.22));
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }
  }

  /**
   * SIGNAL's rising air.
   *
   * Drawn exactly `verbs.updraftW` wide and `verbs.updraftH` tall, because those
   * are the numbers the physics tests — a column you can see the edge of is a
   * column you can aim into, and one drawn wider than it lifts is a trap.
   *
   * The streaks exist for one reason: a glow says "something here", and only
   * motion says WHICH WAY. Their positions come from `sim.verbTime`, so nothing
   * is stored and nothing allocates.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Sim} sim
   */
  _updrafts(ctx, B, sim) {
    const V = FEEL.verbs;
    const solids = sim.world.solids;
    const t = sim.verbTime;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!s.updraft) continue;
      const top = s.y + s.hh;
      const y0 = this.Y(top);
      const y1 = this.Y(top + V.updraftH);
      if (y1 > this.h + 80 || y0 < -80) continue;
      const x = this.X(s.x);
      const w = V.updraftW * this.scale;

      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, rgb(B.accent, 0.13));
      g.addColorStop(0.55, rgb(B.accent, 0.05));
      g.addColorStop(1, rgb(B.accent, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - w, y1, w * 2, y0 - y1);

      // The two edges, so the column has a boundary you can be outside of.
      ctx.fillStyle = rgb(B.accent, 0.10);
      ctx.fillRect(x - w, y1, Math.max(1, this.dpr * 0.8), y0 - y1);
      ctx.fillRect(x + w - Math.max(1, this.dpr * 0.8), y1, Math.max(1, this.dpr * 0.8), y0 - y1);

      // RISING SPARKS, NOT RISING BARS.
      //
      // The first version drew horizontal streaks across the column, and a
      // screenshot said what was wrong with them immediately: a bright
      // horizontal line is exactly what a landing crest looks like in this
      // game. Every mote was a ledge you might try to aim at. Short VERTICAL
      // strokes cannot be mistaken for a surface, and they say "up" on their
      // own without needing the animation to be watched.
      const span = y0 - y1;
      const len = Math.max(2, span * 0.055);
      for (let k = 0; k < 7; k++) {
        const f = (t * 0.42 + k * 0.1428) % 1;
        const sy = y0 - span * f;
        const off = ((k * 37) % 100) / 100 - 0.5;      // fixed lanes, not random
        const a = 0.30 * (1 - f) * (f < 0.15 ? f / 0.15 : 1);
        ctx.fillStyle = rgb(B.accent, a);
        ctx.fillRect(x + off * w * 1.7, sy - len, Math.max(1, this.dpr), len);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * VOID's darkness: you see what your own light reaches, and no further.
   *
   * One radial wipe centred on the body. `verbs.darkFloor` is how much of the
   * biome survives at the edge of the screen — never zero, because a black
   * rectangle is not a biome, and a player who cannot see the shape of the
   * tower cannot tell a hard gap from a bug.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Sim} sim
   * @param {number} depth 1 while playing, 0 at full monument pull-back
   */
  _dark(ctx, B, sim, depth) {
    // How much of the current cross-fade is VOID. Reading it off the blend
    // rather than off the name means the darkness arrives and leaves with the
    // colour, over the same 20 m, instead of snapping at the boundary.
    const a = B.index % BIOMES.length, b = (B.index + 1) % BIOMES.length;
    const voidness = (a === VOID_BIOME ? 1 - B.blend : 0) + (b === VOID_BIOME ? B.blend : 0);
    if (voidness <= 0.001) return;

    const k = voidness * depth * (1 - FEEL.verbs.darkFloor);
    const px = this.X(sim.body.rx ?? sim.body.x);
    const py = this.Y(sim.body.ry ?? sim.body.y);
    // The lit radius is generous — the point is that the NEXT ledge is unknown,
    // not that this one is.
    const r = this.h * 0.62;
    const g = ctx.createRadialGradient(px, py, r * 0.22, px, py, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.55, `rgba(0,0,0,${(k * 0.45).toFixed(3)})`);
    g.addColorStop(1, `rgba(0,0,0,${k.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(-40, -40, this.w + 80, this.h + 80);
  }

  /**
   * A frozen silhouette. Four poses, chosen at the moment of death and kept
   * forever, so no two corpses in the tower are the same shape.
   */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} hw
   * @param {number} hh
   * @param {number} pose
   */
  _figurePath(ctx, hw, hh, pose) {
    const w = hw * 2;
    ctx.beginPath();
    const tilt = [0, 0.22, -0.18, 0.34][pose & 3];
    ctx.moveTo(-hw * 0.55, hh);
    ctx.lineTo(hw * 0.55 + tilt * w, hh * 0.55);
    ctx.lineTo(hw * 0.75, -hh * 0.1);
    ctx.lineTo(hw * 0.30 - tilt * w, -hh);
    ctx.lineTo(-hw * 0.35, -hh * 0.86);
    ctx.lineTo(-hw * 0.80, hh * 0.1);
    ctx.closePath();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   */
  _rings(ctx, B) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.ringN; i++) {
      const o = i * 4;
      const t = this.rings[o + 2] / (FEEL.juice.ringMs / 1000);
      const r = (4 + t * 26 * (0.5 + this.rings[o + 3])) * this.scale;
      ctx.strokeStyle = rgb(B.accent, (1 - t) * 0.5);
      ctx.lineWidth = Math.max(1, (1 - t) * 2.4 * this.dpr);
      ctx.beginPath();
      ctx.ellipse(this.X(this.rings[o]), this.Y(this.rings[o + 1]), r, r * 0.35, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   */
  _parts(ctx, B) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.partN; i++) {
      const o = i * 7;
      const t = this.parts[o + 4] / this.parts[o + 5];
      const a = (1 - t) * 0.85;
      const s = (0.5 + this.parts[o + 6] * 1.3) * this.scale * (1 - t * 0.4);
      ctx.fillStyle = rgb(B.accent, a);
      ctx.fillRect(this.X(this.parts[o]) - s * 0.5, this.Y(this.parts[o + 1]) - s * 0.5, s, s);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   */
  _trail(ctx, B) {
    if (this.trailN < 2) return;
    const life = (FEEL.juice.trailMs / 1000)
      * (1 + FEEL.momentum.trailGain * this.momentum);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.trailN - 1; i++) {
      const a0 = this.trail[i * 3 + 2];
      if (a0 > life) break;
      const f = 1 - a0 / life;
      ctx.strokeStyle = rgb(B.accent, f * 0.5);
      ctx.lineWidth = Math.max(0.6, f * 3.4 * this.dpr);
      ctx.beginPath();
      ctx.moveTo(this.X(this.trail[i * 3]), this.Y(this.trail[i * 3 + 1]));
      ctx.lineTo(this.X(this.trail[(i + 1) * 3]), this.Y(this.trail[(i + 1) * 3 + 1]));
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * YOUR BEST RUN, STANDING WHERE IT STOOD AT THIS LAUNCH NUMBER.
   *
   * Not a clock race — see DECISIONS §33. It steps forward when YOU launch, so
   * the read is "at your seventh jump, your best self was here", which compares
   * climbing rather than deliberation and cannot punish a player for thinking.
   *
   * Drawn in memory-gold, hollow, and smaller than you: it must never for a
   * moment be mistaken for the shard the player is steering. The path it took
   * to get here trails behind it, which is what makes it read as a run rather
   * than as a marker.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} _B unused; a ghost is always memory-gold
   * @param {Sim} sim
   * @param {UiState} ui
   * @param {number} dt
   */
  _ghostRun(ctx, _B, sim, ui, dt) {
    const G = FEEL.ghost;
    const p = sim.ghostPath;
    if (!ui.started || p.length < 4) return;

    // Its launch index is yours, clamped to how far it ever got. Standing on
    // its own last position after it has run out is exactly right: that is
    // where it died, and it is the frontier.
    const n = p.length >> 1;
    const i = Math.min((ui.runLaunches ?? 0) | 0, n - 1);
    const tx = p[i * 2], ty = p[i * 2 + 1];

    // Eased, so it steps between perches instead of teleporting.
    let at = this._ghostAt;
    if (!at) { at = this._ghostAt = [tx, ty]; }
    const k = Math.min(1, dt * G.ease);
    at[0] += (tx - at[0]) * k;
    at[1] += (ty - at[1]) * k;
    const gx = at[0], gy = at[1];

    // Off screen by more than a fade's worth: nothing to draw.
    const sy = this.Y(gy);
    if (sy < -G.fadeU * this.scale || sy > this.h + G.fadeU * this.scale) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // The path it took to get here.
    ctx.strokeStyle = rgb(MEMORY_GOLD, G.alpha * 0.5);
    ctx.lineWidth = Math.max(1, 1.1 * this.dpr);
    ctx.beginPath();
    let started = false;
    for (let j = i; j >= 0; j--) {
      const px = p[j * 2], py = p[j * 2 + 1];
      if (gy - py > G.trailU) break;
      if (!started) { ctx.moveTo(this.X(gx), this.Y(gy)); started = true; }
      ctx.lineTo(this.X(px), this.Y(py));
    }
    if (started) ctx.stroke();

    // The runner: hollow, and two thirds your size.
    const hw = FEEL.body.w * 0.34 * this.scale;
    const hh = FEEL.body.h * 0.34 * this.scale;
    ctx.translate(this.X(gx), this.Y(gy) - hh);
    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.lineTo(hw, 0);
    ctx.lineTo(0, hh);
    ctx.lineTo(-hw, 0);
    ctx.closePath();
    ctx.strokeStyle = rgb(MEMORY_GOLD, G.alpha * 2.2);
    ctx.lineWidth = Math.max(1, 1.2 * this.dpr);
    ctx.stroke();
    ctx.fillStyle = rgb(MEMORY_GOLD, G.alpha * 0.45);
    ctx.fill();
    ctx.restore();
  }

  /**
   * You. Not a box: a small emissive shard that carries the only real light in
   * the scene, squashing and stretching along its velocity with a spring return.
   */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Sim} sim
   * @param {UiState} ui
   */
  _player(ctx, B, sim, ui) {
    const b = sim.body;
    const x = this.X(b.rx ?? b.x), y = this.Y((b.ry ?? b.y) + FEEL.body.h * 0.5);
    const hw = FEEL.body.w * 0.5 * this.scale;
    const hh = FEEL.body.h * 0.5 * this.scale;

    // The light it casts. A clean streak widens it and lifts the core — the
    // only place momentum is ever visible, and it reads as the tower getting
    // brighter around you rather than as a score going up.
    const M = this.momentum;
    const R = 66 * this.scale * (1 + FEEL.momentum.lightGain * M);
    const lift = 1 + FEEL.momentum.lightAlpha * M;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, rgb(B.accent, 0.34 * lift));
    g.addColorStop(0.14, rgb(B.accent, 0.15 * lift));
    g.addColorStop(0.42, rgb(B.accent, 0.045 * lift));
    g.addColorStop(1, rgb(B.accent, 0));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(x - R, y - R, R * 2, R * 2);
    ctx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(clamp(-b.vx * 0.0016, -0.45, 0.45));
    const sx = 1 - ui.squash, sy = 1 + ui.squash;
    ctx.scale(sx, sy);

    ctx.fillStyle = rgb([255, 255, 255], 0.96);
    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.lineTo(hw, 0);
    ctx.lineTo(0, hh);
    ctx.lineTo(-hw, 0);
    ctx.closePath();
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgb(B.accent, 0.5);
    ctx.beginPath();
    ctx.moveTo(0, -hh * 0.55);
    ctx.lineTo(hw * 0.5, 0);
    ctx.lineTo(0, hh * 0.55);
    ctx.lineTo(-hw * 0.5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
  }

  /**
   * The aim: the exact arc the physics will take, crisp for the first stretch
   * and dissolving after, plus a reticle at the predicted first contact. The
   * reticle takes the accent colour on a safe surface and dims on nothing.
   */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Input} input
   * @param {Sim} sim
   */
  _aim(ctx, B, input, sim) {
    const arc = input.arc;
    const n = arc.length >> 1;
    if (n < 2) return;
    const crisp = Math.max(1, Math.floor(n * FEEL.aim.arcCrisp));

    for (let i = 0; i < n; i++) {
      const x = this.X(arc[i * 2]);
      const y = this.Y(arc[i * 2 + 1]);
      const fade = i < crisp ? 1 : clamp(1 - (i - crisp) / (n - crisp + 1e-6), 0, 1);
      if (fade <= 0.02) continue;
      const r = (1.5 + 1.4 * fade) * this.dpr;
      ctx.fillStyle = rgb(B.accent, 0.20 + fade * 0.55);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }

    const lx = this.X(arc[(n - 1) * 2]);
    const ly = this.Y(arc[(n - 1) * 2 + 1]);
    const safe = !!input.landing;
    const col = safe ? B.accent : [120, 128, 140];
    ctx.strokeStyle = rgb(col, safe ? 0.9 : 0.32);
    ctx.lineWidth = Math.max(1, 1.4 * this.dpr);
    const R = (safe ? 9 : 6) * this.dpr;
    ctx.beginPath(); ctx.arc(lx, ly, R, 0, TAU); ctx.stroke();
    if (safe) {
      ctx.beginPath();
      ctx.moveTo(lx - R * 1.7, ly); ctx.lineTo(lx - R * 0.6, ly);
      ctx.moveTo(lx + R * 0.6, ly); ctx.lineTo(lx + R * 1.7, ly);
      ctx.stroke();
      return;
    }

    // THE BODY YOU WOULD LEAVE.
    //
    // This launch does not land. Drawn at the apex, in the gold of memory and
    // in the same silhouette every corpse in the tower is drawn with, is the
    // shape you are about to become — at the exact spot `_die` will put it,
    // because `predict` reports the same two fields `_die` reads.
    //
    // Some gaps in this tower cannot be crossed at all; that is deliberate and
    // it is the point of the game. But the bot only knows a gap is impossible
    // because it can run the physics nine times, and a player has one arc
    // following their thumb. Without this, an uncrossable gap is
    // indistinguishable from a badly aimed jump, and the mechanic the whole
    // design rests on reads as the game being unfair. With it, the question
    // stops being "can I make this" and becomes "where do I want my body",
    // which is a decision instead of a punishment.
    const pk = sim.predictPeak;
    if (!pk.dies) return;

    // GOLD IS A BODY. THE ACCENT IS A PLAN.
    //
    // Gold is the colour of memory everywhere in this game — old corpses, the
    // thread between them, the monument. A prospective corpse drawn in gold
    // says "you will die here" and nothing else, which is what every ghost said
    // for as long as the ghost existed. When `sim.gainsFrom` finds that this
    // body would put a ledge in reach that this perch cannot reach, the
    // silhouette switches to the LIVING accent — the colour of the player, the
    // arc and the light — and the ledge it buys takes a ring.
    //
    // That is the entire difference between throwing yourself away and spending
    // yourself, said in a colour, with no text anywhere near it.
    const gain = pk.gains;
    const A = FEEL.aim;
    const ghostCol = gain ? B.accent : MEMORY_GOLD;
    const a = gain ? A.ghostGainAlpha : A.ghostAlpha;

    if (gain) {
      const r = A.gainRingU * this.scale;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgb(B.accent, A.gainRingAlpha);
      ctx.lineWidth = Math.max(1, 1.2 * this.dpr);
      ctx.beginPath();
      ctx.arc(this.X(sim.driftXAt(gain, sim.verbTime)), this.Y(gain.y + gain.hh),
              r, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(this.X(pk.x), this.Y(pk.y));
    this._figurePath(ctx, FEEL.tower.corpseW * 0.5 * this.scale,
                     FEEL.tower.corpseH * 0.5 * this.scale, 0);
    ctx.fillStyle = rgb(ghostCol, a * 0.30);
    ctx.fill();
    ctx.strokeStyle = rgb(ghostCol, a);
    // Solid, not dashed. A body is 5.2 x 6.0 u — about fifteen CSS pixels tall
    // on a phone — and a dash pattern at that size breaks the silhouette into a
    // dotted blob that reads as a marker rather than as a person. The SIZE is
    // left honest: this is exactly how much room the corpse will take up, and
    // that is the thing the player is deciding about.
    ctx.lineWidth = Math.max(1, (gain ? A.ghostGainWidth : 1.3) * this.dpr);
    ctx.stroke();
    ctx.restore();
  }

  /** A hairline at your all-time best, visible only when you are near it. */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} _B unused; the record line is always the accent
   * @param {Sim} sim
   */
  _bestLine(ctx, _B, sim) {
    if (sim.best <= 1) return;
    const d = Math.abs((sim.body.ry ?? sim.body.y) - sim.best);
    if (d > FEEL.bestLineFadeU) return;
    const f = 1 - d / FEEL.bestLineFadeU;
    const y = this.Y(sim.best);
    // Above this line the world is regenerated every attempt and no corpse can
    // carry you. It is a frontier, so it is drawn as a horizon rather than as a
    // tick: a soft band of light with a hairline through it.
    const g = ctx.createLinearGradient(0, y - 26 * this.dpr, 0, y + 26 * this.dpr);
    g.addColorStop(0, rgb(MEMORY_GOLD, 0));
    g.addColorStop(0.5, rgb(MEMORY_GOLD, f * 0.10));
    g.addColorStop(1, rgb(MEMORY_GOLD, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, y - 26 * this.dpr, this.w, 52 * this.dpr);
    ctx.strokeStyle = rgb(MEMORY_GOLD, f * 0.40);
    ctx.lineWidth = 1;
    ctx.setLineDash([3 * this.dpr, 9 * this.dpr]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.w, y); ctx.stroke();
    ctx.setLineDash([]);
  }
}
