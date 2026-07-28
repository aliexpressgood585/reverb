import { AudioEngine } from './engine.js';
import { VOICES, playVoice } from './voices.js';
import { SURF, SURFACE_ACOUSTICS } from '../world/surfaces.js';
import { LEVELS } from '../world/levels.js';

/**
 * Offline measurement rig.
 *
 * I cannot hear this game. So instead of guessing, every voice is rendered
 * through an OfflineAudioContext carrying the *exact* graph the game plays
 * through — same limiter, same convolver, same panner — and measured.
 *
 * Driven by scripts/audio-check.mjs. Nothing here runs during play.
 */

const RATE = 48000;

const db = (v) => 20 * Math.log10(Math.max(v, 1e-9));

function offline(seconds, channels = 2) {
  const OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  return new OC(channels, Math.max(128, Math.ceil(RATE * seconds)), RATE);
}

function stats(buffer) {
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    let peak = 0;
    let sum = 0;
    for (let i = 0; i < d.length; i++) {
      const a = d[i] < 0 ? -d[i] : d[i];
      if (a > peak) peak = a;
      sum += d[i] * d[i];
    }
    chans.push({ peak, rms: Math.sqrt(sum / d.length) });
  }
  const peak = Math.max(...chans.map((c) => c.peak));
  const rms = Math.sqrt(chans.reduce((a, c) => a + c.rms * c.rms, 0) / chans.length);
  return {
    peak,
    rms,
    peakDb: +db(peak).toFixed(2),
    rmsDb: +db(rms).toFixed(2),
    channels: chans.map((c) => ({ peakDb: +db(c.peak).toFixed(2), rmsDb: +db(c.rms).toFixed(2) })),
    clipped: peak > 1.0,
  };
}

/**
 * Reverberation time from a Schroeder backward energy integration, measured
 * over the -5 dB to -25 dB span and extrapolated (the standard T20 method).
 */
function rt60Of(data, rate) {
  const n = data.length;
  let acc = 0;
  const edc = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    acc += data[i] * data[i];
    edc[i] = acc;
  }
  if (edc[0] <= 0) return null;
  const ref = edc[0];
  let i5 = -1;
  let i25 = -1;
  for (let i = 0; i < n; i++) {
    const level = 10 * Math.log10(edc[i] / ref);
    if (i5 < 0 && level <= -5) i5 = i;
    if (level <= -25) { i25 = i; break; }
  }
  if (i5 < 0 || i25 < 0) return null;
  return +(((i25 - i5) / rate) * 3).toFixed(3);
}

function engineOn(ctx, { hum = false, space } = {}) {
  const E = new AudioEngine();
  E.adopt(ctx, { hum });
  if (space) E.setSpace(space);
  return E;
}

/** Render one synthesised voice through the whole chain and measure it. */
async function voice(name, { seconds = 4, space, gain = 1, surface = SURF.CONCRETE,
                             position = { x: 0, y: 0, z: -2 }, dry = true, wet = true,
                             keepBuffer = false } = {}) {
  const ctx = offline(seconds);
  const E = engineOn(ctx, { space });
  if (!dry) E.dry.gain.value = 0;
  if (!wet) E.send.gain.value = 0;
  const dest = E.spatial(position);
  if (!VOICES[name]) throw new Error('no voice ' + name);
  playVoice(E, name, dest, { gain, acoustics: SURFACE_ACOUSTICS[surface] });
  const buf = await ctx.startRendering();
  return { name, ...stats(buf), buffer: keepBuffer ? buf : undefined };
}

/** The continuous electrical bed, with no events in it at all. */
async function ambient({ seconds = 3, space } = {}) {
  const ctx = offline(seconds);
  engineOn(ctx, { hum: true, space });
  const buf = await ctx.startRendering();
  return { name: 'ambient-bed', ...stats(buf) };
}

/** Measure the impulse response a level's `space` block actually produces. */
async function impulse(space) {
  const ctx = offline(Math.max(1, (space.rt60 ?? 1.8) * 1.4));
  const E = engineOn(ctx, { space });
  const ir = E.convolver.buffer;
  const d = ir.getChannelData(0);
  return {
    declared: space.rt60 ?? null,
    measured: rt60Of(d, ir.sampleRate),
    lengthSec: +(ir.length / ir.sampleRate).toFixed(3),
    energy: +Math.sqrt(d.reduce((a, v) => a + v * v, 0)).toFixed(3),
  };
}

