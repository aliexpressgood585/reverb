import * as THREE from 'three';

/**
 * CAIRN
 *
 * One rule, and the whole game is downstream of it:
 *
 *   MISS A JUMP AND YOU FREEZE AT THE HIGHEST POINT YOU REACHED, AND WHAT IS
 *   LEFT BEHIND IS SOLID.
 *
 * A failed jump does not cost you the gap — it fills it. The body hangs at the
 * apex of the arc, out in the middle of the gap and above the ledge you left,
 * which is exactly the stepping stone the jump needed. After forty deaths the
 * shaft below you is a tower built out of every version of yourself that did
 * not make it.
 *
 * The precise guarantee, because the loose version of it is not true and a bot
 * proved that: **every death leaves a platform strictly above the ledge you
 * launched from.** So a clumsy player always climbs. What it does not promise
 * is that a player who systematically under-pulls every single jump will climb
 * — that one converges on a pile and stays there. The aim arc is what stops
 * that from being a real failure mode: you see the jump before you commit.
 *
 * Design constraints, all of them deliberate and all of them lessons from the
 * first game in this repository:
 *
 *  - **You can always see yourself.** First person is atmospheric and it is
 *    also the fastest way to make a player ask "what am I supposed to do".
 *  - **You can always see where you are going.** A warm light sits above every
 *    hundred metres. The question "which way" is never asked.
 *  - **One verb.** Drag, release. There is no second control.
 *  - **The play plane is flat.** The world is real 3D and the camera is angled
 *    so it reads as depth, but you aim in a plane — one thumb cannot
 *    disambiguate a third axis, and pretending otherwise is how mobile ports
 *    of desktop games die.
 *  - **Zero external assets.** No models, no textures, no fonts, no audio
 *    files. Everything here is boxes and arithmetic.
 */

// ---------------------------------------------------------------- constants

const GRAVITY = -34;
const MAX_POWER = 19.0;      // metres/second at a full-length drag
const DRAG_FULL = 150;       // pixels of drag that reach full power

// The reach envelope, straight out of the projectile equation: a launch of
// speed v can touch (dx, dy) only when dy + |(dx,dy)| <= v²/g. The tower
// generator is held to 78% of it, so no gap is ever a coin flip and none is
// ever impossible. Getting this wrong is invisible by eye and obvious to a
// bot — the first run of scripts/cairn-check.mjs found 38 unreachable gaps.
const REACH = (MAX_POWER * MAX_POWER) / -GRAVITY;
const REACH_SAFE = REACH * 0.78;
const PLAYER_HALF = 0.34;    // half width, for landing tests
const PLAYER_TALL = 1.35;

const LEDGE_D = 2.4;
// The play plane sits forward of the ledge centres. Standing dead centre put
// the figure's feet behind the front lip of its own ledge under a camera that
// looks slightly down, and a platformer where you cannot see your own feet is
// a platformer nobody can judge a jump in.
const PLANE_Z = 0.85;
const GEN_AHEAD = 70;        // metres of tower kept built above the player

const COLOR = {
  void: 0x05070a,
  live: 0xdce3e8,   // you, right now
  dead: 0x6e7a84,   // you, previously
  rock: 0x3d525f,
  mark: 0xe8894a,   // the light above every hundred metres
};

// ------------------------------------------------------------------- helpers

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Deterministic noise, so a tower is the same tower for as long as you climb. */
let _seed = 0x2f6e2b1;
function rand() {
  _seed ^= _seed << 13; _seed ^= _seed >>> 17; _seed ^= _seed << 5;
  return ((_seed >>> 0) % 100000) / 100000;
}

// --------------------------------------------------------------------- scene

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(COLOR.void, 1);

const scene = new THREE.Scene();
// Depth cue only. It has to start well behind the play plane or the ledges you
// are about to jump to fade out exactly when you need to judge them.
scene.fog = new THREE.Fog(COLOR.void, 22, 64);

