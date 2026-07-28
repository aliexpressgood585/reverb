import * as THREE from 'three';
import { MAX_PULSES } from '../core/config.js';

/**
 * The pulse pool.
 *
 * A pulse is a spherical wavefront expanding from the point where a sound was
 * made. It is the *only* light source in REVERB. Nothing in this file knows
 * anything about audio — but nothing in the game is allowed to create a pulse
 * without also playing the sound that caused it (see audio/audio.js `emit`).
 *
 * Data is packed into flat Float32Arrays and handed to the shaders as uniform
 * arrays, so the pool never allocates during play.
 *
 *   uPulsePos[i]   = vec3(world position)
 *   uPulseData[i]  = vec4(radius, intensity, thickness, entityReveal)
 *   uPulseColor[i] = vec3(colour)
 */
export class PulseField {
  constructor() {
    this.pos = new Float32Array(MAX_PULSES * 3);
    this.data = new Float32Array(MAX_PULSES * 4);
    this.color = new Float32Array(MAX_PULSES * 3);
    this.colorWorld = new Float32Array(MAX_PULSES * 3);
    this.ref = new Float32Array(MAX_PULSES).fill(2);

    // CPU-side bookkeeping, one entry per slot.
    this.slots = [];
    for (let i = 0; i < MAX_PULSES; i++) {
      this.slots.push({
        alive: false,
        age: 0,
        life: 1,
        speed: 10,
        power: 1,
        thickness: 0.3,
        reveal: 0,
        ref: 2,
        maxRadius: 40,
        priority: 0,
      });
    }

    this.uniforms = {
      uPulsePos: { value: this.pos },
      uPulseData: { value: this.data },
      uPulseColor: { value: this.color },
      uPulseColorWorld: { value: this.colorWorld },
      uPulseRef: { value: this.ref },
      uPulseCount: { value: 0 },
    };

    this.count = 0;
  }

  /** Find a free slot, or steal the weakest/oldest one if the pool is full. */
  _acquire(priority) {
    for (let i = 0; i < MAX_PULSES; i++) {
      if (!this.slots[i].alive) return i;
    }
    // Pool exhausted: evict the pulse closest to death with the lowest priority.
    let worst = -1;
    let worstScore = Infinity;
    for (let i = 0; i < MAX_PULSES; i++) {
      const s = this.slots[i];
      const score = s.priority * 4 + (1 - s.age / s.life);
      if (score < worstScore) {
        worstScore = score;
        worst = i;
      }
    }
    if (this.slots[worst].priority > priority) return -1;
    return worst;
  }

  /**
   * Spawn a wavefront.
   * @param {THREE.Vector3|{x,y,z}} p  origin in world space
   * @param {object} o
   *   color      [r,g,b] as seen on living things
   *   worldColor [r,g,b] as seen on walls and floors (defaults to `color`)
   *   power      peak brightness (also the "loudness" the AI hears)
   *   speed      metres per second of shell expansion
   *   life       seconds until the shell is gone
   *   thickness  half-width of the lit shell, in metres
   *   ref        reference distance for the 1/r² falloff — this is the knob
   *              that makes a footstep die at two metres and a gunshot fill
   *              the room, without either of them leaving inverse-square
   *   reveal     0..1 — how much this pulse lights living things
   *   priority   eviction weight
   */
  spawn(p, o = {}) {
    const power = o.power ?? 1;
    const priority = o.priority ?? power;
    const i = this._acquire(priority);
    if (i < 0) return -1;

    const s = this.slots[i];
    s.alive = true;
    s.age = 0;
    s.speed = o.speed ?? 11;
    s.life = o.life ?? 2.2;
    s.power = power;
    s.thickness = o.thickness ?? 0.28;
    s.ref = o.ref ?? 2.0;
    this.ref[i] = s.ref;
    s.reveal = o.reveal ?? 0;
    s.maxRadius = o.maxRadius ?? s.speed * s.life;
    s.priority = priority;

    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;

    const c = o.color ?? [1, 1, 1];
    this.color[i * 3] = c[0];
    this.color[i * 3 + 1] = c[1];
    this.color[i * 3 + 2] = c[2];

    // A creature's footstep still lights the floor — but cold, like any other
    // footstep. Warm colour is reserved for the creature itself.
    const w = o.worldColor ?? c;
    this.colorWorld[i * 3] = w[0];
    this.colorWorld[i * 3 + 1] = w[1];
    this.colorWorld[i * 3 + 2] = w[2];

    this.data[i * 4] = 0;
    this.data[i * 4 + 1] = power;
    this.data[i * 4 + 2] = s.thickness;
    this.data[i * 4 + 3] = s.reveal;

    return i;
  }

  update(dt) {
    let highest = 0;
    for (let i = 0; i < MAX_PULSES; i++) {
      const s = this.slots[i];
      if (!s.alive) continue;
      s.age += dt;
      const t = s.age / s.life;
      if (t >= 1) {
        s.alive = false;
        this.data[i * 4 + 1] = 0;
        continue;
      }
      const radius = Math.min(s.age * s.speed, s.maxRadius);
      // Energy bleeds away with age; the tail of the wave is always the dimmest.
      const decay = (1 - t) * (1 - t);
      this.data[i * 4] = radius;
      this.data[i * 4 + 1] = s.power * decay;
      // The shell smears very slightly as it travels — diffusion, not blur.
      this.data[i * 4 + 2] = s.thickness * (1 + t * 0.35);
      highest = i + 1;
    }
    this.count = highest;
    this.uniforms.uPulseCount.value = highest;
  }

  clear() {
    for (let i = 0; i < MAX_PULSES; i++) {
      this.slots[i].alive = false;
      this.data[i * 4 + 1] = 0;
      this.data[i * 4] = 0;
    }
    this.count = 0;
    this.uniforms.uPulseCount.value = 0;
  }
}
