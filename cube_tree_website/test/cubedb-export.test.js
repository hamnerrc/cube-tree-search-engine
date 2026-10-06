#!/usr/bin/env node
/**
 * Cubedb export (solutionLines / cubedbUrl in solver-bridge.js): the link
 * format must be exactly Cubedb's, as in the reference link at the end of
 * data/pro_references.txt, and the step labels must follow the
 * pro_references.txt style. The real-engine round trip (a found solve,
 * exported and decoded, physically solves cross + F2L) is in
 * test/cubedb-export-e2e.js.
 *
 * Run: node test/cubedb-export.test.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const jsRoot = path.join(__dirname, '..', 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js']) Object.assign(global, require(path.join(jsRoot, f)));
const { SolveSession, solutionLines, cubedbUrl } = require(path.join(jsRoot, 'solver-bridge.js'));

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); } catch (err) { failures++; console.error(`FAIL: ${name}\n  ${err.stack}`); }
}

const refText = fs.readFileSync(path.join(__dirname, '..', 'data', 'pro_references.txt'), 'utf8');
const REFERENCE_LINK = refText.match(/https:\/\/cubedb\.net\/\S+/)[0];

test('the reference Cubedb link is rebuilt byte for byte from its scramble and solve', () => {
  const scramble = "U' L2 U L2 B2 D' U' B2 L2 U' F' L2 D R2 U L B' D2 F2 D2 R'";
  const lines = [
    "x' z' // inspection",
    "r' F R2 r' U r D F2 // xxcross",
    "U' U' U' R' U R // 3rd pair",
    "U' R U R' // 4th pair",
    "R U R' U R U2' R' // OLL(CP)",
    'U // AUF',
  ];
  assert.strictEqual(cubedbUrl(scramble, lines), REFERENCE_LINK);
});

test('cubedbUrl: extra whitespace is collapsed, URL-special characters are encoded', () => {
  const url = cubedbUrl("  R  U'\tF ", ["R U R' // a&b #1?"]);
  assert.strictEqual(url, 'https://cubedb.net/?puzzle=3x3&scramble=R_U-_F&alg=R_U_R-_%2F%2F_a%26b_%231%3F');
});

// A session with hand-made committed rows on the real DAG (no engine needed:
// solutionLines only reads rows and node states).
const tree = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
const pruned = pruneGraph(tree, { advanced: ['xcross', 'xxcross', 'xxxcross', 'multislotting', 'full_pseudo'], colors: ['white'] });
const nodeWith = (corners, edges) => pruned.nodes.find(n => n.state.cross_solved
  && JSON.stringify((n.state.corners || []).slice().sort()) === JSON.stringify(corners.slice().sort())
  && JSON.stringify((n.state.edges || []).slice().sort()) === JSON.stringify(edges.slice().sort())).id;
const session = (rows, rotation = '') => {
  const s = new SolveSession('R U F', pruned, ['white'], []);
  rows.forEach((r, i) => s.commit({ rotation: i === 0 ? rotation : '', ...r }));
  return s;
};

test('solutionLines: inspection, first-step type, ordinal pairs, multislot range', () => {
  const s = session([
    { type: 'XCross', coreAlg: "R U R'", targetNodeId: nodeWith(['FR'], ['FR']) },
    { type: 'Single pair', coreAlg: "U L' U L", targetNodeId: nodeWith(['FR', 'FL'], ['FR', 'FL']) },
    { type: 'Multislot', coreAlg: "y R U R' U' R U R'", targetNodeId: nodeWith(['FR', 'FL', 'BR', 'BL'], ['FR', 'FL', 'BR', 'BL']) },
  ], 'x2 y');
  assert.deepStrictEqual(solutionLines(s), [
    'x2 y // inspection',
    "R U R' // xcross",
    "U L' U L // 2nd pair",
    "y R U R' U' R U R' // 3rd/4th pairs",
  ]);
});

test('solutionLines: no inspection line without a rotation; plain cross; pseudo steps marked', () => {
  const s = session([
    { type: 'Cross', coreAlg: "F R D", targetNodeId: nodeWith([], []) },
    { type: 'Single pair (pseudo)', coreAlg: "R U R'", targetNodeId: nodeWith(['FR'], ['FL']) },
  ]);
  assert.deepStrictEqual(solutionLines(s), ['F R D // cross', "R U R' // 1st pair (pseudo)"]);
  assert.deepStrictEqual(solutionLines(session([])), []);
});

if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
console.log('\nAll cubedb export tests passed.');
