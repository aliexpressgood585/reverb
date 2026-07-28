import { SURF } from './surfaces.js';

/**
 * Five hand-built spaces. Nothing here is generated.
 *
 * Each level declares its geometry, where you start, where you leave, the
 * things that make noise on their own, and the creatures waiting in it. The
 * `space` block is fed straight into the convolution reverb, so each level
 * literally sounds like its own shape.
 */

// ---------------------------------------------------------------- 1. PLATFORM
const PLATFORM = {
  id: 1,
  name: 'PLATFORM',
  line: 'THE TRAIN IS NOT COMING',
  space: { decay: 2.9, brightness: 0.42, predelay: 0.022, spread: 1.2 },
  spawn: { x: 0, z: -17, yaw: Math.PI },
  exit: { x: -2.0, z: 25.5, r: 2.2 },
  build(b) {
    const H = 4.2;
    // platform deck
    b.floor(-7, -20, 6, 20, 0, SURF.TILE);
    b.ceiling(-7, -20, 13, 20, H, SURF.CONCRETE);
    // track bed, one step down
    b.floor(6, -20, 13, 20, -0.95, SURF.GRAVEL);
    b.wall(6, -20, 6, 20, -0.95, 0, SURF.CONCRETE, { blocksSound: false });

    // enclosure
    b.wall(-7, -20, -7, 20, 0, H, SURF.TILE);
    b.wall(13, -20, 13, 20, -0.95, H, SURF.CONCRETE);
    b.wall(-7, -20, 13, -20, -0.95, H, SURF.CONCRETE);
    // north wall with the stair opening
    b.wall(-7, 20, -4.2, 20, 0, H, SURF.TILE);
    b.wall(0.2, 20, 13, 20, -0.95, H, SURF.TILE);

    // stairwell out
    b.floor(-4.2, 20, 0.2, 28, 0, SURF.CONCRETE);
    b.ceiling(-4.2, 20, 0.2, 28, 3.0, SURF.CONCRETE);
    b.wall(-4.2, 20, -4.2, 28, 0, 3.0, SURF.TILE);
    b.wall(0.2, 20, 0.2, 28, 0, 3.0, SURF.TILE);
    b.wall(-4.2, 28, 0.2, 28, 0, 3.0, SURF.TILE);

    // pillars down the deck
    for (let z = -15; z <= 15; z += 7.5) b.block(3.4, z, 0.7, 0.7, 0, H, SURF.TILE);

    // standing water — the deck drains badly
    b.floor(-6.4, -6.5, -3.0, -2.0, 0.005, SURF.PUDDLE);
    b.floor(-1.4, 4.0, 2.2, 8.5, 0.005, SURF.PUDDLE);
    b.floor(7.0, -4.0, 12.0, 2.0, -0.945, SURF.PUDDLE);

    // a strip of rotted carpet: the quiet road, if you find it
    b.floor(-6.6, 9.0, -4.2, 19.5, 0.006, SURF.CARPET);

    // benches
    b.block(-5.4, -12, 1.5, 0.5, 0, 0.5, SURF.METAL);
    b.block(-5.4, 2, 1.5, 0.5, 0, 0.5, SURF.METAL);
  },
  drips: [
    { x: -1.0, z: -12.0, y: 4.1, every: [2.4, 4.0], gain: 0.9 },
    { x: 0.5, z: 0.0, y: 4.1, every: [3.0, 5.2], gain: 1.0 },
    { x: -2.0, z: 11.0, y: 4.1, every: [2.2, 3.6], gain: 1.1 },
    { x: -2.4, z: 19.0, y: 3.0, every: [2.0, 3.2], gain: 1.2 },
  ],
  machines: [],
  enemies: [
    { type: 'stalker', x: 9.5, z: 8, route: [[9.5, 12], [9.5, -14], [10.5, -6]] },
  ],
  trains: { every: [38, 70], gain: 0.85 },
  hint: 'WALK. LISTEN. THE DRIPS GO NORTH.',
};

