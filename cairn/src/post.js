/**
 * One fullscreen WebGL pass over the Canvas2D scene.
 *
 * Why this split instead of rendering everything in WebGL: the art direction is
 * gradients, silhouettes, soft radial light and thin strokes — all of which
 * Canvas2D expresses in one line and a shader expresses in forty. What Canvas2D
 * cannot do at any reasonable cost is bloom, chromatic aberration, grain and
 * grading, which are exactly four texture reads in a fragment shader. So: scene
 * in 2D, grade in GL. The whole chain is four draw calls.
 *
 *   bright pass + downsample to quarter res
 *   separable blur, horizontal then vertical
 *   composite: base + bloom, CA, barrel, grade, grain, vignette, edge blur
 *
 * Everything scales with the player's speed, so the image gets more violent the
 * faster you fall and settles completely when you stand still. Nothing here is
 * on a timer; it is all driven by the simulation.
 */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const BRIGHT = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform float uThreshold;
void main() {
  vec3 c = texture2D(uTex, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float k = max(0.0, l - uThreshold) / max(1e-4, 1.0 - uThreshold);
  gl_FragColor = vec4(c * k * k, 1.0);
}`;

const BLUR = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
void main() {
  vec3 sum = texture2D(uTex, vUv).rgb * 0.2270270270;
  sum += texture2D(uTex, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  sum += texture2D(uTex, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  sum += texture2D(uTex, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  sum += texture2D(uTex, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(sum, 1.0);
}`;

const COMPOSITE = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2  uRes;
uniform float uTime;
uniform float uSpeed;      // 0..1, drives CA and edge blur
uniform float uBloomAmt;
uniform float uGrain;
uniform float uBarrel;
uniform float uVignette;
uniform float uFlash;
uniform vec3  uLift;
uniform vec3  uGain;
uniform float uSat;

float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}

void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);

  // Barrel: barely perceptible, just enough to stop the frame reading as flat.
  uv = 0.5 + c * (1.0 + uBarrel * r2);

  // Chromatic aberration, weighted to the corners and scaled by speed.
  float ca = (0.0006 + uSpeed * 0.0034) * r2 * 4.0;
  vec3 base;
  base.r = texture2D(uScene, uv + c * ca).r;
  base.g = texture2D(uScene, uv).g;
  base.b = texture2D(uScene, uv - c * ca).b;

  // Radial velocity smear on the edges only, during fast falls.
  if (uSpeed > 0.35) {
    float amt = (uSpeed - 0.35) / 0.65 * r2 * 2.2;
    vec3 sm = vec3(0.0);
    for (int i = 1; i <= 4; i++) {
      float t = float(i) / 4.0;
      sm += texture2D(uScene, uv - c * amt * 0.055 * t).rgb;
    }
    base = mix(base, sm * 0.25, clamp(amt, 0.0, 0.7));
  }

  vec3 bloom = texture2D(uBloom, uv).rgb;
  vec3 col = base + bloom * uBloomAmt;

  // Grade: lift/gain per biome, then a gentle saturation push.
  col = col * uGain + uLift;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, uSat);

  // Vignette.
  col *= 1.0 - uVignette * smoothstep(0.16, 0.78, r2);

  // Animated grain, gated so true black stays true black.
  float g = hash(gl_FragCoord.xy + fract(uTime) * 311.7) - 0.5;
  col += g * uGrain * smoothstep(0.0, 0.10, l);

  col = mix(col, vec3(1.0), uFlash);
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

/**
 * @param {WebGLRenderingContext} gl
 * @param {number} type
 * @param {string} src
 * @returns {WebGLShader}
 */
