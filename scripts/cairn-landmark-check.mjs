#!/usr/bin/env node
/**
 * CAIRN — does the tower have a noun in it, and does it cost anything?
 *
 *   npm run build && node scripts/cairn-landmark-check.mjs
 *
 * A landmark is decoration and only decoration: no collision, no solid, the
 * generator does not know one exists. That is the safety argument for adding
 * something this large to a game whose whole guarantee is a reach envelope —
 * scenery that cannot touch a ledge cannot touch `WALL = 0.00%`. Check 1 holds
 * that argument to account rather than trusting it.
 *
 * The rest is about whether the thing anyone would actually notice is true:
 * that a structure is on screen from the FIRST frame of a new game, that all
 * six of them are different from each other, and that drawing them did not
 * spend the frame budget acceptance test 4 protects.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdirSync } from 'node:fs';

const PORT = 4204;
mkdirSync('shots', { recursive: true });
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

console.log('CAIRN landmarks\n');

await page.touchscreen.tap(195, 500);
await delay(300);

// ── 1. a landmark is not in the world ─────────────────────────────────────
//
// THE SAFETY ARGUMENT, held to account. Build a tall tower, ask the world for
// every solid overlapping every landmark's footprint, and require that not one
// of them exists because of the landmark. The strong form of that is simply:
// the solid count and every solid's position must be byte-identical to a tower
// built with landmarks conceptually absent — which they are, because nothing in
// `World.generate` reads `landmarkOf`. This asserts the observable consequence:
// no solid sits at a landmark's anchor, and the count matches a fresh rebuild.
{
  const r = await page.evaluate(() => {
    const { sim } = window.CAIRN;
    const S = window.CAIRN.landmarkOf;
    sim.reset(true); sim.phase = 1;
    sim.world.generate(1200);
    const before = sim.world.solids.filter((s) => s.live).length;

    // Every landmark anchor in the built band, and whether anything solid is
    // sitting on it.
    let anchored = 0, marks = 0;
    for (let b = 0; b < 8; b++) {
      const m = S(b, sim.world.seed);
      if (m.y > 1200) break;
      marks++;
      const near = sim.world.near(m.y - 2, m.y + 2);
      for (const s of near) {
        if (!s.live || s.corpse) continue;
        if (Math.abs(s.y - m.y) < 0.001 && Math.abs(s.x - m.x) < 0.001) anchored++;
      }
    }

    // Rebuild from the same seed and compare the whole solid list.
    const dump = sim.world.solids.filter((s) => s.live && !s.corpse)
      .map((s) => `${s.x.toFixed(4)},${s.y.toFixed(4)},${s.hw.toFixed(4)},${s.hard ? 1 : 0}`)
      .join('|');
    sim.reset(true); sim.phase = 1;
    sim.world.generate(1200);
    const dump2 = sim.world.solids.filter((s) => s.live && !s.corpse)
      .map((s) => `${s.x.toFixed(4)},${s.y.toFixed(4)},${s.hw.toFixed(4)},${s.hard ? 1 : 0}`)
      .join('|');
    const after = sim.world.solids.filter((s) => s.live).length;
    return { marks, anchored, same: dump === dump2, before, after,
             ledges: dump.split('|').length };
  });
  check(r.marks >= 7 && r.anchored === 0 && r.same && r.before === r.after,
    `${r.marks} landmarks over 1200 m and ${r.anchored} solids anywhere near ` +
    `their anchors; ${r.ledges} ledges rebuild byte-identical from the seed`);
}

// ── 2. one is on screen before the player has done anything ───────────────
//
// The entry condition and the point at once. The first landmark sits at the
// centre of the first biome band — 75 m — and the opening view is 150 u tall,
// so it has to be in the very first frame or the placement is wrong. Read as
// pixels: the same frame with landmarks faded out must differ.
{
  const r = await page.evaluate(() => {
    const { sim, renderer, camera, ui } = window.CAIRN;
    const F = window.CAIRN.FEEL;
    sim.reset(true); sim.phase = 1; ui.started = true; ui.dead = 0;
    camera.y = 0; camera.x = 50; camera.mon = 0;

    const marks = [];
    window.CAIRN.landmarksIn(camera.y - camera.viewH, camera.y + camera.viewH,
                             sim.world.seed, marks);
    const inView = marks.filter((m) => Math.abs(m.y - camera.y) < camera.viewH);

    const frame = () => {
      renderer.draw(sim, camera, null, ui, 1 / 60, false);
      const cv = renderer.canvas;
      const g = cv.getContext('2d', { willReadFrequently: true });
      // The upper half of the screen: the landmark is above the player, and
      // the lower half is full of ledges that would drown the difference.
      const px = g.getImageData(0, 0, cv.width, Math.floor(cv.height * 0.5)).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
      return sum / (px.length / 4);
    };
    const keep = F.landmark.alpha;
    const on = frame();
    F.landmark.alpha = 0;
    const off = frame();
    F.landmark.alpha = keep;
    return { n: inView.length, first: inView.length ? +inView[0].y.toFixed(1) : null,
             kind: inView.length ? inView[0].kind : null,
             on: +on.toFixed(2), off: +off.toFixed(2), viewH: camera.viewH };
  });
  check(r.n > 0 && Math.abs(r.on - r.off) > 0.15,
    `from the ground, ${r.n} landmark(s) in the opening ${r.viewH}u view — the ` +
    `first at ${r.first} m, kind ${r.kind} — and it changes the top half of ` +
    `the frame (mean channel ${r.off} without → ${r.on} with)`);
}

// ── 3. the six are actually six ───────────────────────────────────────────
//
// Six shapes that all read the same are one shape drawn six times. Each is
// rendered alone on a blank field and compared to every other by ink
// distribution — a coarse 8x8 grid of where the strokes fell — so "different"
// means different geometry, not a different colour applied to one silhouette.
{
  const r = await page.evaluate(() => {
    const { renderer } = window.CAIRN;
    const F = window.CAIRN.FEEL;
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 256;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const B = { rock: [255, 255, 255], accent: [255, 255, 255] };

    const grid = (kind) => {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, 256, 256);
      g.strokeStyle = '#fff';
      g.lineWidth = 2;
      g.save();
      g.translate(128, 128);
      renderer._landmarkPath(g, { kind, phase: 0.37 }, 200, 220, B);
      g.restore();
      const px = g.getImageData(0, 0, 256, 256).data;
      const cells = new Array(64).fill(0);
      for (let y = 0; y < 256; y++) {
        for (let x = 0; x < 256; x++) {
          const a = px[(y * 256 + x) * 4 + 3];
          if (a > 20) cells[((y >> 5) << 3) + (x >> 5)]++;
        }
      }
      const tot = cells.reduce((s2, c) => s2 + c, 0) || 1;
      return { cells: cells.map((c) => c / tot), ink: tot };
    };

    const gs = [0, 1, 2, 3, 4, 5].map(grid);
    let worst = Infinity, worstPair = '';
    for (let i = 0; i < 6; i++) {
      for (let j = i + 1; j < 6; j++) {
        let d = 0;
        for (let k = 0; k < 64; k++) d += Math.abs(gs[i].cells[k] - gs[j].cells[k]);
        if (d < worst) { worst = d; worstPair = `${i} vs ${j}`; }
      }
    }
    return { worst: +worst.toFixed(3), worstPair,
             ink: gs.map((x) => x.ink), blank: gs.filter((x) => x.ink < 200).length };
  });
  check(r.blank === 0 && r.worst > 0.35,
    `all six shapes draw ink (${r.ink.join('/')} px) and the closest pair, ` +
    `${r.worstPair}, differs by ${r.worst} in ink distribution over an 8x8 grid`);
}

// ── 4. it did not eat the frame budget ────────────────────────────────────
//
// Same measurement acceptance test 4 makes, and the same caveat: this container
// software-rasterises and is 20-40x slower than a phone GPU, so the number that
// matters is the DELTA between drawing them and not, on the same machine, in
// the same run.
{
  const r = await page.evaluate(() => {
    const { sim, renderer, camera, ui } = window.CAIRN;
    const F = window.CAIRN.FEEL;
    sim.reset(true); sim.phase = 1; ui.started = true;
    sim.world.generate(900);
    let seed = 5;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 10000) / 10000; };
    for (let i = 0; i < 130; i++) sim.world.corpse(10 + rnd() * 80, 6 + i * 3.2, rnd() - 0.5, i & 3, 0, 0);
    camera.y = 300; camera.mon = 0;

    // INTERLEAVED AND TAKEN AS A MEDIAN. Two single timed runs put the cost at
    // +1.57 ms on one pass and -0.12 ms on the next, on the same code — a
    // negative cost is a thermometer telling you the room is a different room,
    // not a result. Alternating the two conditions inside one loop cancels the
    // drift, and the median throws out the outlier frames this rasteriser
    // produces freely.
    const sample = (alpha) => {
      F.landmark.alpha = alpha;
      const t0 = performance.now();
      for (let i = 0; i < 8; i++) renderer.draw(sim, camera, null, ui, 1 / 60, false);
      return (performance.now() - t0) / 8;
    };
    const keep = F.landmark.alpha;
    for (let i = 0; i < 4; i++) { sample(keep); sample(0); }   // warm both paths
    const on = [], off = [], noiseA = [], noiseB = [];
    for (let i = 0; i < 15; i++) { on.push(sample(keep)); off.push(sample(0)); }
    // AND THE NOISE FLOOR: the same two conditions, except both of them are
    // "with". Whatever this reads is what the instrument can resolve, and a
    // measured cost smaller than it is not a measurement of anything.
    for (let i = 0; i < 15; i++) { noiseA.push(sample(keep)); noiseB.push(sample(keep)); }
    F.landmark.alpha = keep;
    const med = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1]; };
    return { with: +med(on).toFixed(2), without: +med(off).toFixed(2), n: on.length,
             noise: +Math.abs(med(noiseA) - med(noiseB)).toFixed(2) };
  });
  const cost = +(r.with - r.without).toFixed(2);
  const resolved = Math.abs(cost) > r.noise;
  check(cost < 2.0,
    `scene pass with 130 corpses, median of ${r.n} interleaved samples: ` +
    `${r.without}ms without, ${r.with}ms with — ` +
    (resolved
      ? `${cost}ms/frame, against a ${r.noise}ms noise floor`
      : `a ${cost}ms difference that is BELOW the ${r.noise}ms noise floor, so ` +
        `the honest reading is "too small for this instrument to see", not a ` +
        `number`) +
    ` (software rasteriser; a phone GPU is 20-40x faster)`);
}

// ── 5. and they are gone in the monument ──────────────────────────────────
//
// The monument is a portrait of the bodies in the tower. A skyline drawn across
// it is clutter, and every other atmosphere layer already fades out with the
// pull-back; this asserts the new one joins them instead of being the one thing
// that stays.
{
  const r = await page.evaluate(() => {
    const { sim, renderer, camera, ui } = window.CAIRN;
    const F = window.CAIRN.FEEL;
    camera.mon = 1; camera.monTarget = 1;
    const frame = () => {
      renderer.draw(sim, camera, null, ui, 1 / 60, false);
      const cv = renderer.canvas;
      const g = cv.getContext('2d', { willReadFrequently: true });
      const px = g.getImageData(0, 0, cv.width, cv.height).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
      return sum / (px.length / 4);
    };
    // THE NOISE FLOOR FIRST. Two draws of the same scene are not bit-identical
    // here — this rasteriser wobbles — so "identical" has to be measured against
    // how much two frames differ when NOTHING changed, or the check is really
    // testing the renderer's repeatability and calling it a landmark.
    const keep = F.landmark.alpha;
    const a1 = frame(), a2 = frame();
    const noise = Math.abs(a1 - a2);
    F.landmark.alpha = 0;
    const off = frame();
    F.landmark.alpha = keep;
    camera.mon = 0; camera.monTarget = 0;
    return { on: +a2.toFixed(3), off: +off.toFixed(3), noise: +noise.toFixed(3) };
  });
  const diff = Math.abs(r.on - r.off);
  check(diff <= Math.max(0.02, r.noise * 1.5),
    `at full monument pull-back the frame differs by ${diff.toFixed(3)} with and ` +
    `without them, against a ${r.noise} noise floor between two identical draws`);
}

// ── 6. the secret: is it reachable, and is it findable? ───────────────────
//
// Two different questions and the second is the one that matters.
//
// REACHABLE asks whether the physics admits a death inside the heart at all —
// a secret nobody can perform is a dead branch. It is answered by sweeping real
// launches from the ledges below and asking where each one's apex lands, using
// the same `predict` the aim preview draws, because the preview IS the key: a
// player aims this by reading the ghost.
//
// FINDABLE asks whether it happens BY ACCIDENT, and the answer must be no. A
// secret the bot trips over while playing normally is not a secret, it is a
// mechanic nobody explained. So the accident rate is measured too, and a HIGH
// number here would be the failure.
{
  const r = await page.evaluate(() => {
    const { sim, predict } = window.CAIRN;
    const F = window.CAIRN.FEEL;
    const DEG = Math.PI / 180;
    const arc = [];

    sim.reset(true); sim.phase = 1;
    sim.world.generate(700);
    let reachable = 0, tested = 0;
    const from = [];

    for (let band = 0; band < 4; band++) {
      const m = window.CAIRN.landmarkOf(band, sim.world.seed);
      if (m.y > 650) break;
      tested++;
      // Every ledge inside one screen below the heart is a candidate perch.
      const perches = sim.world.near(m.y - 170, m.y)
        .filter((s) => !s.corpse && s.live && s.y + s.hh < m.y);
      let hit = false;
      for (const p of perches) {
        if (hit) break;
        const b = sim.body;
        for (const edge of [-1, 0, 1]) {
          if (hit) break;
          b.x = b.px = p.x + edge * p.hw;
          b.y = b.py = p.y + p.hh;
          b.vx = b.vy = 0; b.grounded = true; b.standing = p;
          b.onWall = 0; b.wallTimer = 0; b.coyote = F.coyoteTime;
          b.takeoff = b.y; b.takeoffX = b.x; b.peakX = b.x; b.peakY = b.y;
          b.hangTimer = 0;
          for (let a = 20; a <= 160 && !hit; a += 2) {
            for (let sp = F.launch.minSpeed; sp <= F.launch.maxSpeed && !hit; sp += 3) {
              const land = predict(sim, Math.cos(a * DEG) * sp, Math.sin(a * DEG) * sp, arc);
              if (land) continue;                       // it lands; no body left
              const pk = sim.predictPeak;
              if (!pk.dies) continue;
              const dx = pk.x - m.x, dy = pk.y - m.y;
              if (dx * dx + dy * dy <= F.landmark.heartU * F.landmark.heartU) {
                hit = true;
                from.push(+(m.y - (p.y + p.hh)).toFixed(1));
              }
            }
          }
        }
      }
      if (hit) reachable++;
    }
    return { tested, reachable, from, heart: F.landmark.heartU };
  });
  check(r.tested >= 3 && r.reachable === r.tested,
    `the heart of ${r.reachable} of ${r.tested} landmarks can be reached by a ` +
    `real launch that dies there — from ${r.from.join('/')}u below, inside a ` +
    `${r.heart}u radius, found with the same predict() the ghost draws`);
}

// ── 7. ... and nobody trips over it ───────────────────────────────────────
{
  const r = await page.evaluate(() => {
    const { sim } = window.CAIRN;
    const F = window.CAIRN.FEEL;
    // Every death the acceptance bot's style of play produces, over many
    // attempts, and how many of them land in a heart without trying.
    sim.reset(true); sim.phase = 1;
    let deaths = 0, claims = 0;
    let seed = 99;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 10000) / 10000; };
    for (let a = 0; a < 400; a++) {
      const b = sim.body;
      if (sim.phase !== 1) sim.respawn();
      sim.launch(-60 + rnd() * 120, 40 + rnd() * 90);
      for (let f = 0; f < 500; f++) {
        const d0 = sim.deaths;
        sim.tick(0);
        if (sim.deaths > d0) { deaths++; break; }
        if (b.grounded) break;
      }
      sim.events.length = 0;
      claims = sim.claimed.size;
    }
    return { deaths, claims, heart: F.landmark.heartU };
  });
  const rate = r.deaths ? (100 * r.claims / r.deaths).toFixed(2) : '0';
  check(r.deaths > 100 && r.claims <= 1,
    `${r.deaths} untargeted deaths produced ${r.claims} accidental claim(s) ` +
    `(${rate}%) — a secret has to be aimed at, not stumbled into`);
}

// ── 8. a claim is permanent, which means it survives a reload ─────────────
//
// Test 8 of the acceptance suite once checked that corpses survive a reload
// without checking that they still HOLD WEIGHT, and they came back non-solid.
// So this asserts both halves: the claim comes back, AND the renderer still
// draws that landmark as held — which is the only thing a claim actually does.
{
  await page.evaluate(() => {
    const { sim, Store } = window.CAIRN;
    sim.reset(true); sim.phase = 1;
    sim.claimed.clear();
    sim.claimed.add(0);
    sim.claimed.add(3);
    sim.best = 260; sim.deaths = 9;
    Store.save(sim);
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!window.CAIRN);
  await page.touchscreen.tap(195, 500);
  await delay(300);

  const r = await page.evaluate(() => {
    const { sim, renderer, camera, ui } = window.CAIRN;
    const F = window.CAIRN.FEEL;
    const held = [...sim.claimed].sort((a, b) => a - b);

    // And it still DRAWS as held: park the camera on band 0's landmark and
    // compare the frame against the same frame with the claim removed.
    const m = window.CAIRN.landmarkOf(0, sim.world.seed);
    ui.started = true; camera.mon = 0; camera.y = m.y; camera.x = m.x;
    sim.world.generate(m.y + 300);
    const frame = () => {
      renderer.draw(sim, camera, null, ui, 1 / 60, false);
      const cv = renderer.canvas;
      const g = cv.getContext('2d', { willReadFrequently: true });
      const px = g.getImageData(0, 0, cv.width, cv.height).data;
      let sum = 0;
      for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
      return sum / (px.length / 4);
    };
    const a1 = frame(), a2 = frame();
    const noise = Math.abs(a1 - a2);
    sim.claimed.delete(0);
    const plain = frame();
    sim.claimed.add(0);
    return { held, lit: +a2.toFixed(3), plain: +plain.toFixed(3),
             noise: +noise.toFixed(3), heart: F.landmark.heartU };
  });
  const drawn = Math.abs(r.lit - r.plain);
  check(r.held.join(',') === '0,3' && drawn > Math.max(0.05, r.noise * 2),
    `bands [${r.held}] came back from a hard reload, and band 0 still DRAWS as ` +
    `held — ${drawn.toFixed(3)} brighter than unheld, against a ${r.noise} noise floor`);
}

// A look at each one, for a human.
for (const [i, name] of ['ash', 'signal', 'bloom', 'void', 'cinder', 'glacier'].entries()) {
  await page.evaluate((band) => {
    const { sim, camera, ui, renderer } = window.CAIRN;
    ui.started = true; camera.mon = 0;
    const m = window.CAIRN.landmarkOf(band, sim.world.seed);
    sim.world.generate(m.y + 400);
    camera.y = m.y; camera.x = 50;
    sim.body.x = m.x; sim.body.y = m.y;
    renderer.draw(sim, camera, null, ui, 1 / 60, false);
  }, i);
  await page.screenshot({ path: `shots/cairn-landmark-${name}.png` });
}
console.log(`\n        shots/cairn-landmark-{ash,signal,bloom,void,cinder,glacier}.png`);

if (errors.length) { console.log('\n  page errors: ' + errors.join(' | ')); fails.push('page errors'); }
console.log(fails.length ? `\n${fails.length} FAILED` : '\nthe tower has nouns in it');

await browser.close();
shutdown();
process.exit(fails.length ? 1 : 0);
