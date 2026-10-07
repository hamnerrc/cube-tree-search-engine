#!/usr/bin/env node
/**
 * tools/pair-compare-lib.js (PROJECT_STATUS.md roadmap 7a): storage and
 * retractions, vote resolution, tie classes, transitive closure and derived
 * comparisons, contradiction detection, and pair selection. No engine.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const L = require(path.join(__dirname, '..', 'tools', 'pair-compare-lib.js'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

let nextId = 0;
/** Answer records from compact specs: 'A>B', 'A<B', 'A=B', 'A?B' (skip). */
function answers(...specs) {
  return specs.map(s => {
    const [a, op, b] = s.split(/([<>=?])/);
    const answer = { '>': 'a', '<': 'b', '=': 'tie', '?': 'skip' }[op];
    return { type: 'answer', id: `t${nextId++}`, a, b, answer, reason: 'select', repeat: false };
  });
}

/** A seeded generator (selection must be reproducible in tests). */
function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// Real-looking algs so the model times and features are meaningful.
const ALGS = ["R U R'", "R U' R'", "U R U' R'", "y' R' U' R", "L' U' L", "U' L' U L", "R' F R F'", "U R U2 R' U R U' R'", "D R' U R D'", "r U r'", "y U L U' L'", "F' U' F", "U2 R U R' U R U' R'", "R U2 R' U' R U R'"];
const pool = {
  lists: [
    { id: 'l1', first: false, type: 'Single pair', items: ALGS.slice(0, 7).map((alg, i) => ({ alg, rank: i + 1 })) },
    { id: 'l2', first: false, type: 'Single pair', items: ALGS.slice(5).map((alg, i) => ({ alg, rank: i + 1 })) },
  ],
};

test('wide B algs are never in the indexed pool, so never asked', () => {
  const pidx = L.indexPool({ lists: [{ id: 'w', first: false, items: [{ alg: "b' R2 b", rank: 1 }, { alg: "F U2 F'", rank: 2 }, { alg: "U R b2 R'", rank: 3 }] }] });
  assert.deepStrictEqual(pidx.algs.map(e => e.alg), ["F U2 F'"]);
  assert.deepStrictEqual(pidx.lists[0].algs, ["F U2 F'"]);
  assert.strictEqual(L.hasWideB("B U' B'"), false);
});

test('normalizeAlg and pairKey: notation and order do not matter', () => {
  assert.strictEqual(L.normalizeAlg("  R2'  U   R' "), "R2 U R'");
  assert.strictEqual(L.pairKey('A', 'B'), L.pairKey('B', 'A'));
});

test('algFeatures: D/F/B, wide, slices, leading vs mid-step rotations, length', () => {
  assert.deepStrictEqual(L.algFeatures("y' R U R'").sort(), ['rotLead', 'short']);
  assert.deepStrictEqual(L.algFeatures("R U y R U R'").sort(), ['rotMid', 'short']);
  assert.deepStrictEqual(L.algFeatures("R U y R U R' U' R").sort(), ['medium', 'rotMid']);
  assert.deepStrictEqual(L.algFeatures("R D R' U R D' R'").sort(), ['D', 'medium']);
  assert.deepStrictEqual(L.algFeatures("f R' f'").sort(), ['short', 'wideUDFB']);
  assert.deepStrictEqual(L.algFeatures("r U r' M U2").sort(), ['short', 'slice', 'wideRL']);
});

test('storage: append-only log, retractions hide an answer, a torn last line is ignored', () => {
  const file = path.join(os.tmpdir(), `pair-compare-test-${process.pid}.jsonl`);
  try {
    const r1 = L.answerRecord({ id: 'x1', a: "R U R'", b: "F' U' F", answer: 'a' });
    const r2 = L.answerRecord({ id: 'x2', a: "R U R'", b: "L' U' L", answer: 'tie' });
    L.appendLog(file, r1);
    L.appendLog(file, r2);
    L.appendLog(file, { type: 'retract', id: 'x1', t: 'now' });
    fs.appendFileSync(file, '{"type":"answer","id":"x3"'); // crash mid-write
    const log = L.readLog(file);
    assert.strictEqual(log.length, 3);
    assert.deepStrictEqual(L.activeAnswers(log).map(r => r.id), ['x2']);
    assert.strictEqual(r1.model, L.modelVersion());
    assert.ok(/^mcc-[0-9a-f]{8}$/.test(r1.model));
  } finally { fs.rmSync(file, { force: true }); }
});

