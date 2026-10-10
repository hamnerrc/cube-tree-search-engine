/**
 * solver-bridge.js — the browser-side multi-step DAG traversal loop.
 *
 * Wires together the pruned DAG (localStorage, from script.js's pruneGraph),
 * the crossSolver persistent worker (CrossSolverHelper), and the existing
 * scoring utilities in script.js (algSpeed, calculateSolvedPieces, altAlgs,
 * isPseudoState) into the interactive loop described in README.md: search
 * the current node -> rank by TPP -> user clicks a result -> commit it and
 * search again from the new node.
 *
 * Architecture notes (verified empirically — see PROJECT_STATUS.md §4.7 and
 * the "color/rotation" and "later-step preservation" findings):
 *
 * - A whole-cube rotation MUST be passed via the solver's dedicated
 *   `rotation` option on every call, never embedded as a literal move in
 *   the `scramble` string — embedding it there silently corrupts parsing.
 *   The `rotation` option composes correctly across multiple tokens
 *   ('z2 y2'), so one cumulative rotation string, fixed once at the first
 *   step, is reused for every subsequent call in the same path.
 * - A solved solution string always starts with the `rotation` text that
 *   was passed in (not just the first time) — strip it to get the core
 *   algorithm.
 * - A later-step search MUST include every already-solved slot in its own
 *   goal (use the solver class whose arity equals the TOTAL pairs needed,
 *   not just the newly-targeted ones), or it silently disturbs
 *   already-committed pairs about half the time.
 * - CRITICAL (found 2026-10-04, see dev note in PROJECT_STATUS.md's
 *   quick-orientation block): a later-step search must NEVER paste the
 *   committed path-so-far (`session.scoredPath`) into a fresh `scramble`
 *   string. That text is already expressed in the ROTATED frame the
 *   engine returned it in (previous bullet); pasting it into `scramble`
 *   and passing `rotation` again relabels it a SECOND time, searching a
 *   bogus state. Verified with a real cube simulator: this silently broke
 *   even the already-solved cross by the second committed step, on every
 *   path whose rotation was non-empty (i.e. every color except yellow).
 *   Fix: pass it via the engine's own `postAlg` option instead (applied
 *   directly in the already-rotated frame, no relabeling) — then strip the
 *   known `rotation + ' ' + postAlg` prefix, not just `rotation`, from the
 *   returned solution.
 * - A cross-solved (later-step) DAG node's outgoing edges include
 *   duplicates: tree_gen.py explores a mid-solve y/y' setup rotation at
 *   every cross-solved node, not just the root, producing multiple edges
 *   per node that differ only in that internal tag while landing on a
 *   target with identical solved corners/edges (the only thing dispatch
 *   here cares about). Collapse them by target solved-state before
 *   searching, or every later-step action gets searched/shown 2-3x over.
 * - CRITICAL (found 2026-10-04 while verifying luck filtering against the
 *   real solver — see PROJECT_STATUS.md §4.12): that same mid-solve y/y'
 *   exploration can ALSO produce a later-step target whose solved
 *   corners/edges are NOT a superset of the current node's — a committed
 *   slot's label gets renamed by the relabeling instead of carried forward
 *   under its real name. Dispatch has no mechanism to apply that implied
 *   second rotation (`session.rotation` is fixed once at the root), so
 *   taking such an edge at face value silently asks the solver to protect
 *   the wrong slot — verified directly: 26 of 86 otherwise-normal-looking
 *   "Single pair" candidates disturbed an already-committed pair 100% of
 *   the time, with no error. Any later-step edge whose target drops a
 *   committed label is filtered out before searching (see the `!isRoot`
 *   block below) — it is not a safe transition from the session's actual
 *   frame.
 * - Pseudo (mismatched) edges are dispatched to pseudoCrossSolver when a
 *   pseudo helper is supplied (and skipped otherwise, or for >3 pairs). That
 *   engine only guarantees "solved up to one free trailing D turn", so its
 *   results go through alignPseudoAlg; see PROJECT_STATUS.md §4.14.
 * - Luck filtering (README "Luck filtering") IS implemented here, as of
 *   2026-10-04 — see PROJECT_STATUS.md §4.3/§4.9/§4.12. A solver-probe
 *   approach was attempted first and reverted (§4.9): the "0 onProgress
 *   events = already solved" signal this file's other verified findings
 *   rely on is ambiguous whenever a probe's maxLength is smaller than the
 *   TRUE solution depth, making that approach produce false positives on
 *   real scrambles. The real fix is a real cube-state check:
 *   `checkCandidateAgainstRealCubeState` replays the literal move sequence
 *   [scramble, rotation, priorPath, coreAlg] (the same order this file's
 *   own header comment and PROJECT_STATUS.md §4.10 already established is
 *   the correct physical replay of a committed path) through facelet-cube.js
 *   — a plain-JS facelet simulator cross-verified bit-for-bit against the
 *   `magiccube` Python package, see test/facelet-cube.test.js — and checks
 *   the resulting real cube state with facelet-flags.js (a JS port of
 *   archived_attempts/try_1/utils/CFOPflags.py's facelet-mask slot check)
 *   against exactly what the candidate's DAG edge claims to solve. A
 *   candidate that solves anything beyond its claim (lucky) is discarded,
 *   per spec, in favor of it showing up under the matching higher-arity
 *   edge instead; a candidate that fails to solve what it claims (which
 *   would be a solver/DAG bug, not luck) is also discarded, with a console
 *   warning, since no result that doesn't actually solve what it claims
 *   should ever be shown. facelet-cube.js and facelet-flags.js must be
 *   loaded as bare globals (plain <script> tags, before this file, same as
 *   script.js's algSpeed/isPseudoState/altAlgs) in the browser; Node tests
 *   require() them and assign onto `global`, same pattern as script.js.
 * - Cross optimisation (README "Wide moves and Cross optimisation") IS
 *   implemented, as of 2026-10-04 — see PROJECT_STATUS.md §4.5/§4.13 and
 *   cross-optimization.js's own header comment for the derivation. Gated
 *   by `session.crossOptEnabled` (set from the `cross_opt` advanced-option
 *   checkbox), it only applies to root, Cross-only (`pairCount === 0`)
 *   candidates, generating its own additional candidates alongside (not
 *   instead of) the normal ones. Its results contain wide moves and end with
 *   the cube rotated; the candidate's `rotation` stays the inspection
 *   rotation and every later engine call uses SolveSession.engineFrame,
 *   which converts the committed text into {net rotation, face turns}
 *   (§4.19 -- composing the residual into `rotation` as well used to apply
 *   it twice, and the old "d" notation was physically wrong).
 */
'use strict';

const SLOT_INDICES = { BL: 0, BR: 1, FR: 2, FL: 3 };

// spelling-search.js: a page global; Node scripts get it here.
const SPELLING = typeof SpellingSearch !== 'undefined' ? SpellingSearch
  : (typeof require === 'function' ? require('./spelling-search.js').SpellingSearch : null);

// Which rotation brings each color to the bottom (D) face, given the
// README's stated convention (White=U, Green=F -> Yellow=D, Blue=B, Red=R,
// Orange=L by the standard color wheel). Verified empirically against
// solver.wasm — see crossSolver/test/color-orientation.test.js.
const COLOR_ROTATIONS = {
  white: 'z2',
  yellow: '',
  green: "x'",
  blue: 'x',
  red: 'z',
  orange: "z'",
};

const MOVE_RESTRICT = 'U_U2_U-_D_D2_D-_L_L2_L-_R_R2_R-_F_F2_F-_B_B2_B-';

// "pro move set" advanced option (pro_references.txt, PROJECT_STATUS.md
// §4.20): wide r/l and ONE mid-step y/y'/x/x' (never y2, README) on top of
// the face turns, for matched searches. The engine then needs every final
// centre orientation that keeps the cross colour on D.
const PRO_MOVE_RESTRICT = `${MOVE_RESTRICT}_r_r2_r-_l_l2_l-_y_y-_x_x-`;
const ENGINE_CENTER_OFFSETS = ['', 'y', 'y2', "y'", 'z2', 'z2 y', 'z2 y2', "z2 y'", "z'", "z' y", "z' y2", "z' y'",
  'z', 'z y', 'z y2', "z y'", "x'", "x' y", "x' y2", "x' y'", 'x', 'x y', 'x y2', "x y'"];
// A first step never rotates inside its alg (README "Complete search": its
// only rotation is the free inspection), so root calls get no y/x.
const PRO_MOVE_RESTRICT_ROOT = PRO_MOVE_RESTRICT.split('_').filter(m => !/^[xyz]/.test(m)).join('_');
function proEngineOptions(rotation, isRoot = false) {
  const down = applyAlgorithm(SOLVED_FACELETS, rotation || '')[31];
  const centerOffset = ENGINE_CENTER_OFFSETS.filter(o =>
    applyAlgorithm(SOLVED_FACELETS, [rotation, o].filter(Boolean).join(' '))[31] === down);
  return { allowedMoves: isRoot ? PRO_MOVE_RESTRICT_ROOT : PRO_MOVE_RESTRICT, maxRotCount: isRoot ? 0 : 1, centerOffset };
}

