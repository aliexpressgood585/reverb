# REVERB — marketing copy

## Short description (itch.io tagline, ≤160 characters)

> A stealth game played in total darkness. Sound is the only light — and the
> only light is you giving yourself away.

Alternates, if a shorter field is needed:

- *You can only see what makes a noise. So can they.* (48)
- *The darkness is absolute. Every sound draws the room for a quarter of a second.* (79)
- *Make no sound.* (14)

---

## Five selling points

1. **The audio system is the renderer.** Not a metaphor. Every sound in REVERB
   emits an expanding spherical wavefront that lights the geometry it crosses
   and then dies. There is no ambient light, no torch, no flashlight battery to
   find. If you can see something, something made a noise.

2. **Your only light source is the thing that gets you killed.** The creatures
   in the station are blind and hunt entirely by ear. Every step you take draws
   the floor for you *and* draws you for them. Walking is a decision. Running is
   a confession.

3. **Firing your weapon is a tactical failure.** One shot detonates the whole
   room in white — the clearest look you will ever get at where you are, and the
   loudest thing that has ever happened to you. Every level is scored on time,
   shots fired, and total noise made. Clearing one without firing reads
   `UNHEARD`.

4. **Every surface is an acoustic decision.** Concrete, tile, brushed steel,
   standing water, track ballast, and one strip of rotted carpet that swallows
   both light and sound. Water is loud and beautiful; ballast is the worst
   ground in the station; carpet is the quiet road, if you can find it in the
   dark.

5. **Nothing in it was downloaded.** No models, no textures, no audio files, no
   web fonts. The geometry is authored in code, the surfaces are procedural
   shaders, and every sound — including the convolution reverb, whose impulse
   response is generated per level so a tunnel rings for four seconds and a
   cupboard does not — is synthesised at runtime in the browser. It loads
   instantly and it runs on a tab.

---

## Long description (itch.io page)

**Headphones. Lights off. Make no sound.**

The station has been dark for a long time. Not dim — dark. There is no ambient
light down here, nothing glowing on the walls, no torch in your hands. When it
is quiet, your screen is black. Actually black.

Then you take a step, and for a quarter of a second you see a ring of tile
racing away from your foot, breaking over a bench, dying against a pillar
fourteen metres out. Then it's gone, and what's left is a fading impression of a
room you now have about three seconds to remember.

That is the whole game. Every sound is a light. There is nothing else.

**A drip from the ceiling** paints a small cyan arch and tells you the tunnel
turns left. **A stone thrown into the dark** lights a corner you were never going
to reach, and pulls whatever is listening toward it. **A gunshot** blows the
entire room open in searing white — the single clearest view you will ever
get — and brings everything alive in it directly to you, at a run.

The things down here are blind as well. They have no eyes; they have four states
and very good hearing. A **Stalker** patrols and chases. A **Screamer** does what
its name says and calls the rest of the level to your position. A **Sentinel**
does not patrol at all — it stands in the dark with two flat plates canted off
its skull and does not move until it is sure, which makes it the only one you
can walk straight into.

You never see them unless they are making noise. A creature that has stopped
moving is completely invisible, and you will find out about it the way you find
out about everything else in this game: too late, and by ear.

**Five descents.**
A **platform** with one thing on the tracks and drips that show you north.
A hall of **turnstiles** standing in water, where there is no dry way through,
only a quieter one.
A **tunnel** floored with ballast — the loudest ground in the station — with
three Sentinels standing in it.
A **maintenance** level where the plant runs on a clock, and the only way across
is inside the noise it makes.
And **the deep**: an open cavern with nothing in it to stop sound, where
everything hears everything.

There is no HUD. No health bar, no ammo counter, no crosshair, no numbers
anywhere on the screen. When you're hurt, your own heartbeat becomes a light
source — it shows you the room, and it shows the room you. When you're out of
ammunition, you hear a dry click. That's the whole interface, plus one hairline
arc at the bottom of the frame telling you how far the sound you just made
travelled.

No music, either. The soundtrack is a low electrical hum, water, the building
settling, and occasionally a train passing somewhere overhead that shakes the
whole station and lights it end to end for one second. Silence is the score.

Runs in the browser. Nothing to install. Headphones are not optional — the
spatial audio is your primary sense, and playing on laptop speakers is playing
with one eye closed.

**Make no sound.**

---

### Store metadata

- **Genre:** Stealth / Horror / Experimental
- **Tags:** `stealth` `horror` `atmospheric` `first-person` `dark` `audio`
  `minimalist` `procedural` `webgl` `singleplayer`
- **Platform:** Browser (WebGL2). Keyboard + mouse.
- **Input:** WASD, Shift to sneak, Ctrl to crouch, Space to run, Q to throw,
  left mouse to fire, P for photo mode.
- **Accessibility note:** the game is unplayable without audio and unplayable
  without a monitor that can render deep black. It asks for a dark room. That is
  a deliberate cost of the premise, and it is worth stating plainly on the page
  rather than letting people discover it.
- **Length:** 30–50 minutes for a first run; considerably longer to clear all
  five levels `UNHEARD`.

### Screenshot order for the store page

1. `04-walking` — the wavefront line sweeping the platform tile, a creature far
   down the track bed in its own orange rings
2. `08-enemy` — a Stalker caught mid-stride, hunched, lit only by the noise it
   is making
3. `10-the-deep` — a gunshot opening the causeway, black water either side,
   something standing in the distance that just heard it
4. `07-gunshot` — the whole room, white, for a quarter of a second
5. `09-tunnel` — ballast lit up and a Sentinel you can only see as a hole in the
   light, because it has not moved
6. `05-imprint-only` — the room as memory, almost gone
7. `01-title` — MAKE NO SOUND

Files are in `docs/screenshots/`, generated by `node scripts/capture.mjs`.
Press `P` in game for a clean high-resolution grab with the interface removed.
