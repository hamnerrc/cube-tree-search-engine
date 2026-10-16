/**
 * Onboarding data: the speed brackets, the learning goals
 * each bracket should be offered, and how the answers set the solver's existing
 * settings.
 */
'use strict';

// Brackets by average solve time in seconds, slowest first: a time t falls in
// the first bracket with t >= minSeconds. Each has a note (captions.js
// `<caption>.note`) the onboarding shows with it.
const SKILL_LEVELS = [
  { id: 'building', minSeconds: 10, caption: 'level.building' },
  { id: 'intermediate', minSeconds: 8, caption: 'level.intermediate' },
  { id: 'advanced', minSeconds: 6, caption: 'level.advanced' },
  { id: 'professional', minSeconds: 0, caption: 'level.professional' },
];

const LEARNING_GOALS = [
  { id: 'xcross', from: 0, to: 3, caption: 'goal.xcross', settings: { advanced: ['xcross'] } },
  { id: 'wide_cross', from: 0, to: 3, caption: 'goal.wide_cross', settings: { view: { wideMoves: true } } },
  { id: 'pair_influencing', from: 1, to: 3, caption: 'goal.pair_influencing', settings: { view: { planning: true } } },
  { id: 'multislot', from: 2, to: 3, caption: 'goal.multislot', settings: { view: { multislot: true } } },
  { id: 'xxcross', from: 3, to: 3, caption: 'goal.xxcross', settings: { advanced: ['xcross', 'xxcross'] } },
  { id: 'pseudo_f2l', from: 3, to: 3, caption: 'goal.pseudo_f2l', settings: { advanced: ['full_pseudo'] } },
];

const INSPECTION_OPTIONS = [
  { id: 'cross', caption: 'inspection.cross', advanced: [] },
  { id: 'cross_pair', caption: 'inspection.cross_pair', advanced: [] },
  { id: 'pair_some_xcross', caption: 'inspection.pair_some_xcross', advanced: ['xcross'], aliases: ['xcross'] },
  { id: 'multi_pairs', caption: 'inspection.multi_pairs', advanced: ['xcross', 'xxcross'], aliases: ['xxcross'] },
];
const inspectionOption = id => INSPECTION_OPTIONS.find(o => o.id === id || (o.aliases || []).includes(id)) || INSPECTION_OPTIONS[0];
const ADVANCED_GOAL = { xcross: 'xcross', xxcross: 'xxcross', full_pseudo: 'pseudo_f2l' };

const STYLE_OPTIONS = [
  { id: 'efficiency', caption: 'style.efficiency' },
  { id: 'tps', caption: 'style.tps' },
];

const CROSS_COLOURS = ['white', 'yellow', 'green', 'blue', 'red', 'orange'];

const LAST_LAYER_OPTIONS = [
  { id: 'twolook', caption: 'lastlayer.twolook', method: 'oll', knownSets: [] },
  { id: 'full', caption: 'lastlayer.full', method: 'oll', knownSets: ['oll', 'pll'] },
  { id: 'coll', caption: 'lastlayer.coll', method: 'coll', knownSets: ['oll', 'pll'] },
  { id: 'zbll', caption: 'lastlayer.zbll', method: 'zbll', knownSets: ['oll', 'pll'] },
  { id: '1lll', caption: 'lastlayer.1lll', method: '1lll', knownSets: ['oll', 'pll'] },
];
const LAST_SLOT_OPTIONS = [
  { id: 'wv', caption: 'lastslot.wv' },
  { id: 'sv', caption: 'lastslot.sv' },
  { id: 'vls', caption: 'lastslot.vls' },
  { id: 'hls', caption: 'lastslot.hls' },
  { id: 'ols', caption: 'lastslot.ols' },
  { id: 'zbls', caption: 'lastslot.zbls' },
];
const lastLayerOption = id => LAST_LAYER_OPTIONS.find(o => o.id === id) || null;

function levelFor(seconds) {
  const t = Number(seconds);
  if (!Number.isFinite(t) || t <= 0) return 1;
  const i = SKILL_LEVELS.findIndex(l => t >= l.minSeconds);
  return i < 0 ? SKILL_LEVELS.length - 1 : i;
}

function goalsFor(level) {
  const out = { recommended: [], basics: [], later: [] };
  for (const g of LEARNING_GOALS) {
    if (level >= g.from && level <= g.to) out.recommended.push(g);
    else if (level > g.to) out.basics.push(g);
    else out.later.push(g);
  }
  return out;
}

function goalAllowed(id, answers) {
  const a = answers || {};
  if ((a.goals || []).includes(id)) return true;
  const g = LEARNING_GOALS.find(x => x.id === id);
  if (!g) return true;
  return levelFor(a.speed) >= g.from;
}

function settingsFromAnswers(answers) {
  const a = answers || {};
  const advanced = new Set(inspectionOption(a.inspection).advanced.filter(x => goalAllowed(ADVANCED_GOAL[x], a)));
  const view = {};
  for (const id of a.goals || []) {
    const g = LEARNING_GOALS.find(x => x.id === id);
    if (!g) continue;
    for (const x of g.settings.advanced || []) advanced.add(x);
    Object.assign(view, g.settings.view || {});
  }
  const ll = lastLayerOption(a.lastLayer);
  if (ll) view.llMethod = ll.method;
  if (Array.isArray(a.lastSlot)) view.lsSets = Object.fromEntries(LAST_SLOT_OPTIONS.map(o => [o.id, a.lastSlot.includes(o.id)]));
  const colors = (a.colours || []).filter(c => CROSS_COLOURS.includes(c));
  const order = ['xcross', 'xxcross', 'xxxcross', 'full_pseudo'];
  return {
    colors: colors.length ? colors : ['white'],
    advanced: order.filter(x => advanced.has(x)),
    view,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SKILL_LEVELS, LEARNING_GOALS, INSPECTION_OPTIONS, STYLE_OPTIONS, CROSS_COLOURS, LAST_LAYER_OPTIONS, LAST_SLOT_OPTIONS, lastLayerOption,
    inspectionOption, levelFor, goalsFor, goalAllowed, settingsFromAnswers,
  };
}
