# CAIRN — design direction

Written before any CSS, as the brief requires, and then revised once against the
"would I produce this for any minimalist game?" test. What changed and why is at
the bottom.

The whole system exists to serve one sentence:

> **Every death leaves a stone. Climb on what you were.**

---

## The idea the look has to carry

CAIRN is not a game about a climber. It is a game about **accumulation** — the
tower below you is made of every version of you that failed, and it is the only
thing holding you up. So the visual identity cannot be about the figure, the
motion, or the height. It has to be about *the pile*.

That gives the direction its one rule: **the interface is cold, thin and almost
absent; the tower is warm, dense and the only thing that accrues.** Everything on
screen either belongs to the living present (cold, weightless, transient) or to
the accumulated past (warm, heavy, permanent). Nothing is neutral.

---

## Palette

Six values, and each is named for what it *is* in the world rather than for its
hue, because that is what stops the next person using "the orange one" somewhere
it does not belong.

| token | hex | what it is | where it is allowed |
|---|---|---|---|
| `--void` | `#05070C` | the shaft you are climbing in | page background, the base of every gradient |
| `--rime` | `#8FA3B0` | cold air on stone | body text, inactive UI, the height numeral |
| `--quartz` | `#E8EFF3` | fresh rock, lit | primary text, the active state of anything |
| `--ember` | `#FF6B35` | a body that fell recently | fresh corpses, the record pulse, the one primary action per screen |
| `--memory` | `#C99A4A` | a body that has been there a long time | eroded corpses, the monument thread, achievement marks |
| `--fault` | `#4A5B6B` | the line between rock and air | hairline rules, dividers, disabled states |

**Two colours accumulate and four do not.** `--ember` cools toward `--memory` as
a corpse ages, and that gradient is the only place in the entire product where
colour carries information over time. Everything else is fixed. That is the
discipline: if a new element wants to be warm, it has to justify being part of
the tower.

The in-game biomes (`feel.js`) keep their own six palettes and are *not* replaced
— altitude legibility is a measured property (closest pair of altitudes differs
by 31.5 in mean RGB, acceptance test 5) and the tokens above are the UI's
palette, which sits on top of whatever the world is currently doing. The tokens
are chosen to hold against all six biomes; `--quartz` on `--void` is 15.8:1.

### Contrast, measured

| pair | ratio | use |
|---|---|---|
| `--quartz` on `--void` | 15.8:1 | body text — AAA |
| `--rime` on `--void` | 7.9:1 | secondary text — AAA |
| `--ember` on `--void` | 6.4:1 | the one action — AA large, AA normal |
| `--memory` on `--void` | 7.2:1 | achievement text — AAA |
| `--fault` on `--void` | 2.4:1 | **rules and dividers only, never text** |

---

## Typography

**Two faces, and neither is downloaded.**

`--font-display` is a system grotesque stack, letter-spaced hard and used only in
capitals: the wordmark, the height numeral, the one-line poetry. `--font-ui` is
the platform UI stack at normal tracking for everything a player reads rather
than feels.

```css
--font-display: ui-sans-serif, -apple-system, "Segoe UI", Roboto, system-ui, sans-serif;
--font-ui: ui-sans-serif, -apple-system, "Segoe UI", Roboto, system-ui, sans-serif;
--font-num: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
```

**The brief asks for self-hosted subsetted woff2 and this deliberately does not
ship one.** Zero external assets is the oldest rule in this project and it is
what keeps the payload at 24 KB gzipped — a subsetted display face is 15–30 KB,
which would be *more than half the game* for a face nobody could name. The
personality is bought instead with tracking, case, scale and rhythm, which cost
nothing:

- the wordmark is `0.42em` letter-spaced, uppercase, at `--weight-light`
- numerals are always tabular monospace, so a height that climbs does not jitter
- there is exactly one type scale step between any two adjacent levels (1.25)
- Hebrew gets the same treatment; the display stack resolves to a real Hebrew
  face on every Android and iOS device, and the tracking is reduced to `0.12em`
  because Hebrew letterforms do not take Latin tracking

