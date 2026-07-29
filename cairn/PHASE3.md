# CAIRN — what to build next, ranked by impact

Ranked by *what changes whether anyone plays this twice*, not by what is
interesting to build. Each item says what it is, why it ranks there, and what
"done" means in a way that can be measured.

Before starting any of it, read `AUDIT.md` for the honest state and
`DECISIONS.md` for the eighteen calls already made — several of these ideas have
already been tried and rejected once, with reasons.

---

## 1 — Balance. DONE — see `BALANCE.md`

Measured, retuned and re-measured across 30,000 climbs. Three of the four
targets below hold outright; the second holds to about attempt 30 and then
flattens, for a reason recorded in `BALANCE.md` rather than smoothed over. The
brief as originally written follows, unchanged, because the finding was worse
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

## 2 — The reachability solver. PARTLY DONE — `scripts/cairn-reach-check.mjs`

The audit exists and found a real bug: overreach gaps were being clamped back
inside the 100 u column and coming out crossable, so the corpse mechanic fired on
2.2% of gaps against a knob set for 27%. Overreach is now vertical, which no
column width can defeat. See BALANCE.md.

Not done: the solver does not run inside generation and regenerate a bad chunk,
and **10.4% of gaps above 481 m still have no route with one body.** Two-corpse
routes are untested.

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

## 4 — Momentum and close calls

The loop has no voice saying "you're doing well" or "don't blow it now".

- **Momentum:** consecutive clean landings brighten the player's light, lengthen
  the trail, enrich the audio bed and add a small launch bonus. Resets on any
  sloppy landing. **Never draw it as a bar** — it is expressed entirely through
  light, sound and feel.
- **Close calls:** passing within 2 u of a fatal drop triggers a brief time
  dilation and a low swell. This manufactures the memory of the moment, which is
  what people actually retell.

Cheap to build, disproportionate effect on how a run *feels* to have played.

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

Still open: **the gesture is not discoverable.** Two fingers is the only input
that cannot collide with aiming — a swipe down IS a launch downward in a
direct-aim game — but nothing teaches it, and this game's rule is that nothing
is taught with text. Unsolved, not overlooked.

### The brief, as it stood

Pinch or swipe-down to pull all the way back to the whole lifetime tower, every
corpse, from the base. Slow, cinematic, no HUD.

This is the emotional payoff **and** the primary share surface — the one image
that explains the game in three seconds without a word. It ranks here rather
than higher only because it shows off a tower that is not yet hard to build.

**Done when:** 200+ corpses render at 60 fps on a real phone and a poster
exports in under 2 s.

---

## 7 — The four biome verbs

ASH crumbling holds · SIGNAL updrafts · BLOOM drifting platforms · VOID darkness
beyond the player's own light. One per biome so each is learned in isolation,
and **never two new verbs within 100 m of each other**.

Deliberately low. New verbs are what a designer reaches for when the core loop
feels thin — but this loop is thin because it is *too easy*, not because it is
too simple. Fix the curve first, or you will be balancing four systems instead
of one.

---

## 8 — Ghosts and milestones

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