/**
 * Does the room swallow the source?
 *
 * Comparing whole-window RMS is the obvious test and it is the wrong one: a
 * long tail fills more of a fixed window, so it scores "wetter" even when the
 * direct sound is perfectly clear. The metric that actually tracks whether you
 * can still identify and place an event is clarity — the energy arriving in the
 * first 50 ms against everything after it (C50, the standard room-acoustics
 * figure). That is measured on the combined dry+wet render, which is what a
 * player hears.
 */
async function wetDry(name, space) {
  const d = await voice(name, { space, wet: false });
  const w = await voice(name, { space, dry: false });
  const both = await voice(name, { space, keepBuffer: true });
  const buf = both.buffer;
  const rate = buf.sampleRate;
  const split = Math.floor(rate * 0.05);
  let early = 0;
  let late = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const x = buf.getChannelData(c);
    for (let i = 0; i < x.length; i++) {
      if (i < split) early += x[i] * x[i];
      else late += x[i] * x[i];
    }
  }
  return {
    dryRmsDb: d.rmsDb,
    wetRmsDb: w.rmsDb,
    wetMinusDryDb: +(w.rmsDb - d.rmsDb).toFixed(2),
    clarity50Db: +(10 * Math.log10(Math.max(early, 1e-12) / Math.max(late, 1e-12))).toFixed(2),
  };
}

/**
 * Spatial audio is the player's primary sense. If the two channels do not
 * differ for a source hard on one side, the game is unplayable and no amount
 * of visual polish saves it.
 */
async function panning(space) {
  const at = async (position) => {
    const r = await voice('stone', { seconds: 2.5, space, position, wet: false });
    return r.channels;
  };
  const right = await at({ x: 6, y: 0, z: 0 });
  const left = await at({ x: -6, y: 0, z: 0 });
  const front = await at({ x: 0, y: 0, z: -6 });
  const spread = (c) => +(c[1].rmsDb - c[0].rmsDb).toFixed(2);
  return {
    rightMinusLeftDb: spread(right),
    leftMinusRightDb: spread(left),
    frontImbalanceDb: Math.abs(spread(front)),
  };
}

export async function runAudioProbe() {
  const platform = LEVELS[0].space;
  const results = { spaces: {}, voices: {}, ambient: null, wetDry: {}, panning: null };

  for (const level of LEVELS) {
    results.spaces[level.name] = await impulse(level.space);
  }

  const catalogue = [
    ['shot', { gain: 1 }],
    ['scream', { gain: 1, seconds: 5 }],
    ['train', { gain: 1, seconds: 9 }],
    ['machine', { gain: 1 }],
    ['hurt', { gain: 1 }],
    ['kill', { gain: 1 }],
    ['stone', { gain: 1 }],
    ['step', { gain: 0.62, surface: SURF.CONCRETE }],
    ['splash', { gain: 0.62, surface: SURF.PUDDLE }],
    ['gravel', { gain: 0.62, surface: SURF.GRAVEL }],
    ['step-sneak', { gain: 0.16, surface: SURF.CONCRETE, as: 'step' }],
    ['enemyStep', { gain: 0.9 }],
    ['breath', { gain: 0.8, seconds: 3 }],
    ['drip', { gain: 1 }],
    ['heart', { gain: 0.8 }],
    ['chime', { gain: 0.28, seconds: 4 }],
    ['hum', { gain: 1, seconds: 4 }],
    ['dryfire', { gain: 1 }],
  ];

  for (const [label, opts] of catalogue) {
    const { as, ...rest } = opts;
    results.voices[label] = await voice(as ?? label, { space: platform, ...rest });
  }

  results.ambient = await ambient({ space: platform });
  results.wetDry.platform = await wetDry('stone', platform);
  results.wetDry.tunnel = await wetDry('stone', LEVELS[2].space);
  results.wetDry.maintenance = await wetDry('stone', LEVELS[3].space);
  results.panning = await panning(platform);

  return results;
}
