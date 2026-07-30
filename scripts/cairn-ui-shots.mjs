#!/usr/bin/env node
/**
 * CAIRN — every screen, at three sizes, in both languages.
 *
 *   node scripts/cairn-ui-shots.mjs
 *
 * The brief asks for a manual review of every screen at three screen sizes, and
 * for screenshots that were actually looked at. This produces them. It is not a
 * pass/fail gate — it is the thing you open before believing the CSS.
 *
 * Everything is driven through `page.touchscreen`, never a synthetic dispatch,
 * because this project has already shipped a build that could not be started
 * with ten green tests asserting the input handler worked.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const PORT = 4202;
const OUT = 'shots/ui';
mkdirSync(OUT, { recursive: true });

const SIZES = [
  { name: 'phone', width: 390, height: 844 },     // 19.5:9, the common case
  { name: 'tall', width: 412, height: 915 },      // 20:9, most modern Androids
  { name: 'small', width: 360, height: 640 },     // 16:9, the floor
];

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
let shots = 0;

for (const size of SIZES) {
  for (const lang of ['en', 'he']) {
    const page = await browser.newPage({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      locale: lang === 'he' ? 'he-IL' : 'en-GB',
    });
    page.on('pageerror', (e) => problems.push(`${size.name}/${lang}: ${e.message}`));
    await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.CAIRN);
    await page.evaluate((l) => localStorage.setItem('cairn.lang', l), lang);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => !!window.CAIRN);
    await delay(500);

    const tag = `${size.name}-${lang}`;
    const shot = async (name) => {
      await page.screenshot({ path: `${OUT}/${tag}-${name}.png` });
      shots++;
    };

    await shot('title');

    // A real tap starts it, then build a tower worth photographing.
    await page.touchscreen.tap(size.width / 2, size.height * 0.6);
    await delay(250);
    await page.evaluate(() => {
      const { sim } = window.CAIRN;
      let s = 5;
      const r = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return (s % 10000) / 10000; };
      for (let i = 0; i < 70; i++) sim.world.corpse(12 + r() * 76, 8 + i * 4.4, (r() - 0.5), i & 3, 0, i);
      sim.deaths = 70;
      sim.best = 320;
      sim.world.generate(700);
    });
    await delay(300);
    await shot('play');

    // Every panel screen, opened the way a thumb opens it.
    const menuBox = await page.locator('#menu').boundingBox();
    if (!menuBox) problems.push(`${tag}: the menu control has no box`);
    else {
      await page.touchscreen.tap(menuBox.x + menuBox.width / 2, menuBox.y + menuBox.height / 2);
      await delay(300);
      await shot('menu');

      for (const [i, name] of [['0', 'stats'], ['1', 'marks'], ['2', 'settings']]) {
        const btn = page.locator('#panel .body .btn').nth(Number(i));
        const b = await btn.boundingBox();
        if (!b) { problems.push(`${tag}: no button ${name}`); continue; }
        await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
        await delay(280);
        await shot(name);
        // back
        const back = await page.locator('#panel .foot .btn').boundingBox();
        if (back) {
          await page.touchscreen.tap(back.x + back.width / 2, back.y + back.height / 2);
          await delay(250);
        }
      }
    }

    // Two measurements worth having in writing rather than in an eyeball.
    const audit = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = document.body.scrollWidth > window.innerWidth + 1;
      /** Anything touchable smaller than 44px is a control a thumb will miss. */
      const small = [];
      for (const el of document.querySelectorAll('button')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.width < 44 || r.height < 44) small.push(`${el.id || el.className}:${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return { dir: doc.dir, lang: doc.lang, overflow, small };
    });
    if (audit.overflow) problems.push(`${tag}: the page scrolls horizontally`);
    if (audit.dir !== (lang === 'he' ? 'rtl' : 'ltr')) {
      problems.push(`${tag}: dir is "${audit.dir}", expected ${lang === 'he' ? 'rtl' : 'ltr'}`);
    }
    if (audit.small.length) problems.push(`${tag}: touch targets under 44px — ${audit.small.join(', ')}`);

    console.log(`  ${tag.padEnd(12)} dir=${audit.dir} overflow=${audit.overflow} ` +
      `smallTargets=${audit.small.length}`);
    await page.close();
  }
}

console.log(`\n  ${shots} screenshots in ${OUT}/`);
if (problems.length) {
  console.log(`\n  ${problems.length} PROBLEMS`);
  for (const p of problems) console.log(`    ${p}`);
} else {
  console.log('\n  no layout problems at any size, in either direction');
}

await browser.close();
shutdown();
process.exit(problems.length ? 1 : 0);
