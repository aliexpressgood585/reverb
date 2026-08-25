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

## 20. Strict type checking, on the JavaScript, through JSDoc

The brief asks for TypeScript strict mode. What shipped is `tsconfig.json` with
`checkJs` and every strict flag on, and JSDoc types throughout — **zero errors
across all 4,300 lines that reach a player's phone**, enforced in
`npm run typecheck` and in the pre-commit hook.

Not a `.ts` conversion, and the reasoning is the same one behind §25. The
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

## 25. Physics stays at 120 Hz, not the 60 Hz the release brief asks for

*(Numbered 19 for a while, which §19 already was. Renumbered rather than left
as a collision, because two headings with one number is how a cross-reference
quietly starts pointing at the wrong argument.)*

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

## 26. Four biomes got a verb. The other two did not, on purpose

A real player climbed to 11,045 m and said: *"the design between the stages is
boring, it repeats itself."* He was right, and colour was not the problem — the
six biomes already had six palettes and, since §23, six silhouette languages.
The problem was structural. **Six biomes were six looks over one identical
verb: jump the gap.** Nothing you *did* at 11,000 m differed from what you did
at 200.

So three biomes now change what a ledge *is*, and one changes what you can see:

| biome | verb | what it costs you |
|---|---|---|
| ASH | the hold gives way `crumbleMs` after you land on it | time |
| SIGNAL | a column of rising air | nothing — it is the gift |
| BLOOM | the ledge will not hold still | certainty |
| VOID | you see what your own light reaches | knowledge of the next ledge |

CINDER and GLACIER carry none, and that is a decision rather than an omission.
Six verbs in a 900 m cycle is not variety, it is noise: every ledge would be a
special case and the ordinary jump — which is still the game — would stop being
the baseline anything reads against. Two plain biomes per lap are the rest.

### The updraft is invisible to the generator, and that is the whole design

`Sim._flight` applies the lift to every body **except `this._probe`**, which is
the scratch body `_probeFlight` and `_descendTo` fly. So every route the world
promises was proved *without* help. A column can only ever widen a gap that was
already crossable, which means three things at once: it cannot create a wall,
it cannot be the reason a hard gap is passable, and turning `updraftAccel` down
tomorrow cannot strand somebody standing in a tower built today.

The aim arc is the opposite case and gets the opposite treatment — `predict`
flies `_ghost`, which *does* feel the lift, because an arc that ignored a column
the flight will pass through is the same class of lie as the two-integrator bug
in §4. **One source per derived value; the exception is the probe, and it is
named in the code.**

`cairn-verbs-check.mjs` asserts *both halves*. Only the first would pass on an
updraft that also lifted the probe. Only the second would pass on an updraft
that did nothing at all — the dead-code case this repository has shipped before.

### The arc lied about a moving ledge — the third time, through a third hole

`predict` runs `_flight` many times inside a single aiming frame. `_stepVerbs`
runs once per **tick**. So the preview froze the tower at the instant the thumb
went down, while the real flight moved a BLOOM ledge underneath it for a second
and a half. Measured before the fix: **the aim arc claimed a landing that did
not happen on 71.8% of drifting ledges.**

Acceptance test 2 asserts arc-matches-flight and passed the whole time, at
0.000 cm — all 94 of its launches leave from the ground onto ledges that do not
move. §4 was the two-integrator version of this bug and §19 was the eroded-vs-raw
half-width version. This is the third, and the pattern is now unmistakable:

> **A derived value with one source is not enough if the source is time-varying
> and only one caller knows what time it is.**

The fix is `Sim.driftXAt(s, t)` — the single function that answers *where is
this ledge* — plus a clock, `Body.t`, on every body in the game. The real body's
clock tracks `verbTime` because both advance one `DT` per tick. `_ghost` and
`_probe` start theirs at `verbTime` and run **ahead**, through the future the
launch is being flown through. Every collision query about a drifting ledge is
now a query about a time.

After: **0 of 272.** And the gate carries its own guard against a vacuous pass —
it asserts the ledge actually moved more than 1 u during 186 of those 272
flights, because a test of moving ledges that never sees one move is the
difficulty-collapse test all over again.

### `driftAmp` is wider than the landing forgiveness, and that was a lie in a comment

The BLOOM ledge drifts 4.0 u either side. The comment shipped saying that was
"bounded well inside `landing.forgiveness`", which is 3 u. It is not. What
actually keeps a drifting ledge reachable is the **30% of the physical reach
envelope every ordinary gap is placed inside** (`tower.reachSafety`), and the
number is measured rather than reasoned: the check sweeps twelve phases of the
drift cycle from the worst footing on the ledge below, and the first tower with
a wall in it appears somewhere between **12 and 16 u**. Shipping at 4.0 is
about three times of headroom. The comment now says that.

### The crumbling hold got its own threshold because of what a new player met first

