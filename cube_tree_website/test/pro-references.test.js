#!/usr/bin/env node
/**
 * Fast checks on pro_references.txt and pro-references.js (no solver):
 * every reference solve parses, physically completes Cross+F2L under
 * facelet-cube.js (wide/slice/rotations included), and segments into DAG
 * transitions. The slow "is it in the search tree" check is
 * test/pro-references-e2e.js. See PROJECT_STATUS.md §4.20.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const P = require(path.join(__dirname, '..', 'tools', 'pro-references.js'));

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`PASS: ${name}`); } catch (e) { failures++; console.log(`FAIL: ${name}\n  ${e.message}`); }
}

const solves = P.loadProReferences();

test('pro_references.txt parses into 19 solves of 2-5 steps (inspection optional)', () => {
  assert.strictEqual(solves.length, 19);
  for (const s of solves) assert.ok(s.steps.length >= 2 && s.steps.length <= 5, s.scramble);
  assert.strictEqual(solves[9].inspection, '', '#10 has no inspection rotation');
  assert.strictEqual(solves[8].steps.length, 2, '#9 does 3rd/4th pairs as one step');
});

test("normalizeAlg turns R2' into R2", () => {
  assert.strictEqual(P.normalizeAlg("R2'  U  L2'"), 'R2 U L2');
});

test('every reference solve ends with a white/yellow cross and all four pairs physically solved', () => {
  const colors = solves.map((s, i) => {
    const steps = P.replayProSolve(s);
    const last = steps[steps.length - 1].after;
    assert.ok(last.cross && last.pairs.length === 4, `solve #${i + 1}`);
    return last.crossColor;
  });
  assert.deepStrictEqual(colors.map((c, i) => c === 'yellow' ? i + 1 : 0).filter(Boolean), [9, 10, 14]);
});

test("a mid-step rotation does not look like a lost pair (#11's 2nd pair contains y')", () => {
  const segs = P.segmentProSolve(solves[10]);
  assert.deepStrictEqual(segs.map(g => g.labels.join('+')), ['xcross', '2nd pair', '3rd pair', '4th pair']);
  // Start-frame names keep BR (solved by the xcross); end-frame names are relabelled by the y'.
  assert.deepStrictEqual(segs[1].afterStart.pairs, ['BL', 'BR']);
  assert.deepStrictEqual(segs[1].newPairs, ['BL']);
  assert.notDeepStrictEqual(segs[1].after.pairs, segs[1].afterStart.pairs);
  assert.strictEqual(P.invertRotation("x y'"), "y x'");
});

test('segments are DAG transitions: cross solved at each end, pairs only ever added', () => {
  solves.forEach((s, i) => {
    const segs = P.segmentProSolve(s);
    assert.ok(segs[0].isRoot && segs.slice(1).every(g => !g.isRoot), `solve #${i + 1}: one root segment`);
    let pairs = [];
    for (const g of segs) {
      assert.ok(g.after.cross, `solve #${i + 1} ${g.labels}: cross solved`);
      // Previous segment's end frame == this segment's start frame.
      assert.ok(pairs.every(p => g.afterStart.pairs.includes(p)), `solve #${i + 1} ${g.labels}: no pair lost`);
      // A root segment may be a plain cross (#13); every later one adds a pair.
      assert.ok(g.isRoot || g.newPairs.length >= 1, `solve #${i + 1} ${g.labels}: progress`);
      pairs = g.after.pairs;
    }
    assert.strictEqual(pairs.length, 4);
  });
});

test('steps that leave the cross broken are merged (#3, #4, #7)', () => {
  const labels = i => P.segmentProSolve(solves[i]).map(g => g.labels.join('+'));
  assert.deepStrictEqual(labels(2), ['xcross', '2nd pair', '3rd pair+4th pair']);
  assert.deepStrictEqual(labels(3), ['xcross', '2nd pair', '3rd pair+4th pair']);
  assert.deepStrictEqual(labels(6), ['xcross+2nd pair', '3rd pair+4th pair']);
});

test('goal-no-op moves (pruned by the engine) are detected exactly where expected', () => {
  const found = [];
  solves.forEach((s, i) => P.segmentProSolve(s).forEach((g, j) => {
    if (P.goalNoopMoves(s, j).noops.length) found.push(`#${i + 1} ${g.labels.join('+')}`);
  }));
  assert.deepStrictEqual(found, ['#3 xcross', '#3 2nd pair', '#6 xcross', '#9 xxcross', '#11 xcross', '#14 xxcross', '#15 xcross', '#17 xcross']);
});

if (failures) { console.log(`\n${failures} test(s) failed.`); process.exit(1); }
console.log('\nAll pro-references tests passed.');
