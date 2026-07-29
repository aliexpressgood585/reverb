import { FEEL, COLUMN, BIOME_SPAN } from './src/feel.js';
import { Sim, PHASE, EV, predict } from './src/sim.js';
import { Input } from './src/input.js';
import { Renderer, Camera } from './src/render.js';
import { Post } from './src/post.js';
import { Audio } from './src/audio.js';
import * as Store from './src/store.js';

/**
 * CAIRN — the loop.
 *
 * Fixed 120 Hz simulation with an accumulator and render interpolation. The
 * accumulator is the only place real time enters the game; everything below it
 * runs on exact steps, which is what makes two identical drags produce two
 * identical landings on any device at any frame rate.
 *
 * Rendering is Canvas2D into an offscreen canvas, then one WebGL pass that
 * grades it. When WebGL is unavailable the 2D canvas is shown directly and the
 * game is merely less pretty, never broken.
 */

const DT = FEEL.sim.dt;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ canvases

const view = document.getElementById('view');
const scene = document.createElement('canvas');

const sim = new Sim(0x1a2b3c);
const renderer = new Renderer(scene);
const camera = new Camera();
const audio = new Audio();
const post = Post.create(view);

if (!post) {
  // No WebGL: promote the 2D canvas into the page and skip the grade.
  view.replaceWith(scene);
  scene.id = 'view';
}
const surface = post ? view : scene;
surface.style.touchAction = 'none';

const input = new Input(surface, sim);

// --------------------------------------------------------------------- state

const ui = {
  squash: 0, squashVel: 0,
  flash: 0,
  bestFlash: 0,
  dead: 0,            // seconds since death, drives the return-to-base pan
  wash: 0,
  started: false,
  summary: false,
  toast: 0,
};

let dpr = 1;
let accum = 0;
let lastFrame = performance.now();
let paused = false;
let lastBiome = 0;

const el = {
  small: document.getElementById('height'),
  card: document.getElementById('card'),
  toast: document.getElementById('toast'),
  debug: document.getElementById('debug'),
  mute: document.getElementById('mute'),
};

function resize() {
  dpr = Math.min(devicePixelRatio || 1, 2);
  const w = innerWidth;
  const h = innerHeight;
  renderer.resize(w, h, dpr);
  if (post) post.resize(w, h, dpr);
}
addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 120));

// ---------------------------------------------------------------- haptics

function buzz(pattern) {
  if (reduced) return;
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* iOS: silent */ }
}

// -------------------------------------------------------------------- flow

function begin() {
  if (ui.started) return;
  ui.started = true;
  audio.unlock();
  sim.phase = PHASE.PLAY;
  hideCard();
}

/**
 * Death → the next playable frame, with no menu, no modal and no button. The
 * camera falls back to the base while the body crystallises, and control
 * returns well inside a second. Friction here is what kills a retry loop.
 */
function handleDeath() {
  ui.dead = 0.0001;
  ui.flash = 1;
  audio.death();
  buzz([60, 30, 90]);
  const b = sim.body;
  if (!reduced) renderer.burst(b.peakX, b.peakY, 22);
  camera.kick(1);
}

function finishDeath() {
  ui.dead = 0;
  sim.respawn();
  renderer.trailN = 0;
  Store.save(sim);
}

function newBest(h) {
  sim.best = h;
  ui.bestFlash = 1;
  audio.chime();
  ui.summary = true;
  showSummary();
}

// ------------------------------------------------------------------ cards

function showTitle() {
  el.card.className = 'on';
  el.card.innerHTML =
    `<h1>CAIRN</h1><p class="tag">EVERY DEATH LEAVES A STONE</p><p class="go">TOUCH TO BEGIN</p>`;
}
function hideCard() { el.card.className = ''; }

function showSummary() {
  el.card.className = 'on small';
  el.card.innerHTML =
    `<p class="idx">NEW HIGH</p><h1>${Math.round(sim.best)}m</h1>` +
    `<p class="tag">${sim.deaths} STONES BELOW YOU</p>` +
    `<div class="row"><button id="share">SHARE</button><button id="on">CLIMB</button></div>`;
  el.card.querySelector('#on').onpointerdown = (e) => { e.preventDefault(); ui.summary = false; hideCard(); };
  el.card.querySelector('#share').onpointerdown = async (e) => {
    e.preventDefault();
    const how = await Store.share(sim);
    toast(how === 'copied' ? 'COPIED TO CLIPBOARD'
      : how === 'downloaded' ? 'SAVED' : how === 'shared' ? '' : 'COULD NOT SHARE');
  };
}

function toast(msg) {
  if (!msg) return;
  el.toast.textContent = msg;
  el.toast.className = 'on';
  ui.toast = 2.2;
}

// ------------------------------------------------------------------- input

input.onTap = () => {
  if (!ui.started) begin();
  else if (ui.summary) { ui.summary = false; hideCard(); }
};
input.onChargeStart = () => { audio.charge(); buzz(8); };
input.onRelease = (p) => { audio.release(p); buzz(14); };
input.onLaunch = (vx, vy) => {
  if (!ui.started) { begin(); return; }
  if (ui.summary) return;
  sim.launch(vx, vy);
};

