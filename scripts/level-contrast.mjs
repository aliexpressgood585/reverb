/**
 * Level variety, measured and photographed.
 *
 * Three stills from each level into shots/levels/, plus a numeric signature for
 * each: how open the space is, how tall, what you are walking on, what is making
 * the noise, and what mechanic only exists there. If two levels score alike,
 * they look alike, and the run gets boring in the middle.
 *
 *   node scripts/level-contrast.mjs
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4205;
mkdirSync('shots/levels', { recursive: true });

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
const page = await browser.newPage({ viewport: { width: 1120, height: 630 } });
page.setDefaultTimeout(300000);
page.on('pageerror', (e) => console.log('ERR', e.message));
await page.goto(`http://127.0.0.1:${PORT}/?lm=768&msaa=0&nosound=1`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.REVERB);
await page.evaluate(() => window.REVERB.setFixedStep(1 / 60));

const step = (n) => page.evaluate((k) => { for (let i = 0; i < k; i++) window.REVERB.frame(); }, n);
const enter = (l, o) => page.evaluate(({ l, o }) => window.REVERB.debugEnter(l, o), { l, o });
const hold = (k, on) => page.evaluate(({ k, on }) => window.REVERB.input.synth(k, on), { k, on });
const shot = async (n) => {
  const t = Date.now();
  await page.screenshot({ path: `shots/levels/${n}.png`, timeout: 300000 });
  console.log('   ', n, Date.now() - t + 'ms');
};

/** Everything about a level that can be known without looking at it. */
const signature = () => page.evaluate(() => {
  const g = window.REVERB;
  const L = g.level;
  const b = L.bounds;

  // Openness: median distance from a floor sample to the nearest sound-blocking
  // wall. A tunnel scores around 2 m; a cavern scores tens.
  const walls = L.walls.filter((w) => w.blocksSound);
  const dists = [];
  for (const f of L.floors) {
    const w = f.x1 - f.x0;
    const d = f.z1 - f.z0;
    if (w * d < 6) continue;
    for (let i = 1; i <= 3; i++) {
      for (let j = 1; j <= 3; j++) {
        const px = f.x0 + (w * i) / 4;
        const pz = f.z0 + (d * j) / 4;
        let best = 1e9;
        for (const wl of walls) {
          const dx = wl.x1 - wl.x0, dz = wl.z1 - wl.z0;
          const l2 = dx * dx + dz * dz;
          let t = l2 > 0 ? ((px - wl.x0) * dx + (pz - wl.z0) * dz) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          const q = Math.hypot(px - (wl.x0 + dx * t), pz - (wl.z0 + dz * t));
          if (q < best) best = q;
        }
        if (best < 1e8) dists.push(best);
      }
    }
  }
  dists.sort((a, x) => a - x);
  const openness = dists.length ? dists[Math.floor(dists.length / 2)] : 0;

  // Surface mix by area.
  const names = ['CONCRETE', 'WATER', 'BALLAST', 'CARPET', 'STEEL', 'TILE'];
  const area = {};
  let total = 0;
  for (const f of L.floors) {
    const a = (f.x1 - f.x0) * (f.z1 - f.z0);
    // Later, higher floors overlay earlier ones, so weight by height order.
    area[names[f.surface]] = (area[names[f.surface]] || 0) + a;
    total += a;
  }
  const mix = {};
  for (const [k, v] of Object.entries(area)) {
    const pct = Math.round((100 * v) / total);
    if (pct >= 5) mix[k] = pct;
  }

  const enemies = {};
  for (const e of L.def.enemies) enemies[e.type] = (enemies[e.type] || 0) + 1;

  return {
    name: L.def.name,
    footprint: `${Math.round(b.max.x - b.min.x)}x${Math.round(b.max.z - b.min.z)}`,
    ceiling: +(b.max.y).toFixed(1),
    openness: +openness.toFixed(1),
    aspect: +((b.max.x - b.min.x) / (b.max.z - b.min.z)).toFixed(2),
    surfaces: mix,
    enemies,
    drips: L.def.drips.length,
    machines: L.def.machines.length,
    triggers: (L.def.triggers || []).length,
    rt60: L.def.space.rt60,
    signature: L.def.signature || '(none declared)',
  };
});

// Three viewpoints per level: where you arrive, the middle of it, and the way out.
const SHOTS = [
  { tag: 'a-arrival', from: 'spawn' },
  { tag: 'b-middle', from: 'middle' },
  { tag: 'c-exit', from: 'exit' },
];

