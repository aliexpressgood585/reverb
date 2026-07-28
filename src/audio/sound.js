import * as THREE from 'three';
import { AudioEngine } from './engine.js';
import { VOICES } from './voices.js';
import { COLOR, SPEED } from '../core/config.js';
import { SURF, SURFACE_ACOUSTICS } from '../world/surfaces.js';

/**
 * THE CONTRACT.
 *
 * This is the only place in the codebase that is allowed to play a sound, and
 * the only place that is allowed to create a pulse. It always does both.
 *
 *   a sound that is heard must light the world
 *   a light in the world must have been heard
 *
 * Every other system — player, enemies, water, machinery, the train — calls
 * `sound.emit()` and gets audio, light and AI perception as one indivisible act.
 */

const KINDS = {
  step:      { color: COLOR.STEP,  power: 1.05, speed: SPEED.STEP,   life: 1.5, thick: 0.22, reveal: 0.0, loud: 1.0 },
  stone:     { color: COLOR.STONE, power: 2.10, speed: SPEED.STONE,  life: 2.6, thick: 0.30, reveal: 0.0, loud: 1.6 },
  drip:      { color: COLOR.WATER, power: 0.85, speed: SPEED.DRIP,   life: 2.4, thick: 0.17, reveal: 0.0, loud: 0.0 },
  shot:      { color: COLOR.SHOT,  power: 9.00, speed: SPEED.SHOT,   life: 1.7, thick: 0.55, reveal: 1.0, loud: 9.0 },
  dryfire:   { color: COLOR.STEP,  power: 0.60, speed: SPEED.STEP,   life: 1.0, thick: 0.16, reveal: 0.0, loud: 0.5 },
  enemyStep: { color: COLOR.ENEMY, power: 0.85, speed: SPEED.ENEMY,  life: 1.6, thick: 0.22, reveal: 1.0, loud: 0.0 },
  breath:    { color: COLOR.ENEMY, power: 0.60, speed: SPEED.ENEMY * 0.7, life: 2.4, thick: 0.30, reveal: 1.0, loud: 0.0 },
  scream:    { color: COLOR.ENEMY, power: 5.20, speed: SPEED.SCREAM, life: 2.6, thick: 0.48, reveal: 1.0, loud: 0.0 },
  machine:   { color: COLOR.WATER, power: 3.20, speed: SPEED.MACHINE,life: 2.8, thick: 0.42, reveal: 0.35, loud: 0.0 },
  train:     { color: COLOR.WATER, power: 7.50, speed: SPEED.TRAIN,  life: 5.5, thick: 0.95, reveal: 0.6, loud: 0.0 },
  heart:     { color: COLOR.STEP,  power: 0.75, speed: SPEED.HEART,  life: 1.8, thick: 0.26, reveal: 0.0, loud: 0.55 },
  hurt:      { color: COLOR.ENEMY, power: 3.00, speed: SPEED.STEP,   life: 2.0, thick: 0.40, reveal: 0.8, loud: 2.5 },
  kill:      { color: COLOR.ENEMY, power: 3.60, speed: SPEED.ENEMY,  life: 2.4, thick: 0.44, reveal: 1.0, loud: 0.0 },
  door:      { color: COLOR.STEP,  power: 2.40, speed: SPEED.STEP,   life: 2.4, thick: 0.36, reveal: 0.2, loud: 1.8 },
  chime:     { color: COLOR.WATER, power: 1.60, speed: SPEED.DRIP,   life: 3.0, thick: 0.30, reveal: 0.0, loud: 0.0 },
  splash:    { color: COLOR.WATER, power: 1.60, speed: SPEED.STEP,   life: 1.8, thick: 0.26, reveal: 0.0, loud: 1.6 },
  gravel:    { color: COLOR.STEP,  power: 1.45, speed: SPEED.STEP,   life: 1.7, thick: 0.24, reveal: 0.0, loud: 1.9 },
};

const STEP_VOICE = {
  [SURF.PUDDLE]: 'splash',
  [SURF.GRAVEL]: 'gravel',
};

export class SoundWorld {
  constructor(pulses) {
    this.pulses = pulses;
    this.engine = new AudioEngine();
    this.listeners = [];
    this.level = null;
    this.noiseScore = 0;
    this.lastPlayerNoise = { loudness: 0, at: 0, position: new THREE.Vector3() };
    this._tmp = new THREE.Vector3();
  }

  init() { this.engine.init(); }
  setLevel(level) { this.level = level; }
  onSound(fn) { this.listeners.push(fn); }

  /**
   * @param {string} kind    key of KINDS
   * @param {Vector3} pos    world position of the source
   * @param {object} o
   *   gain      loudness multiplier
   *   surface   surface id, for footsteps
   *   fromPlayer whether this counts against the player's noise score
   *   silentToAI skip AI notification (used by the world's own ambience)
   */
  emit(kind, pos, o = {}) {
    const k = KINDS[kind];
    if (!k) return 0;
    const gain = o.gain ?? 1;

    let voiceName = kind;
    let acoustics = SURFACE_ACOUSTICS[SURF.CONCRETE];
    let bright = 1;
    let loudMul = 1;

    if (kind === 'step') {
      const sid = o.surface ?? SURF.CONCRETE;
      acoustics = SURFACE_ACOUSTICS[sid] ?? acoustics;
      voiceName = STEP_VOICE[sid] ?? 'step';
      bright = acoustics.bright;
      loudMul = acoustics.noise;
    }

    // ---- 1. the sound -------------------------------------------------------
    const E = this.engine;
    if (E.ready && !E.muted) {
      const dest = E.spatial(pos, o.panner);
      const fn = VOICES[voiceName] ?? VOICES.step;
      try {
        fn(E, dest, { gain, acoustics });
      } catch (err) { /* a dropped voice must never stall the frame */ }
      setTimeout(() => { try { dest.disconnect(); } catch (e) {} }, 8000);
    }

    // ---- 2. the light -------------------------------------------------------
    const power = k.power * gain * bright * (o.powerMul ?? 1);
    this.pulses.spawn(pos, {
      color: o.color ?? k.color,
      power,
      speed: k.speed,
      life: k.life,
      thickness: k.thick,
      reveal: o.reveal ?? k.reveal,
      priority: power,
    });

    // ---- 3. what it costs you ----------------------------------------------
    const loudness = k.loud * gain * loudMul;
    if (o.fromPlayer && loudness > 0) {
      this.noiseScore += loudness;
      this.lastPlayerNoise.loudness = loudness;
      this.lastPlayerNoise.position.copy(pos);
      this.lastPlayerNoise.at = performance.now() / 1000;
    }

    // ---- 4. who heard it ----------------------------------------------------
    if (loudness > 0 && !o.silentToAI) {
      const evt = {
        kind,
        loudness,
        position: pos.clone ? pos.clone() : new THREE.Vector3(pos.x, pos.y, pos.z),
        fromPlayer: !!o.fromPlayer,
      };
      for (const fn of this.listeners) fn(evt);
    }

    return loudness;
  }

  /** How much of a sound survives the walls between two points. */
  transmission(a, b) {
    if (!this.level || !this.level.occlusion) return 1;
    const occ = this.level.occlusion.sample;
    const dist = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(4, Math.min(40, Math.ceil(dist / 0.6)));
    let blocked = 0;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const edge = Math.min(t, 1 - t) * dist;
      if (edge < 0.6) continue;
      blocked += occ(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
    }
    return Math.max(0, 1 - blocked * 0.5);
  }

  resetScore() {
    this.noiseScore = 0;
  }
}
