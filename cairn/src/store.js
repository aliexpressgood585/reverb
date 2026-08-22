import { FEEL, COLUMN, biomeAt, newBiomeSlot } from './feel.js';

/** @typedef {import('./sim.js').Sim} Sim */
/** @typedef {import('./types.js').Solid} Solid */

/**
 * A 2D context that is known to exist.
 *
 * `getContext('2d')` is typed as nullable and returns null only when the canvas
 * already has an incompatible context bound. Every canvas in this file is created
 * one line above the call, so it cannot. Asserting once here beats 34 null checks
 * that can never fire — and it throws loudly rather than drawing into nothing if
 * that assumption ever stops holding.
 *
 * @param {HTMLCanvasElement} cv
 * @returns {CanvasRenderingContext2D}
 */
function ctx2d(cv) {
  const c = cv.getContext('2d');
  if (!c) throw new Error('CAIRN: no 2D context on a freshly created canvas');
  return c;
}

/**
 * Persistence and the share poster.
 *
 * THE TOWER IS THE GAME. Every body in it was a decision — since some gaps
 * cannot be crossed, a player chooses where to die — so losing a save is not
 * losing a score, it is losing work. That makes this the highest-consequence
 * file in the project and it is written accordingly:
 *
 *   - a MIGRATION CHAIN, so a format change never silently discards a tower
 *   - a BACKUP SLOT, so a truncated or corrupt write costs one session, not all
 *   - FIELD VALIDATION, so a bad row is dropped instead of being fed to the
 *     physics engine. A corpse at x = 1e9 does not just look wrong; it poisons
 *     the height buckets that every collision query walks.
 *
 * The key name can never change. It carries "v1" for historical reasons and the
 * schema number inside the payload is what actually versions the format — the
 * two are not the same thing, and renaming the key would orphan every existing
 * save on every existing phone.
 */

const KEY = 'cairn.v1';
const BAK = 'cairn.bak';
const SCHEMA = 2;

/**
 * THE SLOT. Endless and the Daily Climb are two towers and must never share
 * storage: a daily seed is thrown away tomorrow and an endless tower is the
 * player's whole history. `''` is endless and keeps the original key names
 * exactly, so every save already on a phone still loads.
 */
let slot = '';
/** @param {string} name */
export function setSlot(name) { slot = name ? `.${name}` : ''; }
const key = () => KEY + slot;
const bakKey = () => BAK + slot;

/**
 * ONE SEED PER UTC DATE, the same for everyone on earth.
 *
 * Built from the date only, in UTC, so a player in Auckland and a player in Los
 * Angeles are climbing the identical tower at the same moment even though their
 * local calendars disagree. The seed is derived rather than stored, so a share
 * card only has to carry the date for a recipient to get the same climb.
 */
/**
 * @param {Date} [now]
 * @returns {string} YYYY-MM-DD, always UTC
 */
export function dailyDate(now = new Date()) {
  return now.toISOString().slice(0, 10);          // YYYY-MM-DD, always UTC
}

/**
 * @param {string} [date]
 * @returns {number}
 */
export function dailySeed(date = dailyDate()) {
  // FNV-1a over the date string. Any stable hash would do; what matters is that
  // it is a pure function of the date and computed identically everywhere.
  let h = 0x811c9dc5;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h | 0) || 0x1a2b3c;
}
const MAX_STORED = 600;   // beyond this the tower is scenery, not gameplay

/**
 * SCHEMA HISTORY
 *
 * 1  x, y, rot, pose per corpse.
 *    Missing `bornDeath`, which erosion measures age against — so every corpse
 *    loaded from a v1 save came back with age = `deaths` and was therefore
 *    already MEMORY: drawn, and not solid. A reload turned the staircase a
 *    player had built out of themselves into scenery. Acceptance test 8 passed
 *    throughout, because it checks that corpses EXIST after a reload, not that
 *    they still hold weight.
 *
 * 2  adds bornDeath, five numbers per corpse.
 *    v1 migrates exactly rather than by guessing: every death creates exactly
 *    one corpse and increments `deaths`, so a corpse's birth index IS its
 *    position in death order. For the i-th of n stored, allowing for the oldest
 *    having been trimmed, bornDeath = deaths - n + i.
 */

