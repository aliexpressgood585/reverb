#!/usr/bin/env node
/**
 * CAIRN — does the world stop looking like itself?
 *
 *   node scripts/cairn-variety-check.mjs
 *
 * A player at 11,045 m reported the design as "boring, it repeats". He was
 * right: the biome cycle is six biomes of 150 m, the parallax silhouettes were
 * generated once from a fixed seed, and only the colour changed. By 11 km he had
 * seen the same three shapes in the same six colours twelve times.
 *
 * Acceptance test 5 could not see it. It compares 50 m, 200 m and 400 m — three
 * points inside the FIRST cycle, where the colours genuinely differ. Repetition
 * is a property of the second lap and nothing looked at the second lap.
 *
 * So this samples the same phase of the cycle across several laps — 200 m,
 * 1,100 m, 2,000 m, 2,900 m are all the same biome at the same blend — and asks
 * whether the frames differ. If the world repeats, they are identical and this
 * goes red.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const PORT = 4210;
const OUT = 'shots/variety';
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
await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);
await page.touchscreen.tap(195, 500);
await delay(300);

const fails = [];
const check = (ok, msg) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails.push(msg);
};

console.log('CAIRN visual variety\n');

/**
 * Put the camera at a height and return a coarse signature of the SHAPE on
 * screen — column-by-column, how far down the frame the geometry reaches.
 *
 * Deliberately not a colour average: colour is what already varied, and a
 * measurement that colour dominates would go green on a world that repeats.
 * This samples where the silhouette is, which is what the player was
 * complaining about.
 *
 * @param {number} y
 * @returns {Promise<number[]>}
 */
async function silhouette(y) {
  await page.evaluate((h) => {
    const { sim, camera, renderer } = window.CAIRN;
    sim.reset(true);
    sim.phase = 1;
    sim.best = h;
    sim.world.generate(h + 400);
    sim.body.y = h; sim.body.ry = h; sim.body.x = 50; sim.body.rx = 50;
    sim.body.grounded = true;
    camera.y = h; camera.x = 50;
    camera.mon = 0; camera.monTarget = 0;
    renderer.trailN = 0;
  }, y);
  // Several frames so the cached background gradient and the dust settle.
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => {
      const { sim, camera, renderer, ui } = window.CAIRN;
      renderer.step(1 / 60);
      renderer.draw(sim, camera, null, ui, 1 / 60, false);
    });
  }
  return page.evaluate(() => {
    const { renderer } = window.CAIRN;
    const src = renderer.ctx.canvas;
    const cv = document.createElement('canvas');
    cv.width = 48; cv.height = 64;
    const c = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d', { willReadFrequently: true }));
    c.drawImage(src, 0, 0, cv.width, cv.height);
    const d = c.getImageData(0, 0, cv.width, cv.height).data;
    /** @type {number[]} */
    const cols = [];
    for (let x = 0; x < cv.width; x++) {
      // Brightness profile down this column, as a shape fingerprint.
      let acc = 0;
      for (let yy = 0; yy < cv.height; yy++) {
        const i = (yy * cv.width + x) * 4;
        const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        acc += lum * (yy / cv.height);
      }
      cols.push(acc / cv.height);
    }
    return cols;
  });
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} mean absolute difference of the two shape fingerprints
 */
function diff(a, b) {
  let t = 0;
  for (let i = 0; i < a.length; i++) t += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return t / a.length;
}

// The same phase of the biome cycle, one lap apart each time. 6 biomes x 150 m
// is a 900 m cycle, so these four were pixel-for-pixel the same world before.
const LAP = 900;
const heights = [200, 200 + LAP, 200 + LAP * 2, 200 + LAP * 3];
/** @type {number[][]} */
const sigs = [];
for (const h of heights) {
  sigs.push(await silhouette(h));
  await page.screenshot({ path: `${OUT}/lap-${h}m.png` });
}

console.log('        the same point in the biome cycle, one lap apart:');
let worst = Infinity;
for (let i = 1; i < sigs.length; i++) {
  const d = diff(sigs[0], sigs[i]);
  worst = Math.min(worst, d);
  console.log(`          ${String(heights[0]).padStart(5)} m vs ${String(heights[i]).padStart(5)} m   ` +
    `shape difference ${d.toFixed(2)}`);
}
check(worst > 1.0,
  `one lap later the world is a different shape — smallest difference ${worst.toFixed(2)} ` +
  `(identical geometry would score ~0)`);

// And the six biomes must not be six colours of one shape.
/** @type {number[][]} */
const within = [];
for (const h of [40, 190, 340, 490, 640, 790]) within.push(await silhouette(h));
let minPair = Infinity;
for (let i = 0; i < within.length; i++) {
  for (let j = i + 1; j < within.length; j++) minPair = Math.min(minPair, diff(within[i], within[j]));
}
check(minPair > 0.8,
  `the six biomes are six different silhouettes — closest pair differs by ${minPair.toFixed(2)}`);

console.log(`\n  frames in ${OUT}/`);
console.log(fails.length ? `\n${fails.length} FAILED` : '\nthe world does not repeat');
await browser.close();
shutdown();
process.exit(fails.length ? 1 : 0);
