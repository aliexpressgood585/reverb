# CAIRN — Gate 0 audit

Written on the assumption that Phase 1 overclaimed. It did, in two places, and
both were found by re-running rather than by re-reading.

Everything below is a measured result from `node scripts/cairn-check.mjs`
against the shipped build at a 390×844 viewport, not an assertion.

---

## The two things Phase 1 got wrong

### 1. It shipped a game that could not be started

The title card is a full-screen scrim. It had no `pointer-events: none`, so it
swallowed every touch before the canvas saw one.

**Ten acceptance tests passed on that build.** Test 10 dispatched a
`PointerEvent` directly at `#view`, and dispatching an event *at* an element
bypasses hit-testing entirely — the overlay was never consulted. The test proved
the handler worked while the input could not physically reach it.

Test 10 now drives `page.touchscreen`, which hit-tests like a thumb, and checks
five sample points for anything that eats a touch.

**Lesson, and it generalises:** a test that reaches past the browser's own
machinery is testing your code, not your game.

### 2. It reported a deploy that never happened

The fix for the above was pushed and reported as live. It was not. `vercel.json`
carried a `comment` key inside a headers entry — not in Vercel's schema — so the
build was rejected and the site kept serving the previous commit, while git
reported a clean push.

Compounding it, the v1 service worker served navigations cache-first, pinning a
real device to the exact build where the game could not be started. So the
device could neither play nor update. A tombstone deployed at the same URL does
**not** rescue it: Chrome will not re-fetch a worker script until the
registration is a day old — measured, not assumed, across five reloads in a
scripted strand-and-recover harness.

The service worker is gone. Every deploy is now verified by fetching the live
artefact and comparing the bundle hash against the local build.

---

## Acceptance tests — real results

| # | test | result |
|---|---|---|
| 1 | identical drags → identical landings | **PASS** — three runs of six launches, bit-identical |
| 2 | predicted arc matches actual flight | **PASS** — 101 launches, worst error 0.000 cm, 0 disagreements |
| 3 | no tunnelling at max launch speed | **PASS** — 140 launches through a six-deep corpse wall, 0 pass-throughs, longest sub-step 1.34 u vs a 2.10 u budget |
| 4 | frame budget with 100+ corpses | **PASS with a caveat** — 1.5–3.5 ms/frame CPU for the scene pass with 130 corpses. See below. |
| 5 | 50/200/400 m instantly distinguishable | **PASS** — closest pair differs by 32.5 in mean RGB |
| 6 | nothing is flat grey | **PASS** — 0.0% flat grey at every altitude, min chroma 33.8 |
| 7 | death → playable under 1.2 s | **PASS** — 900 ms |
| 8 | tower survives a hard reload | **PASS** — 17 corpses and a 271.5 m best restored |
| 9 | no scroll/zoom/selection/pull-to-refresh | **PASS** |
| 10 | discoverable with zero text | **PASS** — now through the real touch pipeline |
| 11 | aim points where you drag | **PASS** (new) — pins direct aiming against a silent flip back |
| 12 | difficulty does not collapse | **PASS** (new) — see below |
| 13 | four erosion stages distinguishable | **PASS** (new) |

### Test 4, honestly

This container runs a software rasteriser roughly 20–40× slower than a phone
GPU. Test 4 measures the **CPU** cost of the scene pass, which is the part that
scales with corpse count, and reports it. The GPU side is four fullscreen draws
at ≤ DPR 2 — a well-understood cost, but a prediction, not a measurement.

**I have not profiled a 4× throttled mobile session,** because I cannot get a
trustworthy number for one from here. The debug overlay (triple-tap top-left)
reports live fps, frame time, entity counts and physics sub-steps on the actual
device, which is the only place that number is real.

---

## The core design flaw, and the measurement that it is fixed

Corpses were permanently solid. Thirty attempts in, the lower tower is a
staircase; sixty in, the band where you keep dying is trivial. **The difficulty
curve inverts** — the game gets easier exactly where it should get harder.

Fixed by two systems (see DECISIONS.md §16):

- **Erosion** — solidity decays over four stages while presence does not.
- **The shifting roof** — everything above your all-time best is regenerated
  from a fresh seed every attempt, deterministically per attempt index.

Test 12 plays a **fixed-skill** bot to sixty real deaths and compares median
height reached in the first quarter of attempts against the last quarter. Skill
never improves, so any rise must come from the world:

