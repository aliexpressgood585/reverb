#!/usr/bin/env node
/**
 * CAIRN — DOES EROSION READ IN THE RENDERER PLAYERS ACTUALLY GET?
 *
 *   node scripts/cairn-city-check.mjs
 *
 * Acceptance 13 asks the most important question in the game — can a player see
 * whether a stone will still hold their weight — and it asks it of
 * `renderer.draw`, the 2D path. Since the 3D city landed, `renderer.draw` is
 * never called on a WebGL device. The gate has been guarding a renderer almost
 * nobody sees, and the one they do see has had no coverage at all.
 *
 * WHERE THE TELL LIVES IN 3D. Not in the body. `city.draw` puts every corpse
 * into one InstancedMesh with one shared gold material, so the stone itself
 * does NOT dim with age — which is the opposite of the 2D renderer, where
 * dimming WAS the tell. What carries the ladder in 3D is the SEAM above the
 * stone (0.45 units tall when FRESH, 0.18 after) and the lantern on its face,
 * both tinted by a colour scalar of 1.0 / 0.45 / 0.2 across FRESH / THIN / TOP,
 * with MEMORY dropping to a wireframe octahedron. Measuring average brightness
 * over a stone would therefore average the tell away against an identical body
 * and report a tie that is an artifact of the sampling, not of the renderer.
 *
 * METHOD — no projection maths, because that is what broke the first two
 * attempts at this file (one sampled a box aimed with a camera that had not yet
 * been updated by a draw; the other read a drawing buffer that compositing had
 * already cleared).
 *
 *   - ONE corpse per frame, alone, at the point the camera is looking at, so it
 *     cannot be off-screen and cannot be shadowed by a neighbour.
 *   - Each frame differenced against a CONTROL frame of the identical scene with
 *     no corpse in it. Everything that is not the stone cancels exactly.
 *   - The stone is then found FROM the difference — the changed pixels ARE the
 *     stone. Nothing has to be projected, so nothing can be aimed at the wrong
 *     place, and if the instrument sees nothing it reports seeing nothing
 *     instead of reporting a tie.
 *   - Every read happens in the same task as its draw. A WebGL drawing buffer is
 *     cleared on composite and the page's own loop would redraw a different
 *     frame given the chance, so an await anywhere in here is a silent lie.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4255;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', () => {});
process.on('exit', () => { try { server.kill('SIGTERM'); } catch { /* gone */ } });
for (let i = 0; i < 90; i++) {
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
/** @type {string[]} */ const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);
await delay(700);
await page.touchscreen.tap(195, 520);
await delay(500);

const result = await page.evaluate(() => {
  const api = /** @type {any} */ (window).CAIRN;
  const city = api.city;
  if (!city) return { noCity: true };
  const { sim, camera, renderer, BIOMES, BIOME_SPAN } = api;
  const gl = city.gpu.getContext();
  const W = city.gpu.domElement.width, H = city.gpu.domElement.height;
  const ui = { started: true, squash: 0, stretch: 0, wash: 0, dead: 0, goal: 100, feedback: 0 };

  /** Draw the current world and take the back buffer, in this same task. */
  const shoot = () => {
    city.draw(sim, camera, null, ui, 1 / 60, false, renderer);
    const buf = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return buf;
  };
  const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];

  /**
   * What one stone adds to the frame, compared with the same frame without it.
   * @param {Uint8Array} shot @param {Uint8Array} bare
   */
  const added = (shot, bare) => {
    let n = 0, sum = 0, peak = 0;
    for (let i = 0; i < W * H * 4; i += 4) {
      const d = lum(shot, i) - lum(bare, i);
      if (d <= 4) continue;                  // untouched, or darker (a shadow)
      n++; sum += d; if (d > peak) peak = d;
    }
    return { px: n, mean: n ? +(sum / n).toFixed(1) : 0, peak: +peak.toFixed(1) };
  };

  const measureAt = (atY) => {
    sim.reset(true);
    sim.phase = 1;
    sim.deaths = 40;
    sim.best = 0;                            // keep the deep-erosion scale neutral
    sim.body.x = sim.body.px = sim.body.rx = 50;
    sim.body.y = sim.body.py = sim.body.ry = atY + 140;
    camera.x = 50; camera.y = atY; camera.zoom = 1; camera.viewH = 150;
    camera.rot = 0; camera.shake = 0; camera.shakeX = 0; camera.shakeY = 0;
    camera.t = 0; camera.mon = 0; camera.monTarget = 0;

    // The control comes FIRST, and it also warms the 3D camera: `city.camera`
    // is only positioned inside `draw`, so where the camera is looking is not
    // knowable until at least one frame has been drawn.
    const before = sim.world.solids.slice();
    const bare = shoot();
    const aimX = city.camera.position.x, aimY = city.camera.position.y;
    let bareLum = 0;
    for (let i = 0; i < W * H * 4; i += 4) bareLum += lum(bare, i);
    bareLum /= W * H;

    const ages = [0, 10, 20, 34];            // FRESH, THIN, TOP, MEMORY
    const stages = ages.map((age) => {
      sim.world.solids = before.slice();
      const c = sim.world.corpse(aimX, aimY, 0, 1, 0, 40 - age);
      c.glow = 0;                            // the fresh-death flash is not the ladder
      const shot = shoot();
      sim.world.solids = before.slice();
      return added(shot, bare);
    });
    return {
      biome: BIOMES[Math.floor(atY / BIOME_SPAN) % BIOMES.length].name,
      bareLum: +bareLum.toFixed(1),
      stages,
    };
  };

  const out = [];
  for (let bi = 0; bi < BIOMES.length; bi++) out.push(measureAt(bi * BIOME_SPAN + BIOME_SPAN / 2));
  return { out, W, H };
});

