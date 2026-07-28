import * as THREE from 'three';
import { SURF } from './surfaces.js';

const ATLAS = 2048;
const TEXELS_PER_METRE = 8;
const PAD = 2;

const OCC_CELL = 0.4;
const OCC_STAMP = 1; // half-width, in cells, of a wall stamped into the grid
const OCC_BLUR = 1;

/**
 * Levels are authored as rectangles: floors, ceilings and wall segments.
 * Everything is merged into a single BufferGeometry with one extra UV set for
 * the light-memory atlas, so the whole station is one draw call.
 */
export class LevelBuilder {
  constructor() {
    this.quads = [];
    this.floors = [];
    this.walls = [];
    this.props = [];
  }

  /** p0..p3 wind counter-clockwise when viewed from the front face. */
  addQuad(p0, p1, p2, p3, normal, surface) {
    this.quads.push({ p: [p0, p1, p2, p3], n: normal, s: surface });
  }

  floor(x0, z0, x1, z1, y, surface = SURF.CONCRETE) {
    const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0];
    const [az, bz] = z0 < z1 ? [z0, z1] : [z1, z0];
    this.addQuad(
      [ax, y, bz], [bx, y, bz], [bx, y, az], [ax, y, az],
      [0, 1, 0], surface
    );
    this.floors.push({ x0: ax, z0: az, x1: bx, z1: bz, y, surface });
  }

  ceiling(x0, z0, x1, z1, y, surface = SURF.CONCRETE) {
    const [ax, bx] = x0 < x1 ? [x0, x1] : [x1, x0];
    const [az, bz] = z0 < z1 ? [z0, z1] : [z1, z0];
    this.addQuad(
      [ax, y, az], [bx, y, az], [bx, y, bz], [ax, y, bz],
      [0, -1, 0], surface
    );
  }

  /**
   * A vertical partition from (x0,z0) to (x1,z1). Emitted as two back-to-back
   * faces so each side keeps its own light memory — otherwise the imprint of
   * one room would bleed through to the next.
   */
  wall(x0, z0, x1, z1, y0, y1, surface = SURF.CONCRETE, opts = {}) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const nx = dz / len;
    const nz = -dx / len;
    const o = 0.02;

    this.addQuad(
      [x0 + nx * o, y0, z0 + nz * o], [x1 + nx * o, y0, z1 + nz * o],
      [x1 + nx * o, y1, z1 + nz * o], [x0 + nx * o, y1, z0 + nz * o],
      [nx, 0, nz], surface
    );
    this.addQuad(
      [x1 - nx * o, y0, z1 - nz * o], [x0 - nx * o, y0, z0 - nz * o],
      [x0 - nx * o, y1, z0 - nz * o], [x1 - nx * o, y1, z1 - nz * o],
      [-nx, 0, -nz], surface
    );

    // Sound goes over a bench and a turnstile stall; it does not go over a
    // partition. Anything under 1.7 m is acoustically transparent by default.
    this.walls.push({
      x0, z0, x1, z1, y0, y1,
      solid: opts.solid !== false,
      blocksSound: opts.blocksSound ?? (y1 - y0 >= 1.7),
    });
  }

  /** A closed rectangular block — pillars, machinery housings, ticket booths. */
  block(cx, cz, w, d, y0, y1, surface = SURF.CONCRETE) {
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const z0 = cz - d / 2, z1 = cz + d / 2;
    this.wall(x0, z0, x1, z0, y0, y1, surface);
    this.wall(x1, z0, x1, z1, y0, y1, surface);
    this.wall(x1, z1, x0, z1, y0, y1, surface);
    this.wall(x0, z1, x0, z0, y0, y1, surface);
    this.floor(x0, z0, x1, z1, y1, surface);
  }

  /** Convenience: a rectangular room with a wall on each named side. */
  room(x0, z0, x1, z1, y, h, floorSurf = SURF.CONCRETE, sides = 'nsew', wallSurf) {
    const ws = wallSurf ?? SURF.TILE;
    this.floor(x0, z0, x1, z1, y, floorSurf);
    this.ceiling(x0, z0, x1, z1, y + h, SURF.CONCRETE);
    if (sides.includes('n')) this.wall(x0, z0, x1, z0, y, y + h, ws);
    if (sides.includes('s')) this.wall(x0, z1, x1, z1, y, y + h, ws);
    if (sides.includes('w')) this.wall(x0, z0, x0, z1, y, y + h, ws);
    if (sides.includes('e')) this.wall(x1, z0, x1, z1, y, y + h, ws);
  }

  // ---------------------------------------------------------------- packing

  _pack() {
    const charts = this.quads.map((q, i) => {
      const [p0, p1, , p3] = q.p;
      const u = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      const v = Math.hypot(p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]);
      return {
        i,
        w: Math.max(2, Math.ceil(u * TEXELS_PER_METRE)) + PAD * 2,
        h: Math.max(2, Math.ceil(v * TEXELS_PER_METRE)) + PAD * 2,
      };
    });

    for (let attempt = 0; attempt < 6; attempt++) {
      const scale = Math.pow(0.72, attempt);
      const items = charts
        .map((c) => ({
          i: c.i,
          w: Math.max(3, Math.round(c.w * scale)),
          h: Math.max(3, Math.round(c.h * scale)),
        }))
        .sort((a, b) => b.h - a.h);

      let shelfY = 0;
      let shelfH = 0;
      let cursorX = 0;
      let ok = true;
      const out = new Array(charts.length);

      for (const it of items) {
        if (it.w > ATLAS) it.w = ATLAS;
        if (cursorX + it.w > ATLAS) {
          shelfY += shelfH;
          shelfH = 0;
          cursorX = 0;
        }
        if (shelfY + it.h > ATLAS) { ok = false; break; }
        out[it.i] = { x: cursorX, y: shelfY, w: it.w, h: it.h };
        cursorX += it.w;
        shelfH = Math.max(shelfH, it.h);
      }
      if (ok) return out;
    }
    throw new Error('lightmap atlas overflow');
  }

  // ------------------------------------------------------------- occlusion

  _occlusion(bounds) {
    const minX = bounds.min.x - 2;
    const minZ = bounds.min.z - 2;
    const sizeX = bounds.max.x - bounds.min.x + 4;
    const sizeZ = bounds.max.z - bounds.min.z + 4;
    const nx = Math.max(8, Math.ceil(sizeX / OCC_CELL));
    const nz = Math.max(8, Math.ceil(sizeZ / OCC_CELL));

    const grid = new Float32Array(nx * nz);
    const stamp = (cx, cz) => {
      for (let dz = -OCC_STAMP; dz <= OCC_STAMP; dz++) {
        for (let dx = -OCC_STAMP; dx <= OCC_STAMP; dx++) {
          const x = cx + dx, z = cz + dz;
          if (x < 0 || z < 0 || x >= nx || z >= nz) continue;
          grid[z * nx + x] = 1;
        }
      }
    };

    for (const w of this.walls) {
      if (!w.blocksSound) continue;
      const len = Math.hypot(w.x1 - w.x0, w.z1 - w.z0);
      const steps = Math.max(2, Math.ceil(len / (OCC_CELL * 0.5)));
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const wx = w.x0 + (w.x1 - w.x0) * t;
        const wz = w.z0 + (w.z1 - w.z0) * t;
        stamp(
          Math.floor((wx - minX) / OCC_CELL),
          Math.floor((wz - minZ) / OCC_CELL)
        );
      }
    }

    // Soften: a coarse ray-march would otherwise step straight over a thin wall.
    let src = grid;
    for (let pass = 0; pass < 2; pass++) {
      const dst = new Float32Array(nx * nz);
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          let sum = 0, n = 0;
          for (let dz = -OCC_BLUR; dz <= OCC_BLUR; dz++) {
            for (let dx = -OCC_BLUR; dx <= OCC_BLUR; dx++) {
              const sx = x + dx, sz = z + dz;
              if (sx < 0 || sz < 0 || sx >= nx || sz >= nz) continue;
              sum += src[sz * nx + sx];
              n++;
            }
          }
          dst[z * nx + x] = sum / n;
        }
      }
      src = dst;
    }

    const bytes = new Uint8Array(nx * nz * 4);
    for (let i = 0; i < nx * nz; i++) {
      const v = Math.min(255, Math.round(Math.max(grid[i], src[i] * 1.35) * 255));
      bytes[i * 4] = v;
      bytes[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(bytes, nx, nz, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;

    return {
      texture: tex,
      min: new THREE.Vector2(minX, minZ),
      size: new THREE.Vector2(nx * OCC_CELL, nz * OCC_CELL),
      // CPU mirror, so the AI hears through the same walls the light stops at.
      sample: (x, z) => {
        const cx = Math.floor((x - minX) / OCC_CELL);
        const cz = Math.floor((z - minZ) / OCC_CELL);
        if (cx < 0 || cz < 0 || cx >= nx || cz >= nz) return 0;
        return src[cz * nx + cx];
      },
    };
  }

  // ------------------------------------------------------------------ build

  build() {
    const n = this.quads.length;
    const pos = new Float32Array(n * 4 * 3);
    const nor = new Float32Array(n * 4 * 3);
    const luv = new Float32Array(n * 4 * 2);
    const srf = new Float32Array(n * 4);
    const idx = new Uint32Array(n * 6);

    const rects = this._pack();
    const bounds = new THREE.Box3();
    const tmp = new THREE.Vector3();

    for (let q = 0; q < n; q++) {
      const quad = this.quads[q];
      const r = rects[q];
      const u0 = (r.x + PAD) / ATLAS;
      const v0 = (r.y + PAD) / ATLAS;
      const u1 = (r.x + r.w - PAD) / ATLAS;
      const v1 = (r.y + r.h - PAD) / ATLAS;
      const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];

      for (let c = 0; c < 4; c++) {
        const b = (q * 4 + c) * 3;
        const p = quad.p[c];
        pos[b] = p[0]; pos[b + 1] = p[1]; pos[b + 2] = p[2];
        nor[b] = quad.n[0]; nor[b + 1] = quad.n[1]; nor[b + 2] = quad.n[2];
        luv[(q * 4 + c) * 2] = uv[c][0];
        luv[(q * 4 + c) * 2 + 1] = uv[c][1];
        srf[q * 4 + c] = quad.s;
        bounds.expandByPoint(tmp.set(p[0], p[1], p[2]));
      }

      const o = q * 4;
      idx[q * 6] = o; idx[q * 6 + 1] = o + 1; idx[q * 6 + 2] = o + 2;
      idx[q * 6 + 3] = o; idx[q * 6 + 4] = o + 2; idx[q * 6 + 5] = o + 3;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('aLightUv', new THREE.BufferAttribute(luv, 2));
    geo.setAttribute('aSurface', new THREE.BufferAttribute(srf, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    return {
      geometry: geo,
      bounds,
      occlusion: this._occlusion(bounds),
      floors: this.floors,
      walls: this.walls,
    };
  }
}
