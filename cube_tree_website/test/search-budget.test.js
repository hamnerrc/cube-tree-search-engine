#!/usr/bin/env node
/**
 * The per-search time budget (README "Performance goal", PROJECT_STATUS.md
 * §4.36), against a stub engine (no WASM): every call gets the deadline,
 * calls start cheapest first under a budget (plan order without one), a call
 * finishing late below its cap marks the results truncated, calls finishing
 * after the post-processing stop are dropped, and a truncated search is not
 * kept in the look-ahead memo.
 *
 * Run: node test/search-budget.test.js
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const js = path.join(__dirname, '..', 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js']) Object.assign(global, require(path.join(js, f)));
const { SolveSession, searchCurrentNode, memoSearch, callCostRank, SEARCH_ENGINE_SHARE } = require(path.join(js, 'solver-bridge.js'));

const tree = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
const SCRAMBLE = "R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2";

/** Stub engine: records each call; `delay(method)` ms before resolving with no solutions. */
function stubEngine(delay = () => 0) {
  const calls = [];
  const h = { __gated: true, calls };
  for (const m of ['solveCross', 'solveXcross', 'solveXxcross', 'solveXxxcross', 'solveXxxxcross']) {
    h[m] = (...args) => {
      calls.push({ method: m, opts: args[args.length - 1] });
      return new Promise(r => setTimeout(() => r([]), delay(m)));
    };
  }
  return h;
}
const newSession = (budgetMs) => {
  const adv = ['xcross', 'xxcross'];
  const s = new SolveSession(SCRAMBLE, pruneGraph(tree, { advanced: adv, colors: ['white'] }), ['white'], adv);
  s.timeBudgetMs = budgetMs;
  return s;
};

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); } catch (err) { failures++; console.error(`FAIL: ${name}\n  ${err.stack}`); }
}

(async () => {
  await test('no budget: no deadline option, calls start in plan order, results not flagged', async () => {
    const h = stubEngine();
    const res = await searchCurrentNode(newSession(0), h, null, null);
    assert.ok(h.calls.length > 1);
    assert.ok(h.calls.every(c => !('deadline' in c.opts)));
    // Plan (DAG edge) order: here it does not start with the cheap Cross call.
    assert.notStrictEqual(h.calls[0].method, 'solveCross');
    assert.strictEqual(res.truncatedCalls, undefined);
  });

  await test('budget: every call carries the same deadline, at the engine share of the budget', async () => {
    const h = stubEngine();
    const t0 = Date.now();
    await searchCurrentNode(newSession(10000), h, null, null);
    const ds = new Set(h.calls.map(c => c.opts.deadline));
    assert.strictEqual(ds.size, 1);
    const d = [...ds][0];
    assert.ok(Math.abs(d - (t0 + 10000 * SEARCH_ENGINE_SHARE)) < 200, `deadline ${d - t0} ms after start`);
  });

  await test('budget: calls start cheapest first (XXCross calls last)', async () => {
    const h = stubEngine();
    await searchCurrentNode(newSession(10000), h, null, null);
    const order = h.calls.map(c => c.method);
    const firstXx = order.indexOf('solveXxcross');
    assert.ok(firstXx > 0 && order.slice(firstXx).every(m => m === 'solveXxcross'), order.join(','));
    assert.strictEqual(order[0], 'solveCross');
    // A pseudo XCross ranks after a matched XXCross is not required, but more pairs always cost more.
    assert.ok(callCostRank({ allCorners: ['FR', 'BR'], isPseudo: false, maxLength: 12 }, true) > callCostRank({ allCorners: ['FR'], isPseudo: false, maxLength: 11 }, true));
  });

  await test('budget: a call finishing after the deadline below its cap marks the results truncated', async () => {
    const h = stubEngine(m => (m === 'solveXxcross' ? 400 : 0));
    const res = await searchCurrentNode(newSession(200), h, null, null);
    assert.ok(res.truncatedCalls >= 1, `truncatedCalls ${res.truncatedCalls}`);
  });

  await test('budget: calls that finish after the post-processing stop are dropped and counted', async () => {
    // Every call reaches its cap (3 solutions), so only the post-processing
    // stop (engine share + POST_SHARE of the rest: 950 ms of 1000) can cut it.
    const calls = [];
    const h = { __gated: true };
    for (const m of ['solveCross', 'solveXcross', 'solveXxcross', 'solveXxxcross', 'solveXxxxcross']) {
      h[m] = () => { calls.push(m); return new Promise(r => setTimeout(() => r(["R U R'", "R U' R'", "F R F'"]), 1000)); };
    }
    const session = newSession(1000);
    session.maxSolutions = 3;
    const t0 = Date.now();
    const res = await searchCurrentNode(session, h, null, null);
    assert.strictEqual(res.length, 0);
    assert.strictEqual(res.truncatedCalls, calls.length);
    assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
  });

  await test('memoSearch drops a truncated search, keeps a complete one', async () => {
    const slow = stubEngine(m => (m === 'solveXxcross' ? 400 : 0));
    const s1 = newSession(200);
    await memoSearch(s1, slow, null, null);
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(s1.searchMemo.size, 0);
    const s2 = newSession(0);
    await memoSearch(s2, stubEngine(), null, null);
    await new Promise(r => setTimeout(r, 0));
    assert.strictEqual(s2.searchMemo.size, 1);
  });

  if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
  console.log('\nAll search-budget tests passed.');
  process.exit(0);
})();
