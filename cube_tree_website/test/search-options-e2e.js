#!/usr/bin/env node
/**
 * The results page's search options against the real WASM engine -- slow-ish
 * (about a minute), not part of the fast suite.
 *
 *  - multislot off: on the solver page's tree (which always has the multislot
 *    edges), a later step and its look-ahead give exactly the results of a
 *    tree pruned without "multislotting" (the old config-page checkbox); with
 *    it on, the results equal the multislotting tree's.
 *  - no r2/l2 after step 1: later steps and every look-ahead follow-up contain
 *    no R2/L2, every result still physically solves exactly what its node
 *    says (independent facelet replay), and the root step is unchanged.
 *  - a look-ahead whose caller cancelled it (results page: another setting or
 *    step replaced it) starts no follow-up searches.
 *
 * Usage: node test/search-options-e2e.js
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js']) Object.assign(global, require(path.join(jsRoot, f)));
const { SolveSession, searchWithLookahead, hasR2L2 } = require(path.join(jsRoot, 'solver-bridge.js'));
const { createEnginePool } = require(path.join(root, 'tools', 'node-engine-pool.js'));

const SCRAMBLE = "R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2";
const ser = list => JSON.stringify(list.map(r => [r.color, r.type, r.rotation, r.edges, r.corners, r.coreAlg, r.tpp, r.targetNodeId, r.lookaheadTpp, r.lookaheadAlgs]));

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); } catch (err) { failures++; console.error(`FAIL: ${name}\n  ${err.stack}`); }
}

// What the committed path plus `alg` physically solves must be exactly the
// node's corners/edges (matched config: pairs).
function physicallyExact(session, r) {
  const f = applyAlgorithm(SOLVED_FACELETS, [session.scramble, session.rotation || r.rotation, session.scoredPath, r.coreAlg].filter(Boolean).join(' '));
  const flags = solvedFlags(f);
  const node = session.nodeMap.get(r.targetNodeId).state;
  return flags.cross && ['BL', 'BR', 'FR', 'FL'].every(sl => flags[sl] === (node.corners || []).includes(sl));
}

(async () => {
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const h = await createEnginePool('cross', 3);
  const base = ['xcross', 'pro_moves', 'cross_opt'];
  const withMulti = pruneGraph(tree, { advanced: [...base, 'multislotting'], colors: ['white'] });
  const noMulti = pruneGraph(tree, { advanced: base, colors: ['white'] });
  const session = (t) => { const s = new SolveSession(SCRAMBLE, t, ['white'], base); s.maxSolutions = 100; return s; };

  // A later step: commit the best plain cross (3 pairs left, so multislots exist).
  const rootList = await searchWithLookahead(session(withMulti), h, null, null, {});
  const cross = rootList.find(r => r.type === 'Cross');
  const later = (t) => { const s = session(t); s.commit(cross); return s; };

  await test('multislot off == a tree without multislotting (step and depth-2 look-ahead)', async () => {
    for (const depth of [1, 2]) {
      const off = await searchWithLookahead(later(withMulti), h, null, null, { depth, breadth: 3, multislot: false });
      const old = await searchWithLookahead(later(noMulti), h, null, null, { depth, breadth: 3 });
      assert.ok(off.length > 0);
      assert.ok(off.every(r => r.type === 'Single pair'));
      assert.strictEqual(ser(off), ser(old), `depth ${depth}`);
    }
  });

  await test('multislot on == the multislotting tree, and it adds multislot results', async () => {
    const on = await searchWithLookahead(later(withMulti), h, null, null, { multislot: true });
    const plain = await searchWithLookahead(later(withMulti), h, null, null, {});
    assert.strictEqual(ser(on), ser(plain));
    assert.ok(on.some(r => r.type === 'Multislot'));
  });

  await test('no r2/l2: later steps and look-ahead follow-ups have none, results stay exact', async () => {
    const s = later(withMulti);
    const plain = await searchWithLookahead(s, h, null, null, {});
    assert.ok(plain.some(r => hasR2L2(r.coreAlg)), 'this step has R2/L2 results without the option');
    const res = await searchWithLookahead(s, h, null, null, { noLaterR2L2: true });
    assert.ok(res.length > 0);
    assert.ok(!res.some(r => hasR2L2(r.coreAlg)), 'no R2/L2 in later-step results');
    assert.ok(res.every(r => physicallyExact(s, r)), 'every result physically exact');
    const la = await searchWithLookahead(session(withMulti), h, null, null, { depth: 3, breadth: 3, noLaterR2L2: true });
    const looked = la.filter(r => r.lookaheadAlgs);
    assert.ok(looked.length > 0);
    assert.ok(looked.every(r => r.lookaheadAlgs.every(a => !hasR2L2(a))), 'no R2/L2 in look-ahead follow-ups');
  });

  await test('no r2/l2 does not change the first step', async () => {
    const res = await searchWithLookahead(session(withMulti), h, null, null, { noLaterR2L2: true });
    assert.strictEqual(ser(res), ser(rootList));
    assert.ok(res.some(r => hasR2L2(r.coreAlg)), 'the root may still use R2/L2');
  });

  await test('a cancelled look-ahead starts no follow-up searches', async () => {
    const before = h.stats.length;
    await searchWithLookahead(session(withMulti), h, null, null, {});
    const stepOnly = h.stats.length - before;
    const mid = h.stats.length;
    const res = await searchWithLookahead(session(withMulti), h, null, null, { depth: 3, breadth: 3, isCancelled: () => true });
    assert.strictEqual(h.stats.length - mid, stepOnly, 'only the step\'s own engine calls');
    assert.ok(res.length > 0);
  });

  await h.terminate();
  if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
  console.log('\nAll search-options e2e tests passed.');
})();
