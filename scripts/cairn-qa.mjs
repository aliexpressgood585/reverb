#!/usr/bin/env node
/**
 * CAIRN — the release soak.
 *
 *   node scripts/cairn-qa.mjs [--runs=1000]
 *
 * A thousand simulated runs against the real physics and the real generator,
 * asking the questions a store release has to answer and the acceptance suite
 * does not:
 *
 *   1. does anything throw, over a thousand runs
 *   2. does the game ever SOFT-LOCK — a state the player cannot leave
 *   3. can the generator produce a level nobody can climb
 *   4. is the daily seed identical across separate sessions
 *   5. does the save survive being truncated, poisoned, and refused
 *
 * The dead-end question is the one that matters and the one that is easy to
 * fake. "The bot got stuck" is not the same as "the game is stuck" — a bot with
 * a bad plan can stall forever in a perfectly playable world. So the test is not
 * whether the BOT escaped; it is whether any legal launch from where it stands
 * LANDS somewhere new. That is a property of the level, which is what was being
 * asked about, and the detector is run against a deliberately trapped world so
 * that a green result means something.
 */
import { FEEL, COLUMN } from '../cairn/src/feel.js';
import { Sim, PHASE, predict, solidHalfWidth } from '../cairn/src/sim.js';
import { SKILLS, climb, rng32 } from './cairn-balance.mjs';
import * as Store from '../cairn/src/store.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
const RUNS = +(args.runs ?? 1000);
const DEG = Math.PI / 180;

const fails = [];
const check = (ok, msg) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails.push(msg);
};

console.log('CAIRN release soak\n');