const FIELDS = 5;

/**
 * @param {string} k
 * @returns {any}
 */
function readSlot(k) {
  let raw;
  try { raw = localStorage.getItem(k); } catch { return null; }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** @param {Sim} sim */
export function save(sim) {
  try {
    const solids = sim.world.solids;
    /** @type {number[]} */
    const packed = [];
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!s.corpse) continue;
      packed.push(
        Math.round(s.x * 100) / 100,
        Math.round(s.y * 100) / 100,
        Math.round(s.rot * 1000) / 1000,
        s.pose | 0,
        (s.bornDeath ?? 0) | 0,
      );
    }
    const trim = packed.length > MAX_STORED * FIELDS
      ? packed.slice(packed.length - MAX_STORED * FIELDS)
      : packed;

    const payload = JSON.stringify({
      v: SCHEMA,
      seed: sim.world.seed,
      best: Math.round(sim.best * 100) / 100,
      deaths: sim.deaths,
      // `n` is how the loader detects a truncated write. A half-finished
      // localStorage entry parses as valid JSON surprisingly often.
      n: trim.length / FIELDS,
      corpses: trim,
      // THE HELD LANDMARKS. Not schema-versioned, on purpose: it is an optional
      // array that older code ignores and the loader below tolerates being
      // absent, so it needs no migration in either direction. A claim is
      // permanent (FEEL.landmark.heartU) and permanent has to mean across a
      // reload or it means nothing.
      held: [...sim.claimed].filter((b) => Number.isFinite(b) && b >= 0 && b < 4096),
    });

    // Demote the current save to the backup slot before overwriting it, but only
    // if it is intact — promoting a corrupt payload to the backup would destroy
    // the one copy that could still be recovered.
    const current = readSlot(key());
    if (current && validate(current)) {
      try { localStorage.setItem(bakKey(), JSON.stringify(current)); } catch { /* quota */ }
    }
    localStorage.setItem(key(), payload);
  } catch { /* private mode, quota, whatever — the game still plays */ }
}

/** Is this payload structurally sound enough to be worth migrating? */
/**
 * @param {any} d
 * @returns {boolean}
 */
function validate(d) {
  if (!d || typeof d !== 'object') return false;
  if (!Number.isFinite(d.v) || d.v < 1 || d.v > SCHEMA) return false;
  if (!Array.isArray(d.corpses)) return false;
  const stride = d.v === 1 ? 4 : FIELDS;
  if (d.corpses.length % stride !== 0) return false;
  if (d.v >= 2 && Number.isFinite(d.n) && d.n !== d.corpses.length / stride) return false;
  return true;
}

/** Bring any accepted payload up to the current schema. */
/**
 * @param {any} d
 * @returns {any}
 */
function migrate(d) {
  if (d.v === 1) {
    const n = d.corpses.length / 4;
    const deaths = d.deaths | 0;
    const out = [];
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      out.push(d.corpses[o], d.corpses[o + 1], d.corpses[o + 2], d.corpses[o + 3],
               Math.max(0, deaths - n + i));
    }
    d = { ...d, v: 2, n, corpses: out };
  }
  return d;
}

/**
 * What the last `load` actually did. Read by `cairn-store-check.mjs`, which has
 * to distinguish "restored from the main slot" from "the main slot was corrupt
 * and this came out of the backup" — a difference the return value cannot carry.
 */
export const loadStats = { source: '', dropped: 0 };

/**
 * @param {Sim} sim
 * @returns {boolean}
 */
