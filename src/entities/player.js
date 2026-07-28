import * as THREE from 'three';
import { PLAYER, STEP_NOISE, COLOR } from '../core/config.js';
import { SURFACE_ACOUSTICS } from '../world/surfaces.js';

const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(world) {
    this.world = world;
    this.position = new THREE.Vector3(0, 0, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.height = PLAYER.eyeHeight;
    this.crouching = false;
    this.health = PLAYER.maxHealth;
    this.ammo = PLAYER.ammo;
    this.shots = 0;
    this.stones = 6;

    this.strideAccum = 0;
    this.bob = 0;
    this.heartTimer = 1.2;
    this.hurtFlash = 0;
    this.invuln = 0;
    this.dead = false;

    this.stepEcho = 0;    // drives the noise arc in the HUD
    this.lastStepReach = 0;
    this.moveMode = 'walk';
  }

  spawn(x, z, yaw = 0) {
    this.position.set(x, this.world.floorHeight(x, z), z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.dead = false;
    this.health = PLAYER.maxHealth;
    this.ammo = PLAYER.ammo;
    this.stones = 6;
    this.shots = 0;
    this.strideAccum = 0;
  }

  look(dx, dy) {
    if (this.dead) return;
    this.yaw -= dx * 0.0022;
    this.pitch -= dy * 0.0022;
    const lim = Math.PI * 0.49;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  hurt(n, from) {
    if (this.invuln > 0 || this.dead) return;
    this.health -= n;
    this.invuln = 1.1;
    this.hurtFlash = 1;
    this.world.sound.emit('hurt', this.position, { gain: 1, fromPlayer: true });
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.world.onPlayerDeath();
    }
  }

  fire() {
    if (this.dead) return;
    const eye = this.eyePosition();
    if (this.ammo <= 0) {
      this.world.sound.emit('dryfire', eye, { gain: 1, fromPlayer: true });
      return;
    }
    this.ammo--;
    this.shots++;

    // The muzzle is a little in front of your face, so the wavefront does not
    // start inside your own head.
    const dir = this.forward();
    const muzzle = eye.clone().addScaledVector(dir, 0.45);
    this.world.sound.emit('shot', muzzle, { gain: 1, fromPlayer: true });
    this.world.onShotFired(muzzle, dir);
  }

  throwStone() {
    if (this.dead || this.stones <= 0) return;
    this.stones--;
    const dir = this.forward();
    const from = this.eyePosition().addScaledVector(dir, 0.35);
    this.world.throwStone(from, dir);
  }

  forward(out = FORWARD) {
    const cp = Math.cos(this.pitch);
    return out.set(
      Math.sin(this.yaw) * cp * -1,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cp * -1
    ).normalize();
  }

  eyePosition(out = new THREE.Vector3()) {
    return out.set(this.position.x, this.position.y + this.height + this.bob, this.position.z);
  }

  update(dt, input) {
    if (this.dead) {
      this.velocity.multiplyScalar(Math.max(0, 1 - dt * 6));
      return;
    }

    this.invuln = Math.max(0, this.invuln - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2);

    // --- intent --------------------------------------------------------------
    const sneak = input.down('sneak');
    const crouch = input.down('crouch');
    const sprint = input.down('sprint') && !sneak && !crouch;
    this.crouching = crouch;
    this.moveMode = sprint ? 'sprint' : sneak ? 'sneak' : crouch ? 'crouch' : 'walk';

    let speed = PLAYER.speedWalk;
    if (sprint) speed = PLAYER.speedSprint;
    else if (sneak) speed = PLAYER.speedSneak;
    else if (crouch) speed = PLAYER.speedCrouch;

    const wantHeight = crouch ? PLAYER.crouchHeight : PLAYER.eyeHeight;
    this.height += (wantHeight - this.height) * Math.min(1, dt * 9);

    let mx = 0, mz = 0;
    if (input.down('forward')) mz -= 1;
    if (input.down('back')) mz += 1;
    if (input.down('left')) mx -= 1;
    if (input.down('right')) mx += 1;
    const mlen = Math.hypot(mx, mz);
    if (mlen > 0) { mx /= mlen; mz /= mlen; }

    FORWARD.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    RIGHT.crossVectors(FORWARD, UP).normalize().multiplyScalar(-1);

    const wishX = FORWARD.x * -mz + RIGHT.x * mx;
    const wishZ = FORWARD.z * -mz + RIGHT.z * mx;

    // --- integrate -----------------------------------------------------------
    const accel = PLAYER.accel;
    this.velocity.x += (wishX * speed - this.velocity.x) * Math.min(1, accel * dt * (mlen > 0 ? 1 : 0.0));
    this.velocity.z += (wishZ * speed - this.velocity.z) * Math.min(1, accel * dt * (mlen > 0 ? 1 : 0.0));
    if (mlen === 0) {
      const f = Math.max(0, 1 - PLAYER.friction * dt);
      this.velocity.x *= f;
      this.velocity.z *= f;
    }

    const nx = this.position.x + this.velocity.x * dt;
    const nz = this.position.z + this.velocity.z * dt;
    const res = this.world.collide(nx, nz, this.position.x, this.position.z, PLAYER.radius);
    const movedX = res.x - this.position.x;
    const movedZ = res.z - this.position.z;
    this.position.x = res.x;
    this.position.z = res.z;
    this.position.y = this.world.floorHeight(res.x, res.z);

    const travelled = Math.hypot(movedX, movedZ);

    // --- footsteps -----------------------------------------------------------
    // Stride length changes with gait: sneaking places the foot carefully.
    const stride = sprint ? 1.35 : sneak ? 0.95 : crouch ? 0.85 : 1.05;
    this.strideAccum += travelled;
    this.bob = Math.sin(this.strideAccum * (Math.PI / stride)) * (sprint ? 0.055 : sneak ? 0.012 : 0.028);

    if (this.strideAccum >= stride && travelled > 0.0005) {
      this.strideAccum -= stride;
      const surf = this.world.surfaceAt(this.position.x, this.position.z);
      const gain = STEP_NOISE[this.moveMode];
      const loud = this.world.sound.emit('step', this.position, {
        gain,
        surface: surf,
        fromPlayer: true,
      });
      const acou = SURFACE_ACOUSTICS[surf];
      this.stepEcho = Math.min(1, loud / 3.2);
      this.lastStepReach = loud;
      this.lastSurface = acou.name;
    }
    this.stepEcho = Math.max(0, this.stepEcho - dt * 0.55);

    // --- the pulse in your own chest ----------------------------------------
    // Injured, your heartbeat becomes a light source. It shows you the room and
    // it shows the room you.
    if (this.health < PLAYER.maxHealth) {
      const wounded = (PLAYER.maxHealth - this.health) / PLAYER.maxHealth;
      const rate = 1.05 - wounded * 0.45;
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        this.heartTimer = rate;
        this.world.sound.emit('heart', this.eyePosition(), {
          gain: 0.5 + wounded * 0.8,
          fromPlayer: true,
          color: [
            COLOR.STEP[0] * 0.75 + COLOR.ENEMY[0] * 0.25,
            COLOR.STEP[1] * 0.72,
            COLOR.STEP[2] * 0.72,
          ],
          panner: { refDistance: 0.4, rolloff: 0.2 },
        });
      }
    }
  }
}
