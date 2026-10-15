/**
 * alg-sets.js -- the last-layer and last-slot algorithm sets (README
 * "Algorithm sets"): OLL, PLL, COLL, ZBLL, OLS (VLS + HLS) and ZBLS.
 *
 * A case is a class of cube states one algorithm solves: states that differ
 * by a U turn before the alg (pre-AUF) or a U turn of the solved cube before
 * the case was made (post-AUF) are the same case. Each set says which pieces
 * and which orientations it looks at (`key`), and its cases are enumerated
 * here from every state the set allows, so the case lists are complete by
 * construction (counts checked in test/alg-sets.test.js against the known
 * numbers: OLL 57, PLL 21, COLL 42, ZBLL 472, VLS 216, ZBLS 302).
 *
 * States are cubies (Kociemba numbering: corners URF UFL ULB UBR DFR DLF DBL
 * DRB, edges UR UF UL UB DR DF DL DB FR FL BL BR; cp[i] = the piece at
 * position i). The cubie of a move is read off the facelet simulator
 * (facelet-cube.js, verified against magiccube) by converting the facelets
 * after the move, so no move is typed here. Facelets are first relabelled by
 * the centres (`labelsOf`), so whole-cube rotations, wide and slice turns all
 * reduce to the cube as seen from its centres.
 */
'use strict';

