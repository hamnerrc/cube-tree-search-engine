#!/usr/bin/env node
/**
 * Progressive results and the results-page filters against the real WASM
 * engines (PROJECT_STATUS.md §4.38) -- slow-ish (about a minute), not part of
 * the fast suite.
 *
 *  - partial lists: a search hands out ranked partial lists while its calls
 *    finish, each one ranked like a final list, and the returned list is
 *    identical to a search without listeners.
 *  - a listener that joins a search already running (a background search the
 *    user switched to) gets the latest partial list at once.
 *  - later steps: once only (hidden) multislot calls are left, the partial
 *    list says so and its single-pair rows equal the final ones.
 *  - a search every caller cancelled stops (its multislot calls start no
 *    more parts), ends incomplete and is searched again when asked for; one
 *    another caller still wants completes.
 *  - live look-ahead: the first update is the single-step ranking with the
 *    top block marked pending; the returned list equals a non-streaming one.
 *  - simple-pseudo filter: filtering a full-pseudo search's results on
 *    `fullPseudoOnly` gives exactly the results of the old "simplified
 *    pseudo" mode (pruneGraph dropping full-pseudo-only edges), at the root
 *    and at later steps.
 *
 * Usage: node test/progressive-e2e.js
 */
'use strict';
const { fastLimits } = require('./fast-limits.js');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js']) Object.assign(global, require(path.join(jsRoot, f)));
const { SolveSession, searchCurrentNode, searchWithLookahead, memoSearch } = require(path.join(jsRoot, 'solver-bridge.js'));
const { createEnginePool } = require(path.join(root, 'tools', 'node-engine-pool.js'));
const { createPostProcessPool } = require(path.join(root, 'tools', 'node-postprocess-pool.js'));

const SCRAMBLE = "R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2";
const PSEUDO_SCRAMBLE = "D2 B2 L2 U' R2 D L2 U' B2 D' F' U2 L' F2 R' B U' R2 F' U2";
const ser = list => JSON.stringify(list.map(r => [r.color, r.type, r.rotation, r.edges, r.corners, r.coreAlg, r.tpp, r.targetNodeId, r.lookaheadTpp, r.lookaheadAlgs]));
const isRanked = list => list.every((r, i) => i === 0 || list[i - 1].tpp <= r.tpp);

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); } catch (err) { failures++; console.error(`FAIL: ${name}\n  ${err.stack}`); }
}

