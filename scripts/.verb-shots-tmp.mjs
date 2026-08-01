#!/usr/bin/env node
/** Throwaway: one screenshot of each biome verb, so I can look at what I built. */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const PORT = 4219;
const OUT = 'shots/verbs';
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
page.on('console', (m) => { if (m.type() === 'error') console.log('  console:', m.text()); });
page.on('pageerror', (e) => console.log('  PAGEERROR:', e.message));
await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);
await page.touchscreen.tap(195, 520);
await delay(300);

// ASH crumble lives above 900 m; SIGNAL 150-300 and 1050-1200; BLOOM 300-450.
for (const [name, y, want] of [['signal-updraft', 160, 'updraft'],
  ['bloom-drift', 310, 'drift'], ['void-dark', 470, ''],
  ['ash-crumble', 910, 'crumble'], ['ash-crumble-armed', 910, 'crumble-armed'],
  ['cinder', 620, '']]) {
  const info = await page.evaluate(({ wy, want }) => {
    const { sim, camera } = window.CAIRN;
    sim.world.generate(wy + 900);
    const near = sim.world.solids
      .filter((s) => !s.corpse && s.y > wy && s.y < wy + 140)
      .sort((a, b) => a.y - b.y);
    const key = want === 'crumble-armed' ? 'crumble' : want;
    const has = (s) => (key === 'drift' ? s.drift > 0 : key ? s[key] : false);
    const pick = near.find(has) || near[0];
    if (!pick) return null;
    const b = sim.body;
    b.x = b.px = pick.x; b.y = b.py = pick.y + pick.hh;
    b.vx = b.vy = 0; b.grounded = true; b.standing = pick;
    b.takeoff = b.y; b.peakX = b.x; b.peakY = b.y;
    if (pick.crumble && want === 'crumble-armed') pick.crumbleAt = sim.verbTime + 0.30;
    camera.x = pick.x; camera.y = b.y;
    return { y: Math.round(pick.y), crumble: pick.crumble, updraft: pick.updraft, drift: pick.drift };
  }, { wy: y, want });
  await delay(700);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${name.padEnd(16)} ${JSON.stringify(info)}`);
}

await browser.close();
shutdown();
