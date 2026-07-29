import { FEEL, BIOMES, biomeAt, newBiomeSlot } from './feel.js';

/**
 * Persistence and the share poster.
 *
 * The tower IS the game, so it has to survive a reload, a browser restart and a
 * phone that ran out of memory in the background. Corpses are stored as a flat
 * packed array with a schema version — the version is what lets the format
 * change later without silently loading nonsense into a physics engine.
 */

const KEY = 'cairn.v1';
const SCHEMA = 1;
const MAX_STORED = 600;   // beyond this the tower is scenery, not gameplay

export function save(sim) {
  try {
    const solids = sim.world.solids;
    const packed = [];
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!s.corpse) continue;
      packed.push(
        Math.round(s.x * 100) / 100,
        Math.round(s.y * 100) / 100,
        Math.round(s.rot * 1000) / 1000,
        s.pose,
      );
    }
    const trim = packed.length > MAX_STORED * 4 ? packed.slice(packed.length - MAX_STORED * 4) : packed;
    localStorage.setItem(KEY, JSON.stringify({
      v: SCHEMA,
      seed: sim.world.seed,
      best: Math.round(sim.best * 100) / 100,
      deaths: sim.deaths,
      corpses: trim,
    }));
  } catch { /* private mode, quota, whatever — the game still plays */ }
}

export function load(sim) {
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { return false; }
  if (!raw) return false;
  let d;
  try { d = JSON.parse(raw); } catch { return false; }
  if (!d || d.v !== SCHEMA || !Array.isArray(d.corpses)) return false;

  sim.best = +d.best || 0;
  sim.deaths = d.deaths | 0;
  const c = d.corpses;
  for (let i = 0; i + 3 < c.length; i += 4) {
    sim.world.corpse(c[i], c[i + 1], c[i + 2], c[i + 3] | 0, 0);
  }
  // Everything loaded is history: nothing should glow as if it just happened.
  for (const s of sim.world.solids) if (s.corpse) s.glow = 0;
  sim.world.generate(Math.max(sim.best, 0) + FEEL.camera.viewH * 2.2);
  return true;
}

export function wipe() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to do */ }
}

// ------------------------------------------------------------------- poster

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rgb = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/**
 * Render the whole tower as a tall poster. This image is the game's marketing —
 * it is the thing a player posts — so it gets the full biome gradient, the
 * thread of light through every death in order, and the wordmark.
 */
export function poster(sim, W = 1080, H = 1920) {
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  const top = Math.max(sim.best, 60) * 1.06;
  const toY = (wy) => H - (wy / top) * H * 0.88 - H * 0.06;
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

/** Web Share where it exists, clipboard then download where it does not. */
export async function share(sim) {
  const cv = poster(sim);
  const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
  if (!blob) return 'failed';
  const file = new File([blob], 'cairn.png', { type: 'image/png' });
  const text = `${Math.round(sim.best)}m — ${sim.deaths} stones below. CAIRN`;

  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return 'shared'; } catch { /* cancelled */ }
  }
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      return 'copied';
    }
  } catch { /* fall through to download */ }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'cairn.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}

/**
 * The app icon, drawn rather than shipped: three stacked stones on black, with
 * a maskable safe zone. Generated at boot and injected as a data URL so the
 * manifest needs no binary asset in the repository.
 */
export function icon(size = 512, maskable = false) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const c = cv.getContext('2d');
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
