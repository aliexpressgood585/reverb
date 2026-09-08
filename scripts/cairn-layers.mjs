#!/usr/bin/env node
/**
 * CAIRN — WHAT EACH BACKGROUND LAYER IS ACTUALLY WORTH.
 *
 *   node scripts/cairn-layers.mjs
 *
 * An art review said the frame is generic: too many identical rectangles, an
 * even brown haze, transparent lines that say nothing, soft glow instead of
 * material. It asked for an audit before any code, and for anything that fails
 * to earn its place to be DELETED rather than dimmed.
 *
 * An audit by opinion would be worth nothing here — this project has repeatedly
 * been wrong about which layer a thing on screen belonged to, most recently by
 * spending two rounds tuning a landmark that turned out not to be drawing the
 * beam at all. So this measures. One frame is drawn twice per layer, identical
 * except that the layer's method is replaced by a no-op, and the two are
 * compared pixel for pixel.
 *
 * The two numbers that matter:
 *
 *   TOUCHED   share of pixels the layer changes at all. A layer nobody can
 *             see is a layer to delete — "animation you cannot make out".
 *   WEIGHT    mean absolute luminance it adds across the whole frame. This is
 *             how much of the picture's brightness budget it is spending.
 *
 * Both are reported for a PLAYING frame, because that is the frame a player
 * spends their time in — not the pulled-back monument shot where half of this
 * fades out by design.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4248;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', () => {});
process.on('exit', () => { try { server.kill('SIGTERM'); } catch { /* gone */ } });
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
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true,
});
page.on('pageerror', (e) => console.log('  PAGE ERROR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);
await delay(600);
await page.touchscreen.tap(195, 520);
await delay(400);

const LAYERS = ['_plate', '_deepTower', '_facade', '_shafts', '_dust', '_monolith',
  '_landmarks', '_threads', '_updrafts', '_dark', '_shadow', '_trail', '_ghostRun',
  '_bestLine'];

const rows = await page.evaluate(async (layers) => {
  const { sim, camera, renderer } = window.CAIRN;
  // A representative playing frame: a few bodies below, the camera on the
  // player, no monument pull-back.
  for (let i = 0; i < 8; i++) {
    sim.world.corpse(30 + ((i * 37) % 44), 30 + i * 24, 0, 1, 0, sim.deaths - i * 3);
  }
  sim.deaths += 8;
  camera.viewH = 150; camera.mon = 0; camera.monTarget = 0;
  camera.rot = 0; camera.shakeX = 0; camera.shakeY = 0;
  const cv = renderer.canvas;
  const c2 = cv.getContext('2d', { willReadFrequently: true });
  const W = cv.width, H = cv.height;

  // EVERY READ HAPPENS IN THE SAME TASK AS ITS DRAW. The page's own rAF loop
  // runs physics and a drifting camera; anything awaited between a draw and a
  // getImageData is a different frame, and this project has already published a
  // measurement taken that way.
  const grab = () => {
    renderer.draw(sim, camera, null, { started: true, squash: 0, stretch: 0 }, 1 / 60, false);
    return c2.getImageData(0, 0, W, H).data;
  };
  const base = grab();
  const out = [];
  // The frame as it stands, so the per-layer costs have a total to sit against.
  {
    let dk = 0;
    for (let i = 0; i < base.length; i += 4) {
      const l = 0.2126 * base[i] + 0.7152 * base[i + 1] + 0.0722 * base[i + 2];
      if (l < 12) dk++;
    }
    out.push({ name: 'FRAME', touched: 100, weight: 0,
      blackCost: +(dk / (base.length / 4) * 100).toFixed(1) });
  }
  for (const name of layers) {
    const real = renderer[name];
    if (typeof real !== 'function') { out.push({ name, missing: true }); continue; }
    renderer[name] = () => {};
    const off = grab();
    renderer[name] = real;
    let touched = 0, weight = 0, darkOn = 0, darkOff = 0;
    for (let i = 0; i < base.length; i += 4) {
      const l0 = 0.2126 * base[i] + 0.7152 * base[i + 1] + 0.0722 * base[i + 2];
      const l1 = 0.2126 * off[i] + 0.7152 * off[i + 1] + 0.0722 * off[i + 2];
      const d = Math.abs(l0 - l1);
      if (d > 1.5) touched++;
      weight += d;
      if (l0 < 12) darkOn++;
      if (l1 < 12) darkOff++;
    }
    const n = base.length / 4;
    // HOW MUCH BLACK THIS LAYER COSTS. The concept paintings are 54% below
    // luminance 12 and the build is 13%; this column says which layer is
    // spending that budget, which two rounds of guessing failed to find.
    out.push({ name, touched: +(touched / n * 100).toFixed(1), weight: +(weight / n).toFixed(2),
      blackCost: +((darkOff - darkOn) / n * 100).toFixed(1) });
  }
  return out;
}, LAYERS);

console.log('\nCAIRN — what each layer is worth, on a playing frame\n');
console.log('  layer          touched%   weight   black cost%');
for (const r of rows.sort((a, b) => (b.weight || 0) - (a.weight || 0))) {
  if (r.missing) { console.log(`  ${r.name.padEnd(14)} (not a method)`); continue; }
  const flag = r.touched < 2 ? '   <- invisible' : r.weight < 0.4 ? '   <- near-invisible' : '';
  console.log(`  ${r.name.padEnd(14)} ${String(r.touched).padStart(7)}   ${String(r.weight).padStart(6)}   ${String(r.blackCost).padStart(6)}${flag}`);
}
console.log('');
await browser.close();
