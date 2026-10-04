#!/usr/bin/env node
/**
 * Regression tests for the pure, exported functions in script.js
 * (pruneGraph, isPseudoState, calculateSolvedPieces, cleanScramble,
 * altAlgs, scoreAlgorithms).
 *
 * These had zero test coverage before this file, and a real bug
 * (tree_gen.py's extract_solved_slots() mislabeling every node's
 * corners/edges as the literal strings "C"/"E" -- see git history)
 * went undetected specifically because isPseudoState()/pruneGraph()'s
 * behavior on realistic data was never checked. This suite exercises
 * them directly with hand-verified inputs/outputs so a similar
 * regression fails loudly here instead of silently in the browser.
 *
 * Run: node test/script.test.js
 */
const assert = require('assert');
const path = require('path');
const {
  altAlgs,
  cleanScramble,
  isPseudoState,
  calculateSolvedPieces,
  scoreAlgorithms,
  algSpeed,
} = require(path.join(__dirname, '..', 'js', 'script.js'));

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

// pruneGraph is not exported via module.exports (only used in the
// DOMContentLoaded browser path), so pull it out of the file source
// directly for testing rather than duplicating its logic here.
const fs = require('fs');
const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'script.js'), 'utf8');
const pruneGraphMatch = scriptSrc.match(/function pruneGraph\([\s\S]*?\n}\n/);
assert(pruneGraphMatch, 'could not locate pruneGraph source to extract for testing');
// eslint-disable-next-line no-eval
const pruneGraph = eval(`(${pruneGraphMatch[0]})`);

// ---------------------------------------------------------------------
// cleanScramble
// ---------------------------------------------------------------------

test('cleanScramble strips the placeholder word "none" (word-boundary aware)', () => {
  assert.strictEqual(cleanScramble('  R  U   none  '), 'R U');
});

test('cleanScramble does not mangle "none" as a substring of another word', () => {
  assert.strictEqual(cleanScramble('Nonetheless R'), 'Nonetheless R');
});

test('cleanScramble collapses internal whitespace', () => {
  assert.strictEqual(cleanScramble('R    U\tD'), 'R U D');
});

// ---------------------------------------------------------------------
// isPseudoState
// ---------------------------------------------------------------------

test('isPseudoState: empty state is not pseudo', () => {
  assert.strictEqual(isPseudoState({ corners: [], edges: [] }), false);
});

test('isPseudoState: matched single pair is not pseudo', () => {
  assert.strictEqual(isPseudoState({ corners: ['FR'], edges: ['FR'] }), false);
});

test('isPseudoState: mismatched single pair IS pseudo', () => {
  assert.strictEqual(isPseudoState({ corners: ['FR'], edges: ['FL'] }), true);
});

test('isPseudoState: matched two-pair state is not pseudo regardless of array order', () => {
  assert.strictEqual(isPseudoState({ corners: ['FL', 'FR'], edges: ['FR', 'FL'] }), false);
});

test('isPseudoState: unequal corner/edge counts IS pseudo', () => {
  assert.strictEqual(isPseudoState({ corners: ['FR', 'FL'], edges: ['FR'] }), true);
});

// ---------------------------------------------------------------------
// calculateSolvedPieces
// ---------------------------------------------------------------------

test('calculateSolvedPieces: root transition (cross unsolved) adds 4 for the cross', () => {
  const root = { state: { cross_solved: false, corners: [], edges: [] } };
  const target = { state: { cross_solved: true, corners: [], edges: [] } };
  assert.strictEqual(calculateSolvedPieces(root, target), 4);
});

test('calculateSolvedPieces: non-root transition does not double-count the cross', () => {
  const source = { state: { cross_solved: true, corners: [], edges: [] } };
  const target = { state: { cross_solved: true, corners: ['FR'], edges: ['FR'] } };
  assert.strictEqual(calculateSolvedPieces(source, target), 2);
});

test('calculateSolvedPieces: only counts newly-solved pieces, not already-solved ones', () => {
  const source = { state: { cross_solved: true, corners: ['FR'], edges: ['FR'] } };
  const target = { state: { cross_solved: true, corners: ['FR', 'FL'], edges: ['FR', 'FL'] } };
  assert.strictEqual(calculateSolvedPieces(source, target), 2);
});

// ---------------------------------------------------------------------
// altAlgs
// ---------------------------------------------------------------------

test('altAlgs: produces exactly 4 y-rotation variants per input algorithm', () => {
  const result = altAlgs(["R U"]);
  assert.strictEqual(result.length, 4);
});

test('altAlgs: first variant is the original algorithm, unprefixed', () => {
  const result = altAlgs(["R U"]);
  assert.strictEqual(result[0], 'R U');
});

test('altAlgs: y-rotated variants correctly remap R->F->L->B under successive y rotations', () => {
  const result = altAlgs(["R U"]);
  assert.deepStrictEqual(result, ["R U", "y F U", "y2 L U", "y' B U"]);
});

// ---------------------------------------------------------------------
// scoreAlgorithms
// ---------------------------------------------------------------------

test('scoreAlgorithms: returns a finite number for a valid algorithm', () => {
  const [score] = scoreAlgorithms(["R U R' U'"]);
  assert.strictEqual(typeof score, 'number');
  assert.ok(Number.isFinite(score));
});

test('scoreAlgorithms: falls back to the 99.0 penalty for unrecognized move tokens instead of throwing', () => {
  const [score] = scoreAlgorithms(['bogus move xyz']);
  assert.strictEqual(score, 99.0);
});

