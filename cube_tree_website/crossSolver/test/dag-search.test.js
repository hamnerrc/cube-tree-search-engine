#!/usr/bin/env node
/**
 * Regression test for the goal-DAG search (PROJECT_STATUS.md §4.41,
 * solver.cpp dag_walk_depth_limited_search): with wide moves and rotations in
 * the move list, the engine searches each piece-state subtree once and replays
 * the original depth-first order over it. Its output must be the original
 * DFS's, byte for byte -- same solutions, same order, same cap -- and the
 * original DFS is still in the binary (setDagSearch(false)), so both run here
 * on the same calls: every F2L class, the pro move set (wide r/l, one x/y
 * rotation) with several frames, a later-step postAlg, the "no R2/L2" list,
 * and one face-only list (where the DAG search is not used at all).
 *
 * Run: node crossSolver/test/dag-search.test.js   (~10 s, real WASM)
 */
'use strict';
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..', '..');
Object.assign(global, require(path.join(root, 'js', 'facelet-cube.js')));
const bridge = require(path.join(root, 'js', 'solver-bridge.js'));
const CrossSolverHelperNode = require(path.join(__dirname, '..', 'solver-helper-node.js'));

const S1 = "R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2";
const S2 = "D2 F2 U' B2 U R2 D' L2 U2 F2 R' D' F' L2 D B R' F2 U' R";
const FACE = 'U_U2_U-_D_D2_D-_L_L2_L-_R_R2_R-_F_F2_F-_B_B2_B-';
const base = { noopMoves: bridge.NOOP_MOVES, postAlg: '' };
const pro = rot => ({ ...base, ...bridge.proEngineOptions(rot), rotation: rot });
const LATER = `U' B U D2 L' B2 U2 F B R U' R' U R' U' R ${bridge.POSTALG_BOUNDARY}`;

const CALLS = [
  ['solveCross', S1, { ...pro('z2'), maxLength: 8, maxSolutions: 300 }],
  ['solveXcross', S1, 2, { ...pro("z2 y'"), maxLength: 10, maxSolutions: 300 }],
  ['solveXcross', S2, 0, { ...pro('x'), maxLength: 10, maxSolutions: 200 }],
  ['solveXxcross', S1, 0, 1, { ...pro('z2'), maxLength: 11, maxSolutions: 300 }],
  ['solveXxcross', S2, 2, 3, { ...pro('z2'), allowedMoves: bridge.withoutR2L2(bridge.proEngineOptions('z2').allowedMoves), maxLength: 11, maxSolutions: 200 }],
  ['solveXxxcross', S1, 1, 2, 3, { ...pro("z2 y'"), postAlg: `U' L U D2 F' L2 U2 R L ${bridge.POSTALG_BOUNDARY}`, maxLength: 12, maxSolutions: 300 }],
  ['solveXxxxcross', S1, { ...pro('z2'), postAlg: LATER, maxLength: 12, maxSolutions: 300 }],
  ['solveXxxxcross', S1, { ...pro('z2'), postAlg: LATER, maxLength: 12, maxSolutions: 2 }],
  ['solveXcross', S1, 2, { ...base, allowedMoves: FACE, rotation: 'z2', maxLength: 9, maxSolutions: 200 }],
];

(async () => {
  const h = new CrossSolverHelperNode();
  await h.init();
  let failures = 0;
  for (const [method, ...args] of CALLS) {
    const out = {};
    for (const dag of [false, true]) {
      h.Module.setDagSearch(dag);
      const t = Date.now();
      out[dag] = { sols: await h[method](...args), ms: Date.now() - t };
    }
    h.Module.setDagSearch(true);
    const label = `${method}(${args.slice(1, -1).join(',')}) len ${args[args.length - 1].maxLength}`;
    try {
      assert.ok(out[false].sols.length > 0, 'the call finds solutions');
      assert.deepStrictEqual(out[true].sols, out[false].sols);
      console.log(`PASS: ${label}: ${out[true].sols.length} identical solutions (DFS ${out[false].ms} ms, DAG ${out[true].ms} ms)`);
    } catch (err) {
      failures++;
      console.log(`FAIL: ${label}: ${err.message.split('\n')[0]}`);
    }
  }
  if (failures) {
    console.log(`\n${failures} call(s) differ.`);
    process.exit(1);
  }
  console.log('\nThe DAG search matches the original DFS on every call.');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(2); });
