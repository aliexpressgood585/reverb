import { FEEL, COLUMN, BIOME_SPAN, BIOMES, biomeAt, newBiomeSlot } from './src/feel.js';
import { Sim, PHASE, EV, CLOSE, predict, solidHalfWidth, erosionOf,
  landmarkOf, landmarksIn } from './src/sim.js';
import { Input } from './src/input.js';
import { Renderer, Camera } from './src/render.js';
import { Post } from './src/post.js';
import { Audio } from './src/audio.js';
import * as Store from './src/store.js';
import * as Progress from './src/progress.js';
import * as Money from './src/money.js';
import { initLang, t, height as fmtHeight } from './src/i18n.js';
import { Panel } from './src/panel.js';
import { track, EVENTS } from './src/analytics.js';

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
/** @type {(v: number, a: number, b: number) => number} */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ------------------------------------------------------------------ canvases

/**
 * An element the document is required to have.
 *
 * Every id below is in `index.html` and is not conditional, so a null here is a
 * broken build rather than a state to handle — and it should say so out loud
 * instead of failing forty lines later on a null property access.
 *
 * @template {Element} T
 * @param {string} id
 * @returns {T}
 */
function need(id) {
  const e = document.getElementById(id);
  if (!e) throw new Error(`CAIRN: #${id} missing from the document`);
  return /** @type {T} */ (/** @type {unknown} */ (e));
}

/**
 * THE ERROR BOUNDARY.
 *
 * A canvas game that throws before its loop starts shows a black rectangle, and
 * a black rectangle is indistinguishable from a game that is simply very dark.
 * This is the one screen in the product that exists to be read.
 *
 * It is installed FIRST — before the canvas, before the simulation, before
 * anything that could throw — because a boundary registered after the failure it
 * is meant to catch is not a boundary.
 *
 * @param {string} what
 */
function fatal(what) {
  try {
    const box = document.getElementById('fatal');
    if (!box) return;
    const p = box.querySelector('p');
    if (p) {
      // A crash before the first frame and a crash mid-climb are different
      // events and a player can tell which one happened to them. Saying "could
      // not start" to someone who was 300 m up is a message that is obviously
      // wrong, and an obviously wrong message is worse than a vague one.
      p.textContent = (started
        ? 'CAIRN stopped unexpectedly. Your tower is safe — it was saved before '
          + 'this screen appeared, and nothing has been erased.'
        : 'CAIRN could not start on this device. Your tower is safe — nothing '
          + 'has been erased.')
        + ' Closing and reopening the app usually fixes it.';
    }
    box.className = 'on';
    console.error('CAIRN fatal:', what);
  } catch { /* if even this throws there is nothing left to try */ }
}

/** Has the loop ever produced a frame? Decides which sentence `fatal` shows. */
let started = false;

addEventListener('error', (e) => fatal(e.message || 'error'));
addEventListener('unhandledrejection', (e) => fatal(String(e.reason)));

const view = /** @type {HTMLCanvasElement} */ (need('view'));
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
const surface = /** @type {HTMLElement} */ (post ? view : scene);
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
  daily: false,
  // PHASE3 §3 — the first sixty seconds, instrumented. Milliseconds from the
  // touch that starts the run to the first time each thing ever happens. Read by
  // scripts/cairn-first-minute.mjs; nothing in the game reads them.
  /** @type {Record<string, number>} */
  beats: {},
  taught: false,
  // What THIS attempt did, for the marks that ask about a run rather than a
  // lifetime. Reset by `finishDeath`, read by `checkMarks`.
  runStood: 0,
  runLaunches: 0,
  runFloor: 0,
  // CLOSE CALLS. `closeT` counts the beat down in REAL seconds — it has to,
  // because it is the thing scaling sim time, and a timer measured in the
  // clock it is slowing never expires.
  closeT: 0,
  closeScale: 1,
  // MONUMENT DISCOVERY, persisted. `monRecords` counts record-setting deaths;
  // `monGestured` latches the first time two real fingers opened the view, and
  // once it is set the game never opens it unprompted again.
  monRecords: 0,
  monGestured: false,
};
try {
  ui.monRecords = +(localStorage.getItem('cairn.monrec') || 0) || 0;
  ui.monGestured = localStorage.getItem('cairn.mongest') === '1';
} catch { /* private mode */ }

