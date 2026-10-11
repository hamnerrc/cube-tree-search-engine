#!/usr/bin/env node
/**
 * critique.js with a fake search (no engine): each committed step of a typed
 * solution is ranked among the same-goal results of its node; the best pick
 * is said so; a step the search cannot contain (over the move limit, slices,
 * a wide b) is "not in my search"; one it can contain but that ranks below
 * the kept results is "below my top N"; the first step's inspection compares
 * physically (z2 y = x2 y'); multislot searches only for multislot steps.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const js = f => path.join(__dirname, '..', 'js', f);
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js', 'captions.js']) Object.assign(global, require(js(f)));
Object.assign(global, require(js('solver-bridge.js')));
Object.assign(global, require(js('solve-editor.js')));
Object.assign(global, require(js('suggest.js')));
const { critiqueSolve, outsideReason } = require(js('critique.js'));
const { parseProReferences } = require(path.join(__dirname, '..', 'tools', 'pro-references.js'));

let failures = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`PASS: ${name}`); } catch (e) { failures++; console.log(`FAIL: ${name}\n  ${e.stack}`); }
};

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
const ADV = ['xcross', 'cross_opt', 'pro_moves'];
const tree = pruneGraph(raw, { advanced: [...ADV, 'multislotting'] });
const ref = parseProReferences(fs.readFileSync(path.join(__dirname, '..', 'data', 'pro_references.txt'), 'utf8'))[0];
const text = [`${ref.inspection} // inspection`, ...ref.steps.map(s => `${s.alg} // ${s.label}`)].join('\n') + '\n';

function solvedSession() {
  const s = new SolveSession(ref.scramble, tree, ['white', 'yellow'], ADV);
  for (const st of readSolution(s, text).steps) s.commit(st.row);
  return s;
}

(async () => {
  const s = solvedSession();
  assert.ok(s.isComplete);
  const rows = s.committedRows;

  await test('ranks each step among the same goal; the best is said so; inspection compared physically', async () => {
    const calls = [];
    const report = await critiqueSolve(s, {
      answers: { style: 'tps' },
      search: async (fork, { multislot }) => {
        const k = fork.committedRows.length;
        calls.push({ k, multislot });
        const mine = rows[k];
        const other = { ...mine, coreAlg: "R U R'", tpp: mine.tpp - 0.5, targetNodeId: mine.targetNodeId };
        const elsewhere = { ...mine, coreAlg: "L' U' L", tpp: mine.tpp - 1, targetNodeId: 'elsewhere' };
        if (k === 0) return [{ ...mine, rotation: "x2 y'" }, elsewhere]; // the same inspection, written otherwise
        if (k === 1) return [elsewhere, other, { ...mine }];
        if (k === 3) return [other]; // the pro's 12-turn last pair is not in the list
        return [{ ...mine }];
      },
    });
    assert.deepStrictEqual(calls.map(c => c.k), [0, 1, 2, 3]);
    assert.ok(calls.every(c => c.multislot === false), 'no multislot step, no multislot search');
    const [a, b, c] = report.items;
    assert.strictEqual(a.rank, 1, 'z2 y and x2 y\' are the same inspection');
    assert.strictEqual(b.rank, 2);
    assert.strictEqual(b.total, 2, 'same goal only');
    assert.ok(Math.abs(b.gap - 1) < 1e-9, 'gap to the best result overall');
    assert.ok(b.alt.includes("L' U' L"));
    assert.strictEqual(c.text, caption('critique.step.top', { label: '3rd pair' }));
    assert.strictEqual(report.items[3].outside, '12 turns > limit 10');
    assert.ok(report.total.includes(moveCounts(s).text));
  });

  await test('a step the search could hold but did not keep is below the top N', async () => {
    const report = await critiqueSolve(s, {
      search: async (fork) => [{ ...rows[fork.committedRows.length], coreAlg: 'U' }],
    });
    assert.strictEqual(report.items[1].rank, null);
    assert.strictEqual(report.items[1].outside, null);
    assert.ok(report.items[1].text.startsWith('2nd pair: below my top 1'));
  });

  await test('outsideReason: limit, slices, wide b, a first-step rotation', () => {
    const fork = s.fork();
    while (fork.committedRows.length > 1) fork.undo();
    const pair = rows[1];
    assert.strictEqual(outsideReason(pair, false, s), null);
    assert.strictEqual(outsideReason({ ...pair, coreAlg: "M' U M" }, false, s), 'slice moves');
    assert.strictEqual(outsideReason({ ...pair, coreAlg: "b U b'" }, false, s), 'a wide b');
    assert.strictEqual(outsideReason({ ...pair, coreAlg: "R U y R' y' U'" }, false, s), 'two rotations');
    assert.strictEqual(outsideReason({ ...rows[0], coreAlg: "D R y U" }, true, s), 'a rotation inside the first step');
    assert.strictEqual(outsideReason({ ...pair, coreAlg: 'R U R U R U R U R U R' }, false, s), '11 turns > limit 10');
  });

  if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
  console.log('All critique tests passed.');
})();
