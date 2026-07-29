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

---

## The route audit, and the bug it found in the mechanic

`scripts/cairn-reach-check.mjs`, prompted by a real player at 481 m asking
whether the tower above them was real. It asks the only question that matters
about a tower with deliberately uncrossable gaps in it: **for every ledge, is
there a way up — in one jump, or in one jump plus the body you leave failing
it?** Three verdicts, all decided with the real physics:

| | |
|---|---|
| DIRECT | one launch lands on the next ledge |
| BRIDGED | no launch lands, but a corpse left at a reachable apex bridges it |
| WALL | neither. Only the shifting roof re-rolling the terrain saves you |

### What it found

The overreach mechanic was barely working. Audited from 481 m: **2.21% bridged,
2.95% wall** — against a knob set to make 27% of gaps unreachable at that
height. Almost every "impossible" gap was in fact crossable.

The cause: overreach pushed gaps sideways past the horizontal envelope, and **the
column is only 100 u wide.** A gap long enough to be uncrossable does not fit in
it, so `nx` clamped back inside the walls and the gap came out ordinary. The
mechanic was being defeated by the level's own width. BALANCE.md's earlier claim
that a third of an expert's deaths were deliberate throws was measured on the
bot's *behaviour* — it throws whenever its own limited plan search finds nothing
— not on the terrain being genuinely unbridgeable.

### The fix: too high, not too far

Height has no wall. A full-power launch straight up lifts about 34 u; a ledge
above that cannot be reached however wide the column is. And unlike the sideways
version it is **bridgeable by design**: throw slightly under full power, the apex
lands lower, the corpse's surface stays inside reach, you land on yourself, and
the rest is a short hop. *Throw yourself where you can follow* is the whole game
in one sentence.

| from 481 m | DIRECT | BRIDGED | WALL |
|---|---|---|---|
| horizontal overreach (shipped before) | 94.8% | 2.2% | 3.0% |
| vertical, rate 0.35 | 69.8% | 14.5% | 15.8% |
| **vertical, rate 0.22 (shipped)** | **78.9%** | **10.7%** | **10.4%** |

A bridged gap is worth **40 m** of height, up from 17.

### What a player hitting one looks like, and what came of it

A player was stopped at 391 m: the next ledge sat about 38 u above them, past the
~34 u a full-power launch lifts, and the two bodies flanking them had already
eroded to MEMORY. The mechanic firing exactly as designed, and reading as a wall.

Three things came out of chasing it.

**A real bug, fixed.** `_die` passed the apex as the corpse's CENTRE, so the
body's landable surface sat `corpseH / 2` — three units — *above* the highest
point the body ever reached. That is a small lie about the only rule this game
has, and it had a large consequence: the body you leave at maximum height is one
you can never stand on, because standing on it means reaching higher than you
just proved you could. The surface is now exactly where you froze.

**Ordinary generation is sound.** With overreach switched off: **964 gaps, 100%
DIRECT, zero dead ends.** Every wall in this game comes from the deliberate
mechanic and none from the ordinary generator.

**And the two requirements are in direct tension.** Switching overreach off also
makes **30 of 30 expert seeds immortal**, climbing 24-75 km without dying — the
exact empty loop this whole document exists to have fixed. "No situation is ever
impossible" and "the game has a ceiling" cannot both be had from this mechanism.

| overreachRate | WALL | BRIDGED | expert passes 600 m on attempt 1 |
|---|---|---|---|
| 0 | **0%** | 0% | 100% — never dies |
| **0.14 (shipped)** | **6.3%** | 6.3% | 20% |
| 0.22 | 9.5% | 9.8% | 5% |

0.14 is the compromise: a third fewer walls than shipped before, still killable.
It is not zero, and zero needs the generation-time route check PHASE3 §2 owes —
verify each overreach gap as it is built and demote it to an ordinary gap when no
route exists. Nothing here explains why roughly half of overreach gaps have no
one-body route: it is independent of the rise (identical at every band tried),
independent of the audit's sweep resolution (identical at 1 deg / 2 u), and
untested for two-body routes and for wall launches off a corpse's side.

### The cost, stated plainly

**10.4% of gaps above 481 m have no route even with a body in them.** Over the
~15 ledges between 481 m and 1081 m that is a dead end on most attempts. It only
ever costs one attempt — the roof re-rolls everything above your best, death to
playable is 900 ms — and it is invisible to the player, because a wall and a
bridgeable gap look identical until you throw. Both read as "this needs bodies".

It is still the honest weak point of the design: roughly half of all
uncrossable gaps cannot be bridged with one corpse, and nothing here explains
why. Two corpses were not tested.

### Two bugs in the audit itself, both worth recording

The first version cleaned up its test corpse with `regenerateAbove(-1e9)`, which
keeps only corpses — it deleted every ledge in the world, so every gap after the
first hard one scored as a dead end. It reported **23.89% walls that were its own
doing.**