const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200);

// Two lights and nothing else. A key from the front-right carves the boxes into
// something with weight; a dim cold fill keeps the shadow side from going to
// pure black, which is what makes cheap geometry read as expensive.
const key = new THREE.DirectionalLight(0xffffff, 3.4);
key.position.set(6, 12, 9);
scene.add(key);
// A cold rim from behind-left. Two lights is all it takes to make a box look
// carved rather than drawn, and the rim is what separates a pale figure from a
// near-black background without any outline trickery.
const rim = new THREE.DirectionalLight(0x9fd0e4, 1.6);
rim.position.set(-9, 3, -7);
scene.add(rim);
scene.add(new THREE.HemisphereLight(0x8fb6c8, 0x0a1016, 1.1));

const matLive = new THREE.MeshStandardMaterial({ color: COLOR.live, roughness: 0.55, metalness: 0.0 });
const matDead = new THREE.MeshStandardMaterial({ color: COLOR.dead, roughness: 0.9, metalness: 0.0 });
const matRock = new THREE.MeshStandardMaterial({ color: COLOR.rock, roughness: 1.0, metalness: 0.0 });
const matMark = new THREE.MeshBasicMaterial({ color: COLOR.mark });

const BOX = new THREE.BoxGeometry(1, 1, 1);

/** A body: four boxes, deliberately narrow, so a hundred of them still read. */
function makeFigure(material) {
  const g = new THREE.Group();
  const add = (w, h, d, x, y) => {
    const m = new THREE.Mesh(BOX, material);
    m.scale.set(w, h, d);
    m.position.set(x, y, 0);
    g.add(m);
    return m;
  };
  add(0.46, 0.34, 0.42, 0, 1.16);          // head
  add(0.60, 0.62, 0.44, 0, 0.66);          // chest
  add(0.18, 0.42, 0.20, -0.16, 0.21);      // legs
  add(0.18, 0.42, 0.20, 0.16, 0.21);
  add(0.14, 0.46, 0.16, -0.36, 0.70);      // arms
  add(0.14, 0.46, 0.16, 0.36, 0.70);
  return g;
}

// ------------------------------------------------------------------ the tower

/** Everything you can stand on: quarried ledges, and everyone you used to be. */
const solids = [];
let builtTo = 0;
let gapScale = 0;
let lastHw = 1.7;

function addLedge(x, y, w) {
  const m = new THREE.Mesh(BOX, matRock);
  m.scale.set(w, 0.7, LEDGE_D);
  m.position.set(x, y - 0.35, 0);
  scene.add(m);
  solids.push({ x, y, hw: w / 2, mesh: m, body: false });
}

function addBody(x, y) {
  const g = makeFigure(matDead);
  g.position.set(x, y, PLANE_Z);
  g.rotation.z = (rand() - 0.5) * 0.5;
  g.rotation.y = (rand() - 0.5) * 1.1;
  scene.add(g);
  // You stand on its shoulders. Narrower than a ledge, which is what makes a
  // body a worse platform than rock and a better one than nothing.
  solids.push({ x, y: y + 1.2, hw: 0.55, mesh: g, body: true });
}

const marks = [];
function addMark(y) {
  const m = new THREE.Mesh(BOX, matMark);
  m.scale.set(0.42, 0.42, 0.42);
  m.position.set(0, y + 1.4, -2.2);
  scene.add(m);
  const halo = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({
    color: COLOR.mark, transparent: true, opacity: 0.16,
  }));
  halo.scale.set(1.5, 1.5, 1.5);
  m.add(halo);
  marks.push(m);
}

/**
 * Ledges thin out and spread apart the higher you get, and nothing else
 * changes — no new mechanic is ever introduced, because the one rule is the
 * whole game. Every ledge is placed inside the reach envelope, so difficulty
 * comes from precision and never from impossibility.
 */
