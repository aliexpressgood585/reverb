#!/usr/bin/env node
/**
 * CAIRN — does the soundscape actually change with altitude?
 *
 *   node scripts/cairn-audio-check.mjs
 *
 * The wind layer is the one part of the audio that makes a claim about the game
 * rather than about a sound: "the soundscape thins and gets colder as you
 * climb". A claim like that is easy to wire up and never verify — the graph
 * connects, nothing throws, and whether anything is audible is nobody's problem.
 *
 * So this reads the actual `AudioParam` values off the running graph at four
 * altitudes and asserts the direction of travel. It cannot tell you the game
 * sounds good. It can tell you the wind is not silent at 900 m, which is the
 * failure that would otherwise ship unnoticed.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4204;

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
    '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);

const fails = [];
const check = (ok, msg) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) fails.push(msg);
};

console.log('CAIRN audio\n');

// A real tap, because that is what the autoplay policy actually requires and
// because an unlock that only works under a synthetic event is not an unlock.
await page.touchscreen.tap(195, 500);
await delay(400);

const ready = await page.evaluate(() => window.CAIRN.audio.ready);
check(ready, 'one real touch builds the audio graph (every mobile browser requires it)');

if (ready) {
  const rows = await page.evaluate(async () => {
    const { audio } = window.CAIRN;
    const out = [];
    for (const y of [0, 300, 600, 900]) {
      /*
       * SETTLE IT THE WAY THE GAME DOES.
       *
       * `setHeight` runs every frame and every ramp is `setTargetAtTime` with a
       * 1.2-1.4 s time constant, which is a deliberate feel choice: wind that
       * arrives in 200 ms pops. An exponential approach is ~99% there after five
       * time constants, so the first version of this — which waited 260 ms —
       * measured a transition in progress and reported the drone as barely
       * moving. It was measuring the ramp, not the destination.
       */
      for (let i = 0; i < 420; i++) {
        audio.setHeight(y, 0);
        await new Promise((r) => setTimeout(r, 16));
      }
      const b = audio.bed;
      out.push({
        y,
        wind: +b.windGain.gain.value.toFixed(5),
        windHz: Math.round(b.windFilt.frequency.value),
        gustHz: Math.round(b.gustFilt.frequency.value),
        drone: +b.out.gain.value.toFixed(5),
        bedHz: Math.round(b.filt.frequency.value),
      });
    }
    return out;
  });

  console.log('        height   wind    windHz  gustHz   drone   bedHz');
  for (const r of rows) {
    console.log(`        ${String(r.y).padStart(4)} m   ${r.wind.toFixed(4)}  ` +
      `${String(r.windHz).padStart(5)}   ${String(r.gustHz).padStart(5)}   ` +
      `${r.drone.toFixed(4)}  ${String(r.bedHz).padStart(5)}`);
  }

  const ground = rows[0], top = rows[rows.length - 1];
  check(ground.wind < 0.005,
    `there is no wind at ground level (${ground.wind.toFixed(4)})`);
  check(top.wind > ground.wind * 4 && top.wind > 0.02,
    `the wind arrives with altitude — ${ground.wind.toFixed(4)} at 0 m to ` +
    `${top.wind.toFixed(4)} at 900 m`);
  check(top.windHz > ground.windHz * 1.5,
    `and gets colder, not just louder — band centre ${ground.windHz} Hz to ${top.windHz} Hz`);
  check(top.drone < ground.drone * 0.75,
    `the drone bed recedes as the wind arrives — ${ground.drone.toFixed(4)} to ` +
    `${top.drone.toFixed(4)}. Thinner, not merely busier.`);

  let monotone = true;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].wind < rows[i - 1].wind || rows[i].drone > rows[i - 1].drone) monotone = false;
  }
  check(monotone, 'both move in one direction the whole way up — no band where it reverses');

  // Muting has to actually silence it, including the layers added last.
  const muted = await page.evaluate(async () => {
    const { audio } = window.CAIRN;
    audio.setMuted(true);
    await new Promise((r) => setTimeout(r, 260));
    const v = audio.master.gain.value;
    audio.setMuted(false);
    return v;
  });
  check(muted < 0.01, `mute takes the master bus to ${muted.toFixed(4)}`);
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nthe soundscape climbs');
await browser.close();
shutdown();
process.exit(fails.length ? 1 : 0);
