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

## 2 — The reachability solver

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

## 3 — The first sixty seconds, choreographed and instrumented

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

## 5 — Daily Climb

One seed per UTC date, identical for everyone, one tower per day, separate from
endless. The single highest-value retention feature in the brief — but it ranks
below balance because a daily challenge on an unbalanced world is a daily
reminder that the game is easy.

**Done when:** it rolls correctly across a UTC midnight boundary from at least
three timezones, and the share card carries the date-seed so a recipient plays
the identical climb.

---

## 6 — Monument View

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
