# CAIRN — what to build next, ranked by impact

Ranked by *what changes whether anyone plays this twice*, not by what is
interesting to build. Each item says what it is, why it ranks there, and what
"done" means in a way that can be measured.

Before starting any of it, read `AUDIT.md` for the honest state and
`DECISIONS.md` for the eighteen calls already made — several of these ideas have
already been tried and rejected once, with reasons.

---

## 1 — Balance. DONE, with target 3 failing and now PRICED — see `BALANCE.md`

Measured, retuned and re-measured. Targets 1, 2 and 4 hold. **Target 3 does not**,
and as of 2026-08-10 it has been re-opened and closed again on measurement rather
than on a citation: the only knob that meets it (`overreachRate` 0.45) takes the
route audit from **WALL 0.00% to WALL 17.64%, 653 dead ends starting at 131 m** —
the exact mechanic that stranded a real player at 391, 481 and 567 m. The
wall-free knob (`hardRate`, verified still 100% DIRECT at 0.90) moves it from
78.5% to only 57.5% while dragging body landings from 7.20% toward the 5% gate.
Target 3 stays failing with its cost priced. But a parallel session found the
third axis in the same window — TIME, via crumble grace that tightens with
absolute height, wall-free — and it moves the number to **68%** once the harness
models a hand that actually pauses on a ledge (`--dwell=1.5`; the bot had been
landing and launching in the same tick, the seventh blind measurement here).
Still unmet, no longer a closed door. Full tables in `BALANCE.md`.

The original note, kept: an expert passes 600 m on 83% of first attempts (78.5%
on the current re-measurement), against "but not on a first
attempt". It failed at `c1bf734` too, at 95%, and it is recorded as failing rather
than reported as improved.

The brief as originally written follows, unchanged, because the finding was worse
than it assumed: the world did not merely have an easy curve, it had **no
ceiling at all** — a fixed constant flattened difficulty above 900 m and 40 of
40 expert runs climbed 84 km without dying once.

### The brief, as it stood

**The world is too easy, and it is measured**

**Everything below is worth less until this is fixed.** A fixed-skill bot
reaches a **721 m median across sixty deaths**. A game whose difficulty a naive
bot can brute-force has no curve, and every retention feature you bolt onto it
is decorating an empty loop.

Build the headless bot properly: novice / average / expert aiming policies with
configurable error, 10,000 climbs across many seeds, run against the real
physics through `Sim` (which has no DOM and runs in Node — use that, don't drive
a browser).

Then tune generation until:

- novice reaches 50 m within 5 attempts and 150 m within 25
- the average player's median death height rises steadily, no plateau > 40 m
- an expert can theoretically pass 600 m, but not on a first attempt
- **no single 10 m height band holds more than 12% of all deaths** — a spike
  there is a generator bug, not difficulty

Write the curves into `BALANCE.md`. There is deliberately no `BALANCE.md` today
because there is no honest data for one.

**Done when:** the four targets hold across 10,000 climbs and the numbers are in
the file. — Done: 10,000 climbs per skill, 30,000 total, in `BALANCE.md`.

---

## 2 — The reachability solver. DONE — `cairn-reach-check.mjs`, `cairn-bodies-check.mjs`

The solver runs inside generation now, in both directions.

**Downward:** `Sim.routeExists` flies a probe through the real physics and demotes
any ledge it cannot prove a route to. It is a permanent guard rather than a
repair, because `overreachRate` is 0.

**Upward, which is the part that was missing:** `Sim.hardStep` does not verify a
placement, it *derives* one. It flies the physics off the worst footing on the
ledge below and puts the new landing surface at the far end of the arc, so a hard
gap's direct route is true by construction and the failure mode that produced
every wall this game ever had cannot occur. Audited at **4,506 gaps from 0 to
3,000 m, 100% DIRECT, zero walls**, and separately at **766 of 766 constructed
hard gaps crossable in one launch from the worst footing** under an independent
sweep the generator cannot afford to run.

The original "done when" — zero impossible or single-solution chunks — is met on
the first half and deliberately not on the second: a gap with exactly one solution
is now the *point*, and the solution is a 5.0%-of-full-power window rather than an
aim. See BALANCE.md and DECISIONS.md §19.

Still open: **two-body routes are unmeasured.** 33 of 76 sampled hard gaps are
crossable in exactly two jumps over one body; the rest take the direct jump or
more than one body, and nothing has measured which.

### The brief, as it stood