/** A cross-solved node whose solved corners/edges are exactly these labels. */
function nodeByLabels(session, corners, edges) {
  const key = JSON.stringify([corners.slice().sort(), edges.slice().sort()]);
  // First matching cross-solved node, indexed once per tree (§4.36).
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

// U-layer turns may leave every goal piece in place (positioning other
// pieces, e.g. the U in "R' U R'" instead of "R2"); upstream engine rejected
// such solutions, the patched engine accepts them for these moves
// (crossSolver/solver.cpp setNoopMoves, PROJECT_STATUS.md §4.22).
const NOOP_MOVES = "U U2 U'";

// Appended to every later-step postAlg; see searchCurrentNode. "y2 y2", not
// "y y'": once rotations are searchable the engine groups y with the U/D
// axis, so a tail ending in y' blocked U/D-first candidates instead. y2 is
// never a searchable move (README forbids it mid-algorithm), so this tail
// constrains nothing -- measured as a superset of both alternatives (§4.20).
const POSTALG_BOUNDARY = 'y2 y2';

// Solutions requested per pseudo engine call, and per matched call when the
// complete search is off (SolveSession.completeSearch false: tools only).
const DEFAULT_MAX_SOLUTIONS = 10000;

// Complete search (README "Complete search"): a matched engine call lists
// EVERY face-turn solution of its goal up to the move limit (this cap only
// guards against runaway per-type settings; reaching it is reported as a cut
// search), and spelling-search.js keeps exactly the best DEFAULT_TOP_N
// results of each step type and results-page filter among every spelling
// of them (SolveSession.topN; the per-type "max solutions" overrides it).
const COMPLETE_ENGINE_CAP = 3000000;
const DEFAULT_TOP_N = 300;
// A later step whose goal has no solution within its limit is searched up
// to this many moves deeper (its shortest solutions only).
const LATER_DEEPEN = 3;
// The results-page filters that hide results instantly; the best N are kept
// for each, so a filter never empties the list (see README "Complete search").
const RESULT_VIEWS = [
  { test: () => true, wide: true },
  { test: c => !isWideAlg(c.coreAlg), wide: false },
  { test: c => !c.unorthodox, wide: true },
  { test: c => !c.unorthodox && !isWideAlg(c.coreAlg), wide: false },
];

// searchCurrentNode's per-candidate loop (facelet replays for luck-filtering,
// rotation-spelling/inspection expansion) is synchronous, CPU-bound JS -- the
// WASM solve itself runs off-thread in a Worker and doesn't block anything,
// but this post-processing does, and a search can easily carry thousands of
// raw solutions. Left unbroken, that freezes the whole page (including
// clicks on an UNRELATED, already-finished scramble's results) for as long
// as it takes to process every candidate. yieldIfDue() hands control back to
// the event loop roughly every YIELD_INTERVAL_MS of continuous work so
// pending UI events (a click, a render) get a chance to run in between
// chunks -- this changes nothing about what gets searched or how candidates
// are scored, only how the work is time-sliced.
const YIELD_INTERVAL_MS = 48;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
async function yieldIfDue(state) {
  if (now() - state.lastYield < YIELD_INTERVAL_MS) return;
  await new Promise(resolve => setTimeout(resolve, 0));
  state.lastYield = now();
}

// Distance-1 (first step) move limits per README "Search limits", keyed by
// pair count: cross 9, xcross 10, xxcross 10, xxxcross 11 (the user's
// defaults, 2026-10-07; were 10/11/12/13).
const DISTANCE1_LIMITS = { 0: 9, 1: 10, 2: 10, 3: 11 };

// EXPERIMENTALLY DISCOVERED (PROJECT_STATUS §4.8): a later step's true
// difficulty depends on how many pairs TOTAL must be preserved/solved
// (old + new), not on how many are *new* -- the search is far more
// constrained each time it also has to keep more already-committed pairs
// intact. A real trial (2 old pairs + 1 new) found zero solutions at the
// spec's flat 10-move "single pair" budget and needed 14. This table is
// keyed by total pairs in goal and uses crossSolver's own documented
// per-arity default maxLength (Xcross=10, Xxcross=12, Xxxcross=14,
// Xxxxcross=16) -- not arbitrary, and it exactly reproduces the spec's
// numbers for the *first* use of each category (totalPairs=1 -> 10 matches
// "single pair", totalPairs=2 from scratch -> 12 matches "multislot"); it
// only extends beyond the spec's flat table for deeper, more-constrained
// later steps the spec's table didn't distinguish.
const LATER_LIMITS_BY_TOTAL = { 1: 10, 2: 12, 3: 14, 4: 16 };
// Complete search: a matched later step's limit by the pairs it solves (the
// table above is for pseudo steps, whose engine calls stay capped): the
// README's single pair 10, multislot 12. Every face-turn solution within it
// is searched; 10 moves hold 89% of the professional later steps in
// data/reco_solves.txt, 11 moves 93% but ~5x the solutions (a per-type
// limit of 11 is a setting away; PROJECT_STATUS "Complete search").
const LATER_LIMITS = { 1: 10, 2: 12, 3: 12 };

// Semantic category keys matching the results table's "type" column
// (edgeTypeLabel below) -- this is the axis granular per-type search config
// (README "Granular search configuration") lets a user override, independent
// of the engine's own internal totalPairsInGoal/pairCount bookkeeping.
function categoryFor(pairCount, isRoot) {
  if (isRoot) return ['cross', 'xcross', 'xxcross', 'xxxcross'][pairCount] || 'xxxcross';
  return pairCount === 1 ? 'singlePair' : 'multislot';
}

function categoryKeyFor(pairCount, isRoot, isPseudo) {
  const base = categoryFor(pairCount, isRoot);
  return isPseudo ? `${base}Pseudo` : base;
}

/**
 * `searchConfig` (optional; from criteria.searchConfig, README "Granular
 * search configuration") overrides the move-depth limit for the edge's whole
 * semantic category (cross/xcross/xxcross/xxxcross/singlePair/multislot,
 * each matched or pseudo) -- a flat override replaces LATER_LIMITS_BY_TOTAL's
 * per-total nuance entirely for that category, since a user configuring this
 * manually is opting out of that empirically-tuned table, not refining it.
 */
function searchLimitFor(pairCount, isRoot, totalPairsInGoal, searchConfig, isPseudo) {
  const override = searchConfig && searchConfig[categoryKeyFor(pairCount, isRoot, isPseudo)];
  if (override && override.maxLength) return override.maxLength;
  if (isRoot) return DISTANCE1_LIMITS[pairCount];
  return isPseudo ? LATER_LIMITS_BY_TOTAL[totalPairsInGoal] : LATER_LIMITS[pairCount];
}

/** Same override lookup as searchLimitFor, for maxSolutions instead of maxLength. */
function maxSolutionsFor(pairCount, isRoot, searchConfig, isPseudo, fallback) {
  const override = searchConfig && searchConfig[categoryKeyFor(pairCount, isRoot, isPseudo)];
  return (override && override.maxSolutions) || fallback;
}

// Empirically derived (not hand-derived -- see PROJECT_STATUS.md §4.11/§4.12
// and test/solver-bridge.test.js): a y-rotation prefix cycles F2L slot
// names in this fixed order, independent of which slot or algorithm it's
// applied to. Confirmed directly via facelet-cube.js/facelet-flags.js with
// four different single-pair-disturbing trigger algorithms, and matches
// §4.11's own prior finding (claimed FR, y' variant actually solves BR:
// CORNER_CYCLE.indexOf('FR')=0, steps['y\'']=3, CORNER_CYCLE[3]='BR').
const CORNER_CYCLE = ['FR', 'FL', 'BL', 'BR'];
const ROTATION_STEPS = { '': 0, y: 1, y2: 2, "y'": 3 };

/** Relabel F2L slot names for the whole-cube y-rotation `yToken` ('', 'y', 'y2', or "y'"). */
function relabelSlotsForRotation(slots, yToken) {
  const steps = ROTATION_STEPS[yToken] ?? 0;
  if (!steps) return slots;
  return slots.map(slot => {
    const idx = CORNER_CYCLE.indexOf(slot);
    return idx === -1 ? slot : CORNER_CYCLE[(idx + steps) % 4];
  });
}

const ROTATION_TOKEN_RE = /^(x2|y2|z2|x'|y'|z'|x|y|z)(?=\s|$)/;

/** Strip a single leading rotation token (if present) from an alg string. */
function stripLeadingRotation(alg) {
  const m = alg.match(ROTATION_TOKEN_RE);
  if (!m) return { token: '', rest: alg.trim() };
  return { token: m[1], rest: alg.slice(m[0].length).trim() };
}

/** Compose two rotation strings (either may be ''). */
function composeRotations(a, b) {
  return [a, b].filter(Boolean).join(' ');
}

const F2L_SLOTS = ['BL', 'BR', 'FR', 'FL'];

/**
 * Replays [scramble, rotation, priorPath, coreAlg] as literal moves on a
 * solved cube and returns the resulting facelet string.
 *
 * `priorPath` can contain wide-move tokens if an earlier step was a
 * committed Cross-optimisation result (README "Wide moves and Cross
 * optimisation") -- facelet-cube.js deliberately has no notion of wide
 * moves (see cross-optimization.js's header comment), so they're expanded
 * back to their literal face-move+rotation definition before replay. This
 * must happen here, not just at the point a cross-opt candidate is itself
 * being checked, since the SAME priorPath text is reused by every later
 * step's own luck check once committed.
 */
// Every candidate of a search replays the same scramble + rotation + committed
// path before its own moves; that prefix state is cached (a few dozen distinct
// prefixes per search: colours x inspection variants), so only the
// candidate's own moves are replayed (PROJECT_STATUS.md §4.36).
const REPLAY_PREFIX_LIMIT = 256;
const replayPrefixCache = new Map();
function replayFacelets(scramble, rotation, priorPath, coreAlg) {
  // facelet-cube.js replays wide/slice moves natively (magiccube-verified,
  // §4.19), so the committed text is replayed exactly as a human reads it.
  const prefix = `${scramble}|${rotation}|${priorPath}`;
  let start = replayPrefixCache.get(prefix);
  if (start === undefined) {
    start = applyAlgorithm(SOLVED_FACELETS, [scramble, rotation, priorPath].filter(Boolean).join(' '));
    if (replayPrefixCache.size >= REPLAY_PREFIX_LIMIT) replayPrefixCache.delete(replayPrefixCache.keys().next().value);
    replayPrefixCache.set(prefix, start);
  }
  return coreAlg ? applyAlgorithm(start, coreAlg) : start;
}

/**
 * Luck filtering (README "Luck filtering"): replays the candidate for real
 * (see replayFacelets) and checks, via facelet-flags.js, that the result
 * solves EXACTLY what the candidate's DAG edge claims -- cross, plus every
 * claimed corner/edge, and no additional complete pair. Returns
 * { ok: true, facelets } (the cube after it) or { ok: false, reason }. See this file's header comment for
 * why this exact replay order is correct and where it's verified.
 *
 * `claimedEdges` defaults to `claimedCorners` (a matched claim: a slot is
 * claimed iff both its corner and its edge are). Passing a DIFFERENT list
 * makes this a pseudo claim: each corner/edge in the claim is checked as an
 * independent piece (facelet-flags.js's pseudoSolvedFlags) -- the corner at
 * one home-slot and the edge at another can each be genuinely solved
 * without either having its natural partner. A lone extra solved piece
 * with no partner is tolerated either way (README: it "may appear
 * transiently as a side effect"); only an extra COMPLETE pair is luck.
 */
function checkCandidateAgainstRealCubeState(scramble, rotation, priorPath, coreAlg, claimedCorners, claimedEdges, claimSets = null) {
  return checkFacelets(replayFacelets(scramble, rotation, priorPath, coreAlg), claimedCorners, claimedEdges, claimSets);
}

/** checkCandidateAgainstRealCubeState of the cube the candidate leaves (facelets). */
function checkFacelets(facelets, claimedCorners, claimedEdges, claimSets = null) {
  const actual = solvedFlags(facelets);
  // (claimSets: the same claim as Sets, for a caller checking many algs)
  const corners = claimSets ? claimSets.corners : new Set(claimedCorners || []);
  const edges = claimSets ? claimSets.edges : new Set(claimedEdges === undefined ? (claimedCorners || []) : claimedEdges);

  if (!actual.cross) {
    return { ok: false, reason: 'cross claimed solved but is not actually solved' };
  }
  // Per-piece checks only matter for a slot claimed by one piece (pseudo):
  // a solved pair's mask is its corner mask plus its edge mask (verified,
  // facelet-flags.js), so a claimed pair found solved has both home.
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

// The cube after face-turn token ids (spelling-search.js tables().TOK) from
// a start state given as char codes: applyAlgorithm without parsing the
// text again (the complete search replays every engine solution).
let PERM_BY_TID = null;
const REPLAY_A = new Uint16Array(54);
const REPLAY_B = new Uint16Array(54);
function replayTokenIds(startCodes, ids) {
  if (!PERM_BY_TID) PERM_BY_TID = SPELLING.tables().TOK.map(t => (MOVE_TABLE[t] ? Int32Array.from(MOVE_TABLE[t]) : null));
  let cur = REPLAY_A;
  let next = REPLAY_B;
  cur.set(startCodes);
  for (let k = 0; k < ids.length; k++) {
    const perm = PERM_BY_TID[ids[k]];
    for (let i = 0; i < 54; i++) next[i] = cur[perm[i]];
    const t = cur; cur = next; next = t;
  }
  return String.fromCharCode.apply(null, cur);
}

/**
 * Pseudo-solver results are only "solved up to a D-layer offset": the
 * engine (pseudoCrossSolver) considers cross + the targeted corners/edges
 * solved relative to EACH OTHER, which physically means one final free D
 * turn (D, D2 or D') -- or none -- brings every one of them home at once.
 * Established empirically (PROJECT_STATUS.md §4.14: 96/96 solutions across
 * random scrambles and all six cross colors); an earlier investigation that
 * ignored this offset wrongly concluded the solver was unreliable.
 *
 * Returns `coreAlg` with exactly that aligning D turn merged onto its end (a
 * trailing D-family move absorbs it, possibly cancelling), or null if no D
 * turn aligns the cross -- the real physical state is then not "solved up
 * to D" at all. Returns '' if the merge cancels the algorithm away entirely
 * (nothing left to do -- not a real step). The committed text is deliberately made physically exact
 * (not left offset) so every later step -- matched or pseudo, any solver --
 * can treat the committed path as an ordinary, correctly-aligned prefix.
 */
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

// Results-page option "wide moves" (default on): off, no result at any step
// uses a wide move (r l u d f b) or a slice (M E S) -- the engine searches
// without r/l, and the wide spellings (cross optimisation, side-cross
// inspections, wideSpellingParts) are not made.
const WIDE_TOKEN = /(^| )[rludfbMES]/;
// README "Wide moves": a wide B turn (b, b', b2) is never part of a solution
// (developer's rule, PROJECT_STATUS.md §4.46). Engine r/l relabelled by an
// inspection y, wide spellings and cross optimisation can all write one;
// postProcessCall's push drops such candidates and dedupeSolutions (the end
// of every result list) guarantees it.
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

/**
 * README "Unorthodox solutions": a step is unorthodox when it turns the R
 * layer (or the L layer) a half turn away from where the step started. The
 * displacement starts at 0; R is +1, R' is -1, and a half turn is executed
 * in whichever direction the hand is free to go: from +1 an R2 is done as
 * R2' (to -1), from -1 as R2 (to +1), and from 0 either way reaches +-2.
 * The step is unorthodox as soon as the displacement reaches +-2:
 * "R U R2 U' R" goes 1, 1, -1, -1, 0 and is fine; "R U R U' R'" (2 at the
 * second R), "R' U R'" and a lone "R2" are not. r counts as R and l as L
 * (the same hand turns that side); a y or z rotation (also inside u d f b E
 * S) puts other layers in the hands, so both counts start again. Only later
 * steps are flagged (the results page calls the filter "hide awkward f2l
 * solutions"): first steps are never hidden.
 */
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

/** Which solver method + args to use for a target whose full corner list is `corners`. */
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

/**
 * Time of committed steps `stepAlgs` plus `alg` as the next step: MCC
 * (algSpeed) of the whole path, plus each step's own stepPenalty (step-aware,
 * e.g. a y at the start of a step is free; PROJECT_STATUS.md §4.35).
 * TPP = this / pieces. The committed path is the same for every candidate of
 * a search: its MCC grip search (algSpeedPrefix) and step penalties are
 * computed once per path (cached on `holder`), and each candidate only
 * resumes from there. Exact: equal to algSpeed of the whole path
 * (test/script.test.js).
 */
function costBase(holder, stepAlgs) {
  let base = holder._costBase;
  // (called for every scored spelling: skip the key when nothing changed)
  if (base && base.ref === stepAlgs && base.len === stepAlgs.length && base.last === stepAlgs[stepAlgs.length - 1]) return base;
  const key = stepAlgs.join('|');
  if (!base || base.key !== key) {
    const scoredPath = stepAlgs.join(' ').trim();
    base = holder._costBase = {
      key,
      scoredPath,
      mcc: typeof algSpeedPrefix === 'function' ? algSpeedPrefix(scoredPath) : null,
      penalty: typeof stepPenalty === 'function' ? stepAlgs.reduce((sum, a) => sum + stepPenalty(a), 0) : 0,
    };
  }
  base.ref = stepAlgs;
  base.len = stepAlgs.length;
  base.last = stepAlgs[stepAlgs.length - 1];
  return base;
}
function stepsPathCost(holder, stepAlgs, alg) {
  const base = costBase(holder, stepAlgs);
  const penalty = typeof stepPenalty === 'function' ? base.penalty + stepPenalty(alg) : 0;
  if (base.mcc) return algSpeedResume(base.mcc, alg) + penalty;
  const path = base.scoredPath ? `${base.scoredPath} ${alg}` : alg;
  return algSpeed(path, false, false) + penalty;
}

/** stepsPathCost without the new step's own stepPenalty (the caller adds it). */
function stepsPathMcc(holder, stepAlgs, alg) {
  const base = costBase(holder, stepAlgs);
  if (base.mcc) return algSpeedResume(base.mcc, alg) + base.penalty;
  return algSpeed(base.scoredPath ? `${base.scoredPath} ${alg}` : alg, false, false) + base.penalty;
}

// ---------------------------------------------------------------------------
// Corpus candidates (README "Corpus candidates"): every later step also
// tries the F2L algorithms people actually use (script.js f2lCorpusAlgs:
// standard F2L algs and every professional step, mirrored), each after a
// free y-family rotation and an optional U turn. The engine lists the
// shortest solutions first, so with many short ones a natural 9-11 move alg
// is often never generated. A corpus alg that solves exactly a planned
// matched edge's goal joins that call's solutions and is post-processed like
// them (luck filter, spellings, TPP). Checked on permutations: one 54-entry
// array per alg, built once.
// ---------------------------------------------------------------------------

const CORPUS_ROTATIONS = ['', 'y', 'y2', "y'"];
const CORPUS_AUFS = ['', 'U', 'U2', "U'"];
const U_QUARTERS = { U: 1, U2: 2, "U'": 3 };
let corpusTableCache = null;

function permOfAlg(alg) {
  let perm = IDENTITY_PERM;
  for (const t of alg.split(' ')) if (t) perm = composePerm(perm, MOVE_TABLE[t]);
  return perm;
}

/** The corpus algs as { alg, turns, perm }; perm = the alg, then its own net rotation undone. */
function corpusTable() {
  if (corpusTableCache) return corpusTableCache;
  const algs = [];
  for (const alg of f2lCorpusAlgs()) {
    const toks = alg.split(' ');
    if (!toks.every(t => MOVE_TABLE[t])) continue;
    const net = netRotation(alg);
    if (!CORPUS_ROTATIONS.includes(net)) continue; // the cross would leave the bottom
    if (toks.includes('y2')) continue; // README: y2 only as a step's first move
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

/** "a core" with a leading U of `core` merged into the U turn `a`; null if they cancel the whole alg. */
function joinAuf(a, toks) {
  if (!a) return toks.join(' ');
  const q = U_QUARTERS[toks[0]];
  if (!q) return [a, ...toks].join(' ');
  const sum = (U_QUARTERS[a] + q) % 4;
  const rest = toks.slice(1);
  const head = sum ? [['', 'U', 'U2', "U'"][sum]] : [];
  return head.length || rest.length ? [...head, ...rest].join(' ') : null;
}

/**
 * Corpus solutions per planned call: Map(plan entry -> [alg]) for the
 * matched later-step entries of `plan`, each alg written "rotation AUF alg"
 * in the frame the engine's own solutions use.
 */
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
      const key = `${p.allCorners}|${alg}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!out.has(p)) out.set(p, []);
      out.get(p).push(alg);
    }
  }
  return out;
}

/** Pseudo-engine counterpart of solverCallFor: independent edge and corner home-slot lists. */
function pseudoCallFor(pseudoHelper, edges, corners, scramble, rotation, maxLength, postAlg, maxSolutions = DEFAULT_MAX_SOLUTIONS, deadline = 0, allowedMoves = MOVE_RESTRICT) {
  const toLetters = list => list.slice().sort();
  return pseudoHelper.solvePseudo(scramble, toLetters(edges), toLetters(corners), {
    maxSolutions, maxLength, rotation, allowedMoves, postAlg: postAlg || '', noopMoves: NOOP_MOVES,
    ...(deadline ? { deadline } : {}),
  });
}

// Search time budget (README "Performance goal", PROJECT_STATUS.md §4.36):
// with session.timeBudgetMs set, every engine call of a search gets a
// deadline the engine checks itself; a call still running then returns the
// solutions it found so far (shortest first), and calls not started yet are
// skipped. The engines get this share of the budget; the rest is left for
// post-processing the last calls' solutions. With look-ahead, the step's own
// search gets LOOKAHEAD_FIRST_SHARE of it and the follow-up searches the rest.
// Post-processing stops at POST_SHARE of the rest, and ranking is planned to
// end at RANK_END_SHARE of it (a margin for the rest of the step): with
// 10,000 solutions per call, a root search with every option on used to
// post-process for ~110 s after the engines' deadline (155 s in all).
const SEARCH_ENGINE_SHARE = 0.75;
const LOOKAHEAD_FIRST_SHARE = 0.5;
const POST_SHARE = 0.7;
const RANK_END_SHARE = 0.85;
// Ranking (sort + dedupe) after post-processing costs ~6.3 us per candidate
// here (1.1M candidates: 6.9 s); post-processing stops early enough to leave
// that time.
const RANK_MS_PER_CANDIDATE = 0.007;
function budgetDeadline(session, share, start = Date.now()) {
  const budget = session && session.timeBudgetMs > 0 ? session.timeBudgetMs : 0;
  return budget ? start + budget * share : 0;
}
// Rough relative cost of an engine call, for the start order under a budget:
// cheap calls first, so a deadline cuts the expensive tail (pseudo, more
// pairs, the pro move set, longer limits), not the common results.
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
    this.completeSearch = true; // README "Complete search"; false = the capped pro-move-set engine search (tools)
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

  /**
   * Key of the search options above that apply at this node (part of every
   * memoised search's key): the root only depends on wideMoves.
   */
  get searchSettingsKey() {
    const wide = this.wideMoves === false ? 'nowide' : '';
    const plan = this.planning === false ? '|noplan' : '';
    if (this.isAtRoot) return wide + plan;
    return `${this.multislot ? '' : 'single'}${wide ? '|' + wide : ''}${plan}`;
  }

  /**
   * This session with other search options (a fork: the UI's session keeps
   * its own). Shares the search memo, whose keys include the options.
   */
  withSettings(settings) {
    const s = this.fork();
    for (const k of ['multislot', 'wideMoves', 'planning']) if (settings && settings[k] !== undefined) s[k] = !!settings[k];
    return s;
  }

  /**
   * A copy of this session that can commit without touching this one
   * (look-ahead). Shares the tree, settings and search memo, so a step the
   * look-ahead already searched is not searched again once really committed.
   */
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
  /**
   * Time of the committed path plus `alg` as the next step: MCC (algSpeed) of
   * the whole path, plus each step's own stepPenalty (step-aware, e.g. a y at
   * the start of a step is free; PROJECT_STATUS.md §4.35). TPP = this / pieces.
   */
  pathCost(alg) {
    return stepsPathCost(this, this.stepAlgs, alg);
  }
  /**
   * The committed path as the engine needs it: { rotation, moves } with
   * `moves` face turns only, in the frame the cube is physically in now.
   */
  get engineFrame() { return canonicalizeForEngine(this.rotation, this.scoredPath); }
  get isComplete() {
    const s = this.currentNode.state;
    return s.cross_solved && (s.corners || []).length === 4 && (s.edges || []).length === 4;
  }

  outgoingEdges() {
    return this.tree.edges.filter(e => e.source === this.currentNodeId);
  }

  /** Commit a candidate result (from search()) and advance to its target node. */
  commit(candidate) {
    if (this.isAtRoot) {
      this.rotation = candidate.rotation;
    }
    this.stepAlgs.push(candidate.coreAlg);
    this.committedRows.push(candidate);
    this.currentNodeId = candidate.targetNodeId;
    this.resultsCache = null;
  }

  /**
   * Undo the most recent commit (README "Search tree navigation (undo)"):
   * steps back to the previous node so a different outgoing edge can be
   * explored. Mirrors commit()'s root-only rotation capture in reverse --
   * undoing back to zero commits re-arms it, so a later re-commit captures
   * rotation correctly again (see test/solver-bridge.test.js's root-rotation
   * test for the asymmetry this must respect). Returns false (no-op) at the
   * root, where there is nothing to undo.
   */
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

// The engine prefixes every returned solution with `rotation + ' ' + postAlg`
// verbatim (see solver.cpp): strip exactly that known prefix to recover just
// the new step's algorithm. One entry per solution, in order ('' = already
// solved).
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
// run(stopped): stopped() is true once every search that asked for the call
// no longer wants it (their shouldStop; a call without one is always
// wanted); a call stopped that way is never handed out again.
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

// A helper that runs one solve at a time (the plain Node/browser helpers reject
// a second concurrent call) gets its calls chained; a scheduler-gated helper
// (search-scheduler.js, `__gated`) already queues and may run several at once.
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

// A later step's multislot goal is its slowest engine call by far (two
// pairs at once, up to 12 turns: seconds where a single pair takes tenths).
// It is split by its first move: each part is the same goal after that move
// (appended to postAlg behind the y2 y2 boundary, so the engine's move-order
// rules between it and the next move are those inside one search), one turn
// shorter. The union is exactly the one call's solutions
// (tools/split-check.js), in first-move order, at no extra cost on one
// engine worker; several workers share the parts, and the scheduler can run
// another search's calls between them (a search replaced by a click yields,
// search-scheduler.js). The
// engine lists nothing for a goal already solved, so one-move solutions
// come from a separate depth-1 call.
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
  // Started a few at a time (one more than the engine workers, so none
  // idles): once nobody wants the call (a click moved on), the rest are not
  // started and the call ends without a result (it is then never reused).
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

/**
 * Search every outgoing edge of session's current node, dispatch to the
 * appropriate solver, and return a TPP-ranked array of candidate results.
 * `onStatus(message)` is called with human-readable progress updates.
 * `pseudoHelper` (optional) is a pseudoCrossSolver helper; without one,
 * pseudo (mismatched) targets are skipped.
 */
async function searchCurrentNode(session, helper, onStatus, pseudoHelper, deadline, onPartial, stop = null) {
  const isRoot = session.isAtRoot;
  // Absolute deadline (epoch ms) for this search's engine calls; 0 = none.
  if (deadline === undefined) deadline = budgetDeadline(session, SEARCH_ENGINE_SHARE);
  // When post-processing stops (time budget; 0 = never): calls not processed
  // by then are dropped, a call being processed keeps what it has.
  const postStop = deadline && session.timeBudgetMs > 0 ? deadline + session.timeBudgetMs * (1 - SEARCH_ENGINE_SHARE) * POST_SHARE : 0;
  let edges = session.outgoingEdges();
  // Multislot off (results page): later steps solve one pair at a time -- the
  // same edges pruneGraph drops without "multislotting", removed before
  // anything else so the rest of the search is exactly as with that tree.
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
  // A transition is "full pseudo only" (hidden by the results page's
  // simple-pseudo filter) only if EVERY edge to that target is; the old
  // simplified-pseudo mode dropped exactly those edges (pruneGraph).
  const fullOnlyByKey = new Map();
  for (const edge of edges) {
    const key = targetKey(edge);
    fullOnlyByKey.set(key, (fullOnlyByKey.has(key) ? fullOnlyByKey.get(key) : true) && !!edge.full_pseudo_only);
  }

  {
    // tree_gen.py's generation has two independent sources of fully
    // redundant edges, both confirmed empirically:
    // (1) at ANY cross-solved node (not just the root), it explores a
    //     mid-solve y/y' setup rotation when enumerating transitions --
    //     producing edges that differ only in that internal rot tag (an
    //     artifact of which UNSOLVED pieces land where) but land on a
    //     target whose solved corners/edges are identical.
    // (2) for any pair_size>=2 transition (XXCross/XXXCross from the root,
    //     multislot later), it loops `for edge_perm in permutations(edges)`
    //     but solve_pieces() marks pieces solved by set membership, not by
    //     position in that tuple -- every permutation produces the exact
    //     same next_state, so the same real action is duplicated N! times.
    // This file's dispatch is a pure function of the target's solved
    // corners/edges (plus session state) -- any node sharing that key is
    // 100% redundant for search purposes, root or not. Collapse before
    // searching, or real actions get searched and shown 2-6x over.
    const seen = new Set();
    edges = edges.filter(edge => {
      const key = targetKey(edge);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  if (!isRoot) {
    // CRITICAL (found 2026-10-04 while verifying luck filtering end-to-end
    // against the real solver -- see PROJECT_STATUS.md §4.12): the same
    // mid-solve y/y' exploration described above can also produce a target
    // whose solved corners/edges are NOT a superset of the current node's
    // -- a previously-committed slot's label gets renamed by the rotation
    // (e.g. a committed "BR" becomes "FR" or "BL" under the relabeling)
    // instead of carried forward under its real name. Dispatch here has no
    // mechanism to apply that implied second rotation (session.rotation is
    // fixed once at the root and reused verbatim) -- taking such an edge at
    // face value asks the solver to protect the wrong slot entirely,
    // silently disturbing the real, already-committed piece. Verified
    // directly against the real WASM solver + a real facelet replay: for
    // one committed session, 26 of 86 otherwise-plausible later-step
    // candidates (spanning multiple distinct target nodes, all sharing this
    // shape) disturbed a committed pair 100% of the time, with no error and
    // a perfectly normal-looking "Single pair" label -- this predates and
    // is independent of luck filtering, and luck filtering's own check
    // cannot catch it, since both the (wrong) claim and the real outcome
    // agree the dropped slot isn't solved. Any later-step edge that drops a
    // committed label is therefore not a safe transition from the session's
    // actual (unrotated-beyond-session.rotation) frame and must be skipped.
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
      // The committed path-so-far (session.scoredPath) is already text in
      // the ROTATED frame the engine returned it in (see this file's header
      // comment) -- it must never be pasted into a fresh `scramble` string,
      // because the `rotation` option would then relabel it a SECOND time,
      // searching a bogus state (confirmed empirically: doing so corrupts
      // even the already-solved cross by the second committed step). The
      // engine's own `postAlg` option applies those moves directly in the
      // already-rotated frame -- exactly what's needed here -- without any
      // further relabeling.
      const scramble = session.scramble;
      // The engine needs the committed path as face turns in the CURRENT
      // frame, with the net rotation (inspection + any wide moves or
      // mid-solve rotations) in its `rotation` option: it rejects a postAlg
      // that leaves the centres rotated. See SolveSession.engineFrame / §4.19.
      const frame = isRoot ? null : session.engineFrame;
      const callRotation = isRoot ? baseRotation : frame.rotation;
      // The engine's move-adjacency pruning spans the postAlg boundary: a
      // step could never start on the same face (or axis) the previous step
      // ended on -- e.g. after "... R2", every R/L-first candidate was
      // silently missing (19 of 33 found on pro reference #5's 2nd pair;
      // PROJECT_STATUS.md §4.20). A cancelling rotation pair that is not
      // itself searchable resets that without changing the state.
      const postAlgForCall = isRoot || !frame.moves ? '' : `${frame.moves} ${POSTALG_BOUNDARY}`;

      plan.push({
        edge, targetNode, isPseudo, newEdges, pairCount, allCorners, allEdges, maxLength,
        effectiveMaxSolutions, color, baseRotation, scramble, callRotation, postAlgForCall,
        fullPseudoOnly: fullOnlyByKey.get(targetKey(edge)) === true,
        complete, topN, category: categoryKeyFor(pairCount, isRoot, isPseudo),
      });
    }
  }

  // Pass 2: start them all at once (PROJECT_STATUS.md §4.34). A pooled,
  // scheduler-gated helper runs them in parallel on several engine workers;
  // a plain helper gets them one at a time (serialEngine). Results are still
  // consumed in plan order below, so the output is the same either way.
  // Under a time budget the calls START cheapest first (callCostRank), so the
  // deadline lands on the expensive tail; they are still consumed in plan
  // order, so whatever finishes gives the same output as without a budget.
  // A look-ahead search's calls carry its rank (its path of candidate indices,
  // see searchWithLookahead) so a scheduler can run the best candidates'
  // follow-ups first; the step's own search has none and runs before them.
  const rank = session.lookaheadRank || null;
  const ranked = (h) => (rank && h && typeof h.withRank === 'function' ? h.withRank(rank) : h);
  const engine = ranked(serialEngine(helper));
  const pseudoEngine = ranked(serialEngine(pseudoHelper));
  // Without a budget: later steps start their single-pair calls before the
  // multislot ones, whose results the results page hides by default (they
  // are always searched, README "Multislot"), so the rows a solver sees are
  // final sooner; the order calls are consumed in is unchanged.
  const startOrder = deadline
    ? plan.slice().sort((a, b) => callCostRank(a, session.proMoves) - callCostRank(b, session.proMoves))
    : (isRoot ? plan : plan.slice().sort((a, b) => (a.pairCount > 1) - (b.pairCount > 1)));
  // ... and the multislot engine calls wait until the single-pair calls are
  // ranked: on a machine with few cores the engine worker otherwise takes a
  // core from the ranking of the rows a solver is waiting for (a first pair
  // after a plain cross: 49 s -> see PROJECT_STATUS). Only the start order
  // changes, never what is searched.
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
    // The same engine input can come up again: another look-ahead path to the
    // same cube state (a multislot and its two single-pair halves; different
    // moves that leave the same state), or the same step searched with other
    // results-page options (multislot switched on reuses the single-pair
    // calls). The matched engine's solutions depend only on the state it
    // starts from (the postAlg boundary resets move pruning), so its calls are
    // shared by state -- checked on real look-ahead calls: identical output
    // for every same-state pair; pseudo calls only by exact input. Not under
    // a time limit, where a call's output also depends on its deadline.
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
      // Complete search: they are scored as written, next to the spellings
      // of the engine's solutions (those already include every face-turn
      // solution within the limit).
      if (p.complete) p.corpus = extra;
      else p.cores = p.cores.then(c => (c === null ? null : c.concat(extra)));
    }
  }
  let truncatedCalls = 0;
  // Candidates post-processed so far (their ranking is still to come): live
  // on the main thread (yieldState.listed, every call's pushes), per finished
  // call for a worker pool.
  let listed = 0;
  const listedNow = () => Math.max(listed, yieldState.listed || 0);
  // Engine calls that failed (an engine error or a crashed worker): the list
  // is missing their results, so it is marked and not memoised.
  let failedCalls = 0;

  // Pass 3: post-process each call's solutions as soon as that call
  // finishes, so the JS work overlaps the engine calls still running
  // (PROJECT_STATUS.md §4.36); each call's candidates are kept apart and
  // joined in plan order below, so the output is the same as processing the
  // calls one by one in plan order.
  const ctx = postProcessContext(session, isRoot);
  // Complete search: the best TPPs of each step type and filter so far
  // (finished calls), so a call's spellings only compete for places its type
  // still has (the type's N-th best only gets better).
  const typeBest = new Map();
  // ... and the seed results of its type's big calls still being ranked,
  // the call's own included (real candidates, each once: their N-th best
  // bounds every call of the type; dropped once that call is done, whose
  // own results then count instead).
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
  // Live limits (worker pools): every running ranking job of a complete call
  // reports its kept candidates now and then (TopViews.snapshot: key, TPP,
  // views) and gets back, per view, the N-th best of its type among the
  // finished calls and every running job -- real candidates, each counted
  // once (a key may turn up in two chunks of one call; different calls
  // reach different nodes) -- so the jobs of a type prune like one job.
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
    // The per-candidate work is a pure function of (ctx, job, solutions), so
    // a page can run it off the main thread (session.postProcessor, a worker
    // pool; PROJECT_STATUS.md §4.40) -- same function, same output.
    // A big call no longer waits for the smaller calls of its type (their
    // results would bound it, typeLimits): on a worker pool the wait left
    // workers idle and made it the tail of the search (hardest root
    // measured: 30.6 s -> see PROJECT_STATUS). Without a pool it still does.
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
      // A big call is ranked in chunks side by side on the worker pool (the
      // best N of each chunk; trimToTypeBest keeps the best N of all).
      // Chunks of solutions that end alike share most of their bound rows.
      // First a quick seed job over the whole call: its exactly scored plain
      // spellings bound every chunk (each would otherwise find its own best
      // N from scratch: 2 chunks of a first-step xcross did twice the work).
      const seedList = await session.postProcessor(ctx, { ...job, seedOnly: true, corpus: null }, cores, rank, refresh);
      job.limits = completeSeedLimits(seedList, p.topN, job.limits);
      p.seedViews = RESULT_VIEWS.map(view => seedList.filter(view.test).map(c => c.tpp).sort((a, b) => a - b).slice(0, p.topN));
      p.markSeeded();
      // The chunks start once every big call of the type has its seeds
      // (quick jobs): their N-th best together is close to the type's final
      // one, while a call ranked before the others' engine calls finish
      // only knows its own (a first pair after a plain cross: the first of
      // four calls walked 73% of its solutions instead of ~45%).
      await Promise.all(plan.filter(q => q !== p && q.complete && q.category === p.category).map(q => q.seedReady));
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
  // Progressive results (README "Results table"): while calls are still
  // running, the calls finished so far are ranked exactly like the final
  // list and handed to onPartial, throttled so ranking tens of thousands of
  // candidates does not crowd out the post-processing itself.
  let lastPartial = 0;
  let partialCost = 0;
  // Once only multislot calls are left (later steps; the results page hides
  // multislots by default), the list says so (onlyMultislotPending): every
  // other row is final. That list is always emitted, throttle or not.
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

  // Time budget: ranking costs ~RANK_MS_PER_CANDIDATE per candidate; if all
  // of them would not fit in what is left, only the best (by TPP) that do
  // are ranked. Those dropped are the bottom of a list of a million or more.
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

/**
 * Per RESULT_VIEWS view, the N-th best TPP among `candidates` (real ones:
 * a seed-only search's plain spellings), or the given limit if lower. The
 * true N-th best can only be better, so it is a valid limit for any part
 * of the same call.
 */
function completeSeedLimits(candidates, topN, limits) {
  return RESULT_VIEWS.map((view, v) => {
    const tpps = (candidates || []).filter(view.test).map(c => c.tpp).sort((a, b) => a - b);
    const seeded = tpps.length >= topN ? tpps[topN - 1] : Infinity;
    return Math.min(seeded, limits ? limits[v] : Infinity);
  });
}

// Complete search: solutions per post-processing job (see processCall).
const COMPLETE_CHUNK = 12000;
/** A big call's solutions in chunks of about COMPLETE_CHUNK, each a run of solutions that end alike. */
// No more chunks than ranking workers: each chunk finds its own best N, so
// more chunks than workers only add work (6 chunks of a 64k-solution root
// cross: +50% CPU over the whole call; 2: none).
function completeChunks(cores, workers) {
  const keyed = cores.filter(Boolean).map(c => [c.split(' ').reverse().join(' '), c]);
  keyed.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const count = Math.max(1, Math.min(workers || Infinity, Math.ceil(keyed.length / COMPLETE_CHUNK)));
  const size = Math.ceil(keyed.length / count);
  const out = [];
  for (let k = 0; k < keyed.length; k += size) out.push(keyed.slice(k, k + size).map(x => x[1]));
  return out;
}

/** Keeps, per step type, the best topN candidates of each RESULT_VIEWS filter (complete calls only). */
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

/**
 * What postProcessCall needs from a session: plain data (and Maps), so it can
 * be sent to a worker. `nodeIndex` / `rootTargets` are the label -> node id
 * maps behind nodeByLabels / rootTargetByLabels.
 */
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
    lookWeights: lookWeightsFor(session),
    planWeights: session.planning !== false && typeof PAIR_PLANNING !== 'undefined' && PAIR_PLANNING.plan.some(w => w) ? PAIR_PLANNING.plan.slice() : null,
  };
}

/** The pair-choice look weights: fitted with the planning features when planning is on. */
function lookWeightsFor(session) {
  const planning = session.planning !== false && typeof PAIR_PLANNING !== 'undefined';
  const w = planning ? PAIR_PLANNING.look : (typeof PAIR_CHOICE_LOOK !== 'undefined' ? PAIR_CHOICE_LOOK : null);
  return w && w.some(x => x) ? w.slice() : null;
}

/** Pair-planning cost of the cube `facelets` as held (planFeatures; 0 without weights). */
const planScratch = [0, 0, 0, 0];
const planYScratch = new Array(16).fill(0);
function planCost(weights, facelets) {
  if (!weights || !facelets) return 0;
  planFeatures(facelets, planScratch);
  let x = 0;
  for (let k = 0; k < weights.length; k++) x += weights[k] * planScratch[k];
  return x;
}

/** One planned engine call as postProcessCall needs it (plain data). */
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

/** A cross-solved node with exactly these solved corners and edges (pseudo included). */
function ctxNodeByPieces(ctx, corners, edges) {
  const key = JSON.stringify([corners.slice().sort(), edges.slice().sort()]);
  return ctx.nodeIndex.has(key) ? ctx.nodeIndex.get(key) : null;
}

function ctxRootTarget(ctx, corners, edges) {
  return ctx.rootTargets.get(JSON.stringify([corners.slice().sort(), edges.slice().sort()])) || null;
}

/** SolveSession.pathCost for a context's committed steps (same function). */
function pathCostFor(ctx, alg) {
  return stepsPathCost(ctx, ctx.stepAlgs, alg);
}

/**
 * A finished engine call's solutions -> the search's candidates for that call
 * (luck filter, inspection variants, cross optimisation, rotation spellings,
 * side-cross variants, TPP), in a fixed order. Pure: depends only on its
 * arguments, so it gives the same list on the main thread or in a worker.
 * `yieldState` (main thread only) lets the page breathe between solutions.
 */
async function postProcessCall(ctx, p, cores, yieldState, live = null) {
  if (p.complete) return postProcessComplete(ctx, p, cores, live);
  const candidates = [];
  const { isRoot } = ctx;
  const wideOn = ctx.wideMoves !== false;
  // Every candidate goes through here: no wide move with wide moves off, the
  // pair-choice term `look` of the cube it leaves (script.js
  // PAIR_CHOICE_LOOK, added to the path cost: every caller passes TPP = path
  // cost / pieces; the same for every spelling, the features do not change
  // under y rotations), and the flags the results page's filters hide by:
  // unorthodox (later steps only: the "hide awkward f2l solutions" filter
  // never hides a first step, whose crosses are often awkward by nature) and
  // multislot (a later step solving more than one pair).
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
    // a first step's only rotation is the inspection (README)
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
  // Dedupe identical algorithms before altAlgs expansion — the solver
  // commonly returns the same algorithm multiple times across its
  // maxSolutions results. ('' = "already solved", not a real step here.)
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

    // Cross optimisation (README "Wide moves and Cross optimisation") --
    // a first-step-only, Cross-only (pairCount=0) post-process, kept
    // independent of altAlgs below (its own rotation search already
    // explores reorientation; combining both was judged unnecessary
    // added complexity -- see PROJECT_STATUS.md §4.5/§4.13). Every
    // variant it returns is mathematically equal to "the raw coreAlg,
    // followed by a pure y-rotation" (see cross-optimization.js's
    // header comment for the proof), so a plain luck-check call below
    // is a cheap safety net, not load-bearing.
    if (isRoot && pairCount === 0 && wideOn && ctx.crossOptEnabled && typeof optimizeCrossSolution === 'function') {
      const optimized = optimizeCrossSolution(coreAlg.trim().split(/\s+/));
      for (const opt of optimized) {
        const optAlg = opt.moves.join(' ');
        if (optAlg === coreAlg && !opt.rotation) continue; // identical to the unoptimized result below

        // The optimised text equals "coreAlg, then opt.rotation": the
        // residual rotation happens DURING the algorithm (inside its wide
        // moves), so it is replayed as written after the inspection
        // rotation, exactly like a plain Cross candidate.
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

        // The residual rotation happens DURING the algorithm (it is part
        // of the wide moves), so the inspection rotation stays
        // baseRotation; later steps derive the real frame from the
        // committed text via SolveSession.engineFrame (§4.19). Composing
        // it in here as well applied it twice.
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
    // Inspection variants. With the pro move set the alg can contain
    // wide moves and rotations, which altAlgs' face table can't relabel,
    // so the mechanical (permutation-derived) relabel is used instead;
    // it agrees with altAlgs on every face-turn alg (§4.20).
    const variants = !isRoot ? [coreAlg]
      : ctx.proMoves ? ['', 'y', 'y2', "y'"].map(t => (t ? `${t} ${relabelAlgForRotation(coreAlg, t)}` : coreAlg))
      : typeof altAlgs === 'function' ? altAlgs([coreAlg]) : [coreAlg];

    for (const variant of variants) {
      // Only a root variant carries a free inspection token to split
      // off; a later step's leading rotation (pro move set, e.g.
      // "y' R U R'") is part of the step itself.
      const { token: yToken, rest: variantAlg } = isRoot ? stripLeadingRotation(variant) : { token: '', rest: variant };
      const fullRotation = isRoot ? composeRotations(baseRotation, yToken) : ctx.rotation;

      if (!variantAlg) continue; // shouldn't happen, but guard

      // A pseudo result is only solved up to a free D-layer offset; make
      // it physically exact (see alignPseudoAlg). A matched result never
      // needs this.
      const finalCoreAlg = isPseudo
        ? alignPseudoAlg(ctx.scramble, fullRotation, ctx.scoredPath, variantAlg)
        : variantAlg;
      if (finalCoreAlg === null) {
        console.warn('Discarding pseudo candidate: cross is not solved up to a D turn', { coreAlg: variantAlg, rotation: fullRotation });
        continue;
      }
      if (!finalCoreAlg) continue; // alignment cancelled the whole algorithm

      // Rotation-correct claim (PROJECT_STATUS.md §4.11/§4.12 finding
      // #3): for a ROOT candidate, `allCorners`/`allEdges` (== newCorners
      // /newEdges here, since the root's current node has none solved
      // yet) are the DAG edge's UNROTATED labels -- but a non-identity
      // altAlgs variant physically solves a y/y2/y'-cycled slot, not the
      // unrotated one (confirmed empirically, see relabelSlotsForRotation
      // and test/solver-bridge.test.js). The luck check below MUST use
      // this corrected claim, not the raw label -- using the raw label
      // made every non-identity-rotation root candidate with
      // pairCount>=1 look like it "failed to solve what it claims" and
      // get wrongly discarded as a bug, which is not what's happening.
      // For a non-root candidate there is no yToken (altAlgs isn't
      // applied there) and §4.12's superset filter already makes
      // `allCorners` trustworthy, so it's used unchanged.
      const trueClaimedCorners = isRoot ? relabelSlotsForRotation(allCorners, yToken) : allCorners;
      const trueClaimedEdges = isRoot ? relabelSlotsForRotation(allEdges, yToken) : allEdges;

      // The node this candidate really reaches is the one labelled with
      // the slots it PHYSICALLY solves (in the frame after fullRotation,
      // which every later step searches and replays in) -- not the
      // unrotated DAG target. Committing the unrotated target made later
      // steps protect the wrong slot: found 2026-10-04 (PROJECT_STATUS.md
      // §4.16), 26 of 501 later-step candidates on one scramble broke the
      // committed pair while still passing the luck check.
      // A pro-move-set alg can end rotated (a mid-step y, or wide moves):
      // claims are checked in the step's STARTING frame (its own net
      // rotation undone), but the node it reaches is labelled in the
      // frame the cube ends in -- read off the physical result, like the
      // §4.16 fix, so later steps keep reading labels correctly.
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

      // Luck filtering (README "Luck filtering") -- discard any
      // candidate that doesn't solve EXACTLY `trueClaimedCorners` (this
      // edge's full claimed target, old+new pairs, rotation-corrected)
      // when physically replayed. See this file's header comment and
      // PROJECT_STATUS.md §4.3/§4.9 for why a real cube-state check, not
      // a solver probe, is needed.
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

      // Display label ("corners"/"edges" columns: what's NEWLY solved
      // by this step specifically, not the full cumulative claim used
      // above). Root: `trueClaimedCorners` already IS just the new
      // slots, rotation-corrected (root's current node has none solved
      // yet). Non-root: take the set difference between the target's
      // full (trustworthy, superset-checked) claim and the current
      // node's own corners/edges -- simpler and more robust than any
      // rotation algebra, since it only depends on fields already known
      // to be correct (§4.12 finding #3's fix).
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

      // Every spelling of this alg with a final rotation r is physically
      // "alg, then r", so the node it reaches depends only on r: replayed
      // once per rotation, not once per spelling (§4.38).
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

      // Rotation spellings (pro move set; README "Professional reference
      // solves"): the engine often returns the un-rotated spelling
      // ("U' B U B'") of what a human does with a rotation ("y U' R U R'").
      // Each spelling is physically "this alg, then y/y'", so it solves the
      // same pieces; only the frame it ends in (hence the node labels)
      // changes, read off the physical result as above. At most one
      // rotation per step, as in the pro move set; never a leading one at
      // the root (that is an inspection variant). §4.20.
      // An alg that already rotates has no such spelling: the inserted y
      // would be its second rotation (relabelling keeps rotations rotations).
      if (ctx.proMoves && !isPseudo && typeof rotationSpellingParts === 'function'
        && !finalCoreAlg.split(' ').some(t => /^[xyz]/.test(t))) {
        for (const { alg: spelling, rotation: rot } of rotationSpellingParts(finalCoreAlg, !isRoot)) {
          const nodeId = nodeAfter(rot);
          if (!nodeId) continue;
          const spTpp = pathCostFor(ctx, spelling)
            / p.pieces;
          push({ ...candidate, coreAlg: spelling, tpp: Number.isFinite(spTpp) ? spTpp : Infinity, targetNodeId: nodeId }, look);
        }
      }

      // Wide-move spellings (README "Wide moves"): a D turn done as u, a U
      // as d, B/F pairs as f/b, the rest relabelled -- e.g. "D y R U' R'" as
      // "u R U' R'", "B U' B'" as "f R' f'". Each is physically "alg, then a
      // y-family rotation", so it solves the same pieces, with the slots
      // relabelled for the frame it ends in: read off the physical result for
      // a matched step; for a pseudo step (whose lone pieces a replay cannot
      // tell from its claim) the claim is relabelled, which is the same thing
      // (checked in test/wide-spellings-e2e.js).
      // Later steps only: the first step already gets wide moves from cross
      // optimisation, side-cross inspections and the engine's r/l, and these
      // spellings doubled its candidates (root search ~60% slower).
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

      // Side-cross inspections (pro move set, root only): start with a
      // wide move from an inspection that has the cross on a side. Each
      // variant is physically identical to this candidate, end orientation
      // included (the wide move's x-rotation is undone in the free
      // inspection rotation), so it reaches the same node with the same
      // labels. §4.25.
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

/**
 * Complete search (README "Complete search"): a matched call's face-turn
 * solutions -> exactly the best p.topN results of each RESULT_VIEWS filter
 * among every spelling of every solution (spelling-search.js), plus the
 * call's corpus algs as written. Each solution is luck-filtered once (every
 * spelling solves the same pieces, then a y-family rotation); the node a
 * spelling reaches is read off the physical result per end rotation. Pure,
 * like postProcessCall.
 */
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
    const estimate = SPELLING.plainEstimator(isRoot);
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
    const face = core.split(' ').map(x => TID.get(x));
    const check = checkFacelets(replayTokenIds(startCodes, face), p.allCorners, p.allEdges, claimSets);
    if (!check.ok) {
      if (check.reason.includes('claimed solved but is not actually solved')) {
        console.warn(`Discarding solution: ${check.reason}`, { coreAlg: core, rotation: base });
      }
      continue;
    }
    const sol = { face, core, look: lookCost(check.facelets, check.flags) };
    if (ctx.planWeights) {
      // every spelling ends as this solution then a y-family rotation: its
      // planning cost by that rotation ('', y, y2, y'; enumerate bounds
      // with the least)
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
      // The inspection: a y-family one keeps the step's labels in the frame
      // it starts in (as the y-variants always did); a side-cross one names
      // the slots in the frame the step ends in.
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

/**
 * Joins the calls' candidates in plan order and ranks them. D-alignment
 * (pseudo) can collapse two distinct raw solver results into the same final
 * algorithm, and rotation spellings can differ only in the order of commuting
 * same-axis moves ("y U'" vs "U' y"). Sort first so the best-scoring spelling
 * of each is the one kept.
 */
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

/**
 * The last step of every result list (README "Results table"): one row per
 * solution as written -- inspection rotation plus alg, the exact text a row
 * shows. The same text is the same turns from the same cube, so a later
 * copy (e.g. reached through another DAG edge, or merged in from a search
 * with other options) is dropped; the first, best-ranked one stays. Keeps
 * the list's flags. One pass over the list.
 */
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

/** Two ranked lists as one (TPP order, stable), duplicates dropped; flags of `a`. */
function mergeRanked(a, b) {
  if (!b || !b.length) return a;
  const out = dedupeSolutions(a.concat(b).sort((x, y) => x.tpp - y.tpp));
  const merged = out === a ? a.slice() : out;
  for (const k of ['truncatedCalls', 'failedCalls', 'onlyMultislotPending']) if (a[k]) merged[k] = a[k];
  return merged;
}

// ---------------------------------------------------------------------------
// Look-ahead (README "Look-ahead optimisation depth", PROJECT_STATUS.md §4.31)
// ---------------------------------------------------------------------------

// Depths 4 and 5 were removed: no use for finding a human solution.
const LOOKAHEAD_MAX_DEPTH = 3;
const DEFAULT_LOOKAHEAD_BREADTH = 5;
// Below the first look-ahead level only the best few continuations of each
// node are followed, or depth 3 would need breadth^2 searches.
const LOOKAHEAD_INNER_BREADTH = 2;
// Result lists can hold hundreds of thousands of candidates (10,000 solutions
// per call); keep the memo bounded by entries and by candidates held (~440
// bytes each, so the cap is ~440 MB). A wide look-ahead at that default
// holds more than this; its oldest searches are then searched again if
// needed. A depth-3 look-ahead makes ~16 searches, so the entry limit must
// exceed that or committing an explored candidate searches it again.
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

/**
 * searchCurrentNode, memoised per (node, inspection rotation, committed path)
 * in session.searchMemo -- shared by every fork, so the look-ahead's searches
 * are reused once the user commits one of the candidates it explored.
 * `onPartial` (optional) receives the progressive result lists of the search
 * while it runs -- also when it was started earlier by someone else (a
 * background search the user switched to): it gets the latest list at once.
 */
// memoSearch's key: the node, the committed steps and the search options.
function searchMemoKey(session) {
  return `${session.currentNodeId}|${session.rotation}|${session.stepAlgs.join(' | ')}|${session.searchSettingsKey || ''}`;
}

/**
 * The same step's search with the other wide-moves setting (memoSearch), if
 * the memo has it: { promise, value } (value once it finished).
 */
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
  // The committed steps, not just their joined text: TPP depends on where the
  // steps start (stepPenalty: a y that starts a step is free), and e.g. a
  // multislot "S" and the same moves committed as two single pairs reach the
  // same node with the same text (they used to share one memo entry, so one
  // was shown the other's TPPs).
  // The results-page search options are part of it (searchSettingsKey).
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
  // Stopped once every caller is cancelled (a click or another setting
  // replaced them all): its multislot calls start no more parts and its
  // calls not yet ranked are skipped; it then ends incomplete and is
  // forgotten (searched again if ever needed).
  const interest = new Set([isCancelled]);
  const stop = {
    shouldStop: () => [...interest].every(f => f && f()),
    onStopped: () => { if (promise) promise.stopped = true; },
  };
  let promise;
  // Results-page "wide moves" (README): switched off on a step already
  // searched with them, the step's list is that search's without its wide
  // results -- hidden, not searched again, so switching back shows them at
  // once. Switched on where only the search without them is known, the wide
  // search runs and its results join that list as they come, instead of
  // starting from an empty one.
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

/**
 * `session` with candidate number `i` of its result list committed, for the
 * look-ahead. Its searches are ranked by the path of candidate indices
 * ([2] for the third result, [2, 0] for that one's best follow-up, ...):
 * schedulers that understand ranks (search-scheduler.js, the page's
 * post-processing pool) serve the lowest one first, so the look-ahead of the
 * best results finishes first and the list re-ranks progressively instead of
 * all at the end. Ranks only order the work; results are the same.
 */
function lookaheadFork(session, candidate, i) {
  const s = session.fork(candidate);
  s.lookaheadRank = [...(session.lookaheadRank || []), i];
  return s;
}

/**
 * `results` filtered by `filter` (null = all), keeping the search's flags;
 * with `countHidden`, out.hiddenCount says how many the filter hid.
 */
function filterResults(results, filter, countHidden = false) {
  if (!filter) return results;
  const out = results.filter(filter);
  for (const k of ['truncatedCalls', 'failedCalls', 'onlyMultislotPending']) if (results[k]) out[k] = results[k];
  if (countHidden && out.length < results.length) out.hiddenCount = results.length - out.length;
  return out;
}

/**
 * Best path of up to `levels` further steps from `session`'s node:
 * { tpp, algs } where tpp is the path TPP after the last step (TPP is
 * cumulative, so that IS the combined TPP of the sequence), null when the
 * session is already complete, tpp Infinity when no continuation was found.
 * Only results passing `filter` (null = all) are followed.
 */
async function bestContinuation(session, levels, helper, onStatus, pseudoHelper, deadline, filter = null, isCancelled = null) {
  if (session.isComplete) return null;
  // Nobody wants this look-ahead any more (see searchWithLookahead): start no
  // further searches. Searches already running finish (they are memoised and
  // may be what the replacing search needs).
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

/**
 * searchCurrentNode with look-ahead: the top `breadth` candidates of this
 * step are re-ranked by the combined TPP of the best sequence of `depth`
 * steps that starts with them (this step + depth-1 searched follow-ups);
 * the rest keep their single-step order below them. depth 1 = no look-ahead.
 * Every candidate keeps its own `tpp`; re-ranked ones gain `lookaheadTpp`
 * and `lookaheadAlgs` (the follow-up steps of that best sequence).
 *
 * options.filter (optional predicate) hides results, at this step and in
 * every look-ahead step (the results page's filters).
 * options.lookaheadMultislot (optional) is the multislot setting of the
 * follow-up searches only (false when the filter hides multislots anyway).
 * options.onUpdate (optional) receives progressive lists: the single-step
 * ranking while it is still being searched, then, with look-ahead, the same
 * list with the top block re-ranked as each candidate's look-ahead finishes
 * (finished ones first, by combined TPP; candidates still being looked at
 * carry `lookaheadPending`). The returned list is always the complete one.
 * options.isCancelled (optional) returning true means the caller has dropped
 * this search (another setting or step replaced it): the look-ahead starts no
 * further searches and the returned list is incomplete.
 */
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
  const results = filterResults(await memoSearch(session, helper, onStatus, pseudoHelper, firstDeadline, onPartial, options.isCancelled || ALWAYS_WANTED), filter, true);
  if (depth === 1 || !results.length) return results;

  const top = results.slice(0, breadth);
  const bests = new Array(top.length);
  const rerank = (final) => {
    const done = [];
    const pending = [];
    top.forEach((cand, i) => {
      if (bests[i] === undefined) { pending.push({ ...cand, lookaheadPending: true }); return; }
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
    const out = done.concat(pending, results.slice(breadth));
    if (results.hiddenCount) out.hiddenCount = results.hiddenCount;
    if (results.truncatedCalls) out.truncatedCalls = results.truncatedCalls;
    if (results.failedCalls) out.failedCalls = results.failedCalls;
    if (done.some(r => r.lookaheadTruncated)) out.lookaheadTruncated = true;
    if (!final) out.lookaheadPending = pending.length;
    return out;
  };
  if (onUpdate) onUpdate(rerank(false));
  // The results page searches every step with multislots and hides them with
  // its filter; while they are hidden, follow-ups searched without them give
  // the same look-ahead in half the time (test/search-options-e2e.js).
  const follow = options.lookaheadMultislot === undefined ? session : session.withSettings({ multislot: options.lookaheadMultislot });
  await Promise.all(top.map((cand, i) => {
    const status = onStatus && (msg => onStatus(`look-ahead ${i + 1}/${top.length} (depth ${depth}): ${msg}`));
    return bestContinuation(lookaheadFork(follow, cand, i), depth - 1, helper, status, pseudoHelper, lookDeadline, filter, options.isCancelled || null)
      .then((best) => {
        bests[i] = best;
        if (onUpdate && bests.filter(b => b !== undefined).length < top.length) onUpdate(rerank(false));
      });
  }));
  return rerank(true);
}

/**
 * The root's outgoing target whose solved corners/edges are exactly the given
 * labels (a y/y2/y' root variant reaches the relabelled node, see
 * searchCurrentNode). Cached per session.
 */
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

/**
 * The committed solve as "alg // label" lines, the way pro_references.txt
 * and Cubedb write a solve: the inspection rotation (if any), then one line
 * per step -- "xcross", then "2nd pair", "3rd/4th pairs" (a multislot), ...,
 * counted by the pairs solved after the step; "(pseudo)" for a pseudo step.
 */
function solutionLines(session) {
  const ordinal = n => ['1st', '2nd', '3rd', '4th'][n - 1] || `${n}th`;
  const lines = session.rotation ? [`${session.rotation} // inspection`] : [];
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
    if (row.coreAlg) lines.push(`${row.coreAlg} // ${label}`);
  });
  return lines;
}

/**
 * A Cubedb (cubedb.net) link that replays `lines` on `scramble`. Cubedb keeps
 * the whole solve in the URL: spaces as "_", primes as "-", the rest
 * URL-encoded ("//" comments, one line per step), as in the reference link
 * at the end of data/pro_references.txt.
 */
function cubedbUrl(scramble, lines) {
  const enc = s => encodeURIComponent(String(s).replace(/'/g, '-').replace(/ /g, '_'));
  return `https://cubedb.net/?puzzle=3x3&scramble=${enc(cleanAlgText(scramble))}&alg=${enc(lines.map(cleanAlgText).join('\n'))}`;
}

/** Single spaces, no padding (Cubedb shows "_" runs literally). */
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
    solutionLines, cubedbUrl, corpusSolutions,
  };
}
