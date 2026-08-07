/**
 * Every sound in CAIRN, synthesised. No files, no samples, no fetches.
 *
 * The ambient bed is the part that matters: two detuned drones and a slowly
 * filtered pad whose cutoff and detune both rise with altitude, so the world
 * gets brighter and more strung-out the higher you climb without a single
 * additional asset. Crossing a biome line re-tunes the whole bed rather than
 * swapping a loop.
 */

import { FEEL } from './feel.js';

const BIOME_ROOT = [55, 61.74, 49, 43.65, 58.27, 65.41];  // A1, B1, G1, F1, Bb1, C2

/**
 * @typedef {object} Bed
 * @property {OscillatorNode[]} oscs
 * @property {BiquadFilterNode} filt
 * @property {GainNode} out
 * @property {BiquadFilterNode} windFilt
 * @property {GainNode} windGain
 * @property {BiquadFilterNode} gustFilt
 * @property {GainNode} gustGain
 */

export class Audio {
  constructor() {
    /** @type {AudioContext|null} null until the first touch unlocks it */
    this.ctx = null;
    /** @type {GainNode|null} */
    this.master = null;
    /** @type {Bed|null} */
    this.bed = null;
    /** @type {{src: AudioBufferSourceNode, f: BiquadFilterNode, g: GainNode}|null} */
    this._charge = null;
    /** @type {GainNode|null} depth of the wind's slow breath */
    this._breath = null;
    this.muted = localStorage.getItem('cairn.mute') === '1';
    this.height = 0;
    this.biome = 0;
  }

  /**
   * The context and the master bus, or null if the first touch has not happened.
   *
   * Every sound in this file goes through here. It replaced a `ready` boolean
   * that told the truth and told it in a way nothing could act on: `ready` being
   * true did not make `this.ctx` non-null to a reader OR to a type checker, so
   * each method reached through a nullable field on the strength of a flag set
   * somewhere else. Now the guard and the values are the same expression.
   *
   * @returns {{c: AudioContext, m: GainNode}|null}
   */
  _live() {
    return this.ctx && this.master ? { c: this.ctx, m: this.master } : null;
  }

  /** True once the first touch has built the graph. Read by the harness. */
  get ready() { return !!this.ctx && !!this.master; }

