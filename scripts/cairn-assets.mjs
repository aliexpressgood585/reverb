#!/usr/bin/env node
/**
 * CAIRN — every raster asset the store and the app need, drawn rather than
 * downloaded.
 *
 *   node scripts/cairn-assets.mjs
 *
 * Zero external assets is the oldest rule in this project, and it does not stop
 * at the web bundle: the launcher icon, the adaptive foreground, the splash and
 * the store's feature graphic are all rendered here, from the same three-stone
 * mark the PWA icon uses. Nothing binary is authored by hand and nothing is
 * fetched.
 *
 * Drawing happens in a real browser through Playwright, because Canvas2D is the
 * one renderer this project already trusts and a second drawing implementation
 * would be a second thing to keep in step.
 *
 * Output:
 *   android/app/src/main/res/mipmap-*   launcher icons, every density
 *   android/app/src/main/res/drawable/  splash
 *   store/icon-512.png                  the Play listing icon
 *   store/feature-1024x500.png          the Play feature graphic
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const RES = 'android/app/src/main/res';

/** Android launcher densities. `mdpi` is the 1x baseline at 48 px. */
const MIPMAPS = [
  ['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192],
];
/** The adaptive foreground is drawn into the safe 66% of a 108dp square. */
const ADAPTIVE = [
  ['mdpi', 108], ['hdpi', 162], ['xhdpi', 216], ['xxhdpi', 324], ['xxxhdpi', 432],
];

for (const [d] of MIPMAPS) mkdirSync(`${RES}/mipmap-${d}`, { recursive: true });
mkdirSync(`${RES}/drawable`, { recursive: true });
mkdirSync(`${RES}/values`, { recursive: true });
mkdirSync('store', { recursive: true });

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
await page.setContent('<canvas id="c"></canvas>');

/**
 * The mark: three stacked stones, widest at the bottom, cooling upward from
 * quartz through memory-gold to the cold fault blue. It is the tower in three
 * strokes, which is the only thing a 48 px icon has room to say.
 *
 * @param {number} size
 * @param {'full'|'safe'} fit  'safe' keeps everything inside the adaptive mask
 * @param {boolean} bg
 * @returns {Promise<Buffer>}
 */
async function mark(size, fit, bg = true) {
  const data = await page.evaluate(({ size, fit, bg }) => {
    const cv = /** @type {HTMLCanvasElement} */ (document.getElementById('c'));
    cv.width = size; cv.height = size;
    const c = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
    c.clearRect(0, 0, size, size);
    if (bg) {
      const g = c.createLinearGradient(0, 0, 0, size);
      g.addColorStop(0, '#05070C');
      g.addColorStop(1, '#0C1119');
      c.fillStyle = g;
      c.fillRect(0, 0, size, size);
    }
    // 'safe' = the adaptive mask can crop 1/3 of each edge, so the art lives in
    // the middle 66% and the launcher may do what it likes with the rest.
    const pad = fit === 'safe' ? size * 0.20 : size * 0.11;
    const inner = size - pad * 2;
    // A cairn is STACKED: the stones touch. Spacing them evenly and threading a
    // line through them made a skewer, and at 48 px the thread vanished and left
    // three floating pills. They are slabs now, they sit on each other, and the
    // silhouette does the work at every size.
    const rows = [
      { y: 0.205, w: 0.40, col: '#E8EFF3', a: 1.0 },
      { y: 0.485, w: 0.68, col: '#C99A4A', a: 0.97 },
      { y: 0.775, w: 0.98, col: '#4A5B6B', a: 0.95 },
    ];
    const h = inner * 0.20;
    for (const r of rows) {
      const w = inner * r.w;
      const x = pad + inner * 0.5 - w / 2;
      const y = pad + inner * r.y - h / 2;
      c.globalAlpha = r.a;
      c.fillStyle = r.col;
      const rad = Math.max(1, Math.min(h * 0.16, w * 0.08));
      c.beginPath();
      c.roundRect(x, y, w, h, rad);
      c.fill();
    }
    c.globalAlpha = 1;
    return cv.toDataURL('image/png');
  }, { size, fit, bg });
  return Buffer.from(data.split(',')[1], 'base64');
}

console.log('CAIRN assets\n');

// ---- launcher icons, legacy square + round -------------------------------
for (const [density, px] of MIPMAPS) {
  const png = await mark(px, 'full');
  writeFileSync(`${RES}/mipmap-${density}/ic_launcher.png`, png);
  writeFileSync(`${RES}/mipmap-${density}/ic_launcher_round.png`, png);
  console.log(`  mipmap-${density.padEnd(8)} ${px}x${px}`);
}

// ---- adaptive foreground -------------------------------------------------
for (const [density, px] of ADAPTIVE) {
  writeFileSync(`${RES}/mipmap-${density}/ic_launcher_foreground.png`, await mark(px, 'safe', false));
}
console.log('  adaptive foreground, 5 densities, art inside the safe 66%');

// ---- splash --------------------------------------------------------------
{
  const png = await mark(1024, 'safe');
  writeFileSync(`${RES}/drawable/splash.png`, png);
  console.log('  splash 1024x1024');
}

// ---- the Play listing icon ----------------------------------------------
{
  writeFileSync('store/icon-512.png', await mark(512, 'full'));
  // The test that matters: it has to survive being 48 px in a list.
  writeFileSync('store/icon-48-legibility-test.png', await mark(48, 'full'));
  console.log('  store/icon-512.png  + a 48px legibility proof');
}

// ---- the feature graphic ------------------------------------------------
{
  const data = await page.evaluate(() => {
    const cv = /** @type {HTMLCanvasElement} */ (document.getElementById('c'));
    cv.width = 1024; cv.height = 500;
    const c = /** @type {CanvasRenderingContext2D} */ (cv.getContext('2d'));
    const g = c.createLinearGradient(0, 500, 0, 0);
    g.addColorStop(0, '#0C1119');
    g.addColorStop(0.6, '#05070C');
    g.addColorStop(1, '#0A0710');
    c.fillStyle = g;
    c.fillRect(0, 0, 1024, 500);

    // A tower of bodies climbing out of the bottom-right, cooling as it rises.
    // The feature graphic is the game's one sentence as a picture.
    let s = 1337;
    const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 10000) / 10000; };
    const n = 26;
    /** @type {number[][]} */
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      pts.push([720 + Math.sin(i * 0.62) * 52 + r() * 40, 470 - t * 400]);
    }
    c.strokeStyle = 'rgba(201,154,74,0.35)';
    c.lineWidth = 2;
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.stroke();
    pts.forEach(([x, y], i) => {
      const age = 1 - i / (n - 1);
      const col = [
        255 * (1 - age) + 201 * age,
        107 * (1 - age) + 154 * age,
        53 * (1 - age) + 74 * age,
      ];
      c.save();
      c.translate(x, y);
      c.rotate((r() - 0.5) * 0.8);
      c.fillStyle = `rgba(${col.map((v) => v | 0).join(',')},0.65)`;
      c.fillRect(-9, -13, 18, 26);
      c.strokeStyle = `rgba(${col.map((v) => v | 0).join(',')},0.95)`;
      c.lineWidth = 1.6;
      c.strokeRect(-9, -13, 18, 26);
      c.restore();
    });

    c.textAlign = 'left';
    c.fillStyle = '#E8EFF3';
    c.font = '200 76px ui-sans-serif, system-ui, sans-serif';
    c.letterSpacing = '26px';
    c.fillText('CAIRN', 74, 232);
    c.font = '300 23px ui-sans-serif, system-ui, sans-serif';
    c.letterSpacing = '5px';
    c.fillStyle = 'rgba(143,163,176,0.86)';
    c.fillText('EVERY DEATH LEAVES A STONE', 78, 286);
    return cv.toDataURL('image/png');
  });
  writeFileSync('store/feature-1024x500.png', Buffer.from(data.split(',')[1], 'base64'));
  console.log('  store/feature-1024x500.png');
}

await browser.close();
console.log('\n  nothing here was downloaded');