function generate(upTo) {
  while (builtTo < upTo) {
    const t = clamp(builtTo / 320, 0, 1);
    const rise = 2.0 + rand() * (0.9 + t * 1.1);
    const width = 2.6 - t * 1.3 + rand() * 0.8;

    // The furthest sideways this rise allows, then take a fraction of it that
    // grows with height. Early jumps are gentle; late ones sit near the edge.
    const room = REACH_SAFE - rise;
    const maxDx = room > 0 ? Math.sqrt(Math.max(0, room * room - rise * rise)) : 0;
    // Budget for where the player actually stands. They can land anywhere on
    // the previous ledge, including its far edge, so the real jump can be half
    // a ledge longer than the one between the two centres. The bot found three
    // gaps that were impossible for exactly this reason.
    const usable = Math.max(0, maxDx - lastHw);
    const want = usable * (0.46 + t * 0.48) * (0.62 + rand() * 0.38);
    const dir = rand() < 0.5 ? -1 : 1;
    let x = gapScale + want * dir;
    if (Math.abs(x) > 9) x = gapScale - want * dir; // stay in frame

    gapScale = x;
    const prev = builtTo;
    builtTo = prev + rise;
    addLedge(x, builtTo, width);
    lastHw = width / 2;
    if (Math.floor(builtTo / 100) > Math.floor(prev / 100)) {
      addMark(Math.floor(builtTo / 100) * 100);
    }
  }
}

// ------------------------------------------------------------------ the climb

const player = makeFigure(matLive);
scene.add(player);

const state = {
  x: 0, y: 0,
  vx: 0, vy: 0,
  airborne: false,
  takeoff: 0,
  standing: null,
  peakX: 0, peakY: 0,
  best: 0,
  deaths: 0,
  started: false,
  spin: 0,
};

// The aim line: the arc you are actually about to fly, sampled from the real
// integrator, plus a flat mark on the surface it ends on. It is the whole
// tutorial — you see the consequence before you commit to it.
const arc = [];
const dots = [];
for (let i = 0; i < 40; i++) {
  const d = new THREE.Mesh(BOX, matLive);
  d.scale.setScalar(0.1);
  d.visible = false;
  scene.add(d);
  dots.push(d);
}
const landMark = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: COLOR.live }));
landMark.scale.set(1.05, 0.06, 1.05);
landMark.visible = false;
scene.add(landMark);

function restart() {
  const from = state.standing ?? solids[0];
  state.x = from.x;
  state.y = from.y;
  state.vx = 0; state.vy = 0;
  state.airborne = false;
  state.spin = 0;
  state.standing = from;
}

function land(on) {
  state.airborne = false;
  state.vx = 0; state.vy = 0;
  state.spin = 0;
  state.standing = on;
  state.y = on.y;
  if (on.body) teach(2);
}

/**
 * The one rule: **you freeze at the highest point you reached.**
 *
 * Not where you landed, and not where you fell past — at the apex of the arc,
 * which is out in the middle of the gap and above the ledge you left. That is
 * what makes a failed jump into a stepping stone instead of a wasted life, and
 * it is why you can never be permanently stuck: any jump at all peaks above its
 * own take-off, so every death raises the ground.
 *
 * The first version froze the body wherever it crossed back down past the
 * take-off height, which put it at your feet where it was worth nothing. A bot
 * that undershot every jump climbed 5 m in 140 deaths and stalled. Same rule in
 * spirit, completely different game.
 */
function die() {
  state.deaths++;
  addBody(state.peakX, state.peakY);
  teach(1);
  restart();
}

// ------------------------------------------------------------------- teaching

const teachEl = document.getElementById('teach');
const LINES = [
  'DRAG DOWN, AIM, RELEASE',
  'IT STAYS WHERE IT FELL',
  'CLIMB ON WHAT YOU WERE',
];
const taught = [false, false, false];
let teachTimer = 0;