let dpr = 1;
let accum = 0;
let lastFrame = performance.now();
let paused = false;
let lastBiome = 0;

const el = {
  small: need('height'),
  card: need('card'),
  toast: need('toast'),
  best: need('best'),
  debug: need('debug'),
  streak: need('streak'),
  menu: /** @type {HTMLButtonElement} */ (need('menu')),
  panel: /** @type {HTMLElement} */ (need('panel')),
  monshare: /** @type {HTMLButtonElement} */ (need('monshare')),
  daily: /** @type {HTMLButtonElement} */ (need('daily')),
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

/** @param {number|number[]} pattern */
let haptics = true;
try { haptics = localStorage.getItem('cairn.haptics') !== '0'; } catch { /* private */ }

/** @param {number|number[]} pattern */
function buzz(pattern) {
  if (reduced || !haptics) return;
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* iOS: silent */ }
}

// -------------------------------------------------------------------- flow

/** Stamp the first time something ever happens, in ms since the run began. */
/** @param {string} name */
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
  ui.runFloor = sim.body.y;
  Money.newRun();
  hideCard();
  track(EVENTS.RUN_START, { daily: !!ui.daily });

  // THE STREAK ROLLS ON THE FIRST RUN OF A UTC DAY, not at boot. Opening the app
  // and closing it is not playing, and a streak you can keep without climbing is
  // a streak that means nothing.
  const day = Store.dailyDate();
  const { rolled, streak } = Progress.touchDay(day);
  if (rolled) {
    Progress.flush();
    track(EVENTS.STREAK, { days: streak });
    if (streak > 1) showStreak(streak);
  }
}

/**
 * Death → the next playable frame, with no menu, no modal and no button. The
 * camera falls back to the base while the body crystallises, and control
 * returns well inside a second. Friction here is what kills a retry loop.
 */
function handleDeath() {
  ui.dead = 0.0001;
  ui.flash = 1;
  const meant = sim.deathMeant;
  audio.death(meant);
  // Three short pulses that resolve, against the long fall of an ordinary
  // death. The hand is the only channel that reaches a player who is already
  // looking away from the screen.
  buzz(meant ? [18, 40, 18, 40, 34] : [60, 30, 90]);
  const b = sim.body;
  if (!reduced) renderer.burst(b.peakX, b.peakY, 22);
  camera.kick(1);
}

