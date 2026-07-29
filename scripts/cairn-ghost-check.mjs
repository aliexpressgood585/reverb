/**
 * CAIRN — is the body you would leave actually drawn, and drawn at the apex?
 *
 *   node scripts/cairn-ghost-check.mjs
 *
 * `cairn-precision.mjs` proves the previewed apex matches the corpse the sim
 * will create, to 0.000 u. That is the maths. This proves the pixels: that the
 * renderer puts a gold silhouette on the glass, in the right place, in the one
 * state it is supposed to — an aimed launch that cannot land.
 *
 * Proof is by averaged colour, not by a two-shot diff. Every frame of this game
 * moves — grain, bloom, dust, shafts — so two screenshots always differ and a
 * diff proves nothing; the first version of this check "failed" for exactly
 * that reason, with the ghost working perfectly. Instead the apex box and a
 * control box are each sampled over many frames with the ghost on and with
 * `FEEL.aim.ghostAlpha` forced to zero. Noise averages out. A silhouette does
 * not.
 *
 * The tap that starts the game goes through page.touchscreen so hit-testing is
 * real. The drag itself uses the pointer sequence the acceptance suite uses,
 * because Playwright cannot express a held touch drag.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const PORT = 4197;
const FRAMES = 14;
const HALF = 26;            // half-size of a sample box, device px

mkdirSync('shots', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'],
  { stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', () => {});
const shutdown = () => { try { server.kill('SIGTERM'); } catch { /* already gone */ } };
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

await page.touchscreen.tap(195, 500);          // a real thumb starts it
await delay(300);

// Hold a shallow sideways aim off the base ledge: it leaves the ledge and comes
// down on nothing, which is exactly the state the ghost exists for.
const st = await page.evaluate(() => {
  const { sim, input, renderer } = window.CAIRN;
  sim.reset(true); sim.phase = 1;
  const v = document.getElementById('view');
  const at = (t, x, y) => v.dispatchEvent(new PointerEvent(t, {
    pointerId: 21, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch',
  }));
  at('pointerdown', 195, 640);
  at('pointermove', 372, 600);                 // hard right, barely up
  input.update(1 / 60, innerHeight);
  return {
    aiming: input.aiming,
    lands: !!input.landing,
    dies: sim.predictPeak.dies,
    world: { x: +sim.predictPeak.x.toFixed(2), y: +sim.predictPeak.y.toFixed(2) },
    // renderer.X/Y are CSS-space; the canvas backing store is device pixels, so
    // a sampler that forgets the dpr reads a patch of empty sky and concludes
    // the feature is missing. It did, once.
    px: { x: Math.round(renderer.X(sim.predictPeak.x) * renderer.dpr),
          y: Math.round(renderer.Y(sim.predictPeak.y) * renderer.dpr) },
  };
});
await delay(250);

console.log('CAIRN ghost check\n');
console.log(`  aim held: aiming=${st.aiming} lands=${st.lands} dies=${st.dies}`);
console.log(`  apex: world (${st.world.x}, ${st.world.y})  ->  device px (${st.px.x}, ${st.px.y})`);

let ok = st.aiming && !st.lands && st.dies;
if (!ok) {
  console.log('\n  FAIL — could not reach an aimed launch that dies; nothing was verified');
} else {
  const sample = (boxes) => page.evaluate(async ([bs, frames, half]) => {
    const src = document.getElementById('view');
    const cv = document.createElement('canvas');
    cv.width = half * 2; cv.height = half * 2;
    const c = cv.getContext('2d', { willReadFrequently: true });
    const acc = bs.map(() => ({ r: 0, g: 0, b: 0 }));
    for (let f = 0; f < frames; f++) {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      for (let i = 0; i < bs.length; i++) {
        c.clearRect(0, 0, cv.width, cv.height);
        c.drawImage(src, bs[i][0] - half, bs[i][1] - half, half * 2, half * 2,
                    0, 0, half * 2, half * 2);
        const d = c.getImageData(0, 0, cv.width, cv.height).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let k = 0; k < d.length; k += 4) { r += d[k]; g += d[k + 1]; b += d[k + 2]; n++; }
        acc[i].r += r / n; acc[i].g += g / n; acc[i].b += b / n;
      }
    }
    return acc.map((a) => ({ r: a.r / frames, g: a.g / frames, b: a.b / frames }));
  }, [boxes, FRAMES, HALF]);

  // The apex, and a control in empty sky well away from the arc.
  const boxes = [[st.px.x, st.px.y], [120, 300]];

  const on = await sample(boxes);
  await page.screenshot({ path: 'shots/ghost-on.png' });
  await page.evaluate(() => { window.CAIRN.FEEL.aim.ghostAlpha = 0; });
  await delay(200);
  const off = await sample(boxes);
  await page.screenshot({ path: 'shots/ghost-off.png' });

  const delta = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  const dApex = delta(on[0], off[0]);
  const dCtl = delta(on[1], off[1]);

  const f = (v) => `${v.r.toFixed(1)},${v.g.toFixed(1)},${v.b.toFixed(1)}`;
  console.log(`\n  apex box   ghost on ${f(on[0])}   off ${f(off[0])}   delta ${dApex.toFixed(2)}`);
  console.log(`  control    ghost on ${f(on[1])}   off ${f(off[1])}   delta ${dCtl.toFixed(2)}`);
  console.log('  shots/ghost-on.png  shots/ghost-off.png');

  // The ghost must move the apex clearly, and the control barely at all. The
  // control's residual is the frame noise this method exists to see past.
  ok = dApex > 1.5 && dApex > dCtl * 3;
  console.log(ok
    ? `\n  PASS — the ghost is drawn at the apex (${dApex.toFixed(2)} against ${dCtl.toFixed(2)} of noise)`
    : `\n  FAIL — apex delta ${dApex.toFixed(2)} is not clear of noise ${dCtl.toFixed(2)}`);
}

if (errors.length) { console.log('  page errors: ' + errors.join(' | ')); ok = false; }

await browser.close();
shutdown();
process.exit(ok ? 0 : 1);