```
60 attempts, 60 deaths
median height   first quarter 243 m
                last  quarter 243 m        ratio 1.00
corpses after 60 deaths: 6 fresh, 18 eroded, 35 memory (non-solid)
```

A ratio of 1.00 means late attempts reach neither higher nor lower. The
inversion is gone, and erosion runs its full course — thirty-five selves have
decayed to non-solid memory while remaining permanently drawn in the tower.

These numbers replace the ones this file carried at Phase 2, which were
721.2 m / 501.9 m / ratio 0.70. The absolute heights fell by a factor of three
because the generator was retuned; see `BALANCE.md`. The ratio is what this test
asserts and it still passes.

The first version of this test capped attempts by jump count instead of by
death. The bot was good enough that attempts ended on the cap, no corpse ever
aged, and the test measured nothing while reporting a number. It is recorded
here because it is the same failure mode as Phase 1's test 10: a test that
passes without touching the thing it claims to check.

---

## The arc lied off a wall

Recorded here with the other tests that passed while missing something, because
it is the same shape as both of them.

`_fire` added the wall kick to a launch off a cling — `wall.kickX * 0.35`,
16 u/s sideways — and `predict()`, which draws the arc the player aims with,
did not. Measured: 2,400 launches from the ground agreed exactly, 59 of 400 from
a wall cling did not. Fixed by giving the kick one source, `Sim.launchVelocity`,
called by both.

**Test 2 asserts exactly this property and passed the whole time**, because all
97 of its launches leave from the ground. It is the third instance in this file
of a test that cannot fail in a state it never enters. See `BALANCE.md` for the
numbers and `scripts/cairn-precision.mjs` for the harness.

---

## Erosion does not fully hold, and test 12 cannot see it

Test 12 above passes at ratio 1.00. It measures the height a fixed-skill bot
reaches, early attempts against late — and a player getting *further* and a band
of the tower getting *easier* both keep that ratio near 1.

Measured the other way, in `BALANCE.md`: among attempts that reached 700 m, the
share that died before 800 m falls from **22% to 8%** across a session for an
expert, and from 45% to 19% for an average player. For a novice it does not move
(×1.03) — they never survive long enough to build a staircase. So DECISIONS.md
§16's flaw is **skill-dependent and partially present today**, which is exactly
why sixty attempts of a deliberately clumsy bot never surfaced it.

Not fixed here, and deliberately not papered over: the band-hazard table in
`BALANCE.md` is now the guard that can see it.

---

## The premise was never measured, and for a while it was not true

Every number in this file and in BALANCE.md is about height. **Nothing counted how
often a player lands on one of their own bodies** — so a tower where the corpse is
load-bearing and a tower where it is scenery scored identically on all four PHASE3
§1 targets, on acceptance test 12, and on the route audit.

Counted (`scripts/cairn-bodies-check.mjs`, 60 seeds × 50 attempts), it was
scenery for two of the three models:

| | at `c1bf734` | now |
|---|---|---|
| novice | 32.60% of landings | 32.41% |
| average | **1.92%** | **6.53%** |
| expert | **0.02%** | **2.73%** |

The cause was the fix for the dead ends: with `overreachRate` at zero every gap is
crossable in one jump, so nobody ever needs a body. The same commit also left
**60 of 60 expert seeds hitting the harness's launch cap without dying** — the
empty loop this project has now been round twice.

Fixed by a gap that is **cut out of a flight instead of placed and then checked**
(DECISIONS.md §19): the generator flies the real physics off the worst footing on
the ledge below and puts the new surface at the far end of the arc, so the direct
route is proven by construction and a wall cannot arise. 4,506 gaps from 0–3,000 m
audit 100% DIRECT, and 766 of 766 constructed hard gaps are crossable in one
launch from the worst footing under an independent sweep at 1° × 1.5 u/s.

Three findings from doing it, all of the shape this file keeps recording:

- **The first hardness metric measured itself.** Counting the share of a fixed fan
  of throws that landed reported hard gaps as *more* forgiving than ordinary ones,
  because full-power throws land 42 u away more often than 22 u away. The real
  number: a hard gap demands **power** (5.0% of full against 13.5%) and is if
  anything *more* tolerant of angle (23.0° against 21.5°).
- **Making the generator also prove the body route destroyed the mechanic**, by
  selecting for exactly the short gaps a single apex body can bridge. Numbers in
  BALANCE.md.
- **The new gate is falsifiable and has been seen to fail.** `--tune` turns it red
  two ways, and its "unleavable" counter was exercised against deliberately
  sabotaged towers — 347 of 450 caught — because a counter nobody has watched fire
  proves nothing.

