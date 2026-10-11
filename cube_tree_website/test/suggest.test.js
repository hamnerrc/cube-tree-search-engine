#!/usr/bin/env node
/**
 * suggest.js: the avatar's picks (README "Avatar"). Pick 1 is the best TPP;
 * pick 2 the shortest (efficiency) or the best-flowing (TPS) within the
 * margin; pick 3 the best pair-choice view or the look-ahead's best; picks
 * differ in family; nothing above the solver's level unless chosen; reasons
 * are facts led by each pick's role; a reason an earlier pick leads with goes
 * to the back.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const js = f => path.join(__dirname, '..', 'js', f);
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'skill-levels.js']) Object.assign(global, require(js(f)));
Object.assign(global, require(js('solver-bridge.js')));
const { avatarPicks, pickFamily, stmOf } = require(js('suggest.js'));

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`PASS: ${name}`); } catch (e) { failures++; console.log(`FAIL: ${name}\n  ${e.stack}`); }
};

const row = (coreAlg, tpp, extra = {}) => ({ coreAlg, tpp, targetNodeId: 'N5', rotation: '', corners: ['FR'], ...extra });
const neutral = { trappedCorners: 0, trappedEdges: 0, piecesHome: 0, bothInU: 0, connected: 0, badEdgesU: 2, goodEdgesU: 1, badEdgesMiddle: 0, openBackSlots: 1 };

test('pick 1 is the best; pick 2 by style; families differ', () => {
  const list = [
    row("R U R' U' R U R'", 1.00),
    row("U R U R' U' R U R'", 1.01),            // same family as #1 (leading AUF)
    row("F R' F' R", 1.04),                     // shorter
    row("R U2 R' U R U' R' U R U R'", 1.05),    // longer, R/U only
    row("L' U L", 1.30),                        // outside the margin
  ];
  const eff = avatarPicks(list, { style: 'efficiency', answers: { speed: 12 } });
  assert.strictEqual(eff[0].r, list[0]);
  assert.strictEqual(eff[1].r.coreAlg, "F R' F' R");
  assert.strictEqual(eff[1].role, 'style.efficiency');
  const tps = avatarPicks(list, { style: 'tps', answers: { speed: 12 } });
  assert.notStrictEqual(pickFamily(tps[1].r), pickFamily(list[0]));
  assert.notStrictEqual(tps[1].r.coreAlg, "L' U L", 'within the margin');
  const fams = tps.map(p => pickFamily(p.r));
  assert.strictEqual(new Set(fams).size, fams.length, 'families differ');
});

test('pick 3: the best pair-choice view within its margin, or the look-ahead best', () => {
  const list = [row("R U R'", 1.0), row("R' F R F'", 1.02), row("U' L' U L", 1.05), row("y R U' R'", 1.06)];
  const views = new Map(list.map(r => [r, { ...neutral }]));
  views.get(list[3]).connected = 1; // leaves a free pair
  const p = avatarPicks(list, { style: 'efficiency', answers: { speed: 12 }, viewOf: r => views.get(r), before: { ...neutral } });
  assert.strictEqual(p[2].r, list[3]);
  assert.strictEqual(p[2].role, 'setup');
  assert.strictEqual(p[2].reasons[0].key, 'free_pair');
  const la = list.map((r, i) => ({ ...r, lookaheadTpp: [3, 2.9, 2.5, 2.8][i], lookaheadAlgs: ["R U R'"] }));
  const q = avatarPicks(la, { style: 'efficiency', answers: { speed: 12 }, lookahead: true });
  assert.strictEqual(q[2].r, la[2]);
  assert.strictEqual(q[2].reasons[0].key, 'lookahead_best');
});

test('no multislot pick above the level unless chosen', () => {
  const list = [row("R U R'", 1.0), row("R U2 R' U' R U R'", 1.01, { multislot: true, corners: ['FR', 'BR'] }), row("L' U' L", 1.02)];
  const slow = avatarPicks(list, { style: 'tps', answers: { speed: 35 } });
  assert.ok(!slow.some(p => p.r.multislot), 'not for a 35 s solver');
  const chose = avatarPicks(list, { style: 'tps', answers: { speed: 35, goals: ['multislot'] } });
  assert.ok(chose.some(p => p.r.multislot), 'unless they chose it');
});

test('reasons: shorter by STM; an earlier lead reason goes to the back', () => {
  const list = [row("R U R' U' R U R'", 1.0), row("F R' F' R", 1.03), row("R' F R F' U", 1.04)];
  const p = avatarPicks(list, { style: 'efficiency', answers: { speed: 12 } });
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
  assert.deepStrictEqual(avatarPicks([], {}), []);
  assert.deepStrictEqual(avatarPicks([row('R', Infinity)], {}), []);
});

if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
console.log('All suggest tests passed.');
