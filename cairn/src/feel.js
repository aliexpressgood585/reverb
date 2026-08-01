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

/**
 * A biome, already cross-faded, written into a reused slot.
 * @typedef {object} BiomeSlot
 * @property {number[]} bgTop
 * @property {number[]} bgBot
 * @property {number[]} rock
 * @property {number[]} accent
 * @property {number} ambient
 * @property {number} shaft
 * @property {number} sat
 * @property {string} name
 * @property {number} index
 * @property {number} blend
 */

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
  // Aiming is DIRECT, not a slingshot: the drag vector is the launch vector.
  // Drag up-right, fly up-right. See input.js for why the slingshot lost.
  launch: {
    minSpeed: 45,
    maxSpeed: 130,
    // A resting thumb drifts. At 8 px every micro-movement fired a launch —
    // reported as "it jumps on every step". 14 px is still well inside a
    // deliberate flick and comfortably outside a shaky hold.
    deadZonePx: 14,
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
    // THE BODY YOU WOULD LEAVE.
    // When the aimed launch cannot land, the apex is drawn as the silhouette
    // you are about to become. Without it a gap placed past the reach envelope
    // reads as "the game cheated"; with it, the same gap reads as "put a body
    // there", which is the decision the whole design is built to offer.
    ghostAlpha: 0.52,
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
  //
  // The generator used to keep its own numbers, which is how a difficulty curve
  // that flat-lined at 900 m survived unnoticed: nobody reads a constant buried
  // in a while-loop. Every knob that decides how hard the tower is now lives
  // here, and BALANCE.md records what each one measured.
  tower: {
    baseWidth: 30,        // the ledge you start on. Generous on purpose.
    minRise: 15,
    maxRise: 28,
    minWidth: 6,
    maxWidth: 17,
    // Reachable ledges are never placed outside the reach envelope of a
    // full-power launch — dy + |(dx,dy)| <= v²/g — scaled down by this.
    reachSafety: 0.70,
    edgePad: 6,           // keep ledges this far inside the column

    // DIFFICULTY NEVER ARRIVES.
    //
    // This was `clamp(h / 900, 0, 1)`. Above 900 m the tower stopped changing,
    // so the game had a hardest jump and it was not very hard: a bot with 1.1°
    // of aim error climbed 84 km in a single attempt without dying once. An
    // exponential approach has no last step — it keeps taking ground off the
    // player for as long as the player keeps taking ground off it.
    diffScale: 260,       // metres to reach 63% of the way to the ceiling

    // THE ON-RAMP — PHASE3 §3, "the first jump nearly unmissable".
    //
    // The difficulty curve is already at its gentlest here, and it was not gentle
    // enough: the first ledge a new player must hit is as narrow as the curve's
    // starting width, which is a coin-flip for someone who has not worked out
    // that the drag vector IS the launch vector. A reviewer who read the source
    // concluded this was a slingshot and played it inverted, which is the
    // strongest evidence available that the aim model has to be learned on
    // ground where being wrong is survivable.
    //
    // Over `openingSpan` metres the tower blends from deliberately generous to
    // whatever the curve says. Nothing is explained; the first jumps are simply
    // hard to miss.
    openingSpan: 60,
    openingWidth: 27,     // ledge width at the very base
    openingGap: 0.55,     // share of the normal gap at the very base

    riseEase: 0.55,       // share of the rise range in play at zero height
    gapNear: 0.42,        // share of the usable gap at zero height
    gapFar: 1.00,         // ... and at full difficulty
    gapJitter: 0.45,      // how much of a gap is left to the dice
    widthEase: 0.45,      // share of the width loss that is not random

    // THE GAPS YOU CANNOT CROSS.
    //
    // Every gap used to be crossable, which sounds kind and is actually the
    // reason the loop was empty: a player who never has to fail never has to
    // use the one mechanic the game is built on. Above `overreachFrom` a share
    // of gaps cannot be made. You die at the apex and the body is the step.
    //
    // THEY ARE TOO HIGH, NOT TOO FAR, and that took two attempts to get right.
    //
    // The first version pushed them sideways past the horizontal envelope. The
    // column is only 100 u wide, so a gap long enough to be uncrossable does not
    // fit in it: `nx` clamped back inside the walls and the gap came out
    // crossable. Audited from 481 m, 27% of gaps were rolled as unreachable and
    // 2% actually were. The mechanic was being defeated by the level's own
    // width.
    //
    // Height has no such wall. A full-power launch straight up lifts the body
    // `maxSpeed^2 / 2g` plus what the apex hang adds — about 34 u. A ledge above
    // that cannot be reached however wide the column is.
    //
    // And it is bridgeable BY DESIGN, which the sideways version was not. Throw
    // slightly under full power: the apex lands lower, so the corpse's surface
    // (`peakY + corpseH/2`) stays inside reach, you land on yourself, and the
    // rest of the climb is a short hop. "Throw yourself where you can follow" is
    // a real thing to learn, and it is the whole game in one sentence.
    overreachFrom: 0.30,  // difficulty at which they start appearing
    // 0.35 was tuned when overreach was horizontal and mostly failed to bite;
    // vertical gaps genuinely cannot be crossed, so the same rate produced 14%
    // dead ends. This is the knee of the trade, audited from 481 m: 10.7% of
    // gaps need a body to bridge them, 10.4% have no route even with one, and
    // the expert model still passes 600 m on only 3.3% of first attempts. Lower
    // and the mechanic stops mattering; higher and the terrain does the killing.
    // ZERO. A player hit an unleavable ledge three times, at 391 m, 481 m and
    // 567 m, and the game is meant to be shipped.
    //
    // Every wall this game has ever produced comes from this one mechanic:
    // audited at 0 it is 100% DIRECT across 681 gaps with no dead end anywhere,
    // and at any non-zero rate roughly 5% of gaps have no route even after the
    // generator verifies each one with the real physics and demotes the ones it
    // cannot prove. Half of them were never bridgeable and a great deal of
    // measurement never explained why.
    //
    // What it costs is honest and worth stating: a BOT with 1.1 degrees of aim
    // error now climbs without dying. That was the finding this whole balance
    // effort started from — but the same measurements showed a jump forgives
    // about twenty degrees while one pixel of thumb is 0.31, so precision was
    // never what killed anyone. It killed bots. A person's ceiling here is nerve
    // and patience, and an unleavable ledge is not difficulty, it is a stop.
    //
    // The verifier in generate() stays regardless: it is now a permanent guard
    // rather than a repair, and it costs nothing while this is zero.
    overreachRate: 0,     // their share of gaps at full difficulty

    // THE GAPS A BODY MAKES EASY — the answer to what turning `overreachRate`
    // off cost.
    //
    // With every gap crossable in one jump, nobody ever needs to stand on
    // themselves, and the measurement says so: the average model landed on one of
    // its own bodies on 1.7% of landings and the expert on 0.02%. The title card
    // promises EVERY DEATH LEAVES A STONE and the tower had stopped asking for
    // one.
    //
    // An overreach gap cannot be crossed at all, which is what produced walls. A
    // HARD gap is the opposite construction and it cannot produce one: the ledge
    // is placed ON A TRAJECTORY THE PHYSICS ACTUALLY FLEW, from the worst footing
    // on the ledge below, so a single launch provably lands it. It is placed at
    // the far end of that trajectory, so the launch that makes it is nearly the
    // only launch that does — and the body you leave failing it lands in the gap
    // below the ledge, from where the rest is a hop.
    //
    // One hard jump, or two easy ones over your own corpse. The corpse is a
    // shortcut, never a rescue, and there is nothing to be rescued from.
    hardFrom: 0.32,       // difficulty at which hard gaps start appearing
    hardRate: 0.45,       // their share of gaps at full difficulty
    // How far short of the physical limit the ledge is pulled back. The
    // constructed gap sits exactly at the end of a real trajectory, which leaves
    // slack on the short side only; a few units of give makes the window
    // two-sided without making the jump ordinary.
    hardSlack: 3,
    // Rise as a share of the ordinary roll. A hard gap that also rises the full
    // amount is two demands at once, and distance is the one being made.
    hardRiseScale: 0.85,
    // Rise as a multiple of the ideal full-power lift. The floor must clear what
    // the apex hang actually buys (~1.05) or the gap is merely hard; the ceiling
    // must stay close enough that a corpse left below it finishes the job.
    overreachLift: 1.12,
    overreachLiftSpan: 0.26,
    // Overreach gaps stay nearly vertical so the body lands under the ledge it
    // is meant to reach rather than out in a gap it cannot help with.
    overreachDrift: 0.30,

    // A corpse is a narrower perch than rock. That is what makes it a worse
    // platform than a ledge and an enormously better one than nothing.
    corpseW: 5.2,
    corpseH: 6.0,
  },

  // ------------------------------------------------------------------ verbs
  //
  // ONE VERB PER BIOME, so each is learned in isolation, and none of them before
  // the on-ramp is over. PHASE3 §7 asks for exactly this and warns why it ranks
  // low: new verbs are what a designer reaches for when the loop feels thin, and
  // this loop was thin because it was too EASY, not because it was too simple.
  // The curve is fixed and measured now, so they can be added without balancing
  // four systems at once.
  //
  // Three of the four cannot create a wall, by construction:
  //
  //   CRUMBLE only affects a ledge you have already landed on, so it can take a
  //           perch away but never make one unreachable.
  //   UPDRAFT only ever ADDS reach. A gap crossable without one stays crossable.
  //   DARK    is presentation. The collision world is unchanged.
  //
  // DRIFT is the one that moves a landing target, so it is the one with a bound:
  // `driftAmp` stays well inside the 30% margin `reachSafety` already holds back,
  // and a gap cut out of a flight (`Solid.hard`) never drifts at all.
  verbs: {
    from: 0.34,           // difficulty at which verbs begin. Never on the ramp.

    // ASH — the hold gives way. You have `crumbleMs` from touching it.
    //
    // It has its own, higher, threshold: ASH is the FIRST biome, so on the
    // plain `from` the very first verb a new player met was the one that takes
    // the floor away, in 7 towers of 18 measured. Anything above the difficulty
    // at 150 m (0.438) defers it past the first ASH lap, which puts it at 900 m
    // and puts the updraft — the verb that GIVES you something — first at 150.
    // `cairn-verbs-check.mjs` test 6 is the gate on that ordering.
    crumbleFrom: 0.50,
    crumbleRate: 0.30,    // share of ASH ledges that crumble
    crumbleMs: 900,       // long enough to aim, short enough to hurry
    crumbleWarnMs: 380,   // it starts visibly failing this long before it goes

    // SIGNAL — a column of rising air. Reach, for free, if you are inside it.
    updraftRate: 0.34,    // share of SIGNAL gaps that carry one
    updraftAccel: 210,    // u/s^2 upward while inside
    updraftW: 15,         // half-width of the column
    updraftH: 74,         // how far up it reaches

    // BLOOM — the ledge will not hold still.
    driftRate: 0.36,      // share of BLOOM ledges that drift
    // u either side. NOT inside the landing forgiveness (3 u) — the margin
    // that actually holds is the 30% of the physical reach envelope every
    // ordinary gap is placed inside. Measured: cairn-verbs-check goes red
    // somewhere between 12 and 16, so this ships with about 3x of headroom.
    driftAmp: 4.0,
    driftHz: 0.16,        // cycles per second

    // VOID — you see what your own light reaches, and no further.
    darkFloor: 0.30,      // how much of the normal ambient survives
  },

  // --------------------------------------------------------------- erosion
  // How fast a corpse stops being a platform, measured in DEATHS, never in
  // seconds — see DECISIONS.md §16. These lived in sim.js as a bare array,
  // which is the same class of mistake as the generator's buried constants.
  erosion: {
    fresh: 7,             // deaths before a corpse narrows
    thin: 15,             // ... before it is a shelf you cannot cling to
    top: 25,              // ... before it stops colliding entirely

    // A corpse far below the record is archaeology, not a gate: the frontier is
    // where the game is played, and the tower underneath it is a commute. These
    // slow the ageing of corpses deep below your best.
    //
    // DEFAULT IS A NO-OP (`deepScale: 1`). Erosion exists because permanently
    // solid corpses inverted the difficulty curve, and anything that softens it
    // is walking back toward that. See BALANCE.md for what lowering it measured
    // and why it did not ship.
    deepSpan: 400,        // metres below `best` at which `deepScale` is reached
    deepScale: 1,         // ageing rate down there, 1 = no slowdown
  },

  // -------------------------------------------------------------- monument
  // MONUMENT VIEW — pull all the way back to the whole lifetime tower.
  //
  // The camera framing is derived, not guessed: the renderer puts world y at
  // `h * (0.5 - camera.playerOffsetY) - y * scale`, so to land the base near the
  // bottom of the glass and the summit near the top, the view span has to be the
  // tower's height times `pad` and the camera has to sit at `centre` of that
  // span. Change `playerOffsetY` and these two follow it.
  monument: {
    ease: 2.4,            // how fast the pull-back converges, per second
    // THE ONE TIME THE GAME EXPLAINS ITSELF, and it does it with the camera.
    // The first time a player ever stands on one of their own bodies, it pulls
    // back this far for `teachMs` and returns. No text, no pause, no control
    // taken away — just a beat where the thing that happened is impossible to
    // miss. PHASE3 §3 asks for exactly this and calls it the beat that sells the
    // game.
    teachPull: 0.38,
    teachMs: 1500,
    pad: 1.24,            // view span as a multiple of the tower's top
    centre: 0.245,        // camera height as a fraction of the span
    minSpan: 260,         // never pull back past this on a short tower
    shareDelayMs: 900,    // the pull-back finishes before anything is offered
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

/** @type {(a: number, b: number, t: number) => number} */
const lerp = (a, b, t) => a + (b - a) * t;

/** The biome at a height, already cross-faded. Allocation-free: fills `out`. */
/**
 * @param {number} y
 * @param {BiomeSlot} out filled in place; allocation-free
 * @returns {BiomeSlot}
 */
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

/** @returns {BiomeSlot} */
export function newBiomeSlot() {
  return {
    bgTop: [0, 0, 0], bgBot: [0, 0, 0], rock: [0, 0, 0], accent: [0, 0, 0],
    ambient: 0, shaft: 0, sat: 1, name: 'ASH', index: 0, blend: 0,
  };
}
