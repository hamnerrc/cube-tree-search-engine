#!/usr/bin/env node
/**
 * Regression tests for the pure, exported functions in script.js
 * (pruneGraph, isPseudoState, calculateSolvedPieces, cleanScramble,
 * altAlgs).
 *
 * These had zero test coverage before this file, and a real bug
 * (tree_gen.py's extract_solved_slots() mislabeling every node's
 * corners/edges as the literal strings "C"/"E" -- see git history)
 * went undetected specifically because isPseudoState()/pruneGraph()'s
 * behavior on realistic data was never checked. This suite exercises
 * them directly with hand-verified inputs/outputs so a similar
 * regression fails loudly here instead of silently in the browser.
 *
 * Run: node test/script.test.js
 */
const assert = require('assert');
const path = require('path');
const {
  altAlgs,
  cleanScramble,
  isPseudoState,
  calculateSolvedPieces,
  algSpeed,
} = require(path.join(__dirname, '..', 'js', 'script.js'));

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

// pruneGraph is not exported via module.exports (only used in the
// DOMContentLoaded browser path), so pull it out of the file source
// directly for testing rather than duplicating its logic here.
const fs = require('fs');
const scriptSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'script.js'), 'utf8');
const pruneGraphMatch = scriptSrc.match(/function pruneGraph\([\s\S]*?\n}\n/);
assert(pruneGraphMatch, 'could not locate pruneGraph source to extract for testing');
// eslint-disable-next-line no-eval
const pruneGraph = eval(`(${pruneGraphMatch[0]})`);

// ---------------------------------------------------------------------
// cleanScramble
// ---------------------------------------------------------------------

test('cleanScramble strips the placeholder word "none" (word-boundary aware)', () => {
  assert.strictEqual(cleanScramble('  R  U   none  '), 'R U');
});

test('cleanScramble does not mangle "none" as a substring of another word', () => {
  assert.strictEqual(cleanScramble('Nonetheless R'), 'Nonetheless R');
});

test('cleanScramble collapses internal whitespace', () => {
  assert.strictEqual(cleanScramble('R    U\tD'), 'R U D');
});

// ---------------------------------------------------------------------
// isPseudoState
// ---------------------------------------------------------------------

test('isPseudoState: empty state is not pseudo', () => {
  assert.strictEqual(isPseudoState({ corners: [], edges: [] }), false);
});

test('isPseudoState: matched single pair is not pseudo', () => {
  assert.strictEqual(isPseudoState({ corners: ['FR'], edges: ['FR'] }), false);
});

test('isPseudoState: mismatched single pair IS pseudo', () => {
  assert.strictEqual(isPseudoState({ corners: ['FR'], edges: ['FL'] }), true);
});

test('isPseudoState: matched two-pair state is not pseudo regardless of array order', () => {
  assert.strictEqual(isPseudoState({ corners: ['FL', 'FR'], edges: ['FR', 'FL'] }), false);
});

test('isPseudoState: unequal corner/edge counts IS pseudo', () => {
  assert.strictEqual(isPseudoState({ corners: ['FR', 'FL'], edges: ['FR'] }), true);
});

// ---------------------------------------------------------------------
// calculateSolvedPieces
// ---------------------------------------------------------------------

test('calculateSolvedPieces: root transition (cross unsolved) adds 4 for the cross', () => {
  const root = { state: { cross_solved: false, corners: [], edges: [] } };
  const target = { state: { cross_solved: true, corners: [], edges: [] } };
  assert.strictEqual(calculateSolvedPieces(root, target), 4);
});

test('calculateSolvedPieces: non-root transition does not double-count the cross', () => {
  const source = { state: { cross_solved: true, corners: [], edges: [] } };
  const target = { state: { cross_solved: true, corners: ['FR'], edges: ['FR'] } };
  assert.strictEqual(calculateSolvedPieces(source, target), 2);
});

test('calculateSolvedPieces: only counts newly-solved pieces, not already-solved ones', () => {
  const source = { state: { cross_solved: true, corners: ['FR'], edges: ['FR'] } };
  const target = { state: { cross_solved: true, corners: ['FR', 'FL'], edges: ['FR', 'FL'] } };
  assert.strictEqual(calculateSolvedPieces(source, target), 2);
});

// ---------------------------------------------------------------------
// altAlgs
// ---------------------------------------------------------------------

test('altAlgs: produces exactly 4 y-rotation variants per input algorithm', () => {
  const result = altAlgs(["R U"]);
  assert.strictEqual(result.length, 4);
});

