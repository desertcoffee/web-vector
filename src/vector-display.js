// VectorDisplay: a WebGL2 simulacrum of a random-scan (vector) CRT.
//
// Model:
//  * One electron beam. Shapes are queued and traced in order at `beamSpeed`
//    display units per second; blank moves between strokes are cheap but not free.
//  * The phosphor is an accumulation buffer: a slow and a fast component for each
//    of the two phosphor colours (RGBA = green slow, orange slow, green fast,
//    orange fast). Every frame it decays, lines on the display list are refreshed
//    (holding them at a steady brightness), and the beam head deposits extra "write"
//    energy: a brief hot flash plus an afterglow that settles back over `persistence`.
//  * Refresh is continuous by default: everything drawn is held at steady brightness for
//    free. With `refresh: 'beam'` the one beam has to redraw the display list itself, pass
//    after pass; lines fade between visits, so a big screen or a slow beam leaves parts of
//    it dim (`cycleTime` says how long a pass takes).
//  * The beam spot is gaussian; each segment is the analytic integral of that spot
//    swept along it, so polylines join seamlessly. Stroke ends and sharp corners get
//    extra dwell energy, the way real deflection amplifiers linger at vertices.
//  * Bloom, a saturating tone curve (bright cores bleach toward white), tube
//    curvature, phosphor grain and a glass tint are applied in the final composite.
//    There are no scanlines: a vector monitor doesn't have any.

import { textStrokes } from './vector-font.js';

/** Linear-light RGB of each phosphor. */
export const PHOSPHORS = {
  green: [0.1, 1.0, 0.14],
  orange: [1.0, 0.26, 0.02],
};
const CHANNEL = { green: 0, orange: 1 };

const DEFAULTS = {
  width: 1024,
  height: 768,
  color: 'green',
  beamSpeed: 2400,
  persistence: 0.16,
  intensity: 1,
  focus: 1,
  curvature: 0.035,
  writeBoost: 1.6,
  flash: 9,
  dwell: 0.8,
  order: 'queue',
  refresh: 'continuous',
  glow: 1,
  maxPixelRatio: 2,
  autoStart: true,
};

const BEAM_SIGMA = 1.05; // spot size in display units at focus = 1
const MIN_SIGMA_PX = 0.8;
const FLASH_DECAY = 0.028; // seconds; the fast phosphor component that makes the beam head glint
const BLANK_COST = 0.12; // blank moves run ~8x faster than writes
const SCAN_ROW = 3; // in 'scan' order, shapes whose tops are this close count as one row
const SETTLE = 6; // fixed cost (in display units) to settle the beam at a stroke start
const DOT_COST = 10; // time a dot stroke dwells, in display units
const DOT_GAIN = 2.2;
const FLOATS_PER_INSTANCE = 9; // x0 y0 x1 y1 | slow e0 e1 | fast e0 e1 | channel
const BLOOM_LEVELS = 4;

/** Reading order: top to bottom, left to right among shapes that share a row. */
function scanSort(list) {
  list.sort((a, b) => a.top - b.top);
  for (let i = 0; i < list.length; ) {
    let j = i + 1;
    while (j < list.length && list[j].top <= list[i].top + SCAN_ROW) j++;
    if (j - i > 1) {
      const row = list.slice(i, j).sort((a, b) => a.left - b.left);
      for (let r = 0; r < row.length; r++) list[i + r] = row[r];
    }
    i = j;
  }
  return list;
}

// ---------------------------------------------------------------------------
// Shapes

function normalizeStrokes(input) {
  if (!input || !input.length) return [];
  return typeof input[0][0] === 'number' ? [input] : input;
}

