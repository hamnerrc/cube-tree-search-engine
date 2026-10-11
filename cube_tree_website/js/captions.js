/**
 * captions.js — every sentence the interface shows a user, by key
 * (README "Captions"). TODO(copy): all of these are placeholders; the
 * developer rewrites them by hand. Code never writes user-facing prose
 * itself: it asks caption(key, vars), so a rewrite here changes the site
 * everywhere. Short control labels (button names, setting names) stay in
 * the HTML.
 *
 * {name} in a caption is filled from vars; an unknown key shows the key
 * itself, so a missing caption is easy to spot.
 */
'use strict';

const CAPTIONS = {
  // --- onboarding (index.html) ---
  'onboard.welcome.title': 'hi! who is solving?',
  'onboard.welcome.text': 'pick a name and a buddy. everything stays on this device.',
  'onboard.speed.title': 'how fast are you?',
  'onboard.speed.text': 'your usual average, in seconds.',
  'onboard.inspection.title': 'how far do you plan in inspection?',
  'onboard.inspection.text': '',
  'onboard.style.title': 'what kind of solver are you?',
  'onboard.style.text': '',
  'onboard.goals.title': 'what do you want to learn next?',
  'onboard.goals.text': 'these fit your speed. pick any.',
  'onboard.goals.showAll': 'show all',
  'onboard.goals.later': 'later',
  'onboard.goals.basics': 'basics',
  'onboard.colours.title': 'which cross colours?',
  'onboard.colours.text': 'the solver searches these.',
  'onboard.done': 'let’s solve',
  'profiles.title': 'who is solving?',
  'profiles.new': 'new profile',
  'profiles.import': 'import a code',
  'profiles.importFailed': 'that code did not work.',
  'profiles.exported': 'copy this code to use your profile on another device.',
  'profiles.deleteConfirm': 'delete {name} and its settings?',

  'level.learning': 'learning (30 s +)',
  'level.improving': 'improving (20–30 s)',
  'level.intermediate': 'intermediate (15–20 s)',
  'level.advanced': 'advanced (12–15 s)',
  'level.expert': 'expert (under 12 s)',

  'goal.cross_planning': 'plan the whole cross in inspection',
  'goal.fewer_rotations': 'f2l with fewer rotations',
  'goal.xcross': 'xcrosses',
  'goal.wide_cross': 'optimal crosses with wide moves',
  'goal.pair_influencing': 'pair influencing / edge orientation',
  'goal.multislot': 'multislotting',
  'goal.xxcross': 'xxcrosses',

  'inspection.cross': 'the cross',
  'inspection.cross_pair': 'the cross, and I spot the first pair',
  'inspection.xcross': 'an xcross',
  'inspection.xxcross': 'an xxcross',

  'style.efficiency': 'efficient: fewer moves, even if a bit awkward',
  'style.tps': 'speedy: fast turning, even if a few more moves',

  // --- main screen ---
  'solve.placeholder': 'type moves, or press tab for the top suggestion',
  'solve.offNode': 'these moves don’t finish a step yet; suggestions come back once they do.',
  'solve.searching': 'thinking…',
  'solve.solved': 'cross + f2l solved!',
  'solve.noMatch': 'no listed step starts like that. keep going, it will still count.',
  'solve.noResults': 'nothing with these settings here. try multislot, wide moves, or undo.',
  'solve.loadFailed': 'the solver could not be loaded. reload to try again.',
  'solve.searchFailed': 'this search failed. undo, change a setting or reload.',

  // --- avatar: the three picks and their reasons ---
  'avatar.greeting': 'here are my picks.',
  'avatar.thinking': 'let me think…',
  'avatar.solved': 'all done! want a critique?',
  'avatar.offNode': 'finish the step and I’ll suggest the next one.',
  'avatar.pick.best': 'my favourite',
  'avatar.pick.style.efficiency': 'shortest',
  'avatar.pick.style.tps': 'smoothest',
  'avatar.pick.setup': 'sets you up',
  'reason.fastest': 'fastest to execute here.',
  'reason.free_pair': 'leaves a free pair for next time.',
  'reason.edges_good': 'leaves the edges oriented: fewer rotations later.',
  'reason.no_rotation': 'no rotation needed.',
  'reason.wide_ergonomic': 'the wide move is very ergonomic here.',
  'reason.shorter': '{n} moves shorter: pick it if you prefer efficiency.',
  'reason.smoother': 'more moves, but they flow: pick it if you like turning fast.',
  'reason.multislot': 'solves {n} pairs at once.',
  'reason.cancels': 'cancels into your last move.',
  'reason.back_slots': 'solves a back slot while it’s easy to see.',
  'reason.lookahead_best': 'best with what comes next: {next}',

  // --- critique ---
  'critique.button': 'critique',
  'critique.title': 'how did it go?',
  'critique.step.top': '{label}: the best pick!',
  'critique.step.rank': '{label}: #{rank} of {total}, +{gap} tpp.',
  'critique.step.outside': '{label}: not in my search ({why}). tpp {tpp}.',
  'critique.step.unsolved': 'this part doesn’t finish a step.',
  'critique.alt': 'try {alg}: {reason}',
  'critique.total': 'overall {stm} / tpp {tpp}.',
  'critique.needSolve': 'type a solution (or finish this one) and I’ll go through it.',
  'critique.working': 'going through it…',

  // --- info dialog sections (title, text) ---
  'info.how.title': 'how it works',
  'info.how.text': 'type your solution or press tab: the top suggestions are the fastest next steps, ranked by tpp (time per piece of the whole path so far; lower is faster). your buddy explains its three picks.',
  'info.profile.title': 'profiles',
  'info.profile.text': 'your answers and settings are saved in this browser only, one profile per person. export a code to move a profile to another device.',
  'info.cube.title': 'cube',
  'info.cube.text': 'drag to turn the cube, double-click to reset the view. the bar below plays the scramble and solution back.',
  'info.ranking.title': 'ranking',
  'info.ranking.text': 'every step type, colour and rotation in one list, by tpp. pair planning (on by default) prefers steps that leave the remaining edges oriented and the back slots solved first; off, each step is ranked by itself alone.',
  'info.filters.title': 'filters',
  'info.filters.text': 'they only hide results: multislot, wide moves, hide awkward f2l solutions, simple pseudo only.',
  'info.lookahead.title': 'look-ahead',
  'info.lookahead.text': 're-rank the top results (breadth) by the best combined tpp of the next n steps. 3 is slow.',
  'info.critique.title': 'critique',
  'info.critique.text': 'type a whole solution and ask for a critique: each step is compared with the solver’s list for the same step.',
  'info.background.title': 'background',
  'info.background.text': 'every scramble keeps searching while you look at another one; background tabs get less cpu.',
};

const INFO_SECTION_KEYS = ['how', 'profile', 'cube', 'ranking', 'filters', 'lookahead', 'critique', 'background'];

function caption(key, vars) {
  const text = Object.prototype.hasOwnProperty.call(CAPTIONS, key) ? CAPTIONS[key] : key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CAPTIONS, INFO_SECTION_KEYS, caption };
}
