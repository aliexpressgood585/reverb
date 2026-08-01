# Session handoff — read this first

Two games live in this repository and ship from one deploy.

| | | |
|---|---|---|
| **CAIRN** | `cairn/` → `/cairn/` | a one-thumb 3D-feeling climber. **This is the active project.** |
| **REVERB** | `src/` → `/` | a finished first-person stealth game. Don't break it. Rarely touched. |

Live: <https://reverb-wheat.vercel.app/cairn/> and <https://reverb-wheat.vercel.app>

---

## Standing rules — do not break these

1. **Branches.** `main` and `claude/reverb-indie-game-e26pck` must stay
   **identical**. Work on `main`, then force-push it to the other:
   `git push -u origin main && git push -f origin main:claude/reverb-indie-game-e26pck`
2. **A push is not a deploy. Verify every single time.** See "Deploying" below.
   This has bitten twice and cost a full session both times.
3. **Zero external assets, ever.** No models, images, audio files, web fonts or
   CDN scripts. Everything is generated in code. It is what keeps the game 19 KB
   and what gives it a coherent look.
4. **No service worker.** One was shipped and it stranded a real device on a
   build where the game could not be started. `public/cairn/sw.js` is a
   tombstone that unregisters its predecessor. Do not resurrect it without a
   pipeline that can *prove* it cannot strand anyone.
5. **`cairn/src/feel.js` is the only file allowed a magic number.** If a value
   changes how the game feels in the hand, it lives there.
6. **Answer the user in Hebrew. Code and comments in English.**
7. **Work autonomously.** Build → verify → deploy → verify again → report once.
   Don't ask permission mid-flow. Do report failures with numbers.

---

## The expensive lessons

Every one of these was paid for. A fresh session will repeat them without
warning, because each one looks correct right up until it is measured.

### A green test suite is not a working game

CAIRN once shipped with **ten passing acceptance tests and a game that could not
be started at all.** The title card is a full-screen scrim and it had no
`pointer-events: none`, so it ate every touch. The test dispatched a
`PointerEvent` directly at the canvas — and dispatching an event *at* an element
**bypasses hit-testing entirely**, so the overlay was never consulted. The test
proved the handler worked while the input could not physically reach it.

> **Anything on the input path must be tested through `page.touchscreen`,
> which hit-tests like a thumb. Synthetic dispatch is banned from those tests.**

### A test can pass without touching what it claims to check

The difficulty-collapse test capped each attempt by jump count. The bot was good
enough that attempts ended on the cap rather than on the ground, so no corpse
ever aged and the test measured **nothing** while printing a confident number.
Ask of every test: *if the thing I am checking were completely broken, would
this fail?*

### Every derived quantity has exactly one source

The aim arc lied **twice, by two different routes**:

1. The game ran swept Euler and the preview ran a closed-form parabola — 22 u of
   divergence. Fixed by making `Sim._flight()` the only integrator, which both
   the game and `predict()` call.
2. Four commits later, erosion made landing use the *eroded* half-width while
   `predict` still clamped with the *raw* one — 1.43 u, a brand-new lie through
   a brand-new hole.

The rule is not "write one integrator". It is **one source per derived value**.

And a third time, when BLOOM's drifting ledges arrived: `predict` runs the
integrator many times inside one aiming frame, `_stepVerbs` moves the tower once
per **tick** — so the preview froze the world while the real flight moved the
ledge under it for a second and a half. **The arc lied on 71.8% of drifting
ledges.** Test 2 reported 0.000 cm the whole time, because all 94 of its
launches land on ledges that do not move.

> **One source is not enough when the source is time-varying and only one caller
> knows what time it is.** `Sim.driftXAt(s, t)` answers *where is this ledge*,
> and every body carries a clock (`Body.t`) so every query about it is a query
> about a time.

### Physics must never run on the display's clock

Fixed 120 Hz step with an accumulator and render interpolation. Real time enters
the game in exactly one place. Before that, the jump you got depended on the
device you were holding.

### Aiming is DIRECT, never a slingshot

Drag up → go up. It shipped as a slingshot once and read as the controls
fighting the player. **Test 11 pins this**, because every other test passes
identically under either mapping and a silent flip back would be invisible.

### Nothing may interrupt a climb

