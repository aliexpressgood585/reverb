#!/usr/bin/env node
/**
 * CAIRN — does a new player meet the premise, and how soon?
 *
 *   npm run hook
 *
 * The title card promises EVERY DEATH LEAVES A STONE. `cairn-bodies-check.mjs`
 * proves the stones carry weight; nothing proved anyone meets that idea before
 * they have decided what this game is. The difficulty curve put the first
 * constructed hard gap past 100 m and rolled it 45% of the time, against a
 * novice whose median death is 119 m — so the premise arrived late, at random,
 * or never, and the first sixty seconds were an ordinary jumping game.
 *
 * Three questions, and the first is the one that can go quietly wrong:
 *
 *   1  is there a hard gap immediately above the on-ramp in EVERY tower?
 *   2  how far up is the first one, and how far up was it before?
 *   3  how many deaths does the novice model take to first stand on itself?
 *
 * Question 3 is the honest one. Questions 1 and 2 are about the generator
 * agreeing with its own intent; 3 is about a player, as far as a bot can stand
 * in for one — and it cannot stand in for curiosity or for giving up, which is
 * why the number is reported and not gated.
 */
import { FEEL } from '../cairn/src/feel.js';
import { Sim, PHASE, erosionOf } from '../cairn/src/sim.js';
import { SKILLS, climb, rng32 } from './cairn-balance.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));
if (args.tune) {
  for (const [k, v] of Object.entries(JSON.parse(args.tune))) {
    const path = k.includes('.') ? k.split('.') : ['tower', k];
    let node = FEEL;
    for (const seg of path.slice(0, -1)) node = node[seg];
    const leaf = path[path.length - 1];
    if (!(leaf in node)) throw new Error(`unknown FEEL path: ${k}`);
    node[leaf] = v;
  }
}

const SEEDS = +(args.seeds ?? 60);
const fails = [];
const check = (ok, msg) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails.push(msg);
};
const median = (a) => {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) * 0.5;
};

console.log('CAIRN hook — when does a new player meet the premise?\n');

// ── 1 & 2. where the first hard gap is ─────────────────────────────────────
{
  const firsts = [];
  let wrong = 0;
  let noPerch = 0;
  const ramp = FEEL.tower.openingSpan;
  const perches = [];
  for (let s = 0; s < SEEDS; s++) {
    const sim = new Sim((0x1a2b3c + s * 0x9e3779b1) | 0);
    sim.world.generate(600);
    const ls = sim.world.solids
      .filter((x) => x.live && !x.corpse)
      .sort((a, b) => a.y - b.y);

    // THE CLAIM, STATED EXACTLY. Not "there is a hard gap low down" — that is
    // loose enough to pass on a tower that merely got lucky. The claim is that
    // the gap LEAVING the on-ramp is hard: find the first ledge at or above the
    // line, and the very next ledge above it must be the constructed one.
    //
    // The first version of this check asserted the hard LEDGE lands within one
    // rise of the line, which is a different sentence and a false one — the
    // perch is within one rise, the ledge it buys is two. It read 21 of 60 on
    // a generator that was doing exactly what it was told.
    const pi = ls.findIndex((x) => x.y >= ramp);
    if (pi < 0 || pi + 1 >= ls.length) { noPerch++; continue; }
    const perch = ls[pi], next = ls[pi + 1];
    perches.push(perch.y);
    if (next.hard) firsts.push(next.y); else wrong++;
  }
  // Gated at 95%, not 100%, and the shortfall is a feature. `hardStep` flies
  // the real physics off the worst footing and returns null when it cannot
  // prove a landing; the generator then places an ordinary gap. That refusal is
  // the entire reason WALL reads 0.00%. At the time of writing exactly one seed
  // of sixty takes it — seed 32, perch 60.4 m, asked for a 23.1 m rise, both
  // directions null — and a gate of 100% here would be a gate against the
  // safety property, not for the promise.
  check(wrong <= SEEDS * 0.05 && noPerch === 0,
    `in ${firsts.length} of ${SEEDS} towers the gap that LEAVES the ${ramp} m ` +
    `on-ramp is a constructed hard gap (${wrong} ordinary, ${noPerch} unbuilt)`);
  console.log(`        the perch sits at median ${median(perches).toFixed(1)} m, ` +
    `the ledge it must reach at median ${median(firsts).toFixed(1)} m ` +
    `(min ${Math.min(...firsts).toFixed(1)}, max ${Math.max(...firsts).toFixed(1)})`);
}