function finishDeath() {
  ui.dead = 0;
  const beat = sim.best > ui.bestAtRunStart + 0.5;

  // THE GHOST IS THE RECORD RUN, captured here because `respawn` clears the
  // path and this is the last moment it still describes the attempt that just
  // ended. Only a run that beat the record replaces it — anything else and the
  // ghost drifts down to whatever you did most recently, which is the opposite
  // of the thing worth racing.
  //
  // Its whole path is valid forever after: the shifting roof only regenerates
  // ABOVE `best`, and this run finished at or below the new best, so every
  // ledge it touched is now stable ground. The ghost therefore ends exactly at
  // the frontier and leaves you there — which is also the only honest place for
  // it to stop.
  if (beat) sim.ghostPath = sim.runPath.slice();

  // Bank the run BEFORE respawning, while the numbers still describe it.
  const apex = sim.body.peakY;
  Progress.record({
    best: sim.best,
    stones: 1,
    stood: ui.runStood,
    launches: ui.runLaunches,
    climbed: Math.max(0, apex - ui.runFloor),
  });
  track(EVENTS.DEATH, {
    height: Math.round(apex), stood: ui.runStood,
    launches: ui.runLaunches, daily: !!ui.daily,
  });
  let solid = 0;
  for (const s of sim.world.solids) if (s.corpse && solidHalfWidth(s, sim) > 0) solid++;
  const won = Progress.checkMarks({
    height: apex, stood: ui.runStood, launches: ui.runLaunches,
    daily: !!ui.daily, bodiesAlive: solid,
  });
  Progress.flush();

  sim.respawn();
  renderer.trailN = 0;
  Store.save(sim);
  ui.bestAtRunStart = sim.best;
  ui.recordCrossed = false;
  ui.runStood = 0;
  ui.runLaunches = 0;
  ui.runFloor = sim.body.y;
  Money.newRun();

  // The summary lands AFTER control has come back, so the retry is never gated.
  if (beat) { showBanner(); reveal(); }
  // A mark is a fragment, not a modal — same strip as everything else, and it
  // waits for the record card so two things never speak at once.
  for (const m of won) track(EVENTS.MARK, { id: m.id });
  const first = won[0];
  if (first) {
    setTimeout(() => toast(t('toast.unlocked', { name: Progress.markName(first) }), 'mark'),
               beat ? 1200 : 200);
  }
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

let introShown = false;
function showTitle() {
  el.card.className = introShown ? 'on' : 'on intro';
  introShown = true;
  el.card.replaceChildren();
  const h = document.createElement('h1');
  h.textContent = t('menu.title');
  const tag = document.createElement('p');
  tag.className = 'tag';
  tag.textContent = t('title.tagline');
  const go = document.createElement('p');
  go.className = 'go';
  go.textContent = t('title.begin');
  el.card.append(h, tag, go);
}
function hideCard() { el.card.className = ''; }

/**
 * The run summary, as a strip that fades on its own while the game is already
 * playable underneath it. It reports; it does not ask. SHARE is the only thing
 * in it that takes a touch, and ignoring it costs nothing.
 */
function showBanner() {
  el.best.replaceChildren();
  /**
   * @param {string} tag
   * @param {string} cls
   * @param {string} text
   * @returns {HTMLElement}
   */
  const mk = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    e.textContent = text;
    return e;
  };
  const share = /** @type {HTMLButtonElement} */ (mk('button', '', t('run.share')));
  share.id = 'share';
  share.type = 'button';
  el.best.append(
    mk('span', 'k', t('run.best')),
    mk('b', '', fmtHeight(sim.best)),
    // "1 STONES" was on the banner people screenshot and share.
    mk('span', 'k', t(sim.deaths === 1 ? 'run.stone' : 'run.stones', { n: sim.deaths })),
    share,
  );
  el.best.className = 'on';
  ui.banner = 4.2;
  const shareBtn = /** @type {HTMLButtonElement} */ (el.best.querySelector('#share'));
  shareBtn.onpointerdown = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    ui.banner = 4.2;
    const how = await Store.share(sim);
    track(EVENTS.SHARE, { how, height: Math.round(sim.best) });
    toast(how === 'copied' ? t('toast.copied')
      : how === 'downloaded' ? t('toast.saved') : how === 'shared' ? '' : t('toast.failed'));
  };
}

/** @param {string} msg */
/**
 * @param {string} msg
 * @param {string} [kind]
 */
function toast(msg, kind) {
  if (!msg) return;
  el.toast.textContent = msg;
  el.toast.className = kind ? `on ${kind}` : 'on';
  ui.toast = 2.2;
}