Generation currently keeps every ledge inside the projectile reach envelope
(`dy + |(dx,dy)| ≤ v²/g`, scaled by `FEEL.tower.reachSafety`). That proves a gap
is *theoretically* crossable from the ledge centre. It does **not** prove a
route exists through a chunk, and it does not prove there is more than one.

Build a solver that, after generating each chunk, searches the actual physics
for **at least two distinct valid paths** and regenerates the chunk on failure.

This ranks above content because it is the difference between a hard game and a
broken one — and because CAIRN has already shipped 38 impossible gaps once,
found by a bot and invisible to the eye.

**Done when:** zero impossible or single-solution chunks across 10,000 seeds.

---

## 3 — The first sixty seconds. DONE — `scripts/cairn-first-minute.mjs`

The on-ramp: over `tower.openingSpan` (60 m) the tower blends from deliberately
generous to whatever the difficulty curve says. Landing windows 17.0 u against
10.7 u later, gaps 18.6 u against 23.0 u, and the narrowest window on the ramp is
14.5 u — comfortably over the ~8 u a novice's 6.5 deg / 11.5% error typically
misses by. No rise on the ramp exceeds a full-power launch and no gap on it can
be uncrossable, by construction rather than by curve.

**And the beat that sells the game now exists.** The first time a player ever
stands on one of their own bodies, the camera pulls back for 1.5 s and comes
home. No text, no pause, control never taken away. It fires once per player,
ever, and remembers. Until now that moment happened with no acknowledgement at
all — a player could do the thing the entire game is about and not notice.

All four beats are instrumented with real timestamps on `window.CAIRN.ui.beats`,
because the wall-clock windows below cannot be asserted with a bot: a bot aims in
microseconds and a person takes seconds, so any number it produced would describe
the harness. The windows are for a real session on a real phone.

### The brief, as it stood

Retention is decided here and nowhere else. The beats:

| | |
|---|---|
| 0-3 s | first touch starts the run instantly — already true |
| 3-10 s | first jump nearly unmissable: wide target, generous assist |
| 10-25 s | first death, engineered to look survivable. **The corpse freezing is the image that sells the game** — make it the most beautiful moment in it |
| 25-40 s | first time standing on your own corpse, with a brief camera pull-back so the player cannot miss what just happened |
| 40-60 s | first biome transition, teaching that the world changes |

Instrument each beat and assert the timings against the **novice bot**, not
against someone who already knows the game.

**Done when:** every beat lands inside its window for the novice model, with
zero text.

---

## 4 — Momentum and close calls. DONE — `scripts/cairn-feel-check.mjs`

Both built, both measured, and the measurement is the point: this is a feature
whose entire expression is "the light is a bit wider", so without an instrument
it could do nothing forever while every other test stayed green.

**Momentum.** Consecutive clean landings widen the player's light and lift its
core, lengthen the trail, and open the ambient bed's filter by 900 Hz. Never a
bar, never a number. The definition of "clean" is the part worth recording: the
first version also required not having touched a wall, which reads as obviously
right and measured as useless — **99.3% of 48,393 bot landings touch a wall**,
because the column is barely wider than the arc, so that version was clean on
0.7% of landings. The shipped rule is "came down at least `closeCall.marginU`
inside the lip": **84.8% clean, mean streak 4.72, cap 8.**

The brief's fourth item — a small launch bonus — is **deliberately not built**.
Launch speed has to stay a pure function of the drag or the reach envelope that
`WALL = 0.00%` is derived from stops being a bound. DECISIONS §27.

**Close calls.** A landing within `marginU` of the lip dilates time to 0.35 for
260 ms under a low swell — and it is the *same* condition that resets the
streak, computed once, so the scare and the reset can never disagree. Measured
at **15.2 per 100 landings**.

And the one only this game can have: **DOOMED**, landing on a body that is about
to stop being a platform. That fact has been in the data since erosion shipped
and nothing ever said it out loud. `doomedWithin` is 3 rather than the brief's
literal 1, on measurement: at 1 it fires **0.095 times per 100 landings** — once
per 1,050, shipped and never seen — against **0.248** at 3, about one a session.

Against a "done when" the brief never wrote, the eight checks in
`cairn-feel-check.mjs` each assert the entry condition separately from the
effect, and read the effect as pixels off the canvas or as simulated seconds
through the real `update`, not as the flag that was supposed to cause it.

---

## 4b — The premise arrives on the on-ramp. DONE — `scripts/cairn-hook-check.mjs`

