# CAIRN — Phase 0 audit

Written before anything was changed, against `442aa8f`. Every number here was
measured in this container by `scripts/cairn-profile.mjs`, `npm run check`, and
the existing harnesses; nothing is estimated.

`cairn/AUDIT.md` is the older, deeper audit of the game's design and its
measurement failures. This file is about the *engineering* — architecture, frame
timing, performance, and what a store release would trip over. Read that one for
why the tower is the way it is.

---

## Architecture

```
cairn/
  index.html    inline service-worker recovery, before the bundle
  style.css     gesture lockdown and the whole interface
  main.js       the loop: accumulator, interpolation, events, PWA, debug overlay
  src/
    feel.js     FEEL + BIOMES. The only file allowed a tuning number.
    types.js    JSDoc typedefs for Solid and Body. No runtime code.  (new)
    rng.js      mulberry32, FNV-1a, seeded shuffle — for everything that is
                random but is NOT the terrain.                        (new)
    sim.js      physics, generator, corpses, erosion. No DOM; runs in Node.
    input.js    pointer and the aim model.
    render.js   Canvas2D scene + Camera. No allocation in the loop.
    post.js     one WebGL pass: bloom, CA, grain, vignette, barrel, grade.
    audio.js    WebAudio, fully synthesised.
    store.js    versioned persistence, share poster, procedural icon.
```

**The render path is a deliberate split**: Canvas2D draws the scene into an
offscreen canvas, one WebGL pass grades it. Four draw calls. When WebGL is
unavailable `Post.create` returns null and the 2D canvas is promoted into the
page — the game is less pretty and never broken. Three.js was deleted in an
earlier phase; 120 KB of 3D engine for a 2D art direction.

**State** lives in exactly three places and they do not overlap: `Sim` owns
everything the physics touches, `ui` in `main.js` owns everything presentational,
and `Store` owns the bytes on disk. There is no framework and no observable
graph, which is why the whole simulation runs headless in Node.

---

## Frame timing — already correct, and this is the load-bearing part

**The question the brief asks — does gameplay speed vary with framerate — is no,
and it is enforced rather than hoped for.**

`FEEL.sim.dt` is `1/120` and never varies. Real time enters the game in exactly
one place, the accumulator in `main.js`, and is spent in whole steps:

```js
accum += scaled;
if (accum > FEEL.sim.maxCatchUp) accum = FEEL.sim.maxCatchUp;
while (accum >= DT && steps++ < 512) { accum -= DT; sim.tick(...); }
```

Rendering interpolates between the last two ticks via `body.rx/ry`, so a 60 Hz
display shows smooth motion off a 120 Hz simulation rather than every other
frame. A backgrounded tab is clamped to 0.25 s so it cannot fast-forward.

**The brief specifies 60 Hz; this is 120 Hz and stays 120 Hz.** Halving the rate
would double the worst-case collision sweep distance for no benefit — the cost
is 0.0003 ms per tick, which is unmeasurable — and every balance number in
`cairn/BALANCE.md`, all 30,000 climbs of them, was produced at this step. See
DECISIONS.md §20.

Two identical drags produce bit-identical landings; acceptance test 1 asserts it
and `tests/sim.test.js` asserts it again headlessly.

---

## Measured performance

`node scripts/cairn-profile.mjs --minutes=10`, against the built bundle.

### Bundle and load

| | measured | budget |
|---|---|---|
| total payload, gzipped | **24,108 B** | 2 MB — **1.15% used** |
| JS | 21,357 B gz | |
| CSS | 1,308 B gz | |
| HTML | 1,044 B gz | |
| interactive on simulated slow 4G (1.6 Mbps, 150 ms RTT) | **645 ms** | 2,000 ms |

Zero external assets. No fonts, no images, no audio files, no CDN. The icon is
drawn to a canvas at boot; every sound is synthesised. That is the reason for
both numbers above and it is a hard rule in this project.

### Frame cost at a 4x CPU throttle

