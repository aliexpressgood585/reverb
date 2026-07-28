/**
 * The navigation grid, measured.
 *
 *   node scripts/nav-check.mjs
 *
 * Runs the real level builder in plain Node — no browser, no GPU — and asks the
 * grid the only questions that matter:
 *
 *   1. Does every patrol route exist? A creature whose next waypoint is in
 *      another component of the walkable set will press into a wall forever,
 *      which is the exact bug the grid was built to remove.
 *   2. Can every creature reach the player's spawn, and the player's spawn the
 *      exit? If a partition is eroded too aggressively the grid silently seals
 *      a level and the game gets *easier*, quietly.
 *   3. Is the search cheap enough to run twice a second per creature?
 *
 * It fails non-zero on any unreachable pair, so tightening the clearance
 * constants cannot quietly wall off a level again.
 */
import * as THREE from 'three';
import { LevelBuilder } from '../src/world/builder.js';
import { LEVELS } from '../src/world/levels.js';

const problems = [];
const wx = new Float32Array(32);
const wz = new Float32Array(32);

const fmt = (p) => `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`;

for (const def of LEVELS) {
  const b = new LevelBuilder();
  def.build(b);
  const t0 = performance.now();
  const built = b.build();
  const bakeMs = performance.now() - t0;
  const nav = built.nav;

  let openCells = 0;
  for (let i = 0; i < nav.open.length; i++) if (nav.open[i] === 1) openCells++;
  const lab = nav.labels();
  const sizes = new Int32Array(nav.componentCount);
  for (let i = 0; i < lab.length; i++) if (lab[i] >= 0) sizes[lab[i]]++;
  const biggest = sizes.length ? Math.max(...sizes) : 0;

  console.log(
    `\n${def.name}  grid ${nav.nx}×${nav.nz} @ ${nav.cell}m  ` +
    `${openCells} walkable cells (${(openCells * nav.cell * nav.cell).toFixed(0)} m²)  ` +
    `${nav.componentCount} component${nav.componentCount === 1 ? '' : 's'}, ` +
    `largest holds ${((biggest / openCells) * 100).toFixed(1)}%  ` +
    `bake ${bakeMs.toFixed(0)}ms`
  );
  // Stray islands are how a level silently stops being one place. One
  // component holding essentially everything is the shape we want.
  if (biggest / openCells < 0.98) {
    problems.push(`${def.name}: walkable set is fragmented — largest component is only ${((biggest / openCells) * 100).toFixed(1)}%`);
  }

  const check = (what, a, bpt) => {
    if (nav.reachable(a.x, a.z, bpt.x, bpt.z)) return true;
    problems.push(`${def.name}: ${what} — ${fmt(a)} cannot reach ${fmt(bpt)}`);
    return false;
  };

  const spawn = { x: def.spawn.x, z: def.spawn.z };
  const exit = { x: def.exit.x, z: def.exit.z };

  if (nav.componentAt(spawn.x, spawn.z) < 0) problems.push(`${def.name}: spawn is off the grid`);
  check('spawn → exit', spawn, exit);

  for (const e of def.enemies) {
    const at = { x: e.x, z: e.z };
    if (nav.componentAt(at.x, at.z) < 0) {
      problems.push(`${def.name}: ${e.type} at ${fmt(at)} stands on no walkable cell`);
      continue;
    }
    // A creature has to be able to come when it hears you. That is the game.
    check(`${e.type} → player spawn`, at, spawn);
    let prev = at;
    for (const [rx, rz] of e.route ?? []) {
      const wp = { x: rx, z: rz };
      if (check(`${e.type} patrol leg`, prev, wp)) prev = wp;
    }
  }

  // A checkpoint you can walk past is not a checkpoint. Delete the disc from
  // the walkable set and ask whether the exit is still reachable: if it is,
  // there is a route that skips the mark and a player can lose the whole level
  // to a death they had already earned their way past.
  const cp = def.checkpoint;
  if (cp) {
    const open2 = Uint8Array.from(nav.open);
    let band = 0;
    for (let cz = 0; cz < nav.nz; cz++) {
      for (let cx = 0; cx < nav.nx; cx++) {
        const i = cz * nav.nx + cx;
        if (open2[i] !== 1) continue;
        const x = nav.centreX(i), z = nav.centreZ(i);
        if (x >= cp.x0 && x <= cp.x1 && z >= cp.z0 && z <= cp.z1) { open2[i] = 0; band++; }
      }
    }
    if (band === 0) problems.push(`${def.name}: the checkpoint band covers no standable ground`);
    const seen = new Uint8Array(open2.length);
    const stack = [nav.snap(spawn.x, spawn.z)];
    seen[stack[0]] = 1;
    let bypass = false;
    const goal = nav.snap(exit.x, exit.z);
    while (stack.length) {
      const cur = stack.pop();
      if (cur === goal) { bypass = true; break; }
      const cxi = cur % nav.nx, czi = (cur / nav.nx) | 0;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const sx = cxi + dx, sz = czi + dz;
          if (sx < 0 || sz < 0 || sx >= nav.nx || sz >= nav.nz) continue;
          const ni = sz * nav.nx + sx;
          if (open2[ni] !== 1 || seen[ni]) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    console.log(
      `  checkpoint band x ${cp.x0}..${cp.x1}, z ${cp.z0}..${cp.z1} — ${band} cells of ground — ` +
      `${bypass ? 'CAN BE WALKED PAST' : 'unavoidable on the way to the exit'}`
    );
    if (bypass) problems.push(`${def.name}: the exit can be reached without crossing the checkpoint`);
  }

  // Cost: the worst honest request in this level, corner to opposite corner.
  const corners = [
    { x: built.bounds.min.x + 1, z: built.bounds.min.z + 1 },
    { x: built.bounds.max.x - 1, z: built.bounds.max.z - 1 },
    { x: built.bounds.min.x + 1, z: built.bounds.max.z - 1 },
    { x: built.bounds.max.x - 1, z: built.bounds.min.z + 1 },
  ];
  const before = nav.searches;
  const t1 = performance.now();
  let runs = 0;
  let longest = 0;
  for (let r = 0; r < 25; r++) {
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i];
      const c = corners[(i + 1) % corners.length];
      longest = Math.max(longest, nav.path(a.x, a.z, c.x, c.z, wx, wz, 32));
      runs++;
    }
  }
  const per = (performance.now() - t1) / runs;
  console.log(
    `  ${runs} corner-to-corner plans, ${nav.searches - before} needed a search, ` +
    `${per.toFixed(2)}ms each, longest ${longest} waypoints`
  );
  if (per > 8) problems.push(`${def.name}: pathfinding costs ${per.toFixed(1)}ms per plan`);
}

if (problems.length) {
  console.log('\nPROBLEMS:');
  for (const p of problems) console.log(' -', p);
  process.exit(1);
}
console.log('\nnav: clean');
