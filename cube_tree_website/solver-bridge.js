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
 * - Pseudo (mismatched) edges are skipped for now — not yet wired up.
 * - Luck filtering (README "Luck filtering") is NOT implemented here.
 *   A solver-probe approach was attempted and reverted — see
 *   PROJECT_STATUS.md §4.9: the "0 onProgress events = already solved"
 *   signal used throughout this file's own verified findings is actually
 *   ambiguous whenever the probe's maxLength is smaller than the TRUE
 *   solution depth (IDA* skips announcing depths it can prove infeasible
 *   via the prune table's lower bound, which looks identical to "already
 *   solved" from the outside). A reliable implementation needs an actual
 *   cube-state check, not a cheap solver probe — see PROJECT_STATUS.md §2
 *   items 3–4 for the recommended approach.
 */
'use strict';

const SLOT_INDICES = { BL: 0, BR: 1, FR: 2, FL: 3 };

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

// Distance-1 limits per README "Search limits" table, keyed by pair count.
// XXXCross=13 is not spec'd; see PROJECT_STATUS §4.6.
const DISTANCE1_LIMITS = { 0: 10, 1: 11, 2: 12, 3: 13 };

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

function searchLimitFor(pairCount, isRoot, totalPairsInGoal) {
  if (isRoot) return DISTANCE1_LIMITS[pairCount];
  return LATER_LIMITS_BY_TOTAL[totalPairsInGoal];
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

/** Which solver method + args to use for a target whose full corner list is `corners`. */
function solverCallFor(helper, corners, scramble, rotation, maxLength, postAlg) {
  const slots = corners.slice().sort().map(c => SLOT_INDICES[c]);
  const opts = { maxSolutions: 20, maxLength, rotation, allowedMoves: MOVE_RESTRICT, postAlg: postAlg || '' };
  switch (slots.length) {
    case 0: return helper.solveCross(scramble, opts);
    case 1: return helper.solveXcross(scramble, slots[0], opts);
    case 2: return helper.solveXxcross(scramble, slots[0], slots[1], opts);
    case 3: return helper.solveXxxcross(scramble, slots[0], slots[1], slots[2], opts);
    case 4: return helper.solveXxxxcross(scramble, opts);
    default: throw new Error(`Unsupported pair count: ${slots.length}`);
  }
}

class SolveSession {
  constructor(scramble, prunedTree, colors) {
    this.scramble = scramble;
    this.tree = prunedTree;
    this.colors = colors; // checked color names, e.g. ['white']
    this.nodeMap = new Map(prunedTree.nodes.map(n => [n.id, n]));
    const unsolved = prunedTree.nodes.find(n => n.state.cross_solved === false);
    this.rootId = unsolved ? unsolved.id : prunedTree.nodes[0].id;
    this.currentNodeId = this.rootId;

    this.rotation = ''; // cumulative setup rotation, fixed after step 1
    this.stepAlgs = []; // each committed step's core alg (rotation-stripped)
    this.committedRows = []; // display rows for the solve-so-far
  }

  get isAtRoot() { return this.currentNodeId === this.rootId; }
  get currentNode() { return this.nodeMap.get(this.currentNodeId); }
  get rootNode() { return this.nodeMap.get(this.rootId); }
  get scoredPath() { return this.stepAlgs.join(' ').trim(); }
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
  }
}

/**
 * Search every outgoing edge of session's current node, dispatch to the
 * appropriate solver, and return a TPP-ranked array of candidate results.
 * `onStatus(message)` is called with human-readable progress updates.
 */
async function searchCurrentNode(session, helper, onStatus) {
  const isRoot = session.isAtRoot;
  let edges = session.outgoingEdges();

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
      const target = session.nodeMap.get(edge.target);
      const key = JSON.stringify([
        (target.state.corners || []).slice().sort(),
        (target.state.edges || []).slice().sort(),
      ]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const candidates = [];

  const colorList = isRoot ? session.colors : [null];

  for (const edge of edges) {
    const targetNode = session.nodeMap.get(edge.target);
    if (typeof isPseudoState === 'function' && isPseudoState(targetNode.state)) continue; // deferred

    const newCorners = (edge.solved_step && edge.solved_step.corners) || [];
    const newEdges = (edge.solved_step && edge.solved_step.edges) || [];
    const pairCount = newCorners.length;

    const allCorners = targetNode.state.corners || [];
    const maxLength = searchLimitFor(pairCount, isRoot, allCorners.length);
    if (maxLength === undefined) continue;

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
      const postAlgForCall = isRoot ? '' : session.scoredPath;

      if (onStatus) onStatus(`Searching ${edgeLabel(pairCount, isRoot)}${color ? ' (' + color + ')' : ''}...`);

      let raw;
      try {
        raw = await solverCallFor(helper, allCorners, scramble, baseRotation, maxLength, postAlgForCall);
      } catch (err) {
        console.error('Solver error', err);
        continue;
      }

      // The engine prefixes every returned solution with `rotation + ' ' +
      // postAlg` verbatim (see solver.cpp) -- strip exactly that known
      // prefix to recover just the new step's algorithm. Dedupe identical
      // algorithms before altAlgs expansion — the solver commonly returns
      // the same algorithm multiple times across its maxSolutions results.
      const knownPrefixParts = [];
      if (baseRotation) knownPrefixParts.push(baseRotation);
      if (postAlgForCall) knownPrefixParts.push(postAlgForCall);
      const knownPrefix = knownPrefixParts.join(' ');

      const uniqueCoreAlgs = new Set();
      for (let sol of raw) {
        sol = (sol || '').trim();
        if (!sol) continue; // "already solved" (empty string) — not a real step here
        let coreAlg = sol;
        if (knownPrefix && sol.startsWith(knownPrefix)) {
          coreAlg = sol.slice(knownPrefix.length).trim();
        }
        if (coreAlg) uniqueCoreAlgs.add(coreAlg);
      }

      // NOTE: luck filtering (README "Luck filtering") is intentionally not
      // applied here. See PROJECT_STATUS.md §4.9 — a solver-probe approach
      // was implemented and reverted after discovering it produces false
      // positives (the "already solved" signal this file's other verified
      // findings rely on is ambiguous when the probe's maxLength is smaller
      // than the true solution depth). Candidates may currently include
      // "lucky" over-solves that should, per spec, be attributed to a
      // different, higher-arity edge instead.
      for (const coreAlg of uniqueCoreAlgs) {
        const variants = isRoot && typeof altAlgs === 'function' ? altAlgs([coreAlg]) : [coreAlg];

        for (const variant of variants) {
          const { token: yToken, rest: finalCoreAlg } = stripLeadingRotation(variant);
          const fullRotation = isRoot ? composeRotations(baseRotation, yToken) : session.rotation;

          if (!finalCoreAlg) continue; // shouldn't happen, but guard

          const scoredAlg = session.scoredPath
            ? session.scoredPath + ' ' + finalCoreAlg
            : finalCoreAlg;
          const tppScore = algSpeed(scoredAlg, false, false) / calculateSolvedPieces(session.rootNode, targetNode);

          candidates.push({
            color: isRoot ? color : (session.committedRows[0] ? session.committedRows[0].color : ''),
            type: edgeTypeLabel(pairCount, isRoot),
            rotation: fullRotation,
            edges: newEdges,
            corners: newCorners,
            coreAlg: finalCoreAlg,
            tpp: Number.isFinite(tppScore) ? tppScore : Infinity,
            targetNodeId: edge.target,
          });
        }
      }
    }
  }

  candidates.sort((a, b) => a.tpp - b.tpp);
  return candidates;
}

function edgeTypeLabel(pairCount, isRoot) {
  if (isRoot) {
    return ['Cross', 'XCross', 'XXCross', 'XXXCross'][pairCount] || `${pairCount}-pair`;
  }
  return pairCount === 1 ? 'Single pair' : 'Multislot';
}

function edgeLabel(pairCount, isRoot) {
  return edgeTypeLabel(pairCount, isRoot);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SolveSession, searchCurrentNode, SLOT_INDICES, COLOR_ROTATIONS, DISTANCE1_LIMITS, LATER_LIMITS_BY_TOTAL, searchLimitFor, stripLeadingRotation, composeRotations };
}
