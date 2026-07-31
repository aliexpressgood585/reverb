# CAIRN — decisions

Everything below is a choice that was ambiguous in the brief. Where a call could
go either way, it went to the option that produces the more premium result, and
the reasoning is here rather than in my head.

---

## 1. Three.js was deleted. Canvas2D for the scene, one WebGL pass for the grade

The previous build of CAIRN used Three.js: **120 KB gzipped of engine** to draw
boxes on a flat plane. The whole art direction — vertical gradients, silhouetted
parallax, soft radial light, thin glowing strokes, a huge translucent numeral —
is two-dimensional, and Canvas2D expresses each of those in one line where a
shader needs forty.

What Canvas2D *cannot* do cheaply is bloom, chromatic aberration, grain and
grading, which are four texture reads in a fragment shader. So the split is:
**scene in 2D, grade in GL**, four draw calls total.

| | gzipped |
|---|---|
| before (Three.js + game) | ~124 KB |
| after (game, no engine) | **18.4 KB** |

Budget was 400 KB. We use 4.6% of it. PixiJS was considered and rejected for the
same reason as Three: it is a renderer for a problem this game does not have.

**The cost, stated honestly:** the scene canvas is uploaded to a texture once
per frame (`texImage2D` from a canvas). On mobile this is usually a GPU-side
copy, but it is the one thing in the frame that could bite on a weak device.
Mitigation is in place — `Post.bloomOn` can be flipped off to drop from four
draws to one, and `Post.create` returns `null` on any WebGL failure, in which
case the 2D canvas is promoted into the page and the game is merely less pretty,
never broken.

---

## 2. `FEEL` is the only file with magic numbers in it

Every value that changes how the game feels in the hand is in `src/feel.js`. No
other file is allowed one. This is not tidiness — it is the difference between
tuning a game and hunting through a renderer for the number that made the jump
feel wrong.

**Units are virtual, never pixels.** The column is 100u wide, the camera shows
`camera.viewH` units of height, and pixels appear in exactly one place: the
input module converting a thumb drag into a launch. That conversion is
normalised by *screen height*, so a small phone and a tablet feel identical
rather than the tablet feeling twice as powerful.

---

## 3. Precision: three mechanics, one of which does the real work

The brief asked for precision and named the mechanism, and it was right, so it
is worth saying why it works:

**Power saturates; angle does not.** Past 22% of screen height the drag stops
adding power and refines the *angle only*. Park your thumb in the far corner and
one degree costs fifty pixels of travel instead of three. It needs no
explanation because it is already what a hand does when it wants more power and
finds it has all of it. This is the single largest precision win available on a
touchscreen.

**Power is eased, not linear** (`powerEase: 2.2`), so the top of the range is
fine-grained instead of a cliff.

**The angular assist is a nudge, not a magnet.** It samples a 1.5° fan, and only
when *your* aim lands on nothing and a neighbour's lands on something. It can
move you at most 1.1°, and it is rate-limited to every third frame because a
full physics prediction is not free. It can rescue a jump you had right; it
cannot aim for you.

---

## 4. There is exactly one integrator, and both the jump and the arc call it

`Sim._flight()` advances a body one tick. The game calls it with the player;
`predict()` calls it with a scratch body. Nothing else integrates flight.

This is not an aesthetic preference. An earlier build had two — the game ran
semi-implicit Euler with swept sub-steps, and the preview ran a closed-form
parabola — and they diverged by **22 units**, with 12 outright disagreements
about whether a jump would land at all. On a phone that does not read as "the
preview is subtly wrong". It reads as *"the jumps are not accurate"*, which is
exactly the words it came back as in testing.

With one integrator the measured worst-case error over 101 launches at every
power level is **0.000 cm**, and it is not "very small" — it is the same
arithmetic, so it is zero by construction. Acceptance test 2 asserts it.

---

## 5. The predicted arc stays, and fades

An earlier iteration removed the arc entirely on the grounds that it solves the
jump for you, and replaced it with the ghost of your previous attempt. The brief
asks for the arc back, with a specific and better answer to the same worry:
**crisp for the first 60% of flight, dissolving after.** You see the takeoff
exactly and the landing approximately, which keeps the tension without ever
making the controls feel like a guess. The landing reticle takes the accent
colour on a safe surface and dims to grey on nothing.

---

## 6. Death freezes you at the APEX, not where you fell

The core concept says the body freezes in place. *Which* place is the entire
design.

