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

  // ------------------------------------------------------- READABILITY DIALS
  //
  // The knobs that answer "I still cannot read X" — gathered here so they can be
  // turned without reading the renderer. Everything in this block is PRESENTATION
  // ONLY: no value here can reach the simulation, and the acceptance suite proves
  // it (the same drag lands in the same place whatever these say).
  //
  // Note on the names: this mirrors a requested `VISUAL_TUNING` block, adapted to
  // the scales this engine actually uses rather than copied. Where a dial already
  // existed it was MOVED here rather than duplicated, so there is still exactly
  // one source of truth per number. Two of the requested dials are not here
  // because they are not canvas values at all — the title's opacity and the CTA's
  // pulse live in `style.css` as `--title-op` and `--cta-pulse`.
  visual: {
    // THE PLAYER.
    //
    // Draw-only, and anchored at the FEET. The collision box is `body` above and
    // is not touched — so the figure grows upward out of the surface it stands
    // on and its contact point stays exactly where the physics puts it. Corpses
    // are deliberately NOT scaled: a corpse is a platform, and drawing a platform
    // wider than it catches is the one lie this renderer refuses (see the
    // crest-width note in `_solids`).
    playerScale: 1.18,
    playerCoreIntensity: 0.95,  // the white point at the chest
    playerRimIntensity: 0.42,   // the single lit edge. One side only.
    playerContactShadow: 0.55,  // the shadow directly underfoot
    // The core breathes while you stand. ONLY the core — the body stays still
    // enough that this can never read as input lag.
    idlePulseSpeed: 1.15,       // radians/second
    idlePulseAmp: 0.20,         // share of the core's brightness it gives up
    // THE LANDING, which is three small things and deliberately not a system.
    landingSquashKick: 9,       // impact -> squash spring, main.js
    landingDust: 3,             // particles, hard ceiling
    landingDustSpeed: 0.42,     // slower than a death burst: dust, not shrapnel
    landingFlash: 0.55,         // how hard the landed ledge answers
    landingFlashMs: 260,

    // THE PLATFORMS, as three materials rather than one shape at six distances.
    // Brightness, implied thickness and a shadow — never more saturation.
    activePlatformGlow: 0.72,   // the ledge under your feet
    inactivePlatformGlow: 0.30, // every other ledge
    platformShadow: 0.55,       // the dark band under a crest, which is what
                                // makes a slab read as having a front face

    // THE LANDMARK. It is scenery and it is a secret you can claim, so it can
    // never out-shout a hold. It reads by being DARKER than everything near it.
    // Only the wash survived. A mass stroke and an accent edge pass were both
    // built here and both deleted after a screenshot — see `_landmarks` for the
    // frame that killed them and why a dark outline makes a thin line LOUDER.
    landmarkQuiet: 0.30,        // how far the wall behind it is pushed down

    // THE DEATH, AS STONE SETTLING RATHER THAN AS AN EXPLOSION.
    //
    // A death used to be a full-screen white wash and twenty-two bright shards
    // that flew outward and were pulled back in. That is a detonation, and this
    // game's one sentence is EVERY DEATH LEAVES A STONE — the moment should read
    // as something heavy arriving, not as something bright going off.
    //
    // Four dark chips with a lit top edge, thrown a short way, falling under
    // their own gravity, and coming to rest on the line the corpse's shelf sits
    // on. They do not BECOME the body — the body is already there, placed by the
    // simulation, and drawing a second one would be two objects claiming the
    // same surface. They land on it and fade, so what is left standing is the
    // thing you can climb on.
    deathFragments: 4,          // 3-5 reads as pieces; more reads as debris
    deathFragSpeed: 0.55,       // a fraction of a shard's throw
    deathFragGravity: 210,      // world units/s^2. Heavier than the player: rock
    deathFragLife: 1.15,        // seconds, including the rest at the bottom
    deathFlash: 0.16,           // was 1.0, a full white screen. See `handleDeath`
    // And the newest stone keeps a warm heart for a few seconds, which is the
    // only moment the tower ever says something back.
    cairnPulse: 0.55,           // depth of the breath, as a share of the bloom
    cairnPulseRate: 2.4,        // radians/second

    // THE ONE BACKGROUND STRUCTURE.
    //
    // Distinct from `landmark` above, which is a GAMEPLAY object: it sits in the
    // play plane, you can aim into its heart and claim it, so it can never take
    // a parallax offset without making that secret unaimable. This is the other
    // thing — scenery with no rules attached, far enough back to move at a
    // fraction of the camera and dark enough to be a hole rather than a shape.
    //
    // A BROKEN RING, because the painted plate behind it is already full of
    // arcs and a second vocabulary would read as two games. Drawn over the lit
    // facade rather than under it: it has to TAKE light away to have presence,
    // and something behind a lit wall cannot.
    monolith: {
      opacity: 0.55,      // of the dark mass, over the wall
      parallax: 0.045,    // share of the climb it travels. Almost still.
      // BOTH SIZES WERE SHOT ON A PHONE AND THE BIG ONE WON.
      //
      // The argument for shrinking it was that at 120 the ring is 240 units
      // across against a 150-unit view, so a player never sees the whole
      // machine — only a slab of curve. That is true and it does not matter: at
      // 86 the ring fits, reads as a dark disc off to one side, and stops being
      // enormous, which was the entire job. Scale comes from an object running
      // off the edges of the frame; a landmark you can see all of is a prop.
      radiusU: 120,       // world units at the reference zoom
      edge: 0.13,         // the two or three lit arcs on its rim
      quiet: 0.34,        // the black it sits in
      hubR: 0.13,         // the black centre, as a share of the radius
      gapFrom: 0.62,      // where the ring is broken, in turns
      gapTo: 1.02,
    },
  },

  // -------------------------------------------------------------- the tower
  //
  // The face of the building you climb. Everything is in WORLD units so the grid
  // scales with the zoom instead of shimmering, and every pane is a hash of its
  // own grid cell rather than stored state — so a floor looks the same each time
  // you pass it, and nothing is retained between frames.
  facade: {
    halfW: 46,          // half the facade width, world units. Wider than COLUMN
                        // (100) is deliberate: it must run past both edges so it
                        // reads as a building and not an object in space.
    // BIG WINDOWS, FEW OF THEM.
    //
    // At 7.0 by 6.5 the facade carried around a hundred small squares in a tight
    // grid and read as a waffle. The reference this is aimed at shows perhaps a
    // dozen LARGE openings with darkness between them: the count is the thing
    // that reads, not the detail. Doubling the cell quarters the number of panes
    // and doubles their size, which also halves the loop this pass runs.
    floorU: 14.0,       // a storey, world units
    colU: 13.0,         // a window bay
    lineU: 0.34,        // mullion width
    // CRUSHED, DELIBERATELY AND HARD.
    //
    // Reference art for this game is near-black across ninety percent of the
    // frame with a handful of tiny intense highlights, and the facade as first
    // built was lit more or less evenly everywhere — which is why the frames
    // read as busy rather than as deep. Dynamic range is the whole difference
    // between the two, far more than any amount of detail: a wall you can see
    // everywhere has no darkness for a light to matter against.
    faceAlpha: 0.045,
    gridAlpha: 0.030,
    litFrac: 0.22,      // a few of the large panes are lit, and the rest of
    litA: 0.045,        // the wall stays dark enough to fall into
    // A tower with an even scatter of lit windows is a texture. Real ones have
    // whole dark storeys and bands of narrow service slits, and it is that
    // vertical irregularity — not the windows themselves — that reads as
    // architecture rather than as a pattern.
    darkFloorFrac: 0.42,   // most storeys are simply dark
    serviceFrac: 0.12,
    // THE REFLECTION, which is the one idea here that belongs to this game
    // alone: the player is the only real light source, and glass is the one
    // surface that can answer it. The radius is generous on purpose — the read
    // is your light travelling across the building as you climb, not a single
    // pane switching on.
    // TIGHTER AND FAINTER THAN IT WAS.
    //
    // At radius 52 and strength 0.62 the reflection lit every pane within a
    // huge circle, and once the facade itself was crushed dark that circle
    // became the brightest thing in the frame — a glowing orange blanket half a
    // screen wide, with the climber a small dark mark inside it. The reference
    // this is aimed at has ISOLATED points of light in blackness. The reflection
    // is a touch on the glass beside you, not a floodlight: the player is the
    // source, and a source must stay brighter than anything it lights.
    reflectU: 26,
    reflectA: 0.30,
    maxPanes: 900,      // a hard ceiling, so a pulled-back frame cannot spiral
    // A SECOND TOWER FURTHER OFF, AND THE AIR BETWEEN. One plane gave the world
    // a surface but no depth, and depth is most of what the reference art is
    // doing. Finer grid, slower parallax, dimmer lights — and haze, without
    // which a far building just reads as a dim near one.
    deep: {
      scale: 0.42,        // world scale of the distant tower
      parallax: 0.35,     // how much of the camera's motion it takes
      floorU: 16.0,
      colU: 15.0,
      gridAlpha: 0.045,
      litFrac: 0.16,
      litA: 0.030,
      darkFloorFrac: 0.5,
      maxPanes: 420,
      hazeTop: 0.55,      // the veil, densest at the top of the frame
      hazeMid: 0.34,
      hazeBot: 0.20,
    },
  },

  // A warm pool of light bleeding off a ledge onto the wall behind it. In the
  // reference art a platform is not a bright line, it is a light SOURCE with a
  // glow around it, and that glow is most of what makes it read as a solid
  // thing sitting in front of a wall rather than a stripe painted on it.
  ledgeGlow: {
    // TIGHT AND FAINT. At radius 26 and 0.30 the pools from four or five ledges
    // overlapped and flooded the frame in orange — brighter than before the
    // darkening pass that was supposed to make room for them. A glow that
    // reaches the next platform is not a platform's glow, it is ambient light,
    // and ambient light is exactly what this art direction does not have.
    radiusU: 13,
    alpha: 0.16,
  },

  // The painted background plate. See `_plate`: this is the one place the game
  // ships an external file, and it exists because vector drawing could match the
  // reference art's mood but not its medium.
  plate: {
    parallax: 0.22,   // fraction of the climb the background travels
    alpha: 0.62,
    sink: 0.46,       // pushed back into the dark, or it eats the range
    tint: 0.10,       // graded toward the biome so six floors are not one photo
  },

  // ------------------------------------------------------------ the shadow
  //
  // The only thing in this game that tells you HEIGHT without a number. There is
  // no third axis and no perspective camera, so the drop below you was
  // previously something you inferred from the altitude readout rather than
  // something you saw. The shadow sits on the surface underneath, separates from
  // your feet as you rise, and rushes back to meet you as you fall.
  //
  // It is cast from the same width the physics catches you on, so a MEMORY
  // corpse — which holds nothing — casts nothing. The shadow can never promise
  // a landing the collision will refuse.
  shadow: {
    rangeU: 34,     // how far down it still reads, world units
                    // Strength directly underfoot lives in `visual`
                    // (playerContactShadow); it falls off with the square of
                    // the gap from there.
    wideAt: 1.9,    // width multiple at the far end of the range
    flatten: 0.30,  // ellipse squash, so it lies ON the surface
  },

  // ------------------------------------------------------------- the figure
  //
  // How the LIVING body carries itself. Pure presentation — nothing here can
  // reach the simulation, and it is checked that way: the same drag has to land
  // in the same place whatever the figure happens to be doing at the time.
  //
  // The player used to be a four-point diamond while every corpse was a human
  // silhouette, so you were an abstract shape alive and a person once dead. The
  // premise is that the thing that lands becomes the stone; it should be
  // possible to SEE that it is the same body.
  figure: {
    ease: 11.0,           // how fast a stance is taken, per second
    aimLean: 0.055,       // aim direction -> lean, per world unit of arc
    flightLean: 0.011,    // horizontal speed -> lean
    flightStretch: 0.006, // fall speed -> extension along flight
    landCrouch: 2.2,      // impact squash -> gather, so a landing is absorbed
    // IDLE. A perfectly still body is the clearest tell that a thing is a
    // sprite rather than a character. Small enough to read as breathing and
    // never as drift; faded out entirely the moment you aim or leave the ground.
    idleEase: 3.0,
    breatheRate: 2.1,     // radians/second
    breatheAmp: 0.030,
    swayRate: 0.83,       // slower than the breath, so the two never beat
    swayAmp: 0.10,
    // THE GAZE. Eased faster than the body, because a head turns before the
    // weight follows, and that lag is most of what separates a creature from a
    // rigid shape. A corpse is always given 0: the dead do not look anywhere,
    // and that is the clearest tell between you and the tower beneath you.
    lookEase: 16.0,
    lookGain: 1.5,
    // How strongly a CORPSE still shows its floor's uniform, on top of the fade
    // its own solidity already applies. Held below 1 deliberately: the tower is
    // read for whether a body holds weight first and for what it was wearing
    // second, and acceptance 13 measures exactly that order.
    corpseCostume: 0.70,
    // The bright point at the chest. The player is not a bright object, the
    // player is the light source — and a source is a point, not a glowing body.
    coreR: 0.30,
    // THE BODY IS DARK. It used to be filled in near-white at 0.97, so the
    // brightest thing on screen was the silhouette itself and the core had
    // nothing to be brighter than. A source is a point; the body carrying it is
    // lit, not luminous.
    bodyDim: 0.26,     // how far the character's own colour is pulled down
    bodyAlpha: 0.95,
    // And a thin lit edge where the body catches its own core, so a dark
    // silhouette reads as a solid object and not as a hole cut in the scene.
    // Its strength is `visual.playerRimIntensity`; these two are its shape.
    rimW: 0.16,
    rimOff: 0.07,
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
    // Full spread of a corpse's resting angle, radians. 1.1 (+/-31 degrees) was
    // enough to stop bodies tessellating at all, so a pile of them read as
    // debris rather than as the cairn the game is named for. 0.28 is about
    // +/-8 degrees: enough that no two bodies look stamped from the same die,
    // little enough that they stack.
    corpseRot: 0.28,
    // How much of the lit facade a body blocks. NOT scaled by erosion: a body
    // that still holds weight is a solid object, and a decayed one letting more
    // of a lit building through than a whole one made transparency read as
    // brightness and inverted the erosion tell in three of six palettes.
    corpseOcclude: 0.94,
    // WHERE A MEMORY BODY LANDS, as a fraction of its own palette's accent
    // luminance. A ratio rather than a subtraction, because each palette starts
    // from a different brightness and MEMORY_GOLD is one fixed colour: a
    // constant dim held in ASH and broke in three of the other five, with BLOOM
    // drawing a memory corpse BRIGHTER than a fresh one. Brightness is how a
    // player judges whether a hold still takes their weight, so the relationship
    // has to survive every palette — including ones not written yet.
    memoryOf: 0.34,
    // The crack hairlines on a THIN body. Held well below the step between
    // erosion stages: at 0.55 they darkened THIN past TOP, so a decoration was
    // overruling the tell it exists to support.
    crackInk: 0.07,
    // Constant floor under a corpse's fill alpha. Kept small so most of the
    // alpha rides on solidity and the four stages separate by construction.
    fillFloor: 0.04,
    // THE EROSION LADDER, as multipliers on a body's own colour. Decay used to
    // be expressed as transparency, and a translucent body shows whatever
    // happens to be behind it — which is not a property of the body, and broke
    // the read one palette at a time. A multiplier on the same base colour is
    // monotonic in every palette by construction rather than by calibration.
    thinOf: 0.52,
    topOf: 0.27,
    memOf: 0.14,   // and MEMORY is one rung below TOP, on the same base
    bodyAlpha: 0.93,
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
    // Dropped from 0.30 with the facade: these diagonals were tolerable across a
    // cave of soft ridges and fight an orthogonal window grid badly — two
    // structures competing to be the building. The tower is the building now.
    alpha: 0.15,          // it is scenery; the ledges must stay the readable layer
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

/**
 * THE FLOORS OF THE TOWER, in the order `BIOMES` declares them.
 *
 * The world was six abstract "biomes" and read as an abstract cave, which is
 * the note this project kept getting: it looks generic. It is the same six
 * altitude bands, given a subject — a BUILDING, climbed from the lobby to the
 * roof — and the palettes already fit it almost exactly. ASH's warm brass is a
 * lobby, SIGNAL's cold screen-blue is an office floor, CINDER's red heat is
 * plant machinery, GLACIER's ice is the sky at the top. Nothing about the
 * validated colour work moves; it is named rather than repainted.
 *
 * COSTUME. The climber dresses for the floor. This is the "different character"
 * idea in the one place it does not break anything: keyed to ALTITUDE rather
 * than to each jump, so every body left on a given floor wears the same thing
 * and the silhouette still says only one thing about whether a corpse holds
 * weight. Per-jump characters would have made shape vary for a reason unrelated
 * to erosion, which is the one read the tower cannot lose.
 *
 * Each costume is a handful of vector marks on the shared silhouette — no
 * sprite, no atlas, no asset. `detail` scales them; the marks are also faded by
 * a corpse's remaining solidity, so a body that no longer holds weight loses its
 * uniform as it goes. That is both the right image and what keeps acceptance 13
 * measuring erosion instead of measuring clothes.
 */
/**
 * TEN CLIMBERS, as numbers.
 *
 * A character here is not a drawing — it is proportion plus one identifying
 * mark on the shared rig. That is a deliberate choice and not a compromise:
 * proportion is what the eye actually reads at the size a phone renders a body
 * (roughly twenty pixels tall), where a painted face is mud. Head size alone
 * separates "cute animal" from "heroic adult" before any detail is visible.
 *
 *   head   head radius as a fraction of half-height. 0.26 reads adult,
 *          0.42 reads cartoon, 0.5+ reads toy.
 *   limb   limb stroke width against half-width. Thin is nimble, thick is heavy.
 *   torso  shoulder width. Narrow is agile, wide is powerful.
 *   leg    leg length against the space below the hip; long legs read athletic.
 *   skin   the body colour. Everything else on screen comes from the biome, so
 *          this is the ONE colour a player owns and recognises as theirs.
 *   ink    the detail colour for the mark.
 *   mark   the single identifying feature drawn on top — see `characterMark`.
 *
 * All ten keep the same bounding box, because the box is the physics. A tall
 * character is not a character with a longer jump; nothing here reaches the
 * simulation, and acceptance test 1 exists to keep it that way.
 */
export const CHARACTERS = [
  { id: 'climber',  name: 'CLIMBER',   head: 0.27, limb: 0.20, torso: 0.46, leg: 0.54,
    skin: [0xf2, 0xf4, 0xf7], ink: [0x1a, 0x18, 0x22], mark: 'helmet' },
  { id: 'courier',  name: 'COURIER',   head: 0.29, limb: 0.17, torso: 0.42, leg: 0.58,
    skin: [0xff, 0xd8, 0x6b], ink: [0x24, 0x1c, 0x18], mark: 'pack' },
  { id: 'astro',    name: 'ASTRONAUT', head: 0.38, limb: 0.30, torso: 0.56, leg: 0.46,
    skin: [0xe9, 0xee, 0xf6], ink: [0x2c, 0x6b, 0xd8], mark: 'visor' },
  { id: 'cat',      name: 'CAT',       head: 0.44, limb: 0.16, torso: 0.38, leg: 0.48,
    skin: [0xff, 0xa8, 0x5c], ink: [0x2a, 0x18, 0x14], mark: 'ears' },
  { id: 'bear',     name: 'BEAR',      head: 0.42, limb: 0.30, torso: 0.60, leg: 0.42,
    skin: [0xb5, 0x7a, 0x4a], ink: [0x2a, 0x1a, 0x12], mark: 'round-ears' },
  { id: 'diver',    name: 'DIVER',     head: 0.30, limb: 0.19, torso: 0.44, leg: 0.60,
    skin: [0x36, 0xc7, 0xc0], ink: [0x08, 0x2c, 0x38], mark: 'mask' },
  { id: 'robot',    name: 'ROBOT',     head: 0.32, limb: 0.26, torso: 0.52, leg: 0.48,
    skin: [0xc8, 0xcf, 0xd8], ink: [0xff, 0x5e, 0x3a], mark: 'antenna' },
  { id: 'monk',     name: 'MONK',      head: 0.26, limb: 0.22, torso: 0.50, leg: 0.50,
    skin: [0xd8, 0x64, 0x3c], ink: [0x1e, 0x12, 0x10], mark: 'hood' },
  { id: 'acrobat',  name: 'ACROBAT',   head: 0.22, limb: 0.13, torso: 0.34, leg: 0.66,
    skin: [0xff, 0x74, 0xb8], ink: [0x2a, 0x10, 0x26], mark: 'ribbon' },
  { id: 'lantern',  name: 'LANTERN',   head: 0.40, limb: 0.14, torso: 0.36, leg: 0.50,
    skin: [0xff, 0xe9, 0x9a], ink: [0x3a, 0x2a, 0x08], mark: 'flame' },
];

export const FLOORS = [
  { name: 'LOBBY',      costume: 'waiter',   detail: 1.00 },
  { name: 'OFFICES',    costume: 'suit',     detail: 1.00 },
  { name: 'POOL',       costume: 'swim',     detail: 0.92 },
  { name: 'RESIDENCES', costume: 'robe',     detail: 0.95 },
  { name: 'PLANT',      costume: 'hivis',    detail: 1.00 },
  { name: 'ROOF',       costume: 'harness',  detail: 1.00 },
];

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
    ambient: 0.30, sat: 1.20,
  },
  {
    name: 'SIGNAL',
    bgTop: [0x03, 0x08, 0x0f], bgBot: [0x06, 0x12, 0x1c],
    rock: [0x2e, 0x8f, 0xa8],       // deep cyan
    accent: [0xe8, 0xfb, 0xff],     // electric white
    ambient: 0.26, sat: 1.06,
  },
  {
    name: 'BLOOM',
    bgTop: [0x07, 0x04, 0x10], bgBot: [0x12, 0x08, 0x1e],
    rock: [0x7b, 0x53, 0xc8],       // violet
    // BRIGHTER THAN MEMORY_GOLD, WHICH IS A CONSTRAINT AND NOT A PREFERENCE.
    //
    // This was #ff4fc4 at luminance 124.9 against MEMORY_GOLD's 158.2 — the one
    // palette whose accent is DARKER than the colour a body cools toward. So in
    // BLOOM every step toward memory made a corpse brighter, and the erosion
    // tell inverted no matter what the renderer did: six separate engine fixes
    // moved it a point or two each and none could win, because the fight was
    // with the palette, not the code. Any accent must sit above MEMORY_GOLD or
    // age cannot read as fading anywhere in that biome.
    accent: [0xff, 0x8f, 0xd8],     // magenta, lifted above memory gold
    ambient: 0.24, sat: 1.12,
  },
  {
    name: 'VOID',
    bgTop: [0x00, 0x00, 0x00], bgBot: [0x05, 0x05, 0x07],
    rock: [0x3a, 0x36, 0x2c],       // near black
    accent: [0xf5, 0xc3, 0x5c],     // gold
    ambient: 0.16, sat: 1.18,
  },
  {
    name: 'CINDER',
    bgTop: [0x0c, 0x02, 0x04], bgBot: [0x18, 0x05, 0x08],
    rock: [0xc4, 0x3a, 0x3a],
    accent: [0xff, 0xd0, 0x6a],
    ambient: 0.14, sat: 1.24,
  },
  {
    name: 'GLACIER',
    bgTop: [0x02, 0x07, 0x0d], bgBot: [0x05, 0x11, 0x1d],
    rock: [0xa9, 0xdc, 0xf0],
    accent: [0x6d, 0xf0, 0xff],
    ambient: 0.12, sat: 1.30,
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
    ambient: 0, sat: 1, name: 'ASH', index: 0, blend: 0,
  };
}