The second sorted candidate body placements by closeness to the target, which
puts the *highest* apexes first — exactly the ones whose corpse cannot be landed
on, since a corpse's surface sits 3 u above the apex reached. Cutting that list
short discarded the useful bodies. Both failures had the same shape: a measuring
tool reporting the world as more hostile than it is.

---

## Precision — is a jump aimable?

Narrowing the ledges made this a fairness question rather than a curiosity, so
it is measured too. `scripts/cairn-precision.mjs`, no browser, about two
seconds.

```
node scripts/cairn-precision.mjs --seeds=120 --attempts=30 --every=2
```

### The arc used to lie when you launched off a wall

`_fire` added the wall kick — `wall.kickX * 0.35`, 16 u/s sideways — and
`predict()` did not know about it. So the arc the game draws while you aim,
which is the only thing you have to aim with, was wrong by 16 u/s of horizontal
velocity **every time you launched from a cling**.

| | launches | disagreements |
|---|---|---|
| from the ground | 2,400 | **0** |
| from a wall cling, before | 400 | **59** |
| from a wall cling, after | 400 | **0** |

Fixed by giving the kick one source: `Sim.launchVelocity()`, which `_fire` uses
to move the body and `predict` uses to draw the arc. Worst landing error is now
0.000 u in both cases.

Acceptance test 2 asserts exactly this property and passed throughout, because
its 97 launches all leave from the ground. A test that never enters the state
cannot fail in it — the same failure mode this file's own audit records twice
already.

### The body you would leave

The measurements above say the difficulty is structural: what kills you is a gap
that cannot be crossed, not an aim that was two degrees off. That creates a
problem this file raised and could not answer — **the bot knows a gap is
impossible because it runs the physics nine times, and a player has one arc
following their thumb.** An uncrossable gap that is indistinguishable from a
badly aimed jump reads as the game cheating.

So when the aimed launch cannot land, the game now draws the silhouette you are
about to become, at the apex, in the gold of memory and in the same figure every
corpse in the tower is drawn with. The question stops being "can I make this"
and becomes "where do I want my body", which is a decision instead of a
punishment — and it is the decision the whole design exists to offer.

It is exact, and it has to be, because it is the basis of choosing where to die:

| | |
|---|---|
| launches that die, previewed apex vs the corpse actually created | 2,848 |
| worst error | **0.000 u** |

`predict()` reports the same two fields `_die()` hands to `world.corpse()`. One
source, again.

Drawn, too, not merely computed — `scripts/cairn-ghost-check.mjs` holds a real
aim that cannot land and samples the composited frame with the ghost on and with
`FEEL.aim.ghostAlpha` forced to zero:

```
apex box   ghost on 121.0,73.7,29.5   off 94.5,51.8,22.1   delta 35.15
control    ghost on  24.4,13.1, 7.4   off  23.9,12.9, 7.4   delta  0.55
```

Two notes worth keeping, because both cost time. The check cannot work by
diffing two screenshots: every frame of this game moves, so two shots always
differ and the first version of it "failed" with the feature working perfectly.
And `renderer.X/Y` are CSS-space while the canvas backing store is device
pixels — a sampler that forgets the dpr reads a patch of empty sky and reports
the feature missing, which it also did.

The silhouette is drawn solid rather than dashed, and at the corpse's true size.
A body is 5.2 × 6.0 u — about fifteen CSS pixels on a phone — and a dash pattern
at that size breaks it into a dotted blob that reads as a marker rather than a
person. The size is left honest: that is exactly how much room the corpse will
take up, which is the thing being decided.

### How wrong can a launch be?

4,186 jumps sampled from real towers on the expert line. Three thresholds,
because they are three different questions:

| | p1 | p5 | median | p95 |
|---|---|---|---|---|
| angle before you **die** | 10.42° | 15.16° | 23.96° | 34.31° |
| angle before you **stop climbing** | 7.72° | 14.33° | 21.83° | 30.03° |
| angle before you **miss the ledge aimed at** | 4.67° | 10.71° | 21.34° | 29.74° |

Survival overstates the case — landing back on the ledge you left is not dying —
so the middle row is the honest one.

### Against what a thumb can express

The aim ray **is** the drag vector, so angular resolution is pure geometry: one
pixel at a drag radius of `r` is `(180/π)/r` degrees. On a 390×844 phone power
saturates at 186 px of pull, and past that the drag refines angle only, which is
the precision mechanic in `input.js` stated as a number:

| drag radius | one pixel |
|---|---|
| 186 px (power saturated) | 0.309° |
| 279 px | 0.206° |
| 371 px | 0.154° |

| power | one pixel of pull |
|---|---|
| 25% | 0.771 u/s (0.59% of max) |
| 60% | 0.363 u/s (0.28% of max) |
| 90% | 0.069 u/s (0.05% of max) |