// ------------------------------------------------------------------ events

function drainEvents() {
  const e = sim.events;
  for (let i = 0; i < e.length; i += 4) {
    const kind = e[i];
    if (kind === EV.LAND) {
      const force = clamp(e[i + 1] / FEEL.maxFallSpeed, 0, 1);
      renderer.ring(e[i + 2], e[i + 3], force);
      audio.land(force);
      camera.kick(force);
      ui.squashVel -= force * 9;
      if (force > 0.45) buzz(26);
    } else if (kind === EV.DEATH) {
      handleDeath();
    } else if (kind === EV.LAUNCH) {
      ui.squashVel += 5;
    }
  }
  e.length = 0;
}

// -------------------------------------------------------------------- frame

const grade = { lift: [0, 0, 0], gain: [1, 1, 1] };

/**
 * The half of a frame that is not drawing. Split out so the acceptance harness
 * can drive the real transition logic at an exact cadence instead of waiting on
 * a software rasteriser running at three frames a second.
 */
function update(real) {
  input.update(real, innerHeight);
  if (input.aiming) audio.chargeTo(input.power);

  // Aiming slows time. The accumulator is fed scaled seconds; the STEP never
  // changes, so slow motion costs precision nothing.
  const scaled = real * input.timeScale;

  if (ui.dead > 0) {
    // The return to base: no simulation, just a fall of the camera.
    ui.dead += real;
    camera.y += (0 - camera.y) * Math.min(1, real * 6.5);
    camera.x += (COLUMN * 0.5 - camera.x) * Math.min(1, real * 5);
    if (ui.dead > FEEL.deathToPlayMs / 1000) finishDeath();
  } else {
    accum += scaled;
    if (accum > FEEL.sim.maxCatchUp) accum = FEEL.sim.maxCatchUp;
    let steps = 0;
    const aimDir = input.aiming ? Math.sign(input.vx) * Math.min(1, Math.abs(input.vx) / 40) : 0;
    while (accum >= DT && steps++ < 512) {
      accum -= DT;
      sim.tick(sim.body.grounded ? 0 : aimDir);
    }
    lastSteps = steps;
  }

  drainEvents();

  const b = sim.body;
  const alpha = clamp(accum / DT, 0, 1);
  b.rx = b.px + (b.x - b.px) * alpha;
  b.ry = b.py + (b.y - b.py) * alpha;

  if (sim.phase === PHASE.PLAY && !b.grounded && !reduced) renderer.pushTrail(b.rx, b.ry);
  if (sim.phase === PHASE.PLAY && b.y > sim.best && b.grounded && !ui.summary) newBest(b.y);

  // Title: a live scene, drifting slowly up whatever tower this player has.
  if (!ui.started) {
    camera.y += real * 11;
    if (camera.y > Math.max(sim.best, 140)) camera.y = -20;
    camera.x = COLUMN * 0.5 + Math.sin(camera.t * 0.25) * 6;
    camera.t += real;
  } else {
    camera.update(real, { x: b.rx, y: b.ry, vx: b.vx, vy: b.vy }, reduced);
  }

  // Squash & stretch, spring-returned.
  ui.squashVel += (-ui.squash) * FEEL.juice.squashSpring * real;
  ui.squashVel -= ui.squashVel * FEEL.juice.squashDamp * real;
  ui.squash = clamp(ui.squash + ui.squashVel * real, -FEEL.juice.squashMax, FEEL.juice.squashMax);

  ui.flash = Math.max(0, ui.flash - real * 9);
  ui.bestFlash = Math.max(0, ui.bestFlash - real * 1.6);
  if (ui.toast > 0) { ui.toast -= real; if (ui.toast <= 0) el.toast.className = ''; }

  // Biome crossing: a full-screen wash and a re-tuning of the ambient bed.
  const bi = Math.floor(Math.max(0, b.y) / BIOME_SPAN);
  if (bi !== lastBiome) { lastBiome = bi; ui.wash = 1; audio.wash(); }
  ui.wash = Math.max(0, ui.wash - real * 1.5);
  audio.setHeight(Math.max(0, b.y), bi);
}

function frame(now) {
  requestAnimationFrame(frame);
  if (paused) { lastFrame = now; return; }

  let real = (now - lastFrame) / 1000;
  lastFrame = now;
  if (real > 0.25) real = 0.25;      // a backgrounded tab must not fast-forward
  update(real);

  const b = sim.body;
  renderer.step(real);
  const B = renderer.draw(sim, camera, input, ui, real, reduced);

  if (post) {
    const speed = clamp(Math.abs(b.vy) / FEEL.maxFallSpeed, 0, 1);
    for (let i = 0; i < 3; i++) {
      grade.lift[i] = (B.bgTop[i] / 255) * 0.35 + ui.wash * (B.accent[i] / 255) * 0.10;
      grade.gain[i] = 1 + (B.accent[i] / 255 - 0.5) * 0.06;
    }
    post.render(scene, {
      time: now / 1000,
      speed: reduced ? 0 : speed,
      bloom: 0.52 + ui.bestFlash * 0.55,
      grain: reduced ? 0 : 0.03,
      barrel: reduced ? 0 : 0.035,
      vignette: 0.52,
      flash: ui.flash * 0.85,
      lift: grade.lift,
      gain: grade.gain,
      sat: B.sat,
    });
  }

  // The small readable counter. The huge one is drawn inside the scene so the
  // post chain grades it with everything else.
  const h = Math.max(0, Math.round(ui.started ? b.y : 0));
  if (h !== lastShown) { lastShown = h; el.small.textContent = ui.started ? `${h}m` : ''; }

  if (debugOn) drawDebug(real);
}

