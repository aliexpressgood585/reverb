# CAIRN — where the product stands, and what is left

Written for the owner. Everything here is a measured state, not a plan of
intentions. If a line has a number next to it, a script produces that number and
`npm run <name>` re-produces it.

---

## The one-sentence pitch

**You climb a tower, and every death leaves a body that is solid.** So the game
is not "jump higher" — it is *deciding where to die*, because your own corpse is
the next step. The aim preview draws the body you are about to become, and
lights it up when that body would buy you a ledge you cannot otherwise reach.

That sentence is now true in the product, not just in the design document. It
was not true two days ago: the mechanic existed and the game never said it, and
a new player met it on average at 234 m — past where most of them stop playing.

---

## The two numbers that are a contract

Never to be broken by any change, and re-run before every push.

| | gate | now | how |
|---|---|---|---|
| gaps with no route, even with a body | **0.00%** | **0.00%** over 4,541 gaps, 100% DIRECT, no dead ends | `npm run reach` |
| landings on one of your own bodies | **≥5%** | **7.79%** of 36,611 | `npm run bodies` |

A real player got stuck three times — at 391 m, 481 m and 567 m — before the
first of these existed. They are not metrics.

## The suites

| command | what it holds | state |
|---|---|---|
| `npm run accept` | 14 acceptance tests: determinism, arc honesty, tunnelling, colour, death→play, save, input, difficulty | 14/14 |
| `npm run feel` | momentum, close calls, monument discovery | 11/11 |
| `npm run landmarks` | structures are decoration only; the secret is aimable and not accidental | 8/8 |
| `npm run hook` | the premise arrives on the on-ramp | 59/60 towers |
| `npm run reach` / `npm run bodies` | the two contract numbers | pass |

---

## What shipped, and what it measurably bought

**The premise arrives at 75 m instead of 234 m.** The gap that leaves the
on-ramp is a constructed hard gap by promise rather than by roll. Of novices who
reach that perch, **92% cross it by standing on a body left in the gap** — 71%
before. The number who never needed a body there fell from 13 in 60 to 4.

**Death stopped reading as failure.** The aim preview switches from the gold of
memory to the living accent when the body would put a ledge in reach that this
perch cannot reach, and rings the ledge it buys. The death that follows adds a
rising fifth under the collapse.

**The tower has nouns.** One structure per biome — a collapsed stair, a lattice
mast, a root system, a chain into the dark, a furnace mouth, a frozen fall — at
the centre of each band, so the first is at 75 m and stands in the opening view
from the ground. Pure decoration: 61 ledges over 1,200 m rebuild byte-identical
from the seed with them present.

**Six secrets nobody explains.** Leave a body inside the heart of a structure
and it answers, permanently, saved. 4 of 4 hearts are reachable by a real launch
that dies there; **1 accidental claim in 114 untargeted deaths**. The key is the
ghost preview, and nothing points at it.

**Momentum and close calls.** Clean landings widen the light, lengthen the trail
and open the audio bed — never a bar, never a number. 84.8% of landings are
clean, mean streak 4.72. A near-lip landing dilates time and breaks the streak,
and both are the same condition computed once so they cannot disagree.

**The monument shows itself.** Two fingers pulls the camera back to the whole
lifetime tower, and nobody would ever find that gesture, so on record-setting
deaths 1, 4 and 10 the game opens it. The first time the player opens it with
two fingers of their own, the nudges stop forever.

---

## What is NOT done, honestly

**Target 3 of the balance brief does not hold and will not.** "An expert passes
600 m, but not on a first attempt" — they pass on 78.5%. The only knob that
meets it takes the route audit from WALL 0.00% to **17.64%, 653 dead ends, the
first at 131 m**, which is the exact mechanic that stranded a real player. The
wall-free knob moves it only to 57.5% and drags body landings toward the 5%
gate. A third axis — time, via crumble grace that tightens with height — moves
it to 68% and is wall-free. Priced in full in `BALANCE.md`.

**No human has played the retuned tower.** Three bots with gaussian error are
not three people. Specifically unmeasurable here: whether anyone discovers the
two-finger gesture, whether the secret is *fun* to hunt, and whether the
difficulty reads as fair. All three need someone with the phone in their hand.

**Other players' towers.** The highest-impact idea not built — climbing through
a graveyard of strangers who failed on the same daily seed. It needs a server,
which is a decision about money and privacy, not a coding task.

---

## The path to a listing

`BLOCKED.md` is the authority and nothing in it is a code problem. In short:

1. **The Android SDK cannot be installed in this environment** — `dl.google.com`
   is refused by the egress proxy. The Capacitor project, manifest, icons,
   splash, Gradle config and signing block are all written and committed; the
   one unrun step is `./gradlew bundleRelease` on any machine with Android
   Studio. About 20 minutes.
2. **A Play developer account** — US$25 once, plus identity verification, plus
   Google's 12-tester rule for new personal accounts. Longest pole; start it
   first.

Store assets are built and current: eight 1080×1920 screenshots captured from
the real game (`npm run store`), a 1024×500 feature graphic, a 512 icon, and
listing copy in English and Hebrew under `store/`.
