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
route exists. **And the WALL number itself should be treated as suspect.** It sits at
50/50 against BRIDGED and does not move for any physical parameter: not the rise
(identical across 1.06x, 1.40x, 1.50x and 1.60x of full lift), not the rise
spread, not the sweep resolution (identical at 1 deg / 2 u against 3 deg / 6 u).
A measurement that ignores the physics it claims to measure is more likely
describing the instrument than the world — and this audit has already invented
two findings that way, once by deleting every ledge in the world and once by
discarding the only usable body placements. Tuning the game against it was
stopped for that reason rather than continued.

What is actually known: a player hit a wall twice, so walls are real at SOME
rate; ordinary gaps are provably fine at 964 of 964; and the rate knob does move
the player-facing risk. `overreachRate` is 0.14 on that basis and not on the
strength of the percentage. Untested: two-body routes, and wall launches off a
corpse's side — which the game supports and no audit here has ever exercised.

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

## The dead ends are gone, and what that cost

A player was stopped at **391 m, 481 m and 567 m** — three separate unleavable
ledges — and said the game did not feel ready to market. That is the end of the
argument, and it ended it in the right direction.

**Two things were built before the decision was taken.** The generator now
verifies: `Sim.routeExists` flies a dedicated probe body through the real physics
and, if it cannot demonstrate a route to a ledge — directly, or by leaving a body
in the gap and standing on it — the ledge drops to an ordinary rise. It is
deliberately conservative, because a false negative costs one hard gap and a
false positive costs the run, and a physics-verified positive cannot be false.
1,200 m of tower generates in 24 ms with it running.

It was not enough. Even with every unreachable ledge verified and demoted, ~5% of
gaps still had no route, while switching the mechanic off entirely gave 100%
DIRECT with no dead end anywhere. Every wall this game has ever produced comes
from that one mechanic, and half of them were never bridgeable for a reason a
great deal of measurement never explained.

**So `overreachRate` is 0.** Audited across **4,226 gaps from 0 m to 3,000 m:
100% DIRECT, zero walls.** The verifier stays as a permanent guard rather than a
repair — it costs nothing at zero and it will catch the next person who turns
this knob up without measuring.

### What it costs, plainly

A **bot** with 1.1 degrees of aim error now climbs without dying, which is the
finding this entire document started from. It is worth putting next to the other
number this document produced: **a jump forgives about twenty degrees, and one
pixel of thumb is 0.31 degrees.** Precision was never what killed anyone here. It
killed bots. A person's ceiling is nerve, patience and the narrowing ledges —
median width 9.7 u against a 4.2 u body — and an unleavable ledge is not
difficulty, it is a stop.

The honest position: **this game's difficulty curve is now unverified for expert
humans.** The bot models cannot see it, and the only way to know is to watch
someone good play. Everything in this file above that line still stands for
novice and average play, which is where retention is decided.

---

## What the dead ends cost, measured: nobody stood on themselves any more

The section above closed every wall and said the cost was a bot that no longer
dies. The cost was larger than that, and it took a measurement this repository
did not have to see it.

**Nothing here had ever counted how often a player lands on one of their own
bodies.** All four targets above are about height, and a tower where every gap is
crossable in one jump scores identically on all four whether the corpse mechanic
is load-bearing or decorative. `scripts/cairn-bodies-check.mjs` counts it now,
and the balance harness reports it on every run.

At `c1bf734` — every gap crossable, zero walls — 60 seeds × 50 attempts:

| | share of landings onto a body | per climb |
|---|---|---|
| novice | 32.60% | 2.45 |
| average | **1.92%** | 1.49 |
| expert | **0.02%** | 0.31 |

A novice builds a staircase because a novice dies constantly in a 300 m tower. An
average player did it twice a session. An expert never did it. The title card
promises EVERY DEATH LEAVES A STONE and for two of the three models the stone was
scenery — which is exactly the flaw DECISIONS.md §16 was written about, arriving
by the opposite route.

Worth stating plainly because it is not what the earlier sections predicted: at
that commit **60 of 60 expert seeds hit the harness's 4,000-launch cap without
dying**, so every expert number above the dead-ends section describes a bot the
tower could not kill, and the "Where it landed" table's expert row is from before
`overreachRate` went to zero.

---

## The hard gap, and why it cannot become a wall

An overreach gap was placed past the envelope and asked afterwards whether a body
could bridge it. About half the time nothing could, and every wall this game ever
had came from that. The construction is now the other way round, which is the
whole safety argument:

> **A hard gap is not placed and then checked. It is cut out of a flight.**

