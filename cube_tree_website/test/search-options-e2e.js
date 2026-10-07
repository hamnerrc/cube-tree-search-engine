#!/usr/bin/env node
/**
 * The results page's search options against the real WASM engine -- slow-ish
 * (about a minute), not part of the fast suite.
 *
 *  - multislot off: on the solver page's tree (which always has the multislot
 *    edges), a later step and its look-ahead give exactly the results of a
 *    tree pruned without "multislotting" (the old config-page checkbox); with
 *    it on, the results equal the multislotting tree's.
 *  - R2/L2 (the old "no r2/l2 after step 1" option is gone; the unorthodox
 *    filter replaces it): later steps still find R2/L2 results, an R2/L2
 *    from a neutral layer is flagged unorthodox, one that swings the layer
 *    from +1 to -1 is not, and the first step is never flagged.
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
const { SolveSession, searchWithLookahead, isUnorthodox } = require(path.join(jsRoot, 'solver-bridge.js'));
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

  await test('R2/L2 in later steps: flagged unorthodox by displacement, results exact', async () => {
    const s = later(withMulti);
    const res = await searchWithLookahead(s, h, null, null, {});
    const halfTurn = res.filter(r => /(^| )[RL]2/.test(r.coreAlg));
    assert.ok(halfTurn.length > 0, 'later steps still use R2/L2');
    assert.ok(res.every(r => !!r.unorthodox === isUnorthodox(r.coreAlg)), 'flag == isUnorthodox');
    assert.ok(halfTurn.some(r => r.unorthodox), 'some R2/L2 from a neutral layer are unorthodox');
    assert.ok(res.every(r => physicallyExact(s, r)), 'every result physically exact');
    console.log(`  ${halfTurn.length} R2/L2 results, ${halfTurn.filter(r => !r.unorthodox).length} orthodox, e.g. ${(halfTurn.find(r => !r.unorthodox) || {}).coreAlg}`);
  });

  await test('the first step is never flagged unorthodox', async () => {
    assert.ok(rootList.some(r => /(^| )[RL]2/.test(r.coreAlg)), 'the root uses R2/L2');
    assert.ok(rootList.every(r => !r.unorthodox));
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
