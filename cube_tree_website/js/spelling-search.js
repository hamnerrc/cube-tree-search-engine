/**
 * Every spelling of every face-turn solution, best first.
 */
'use strict';

const SpellingSearch = (() => {
  const SPELLING_MAX_RL = 4;
  const SPELLING_MAX_UDF = 3;

  let T = null; // tables, built on first use (facelet-cube.js must be loaded)
  function tables() {
    if (T) return T;
    const RI = r => rotationIndex(r);
    const ROT24 = [];
    for (const a of ['', 'x', 'x2', "x'", 'z', "z'"]) for (const b of ['', 'y', 'y2', "y'"]) {
      const i = RI([a, b].filter(Boolean).join(' '));
      if (!ROT24.includes(i)) ROT24.push(i);
    }
    const NR = ROT24.length;
    const RIDX = new Map(ROT24.map((r, k) => [r, k]));
    const YF = new Uint8Array(NR);
    // YIDX: a y-family frame's index in '', y, y2, y' (-1 for the others)
    const YIDX = new Int8Array(NR).fill(-1);
    ['', 'y', 'y2', "y'"].forEach((r, k) => { YF[RIDX.get(RI(r))] = 1; YIDX[RIDX.get(RI(r))] = k; });
    const ROT_NAME = ROT24.map(r => rotationName(ROT_NAMES_BY_INDEX(r)));
    const MUL = ROT24.map(a => Int32Array.from(ROT24.map(b => RIDX.get(composeRotationIndex(a, b)))));
    const TOK = [];
    const TID = new Map();
    const tid = (t) => { if (!TID.has(t)) { TID.set(t, TOK.length); TOK.push(t); } return TID.get(t); };
    const FACE_T = [];
    for (const f of 'RLUDFB') for (const s of ['', "'", '2']) FACE_T.push(f + s);
    for (const f of 'RLUDFBrludf') for (const s of ['', "'", '2']) tid(f + s);
    for (const t of ['y', "y'", 'x', "x'", 'y2']) tid(t);
    const NT = TOK.length;
    const IS_ROT = Uint8Array.from(TOK, t => (/^[xyz]/.test(t) ? 1 : 0));
    const IS_RL = Uint8Array.from(TOK, t => (t[0] === 'r' || t[0] === 'l' ? 1 : 0));
    // for MCC's exceptions in enumerate's walk: U face turns 1, D face turns 2
    const FACE_UD = Uint8Array.from(TOK, t => (t[0] === 'U' ? 1 : t[0] === 'D' ? 2 : 0));
    const R_QUARTER = Uint8Array.from(TOK, t => (['R', "R'", 'r', "r'"].includes(t) ? 1 : 0));
    const UD_QUARTER = Uint8Array.from(TOK, t => (["U'", 'U', "D'", 'D'].includes(t.toUpperCase()) ? 1 : 0));
    const AXIS = Int8Array.from(TOK, t => ({ U: 0, D: 0, u: 0, d: 0, y: 0, R: 1, L: 1, r: 1, l: 1, x: 1, F: 2, B: 2, f: 2 })[t[0]]);
    const CONJ = ROT24.map((r) => {
      const m = new Int32Array(NT).fill(-1);
      for (const f of FACE_T) m[TID.get(f)] = TID.get(conjugateToken(r, f));
      return m;
    });
    // WIDES[t]: [wide token, rotation k] with wide == "t, then rotation k" (never b).
    const WIDE_BY_PERM = new Map();
    for (const c of 'rludf') for (const s of ['', "'", '2']) WIDE_BY_PERM.set(MOVE_TABLE[c + s].join(','), c + s);
    const WIDES = TOK.map((t) => {
      if (!FACE_T.includes(t)) return [];
      const out = [];
      for (const rho of ['x', "x'", 'x2', 'y', "y'", 'y2', 'z', "z'", 'z2']) {
        const w = WIDE_BY_PERM.get(composePerm(MOVE_TABLE[t], MOVE_TABLE[rho]).join(','));
        if (w) out.push([TID.get(w), RIDX.get(RI(rho))]);
      }
      return out;
    });
    const MIDS = ['y', "y'", 'x', "x'"].map(t => [TID.get(t), RIDX.get(RI(t))]);
    // A half turn may be written as two quarter turns, one of them wide
    // ("d' U'" for U2, then y): QUARTERS[half] = its quarter turns.
    const QUARTERS = TOK.map(t => (FACE_T.includes(t) && t.endsWith('2') ? [TID.get(t[0]), TID.get(`${t[0]}'`)] : []));
    const LEAD_LATER = ['', 'y', "y'", 'y2'].map(t => [t ? TID.get(t) : -1, RIDX.get(RI(t))]);
    const LEAD_ROOT = ROT24.map((r, k) => [-1, k]);
    T = { NR, YF, YIDX, ROT_NAME, MUL, TOK, TID, NT, IS_ROT, IS_RL, FACE_UD, R_QUARTER, UD_QUARTER, AXIS, CONJ, WIDES, MIDS, QUARTERS, LEAD_LATER, LEAD_ROOT, FACE_T };
    return T;
  }
  let NAME_CACHE = null;
  function ROT_NAMES_BY_INDEX(index) {
    if (!NAME_CACHE) {
      NAME_CACHE = new Map();
      for (const a of ['', 'x', 'x2', "x'", 'z', "z'", 'z2']) for (const b of ['', 'y', 'y2', "y'"]) {
        const name = [a, b].filter(Boolean).join(' ');
        const i = rotationIndex(name);
        if (!NAME_CACHE.has(i)) NAME_CACHE.set(i, name);
      }
    }
    return NAME_CACHE.get(index);
  }

  const MCC = new Map(); // JSON of the constants -> min
  function mccMinimum(A = ALG_SPEED_DEFAULTS) {
    const t = tables();
    const key = JSON.stringify(A);
    if (MCC.has(key)) return MCC.get(key);
    const q = {
      R: A.wristMult, L: A.wristMult,
      U: Math.min(1, A.pushMult, 1.15 * A.pushMult),
      D: Math.min(A.ringMult, A.ringMult * A.pushMult),
      F: Math.min(1, A.pushMult, A.ringMult * A.pushMult, 1.25),
      B: Math.min(1, A.ringMult, 1.15 * A.pushMult, A.ringMult * A.pushMult),
    };
    const h = {
      R: A.double * A.wristMult, L: A.double * A.wristMult, U: A.double, D: A.double * A.ringMult,
      F: Math.min(A.double, A.double * A.ringMult), B: Math.min(A.double, A.double * A.ringMult),
    };
    const min = new Float64Array(t.NT);
    t.TOK.forEach((tok, k) => {
      if (t.IS_ROT[k]) min[k] = tok.endsWith('2') ? A.rotation * A.double : A.rotation;
      else min[k] = Math.max(0, tok.endsWith('2') ? h[tok[0].toUpperCase()] : q[tok[0].toUpperCase()]);
    });
    if (MCC.size > 8) MCC.clear();
    MCC.set(key, min);
    return min;
  }

  function penalties(P = STEP_PENALTIES) {
    const t = tables();
    return Float64Array.from([...t.TOK, null], (tok) => {
      if (tok === null) return P.natural;
      const c = tok[0];
      if (c === 'D') return P.D;
      if (c === 'F') return P.F;
      if (c === 'B') return P.B;
      if (c === 'r' || c === 'l') return P.wideRL;
      if (c === 'u' || c === 'd' || c === 'f') return P.wideUDFB;
      if (c === 'y') return P.rotMidY;
      return 0;
    });
  }

  // Naturalness tables for the current model: MIN0[w] bits of w first,
  // MIN1[w] least bits of w after anything, MIN2[b][w] least bits of w after b.
  let LMT = null;
  function lmTables() {
    const model = currentNaturalnessModel();
    if (LMT && LMT.model === model) return LMT;
    const lm = model.incremental;
    const t = tables();
    const NT1 = t.NT + 1;
    const id = Int32Array.from(t.TOK, tok => lm.tokenId(tok));
    const ids = [...id, lm.END];
    const MIN0 = new Float64Array(NT1);
    const MIN1 = new Float64Array(NT1).fill(Infinity);
    const MIN2 = new Float64Array(NT1 * NT1).fill(Infinity);
    for (let wi = 0; wi < NT1; wi++) {
      const w = ids[wi];
      MIN0[wi] = lm.trigramBits(lm.START, lm.START, w);
      for (let a = 0; a <= lm.START; a++) {
        if (a === lm.END) continue;
        const v = lm.trigramBits(a, lm.START, w);
        if (v < MIN1[wi]) MIN1[wi] = v;
      }
      for (let bi = 0; bi < t.NT; bi++) {
        let m = Infinity;
        for (let a = 0; a <= lm.START; a++) {
          if (a === lm.END) continue;
          const v = lm.trigramBits(a, id[bi], w);
          if (v < m) m = v;
        }
        MIN2[bi * NT1 + wi] = m;
        if (m < MIN1[wi]) MIN1[wi] = m;
      }
    }
    // TRI[(a * NT1 + b) * NT1 + w]: bits of w after a, b (token ids; NT = the
    // start as a context, the end as w).
    const TRI = new Float64Array(NT1 * NT1 * NT1);
    for (let a = 0; a < NT1; a++) for (let b = 0; b < NT1; b++) {
      if (a < t.NT && b === t.NT) { for (let w = 0; w < NT1; w++) TRI[(a * NT1 + b) * NT1 + w] = Infinity; continue; }
      const ia = a === t.NT ? lm.START : id[a];
      const ib = b === t.NT ? lm.START : id[b];
      for (let w = 0; w < NT1; w++) TRI[(a * NT1 + b) * NT1 + w] = lm.trigramBits(ia, ib, ids[w]);
    }
    const NR = t.NR;
    const AFTER = new Float64Array(NT1 * NR * 19 * 2);
    for (let prev = 0; prev < t.NT; prev++) {
      for (let d = 0; d < NR; d++) {
        for (let mv = 0; mv <= 18; mv++) {
          for (let r = 0; r < 2; r++) {
            let m = Infinity;
            const consider = (k) => { const v = MIN2[prev * NT1 + k] - MIN1[k]; if (v < m) m = v; };
            if (mv === 18) consider(t.NT);
            else {
              const w = t.CONJ[d][mv];
              consider(w);
              for (const [W] of t.WIDES[w]) consider(W);
              for (const qf of t.QUARTERS[mv]) {
                const q = t.CONJ[d][qf];
                consider(q);
                for (const [W] of t.WIDES[q]) consider(W);
              }
              if (!r) for (const [M] of t.MIDS) consider(M);
            }
            AFTER[((prev * NR + d) * 19 + mv) * 2 + r] = Math.max(0, m);
          }
        }
      }
    }
    const TRIL = Float64Array.from(TRI);
    const LEADS = ['y', "y'", 'y2'].map(x => t.TID.get(x));
    for (let w = 0; w < NT1; w++) {
      let m = TRI[(t.NT * NT1 + t.NT) * NT1 + w];
      for (const l of LEADS) m = Math.min(m, TRI[(t.NT * NT1 + l) * NT1 + w]);
      TRIL[(t.NT * NT1 + t.NT) * NT1 + w] = m;
    }
    for (let b = 0; b < t.NT; b++) {
      for (let w = 0; w < NT1; w++) {
        let m = TRI[(t.NT * NT1 + b) * NT1 + w];
        for (const l of LEADS) m = Math.min(m, TRI[(l * NT1 + b) * NT1 + w]);
        TRIL[(t.NT * NT1 + b) * NT1 + w] = m;
      }
    }
    LMT = { model, lm, id, MIN0, MIN1, MIN2, NT1, TRI, TRIL, AFTER };
    return LMT;
  }

  const FLAGS = 5;
  let OWN_FIRST = null;
  // boundTable's last complete row (n when the whole table was computed).
  let boundRows = 0;
  // rowOptions(noMid): the bound's per-move options; noMid (first steps:
  // never a rotation inside the alg) leaves out the mid-step rotations.
  const RO = [null, null];
  function rowOptions(noMid = false) {
    if (RO[noMid ? 1 : 0]) return RO[noMid ? 1 : 0];
    const t = tables();
    const { NR, CONJ, WIDES, MUL, QUARTERS } = t;
    const MIDS = noMid ? [] : t.MIDS;
    const W0 = new Int32Array(18 * NR + 1);
    const Q0 = new Int32Array(18 * NR + 1);
    const M0 = new Int32Array(18 * NR + 1);
    const wides = [];
    const qs = [];
    const ms = [];
    for (let mv = 0; mv < 18; mv++) {
      for (let d = 0; d < NR; d++) {
        const x = mv * NR + d;
        const w = CONJ[d][mv];
        W0[x] = wides.length / 2;
        for (const [W, rho] of WIDES[w]) wides.push(W, MUL[d][rho]);
        Q0[x] = qs.length / 3;
        M0[x] = ms.length / 4;
        for (const qf of QUARTERS[mv]) {
          const q = CONJ[d][qf];
          for (const [W, rho] of WIDES[q]) {
            const d2 = MUL[d][rho];
            qs.push(q, W, d2, W, CONJ[d2][qf], d2);
          }
          for (const [m, mr] of MIDS) {
            const dm = MUL[d][mr];
            ms.push(q, m, CONJ[dm][qf], dm);
          }
        }
      }
    }
    W0[18 * NR] = wides.length / 2;
    Q0[18 * NR] = qs.length / 3;
    M0[18 * NR] = ms.length / 4;
    const MID_T = Int32Array.from(MIDS, m => m[0]);
    const MID_D = new Int32Array(NR * MIDS.length);
    for (let d = 0; d < NR; d++) for (let k = 0; k < MIDS.length; k++) MID_D[d * MIDS.length + k] = MUL[d][MIDS[k][1]];
    RO[noMid ? 1 : 0] = { W0, Q0, M0, WI: Int32Array.from(wides), QI: Int32Array.from(qs), MI: Int32Array.from(ms), MID_T, MID_D };
    return RO[noMid ? 1 : 0];
  }
  let WIDE_LANDING = null;
  function wideLanding() {
    if (WIDE_LANDING) return WIDE_LANDING;
    const t = tables();
    const { NR, CONJ, WIDES, MUL } = t;
    const out = new Int32Array(18 * NR).fill(-1);
    for (let mv = 0; mv < 18; mv++) {
      for (let dp = 0; dp < NR; dp++) {
        for (const [W, rho] of WIDES[CONJ[dp][mv]]) {
          const x = mv * NR + MUL[dp][rho];
          if (out[x] >= 0 && out[x] !== W) throw new Error('spelling-search: two wides land in one frame');
          out[x] = W;
        }
      }
    }
    WIDE_LANDING = out;
    return out;
  }
  const rowBase = new Float64Array(24 * FLAGS);
  // the flag after writing the plain spelling of a move, by the flag before
  const NEXT_PLAIN = Int8Array.from([1, 2, 2, 2, 3]);
  function boundTable(face, H, mccMin, pen, L, fromJ = 0, stopAbove = Infinity, minMove = 0, lastJ = face.length, later = false) {
    const t = tables();
    const { NR, NT, CONJ, AXIS, YF, TOK } = t;
    // first steps (!later) never rotate inside the alg: no rotation options,
    // and AFTER's rotation-used half (no rotation as the next first token)
    const { W0, Q0, M0, WI, QI, MI, MID_T, MID_D } = rowOptions(!later);
    const WL = wideLanding();
    const NM = MID_T.length;
    const ru = later ? 0 : 1;
    const lam = pen[NT]; // the naturalness weight (penalties)
    const { MIN2, MIN1, NT1, AFTER } = L;
    const TRI = later ? L.TRIL : L.TRI;
    const n = face.length;
    const RS = NR * FLAGS;
    if (!H || H.length < (n + 1) * RS) {
      const grown = new Float64Array(Math.max((n + 1) * RS, 40 * RS));
      if (H) grown.set(H);
      H = grown;
    }
    const base = rowBase;
    if (!OWN_FIRST || OWN_FIRST.src !== mccMin) {
      OWN_FIRST = Float64Array.from(TOK, (tok, k) => ((tok[0] === 'R' || tok[0] === 'r') && !tok.endsWith('2') ? Math.max(0, mccMin[k] - 0.5) : mccMin[k]));
      OWN_FIRST.src = mccMin;
    }
    const OWNF = OWN_FIRST;
    const START = (NT * NT1 + NT) * NT1;
    if (fromJ <= 0) {
      const i = n;
      for (let d = 0; d < NR; d++) {
        const o = d * FLAGS;
        if (!YF[d]) {
          for (let f = 0; f < FLAGS; f++) H[o + f] = Infinity;
          continue;
        }
        if (i === 0) {
          for (let f = 0; f < FLAGS; f++) H[o + f] = lam * TRI[START + NT];
          continue;
        }
        const pb = CONJ[d][face[i - 1]];
        const exact = TRI[((i >= 2 ? CONJ[d][face[i - 2]] : NT) * NT1 + pb) * NT1 + NT];
        const w3 = i >= 2 ? WL[face[i - 2] * NR + d] : -1;
        const w4 = WL[face[i - 1] * NR + d];
        H[o] = lam * MIN1[NT];
        H[o + 1] = lam * (i === 1 ? exact : MIN2[pb * NT1 + NT]);
        H[o + 2] = lam * exact;
        H[o + 3] = w3 >= 0 ? lam * TRI[(w3 * NT1 + pb) * NT1 + NT] : Infinity;
        H[o + 4] = w4 >= 0 ? lam * MIN2[w4 * NT1 + NT] : Infinity;
      }
      fromJ = 1;
    }
    for (let j = fromJ; j <= lastJ; j++) {
      const i = n - j;
      const fc = face[i];
      const pf = i + 1 < n && AXIS[fc] === AXIS[face[i + 1]];
      const next = j > 1 ? face[i + 1] : 18; // AFTER's move index for the continuation
      const prevRow = (j - 1) * RS;
      const row = j * RS;
      const x3 = i >= 2 ? face[i - 2] * NR : -1;
      const x4 = i >= 1 ? face[i - 1] * NR : -1;
      let least = Infinity;
      for (let d = 0; d < NR; d++) {
        const x = fc * NR + d;
        const cd = CONJ[d];
        const pp = i > 0 ? cd[face[i - 1]] : -1;
        const ctx2 = i > 0 ? ((i >= 2 ? cd[face[i - 2]] : NT) * NT1 + pp) * NT1 : 0;
        const ctx1 = pp * NT1;
        const w3 = x3 >= 0 ? WL[x3 + d] : -1;
        const w4 = x4 >= 0 ? WL[x4 + d] : -1;
        const ctx3 = w3 >= 0 ? (w3 * NT1 + pp) * NT1 : -1;
        const ctx4 = w4 >= 0 ? w4 * NT1 : -1;
        const s4 = w4 >= 0 ? (w4 * NT1) * NT1 : -1; // second token after w4, t1: TRI[s4 + t1 * NT1 + t2]
        const w = cd[fc];
        const po = prevRow + d * FLAGS;
        let v0;
        let v1;
        let v2;
        let v3 = Infinity;
        let v4 = Infinity;
        {
          const c = pen[w] + (pf ? 0 : OWNF[w]);
          if (i === 0) {
            const b = lam * TRI[START + w];
            v0 = c + b + H[po + 1];
            v1 = c + b + H[po + 2];
            v2 = v1;
          } else {
            v0 = c + lam * MIN1[w] + H[po + 1];
            v1 = c + lam * (i === 1 ? TRI[ctx2 + w] : MIN2[ctx1 + w]) + H[po + 2];
            v2 = c + lam * TRI[ctx2 + w] + H[po + 2];
            if (ctx3 >= 0) v3 = c + lam * TRI[ctx3 + w] + H[po + 2];
            if (ctx4 >= 0) v4 = c + lam * MIN2[ctx4 + w] + H[po + 3];
          }
        }
        // one-token alternatives (wide): the next row's flag 4 knows them
        for (let k = W0[x], e = W0[x + 1]; k < e; k++) {
          const W = WI[2 * k];
          const d2 = WI[2 * k + 1];
          const c = pen[W] + (pf ? 0 : OWNF[W]) + H[prevRow + d2 * FLAGS + 4];
          if (i === 0) {
            const v = c + lam * TRI[START + W];
            if (v < v0) v0 = v;
            if (v < v1) v1 = v;
            if (v < v2) v2 = v;
          } else {
            let v = c + lam * MIN1[W];
            if (v < v0) v0 = v;
            v = c + lam * (i === 1 ? TRI[ctx2 + W] : MIN2[ctx1 + W]);
            if (v < v1) v1 = v;
            v = c + lam * TRI[ctx2 + W];
            if (v < v2) v2 = v;
            if (ctx3 >= 0) { v = c + lam * TRI[ctx3 + W]; if (v < v3) v3 = v; }
            if (ctx4 >= 0) { v = c + lam * MIN2[ctx4 + W]; if (v < v4) v4 = v; }
          }
        }
        // two-token splits of a half turn (plain + wide quarter, either order)
        for (let k = Q0[x], e = Q0[x + 1]; k < e; k++) {
          const t1 = QI[3 * k];
          const t2 = QI[3 * k + 1];
          const d2 = QI[3 * k + 2];
          const c = pen[t1] + OWNF[t1] + pen[t2] + (pf ? 0 : OWNF[t2]) + H[prevRow + d2 * FLAGS] + lam * AFTER[((t2 * NR + d2) * 19 + next) * 2 + ru];
          const s0 = MIN2[t1 * NT1 + t2];
          if (i === 0) {
            const v = c + lam * (TRI[START + t1] + TRI[(NT * NT1 + t1) * NT1 + t2]);
            if (v < v0) v0 = v;
            if (v < v1) v1 = v;
            if (v < v2) v2 = v;
          } else {
            const s1 = TRI[(pp * NT1 + t1) * NT1 + t2];
            let v = c + lam * (MIN1[t1] + s0);
            if (v < v0) v0 = v;
            v = c + lam * ((i === 1 ? TRI[ctx2 + t1] : MIN2[ctx1 + t1]) + s1);
            if (v < v1) v1 = v;
            v = c + lam * (TRI[ctx2 + t1] + s1);
            if (v < v2) v2 = v;
            if (ctx3 >= 0) { v = c + lam * (TRI[ctx3 + t1] + s1); if (v < v3) v3 = v; }
            if (ctx4 >= 0) { v = c + lam * (MIN2[ctx4 + t1] + TRI[s4 + t1 * NT1 + t2]); if (v < v4) v4 = v; }
          }
        }
        for (let k = M0[x], e = M0[x + 1]; k < e; k++) {
          const q = MI[4 * k];
          const m = MI[4 * k + 1];
          const q2 = MI[4 * k + 2];
          const dm = MI[4 * k + 3];
          const c = pen[q] + OWNF[q] + pen[m] + mccMin[m] + lam * TRI[(q * NT1 + m) * NT1 + q2] + pen[q2] + (pf ? 0 : OWNF[q2])
            + H[prevRow + dm * FLAGS] + lam * AFTER[((q2 * NR + dm) * 19 + next) * 2 + 1];
          const s0 = MIN2[q * NT1 + m];
          if (i === 0) {
            const v = c + lam * (TRI[START + q] + TRI[(NT * NT1 + q) * NT1 + m]);
            if (v < v0) v0 = v;
            if (v < v1) v1 = v;
            if (v < v2) v2 = v;
          } else {
            const s1 = TRI[(pp * NT1 + q) * NT1 + m];
            let v = c + lam * (MIN1[q] + s0);
            if (v < v0) v0 = v;
            v = c + lam * ((i === 1 ? TRI[ctx2 + q] : MIN2[ctx1 + q]) + s1);
            if (v < v1) v1 = v;
            v = c + lam * (TRI[ctx2 + q] + s1);
            if (v < v2) v2 = v;
            if (ctx3 >= 0) { v = c + lam * (TRI[ctx3 + q] + s1); if (v < v3) v3 = v; }
            if (ctx4 >= 0) { v = c + lam * (MIN2[ctx4 + q] + TRI[s4 + q * NT1 + m]); if (v < v4) v4 = v; }
          }
        }
        const bo = d * FLAGS;
        base[bo] = v0;
        base[bo + 1] = v1;
        base[bo + 2] = v2;
        base[bo + 3] = v3;
        base[bo + 4] = v4;
      }
      // a rotation before move i (not before the first turn), then move i
      // from the rotated frame (no other rotation)
      for (let d = 0; d < NR; d++) {
        const bo = d * FLAGS;
        let v0 = base[bo];
        let v1 = base[bo + 1];
        let v2 = base[bo + 2];
        let v3 = base[bo + 3];
        let v4 = base[bo + 4];
        if (i > 0 && NM) {
          const cd = CONJ[d];
          const pp = cd[face[i - 1]];
          const ctx2 = ((i >= 2 ? cd[face[i - 2]] : NT) * NT1 + pp) * NT1;
          const w3 = x3 >= 0 ? WL[x3 + d] : -1;
          const w4 = WL[x4 + d];
          for (let k = 0; k < NM; k++) {
            const m = MID_T[k];
            const dm = MID_D[d * NM + k];
            const c = pen[m] + mccMin[m] + base[dm * FLAGS] + lam * AFTER[((m * NR + dm) * 19 + fc) * 2 + 1];
            let v = c + lam * MIN1[m];
            if (v < v0) v0 = v;
            v = c + lam * (i === 1 ? TRI[ctx2 + m] : MIN2[pp * NT1 + m]);
            if (v < v1) v1 = v;
            v = c + lam * TRI[ctx2 + m];
            if (v < v2) v2 = v;
            if (w3 >= 0) { v = c + lam * TRI[(w3 * NT1 + pp) * NT1 + m]; if (v < v3) v3 = v; }
            if (w4 >= 0) { v = c + lam * MIN2[w4 * NT1 + m]; if (v < v4) v4 = v; }
          }
        }
        const ro = row + bo;
        H[ro] = v0;
        H[ro + 1] = v1;
        H[ro + 2] = v2;
        H[ro + 3] = v3;
        H[ro + 4] = v4;
        if (v0 < least) least = v0;
        if (v1 < least) least = v1;
        if (v2 < least) least = v2;
        if (v3 < least) least = v3;
        if (v4 < least) least = v4;
      }
      if (least + (n - j) * minMove > stopAbove) {
        boundRows = j;
        return H;
      }
    }
    boundRows = Math.max(fromJ - 1, lastJ);
    return H;
  }

  function forwardStep(face, q, Fin, Fout, mccMin, pen, L, later = false) {
    const t = tables();
    const { NR, NT, CONJ, AXIS } = t;
    const { W0, Q0, M0, WI, QI, MI, MID_T, MID_D } = rowOptions(!later);
    const WL = wideLanding();
    const NM = MID_T.length;
    const ru = later ? 0 : 1;
    const lam = pen[NT]; // the naturalness weight (penalties)
    const { MIN2, MIN1, NT1, AFTER } = L;
    const TRI = later ? L.TRIL : L.TRI;
    const n = face.length;
    const OWNF = OWN_FIRST;
    const START = (NT * NT1 + NT) * NT1;
    const fc = face[q];
    const pf = q + 1 < n && AXIS[fc] === AXIS[face[q + 1]];
    const next = q + 1 < n ? face[q + 1] : 18;
    const x3 = q >= 2 ? face[q - 2] * NR : -1;
    const x4 = q >= 1 ? face[q - 1] * NR : -1;
    Fout.fill(Infinity);
    // a rotation before move q: then the move from the rotated frame, its
    // first token's bits as flag 0 plus AFTER (no other rotation)
    const Fm = fwdMid;
    Fm.fill(Infinity);
    if (q > 0 && NM) {
      for (let d = 0; d < NR; d++) {
        const o = d * FLAGS;
        const v0 = Fin[o];
        const v1 = Fin[o + 1];
        const v2 = Fin[o + 2];
        const v3 = Fin[o + 3];
        const v4 = Fin[o + 4];
        if (v0 === Infinity && v1 === Infinity && v2 === Infinity && v3 === Infinity && v4 === Infinity) continue;
        const cd = CONJ[d];
        const pp = cd[face[q - 1]];
        const ctx2 = ((q >= 2 ? cd[face[q - 2]] : NT) * NT1 + pp) * NT1;
        const w3 = x3 >= 0 ? WL[x3 + d] : -1;
        const w4 = WL[x4 + d];
        for (let k = 0; k < NM; k++) {
          const m = MID_T[k];
          const dm = MID_D[d * NM + k];
          let best = v0 + lam * MIN1[m];
          let v = v1 + lam * (q !== 1 ? MIN2[pp * NT1 + m] : TRI[ctx2 + m]);
          if (v < best) best = v;
          v = v2 + lam * TRI[ctx2 + m];
          if (v < best) best = v;
          if (w3 >= 0) { v = v3 + lam * TRI[(w3 * NT1 + pp) * NT1 + m]; if (v < best) best = v; }
          if (w4 >= 0) { v = v4 + lam * MIN2[w4 * NT1 + m]; if (v < best) best = v; }
          const c = best + pen[m] + mccMin[m] + lam * AFTER[((m * NR + dm) * 19 + fc) * 2 + 1];
          if (c < Fm[dm]) Fm[dm] = c;
        }
      }
    }
    for (let d = 0; d < NR; d++) {
      // flag-0 entries and those entered by a rotation read the same bits
      const o = d * FLAGS;
      const v0 = Math.min(Fin[o], Fm[d]);
      const v1 = Fin[o + 1];
      const v2 = Fin[o + 2];
      const v3 = Fin[o + 3];
      const v4 = Fin[o + 4];
      if (v0 === Infinity && v1 === Infinity && v2 === Infinity && v3 === Infinity && v4 === Infinity) continue;
      const x = fc * NR + d;
      const cd = CONJ[d];
      const w = cd[fc];
      if (q === 0) {
        // the start: only flag 0, the first tokens' bits after the start
        const c = v0 + pen[w] + (pf ? 0 : OWNF[w]) + lam * TRI[START + w];
        if (c < Fout[o + 1]) Fout[o + 1] = c;
        for (let k = W0[x], e = W0[x + 1]; k < e; k++) {
          const W = WI[2 * k];
          const d2 = WI[2 * k + 1];
          const v = v0 + pen[W] + (pf ? 0 : OWNF[W]) + lam * TRI[START + W];
          if (v < Fout[d2 * FLAGS + 4]) Fout[d2 * FLAGS + 4] = v;
        }
        for (let k = Q0[x], e = Q0[x + 1]; k < e; k++) {
          const t1 = QI[3 * k];
          const t2 = QI[3 * k + 1];
          const d2 = QI[3 * k + 2];
          const v = v0 + pen[t1] + OWNF[t1] + pen[t2] + (pf ? 0 : OWNF[t2]) + lam * (TRI[START + t1] + TRI[(NT * NT1 + t1) * NT1 + t2] + AFTER[((t2 * NR + d2) * 19 + next) * 2 + ru]);
          if (v < Fout[d2 * FLAGS]) Fout[d2 * FLAGS] = v;
        }
        for (let k = M0[x], e = M0[x + 1]; k < e; k++) {
          const q1 = MI[4 * k];
          const m = MI[4 * k + 1];
          const q2 = MI[4 * k + 2];
          const dm = MI[4 * k + 3];
          const v = v0 + pen[q1] + OWNF[q1] + pen[m] + mccMin[m] + pen[q2] + (pf ? 0 : OWNF[q2])
            + lam * (TRI[(q1 * NT1 + m) * NT1 + q2] + TRI[START + q1] + TRI[(NT * NT1 + q1) * NT1 + m] + AFTER[((q2 * NR + dm) * 19 + next) * 2 + 1]);
          if (v < Fout[dm * FLAGS]) Fout[dm * FLAGS] = v;
        }
        continue;
      }
      const pp = cd[face[q - 1]];
      const ctx2 = ((q >= 2 ? cd[face[q - 2]] : NT) * NT1 + pp) * NT1;
      const ctx1 = q !== 1 ? pp * NT1 : -1; // flag 1 at move 1: the exact trigram
      const s1 = pp * NT1; // a second token's trigram after the plain token before
      const w3 = x3 >= 0 ? WL[x3 + d] : -1;
      const w4 = WL[x4 + d];
      const ctx3 = w3 >= 0 ? (w3 * NT1 + pp) * NT1 : -1;
      const ctx4 = w4 >= 0 ? w4 * NT1 : -1;
      const b3 = ctx3 >= 0 ? v3 : Infinity;
      const b4 = ctx4 >= 0 ? v4 : Infinity;
      // plain: flag 0 -> 1, 1 -> 2, 2 -> 2, 3 -> 2, 4 -> 3
      {
        const c = pen[w] + (pf ? 0 : OWNF[w]);
        let v = v0 + c + lam * MIN1[w];
        if (v < Fout[o + 1]) Fout[o + 1] = v;
        v = Math.min(v1 + lam * (ctx1 >= 0 ? MIN2[ctx1 + w] : TRI[ctx2 + w]), v2 + lam * TRI[ctx2 + w]);
        if (b3 < Infinity) v = Math.min(v, b3 + lam * TRI[ctx3 + w]);
        v += c;
        if (v < Fout[o + 2]) Fout[o + 2] = v;
        if (b4 < Infinity) {
          v = b4 + lam * MIN2[ctx4 + w] + c;
          if (v < Fout[o + 3]) Fout[o + 3] = v;
        }
      }
      for (let k = W0[x], e = W0[x + 1]; k < e; k++) {
        const W = WI[2 * k];
        const d2 = WI[2 * k + 1];
        let best = v0 + lam * MIN1[W];
        let v = v1 + lam * (ctx1 >= 0 ? MIN2[ctx1 + W] : TRI[ctx2 + W]);
        if (v < best) best = v;
        v = v2 + lam * TRI[ctx2 + W];
        if (v < best) best = v;
        if (b3 < Infinity) { v = b3 + lam * TRI[ctx3 + W]; if (v < best) best = v; }
        if (b4 < Infinity) { v = b4 + lam * MIN2[ctx4 + W]; if (v < best) best = v; }
        v = best + pen[W] + (pf ? 0 : OWNF[W]);
        if (v < Fout[d2 * FLAGS + 4]) Fout[d2 * FLAGS + 4] = v;
      }
      for (let k = Q0[x], e = Q0[x + 1]; k < e; k++) {
        const t1 = QI[3 * k];
        const t2 = QI[3 * k + 1];
        const d2 = QI[3 * k + 2];
        const sx = TRI[(s1 + t1) * NT1 + t2];
        let best = v0 + lam * (MIN1[t1] + MIN2[t1 * NT1 + t2]);
        let v = v1 + lam * ((ctx1 >= 0 ? MIN2[ctx1 + t1] : TRI[ctx2 + t1]) + sx);
        if (v < best) best = v;
        v = v2 + lam * (TRI[ctx2 + t1] + sx);
        if (v < best) best = v;
        if (b3 < Infinity) { v = b3 + lam * (TRI[ctx3 + t1] + sx); if (v < best) best = v; }
        if (b4 < Infinity) { v = b4 + lam * (MIN2[ctx4 + t1] + TRI[(ctx4 + t1) * NT1 + t2]); if (v < best) best = v; }
        v = best + pen[t1] + OWNF[t1] + pen[t2] + (pf ? 0 : OWNF[t2]) + lam * AFTER[((t2 * NR + d2) * 19 + next) * 2 + ru];
        if (v < Fout[d2 * FLAGS]) Fout[d2 * FLAGS] = v;
      }
      for (let k = M0[x], e = M0[x + 1]; k < e; k++) {
        const q1 = MI[4 * k];
        const m = MI[4 * k + 1];
        const q2 = MI[4 * k + 2];
        const dm = MI[4 * k + 3];
        const sx = TRI[(s1 + q1) * NT1 + m];
        let best = v0 + lam * (MIN1[q1] + MIN2[q1 * NT1 + m]);
        let v = v1 + lam * ((ctx1 >= 0 ? MIN2[ctx1 + q1] : TRI[ctx2 + q1]) + sx);
        if (v < best) best = v;
        v = v2 + lam * (TRI[ctx2 + q1] + sx);
        if (v < best) best = v;
        if (b3 < Infinity) { v = b3 + lam * (TRI[ctx3 + q1] + sx); if (v < best) best = v; }
        if (b4 < Infinity) { v = b4 + lam * (MIN2[ctx4 + q1] + TRI[(ctx4 + q1) * NT1 + m]); if (v < best) best = v; }
        v = best + pen[q1] + OWNF[q1] + pen[m] + mccMin[m] + pen[q2] + (pf ? 0 : OWNF[q2])
          + lam * (TRI[(q1 * NT1 + m) * NT1 + q2] + AFTER[((q2 * NR + dm) * 19 + next) * 2 + 1]);
        if (v < Fout[dm * FLAGS]) Fout[dm * FLAGS] = v;
      }
    }
    return Fout;
  }
  const fwdMid = new Float64Array(24);

  const XO = [null, null];
  function exactOptions(noMid) {
    const k0 = noMid ? 1 : 0;
    if (XO[k0]) return XO[k0];
    const t = tables();
    const { NR, CONJ, WIDES, MUL, QUARTERS } = t;
    const MIDS = noMid ? [] : t.MIDS;
    const O0 = new Int32Array(18 * NR + 1);
    const K = []; const A = []; const B = []; const C = []; const D = [];
    const push = (k, a, b, c, d) => { K.push(k); A.push(a); B.push(b); C.push(c); D.push(d); };
    for (let mv = 0; mv < 18; mv++) {
      for (let d = 0; d < NR; d++) {
        O0[mv * NR + d] = K.length;
        const w = CONJ[d][mv];
        push(0, w, -1, -1, d);
        for (const [W, rho] of WIDES[w]) push(0, W, -1, -1, MUL[d][rho]);
        for (const qf of QUARTERS[mv]) {
          const q = CONJ[d][qf];
          for (const [W, rho] of WIDES[q]) {
            const d2 = MUL[d][rho];
            push(1, q, W, -1, d2);
            push(1, W, CONJ[d2][qf], -1, d2);
          }
          for (const [m, mr] of MIDS) {
            const dm = MUL[d][mr];
            push(2, q, m, CONJ[dm][qf], dm);
          }
        }
      }
    }
    O0[18 * NR] = K.length;
    const OK = Int8Array.from(K);
    const OT1 = Int32Array.from(A);
    const OT2 = Int32Array.from(B);
    const OT3 = Int32Array.from(C);
    const OD = Int32Array.from(D);
    const lastOf = k => (OK[k] === 0 ? OT1[k] : OK[k] === 1 ? OT2[k] : OT3[k]);
    const LS0 = new Int32Array(18 * NR + 1);
    const lsv = [];
    for (let mv = 0; mv < 18; mv++) {
      for (let d = 0; d < NR; d++) {
        LS0[mv * NR + d] = lsv.length;
        const set = new Set();
        for (let d1 = 0; d1 < NR; d1++) {
          for (let k = O0[mv * NR + d1]; k < O0[mv * NR + d1 + 1]; k++) if (OD[k] === d) set.add(lastOf(k));
        }
        lsv.push(...set);
      }
    }
    LS0[18 * NR] = lsv.length;
    XO[k0] = { O0, OK, OT1, OT2, OT3, OD, LS0, LSV: Int32Array.from(lsv) };
    return XO[k0];
  }

  function newExactTable() {
    return { V: new Float64Array(0), U: new Float64Array(0), SV: null, SU: null, gen: 0, rows: 0 };
  }
  let OS = new Float64Array(0);
  let OX = new Int32Array(0);
  const GD = new Int32Array(1024);
  const GB = new Int32Array(1024);
  const GA0 = new Int32Array(1024);
  const GA1 = new Int32Array(1024);
  const AL = new Int32Array(8192);
  const GS = new Float64Array(64);
  const GF = new Int32Array(64);
  // pre(i, F24): optional per-frame lower bounds of what moves 0..i-1 cost
  // (into F24, true if known) for stopping early
  const PRE24 = new Float64Array(24);
  const LEAST24 = new Float64Array(24);
  function exactTable(face, X, mccMin, pen, L, fromJ, stopAbove, minMove, later, pre = null) {
    const t = tables();
    const { NR, NT, AXIS, YF, LEAD_LATER, LEAD_ROOT } = t;
    const { O0, OK, OT1, OT2, OT3, OD, LS0, LSV } = exactOptions(!later);
    const { MID_T, MID_D } = rowOptions(!later);
    if (OS.length < OK.length) { OS = new Float64Array(OK.length); OX = new Int32Array(OK.length); }
    const lam = pen[NT]; // the naturalness weight (penalties)
    const { NT1, TRI } = L;
    const n = face.length;
    const NT2 = NT1 * NT1;
    const RS = NR * NT2;
    if (X.V.length < (n + 1) * RS) {
      const rows = Math.max(n + 1, 16);
      const v = new Float64Array(rows * RS); v.set(X.V); X.V = v;
    }
    if (later && X.U.length < X.V.length) { const u = new Float64Array(X.V.length); u.set(X.U); X.U = u; }
    if (!OWN_FIRST || OWN_FIRST.src !== mccMin) {
      OWN_FIRST = Float64Array.from(t.TOK, (tok, k) => ((tok[0] === 'R' || tok[0] === 'r') && !tok.endsWith('2') ? Math.max(0, mccMin[k] - 0.5) : mccMin[k]));
      OWN_FIRST.src = mccMin;
    }
    const OWNF = OWN_FIRST;
    const V = X.V;
    const U = X.U;
    const NM = later ? MID_T.length : 0;
    const leads = later ? LEAD_LATER : LEAD_ROOT;
    const END = NT;
    if (fromJ < 0) fromJ = 0;
    for (let j = fromJ; j <= n; j++) {
      const i = n - j;
      const base = j * RS;
      const prevBase = base - RS;
      const fc = i < n ? face[i] : 0;
      const pf = i + 1 < n && AXIS[fc] === AXIS[face[i + 1]];
      const o0 = fc * NR;
      if (i < n) {
        for (let k = O0[o0], e = O0[o0 + NR]; k < e; k++) {
          const t1 = OT1[k];
          const kind = OK[k];
          if (kind === 0) {
            OS[k] = pen[t1] + (pf ? 0 : OWNF[t1]);
            OX[k] = prevBase + OD[k] * NT2 + t1;
          } else if (kind === 1) {
            const t2 = OT2[k];
            OS[k] = pen[t1] + OWNF[t1] + pen[t2] + (pf ? 0 : OWNF[t2]) + V[prevBase + OD[k] * NT2 + t1 * NT1 + t2];
            OX[k] = t1 * NT1 + t2;
          } else {
            const m = OT2[k];
            const q2 = OT3[k];
            OS[k] = pen[t1] + OWNF[t1] + pen[m] + mccMin[m] + pen[q2] + (pf ? 0 : OWNF[q2])
              + lam * TRI[(t1 * NT1 + m) * NT1 + q2] + V[prevBase + OD[k] * NT2 + m * NT1 + q2];
            OX[k] = t1 * NT1 + m;
          }
        }
      }
      let ng = 0;
      let na = 0;
      if (i === 0) {
        for (const [lt, ld] of leads) {
          GD[ng] = ld; GB[ng] = lt >= 0 ? lt : NT; GA0[ng] = na; AL[na++] = NT; GA1[ng] = na; ng++;
        }
      } else {
        const mp = face[i - 1];
        for (let d1 = 0; d1 < NR; d1++) {
          let l0 = 0;
          let l1 = 0;
          let lead = -2;
          if (i === 1) {
            if (later) {
              for (const [lt, ld] of leads) if (ld === d1) lead = lt >= 0 ? lt : NT;
              if (lead === -2) continue;
            } else lead = NT;
          } else {
            l0 = LS0[face[i - 2] * NR + d1];
            l1 = LS0[face[i - 2] * NR + d1 + 1];
            if (l0 === l1) continue;
          }
          for (let k = O0[mp * NR + d1], e = O0[mp * NR + d1 + 1]; k < e; k++) {
            const kind = OK[k];
            GD[ng] = OD[k];
            GA0[ng] = na;
            if (kind === 0) {
              GB[ng] = OT1[k];
              if (lead !== -2) AL[na++] = lead;
              else for (let s2 = l0; s2 < l1; s2++) AL[na++] = LSV[s2];
              if (NM && i > 1) for (let q = 0; q < NM; q++) AL[na++] = MID_T[q];
            } else if (kind === 1) {
              GB[ng] = OT2[k];
              AL[na++] = OT1[k];
            } else {
              GB[ng] = OT3[k];
              AL[na++] = OT2[k];
            }
            GA1[ng] = na;
            ng++;
          }
        }
      }
      let least = Infinity;
      LEAST24.fill(Infinity);
      for (let g = 0; g < ng; g++) {
        const d = GD[g];
        const b = GB[g];
        // the group's options: move i from d after b (and after each
        // rotation m written before move i: U)
        let c = 0;
        if (i < n) {
          const bn = b * NT1;
          const bt = b * NT2;
          for (let k = O0[o0 + d], e = O0[o0 + d + 1]; k < e; k++) {
            GF[c] = OT1[k];
            GS[c] = OK[k] === 0 ? OS[k] + V[OX[k] + bn] : OS[k] + lam * TRI[bt + OX[k]];
            c++;
          }
          if (NM && i > 0) {
            for (let q = 0; q < NM; q++) {
              const m = MID_T[q];
              const dm = MID_D[d * NM + q];
              const mn = m * NT1;
              const mt = m * NT2;
              const cx = bn * NT1 + mn;
              let u = Infinity;
              for (let k = O0[o0 + dm], e = O0[o0 + dm + 1]; k < e; k++) {
                const v = (OK[k] === 0 ? OS[k] + V[OX[k] + mn] : OS[k] + lam * TRI[mt + OX[k]]) + lam * TRI[cx + OT1[k]];
                if (v < u) u = v;
              }
              U[base + dm * NT2 + bn + m] = u;
              GF[c] = m;
              GS[c] = pen[m] + mccMin[m] + u;
              c++;
            }
          }
        }
        for (let s2 = GA0[g], e2 = GA1[g]; s2 < e2; s2++) {
          const a = AL[s2];
          const cx = (a * NT1 + b) * NT1;
          let v = Infinity;
          if (i === n) {
            if (YF[d]) v = lam * TRI[cx + END];
          } else {
            for (let k = 0; k < c; k++) {
              const x = GS[k] + lam * TRI[cx + GF[k]];
              if (x < v) v = x;
            }
          }
          V[base + d * NT2 + a * NT1 + b] = v;
          if (v < LEAST24[d]) LEAST24[d] = v;
        }
      }
      for (let d = 0; d < NR; d++) if (LEAST24[d] < least) least = LEAST24[d];
      let stop = least + i * minMove > stopAbove;
      if (!stop && pre && i > 0 && stopAbove < Infinity && pre(i, PRE24)) {
        let m = Infinity;
        for (let d = 0; d < NR; d++) { const v = PRE24[d] + LEAST24[d]; if (v < m) m = v; }
        stop = m > stopAbove;
      }
      if (stop) {
        X.rows = j;
        return X;
      }
    }
    X.rows = Math.max(fromJ - 1, n);
    return X;
  }

  function enumerate(sols, opts) {
    const run = enumerateSteps(sols, opts);
    for (;;) {
      const r = run.next();
      if (r.done) return r.value;
    }
  }
  function* enumerateSteps(sols, opts) {
    const t = tables();
    const L = lmTables();
    // the settings' constants (script.js scoringFor; the defaults without)
    const mccMin = mccMinimum(opts.scoring ? opts.scoring.mcc : undefined);
    const pen = penalties(opts.scoring ? opts.scoring.pen : undefined);
    const { NR, NT, CONJ, WIDES, MIDS, MUL, YF, IS_ROT, IS_RL, QUARTERS, FACE_UD, R_QUARTER, UD_QUARTER } = t;
    const lam = pen[NT]; // the naturalness weight (penalties)
    const lm = L.lm;
    const NT1 = L.NT1;
    const RS = NR * NT1 * NT1;
    const leads = opts.root ? t.LEAD_ROOT : t.LEAD_LATER;
    const later = !opts.root;
    const leadBits = (lt) => (lt >= 0 ? lam * lm.trigramBits(lm.START, lm.START, L.id[lt]) : 0);
    const maxRL = opts.maxRL === undefined ? SPELLING_MAX_RL : opts.maxRL;
    const maxUDF = opts.maxUDF === undefined ? SPELLING_MAX_UDF : opts.maxUDF;
    let n = 0; // the walked solution's length (table rows are indexed by n - i)
    const stats = { solutions: sols.length, walked: 0, nodes: 0, rows: 0, seeded: 0 };
    const exact = !!opts.root && opts.exact !== false;
    const X = newExactTable();
    let Hw = null;
    const at = (i, d, f) => ((n - i) * NR + d) * FLAGS + f;
    const AFTER = L.AFTER;
    const budgetNow = () => Math.max(opts.budget(false), opts.budget(true));
    // the least a spelling of solution k (its table just computed) can cost
    const rootOf = (k) => {
      let m = Infinity;
      const V = X.V;
      const base = n * RS;
      for (const [lt, ld] of leads) {
        const v = (exact ? V[base + (ld * NT1 + NT) * NT1 + (lt >= 0 ? lt : NT)] : Hw[at(0, ld, 0)]) + (lt >= 0 ? mccMin[lt] + leadBits(lt) : 0);
        if (v < m) m = v;
      }
      return m + sols[k].look;
    };
    // the least any move adds, for stopping a bound early
    let minMove = Infinity;
    for (let k = 0; k < t.NT; k++) if (!IS_ROT[k]) minMove = Math.min(minMove, pen[k] + lam * L.MIN1[k]);
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const tStart = now();
    // pause points (see enumerateSteps): checked every 64 solutions
    const pauseMs = opts.pauseMs || 0;
    let lastPause = tStart;
    let tick = 0;
    const pauseDue = () => pauseMs > 0 && (++tick & 63) === 0 && now() - lastPause >= pauseMs;
    const written = new Int32Array(64);
    const done = new Uint8Array(sols.length);
    const est = new Float64Array(sols.length);
    const yLeads = leads.filter(([, ld]) => YF[ld]);
    for (let k = 0; k < sols.length; k++) {
      const face = sols[k].face;
      let m = Infinity;
      for (const [lt, ld] of yLeads) {
        let a = lm.START;
        let b = lt >= 0 ? L.id[lt] : lm.START;
        let v = lt >= 0 ? mccMin[lt] + leadBits(lt) : 0;
        for (let q = 0; q < face.length; q++) {
          const w = CONJ[ld][face[q]];
          const id = L.id[w];
          v += pen[w] + mccMin[w] + lam * lm.trigramBits(a, b, id);
          a = b;
          b = id;
        }
        if (v < m) m = v;
      }
      est[k] = m + sols[k].look;
    }
    const order = Array.from(sols.keys()).sort((x, y) => est[x] - est[y]);
    const first = order.slice(0, opts.prewalk || 256);
    const seedCount = Math.min(order.length, opts.seed || 0);
    const seeded = new Uint8Array(sols.length);
    for (let s = 0; s < seedCount; s++) {
      const k = order[s];
      seeded[k] = 1;
      const face = sols[k].face;
      for (const [lt, ld] of yLeads) {
        let len = 0;
        if (lt >= 0) written[len++] = lt;
        for (let q = 0; q < face.length; q++) written[len++] = CONJ[ld][face[q]];
        stats.seeded++;
        opts.leaf(written.subarray(0, len), ld, ld, sols[k]);
      }
    }
    if (opts.seedOnly) {
      stats.totalMs = Math.round(now() - tStart);
      return stats;
    }
    const tryWalk = (k) => {
      done[k] = 1;
      if (rootOf(k) > budgetNow()) return;
      walk(k);
    };
    let wps = 0;
    let wa = 0;
    let wb = 0;
    let wmcc = 0;
    let wown = 0;
    const write = (tok, at0, ps0, a0, b0, mcc0, pend0, any0, isMove) => {
      wps = ps0 + (at0 > 0 || !IS_ROT[tok] ? pen[tok] : 0);
      wa = a0;
      wb = b0;
      if (any0 || isMove) {
        const w = L.id[tok];
        wps += lam * lm.trigramBits(a0, b0, w);
        wa = b0;
        wb = w;
      }
      const pk = at0 > 0 ? written[at0 - 1] : -1;
      const paired = pk >= 0 && FACE_UD[pk] && FACE_UD[pk] + FACE_UD[tok] === 3;
      wown = mccMin[tok];
      if (R_QUARTER[tok] && at0 >= 2 && written[at0 - 2] === tok && UD_QUARTER[pk]) wown = Math.max(0, wown - 0.5);
      wmcc = mcc0 + (paired ? 0 : pend0);
      written[at0] = tok;
    };
    const walk = (k) => {
      const sol = sols[k];
      const face = sol.face;
      if (3 * n + 8 > written.length) return;
      stats.walked++;
      const look = sol.look;
      const V = X.V;
      const U = X.U;
      let lead = 0;
      let ud = 0;
      while (ud < n && FACE_UD[face[ud]]) ud++;
      const rec = (i, d, r, f, nRL, nUDF, a, b, ps, mcc, pend, len, anyTurn, wide, afterRot) => {
        stats.nodes++;
        const budget = opts.budget(wide);
        const tb = len >= 1 ? written[len - 1] : NT;
        let rest;
        if (exact) {
          const x = (n - i) * RS + (d * NT1 + (len >= 2 ? written[len - 2] : NT)) * NT1 + tb;
          rest = afterRot ? U[x] : V[x];
        } else if (f === 0 && i > 0) {
          rest = Hw[at(i, d, 0)] + lam * AFTER[((tb * NR + d) * 19 + (i < n ? face[i] : 18)) * 2 + r];
        } else rest = Hw[at(i, d, f)];
        // the last token's own MCC (pend) is certain unless it is a U or D
        // face turn (the next could pair with it: mccMinimum)
        if (ps + mcc + (len > 0 && !FACE_UD[tb] ? pend : 0) + look + rest > budget) return;
        if (i === n) {
          if (!YF[d]) return;
          // a seeded solution's plain spelling (no wide turn, no rotation
          // but the lead) was scored already
          if (seeded[k] && !wide && (opts.root || r === 0)) return;
          const step = ps + lam * lm.trigramBits(a, b, lm.END);
          if (step + mcc + pend + look > budget) return;
          opts.leaf(written.subarray(0, len), lead, d, sol, step);
          return;
        }
        if (!r && i > 0) {
          for (let k2 = i <= ud ? 2 : 0; k2 < MIDS.length; k2++) {
            write(MIDS[k2][0], len, ps, a, b, mcc, pend, anyTurn, false);
            rec(i, MUL[d][MIDS[k2][1]], 1, 0, nRL, nUDF, wa, wb, wps, wmcc, wown, len + 1, anyTurn, wide, true);
          }
        }
        const fi = face[i];
        const w = CONJ[d][fi];
        write(w, len, ps, a, b, mcc, pend, anyTurn, true);
        rec(i + 1, d, r, NEXT_PLAIN[f], nRL, nUDF, wa, wb, wps, wmcc, wown, len + 1, true, wide, false);
        const ws = WIDES[w];
        for (let k2 = 0; k2 < ws.length; k2++) {
          const W = ws[k2][0];
          if (IS_RL[W] ? nRL >= maxRL : nUDF >= maxUDF) continue;
          write(W, len, ps, a, b, mcc, pend, anyTurn, true);
          rec(i + 1, MUL[d][ws[k2][1]], r, 4, IS_RL[W] ? nRL + 1 : nRL, IS_RL[W] ? nUDF : nUDF + 1, wa, wb, wps, wmcc, wown, len + 1, true, true, false);
        }
        const quarters = QUARTERS[fi];
        if (!r) {
          // a half turn split by the mid-step rotation: q, rotation, q
          for (let qk = 0; qk < quarters.length; qk++) {
            const qf = quarters[qk];
            const q = CONJ[d][qf];
            for (let k2 = i < ud ? 2 : 0; k2 < MIDS.length; k2++) {
              const dm = MUL[d][MIDS[k2][1]];
              write(q, len, ps, a, b, mcc, pend, anyTurn, true);
              const ps1 = wps; const a1 = wa; const b1 = wb; const m1 = wmcc; const o1 = wown;
              write(MIDS[k2][0], len + 1, ps1, a1, b1, m1, o1, true, false);
              write(CONJ[dm][qf], len + 2, wps, wa, wb, wmcc, wown, true, true);
              rec(i + 1, dm, 1, 0, nRL, nUDF, wa, wb, wps, wmcc, wown, len + 3, true, wide, false);
            }
          }
        }
        // a half turn as a plain and a wide quarter turn, either order
        for (let qk = 0; qk < quarters.length; qk++) {
          const qf = quarters[qk];
          const q = CONJ[d][qf];
          const wq = WIDES[q];
          for (let k2 = 0; k2 < wq.length; k2++) {
            const W = wq[k2][0];
            if (IS_RL[W] ? nRL >= maxRL : nUDF >= maxUDF) continue;
            const d2 = MUL[d][wq[k2][1]];
            const rl2 = IS_RL[W] ? nRL + 1 : nRL;
            const udf2 = IS_RL[W] ? nUDF : nUDF + 1;
            write(q, len, ps, a, b, mcc, pend, anyTurn, true);
            write(W, len + 1, wps, wa, wb, wmcc, wown, true, true);
            rec(i + 1, d2, r, 0, rl2, udf2, wa, wb, wps, wmcc, wown, len + 2, true, true, false);
            write(W, len, ps, a, b, mcc, pend, anyTurn, true);
            write(CONJ[d2][qf], len + 1, wps, wa, wb, wmcc, wown, true, true);
            rec(i + 1, d2, r, 0, rl2, udf2, wa, wb, wps, wmcc, wown, len + 2, true, true, false);
          }
        }
      };
      // r = 1 from the start at a first step: no rotation inside the alg
      const r0 = opts.root ? 1 : 0;
      for (const [lt, ld] of leads) {
        lead = ld;
        if (lt >= 0) {
          written[0] = lt;
          rec(0, ld, r0, 0, 0, 0, lm.START, L.id[lt], leadBits(lt), 0, mccMin[lt], 1, false, false, false);
        } else {
          rec(0, ld, r0, 0, 0, 0, lm.START, lm.START, 0, 0, 0, 0, false, false, false);
        }
      }
    };
    let H = null;
    let next1 = 0;
    const prewalk = () => {
      for (; next1 < first.length; next1++) {
        if (pauseDue()) return false;
        const k = first[next1];
        n = sols[k].face.length;
        if (exact) exactTable(sols[k].face, X, mccMin, pen, L, 0, Infinity, 0, later);
        else Hw = H = boundTable(sols[k].face, H, mccMin, pen, L, 0, Infinity, 0, n, later);
        stats.rows += n + 1;
        tryWalk(k);
      }
      return true;
    };
    while (!prewalk()) { yield; lastPause = now(); }
    stats.prewalkMs = Math.round(now() - tStart);
    const byEnd = Array.from(sols.keys()).filter(k => !done[k]).sort((x, y) => {
      const a = sols[x].face;
      const b = sols[y].face;
      for (let q = 1; q <= Math.min(a.length, b.length); q++) {
        const c = a[a.length - q] - b[b.length - q];
        if (c) return c;
      }
      return a.length - b.length;
    });
    // Rows j need the last j + 2 moves (or the start) to match: the first
    // row to compute after the table of `prev` (prevRows of it complete).
    const firstRow = (prev, prevRows, face) => {
      if (!prev) return 0;
      const len = face.length;
      let same = 0;
      const lim = Math.min(prev.length, len);
      while (same < lim && prev[prev.length - 1 - same] === face[len - 1 - same]) same++;
      if (same === lim && prev.length !== len) same = Math.max(0, same - 1);
      return Math.max(0, Math.min(same - 1, len + 1, prevRows + 1));
    };
    const MITM_ROWS = 5;
    const fwdMemo = new Map();
    const F0 = new Float64Array(NR * FLAGS).fill(Infinity);
    for (const [lt, ld] of leads) F0[ld * FLAGS] = Math.min(F0[ld * FLAGS], lt >= 0 ? mccMin[lt] + leadBits(lt) : 0);
    if (!OWN_FIRST || OWN_FIRST.src !== mccMin) boundTable([], null, mccMin, pen, L); // sets OWN_FIRST
    const forwardAt = (face, q) => {
      // F after moves 0..q-1, keyed by moves 0..q (move q's own terms need it)
      if (q === 0) return F0;
      let key = 0;
      for (let p = 0; p <= q; p++) key = key * 19 + face[p] + 1;
      let F = fwdMemo.get(key);
      if (!F) {
        F = forwardStep(face, q - 1, forwardAt(face, q - 1), new Float64Array(NR * FLAGS), mccMin, pen, L, later);
        fwdMemo.set(key, F);
        stats.fwdRows++;
      }
      return F;
    };
    stats.fwdRows = 0;
    stats.cheapRows = 0;
    let HC = null;
    let prevC = null;
    let prevCRows = 0;
    let prev = null;
    let prevRows = 0;
    let next3 = 0;
    const mainPass = () => {
      for (; next3 < byEnd.length; next3++) {
        if (pauseDue()) return false;
        const k = byEnd[next3];
        const face = sols[k].face;
        n = face.length;
        const stop = budgetNow() - sols[k].look;
        const fromC = firstRow(prevC, prevCRows, face);
        const cut = Math.max(0, n - MITM_ROWS);
        const F = forwardAt(face, cut);
        let leastF = Infinity;
        for (let x = 0; x < NR * FLAGS; x++) if (F[x] < leastF) leastF = F[x];
        HC = boundTable(face, HC, mccMin, pen, L, fromC, stop - leastF + cut * minMove, minMove, n - cut, later);
        stats.cheapRows += Math.max(0, boundRows + 1 - fromC);
        prevC = face;
        prevCRows = boundRows;
        if (boundRows < n - cut) continue;
        {
          const row = (n - cut) * NR * FLAGS;
          let m = Infinity;
          for (let x = 0; x < NR * FLAGS; x++) { const v = F[x] + HC[row + x]; if (v < m) m = v; }
          if (m + sols[k].look > budgetNow()) continue;
        }
        if (!exact) {
          if (prevCRows < n) {
            HC = boundTable(face, HC, mccMin, pen, L, prevCRows + 1, stop, minMove, n, later);
            stats.cheapRows += Math.max(0, boundRows - prevCRows);
            prevCRows = boundRows;
            if (boundRows < n) continue;
          }
          Hw = HC;
          tryWalk(k);
          continue;
        }
        const fromJ = firstRow(prev, prevRows, face);
        // the cheap forward rows (memoised) bound the moves before a row by frame
        const pre = (i, out) => {
          if (i > cut) return false;
          const F = forwardAt(face, i);
          for (let d = 0; d < NR; d++) out[d] = Math.min(F[d * FLAGS], F[d * FLAGS + 1], F[d * FLAGS + 2], F[d * FLAGS + 3], F[d * FLAGS + 4]);
          return true;
        };
        exactTable(face, X, mccMin, pen, L, fromJ, stop, minMove, later, pre);
        stats.rows += Math.max(0, X.rows + 1 - fromJ);
        prev = face;
        prevRows = X.rows;
        if (X.rows < n) continue;
        tryWalk(k);
      }
      return true;
    };
    while (!mainPass()) { yield; lastPause = now(); }
    stats.totalMs = Math.round(now() - tStart);
    return stats;
  }

  function mccFloor(checkpoint) {
    const st = checkpoint && checkpoint.state;
    const start = st && st.starts && st.starts.length ? Math.min(...st.starts.map(s => s[2])) : 0;
    return start - 0.05;
  }

  const before = (a, b) => a.tpp < b.tpp || (a.tpp === b.tpp && a.key < b.key);
  class TopViews {
    constructor(views, size, initial) {
      this.views = views;
      this.size = size;
      this.initial = initial || views.map(() => Infinity);
      this.given = this.initial;
      this.heaps = views.map(() => []);
      this.keys = views.map(() => new Map());
    }

    limit(v) {
      const h = this.heaps[v];
      return Math.min(this.initial[v], h.length < this.size ? Infinity : h[0].tpp);
    }

    offer(c) {
      let kept = false;
      for (let v = 0; v < this.views.length; v++) {
        if (!this.views[v](c) || c.tpp > this.initial[v]) continue;
        const h = this.heaps[v];
        const keys = this.keys[v];
        const old = keys.get(c.key);
        if (old) {
          if (old.tpp <= c.tpp) continue;
          const i = h.indexOf(old);
          h[i] = c;
          keys.set(c.key, c);
          siftDown(h, i); // a lower tpp only moves down a max-heap
          kept = true;
        } else if (h.length < this.size) {
          h.push(c);
          keys.set(c.key, c);
          siftUp(h, h.length - 1);
          kept = true;
        } else if (before(c, h[0])) {
          keys.delete(h[0].key);
          h[0] = c;
          keys.set(c.key, c);
          siftDown(h, 0);
          kept = true;
        }
      }
      return kept;
    }

    tighten(limits) {
      let changed = false;
      for (let v = 0; v < this.views.length; v++) {
        if (limits[v] < this.initial[v]) {
          if (this.initial === this.given) this.initial = this.initial.slice();
          this.initial[v] = limits[v];
          changed = true;
        }
      }
      return changed;
    }

    snapshot() {
      const mask = new Map();
      for (let v = 0; v < this.heaps.length; v++) {
        for (const c of this.heaps[v]) mask.set(c, (mask.get(c) || 0) | (1 << v));
      }
      const out = [];
      for (const [c, m] of mask) out.push([c.key, c.tpp, m]);
      return out;
    }

    list() {
      const seen = new Set();
      const out = [];
      for (const h of this.heaps) for (const c of h) if (!seen.has(c)) { seen.add(c); out.push(c); }
      return out.sort((a, b) => (before(a, b) ? -1 : before(b, a) ? 1 : 0));
    }
  }
  function siftUp(h, i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!before(h[p], h[i])) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  function siftDown(h, i) {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && before(h[m], h[l])) m = l;
      if (r < h.length && before(h[m], h[r])) m = r;
      if (m === i) return;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }

  const BUDGET_EPS = 1e-9;
  function topSpellings(o) {
    const { run, finish } = spellingRun(o, 0);
    for (;;) if (run.next().done) return finish();
  }

  async function topSpellingsLive(o) {
    const { run, finish, top, retighten } = spellingRun(o, o.pauseMs || 100);
    let version = -1;
    for (;;) {
      const r = run.next();
      if (r.done) return finish();
      const changed = top.version !== version;
      version = top.version;
      const limits = await o.live(changed ? top.snapshot() : null);
      if (limits && top.tighten(limits)) retighten();
    }
  }

  function spellingRun(o, pauseMs) {
    const t = tables();
    // faces as token ids (callers may pass them so already)
    const sols = o.sols.map(s => (typeof s.face[0] === 'number' || !s.face.length ? s : { ...s, face: s.face.map(x => t.TID.get(x)) }));
    const top = new TopViews(o.views.map(v => v.test), o.size, o.initial);
    const limitTpp = (wide) => {
      let m = -Infinity;
      for (let v = 0; v < o.views.length; v++) if (!wide || o.views[v].wide) m = Math.max(m, top.limit(v));
      return m;
    };
    for (const c of o.extra || []) top.offer(c);
    let budgets = null;
    let exact = 0;
    top.version = 0;
    const run = enumerateSteps(sols, {
      pauseMs,
      root: o.root,
      seed: o.seed === undefined ? 2 * o.size : o.seed,
      seedOnly: !!o.seedOnly,
      maxRL: o.maxRL,
      maxUDF: o.maxUDF,
      exact: o.exact,
      scoring: o.scoring,
      // the budgets only change when a candidate is kept
      budget: (wide) => {
        if (!budgets) budgets = [limitTpp(false) * o.pieces - o.floor + BUDGET_EPS, limitTpp(true) * o.pieces - o.floor + BUDGET_EPS, limitTpp(false)];
        return budgets[wide ? 1 : 0];
      },
      leaf: (ids, lead, end, sol, step) => {
        let alg = '';
        for (let k = 0; k < ids.length; k++) alg += (k ? ' ' : '') + t.TOK[ids[k]];
        exact++;
        // a walk knows the spelling's own penalties + bits (stepPenalty)
        const cost = step !== undefined && o.mccOf ? o.mccOf(alg) + step : o.costOf(alg);
        const tpp = (cost + (sol.lookByEnd ? sol.lookByEnd[t.YIDX[end]] : sol.look)) / o.pieces;
        if (!budgets) budgets = [limitTpp(false) * o.pieces - o.floor + BUDGET_EPS, limitTpp(true) * o.pieces - o.floor + BUDGET_EPS, limitTpp(false)];
        if (!(tpp <= budgets[2])) return;
        const c = o.make(alg, lead, end, sol, tpp);
        if (c && top.offer(c)) { budgets = null; top.version++; }
      },
    });
    const finish = () => {
      const stats = run.result;
      stats.exact = exact;
      return { list: top.list(), stats };
    };
    return { run: { next: () => { const r = run.next(); if (r.done) run.result = r.value; return r; } }, finish, top, retighten: () => { budgets = null; } };
  }

  function plainEstimator(root, scoring = null) {
    const t = tables();
    const L = lmTables();
    const mccMin = mccMinimum(scoring ? scoring.mcc : undefined);
    const pen = penalties(scoring ? scoring.pen : undefined);
    const lam = pen[t.NT];
    const lm = L.lm;
    const leads = (root ? t.LEAD_ROOT : t.LEAD_LATER).filter(([, ld]) => t.YF[ld]);
    return (faceTokens) => {
      let m = Infinity;
      for (const [lt, ld] of leads) {
        let a = lm.START;
        let b = lt >= 0 ? L.id[lt] : lm.START;
        let v = lt >= 0 ? mccMin[lt] + lam * lm.trigramBits(lm.START, lm.START, L.id[lt]) : 0;
        for (let q = 0; q < faceTokens.length; q++) {
          const w = t.CONJ[ld][t.TID.get(faceTokens[q])];
          const id = L.id[w];
          v += pen[w] + mccMin[w] + lam * lm.trigramBits(a, b, id);
          a = b;
          b = id;
        }
        if (v < m) m = v;
      }
      return m;
    };
  }
  function plainEstimate(faceTokens, root) {
    return plainEstimator(root)(faceTokens);
  }

  function orientationName(index) {
    return tables().ROT_NAME[index];
  }

  return { FLAGS, tables, enumerate, topSpellings, topSpellingsLive, plainEstimate, plainEstimator, orientationName, boundTable, forwardStep, exactTable, newExactTable, mccMinimum, mccFloor, lmTables, penalties, TopViews, SPELLING_MAX_RL, SPELLING_MAX_UDF };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SpellingSearch };
}
