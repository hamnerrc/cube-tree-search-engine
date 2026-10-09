#!/usr/bin/env node
/**
 * Complete search's spelling branch and bound (js/spelling-search.js) against
 * brute force: on random face-turn sequences, first step and later step (a
 * committed path before it), the best N spellings of every view equal the
 * best N of ALL spellings scored with the real path cost. Also: every
 * spelling is physically "the face turns, then a y-family rotation", never
 * has a wide b, a mid-step y2 or two mid-step rotations, and the bound never
 * exceeds the real cost.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const js = path.join(__dirname, '..', 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js']) Object.assign(global, require(path.join(js, f)));
const { SpellingSearch } = require(path.join(js, 'spelling-search.js'));
const { stepsPathCost, isWideAlg, isUnorthodox } = require(path.join(js, 'solver-bridge.js'));

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); } catch (err) { failures++; console.error(`FAIL: ${name}\n  ${err.stack}`); }
}

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const FACES = [...'RLUDFB'].flatMap(f => [f, `${f}'`, `${f}2`]);
function randomFace(n) {
  const out = [];
  while (out.length < n) {
    const t = FACES[Math.floor(rnd() * FACES.length)];
    if (out.length && out[out.length - 1][0] === t[0]) continue;
    out.push(t);
  }
  return out;
}

const VIEWS = [
  { test: () => true, wide: true },
  { test: c => !c.wide, wide: false },
  { test: c => !c.unorthodox, wide: true },
  { test: c => !c.wide && !c.unorthodox, wide: false },
];

function run(stepAlgs, root, faces, size, brute) {
  const holder = {};
  const costOf = alg => stepsPathCost(holder, stepAlgs, alg);
  costOf('R');
  const floor = SpellingSearch.mccFloor(holder._costBase.mcc) + holder._costBase.penalty;
  const sols = faces.map((face, k) => ({ face, look: (k % 3) - 1, id: k }));
  const make = (alg, lead, end, sol, tpp) => {
    const rotation = root ? SpellingSearch.orientationName(lead) : '';
    return { alg, rotation, end, sol: sol.id, tpp, key: `${rotation}|${commuteNormalize(alg)}`, wide: isWideAlg(alg), unorthodox: !root && isUnorthodox(alg) };
  };
  const big = 1e9;
  return SpellingSearch.topSpellings({
    sols, root, pieces: 5, floor: brute ? -big : floor, costOf, views: VIEWS, size: brute ? big : size, make,
  });
}

function topOf(list, view, size) {
  return list.filter(VIEWS[view].test).sort((a, b) => a.tpp - b.tpp).slice(0, size);
}

for (const [label, stepAlgs, root, len, count, size] of [
  ['first step', [], true, 5, 6, 30],
  ['later step', ["D R' F R D'", "U' R U R'"], false, 6, 8, 40],
  ['later step, small N', ["R U R' U2 F' U F"], false, 7, 6, 5],
]) {
  test(`${label}: the best ${size} of every view equal brute force`, () => {
    const faces = Array.from({ length: count }, () => randomFace(len));
    const fast = run(stepAlgs, root, faces, size, false);
    const all = run(stepAlgs, root, faces, size, true);
    assert.ok(fast.stats.exact < all.stats.exact, `pruned something (${fast.stats.exact} of ${all.stats.exact} scored)`);
    for (let v = 0; v < VIEWS.length; v++) {
      const want = topOf(all.list, v, size);
      const got = topOf(fast.list, v, size);
      assert.deepStrictEqual(got.map(c => c.tpp), want.map(c => c.tpp), `view ${v} tpps`);
      // keys strictly better than the boundary are the same
      const edge = want.length ? want[want.length - 1].tpp : Infinity;
      const keys = l => l.filter(c => c.tpp < edge).map(c => c.key).sort();
      assert.deepStrictEqual(keys(got), keys(want), `view ${v} keys`);
    }
  });
}

test('solutions that end alike (shared bound rows): best N equal brute force', () => {
  const tails = [randomFace(4), randomFace(3)];
  const faces = [];
  for (let k = 0; k < 10; k++) {
    const tail = tails[k % 2];
    let head = randomFace(1 + (k % 3));
    while (head[head.length - 1][0] === tail[0][0]) head = randomFace(1 + (k % 3));
    faces.push(head.concat(tail));
  }
  faces.push(tails[0].slice(), tails[1].slice()); // a whole solution equal to a shared ending
  for (const [stepAlgs, root] of [[["R U R'"], false], [[], true]]) {
    const fast = run(stepAlgs, root, faces, 25, false);
    const all = run(stepAlgs, root, faces, 25, true);
    for (let v = 0; v < VIEWS.length; v++) {
      assert.deepStrictEqual(topOf(fast.list, v, 25).map(c => c.tpp), topOf(all.list, v, 25).map(c => c.tpp), `root ${root} view ${v}`);
    }
  }
});

test('every spelling is the face turns then a y-family rotation; no b, no mid y2, one mid rotation', () => {
  const faces = Array.from({ length: 5 }, () => randomFace(6));
  for (const root of [true, false]) {
    const { list } = run(root ? [] : ["R U R'"], root, faces, 0, true);
    for (const c of list) {
      const toks = c.alg.split(' ');
      assert.ok(!/(^| )b/.test(c.alg), c.alg);
      const firstTurn = toks.findIndex(t => !/^[xyz]/.test(t));
      const mid = toks.slice(firstTurn).filter(t => /^[xyz]/.test(t));
      assert.ok(mid.length <= 1 && !mid.includes('y2'), c.alg);
      const face = faces[c.sol].join(' ');
      const got = applyAlgorithm(SOLVED_FACELETS, [c.rotation, c.alg].filter(Boolean).join(' '));
      const ok = ['', 'y', 'y2', "y'"].some(r => applyAlgorithm(SOLVED_FACELETS, [face, r].filter(Boolean).join(' ')) === got);
      assert.ok(ok, `${c.rotation} | ${c.alg} is not ${face} then a y rotation`);
    }
  }
});

test('known spellings are generated: wide u/f, rotations, side-cross inspections, a split half turn', () => {
  const t = SpellingSearch.tables();
  const all = (face, root) => {
    const out = new Set();
    SpellingSearch.enumerate([{ face: face.split(' ').map(x => t.TID.get(x)), look: 0 }], {
      root, budget: () => Infinity,
      leaf: (ids, lead) => out.add(`${root ? SpellingSearch.orientationName(lead) + '|' : ''}${Array.from(ids, i => t.TOK[i]).join(' ')}`),
    });
    return out;
  };
  const later = all("D B U' B'", false);
  for (const sp of ["u R U' R'", "D y R U' R'", "y D R U' R'", "D f R' f'"]) assert.ok(later.has(sp), sp);
  assert.ok(all("U' B U B'", false).has("y U' R U R'"), 'rotation spelling');
  const split = all("U2 L' U L", false);
  assert.ok([...split].some(x => /^(d' U'|U' d'|d U|U d) /.test(x)), 'U2 as a plain and a wide quarter');
  assert.ok([...all("L U L'", false)].some(x => /(^| )r/.test(x)), 'L as r');
  const root = all("L U R'", true);
  assert.ok([...root].some(x => /^(x|z)/.test(x) && /\|[rl]/.test(x)), 'side-cross inspection');
  assert.ok(![...later, ...root].some(x => /(^| |\|)b/.test(x)), 'never a wide b');
});

test('forward rows meet the bound table at every cut', () => {
  const t = SpellingSearch.tables();
  const L = SpellingSearch.lmTables();
  const mm = SpellingSearch.mccMinimum();
  const pen = SpellingSearch.penalties();
  let checked = 0;
  for (const root of [false, true]) {
    for (let k = 0; k < 30; k++) {
      const face = randomFace(3 + (k % 8)).map(x => t.TID.get(x));
      const n = face.length;
      const H = SpellingSearch.boundTable(face, null, mm, pen, L, 0, Infinity, 0, false);
      let want = Infinity;
      for (const [lt, ld] of root ? t.LEAD_ROOT : t.LEAD_LATER) want = Math.min(want, H[(n * t.NR + ld) * 3] + (lt >= 0 ? mm[lt] : 0));
      let F = new Float64Array(t.NR * 3).fill(Infinity);
      for (const [lt, ld] of root ? t.LEAD_ROOT : t.LEAD_LATER) F[ld * 3] = Math.min(F[ld * 3], lt >= 0 ? mm[lt] : 0);
      for (let cut = 0; cut <= n; cut++) {
        let got = Infinity;
        for (let x = 0; x < t.NR * 3; x++) got = Math.min(got, F[x] + H[(n - cut) * t.NR * 3 + x]);
        assert.ok(Math.abs(got - want) < 1e-9, `${Array.from(face, i => t.TOK[i]).join(' ')} cut ${cut}: ${got} vs ${want}`);
        checked++;
        if (cut < n) F = SpellingSearch.forwardStep(face, cut, F, new Float64Array(t.NR * 3), mm, pen, L);
      }
    }
  }
  assert.ok(checked > 300, `${checked} cuts checked`);
});

test('the bound is a lower bound of the real cost', () => {
  // enumerate with an infinite budget and compare each leaf's real cost
  // with the bound the search pruned against (H at the root of its walk).
  const t = SpellingSearch.tables();
  let checked = 0;
  for (const [stepAlgs, root] of [[["F' U F", "U2 R U' R'"], false], [[], true]]) {
    const holder = {};
    const costOf = alg => stepsPathCost(holder, stepAlgs, alg);
    costOf('R');
    const floor = SpellingSearch.mccFloor(holder._costBase.mcc) + holder._costBase.penalty;
    for (let k = 0; k < (root ? 6 : 25); k++) {
      const face = randomFace(root ? 4 : 5 + (k % 3)).map(x => t.TID.get(x));
      const L = SpellingSearch.lmTables();
      const H = SpellingSearch.boundTable(face, null, SpellingSearch.mccMinimum(), SpellingSearch.penalties(), L);
      const leastFrom = new Map();
      for (const [lt, ld] of root ? t.LEAD_ROOT : t.LEAD_LATER) leastFrom.set(ld, H[(face.length * t.NR + ld) * SpellingSearch.FLAGS] + (lt >= 0 ? SpellingSearch.mccMinimum()[lt] : 0));
      SpellingSearch.enumerate([{ face, look: 0 }], {
        root,
        budget: () => Infinity,
        leaf: (ids, lead) => {
          const alg = Array.from(ids, i => t.TOK[i]).join(' ');
          const cost = costOf(alg);
          const least = leastFrom.get(lead);
          assert.ok(cost - floor >= least - 1e-9, `${alg}: ${cost - floor} < bound ${least}`);
          checked++;
        },
      });
    }
  }
  assert.ok(checked > 5000, `${checked} spellings checked`);
});

if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
console.log('\nAll spelling-search tests passed.');