The first implementation froze the body where it fell back past the take-off
height — which puts it at your feet, where it is worth nothing. A bot that
undershot every jump climbed 5 m in 140 deaths and stalled forever.

Freezing at the **apex of the arc** puts the body out in the middle of the gap
and above the ledge you left, which is exactly the stepping stone the jump
needed. Same rule in spirit; completely different game.

The precise guarantee, because the loose one is false: **every death leaves a
platform strictly above the ledge it launched from.** It does *not* promise that
nobody can ever be stuck — a player who under-pulls every single jump converges
on a pile and stays there. The arc is what stops that being a real failure mode.

---

## 7. Each biome owns its background, and that is not cosmetic

The brief specifies a base gradient of `#04060B → #0A0E16`. That is now VOID's
base, not everyone's.

ASH has warm bone geometry. Composited at low alpha over a *cold* blue-black
background, warm bone averages to neutral, and **33.9% of the frame at 50 m
measured as flat undifferentiated grey** — the exact failure the art pass exists
to remove, hiding inside a palette that looked correct written down. A biome's
background has to agree with its geometry or the two cancel into mud.

ASH's base is now warm near-black (`#0B0604 → #1A0E08`). Additionally, every
piece of rock is tinted 30% toward the accent by how lit it is, so geometry in
this game is never its own colour in isolation — it is always somewhere between
the rock hue and the light falling on it. After both changes: **0.0% flat grey
at every altitude tested**, minimum mean chroma 33.8.

---

## 8. Parallax bands are point arrays redrawn per frame, not cached bitmaps

The obvious optimisation is to bake each band to an offscreen canvas once. It
was rejected: the bands must cross-fade colour continuously through a biome
transition, and tinting a cached bitmap per frame costs more than redrawing
~90 `lineTo` calls.

Two bugs came out of this and both are worth recording, because both were
invisible in code review and obvious in a screenshot:

- Closing each band polygon 30 px below its crest drew a **hard horizontal seam
  at every tile repeat**. Closing far below fixed the seam and created a worse
  problem: three layers × several repeats of a large filled polygon stacked into
  a **milky haze over the lower half of the frame**.
- The fix is that the shape still closes far below, but the *fill* is a gradient
  that dies just under the crest. Opacity lives in the jagged tips, where the
  silhouette is; the body of the band is nearly empty.

---

## 9. Ledges are a crest and a skirt, not a slab

First pass drew each ledge as its body plus 2.4× its height of near-opaque
gradient. On an 844 px screen that is a 65 px block, seven of them visible, and
the frame reads as a stack of buildings rather than a climb.

A ledge is now: a bright 1.5 px crest (the only thing you actually aim at), a
short additive bloom bar just above it so the landing line reads even when your
light is nowhere near it, and a 1.35× skirt that dissolves to nothing.

---

## 10. Physics runs at a fixed 120 Hz, decoupled from the display

`FEEL.sim.dt` is `1/120` and never varies. Real time enters the game in exactly
one place — the accumulator in `main.js` — and is spent in whole steps.

This is what makes "two identical drags produce identical landings" true rather
than nearly true, and it is what makes the game play the same on a 60 Hz phone,
a 120 Hz phone, and a stuttering browser tab. Slow motion while aiming feeds the
accumulator *scaled seconds*; the step itself never changes, so aiming in slow
motion costs precision nothing.

Rendering interpolates between the last two ticks (`body.rx/ry`), so a 60 Hz
display shows smooth motion off a 120 Hz simulation rather than every other
frame.

---

## 11. Death → next attempt is 900 ms, and it is not a menu

Budget was 1.2 s. It is 900 ms, spent on the camera falling back to the base
while the body crystallises. There is no modal, no button, and nothing to
dismiss. Friction here is what kills a retry loop, and a retry loop is the whole
game.

The run summary appears **only on a personal best**, because that is the only
moment a player wants to stop.

---

## 12. Corpses are pooled, bucketed, and capped at 600 in storage

Solids are bucketed by height (32u buckets) so a collision query touches a
handful of candidates rather than every corpse in the tower. Without it, the
predicted arc — which runs the real physics for up to 2.6 s, several times per
aiming frame — is O(ticks × corpses), and falls off 60 fps somewhere around the
fortieth death. Which is precisely when the game gets good.

Storage keeps the most recent 600. Past that the tower is scenery, not
gameplay, and `localStorage` has a quota.

