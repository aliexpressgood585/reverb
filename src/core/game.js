import * as THREE from 'three';
import { PulseField } from '../render/pulses.js';
import { LightMemory } from '../render/memory.js';
import { createComposer } from '../render/post.js';
import { createWorldMaterial, createImprintMaterial } from '../render/worldMaterial.js';
import { createEntityMaterial } from '../render/entityMaterial.js';
import { LevelBuilder } from '../world/builder.js';
import { LEVELS } from '../world/levels.js';
import { SURF } from '../world/surfaces.js';
import { SoundWorld } from '../audio/sound.js';
import { Player } from '../entities/player.js';
import { Enemy } from '../entities/enemy.js';
import { buildStone } from '../entities/model.js';
import { COLOR, GRADE_TARGETS } from './config.js';
import { Hud } from '../ui/hud.js';
import { Screens } from '../ui/screens.js';

const CLEAR = new THREE.Color(0x000000);

export class Game {
  constructor(canvas, input) {
    this.canvas = canvas;
    this.input = input;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setClearColor(CLEAR, 1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.autoClear = true;

    this.scene = new THREE.Scene();
    this.scene.background = CLEAR;
    this.camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.06, 260);

    this.pulses = new PulseField();
    this.shared = {
      pulseUniforms: this.pulses.uniforms,
      occUniforms: {
        uOccTex: { value: this._blankOcc() },
        uOccMin: { value: new THREE.Vector2() },
        uOccSize: { value: new THREE.Vector2(1, 1) },
      },
      eye: { value: new THREE.Vector3() },
      time: { value: 0 },
      memory: { value: null },
    };

    this.worldMaterial = createWorldMaterial(this.shared);
    this.imprintMaterial = createImprintMaterial(this.shared);
    const q = new URLSearchParams(location.search);
    this.quality = {
      lightmap: Math.max(256, Math.min(4096, +q.get('lm') || 2048)),
      msaa: q.get('msaa') !== null ? +q.get('msaa') : 4,
    };
    this.memory = new LightMemory(this.renderer, this.quality.lightmap);
    this.shared.memory.value = this.memory.texture;

    const post = createComposer(this.renderer, this.scene, this.camera, this.quality);
    this.composer = post.composer;
    this.bloom = post.bloom;
    this.finalPass = post.final;

    this.sound = new SoundWorld(this.pulses);
    this.sound.onSound((e) => this._dispatchSound(e));

    this.player = new Player(this);
    this.enemies = [];
    this.stones = [];
    this.stoneMaterial = createEntityMaterial(this.shared, COLOR.STONE);

    this.hud = new Hud();
    this.screens = new Screens();

    this.state = 'title';
    this.levelIndex = 0;
    this.level = null;
    this.mesh = null;
    this.clock = new THREE.Clock();
    this.elapsed = 0;
    this.levelTime = 0;
    this.fade = 0;
    this.fadeTarget = 0;
    this.photoMode = false;
    this._tmpA = new THREE.Vector3();
    this._tmpB = new THREE.Vector3();
    this._pendingCapture = null;

    addEventListener('resize', () => this._resize());
    this.screens.showTitle();
  }

