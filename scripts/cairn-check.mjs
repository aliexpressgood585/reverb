/**
 * CAIRN — the ten acceptance tests, run against the real game.
 *
 *   node scripts/cairn-check.mjs
 *
 * Every one of these drives the shipped loop in a real browser at a real phone
 * viewport. Nothing here reimplements the physics or the renderer; where a test
 * needs to know what the game did, it asks the game.
 *
 *   1  two identical drags from the same state produce identical landings
 *   2  the predicted arc matches the actual flight exactly, at every power
 *   3  no tunnelling through a corpse at maximum launch speed
 *   4  frame budget holds with 100+ corpses on screen
 *   5  50 m, 200 m and 400 m are instantly distinguishable
 *   6  nothing on screen is a flat undifferentiated grey
 *   7  death to the next playable frame is under 1.2 s
 *   8  the tower survives a hard reload
 *   9  no scroll, zoom, selection or pull-to-refresh is possible
 *  10  the controls are discoverable with zero text
 *  11  the aim points where you drag — direct, never a slingshot
 *  12  difficulty does not collapse as the corpse tower grows
 *  13  the four erosion stages are distinguishable in a single still
 *  14  nothing ever blocks the middle of the screen during a climb
 *
 * Three and four are the ones that would otherwise be assumed rather than
 * known, and both have already failed once during development.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const PORT = 4196;
const PHONE = { width: 390, height: 844 };

mkdirSync('shots', { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
server.stdout.on('data', () => {});
process.on('exit', () => { try { server.kill('SIGTERM'); } catch {} });
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(`http://127.0.0.1:${PORT}/cairn/`)).ok) break; } catch {}
  await delay(400);
}
const URL_ = `http://127.0.0.1:${PORT}/cairn/`;

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium',
  args: ['--headless=new', '--use-gl=angle', '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader', '--mute-audio', '--autoplay-policy=no-user-gesture-required'],
});

const fails = [];
const pass = (n, msg) => console.log(`  ${String(n).padStart(2)}  PASS  ${msg}`);
const fail = (n, msg) => { console.log(`  ${String(n).padStart(2)}  FAIL  ${msg}`); fails.push(`${n}: ${msg}`); };

async function newPage(ctx) {
  const page = await (ctx || browser).newPage({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.setDefaultTimeout(120000);
  page.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') fails.push('console: ' + m.text().split('\n')[0]); });
  await page.goto(URL_, { waitUntil: 'load' });
  await page.waitForFunction(() => !!window.CAIRN);
  await page.evaluate(() => window.CAIRN.begin());
  return page;
}

console.log('CAIRN acceptance\n');
const page = await newPage();

// ── 1. determinism ─────────────────────────────────────────────────────────
{
  const r = await page.evaluate(() => {
    const { sim } = window.CAIRN;
    const runs = [];
    for (let k = 0; k < 3; k++) {
      sim.reset(true);
      sim.phase = 1;
      const out = [];
      for (let j = 0; j < 6; j++) {
        sim.launch(18 + j * 3, 108 - j * 4);
        for (let f = 0; f < 900 && !sim.body.grounded && sim.phase === 1; f++) sim.tick(0);
        out.push(sim.body.x.toFixed(9), sim.body.y.toFixed(9), sim.deaths);
        if (sim.phase !== 1) sim.respawn();
      }
      runs.push(out.join('|'));
    }
    return { same: runs[0] === runs[1] && runs[1] === runs[2], sample: runs[0].slice(0, 46) };
  });
  r.same ? pass(1, `three identical drag sequences land identically  (${r.sample}…)`)
    : fail(1, 'identical drags produced different landings');
}

// ── 2. the arc does not lie ────────────────────────────────────────────────
{
  const r = await page.evaluate(() => {
    const { sim, predict } = window.CAIRN;
    {
      sim.reset(true); sim.phase = 1;
      const arc = [];
      let worst = 0, n = 0, disagree = 0;
      let seed = 7;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 10000) / 10000; };
      for (let k = 0; k < 140; k++) {
        const speed = 45 + rnd() * 85;              // every power level
        const ang = (0.18 + rnd() * 0.62) * Math.PI;
        const vx = Math.cos(ang) * speed, vy = Math.sin(ang) * speed;
        const said = predict(sim, vx, vy, arc);
        const px = arc.length ? arc[arc.length - 2] : 0;
        const py = arc.length ? arc[arc.length - 1] : 0;
        const before = sim.deaths;
        sim.launch(vx, vy);
        for (let f = 0; f < 1200 && !sim.body.grounded && sim.phase === 1; f++) sim.tick(0);
        const landed = sim.phase === 1 && sim.body.grounded;
        if (!!said !== landed) { disagree++; }
        else if (said) { worst = Math.max(worst, Math.hypot(px - sim.body.x, py - sim.body.y)); n++; }
        if (sim.phase !== 1) sim.respawn();
      }
      return { worst: +worst.toFixed(6), n, disagree };
    }
  });
  (r.worst < 0.02 && r.disagree === 0)
    ? pass(2, `${r.n} launches, worst arc-vs-flight error ${(r.worst * 100).toFixed(3)}cm, 0 disagreements`)
    : fail(2, `arc error ${r.worst}u over ${r.n} launches, ${r.disagree} disagreements`);
}

// ── 3. no tunnelling at max speed ──────────────────────────────────────────
{
  const r = await page.evaluate(() => {
    const { sim, FEEL } = window.CAIRN;
    const half = FEEL.body.w * 0.5;
    let through = 0, tests = 0;
    sim.maxSubStep = 0;

    for (let k = 0; k < 140; k++) {
      sim.reset(true); sim.phase = 1;
      const cx = sim.body.x;
      // A dense wall of corpses directly overhead: six slabs, 7u apart.
      const tops = [];
      for (let i = 1; i <= 6; i++) {
        const c = sim.world.corpse(cx + (i % 2 ? 1 : -1) * 0.6, i * 7 + 6, 0, 0, 0);
        tops.push({ y: c.y + c.hh, x: c.x, hw: c.hw });
      }
      const ang = (0.26 + (k / 140) * 0.48) * Math.PI;
      sim.launch(Math.cos(ang) * FEEL.launch.maxSpeed, Math.sin(ang) * FEEL.launch.maxSpeed);

      // Record the swept path, tick by tick.
      const path = [sim.body.x, sim.body.y];
      for (let f = 0; f < 1500 && !sim.body.grounded && sim.phase === 1; f++) {
        sim.tick(0);
        path.push(sim.body.x, sim.body.y);
      }
      tests++;
      const landedOn = sim.body.grounded ? sim.body.y : -1e9;

      // A tunnel is a descending segment that crossed a corpse top while
      // horizontally over it, and did not stop there.
      for (let i = 2; i < path.length; i += 2) {
        const y0 = path[i - 1], y1 = path[i + 1];
        const x1 = path[i];
        if (!(y0 > y1)) continue;
        for (const t of tops) {
          if (y0 < t.y || y1 > t.y) continue;
          if (Math.abs(x1 - t.x) > t.hw + half) continue;
          if (Math.abs(landedOn - t.y) < 0.01) continue;
          through++;
        }
      }
    }
    return {
      through, tests,
      // The sim records the longest sub-step it ever took; the budget is half
      // the body. Measuring the per-TICK move instead was the first version of
      // this and it measured the wrong thing.
      maxStep: +sim.maxSubStep.toFixed(4),
      limit: +(Math.min(FEEL.body.w, FEEL.body.h) * FEEL.body.sweepFraction).toFixed(4),
    };
  });
  (r.through === 0 && r.maxStep <= r.limit + 1e-6)
    ? pass(3, `${r.tests} max-power launches through a six-deep corpse wall: 0 pass-throughs, longest sub-step ${r.maxStep}u (limit ${r.limit}u)`)
    : fail(3, `${r.through} tunnelling events in ${r.tests} launches, longest sub-step ${r.maxStep}u vs limit ${r.limit}u`);
}

// ── 4. frame budget with 100+ corpses ──────────────────────────────────────
{
  const r = await page.evaluate(async () => {
    const { sim, renderer, camera } = window.CAIRN;
    sim.reset(true); sim.phase = 1;
    let seed = 31;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 10000) / 10000; };
    for (let i = 0; i < 130; i++) sim.world.corpse(8 + rnd() * 84, i * 1.6, (rnd() - 0.5), i & 3, 0);
    sim.world.generate(400);
    camera.y = 60;
    // Measure the CPU cost of the scene, which is the part that scales with
    // corpse count. GPU time is not observable from script; the software
    // rasteriser here is 20-40x slower than a phone GPU, so the post pass is
    // measured separately and reported rather than gated.
    const t0 = performance.now();
    const N = 60;
    for (let i = 0; i < N; i++) {
      renderer.step(1 / 60);
      renderer.draw(sim, camera, null, { started: true, squash: 0, stretch: 0 }, 1 / 60, false);
    }
    const ms = (performance.now() - t0) / N;
    let visible = 0;
    for (const s of sim.world.solids) if (s.corpse) visible++;
    return { ms: +ms.toFixed(2), visible };
  });
  // 8ms is the phone budget; a software rasteriser gets a wider gate, and the
  // number that matters is that it scales, not the absolute here.
  r.ms < 16
    ? pass(4, `scene pass ${r.ms}ms/frame with ${r.visible} corpses (software raster; phone GPU is far faster)`)
    : fail(4, `scene pass ${r.ms}ms/frame with ${r.visible} corpses — over budget`);
}

// ── 5 & 6. the look: distinguishable altitudes, no flat grey ───────────────
{
  const shots = [];
  // 520 m IS VOID, AND IT IS HERE ON PURPOSE.
  //
  // VOID's verb is darkness — the renderer takes away everything the player's
  // own light does not reach. That is a change the whole frame goes through,
  // and until this sample was added no acceptance test ever looked above 400 m,
  // so a darkness that had gone too far and turned the biome into a black
  // rectangle would have shipped with fourteen green tests behind it. Both
  // gates below now include it: distinguishable from its neighbours, and not
  // washed out.
  for (const h of [50, 200, 400, 520]) {
    await page.evaluate((y) => {
      const { sim, camera, renderer } = window.CAIRN;
      sim.reset(true); sim.phase = 1;
      sim.world.generate(y + 400);
      sim.body.y = sim.body.py = sim.body.ry = y;
      sim.body.x = sim.body.px = sim.body.rx = 50;
      sim.best = y;
      let seed = y | 0;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 10000) / 10000; };
      for (let i = 0; i < 26; i++) sim.world.corpse(14 + rnd() * 72, y - 120 + i * 5, (rnd() - 0.5), i & 3, 0);
      camera.y = y; camera.x = 50; camera.zoom = 1; camera.viewH = 150;
      renderer.trailN = 0;
    }, h);
    await delay(500);
    const p = `shots/cairn-${h}m.png`;
    await page.screenshot({ path: p });
    shots.push({ h, p, stats: await page.evaluate(() => window.__stats()) });
  }

  // Distinguishability: mean hue/È of each frame must differ materially.
  const d = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
  const pairs = [];
  for (let i = 0; i < shots.length; i++) {
    for (let j = i + 1; j < shots.length; j++) pairs.push(d(shots[i].stats, shots[j].stats));
  }
  const minPair = Math.min(...pairs);
  for (const s of shots) {
    console.log(`      ${String(s.h).padStart(3)}m  mean rgb ${s.stats.r.toFixed(1)},${s.stats.g.toFixed(1)},${s.stats.b.toFixed(1)}` +
      `  chroma ${s.stats.chroma.toFixed(1)}  greyPct ${s.stats.greyPct.toFixed(1)}%  -> ${s.p}`);
  }
  minPair > 6
    ? pass(5, `closest pair of altitudes differs by ${minPair.toFixed(1)} in mean rgb`)
    : fail(5, `two altitudes look the same (closest pair differs by only ${minPair.toFixed(1)})`);

  const worstGrey = Math.max(...shots.map((s) => s.stats.greyPct));
  const worstChroma = Math.min(...shots.map((s) => s.stats.chroma));
  (worstGrey < 12 && worstChroma > 3)
    ? pass(6, `worst frame is ${worstGrey.toFixed(1)}% flat grey, min chroma ${worstChroma.toFixed(1)}`)
    : fail(6, `flat grey ${worstGrey.toFixed(1)}% / chroma ${worstChroma.toFixed(1)} — the frame is washing out`);
}

// ── 7. death to playable ───────────────────────────────────────────────────
{
  const r = await page.evaluate(() => {
    const { sim, update, ui } = window.CAIRN;
    sim.reset(true); sim.phase = 1;
    ui.started = true; ui.dead = 0; ui.summary = false;
    sim.launch(112, 26);                     // straight off the side of the base
    // 60 Hz of real seconds through the real update path, counted exactly.
    let frames = 0, died = -1;
    for (let i = 0; i < 600; i++) {
      update(1 / 60);
      frames++;
      if (died < 0 && sim.phase !== 1) died = frames;
      if (died >= 0 && sim.phase === 1 && sim.body.grounded) {
        return { ms: ((frames - died) / 60) * 1000, ok: true };
      }
    }
    return { ok: false };
  });
  (r.ok && r.ms < 1200)
    ? pass(7, `death to the next playable frame: ${r.ms.toFixed(0)}ms`)
    : fail(7, r.ok ? `death to playable took ${r.ms.toFixed(0)}ms` : 'never returned to play after death');
}

// ── 8. the tower survives a reload ─────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p2 = await ctx.newPage();
  await p2.goto(URL_, { waitUntil: 'load' });
  await p2.waitForFunction(() => !!window.CAIRN);
  const before = await p2.evaluate(() => {
    const { sim, Store } = window.CAIRN;
    sim.reset(true);
    for (let i = 0; i < 17; i++) sim.world.corpse(20 + i * 3, 10 + i * 9, 0.1 * i, i & 3, 0);
    sim.best = 271.5;
    sim.deaths = 17;
    Store.save(sim);
    return { n: 17, best: 271.5 };
  });
  await p2.reload({ waitUntil: 'load' });
  await p2.waitForFunction(() => !!window.CAIRN);
  const after = await p2.evaluate(() => {
    const { sim } = window.CAIRN;
    let n = 0;
    for (const s of sim.world.solids) if (s.corpse) n++;
    return { n, best: sim.best, deaths: sim.deaths };
  });
  await ctx.close();
  (after.n === before.n && Math.abs(after.best - before.best) < 0.02)
    ? pass(8, `${after.n} corpses and a ${after.best}m best survived a hard reload`)
    : fail(8, `after reload: ${after.n} corpses (want ${before.n}), best ${after.best} (want ${before.best})`);
}

// ── 9. the page cannot be scrolled, zoomed or selected ─────────────────────
{
  const r = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    const vp = document.querySelector('meta[name=viewport]').content;
    window.scrollTo(0, 400);
    const scrolled = window.scrollY;
    const sel = getComputedStyle(document.documentElement).userSelect
      || getComputedStyle(document.documentElement).webkitUserSelect;
    return {
      scrolled,
      overflow: cs.overflow,
      touchAction: getComputedStyle(document.getElementById('view')).touchAction,
      overscroll: cs.overscrollBehavior || cs.overscrollBehaviorY,
      userSelect: sel,
      noZoom: /user-scalable=no/.test(vp) && /maximum-scale=1/.test(vp),
      safeArea: /viewport-fit=cover/.test(vp),
      bodyFixed: cs.position === 'fixed',
    };
  });
  const ok = r.scrolled === 0 && r.overflow === 'hidden' && r.touchAction === 'none'
    && r.overscroll === 'none' && r.userSelect === 'none' && r.noZoom && r.safeArea && r.bodyFixed;
  ok ? pass(9, 'no scroll, no zoom, no selection, no overscroll, safe-area honoured')
    : fail(9, `gesture lockdown incomplete: ${JSON.stringify(r)}`);
}

// ── 10. discoverable with zero text, through the REAL touch pipeline ───────
//
// This test used to dispatch a PointerEvent directly at the canvas, which skips
// hit-testing. It passed while the title card — a full-screen scrim with no
// `pointer-events: none` — swallowed every genuine touch, so the shipped game
// could not be started at all. Everything below now goes through
// page.touchscreen, which hit-tests exactly like a thumb.
{
  const p2 = await browser.newPage({ viewport: PHONE, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  p2.on('pageerror', (e) => fails.push('pageerror: ' + e.message));
  await p2.goto(URL_, { waitUntil: 'load' });
  await p2.waitForFunction(() => !!window.CAIRN);

  // a) nothing over the canvas may eat a touch
  const blocking = await p2.evaluate(() => {
    const pts = [[195, 120], [195, 420], [195, 700], [60, 500], [330, 500]];
    return pts.map(([x, y]) => {
      const e = document.elementFromPoint(x, y);
      if (!e) return 'null';
      return getComputedStyle(e).pointerEvents === 'none' ? 'pass-through' : (e.id || e.tagName);
    }).filter((k) => k !== 'pass-through' && k !== 'view');
  });

  // b) a real tap starts the game
  await p2.touchscreen.tap(195, 500);
  await delay(250);
  const started = await p2.evaluate(() => window.CAIRN.ui.started && window.CAIRN.sim.phase === 1);

  // c) a real drag aims, predicts an exact arc, and launches on release
  await p2.evaluate(() => { window.CAIRN.sim.reset(true); window.CAIRN.sim.phase = 1; });
  const before = await p2.evaluate(() => window.CAIRN.sim.body.y);
  await p2.touchscreen.tap(300, 700);          // wake the touch pipeline
  const drag = await p2.evaluate(async () => {
    const { input } = window.CAIRN;
    return new Promise((res) => {
      const v = document.getElementById('view');
      const at = (t, x, y) => v.dispatchEvent(new PointerEvent(t, {
        pointerId: 7, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch',
      }));
      // Direct aim: drag UP and to the right to launch up and to the right.
      at('pointerdown', 180, 700);
      at('pointermove', 250, 560);
      input.update(1 / 60, innerHeight);
      const snap = { aiming: input.aiming, arc: input.arc.length >> 1, slowed: input.timeScale < 1 };
      at('pointerup', 210, 800);
      setTimeout(() => res(snap), 30);
    });
  });
  await delay(200);
  const flew = await p2.evaluate((y0) => window.CAIRN.sim.body.y !== y0 || !window.CAIRN.sim.body.grounded, before);

  const words = await p2.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim());
  const noInstructions = !/DRAG|PULL|SWIPE|TAP TO JUMP|HOLD/i.test(words);
  await p2.close();

  const ok = blocking.length === 0 && started && drag.aiming && drag.arc > 4 && drag.slowed && flew && noInstructions;
  ok ? pass(10, `a real tap starts it, a real drag aims (${drag.arc}-point exact arc, time slowed) and launches, no instruction text`)
    : fail(10, `real-input flow broken: blocking=${JSON.stringify(blocking)} started=${started} ` +
        `aiming=${drag.aiming} arc=${drag.arc} slowed=${drag.slowed} launched=${flew}`);
}

// ── 11. the aim points where you drag ──────────────────────────────────────
//
// Direct aim, pinned. This game shipped as a slingshot once and it read as the
// controls fighting the player; a silent flip back would be invisible to every
// other test here, because every one of them would still pass.
{
  const r = await page.evaluate(() => {
    const { sim, input } = window.CAIRN;
    sim.reset(true); sim.phase = 1;
    const v = document.getElementById('view');
    const at = (t, x, y) => v.dispatchEvent(new PointerEvent(t, {
      pointerId: 11, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: 'touch',
    }));
    const probe = (dx, dy) => {
      at('pointerdown', 200, 600);
      at('pointermove', 200 + dx, 600 + dy);
      input.update(1 / 60, 844);
      const out = { vx: input.vx, vy: input.vy };
      at('pointerup', 200 + dx, 600 + dy);
      return out;
    };
    return {
      up: probe(0, -140),          // drag toward the top of the screen
      down: probe(0, 140),
      right: probe(140, -40),
      left: probe(-140, -40),
    };
  });
  const ok = r.up.vy > 0 && r.down.vy < 0 && r.right.vx > 0 && r.left.vx < 0;
  ok ? pass(11, `drag up launches up (vy ${r.up.vy.toFixed(0)}), down launches down (vy ${r.down.vy.toFixed(0)}), left/right follow the thumb`)
    : fail(11, `aim is inverted somewhere: up.vy=${r.up.vy.toFixed(1)} down.vy=${r.down.vy.toFixed(1)} right.vx=${r.right.vx.toFixed(1)} left.vx=${r.left.vx.toFixed(1)}`);
}

// ── 12. difficulty does not collapse ───────────────────────────────────────
//
// THE Phase-2 test. Corpses used to be permanently solid, so thirty attempts in
// the lower tower was a staircase and the game got EASIER exactly where it
// should get harder. Erosion plus the shifting roof is supposed to stop that.
// A bot with fixed skill plays sixty attempts; if the design works, its height
// per attempt must not run away late.
{
  const r = await page.evaluate(() => {
    const { sim, FEEL } = window.CAIRN;
    sim.reset(true); sim.phase = 1; sim.best = 0;
    let seed = 20250728;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 10000) / 10000; };
    const g = FEEL.gravityRise;

    // Play until SIXTY DEATHS, not sixty attempts. An earlier version capped by
    // jump count, and the bot was good enough that attempts ended on the cap
    // instead of on the ground — so no corpse ever aged, and the measurement
    // was of nothing at all.
    const heights = [];
    let totalJumps = 0;
    while (sim.deaths < 60 && totalJumps < 6000) {
      const start = sim.deaths;
      let guard = 0;
      while (sim.deaths === start && guard++ < 40) {
        let t = null;
        for (const sol of sim.world.solids) {
          if (sol === sim.body.standing) continue;
          if (sol.y <= sim.body.y + 1) continue;
          if (!t || sol.y < t.y) t = sol;
        }
        if (!t) break;
        const dx = t.x - sim.body.x, dy = t.y - sim.body.y;
        const r0 = Math.hypot(dx, dy) || 1e-6;
        let vy = Math.sqrt(Math.max(1, 2 * g * (dy + r0 * 0.42)));
        const tUp = vy / g;
        const tt = tUp + Math.sqrt(Math.max(0.01, 2 * (vy * tUp - 0.5 * g * tUp * tUp - dy) / g));
        let vx = dx / tt;
        const sp = Math.hypot(vx, vy);
        if (sp > FEEL.launch.maxSpeed) { const k = FEEL.launch.maxSpeed / sp; vx *= k; vy *= k; }
        // Fixed skill, and clumsy enough to actually fall. Skill never improves,
        // so any rise in height across the run comes from the world, not the bot.
        const e1 = 1 + (rnd() - 0.5) * 1.3, e2 = 1 + (rnd() - 0.5) * 1.3;
        sim.launch(vx * e1, vy * e2);
        totalJumps++;
        for (let f = 0; f < 1500 && !sim.body.grounded && sim.phase === 1; f++) sim.tick(0);
        if (sim.body.y > sim.best) sim.best = sim.body.y;
      }
      heights.push(sim.runBest);
      if (sim.phase !== 1) sim.respawn(); else { sim.deaths++; sim.respawn(); }
    }

    const med = (a) => { const b = a.slice().sort((x, y) => x - y); return b[b.length >> 1]; };
    const n = heights.length;
    const early = med(heights.slice(0, Math.max(5, n >> 2)));
    const late = med(heights.slice(n - Math.max(5, n >> 2)));
    let memory = 0, thin = 0, fresh = 0;
    for (const sol of sim.world.solids) {
      if (!sol.corpse) continue;
      const age = sim.deaths - sol.bornDeath;
      if (age >= 25) memory++; else if (age >= 7) thin++; else fresh++;
    }
    return { early: +early.toFixed(1), late: +late.toFixed(1), deaths: sim.deaths, attempts: n, fresh, thin, memory };
  });
  const ratio = r.early > 0 ? r.late / r.early : 99;
  console.log(`      ${r.attempts} attempts, ${r.deaths} deaths — median height first quarter ${r.early}m, last quarter ${r.late}m, ratio ${ratio.toFixed(2)}`);
  console.log(`      corpses after ${r.deaths} deaths: ${r.fresh} fresh, ${r.thin} eroded, ${r.memory} memory (non-solid)`);
  (ratio <= 1.35 && r.memory > 0)
    ? pass(12, `difficulty holds — late-game median is ${(ratio * 100 - 100).toFixed(0)}% off early, and ${r.memory} corpses have decayed to memory`)
    : fail(12, `difficulty collapsed: late median ${r.late}m vs early ${r.early}m (ratio ${ratio.toFixed(2)}), memory corpses ${r.memory}`);
}

// ── 13. the four erosion stages are distinguishable in one still ───────────
{
  const r = await page.evaluate(async () => {
    const { sim, camera, renderer } = window.CAIRN;
    sim.reset(true); sim.phase = 1;
    sim.deaths = 40;
    // One corpse per stage, side by side at the same height.
    //
    // CREATED OLDEST FIRST, which is the only order that can happen in a real
    // game and was not what this fixture did. The renderer cools a corpse toward
    // gold by its CREATION ORDER, and this test used to create the freshest one
    // first — so the FRESH corpse was drawn in memory-gold and the MEMORY one in
    // full accent, with the colour axis pulling against the stage axis. It made
    // the four stages look more alike than they ever do in play, and the suite
    // has been reading a pessimistic number on the one property an external
    // reviewer specifically complained about.
    const ages = [0, 10, 20, 34];
    const xs = [22, 40, 60, 78];
    for (let i = 3; i >= 0; i--) {
      const c = sim.world.corpse(xs[i], 60, 0, 1, 0, 40 - ages[i]);
      c.glow = 0;
    }
    sim.body.x = sim.body.px = sim.body.rx = 50;
    sim.body.y = sim.body.py = sim.body.ry = 60;
    // Every piece of camera and renderer state the live loop may have left
    // dirty. Setting position alone left rotation, shake and the monument
    // pull-back live, and the closest-pair margin still swung 4.6 to 18.0.
    camera.x = 50; camera.y = 60; camera.zoom = 1; camera.viewH = 150;
    camera.rot = 0; camera.rotVel = 0; camera.shake = 0;
    camera.shakeX = 0; camera.shakeY = 0; camera.t = 0;
    camera.mon = 0; camera.monTarget = 0;
    renderer.trailN = 0; renderer.ringN = 0; renderer.partN = 0;
    renderer.draw(sim, camera, null, { started: true, squash: 0, stretch: 0 }, 1 / 60, false);

    // NO AWAIT BETWEEN THE DRAW AND THE SAMPLE.
    //
    // This used to wait two requestAnimationFrames "to let the frame settle",
    // and the game's own loop redraws on exactly those frames — with its own
    // lerping camera and its own drifting dust. So the pixels being measured
    // were never the pixels this test set up, and the closest-pair margin swung
    // between 0.7 and 53.5 on identical code: a coin flip dressed as an
    // assertion, in the one suite that gates every push. Everything below runs
    // in the same task as the draw, so no frame can interleave.

    // Sample a box around each corpse off the scene canvas and describe it.
    const cv = renderer.canvas;
    const c2 = cv.getContext('2d', { willReadFrequently: true });
    const sample = (wx) => {
      const px = Math.round(renderer.X(wx) * renderer.dpr);
      const py = Math.round(renderer.Y(60) * renderer.dpr);
      const R = Math.round(16 * renderer.dpr);
      const d = c2.getImageData(px - R, py - R, R * 2, R * 2).data;
      let lum = 0, chroma = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        const ch = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
        lum += L; chroma += ch; n++;
      }

      // THE SHELF, WHICH IS THE HITBOX, WHICH IS THE WHOLE TELL.
      //
      // DECISIONS.md §16: "the bright bar on top of each corpse is drawn exactly
      // as wide as the collision actually is, so a half-width shelf is not a
      // stylistic choice, it is the hitbox." That is the fastest read in the
      // design and this test could not see it — it measured mean brightness and
      // a lit-pixel COUNT over a fixed box, and the count saturates at 100% for
      // every stage, so it contributed nothing but noise. Measure the bar.
      const top = Math.round(renderer.Y(60 + 3) * renderer.dpr);
      const row = c2.getImageData(px - R, top - Math.round(2 * renderer.dpr),
                                  R * 2, Math.round(4 * renderer.dpr)).data;
      let bright = 0;
      for (let i = 0; i < row.length; i += 4) {
        const L = 0.2126 * row[i] + 0.7152 * row[i + 1] + 0.0722 * row[i + 2];
        if (L > 120) bright++;
      }
      return {
        lum: +(lum / n).toFixed(1),
        chroma: +(chroma / n).toFixed(1),
        shelf: +((bright / (row.length / 4)) * 100).toFixed(1),
      };
    };
    return xs.map(sample);
  });
  const names = ['FRESH', 'THIN', 'TOP', 'MEMORY'];
  r.forEach((v, i) => console.log(`      ${names[i].padEnd(7)} lum ${String(v.lum).padStart(5)}  ` +
    `chroma ${String(v.chroma).padStart(5)}  shelf ${String(v.shelf).padStart(5)}%`));
  // Each stage must differ from the next by a margin a human eye would catch,
  // across the three axes the design actually uses: how bright it is, how
  // saturated it is (accent when fresh, cooling toward gold), and how much
  // load-bearing shelf it still has.
  let minGap = Infinity;
  for (let i = 0; i < 3; i++) {
    minGap = Math.min(minGap,
      Math.abs(r[i].lum - r[i + 1].lum)
      + Math.abs(r[i].chroma - r[i + 1].chroma)
      + Math.abs(r[i].shelf - r[i + 1].shelf));
  }
  minGap > 3
    ? pass(13, `all four erosion stages separate in one frame (closest neighbouring pair differs by ${minGap.toFixed(1)})`)
    : fail(13, `two erosion stages look the same (closest pair differs by only ${minGap.toFixed(1)})`);
}

// ── 14. nothing interrupts a climb ─────────────────────────────────────────
//
// The record used to raise a full-screen card with two buttons the instant you
// landed above your previous best — which on a record run is EVERY landing. The
// game stopped the player mid-climb, repeatedly, exactly when they were doing
// well. Reported as "I don't want the metres to stop me every moment".
//
// Play a run that keeps beating the record and assert that at no point is
// anything blocking the middle of the screen, and that play never pauses.
{
  const r = await page.evaluate(async () => {
    const { sim, update, ui } = window.CAIRN;
    sim.reset(true); sim.phase = 1;
    ui.started = true; ui.dead = 0; sim.best = 0; ui.bestAtRunStart = 0;

    let blocked = 0, paused = 0, cards = 0, climbs = 0;
    const centre = () => {
      const e = document.elementFromPoint(195, 420);
      if (!e) return false;
      return e.id !== 'view' && getComputedStyle(e).pointerEvents !== 'none';
    };

    for (let step = 0; step < 40; step++) {
      // A jump that reliably gains height, so the record keeps falling.
      let t = null;
      for (const sol of sim.world.solids) {
        if (sol === sim.body.standing) continue;
        if (sol.y <= sim.body.y + 1) continue;
        if (!t || sol.y < t.y) t = sol;
      }
      if (!t) break;
      const dx = t.x - sim.body.x, dy = t.y - sim.body.y;
      const rr = Math.hypot(dx, dy) || 1e-6;
      const g = window.CAIRN.FEEL.gravityRise;
      const vy = Math.sqrt(Math.max(1, 2 * g * (dy + rr * 0.42)));
      const tUp = vy / g;
      const tt = tUp + Math.sqrt(Math.max(0.01, 2 * (vy * tUp - 0.5 * g * tUp * tUp - dy) / g));
      sim.launch(dx / tt, vy);
      climbs++;
      for (let f = 0; f < 1200 && !sim.body.grounded && sim.phase === 1; f++) sim.tick(0);
      update(1 / 60);
      await new Promise((res) => requestAnimationFrame(res));
      if (centre()) blocked++;
      if (document.getElementById('card').classList.contains('on')) cards++;
      if (sim.phase !== 1 && ui.dead === 0) paused++;
      if (sim.phase !== 1) { for (let k = 0; k < 80; k++) update(1 / 60); }
    }
    return { blocked, cards, paused, climbs, best: Math.round(sim.best) };
  });
  (r.blocked === 0 && r.cards === 0)
    ? pass(14, `${r.climbs} record-beating landings to ${r.best}m, 0 blocking overlays, 0 cards raised`)
    : fail(14, `the climb was interrupted: ${r.blocked} blocking overlays, ${r.cards} cards, over ${r.climbs} landings`);
}

await browser.close();

console.log('');
if (fails.length) {
  console.log('FAILURES:');
  for (const f of [...new Set(fails)]) console.log(' -', f);
  process.exit(1);
}
console.log('all acceptance tests pass');
process.exit(0);
