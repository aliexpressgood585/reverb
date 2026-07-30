import { describe, it, expect } from 'vitest';
import { FEEL, COLUMN } from '../cairn/src/feel.js';
import { Sim, World, PHASE, predict, erosionOf, solidHalfWidth, EROSION, makeRng }
  from '../cairn/src/sim.js';
import { mulberry32, hashString, shuffle } from '../cairn/src/rng.js';

/**
 * Logic tests. These run in Node in milliseconds because the simulation has no
 * DOM — which is a property of the architecture and the reason the balance
 * harness can drive 30,000 climbs without a browser.
 *
 * What is deliberately NOT here: anything about input, rendering or layout.
 * Those go through `scripts/cairn-check.mjs` and a real pointer, because this
 * project has already shipped a game that could not be started while ten tests
 * asserting the input handler worked were green.
 */

/**
 * Narrow away an optional. `expect(x).toBeDefined()` asserts at runtime and
 * tells the type checker nothing, so the lines after it still read a maybe.
 *
 * @template T
 * @param {T | undefined | null} v
 * @returns {T}
 */
function must(v) {
  if (v === undefined || v === null) throw new Error('expected a value, got none');
  return v;
}

describe('seeded randomness', () => {
  it('is a pure function of the seed', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    const first = Array.from({ length: 50 }, () => a());
    const second = Array.from({ length: 50 }, () => b());
    expect(first).toEqual(second);
  });

  it('gives different streams for different seeds', () => {
    const a = mulberry32(1)();
    const b = mulberry32(2)();
    expect(a).not.toBe(b);
  });

  it('stays inside [0, 1)', () => {
    const r = mulberry32(0xdecafbad);
    for (let i = 0; i < 5000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('hashes a string the same way every time', () => {
    expect(hashString('2026-07-30')).toBe(hashString('2026-07-30'));
    expect(hashString('2026-07-30')).not.toBe(hashString('2026-07-31'));
  });

  it('shuffles deterministically', () => {
    const a = shuffle([1, 2, 3, 4, 5, 6, 7, 8], mulberry32(7));
    const b = shuffle([1, 2, 3, 4, 5, 6, 7, 8], mulberry32(7));
    expect(a).toEqual(b);
    expect([...a].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("the world's own rng is untouched and still xorshift32", () => {
    // This one is a wire format: it decides what tower a saved seed describes.
    // If this test ever fails, every save on every phone has been orphaned.
    // Measured from the shipped function, not asserted from memory — the first
    // version of this test carried three numbers I had not run, and it failed
    // for that reason rather than for a real one.
    const r = makeRng(0x1a2b3c);
    expect([r(), r(), r(), r(), r()])
      .toEqual([0.285442, 0.643256, 0.876845, 0.85249, 0.038866]);
  });
});

describe('the tower generator', () => {
  it('builds an identical world from an identical seed', () => {
    /** @param {number} seed */
    const shape = (seed) => {
      const w = new World(seed);
      w.reset(seed);
      w.generate(600);
      return w.solids.map((s) => [s.x, s.y, s.hw].join(',')).join('|');
    };
    expect(shape(0x1a2b3c)).toBe(shape(0x1a2b3c));
    expect(shape(0x1a2b3c)).not.toBe(shape(0x999999));
  });

  it('never places a ledge outside the column', () => {
    const sim = new Sim(0x1a2b3c);
    sim.world.generate(3000);
    for (const s of sim.world.solids) {
      expect(s.x - s.hw).toBeGreaterThanOrEqual(0);
      expect(s.x + s.hw).toBeLessThanOrEqual(COLUMN);
    }
  });

  it('always rises — builtTo is strictly monotone', () => {
    const sim = new Sim(0x1a2b3c);
    sim.world.generate(2000);
    const ledges = sim.world.solids.filter((s) => !s.corpse).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ledges.length; i++) {
      expect(ledges[i].y).toBeGreaterThan(ledges[i - 1].y);
    }
  });

  it('marks the gaps it cut out of a flight, and cuts a real share of them', () => {
    const sim = new Sim(0x1a2b3c);
    sim.world.generate(1500);
    const ledges = sim.world.solids.filter((s) => !s.corpse);
    const hard = ledges.filter((s) => s.hard).length;
    // If this is zero the mechanic is off and cairn-bodies-check is measuring
    // an empty set while still printing a confident number.
    expect(hard).toBeGreaterThan(0);
    expect(hard / ledges.length).toBeLessThan(0.6);
  });

  it('keeps the on-ramp free of hard gaps', () => {
    const sim = new Sim(0x1a2b3c);
    sim.world.generate(1500);
    for (const s of sim.world.solids) {
      if (s.hard) expect(s.y).toBeGreaterThan(FEEL.tower.openingSpan);
    }
  });
});

describe('erosion', () => {
  /** @param {number} age in deaths */
  const stage = (age) => {
    const sim = new Sim(1);
    const c = sim.world.corpse(50, 50, 0, 0, 0, 0);
    sim.deaths = age;
    return { st: erosionOf(c, sim), hw: solidHalfWidth(c, sim), c };
  };

  it('runs the four stages in order', () => {
    expect(stage(0).st).toBe(EROSION.FRESH);
    expect(stage(FEEL.erosion.fresh).st).toBe(EROSION.THIN);
    expect(stage(FEEL.erosion.thin).st).toBe(EROSION.TOP);
    expect(stage(FEEL.erosion.top).st).toBe(EROSION.MEMORY);
  });

  it('narrows and then stops colliding', () => {
    const fresh = stage(0);
    expect(fresh.hw).toBe(fresh.c.hw);
    expect(stage(FEEL.erosion.fresh).hw).toBeCloseTo(fresh.c.hw * 0.45, 6);
    // A MEMORY is drawn forever and holds nothing. This is the property test 8
    // could not see: a corpse that exists is not a corpse that bears weight.
    expect(stage(FEEL.erosion.top).hw).toBe(0);
  });

  it('treats rock as permanent', () => {
    const sim = new Sim(1);
    const led = sim.world.solids[0];
    sim.deaths = 10000;
    expect(solidHalfWidth(led, sim)).toBe(led.hw);
  });
});

describe('the one rule', () => {
  it('leaves a body strictly above the ledge it launched from', () => {
    const sim = new Sim(0x1a2b3c);
    sim.phase = PHASE.PLAY;
    let deaths = 0;
    for (let attempt = 0; attempt < 40; attempt++) {
      const takeoff = sim.body.y;
      // Straight up at a wall-ward angle, hard enough to leave the ledge and
      // miss everything: the shortest route to a death worth checking.
      sim.launch(Math.cos(1.2) * FEEL.launch.maxSpeed, Math.sin(1.2) * FEEL.launch.maxSpeed);
      for (let i = 0; i < 2000 && sim.phase === PHASE.PLAY && !sim.body.grounded; i++) sim.tick(0);
      if (sim.phase === PHASE.DYING) {
        deaths++;
        const bodies = sim.world.solids.filter((s) => s.corpse);
        const last = must(bodies.at(-1));
        expect(last.y + last.hh).toBeGreaterThan(takeoff);
        sim.respawn();
      }
    }
    expect(deaths).toBeGreaterThan(0);
  });

  it("puts a corpse's surface exactly at the apex, never above it", () => {
    const sim = new Sim(0x1a2b3c);
    sim.phase = PHASE.PLAY;
    sim.launch(Math.cos(1.35) * FEEL.launch.maxSpeed, Math.sin(1.35) * FEEL.launch.maxSpeed);
    for (let i = 0; i < 2000 && sim.phase === PHASE.PLAY; i++) sim.tick(0);
    expect(sim.phase).toBe(PHASE.DYING);
    const body = must(sim.world.solids.filter((s) => s.corpse).pop());
    // Standing on a body must never require reaching higher than you just did.
    expect(body.y + body.hh).toBeCloseTo(sim.body.peakY, 6);
  });
});

describe('the predicted arc', () => {
  it('lands where the flight lands, exactly', () => {
    const sim = new Sim(0x1a2b3c);
    sim.phase = PHASE.PLAY;
    /** @type {number[]} */
    const arc = [];
    let checked = 0;
    for (let a = 30; a <= 150; a += 10) {
      for (const f of [0.4, 0.7, 1]) {
        sim.reset(true);
        sim.phase = PHASE.PLAY;
        const sp = FEEL.launch.minSpeed + (FEEL.launch.maxSpeed - FEEL.launch.minSpeed) * f;
        const vx = Math.cos((a * Math.PI) / 180) * sp;
        const vy = Math.sin((a * Math.PI) / 180) * sp;
        const predicted = predict(sim, vx, vy, arc);
        sim.launch(vx, vy);
        for (let i = 0; i < 2000 && sim.phase === PHASE.PLAY && !sim.body.grounded; i++) sim.tick(0);
        const actual = sim.phase === PHASE.PLAY ? sim.body.standing : null;
        expect(actual).toBe(predicted);
        checked++;
      }
    }
    expect(checked).toBe(39);
  });

  it('reports the same apex the death will freeze at', () => {
    const sim = new Sim(0x1a2b3c);
    sim.phase = PHASE.PLAY;
    /** @type {number[]} */
    const arc = [];
    const vx = Math.cos(1.35) * FEEL.launch.maxSpeed;
    const vy = Math.sin(1.35) * FEEL.launch.maxSpeed;
    expect(predict(sim, vx, vy, arc)).toBe(null);
    expect(sim.predictPeak.dies).toBe(true);
    const px = sim.predictPeak.x, py = sim.predictPeak.y;
    sim.launch(vx, vy);
    for (let i = 0; i < 2000 && sim.phase === PHASE.PLAY; i++) sim.tick(0);
    const body = must(sim.world.solids.filter((s) => s.corpse).pop());
    expect(body.x).toBeCloseTo(px, 6);
    expect(body.y + body.hh).toBeCloseTo(py, 6);
  });
});

describe('determinism end to end', () => {
  it('two identical launch sequences produce identical worlds', () => {
    const play = () => {
      const sim = new Sim(0x1a2b3c);
      sim.phase = PHASE.PLAY;
      const r = mulberry32(4242);
      for (let k = 0; k < 60; k++) {
        if (sim.body.grounded) {
          const a = 0.5 + r() * 2;
          const sp = 60 + r() * 70;
          sim.launch(Math.cos(a) * sp, Math.sin(a) * sp);
        }
        for (let i = 0; i < 400 && sim.phase === PHASE.PLAY && !sim.body.grounded; i++) sim.tick(0);
        if (sim.phase !== PHASE.PLAY) sim.respawn();
      }
      return { y: sim.body.y, deaths: sim.deaths, best: sim.best,
               bodies: sim.world.solids.filter((s) => s.corpse).map((s) => `${s.x},${s.y}`).join('|') };
    };
    expect(play()).toEqual(play());
  });
});