// -------------------------------------------------------------- 2. TURNSTILES
const TURNSTILES = {
  id: 2,
  name: 'TURNSTILES',
  line: 'EVERY WAY THROUGH IS WET',
  space: { decay: 2.0, brightness: 0.55, predelay: 0.014, spread: 0.8 },
  spawn: { x: 0, z: -15, yaw: Math.PI },
  exit: { x: 0, z: 19.5, r: 2.2 },
  build(b) {
    const H = 3.6;
    b.floor(-16, -18, 16, 22, 0, SURF.PUDDLE);
    b.ceiling(-16, -18, 16, 22, H, SURF.CONCRETE);
    b.wall(-16, -18, 16, -18, 0, H, SURF.TILE);
    b.wall(-16, 22, 16, 22, 0, H, SURF.TILE);
    b.wall(-16, -18, -16, 22, 0, H, SURF.TILE);
    b.wall(16, -18, 16, 22, 0, H, SURF.TILE);

    // dry islands — the only silent footing in the hall
    const dry = [
      [-13, -13, -8, -8], [-3, -12, 2, -7], [8, -14, 13, -9],
      [-12, -2, -7, 3], [-2, 1, 3, 6], [7, -1, 12, 4],
      [-13, 11, -8, 16], [-2, 12, 3, 17], [8, 10, 13, 15],
    ];
    for (const [x0, z0, x1, z1] of dry) b.floor(x0, z0, x1, z1, 0.008, SURF.CARPET);

    // three ranks of turnstile stalls
    for (const z of [-6, 2, 10]) {
      for (let i = -3; i <= 3; i++) {
        const x = i * 4.4;
        b.block(x - 1.15, z, 0.55, 2.6, 0, 1.15, SURF.METAL);
        b.block(x + 1.15, z, 0.55, 2.6, 0, 1.15, SURF.METAL);
        // full-height divider on every other stall — these actually stop sound
        if ((i + 3) % 2 === 0) b.wall(x + 2.2, z - 1.6, x + 2.2, z + 1.6, 0, H, SURF.METAL);
      }
      b.wall(-16, z - 1.4, -13.4, z - 1.4, 0, H, SURF.CONCRETE);
      b.wall(13.4, z - 1.4, 16, z - 1.4, 0, H, SURF.CONCRETE);
    }

    // ticket booth
    b.block(-11, 18, 5, 3, 0, 2.6, SURF.CONCRETE);
    b.block(11, 18, 5, 3, 0, 2.6, SURF.CONCRETE);

    // exit corridor
    b.wall(-16, 20.4, -2.4, 20.4, 0, H, SURF.TILE);
    b.wall(2.4, 20.4, 16, 20.4, 0, H, SURF.TILE);
  },
  drips: [
    { x: -9, z: -3, y: 3.5, every: [2.0, 3.4], gain: 0.8 },
    { x: 6, z: 6, y: 3.5, every: [2.6, 4.2], gain: 0.9 },
    { x: 0, z: 16, y: 3.5, every: [3.0, 5.0], gain: 1.0 },
  ],
  machines: [],
  enemies: [
    { type: 'stalker', x: -12, z: 0, route: [[-12, 8], [-12, -12], [-4, -12], [-4, 8]] },
    { type: 'stalker', x: 12, z: 6, route: [[12, -10], [4, -10], [4, 14], [12, 14]] },
    { type: 'screamer', x: 0, z: 8, route: [[-8, 14], [8, 14], [8, 6], [-8, 6]] },
  ],
  trains: { every: [45, 85], gain: 0.7 },
  hint: 'THE CARPET IS DRY. THE CARPET IS QUIET.',
};

// -------------------------------------------------------------- 3. THE TUNNEL
const TUNNEL = {
  id: 3,
  name: 'THE TUNNEL',
  line: 'THREE OF THEM ARE STANDING STILL',
  space: { decay: 4.6, brightness: 0.3, predelay: 0.03, spread: 2.4 },
  spawn: { x: 0, z: -34, yaw: Math.PI },
  exit: { x: 0, z: 40, r: 2.4 },
  build(b) {
    const H = 4.6;
    const W = 3.6;
    b.floor(-W, -38, W, 44, 0, SURF.GRAVEL);
    b.ceiling(-W, -38, W, 44, H, SURF.CONCRETE);
    b.wall(-W, -38, -W, 44, 0, H, SURF.CONCRETE);
    b.wall(W, -38, W, 44, 0, H, SURF.CONCRETE);
    b.wall(-W, -38, W, -38, 0, H, SURF.CONCRETE);
    b.wall(-W, 44, W, 44, 0, H, SURF.CONCRETE);

    // maintenance alcoves — carpeted, and the only place to stand and think
    const alcoves = [[-26, -1], [-8, 1], [7, -1], [22, 1], [33, -1]];
    for (const [z, side] of alcoves) {
      const x0 = side < 0 ? -W - 2.6 : W;
      const x1 = side < 0 ? -W : W + 2.6;
      b.floor(x0, z - 1.5, x1, z + 1.5, 0, SURF.CARPET);
      b.ceiling(x0, z - 1.5, x1, z + 1.5, 2.5, SURF.CONCRETE);
      b.wall(x0, z - 1.5, x1, z - 1.5, 0, 2.5, SURF.CONCRETE);
      b.wall(x0, z + 1.5, x1, z + 1.5, 0, 2.5, SURF.CONCRETE);
      b.wall(side < 0 ? x0 : x1, z - 1.5, side < 0 ? x0 : x1, z + 1.5, 0, 2.5, SURF.CONCRETE);
    }

    // sleepers underfoot and cable ducts on the wall
    for (let z = -36; z < 44; z += 2.4) b.block(0, z, 6.6, 0.28, 0.0, 0.14, SURF.METAL);
    b.block(-W + 0.2, 3, 0.35, 78, 1.9, 2.15, SURF.METAL);

    // a few standing pools in the low spots
    b.floor(-W, -19, W, -16.5, 0.006, SURF.PUDDLE);
    b.floor(-W, 14, W, 16.5, 0.006, SURF.PUDDLE);
  },
  drips: [
    { x: -1.8, z: -22, y: 4.5, every: [2.2, 3.6], gain: 1.0 },
    { x: 1.6, z: 4, y: 4.5, every: [3.4, 6.0], gain: 1.1 },
    { x: -1.0, z: 26, y: 4.5, every: [2.8, 4.6], gain: 1.0 },
  ],
  machines: [],
  enemies: [
    { type: 'sentinel', x: -1.6, z: -14, facing: Math.PI },
    { type: 'sentinel', x: 1.8, z: 9, facing: 0 },
    { type: 'sentinel', x: -1.2, z: 30, facing: Math.PI },
  ],
  trains: { every: [30, 55], gain: 1.15 },
  hint: 'BALLAST IS THE LOUDEST GROUND IN THE STATION.',
};