let lastShown = -1;
let lastSteps = 0;

// -------------------------------------------------------------------- pause

document.addEventListener('visibilitychange', () => {
  paused = document.hidden;
  audio.duck(document.hidden);
  if (document.hidden) { input.abort(); audio.stopCharge(); Store.save(sim); }
  else { lastFrame = performance.now(); accum = 0; }
});
addEventListener('pagehide', () => Store.save(sim));

// -------------------------------------------------------------------- debug

let debugOn = false;
let taps = 0;
let tapAt = 0;
addEventListener('pointerdown', (e) => {
  if (e.clientX > 90 || e.clientY > 90) { taps = 0; return; }
  const t = performance.now();
  taps = t - tapAt < 500 ? taps + 1 : 1;
  tapAt = t;
  if (taps >= 3) { debugOn = !debugOn; el.debug.className = debugOn ? 'on' : ''; taps = 0; }
}, true);

let fpsAccum = 0, fpsFrames = 0, fps = 0, worst = 0;
function drawDebug(real) {
  fpsAccum += real; fpsFrames++;
  worst = Math.max(worst, real * 1000);
  if (fpsAccum >= 0.5) { fps = fpsFrames / fpsAccum; fpsAccum = 0; fpsFrames = 0; }
  el.debug.textContent =
    `${fps.toFixed(0)}fps  ${(real * 1000).toFixed(1)}ms  peak ${worst.toFixed(1)}\n` +
    `solids ${sim.world.solids.length}  corpses ${sim.world.corpseCount}\n` +
    `steps ${lastSteps}  parts ${renderer.partN}  dpr ${dpr}\n` +
    `y ${sim.body.y.toFixed(1)}  vy ${sim.body.vy.toFixed(1)}  snap ${input.snapped.toFixed(2)}deg`;
}

// ---------------------------------------------------------------------- mute

el.mute.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  audio.unlock();
  audio.setMuted(!audio.muted);
  el.mute.textContent = audio.muted ? 'SOUND OFF' : 'SOUND ON';
});
el.mute.textContent = localStorage.getItem('cairn.mute') === '1' ? 'SOUND OFF' : 'SOUND ON';

// ---------------------------------------------------------------------- boot

Store.load(sim);
resize();
showTitle();
camera.y = 0;
requestAnimationFrame(frame);

// PWA. The icon is drawn at boot rather than shipped, so the repository holds
// no binary art asset and the manifest is still complete.
try {
  const manifest = {
    name: 'CAIRN', short_name: 'CAIRN',
    start_url: './', scope: './', display: 'standalone',
    orientation: 'portrait',
    background_color: '#04060B', theme_color: '#04060B',
    icons: [
      { src: Store.icon(192), sizes: '192x192', type: 'image/png' },
      { src: Store.icon(512), sizes: '512x512', type: 'image/png' },
      { src: Store.icon(512, true), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/json' }));
  document.head.appendChild(link);
  const fav = document.createElement('link');
  fav.rel = 'icon';
  fav.href = Store.icon(192);
  document.head.appendChild(fav);
} catch { /* manifest is a nice-to-have, never a blocker */ }

if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// The harness drives the real loop, never a copy of it.
window.CAIRN = {
  sim, input, camera, renderer, audio, post, FEEL, Store, predict,
  begin, frame, update, ui,
  step(n) { for (let i = 0; i < n; i++) sim.tick(0); },
  fire(vx, vy) { return sim.launch(vx, vy); },
};

/**
 * Frame statistics for the art-direction tests: mean colour, mean chroma, and
 * the percentage of the frame that is flat undifferentiated grey — a pixel with
 * almost no chroma sitting in the mid range, which is exactly the failure the
 * whole art pass exists to remove. Sampled from the surface actually on screen,
 * so it measures the graded image rather than the raw scene.
 */
window.__stats = function () {
  const src = post ? view : scene;
  const s = document.createElement('canvas');
  s.width = 160; s.height = 340;
  const c = s.getContext('2d', { willReadFrequently: true });
  c.drawImage(src, 0, 0, s.width, s.height);
  const d = c.getImageData(0, 0, s.width, s.height).data;
  let r = 0, g = 0, b = 0, chroma = 0, grey = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const R = d[i], G = d[i + 1], B = d[i + 2];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
    const ch = mx - mn;
    const lum = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    r += R; g += G; b += B; chroma += ch; n++;
    if (ch < 8 && lum > 25 && lum < 200) grey++;
  }
  return { r: r / n, g: g / n, b: b / n, chroma: chroma / n, greyPct: (grey / n) * 100 };
};
