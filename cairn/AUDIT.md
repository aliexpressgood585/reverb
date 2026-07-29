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

## Known-honest gaps

These are open, not done, and not claimed:

- **No 4× throttled mobile profile.** Reason above.
- **No allocation audit of the frame loop.** Pools exist for particles, rings,
  trail, dust and solids, and the scratch bodies for prediction are allocated
  once. This was designed for, not verified with a heap profiler.
- **Balance is measured, and one of its four targets is only partly met.**
  30,000 climbs across novice/average/expert models are in `BALANCE.md`, with
  the generator retuned. Three targets hold outright. The fourth — the average
  player's median death height rising steadily — holds to about attempt 30 and
  then flattens near 600 m, for a reason that argument says cannot be removed
  without causing the difficulty collapse test 12 exists to catch. That is an
  argument, not a measurement of an alternative.
- **No human has played the retuned tower.** Three bots with gaussian error are
  not three people, and the novice model has no learning in it.
- **Aim tolerance is unmeasured for wall launches.** The precision survey's
  4,186 sampled jumps all leave from the ground, because that is what the bot
  does. The arc is proven honest from a cling; how much slop a cling launch
  forgives is not known.
- **Most of Phase 2 is not built.** Chunked streaming generation, the
  reachability solver, the four new biome verbs, momentum, close calls, the
  first-60-seconds choreography, Daily Climb, ghosts, Monument View, milestones
  and the instrumentation dashboard are all untouched.
