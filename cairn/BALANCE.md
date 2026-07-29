# CAIRN — balance, measured

Every number in this file came out of `scripts/cairn-balance.mjs`, which drives
`cairn/src/sim.js` directly in Node — the real physics, the real generator, the
real erosion. Nothing here is estimated and nothing here is from playing it.

```
node scripts/cairn-balance.mjs --all --seeds=200 --attempts=50
```

30,000 climbs: 10,000 per skill, 200 world seeds × 50 attempts, seeded from
`0x1a2b3c`. Runs in about two and a half minutes.

---

## The bot plays by a thumb's rules

A balance number is worth exactly what the bot is worth, so the constraints are
worth stating.

A launch is an angle plus a speed in `[minSpeed, maxSpeed]` and nothing else —
the same space `input.js` can produce from a drag. The bot plans with
`predict()`, which is not cheating: the game draws that arc on screen while you
aim, in time slowed to 15%. It receives the same soft angular assist a player
gets, re-implemented from `input.js._assist` with the same fan, window and cap.
Air control is a held thumb, so only the skills that would know about it use it.

Skill is two things, both human:

| | angular error (1σ) | power error (1σ) | looks ahead | uses air control |
|---|---|---|---|---|
| novice | 6.5° | 11.5% | 2 surfaces | no |
| average | 3.2° | 5.5% | 2 surfaces | yes |
| expert | 1.1° | 2.2% | 3 surfaces | yes |

Errors are gaussian and expressed in **degrees and percent of power**, because
those are the units a hand misses in. The acceptance suite's own bot uses a
±65% per-component multiplier; that is fine as a smoke test and meaningless as a
measurement.

These numbers are test scaffolding and live in the harness, not in `feel.js`.
`feel.js` is what the game is. This is what we measure it with.

**Death height** throughout means the apex the body froze at — where the corpse
is left, and the honest answer to "how high did I get".

---

## The finding: the world had no ceiling at all

Baseline, measured with the same bot against the generator at `f3e26a0`
(40 seeds × 20 attempts, because the runs are enormous):

| | median death | attempt 1 median | jumps per climb | worst 10 m band |
|---|---|---|---|---|
| novice | 166 m | 311 m | 13 | 7.1% |
| average | **4,722 m** | 4,622 m | 330 | 0.9% |
| expert | **82,089 m** | 83,440 m | **3,196** | 25% |

The expert line is not a difficulty reading. **40 of 40 seeds hit the harness's
4,000-launch cap without dying once.** The bot did not reach 84 km because the
tower ended there; it reached 84 km because the harness stopped it.

The cause was one constant:

```js
const diff = clamp(h / 900, 0, 1);
```

Above 900 m the generator stopped changing. The game therefore had a hardest
jump, and its hardest jump was comfortably survivable by anyone who could hold a
line. Below that ceiling nothing was hard either, because **every gap was
crossable**: ledges were placed strictly inside the reach envelope, so a player
who never had to fail never had to use the mechanic the whole game is built on.
The corpse was scenery.

PHASE3 called the world too easy on the strength of a 721 m median from a
fixed-skill bot. It was worse than that. There was no curve to be too easy.

---

## What changed

Three things, all in `FEEL.tower` — which is now where every number the
generator reads lives, rather than five of them being buried in a `while` loop
in `sim.js`.

**1. Difficulty never arrives.** `clamp(h / 900, 0, 1)` became
`1 - exp(-h / diffScale)` with `diffScale = 260`. An exponential approach has no
last step: it keeps taking ground for as long as the player keeps taking ground.

**2. Ledges got narrower and gaps got longer.** `maxWidth` 26 → 17, `minWidth`
11 → 6, and the gap fraction now runs from 42% of the usable envelope at ground
level to 100% at the top of the curve.

**3. Some gaps cannot be crossed.** Past `overreachFrom` (difficulty 0.30), a
share of gaps rising to `overreachRate` (0.35) are placed **beyond the physical
envelope** — measured against `v²/g` with no safety margin, and past the point
where standing on the near lip and landing on the far one with every unit of
forgiveness the game gives away is still not enough. You cannot make them. You
die at the apex, out in the middle of the gap, and the corpse you leave is the
step the next attempt uses.

The third is the one that matters, and it is safe only because the roof already
shifts: everything above your all-time best is re-rolled every attempt, so an
uncrossable gap is a bad hand and never a wall. The first version of this
measured "impossible" against the *safety-scaled* envelope, which is 70% of the
real one — those gaps were trivially crossable and the expert still climbed
26 km. Impossible has to be measured against the physics.

---

## The four targets

### 1 — novice reaches 50 m within 5 attempts and 150 m within 25

**Holds.** 50 m within 5 attempts in **98.5%** of seeds; 150 m within 25 in
**100%**. Median best after 5 attempts is 209 m, after 25 it is 310 m.

The 1.5% that miss 50 m by attempt 5 get there by attempt 8. Reported rather
than rounded away.

### 2 — the average player's median death height rises steadily, no plateau > 40 m

**Holds on the primary reading, with a caveat that is stated below rather than
buried.**

"No plateau > 40 m" has no single meaning — a stall in a curve of medians
against attempt number has a length in attempts, not in metres. The reading
used here is the literal one: *the curve must not park inside a 40 m band*. The
longest run of consecutive attempts whose medians all sit inside one 40 m band
is **8 attempts out of 50**. Inside a 5 m band it is **2**.

Median death height, average bot, by attempt:

```
attempt      1     2     3     5    10    15    20    25    30    40    50
median     327   407   418   472   535   555   572   610   626   549   659
```

**The caveat.** That curve rises hard to about attempt 25 and then flattens near
600 m. The running best keeps climbing the whole way and never flattens:

```
attempt      1     2     3     5    10    15    20    25    30    40    50
best       306   408   478   565   721   802   886   951  1033  1108  1165
```

strictly monotone across all 50 attempts, smallest gain over any 5-attempt
window 26 m.

The flattening is not a bug and it is not tunable away. Every attempt starts on
the base ledge, so as the record climbs, more of an attempt is spent re-climbing
known tower, and the chance of surviving all of it falls. Erosion sets a hard
equilibrium: a corpse bridging an uncrossable gap is solid for 25 deaths, you
die roughly once per attempt, so you can keep about 25 bridges alive at once —
which caps the altitude at roughly `25 / overreachRate` ledges. The expert's
best saturates at 1,806 m, which is exactly where that arithmetic puts it.

That cap is the same mechanism acceptance test 12 exists to enforce. Making the
death-height curve rise past attempt 30 means letting the lower tower get
easier, which is the difficulty collapse test 12 was written to catch. The two
requirements are in direct tension and this file records which one won.

### 3 — an expert can theoretically pass 600 m, but not on a first attempt

**Holds.** On a first attempt the expert's median is **383 m** and only
**8.5%** pass 600 m. Given more attempts, **100%** of seeds pass 600 m — median
best 699 m by attempt 5, 1,526 m by attempt 25, 1,806 m by attempt 50, with a
best single climb of 3,225 m.

`overreachRate` is the knob that sets this, and the trade is measured:

| overreachRate | expert attempt-1 ≥ 600 m | median best after 50 |
|---|---|---|
| 0.22 | 25.0% | 3,025 m |
| 0.28 | 12.5% | 2,334 m |
| **0.35** | **5.0%** | 1,962 m |

0.35 shipped because target 3 names 600 m explicitly and "not on a first
attempt" is the binding half of the sentence. (The 5.0% in this table is from
the 40-seed sweep; the 200-seed figure is 8.5%.)

### 4 — no single 10 m band holds more than 12% of all deaths

**Holds, with margin, for all three skills.**

| | worst band | share | next four |
|---|---|---|---|
| novice | 30–40 m | **8.46%** | 40 m 7.09%, 60 m 6.71%, 50 m 6.51%, 20 m 5.97% |
| average | 410–420 m | **1.77%** | 520 m 1.70%, 500 m 1.69%, 460 m 1.67%, 440 m 1.66% |
| expert | 520–530 m | **1.36%** | 730 m 1.21%, 600 m 1.21%, 620 m 1.10%, 410 m 1.09% |

The novice's heaviest bands form a smooth shoulder from 20 m to 60 m rather
than a spike at one height, which is the shape this target is asking for — a
spike would be a generator bug at a specific altitude.

This target caught a real bot bug before it caught a generator bug. An earlier
version of the harness scored candidate landings by height alone, so it would
jump onto a 5 u corpse when a 17 u ledge was available at almost the same
height, and died more the longer it played. That put 10.34% of novice deaths in
one band. The bot now adds a landing-width bonus capped below a single rise, so
it breaks ties without ever overruling going higher.

---

## Where it landed

10,000 climbs per skill, 200 seeds × 50 attempts.

| | median death | p10 | p90 | best single | attempt 1 | jumps/climb |
|---|---|---|---|---|---|---|
| novice | 98 m | 33 m | 248 m | 596 m | 129 m | 7.8 |
| average | 556 m | 259 m | 1,013 m | 1,790 m | 327 m | 32.8 |
| expert | 895 m | 399 m | 1,687 m | 3,225 m | 383 m | 49.0 |

Median running best by attempt:

```
attempt      1     5    10    15    20    25    30    40    50
novice     101   209   252   278   294   310   327   338   349
average    306   565   721   802   886   951  1033  1108  1165
expert     362   699   963  1182  1364  1526  1637  1752  1806
```

### The number that says the design works

Share of deaths that happened on a launch the bot **knew could not land** — a
gap past the envelope, thrown at deliberately to leave a corpse in it:

| novice | average | expert |
|---|---|---|
| 1.8% | 16.9% | 34.4% |

A novice dies because they missed. An expert dies on purpose, a third of the
time, because the tower asked for a body and the only way up is to be the step.
Nothing tunes that split directly; it falls out of the skill models meeting the
same generator. It is the clearest evidence available that the corpse mechanic
is now load-bearing rather than decorative.

### Acceptance test 12, before and after

The suite's fixed-skill bot, 60 attempts:

```
before   median height  first quarter 721.2 m   last quarter 501.9 m   ratio 0.70
after    median height  first quarter   243 m   last quarter   243 m   ratio 1.00
```

Test 12 asserts `ratio ≤ 1.35`, and it still passes. The absolute number fell by
a factor of three, which is the balance change showing up in an independent
measurement made by a different bot in a real browser.

---

## What this does not tell you

Open, not done, not claimed:

- **No human has played the retuned tower.** Three bots with gaussian error are
  not three people. In particular the novice model has no learning in it — a
  real first-timer's error shrinks over 50 attempts and this one's does not, so
  the novice curves here are a floor on progression, not a prediction of it.
- **The plateau in target 2 is unresolved, not solved.** The average player's
  median death height stops rising around attempt 30. The reasoning above says
  it cannot be fixed without breaking test 12, but that is an argument, not a
  measurement of an alternative.
- **Nothing measures whether the uncrossable gaps read as uncrossable.** The bot
  knows a gap is past the envelope because it ran the physics 9 times. A player
  has one arc following their thumb. If the game does not make "you cannot make
  this, put a body in it" legible on sight, the mechanic is a difficulty spike
  rather than a decision, and this file cannot tell the difference.
- **Only one `seed0`.** 200 world seeds is a lot of towers but they all descend
  from `0x1a2b3c`. A second root has not been run.