function teach(i) {
  if (taught[i]) return;
  taught[i] = true;
  teachEl.textContent = LINES[i];
  teachEl.classList.add('show');
  teachTimer = 3.6;
}

// --------------------------------------------------------------------- input

let aiming = false;
let aimFrom = { x: 0, y: 0 };
let aimTo = { x: 0, y: 0 };

function aimVector() {
  // Slingshot: you pull away from the direction of travel, the way every thumb
  // already expects to.
  const dx = aimFrom.x - aimTo.x;
  const dy = aimTo.y - aimFrom.y;
  const len = Math.hypot(dx, dy);
  if (len < 6) return null;
  const power = Math.min(len, DRAG_FULL) / DRAG_FULL;
  const s = (MAX_POWER * power) / len;
  return { vx: dx * s, vy: -dy * s };
}

function onDown(e) {
  if (!state.started) { begin(); return; }
  if (state.airborne) return;
  aiming = true;
  aimFrom = aimTo = { x: e.clientX, y: e.clientY };
}

function onMove(e) {
  if (!aiming) return;
  aimTo = { x: e.clientX, y: e.clientY };
}

function onUp() {
  if (!aiming) return;
  aiming = false;
  for (const d of dots) d.visible = false;
  landMark.visible = false;
  const v = aimVector();
  if (!v) return;
  state.vx = v.vx;
  state.vy = v.vy;
  state.airborne = true;
  state.takeoff = state.y;
  state.standing = state.standing ?? solids[0];
}

addEventListener('pointerdown', onDown, { passive: true });
addEventListener('pointermove', onMove, { passive: true });
addEventListener('pointerup', onUp, { passive: true });
addEventListener('pointercancel', onUp, { passive: true });

// --------------------------------------------------------------------- frame

const hudHeight = document.getElementById('height');
const hudToll = document.getElementById('toll');
const startCard = document.getElementById('start');

