/**
 * Every sound in CAIRN, synthesised. No files, no samples, no fetches.
 *
 * The ambient bed is the part that matters: two detuned drones and a slowly
 * filtered pad whose cutoff and detune both rise with altitude, so the world
 * gets brighter and more strung-out the higher you climb without a single
 * additional asset. Crossing a biome line re-tunes the whole bed rather than
 * swapping a loop.
 */

const BIOME_ROOT = [55, 61.74, 49, 43.65, 58.27, 65.41];  // A1, B1, G1, F1, Bb1, C2

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.bed = null;
    this.muted = localStorage.getItem('cairn.mute') === '1';
    this.ready = false;
    this.height = 0;
    this.biome = 0;
  }

  /** Unlocked by the first touch, per every mobile browser's autoplay policy. */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const g = this.ctx.createGain();
    g.gain.value = this.muted ? 0 : 0.9;
    g.connect(this.ctx.destination);
    this.master = g;
    this._bed();
    this.ready = true;
  }

  setMuted(m) {
    this.muted = m;
    localStorage.setItem('cairn.mute', m ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.9, this.ctx.currentTime, 0.05);
  }

  duck(on) {
    if (!this.master || this.muted) return;
    this.master.gain.setTargetAtTime(on ? 0 : 0.9, this.ctx.currentTime, 0.08);
  }

  _bed() {
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = 0.16;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 320;
    filt.Q.value = 0.7;
    filt.connect(out);
    out.connect(this.master);

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

    this.bed = { oscs, filt, out };
  }

  /** Altitude drives brightness and detune. Biome changes re-root the drones. */
  setHeight(y, biomeIndex) {
    if (!this.ready || !this.bed) return;
    const t = this.ctx.currentTime;
    const climb = Math.min(1, y / 900);
    this.bed.filt.frequency.setTargetAtTime(320 + climb * 1500, t, 0.6);

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

  _env(node, peak, attack, decay) {
    const t = this.ctx.currentTime;
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  _noise(dur) {
    const c = this.ctx;
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
    if (!this.ready || this.muted) return;
    this.stopCharge();
    const c = this.ctx;
    const src = this._noise(3);
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 300;
    f.Q.value = 3;
    const g = c.createGain();
    g.gain.value = 0.0001;
    g.gain.setTargetAtTime(0.10, c.currentTime, 0.08);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    this._charge = { src, f, g };
  }

  chargeTo(power) {
    if (!this._charge) return;
    this._charge.f.frequency.setTargetAtTime(300 + power * 2400, this.ctx.currentTime, 0.03);
  }

  stopCharge() {
    if (!this._charge) return;
    const { src, g } = this._charge;
    g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.04);
    setTimeout(() => { try { src.stop(); } catch { /* already gone */ } }, 200);
    this._charge = null;
  }

  release(power) {
    this.stopCharge();
    if (!this.ready || this.muted) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'triangle';
    const g = c.createGain();
    o.frequency.setValueAtTime(180 + power * 260, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(620 + power * 700, c.currentTime + 0.12);
    this._env(g, 0.22, 0.008, 0.16);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(c.currentTime + 0.3);
  }

  land(force) {
    if (!this.ready || this.muted) return;
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = 'sine';
    const g = c.createGain();
    const f = 90 + force * 130;
    o.frequency.setValueAtTime(f, c.currentTime);
    o.frequency.exponentialRampToValueAtTime(f * 0.55, c.currentTime + 0.14);
    this._env(g, 0.16 + force * 0.22, 0.004, 0.18);
    o.connect(g); g.connect(this.master);
    o.start(); o.stop(c.currentTime + 0.4);

    const n = this._noise(0.06);
    const nf = c.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 1400 + force * 2600;
    const ng = c.createGain();
    this._env(ng, 0.09 + force * 0.12, 0.002, 0.06);
    n.connect(nf); nf.connect(ng); ng.connect(this.master);
    n.start(); n.stop(c.currentTime + 0.12);
  }

  death() {
    if (!this.ready || this.muted) return;
    const c = this.ctx;
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
    o.connect(f); f.connect(g); g.connect(this.master);
    o.start(); o.stop(c.currentTime + 1.7);
  }

  /** A rising tone for a personal best. The only unambiguously good sound. */
  chime() {
    if (!this.ready || this.muted) return;
    const c = this.ctx;
    for (let i = 0; i < 3; i++) {
      const o = c.createOscillator();
      o.type = 'sine';
      const g = c.createGain();
      o.frequency.setValueAtTime([440, 660, 880][i], c.currentTime + i * 0.06);
      this._env(g, 0.10, 0.02 + i * 0.06, 0.8);
      o.connect(g); g.connect(this.master);
      o.start(); o.stop(c.currentTime + 1.2);
    }
  }

  /** A full-spectrum swell when a biome line is crossed. */
  wash() {
    if (!this.ready || this.muted) return;
    const c = this.ctx;
    const n = this._noise(1.4);
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.1;
    f.frequency.setValueAtTime(200, c.currentTime);
    f.frequency.exponentialRampToValueAtTime(3200, c.currentTime + 0.9);
    const g = c.createGain();
    this._env(g, 0.09, 0.25, 0.9);
    n.connect(f); f.connect(g); g.connect(this.master);
    n.start(); n.stop(c.currentTime + 1.5);
  }
}
