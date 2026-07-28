import * as THREE from 'three';

/**
 * Light memory.
 *
 * A wavefront passes in a quarter of a second. If that were all, the game would
 * be unreadable — you would never hold a mental picture of the room. So every
 * lit texel is written into a world-anchored atlas that decays over ~3 seconds.
 *
 * This is a lightmap, not a screen-space trail: the imprint is attached to the
 * geometry, so turning your head does not smear it.
 */
export class LightMemory {
  constructor(renderer, size = 2048) {
    this.renderer = renderer;
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    };
    this.a = new THREE.WebGLRenderTarget(size, size, opts);
    this.b = new THREE.WebGLRenderTarget(size, size, opts);

    this.scene = new THREE.Scene();
    this.camera = new THREE.Camera();
    this.mesh = null;
    this.tau = 0.82; // seconds; ~3s until the imprint is gone
  }

  setLevel(geometry, material) {
    if (this.mesh) this.scene.remove(this.mesh);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.material = material;
    this.scene.add(this.mesh);
    this.clear();
  }

  clear() {
    const prev = this.renderer.getRenderTarget();
    for (const rt of [this.a, this.b]) {
      this.renderer.setRenderTarget(rt);
      this.renderer.setClearColor(0x000000, 1);
      this.renderer.clear(true, false, false);
    }
    this.renderer.setRenderTarget(prev);
  }

  get texture() {
    return this.a.texture;
  }

  render(dt) {
    if (!this.mesh) return;
    this.material.uniforms.uPrev.value = this.a.texture;
    this.material.uniforms.uDecay.value = Math.exp(-dt / this.tau);

    const prevTarget = this.renderer.getRenderTarget();
    const prevAuto = this.renderer.autoClear;
    this.renderer.autoClear = false;
    this.renderer.setRenderTarget(this.b);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.autoClear = prevAuto;

    const t = this.a;
    this.a = this.b;
    this.b = t;
  }

  dispose() {
    this.a.dispose();
    this.b.dispose();
  }
}
