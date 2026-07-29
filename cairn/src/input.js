import { FEEL } from './feel.js';
import { predict } from './sim.js';

/**
 * Touch, and the aim model.
 *
 * This file is where "precise" is won or lost, so it is worth stating the three
 * mechanics that make a thumb accurate on a 6-inch sheet of glass:
 *
 * 1. **Power saturates; angle does not.** Pull past `maxPullScreenFrac` of the
 *    screen height and further dragging stops adding power and refines the
 *    ANGLE only. Park your thumb in the far corner and one degree costs you
 *    fifty pixels of travel instead of three. This is the single biggest
 *    precision win available on a touchscreen and it costs nothing to learn,
 *    because it is what a player naturally does when they want more power and
 *    find they already have all of it.
 *
 * 2. **Power is eased, not linear.** The top five percent of power occupies a
 *    fifth of the pull, so max-power aiming is fine-grained rather than a cliff
 *    you fall off.
 *
 * 3. **A soft angular snap, never a magnet.** If a launch within 1.5° of yours
 *    lands cleanly on a platform, the aim is nudged at most 1.1° toward it. It
 *    can rescue a jump you had right; it cannot aim for you, and it never moves
 *    you somewhere you were not already pointing.
 *
 * Everything reacts on pointerdown. Nothing in the input path has a CSS
 * transition. Latency is a feature you can only lose.
 */

const DEG = Math.PI / 180;

export class Input {
  constructor(canvas, sim) {
    this.canvas = canvas;
    this.sim = sim;

    this.active = false;
    this.pointerId = -1;
    this.sx = 0; this.sy = 0;   // where the drag began, CSS px
    this.cx = 0; this.cy = 0;   // where it is now
    this.aiming = false;

    this.power = 0;             // 0..1
    this.angle = 0;             // radians, 0 = +x
    this.vx = 0; this.vy = 0;
    this.snapped = 0;           // degrees actually applied, for the debug pane

    this.arc = [];
    this.landing = null;
    this.timeScale = 1;

    this.onLaunch = null;
    this.onChargeStart = null;
    this.onRelease = null;
    this.onTap = null;

    this._snapTick = 0;
    this._scratch = [];

    const opts = { passive: false };
    canvas.addEventListener('pointerdown', (e) => this._down(e), opts);
    canvas.addEventListener('pointermove', (e) => this._move(e), opts);
    canvas.addEventListener('pointerup', (e) => this._up(e), opts);
    canvas.addEventListener('pointercancel', (e) => this._up(e), opts);
    // Belt and braces on top of touch-action: none. iOS in particular will
    // still try to scroll, zoom and pop a callout without these.
    for (const t of ['gesturestart', 'gesturechange', 'contextmenu', 'dblclick', 'selectstart']) {
      canvas.addEventListener(t, (e) => e.preventDefault(), opts);
    }
    document.addEventListener('touchmove', (e) => {
      if (e.cancelable) e.preventDefault();
    }, opts);
  }

  _down(e) {
    e.preventDefault();
    if (this.active) return;
    this.active = true;
    this.pointerId = e.pointerId;
    this.sx = this.cx = e.clientX;
    this.sy = this.cy = e.clientY;
    this.aiming = false;
    if (this.canvas.setPointerCapture) {
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
    }
  }

  _move(e) {
    if (!this.active || e.pointerId !== this.pointerId) return;
    e.preventDefault();
    this.cx = e.clientX;
    this.cy = e.clientY;
    if (!this.aiming) {
      const d = Math.hypot(this.cx - this.sx, this.cy - this.sy);
      if (d >= FEEL.launch.deadZonePx) {
        this.aiming = true;
        if (this.onChargeStart) this.onChargeStart();
      }
    }
  }

  _up(e) {
    if (!this.active || (e.pointerId !== this.pointerId && e.pointerId !== undefined)) return;
    if (e.preventDefault) e.preventDefault();
    this.active = false;
    const wasAiming = this.aiming;
    this.aiming = false;
    if (wasAiming) {
      if (this.onRelease) this.onRelease(this.power);
      if (this.onLaunch) this.onLaunch(this.vx, this.vy);
    } else if (this.onTap) {
      this.onTap();
    }
    this.arc.length = 0;
    this.landing = null;
  }

  /** Cancel any in-flight drag, e.g. when the app is backgrounded. */
  abort() {
    this.active = false;
    this.aiming = false;
    this.arc.length = 0;
    this.landing = null;
  }

