/**
 * The first sixty seconds.
 *
 * Nobody reads instructions. A player who has read nothing has to work out,
 * inside one minute and with no tutorial text, that sound is light and that
 * they need to shut up. This runs the real game from the title screen with a
 * naive player's input, records exactly when each lesson is available to be
 * learned, and photographs a frame every two seconds.
 *
 *   node scripts/first-minute.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4207;
mkdirSync('shots/first-minute', { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
process.on('exit', () => { try { server.kill('SIGTERM'); } catch {} });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/`)).ok) break; } catch {}
  await delay(400);
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 800, height: 450 } });
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/?lm=512&msaa=0&nosound=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.REVERB);

/**
 * Instrument the running game: record every teachable moment with a timestamp,
 * measured from the instant control is handed over.
 */
await page.evaluate(() => {
  const g = window.REVERB;
  g.setFixedStep(1 / 60);
  g.setHeadlessLogicOnly(true);

  const log = [];
  window.__lessons = log;
  window.__t0 = null;
  const once = {};
  const mark = (key, note) => {
    if (once[key] || window.__t0 === null) return;
    once[key] = true;
    log.push({ at: +(g.levelTime).toFixed(2), key, note });
  };
  window.__mark = mark;

  // Every sound in the game passes through here, so this is where the lessons
  // are: each one is the first time a particular kind of light appears.
  g.sound.onSound(() => {});
  const emit = g.sound.emit.bind(g.sound);
  g.sound.emit = (kind, pos, o = {}) => {
    const r = emit(kind, pos, o);
    if (window.__t0 === null) return r;
    const d = Math.hypot(pos.x - g.player.position.x, pos.z - g.player.position.z);
    if (o.fromPlayer && kind === 'step') mark('own-step', 'your own footstep draws the floor');
    if (kind === 'drip' && d < 22) mark('drip', 'the world makes light without you');
    if (kind === 'hum' && d < 30) mark('hum', 'the building itself ticks over');
    if (kind === 'enemyStep' && d < 30) mark('creature-moves', 'something else is moving, and it is orange');
    if (kind === 'breath' && d < 26) mark('creature-breathes', 'it gives itself away by breathing');
    if (o.fromPlayer && kind === 'step' && (o.surface === 1 || o.surface === 2)) {
      mark('loud-ground', 'not all ground is equally loud');
    }
    return r;
  };
  return true;
});

const step = (n) => page.evaluate((k) => { for (let i = 0; i < k; i++) window.REVERB.frame(); }, n);

/**
 * Software rasterisation costs about a third of a second a frame, so the whole
 * minute is simulated with the GPU detached and only the half-second before
 * each sample is actually drawn. Light memory decays over 0.62 s, so 30
 * rendered frames is enough history for the frame to be honest.
 */
const render = (on) => page.evaluate((v) => window.REVERB.setHeadlessLogicOnly(!v), on);
const key = (k, on) => page.evaluate(({ k, on }) => window.REVERB.input.synth(k, on), { k, on });

// --- get through the front of the game the way a player would ---------------
await step(40);
const titleState = await page.evaluate(() => window.REVERB.state);
await key('confirm', true); await step(2); await key('confirm', false);
await step(6);
const cardState = await page.evaluate(() => window.REVERB.state);
await step(360); // the card holds for 5.5 s and then hands over
const playState = await page.evaluate(() => window.REVERB.state);
console.log(`title=${titleState}  after ENTER=${cardState}  after card=${playState}`);

await page.evaluate(() => { window.__t0 = window.REVERB.levelTime; });

/**
 * A naive player: walks forward because forward is the only thing that ever
 * happens, looks around a bit, does not know that Shift exists.
 */
const PLAN = [
  [0, 6, { forward: true }],
  [6, 9, { forward: true, look: 14 }],
  [9, 18, { forward: true }],
  [18, 21, { look: -22 }],
  [21, 32, { forward: true }],
  [32, 36, { forward: true, look: 10 }],
  [36, 48, { forward: true }],
  [48, 60, { forward: true, look: -8 }],
];