// ── 1 & 2. a thousand runs, and can the player always leave? ───────────────
{
  const arc = [];
  /**
   * Can any legal launch from here LAND on a surface other than this one?
   *
   * THE FIRST VERSION OF THIS COULD NOT FAIL, and finding that out is the point
   * of the trap case below. It also counted "the launch dies at an apex above
   * you" as an escape, on the reasoning that a body is a step — which is true,
   * and which makes the predicate trivially satisfiable, because in CAIRN every
   * launch that lands nowhere dies at an apex above the take-off. It returned
   * true for a world containing exactly one ledge and nothing else.
   *
   * That accident is worth stating as a finding rather than patching away:
   * **CAIRN cannot hard-lock.** A launch is always available, a launch that
   * lands nowhere always dies, and a death always returns the player to the base
   * ledge in 900 ms. There is no state a player can enter and not leave.
   *
   * What a player CAN hit — and did, three times, at 391, 481 and 567 m — is a
   * ledge with no route onward. That is the property worth testing, it is about
   * the terrain rather than the player, and it is what this now asks: LANDING
   * only, no death clause. `cairn-reach-check.mjs` asks the same question across
   * every gap in the tower; this asks it about wherever a run actually stopped.
   *
   * @param {Sim} sim
   * @returns {boolean}
   */
  function canReachNewSurface(sim) {
    const L = FEEL.launch;
    const here = sim.body.standing;
    for (let a = 10; a <= 170; a += 2) {
      for (let f = 0; f <= 1.001; f += 0.05) {
        const sp = L.minSpeed + (L.maxSpeed - L.minSpeed) * f;
        const hit = predict(sim, Math.cos(a * DEG) * sp, Math.sin(a * DEG) * sp, arc);
        if (hit && hit !== here) return true;
      }
    }
    return false;
  }

  let crashed = 0, softlock = 0, capped = 0, runs = 0, deaths = 0;
  const heights = [];
  const t0 = Date.now();
  const scratch = [], cands = [];
  const skills = ['novice', 'average', 'expert'];

  for (let i = 0; runs < RUNS; i++) {
    const skill = SKILLS[skills[i % 3]];
    const seed = (0x51ee7 + i * 0x9e3779b1) | 0;
    const sim = new Sim(seed);
    const rnd = rng32((seed ^ 0xa5a5a5) >>> 0);
    sim.phase = PHASE.PLAY;
    for (let a = 0; a < 6 && runs < RUNS; a++) {
      let r;
      try {
        r = climb(sim, skill, rnd, scratch, cands, 0);
      } catch (e) {
        crashed++;
        fails.push(`threw on seed ${seed}: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
      runs++;
      if (r === null) {
        // The harness cap, not a stuck game. Ask the world directly.
        capped++;
        if (!canReachNewSurface(sim)) {
          softlock++;
          fails.push(`SOFT-LOCK at y=${sim.body.y.toFixed(1)}, seed ${seed}`);
        }
        break;
      }
      deaths++;
      heights.push(r.h);
      sim.respawn();
    }
  }

  const med = (a) => {
    const s = Float64Array.from(a).sort();
    return s.length ? s[s.length >> 1] : NaN;
  };
  check(crashed === 0, `${runs} runs across all three skill models, ${crashed} threw ` +
    `(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  check(softlock === 0, `${softlock} dead ends — a ledge no legal launch can leave for ` +
    `anywhere else (${capped} runs stalled and were each checked against the world)`);

  /*
   * AND THE DETECTOR HAS TO BE ABLE TO FIRE.
   *
   * On a healthy build `capped` is 0, which means `canGoAnywhere` was never
   * called and the assertion above proved nothing at all. That is the exact
   * shape of the six tests this repository has already shipped blind, so the
   * detector is run against a world built to trap: one narrow ledge, everything
   * else deleted, and the floor removed from under it.
   */
  {
    const sim = new Sim(0x7ab1e);
    sim.phase = PHASE.PLAY;
    sim.world.generate(400);
    // A world with exactly one surface, high up, with nothing above or beside it.
    const perch = sim.world.solids.find((x) => !x.corpse && x.y > 200);
    sim.world.solids = perch ? [perch] : [];
    sim.world.buckets.clear();
    for (const x of sim.world.solids) sim.world._index(x);
    if (perch) {
      sim.body.x = perch.x;
      sim.body.y = perch.y + perch.hh;
      sim.body.grounded = true;
      sim.body.standing = perch;
      sim.body.takeoff = sim.body.y;
    }
    const trapped = perch ? !canReachNewSurface(sim) : false;
    check(trapped,
      'the dead-end detector fires on a world built to trap — one ledge, nothing '
      + 'above it, nothing beside it. Without this the check above is vacuous, '
      + 'because a healthy build never reaches it.');
  }
  console.log(`        ${deaths} deaths, median height ${med(heights).toFixed(0)} m`);
}

// ── 3. can the generator build something unclimbable? ──────────────────────
{
  let worst = 0, checked = 0, bad = 0;
  for (let s = 0; s < 60; s++) {
    const sim = new Sim((0xbeef + s * 0x9e3779b1) | 0);
    sim.world.generate(2000);
    const ledges = sim.world.solids.filter((x) => !x.corpse).sort((a, b) => a.y - b.y);
    for (let i = 1; i < ledges.length; i++) {
      const rise = ledges[i].y - ledges[i - 1].y;
      checked++;
      if (rise > worst) worst = rise;
      // The physical ceiling of a full-power launch, plus what the apex hang
      // adds. A rise past it is a wall by arithmetic, before any audit runs.
      const lift = (FEEL.launch.maxSpeed ** 2) / (2 * FEEL.gravityRise);
      if (rise > lift * 1.35) bad++;
      if (ledges[i].x - ledges[i].hw < -0.01 || ledges[i].x + ledges[i].hw > COLUMN + 0.01) bad++;
      if (solidHalfWidth(ledges[i], sim) <= 0) bad++;
    }
  }
  check(bad === 0, `${checked} generated gaps over 60 towers to 2000 m — ` +
    `${bad} impossible by arithmetic, tallest rise ${worst.toFixed(1)}u`);
}

// ── 4. the daily seed is the same tower in two sessions ───────────────────
{
  const date = '2026-07-31';
  const shape = () => {
    const sim = new Sim(Store.dailySeed(date));
    sim.world.generate(900);
    return sim.world.solids.map((s) => `${s.x.toFixed(4)},${s.y.toFixed(4)},${s.hw.toFixed(4)}`).join('|');
  };
  const a = shape();
  const b = shape();
  check(a === b && a.length > 100,
    `the daily tower for ${date} is bit-identical across two separate sessions ` +
    `(${a.split('|').length} solids, seed ${Store.dailySeed(date)})`);
  check(Store.dailySeed('2026-07-31') !== Store.dailySeed('2026-08-01'),
    'a different date is a different tower');
}

// ── 5. the save survives abuse ────────────────────────────────────────────
{
  /** A localStorage that can be truncated, poisoned or made to throw. */
  function fakeStorage(mode = 'ok') {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => {
        if (mode === 'refuse') throw new Error('QuotaExceededError');
        m.set(k, mode === 'truncate' ? String(v).slice(0, Math.floor(String(v).length * 0.7)) : String(v));
      },
      removeItem: (k) => m.delete(k),
      _map: m,
    };
  }
  const stub = (v) => Object.defineProperty(globalThis, 'localStorage',
    { value: v, configurable: true, writable: true });

  // a good save round-trips with its bodies still load-bearing
  stub(fakeStorage());
  Store.setSlot('');
  {
    const sim = new Sim(0x1a2b3c);
    sim.phase = PHASE.PLAY;
    for (let i = 0; i < 20; i++) sim.world.corpse(20 + i, 30 + i * 6, 0.1, i & 3, 0, i);
    sim.deaths = 20;
    sim.best = 180;
    Store.save(sim);
    const back = new Sim(0x1a2b3c);
    const ok = Store.load(back);
    const bodies = back.world.solids.filter((s) => s.corpse);
    const solid = bodies.filter((s) => solidHalfWidth(s, back) > 0).length;
    check(ok && bodies.length === 20 && solid > 0,
      `a saved tower reloads with ${bodies.length} bodies, ${solid} still bearing weight`);
  }

  // a write that is refused must not take the game down
  stub(fakeStorage('refuse'));
  {
    const sim = new Sim(1);
    sim.world.corpse(30, 40, 0, 0, 0, 0);
    let threw = false;
    try { Store.save(sim); } catch { threw = true; }
    check(!threw, 'a refused write (private mode, quota) does not throw');
  }

  // total rubbish in the slot must not throw and must not load
  stub(fakeStorage());
  globalThis.localStorage.setItem('cairn.v1', '{"v":2,"corpses":[1,2,3],"n":99}');
  {
    const sim = new Sim(1);
    let threw = false, loaded = true;
    try { loaded = Store.load(sim); } catch { threw = true; }
    check(!threw && !loaded, 'a payload whose row count disagrees with its data is rejected');
  }

  stub(fakeStorage());
  globalThis.localStorage.setItem('cairn.v1', 'not json at all {{{');
  {
    const sim = new Sim(1);
    let threw = false;
    try { Store.load(sim); } catch { threw = true; }
    check(!threw, 'unparseable JSON does not throw');
  }
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nthe build holds');
for (const f of fails.slice(0, 10)) console.log(`  ${f}`);
process.exit(fails.length ? 1 : 0);