console.log('\nCAIRN — erosion legibility in the 3D city\n');
if (result.noCity) {
  console.log('  city renderer not active in this environment — nothing measured\n');
  process.exit(2);
}
const names = ['FRESH', 'THIN', 'TOP', 'MEMORY'];
// IF THE INSTRUMENT CANNOT SEE, IT SAYS SO. A stone that changes no pixel at all
// is a broken read, not a dark stone, and the difference matters: the first two
// versions of this file were blind and would have condemned the renderer for it.
const blind = result.out.filter((r) => r.stages.every((s) => s.px === 0));
if (blind.length === result.out.length) {
  console.log('  NO STONE CHANGED A SINGLE PIXEL IN ANY BIOME — the read is blind, not the renderer.');
  console.log('  Nothing is reported from a frame that was never captured.\n');
  process.exit(2);
}
/** @type {string[]} */ const bad = [];
for (const r of result.out) {
  const p = r.stages.map((s) => s.peak);
  let inverted = -1;
  for (let i = 0; i < 3; i++) if (p[i] < p[i + 1] - 1) { inverted = i; break; }
  let closest = Infinity;
  for (let i = 0; i < 3; i++) closest = Math.min(closest, Math.abs(p[i] - p[i + 1]));
  console.log(`  ${String(r.biome).padEnd(8)} brightest pixel the stone adds  ` +
    r.stages.map((s, i) => `${names[i]} ${String(s.peak).padStart(5)}`).join('  ') +
    (inverted >= 0 ? `   BACKWARDS at ${names[inverted]}` : ''));
  console.log(`           lit area (px) ` + r.stages.map((s) => String(s.px).padStart(6)).join(' ') +
    `    sky ${r.bareLum}`);
  if (r.stages.every((s) => s.px === 0)) { bad.push(`${r.biome}: nothing rendered`); continue; }
  if (inverted >= 0) bad.push(`${r.biome}: ${names[inverted]} reads dimmer than ${names[inverted + 1]}`);
  else if (closest <= 1.5) bad.push(`${r.biome}: two stages look the same (${closest.toFixed(1)})`);
}
if (problems.length) console.log('\n  PAGE ERRORS: ' + problems.join(' | '));
console.log('');
await browser.close();
// The preview server holds the event loop open, so say when we are done rather
// than leaving the run to look like a hang after its own verdict has printed.
server.kill('SIGTERM');
if (bad.length) { console.log('  FAIL  ' + bad.join('; ') + '\n'); process.exit(1); }
console.log('  PASS  all four erosion stages separate and run the right way round\n');
process.exit(0);
