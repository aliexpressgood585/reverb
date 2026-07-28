/**
 * A navigation grid, baked from the same floors and walls the collision pass
 * uses, so the creatures walk the world the physics believes in rather than a
 * second, hand-authored one.
 *
 * Before this existed an enemy walked at the last sound in a straight line and
 * slid along whatever it hit. In THE DEEP that is indistinguishable from being
 * clever, because there is nothing in the way. In MAINTENANCE it meant a
 * Stalker could hear you two metres away through a plant-room wall and spend
 * the rest of the level grinding against it — the sound went round the corner
 * and the creature did not.
 *
 * Three deliberate choices:
 *
 * 1. **Cells are 0.25 m and blocking is generous, not conservative.** A cell is
 *    only hard-blocked when it is within 0.22 m of a partition, which is closer
 *    than a body actually fits. That is on purpose: TURNSTILES has gaps of
 *    0.775 m between a stall and a full-height divider, and a grid eroded by
 *    the true 0.35 m body radius would declare the whole hall impassable and
 *    quietly make the level worse. The path may hug a wall; the collision slide
 *    that was already there handles the last few centimetres.
 *
 * 2. **Tightness is a cost, not a wall.** Cells closer than 0.6 m to something
 *    solid cost up to 2× to cross, so a creature takes the middle of a corridor
 *    when there is a middle to take and squeezes through the gate when there is
 *    not.
 *
 * 3. **A clear straight line skips the search entirely.** Most requests in an
 *    open level are answered by one line-of-walk test, which is what keeps six
 *    creatures re-pathing twice a second from costing anything in THE DEEP.
 *
 * No allocation happens after the bake: the search arrays, the heap and the
 * scratch path are all owned by the grid, and callers hand in their own output
 * buffers.
 */

const CELL = 0.25;
const MARGIN = 1.0;

// Closer than this to a partition and nothing can stand here at all.
const BLOCK_DIST = 0.22;
// Below this much clearance a cell is passable but unattractive.
const SHY_DIST = 0.60;
const SHY_COST = 1.6;

const MAX_EXPAND = 9000;
// How far ahead the string-pull looks when straightening a path. Bounded so a
// two-hundred-cell path across THE DEEP cannot turn into a quadratic sweep.
const PULL_WINDOW = 14;

const SQRT2 = Math.SQRT2;

function distPointSeg(px, pz, x0, z0, x1, z1) {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - x0) * dx + (pz - z0) * dz) / l2 : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(px - (x0 + dx * t), pz - (z0 + dz * t));
}

export class NavGrid {
  constructor(minX, minZ, nx, nz, open, cost) {
    this.minX = minX;
    this.minZ = minZ;
    this.nx = nx;
    this.nz = nz;
    this.cell = CELL;
    this.open = open;
    this.cost = cost;

    const n = nx * nz;
    this._g = new Float32Array(n);
    this._f = new Float32Array(n);
    this._prev = new Int32Array(n);
    this._seen = new Int32Array(n); // generation stamp; everything else is stale
    this._state = new Uint8Array(n); // 1 = queued, 2 = expanded
    this._heap = new Int32Array(n + 1);
    this._chain = new Int32Array(n);
    this._heapN = 0;
    this._gen = 0;
    this.searches = 0; // measured by scripts/nav-check.mjs
  }

  // ------------------------------------------------------------------ queries

  cellAt(x, z) {
    const cx = Math.floor((x - this.minX) / CELL);
    const cz = Math.floor((z - this.minZ) / CELL);
    if (cx < 0 || cz < 0 || cx >= this.nx || cz >= this.nz) return -1;
    return cz * this.nx + cx;
  }

  openAt(x, z) {
    const i = this.cellAt(x, z);
    return i >= 0 && this.open[i] === 1;
  }

  centreX(i) { return this.minX + ((i % this.nx) + 0.5) * CELL; }
  centreZ(i) { return this.minZ + (((i / this.nx) | 0) + 0.5) * CELL; }