Not in the brief; added because the game read generic and the reason was
measurable. The first constructed hard gap sat at a median of 233.6 m and was
rolled 45% of the time, against a novice whose median death is 117 m — so the
one idea this game has arrived late, at random, or never. The gap that LEAVES
the on-ramp is now hard by promise: perch at a median 74.0 m, in 59 of 60
towers, and of the novices who reach that perch **92% cross it by standing on a
body left in the gap** (71% before).

And the aim now says which kind of death it is looking at: a prospective corpse
that buys a ledge this perch cannot reach is drawn in the living accent instead
of the gold of memory, with a ring on the ledge it buys. No text. DECISIONS §29.

---

## 4c — The tower has nouns in it. DONE — `scripts/cairn-landmark-check.mjs`

The third reason the game read generic, and the one §29 left open. One structure
per biome — a collapsed stair, a lattice mast, a root system, a chain into the
dark, a furnace mouth, a frozen fall — at the CENTRE of each band, which puts
the first at 75 m and therefore in the opening view from the ground.

Decoration and only decoration: no solid, no collision, and `World.generate`
cannot see one. 61 ledges over 1,200 m rebuild byte-identical from the seed with
them present. Frame cost is below what the instrument can resolve (~0.03 ms
against a ~0.04 ms noise floor). DECISIONS §30.

---

## 4d — A secret nobody explains. DONE — `cairn-landmark-check.mjs` 6-8

Leave a body inside the heart of a landmark and the structure answers —
permanently, saved, six per tower, and nothing anywhere says so. The key is the
ghost: the aim preview already draws exactly where a corpse will come to rest,
so a player who reads it can aim a death at a point in space, and one who cannot
will never stumble in. Measured: **4 of 4 hearts reachable** by a real launch
that dies there, and **1 accidental claim in 114 untargeted deaths (0.88%)**.
DECISIONS §31.

---

## 5 — Daily Climb. DONE — `scripts/cairn-daily-check.mjs`

One seed per UTC date, derived from the date rather than stored, so the tower is
identical for everyone on earth at the same instant and a share card only has to
carry the date for a recipient to play it. Verified across three timezones at
00:30 UTC — where Los Angeles still reads the previous day locally and gets the
new day's seed anyway — and across the midnight boundary itself.

Its own save slot, because a daily seed is thrown away tomorrow and an endless
tower is a player's whole history. Checked: an endless tower survives a daily
session intact, and the two keep separate keys on disk.

### The brief, as it stood

One seed per UTC date, identical for everyone, one tower per day, separate from
endless. The single highest-value retention feature in the brief — but it ranks
below balance because a daily challenge on an unbalanced world is a daily
reminder that the game is easy.

**Done when:** it rolls correctly across a UTC midnight boundary from at least
three timezones, and the share card carries the date-seed so a recipient plays
the identical climb.

---

## 6 — Monument View. DONE — `scripts/cairn-monument-check.mjs`

Two fingers pull the camera back to the whole lifetime tower; a single touch
returns. No HUD, and the parallax ridges, light shafts, dust and the enormous
background height all fade out with the pull-back — every one of them is sized
against the view span, so at full zoom they stop being atmosphere and become
clutter drawn across the monument.

Against the "done when": **220 corpses, whole tower on one screen, 2.1 ms/frame
scene pass** (CPU only, software rasteriser, same caveat as acceptance test 4),
and **the poster exports in 1.14 s**. That last one needed a change: drawing the
poster costs 7 ms and encoding it was the entire wait. On the same 1080x1920
image — PNG 2225 ms / 458 KB, WebP 1033 ms / 137 KB, JPEG 1406 ms / 240 KB. It
ships WebP with a PNG fallback, because Safari only gained canvas WebP encoding
in 17 and JPEG bands the dark gradients this game is made of.

**The gesture is not discoverable — now addressed by not teaching it.** Two
fingers is the only input that cannot collide with aiming (a swipe down IS a
launch downward in a direct-aim game) and this game teaches nothing in text, so
nothing could point at it. The fix performs the gesture's RESULT instead: on
record-setting deaths `[1, 4, 10]` the game opens the monument itself, after
control has already come back, and one touch closes it. The first time the
player opens it with two fingers of their own, the nudges stop forever.
DECISIONS §28, checks 7 and 8 of `cairn-feel-check.mjs`.

**What is not measured, stated plainly:** whether a human who is told nothing
goes on to find the gesture. That needs a human. Check 7 measures what the fix
rests on — a player who never performs the gesture still reaches the view,
verified by driving real record deaths through the real update loop without ever
dispatching a second pointer, and asserting `camera.mon` actually moved.

### The brief, as it stood

Pinch or swipe-down to pull all the way back to the whole lifetime tower, every
corpse, from the base. Slow, cinematic, no HUD.

