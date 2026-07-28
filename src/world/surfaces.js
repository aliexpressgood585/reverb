// Surface ids. Must match the #defines in render/shaders/surfaces.glsl.js.
export const SURF = {
  CONCRETE: 0,
  PUDDLE: 1,
  GRAVEL: 2,
  CARPET: 3,
  METAL: 4,
  TILE: 5,
};

/**
 * How each surface behaves acoustically.
 *   noise  — multiplier on the loudness of a footstep taken here
 *   bright — multiplier on how strongly that footstep lights the world
 *   tone   — filter centre for the synthesised step, in Hz
 *   grit   — noise-vs-tone balance of the step
 */
export const SURFACE_ACOUSTICS = {
  [SURF.CONCRETE]: { noise: 1.0, bright: 1.0, tone: 320, grit: 0.55, name: 'CONCRETE' },
  [SURF.PUDDLE]: { noise: 2.15, bright: 1.55, tone: 1400, grit: 0.95, name: 'WATER' },
  [SURF.GRAVEL]: { noise: 2.6, bright: 1.35, tone: 2600, grit: 1.0, name: 'BALLAST' },
  [SURF.CARPET]: { noise: 0.22, bright: 0.35, tone: 160, grit: 0.3, name: 'CARPET' },
  [SURF.METAL]: { noise: 1.7, bright: 1.4, tone: 900, grit: 0.4, name: 'STEEL' },
  [SURF.TILE]: { noise: 1.25, bright: 1.15, tone: 620, grit: 0.5, name: 'TILE' },
};
