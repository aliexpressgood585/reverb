#!/usr/bin/env node
/**
 * CAIRN — a session, photographed. For eyes, not for a gate.
 *
 *   npm run build && node scripts/cairn-playthrough.mjs
 *
 * Every other script here answers a question with a number. This one answers
 * the question no number has answered and no bot can: WHAT DOES IT LOOK LIKE TO
 * PLAY. Eleven suites are green and the one thing standing between this game and
 * knowing whether it is any good is that nobody has watched it happen.
 *
 * It is not a substitute for a person holding a phone. It cannot be bored,
 * confused, delighted or stuck. What it can do is put the frames a player would
 * actually see in front of somebody who can be all four.
 *
 * HOW IT PLAYS. Launches are chosen in-page by sweeping `predict()` for a shot
 * that lands higher — the same function the aim preview draws — and fired
 * through `sim.launch`. The thumb path is deliberately NOT used: acceptance
 * tests 10 and 11 already prove a real drag aims and fires, and reproducing the
 * pixel-to-velocity inverse here would be a second copy of `input.js` that could
 * drift from it. What is under review is the picture, and the picture does not
 * care where the velocity came from.
 *
 * Frames are captured at the moments that matter rather than on a timer: the
 * opening view, the first death, the first time the player stands on their own
 * body, the gap that leaves the on-ramp, an approach to a landmark, and the
 * monument at the end.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const PORT = 4206;
const OUT = 'shots/play';
mkdirSync(OUT, { recursive: true });

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

console.log('CAIRN playthrough — frames a player would see\n');

/** Install the in-page driver: one launch, flown to a stop, reporting what happened. */
await page.evaluate(() => {
  const { sim, predict, FEEL, update } = window.CAIRN;
  const DEG = Math.PI / 180;
  const arc = [];

  /** The best landing launch from where the body stands, or a committed throw. */
  window.__aim = () => {
    const b = sim.body;
    let best = null, bestY = -Infinity;
    for (let a = 30; a <= 150; a += 3) {
      for (let sp = FEEL.launch.maxSpeed; sp >= FEEL.launch.minSpeed; sp -= 6) {
        const vx = Math.cos(a * DEG) * sp, vy = Math.sin(a * DEG) * sp;
        const land = predict(sim, vx, vy, arc);
        if (!land) continue;
        const top = land.y + land.hh;
        if (top > b.y + 1 && top > bestY) { bestY = top; best = { vx, vy }; }
      }
    }
    // Nothing lands: throw it, which is what a player does and what leaves the
    // body that becomes the next step.
    if (!best) {
      const s = b.x < 50 ? 1 : -1;
      best = { vx: s * Math.cos(52 * DEG) * FEEL.launch.maxSpeed,
               vy: Math.sin(52 * DEG) * FEEL.launch.maxSpeed, thrown: true };
    }
    return best;
  };

  // A HAND, NOT A SOLVER.
  //
  // The first version of this swept for the best landing launch and fired it
  // exactly, so across 140 jumps it never missed, never died and never stood on
  // a corpse — and the session it photographed had no first death and no
  // premise in it. A playthrough of a game about dying, with no deaths in it,
  // is not a playthrough. These are the average model's numbers from
  // cairn-balance.mjs: about three degrees of angular slop and five and a half
  // percent of power, which is what a thumb is worth.
  const ANG_SD = 3.2, POW_SD = 0.055;
  let rs = 0x2f6e2b1;
  const rnd = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return (rs % 100000) / 100000; };
  const gauss = () => {
    const u = Math.max(1e-9, rnd());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };

  /** Fire and run the REAL loop until the body is at rest or the death is over. */
  window.__jump = () => {
    const before = sim.deaths;
    const aimed = window.__aim();
    let sp = Math.hypot(aimed.vx, aimed.vy);
    let ang = Math.atan2(aimed.vy, aimed.vx) + gauss() * ANG_SD * DEG;
    sp = Math.min(FEEL.launch.maxSpeed,
      Math.max(FEEL.launch.minSpeed, sp * (1 + gauss() * POW_SD)));
    const shot = { vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, thrown: aimed.thrown };
    sim.launch(shot.vx, shot.vy);
    for (let i = 0; i < 1200; i++) {
      update(1 / 60);
      if (sim.deaths > before) {
        // STOP ON THE DEATH, not after it. The caller may want to photograph
        // the body freezing at the apex — which is the single image this game
        // is about — and running the 900 ms transition here first meant the
        // frame that got captured was the respawn at 2 m with the record banner
        // up. Honest, but not the picture the caption promised.
        return { died: true, thrown: !!shot.thrown };
      }
      if (sim.body.grounded && i > 20) {
        return { died: false, onCorpse: !!(sim.body.standing && sim.body.standing.corpse),
                 y: sim.body.y };
      }
    }
    return { died: false, stalled: true, y: sim.body.y };
  };
});

