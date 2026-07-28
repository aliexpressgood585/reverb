import * as THREE from 'three';
import { LEVELS } from './levels.js';

/**
 * CAIRN
 *
 * One rule, and the whole game is downstream of it:
 *
 *   MISS A JUMP AND YOU FREEZE AT THE HIGHEST POINT YOU REACHED, AND WHAT IS
 *   LEFT BEHIND IS SOLID.
 *
 * A failed jump does not cost you the gap — it fills it. The body hangs at the
 * apex of the arc, out in the gap and above the ledge you left, which is
 * exactly the stepping stone the jump needed.
 *
 * The precise guarantee, because the loose version of it is not true and a bot
 * proved that: **every death leaves a platform strictly above the ledge you
 * launched from.** A clumsy climber therefore always makes progress. It does
 * not promise that someone who under-pulls every single jump will climb — that
 * one converges on a pile and stays there.
 *
 * Three things this build is built around, all of them from playtesting:
 *
 * 1. **There is no predicted arc.** A dotted parabola showing where you will
 *    land removes the only skill the game has and turns every jump into
 *    reading a solved answer. You get the launch ray — the honest thing, the
 *    actual direction and power leaving your feet — and nothing else. What
 *    replaces the arc is memory rather than prophecy: the path your last
 *    attempt really took stays on screen as a faint line, and you correct
 *    against what you did instead of against a hint. Which is the same
 *    sentence as the rest of the game.
 *
 * 2. **Precision is a promise, so it is enforced.** Physics runs on a fixed
 *    120 Hz step decoupled from the frame rate, so an identical launch lands on
 *    an identical centimetre on a 60 Hz phone, a 120 Hz phone and a stuttering
 *    browser tab. scripts/cairn-check.mjs fires the same jump at three frame
 *    rates and fails the build if the landings differ at all. Before this, the
 *    jump you got depended on the device you were holding.
 *
 * 3. **Stones are a budget, which makes them a tool.** A level grants a fixed
 *    number of bodies. That one change turns dying from a consolation into a
 *    decision — you can throw one deliberately into a gap to build the step you
 *    need, and it costs you one of the few you have. The score is the toll:
 *    how many of you the climb took.
 *
 * Zero external assets. No models, textures, fonts or audio files. Boxes and
 * arithmetic, all the way down.
 */

// ---------------------------------------------------------------- constants

const DT = 1 / 120;          // the physics step, and it never changes
const MAX_CATCHUP = 0.25;    // seconds of simulation a single frame may run

const GRAVITY = -34;
const MAX_POWER = 19.0;
const DRAG_FULL = 160;       // pixels of drag that reach full power
const DRAG_DEAD = 7;         // pixels below which a drag is a tap, not an aim

// The reach envelope, straight out of the projectile equation: a launch of
// speed v touches (dx, dy) only when dy + |(dx,dy)| <= v²/g. Every ledge is
// placed inside it, so a gap is never impossible — only tight. Getting this
// wrong is invisible by eye and obvious to a bot: the first build shipped 38
// gaps that no launch could cross.
const REACH = (MAX_POWER * MAX_POWER) / -GRAVITY;

const PLAYER_HALF = 0.34;
const LEDGE_D = 2.4;
const PLANE_Z = 0.85;        // the play plane, forward of the ledge centres

const COLOR = {
  void: 0x05070a,
  live: 0xdce3e8,
  dead: 0x6e7a84,
  rock: 0x3d525f,
  mark: 0xe8894a,
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ------------------------------------------------------------------- scene

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(COLOR.void, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(COLOR.void, 22, 64);
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 220);

const key = new THREE.DirectionalLight(0xffffff, 3.4);
key.position.set(6, 12, 9);
scene.add(key);
const rim = new THREE.DirectionalLight(0x9fd0e4, 1.6);
rim.position.set(-9, 3, -7);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0x8fb6c8, 0x0a1016, 1.1));