---

## The verbs, and the two things they were nearly wrong about

The one complaint a real player made after 11,045 m was that *the design between
the stages repeats itself*. Six biomes were six palettes and six silhouettes
over one identical verb. Three of them now change what a ledge is and one
changes what you can see (DECISIONS.md §26, PHASE3 §7). Both of the things this
nearly got wrong were found by writing the check before believing the code.

**The first version of the updraft test reported 0 of 46 on a working
updraft.** It compared `sim.predictPeak.y` with and without lift — and
`predictPeak` is only written when a launch *dies*. A launch that lands leaves
the previous run's value sitting in the field, so the comparison was a number
against itself. The apex now comes off the drawn arc. Same family as every other
entry in this file: the instrument was broken, not the thing.

**And the one that mattered: the aim arc lied on 71.8% of drifting ledges.**
`predict` runs the integrator many times inside one aiming frame; `_stepVerbs`
runs once per tick. The preview therefore froze the tower at the instant the
thumb went down while the real flight moved the ledge underneath it. Acceptance
test 2 asserts exactly this property, reports 0.000 cm, and passed throughout —
all 94 of its launches leave from the ground onto ledges that do not move. Fixed
with `Sim.driftXAt` and a clock on every body; **0 of 272** after. Third time
this repository has shipped an arc that disagreed with its own flight, through a
third new hole (DECISIONS.md §4, §19, §26).

**The comment on `driftAmp` was false.** It said the 4.0 u drift was "bounded
well inside `landing.forgiveness`", which is 3 u. What actually keeps a drifting
ledge reachable is the 30% of the reach envelope every ordinary gap sits inside,
and the real margin is measured rather than asserted: the check sweeps twelve
phases of the drift cycle and the first wall appears between **12 and 16 u**.

**VOID's darkness was outside every gate until it was put inside one.** Tests 5
and 6 sampled 50, 200 and 400 m; VOID starts at 450, so no acceptance test in
this repository had ever looked at the biome whose entire verb is a change to
the whole frame. A darkness gone too far would have shipped behind fourteen
green tests. The sample list is 50, 200, 400 and **520** now, and VOID measures
mean rgb 20.1/16.1/8.9, **chroma 11.3** against a gate of 3, 0.0% flat grey,
36.2 from its nearest neighbour. Much darker than any other biome — which is the
design — with 3.7x of margin on the washing-out gate.

**Open and not claimed:** `crumbleMs` is 900 and no human has ever stood on a
crumbling hold. It is a judgement about how long a player needs to aim under
pressure, and the only measurement behind it is that a bot does not need any
time at all. The gate proves the mechanic *fires* — 14 holds gave way under an
expert over 360 attempts — not that 900 ms is the right number.

**Also honest:** the crumbling hold waits for the second ASH lap at 900 m, so
the average model met one **once in 360 attempts**. For most players ASH's verb
lives above where their run ends. That was the price of not introducing the
punishing verb before the generous one, and it is reported next to the gate
rather than under it.

---

## Two gates that flip on container noise, not on code

Recorded because both cost time to attribute and neither is a regression.

**`cairn-device-check.mjs`'s sub-linearity gate is meaningless as written.** It
divides by `(t130 - t0)`, two sub-millisecond numbers that this container returns
in any order, so the same code prints `-0.05x`, `-11.00x` and `+17.00x` across
runs and the gate passes on a negative denominator and fails on a small positive
one. The measurement it is protecting is real; the arithmetic gating it is not.

**`cairn-monument-check.mjs`'s "one tap returns" test is timing-bound.** It waits
1,400 ms for `camera.mon` to ease below 0.05, which depends on how many frames the
software rasteriser managed. Seen at 0.06 once and at 0.007–0.011 on three
consecutive re-runs of the same build.

Same family as test 13, which swung between 0.7 and 53.5 on identical code.

---

## Known-honest gaps

These are open, not done, and not claimed:

- ~~No 4x throttled mobile profile~~ and ~~no allocation audit of the frame
  loop~~ — **both done**, `scripts/cairn-device-check.mjs`. What a container that
  rasterises WebGL in software can honestly gate is not milliseconds, so it gates
  the two things that are hardware-independent. **Cost is sub-linear in corpses**
  (3.1x the tower costs 0.2x the per-corpse time — culling and height buckets
  working), so the tower has no cliff waiting at some height. And a steady frame
  with 300 corpses **retains 60 bytes and churns 216 bytes** — the pools hold and
  there is no leak. The whole frame including the grade is reported and not
  gated: 4 fps at 1x here, 3 fps at 4x throttle, software-rasterised and 20-40x
  slower than a phone GPU.
