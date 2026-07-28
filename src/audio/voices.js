/**
 * Synthesised voices. Filtered noise, oscillators, ADSR envelopes. Nothing else.
 *
 * The mix lives in TRIM at the bottom of this file, and it is not guesswork:
 * every number there was derived from `node scripts/audio-check.mjs`, which
 * renders each voice offline through the real graph and measures it. Change a
 * synthesis parameter and the trim needs re-measuring, not re-imagining.
 */

function env(param, t, { a = 0.002, peak = 1, d = 0.1, s = 0, sustain = 0, r = 0.08 }) {
  param.cancelScheduledValues(t);
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
  if (sustain > 0) {
    param.exponentialRampToValueAtTime(Math.max(s, 0.0002), t + a + d);
    param.setValueAtTime(Math.max(s, 0.0002), t + a + d + sustain);
    param.exponentialRampToValueAtTime(0.0001, t + a + d + sustain + r);
  } else {
    param.exponentialRampToValueAtTime(0.0001, t + a + d + r);
  }
}

function stopAt(nodes, t) {
  for (const n of nodes) {
    try { n.stop(t); } catch (e) { /* not a source */ }
  }
}

/** Filtered noise burst — the backbone of every impact in the game. */
function burst(E, dest, t, { freq, q = 1.2, type = 'bandpass', gain = 0.5, a = 0.002, d = 0.09, r = 0.06, rate = 1 }) {
  const src = E.noiseSource();
  src.playbackRate.value = rate * (0.85 + Math.random() * 0.3);
  const f = E.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = E.ctx.createGain();
  env(g.gain, t, { peak: gain, a, d, r });
  src.connect(f).connect(g).connect(dest);
  src.start(t);
  stopAt([src], t + a + d + r + 0.05);
  return g;
}

function tone(E, dest, t, { f0, f1, type = 'sine', gain = 0.4, a = 0.003, d = 0.14, r = 0.08 }) {
  const o = E.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + a + d);
  const g = E.ctx.createGain();
  env(g.gain, t, { peak: gain, a, d, r });
  o.connect(g).connect(dest);
  o.start(t);
  stopAt([o], t + a + d + r + 0.05);
  return g;
}

