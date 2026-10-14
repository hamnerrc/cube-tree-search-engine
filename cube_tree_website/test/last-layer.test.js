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
  assert.strictEqual(L.stageOf(after("M2 U M2 U2 M2 U M2")), 'epll');
  assert.strictEqual(L.stageOf(after("R U2 R' U' R U' R' U2 R U R' U R U2 R'")), 'eo');
  assert.strictEqual(L.stageOf(after('R')), null);
  // a Ua perm: the corners solved, the edges oriented
  assert.strictEqual(L.stageOf(after("R U' R U R U R U' R' U' R2")), 'epll');
  assert.strictEqual(L.STAGE_RANK.epll, L.STAGE_RANK.oriented);
});

test('a COLL step (edges oriented -> corners solved) is not an OLL one', () => {
  // corners: an anti-sune COLL case with an H perm on top; COLL leaves an EPLL
  const coll = "R U2 R' U' R U' R'";
  const start = after(`M2 U M2 U2 M2 U M2 ${A.invertAlg(coll)}`);
  assert.strictEqual(L.stageOf(start), 'eo');
  const r = L.readSteps(start, [{ tokens: coll.split(' ') }], null);
  assert.strictEqual(r.stage, 'epll');
  assert.strictEqual(r.steps[0].label, 'coll');
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
          // an OLL may solve the corners too (epll); a COLL must
          const want = s.setId === 'oll' ? ['oriented', 'epll', 'auf', 'done'] : s.setId === 'coll' ? ['epll', 'auf', 'done'] : ['done'];
          assert.ok(want.includes(end), `${s.label} ${s.toks.join(' ')}: ${end}`);
        }
      }
    }
  });
}

const slotReady = ['zbls', 'ols'].every(id => fs.existsSync(path.join(DATA_DIR, `${id}.json`)));
if (!slotReady) console.log('SKIP: data/ll/zbls.json, ols.json not built: last-slot algs');
else {
  const data = {};
  for (const id of ['zbls', 'ols']) {
    const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, `${id}.json`), 'utf8'));
    data[id] = { data: d, index: A.indexSet(id, d) };
  }
  let seed2 = 11;
  const rand2 = n => { seed2 = (seed2 * 1103515245 + 12345) & 0x7fffffff; return seed2 % n; };
  L.setPrefs({ lastSlot: { zbls: true, ols: true, vls: true, hls: true, wv: true, sv: true } });
  test('last-slot algs for every slot (y turns, mirror) solve the pair and reach their goal', () => {
    let checked = 0;
    for (let n = 0; n < 80; n++) {
      const setId = ['zbls', 'ols'][rand2(2)];
      const kase = data[setId].data.cases[rand2(data[setId].data.cases.length)];
      let cube = A.fromCubie(A.toCubie(kase.state));
      if (rand2(2)) cube = A.mirrorLabels(cube);             // a left slot
      const rot = ['', 'y', 'y2', "y'"][rand2(4)];          // and any of the four
      if (rot) cube = A.labelsOf(applyAlgorithm(cube, rot));
      const found = L.lastSlotAlgs(cube, data, 2);
      assert.ok(found.some(f => f.setId === setId), `${setId} ${kase.name} (${rot}) not found`);
      for (const f of found) {
        const end = L.stageOf(applyAlgorithm(cube, f.toks.join(' ')));
        // (an OLS alg may solve the corners too: epll is an oriented layer)
        const want = f.setId === 'ols' ? ['oriented', 'epll', 'auf', 'done'] : ['eo', 'oriented', 'epll', 'auf', 'done'];
        assert.ok(want.includes(end), `${f.name}: ${f.toks.join(' ')} -> ${end}`);
        checked++;
      }
    }
    assert.ok(checked > 80);
  });
}

if (slotReady) {
  const ols = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ols.json'), 'utf8'));
  const zbls = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'zbls.json'), 'utf8'));
  const data = { ols: { data: ols, index: A.indexSet('ols', ols) }, zbls: { data: zbls, index: A.indexSet('zbls', zbls) } };
  test('each last-slot set on its own: wv alone offers wv cases only; zbls off offers no zbls', () => {
    const vlsOnly = ols.cases.find(c => (c.tags || []).includes('vls') && !c.tags.includes('wv'));
    const wv = ols.cases.find(c => (c.tags || []).includes('wv'));
    assert.ok(vlsOnly && wv, 'the data has subset tags');
    L.setPrefs({ lastSlot: { wv: true } });
    assert.ok(L.lastSlotAlgs(A.fromCubie(A.toCubie(wv.state)), data, 2).some(f => f.setId === 'ols'), 'a wv case with wv on');
    assert.ok(!L.lastSlotAlgs(A.fromCubie(A.toCubie(vlsOnly.state)), data, 2).some(f => f.setId === 'ols'), 'a vls case with only wv on');
    assert.ok(!L.lastSlotAlgs(A.fromCubie(A.toCubie(vlsOnly.state)), data, 2).some(f => f.setId === 'zbls'), 'zbls off');
    L.setPrefs({ lastSlot: { vls: true } });
    assert.ok(L.lastSlotAlgs(A.fromCubie(A.toCubie(vlsOnly.state)), data, 2).some(f => f.setId === 'ols'), 'vls on');
    L.setPrefs({ lastSlot: { zbls: true, ols: true, vls: true, hls: true, wv: true, sv: true } });
  });
}

const ollReady = fs.existsSync(path.join(DATA_DIR, 'oll.json'));
if (ollReady) {
  const d = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'oll.json'), 'utf8'));
  const data = { oll: { data: d, index: A.indexSet('oll', d) } };
  const sune = after(A.invertAlg(SUNE));
  test('the solver\'s main alg comes first (and is the ghost); styles move shorter algs; awkward algs hide', () => {
    const kase = d.cases.find(c => c.name === 'OLL 27');
    const id = L.caseId('oll', kase);
    const last = kase.algs[kase.algs.length - 1].alg;
    L.setPrefs({ main: { [id]: last }, hideAwkward: false });
    const sug = L.suggestions(sune, data, 'oll');
    assert.strictEqual(L.bodyOf(sug[0].toks), last);
    assert.ok(sug[0].main);
    L.setPrefs({ main: {} });
    // white collar: each move costs more, so the order can only move shorter algs up
    L.setPrefs({ style: 'tps' });
    const tps = L.orderedAlgs('oll', kase).map(a => a.alg);
    L.setPrefs({ style: 'efficiency' });
    const eff = L.orderedAlgs('oll', kase).map(a => a.alg);
    const stm = a => a.split(' ').length;
    const shortest = tps.slice().sort((a, b) => stm(a) - stm(b))[0];
    assert.ok(eff.indexOf(shortest) <= tps.indexOf(shortest));
    L.setPrefs({ style: 'tps' });
    // awkward algs: hidden unless the case's favourite is awkward itself
    for (const c of d.cases) {
      L.setPrefs({ hideAwkward: true });
      const shown = L.orderedAlgs('oll', c);
      if (!c.awkOk) assert.ok(shown.every(a => !a.awk), `${c.name}: an awkward alg shown`);
      else assert.strictEqual(shown.length, c.algs.length);
    }
    L.setPrefs({ hideAwkward: true });
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