  _blankOcc() {
    const d = new Uint8Array(4);
    const t = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true;
    return t;
  }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.finalPass.uniforms.uResolution.value.set(w, h);
    this.hud.resize();
  }

  // ------------------------------------------------------------------ levels

  loadLevel(i) {
    this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, i));
    const def = LEVELS[this.levelIndex];

    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    for (const e of this.enemies) this.scene.remove(e.group);
    for (const s of this.stones) this.scene.remove(s.mesh);
    this.enemies.length = 0;
    this.stones.length = 0;
    this.pulses.clear();

    const b = new LevelBuilder();
    def.build(b);
    const built = b.build();

    this.mesh = new THREE.Mesh(built.geometry, this.worldMaterial);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.memory.setLevel(built.geometry, this.imprintMaterial);

    this.shared.occUniforms.uOccTex.value = built.occlusion.texture;
    this.shared.occUniforms.uOccMin.value.copy(built.occlusion.min);
    this.shared.occUniforms.uOccSize.value.copy(built.occlusion.size);

    this.level = { def, ...built };
    this.sound.setLevel(this.level);
    this.sound.resetScore();
    this.sound.engine.setSpace(def.space);

    for (const e of def.enemies) {
      this.enemies.push(new Enemy(this, e));
    }

    // `first` lets a level place its opening drip precisely. The first sound a
    // player ever hears is the one that teaches them the whole game, so on
    // PLATFORM it is not left to a random number.
    this.dripTimers = def.drips.map(
      (d) => d.first ?? d.every[0] + Math.random() * (d.every[1] - d.every[0])
    );
    this.machinePhase = def.machines.map((m) => m.phase);
    this.trainTimer = def.trains
      ? def.trains.every[0] * 0.5 + Math.random() * def.trains.every[0]
      : Infinity;

    this.player.spawn(def.spawn.x, def.spawn.z, def.spawn.yaw);
    this.levelTime = 0;
    this.settleTimer = 4 + Math.random() * 4;
    this.humTimer = 1.5 + Math.random() * 2.5;
    this.triggerState = (def.triggers ?? []).map(() => ({ inside: false, firedAt: -99 }));

    this.state = 'intro';
    this.introTime = 0;
    this.screens.showLevelIntro(def);
  }

  /** Begin a fresh run from the first level. */
  startRun() {
    this.sound.init();
    this.loadLevel(0);
  }

  // -------------------------------------------------------------- world query

  floorHeight(x, z, curY = 1e9) {
    const floors = this.level ? this.level.floors : null;
    if (!floors) return 0;
    let best = -1e9;
    let lowest = 1e9;
    for (let i = 0; i < floors.length; i++) {
      const f = floors[i];
      if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
      if (f.y < lowest) lowest = f.y;
      if (f.y <= curY + 0.7 && f.y > best) best = f.y;
    }
    if (best > -1e8) return best;
    return lowest < 1e8 ? lowest : 0;
  }

  surfaceAt(x, z) {
    const floors = this.level ? this.level.floors : null;
    if (!floors) return SURF.CONCRETE;
    let best = -1e9;
    let surf = SURF.CONCRETE;
    for (let i = 0; i < floors.length; i++) {
      const f = floors[i];
      if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
      if (f.y > best) { best = f.y; surf = f.surface; }
    }
    return surf;
  }

  /** Circle-vs-segment sweep. Walls you can step over do not participate. */
  collide(nx, nz, ox, oz, radius) {
    const walls = this.level ? this.level.walls : null;
    if (!walls) return { x: nx, z: nz };
    let px = nx, pz = nz;

    for (let pass = 0; pass < 3; pass++) {
      let hit = false;
      for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        if (!w.solid) continue;
        if (w.y1 <= 0.45 || w.y0 >= 1.6) continue;
        const ax = w.x0, az = w.z0;
        const bx = w.x1, bz = w.z1;
        const dx = bx - ax, dz = bz - az;
        const l2 = dx * dx + dz * dz;
        let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        const cx = ax + dx * t, cz = az + dz * t;
        let ox2 = px - cx, oz2 = pz - cz;
        let d = Math.hypot(ox2, oz2);
        if (d >= radius) continue;
        if (d < 1e-5) { ox2 = px - ox; oz2 = pz - oz; d = Math.hypot(ox2, oz2) || 1; }
        px = cx + (ox2 / d) * radius;
        pz = cz + (oz2 / d) * radius;
        hit = true;
      }
      if (!hit) break;
    }
    return { x: px, z: pz };
  }

  // ------------------------------------------------------------------ actions

  _dispatchSound(evt) {
    for (const e of this.enemies) e.hear(evt);
  }

  rallyTo(pos, source) {
    for (const e of this.enemies) {
      if (e === source || !e.alive) continue;
      e.hear({ kind: 'scream', loudness: 3.2, position: pos, fromPlayer: false });
    }
  }

  onShotFired(from, dir) {
    this.shotFlash = 1;
    let bestT = Infinity;
    let victim = null;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const c = this._tmpA.copy(e.position);
      c.y += 1.1;
      const rel = this._tmpB.copy(c).sub(from);
      const t = rel.dot(dir);
      if (t <= 0 || t > 42) continue;
      const perp = rel.addScaledVector(dir, -t).length();
      if (perp > 0.55) continue;
      if (this.sound.transmission(from, e.position) < 0.4) continue;
      if (t < bestT) { bestT = t; victim = e; }
    }
    if (victim) victim.damage(2, from);
  }

  throwStone(from, dir) {
    const mesh = buildStone(this.stoneMaterial);
    mesh.position.copy(from);
    this.scene.add(mesh);
    this.stones.push({
      mesh,
      vel: dir.clone().multiplyScalar(15).add(new THREE.Vector3(0, 2.2, 0)),
      life: 6,
    });
    // Leaving your hand is itself a small sound.
    this.sound.emit('step', from, { gain: 0.1, fromPlayer: true, surface: SURF.CARPET });
  }

  onPlayerDeath() {
    this.state = 'dead';
    this.deadTime = 0;
    this.screens.showDeath();
  }

  // -------------------------------------------------------------- simulation

  _ambience(dt) {
    const def = this.level.def;

    for (let i = 0; i < def.drips.length; i++) {
      this.dripTimers[i] -= dt;
      if (this.dripTimers[i] <= 0) {
        const d = def.drips[i];
        const [lo, hi] = d.every;
        this.dripTimers[i] = lo + Math.random() * (hi - lo);
        this._tmpA.set(d.x, d.y, d.z);
        this.sound.emit('drip', this._tmpA, { gain: d.gain });
        // The splash below, a beat later. Two events, two rings.
        setTimeout(() => {
          if (!this.level || this.level.def !== def) return;
          this._tmpB.set(d.x, this.floorHeight(d.x, d.z), d.z);
          this.sound.emit('drip', this._tmpB, { gain: d.gain * 0.55 });
        }, 90 + Math.random() * 60);
      }
    }

    for (let i = 0; i < def.machines.length; i++) {
      const m = def.machines[i];
      this.machinePhase[i] -= dt;
      if (this.machinePhase[i] <= 0) {
        this.machinePhase[i] = m.period;
        this._tmpA.set(m.x, m.y, m.z);
        this.sound.emit('machine', this._tmpA, { gain: m.gain });
        // The cover it lays down. This is MAINTENANCE's whole mechanic: for a
        // second and a half you can move without being heard.
        this.sound.addMask(this._tmpA, m.cover ?? 13, m.coverFor ?? 1.6);
      }
    }

    if (def.trains) {
      this.trainTimer -= dt;
      if (this.trainTimer <= 0) {
        const [lo, hi] = def.trains.every;
        this.trainTimer = lo + Math.random() * (hi - lo);
        const b = this.level.bounds;
        this._tmpA.set(
          b.min.x + Math.random() * (b.max.x - b.min.x),
          b.min.y + 1.4,
          Math.random() < 0.5 ? b.min.z - 6 : b.max.z + 6
        );
        this.sound.emit('train', this._tmpA, { gain: def.trains.gain });
        this.hud.flashLine('SOMETHING PASSES ABOVE');
      }
    }

    // The electrical bed, made visible. A failing ballast somewhere overhead
    // ticks over, the hum swells, and a thin cyan ring falls out of the dark.
    this.humTimer -= dt;
    if (this.humTimer <= 0) {
      this.humTimer = 3.2 + Math.random() * 3.4;
      const b = this.level.bounds;
      this._tmpA.set(
        b.min.x + Math.random() * (b.max.x - b.min.x),
        b.max.y - 0.25,
        b.min.z + Math.random() * (b.max.z - b.min.z)
      );
      this.sound.emit('hum', this._tmpA, { gain: 0.75 + Math.random() * 0.5 });
    }

    // The building settling. Keeps the world from ever going fully lightless.
    this.settleTimer -= dt;
    if (this.settleTimer <= 0) {
      this.settleTimer = 7 + Math.random() * 9;
      const b = this.level.bounds;
      this._tmpA.set(
        b.min.x + Math.random() * (b.max.x - b.min.x),
        b.max.y - 0.3,
        b.min.z + Math.random() * (b.max.z - b.min.z)
      );
      this.sound.emit('chime', this._tmpA, { gain: 0.28 });
    }
  }

  /**
   * Zones that make a noise when you cross them. There is exactly one user —
   * the turnstile ranks in level 2 — and it exists so that one level has a
   * cost you cannot sneak your way out of.
   */
  _triggers() {
    const list = this.level.def.triggers;
    if (!list) return;
    const p = this.player.position;
    const now = this.levelTime;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const inside = p.x >= t.x0 && p.x <= t.x1 && p.z >= t.z0 && p.z <= t.z1;
      const st = this.triggerState[i];
      if (inside && !st.inside && now - st.firedAt > (t.cooldown ?? 4)) {
        st.firedAt = now;
        this._tmpA.set(p.x, p.y + 0.9, p.z);
        this.sound.emit(t.kind ?? 'turnstile', this._tmpA, {
          gain: t.gain ?? 1,
          fromPlayer: true,
        });
        if (t.line) this.hud.flashLine(t.line);
      }
      st.inside = inside;
    }
  }

  _updateStones(dt) {
    for (let i = this.stones.length - 1; i >= 0; i--) {
      const s = this.stones[i];
      s.life -= dt;
      s.vel.y -= 12.5 * dt;
      const p = s.mesh.position;
      const nx = p.x + s.vel.x * dt;
      const nz = p.z + s.vel.z * dt;
      const ny = p.y + s.vel.y * dt;
      const floor = this.floorHeight(nx, nz, ny);
      const hitWall = this.collide(nx, nz, p.x, p.z, 0.1);
      const bouncedWall = Math.abs(hitWall.x - nx) > 1e-4 || Math.abs(hitWall.z - nz) > 1e-4;

      if (ny <= floor + 0.08 || bouncedWall) {
        p.set(hitWall.x, Math.max(ny, floor + 0.08), hitWall.z);
        const speed = s.vel.length();
        this.sound.emit('stone', p, {
          gain: Math.min(1.25, 0.35 + speed * 0.055),
          fromPlayer: true,
          surface: this.surfaceAt(p.x, p.z),
        });
        if (speed < 3.2 || s.life < 0) {
          this.scene.remove(s.mesh);
          this.stones.splice(i, 1);
          continue;
        }
        if (bouncedWall) { s.vel.x *= -0.42; s.vel.z *= -0.42; }
        s.vel.y = Math.abs(s.vel.y) * 0.38;
        s.vel.multiplyScalar(0.55);
      } else {
        p.set(nx, ny, nz);
      }
      s.mesh.rotation.x += dt * 7;
      s.mesh.rotation.z += dt * 5;
      if (s.life <= 0) {
        this.scene.remove(s.mesh);
        this.stones.splice(i, 1);
      }
    }
    this.stoneMaterial.uniforms.uGlow.value = 0.25;
  }

  _checkExit() {
    const ex = this.level.def.exit;
    const d = Math.hypot(this.player.position.x - ex.x, this.player.position.z - ex.z);
    if (d < ex.r) this._completeLevel();
  }

  _completeLevel() {
    this.state = 'results';
    const noise = this.sound.noiseScore;
    // Each level sets its own par: a long ballast tunnel cannot be crossed as
    // quietly as a carpeted corridor, and grading them on one scale is a lie.
    const t = this.level.def.par ?? GRADE_TARGETS.quiet;
    let grade;
    if (this.player.shots === 0 && noise < t[0]) grade = 'UNHEARD';
    else if (this.player.shots === 0 && noise < t[1]) grade = 'QUIET';
    else if (noise < t[2]) grade = 'HEARD';
    else grade = 'LOUD';
    this.sound.emit('chime', this.player.eyePosition(), { gain: 0.6 });
    this.screens.showResults({
      level: this.level.def,
      time: this.levelTime,
      shots: this.player.shots,
      noise,
      grade,
      last: this.levelIndex === LEVELS.length - 1,
    });
  }

  // ------------------------------------------------------------------- frame

  /** Test hook: run the simulation without touching the GPU. */
  setHeadlessLogicOnly(v) { this.noRender = !!v; }

  /** Capture rig hook: run the simulation on a fixed clock so stills repeat. */
  setFixedStep(dt) {
    this._fixedDt = dt || null;
    this.headless = !!dt;
  }

  /** Capture rig hook: drop straight into a level with no cards or fades. */
  debugEnter(levelIndex, opts = {}) {
    this.loadLevel(levelIndex);
    this.screens.hide();
    this.state = 'play';
    if (opts.x !== undefined) {
      this.player.spawn(opts.x, opts.z, opts.yaw ?? 0);
    }
    if (opts.pitch !== undefined) this.player.pitch = opts.pitch;
  }

  frame() {
    const real = this.clock.getDelta();
    const dt = this._fixedDt ?? Math.min(0.05, real);
    this.elapsed += dt;
    this.shared.time.value = this.elapsed;

    const input = this.input;

    if (input.consume('mute')) this.sound.engine.setMuted(!this.sound.engine.muted);
    if (input.consume('photo')) this.togglePhoto();

    switch (this.state) {
      case 'title':
        if (input.consume('confirm') || input.consume('forward') || input.mouse.fired) {
          input.takeMouse();
          this.screens.hide();
          this.startRun();
          input.requestLock();
        }
        break;

      case 'intro':
        this.introTime += dt;
        if (this.introTime > 2.4 && (input.consume('confirm') || input.mouse.fired || this.introTime > 5.5)) {
          input.takeMouse();
          this.screens.hide();
          this.state = 'play';
          this.clock.getDelta();
          if (!input.locked && !this.headless) input.requestLock();
        }
        break;

      case 'play':
        this._play(dt);
        break;

      case 'results':
        if (input.consume('confirm') || input.mouse.fired) {
          input.takeMouse();
          this.screens.hide();
          if (this.levelIndex === LEVELS.length - 1) {
            this.state = 'title';
            this.screens.showEnding();
          } else {
            this.loadLevel(this.levelIndex + 1);
          }
        }
        break;

      case 'dead':
        this.deadTime += dt;
        this.pulses.update(dt);
        if (this.deadTime > 1.2 && (input.consume('confirm') || input.consume('restart') || input.mouse.fired)) {
          input.takeMouse();
          this.screens.hide();
          this.loadLevel(this.levelIndex);
        }
        break;
    }

    this._render(dt);
    input.endFrame();
  }

  _play(dt) {
    const input = this.input;
    const m = input.takeMouse();
    this.player.look(m.dx, m.dy);
    if (m.fired) this.player.fire();
    if (input.consume('stone')) this.player.throwStone();
    if (input.consume('restart')) { this.loadLevel(this.levelIndex); return; }

    this.levelTime += dt;
    this.player.update(dt, input);
    this._triggers();
    this._ambience(dt);
    this._updateStones(dt);
    for (const e of this.enemies) e.update(dt, this.player);
    this._checkExit();

    this.hud.update({
      player: this.player,
      noise: this.sound.noiseScore,
      enemies: this.enemies,
      dt,
    });
  }

  _render(dt) {
    this.pulses.update(dt);

    const p = this.player.eyePosition(this._tmpA);
    this.camera.position.copy(p);
    this.camera.rotation.set(0, 0, 0, 'YXZ');
    this.camera.rotation.y = this.player.yaw;
    this.camera.rotation.x = this.player.pitch;
    this.camera.updateMatrixWorld();
    this.shared.eye.value.copy(p);
    this.sound.engine.updateListener(this.camera);

    if (this.noRender) return;

    if (this.level) {
      this.memory.render(dt);
      this.shared.memory.value = this.memory.texture;
      this.worldMaterial.uniforms.uMemory.value = this.memory.texture;
    }

    this.shotFlash = Math.max(0, (this.shotFlash ?? 0) - dt * 4);
    this.finalPass.uniforms.uTime.value = this.elapsed;
    this.finalPass.uniforms.uHurt.value = this.player.dead
      ? 1
      : (1 - this.player.health / 3) * 0.85 + this.player.hurtFlash * 0.5;
    this.fade += (this.fadeTarget - this.fade) * Math.min(1, dt * 3);
    this.finalPass.uniforms.uFade.value = Math.max(
      this.fade,
      this.state === 'dead' ? Math.min(0.75, this.deadTime * 0.5) : 0
    );

    this.composer.render();

    if (this._pendingCapture) {
      const cb = this._pendingCapture;
      this._pendingCapture = null;
      cb();
    }
  }

  // -------------------------------------------------------------- photo mode

  togglePhoto() {
    this.photoMode = !this.photoMode;
    this.hud.setVisible(!this.photoMode);
    if (this.photoMode) this.capture();
  }

  /** High-resolution grab with the interface removed. Marketing stills. */
  capture(scale = 2) {
    const w = innerWidth, h = innerHeight;
    const prevRatio = this.renderer.getPixelRatio();
    this.hud.setVisible(false);
    this.renderer.setPixelRatio(Math.min(scale * devicePixelRatio, 4));
    this.composer.setSize(w, h);
    this._render(0.0001);
    this.canvas.toBlob((blob) => {
      if (blob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `reverb-${Date.now()}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      this.renderer.setPixelRatio(prevRatio);
      this.composer.setSize(w, h);
      this.hud.setVisible(!this.photoMode);
    }, 'image/png');
  }
}
