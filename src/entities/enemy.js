import * as THREE from 'three';
import { buildBody } from './model.js';
import { createEntityMaterial } from '../render/entityMaterial.js';
import { COLOR, HEARING } from '../core/config.js';

/**
 * They cannot see. Neither can you, but you at least have a torch made of
 * sound. They have four states and a memory, and that is the whole of them.
 *
 *   IDLE   — drifting along a patrol, occasionally breathing
 *   ALERT  — heard something, stopped, turning to face it
 *   SEARCH — walking to where the sound was, sweeping
 *   HUNT   — running at a live target
 *
 * A Sentinel never patrols. It stands in the dark and does not move until it is
 * certain, which makes it the only enemy you can walk straight into.
 */
const TYPES = {
  stalker: {
    speedSearch: 1.5, speedHunt: 3.35, stepInterval: 0.55, breathEvery: [4, 9],
    alertHold: 0.9, patrol: true, damage: 1, reach: 1.25, stepGain: 0.9,
  },
  screamer: {
    speedSearch: 1.8, speedHunt: 3.9, stepInterval: 0.45, breathEvery: [3, 7],
    alertHold: 0.5, patrol: true, damage: 1, reach: 1.15, stepGain: 0.75,
  },
  sentinel: {
    speedSearch: 1.1, speedHunt: 3.0, stepInterval: 0.8, breathEvery: [6, 13],
    alertHold: 2.4, patrol: false, damage: 2, reach: 1.5, stepGain: 1.25,
  },
};

let _uid = 0;

export class Enemy {
  constructor(world, opts) {
    this.id = ++_uid;
    this.world = world;
    this.type = opts.type ?? 'stalker';
    // A level may soften or sharpen an individual creature. PLATFORM's one
    // Stalker is deliberately slow to commit: the first minute has to teach
    // fear, not administer it.
    this.cfg = { caution: 1, ...TYPES[this.type], ...(opts.tune ?? {}) };

    this.material = createEntityMaterial(world.shared, COLOR.ENEMY);
    this.group = buildBody(this.material, this.type);
    this.position = new THREE.Vector3(opts.x, opts.y ?? 0, opts.z);
    this.position.y = world.floorHeight(opts.x, opts.z, opts.y ?? 0);
    this.group.position.copy(this.position);
    world.scene.add(this.group);

    this.route = (opts.route ?? []).map((p) => new THREE.Vector3(p[0], opts.y ?? 0, p[1]));
    this.routeIndex = 0;
    this.facing = opts.facing ?? 0;

    this.state = 'IDLE';
    this.stateTime = 0;
    this.target = new THREE.Vector3().copy(this.position);
    this.confidence = 0;
    this.memory = 0;
    this.stepTimer = Math.random() * 0.5;
    this.breathTimer = 2 + Math.random() * 5;
    this.glow = 0;
    this.walkPhase = Math.random() * 6.28;
    this.alive = true;
    this.attackCooldown = 0;
    this.health = this.type === 'sentinel' ? 2 : 1;
    this._tmp = new THREE.Vector3();
  }

  hear(evt) {
    if (!this.alive) return;
    const d = this.position.distanceTo(evt.position);
    const reach = evt.loudness * HEARING.radiusPerLoudness;
    if (d > reach) return;
    const t = this.world.sound.transmission(this.position, evt.position);
    // Inverse-square, then whatever the walls left of it, then whatever the
    // level itself does to sound. THE DEEP has no walls worth the name.
    const carry = this.world.level?.def.hearing ?? 1;
    const strength = ((evt.loudness / (1 + d * d * 0.03)) * t * carry) / this.cfg.caution;
    if (strength < HEARING.alertThreshold) return;

    this.confidence = Math.min(1.6, this.confidence + strength);
    this.target.copy(evt.position);
    this.memory = HEARING.memory;

    if (this.state === 'IDLE') {
      this.state = 'ALERT';
      this.stateTime = 0;
    } else if (this.state === 'ALERT' && this.stateTime > 0.25) {
      this.state = 'SEARCH';
      this.stateTime = 0;
    }
    if (strength > HEARING.huntThreshold || this.confidence > 1.15) {
      if (this.state !== 'HUNT') this.stateTime = 0;
      this.state = 'HUNT';
      if (this.type === 'screamer' && this.screamCooldown === undefined) this.screamCooldown = 0;
    }
  }

  damage(n, from) {
    this.health -= n;
    if (this.health <= 0) {
      this.alive = false;
      this.world.sound.emit('kill', this.position, { gain: 1 });
      this.world.scene.remove(this.group);
      return true;
    }
    this.state = 'HUNT';
    this.target.copy(from);
    this.confidence = 1.6;
    this.memory = HEARING.memory;
    return false;
  }

  _moveToward(dst, speed, dt) {
    const d = this._tmp.subVectors(dst, this.position);
    d.y = 0;
    const len = d.length();
    if (len < 0.25) return true;
    d.multiplyScalar(1 / len);
    const step = Math.min(speed * dt, len);
    const nx = this.position.x + d.x * step;
    const nz = this.position.z + d.z * step;
    const res = this.world.collide(nx, nz, this.position.x, this.position.z, 0.35);
    this.position.x = res.x;
    this.position.z = res.z;
    this.position.y = this.world.floorHeight(res.x, res.z, this.position.y);
    this.facing = Math.atan2(d.x, d.z);
    this.walkPhase += (step / 0.75) * 6.283;
    return false;
  }