/** @param {number} days */
function showStreak(days) {
  el.streak.textContent = t('toast.streak', { n: days });
  el.streak.className = 'on';
  setTimeout(() => { el.streak.className = ''; }, 3200);
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
/** @param {boolean} on */
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

/**
 * THE MONUMENT, SHOWN RATHER THAN EXPLAINED.
 *
 * The view is the one image that explains this game in three seconds without a
 * word, and it was reachable only by a two-finger gesture nothing teaches. This
 * does not teach the gesture — it performs its result, at the moment the result
 * is the truth of what just happened: the death that set a new record, with the
 * new stone on top of everything you have ever left.
 *
 * It runs AFTER `finishDeath` has already respawned, so control is back before
 * the view opens and closing it costs one touch — the same touch that closes a
 * monument opened deliberately, which is how the exit is learned for free.
 *
 * Sparse and self-cancelling: `FEEL.monument.revealAt` picks which record deaths
 * get it, and the first two-finger open ends it permanently. See DECISIONS §28
 * for why this is not a tooltip and what it can and cannot be measured against.
 */
function reveal() {
  // Never over a thumb that is already on the glass. `finishDeath` runs a beat
  // after the death, and a player who has started aiming again is a player
  // whose aim this would eat.
  if (ui.monGestured || ui.monument || ui.daily || input.aiming) return;
  ui.monRecords++;
  try { localStorage.setItem('cairn.monrec', String(ui.monRecords)); } catch { /* private mode */ }
  if (!FEEL.monument.revealAt.includes(ui.monRecords)) return;
  let bodies = 0;
  for (const s of sim.world.solids) if (s.corpse) bodies++;
  if (bodies < FEEL.monument.revealMinBodies) return;
  monument(true);
  track(EVENTS.MONUMENT_REVEAL, { at: ui.monRecords, bodies });
}

/**
 * THE DAILY CLIMB.
 *
 * One seed per UTC date, the same tower for everyone on earth that day, kept in
 * its own save slot so it can never touch the endless tower — a daily seed is
 * thrown away tomorrow and an endless tower is a player's whole history.
 *
 * The switch is a full reset rather than a resume: two towers, two records, two
 * piles of bodies. `sim.dailyDate` is what the share card carries, because the
 * date IS the seed and a recipient who has it plays the identical climb.
 */
/** @param {boolean} daily */
function setMode(daily) {
  if (daily === !!ui.daily) return;
  Store.save(sim);                                // bank the tower being left
  ui.daily = daily;
  ui.beats = {};
  // `ui.taught` is deliberately NOT reset: the lesson is per player, not per
  // mode. This line used to assign it to itself, which said so in a way that
  // did nothing and read as though it did something.
  const date = Store.dailyDate();
  sim.dailyDate = daily ? date : null;
  sim.world.seed = daily ? Store.dailySeed(date) : 0x1a2b3c;
  Store.setSlot(daily ? `daily.${date}` : '');
  sim.best = 0; sim.deaths = 0;
  sim.reset(true);
  if (!Store.load(sim)) sim.world.generate(FEEL.camera.viewH * 2.2);
  sim.phase = ui.started ? PHASE.PLAY : PHASE.TITLE;
  camera.y = 0; camera.x = COLUMN * 0.5;
  renderer.trailN = 0;
  ui.bestAtRunStart = sim.best;
  ui.recordCrossed = false;
  el.daily.className = daily ? 'corner on' : 'corner';
  el.daily.textContent = daily ? t('hud.daily.on', { date: date.slice(5) }) : t('hud.daily');
  track(EVENTS.MODE, { daily });
  try { localStorage.setItem('cairn.mode', daily ? 'daily' : ''); } catch { /* private */ }
}

el.daily.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  setMode(!ui.daily);
});

input.onMonument = () => {
  // The player found it themselves. Stop nudging, permanently.
  if (!ui.monGestured) {
    ui.monGestured = true;
    try { localStorage.setItem('cairn.mongest', '1'); } catch { /* private mode */ }
  }
  monument(!ui.monument);
};
input.onTap = () => {
  if (ui.monument) { monument(false); return; }
  if (!ui.started) begin();
};

el.monshare.addEventListener('pointerdown', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  const how = await Store.share(sim);
  track(EVENTS.SHARE, { how, height: Math.round(sim.best) });
  if (how !== 'shared') toast(how === 'copied' ? t('toast.copied') : t('toast.saved'));
});
input.onChargeStart = () => { audio.charge(); buzz(8); };
input.onRelease = /** @param {number} p */ (p) => { audio.release(p); buzz(14); };
input.onLaunch = /** @type {(vx: number, vy: number) => void} */ ((vx, vy) => {
  if (!ui.started) { begin(); return; }
  sim.launch(vx, vy);
});

// ------------------------------------------------------------------ events