test('transitive closure: A>B, B>C implies A>C; nothing about unrelated algs', () => {
  const g = L.comparisonGraph(answers('A>B', 'B>C', 'D>E'));
  assert.strictEqual(g.relation('A', 'C'), 'a');
  assert.strictEqual(g.relation('C', 'A'), 'b');
  assert.strictEqual(g.relation('A', 'D'), null);
  assert.strictEqual(g.relation('A', 'Z'), null);
  assert.strictEqual(g.counts.direct, 3);
  assert.strictEqual(g.counts.derived, 1); // A>C
  assert.strictEqual(g.counts.contradictions, 0);
});

test('a chain of n answers yields n(n+1)/2 comparisons', () => {
  const names = 'ABCDEFGHIJ'.split('');
  const g = L.comparisonGraph(answers(...names.slice(1).map((x, i) => `${names[i]}>${x}`)));
  assert.strictEqual(g.counts.direct, 9);
  assert.strictEqual(g.counts.direct + g.counts.derived, 45);
  const d = g.derivedComparisons();
  assert.strictEqual(d.length, 45);
  const aj = d.find(c => c.faster === 'A' && c.slower === 'J');
  assert.deepStrictEqual([aj.dist, aj.direct], [9, false]);
});

test('ties merge classes: A=B, B>C gives A>C; A=B=C gives A=C', () => {
  let g = L.comparisonGraph(answers('A=B', 'B>C'));
  assert.strictEqual(g.relation('A', 'C'), 'a');
  assert.strictEqual(g.relation('B', 'A'), 'tie');
  g = L.comparisonGraph(answers('A=B', 'B=C'));
  assert.strictEqual(g.relation('A', 'C'), 'tie');
  assert.strictEqual(g.counts.derived, 1);
  const t = g.derivedComparisons().find(c => !c.direct);
  assert.ok(t.tie && [t.faster, t.slower].sort().join() === 'A,C');
});

test('votes: the majority decides, a tied count takes the latest answer', () => {
  let g = L.comparisonGraph(answers('A>B', 'A<B', 'A>B'));
  assert.strictEqual(g.relation('A', 'B'), 'a');
  g = L.comparisonGraph(answers('A>B', 'B>A'));
  assert.strictEqual(g.relation('A', 'B'), 'b');
  assert.strictEqual(g.pairs.get(L.pairKey('A', 'B')).n, 2);
});

test('contradictions: a cycle is reported, not used for inference, weakest pair first', () => {
  const g = L.comparisonGraph(answers('A>B', 'B>C', 'C>A', 'C>A', 'A>D', 'X>Y'));
  assert.strictEqual(g.counts.contradictions, 1);
  assert.deepStrictEqual(g.contradictions[0].algs, ['A', 'B', 'C']);
  // C>A has two votes, so the oldest single-vote pair (A>B) is the weakest.
  assert.deepStrictEqual([g.contradictions[0].pairs[0].a, g.contradictions[0].pairs[0].b], ['A', 'B']);
  assert.strictEqual(g.relation('B', 'D'), null); // not inferred through the cycle
  assert.strictEqual(g.relation('A', 'D'), 'a'); // direct answers still stand
  assert.strictEqual(g.relation('X', 'Y'), 'a');
  // Only the uncontradicted pair counts as known data.
  assert.strictEqual(g.counts.direct + g.counts.derived - g.counts.direct + g.counts.directKnown, 1);
});

test('contradictions: a strict answer inside a tie class', () => {
  const g = L.comparisonGraph(answers('A=B', 'B=C', 'A>C'));
  assert.strictEqual(g.counts.contradictions, 1);
});

