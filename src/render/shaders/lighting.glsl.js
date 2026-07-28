import { MAX_PULSES } from '../../core/config.js';

/**
 * The shared lighting chunk. This is the renderer.
 *
 * Every lit pixel in REVERB gets its brightness from this function and nothing
 * else. There is no ambient term, no fill light, no fake bounce. If the loop
 * below returns zero, the pixel is #000000.
 */
export const PULSE_UNIFORMS_GLSL = /* glsl */ `
#define MAX_PULSES ${MAX_PULSES}

uniform vec3  uPulsePos[MAX_PULSES];
uniform vec4  uPulseData[MAX_PULSES];   // x radius, y intensity, z thickness, w entity-reveal
uniform vec3  uPulseColor[MAX_PULSES];
uniform int   uPulseCount;

uniform sampler2D uOccTex;   // top-down occupancy grid of the level
uniform vec2      uOccMin;
uniform vec2      uOccSize;
`;

/** Coarse XZ ray-march against the occupancy grid: sound does not cross walls. */
export const OCCLUSION_GLSL = /* glsl */ `
float sampleOcc(vec2 world) {
  vec2 uv = (world - uOccMin) / uOccSize;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  return texture2D(uOccTex, uv).r;
}

float occlusion(vec3 P, vec3 S) {
  vec2 a = P.xz;
  vec2 b = S.xz;
  vec2 d = b - a;
  float len = length(d);
  if (len < 0.7) return 1.0;

  float blocked = 0.0;
  const int STEPS = 16;
  for (int i = 1; i < STEPS; i++) {
    float t = float(i) / float(STEPS);
    // Both endpoints sit on or inside solid matter (a wall lighting itself,
    // a source standing next to one) so the ends of the ray are ignored.
    float edge = min(t, 1.0 - t) * len;
    if (edge < 0.55) continue;
    blocked += sampleOcc(a + d * t);
  }
  return clamp(1.0 - blocked * 0.85, 0.0, 1.0);
}
`;

/**
 * One wavefront's contribution at a point.
 * The shell is deliberately asymmetric: a razor-thin leading edge with a longer,
 * dimmer wake behind it. That asymmetry is what makes it read as a line in
 * motion rather than a glowing bubble.
 */
export const PULSE_LIGHT_GLSL = /* glsl */ `
void gatherLit(vec3 P, vec3 N, vec3 V, float gloss, float revealGate,
               out vec3 diffuse, out vec3 spec) {
  diffuse = vec3(0.0);
  spec = vec3(0.0);

  for (int i = 0; i < MAX_PULSES; i++) {
    if (i >= uPulseCount) break;

    float intensity = uPulseData[i].y;
    if (intensity <= 0.0001) continue;

    // revealGate: 0 for world geometry (always lit), 1 for living things
    // (lit only by pulses flagged as revealing — gunfire, screams, the train).
    float gate = mix(1.0, uPulseData[i].w, revealGate);
    if (gate <= 0.001) continue;

    vec3  toS = uPulsePos[i] - P;
    float dist = length(toS);
    float radius = uPulseData[i].x;
    float thick = uPulseData[i].z;

    float front = thick * 0.34;
    float back  = thick * 1.70;
    float e = dist - radius;
    if (e > front || e < -back) continue;

    float s = e > 0.0 ? 1.0 - e / front : 1.0 + e / back;
    s = clamp(s, 0.0, 1.0);
    // Squared body for a clean falloff, plus a hot filament at the crest.
    float shell = s * s * 0.75 + pow(s, 14.0) * 1.25;

    vec3 L = toS / max(dist, 0.0001);
    float atten = 1.0 / (1.0 + dist * dist * 0.34);
    float occ = occlusion(P, uPulsePos[i]);

    vec3 energy = uPulseColor[i] * (shell * atten * intensity * gate * occ);

    float ndl = max(dot(N, L), 0.0);
    ndl = 0.22 + 0.78 * ndl;   // wrapped, so grazing floors still catch the wave
    diffuse += energy * ndl;

    if (gloss > 0.001) {
      vec3 H = normalize(L + V);
      float sh = 14.0 + gloss * 210.0;
      spec += energy * pow(max(dot(N, H), 0.0), sh) * gloss * 1.6;
    }
  }
}

vec3 gatherPulses(vec3 P, vec3 N, float revealGate) {
  vec3 d, s;
  gatherLit(P, N, vec3(0.0, 1.0, 0.0), 0.0, revealGate, d, s);
  return d;
}
`;

/** Value noise / fbm used for every surface in the game. No textures anywhere. */
export const NOISE_GLSL = /* glsl */ `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    v += vnoise(p) * amp;
    p *= 2.03;
    amp *= 0.5;
  }
  return v;
}
`;