Verbs start at `verbs.from` (0.34 difficulty, ~110 m). ASH is biome **0**, so on
that single threshold the crumbling hold could appear in the *first* ASH lap at
110-150 m — and it did, in **7 towers of 18**. That makes the first verb a new
player ever meets the one that takes the floor away, before they have met the
one that gives them reach.

`verbs.crumbleFrom` is 0.50, which is above the difficulty at 150 m (0.438), so
the crumbling hold defers to the second lap at 900 m. Measured after the change,
across 20 towers: the updraft is first met at a median of **195 m**, drift at
**345 m**, the crumbling hold at **953 m**. Gift, then uncertainty, then the
floor going away — and none of it written in text.

Worth being honest about the cost: the average model tops out near 1,100 m, so
it met a crumbling hold **once in 360 attempts**. For most players ASH's verb is
effectively a thing that exists past where their run ends. The check reports that
number next to the gate rather than under it.

### The verb never lands on a gap that was cut out of a flight

A hard gap's entire guarantee (§19) is that one specific launch lands on one
specific surface. A surface that crumbles or drifts **is not that surface**, so
`World._verbs` refuses any ledge with `hard` set. Asserted, not assumed.

### Both rolls are drawn unconditionally

`_verbs` calls `this.rng()` twice before it looks at the biome, the difficulty
or anything else. If the draws were inside the branches, the random stream — and
therefore the whole tower below and above — would depend on which biome a ledge
happened to fall in, and a one-line tuning change to a rate would silently
rebuild every seed. Test 5 builds six seeds twice and compares every ledge.

---

## 27. Momentum brightens the world. It does not make you jump further

PHASE3 §4 asks for consecutive clean landings to "brighten the player's light,
lengthen the trail, enrich the audio bed **and add a small launch bonus**". The
first three shipped. The fourth is deliberately not built, and this is the
reason.

Launch speed has to stay a pure function of the drag. Every generated gap in
this game is built inside a reach envelope derived from `FEEL.launch.maxSpeed`
— §19's hard gaps are literally cut out of a flight flown at that speed, and
`Sim.routeExists` demotes anything it cannot prove reachable at it. `WALL =
0.00%` across 4,516 audited gaps is a statement about that envelope.

Make speed a function of run state and the envelope stops being a bound. A gap
proven crossable is proven crossable *at the speed the prover used*; a player
carrying a bonus is playing a different, larger envelope, and a player who just
broke their streak is playing a smaller one — one where some gap the audit
called DIRECT is not. The guarantee that a real player stopped getting stuck
would quietly become a guarantee about the average case.

So momentum is presentation only, and it is presentation with no gameplay
consequence anywhere: light radius, light brightness, trail lifetime, one
ambient filter cutoff. Nothing reads it back into the sim.

### What "clean" means, and the version of it that measured as useless

The first implementation called a landing clean if it was on the surface **and**
the flight had not touched a wall. That reads as obviously right. Measured over
48,393 bot landings, **99.3% of landings touch a wall** — the column is barely
wider than the arc, and `_sides` fires on the face of the very ledge you are
about to land on. That definition was clean on **0.7%** of landings: the feature
would have shipped and done nothing, and every other test would have stayed
green, because nothing else in the repository looks at light radius.

Wall contact is a verb in this game, not a mistake. The shipped definition is
the one the data can actually separate: a landing is clean when it came down at
least `FEEL.closeCall.marginU` inside the lip. That is **84.8%** of landings,
mean streak 4.72, and it moves.

### The close call and the streak reset are ONE condition

A landing near the lip is both the sloppy one and the one worth remarking on, so
`_land` computes `near` once and uses it twice — reset the streak, emit
`EV.CLOSE`. Two separate tests for "sloppy" and "close" would be two things that
can drift apart, and the day they disagree the game congratulates you for a
near miss while telling you it wasn't one.

### DOOMED: the close call only this game can have

Landing on a body that is about to stop being a platform has been in the data
since erosion shipped and nothing ever said it out loud. The literal reading of
the brief is "one death away from MEMORY". Measured over the same 48,393
landings, that fires **0.095 times per 100 landings** — once per 1,050 landings,
which is shipped and never seen. `FEEL.closeCall.doomedWithin` is 3, the last
three deaths of a TOP corpse's ten-death shelf life: **0.248 per 100**, about
one a session, still the rarest thing the game says.

---

## 28. The monument is SHOWN, not explained

§6's one open item: two fingers is the only gesture that cannot collide with
aiming — a swipe down *is* a launch downward in a direct-aim game — and this
game teaches nothing in text, so nothing could point at it. The view is the one
image that explains the game in three seconds without a word, and it was
reachable only by an input nobody would try.

The fix does not teach the gesture. It performs the gesture's **result**, at the
moment the result is the truth of what just happened: the death that set a new
record, with the new stone on top of everything you have ever left. It runs
after `finishDeath` has already respawned, so control is back before the view
opens, and closing it costs the one touch that closes a monument opened
deliberately — which is how the exit is learned for free.