test('altAlgs: first variant is the original algorithm, unprefixed', () => {
  const result = altAlgs(["R U"]);
  assert.strictEqual(result[0], 'R U');
});

test('altAlgs: y-rotated variants correctly remap R->F->L->B under successive y rotations', () => {
  const result = altAlgs(["R U"]);
  assert.deepStrictEqual(result, ["R U", "y F U", "y2 L U", "y' B U"]);
});

// Every action has a cost (user decision 2026-10-04, PROJECT_STATUS §4.21).
test('algSpeed: every single move, wide move, slice and rotation has a positive cost', () => {
  const T = [...'UDRLFBudrlfbMESxyz'].flatMap(f => [f, f + "'", f + '2']);
  for (const t of T) assert.ok(algSpeed(t, false, false) > 0, `${t} costs ${algSpeed(t, false, false)}`);
});

test('algSpeed: appending an x rotation always adds cost (2000 random contexts)', () => {
  const T = [...'UDRLFBrlMxyz'].flatMap(f => [f, f + "'", f + '2']);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 2000; i++) {
    const a = Array.from({ length: 1 + Math.floor(rnd() * 10) }, () => T[Math.floor(rnd() * T.length)]).join(' ');
    const base = algSpeed(a, false, false);
    for (const x of ['x', "x'", 'x2']) assert.ok(algSpeed(`${a} ${x}`, false, false) > base, `${a} + ${x}`);
  }
});

// ---------------------------------------------------------------------
// pruneGraph
// ---------------------------------------------------------------------

function makeSyntheticTree() {
  return {
    nodes: [
      { id: 'N0', state: { cross_solved: false, corners: [], edges: [] } },
      { id: 'N1', state: { cross_solved: true, corners: [], edges: [] } },
      { id: 'N2', state: { cross_solved: true, corners: ['FR'], edges: ['FR'] } },
      { id: 'N3', state: { cross_solved: true, corners: ['FR', 'FL'], edges: ['FR', 'FL'] } },
      { id: 'N4', state: { cross_solved: true, corners: ['FR'], edges: ['FL'] } }, // pseudo
      { id: 'N5', state: { cross_solved: true, corners: ['FR', 'BL'], edges: ['FL', 'FR'] } }, // pseudo, different mismatch
      { id: 'N6', state: { cross_solved: true, corners: ['FL', 'FR'], edges: ['FL', 'FR'] } }, // repair of N4
    ],
    edges: [
      { source: 'N0', target: 'N1', solved_step: { corners: [], edges: [] } },
      { source: 'N0', target: 'N2', solved_step: { corners: ['FR'], edges: ['FR'] } },
      { source: 'N0', target: 'N3', solved_step: { corners: ['FR', 'FL'], edges: ['FR', 'FL'] } },
      { source: 'N0', target: 'N4', solved_step: { corners: ['FR'], edges: ['FL'] } },
      { source: 'N1', target: 'N2', solved_step: { corners: ['FR'], edges: ['FR'] } },
      { source: 'N1', target: 'N3', solved_step: { corners: ['FR', 'FL'], edges: ['FR', 'FL'] } },
      { source: 'N4', target: 'N6', solved_step: { corners: ['FL'], edges: ['FR'] }, full_pseudo_only: false },
      { source: 'N4', target: 'N5', solved_step: { corners: ['BL'], edges: ['FR'] }, full_pseudo_only: true },
    ],
  };
}

function edgeKeys(pruned) {
  return pruned.edges.map(e => `${e.source}->${e.target}`).sort();
}

test('pruneGraph: with no advanced options, only plain cross + single-pair non-root transitions survive', () => {
  const pruned = pruneGraph(makeSyntheticTree(), { advanced: [] });
  assert.deepStrictEqual(edgeKeys(pruned), ['N0->N1', 'N1->N2']);
});

test('pruneGraph: xcross option allows the root->1-pair edge', () => {
  const pruned = pruneGraph(makeSyntheticTree(), { advanced: ['xcross'] });
  assert.deepStrictEqual(edgeKeys(pruned), ['N0->N1', 'N0->N2', 'N1->N2']);
});

test('pruneGraph: xcross+xxcross+multislotting allows 2-pair edges too, pseudo still excluded', () => {
  const pruned = pruneGraph(makeSyntheticTree(), { advanced: ['xcross', 'xxcross', 'multislotting'] });
  assert.deepStrictEqual(edgeKeys(pruned), ['N0->N1', 'N0->N2', 'N0->N3', 'N1->N2', 'N1->N3']);
});