  _footstep(gain) {
    const surf = this.world.surfaceAt(this.position.x, this.position.z);
    this.world.sound.emit('enemyStep', this.position, {
      gain: gain * this.cfg.stepGain,
      surface: surf,
      silentToAI: true,
    });
    this.glow = Math.min(1.6, this.glow + 1.15);
  }

  update(dt, player) {
    if (!this.alive) return;
    this.stateTime += dt;
    this.memory -= dt;
    this.confidence = Math.max(0, this.confidence - dt * 0.16);
    this.attackCooldown -= dt;
    this.glow = Math.max(0, this.glow - dt * 1.6);

    const cfg = this.cfg;
    let moving = false;
    let speed = 0;

    switch (this.state) {
      case 'IDLE': {
        if (cfg.patrol && this.route.length > 0) {
          speed = cfg.speedSearch * 0.55;
          const wp = this.route[this.routeIndex];
          if (this._moveToward(wp, speed, dt)) {
            this.routeIndex = (this.routeIndex + 1) % this.route.length;
          } else moving = true;
        } else {
          // A Sentinel sweeps its head. Silently.
          this.facing += Math.sin(this.stateTime * 0.34) * dt * 0.55;
        }
        break;
      }
      case 'ALERT': {
        const d = this._tmp.subVectors(this.target, this.position);
        const want = Math.atan2(d.x, d.z);
        let diff = want - this.facing;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.facing += diff * Math.min(1, dt * 3.2);
        if (this.stateTime > cfg.alertHold) {
          this.state = this.confidence > 0.28 ? 'SEARCH' : 'IDLE';
          this.stateTime = 0;
        }
        break;
      }
      case 'SEARCH': {
        speed = cfg.speedSearch;
        moving = !this._moveToward(this.target, speed, dt);
        if (!moving || this.memory <= 0) {
          this.state = 'IDLE';
          this.stateTime = 0;
          this.confidence *= 0.4;
        }
        break;
      }
      case 'HUNT': {
        speed = cfg.speedHunt;
        if (this.memory > 0) {
          moving = !this._moveToward(this.target, speed, dt);
        }
        if (this.type === 'screamer') {
          this.screamCooldown = (this.screamCooldown ?? 0) - dt;
          if (this.screamCooldown <= 0) {
            this.screamCooldown = 5.5 + Math.random() * 3;
            this.world.sound.emit('scream', this.position, { gain: 1, silentToAI: true });
            this.glow = 1.6;
            this.world.rallyTo(this.target, this);
          }
        }
        if (this.memory <= 0) {
          this.state = 'SEARCH';
          this.stateTime = 0;
        }
        break;
      }
    }

    // Footsteps. Moving is the only thing that makes them visible.
    if (moving) {
      const interval = cfg.stepInterval * (this.state === 'HUNT' ? 0.62 : 1);
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepTimer = interval;
        this._footstep(this.state === 'HUNT' ? 1.35 : 0.85);
      }
    } else {
      this.walkPhase += dt * 0.6;
    }

    // Breathing. They give themselves away, occasionally, and that is the deal.
    this.breathTimer -= dt;
    if (this.breathTimer <= 0) {
      const [lo, hi] = cfg.breathEvery;
      this.breathTimer = lo + Math.random() * (hi - lo);
      this.world.sound.emit('breath', this._tmp.copy(this.position).setY(this.position.y + 1.6), {
        gain: this.state === 'HUNT' ? 1.25 : 0.8,
        silentToAI: true,
      });
      this.glow = Math.min(1.6, this.glow + 0.7);
    }

    // Contact.
    if (this.attackCooldown <= 0) {
      const d = this.position.distanceTo(player.position);
      if (d < cfg.reach + 0.3) {
        this.attackCooldown = 1.6;
        this.state = 'HUNT';
        this.memory = HEARING.memory;
        this.target.copy(player.position);
        player.hurt(cfg.damage, this.position);
        this.glow = 1.5;
      }
    }

    // ---- presentation -------------------------------------------------------
    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;

    const rig = this.group.userData.rig;
    const sw = moving ? Math.sin(this.walkPhase) : Math.sin(this.walkPhase * 0.7) * 0.06;
    const amp = this.state === 'HUNT' ? 1.15 : 0.65;
    rig.legL.rotation.x = sw * 0.75 * amp;
    rig.legR.rotation.x = -sw * 0.75 * amp;
    rig.armL.rotation.x = -sw * 0.5 * amp - 0.12;
    rig.armR.rotation.x = sw * 0.5 * amp - 0.12;
    // Arms hang nearly straight. The bend is what would make them look human.
    rig.foreL.rotation.x = 0.07 + Math.abs(sw) * 0.14;
    rig.foreR.rotation.x = 0.07 + Math.abs(sw) * 0.14;
    const wantLean = this.state === 'HUNT' ? 0.20 : moving ? 0.09 : 0.03;
    rig.lean.rotation.x += (wantLean - rig.lean.rotation.x) * Math.min(1, dt * 4);
    this.group.position.y += Math.abs(sw) * 0.035 * (moving ? 1 : 0);

    this.material.uniforms.uGlow.value = this.glow;
  }
}