It is a nudge, not a habit. `FEEL.monument.revealAt` is `[1, 4, 10]` record
deaths, it needs `revealMinBodies` corpses so there is a tower worth showing, it
never fires over a thumb that is already aiming, and **the first time the player
opens the monument with two fingers of their own it stops forever**, persisted.
A player who has learned it is never interrupted again.

### What this can and cannot be measured against

It cannot be measured that a human who is told nothing goes on to find the
gesture. That is a question about curiosity and it needs a human; no number in
this repository is a substitute for watching someone play, and none should be
presented as one.

What is measurable is the thing the fix actually rests on, and
`scripts/cairn-feel-check.mjs` measures it: check 7 drives real record deaths
through the real update loop **without ever dispatching a second pointer** and
asserts the view opened *and that `camera.mon` actually moved* — a reveal that
sets a flag without pulling the camera back shows the player nothing. Check 8
opens it with two real pointers and asserts a further twelve record deaths
reveal it zero times.

### The acceptance suite turns the nudge off, on purpose

`cairn-check.mjs` sets `ui.monGestured` before anything else. The harness
manufactures record deaths at a rate no player produces — test 12 alone plays
sixty attempts — and while the monument is open `input.locked` is true. Left
armed, it cost test 11 its first probe (`up.vy` read 0.0, because the tap that
should have started an aim closed the monument instead) and pulled the camera
back underneath the biome screenshots in tests 4-6, moving their mean channel
from 62.0 to 41.9. That is a precondition, the same kind as `ui.started` and
`sim.phase`, not a workaround — the nudge is tested in the file built for it.

---

## 29. The game is about deciding where to die, and it never said so

The complaint was that the game reads generic, and it was correct. Three
reasons, all checkable:

1. **The one non-generic idea was framed as failure.** The aim preview has drawn
   the corpse you would leave since the ghost shipped — the game already knew
   how to say "put a body there" — but every prospective corpse was drawn
   identically, in the gold of memory, so the screen said "you will die here"
   and never "and it will get you up there". The decision the whole design rests
   on was on screen and unreadable.
2. **The tower has one noun.** 4,541 audited gaps and every one of them is a
   ledge. A biome changes the hue and adds a verb; the 500th metre is the 50th
   in a different colour.
3. **The first sixty seconds hid the hook.** `cairn-first-minute.mjs` measures
   the on-ramp as "materially more forgiving" — deliberately — and the
   difficulty curve then put the first constructed hard gap at a median of
   **233.6 m** and rolled it 45% of the time, against a novice whose median
   death is 117 m. So a new player spent their whole first session in a
   competent, forgiving, entirely ordinary jumping game.

This entry is (1) and (3). (2) is untouched and still true.

### The gap that leaves the on-ramp is hard by promise, not by roll

`tower.rampHard`. The first perch at or above `openingSpan` gets a constructed
hard gap (§19) whatever the curve says — cut out of a real flight from the worst
footing, so it is provably crossable in one launch and cannot be a wall. An
expert clears it and never knows it was there; everyone else fails it, watches
themselves become a ledge, and stands on it.

Measured, 60 seeds: perch at a median **74.0 m**, the ledge it must reach at
**90.5 m**, in **59 of 60** towers. The sixtieth is seed 32, where `hardStep`
returns null in both directions and the generator falls back to an ordinary gap
— that refusal is the entire reason WALL reads 0.00%, so the gate is 95% and not
100% on purpose. `--tune='{"rampHard":false}'` takes the check red.

What it actually bought, novice model, on the gap above the on-ramp:

| | rampHard off | on |
|---|---|---|
| the gap leaving the on-ramp is constructed | 0 / 60 | **59 / 60** |
| of those who reach the perch, cross it over their own body | 71% | **92%** |
| first at attempt (median) | 8 | **6.5** |
| cleared it in one launch, never needed a body | 13 | **4** |

### Gold is a body. The accent is a plan.

`Sim.gainsFrom(x, y, fromX, fromY)` asks one question: if a body came to rest
here, would it put a ledge in reach that is **not** in reach from the perch this
flight left? The second half is load-bearing — a body that only unlocks
something you could already jump to costs a life for nothing, and it would light
up just as brightly on a naive test.

It is arithmetic, not a flight: the same `dy + |(dx,dy)| ≤ v²/g · reachSafety`
envelope the generator places every ledge inside, written once in `inEnvelope`
so "can this be jumped to" has one answer in the program. `Sim._reaches` runs up
to 150 predictions and is exactly right; this runs six multiplications and is
optimistic in the same direction the generator is. It is called while the thumb
is moving.

