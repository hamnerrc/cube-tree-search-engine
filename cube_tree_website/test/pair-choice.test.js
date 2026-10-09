#!/usr/bin/env node
/**
 * Pair choice (README "Pair choice"): the look-ahead features of the unsolved
 * pairs (facelet-flags.js pairLookFeatures) on positions whose answer is
 * known, their invariance under y rotations, and their weights (script.js
 * PAIR_CHOICE_LOOK).
 */
'use strict';
const assert = require('assert');
const { applyAlgorithm, SOLVED_FACELETS } = require('../js/facelet-cube.js');
const { pairLookFeatures, solvedFlags, LOOK_FEATURES, planFeatures, planFeaturesY } = require('../js/facelet-flags.js');
const { PAIR_CHOICE_LOOK } = require('../js/script.js');

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); } catch (err) { failures++; console.error(`FAIL: ${name}\n  ${err.stack}`); }
}
const features = alg => pairLookFeatures(applyAlgorithm(SOLVED_FACELETS, alg));
const named = alg => Object.fromEntries(LOOK_FEATURES.map((n, i) => [n, features(alg)[i]]));

test('known positions (each is the inverse of a standard insertion from solved)', () => {
  assert.deepStrictEqual(features(''), [0, 0, 0, 0, 0], 'solved: no unsolved pair');
  // R U' R' undoes "R U R'": the split pair that insertion solves.
  assert.deepStrictEqual(named("R U' R'"), { trappedCorners: 0, trappedEdges: 0, piecesHome: 0, bothInU: 1, connected: 0 });
  // R U R' undoes "R U' R'": a connected pair.
  assert.deepStrictEqual(named("R U R'"), { trappedCorners: 0, trappedEdges: 0, piecesHome: 0, bothInU: 1, connected: 1 });
  // the FR corner twisted in its slot, its edge in U
  assert.deepStrictEqual(named("R U R' U' R U R'"), { trappedCorners: 1, trappedEdges: 0, piecesHome: 0, bothInU: 0, connected: 0 });
  // two pairs out: FR connected in U, FL's corner left in the FR slot
  assert.strictEqual(named("R U R' L' U' L").connected, 1);
});

test('unchanged by y rotations; F2L-like random states', () => {
  const triggers = ['U', "U'", 'U2', "R U R'", "R U' R'", "L' U L", "F' U F", "R' F R F'", "B U B'", 'y', "r U r'"];
  let seed = 3;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let n = 0;
  for (let k = 0; k < 2000; k++) {
    const alg = Array.from({ length: 1 + Math.floor(rnd() * 8) }, () => triggers[Math.floor(rnd() * triggers.length)]).join(' ');
    const f = applyAlgorithm(SOLVED_FACELETS, alg);
    if (!solvedFlags(f).cross) continue;
    n++;
    const x = pairLookFeatures(f).join();
    for (const r of ['y', 'y2', "y'"]) assert.strictEqual(pairLookFeatures(applyAlgorithm(f, r)).join(), x, `${alg} ${r}`);
  }
  assert.ok(n > 1000);
});

test('PAIR_CHOICE_LOOK: one weight per feature; a connected pair is worth more than a split one', () => {
  assert.strictEqual(PAIR_CHOICE_LOOK.length, LOOK_FEATURES.length);
  const cost = alg => features(alg).reduce((t, x, k) => t + x * PAIR_CHOICE_LOOK[k], 0);
  assert.ok(cost("R U R'") < cost("R U' R'"), 'connected pair left < split pair left');
  assert.strictEqual(cost(''), 0, 'F2L solved: no term');
});

test('planFeaturesY equals planFeatures of the cube after each y rotation', () => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  // cross-preserving triggers (and y rotations), so every state has the cross
  const triggers = ["R U R'", "R U' R'", "R U2 R'", "R' U R", "L' U L", "L U L'", "F' U F", "F U F'", "B U B'", "B' U B", 'U', "U'", 'U2', "R' F R F'", "L' U2 L", 'y', "y'"];
  let checked = 0;
  for (let k = 0; k < 600; k++) {
    const alg = Array.from({ length: 3 + (k % 9) }, () => triggers[Math.floor(rnd() * triggers.length)]).join(' ');
    const f = applyAlgorithm(SOLVED_FACELETS, alg);
    assert.ok(solvedFlags(f).cross, alg);
    const got = planFeaturesY(f);
    ['', 'y', 'y2', "y'"].forEach((r, i) => {
      assert.deepStrictEqual(got.slice(4 * i, 4 * i + 4), planFeatures(r ? applyAlgorithm(f, r) : f), `${alg} then ${r}`);
      checked++;
    });
  }
  assert.ok(checked >= 2400);
});

if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
console.log('\nAll pair-choice tests passed.');
