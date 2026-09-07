#!/usr/bin/env node
/**
 * CAIRN — the six frames the readability patch has to be judged on.
 *
 *   node scripts/cairn-shots.mjs
 *
 * Not a gate. This is the thing you OPEN, because every visual defect this
 * project has found was found by looking at a picture and none of them were
 * found by a passing test. The six states are the ones a reader can actually
 * form an opinion from: the way in, a body at rest, a body in flight, the
 * instant of contact, a stretch of tower, and the two shapes of screen the game
 * ships on.
 *
 * THE ONE RULE THAT MAKES THESE HONEST: a state is forced and photographed in
 * the SAME task. The page runs its own rAF loop, so anything set and then
 * awaited has already been overwritten by physics before the shutter opens —
 * this project has published a "player in flight" frame of a body standing
 * still on a ledge. Every shot below either drives the real input path or
 * freezes the loop first.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const PORT = 4246;
const OUT = 'shots/read';
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

/** @type {string[]} */
const problems = [];
let n = 0;

/**
 * @param {{name: string, width: number, height: number, mobile: boolean}} size
 */
async function run(size) {
  const page = await browser.newPage({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 2, isMobile: size.mobile, hasTouch: true,
  });
  // NO CONSOLE ERRORS is part of the brief, so it is collected here rather than
  // asserted somewhere the reader will not see it.
  page.on('pageerror', (e) => problems.push(`${size.name}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`${size.name}: console ${m.text()}`);
  });
  await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.CAIRN);
  await delay(700);

  const shot = async (name) => {
    await page.screenshot({ path: `${OUT}/${size.name}-${name}.png` });
    n++;
    console.log(`  ${OUT}/${size.name}-${name}.png`);
  };

  // 1. THE WAY IN. Straight off the load, animations settled.
  await shot('1-title');

  // A real tap, through the touchscreen, because a synthetic dispatch has
  // shipped a game that could not be started.
  await page.touchscreen.tap(size.width / 2, size.height * 0.62);
  await delay(400);

  // 2. STANDING. A tower under the player, the loop frozen on the frame.
  //
  // `freeze` stops the page's own rAF from running physics between the state
  // being set and the pixels being read. Everything after this point draws
  // exactly what it was told to draw.
  await page.evaluate(() => {
    const { sim, camera } = window.CAIRN;
    /** @type {any} */ (window).__frozen = true;
    let s = 4;
    for (let i = 0; i < 9; i++) {
      const x = 30 + ((i * 37) % 44);
      sim.world.corpse(x, 40 + i * 26, 0, 1, 0, sim.deaths - i * 3);
    }
    sim.deaths += 9;
    sim.body.grounded = true;
    camera.viewH = 150;
    void s;
  });
  await delay(700);
  await shot('2-standing');

  // 3. IN FLIGHT, and photographed in the same task it is set in.
  //
  // The previous version of this shot set the body airborne, awaited a frame,
  // and photographed a grounded figure — the loop had already landed it. The
  // state is set, the renderer is called by hand, and the screenshot follows
  // with nothing in between that can run physics.
  await page.evaluate(() => {
    const { sim, camera, renderer } = window.CAIRN;
    const b = sim.body;
    b.grounded = false; b.standing = null;
    b.vx = 46; b.vy = 82;
    b.ry = b.y; b.rx = b.x;
    renderer.figStretch = 0.7; renderer.figLean = 0.5; renderer.figIdle = 0;
    renderer.draw(sim, camera, null, { started: true, squash: 0, stretch: 0.4 },
      1 / 60, false);
  });
  await shot('3-flight');

  // 4. THE INSTANT OF CONTACT. Squash at its deepest, the ledge flashing, the
  // dust still in the air — all three of the landing's parts at once, which is
  // the only frame that says whether they read together or fight.
  await page.evaluate(() => {
    const { sim, camera, renderer, FEEL } = window.CAIRN;
    const b = sim.body;
    // PUT IT ON AN ACTUAL LEDGE FIRST.
    //
    // The first version set `grounded = true` where the body happened to be and
    // photographed a figure standing on nothing, with the ledge flash — the
    // thing the frame exists to show — firing on a platform off the bottom of
    // the screen. A landing shot has to contain the surface that was landed on.
    let best = null;
    for (const s of sim.world.solids) {
      if (s.corpse || s.hw <= 0) continue;
      if (Math.abs(s.y - b.y) > 40) continue;
      if (!best || Math.abs(s.y - b.y) < Math.abs(best.y - b.y)) best = s;
    }
    if (best) {
      b.x = b.px = b.rx = best.x;
      b.y = b.py = b.ry = best.y + best.hh + FEEL.body.h * 0.5;
      b.standing = best;
    }
    b.grounded = true; b.vy = 0; b.vx = 8;
    renderer.figStretch = 0; renderer.figCrouch = 0.9; renderer.figIdle = 0;
    renderer.landFlash(b.standing);
    const feet = b.y - FEEL.body.h * 0.5;
    renderer.burst(b.x, feet, FEEL.visual.landingDust, FEEL.visual.landingDustSpeed);
    renderer.ring(b.x, feet, 0.8);
    renderer.draw(sim, camera, null, { started: true, squash: 0.22, stretch: 0 },
      1 / 60, false);
  });
  await shot('4-landing');

  // 5. A STRETCH OF TOWER. Pulled back far enough that several holds and
  // several erosion stages are in one frame — the view the material hierarchy
  // has to survive.
  await page.evaluate(() => {
    const { sim, camera, renderer } = window.CAIRN;
    camera.viewH = 260;
    sim.body.grounded = true;
    renderer.figCrouch = 0; renderer.figIdle = 1;
    renderer.draw(sim, camera, null, { started: true, squash: 0, stretch: 0 },
      1 / 60, false);
  });
  await shot('5-tower');

  await page.close();
}

console.log('\nCAIRN readability shots\n');
// The two shapes the game actually ships on: a phone held upright, and the
// widest thing that will ever open it.
await run({ name: 'mobile', width: 390, height: 844, mobile: true });
await run({ name: 'wide', width: 1280, height: 720, mobile: false });

await browser.close();
shutdown();

console.log(`\n  ${n} frames`);
if (problems.length) {
  console.log('\n  CONSOLE / PAGE ERRORS:');
  for (const p of problems) console.log(`   - ${p}`);
  process.exit(1);
}
console.log('  no console errors\n');
