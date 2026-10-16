/**
 * The cube simulator and visualiser.
 */
'use strict';

// Each face: its outward normal and the 3D directions of its rows (down the
// face) and columns (across), as the facelet layout reads a face from outside.
const PC_FACES = [
  { n: [0, 1, 0], row: [0, 0, 1], col: [1, 0, 0] },   // U: rows from the back toward the front
  { n: [1, 0, 0], row: [0, -1, 0], col: [0, 0, -1] }, // R
  { n: [0, 0, 1], row: [0, -1, 0], col: [1, 0, 0] },  // F
  { n: [0, -1, 0], row: [0, 0, -1], col: [1, 0, 0] }, // D: rows from the front toward the back
  { n: [-1, 0, 0], row: [0, -1, 0], col: [0, 0, 1] }, // L
  { n: [0, 0, -1], row: [0, -1, 0], col: [-1, 0, 0] }, // B
];

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

const PC_MOVE_BASE = {
  R: [0, [1], -1], L: [0, [-1], 1], M: [0, [0], 1], x: [0, [-1, 0, 1], -1], r: [0, [0, 1], -1], l: [0, [-1, 0], 1],
  U: [1, [1], -1], D: [1, [-1], 1], E: [1, [0], 1], y: [1, [-1, 0, 1], -1], u: [1, [0, 1], -1], d: [1, [-1, 0], 1],
  F: [2, [1], -1], B: [2, [-1], 1], S: [2, [0], -1], z: [2, [-1, 0, 1], -1], f: [2, [0, 1], -1], b: [2, [-1, 0], 1],
};

function moveGeometry(token) {
  const m = /^([URFDLBMESxyzurfdlb])(2'|2|'|)$/.exec(token || '');
  if (!m) return null;
  const [axis, layers, dir] = PC_MOVE_BASE[m[1]];
  const q = m[2] === "'" ? -dir : m[2].startsWith('2') ? 2 * dir : dir;
  return { axis, layers, quarters: q };
}

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

const PC_COLOURS = {
  W: ['#ffffff', '#e9e9e4', '#b9b9b2'],
  Y: ['#fff27a', '#ffd500', '#c9a200'],
  G: ['#5cf58a', '#17c84c', '#0e8c35'],
  B: ['#6f9bff', '#1e5bff', '#1238b0'],
  R: ['#ff6a5c', '#e8231c', '#a51510'],
  O: ['#ffb45c', '#ff8a00', '#c26400'],
  X: ['#7a7a76', '#5d5d5a', '#3f3f3d'], // a sticker that does not matter (alg-set case pictures)
};
const PC_BODY = ['#3a3a3a', '#1c1c1c', '#0c0c0c'];

const PC_RESOLUTIONS = { chunky: 170, fine: 400, smooth: 0 };

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const PC_ZOOM = [0.55, 2.6]; // the zoom range