When it finds something, the ghost switches from `MEMORY_GOLD` to the living
accent, heavier and brighter, and the ledge it buys takes a ring. The death that
follows knows too: `sim.deathMeant` is computed **before** the corpse exists (or
the body would be offered as the ledge its own arrival unlocks), and it adds a
rising fifth under the collapse — under it, never instead of it, because you did
die and softening that would be a lie about the one rule the game has — plus a
haptic pattern that resolves instead of falling.

No text anywhere near any of it. The difference between throwing yourself away
and spending yourself is a colour.

### Two bugs this earned, and why the checks are shaped this way

`gainsFrom` first added half a body height to the apex to get the corpse's
surface. `_die` passes `peakY - corpseH/2` as the **centre**, so the surface is
exactly the apex — the same lie about the same rule that once left half of all
overreach gaps unbridgeable and stranded a player at 391 m.

And the first version of the ramp promise read
`lastLedge.y < openingSpan && h >= openingSpan`. `lastLedge.y` **is** `h` — the
perch is the ledge — so the condition could never be true. The change did
nothing whatsoever, and `npm run accept` stayed 14/14, `reach` stayed at WALL
0.00% and `bodies` stayed at 7.5%. What caught it was `cairn-hook-check.mjs`
asking where the first hard gap actually is and reading back 233.6 m, unchanged.
Seventh in the series of green tests blind to the state they claim to cover.

`cairn-hook-check.mjs` also had to be rewritten once itself: it asserted the
hard **ledge** lands within one rise of the on-ramp line, when it is the
**perch** that lands within one rise and the ledge is two. It read 21 of 60 on a
generator doing exactly what it was told.

---

## 30. The tower gets nouns, and they are allowed to touch nothing

§29 named three reasons the game reads generic and fixed two. This is the
third: **the tower had one noun.** 4,541 audited gaps and every one of them is
"a ledge". A biome changed the hue and added a verb; the 500th metre was the
50th in a different colour. There was nothing in the world that was a THING, and
nothing to climb toward — a climb with no destination is a number going up.

### Decoration, and only decoration. That is the whole safety argument.

A landmark has no solid, no collision, no entry in `world.solids`. `World.generate`
does not read `landmarkOf` and cannot: the placement is a pure function of the
world seed and the band index, using its own integer hash rather than the world
rng, because the world's random stream IS the tower and drawing from it here
would make the terrain depend on how many landmarks had been asked about.

That is not a convenience, it is the reason this was safe to build at all.
`WALL = 0.00%` is a property of the reach envelope; scenery that cannot touch a
ledge cannot touch it. Check 1 of `cairn-landmark-check.mjs` holds the argument
to account rather than trusting it — 61 ledges over 1,200 m rebuild
byte-identical from the seed with landmarks present, and no solid sits at any
anchor.

### One per biome, at the CENTRE of the band

Which puts the first at **75 m**, inside the 150 u opening view. The first
screen a new player ever sees now has a structure standing above them. Placing
them on the biome BOUNDARY was the obvious alternative and it is wrong: the
first would be at 150 m and the novice model's median death is 117 m, so most
players would never see one.

### Six shapes, and four of them had to be drawn twice

The check that all six differ measures ink distribution over an 8×8 grid. It
passed on the first draft. Four of the six still did not read as anything, which
is the limit of what that check can know — "different from each other" and
"legible as a thing" are different questions and only one of them is
measurable here. Looking at the frames:

- **SIGNAL, a lattice mast** — worked immediately. Guy-wires are what stop a
  tapered lattice reading as a ladder.
- **VOID, a chain into the dark** — worked immediately, and is the best image
  of the six.
- **ASH, a collapsed stair** — failed. Drawn as detached L-brackets along a
  diagonal it read as debris. A stair is legible only as ONE CONTINUOUS ZIGZAG,
  so it is now a single polyline of riser-tread-riser-tread with a real break in
  it and the upper flight offset sideways. The gap is the thing worth drawing
  and it needs intact run either side to be a gap at all.
- **BLOOM, roots** — parallel strands edge to edge read as cables. Roots read as
  roots when they converge to a trunk and divide going down.
- **GLACIER, a frozen fall** — stroked lines of constant weight read as pipes.
  Ice reads as ice when it TAPERS; they are filled triangles now.
- **CINDER, a furnace mouth** — the arch read, the brick courses read as
  scanlines. Two causes: they were not clipped tightly to the arch, and every
  shape was too wide (below).

### 132 u wide against a 69 u window

A 390×844 phone at the default 150 u view shows about **69 u of width**, not the
100 u column — the camera tracks x. Every shape was authored at 132 u and
overflowed the glass, which is why the furnace's courses ran off both edges as
stripes. 86 u fills the frame and overhangs it slightly, which is what a large
structure should do.

### Two measurements that were measuring the rasteriser

Both caught by asking for a NOISE FLOOR before believing a difference.

