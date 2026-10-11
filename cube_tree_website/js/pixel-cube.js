/**
 * pixel-cube.js — the cube simulator and visualiser (README "Cube").
 *
 * A small software renderer, no libraries: the 27 cubies and 54 stickers
 * are 3D quads seen through a perspective camera, rasterised into a
 * low-resolution buffer with a z-buffer and scaled up without smoothing, so
 * the cube reads as pixel art (UI_references/cube_image.png). Canvas paths
 * anti-alias their edges and cannot give crisp pixels; this does.
 *
 * The cube's state is a facelet string in facelet-cube.js's layout (U R F D
 * L B, 9 each, row-major); applyAlgorithm there is the only source of truth
 * for what a move does. The geometry here only animates a turn: which
 * stickers a move carries and in which direction is checked against
 * MOVE_TABLE for every token (test/pixel-cube.test.js), never hand-trusted.
 */
'use strict';

// ---------------------------------------------------------------------------
// Geometry: sticker positions and turns
// ---------------------------------------------------------------------------

// Each face: its outward normal and the 3D directions of its rows (down the
// face) and columns (across), as the facelet layout reads a face from
// outside (README of facelet-cube.js: Kociemba's convention). Verified by
// the move test, not assumed.
const PC_FACES = [
  { n: [0, 1, 0], row: [0, 0, 1], col: [1, 0, 0] },   // U: rows from the back toward the front
  { n: [1, 0, 0], row: [0, -1, 0], col: [0, 0, -1] }, // R
  { n: [0, 0, 1], row: [0, -1, 0], col: [1, 0, 0] },  // F
  { n: [0, -1, 0], row: [0, 0, -1], col: [1, 0, 0] }, // D: rows from the front toward the back
  { n: [-1, 0, 0], row: [0, -1, 0], col: [0, 0, 1] }, // L
  { n: [0, 0, -1], row: [0, -1, 0], col: [-1, 0, 0] }, // B
];

/** For each facelet: { face, n, cubie: [x,y,z] in -1..1, pos: sticker centre (cubie + n/2), row, col }. */
function stickerLayout() {
  const out = [];
  PC_FACES.forEach((f, face) => {
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cubie = [0, 1, 2].map(k => f.n[k] + (r - 1) * f.row[k] + (c - 1) * f.col[k]);
        out.push({ face, n: f.n, row: f.row, col: f.col, cubie, pos: cubie.map((v, k) => v + f.n[k] / 2) });
      }
    }
  });
  return out;
}
const PC_STICKERS = stickerLayout();

// A move: rotation axis (0 x, 1 y, 2 z), the layers it turns (coordinates on
// that axis), and its quarter turns about the axis's positive direction
// (right-handed). The signs are fixed by the move test against MOVE_TABLE.
const PC_MOVE_BASE = {
  R: [0, [1], -1], L: [0, [-1], 1], M: [0, [0], 1], x: [0, [-1, 0, 1], -1], r: [0, [0, 1], -1], l: [0, [-1, 0], 1],
  U: [1, [1], -1], D: [1, [-1], 1], E: [1, [0], 1], y: [1, [-1, 0, 1], -1], u: [1, [0, 1], -1], d: [1, [-1, 0], 1],
  F: [2, [1], -1], B: [2, [-1], 1], S: [2, [0], -1], z: [2, [-1, 0, 1], -1], f: [2, [0, 1], -1], b: [2, [-1, 0], 1],
};

/** { axis, layers, quarters } of a move token (quarters in -2..2), or null. */
function moveGeometry(token) {
  const m = /^([URFDLBMESxyzurfdlb])(2'|2|'|)$/.exec(token || '');
  if (!m) return null;
  const [axis, layers, dir] = PC_MOVE_BASE[m[1]];
  const q = m[2] === "'" ? -dir : m[2].startsWith('2') ? 2 * dir : dir;
  return { axis, layers, quarters: q };
}

/** v rotated by `angle` radians about axis 0/1/2 (right-handed). */
function rotateVec(v, axis, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const [x, y, z] = v;
  if (axis === 0) return [x, y * c - z * s, y * s + z * c];
  if (axis === 1) return [x * c + z * s, y, -x * s + z * c];
  return [x * c - y * s, x * s + y * c, z];
}

const posKey = p => p.map(v => Math.round(v * 2)).join(',');
const PC_INDEX_BY_POS = new Map(PC_STICKERS.map((s, i) => [posKey(s.pos), i]));

