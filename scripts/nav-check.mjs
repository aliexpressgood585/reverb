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