// ------------------------------------------------------------- 4. MAINTENANCE
const MAINTENANCE = {
  id: 4,
  name: 'MAINTENANCE',
  line: 'MOVE WHEN THE MACHINES MOVE',
  space: { decay: 1.5, brightness: 0.66, predelay: 0.008, spread: 0.5 },
  spawn: { x: -18, z: -14, yaw: 0 },
  exit: { x: 19, z: 15, r: 2.2 },
  build(b) {
    const H = 3.2;
    const wall = (x0, z0, x1, z1) => b.wall(x0, z0, x1, z1, 0, H, SURF.METAL);

    b.floor(-22, -18, 24, 20, 0, SURF.CONCRETE);
    b.ceiling(-22, -18, 24, 20, H, SURF.METAL);
    wall(-22, -18, 24, -18);
    wall(-22, 20, 24, 20);
    wall(-22, -18, -22, 20);
    wall(24, -18, 24, 20);

    // spine corridor, carpeted so you can cross it silently if you dare
    b.floor(-22, -3, 24, 1, 0.006, SURF.CARPET);
    wall(-22, -3, -10.5, -3); wall(-6.5, -3, 3.5, -3); wall(7.5, -3, 24, -3);
    wall(-22, 1, -16.5, 1); wall(-12.5, 1, 0.5, 1); wall(4.5, 1, 15.5, 1); wall(19.5, 1, 24, 1);

    // four plant rooms, each with a machine that fires on its own clock
    const rooms = [
      [-21, -17, -8, -4], [-6, -17, 8, -4], [10, -17, 23, -4],
      [-21, 2, -6, 19], [-4, 2, 10, 19], [12, 2, 23, 19],
    ];
    for (const [x0, z0, x1, z1] of rooms) {
      b.floor(x0, z0, x1, z1, 0.004, SURF.CONCRETE);
    }
    // dividers between the plant rooms
    wall(-8, -17, -8, -3); wall(8, -17, 8, -3);
    wall(-6, 1, -6, 19); wall(10, 1, 10, 19);
    // doorways are the gaps left above

    // machinery
    b.block(-15, -11, 3.4, 2.2, 0, 2.1, SURF.METAL);
    b.block(1, -11, 3.4, 2.2, 0, 2.1, SURF.METAL);
    b.block(17, -11, 3.4, 2.2, 0, 2.1, SURF.METAL);
    b.block(-14, 11, 2.6, 4.0, 0, 2.4, SURF.METAL);
    b.block(3, 11, 2.6, 4.0, 0, 2.4, SURF.METAL);
    b.block(17, 8, 3.0, 3.0, 0, 1.8, SURF.METAL);

    // burst pipe
    b.floor(-4, 4, 2, 9, 0.006, SURF.PUDDLE);
    b.floor(12, -16, 17, -12, 0.006, SURF.PUDDLE);

    // exit hatch
    b.floor(17, 13, 22, 18, 0.008, SURF.METAL);
  },
  drips: [
    { x: -1, z: 6, y: 3.1, every: [1.6, 2.8], gain: 1.0 },
    { x: 14, z: -14, y: 3.1, every: [2.0, 3.4], gain: 0.9 },
  ],
  machines: [
    { x: -15, z: -11, y: 1.6, period: 4.4, phase: 0.0, gain: 1.0 },
    { x: 1, z: -11, y: 1.6, period: 5.6, phase: 1.9, gain: 1.05 },
    { x: 17, z: -11, y: 1.6, period: 3.6, phase: 0.7, gain: 0.9 },
    { x: -14, z: 11, y: 1.9, period: 6.8, phase: 3.1, gain: 1.15 },
    { x: 3, z: 11, y: 1.9, period: 5.0, phase: 2.4, gain: 1.0 },
  ],
  enemies: [
    { type: 'stalker', x: -14, z: -8, route: [[-14, -14], [-2, -14], [-2, -6], [-14, -6]] },
    { type: 'screamer', x: 4, z: 8, route: [[-2, 6], [8, 6], [8, 16], [-2, 16]] },
    { type: 'stalker', x: 18, z: -8, route: [[18, -15], [12, -8], [20, -6]] },
    { type: 'sentinel', x: 0, z: -1, facing: Math.PI * 0.5 },
  ],
  trains: { every: [50, 90], gain: 0.6 },
  hint: 'THE PLANT IS ON A CLOCK. YOU ARE NOT.',
};