The personal-best card used to fire mid-climb on every landing above the old
record — i.e. constantly, exactly when the player was doing well. **Test 14
pins it** by asking the right question: not "was a card shown" but
*"was anything in the player's way"* (`elementFromPoint` at screen centre).

---

## Deploying — the part that goes wrong

Vercel builds from `main`. **`vercel.json` is schema-validated and an unknown
key fails the build silently** — git reports a clean push, the site keeps
serving the previous commit, and nothing tells you. That exact mistake (a
`"comment"` key inside a headers entry) cost a session.

Always verify by comparing the live bundle hash to the local build:

```bash
npm run build
L=$(grep -oE 'assets/cairn-[A-Za-z0-9_-]+\.js' dist/cairn/index.html | head -1)
for i in $(seq 1 25); do
  J=$(curl -sS "https://reverb-wheat.vercel.app/cairn/?v=$RANDOM$i" \
      | grep -oE 'assets/cairn-[A-Za-z0-9_-]+\.js' | head -1)
  [ "$J" = "$L" ] && { echo "verified: $J"; break; }
  sleep 20
done
```

The headless browser here **cannot reach the internet** (the agent proxy does
not cover Chromium). Verify the live site with `curl`; verify behaviour against
a local `vite preview` of the same build.

---

## CAIRN — what it is

**One rule:** miss a jump and you freeze at the highest point you reached, and
what is left behind is solid. A failed jump doesn't cost you the gap — it fills
it. Climb long enough and the shaft below you is a tower built out of every
version of yourself that didn't make it.

**The guarantee** (the loose version is false, a bot proved it): every death
leaves a platform *strictly above the ledge it launched from*. It does **not**
promise nobody can ever be stuck.

### Architecture

```
cairn/
  index.html      inline SW-recovery script runs before the bundle
  style.css       gesture lockdown + the entire interface
  main.js         the loop: accumulator, interpolation, events, PWA, debug
  src/
    feel.js       FEEL + BIOMES. The only file with magic numbers.
    sim.js        physics, world, corpses, erosion. No DOM — runs in Node.
    input.js      pointer + the aim model. Where precision is won or lost.
    render.js     Canvas2D scene + Camera. No allocation in the loop.
    post.js       one WebGL pass: bloom, CA, grain, vignette, barrel, grade
    audio.js      WebAudio, fully synthesised
    store.js      versioned persistence, share poster, procedural icon
  AUDIT.md        honest state, including what is NOT done
  BALANCE.md      the difficulty curves, measured over 30,000 headless climbs
  DECISIONS.md    18 judgement calls with reasoning. Read before re-litigating.
  PHASE3.md       ranked next work
```

**Renderer:** Canvas2D scene → one WebGL post pass. **Three.js was deleted** —
120 KB gzipped of 3D engine for a 2D art direction. Total payload **30.3 KB
gzipped** against a 2 MB store budget — 1.45%.

**The game ships in English.** `cairn/src/i18n.js` is the only place a string
lives; Hebrew is complete and is an explicit choice in Settings, never a
device-language default. See DECISIONS.md §22.

**It is packaged for Android.** `android/` is a Capacitor project with the
manifest, icons, splash, signing and R8 rules done. `RELEASE.md` is the build
and upload procedure, `BLOCKED.md` is what needs a human. **The AAB has never
been built here** — `dl.google.com` is blocked, which is where both the SDK and
the Android Gradle Plugin live.

**Units:** virtual, never pixels. Column is 100 u wide; camera shows
`FEEL.camera.viewH` of height. Pixels appear in exactly one place — `input.js`
converting a drag to a launch — normalised by screen height so a phone and a
tablet feel identical.

### Erosion — the system that keeps the game a game

Corpses used to be permanently solid, so thirty attempts in the lower tower was
a staircase and the difficulty curve **inverted**. Now solidity decays while
presence does not. A corpse ages in **deaths**, not seconds:

| age | stage | collision | look |
|---|---|---|---|
| 0-6 | FRESH | full width | accent colour, full glow |
| 7-14 | THIN | 45% | visibly cracked |
| 15-24 | TOP | 45%, top only, no wall cling | desaturated |
| 25+ | MEMORY | **none** | gold outline, permanent |