export function load(sim) {
  // Main slot, then the backup. A tower is worth two attempts.
  let d = null;
  let from = '';
  for (const [k, label] of [[key(), 'main'], [bakKey(), 'backup']]) {
    const cand = readSlot(k);
    if (cand && validate(cand)) { d = migrate(cand); from = label; break; }
  }
  if (!d) return false;

  sim.best = Number.isFinite(+d.best) ? Math.max(0, +d.best) : 0;
  sim.deaths = Number.isFinite(+d.deaths) ? Math.max(0, d.deaths | 0) : 0;

  // Held landmarks. Absent in every save written before they existed, so the
  // guard is the migration. Each band is range-checked the same way every
  // corpse row is: one bad number costs one landmark, never the tower.
  sim.claimed.clear();
  if (Array.isArray(d.held)) {
    for (const raw of d.held) {
      const b = +raw;
      if (Number.isFinite(b) && b >= 0 && b < 4096) sim.claimed.add(b | 0);
    }
  }

  // Every row is checked before it reaches the world. A single bad number costs
  // one body, never the tower — and never the collision buckets.
  const c = d.corpses;
  let dropped = 0;
  for (let i = 0; i + FIELDS - 1 < c.length; i += FIELDS) {
    const x = +c[i], y = +c[i + 1], rot = +c[i + 2];
    const pose = c[i + 3] | 0, born = c[i + 4] | 0;
    if (!Number.isFinite(x) || x < -COLUMN || x > COLUMN * 2
        || !Number.isFinite(y) || y < -64 || y > 1e6
        || !Number.isFinite(rot) || Math.abs(rot) > Math.PI * 2) { dropped++; continue; }
    const s = sim.world.corpse(
      Math.min(Math.max(x, 0), COLUMN), Math.max(y, 0),
      rot, pose & 3, 0, Math.min(Math.max(born, 0), sim.deaths),
    );
    s.glow = 0;   // everything loaded is history; nothing just happened
  }

  sim.world.generate(Math.max(sim.best, 0) + FEEL.camera.viewH * 2.2);
  loadStats.source = from;
  loadStats.dropped = dropped;
  return true;
}

export function wipe() {
  try { localStorage.removeItem(key()); localStorage.removeItem(bakKey()); } catch { /* none */ }
}

// ------------------------------------------------------------------- poster

/** @type {(c: number[], a: number) => string} */
const rgb = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/**
 * Render the whole tower as a tall poster. This image is the game's marketing —
 * it is the thing a player posts — so it gets the full biome gradient, the
 * thread of light through every death in order, and the wordmark.
 */
/**
 * @param {Sim} sim
 * @param {number} [W]
 * @param {number} [H]
 * @returns {HTMLCanvasElement}
 */
export function poster(sim, W = 1080, H = 1920) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = ctx2d(cv);

  const top = Math.max(sim.best, 60) * 1.06;
  /** @type {(wy: number) => number} */
  const toY = (wy) => H - (wy / top) * H * 0.88 - H * 0.06;
  /** @type {(wx: number) => number} */
  const toX = (wx) => (wx / 100) * W;

  // Background: the whole climb's worth of biomes, stacked.
  const slot = newBiomeSlot();
  const g = ctx.createLinearGradient(0, H, 0, 0);
  for (let i = 0; i <= 10; i++) {
    const b = biomeAt((top * i) / 10, slot);
    g.addColorStop(i / 10, rgb(b.bgBot, 1));
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // The thread, then the bodies.
  const corpses = sim.world.solids.filter((s) => s.corpse).sort((a, b) => a.order - b.order);
  ctx.strokeStyle = 'rgba(201,154,74,0.30)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  corpses.forEach((s, i) => {
    const x = toX(s.x), y = toY(s.y);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  corpses.forEach((s, i) => {
    const b = biomeAt(s.y, slot);
    const age = corpses.length > 1 ? 1 - i / (corpses.length - 1) : 0;
    const col = [
      b.accent[0] * (1 - age) + 201 * age,
      b.accent[1] * (1 - age) + 154 * age,
      b.accent[2] * (1 - age) + 74 * age,
    ];
    const x = toX(s.x), y = toY(s.y);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(s.rot);
    ctx.fillStyle = rgb(col, 0.55);
    ctx.fillRect(-7, -11, 14, 22);
    ctx.strokeStyle = rgb(col, 0.95);
    ctx.lineWidth = 1.4;
    ctx.strokeRect(-7, -11, 14, 22);
    ctx.restore();
  });

  // Wordmark and numbers.
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.font = '300 108px ui-monospace, Menlo, monospace';
  ctx.fillText(`${Math.round(sim.best)}m`, W * 0.5, H * 0.13);
  ctx.font = '300 30px ui-monospace, Menlo, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.fillText(`${sim.deaths} STONES BELOW`, W * 0.5, H * 0.17);
  ctx.font = '300 40px ui-monospace, Menlo, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.fillText('C A I R N', W * 0.5, H * 0.955);
  return cv;
}