---

## 13. The app icon is drawn at boot, not shipped

Zero external art assets is a hard rule, and a PWA needs an icon. So the icon —
three stacked stones, with a separate maskable variant that respects the safe
zone — is drawn to a canvas at startup and injected as a data URL, along with a
manifest built the same way. The repository contains no binary art.

---

## 14. What is measured, and what is honestly not

`node scripts/cairn-check.mjs` runs all ten acceptance tests against the shipped
build in a real browser at a 390×844 viewport. Nothing in it reimplements the
physics or the renderer; where a test needs to know what the game did, it asks
the game.

**Not measured, and I will not claim it:** real frame rate on real hardware.
This container has a software rasteriser roughly 20–40× slower than a phone GPU,
so test 4 measures the *CPU* cost of the scene pass — the part that actually
scales with corpse count — at **1.4 ms/frame with 130 corpses**, and reports it
rather than pretending to have measured a phone. The GPU side is four fullscreen
draws at ≤ DPR 2, which is a well-understood cost, but it is a prediction and
not a measurement. Everything needed to check it on a device is in the debug
overlay: triple-tap the top-left corner for fps, frame time, entity counts and
physics sub-steps.

Also not measured: whether it is fun. That one needs a person.

---

## 15. The bug the tests could not see, and what changed because of it

The first deploy of this build **could not be started at all.** Tapping did
nothing, on any device.

`#card` is a full-screen scrim — deliberately, so the title sits over the live
scene rather than a flat picture. It had no `pointer-events: none`, so it
swallowed every touch before the canvas ever saw one.

Ten acceptance tests passed on it. Test 10 dispatched a `PointerEvent` straight
at `#view`, and dispatching an event at an element **bypasses hit-testing
entirely** — the overlay was never consulted. The test was asserting that the
input handler worked, which it did, while the input could not physically reach
it.

Two things changed:

- The scrim passes touches through; only its buttons take input. There is also
  a document-level fallback starter, because a touch anywhere must never be
  able to do nothing at all.
- **Test 10 now drives `page.touchscreen`, which hit-tests like a thumb**, and
  additionally asserts that nothing over the canvas at five sample points eats a
  touch, that one real tap starts the game, and that a real drag produces an aim
  and then actually moves the body. Synthetic dispatch is banned from that test.

The general lesson, and it is not a small one: **a test that reaches past the
browser's own machinery is testing your code, not your game.** Anything on the
input path has to go through the real pipeline or it is not being tested.

Fixed in the same pass: the service worker served navigations cache-first, which
is the standard way to strand users on a dead deploy — a stale `index.html`
points at content-hashed assets that no longer exist and the app never boots.
Navigations are network-first now; hashed assets stay cache-first, where that
strategy is actually safe.

---

## 16. Erosion and the shifting roof — solidity decays, presence does not

The Phase 2 brief names the flaw exactly right: corpses were permanently solid,
so thirty attempts in the lower tower is a staircase and sixty in the band where
you keep dying is trivial. **The difficulty curve inverts.** The game gets easier
precisely where it should get harder, and the loop dies inside one session.

Two systems, both required, neither sufficient alone.

**Erosion.** A corpse is measured in how many deaths have happened since it
fell, not in seconds — so it decays at the rate the player is actually playing:

| age | stage | collision | look |
|---|---|---|---|
| 0-6 | FRESH | full width | accent colour, full glow, bright shelf |
| 7-14 | THIN | 45% width | visibly cracked, dimmer |
| 15-24 | TOP | 45%, landable from above only — no wall cling | desaturated, thin rim |
| 25+ | MEMORY | **none** | gold outline, no fill, permanent |

The visible tower still holds every self you have ever left. The *playable*
tower is only the recent ones. The screenshot promise survives intact and the
challenge comes back.

The read had to work without text, so form and colour say different things.
**Colour** says how long ago this was you — accent when fresh, cooling toward
gold. **Form** says whether it will still hold you: the bright bar on top of
each corpse is drawn exactly as wide as the collision actually is, so a
half-width shelf is not a stylistic choice, it is the hitbox. Test 13 confirms
all four stages separate in a single still (closest neighbouring pair differs by
31.7 on a combined luminance/coverage metric).