class PixelCube {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.facelets = opts.facelets || SOLVED_FACELETS;
    this.resolution = opts.resolution || 'chunky';
    this.backFaces = opts.backFaces !== false;
    this.yaw = PixelCube.DEFAULT_YAW;
    this.pitch = PixelCube.DEFAULT_PITCH;
    this.zoom = 1;
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
  setTheme({ bg, line, floor, clear, floorShadow, shadow }) {
    if (bg) this.theme.bg = hexToRgb(bg);
    if (line) this.theme.line = hexToRgb(line);
    if (floor) this.theme.floor = floor;
    if (clear !== undefined) this.theme.clear = !!clear;
    if (floorShadow !== undefined) this.theme.floorShadow = !!floorShadow;
    if (shadow) this.theme.shadow = hexToRgb(shadow);
    this.draw();
  }
  resetView() { this.yaw = PixelCube.DEFAULT_YAW; this.pitch = PixelCube.DEFAULT_PITCH; this.zoom = 1; this.draw(); }
  zoomBy(factor) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.zoom = Math.max(PC_ZOOM[0], Math.min(PC_ZOOM[1], this.zoom * factor));
    this.draw();
  }
  orbit(dYaw, dPitch) {
    this.yaw += dYaw;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dPitch));
    this.draw();
  }

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

  _view(p) {
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
    const D = 11;
    const f = Math.min(this.W, this.H) * 1.32 * this.zoom;
    const depth = D - v[2];
    return [this.W / 2 + v[0] * f / depth, this.H * 0.5 - v[1] * f / depth, depth];
  }

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
    const viewDir = this._viewDirWorld();
    PC_STICKERS.forEach((s, i) => {
      const half = 0.41;
      const lift = 0.5 + 0.004;
      const c = s.cubie.map((v, k) => v + s.n[k] * lift);
      const colour = this.facelets[i];
      quads.push({ c, n: s.n, u: s.col.map(v => v * half), v: s.row.map(v => v * half), cubie: s.cubie, kind: 1, colour, id: i });
      if (this.backFaces) {
        const facing = s.n[0] * viewDir[0] + s.n[1] * viewDir[1] + s.n[2] * viewDir[2];
        if (facing > 0.2) {
          const g = s.cubie.map((v, k) => v * 0.92 + s.n[k] * 2.35);
          quads.push({ c: g, n: s.n, u: s.col.map(v => v * 0.4), v: s.row.map(v => v * 0.4), cubie: s.cubie, kind: 2, colour, id: 100 + i });
        }
      }
    });
    quads.forEach((q, qi) => this._raster(q, qi));
    const bg = this.theme.bg;
    const line = this.theme.line;
    const N = W * H;
    const bgAlpha = this.theme.clear ? 0 : 255;
    const floor = this._floorMask();
    const shadow = this.theme.shadow || bg.map((v, k) => Math.round(v * 0.8 + line[k] * 0.2));
    const kinds = new Int8Array(quads.length);
    const tones = quads.map((q, i) => { kinds[i] = q.kind; return q.kind ? (this.palette[q.colour] || this.palette.W) : null; });
    const bodyRgb = this.bodyRgb[1];
    for (let p = 0; p < N; p++) {
      const o = p * 4;
      const qi = ib[p];
      if (qi < 0) {
        const x = p % W;
        const y = (p / W) | 0;
        if (floor && floor[p]) { data[o] = shadow[0]; data[o + 1] = shadow[1]; data[o + 2] = shadow[2]; data[o + 3] = 255; continue; }
        data[o] = bg[0]; data[o + 1] = bg[1]; data[o + 2] = bg[2]; data[o + 3] = bgAlpha;
        continue;
      }
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
    const solid = (k) => { const qi = ib[k]; return qi >= 0 && kinds[qi] !== 2; };
    for (let p = 0; p < N; p++) {
      if (ib[p] >= 0 && kinds[ib[p]] !== 2) continue;
      const x = p % W;
      if ((p >= W && solid(p - W)) || (p + W < N && solid(p + W)) || (x > 0 && solid(p - 1)) || (x < W - 1 && solid(p + 1))) {
        const o = p * 4;
        data[o] = line[0]; data[o + 1] = line[1]; data[o + 2] = line[2]; data[o + 3] = 255;
      }
    }
    this.ctx.putImageData(this.img, 0, 0);
  }

  _floorMask() {
    if (!this.theme.floorShadow || this.pitch <= 0.05) return null;
    const { W, H } = this;
    const foot = [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5], [-1.5, 1.5]];
    const cast = [1.7, -0.7]; // the light's direction on the floor (x, z)
    const flat = [...foot, ...foot.map(([x, z]) => [x + cast[0], z + cast[1]])]
      .map(([x, z]) => this._project(this._view([x, -1.52, z])));
    flat.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of flat) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (const p of flat.slice().reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    const pts = [...lower.slice(0, -1), ...upper.slice(0, -1)];
    const mask = this._floor && this._floor.length === W * H ? this._floor : (this._floor = new Uint8Array(W * H));
    mask.fill(0);
    let minX = W, maxX = 0, minY = H, maxY = 0;
    for (const p of pts) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
    minX = Math.max(0, Math.floor(minX)); maxX = Math.min(W - 1, Math.ceil(maxX));
    minY = Math.max(0, Math.floor(minY)); maxY = Math.min(H - 1, Math.ceil(maxY));
    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if ((a[1] <= py) === (b[1] <= py)) continue;
        const x = a[0] + (py - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
        lo = Math.min(lo, x); hi = Math.max(hi, x);
      }
      for (let x = Math.max(minX, Math.ceil(lo - 0.5)); x <= Math.min(maxX, Math.floor(hi - 0.5)); x++) mask[y * W + x] = 1;
    }
    return mask;
  }

  _viewDirWorld() {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
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
    let shade = 1;
    if (q.kind !== 0) {
      const n = this._view(this._animated(q.n, q.cubie));
      const lit = n[1] * 0.75 + n[2] * 0.35 - n[0] * 0.25;
      shade = lit > 0.55 ? 0 : lit > 0.05 ? 1 : 2;
    }
    if (q.kind !== 2) {
      const [p0, p1, p2] = corners;
      const cross = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
      if (cross * this._winding(q) > 0) return;
    }
    this._tri(corners[0], corners[1], corners[2], qi, shade, q.kind === 2);
    this._tri(corners[0], corners[2], corners[3], qi, shade, q.kind === 2);
  }

  _winding(q) {
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

function playbackTokens(text) {
  return String(text || '').split('\n').map(l => l.replace(/\/\/.*$/, '')).join(' ')
    .split(/\s+/).filter(t => t && moveGeometry(t));
}

const GLIDE_MS = 500;
const TURN_MS = 150;
const PLAY_MS = 190;  // a move of the playback
const PLAY_HOLD_MS = 600; // the start, shown before a replay
const pcInvert = t => (t.endsWith('2') ? t : t.endsWith("'") ? t.slice(0, -1) : `${t}'`);

class CubePlayer {
  constructor(cube, onChange = () => {}) {
    this.cube = cube;
    this.onChange = onChange;
    this.tokens = [];
    this.marks = [];   // [{ at, label }] step starts, for the scrub bar
    this.pos = 0;      // the position the cube shows (or is gliding to)
    this.start = SOLVED_FACELETS; // the cube before the first move (the scrambled cube)
    this.states = [SOLVED_FACELETS];
    this.at = [];      // the moves the cube shows applied to `start`
    this.atState = SOLVED_FACELETS;
    this.glide = null; // the running glide
    this.playing = false;
    this.speed = 1;
    this.animated = true; // false: every change is drawn at once (animation off)
    this._run = 0;
  }

  setSequence(tokens, marks = [], pos = tokens.length, start = SOLVED_FACELETS, { instant = false } = {}) {
    let keep = 0;
    if (start === this.start) {
      const n = Math.min(tokens.length, this.tokens.length);
      while (keep < n && tokens[keep] === this.tokens[keep]) keep++;
    } else {
      this.start = start;
      this.at = [];
      this.atState = start;
      instant = true;
    }
    this.states.length = Math.min(this.states.length, keep + 1);
    if (!this.states.length) this.states = [start];
    this.states[0] = start;
    this.tokens = tokens.slice();
    this.marks = marks;
    return this.goTo(pos, { instant });
  }

  stateAt(k) {
    while (this.states.length <= k) {
      const i = this.states.length - 1;
      this.states.push(applyAlgorithm(this.states[i], this.tokens[i]));
    }
    return this.states[k];
  }

  get length() { return this.tokens.length; }

  _route(path, k) {
    const n = Math.min(path.length, k);
    let c = 0;
    while (c < n && path[c] === this.tokens[c]) c++;
    const route = [];
    for (let i = path.length - 1; i >= c; i--) route.push({ tok: pcInvert(path[i]), back: true });
    for (let i = c; i < k; i++) route.push({ tok: this.tokens[i], back: false });
    return { route, shared: c };
  }

  _apply(m) {
    if (m.back) this.at.pop(); else this.at.push(m.tok);
    this.atState = this.at.length <= this.tokens.length && this.at.every((t, i) => t === this.tokens[i])
      ? this.stateAt(this.at.length) : applyAlgorithm(this.atState, m.tok);
  }

  _settle(k) {
    this._stopGlide();
    this.at = this.tokens.slice(0, k);
    this.atState = this.stateAt(k);
    this.pos = k;
    this.cube.anim = null;
    this.cube.setFacelets(this.atState);
    this.onChange(this);
  }

  _stopGlide() {
    const g = this.glide;
    if (!g) return;
    if (g.raf) cancelAnimationFrame(g.raf);
    this.glide = null;
    g.resolve();
  }

  goTo(k, { instant = false, ms = 0 } = {}) {
    k = Math.max(0, Math.min(this.tokens.length, k));
    if (instant || !this.animated || typeof requestAnimationFrame === 'undefined') { this._settle(k); return Promise.resolve(); }
    let carry = 0;
    const g = this.glide;
    if (g && g.frac > 0 && g.done < g.route.length) {
      const m = g.route[g.done];
      const from0 = this._route(this.at, k).route[0];
      if (from0 && from0.tok === m.tok && from0.back === m.back) carry = g.frac;
      else {
        this._apply(m); // the other side of the turn
        const from1 = this._route(this.at, k).route[0];
        if (from1 && from1.tok === pcInvert(m.tok)) carry = 1 - g.frac;
        else if (g.frac < 0.5) this._apply({ tok: pcInvert(m.tok), back: !m.back, undo: true });
      }
    }
    this._stopGlide();
    const { route, shared } = this._route(this.at, k);
    if (!route.length) { this._settle(k); return Promise.resolve(); }
    const left = route.length - carry;
    const one = (ms || TURN_MS) / this.speed;
    const T = left <= 1 ? one * left : Math.min(GLIDE_MS / Math.sqrt(this.speed), one * left);
    return new Promise((resolve) => {
      const glide = { route, shared, k, carry, T, t0: performance.now(), done: 0, frac: carry, resolve, raf: 0 };
      this.glide = glide;
      this.pos = k;
      const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
      const frame = (now) => {
        if (this.glide !== glide) return;
        const p = glide.T > 0 ? Math.min(1, (now - glide.t0) / glide.T) : 1;
        const x = carry + left * ease(p);
        const whole = Math.min(route.length, Math.floor(x + 1e-9));
        while (glide.done < whole) this._apply(route[glide.done++]);
        glide.frac = glide.done < route.length ? x - whole : 0;
        if (glide.frac > 0) {
          const geo = moveGeometry(route[glide.done].tok);
          this.cube.anim = geo ? { axis: geo.axis, layers: geo.layers, angle: geo.quarters * Math.PI / 2 * glide.frac } : null;
        } else this.cube.anim = null;
        this.cube.setFacelets(this.atState);
        if (p >= 1) {
          this.glide = null;
          this.cube.anim = null;
          this.at = this.tokens.slice(0, k);
          this.atState = this.stateAt(k);
          this.cube.setFacelets(this.atState);
          this.onChange(this);
          resolve();
          return;
        }
        glide.raf = requestAnimationFrame(frame);
      };
      this.onChange(this);
      glide.raf = requestAnimationFrame(frame);
    });
  }

  seek(k, animate = true) {
    this._stopPlay();
    return this.goTo(k, { instant: !animate });
  }

  step(d) { return this.seek(this.pos + d, true); }

  async playTo(k) {
    const run = ++this._run;
    k = Math.min(k, this.tokens.length);
    while (this.pos < k && run === this._run) await this.goTo(this.pos + 1, { ms: PLAY_MS * 140 / 190 });
  }

  async play() {
    if (this.playing) { this.pause(); return; }
    const run = ++this._run;
    this.playing = true;
    this.onChange(this);
    // from the end: back to the start, held a moment so the start can be seen
    if (this.pos >= this.tokens.length) {
      await this.goTo(0);
      if (run === this._run) await new Promise(r => setTimeout(r, PLAY_HOLD_MS));
    }
    while (this.playing && run === this._run && this.pos < this.tokens.length) {
      await this.goTo(this.pos + 1, { ms: PLAY_MS });
      if (run !== this._run) break;
      await new Promise(r => setTimeout(r, 30 / this.speed));
    }
    if (run === this._run) this.playing = false;
    this.onChange(this);
  }

  _stopPlay() { this.playing = false; this._run++; }

  pause() { this._stopPlay(); this.onChange(this); }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { PC_STICKERS, PC_FACES, moveGeometry, geometryPerm, rotateVec, playbackTokens, PC_RESOLUTIONS, CubePlayer, GLIDE_MS };
}
