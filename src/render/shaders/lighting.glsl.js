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
uniform vec3  uPulseColor[MAX_PULSES];      // as seen on living things
uniform vec3  uPulseColorWorld[MAX_PULSES]; // as seen on walls and floors
uniform float uPulseRef[MAX_PULSES];    // reference distance for the 1/r² falloff
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
  if (len < 0.8) return 1.0;

  float blocked = 0.0;
  const int STEPS = 18;
  for (int i = 1; i < STEPS; i++) {
    float t = float(i) / float(STEPS);
    // Both endpoints sit on or inside solid matter (a wall lighting itself,
    // a source standing next to one) so the ends of the ray are ignored.
    float edge = min(t, 1.0 - t) * len;
    if (edge < 0.6) continue;
    blocked += sampleOcc(a + d * t);
  }
  return clamp(1.0 - blocked * 0.75, 0.0, 1.0);
}
`;

/**
 * One wavefront's contribution at a point.
 *
 * The shell is deliberately asymmetric — a razor-thin leading edge with a
 * longer, dimmer wake behind it — and its brightness is a broad low body with a
 * very hot filament riding on the crest. That combination is what makes it read
 * as a *line travelling across the geometry* rather than a glowing bubble.
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

    float front = thick * 0.30;
    float back  = thick * 1.70;
    float e = dist - radius;
    if (e > front || e < -back) continue;

    float s = e > 0.0 ? 1.0 - e / front : 1.0 + e / back;
    s = clamp(s, 0.0, 1.0);
    float shell = s * s * 0.32 + pow(s, 26.0) * 3.20;

    vec3 L = toS / max(dist, 0.0001);
    float r = dist / uPulseRef[i];
    float atten = 1.0 / (1.0 + r * r);
    float occ = occlusion(P, uPulsePos[i]);

    float falloff = atten * intensity * gate * occ;
    // The one warm thing in any frame is a creature. Its footsteps light the
    // floor like anyone else's — cold — so that an orange silhouette never has
    // to compete with an orange room.
    vec3 tint = mix(uPulseColorWorld[i], uPulseColor[i], revealGate);
    vec3 energy = tint * (shell * falloff);

    // Soft wrap: a surface edge-on to the wave still catches it, a surface
    // facing away from it stays black. No 'ambient floor' anywhere.
    float ndl = clamp(dot(N, L) * 0.85 + 0.38, 0.0, 1.0);
    diffuse += energy * ndl;

    if (gloss > 0.001) {
      vec3 H = normalize(L + V);
      float sh = 20.0 + gloss * 260.0;
      // Built from the shell body only — the filament belongs to the diffuse
      // line, and letting it into the specular lobe turns water into lava.
      spec += tint * (s * s * 0.9 * falloff)
            * pow(max(dot(N, H), 0.0), sh) * gloss * 0.85;
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
