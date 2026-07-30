/**
 * CAIRN — the save file, which is the most consequential thing in the project.
 *
 *   node scripts/cairn-store-check.mjs
 *
 * Every body in the tower was a decision: some gaps cannot be crossed, so a
 * player chooses where to die. Losing a save is not losing a score, it is losing
 * work. Six things are checked, and the first one is a bug that shipped:
 *
 *   1  a reload restores corpses that STILL HOLD WEIGHT. Schema 1 did not store
 *      bornDeath, so every corpse came back at age = deaths and was already
 *      MEMORY — drawn, and not solid. Acceptance test 8 passed the whole time
 *      because it checks that corpses exist, not that they are still platforms.
 *   2  a v1 save migrates exactly rather than being discarded
 *   3  a truncated write falls back to the backup slot
 *   4  outright garbage falls back to the backup slot and does not throw
 *   5  poisoned rows are dropped individually, not fatally — a corpse at x = 1e9
 *      does not just look wrong, it poisons the height buckets every collision
 *      query walks
 *   6  the 600-corpse cap keeps the newest, not the oldest
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = 4201;
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
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/cairn/`, { waitUntil: 'load' });
await page.waitForFunction(() => !!window.CAIRN);

const fails = [];
const check = (ok, msg) => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fails.push(msg); };
console.log('CAIRN save file\n');

// Shared helpers installed once in the page.
await page.evaluate(() => {
  const { FEEL } = window.CAIRN;
  window.T = {
    // Erosion stage from age in deaths, read off FEEL so it cannot drift.
    stage(deaths, born) {
      const E = FEEL.erosion, a = deaths - born;
      return a < E.fresh ? 0 : a < E.thin ? 1 : a < E.top ? 2 : 3;
    },
    // A tower with a known spread of ages: one corpse per death, in order.
    build(n) {
      const { sim } = window.CAIRN;
      sim.reset(true); sim.phase = 1;
      for (let i = 0; i < n; i++) {
        sim.world.corpse(20 + (i * 7) % 60, 8 + i * 4.5, 0.1, i & 3, 0, i);
        sim.deaths = i + 1;
      }
      sim.best = 8 + (n - 1) * 4.5;
    },
    stages() {
      const { sim } = window.CAIRN;
      const out = [0, 0, 0, 0];
      for (const s of sim.world.solids) if (s.corpse) out[window.T.stage(sim.deaths, s.bornDeath)]++;
      return out;
    },
    fresh() { window.CAIRN.sim.reset(true); window.CAIRN.sim.deaths = 0; window.CAIRN.sim.best = 0; },
  };
});

// ── 1. a reload restores platforms, not just pictures ─────────────────────
const rt = await page.evaluate(() => {
  const { sim, Store } = window.CAIRN;
  window.T.build(40);
  const before = { stages: window.T.stages(), best: sim.best, deaths: sim.deaths };
  Store.save(sim);
  window.T.fresh();
  const ok = Store.load(sim);
  return { ok, before, after: { stages: window.T.stages(), best: sim.best, deaths: sim.deaths } };
});
const sameStages = JSON.stringify(rt.before.stages) === JSON.stringify(rt.after.stages);
check(rt.ok && sameStages
  && Math.abs(rt.before.best - rt.after.best) < 0.02 && rt.before.deaths === rt.after.deaths,
  `round trip keeps erosion intact — ${JSON.stringify(rt.after.stages)} ` +
  `[fresh, thin, top, memory] of 40, best ${rt.after.best.toFixed(1)}m, ${rt.after.deaths} deaths`);

// ── 2. a v1 save migrates instead of being thrown away ────────────────────
const mig = await page.evaluate(() => {
  const { sim, Store } = window.CAIRN;
  window.T.build(40);
  // Re-encode as schema 1: four fields, no bornDeath. This is what is sitting
  // in localStorage on every phone that has already played.
  const c = [];
  for (const s of sim.world.solids) if (s.corpse) c.push(s.x, s.y, s.rot, s.pose);
  localStorage.setItem('cairn.v1', JSON.stringify({
    v: 1, seed: sim.world.seed, best: sim.best, deaths: sim.deaths, corpses: c,
  }));
  localStorage.removeItem('cairn.bak');
  window.T.fresh();
  const ok = Store.load(sim);
  let solid = 0;
  for (const s of sim.world.solids) if (s.corpse && window.T.stage(sim.deaths, s.bornDeath) < 3) solid++;
  return { ok, stages: window.T.stages(), solid, src: Store.loadStats.source };
});
check(mig.ok && mig.solid > 0 && mig.stages[3] < 40,
  `v1 migrates exactly — ${JSON.stringify(mig.stages)}, ${mig.solid} of 40 still load-bearing ` +
  `(before this change: 0)`);

// ── 3. a truncated write falls back ───────────────────────────────────────
const trunc = await page.evaluate(() => {
  const { sim, Store } = window.CAIRN;
  window.T.build(30);
  Store.save(sim);            // main
  window.T.build(50);
  Store.save(sim);            // main, and 30 demoted to backup
  const raw = localStorage.getItem('cairn.v1');
  localStorage.setItem('cairn.v1', raw.slice(0, Math.floor(raw.length * 0.6)));
  window.T.fresh();
  const ok = Store.load(sim);
  let n = 0;
  for (const s of sim.world.solids) if (s.corpse) n++;
  return { ok, n, src: Store.loadStats.source };
});
check(trunc.ok && trunc.src === 'backup' && trunc.n === 30,
  `a truncated save falls back to the backup (${trunc.n} corpses, from ${trunc.src})`);

// ── 4. garbage falls back and does not throw ──────────────────────────────
const junk = await page.evaluate(() => {
  const { sim, Store } = window.CAIRN;
  window.T.build(25);
  Store.save(sim);
  window.T.build(33);
  Store.save(sim);
  localStorage.setItem('cairn.v1', '{"v":2,"corpses":[1,2,3');   // half a write
  window.T.fresh();
  const ok = Store.load(sim);
  let n = 0;
  for (const s of sim.world.solids) if (s.corpse) n++;
  return { ok, n, src: Store.loadStats.source };
});
check(junk.ok && junk.src === 'backup' && junk.n === 25,
  `unparseable JSON falls back to the backup (${junk.n} corpses, from ${junk.src})`);

// ── 5. poisoned rows are dropped one at a time ────────────────────────────
const poison = await page.evaluate(() => {
  const { sim, Store } = window.CAIRN;
  window.T.build(20);
  Store.save(sim);
  const d = JSON.parse(localStorage.getItem('cairn.v1'));
  // NaN cannot be used as a fixture here: JSON.stringify turns it into null and
  // +null is 0, which is a perfectly legal x. Real corruption arrives as type
  // confusion or as absurd magnitudes, so that is what gets tested.
  d.corpses.push(1e9, 1e9, 0, 0, 0);          // off the map entirely
  d.corpses.push('abc', 40, 0, 1, 1);         // not a number at all
  d.corpses.push(50, -9999, 0, 2, 2);         // far below the base
  d.n = d.corpses.length / 5;
  localStorage.setItem('cairn.v1', JSON.stringify(d));
  window.T.fresh();
  const ok = Store.load(sim);
  let n = 0;
  for (const s of sim.world.solids) if (s.corpse) n++;
  return { ok, n, dropped: Store.loadStats.dropped, buckets: sim.world.buckets.size };
});
check(poison.ok && poison.n === 20 && poison.dropped === 3 && poison.buckets < 200,
  `${poison.dropped} poisoned rows dropped, ${poison.n} good ones kept, ` +
  `${poison.buckets} height buckets (an x=1e9 body would have made millions)`);

// ── 6. the cap keeps the newest ───────────────────────────────────────────
const cap = await page.evaluate(() => {
  const { sim, Store } = window.CAIRN;
  window.T.build(700);
  const highest = sim.best;
  Store.save(sim);
  window.T.fresh();
  Store.load(sim);
  let n = 0, top = 0;
  for (const s of sim.world.solids) if (s.corpse) { n++; top = Math.max(top, s.y); }
  return { n, top: Math.round(top), highest: Math.round(highest) };
});
check(cap.n === 600 && Math.abs(cap.top - cap.highest) < 6,
  `700 corpses store as ${cap.n}, and the ones kept are the newest ` +
  `(top body at ${cap.top}m of ${cap.highest}m)`);

if (errors.length) { console.log('  page errors: ' + errors.join(' | ')); fails.push('page errors'); }
console.log(fails.length ? `\n${fails.length} FAILED` : '\nthe save file holds');
await browser.close();
shutdown();
process.exit(fails.length ? 1 : 0);
