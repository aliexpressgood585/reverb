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
