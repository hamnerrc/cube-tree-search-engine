// Regression tests for cross-optimization.js (README "Wide moves and Cross
// optimisation"). The core equivalences and the relabeling formula were
// verified against `magiccube`/facelet-cube.js during development (see
// cross-optimization.js's header comment and PROJECT_STATUS.md §4.13) --
// these tests re-verify end-to-end: every variant optimizeCrossSolution
// returns must be physically equal to "the original algorithm, followed by
// its own reported residual rotation" when wide-move tokens are expanded
// back to their literal (face-move + rotation) definition.

const assert = require('assert');
const path = require('path');

// cross-optimization.js expects MOVE_TABLE/composePerm/invertPerm/
// IDENTITY_PERM as bare globals (shared <script> scope in the browser).
const faceletCube = require(path.join(__dirname, '..', 'js', 'facelet-cube.js'));
Object.assign(global, faceletCube);
const { applyAlgorithm, SOLVED_FACELETS, MOVE_TABLE, IDENTITY_PERM } = faceletCube;
const { WIDE_MOVE_RULES, keepsCrossOnBottom, optimizeCrossSolution } = require(path.join(__dirname, '..', 'js', 'cross-optimization.js'));

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL: ${name}\n  ${err.message}`);
  }
}

// Wide tokens are replayed by facelet-cube.js itself, whose wide moves are
// verified against magiccube (test/facelet-fixture.json) -- an independent
// check of this file's output notation, which a private expansion table
// here could not provide (it once hid a "d" vs "u" notation bug, §4.19).
function expand(tokens) {
  return tokens.join(' ');
}

function assertAllVariantsPhysicallyCorrect(original) {
  const variants = optimizeCrossSolution(original);
  assert.ok(variants.length >= 1, 'expected at least the unconverted identity variant');
  for (const v of variants) {
    const expected = applyAlgorithm(SOLVED_FACELETS, original.join(' ') + (v.rotation ? ' ' + v.rotation : ''));
    const actual = applyAlgorithm(SOLVED_FACELETS, expand(v.moves));
    assert.strictEqual(
      actual, expected,
      `variant ${JSON.stringify(v)} does not match "original + its own rotation"`
    );
  }
  return variants;
}

test('WIDE_MOVE_RULES excludes D2 (its only wide form needs a forbidden mid-algorithm y2)', () => {
  assert.strictEqual(WIDE_MOVE_RULES.D2, undefined);
  assert.ok(WIDE_MOVE_RULES.D);
  assert.ok(WIDE_MOVE_RULES["D'"]);
});

test('keepsCrossOnBottom accepts exactly the 4 pure y-rotations', () => {
  assert.strictEqual(keepsCrossOnBottom(IDENTITY_PERM), true);
  assert.strictEqual(keepsCrossOnBottom(MOVE_TABLE.y), true);
  assert.strictEqual(keepsCrossOnBottom(MOVE_TABLE.y2), true);
  assert.strictEqual(keepsCrossOnBottom(MOVE_TABLE["y'"]), true);
  assert.strictEqual(keepsCrossOnBottom(MOVE_TABLE.x), false);
  assert.strictEqual(keepsCrossOnBottom(MOVE_TABLE["x'"]), false);
  assert.strictEqual(keepsCrossOnBottom(MOVE_TABLE.x2), false);
  assert.strictEqual(keepsCrossOnBottom(MOVE_TABLE.z), false);
  assert.strictEqual(keepsCrossOnBottom(MOVE_TABLE.z2), false);
});

test('optimizeCrossSolution: every variant of a mixed algorithm is physically correct', () => {
  assertAllVariantsPhysicallyCorrect(['D2', 'F2', 'L', "F'", 'R', "D'", 'B2', "L'"]);
});

test('optimizeCrossSolution: every variant of an all-eligible algorithm is physically correct', () => {
  assertAllVariantsPhysicallyCorrect(['L', 'R', 'D', "L'", "R'", "D'", 'L2', 'R2']);
});

test('optimizeCrossSolution: an algorithm with no eligible moves returns only the identity', () => {
  const variants = optimizeCrossSolution(['U', "F'", 'B2', 'U2']);
  assert.strictEqual(variants.length, 1);
  assert.deepStrictEqual(variants[0], { moves: ['U', "F'", 'B2', 'U2'], rotation: '' });
});

test('optimizeCrossSolution: a lone D2 is never converted (would need forbidden y2)', () => {
  const variants = optimizeCrossSolution(['D2']);
  assert.strictEqual(variants.length, 1);
  assert.deepStrictEqual(variants[0], { moves: ['D2'], rotation: '' });
});

test('optimizeCrossSolution: a lone eligible move is NOT convertible alone (its rotation has nothing to cancel it)', () => {
  // Converting the only L into r leaves a residual x rotation uncancelled
  // -- x moves D off the bottom, so the orientation filter must reject it,
  // leaving only the unconverted identity variant.
  const variants = assertAllVariantsPhysicallyCorrect(['L']);
  assert.strictEqual(variants.length, 1);
  assert.deepStrictEqual(variants[0], { moves: ['L'], rotation: '' });
});

test('optimizeCrossSolution: two opposite-rotation conversions can cancel out, surviving the orientation filter', () => {
  // L -> r introduces x; R -> l introduces x' (see WIDE_MOVE_RULES) --
  // together they cancel, so converting BOTH should survive even though
  // converting either one alone (per the test above) would not.
  const variants = assertAllVariantsPhysicallyCorrect(['L', 'R']);
  assert.ok(variants.some(v => v.moves.join(' ') === 'r l' && v.rotation === ''));
});

test('optimizeCrossSolution: results are deduplicated by (moves, rotation)', () => {
  const variants = optimizeCrossSolution(['L', "L'"]);
  const keys = variants.map(v => v.moves.join(' ') + '|' + v.rotation);
  assert.strictEqual(keys.length, new Set(keys).size);
});

test('optimizeCrossSolution: a longer (10-move) realistic algorithm stays physically correct', () => {
  assertAllVariantsPhysicallyCorrect(['D2', "R'", 'U', 'F', "L'", 'D', 'B2', 'R', "F'", 'L']);
});

// The original 2^n-mask implementation (before PROJECT_STATUS.md §4.36),
// kept as the reference the faster depth-first version must match exactly.
function optimizeCrossSolutionReference(moves) {
  const { relabelMovePerm } = require(path.join(__dirname, '..', 'js', 'cross-optimization.js'));
  const NAMES = ['U', "U'", 'U2', 'D', "D'", 'D2', 'R', "R'", 'R2', 'L', "L'", 'L2', 'F', "F'", 'F2', 'B', "B'", 'B2'];
  const nameOf = perm => NAMES.find(nm => MOVE_TABLE[nm].join(',') === perm.join(',')) || null;
  const ROT = { '': IDENTITY_PERM, y: MOVE_TABLE.y, y2: MOVE_TABLE.y2, "y'": MOVE_TABLE["y'"] };
  const results = [];
  const seen = new Set();
  for (let mask = 0; mask < (1 << moves.length); mask++) {
    let cumRot = IDENTITY_PERM;
    const out = [];
    let valid = true;
    for (let i = 0; i < moves.length; i++) {
      const name = nameOf(relabelMovePerm(MOVE_TABLE[moves[i]], cumRot));
      if (!name) { valid = false; break; }
      const rule = WIDE_MOVE_RULES[name];
      if ((mask & (1 << i)) && rule) {
        out.push(rule.wide);
        cumRot = faceletCube.composePerm(cumRot, MOVE_TABLE[rule.rotation]);
      } else out.push(name);
    }
    if (!valid || !keepsCrossOnBottom(cumRot)) continue;
    const rotation = Object.keys(ROT).find(k => ROT[k].join(',') === cumRot.join(',')) ?? null;
    const key = out.join(' ') + '|' + rotation;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ moves: out, rotation });
  }
  return results;
}

test('optimizeCrossSolution matches the original implementation exactly (300 random algs, order included)', () => {
  const faces = ['U', "U'", 'U2', 'D', "D'", 'D2', 'R', "R'", 'R2', 'L', "L'", 'L2', 'F', "F'", 'F2', 'B', "B'", 'B2'];
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  for (let k = 0; k < 300; k++) {
    const n = 1 + Math.floor(rnd() * 10);
    const alg = Array.from({ length: n }, () => faces[Math.floor(rnd() * faces.length)]);
    assert.deepStrictEqual(optimizeCrossSolution(alg), optimizeCrossSolutionReference(alg), alg.join(' '));
  }
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll cross-optimization.js tests passed.');