// ----------------------------------------------------------------- 5. THE DEEP
const DEEP = {
  id: 5,
  name: 'THE DEEP',
  line: 'NOTHING HERE STOPS SOUND',
  space: { decay: 6.5, brightness: 0.24, predelay: 0.045, spread: 3.4 },
  spawn: { x: 0, z: -36, yaw: Math.PI },
  exit: { x: 0, z: 38, r: 3.0 },
  build(b) {
    const H = 11.0;
    b.floor(-42, -42, 42, 42, 0, SURF.CONCRETE);
    b.ceiling(-42, -42, 42, 42, H, SURF.CONCRETE);
    b.wall(-42, -42, 42, -42, 0, H, SURF.CONCRETE);
    b.wall(-42, 42, 42, 42, 0, H, SURF.CONCRETE);
    b.wall(-42, -42, -42, 42, 0, H, SURF.CONCRETE);
    b.wall(42, -42, 42, 42, 0, H, SURF.CONCRETE);

    // a floor of black water with dry causeways across it
    b.floor(-38, -30, 38, 34, 0.004, SURF.PUDDLE);
    b.floor(-3.0, -30, 3.0, 34, 0.010, SURF.CONCRETE);
    b.floor(-26, -9, 26, -3, 0.010, SURF.CONCRETE);
    b.floor(-30, 16, 30, 22, 0.010, SURF.CONCRETE);
    b.floor(-9, 4, 15, 9, 0.012, SURF.CARPET);

    // columns. They break sightlines but they are far too sparse to stop sound.
    for (const [x, z] of [
      [-22, -22], [0, -20], [22, -22], [-30, -4], [30, -4],
      [-14, 2], [14, 2], [-24, 20], [24, 20], [0, 26], [-12, 32], [12, 32],
    ]) b.block(x, z, 1.5, 1.5, 0, H, SURF.CONCRETE);

    // the ramp out
    b.floor(-5, 34, 5, 42, 0.012, SURF.GRAVEL);
  },
  drips: [
    { x: -20, z: -10, y: 10.8, every: [3.0, 6.0], gain: 1.4 },
    { x: 18, z: 8, y: 10.8, every: [3.4, 7.0], gain: 1.4 },
    { x: -6, z: 24, y: 10.8, every: [4.0, 8.0], gain: 1.3 },
    { x: 26, z: -26, y: 10.8, every: [5.0, 9.0], gain: 1.2 },
  ],
  machines: [],
  enemies: [
    { type: 'stalker', x: -18, z: -14, route: [[-18, -22], [-18, 10], [-30, 10], [-30, -22]] },
    { type: 'stalker', x: 18, z: -14, route: [[18, -22], [18, 10], [30, 10], [30, -22]] },
    { type: 'screamer', x: 0, z: 6, route: [[-14, 14], [14, 14], [14, -6], [-14, -6]] },
    { type: 'screamer', x: -8, z: 28, route: [[-20, 28], [20, 28], [20, 34], [-20, 34]] },
    { type: 'sentinel', x: -3.6, z: 18, facing: Math.PI },
    { type: 'sentinel', x: 3.6, z: -12, facing: 0 },
  ],
  trains: { every: [28, 48], gain: 1.5 },
  hint: 'THE CAUSEWAY IS DRY. THE WATER IS NOT YOUR FRIEND.',
};

export const LEVELS = [PLATFORM, TURNSTILES, TUNNEL, MAINTENANCE, DEEP];
