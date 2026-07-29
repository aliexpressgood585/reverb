/**
 * FEEL — every tunable number in CAIRN, in one object.
 *
 * Nothing else in the codebase is allowed to hold a magic number that changes
 * how the game plays. If a value affects the hand, it lives here.
 *
 * UNITS. The simulation runs in virtual units, never pixels. The playable
 * column is 100u wide; the camera shows `camera.viewH` units of height and
 * derives its width from the aspect ratio, so a phone and a laptop get the
 * same physics and a different window onto it. Speeds are u/s, accelerations
 * u/s². A pixel appears in exactly one place — the input module, converting a
 * thumb drag into a launch — and that conversion is normalised by screen
 * height so a small phone and a tablet feel identical.
 */

export const COLUMN = 100;

export const FEEL = {
  // ------------------------------------------------------------ simulation
  sim: {
    dt: 1 / 120,          // the fixed step. Never varies, ever.
    maxCatchUp: 0.25,     // seconds of simulation one frame may run
    maxSubSteps: 8,       // swept-collision substeps per tick
  },

  // ------------------------------------------------------------------ body
  body: {
    w: 4.2,
    h: 6.0,
    // Sub-stepping triggers when a tick would move further than half the body,
    // which is what makes tunnelling through a corpse at full speed impossible
    // rather than merely unlikely.
    sweepFraction: 0.5,
  },

  // --------------------------------------------------------------- gravity
  // Rise light, fall heavy. The asymmetry is the single cheapest way to make a
  // jump feel authored instead of simulated: you float up into the decision
  // and drop out of it decisively.
  gravityRise: 260,
  gravityFall: 380,
  apexHang: {
    scale: 0.55,          // gravity multiplier through the apex
    window: 0.090,        // seconds either side of vy ≈ 0
    vyBand: 34,           // |vy| under this counts as "at apex"
  },
  maxFallSpeed: 300,

  // ---------------------------------------------------------------- launch
  launch: {
    minSpeed: 45,
    maxSpeed: 130,
    deadZonePx: 8,
    // Past this fraction of screen height the pull stops adding power and
    // starts refining angle only. This is the precision mechanic: park your
    // thumb far from the character and every degree costs you many pixels.
    maxPullScreenFrac: 0.22,
    // Power curve. Ease-out means the last 20% of pull spends most of its
    // travel on the top 5% of power, so max-power aiming is fine-grained
    // instead of a cliff.
    powerEase: 2.2,
    // Soft angular assist toward a launch that lands cleanly on a platform.
    // A nudge, never a magnet: it can move your aim by at most `snapMaxDeg`,
    // and only when you are already inside `snapWindowDeg` of the solution.
    snapWindowDeg: 1.5,
    snapMaxDeg: 1.1,
  },

  // ------------------------------------------------------------------- air
  airControl: 0.12,       // fraction of launch speed reachable as drift
  airControlAccel: 150,
  coyoteTime: 0.100,
  jumpBuffer: 0.120,

  // --------------------------------------------------------------- landing
  landing: {
    forgiveness: 3.0,     // u of horizontal miss forgiven while falling
    hardImpactVy: 190,    // |vy| above which a landing is "hard"
    friction: 0.86,
    restitution: 0,
  },

  // ----------------------------------------------------------------- walls
  wall: {
    slideSpeed: 40,
    grabWindow: 0.18,     // seconds of contact before the slide engages
    kickX: 46,            // horizontal impulse off a wall launch
  },

  // ---------------------------------------------------------------- aiming
  aim: {
    timeScale: 0.15,
    rampIn: 0.120,
    rampOut: 0.090,
    arcSeconds: 2.6,      // how far ahead the predicted arc is simulated
    arcDotEvery: 6,       // ticks between arc dots
    arcCrisp: 0.60,       // fraction of the arc drawn at full opacity
  },

  // ---------------------------------------------------------------- camera
  camera: {
    viewH: 150,           // units of world height visible on screen
    followY: 9.0,
    followX: 5.0,
    lookaheadY: 0.22,     // seconds of velocity to lead by
    lookaheadX: 0.16,
    deadZoneY: 9,
    zoomAtSpeed: 1.25,    // view height multiplier at max fall speed
    zoomEase: 3.2,
    playerOffsetY: -0.18, // fraction of view height below centre
    impactRotDeg: 0.6,
    impactRotDecay: 300,  // ms
    shakeDecay: 6.5,
    shakeMax: 3.2,        // u
  },

  // ----------------------------------------------------------------- juice
  juice: {
    hitStopLand: 0.040,
    hitStopDeath: 0.090,
    squashMax: 0.42,
    squashSpring: 165,
    squashDamp: 15,
    trailMs: 250,
    trailPoints: 26,
    ringMs: 200,
  },

  // ------------------------------------------------------------------ tower
  tower: {
    minRise: 16,
    maxRise: 27,
    minWidth: 11,
    maxWidth: 26,
    // Ledges are never placed outside the reach envelope of a full-power
    // launch, scaled down by this, so a gap is tight but never impossible.
    reachSafety: 0.70,
    edgePad: 6,           // keep ledges this far inside the column
    // A corpse is a narrower perch than rock. That is what makes it a worse
    // platform than a ledge and an enormously better one than nothing.
    corpseW: 5.2,
    corpseH: 6.0,
  },

  // ------------------------------------------------------------------- misc
  bestLineFadeU: 90,      // how near the best-height marker must be to show
  deathToPlayMs: 900,     // budget for the death → next attempt transition
};