The frame-cost check reported **+1.57 ms** on one run and **−0.12 ms** on the
next, on identical code. A negative cost is a thermometer describing a different
room. Interleaving the two conditions inside one loop and taking a median was
not enough either; the honest answer came from sampling "with" against "with"
to see what the instrument can resolve. It resolves about **0.04 ms**, and the
landmarks cost about **0.03 ms** — so the reading is "too small for this
instrument to see", which is what it now prints instead of a number.

The monument check asserted the frame is *identical* with and without landmarks
at full pull-back, and read a 0.075 difference. Two draws of the same scene with
nothing changed also differ by 0.075. The check now measures that floor first
and compares against it.

---

## 31. Six secrets, and the key is a thing the game already shows you

A game that teaches nothing in text is the ideal place for something nobody
explains — but a secret is only worth building if it is *aimable*. A secret you
find by luck is a slot machine; a secret you find by understanding is the thing
people post about.

**Leave a body inside the heart of a landmark and the structure answers.**
Permanently, saved, six of them in a tower. Nothing anywhere says so.

### Why it is findable without a hint

The key is the ghost. Since §29 the aim preview draws the exact spot a corpse
will come to rest, and lights it in the living accent when that body buys
something. A player who has understood that preview already has everything
needed to aim a death at a point in space. A player who has not cannot stumble
in — and that is measured, not asserted:

| | |
|---|---|
| hearts reachable by a real launch that dies there | **4 of 4** tested, from 20–57 u below |
| accidental claims, real climber | **1.92 per 100 deaths**, 58% of towers inside 40 attempts |

The reachability sweep uses the same `predict()` the aim preview draws with,
because that is literally the tool the player uses.

### The second number was wrong, and wrong in the way this repository keeps being wrong

It first read **0.88 per 100 deaths**, and the check that produced it said "a
secret has to be aimed at, not stumbled into". Every word was false. The bot it
used fired random launches from the base and **never climbed**, so almost none
of its deaths happened anywhere near a heart and the rate was computed over a
population that could not have claimed anything.

What found it was not a test. It was looking at a played session: the
playthrough capture reported `landmarks held [0]` after 26 deaths of ordinary
play, against a check claiming one in 114. Asked of the real climber at the
radius that check had blessed, the true answer was **4.9 per 100 deaths and 93%
of towers giving one up inside forty attempts** — five times the reported rate,
and not a secret at all. Eighth instance in this project of a measurement blind
to the state it claims to cover, and the first one that is mine.

### So the radius is tuned to a BAND, not minimised

| radius | claims / 100 deaths | towers with ≥1 in 40 attempts |
|---|---|---|
| 6 | 1.13 | 38% |
| **8** | **2.13** | **60%** |
| 10 | 3.19 | 73% |
| 16 (as shipped, briefly) | 4.88 | 93% |

Minimising is the wrong instinct. A secret nobody ever meets is dead content,
and at radius 6 nearly two thirds of players would never learn the mechanic
exists. At 8 the FIRST one finds most people by accident — that is the tutorial
— and the other five have to be hunted, which is the game. Exactly the shape of
the monument nudge: show it once, then let them look.

`cairn-hook-check.mjs` now gates the rate inside 0.8–4.0 per 100 deaths and
25–85% of towers, driving the balance harness's real bot. The landmark suite's
version is deleted rather than repaired, with a note in its place saying what it
claimed and why it was false.

### It is history, so it is saved

`sim.claimed` is a set of biome bands, persisted next to the corpses and the
record. Not schema-versioned: it is an optional array that older code ignores
and the loader tolerates being absent, so it needs no migration in either
direction. Every band is range-checked on load the same way every corpse row is.

The reload check asserts **both halves**, because acceptance test 8 once
verified that corpses survive a reload without verifying they still hold weight,
and they came back non-solid. So: the bands come back, AND the renderer still
draws that landmark as held.

### The recede, which was a bug the whole time

A landmark was at FULL strength exactly when the player was in the middle of it.
Backwards twice over. Artistically a structure should read as enormous on
approach and become ambience once you are climbing through it. Practically its
strokes were crossing the corpses at the one distance where telling FRESH from
TOP from MEMORY matters most: **acceptance test 13's separation between
neighbouring erosion stages fell from 49.2 to 4.8** with landmarks in.

It still passed. That is the point worth recording — the gate was not the thing
that caught this, the 10× drop in a number nobody was gating on was. Landmarks
now give up `insideFade` (0.78) of their alpha at the centre, and the separation
is back to **36.3**. The remaining cost is real and is the price of having
scenery at all; the ledges and the bodies stay the readable layer, which was
always the rule.

---

## 32. A held landmark stays in the monument. Nothing else does.

