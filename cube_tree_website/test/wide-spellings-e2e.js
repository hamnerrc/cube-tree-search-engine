#!/usr/bin/env node
/**
 * Wide-move spellings, the wide-moves option, unorthodox steps and duplicate
 * rows, against the real WASM engine (a few minutes; not part of the fast
 * suite). PROJECT_STATUS.md §4.43.
 *
 * On two scrambles, committing the best result step by step, it checks that:
 *  - later steps list u/d/f/b spellings (wideSpellingParts: "f R' f'" for
 *    "B U' B'", "u R U' R'" for "D y R U' R'") and some reach the first page;
 *  - every u/d/f/b result physically solves exactly what its node claims
 *    (independent facelet replay of scramble + inspection + path + result);
 *  - no list has two rows with the same inspection rotation and alg;
 *  - unorthodox results are flagged on later steps only, and the results
 *    page's filter hides them at the step and in the look-ahead;
 *  - wide moves off: a step searched with them shows that list without its
 *    wide results and makes no engine call; a step first searched without
 *    them, switched on, keeps every result it had and adds wide ones.
 * With --pseudo, also a full-pseudo solve (slow: pseudo root searches).
 *
 * Usage: node test/wide-spellings-e2e.js [--pseudo]
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js']) Object.assign(global, require(path.join(jsRoot, f)));
const B = require(path.join(jsRoot, 'solver-bridge.js'));
const { createEnginePool } = require(path.join(root, 'tools', 'node-engine-pool.js'));

const SCRAMBLES = [
  "R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2",
  "B R' F2 U L2 D' R2 D2 F2 U' B2 F2 R2 U2 R' D' F D U' F L2",
];
const PAGE = 25;
const UDFB = /(^| )[udfb]/;
const SLOTS = ['BL', 'BR', 'FR', 'FL'];

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); } catch (err) { failures++; console.error(`FAIL: ${name}\n  ${err.stack}`); }
}

// Counts engine calls (to show a hidden list needs none).
function counting(pool) {
  const counter = { calls: 0 };
  counter.helper = new Proxy(pool, {
    get(t, p) {
      const v = t[p];
      if (typeof v !== 'function') return v;
      if (typeof p === 'string' && p.startsWith('solve')) return (...a) => { counter.calls++; return v.apply(t, a); };
      return v.bind(t);
    },
  });
  return counter;
}

function checkPhysically(session, r) {
  const rotation = session.isAtRoot ? r.rotation : session.rotation;
  const fac = applyAlgorithm(SOLVED_FACELETS, [session.scramble, rotation, session.scoredPath, r.coreAlg].filter(Boolean).join(' '));
  const node = session.nodeMap.get(r.targetNodeId).state;
  const flags = solvedFlags(fac);
  const piece = pseudoSolvedFlags(fac);
  const corners = node.corners || [];
  const edges = node.edges || [];
  const what = `${rotation} | ${session.scoredPath} | ${r.coreAlg} -> ${JSON.stringify([corners, edges])}`;
  assert.ok(flags.cross, `${what}: cross not solved on the bottom`);
  for (const sl of SLOTS) {
    assert.strictEqual(flags[sl], corners.includes(sl) && edges.includes(sl), `${what}: slot ${sl}`);
    if (corners.includes(sl)) assert.ok(piece.cornerAt[sl], `${what}: corner ${sl}`);
    if (edges.includes(sl)) assert.ok(piece.edgeAt[sl], `${what}: edge ${sl}`);
  }
}

function exactDupes(list) {
  const seen = new Set();
  let n = 0;
  for (const r of list) {
    const k = `${r.rotation}|${r.coreAlg}`;
    if (seen.has(k)) n++;
    seen.add(k);
  }
  return n;
}

async function solveAndCheck(label, session, h, ph) {
  let bestWideRank = Infinity;
  let laterWide = 0;
  let checked = 0;
  for (let step = 0; !session.isComplete && step < 6; step++) {
    const results = await B.searchWithLookahead(session, h, null, ph, { depth: 1 });
    assert.ok(results.length, `${label} step ${step}: no results`);
    assert.strictEqual(exactDupes(results), 0, `${label} step ${step}: duplicate rows`);
    if (session.isAtRoot) {
      assert.ok(!results.some(r => r.unorthodox), `${label}: a first-step result is flagged unorthodox`);
    } else {
      for (const r of results) assert.strictEqual(!!r.unorthodox, B.isUnorthodox(r.coreAlg), r.coreAlg);
      const wide = results.filter(r => UDFB.test(r.coreAlg));
      laterWide += wide.length;
      bestWideRank = Math.min(bestWideRank, results.findIndex(r => UDFB.test(r.coreAlg)) + 1 || Infinity);
      for (const r of wide) { checkPhysically(session, r); checked++; }
    }
    session.commit(results[0]);
  }
  return { bestWideRank, laterWide, checked };
}

(async () => {
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const pool = await createEnginePool('cross', 3);
  const adv = ['xcross', 'cross_opt', 'pro_moves'];
  const pruned = pruneGraph(tree, { advanced: [...adv, 'multislotting'], colors: ['white'] });
  const newSession = (scr) => {
    const s = new B.SolveSession(scr, pruned, ['white'], adv);
    s.maxSolutions = 300;
    s.multislot = false;
    return s;
  };

  let best = Infinity;
  for (const scr of SCRAMBLES) {
    await test(`later steps list u/d/f/b spellings that solve exactly what they claim (${scr.slice(0, 20)}…)`, async () => {
      const { bestWideRank, laterWide, checked } = await solveAndCheck(scr, newSession(scr), pool, null);
      assert.ok(laterWide > 100, `only ${laterWide} later-step u/d/f/b results`);
      best = Math.min(best, bestWideRank);
      console.log(`  ${laterWide} later-step u/d/f/b results (${checked} replayed), best at rank ${bestWideRank}`);
    });
  }
  await test('a u/d/f/b later step reaches the first page', () => {
    assert.ok(best <= PAGE, `best u/d/f/b result at rank ${best}`);
  });

  await test('hide unorthodox: the filter hides them at the step and in the look-ahead', async () => {
    const s = newSession(SCRAMBLES[1]);
    s.commit((await B.searchWithLookahead(s, pool, null, null, { depth: 1 }))[0]);
    const all = await B.searchWithLookahead(s, pool, null, null, { depth: 1 });
    assert.ok(all.some(r => r.unorthodox), 'no unorthodox result to hide');
    const filtered = await B.searchWithLookahead(s, pool, null, null, { depth: 3, breadth: 3, filter: r => !r.unorthodox });
    assert.ok(!filtered.some(r => r.unorthodox));
    assert.strictEqual(filtered.hiddenCount, all.filter(r => r.unorthodox).length, 'hiddenCount');
    for (const r of filtered.slice(0, 3)) {
      for (const a of r.lookaheadAlgs || []) assert.ok(!B.isUnorthodox(a), `look-ahead follow-up ${a} is unorthodox`);
    }
  });

  await test('wide moves off on a searched step: the same list without wide results, no engine call', async () => {
    const s = newSession(SCRAMBLES[0]);
    s.commit((await B.searchWithLookahead(s, pool, null, null, { depth: 1 }))[0]);
    const on = await B.searchWithLookahead(s, pool, null, null, { depth: 1 });
    assert.ok(on.some(r => B.isWideAlg(r.coreAlg)));
    const c = counting(pool);
    const off = await B.searchWithLookahead(s, c.helper, null, null, { depth: 1, wideMoves: false });
    assert.strictEqual(c.calls, 0, 'engine calls');
    assert.deepStrictEqual(off.map(r => r.coreAlg), on.filter(r => !B.isWideAlg(r.coreAlg)).map(r => r.coreAlg));
    const again = await B.searchWithLookahead(s, c.helper, null, null, { depth: 1, wideMoves: true });
    assert.strictEqual(c.calls, 0, 'switched back on: nothing searched again');
    assert.strictEqual(again.length, on.length);
  });

  await test('wide moves switched on after a search without them: every result kept, wide ones added', async () => {
    const s = newSession(SCRAMBLES[0]);
    const offRoot = await B.searchWithLookahead(s, pool, null, null, { depth: 1, wideMoves: false });
    assert.ok(offRoot.length && !offRoot.some(r => B.isWideAlg(r.coreAlg)), 'root without wide moves');
    s.commit(offRoot[0]);
    const off = await B.searchWithLookahead(s, pool, null, null, { depth: 1, wideMoves: false });
    assert.ok(!off.some(r => B.isWideAlg(r.coreAlg)));
    const partials = [];
    const on = await B.searchWithLookahead(s, pool, null, null, { depth: 1, wideMoves: true, onUpdate: l => partials.push(l) });
    const onKeys = new Set(on.map(r => `${r.rotation}|${r.coreAlg}`));
    assert.ok(off.every(r => onKeys.has(`${r.rotation}|${r.coreAlg}`)), 'a result of the search without wide moves is missing');
    assert.ok(on.some(r => UDFB.test(r.coreAlg)), 'no u/d/f/b result added');
    assert.ok(partials.length && partials.every(l => l.length >= off.length), 'a partial list was shorter than the list before');
    assert.strictEqual(exactDupes(on), 0);
  });

  if (process.argv.includes('--pseudo')) {
    const ph = await createEnginePool('pseudo', 1);
    const padv = [...adv, 'full_pseudo'];
    const s = new B.SolveSession(SCRAMBLES[1], pruneGraph(tree, { advanced: [...padv, 'multislotting'], colors: ['white'] }), ['white'], padv);
    s.maxSolutions = 200;
    s.multislot = false;
    await test('pseudo: wide spellings of pseudo steps solve exactly what their (relabelled) nodes claim', async () => {
      const { laterWide, checked } = await solveAndCheck('pseudo', s, pool, ph);
      assert.ok(laterWide > 0);
      console.log(`  ${laterWide} later-step u/d/f/b results (${checked} replayed)`);
    });
    await ph.terminate();
  }

  await pool.terminate();
  if (failures) {
    console.error(`\n${failures} test(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll wide-spelling tests passed.');
  process.exit(0);
})().catch((err) => { console.error(err); process.exit(2); });