  /** Is there an unobstructed walk between two points? */
  clearLine(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / (CELL * 0.7)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.openAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  /** The nearest standable cell, for points that land inside geometry. */
  snap(x, z) {
    const here = this.cellAt(x, z);
    if (here >= 0 && this.open[here] === 1) return here;
    const cx = Math.floor((x - this.minX) / CELL);
    const cz = Math.floor((z - this.minZ) / CELL);
    for (let r = 1; r <= 10; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const sx = cx + dx, sz = cz + dz;
          if (sx < 0 || sz < 0 || sx >= this.nx || sz >= this.nz) continue;
          const i = sz * this.nx + sx;
          if (this.open[i] !== 1) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) { bestD = d; best = i; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /**
   * Connected components, flood-filled once on demand. Nothing in the game
   * loop needs this — `scripts/nav-check.mjs` does, to prove that every patrol
   * route and every creature-to-player walk in all five levels actually exists
   * rather than merely looking plausible.
   */
  labels() {
    if (this._labels) return this._labels;
    const { nx, nz, open } = this;
    const lab = new Int32Array(nx * nz).fill(-1);
    const queue = new Int32Array(nx * nz);
    let next = 0;
    for (let s = 0; s < lab.length; s++) {
      if (open[s] !== 1 || lab[s] !== -1) continue;
      const id = next++;
      let head = 0, tail = 0;
      queue[tail++] = s;
      lab[s] = id;
      while (head < tail) {
        const cur = queue[head++];
        const cxi = cur % nx;
        const czi = (cur / nx) | 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dz === 0) continue;
            const sx = cxi + dx, sz = czi + dz;
            if (sx < 0 || sz < 0 || sx >= nx || sz >= nz) continue;
            const ni = sz * nx + sx;
            if (open[ni] !== 1 || lab[ni] !== -1) continue;
            if (dx !== 0 && dz !== 0 &&
                (open[czi * nx + sx] !== 1 || open[sz * nx + cxi] !== 1)) continue;
            lab[ni] = id;
            queue[tail++] = ni;
          }
        }
      }
    }
    this._labels = lab;
    this.componentCount = next;
    return lab;
  }

  componentAt(x, z) {
    const i = this.snap(x, z);
    return i < 0 ? -1 : this.labels()[i];
  }

  /** Can something walk from a to b at all, however long the way round? */
  reachable(ax, az, bx, bz) {
    const a = this.componentAt(ax, az);
    return a >= 0 && a === this.componentAt(bx, bz);
  }

  // --------------------------------------------------------------------- heap