const matLive = new THREE.MeshStandardMaterial({ color: COLOR.live, roughness: 0.55 });
const matDead = new THREE.MeshStandardMaterial({ color: COLOR.dead, roughness: 0.9 });
const matRock = new THREE.MeshStandardMaterial({ color: COLOR.rock, roughness: 1.0 });
const matMark = new THREE.MeshBasicMaterial({ color: COLOR.mark });
const matHalo = new THREE.MeshBasicMaterial({ color: COLOR.mark, transparent: true, opacity: 0.14 });
const matGhost = new THREE.MeshBasicMaterial({ color: COLOR.dead, transparent: true, opacity: 0.55 });
const matAim = new THREE.MeshBasicMaterial({ color: COLOR.live });

const BOX = new THREE.BoxGeometry(1, 1, 1);

function makeFigure(material) {
  const g = new THREE.Group();
  const add = (w, h, d, x, y) => {
    const m = new THREE.Mesh(BOX, material);
    m.scale.set(w, h, d);
    m.position.set(x, y, 0);
    g.add(m);
  };
  add(0.46, 0.34, 0.42, 0, 1.16);      // head
  add(0.60, 0.62, 0.44, 0, 0.66);      // chest
  add(0.18, 0.42, 0.20, -0.16, 0.21);  // legs
  add(0.18, 0.42, 0.20, 0.16, 0.21);
  add(0.14, 0.46, 0.16, -0.36, 0.70);  // arms
  add(0.14, 0.46, 0.16, 0.36, 0.70);
  return g;
}

// ------------------------------------------------------------------- the rock

/** Everything you can stand on: quarried ledges, and everyone you used to be. */
let solids = [];
const scenery = [];
const marks = [];
let level = LEVELS[0];
let summitY = 0;

/** Deterministic noise. A seed is a tower, on every device and every run. */
let _seed = 1;
function rng() {
  _seed ^= _seed << 13; _seed ^= _seed >>> 17; _seed ^= _seed << 5;
  return ((_seed >>> 0) % 100000) / 100000;
}

function clearTower() {
  for (const o of scenery) scene.remove(o);
  scenery.length = 0;
  marks.length = 0;
  solids = [];
}

function addLedge(x, y, w) {
  const m = new THREE.Mesh(BOX, matRock);
  m.scale.set(w, 0.7, LEDGE_D);
  m.position.set(x, y - 0.35, 0);
  scene.add(m);
  scenery.push(m);
  solids.push({ x, y, hw: w / 2, body: false });
}

function addBody(x, y) {
  const g = makeFigure(matDead);
  g.position.set(x, y, PLANE_Z);
  g.rotation.z = (rng() - 0.5) * 0.5;
  g.rotation.y = (rng() - 0.5) * 1.1;
  scene.add(g);
  scenery.push(g);
  // You stand on its shoulders. Narrower than rock, which is what makes a body
  // a worse platform than a ledge and a far better one than nothing.
  solids.push({ x, y: y + 1.2, hw: 0.55, body: true });
}

function addMark(y, size, halo) {
  const m = new THREE.Mesh(BOX, matMark);
  m.scale.setScalar(size);
  m.position.set(0, y + 1.5, -2.4);
  const h = new THREE.Mesh(BOX, matHalo);
  h.scale.setScalar(2.6);
  h.visible = halo;
  m.add(h);
  scene.add(m);
  scenery.push(m);
  marks.push(m);
}

/**
 * Grow the tower for a level. Ledges thin out and lean further apart with
 * `tight`, and nothing else ever changes — no level introduces a new rule,
 * because the one rule is the whole game.
 */
