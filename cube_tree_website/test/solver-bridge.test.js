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
const scriptExports = require(path.join(__dirname, '..', 'script.js'));
Object.assign(global, scriptExports);
Object.assign(global, require(path.join(__dirname, '..', 'facelet-cube.js')));
Object.assign(global, require(path.join(__dirname, '..', 'facelet-flags.js')));

const {
  SolveSession,
  stripLeadingRotation,
  composeRotations,
  searchLimitFor,
  DISTANCE1_LIMITS,
  LATER_LIMITS_BY_TOTAL,
  SLOT_INDICES,
  COLOR_ROTATIONS,
  checkCandidateAgainstRealCubeState,
  relabelSlotsForRotation,
} = require(path.join(__dirname, '..', 'solver-bridge.js'));

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

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll solver-bridge.js tests passed.');
process.exit(0);
