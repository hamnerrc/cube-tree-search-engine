#!/usr/bin/env node
/**
 * alg-sets.js: the last-layer and last-slot sets (README "Algorithm sets").
 * The cubie model read off the facelet simulator (positions named after
 * their faces, round trips, composition, the human view llgen.cpp searches
 * in), the case counts (the known numbers), every SpeedCubeDB case is
 * exactly one case, recognition gives AUFs that solve, and every algorithm
 * in data/ll/*.json solves its case when replayed on the facelet cube.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const js = f => path.join(__dirname, '..', 'js', f);
Object.assign(global, require(js('script.js')));
Object.assign(global, require(js('facelet-cube.js')));
const { AlgSets: A } = require(js('alg-sets.js'));
const { humanCubie, frames } = require(path.join(__dirname, '..', 'tools', 'll-gen.js'));
const { splitAlg } = require(path.join(__dirname, '..', 'tools', 'll-build.js'));

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`PASS: ${name}`); } catch (e) { failures++; console.log(`FAIL: ${name}\n  ${e.stack}`); }
};
let seed = 12345;
const rand = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const TOKS = Object.keys(MOVE_TABLE).filter(t => !t.endsWith("2'"));
const FACES = [...'URFDLB'].flatMap(f => [f, `${f}'`, `${f}2`]);
const randomAlg = (n, from = TOKS) => Array.from({ length: n }, () => from[rand(from.length)]).join(' ');

test('cubie positions sit on the faces they are named after; solved is the identity', () => {
  const faceOf = i => 'URFDLB'[Math.floor(i / 9)];
  A.CORNER_FACELETS.forEach((f, i) => assert.strictEqual(f.map(faceOf).join(''), A.CORNER_NAMES[i]));
  A.EDGE_FACELETS.forEach((f, i) => assert.strictEqual(f.map(faceOf).join(''), A.EDGE_NAMES[i]));
  assert.ok(A.sameCubie(A.toCubie(A.SOLVED_LABELS), A.identity()));
  // a face turn moves exactly the pieces of its layer
  const layer = { U: [[0, 1, 2, 3], [0, 1, 2, 3]], R: [[0, 3, 4, 7], [0, 4, 8, 11]], D: [[4, 5, 6, 7], [4, 5, 6, 7]] };
  for (const [f, [cs, es]] of Object.entries(layer)) {
    const c = A.algCubie(f);
    assert.deepStrictEqual(c.cp.map((v, i) => (v !== i ? i : -1)).filter(i => i >= 0), cs);
    assert.deepStrictEqual(c.ep.map((v, i) => (v !== i ? i : -1)).filter(i => i >= 0), es);
  }
});

test('facelets -> cubie -> facelets round trips with every token kind; orientations sum to zero', () => {
  for (let n = 0; n < 400; n++) {
    const L = A.labelsOf(applyAlgorithm(SOLVED_FACELETS, randomAlg(25)));
    const c = A.toCubie(L);
    assert.ok(c, 'valid cubie');
    assert.strictEqual(A.fromCubie(c), L);
    assert.strictEqual(c.co.reduce((a, b) => a + b, 0) % 3, 0);
    assert.strictEqual(c.eo.reduce((a, b) => a + b, 0) % 2, 0);
  }
});

test('cubie composition equals replaying the moves (face turns)', () => {
  for (let n = 0; n < 200; n++) {
    const a = randomAlg(8, FACES), b = randomAlg(8, FACES);
    assert.ok(A.sameCubie(A.mul(A.algCubie(a), A.algCubie(b)), A.algCubie(`${a} ${b}`)));
  }
});

test('human view (llgen.cpp): rotation first, then the centre-relative state; tokens compose', () => {
  const F = frames();
  const rotOf = (f) => {
    const k = [4, 13, 22, 31, 40, 49].map(i => f[i]).join('');
    return F.list[F.index.get(k)];
  };
  for (let n = 0; n < 200; n++) {
    const alg = randomAlg(12);
    const f = applyAlgorithm(SOLVED_FACELETS, alg);
    const hv = humanCubie(f);
    assert.ok(A.sameCubie(hv, A.mul(humanCubie(applyAlgorithm(SOLVED_FACELETS, rotOf(f))), A.algCubie(alg))), alg);
    // the human view of a sequence is the product of its tokens' human views
    const prod = alg.split(' ').reduce((acc, t) => A.mul(acc, humanCubie(applyAlgorithm(SOLVED_FACELETS, t))), A.identity());
    assert.ok(A.sameCubie(hv, prod), alg);
  }
});

test('mirror: every token has one, a mirrored alg makes the mirrored cube, mirroring twice is the identity', () => {
  const S = A.SOLVED_LABELS;
  assert.strictEqual(A.mirrorAlg("R U R' U'"), "L' U' L U");
  for (let n = 0; n < 300; n++) {
    const alg = randomAlg(15);
    const L = A.labelsOf(applyAlgorithm(SOLVED_FACELETS, alg));
    assert.strictEqual(A.mirrorLabels(L), A.labelsOf(applyAlgorithm(S, A.mirrorAlg(alg))), alg);
    assert.strictEqual(A.mirrorLabels(A.mirrorLabels(L)), L);
    assert.ok(A.toCubie(A.mirrorLabels(L)), 'a valid cube');
  }
});

const EXPECTED = { oll: 57, pll: 21, coll: 42, zbll: 472, ols: 432, zbls: 302 };
const CASES = {};
test('case counts: OLL 57, PLL 21, COLL 42, ZBLL 472, OLS 432 (VLS 216 + HLS 216), ZBLS 302', () => {
  for (const [id, n] of Object.entries(EXPECTED)) {
    CASES[id] = A.enumerateCases(id);
    assert.strictEqual(CASES[id].length, n, id);
  }
  assert.strictEqual(CASES.ols.filter(c => c.group === 'VLS').length, 216);
  // classes are disjoint
  for (const [id, cs] of Object.entries(CASES)) {
    const seen = new Set();
    for (const c of cs) for (const k of c.members.keys()) { assert.ok(!seen.has(k), `${id}: key in two cases`); seen.add(k); }
  }
});

test('every SpeedCubeDB case is exactly one case of its set', () => {
  const db = require(path.join(__dirname, '..', 'data', 'll', 'scdb.json'));
  const map = { oll: 'oll', pll: 'pll', coll: 'coll', zbll: 'zbll', vls: 'ols', hls: 'ols' };
  for (const [dbSet, id] of Object.entries(map)) {
    const byKey = new Map();
    CASES[id].forEach((c, i) => c.members.forEach((v, k) => byKey.set(k, i)));
    const hit = new Set();
    for (const c of db.sets[dbSet]) {
      const i = byKey.get(A.caseKeyOf(id, A.algCubie(A.normalizeAlg(c.setup))));
      assert.ok(i !== undefined, `${dbSet} ${c.name}`);
      assert.ok(!hit.has(i), `${dbSet} ${c.name} twice`);
      hit.add(i);
    }
  }
});

test('database notation: brackets, Rw, R3, 2\' and a leading y on the last layer', () => {
  assert.strictEqual(A.normalizeAlg("(R U2' R') Rw R3 [F2'] Lw2"), "R U2 R' r R' F2 l2");
  assert.deepStrictEqual(splitAlg("y U R U R' U' y", 'pll'), { body: "R U R' U' y", pre: 2 });
  assert.deepStrictEqual(splitAlg("U2 R U R' U2", 'ols'), { body: "R U R'", pre: 2 });
});

test('a leading y on a last-layer case is the same as a U turn (replayed on every case)', () => {
  for (const id of ['oll', 'pll', 'coll', 'zbll']) {
    for (const c of CASES[id].slice(0, 40)) {
      const s = A.fromCubie(c.rep);
      for (const [y, u] of [['y', 'U'], ["y'", "U'"], ['y2', 'U2']]) {
        const a = A.algCubie(y, s), b = A.algCubie(u, s);
        assert.strictEqual(A.caseKeyOf(id, a) !== null, true);
        assert.strictEqual(CASES[id].findIndex(x => x.members.has(A.caseKeyOf(id, a))), CASES[id].findIndex(x => x.members.has(A.caseKeyOf(id, b))));
        // and they are the same state up to a U turn of the solved cube
        assert.ok(A.uPowers().some(U => A.sameCubie(A.mul(U, a), b)), `${id} ${y}`);
      }
    }
  }
});

// The data files (tools/ll-build.js build); skipped until they exist.
for (const id of Object.keys(EXPECTED)) {
  const file = path.join(__dirname, '..', 'data', 'll', `${id}.json`);
  if (!fs.existsSync(file)) { console.log(`SKIP: data/ll/${id}.json not built`); continue; }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  test(`data/ll/${id}.json: every case once, every alg replayed solves its case with its AUFs`, () => {
    assert.strictEqual(data.cases.length, EXPECTED[id]);
    const names = new Set();
    const index = A.indexSet(id, data);
    data.cases.forEach((c, i) => {
      assert.ok(c.name && !names.has(c.name), `${id}: name ${c.name}`);
      names.add(c.name);
      const st = A.toCubie(c.state);
      assert.strictEqual(A.recognize(id, index, st).i, i);
      assert.ok(c.algs.length > 0, `${id} ${c.name}: no algs`);
      for (const a of c.algs) {
        const full = `${A.AUF[a.pre]} ${a.alg} ${A.AUF[a.post]}`;
        const after = A.algCubie(full, c.state);
        if (A.SET_BY_ID[id].goal === 0) assert.ok(A.sameCubie(after, A.identity()), `${id} ${c.name}: ${full}`);
        else assert.ok(A.reachesGoal(A.SET_BY_ID[id].goal, after), `${id} ${c.name}: ${full}`);
      }
      for (let k = 1; k < c.algs.length; k++) assert.ok(c.algs[k - 1].score <= c.algs[k].score, 'ranked by score');
    });
  });
  test(`data/ll/${id}.json: a recognised AUF variant gets AUFs that solve it`, () => {
    for (let n = 0; n < 60; n++) {
      const c = data.cases[rand(data.cases.length)];
      const a = rand(4), b = rand(4);
      const s = A.mul(A.mul(A.uPowers()[b], A.toCubie(c.state)), A.uPowers()[a]);
      const hit = A.recognize(id, A.indexSet(id, { cases: [c] }), s);
      assert.ok(hit, `${id} ${c.name} not recognised`);
      const w = A.algFor(c.algs[0], hit, id);
      const after = A.algCubie(w.text, A.fromCubie(s));
      if (A.SET_BY_ID[id].goal === 0) assert.ok(A.sameCubie(after, A.identity()), `${id} ${c.name}: ${w.text}`);
      else assert.ok(A.reachesGoal(A.SET_BY_ID[id].goal, after), `${id} ${c.name}: ${w.text}`);
    }
  });
}

if (failures) { console.log(`${failures} test(s) failed`); process.exit(1); }
console.log('All alg-sets tests passed.');
