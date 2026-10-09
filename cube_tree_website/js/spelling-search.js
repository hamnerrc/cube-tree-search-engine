/**
 * spelling-search.js -- every spelling of every face-turn solution, best
 * first (README "Complete search").
 *
 * The engine lists every face-turn solution of a goal up to the move limit
 * (uncapped). A human may write each of them in many ways: a free leading
 * rotation (the inspection at the first step; y, y' or y2 at a later one),
 * at most one mid-step y, y', x or x', any turn as a wide turn (r l, and at
 * most SPELLING_MAX_UDF of u d f; never a wide b), as long as the cross ends
 * on the bottom. Every spelling is physically "the face-turn solution, then
 * a y-family rotation", so it solves the same pieces.
 *
 * Scoring every spelling is far too slow (hundreds per solution, up to
 * hundreds of thousands of solutions), so this is a branch and bound that
 * finds exactly the best N of them (by TPP) without scoring the rest:
 *
 *   cost(spelling) = MCC(path + spelling) + penalties + natural * bits + look
 *                 >= C0 + sum over tokens of [penalty + natural * bits + minMCC(token)] + look
 *
 * - penalties and naturalness bits (stepPenalty) are sums over tokens, each
 *   >= 0, computed exactly as the spelling is written;
 * - MCC (script.js algSpeed) never lowers its running time below a test's
 *   start except where noted in mccMinimum, so every token adds at least its
 *   case's smallest increment (minMCC) and the path's MCC is at least the
 *   checkpoint's least start time (C0; SpellingSearch.mccFloor);
 * - the moves still to write are bounded by a DP over (move, frame,
 *   previous tokens known) with the least bits of each token in any context
 *   compatible with the state (boundTable);
 * - a cheap estimate picks solutions likely to be best to walk first (a
 *   tight N-th best early); every other solution's bound table is computed
 *   (rows shared by solutions that end alike) and it is walked only if its
 *   bound fits under the N-th best so far.
 * Every spelling that could be in the top N is scored with the real
 * function (the caller's leaf), so the result is exact; tests compare it
 * with brute force (test/spelling-search.test.js).
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
    for (const r of ['', 'y', 'y2', "y'"]) YF[RIDX.get(RI(r))] = 1;
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
    T = { NR, YF, ROT_NAME, MUL, TOK, TID, NT, IS_ROT, IS_RL, AXIS, CONJ, WIDES, MIDS, QUARTERS, LEAD_LATER, LEAD_ROOT, FACE_T };
    return T;
  }
  // facelet-cube.js keeps orientation names internal; rotationName of a
  // rotation string is public, so name each orientation by searching the
  // short rotation strings once.
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

  /**
   * The least MCC increment of each token (script.js algSpeed, one case per
   * move; wide turns use their face's case): R/r quarter turns wristMult, of
   * which MCC takes back 0.5 (or 0.3) when the same R comes two moves after
   * itself across a U/D turn (applied only where that pattern is written);
   * the rest the smallest constant of any branch of their case. The other
   * place MCC lowers its time is a U followed by D (or D by U): the second
   * restarts from before the first, so the first may add nothing -- the
   * caller counts a token only once the next one is known not to pair with it.
   */
  let MCC = null;
  function mccMinimum() {
    const t = tables();
    const A = ALG_SPEED_DEFAULTS;
    const key = JSON.stringify(A);
    if (MCC && MCC.key === key) return MCC.min;
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
    MCC = { key, min };
    return min;
  }

  /** stepPenalty's per-token penalties (a token at index 0 pays none of them for a rotation). */
  function penalties() {
    const t = tables();
    const P = STEP_PENALTIES;
    return Float64Array.from(t.TOK, (tok) => {
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
    // AFTER[((prev * NR + d) * 19 + move) * 2 + r]: the least extra bits
    // (over MIN1) of the first token written for face move `move` (face
    // token id < 18) in frame d right after token `prev`, over every way to
    // start writing it (plain, wide, a split's first token, a mid rotation
    // when r = 0); move 18 = the end. boundTable adds it after a
    // written non-plain token instead of the exact context.
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
    LMT = { model, lm, id, MIN0, MIN1, MIN2, NT1, TRI, AFTER };
    return LMT;
  }

  /**
   * Bound table of one face-turn solution (token ids), into H. Rows are
   * indexed by the moves still to write, j = n - i:
   * H[(j * NR + d) * 3 + f] = least (penalty + natural * bits + minMCC) that
   * moves i.. can still add when the cube is in frame d and the tokens
   * before are known: f = 2 when the last two are the plain spellings of
   * moves i-2 and i-1 in frame d (their trigram is then exact), f = 1 when
   * only the last one is (bits conditioned on it), f = 0 otherwise. Infinity
   * when the cross can no longer end on D. Relaxations that keep it cheap
   * (each only lowers it): a rotation may be written before any move, as
   * often as the bound likes; after a written non-plain token (wide,
   * rotation, a split's second token) the next token's bits are its least
   * after anything (MIN1) plus AFTER, the least extra any first token of the
   * next move has after that token. (An exact-context version, memoised per
   * written token, was ~4x tighter in rows ruled out but ~8x the cost per row;
   * walking with this one is faster overall.) Row j depends only on the last
   * j moves and the two before them, so rows below `fromJ` are kept from the
   * previous solution when it ends the same way (enumerate sorts for that).
   * Stops early (boundRows < n) once the last moves alone cost more than
   * stopAbove. Tested <= the real cost (test/spelling-search.test.js).
   */
  const FLAGS = 3;
  let OWN_FIRST = null;
  // boundTable's last complete row (n when the whole table was computed).
  let boundRows = 0;
  let RO = null;
  function rowOptions() {
    if (RO) return RO;
    const t = tables();
    const { NR, CONJ, WIDES, MIDS, MUL, QUARTERS } = t;
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
    RO = { W0, Q0, M0, WI: Int32Array.from(wides), QI: Int32Array.from(qs), MI: Int32Array.from(ms), MID_T, MID_D };
    return RO;
  }
  let rowBase = new Float64Array(24 * 3);
  function boundTable(face, H, mccMin, pen, L, fromJ = 0, stopAbove = Infinity, minMove = 0) {
    const t = tables();
    const { NR, NT, CONJ, AXIS, YF, TOK } = t;
    const { W0, Q0, M0, WI, QI, MI, MID_T, MID_D } = rowOptions();
    const NM = MID_T.length;
    const lam = STEP_PENALTIES.natural;
    const { TRI, MIN2, MIN1, AFTER, NT1 } = L;
    const n = face.length;
    const RS = NR * 3;
    if (!H || H.length < (n + 1) * RS) {
      const grown = new Float64Array(Math.max((n + 1) * RS, 40 * RS));
      if (H) grown.set(H);
      H = grown;
    }
    // A token's least MCC as the bound counts it: an R quarter turn may get
    // MCC's 0.5 back, and the first of two same-axis moves (U then D) may add
    // nothing (pf).
    if (!OWN_FIRST || OWN_FIRST.src !== mccMin) {
      OWN_FIRST = Float64Array.from(TOK, (tok, k) => ((tok[0] === 'R' || tok[0] === 'r') && !tok.endsWith('2') ? Math.max(0, mccMin[k] - 0.5) : mccMin[k]));
      OWN_FIRST.src = mccMin;
    }
    const OWNF = OWN_FIRST;
    const START = (NT * NT1 + NT) * NT1;
    if (fromJ <= 0) {
      const i = n;
      for (let d = 0; d < NR; d++) {
        for (let f = 0; f < 3; f++) {
          let b;
          if (!YF[d]) b = Infinity;
          else if (i === 0) b = TRI[START + NT];
          else {
            const pb = CONJ[d][face[i - 1]];
            if (f === 2 || (f === 1 && i === 1)) b = TRI[((i >= 2 ? CONJ[d][face[i - 2]] : NT) * NT1 + pb) * NT1 + NT];
            else b = f === 1 ? MIN2[pb * NT1 + NT] : MIN1[NT];
          }
          H[d * 3 + f] = lam * b;
        }
      }
      fromJ = 1;
    }
    const base = rowBase;
    for (let j = fromJ; j <= n; j++) {
      const i = n - j;
      const fc = face[i];
      const pf = i + 1 < n && AXIS[fc] === AXIS[face[i + 1]];
      const next = j > 1 ? face[i + 1] : 18; // AFTER's move index for the continuation
      const prevRow = (j - 1) * RS;
      const row = j * RS;
      let least = Infinity;
      for (let d = 0; d < NR; d++) {
        const x = fc * NR + d;
        const cd = CONJ[d];
        const pp = i > 0 ? cd[face[i - 1]] : -1;
        // bits of token k with flag f: i = 0 the start; else see bitsAt
        const ctx2 = i > 0 ? ((i >= 2 ? cd[face[i - 2]] : NT) * NT1 + pp) * NT1 : 0;
        const ctx1 = pp * NT1;
        const w = cd[fc];
        const ownW = pf ? 0 : OWNF[w];
        let v0;
        let v1;
        let v2;
        {
          const c = pen[w] + ownW;
          if (i === 0) {
            const b = lam * TRI[START + w];
            v0 = c + b + H[prevRow + d * 3 + 1];
            v1 = c + b + H[prevRow + d * 3 + 2];
            v2 = c + b + H[prevRow + d * 3 + 2];
          } else {
            v0 = c + lam * MIN1[w] + H[prevRow + d * 3 + 1];
            v1 = c + lam * (i === 1 ? TRI[ctx2 + w] : MIN2[ctx1 + w]) + H[prevRow + d * 3 + 2];
            v2 = c + lam * TRI[ctx2 + w] + H[prevRow + d * 3 + 2];
          }
        }
        // one-token alternatives (wide): first-token bits only depend on f
        for (let k = W0[x], e = W0[x + 1]; k < e; k++) {
          const W = WI[2 * k];
          const d2 = WI[2 * k + 1];
          const c = pen[W] + (pf ? 0 : OWNF[W]) + H[prevRow + d2 * 3] + lam * AFTER[((W * NR + d2) * 19 + next) * 2];
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
          }
        }
        // two-token splits of a half turn (plain + wide quarter, either order)
        for (let k = Q0[x], e = Q0[x + 1]; k < e; k++) {
          const t1 = QI[3 * k];
          const t2 = QI[3 * k + 1];
          const d2 = QI[3 * k + 2];
          const c = pen[t1] + OWNF[t1] + pen[t2] + (pf ? 0 : OWNF[t2]) + H[prevRow + d2 * 3] + lam * AFTER[((t2 * NR + d2) * 19 + next) * 2];
          if (i === 0) {
            const v = c + lam * (TRI[START + t1] + TRI[(NT * NT1 + t1) * NT1 + t2]);
            if (v < v0) v0 = v;
            if (v < v1) v1 = v;
            if (v < v2) v2 = v;
          } else {
            const s0 = MIN2[t1 * NT1 + t2];
            const s1 = TRI[(pp * NT1 + t1) * NT1 + t2];
            let v = c + lam * (MIN1[t1] + s0);
            if (v < v0) v0 = v;
            v = c + lam * ((i === 1 ? TRI[ctx2 + t1] : MIN2[ctx1 + t1]) + s1);
            if (v < v1) v1 = v;
            v = c + lam * (TRI[ctx2 + t1] + s1);
            if (v < v2) v2 = v;
          }
        }
        // a half turn split around a rotation (q, rotation, q)
        for (let k = M0[x], e = M0[x + 1]; k < e; k++) {
          const q = MI[4 * k];
          const m = MI[4 * k + 1];
          const q2 = MI[4 * k + 2];
          const dm = MI[4 * k + 3];
          const c = pen[q] + OWNF[q] + pen[m] + mccMin[m] + lam * TRI[(q * NT1 + m) * NT1 + q2] + pen[q2] + (pf ? 0 : OWNF[q2])
            + H[prevRow + dm * 3] + lam * AFTER[((q2 * NR + dm) * 19 + next) * 2];
          if (i === 0) {
            const v = c + lam * (TRI[START + q] + TRI[(NT * NT1 + q) * NT1 + m]);
            if (v < v0) v0 = v;
            if (v < v1) v1 = v;
            if (v < v2) v2 = v;
          } else {
            const s0 = MIN2[q * NT1 + m];
            const s1 = TRI[(pp * NT1 + q) * NT1 + m];
            let v = c + lam * (MIN1[q] + s0);
            if (v < v0) v0 = v;
            v = c + lam * ((i === 1 ? TRI[ctx2 + q] : MIN2[ctx1 + q]) + s1);
            if (v < v1) v1 = v;
            v = c + lam * (TRI[ctx2 + q] + s1);
            if (v < v2) v2 = v;
          }
        }
        base[d * 3] = v0;
        base[d * 3 + 1] = v1;
        base[d * 3 + 2] = v2;
      }
      // a rotation before move i (not before the first turn), then move i
      // from the rotated frame: its first token's bits after the rotation
      // are flag 0 plus AFTER (no further rotation: r = 1)
      for (let d = 0; d < NR; d++) {
        let v0 = base[d * 3];
        let v1 = base[d * 3 + 1];
        let v2 = base[d * 3 + 2];
        if (i > 0) {
          const cd = CONJ[d];
          const pp = cd[face[i - 1]];
          const ctx2 = ((i >= 2 ? cd[face[i - 2]] : NT) * NT1 + pp) * NT1;
          for (let k = 0; k < NM; k++) {
            const m = MID_T[k];
            const dm = MID_D[d * NM + k];
            const c = pen[m] + mccMin[m] + base[dm * 3] + lam * AFTER[((m * NR + dm) * 19 + fc) * 2 + 1];
            let v = c + lam * MIN1[m];
            if (v < v0) v0 = v;
            v = c + lam * (i === 1 ? TRI[ctx2 + m] : MIN2[pp * NT1 + m]);
            if (v < v1) v1 = v;
            v = c + lam * TRI[ctx2 + m];
            if (v < v2) v2 = v;
          }
        }
        H[row + d * 3] = v0;
        H[row + d * 3 + 1] = v1;
        H[row + d * 3 + 2] = v2;
        if (v0 < least) least = v0;
        if (v1 < least) least = v1;
        if (v2 < least) least = v2;
      }
      if (least + (n - j) * minMove > stopAbove) {
        boundRows = j;
        return H;
      }
    }
    boundRows = n;
    return H;
  }

  /**
   * Every spelling whose bound fits the budget, best-first over solutions.
   * sols: [{ face: [token ids], look }]. opts: {
   *   root: first step (the leading rotation is the free inspection, any of
   *         the 24 orientations; it is not part of the written alg),
   *   budget(wide): the most (C0 excluded) penalty + bits + minMCC + look a
   *         spelling may reach and still matter (wide: a wide turn written),
   *   leaf(tokens, leadIndex, endFrame, sol): a complete spelling to score.
   * }
   * Returns stats { solutions, walked, nodes }.
   */
  function enumerate(sols, opts) {
    const t = tables();
    const L = lmTables();
    const mccMin = mccMinimum();
    const pen = penalties();
    const { NR, CONJ, WIDES, MIDS, MUL, YF, TOK, IS_ROT, IS_RL, QUARTERS } = t;
    const lam = STEP_PENALTIES.natural;
    const lm = L.lm;
    const leads = opts.root ? t.LEAD_ROOT : t.LEAD_LATER;
    const maxRL = opts.maxRL === undefined ? SPELLING_MAX_RL : opts.maxRL;
    const maxUDF = opts.maxUDF === undefined ? SPELLING_MAX_UDF : opts.maxUDF;
    let n = 0; // the walked solution's length (H rows are indexed by n - i)
    const at = (i, d, f) => ((n - i) * NR + d) * FLAGS + f;
    const stats = { solutions: sols.length, walked: 0, nodes: 0, rows: 0, seeded: 0 };
    let H = null;
    const budgetNow = () => Math.max(opts.budget(false), opts.budget(true));
    const rootOf = (k) => {
      let m = Infinity;
      for (const [lt, ld] of leads) {
        const v = H[at(0, ld, 0)] + (lt >= 0 ? mccMin[lt] : 0);
        if (v < m) m = v;
      }
      return m + sols[k].look;
    };
    // the least any move adds, for stopping a bound early
    let minMove = Infinity;
    for (let k = 0; k < t.NT; k++) if (!IS_ROT[k]) minMove = Math.min(minMove, pen[k] + lam * L.MIN1[k]);
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const tStart = now();
    const written = new Int32Array(64);
    const done = new Uint8Array(sols.length);
    // Phase 1: a cheap estimate (not a bound) of each solution's plain
    // spelling, to walk the likely best ones first and get a tight N-th best
    // early. Phase 2: those, each with its own bound table. Phase 3: all the
    // others, solutions that end alike one after the other so their bound
    // rows are shared, each walked right away if its bound fits.
    const est = new Float64Array(sols.length);
    const yLeads = leads.filter(([, ld]) => YF[ld]);
    for (let k = 0; k < sols.length; k++) {
      const face = sols[k].face;
      let m = Infinity;
      for (const [lt, ld] of yLeads) {
        let a = lm.START;
        let b = lm.START;
        let v = lt >= 0 ? mccMin[lt] : 0;
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
    // Phase 1b: the plain spellings (every y-family lead) of the best
    // estimated solutions are scored first: real candidates, so the N-th
    // best -- and every walk's budget -- is tight from the start, instead of
    // infinite until N spellings of whatever the first walks meet are found.
    const seedCount = Math.min(order.length, opts.seed || 0);
    for (let s = 0; s < seedCount; s++) {
      const k = order[s];
      const face = sols[k].face;
      for (const [lt, ld] of yLeads) {
        let len = 0;
        if (lt >= 0) written[len++] = lt;
        for (let q = 0; q < face.length; q++) written[len++] = CONJ[ld][face[q]];
        stats.seeded++;
        opts.leaf(written.subarray(0, len), ld, ld, sols[k]);
      }
    }
    const tryWalk = (k) => {
      done[k] = 1;
      if (rootOf(k) > budgetNow()) return;
      walk(k);
    };
    const walk = (k) => {
      const sol = sols[k];
      const face = sol.face;
      if (3 * n + 8 > written.length) return;
      stats.walked++;
      const look = sol.look;
      let lead = 0;
      // ps: penalties + bits so far; mcc: least MCC of the tokens before the
      // last; pend: the last token's own least MCC (counted once the next
      // token is known not to pair with it).
      const rec = (i, d, r, f, nRL, nUDF, a, b, ps, mcc, pend, len, anyTurn, wide) => {
        stats.nodes++;
        const budget = opts.budget(wide);
        if (ps + mcc + look + H[at(i, d, f)] > budget) return;
        if (i === n) {
          if (!YF[d]) return;
          if (ps + lam * lm.trigramBits(a, b, lm.END) + mcc + pend + look > budget) return;
          opts.leaf(written.subarray(0, len), lead, d, sol);
          return;
        }
        // Writes token `tok` after the node's tokens: the new penalties +
        // bits (wps), naturalness context (wa, wb), least MCC so far (wmcc)
        // and the token's own least MCC (wown), from the given state.
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
          const pt = at0 > 0 ? TOK[written[at0 - 1]] : '';
          const tt = TOK[tok];
          const paired = (pt[0] === 'U' && tt[0] === 'D') || (pt[0] === 'D' && tt[0] === 'U');
          wown = mccMin[tok];
          if ((tt === 'R' || tt === "R'" || tt === 'r' || tt === "r'") && at0 >= 2 && written[at0 - 2] === tok) {
            const m = pt.toUpperCase();
            if (m === "U'" || m === 'U' || m === "D'" || m === 'D') wown = Math.max(0, wown - 0.5);
          }
          wmcc = mcc0 + (paired ? 0 : pend0);
          written[at0] = tok;
        };
        const step = (tok, d2, r2, f2, rl2, udf2, isMove, wide2) => {
          write(tok, len, ps, a, b, mcc, pend, anyTurn, isMove);
          rec(isMove ? i + 1 : i, d2, r2, f2, rl2, udf2, wa, wb, wps, wmcc, wown, len + 1, anyTurn || isMove, wide2);
        };
        // two tokens for one (half-turn) move, the second with frame d2
        const step2 = (t1, t2, d2, rl2, udf2) => {
          write(t1, len, ps, a, b, mcc, pend, anyTurn, true);
          write(t2, len + 1, wps, wa, wb, wmcc, wown, true, true);
          rec(i + 1, d2, r, 0, rl2, udf2, wa, wb, wps, wmcc, wown, len + 2, true, true);
        };
        if (!r && i > 0) {
          for (let k2 = 0; k2 < MIDS.length; k2++) step(MIDS[k2][0], MUL[d][MIDS[k2][1]], 1, 0, nRL, nUDF, false, wide);
        }
        const w = CONJ[d][face[i]];
        step(w, d, r, f === 2 ? 2 : f + 1, nRL, nUDF, true, wide);
        const ws = WIDES[w];
        for (let k2 = 0; k2 < ws.length; k2++) {
          const W = ws[k2][0];
          if (IS_RL[W] ? nRL >= maxRL : nUDF >= maxUDF) continue;
          step(W, MUL[d][ws[k2][1]], r, 0, IS_RL[W] ? nRL + 1 : nRL, IS_RL[W] ? nUDF : nUDF + 1, true, true);
        }
        if (!r) {
          // a half turn split by the mid-step rotation: q, rotation, q
          for (const qf of QUARTERS[face[i]]) {
            const q = CONJ[d][qf];
            for (let k2 = 0; k2 < MIDS.length; k2++) {
              const dm = MUL[d][MIDS[k2][1]];
              write(q, len, ps, a, b, mcc, pend, anyTurn, true);
              const ps1 = wps; const a1 = wa; const b1 = wb; const m1 = wmcc; const o1 = wown;
              write(MIDS[k2][0], len + 1, ps1, a1, b1, m1, o1, true, false);
              write(CONJ[dm][qf], len + 2, wps, wa, wb, wmcc, wown, true, true);
              rec(i + 1, dm, 1, 0, nRL, nUDF, wa, wb, wps, wmcc, wown, len + 3, true, wide);
            }
          }
        }
        for (const qf of QUARTERS[face[i]]) {
          const q = CONJ[d][qf];
          for (const [W, rho] of WIDES[q]) {
            if (IS_RL[W] ? nRL >= maxRL : nUDF >= maxUDF) continue;
            const d2 = MUL[d][rho];
            const rl2 = IS_RL[W] ? nRL + 1 : nRL;
            const udf2 = IS_RL[W] ? nUDF : nUDF + 1;
            step2(q, W, d2, rl2, udf2);
            step2(W, CONJ[d2][qf], d2, rl2, udf2);
          }
        }
      };
      for (const [lt, ld] of leads) {
        lead = ld;
        if (H[at(0, ld, 0)] + (lt >= 0 ? mccMin[lt] : 0) + look > Math.max(opts.budget(false), opts.budget(true))) continue;
        if (lt >= 0) {
          written[0] = lt;
          rec(0, ld, 0, 0, 0, 0, lm.START, lm.START, 0, 0, mccMin[lt], 1, false, false);
        } else {
          rec(0, ld, 0, 0, 0, 0, lm.START, lm.START, 0, 0, 0, 0, false, false);
        }
      }
    };
    for (const k of first) {
      n = sols[k].face.length;
      H = boundTable(sols[k].face, H, mccMin, pen, L);
      tryWalk(k);
    }
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
    let prev = null;
    let prevRows = 0;
    for (const k of byEnd) {
      const face = sols[k].face;
      n = face.length;
      // rows j need the last j + 2 moves (or the start) to match
      let same = 0;
      if (prev) {
        const lim = Math.min(prev.length, n);
        while (same < lim && prev[prev.length - 1 - same] === face[n - 1 - same]) same++;
        if (same === lim && prev.length !== n) same = Math.max(0, same - 1);
      }
      const fromJ = prev ? Math.max(0, Math.min(same - 1, n + 1, prevRows + 1)) : 0;
      stats.rows += n + 1 - fromJ;
      H = boundTable(face, H, mccMin, pen, L, fromJ, budgetNow() - sols[k].look, minMove);
      prev = face;
      prevRows = boundRows;
      if (boundRows < n) continue;
      tryWalk(k);
    }
    stats.totalMs = Math.round(now() - tStart);
    return stats;
  }

  /**
   * Least MCC of `path + anything` (algSpeedPrefix checkpoint of the
   * committed path): its least start time, minus algSpeed's rounding.
   */
  function mccFloor(checkpoint) {
    const st = checkpoint && checkpoint.state;
    const start = st && st.starts && st.starts.length ? Math.min(...st.starts.map(s => s[2])) : 0;
    return start - 0.05;
  }

  /**
   * The best `size` candidates of each view (a view = a filter the results
   * page can apply instantly), each candidate kept once per key.
   * views: [fn(candidate) -> belongs]. initial: optional per-view TPP limit
   * known from elsewhere (other calls of the same type).
   */
  class TopViews {
    constructor(views, size, initial) {
      this.views = views;
      this.size = size;
      this.initial = initial || views.map(() => Infinity);
      this.heaps = views.map(() => []);
      this.keys = views.map(() => new Map());
    }

    /** The TPP a candidate in view v must beat (Infinity until the view is full). */
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
        } else if (c.tpp < h[0].tpp) {
          keys.delete(h[0].key);
          h[0] = c;
          keys.set(c.key, c);
          siftDown(h, 0);
          kept = true;
        }
      }
      return kept;
    }

    /** Every kept candidate once, best first. */
    list() {
      const seen = new Set();
      const out = [];
      for (const h of this.heaps) for (const c of h) if (!seen.has(c)) { seen.add(c); out.push(c); }
      return out.sort((a, b) => a.tpp - b.tpp);
    }
  }
  function siftUp(h, i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (h[p].tpp >= h[i].tpp) break;
      [h[p], h[i]] = [h[i], h[p]];
      i = p;
    }
  }
  function siftDown(h, i) {
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && h[l].tpp > h[m].tpp) m = l;
      if (r < h.length && h[r].tpp > h[m].tpp) m = r;
      if (m === i) return;
      [h[m], h[i]] = [h[i], h[m]];
      i = m;
    }
  }

  /**
   * The best `size` spellings of each view, exactly. o: {
   *   sols: [{ face: [face-turn tokens] or token ids, look, lookByEnd }]
   *   (look: added to the cost; lookByEnd, optional: by end frame instead,
   *   with look its least over the y-family frames),
   *   root, pieces, floor (C0 + the committed steps' penalties: cost minus
   *   that is what enumerate bounds), costOf(alg) (path cost, the real one),
   *   views: [{ test(candidate), wide (may contain wide turns) }], size,
   *   initial: [TPP limit per view] (optional),
   *   make(alg, leadIndex, endFrame, sol, tpp): the candidate (with .key and
   *   .tpp) or null,
   *   maxRL, maxUDF (optional), extra: candidates to offer as they are,
   * }
   * Returns { list, stats }.
   */
  function topSpellings(o) {
    const t = tables();
    const sols = o.sols.map(s => ({ ...s, face: s.face.map(x => (typeof x === 'number' ? x : t.TID.get(x))) }));
    const top = new TopViews(o.views.map(v => v.test), o.size, o.initial);
    const limitTpp = (wide) => {
      let m = -Infinity;
      for (let v = 0; v < o.views.length; v++) if (!wide || o.views[v].wide) m = Math.max(m, top.limit(v));
      return m;
    };
    for (const c of o.extra || []) top.offer(c);
    let exact = 0;
    const stats = enumerate(sols, {
      root: o.root,
      seed: o.seed === undefined ? 2 * o.size : o.seed,
      maxRL: o.maxRL,
      maxUDF: o.maxUDF,
      budget: wide => limitTpp(wide) * o.pieces - o.floor,
      leaf: (ids, lead, end, sol) => {
        let alg = '';
        for (let k = 0; k < ids.length; k++) alg += (k ? ' ' : '') + t.TOK[ids[k]];
        exact++;
        const tpp = (o.costOf(alg) + (sol.lookByEnd ? sol.lookByEnd[end] : sol.look)) / o.pieces;
        if (!(tpp <= limitTpp(false))) return;
        const c = o.make(alg, lead, end, sol, tpp);
        if (c) top.offer(c);
      },
    });
    stats.exact = exact;
    return { list: top.list(), stats };
  }

  /** The name of orientation `index` (a leadIndex or endFrame of enumerate). */
  function orientationName(index) {
    return tables().ROT_NAME[index];
  }

  return { FLAGS, tables, enumerate, topSpellings, orientationName, boundTable, mccMinimum, mccFloor, lmTables, penalties, TopViews, SPELLING_MAX_RL, SPELLING_MAX_UDF };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SpellingSearch };
}