test('pruneGraph: full_pseudo includes the mismatched-pair node and its root edge', () => {
  const pruned = pruneGraph(makeSyntheticTree(), { advanced: ['xcross', 'full_pseudo'] });
  assert.deepStrictEqual(edgeKeys(pruned), ['N0->N1', 'N0->N2', 'N0->N4', 'N1->N2', 'N4->N5', 'N4->N6']);
  assert.ok(pruned.nodes.some(n => n.id === 'N4'), 'pseudo node N4 should be present in validNodes');
});

test('pruneGraph: simplified_pseudo keeps only the direct repair out of a mismatched node', () => {
  const pruned = pruneGraph(makeSyntheticTree(), { advanced: ['xcross', 'full_pseudo', 'simplified_pseudo'] });
  assert.deepStrictEqual(edgeKeys(pruned), ['N0->N1', 'N0->N2', 'N0->N4', 'N1->N2', 'N4->N6']);
});

test('pruneGraph: simplified_pseudo without pseudo F2L changes nothing (no mismatched nodes survive)', () => {
  const plain = pruneGraph(makeSyntheticTree(), { advanced: ['xcross'] });
  const simplified = pruneGraph(makeSyntheticTree(), { advanced: ['xcross', 'simplified_pseudo'] });
  assert.deepStrictEqual(edgeKeys(simplified), edgeKeys(plain));
});

test('pruneGraph: without multislotting, a non-root edge solving 2 pairs at once is excluded', () => {
  const pruned = pruneGraph(makeSyntheticTree(), { advanced: ['xcross', 'xxcross'] });
  assert.ok(!edgeKeys(pruned).includes('N1->N3'), 'N1->N3 (2-pair multislot step) should be excluded without multislotting');
});

test('stepPenalty (PROJECT_STATUS §4.35, §4.47): penalties only, step-aware rotations, naturalness', () => {
  const { stepPenalty, algSurprise, STEP_PENALTIES: P } = require('../js/script.js');
  const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m || ''} ${a} vs ${b}`);
  const nat = alg => P.natural * algSurprise(alg);
  near(stepPenalty("R U R' U'"), nat("R U R' U'"), 'R/U moves cost only their naturalness');
  near(stepPenalty("L' U L"), nat("L' U L"));
  near(stepPenalty("y R U R'"), nat("R U R'"), 'a rotation that starts the step is free');
  near(stepPenalty("U R' U' R y U' R U R'"), P.rotMidY + nat("U R' U' R y U' R U R'"), 'a mid-step y is penalised');
  near(stepPenalty("F R' F' r U r'"), 2 * P.F + 2 * P.wideRL + nat("F R' F' r U r'"));
  near(stepPenalty("D' B u"), P.D + P.B + P.wideUDFB + nat("D' B u"));
  near(stepPenalty("M' U M"), 2 * P.wideOther + nat("M' U M"), 'slices');
  assert.strictEqual(stepPenalty(''), 0);
  assert.strictEqual(stepPenalty('y'), 0, 'a lone rotation has no moves to judge');
  assert.ok(!('turn' in P), 'the flat per-turn cost (§4.46) is replaced by naturalness');
  for (const v of Object.values(P)) assert.ok(v >= 0, 'no move may cost less than MCC');
});

test('algSurprise (PROJECT_STATUS §4.47): human F2L sequences are natural, machine-like ones are not', () => {
  const { algSurprise, buildNaturalnessModel, useNaturalnessModel, proStepAlgs } = require('../js/script.js');
  const PRO_STEP_ALGS = proStepAlgs();
  const perMove = a => algSurprise(a) / a.split(' ').filter(t => !/^[xyz]/.test(t)).length;
  // Familiar inserts beat sequences of individually cheap but unfamiliar moves.
  assert.ok(algSurprise("U R U' R'") < algSurprise("U R2 U' R2"));
  assert.ok(perMove("y' U R' U' R U2 R U R'") < 3, 'a standard F2L alg');
  assert.ok(perMove("y U R2 U2 F R F' U2 R2") > 4, 'a machine-looking one');
  assert.ok(algSurprise("R U' R' F' L' U2 L F") < algSurprise("R U' R' F' L2 U2 L' F"));
  // Left-right mirrors are equally natural (the corpus is mirrored).
  const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m || ''} ${a} vs ${b}`);
  near(algSurprise("R U R' U' R U R'"), algSurprise("L' U' L U L' U' L"), 'mirror');
  near(algSurprise("U' F' U F"), algSurprise("U F U' F'"), 'mirror (F turns flip direction)');
  // Leading rotations are free, notation variants agree, arrays are accepted.
  near(algSurprise("y' U' L' U L"), algSurprise("U' L' U L"));
  near(algSurprise("R2' U R"), algSurprise('R2 U R'));
  near(algSurprise(['R', 'U', "R'"]), algSurprise("R U R'"));
  // A mid-step rotation is a token, not a fresh start.
  assert.ok(algSurprise("U l' x' U2 R U R' U' R") > algSurprise("U2 R U R' U' R"));
  // Leave-one-solve-out models (tools/pro-ranking.js) see less of that solve.
  // js/pro-steps.js: pro_references.txt's 19 solves first, then reco.nz's.
  assert.ok(PRO_STEP_ALGS.length > 900);
  assert.strictEqual(PRO_STEP_ALGS[3][0], 'L F2 D\' L U L\' R\' F', 'pro_references.txt #4 at index 3');
  const held = buildNaturalnessModel({ excludeSolve: 4 });
  const pro4 = PRO_STEP_ALGS[3][0];
  assert.ok(held.surprise(pro4) > algSurprise(pro4), 'held-out solve is less familiar');
  useNaturalnessModel(held);
  near(algSurprise(pro4), held.surprise(pro4), 'useNaturalnessModel swaps the model');
  useNaturalnessModel(null);
  assert.ok(algSurprise(pro4) < held.surprise(pro4), 'null restores the default model');
});

