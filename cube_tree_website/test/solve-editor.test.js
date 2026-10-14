#!/usr/bin/env node
/**
 * solve-editor.js: the solution bar reads typed text into steps by replaying
 * it (README "Solution entry"). Checked against the pro-solve segmenter the
 * tuning tools use (tools/pro-references.js segmentProSolve) on every
 * reference solve and on reco.nz solves: typing a professional's
 * reconstruction gives exactly its DAG steps. Also: committed rows the text
 * still starts with are kept, a line that finishes nothing is merged into
 * the next, nothing typed is refused, the step being typed is the tail, the
 * strict prefix filter, and a user step's TPP equals the search's formula.
 * No engine.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const js = f => path.join(__dirname, '..', 'js', f);
Object.assign(global, require(js('script.js')));
Object.assign(global, require(js('facelet-cube.js')));
Object.assign(global, require(js('facelet-flags.js')));
Object.assign(global, require(js('cross-optimization.js')));
Object.assign(global, require(js('solver-bridge.js')));
Object.assign(global, require(js('captions.js')));
const { readSolution, userStepRow, prefixMatches, editorLines, stepLabel, rowTokens } = require(js('solve-editor.js'));
const { parseProReferences, segmentProSolve } = require(path.join(__dirname, '..', 'tools', 'pro-references.js'));

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`PASS: ${name}`); } catch (e) { failures++; console.log(`FAIL: ${name}\n  ${e.stack}`); }
};

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
const ADV = ['xcross', 'xxcross', 'xxxcross', 'cross_opt', 'pro_moves'];
const tree = pruneGraph(raw, { advanced: [...ADV, 'multislotting'] });
const sessionFor = scramble => new SolveSession(scramble, tree, ['white', 'yellow'], ADV);
const textOf = solve => [
  ...(solve.inspection ? [`${solve.inspection} // inspection`] : []),
  ...solve.steps.map(s => `${s.alg} // ${s.label}`),
].join('\n') + '\n';

function checkAgainstSegmenter(solve) {
  const segs = segmentProSolve(solve);
  const session = sessionFor(solve.scramble);
  const read = readSolution(session, textOf(solve));
  assert.strictEqual(read.keep, 0);
  assert.strictEqual(read.steps.length, segs.length, `${solve.scramble}: ${read.steps.length} steps vs ${segs.length} segments`);
  read.steps.forEach((st, i) => {
    assert.strictEqual(st.row.coreAlg, segs[i].alg.replace(/2'/g, '2'), `step ${i}`);
    if (i === 0) assert.strictEqual(st.row.rotation, solve.inspection);
    assert.deepStrictEqual(st.row.corners.slice().sort(), segs[i].isRoot ? segs[i].after.pairs.slice().sort() : segs[i].newPairs.slice().sort(), `pairs of step ${i}`);
    assert.ok(Number.isFinite(st.row.tpp), `tpp of step ${i}`);
  });
  for (const st of read.steps) session.commit(st.row);
  // (a few reco.nz solves end at three pairs: the last slot went with the last layer)
  if (segs[segs.length - 1].totalPairs === 4) assert.ok(session.isComplete, 'the solve ends with cross + f2l');
  assert.deepStrictEqual(read.tail.tokens, []);
  return { read, session };
}

test('every reference solve reads as the segmenter cuts it, and ends solved', () => {
  const solves = parseProReferences(fs.readFileSync(path.join(__dirname, '..', 'data', 'pro_references.txt'), 'utf8'));
  assert.ok(solves.length >= 19);
  for (const s of solves) checkAgainstSegmenter(s);
});

test('80 reco.nz solves read as the segmenter cuts them', () => {
  const solves = parseProReferences(fs.readFileSync(path.join(__dirname, '..', 'data', 'reco_solves.txt'), 'utf8'));
  let n = 0;
  for (let i = 0; i < solves.length && n < 80; i += 11) {
    let segs;
    try { segs = segmentProSolve(solves[i]); } catch (e) { continue; } // not a DAG solve
    if (!segs.length) continue;
    checkAgainstSegmenter(solves[i]);
    n++;
  }
  assert.ok(n >= 60, `checked ${n}`);
});

const ref = parseProReferences(fs.readFileSync(path.join(__dirname, '..', 'data', 'pro_references.txt'), 'utf8'))[0];

test('committed rows the text starts with are kept; an edited later line is re-read', () => {
  const { session } = checkAgainstSegmenter(ref);
  const text = textOf(ref);
  const again = readSolution(session, text);
  assert.strictEqual(again.keep, session.committedRows.length);
  assert.strictEqual(again.steps.length, 0);
  // change the last line: the last step is no longer kept, and the new text finishes nothing
  const lines = text.trimEnd().split('\n');
  lines[lines.length - 1] = "R U R'";
  const edited = readSolution(session, lines.join('\n') + '\n');
  assert.strictEqual(edited.keep, session.committedRows.length - 1);
  assert.strictEqual(edited.steps.length, 0);
  assert.deepStrictEqual(edited.tail.tokens, ['R', 'U', "R'"]);
});

test('a step whose line is still being typed is the tail; the newline commits it', () => {
  const session = sessionFor(ref.scramble);
  const first = `${ref.inspection} // inspection\n${ref.steps[0].alg}`;
  const open = readSolution(session, first);
  assert.strictEqual(open.steps.length, 0);
  assert.deepStrictEqual(open.tail.tokens, [...ref.inspection.split(' '), ...ref.steps[0].alg.split(' ')]);
  assert.strictEqual(open.tail.partial, ref.steps[0].alg.split(' ').pop());
  const closed = readSolution(session, first + '\n');
  assert.strictEqual(closed.steps.length, 1);
  assert.strictEqual(closed.lines[0].label, 'inspection');
  assert.strictEqual(closed.lines[1].label, 'xcross');
  assert.deepStrictEqual(closed.tail.tokens, []);
  assert.ok(closed.tail.onNewLine);
});

test('the step that finishes the F2L needs no newline after it; other steps do', () => {
  const session = sessionFor(ref.scramble);
  const all = textOf(ref).replace(/\n$/, '');
  const read = readSolution(session, all);
  assert.strictEqual(read.steps.length, ref.steps.length, 'every step, the last without a newline');
  assert.deepStrictEqual(read.tail.tokens, []);
  // only the first move of the last line: not a finished F2L, so a tail
  const cut = all.slice(0, all.lastIndexOf('\n') + 1) + ref.steps[ref.steps.length - 1].alg.split(' ')[0];
  const open = readSolution(session, cut);
  assert.strictEqual(open.steps.length, ref.steps.length - 1);
  assert.strictEqual(open.tail.tokens.length, 1);
  // a middle step without its newline stays the tail
  const two = textOf({ ...ref, steps: ref.steps.slice(0, 2) }).replace(/\n$/, '');
  assert.strictEqual(readSolution(session, two).steps.length, 1);
});

test('lines that finish nothing merge into the next step; junk is never refused', () => {
  const session = sessionFor(ref.scramble);
  const alg = ref.steps[0].alg.split(' ');
  const text = `${ref.inspection}\n${alg.slice(0, 3).join(' ')}\n${alg.slice(3).join(' ')}\n`;
  const read = readSolution(session, text);
  assert.strictEqual(read.steps.length, 1);
  assert.strictEqual(read.steps[0].row.coreAlg, ref.steps[0].alg);
  assert.deepStrictEqual(read.lines.map(l => l.kind), ['merged', 'merged', 'step', 'empty']);
  const junk = readSolution(session, 'hello R Q2 // what\n');
  assert.strictEqual(junk.steps.length, 0);
  assert.deepStrictEqual(junk.tail.tokens, ['hello', 'R', 'Q2']);
  assert.deepStrictEqual(editorLines('hello R Q2 // what')[0].tokens.map(t => t.valid), [false, true, false]);
});

test('userStepRow refuses a step that breaks the cross or a solved pair', () => {
  const { session } = checkAgainstSegmenter(ref);
  while (session.committedRows.length > 1) session.undo();
  assert.strictEqual(userStepRow(session, ['F']), null, 'breaks the cross');
  assert.strictEqual(userStepRow(session, ['U']), null, 'solves nothing');
  const row = userStepRow(session, ref.steps[1].alg.split(' '));
  assert.ok(row && row.user);
  assert.strictEqual(row.type, 'Single pair');
});

test("a user step's TPP is the search's formula: path cost + pair-choice term, per piece", () => {
  const { session, read } = checkAgainstSegmenter(ref);
  // the last step finishes F2L: no pair-choice term, so TPP = pathCost / 12 pieces
  const last = read.steps[read.steps.length - 1].row;
  session.undo();
  const expect = session.pathCost(last.coreAlg) / 12;
  assert.ok(Math.abs(last.tpp - expect) < 1e-9, `${last.tpp} vs ${expect}`);
});

test('prefixMatches: strict token prefix; the token being typed matches R, R\', R2', () => {
  const rows = [
    { rotation: '', coreAlg: "R U R'" }, { rotation: '', coreAlg: "R' U' R" }, { rotation: '', coreAlg: 'R2 U R2' },
    { rotation: '', coreAlg: "y R U R'" }, { rotation: '', coreAlg: "U R U' R'" },
  ];
  const algs = (typed, partial) => prefixMatches(rows, typed, partial, false).map(m => m.r.coreAlg);
  assert.deepStrictEqual(algs(['R'], 'R'), ["R U R'", "R' U' R", 'R2 U R2']);
  assert.deepStrictEqual(algs(['R'], ''), ["R U R'"]);
  assert.deepStrictEqual(algs(["R'"], "R'"), ["R' U' R"]);
  assert.deepStrictEqual(algs(['y'], ''), ["y R U R'"]);
  assert.deepStrictEqual(algs([], ''), rows.map(r => r.coreAlg));
  const root = [{ rotation: 'z2 y', coreAlg: "D R2 U' F" }];
  assert.strictEqual(prefixMatches(root, ['z2', 'y', 'D'], '', true).length, 1);
  assert.strictEqual(prefixMatches(root, ['D'], 'D', true).length, 0, 'the inspection is typed first');
  assert.deepStrictEqual(rowTokens(root[0], true), ['z2', 'y', 'D', 'R2', "U'", 'F']);
});

test('stepLabel matches the solution labels', () => {
  assert.strictEqual(stepLabel(true, 0, 0), 'cross');
  assert.strictEqual(stepLabel(true, 0, 2), 'xxcross');
  assert.strictEqual(stepLabel(false, 1, 2), '2nd pair');
  assert.strictEqual(stepLabel(false, 2, 4), '3rd/4th pairs');
  assert.strictEqual(stepLabel(false, 1, 2, true), '2nd pair (pseudo)');
});

if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
console.log('All solve-editor tests passed.');