/**
 * The facelet permutation the geometry gives for a token, in MOVE_TABLE's
 * form: after[i] = before[perm[i]].
 */
function geometryPerm(token) {
  const g = moveGeometry(token);
  if (!g) return null;
  const perm = Array.from({ length: 54 }, (_, i) => i);
  const angle = g.quarters * Math.PI / 2;
  PC_STICKERS.forEach((s, j) => {
    if (!g.layers.includes(Math.round(s.cubie[g.axis]))) return;
    const i = PC_INDEX_BY_POS.get(posKey(rotateVec(s.pos, g.axis, angle)));
    perm[i] = j;
  });
  return perm;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

// Sticker colours by facelet letter: [light, base, dark] shades.
const PC_COLOURS = {
  W: ['#ffffff', '#e9e9e4', '#b9b9b2'],
  Y: ['#fff27a', '#ffd500', '#c9a200'],
  G: ['#5cf58a', '#17c84c', '#0e8c35'],
  B: ['#6f9bff', '#1e5bff', '#1238b0'],
  R: ['#ff6a5c', '#e8231c', '#a51510'],
  O: ['#ffb45c', '#ff8a00', '#c26400'],
};
const PC_BODY = ['#3a3a3a', '#1c1c1c', '#0c0c0c'];

// Internal resolution per pixel setting (README "Look": reduce pixel art):
// art pixels across the stage.
const PC_RESOLUTIONS = { chunky: 170, fine: 400, smooth: 0 };

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

class PixelCube {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.facelets = opts.facelets || SOLVED_FACELETS;
    this.resolution = opts.resolution || 'chunky';
    this.backFaces = opts.backFaces !== false;
    this.yaw = PixelCube.DEFAULT_YAW;
    this.pitch = PixelCube.DEFAULT_PITCH;
    this.anim = null; // { axis, layers, angle }
    this.theme = { bg: [22, 22, 24], line: [241, 241, 238], floor: [255, 255, 255, 15] };
    this.palette = {};
    for (const [k, shades] of Object.entries(PC_COLOURS)) this.palette[k] = shades.map(hexToRgb);
    this.bodyRgb = PC_BODY.map(hexToRgb);
    this._raf = 0;
    this.resize();
  }

  setFacelets(f) { this.facelets = f; this.draw(); }
  setResolution(mode) { this.resolution = PC_RESOLUTIONS[mode] !== undefined ? mode : 'chunky'; this.resize(); }
  setBackFaces(on) { this.backFaces = !!on; this.draw(); }
  setTheme({ bg, line, floor }) {
    if (bg) this.theme.bg = hexToRgb(bg);
    if (line) this.theme.line = hexToRgb(line);
    if (floor) this.theme.floor = floor;
    this.draw();
  }
  resetView() { this.yaw = PixelCube.DEFAULT_YAW; this.pitch = PixelCube.DEFAULT_PITCH; this.draw(); }
  orbit(dYaw, dPitch) {
    this.yaw += dYaw;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dPitch));
    this.draw();
  }

  /** Matches the internal buffer to the canvas's on-screen size and the pixel setting. */
  resize() {
    const rect = this.canvas.getBoundingClientRect ? this.canvas.getBoundingClientRect() : { width: 300, height: 270 };
    const cssW = Math.max(60, rect.width || 300);
    const cssH = Math.max(60, rect.height || cssW * 0.9);
    const across = PC_RESOLUTIONS[this.resolution];
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const w = across ? Math.min(across, Math.round(cssW * dpr)) : Math.min(1600, Math.round(cssW * Math.min(2, dpr)));
    const h = Math.max(40, Math.round(w * cssH / cssW));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.canvas.style.imageRendering = across ? 'pixelated' : 'auto';
    this.W = w;
    this.H = h;
    this.img = this.ctx.createImageData(w, h);
    this.zbuf = new Float32Array(w * h);
    this.ibuf = new Int32Array(w * h);
    this.sbuf = new Uint8Array(w * h);
    this.draw();
  }

  /** Animates one move token; resolves when done (the caller then sets the new facelets). */
  animateMove(token, ms = 160) {
    const g = moveGeometry(token);
    if (!g || ms <= 0 || typeof requestAnimationFrame === 'undefined') return Promise.resolve();
    const total = g.quarters * Math.PI / 2;
    const duration = ms * (Math.abs(g.quarters) === 2 ? 1.5 : 1);
    return new Promise((resolve) => {
      const start = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - start) / duration);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        this.anim = { axis: g.axis, layers: g.layers, angle: total * e };
        this.draw();
        if (t < 1) this._raf = requestAnimationFrame(step);
        else { this.anim = null; resolve(); }
      };
      this._raf = requestAnimationFrame(step);
    });
  }

  stop() { if (this._raf) cancelAnimationFrame(this._raf); this.anim = null; }

  // --- camera ---
  _view(p) {
    // world -> view: yaw about y, then pitch about x; camera on +z at distance D
    const [x0, y0, z0] = p;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const x1 = x0 * cy + z0 * sy;
    const z1 = -x0 * sy + z0 * cy;
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const y2 = y0 * cp - z1 * sp;
    const z2 = y0 * sp + z1 * cp;
    return [x1, y2, z2];
  }
  _project(v) {
    // perspective; the scale fits the cube and its back-face panels in the
    // smaller of the stage's two sides
    const D = 11;
    const f = Math.min(this.W, this.H) * 1.32;
    const depth = D - v[2];
    return [this.W / 2 + v[0] * f / depth, this.H * 0.5 - v[1] * f / depth, depth];
  }

  /** The 3D point after the running turn (if its cubie is in the turning layers). */
  _animated(p, cubie) {
    const a = this.anim;
    if (!a || !a.layers.includes(Math.round(cubie[a.axis]))) return p;
    return rotateVec(p, a.axis, a.angle);
  }

  draw() {
    if (!this.img) return;
    const { W, H } = this;
    const data = this.img.data;
    const z = this.zbuf;
    const ib = this.ibuf;
    const sb = this.sbuf;
    z.fill(Infinity);
    ib.fill(-1);
    sb.fill(0);
    const quads = [];
    // cubie bodies: a quad per outward face of each cubie (inner faces only
    // show while a layer turns, so every face is drawn; the z-buffer sorts)
    // Only faces that can show: the cube's outer faces, and while a layer
    // turns, the faces on the planes it slides along.
    const body = 0.5; // no gaps between cubies: the background must not show through
    const a = this.anim;
    const turning = c => !!a && a.layers.includes(c[a.axis]);
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let zc = -1; zc <= 1; zc++) {
          if (!x && !y && !zc) continue;
          const cubie = [x, y, zc];
          for (const f of PC_FACES) {
            const nb = [x + f.n[0], y + f.n[1], zc + f.n[2]];
            const outer = Math.abs(nb[0]) > 1 || Math.abs(nb[1]) > 1 || Math.abs(nb[2]) > 1;
            if (!outer && turning(cubie) === turning(nb)) continue;
            const c = cubie.map((v, k) => v + f.n[k] * body);
            quads.push({ c, n: f.n, u: f.col.map(v => v * body), v: f.row.map(v => v * body), cubie, kind: 0, colour: null });
          }
        }
      }
    }
    // stickers, and the back-face ghosts (CubeDB's "back faces")
    const viewDir = this._viewDirWorld();
    PC_STICKERS.forEach((s, i) => {
      const half = 0.41;
      const lift = 0.5 + 0.004;
      const c = s.cubie.map((v, k) => v + s.n[k] * lift);
      const colour = this.facelets[i];
      quads.push({ c, n: s.n, u: s.col.map(v => v * half), v: s.row.map(v => v * half), cubie: s.cubie, kind: 1, colour, id: i });
      if (this.backFaces) {
        // a face turned away from the camera is shown as a panel floating
        // beyond it (seen from behind, so it reads as a mirror)
        const facing = s.n[0] * viewDir[0] + s.n[1] * viewDir[1] + s.n[2] * viewDir[2];
        if (facing > 0.2) {
          const g = s.cubie.map((v, k) => v * 0.92 + s.n[k] * 2.35);
          quads.push({ c: g, n: s.n, u: s.col.map(v => v * 0.4), v: s.row.map(v => v * 0.4), cubie: s.cubie, kind: 2, colour, id: 100 + i });
        }
      }
    });
    quads.forEach((q, qi) => this._raster(q, qi));
    // shade (sticker bevels: top/left edge pixels light, bottom/right dark)
    const bg = this.theme.bg;
    const line = this.theme.line;
    const N = W * H;
    const kinds = new Int8Array(quads.length);
    const tones = quads.map((q, i) => { kinds[i] = q.kind; return q.kind ? (this.palette[q.colour] || this.palette.W) : null; });
    const bodyRgb = this.bodyRgb[1];
    for (let p = 0; p < N; p++) {
      const o = p * 4;
      const qi = ib[p];
      if (qi < 0) { data[o] = bg[0]; data[o + 1] = bg[1]; data[o + 2] = bg[2]; data[o + 3] = 255; continue; }
      const kind = kinds[qi];
      if (kind === 0) { data[o] = bodyRgb[0]; data[o + 1] = bodyRgb[1]; data[o + 2] = bodyRgb[2]; data[o + 3] = 255; continue; }
      const x = p % W;
      let t = sb[p];
      if ((p >= W && ib[p - W] !== qi) || (x > 0 && ib[p - 1] !== qi)) { if (t > 0) t--; }
      else if ((p + W < N && ib[p + W] !== qi) || (x < W - 1 && ib[p + 1] !== qi)) { if (t < 2) t++; }
      const c = tones[qi][t];
      if (kind === 2) {
        data[o] = (c[0] * 0.62 + bg[0] * 0.38) | 0;
        data[o + 1] = (c[1] * 0.62 + bg[1] * 0.38) | 0;
        data[o + 2] = (c[2] * 0.62 + bg[2] * 0.38) | 0;
      } else { data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; }
      data[o + 3] = 255;
    }
    // a one-pixel outline around the cube's silhouette in the theme's line colour
    const solid = (k) => { const qi = ib[k]; return qi >= 0 && kinds[qi] !== 2; };
    for (let p = 0; p < N; p++) {
      if (ib[p] >= 0 && kinds[ib[p]] !== 2) continue;
      const x = p % W;
      if ((p >= W && solid(p - W)) || (p + W < N && solid(p + W)) || (x > 0 && solid(p - 1)) || (x < W - 1 && solid(p + 1))) {
        const o = p * 4;
        data[o] = line[0]; data[o + 1] = line[1]; data[o + 2] = line[2];
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  _viewDirWorld() {
    // the direction from the cube toward... away from the camera, in world space
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // camera looks along -z in view space; view = Rx(pitch) * Ry(yaw) * world
    // away-from-camera direction in view space is (0,0,-1); invert the rotation
    const vx = 0, vy = 0, vz = -1;
    const y1 = vy * cp + vz * sp;
    const z1 = -vy * sp + vz * cp;
    const x0 = vx * cy - z1 * sy;
    const z0 = vx * sy + z1 * cy;
    return [x0, y1, z0];
  }

  _raster(q, qi) {
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => {
      const p = [0, 1, 2].map(k => q.c[k] + a * q.u[k] + b * q.v[k]);
      return this._project(this._view(this._animated(p, q.cubie)));
    });
    // light: the normal after the turn, in view space
    let shade = 1;
    if (q.kind !== 0) {
      const n = this._view(this._animated(q.n, q.cubie));
      const lit = n[1] * 0.75 + n[2] * 0.35 - n[0] * 0.25;
      shade = lit > 0.55 ? 0 : lit > 0.05 ? 1 : 2;
    }
    if (q.kind !== 2) {
      // facing away (screen-space winding): hidden behind the cube's other faces
      const [p0, p1, p2] = corners;
      const cross = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
      if (cross * this._winding(q) > 0) return;
    }
    this._tri(corners[0], corners[1], corners[2], qi, shade, q.kind === 2);
    this._tri(corners[0], corners[2], corners[3], qi, shade, q.kind === 2);
  }

  /** +1 or -1: the screen winding of a quad (u, v) that faces the camera, by its corner order. */
  _winding(q) {
    // corners go -u-v, +u-v, +u+v: n = u x v points out or in depending on the face
    const u = q.u, v = q.v;
    const cx = u[1] * v[2] - u[2] * v[1];
    const cy = u[2] * v[0] - u[0] * v[2];
    const cz = u[0] * v[1] - u[1] * v[0];
    return Math.sign(cx * q.n[0] + cy * q.n[1] + cz * q.n[2]) || 1;
  }

  _tri(a, b, c, qi, shade, ghost) {
    const { W, H } = this;
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-6) return;
    const z = this.zbuf;
    const ib = this.ibuf;
    const sb = this.sbuf;
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        let w0 = (b[0] - px) * (c[1] - py) - (b[1] - py) * (c[0] - px);
        let w1 = (c[0] - px) * (a[1] - py) - (c[1] - py) * (a[0] - px);
        let w2 = (a[0] - px) * (b[1] - py) - (a[1] - py) * (b[0] - px);
        if (area < 0) { w0 = -w0; w1 = -w1; w2 = -w2; }
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const s = Math.abs(area);
        const d = (w0 * a[2] + w1 * b[2] + w2 * c[2]) / s;
        const p = y * W + x;
        // ghosts never hide the cube
        const depth = ghost ? d + 50 : d;
        if (depth < z[p]) { z[p] = depth; ib[p] = qi; sb[p] = shade; }
      }
    }
  }
}
PixelCube.DEFAULT_YAW = -0.62;
PixelCube.DEFAULT_PITCH = 0.5;