  /**
   * Resolve the drag into a launch vector, and — while aiming — the exact arc
   * the physics will take. Called once per rendered frame.
   */
  update(dtReal, screenH) {
    const L = FEEL.launch;
    const target = this.aiming ? FEEL.aim.timeScale : 1;
    const ramp = this.aiming ? FEEL.aim.rampIn : FEEL.aim.rampOut;
    this.timeScale += (target - this.timeScale) * Math.min(1, dtReal / Math.max(1e-4, ramp));
    if (Math.abs(this.timeScale - target) < 0.002) this.timeScale = target;

    if (!this.aiming) return;

    // DIRECT aim: the line you draw is the line you fly. Drag up and you go up.
    //
    // This was a slingshot — pull down to launch up — on the theory that every
    // thumb already knows Angry Birds. Playtesting killed it in one sentence:
    // "pressing downward makes it jump, I want dragging upward to jump". A
    // slingshot is legible when you are aiming an object away from yourself at
    // a target on screen. Here you ARE the object, the camera is locked to you,
    // and inverting the one thing the player is doing to themselves reads as
    // the controls fighting them rather than as a mechanic.
    //
    // Direct also makes the aim ray honest: it starts at the body and points
    // exactly where the body is about to go, so the line, the drag and the
    // flight are one straight thing instead of three related ones.
    const dx = this.cx - this.sx;
    const dy = this.sy - this.cy;
    const len = Math.hypot(dx, dy);
    if (len < 1e-4) return;

    const maxPull = screenH * L.maxPullScreenFrac;
    const dead = L.deadZonePx;

    // Power saturates at maxPull. Past it the drag is angle-only — the whole
    // precision mechanic, and it needs no explanation because it is what the
    // hand does anyway.
    const raw = Math.min(1, Math.max(0, (len - dead) / Math.max(1, maxPull - dead)));
    const eased = 1 - Math.pow(1 - raw, L.powerEase);
    this.power = eased;

    let angle = Math.atan2(dy, dx);
    this.snapped = 0;

    const speed = L.minSpeed + (L.maxSpeed - L.minSpeed) * eased;
    angle = this._assist(angle, speed);

    this.angle = angle;
    this.vx = Math.cos(angle) * speed;
    this.vy = Math.sin(angle) * speed;

    this.landing = predict(this.sim, this.vx, this.vy, this.arc);
  }

  /**
   * Soft angular assist. Samples a narrow fan around the player's aim; if a
   * neighbouring angle lands on a platform and theirs does not, nudge toward it
   * by at most `snapMaxDeg`. Bounded on both sides — it is a nudge, never a
   * teleport, and it can never point you somewhere you were not already
   * pointing.
   *
   * Rate-limited to every third frame: the fan costs several full physics
   * predictions, and the aim does not move far in 50 ms of slowed time.
   */
  _assist(angle, speed) {
    const L = FEEL.launch;
    if (L.snapWindowDeg <= 0) return angle;

    if (this._snapTick++ % 3 !== 0 && this._lastAssist !== undefined) {
      const drift = Math.abs(angle - (this._lastRaw ?? angle));
      if (drift < 0.5 * DEG) return this._lastAssist;
    }
    this._lastRaw = angle;

    const here = predict(this.sim, Math.cos(angle) * speed, Math.sin(angle) * speed, this._scratch);
    if (here) { this._lastAssist = angle; return angle; }

    const win = L.snapWindowDeg * DEG;
    let bestOff = 0;
    let bestAbs = Infinity;
    for (let i = 1; i <= 3; i++) {
      const off = (win * i) / 3;
      for (const sgn of [-1, 1]) {
        const a = angle + off * sgn;
        const hit = predict(this.sim, Math.cos(a) * speed, Math.sin(a) * speed, this._scratch);
        if (hit && Math.abs(off) < bestAbs) { bestAbs = Math.abs(off); bestOff = off * sgn; }
      }
      if (bestAbs < Infinity) break;
    }

    if (bestOff === 0) { this._lastAssist = angle; return angle; }
    const capped = Math.sign(bestOff) * Math.min(Math.abs(bestOff), L.snapMaxDeg * DEG);
    this.snapped = capped / DEG;
    this._lastAssist = angle + capped;
    return this._lastAssist;
  }
}
