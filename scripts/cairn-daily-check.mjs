/**
 * CAIRN — the Daily Climb. PHASE3 §5.
 *
 *   node scripts/cairn-daily-check.mjs
 *
 *   > Done when: it rolls correctly across a UTC midnight boundary from at least
 *   > three timezones, and the share card carries the date-seed so a recipient
 *   > plays the identical climb.
 *
 * Both halves are checked, plus the one that would quietly ruin a player's week:
 * that the daily tower and the endless tower never share storage. A daily seed is
 * thrown away tomorrow; an endless tower is a player's whole history.
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
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
console.log('CAIRN daily climb\n');

/** A page pinned to a timezone and a wall-clock instant. */
async function open(tz, iso) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true,
    hasTouch: true, timezoneId: tz,
  });
  const page = await ctx.newPage();
  if (iso) {
    // Pin Date to a fixed instant BEFORE any module runs, so the daily seed is
    // computed against it.
    await page.addInitScript((t) => {
      const fixed = new Date(t).getTime();
      const Real = Date;
      // eslint-disable-next-line no-global-assign
      Date = class extends Real {
        constructor(...a) { super(...(a.length ? a : [fixed])); }
        static now() { return fixed; }
      };
    }, iso);
  }
  await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.CAIRN);
  return { ctx, page };
}

// ── 1. the same tower everywhere on earth, at the same instant ────────────
//
// 2026-07-30T00:30:00Z is 30 minutes past UTC midnight. Locally that is the 30th
// in Auckland, the 30th in London and STILL THE 29TH in Los Angeles — so a
// local-date implementation would hand three players three different towers.
const instant = '2026-07-30T00:30:00Z';
const zones = ['Pacific/Auckland', 'Europe/London', 'America/Los_Angeles'];
const seeds = [];
for (const tz of zones) {
  const { ctx, page } = await open(tz, instant);
  seeds.push(await page.evaluate(() => {
    const d = window.CAIRN.Store.dailyDate();
    return { date: d, seed: window.CAIRN.Store.dailySeed(d), local: new Date().toString().slice(0, 15) };
  }));
  await ctx.close();
}
const agree = seeds.every((s) => s.date === seeds[0].date && s.seed === seeds[0].seed);
check(agree, `three timezones at ${instant} all get ${seeds[0].date} / seed ` +
  `${seeds[0].seed} — local dates were ${seeds.map((s) => s.local.slice(4, 10)).join(', ')}`);

// ── 2. it rolls at UTC midnight, not before and not after ─────────────────
const boundary = [];
for (const iso of ['2026-07-29T23:59:30Z', '2026-07-30T00:00:30Z']) {
  const { ctx, page } = await open('America/Los_Angeles', iso);
  boundary.push(await page.evaluate(() => {
    const d = window.CAIRN.Store.dailyDate();
    return { date: d, seed: window.CAIRN.Store.dailySeed(d) };
  }));
  await ctx.close();
}
check(boundary[0].date === '2026-07-29' && boundary[1].date === '2026-07-30'
  && boundary[0].seed !== boundary[1].seed,
  `rolls across UTC midnight: ${boundary[0].date} (${boundary[0].seed}) -> ` +
  `${boundary[1].date} (${boundary[1].seed})`);

// ── 3. the daily tower is a different tower ───────────────────────────────
const { ctx: c3, page: p3 } = await open('Europe/London', instant);
const towers = await p3.evaluate(() => {
  const { sim, setMode } = window.CAIRN;
  const shape = () => sim.world.solids.filter((s) => !s.corpse).slice(0, 8)
    .map((s) => `${s.x.toFixed(1)}@${s.y.toFixed(1)}`).join(',');
  setMode(false);
  const endless = { seed: sim.world.seed, shape: shape() };
  setMode(true);
  const daily = { seed: sim.world.seed, shape: shape(), date: sim.dailyDate };
  return { endless, daily };
});
check(towers.endless.seed !== towers.daily.seed && towers.endless.shape !== towers.daily.shape,
  `the daily seed builds a different tower (endless ${towers.endless.seed}, ` +
  `daily ${towers.daily.seed} for ${towers.daily.date})`);

// ── 4. the two towers never share storage ─────────────────────────────────
const isolated = await p3.evaluate(() => {
  const { sim, setMode, Store } = window.CAIRN;
  // Build an endless tower worth keeping.
  setMode(false);
  sim.reset(true); sim.phase = 1;
  for (let i = 0; i < 12; i++) { sim.world.corpse(30 + i, 10 + i * 5, 0, 0, 0, i); sim.deaths = i + 1; }
  sim.best = 111;
  Store.save(sim);

  // Play the daily and save it.
  setMode(true);
  sim.reset(true); sim.phase = 1;
  for (let i = 0; i < 3; i++) { sim.world.corpse(60, 8 + i * 4, 0, 0, 0, i); sim.deaths = i + 1; }
  sim.best = 22;
  Store.save(sim);

  // Come back. The endless tower must be untouched.
  setMode(false);
  const back = { best: sim.best, deaths: sim.deaths };
  setMode(true);
  const day = { best: sim.best, deaths: sim.deaths };
  return {
    back, day,
    keys: Object.keys(localStorage).filter((k) => k.startsWith('cairn.')).sort(),
  };
});
check(Math.abs(isolated.back.best - 111) < 0.05 && isolated.back.deaths === 12
  && Math.abs(isolated.day.best - 22) < 0.05 && isolated.day.deaths === 3,
  `endless survives a daily session intact (${isolated.back.best}m / ` +
  `${isolated.back.deaths} deaths) and the daily keeps its own (${isolated.day.best}m / ` +
  `${isolated.day.deaths})`);
check(isolated.keys.some((k) => k === 'cairn.v1') && isolated.keys.some((k) => k.includes('daily')),
  `separate slots on disk: ${isolated.keys.join(' ')}`);

// ── 5. the share card carries the seed ────────────────────────────────────
const shared = await p3.evaluate(async () => {
  const { sim, setMode } = window.CAIRN;
  setMode(true);
  sim.best = 305; sim.deaths = 9;
  // Intercept the share text rather than opening a share sheet.
  let text = null;
  const realShare = navigator.share;
  navigator.share = async (d) => { text = d.text; };
  const canShare = navigator.canShare;
  navigator.canShare = () => true;
  await window.CAIRN.Store.share(sim);
  navigator.share = realShare; navigator.canShare = canShare;
  return { text, date: sim.dailyDate };
});
check(!!shared.text && shared.text.includes(shared.date),
  `the share card carries the date-seed — "${shared.text}"`);

await c3.close();
console.log(fails.length ? `\n${fails.length} FAILED` : '\nthe daily climb holds');
await browser.close();
shutdown();
process.exit(fails.length ? 1 : 0);