  /** Unlocked by the first touch, per every mobile browser's autoplay policy. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    // Safari under 14.1 and every WebView built on it only have the prefixed
    // constructor. Cast rather than declare: this is the one line in the codebase
    // that knows the prefix exists.
    const AC = window.AudioContext
      || /** @type {{webkitAudioContext?: typeof AudioContext}} */ (
        /** @type {unknown} */ (window)).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const g = this.ctx.createGain();
    g.gain.value = this.muted ? 0 : 0.9;
    g.connect(this.ctx.destination);
    this.master = g;
    this._bed();
  }

  /** @param {boolean} m */
  setMuted(m) {
    this.muted = m;
    localStorage.setItem('cairn.mute', m ? '1' : '0');
    const L = this._live();
    if (L) L.m.gain.setTargetAtTime(m ? 0 : 0.9, L.c.currentTime, 0.05);
  }

  /** @param {boolean} on */
  duck(on) {
    const L = this._live();
    if (!L || this.muted) return;
    L.m.gain.setTargetAtTime(on ? 0 : 0.9, L.c.currentTime, 0.08);
  }

  _bed() {
    const L = this._live();
    if (!L) return;
    const c = L.c;
    const out = c.createGain();
    out.gain.value = 0.16;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 320;
    filt.Q.value = 0.7;
    filt.connect(out);
    out.connect(L.m);

    /** @type {OscillatorNode[]} */
    const oscs = [];
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator();
      o.type = i === 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = 55 * (i === 2 ? 2 : 1);
      const g = c.createGain();
      g.gain.value = i === 2 ? 0.18 : 0.34;
      o.connect(g); g.connect(filt);
      o.start();
      oscs.push(o);
    }

    // A slow filtered pad breathing under the drones.
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain);
    lfoGain.connect(filt.frequency);
    lfo.start();

    /*
     * WIND — the layer that makes altitude audible.
     *
     * The drones say where you are in the world; the wind says how far up. It is
     * two bands of filtered noise: a steady bed whose cutoff and level both rise
     * with height, and a slow gust that breathes over it so the top of the tower
     * is never a flat hiss.
     *
     * Noise is a four-second looping buffer rather than a per-frame source. A
     * fresh AudioBuffer per gust would allocate 176 KB every few seconds for a
     * sound nobody could distinguish from this one.
     */
    const wind = this._noise(4, c);
    wind.loop = true;
    const windFilt = c.createBiquadFilter();
    windFilt.type = 'bandpass';
    windFilt.frequency.value = 420;
    windFilt.Q.value = 0.55;
    const windGain = c.createGain();
    windGain.gain.value = 0;          // silent at ground level, by design
    wind.connect(windFilt); windFilt.connect(windGain); windGain.connect(L.m);
    wind.start();

    const gust = this._noise(4, c);
    gust.loop = true;
    const gustFilt = c.createBiquadFilter();
    gustFilt.type = 'bandpass';
    gustFilt.frequency.value = 900;
    gustFilt.Q.value = 1.6;
    const gustGain = c.createGain();
    gustGain.gain.value = 0;
    gust.connect(gustFilt); gustFilt.connect(gustGain); gustGain.connect(L.m);
    gust.start();

    // The breath: a very slow LFO on the gust's level, so it swells and falls
    // instead of sitting there.
    const breath = c.createOscillator();
    breath.frequency.value = 0.085;
    const breathDepth = c.createGain();
    breathDepth.gain.value = 1;
    breath.connect(breathDepth);
    breathDepth.connect(gustGain.gain);
    breath.start();
    this._breath = breathDepth;

    this.bed = { oscs, filt, out, windFilt, windGain, gustFilt, gustGain };
  }

  /** Altitude drives brightness and detune. Biome changes re-root the drones. */
  /**
   * @param {number} y
   * @param {number} biomeIndex
   * @param {number} [momentum] 0-1, eased. Opens the bed on a clean streak.
   */
  setHeight(y, biomeIndex, momentum = 0) {
    const L = this._live();
    if (!L || !this.bed) return;
    const t = L.c.currentTime;
    const climb = Math.min(1, y / 900);
    // Momentum is folded in HERE rather than in a setter of its own, because
    // this cutoff is one parameter and two writers to one AudioParam fight:
    // whichever ran last wins and the bed flickers. Height and streak are the
    // only two things that open the bed, so they are computed together.
    this.bed.filt.frequency.setTargetAtTime(
      320 + climb * 1500 + momentum * FEEL.momentum.bedGain, t, 0.6);

    // THE SOUNDSCAPE THINS AND GETS COLDER AS YOU CLIMB.
    //
    // Wind rises with height and the drone bed gives way to it — so the top of
    // the tower is not the bottom plus more layers, it is a different and emptier
    // place. `climb` is the same 0-900 m curve the filter uses, so the two move
    // together rather than crossing.
    const B = this.bed;
    B.windGain.gain.setTargetAtTime(climb * 0.075, t, 1.2);
    B.windFilt.frequency.setTargetAtTime(420 + climb * 1400, t, 1.2);
    B.gustFilt.frequency.setTargetAtTime(900 + climb * 2200, t, 1.4);
    if (this._breath) this._breath.gain.setTargetAtTime(climb * 0.030, t, 1.4);
    // The drones recede as the wind arrives. Thinner, not quieter.
    B.out.gain.setTargetAtTime(0.16 * (1 - climb * 0.45), t, 1.2);

    if (biomeIndex !== this.biome) {
      this.biome = biomeIndex;
      const root = BIOME_ROOT[biomeIndex % BIOME_ROOT.length];
      const detune = 4 + climb * 22;
      this.bed.oscs[0].frequency.setTargetAtTime(root, t, 1.4);
      this.bed.oscs[1].frequency.setTargetAtTime(root * 1.0 + detune * 0.02, t, 1.4);
      this.bed.oscs[1].detune.setTargetAtTime(detune, t, 1.4);
      this.bed.oscs[2].frequency.setTargetAtTime(root * 3, t, 1.8);
      this.wash();
    }
  }

  /**
   * @param {GainNode} node
   * @param {number} peak
   * @param {number} attack
   * @param {number} decay
   */
  _env(node, peak, attack, decay) {
    const L = this._live();
    if (!L) return;
    const t = L.c.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /**
   * @param {number} dur seconds
   * @param {AudioContext} c
   * @returns {AudioBufferSourceNode}
   */
  _noise(dur, c) {
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    return src;
  }

  /** Rising filtered noise; cutoff tracks the pull. Held while charging. */
  charge() {
    const L = this._live();
    if (!L || this.muted) return;
    this.stopCharge();
    const c = L.c;
    const src = this._noise(3, c);
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 300;
    f.Q.value = 3;
    const g = c.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.10, c.currentTime, 0.08);
    src.connect(f); f.connect(g); g.connect(L.m);
    src.start();
    this._charge = { src, f, g };
  }

  /** @param {number} power */
  chargeTo(power) {
    const L = this._live();
    if (!this._charge || !L) return;
    this._charge.f.frequency.setTargetAtTime(300 + power * 2400, L.c.currentTime, 0.03);
  }

  stopCharge() {
    const L = this._live();
    if (!this._charge || !L) return;
    const { src, g } = this._charge;
    g.gain.setTargetAtTime(0.0001, L.c.currentTime, 0.04);
    setTimeout(() => { try { src.stop(); } catch { /* already gone */ } }, 200);
    this._charge = null;
  }

  /** @param {number} power */
  release(power) {
    this.stopCharge();
    const L = this._live();
    if (!L || this.muted) return;
    const c = L.c;
    const o = c.createOscillator();
    o.type = 'triangle';
    const g = c.createGain();
    o.frequency.setValueAtTime(180 + power * 260, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(620 + power * 700, c.currentTime + 0.12);
    this._env(g, 0.22, 0.008, 0.16);
    o.connect(g); g.connect(L.m);
    o.start(); o.stop(c.currentTime + 0.3);
  }

  /** @param {number} force */
  land(force) {
    const L = this._live();
    if (!L || this.muted) return;
    const c = L.c;
    const o = c.createOscillator();
    o.type = 'sine';
    const g = c.createGain();
    const f = 90 + force * 130;
    o.frequency.setValueAtTime(f, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, c.currentTime + 0.14);
    this._env(g, 0.16 + force * 0.22, 0.004, 0.18);
    o.connect(g); g.connect(L.m);
    o.start(); o.stop(c.currentTime + 0.4);

    const n = this._noise(0.06, c);
    const nf = c.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 1400 + force * 2600;
    const ng = c.createGain();
    this._env(ng, 0.09 + force * 0.12, 0.002, 0.06);
    n.connect(nf); nf.connect(ng); ng.connect(L.m);
    n.start(); n.stop(c.currentTime + 0.12);
  }

  death() {
    const L = this._live();
    if (!L || this.muted) return;
    const c = L.c;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1800, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(180, c.currentTime + 0.9);
    const g = c.createGain();
    o.frequency.setValueAtTime(300, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(46, c.currentTime + 0.7);
    this._env(g, 0.24, 0.01, 1.5);
    o.connect(f); f.connect(g); g.connect(L.m);
    o.start(); o.stop(c.currentTime + 1.7);
  }

  /**
   * ASH: the hold you just landed on has started to go.
   *
   * A DIFFERENT sound from `land`, deliberately — the landing already happened
   * and was already scored. This is the news that arrives a moment later, so it
   * is dry, close and small: grit, not a hit.
   */
  /**
   * A near miss. Not a reward sound — an intake of breath: a short filtered
   * swell that arrives UNDER the landing thud rather than on top of it, so the
   * moment reads as the room reacting rather than the game scoring you.
   *
   * @param {boolean} doomed the body you are standing on is nearly MEMORY
   */
  close(doomed) {
    const L = this._live();
    if (!L || this.muted) return;
    const c = L.c;
    const t = c.currentTime;

    const o = c.createOscillator();
    o.type = 'sine';
    // EDGE rises — you got away with it. DOOMED falls, and lands on the minor
    // sixth below, which is the only interval in the game that resolves nowhere.
    const lo = doomed ? 330 : 196;
    const hi = doomed ? 165 : 392;
    o.frequency.setValueAtTime(lo, t);
    o.frequency.exponentialRampToValueAtTime(hi, t + (doomed ? 0.5 : 0.26));
    const g = c.createGain();
    this._env(g, doomed ? 0.09 : 0.055, 0.02, doomed ? 0.6 : 0.3);
    o.connect(g); g.connect(L.m);
    o.start(); o.stop(t + 0.9);

    const n = this._noise(doomed ? 0.5 : 0.24, c);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(doomed ? 900 : 2200, t);
    f.Q.value = 0.8;
    const ng = c.createGain();
    this._env(ng, doomed ? 0.05 : 0.03, 0.03, doomed ? 0.55 : 0.26);
    n.connect(f); f.connect(ng); ng.connect(L.m);
    n.start(); n.stop(t + 0.7);
  }

  crumbleWarn() {
    const L = this._live();
    if (!L || this.muted) return;
    const c = L.c;
    const n = this._noise(0.22, c);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(2600, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(1100, c.currentTime + 0.22);
    f.Q.value = 1.2;
    const g = c.createGain();
    this._env(g, 0.075, 0.006, 0.22);
    n.connect(f); f.connect(g); g.connect(L.m);
    n.start(); n.stop(c.currentTime + 0.3);
  }

  /** ASH: it is gone. The floor leaving, not the player hitting it. */
  crumble() {
    const L = this._live();
    if (!L || this.muted) return;
    const c = L.c;
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(150, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(38, c.currentTime + 0.4);
    const g = c.createGain();
    this._env(g, 0.13, 0.004, 0.5);
    o.connect(g); g.connect(L.m);
    o.start(); o.stop(c.currentTime + 0.6);

    const n = this._noise(0.32, c);
    const nf = c.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.setValueAtTime(3200, c.currentTime);
    nf.frequency.exponentialRampToValueAtTime(420, c.currentTime + 0.32);
    const ng = c.createGain();
    this._env(ng, 0.11, 0.002, 0.34);
    n.connect(nf); nf.connect(ng); ng.connect(L.m);
    n.start(); n.stop(c.currentTime + 0.4);
  }

  /** A rising tone for a personal best. The only unambiguously good sound. */
  chime() {
    const L = this._live();
    if (!L || this.muted) return;
    const c = L.c;
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator();
      o.type = 'sine';
      const g = c.createGain();
      o.frequency.setValueAtTime([440, 660, 880][i], c.currentTime + i * 0.06);
      this._env(g, 0.10, 0.02 + i * 0.06, 0.8);
      o.connect(g); g.connect(L.m);
      o.start(); o.stop(c.currentTime + 1.2);
    }
  }

  /** A full-spectrum swell when a biome line is crossed. */
  wash() {
    const L = this._live();
    if (!L || this.muted) return;
    const c = L.c;
    const n = this._noise(1.4, c);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.1;
    f.frequency.setValueAtTime(200, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(3200, c.currentTime + 0.9);
    const g = c.createGain();
    this._env(g, 0.09, 0.25, 0.9);
    n.connect(f); f.connect(g); g.connect(L.m);
    n.start(); n.stop(c.currentTime + 1.5);
  }
}
