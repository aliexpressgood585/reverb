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
