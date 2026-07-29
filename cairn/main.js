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
  toast: 0,
  banner: 0,
  recordCrossed: false,
  bestAtRunStart: 0,
  monument: false,
  // PHASE3 §3 — the first sixty seconds, instrumented. Milliseconds from the
  // touch that starts the run to the first time each thing ever happens. Read by
  // scripts/cairn-first-minute.mjs; nothing in the game reads them.
  beats: {},
  taught: false,
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
  best: document.getElementById('best'),
  debug: document.getElementById('debug'),
  mute: document.getElementById('mute'),
  monshare: document.getElementById('monshare'),
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

/** Stamp the first time something ever happens, in ms since the run began. */
function beat(name) {
  if (ui.beats[name] === undefined && ui.beats.start !== undefined) {
    ui.beats[name] = Math.round(performance.now() - ui.beats.start);
  }
}

function begin() {
  if (ui.started) return;
  ui.beats.start = performance.now();
  ui.started = true;
  audio.unlock();
  sim.phase = PHASE.PLAY;
  ui.bestAtRunStart = sim.best;
  ui.recordCrossed = false;
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
  const beat = sim.best > ui.bestAtRunStart + 0.5;
  sim.respawn();
  renderer.trailN = 0;
  Store.save(sim);
  ui.bestAtRunStart = sim.best;
  ui.recordCrossed = false;
  // The summary lands AFTER control has come back, so the retry is never gated.
  if (beat) showBanner();
}

/**
 * Crossing your own record is a FEELING, not a menu.
 *
 * This used to raise a full-screen card with two buttons the moment you landed
 * above your previous best — which, on any run that is beating your record, is
 * every single landing. The game stopped you mid-climb, repeatedly, at exactly
 * the moment you were doing well. Reported, correctly, as "I don't want the
 * metres to stop me every moment".
 *
 * Now the record updates silently, and the first time you pass it in a run you
 * get a bloom pulse, a rising tone and a tap on the wrist. Nothing to dismiss.
 */
function crossedRecord() {
  ui.bestFlash = 1;
  audio.chime();
  buzz(18);
}

// ------------------------------------------------------------------ cards

function showTitle() {
  el.card.className = 'on';
  el.card.innerHTML =
    `<h1>CAIRN</h1><p class="tag">EVERY DEATH LEAVES A STONE</p><p class="go">TOUCH TO BEGIN</p>`;
}
function hideCard() { el.card.className = ''; }

/**
 * The run summary, as a strip that fades on its own while the game is already
 * playable underneath it. It reports; it does not ask. SHARE is the only thing
 * in it that takes a touch, and ignoring it costs nothing.
 */
function showBanner() {
  el.best.innerHTML =
    `<span class="k">NEW HIGH</span><b>${Math.round(sim.best)}m</b>` +
    `<span class="k">${sim.deaths} STONES</span><button id="share">SHARE</button>`;
  el.best.className = 'on';
  ui.banner = 4.2;
  el.best.querySelector('#share').onpointerdown = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    ui.banner = 4.2;
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

/**
 * MONUMENT VIEW.
 *
 * Two fingers pull the camera all the way back to the whole lifetime tower —
 * every body you have left, from the base. No HUD, no numbers, nothing to read.
 * It is the emotional payoff of the corpse mechanic and it is the image that
 * explains this game in three seconds without a word, which is why the share
 * lives here.
 *
 * Only from the ground: opening it mid-flight would mean watching yourself die
 * from orbit.
 */
function monument(on) {
  if (on && ui.started && !sim.body.grounded) return;
  if (on === ui.monument) return;
  ui.monument = on;
  input.locked = on;
  camera.monTarget = on ? 1 : 0;
  camera.monTop = Math.max(sim.best, sim.runBest, sim.body.y, 60);
  document.body.className = on ? 'monument' : '';
  clearTimeout(monShareTimer);
  if (on) {
    monShareTimer = setTimeout(() => { el.monshare.className = 'on'; },
                               FEEL.monument.shareDelayMs);
  } else {
    el.monshare.className = '';
  }
}
let monShareTimer = 0;

/**
 * THE ONE TIME THE GAME EXPLAINS ITSELF.
 *
 * The first time a player ever stands on one of their own bodies, the camera
 * pulls back for a beat and comes home. That is the whole premise of the game
 * happening, and until now it happened off to the side of the screen with no
 * acknowledgement at all — a player could do it and not notice they had.
 *
 * No text, no pause, no control taken away: `input.locked` is deliberately not
 * touched, so a player who is already aiming keeps aiming. It fires once per
 * player, ever, and remembers that it did.
 */
function teach() {
  if (ui.taught || ui.monument) return;
  ui.taught = true;
  try { localStorage.setItem('cairn.taught', '1'); } catch { /* private mode */ }
  buzz([12, 40, 12]);
  camera.monTop = Math.max(sim.best, sim.body.y, 60);
  camera.monTarget = FEEL.monument.teachPull;
  setTimeout(() => { if (!ui.monument) camera.monTarget = 0; }, FEEL.monument.teachMs);
}
try { ui.taught = localStorage.getItem('cairn.taught') === '1'; } catch { /* private mode */ }

input.onMonument = () => monument(!ui.monument);
input.onTap = () => {
  if (ui.monument) { monument(false); return; }
  if (!ui.started) begin();
};

el.monshare.addEventListener('pointerdown', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  const how = await Store.share(sim);
  if (how !== 'shared') toast(how === 'copied' ? 'COPIED' : 'SAVED');
});
input.onChargeStart = () => { audio.charge(); buzz(8); };
input.onRelease = (p) => { audio.release(p); buzz(14); };
input.onLaunch = (vx, vy) => {
  if (!ui.started) { begin(); return; }
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
      beat('firstDeath');
      handleDeath();
    } else if (kind === EV.LAUNCH) {
      beat('firstLaunch');
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
  if (sim.phase === PHASE.PLAY && b.grounded && b.y > sim.best) {
    sim.best = b.y;
    if (!ui.recordCrossed) { ui.recordCrossed = true; crossedRecord(); }
  }

  // Standing on yourself: the beat, and the one lesson the game teaches.
  if (sim.phase === PHASE.PLAY && b.grounded && b.standing && b.standing.corpse) {
    beat('firstCorpse');
    teach();
  }

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
  if (ui.banner > 0) { ui.banner -= real; if (ui.banner <= 0) el.best.className = ''; }

  // Biome crossing: a full-screen wash and a re-tuning of the ambient bed.
  const bi = Math.floor(Math.max(0, b.y) / BIOME_SPAN);
  if (bi !== lastBiome) {
    lastBiome = bi;
    if (bi > 0) beat('firstBiome');
    ui.wash = 1;
    audio.wash();
  }
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
  if (ui.monument) camera.monTop = Math.max(sim.best, sim.runBest, sim.body.y, 60);

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

// A last-resort starter. The canvas listener is the real path, but a touch
// anywhere on the document must never be able to do nothing at all.
addEventListener('pointerdown', () => { if (!ui.started) begin(); }, { passive: true });

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

// The harness drives the real loop, never a copy of it.
window.CAIRN = {
  sim, input, camera, renderer, audio, post, FEEL, Store, predict,
  begin, frame, update, ui, monument, teach,
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
