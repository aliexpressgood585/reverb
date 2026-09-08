#!/usr/bin/env node
/**
 * CAIRN — THE PAINTING BESIDE THE BUILD.
 *
 *   node scripts/cairn-compare.mjs <painting.png> <frame.png> <out.png>
 *
 * Every time this project has argued about whether the game matches the concept
 * art, it has argued from memory of one image while looking at the other. That
 * is how three rounds went into sharpening the wrong answer: the reference said
 * a pale figure and the build had a dark one, and nobody put them side by side.
 *
 * So: one canvas, both images, same height, a hairline between them. No
 * annotation and no scoring — the whole point is that a person looks at it and
 * the difference is either obvious or it is not there.
 *
 * It also prints the two things a glance is bad at: the mean luminance of each
 * image, and the luminance of the BRIGHTEST 0.5% of pixels. The second is the
 * one that matters here, because the reference paintings put almost all of
 * their light into a very small part of the frame, and "is the bright stuff as
 * small and as bright as theirs" is a question the eye answers badly.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const [painting, frame, out] = process.argv.slice(2);
if (!painting || !frame || !out) {
  console.error('usage: cairn-compare.mjs <painting> <frame> <out>');
  process.exit(2);
}
const b64 = (p) => 'data:image/png;base64,' + readFileSync(p).toString('base64');

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

const stats = await page.evaluate(async ({ a, b }) => {
  const load = (src) => new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = src;
  });
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const H = 1400;
  const wa = Math.round(ia.width * (H / ia.height));
  const wb = Math.round(ib.width * (H / ib.height));
  const GAP = 10;
  const cv = document.createElement('canvas');
  cv.width = wa + GAP + wb; cv.height = H;
  const c = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  c.fillStyle = '#000';
  c.fillRect(0, 0, cv.width, cv.height);
  c.drawImage(ia, 0, 0, wa, H);
  c.drawImage(ib, wa + GAP, 0, wb, H);
  c.fillStyle = '#3a3a3a';
  c.fillRect(wa + GAP * 0.5 - 1, 0, 2, H);

  // The two numbers a glance is bad at, measured on each half separately.
  const describe = (x, w) => {
    const d = c.getImageData(x, 0, w, H).data;
    const lums = new Float64Array(d.length / 4);
    let sum = 0;
    for (let i = 0, k = 0; i < d.length; i += 4, k++) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      lums[k] = l; sum += l;
    }
    lums.sort();
    const top = lums.subarray(Math.floor(lums.length * 0.995));
    let ts = 0;
    for (let i = 0; i < top.length; i++) ts += top[i];
    // How much of the frame is essentially black — the reference art's real
    // signature is not its colour, it is how much of it is nothing at all.
    let dark = 0;
    for (let i = 0; i < lums.length; i++) if (lums[i] < 12) dark++;
    // The exact metric acceptance 6 gates on, so the reference can be asked
    // what the threshold should have been.
    let ch = 0, grey = 0, litN = 0, litCh = 0, litGrey = 0;
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]);
      const mn = Math.min(d[i], d[i + 1], d[i + 2]);
      ch += mx - mn;
      if (mx - mn < 10) grey++;
      // The same two numbers asked ONLY of pixels bright enough for greyness to
      // mean anything. A pixel at (5,4,4) is black, not washed out.
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (l > 25) { litN++; litCh += mx - mn; if (mx - mn < 10) litGrey++; }
    }
    return {
      mean: +(sum / lums.length).toFixed(1),
      top: +(ts / top.length).toFixed(1),
      darkPct: +(dark / lums.length * 100).toFixed(1),
      chroma: +(ch / lums.length).toFixed(1),
      greyPct: +(grey / lums.length * 100).toFixed(1),
      litChroma: +(litN ? litCh / litN : 0).toFixed(1),
      litGrey: +(litN ? litGrey / litN * 100 : 0).toFixed(1),
      litPct: +(litN / lums.length * 100).toFixed(1),
    };
  };
  const A = describe(0, wa), Bv = describe(wa + GAP, wb);
  /** @type {any} */ (window).__png = cv.toDataURL('image/png');
  return { A, B: Bv };
}, { a: b64(painting), b: b64(frame) });

const url = await page.evaluate(() => /** @type {any} */ (window).__png);
const { writeFileSync } = await import('node:fs');
writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));

console.log('\n  PAINTING (left)              BUILD (right)');
console.log(`  mean luminance   ${String(stats.A.mean).padStart(6)}        ${String(stats.B.mean).padStart(6)}`);
console.log(`  brightest 0.5%   ${String(stats.A.top).padStart(6)}        ${String(stats.B.top).padStart(6)}`);
console.log(`  near-black %     ${String(stats.A.darkPct).padStart(6)}        ${String(stats.B.darkPct).padStart(6)}`);
console.log(`  chroma (test 6)  ${String(stats.A.chroma).padStart(6)}        ${String(stats.B.chroma).padStart(6)}`);
console.log(`  flat grey % (6)  ${String(stats.A.greyPct).padStart(6)}        ${String(stats.B.greyPct).padStart(6)}`);
console.log('  --- among pixels bright enough to have a colour (lum > 25) ---');
console.log(`  lit % of frame   ${String(stats.A.litPct).padStart(6)}        ${String(stats.B.litPct).padStart(6)}`);
console.log(`  chroma           ${String(stats.A.litChroma).padStart(6)}        ${String(stats.B.litChroma).padStart(6)}`);
console.log(`  flat grey %      ${String(stats.A.litGrey).padStart(6)}        ${String(stats.B.litGrey).padStart(6)}`);
console.log(`\n  -> ${out}\n`);
await browser.close();
