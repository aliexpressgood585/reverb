import * as THREE from 'three';

/**
 * The bodies.
 *
 * Built from boxes and nothing else. The proportions are deliberately wrong —
 * too tall, arms past the knee, a neck that goes on for a foot and a half. They
 * are not zombies and they are not soldiers; they read as *almost* a person,
 * which is worse.
 */
function part(parent, mat, w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, -h / 2, 0); // pivot at the top, so limbs hang and swing
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

const PROFILE = {
  stalker: { scale: 1.0, torso: 0.92, arm: 1.16, head: 0.17, neck: 0.34, shoulder: 0.40 },
  screamer: { scale: 0.94, torso: 0.80, arm: 1.02, head: 0.27, neck: 0.46, shoulder: 0.30 },
  sentinel: { scale: 1.16, torso: 1.05, arm: 1.30, head: 0.14, neck: 0.28, shoulder: 0.52 },
};

export function buildBody(material, type = 'stalker') {
  const p = PROFILE[type] ?? PROFILE.stalker;
  const root = new THREE.Group();
  const s = p.scale;

  const hipY = 1.02 * s;

  // legs — thin, slightly too long
  const legL = part(root, material, 0.085 * s, 1.0 * s, 0.085 * s, -0.13 * s, hipY, 0);
  const legR = part(root, material, 0.085 * s, 1.0 * s, 0.085 * s, 0.13 * s, hipY, 0);
  part(legL, material, 0.10 * s, 0.075 * s, 0.22 * s, 0, -1.0 * s + 0.075 * s, 0.05 * s);
  part(legR, material, 0.10 * s, 0.075 * s, 0.22 * s, 0, -1.0 * s + 0.075 * s, 0.05 * s);

  // pelvis + torso
  part(root, material, 0.30 * s, 0.16 * s, 0.17 * s, 0, hipY + 0.16 * s, 0);
  const chestTop = hipY + p.torso * s;
  part(root, material, p.shoulder * s, p.torso * s, 0.18 * s, 0, chestTop, 0);

  // neck + head
  part(root, material, 0.055 * s, p.neck * s, 0.055 * s, 0, chestTop + p.neck * s, 0);
  const headY = chestTop + p.neck * s + p.head * s;
  part(root, material, p.head * s * 0.78, p.head * s, p.head * s * 0.9, 0, headY, 0);

  // arms — one hinge at the shoulder, one at the elbow, both far too long
  const armL = part(root, material, 0.07 * s, p.arm * 0.58 * s, 0.07 * s,
    -p.shoulder * 0.5 * s - 0.035 * s, chestTop - 0.06 * s, 0);
  const armR = part(root, material, 0.07 * s, p.arm * 0.58 * s, 0.07 * s,
    p.shoulder * 0.5 * s + 0.035 * s, chestTop - 0.06 * s, 0);
  const foreL = part(armL, material, 0.058 * s, p.arm * 0.62 * s, 0.058 * s, 0, -p.arm * 0.58 * s, 0);
  const foreR = part(armR, material, 0.058 * s, p.arm * 0.62 * s, 0.058 * s, 0, -p.arm * 0.58 * s, 0);

  if (type === 'screamer') {
    // the jaw
    part(root, material, p.head * s * 0.66, p.head * s * 0.62, p.head * s * 0.5,
      0, headY - p.head * s * 0.72, p.head * s * 0.36);
  }
  if (type === 'sentinel') {
    // listening apparatus: two flat plates canted off the skull
    const earL = part(root, material, 0.02 * s, 0.30 * s, 0.24 * s, -0.13 * s, headY + 0.06 * s, 0);
    const earR = part(root, material, 0.02 * s, 0.30 * s, 0.24 * s, 0.13 * s, headY + 0.06 * s, 0);
    earL.rotation.z = 0.45;
    earR.rotation.z = -0.45;
  }

  root.userData.rig = { legL, legR, armL, armR, foreL, foreR, height: headY + p.head * s };
  return root;
}

/** The stone you throw. Small, dull, and the most important object in the game. */
export function buildStone(material) {
  const g = new THREE.IcosahedronGeometry(0.075, 0);
  const m = new THREE.Mesh(g, material);
  return m;
}
