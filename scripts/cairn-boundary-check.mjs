#!/usr/bin/env node
/**
 * CAIRN — does a crash produce a sentence or a black rectangle?
 *
 *   node scripts/cairn-boundary-check.mjs
 *
 * A canvas game that throws shows nothing, and nothing is indistinguishable from
 * a game that is simply very dark. The error boundary exists so that a player
 * whose device fails on us is told what happened and told their tower is safe.
 *
 * The only way to know it works is to break the game on purpose, so that is what
 * this does: it sabotages the renderer mid-loop and then asks whether the screen
 * says anything. A boundary that has never caught anything is a div.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4205;

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

const fails = [];
const check = (ok, msg) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails.push(msg);
};

console.log('CAIRN error boundary\n');

const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
page.on('console', () => { /* the boundary logs deliberately; not a failure */ });
await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);
await page.touchscreen.tap(195, 500);
await delay(300);

// The boundary must be invisible until it is needed.
{
  const before = await page.evaluate(() => {
    const f = document.getElementById('fatal');
    return f ? getComputedStyle(f).display : 'missing';
  });
  check(before === 'none', `hidden while the game is healthy (display: ${before})`);
}

// Build something worth losing, so the save path is exercised too.
await page.evaluate(() => {
  const { sim } = window.CAIRN;
  for (let i = 0; i < 12; i++) sim.world.corpse(30 + i * 2, 20 + i * 9, 0.1, i & 3, 0, i);
  sim.deaths = 12;
  sim.best = 128;
});
await delay(200);

// Sabotage the loop the way a real bug would.
await page.evaluate(() => {
  window.CAIRN.renderer.draw = () => { throw new Error('deliberate sabotage'); };
});
await delay(900);

{
  const r = await page.evaluate(() => {
    const f = document.getElementById('fatal');
    const s = f ? getComputedStyle(f) : null;
    return {
      shown: !!f && f.className === 'on',
      display: s ? s.display : 'missing',
      text: (f?.querySelector('p')?.textContent || ''),
      saved: localStorage.getItem('cairn.v1') || '',
    };
  });
  check(r.shown && r.display === 'flex',
    `a throw inside the frame loop raises the boundary (display: ${r.display})`);
  check(r.text.length > 40 && /tower is safe/i.test(r.text),
    `and it says something a player can act on — "${r.text.slice(0, 52)}…"`);
  // The one thing that must survive a crash is the thing the player built.
  check(r.saved.includes('"best"') && r.saved.length > 40,
    `the tower was written to disk on the way down (${r.saved.length} bytes)`);
}

// And it must stop, not repeat sixty times a second.
{
  const spun = await page.evaluate(async () => {
    let n = 0;
    const orig = console.error;
    console.error = (...a) => { n++; orig(...a); };
    await new Promise((r) => setTimeout(r, 1200));
    console.error = orig;
    return n;
  });
  check(spun === 0, `it fires once and stops — ${spun} further errors in the next 1.2 s`);
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\na crash is a sentence, not a black screen');
await browser.close();
shutdown();
process.exit(fails.length ? 1 : 0);
