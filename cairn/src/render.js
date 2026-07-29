import { FEEL, COLUMN, biomeAt, newBiomeSlot, MEMORY_GOLD } from './feel.js';
import { makeRng, erosionOf, EROSION } from './sim.js';

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
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

const rgb = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

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
function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i), hash1(i + 1), u);
}
function hash1(i) {
  let h = (i | 0) * 374761393;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// -------------------------------------------------------------------- dust

const DUST = 90;

// ----------------------------------------------------------------- renderer

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.w = 1; this.h = 1; this.dpr = 1;
    this.biome = newBiomeSlot();

    // Parallax bands: point arrays, generated once, redrawn as paths so they
    // cross-fade with the biome for free.
    this.bands = [];
    const rng = makeRng(0x51ce07);
    for (let l = 0; l < 3; l++) {
      const pts = [];
      const n = 26 + l * 10;
      for (let i = 0; i <= n; i++) {
        pts.push(i / n, rng() * (0.42 - l * 0.09) + 0.05);
      }
      this.bands.push({ pts, par: [0.15, 0.35, 0.6][l], span: 260 - l * 60 });
    }

    // Dust, pooled and wrapped into view rather than respawned.
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
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this._bgKey = -1;
  }

  // ------------------------------------------------------------ world → px

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

  X(wx) { return this.originX + wx * this.scale; }
  Y(wy) { return this.originY - wy * this.scale; }

  // -------------------------------------------------------------- emitters

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

  step(dt) {
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

    this._threads(ctx, B, sim);
    this._solids(ctx, B, sim, cam);
    this._rings(ctx, B);
    this._parts(ctx, B);
    this._trail(ctx, B);
    this._player(ctx, B, sim, ui);
    if (input && input.aiming) this._aim(ctx, B, input, sim);
    this._bestLine(ctx, B, sim);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return B;
  }

  _background(ctx, B, cam) {
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
    ctx.fillStyle = this._bg;
    ctx.fillRect(-40, -40, this.w + 80, this.h + 80);
  }

  /**
   * The height, enormous and almost invisible, behind the play. It is the only
   * number in the game that is allowed to be large, and it sits at 8% opacity
   * so it reads as an atmosphere rather than as a readout.
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

  _bands(ctx, B, cam) {
    // Silhouetted geometry, never empty, never contrasty. Each band repeats
    // vertically so the tower has depth at any height.
    for (let l = 0; l < this.bands.length; l++) {
      const band = this.bands[l];
      const par = band.par;
      const a = 0.11 + l * 0.075;
      const spanPx = band.span * this.scale;
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
        const pts = band.pts;
        for (let i = 0; i < pts.length; i += 2) {
          ctx.lineTo(-20 + pts[i] * (this.w + 40), baseY - pts[i + 1] * spanPx);
        }
        ctx.lineTo(this.w + 20, foot);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

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

      let wy = this.dust[o + 1];
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
   * The thread of light joining each corpse to the next in death order. It is
   * what makes a hundred separate failures read as one continuous history, and
   * it fades in as the camera pulls back so it never competes with the jump you
   * are about to make.
   */
  _threads(ctx, B, sim) {
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
  _solids(ctx, B, sim, cam) {
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
        ctx.fillStyle = rgb(B.accent, 0.05 + lit * 0.22);
        ctx.fillRect(sx - w * 0.5, top - 1.5 * this.dpr, w, 3 * this.dpr);
        ctx.globalCompositeOperation = 'source-over';
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
        const solidity = st === EROSION.FRESH ? 1 : st === EROSION.THIN ? 0.66 : 0.34;
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
        ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${(0.30 + solidity * 0.55).toFixed(3)})`;
        ctx.fillRect(-hwPx, -hhPx, hwPx * 2, Math.max(1, 1.4 * this.dpr));

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
   * A frozen silhouette. Four poses, chosen at the moment of death and kept
   * forever, so no two corpses in the tower are the same shape.
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

  _trail(ctx, B) {
    if (this.trailN < 2) return;
    const life = FEEL.juice.trailMs / 1000;
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
   * You. Not a box: a small emissive shard that carries the only real light in
   * the scene, squashing and stretching along its velocity with a spring return.
   */
  _player(ctx, B, sim, ui) {
    const b = sim.body;
    const x = this.X(b.rx ?? b.x), y = this.Y((b.ry ?? b.y) + FEEL.body.h * 0.5);
    const hw = FEEL.body.w * 0.5 * this.scale;
    const hh = FEEL.body.h * 0.5 * this.scale;

    // The light it casts.
    const R = 66 * this.scale;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, rgb(B.accent, 0.34));
    g.addColorStop(0.14, rgb(B.accent, 0.15));
    g.addColorStop(0.42, rgb(B.accent, 0.045));
    g.addColorStop(1, rgb(B.accent, 0));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(x - R, y - R, R * 2, R * 2);
    ctx.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(clamp(-b.vx * 0.0016, -0.45, 0.45));
    ctx.scale(1 + ui.stretch * 0.0, 1);
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
    const a = FEEL.aim.ghostAlpha;
    ctx.save();
    ctx.translate(this.X(pk.x), this.Y(pk.y));
    this._figurePath(ctx, FEEL.tower.corpseW * 0.5 * this.scale,
                     FEEL.tower.corpseH * 0.5 * this.scale, 0);
    ctx.fillStyle = rgb(MEMORY_GOLD, a * 0.30);
    ctx.fill();
    ctx.strokeStyle = rgb(MEMORY_GOLD, a);
    // Solid, not dashed. A body is 5.2 x 6.0 u — about fifteen CSS pixels tall
    // on a phone — and a dash pattern at that size breaks the silhouette into a
    // dotted blob that reads as a marker rather than as a person. The SIZE is
    // left honest: this is exactly how much room the corpse will take up, and
    // that is the thing the player is deciding about.
    ctx.lineWidth = Math.max(1, 1.3 * this.dpr);
    ctx.stroke();
    ctx.restore();
  }

  /** A hairline at your all-time best, visible only when you are near it. */
  _bestLine(ctx, B, sim) {
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
