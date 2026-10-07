#!/usr/bin/env node
/**
 * The two ways the page moves work off its main thread and out of every
 * engine worker (PROJECT_STATUS.md §4.40), against the real WASM engines --
 * slow-ish (a minute or two), not part of the fast suite.
 *
 *  - Post-processing workers: searches whose engine calls are post-processed
 *    on a worker pool (session.postProcessor, tools/node-postprocess-pool.js,
 *    the Node twin of js/postprocess-worker.js) give exactly the lists of the
 *    same searches post-processed in-thread: root (xcross + xxcross, pseudo
 *    on), a later step, a depth-2 look-ahead, and the no-r2/l2 option.
 *  - Prune-table sharing: tables exported from one engine (tableCacheKeys /
 *    tableCacheGet) and handed to a fresh one (tableCachePut) give that engine
 *    exactly the solutions it finds building its own; a wrong key or size,
 *    or a key it already has, is refused.
 *
 * Usage: node test/offload-e2e.js
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js']) Object.assign(global, require(path.join(jsRoot, f)));
const { SolveSession, searchWithLookahead, PRO_MOVE_RESTRICT, NOOP_MOVES, proEngineOptions } = require(path.join(jsRoot, 'solver-bridge.js'));
const { createEnginePool } = require(path.join(root, 'tools', 'node-engine-pool.js'));
const { createPostProcessPool } = require(path.join(root, 'tools', 'node-postprocess-pool.js'));
const CrossSolverHelperNode = require(path.join(root, 'crossSolver', 'solver-helper-node.js'));

const SCRAMBLE = "R2 D' F2 D L2 B2 U R2 D2 R2 B2 L2 U' R2 B' D' R U B' U R D'";
const ser = list => JSON.stringify(list.map(r => [r.color, r.type, r.rotation, r.edges, r.corners, r.coreAlg, r.tpp, r.targetNodeId, r.fullPseudoOnly, r.lookaheadTpp, r.lookaheadAlgs]));

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); } catch (err) { failures++; console.error(`FAIL: ${name}\n  ${err.stack}`); }
}

(async () => {
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const advanced = ['xcross', 'xxcross', 'full_pseudo', 'pro_moves', 'cross_opt'];
  const pruned = pruneGraph(tree, { advanced: [...advanced, 'multislotting'], colors: ['white'] });
  const h = await createEnginePool('cross', 2);
  const ph = await createEnginePool('pseudo', 2);
  const post = await createPostProcessPool(2);
  const session = (offload, committed = []) => {
    const s = new SolveSession(SCRAMBLE, pruned, ['white'], advanced);
    s.maxSolutions = 60;
    if (offload) s.postProcessor = post.process;
    for (const c of committed) s.commit(c);
    return s;
  };
  const both = async (committed, opts) => {
    const inThread = await searchWithLookahead(session(false, committed), h, null, ph, opts);
    const pooled = await searchWithLookahead(session(true, committed), h, null, ph, opts);
    return [inThread, pooled];
  };

  let rootList;
  await test('post-processing workers == in-thread: root search', async () => {
    const [a, b] = await both([], {});
    assert.ok(a.length > 1000, `root list too short: ${a.length}`);
    assert.strictEqual(ser(b), ser(a));
    rootList = a;
  });

  const cross = () => rootList.find(r => r.type === 'Cross');
  await test('post-processing workers == in-thread: later step and depth-2 look-ahead', async () => {
    const [a, b] = await both([cross()], {});
    assert.ok(a.length > 50);
    assert.strictEqual(ser(b), ser(a));
    const [c, d] = await both([cross()], { depth: 2, breadth: 3 });
    assert.ok(c.some(r => r.lookaheadAlgs && r.lookaheadAlgs.length));
    assert.strictEqual(ser(d), ser(c));
  });

  await test('post-processing workers == in-thread: multislot, wide moves off', async () => {
    const [a, b] = await both([cross()], { multislot: true, wideMoves: false });
    assert.ok(a.length > 50);
    assert.strictEqual(ser(b), ser(a));
  });

  await test('shared prune tables give the same engine output', async () => {
    const A = new CrossSolverHelperNode(); await A.init();
    const B = new CrossSolverHelperNode(); await B.init();
    const opts = { ...proEngineOptions('z2'), rotation: 'z2', maxLength: 11, maxSolutions: 150, noopMoves: NOOP_MOVES, postAlg: '' };
    const calls = [
      ['solveXcross', SCRAMBLE, 1, opts],
      ['solveXxcross', SCRAMBLE, 0, 2, { ...opts, maxLength: 12 }],
      ['solveXxxcross', SCRAMBLE, 0, 1, 3, { ...opts, maxLength: 13, maxSolutions: 40 }],
    ];
    const own = [];
    for (const [m, ...args] of calls) own.push(JSON.stringify(await A[m](...args)));
    const keys = A.Module.tableCacheKeys().split('\n').filter(Boolean);
    assert.ok(keys.some(k => k.startsWith('c|')) && keys.some(k => k.startsWith('e|')) && keys.some(k => k.startsWith('p|')), keys.join(' '));
    let kept = 0;
    for (const k of keys) if (B.Module.tableCachePut(k, A.Module.tableCacheGet(k).slice())) kept++;
    assert.strictEqual(kept, keys.length);
    assert.strictEqual(B.Module.tableCacheKeys(), A.Module.tableCacheKeys());
    for (let i = 0; i < calls.length; i++) {
      const [m, ...args] = calls[i];
      assert.strictEqual(JSON.stringify(await B[m](...args)), own[i], `${m} differs with shared tables`);
    }
    assert.strictEqual(B.Module.tableCachePut(keys[0], A.Module.tableCacheGet(keys[0]).slice()), false, 'a key it has');
    assert.strictEqual(B.Module.tableCachePut('c|3|0,1,2', new Uint8Array(10)), false, 'wrong size');
    assert.strictEqual(B.Module.tableCachePut('c|x|0', new Uint8Array(10)), false, 'bad key');
    assert.strictEqual(B.Module.tableCacheGet('c|99|0,1'), null);
  });

  await h.terminate(); await ph.terminate(); await post.terminate();
  if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
  console.log('\nAll offload e2e tests passed.');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