test('skips: the pair is not a comparison; an alg skipped twice is dropped from selection', () => {
  const g = L.comparisonGraph(answers('A?B', 'A?C'));
  assert.strictEqual(g.counts.direct, 0);
  assert.strictEqual(g.counts.skips, 2);
  assert.strictEqual(g.skipsByAlg.get('A'), 2);
  const x = { alg: 'A' }, y = { alg: 'D' };
  assert.strictEqual(L.eligible(x, y, g), false);
  assert.strictEqual(L.eligible({ alg: 'B' }, { alg: 'D' }, g), true);
  assert.strictEqual(L.eligible({ alg: 'B' }, { alg: 'A' }, g), false); // skipped pair
});

test('selection never asks a pair that is answered, implied, or the same alg', () => {
  const pidx = L.indexPool(pool);
  const done = answers(`${ALGS[0]}>${ALGS[1]}`, `${ALGS[1]}>${ALGS[2]}`, `${ALGS[2]}=${ALGS[3]}`);
  const g = L.comparisonGraph(done);
  const rng = seeded(1);
  for (let i = 0; i < 300; i++) {
    const p = L.selectPair(pidx, done, rng, { graph: g, repeatShare: 0 });
    assert.ok(p, 'no pair selected');
    assert.notStrictEqual(p.a, p.b);
    assert.strictEqual(g.relation(p.a, p.b), null, `asked a known pair ${p.a} / ${p.b}`);
    assert.ok(['select', 'random'].includes(p.reason));
  }
});

test('selection: an open contradiction is asked first, each of its pairs at most once more', () => {
  const pidx = L.indexPool(pool);
  const [a, b, c] = ALGS;
  let done = answers(`${a}>${b}`, `${b}>${c}`, `${c}>${a}`);
  const p = L.selectPair(pidx, done, seeded(2));
  assert.strictEqual(p.reason, 'contradiction');
  assert.strictEqual(L.pairKey(p.a, p.b), L.pairKey(a, b)); // oldest single-vote pair
  // Re-affirming every pair once leaves a genuine intransitivity: no more re-asks.
  done = done.concat(answers(`${a}>${b}`, `${b}>${c}`, `${c}>${a}`));
  for (let i = 0; i < 20; i++) assert.notStrictEqual(L.selectPair(pidx, done, seeded(3 + i)).reason, 'contradiction');
  // Flipping one pair resolves it.
  const fixed = L.comparisonGraph(answers(`${a}>${b}`, `${b}>${c}`, `${c}>${a}`, `${a}>${c}`, `${a}>${c}`));
  assert.strictEqual(fixed.counts.contradictions, 0);
  assert.strictEqual(fixed.relation(a, c), 'a');
});

test('selection: spaced repeats only of answers old enough, each repeated once', () => {
  const pidx = L.indexPool(pool);
  const old = answers(`${ALGS[0]}>${ALGS[6]}`);
  const filler = answers(...Array.from({ length: 39 }, (_, i) => `F${i}>G${i}`));
  const done = old.concat(filler);
  const p = L.selectPair(pidx, done, seeded(5), { repeatShare: 1 });
  assert.strictEqual(p.reason, 'repeat');
  assert.strictEqual(L.pairKey(p.a, p.b), L.pairKey(ALGS[0], ALGS[6]));
  const rep = answers(`${ALGS[0]}>${ALGS[6]}`).map(r => ({ ...r, repeat: true, reason: 'repeat' }));
  for (let i = 0; i < 20; i++) {
    const q = L.selectPair(pidx, done.concat(rep), seeded(10 + i), { repeatShare: 1 });
    assert.notStrictEqual(L.pairKey(q.a, q.b), L.pairKey(ALGS[0], ALGS[6]));
  }
  // Too recent: not repeated yet.
  assert.notStrictEqual(L.selectPair(pidx, old.concat(filler.slice(0, 10)), seeded(5), { repeatShare: 1 }).reason, 'repeat');
});