CPU only, and the distinction matters: this container rasterises WebGL in
software, 20–40x slower than a phone GPU, so the *whole-frame* number here is
meaningless and is not reported as a frame rate. What is honest is the CPU cost
of the two things that scale with the tower.

| bodies | sim/tick | scene/frame | sim/tick @4x | scene/frame @4x |
|---|---|---|---|---|
| 0 | 0.0003 ms | 0.54 ms | 0.0005 ms | 1.27 ms |
| 200 | 0.0003 ms | 1.08 ms | 0.0000 ms | 1.81 ms |
| 400 | 0.0000 ms | 0.38 ms | 0.0000 ms | 1.78 ms |

**A 60 Hz frame at 4x throttle with 200 bodies costs 2.81 ms of CPU — 16.8% of
the 16.67 ms budget — before the GPU grade.** Cost does not grow with the tower;
height buckets and culling hold. The GPU side is four fullscreen draws at ≤ DPR
2, which is a well-understood cost and still a prediction, not a measurement.

**The 60 fps target is therefore not verified and cannot be from here.** The
debug overlay (triple-tap top-left) reports live fps, frame time, entity counts
and physics sub-steps on the actual device. That is the only place the number is
real.

### Memory over ten minutes

| | |
|---|---|
| 36,000 frames of real play | 690 launches, 204 deaths |
| heap before | 2.02 MB |
| after, post-GC | 2.45 MB |
| retained | **12.5 B/frame** |
| extrapolated over an hour | **2.58 MB** |

That is not zero and most of it is not a leak: 204 deaths create 204 corpses and
several hundred metres of generated ledges, all of which are real game state.
Corpses are capped at 600 in storage and the pools (particles, rings, trail,
dust) are fixed-size Float32Arrays that never grow — the profile confirms it,
ending with 0 live particles and a trail at its 26-point cap.

**The first version of this measurement was worthless and it is worth recording
why.** It ran 36,000 frames in under one second, because the body was standing on
the base ledge the whole time: no flight, no trail, no particles, no deaths, no
respawn. It was a heap profile of an idle game, which is the one state that
cannot leak. It now launches whenever it is grounded, and the harness prints the
launch and death counts next to the number so the failure cannot recur silently.
This is the sixth instance in this repository of a test that passed without
entering the state it claimed to cover.

---

## Bugs and inconsistencies found

Found by turning on `strict` + `checkJs` and ESLint over the shipped game, which
had never been type-checked or linted.

| what | where | severity |
|---|---|---|
| **`ui.taught = ui.taught`** — a self-assignment carrying a comment that explained an intent it did not implement | `main.js` `setMode` | cosmetic, but it read as logic |
| **`ctx.scale(1 + ui.stretch * 0.0, 1)`** — a scale by exactly 1, and `stretch` is not a field any live code sets | `render.js` `_player` | dead code |
| **`this.scale` / `originX` / `originY` were never initialised** — a `draw` before the first `_setup` would put every coordinate at `NaN` | `render.js` | latent |
| **Audio methods reached through nullable `ctx`/`master` guarded by a separate `ready` boolean** — `duck()` fires from `visibilitychange`, which can precede any touch | `audio.js` | latent crash |
| **`Store.load` carried its results as properties on the function object** | `store.js` | fragile; now `loadStats` |
| **`makeRng` seeded from a value that can be 0** — `(seed|0) || 0x9e3779b9` already handles it | `sim.js` | not a bug; confirmed correct |

The audio one is the only one that could have reached a player: backgrounding the
app before ever touching it would have called `duck(true)` against a null master
bus. Every audio method now takes its context and bus from one guard expression
rather than from a flag set somewhere else.

**No physics inconsistency was found.** The arc-versus-flight property is exact
to 0.000 u across 39 launch configurations headlessly and 96 in the browser, and
the corpse-surface-at-apex property holds to six decimal places.