  _hpush(i) {
    const h = this._heap, f = this._f;
    let k = this._heapN++;
    h[k] = i;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (f[h[p]] <= f[h[k]]) break;
      const t = h[p]; h[p] = h[k]; h[k] = t;
      k = p;
    }
  }

  _hpop() {
    const h = this._heap, f = this._f;
    const top = h[0];
    const last = --this._heapN;
    if (last > 0) {
      h[0] = h[last];
      let k = 0;
      for (;;) {
        const l = k * 2 + 1, r = l + 1;
        let m = k;
        if (l < last && f[h[l]] < f[h[m]]) m = l;
        if (r < last && f[h[r]] < f[h[m]]) m = r;
        if (m === k) break;
        const t = h[m]; h[m] = h[k]; h[k] = t;
        k = m;
      }
    }
    return top;
  }

  // --------------------------------------------------------------------- path

  /**
   * Waypoints from (ax,az) to (bx,bz), written into the caller's buffers.
   * Returns how many were written — 0 means "no route, do whatever you did
   * before". The start point is never emitted; the destination is emitted last
   * whenever it can actually be walked to.
   *
   * If the destination is unreachable the closest approach is returned instead,
   * because a creature that walks as near as the walls allow and then gives up
   * reads as a creature, and one that stops dead reads as a bug.
   */
  path(ax, az, bx, bz, outX, outZ, maxOut) {
    if (this.clearLine(ax, az, bx, bz)) {
      outX[0] = bx; outZ[0] = bz;
      return 1;
    }

    const start = this.snap(ax, az);
    let goal = this.snap(bx, bz);
    if (start < 0 || goal < 0) return 0;
    if (start === goal) {
      outX[0] = bx; outZ[0] = bz;
      return 1;
    }

    this.searches++;
    const gen = ++this._gen;
    const { nx, nz, open, cost, _g: g, _f: f, _prev: prev, _seen: seen, _state: state } = this;
    this._heapN = 0;

    const gx = goal % nx, gz = (goal / nx) | 0;
    const h = (i) => {
      const dx = Math.abs((i % nx) - gx);
      const dz = Math.abs(((i / nx) | 0) - gz);
      const lo = Math.min(dx, dz);
      return (dx + dz - 2 * lo + SQRT2 * lo) * 1.001;
    };

    g[start] = 0;
    f[start] = h(start);
    prev[start] = -1;
    seen[start] = gen;
    state[start] = 1;
    this._hpush(start);

    let found = false;
    let best = start;
    let bestH = h(start);
    let expanded = 0;

    while (this._heapN > 0 && expanded < MAX_EXPAND) {
      const cur = this._hpop();
      if (state[cur] === 2) continue;
      state[cur] = 2;
      expanded++;
      if (cur === goal) { found = true; break; }

      const cxi = cur % nx;
      const czi = (cur / nx) | 0;
      const hc = h(cur);
      if (hc < bestH) { bestH = hc; best = cur; }

      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const sx = cxi + dx, sz = czi + dz;
          if (sx < 0 || sz < 0 || sx >= nx || sz >= nz) continue;
          const ni = sz * nx + sx;
          if (open[ni] !== 1) continue;
          if (dx !== 0 && dz !== 0) {
            // No cutting a corner a body could not cut.
            if (open[czi * nx + sx] !== 1 || open[sz * nx + cxi] !== 1) continue;
          }
          const step = (dx !== 0 && dz !== 0 ? SQRT2 : 1) * cost[ni];
          const ng = g[cur] + step;
          if (seen[ni] === gen) {
            if (state[ni] === 2 || ng >= g[ni]) continue;
          } else {
            seen[ni] = gen;
          }
          g[ni] = ng;
          f[ni] = ng + h(ni);
          prev[ni] = cur;
          state[ni] = 1;
          this._hpush(ni);
        }
      }
    }

    if (!found) goal = best;
    if (goal === start) return 0;

    // Walk the parent chain back to the start, then straighten it.
    const chain = this._chain;
    let m = 0;
    for (let c = goal; c !== -1 && m < chain.length; c = prev[c]) chain[m++] = c;

    let count = 0;
    let curX = ax, curZ = az;
    let i = m - 1;
    while (i > 0 && count < maxOut) {
      const lim = Math.max(0, i - 1 - PULL_WINDOW);
      let pick = i - 1;
      for (let j = lim; j < i; j++) {
        const c = chain[j];
        if (this.clearLine(curX, curZ, this.centreX(c), this.centreZ(c))) { pick = j; break; }
      }
      const c = chain[pick];
      curX = this.centreX(c);
      curZ = this.centreZ(c);
      outX[count] = curX;
      outZ[count] = curZ;
      count++;
      i = pick;
    }

    // Land on the real destination rather than the centre of its cell, so
    // "arrived" keeps meaning what it meant before there was a grid.
    if (found && count > 0 && count < maxOut && this.clearLine(curX, curZ, bx, bz)) {
      outX[count] = bx;
      outZ[count] = bz;
      count++;
    }
    return count;
  }
}

/**
 * Bake a grid from a built level. `walls` is filtered by exactly the predicate
 * `Game.collide` uses, so anything a creature can step over — a bench, a
 * sleeper, the lip of the track bed — is invisible here too.
 */