const sigs = [];
for (let lvl = 0; lvl < 5; lvl++) {
  await enter(lvl, {});
  const sig = await signature();
  sigs.push(sig);
  console.log(`\n${sig.name}`);

  for (const s of SHOTS) {
    await page.evaluate(({ from }) => {
      const g = window.REVERB;
      const d = g.level.def;
      const b = g.level.bounds;
      let x, z, yaw;
      if (from === 'spawn') { x = d.spawn.x; z = d.spawn.z; yaw = d.spawn.yaw; }
      else if (from === 'exit') {
        x = d.exit.x; z = d.exit.z;
        yaw = Math.atan2(-(d.spawn.x - x), -(d.spawn.z - z));
      } else {
        x = (d.spawn.x + d.exit.x) / 2;
        z = (d.spawn.z + d.exit.z) / 2;
        yaw = Math.atan2(-(d.exit.x - x), -(d.exit.z - z));
      }
      g.player.spawn(x, z, yaw);
      g.player.pitch = -0.09;
      // Let the level's own noise sources fire, so each still shows the thing
      // that actually lights that place: drips here, the plant there.
      g.dripTimers = g.dripTimers.map(() => 0.02);
      g.machinePhase = g.machinePhase.map(() => 0.02);
      g.sound.emit('step', g.player.position, { gain: 0.62, surface: g.surfaceAt(x, z) });
    }, s);
    await step(2);
    await hold('forward', true);
    await step(34);
    await hold('forward', false);
    await step(6);
    await shot(`${lvl + 1}-${sig.name.toLowerCase().replace(/[^a-z]+/g, '-')}-${s.tag}`);
  }
}

await browser.close();

// ------------------------------------------------------------------ report
const pad = (s, n) => String(s).padEnd(n);
console.log('\n== level signatures ==================================');
console.log(pad('level', 13), pad('footprint', 10), pad('ceil', 6), pad('open', 6),
  pad('rt60', 6), pad('drips', 6), pad('mach', 5), pad('trig', 5), 'ground');
for (const s of sigs) {
  const ground = Object.entries(s.surfaces).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}%`).join(', ');
  console.log(pad(s.name, 13), pad(s.footprint, 10), pad(s.ceiling, 6), pad(s.openness, 6),
    pad(s.rt60, 6), pad(s.drips, 6), pad(s.machines, 5), pad(s.triggers, 5), ground);
}
console.log('\nunique mechanic per level:');
for (const s of sigs) console.log(' ', pad(s.name, 13), s.signature);

// Any two levels whose openness, ceiling and ground all agree will read as the
// same room with different furniture.
const fails = [];
for (let i = 0; i < sigs.length; i++) {
  for (let j = i + 1; j < sigs.length; j++) {
    const a = sigs[i], b = sigs[j];
    const openRatio = Math.max(a.openness, b.openness) / Math.max(0.1, Math.min(a.openness, b.openness));
    const ceilRatio = Math.max(a.ceiling, b.ceiling) / Math.max(0.1, Math.min(a.ceiling, b.ceiling));
    const topA = Object.entries(a.surfaces).sort((x, y) => y[1] - x[1])[0]?.[0];
    const topB = Object.entries(b.surfaces).sort((x, y) => y[1] - x[1])[0]?.[0];
    if (openRatio < 1.35 && ceilRatio < 1.25 && topA === topB) {
      fails.push(`${a.name} and ${b.name} read alike: openness ${a.openness}/${b.openness}, ` +
        `ceiling ${a.ceiling}/${b.ceiling}, both mostly ${topA}`);
    }
  }
}

writeFileSync('shots/levels/contact-sheet.html',
  `<!doctype html><meta charset=utf-8><title>REVERB level contrast</title>
<style>body{background:#000;color:#dce3e8;font:12px ui-monospace,monospace;margin:24px;letter-spacing:.18em}
h2{font-weight:400;letter-spacing:.4em;font-size:13px;opacity:.7;margin:28px 0 8px}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}img{width:100%;display:block}</style>` +
  sigs.map((s, i) => `<h2>0${i + 1} ${s.name} &mdash; ${s.footprint} m, ceiling ${s.ceiling} m, openness ${s.openness} m</h2><div class=row>` +
    SHOTS.map((sh) => `<img src="${i + 1}-${s.name.toLowerCase().replace(/[^a-z]+/g, '-')}-${sh.tag}.png">`).join('') +
    '</div>').join('\n'));

console.log('\n contact sheet -> shots/levels/contact-sheet.html');
console.log('\n======================================================');
if (fails.length) {
  console.log(`${fails.length} PAIRS TOO ALIKE:`);
  for (const f of fails) console.log('  -', f);
  process.exit(1);
}
console.log('levels: each one reads as its own place');
process.exit(0);
