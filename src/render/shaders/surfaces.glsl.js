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

/** Pick the two world axes that actually lie in the surface. */
vec2 planarUv(vec3 P, vec3 N) {
  vec3 a = abs(N);
  if (a.y >= a.x && a.y >= a.z) return P.xz;
  if (a.x >= a.z) return P.zy;
  return P.xy;
}

/** Map a 2D gradient taken in planarUv space back into world space. */
vec3 planarPerturb(vec3 N, vec2 g) {
  vec3 a = abs(N);
  if (a.y >= a.x && a.y >= a.z) return vec3(g.x, 0.0, g.y);
  if (a.x >= a.z) return vec3(0.0, g.y, g.x);
  return vec3(g.x, g.y, 0.0);
}

vec2 rippleGrad(vec2 p, float t) {
  // Two crossed travelling wave trains at close-to-equal frequency: the beat
  // between them is what standing water in a dark room actually looks like.
  float e = 0.02;
  #define RW(q) (sin((q).x * 19.3 + t * 1.9) * cos((q).y * 16.7 - t * 1.35) \
               + sin(dot((q), vec2(13.1, -11.4)) + t * 2.4) * 0.7 \
               + sin(dot((q), vec2(31.0, 27.0)) + t * 3.1) * 0.28)
  float a = RW(p);
  return vec2(RW(p + vec2(e, 0.0)) - a, RW(p + vec2(0.0, e)) - a) / e;
}

void surface(float id, vec3 P, float t, inout vec3 N, out vec3 albedo, out float gloss) {
  vec2 uv = planarUv(P, N);
  albedo = vec3(0.5);
  gloss = 0.0;

  if (id > S_CONCRETE + 0.5 && id < S_PUDDLE + 0.5) {
    // --- standing water -----------------------------------------------------
    vec2 g = clamp(rippleGrad(uv, t), -6.0, 6.0);
    N = normalize(N + planarPerturb(N, g) * 0.0065);
    float film = fbm(uv * 2.6 + 11.0);
    albedo = mix(vec3(0.030, 0.115, 0.140), vec3(0.055, 0.205, 0.235), film);
    gloss = 0.86;
  } else if (id > S_PUDDLE + 0.5 && id < S_GRAVEL + 0.5) {
    // --- track ballast ------------------------------------------------------
    vec2 cell = floor(uv * 22.0);
    vec2 f = fract(uv * 22.0) - 0.5;
    float r = hash21(cell);
    float r2 = hash21(cell + 71.3);
    // Fake each stone as a dome, so a passing wavefront picks out every one.
    float dome = clamp(1.0 - dot(f, f) * 3.0, 0.0, 1.0);
    N = normalize(N + planarPerturb(N, vec2(f.x * dome * 1.5 + (r - 0.5) * 0.4,
                                            f.y * dome * 1.5 + (r2 - 0.5) * 0.4)));
    albedo = vec3(0.20 + r * 0.42) * (0.55 + dome * 0.75);
    gloss = 0.16 + r2 * 0.24;
  } else if (id > S_GRAVEL + 0.5 && id < S_CARPET + 0.5) {
    // --- rotted carpet: drinks the light ------------------------------------
    float fuzz = fbm(uv * 52.0);
    float weave = fbm(uv * 8.0);
    albedo = vec3(0.075, 0.072, 0.068) * (0.55 + fuzz * 0.8 + weave * 0.3);
    gloss = 0.0;
  } else if (id > S_CARPET + 0.5 && id < S_METAL + 0.5) {
    // --- brushed steel ------------------------------------------------------
    float streak = fbm(vec2(uv.x * 1.4, uv.y * 120.0));
    float panel = step(0.5, fract(uv.y * 0.55));
    albedo = vec3(0.26, 0.285, 0.31) * (0.5 + streak * 1.0) * (0.85 + panel * 0.3);
    float seam = smoothstep(0.02, 0.0, abs(fract(uv.y * 0.55) - 0.5) - 0.485);
    albedo *= 1.0 - seam * 0.7;
    gloss = 0.68;
  } else if (id > S_METAL + 0.5) {
    // --- station tile -------------------------------------------------------
    vec2 tp = uv * 4.6;
    vec2 f = abs(fract(tp) - 0.5);
    float grout = smoothstep(0.42, 0.495, max(f.x, f.y));
    float perTile = hash21(floor(tp));
    float dirt = fbm(uv * 1.6);
    float streak = fbm(vec2(uv.x * 3.0, uv.y * 0.4)) ;
    albedo = mix(vec3(0.70, 0.72, 0.735) * (0.78 + perTile * 0.32),
                 vec3(0.055), grout);
    albedo *= 0.45 + dirt * 0.85;
    albedo *= 1.0 - streak * 0.35;
    gloss = mix(0.5, 0.01, grout);
  } else {
    // --- poured concrete ----------------------------------------------------
    float grain = fbm(uv * 3.6);
    float coarse = fbm(uv * 0.42 + 4.0);
    float ridge = abs(fbm(uv * 0.85 + 7.0) - 0.5) * 2.0;
    float crack = smoothstep(0.14, 0.0, ridge);
    float stain = smoothstep(0.62, 0.30, fbm(uv * 0.22 + 19.0));
    albedo = vec3(0.30 + grain * 0.30 + coarse * 0.26);
    albedo *= 1.0 - crack * 0.75;
    albedo *= 1.0 - stain * 0.45;
    N = normalize(N + planarPerturb(N, vec2((grain - 0.5) * 0.14, (coarse - 0.5) * 0.14)));
    gloss = 0.06;
  }
}
`;
