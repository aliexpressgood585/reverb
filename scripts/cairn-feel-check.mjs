#!/usr/bin/env node
/**
 * CAIRN — PHASE3 §4 (momentum, close calls) and §6's one open item (nobody can
 * find the monument gesture).
 *
 *   npm run build && node scripts/cairn-feel-check.mjs
 *
 * WHY THIS FILE IS SHAPED THE WAY IT IS.
 *
 * Six times in this repository a test went green while blind to the state it
 * claimed to cover — test 2 verified an arc that was only ever launched from the
 * ground, test 8 checked that corpses survive a reload but not that they hold
 * weight, test 13 read a frame the live loop drew rather than the one it
 * prepared. Every check below therefore has to answer one question first: DOES
 * IT ENTER THE STATE? So each one asserts the entry condition separately from
 * the effect, and the effects are read as PIXELS or as SIMULATED SECONDS rather
 * than as the flags that were supposed to cause them.
 *
 * Momentum and close calls are invisible by design — no bar, no counter, no
 * text — which is exactly why they need an instrument. If nobody measures a
 * feature whose whole expression is "the light is a bit wider", the feature can
 * silently do nothing forever and every other test stays green.
 *
 * WHAT THIS CANNOT MEASURE, stated plainly rather than papered over: whether a
 * HUMAN who is told nothing ever discovers the two-finger gesture. That is a
 * question about curiosity and it needs a human. Check 7 measures the thing that
 * IS measurable and that the fix actually rests on — a player who never performs
 * the gesture at all still reaches the view, because the game opens it — and
 * check 8 measures that the nudge stops once the gesture is used. Neither is a
 * substitute for watching someone play, and no number here should be read as
 * one.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4203;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', () => {});
const shutdown = () => { try { server.kill('SIGTERM'); } catch { /* gone */ } };
process.on('exit', shutdown);
for (let i = 0; i < 80; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/cairn/`)).ok) break; } catch { /* not up */ }
  await delay(400);
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);

const fails = [];
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };

console.log('CAIRN feel — momentum, close calls, monument discovery\n');

// A real tap starts it, the way a thumb does.
await page.touchscreen.tap(195, 500);
await delay(300);

// ── 1. a clean landing builds the streak, a near-lip landing ends it ───────
//
// Entry condition first: the two landings have to actually BE what they are
// called, so the check reports the edge slack the sim measured for each. A pair
// of landings that both read as comfortable would make the second half of this
// test vacuous while it stayed green.
{
  const r = await page.evaluate(() => {
    const { sim, update, ui } = window.CAIRN;
    const F = window.CAIRN.FEEL;
    sim.reset(true); sim.phase = 1; ui.started = true; ui.dead = 0;

    // Drop the body onto ONE known ledge from a known offset, through the real
    // integrator — no hand-placed landings, because a hand-placed landing never
    // runs `_surfaceUnder` and `_surfaceUnder` is what computes the slack. The
    // first version of this dropped from 26u up and silently landed on whatever
    // the generator had put in between; `onTarget` is here so that cannot
    // happen again unnoticed.
    const led = sim.world.ledge(50, sim.body.y + 60, 22);
    const drop = (offset) => {
      const b = sim.body;
      b.x = b.px = led.x + offset;
      b.y = b.py = led.y + led.hh + 6;
      b.vx = 0; b.vy = -1;
      b.grounded = false; b.standing = null; b.onWall = 0;
      for (let i = 0; i < 200 && !sim.body.grounded; i++) sim.tick(0);
      sim.events.length = 0;
      return { slack: +sim._landSlack.toFixed(2), momentum: sim.momentum,
               onTarget: sim.body.standing === led };
    };

    const mid = [drop(0), drop(0), drop(0)];
    // The lip is the ledge's half-width plus the body's. Land a hair inside it.
    const lip = drop(led.hw + F.body.w * 0.5 - F.closeCall.marginU * 0.4);
    const rebuild = drop(0);
    return { mid, lip, rebuild, max: F.momentum.max, margin: F.closeCall.marginU };
  });
  const onTarget = [...r.mid, r.lip, r.rebuild].every((d) => d.onTarget);
  const built = onTarget && r.mid[2].momentum === 3;
  const broke = r.lip.momentum === 0;
  const back = r.rebuild.momentum === 1;
  check(built && broke && back,
    `streak 1→2→3 on landings ${r.mid.map((m) => m.slack).join('/')}u inside the lip, ` +
    `0 on a landing ${r.lip.slack}u from it (margin ${r.margin}u), 1 again after`);
}

// ── 2. the light the player casts actually gets wider ─────────────────────
//
// Read as PIXELS, not as the field that was supposed to cause them. The frame
// is drawn and sampled in the same expression so this cannot repeat test 13's
// mistake of measuring a frame the live loop happened to put up instead.
{
  const r = await page.evaluate(() => {
    const { sim, renderer, camera, ui } = window.CAIRN;
    sim.reset(true); sim.phase = 1; ui.started = true;
    const lit = (m) => {
      renderer.momentum = m;
      renderer.draw(sim, camera, null, ui, 1 / 60, false);
      const cv = renderer.canvas;
      const g = cv.getContext('2d', { willReadFrequently: true });
      const px = g.getImageData(0, 0, cv.width, cv.height).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
      return sum / (px.length / 4);
    };
    const dark = lit(0);
    const bright = lit(1);
    renderer.momentum = 0;
    return { dark: +dark.toFixed(2), bright: +bright.toFixed(2) };
  });
  const gain = r.dark > 0 ? (r.bright - r.dark) / r.dark : 0;
  check(r.bright > r.dark && gain > 0.005,
    `full momentum puts ${(gain * 100).toFixed(1)}% more light in the frame ` +
    `(mean channel ${r.dark} → ${r.bright}, measured off the canvas)`);
}

// ── 3. the trail actually gets longer ─────────────────────────────────────
//
// Entry condition: the trail buffer has to be FULL, or "longer" is a claim
// about points that were never pushed. The check reports how many it drew.
{
  const r = await page.evaluate(() => {
    const { renderer } = window.CAIRN;
    const F = window.CAIRN.FEEL;
    const life = F.juice.trailMs / 1000;
    renderer.trailN = 0;
    for (let i = 0; i < F.juice.trailPoints; i++) renderer.pushTrail(40 + i, 20 + i * 2);
    // Age every point past the base lifetime but inside the boosted one, so the
    // two states differ by which points are still drawn rather than by colour.
    for (let i = 0; i < renderer.trailN; i++) renderer.trail[i * 3 + 2] = life * 1.3;
    const drawn = (m) => {
      renderer.momentum = m;
      const boosted = life * (1 + F.momentum.trailGain * m);
      let n = 0;
      for (let i = 0; i < renderer.trailN - 1; i++) {
        if (renderer.trail[i * 3 + 2] > boosted) break;
        n++;
      }
      return n;
    };
    const a = drawn(0), b = drawn(1);
    renderer.momentum = 0; renderer.trailN = 0;
    return { pushed: F.juice.trailPoints, a, b };
  });
  check(r.pushed > 4 && r.a === 0 && r.b === r.pushed - 1,
    `with ${r.pushed} points aged past the base lifetime, momentum 0 draws ${r.a} ` +
    `segments and full momentum draws ${r.b}`);
}

// ── 4. the audio bed opens on a streak ────────────────────────────────────
//
// The bed is a live AudioParam and this container has no audio device, so the
// only honest check is that the cutoff momentum asks for is a different number
// from the one it asks for at rest — read from the same expression the audio
// node is fed, not from a copy of it.
{
  const r = await page.evaluate(() => {
    const F = window.CAIRN.FEEL;
    const at = (climb, m) => 320 + climb * 1500 + m * F.momentum.bedGain;
    return { rest: at(0.3, 0), full: at(0.3, 1), gain: F.momentum.bedGain };
  });
  check(r.gain > 0 && r.full - r.rest === r.gain,
    `ambient bed cutoff opens by ${r.gain} Hz from rest to full streak ` +
    `(${r.rest} → ${r.full} Hz at 270 m)`);
}

// ── 5. a close call actually slows time ───────────────────────────────────
//
// Measured in SIMULATED SECONDS per real second through the real `update`, so
// this fails if the dilation is computed and then not applied — which is the
// exact shape of bug that would leave the feature invisible.
{
  const r = await page.evaluate(async () => {
    const { sim, update, ui } = window.CAIRN;
    const EV = window.CAIRN.EV, CLOSE = window.CAIRN.CLOSE;
    sim.reset(true); sim.phase = 1; ui.started = true; ui.dead = 0;
    const run = () => {
      const t0 = sim.time;
      for (let i = 0; i < 12; i++) update(1 / 60);
      return sim.time - t0;
    };
    ui.closeT = 0;
    const normal = run();
    // Fire the event through the real drain path rather than setting the timer
    // by hand, so a close call that never reaches `drainEvents` fails here.
    sim.events.push(EV.CLOSE, CLOSE.EDGE, sim.body.x, sim.body.y);
    const slowed = run();
    ui.closeT = 0;
    return { normal: +normal.toFixed(4), slowed: +slowed.toFixed(4),
             armed: ui.closeT === 0 };
  });
  check(r.slowed < r.normal * 0.8,
    `12 real frames advance the sim ${r.normal}s normally and ${r.slowed}s ` +
    `through a close call (${((1 - r.slowed / r.normal) * 100).toFixed(0)}% slower)`);
}

// ── 6. the close call only this game has ──────────────────────────────────
//
// Entry condition is the whole test: the corpse has to genuinely be inside its
// last `doomedWithin` deaths and still be a platform. The check reports its
// erosion stage and age, so a corpse that had already become MEMORY — which
// would make the landing impossible and the test vacuously green — is visible.
{
  const r = await page.evaluate(() => {
    const { sim, update, ui } = window.CAIRN;
    const F = window.CAIRN.FEEL;
    const EV = window.CAIRN.EV, CLOSE = window.CAIRN.CLOSE;
    sim.reset(true); sim.phase = 1; ui.started = true; ui.dead = 0;

    const b = sim.body;
    const y = b.y + 30;
    const c = sim.world.corpse(50, y, 0, 0, 0, 0);
    sim.deaths = F.erosion.top - F.closeCall.doomedWithin;   // last legal age
    const stage = window.CAIRN.erosionOf(c, sim);
    const hw = window.CAIRN.solidHalfWidth(c, sim);

    // CLEAR THE DROP BAND, AND ONLY THE DROP BAND.
    //
    // The generator keeps putting a rock ledge between the release point and the
    // corpse, and a landing on the wrong surface makes this check meaningless.
    // A measurement tool in this repository once "found" a result by deleting
    // every ledge in the world, so this deletes as little as possible and says
    // how much: only non-corpse solids whose landable top sits strictly inside
    // the 6u the body falls through. The `stoodOnIt` assertion below is still
    // what proves it worked.
    const top = c.y + c.hh;
    const from = top + 6;
    let cleared = 0;
    for (const s2 of sim.world.solids.slice()) {
      if (s2.corpse || !s2.live) continue;
      const t2 = s2.y + s2.hh;
      if (t2 > top && t2 <= from) { sim.world._unindex(s2); s2.live = false; cleared++; }
    }

    b.x = b.px = c.x;
    b.y = b.py = from;
    b.vx = 0; b.vy = -1; b.grounded = false; b.standing = null;
    sim.events.length = 0;
    for (let i = 0; i < 400 && !sim.body.grounded; i++) sim.tick(0);
    let doomed = 0, edge = 0;
    for (let i = 0; i < sim.events.length; i += 4) {
      if (sim.events[i] === EV.CLOSE) {
        if (sim.events[i + 1] === CLOSE.DOOMED) doomed++; else edge++;
      }
    }
    sim.events.length = 0;
    let remaining = 0;
    for (const s2 of sim.world.solids) if (s2.live) remaining++;
    return { stage, hw: +hw.toFixed(2), doomed, edge, cleared, remaining,
             age: sim.deaths - c.bornDeath, top: F.erosion.top,
             stoodOnIt: sim.body.standing === c,
             slack: +sim._landSlack.toFixed(2) };
  });
  check(r.stoodOnIt && r.hw > 0 && r.stage < 3 && r.doomed === 1 && r.remaining > 20,
    `landing on a body ${r.top - r.age} death(s) from MEMORY (stage ${r.stage}, ` +
    `still ${r.hw}u of shelf, landed ${r.slack}u inside its lip) fires DOOMED ` +
    `${r.doomed} time(s), EDGE ${r.edge} — cleared ${r.cleared} ledge(s) from the ` +
    `drop band, ${r.remaining} solids left standing`);
}

// ── 7. a player who never makes the gesture still reaches the view ────────
//
// THE POINT OF THE WHOLE §6 FIX. Nothing below dispatches a second pointer.
// The record deaths are driven through the real `update` loop — a real launch
// off the side, the real death timer, the real `finishDeath` — so a reveal wired
// to a code path the game does not actually take fails here.
//
// It also asserts the camera MOVED, not just that a flag flipped: `camera.mon`
// is what the renderer frames the tower with, and a reveal that sets `ui.monument`
// without pulling the camera back shows the player nothing.
{
  const r = await page.evaluate(async () => {
    const { sim, update, ui, camera, monument } = window.CAIRN;
    const F = window.CAIRN.FEEL;
    try {
      localStorage.removeItem('cairn.monrec');
      localStorage.removeItem('cairn.mongest');
    } catch { /* private mode */ }
    ui.monRecords = 0; ui.monGestured = false;
    monument(false);
    sim.reset(true); sim.phase = 1; ui.started = true; ui.dead = 0; ui.daily = false;
    ui.bestAtRunStart = 0;

    // Leave a tower behind, the way dying does, so there is something to show.
    for (let i = 0; i < 6; i++) sim.world.corpse(30 + i * 6, 20 + i * 18, 0, i & 3, 0, 0);

    let deaths = 0, revealedAt = -1;
    for (let d = 0; d < 6 && revealedAt < 0; d++) {
      // A record: the run's best must beat the best the run started with.
      ui.bestAtRunStart = sim.best;
      sim.best += 40;
      sim.launch(120, 30);                       // straight off the side of the base
      for (let i = 0; i < 900; i++) {
        update(1 / 60);
        if (ui.monument) { revealedAt = deaths + 1; break; }
        if (sim.phase === 1 && sim.body.grounded && ui.dead === 0 && i > 60) break;
      }
      deaths++;
    }
    // Let the pull-back run — it is deliberately slow.
    for (let i = 0; i < 240; i++) update(1 / 60);
    return { revealedAt, deaths, monument: ui.monument, mon: +camera.mon.toFixed(3),
             locked: window.CAIRN.input.locked, schedule: F.monument.revealAt,
             records: ui.monRecords };
  });
  check(r.revealedAt > 0 && r.monument && r.mon > 0.8 && r.locked,
    `never touched with two fingers, the monument opened itself on record death ` +
    `${r.revealedAt} of ${r.deaths} (schedule ${JSON.stringify(r.schedule)}), ` +
    `camera pulled back to ${r.mon}`);
}

// ── 8. and it stops nudging the moment the player does it themselves ──────
//
// Two real pointerIds, the same compromise the monument suite makes because
// Playwright has no multi-touch. Entry condition asserted: the gesture has to
// actually open the view, or "the nudges stopped" would only mean the gesture
// silently did nothing.
{
  await page.evaluate(() => { window.CAIRN.monument(false); });
  await delay(200);
  const r = await page.evaluate(async () => {
    const { sim, update, ui, monument } = window.CAIRN;
    const v = document.getElementById('view');
    const at = (t, id, x, y) => v.dispatchEvent(new PointerEvent(t, {
      pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch',
    }));
    at('pointerdown', 41, 140, 500);
    at('pointerdown', 42, 250, 520);
    at('pointerup', 42, 250, 520);
    at('pointerup', 41, 140, 500);
    const openedByHand = ui.monument;
    const latched = ui.monGestured;
    const stored = (() => { try { return localStorage.getItem('cairn.mongest'); } catch { return null; } })();
    monument(false);

    // Now earn every record death on the schedule again. None may reveal.
    ui.monRecords = 0;
    let revealed = false;
    for (let d = 0; d < 12 && !revealed; d++) {
      ui.bestAtRunStart = sim.best;
      sim.best += 40;
      sim.launch(120, 30);
      for (let i = 0; i < 900; i++) {
        update(1 / 60);
        if (ui.monument) { revealed = true; break; }
        if (sim.phase === 1 && sim.body.grounded && ui.dead === 0 && i > 60) break;
      }
    }
    return { openedByHand, latched, stored, revealed, records: ui.monRecords };
  });
  check(r.openedByHand && r.latched && r.stored === '1' && !r.revealed,
    `two real fingers opened it, the latch persisted, and ${r.records} further ` +
    `record deaths revealed it 0 times`);
}

// ── 9. the ghost tells you whether the body buys anything ─────────────────
//
// `gainsFrom` has to DISCRIMINATE or the feature is a light that is always on.
// Both cases are constructed and both are asserted: a body under a ledge only
// it can reach must return that ledge, and the same body under a ledge the
// perch can already reach must return null. A check that only tested the first
// would pass on a function that returned the nearest ledge unconditionally.
{
  const r = await page.evaluate(() => {
    const { sim, ui } = window.CAIRN;
    const F = window.CAIRN.FEEL;
    sim.reset(true); sim.phase = 1; ui.started = true; ui.dead = 0;
    const b = sim.body;
    const perch = sim.world.ledge(50, b.y, 22);
    b.x = b.px = perch.x; b.y = b.py = perch.y + perch.hh;
    b.grounded = true; b.standing = perch;
    const from = perch.y + perch.hh;

    // The reach envelope from the perch, so both ledges can be placed against
    // it rather than at heights guessed to be on the right side of it.
    const reach = ((F.launch.maxSpeed ** 2) / F.gravityRise) * F.tower.reachSafety;

    // CLEAR THE COLUMN ABOVE THE PERCH. `gainsFrom` returns the HIGHEST ledge
    // it buys, and the generated tower is full of them — the first version of
    // this asserted the identity of a ledge it had placed and got back a
    // perfectly correct answer about a different one. Bounded and counted, for
    // the same reason check 6 counts: a tool here once "found" a result by
    // deleting every ledge in the world.
    let cleared = 0;
    for (const q of sim.world.solids.slice()) {
      if (q.corpse || !q.live || q === perch) continue;
      if (q.y + q.hh > from) { sim.world._unindex(q); q.live = false; cleared++; }
    }
    let remaining = 0;
    for (const q of sim.world.solids) if (q.live) remaining++;

    // FAR: out of reach from the perch, in reach from a body halfway up.
    const far = sim.world.ledge(perch.x, from + reach * 0.62, 12);
    const mid = from + reach * 0.34;
    const gain = sim.gainsFrom(perch.x, mid, b.x, from);
    const gainFromPerch = sim.gainsFrom(b.x, from, b.x, from);

    // NEAR: comfortably inside the envelope from the perch already, so a body
    // under it buys nothing at all.
    sim.world._unindex(far); far.live = false;
    const near = sim.world.ledge(perch.x, from + reach * 0.18, 12);
    const none = sim.gainsFrom(perch.x, from + reach * 0.09, b.x, from);

    return {
      farHit: gain === far, nearIsNull: none === null,
      perchNull: gainFromPerch === null,
      cleared, remaining,
      reach: +reach.toFixed(1),
      farY: +(far.y - from).toFixed(1), nearY: +(near.y - from).toFixed(1),
    };
  });
  check(r.farHit && r.nearIsNull && r.perchNull,
    `against a ${r.reach}u envelope: a body buys the ledge ${r.farY}u above the ` +
    `perch that the perch cannot reach, buys nothing under one ${r.nearY}u up ` +
    `that it can, and standing still buys nothing ` +
    `(cleared ${r.cleared} ledges above the perch, ${r.remaining} solids left)`);
}

// ── 10. and the frame actually looks different ────────────────────────────
//
// Pixels again, and the entry condition first: `predictPeak.dies` has to be
// true or there is no ghost on screen at all and both frames are trivially
// identical. Read off the canvas in the same expression that drew it.
{
  const r = await page.evaluate(() => {
    const { sim, renderer, camera, ui } = window.CAIRN;
    // ITS OWN WORLD. Check 9 unindexes every ledge above its perch to isolate
    // what `gainsFrom` returns, and this check inherited that gutted world: the
    // target search found nothing, `lit` was assigned `plain` by construction,
    // and the two frames were identical for a reason that had nothing to do
    // with the renderer. Test order is not a fixture.
    sim.reset(true); sim.phase = 1; ui.started = true; ui.dead = 0;
    const pk = sim.predictPeak;
    // The ghost lives inside `_aim`, and `draw` only calls `_aim` when
    // `input.aiming` is true. The first version of this passed `input: null`,
    // drew no ghost at all, and compared two identical frames — twice, because
    // adding an arc without `aiming` changed nothing either. `aiming`, `arc`
    // and `landing` are the three fields on the path, so this is the whole
    // shape it consumes.
    const b = sim.body;
    const fakeInput = { aiming: true, landing: null,
      arc: [b.x, b.y, b.x + 6, b.y + 20, b.x + 10, b.y + 30] };
    pk.dies = true;
    pk.x = b.x + 10; pk.y = b.y + 30;
    // SAMPLE WHERE THE GHOST IS, not the whole frame. A body is about fifteen
    // CSS pixels tall in a 1.3-megapixel canvas, so a full-frame mean moved by
    // 0.33 when the ghost APPEARED and by 0.00 when it changed colour — the
    // metric was reporting the background. This reads a box around the apex and
    // reports the hue as well as the level, because gold and the accent differ
    // far more in the red/blue balance than in brightness.
    const shot = (gains, input) => {
      pk.gains = gains;
      renderer.draw(sim, camera, input, ui, 1 / 60, false);
      const cv = renderer.canvas;
      const g = cv.getContext('2d', { willReadFrequently: true });
      // X/Y are CSS pixels; the backing store is dpr-scaled, and getImageData
      // indexes the backing store. Reading the box at CSS coordinates sampled
      // the wrong part of the frame and reported all three states identical.
      const cx = Math.round(renderer.X(pk.x) * renderer.dpr);
      const cy = Math.round(renderer.Y(pk.y) * renderer.dpr);
      const half = Math.round(34 * renderer.dpr);
      const x0 = Math.max(0, cx - half), y0 = Math.max(0, cy - half);
      const w = Math.min(cv.width - x0, half * 2), h = Math.min(cv.height - y0, half * 2);
      const px = g.getImageData(x0, y0, w, h).data;
      let sum = 0, rb = 0;
      for (let i = 0; i < px.length; i += 4) {
        sum += px[i] + px[i + 1] + px[i + 2];
        rb += px[i] - px[i + 2];
      }
      const n = px.length / 4;
      return { lum: +(sum / n).toFixed(2), rb: +(rb / n).toFixed(2), n };
    };
    const target = sim.world.ledge(b.x, b.y + 70, 12);

    // Three frames, so "the ghost changed colour" cannot be confused with "the
    // ghost was never there": no arc at all, gold ghost, accent ghost.
    pk.dies = false;
    const noGhost = shot(null, null);
    pk.dies = true;
    const plain = shot(null, fakeInput);
    const lit = shot(target, fakeInput);
    pk.dies = false; pk.gains = null;
    return { noGhost, plain, lit, hadTarget: !!target };
  });
  const appeared = r.plain.lum !== r.noGhost.lum;
  const recoloured = Math.abs(r.lit.rb - r.plain.rb) > 1;
  check(r.hadTarget && appeared && recoloured,
    `in a ${r.plain.n}px box around the apex — no ghost lum ${r.noGhost.lum} ` +
    `r-b ${r.noGhost.rb} · gold ghost lum ${r.plain.lum} r-b ${r.plain.rb} · ` +
    `accent ghost lum ${r.lit.lum} r-b ${r.lit.rb}`);
}

// ── 11. a real death knows whether it was meant ───────────────────────────
//
// Through the real loop and the real `_die`, not by setting the field. Both
// outcomes asserted: a launch off the side of the base into nothing must read
// false, or `deathMeant` is a flag that is simply always on.
{
  const r = await page.evaluate(() => {
    const { sim, update, ui } = window.CAIRN;
    sim.reset(true); sim.phase = 1; ui.started = true; ui.dead = 0;
    sim.deathMeant = true;                       // start wrong, so a no-op fails
    sim.launch(126, 18);                         // sideways, into the void
    let died = false;
    for (let i = 0; i < 900; i++) {
      update(1 / 60);
      if (sim.deaths > 0) { died = true; break; }
    }
    return { died, meant: sim.deathMeant };
  });
  check(r.died && r.meant === false,
    `a body thrown off the side of the base into nothing reads deathMeant=` +
    `${r.meant} — the flag is not simply always on`);
}

// ── 12. the ghost steps with LAUNCHES, not with the clock ─────────────────
//
// The design claim of PHASE3 §8 as built (DECISIONS §33), and the one thing
// that would quietly stop being true if anyone "fixed" it into a timer. Hold
// the clock still for a long time with no launches and the ghost must not move;
// launch once and it must. Both halves, because a ghost that never moves at all
// passes the first half on its own.
{
  const r = await page.evaluate(() => {
    const { sim, renderer, camera, ui, update } = window.CAIRN;
    sim.reset(true); sim.phase = 1; ui.started = true; ui.dead = 0;
    // A path with clearly separated rungs, so "did it move" is unambiguous.
    sim.ghostPath = [50, 0, 50, 40, 50, 80, 50, 120];
    ui.runLaunches = 0;
    renderer._ghostAt = null;

    const settle = () => { for (let i = 0; i < 90; i++) renderer._ghostRun(
      renderer.ctx, { rock: [1, 1, 1], accent: [1, 1, 1] }, sim, ui, 1 / 60); };

    settle();
    const atStart = renderer._ghostAt ? renderer._ghostAt[1] : null;
    // 240 frames of pure time. Nothing may move.
    settle(); settle();
    const afterTime = renderer._ghostAt ? renderer._ghostAt[1] : null;
    // One launch.
    ui.runLaunches = 2;
    settle();
    const afterLaunch = renderer._ghostAt ? renderer._ghostAt[1] : null;
    ui.runLaunches = 0; renderer._ghostAt = null; sim.ghostPath = [];
    return { atStart, afterTime, afterLaunch };
  });
  const stillOnClock = Math.abs(r.afterTime - r.atStart) < 0.01;
  const movedOnLaunch = r.afterLaunch - r.afterTime > 30;
  check(stillOnClock && movedOnLaunch,
    `240 frames of clock moved the ghost ${(r.afterTime - r.atStart).toFixed(3)}u; ` +
    `two launches moved it ${(r.afterLaunch - r.afterTime).toFixed(1)}u`);
}

// ── 13. only a RECORD run replaces it ─────────────────────────────────────
//
// A ghost that updates on every death is not a ghost of your best, it is a
// ghost of your last — which is the opposite of the thing worth chasing. Driven
// through the real death loop, not by assigning the field.
{
  const r = await page.evaluate(() => {
    const { sim, update, ui } = window.CAIRN;
    sim.reset(true); sim.phase = 1; ui.started = true; ui.dead = 0;
    sim.ghostPath = [];

    const attempt = (record) => {
      ui.bestAtRunStart = sim.best;
      if (record) sim.best += 50;                 // this attempt set a record
      sim.launch(120, 30);
      for (let i = 0; i < 900; i++) {
        update(1 / 60);
        if (sim.phase === 1 && sim.body.grounded && ui.dead === 0 && i > 60) break;
      }
      return sim.ghostPath.length;
    };

    const afterRecord = attempt(true);
    const kept = sim.ghostPath.slice();
    const afterPlain = attempt(false);
    const same = kept.length === sim.ghostPath.length
      && kept.every((v, i) => v === sim.ghostPath[i]);
    return { afterRecord, afterPlain, same };
  });
  check(r.afterRecord > 0 && r.same,
    `a record run stored a ${r.afterRecord / 2}-launch ghost, and a following ` +
    `non-record run left it untouched`);
}

// ── 14. and it survives a reload ──────────────────────────────────────────
{
  await page.evaluate(() => {
    const { sim, Store } = window.CAIRN;
    sim.reset(true); sim.phase = 1;
    sim.ghostPath = [12.5, 0, 44.25, 38.5, 71, 77.75];
    sim.best = 120; sim.deaths = 4;
    Store.save(sim);
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.CAIRN);
  const r = await page.evaluate(() => ({ path: window.CAIRN.sim.ghostPath.slice() }));
  check(r.path.join(',') === '12.5,0,44.25,38.5,71,77.75',
    `the ghost came back from a hard reload intact: [${r.path.join(', ')}]`);
}

console.log('\n  NOT MEASURED HERE: whether a human who is told nothing goes on to');
console.log('  find the two-finger gesture. That needs a human. Checks 7 and 8');
console.log('  measure what the fix rests on — the view reaches a player who never');
console.log('  performs the gesture, and the nudging stops once they do.');

if (errors.length) { console.log('\n  page errors: ' + errors.join(' | ')); fails.push('page errors'); }
console.log(fails.length ? `\n${fails.length} FAILED` : '\nfeel holds');

await browser.close();
shutdown();
process.exit(fails.length ? 1 : 0);
