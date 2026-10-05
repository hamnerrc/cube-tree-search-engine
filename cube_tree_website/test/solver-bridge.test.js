#!/usr/bin/env node
/**
 * Regression tests for solver-bridge.js's pure helper functions and
 * SolveSession state machine. Does NOT exercise the WASM solver itself
 * (see crossSolver/test/*.test.js and PROJECT_STATUS.md for that) — this
 * covers the rotation-stripping/composition logic and search-limit table
 * that caused real bugs during development (see PROJECT_STATUS §4.7/§4.8).
 *
 * Run: node test/solver-bridge.test.js
 */
const assert = require('assert');
const path = require('path');

// solver-bridge.js expects algSpeed/calculateSolvedPieces/altAlgs/
// isPseudoState/applyAlgorithm/SOLVED_FACELETS/solvedFlags as bare globals
// (shared <script> scope in the browser).
const scriptExports = require(path.join(__dirname, '..', 'js', 'script.js'));
Object.assign(global, scriptExports);
Object.assign(global, require(path.join(__dirname, '..', 'js', 'facelet-cube.js')));
Object.assign(global, require(path.join(__dirname, '..', 'js', 'facelet-flags.js')));
Object.assign(global, require(path.join(__dirname, '..', 'js', 'cross-optimization.js')));

