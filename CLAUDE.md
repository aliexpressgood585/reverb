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
  DECISIONS.md    18 judgement calls with reasoning. Read before re-litigating.
  PHASE3.md       ranked next work
```

**Renderer:** Canvas2D scene → one WebGL post pass. **Three.js was deleted** —
120 KB gzipped of 3D engine for a 2D art direction. Total payload **18.6 KB
gzipped** against a 400 KB budget.

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
node scripts/smoke.mjs         # REVERB: state machine + 5 levels
node scripts/nav-check.mjs     # REVERB: navigation, <1s, no GPU
```

CAIRN's 14: determinism · arc-matches-flight · no tunnelling · frame budget ·
altitudes distinguishable · no flat grey · death→playable <1.2 s · persistence ·
gesture lockdown · discoverable through real touch · **aim direction** ·
**difficulty doesn't collapse** · **erosion stages readable** · **nothing blocks
a climb**.

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
chunked streaming generation, the reachability solver, the four biome verbs
(crumbling holds / updrafts / drifting platforms / darkness), momentum, close
calls, the first-60-seconds choreography, Daily Climb, ghosts, Monument View,
milestones, the instrumentation dashboard, and the 10,000-climb balance pass.

**Known-honest problem:** the world is **too easy**. A fixed-skill bot reaches a
721 m median across sixty deaths. There is no `BALANCE.md` because there is no
honest data to put in one yet. Start there — see `cairn/PHASE3.md`.

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