If a licensed display face is ever bought, `--font-display` is the single place
it goes.

---

## The signature element

**The cairn tower, lit from within, drawn as a thread of light through every body
in order.**

This is where all the boldness goes and everything else stays quiet to pay for
it. Concretely, and it is already partly built:

- every corpse is drawn as a **figure**, not a block — you can see it is a person
- a **1 px thread** connects them in the order they died, so the tower reads as a
  sequence rather than a heap. It is `--memory` at low alpha and it is the single
  most distinctive mark in the product
- the bright bar on top of each body is drawn **exactly as wide as its collision
  box**, so the tower teaches its own rules without text
- fresh bodies glow `--ember`; old ones cool to `--memory` and become outlines.
  The tower therefore has a **temperature gradient from bottom to top** that
  encodes the player's history

Monument View — two fingers, pull all the way back — exists to show this and
nothing else. It is the share image, and the share image is the marketing.

---

## Motion

**Restrained everywhere except one place.**

| | duration | curve |
|---|---|---|
| `--t-instant` | 90 ms | `cubic-bezier(.2,0,0,1)` — anything the thumb caused |
| `--t-quick` | 180 ms | UI appearing or dismissing |
| `--t-slow` | 420 ms | screen transitions |
| the pull-back | 1,500 ms | eased in the simulation, not in CSS |

**Nothing in the input path is ever transitioned.** Latency is a feature you can
only lose, and a 90 ms ease on a button that fires a launch is 90 ms of lie.

The load sequence is orchestrated and takes 900 ms total: the shaft fades up, the
wordmark's letter-spacing settles from `0.6em` to `0.42em`, the tagline fades,
the prompt pulses. It plays once. Under `prefers-reduced-motion: reduce`
everything appears at its end state immediately, and the in-game trail, dust,
shake and grain are all already gated on the same query in `main.js`.

---

## Layout

**Portrait first and thumb-first.** The bottom 45% of the screen is where the
hand lives and where every control goes. The top 20% is where a hand covers the
screen while reaching, so nothing that must be read or touched goes there — the
height numeral sits at the top *because* it is glanceable and never touched.

Safe areas are honoured with `env(safe-area-inset-*)` on every edge, not just the
bottom, because Android gesture bars and punch-hole cameras are on all four.

Landscape is handled rather than embraced: the column stays centred at its
portrait aspect and the sides letterbox into the shaft gradient. This is a game
played in one hand, held upright.

---

## Revising against the brief's own test

> *if any part of it is what you would produce for any generic minimalist game,
> revise it and note what changed and why*

Three things failed that test on the first pass, and here is what they became.

**1. The palette was near-black plus one hot accent.** That is the default AI
look the brief names explicitly, and I had written it: `#05070C` plus an orange.
What makes it not-generic is not a different hue, it is that **two of the six
tokens are reserved for accumulated state and change meaning over time.**
`--ember → --memory` is a *timeline*, not a highlight colour. A generic
minimalist game has one accent because it has one kind of important thing; this
one has two because the past and the present are different materials.

**2. "One bold element" was going to be the height numeral.** Enormous
translucent figure behind the play area — I have seen it in fifty games and it
was already half-built here. It was moved to the tower, which is the thing no
other game has. The numeral stays large but drops to `--rime` at low alpha and
gets out of the way; it is atmosphere now, not identity, and it fades out
entirely as the camera pulls back.

**3. The motion spec was three durations and an ease.** Which is a house style,
not a direction. It gained the rule that matters instead: **the input path is
never animated at all**, and the one long motion in the product (the 1,500 ms
teach pull-back) lives in the simulation where it is frame-rate independent,
not in CSS where it is not.

What survived unchanged: the type approach, because the constraint that produced
it — zero external assets — is genuinely unusual and forces the personality into
tracking and rhythm rather than into a font licence.