function compile(gl, type, src) {
  const s = gl.createShader(type);
  if (!s) throw new Error('shader: could not allocate');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

/**
 * @param {WebGLRenderingContext} gl
 * @param {string} fs
 * @returns {WebGLProgram}
 */
function program(gl, fs) {
  const p = gl.createProgram();
  if (!p) throw new Error('program: could not allocate');
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'aPos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

export class Post {
  /**
   * @param {HTMLCanvasElement} canvas
   * @returns {Post|null} null when WebGL is unavailable; caller falls back.
   */
  static create(canvas) {
    const gl = canvas.getContext('webgl', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: false, preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    if (!gl) return null;
    try { return new Post(gl, canvas); } catch { return null; }
  }

  /**
   * @param {WebGLRenderingContext} gl
   * @param {HTMLCanvasElement} canvas
   */
  constructor(gl, canvas) {
    this.gl = gl;
    this.canvas = canvas;
    this.enabled = true;
    this.bloomOn = true;

    this.pBright = program(gl, BRIGHT);
    this.pBlur = program(gl, BLUR);
    this.pComp = program(gl, COMPOSITE);

    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.sceneTex = this._tex();
    this.fboA = this._target();
    this.fboB = this._target();
    this.w = 0; this.h = 0;
    /** @type {Map<string, WebGLUniformLocation|null>} */
    this._u = new Map();
  }

  _tex() {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _target() {
    const gl = this.gl;
    const tex = this._tex();
    const fbo = gl.createFramebuffer();
    return { tex, fbo, w: 0, h: 0 };
  }

  /**
   * @param {{tex: WebGLTexture|null, fbo: WebGLFramebuffer|null, w: number, h: number}} t
   * @param {number} w
   * @param {number} h
   */
  _sizeTarget(t, w, h) {
    if (t.w === w && t.h === h) return;
    const gl = this.gl;
    t.w = w; t.h = h;
    gl.bindTexture(gl.TEXTURE_2D, t.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t.tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /**
   * @param {number} w CSS px
   * @param {number} h CSS px
   * @param {number} dpr
   */
  resize(w, h, dpr) {
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.w = this.canvas.width;
    this.h = this.canvas.height;
    const bw = Math.max(2, this.w >> 2);
    const bh = Math.max(2, this.h >> 2);
    this._sizeTarget(this.fboA, bw, bh);
    this._sizeTarget(this.fboB, bw, bh);
  }

  /**
   * @param {WebGLProgram} p
   * @param {string} name
   * @returns {WebGLUniformLocation|null}
   */
  _loc(p, name) {
    const key = name + (p === this.pComp ? 'C' : p === this.pBlur ? 'B' : 'R');
    let l = this._u.get(key);
    if (l === undefined) { l = this.gl.getUniformLocation(p, name); this._u.set(key, l); }
    return l;
  }

  /**
   * @param {HTMLCanvasElement} source the Canvas2D scene canvas
   * @param {{time: number, speed: number, bloom: number, grain: number,
   *          barrel: number, vignette: number, flash: number,
   *          lift: number[], gain: number[], sat: number}} o
   */
  render(source, o) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);

    if (this.bloomOn) {
      gl.viewport(0, 0, this.fboA.w, this.fboA.h);
      gl.useProgram(this.pBright);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA.fbo);
      gl.uniform1i(this._loc(this.pBright, 'uTex'), 0);
      gl.uniform1f(this._loc(this.pBright, 'uThreshold'), 0.65);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.useProgram(this.pBlur);
      gl.uniform1i(this._loc(this.pBlur, 'uTex'), 0);
      for (let pass = 0; pass < 2; pass++) {
        const from = pass === 0 ? this.fboA : this.fboB;
        const to = pass === 0 ? this.fboB : this.fboA;
        gl.bindFramebuffer(gl.FRAMEBUFFER, to.fbo);
        gl.bindTexture(gl.TEXTURE_2D, from.tex);
        gl.uniform2f(this._loc(this.pBlur, 'uDir'),
          pass === 0 ? 1 / from.w : 0, pass === 0 ? 0 : 1 / from.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    gl.useProgram(this.pComp);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    gl.uniform1i(this._loc(this.pComp, 'uScene'), 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.fboA.tex);
    gl.uniform1i(this._loc(this.pComp, 'uBloom'), 1);

    gl.uniform2f(this._loc(this.pComp, 'uRes'), this.w, this.h);
    gl.uniform1f(this._loc(this.pComp, 'uTime'), o.time);
    gl.uniform1f(this._loc(this.pComp, 'uSpeed'), o.speed);
    gl.uniform1f(this._loc(this.pComp, 'uBloomAmt'), this.bloomOn ? o.bloom : 0);
    gl.uniform1f(this._loc(this.pComp, 'uGrain'), o.grain);
    gl.uniform1f(this._loc(this.pComp, 'uBarrel'), o.barrel);
    gl.uniform1f(this._loc(this.pComp, 'uVignette'), o.vignette);
    gl.uniform1f(this._loc(this.pComp, 'uFlash'), o.flash);
    gl.uniform3f(this._loc(this.pComp, 'uLift'), o.lift[0], o.lift[1], o.lift[2]);
    gl.uniform3f(this._loc(this.pComp, 'uGain'), o.gain[0], o.gain[1], o.gain[2]);
    gl.uniform1f(this._loc(this.pComp, 'uSat'), o.sat);
    gl.activeTexture(gl.TEXTURE0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