const shots = [];
async function shot(name, note) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  shots.push([name, note]);
  console.log(`  ${name.padEnd(26)} ${note}`);
}

// A real tap starts it, the way a thumb does.
await page.touchscreen.tap(195, 620);
await delay(500);
await shot('01-opening', 'the first thing anyone sees, before they have moved');

// Play. Stop at each moment worth looking at, once.
let firstDeath = false, firstCorpse = false, sawLandmark = false;
for (let jump = 0; jump < 140; jump++) {
  const r = await page.evaluate(() => window.__jump());

  if (r.died && !firstDeath) {
    firstDeath = true;
    await shot('02-first-death', 'the instant it freezes — this is the whole game');
    // Then let the transition run, so the banner and the return to base are
    // seen too. They are a different frame and deserve their own.
    await page.evaluate(() => {
      for (let j = 0; j < 110; j++) window.CAIRN.update(1 / 60);
    });
    await shot('02b-back-at-the-base', 'the record banner that does not stop you');
  } else if (r.died) {
    await page.evaluate(() => {
      for (let j = 0; j < 110; j++) window.CAIRN.update(1 / 60);
    });
  }
  if (r.onCorpse && !firstCorpse) {
    firstCorpse = true;
    await shot('03-standing-on-yourself', 'the premise, happening');
  }
  if (!sawLandmark && !r.died) {
    const near = await page.evaluate(() => {
      const { sim, camera } = window.CAIRN;
      const m = window.CAIRN.landmarkOf(Math.floor(sim.body.y / 150), sim.world.seed);
      return Math.abs(m.y - camera.y) < 60 && sim.body.y > 60 ? Math.round(m.y) : 0;
    });
    if (near) {
      sawLandmark = true;
      await shot('04-inside-a-structure', `climbing through the landmark at ${near} m`);
    }
  }
  if (jump === 40) await shot('05-mid-session', 'forty jumps in — how busy the screen gets');
}

// What the aim looks like when the body it would leave is worth leaving.
//
// The state has to be forced back to PLAYING first. The monument-discovery
// nudge fires on record deaths, and it fired during this session — so the first
// version of this frame drew a forced aim over a pulled-back camera with the
// share chip up, which is a state the game cannot reach (the monument locks
// input). A screenshot has to enter the state it claims to show, the same as a
// test does.
await page.evaluate(() => { window.CAIRN.monument(false); });
await delay(1200);
await page.evaluate(() => {
  const { sim, predict, FEEL, renderer, camera, ui, input } = window.CAIRN;
  camera.mon = 0; camera.monTarget = 0;
  document.getElementById('monshare').className = '';
  const DEG = Math.PI / 180;
  const arc = [];
  // Find a launch that dies somewhere that buys a ledge, and hold the aim there.
  for (let a = 40; a <= 140; a += 2) {
    for (let sp = FEEL.launch.maxSpeed; sp >= FEEL.launch.minSpeed; sp -= 4) {
      const land = predict(sim, Math.cos(a * DEG) * sp, Math.sin(a * DEG) * sp, arc);
      if (land) continue;
      if (sim.predictPeak.dies && sim.predictPeak.gains) {
        input.arc = arc.slice();
        input.aiming = true;
        input.landing = null;
        renderer.draw(sim, camera, input, ui, 1 / 60, false);
        return;
      }
    }
  }
});
await shot('06-the-body-that-buys', 'the ghost in the living accent — a death worth taking');

// The monument, which is the share image.
await page.evaluate(() => window.CAIRN.monument(true));
await delay(2600);
await shot('07-monument', 'everything this session left behind');
await page.evaluate(() => window.CAIRN.monument(false));

const state = await page.evaluate(() => ({
  best: Math.round(window.CAIRN.sim.best),
  deaths: window.CAIRN.sim.deaths,
  bodies: window.CAIRN.sim.world.solids.filter((s) => s.corpse && s.live).length,
  held: [...window.CAIRN.sim.claimed],
}));
console.log(`\n  session: ${state.deaths} deaths, best ${state.best} m, ` +
  `${state.bodies} bodies standing, landmarks held [${state.held}]`);
if (errors.length) console.log(`  page errors: ${errors.join(' | ')}`);
console.log(`\n  ${shots.length} frames in ${OUT}/`);

await browser.close();
shutdown();