test('selection prefers close, high-impact pairs over clear-cut ones', () => {
  const pidx = L.indexPool(pool);
  const g = L.comparisonGraph([]);
  const ctx = { graph: g, opts: L.SELECT_DEFAULTS, featCount: L.featureCounts(g, pidx), scale: 0.1, rankIn: new Map(pidx.algs.map(e => [e.alg, new Map(e.occ.map(o => [o.list, o.rank]))])) };
  const e = a => pidx.byAlg.get(a);
  // R U R' vs R U' R' (same time, ranks 1 and 2) vs R U R' vs an 8-mover.
  const close = L.pairScore(e("R U R'"), e("R U' R'"), ctx);
  const far = L.pairScore(e("R U R'"), e("U R U2 R' U R U' R'"), ctx);
  assert.ok(close.ambiguity > 0.5 && far.ambiguity < 0.2, `${close.ambiguity} ${far.ambiguity}`);
  assert.ok(close.impact > far.impact);
  assert.ok(close.score > far.score);
  // The chosen pair (no randomness) is a near-tie for the model.
  const p = L.selectPair(pidx, [], seeded(9), { randomShare: 0, repeatShare: 0 });
  assert.ok(p.parts.ambiguity > 0.5, JSON.stringify(p));
  assert.strictEqual(p.reason, 'select');
});

test('selection: connecting separate parts of the graph scores higher', () => {
  const pidx = L.indexPool(pool);
  const g = L.comparisonGraph(answers(`${ALGS[0]}>${ALGS[1]}`, `${ALGS[5]}>${ALGS[6]}`));
  const ctx = { graph: g, opts: L.SELECT_DEFAULTS, featCount: L.featureCounts(g, pidx), scale: 0.1, rankIn: new Map() };
  const e = a => pidx.byAlg.get(a);
  const v = L.SELECT_DEFAULTS.connectValues;
  assert.strictEqual(L.pairScore(e(ALGS[0]), e(ALGS[5]), ctx).connect, v.join);
  assert.strictEqual(L.pairScore(e(ALGS[0]), e(ALGS[2]), ctx).connect, v.extend);
  assert.strictEqual(L.pairScore(e(ALGS[2]), e(ALGS[3]), ctx).connect, v.fresh);
  assert.ok(v.join > v.extend && v.extend > v.inside && v.inside > v.fresh);
});

test('fitScale: a model that orders every answer right is sure (small scale); a coin-flip one is not', () => {
  const pidx = L.indexPool(pool);
  const byTime = pidx.sortedByTime;
  const agree = [], coin = [];
  const rng = seeded(4);
  for (let i = 0; i < byTime.length; i++) for (let j = i + 1; j < byTime.length; j++) {
    if (byTime[i].time === byTime[j].time) continue;
    agree.push(...answers(`${byTime[i].alg}>${byTime[j].alg}`));
    coin.push(...answers(`${byTime[i].alg}${rng() < 0.5 ? '>' : '<'}${byTime[j].alg}`));
  }
  assert.ok(agree.length >= 30);
  const sAgree = L.fitScale(L.comparisonGraph(agree), pidx);
  const sCoin = L.fitScale(L.comparisonGraph(coin), pidx);
  assert.ok(sAgree < 0.05 && sCoin > 0.3, `${sAgree} ${sCoin}`);
  assert.strictEqual(L.fitScale(L.comparisonGraph(answers('A>B')), pidx), L.SELECT_DEFAULTS.scale); // too few answers
});

test('answerStats: repeat consistency and model agreement', () => {
  const pidx = L.indexPool(pool);
  const done = answers("R U R'>U R U2 R' U R U' R'", "R U R'>F' U' F").concat(
    answers("R U R'>U R U2 R' U R U' R'").map(r => ({ ...r, repeat: true })),
    answers("R U R'<F' U' F").map(r => ({ ...r, repeat: true })));
  const s = L.answerStats(done, pidx);
  assert.deepStrictEqual([s.repeats, s.consistent], [2, 1]);
  assert.ok(s.strict === 2 && s.agree >= 1);
});

(async () => {
  let failures = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS: ${t.name}`); } catch (e) { failures++; console.log(`FAIL: ${t.name}\n  ${e.stack}`); }
  }
  if (failures) { console.log(`\n${failures} test(s) failed.`); process.exit(1); }
  console.log('\nAll pair-compare tests passed.');
})();