(async () => {
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const h = await createEnginePool('cross', 3);
  const ph = await createEnginePool('pseudo', 3);
  const adv = ['xcross', 'xxcross', 'pro_moves', 'cross_opt'];
  const pruned = pruneGraph(tree, { advanced: adv, colors: ['white'] });
  const newSession = () => {
    const s = new SolveSession(SCRAMBLE, pruned, ['white'], adv);
    s.maxSolutions = 100;
    fastLimits(s);
    return s;
  };
  const plain = await searchCurrentNode(newSession(), h, null, null);

  await test('partial lists are ranked, grow, and the final list is unchanged', async () => {
    const partials = [];
    const res = await searchCurrentNode(newSession(), h, null, null, 0, list => partials.push(list));
    assert.ok(partials.length >= 1, 'at least one partial list');
    assert.ok(partials.every(isRanked), 'every partial list is ranked by TPP');
    assert.ok(partials[0].length <= res.length);
    assert.strictEqual(ser(res), ser(plain));
  });

  await test('later step: once only multislot calls are left, the single-pair rows are final', async () => {
    // the real limits: multislot calls (two pairs, up to 12 turns) end last
    // and ranking on a worker pool, as in the app (on the main thread the
    // multislots finish while the single pairs still rank)
    const mAdv = [...adv, 'multislotting'];
    const s = new SolveSession(SCRAMBLE, pruneGraph(tree, { advanced: mAdv, colors: ['white'] }), ['white'], mAdv);
    s.commit(plain.find(r => r.type === 'XCross'));
    const post = await createPostProcessPool(2);
    s.postProcessor = post.process;
    s.postProcessor.workers = post.size;
    const partials = [];
    const res = await searchCurrentNode(s, h, null, null, 0, list => partials.push(list));
    await post.terminate();
    const tail = partials.find(l => l.onlyMultislotPending);
    assert.ok(tail, 'a list flagged onlyMultislotPending');
    const single = list => ser(list.filter(r => !r.multislot));
    assert.strictEqual(single(tail), single(res), 'the rows a solver sees (multislots hidden) equal the final ones');
    assert.ok(!res.onlyMultislotPending, 'the final list is not flagged');
  });

  await test('a search nobody wants stops (and is never reused); one still wanted completes', async () => {
    const mAdv = [...adv, 'multislotting'];
    const tree2 = pruneGraph(tree, { advanced: mAdv, colors: ['white'] });
    const mk = () => {
      const s = new SolveSession(SCRAMBLE, tree2, ['white'], mAdv);
      s.commit(plain.find(r => r.type === 'XCross'));
      return s;
    };
    const ref = await searchCurrentNode(mk(), h, null, null);
    // cancelled as soon as only the multislot calls are left
    const s = mk();
    let cancelled = false;
    const first = memoSearch(s, h, null, null, 0, (list) => { if (list.onlyMultislotPending) cancelled = true; }, () => cancelled);
    const r1 = await first;
    assert.ok(cancelled, 'the multislot tail was reached');
    assert.ok(r1.failedCalls > 0 && first.stopped, 'the stopped search ends incomplete');
    const again = memoSearch(s, h, null, null, 0);
    assert.notStrictEqual(again, first, 'a stopped search is not reused');
    assert.strictEqual(ser(await again), ser(ref), 'searched again in full');
    // two callers: one cancelled, the other still wants it
    const s2 = mk();
    let gone = false;
    const a = memoSearch(s2, h, null, null, 0, (list) => { if (list.onlyMultislotPending) gone = true; }, () => gone);
    const b = memoSearch(s2, h, null, null, 0, null, () => false);
    assert.strictEqual(a, b, 'one search');
    const r2 = await a;
    assert.ok(!r2.failedCalls && !a.stopped, 'still wanted: complete');
    assert.strictEqual(ser(r2), ser(ref));
  });

  await test('a listener joining a running search gets the latest partial list at once', async () => {
    const s = newSession();
    const seen = [];
    const first = memoSearch(s, h, null, null, 0, () => {});
    let joined = false;
    await new Promise((resolve) => {
      const iv = setInterval(() => {
        if (first.latest && !joined) {
          joined = true;
          memoSearch(s, h, null, null, 0, list => seen.push(list));
          clearInterval(iv);
          resolve();
        }
      }, 5);
      first.then(() => { clearInterval(iv); resolve(); });
    });
    const res = await first;
    if (joined) assert.ok(seen.length >= 1 && isRanked(seen[0]), 'joined listener got a ranked list immediately');
    else console.log('  (the search finished before its first partial list; join not exercised)');
    assert.strictEqual(memoSearch(s, h, null, null, 0), first, 'the memo still returns the same search');
    assert.strictEqual(ser(res), ser(plain));
  });

  await test('live look-ahead: pending top block first, final list as without updates', async () => {
    const updates = [];
    const opts = { depth: 2, breadth: 4 };
    const res = await searchWithLookahead(newSession(), h, null, null, { ...opts, onUpdate: list => updates.push(list) });
    const ref = await searchWithLookahead(newSession(), h, null, null, opts);
    assert.strictEqual(ser(res), ser(ref));
    const firstLa = updates.find(u => u.lookaheadPending !== undefined);
    assert.ok(firstLa, 'an update with pending look-ahead');
    assert.strictEqual(firstLa.lookaheadPending, 4);
    assert.ok(firstLa.slice(0, 4).every(r => r.lookaheadPending), 'top block marked pending');
    assert.deepStrictEqual(firstLa.slice(0, 4).map(r => r.coreAlg), plain.slice(0, 4).map(r => r.coreAlg), 'pending block in single-step order');
    assert.ok(updates.every(u => u.length === res.length || u.lookaheadPending === undefined), 'look-ahead updates keep every result');
    assert.ok(res.slice(0, 4).every(r => !r.lookaheadPending && r.lookaheadAlgs), 'final block resolved');
  });

  await test('simple-pseudo filter equals the old simplified-pseudo DAG (root + 2 later steps)', async () => {
    const pAdv = ['xcross', 'multislotting', 'full_pseudo'];
    const full = pruneGraph(tree, { advanced: pAdv, colors: ['green'] });
    const simple = pruneGraph(tree, { advanced: [...pAdv, 'simplified_pseudo'], colors: ['green'] });
    const mk = (t) => { const s = new SolveSession(PSEUDO_SCRAMBLE, t, ['green'], pAdv); s.maxSolutions = 40; return fastLimits(s); };
    let fullS = mk(full);
    let simpleS = mk(simple);
    let sawFullOnly = false;
    for (let step = 0; step < 3; step++) {
      const a = await searchWithLookahead(fullS, h, null, ph, { filter: r => !r.fullPseudoOnly });
      const b = await searchWithLookahead(simpleS, h, null, ph, {});
      const unfiltered = await memoSearch(fullS, h, null, ph);
      if (unfiltered.some(r => r.fullPseudoOnly)) sawFullOnly = true;
      assert.strictEqual(ser(a), ser(b), `step ${step + 1}: filtered full == simplified`);
      // Follow a pseudo result when there is one, to reach mismatched nodes.
      const pick = a.find(r => /pseudo/.test(r.type)) || a[0];
      if (!pick) break;
      fullS = fullS.fork(pick);
      simpleS = simpleS.fork(pick);
      if (fullS.isComplete) break;
    }
    assert.ok(sawFullOnly, 'some step offered full-pseudo-only results (the filter was exercised)');
  });

  await h.terminate();
  await ph.terminate();
  if (failures) { console.error(`${failures} test(s) failed`); process.exit(1); }
  console.log('All progressive-e2e tests passed.');
})().catch((e) => { console.error(e); process.exit(2); });
