import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

/**
 * Grade + lens. Deliberately restrained: the picture is already almost entirely
 * black, so anything that lifts the floor destroys the whole premise. Grain is
 * gated on luminance for exactly that reason — unlit pixels stay at 0,0,0.
 */
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uAberration: { value: 1.15 },
    uGrain: { value: 0.042 },
    uVignette: { value: 0.62 },
    uExposure: { value: 2.05 },
    uHurt: { value: 0.0 },
    uFade: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime, uAberration, uGrain, uVignette, uExposure, uHurt, uFade;
    uniform vec2 uResolution;
    varying vec2 vUv;

    float h21(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);

      // Chromatic aberration confined to the far corners of the lens.
      float ab = uAberration * r2 * r2 * 0.03;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ab).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ab).b;
      col = max(col, 0.0);

      // Filmic-ish exposure curve. Reaches true white, never lifts true black.
      col = 1.0 - exp(-col * uExposure);

      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));

      // Grain gated on luminance, so darkness stays #000000.
      float g = h21(vUv * uResolution + fract(uTime) * 137.0) - 0.5;
      col += g * uGrain * smoothstep(0.0, 0.10, luma) * (0.35 + luma * 0.9);

      float vig = 1.0 - uVignette * pow(clamp(r2 * 2.1, 0.0, 1.0), 1.5);
      col *= vig;

      // Being hurt tightens the frame; the real punishment is your own pulse.
      float beat = pow(max(sin(uTime * 3.2), 0.0), 6.0);
      col *= 1.0 - uHurt * (0.28 + 0.34 * beat) * clamp(r2 * 2.4, 0.0, 1.0);

      col *= 1.0 - uFade;
      col = max(col, 0.0);
      gl_FragColor = vec4(pow(col, vec3(1.0 / 2.2)), 1.0);
    }
  `,
};

export function createComposer(renderer, scene, camera, quality = {}) {
  const size = renderer.getSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    samples: quality.msaa ?? 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(size.x, size.y),
    0.55, // strength — enough to make a gunshot sear, not enough to smear
    0.34, // radius
    0.55  // threshold
  );
  composer.addPass(bloom);

  const final = new ShaderPass(FinalShader);
  final.renderToScreen = true;
  final.uniforms.uResolution.value.set(size.x, size.y);
  composer.addPass(final);

  return { composer, bloom, final };
}
