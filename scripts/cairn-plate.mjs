#!/usr/bin/env node
/**
 * CAIRN — CUT THE BACKGROUND PLATE FROM THE CONCEPT PAINTING.
 *
 *   node scripts/cairn-plate.mjs <painting.png> <out.webp>
 *
 * The game cannot draw painted stone. Four rounds of tuning got the TONE of the
 * reference close and never got the surface, because the reference's surface is
 * hand-painted architecture and this renderer is rectangles and arcs. The one
 * route to actually matching a painting is to use the painting.
 *
 * The plate that shipped was 13 KB cut from a 3.9 MB source — a three-hundred-fold
 * squeeze, which is exactly where the stone went. This cuts a new one properly.
 *
 * WHAT IS CUT OUT, AND WHY. The painting is a composed scene: it contains a
 * figure and a column of lit platforms, and those are things the GAME draws. Bake
 * them into the background and every frame shows painted platforms nobody can
 * stand on beside real ones they can — the same class of lie as drawing a hold
 * wider than it catches. So the crop takes the band that is mostly structure:
 * the rings, the arches, the tiers. The lit slabs that survive are small, far
 * off-axis, and read as architecture rather than as holds.
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';

const [src, out] = process.argv.slice(2);
if (!src || !out) { console.error('usage: cairn-plate.mjs <painting.png> <out.webp>'); process.exit(2); }

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });

const url = await page.evaluate(async (b64) => {
  const im = await new Promise((res, rej) => {
    const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = b64;
  });
  const W = im.width, H = im.height;
  // The architecture band: below the top edge, above the figure and the lit
  // column it stands in. Fractions of the source so a different painting of the
  // same shape still lands somewhere sensible.
  const y0 = Math.round(H * 0.06), y1 = Math.round(H * 0.56);
  const bh = y1 - y0;

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = bh;
  const c = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
  c.drawImage(im, 0, y0, W, bh, 0, 0, W, bh);

  // FEATHER THE TOP AND BOTTOM EDGES TO BLACK.
  //
  // The plate repeats vertically. A hard cut leaves a seam the eye finds on a
  // slow scroll; the renderer already mirrors alternate copies to hide the
  // join, and a fade makes that mirror invisible rather than merely subtle.
  const fade = Math.round(bh * 0.10);
  const g1 = c.createLinearGradient(0, 0, 0, fade);
  g1.addColorStop(0, 'rgba(0,0,0,1)'); g1.addColorStop(1, 'rgba(0,0,0,0)');
  const g2 = c.createLinearGradient(0, bh - fade, 0, bh);
  g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, 'rgba(0,0,0,1)');
  c.fillStyle = g1; c.fillRect(0, 0, W, fade);
  c.fillStyle = g2; c.fillRect(0, bh - fade, W, fade);

  return cv.toDataURL('image/webp', 0.86);
}, 'data:image/png;base64,' + readFileSync(src).toString('base64'));

const buf = Buffer.from(url.split(',')[1], 'base64');
writeFileSync(out, buf);
console.log(`  ${out}  ${(buf.length / 1024).toFixed(0)} KB`);
await browser.close();