function drainEvents() {
  const e = sim.events;
  for (let i = 0; i < e.length; i += 4) {
    const kind = e[i];
    if (kind === EV.LAND) {
      const force = clamp(e[i + 1] ?? 0, 0, FEEL.maxFallSpeed) / FEEL.maxFallSpeed;
      renderer.ring(e[i + 2], e[i + 3], force);
      audio.land(force);
      camera.kick(force);
      ui.squashVel -= force * 9;
      if (force > 0.45) buzz(26);
    } else if (kind === EV.DEATH) {
      beat('firstDeath');
      // A body that buys a ledge this perch could not reach is a life SPENT.
      // The game has never distinguished the two, so every death read as a
      // failure — including the ones the player aimed. See DECISIONS §29.
      if (sim.deathMeant) beat('firstSpentDeath');
      handleDeath();
    } else if (kind === EV.LAUNCH) {
      beat('firstLaunch');
      ui.runLaunches++;
      ui.squashVel += 5;
    } else if (kind === EV.CRUMBLE_START) {
      // The clock has started on the hold under your feet. Sound and a short
      // buzz, because the eyes are on the gap ahead by now, not on the ledge.
      audio.crumbleWarn();
      buzz(14);
    } else if (kind === EV.CRUMBLE) {
      audio.crumble();
      renderer.burst(e[i + 1], e[i + 2], 14);
    } else if (kind === EV.CLAIM) {
      // A STRUCTURE ANSWERED. Six of these exist in a lifetime of play and
      // nothing in the game says they do. The camera steps back for a beat so
      // the thing that just changed is impossible to miss — the same move the
      // first-corpse beat makes, for the same reason, and with no text either.
      audio.claim();
      buzz([22, 50, 22, 50, 90]);
      ui.bestFlash = 1;
      renderer.burst(e[i + 2], e[i + 3], 26);
      camera.monTop = Math.max(sim.best, sim.body.y, e[i + 3] + 80);
      camera.monTarget = FEEL.landmark.claimPull;
      setTimeout(() => { if (!ui.monument) camera.monTarget = 0; },
                 FEEL.landmark.claimPullMs);
      track(EVENTS.CLAIM, { band: e[i + 1], height: Math.round(e[i + 3]) });
    } else if (kind === EV.CLOSE) {
      // The game noticing something the player half-noticed. Time opens for a
      // beat, the room breathes in, and nothing is written anywhere.
      const C = FEEL.closeCall;
      const doomed = e[i + 1] === CLOSE.DOOMED;
      ui.closeScale = doomed ? C.doomedDilation : C.dilation;
      ui.closeT = (doomed ? C.doomedMs : C.dilationMs) / 1000;
      audio.close(doomed);
      renderer.ring(e[i + 2], e[i + 3], doomed ? 0.55 : 0.3);
      buzz(doomed ? [10, 60, 22] : 10);
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
/** @param {number} real seconds of real time since the last frame */
function update(real) {
  input.update(real, innerHeight);
  if (input.aiming) audio.chargeTo(input.power);

  // Aiming slows time, and so does a close call. The accumulator is fed scaled
  // seconds; the STEP never changes, so slow motion costs precision nothing.
  let dilate = 1;
  if (ui.closeT > 0) {
    ui.closeT -= real;
    // Ease back out rather than snapping to full speed at the end of the beat.
    dilate = ui.closeScale + (1 - ui.closeScale) * clamp(1 - ui.closeT * 4, 0, 1);
  }
  const scaled = real * input.timeScale * dilate;

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

  // Standing on yourself: the beat, the lesson, and the counter the marks read.
  if (sim.phase === PHASE.PLAY && b.grounded && b.standing && b.standing.corpse) {
    beat('firstCorpse');
    if (b.standing !== lastStoodOn) {
      lastStoodOn = b.standing;
      ui.runStood++;
      track(EVENTS.STOOD_ON_SELF, { height: Math.round(b.y) });
    }
    teach();
  } else if (b.grounded) {
    lastStoodOn = null;
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
  audio.setHeight(Math.max(0, b.y), bi, renderer.momentum);
}

/** @param {number} now */
function frame(now) {
  if (dead) return;
  requestAnimationFrame(frame);
  if (paused) { lastFrame = now; return; }

  let real = (now - lastFrame) / 1000;
  lastFrame = now;
  if (real > 0.25) real = 0.25;      // a backgrounded tab must not fast-forward
  try {
    step(now, real);
  } catch (e) {
    // A throw inside the loop would otherwise repeat sixty times a second and
    // bury the console. Stop, save what the player earned, and say so.
    dead = true;
    try { Store.save(sim); Progress.flush(); } catch { /* nothing left to save with */ }
    fatal(e instanceof Error ? e.message : String(e));
  }
}

let dead = false;

/**
 * @param {number} now
 * @param {number} real
 */
function step(now, real) {
  started = true;
  update(real);

  const b = sim.body;
  // The eased momentum lives in the renderer, and the audio bed reads it from
  // there — one smoothed value, so the light and the bed never disagree about
  // how well the run is going.
  renderer.step(real, sim.momentum / FEEL.momentum.max);
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
  if (h !== lastShown) {
    lastShown = h;
    el.small.textContent = ui.started ? t('hud.metres', { n: h }) : '';
  }
  // Whenever the camera is pulling back AT ALL, not only when the monument is
  // open: `teachPull` and the landmark `claimPull` drive the same blend to a
  // third or so, and a third of the way toward a midline left over from the
  // last monument is a visible sideways lurch during play. Keyed on the target,
  // which is the thing that actually decides whether the blend runs.
  if (ui.monument || camera.monTarget > 0) {
    camera.monTop = Math.max(sim.best, sim.runBest, sim.body.y, 60);
    camera.monX = towerMidline();
  }

  if (debugOn) drawDebug(real);
}

/**
 * The horizontal midline of what this session actually built — the midpoint of
 * the bodies' extent, which is the same rule `Store.poster` composes on.
 *
 * The midpoint of the EXTENT rather than the mean of the positions: the shot is
 * of a silhouette, and a silhouette is centred by its edges. A mean pulls toward
 * wherever the deaths piled up, which on a tower with one long reach out to the
 * side leaves that reach hanging off the frame.
 *
 * @returns {number} world units; the column midline when there is nothing yet.
 */
function towerMidline() {
  let lo = Infinity, hi = -Infinity;
  const solids = sim.world.solids;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (!s.corpse || !s.live) continue;
    if (s.x - s.hw < lo) lo = s.x - s.hw;
    if (s.x + s.hw > hi) hi = s.x + s.hw;
  }
  return hi < lo ? COLUMN * 0.5 : (lo + hi) * 0.5;
}

let lastShown = -1;
let lastSteps = 0;
/** The body most recently stood on, so one landing counts once. */
let lastStoodOn = /** @type {import('./src/types.js').Solid|null} */ (null);

// -------------------------------------------------------------------- pause

document.addEventListener('visibilitychange', () => {
  paused = document.hidden;
  audio.duck(document.hidden);
  if (document.hidden) {
    input.abort(); audio.stopCharge(); Store.save(sim); Progress.flush();
  }
  else { lastFrame = performance.now(); accum = 0; }
});
addEventListener('pagehide', () => { Store.save(sim); Progress.flush(); });

// -------------------------------------------------------------------- debug

let debugOn = false;
let taps = 0;
let tapAt = 0;
addEventListener('pointerdown', /** @param {PointerEvent} e */ (e) => {
  if (e.clientX > 90 || e.clientY > 90) { taps = 0; return; }
  const t = performance.now();
  taps = t - tapAt < 500 ? taps + 1 : 1;
  tapAt = t;
  if (taps >= 3) { debugOn = !debugOn; el.debug.className = debugOn ? 'on' : ''; taps = 0; }
}, true);

let fpsAccum = 0, fpsFrames = 0, fps = 0, worst = 0;
/** @param {number} real */
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

/**
 * THE PANEL. Reached from a corner, never raised by the game.
 *
 * It pauses, which nothing else in this product is allowed to do — and it is
 * allowed to because the player asked for it by touching a control in the corner
 * where their thumb already is. Test 14's rule is that nothing blocks the middle
 * of the screen DURING a climb, and this obeys it by construction.
 */
const panel = new Panel(el.panel, {
  onClose: () => { paused = false; lastFrame = performance.now(); accum = 0; },
  onLangChange: () => { applyLang(); },
  onWipe: () => {
    Store.wipe();
    Progress.reset();
    sim.best = 0;
    sim.deaths = 0;
    sim.reset(true);
    camera.y = 0;
    renderer.trailN = 0;
    ui.started = false;
    showTitle();
  },
  getAudio: () => audio,
  getHaptics: () => haptics,
  setHaptics: (on) => {
    haptics = on;
    try { localStorage.setItem('cairn.haptics', on ? '1' : '0'); } catch { /* private */ }
    if (on) buzz(12);
  },
});

el.menu.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  audio.unlock();
  if (panel.open) { panel.hide(); return; }
  paused = true;
  input.abort();
  audio.stopCharge();
  Store.save(sim);
  Progress.flush();
  panel.show('menu');
});

/** Re-render every string in place after a language change. */
function applyLang() {
  el.daily.textContent = ui.daily
    ? t('hud.daily.on', { date: Store.dailyDate().slice(5) })
    : t('hud.daily');
  el.monshare.textContent = t('hud.share');
  if (!ui.started) showTitle();
}

// A last-resort starter. The canvas listener is the real path, but a touch
// anywhere on the document must never be able to do nothing at all.
addEventListener('pointerdown', (e) => {
  if (panel.open) return;
  if (/** @type {Element} */ (e.target)?.closest?.('button')) return;
  if (!ui.started) begin();
}, { passive: true });

// ---------------------------------------------------------------------- boot

// Boot into whichever tower was last open. The mode has to be restored BEFORE
// the first load, or the endless slot gets read into a daily session.
let bootDaily = false;
try { bootDaily = localStorage.getItem('cairn.mode') === 'daily'; } catch { /* private */ }
if (bootDaily) {
  const d = Store.dailyDate();
  ui.daily = true;
  sim.dailyDate = d;
  sim.world.seed = Store.dailySeed(d);
  Store.setSlot(`daily.${d}`);
  sim.reset(true);
  el.daily.className = 'corner on';
}
initLang();
Progress.load();
Money.countSession();
Store.load(sim);
resize();
applyLang();
showTitle();
camera.y = 0;
requestAnimationFrame(frame);

/*
 * PWA. The icon is drawn rather than shipped, so the repository holds no binary
 * art and the manifest is still complete.
 *
 * BUILT ONLY IF SOMEBODY MIGHT INSTALL IT, and that took two goes to get right.
 *
 * Encoding three PNGs — 192, 512, and a 512 maskable — through `toDataURL` costs
 * one to two seconds of blocked main thread on a slow CPU. Doing it inline at
 * boot put that in the load; moving it to `requestIdleCallback` just moved it
 * into the interaction window, where Lighthouse measured a WORSE total blocking
 * time than before. Deferring work that nobody needs is still doing work that
 * nobody needs.
 *
 * The manifest exists for one purpose: an install prompt. So it is built when
 * the browser says an install is possible, and never otherwise. On Android — the
 * platform this actually ships to — Capacitor uses the native launcher icons and
 * none of this runs at all. The tab icon is an inline SVG in index.html, which
 * costs no encode and no request.
 */
let manifestReady = false;
function installManifest() {
  if (manifestReady) return;
  manifestReady = true;
  try {
    const manifest = {
      name: 'CAIRN', short_name: 'CAIRN',
      description: 'Every death leaves a stone. Climb on what you were.',
      start_url: './', scope: './', display: 'standalone',
      orientation: 'portrait',
      background_color: '#05070C', theme_color: '#05070C',
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
  } catch { /* manifest is a nice-to-have, never a blocker */ }
}

addEventListener('beforeinstallprompt', installManifest);

// THE HARNESS DRIVES THE REAL LOOP, NEVER A COPY OF IT. Ten acceptance tests
// once passed against a game that could not be started, because they reached
// past the browser instead of through it; everything exposed here is the object
// the game itself is using.
const api = {
  sim, input, camera, renderer, audio, post, FEEL, Store, predict,
  begin, frame, update, ui, monument, teach, setMode, panel,
  // Momentum and close calls are invisible by design, so the only way to check
  // they do anything is to read the sim's own vocabulary rather than a copy of
  // it — see scripts/cairn-feel-check.mjs.
  EV, CLOSE, erosionOf, solidHalfWidth, landmarkOf, landmarksIn,
  // The palettes, so a suite can hold every biome to a colour rule instead
  // of whichever one the session it happened to run is standing in.
  BIOMES, biomeAt, newBiomeSlot,
  /** @param {number} n */
  step(n) { for (let i = 0; i < n; i++) sim.tick(0); },
  /**
   * @param {number} vx
   * @param {number} vy
   */
  fire(vx, vy) { return sim.launch(vx, vy); },
};

/** @type {any} */ (window).CAIRN = api;

/**
 * Frame statistics for the art-direction tests: mean colour, mean chroma, and
 * the percentage of the frame that is flat undifferentiated grey — a pixel with
 * almost no chroma sitting in the mid range, which is exactly the failure the
 * whole art pass exists to remove. Sampled from the surface actually on screen,
 * so it measures the graded image rather than the raw scene.
 */
/** @type {any} */ (window).__stats = function () {
  const src = post ? view : scene;
  const s = document.createElement('canvas');
  s.width = 160; s.height = 340;
  const c = s.getContext('2d', { willReadFrequently: true });
  if (!c) return { r: 0, g: 0, b: 0, chroma: 0, greyPct: 0 };
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
