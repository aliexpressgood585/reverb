import * as THREE from 'three';
import {
  PULSE_UNIFORMS_GLSL,
  OCCLUSION_GLSL,
  PULSE_LIGHT_GLSL,
  NOISE_GLSL,
} from './shaders/lighting.glsl.js';

/**
 * Living things.
 *
 * They are NOT lit by your footsteps. A pulse only touches a body if it was
 * flagged as revealing — gunfire, a scream, the passing train. The rest of the
 * time a creature is visible only through `uGlow`, which is driven by the noise
 * it is making right now. Stand still and shut up, and you cannot be seen.
 */
const vert = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLocal = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frag = /* glsl */ `
precision highp float;

${PULSE_UNIFORMS_GLSL}
${NOISE_GLSL}
${OCCLUSION_GLSL}
${PULSE_LIGHT_GLSL}

uniform vec3  uEye;
uniform vec3  uTint;
uniform float uGlow;
uniform float uTime;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uEye - vWorld);

  // Silhouette-first shading: the rim carries the shape, the interior stays void.
  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 1.8);

  vec3 diffuse, spec;
  gatherLit(vWorld, N, V, 0.30, 1.0, diffuse, spec);

  float flicker = 0.80 + 0.20 * vnoise(vec2(uTime * 7.0, vLocal.y * 3.0));
  // Almost all of the light a body gives off sits on its outline. Filling the
  // interior turns a creature into a cardboard cut-out.
  vec3 self = uTint * uGlow * (0.035 + fres * fres * 3.2) * flicker;

  // Break up the flat faces. Without this a body is a solid orange slab, which
  // reads as a placeholder rather than as something that has been down here.
  float grime = 0.52 + 0.48 * fbm(vLocal.xy * 7.0 + vLocal.zx * 3.4);
  float bands = 0.86 + 0.14 * sin(vLocal.y * 41.0);

  vec3 col = (self + diffuse * 0.42 + spec * 0.45) * grime * bands;

  float d = length(uEye - vWorld);
  col *= exp(-d * 0.016);

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createEntityMaterial(shared, tint) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      ...shared.pulseUniforms,
      ...shared.occUniforms,
      uEye: shared.eye,
      uTint: { value: new THREE.Color().setRGB(tint[0], tint[1], tint[2]) },
      uGlow: { value: 0 },
      uTime: shared.time,
    },
  });
}
