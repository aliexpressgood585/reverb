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
    // AND WHETHER IT BUYS ANYTHING.
    //
    // The ghost drew every prospective corpse identically, so the screen said
    // "you will die here" and never "and it will get you up there" — the
    // decision the whole design rests on was on screen and unreadable. When the
    // body would put a ledge in reach that is not in reach from this perch, it
    // is drawn in the LIVING accent instead of the gold of memory, brighter and
    // heavier, and the ledge it buys takes a ring. Nothing is written; the
    // difference between throwing yourself away and spending yourself is a
    // colour. See DECISIONS §29.
    ghostGainAlpha: 0.92,
    ghostGainWidth: 2.1,
    gainRingU: 9,         // radius of the ring on the ledge it buys, in units
    gainRingAlpha: 0.5,
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
    // THE GAP THAT LEAVES THE ON-RAMP IS ONE, ALWAYS.
    //
    // The curve alone put the first constructed gap at a median of 233.6 m and
    // rolled it 45% of the time, against a novice whose median death is 119 m —
    // so the premise of the whole game arrived late, at random, or never, and
    // the first sixty seconds were an ordinary jumping game. This makes it a
    // promise instead, the same way the on-ramp itself is a promise and not a
    // curve. Measured after: perch at a median 74.0 m, the ledge it must reach
    // at 90.5 m, in 59 of 60 towers.
    //
    // A knob rather than a constant so `cairn-hook-check.mjs` can be falsified:
    // --tune='{"rampHard":false}' must take that check red.
    rampHard: true,
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
    // THE BLOOM ON A BODY'S SHELF, as a multiplier on the additive pass a ledge
    // crest has always had. A generated ledge glowed and the thing this game is
    // named after did not: measured side by side at the same height and the same
    // distance from the player's light, the world's hold read 1.13x the peak of
    // the one you made, and 1.00x with this at 1.
    //
    // A tunable rather than a constant buried in the renderer for two reasons.
    // feel.js is the only file allowed to hold tuning numbers — and a frame-cost
    // measurement has to be able to turn the pass OFF and interleave, which is
    // the only honest way to price a draw call on a software rasteriser where
    // two runs of identical code differ by more than the thing being measured.
    corpseBloom: 1.0,
    corpseBloomBase: 0.05,   // floor, so a body away from the light still catches
    corpseBloomLit: 0.30,    // how much of it is the player's own light
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

    // PRESSURE THAT DOES NOT SATURATE.
    //
    // A person reached 4,731 m having died once, and the models agree: expert
    // first attempts passed 600 m 76% of the time against a target that says
    // "not on a first attempt". The tower had no ceiling, and the reason was
    // structural rather than a number being wrong — `diff` saturates, the verb
    // rates are constants, and each verb lives in one biome of six. The entire
    // hazard budget repeated every 900 m instead of growing.
    //
    // Two things now escalate with ABSOLUTE height, and neither can create a
    // wall. A crumbling hold gives less time the higher it is, which can take a
    // perch away but never make one unreachable. And above `mixFrom` the tower
    // stops respecting biome borders, so the verbs a player met one at a time
    // start arriving together — the biomes still teach them in isolation, the
    // altitude stops being polite about it.
    //
    // This is the right lever because precision is not one: a jump forgives
    // about twenty degrees and one pixel of thumb is 0.31, so no amount of
    // narrowing ever threatens a good hand. Time does.
    mixFrom: 700,         // metres above which verbs cross biome borders
    mixSpan: 1600,        // metres over which that reaches full strength
    mixRate: 0.42,        // share of out-of-biome ledges that crumble, at full
    tightenSpan: 1400,    // metres over which a hold's grace time halves
    crumbleMsFloor: 420,  // never shorter than the warning it shows first

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

  // ---------------------------------------------------------------- momentum
  // Consecutive clean landings. The loop had no voice saying "you are doing
  // well"; this is that voice, and it never says it in words or in a bar.
  //
  // It deliberately does NOT touch launch power. Launch speed has to stay a
  // pure function of the drag, because the reach envelope every generated gap
  // is built inside is derived from `launch.maxSpeed`. Make speed a function of
  // run state and WALL = 0.00% stops being a bound and becomes a coincidence.
  // The brief's "small launch bonus" is the one part of §4 not built, on
  // purpose. See DECISIONS §27.
  momentum: {
    max: 8,
    lightGain: 0.55,      // extra player-light radius at full momentum
    lightAlpha: 0.42,     // extra core brightness at full momentum
    trailGain: 0.85,      // extra trail life at full momentum
    bedGain: 900,         // extra ambient filter cutoff, Hz, at full momentum
    ease: 5.0,            // how fast the presentation follows the counter
  },

  // -------------------------------------------------------------- close calls
  // Manufacturing the memory of the moment, which is what people retell.
  closeCall: {
    // Land within this of the lip and it is a close call — AND the momentum
    // streak breaks. One number, so the scare and the reset can never disagree.
    marginU: 2.0,
    dilation: 0.35,       // time scale during the beat
    dilationMs: 260,
    // A body this many deaths from MEMORY — the close call only this game can
    // have. The fact has been in the data since erosion shipped and nothing
    // ever said it out loud.
    //
    // Measured over 48,393 bot landings: 1 → 0.095 per 100 landings, 2 → 0.176,
    // 3 → 0.248. The literal reading of the brief is 1, and 1 is one event per
    // 1,050 landings: shipped and never seen by almost anyone, which defeats
    // the point of saying it. 3 is the last three deaths of a TOP corpse's
    // ten-death shelf life — still honestly "about to stop being a platform",
    // and about one per session. Rare stays rare; it stops being invisible.
    doomedWithin: 3,
    doomedDilation: 0.28,
    doomedMs: 420,
  },

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

    // DISCOVERY. Two fingers is the only gesture that cannot collide with
    // aiming — a swipe down IS a launch downward in a direct-aim game — and a
    // game with no text has nothing to point at it with. So the game performs
    // the gesture's RESULT instead: on the record-setting deaths listed here it
    // opens the monument by itself, after control has already come back, and a
    // single touch closes it. Having seen the view is what makes anyone go
    // looking for the way back to it.
    //
    // A nudge, not a habit. The schedule is sparse, and the first time the
    // player opens the monument with two fingers of their own the nudges stop
    // forever — a player who has learned it is never interrupted again.
    revealAt: [1, 4, 10],  // which record-setting deaths open it unprompted
    revealMinBodies: 3,    // ... and only once there is a tower worth showing
  },

  // ------------------------------------------------------------- landmarks
  //
  // THE TOWER HAD ONE NOUN.
  //
  // Four and a half thousand audited gaps and every one of them was "a ledge".
  // A biome changed the hue and added a verb; the 500th metre was the 50th in a
  // different colour. Nothing in the world was a THING — no structure, no ruin,
  // nothing to say what this place is or to climb TOWARD. A climb with no
  // destination is a number going up.
  //
  // A landmark is DECORATION AND ONLY DECORATION. It has no collision, the
  // generator does not know it exists, and it cannot move a single ledge — so
  // it cannot touch `WALL = 0.00%`, which is the one thing that must never be
  // risked for a picture. What it changes is that there is now something large
  // and specific above you, at a known height, in every biome.
  //
  // One per biome, at the CENTRE of the band, which puts the first at 75 m —
  // inside the opening view from the ground, so the very first screen a player
  // ever sees has a structure in it.
  landmark: {
    spanU: 190,           // world units of height the shape occupies
    // A 390x844 phone at the default 150u view shows about 69u of WIDTH, not
    // the 100u column — the camera tracks x. The first draft was 132u wide, so
    // every shape overflowed the glass and the furnace's brick courses read as
    // full-width scanlines rather than as masonry. 86u fills the frame and
    // still overhangs it slightly, which is what a large structure should do.
    widthU: 86,
    alpha: 0.30,          // it is scenery; the ledges must stay the readable layer
    lineU: 1.5,           // stroke weight in world units, so it scales with zoom
    detail: 9,            // repeated elements per shape — keep the path cheap
    fadeU: 150,           // fades in over this much approach, so it arrives
    // AND RECEDES AGAIN ONCE YOU ARE INSIDE IT.
    //
    // The first version was at FULL strength exactly when the player was in the
    // middle of it, which is backwards twice over. Artistically, a structure
    // reads as enormous while you approach and should become ambience once you
    // are climbing through it. Practically, its strokes were crossing the
    // corpses at the one distance where telling FRESH from TOP from MEMORY
    // matters most — acceptance test 13's separation between neighbouring
    // erosion stages fell from 49.2 to 4.8 with landmarks in, which is the
    // readable layer losing to the scenery layer.
    insideFade: 0.78,     // share of the alpha given up at the centre

    // THE SECRET. Nothing says this and nothing ever will.
    //
    // Leave a body within `heartU` of a landmark's anchor and the structure
    // answers — permanently, in your tower, saved. There are six of them and
    // the monument shows which ones you hold.
    //
    // It is aimable rather than lucky BECAUSE of the ghost: the aim preview
    // already draws the exact spot the corpse will come to rest (§29), so a
    // player who has noticed that has everything they need and a player who has
    // not will never stumble into it. That is the whole design — a secret whose
    // key is a thing the game already shows you and never mentions.
    // MEASURED, and the first number here was measured wrong. The landmark
    // suite's accidental-claim check fired random launches from the base, which
    // never climb — so it reported 0.88 claims per 100 deaths among deaths that
    // were never candidates for one. Asked of the REAL climber, at radius 16, a
    // player claims 4.9 per 100 deaths and 93% of towers give one up inside 40
    // attempts. That is not a secret, it is a mechanic nobody explained.
    //
    // The curve, average model, 1,600 deaths per row:
    //
    //   radius   claims/100 deaths   towers with >=1 in 40 attempts
    //      6           1.13                     38%
    //      8           2.13                     60%
    //     10           3.19                     73%
    //     12           3.88                     83%
    //     16           4.88                     93%
    //
    // 8, and the reasoning is not "as rare as possible". A secret nobody ever
    // meets is dead content, and 6 leaves 62% of players never learning the
    // mechanic exists. At 8 the FIRST one finds most people by accident — which
    // is the tutorial — and the other five have to be hunted, which is the game.
    // Same shape as the monument nudge: show it once, then let them look.
    heartU: 8,
    claimAlpha: 0.62,     // a held landmark is drawn in the living accent
    claimLightU: 26,      // and carries a light at its heart
    // AND A HELD ONE STAYS IN THE MONUMENT.
    //
    // Every other atmosphere layer fades out with the pull-back because the
    // monument is a portrait of the bodies in the tower and a skyline drawn
    // across it is clutter. A HELD landmark is not scenery though — it is
    // something the player did, on purpose, that almost nobody knows is
    // possible. It belongs in the one image they share. Unheld ones still go.
    monHeld: 0.34,
    claimPullMs: 1400,    // the camera steps back for a beat to let you see it
    claimPull: 0.42,
  },

  // ----------------------------------------------------------------- ghost
  //
  // PHASE3 §8. Your record run, standing where it stood at the same LAUNCH
  // NUMBER you are on — not at the same second. See DECISIONS §33 for why a
  // clock race is the one shape this game cannot take.
  ghost: {
    alpha: 0.30,          // memory-gold and clearly not you
    ease: 3.4,            // how fast it steps between its launch positions
    trailU: 30,           // how far back its path is drawn from where it stands
    fadeU: 120,           // fades out once it is this far off screen-centre
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