- ~~Dead ends still exist~~ — **gone, and the ceiling came back with them.**
  `overreachRate` is 0 and 4,506 gaps from 0–3,000 m audit 100% DIRECT. Turning it
  off did make the expert immortal, which is what the hard gap above fixes: 60 of
  60 expert seeds hit the launch cap at `c1bf734`, 0 do now, and not one gap in the
  tower is uncrossable. The two requirements were held to be in direct tension and
  they were only in tension for **one** mechanism.
- **Balance is measured, and one of its four targets does not hold.** The curves
  are in `BALANCE.md`. Three hold: the novice reaches 50 m by attempt 5 and 150 m
  by 25 in 100% of seeds, the average player's median curve rises 345 m with no
  40 m stall longer than 3 attempts, and no 10 m band holds more than 1.9% of any
  model's deaths. **Target 3 fails** — an expert passes 600 m on 78.5% of first
  attempts (83% when this was written) against a target of "not on a first
  attempt". It failed at `c1bf734` too, at 95%.

  Re-opened and closed on measurement 2026-08-10, so this is now a priced trade
  rather than a citation. The only knob that meets the target, `overreachRate`
  0.45, takes the route audit from **WALL 0.00% to 17.64% — 653 dead ends, the
  first at 131 m**, which is the mechanic that stopped a real player at 391, 481
  and 567 m. The wall-free knob is genuinely wall-free (`hardRate` 0.90 audits at
  4,849 gaps, 100% DIRECT, 0 dead ends) and genuinely does not work: it moves
  first-attempt survival only 78.5% → 57.5%, and drags body landings from 7.20%
  to 5.61%, within 0.61 points of the 5% gate. And the tightening that would
  close the remaining distance needs a power window near 1% against an average
  hand that is off by 5.5% — five sigma. Both routes break a contract number;
  the target stays unmet on purpose. Table in `BALANCE.md`.

  Qualified the same day by a parallel session: TIME is a third axis, it is
  wall-free, and it moves the number to 68% — and the harness had never modelled
  a hand pausing on a ledge at all, which is the seventh blind measurement in
  this repository. Unmet, but no longer a closed door.
- **No human has played the retuned tower.** Three bots with gaussian error are
  not three people, and the novice model has no learning in it.
- **The band-hazard softening above is measured, not fixed.** An expert's
  mid-tower bands get 2-3x safer over a session. Whether that reads as healthy
  progression or as the difficulty going soft is a question about a player.
- **Aim tolerance is unmeasured for wall launches.** The precision survey's
  4,186 sampled jumps all leave from the ground, because that is what the bot
  does. The arc is proven honest from a cling; how much slop a cling launch
  forgives is not known.
- **Much of Phase 2 is still not built.** Chunked streaming generation, the
  reachability solver, momentum, close calls, the
  first-60-seconds choreography, Daily Climb, ghosts, milestones and the
  instrumentation dashboard are untouched. Balance (PHASE3 §1) and Monument View
  (§6) are done and have their own harnesses.
- **The reachability solver's specification is now wrong.** PHASE3 §2 says
  "zero impossible or single-solution chunks across 10,000 seeds". A share of
  gaps are now placed past the envelope deliberately, so that criterion fails by
  design. What it has to prove instead is that every chunk has a route GIVEN AT
  MOST N CORPSES. Today the shifting roof is the only thing standing between a
  bad roll and a permanent wall, and that protection is argued in BALANCE.md, not
  proven.
- **Monument View's gesture is not discoverable.** Two fingers is the only input
  that cannot collide with aiming, and nothing teaches it — in a game whose rule
  is that nothing is taught with text. The poster behind it is the game's primary
  share surface, so this is a growth problem, not a polish one.
- ~~Persistence has no migration path and no corruption recovery~~ — **done**,
  `scripts/cairn-store-check.mjs`. It also uncovered a shipped bug: schema 1 did
  not store `bornDeath`, so every corpse came back at age = `deaths`, already
  MEMORY. **A reload turned the staircase a player had built out of themselves
  into scenery.** Test 8 passed throughout, because it checks that corpses exist
  after a reload, not that they still hold weight — the fourth instance in this
  file of a test blind to the state it claims to cover. v1 saves migrate exactly
  rather than by guessing: every death creates one corpse and increments
  `deaths`, so a corpse's birth index is its position in death order.
