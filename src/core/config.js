// REVERB — global tuning constants.
// Every number that shapes the feel of the game lives here.

export const MAX_PULSES = 32;

// --- Palette (linear-ish sRGB triplets, 0..1) -------------------------------
// Hard rule: no neon green, no synthwave magenta, no cinematic teal/orange.
//
// The shader works in linear light and the final pass encodes to sRGB, so a
// palette entry has to be de-gamma'd on the way in or it comes out washed —
// which is exactly how a distinctive rust orange turns into beige. Each colour
// is then normalised to a peak of 1 so `power` means the same thing whatever
// the hue: brightness lives in the pulse, hue lives here.
const hex = (h) => {
  const lin = [(h >> 16) & 255, (h >> 8) & 255, h & 255]
    .map((c) => Math.pow(c / 255, 2.2));
  const peak = Math.max(...lin, 1e-6);
  return lin.map((c) => c / peak);
};

export const COLOR = {
  VOID: hex(0x000000),
  STEP: hex(0xdce3e8), // cold white — you, your movement
  WATER: hex(0x1b6b7a), // deep cyan — drips, ambience, machinery
  ENEMY: hex(0xc4522a), // rust orange — the only warm colour in the game
  SHOT: hex(0xffffff), // searing white
  STONE: hex(0xa8b4bc), // thrown stone, slightly duller than your own steps
};

// --- Sound propagation ------------------------------------------------------
// Not the real speed of sound: 343 m/s would cross a room in one frame.
// These are tuned so a shell visibly sweeps the geometry.
export const SPEED = {
  STEP: 11.0,
  SOFT: 9.0,
  DRIP: 8.0,
  STONE: 13.0,
  SHOT: 30.0,
  ENEMY: 10.5,
  SCREAM: 22.0,
  MACHINE: 12.0,
  TRAIN: 34.0,
  HEART: 7.0,
};

// --- Player -----------------------------------------------------------------
export const PLAYER = {
  eyeHeight: 1.62,
  crouchHeight: 0.95,
  radius: 0.34,
  speedWalk: 2.7,
  speedSneak: 1.15,
  speedCrouch: 1.0,
  speedSprint: 5.3,
  accel: 14.0,
  friction: 11.0,
  maxHealth: 3,
  ammo: 6,
};

// Noise emitted per step, multiplied by the surface factor.
export const STEP_NOISE = {
  sneak: 0.16,
  crouch: 0.22,
  walk: 0.62,
  sprint: 1.5,
};

// --- Hearing ----------------------------------------------------------------
export const HEARING = {
  // A noise event of loudness L is audible to an enemy within L * this many metres.
  radiusPerLoudness: 15.0,
  alertThreshold: 0.14,
  huntThreshold: 0.55,
  memory: 7.0, // seconds an enemy keeps chasing a stale cue
};

export const GRADE_TARGETS = {
  // Total accumulated loudness under which you earn the top mark.
  quiet: [8, 18, 34],
};