export const VOICES = {
  step(E, dest, o) {
    const t = E.time;
    const s = o.acoustics;
    burst(E, dest, t, {
      freq: s.tone * (0.85 + Math.random() * 0.3),
      q: 0.7 + (1 - s.grit) * 2.2,
      gain: 0.30 * o.gain * (0.6 + s.grit * 0.6),
      a: 0.001, d: 0.045 + (1 - s.grit) * 0.05, r: 0.05,
    });
    tone(E, dest, t, {
      f0: 96 * (0.9 + Math.random() * 0.2), f1: 48,
      gain: 0.20 * o.gain * (1 - s.grit * 0.5),
      a: 0.002, d: 0.06, r: 0.05,
    });
  },

  splash(E, dest, o) {
    const t = E.time;
    burst(E, dest, t, { freq: 1500, q: 0.5, gain: 0.30 * o.gain, a: 0.001, d: 0.06, r: 0.12 });
    burst(E, dest, t + 0.02, { freq: 4200, q: 0.8, gain: 0.16 * o.gain, a: 0.002, d: 0.09, r: 0.16 });
    tone(E, dest, t, { f0: 210, f1: 90, gain: 0.12 * o.gain, d: 0.05, r: 0.05 });
  },

  gravel(E, dest, o) {
    const t = E.time;
    for (let i = 0; i < 5; i++) {
      burst(E, dest, t + Math.random() * 0.05, {
        freq: 2000 + Math.random() * 3200, q: 2.5,
        gain: 0.10 * o.gain, a: 0.0008, d: 0.02, r: 0.03,
      });
    }
    tone(E, dest, t, { f0: 120, f1: 60, gain: 0.10 * o.gain, d: 0.05, r: 0.04 });
  },

  drip(E, dest, o) {
    const t = E.time;
    tone(E, dest, t, {
      f0: 900 + Math.random() * 900, f1: 260,
      gain: 0.22 * o.gain, a: 0.001, d: 0.07, r: 0.05,
    });
    burst(E, dest, t, { freq: 5200, q: 1.4, gain: 0.05 * o.gain, a: 0.001, d: 0.01, r: 0.02 });
  },

  stone(E, dest, o) {
    const t = E.time;
    burst(E, dest, t, { freq: 1100, q: 3.0, gain: 0.34 * o.gain, a: 0.001, d: 0.05, r: 0.09 });
    tone(E, dest, t, { f0: 640, f1: 300, type: 'triangle', gain: 0.20 * o.gain, d: 0.09, r: 0.10 });
    tone(E, dest, t, { f0: 150, f1: 70, gain: 0.14 * o.gain, d: 0.06, r: 0.05 });
  },

  shot(E, dest, o) {
    const t = E.time;
    // Crack.
    burst(E, dest, t, { freq: 2600, q: 0.35, type: 'highpass', gain: 0.85 * o.gain, a: 0.0006, d: 0.05, r: 0.10 });
    // Body.
    burst(E, dest, t, { freq: 420, q: 0.5, gain: 0.75 * o.gain, a: 0.001, d: 0.12, r: 0.30 });
    // Thump.
    tone(E, dest, t, { f0: 130, f1: 34, gain: 0.55 * o.gain, a: 0.002, d: 0.16, r: 0.35 });
    // Mechanical action, a beat later.
    burst(E, dest, t + 0.09, { freq: 3400, q: 4, gain: 0.10 * o.gain, a: 0.001, d: 0.02, r: 0.03 });
  },

  dryfire(E, dest, o) {
    const t = E.time;
    burst(E, dest, t, { freq: 3000, q: 6, gain: 0.16 * o.gain, a: 0.0008, d: 0.015, r: 0.02 });
  },

  enemyStep(E, dest, o) {
    const t = E.time;
    burst(E, dest, t, { freq: 240, q: 0.9, gain: 0.26 * o.gain, a: 0.002, d: 0.07, r: 0.07 });
    tone(E, dest, t, { f0: 74, f1: 40, gain: 0.22 * o.gain, d: 0.08, r: 0.07 });
  },

  breath(E, dest, o) {
    const t = E.time;
    const src = E.noiseSource();
    const f = E.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(360, t);
    f.frequency.exponentialRampToValueAtTime(900, t + 0.35);
    f.frequency.exponentialRampToValueAtTime(280, t + 1.0);
    f.Q.value = 3.5;
    const g = E.ctx.createGain();
    env(g.gain, t, { peak: 0.20 * o.gain, a: 0.16, d: 0.25, s: 0.09 * o.gain, sustain: 0.2, r: 0.45 });
    src.connect(f).connect(g).connect(dest);
    src.start(t);
    stopAt([src], t + 1.4);
    // A wet click in the throat. This is the detail that makes them feel alive.
    tone(E, dest, t + 0.05, { f0: 132, f1: 88, type: 'sawtooth', gain: 0.05 * o.gain, d: 0.12, r: 0.2 });
  },

  scream(E, dest, o) {
    const t = E.time;
    const shaper = E.ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * 2 - 1;
      curve[i] = Math.tanh(x * 3.4);
    }
    shaper.curve = curve;
    // Output stage: the tanh normalises, so level has to be taken after it or
    // turning the scream down just makes it a cleaner scream.
    const out = E.ctx.createGain();
    out.gain.value = 0.55;
    shaper.connect(out).connect(dest);

    for (const [mul, gain] of [[1, 0.30], [1.5, 0.16], [2.51, 0.10]]) {
      const o1 = E.ctx.createOscillator();
      o1.type = 'sawtooth';
      const base = 210 * mul;
      o1.frequency.setValueAtTime(base * 0.6, t);
      o1.frequency.exponentialRampToValueAtTime(base * 1.55, t + 0.22);
      o1.frequency.exponentialRampToValueAtTime(base * 0.75, t + 1.1);
      const g = E.ctx.createGain();
      env(g.gain, t, { peak: gain * o.gain, a: 0.05, d: 0.2, s: gain * 0.5 * o.gain, sustain: 0.5, r: 0.5 });
      o1.connect(g).connect(shaper);
      o1.start(t);
      stopAt([o1], t + 1.6);
    }
    burst(E, dest, t, { freq: 2200, q: 0.7, gain: 0.16 * o.gain, a: 0.06, d: 0.4, r: 0.6 });
  },

  machine(E, dest, o) {
    const t = E.time;
    tone(E, dest, t, { f0: 58, f1: 44, gain: 0.40 * o.gain, a: 0.02, d: 0.3, s: 0.2 * o.gain, sustain: 0.35, r: 0.5 });
    burst(E, dest, t, { freq: 700, q: 1.1, gain: 0.16 * o.gain, a: 0.01, d: 0.25, r: 0.4 });
    burst(E, dest, t + 0.5, { freq: 1800, q: 5, gain: 0.10 * o.gain, a: 0.002, d: 0.03, r: 0.05 });
  },

  train(E, dest, o) {
    const t = E.time;
    const src = E.noiseSource();
    src.playbackRate.value = 0.35;
    const f = E.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(120, t);
    f.frequency.exponentialRampToValueAtTime(900, t + 2.2);
    f.frequency.exponentialRampToValueAtTime(90, t + 6.0);
    f.Q.value = 1.2;
    const g = E.ctx.createGain();
    env(g.gain, t, { peak: 0.55 * o.gain, a: 1.6, d: 1.4, s: 0.28 * o.gain, sustain: 1.2, r: 2.2 });
    src.connect(f).connect(g).connect(dest);
    src.start(t);
    stopAt([src], t + 7.5);

    tone(E, dest, t + 0.4, { f0: 36, f1: 26, gain: 0.34 * o.gain, a: 1.2, d: 1.6, s: 0.16 * o.gain, sustain: 1.4, r: 2.0 });
  },

  heart(E, dest, o) {
    const t = E.time;
    tone(E, dest, t, { f0: 62, f1: 30, gain: 0.30 * o.gain, a: 0.006, d: 0.10, r: 0.10 });
    tone(E, dest, t + 0.17, { f0: 52, f1: 26, gain: 0.19 * o.gain, a: 0.006, d: 0.09, r: 0.10 });
  },

  hurt(E, dest, o) {
    const t = E.time;
    burst(E, dest, t, { freq: 300, q: 0.6, gain: 0.55 * o.gain, a: 0.001, d: 0.12, r: 0.25 });
    tone(E, dest, t, { f0: 180, f1: 40, type: 'triangle', gain: 0.30 * o.gain, d: 0.2, r: 0.3 });
  },

  kill(E, dest, o) {
    const t = E.time;
    burst(E, dest, t, { freq: 520, q: 0.5, gain: 0.45 * o.gain, a: 0.002, d: 0.25, r: 0.5 });
    tone(E, dest, t, { f0: 300, f1: 30, type: 'sawtooth', gain: 0.16 * o.gain, a: 0.01, d: 0.5, r: 0.6 });
  },

  turnstile(E, dest, o) {
    const t = E.time;
    // Three teeth of a ratchet, then the bar hitting its stop.
    for (let i = 0; i < 3; i++) {
      burst(E, dest, t + i * 0.042, {
        freq: 2500 + i * 480, q: 9, gain: 0.22 * o.gain, a: 0.0008, d: 0.012, r: 0.022,
      });
    }
    burst(E, dest, t + 0.14, { freq: 430, q: 1.4, gain: 0.34 * o.gain, a: 0.001, d: 0.09, r: 0.17 });
    tone(E, dest, t + 0.14, { f0: 128, f1: 60, type: 'triangle', gain: 0.24 * o.gain, d: 0.10, r: 0.13 });
  },

  hum(E, dest, o) {
    const t = E.time;
    E.humSwell(o.gain);
    // A ballast that has been failing for years, ticking over one more time.
    tone(E, dest, t, { f0: 99.5, f1: 98.0, type: 'triangle', gain: 0.09 * o.gain, a: 0.35, d: 0.9, r: 1.4 });
    burst(E, dest, t + 0.02, { freq: 2400, q: 7, gain: 0.035 * o.gain, a: 0.002, d: 0.02, r: 0.04 });
  },

  chime(E, dest, o) {
    const t = E.time;
    for (const [m, g] of [[1, 0.16], [2.02, 0.08], [3.01, 0.04]]) {
      tone(E, dest, t, { f0: 320 * m, type: 'sine', gain: g * o.gain, a: 0.01, d: 0.9, r: 1.2 });
    }
  },
};

