/**
 * skill-levels.js — onboarding data (README "Onboarding"): the speed
 * brackets, the learning goals each bracket should be offered, and how the
 * answers set the solver's existing settings.
 *
 * DRAFT VALUES: the thresholds and which goals belong to which bracket are
 * placeholders for the developer to adjust; everything reads them from here.
 * The wording shown to users lives in captions.js (keys below).
 */
'use strict';

// Brackets by average solve time in seconds, slowest first: a time t falls in
// the first bracket with t >= minSeconds.
const SKILL_LEVELS = [
  { id: 'learning', minSeconds: 30, caption: 'level.learning' },
  { id: 'improving', minSeconds: 20, caption: 'level.improving' },
  { id: 'intermediate', minSeconds: 15, caption: 'level.intermediate' },
  { id: 'advanced', minSeconds: 12, caption: 'level.advanced' },
  { id: 'expert', minSeconds: 0, caption: 'level.expert' },
];

// What a solver might learn next. A goal is recommended for brackets
// [from, to] (indices into SKILL_LEVELS); faster brackets see it under
// "show all" as a basic, slower ones as "later". `settings` are what picking
// it switches on: first-step types (advanced) and results settings (view).
const LEARNING_GOALS = [
  { id: 'cross_planning', from: 0, to: 1, caption: 'goal.cross_planning', settings: {} },
  { id: 'fewer_rotations', from: 1, to: 2, caption: 'goal.fewer_rotations', settings: { view: { planning: true } } },
  { id: 'xcross', from: 2, to: 4, caption: 'goal.xcross', settings: { advanced: ['xcross'] } },
  { id: 'wide_cross', from: 2, to: 4, caption: 'goal.wide_cross', settings: { view: { wideMoves: true } } },
  { id: 'pair_influencing', from: 2, to: 4, caption: 'goal.pair_influencing', settings: { view: { planning: true } } },
  { id: 'multislot', from: 3, to: 4, caption: 'goal.multislot', settings: { view: { multislot: true } } },
  { id: 'xxcross', from: 4, to: 4, caption: 'goal.xxcross', settings: { advanced: ['xcross', 'xxcross'] } },
];

// How far a solver plans in inspection -> the first-step types searched.
const INSPECTION_OPTIONS = [
  { id: 'cross', caption: 'inspection.cross', advanced: [] },
  { id: 'cross_pair', caption: 'inspection.cross_pair', advanced: [] },
  { id: 'xcross', caption: 'inspection.xcross', advanced: ['xcross'] },
  { id: 'xxcross', caption: 'inspection.xxcross', advanced: ['xcross', 'xxcross'] },
];

const STYLE_OPTIONS = [
  { id: 'efficiency', caption: 'style.efficiency' },
  { id: 'tps', caption: 'style.tps' },
];

const CROSS_COLOURS = ['white', 'yellow', 'green', 'blue', 'red', 'orange'];

/** Index into SKILL_LEVELS for an average time (seconds); unknown -> the middle bracket. */
function levelFor(seconds) {
  const t = Number(seconds);
  if (!Number.isFinite(t) || t <= 0) return 2;
  const i = SKILL_LEVELS.findIndex(l => t >= l.minSeconds);
  return i < 0 ? SKILL_LEVELS.length - 1 : i;
}

/** The goals split for a bracket: recommended now, basics (already behind), later (ahead). */
function goalsFor(level) {
  const out = { recommended: [], basics: [], later: [] };
  for (const g of LEARNING_GOALS) {
    if (level >= g.from && level <= g.to) out.recommended.push(g);
    else if (level > g.to) out.basics.push(g);
    else out.later.push(g);
  }
  return out;
}

/** Is goal `id` one the avatar may bring up for this profile (recommended, or chosen)? */
function goalAllowed(id, answers) {
  const a = answers || {};
  if ((a.goals || []).includes(id)) return true;
  const g = LEARNING_GOALS.find(x => x.id === id);
  if (!g) return true;
  return levelFor(a.speed) >= g.from;
}

/**
 * Onboarding answers -> the existing settings: { colors, advanced, view }.
 * advanced: the first-step types (inspection planning plus chosen goals);
 * view: results settings the goals switch on (never off: defaults stay).
 */
function settingsFromAnswers(answers) {
  const a = answers || {};
  const advanced = new Set((INSPECTION_OPTIONS.find(o => o.id === a.inspection) || INSPECTION_OPTIONS[0]).advanced);
  const view = {};
  for (const id of a.goals || []) {
    const g = LEARNING_GOALS.find(x => x.id === id);
    if (!g) continue;
    for (const x of g.settings.advanced || []) advanced.add(x);
    Object.assign(view, g.settings.view || {});
  }
  const colors = (a.colours || []).filter(c => CROSS_COLOURS.includes(c));
  const order = ['xcross', 'xxcross', 'xxxcross'];
  return {
    colors: colors.length ? colors : ['white'],
    advanced: order.filter(x => advanced.has(x)),
    view,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SKILL_LEVELS, LEARNING_GOALS, INSPECTION_OPTIONS, STYLE_OPTIONS, CROSS_COLOURS,
    levelFor, goalsFor, goalAllowed, settingsFromAnswers,
  };
}