**Verdict: aim resolution is never the limiting factor.**

| window narrower than | survival | still climbing |
|---|---|---|
| 1 px (0.31°) | 0.00% | 0.00% |
| 3 px (0.93°) | 0.05% | 0.07% |
| 10 px (3.09°) | 0.14% | 0.29% |

Not one jump in 4,186 demanded finer aim than a single pixel of thumb travel,
and 99.7% of them tolerate at least ten pixels. The window does tighten with
altitude, and does not tighten anywhere near far enough to matter:

```
      0-200 m   n=1768   median climb window 24.26°   p5 18.25°   at max power  8%
    200-400 m   n=1277   median 20.34°   p5 15.07°   at max power 16%
    400-600 m   n= 703   median 19.02°   p5 11.20°   at max power 18%
    600-800 m   n= 298   median 17.84°   p5 13.19°   at max power 17%
   800-1000 m   n= 102   median 18.85°   p5 10.18°   at max power 25%
  1000-1200 m   n=  36   median 18.55°   p5 11.36°   at max power 28%
```

The conclusion is worth stating plainly because it cuts against the design's own
marketing: **CAIRN's difficulty is not precision.** A jump forgives roughly
twenty degrees, and `landing.forgiveness` plus half a body is 5.1 u of that
before the ledge contributes anything. The thing that kills you is a gap that
cannot be crossed at all, which is why `overreachRate` moves the curve and
`snapMaxDeg` does not. The elaborate aiming machinery in `input.js` is buying
comfort, not challenge.

---

## The plateau: what was tried, and why it did not ship

The caveat under target 2 says the average player's median death height flattens
around attempt 30 because erosion caps how many bridging corpses you can keep
alive. The obvious lever is to let corpses far below the record age more slowly:
the frontier is where the game is played, and the tower underneath it is a
commute. `FEEL.erosion.deepSpan` / `deepScale` are that lever, **shipped as a
no-op** (`deepScale: 1`).

It works, on the numbers it was meant to move (expert, 60 seeds × 50 attempts):

| `deepScale` | median best after 50 | median-curve rise |
|---|---|---|
| **1 (shipped)** | 1,776 m | 635 m |
| 0.4 | 2,068 m | 1,031 m |

The frontier is provably untouched: **attempt-1 median is 347.0 m at every
setting**, to the decimal, because attempt one has no corpses in it at all.
Acceptance test 12 passes either way — ratio 1.00 shipped, 0.89 at 0.4.

And it did not ship, because test 12 cannot see what it costs.

### The measurement that decided it

DECISIONS.md §16 describes the flaw erosion exists to prevent: *"thirty attempts
in, the lower tower is a staircase; sixty in, the band where you keep dying is
trivial."* That is a claim about **one band of height getting easier within a
session** — and no number in this file could see it. A rising median death
height looks identical whether the player is getting further because they are
better supplied, or because the first 400 m stopped being a climb.

So: among attempts that reached the bottom of a band, what share died inside it?
First quarter of a session against the last.

| | 200–300 m | 400–500 m | 700–800 m |
|---|---|---|---|
| novice | 71% → 73% (×1.03) | 89% → 100% (×1.13) | never reached |
| average | 14% → 10% (×0.69) | 31% → 21% (×0.67) | 45% → 19% (×0.41) |
| expert | 7% → 2% (×0.33) | 17% → 8% (×0.47) | 22% → 8% (×0.38) |

At `deepScale: 0.4` the expert row becomes ×0.33 / **×0.20** / **×0.18** — the
softening roughly doubles. That is the §16 flaw, bought deliberately, and it is
not worth 300 m of ceiling.

### The finding that outlives the experiment

Read the shipped row again. **Erosion does not fully hold today.** For an expert,
a mid-tower band is already two to three times safer at the end of a session
than at the start. For a novice it is not — their hazard is flat, because they
never survive long enough to build a staircase — so the flaw is skill-dependent,
which is why sixty attempts of a deliberately clumsy bot never surfaced it.

**Acceptance test 12 reports ratio 1.00 and passes.** It measures height
reached, and a player getting further and a band getting easier both keep that
ratio near 1. It is the fourth thing in this repository to pass while blind to
the state it claims to cover. The band-hazard table above is the guard that is
not blind, and it should be read on every generation change.

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
- **Nothing measures whether the ghost actually teaches it.** The preview is
  proven exact and proven drawn. Whether a player seeing a gold body appear at
  the apex concludes "put a body there" rather than "I failed" is a question
  about a person, and no bot in this repository can answer it.
- **Only one `seed0`.** 200 world seeds is a lot of towers but they all descend
  from `0x1a2b3c`. A second root has not been run.
- **The precision survey never launches from a wall.** Section A proves the arc
  is honest from a cling; section B's 4,186 sampled jumps all leave from the
  ground, because that is what the bot does. Wall-launch tolerance is unmeasured.
