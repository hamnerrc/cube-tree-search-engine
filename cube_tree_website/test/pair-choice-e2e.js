#!/usr/bin/env node
/**
 * Pair choice (README "Pair choice") against the real WASM engine (about a
 * minute, not part of the fast suite): every candidate's TPP is
 *   (path cost + PAIR_CHOICE_LOOK . features) / pieces
 * with the features recomputed from an independent facelet replay of
 * scramble + inspection + path + alg; spellings of one alg share the features. Root and later steps, with test
 * weights and with the app's.
 *
 * Usage: node test/pair-choice-e2e.js
 */
'use strict';
const { fastLimits } = require('./fast-limits.js');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js', 'pro-steps.js']) Object.assign(global, require(path.join(jsRoot, f)));
const { SolveSession, searchWithLookahead } = require(path.join(jsRoot, 'solver-bridge.js'));
const { createEnginePool } = require(path.join(root, 'tools', 'node-engine-pool.js'));

const SCRAMBLE = "U' F2 U' B2 D' L2 B2 R2 U2 F2 U F R2 D2 B' U L R U R B' F'";

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); } catch (err) { failures++; console.error(`FAIL: ${name}\n  ${err.stack}`); }
}

function checkList(s, list, n) {
  let nonzero = 0;
  for (const r of list.slice(0, n)) {
    const node = s.nodeMap.get(r.targetNodeId);
    const pieces = calculateSolvedPieces(s.rootNode, node);
    const f = applyAlgorithm(SOLVED_FACELETS, [s.scramble, s.isAtRoot ? r.rotation : s.rotation, s.scoredPath, r.coreAlg].filter(Boolean).join(' '));
    const W = s.planning === false ? PAIR_CHOICE_LOOK : PAIR_PLANNING.look;
    let look = pairLookFeatures(f).reduce((t, x, k) => t + x * W[k], 0);
    // pair planning: the cube as the step leaves it held
    if (s.planning !== false) look += planFeatures(f).reduce((t, x, k) => t + x * PAIR_PLANNING.plan[k], 0);
    if (look) nonzero++;
    const want = (s.pathCost(r.coreAlg) + look) / pieces;
    assert.ok(Math.abs(r.tpp - want) < 1e-9, `${r.rotation} | ${r.coreAlg}: tpp ${r.tpp}, expected ${want}`);
  }
  return nonzero;
}

(async () => {
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const h = await createEnginePool('cross', 2);
  const advanced = ['xcross', 'xxcross', 'cross_opt', 'pro_moves'];
  const pruned = pruneGraph(tree, { advanced: [...advanced, 'multislotting'], colors: ['white'] });
  const appLook = PAIR_CHOICE_LOOK.slice();
  const setWeights = (w) => { w.forEach((x, i) => { PAIR_CHOICE_LOOK[i] = x; }); };
  for (const [label, w, planning] of [
    ['test weights, planning off', [0.3, 0.5, 0.7, -1.1, -1.3], false],
    ['app weights, planning off', appLook, false],
    ['app weights, planning on', appLook, true],
  ]) {
    setWeights(w);
    const s = new SolveSession(SCRAMBLE, pruned, ['white'], advanced);
    s.planning = planning;
    s.maxSolutions = 300;
    fastLimits(s);
    const rootList = await searchWithLookahead(s, h, null, null, { depth: 1 });
    await test(`${label}: first-step TPPs include the pair-choice terms`, () => {
      const nz = checkList(s, rootList, 400);
      if (label.startsWith('test weights')) assert.ok(nz > 200, `${nz} of 400 with a nonzero term`);
    });
    s.commit(rootList.find(r => r.type === 'XCross'));
    const later = await searchWithLookahead(s, h, null, null, { depth: 1 });
    await test(`${label}: later-step TPPs include them, spellings included`, () => {
      const nz = checkList(s, later, 600);
      if (label.startsWith('test weights')) assert.ok(nz > 300, `${nz} of 600 with a nonzero term`);
      assert.ok(later.slice(0, 600).some(r => /^[yu]|f|d/.test(r.coreAlg)), 'spellings among them');
    });
  }
  setWeights(appLook);
  await h.terminate();
  if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
  console.log('\nAll pair-choice e2e tests passed.');
})();
