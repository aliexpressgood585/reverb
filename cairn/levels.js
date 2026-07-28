/**
 * Eight climbs.
 *
 * A level is four numbers, because the tower is grown deterministically from a
 * seed rather than placed by hand: the same seed is always the same rock, on
 * every device and every run, which is what lets a level have a par at all.
 *
 *   summit   metres to the top
 *   stones   how many of you the climb is allowed to cost. Run out and the
 *            tower resets to bare rock and you start again.
 *   par      the toll a clean climb should pay. Beat it and the level is
 *            marked UNTOUCHED or CHEAP; miss it and it still counts.
 *   tight    0..1, how close to the edge of what a full-power launch can do
 *            the ledges are placed, and how narrow they get.
 *
 * The difficulty curve is one axis only — `tight`. No level introduces a new
 * rule, because the one rule is the whole game.
 */
export const LEVELS = [
  {
    id: 1, name: 'THE FOOT', seed: 0x1a2b3c,
    summit: 36, stones: 8, par: 2, tight: 0.20,
    line: 'IT STAYS WHERE IT FELL',
  },
  {
    id: 2, name: 'SHOULDER', seed: 0x51f0a7,
    summit: 48, stones: 8, par: 3, tight: 0.32,
    line: 'A STONE IS A STEP',
  },
  {
    id: 3, name: 'THE NARROWS', seed: 0x77c319,
    summit: 60, stones: 7, par: 3, tight: 0.46,
    line: 'SPEND ONE ON PURPOSE',
  },
  {
    id: 4, name: 'DRY THROAT', seed: 0x2be845,
    summit: 72, stones: 7, par: 4, tight: 0.56,
    line: 'AIM THE FALL, NOT THE LANDING',
  },
  {
    id: 5, name: 'THE LEAN', seed: 0x9d4602,
    summit: 86, stones: 6, par: 4, tight: 0.66,
    line: 'YOU HAVE BEEN HERE BEFORE',
  },
  {
    id: 6, name: 'COLD SHELF', seed: 0x3f7ab8,
    summit: 100, stones: 6, par: 4, tight: 0.76,
    line: 'THE LAST ONE SHOWS THE WAY',
  },
  {
    id: 7, name: 'THE SPIRE', seed: 0xc10de6,
    summit: 118, stones: 5, par: 5, tight: 0.86,
    line: 'FEWER OF YOU EACH TIME',
  },
  {
    id: 8, name: 'THE CROWN', seed: 0x60e9d1,
    summit: 140, stones: 5, par: 5, tight: 0.94,
    line: 'CLIMB ON WHAT YOU WERE',
  },
];
