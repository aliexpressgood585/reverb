/**
 * The shapes the whole game is built out of, declared once.
 *
 * These are JSDoc typedefs rather than TypeScript declarations for the reason in
 * `tsconfig.json`: Vite ships `cairn/src/*.js` exactly as written, which is most
 * of why the bundle is 21 KB, and a compile step would take that away. `checkJs`
 * with every strict flag on gives the same errors at the same place without one.
 *
 * This module deliberately exports nothing at runtime.
 */

/**
 * An axis-aligned slab you can stand on and, if it is a corpse, cling to.
 *
 * `hw`/`hh` are HALF extents, and `y + hh` is the landable surface — the single
 * most load-bearing convention in the codebase, because the hard-gap constructor
 * places a surface at a height the physics actually reached.
 *
 * @typedef {object} Solid
 * @property {number} x        centre, world units
 * @property {number} y        centre. The surface is `y + hh`.
 * @property {number} hw       half-width. What a corpse still OFFERS is
 *                             `solidHalfWidth()`, which erodes; this does not.
 * @property {number} hh       half-height
 * @property {boolean} corpse  a body left behind, rather than rock
 * @property {boolean} live    pooled: false means it is in the free list
 * @property {boolean} hard    a ledge cut out of a flight. Read only by audits.
 * @property {number} order    creation index among corpses, for the poster thread
 * @property {number} bornAt   sim time it was created
 * @property {number} [bornDeath] the death index it was born on. Erosion measures
 *                             age against this, so a save without it resurrects a
 *                             tower as scenery — see store.js schema 1.
 * @property {number} rot      radians, presentation only
 * @property {number} pose     0-3, presentation only
 * @property {number} glow     1 when fresh, faded by the renderer
 */

/**
 * The player, and every scratch body the predictor and the generator fly.
 *
 * `px`/`py` are the previous tick and `rx`/`ry` the interpolated render
 * position; physics never reads the latter two.
 *
 * @typedef {object} Body
 * @property {number} x
 * @property {number} y
 * @property {number} px
 * @property {number} py
 * @property {number} [rx]     render interpolation, written by main.js only
 * @property {number} [ry]
 * @property {number} vx
 * @property {number} vy
 * @property {boolean} grounded
 * @property {Solid|null} standing
 * @property {number} onWall   -1 left contact, +1 right, 0 none
 * @property {number} wallTimer
 * @property {number} coyote
 * @property {number} takeoff  the height the launch left from; falling below it
 *                             is what "die" means
 * @property {number} peakX    the apex, which is where a corpse is left
 * @property {number} peakY
 * @property {number} airTime
 * @property {number} hangTimer
 */

/** @typedef {{ vx: number, vy: number }} Launch */

/** @typedef {{ x: number, y: number, dies: boolean }} PredictedPeak */

export {};