function buildTower(def) {
  clearTower();
  _seed = (def.seed | 0) || 1;

  addLedge(0, 0, 3.6);
  let y = 0;
  let x = 0;
  let lastHw = 1.8;

  while (y < def.summit) {
    const t = clamp((y / def.summit) * def.tight + def.tight * 0.35, 0, 1);
    const rise = 2.0 + rng() * (0.9 + t * 1.1);

    // The furthest sideways this rise allows, minus half the ledge you are
    // standing on — you can be anywhere along it, including the far edge, and
    // the jump has to be possible from there too.
    // 68% of the envelope, not 78%. At the higher figure the top levels were
    // producing gaps that only a mathematically optimal launch could cross —
    // a minimum-speed arc arrives tangentially and grazes the ledge instead of
    // landing on it, so "just barely reachable" is in practice not reachable.
    // A competent bot failed THE SPIRE outright. Difficulty comes from narrow
    // ledges and rhythm, never from demanding a perfect launch.
    const room = REACH * 0.68 - rise;
    const maxDx = room > 0 ? Math.sqrt(Math.max(0, room * room - rise * rise)) : 0;
    const usable = Math.max(0.4, maxDx - lastHw);
    const want = usable * (0.42 + t * 0.44) * (0.62 + rng() * 0.38);
    const dir = rng() < 0.5 ? -1 : 1;
    let nx = x + want * dir;
    if (Math.abs(nx) > 8.5) nx = x - want * dir;

    const width = 2.8 - t * 1.5 + rng() * 0.7;
    y += rise;
    x = nx;
    lastHw = width / 2;
    addLedge(x, y, width);
  }

  summitY = y;
  // Warm marks on the way up, and a brighter one on the summit, so "how much
  // further" is answered by looking rather than by reading a number.
  for (let m = 25; m < y - 8; m += 25) addMark(m, 0.3, false);
  addMark(y, 0.62, true);
}

// ------------------------------------------------------------------ the climb

const player = makeFigure(matLive);
scene.add(player);

const state = {
  x: 0, y: 0, px: 0, py: 0,
  vx: 0, vy: 0,
  airborne: false,
  takeoff: 0,
  standing: null,
  peakX: 0, peakY: 0,
  best: 0,
  spent: 0,
  levelIndex: 0,
  phase: 'title',   // title | climb | cleared | spent-out
};

// The launch ray: the real velocity leaving your feet, drawn straight. It is
// not a prediction of where you land — learning that is the game.
const aimDots = [];
for (let i = 0; i < 9; i++) {
  const d = new THREE.Mesh(BOX, matAim);
  d.scale.setScalar(0.12 - i * 0.008);
  d.visible = false;
  scene.add(d);
  aimDots.push(d);
}

// The ghost: where your last attempt actually went. Memory, not prophecy — the
// same idea as the bodies, drawn thinner.
const ghostDots = [];
for (let i = 0; i < 30; i++) {
  const d = new THREE.Mesh(BOX, matGhost);
  d.scale.setScalar(0.08);
  d.visible = false;
  scene.add(d);
  ghostDots.push(d);
}
let trail = [];

// ------------------------------------------------------------------- physics

/**
 * One tick of flight, and the only place flight is ever integrated. Runs at a
 * fixed 120 Hz whatever the display is doing, because "as precise as it gets"
 * has to mean the same launch lands on the same centimetre on every device.
 */
function flight(p) {
  p.py = p.y; p.px = p.x;
  p.vy += GRAVITY * DT;
  p.x += p.vx * DT;
  p.y += p.vy * DT;
}

/** The highest thing the segment (px,py)->(x,y) fell through, if any. */
function surfaceUnder(p, skip) {
  if (p.vy >= 0) return null;
  let best = null;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (s === skip) continue;
    if (p.py < s.y || p.y > s.y) continue;
    const t = (p.py - s.y) / (p.py - p.y || 1e-6);
    const cx = p.px + (p.x - p.px) * t;
    if (Math.abs(cx - s.x) > s.hw + PLAYER_HALF) continue;
    if (!best || s.y > best.y) best = s;
  }
  return best;
}

function land(on) {
  state.airborne = false;
  state.vx = 0; state.vy = 0;
  state.standing = on;
  state.y = on.y;
  if (on.body) teach(2);
  if (on.y >= summitY - 0.01) cleared();
}

/** The one rule. */
function die() {
  state.spent++;
  addBody(state.peakX, state.peakY);
  teach(1);
  if (state.spent >= level.stones) { exhausted(); return; }
  const from = state.standing ?? solids[0];
  state.x = from.x;
  state.y = from.y;
  state.vx = 0; state.vy = 0;
  state.airborne = false;
  state.standing = from;
}

