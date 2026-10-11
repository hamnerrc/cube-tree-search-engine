#!/usr/bin/env node
/**
 * skill-levels.js: speed brackets, which learning goals each bracket is
 * offered (README "Onboarding": only what fits the solver's level, the rest
 * behind "show all"), and how answers set the existing settings. Also: every
 * caption key the onboarding data names exists, and every avatar sprite is
 * 16x16.
 */
'use strict';
const assert = require('assert');
const path = require('path');
const js = f => require(path.join(__dirname, '..', 'js', f));
const { SKILL_LEVELS, LEARNING_GOALS, INSPECTION_OPTIONS, STYLE_OPTIONS, levelFor, goalsFor, goalAllowed, settingsFromAnswers } = js('skill-levels.js');
const { CAPTIONS, INFO_SECTION_KEYS, caption } = js('captions.js');
const { AVATAR_SPRITES } = js('avatars.js');

let failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`PASS: ${name}`); } catch (e) { failures++; console.log(`FAIL: ${name}\n  ${e.stack}`); }
};

test('levelFor: brackets by average, slowest first; unknown is the middle', () => {
  assert.strictEqual(levelFor(45), 0);
  assert.strictEqual(levelFor(30), 0);
  assert.strictEqual(levelFor(25), 1);
  assert.strictEqual(levelFor(17.5), 2);
  assert.strictEqual(levelFor(13), 3);
  assert.strictEqual(levelFor(9.8), 4);
  assert.strictEqual(levelFor(''), 2);
  assert.strictEqual(levelFor(null), 2);
  assert.strictEqual(levelFor(-3), 2);
});

test('goalsFor: every goal is in exactly one group; multislot is not recommended to slow solvers', () => {
  for (let lv = 0; lv < SKILL_LEVELS.length; lv++) {
    const g = goalsFor(lv);
    const ids = [...g.recommended, ...g.basics, ...g.later].map(x => x.id).sort();
    assert.deepStrictEqual(ids, LEARNING_GOALS.map(x => x.id).sort(), `level ${lv}`);
  }
  assert.ok(!goalsFor(levelFor(35)).recommended.some(g => g.id === 'multislot'));
  assert.ok(goalsFor(levelFor(35)).later.some(g => g.id === 'multislot'));
  assert.ok(goalsFor(levelFor(11)).recommended.some(g => g.id === 'multislot'));
  assert.ok(goalsFor(levelFor(11)).basics.some(g => g.id === 'cross_planning'));
  assert.ok(goalsFor(levelFor(35)).recommended.some(g => g.id === 'cross_planning'));
});

test('goalAllowed: above the level only when the solver chose it', () => {
  assert.strictEqual(goalAllowed('multislot', { speed: 30 }), false);
  assert.strictEqual(goalAllowed('multislot', { speed: 30, goals: ['multislot'] }), true);
  assert.strictEqual(goalAllowed('multislot', { speed: 13 }), true);
  assert.strictEqual(goalAllowed('cross_planning', { speed: 9 }), true);
  assert.strictEqual(goalAllowed('unknown-goal', {}), true);
});

test('settingsFromAnswers: inspection and goals pick first-step types and switch settings on', () => {
  assert.deepStrictEqual(settingsFromAnswers({}), { colors: ['white'], advanced: [], view: {} });
  assert.deepStrictEqual(settingsFromAnswers({ inspection: 'xxcross' }).advanced, ['xcross', 'xxcross']);
  const s = settingsFromAnswers({ inspection: 'cross', goals: ['xcross', 'multislot', 'pair_influencing', 'wide_cross'], colours: ['yellow', 'white', 'pink'] });
  assert.deepStrictEqual(s.advanced, ['xcross']);
  assert.deepStrictEqual(s.view, { multislot: true, planning: true, wideMoves: true });
  assert.deepStrictEqual(s.colors, ['yellow', 'white']);
});

test('every caption key named by the onboarding data and the info dialog exists', () => {
  const keys = [
    ...SKILL_LEVELS.map(x => x.caption), ...LEARNING_GOALS.map(x => x.caption),
    ...INSPECTION_OPTIONS.map(x => x.caption), ...STYLE_OPTIONS.map(x => x.caption),
    ...INFO_SECTION_KEYS.flatMap(k => [`info.${k}.title`, `info.${k}.text`]),
  ];
  for (const k of keys) assert.ok(Object.prototype.hasOwnProperty.call(CAPTIONS, k), k);
  assert.strictEqual(caption('reason.shorter', { n: 2 }), CAPTIONS['reason.shorter'].replace('{n}', '2'));
  assert.strictEqual(caption('no.such.key'), 'no.such.key');
});

test('avatar sprites are 16x16 of #, x and .', () => {
  assert.ok(AVATAR_SPRITES.length >= 6);
  for (const s of AVATAR_SPRITES) {
    assert.strictEqual(s.rows.length, 16, s.id);
    for (const r of s.rows) assert.ok(/^[#x.]{16}$/.test(r), `${s.id}: ${r}`);
  }
});

if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
console.log('All onboarding tests passed.');
