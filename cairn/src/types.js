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
 * @property {boolean} crumble  ASH: gives way `verbs.crumbleMs` after it is stood on
 * @property {number} crumbleAt sim time it goes, or 0 until somebody lands on it
 * @property {number} drift     BLOOM: horizontal amplitude in units, 0 for still
 * @property {number} driftPhase
 * @property {boolean} updraft  SIGNAL: a column of rising air stands on this
 *                              ledge. Never seen by the generator's probe, so
 *                              it can only ever add reach.
 * @property {number} baseHw    half-width as placed. A crumbled hold sets `hw`
 *                             to 0; this is what the renderer draws its
 *                             outline from, so it gives way rather than
 *                             teleporting out of the world.
 * @property {number} baseX     where it was PLACED, which is what routes were
 *                              proved against. `x` is where it is right now.
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
 * @property {number} takeoffX where along that perch it left from, so a death
 *                             can be judged against the ledge it was thrown
 *                             from rather than against wherever it fell to
 * @property {number} peakX    the apex, which is where a corpse is left
 * @property {number} peakY
 * @property {number} airTime
 * @property {number} hangTimer
 * @property {number} t        this body's own sim clock, in `Sim.verbTime`'s
 *                             units. The real body's tracks the world's; the
 *                             ghost's and the probe's run ahead through the
 *                             flight being previewed, which is what makes a
 *                             drifting ledge land where the arc drew it.
 */

/** @typedef {{ vx: number, vy: number }} Launch */

/** @typedef {{ x: number, y: number, dies: boolean }} PredictedPeak */

export {};
