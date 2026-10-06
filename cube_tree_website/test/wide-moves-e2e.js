#!/usr/bin/env node
/**
 * Wide moves in first-step results, against the real WASM engine (slow-ish,
 * about a minute; not part of the fast suite). PROJECT_STATUS.md §4.41.
 *
 * Wide r/l first steps are what professionals use (pro_references.txt #2, #6,
 * #7, #8, #12, #13, #16, #17), and the pro move set, cross optimisation and
 * side-cross inspections all generate them -- but from §4.35 to §4.41 a flat
 * +2.35 per r/l buried every one of them below the first page (best Cross
 * with r/l at rank 112, none in the top 100 Cross/XCross results). This
 * checks, on a fixed scramble, that:
 *
 *  - r/l results are generated at the root (engine pro move set, cross
 *    optimisation, side-cross inspections) and reach the first page of 25
 *    results, in the default config and with xcross + xxcross;
 *  - each of the top 100 wide results physically solves the cross plus
 *    exactly as many pairs as its node claims (independent facelet replay),
 *    with the cross on the bottom.
 *
 * Usage: node test/wide-moves-e2e.js
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js']) Object.assign(global, require(path.join(jsRoot, f)));
const { SolveSession, searchWithLookahead } = require(path.join(jsRoot, 'solver-bridge.js'));
const { createEnginePool } = require(path.join(root, 'tools', 'node-engine-pool.js'));

const SCRAMBLE = "R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2";
const PAGE = 25; // results per page (README "Results table")
const WIDE_RL = /(^| )[rl]/;

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); } catch (err) { failures++; console.error(`FAIL: ${name}\n  ${err.stack}`); }
}

function checkPhysically(session, r) {
  const flags = solvedFlags(applyAlgorithm(SOLVED_FACELETS, [session.scramble, r.rotation, r.coreAlg].filter(Boolean).join(' ')));
  const node = session.nodeMap.get(r.targetNodeId).state;
  assert.ok(flags.cross, `${r.rotation} | ${r.coreAlg}: cross not solved on the bottom`);
  const pairs = ['BL', 'BR', 'FR', 'FL'].filter(sl => flags[sl]).length;
  assert.strictEqual(pairs, (node.corners || []).length, `${r.rotation} | ${r.coreAlg}: ${pairs} pairs solved, node claims ${(node.corners || []).length}`);
}

(async () => {
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const h = await createEnginePool('cross', 3);
  for (const steps of [[], ['xcross', 'xxcross']]) {
    const advanced = [...steps, 'cross_opt', 'pro_moves'];
    const s = new SolveSession(SCRAMBLE, pruneGraph(tree, { advanced: [...advanced, 'multislotting'], colors: ['white'] }), ['white'], advanced);
    s.maxSolutions = 500;
    const results = await searchWithLookahead(s, h, null, null, { depth: 1 });
    const label = steps.length ? steps.join(' + ') : 'default config';
    const wide = results.filter(r => WIDE_RL.test(r.coreAlg));
    await test(`${label}: r/l first steps are generated`, () => {
      assert.ok(wide.length > 1000, `only ${wide.length} of ${results.length} results use r/l`);
      // the three sources: the engine's pro move set (wide move after the
      // first turn), side-cross inspections (x/z inspection, wide first turn)
      // and cross optimisation (Cross results)
      assert.ok(wide.some(r => !WIDE_RL.test(r.coreAlg.split(' ')[0])), 'a wide move inside the step');
      assert.ok(wide.some(r => /[xz]/.test(r.rotation) && WIDE_RL.test(r.coreAlg.split(' ')[0])), 'a side-cross inspection with a wide first turn');
      assert.ok(wide.some(r => r.type === 'Cross'), 'a wide Cross');
    });
    await test(`${label}: an r/l first step is on the first page`, () => {
      const rank = results.findIndex(r => WIDE_RL.test(r.coreAlg)) + 1;
      assert.ok(rank >= 1 && rank <= PAGE, `best r/l result at rank ${rank}`);
      console.log(`  best r/l result: #${rank} ${results[rank - 1].type} ${results[rank - 1].rotation} | ${results[rank - 1].coreAlg}; ${results.slice(0, 100).filter(r => WIDE_RL.test(r.coreAlg)).length} in the top 100`);
    });
    await test(`${label}: the top 100 wide results physically solve what they claim`, () => {
      for (const r of wide.slice(0, 100)) checkPhysically(s, r);
    });
  }
  await h.terminate();
  if (failures) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll wide-move tests passed.');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(2); });