**Input latency was not re-measured and does not need to be**: everything reacts
on `pointerdown`, nothing in the input path has a CSS transition, `touch-action:
none` is set on the surface, and `preventDefault` is called on every gesture the
platform would otherwise steal. The end-to-end number is display-pipeline bound
and cannot be measured in a headless container.

---

## Foundation added in this phase

| | |
|---|---|
| **TypeScript strict** | `tsconfig.json`, `strict` + `checkJs` + `noUnused*` + `noImplicitReturns`. **Zero errors across all 4,300 lines of the shipped game.** |
| **Unit tests** | Vitest, `tests/sim.test.js`, 19 tests, 0.6 s |
| **Lint** | ESLint flat config, zero errors |
| **Format** | Prettier |
| **Pre-commit** | `.githooks/pre-commit` → typecheck, lint, unit tests |
| **Seeded RNG** | `cairn/src/rng.js` — mulberry32, FNV-1a, seeded shuffle |
| **Profiler** | `scripts/cairn-profile.mjs` |

**On TypeScript, honestly:** this is `checkJs` with every strict flag on, not a
`.ts` conversion. The physics is pinned by fourteen acceptance tests and 30,000
headless climbs, and rewriting all of it to get inference-only generics would
have risked that for very little. What strict mode had to catch, it caught — the
table above is its output. Vite ships these files as written, which is most of
why the bundle is 21 KB. Reasoning in DECISIONS.md §21.

**Two ESLint rules are project-specific and both encode a real failure:**
`Math.random` is banned inside `sim.js` (a tower is a seed; one unseeded call and
the daily climb, the share card and determinism are gone), and unused-parameter
names must start with `_` so a dropped argument is visible rather than silent.

---

## Honest assessment: what is good, and what is mediocre

### Genuinely good

**The core mechanic is real and it is now measured.** "Every death leaves a
stone, climb on what you were" is not a tagline over a generic platformer — the
corpse is load-bearing, and there is a number for it: the average model stands on
one of its own bodies on 6.53% of landings, 2.44 times per climb, in 100% of
seeds. Six weeks ago that number was 1.92% and the mechanic was decorative.

**The engineering is unusually disciplined for a game this size.** One
integrator, so the aim line is exact by construction rather than by tuning. One
source per derived value. Fixed timestep. No allocation in the loop. A
simulation with no DOM, which is why 30,000-climb balance sweeps take two and a
half minutes instead of needing a farm.

**The honesty of the existing documentation is an asset.** `cairn/BALANCE.md`
records a failing target as failing. `cairn/AUDIT.md` lists six tests that
passed while blind. That is rarer than good code and it is why this audit could
be written in a day.

**24 KB.** The whole game. It will install and open on anything.

### Mediocre or absent

**The interface is a prototype.** One number in a corner, three unstyled
buttons, a `<pre>` debug pane. There is no pause screen, no settings, no
statistics, no achievements — the brief's Phase 2 and Phase 3 are not "polish",
they are missing product.

**There is no reason to open it tomorrow.** Daily Climb exists and is well
built. Streak, progression, achievements, unlockables: none of them exist. A
single endless mode with a local high score is a 2011 game.

**It is not localised at all.** Every string is a hardcoded English literal in
`main.js`. For a Hebrew-speaking developer shipping to an Israeli market first,
that is not a nice-to-have.

**The audio bed is good and the sound design is thin.** The synthesised drone
that re-tunes by altitude is genuinely nice. But there is no wind, the footfall
is the same sound at every height, and the death — the single most important
moment in the game — is one filtered sawtooth sweep.

**Monetisation, packaging and store presence are at zero.** No Capacitor
project, no icons as files, no privacy policy, no listing.

**And the thing no amount of measurement here can fix: no human has played the
retuned tower.** The hard-gap mechanic demands a 5.0%-of-full power window
against an average hand's 5.5% error. On paper that is exactly the right
calibration. On a thumb it is an open question, and it is the single highest-value
fifteen minutes available to this project.