/**
 * Measured mix. Each entry is the linear trim applied to a voice's output so
 * that its peak lands where the design wants it, verified by the offline rig.
 *
 * Target hierarchy, in dBFS at the master output:
 *
 *   gunshot        -3    the loudest thing in the game, by design
 *   scream         -6
 *   train          -8
 *   hurt / kill   -12
 *   machine       -13
 *   stone         -17
 *   heart         -20
 *   enemy step    -21
 *   splash        -20    water is punished
 *   walking step  -22
 *   breath        -25
 *   drip          -24
 *   chime         -26
 *   hum tick      -30
 *   turnstile     -16    unavoidable, and it costs you
 *   sneaking      -33    still ~9 dB clear of the bed
 *   dry click     -33
 *   ambient bed   -42    the floor of the whole mix
 */
export const TRIM = {
  shot: 2.60,
  scream: 0.72,
  train: 0.84,
  hurt: 1.53,
  kill: 1.18,
  machine: 1.31,
  stone: 2.40,
  heart: 1.19,
  enemyStep: 2.40,
  splash: 2.90,
  step: 4.50,
  gravel: 5.50,
  breath: 1.64,
  drip: 2.70,
  chime: 0.84,
  hum: 0.37,
  dryfire: 5.60,
  turnstile: 1.90,
};

/**
 * Play a voice with its measured trim applied. Everything that makes a sound
 * goes through here, including the offline measurement rig, so the numbers the
 * rig reports are the numbers the game plays.
 */
export function playVoice(E, name, dest, opts) {
  const fn = VOICES[name] ?? VOICES.step;
  const trim = TRIM[name];
  if (!trim || trim === 1) {
    fn(E, dest, opts);
    return;
  }
  const g = E.ctx.createGain();
  g.gain.value = trim;
  g.connect(dest);
  fn(E, g, opts);
}
