import { FEEL, COLUMN, BIOME_SPAN, BIOMES, biomeAt, newBiomeSlot, MEMORY_GOLD,
  FLOORS, CHARACTERS } from './feel.js';
import { landmarksIn } from './sim.js';
import { makeRng, erosionOf, EROSION } from './sim.js';

/** @typedef {import('./sim.js').Sim} Sim */
/** @typedef {import('./types.js').Solid} Solid */
/** @typedef {import('./feel.js').BiomeSlot} BiomeSlot */
/** @typedef {import('./input.js').Input} Input */
/**
 * The presentation-layer state main.js owns and the renderer reads.
 * @typedef {object} UiState
 * @property {number} squash
 * @property {number} flash
 * @property {number} bestFlash
 * @property {number} dead
 * @property {number} wash
 * @property {boolean} started
 * @property {boolean} monument
 * @property {boolean} [daily]
 * @property {number} [runLaunches] launches this attempt; the ghost's index
 */

/**
 * THE SILHOUETTE OF A BODY, and there is one of these in the program.
 *
 * Exported because the share poster draws corpses too, and it used to draw them
 * as `fillRect(-7, -11, 14, 22)` — so the single image that leaves a player's
 * phone showed the tower as a column of little boxes, in a game whose whole
 * subject is that the boxes are people. A poster that does not look like the
 * game is worse than no poster.
 *
 * @param {CanvasRenderingContext2D} ctx centred on the body
 * @param {number} hw
 * @param {number} hh
 * @param {number} pose 0-3, the four ways a body comes to rest
 */
export function figurePath(ctx, hw, hh, pose) {
  bodyOutline(ctx, hw, hh, [0, 0.22, -0.18, 0.34][pose & 3], 0, 0, 0);
}

/**
 * HEAD, SHOULDERS, BODY — the one outline, and the reason there is a head.
 *
 * The silhouette this replaced was a six-point blob. As a CORPSE, forty metres
 * up in a tower of two hundred, that was enough: all it has to say is "this was
 * a person and this shelf holds". As the thing a player looks at for the entire
 * session it said nothing at all, and "the game looks generic" is a note this
 * project has had twice. A head is the cheapest mark that turns a shape into a
 * creature, and it is the only one that can also carry a GAZE.
 *
 * THE CROWN SITS EXACTLY ON -hh AND NEVER ABOVE IT. In a corpse's local frame
 * `-hh` is the load-bearing shelf — the bright bar in `_solids` is drawn on that
 * exact line because DECISIONS §16 forbids drawing a hold anywhere but where the
 * collision is. A head modelled as mass ADDED above the box would draw a skull
 * poking through the surface you are standing on, and would quietly tell the
 * player they can land on it. So head, shoulders and body are carved out of the
 * same bounding box the physics already uses; nothing about the hitbox moves.
 *
 * @param {CanvasRenderingContext2D} ctx centred on the body
 * @param {number} hw
 * @param {number} hh
 * @param {number} tilt lean of the upper body, in fractions of full width
 * @param {number} look -1..1 where the head is turned; 0 for a corpse
 * @param {number} crouch 0..1 gather
 * @param {number} stretch 0..1 extension
 */
function bodyOutline(ctx, hw, hh, tilt, look, crouch, stretch) {
  // Gather takes height out and puts it into width, the way a person loading a
  // jump does; extension is the reverse. Roughly volume-preserving, so the
  // figure changes shape without ever reading as growing or shrinking.
  const H = hh * (1 - crouch * 0.30 + stretch * 0.26);
  const W = hw * (1 + crouch * 0.22 - stretch * 0.14);
  const w = W * 2;
  // HEAD RADIUS IS BOUNDED BY THE WIDTH TOO, NOT ONLY THE HEIGHT.
  //
  // Erosion narrows a corpse by scaling `hw` to 0.45 and leaves `hh` alone, so a
  // head sized off height alone is the one part of the figure that does NOT
  // decay — and it cost real legibility. Acceptance 13's separation fell from
  // 37.0 to 29.3, and on the SHELF axis, the tell DECISIONS §16 calls the
  // fastest read, THIN and TOP closed from 9.6 points apart to 3.3. The gate
  // still said PASS at a threshold of 3, which is exactly why the number has to
  // be read and not the word.
  const rh = Math.min(H * 0.26, W * 0.46);
  const hy = -H + rh;               // centre, so the crown lands on -H
  const hx = tilt * w * 0.55 + look * W * 0.30;
  const sy = hy + rh * 0.95;        // the shoulder line
  ctx.beginPath();
  // Torso: shoulders out, waist in, feet gathered.
  ctx.moveTo(-W * 0.46, H);
  ctx.lineTo(W * 0.42, H);
  ctx.lineTo(W * 0.78, H * 0.10);
  ctx.lineTo(W * 0.62 + tilt * w * 0.5, sy);
  ctx.lineTo(-W * 0.62 + tilt * w * 0.5, sy);
  ctx.lineTo(-W * 0.80, H * 0.10);
  ctx.closePath();
  // Head, as a second subpath of the same path so one fill and one stroke still
  // do the whole figure and every existing call site keeps working unchanged.
  ctx.moveTo(hx + rh, hy);
  ctx.ellipse(hx, hy, rh, rh * 1.06, 0, 0, Math.PI * 2);
}

/**
 * A LIMB, in two segments. Root, elbow or knee, end.
 *
 * Drawn as a round-capped stroke rather than a filled outline, because at the
 * size a phone actually renders this — a body is about twenty pixels tall — a
 * filled limb with a boundary is mush, and a thick round stroke still reads as
 * an arm. Two segments, because one is a stick and three is a budget nobody can
 * see at this scale.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x root
 * @param {number} y root
 * @param {number} a1 upper segment angle, radians, 0 = down
 * @param {number} a2 lower segment angle
 * @param {number} l1 upper length
 * @param {number} l2 lower length
 */
function limb(ctx, x, y, a1, a2, l1, l2) {
  const jx = x + Math.sin(a1) * l1, jy = y + Math.cos(a1) * l1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(jx, jy);
  ctx.lineTo(jx + Math.sin(a2) * l2, jy + Math.cos(a2) * l2);
  ctx.stroke();
}

/**
 * THE LIVING CLIMBER, ON A RIG.
 *
 * The figure was a filled blob, then a blob with a head, and neither read as a
 * person — which is the note this project kept getting and kept half-answering.
 * A person is legible because of ARMS AND LEGS THAT MOVE: knees that fold under
 * a crouch, arms that swing back before a jump and reach on the way up. This is
 * a five-part rig — head, torso, two arms, two legs — posed from the same three
 * stance values the outline already used, so nothing new has to be tracked.
 *
 * WHY THE PLAYER GETS THIS AND A CORPSE DOES NOT.
 *
 * A corpse keeps the compact outline. That is not a shortcut, it is the truth of
 * the thing: a body that has fallen is collapsed, not standing with its limbs
 * out — and it is also what protects the read the tower depends on. Acceptance
 * 13 measures whether the four erosion stages separate, largely on how much
 * load-bearing shelf each still has; sprawling limbs off a corpse would add lit
 * area that has nothing to do with whether it holds weight, and adding a head
 * alone already cost that margin 37.0 to 31.6. The living figure is the one you
 * watch, so it gets the articulation; the tower stays readable.
 *
 * They still read as one creature: same head, same proportions, same costume,
 * same silhouette width. Alive it stands up. Dead it is a heap.
 *
 * @param {CanvasRenderingContext2D} ctx centred on the body
 * @param {number} hw
 * @param {number} hh
 * @param {number} lean -1..1
 * @param {number} crouch 0..1
 * @param {number} stretch 0..1
 * @param {number} look -1..1
 * @param {number} phase idle cycle, radians — the weight shift while standing
 * @param {number} idle 0..1 how settled the body is
 */
export function figureRig(ctx, hw, hh, lean, crouch, stretch, look, phase, idle, aim, ch) {
  const H = hh, W = hw;
  const C = ch || CHARACTERS[0];
  // ANGLES ARE MEASURED FROM STRAIGHT DOWN, because `limb` steps by
  // (sin a, cos a) and screen y grows downward: 0 is a limb hanging, +/-pi is a
  // limb raised. The first version of this used ~2.75 rad as the resting arm
  // angle, which is 157 degrees — almost straight UP — so the climber stood
  // permanently cheering, threw its arms overhead to wind up a jump, and
  // signalled a touchdown on every landing. All four stances "passed" the probe
  // because they differed from each other; they were just all wrong.
  const rh = Math.min(H * C.head, W * 0.62);
  const headY = -H + rh;                       // crown lands exactly on -H
  const shoY = -H + rh * 2.05;
  const hipY = H * (0.12 + crouch * 0.26 - stretch * 0.08);
  const legL = (H - hipY) * C.leg;
  const armL = (hipY - shoY) * 0.62;
  const hipX = -lean * W * 0.12;
  const t = phase;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // ---- LEGS. A gather folds them outward into a squat, which is the one knee
  // bend that reads from the front; flight sweeps them together and back.
  const kb = crouch * 1.05;
  const trail = stretch * 0.55;
  const shift = Math.sin(t) * 0.05 * idle;
  const out = 0.16;
  ctx.lineWidth = Math.max(1.1, W * C.limb * 1.28);
  limb(ctx, hipX - W * 0.20, hipY,
       -(out + kb * 0.60) + trail + shift, -(out - kb * 0.42) + trail * 1.5 + shift,
       legL, legL);
  limb(ctx, hipX + W * 0.20, hipY,
       (out + kb * 0.60) + trail - shift, (out - kb * 0.42) + trail * 1.5 - shift,
       legL, legL);

  // ---- ARMS. Hanging at rest; swept BACK and low to load a jump; reaching up
  // and out in flight; thrown wide to catch a landing.
  const swing = Math.sin(t * 1.1 + 1.0) * 0.09 * idle;
  const reach = stretch * 2.15;                 // toward overhead
  const wide = Math.max(0, crouch - aim) * 1.5; // landing only, not the wind-up
  const back = aim * 0.85;                      // the wind-up, arms behind
  ctx.lineWidth = Math.max(1, W * C.limb);
  const aBase = 0.22 + reach + wide;
  limb(ctx, hipX - W * 0.34, shoY,
       -(aBase) - back * lean + swing, -(aBase + 0.16 + reach * 0.3) - back * 1.4 * lean + swing,
       armL, armL * 0.95);
  limb(ctx, hipX + W * 0.34, shoY,
       (aBase) - back * lean - swing, (aBase + 0.16 + reach * 0.3) - back * 1.4 * lean - swing,
       armL, armL * 0.95);

  // ---- TORSO, tapered, so the costume marks have something to sit on.
  ctx.beginPath();
  ctx.moveTo(hipX - W * C.torso * 0.74, hipY);
  ctx.lineTo(hipX - W * C.torso - lean * W * 0.10, shoY);
  ctx.lineTo(hipX + W * C.torso - lean * W * 0.10, shoY);
  ctx.lineTo(hipX + W * C.torso * 0.74, hipY);
  ctx.closePath();
  ctx.fill();

  // ---- HEAD, clear of the shoulders and turned where the climber is looking.
  const hcx = hipX - lean * W * 0.22 + look * W * 0.18;
  ctx.beginPath();
  ctx.ellipse(hcx, headY, rh, rh * 1.04, lean * 0.10, 0, Math.PI * 2);
  ctx.fill();

  // ---- AND WHICH CLIMBER THIS IS.
  characterMark(ctx, hcx, headY, rh, W, H, C.mark, C.ink, look);
}

/**
 * THE ONE THING THAT SAYS WHICH CLIMBER THIS IS.
 *
 * Proportion does most of the work — head size alone separates a cat from an
 * astronaut before a single detail resolves — so each character gets exactly one
 * mark on top of it, drawn around the head where the eye already is. One, not
 * three: at twenty pixels tall a second detail is noise that makes the first
 * harder to read, which is the same lesson the costume marks had to learn.
 *
 * @param {CanvasRenderingContext2D} ctx centred on the body
 * @param {number} hx head centre x
 * @param {number} hy head centre y
 * @param {number} rh head radius
 * @param {number} W half-width
 * @param {number} H half-height
 * @param {string} kind CHARACTERS[].mark
 * @param {number[]} ink the character's detail colour
 * @param {number} look -1..1
 */