// ── 3. does the novice meet the premise AT the designed moment? ───────────
//
// The first version of this asked "at which attempt does the novice first land
// on any body anywhere", and the answer did not move: median attempt 4 before
// the change and median attempt 4 after. That number was never going to move,
// and it is worth saying why rather than quietly replacing it. The novice
// stands on its own corpses on 31% of all landings already — it dies constantly
// and all over the tower, so an accidental corpse landing is the common case.
//
// The change was never about the RATE. It was about there being a designed
// moment where the intended solution is your own body, early, in every tower.
// So the question is the specific one: of the players who get to the on-ramp
// perch, how many cross the gap above it by standing on a corpse left in it?
//
// Still a bot, and still reported rather than gated for the same reason: it
// cannot model curiosity, frustration, or reading the ghost the aim now lights
// up. It can only say whether the situation the design intends actually occurs.
{
  const S = SKILLS.novice;
  const scratch = [], cands = [];
  const ramp = FEEL.tower.openingSpan;

  let reachedPerch = 0, bridged = 0, jumped = 0;
  const bridgeAttempt = [];

  const origLand = Sim.prototype._land;
  for (let s = 0; s < SEEDS; s++) {
    const worldSeed = (0x1a2b3c + s * 0x9e3779b1) | 0;
    const sim = new Sim(worldSeed);
    const rnd = rng32((worldSeed ^ 0x5bf03635) >>> 0);
    sim.phase = PHASE.PLAY;
    sim.world.generate(600);
    const ls = sim.world.solids
      .filter((x) => x.live && !x.corpse).sort((a, b) => a.y - b.y);
    const pi = ls.findIndex((x) => x.y >= ramp);
    if (pi < 0 || pi + 1 >= ls.length) continue;
    const perch = ls[pi], target = ls[pi + 1];

    let sawPerch = false, sawBridge = 0, sawJump = false, attempt = 0;
    Sim.prototype._land = function patched(sol) {
      origLand.call(this, sol);
      if (sol === perch) sawPerch = true;
      if (sol === target && !sawBridge) sawJump = true;
      // A corpse standing in THIS gap, between the perch and the ledge above it.
      if (sol.corpse && !sawBridge
          && sol.y + sol.hh > perch.y && sol.y + sol.hh <= target.y + target.hh) {
        sawBridge = attempt;
      }
    };
    try {
      for (attempt = 1; attempt <= 20; attempt++) {
        const r = climb(sim, S, rnd, scratch, cands, 0);
        if (r === null) break;
        sim.respawn();
        if (sawBridge) break;
      }
    } finally {
      Sim.prototype._land = origLand;
    }
    if (!sawPerch) continue;
    reachedPerch++;
    if (sawBridge) { bridged++; bridgeAttempt.push(sawBridge); } else if (sawJump) jumped++;
  }

  const pct = reachedPerch ? (100 * bridged / reachedPerch).toFixed(0) : '0';
  console.log(`  ----  ${reachedPerch} of ${SEEDS} novice towers reach the on-ramp perch; ` +
    `${bridged} (${pct}%) then stand on a body left IN the gap above it, ` +
    `first at attempt ${median(bridgeAttempt)} (median). ${jumped} cleared it ` +
    `in one launch without ever needing one.`);
  console.log('        reported, not gated. A bot has no curiosity, never puts');
  console.log('        the phone down, and cannot read the ghost the aim now');
  console.log('        lights up — so this says the designed situation OCCURS,');
  console.log('        not that a person understands it. That needs a person.');
}

// ── 4. how often is a landmark claimed BY ACCIDENT? ───────────────────────
//
// Six landmarks answer if you leave a body in the heart of one, and nothing
// explains it (DECISIONS §31). The whole feature lives or dies on this number
// and it has to be in a BAND, not minimised:
//
//   too high and it is not a secret, it is an unexplained mechanic everybody
//   trips over and nobody understands;
//   too low and it is dead content — a player who never meets one never learns
//   the mechanic exists, and no amount of elegance fixes that.
//
// The design target is that the FIRST one finds most players by accident, which
// is the tutorial, and the other five have to be hunted, which is the game.
//
// It is measured here rather than in the landmark suite because the honest
// version needs a bot that actually CLIMBS. The landmark suite's version fired
// random launches from the base, reported 0.88 per 100 deaths, and was wrong by
// a factor of five — its deaths were never near a heart to begin with.
{
  const S = SKILLS.average;
  const scratch = [], cands = [];
  let deaths = 0, claims = 0, withAny = 0;

  for (let s = 0; s < SEEDS; s++) {
    const worldSeed = (0x1a2b3c + s * 0x9e3779b1) | 0;
    const sim = new Sim(worldSeed);
    const rnd = rng32((worldSeed ^ 0x5bf03635) >>> 0);
    sim.phase = PHASE.PLAY;
    const before = sim.deaths;
    for (let a = 0; a < 40; a++) {
      if (climb(sim, S, rnd, scratch, cands, 0) === null) break;
      sim.respawn();
    }
    deaths += sim.deaths - before;
    claims += sim.claimed.size;
    if (sim.claimed.size) withAny++;
  }

  const per100 = (100 * claims / Math.max(1, deaths));
  const pctTowers = (100 * withAny / SEEDS);
  check(per100 >= 0.8 && per100 <= 4.0 && pctTowers >= 25 && pctTowers <= 85,
    `${claims} accidental claims over ${deaths} deaths = ${per100.toFixed(2)} per ` +
    `100 (band 0.8-4.0); ${pctTowers.toFixed(0)}% of towers gave one up inside 40 ` +
    `attempts (band 25-85%) at heartU ${FEEL.landmark.heartU}`);
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nthe premise arrives on the on-ramp');
process.exit(fails.length ? 1 : 0);
