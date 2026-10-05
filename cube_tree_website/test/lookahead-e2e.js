#!/usr/bin/env node
/**
 * Look-ahead (searchWithLookahead) against the real WASM engine -- slow-ish,
 * not part of the fast suite. Independently re-derives every number:
 *
 *  - depth 2: each re-ranked candidate's lookaheadTpp is the best TPP of a
 *    FRESH session (no shared memo) that committed it and searched once;
 *    re-ranked rows are sorted by it; the rest keep single-step order.
 *  - depth 3: each lookaheadAlgs sequence, replayed by committing those exact
 *    candidates in fresh sessions, reaches exactly lookaheadTpp.
 *  - committing a candidate the look-ahead explored reuses its search (memo).
 *
 * Usage: node test/lookahead-e2e.js [--pro]
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');
Object.assign(global, require(path.join(jsRoot, 'script.js')));
Object.assign(global, require(path.join(jsRoot, 'facelet-cube.js')));
Object.assign(global, require(path.join(jsRoot, 'facelet-flags.js')));
Object.assign(global, require(path.join(jsRoot, 'cross-optimization.js')));
const { SolveSession, searchCurrentNode, searchWithLookahead, memoSearch } = require(path.join(jsRoot, 'solver-bridge.js'));
const CrossSolverHelperNode = require(path.join(root, 'crossSolver', 'solver-helper-node.js'));

const SCRAMBLE = "R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2";
const advanced = process.argv.includes('--pro') ? ['pro_moves'] : [];

(async () => {
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const pruned = pruneGraph(tree, { advanced: ['xcross', 'multislotting', ...advanced], colors: ['white'] });
  const h = new CrossSolverHelperNode(); await h.init();
  const newSession = () => new SolveSession(SCRAMBLE, pruned, ['white'], advanced);
  const close = (a, b) => Math.abs(a - b) < 1e-9 || (a === Infinity && b === Infinity);

  /** Fresh sessions, no memo: commit `rows` one search at a time, matching by alg. */
  async function replay(firstRow, algs) {
    let s = newSession();
    s.commit(firstRow);
    let last = null;
    for (const alg of algs) {
      const res = await searchCurrentNode(s, h, null);
      last = res.find(r => r.coreAlg === alg);
      assert.ok(last, `look-ahead alg ${alg} is a real result of the follow-up search`);
      s = s.fork(last);
    }
    return last;
  }

  // --- depth 2 at the root ---
  const s = newSession();
  const single = await searchCurrentNode(newSession(), h, null);
  const t0 = Date.now();
  const la = await searchWithLookahead(s, h, null, null, { depth: 2, breadth: 4 });
  console.log(`depth 2, breadth 4: ${la.length} results, ${Date.now() - t0} ms`);
  assert.strictEqual(la.length, single.length);
  const top = la.slice(0, 4);
  assert.deepStrictEqual(top.map(r => r.coreAlg).sort(), single.slice(0, 4).map(r => r.coreAlg).sort(), 'the top 4 are re-ranked among themselves');
  assert.deepStrictEqual(la.slice(4).map(r => r.coreAlg), single.slice(4).map(r => r.coreAlg), 'the rest keep single-step order');
  for (let i = 1; i < top.length; i++) assert.ok(top[i - 1].lookaheadTpp <= top[i].lookaheadTpp, 'sorted by lookaheadTpp');
  for (const r of top) {
    const fresh = newSession(); fresh.commit(r);
    const next = await searchCurrentNode(fresh, h, null);
    assert.ok(close(r.lookaheadTpp, next[0].tpp), `lookaheadTpp ${r.lookaheadTpp} == best follow-up ${next[0].tpp}`);
    console.log(`  ${r.coreAlg.padEnd(28)} step TPP ${r.tpp.toFixed(3)} -> combined ${r.lookaheadTpp.toFixed(3)} via ${r.lookaheadAlgs.join(' | ')}`);
  }
  const reordered = top.some((r, i) => r.coreAlg !== single[i].coreAlg);
  console.log(`  look-ahead ${reordered ? 'changed' : 'kept'} the order of the top 4`);

  // Committing an explored candidate reuses the look-ahead's search.
  s.commit(top[0]);
  const t1 = Date.now();
  const memoHit = await memoSearch(s, h, null, null);
  assert.ok(Date.now() - t1 < 50, 'memo hit');
  assert.strictEqual(memoHit[0].coreAlg, top[0].lookaheadAlgs[0]);

  // --- depth 3 at the root, breadth 2 ---
  const t2 = Date.now();
  const la3 = await searchWithLookahead(newSession(), h, null, null, { depth: 3, breadth: 2 });
  console.log(`depth 3, breadth 2: ${Date.now() - t2} ms`);
  for (const r of la3.slice(0, 2)) {
    assert.ok(r.lookaheadAlgs.length >= 1 && r.lookaheadAlgs.length <= 2);
    const last = await replay(r, r.lookaheadAlgs);
    assert.ok(close(last.tpp, r.lookaheadTpp), `replayed sequence TPP ${last.tpp} == ${r.lookaheadTpp}`);
    console.log(`  ${r.coreAlg.padEnd(28)} combined ${r.lookaheadTpp.toFixed(3)} via ${r.lookaheadAlgs.join(' | ')}`);
  }

  console.log('\nAll look-ahead e2e checks passed.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