// Every action has a cost (user decision 2026-10-04, PROJECT_STATUS §4.21).
test('algSpeed: every single move, wide move, slice and rotation has a positive cost', () => {
  const T = [...'UDRLFBudrlfbMESxyz'].flatMap(f => [f, f + "'", f + '2']);
  for (const t of T) assert.ok(algSpeed(t, false, false) > 0, `${t} costs ${algSpeed(t, false, false)}`);
});

test('algSpeed: appending an x rotation always adds cost (2000 random contexts)', () => {
  const T = [...'UDRLFBrlMxyz'].flatMap(f => [f, f + "'", f + '2']);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 2000; i++) {
    const a = Array.from({ length: 1 + Math.floor(rnd() * 10) }, () => T[Math.floor(rnd() * T.length)]).join(' ');
    const base = algSpeed(a, false, false);
    for (const x of ['x', "x'", 'x2']) assert.ok(algSpeed(`${a} ${x}`, false, false) > base, `${a} + ${x}`);
  }
});

// ---------------------------------------------------------------------
// pruneGraph
// ---------------------------------------------------------------------

function makeSyntheticTree() {
  return {
    nodes: [
      { id: 'N0', state: { cross_solved: false, corners: [], edges: [] } },
      { id: 'N1', state: { cross_solved: true, corners: [], edges: [] } },
      { id: 'N2', state: { cross_solved: true, corners: ['FR'], edges: ['FR'] } },
      { id: 'N3', state: { cross_solved: true, corners: ['FR', 'FL'], edges: ['FR', 'FL'] } },
      { id: 'N4', state: { cross_solved: true, corners: ['FR'], edges: ['FL'] } }, // pseudo
      { id: 'N5', state: { cross_solved: true, corners: ['FR', 'BL'], edges: ['FL', 'FR'] } }, // pseudo, different mismatch
      { id: 'N6', state: { cross_solved: true, corners: ['FL', 'FR'], edges: ['FL', 'FR'] } }, // repair of N4
    ],
    edges: [
      { source: 'N0', target: 'N1', solved_step: { corners: [], edges: [] } },
      { source: 'N0', target: 'N2', solved_step: { corners: ['FR'], edges: ['FR'] } },
      { source: 'N0', target: 'N3', solved_step: { corners: ['FR', 'FL'], edges: ['FR', 'FL'] } },
      { source: 'N0', target: 'N4', solved_step: { corners: ['FR'], edges: ['FL'] } },
      { source: 'N1', target: 'N2', solved_step: { corners: ['FR'], edges: ['FR'] } },
      { source: 'N1', target: 'N3', solved_step: { corners: ['FR', 'FL'], edges: ['FR', 'FL'] } },
      { source: 'N4', target: 'N6', solved_step: { corners: ['FL'], edges: ['FR'] }, full_pseudo_only: false },
      { source: 'N4', target: 'N5', solved_step: { corners: ['BL'], edges: ['FR'] }, full_pseudo_only: true },
    ],
  };
}

function edgeKeys(pruned) {
  return pruned.edges.map(e => `${e.source}->${e.target}`).sort();
}

test('pruneGraph: with no advanced options, only plain cross + single-pair non-root transitions survive', () => {
  const pruned = pruneGraph(makeSyntheticTree(), { advanced: [] });
  assert.deepStrictEqual(edgeKeys(pruned), ['N0->N1', 'N1->N2']);
});

test('pruneGraph: xcross option allows the root->1-pair edge', () => {
  const pruned = pruneGraph(makeSyntheticTree(), { advanced: ['xcross'] });
  assert.deepStrictEqual(edgeKeys(pruned), ['N0->N1', 'N0->N2', 'N1->N2']);
});

test('pruneGraph: xcross+xxcross+multislotting allows 2-pair edges too, pseudo still excluded', () => {
  const pruned = pruneGraph(makeSyntheticTree(), { advanced: ['xcross', 'xxcross', 'multislotting'] });
  assert.deepStrictEqual(edgeKeys(pruned), ['N0->N1', 'N0->N2', 'N0->N3', 'N1->N2', 'N1->N3']);
});

test('pruneGraph: full_pseudo includes the mismatched-pair node and its root edge', () => {
  const pruned = pruneGraph(makeSyntheticTree(), { advanced: ['xcross', 'full_pseudo'] });
  assert.deepStrictEqual(edgeKeys(pruned), ['N0->N1', 'N0->N2', 'N0->N4', 'N1->N2', 'N4->N5', 'N4->N6']);
  assert.ok(pruned.nodes.some(n => n.id === 'N4'), 'pseudo node N4 should be present in validNodes');
});

test('pruneGraph: simplified_pseudo keeps only the direct repair out of a mismatched node', () => {
  const pruned = pruneGraph(makeSyntheticTree(), { advanced: ['xcross', 'full_pseudo', 'simplified_pseudo'] });
  assert.deepStrictEqual(edgeKeys(pruned), ['N0->N1', 'N0->N2', 'N0->N4', 'N1->N2', 'N4->N6']);
});

test('pruneGraph: simplified_pseudo without pseudo F2L changes nothing (no mismatched nodes survive)', () => {
  const plain = pruneGraph(makeSyntheticTree(), { advanced: ['xcross'] });
  const simplified = pruneGraph(makeSyntheticTree(), { advanced: ['xcross', 'simplified_pseudo'] });
  assert.deepStrictEqual(edgeKeys(simplified), edgeKeys(plain));
});

test('pruneGraph: without multislotting, a non-root edge solving 2 pairs at once is excluded', () => {
  const pruned = pruneGraph(makeSyntheticTree(), { advanced: ['xcross', 'xxcross'] });
  assert.ok(!edgeKeys(pruned).includes('N1->N3'), 'N1->N3 (2-pair multislot step) should be excluded without multislotting');
});

// ---------------------------------------------------------------------

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll script.js tests passed.');
process.exit(0);