function characterMark(ctx, hx, hy, rh, W, H, kind, ink, look) {
  const col = (t) => `rgba(${ink[0] | 0},${ink[1] | 0},${ink[2] | 0},${t})`;
  ctx.save();
  if (kind === 'helmet') {
    ctx.fillStyle = col(0.85);
    ctx.beginPath();
    ctx.ellipse(hx, hy - rh * 0.26, rh * 1.06, rh * 0.80, 0, Math.PI, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'pack') {
    ctx.fillStyle = col(0.80);
    ctx.fillRect(hx - rh * 1.5 - look * rh * 0.3, hy + rh * 1.1, rh * 1.0, rh * 1.9);
    ctx.fillStyle = col(0.85);
    ctx.beginPath();
    ctx.ellipse(hx, hy - rh * 0.34, rh * 1.02, rh * 0.62, 0, Math.PI, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'visor') {
    // A whole helmet, with the visor as the lit part.
    ctx.strokeStyle = col(0.9); ctx.lineWidth = Math.max(1, rh * 0.20);
    ctx.beginPath(); ctx.arc(hx, hy, rh * 1.10, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = col(0.72);
    ctx.beginPath();
    ctx.ellipse(hx + look * rh * 0.22, hy - rh * 0.06, rh * 0.66, rh * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'ears') {
    ctx.fillStyle = col(0.88);
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(hx + sgn * rh * 0.34, hy - rh * 0.80);
      ctx.lineTo(hx + sgn * rh * 0.86, hy - rh * 1.62);
      ctx.lineTo(hx + sgn * rh * 0.95, hy - rh * 0.52);
      ctx.closePath(); ctx.fill();
    }
    // Tail, which is the other half of reading as a cat.
    ctx.strokeStyle = col(0.80); ctx.lineWidth = Math.max(1, rh * 0.26);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-W * 0.30, H * 0.62);
    ctx.quadraticCurveTo(-W * 1.30, H * 0.50, -W * 1.10, H * 0.02);
    ctx.stroke();
  } else if (kind === 'round-ears') {
    ctx.fillStyle = col(0.88);
    for (const sgn of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(hx + sgn * rh * 0.80, hy - rh * 0.74, rh * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = col(0.55);
    ctx.beginPath();
    ctx.ellipse(hx + look * rh * 0.20, hy + rh * 0.36, rh * 0.42, rh * 0.30, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'mask') {
    ctx.fillStyle = col(0.80);
    ctx.beginPath();
    ctx.ellipse(hx + look * rh * 0.18, hy - rh * 0.08, rh * 0.86, rh * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col(0.7); ctx.lineWidth = Math.max(1, rh * 0.16);
    ctx.beginPath(); ctx.moveTo(hx - rh, hy - rh * 0.1); ctx.lineTo(hx + rh, hy - rh * 0.1);
    ctx.stroke();
  } else if (kind === 'antenna') {
    ctx.strokeStyle = col(0.9); ctx.lineWidth = Math.max(1, rh * 0.16);
    ctx.beginPath();
    ctx.moveTo(hx, hy - rh * 0.9); ctx.lineTo(hx + rh * 0.3, hy - rh * 1.9);
    ctx.stroke();
    ctx.fillStyle = col(1);
    ctx.beginPath(); ctx.arc(hx + rh * 0.3, hy - rh * 2.0, rh * 0.28, 0, Math.PI * 2); ctx.fill();
    // One lit eye, the classic read for a machine.
    ctx.fillStyle = col(1);
    ctx.fillRect(hx - rh * 0.5 + look * rh * 0.25, hy - rh * 0.12, rh * 1.0, rh * 0.24);
  } else if (kind === 'hood') {
    ctx.fillStyle = col(0.82);
    ctx.beginPath();
    ctx.moveTo(hx - rh * 1.25, hy + rh * 0.9);
    ctx.quadraticCurveTo(hx, hy - rh * 2.0, hx + rh * 1.25, hy + rh * 0.9);
    ctx.closePath(); ctx.fill();
    // The face stays in shadow, which is the whole point of a hood.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.ellipse(hx + look * rh * 0.2, hy + rh * 0.05, rh * 0.62, rh * 0.52, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'ribbon') {
    ctx.strokeStyle = col(0.75); ctx.lineWidth = Math.max(1, rh * 0.30);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(W * 0.2, -H * 0.1);
    ctx.bezierCurveTo(W * 1.7, -H * 0.5, W * 1.2, H * 0.6, W * 2.1, H * 0.35);
    ctx.stroke();
  } else if (kind === 'flame') {
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, rh * 2.6);
    g.addColorStop(0, `rgba(255,240,190,0.55)`);
    g.addColorStop(1, 'rgba(255,220,140,0)');
    ctx.fillStyle = g;
    ctx.fillRect(hx - rh * 2.6, hy - rh * 2.6, rh * 5.2, rh * 5.2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = col(0.55);
    ctx.beginPath();
    ctx.moveTo(hx, hy - rh * 2.0);
    ctx.quadraticCurveTo(hx + rh * 0.6, hy - rh * 0.6, hx, hy + rh * 0.2);
    ctx.quadraticCurveTo(hx - rh * 0.6, hy - rh * 0.6, hx, hy - rh * 2.0);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * WHAT THE CLIMBER IS WEARING, which is a function of WHICH FLOOR THIS IS.
 *
 * Six marks-sets, one per floor, drawn onto the shared silhouette: a bow tie in
 * the lobby, a lapel and tie on the office floors, goggles and trunks at the
 * pool, a sash in the residences, a hi-vis band and a hard hat in the plant,
 * crossed straps on the roof. Two to four vector primitives each — no sprite, no
 * atlas, no asset, and the bundle does not grow by a kilobyte of content.
 *
 * TWO RULES MAKE THIS SAFE TO PUT ON A CORPSE.
 *
 * It is keyed to ALTITUDE, never to the individual body. Every corpse on a floor
 * wears that floor's uniform, so the costume can never be the reason two bodies
 * look different — which means the only thing shape still varies with is
 * erosion, and erosion is the one read the tower cannot lose.
 *
 * And it FADES WITH SOLIDITY. A body that no longer holds your weight loses its
 * uniform as it goes, until a MEMORY corpse is a bare outline again. That is the
 * right image, and it is also what stops acceptance 13 from quietly measuring
 * clothing instead of decay.
 *
 * Everything is drawn inside a clip of the body outline, so a costume can never
 * change the silhouette by a single pixel.
 *
 * @param {CanvasRenderingContext2D} ctx centred on the body
 * @param {number} W half-width actually drawn
 * @param {number} H half-height actually drawn
 * @param {string} kind FLOORS[].costume
 * @param {number} a 0..1 overall strength
 * @param {number} look -1..1, so a turned head takes its goggles with it
 * @param {number[]} accent the floor's accent, for the one lit mark each has
 */
export function costumeMarks(ctx, W, H, kind, a, look, accent) {
  if (a <= 0.02) return;
  const ink = (t) => `rgba(14,11,16,${(t * a).toFixed(3)})`;
  const lit = (t) => `rgba(${accent[0] | 0},${accent[1] | 0},${accent[2] | 0},${(t * a).toFixed(3)})`;
  const rh = Math.min(H * 0.26, W * 0.46);
  const hy = -H + rh;                 // head centre
  const sy = hy + rh * 0.95;          // shoulders
  const hx = look * W * 0.30;
  const waist = H * 0.30;

  if (kind === 'waiter') {
    // Bow tie at the throat, and an apron below the waist.
    ctx.fillStyle = ink(0.85);
    ctx.beginPath();
    ctx.moveTo(hx - rh * 0.62, sy); ctx.lineTo(hx, sy + rh * 0.20);
    ctx.lineTo(hx + rh * 0.62, sy); ctx.lineTo(hx + rh * 0.42, sy + rh * 0.52);
    ctx.lineTo(hx - rh * 0.42, sy + rh * 0.52); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = ink(0.30);
    ctx.fillRect(-W, waist, W * 2, H - waist);
  } else if (kind === 'suit') {
    // Lapels as a V, a tie down the centre, dark jacket either side.
    ctx.fillStyle = ink(0.62);
    ctx.fillRect(-W, sy, W * 2, H - sy);
    ctx.fillStyle = `rgba(250,250,252,${(0.55 * a).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(hx - W * 0.30, sy); ctx.lineTo(hx, H * 0.10);
    ctx.lineTo(hx + W * 0.30, sy); ctx.closePath();
    ctx.fill();
    ctx.fillStyle = lit(0.75);
    ctx.fillRect(hx - W * 0.07, sy + rh * 0.2, W * 0.14, H * 0.42);
  } else if (kind === 'swim') {
    // Trunks, and goggles pushed up onto the forehead.
    ctx.fillStyle = lit(0.70);
    ctx.fillRect(-W, waist, W * 2, H * 0.34);
    ctx.strokeStyle = ink(0.72);
    ctx.lineWidth = Math.max(1, rh * 0.20);
    ctx.beginPath();
    ctx.moveTo(hx - rh * 0.92, hy - rh * 0.34);
    ctx.lineTo(hx + rh * 0.92, hy - rh * 0.34);
    ctx.stroke();
  } else if (kind === 'robe') {
    // A soft collar and a sash at the waist.
    ctx.strokeStyle = ink(0.42);
    ctx.lineWidth = Math.max(1, rh * 0.22);
    ctx.beginPath();
    ctx.moveTo(hx - W * 0.34, sy); ctx.lineTo(hx, H * 0.04);
    ctx.lineTo(hx + W * 0.34, sy);
    ctx.stroke();
    ctx.fillStyle = lit(0.62);
    ctx.fillRect(-W, waist, W * 2, H * 0.16);
  } else if (kind === 'hivis') {
    // Two reflective bands and a hard hat brim.
    ctx.fillStyle = lit(0.80);
    ctx.fillRect(-W, sy + rh * 0.55, W * 2, H * 0.16);
    ctx.fillRect(-W, waist, W * 2, H * 0.14);
    ctx.fillStyle = ink(0.80);
    ctx.beginPath();
    ctx.ellipse(hx, hy - rh * 0.30, rh * 1.12, rh * 0.46, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'harness') {
    // Straps crossing the chest, and a belt.
    ctx.strokeStyle = ink(0.70);
    ctx.lineWidth = Math.max(1, rh * 0.26);
    ctx.beginPath();
    ctx.moveTo(-W * 0.55, sy); ctx.lineTo(W * 0.45, waist);
    ctx.moveTo(W * 0.55, sy); ctx.lineTo(-W * 0.45, waist);
    ctx.stroke();
    ctx.fillStyle = lit(0.72);
    ctx.fillRect(-W, waist, W * 2, H * 0.13);
  }
}

/**
 * THE SAME BODY, ALIVE.
 *
 * The living player was a four-point diamond while every corpse in the tower was
 * the silhouette above — so you were an abstract shape while alive and a person
 * once dead, which is backwards in a game whose premise is that the thing that
 * lands is the thing that becomes the stone. It also made the most-looked-at
 * object on screen the most generic one it could possibly be, and "the game
 * looks generic" is a note this project has now had twice.
 *
 * The same outline as a corpse, driven continuously instead of by a discrete
 * pose, so the body in the air and the body it leaves behind are visibly one
 * creature. That recognition is the point and is why this is not simply a nicer
 * sprite.
 *
 *   lean    -1..1  which way the weight is going. Follows the aim while you are
 *                  aiming and horizontal speed while you are not, so the figure
 *                  is always addressing the direction it is about to travel.
 *   crouch   0..1  gathering. Rises while aiming — a wind-up you can see — and
 *                  on the frame of a landing.
 *   stretch  0..1  the opposite: extended along flight.
 *   look    -1..1  where the HEAD is turned. A corpse always passes 0: a dead
 *                  body does not look anywhere, and that difference is the
 *                  clearest thing separating the living figure from the tower
 *                  of them underneath it.
 *
 * @param {CanvasRenderingContext2D} ctx centred on the body
 * @param {number} hw
 * @param {number} hh
 * @param {number} lean -1..1
 * @param {number} crouch 0..1
 * @param {number} stretch 0..1
 * @param {number} look -1..1
 */
export function figureLive(ctx, hw, hh, lean, crouch, stretch, look) {
  bodyOutline(ctx, hw, hh, lean * 0.34, look, crouch, stretch);
}

/**
 * The scene, drawn in Canvas2D. The post chain lives in post.js; everything
 * here produces the raw image it grades.
 *
 * ART DIRECTION, in one sentence: a dark weightless void lit by a single living
 * light, which is the player. Nothing in the frame is a flat undifferentiated
 * value — the background is always a gradient, geometry brightness is always a
 * function of distance to the player, and every colour on screen comes from the
 * three-hue biome palette for the current altitude.
 *
 * The corpses are the hero visual and are treated as such: each holds the pose
 * and rotation it died in, stores its age, glows with the accent when fresh and
 * cools toward gold as it recedes into history, rim-lights when the player's
 * light passes, and is joined to the next in death order by a thread of light.
 * The tower reads as one continuous line of attempts, which is the whole game.
 *
 * Performance: no allocation in the loop. Parallax bands are point arrays
 * generated once and redrawn as paths (cheaper than tinting cached bitmaps and
 * fully dynamic across biome cross-fades). Dust and particles are pooled. The
 * background gradient is rebuilt only when the biome moves materially.
 */

const TAU = Math.PI * 2;
/** @type {(v: number, a: number, b: number) => number} */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** @type {(a: number, b: number, t: number) => number} */
const lerp = (a, b, t) => a + (b - a) * t;

/** @type {(c: number[], a: number|string) => string} */
const rgb = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** Rec. 709 relative luminance, the axis "brighter than" is decided on. */
/** @type {(c: number[]) => number} */
const lumOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * THE SILHOUETTE LANGUAGE OF EACH BIOME, in the order BIOMES declares them.
 *
 * Colour tells you which biome you are in. Shape is what stops the twelfth pass
 * through it looking like the first.
 */
const BAND_KINDS = ['spire', 'block', 'dome', 'needle', 'shard', 'facet'];

/**
 * Which biome darkness belongs to, found by NAME rather than written as 3.
 * Insert a biome one day and a hard-coded index puts the dark in the wrong
 * place with nothing to catch it; this moves with the palette.
 */
const VOID_BIOME = BIOMES.findIndex((b) => b.name === 'VOID');

/**
 * One parallax layer's outline, in a biome's own geometry.
 *
 * Returns `n + 1` points as a flat [x0, y0, x1, y1, ...] with x ascending from 0
 * to 1 and y a height fraction. EVERY KIND MUST RETURN THE SAME LENGTH for a
 * given `n`, because two of them are interpolated against each other while a
 * biome crossfades — a shape that changes its point count would have to pop.
 *
 * @param {string} kind
 * @param {number} level  0 is the furthest and tallest, 2 the nearest
 * @param {number} n      segments; the array is (n + 1) points
 * @param {() => number} rng
 * @returns {Float32Array}
 */
function bandShape(kind, level, n, rng) {
  const out = new Float32Array((n + 1) * 2);
  const amp = 0.42 - level * 0.09;
  /** @type {(i: number, y: number) => void} */
  const put = (i, y) => { out[i * 2] = i / n; out[i * 2 + 1] = clamp(y, 0.01, 0.98); };

  if (kind === 'block') {
    // SIGNAL. Stepped plateaus with vertical walls — architecture, not rock.
    // A run of points holds one height, then jumps.
    let h = 0.1 + rng() * amp;
    let hold = 0;
    for (let i = 0; i <= n; i++) {
      if (hold-- <= 0) { h = 0.06 + rng() * amp; hold = 2 + Math.floor(rng() * 3); }
      put(i, h);
    }
  } else if (kind === 'dome') {
    // BLOOM. Overlapping rounded humps — organic, swollen, no sharp corners.
    const humps = 3 + level;
    /** @type {number[][]} */
    const hs = [];
    for (let k = 0; k < humps; k++) hs.push([rng(), 0.10 + rng() * 0.22, 0.14 + rng() * amp]);
    for (let i = 0; i <= n; i++) {
      const x = i / n;
      let y = 0.05;
      for (const [cx, w, hh] of hs) {
        const d = Math.abs(x - (cx ?? 0)) / (w ?? 0.2);
        if (d < 1) y = Math.max(y, (hh ?? 0.2) * Math.cos(d * Math.PI * 0.5) ** 0.7);
      }
      put(i, y);
    }
  } else if (kind === 'needle') {
    // VOID. Mostly empty, with rare thin spikes. The emptiest biome should LOOK
    // like the emptiest biome rather than like a dark version of a busy one.
    for (let i = 0; i <= n; i++) {
      const spike = rng() < 0.13;
      put(i, spike ? 0.2 + rng() * amp * 1.5 : 0.02 + rng() * 0.05);
    }
  } else if (kind === 'shard') {
    // CINDER. Asymmetric sawtooth: a slow rise then a vertical drop. Broken.
    let h = 0.08;
    for (let i = 0; i <= n; i++) {
      h += amp * 0.34 * rng();
      if (h > amp || rng() < 0.12) { put(i, h); h = 0.04 + rng() * 0.06; continue; }
      put(i, h);
    }
  } else if (kind === 'facet') {
    // GLACIER. Long straight runs meeting at points — crystal, not noise.
    let i = 0;
    let h = 0.1 + rng() * amp;
    while (i <= n) {
      const run = 3 + Math.floor(rng() * 6);
      const to = 0.06 + rng() * amp;
      for (let k = 0; k <= run && i <= n; k++, i++) put(i, h + (to - h) * (k / run));
      h = to;
    }
  } else {
    // ASH, and the fallback. The original jagged noise, kept exactly, because it
    // is the silhouette the art direction was tuned against.
    for (let i = 0; i <= n; i++) put(i, rng() * amp + 0.05);
  }
  return out;
}

// ------------------------------------------------------------------- camera

export class Camera {
  constructor() {
    this.x = COLUMN * 0.5;
    this.y = 0;
    this.viewH = FEEL.camera.viewH;
    this.zoom = 1;
    this.rot = 0;
    this.rotVel = 0;
    this.shake = 0;
    this.shakeX = 0;
    this.shakeY = 0;
    this.t = 0;

    // Monument view: 0 is playing, 1 is the whole lifetime tower on one screen.
    this.mon = 0;
    this.monTarget = 0;
    this.monTop = 0;        // the summit to frame, world units
    this.monX = COLUMN * 0.5;   // the tower's own midline, world units
    this.aspect = 9 / 19.5;     // width / height, refreshed by the renderer
  }

  /** @param {number} force 0..1 */
  kick(force) {
    const C = FEEL.camera;
    this.rotVel += (Math.random() < 0.5 ? -1 : 1) * C.impactRotDeg * clamp(force, 0, 1) * 0.06;
    this.shake = Math.min(C.shakeMax, this.shake + C.shakeMax * clamp(force, 0, 1));
  }

  /**
   * Smooth follow with velocity lookahead and a vertical dead zone, zooming out
   * as speed rises. Shake is decaying value noise rather than random jitter, so
   * it reads as a physical wobble instead of a broken television.
   */
  /**
   * @param {number} dt
   * @param {{x: number, y: number, vx: number, vy: number}} body
   * @param {boolean} reduced
   */
  update(dt, body, reduced) {
    const C = FEEL.camera;
    this.t += dt;

    const wantX = clamp(body.x + body.vx * C.lookaheadX, COLUMN * 0.5 - 22, COLUMN * 0.5 + 22);
    let wantY = body.y + body.vy * C.lookaheadY;
    if (Math.abs(wantY - this.y) < C.deadZoneY) wantY = this.y;

    this.x += (wantX - this.x) * Math.min(1, dt * C.followX);
    this.y += (wantY - this.y) * Math.min(1, dt * C.followY);

    const speed = Math.min(1, Math.abs(body.vy) / FEEL.maxFallSpeed);
    const wantZoom = 1 + (C.zoomAtSpeed - 1) * speed;
    this.zoom += (wantZoom - this.zoom) * Math.min(1, dt * C.zoomEase);
    this.viewH = C.viewH * this.zoom;

    // Rotation settles as a critically damped spring over ~300ms.
    const k = 1000 / C.impactRotDecay;
    this.rotVel -= this.rot * k * k * dt;
    this.rotVel -= this.rotVel * 2 * k * dt;
    this.rot += this.rotVel * dt;

    this.shake = Math.max(0, this.shake - this.shake * C.shakeDecay * dt);
    if (reduced) { this.shake = 0; this.rot *= 0.0; }
    const s = this.shake;
    this.shakeX = (noise1(this.t * 21.7) - 0.5) * 2 * s;
    this.shakeY = (noise1(this.t * 18.3 + 40) - 0.5) * 2 * s;

    // MONUMENT VIEW.
    //
    // Everything above is the playing camera. This blends it toward a single
    // frame holding the entire tower — every body, from the base — and takes
    // the shake and the impact roll out on the way, because the point of the
    // shot is that it is still. It is applied here rather than in main.js so
    // there is one place that decides where the camera is.
    const M = FEEL.monument;
    this.mon += (this.monTarget - this.mon) * Math.min(1, dt * M.ease);
    if (this.mon < 0.0008) { this.mon = this.monTarget < 0.5 ? 0 : this.mon; return; }

    const t = this.mon * this.mon * (3 - 2 * this.mon);       // smoothstep
    const span = Math.max(this.monTop * M.pad, M.minSpan);
    this.viewH = lerp(this.viewH, span, t);
    // FRAME THE TOWER, NOT THE COLUMN.
    //
    // This used to centre on `COLUMN * 0.5`, which is where the world is, not
    // where the player's tower is. A session that happened to climb up the
    // right-hand side got framed with its own monument off to one side and an
    // empty half-screen beside it — and this is the one image that leaves the
    // phone. `Store.poster` already composes on the bodies' span; the LIVE view,
    // which is what the player actually looks at, did not. Same subject, one
    // rule for framing it.
    //
    // NOT clamped to keep the column inside the frame, which was the first
    // rule written here and was a no-op: `minSpan` 260 against a 9:19.5 screen
    // is a 120 m view of a 100 m column, so the column always fits with room
    // over and the clamp never fired once. The frame already shows ten metres
    // of open background either side and there is no seam out there — the
    // bands and landmarks are drawn across the view, not across the column —
    // so the only rail needed is that the target stays a place in the world.
    const monX = clamp(this.monX, 0, COLUMN);
    this.x = lerp(this.x, monX, t);
    this.y = lerp(this.y, span * M.centre, t);
    this.rot *= 1 - t;
    this.shakeX *= 1 - t;
    this.shakeY *= 1 - t;
  }
}

/** Value noise with smooth interpolation — decaying, never a random jitter. */
/**
 * @param {number} x
 * @returns {number}
 */
function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i), hash1(i + 1), u);
}
/**
 * @param {number} i
 * @returns {number}
 */
function hash1(i) {
  let h = (i | 0) * 374761393;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// -------------------------------------------------------------------- dust

const DUST = 90;

// ----------------------------------------------------------------- renderer

export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('CAIRN: no 2D context for the scene canvas');
    this.ctx = ctx;

    // The camera-to-screen transform, rebuilt by `_setup` every frame. Seeded
    // here because `strictPropertyInitialization` is right to ask: a draw that
    // ran before the first `_setup` would put every coordinate at NaN.
    this.scale = 1;
    this.originX = 0;
    this.originY = 0;
    this.w = 1; this.h = 1; this.dpr = 1;
    this.biome = newBiomeSlot();

    /*
     * PARALLAX BANDS — one silhouette LANGUAGE per biome, not one silhouette.
     *
     * This used to be three jagged polygons generated once from a fixed seed and
     * tiled forever, with only the colour changing by altitude. A player at
     * 11,045 m reported it as "the design between the stages is boring, it
     * repeats" and he was exactly right: the biome cycle is six biomes of 150 m,
     * so at 11 km he had seen the same three shapes in the same six colours
     * TWELVE times. Hue is not variety.
     *
     * Each biome now has its own geometry — spires, blocks, domes, needles,
     * shards, facets — and every layer of every biome has the same POINT COUNT so
     * the crossfade between two biomes can interpolate the silhouettes as well as
     * the colours. Shapes are still generated once at construction; what happens
     * per frame is a lerp into a preallocated scratch array, so the draw loop
     * still allocates nothing.
     */
    this.bands = [];
    for (let l = 0; l < 3; l++) {
      const n = 26 + l * 10;
      /** @type {Float32Array[]} one silhouette per biome, all the same length */
      const shapes = [];
      for (let b = 0; b < BAND_KINDS.length; b++) {
        shapes.push(bandShape(BAND_KINDS[b] ?? 'spire', l, n, makeRng(0x51ce07 + b * 7919 + l)));
      }
      this.bands.push({
        shapes,
        /** filled each frame by lerping two shapes; never reallocated */
        pts: new Float32Array((n + 1) * 2),
        n,
        par: [0.15, 0.35, 0.6][l],
        span: 260 - l * 60,
      });
    }

    // Dust, pooled and wrapped into view rather than respawned. Its own seed:
    // it used to share the bands' generator, so reshaping the bands would have
    // silently moved every dust mote as well.
    const rng = makeRng(0xd057);
    this.dust = new Float32Array(DUST * 5);   // x, y, layer, phase, size
    for (let i = 0; i < DUST; i++) {
      const o = i * 5;
      this.dust[o] = rng() * COLUMN;
      this.dust[o + 1] = rng() * 400;
      this.dust[o + 2] = 0.2 + rng() * 0.8;
      this.dust[o + 3] = rng() * TAU;
      this.dust[o + 4] = 0.25 + rng() * 0.8;
    }

    // Trail ribbon.
    this.trail = new Float32Array(FEEL.juice.trailPoints * 3); // x, y, age
    this.trailN = 0;

    // Impact rings and death particles, both pooled.
    this.rings = new Float32Array(12 * 4);    // x, y, age, force
    this.ringN = 0;
    this.parts = new Float32Array(160 * 7);   // x,y,vx,vy,age,life,seed
    this.partN = 0;

    this._bgKey = -1;
    this._bg = null;
    this._lit = [0, 0, 0];   // scratch: rock tinted by the light on it
    this._markRgb = [0, 0, 0]; // scratch: rock held below the accent, for scenery

    // THE LIVING FIGURE'S STANCE, eased here and nowhere else. Deliberately on
    // the renderer and not on the sim: an animation clock inside the simulation
    // would make two identical drags land differently, which acceptance test 1
    // exists to forbid.
    this.figLean = 0;
    this.figCrouch = 0;
    this.figStretch = 0;
    this.figIdle = 0;
    this.figLook = 0;
    this.figAim = 0;
    // WHICH CLIMBER. One per run, never per jump: a body that changed species
    // between attempts would make silhouette vary for a reason unrelated to
    // whether a corpse still holds weight, which is the read the tower needs.
    this.character = 0;
    this.figT = 0;

    // MOMENTUM, eased, 0-1. The counter itself lives in the sim; this is the
    // only thing the frame is allowed to know about it, and it is deliberately
    // not a number anyone can read off the screen — it widens the light you
    // cast and lengthens the trail behind you, and that is the whole display.
    this.momentum = 0;

    /**
     * Scratch for `landmarksIn`, so the landmark pass allocates nothing.
     * @type {{y: number, x: number, kind: number, phase: number}[]}
     */
    this._marks = [];
  }

  /**
   * @param {number} w CSS px
   * @param {number} h CSS px
   * @param {number} dpr
   */
  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this._bgKey = -1;
  }

  // ------------------------------------------------------------ world → px

  /** @param {Camera} cam */
  _setup(cam) {
    const ctx = this.ctx;
    const scale = (this.h / cam.viewH);
    this.scale = scale;
    cam.aspect = this.w / this.h;
    this.originX = this.w * 0.5 - cam.x * scale + cam.shakeX * scale;
    this.originY = this.h * (0.5 - FEEL.camera.playerOffsetY) + cam.y * scale + cam.shakeY * scale;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (cam.rot !== 0) {
      ctx.translate(this.w * 0.5, this.h * 0.5);
      ctx.rotate(cam.rot * Math.PI / 180);
      ctx.translate(-this.w * 0.5, -this.h * 0.5);
    }
  }

  /** @param {number} wx */
  X(wx) { return this.originX + wx * this.scale; }
  /** @param {number} wy */
  Y(wy) { return this.originY - wy * this.scale; }

  // -------------------------------------------------------------- emitters

  /**
   * @param {number} x
   * @param {number} y
   */
  pushTrail(x, y) {
    const T = FEEL.juice.trailPoints;
    for (let i = Math.min(this.trailN, T - 1); i > 0; i--) {
      this.trail[i * 3] = this.trail[(i - 1) * 3];
      this.trail[i * 3 + 1] = this.trail[(i - 1) * 3 + 1];
      this.trail[i * 3 + 2] = this.trail[(i - 1) * 3 + 2];
    }
    this.trail[0] = x; this.trail[1] = y; this.trail[2] = 0;
    this.trailN = Math.min(this.trailN + 1, T);
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {number} force
   */
  ring(x, y, force) {
    const i = this.ringN < 12 ? this.ringN++ : 0;
    const o = i * 4;
    this.rings[o] = x; this.rings[o + 1] = y; this.rings[o + 2] = 0; this.rings[o + 3] = force;
  }

  /**
   * Death reads as crystallisation, not detonation: the shards burst outward,
   * stall, and are drawn back INTO the body as it solidifies. `life` runs 0→1
   * and the motion reverses at 0.45.
   */
  /**
   * @param {number} x
   * @param {number} y
   * @param {number} n
   */
  burst(x, y, n) {
    for (let k = 0; k < n && this.partN < 160; k++) {
      const o = this.partN++ * 7;
      const a = (k / n) * TAU + Math.random() * 0.4;
      const sp = 18 + Math.random() * 34;
      this.parts[o] = x; this.parts[o + 1] = y;
      this.parts[o + 2] = Math.cos(a) * sp;
      this.parts[o + 3] = Math.sin(a) * sp;
      this.parts[o + 4] = 0;
      this.parts[o + 5] = 0.55 + Math.random() * 0.35;
      this.parts[o + 6] = Math.random();
    }
  }

  /**
   * @param {number} dt
   * @param {number} [momentum] 0-1 target; eased here so a reset fades rather
   *   than snaps, and so a rebuilt streak arrives as a swell.
   */
  step(dt, momentum = 0) {
    this.momentum += (momentum - this.momentum)
      * Math.min(1, dt * FEEL.momentum.ease);
    for (let i = 0; i < this.trailN; i++) this.trail[i * 3 + 2] += dt;
    for (let i = this.ringN - 1; i >= 0; i--) {
      const o = i * 4;
      this.rings[o + 2] += dt;
      if (this.rings[o + 2] > FEEL.juice.ringMs / 1000) {
        const l = --this.ringN * 4;
        for (let k = 0; k < 4; k++) this.rings[o + k] = this.rings[l + k];
      }
    }
    for (let i = this.partN - 1; i >= 0; i--) {
      const o = i * 7;
      const t = (this.parts[o + 4] += dt) / this.parts[o + 5];
      if (t >= 1) {
        const l = --this.partN * 7;
        for (let k = 0; k < 7; k++) this.parts[o + k] = this.parts[l + k];
        continue;
      }
      // Outward, then pulled home.
      const pull = t < 0.45 ? 1 : -2.4 * (t - 0.45);
      this.parts[o] += this.parts[o + 2] * dt * pull;
      this.parts[o + 1] += this.parts[o + 3] * dt * pull;
    }
  }

  // ------------------------------------------------------------------ draw

  /**
   * @param {Sim} sim
   * @param {Camera} cam
   * @param {Input|null} input
   * @param {UiState} ui
   * @param {number} dt
   * @param {boolean} reduced
   * @returns {BiomeSlot}
   */
  draw(sim, cam, input, ui, dt, reduced) {
    const ctx = this.ctx;
    const B = biomeAt(Math.max(0, sim.body.y), this.biome);
    this._setup(cam);

    this._background(ctx, B, cam);

    // MONUMENT VIEW IS A PORTRAIT, NOT A PLACE.
    //
    // Parallax ridges, light shafts, drifting dust and the enormous background
    // height all exist to give the PLAYING camera depth, and all of them are
    // sized against the view span — so at full pull-back they stop being
    // atmosphere and become clutter drawn straight across the monument. They
    // fade out with the pull-back rather than cutting, so the move still reads
    // as one gesture.
    const depth = 1 - (cam.mon || 0);
    if (depth > 0.01) {
      ctx.globalAlpha = depth;
      // The facade replaces the parallax ridges. `_bands` drew layered spike
      // silhouettes that made the world a cave, which is both the most-made
      // background in the genre and the opposite of the reference this was
      // pointed at — an enormous building against an empty sky.
      this._facade(ctx, B, cam, sim);
      // THE GIANT ALTITUDE NUMERAL IS GONE.
      //
      // It was the largest graphic element on screen, it duplicated the small
      // readable counter forty pixels above it, and it collided with whatever
      // else was in the upper half — landmark lattice, light shafts, facade —
      // to make the top of the frame unreadable. An independent art review and
      // my own screen-by-screen pass reached that separately, which is the
      // strongest signal either of them produced. Deleted rather than dimmed:
      // there is one tower in this game and it is made of bodies, and nothing
      // else in the frame gets to be the biggest thing in it.
      if (!reduced) this._shafts(ctx, B, cam);
      this._dust(ctx, B, cam, dt);
      ctx.globalAlpha = 1;
    }

    // Behind the ledges, in front of the parallax. Unheld ones fade out with
    // the monument pull-back like the rest of the atmosphere — at full zoom the
    // tower is a portrait of the bodies in it and a skyline across that is
    // clutter. A HELD one stays, because it is not scenery: it is something the
    // player did that almost nobody knows is possible, and this is the image
    // they share. `_landmarks` decides per structure; `depth` goes in as a
    // parameter rather than as a globalAlpha wrapped round the whole pass.
    this._landmarks(ctx, B, cam, sim, depth);

    this._threads(ctx, B, sim);
    this._updrafts(ctx, B, sim);
    this._solids(ctx, B, sim, cam);
    // VOID's darkness falls on the WORLD, not on the player. It is drawn after
    // the geometry and before the body, the trail and the aim arc, so what it
    // takes away is knowledge of where the next ledge is — never the ability to
    // read your own launch. A biome that hides the controls is not a biome, it
    // is a bug with a name.
    if (depth > 0.01) this._dark(ctx, B, sim, depth);
    this._rings(ctx, B);
    this._parts(ctx, B);
    this._trail(ctx, B);
    this._ghostRun(ctx, B, sim, ui, dt);
    this._player(ctx, B, sim, ui, input, dt);
    if (input && input.aiming) this._aim(ctx, B, input, sim);
    this._bestLine(ctx, B, sim);

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    return B;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Camera} _cam unused; kept so every layer has one call shape
   */
  _background(ctx, B, _cam) {
    // Never flat: a vertical gradient, rebuilt only when the biome moves enough
    // to be visible, which is a handful of times per climb.
    const key = Math.round(B.index * 100 + B.blend * 60);
    if (key !== this._bgKey) {
      this._bgKey = key;
      const g = ctx.createLinearGradient(0, 0, 0, this.h);
      g.addColorStop(0, rgb(B.bgTop, 1));
      g.addColorStop(1, rgb(B.bgBot, 1));
      this._bg = g;
    }
    if (this._bg) ctx.fillStyle = this._bg;
    ctx.fillRect(-40, -40, this.w + 80, this.h + 80);
  }

  /**
   * The height, enormous and almost invisible, behind the play. It is the only
   * number in the game that is allowed to be large, and it sits at 8% opacity
   * so it reads as an atmosphere rather than as a readout.
   */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {number} y
   */
  _bigNumber(ctx, B, y) {
    const n = Math.round(y);
    const scale = 1 + (n % 10) * 0.002;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `200 ${Math.round(this.h * 0.26 * scale)}px ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
    ctx.fillStyle = rgb(B.rock, 0.055);
    ctx.fillText(String(n), this.w * 0.5, this.h * 0.34);
    ctx.restore();
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Camera} cam
   */
  /**
   * THE TOWER YOU ARE ACTUALLY CLIMBING.
   *
   * THE OLD BACKGROUND WAS THE PROBLEM. Layered spike ridges, a giant altitude
   * numeral and drifting dust made a CAVE, and a cave of coloured triangles is
   * the most-made background in indie games — the owner's note, twice, was that
   * the game looks generic, and this was most of the reason. Worse, it was
   * exactly inverted from the reference they gave: a photograph of the Burj
   * Khalifa, where the SKY IS EMPTY and the BUILDING IS ENORMOUS. Ours was a
   * busy background around a small tower.
   *
   * So: empty sky, one huge facade running off the top and bottom of the frame,
   * and a window grid on it. You are climbing the OUTSIDE of a building, and the
   * building is bigger than the screen in every direction.
   *
   * THE PART THAT IS OURS AND NOBODY ELSE'S: the glass reflects the player.
   * This game's whole art direction is a dark world with a single living light
   * in it, and a mirrored facade is the one surface that can answer that light.
   * A pane near the climber picks up their glow and holds it a moment; the
   * reflection climbs with you. It is not an effect borrowed from another game —
   * it falls out of the mechanic this game already has, which is the only kind
   * of visual idea that cannot be copied off us without copying the design.
   *
   * All of it is a handful of rects and one gradient per frame. No assets, no
   * per-window state, nothing retained: window lights are a hash of their own
   * grid coordinates, so a pane is lit or dark deterministically and the same
   * floor looks the same every time you pass it.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Camera} cam
   * @param {Sim} sim
   */
  _facade(ctx, B, cam, sim) {
    const F = FEEL.facade;
    const sc = this.scale;
    const b = sim.body;
    const px = this.X(b.rx ?? b.x), py = this.Y(b.ry ?? b.y);

    // The face of the building, wider than the play column and running past
    // both edges of the frame, so it never reads as an object floating in space.
    const left = this.X(COLUMN * 0.5 - F.halfW);
    const right = this.X(COLUMN * 0.5 + F.halfW);
    const g = ctx.createLinearGradient(left, 0, right, 0);
    g.addColorStop(0, rgb(B.bgTop, 0.0));
    g.addColorStop(0.16, rgb(B.rock, F.faceAlpha * 0.55));
    g.addColorStop(0.5, rgb(B.rock, F.faceAlpha));
    g.addColorStop(0.84, rgb(B.rock, F.faceAlpha * 0.55));
    g.addColorStop(1, rgb(B.bgTop, 0.0));
    ctx.fillStyle = g;
    ctx.fillRect(left, 0, right - left, this.h);

    // MULLIONS AND FLOOR SLABS — the grid that says "building" rather than
    // "wall". Spaced in world units so they scale with the zoom and never
    // shimmer, and clipped to whole lines on screen so there is no moire.
    const fh = F.floorU * sc;                 // floor height in px
    if (fh < 3) return;                       // pulled too far back to resolve
    const y0 = this.Y(Math.ceil((cam.y + cam.viewH) / F.floorU) * F.floorU);
    const cw = F.colU * sc;
    ctx.lineWidth = Math.max(1, F.lineU * sc);

    // Reflection falls off with distance from the climber, and the falloff is
    // generous: the point is that you can see your own light travelling over
    // the glass, not that one pane lights up.
    //
    // Compared SQUARED, and rows outside the reflection band skip the test
    // entirely. A Math.hypot per pane over a nine-hundred-pane cap put
    // acceptance test 4 from 1.92 to 5.24 ms a frame on this software
    // rasteriser — the facade is background, and background does not get to be
    // the most expensive thing in the frame.
    const R = F.reflectU * sc;
    const R2 = R * R;

    ctx.strokeStyle = rgb(B.rock, F.gridAlpha);
    ctx.beginPath();
    for (let y = y0; y < this.h + fh; y += fh) {
      ctx.moveTo(left, y); ctx.lineTo(right, y);
    }
    for (let x = left; x <= right + cw; x += cw) {
      ctx.moveTo(x, 0); ctx.lineTo(x, this.h);
    }
    ctx.stroke();

    // THE PANES. Lit windows are a hash of the grid cell, so the same floor is
    // the same every time; the reflection is added on top of whatever the pane
    // already is.
    const col0 = Math.floor(left / cw);
    const rowBase = Math.floor((cam.y + cam.viewH) / F.floorU);
    // THE PANES. A UNIFORM GRID READS AS A WAFFLE, NOT AS A BUILDING.
    //
    // The first version lit a fixed fraction of identical windows and the result
    // was a regular pattern filling the frame — texture, not architecture. Real
    // towers have whole dark storeys, service floors of narrow slits, and
    // stretches where every light is on. Three hashes per floor give that: one
    // decides the storey's character, one its overall brightness, one the
    // individual pane. All deterministic from the grid coordinate, so a floor
    // looks the same every time you pass it and nothing is retained.
    ctx.globalCompositeOperation = 'lighter';
    let r = 0;
    for (let y = y0, ry = rowBase; y < this.h + fh; y += fh, ry--) {
      const fk = hash1(ry * 374761393);
      const dark = fk < F.darkFloorFrac;           // a whole storey unlit
      const service = !dark && fk > 1 - F.serviceFrac;
      const floorLit = dark ? 0 : (0.35 + hash1(ry * 668265263) * 1.5);
      // Service floors are a band of narrow slits: the vertical rhythm changes,
      // which is what stops a tall facade reading as one repeating tile.
      const iw = service ? cw * 0.20 : cw * 0.68;
      const ih = service ? fh * 0.22 : fh * 0.60;
      const iy = service ? fh * 0.40 : fh * 0.20;
      const step = service ? cw * 0.5 : cw;
      const wy = y + fh * 0.5;
      const dy = wy - py, dy2 = dy * dy;
      const rowLit = dy2 < R2;               // can this row reflect at all?
      for (let x = left, cxi = col0; x <= right; x += step, cxi++) {
        const h1 = hash1((ry * 73856093) ^ (cxi * 19349663));
        const on = h1 < F.litFrac * floorLit ? F.litA * (0.55 + h1 * 3) : 0;
        let refl = 0;
        if (rowLit) {
          const dx = x + step * 0.5 - px;
          const d2 = dx * dx + dy2;
          if (d2 < R2) { const k = 1 - Math.sqrt(d2) / R; refl = k * k * F.reflectA; }
        }
        const a = on + refl;
        if (a < 0.012) continue;
        ctx.fillStyle = rgb(B.accent, Math.min(0.72, a));
        ctx.fillRect(x + (step - iw) * 0.5, y + iy, iw, ih);
        if (++r > F.maxPanes) { y = this.h + fh; break; }
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  _bands(ctx, B, cam) {
    // Silhouetted geometry, never empty, never contrasty. Each band repeats
    // vertically so the tower has depth at any height.
    //
    // TWO THINGS STOP IT REPEATING. The silhouette is the current biome's, blended
    // into the next one exactly as the colours blend — so a biome boundary is a
    // change of geometry and not only of hue. And the SCALE of that geometry
    // drifts continuously with altitude on two frequencies that do not divide
    // into each other, so the combination of colour, shape and scale has no short
    // period. Twelve passes through six biomes used to be twelve identical
    // pictures; it now takes kilometres before anything looks like itself again.
    const kinds = this.bands[0] ? this.bands[0].shapes.length : 1;
    const i0 = ((B.index % kinds) + kinds) % kinds;
    const i1 = (i0 + 1) % kinds;
    const blend = B.blend;
    const drift = 1
      + 0.42 * Math.sin(cam.y * 0.00055)
      + 0.20 * Math.sin(cam.y * 0.00017 + 1.7);

    for (let l = 0; l < this.bands.length; l++) {
      const band = this.bands[l];
      const par = band.par;
      const a = 0.11 + l * 0.075;
      const spanPx = band.span * drift * this.scale;

      // Lerp the two silhouettes into the scratch array. No allocation.
      const from = band.shapes[i0], to = band.shapes[i1], pts = band.pts;
      for (let i = 0; i < pts.length; i += 2) {
        pts[i] = from[i] ?? 0;
        pts[i + 1] = (from[i + 1] ?? 0) + ((to[i + 1] ?? 0) - (from[i + 1] ?? 0)) * blend;
      }
      const off = ((cam.y * par * this.scale) % spanPx + spanPx) % spanPx;
      for (let rep = -1; rep <= Math.ceil(this.h / spanPx) + 1; rep++) {
        const baseY = this.h - off + rep * spanPx;
        const foot = baseY + spanPx * 1.1;
        // Opacity lives in the jagged tips; the body of the band is nearly
        // empty. Filling the whole polygon evenly stacked three layers and
        // several repeats into a milky haze over the lower half of the frame.
        const g = ctx.createLinearGradient(0, baseY - spanPx * 0.46, 0, baseY + spanPx * 0.22);
        g.addColorStop(0, rgb(B.rock, a));
        g.addColorStop(0.55, rgb(B.rock, a * 0.34));
        g.addColorStop(1, rgb(B.rock, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(-20, foot);
        for (let i = 0; i < pts.length; i += 2) {
          ctx.lineTo(-20 + pts[i] * (this.w + 40), baseY - pts[i + 1] * spanPx);
        }
        ctx.lineTo(this.w + 20, foot);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Camera} cam
   */
  _shafts(ctx, B, cam) {
    // Volumetric light from above, drifting. Intensity is a biome property.
    const n = 3;
    for (let i = 0; i < n; i++) {
      const t = cam.t * 0.045 + i * 2.1;
      const cx = this.w * (0.2 + 0.3 * i) + Math.sin(t) * this.w * 0.16;
      const wide = this.w * (0.18 + 0.08 * Math.sin(t * 0.7 + i));
      const g = ctx.createLinearGradient(cx, -this.h * 0.1, cx + wide * 0.4, this.h);
      g.addColorStop(0, rgb(B.accent, B.shaft * 0.20));
      g.addColorStop(0.55, rgb(B.accent, B.shaft * 0.05));
      g.addColorStop(1, rgb(B.accent, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx - wide * 0.35, -20);
      ctx.lineTo(cx + wide * 0.35, -20);
      ctx.lineTo(cx + wide, this.h + 20);
      ctx.lineTo(cx + wide * 0.28, this.h + 20);
      ctx.closePath();
      ctx.fill();
    }
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Camera} cam
   * @param {number} dt
   */
  _dust(ctx, B, cam, dt) {
    const top = cam.y + cam.viewH * 0.7;
    const bot = cam.y - cam.viewH * 0.7;
    for (let i = 0; i < DUST; i++) {
      const o = i * 5;
      const layer = this.dust[o + 2];
      this.dust[o + 3] += dt * (0.4 + layer);
      const drift = Math.sin(this.dust[o + 3]) * 0.06;
      this.dust[o] += drift;
      this.dust[o + 1] += dt * (1.6 + layer * 3.2);

      const wy = this.dust[o + 1];
      const span = cam.viewH * 1.4;
      // Parallax by layer, then wrap into view.
      const py = bot + (((wy - bot * layer) % span) + span) % span;
      if (wy > top + span) this.dust[o + 1] = bot;

      const px = this.X(this.dust[o]);
      const py2 = this.Y(py);
      if (py2 < -20 || py2 > this.h + 20) continue;
      ctx.fillStyle = rgb(B.accent, 0.06 + layer * 0.10);
      const r = this.dust[o + 4] * layer * this.dpr * 0.9;
      ctx.fillRect(px, py2, r, r);
    }
  }

  /**
   * THE TOWER'S NOUNS.
   *
   * One structure per biome, drawn behind the ledges and in front of the
   * parallax bands, in world units so it zooms with everything else. It has no
   * collision, the generator does not know it exists, and nothing about a route
   * changes because one is here — see `landmarkOf` for why that is the whole
   * safety argument rather than an implementation detail.
   *
   * Six shapes, one per biome, each a silhouette that says what this place is
   * in the time it takes to look at it: a collapsed stair, a lattice mast, a
   * root system, a hanging chain, a furnace mouth, a frozen fall. They are
   * drawn as strokes rather than fills, because a filled mass at this size
   * competes with the ledges for the eye and the ledges have to win.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {{y: number, viewH: number}} cam
   * @param {Sim} sim
   * @param {number} depth 1 while playing, 0 at full monument pull-back
   */
  _landmarks(ctx, B, cam, sim, depth = 1) {
    const L = FEEL.landmark;
    const lo = cam.y - cam.viewH, hi = cam.y + cam.viewH;
    landmarksIn(lo, hi, sim.world.seed, this._marks);
    if (!this._marks.length) return;

    // THE SCENERY IS NEVER BRIGHTER THAN THE HOLDS.
    //
    // Landmarks stroke in `B.rock` and ledges crest in `B.accent`, and the
    // comment above promises "the ledges have to win". In four biomes they do.
    // In ASH they do not: rock is warm bone at luminance 196.6 against an ember
    // accent at 144.8, so the scenery is drawn in the BRIGHTEST colour in the
    // palette and the things you can stand on in a dimmer one. GLACIER sits on
    // the line at 0.99. ASH is the opening biome — 0 to 150 m, the first thing
    // every new player ever sees — so the one frame where the rule matters most
    // is the one frame where it was inverted, and a pale diagonal beam across
    // the play area is exactly the shape of something you would try to land on.
    //
    // Clamped here rather than by editing the palette, because `B` is blended
    // per frame between two biomes and the rule has to hold on the blend too.
    // Four of six biomes are untouched by it.
    const rockLum = lumOf(B.rock), accLum = lumOf(B.accent);
    let mark = B.rock;
    if (rockLum > accLum && rockLum > 1) {
      const k = accLum / rockLum;
      this._markRgb[0] = B.rock[0] * k;
      this._markRgb[1] = B.rock[1] * k;
      this._markRgb[2] = B.rock[2] * k;
      mark = this._markRgb;
    }

    const sc = this.scale;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < this._marks.length; i++) {
      const m = this._marks[i];
      // Fade with distance so a landmark ARRIVES rather than popping in at the
      // edge of the view, and so two of them never fight at a biome border.
      const d = Math.abs(m.y - cam.y);
      const fade = clamp(1 - (d - L.spanU * 0.5) / L.fadeU, 0, 1);
      // ... and recedes again once you are inside it. Full strength at the
      // centre put the scenery on top of the corpses at exactly the distance
      // where reading their erosion stage matters most.
      const inside = clamp(1 - d / (L.spanU * 0.5), 0, 1);
      const near = fade * (1 - inside * L.insideFade);
      if (near <= 0.02) continue;
      // A HELD LANDMARK ANSWERS. One of your bodies is inside it, so it stops
      // being rock the colour of rock and takes the living accent, brighter,
      // with a light at its heart. Six of them exist and nothing anywhere says
      // so — see FEEL.landmark.heartU.
      const band = Math.floor(m.y / BIOME_SPAN);
      // Held, OR the aim is currently pointed at its heart — in which case it
      // answers as though already held, for as long as the thumb stays there.
      // The structure IS the reply; nothing is written. See DECISIONS §31.
      const held = sim.claimed.has(band) || sim.predictPeak.heart === band;
      // Unheld: gone by full pull-back. Held: never below `monHeld`.
      const mon = held ? Math.max(depth, L.monHeld) : depth;
      if (mon <= 0.01) continue;
      ctx.globalAlpha = (held ? L.claimAlpha : L.alpha) * near * mon;
      ctx.strokeStyle = rgb(held ? B.accent : mark, 1);
      ctx.lineWidth = Math.max(1, L.lineU * sc * (held ? 1.25 : 1));
      ctx.save();
      ctx.translate(this.X(m.x), this.Y(m.y));
      if (held) {
        const r = L.claimLightU * sc;
        const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
        g.addColorStop(0, rgb(B.accent, 0.30 * near * mon));
        g.addColorStop(1, rgb(B.accent, 0));
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(-r, -r, r * 2, r * 2);
        ctx.restore();
      }
      this._landmarkPath(ctx, m, L.widthU * sc, L.spanU * sc, B);
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /**
   * One shape, centred on the origin, `w` by `h` in device pixels. Everything
   * here is a stroked path and a handful of trig — no gradients, no per-element
   * fills, no allocation — because this draws every frame underneath a scene
   * that already has a frame budget.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {{kind: number, phase: number}} m
   * @param {number} w
   * @param {number} h
   * @param {BiomeSlot} B
   */
  _landmarkPath(ctx, m, w, h, B) {
    const n = FEEL.landmark.detail;
    const hw = w * 0.5, hh = h * 0.5;
    const ph = m.phase;

    switch (m.kind) {
      // ASH — A COLLAPSED STAIR. It went somewhere once.
      //
      // The first draft drew treads as detached L-brackets scattered along a
      // diagonal and it read as debris, not as a stair. A stair is legible only
      // as ONE CONTINUOUS ZIGZAG — riser, tread, riser, tread — so this walks a
      // single polyline up and to the right, and the collapse is a real break
      // in that line with the upper flight offset sideways from the lower one.
      // The gap is the thing worth drawing; it needs the intact run either side
      // of it to be a gap at all.
      case 0: {
        const steps = n + 3;
        const gone = 2 + ((ph * 3) | 0);           // which step the flight fails at
        const rise = h / steps, run = w * 0.66 / steps;
        /**
         * @param {number} from @param {number} to
         * @param {number} x0 @param {number} y0
         */
        const flight = (from, to, x0, y0) => {
          ctx.beginPath();
          let x = x0, y = y0;
          ctx.moveTo(x, y);
          for (let i = from; i < to; i++) {
            y -= rise;  ctx.lineTo(x, y);          // riser
            x += run;   ctx.lineTo(x, y);          // tread
          }
          ctx.stroke();
          return { x, y };
        };
        const lower = flight(0, gone, -hw * 0.72, hh);
        // The upper flight survived, out of line with what used to carry it.
        const upX = lower.x + run * 2.6, upY = lower.y - rise * 2.2;
        flight(gone + 1, steps, upX, upY);
        // The stringer that used to run under the whole thing, snapped.
        ctx.beginPath();
        ctx.moveTo(-hw * 0.72, hh);
        ctx.lineTo(lower.x, lower.y + rise * 0.9);
        ctx.moveTo(upX, upY + rise * 0.9);
        ctx.lineTo(upX + run * (steps - gone), upY - rise * (steps - gone) + rise);
        ctx.stroke();
        break;
      }

      // SIGNAL — A LATTICE MAST, still lit.
      case 1: {
        /** @param {number} t */
        const taper = (t) => hw * 0.30 * (1 - t * 0.72);
        ctx.beginPath();
        ctx.moveTo(-taper(0), hh); ctx.lineTo(-taper(1), -hh);
        ctx.moveTo(taper(0), hh); ctx.lineTo(taper(1), -hh);
        for (let i = 0; i <= n; i++) {
          const t = i / n, y = hh - t * h, a = taper(t);
          ctx.moveTo(-a, y); ctx.lineTo(a, y);
          if (i < n) {
            const t2 = (i + 1) / n, y2 = hh - t2 * h, a2 = taper(t2);
            ctx.moveTo(-a, y); ctx.lineTo(a2, y2);
          }
        }
        // Guy-wires to the ground, which is what makes it read as a mast and
        // not as a ladder.
        ctx.moveTo(-taper(0.72), hh - h * 0.72); ctx.lineTo(-hw, hh);
        ctx.moveTo(taper(0.72), hh - h * 0.72); ctx.lineTo(hw, hh);
        ctx.stroke();
        // The lamp. The one filled thing in any of these shapes, because a
        // light at the top of a mast is the whole reason a mast is drawn.
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgb(B.accent, 0.5);
        ctx.beginPath();
        ctx.arc(0, -hh, Math.max(1.5, w * 0.018), 0, TAU);
        ctx.fill();
        ctx.restore();
        break;
      }

      // BLOOM — A ROOT SYSTEM. It has to come FROM somewhere.
      //
      // The first draft drew parallel strands from edge to edge and they read as
      // cables. Roots read as roots when they converge to a single mass at the
      // top and divide on the way down, so this draws a trunk, splits it, and
      // splits the splits.
      case 2: {
        ctx.beginPath();
        ctx.moveTo(0, -hh);
        ctx.lineTo(0, -hh + h * 0.18);
        const forks = Math.max(3, (n / 2) | 0);
        for (let i = 0; i < forks; i++) {
          const t = forks === 1 ? 0.5 : i / (forks - 1);
          const spread = (t - 0.5) * w * 0.92;
          const wob = Math.sin((t + ph) * 7.0) * w * 0.07;
          // trunk -> primary
          ctx.moveTo(0, -hh + h * 0.18);
          ctx.bezierCurveTo(spread * 0.25 + wob, -hh + h * 0.42,
                            spread * 0.80 - wob, hh - h * 0.30,
                            spread, hh);
          // primary -> a fine root that leaves it half way down
          const bx = spread * 0.62, by = hh - h * 0.46;
          ctx.moveTo(bx, by);
          ctx.quadraticCurveTo(bx + wob * 1.6, by + h * 0.20,
                               bx + (t < 0.5 ? -1 : 1) * w * 0.14, hh - h * 0.06);
        }
        ctx.stroke();
        break;
      }

      // VOID — A CHAIN, and whatever it is holding is out of sight.
      case 3: {
        const link = h / (n * 2);
        ctx.beginPath();
        for (let i = 0; i < n * 2; i++) {
          const y = -hh + i * link;
          const sway = Math.sin((i * 0.5 + ph * 6)) * w * 0.05;
          ctx.ellipse(sway, y + link * 0.5, w * 0.045, link * 0.52,
                      0, 0, TAU);
        }
        ctx.stroke();
        // The ring it ends in.
        ctx.beginPath();
        ctx.arc(Math.sin((n + ph * 6)) * w * 0.05, hh, w * 0.10, 0, TAU);
        ctx.stroke();
        break;
      }

      // CINDER — A FURNACE MOUTH.
      case 4: {
        ctx.beginPath();
        ctx.moveTo(-hw * 0.8, hh);
        ctx.lineTo(-hw * 0.8, hh - h * 0.28);
        ctx.quadraticCurveTo(0, -hh, hw * 0.8, hh - h * 0.28);
        ctx.lineTo(hw * 0.8, hh);
        ctx.stroke();
        // Courses of brick, kept strictly INSIDE the arch so they read as
        // masonry rather than as scanlines laid across the screen — which is
        // exactly how they read while the shape was wider than the glass.
        ctx.beginPath();
        for (let i = 1; i < n; i++) {
          const t = i / n;
          const y = hh - t * h * 0.72;
          const spanX = hw * 0.78 * Math.sqrt(Math.max(0, 1 - t * t * 0.94));
          if (spanX < w * 0.04) continue;
          ctx.moveTo(-spanX, y); ctx.lineTo(spanX, y);
          // A perpend every other course, so the courses are bricks and not
          // stripes.
          if (i % 2 === 0) {
            const px2 = spanX * 0.45;
            ctx.moveTo(-px2, y); ctx.lineTo(-px2, y + h * 0.72 / n);
            ctx.moveTo(px2, y); ctx.lineTo(px2, y + h * 0.72 / n);
          }
        }
        ctx.stroke();
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgb(B.accent, 0.16);
        ctx.beginPath();
        ctx.moveTo(-hw * 0.62, hh);
        ctx.quadraticCurveTo(0, -hh * 0.55, hw * 0.62, hh);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;
      }

      // GLACIER — A FROZEN FALL, mid-pour.
      //
      // Stroked lines of constant weight read as pipes. Ice reads as ice when it
      // TAPERS, so each column is a filled triangle from the lip down to a
      // point, with the strokes kept only for the lip it poured over.
      default: {
        ctx.save();
        ctx.fillStyle = ctx.strokeStyle;
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          const x = (t - 0.5) * w * 0.92;
          const len = h * (0.35 + 0.65 * Math.abs(Math.sin((t + ph) * 5.1)));
          const halfW = w * 0.030 * (0.5 + Math.abs(Math.sin((t + ph * 2) * 3.3)));
          const lean = Math.sin((t + ph) * 3.0) * w * 0.02;
          ctx.beginPath();
          ctx.moveTo(x - halfW, -hh);
          ctx.lineTo(x + halfW, -hh);
          ctx.lineTo(x + lean, -hh + len);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
        // The lip it poured over, and the shelf behind it.
        ctx.beginPath();
        ctx.moveTo(-hw * 0.98, -hh);
        ctx.lineTo(hw * 0.98, -hh);
        ctx.moveTo(-hw * 0.72, -hh - h * 0.06);
        ctx.lineTo(hw * 0.72, -hh - h * 0.06);
        ctx.stroke();
        break;
      }
    }
  }

  /**
   * The thread of light joining each corpse to the next in death order. It is
   * what makes a hundred separate failures read as one continuous history, and
   * it fades in as the camera pulls back so it never competes with the jump you
   * are about to make.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} _B unused; the thread is always memory-gold
   * @param {Sim} sim
   */
  _threads(ctx, _B, sim) {
    const solids = sim.world.solids;
    const strength = clamp((this.scale > 0 ? 1 : 0) * (1 - (FEEL.camera.viewH / (this.h / this.scale))), 0, 1);
    const a = 0.05 + strength * 0.12;
    if (a <= 0.01) return;
    ctx.strokeStyle = rgb(MEMORY_GOLD, a);
    ctx.lineWidth = 1;
    ctx.beginPath();
    let prev = null;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!s.corpse) continue;
      const x = this.X(s.x), y = this.Y(s.y);
      if (y < -80 || y > this.h + 80) { prev = s; continue; }
      if (prev && prev.corpse) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      prev = s;
    }
    ctx.stroke();
  }

  /**
   * Ledges and corpses. Brightness is a function of distance to the player —
   * the lighting pass — so the single living light in the scene is you, and
   * geometry emerges from the dark as you approach it.
   */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Sim} sim
   * @param {Camera} _cam unused; culling is done against `this.h`
   */
  _solids(ctx, B, sim, _cam) {
    const solids = sim.world.solids;
    const bx = sim.body.rx ?? sim.body.x;
    const by = sim.body.ry ?? sim.body.y;
    const total = Math.max(1, sim.world.corpseCount);
    const reach = 78;

    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      const sy = this.Y(s.y);
      if (sy < -120 || sy > this.h + 120) continue;       // frustum cull
      const sx = this.X(s.x);
      const d = Math.hypot(s.x - bx, s.y - by);
      const lit = clamp(1 - d / reach, 0, 1);

      // A crumbling hold whose clock has started. 0 until the warning window,
      // then a flicker that quickens. Time is encoded in BRIGHTNESS, because
      // width is reserved for saying what the collision is.
      let urgent = 0;
      if (s.crumble && s.crumbleAt > 0) {
        const left = (s.crumbleAt - sim.verbTime) * 1000;
        const warn = FEEL.verbs.crumbleWarnMs;
        if (left < warn) {
          const k = clamp(1 - left / warn, 0, 1);
          urgent = k * (0.55 + 0.45 * Math.sin(sim.verbTime * (14 + k * 40)));
        }
      }

      if (!s.corpse && s.hw <= 0 && s.baseHw > 0) {
        // A hold that has already given way. It is drawn, and it is not a
        // platform — the same sentence MEMORY says about an old corpse, in the
        // same visual language: an outline with nothing inside it. Without this
        // a crumbling ledge does not give way, it teleports out of the world,
        // and the player learns nothing from having stood on one.
        const w = s.baseHw * 2 * this.scale;
        const top = sy - s.hh * this.scale;
        ctx.strokeStyle = rgb(B.rock, 0.10 + lit * 0.10);
        ctx.lineWidth = Math.max(0.7, this.dpr * 0.7);
        ctx.setLineDash([3 * this.dpr, 4 * this.dpr]);
        ctx.strokeRect(sx - w * 0.5, top, w, s.hh * 2 * this.scale);
        ctx.setLineDash([]);
        continue;
      }

      if (!s.corpse) {
        // Rock, pulled toward the accent by how lit it is. Geometry in this
        // game is never its own colour in isolation — it is always somewhere
        // between the rock hue and the light falling on it, which is what keeps
        // it off neutral.
        const rr = lerp(B.rock[0], B.accent[0], lit * 0.30);
        const rg = lerp(B.rock[1], B.accent[1], lit * 0.30);
        const rb = lerp(B.rock[2], B.accent[2], lit * 0.30);
        this._lit[0] = rr; this._lit[1] = rg; this._lit[2] = rb;
        const w = s.hw * 2 * this.scale;
        const h = s.hh * 2 * this.scale;
        const top = sy - s.hh * this.scale;
        // Body: a dark slab that never reaches flat — a vertical gradient from
        // the lit crest down into the background colour.
        const skirt = h * 1.35;
        const g = ctx.createLinearGradient(0, top, 0, top + skirt);
        g.addColorStop(0, rgb(this._lit, 0.22 + lit * 0.36));
        g.addColorStop(0.35, rgb(this._lit, 0.07 + lit * 0.11));
        g.addColorStop(1, rgb(this._lit, 0));
        ctx.fillStyle = g;
        ctx.fillRect(sx - w * 0.5, top, w, skirt);
        // Crest: the lit edge, and the only thing you actually aim at.
        ctx.fillStyle = rgb(B.accent, 0.16 + lit * 0.70);
        ctx.fillRect(sx - w * 0.5, top, w, Math.max(1, 1.5 * this.dpr));
        // A short bloom-catching bar on the crest, so the landing line reads
        // even when the player's light is nowhere near it.
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = rgb(B.accent, 0.05 + lit * 0.22 + urgent * 0.55);
        ctx.fillRect(sx - w * 0.5, top - 1.5 * this.dpr, w, 3 * this.dpr);
        ctx.globalCompositeOperation = 'source-over';

        if (s.crumble) {
          // ASH: this one gives way.
          //
          // THE FIRST VERSION OF THIS DREW BLACK CRACKS ACROSS THE SLAB, AND
          // THE SLAB IS ALREADY BLACK. A screenshot settled it in one look: the
          // only part of a ledge you can actually see is the lit crest, so the
          // tell has to live there. Broken teeth hanging off the crest, in the
          // accent, which is the one colour that reads against this background.
          //
          // The WIDTH of the crest is never touched — by this or by `urgent`.
          // The corpse shelf obeys the same rule: colour and brightness say what
          // state a surface is in, width says what the collision is, and a hold
          // drawn narrower than it catches is the one lie this art direction is
          // not allowed to tell.
          ctx.fillStyle = rgb(B.accent, 0.22 + lit * 0.30 + urgent * 0.4);
          const teeth = 5;
          for (let k = 0; k < teeth; k++) {
            const f = (k + 0.5) / teeth - 0.5;
            const drop = h * (0.5 + ((k * 7) % 5) * 0.28);
            ctx.fillRect(sx + w * f - this.dpr * 0.6, top,
              Math.max(1, this.dpr * 1.2), drop);
          }
        }
        if (s.drift > 0) {
          // BLOOM: the track it travels, end to end, as a dashed rail. Dashed
          // so it cannot be mistaken for a ledge, and bright enough to be seen —
          // the first version was 0.05 alpha and did not survive a screenshot.
          // Without it a drifting ledge is a moving target with no way to know
          // where it will be; with it, the whole path is something you can aim
          // at while it is still somewhere else.
          const t0 = this.X(s.baseX - s.drift) - w * 0.5;
          const t1 = this.X(s.baseX + s.drift) + w * 0.5;
          ctx.strokeStyle = rgb(B.accent, 0.16 + lit * 0.20);
          ctx.lineWidth = Math.max(1, this.dpr);
          ctx.setLineDash([2.5 * this.dpr, 3.5 * this.dpr]);
          ctx.beginPath();
          ctx.moveTo(t0, top - 3 * this.dpr);
          ctx.lineTo(t1, top - 3 * this.dpr);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        continue;
      }

      // A corpse. Two independent things are being said at once:
      //   COLOUR says how long ago this was you — accent when fresh, cooling to
      //          gold as it recedes into history.
      //   FORM says whether it will still hold your weight — full, narrowed and
      //          cracked, a bare shelf, or an outline you will fall straight
      //          through.
      // The player learns the erosion rule by looking, never by being told.
      const st = erosionOf(s, sim);
      const age = total > 1 ? 1 - s.order / (total - 1) : 0;
      const cool = clamp(age * 1.15, 0, 1);
      // RECEDING INTO HISTORY IS A DIMMING AS WELL AS A COOLING.
      //
      // MEMORY_GOLD is LUMINANCE 158.2 and ASH's ember accent is 144.8, so
      // cooling a body toward memory was making it NINE PERCENT BRIGHTER. Age
      // pulled one way and solidity's falling alpha pulled the other, the hue
      // won, and the result was a tell running backwards: acceptance 13 read
      // FRESH at 81.6 against THIN at 105.7 — the freshest body on screen was
      // the darkest one, in a game where brightness is how a player judges
      // whether a hold still takes their weight.
      //
      // It predates the facade entirely. The lit windows behind the bodies only
      // widened the gap enough that the four printed numbers made it obvious,
      // and the gate never could: it scores the DISTANCE between stages, never
      // their ORDER, so a clean inversion passes at 18.5 against a threshold of
      // 3. It is gated on order now as well.
      const fade = 1 - cool * FEEL.tower.memoryDim;
      const cr = lerp(B.accent[0], MEMORY_GOLD[0], cool) * fade;
      const cg = lerp(B.accent[1], MEMORY_GOLD[1], cool) * fade;
      const cb = lerp(B.accent[2], MEMORY_GOLD[2], cool) * fade;
      s.glow = Math.max(0, s.glow - 0.02);
      const rimlight = lit * 0.75 + s.glow * 0.4;

      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(s.rot);

      if (st === EROSION.MEMORY) {
        // Present, permanently. Load-bearing, never again. Pure gold outline,
        // no fill at all — the read is "this is a picture, not a place".
        ctx.strokeStyle = rgb(MEMORY_GOLD, 0.20 + lit * 0.16);
        ctx.lineWidth = Math.max(0.7, this.dpr * 0.7);
        this._figurePath(ctx, s.hw * this.scale, s.hh * this.scale, s.pose);
        ctx.stroke();
      } else {
        const narrow = st === EROSION.FRESH ? 1 : 0.45;
        // FRESH AND THIN WERE NEARLY THE SAME BRIGHTNESS.
        //
        // Solidity used to run 1 / 0.66 / 0.34, and once `rimlight` is up — which
        // it is whenever the player's light is anywhere near — a FRESH fill and a
        // THIN fill land within a tenth of each other. Acceptance test 13 was
        // passing on a margin of 4.2 against a threshold of 3, which is not a
        // pass, it is a coin landing on its edge. An external reviewer had already
        // said it in words: "it is not clear which bodies still hold weight".
        // The spread is wider now, and it is widest on the shelf bar below,
        // because the shelf IS the hitbox.
        const solidity = st === EROSION.FRESH ? 1 : st === EROSION.THIN ? 0.5 : 0.24;
        const fill = `rgba(${cr | 0},${cg | 0},${cb | 0},${(0.10 + solidity * (0.22 + rimlight * 0.5)).toFixed(3)})`;
        const rim = `rgba(${cr | 0},${cg | 0},${cb | 0},${(0.08 + solidity * (0.16 + rimlight * 0.8)).toFixed(3)})`;
        const hwPx = s.hw * this.scale * narrow;
        const hhPx = s.hh * this.scale;

        this._figurePath(ctx, hwPx, hhPx, s.pose);
        // A BODY IS OPAQUE, AND THE BUILDING BEHIND IT IS LIT.
        //
        // Every corpse fill is translucent, and an eroded one is MORE
        // translucent — so once the facade went in behind them, the lit windows
        // shone through a decayed body harder than through a whole one, and
        // acceptance 13 measured FRESH at luminance 84.7 against THIN at 110.8.
        // The freshest body on screen was the DARKEST. That is not a smaller
        // margin, it is the tell running backwards: brightness is what tells a
        // player whether a hold will still take their weight, and it was saying
        // the opposite.
        //
        // The gate could not catch it. It scores the DISTANCE between stages,
        // not their ORDER, so a clean inversion still reads as separation and
        // still passes — at 22.3 against a threshold of 3. Only the four
        // printed numbers, read in order, show it.
        //
        // Occluding by solidity fixes it and is the honest picture: a whole body
        // blocks the windows behind it, a crumbling one lets them through, and a
        // MEMORY corpse is an outline that blocks nothing because it is a
        // picture of a body rather than a body.
        ctx.fillStyle = rgb(B.bgBot, solidity * FEEL.tower.corpseOcclude);
        ctx.fill();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = rim;
        ctx.lineWidth = Math.max(0.8, this.dpr * (st === EROSION.TOP ? 0.6 : 0.9));
        ctx.stroke();

        // The load-bearing surface, drawn as a bright bar exactly as wide as the
        // collision actually is. Fresh corpses get a full shelf; eroded ones a
        // visibly shorter one. This is the tell that reads fastest.
        ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${(0.16 + solidity * 0.80).toFixed(3)})`;
        ctx.fillRect(-hwPx, -hhPx, hwPx * 2,
                     Math.max(1, (st === EROSION.FRESH ? 2.1 : 1.2) * this.dpr));

        // AND IT CATCHES LIGHT THE WAY A LEDGE CREST DOES.
        //
        // A generated ledge draws its crest and then an additive bar over it, so
        // it blooms. The shelf of a body you left did not, and measured side by
        // side at the same height and the same distance from the player's light
        // the world's hold came out 1.13x the peak of the one you made. Modest —
        // most of what makes a corpse read as debris in a screenshot is its
        // shape and its width, not this — but the direction was backwards in a
        // game whose title card says every death leaves a stone. The rule now is
        // that a FRESH body is not a dimmer hold than the rock beside it.
        //
        // Scaled by `solidity`, which DEEPENS the erosion ladder rather than
        // flattening it: full on FRESH, half on THIN, almost nothing on TOP.
        // And exactly `hwPx * 2` wide, which is the narrowed hitbox — the one
        // lie this art direction is not allowed to tell is a hold drawn wider
        // than it catches.
        const bloom = FEEL.tower.corpseBloom * solidity
          * (FEEL.tower.corpseBloomBase + rimlight * FEEL.tower.corpseBloomLit);
        if (bloom > 0.002) {
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${bloom.toFixed(3)})`;
          ctx.fillRect(-hwPx, -hhPx - 1.5 * this.dpr, hwPx * 2, 3 * this.dpr);
          ctx.globalCompositeOperation = 'source-over';
        }

        // THE UNIFORM OF THE FLOOR THIS BODY DIED ON, fading as it decays.
        //
        // Keyed to the corpse's OWN altitude, not the player's, so a tower reads
        // as strata — waiters at the bottom, suits through the middle, harnesses
        // near the top — which is the single best image this game can put on a
        // share card. Faded by `solidity` so a body that no longer holds weight
        // loses its uniform with the rest of it, and a MEMORY corpse (a separate
        // branch above, outline only) never gets one at all.
        const cf = FLOORS[Math.floor(Math.max(0, s.y) / BIOME_SPAN) % FLOORS.length];
        ctx.save();
        this._figurePath(ctx, hwPx, hhPx, s.pose);
        ctx.clip();
        costumeMarks(ctx, hwPx, hhPx, cf.costume,
                     cf.detail * solidity * FEEL.figure.corpseCostume, 0, B.accent);
        ctx.restore();

        if (st === EROSION.THIN) {
          // Cracks. Three hairlines through the body, seeded off the pose so a
          // given corpse always cracks the same way.
          ctx.strokeStyle = `rgba(0,0,0,0.55)`;
          ctx.lineWidth = Math.max(0.7, this.dpr * 0.6);
          for (let k = 0; k < 3; k++) {
            const t = -0.5 + (k + (s.pose & 3) * 0.17) * 0.42;
            ctx.beginPath();
            ctx.moveTo(-hwPx, hhPx * t);
            ctx.lineTo(hwPx * 0.4, hhPx * (t + 0.22));
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }
  }

  /**
   * SIGNAL's rising air.
   *
   * Drawn exactly `verbs.updraftW` wide and `verbs.updraftH` tall, because those
   * are the numbers the physics tests — a column you can see the edge of is a
   * column you can aim into, and one drawn wider than it lifts is a trap.
   *
   * The streaks exist for one reason: a glow says "something here", and only
   * motion says WHICH WAY. Their positions come from `sim.verbTime`, so nothing
   * is stored and nothing allocates.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Sim} sim
   */
  _updrafts(ctx, B, sim) {
    const V = FEEL.verbs;
    const solids = sim.world.solids;
    const t = sim.verbTime;
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!s.updraft) continue;
      const top = s.y + s.hh;
      const y0 = this.Y(top);
      const y1 = this.Y(top + V.updraftH);
      if (y1 > this.h + 80 || y0 < -80) continue;
      const x = this.X(s.x);
      const w = V.updraftW * this.scale;

      const g = ctx.createLinearGradient(0, y0, 0, y1);
      g.addColorStop(0, rgb(B.accent, 0.13));
      g.addColorStop(0.55, rgb(B.accent, 0.05));
      g.addColorStop(1, rgb(B.accent, 0));
      ctx.fillStyle = g;
      ctx.fillRect(x - w, y1, w * 2, y0 - y1);

      // The two edges, so the column has a boundary you can be outside of.
      ctx.fillStyle = rgb(B.accent, 0.10);
      ctx.fillRect(x - w, y1, Math.max(1, this.dpr * 0.8), y0 - y1);
      ctx.fillRect(x + w - Math.max(1, this.dpr * 0.8), y1, Math.max(1, this.dpr * 0.8), y0 - y1);

      // RISING SPARKS, NOT RISING BARS.
      //
      // The first version drew horizontal streaks across the column, and a
      // screenshot said what was wrong with them immediately: a bright
      // horizontal line is exactly what a landing crest looks like in this
      // game. Every mote was a ledge you might try to aim at. Short VERTICAL
      // strokes cannot be mistaken for a surface, and they say "up" on their
      // own without needing the animation to be watched.
      const span = y0 - y1;
      const len = Math.max(2, span * 0.055);
      for (let k = 0; k < 7; k++) {
        const f = (t * 0.42 + k * 0.1428) % 1;
        const sy = y0 - span * f;
        const off = ((k * 37) % 100) / 100 - 0.5;      // fixed lanes, not random
        const a = 0.30 * (1 - f) * (f < 0.15 ? f / 0.15 : 1);
        ctx.fillStyle = rgb(B.accent, a);
        ctx.fillRect(x + off * w * 1.7, sy - len, Math.max(1, this.dpr), len);
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * VOID's darkness: you see what your own light reaches, and no further.
   *
   * One radial wipe centred on the body. `verbs.darkFloor` is how much of the
   * biome survives at the edge of the screen — never zero, because a black
   * rectangle is not a biome, and a player who cannot see the shape of the
   * tower cannot tell a hard gap from a bug.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Sim} sim
   * @param {number} depth 1 while playing, 0 at full monument pull-back
   */
  _dark(ctx, B, sim, depth) {
    // How much of the current cross-fade is VOID. Reading it off the blend
    // rather than off the name means the darkness arrives and leaves with the
    // colour, over the same 20 m, instead of snapping at the boundary.
    const a = B.index % BIOMES.length, b = (B.index + 1) % BIOMES.length;
    const voidness = (a === VOID_BIOME ? 1 - B.blend : 0) + (b === VOID_BIOME ? B.blend : 0);
    if (voidness <= 0.001) return;

    const k = voidness * depth * (1 - FEEL.verbs.darkFloor);
    const px = this.X(sim.body.rx ?? sim.body.x);
    const py = this.Y(sim.body.ry ?? sim.body.y);
    // The lit radius is generous — the point is that the NEXT ledge is unknown,
    // not that this one is.
    const r = this.h * 0.62;
    const g = ctx.createRadialGradient(px, py, r * 0.22, px, py, r);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.55, `rgba(0,0,0,${(k * 0.45).toFixed(3)})`);
    g.addColorStop(1, `rgba(0,0,0,${k.toFixed(3)})`);
    ctx.fillStyle = g;
    ctx.fillRect(-40, -40, this.w + 80, this.h + 80);
  }

  /**
   * A frozen silhouette. Four poses, chosen at the moment of death and kept
   * forever, so no two corpses in the tower are the same shape.
   */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} hw
   * @param {number} hh
   * @param {number} pose
   */
  _figurePath(ctx, hw, hh, pose) { figurePath(ctx, hw, hh, pose); }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   */
  _rings(ctx, B) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.ringN; i++) {
      const o = i * 4;
      const t = this.rings[o + 2] / (FEEL.juice.ringMs / 1000);
      const r = (4 + t * 26 * (0.5 + this.rings[o + 3])) * this.scale;
      ctx.strokeStyle = rgb(B.accent, (1 - t) * 0.5);
      ctx.lineWidth = Math.max(1, (1 - t) * 2.4 * this.dpr);
      ctx.beginPath();
      ctx.ellipse(this.X(this.rings[o]), this.Y(this.rings[o + 1]), r, r * 0.35, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   */
  _parts(ctx, B) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.partN; i++) {
      const o = i * 7;
      const t = this.parts[o + 4] / this.parts[o + 5];
      const a = (1 - t) * 0.85;
      const s = (0.5 + this.parts[o + 6] * 1.3) * this.scale * (1 - t * 0.4);
      ctx.fillStyle = rgb(B.accent, a);
      ctx.fillRect(this.X(this.parts[o]) - s * 0.5, this.Y(this.parts[o + 1]) - s * 0.5, s, s);
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   */
  _trail(ctx, B) {
    if (this.trailN < 2) return;
    const life = (FEEL.juice.trailMs / 1000)
      * (1 + FEEL.momentum.trailGain * this.momentum);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < this.trailN - 1; i++) {
      const a0 = this.trail[i * 3 + 2];
      if (a0 > life) break;
      const f = 1 - a0 / life;
      ctx.strokeStyle = rgb(B.accent, f * 0.5);
      ctx.lineWidth = Math.max(0.6, f * 3.4 * this.dpr);
      ctx.beginPath();
      ctx.moveTo(this.X(this.trail[i * 3]), this.Y(this.trail[i * 3 + 1]));
      ctx.lineTo(this.X(this.trail[(i + 1) * 3]), this.Y(this.trail[(i + 1) * 3 + 1]));
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * YOUR BEST RUN, STANDING WHERE IT STOOD AT THIS LAUNCH NUMBER.
   *
   * Not a clock race — see DECISIONS §33. It steps forward when YOU launch, so
   * the read is "at your seventh jump, your best self was here", which compares
   * climbing rather than deliberation and cannot punish a player for thinking.
   *
   * Drawn in memory-gold, hollow, and smaller than you: it must never for a
   * moment be mistaken for the shard the player is steering. The path it took
   * to get here trails behind it, which is what makes it read as a run rather
   * than as a marker.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} _B unused; a ghost is always memory-gold
   * @param {Sim} sim
   * @param {UiState} ui
   * @param {number} dt
   */
  _ghostRun(ctx, _B, sim, ui, dt) {
    const G = FEEL.ghost;
    const p = sim.ghostPath;
    if (!ui.started || p.length < 4) return;

    // Its launch index is yours, clamped to how far it ever got. Standing on
    // its own last position after it has run out is exactly right: that is
    // where it died, and it is the frontier.
    const n = p.length >> 1;
    const i = Math.min((ui.runLaunches ?? 0) | 0, n - 1);
    const tx = p[i * 2], ty = p[i * 2 + 1];

    // Eased, so it steps between perches instead of teleporting.
    let at = this._ghostAt;
    if (!at) { at = this._ghostAt = [tx, ty]; }
    const k = Math.min(1, dt * G.ease);
    at[0] += (tx - at[0]) * k;
    at[1] += (ty - at[1]) * k;
    const gx = at[0], gy = at[1];

    // Off screen by more than a fade's worth: nothing to draw.
    const sy = this.Y(gy);
    if (sy < -G.fadeU * this.scale || sy > this.h + G.fadeU * this.scale) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // The path it took to get here.
    ctx.strokeStyle = rgb(MEMORY_GOLD, G.alpha * 0.5);
    ctx.lineWidth = Math.max(1, 1.1 * this.dpr);
    ctx.beginPath();
    let started = false;
    for (let j = i; j >= 0; j--) {
      const px = p[j * 2], py = p[j * 2 + 1];
      if (gy - py > G.trailU) break;
      if (!started) { ctx.moveTo(this.X(gx), this.Y(gy)); started = true; }
      ctx.lineTo(this.X(px), this.Y(py));
    }
    if (started) ctx.stroke();

    // The runner: hollow, and two thirds your size.
    const hw = FEEL.body.w * 0.34 * this.scale;
    const hh = FEEL.body.h * 0.34 * this.scale;
    ctx.translate(this.X(gx), this.Y(gy) - hh);
    ctx.beginPath();
    ctx.moveTo(0, -hh);
    ctx.lineTo(hw, 0);
    ctx.lineTo(0, hh);
    ctx.lineTo(-hw, 0);
    ctx.closePath();
    ctx.strokeStyle = rgb(MEMORY_GOLD, G.alpha * 2.2);
    ctx.lineWidth = Math.max(1, 1.2 * this.dpr);
    ctx.stroke();
    ctx.fillStyle = rgb(MEMORY_GOLD, G.alpha * 0.45);
    ctx.fill();
    ctx.restore();
  }

  /**
   * You. Not a box: a small emissive shard that carries the only real light in
   * the scene, squashing and stretching along its velocity with a spring return.
   */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Sim} sim
   * @param {UiState} ui
   */
  _player(ctx, B, sim, ui, input, dt) {
    const b = sim.body;
    const x = this.X(b.rx ?? b.x), y = this.Y((b.ry ?? b.y) + FEEL.body.h * 0.5);
    const hw = FEEL.body.w * 0.5 * this.scale;
    const hh = FEEL.body.h * 0.5 * this.scale;

    // The light it casts. A clean streak widens it and lifts the core — the
    // only place momentum is ever visible, and it reads as the tower getting
    // brighter around you rather than as a score going up.
    const M = this.momentum;
    const R = 66 * this.scale * (1 + FEEL.momentum.lightGain * M);
    const lift = 1 + FEEL.momentum.lightAlpha * M;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, rgb(B.accent, 0.34 * lift));
    g.addColorStop(0.14, rgb(B.accent, 0.15 * lift));
    g.addColorStop(0.42, rgb(B.accent, 0.045 * lift));
    g.addColorStop(1, rgb(B.accent, 0));
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.fillRect(x - R, y - R, R * 2, R * 2);
    ctx.globalCompositeOperation = 'source-over';

    // ---- STANCE. What the body is doing, eased, never snapped.
    //
    // Read off state the sim already owns rather than stored in it: the renderer
    // is allowed an opinion about how a thing looks, and putting an animation
    // clock in the simulation would make two identical drags produce two
    // different landings, which acceptance test 1 exists to forbid.
    const P = FEEL.figure;
    const air = !b.grounded;
    const aiming = !!(input && input.aiming);
    // WHICH WAY THE WEIGHT IS GOING. While aiming that is the shot you are about
    // to take, which is why the wind-up reads as intent and not as a wobble; in
    // flight it is the velocity; standing still it decays to square.
    let wantLean = 0;
    if (aiming && input.arc && input.arc.length >= 4) {
      wantLean = clamp((input.arc[2] - input.arc[0]) * P.aimLean, -1, 1);
    } else if (air) {
      wantLean = clamp(b.vx * P.flightLean, -1, 1);
    }
    const wantCrouch = aiming ? 1 : (air ? 0 : ui.squash * P.landCrouch);
    const wantStretch = air ? clamp(Math.abs(b.vy) * P.flightStretch, 0, 1) : 0;
    const k = Math.min(1, (dt || 1 / 60) * P.ease);
    this.figLean += (wantLean - this.figLean) * k;
    this.figCrouch += (wantCrouch - this.figCrouch) * k;
    this.figStretch += (wantStretch - this.figStretch) * k;
    // THE GAZE. A head that turns is the difference between a shape that moves
    // and a creature that intends something. While aiming it goes where the shot
    // goes, so the figure is looking at the ledge you are about to try for; in
    // flight it looks where it is travelling; standing, it drifts and settles
    // ahead. Faster than the body's ease, because a head turns before the weight
    // does — that lag is most of what makes it read as alive rather than rigid.
    const wantLook = aiming || air ? clamp(wantLean * P.lookGain, -1, 1) : 0;
    this.figLook += (wantLook - this.figLook) * Math.min(1, (dt || 1 / 60) * P.lookEase);

    // IDLE. A body standing on a ledge with nothing happening used to be a
    // perfectly still shape, which is the single clearest tell that a thing is
    // a sprite and not a character. It breathes, and it shifts its weight —
    // slow, tiny, and only when grounded and not aiming, so it never competes
    // with the wind-up or reads as input lag.
    this.figT += (dt || 1 / 60);
    const settled = !air && !aiming ? 1 : 0;
    this.figIdle += (settled - this.figIdle) * Math.min(1, (dt || 1 / 60) * P.idleEase);
    // Aiming and landing both raise `crouch`, and they are opposite shapes: a
    // wind-up puts the arms BEHIND, a landing throws them WIDE. Tracked apart so
    // the rig can tell which gather it is looking at.
    this.figAim += ((aiming ? 1 : 0) - this.figAim) * k;
    const breathe = Math.sin(this.figT * P.breatheRate) * P.breatheAmp * this.figIdle;
    const sway = Math.sin(this.figT * P.swayRate + 1.3) * P.swayAmp * this.figIdle;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(clamp(-b.vx * 0.0016, -0.45, 0.45));
    const sx = (1 - ui.squash) * (1 - breathe * 0.5);
    const sy = (1 + ui.squash) * (1 + breathe);
    ctx.scale(sx, sy);

    // The climber, on the rig: head, torso, two arms, two legs.
    const L = this.figLean + sway, C = this.figCrouch, S = this.figStretch;
    const LK = this.figLook + sway * 0.5;
    const CH = CHARACTERS[this.character % CHARACTERS.length];
    ctx.fillStyle = rgb(CH.skin, 0.97);
    ctx.strokeStyle = rgb(CH.skin, 0.95);
    figureRig(ctx, hw, hh, L, C, S, LK, this.figT * FEEL.figure.swayRate, this.figIdle,
              this.figAim, CH);

    // The living core: the one part of the figure that is the biome's accent
    // rather than white, so a body reads as lit from inside while it is yours
    // and merely lit from outside once it is not.
    // The living core: the one part that is the biome's accent rather than white,
    // so a body reads as lit from inside while it is still yours.
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = rgb(B.accent, 0.42);
    ctx.strokeStyle = rgb(B.accent, 0.30);
    figureRig(ctx, hw * 0.62, hh * 0.72, L, C, S, LK,
              this.figT * FEEL.figure.swayRate, this.figIdle, this.figAim, CH);
    ctx.globalCompositeOperation = 'source-over';

    // WHAT THIS FLOOR PUTS YOU IN. Clipped to the outline, so the costume can
    // never change the silhouette — the shape stays the one thing that only
    // ever means "this is a body".
    ctx.save();
    figureLive(ctx, hw, hh, L, C, S, LK);
    ctx.clip();
    const fl = FLOORS[((B.index % FLOORS.length) + FLOORS.length) % FLOORS.length];
    const gy = 1 - C * 0.30 + S * 0.26;
    const gx = 1 + C * 0.22 - S * 0.14;
    costumeMarks(ctx, hw * gx, hh * gy, fl.costume, fl.detail, LK, B.accent);
    ctx.restore();
    ctx.restore();
  }

  /**
   * The aim: the exact arc the physics will take, crisp for the first stretch
   * and dissolving after, plus a reticle at the predicted first contact. The
   * reticle takes the accent colour on a safe surface and dims on nothing.
   */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} B
   * @param {Input} input
   * @param {Sim} sim
   */
  _aim(ctx, B, input, sim) {
    const arc = input.arc;
    const n = arc.length >> 1;
    if (n < 2) return;
    const crisp = Math.max(1, Math.floor(n * FEEL.aim.arcCrisp));

    for (let i = 0; i < n; i++) {
      const x = this.X(arc[i * 2]);
      const y = this.Y(arc[i * 2 + 1]);
      const fade = i < crisp ? 1 : clamp(1 - (i - crisp) / (n - crisp + 1e-6), 0, 1);
      if (fade <= 0.02) continue;
      const r = (1.5 + 1.4 * fade) * this.dpr;
      ctx.fillStyle = rgb(B.accent, 0.20 + fade * 0.55);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }

    const lx = this.X(arc[(n - 1) * 2]);
    const ly = this.Y(arc[(n - 1) * 2 + 1]);
    const safe = !!input.landing;
    const col = safe ? B.accent : [120, 128, 140];
    ctx.strokeStyle = rgb(col, safe ? 0.9 : 0.32);
    ctx.lineWidth = Math.max(1, 1.4 * this.dpr);
    const R = (safe ? 9 : 6) * this.dpr;
    ctx.beginPath(); ctx.arc(lx, ly, R, 0, TAU); ctx.stroke();
    if (safe) {
      ctx.beginPath();
      ctx.moveTo(lx - R * 1.7, ly); ctx.lineTo(lx - R * 0.6, ly);
      ctx.moveTo(lx + R * 0.6, ly); ctx.lineTo(lx + R * 1.7, ly);
      ctx.stroke();
      return;
    }

    // THE BODY YOU WOULD LEAVE.
    //
    // This launch does not land. Drawn at the apex, in the gold of memory and
    // in the same silhouette every corpse in the tower is drawn with, is the
    // shape you are about to become — at the exact spot `_die` will put it,
    // because `predict` reports the same two fields `_die` reads.
    //
    // Some gaps in this tower cannot be crossed at all; that is deliberate and
    // it is the point of the game. But the bot only knows a gap is impossible
    // because it can run the physics nine times, and a player has one arc
    // following their thumb. Without this, an uncrossable gap is
    // indistinguishable from a badly aimed jump, and the mechanic the whole
    // design rests on reads as the game being unfair. With it, the question
    // stops being "can I make this" and becomes "where do I want my body",
    // which is a decision instead of a punishment.
    const pk = sim.predictPeak;
    if (!pk.dies) return;

    // GOLD IS A BODY. THE ACCENT IS A PLAN.
    //
    // Gold is the colour of memory everywhere in this game — old corpses, the
    // thread between them, the monument. A prospective corpse drawn in gold
    // says "you will die here" and nothing else, which is what every ghost said
    // for as long as the ghost existed. When `sim.gainsFrom` finds that this
    // body would put a ledge in reach that this perch cannot reach, the
    // silhouette switches to the LIVING accent — the colour of the player, the
    // arc and the light — and the ledge it buys takes a ring.
    //
    // That is the entire difference between throwing yourself away and spending
    // yourself, said in a colour, with no text anywhere near it.
    const gain = pk.gains;
    const A = FEEL.aim;
    const ghostCol = gain ? B.accent : MEMORY_GOLD;
    const a = gain ? A.ghostGainAlpha : A.ghostAlpha;

    if (gain) {
      const r = A.gainRingU * this.scale;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = rgb(B.accent, A.gainRingAlpha);
      ctx.lineWidth = Math.max(1, 1.2 * this.dpr);
      ctx.beginPath();
      ctx.arc(this.X(sim.driftXAt(gain, sim.verbTime)), this.Y(gain.y + gain.hh),
              r, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(this.X(pk.x), this.Y(pk.y));
    this._figurePath(ctx, FEEL.tower.corpseW * 0.5 * this.scale,
                     FEEL.tower.corpseH * 0.5 * this.scale, 0);
    ctx.fillStyle = rgb(ghostCol, a * 0.30);
    ctx.fill();
    ctx.strokeStyle = rgb(ghostCol, a);
    // Solid, not dashed. A body is 5.2 x 6.0 u — about fifteen CSS pixels tall
    // on a phone — and a dash pattern at that size breaks the silhouette into a
    // dotted blob that reads as a marker rather than as a person. The SIZE is
    // left honest: this is exactly how much room the corpse will take up, and
    // that is the thing the player is deciding about.
    ctx.lineWidth = Math.max(1, (gain ? A.ghostGainWidth : 1.3) * this.dpr);
    ctx.stroke();
    ctx.restore();
  }

  /** A hairline at your all-time best, visible only when you are near it. */
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {BiomeSlot} _B unused; the record line is always the accent
   * @param {Sim} sim
   */
  _bestLine(ctx, _B, sim) {
    if (sim.best <= 1) return;
    const d = Math.abs((sim.body.ry ?? sim.body.y) - sim.best);
    if (d > FEEL.bestLineFadeU) return;
    const f = 1 - d / FEEL.bestLineFadeU;
    const y = this.Y(sim.best);
    // Above this line the world is regenerated every attempt and no corpse can
    // carry you. It is a frontier, so it is drawn as a horizon rather than as a
    // tick: a soft band of light with a hairline through it.
    const g = ctx.createLinearGradient(0, y - 26 * this.dpr, 0, y + 26 * this.dpr);
    g.addColorStop(0, rgb(MEMORY_GOLD, 0));
    g.addColorStop(0.5, rgb(MEMORY_GOLD, f * 0.10));
    g.addColorStop(1, rgb(MEMORY_GOLD, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, y - 26 * this.dpr, this.w, 52 * this.dpr);
    ctx.strokeStyle = rgb(MEMORY_GOLD, f * 0.40);
    ctx.lineWidth = 1;
    ctx.setLineDash([3 * this.dpr, 9 * this.dpr]);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.w, y); ctx.stroke();
    ctx.setLineDash([]);
  }
}