export function buildNav(bounds, floors, walls, solids = []) {
  const minX = bounds.min.x - MARGIN;
  const minZ = bounds.min.z - MARGIN;
  const nx = Math.max(8, Math.ceil((bounds.max.x - bounds.min.x + MARGIN * 2) / CELL));
  const nz = Math.max(8, Math.ceil((bounds.max.z - bounds.min.z + MARGIN * 2) / CELL));
  const n = nx * nz;

  const open = new Uint8Array(n);
  const cost = new Float32Array(n).fill(1);

  // 1. Anywhere there is ground to stand on. The lids of closed blocks are
  //    floors to the renderer and to a bouncing stone, but not to a body.
  for (const f of floors) {
    if (f.nav === false) continue;
    const c0x = Math.max(0, Math.floor((f.x0 - minX) / CELL));
    const c1x = Math.min(nx - 1, Math.ceil((f.x1 - minX) / CELL));
    const c0z = Math.max(0, Math.floor((f.z0 - minZ) / CELL));
    const c1z = Math.min(nz - 1, Math.ceil((f.z1 - minZ) / CELL));
    for (let cz = c0z; cz <= c1z; cz++) {
      const wz = minZ + (cz + 0.5) * CELL;
      if (wz < f.z0 || wz > f.z1) continue;
      for (let cx = c0x; cx <= c1x; cx++) {
        const wx = minX + (cx + 0.5) * CELL;
        if (wx < f.x0 || wx > f.x1) continue;
        open[cz * nx + cx] = 1;
      }
    }
  }

  // 2. Nothing is ground where something solid is standing on it.
  for (const s of solids) {
    const c0x = Math.max(0, Math.floor((s.x0 - minX) / CELL));
    const c1x = Math.min(nx - 1, Math.ceil((s.x1 - minX) / CELL));
    const c0z = Math.max(0, Math.floor((s.z0 - minZ) / CELL));
    const c1z = Math.min(nz - 1, Math.ceil((s.z1 - minZ) / CELL));
    for (let cz = c0z; cz <= c1z; cz++) {
      const wz = minZ + (cz + 0.5) * CELL;
      if (wz < s.z0 || wz > s.z1) continue;
      for (let cx = c0x; cx <= c1x; cx++) {
        const wx = minX + (cx + 0.5) * CELL;
        if (wx < s.x0 || wx > s.x1) continue;
        open[cz * nx + cx] = 0;
      }
    }
  }

  // 3. How much room each cell has. Only stamped near a partition; everything
  //    else keeps the default of "plenty".
  const REACH = SHY_DIST + CELL;
  const clearance = new Float32Array(n).fill(REACH);
  for (const w of walls) {
    if (!w.solid) continue;
    if (w.y1 <= 0.45 || w.y0 >= 1.6) continue;
    const c0x = Math.max(0, Math.floor((Math.min(w.x0, w.x1) - REACH - minX) / CELL));
    const c1x = Math.min(nx - 1, Math.ceil((Math.max(w.x0, w.x1) + REACH - minX) / CELL));
    const c0z = Math.max(0, Math.floor((Math.min(w.z0, w.z1) - REACH - minZ) / CELL));
    const c1z = Math.min(nz - 1, Math.ceil((Math.max(w.z0, w.z1) + REACH - minZ) / CELL));
    for (let cz = c0z; cz <= c1z; cz++) {
      const wz = minZ + (cz + 0.5) * CELL;
      for (let cx = c0x; cx <= c1x; cx++) {
        const i = cz * nx + cx;
        if (open[i] !== 1) continue;
        const d = distPointSeg(minX + (cx + 0.5) * CELL, wz, w.x0, w.z0, w.x1, w.z1);
        if (d < clearance[i]) clearance[i] = d;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    if (open[i] !== 1) continue;
    const c = clearance[i];
    if (c < BLOCK_DIST) { open[i] = 0; continue; }
    if (c < SHY_DIST) cost[i] = 1 + ((SHY_DIST - c) / SHY_DIST) * SHY_COST;
  }

  return new NavGrid(minX, minZ, nx, nz, open, cost);
}