function buildStroke(points) {
  const flat = [];
  for (const [x, y] of points) {
    const n = flat.length;
    if (n && Math.abs(flat[n - 2] - x) < 1e-6 && Math.abs(flat[n - 1] - y) < 1e-6) continue;
    flat.push(x, y);
  }
  const n = flat.length / 2;
  if (!n) return null;
  const pts = Float32Array.from(flat);
  const cum = new Float32Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[2 * i] - pts[2 * i - 2], pts[2 * i + 1] - pts[2 * i - 1]);
  }
  const closed = n > 2 && Math.hypot(pts[0] - pts[2 * n - 2], pts[1] - pts[2 * n - 1]) < 1e-6;
  const dir = (a, b) => {
    const dx = pts[2 * b] - pts[2 * a];
    const dy = pts[2 * b + 1] - pts[2 * a + 1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  const corner = (a, b, c) => {
    const [x0, y0] = dir(a, b);
    const [x1, y1] = dir(b, c);
    return (1 - (x0 * x1 + y0 * y1)) / 2;
  };
  // Dwell weight per vertex: 1 at open ends, 0 for straight-through, 1 for a full reversal.
  const weight = new Float32Array(n);
  if (n === 1) weight[0] = 1;
  else {
    for (let i = 1; i < n - 1; i++) weight[i] = corner(i - 1, i, i + 1);
    if (closed) weight[0] = corner(n - 2, 0, 1);
    else weight[0] = weight[n - 1] = 1;
  }
  return { pts, cum, weight, n, len: cum[n - 1], start: 0 };
}

export class Shape {
  constructor(display, strokes, opts = {}) {
    this.display = display;
    /** 'green' | 'orange' | 'alt' (the phosphor the display isn't using) | null (display default) */
    this.color = opts.color ?? null;
    this.intensity = opts.intensity ?? 1;
    /** Beam speed override for this shape, display units per second. */
    this.speed = opts.speed ?? null;
    /** Set by display.prioritize(): traced ahead of ordinary queued shapes. */
    this.priority = false;
    /** 'queued' | 'drawing' | 'drawn' | 'removed' */
    this.state = 'queued';
    this.progress = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this._build(strokes);
    /** Resolves once the beam has finished tracing this shape (or it was removed first). */
    this.drawn = new Promise((resolve) => (this._resolve = resolve));
  }

  /**
   * Replace the geometry. A shape that is already drawn stays drawn (it moves rather
   * than being re-traced); one still being traced keeps its fractional progress.
   */
  update(strokes) {
    if (this.state === 'removed') return this;
    const before = this.total;
    this._build(strokes);
    if (this.state === 'drawn') this.progress = this.total;
    else if (before > 0) this.progress = (this.progress / before) * this.total;
    return this;
  }

  translate(dx, dy) {
    this.offsetX += dx;
    this.offsetY += dy;
    return this;
  }

  /** Current top edge and left edge of the geometry, in display units. */
  get top() {
    return this.minY + this.offsetY;
  }

  get left() {
    return this.minX + this.offsetX;
  }

  remove() {
    this.display._remove(this);
  }

  _build(input) {
    this._version = (this._version ?? 0) + 1;
    this.strokes = [];
    this.minX = Infinity;
    this.minY = Infinity;
    let t = 0;
    let lastX = null;
    let lastY = null;
    for (const points of normalizeStrokes(input)) {
      const st = buildStroke(points);
      if (!st) continue;
      for (let i = 0; i < st.pts.length; i += 2) {
        if (st.pts[i] < this.minX) this.minX = st.pts[i];
        if (st.pts[i + 1] < this.minY) this.minY = st.pts[i + 1];
      }
      if (lastX !== null) t += Math.hypot(st.pts[0] - lastX, st.pts[1] - lastY) * BLANK_COST;
      t += SETTLE;
      st.start = t;
      t += st.n === 1 ? DOT_COST : st.len;
      lastX = st.pts[2 * st.n - 2];
      lastY = st.pts[2 * st.n - 1];
      this.strokes.push(st);
    }
    this.total = t;
  }
}

// ---------------------------------------------------------------------------
// GL plumbing

const HASH = `
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`;

const FULLSCREEN_VS = `#version 300 es
out vec2 v_uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  v_uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FILL_FS = `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 o;
void main() { o = u_color; }`;

const SEGMENT_VS = `#version 300 es
layout(location = 0) in vec2 a_corner;
layout(location = 1) in vec4 a_seg;
layout(location = 2) in vec4 a_energy;
layout(location = 3) in float a_channel;
uniform float u_scale;
uniform vec2 u_offset;
uniform vec2 u_res;
uniform float u_radius;
out vec2 v_pos;
flat out vec4 v_seg;
flat out vec4 v_energy;
flat out float v_channel;
void main() {
  vec2 p0 = a_seg.xy * u_scale + u_offset;
  vec2 p1 = a_seg.zw * u_scale + u_offset;
  vec2 d = p1 - p0;
  float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec2 pos = (a_corner.x < 0.0 ? p0 : p1) + (dir * a_corner.x + nrm * a_corner.y) * u_radius;
  v_pos = pos;
  v_seg = vec4(p0, p1);
  v_energy = a_energy;
  v_channel = a_channel;
  vec2 clip = pos / u_res * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const SEGMENT_FS = `#version 300 es
precision highp float;
in vec2 v_pos;
flat in vec4 v_seg;
flat in vec4 v_energy;
flat in float v_channel;
uniform float u_sigma;
out vec4 o;
float erf(float x) {
  float s = sign(x);
  float x2 = x * x;
  return s * sqrt(1.0 - exp(-x2 * (1.2732395 + 0.147 * x2) / (1.0 + 0.147 * x2)));
}
void main() {
  vec2 p0 = v_seg.xy;
  vec2 d = v_seg.zw - p0;
  float len = length(d);
  vec2 dir = len > 1e-3 ? d / len : vec2(1.0, 0.0);
  vec2 r = v_pos - p0;
  float t = dot(r, dir);
  float n = dot(r, vec2(-dir.y, dir.x));
  float inv = 1.0 / (u_sigma * u_sigma);
  float across = exp(-0.5 * n * n * inv);
  float k = 0.70710678 / u_sigma;
  float along = len > 1e-3
    ? 0.5 * (erf(t * k) - erf((t - len) * k))
    : exp(-0.5 * t * t * inv);
  float u = clamp(t / max(len, 1e-3), 0.0, 1.0);
  float spot = across * along;
  float slow = mix(v_energy.x, v_energy.y, u) * spot;
  float fast = mix(v_energy.z, v_energy.w, u) * spot;
  vec2 ch = vec2(1.0 - v_channel, v_channel);
  o = vec4(slow * ch, fast * ch);
}`;

// On 8-bit targets the bloom levels are stored pre-amplified (u_gain per downsample)
// and dithered by one step; otherwise their faint tails would band. Float targets use 1 and 0.
const DITHER = `
uniform float u_dither;
${HASH}
vec4 dither(vec4 c) { return c + (hash(gl_FragCoord.xy) - 0.5) * u_dither; }`;

const DOWNSAMPLE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_gain;
out vec4 o;
${DITHER}
void main() {
  o = dither(u_gain * 0.25 * (texture(u_tex, v_uv + vec2(-u_texel.x, -u_texel.y)) +
                     texture(u_tex, v_uv + vec2( u_texel.x, -u_texel.y)) +
                     texture(u_tex, v_uv + vec2(-u_texel.x,  u_texel.y)) +
                     texture(u_tex, v_uv + vec2( u_texel.x,  u_texel.y))));
}`;

const BLUR_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_step;
out vec4 o;
${DITHER}
void main() {
  o = dither(texture(u_tex, v_uv) * 0.2270270270
    + (texture(u_tex, v_uv + u_step * 1.3846153846) + texture(u_tex, v_uv - u_step * 1.3846153846)) * 0.3162162162
    + (texture(u_tex, v_uv + u_step * 3.2307692308) + texture(u_tex, v_uv - u_step * 3.2307692308)) * 0.0702702703);
}`;

const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_phos;
uniform sampler2D u_b0;
uniform sampler2D u_b1;
uniform sampler2D u_b2;
uniform sampler2D u_b3;
uniform vec4 u_bloom;
uniform vec3 u_col0;
uniform vec3 u_col1;
uniform vec4 u_face;   // centre.xy, half-extent.xy (uv)
uniform vec2 u_res;
uniform float u_curve;
uniform float u_range;
uniform float u_exposure;
uniform float u_time;
out vec4 o;
${HASH}

void main() {
  vec2 q = (v_uv - u_face.xy) / u_face.zw;
  vec2 qw = q * (1.0 + u_curve * q.yx * q.yx);
  vec2 uv = u_face.xy + qw * u_face.zw;

  // Picture area: a rounded rectangle in tube space.
  float aspect = (u_face.z * u_res.x) / (u_face.w * u_res.y);
  vec2 a = vec2(abs(qw.x) * aspect, abs(qw.y));
  float rad = 0.07;
  vec2 dd = a - (vec2(aspect, 1.0) - rad);
  float dist = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0) - rad;
  float px = 2.0 / (u_face.w * 2.0 * u_res.y);
  float mask = 1.0 - smoothstep(-2.0 * px, 1.0 * px, dist);

  vec4 p4 = texture(u_phos, uv);
  vec4 b4 = texture(u_b0, uv) * u_bloom.x
          + texture(u_b1, uv) * u_bloom.y
          + texture(u_b2, uv) * u_bloom.z
          + texture(u_b3, uv) * u_bloom.w;
  vec2 p = p4.rg + p4.ba;
  vec2 b = b4.rg + b4.ba;
  float grain = 0.9 + 0.2 * hash(floor(uv * u_res));
  vec2 e = (p * grain + b) * u_range;
  vec3 light = e.x * u_col0 + e.y * u_col1;
  vec3 col = 1.0 - exp(-light * u_exposure);

  // Unlit tube: near-black glass with a whisper of tint and a soft reflection.
  vec3 glass = vec3(0.00045, 0.0006, 0.00055);
  float refl = exp(-3.5 * dot((q - vec2(-0.55, 0.62)) * vec2(0.8, 1.3), (q - vec2(-0.55, 0.62)) * vec2(0.8, 1.3)));
  glass += vec3(0.0025) * refl;
  float vig = clamp(1.0 - 0.22 * dot(qw, qw), 0.0, 1.0);
  col = (col + glass) * mix(0.75, 1.0, vig) * mask;

  col = pow(col, vec3(1.0 / 2.2));
  col += (hash(gl_FragCoord.xy + fract(u_time * 7.31) * 397.0) - 0.5) * (2.0 / 255.0);
  o = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`VectorDisplay: shader compile failed\n${log}`);
  }
  return sh;
}