/**
 * The poster as bytes, in the best format this browser can actually produce.
 *
 * Drawing the tower costs 2 ms. ENCODING IT IS THE WHOLE WAIT. Measured on the
 * same 1080x1920 image with 220 bodies in it:
 *
 *   PNG    2225 ms   458 KB
 *   WebP   1033 ms   137 KB
 *   JPEG   1406 ms   240 KB
 *
 * So WebP: half the wait, a third of the bytes, and unlike JPEG it does not
 * band the dark gradients that are most of this game's identity. Safari only
 * gained canvas WebP encoding in 17 and older ones silently hand back PNG —
 * which `blob.type` reports honestly, so the caller just follows it rather than
 * probing for support.
 *
 * Exported so the share path and the monument check measure the same thing.
 */
/**
 * @param {Sim} sim
 * @param {number} [W]
 * @param {number} [H]
 * @returns {Promise<Blob|null>}
 */
export async function posterBlob(sim, W, H) {
  const cv = poster(sim, W, H);
  let blob = await new Promise((r) => cv.toBlob(r, 'image/webp', 0.92));
  if (!blob) blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  return blob;
}

/** Web Share where it exists, clipboard then download where it does not. */
/**
 * @param {Sim} sim
 * @returns {Promise<'shared'|'copied'|'downloaded'|'failed'>}
 */
export async function share(sim) {
  const blob = await posterBlob(sim);
  if (!blob) return 'failed';
  const type = blob.type || 'image/png';
  const ext = type.split('/')[1] || 'png';
  const file = new File([blob], `cairn.${ext}`, { type });
  // A daily share carries its DATE, which is the seed — so a recipient plays the
  // identical tower rather than a story about one.
  const text = sim.dailyDate
    ? `${Math.round(sim.best)}m — ${sim.deaths} stones below. CAIRN daily ${sim.dailyDate}`
    : `${Math.round(sim.best)}m — ${sim.deaths} stones below. CAIRN`;

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return 'shared'; } catch { /* cancelled */ }
  }
  try {
    // The clipboard is stricter than Web Share: PNG is the only image type
    // every implementation accepts, so anything else goes to the download path
    // rather than failing silently in the paste.
    if (navigator.clipboard && window.ClipboardItem && type === 'image/png') {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'copied';
    }
  } catch { /* fall through to download */ }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `cairn.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}

/**
 * The app icon, drawn rather than shipped: three stacked stones on black, with
 * a maskable safe zone. Generated at boot and injected as a data URL so the
 * manifest needs no binary asset in the repository.
 */
/**
 * @param {number} [size]
 * @param {boolean} [maskable]
 * @returns {string} a data URL
 */
export function icon(size = 512, maskable = false) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = ctx2d(cv);
  c.fillStyle = '#04060B';
  c.fillRect(0, 0, size, size);
  const pad = maskable ? size * 0.22 : size * 0.14;
  const inner = size - pad * 2;
  const rows = [
    [0.52, 0.26, 0.30],
    [0.50, 0.50, 0.46],
    [0.50, 0.76, 0.62],
  ];
  const cols = ['#DCE3E8', '#C99A4A', '#3D525F'];
  rows.forEach((r, i) => {
    const w = inner * r[2];
    const h = inner * 0.16;
    c.fillStyle = cols[i];
    c.globalAlpha = 1 - i * 0.18;
    c.fillRect(pad + inner * r[0] - w / 2, pad + inner * r[1] - h / 2, w, h);
  });
  c.globalAlpha = 1;
  return cv.toDataURL('image/png');
}