const AlgSets = (() => {
  // facelet indices of each corner / edge position, clockwise from the U/D sticker
  const CORNER_FACELETS = [[8, 9, 20], [6, 18, 38], [0, 36, 47], [2, 45, 11], [29, 26, 15], [27, 44, 24], [33, 53, 42], [35, 17, 51]];
  const EDGE_FACELETS = [[5, 10], [7, 19], [3, 37], [1, 46], [32, 16], [28, 25], [30, 43], [34, 52], [23, 12], [21, 41], [50, 39], [48, 14]];
  const CORNER_NAMES = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
  const EDGE_NAMES = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];
  const CORNER_COLORS = CORNER_NAMES.map(n => [...n]);
  const EDGE_COLORS = EDGE_NAMES.map(n => [...n]);
  const SOLVED_LABELS = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';
  // the data files' cache-buster: bump it whenever data/ll/*.json are rebuilt
  const DATA_VERSION = '20261017b';
  const dataUrl = setId => `data/ll/${setId}.json?v=${DATA_VERSION}`;

  /** Facelets (any colours) -> the same cube in face letters, by its centres. */
  function labelsOf(facelets) {
    const map = {};
    for (let f = 0; f < 6; f++) map[facelets[9 * f + 4]] = 'URFDLB'[f];
    let out = '';
    for (let i = 0; i < 54; i++) out += map[facelets[i]] || '?';
    return out;
  }

  /** Face-letter facelets -> cubie, or null when they are not a valid cube. */
  function toCubie(labels) {
    const c = { cp: [], co: [], ep: [], eo: [] };
    for (let i = 0; i < 8; i++) {
      const f = CORNER_FACELETS[i];
      let ori = 0;
      while (ori < 3 && labels[f[ori]] !== 'U' && labels[f[ori]] !== 'D') ori++;
      if (ori === 3) return null;
      const c1 = labels[f[(ori + 1) % 3]], c2 = labels[f[(ori + 2) % 3]];
      const j = CORNER_COLORS.findIndex(k => k[0] === labels[f[ori]] && k[1] === c1 && k[2] === c2);
      if (j < 0) return null;
      c.cp.push(j); c.co.push(ori);
    }
    for (let i = 0; i < 12; i++) {
      const f = EDGE_FACELETS[i];
      const a = labels[f[0]], b = labels[f[1]];
      let j = EDGE_COLORS.findIndex(k => k[0] === a && k[1] === b);
      if (j >= 0) { c.ep.push(j); c.eo.push(0); continue; }
      j = EDGE_COLORS.findIndex(k => k[0] === b && k[1] === a);
      if (j < 0) return null;
      c.ep.push(j); c.eo.push(1);
    }
    if (new Set(c.cp).size !== 8 || new Set(c.ep).size !== 12) return null;
    return c;
  }

  /** Cubie -> face-letter facelets (centres in place). */
  function fromCubie(c) {
    const out = SOLVED_LABELS.split('');
    for (let i = 0; i < 8; i++) {
      const f = CORNER_FACELETS[i], col = CORNER_COLORS[c.cp[i]];
      for (let k = 0; k < 3; k++) out[f[(c.co[i] + k) % 3]] = col[k];
    }
    for (let i = 0; i < 12; i++) {
      const f = EDGE_FACELETS[i], col = EDGE_COLORS[c.ep[i]];
      out[f[c.eo[i]]] = col[0]; out[f[1 - c.eo[i]]] = col[1];
    }
    return out.join('');
  }

  const identity = () => ({ cp: [0, 1, 2, 3, 4, 5, 6, 7], co: [0, 0, 0, 0, 0, 0, 0, 0], ep: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], eo: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  /** a, then b. */
  function mul(a, b) {
    const c = { cp: [], co: [], ep: [], eo: [] };
    for (let i = 0; i < 8; i++) { c.cp.push(a.cp[b.cp[i]]); c.co.push((a.co[b.cp[i]] + b.co[i]) % 3); }
    for (let i = 0; i < 12; i++) { c.ep.push(a.ep[b.ep[i]]); c.eo.push((a.eo[b.ep[i]] + b.eo[i]) % 2); }
    return c;
  }
  const sameCubie = (a, b) => a.cp.every((v, i) => v === b.cp[i]) && a.co.every((v, i) => v === b.co[i]) && a.ep.every((v, i) => v === b.ep[i]) && a.eo.every((v, i) => v === b.eo[i]);

  /** The state an alg leaves a solved cube in, seen from its centres (any notation applyAlgorithm reads). */
  function algCubie(alg, from = SOLVED_FACELETS) {
    return toCubie(labelsOf(applyAlgorithm(from, alg || '')));
  }
  /** The cubie of a cube given as facelets (any colours). */
  const faceletCubie = facelets => toCubie(labelsOf(facelets));

  let UPOW = null; // U^0..U^3
  function uPowers() {
    if (!UPOW) UPOW = ['', 'U', 'U2', "U'"].map(a => algCubie(a));
    return UPOW;
  }

  // ---- what each set looks at -------------------------------------------------
  const f2lSolved = c => [4, 5, 6, 7].every(i => c.cp[i] === i && c.co[i] === 0) && [4, 5, 6, 7, 8, 9, 10, 11].every(i => c.ep[i] === i && c.eo[i] === 0);
  // the last slot is FR: everything else of the F2L solved, its pair in the U layer or the slot
  const lsReady = c => [5, 6, 7].every(i => c.cp[i] === i && c.co[i] === 0) && [4, 5, 6, 7, 9, 10, 11].every(i => c.ep[i] === i && c.eo[i] === 0);
  const pairSolved = c => c.cp[4] === 4 && c.co[4] === 0 && c.ep[8] === 8 && c.eo[8] === 0;
  const llOriented = c => [0, 1, 2, 3].every(i => c.co[i] === 0 && c.eo[i] === 0);
  const llEO = c => [0, 1, 2, 3].every(i => c.eo[i] === 0);
  const cornersOriented = c => [0, 1, 2, 3].every(i => c.co[i] === 0);
  const LS_CORNERS = [0, 1, 2, 3, 4], LS_EDGES = [0, 1, 2, 3, 8];
  const lsKey = (c, twists) => LS_CORNERS.map(p => (c.cp[p] === 4 ? `C${c.co[p]}` : twists ? `c${c.co[p]}` : 'c')).join('')
    + '|' + LS_EDGES.map(p => (c.ep[p] === 8 ? `E${c.eo[p]}` : `e${c.eo[p]}`)).join('');

  /**
   * The sets. `goal` is llgen.cpp's goal (0 LL solved, 1 LL oriented, 2 LL
   * corners solved + edges oriented, 3 LL edges oriented; F2L solved in all),
   * `accepts` the states the set's cases come from, `key` what it looks at.
   */
  const SETS = [
    { id: 'oll', name: 'OLL', title: 'Orientation of the last layer', goal: 1,
      accepts: c => f2lSolved(c),
      key: c => c.co.slice(0, 4).join('') + '|' + c.eo.slice(0, 4).join('') },
    { id: 'pll', name: 'PLL', title: 'Permutation of the last layer', goal: 0,
      accepts: c => f2lSolved(c) && llOriented(c),
      key: c => c.cp.slice(0, 4).join('') + '|' + c.ep.slice(0, 4).join('') },
    // COLL on every OLL (developer, 2026-10-14: "doing corners while solving
    // any of the 57 OLLs"; also called OLLCP): orients the last layer and
    // solves its corners. Corners oriented with the edges oriented is a PLL
    // case, not a COLL one.
    { id: 'coll', name: 'COLL', title: 'The OLL and the corners at once', goal: 2,
      accepts: c => f2lSolved(c) && !(llEO(c) && cornersOriented(c)),
      key: c => c.co.slice(0, 4).join('') + '|' + c.eo.slice(0, 4).join('') + '|' + c.cp.slice(0, 4).join('') },
    { id: 'zbll', name: 'ZBLL', title: 'The whole last layer, edges oriented', goal: 0,
      accepts: c => f2lSolved(c) && llEO(c) && !cornersOriented(c),
      key: c => c.cp.slice(0, 4).join('') + '|' + c.co.slice(0, 4).join('') + '|' + c.ep.slice(0, 4).join('') },
    // 1LLL: the whole last layer in one alg, from any state (developer, 2026-10-14)
    { id: '1lll', name: '1LLL', title: 'The whole last layer in one alg', goal: 0,
      accepts: c => f2lSolved(c),
      key: c => c.cp.slice(0, 4).join('') + '|' + c.co.slice(0, 4).join('') + '|' + c.ep.slice(0, 4).join('') + '|' + c.eo.slice(0, 4).join('') },
    // (a solved pair is an OLL case, not an OLS one)
    { id: 'ols', name: 'OLS', title: 'Last slot + orientation', goal: 1, slot: true,
      accepts: c => lsReady(c) && !pairSolved(c),
      key: c => lsKey(c, true) },
    // (a solved pair with only edges to flip is not a ZBLS case: 302 cases)
    { id: 'zbls', name: 'ZBLS', title: 'Last slot + edge orientation', goal: 3, slot: true,
      accepts: c => lsReady(c) && !pairSolved(c),
      key: c => lsKey(c, false) },
  ];
  const SET_BY_ID = Object.fromEntries(SETS.map(s => [s.id, s]));

  // ---- enumeration ------------------------------------------------------------
  const PERMS4 = (() => {
    const out = [];
    const rec = (p, rest) => { if (!rest.length) out.push(p); else rest.forEach((x, i) => rec([...p, x], rest.filter((_, j) => j !== i))); };
    rec([], [0, 1, 2, 3]);
    return out;
  })();
  const parity = p => { let s = 0; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[j] < p[i]) s ^= 1; return s; };
  const TWISTS = []; // 27 twist patterns of four corners (sum 0 mod 3)
  for (let t = 0; t < 27; t++) { const a = [t % 3, ((t / 3) | 0) % 3, ((t / 9) | 0) % 3]; TWISTS.push([...a, (6 - a[0] - a[1] - a[2]) % 3]); }
  const FLIPS = []; // 8 flip patterns of four edges (even)
  for (let t = 0; t < 8; t++) { const a = [t & 1, (t >> 1) & 1, (t >> 2) & 1]; FLIPS.push([...a, (a[0] + a[1] + a[2]) % 2]); }

  function llState(cp, co, ep, eo) {
    const c = identity();
    for (let i = 0; i < 4; i++) { c.cp[i] = cp[i]; c.co[i] = co[i]; c.ep[i] = ep[i]; c.eo[i] = eo[i]; }
    return c;
  }
  function* llStates() {
    for (const cp of PERMS4) for (const co of TWISTS) for (const ep of PERMS4) {
      if (parity(cp) !== parity(ep)) continue;
      for (const eo of FLIPS) yield llState(cp, co, ep, eo);
    }
  }
  // ZBLS: the FR pair anywhere in the U layer or its slot, every LL edge flip
  function* zblsStates() {
    for (const pc of LS_CORNERS) for (let tw = 0; tw < 3; tw++) for (const pe of LS_EDGES) for (let fl = 0; fl < 2; fl++) {
      for (let f = 0; f < 16; f++) {
        const flips = [f & 1, (f >> 1) & 1, (f >> 2) & 1, (f >> 3) & 1];
        if ((flips.reduce((a, b) => a + b, 0) + fl) % 2) continue;
        const c = identity();
        const cs = LS_CORNERS.filter(p => p !== pc), es = LS_EDGES.filter(p => p !== pe);
        c.cp[pc] = 4; c.co[pc] = tw;
        cs.forEach((p, k) => { c.cp[p] = k; c.co[p] = 0; });
        c.co[cs[0]] = (3 - tw) % 3;
        c.ep[pe] = 8; c.eo[pe] = fl;
        es.forEach((p, k) => { c.ep[p] = k; c.eo[p] = flips[k]; });
        if (parity(c.cp) !== parity(c.ep)) { const t = c.ep[es[0]]; c.ep[es[0]] = c.ep[es[1]]; c.ep[es[1]] = t; }
        yield c;
      }
    }
  }
  // OLS: the last pair and the orientation of the last layer at once, for
  // every placement of the pair (developer, 2026-10-13: "full OLS"). VLS (the
  // pair connected, ready for R U' R') and HLS (split, ready for R U R') come
  // first, as before; their edge-oriented cases are WV and SV.
  const OLS_INSERTS = [{ group: 'VLS', insert: "R U' R'" }, { group: 'HLS', insert: "R U R'" }];
  function* olsStates() {
    for (const { group, insert } of OLS_INSERTS) {
      const setup = algCubie(invertAlg(insert));
      for (const co of TWISTS) for (const eo of FLIPS) {
        const c = mul(llState([0, 1, 2, 3], co, [0, 1, 2, 3], eo), setup);
        c.group = group;
        yield c;
      }
    }
    for (const c of zblsStates()) {
      // every twist of the four LL corners on top of each ZBLS placement and flip
      for (const tw of TWISTS) {
        const s = { cp: c.cp.slice(), co: c.co.slice(), ep: c.ep.slice(), eo: c.eo.slice() };
        const ll = LS_CORNERS.filter(p => s.cp[p] !== 4);
        ll.forEach((p, k) => { s.co[p] = tw[k]; });
        // the corner twists sum to 0 mod 3 (the pair corner's twist counts)
        const sum = s.co.reduce((a, b) => a + b, 0) % 3;
        s.co[ll[3]] = (s.co[ll[3]] + 3 - sum) % 3;
        yield s;
      }
    }
  }

  // The OLS subsets a case belongs to, from its pair placement (any pre-AUF)
  // and, for WV and SV, the LL edges oriented once the pair goes in.
  let LS_SUBSETS = null;
  function lsSubsetTables() {
    if (LS_SUBSETS) return LS_SUBSETS;
    const place = c => { const pc = c.cp.indexOf(4), pe = c.ep.indexOf(8); return `${pc}/${c.co[pc]} ${pe}/${c.eo[pe]}`; };
    LS_SUBSETS = [
      { id: 'vls', edges: 'wv', insert: algCubie("R U' R'"), place: place(algCubie("R U R'")) },
      { id: 'hls', edges: 'sv', insert: algCubie("R U R'"), place: place(algCubie("R U' R'")) },
    ].map(s => ({ ...s, placeOf: place }));
    return LS_SUBSETS;
  }
  /** ['vls', 'wv'], ['hls'], ... : the named OLS subsets a last-slot state is in ([] for the rest of OLS). */
  function olsSubsets(c) {
    const out = [];
    for (const s of lsSubsetTables()) {
      for (const u of uPowers()) {
        const v = mul(c, u);
        if (s.placeOf(v) !== s.place) continue;
        out.push(s.id);
        if (llEO(mul(v, s.insert))) out.push(s.edges);
        break;
      }
    }
    return out;
  }
  function invertAlg(alg) {
    return String(alg).trim().split(/\s+/).filter(Boolean).reverse()
      .map(t => (t.endsWith('2') ? t : t.endsWith("'") ? t.slice(0, -1) : `${t}'`)).join(' ');
  }

  /** The 16 (pre-AUF a, post-AUF b) variants of a state: U^b, then the state, then U^a. */
  function aufVariants(c) {
    const U = uPowers();
    const out = [];
    for (let b = 0; b < 4; b++) for (let a = 0; a < 4; a++) out.push({ a, b, c: mul(mul(U[b], c), U[a]) });
    return out;
  }

  /**
   * Every case of a set: [{ key, rep (cubie), members: Map key -> { a, b } }],
   * the solved class (nothing to do) left out. `a`, `b`: the state with that
   * key is U^b, then the representative, then U^a.
   */
  function enumerateCases(setId) {
    const set = SET_BY_ID[setId];
    const states = setId === 'zbls' ? zblsStates() : setId === 'ols' ? olsStates() : llStates();
    const solvedKeys = new Set(aufVariants(identity()).map(v => set.key(v.c)));
    const seen = new Set();
    const cases = [];
    for (const s of states) {
      if (!set.accepts(s)) continue;
      const k0 = set.key(s);
      if (seen.has(k0) || solvedKeys.has(k0)) continue;
      const members = new Map();
      for (const v of aufVariants(s)) {
        if (!set.accepts(v.c)) continue;
        const k = set.key(v.c);
        if (!members.has(k)) members.set(k, { a: v.a, b: v.b });
        seen.add(k);
      }
      cases.push({ key: k0, rep: s, members, group: s.group || '' });
    }
    return cases;
  }

  /** The class key of a state in a set (null: not one of the set's states). */
  function caseKeyOf(setId, state) {
    const set = SET_BY_ID[setId];
    if (!state || !set.accepts(state)) return null;
    return set.key(state);
  }

  /** Is the state solved as far as a goal asks (llgen.cpp's goals; up to a U turn)? */
  function reachesGoal(goal, c) {
    if (!c || !f2lSolved(c)) return false;
    if (goal === 1) return llOriented(c);
    if (goal === 3) return llEO(c);
    const U = uPowers();
    if (goal === 2) return llEO(c) && U.some(u => [0, 1, 2, 3].every(i => c.cp[i] === u.cp[i] && c.co[i] === 0));
    return U.some(u => sameCubie(c, u));
  }

  /** Does `alg` take the cube `state` (a cubie) to the set's goal? Replayed on the facelet cube. */
  function solves(setId, state, alg) {
    let after;
    try { after = algCubie(alg, fromCubie(state)); } catch (e) { return false; }
    return reachesGoal(SET_BY_ID[setId].goal, after);
  }

  /** Database notation -> facelet-cube.js tokens: no brackets, Rw -> r, R3 -> R'. */
  function normalizeAlg(text) {
    return String(text).replace(/[()\[\]]/g, ' ').trim().split(/\s+/).filter(Boolean).map((t) => {
      let m = t.match(/^([URFDLB])w(.*)$/);
      if (m) t = m[1].toLowerCase() + m[2];
      m = t.match(/^([A-Za-z])3('?)$/);
      if (m) t = m[1] + (m[2] ? '' : "'");
      if (/^[A-Za-z]2'$/.test(t)) t = t.slice(0, 2);
      return t;
    }).join(' ');
  }

  // ---- what a case diagram shows ----------------------------------------------
  // per set: show the last layer's pieces in full ('full'), only their U
  // stickers ('top'), or not at all ('none'); corners, edges
  // ('pair': only the last pair shows, for a picture of the pair's placement)
  const MASKS = { '1lll': ['full', 'full'], oll: ['top', 'top'], ols: ['top', 'top'], zbls: ['none', 'top'], coll: ['full', 'top'], pll: ['full', 'full'], zbll: ['full', 'full'], pair: ['none', 'none'] };
  /**
   * The facelets of a case as its set sees them: face letters, '.' where a
   * sticker does not matter (an LL piece's side the set ignores).
   */
  function maskedLabels(setId, c) {
    const [cm, em] = MASKS[setId] || ['full', 'full'];
    const out = SOLVED_LABELS.split('');
    const show = (mode, k) => mode === 'full' || (mode === 'top' && k === 0);
    for (let i = 0; i < 8; i++) {
      const p = c.cp[i], f = CORNER_FACELETS[i];
      for (let k = 0; k < 3; k++) out[f[(c.co[i] + k) % 3]] = p > 3 || show(cm, k) ? CORNER_COLORS[p][k] : '.';
    }
    for (let i = 0; i < 12; i++) {
      const p = c.ep[i], f = EDGE_FACELETS[i];
      for (let k = 0; k < 2; k++) out[f[(c.eo[i] + k) % 2]] = p > 3 || show(em, k) ? EDGE_COLORS[p][k] : '.';
    }
    return out.join('');
  }

  // ---- mirror (left <-> right, through the M slice) -----------------------------
  // The facelet reflection is read off the position names (a sticker on face
  // X of a piece goes to face X', R and L swapped, of the piece whose faces
  // are the swapped set); the stickers' R and L swap too, so the result is a
  // cube of the usual colour scheme. Each token's mirror is then FOUND on the
  // facelet cube (the token whose result equals the mirrored result), so no
  // turn direction is assumed; test/alg-sets.test.js checks random algs.
  const SWAP_RL = { R: 'L', L: 'R' };
  let MIRROR = null;
  function mirrorTables() {
    if (MIRROR) return MIRROR;
    const swapName = n => [...n].map(c => SWAP_RL[c] || c);
    const perm = new Array(54);
    const mapPieces = (FACELETS, NAMES) => FACELETS.forEach((f, i) => {
      const want = swapName(NAMES[i]);
      const j = NAMES.findIndex(n => n.length === want.length && [...n].every(c => want.includes(c)));
      f.forEach((x, k) => { perm[x] = FACELETS[j][NAMES[j].indexOf(want[k])]; });
    });
    mapPieces(CORNER_FACELETS, CORNER_NAMES);
    mapPieces(EDGE_FACELETS, EDGE_NAMES);
    ['U', 'R', 'F', 'D', 'L', 'B'].forEach((f, k) => { perm[9 * k + 4] = 9 * 'URFDLB'.indexOf(SWAP_RL[f] || f) + 4; });
    const mirrorLabels = (labels) => {
      const out = new Array(54);
      for (let i = 0; i < 54; i++) out[perm[i]] = SWAP_RL[labels[i]] || labels[i];
      return out.join('');
    };
    const tok = new Map();
    const all = [...'URFDLBurfdlbMESxyz'].flatMap(f => [f, `${f}'`, `${f}2`]);
    const result = t => applyAlgorithm(SOLVED_LABELS, t);
    for (const t of all) {
      const want = mirrorLabels(result(t));
      const m = all.find(u => result(u) === want);
      if (!m) throw new Error(`alg-sets: no mirror for ${t}`);
      tok.set(t, m);
    }
    MIRROR = { perm, mirrorLabels, tok };
    return MIRROR;
  }
  /** The mirror image of a cube given as face letters (a valid cube again). */
  const mirrorLabels = labels => mirrorTables().mirrorLabels(labels);
  /** The mirror image of an alg, token by token. */
  const mirrorAlg = alg => String(alg).trim().split(/\s+/).filter(Boolean).map((t) => {
    const n = t.length > 2 && t.endsWith("2'") ? t.slice(0, -1) : t;
    const m = mirrorTables().tok.get(n);
    if (!m) throw new Error(`alg-sets: cannot mirror ${t}`);
    return m;
  }).join(' ');

  /** A case's full name, lowercase: "oll 27", "pll t", "zbll t 12", "vls 83", "zbls f2l 5". */
  function caseTitle(setName, caseName) {
    const n = String(caseName), set = String(setName);
    const own = n.toLowerCase().startsWith(`${set.toLowerCase()} `) || /^(WV|VLS|SV|HLS) /.test(n);
    return (own ? n : `${set} ${n}`).toLowerCase();
  }

  // ---- recognition --------------------------------------------------------------
  const AUF = ['', 'U', 'U2', "U'"];
  /**
   * Index of a set's data (data/ll/<set>.json): class key -> { i, a, b } for
   * every AUF variant of every case (U^b, then case i's state, then U^a).
   */
  function indexSet(setId, data) {
    const set = SET_BY_ID[setId];
    const map = new Map();
    data.cases.forEach((c, i) => {
      const st = toCubie(c.state);
      for (const v of aufVariants(st)) {
        if (!set.accepts(v.c)) continue;
        const k = set.key(v.c);
        if (!map.has(k)) map.set(k, { i, a: v.a, b: v.b });
      }
    });
    return map;
  }
  /** The case of an indexed set a state is in ({ i, a, b }), or null. */
  function recognize(setId, index, state) {
    const k = caseKeyOf(setId, state);
    return k === null ? null : index.get(k) || null;
  }
  /**
   * A stored alg ({ alg, pre, post }) written for a state recognised as
   * { a, b }: its pre-AUF, the moves, its post-AUF (only sets that solve the
   * whole layer have one).
   */
  function algFor(stored, hit, setId) {
    const pre = AUF[(stored.pre - hit.a + 8) % 4];
    const post = SET_BY_ID[setId].goal === 0 ? AUF[(stored.post - hit.b + 8) % 4] : '';
    return { pre, alg: stored.alg, post, text: [pre, stored.alg, post].filter(Boolean).join(' ') };
  }

  /**
   * How fast an alg is to execute: the solver's own step ranking, the same
   * formula as a step's (script.js: MCC alg speed + move penalties +
   * naturalness) without the AUFs, with its constants fitted for the last
   * layer: the naturalness model is one trained on the community's last-layer
   * algs (`model`; tools/ll-build.js builds it leaving out the case being
   * ranked), the move penalties are LL_PENALTIES, and each left-hand turn
   * costs LL_LEFT (MCC prices both hands alike; mirror algs are slower for
   * most solvers). Without a model the naturalness term is left out (the
   * solving screen then compares on both sides without it).
   *
   * Fitted on SpeedCubeDB's votes (tools/ll-build.js eval; two folds of
   * cases; agreement on clearly ordered pairs / the top-voted alg first):
   * MCC alone 63.0% / 40.4%; the F2L step ranking 68.8 / 48.7; with the
   * last-layer naturalness model 77.2 / 61.0; these constants 79.4 / 63.4
   * (folds 80.0 / 65.6 and 78.7 / 61.0; each fold's own fit agreed on no
   * wide r/l penalty, D about 2 and naturalness 1.25-1.5). The F2L model had
   * priced slice PLLs far down (M is rare in F2L); on pairs of a slice alg
   * and a face-turn alg the votes still favour the face turns.
   */
  const LL_LEFT = 2.5;
  const LL_NATURAL = 1.25;
  // Each set has its own constants (developer, 2026-10-13: separate
  // rankings for everything in the last layer), fitted on what professionals
  // execute (tools/ll-tune.js; data/ll/pro_ll.json): `mcc` (script.js's
  // ALG_SPEED_DEFAULTS' shape), `pen` (move penalties), `left` (per left-hand
  // turn), `natural` (per bit of last-layer surprise). Sets without fitted
  // values use the vote-fitted ones above.
  // PLL: slices cost 0.5 instead of 3.5 (tools/ll-tune.js: Yiheng Wang's
  // PLLs 2.121 -> 2.075 mean log2 rank, the community's votes 62.8 -> 63.8%;
  // he turns the M-slice H and Z perms). Full refits of a set's constants
  // did worse on held-out cases (OLL 0.825 -> 0.847, PLL 2.121 -> 2.459).
  // OLL and PLL: half the cost per turn (`move` 0.5; below): on these sets'
  // own pros it beats 1 (Yiheng's PLLs: mean log2 rank 1.910 -> 1.855, first
  // 30.9% -> 43.5%; his OLLs 0.870 -> 0.845) and keeps the short picks the
  // developer asked for (H the M-slice perm, OLL 25 in 8 moves); the U perms
  // go back to the RU algs he turns.
  const LL_FITTED = { pll: { pen: { wideOther: 0.5 }, move: 0.5 }, oll: { move: 0.5 } };
  let LL_BASE = null;
  /** The ranking constants of a set ({ mcc, pen, left, natural }). */
  function llParams(setId) {
    if (!LL_BASE) {
      LL_BASE = {
        mcc: { ...ALG_SPEED_DEFAULTS },
        pen: { ...STEP_PENALTIES, D: 1.75, F: 2.25, B: 3.5, wideRL: 0, wideUDFB: 3.5, wideOther: 3.5, natural: 0 },
        left: LL_LEFT, natural: LL_NATURAL, lead: LL_LEAD_ROTATION, move: LL_PER_MOVE,
      };
    }
    const f = LL_FITTED[setId];
    if (!f) return LL_BASE;
    return { mcc: { ...LL_BASE.mcc, ...f.mcc }, pen: { ...LL_BASE.pen, ...f.pen }, left: f.left ?? LL_BASE.left, natural: f.natural ?? LL_BASE.natural, lead: f.lead ?? LL_BASE.lead, move: f.move ?? LL_BASE.move };
  }
  // Rotations around an alg (developer, 2026-10-14: the A perms' "x ... x'"
  // are executed like regrips). An alg wrapped in a rotation and its inverse
  // ("x ... x'", "x' ... x") takes the first while the hands settle on the
  // cube: it costs `lead` (a regrip), not a rotation. A rotation an alg ends
  // with is free where the alg finishes the cube (PLL, ZBLL, 1LLL: the timer
  // stops first). Any other rotation keeps its full price: a lone leading
  // rotation ("x R2 F R F' ...", a Ja perm) ranked above the professionals'
  // rotationless algs when it was cheap (tools/ll-tune.js; first-ranked pro
  // PLLs 42.1% -> 36.2%). Only the community's algs carry rotations (the
  // generator turns no rotations).
  const LL_LEAD_ROTATION = 1.5;
  // Every turn costs `move` on top (developer, 2026-10-14: the first algs
  // leaned "blue collar" -- 17-move ZBLLs, a 15-move RU OLL 25 -- where top
  // solvers turn shorter, odder algs). Checked on every professional's steps
  // on reco.nz (tools/ll-tune.js; mean log2 rank of the pro's alg, 2-fold CV
  // over cases): PLL 2.530 -> 2.383, ZBLL 1.370 -> 1.330, ZBLS 2.018 ->
  // 1.905, OLL unchanged (1.233 -> 1.231); the votes agree a little more
  // (ZBLL 80.2 -> 80.9%, PLL 68.1 -> 70.2%). 1 is the low end of what each
  // fold chose (0.5-3); a lower slice penalty did not help anywhere. OLL and
  // PLL use 0.5 (LL_FITTED).
  const LL_PER_MOVE = 1;
  const invRot = t => (t.endsWith('2') ? t : t.endsWith("'") ? t.slice(0, -1) : `${t}'`);
  function rotationFrame(body, setId = null) {
    const toks = String(body).split(' ').filter(Boolean);
    const isRot = t => /^[xyz]/.test(t);
    let lead = 0;
    if (toks.length > 2 && isRot(toks[0]) && !isRot(toks[1]) && toks[toks.length - 1] === invRot(toks[0])) {
      toks.shift();
      toks.pop();
      lead = 1;
    }
    if (setId && SET_BY_ID[setId] && SET_BY_ID[setId].goal === 0) while (toks.length > 1 && isRot(toks[toks.length - 1])) toks.pop();
    return { body: toks.join(' '), lead };
  }
  const MCC_ORDER = ['wristMult', 'pushMult', 'ringMult', 'destabilize', 'addRegrip', 'double', 'sesliceMult', 'overWorkMult', 'moveblock', 'rotation'];
  function llScore(body0, model = null, setId = null) {
    const P = llParams(setId);
    const { body, lead } = rotationFrame(body0, setId);
    let left = 0, turns = 0;
    for (const t of String(body).split(' ')) {
      if (t[0] === 'L' || t[0] === 'l') left++;
      if (t && !/^[xyz]/.test(t)) turns++;
    }
    let s = algSpeed(body, false, true, ...MCC_ORDER.map(k => P.mcc[k])) + stepPenalty(body, P.pen) + P.left * left + P.lead * lead + P.move * turns;
    if (model) s += P.natural * model.surprise(body);
    return s;
  }

  // ---- awkward algs (developer, 2026-10-13) --------------------------------------
  // An alg is awkward when it uses an unusual move type (B, a wide f/b/u/d,
  // S, E), rotates twice, or turns slowly for its length: MCC time per turn
  // above the 95th percentile of the community's top-voted algs (1.95; the
  // move penalties are left out, so a slice alg is not awkward for being one).
  // Awkward algs are hidden in a case whose community favourite is not
  // awkward itself. Algs awkward beyond doubt -- three unusual moves, or
  // above 3.0 per turn (the 99th percentile is 2.4) -- are left out of the
  // data unless they are the case's favourite (tools/ll-build.js): a 21-move
  // "l b d' ... S M r u E" T perm with 34 joke votes, for one.
  const AWK_FLOW = 1.95, AWK_DROP_FLOW = 3.0;
  function awkwardness(body0, setId = null) {
    // a wrapping rotation pair counts as a regrip, a final one in a set that
    // finishes the cube as nothing (rotationFrame)
    const body = rotationFrame(body0, setId).body;
    const toks = String(body).split(' ').filter(Boolean);
    const turns = toks.filter(t => !/^[xyz]/.test(t)).length || 1;
    const odd = toks.filter(t => /^[BbfudSE]/.test(t)).length;
    const rotations = toks.filter(t => /^[xyz]/.test(t)).length;
    const flow = algSpeed(body, false, true) / turns;
    return { flow, odd, rotations, awkward: flow > AWK_FLOW || odd > 0 || rotations >= 2, drop: flow > AWK_DROP_FLOW || odd >= 3 };
  }

  return {
    awkwardness, AWK_FLOW, AWK_DROP_FLOW,
    DATA_VERSION, dataUrl, llScore, llParams, rotationFrame, LL_FITTED, LL_LEFT, LL_NATURAL, caseTitle, mirrorLabels, mirrorAlg, indexSet, recognize, algFor, AUF, maskedLabels, MASKS,
    CORNER_FACELETS, EDGE_FACELETS, CORNER_NAMES, EDGE_NAMES, SOLVED_LABELS,
    labelsOf, toCubie, fromCubie, identity, mul, sameCubie, algCubie, faceletCubie, uPowers,
    SETS, SET_BY_ID, enumerateCases, aufVariants, caseKeyOf, invertAlg, reachesGoal, solves, normalizeAlg,
    f2lSolved, lsReady, llOriented, llEO, cornersOriented, PERMS4, TWISTS, FLIPS, llState, olsSubsets, pairSolved,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AlgSets };
}