function program(gl, vsSrc, fsSrc) {
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vsSrc));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fsSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(`VectorDisplay: program link failed\n${gl.getProgramInfoLog(prog)}`);
  }
  const u = {};
  const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const { name } = gl.getActiveUniform(prog, i);
    u[name] = gl.getUniformLocation(prog, name);
  }
  return { prog, u };
}

// ---------------------------------------------------------------------------
// Display

export class VectorDisplay {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Partial<typeof DEFAULTS>} options
   *   width/height  logical display size; coordinates are in these units, origin top-left
   *   color         default phosphor, 'green' | 'orange'
   *   beamSpeed     tracing speed, display units per second
   *   persistence   phosphor decay time constant, seconds
   *   intensity     overall brightness
   *   focus         beam spot size multiplier (> 1 defocuses)
   *   curvature     tube barrel distortion
   *   glow          bloom strength multiplier
   *   writeBoost    afterglow added where the beam has just written (decays over `persistence`)
   *   flash         brief extra brightness at the beam head
   *   refresh       'continuous': drawn lines stay lit for free (default)
   *                 'beam': the beam must keep redrawing everything; lines fade between passes
   *   order         'queue': trace shapes in the order they were added (default)
   *                 'scan':  always trace the top-most waiting shape next, left to right
   *                          within a row, like reading (good for UIs)
   */
  constructor(canvas, options = {}) {
    const opts = { ...DEFAULTS, ...options };
    this.canvas = canvas;
    this.width = opts.width;
    this.height = opts.height;
    this.color = opts.color;
    this.beamSpeed = opts.beamSpeed;
    this.persistence = opts.persistence;
    this.intensity = opts.intensity;
    this.focus = opts.focus;
    this.curvature = opts.curvature;
    this.writeBoost = opts.writeBoost;
    this.flash = opts.flash;
    this.dwell = opts.dwell;
    this.order = opts.order;
    this.refresh = opts.refresh;
    this.glow = opts.glow;
    this.maxPixelRatio = opts.maxPixelRatio;

    this.time = 0;
    this.shapes = new Set();
    this.queue = [];
    this._frameCallbacks = new Set();
    this._instances = new Float32Array(FLOATS_PER_INSTANCE * 8192);
    this._count = 0;
    this._raf = 0;
    this._frameNo = 0;
    // 'beam' refresh: the current pass over the display list and the shape being redrawn.
    this._pass = [];
    this._passIndex = 0;
    this._passFrame = -1;
    this._redraw = null;
    this._redrawP = 0;

    this._initGL();
    this._onLost = (e) => {
      e.preventDefault();
      this._glReady = false;
    };
    this._onRestored = () => {
      this._initGL();
      this._resize(true);
    };
    canvas.addEventListener('webglcontextlost', this._onLost);
    canvas.addEventListener('webglcontextrestored', this._onRestored);
    this._observer = new ResizeObserver(() => this._resize());
    this._observer.observe(canvas);
    this._resize(true);
    if (opts.autoStart) this.start();
  }

  // -- drawing API ----------------------------------------------------------

  /**
   * Queue a shape made of strokes: [[[x, y], ...], ...]. Returns the Shape.
   * `opts.priority` puts it ahead of everything not already being traced (use it for
   * direct feedback, like a caret or the thing under the pointer).
   */
  shape(strokes, opts) {
    const s = new Shape(this, strokes, opts);
    this.shapes.add(s);
    this.queue.push(s);
    if (opts?.priority) this.prioritize(s);
    return s;
  }

  /** Move a still-queued shape to the front of the line (after other priority shapes). */
  prioritize(s) {
    const i = this.queue.indexOf(s);
    if (i < 0 || s.state !== 'queued' || s.priority) return;
    s.priority = true;
    this.queue.splice(i, 1);
    let at = 0;
    while (at < this.queue.length && (this.queue[at].state === 'drawing' || this.queue[at].priority)) at++;
    this.queue.splice(at, 0, s);
  }

  line(x0, y0, x1, y1, opts) {
    return this.shape([[[x0, y0], [x1, y1]]], opts);
  }

  /** Open polyline through `points` ([[x, y], ...]). */
  path(points, opts) {
    return this.shape([points], opts);
  }

  /** Closed polyline. */
  polygon(points, opts) {
    return this.shape([[...points, points[0]]], opts);
  }

  rect(x, y, w, h, opts) {
    return this.polygon([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], opts);
  }

  circle(cx, cy, r, opts = {}) {
    const n = opts.segments ?? Math.max(16, Math.ceil(r * 0.75));
    const start = opts.startAngle ?? -Math.PI / 2;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = start + (i / n) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return this.polygon(pts, opts);
  }

  /** Stroke-font text. Options: size (cap height), spacing, lineHeight, align, plus shape options. */
  text(str, x, y, opts = {}) {
    return this.shape(textStrokes(str, x, y, opts), opts);
  }

  /** Remove every shape; the phosphor fades out on its own. */
  clear() {
    for (const s of [...this.shapes]) s.remove();
  }

  /** Resolves when everything queued so far has been traced. */
  idle() {
    return Promise.all(this.queue.map((s) => s.drawn)).then(() => undefined);
  }

  get busy() {
    return this.queue.length > 0;
  }

  /** Seconds for the beam to trace everything on the display list once. */
  get cycleTime() {
    let t = 0;
    for (const s of this.shapes) t += s.total / Math.max(1, s.speed ?? this.beamSpeed);
    return t;
  }

  /** Run `fn(dt, time)` every frame before the beam moves. Returns an unsubscribe function. */
  onFrame(fn) {
    this._frameCallbacks.add(fn);
    return () => this._frameCallbacks.delete(fn);
  }

  /** Map a pointer position to display coordinates (accounts for tube curvature). */
  clientToDisplay(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const f = this._fit;
    const cu = f.faceCx / f.w;
    const cv = 1 - f.faceCy / f.h;
    const hu = (this.width * f.scale) / 2 / f.w;
    const hv = (this.height * f.scale) / 2 / f.h;
    const u = (clientX - rect.left) / rect.width;
    const v = 1 - (clientY - rect.top) / rect.height;
    const qx = (u - cu) / hu;
    const qy = (v - cv) / hv;
    const wu = cu + qx * (1 + this.curvature * qy * qy) * hu;
    const wv = cv + qy * (1 + this.curvature * qx * qx) * hv;
    return [(wu * f.w - f.offsetX) / f.scale, ((1 - wv) * f.h - f.offsetY) / f.scale];
  }

  start() {
    if (this._raf) return;
    this._last = performance.now();
    const tick = (now) => {
      this._raf = requestAnimationFrame(tick);
      this._frame(now);
    };
    this._raf = requestAnimationFrame(tick);
  }

  stop() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  destroy() {
    this.stop();
    this._observer.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this._onLost);
    this.canvas.removeEventListener('webglcontextrestored', this._onRestored);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  // -- internals ------------------------------------------------------------

  _remove(s) {
    if (s.state === 'removed') return;
    s.state = 'removed';
    this.shapes.delete(s);
    const i = this.queue.indexOf(s);
    if (i >= 0) this.queue.splice(i, 1);
    s._resolve(s);
  }

  _channel(s) {
    const c = s.color ?? this.color;
    if (c === 'alt') return this.color === 'green' ? 1 : 0;
    return CHANNEL[c] ?? 0;
  }

  _initGL() {
    const gl = this.canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('VectorDisplay: WebGL2 is not available');
    this.gl = gl;

    // Prefer a half-float phosphor buffer; fall back to 8-bit with scaled energies.
    this._float = !!gl.getExtension('EXT_color_buffer_float');
    this._range = this._float ? 1 : 6;

    this._fill = program(gl, FULLSCREEN_VS, FILL_FS);
    this._seg = program(gl, SEGMENT_VS, SEGMENT_FS);
    this._down = program(gl, FULLSCREEN_VS, DOWNSAMPLE_FS);
    this._blur = program(gl, FULLSCREEN_VS, BLUR_FS);
    this._comp = program(gl, FULLSCREEN_VS, COMPOSITE_FS);

    this._emptyVao = gl.createVertexArray();

    this._segVao = gl.createVertexArray();
    gl.bindVertexArray(this._segVao);
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this._instanceBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuf);
    const stride = FLOATS_PER_INSTANCE * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 32);
    gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);

    this._targets = [];
    this._phos = null;
    this._glReady = true;
  }

  _target(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this._float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const t = { tex, fbo, w, h };
    this._targets.push(t);
    return t;
  }

  _resize(force = false) {
    if (!this._glReady) return;
    const dpr = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(16, Math.round(rect.width * dpr));
    const h = Math.max(16, Math.round(rect.height * dpr));
    if (!force && w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w;
    this.canvas.height = h;

    const gl = this.gl;
    const oldTargets = this._targets;
    const oldPhos = this._phos;
    const oldFit = this._fit;
    this._targets = [];
    this._phos = this._target(w, h);
    this._bloom = [];
    let bw = w;
    let bh = h;
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      bw = Math.max(1, bw >> 1);
      bh = Math.max(1, bh >> 1);
      this._bloom.push({ a: this._target(bw, bh), b: this._target(bw, bh) });
    }

    const scale = Math.min(w / this.width, h / this.height);
    const offsetX = (w - this.width * scale) / 2;
    const offsetY = (h - this.height * scale) / 2;

    // Carry the glowing phosphor across the resize instead of flashing to black.
    if (oldPhos) {
      const rect = (f, s, ox, oy) => {
        const x0 = Math.round(ox);
        const y0 = Math.round(f.h - oy - this.height * s);
        return [x0, y0, Math.round(x0 + this.width * s), Math.round(y0 + this.height * s)];
      };
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, oldPhos.fbo);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._phos.fbo);
      gl.blitFramebuffer(
        ...rect(oldFit, oldFit.scale, oldFit.offsetX, oldFit.offsetY),
        ...rect({ h }, scale, offsetX, offsetY),
        gl.COLOR_BUFFER_BIT,
        gl.LINEAR,
      );
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    }
    for (const t of oldTargets) {
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fbo);
    }

    this._fit = {
      w,
      h,
      scale,
      offsetX,
      offsetY,
      faceCx: offsetX + (this.width * scale) / 2,
      faceCy: offsetY + (this.height * scale) / 2,
    };

    // Resizing cleared the canvas, and ResizeObserver runs after this frame's rAF:
    // repaint now (no decay, no new energy) so the browser doesn't show a blank frame.
    if (oldPhos) {
      this._count = 0;
      this._render(1, 1);
    }
  }

  _push(x0, y0, x1, y1, e0, e1, f0, f1, ch) {
    let buf = this._instances;
    const i = this._count * FLOATS_PER_INSTANCE;
    if (i + FLOATS_PER_INSTANCE > buf.length) {
      const grown = new Float32Array(buf.length * 2);
      grown.set(buf);
      this._instances = buf = grown;
    }
    buf[i] = x0;
    buf[i + 1] = y0;
    buf[i + 2] = x1;
    buf[i + 3] = y1;
    buf[i + 4] = e0;
    buf[i + 5] = e1;
    buf[i + 6] = f0;
    buf[i + 7] = f1;
    buf[i + 8] = ch;
    this._count++;
  }

  _gain(s) {
    return (s.intensity * this.intensity) / this._range / this._focusNorm;
  }

  /**
   * The shape the beam works on next, moved to the front of the queue. A shape already
   * being traced always finishes first, and priority shapes keep their place; otherwise
   * 'scan' order picks the top-most waiting shape (left-most within its row).
   */
  _head() {
    const q = this.queue;
    const first = q[0];
    if (this.order !== 'scan' || first.state === 'drawing' || first.priority) return first;
    let top = Infinity;
    for (const s of q) if (s.top < top) top = s.top;
    let best = 0;
    let left = Infinity;
    for (let i = 0; i < q.length; i++) {
      const s = q[i];
      if (s.top <= top + SCAN_ROW && s.left < left) {
        best = i;
        left = s.left;
      }
    }
    if (best) q.unshift(q.splice(best, 1)[0]);
    return q[0];
  }

  /** Advance the beam through the queue, depositing write energy along its path. */
  _advance(dt, tau) {
    let left = dt;
    while (left > 1e-9 && this.queue.length) {
      const s = this._head();
      s.state = 'drawing';
      const speed = Math.max(1, s.speed ?? this.beamSpeed);
      const need = (s.total - s.progress) / speed;
      const t0 = dt - left;
      if (need <= left) {
        this._sweep(s, s.progress, s.total, t0, t0 + need, dt, tau, this.writeBoost, this.flash, 0);
        s.progress = s.total;
        left -= need;
        this.queue.shift();
        s.state = 'drawn';
        s._resolve(s);
      } else {
        const p = s.progress + left * speed;
        this._sweep(s, s.progress, p, t0, dt, dt, tau, this.writeBoost, this.flash, 0);
        s.progress = p;
        left = 0;
      }
    }
  }

  /**
   * 'beam' refresh. New shapes are traced first (at full brightness plus the write glow);
   * the rest of the time the beam walks the display list redrawing what's there. A redraw
   * tops a line back up to full brightness, so how dim it got depends only on how long the
   * beam took to come back round. A shape that moved since its last visit is dark where it
   * is now, so it gets a full deposit.
   */
  _advanceBeam(dt, tau) {
    let left = dt;
    while (left > 1e-9) {
      const t0 = dt - left;
      if (this.queue.length) {
        const s = this._head();
        s.state = 'drawing';
        const speed = Math.max(1, s.speed ?? this.beamSpeed);
        const need = (s.total - s.progress) / speed;
        const end = Math.min(s.total, s.progress + left * speed);
        this._sweep(s, s.progress, end, t0, t0 + Math.min(need, left), dt, tau, 1 + this.writeBoost, this.flash, this.dwell);
        s.progress = end;
        if (need <= left) {
          left -= need;
          this.queue.shift();
          s.state = 'drawn';
          this._markLit(s);
          s._resolve(s);
        } else left = 0;
        continue;
      }
      const s = this._nextRedraw();
      if (!s) break;
      const speed = Math.max(1, s.speed ?? this.beamSpeed);
      const lit = s.litV === s._version && s.litX === s.offsetX && s.litY === s.offsetY;
      const top = lit ? 1 - Math.exp(-(this.time - s.litAt) / tau) : 1;
      const from = Math.min(this._redrawP, s.total);
      const need = (s.total - from) / speed;
      const end = Math.min(s.total, from + left * speed);
      this._sweep(s, from, end, t0, t0 + Math.min(need, left), dt, tau, top, this.flash * top, this.dwell * top);
      if (need <= left) {
        left -= need;
        this._markLit(s);
        this._redraw = null;
      } else {
        this._redrawP = end;
        left = 0;
      }
    }
  }

  /** Next shape to redraw, starting a new pass (at most one per frame) when one ends. */
  _nextRedraw() {
    const cur = this._redraw;
    if (cur?.state === 'drawn' && this._redrawP < cur.total) return cur;
    for (;;) {
      while (this._passIndex < this._pass.length) {
        const s = this._pass[this._passIndex++];
        if (s.state === 'drawn' && s.total > 0) {
          this._redraw = s;
          this._redrawP = 0;
          return s;
        }
      }
      if (this._passFrame === this._frameNo) return null;
      this._passFrame = this._frameNo;
      this._pass = [...this.shapes].filter((s) => s.state === 'drawn');
      if (this.order === 'scan') scanSort(this._pass);
      this._passIndex = 0;
      if (!this._pass.length) return null;
    }
  }

  _markLit(s) {
    s.litAt = this.time;
    s.litV = s._version;
    s.litX = s.offsetX;
    s.litY = s.offsetY;
  }

  /**
   * Trace progress p0..p1 of a shape between frame times t0..t1. `slowK`, `fastK` and
   * `dwellK` scale the afterglow, the head flash and the corner dwell deposited.
   */
  _sweep(s, p0, p1, t0, t1, dt, tau, slowK, fastK, dwellK) {
    if (p1 <= p0) return;
    const ch = this._channel(s);
    const gain = this._gain(s);
    const slow = slowK * gain;
    const fast = fastK * gain;
    const dwell = dwellK * gain;
    const ox = s.offsetX;
    const oy = s.offsetY;
    // Energy deposited at progress p, already decayed to the end of this frame.
    const age = (p) => dt - (t0 + ((p - p0) / (p1 - p0)) * (t1 - t0));
    const glow = (p) => Math.exp(-age(p) / tau);
    const energy = (p) => slow * glow(p);
    const flash = (p) => fast * Math.exp(-age(p) / FLASH_DECAY);
    for (const st of s.strokes) {
      if (st.start >= p1) break;
      const { pts, cum } = st;
      if (st.n === 1) {
        if (st.start >= p0) {
          const e = energy(st.start) * DOT_GAIN;
          const fl = flash(st.start) * DOT_GAIN;
          this._push(pts[0] + ox, pts[1] + oy, pts[0] + ox, pts[1] + oy, e, e, fl, fl, ch);
        }
        continue;
      }
      const a = Math.max(p0, st.start) - st.start;
      const b = Math.min(p1, st.start + st.len) - st.start;
      if (b <= a) continue;
      for (let j = 0; j < st.n - 1; j++) {
        const sa = cum[j];
        const sb = cum[j + 1];
        if (sb <= a) continue;
        if (sa >= b) break;
        const seg = sb - sa;
        if (seg < 1e-6) continue;
        const la = Math.max(a, sa);
        const lb = Math.min(b, sb);
        const fa = (la - sa) / seg;
        const fb = (lb - sa) / seg;
        const x0 = pts[2 * j];
        const y0 = pts[2 * j + 1];
        const dx = pts[2 * j + 2] - x0;
        const dy = pts[2 * j + 3] - y0;
        this._push(
          x0 + dx * fa + ox,
          y0 + dy * fa + oy,
          x0 + dx * fb + ox,
          y0 + dy * fb + oy,
          energy(st.start + la),
          energy(st.start + lb),
          flash(st.start + la),
          flash(st.start + lb),
          ch,
        );
      }
      if (dwell > 0) {
        for (let j = 0; j < st.n; j++) {
          const c = cum[j];
          if (c < a) continue;
          if (c > b || (c === b && b < st.len)) break;
          if (st.weight[j] <= 0.01) continue;
          const d = dwell * st.weight[j] * glow(st.start + c);
          const x = pts[2 * j] + ox;
          const y = pts[2 * j + 1] + oy;
          this._push(x, y, x, y, d, d, 0, 0, ch);
        }
      }
    }
  }

  /** Re-excite everything the beam has drawn so far, holding it at steady brightness. */
  _refresh(s, base) {
    const ch = this._channel(s);
    const e = base * this._gain(s);
    const dwell = e * this.dwell;
    const ox = s.offsetX;
    const oy = s.offsetY;
    const p = s.progress;
    for (const st of s.strokes) {
      if (st.start >= p) break;
      const { pts, cum, weight } = st;
      if (st.n === 1) {
        this._push(pts[0] + ox, pts[1] + oy, pts[0] + ox, pts[1] + oy, e * DOT_GAIN, e * DOT_GAIN, 0, 0, ch);
        continue;
      }
      const local = Math.min(p - st.start, st.len);
      for (let j = 0; j < st.n - 1; j++) {
        const sa = cum[j];
        if (sa >= local) break;
        const sb = cum[j + 1];
        const seg = sb - sa;
        if (weight[j] > 0.01) {
          const w = dwell * weight[j];
          this._push(pts[2 * j] + ox, pts[2 * j + 1] + oy, pts[2 * j] + ox, pts[2 * j + 1] + oy, w, w, 0, 0, ch);
        }
        if (seg < 1e-6) continue;
        const f = Math.min(1, (local - sa) / seg);
        const x0 = pts[2 * j];
        const y0 = pts[2 * j + 1];
        this._push(
          x0 + ox,
          y0 + oy,
          x0 + (pts[2 * j + 2] - x0) * f + ox,
          y0 + (pts[2 * j + 3] - y0) * f + oy,
          e,
          e,
          0,
          0,
          ch,
        );
      }
      const last = st.n - 1;
      if (local >= st.len && weight[last] > 0.01) {
        const d = dwell * weight[last];
        this._push(pts[2 * last] + ox, pts[2 * last + 1] + oy, pts[2 * last] + ox, pts[2 * last + 1] + oy, d, d, 0, 0, ch);
      }
    }
  }

  _frame(now) {
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (!this._glReady || !(dt > 0)) return;
    dt = Math.min(dt, 0.05);
    this.time += dt;
    for (const fn of this._frameCallbacks) fn(dt, this.time);

    const sigmaPx = (f) => Math.max(BEAM_SIGMA * f * this._fit.scale, MIN_SIGMA_PX);
    this._sigma = sigmaPx(this.focus);
    this._focusNorm = this._sigma / sigmaPx(1);

    const tau = Math.max(this.persistence, 0.005);
    const k = Math.exp(-dt / tau);
    this._count = 0;
    this._frameNo++;
    if (this.refresh === 'beam') this._advanceBeam(dt, tau);
    else {
      this._advance(dt, tau);
      for (const s of this.shapes) {
        if (s.state === 'queued') continue;
        this._refresh(s, 1 - k);
        this._markLit(s);
      }
    }
    this._render(k, Math.exp(-dt / FLASH_DECAY));
  }

  _render(k, kFast) {
    const gl = this.gl;
    const f = this._fit;
    const phos = this._phos;

    // 1. Phosphor decay, in place.
    gl.bindFramebuffer(gl.FRAMEBUFFER, phos.fbo);
    gl.viewport(0, 0, phos.w, phos.h);
    gl.bindVertexArray(this._emptyVao);
    gl.useProgram(this._fill.prog);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ZERO, gl.CONSTANT_COLOR);
    gl.blendColor(k, k, kFast, kFast);
    gl.uniform4f(this._fill.u.u_color, 0, 0, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!this._float) {
      // 8-bit storage can't decay below one step by multiplication alone.
      gl.blendEquation(gl.FUNC_REVERSE_SUBTRACT);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniform4f(this._fill.u.u_color, 1 / 255, 1 / 255, 1 / 255, 1 / 255);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.blendEquation(gl.FUNC_ADD);
    }

    // 2. Beam energy, additive, clipped to the display area.
    if (this._count) {
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(
        Math.floor(f.offsetX),
        Math.floor(f.offsetY),
        Math.ceil(this.width * f.scale),
        Math.ceil(this.height * f.scale),
      );
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(this._seg.prog);
      const u = this._seg.u;
      gl.uniform1f(u.u_scale, f.scale);
      gl.uniform2f(u.u_offset, f.offsetX, f.offsetY);
      gl.uniform2f(u.u_res, phos.w, phos.h);
      gl.uniform1f(u.u_sigma, this._sigma);
      gl.uniform1f(u.u_radius, this._sigma * 3.5 + 1);
      gl.bindVertexArray(this._segVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this._instanceBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this._instances.subarray(0, this._count * FLOATS_PER_INSTANCE), gl.STREAM_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this._count);
      gl.disable(gl.SCISSOR_TEST);
    }
    gl.disable(gl.BLEND);

    // 3. Bloom pyramid.
    gl.bindVertexArray(this._emptyVao);
    const dither = this._float ? 0 : 1 / 255;
    const gain = this._float ? 1 : 2;
    let src = phos;
    for (const lvl of this._bloom) {
      gl.useProgram(this._down.prog);
      gl.bindFramebuffer(gl.FRAMEBUFFER, lvl.a.fbo);
      gl.viewport(0, 0, lvl.a.w, lvl.a.h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(this._down.u.u_tex, 0);
      gl.uniform2f(this._down.u.u_texel, 1 / src.w, 1 / src.h);
      gl.uniform1f(this._down.u.u_dither, dither);
      gl.uniform1f(this._down.u.u_gain, gain);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      gl.useProgram(this._blur.prog);
      gl.uniform1i(this._blur.u.u_tex, 0);
      gl.uniform1f(this._blur.u.u_dither, dither);
      gl.bindFramebuffer(gl.FRAMEBUFFER, lvl.b.fbo);
      gl.bindTexture(gl.TEXTURE_2D, lvl.a.tex);
      gl.uniform2f(this._blur.u.u_step, 1 / lvl.a.w, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, lvl.a.fbo);
      gl.bindTexture(gl.TEXTURE_2D, lvl.b.tex);
      gl.uniform2f(this._blur.u.u_step, 0, 1 / lvl.a.h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      src = lvl.a;
    }

    // 4. Composite to the canvas.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, f.w, f.h);
    const c = this._comp;
    gl.useProgram(c.prog);
    const texs = [phos, ...this._bloom.map((l) => l.a)];
    ['u_phos', 'u_b0', 'u_b1', 'u_b2', 'u_b3'].forEach((name, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, texs[i].tex);
      gl.uniform1i(c.u[name], i);
    });
    const g = this.glow;
    const lg = this._float ? [1, 1, 1, 1] : [2, 4, 8, 16];
    gl.uniform4f(c.u.u_bloom, (0.9 * g) / lg[0], (0.8 * g) / lg[1], (0.45 * g) / lg[2], (0.25 * g) / lg[3]);
    gl.uniform3fv(c.u.u_col0, PHOSPHORS.green);
    gl.uniform3fv(c.u.u_col1, PHOSPHORS.orange);
    gl.uniform4f(
      c.u.u_face,
      f.faceCx / f.w,
      1 - f.faceCy / f.h,
      (this.width * f.scale) / 2 / f.w,
      (this.height * f.scale) / 2 / f.h,
    );
    gl.uniform2f(c.u.u_res, f.w, f.h);
    gl.uniform1f(c.u.u_curve, this.curvature);
    gl.uniform1f(c.u.u_range, this._range);
    gl.uniform1f(c.u.u_exposure, 1.3);
    gl.uniform1f(c.u.u_time, this.time);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }
}