Plus **the shifting roof**: everything above the all-time best regenerates each
attempt from `worldSeed ^ (deaths * 0x9e3779b1)` — fresh per attempt, still
bit-identical across devices.

The bright bar on a corpse is drawn **exactly as wide as its collision**. The
shelf you see is the hitbox. That is how the rule is taught without text.

---

## Testing

```bash
node scripts/cairn-check.mjs   # CAIRN: 14 acceptance tests, ~4 min
node scripts/cairn-balance.mjs --all --seeds=200 --attempts=50
                               # CAIRN: 30,000 headless climbs, ~2.5 min, no browser
node scripts/cairn-precision.mjs
                               # CAIRN: arc fidelity + aim tolerance, ~2 s, no browser
node scripts/cairn-ghost-check.mjs
                               # CAIRN: the death preview is drawn, and at the apex
node scripts/cairn-monument-check.mjs
                               # CAIRN: monument view, framing, budget, poster
node scripts/cairn-reach-check.mjs --from=481
                               # CAIRN: is there a route up, with or without a body
node scripts/cairn-store-check.mjs
                               # CAIRN: migration, backup slot, poisoned rows
node scripts/cairn-device-check.mjs
                               # CAIRN: 4x CPU throttle + heap profile of the loop
node scripts/cairn-first-minute.mjs
                               # CAIRN: the on-ramp and the teaching beat
node scripts/cairn-daily-check.mjs
                               # CAIRN: daily seed, UTC rollover, slot isolation
node scripts/cairn-bodies-check.mjs
                               # CAIRN: does anyone stand on their own corpse, and
                               # is a hard gap ever a wall. ~60 s, no browser
node scripts/cairn-verbs-check.mjs
                               # CAIRN: the four biome verbs — do they happen, only
                               # where allowed, and is any of them a wall. ~30 s
node scripts/cairn-qa.mjs      # CAIRN: 1000 runs, dead ends, save corruption
node scripts/cairn-boundary-check.mjs
                               # CAIRN: sabotages the loop; does a crash say
                               # something readable and save the tower
node scripts/cairn-audio-check.mjs
                               # CAIRN: does the soundscape thin as you climb
node scripts/cairn-profile.mjs # CAIRN: bundle, load, frame cost, 10-min heap
node scripts/cairn-lighthouse.mjs
                               # CAIRN: performance 93, accessibility 86
node scripts/cairn-ui-shots.mjs
                               # CAIRN: every screen, 3 sizes, both directions
node scripts/cairn-assets.mjs  # CAIRN: launcher icons, splash, store graphics
node scripts/cairn-store-shots.mjs
                               # CAIRN: the 8 Play screenshots, from the real game
node scripts/smoke.mjs         # REVERB: state machine + 5 levels
node scripts/nav-check.mjs     # REVERB: navigation, <1s, no GPU
```

CAIRN's 14: determinism · arc-matches-flight · no tunnelling · frame budget ·
altitudes distinguishable · no flat grey · death→playable <1.2 s · persistence ·
gesture lockdown · discoverable through real touch · **aim direction** ·
**difficulty doesn't collapse** · **erosion stages readable** · **nothing blocks
a climb**.

**Two gates flip on container noise rather than on code, and both cost time to
attribute** (see `cairn/AUDIT.md`). `cairn-device-check.mjs`'s sub-linearity gate
divides two sub-millisecond numbers and prints anything from `-11x` to `+17x` on
identical code. `cairn-monument-check.mjs`'s "one tap returns" waits a fixed
1,400 ms for a camera ease that depends on frame rate — seen at 0.06 once against
a 0.05 gate, then 0.007-0.011 on three consecutive re-runs. Re-run before
believing either.

Numbers are reported, not asserted. Test 4 measures **CPU** cost only — this
container's software rasteriser is 20–40× slower than a phone GPU, so the GPU
side is a prediction. Real device numbers come from the debug overlay
(**triple-tap top-left**): fps, frame time, entity counts, physics sub-steps.

---

## State

**Done:** the feel rewrite, the art direction, erosion, the shifting roof,
direct aiming, non-blocking record, versioned persistence, share poster,
synthesised audio, haptics, 14 passing tests.

**Not done, and not claimed** — full list in `cairn/AUDIT.md`:
chunked streaming generation, the reachability solver, momentum, close calls,
ghosts, milestones and the instrumentation dashboard.