`Sim.hardStep` launches the probe off the **worst footing** on the ledge below —
the far end of the perch, the side away from where the ledge is going — flies the
real physics over a fan of legal launches, and puts the new landing surface
exactly where the body was on the arc that ended up furthest away, minus
`hardSlack`. Then it takes the proof back: the winning launch has to land on the
ledge that is actually there, and a weaker launch off the near footing has to as
well. Anything that cannot be demonstrated goes back to being an ordinary rise.

The worst footing is not a detail. A gap verified from the near edge becomes
unleavable whenever the player happens to land on the wrong half of a ledge, and
"I could not get off this ledge" is the report this mechanic was rebuilt around.

### It is a demand for POWER, not for aim

This came out the opposite of the expectation and it is the most useful thing the
audit produced. Sampled over 30 towers to 1,500 m:

| | angle you can be wrong by | power you can be wrong by |
|---|---|---|
| ordinary gap | 21.5° | **13.5% of full** |
| hard gap | 23.0° | **5.0% of full** |
| the average model's hand | 3.2° | **5.5%** |

A hard gap forgives *more* angular error than an ordinary one. It has to: it sits
at the far end of a trajectory, which is near the angle of maximum range, and
range is stationary in angle there — a few degrees cost almost nothing. Range
goes as v², so the entire difficulty lives in the pull.

That agrees with this file's own earlier conclusion rather than contradicting it —
**CAIRN's difficulty is not precision** — and it is why the mechanic is fair. The
arc the player aims with is drawn from the same integrator, in time slowed to
15%, and past 22% of screen height the drag stops adding power and refines angle
only, so one pixel at 90% power is 0.05% of full. A careful hand can make these.
A hurried one cannot, and the average model's 5.5% is wider than the 5.0% window.

### The first version of that table was measuring itself

It counted the share of a fixed fan of throws that landed, and reported hard gaps
as **more forgiving than ordinary ones (7.3% against 2.8%)** — because a fan of
full-power throws comes down 42 u away far more often than 22 u away. It was
measuring how far the target was, not how hard it was to hit. A number that comes
out backwards is usually describing the instrument, and this file now records
three of those.

### Requiring the body route destroyed the mechanic

"One hard jump, or two easy ones over your own body" is the design sentence, so
the obvious move was to make the generator prove the second route too, with the
same search `routeExists` uses. Measured, it selects against the thing it is
meant to guarantee: **the gaps a single apex body can bridge are the short ones.**

| | hard gaps | median span | angle window | average stands on itself |
|---|---|---|---|---|
| direct proof only (shipped) | 33.5% of gaps | **42.4 u** | 23.0° | **6.53%** |
| direct + body route required | 17.4% | **25.7 u** | 23.5° | **3.45%** |

The filter kept the short gaps, the surviving "hard" gaps forgave more error than
ordinary ones, and the gated number fell below its target. So the body route is
measured, not decreed — and it is not needed for safety, because the no-wall
promise is carried entirely by the direct proof.

**What a body is actually worth, then:** 33 of 76 sampled hard gaps can be
crossed in exactly two jumps over one body. The rest take either the direct jump
or more than one body, and **two-body routes are still unmeasured**, the same gap
this file recorded against the overreach mechanic.

### Where it landed

60 seeds × 50 attempts per skill, 9,000 climbs, against the same run at
`c1bf734`:

| | body landings | median death | attempt 1 | best after 50 | jumps/climb |
|---|---|---|---|---|---|
| novice | 32.60% → **32.41%** | 114 → **121 m** | 155 → **147 m** | 381 → **373 m** | 8.5 → **8.7** |
| average | 1.92% → **6.53%** | 1,269 → **682 m** | 1,069 → **536 m** | 4,887 → **1,700 m** | 79 → **38** |
| expert | 0.02% → **2.73%** | 32,821 → **2,023 m** | 27,941 → **1,445 m** | 86,637 → **6,566 m** | 1,643 → **112** |

**The expert is killable again: 60 of 60 seeds hit the launch cap before, 0 do
now.** That was not the goal and it is the clearest evidence the tower has a
ceiling that is not a wall — every one of those 4,506 gaps is crossable in one
launch from the worst footing.

### The four targets, re-read

| | before | after | |
|---|---|---|---|
| 1 — novice 50 m by attempt 5 / 150 m by 25 | 100% / 100% | **100% / 100%** | holds |
| 2 — average median curve keeps moving | rise 65 m, longest 40 m stall 5 attempts | **rise 345 m, stall 3 attempts** | holds, and better |
| 3 — expert passes 600 m, not on attempt 1 | **95.12% on attempt 1** | **83.33%** | **does not hold, and did not before** |
| 4 — no 10 m band over 12% of deaths | 6.73 / 1.03 / 1.44% | **6.27 / 1.87 / 0.97%** | holds |