/** One fixed step of the world. */
function tick() {
  if (state.phase !== 'climb' || !state.airborne) return;

  flight(state);
  if (state.y > state.peakY) { state.peakY = state.y; state.peakX = state.x; }
  if (trail.length < 800) trail.push(state.x, state.y);

  const hit = surfaceUnder(state, state.standing);
  if (hit) {
    state.x = clamp(state.x, hit.x - hit.hw, hit.x + hit.hw);
    land(hit);
  } else if (state.vy < 0 && state.y < state.takeoff) {
    die();
  }
  if (state.y > state.best) state.best = state.y;
}

/** Run whole fixed steps for a stretch of real time. Never a partial step. */
let accum = 0;
function advance(seconds) {
  accum += Math.min(seconds, MAX_CATCHUP);
  let guard = 0;
  while (accum >= DT && guard++ < 4096) {
    accum -= DT;
    tick();
  }
}

// ------------------------------------------------------------------ progress

function loadLevel(i) {
  state.levelIndex = clamp(i, 0, LEVELS.length - 1);
  level = LEVELS[state.levelIndex];
  buildTower(level);
  state.standing = solids[0];
  state.x = solids[0].x;
  state.y = solids[0].y;
  state.best = 0;
  state.spent = 0;
  state.airborne = false;
  state.vx = 0; state.vy = 0;
  trail = [];
  accum = 0;
  camera.position.set(0, state.y + 5.4, 11.4);
  state.phase = 'climb';
  card(`${String(level.id).padStart(2, '0')} / ${String(LEVELS.length).padStart(2, '0')}`,
    level.name, level.line, `${level.stones} STONES`);
  cardTimer = 2.2;
}

function cleared() {
  state.phase = 'cleared';
  const rank = state.spent === 0 ? 'UNTOUCHED' : state.spent <= level.par ? 'CHEAP' : 'PAID';
  const last = state.levelIndex === LEVELS.length - 1;
  card(`${level.name} — TOP`, rank,
    state.spent === 0 ? 'you left nothing behind' : `${state.spent} of you stayed`,
    last ? 'TOUCH TO CLIMB AGAIN' : 'TOUCH TO GO HIGHER');
}

function exhausted() {
  state.phase = 'spent-out';
  card(level.name, 'ALL OF YOU', 'there is nobody left to stand on', 'TOUCH TO BEGIN AGAIN');
}

// ---------------------------------------------------------------------- input

let aiming = false;
let aimFrom = { x: 0, y: 0 };
let aimTo = { x: 0, y: 0 };

function aimVector() {
  const dx = aimFrom.x - aimTo.x;
  const dy = aimTo.y - aimFrom.y;
  const len = Math.hypot(dx, dy);
  if (len < DRAG_DEAD) return null;
  const power = Math.min(len, DRAG_FULL) / DRAG_FULL;
  const s = (MAX_POWER * power) / len;
  return { vx: dx * s, vy: -dy * s };
}

function launch(v) {
  state.vx = v.vx;
  state.vy = v.vy;
  state.airborne = true;
  state.takeoff = state.y;
  state.peakX = state.x;
  state.peakY = state.y;
  trail = [state.x, state.y];
}

function onDown(e) {
  if (state.phase === 'title') { loadLevel(0); return; }
  if (state.phase === 'cleared') {
    loadLevel(state.levelIndex === LEVELS.length - 1 ? 0 : state.levelIndex + 1);
    return;
  }
  if (state.phase === 'spent-out') { loadLevel(state.levelIndex); return; }
  if (state.airborne) return;
  aiming = true;
  aimFrom = { x: e.clientX, y: e.clientY };
  aimTo = { x: e.clientX, y: e.clientY };
}

function onMove(e) { if (aiming) aimTo = { x: e.clientX, y: e.clientY }; }

function onUp() {
  if (!aiming) return;
  aiming = false;
  for (const d of aimDots) d.visible = false;
  const v = aimVector();
  if (v) launch(v);
}

