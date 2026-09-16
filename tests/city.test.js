import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import { CityRenderer } from '../cairn/src/city.js';
import { Camera } from '../cairn/src/render.js';
import { Sim, predict, solidHalfWidth } from '../cairn/src/sim.js';
import { FEEL } from '../cairn/src/feel.js';

// Keep the real scene graph, geometries and projection. Only the GPU and
// decorative canvas texture are stubs; these checks do not certify GPU output.
vi.mock('three', async (original) => {
  const actual = await original();
  return {
    .../** @type {typeof T} */ (actual),
    WebGLRenderer: class {
      shadowMap = { enabled: false, type: 0 };
      setPixelRatio() {}
      setSize() {}
      render() {}
    },
  };
});
afterEach(() => vi.unstubAllGlobals());

function setup() {
  const canvas = /** @type {HTMLCanvasElement} */ (
    /** @type {unknown} */ ({
      width: 0,
      height: 0,
      getContext: () => ({ fillRect() {}, strokeRect() {}, fillText() {} }),
    })
  );
  vi.stubGlobal('document', { createElement: () => canvas });
  const city = new CityRenderer(canvas);
  const sim = new Sim(123);
  sim.reset(true);
  const camera = new Camera();
  camera.y = sim.body.y;
  const input = /** @type {import('../cairn/src/input.js').Input} */ (
    /** @type {unknown} */ ({ aiming: false, vx: 0, arc: [], landing: null })
  );
  const fx = /** @type {import('../cairn/src/render.js').Renderer} */ (
    /** @type {unknown} */ ({ ringN: 0, trailN: 0, rings: [], trail: [] })
  );
  const ui = {
    squash: 0,
    flash: 0,
    bestFlash: 0,
    dead: 0,
    wash: 0,
    started: true,
    monument: false,
    goal: 100,
  };
  city.resize(390, 844, 3);
  const draw = (reduced = false) => city.draw(sim, camera, input, ui, 1 / 60, reduced, fx);
  return { city, sim, camera, input, ui, draw };
}

describe('city scene / simulation contract', () => {
  it.each([
    [390, 844],
    [1363, 936],
  ])('projects the gameplay plane accurately at %sx%s', (width, height) => {
    const { city, camera, draw } = setup();
    city.resize(width, height, 2);
    camera.y = 500;
    camera.shakeX = 0.8;
    camera.shakeY = -0.4;
    draw();
    city.camera.updateMatrixWorld();
    for (const [x, y] of [
      [0, 470],
      [80, 520],
      [160, 550],
    ]) {
      const p = new T.Vector3(x, y, 0).project(city.camera);
      const scale = height / camera.viewH;
      expect(((p.x + 1) * width) / 2).toBeCloseTo(
        width / 2 + (x - camera.x + camera.shakeX) * scale,
        6,
      );
      expect(((1 - p.y) * height) / 2).toBeCloseTo(
        height * (0.5 - FEEL.camera.playerOffsetY) + (camera.y - y + camera.shakeY) * scale,
        6,
      );
    }
  });

  it('places luminous landing edges on the actual collision surface', () => {
    const { city, sim, draw } = setup();
    draw();
    const matrix = new T.Matrix4();
    const first = sim.world.solids.find((s) => s.live && !s.corpse);
    if (!first) throw new Error('missing starting platform');
    city.lips.getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBeCloseTo(first.x);
    expect(matrix.elements[13]).toBeCloseTo(first.y + first.hh);
    expect(matrix.elements[14]).toBe(0);
    expect(matrix.elements[0]).toBeCloseTo(solidHalfWidth(first, sim) * 2);
  });

  it('uses simulation predictions for aiming and clears the preview on release', () => {
    const { city, sim, input, draw } = setup();
    input.aiming = true;
    input.landing = predict(sim, 10, 35, input.arc);
    draw();
    expect(city.arc.count).toBeGreaterThan(0);
    const matrix = new T.Matrix4();
    city.arc.getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBeCloseTo(input.arc[0]);
    expect(matrix.elements[13]).toBeCloseTo(input.arc[1]);
    expect(city.previewStone.visible).toBe(sim.predictPeak.dies);
    input.aiming = false;
    draw();
    expect(city.arc.count).toBe(0);
    expect(city.previewStone.visible).toBe(false);
    expect(city.halo.visible).toBe(false);
  });

  it('preserves simulation state and honors reduced motion and monument view', () => {
    const { city, sim, camera, ui, draw } = setup();
    const before = JSON.stringify(sim);
    draw(true);
    expect(JSON.stringify(sim)).toBe(before);
    expect(city.rain.count).toBe(0);
    expect(city.rings.count).toBe(0);
    ui.dead = 0.2;
    ui.monument = true;
    camera.mon = 1;
    draw(true);
    expect(city.robot.visible).toBe(false);
    expect(city.city.visible).toBe(false);
    expect(city.goal.visible).toBe(false);
  });
});