This is the emotional payoff **and** the primary share surface — the one image
that explains the game in three seconds without a word. It ranks here rather
than higher only because it shows off a tower that is not yet hard to build.

**Done when:** 200+ corpses render at 60 fps on a real phone and a poster
exports in under 2 s.

---

## 7 — The four biome verbs — DONE

ASH crumbling holds · SIGNAL updrafts · BLOOM drifting platforms · VOID darkness
beyond the player's own light. One per biome so each is learned in isolation,
and **never two new verbs within 100 m of each other**.

This was ranked deliberately low, with the reasoning: *new verbs are what a
designer reaches for when the core loop feels thin — but this loop is thin
because it is too easy, not because it is too simple. Fix the curve first.*

The curve was fixed first (§1, and BALANCE.md). Then a real player climbed to
11,045 m and said **"the design between the stages is boring, it repeats
itself"** — which is what this item was always about, arriving from the one
source that outranks the ranking.

Built, gated by `scripts/cairn-verbs-check.mjs`, reasoned through in
DECISIONS.md §26. The measured facts:

- One verb per biome, **only** in its own biome, never inside the 60 m on-ramp
  and never on a gap cut out of a flight (§19's guarantee is that one launch
  lands on one surface; a surface that crumbles or drifts is not that surface).
- **Nothing is a wall.** 304 gaps touched by a verb, drifting ledges swept at 12
  phases of their cycle from the worst footing, updraft help switched off for the
  audit: zero uncrossable. `driftAmp` ships at 4.0 u and the first wall appears
  between 12 and 16.
- The teaching order is **gift first**: updraft at a median of 195 m, drift at
  345, the crumbling hold at 953. That last one needed `verbs.crumbleFrom`,
  because ASH is biome 0 and on the plain threshold 7 towers of 18 introduced
  the hold that takes the floor away before the column that gives reach.
- CINDER and GLACIER carry no verb, on purpose. Six special cases in a 900 m lap
  is not variety, it is noise.

**And it found a real bug on the way through.** BLOOM's ledges move, and the aim
arc did not know that — `predict` runs the integrator many times inside one
aiming frame while `_stepVerbs` moves the tower once per tick, so the preview
froze the world while the flight moved the ledge underneath it. **71.8% of
drifting ledges got an arc that lied.** Acceptance test 2 asserts exactly this
property, reported 0.000 cm, and passed throughout, because its 94 launches all
land on ledges that stand still. Fixed with `Sim.driftXAt` and a clock on every
body; 0 of 272 after, with the gate asserting the ledge really moved so the pass
cannot be vacuous.

**Still open from this item:** the 100 m separation rule is satisfied by the
biome layout rather than enforced by a check, and no human has played a
crumbling hold — `crumbleMs` at 900 is a judgement, not a measurement.

---

## 8 — Ghosts and milestones. GHOST DONE — `cairn-feel-check.mjs` 12-14

**The ghost is built, and it races your JUMPS rather than your clock.** At your
seventh launch it stands where your best self stood at its seventh. A race
against real seconds is the one shape this game cannot take — aiming dilates
time on purpose and the loop is deliberation, so a clock ghost would be decided
by how long you thought rather than how well you jumped, and would pressure the
player out of the behaviour the game exists to reward. DECISIONS §33.

Its whole path stays valid forever because only a run that SET the record
replaces it, and such a run finishes at or below the new best — so every ledge it
touched is stable ground from then on. Which gives it its ending for free: it
runs out exactly at the record height and leaves you at the frontier.

**Milestones are NOT built.** The remaining half of this section — cosmetic
procedural shard variants at meaningful heights and death counts — is untouched.

### The brief, as it stood

Replay the best run as a translucent racer on the same seed (free content,
cheap). Purely cosmetic procedural shard variants at meaningful heights and
death counts — **no currency, no shop, no timers, no ads**, nothing that
cheapens the tone.

---

## Standing engineering debts

Small, but they will bite:

- **No 4× throttled mobile profile has ever been run.** Test 4 measures CPU
  only and says so. The debug overlay (triple-tap top-left) is the only place a
  real number exists.
- **No heap profile of the frame loop.** Pools exist for particles, rings,
  trail, dust and solids, and scratch bodies are allocated once — designed for,
  never verified.
- **Persistence has a schema version but no migration path and no corruption
  recovery.** Losing a player's tower is the worst possible bug in this game.
  Write the backup and the recovery before the format ever changes.
- **`Store` keeps the most recent 600 corpses.** Fine today; decide what
  Monument View does at 5,000.