/**
 * BIOMES — the palette shifts every 150 m and cross-fades over the last 20.
 * Three hues on screen at most: a base gradient, the geometry, one accent.
 * Height is legible from a single frame, which is the whole point.
 */
export const BIOME_SPAN = 150;
export const BIOME_FADE = 20;

export const BIOMES = [
  {
    // The base gradient is warm near-black, not the cold blue-black the other
    // biomes use. Warm bone geometry composited at low alpha over a COLD
    // background averages to neutral, and a third of the frame measured as
    // flat grey on that combination alone. A biome's background has to agree
    // with its geometry or the two cancel each other into mud.
    name: 'ASH',
    bgTop: [0x0b, 0x06, 0x04], bgBot: [0x1a, 0x0e, 0x08],
    rock: [0xe8, 0xc0, 0x8a],       // warm bone
    accent: [0xff, 0x7a, 0x2e],     // ember
    ambient: 0.30, shaft: 0.18, sat: 1.20,
  },
  {
    name: 'SIGNAL',
    bgTop: [0x03, 0x08, 0x0f], bgBot: [0x06, 0x12, 0x1c],
    rock: [0x2e, 0x8f, 0xa8],       // deep cyan
    accent: [0xe8, 0xfb, 0xff],     // electric white
    ambient: 0.26, shaft: 0.22, sat: 1.06,
  },
  {
    name: 'BLOOM',
    bgTop: [0x07, 0x04, 0x10], bgBot: [0x12, 0x08, 0x1e],
    rock: [0x7b, 0x53, 0xc8],       // violet
    accent: [0xff, 0x4f, 0xc4],     // magenta
    ambient: 0.24, shaft: 0.26, sat: 1.12,
  },
  {
    name: 'VOID',
    bgTop: [0x00, 0x00, 0x00], bgBot: [0x05, 0x05, 0x07],
    rock: [0x3a, 0x36, 0x2c],       // near black
    accent: [0xf5, 0xc3, 0x5c],     // gold
    ambient: 0.16, shaft: 0.30, sat: 1.18,
  },
  {
    name: 'CINDER',
    bgTop: [0x0c, 0x02, 0x04], bgBot: [0x18, 0x05, 0x08],
    rock: [0xc4, 0x3a, 0x3a],
    accent: [0xff, 0xd0, 0x6a],
    ambient: 0.14, shaft: 0.34, sat: 1.24,
  },
  {
    name: 'GLACIER',
    bgTop: [0x02, 0x07, 0x0d], bgBot: [0x05, 0x11, 0x1d],
    rock: [0xa9, 0xdc, 0xf0],
    accent: [0x6d, 0xf0, 0xff],
    ambient: 0.12, shaft: 0.38, sat: 1.30,
  },
];

/** Gold is the colour of memory: old corpses cool toward it whatever the biome. */
export const MEMORY_GOLD = [0xc9, 0x9a, 0x4a];

const lerp = (a, b, t) => a + (b - a) * t;

/** The biome at a height, already cross-faded. Allocation-free: fills `out`. */
export function biomeAt(y, out) {
  const raw = y / BIOME_SPAN;
  const i = Math.max(0, Math.floor(raw));
  const a = BIOMES[i % BIOMES.length];
  const b = BIOMES[(i + 1) % BIOMES.length];
  const into = y - i * BIOME_SPAN;
  const t = into > BIOME_SPAN - BIOME_FADE
    ? (into - (BIOME_SPAN - BIOME_FADE)) / BIOME_FADE
    : 0;

  for (let c = 0; c < 3; c++) {
    out.bgTop[c] = lerp(a.bgTop[c], b.bgTop[c], t);
    out.bgBot[c] = lerp(a.bgBot[c], b.bgBot[c], t);
    out.rock[c] = lerp(a.rock[c], b.rock[c], t);
    out.accent[c] = lerp(a.accent[c], b.accent[c], t);
  }
  out.ambient = lerp(a.ambient, b.ambient, t);
  out.shaft = lerp(a.shaft, b.shaft, t);
  out.sat = lerp(a.sat, b.sat, t);
  out.name = t > 0.5 ? b.name : a.name;
  out.index = i;
  out.blend = t;
  return out;
}

export function newBiomeSlot() {
  return {
    bgTop: [0, 0, 0], bgBot: [0, 0, 0], rock: [0, 0, 0], accent: [0, 0, 0],
    ambient: 0, shaft: 0, sat: 1, name: 'ASH', index: 0, blend: 0,
  };
}