const {
  SolveSession,
  stripLeadingRotation,
  composeRotations,
  searchLimitFor,
  maxSolutionsFor,
  categoryFor,
  DISTANCE1_LIMITS,
  LATER_LIMITS_BY_TOTAL,
  SLOT_INDICES,
  COLOR_ROTATIONS,
  checkCandidateAgainstRealCubeState,
  relabelSlotsForRotation,
  alignPseudoAlg,
  rootTargetByLabels,
} = require(path.join(__dirname, '..', 'js', 'solver-bridge.js'));

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL: ${name}\n  ${err.message}`);
  }
}

// ---------------------------------------------------------------------
// stripLeadingRotation
// ---------------------------------------------------------------------

test('stripLeadingRotation: no rotation present returns the alg unchanged', () => {
  assert.deepStrictEqual(stripLeadingRotation("R U R' U'"), { token: '', rest: "R U R' U'" });
});

test('stripLeadingRotation: strips a single leading rotation token', () => {
  assert.deepStrictEqual(stripLeadingRotation("z2 R U R'"), { token: 'z2', rest: "R U R'" });
});

test('stripLeadingRotation: only strips a leading token, not one mid-sequence', () => {
  assert.deepStrictEqual(stripLeadingRotation("R U y R'"), { token: '', rest: "R U y R'" });
});

test('stripLeadingRotation: does not confuse a face turn (R) with a rotation token', () => {
  assert.deepStrictEqual(stripLeadingRotation("R2 U"), { token: '', rest: 'R2 U' });
});

test('stripLeadingRotation: handles every rotation token variant', () => {
  for (const tok of ['x', "x'", 'x2', 'y', "y'", 'y2', 'z', "z'", 'z2']) {
    assert.strictEqual(stripLeadingRotation(`${tok} R U`).token, tok, `token ${tok} should be stripped`);
  }
});

// ---------------------------------------------------------------------
// composeRotations
// ---------------------------------------------------------------------

test('composeRotations: two empty strings compose to empty', () => {
  assert.strictEqual(composeRotations('', ''), '');
});

test('composeRotations: one empty, one set returns the set one alone', () => {
  assert.strictEqual(composeRotations('z2', ''), 'z2');
  assert.strictEqual(composeRotations('', 'y2'), 'y2');
});

test('composeRotations: both set joins with a space', () => {
  assert.strictEqual(composeRotations('z2', 'y2'), 'z2 y2');
});

// ---------------------------------------------------------------------
// searchLimitFor (PROJECT_STATUS §4.6/§4.8)
// ---------------------------------------------------------------------

test('searchLimitFor: distance-1 limits match the README table exactly', () => {
  assert.strictEqual(searchLimitFor(0, true, 0), 10); // Cross
  assert.strictEqual(searchLimitFor(1, true, 1), 11); // XCross
  assert.strictEqual(searchLimitFor(2, true, 2), 12); // XXCross
  assert.strictEqual(searchLimitFor(3, true, 3), 13); // XXXCross (not spec'd; see §4.6)
});

test('searchLimitFor: later-step limits are keyed by TOTAL pairs in goal, not just new pairs', () => {
  // First single-pair step (1 old... wait, 0 old + 1 new from Cross): total=1
  assert.strictEqual(searchLimitFor(1, false, 1), 10); // matches spec's "single pair: 10"
  // Multislot straight after Cross (0 old + 2 new): total=2
  assert.strictEqual(searchLimitFor(2, false, 2), 12); // matches spec's "multislot: 12"
  // A later single-pair step after 1 pair is already solved: total=2
  assert.strictEqual(searchLimitFor(1, false, 2), 12);
  // A later single-pair step after 2 pairs are solved: total=3 (empirically needed >10; see §4.8)
  assert.strictEqual(searchLimitFor(1, false, 3), 14);
  // Finishing the last pair after 3 are solved: total=4
  assert.strictEqual(searchLimitFor(1, false, 4), 16);
});

test('DISTANCE1_LIMITS and LATER_LIMITS_BY_TOTAL have the expected shape', () => {
  assert.deepStrictEqual(DISTANCE1_LIMITS, { 0: 10, 1: 11, 2: 12, 3: 13 });
  assert.deepStrictEqual(LATER_LIMITS_BY_TOTAL, { 1: 10, 2: 12, 3: 14, 4: 16 });
});

// ---------------------------------------------------------------------
// categoryFor / searchLimitFor + maxSolutionsFor overrides
// (README "Granular search configuration")
// ---------------------------------------------------------------------

test('categoryFor: maps root pair counts to the results-table semantic categories', () => {
  assert.strictEqual(categoryFor(0, true), 'cross');
  assert.strictEqual(categoryFor(1, true), 'xcross');
  assert.strictEqual(categoryFor(2, true), 'xxcross');
  assert.strictEqual(categoryFor(3, true), 'xxxcross');
});

test('categoryFor: maps later-step pair counts to singlePair/multislot', () => {
  assert.strictEqual(categoryFor(1, false), 'singlePair');
  assert.strictEqual(categoryFor(2, false), 'multislot');
  assert.strictEqual(categoryFor(3, false), 'multislot');
});

test('searchLimitFor: with no searchConfig, behaves exactly as before (no override)', () => {
  assert.strictEqual(searchLimitFor(0, true, 0), 10);
  assert.strictEqual(searchLimitFor(1, false, 2), 12);
});

test('searchLimitFor: a matched-category override replaces the default for that category only', () => {
  const cfg = { xcross: { maxLength: 7 } };
  assert.strictEqual(searchLimitFor(1, true, 1, cfg), 7); // overridden
  assert.strictEqual(searchLimitFor(0, true, 0, cfg), 10); // untouched
});

test('searchLimitFor: a pseudo override only applies when isPseudo is true', () => {
  const cfg = { xcrossPseudo: { maxLength: 9 } };
  assert.strictEqual(searchLimitFor(1, true, 1, cfg, true), 9);
  assert.strictEqual(searchLimitFor(1, true, 1, cfg, false), 11); // matched variant untouched
});

test('searchLimitFor: a singlePair/multislot override replaces the WHOLE per-total table for that category', () => {
  const cfg = { multislot: { maxLength: 20 } };
  assert.strictEqual(searchLimitFor(2, false, 2, cfg), 20);
  assert.strictEqual(searchLimitFor(2, false, 4, cfg), 20); // same flat override regardless of total
  assert.strictEqual(searchLimitFor(1, false, 2, cfg), 12); // singlePair untouched, falls back to default
});

test('maxSolutionsFor: falls back to the given default with no override', () => {
  assert.strictEqual(maxSolutionsFor(0, true, null, false, 500), 500);
});

test('maxSolutionsFor: a category override wins over the fallback', () => {
  const cfg = { cross: { maxSolutions: 50 } };
  assert.strictEqual(maxSolutionsFor(0, true, cfg, false, 500), 50);
  assert.strictEqual(maxSolutionsFor(1, true, cfg, false, 500), 500); // different category, untouched
});

// ---------------------------------------------------------------------
// SLOT_INDICES / COLOR_ROTATIONS (verified empirically; see crossSolver/test/*)
// ---------------------------------------------------------------------

test('SLOT_INDICES matches the empirically-verified slot mapping', () => {
  assert.deepStrictEqual(SLOT_INDICES, { BL: 0, BR: 1, FR: 2, FL: 3 });
});

test('COLOR_ROTATIONS matches the empirically-verified color/rotation mapping', () => {
  assert.deepStrictEqual(COLOR_ROTATIONS, {
    white: 'z2', yellow: '', green: "x'", blue: 'x', red: 'z', orange: "z'",
  });
});

// ---------------------------------------------------------------------
// SolveSession state machine (no solver calls — pure state)
// ---------------------------------------------------------------------

function makeTinyTree() {
  return {
    nodes: [
      { id: 'N0', state: { cross_solved: false, corners: [], edges: [] } },
      { id: 'N1', state: { cross_solved: true, corners: [], edges: [] } },
      { id: 'N2', state: { cross_solved: true, corners: ['FR'], edges: ['FR'] } },
      { id: 'N3', state: { cross_solved: true, corners: ['FR', 'FL', 'BL', 'BR'], edges: ['FR', 'FL', 'BL', 'BR'] } },
    ],
    edges: [
      { source: 'N0', target: 'N1', solved_step: { corners: [], edges: [] } },
      { source: 'N1', target: 'N2', solved_step: { corners: ['FR'], edges: ['FR'] } },
      { source: 'N2', target: 'N3', solved_step: { corners: ['FL', 'BL', 'BR'], edges: ['FL', 'BL', 'BR'] } },
    ],
  };
}

test('SolveSession: starts at the unsolved root node', () => {
  const s = new SolveSession('R U', makeTinyTree(), ['white']);
  assert.strictEqual(s.currentNodeId, 'N0');
  assert.strictEqual(s.isAtRoot, true);
  assert.strictEqual(s.isComplete, false);
});

test('SolveSession: commit() sets rotation only on the first (root) commit', () => {
  const s = new SolveSession('R U', makeTinyTree(), ['white']);
  s.commit({ rotation: 'z2', coreAlg: "R' U'", targetNodeId: 'N1' });
  assert.strictEqual(s.rotation, 'z2');
  assert.strictEqual(s.isAtRoot, false);

  // A later commit's `rotation` field must NOT overwrite the locked-in one.
  s.commit({ rotation: 'SHOULD_BE_IGNORED', coreAlg: 'F B', targetNodeId: 'N2' });
  assert.strictEqual(s.rotation, 'z2');
});

test('SolveSession: scoredPath accumulates only core algs, space-joined', () => {
  const s = new SolveSession('R U', makeTinyTree(), ['white']);
  s.commit({ rotation: 'z2', coreAlg: "R' U'", targetNodeId: 'N1' });
  s.commit({ rotation: '', coreAlg: 'F B', targetNodeId: 'N2' });
  assert.strictEqual(s.scoredPath, "R' U' F B");
});

test('SolveSession: outgoingEdges() reflects the current node', () => {
  const s = new SolveSession('R U', makeTinyTree(), ['white']);
  assert.strictEqual(s.outgoingEdges().length, 1);
  assert.strictEqual(s.outgoingEdges()[0].target, 'N1');

  s.commit({ rotation: '', coreAlg: 'X', targetNodeId: 'N1' });
  assert.strictEqual(s.outgoingEdges()[0].target, 'N2');
});

test('SolveSession: isComplete becomes true once all 4 corners/edges are solved', () => {
  const s = new SolveSession('R U', makeTinyTree(), ['white']);
  s.commit({ rotation: '', coreAlg: 'A', targetNodeId: 'N1' });
  s.commit({ rotation: '', coreAlg: 'B', targetNodeId: 'N2' });
  assert.strictEqual(s.isComplete, false);
  s.commit({ rotation: '', coreAlg: 'C', targetNodeId: 'N3' });
  assert.strictEqual(s.isComplete, true);
});

// ---------------------------------------------------------------------
// SolveSession.undo() / canUndo (README "Search tree navigation (undo)")
// ---------------------------------------------------------------------

test('SolveSession: canUndo/undo are false/no-op at the root', () => {
  const s = new SolveSession('R U', makeTinyTree(), ['white']);
  assert.strictEqual(s.canUndo, false);
  assert.strictEqual(s.undo(), false);
  assert.strictEqual(s.currentNodeId, 'N0');
});

test('SolveSession: undo() pops the last commit and steps back one node', () => {
  const s = new SolveSession('R U', makeTinyTree(), ['white']);
  s.commit({ rotation: 'z2', coreAlg: 'A', targetNodeId: 'N1' });
  s.commit({ rotation: '', coreAlg: 'B', targetNodeId: 'N2' });
  assert.strictEqual(s.canUndo, true);

  assert.strictEqual(s.undo(), true);
  assert.strictEqual(s.currentNodeId, 'N1');
  assert.strictEqual(s.scoredPath, 'A');
  assert.strictEqual(s.rotation, 'z2'); // not at root yet -- stays locked in
});

test('SolveSession: undo() back to zero commits re-arms root rotation capture', () => {
  const s = new SolveSession('R U', makeTinyTree(), ['white']);
  s.commit({ rotation: 'z2', coreAlg: 'A', targetNodeId: 'N1' });

  s.undo();
  assert.strictEqual(s.isAtRoot, true);
  assert.strictEqual(s.rotation, ''); // re-armed

  // A fresh root commit with a different rotation must be captured, not
  // ignored -- this is the exact asymmetry a buggy undo could violate.
  s.commit({ rotation: "x'", coreAlg: 'A2', targetNodeId: 'N1' });
  assert.strictEqual(s.rotation, "x'");
});

test('SolveSession: undo() lets a different branch be explored afterward', () => {
  const s = new SolveSession('R U', makeTinyTree(), ['white']);
  s.commit({ rotation: 'z2', coreAlg: 'A', targetNodeId: 'N1' });
  s.commit({ rotation: '', coreAlg: 'B', targetNodeId: 'N2' });
  s.undo();
  assert.strictEqual(s.outgoingEdges()[0].target, 'N2'); // same outgoing options as before B was committed

  // Commit a different algorithm to the SAME target -- a different branch,
  // same node, which undo must make possible again.
  s.commit({ rotation: '', coreAlg: 'DIFFERENT', targetNodeId: 'N2' });
  assert.strictEqual(s.scoredPath, 'A DIFFERENT');
});

// ---------------------------------------------------------------------
// checkCandidateAgainstRealCubeState (luck filtering)
//
// Uses the same "R U R' U'" commutator crossSolver/test/slot-mapping.test.js
// already established (from this project's own real-solver verification):
// from a solved cube it disturbs exactly the FR pair, leaving cross and the
// other three pairs solved.
// ---------------------------------------------------------------------

test('checkCandidateAgainstRealCubeState: an exact, correct solve passes', () => {
  const result = checkCandidateAgainstRealCubeState(
    "R U R' U'", '', '', "U R U' R'", ['BL', 'BR', 'FL', 'FR']
  );
  assert.strictEqual(result.ok, true);
});

test('checkCandidateAgainstRealCubeState: solving more than claimed is discarded as luck', () => {
  // Solved cube, no moves at all -- actually solves cross + all 4 pairs,
  // but this candidate only claims cross (0 pairs).
  const result = checkCandidateAgainstRealCubeState('', '', '', '', []);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /luck/);
});

test('checkCandidateAgainstRealCubeState: claiming a pair that is not actually solved is discarded', () => {
  // The scramble alone leaves FR unsolved; doing nothing else cannot
  // possibly have solved it, no matter what the DAG edge claims.
  const result = checkCandidateAgainstRealCubeState("R U R' U'", '', '', '', ['BL', 'BR', 'FL', 'FR']);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /FR.*not actually solved/);
});

test('checkCandidateAgainstRealCubeState: claiming cross when it is not actually solved is discarded', () => {
  const result = checkCandidateAgainstRealCubeState('R', '', '', '', []);
  assert.strictEqual(result.ok, false);
  assert.match(result.reason, /cross/);
});

test('checkCandidateAgainstRealCubeState: priorPath is included in the replay', () => {
  // Splitting the same solve across two "committed" moves (priorPath +
  // coreAlg) must give the identical result as doing it in one step.
  const result = checkCandidateAgainstRealCubeState(
    "R U R' U'", '', 'U', "R U' R'", ['BL', 'BR', 'FL', 'FR']
  );
  assert.strictEqual(result.ok, true);
});

// ---------------------------------------------------------------------
// relabelSlotsForRotation (PROJECT_STATUS.md §4.11/§4.12 finding #3)
//
// Self-verifying against ground truth rather than a hardcoded table: for
// several different single-pair-disturbing trigger algorithms, compute
// altAlgs' y/y2/y' variants, determine which slot each variant ACTUALLY
// disturbs via facelet-cube.js/facelet-flags.js, and confirm
// relabelSlotsForRotation predicts that same slot from the unrotated
// (original) claim. This is exactly how the mapping was derived in the
// first place -- see PROJECT_STATUS.md §4.12.
// ---------------------------------------------------------------------

function actuallyDisturbedSlot(algorithm) {
  const facelets = applyAlgorithm(SOLVED_FACELETS, algorithm);
  const flags = solvedFlags(facelets);
  const disturbed = ['BL', 'BR', 'FR', 'FL'].filter(slot => !flags[slot]);
  assert.strictEqual(disturbed.length, 1, `expected exactly one disturbed slot for "${algorithm}", got ${disturbed}`);
  return disturbed[0];
}

test('relabelSlotsForRotation: predicts the actually-disturbed slot for every altAlgs variant, across several triggers', () => {
  for (const trigger of ["R U R' U'", "L' U' L U", "B' U' B U", "F' U F U'"]) {
    const variants = altAlgs([trigger]);
    const originalSlot = actuallyDisturbedSlot(variants[0]); // unrotated variant, no token to strip
    for (const variant of variants) {
      const { token: yToken } = stripLeadingRotation(variant);
      const actualSlot = actuallyDisturbedSlot(variant);
      const [predictedSlot] = relabelSlotsForRotation([originalSlot], yToken);
      assert.strictEqual(
        predictedSlot, actualSlot,
        `trigger "${trigger}", token "${yToken}": predicted ${predictedSlot}, actually disturbed ${actualSlot}`
      );
    }
  }
});

test('relabelSlotsForRotation: empty rotation token is a no-op', () => {
  assert.deepStrictEqual(relabelSlotsForRotation(['FR', 'BL'], ''), ['FR', 'BL']);
});

test('relabelSlotsForRotation: four y-rotations is the identity', () => {
  let slots = ['FR', 'FL', 'BL', 'BR'];
  for (let i = 0; i < 4; i++) slots = relabelSlotsForRotation(slots, 'y');
  assert.deepStrictEqual(slots, ['FR', 'FL', 'BL', 'BR']);
});

// ---------------------------------------------------------------------
// Pseudo (mismatched) claims + D-alignment (PROJECT_STATUS.md §4.14)
//
// Fixture below is a REAL pseudoCrossSolver result (not hand-built): scramble
// + rotation + the solver's own text, after alignment. Physically it leaves
// cross solved, corner BL home and edge FR home (verified with
// facelet-cube.js/facelet-flags.js) with no complete pair anywhere -- the
// shape of a genuine pseudo claim {corners:[BL], edges:[FR]}.
// ---------------------------------------------------------------------

const PSEUDO_SCRAMBLE = "R F2 L F' D' B2 D' L2 R' D2 U2 B L' R D' U R' D2 F R";
const PSEUDO_ROT = "z2 y'";
const PSEUDO_ALG = "R' D R U2 L2";

test('checkCandidateAgainstRealCubeState: a genuine pseudo claim (corner BL + edge FR) passes', () => {
  const r = checkCandidateAgainstRealCubeState(PSEUDO_SCRAMBLE, PSEUDO_ROT, '', PSEUDO_ALG, ['BL'], ['FR']);
  assert.deepStrictEqual(r, { ok: true });
});

test('checkCandidateAgainstRealCubeState: the same result fails as a MATCHED claim of either slot', () => {
  assert.strictEqual(checkCandidateAgainstRealCubeState(PSEUDO_SCRAMBLE, PSEUDO_ROT, '', PSEUDO_ALG, ['BL']).ok, false);
  assert.strictEqual(checkCandidateAgainstRealCubeState(PSEUDO_SCRAMBLE, PSEUDO_ROT, '', PSEUDO_ALG, ['FR']).ok, false);
});

test('checkCandidateAgainstRealCubeState: a pseudo claim naming the wrong edge slot is rejected', () => {
  const r = checkCandidateAgainstRealCubeState(PSEUDO_SCRAMBLE, PSEUDO_ROT, '', PSEUDO_ALG, ['BL'], ['BR']);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /BR.*edge/);
});

test('checkCandidateAgainstRealCubeState: omitting claimedEdges means a matched claim (unchanged behavior)', () => {
  const a = checkCandidateAgainstRealCubeState("R U R' U'", '', '', "U R U' R'", ['BL', 'BR', 'FL', 'FR']);
  const b = checkCandidateAgainstRealCubeState("R U R' U'", '', '', "U R U' R'", ['BL', 'BR', 'FL', 'FR'], ['BL', 'BR', 'FL', 'FR']);
  assert.deepStrictEqual(a, b);
});

test('alignPseudoAlg: appends the one D turn that brings cross home', () => {
  // Real pseudo result (see probe in PROJECT_STATUS §4.14): solved only up to a D turn.
  const sc = "F2 D R2 U' R2 D' R2 U R2 F2";
  assert.strictEqual(alignPseudoAlg(sc, '', '', "F2 D' F2"), "F2 D' F2 D");
});

test('alignPseudoAlg: an already-aligned result is returned unchanged', () => {
  const sc = "F2 D R2 U' R2 D' R2 U R2 F2";
  assert.strictEqual(alignPseudoAlg(sc, '', '', "R' F2 R' U' R2"), "R' F2 R' U' R2");
});

test('alignPseudoAlg: merges into a trailing D-family move instead of stacking D D', () => {
  // scramble D then D2 is net D'; one D-family move (D') is enough, not "D2 D".
  assert.strictEqual(alignPseudoAlg('D', '', '', 'D2'), "D'");
  // scramble R undone by R'; the trailing D2 must collapse away entirely.
  assert.strictEqual(alignPseudoAlg('R', '', '', "R' D2"), "R'");
});

test('alignPseudoAlg: returns "" when merging cancels the algorithm entirely', () => {
  // U never touches cross, so the lone D is pure misalignment and cancels to nothing.
  assert.strictEqual(alignPseudoAlg('U', '', '', 'D'), '');
});

test('alignPseudoAlg: returns null when no D turn can align cross', () => {
  assert.strictEqual(alignPseudoAlg('R', '', '', 'U'), null);
});

// ---------------------------------------------------------------------

// ---------------------------------------------------------------------
// rootTargetByLabels (PROJECT_STATUS.md §4.16): a y-variant root candidate
// must commit the node labelled with the slots it physically solves.
// ---------------------------------------------------------------------

test('rootTargetByLabels: finds the root target with exactly the rotated labels (matched and pseudo)', () => {
  const tree = {
    nodes: [
      { id: 'R', state: { cross_solved: false, corners: [], edges: [] } },
      { id: 'A', state: { cross_solved: true, corners: ['BL'], edges: ['BL'] } },
      { id: 'B', state: { cross_solved: true, corners: ['BR'], edges: ['BR'] } },
      { id: 'P', state: { cross_solved: true, corners: ['FL'], edges: ['BR'] } },
      { id: 'X', state: { cross_solved: true, corners: ['BR', 'FR'], edges: ['BR', 'FR'] } },
    ],
    edges: [
      { source: 'R', target: 'A' }, { source: 'R', target: 'B' }, { source: 'R', target: 'P' },
      { source: 'A', target: 'X' },
    ],
  };
  const session = new SolveSession('R U', tree, ['white'], []);
  // DAG says BL; a "y" variant physically solves the relabelled slot.
  assert.deepStrictEqual(relabelSlotsForRotation(['BL'], 'y'), ['BR']);
  assert.strictEqual(rootTargetByLabels(session, ['BR'], ['BR']), 'B');
  assert.strictEqual(rootTargetByLabels(session, ['BL'], ['BL']), 'A');
  assert.strictEqual(rootTargetByLabels(session, ['FL'], ['BR']), 'P');
  // Not a root target -> null (X is only reachable from A).
  assert.strictEqual(rootTargetByLabels(session, ['FR', 'BR'], ['BR', 'FR']), null);
});

// ---------------------------------------------------------------------
// Results-page search options: multislot on/off, no R2/L2 after step 1
// (engine calls observed through a recording fake helper)
// ---------------------------------------------------------------------

const bridge = require(path.join(__dirname, '..', 'js', 'solver-bridge.js'));

test('withoutR2L2 removes exactly R2 and L2 from an engine move list', () => {
  assert.strictEqual(bridge.withoutR2L2('U_U2_R_R2_R-_L_L2_L-_r_r2'), 'U_U2_R_R-_L_L-_r_r2');
  const pro = bridge.withoutR2L2(bridge.PRO_MOVE_RESTRICT).split('_');
  assert.ok(!pro.includes('R2') && !pro.includes('L2'));
  assert.strictEqual(pro.length, bridge.PRO_MOVE_RESTRICT.split('_').length - 2);
});

test('hasR2L2 matches whole R2/L2 tokens only', () => {
  for (const a of ["R2", "U L2", "R U R2 U'", "L2' U", "y R2"]) assert.ok(bridge.hasR2L2(a), a);
  for (const a of ["r2 U", "R U R'", "F2 B2", "U2 R' L'", "l2", ""]) assert.ok(!bridge.hasR2L2(a), a);
});

test('SolveSession.withSettings: a fork with other search options, memo shared, original untouched', () => {
  const s = new SolveSession('R U', makeTinyTree(), ['white']);
  assert.strictEqual(s.multislot, true);
  assert.strictEqual(s.noLaterR2L2, false);
  const t = s.withSettings({ multislot: false, noLaterR2L2: true });
  assert.strictEqual(t.multislot, false);
  assert.strictEqual(t.noLaterR2L2, true);
  assert.strictEqual(s.multislot, true, 'original keeps its options');
  assert.strictEqual(t.searchMemo, s.searchMemo, 'memo shared');
  assert.notStrictEqual(t.searchSettingsKey, s.searchSettingsKey);
  assert.strictEqual(s.withSettings({}).searchSettingsKey, s.searchSettingsKey);
});

async function asyncTests() {
  const fs = require('fs');
  const tree = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const adv = ['xcross', 'multislotting', 'pro_moves'];
  const pruned = pruneGraph(tree, { advanced: adv, colors: ['white'] });
  const calls = [];
  const rec = (pairs) => (...args) => { calls.push({ pairs, opts: args[args.length - 1] }); return Promise.resolve([]); };
  const fake = {
    solveCross: rec(0), solveXcross: rec(1), solveXxcross: rec(2), solveXxxcross: rec(3), solveXxxxcross: rec(4),
  };
  // A fresh engine-call cache each time, so every planned call is observed.
  const run = async (session) => { calls.length = 0; session.engineMemo = new Map(); await bridge.searchCurrentNode(session, fake); return calls.slice(); };
  const atRoot = new SolveSession("R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2", pruned, ['white'], adv);
  const crossTarget = pruned.edges.find(e => e.source === atRoot.rootId && pruned.nodes.find(n => n.id === e.target).state.corners.length === 0).target;
  const later = atRoot.fork({ rotation: 'z2', coreAlg: "R U R'", targetNodeId: crossTarget });

  await atest('multislot off: a later step searches single pairs only; on: multislot calls too', async () => {
    const on = await run(later);
    const off = await run(later.withSettings({ multislot: false }));
    assert.ok(on.some(c => c.pairs >= 2), 'multislot calls with the option on');
    assert.ok(off.length > 0 && off.every(c => c.pairs === 1), 'only single pairs with it off');
    assert.strictEqual(off.length, on.filter(c => c.pairs === 1).length);
  });

  await atest('multislot off leaves the root search unchanged', async () => {
    const a = await run(atRoot);
    const b = await run(atRoot.withSettings({ multislot: false }));
    assert.deepStrictEqual(b, a);
  });

  await atest('no r2/l2: later-step engine calls lose exactly R2 and L2; the root keeps them', async () => {
    const plain = await run(later);
    const restricted = await run(later.withSettings({ noLaterR2L2: true }));
    assert.strictEqual(restricted.length, plain.length);
    restricted.forEach((c, i) => {
      assert.strictEqual(c.opts.allowedMoves, bridge.withoutR2L2(plain[i].opts.allowedMoves));
      assert.notStrictEqual(c.opts.allowedMoves, plain[i].opts.allowedMoves);
    });
    const root = await run(atRoot.withSettings({ noLaterR2L2: true }));
    assert.deepStrictEqual(root, await run(atRoot));
  });

  await atest('engine-call cache: identical calls run once (multislot on reuses the single-pair calls); not under a time limit', async () => {
    const s = later.withSettings({ multislot: false });
    s.engineMemo = new Map();
    calls.length = 0;
    await bridge.searchCurrentNode(s, fake);
    const singles = calls.length;
    await bridge.searchCurrentNode(s, fake);
    assert.strictEqual(calls.length, singles, 'the same search again makes no new engine call');
    const on = s.withSettings({ multislot: true });
    await bridge.searchCurrentNode(on, fake);
    assert.ok(calls.slice(singles).length > 0 && calls.slice(singles).every(c => c.pairs >= 2), 'only the multislot calls are new');
    calls.length = 0;
    await bridge.searchCurrentNode(s, fake, null, null, Date.now() + 60000);
    assert.strictEqual(calls.length, singles, 'with a deadline every call runs');
  });

  await atest('memoised searches are keyed by the committed steps, not just their joined text', async () => {
    // Same node, same move text: two single pairs (the y starts step 2, free)
    // vs one multislot step (the y is mid-step, penalised). Their TPPs differ,
    // so they must not share a search.
    const node = pruned.nodes.find(n => n.state.cross_solved && n.state.corners.length === 3).id;
    const two = later.fork({ rotation: 'z2', coreAlg: "R U R'", targetNodeId: node });
    two.commit({ rotation: 'z2', coreAlg: "y U R U' R'", targetNodeId: node });
    const one = later.fork({ rotation: 'z2', coreAlg: "R U R' y U R U' R'", targetNodeId: node });
    assert.strictEqual(two.scoredPath, one.scoredPath);
    assert.strictEqual(two.currentNodeId, one.currentNodeId);
    assert.ok(Math.abs((one.pathCost('U') - two.pathCost('U')) - STEP_PENALTIES.rotMidY) < 1e-9, 'TPP differs by the mid-step y penalty');
    const a = bridge.memoSearch(two, fake);
    const b = bridge.memoSearch(one, fake);
    assert.notStrictEqual(a, b);
    await Promise.all([a, b]);
  });

  await atest('memoised searches are keyed by the search options', async () => {
    const a = bridge.memoSearch(later, fake);
    const b = bridge.memoSearch(later.withSettings({ multislot: false }), fake);
    const c = bridge.memoSearch(later.withSettings({ noLaterR2L2: true }), fake);
    assert.notStrictEqual(a, b);
    assert.notStrictEqual(a, c);
    assert.notStrictEqual(b, c);
    assert.strictEqual(bridge.memoSearch(later.withSettings({ multislot: true }), fake), a, 'same options -> same search');
    await Promise.all([a, b, c]);
  });
}

async function atest(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL: ${name}\n  ${err.stack}`);
  }
}

asyncTests().then(() => {
  if (failures > 0) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll solver-bridge.js tests passed.');
  process.exit(0);
});