**The shifting roof.** Everything above the all-time best is discarded and
regenerated at the start of every attempt, so no corpse can ever carry you into
new territory — but the seed is `worldSeed ^ (deaths × 0x9e3779b1)`, which keeps
determinism exact. The same tower played the same way is still bit-identical on
any device; it is fresh per *attempt*, not per *run*. The record line is drawn
as a soft horizon rather than a tick, because it is now a frontier.

**A regression this caused, worth recording:** erosion made `_surfaceUnder`
depend on the eroded half-width, but `predict` still clamped the landing point
with the raw one. The arc started lying again — by 1.43 u — through a completely
new route, four commits after the single-integrator rule was introduced to
prevent exactly that. Test 2 caught it in the same run that introduced it. The
rule is not "write one integrator" but "every derived quantity has one source",
and width is a derived quantity.

---

## 17. Direct aiming. The slingshot lost to one sentence of playtest

"Pressing downward makes it jump, I want dragging upward to jump."

A slingshot is legible when you aim an object *away from yourself* at a target
on screen. Here you ARE the object and the camera is locked to you, so inverting
the one thing the player does to themselves reads as the controls fighting them.
It also explains the other half of the same report — "it jumps on every step" —
because a gesture you have to invert in your head gets made twice.

The drag vector is now the launch vector, which additionally makes the aim ray
honest: it starts at the body and points exactly where the body is about to go,
so the drag, the line and the flight are one straight thing.

Dead zone went 8 px → 14 px in the same pass. A resting thumb drifts, and at
8 px every micro-movement fired a launch.

Test 11 pins the direction, because every other test in the suite passes
identically under either mapping — a silent flip back would be invisible.

---

## 18. The record is a feeling, not a menu

"I don't want the metres to stop me every moment."

The personal-best card was raised the instant the player landed above their
previous best — which, on any run that is beating the record, is **every single
landing**. The game interrupted the climb with a two-button modal, repeatedly,
at precisely the moment the player was doing well. The one state a game must
never break into is a run that is going better than usual.

Three changes:

- **The record updates silently.** Crossing it gives a bloom pulse, a rising
  tone and a tap on the wrist, once per run. Nothing to dismiss.
- **The summary moved to after the death transition**, so control is already
  back before it appears.
- **It is a strip, not a card.** `pointer-events: none` on everything except the
  SHARE chip, and it fades on its own in 4.2 s. It reports; it does not ask.

The brief asks for both "run summary on a new personal best" and "death → next
attempt with no menu, no modal, no button". Those pull against each other, and
the resolution is that the summary is allowed to exist but is never allowed to
be in the way. Ignoring it costs the player nothing.

Test 14 pins it: forty record-beating landings must produce zero blocking
overlays and zero cards. It checks `elementFromPoint` at the centre of the
screen on every landing, because that is the question — not "was a card shown"
but "was anything in the player's way".

---

## 19. A hard gap is CUT OUT OF A FLIGHT, never placed and then checked

Closing every dead end (§ BALANCE.md, `overreachRate: 0`) was right and it cost
the premise. Measured: the average model landed on one of its own bodies on
**1.92%** of landings and the expert on **0.02%**. If every gap is crossable in
one jump, nobody ever needs to stand on themselves, and the title card's EVERY
DEATH LEAVES A STONE stops being true of the game.

The two mechanics look symmetrical and are not:

| | overreach | hard gap |
|---|---|---|
| how the ledge is positioned | pushed past the reach envelope | placed **on a trajectory the physics flew** |
| direct route | none, by design | proven, from the **worst footing** |
| what happens when nothing bridges it | **a wall** | cannot arise |
| what it demands | that you die | that you pull hard and exactly |

`Sim.hardStep` flies the probe off the far end of the perch — the side away from
where the ledge is going — over a fan of legal launches, and puts the landing
surface where the arc that ended up furthest away was, minus `hardSlack`. The
launch that makes the jump is then not a hope, it is the flight the ledge was cut
from. **A physics-verified positive cannot be false**, which is the same argument
`routeExists` is built on, applied at the point where it is cheap.

Three things about this were wrong on the first pass and all three were caught by
measuring rather than reading:

**It is a demand for power, not aim.** A hard gap forgives 23.0° of angular error
against an ordinary gap's 21.5° — *more* — because it sits near the angle of
maximum range, where range is stationary in angle. The window is in the pull:
**5.0% of full power against 13.5%**, and the average model's hand is off by 5.5%.
That is why it is fair: the arc is drawn from the same integrator in time slowed
to 15%, and power saturation means one pixel at 90% power is 0.05% of full.