Target 3 is stated as failing rather than reported as improved. It broke when
`overreachRate` went to zero — an expert who can reach every ledge in one jump
climbs until they get bored — and hard gaps move it 12 points in the right
direction without fixing it. Closing it needs gaps that genuinely cannot be
crossed, which is the mechanic that produced three unleavable ledges for a real
player. **That trade has already been decided in this repository and this section
does not reopen it.**

The band-hazard rows are worth reading too, because the absolute numbers moved
much more than the ratios: for the average model the 700–800 m band went from
killing 7% of the attempts that reached it to killing 30% early in a session and
16% late. The ×0.55 softening is unchanged — erosion still does not fully hold —
but the band is a real obstacle now rather than a formality.

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

## The verbs — how often they happen, and what they cost the curve

`scripts/cairn-verbs-check.mjs`, 20 towers to 1,800 m.

| | occurrences | biome | first met (median of 20 towers) |
|---|---|---|---|
| crumbling hold | 32 | ASH | **953 m** |
| updraft | 76 | SIGNAL | **195 m** |
| drifting ledge | 68 | BLOOM | **345 m** |

184 verbs across 1,846 ledges — about **one ledge in ten**. Density is roughly
flat with altitude (22.8% over 0-500 m, 7.4% at 500-1,500, 9.7% at 3,000-6,000,
11.3% at 9,000-12,000); the low bands only look different because a 500 m window
happens to contain all three verb biomes while a 1,000 m window contains three
plain ones as well.

**The teaching order is not an accident any more.** ASH is biome 0, so on the
single `verbs.from` threshold the crumbling hold could land in the first ASH lap
at 110-150 m — and in **7 towers of 18** the first verb a new player met was the
one that takes the floor away. `verbs.crumbleFrom` (0.50, above the 0.438
difficulty at 150 m) defers it to the second lap. Gift at 195 m, uncertainty at
345, the floor going away at 953.

**The cost of that ordering, stated plainly:** the average model met a crumbling
hold **once in 360 attempts** (best 1,095 m) against the expert's **14 in 360**
(best 3,976 m). For most players ASH's verb lives above where their run ends.

**None of it is a wall.** 304 gaps touched by a verb, with drifting ledges swept
at 12 phases of their cycle from the worst footing on the ledge below and the
updraft's help switched off for the audit: **zero uncrossable**. The falsification
runs matter as much as the pass — `verbs.driftAmp` at 16 produces 3 walls,
`verbs.updraftAccel` at 0 turns the lift test red, `verbs.crumbleRate` at 0 turns
the occurrence test red.

**And the arc had to be taught what time it is.** Before `Sim.driftXAt` and
`Body.t`, a launch the aim preview said would land on a drifting ledge failed to
land on it **293 times out of 408** — 71.8%. The preview froze the tower at the
instant the thumb went down; the flight moved it for a second and a half. After:
**0 of 272**, with the ledge verified to have moved more than 1 u during 186 of
those flights so the pass cannot be vacuous. Acceptance test 2 asserts this exact
property and reported 0.000 cm throughout, because its 94 launches all land on
ledges that do not move.

Where the drift margin actually comes from is worth writing down, because the
comment in the source said the wrong thing for a while. `driftAmp` is 4.0 u and
`landing.forgiveness` is 3 u — the drift is *wider* than the forgiveness. What
holds is `tower.reachSafety`: every ordinary gap is placed inside 70% of the
physical reach envelope, and 30% of a full-power launch is a much bigger number
than 4 u. Bisected: the first wall appears between **12 and 16 u**, so shipping
at 4.0 is about 3x of headroom.

And the bodies gate is unaffected by all of it — with the verbs in, the average
model still stands on its own corpses on **5.71%** of 10,119 landings against a
5% gate, the non-solid control still reads **0.00%**, and 263 constructed hard
gaps over 10 towers still have zero that a single launch cannot leave from the
worst footing.

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
- **`crumbleMs` is a judgement, not a measurement.** 900 ms is how long you have
  from landing on an ASH hold to leaving it. No bot in this repository needs any
  time to aim, so nothing here can tell you whether 900 is generous, tight or
  cruel to a thumb. The check proves the mechanic fires; it cannot price it.
- **Nothing measures whether the ghost actually teaches it.** The preview is
  proven exact and proven drawn. Whether a player seeing a gold body appear at
  the apex concludes "put a body there" rather than "I failed" is a question
  about a person, and no bot in this repository can answer it.
- **Only one `seed0`.** 200 world seeds is a lot of towers but they all descend
  from `0x1a2b3c`. A second root has not been run.
- **Nothing here knows whether a hard gap is fun to be stopped by.** It is proven
  crossable, proven to demand power rather than aim, and proven to be used — the
  average model stands on its own bodies 2.44 times a climb. Whether a person
  reads a gap they failed twice as a decision about where to leave a body or as
  the game refusing them is a question about a person.