**The four biome verbs are done** (PHASE3 §7, DECISIONS §26), and they are the
answer to the one complaint a real player made after 11,045 m: *the design
between the stages repeats itself.* ASH's hold gives way under you, SIGNAL has
columns of rising air, BLOOM's ledges will not hold still, VOID takes away
everything your own light does not reach. CINDER and GLACIER carry none — two
plain biomes per 900 m lap are what the other four read against.

The updraft is the one to be careful with. `Sim._flight` lifts every body
**except `this._probe`**, so every route the generator promised was proved
without help and a column can only ever widen a gap that was already crossable.
`predict` flies `_ghost`, which *does* feel it, because the drawn arc has to
match the flight. `cairn-verbs-check.mjs` asserts both halves — either one alone
passes on dead code.

**Balance is done and written down.** `cairn/BALANCE.md` has the curves from
30,000 headless climbs. The short version: the world did not have an easy
difficulty curve, it had **no ceiling** — `clamp(h / 900, 0, 1)` flattened
difficulty above 900 m and 40 of 40 expert runs climbed 84 km without dying
once. The generator now escalates without saturating, and past a certain height
a share of gaps are placed **beyond the physical reach envelope on purpose**:
you cannot cross them, you die at the apex, and your corpse is the step. A third
of an expert bot's deaths are now deliberate throws into a gap it knew it could
not make, against 1.8% of a novice's.

**Daily Climb is a separate tower with a separate save slot.** The seed is
derived from the UTC date (`Store.dailySeed`), never stored, so it is identical
everywhere on earth and a share card carrying the date is enough to hand someone
the same climb. `Store.setSlot()` keys storage; endless keeps the original key
names exactly, so saves already on phones still load. Never let the two share a
slot — a daily seed is discarded tomorrow, an endless tower is a whole history.

**The first time a player stands on their own corpse, the camera pulls back.**
`FEEL.monument.teachPull` for `teachMs`, once per player ever, persisted. It is
the only moment the game explains itself and it does it without text or taking
control. Before it, a player could do the thing the whole game is about and not
notice. The first 60 m is also an explicit on-ramp (`tower.opening*`) with no
uncrossable gaps by construction.

**The save file is schema 2 and has a backup slot.** Schema 1 did not store
`bornDeath`, so a reload brought every corpse back at age = `deaths` — already
MEMORY, drawn and not solid. The tower a player built out of themselves became
scenery on restart, and test 8 passed the whole time because it checks corpses
exist, not that they hold weight. `cairn.v1` is the key name and must never
change; the schema number lives inside the payload. Rows are validated
individually — a body at x=1e9 does not merely look wrong, it poisons the height
buckets every collision query walks.

**There are no unleavable ledges. `FEEL.tower.overreachRate` is 0** and audited
at 4,506 gaps from 0-3000 m, 100% directly crossable. A player hit three walls at
391, 481 and 567 m; every wall this game ever produced came from that mechanic.
`Sim.routeExists` stays as a permanent guard — the generator flies a probe body
through the real physics and demotes any ledge it cannot prove a route to. Turn
the rate up and it will catch you; do not turn it up without re-running
`cairn-reach-check.mjs`.

**A HARD GAP IS CUT OUT OF A FLIGHT, NOT PLACED AND THEN CHECKED.** That is what
gave the corpse its job back after `overreachRate` went to zero and took it away.
Measured: with every gap crossable in one jump, the average model stood on one of
its own bodies on **1.92%** of landings and the expert on **0.02%** — the title
card promises EVERY DEATH LEAVES A STONE and the stone was scenery. Now 6.53% and
2.73%, and **the expert is killable again** (60 of 60 seeds hit the launch cap
before, 0 now).

`Sim.hardStep` flies the probe off the **worst footing** on the ledge below — the
far end of the perch — and puts the new landing surface at the far end of the arc
it flew, minus `hardSlack`. So the direct route is true by construction and a wall
cannot arise, which is exactly what overreach could not promise. Two things about
it are counter-intuitive and both are measured, in BALANCE.md:

- **It demands POWER, not aim.** A hard gap forgives 23.0° against an ordinary
  gap's 21.5° — *more*, because it sits near the angle of maximum range where
  range is stationary in angle. The window is 5.0% of full power against 13.5%,
  and the average model's hand is off by 5.5%.