**Requiring the body route as well destroys the mechanic.** "One hard jump or two
easy ones" is the design sentence, so proving the second route at generation time
looked obviously correct. The gaps a single apex body can bridge are the *short*
ones, so the filter kept those: median span fell 42.4 u → 25.7 u, the surviving
gaps forgave more error than ordinary ones, and body landings fell 6.53% → 3.45%.
The requirement selected against what it was meant to guarantee. The body is
measured, not decreed — and the no-wall promise never depended on it.

**The roll is drawn unconditionally.** `&&` short-circuits, so folding it into the
condition would make the number of random draws depend on `overreachRate` and on
height — still deterministic, but a tower that silently changes the next time
somebody touches an unrelated knob.

`scripts/cairn-bodies-check.mjs` is the permanent gate, and it is built to be
falsifiable: `--tune='{"hardSlack":-14}'` and `--tune='{"hardRate":0}'` both turn
it red. Its third test is the control — with every corpse forced non-solid the
same count must read exactly 0.00% — because five tests in this repository have
passed while blind to the state they claimed to cover.

---

## 19. Physics stays at 120 Hz, not the 60 Hz the release brief asks for

The brief specifies a fixed 60 Hz simulation decoupled from render. The
decoupling was already there; the rate is 120 and stays 120.

Halving it doubles the distance a body travels between collision checks, which
is exactly the budget `FEEL.body.sweepFraction` exists to protect — acceptance
test 3 fires 140 max-power launches through a six-deep corpse wall and measures
the longest sub-step at 1.34 u against a 2.10 u limit. That margin is not large
enough to give away for nothing.

And it *is* nothing: a tick costs **0.0003 ms** at 400 bodies, unmeasurable
against a 16.67 ms frame. Two ticks per 60 Hz frame is 0.0006 ms.

The real cost of changing it would be the documentation: every number in
`BALANCE.md` — 30,000 climbs, four difficulty targets, the aim-tolerance survey,
the hard-gap power window — was produced at `dt = 1/120`. Re-deriving all of it
to satisfy a number in a brief is the wrong trade.

## 20. Strict type checking, on the JavaScript, through JSDoc

The brief asks for TypeScript strict mode. What shipped is `tsconfig.json` with
`checkJs` and every strict flag on, and JSDoc types throughout — **zero errors
across all 4,300 lines that reach a player's phone**, enforced in
`npm run typecheck` and in the pre-commit hook.

Not a `.ts` conversion, and the reasoning is the same one behind §19. The
physics in this repository is pinned by fourteen browser acceptance tests, 30,000
headless climbs, a route audit over 4,506 gaps and a precision survey over 4,186
jumps. A wholesale rewrite of every line of it buys inference-only generics and
risks all of that. `checkJs` finds the same errors in the same places without
touching a single expression.

It also keeps something this project has spent real effort on: Vite ships
`cairn/src/*.js` as written. There is no transpile step between the file and the
phone, which is a large part of why the bundle is 21 KB gzipped.

What it caught is in `AUDIT.md` and is not theoretical — a latent null crash in
the audio graph on backgrounding, an uninitialised render transform, dead code in
the player draw, and a self-assignment pretending to be logic.

The harness in `scripts/` is deliberately excluded. It is 4,700 lines of
measurement bots whose correctness is established by the numbers they print;
typing them accounts for 629 of the 1,387 errors a repo-wide pass reports and
buys nothing that a wrong number would not already show.

## 21. Offline comes from Capacitor, not from a service worker

The brief asks for full offline support via a service worker. **This project does
not get a service worker**, and the reason is in `cairn/AUDIT.md`: one was
shipped, it served navigations cache-first, and it pinned a real device to the
exact build where the game could not be started. The device could then neither
play nor update, because Chrome will not re-fetch a worker script until its
registration is a day old. `public/cairn/sw.js` is a tombstone that unregisters
its predecessor and `index.html` carries a recovery script that runs before the
bundle.

The Android build does not need one. Capacitor bundles the whole `dist/` into the
APK and serves it from the local filesystem, so the packaged game is offline by
construction — with no cache to go stale and no way to strand anyone on a dead
build. Airplane mode works because there is nothing to fetch.

The web build at `/cairn/` therefore stays online-only. That is a real difference
between the two and it is the correct one: the web build is where a bad cache
would be unrecoverable, and the store build is where offline actually matters.

---