addEventListener('pointerdown', onDown, { passive: true });
addEventListener('pointermove', onMove, { passive: true });
addEventListener('pointerup', onUp, { passive: true });
addEventListener('pointercancel', onUp, { passive: true });

// ------------------------------------------------------------------ interface

const el = {
  height: document.getElementById('height'),
  toll: document.getElementById('toll'),
  teach: document.getElementById('teach'),
  card: document.getElementById('start'),
};

let cardTimer = 0;
function card(idx, title, tag, go) {
  el.card.innerHTML =
    `<p class="idx">${idx}</p><h1>${title}</h1><p class="tag">${tag}</p><p class="go">${go}</p>`;
  el.card.classList.remove('gone');
}

const LINES = [
  'DRAG AWAY FROM WHERE YOU WANT TO GO',
  'IT STAYS WHERE IT FELL',
  'CLIMB ON WHAT YOU WERE',
];
const taught = [false, false, false];
let teachTimer = 0;
function teach(i) {
  if (taught[i]) return;
  taught[i] = true;
  el.teach.textContent = LINES[i];
  el.teach.classList.add('show');
  teachTimer = 3.6;
}

function present(dt) {
  const v = aiming ? aimVector() : null;
  for (let i = 0; i < aimDots.length; i++) {
    aimDots[i].visible = !!v;
    if (!v) continue;
    const k = (i + 1) * 0.135;
    aimDots[i].position.set(state.x + v.vx * k, state.y + 0.75 + v.vy * k, PLANE_Z);
  }

  const pts = trail.length >> 1;
  const stride = Math.max(1, Math.ceil(pts / ghostDots.length));
  for (let i = 0; i < ghostDots.length; i++) {
    const j = i * stride * 2;
    const on = !state.airborne && state.phase === 'climb' && j + 1 < trail.length;
    ghostDots[i].visible = on;
    if (on) ghostDots[i].position.set(trail[j], trail[j + 1] + 0.6, PLANE_Z);
  }

  player.position.set(state.x, state.y, PLANE_Z);
  player.rotation.z = state.airborne ? clamp(-state.vx * 0.045, -0.5, 0.5) : 0;

  camera.position.x += (state.x * 0.34 - camera.position.x) * Math.min(1, dt * 4);
  camera.position.y += (state.y + 5.4 - camera.position.y) * Math.min(1, dt * 5);
  camera.position.z = 11.4;
  camera.lookAt(camera.position.x, camera.position.y - 1.4, 0);
  key.position.set(state.x + 6, state.y + 12, 9);
  for (const m of marks) m.rotation.y += dt * 1.4;

  if (teachTimer > 0) { teachTimer -= dt; if (teachTimer <= 0) el.teach.classList.remove('show'); }
  if (cardTimer > 0) { cardTimer -= dt; if (cardTimer <= 0) el.card.classList.add('gone'); }

  if (state.phase === 'title') {
    el.height.textContent = '';
    el.toll.innerHTML = '';
    return;
  }
  const left = Math.max(0, level.stones - state.spent);
  el.height.innerHTML = `${Math.round(Math.min(state.y, summitY))}<i>/${Math.round(summitY)}m</i>`;
  el.toll.innerHTML = '&#9679;'.repeat(left) + '&#9675;'.repeat(state.spent);
}

// --------------------------------------------------------------------- frame

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = h > w ? 58 : 46;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  advance(dt);
  present(dt);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------- boot

buildTower(LEVELS[0]);
state.standing = solids[0];
camera.position.set(0, 5.4, 11.4);
card('', 'CAIRN', 'EVERY DEATH LEAVES A STONE', 'TOUCH TO BEGIN');
resize();
requestAnimationFrame(frame);

// The harness drives the real loop, never a copy of it.
window.CAIRN = {
  state, LEVELS, advance, launch, loadLevel, aimVector,
  solids: () => solids, summit: () => summitY,
  GRAVITY, MAX_POWER, DT,
};