let simT = 0;
let shotIndex = 0;
let finished = null;
const frames = [];
for (const [from, to, act] of PLAN) {
  if (finished) break;
  await page.evaluate(({ act }) => {
    const g = window.REVERB;
    for (const k of ['forward', 'back', 'left', 'right', 'sneak']) g.input.synth(k, false);
    for (const k of Object.keys(act)) if (k !== 'look' && act[k]) g.input.synth(k, true);
  }, { act });

  while (simT < to && !finished) {
    if (act.look) await page.evaluate((d) => window.REVERB.player.look(d, 0), act.look);
    await step(60); // one simulated second
    simT += 1;
    if (simT % 4 === 0) {
      const name = `t${String(simT).padStart(2, '0')}s`;
      await render(true);
      await step(30);
      await page.screenshot({ path: `shots/first-minute/${name}.png`, timeout: 300000 });
      const m = await page.evaluate(() => {
        const g = window.REVERB;
        const c = g.canvas;
        const tmp = document.createElement('canvas');
        tmp.width = c.width; tmp.height = c.height;
        tmp.getContext('2d').drawImage(c, 0, 0);
        const d = tmp.getContext('2d').getImageData(0, 0, tmp.width, tmp.height).data;
        let lit = 0, warm = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], gr = d[i + 1], b = d[i + 2];
          if (Math.max(r, gr, b) > 2) lit++;
          if (r - b > 24 && r > 26) warm++;
        }
        const n = d.length / 4;
        return {
          litPct: +(100 * lit / n).toFixed(1),
          warmPct: +(100 * warm / n).toFixed(2),
          noise: +g.sound.noiseScore.toFixed(1),
          alerted: g.enemies.filter((e) => e.state !== 'IDLE').length,
          hunting: g.enemies.filter((e) => e.state === 'HUNT').length,
          health: g.player.health,
          state: g.state,
        };
      });
      await render(false);
      frames.push({ t: simT, name, ...m });
      shotIndex++;
      if (m.state !== 'play') { finished = { at: simT, state: m.state }; break; }
    }
  }
}

// The creature reacting to the player is the last and most important lesson,
// so record it from the AI side rather than from the sound side.
const lessons = await page.evaluate(() => window.__lessons);
const aiTimeline = await page.evaluate(() => window.__ai || []);
await browser.close();

// ------------------------------------------------------------------ report
const pad = (s, n) => String(s).padEnd(n);
console.log('\n== the first minute, frame by frame ===================');
console.log(pad('t', 5), pad('lit%', 7), pad('warm%', 7), pad('noise', 7), pad('alert', 6), pad('hunt', 5), 'hp');
for (const f of frames) {
  console.log(pad(f.t + 's', 5), pad(f.litPct, 7), pad(f.warmPct, 7), pad(f.noise, 7),
    pad(f.alerted, 6), pad(f.hunting, 5), f.health);
}

console.log('\n== when each lesson first became available ============');
const order = lessons.slice().sort((a, b) => a.at - b.at);
for (const l of order) console.log(' ', pad(l.at + 's', 8), pad(l.key, 18), l.note);

const firstAlert = frames.find((f) => f.alerted > 0);
if (firstAlert) console.log(' ', pad(firstAlert.t + 's', 8), pad('creature-reacts', 18),
  'something turned towards a noise you made');
const firstHunt = frames.find((f) => f.hunting > 0);
if (firstHunt) console.log(' ', pad(firstHunt.t + 's', 8), pad('creature-hunts', 18),
  'and now it is coming');

const fails = [];
const at = (k) => order.find((l) => l.key === k)?.at;
const need = (k, by, what) => {
  const t = at(k);
  if (t === undefined || t > by) fails.push(`${what}: ${t === undefined ? 'never happened' : t + 's'}, wanted inside ${by}s`);
};
need('own-step', 4, 'your own footstep draws the floor');
need('drip', 12, 'the world makes light on its own');
need('creature-moves', 30, 'something alive appears, in orange');
need('loud-ground', 45, 'ground loudness differs');
if (!firstAlert || firstAlert.t > 45) {
  fails.push(`a creature reacts to you: ${firstAlert ? firstAlert.t + 's' : 'never'}, wanted inside 45s`);
}
// Frames after the level resolves are the results card over a cleared canvas,
// so only the frames of actual play are judged for darkness.
const played = frames.filter((f) => f.state === 'play');
const dark = played.filter((f) => f.litPct < 1).length;
if (dark > played.length * 0.4) fails.push(`${dark} of ${played.length} played frames were effectively black`);
if (finished) {
  console.log(`\n level resolved at ${finished.at}s (state: ${finished.state})`);
  if (finished.at < 20) fails.push(`the level was over in ${finished.at}s, before it could teach anything`);
}

writeFileSync('shots/first-minute/contact-sheet.html',
  `<!doctype html><meta charset=utf-8><title>REVERB first minute</title>
<style>body{background:#000;color:#dce3e8;font:11px ui-monospace,monospace;margin:20px;letter-spacing:.16em}
.g{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}figure{margin:0}img{width:100%;display:block}
figcaption{opacity:.5;padding:4px 0}</style><div class=g>` +
  frames.map((f) => `<figure><img src="${f.name}.png"><figcaption>${f.t}s &middot; lit ${f.litPct}% &middot; warm ${f.warmPct}%</figcaption></figure>`).join('') +
  '</div>');
console.log('\n contact sheet -> shots/first-minute/contact-sheet.html');

console.log('\n======================================================');
if (fails.length) {
  console.log(`${fails.length} LESSONS LAND TOO LATE OR NOT AT ALL:`);
  for (const f of fails) console.log('  -', f);
  process.exit(1);
}
console.log('first minute: every lesson is available without a word of text');
process.exit(0);