- **Two-body routes are still unmeasured**, so "33 of 76 hard gaps are bridged by
  one body" is a floor on how often the shortcut exists, not the number.
- **Target 3 does not hold**, is recorded as failing above rather than folded
  into the improvement, and has now been re-opened once and closed again with
  measurement rather than with a citation. See the section below.
- **The precision survey never launches from a wall.** Section A proves the arc
  is honest from a cling; section B's 4,186 sampled jumps all leave from the
  ground, because that is what the bot does. Wall-launch tolerance is unmeasured.

---

## Target 3, re-opened and closed on measurement (2026-08-10)

> an expert can theoretically pass 600 m, but not on a first attempt

This section exists because "already decided" is not a measurement. The trade
was re-tested against every knob that could plausibly move it, and the outcome
is that target 3 **cannot be met without breaking `WALL = 0.00%`** — not as a
judgement call, as a number.

### Where it stands, re-measured

Expert, 200 seeds × 50 attempts, shipped config: **78.50% of first attempts pass
600 m**, median first attempt **1,106.7 m**. It does not squeak past the target,
it doubles it.

### The knob that meets the target, and what it costs

`overreachRate` is the only one that moves it, and it moves it completely:

| `overreachRate` | expert attempt-1 ≥ 600 m | route audit, 0–3000 m, 30 seeds |
|---|---|---|
| **0 (shipped)** | 78.50% | **4,516 gaps, 100.00% DIRECT, WALL 0.00%** |
| 0.45 | **0.00%** ✅ | 3,702 gaps, 82.36% DIRECT, **WALL 17.64% — 653 dead ends** |

At 0.45 the audit lists walls at 131, 133, 136, 149, 215 m and 553 other
distinct heights. A real player was stranded three times, at 391 m, 481 m and
567 m, by exactly this mechanic, and `overreachRate` was zeroed to fix it. Target
3 was traded away knowingly for that. Meeting it means putting the walls back,
seventeen percent of them, starting at 131 m.

### The wall-free knob does not move it

Hard gaps (§19) are the construction that cannot produce a wall: the ledge is
placed on a trajectory the physics actually flew, from the worst footing below.
Doubling their share is the honest attempt at target 3.

| config | expert attempt-1 ≥ 600 m | body landings (gate 5%) |
|---|---|---|
| `hardRate` 0.45 (shipped) | 78.50% | **7.20%** |
| 0.60 | 80.00% | 5.41% |
| 0.75 | 72.50% | 5.83% |
| 0.75, `hardSlack` 2 | 75.00% | 5.13% |
| **0.90** | **57.50%** | 5.61% |
| 0.90, `hardSlack` 1.5 | 70.00% | 5.22% |

The wall-free claim is measured, not assumed: the route audit at `hardRate` 0.90
reads **4,849 gaps, 100.00% DIRECT, WALL 0.00%, no dead ends** — the
construction holds at double the rate, so this column really is the honest
attempt and not a second way of putting walls in.

Doubling hard gaps to 0.90 buys 21 points and lands at 57.50%, which is not
"not on a first attempt" by any reading. And it pushes the *other* contract
number the wrong way: body landings fall from 7.20% to 5.61%, within 0.61 points
of the 5% gate. Tighter gaps kill the bot sooner, so it accumulates fewer
corpses high in the tower and stands on itself less — the two contract numbers
are not independent, and the knob that attacks one erodes the other.

### Why no amount of tightening can work

The bodies audit measures the window a hard gap leaves: **4.5% of full power**,
against **23 degrees** of angle. The expert model's hand is off by 2.2% of power
(1σ), so a hard gap is roughly a 2σ event for it — about a 5% failure rate, over
the ~8 hard gaps between the base and 600 m, which is the 78.5% survival that is
actually observed. Getting first-attempt survival under 20% needs the power
window down near 1%.

The average model's hand is off by **5.5% of power**. A 1% window is already
five sigma for the player this game is for. The tightening that would satisfy
target 3 does not make the game hard, it makes it impassable for everyone who is
not the bot — and the bot is not who the target is about. BALANCE.md has said
since the first pass that "a jump forgives about twenty degrees while one pixel
of thumb is 0.31, so precision was never what killed anyone. It killed bots."
This is the same finding arriving from the other direction.

### Verdict

**Target 3 stays failing, deliberately, and is now failing with its cost
priced.** The two ways to meet it are 653 dead ends or a power window five sigma
outside a real hand. Both are worse than the target being unmet, and both break
something the repository treats as a contract. Nothing changed.

What could legitimately close it is a difficulty source that is neither an
impossible gap nor a tighter window — the biome verbs are the obvious candidate,
since a crumbling hold kills a perfect executor without narrowing anything — but
PHASE3 §7 is out of scope for this pass and a verb never lands on a hard gap by
construction (DECISIONS §26). Flagged, not attempted.
