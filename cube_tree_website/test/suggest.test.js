#!/usr/bin/env node
/**
 * suggest.js: the tree-searcher's picks (README "Tree-searcher"). Pick 1 is the best TPP;
 * pick 2 only when quantified: the smoother step (TPS: top three, more than
 * two moves above the move-optimal step for the goal) or a step two or more
 * moves shorter (efficiency); pick 3 the fastest step that leaves a free pair
 * (none when the fastest does), or the look-ahead's best; picks differ in
 * family; nothing above the solver's level unless chosen; reasons are facts
 * led by each pick's role; a reason an earlier pick leads with goes to the
 * back.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const js = f => path.join(__dirname, '..', 'js', f);
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'skill-levels.js']) Object.assign(global, require(js(f)));
Object.assign(global, require(js('solver-bridge.js')));
const { searcherPicks, pickFamily, stmOf, movesSaved, reasonsFor } = require(js('suggest.js'));

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`PASS: ${name}`); } catch (e) { failures++; console.log(`FAIL: ${name}\n  ${e.stack}`); }
};

const row = (coreAlg, tpp, extra = {}) => ({ coreAlg, tpp, targetNodeId: 'N5', rotation: '', corners: ['FR'], ...extra });
const neutral = { trappedCorners: 0, trappedEdges: 0, piecesHome: 0, bothInU: 0, connected: 0, badEdgesU: 2, goodEdgesU: 1, badEdgesMiddle: 0, openBackSlots: 1 };

test('pick 1 is the best; pick 2 only when quantified; families differ', () => {
  const list = [
    row("R U R' U' R U R'", 1.00),              // 7 moves
    row("U R U R' U' R U R'", 1.01),            // same family as #1 (leading AUF)
    row("F R' F' R", 1.04),                     // shorter (the move-optimal: 4)
    row("R U2 R' U R U' R' U R U R'", 1.05),    // longer, but 4th
    row("L' U L", 1.30),                        // outside the margin
  ];
  const eff = searcherPicks(list, { style: 'efficiency', answers: { speed: 7 } });
  assert.strictEqual(eff[0].r, list[0]);
  assert.strictEqual(eff[1].r.coreAlg, "F R' F' R");
  assert.strictEqual(eff[1].role, 'style.efficiency');
  // TPS: nothing in the top three is more than two moves above optimal and longer than the fastest
  const tps = searcherPicks(list, { style: 'tps', answers: { speed: 7 } });
  assert.ok(!tps.some(p => p.role === 'style.tps'), 'no smoother step to claim');
  assert.strictEqual(tps.length, 2, 'never fewer than two: the next fastest of another family');
  assert.strictEqual(tps[1].role, 'next');
  assert.strictEqual(tps[1].reasons[0].key, 'nearly');
  const smooth = [row("R U R' U'", 1.0), row("R U R' U' R U R'", 1.02), row("F R' F' R", 1.05), row("y R U R'", 1.06)];
  const t2 = searcherPicks(smooth, { style: 'tps', answers: { speed: 7 } });
  assert.strictEqual(t2[1].r, smooth[1], '7 moves > 4 + 2 and longer than the fastest, in the top three');
  assert.strictEqual(t2[1].reasons[0].key, 'smoother');
  const far = [row("R U R' U'", 1.0), row("F R' F' R", 1.01), row("y R U R'", 1.02), row("R U R' U' R U R'", 1.03)];
  assert.ok(!searcherPicks(far, { style: 'tps', answers: { speed: 7 } }).some(p => p.role === 'style.tps'), 'the long one is 4th: not in the top three');
  const fams = eff.map(p => pickFamily(p.r));
  assert.strictEqual(new Set(fams).size, fams.length, 'families differ');
});

test('white collar: more efficient means fewer moves per piece, not a shorter step that solves less', () => {
  // the first step: an xcross (6 pieces, 9 moves) and a plain cross (4 pieces, 6 moves): 1.5 a piece both
  const xc = row("R U R' D R' F D' L2 F", 1.0, { corners: ['FR'] });
  const cross = row("D R' F D' L2 F", 1.05, { corners: [] });
  const root = searcherPicks([xc, cross], { style: 'efficiency', answers: { speed: 7 }, isRoot: true });
  assert.ok(!root.some(p => p.role === 'style.efficiency'), 'three moves shorter, but only because it solves two pieces fewer');
  assert.ok(!reasonsFor(cross, { best: xc, rank: 1, isRoot: true }).some(x => x.key === 'shorter' || x.key === 'efficient'));
  // a later step: one pair in 7, or two pairs in 10 (5 a pair): the multislot is the more efficient one
  const one = row("R U R' U' R U R'", 1.0, { corners: ['FR'] });
  const two = row("R U' R' U L' U L U' R U R'", 1.05, { corners: ['FR', 'FL'], multislot: true, targetNodeId: 'N9' });
  const later = searcherPicks([one, two], { style: 'efficiency', answers: { speed: 5 }, isRoot: false });
  assert.strictEqual(later[1].r, two);
  assert.strictEqual(later[1].role, 'style.efficiency');
  assert.ok(later[1].reasons.some(x => x.key === 'efficient'), 'fewer moves per piece (it is not shorter)');
  assert.ok(movesSaved(two, one, false) >= 2);
  assert.ok(movesSaved(one, two, false) < 0, 'the single pair is not the more efficient one');
});

test('pick 3: the fastest step leaving a free pair, none when the fastest does; or the look-ahead best', () => {
  const list = [row("R U R'", 1.0), row("R' F R F'", 1.02), row("U' L' U L", 1.05), row("y R U' R'", 1.06), row("y' R U R'", 1.07)];
  const views = new Map(list.map(r => [r, { ...neutral }]));
  views.get(list[3]).connected = 1; // leaves a free pair
  views.get(list[4]).connected = 1;
  const p = searcherPicks(list, { style: 'efficiency', answers: { speed: 7 }, viewOf: r => views.get(r), before: { ...neutral } });
  assert.strictEqual(p[p.length - 1].r, list[3]);
  assert.strictEqual(p[p.length - 1].role, 'setup');
  assert.strictEqual(p[p.length - 1].reasons[0].key, 'free_pair');
  views.get(list[0]).connected = 1;
  const q0 = searcherPicks(list, { style: 'tps', answers: { speed: 7 }, viewOf: r => views.get(r), before: { ...neutral } });
  assert.ok(!q0.some(x => x.role === 'setup'), 'the fastest already leaves one');
  views.get(list[0]).connected = 0;
  views.get(list[3]).connected = 0;
  views.get(list[4]).connected = 0;
  const none = searcherPicks(list, { style: 'tps', answers: { speed: 7 }, viewOf: r => views.get(r), before: { ...neutral } });
  assert.ok(!none.some(x => x.role === 'setup'), 'no free pair anywhere: no setup pick');
  assert.strictEqual(none.length, 2, 'but two picks: the next fastest');
  const la = list.map((r, i) => ({ ...r, lookaheadTpp: [3, 2.9, 2.5, 2.8, 3][i], lookaheadAlgs: ["R U R'"] }));
  const q = searcherPicks(la, { style: 'efficiency', answers: { speed: 7 }, lookahead: true });
  assert.strictEqual(q[q.length - 1].r, la[2]);
  assert.strictEqual(q[q.length - 1].reasons[0].key, 'lookahead_best');
});

test('no multislot pick above the level unless chosen', () => {
  const list = [row("R U R'", 1.0), row("R U2 R' U' R U R'", 1.01, { multislot: true, corners: ['FR', 'BR'] }), row("L' U' L", 1.02)];
  const slow = searcherPicks(list, { style: 'tps', answers: { speed: 9 } });
  assert.ok(!slow.some(p => p.r.multislot), 'not for a 9 s solver');
  const chose = searcherPicks(list, { style: 'tps', answers: { speed: 9, goals: ['multislot'] } });
  assert.ok(chose.some(p => p.r.multislot), 'unless they chose it');
});

test('reasons: shorter by STM; an earlier lead reason goes to the back', () => {
  const list = [row("R U R' U' R U R'", 1.0), row("F R' F' R", 1.03), row("R' F R F' U", 1.04)];
  const p = searcherPicks(list, { style: 'efficiency', answers: { speed: 7 } });
  assert.strictEqual(p[0].reasons[0].key, 'fastest');
  assert.deepStrictEqual(p[1].reasons[0], { key: 'shorter', vars: { n: stmOf(list[0].coreAlg) - stmOf(p[1].r.coreAlg) } });
  // a pick that has a reason no earlier pick leads with, leads with one of those
  const used = new Set();
  for (const x of p) {
    const fresh = x.reasons.filter(r => !used.has(r.key));
    if (fresh.length) assert.ok(!used.has(x.reasons[0].key), `${x.r.coreAlg} leads with a new reason`);
    if (x.reasons[0]) used.add(x.reasons[0].key);
  }
});

test('empty and non-finite lists give no picks', () => {
  assert.deepStrictEqual(searcherPicks([], {}), []);
  assert.deepStrictEqual(searcherPicks([row('R', Infinity)], {}), []);
});

if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
console.log('All suggest tests passed.');