// ---------------------------------------------------------------------------
// Playback: a sequence of moves (scramble, then the solution) and a position
// ---------------------------------------------------------------------------

/** Move tokens of an alg text ('//' comments and unknown tokens dropped). */
function playbackTokens(text) {
  return String(text || '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join(' ')
    .split(/\s+/).filter(t => t && moveGeometry(t));
}

class CubePlayer {
  constructor(cube, onChange = () => {}) {
    this.cube = cube;
    this.onChange = onChange;
    this.tokens = [];
    this.marks = [];   // [{ at, label }] step starts, for the scrub bar
    this.pos = 0;      // moves applied
    this.states = [SOLVED_FACELETS];
    this.playing = false;
    this.speed = 1;
    this._run = 0;
  }

  /** A new sequence; jumps to `pos` (default: the end) without animating. */
  setSequence(tokens, marks = [], pos = tokens.length) {
    const same = tokens.length >= this.tokens.length && this.tokens.every((t, i) => t === tokens[i]);
    if (!same) {
      this.states = [SOLVED_FACELETS];
    }
    this.tokens = tokens.slice();
    this.marks = marks;
    this.states.length = Math.min(this.states.length, this.tokens.length + 1);
    this.seek(pos, false);
  }

  stateAt(k) {
    while (this.states.length <= k) {
      const i = this.states.length - 1;
      this.states.push(applyAlgorithm(this.states[i], this.tokens[i]));
    }
    return this.states[k];
  }

  get length() { return this.tokens.length; }

  async seek(k, animate = true) {
    const run = ++this._run;
    k = Math.max(0, Math.min(this.tokens.length, k));
    if (animate && Math.abs(k - this.pos) === 1) {
      const forward = k > this.pos;
      const tok = forward ? this.tokens[this.pos] : invertToken(this.tokens[k]);
      if (!forward) this.cube.setFacelets(this.stateAt(this.pos));
      await this.cube.animateMove(tok, 150 / this.speed);
      if (run !== this._run) return;
    }
    this.pos = k;
    this.cube.setFacelets(this.stateAt(k));
    this.onChange(this);
  }

  step(d) { return this.seek(this.pos + d, true); }

  /** Animates forward from the current position to `k`. */
  async playTo(k) {
    const run = ++this._run;
    k = Math.min(k, this.tokens.length);
    while (this.pos < k && run === this._run) {
      await this.cube.animateMove(this.tokens[this.pos], 140 / this.speed);
      if (run !== this._run) return;
      this.pos++;
      this.cube.setFacelets(this.stateAt(this.pos));
      this.onChange(this);
    }
  }

  async play() {
    if (this.playing) { this.pause(); return; }
    if (this.pos >= this.tokens.length) await this.seek(0, false);
    this.playing = true;
    this.onChange(this);
    const run = ++this._run;
    while (this.playing && this.pos < this.tokens.length && run === this._run) {
      const tok = this.tokens[this.pos];
      await this.cube.animateMove(tok, 190 / this.speed);
      if (run !== this._run) break;
      this.pos++;
      this.cube.setFacelets(this.stateAt(this.pos));
      this.onChange(this);
      await new Promise(r => setTimeout(r, 30 / this.speed));
      this._run = run;
    }
    this.playing = false;
    this.onChange(this);
  }

  pause() { this.playing = false; this._run++; this.cube.stop(); this.cube.setFacelets(this.stateAt(this.pos)); this.onChange(this); }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PC_STICKERS, PC_FACES, moveGeometry, geometryPerm, rotateVec, playbackTokens, PC_RESOLUTIONS };
}