- **Making the generator prove the body route as well destroys the mechanic.** It
  selects for the short gaps a single apex body can bridge: span 42.4 u → 25.7 u
  and body landings 6.53% → 3.45%. Do not re-add it. The no-wall promise never
  depended on it.

`cairn-bodies-check.mjs` is the gate, and it is falsifiable —
`--tune='{"hardRate":0}'` and `--tune='{"hardSlack":-14}'` both turn it red.

**Historical, and why the knob exists: uncrossable gaps were TOO HIGH, not too far.** The first version pushed them
sideways and the 100 u column clamped them back into ordinary gaps — the
mechanic fired on 2.2% of gaps against a knob set for 27%. Height has no wall,
and it is bridgeable by design: throw under full power so the apex is low enough
that the corpse can be landed on. Audited from 481 m: 78.9% direct, 10.7%
bridged, **10.4% with no route at all**, which is the honest cost and is
recorded in BALANCE.md rather than smoothed over.

**Monument View** (PHASE3 §6, done): two fingers pull all the way back to the
whole lifetime tower, one touch returns. Two fingers because it is the only
gesture that cannot collide with aiming — a swipe down IS a launch downward
here. The atmosphere layers (bands, shafts, dust, big number) fade out with the
pull-back; they are sized against the view span and become clutter at full zoom.
The share poster encodes **WebP with a PNG fallback** — encoding was the entire
2 s wait, and WebP halves it at a third of the bytes without banding the
gradients. `FEEL.monument` holds the framing, and it is derived from
`camera.playerOffsetY` rather than eyeballed.

**When a launch cannot land, the game draws the body you would leave** at the
apex, exact to 0.000 u against the corpse `_die` will create. Some gaps in this
tower cannot be crossed on purpose; without that preview they are
indistinguishable from a badly aimed jump, and the mechanic the design rests on
reads as unfairness. `FEEL.aim.ghostAlpha` is the only knob.

**Jump accuracy is measured, not assumed** (`cairn/BALANCE.md`). The drawn arc
matches the flight exactly — including off a wall cling, which it did **not**
until `Sim.launchVelocity()` gave the wall kick one source; `_fire` applied it
and `predict` did not, so the arc was 16 u/s wrong on every cling launch.
Acceptance test 2 asserts that property and passed throughout, because all 97 of
its launches leave from the ground. Aim resolution is nowhere near the limiting
factor: a jump forgives ~20° and one pixel of thumb is 0.31°.

**Known-honest problem:** erosion does not fully hold. For an expert, a
mid-tower band is 2-3x safer at the end of a session than at the start
(`BALANCE.md`, band hazard). Acceptance test 12 reports 1.00 and passes, because
it measures height reached and cannot distinguish "getting further" from "the
band got easier". `FEEL.erosion.deepSpan/deepScale` exist to trade this
deliberately and **ship as a no-op** — lowering `deepScale` buys ceiling and
doubles the softening.

**Known-honest problem:** every generation number now lives in
`cairn/src/feel.js` under `tower`, and several of them (`diffScale`,
`overreachRate`, `hardRate`, `hardSlack`) move the whole curve. Re-run the balance
harness AND `cairn-bodies-check.mjs` after touching any of them —
`cairn-check.mjs` will not catch a difficulty regression, because test 12 checks
that difficulty does not *collapse*, not that it exists.

**Known-honest problem: PHASE3 §1 target 3 does not hold.** An expert passes 600 m
on **83%** of first attempts against "but not on a first attempt". It failed at
`c1bf734` too, at 95%. Closing it needs gaps that cannot be crossed at all, which
is the mechanic that stopped a real player three times. Recorded as failing rather
than reported as improved.

---

## Talking to the user

Hebrew, warm, direct, bottom line first. He is not a programmer — explain in
plain terms with concrete numbers, no jargon walls.

**Radical honesty about results.** Report failures plainly with the numbers. If
a claim can't be measured from here, say so instead of implying it. He has been
burned twice by "it's deployed" when it wasn't, and he will trust measured
statements far more than confident ones.

He plays on a real iPhone and reports feel. **Believe the report over the
metrics** — "it jumps on every step" and "the metres stop me" were both correct
and both invisible to a green test suite.