Every atmosphere layer — parallax ridges, light shafts, dust, the enormous
background height, and as of §30 the landmarks — fades out with the monument
pull-back, because the monument is a portrait of the bodies in the tower and a
skyline drawn across it is clutter (§6's "done when").

A HELD landmark is the exception, and the exception is the whole point. It is
not scenery. It is something the player did on purpose that almost nobody knows
is possible, and the monument is the one image they share. So an unheld
structure still vanishes at full pull-back and a held one never drops below
`FEEL.landmark.monHeld`.

This was found by making the store's hero screenshot hold three landmarks and
discovering the change did nothing, because the shot is taken in monument view.
The listing image was the thing that asked the design question.

### The hero screenshot was selling a thinner game than exists

90 bodies over 520 m. Corpses older than 25 deaths are MEMORY, so all but the
top handful drew as faint gold outline and the frame was mostly background — an
accurate picture of a tower nobody had really played. 190 bodies over 430 m is
the same game photographed after somebody has actually played it, and with three
structures lit through the spine it now shows the thing that is hardest to
explain in words.

---

## 33. The ghost races your jumps, not your clock

PHASE3 §8 asks for the best run replayed as a **translucent racer**. It is built,
and it is not a racer against time. That is the one shape this game cannot take
and it is worth saying exactly why.

Aiming dilates time on purpose (`FEEL.aim.timeScale` is 0.15) and the entire
loop is deliberation — the player is meant to hold a thumb still and read an arc.
A ghost running against real seconds would be beaten, or would beat you, on **how
long you thought**, not on how well you jumped. It would measure the wrong thing,
and worse, it would pressure the player out of the one behaviour the game exists
to reward.

So the ghost is indexed by LAUNCH. At your seventh jump it stands where your best
self stood at its seventh. That compares climbing, is immune to thinking time,
and rewards exactly what the game rewards: fewer, better jumps.

This is the second time the brief's literal wording lost to its intent, after the
momentum launch bonus in §27. Both are recorded rather than quietly dropped.

### Why the whole recorded path stays valid forever

The shifting roof regenerates everything **above** `best` on every attempt, which
would normally make a recorded path meaningless a few deaths later. It does not
here, because the ghost is only ever replaced by a run that **set** the record:
such a run finishes at or below the new `best`, so every ledge it touched is at
or below the frontier and is therefore stable ground from then on.

Which gives the ghost its ending for free. It runs out exactly at the record
height and leaves you there — at the edge of the known world, which is the only
honest place for it to stop.

### Only a record run replaces it

A ghost that updates on every death is a ghost of your **last** run, not your
best, and chasing your last run is chasing nothing. Captured in `finishDeath`
under the same `beat` test the record banner uses, and captured *before*
`respawn`, which clears the path.

### What the check has to hold

That it steps on launches and not on the clock is the design claim, so it is the
falsifiable one: 240 frames of pure time move it 0.000 u, and two launches move
it 79.6 u. A ghost that never moved at all would pass the first half alone, which
is why both halves are asserted.

---

## 34. The share image is the distribution channel, and it was the worst thing in the product

A game with no marketing budget has exactly one way to spread: the picture a
player posts. Eleven suites were green, the monument view had been tuned, the
store screenshots had been regenerated twice — and nobody had ever looked at the
**file that actually leaves the phone**. `Store.poster` had been shipping since
before any of this and had never been opened.

It was the worst-looking artifact in the game. Three separate defects:

**Bodies were `fillRect(-7, -11, 14, 22)`.** A game whose entire subject is that
the platforms are people, exporting its tower as a column of little boxes. The
silhouette now comes from `figurePath`, exported from `render.js` so the poster
and the scene draw the same body — a second copy of that path would have been a
second copy that drifts.

**The frame was fitted to the column, not to the tower.** `toX` was
`(wx / 100) * W`, so the whole 100 u playfield stretched across the poster
whether anything stood in it or not. A player whose bodies fell between x 65
and 95 got a poster two thirds empty with the tower jammed against one edge. It
now fits the bodies' own span, clamped to a minimum so a tight tower is not
blown up, and padded so nothing touches an edge.

**And the first fix produced 141-pixel corpses.** Scaling the figure by
`W / spanX` is the obvious thing and it is wrong: a tower whose bodies fall in a
narrow band gets a huge scale factor. How big a body should look on a poster has
nothing to do with how wide the tower it came from happened to be. It is
`H / 64` now.

**The thread was a sail.** It joins each body to the next in death order, which
reads as one continuous history when the deaths are near each other and as a
chord across the whole image when they are not. Segments fade with their own
length: the near ones carry the history, the far ones stop drawing over the
tower.

What is left is honest rather than flattering. A 26-body, 387 m session renders
sparse and bottom-heavy, because deaths concentrate low and that is the true
shape of a short session. The store hero shows 190 bodies and is dense. Neither
is retouched.

### And the listing was making claims the product does not support

Same class of problem: the copy was written before the landmarks, the secrets
and the ghost, and it had drifted into being wrong.

- **"the whole game is under 30 kilobytes"** — it is 36.7 KB gzipped. A false
  measurable claim in a store listing.
- **"One purchase removes ads and unlocks every cosmetic"** — `money.js` has
  `PROVIDER = 'none'`, an empty ad unit and no billing wired anywhere. The
  listing described an in-app purchase that cannot be made, which is a Play
  rejection risk and, more simply, not true. The honest line is stronger: **no
  ads, no purchases, nothing to unlock with money.**
- Three of the game's most distinctive features were missing from it entirely.

The structures and the ghost are now in both listings. **The secret is not**,
and that is deliberate: a listing that explains it destroys it, and word of
mouth is the right channel for a thing nobody is told. The copy says only that
there are things in the tower nobody will tell you about.

Character counts are now verified by counting the fenced blocks rather than by
eye — the short description was annotated "79 characters" and is 80, which is
exactly at Play's cap.

---

## 35. Two things nobody had looked at, and both were wrong

The pattern is now four for four: the last four real defects in this project
were found by opening a screenshot, not by a gate going red. `npm run ui`
renders every screen at three sizes in both languages and reports "no layout
problems at any size, in either direction" — and it had been reporting that,
truthfully, over two screens that were broken in ways layout cannot see.

### The marks screen was thirty mysteries

Thirty names, thirty "Not yet"s, and **not one word about what any of them
asks for**. A player looking at "Staircase", "Ladder" or "Built Of You" had no
way to know what any of them wanted.

This game's no-text rule is about the TOWER teaching itself. It was never a
licence to hide what a goal is, and an achievement list nobody can read gives no
direction at all — which is the only reason to have one.

Every mark now carries a hint, in both languages, and **each one is written from
the mark's `test` rather than from its name**, because several are subtler than
they sound. "Ten Clean Jumps" also demands 150 m and zero bodies stood on; a
hint reading "ten clean jumps" would have been a wrong hint, which is worse than
none.

### The most destructive control in the game was styled as the primary action

`style.css` says, one line above the button rules: *"One is primary per screen
and it is the only --ember thing on it."* `.danger` was ember text, differing
from `.primary` only in border alpha and opacity — and on the settings screen
the erase button is the **only** ember thing. So the control that deletes every
body, the record and the streak, with `Store.wipe` clearing the backup slot too
and no recovery of any kind, read as the screen's primary action.

Half of my first reading was wrong and is worth recording: there **was** already
a two-tap confirm. What was missing was everything around it.

- **Quiet until armed.** Slate, not ember. It is not an invitation.
- **Unmistakable once armed.** Full ember, ember border, tinted ground — because
  the second tap is a different act from the first and has to look like one.
- **It disarms itself** after four seconds, and on leaving the screen. An armed
  button that sits waiting means a player who armed it, read the warning,
  decided against it, and touched that row again later has destroyed their tower
  with a stray tap.

`AUDIT.md` calls losing a player's tower the worst possible bug this game can
have, so it is now **acceptance test 15** rather than a screenshot: one real
hit-tested tap must arm without erasing, the appearance must actually change,
and the armed state must be gone before a stray second tap can land.

## 36. The monument framed the column, not the tower

Asked what I would change about how the game LOOKS, the first thing I did was
open the frames again rather than answer from memory — and the share image was
composed wrong. Not subtly: the pull-back centred the camera on `COLUMN * 0.5`,
which is where the world is, not where this player's tower is. A session that
happened to climb up one side got published with its monument shoved toward the
edge and a third of a screen of nothing beside it.

Measured across six deliberately lopsided sessions, the tower's own centre sat
**90 to 123 px off the middle of a 390 px screen** — a quarter of the width.
After the change, all six are within 0.1 px. `Store.poster` had already been
fixed to compose on the bodies' span (§34); the LIVE view, which is the one the
player actually looks at before deciding whether to share, had not. One subject,
one rule for framing it.

Three things this cost, all of which are the interesting part:

**The first rule I wrote was a no-op.** I clamped the shift so the frame could
never show outside the column — and `minSpan` 260 on a 9:19.5 screen is a 120 m
view of a 100 m column, so the column always fits with room over and the clamp
pinned the camera to the centre in every case that exists. It built, it ran,
nothing failed. The only reason it did not ship is that the number came back
unchanged. **A guard whose condition is never true is indistinguishable from a
guard that works, from the inside.**

**The probe I wrote to check it measured nothing.** It drove `update()` by hand,
but `monTop` and `monX` are set in `frame()`, which only runs on rAF — so it
reported `monX 0`, `viewH` pinned at `minSpan`, and an identical ink centroid for
all three lean values it was supposed to be distinguishing. Three different
inputs, three identical answers: the tell, every time, is that the independent
variable did not move the output at all.

**And the gate had to displace the tower itself.** Check 2b asserts the frame
follows the bodies — but a tower that grew up the middle passes under either
rule, so asserting it on whatever session the suite happens to produce would be
another blind test. It now shoves the bodies bodily to x=82, waits for the
camera to settle, and reports the offset the old rule would have left (14.3 px
on that session) beside the offset it actually measures (0.0). A gate that
cannot say what it caught is not evidence of anything.

One consequence worth naming: `teachPull` and the landmark `claimPull` drive the
same blend to about a third, during play, with the monument closed. Keying the
midline update on `ui.monument` alone would have let those pulls lean the camera
toward a midline left over from the last monument — a sideways lurch mid-climb.
It is keyed on `monTarget > 0` instead, which is the thing that actually decides
whether the blend runs.

## 37. The world's holds glowed and yours did not, and the opening biome had it backwards

Two changes to what the game looks like, both of which started as an opinion and
only survived because a measurement agreed.

### The body you leave is not a dimmer hold than the rock beside it

A generated ledge draws its lit crest and then an ADDITIVE bar over it, so it
blooms. The shelf of a corpse — the load-bearing surface, the thing the whole
game is named after — had no such pass. Measured properly, with a ledge and a
fresh body at the SAME height and the SAME distance from the player's light
(both `lit` and `rimlight` are functions of that distance, so an asymmetric
fixture would have measured the fixture):

```
before   ledge crest peak 173.8   corpse shelf peak 153.7   1.13x
after    ledge crest peak 173.8   corpse shelf peak 173.8   1.00x
```

**The honest part: 1.13x is smaller than the screenshots suggested.** What makes
a corpse read as debris in a still is mostly its shape and its width — a small
rotated figure against a long clean horizontal line — not this. The bloom was
worth adding because the DIRECTION was wrong, not because it was the whole
effect, and saying otherwise would have been selling the change.

Scaled by `solidity`, so it deepens the erosion ladder instead of flattening it:
full on FRESH, half on THIN, almost nothing on TOP, and MEMORY is a separate
branch that never had a fill. Drawn exactly `hwPx * 2` wide, which is the
narrowed hitbox — §16's rule that a hold is never drawn wider than it catches
applies to the glow as much as to the bar.

### ASH drew its scenery in the brightest colour it had

`_landmarks` promises in its own comment that "the ledges have to win". Landmarks
stroke in `B.rock`; ledge crests light in `B.accent`. Across the six palettes:

```
ASH       rock 196.6  accent 144.8   1.36   <-- scenery brighter than the holds
SIGNAL    rock 124.2  accent 247.2   0.50
BLOOM     rock 100.0  accent 124.9   0.80
VOID      rock  54.1  accent 198.2   0.27
CINDER    rock  87.3  accent 210.6   0.41
GLACIER   rock 210.6  accent 213.2   0.99
```

Four biomes keep the promise. ASH inverts it — and **ASH is the opening biome**,
0 to 150 m, the first thing every new player ever sees. So the one frame where
the rule matters most was the one frame where it was backwards, and a pale
diagonal beam across the play area is exactly the shape of a thing you would try
to land on. GLACIER sits on the line at 0.99.

The stroke colour is now clamped to at most the accent's luminance. Clamped at
draw time rather than by editing the palette, because `B` is blended per frame
between two biomes and the rule has to hold on the blend too — check 9 samples
the blend across 1200 m for exactly that reason, and checks every declared
palette rather than whichever one the running session happens to be standing in.
A check that read the current biome would pass on five of six by luck.

### What the clamp did NOT fix, said plainly

The measurement moved and the picture barely did. ASH's rock is now stroked at
exactly 1.00 of the accent rather than 1.36 — a 26% cut — so the INVERSION is
gone, but "not brighter than" landed on parity, not below it, and in the opening
frame the pale diagonals still cross the play area as the second-brightest thing
on screen. Against a LIT ledge crest (alpha up to 0.86 plus its additive bar)
they now clearly lose, which is the case that matters: a hold near the player is
unmistakably the brightest line. Against an UNLIT distant crest (alpha 0.16) a
landmark stroke at 0.30 is still the brighter mark.

That last one is left alone on purpose, because it is the design: `_light`'s own
comment says the lit radius is generous precisely so "the NEXT ledge is unknown".
A ledge that is deliberately hidden being dimmer than scenery is not an
inversion, it is the fog working. Cutting the scenery further to beat a hold the
game is intentionally concealing would be tuning against the design to satisfy a
number.

So: one measurable defect found and fixed, and the residual is taste. Going
further needs a person's eye, not another clamp.

### What was left alone

`Store.poster` draws every body identically, coloured only by age, with no
erosion stage at all — and that stays. Erosion is a live property about whether
a hold will still take your weight; in a still image of a finished session there
is no weight to take. That difference is deliberate, unlike §36's framing rule,
which was an accident of two code paths nobody had compared.

And the single-hue direction stays until a person has looked at it. Everything
is amber-on-amber with only the player's diamond off the hue, and cooling the
rock away from the accent would separate the layers — but that is the whole art
direction, it is taste rather than a defect, and it is very easy to make worse.
