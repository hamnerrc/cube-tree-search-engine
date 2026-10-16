/**
 * The browser-side multi-step DAG traversal loop.
 */
'use strict';

const SLOT_INDICES = { BL: 0, BR: 1, FR: 2, FL: 3 };

// spelling-search.js: a page global; Node scripts get it here.
const SPELLING = typeof SpellingSearch !== 'undefined' ? SpellingSearch
  : (typeof require === 'function' ? require('./spelling-search.js').SpellingSearch : null);

const COLOR_ROTATIONS = {
  white: 'z2',
  yellow: '',
  green: "x'",
  blue: 'x',
  red: 'z',
  orange: "z'",
};

const MOVE_RESTRICT = 'U_U2_U-_D_D2_D-_L_L2_L-_R_R2_R-_F_F2_F-_B_B2_B-';

const PRO_MOVE_RESTRICT = `${MOVE_RESTRICT}_r_r2_r-_l_l2_l-_y_y-_x_x-`;
const ENGINE_CENTER_OFFSETS = ['', 'y', 'y2', "y'", 'z2', 'z2 y', 'z2 y2', "z2 y'", "z'", "z' y", "z' y2", "z' y'",
  'z', 'z y', 'z y2', "z y'", "x'", "x' y", "x' y2", "x' y'", 'x', 'x y', 'x y2', "x y'"];
// A first step never rotates inside its alg, so root calls get no y/x.
const PRO_MOVE_RESTRICT_ROOT = PRO_MOVE_RESTRICT.split('_').filter(m => !/^[xyz]/.test(m)).join('_');
function proEngineOptions(rotation, isRoot = false) {
  const down = applyAlgorithm(SOLVED_FACELETS, rotation || '')[31];
  const centerOffset = ENGINE_CENTER_OFFSETS.filter(o =>
    applyAlgorithm(SOLVED_FACELETS, [rotation, o].filter(Boolean).join(' '))[31] === down);
  return { allowedMoves: isRoot ? PRO_MOVE_RESTRICT_ROOT : PRO_MOVE_RESTRICT, maxRotCount: isRoot ? 0 : 1, centerOffset };
}

function nodeByLabels(session, corners, edges) {
  const key = JSON.stringify([corners.slice().sort(), edges.slice().sort()]);
  // First matching cross-solved node, indexed once per tree.
  let index = nodeByLabelsIndex.get(session.tree);
  if (!index) {
    index = new Map();
    for (const n of session.tree.nodes) {
      if (!n.state.cross_solved) continue;
      const k = JSON.stringify([(n.state.corners || []).slice().sort(), (n.state.edges || []).slice().sort()]);
      if (!index.has(k)) index.set(k, n.id);
    }
    nodeByLabelsIndex.set(session.tree, index);
  }
  return index.has(key) ? index.get(key) : null;
}
const nodeByLabelsIndex = typeof WeakMap !== 'undefined' ? new WeakMap() : new Map();

const NOOP_MOVES = "U U2 U'";

const POSTALG_BOUNDARY = 'y2 y2';

// Solutions requested per pseudo engine call, and per matched call when the
// complete search is off (SolveSession.completeSearch false: tools only).
const DEFAULT_MAX_SOLUTIONS = 10000;

const COMPLETE_ENGINE_CAP = 3000000;
const DEFAULT_TOP_N = 300;
// A later step whose goal has no solution within its limit is searched up
// to this many moves deeper (its shortest solutions only).
const LATER_DEEPEN = 3;
// Filters that hide results; the best N are kept for each, so a filter can't
// empty the list.
const RESULT_VIEWS = [
  { test: () => true, wide: true },
  { test: c => !isWideAlg(c.coreAlg), wide: false },
  { test: c => !c.unorthodox, wide: true },
  { test: c => !c.unorthodox && !isWideAlg(c.coreAlg), wide: false },
];

const YIELD_INTERVAL_MS = 48;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
async function yieldIfDue(state) {
  if (now() - state.lastYield < YIELD_INTERVAL_MS) return;
  await new Promise(resolve => setTimeout(resolve, 0));
  state.lastYield = now();
}

// Distance-1 (first step) move limits, keyed by pair count: cross 9, xcross 10,
// xxcross 10, xxxcross 11.
const DISTANCE1_LIMITS = { 0: 9, 1: 10, 2: 10, 3: 11 };

const LATER_LIMITS_BY_TOTAL = { 1: 10, 2: 12, 3: 14, 4: 16 };
const LATER_LIMITS = { 1: 10, 2: 12, 3: 12 };

function categoryFor(pairCount, isRoot) {
  if (isRoot) return ['cross', 'xcross', 'xxcross', 'xxxcross'][pairCount] || 'xxxcross';
  return pairCount === 1 ? 'singlePair' : 'multislot';
}

function categoryKeyFor(pairCount, isRoot, isPseudo) {
  const base = categoryFor(pairCount, isRoot);
  return isPseudo ? `${base}Pseudo` : base;
}

function searchLimitFor(pairCount, isRoot, totalPairsInGoal, searchConfig, isPseudo) {
  const override = searchConfig && searchConfig[categoryKeyFor(pairCount, isRoot, isPseudo)];
  if (override && override.maxLength) return override.maxLength;
  if (isRoot) return DISTANCE1_LIMITS[pairCount];
  return isPseudo ? LATER_LIMITS_BY_TOTAL[totalPairsInGoal] : LATER_LIMITS[pairCount];
}

function maxSolutionsFor(pairCount, isRoot, searchConfig, isPseudo, fallback) {
  const override = searchConfig && searchConfig[categoryKeyFor(pairCount, isRoot, isPseudo)];
  return (override && override.maxSolutions) || fallback;
}

const CORNER_CYCLE = ['FR', 'FL', 'BL', 'BR'];
const ROTATION_STEPS = { '': 0, y: 1, y2: 2, "y'": 3 };

function relabelSlotsForRotation(slots, yToken) {
  const steps = ROTATION_STEPS[yToken] ?? 0;
  if (!steps) return slots;
  return slots.map(slot => {
    const idx = CORNER_CYCLE.indexOf(slot);
    return idx === -1 ? slot : CORNER_CYCLE[(idx + steps) % 4];
  });
}

