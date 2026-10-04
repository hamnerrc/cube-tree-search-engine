#!/usr/bin/env node
/**
 * Tests for random-state-scramble.js.
 *
 * The scrambler's cubie model is derived from facelet-cube.js (itself
 * verified against magiccube), so the checks here are about consistency
 * with that simulator and with an independent solver, not about any
 * hand-written move table:
 *   - the solved facelet string decodes to the identity cubie state
 *   - for random move sequences, cubie multiplication and facelet-cube.js
 *     replay agree facelet-for-facelet
 *   - every generated scramble, replayed through facelet-cube.js, produces
 *     exactly the random cubie state it was generated from
 *   - random states obey the cube's invariants (orientation sums, parity)
 *     and a cheap uniformity sanity check
 *   - the Python `kociemba` package (an independent two-phase solver) solves
 *     our scrambled states, and its solution really solves them (skipped if
 *     python3/kociemba is unavailable)
 *
 * Run: node test/random-state-scramble.test.js
 */
const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const F = require(path.join(root, 'facelet-cube.js'));
const { RandomStateScramble: R, generateRandomStateScramble } = require(path.join(root, 'random-state-scramble.js'));

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); } catch (e) { failures++; console.log(`FAIL: ${name}\n  ${e.message}`); }
}

let seed = 12345;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };

test('solved facelets decode to the identity cubie state and back', () => {
  assert.deepStrictEqual(R.faceletsToCubie(F.SOLVED_FACELETS), R.SOLVED_CUBIE);
  assert.strictEqual(R.cubieToFacelets(R.SOLVED_CUBIE), F.SOLVED_FACELETS);
});

test('cubie multiplication agrees with facelet-cube.js on 300 random move sequences', () => {
  const moveCubie = m => R.faceletsToCubie(F.applyAlgorithm(F.SOLVED_FACELETS, m));
  for (let i = 0; i < 300; i++) {
    const seq = Array.from({ length: 1 + Math.floor(rand() * 25) }, () => R.MOVE_NAMES[Math.floor(rand() * 18)]);
    let c = R.SOLVED_CUBIE;
    for (const m of seq) c = R.multiply(c, moveCubie(m));
    const viaFacelets = F.applyAlgorithm(F.SOLVED_FACELETS, seq.join(' '));
    assert.strictEqual(R.cubieToFacelets(c), viaFacelets, `sequence ${seq.join(' ')}`);
    assert.deepStrictEqual(R.faceletsToCubie(viaFacelets), c, `decode of ${seq.join(' ')}`);
  }
});

test('random cubie states satisfy orientation-sum and parity invariants', () => {
  const parity = p => { let x = 0; for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[j] < p[i]) x ^= 1; return x; };
  for (let i = 0; i < 2000; i++) {
    const c = R.randomCubie(rand);
    assert.strictEqual(c.co.reduce((a, b) => a + b, 0) % 3, 0);
    assert.strictEqual(c.eo.reduce((a, b) => a + b, 0) % 2, 0);
    assert.strictEqual(parity(c.cp), parity(c.ep));
    assert.deepStrictEqual(c.cp.slice().sort(), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.deepStrictEqual(c.ep.slice().sort((a, b) => a - b), [...Array(12).keys()]);
  }
});

test('random cubie states are roughly uniform (corner at URF, edge at UR, their orientations)', () => {
  const N = 24000;
  const cornerAt = Array(8).fill(0), edgeAt = Array(12).fill(0), co = Array(3).fill(0), eo = Array(2).fill(0);
  for (let i = 0; i < N; i++) {
    const c = R.randomCubie(rand);
    cornerAt[c.cp[0]]++; edgeAt[c.ep[0]]++; co[c.co[0]]++; eo[c.eo[0]]++;
  }
  // Each bucket within 15% of its expectation (very loose; catches a
  // skewed shuffle or a biased parity/orientation fix-up, not subtle bias).
  for (const [counts, k] of [[cornerAt, 8], [edgeAt, 12], [co, 3], [eo, 2]]) {
    for (const n of counts) assert.ok(Math.abs(n - N / k) < 0.15 * N / k, `bucket ${n} vs expected ${N / k}`);
  }
});

const generated = [];
test('40 generated scrambles replay (facelet-cube.js) to exactly their random state', () => {
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    const { scramble, state } = R.generate(rand);
    generated.push({ scramble, state });
    const tokens = scramble.split(' ');
    assert.ok(tokens.length >= 2 && tokens.length <= 22, `length ${tokens.length}: ${scramble}`);
    tokens.forEach((tok, j) => {
      assert.ok(R.MOVE_NAMES.includes(tok), `bad token ${tok}`);
      if (j) assert.notStrictEqual(tok[0], tokens[j - 1][0], `repeated face in ${scramble}`);
    });
    assert.strictEqual(F.applyAlgorithm(F.SOLVED_FACELETS, scramble), R.cubieToFacelets(state), scramble);
  }
  console.log(`  (40 scrambles incl. one-time table build: ${Date.now() - t0} ms)`);
});

test('generateRandomStateScramble returns a plain scramble string', () => {
  const s = generateRandomStateScramble(rand);
  assert.ok(/^([URFDLB]['2]? ?)+$/.test(s), s);
});

// Independent check: the Python `kociemba` package must accept each of our
// scrambled states as a valid cube, and its solution must solve it.
const py = spawnSync('python3', ['-c', 'import kociemba'], { encoding: 'utf8' });
if (py.status !== 0) {
  console.log('SKIP: python3 kociemba cross-check (package not available)');
} else {
  test('python kociemba solves every scrambled state, verified by facelet replay', () => {
    const faces = F.SOLVED_FACELETS;
    const toLetters = f => f.split('').map(c => 'URFDLB'[[4, 13, 22, 31, 40, 49].findIndex(i => faces[i] === c)]).join('');
    const states = generated.slice(0, 15).map(g => toLetters(F.applyAlgorithm(F.SOLVED_FACELETS, g.scramble)));
    const out = spawnSync('python3', ['-c', 'import sys,kociemba\nfor l in sys.stdin.read().split():\n print(kociemba.solve(l))'],
      { input: states.join('\n'), encoding: 'utf8' });
    assert.strictEqual(out.status, 0, out.stderr);
    const sols = out.stdout.trim().split('\n');
    assert.strictEqual(sols.length, states.length);
    sols.forEach((sol, i) => {
      const end = F.applyAlgorithm(F.applyAlgorithm(F.SOLVED_FACELETS, generated[i].scramble), sol.trim());
      assert.strictEqual(end, F.SOLVED_FACELETS, `kociemba solution ${sol} did not solve ${generated[i].scramble}`);
    });
  });
}

if (failures) { console.log(`\n${failures} test(s) failed.`); process.exit(1); }
console.log('\nAll random-state-scramble.js tests passed.');
