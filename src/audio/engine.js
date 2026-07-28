/**
 * Web Audio plumbing. Every sample in REVERB is generated at runtime — there is
 * not a single audio file in this repository.
 *
 *   voice ──► panner ──┬──► dry ──────────────► master ──► limiter ──► out
 *                      └──► send ──► convolver ┘
 *
 * The convolver's impulse response is synthesised per level, so THE TUNNEL
 * rings for four seconds and a maintenance cupboard barely rings at all.
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx({ latencyHint: 'interactive' });
    this.ctx = ctx;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 9;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.22;
    this.limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.limiter);

    this.dry = ctx.createGain();
    this.dry.gain.value = 1.0;
    this.dry.connect(this.master);

    this.convolver = ctx.createConvolver();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.9;
    this.convolver.connect(this.wet);
    this.wet.connect(this.master);

    this.send = ctx.createGain();
    this.send.gain.value = 0.5;
    this.send.connect(this.convolver);

    this.setSpace({ decay: 2.6, brightness: 0.5, predelay: 0.02 });

    if (ctx.listener.forwardX) {
      ctx.listener.upX.value = 0;
      ctx.listener.upY.value = 1;
      ctx.listener.upZ.value = 0;
    }
    this.ready = true;
  }

  get time() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Build a procedural impulse response for the current space. */
  setSpace({ decay = 2.5, brightness = 0.5, predelay = 0.02, spread = 1.0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.max(1, Math.floor(rate * decay));
    const pre = Math.floor(rate * predelay);
    const buf = ctx.createBuffer(2, len, rate);

    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      // Coloured noise tail: exponential decay with a slowly darkening spectrum,
      // which is what a long concrete tunnel actually does to a transient.
      let lp = 0;
      const cut = 0.06 + brightness * 0.4;
      for (let i = 0; i < len; i++) {
        if (i < pre) { d[i] = 0; continue; }
        const t = (i - pre) / (len - pre);
        const env = Math.pow(1 - t, 2.1) * Math.exp(-t * 3.2);
        const white = Math.random() * 2 - 1;
        lp += (white - lp) * (cut * (1 - t * 0.75) + 0.01);
        d[i] = lp * env;
      }
      // Discrete early reflections — these are what tell you a wall is close.
      const taps = 7;
      for (let k = 0; k < taps; k++) {
        const pos = pre + Math.floor(rate * (0.008 + k * 0.017 * spread + Math.random() * 0.01));
        if (pos < len) d[pos] += (Math.random() * 2 - 1) * 0.55 * Math.pow(0.72, k);
      }
      // Normalise so level changes never blow the mix up.
      let peak = 0;
      for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
      if (peak > 0) for (let i = 0; i < len; i++) d[i] /= peak;
    }

    this.convolver.buffer = buf;
  }

  /** Shared white-noise source buffer — allocating one per footstep is waste. */
  noiseBuffer() {
    if (this._noise) return this._noise;
    const rate = this.ctx.sampleRate;
    const len = rate * 2;
    const buf = this.ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  noiseSource() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuffer();
    s.loop = true;
    s.playbackRate.value = 0.85 + Math.random() * 0.3;
    return s;
  }

  /** A positioned bus. Returns the node a voice should connect into. */
  spatial(pos, { refDistance = 2.2, rolloff = 1.15, maxDistance = 90 } = {}) {
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = refDistance;
    p.rolloffFactor = rolloff;
    p.maxDistance = maxDistance;
    if (p.positionX) {
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
    } else {
      p.setPosition(pos.x, pos.y, pos.z);
    }
    p.connect(this.dry);
    p.connect(this.send);
    return p;
  }

  updateListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = camera.position;
    const f = { x: 0, y: 0, z: -1 };
    const e = camera.matrixWorld.elements;
    f.x = -e[8]; f.y = -e[9]; f.z = -e[10];
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(p.x, t, 0.02);
      l.positionY.setTargetAtTime(p.y, t, 0.02);
      l.positionZ.setTargetAtTime(p.z, t, 0.02);
      l.forwardX.setTargetAtTime(f.x, t, 0.02);
      l.forwardY.setTargetAtTime(f.y, t, 0.02);
      l.forwardZ.setTargetAtTime(f.z, t, 0.02);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(f.x, f.y, f.z, 0, 1, 0);
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.85;
  }
}