const ROTATION_TOKEN_RE = /^(x2|y2|z2|x'|y'|z'|x|y|z)(?=\s|$)/;

function stripLeadingRotation(alg) {
  const m = alg.match(ROTATION_TOKEN_RE);
  if (!m) return { token: '', rest: alg.trim() };
  return { token: m[1], rest: alg.slice(m[0].length).trim() };
}

function composeRotations(a, b) {
  return [a, b].filter(Boolean).join(' ');
}

const F2L_SLOTS = ['BL', 'BR', 'FR', 'FL'];

const REPLAY_PREFIX_LIMIT = 256;
const replayPrefixCache = new Map();
function replayFacelets(scramble, rotation, priorPath, coreAlg) {
  // Facelet-cube.js replays wide/slice moves natively, so the committed text is
  // replayed exactly as a human reads it.
  const prefix = `${scramble}|${rotation}|${priorPath}`;
  let start = replayPrefixCache.get(prefix);
  if (start === undefined) {
    start = applyAlgorithm(SOLVED_FACELETS, [scramble, rotation, priorPath].filter(Boolean).join(' '));
    if (replayPrefixCache.size >= REPLAY_PREFIX_LIMIT) replayPrefixCache.delete(replayPrefixCache.keys().next().value);
    replayPrefixCache.set(prefix, start);
  }
  return coreAlg ? applyAlgorithm(start, coreAlg) : start;
}

function checkCandidateAgainstRealCubeState(scramble, rotation, priorPath, coreAlg, claimedCorners, claimedEdges, claimSets = null) {
  return checkFacelets(replayFacelets(scramble, rotation, priorPath, coreAlg), claimedCorners, claimedEdges, claimSets);
}

function checkFacelets(facelets, claimedCorners, claimedEdges, claimSets = null) {
  const actual = solvedFlags(facelets);
  // (claimSets: the same claim as Sets, for a caller checking many algs)
  const corners = claimSets ? claimSets.corners : new Set(claimedCorners || []);
  const edges = claimSets ? claimSets.edges : new Set(claimedEdges === undefined ? (claimedCorners || []) : claimedEdges);

  if (!actual.cross) {
    return { ok: false, reason: 'cross claimed solved but is not actually solved' };
  }
  let piece = null;
  for (const slot of F2L_SLOTS) {
    const claimsPair = corners.has(slot) && edges.has(slot);
    if (!piece && corners.has(slot) !== edges.has(slot)) piece = pseudoSolvedFlags(facelets);
    if (actual[slot] !== claimsPair) {
      return {
        ok: false,
        reason: actual[slot]
          ? `slot ${slot} solved by luck (not claimed by this edge)`
          : `slot ${slot} claimed solved but is not actually solved`,
      };
    }
    if (claimsPair) continue;
    if (corners.has(slot) && !piece.cornerAt[slot]) {
      return { ok: false, reason: `slot ${slot} claimed solved but is not actually solved (corner)` };
    }
    if (edges.has(slot) && !piece.edgeAt[slot]) {
      return { ok: false, reason: `slot ${slot} claimed solved but is not actually solved (edge)` };
    }
  }
  return { ok: true, facelets, flags: actual };
}

let PERM_BY_TID = null;
// PERM_PAIR[a * 18 + b]: face turns a then b as one permutation (two turns
// per pass over the 54 facelets)
let PERM_PAIR = null;
const REPLAY_A = new Uint16Array(54);
const REPLAY_B = new Uint16Array(54);
function replayTokenIds(startCodes, ids) {
  if (!PERM_BY_TID) {
    PERM_BY_TID = SPELLING.tables().TOK.map(t => (MOVE_TABLE[t] ? Int32Array.from(MOVE_TABLE[t]) : null));
    PERM_PAIR = [];
    for (let a = 0; a < 18; a++) {
      for (let b = 0; b < 18; b++) PERM_PAIR.push(Int32Array.from(PERM_BY_TID[b], i => PERM_BY_TID[a][i]));
    }
  }
  let cur = REPLAY_A;
  let next = REPLAY_B;
  cur.set(startCodes);
  let k = 0;
  for (; k + 1 < ids.length; k += 2) {
    const a = ids[k];
    const b = ids[k + 1];
    const perm = a < 18 && b < 18 ? PERM_PAIR[a * 18 + b] : null;
    if (perm) {
      for (let i = 0; i < 54; i++) next[i] = cur[perm[i]];
      const t = cur; cur = next; next = t;
    } else {
      for (const id of [a, b]) {
        const one = PERM_BY_TID[id];
        for (let i = 0; i < 54; i++) next[i] = cur[one[i]];
        const t = cur; cur = next; next = t;
      }
    }
  }
  if (k < ids.length) {
    const perm = PERM_BY_TID[ids[k]];
    for (let i = 0; i < 54; i++) next[i] = cur[perm[i]];
    const t = cur; cur = next; next = t;
  }
  return String.fromCharCode.apply(null, cur);
}

const D_QUARTERS = { D: 1, 'D2': 2, "D'": 3 };
const D_TOKEN = ['', 'D', 'D2', "D'"];

function alignPseudoAlg(scramble, rotation, priorPath, coreAlg) {
  const base = coreAlg.trim().split(/\s+/).filter(Boolean);
  const last = base[base.length - 1];
  const lastQuarters = D_QUARTERS[last] || 0;
  const stem = lastQuarters ? base.slice(0, -1) : base;
  for (let k = 0; k < 4; k++) {
    const total = ((lastQuarters + k) % 4);
    const tokens = total ? [...stem, D_TOKEN[total]] : stem;
    const alg = tokens.join(' ');
    if (solvedFlags(replayFacelets(scramble, rotation, priorPath, alg)).cross) return alg;
  }
  return null;
}

const WIDE_TOKEN = /(^| )[rludfbMES]/;
const WIDE_B_TOKEN = /(^| )b/;
function hasWideB(alg) {
  return WIDE_B_TOKEN.test(alg);
}
function isWideAlg(alg) {
  return WIDE_TOKEN.test(alg);
}
function withoutWide(allowedMoves) {
  return allowedMoves.split('_').filter(m => !/^[rludfbMES]/.test(m)).join('_');
}

function isUnorthodox(alg) {
  // The displacement after one more turn of the layer, or null at +-2.
  const turn = (d, t) => {
    const next = t.includes('2') ? (d > 0 ? d - 2 : d + 2) : t.endsWith("'") ? d - 1 : d + 1;
    return Math.abs(next) >= 2 ? null : next;
  };
  let r = 0;
  let l = 0;
  for (const t of String(alg).split(' ')) {
    if (!t) continue;
    const c = t[0];
    if (c === 'R' || c === 'r') {
      r = turn(r, t);
      if (r === null) return true;
    } else if (c === 'L' || c === 'l') {
      l = turn(l, t);
      if (l === null) return true;
    } else if ('yzudfbES'.includes(c)) {
      r = 0;
      l = 0;
    }
  }
  return false;
}

function solverCallFor(helper, corners, scramble, rotation, maxLength, postAlg, maxSolutions = DEFAULT_MAX_SOLUTIONS, extra = {}) {
  const slots = corners.slice().sort().map(c => SLOT_INDICES[c]);
  const opts = { maxSolutions, maxLength, rotation, allowedMoves: MOVE_RESTRICT, postAlg: postAlg || '', noopMoves: NOOP_MOVES, ...extra };
  switch (slots.length) {
    case 0: return helper.solveCross(scramble, opts);
    case 1: return helper.solveXcross(scramble, slots[0], opts);
    case 2: return helper.solveXxcross(scramble, slots[0], slots[1], opts);
    case 3: return helper.solveXxxcross(scramble, slots[0], slots[1], slots[2], opts);
    case 4: return helper.solveXxxxcross(scramble, opts);
    default: throw new Error(`Unsupported pair count: ${slots.length}`);
  }
}

function costBase(holder, stepAlgs) {
  let base = holder._costBase;
  const scoring = holder.scoring || null;
  // (called for every scored spelling: skip the key when nothing changed)
  if (base && base.ref === stepAlgs && base.len === stepAlgs.length && base.last === stepAlgs[stepAlgs.length - 1] && base.scoring === scoring) return base;
  const key = stepAlgs.join('|');
  if (!base || base.key !== key || base.scoring !== scoring) {
    const scoredPath = stepAlgs.join(' ').trim();
    const pen = scoring ? scoring.pen : undefined;
    base = holder._costBase = {
      key,
      scoring,
      pen,
      scoredPath,
      mcc: typeof algSpeedPrefix === 'function' ? algSpeedPrefix(scoredPath, scoring ? scoring.mcc : undefined) : null,
      penalty: typeof stepPenalty === 'function' ? stepAlgs.reduce((sum, a) => sum + stepPenalty(a, pen), 0) : 0,
    };
  }
  base.ref = stepAlgs;
  base.len = stepAlgs.length;
  base.last = stepAlgs[stepAlgs.length - 1];
  return base;
}
function stepsPathCost(holder, stepAlgs, alg) {
  const base = costBase(holder, stepAlgs);
  const penalty = typeof stepPenalty === 'function' ? base.penalty + stepPenalty(alg, base.pen) : 0;
  if (base.mcc) return algSpeedResume(base.mcc, alg) + penalty;
  const path = base.scoredPath ? `${base.scoredPath} ${alg}` : alg;
  return algSpeed(path, false, false) + penalty;
}

function stepsPathMcc(holder, stepAlgs, alg) {
  const base = costBase(holder, stepAlgs);
  if (base.mcc) return algSpeedResume(base.mcc, alg) + base.penalty;
  return algSpeed(base.scoredPath ? `${base.scoredPath} ${alg}` : alg, false, false) + base.penalty;
}

const CORPUS_ROTATIONS = ['', 'y', 'y2', "y'"];
const CORPUS_AUFS = ['', 'U', 'U2', "U'"];
const U_QUARTERS = { U: 1, U2: 2, "U'": 3 };
let corpusTableCache = null;

function permOfAlg(alg) {
  let perm = IDENTITY_PERM;
  for (const t of alg.split(' ')) if (t) perm = composePerm(perm, MOVE_TABLE[t]);
  return perm;
}

function corpusTable() {
  if (corpusTableCache) return corpusTableCache;
  const algs = [];
  for (const alg of f2lCorpusAlgs()) {
    const toks = alg.split(' ');
    if (!toks.every(t => MOVE_TABLE[t])) continue;
    const net = netRotation(alg);
    if (!CORPUS_ROTATIONS.includes(net)) continue; // the cross would leave the bottom
    if (toks.includes('y2')) continue; // y2 only as a step's first move
    const perm = composePerm(permOfAlg(alg), net ? permOfAlg(inverseRotation(net)) : IDENTITY_PERM);
    algs.push({ alg, toks, turns: toks.filter(t => !/^[xyz]/.test(t)).length, perm: Uint8Array.from(perm) });
  }
  // Each slot's checked positions (pos, centre) pairs, seen through each
  // starting rotation's inverse (the claim is read in the step's start frame).
  const masks = ['cross', ...F2L_SLOTS];
  const prefixes = [];
  for (const r of CORPUS_ROTATIONS) {
    const back = r ? permOfAlg(inverseRotation(r)) : IDENTITY_PERM;
    const checks = masks.map(name => {
      const out = [];
      [...MASKS[name]].forEach((ch, pos) => {
        if (ch === ch.toUpperCase()) return;
        const centre = [4, 13, 22, 31, 40, 49][Math.floor(pos / 9)];
        out.push(back[pos], back[centre]);
      });
      return out;
    });
    for (const a of CORPUS_AUFS) prefixes.push({ r, a, perm: permOfAlg([r, a].filter(Boolean).join(' ')), checks });
  }
  corpusTableCache = { algs, prefixes };
  return corpusTableCache;
}

function joinAuf(a, toks) {
  if (!a) return toks.join(' ');
  const q = U_QUARTERS[toks[0]];
  if (!q) return [a, ...toks].join(' ');
  const sum = (U_QUARTERS[a] + q) % 4;
  const rest = toks.slice(1);
  const head = sum ? [['', 'U', 'U2', "U'"][sum]] : [];
  return head.length || rest.length ? [...head, ...rest].join(' ') : null;
}

function corpusSolutions(session, plan) {
  const out = new Map();
  // Corpus algs rotate mid-step and use wide moves: pro move set only (always
  // on in the app; postProcessCall reads rotated steps' claims only then).
  if (!session.proMoves || typeof f2lCorpusAlgs !== 'function' || typeof MASKS === 'undefined') return out;
  const byGoal = new Map();
  for (const p of plan) {
    if (p.isPseudo) continue;
    byGoal.set(p.allCorners.slice().sort().join(','), p);
  }
  if (!byGoal.size) return out;
  const { algs, prefixes } = corpusTable();
  const state = replayFacelets(session.scramble, session.rotation, session.scoredPath, '');
  const committed = new Set(session.currentNode.state.corners || []);
  const seen = new Set();
  for (const { r, a, perm, checks } of prefixes) {
    // st[j] = sticker at j after the prefix; then a corpus alg's perm.
    const st = new Array(54);
    for (let j = 0; j < 54; j++) st[j] = state[perm[j]];
    const solved = (c, k) => {
      const ch = checks[k];
      for (let i = 0; i < ch.length; i += 2) if (st[c[ch[i]]] !== st[c[ch[i + 1]]]) return false;
      return true;
    };
    for (const entry of algs) {
      const c = entry.perm;
      if (!solved(c, 0)) continue; // cross
      const pairs = [];
      let broken = false;
      for (let k = 1; k <= 4; k++) {
        const ok = solved(c, k);
        if (ok) pairs.push(F2L_SLOTS[k - 1]);
        else if (committed.has(F2L_SLOTS[k - 1])) { broken = true; break; }
      }
      if (broken || pairs.length === committed.size) continue;
      const p = byGoal.get(pairs.sort().join(','));
      if (!p || entry.turns > p.maxLength) continue;
      const core = joinAuf(a, entry.toks);
      if (!core) continue;
      // a corpus alg that starts with a rotation: one leading rotation, not two
      let alg = r ? `${r} ${core}` : core;
      const lead = alg.match(/^([xyz]['2]?) ([xyz]['2]?)(?= |$)/);
      if (lead) {
        const merged = rotationName(`${lead[1]} ${lead[2]}`);
        alg = [merged, alg.slice(lead[0].length).trim()].filter(Boolean).join(' ');
        if (merged.includes(' ')) continue; // not a single rotation (z or x combined with y)
      }
      alg = rotationFirst(alg); // "U y R U R'" as "y U R U R'"
      const key = `${p.allCorners}|${alg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!out.has(p)) out.set(p, []);
      out.get(p).push(alg);
    }
  }
  return out;
}

function pseudoCallFor(pseudoHelper, edges, corners, scramble, rotation, maxLength, postAlg, maxSolutions = DEFAULT_MAX_SOLUTIONS, deadline = 0, allowedMoves = MOVE_RESTRICT) {
  const toLetters = list => list.slice().sort();
  return pseudoHelper.solvePseudo(scramble, toLetters(edges), toLetters(corners), {
    maxSolutions, maxLength, rotation, allowedMoves, postAlg: postAlg || '', noopMoves: NOOP_MOVES,
    ...(deadline ? { deadline } : {}),
  });
}

const SEARCH_ENGINE_SHARE = 0.75;
const LOOKAHEAD_FIRST_SHARE = 0.5;
const POST_SHARE = 0.7;
const RANK_END_SHARE = 0.85;
const RANK_MS_PER_CANDIDATE = 0.007;
function budgetDeadline(session, share, start = Date.now()) {
  const budget = session && session.timeBudgetMs > 0 ? session.timeBudgetMs : 0;
  return budget ? start + budget * share : 0;
}
function callCostRank(p, proMoves) {
  return p.allCorners.length + (p.isPseudo ? 1.5 : 0) + (proMoves && !p.isPseudo ? 0.5 : 0) + p.maxLength / 100;
}

class SolveSession {
  constructor(scramble, prunedTree, colors, advancedOptions) {
    this.scramble = scramble;
    this.tree = prunedTree;
    this.colors = colors; // checked color names, e.g. ['white']
    this.crossOptEnabled = (advancedOptions || []).includes('cross_opt');
    this.maxSolutions = DEFAULT_MAX_SOLUTIONS; // pseudo engine calls (and every call with completeSearch off)
    this.topN = DEFAULT_TOP_N; // complete search: results kept per step type and filter
    this.completeSearch = true; // false = the capped pro-move-set engine search (tools)
    this.searchConfig = null; // per-category {maxSolutions, maxLength} overrides; see searchLimitFor/maxSolutionsFor
    this.proMoves = (advancedOptions || []).includes('pro_moves');
    this.nodeMap = new Map(prunedTree.nodes.map(n => [n.id, n]));
    const unsolved = prunedTree.nodes.find(n => n.state.cross_solved === false);
    this.rootId = unsolved ? unsolved.id : prunedTree.nodes[0].id;
    this.currentNodeId = this.rootId;

    this.rotation = ''; // cumulative setup rotation, fixed after step 1
    this.stepAlgs = []; // each committed step's core alg (rotation-stripped)
    this.committedRows = []; // display rows for the solve-so-far
    this.searchMemo = new Map(); // memoSearch results, shared with fork()s
    this.engineMemo = new Map(); // engine call results by exact input, shared with fork()s
    this.timeBudgetMs = 0; // per-search time budget (0 = none); see SEARCH_ENGINE_SHARE
    // Results-page search options (they apply to the step on screen and its
    // look-ahead, and can change from step to step):
    this.multislot = true; // later steps may solve several pairs (if the tree has those edges)
    this.wideMoves = true; // false: no wide-move results at any step (see WIDE_TOKEN)
    this.planning = true; // pair planning (EO, open back slots) in the pair-choice term
  }

  get searchSettingsKey() {
    const wide = this.wideMoves === false ? 'nowide' : '';
    const plan = this.planning === false ? '|noplan' : '';
    if (this.isAtRoot) return wide + plan;
    return `${this.multislot ? '' : 'single'}${wide ? '|' + wide : ''}${plan}`;
  }

  withSettings(settings) {
    const s = this.fork();
    for (const k of ['multislot', 'wideMoves', 'planning']) if (settings && settings[k] !== undefined) s[k] = !!settings[k];
    return s;
  }

  fork(candidate) {
    const s = Object.assign(Object.create(SolveSession.prototype), this, {
      stepAlgs: this.stepAlgs.slice(),
      committedRows: this.committedRows.slice(),
      resultsCache: null,
    });
    if (candidate) s.commit(candidate);
    return s;
  }

  get isAtRoot() { return this.currentNodeId === this.rootId; }
  get canUndo() { return this.committedRows.length > 0; }
  get currentNode() { return this.nodeMap.get(this.currentNodeId); }
  get rootNode() { return this.nodeMap.get(this.rootId); }
  get scoredPath() { return this.stepAlgs.join(' ').trim(); }
  pathCost(alg) {
    return stepsPathCost(this, this.stepAlgs, alg);
  }
  get scoring() { return typeof scoringFor === 'function' ? scoringFor(this) : null; }
  get engineFrame() { return canonicalizeForEngine(this.rotation, this.scoredPath); }
  get isComplete() {
    const s = this.currentNode.state;
    return s.cross_solved && (s.corners || []).length === 4 && (s.edges || []).length === 4;
  }

  outgoingEdges() {
    return this.tree.edges.filter(e => e.source === this.currentNodeId);
  }

  commit(candidate) {
    if (this.isAtRoot) {
      this.rotation = candidate.rotation;
    }
    this.stepAlgs.push(candidate.coreAlg);
    this.committedRows.push(candidate);
    this.currentNodeId = candidate.targetNodeId;
    this.resultsCache = null;
  }

  undo() {
    if (!this.committedRows.length) return false;
    this.committedRows.pop();
    this.stepAlgs.pop();
    this.currentNodeId = this.committedRows.length
      ? this.committedRows[this.committedRows.length - 1].targetNodeId
      : this.rootId;
    if (!this.committedRows.length) this.rotation = '';
    this.resultsCache = null;
    return true;
  }
}

function stripEnginePrefix(raw, knownPrefix) {
  if (!raw) return null;
  return raw.map((sol) => {
    sol = (sol || '').trim();
    if (knownPrefix && sol.startsWith(knownPrefix)) return sol.slice(knownPrefix.length).trim();
    return sol;
  });
}

// The cube state a later-step engine call starts from (scramble, then the
// call's rotation and committed moves), as facelets; cached per search plan.
function engineStateKey(p) {
  return applyAlgorithm(SOLVED_FACELETS, [p.scramble, p.callRotation, p.postAlgForCall].filter(Boolean).join(' '));
}

// Engine calls already made (or running) for a session and its forks, by
// their input (see searchCurrentNode); failed calls are not kept.
const ENGINE_MEMO_LIMIT = 600;
function engineCallMemo(session, key, run, shouldStop = null) {
  const wants = [shouldStop];
  const state = { stopped: false };
  const stopped = () => (state.stopped = state.stopped || wants.every(f => f && f()));
  if (!key) return run(stopped);
  const memo = session.engineMemo || (session.engineMemo = new Map());
  const hit = memo.get(key);
  if (hit && !hit.state.stopped) {
    hit.wants.push(shouldStop);
    return hit;
  }
  const promise = run(stopped);
  promise.wants = wants;
  promise.state = state;
  memo.set(key, promise);
  const forget = () => { if (memo.get(key) === promise) memo.delete(key); };
  promise.then((v) => { if (v == null) forget(); }, forget);
  while (memo.size > ENGINE_MEMO_LIMIT) memo.delete(memo.keys().next().value);
  return promise;
}

const serialChains = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
function serialEngine(helper) {
  if (!helper || helper.__gated || !serialChains) return helper;
  if (!serialChains.has(helper)) {
    let chain = Promise.resolve();
    serialChains.set(helper, new Proxy(helper, {
      get(target, prop) {
        const value = target[prop];
        if (typeof value !== 'function') return value;
        if (typeof prop === 'string' && prop.startsWith('solve')) {
          return (...args) => {
            const run = chain.then(() => value.apply(target, args));
            chain = run.catch(() => {});
            return run;
          };
        }
        return value.bind(target);
      },
    }));
  }
  return serialChains.get(helper);
}

const FIRST_MOVES = ['U', "U'", 'U2', 'D', "D'", 'D2', 'R', "R'", 'R2', 'L', "L'", 'L2', 'F', "F'", 'F2', 'B', "B'", 'B2'];
async function splitByFirstMove(engine, p, extra, stopped = null) {
  const prefix = [p.callRotation, p.postAlgForCall].filter(Boolean).join(' ');
  const jobs = [
    ...FIRST_MOVES.map(m => () => {
      const post = [p.postAlgForCall, m].filter(Boolean).join(' ');
      return solverCallFor(engine, p.allCorners, p.scramble, p.callRotation, p.maxLength - 1, post, p.effectiveMaxSolutions, extra)
        .then(raw => (raw === null ? null : stripEnginePrefix(raw, [p.callRotation, post].filter(Boolean).join(' ')).map(x => (x ? `${m} ${x}` : m))));
    }),
    () => solverCallFor(engine, p.allCorners, p.scramble, p.callRotation, 1, p.postAlgForCall, p.effectiveMaxSolutions, extra)
      .then(raw => (raw === null ? null : stripEnginePrefix(raw, prefix))),
  ];
  const parts = new Array(jobs.length);
  let next = 0;
  let halted = false;
  const lane = async () => {
    while (next < jobs.length) {
      if (stopped && stopped()) { halted = true; return; }
      const k = next++;
      parts[k] = await jobs[k]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs.length, ((engine && engine.size) || 1) + 1) }, lane));
  if (halted) return null;
  if (parts.some(x => x === null)) return null;
  // in the engine's own form (its prefix echoed), as the caller expects
  return [...new Set([].concat(...parts).filter(Boolean))].map(x => (prefix ? `${prefix} ${x}` : x));
}

async function searchCurrentNode(session, helper, onStatus, pseudoHelper, deadline, onPartial, stop = null) {
  const isRoot = session.isAtRoot;
  // Absolute deadline (epoch ms) for this search's engine calls; 0 = none.
  if (deadline === undefined) deadline = budgetDeadline(session, SEARCH_ENGINE_SHARE);
  // When post-processing stops (time budget; 0 = never): calls not processed
  // by then are dropped, a call being processed keeps what it has.
  const postStop = deadline && session.timeBudgetMs > 0 ? deadline + session.timeBudgetMs * (1 - SEARCH_ENGINE_SHARE) * POST_SHARE : 0;
  let edges = session.outgoingEdges();
  if (!isRoot && session.multislot === false) {
    edges = edges.filter(e => ((e.solved_step && e.solved_step.corners) || []).length <= 1
      && ((e.solved_step && e.solved_step.edges) || []).length <= 1);
  }
  const targetKey = (edge) => {
    const target = session.nodeMap.get(edge.target);
    return JSON.stringify([
      (target.state.corners || []).slice().sort(),
      (target.state.edges || []).slice().sort(),
    ]);
  };
  const fullOnlyByKey = new Map();
  for (const edge of edges) {
    const key = targetKey(edge);
    fullOnlyByKey.set(key, (fullOnlyByKey.has(key) ? fullOnlyByKey.get(key) : true) && !!edge.full_pseudo_only);
  }

  {
    const seen = new Set();
    edges = edges.filter(edge => {
      const key = targetKey(edge);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  if (!isRoot) {
    const committed = session.currentNode.state;
    const committedCorners = new Set(committed.corners || []);
    const committedEdges = new Set(committed.edges || []);
    edges = edges.filter(edge => {
      const target = session.nodeMap.get(edge.target);
      const targetCorners = target.state.corners || [];
      const targetEdges = target.state.edges || [];
      return [...committedCorners].every(c => targetCorners.includes(c))
        && [...committedEdges].every(e => targetEdges.includes(e));
    });
  }

  const yieldState = { lastYield: now(), listed: 0 };

  const colorList = isRoot ? session.colors : [null];

  // Pass 1: plan every engine call of this search (one per edge and colour).
  const plan = [];
  for (const edge of edges) {
    const targetNode = session.nodeMap.get(edge.target);
    const isPseudo = typeof isPseudoState === 'function' && isPseudoState(targetNode.state);
    if (isPseudo && (!pseudoHelper || (targetNode.state.corners || []).length > 3)) continue;

    const newCorners = (edge.solved_step && edge.solved_step.corners) || [];
    const newEdges = (edge.solved_step && edge.solved_step.edges) || [];
    const pairCount = newCorners.length;

    const allCorners = targetNode.state.corners || [];
    const allEdges = targetNode.state.edges || [];
    const maxLength = searchLimitFor(pairCount, isRoot, allCorners.length, session.searchConfig, isPseudo);
    if (maxLength === undefined) continue;
    const complete = session.completeSearch !== false && !isPseudo;
    // Complete search: the per-type "max solutions" is how many results of
    // the type are kept (topN); the engine lists every solution.
    const effectiveMaxSolutions = complete ? COMPLETE_ENGINE_CAP
      : maxSolutionsFor(pairCount, isRoot, session.searchConfig, isPseudo, session.maxSolutions);
    const topN = complete ? maxSolutionsFor(pairCount, isRoot, session.searchConfig, isPseudo, session.topN) : 0;

    for (const color of colorList) {
      const baseRotation = isRoot ? (COLOR_ROTATIONS[color] || '') : session.rotation;
      const scramble = session.scramble;
      const frame = isRoot ? null : session.engineFrame;
      const callRotation = isRoot ? baseRotation : frame.rotation;
      const postAlgForCall = isRoot || !frame.moves ? '' : `${frame.moves} ${POSTALG_BOUNDARY}`;

      plan.push({
        edge, targetNode, isPseudo, newEdges, pairCount, allCorners, allEdges, maxLength,
        effectiveMaxSolutions, color, baseRotation, scramble, callRotation, postAlgForCall,
        fullPseudoOnly: fullOnlyByKey.get(targetKey(edge)) === true,
        complete, topN, category: categoryKeyFor(pairCount, isRoot, isPseudo),
      });
    }
  }

  const rank = session.lookaheadRank || null;
  const ranked = (h) => (rank && h && typeof h.withRank === 'function' ? h.withRank(rank) : h);
  const engine = ranked(serialEngine(helper));
  const pseudoEngine = ranked(serialEngine(pseudoHelper));
  const startOrder = deadline
    ? plan.slice().sort((a, b) => callCostRank(a, session.proMoves) - callCostRank(b, session.proMoves))
    : (isRoot ? plan : plan.slice().sort((a, b) => (a.pairCount > 1) - (b.pairCount > 1)));
  let releaseMultislots = null;
  const singlesRanked = !isRoot && !deadline && session.holdMultislots !== false
    ? new Promise((resolve) => { releaseMultislots = resolve; })
    : null;
  for (const p of startOrder) {
    // Complete search: face turns only (every rotation and wide spelling is
    // derived from them afterwards, spelling-search.js), every solution.
    const extra = { ...(session.proMoves && !p.complete ? proEngineOptions(p.callRotation, isRoot) : {}), ...(deadline ? { deadline } : {}) };
    if (session.wideMoves === false && extra.allowedMoves) extra.allowedMoves = withoutWide(extra.allowedMoves);
    const deepen = async (stopped) => {
      if (singlesRanked && p.pairCount > 1) await singlesRanked;
      let raw = !isRoot && p.pairCount > 1
        ? await splitByFirstMove(engine, p, extra, stopped)
        : await solverCallFor(engine, p.allCorners, p.scramble, p.callRotation, p.maxLength, p.postAlgForCall, p.effectiveMaxSolutions, extra);
      // A later goal with no solution within the limit: its shortest ones.
      if (raw === null && stopped && stopped()) {
        if (stop && stop.onStopped) stop.onStopped();
        return null;
      }
      for (let more = 1; !isRoot && raw && !raw.length && more <= LATER_DEEPEN; more++) {
        raw = await solverCallFor(engine, p.allCorners, p.scramble, p.callRotation, p.maxLength + more, p.postAlgForCall, DEFAULT_MAX_SOLUTIONS, extra);
      }
      return raw;
    };
    const run = stopped => (p.isPseudo
      ? pseudoCallFor(pseudoEngine, p.allEdges, p.allCorners, p.scramble, p.callRotation, p.maxLength, p.postAlgForCall, p.effectiveMaxSolutions, deadline)
      : p.complete ? deepen(stopped)
        : solverCallFor(engine, p.allCorners, p.scramble, p.callRotation, p.maxLength, p.postAlgForCall, p.effectiveMaxSolutions, extra));
    const callKey = deadline ? null : JSON.stringify(p.isPseudo
      ? ['p', p.allEdges.slice().sort(), p.allCorners.slice().sort(), p.scramble, p.callRotation, p.maxLength, p.postAlgForCall, p.effectiveMaxSolutions]
      : ['m', p.allCorners.slice().sort(), engineStateKey(p), p.callRotation, p.maxLength, p.effectiveMaxSolutions, extra]);
    // Solutions with this call's own "rotation postAlg" prefix stripped (the
    // engine echoes it), so a call shared by state yields the same steps.
    const knownPrefix = [p.callRotation, p.postAlgForCall].filter(Boolean).join(' ');
    p.cores = engineCallMemo(session, callKey, stopped => Promise.resolve().then(() => run(stopped)).then(raw => stripEnginePrefix(raw, knownPrefix)), stop && stop.shouldStop)
      .then((r) => { p.doneAt = Date.now(); return r; })
      .catch((err) => { console.error('Solver error', err); return null; });
  }
  // Corpus candidates (later steps; see corpusSolutions) join their call's
  // engine solutions.
  if (!isRoot) {
    for (const [p, extra] of corpusSolutions(session, plan)) {
      if (p.complete) p.corpus = extra;
      else p.cores = p.cores.then(c => (c === null ? null : c.concat(extra)));
    }
  }
  let truncatedCalls = 0;
  let listed = 0;
  const listedNow = () => Math.max(listed, yieldState.listed || 0);
  // Engine calls that failed (an engine error or a crashed worker): the list
  // is missing their results, so it is marked and not memoised.
  let failedCalls = 0;

  const ctx = postProcessContext(session, isRoot);
  const typeBest = new Map();
  const typeLimits = (p) => {
    const best = typeBest.get(p.category);
    return RESULT_VIEWS.map((_, v) => {
      let tpps = best ? best[v] : [];
      for (const q of plan) {
        if (q.category === p.category && q.seedViews && !q.noted) tpps = tpps.concat(q.seedViews[v]);
      }
      if (tpps !== (best && best[v])) tpps = tpps.slice().sort((a, b) => a - b);
      return tpps.length >= p.topN ? tpps[p.topN - 1] : Infinity;
    });
  };
  const noteTypeBest = (p) => {
    p.noted = true;
    if (!p.complete || !p.candidates.length) return;
    let best = typeBest.get(p.category);
    if (!best) typeBest.set(p.category, (best = RESULT_VIEWS.map(() => [])));
    // each result once (its chunks may have found the same one)
    const byKey = new Map();
    for (const c of p.candidates) {
      const k = dedupeKey(c);
      const o = byKey.get(k);
      if (!o || c.tpp < o.tpp) byKey.set(k, c);
    }
    const own = [...byKey.values()];
    RESULT_VIEWS.forEach((view, v) => {
      const merged = best[v].concat(own.filter(view.test).map(c => c.tpp)).sort((a, b) => a - b);
      best[v] = merged.slice(0, p.topN);
    });
  };
  const liveCalls = new Map(); // call -> Set of its running jobs' records
  const liveScheduled = new Set();
  const mergedLimits = (category, topN) => {
    const best = typeBest.get(category);
    const per = RESULT_VIEWS.map((_, v) => (best ? best[v].slice() : []));
    for (const [q, recs] of liveCalls) {
      if (q.category !== category) continue;
      const byKey = new Map();
      for (const r of recs) {
        if (!r.snap) continue;
        for (const [key, tpp, mask] of r.snap) {
          const o = byKey.get(key);
          if (!o || tpp < o[0]) byKey.set(key, [tpp, mask]);
        }
      }
      for (const [tpp, mask] of byKey.values()) {
        for (let v = 0; v < per.length; v++) if ((mask >> v) & 1) per[v].push(tpp);
      }
    }
    return per.map((a) => {
      if (a.length < topN) return Infinity;
      a.sort((x, y) => x - y);
      return a[topN - 1];
    });
  };
  const broadcast = (category) => {
    liveScheduled.delete(category);
    let merged = null;
    for (const [q, recs] of liveCalls) {
      if (q.category !== category) continue;
      if (!merged) merged = mergedLimits(category, q.topN);
      const own = typeLimits(q);
      const limits = merged.map((l, v) => Math.min(l, own[v]));
      for (const r of recs) {
        if (!r.push || !limits.some((l, v) => l < r.sent[v])) continue;
        r.sent = limits;
        r.push(limits);
      }
    }
  };
  const scheduleBroadcast = (category) => {
    if (liveScheduled.has(category)) return;
    liveScheduled.add(category);
    setTimeout(() => broadcast(category), LIVE_BROADCAST_MS);
  };
  const liveHooks = (p) => {
    const rec = { snap: null, push: null, sent: RESULT_VIEWS.map(() => Infinity) };
    const later = () => scheduleBroadcast(p.category);
    return {
      // the pool: push(limits) sends limits to the job's worker
      attach(push) {
        rec.push = push;
        if (!liveCalls.has(p)) liveCalls.set(p, new Set());
        liveCalls.get(p).add(rec);
        later();
      },
      report(snap) { rec.snap = snap; later(); },
      detach() {
        rec.push = null;
        const recs = liveCalls.get(p);
        if (recs) { recs.delete(rec); if (!recs.size) liveCalls.delete(p); }
      },
    };
  };
  const processCall = async (p) => {
    p.candidates = [];
    const { isPseudo, pairCount, color } = p;
    if (onStatus) onStatus(`searching ${edgeLabel(pairCount, isRoot, isPseudo).toLowerCase()}${color ? ' (' + color + ')' : ''}…`);
    const cores = await p.cores;
    if (cores === null) { failedCalls++; return; }
    // nobody wants this search any more (memoSearch): rank nothing more
    if (stop && stop.shouldStop && stop.shouldStop()) {
      failedCalls++;
      if (stop.onStopped) stop.onStopped();
      return;
    }
    if (postStop && Date.now() + listedNow() * RANK_MS_PER_CANDIDATE >= postStop) { truncatedCalls++; return; }
    // Finished at or after the deadline without reaching its cap: cut short
    // (or skipped) by the time budget, so its list may be incomplete.
    if (deadline && p.doneAt >= deadline && cores.length < p.effectiveMaxSolutions) truncatedCalls++;
    if (p.complete && cores.length > COMPLETE_CHUNK && !session.postProcessor) {
      const others = plan.filter(q => q !== p && q.complete && q.category === p.category && q.processing && !q.big);
      p.big = true;
      await Promise.all(others.map(q => q.processing.catch(() => {})));
    }
    if (!(p.complete && session.postProcessor && cores.length > COMPLETE_CHUNK)) p.markSeeded();
    const job = postProcessJob(session, p);
    if (p.complete) job.limits = typeLimits(p);
    // A worker pool may start the job later: by then more calls of its type
    // may have finished, and their N-th best bounds it too.
    const refresh = p.complete ? (j => ({ ...j, limits: typeLimits(p).map((l, v) => Math.min(l, j.limits ? j.limits[v] : Infinity)) })) : null;
    if (postStop) { job.stopAt = postStop; job.listedBefore = listedNow(); job.rankMsPerCandidate = RANK_MS_PER_CANDIDATE; }
    if (p.complete && session.postProcessor && cores.length > COMPLETE_CHUNK) {
      const seedList = await session.postProcessor(ctx, { ...job, seedOnly: true, corpus: null }, cores, rank, refresh);
      job.limits = completeSeedLimits(seedList, p.topN, job.limits);
      p.seedViews = RESULT_VIEWS.map(view => seedList.filter(view.test).map(c => c.tpp).sort((a, b) => a - b).slice(0, p.topN));
      p.markSeeded();
      await Promise.all(plan.filter(q => q !== p && q.complete && q.category === p.category).map(q => q.seedReady));
      // nobody wants this search any more (a click while it waited)
      if (stop && stop.shouldStop && stop.shouldStop()) {
        failedCalls++;
        if (stop.onStopped) stop.onStopped();
        return;
      }
      const chunks = completeChunks(cores, session.postProcessor.workers);
      const parts = await Promise.all(chunks.map((c, k) => session.postProcessor(ctx, k ? { ...job, corpus: null } : job, c, rank, refresh, liveHooks(p))));
      p.candidates = [].concat(...parts);
    } else {
      p.candidates = session.postProcessor
        ? await session.postProcessor(ctx, job, cores, rank, refresh, p.complete ? liveHooks(p) : null)
        : await postProcessCall(ctx, job, cores, yieldState);
    }
    listed += p.candidates.length;
    noteTypeBest(p);
    if (p.complete && liveCalls.size) scheduleBroadcast(p.category);
    // Cut short by the time budget (postProcessCall stopped at job.stopAt).
    if (postStop && p.candidates.stopped && !(deadline && p.doneAt >= deadline && cores.length < p.effectiveMaxSolutions)) truncatedCalls++;
  };
  let lastPartial = 0;
  let partialCost = 0;
  let multislotTail = false;
  const maybeEmitPartial = () => {
    if (typeof onPartial !== 'function') return;
    // memoSearch's emitter says whether anyone is listening; the look-ahead's
    // own searches usually have no listener, and ranking is not free.
    if (typeof onPartial.wanted === 'function' && !onPartial.wanted()) return;
    const pending = plan.filter(p => !p.processed);
    const tail = !isRoot && pending.length > 0 && pending.every(p => p.complete && p.pairCount > 1);
    const t = now();
    if (!(tail && !multislotTail) && lastPartial && t - lastPartial < Math.max(PARTIAL_INTERVAL_MS, 4 * partialCost)) return;
    multislotTail = multislotTail || tail;
    // the finished types' exact best N, as at the end (trimming a subset of
    // a type's calls never drops a row the whole type keeps)
    if (tail) trimToTypeBest(plan.filter(p => p.processed));
    const list = rankCandidates(plan.filter(p => p.processed));
    if (tail) list.onlyMultislotPending = true;
    partialCost = now() - t;
    lastPartial = now();
    onPartial(list);
  };
  // seedReady: a complete call's seeds are known (or it has none: small,
  // failed or stopped), see processCall
  for (const p of plan) p.seedReady = new Promise((resolve) => { p.markSeeded = resolve; });
  for (const p of plan) {
    p.processing = p.cores.then(() => processCall(p));
    p.processing.then(p.markSeeded, p.markSeeded);
  }
  if (releaseMultislots) {
    Promise.all(plan.filter(p => !(p.pairCount > 1)).map(p => p.processing.catch(() => {})))
      .then(releaseMultislots);
  }
  await Promise.all(plan.map(p => p.processing.then(() => {
    p.processed = true;
    maybeEmitPartial();
  })));

  if (postStop) {
    const end = deadline + session.timeBudgetMs * (1 - SEARCH_ENGINE_SHARE) * RANK_END_SHARE;
    const room = Math.max(1000, Math.floor((end - Date.now()) / RANK_MS_PER_CANDIDATE));
    let total = 0;
    for (const p of plan) total += (p.candidates || []).length;
    if (total > room) {
      const tpps = new Float64Array(total);
      let k = 0;
      for (const p of plan) for (const c of p.candidates || []) tpps[k++] = c.tpp;
      tpps.sort();
      const cut = tpps[room - 1];
      let kept = 0;
      for (const p of plan) {
        if (!p.candidates) continue;
        p.candidates = p.candidates.filter(c => c.tpp < cut || (c.tpp === cut && kept < room && ++kept));
      }
      truncatedCalls = Math.max(truncatedCalls, 1);
    }
  }
  // Complete search: exactly the best N of each step type and filter (calls
  // post-processed before others of their type finished kept more).
  trimToTypeBest(plan);
  const out = rankCandidates(plan);
  // How many engine calls the time budget cut short (absent = complete).
  if (truncatedCalls) out.truncatedCalls = truncatedCalls;
  if (failedCalls) out.failedCalls = failedCalls;
  return out;
}

function completeSeedLimits(candidates, topN, limits) {
  return RESULT_VIEWS.map((view, v) => {
    const tpps = (candidates || []).filter(view.test).map(c => c.tpp).sort((a, b) => a - b);
    const seeded = tpps.length >= topN ? tpps[topN - 1] : Infinity;
    return Math.min(seeded, limits ? limits[v] : Infinity);
  });
}

// Complete search: solutions per post-processing job (see processCall).
const COMPLETE_CHUNK = 12000;
function completeChunks(cores, workers) {
  const keyed = cores.filter(Boolean).map(c => [c.split(' ').reverse().join(' '), c]);
  keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const count = Math.max(1, Math.min(workers || Infinity, Math.ceil(keyed.length / COMPLETE_CHUNK)));
  const size = Math.ceil(keyed.length / count);
  const out = [];
  for (let k = 0; k < keyed.length; k += size) out.push(keyed.slice(k, k + size).map(x => x[1]));
  return out;
}

function trimToTypeBest(plan) {
  const byType = new Map();
  for (const p of plan) {
    if (!p.complete || !p.candidates) continue;
    if (!byType.has(p.category)) byType.set(p.category, []);
    byType.get(p.category).push(p);
  }
  for (const calls of byType.values()) {
    const top = new SPELLING.TopViews(RESULT_VIEWS.map(v => v.test), calls[0].topN);
    for (const p of calls) for (const c of p.candidates) { c.key = dedupeKey(c); top.offer(c); }
    const kept = new Set(top.list());
    for (const p of calls) {
      p.candidates = p.candidates.filter(c => kept.has(c));
      for (const c of p.candidates) delete c.key;
    }
  }
}

function postProcessContext(session, isRoot) {
  nodeByLabels(session, [], []); // builds the tree's index
  if (isRoot) rootTargetByLabels(session, [], []);
  return {
    isRoot,
    scramble: session.scramble,
    rotation: session.rotation,
    stepAlgs: session.stepAlgs.slice(),
    scoredPath: session.scoredPath,
    proMoves: session.proMoves,
    crossOptEnabled: session.crossOptEnabled,
    wideMoves: session.wideMoves !== false,
    currentCorners: (session.currentNode.state.corners || []).slice(),
    currentEdges: (session.currentNode.state.edges || []).slice(),
    firstColor: session.committedRows[0] ? session.committedRows[0].color : '',
    nodeIndex: nodeByLabelsIndex.get(session.tree),
    rootTargets: isRoot ? session._rootTargetsByLabels : null,
    scoring: session.scoring,
    lookWeights: lookWeightsFor(session),
    planWeights: session.planning !== false && typeof PAIR_PLANNING !== 'undefined' && PAIR_PLANNING.plan.some(w => w) ? PAIR_PLANNING.plan.slice() : null,
  };
}

function lookWeightsFor(session) {
  const w = session.planning !== false && typeof PAIR_PLANNING !== 'undefined' ? PAIR_PLANNING.look : null;
  return w && w.some(x => x) ? w.slice() : null;
}

const planScratch = [0, 0, 0, 0];
const planYScratch = new Array(16).fill(0);
function planCost(weights, facelets) {
  if (!weights || !facelets) return 0;
  planFeatures(facelets, planScratch);
  let x = 0;
  for (let k = 0; k < weights.length; k++) x += weights[k] * planScratch[k];
  return x;
}

function postProcessJob(session, p) {
  return {
    target: p.edge.target,
    targetEdges: (p.targetNode.state.edges || []).slice(),
    pieces: calculateSolvedPieces(session.rootNode, p.targetNode),
    isPseudo: p.isPseudo,
    newEdges: p.newEdges,
    pairCount: p.pairCount,
    allCorners: p.allCorners,
    allEdges: p.allEdges,
    color: p.color,
    baseRotation: p.baseRotation,
    fullPseudoOnly: p.fullPseudoOnly,
    complete: !!p.complete,
    topN: p.topN,
    corpus: p.corpus || null,
    wideMoves: session.wideMoves !== false,
    // Tools only (functions do not reach a worker): other result views.
    ...(session.resultViews ? { views: session.resultViews } : {}),
  };
}

function ctxNodeByLabels(ctx, pairs) {
  const key = JSON.stringify([pairs.slice().sort(), pairs.slice().sort()]);
  return ctx.nodeIndex.has(key) ? ctx.nodeIndex.get(key) : null;
}

function ctxNodeByPieces(ctx, corners, edges) {
  const key = JSON.stringify([corners.slice().sort(), edges.slice().sort()]);
  return ctx.nodeIndex.has(key) ? ctx.nodeIndex.get(key) : null;
}

function ctxRootTarget(ctx, corners, edges) {
  return ctx.rootTargets.get(JSON.stringify([corners.slice().sort(), edges.slice().sort()])) || null;
}

function pathCostFor(ctx, alg) {
  return stepsPathCost(ctx, ctx.stepAlgs, alg);
}

async function postProcessCall(ctx, p, cores, yieldState, live = null) {
  if (p.complete) return postProcessComplete(ctx, p, cores, live);
  const candidates = [];
  const { isRoot } = ctx;
  const wideOn = ctx.wideMoves !== false;
  const weights = ctx.lookWeights;
  const lookFeatures = [0, 0, 0, 0, 0];
  const lookCost = (facelets) => {
    if (!weights || !facelets) return 0;
    pairLookFeatures(facelets, lookFeatures);
    let x = 0;
    for (let k = 0; k < weights.length; k++) x += weights[k] * lookFeatures[k];
    return x;
  };
  const push = (c, look = 0) => {
    if (!wideOn && isWideAlg(c.coreAlg)) return;
    if (hasWideB(c.coreAlg)) return;
    // A first step's only rotation is the inspection
    if (isRoot && /(^| )[xyz]/.test(c.coreAlg)) return;
    // pair planning: the cube as the step leaves it held
    if (ctx.planWeights) look += planCost(ctx.planWeights, replayFacelets(ctx.scramble, isRoot ? c.rotation : ctx.rotation, ctx.scoredPath, c.coreAlg));
    if (look) c.tpp += look / p.pieces;
    if (!isRoot && isUnorthodox(c.coreAlg)) c.unorthodox = true;
    else delete c.unorthodox;
    if (!isRoot && ((c.corners || []).length > 1 || (c.edges || []).length > 1)) c.multislot = true;
    else delete c.multislot;
    candidates.push(c);
    if (yieldState && yieldState.listed !== undefined) yieldState.listed++;
  };
  const {
    isPseudo, newEdges, pairCount, allCorners, allEdges, color, baseRotation,
  } = p;
  const uniqueCoreAlgs = new Set();
  for (const coreAlg of cores) if (coreAlg) uniqueCoreAlgs.add(coreAlg);

  let processed = 0;
  for (const coreAlg of uniqueCoreAlgs) {
    if (yieldState) await yieldIfDue(yieldState);
    // Time budget (searchCurrentNode's postStop): keep what is done.
    const listedSoFar = yieldState && yieldState.listed !== undefined ? yieldState.listed : (p.listedBefore || 0) + candidates.length;
    if (p.stopAt && (++processed & 31) === 0 && Date.now() + listedSoFar * (p.rankMsPerCandidate || 0) >= p.stopAt) {
      candidates.stopped = true;
      break;
    }

    if (isRoot && pairCount === 0 && wideOn && ctx.crossOptEnabled && typeof optimizeCrossSolution === 'function') {
      const optimized = optimizeCrossSolution(coreAlg.trim().split(/\s+/));
      for (const opt of optimized) {
        const optAlg = opt.moves.join(' ');
        if (optAlg === coreAlg && !opt.rotation) continue; // identical to the unoptimized result below

        const optLuckCheck = checkCandidateAgainstRealCubeState(
          ctx.scramble, baseRotation, ctx.scoredPath, optAlg, []
        );
        if (!optLuckCheck.ok) {
          // Luck (an extra pair solved) is an expected discard, exactly as
          // for the plain result below; only a real failure is a warning.
          if (optLuckCheck.reason.includes('claimed solved but is not actually solved')) {
            console.warn(`Discarding cross-optimised candidate: ${optLuckCheck.reason}`, { coreAlg: optAlg, rotation: baseRotation });
          }
          continue;
        }

        const optRotation = baseRotation;

        const optTpp = pathCostFor(ctx, optAlg) / p.pieces;

        push({
          color,
          type: edgeTypeLabel(pairCount, isRoot),
          rotation: optRotation,
          edges: [],
          corners: [],
          coreAlg: optAlg,
          tpp: Number.isFinite(optTpp) ? optTpp : Infinity,
          targetNodeId: p.target,
        }, lookCost(optLuckCheck.facelets));
      }
    }

    // A root result that STARTS with a rotation duplicates a free
    // inspection-rotation variant below; only mid-step rotations count.
    if (isRoot && ctx.proMoves && /^[xyz]/.test(coreAlg)) continue;
    const variants = !isRoot ? [coreAlg]
      : ctx.proMoves ? ['', 'y', 'y2', "y'"].map(t => (t ? `${t} ${relabelAlgForRotation(coreAlg, t)}` : coreAlg))
      : typeof altAlgs === 'function' ? altAlgs([coreAlg]) : [coreAlg];

    for (const variant of variants) {
      const { token: yToken, rest: variantAlg } = isRoot ? stripLeadingRotation(variant) : { token: '', rest: variant };
      const fullRotation = isRoot ? composeRotations(baseRotation, yToken) : ctx.rotation;

      if (!variantAlg) continue; // shouldn't happen, but guard

      const alignedAlg = isPseudo
        ? alignPseudoAlg(ctx.scramble, fullRotation, ctx.scoredPath, variantAlg)
        : variantAlg;
      const finalCoreAlg = alignedAlg && !isRoot ? rotationFirst(alignedAlg) : alignedAlg;
      if (finalCoreAlg === null) {
        console.warn('Discarding pseudo candidate: cross is not solved up to a D turn', { coreAlg: variantAlg, rotation: fullRotation });
        continue;
      }
      if (!finalCoreAlg) continue; // alignment cancelled the whole algorithm

      const trueClaimedCorners = isRoot ? relabelSlotsForRotation(allCorners, yToken) : allCorners;
      const trueClaimedEdges = isRoot ? relabelSlotsForRotation(allEdges, yToken) : allEdges;

      const stepRotation = ctx.proMoves && !isPseudo ? netRotation(finalCoreAlg) : '';
      let reachedNodeId;
      if (stepRotation) {
        const after = solvedFlags(replayFacelets(ctx.scramble, fullRotation, ctx.scoredPath, finalCoreAlg));
        const pairs = F2L_SLOTS.filter(sl => after[sl]);
        reachedNodeId = after.cross ? ctxNodeByLabels(ctx, pairs) : null;
      } else {
        reachedNodeId = isRoot
          ? ctxRootTarget(ctx, trueClaimedCorners, trueClaimedEdges)
          : p.target;
      }
      if (!reachedNodeId) {
        console.warn('Discarding candidate: no DAG node for its rotated claim', { trueClaimedCorners, trueClaimedEdges, rotation: fullRotation });
        continue;
      }

      const luckCheck = checkCandidateAgainstRealCubeState(
        ctx.scramble, fullRotation, ctx.scoredPath,
        stepRotation ? `${finalCoreAlg} ${inverseRotation(stepRotation)}` : finalCoreAlg,
        trueClaimedCorners, trueClaimedEdges
      );
      if (!luckCheck.ok) {
        if (luckCheck.reason.includes('claimed solved but is not actually solved')) {
          console.warn(`Discarding candidate: ${luckCheck.reason}`, { coreAlg: finalCoreAlg, rotation: fullRotation, trueClaimedCorners });
        }
        continue;
      }
      const tppScore = pathCostFor(ctx, finalCoreAlg) / p.pieces;

      const displayCorners = isRoot
        ? trueClaimedCorners
        : allCorners.filter(c => !ctx.currentCorners.includes(c));
      const displayEdges = isRoot
        ? relabelSlotsForRotation(newEdges, yToken)
        : p.targetEdges.filter(e => !ctx.currentEdges.includes(e));

      const candidate = {
        color: isRoot ? color : ctx.firstColor,
        type: edgeTypeLabel(pairCount, isRoot, isPseudo),
        rotation: fullRotation,
        edges: displayEdges,
        corners: displayCorners,
        coreAlg: finalCoreAlg,
        tpp: Number.isFinite(tppScore) ? tppScore : Infinity,
        targetNodeId: reachedNodeId,
      };
      if (p.fullPseudoOnly) candidate.fullPseudoOnly = true;
      const look = lookCost(luckCheck.facelets);
      push(candidate, look);

      const nodeByRotation = new Map();
      const nodeAfter = (rot) => {
        let nodeId = nodeByRotation.get(rot);
        if (nodeId === undefined) {
          const after = solvedFlags(replayFacelets(ctx.scramble, fullRotation, ctx.scoredPath, `${finalCoreAlg} ${rot}`));
          const pairs = F2L_SLOTS.filter(sl => after[sl]);
          nodeId = after.cross ? ctxNodeByLabels(ctx, pairs) : null;
          nodeByRotation.set(rot, nodeId);
        }
        return nodeId;
      };

      if (ctx.proMoves && !isPseudo && typeof rotationSpellingParts === 'function'
        && !finalCoreAlg.split(' ').some(t => /^[xyz]/.test(t))) {
        for (const { alg: spelling, rotation: rot } of rotationSpellingParts(finalCoreAlg, !isRoot)) {
          if (rotationFirst(spelling) !== spelling) continue; // its leading spelling is generated too
          const nodeId = nodeAfter(rot);
          if (!nodeId) continue;
          const spTpp = pathCostFor(ctx, spelling)
            / p.pieces;
          push({ ...candidate, coreAlg: spelling, tpp: Number.isFinite(spTpp) ? spTpp : Infinity, targetNodeId: nodeId }, look);
        }
      }

      if (!isRoot && wideOn && typeof wideSpellingParts === 'function') {
        for (const { alg: spelling, rotation: rot } of wideSpellingParts(finalCoreAlg)) {
          let nodeId;
          if (!isPseudo) nodeId = nodeAfter(rot);
          else if (!rot) nodeId = reachedNodeId;
          else {
            const after = isRoot ? candidate.corners : allCorners;
            const afterEdges = isRoot ? candidate.edges : allEdges;
            nodeId = ctxNodeByPieces(ctx, relabelSlotsForRotation(after, rot), relabelSlotsForRotation(afterEdges, rot));
          }
          if (!nodeId) continue;
          const wTpp = pathCostFor(ctx, spelling) / p.pieces;
          push({ ...candidate, coreAlg: spelling, tpp: Number.isFinite(wTpp) ? wTpp : Infinity, targetNodeId: nodeId }, look);
        }
      }

      if (isRoot && wideOn && ctx.proMoves && !isPseudo && typeof inspectionWideVariants === 'function') {
        for (const v of inspectionWideVariants(finalCoreAlg)) {
          const vTpp = pathCostFor(ctx, v.alg) / p.pieces;
          push({
            ...candidate,
            rotation: rotationName(`${fullRotation} ${v.inspection}`),
            coreAlg: v.alg,
            tpp: Number.isFinite(vTpp) ? vTpp : Infinity,
          }, look);
        }
      }
    }
  }
  return candidates;
}

async function postProcessComplete(ctx, p, cores, live = null) {
  const { isRoot } = ctx;
  const base = isRoot ? p.baseRotation : ctx.rotation;
  const weights = ctx.lookWeights;
  const lookFeatures = [0, 0, 0, 0, 0];
  const lookCost = (facelets, solved = null) => {
    if (!weights || !facelets) return 0;
    pairLookFeatures(facelets, lookFeatures, solved);
    let x = 0;
    for (let k = 0; k < weights.length; k++) x += weights[k] * lookFeatures[k];
    return x;
  };
  const sols = [];
  const seen = new Set();
  // seedOnly (completeSeedLimits): only the plain spellings of the
  // solutions that look best, scored exactly, as real candidates
  if (p.seedOnly) {
    const keyed = [];
    const estimate = SPELLING.plainEstimator(isRoot, ctx.scoring);
    for (const core of cores || []) if (core && !seen.has(core)) { seen.add(core); keyed.push([estimate(core.split(' ')), core]); }
    keyed.sort((x, y) => x[0] - y[0]);
    cores = keyed.slice(0, 4 * p.topN).map(x => x[1]);
    seen.clear();
  }
  const claimSets = { corners: new Set(p.allCorners || []), edges: new Set(p.allEdges || p.allCorners || []) };
  const TID = SPELLING.tables().TID;
  const startCodes = Uint16Array.from(replayFacelets(ctx.scramble, base, ctx.scoredPath, ''), ch => ch.charCodeAt(0));
  for (const core of cores || []) {
    if (!core || seen.has(core)) continue;
    seen.add(core);
    const parts = core.split(' ');
    const face = new Int8Array(parts.length);
    for (let k = 0; k < parts.length; k++) face[k] = TID.get(parts[k]);
    const check = checkFacelets(replayTokenIds(startCodes, face), p.allCorners, p.allEdges, claimSets);
    if (!check.ok) {
      if (check.reason.includes('claimed solved but is not actually solved')) {
        console.warn(`Discarding solution: ${check.reason}`, { coreAlg: core, rotation: base });
      }
      continue;
    }
    const sol = { face, core, look: lookCost(check.facelets, check.flags) };
    if (ctx.planWeights) {
      const f = planFeaturesY(check.facelets, planYScratch, check.flags);
      const w = ctx.planWeights;
      const by = [0, 0, 0, 0];
      let least = Infinity;
      for (let r = 0; r < 4; r++) {
        let v = sol.look;
        for (let k = 0; k < w.length; k++) v += w[k] * f[4 * r + k];
        by[r] = v;
        if (v < least) least = v;
      }
      sol.lookByEnd = by;
      sol.look = least;
    }
    sols.push(sol);
  }
  pathCostFor(ctx, ''); // the committed path's MCC checkpoint and penalties
  const floor = SPELLING.mccFloor(ctx._costBase.mcc) + ctx._costBase.penalty;
  const tables = SPELLING.tables();
  const reached = new Map();
  const nodeAfter = (sol, endName) => {
    const key = `${sol.core}|${endName}`;
    let id = reached.get(key);
    if (id === undefined) {
      const after = solvedFlags(replayFacelets(ctx.scramble, base, ctx.scoredPath, [sol.core, endName].filter(Boolean).join(' ')));
      id = after.cross ? ctxNodeByLabels(ctx, F2L_SLOTS.filter(sl => after[sl])) : null;
      reached.set(key, id);
    }
    return id;
  };
  const type = edgeTypeLabel(p.pairCount, isRoot, false);
  const multislot = !isRoot && p.pairCount > 1;
  const finish = (c) => {
    if (!isRoot && isUnorthodox(c.coreAlg)) c.unorthodox = true;
    if (multislot) c.multislot = true;
    if (p.fullPseudoOnly) c.fullPseudoOnly = true;
    c.key = dedupeKey(c);
    return c;
  };
  const make = (alg, lead, end, sol, tpp) => {
    if (hasWideB(alg)) return null;
    const endName = tables.ROT_NAME[end];
    const targetNodeId = nodeAfter(sol, endName);
    if (!targetNodeId) return null;
    let rotation = ctx.rotation;
    let corners;
    let edges;
    if (isRoot) {
      const leadName = tables.ROT_NAME[lead];
      if (tables.YF[lead]) {
        rotation = composeRotations(base, leadName);
        corners = relabelSlotsForRotation(p.allCorners, leadName);
        edges = relabelSlotsForRotation(p.newEdges, leadName);
      } else {
        rotation = rotationName(`${base} ${leadName}`.trim());
        corners = relabelSlotsForRotation(p.allCorners, endName);
        edges = relabelSlotsForRotation(p.newEdges, endName);
      }
    } else {
      corners = p.allCorners.filter(c => !ctx.currentCorners.includes(c));
      edges = p.targetEdges.filter(e => !ctx.currentEdges.includes(e));
    }
    return finish({
      color: isRoot ? p.color : ctx.firstColor,
      type,
      rotation,
      edges,
      corners,
      coreAlg: alg,
      tpp: Number.isFinite(tpp) ? tpp : Infinity,
      targetNodeId,
    });
  };
  // Corpus algs (later steps), scored as written: they may rotate twice.
  const extra = [];
  for (const alg of p.corpus || []) {
    const stepRotation = netRotation(alg);
    const check = checkCandidateAgainstRealCubeState(ctx.scramble, base, ctx.scoredPath,
      stepRotation ? `${alg} ${inverseRotation(stepRotation)}` : alg, p.allCorners, p.allEdges);
    if (!check.ok || hasWideB(alg) || (!ctx.wideMoves && isWideAlg(alg))) continue;
    const held = replayFacelets(ctx.scramble, base, ctx.scoredPath, alg);
    const after = solvedFlags(held);
    const targetNodeId = after.cross ? ctxNodeByLabels(ctx, F2L_SLOTS.filter(sl => after[sl])) : null;
    if (!targetNodeId) continue;
    const tpp = (pathCostFor(ctx, alg) + lookCost(check.facelets) + planCost(ctx.planWeights, held)) / p.pieces;
    extra.push(finish({
      color: ctx.firstColor,
      type,
      rotation: ctx.rotation,
      edges: p.targetEdges.filter(e => !ctx.currentEdges.includes(e)),
      corners: p.allCorners.filter(c => !ctx.currentCorners.includes(c)),
      coreAlg: alg,
      tpp: Number.isFinite(tpp) ? tpp : Infinity,
      targetNodeId,
    }));
  }
  const wide = p.wideMoves !== false;
  const spec = {
    sols,
    root: isRoot,
    pieces: p.pieces,
    floor,
    costOf: alg => pathCostFor(ctx, alg),
    mccOf: alg => stepsPathMcc(ctx, ctx.stepAlgs, alg),
    scoring: ctx.scoring,
    views: p.views || RESULT_VIEWS,
    size: p.topN,
    initial: p.limits,
    make,
    extra,
    maxRL: wide ? undefined : 0,
    maxUDF: wide ? undefined : 0,
    exact: p.pairCount > 0, // first steps: crosses walk cheaply (spelling-search.js)
    seedOnly: !!p.seedOnly,
  };
  // live (a worker pool's job): limits from the other running jobs of the
  // step type, taken about every LIVE_PAUSE_MS (searchCurrentNode's liveHooks)
  const { list } = live && !p.seedOnly
    ? await SPELLING.topSpellingsLive({ ...spec, live, pauseMs: LIVE_PAUSE_MS })
    : SPELLING.topSpellings(spec);
  for (const c of list) delete c.key;
  return list;
}

// How often a pool job exchanges limits with the other jobs of its type,
// and how long the page gathers reports before answering them.
const LIVE_PAUSE_MS = 100;
const LIVE_BROADCAST_MS = 30;

// A candidate's identity for deduplication, cached per candidate object
// (partial result lists rank the same candidates repeatedly).
const dedupeKeys = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
function dedupeKey(c) {
  let key = dedupeKeys && dedupeKeys.get(c);
  if (key === undefined) {
    const normalize = typeof commuteNormalize === 'function' ? commuteNormalize : (x => x);
    key = `${c.targetNodeId}|${c.rotation}|${normalize(c.coreAlg)}`;
    if (dedupeKeys) dedupeKeys.set(c, key);
  }
  return key;
}

// Minimum time between two partial result lists of one search.
const PARTIAL_INTERVAL_MS = 350;

function rankCandidates(calls) {
  const candidates = [];
  for (const p of calls) for (const c of p.candidates || []) candidates.push(c);
  candidates.sort((a, b) => a.tpp - b.tpp);
  const seenCandidates = new Set();
  return dedupeSolutions(candidates.filter(c => {
    const key = dedupeKey(c);
    if (seenCandidates.has(key)) return false;
    seenCandidates.add(key);
    return true;
  }));
}

function dedupeSolutions(list) {
  const seen = new Set();
  const out = list.filter((c) => {
    if (hasWideB(c.coreAlg)) return false;
    const key = `${c.rotation || ''}|${c.coreAlg}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (out.length === list.length) return list;
  for (const k of ['truncatedCalls', 'failedCalls', 'lookaheadTruncated', 'lookaheadPending', 'hiddenCount']) if (list[k]) out[k] = list[k];
  return out;
}

function mergeRanked(a, b) {
  if (!b || !b.length) return a;
  const out = dedupeSolutions(a.concat(b).sort((x, y) => x.tpp - y.tpp));
  const merged = out === a ? a.slice() : out;
  for (const k of ['truncatedCalls', 'failedCalls', 'onlyMultislotPending']) if (a[k]) merged[k] = a[k];
  return merged;
}

// Depths 4 and 5 were removed: no use for finding a human solution.
const LOOKAHEAD_MAX_DEPTH = 3;
// the look-ahead starts with this many candidates and grows from there
const DEFAULT_LOOKAHEAD_BREADTH = 3;
// Below the first look-ahead level only the best few continuations of each
// node are followed, or depth 3 would need breadth^2 searches.
const LOOKAHEAD_INNER_BREADTH = 2;
const SEARCH_MEMO_LIMIT = 200;
const SEARCH_MEMO_CANDIDATES = 1000000;
function trimSearchMemo(memo) {
  let held = 0;
  for (const p of memo.values()) held += p.size || 0;
  while (memo.size > 1 && (memo.size > SEARCH_MEMO_LIMIT || held > SEARCH_MEMO_CANDIDATES)) {
    const oldest = memo.keys().next().value;
    held -= memo.get(oldest).size || 0;
    memo.delete(oldest);
  }
}

// memoSearch's key: the node, the committed steps and the search options.
function searchMemoKey(session) {
  return `${session.currentNodeId}|${session.rotation}|${session.stepAlgs.join(' | ')}|${session.searchSettingsKey || ''}`;
}

function wideTwin(session) {
  const memo = session.searchMemo;
  if (!memo) return null;
  const twin = session.withSettings({ wideMoves: session.wideMoves === false });
  const hit = memo.get(searchMemoKey(twin));
  return hit ? { promise: hit, value: hit.value } : null;
}

// Who still wants a search: each caller's isCancelled (none = always).
const ALWAYS_WANTED = null;
function memoSearch(session, helper, onStatus, pseudoHelper, deadline, onPartial, isCancelled = ALWAYS_WANTED) {
  const memo = session.searchMemo || (session.searchMemo = new Map());
  const key = searchMemoKey(session);
  // a search stopped for want of callers is never reused
  if (memo.has(key) && memo.get(key).stopped) memo.delete(key);
  if (memo.has(key)) {
    const hit = memo.get(key);
    if (hit.interest) hit.interest.add(isCancelled);
    memo.delete(key); // refresh its place in the eviction order
    memo.set(key, hit);
    if (onPartial && hit.listeners) {
      hit.listeners.add(onPartial);
      if (hit.latest) onPartial(hit.latest);
    }
    return hit;
  }
  const listeners = new Set(onPartial ? [onPartial] : []);
  const interest = new Set([isCancelled]);
  const stop = {
    shouldStop: () => [...interest].every(f => f && f()),
    onStopped: () => { if (promise) promise.stopped = true; },
  };
  let promise;
  const twin = deadline ? null : wideTwin(session);
  let base = null; // the finished list without wide moves, merged into every list
  const emit = (list) => {
    const shown = base ? mergeRanked(list, base) : list;
    promise.latest = shown;
    for (const f of listeners) f(shown);
  };
  emit.wanted = () => listeners.size > 0;
  if (twin && session.wideMoves === false) {
    const hide = list => filterResults(list, c => !isWideAlg(c.coreAlg));
    if (twin.promise.listeners && onPartial) twin.promise.listeners.add(list => { if (promise.listeners) emit(hide(list)); });
    promise = twin.promise.then(hide);
    if (twin.promise.latest) Promise.resolve().then(() => { if (promise.listeners) emit(hide(twin.promise.latest)); });
  } else {
    if (twin && twin.value && !twin.value.truncatedCalls && !twin.value.failedCalls) base = twin.value;
    promise = searchCurrentNode(session, helper, onStatus, pseudoHelper, deadline, emit, stop);
    if (base) {
      promise = promise.then(list => mergeRanked(list, base));
      emit([]);
    }
  }
  promise.listeners = listeners;
  promise.interest = interest;
  memo.set(key, promise);
  // A search the time budget cut short is not reused (committing that step
  // later searches it again in full); neither is a failed one.
  const settle = () => { promise.listeners = null; promise.latest = null; promise.interest = null; };
  promise.then((r) => {
    settle();
    if ((r.truncatedCalls || r.failedCalls) && memo.get(key) === promise) memo.delete(key);
    promise.size = r.length;
    promise.value = r;
    trimSearchMemo(memo);
  }, () => { settle(); if (memo.get(key) === promise) memo.delete(key); });
  trimSearchMemo(memo);
  return promise;
}

function lookaheadFork(session, candidate, i) {
  const s = session.fork(candidate);
  s.lookaheadRank = [...(session.lookaheadRank || []), i];
  return s;
}

function filterResults(results, filter, countHidden = false) {
  if (!filter) return results;
  const out = results.filter(filter);
  for (const k of ['truncatedCalls', 'failedCalls', 'onlyMultislotPending']) if (results[k]) out[k] = results[k];
  if (countHidden && out.length < results.length) out.hiddenCount = results.length - out.length;
  return out;
}

async function bestContinuation(session, levels, helper, onStatus, pseudoHelper, deadline, filter = null, isCancelled = null) {
  if (session.isComplete) return null;
  if (isCancelled && isCancelled()) return { tpp: Infinity, algs: [], cancelled: true };
  const results = filterResults(await memoSearch(session, helper, onStatus, pseudoHelper, deadline, undefined, isCancelled || ALWAYS_WANTED), filter);
  const cut = !!results.truncatedCalls;
  if (!results.length) return { tpp: Infinity, algs: [], truncated: cut };
  if (levels <= 1) return { tpp: results[0].tpp, algs: [results[0].coreAlg], truncated: cut };
  // Explored in parallel (an engine pool runs their searches side by side),
  // compared in rank order so ties resolve exactly as a sequential loop would.
  const top = results.slice(0, LOOKAHEAD_INNER_BREADTH);
  const subs = await Promise.all(top.map((c, i) => bestContinuation(lookaheadFork(session, c, i), levels - 1, helper, onStatus, pseudoHelper, deadline, filter, isCancelled)));
  let best = null;
  top.forEach((c, i) => {
    const sub = subs[i];
    const tpp = sub ? sub.tpp : c.tpp; // null: c completes Cross+F2L
    if (!best || tpp < best.tpp) best = { tpp, algs: [c.coreAlg, ...(sub ? sub.algs : [])] };
  });
  best.truncated = cut || subs.some(sub => sub && sub.truncated);
  return best;
}

async function searchWithLookahead(session, helper, onStatus, pseudoHelper, options = {}) {
  // Results-page search options (multislot, wideMoves, planning) for this
  // step and its look-ahead; unset ones keep the session's.
  if (options.multislot !== undefined || options.wideMoves !== undefined || options.planning !== undefined) {
    session = session.withSettings({ multislot: options.multislot, wideMoves: options.wideMoves, planning: options.planning });
  }
  const depth = Math.max(1, Math.min(LOOKAHEAD_MAX_DEPTH, options.depth || 1));
  const breadth = Math.max(1, options.breadth || DEFAULT_LOOKAHEAD_BREADTH);
  const filter = options.filter || null;
  const onUpdate = typeof options.onUpdate === 'function' ? options.onUpdate : null;
  // One time budget for the whole step: its own search first, then the
  // follow-up searches until the end of the engine share.
  const start = Date.now();
  const firstDeadline = budgetDeadline(session, depth > 1 ? LOOKAHEAD_FIRST_SHARE : SEARCH_ENGINE_SHARE, start);
  const lookDeadline = budgetDeadline(session, SEARCH_ENGINE_SHARE, start);
  const onPartial = onUpdate && ((list) => {
    const shown = filterResults(list, filter, true);
    // the look-ahead still has to run on a step's own final list
    if (depth > 1 && shown.onlyMultislotPending) {
      const copy = shown.slice();
      for (const k of ['truncatedCalls', 'failedCalls', 'hiddenCount']) if (shown[k]) copy[k] = shown[k];
      onUpdate(copy);
    } else onUpdate(shown);
  });
  // a caller may hand over the step's own list (a later round of a growing look-ahead)
  const results = options.stepResults || filterResults(await memoSearch(session, helper, onStatus, pseudoHelper, firstDeadline, onPartial, options.isCancelled || ALWAYS_WANTED), filter, true);
  if (depth === 1 || !results.length) return results;

  const known = options.bests || null;
  const grow = typeof options.grow === 'function' ? options.grow : null;
  const keyOf = c => `${c.rotation || ''}|${c.coreAlg}|${c.targetNodeId}`;
  const bests = [];
  let next = 0; // candidates [0, next) are looked at (or being looked at)
  const planned = Math.min(breadth, results.length); // the first ones, pending from the start
  const rerank = (final) => {
    const done = [];
    const pending = [];
    const upto = Math.max(next, planned);
    results.slice(0, upto).forEach((cand, i) => {
      // a growing candidate still being looked at keeps its place below
      if (bests[i] === undefined) { if (i < breadth) pending.push({ ...cand, lookaheadPending: true }); return; }
      done.push({
        ...cand,
        lookaheadTpp: bests[i] ? bests[i].tpp : cand.tpp,
        lookaheadAlgs: bests[i] ? bests[i].algs : [],
        // The time budget cut a follow-up search short: the best sequence is
        // the best one found in time, not necessarily the best one there is.
        ...(bests[i] && bests[i].truncated ? { lookaheadTruncated: true } : {}),
      });
    });
    done.sort((a, b) => a.lookaheadTpp - b.lookaheadTpp); // stable: ties keep single-step order
    const rest = results.slice(0, upto).filter((c, i) => bests[i] === undefined && i >= breadth).concat(results.slice(upto));
    const out = done.concat(pending, rest);
    if (results.hiddenCount) out.hiddenCount = results.hiddenCount;
    if (results.truncatedCalls) out.truncatedCalls = results.truncatedCalls;
    if (results.failedCalls) out.failedCalls = results.failedCalls;
    if (done.some(r => r.lookaheadTruncated)) out.lookaheadTruncated = true;
    if (!final) out.lookaheadPending = pending.length;
    out.lookaheadCount = done.length;
    if (upto < results.length) out.lookaheadMore = true;
    // the step's own list, for a later round (not enumerable: copies leave it)
    Object.defineProperty(out, 'stepResults', { value: results, enumerable: false });
    return out;
  };
  const follow = options.lookaheadMultislot === undefined ? session : session.withSettings({ multislot: options.lookaheadMultislot });
  const cancelled = () => !!(options.isCancelled && options.isCancelled());
  const look = (i) => {
    const cand = results[i];
    const k = keyOf(cand);
    if (known && known.has(k)) { bests[i] = known.get(k); return Promise.resolve(); }
    const status = onStatus && (msg => onStatus(`look-ahead ${i + 1} (depth ${depth}): ${msg}`));
    return bestContinuation(lookaheadFork(follow, cand, i), depth - 1, helper, status, pseudoHelper, lookDeadline, filter, options.isCancelled || null)
      .then((best) => {
        bests[i] = best;
        if (known && best && !best.cancelled) known.set(k, best);
        if (onUpdate) onUpdate(rerank(false));
      });
  };
  // the step's list first, its first candidates pending: a caller that is
  // done with the step once it has the list starts no follow-up search
  if (onUpdate) onUpdate(rerank(false));
  await new Promise((resolve, reject) => {
    let running = 0;
    const pump = () => {
      // (a candidate an earlier round looked at costs nothing: always taken)
      while (next < results.length && !cancelled()
        && (next < breadth || (known && known.has(keyOf(results[next]))) || (grow && running < LOOKAHEAD_GROW_PARALLEL && grow()))) {
        const i = next++;
        running++;
        look(i).then(() => { running--; pump(); }, reject);
      }
      if (!running) resolve();
    };
    pump();
  });
  return rerank(true);
}
// look-aheads of growing candidates run side by side (an engine pool serves them by rank)
const LOOKAHEAD_GROW_PARALLEL = 2;

function rootTargetByLabels(session, corners, edges) {
  if (!session._rootTargetsByLabels) {
    const map = new Map();
    for (const e of session.tree.edges) {
      if (e.source !== session.rootId) continue;
      const st = session.nodeMap.get(e.target).state;
      const key = JSON.stringify([(st.corners || []).slice().sort(), (st.edges || []).slice().sort()]);
      if (!map.has(key)) map.set(key, e.target);
    }
    session._rootTargetsByLabels = map;
  }
  return session._rootTargetsByLabels.get(JSON.stringify([corners.slice().sort(), edges.slice().sort()])) || null;
}

function edgeTypeLabel(pairCount, isRoot, isPseudo) {
  const base = isRoot
    ? (['Cross', 'XCross', 'XXCross', 'XXXCross'][pairCount] || `${pairCount}-pair`)
    : (pairCount === 1 ? 'Single pair' : 'Multislot');
  return isPseudo ? `${base} (pseudo)` : base;
}

function edgeLabel(pairCount, isRoot, isPseudo) {
  return edgeTypeLabel(pairCount, isRoot, isPseudo);
}

function solutionLines(session) {
  const ordinal = n => ['1st', '2nd', '3rd', '4th'][n - 1] || `${n}th`;
  const lines = session.rotation ? [`${session.rotation} // inspection`] : [];
  const labels = [];
  let pairs = 0;
  session.committedRows.forEach((row, i) => {
    const before = pairs;
    const node = session.nodeMap.get(row.targetNodeId);
    pairs = node ? (node.state.corners || []).length : before + (row.corners || []).length;
    const pseudo = /pseudo/i.test(row.type || '');
    let label;
    if (i === 0) label = ['cross', 'xcross', 'xxcross', 'xxxcross'][pairs] || `cross + ${pairs} pairs`;
    else if (pairs - before <= 1) label = `${ordinal(pairs)} pair`;
    else label = `${ordinal(before + 1)}/${ordinal(pairs)} pairs`;
    if (pseudo) label += ' (pseudo)';
    labels.push(label);
  });
  // Turns that cancel across a step boundary are written once ("R" then
  // "R U' R'" is "R2", then "U' R'"); the step whose end changed says so.
  const steps = cancelledSteps(session.committedRows.map(row => row.coreAlg || ''));
  steps.forEach((step, i) => {
    const label = step.cancelsWith >= 0 ? `${labels[i]} (cancels with ${labels[step.cancelsWith]})` : labels[i];
    if (step.alg) lines.push(`${step.alg} // ${label}`);
  });
  return lines;
}

const CANCEL_QUARTERS = { '': 1, '2': 2, "2'": 2, "'": 3 };
const CANCEL_SUFFIX = ['', '', '2', "'"];

function cancelParts(tok) {
  const m = /^([URFDLBurfdlbMESxyz])(2'|2|'|)$/.exec(tok || '');
  return m ? [m[1], CANCEL_QUARTERS[m[2]]] : null;
}

function cancelBoundary(prev, next) {
  const a = prev.slice();
  let used = 0;
  let combined = '';
  while (a.length && used < next.length) {
    const x = cancelParts(a[a.length - 1]);
    const y = cancelParts(next[used]);
    if (!x || !y || x[0] !== y[0]) break;
    used++;
    a.pop();
    const q = (x[1] + y[1]) % 4;
    if (q) { combined = x[0] + CANCEL_SUFFIX[q]; break; }
  }
  const removed = prev.length - a.length;
  if (combined) a.push(combined);
  return { prev: a, next: next.slice(used), merged: used > 0, used, removed, combined };
}

function cancelledSteps(algs) {
  const toks = algs.map(a => String(a || '').split(/\s+/).filter(Boolean));
  const out = toks.map(() => ({ alg: '', cancelsWith: -1 }));
  let prev = -1;
  for (let j = 0; j < toks.length; j++) {
    if (prev >= 0) {
      const c = cancelBoundary(toks[prev], toks[j]);
      if (c.merged) {
        toks[prev] = c.prev;
        toks[j] = c.next;
        out[prev].cancelsWith = j;
      }
    }
    if (toks[j].length) prev = j;
  }
  toks.forEach((t, i) => { out[i].alg = t.join(' '); });
  return out;
}

function candidateCancellation(stepAlgs, alg) {
  const steps = cancelledSteps(stepAlgs);
  let prevAlg = '';
  for (let i = steps.length - 1; i >= 0 && !prevAlg; i--) prevAlg = steps[i].alg;
  const prev = prevAlg.split(' ').filter(Boolean);
  const next = String(alg || '').split(' ').filter(Boolean);
  const c = cancelBoundary(prev, next);
  if (!c.merged) return null;
  return {
    cancelled: next.slice(0, c.used).join(' '),
    rest: c.next.join(' '),
    before: prev.slice(prev.length - c.removed).join(' '),
    after: c.combined,
  };
}

function moveCounts(session) {
  let stm = 0;
  let etm = 0;
  for (const step of cancelledSteps(session.committedRows.map(row => row.coreAlg || ''))) {
    for (const tok of step.alg.split(/\s+/)) {
      if (!tok) continue;
      etm++;
      if (!/^[xyz]/.test(tok)) stm++;
    }
  }
  return { stm, etm, text: `${stm}STM / ${etm}ETM` };
}

function solutionText(session) {
  return [session.scramble, ...solutionLines(session)].join('\n');
}

function cubedbUrl(scramble, lines) {
  const enc = s => encodeURIComponent(String(s).replace(/'/g, '-').replace(/ /g, '_'));
  return `https://cubedb.net/?puzzle=3x3&scramble=${enc(cleanAlgText(scramble))}&alg=${enc(lines.map(cleanAlgText).join('\n'))}`;
}

function cleanAlgText(s) {
  return String(s).trim().replace(/[ \t]+/g, ' ');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SolveSession, searchCurrentNode, SLOT_INDICES, COLOR_ROTATIONS,
    DISTANCE1_LIMITS, LATER_LIMITS_BY_TOTAL, searchLimitFor, maxSolutionsFor, categoryFor,
    stripLeadingRotation, composeRotations, checkCandidateAgainstRealCubeState,
    relabelSlotsForRotation, CORNER_CYCLE, alignPseudoAlg, replayFacelets, rootTargetByLabels, POSTALG_BOUNDARY,
    proEngineOptions, nodeByLabels, NOOP_MOVES,
    memoSearch, searchWithLookahead, filterResults, SEARCH_MEMO_LIMIT, SEARCH_MEMO_CANDIDATES, rankCandidates, LOOKAHEAD_MAX_DEPTH, DEFAULT_LOOKAHEAD_BREADTH, LOOKAHEAD_INNER_BREADTH,
    postProcessCall, postProcessContext, stepsPathCost, lookaheadFork,
    isWideAlg, hasWideB, isUnorthodox, withoutWide, dedupeSolutions, mergeRanked, searchMemoKey, splitByFirstMove,
    SEARCH_ENGINE_SHARE, LOOKAHEAD_FIRST_SHARE, budgetDeadline, callCostRank, MOVE_RESTRICT, PRO_MOVE_RESTRICT,
    solutionLines, solutionText, moveCounts, cubedbUrl, corpusSolutions,
    cancelBoundary, cancelledSteps, candidateCancellation,
    lookWeightsFor, planCost, edgeTypeLabel, F2L_SLOTS,
  };
}