function begin() {
  state.started = true;
  startCard.classList.add('gone');
  teach(0);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // A portrait phone gets a wider vertical field so the next ledge and the
  // ground you left are both on screen. A landscape desktop does not need it.
  camera.fov = h > w ? 58 : 46;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

/**
 * One tick of flight, and the ONLY place flight is integrated.
 *
 * The preview and the real jump call this same function, because a trajectory
 * line computed a second way is a trajectory line that lies. The first version
 * drew the arc from the closed-form parabola, offset 0.7 m above the feet,
 * while the jump itself ran semi-implicit Euler from the feet — so the dots
 * showed a flight the player was never going to take. It read exactly as it
 * was described in testing: "the jumps are not accurate."
 */
function flight(p, dt) {
  p.py = p.y; p.px = p.x;
  p.vy += GRAVITY * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
}

/** The highest thing the segment (px,py)->(x,y) fell through. */
function surfaceUnder(p, skip) {
  if (p.vy >= 0) return null;
  let best = null;
  for (const s of solids) {
    if (s === skip) continue;
    if (p.py < s.y || p.y > s.y) continue;
    const t = (p.py - s.y) / (p.py - p.y || 1e-6);
    const cx = p.px + (p.x - p.px) * t;
    if (Math.abs(cx - s.x) > s.hw + PLAYER_HALF) continue;
    if (!best || s.y > best.y) best = s;
  }
  return best;
}

/**
 * Fly the launch we are about to make, with the same integrator and the same
 * timestep, and report exactly where it ends. The arc stops at the surface it
 * actually hits, so the player aims at a landing point rather than at a hint.
 */
function predict(v, out) {
  const p = { x: state.x, y: state.y, vx: v.vx, vy: v.vy, px: state.x, py: state.y };
  const floor = state.y;
  // The real jump keeps extending the tower as it rises, so the preview has to
  // see at least as much world as the jump will.
  generate(state.y + GEN_AHEAD);
  out.length = 0;
  let landed = null;
  for (let f = 0; f < 900; f++) {   // the same budget the real flight loop gets
    flight(p, 1 / 60);
    if (f % 4 === 0) out.push(p.x, p.y);
    const hit = surfaceUnder(p, state.standing);
    if (hit) {
      landed = { x: clamp(p.x, hit.x - hit.hw, hit.x + hit.hw), y: hit.y, solid: hit };
      break;
    }
    // The death floor is the ledge you are standing on RIGHT NOW, not
    // `state.takeoff`, which still holds the previous jump's launch height
    // while you are aiming. Using the stale one made the arc predict landings
    // on ledges far below that the real jump dies before ever reaching.
    //
    // Byte-for-byte the same test as the one in step(). It carried five
    // centimetres of slack for one build, and five centimetres was enough to
    // let the arc promise a landing on a ledge just under the lip that the
    // real jump died before ever touching.
    if (p.vy < 0 && p.y < floor) { landed = null; break; }
  }
  return landed;
}

function step(dt) {
  generate(state.y + GEN_AHEAD);

  if (state.airborne) {
    flight(state, dt);
    state.spin += dt * (state.vx > 0 ? 7 : -7);
    if (state.y > state.peakY) { state.peakY = state.y; state.peakX = state.x; }

    const hit = surfaceUnder(state, state.standing);
    if (hit) {
      state.x = clamp(state.x, hit.x - hit.hw, hit.x + hit.hw);
      land(hit);
    } else if (state.vy < 0 && state.y < state.takeoff) {
      die();
    }
  }

  if (state.y > state.best) state.best = state.y;

  // The aim line, and the mark where it ends.
  if (aiming) {
    const v = aimVector();
    const landing = v ? predict(v, arc) : null;
    for (let i = 0; i < dots.length; i++) {
      const j = i * 2;
      const on = !!v && j < arc.length;
      dots[i].visible = on;
      if (on) dots[i].position.set(arc[j], arc[j + 1] + 0.55, PLANE_Z);
    }
    landMark.visible = !!landing;
    if (landing) landMark.position.set(landing.x, landing.y + 0.06, PLANE_Z);
  }

  // Presentation.
  player.position.set(state.x, state.y, PLANE_Z);
  player.rotation.z = state.airborne ? Math.sin(state.spin) * 0.22 : 0;

  // The player sits low in frame and the camera looks up the shaft, because the
  // only thing you ever need to see is what is above you. Horizontal follow is
  // damped to a third so the tower does not slide about under you.
  camera.position.x += (state.x * 0.34 - camera.position.x) * Math.min(1, dt * 4);
  camera.position.y += (state.y + 5.4 - camera.position.y) * Math.min(1, dt * 5);
  camera.position.z = 11.4;
  camera.lookAt(camera.position.x, camera.position.y - 1.4, 0);

  key.position.set(state.x + 6, state.y + 12, 9);

  for (const m of marks) m.rotation.y += dt * 1.6;

  if (teachTimer > 0) {
    teachTimer -= dt;
    if (teachTimer <= 0) teachEl.classList.remove('show');
  }

  hudHeight.innerHTML = `${Math.max(0, Math.round(state.best))}<i>m</i>`;
  hudToll.textContent = state.deaths === 0
    ? ''
    : `${state.deaths} ${state.deaths === 1 ? 'STONE' : 'STONES'} BELOW YOU`;
}

let last = performance.now();
function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state.started) step(dt);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------- boot

generate(GEN_AHEAD);
state.standing = solids[0];
state.x = solids[0].x;
state.y = solids[0].y;
camera.position.set(0, state.y + 5.4, 11.4);
resize();
requestAnimationFrame(tick);

// Headless harness hook, same idea as the first game's: the test rig drives the
// real loop rather than a copy of it.
window.CAIRN = {
  state, solids, step, begin, generate, predict, GRAVITY, MAX_POWER,
  arc, teach: () => taught,
};