test('stepPenalty (PROJECT_STATUS §4.46): one function for every step', () => {
  const { stepPenalty, STEP_PENALTIES: P } = require('../js/script.js');
  assert.ok(!('wideRLFirst' in P), 'no first-step values');
  assert.strictEqual(stepPenalty("r U r'", true), stepPenalty("r U r'", false));
  assert.strictEqual(stepPenalty("f R' f'", true), stepPenalty("f R' f'"));
  // SolveSession.pathCost: every step, first or later, the same penalty.
  const scriptExports = require('../js/script.js');
  for (const k of ['algSpeed', 'algSpeedPrefix', 'algSpeedResume', 'stepPenalty']) global[k] = scriptExports[k]; // browser globals
  const { stepsPathCost } = require('../js/solver-bridge.js');
  const { algSpeed } = scriptExports;
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);
  near(stepsPathCost({}, [], "r U R'"), algSpeed("r U R'") + stepPenalty("r U R'"));
  near(stepsPathCost({}, ["r U R'"], "l U' L'"), algSpeed("r U R' l U' L'") + stepPenalty("r U R'") + stepPenalty("l U' L'"));
});

test('normalizeCriteria: pro move set + cross optimisation always on, retired options moved to view settings', () => {
  const { normalizeCriteria, ALWAYS_ON_OPTIONS } = require(path.join(__dirname, '..', 'js', 'script.js'));
  const fresh = normalizeCriteria({ colors: ['white'], advanced: ['xcross'] });
  assert.deepStrictEqual(fresh.advanced, ['xcross', ...ALWAYS_ON_OPTIONS]);
  assert.strictEqual(fresh.legacyView, undefined);
  const old = normalizeCriteria({ advanced: ['pro_moves', 'full_pseudo', 'simplified_pseudo'], lookaheadDepth: 3, lookaheadBreadth: 7 });
  assert.deepStrictEqual(old.advanced, ['full_pseudo', ...ALWAYS_ON_OPTIONS]);
  assert.deepStrictEqual(old.legacyView, { simplePseudo: true, lookaheadDepth: 3, lookaheadBreadth: 7 });
  assert.strictEqual(old.lookaheadDepth, undefined);
  assert.deepStrictEqual(normalizeCriteria(old), old, 'idempotent');
});

test('normalizeCriteria: multislotting becomes the results-page multislot setting', () => {
  const { normalizeCriteria, ALWAYS_ON_OPTIONS } = require(path.join(__dirname, '..', 'js', 'script.js'));
  const old = normalizeCriteria({ advanced: ['xcross', 'multislotting'] });
  assert.deepStrictEqual(old.advanced, ['xcross', ...ALWAYS_ON_OPTIONS]);
  assert.deepStrictEqual(old.legacyView, { multislot: true });
  assert.deepStrictEqual(normalizeCriteria(old), old, 'idempotent');
});

