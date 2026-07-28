/**
 * Procedural surface description. No texture files exist in this project, so
 * every material is evaluated from world position.
 *
 * Returns albedo in `albedo`, gloss in `gloss`, and perturbs the shading
 * normal in place — that perturbation is what makes a puddle glitter and gravel
 * sparkle when a wavefront crosses them.
 */
export const SURFACE_GLSL = /* glsl */ `
// Surface ids — must match src/world/surfaces.js
#define S_CONCRETE 0.0
#define S_PUDDLE   1.0
#define S_GRAVEL   2.0
#define S_CARPET   3.0
#define S_METAL    4.0
#define S_TILE     5.0

vec2 rippleGrad(vec2 p, float t) {
  // Two crossed travelling wave trains — cheap, and reads as standing water.
  float a = sin(p.x * 3.1 + t * 0.9) * cos(p.y * 2.6 - t * 0.7);
  float b = sin(dot(p, vec2(2.2, -1.7)) + t * 1.3);
  float e = 0.06;
  float ax = sin((p.x + e) * 3.1 + t * 0.9) * cos(p.y * 2.6 - t * 0.7);
  float ay = sin(p.x * 3.1 + t * 0.9) * cos((p.y + e) * 2.6 - t * 0.7);
  float bx = sin(dot(p + vec2(e, 0.0), vec2(2.2, -1.7)) + t * 1.3);
  float by = sin(dot(p + vec2(0.0, e), vec2(2.2, -1.7)) + t * 1.3);
  return vec2((ax + bx - a - b), (ay + by - a - b)) / e;
}

void surface(float id, vec3 P, float t, inout vec3 N, out vec3 albedo, out float gloss) {
  albedo = vec3(0.5);
  gloss = 0.0;

  if (id < S_PUDDLE + 0.5 && id > S_CONCRETE + 0.5) {
    // --- standing water -----------------------------------------------------
    vec2 g = rippleGrad(P.xz, t);
    N = normalize(N + vec3(g.x, 0.0, g.y) * 0.035);
    float film = fbm(P.xz * 1.3 + 11.0);
    albedo = mix(vec3(0.10, 0.30, 0.35), vec3(0.16, 0.42, 0.47), film);
    gloss = 0.92;
  } else if (id < S_GRAVEL + 0.5 && id > S_PUDDLE + 0.5) {
    // --- track ballast ------------------------------------------------------
    vec2 cell = floor(P.xz * 26.0);
    float r = hash21(cell);
    float r2 = hash21(cell + 71.3);
    N = normalize(N + vec3(r - 0.5, 0.0, r2 - 0.5) * 0.85);
    albedo = vec3(0.30 + r * 0.34);
    albedo *= mix(vec3(1.0), vec3(1.03, 1.0, 0.96), r2);
    gloss = 0.18 + r2 * 0.2;
  } else if (id < S_CARPET + 0.5 && id > S_GRAVEL + 0.5) {
    // --- rotted carpet: drinks the light ------------------------------------
    float fuzz = fbm(P.xz * 44.0);
    albedo = vec3(0.10, 0.098, 0.094) * (0.7 + fuzz * 0.6);
    gloss = 0.0;
  } else if (id < S_METAL + 0.5 && id > S_CARPET + 0.5) {
    // --- brushed steel ------------------------------------------------------
    float streak = fbm(vec2(P.x * 2.0 + P.z * 2.0, (P.y) * 90.0));
    albedo = vec3(0.34, 0.36, 0.38) * (0.65 + streak * 0.7);
    gloss = 0.62;
  } else if (id > S_METAL + 0.5) {
    // --- station tile -------------------------------------------------------
    vec2 tp = vec2(P.x + P.z, P.y) * 5.0;
    vec2 f = abs(fract(tp) - 0.5);
    float grout = smoothstep(0.40, 0.49, max(f.x, f.y));
    float dirt = fbm(P.xz * 2.2 + P.y * 0.7);
    albedo = mix(vec3(0.62, 0.64, 0.66), vec3(0.13), grout);
    albedo *= 0.6 + dirt * 0.7;
    N = normalize(N + vec3(0.0, 0.0, 0.0));
    gloss = mix(0.45, 0.02, grout);
  } else {
    // --- poured concrete ----------------------------------------------------
    float grain = fbm(P.xz * 2.4 + P.y * 1.1);
    float coarse = fbm(P.xz * 0.35 + 4.0);
    float crack = smoothstep(0.49, 0.5, abs(fbm(P.xz * 0.9 + 7.0) - 0.5) * 2.0);
    albedo = vec3(0.40 + grain * 0.22 + coarse * 0.14);
    albedo *= 1.0 - crack * 0.55;
    N = normalize(N + vec3(grain - 0.5, 0.0, coarse - 0.5) * 0.10);
    gloss = 0.05;
  }
}
`;