## 22. English is the game. Hebrew is a setting.

CAIRN shipped with device-language auto-detection: a phone set to Hebrew got a
Hebrew game. That is now gone, deliberately rather than reordered.

**English is the default on every device, regardless of system language.** The
wordmark, the tagline, the store listing, the share card and the marks are all
English, and a player who installs from an English listing should get the thing
the listing showed them. A game that silently becomes a translation of itself
because of a region setting is a game that does not know what it is.

Hebrew stays — complete, tested, and reachable in Settings in two taps. It costs
1.3 KB, it is the developer's own language, and removing working translated
strings to enforce a default would be destroying something for no gain. What it
no longer does is take the product over uninvited.

`initLang` also does not WRITE the default. A default persisted to storage is
indistinguishable from a decision the next time it is read, and the player would
then be locked to English by an act they never performed. Only an explicit choice
in Settings is written down.


---

## 23. Each biome has a silhouette, not just a hue

A player at **11,045 m** sent a screenshot and said the design between the stages
was boring and repeated itself. He was right, and the cause was structural rather
than a matter of taste.

The parallax bands were three jagged polygons generated once from a fixed seed
and tiled vertically forever. The only thing altitude changed was colour. The
biome cycle is six biomes of 150 m, so **at 11 km he had seen the same three
shapes in the same six colours twelve times**. Hue is not variety.

Each biome now has its own geometry:

| biome | silhouette |
|---|---|
| ASH | spires — the original jagged noise, kept because the art was tuned against it |
| SIGNAL | blocks — stepped plateaus with vertical walls. Architecture, not rock. |
| BLOOM | domes — overlapping rounded humps, no sharp corners |
| VOID | needles — mostly empty with rare thin spikes. The emptiest biome looks empty. |
| CINDER | shards — asymmetric sawtooth, slow rise then a vertical drop |
| GLACIER | facets — long straight runs meeting at points. Crystal, not noise. |

Every kind returns **the same point count** for a given layer, so a biome
crossfade interpolates the silhouettes exactly as it interpolates the colours.
Shapes are still generated once; the per-frame work is a lerp into a preallocated
array, so the draw loop still allocates nothing.

And the cycle itself is broken: the SCALE of the geometry drifts with altitude on
two sine frequencies that do not divide into each other, so the combination of
colour, shape and scale has no short period. `scripts/cairn-variety-check.mjs`
gates it by sampling the *same phase of the cycle one lap apart* — 200 m against
1,100 m, 2,000 m and 2,900 m were pixel-identical before and now differ by 1.6.

**Acceptance test 5 could not have caught this.** It compares 50 m, 200 m and
400 m — three points inside the *first* lap, where the colours genuinely differ.
Repetition is a property of the second lap and nothing ever looked at the second
lap.

## 24. Test 13 was measuring the one thing that carries no information

Chasing the above turned up a worse problem underneath it. Acceptance test 13
asks whether the four erosion stages are distinguishable, and it was passing on
a margin of **4.2 against a threshold of 3** — which is not a pass, it is a coin
landing on its edge. Two things were wrong with it:

**Its fixture made the colour axis fight the stage axis.** The renderer cools a
corpse toward gold by its creation order, and the test created the FRESHEST one
first — so the FRESH corpse was drawn in memory-gold and the MEMORY one in full
accent. That ordering cannot occur in a real game. Corrected, the honest margin
was **1.2**.

**And its metric could not see the design's main tell.** It measured mean
luminance and a count of lit pixels in a fixed box. The count saturates at 100%
for every stage, so it contributed nothing but noise — while the shelf bar, which
§16 says is *drawn exactly as wide as the collision actually is*, was not measured
at all. It now measures brightness, chroma, and the width of that bar:

```
FRESH   lum  94.4  chroma 114.8  shelf 45.3%
THIN    lum  95.5  chroma  95.3  shelf 19.5%
TOP     lum  71.7  chroma  66.7  shelf  2.5%
MEMORY  lum  57.8  chroma  42.1  shelf    0%
```

Monotone, and the shelf percentages are the collision widths. Margin 41.0.

The stages were also genuinely too close and were widened — solidity 1 / 0.66 /
0.34 became 1 / 0.5 / 0.24, and the shelf bar's alpha spread and thickness both
grew. An external reviewer had already said this in words — *"it is not clear
which bodies still hold weight"* — and the suite had been reading a pessimistic
number on exactly that property for months.