test('solutions per search: default 10000; a stored 500 from before CRITERIA_VERSION 3 was the old default', () => {
  const { normalizeCriteria, CRITERIA_VERSION } = require(path.join(__dirname, '..', 'js', 'script.js'));
  assert.ok(CRITERIA_VERSION >= 3);
  assert.strictEqual(normalizeCriteria({ advanced: [], maxSolutions: 500 }).maxSolutions, 10000, 'old default migrates');
  assert.strictEqual(normalizeCriteria({ advanced: [], maxSolutions: 500, version: 2 }).maxSolutions, 10000);
  assert.strictEqual(normalizeCriteria({ advanced: [], maxSolutions: 500, version: CRITERIA_VERSION }).maxSolutions, 500, 'a chosen 500 stays');
  assert.strictEqual(normalizeCriteria({ advanced: [], maxSolutions: 2000 }).maxSolutions, 2000, 'other values stay');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.ok(/id="max-solutions" value="10000"/.test(html), 'page default 10000');
  const { DISTANCE1_LIMITS } = require(path.join(__dirname, '..', 'js', 'solver-bridge.js'));
  assert.deepStrictEqual(DISTANCE1_LIMITS, { 0: 9, 1: 10, 2: 10, 3: 11 }, 'cross 9, xcross 10, xxcross 10, xxxcross 11');
});

test('time limit: blank is no limit (null), never 0 or an implicit 60', () => {
  const { normalizeCriteria, parseTimeLimit, CRITERIA_VERSION } = require(path.join(__dirname, '..', 'js', 'script.js'));
  assert.strictEqual(parseTimeLimit(''), null);
  assert.strictEqual(parseTimeLimit(undefined), null);
  assert.strictEqual(parseTimeLimit('0'), null);
  assert.strictEqual(parseTimeLimit('-5'), null);
  assert.strictEqual(parseTimeLimit('abc'), null);
  assert.strictEqual(parseTimeLimit('45'), 45);
  assert.strictEqual(normalizeCriteria({ advanced: [] }).timeLimit, null, 'missing = none');
  assert.strictEqual(normalizeCriteria({ advanced: [], timeLimit: null, version: CRITERIA_VERSION }).timeLimit, null);
  assert.strictEqual(normalizeCriteria({ advanced: [], timeLimit: 0 }).timeLimit, null, 'old "0 = none"');
  assert.strictEqual(normalizeCriteria({ advanced: [], timeLimit: 60 }).timeLimit, null, 'the old default, saved before blank existed');
  assert.strictEqual(normalizeCriteria({ advanced: [], timeLimit: 60, version: CRITERIA_VERSION }).timeLimit, 60, 'a 60 chosen now is kept');
  assert.strictEqual(normalizeCriteria({ advanced: [], timeLimit: 30 }).timeLimit, 30);
  const saved = normalizeCriteria({ advanced: [], timeLimit: 60, version: CRITERIA_VERSION });
  assert.deepStrictEqual(normalizeCriteria(saved), saved, 'idempotent');
});

test('algSpeedPrefix/algSpeedResume equal algSpeed of the whole sequence', () => {
  const { algSpeed, algSpeedPrefix, algSpeedResume } = require(path.join(__dirname, '..', 'js', 'script.js'));
  const toks = ["R", "R'", "R2", "U", "U'", "U2", "L", "L'", "L2", "D", "D'", "D2", "F", "F'", "F2", "B", "B'", "B2",
    "r", "r'", "r2", "l", "l'", "y", "y'", "x", "x'", "y2", "z", "u", "d", "M", "M'", "E", "S"];
  let seed = 11;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const alg = n => Array.from({ length: n }, () => toks[Math.floor(rnd() * toks.length)]).join(' ');
  for (let i = 0; i < 4000; i++) {
    const pre = alg(Math.floor(rnd() * 35));
    const cp = algSpeedPrefix(pre);
    for (let k = 0; k < 3; k++) {
      const suf = alg(1 + Math.floor(rnd() * 12));
      assert.strictEqual(algSpeedResume(cp, suf), algSpeed(pre ? `${pre} ${suf}` : suf, false, false), `${pre} | ${suf}`);
    }
  }
  assert.strictEqual(algSpeedResume(algSpeedPrefix(''), "R U R'"), algSpeed("R U R'", false, false));
});

// ---------------------------------------------------------------------

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll script.js tests passed.');
process.exit(0);
