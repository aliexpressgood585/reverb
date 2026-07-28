/**
 * Audio verification by measurement.
 *
 * Nobody involved in building this game has heard it. So every voice is
 * rendered offline through the exact graph the game plays through, measured,
 * and checked against thresholds. Failures are printed and the process exits
 * non-zero.
 *
 *   node scripts/audio-check.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4201;
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
    '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required',
    '--mute-audio'],
});
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('ERR', e.message));

await page.goto(`http://127.0.0.1:${PORT}/?lm=256&msaa=0&nosound=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.REVERB && !!window.REVERB.audioProbe);

const r = await page.evaluate(() => window.REVERB.audioProbe());
await browser.close();

// ---------------------------------------------------------------- reporting

const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 8) => String(v).padStart(n);
const fails = [];
const check = (ok, label, detail) => {
  if (!ok) fails.push(`${label} — ${detail}`);
  return ok ? ' ok ' : 'FAIL';
};

console.log('\n== impulse responses ==================================');
console.log(pad('space', 14), num('declared'), num('measured'), num('len'), '  verdict');
for (const [name, s] of Object.entries(r.spaces)) {
  const tol = Math.max(0.15, s.declared * 0.2);
  const ok = s.measured !== null && Math.abs(s.measured - s.declared) <= tol;
  console.log(pad(name, 14), num(s.declared), num(s.measured), num(s.lengthSec),
    ' ', check(ok, `RT60 ${name}`, `declared ${s.declared}s, measured ${s.measured}s`));
}
{
  const t = r.spaces['THE TUNNEL'].measured;
  const m = r.spaces['MAINTENANCE'].measured;
  console.log(' ', check(t >= 1.5 && t <= 3.0, 'tunnel RT60 band', `${t}s outside 1.5–3.0s`),
    ' tunnel in 1.5–3.0s');
  console.log(' ', check(m < 0.8, 'small-room RT60', `${m}s is not under 0.8s`),
    ' maintenance under 0.8s');
}

console.log('\n== voice levels (dBFS, through limiter) ===============');
console.log(pad('voice', 14), num('peak'), num('rms'), '  clip');
const V = r.voices;
const order = Object.entries(V).sort((a, b) => b[1].peakDb - a[1].peakDb);
for (const [name, v] of order) {
  console.log(pad(name, 14), num(v.peakDb), num(v.rmsDb), '  ', v.clipped ? 'CLIP' : '-');
}

const loudest = order[0][0];
console.log('\n ', check(loudest === 'shot', 'loudness order',
  `loudest voice is "${loudest}", expected "shot"`), ' the shot is the loudest thing in the game');

const ambientGap = V.shot.peakDb - r.ambient.peakDb;
console.log(' ', check(ambientGap >= 25, 'ambient headroom',
  `bed is only ${ambientGap.toFixed(1)} dB under the shot`),
  ` ambient bed ${ambientGap.toFixed(1)} dB under the shot (want >= 25)`);

const stepGap = V.shot.peakDb - V.step.peakDb;
const stepAboveAmbient = V.step.peakDb - r.ambient.peakDb;
console.log(' ', check(stepGap > 4 && stepAboveAmbient > 8, 'footstep placement',
  `step is ${stepGap.toFixed(1)} dB under the shot and ${stepAboveAmbient.toFixed(1)} dB over the bed`),
  ` walking step sits ${stepGap.toFixed(1)} dB under the shot, ${stepAboveAmbient.toFixed(1)} dB over the bed`);

const sneakGap = V.step.peakDb - V['step-sneak'].peakDb;
console.log(' ', check(sneakGap >= 6, 'sneak differential',
  `sneaking is only ${sneakGap.toFixed(1)} dB quieter than walking`),
  ` sneaking is ${sneakGap.toFixed(1)} dB quieter than walking (want >= 6)`);

const clippers = Object.entries(V).filter(([, v]) => v.clipped).map(([k]) => k);
console.log(' ', check(clippers.length === 0, 'clipping',
  `over 1.0: ${clippers.join(', ')}`), ' nothing exceeds 1.0');

// C50 >= +1 dB: the direct sound must arrive clearly on top of its own tail.
// Demanding more than that from a 2.7-second tunnel would mean building a
// tunnel that does not sound like one — real spaces this size sit near zero.
console.log('\n== wet / dry (C50 clarity is the pass/fail) ===========');
for (const [name, w] of Object.entries(r.wetDry)) {
  const ok = w.clarity50Db >= 1;
  console.log(pad(name, 14), 'dryRms', num(w.dryRmsDb), ' wetRms', num(w.wetRmsDb),
    ' C50', num(w.clarity50Db), ' ',
    check(ok, `clarity ${name}`,
      `C50 is ${w.clarity50Db} dB; the tail is burying the direct sound`));
}

console.log('\n== spatial ===========================================');
const p = r.panning;
console.log(' source 90 deg right : R-L =', p.rightMinusLeftDb, 'dB');
console.log(' source 90 deg left  : R-L =', p.leftMinusRightDb, 'dB');
console.log(' source dead ahead   : imbalance =', p.frontImbalanceDb, 'dB');
console.log(' ', check(p.rightMinusLeftDb >= 6, 'pan right',
  `only ${p.rightMinusLeftDb} dB of separation`), ' right side favours the right channel');
console.log(' ', check(p.leftMinusRightDb <= -6, 'pan left',
  `only ${p.leftMinusRightDb} dB of separation`), ' left side favours the left channel');
console.log(' ', check(p.frontImbalanceDb <= 2.5, 'pan centre',
  `${p.frontImbalanceDb} dB off centre for a source dead ahead`), ' centred source stays centred');

console.log('\n======================================================');
if (fails.length) {
  console.log(`${fails.length} FAILED:`);
  for (const f of fails) console.log('  -', f);
  process.exit(1);
}
console.log('audio: all checks pass');
process.exit(0);
