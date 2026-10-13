#!/usr/bin/env node
/**
 * last-layer.js: the last layer on the solving screen (README "Algorithm
 * sets"). Stages by replay; lines after the F2L read as steps (a line that
 * moves nothing on merges into the next), labelled by the case they solved;
 * suggestions in the solver's method whose tokens (AUFs included) solve the
 * cube they are offered for. Uses data/ll/*.json when built.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const js = f => path.join(__dirname, '..', 'js', f);
Object.assign(global, require(js('script.js')));
Object.assign(global, require(js('facelet-cube.js')));
Object.assign(global, require(js('alg-sets.js')));
const { LastLayer: L } = require(js('last-layer.js'));
const A = global.AlgSets;

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`PASS: ${name}`); } catch (e) { failures++; console.log(`FAIL: ${name}\n  ${e.stack}`); }
};
const after = alg => applyAlgorithm(SOLVED_FACELETS, alg);
const SUNE = "R U R' U R U2 R'";
const TPERM = "R U R' U' R' F R2 U' R' U' R U R' F'";

test('stages: done, auf, oriented, epll, eo, f2l, and null with the F2L broken', () => {
  assert.strictEqual(L.stageOf(SOLVED_FACELETS), 'done');
  assert.strictEqual(L.stageOf(after('U')), 'auf');
  assert.strictEqual(L.stageOf(after(TPERM)), 'oriented');
  assert.strictEqual(L.stageOf(after(A.invertAlg(SUNE))), 'eo');
  assert.strictEqual(L.stageOf(after("F R U R' U' F'")), 'f2l');
  assert.strictEqual(L.stageOf(after("M2 U M2 U2 M2 U M2")), 'oriented');
  assert.strictEqual(L.stageOf(after("R U2 R' U' R U' R' U2 R U R' U R U2 R'")), 'eo');
  assert.strictEqual(L.stageOf(after('R')), null);
  // a Ua perm leaves the corners solved and the edges oriented: epll is "oriented" too
  assert.strictEqual(L.stageOf(after("R U' R U R U R U' R' U' R2")), 'oriented');
});

test('lines after the F2L read as steps by replay; a line that moves nothing on merges', () => {
  // the cube: an OLL case (F R U R' U' F' undone), then a T perm
  const start = after(`${TPERM} F R U R' U' F'`);
  const r = L.readSteps(start, [
    { tokens: ['U'] },                                        // nothing new: merged
    { tokens: "U' F U R U' R' F'".split(' ') },               // orients (oll: the inverse)
    { tokens: TPERM.split(' ') },                             // solves (pll)
  ], null);
  assert.deepStrictEqual(r.steps.map(s => [s.firstLine, s.lastLine, s.label]), [[0, 1, 'oll'], [2, 2, 'pll']]);
  assert.strictEqual(r.stage, 'done');
  assert.deepStrictEqual(r.tail.tokens, []);
});

const DATA_DIR = path.join(__dirname, '..', 'data', 'll');
if (fs.existsSync(path.join(DATA_DIR, 'oll.json'))) {
  test('critique: the Sune on the Sune case is my favourite or great; seven Sunes are slower, with an alt', () => {
    const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'oll.json'), 'utf8'));
    const data = { oll: { data: d, index: A.indexSet('oll', d) } };
    const start = after(A.invertAlg(SUNE));
    const one = L.critique(start, [{ label: 'oll 27', toks: SUNE.split(' ') }], data);
    assert.ok(['critique.ll.best', 'critique.ll.good'].includes(one[0].key), one[0].key);
    const seven = Array(7).fill(SUNE).join(' ').split(' ');
    assert.strictEqual(L.stageOf(applyAlgorithm(start, seven.join(' '))), 'done');
    const slow = L.critique(start, [{ label: 'oll 27', toks: seven }], data);
    assert.strictEqual(slow[0].key, 'critique.ll.slower');
    // the alt solves the case from the cube as it stands
    assert.ok(['oriented', 'auf', 'done'].includes(L.stageOf(applyAlgorithm(start, slow[0].alt.vars.alg))));
  });
}
const ready = A.SETS.every(s => fs.existsSync(path.join(DATA_DIR, `${s.id}.json`)));
if (!ready) console.log('SKIP: data/ll/*.json not built: suggestions and case labels');
else {
  const data = {};
  for (const s of A.SETS) {
    const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${s.id}.json`), 'utf8'));
    data[s.id] = { data: d, index: A.indexSet(s.id, d) };
  }
  test('labels name the case: "oll 27", "pll t"', () => {
    const start = after(`${TPERM} ${A.invertAlg(SUNE)}`);
    const r = L.readSteps(start, [{ tokens: SUNE.split(' ') }, { tokens: TPERM.split(' ') }], data);
    const labels = r.steps.map(s => s.label);
    assert.strictEqual(labels[0], 'oll 27');
    assert.strictEqual(labels[1], 'pll t');
  });
  let seed = 7;
  const rand = n => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  test('every suggestion solves what it says, from the cube as it stands (random cases, AUFs, methods)', () => {
    for (let n = 0; n < 120; n++) {
      // a random last layer: a random case's state with random AUFs around it
      const setId = ['oll', 'pll', 'coll', 'zbll'][rand(4)];
      const d = data[setId].data;
      const kase = d.cases[rand(d.cases.length)];
      const pre = A.AUF[rand(4)], post = A.AUF[rand(4)];
      const cube = applyAlgorithm(after(post), `${applyAlgorithmText(kase.state)} ${pre}`);
      const stage = L.stageOf(cube);
      for (const method of ['oll', 'coll', 'zbll']) {
        const sug = L.suggestions(cube, data, method);
        assert.ok(sug.length > 0, `${setId} ${kase.name}: no suggestion (${stage}, ${method})`);
        assert.strictEqual(sug[0].setId, L.setsFor(stage, method)[0]);
        for (const s of sug.slice(0, 4)) {
          const end = L.stageOf(applyAlgorithm(cube, s.toks.join(' ')));
          const want = s.setId === 'oll' ? ['oriented', 'auf', 'done'] : s.setId === 'coll' ? ['oriented', 'auf', 'done'] : ['done'];
          assert.ok(want.includes(end), `${s.label} ${s.toks.join(' ')}: ${end}`);
        }
      }
    }
  });
}

/** The setup that makes a stored case state from a solved cube (inverse of its first alg). */
function applyAlgorithmText(stateLabels) {
  // find the case's own first alg in any set and invert it, with its AUFs
  for (const s of A.SETS) {
    const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${s.id}.json`), 'utf8'));
    const c = d.cases.find(x => x.state === stateLabels);
    if (c) {
      const a = c.algs[0];
      return A.invertAlg([A.AUF[a.pre], a.alg, A.AUF[a.post]].filter(Boolean).join(' '));
    }
  }
  throw new Error('case not found');
}

if (failures) { console.log(`${failures} test(s) failed`); process.exit(1); }
console.log('All last-layer tests passed.');
