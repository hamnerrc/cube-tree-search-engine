#!/usr/bin/env node
/**
 * skill-levels.js: speed brackets, which learning goals each bracket is
 * offered (README "Onboarding": only what fits the solver's level, the rest
 * behind "show all"), and how answers set the existing settings. Also: every
 * caption key the onboarding data names exists, and every tree-searcher sprite is
 * 16x16.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const js = f => require(path.join(__dirname, '..', 'js', f));
const { SKILL_LEVELS, LEARNING_GOALS, INSPECTION_OPTIONS, STYLE_OPTIONS, levelFor, goalsFor, goalAllowed, settingsFromAnswers } = js('skill-levels.js');
const { CAPTIONS, INFO_SECTION_KEYS, caption } = js('captions.js');
const { SEARCHER_SPRITES } = js('searchers.js');

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`PASS: ${name}`); } catch (e) { failures++; console.log(`FAIL: ${name}\n  ${e.stack}`); }
};

test('levelFor: brackets by average, slowest first; unknown is intermediate', () => {
  assert.strictEqual(levelFor(45), 0);
  assert.strictEqual(levelFor(10), 0);
  assert.strictEqual(levelFor(9.5), 1);
  assert.strictEqual(levelFor(8), 1);
  assert.strictEqual(levelFor(7.2), 2);
  assert.strictEqual(levelFor(6), 2);
  assert.strictEqual(levelFor(5.4), 3);
  assert.strictEqual(levelFor(''), 1);
  assert.strictEqual(levelFor(null), 1);
  assert.strictEqual(levelFor(-3), 1);
});

test('goalsFor: every goal in one group; the developer\'s feature brackets', () => {
  for (let lv = 0; lv < SKILL_LEVELS.length; lv++) {
    const g = goalsFor(lv);
    const ids = [...g.recommended, ...g.basics, ...g.later].map(x => x.id).sort();
    assert.deepStrictEqual(ids, LEARNING_GOALS.map(x => x.id).sort(), `level ${lv}`);
  }
  const rec = t => goalsFor(levelFor(t)).recommended.map(g => g.id).sort();
  assert.deepStrictEqual(rec(14), ['wide_cross', 'xcross']); // 10+: xcrosses and wide crosses only
  assert.deepStrictEqual(rec(9), ['pair_influencing', 'wide_cross', 'xcross']); // 8-10: no multislotting
  assert.deepStrictEqual(rec(7), ['multislot', 'pair_influencing', 'wide_cross', 'xcross']); // 6-8: no xxcross
  assert.deepStrictEqual(rec(5), LEARNING_GOALS.map(g => g.id).sort()); // under 6: everything, pseudo f2l too
  assert.ok(goalsFor(levelFor(14)).later.some(g => g.id === 'multislot'));
});

test('goalAllowed: above the level only when the solver chose it', () => {
  assert.strictEqual(goalAllowed('multislot', { speed: 9 }), false);
  assert.strictEqual(goalAllowed('multislot', { speed: 9, goals: ['multislot'] }), true);
  assert.strictEqual(goalAllowed('multislot', { speed: 7 }), true);
  assert.strictEqual(goalAllowed('xxcross', { speed: 7 }), false);
  assert.strictEqual(goalAllowed('xxcross', { speed: 5.5 }), true);
  assert.strictEqual(goalAllowed('unknown-goal', {}), true);
});

test('settingsFromAnswers: inspection and goals pick first-step types (gated by level) and switch settings on', () => {
  assert.deepStrictEqual(settingsFromAnswers({}), { colors: ['white'], advanced: [], view: {} });
  assert.deepStrictEqual(settingsFromAnswers({ inspection: 'multi_pairs', speed: 5 }).advanced, ['xcross', 'xxcross']);
  assert.deepStrictEqual(settingsFromAnswers({ inspection: 'multi_pairs', speed: 7 }).advanced, ['xcross'], 'no xxcross at 6-8 s');
  assert.deepStrictEqual(settingsFromAnswers({ inspection: 'multi_pairs', speed: 7, goals: ['xxcross'] }).advanced, ['xcross', 'xxcross']);
  assert.deepStrictEqual(settingsFromAnswers({ inspection: 'xxcross', speed: 5 }).advanced, ['xcross', 'xxcross'], 'old saved id');
  assert.deepStrictEqual(settingsFromAnswers({ inspection: 'pair_some_xcross', speed: 12 }).advanced, ['xcross']);
  assert.deepStrictEqual(settingsFromAnswers({ goals: ['pseudo_f2l'], speed: 5 }).advanced, ['full_pseudo']);
  const s = settingsFromAnswers({ inspection: 'cross', goals: ['xcross', 'multislot', 'pair_influencing', 'wide_cross'], colours: ['yellow', 'white', 'pink'] });
  assert.deepStrictEqual(s.advanced, ['xcross']);
  assert.deepStrictEqual(s.view, { multislot: true, planning: true, wideMoves: true });
  assert.deepStrictEqual(s.colors, ['yellow', 'white']);
});

test('every caption key named by the onboarding data and the info dialog exists', () => {
  const keys = [
    ...SKILL_LEVELS.flatMap(x => [x.caption, `${x.caption}.note`]), ...LEARNING_GOALS.map(x => x.caption),
    ...INSPECTION_OPTIONS.map(x => x.caption), ...STYLE_OPTIONS.map(x => x.caption),
    'onboard.goals.settings',
    ...INFO_SECTION_KEYS.flatMap(k => [`info.${k}.title`, `info.${k}.text`]),
  ];
  for (const k of keys) assert.ok(Object.prototype.hasOwnProperty.call(CAPTIONS, k), k);
  assert.strictEqual(caption('reason.shorter', { n: 2 }), CAPTIONS['reason.shorter'].replace('{n}', '2'));
  assert.strictEqual(caption('no.such.key'), 'no.such.key');
});

test('tree-searcher sprites are 16x16 of #, x and .', () => {
  assert.ok(SEARCHER_SPRITES.length >= 6);
  for (const s of SEARCHER_SPRITES) {
    assert.strictEqual(s.rows.length, 16, s.id);
    for (const r of s.rows) assert.ok(/^[#x.]{16}$/.test(r), `${s.id}: ${r}`);
  }
});

if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
console.log('All onboarding tests passed.');
