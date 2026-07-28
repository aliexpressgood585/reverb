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
    // Identity listener: at the origin, facing -Z, right hand towards +X.
    this._listener = { x: 0, z: 0, rx: 1, rz: 0 };
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    if (this.failed) return;
    try {
      this._build();
    } catch (err) {
      // No output device (headless capture, locked-down browser). The game is
      // still fully playable-looking; it just has nothing to say.
      this.failed = true;
      this.ready = false;
      console.warn('audio unavailable:', err && err.message);
    }
  }

  _build(providedCtx, { hum = true } = {}) {
    let ctx = providedCtx;
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error('no AudioContext');
      ctx = new Ctx({ latencyHint: 'interactive' });
    }
    this.ctx = ctx;

    // A safety net, not a mix engineer. The old settings (-8 dB, ratio 9) sat
    // on every transient and flattened a gunshot down to the level of a scream,
    // which meant the loudness hierarchy was being decided by the compressor
    // rather than by the gain staging. Now nothing normally reaches it.
    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.0;
    this.limiter.knee.value = 0;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001;
    this.limiter.release.value = 0.12;
    this.limiter.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.limiter);

    this.dry = ctx.createGain();
    this.dry.gain.value = 1.0;
    this.dry.connect(this.master);

    this.convolver = ctx.createConvolver();
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.8;
    this.convolver.connect(this.wet);
    this.wet.connect(this.master);

    this.send = ctx.createGain();
    this.send.gain.value = 0.17;
    this.send.connect(this.convolver);

    this.setSpace({ rt60: 1.8, brightness: 0.5, predelay: 0.02 });
    if (hum) this.startHum();

    if (ctx.listener.forwardX) {
      ctx.listener.upX.value = 0;
      ctx.listener.upY.value = 1;
      ctx.listener.upZ.value = 0;
    }
    this.ready = true;
  }

  /**
   * Build the whole graph on a caller-supplied context. Used by the offline
   * measurement rig (scripts/audio-check.mjs) so the numbers it reports come
   * from the exact chain the game plays through, not a reconstruction of it.
   */
  adopt(ctx, opts) {
    this._build(ctx, opts);
    this.ready = true;
    return this;
  }

  get time() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * Build a procedural impulse response for the current space.
   *
   * `rt60` is the real thing: seconds for the tail to fall 60 dB. The envelope
   * is exp(-6.908 t / rt60) precisely so that the measured decay matches the
   * number a level declares — scripts/audio-check.mjs verifies it every run.
   *
   * The result is normalised by energy, not by peak. Peak normalisation makes
   * the wet return get louder the longer the tail is, which is how a tunnel
   * ends up swallowing its own dry signal.
   */
  setSpace({ rt60 = 1.8, brightness = 0.5, predelay = 0.02, spread = 1.0 }) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    // Run the buffer a little past T60; anything below -60 dB is inaudible.
    const tail = rt60 * 1.15;
    const len = Math.max(64, Math.floor(rate * tail));
    const pre = Math.floor(rate * predelay);
    const buf = ctx.createBuffer(2, len, rate);

    const k = 6.9078 / rt60; // ln(1000) — exactly -60 dB at t = rt60

    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      // Coloured noise tail whose spectrum darkens as it decays, which is what
      // a long concrete tunnel actually does to a transient.
      let lp = 0;
      const cut = 0.06 + brightness * 0.4;
      for (let i = 0; i < len; i++) {
        if (i < pre) { d[i] = 0; continue; }
        const t = (i - pre) / rate;
        const u = t / tail;
        const env = Math.exp(-k * t);
        const white = Math.random() * 2 - 1;
        lp += (white - lp) * (cut * (1 - u * 0.75) + 0.01);
        d[i] = lp * env;
      }
      // Discrete early reflections — these are what tell you a wall is close.
      for (let j = 0; j < 7; j++) {
        const pos = pre + Math.floor(rate * (0.008 + j * 0.017 * spread + Math.random() * 0.01));
        if (pos < len) d[pos] += (Math.random() * 2 - 1) * 0.5 * Math.pow(0.72, j);
      }
    }

    // Energy normalisation: a convolution multiplies by the IR's total energy,
    // so equalising that keeps the wet return at one level across every space.
    let energy = 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) energy += d[i] * d[i];
    }
    // A longer tail fills more of the listening window, so flat energy
    // normalisation still lets a big room bury its own source. Compensating
    // mildly against rt60 keeps the tunnel obviously the most reverberant space
    // while leaving the dry signal on top of the wet everywhere.
    const target = 16 / (1 + 0.35 * rt60);
    const norm = energy > 0 ? Math.sqrt(target / energy) : 1;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] *= norm;
    }

    this.convolver.buffer = buf;
    this.rt60 = rt60;
  }

  /**
   * The station's electrical bed: a pair of detuned mains-frequency tones and
   * a whisper of filtered noise, sitting right at the threshold of hearing.
   * It is the only continuous sound in the game, and it is not silent light —
   * `hum` pulses are emitted in step with its swells (see world ambience).
   */
  startHum() {
    if (!this.ctx || this.hum) return;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0.0075;
    out.connect(this.master);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 0.7;
    lp.connect(out);

    for (const [f, g, type] of [[49.4, 0.55, 'sine'], [50.6, 0.4, 'sine'], [99.7, 0.16, 'triangle']]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const gn = ctx.createGain();
      gn.gain.value = g;
      o.connect(gn).connect(lp);
      o.start();
    }

    const air = this.noiseSource();
    const ap = ctx.createBiquadFilter();
    ap.type = 'bandpass';
    ap.frequency.value = 320;
    ap.Q.value = 0.4;
    const ag = ctx.createGain();
    ag.gain.value = 0.055;
    air.connect(ap).connect(ag).connect(out);
    air.start();

    this.hum = out;
  }

  /** A swell in the bed — the thing a `hum` pulse is the light of. */
  humSwell(amount = 1) {
    if (!this.hum) return;
    const t = this.ctx.currentTime;
    const g = this.hum.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.0075 + 0.006 * amount, t + 0.5);
    g.linearRampToValueAtTime(0.0075, t + 2.4);
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

  /**
   * A positioned bus. Returns the node a voice should connect into.
   *
   * HRTF alone measured only 4.3 dB of channel separation for a source hard on
   * one side. That is physically honest — interaural level difference really is
   * small below a couple of kHz — but this game asks you to find a creature in
   * total darkness by ear, so the cue has to be unmissable. The HRTF stage is
   * kept for its spectral and timing cues (it is what distinguishes in front
   * from behind) and a stereo panner widens the result to about 15 dB.
   */
  spatial(pos, { refDistance = 2.2, rolloff = 1.15, maxDistance = 90 } = {}) {
    const ctx = this.ctx;
    const p = ctx.createPanner();
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

    let out = p;
    if (ctx.createStereoPanner) {
      const wide = ctx.createStereoPanner();
      wide.pan.value = this._azimuthOf(pos) * 0.72;
      p.connect(wide);
      out = wide;
    }

    out.connect(this.dry);
    out.connect(this.send);
    return p;
  }

  /** Sine of the source's azimuth: -1 hard left, 0 dead ahead, +1 hard right. */
  _azimuthOf(pos) {
    const l = this._listener;
    const dx = pos.x - l.x;
    const dz = pos.z - l.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.2) return 0;
    return Math.max(-1, Math.min(1, (dx * l.rx + dz * l.rz) / len));
  }

  updateListener(camera) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const p = camera.position;
    const e0 = camera.matrixWorld.elements;
    // Right vector, for the stereo widener in spatial().
    this._listener = { x: p.x, z: p.z, rx: e0[0], rz: e0[2] };
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
