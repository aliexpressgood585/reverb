import * as THREE from 'three';
import {
  PULSE_UNIFORMS_GLSL,
  OCCLUSION_GLSL,
  PULSE_LIGHT_GLSL,
  NOISE_GLSL,
} from './shaders/lighting.glsl.js';
import { SURFACE_GLSL } from './shaders/surfaces.glsl.js';

const vert = /* glsl */ `
attribute vec2 aLightUv;
attribute float aSurface;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vLightUv;
varying float vSurface;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLightUv = aLightUv;
  vSurface = aSurface;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const frag = /* glsl */ `
precision highp float;

${PULSE_UNIFORMS_GLSL}
${NOISE_GLSL}
${OCCLUSION_GLSL}
${PULSE_LIGHT_GLSL}
${SURFACE_GLSL}

uniform sampler2D uMemory;
uniform float uMemoryStrength;
uniform float uTime;
uniform vec3  uEye;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vLightUv;
varying float vSurface;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uEye - vWorld);

  vec3 albedo;
  float gloss;
  surface(vSurface, vWorld, uTime, N, albedo, gloss);

  vec3 diffuse, spec;
  gatherLit(vWorld, N, V, gloss, 0.0, diffuse, spec);

  // The imprint: what previous wavefronts already showed you, fading out.
  vec3 memory = texture2D(uMemory, vLightUv).rgb * uMemoryStrength;

  vec3 col = albedo * (diffuse + memory) + spec;

  // Air in a tunnel is not clean. Distant light loses a little of itself.
  float d = length(uEye - vWorld);
  col *= exp(-d * 0.010);

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createWorldMaterial(shared) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      ...shared.pulseUniforms,
      ...shared.occUniforms,
      uMemory: shared.memory,
      uMemoryStrength: { value: 0.032 },
      uTime: shared.time,
      uEye: shared.eye,
    },
    side: THREE.FrontSide,
  });
}

/**
 * The imprint pass. Geometry is rasterised into its lightmap chart instead of
 * into the camera, so the accumulation is anchored to the world rather than to
 * the screen — walk backwards and the memory of a room stays where the room is.
 */
const imprintVert = /* glsl */ `
attribute vec2 aLightUv;
attribute float aSurface;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vLightUv;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLightUv = aLightUv;
  gl_Position = vec4(aLightUv * 2.0 - 1.0, 0.0, 1.0);
}
`;

const imprintFrag = /* glsl */ `
precision highp float;

${PULSE_UNIFORMS_GLSL}
${NOISE_GLSL}
${OCCLUSION_GLSL}
${PULSE_LIGHT_GLSL}

uniform sampler2D uPrev;
uniform float uDecay;

varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vLightUv;

void main() {
  vec3 lit = gatherPulses(vWorld, normalize(vNormal), 0.0);
  // Saturating store. Memory records *that* you saw a surface, not how hard it
  // was hit — otherwise a gunshot leaves the whole room painted white for three
  // seconds and the imprint stops being a hint and becomes a floodlight.
  lit = lit / (1.0 + lit);
  vec3 prev = texture2D(uPrev, vLightUv).rgb * uDecay;
  gl_FragColor = vec4(max(prev, lit), 1.0);
}
`;

export function createImprintMaterial(shared) {
  return new THREE.ShaderMaterial({
    vertexShader: imprintVert,
    fragmentShader: imprintFrag,
    uniforms: {
      ...shared.pulseUniforms,
      ...shared.occUniforms,
      uPrev: { value: null },
      uDecay: { value: 0.99 },
    },
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
