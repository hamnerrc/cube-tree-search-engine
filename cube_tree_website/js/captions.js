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
  'onboard.welcome.text': 'pick a name and a tree-searcher. everything stays on this device.',
  'onboard.speed.title': 'how fast are you?',
  'onboard.speed.text': 'your usual average, in seconds.',
  'onboard.inspection.title': 'how far do you plan in inspection?',
  'onboard.inspection.text': '',
  'onboard.style.title': 'what kind of solver are you?',
  'onboard.style.text': '',
  'onboard.goals.title': 'what do you want to learn or explore next?',
  'onboard.goals.text': 'these fit your speed. pick any.',
  'onboard.goals.showAll': 'show all',
  'onboard.goals.later': 'later',
  'onboard.goals.basics': 'basics',
  'onboard.goals.settings': 'you can enable more advanced solutions in settings any time!',
  'onboard.colours.title': 'which cross colours?',
  'onboard.colours.text': 'the solver searches these.',
  'onboard.done': 'let’s solve',
  'profiles.title': 'who is solving?',
  'profiles.new': 'new profile',
  'profiles.import': 'import a code',
  'profiles.importFailed': 'that code did not work.',
  'profiles.exported': 'copy this code to use your profile on another device.',
  'profiles.deleteConfirm': 'delete {name} and its settings?',

  'level.building': 'building speed (10 s +)',
  'level.building.note': 'heads up: cube⑂tree is made for solvers pushing to get really fast. plain, simple cfop is enough for sub-10 (just ask max park!), so getting better at pure cfop pays off most right now. but play with it for fun, of course! I’ll stick to xcrosses and optimal crosses with wide moves.',
  'level.intermediate': 'intermediate (8–10 s)',
  'level.intermediate.note': 'nice and quick! I’ll show you xcrosses, wide-move crosses and pair influencing, and leave multislotting for later.',
  'level.advanced': 'advanced (6–8 s)',
  'level.advanced.note': 'seriously fast. everything is on the table except xxcrosses.',
  'level.professional': 'professional (under 6 s)',
  'level.professional.note': 'all of it: xxcrosses, multislotting, even pseudo f2l.',

  'goal.xcross': 'xcrosses',
  'goal.wide_cross': 'wide move crosses',
  'goal.pair_influencing': 'influence pairs and EO',
  'goal.multislot': 'multislotting',
  'goal.xxcross': 'xxcrosses',
  'goal.pseudo_f2l': 'pseudo-f2l',

  'inspection.cross': 'the cross, or less',
  'inspection.cross_pair': 'the cross, and I spot the first pair',
  'inspection.pair_some_xcross': 'I see the first pair, and sometimes an xcross',
  'inspection.multi_pairs': 'I see several pairs or an xcross often',

  'style.efficiency': '"White collar": fewer moves, even if a bit awkward',
  'style.tps': '"Blue collar": fast turning, even if a few more moves',

  // --- main screen ---
  'solve.placeholder': 'type moves, or press tab for the top suggestion',
  'solve.offNode': 'these moves don’t finish a step yet; suggestions come back once they do.',
  'solve.searching': 'crafting solutions…',
  'solve.solved': 'cross + f2l is solved...await last layer update',
  'solve.noMatch': 'no listed step starts like that, but you can keep writing your own solution',
  'solve.noResults': 'nothing with these settings here. try multislot, wide moves, or undo.',
  'solve.loadFailed': 'the solver could not be loaded. reload to try again. sorry!',
  'solve.searchFailed': 'this search failed. undo, change a setting or reload. sorry!',
  'solve.someFailed': 'part of this search failed: undo and redo to try again. sorry!',
  'solve.loadingSolver': 'warming up…',
  'solve.noSetup': 'nothing to solve yet: sign in (or answer the questions again) to set up your search.',

  // --- searcher: the three picks and their reasons ---
  'searcher.greeting': 'here are my picks.',
  'searcher.thinking': 'let me think…',
  'searcher.solved': 'all done! want a critique?',
  'searcher.offNode': 'I can’t see a step starting like that, but you can continue without me!',
  'searcher.following': 'ooh, let me see where that goes…',
  'searcher.stepDone': 'that finishes the {label}! press tab (or enter) and I’ll look at the next one.',
  'searcher.lastDone': 'that’s the last pair! press tab (or enter) to finish.',
  'searcher.greetingOne': 'this is the one.',
  'searcher.keepGoing': 'go on, I’m following.',
  'searcher.pick.best': 'my favourite',
  'searcher.pick.style.efficiency': 'shortest',
  'searcher.pick.style.tps': 'smoothest',
  'searcher.pick.setup': 'sets you up',
  // --- searcher: the last layer and the last slot (README "Algorithm sets") ---
  'searcher.ll.case': 'here is how I would solve this one.',
  'searcher.ll.stepDone': 'that finishes the {label}! press tab (or enter) to write it down.',
  'searcher.ll.unknown': 'I don’t know an alg for this one. finish it your way!',
  'searcher.ll.auf': 'one last turn of the top!',
  'searcher.ll.more': 'all algs for this case ›',
  'searcher.pick.ll.best': 'my favourite',
  'searcher.pick.ll.favourite': 'community favourite',
  'searcher.pick.ll.set.zbll': 'whole last layer',
  'searcher.pick.ll.set.oll': 'two-look',
  'searcher.pick.ll.set.coll': 'corners first',
  'searcher.pick.ll.set.pll': 'pll',
  'searcher.pick.lastslot.ols': 'skips the oll',
  'searcher.pick.lastslot.zbls': 'sets up zbll',
  'reason.ll.fastest': 'the fastest alg I know for {label}.',
  'reason.ll.new': 'a new find: faster than the community’s algs for {label}.',
  'reason.ll.favourite': 'the one most cubers use.',
  'reason.ll.whole': 'the edges are oriented: this solves the whole last layer ({label}).',
  'reason.ll.twoLook': 'or the two-look way: orient first ({label}), then pll.',
  'reason.ll.other': 'another way: {label}.',
  'reason.ls.skipsOll': 'inserts the pair and orients the whole last layer ({label}): no oll.',
  'reason.ls.edgesForZbll': 'inserts the pair and orients the edges ({label}): then zbll.',
  'reason.fastest': 'fastest to execute here.',
  'reason.free_pair': 'sets up a free pair. fancy!',
  'reason.edges_good': 'leaves the edges oriented: fewer rotations later.',
  'reason.no_rotation': 'no rotation needed.',
  'reason.wide_ergonomic': 'the wide move is quite ergonomic here.',
  'reason.shorter': '{n} moves shorter: pick it if you prefer efficiency.',
  'reason.smoother': 'more moves, but they flow: pick it if you like turning fast.',
  'reason.multislot': 'solves {n} pairs at once.',
  'reason.cancels': 'cancels into your last move.',
  'reason.back_slots': 'solves a back slot while it’s easy to see.',
  'reason.lookahead_best': 'best with what comes next: {next}',

  // --- critique (no numbers: why a step is slower, and a similar better one) ---
  'critique.button': 'critique',
  'critique.title': 'how did it go?',
  'critique.intro': 'here is what I noticed. tap a step to see it on the cube.',
  'critique.step.top': '{label}: nice, exactly what I would do!',
  'critique.step.goodOutside': '{label}: what!?! That is one I don’t even search for, and nothing I found beats it! Nice!',
  'critique.step.slower': '{label}: {why}',
  'critique.step.bestOfKind': '{label}: the best one of its kind.',
  'critique.why.rotation': 'the rotation costs you time.',
  'critique.why.longer': 'it takes the long way round.',
  'critique.why.awkward': 'the turns don’t flow well together.',
  'critique.why.no_free_pair': 'it leaves nothing set up for the next pair.',
  'critique.why.edges': 'it leaves a lot of bad edges.',
  'critique.why.slower': 'something a little quicker fits here.',
  'critique.outside.long': 'it is longer than I would ever look for here.',
  'critique.outside.slices': 'slice moves are slow to execute here.',
  'critique.outside.wide_b': 'a wide b is hard to turn quickly.',
  'critique.outside.rotations': 'two rotations in one step slow you down.',
  'critique.outside.root_rotation': 'a rotation in the middle of the cross costs time.',
  'critique.alt.similar': 'try {alg}: it starts the same way.',
  'critique.alt.samePieces': 'try {alg}: it solves the same pieces.',
  'critique.alt.otherGoal': 'but you could do even more here: {alg} ({other}).',
  'critique.step.unsolved': 'this part doesn’t finish a step.',
  'critique.total.great': 'a great solve. I would not change a thing!',
  'critique.total.good': 'a good solve, with a couple of spots to polish.',
  'critique.total.work': 'a few steps have quicker options. have a look at the ones above!',
  'critique.ls.edges': 'but yours orients the edges too, which the quicker one doesn’t.',
  'critique.ls.oriented': 'but yours orients the whole last layer too, which the quicker one doesn’t.',
  'critique.ll.best': '{label}: my favourite alg for it!',
  'critique.ll.good': '{label}: a great alg for it.',
  'critique.ll.slower': '{label}: there is a quicker alg for this case.',
  'critique.ll.alt': 'try {alg}',
  'critique.ll.unknown': '{label}: I don’t know this one well enough to say.',
  'critique.needSolve': 'type a solution (or finish this one) and I’ll go through it.',
  'critique.working': 'going through it…',

  // --- the alg sets page (algs.html) ---
  'algs.search.placeholder': 'search: oll 27, t perm, sune, zbll as 3, or type moves',
  'algs.legend': 'algs are ranked by how fast they are to turn, the way I rank f2l steps. "community" algs come from speedcubedb; the others I found myself.',
  'algs.group.all': 'all',
  'algs.loading': 'loading the algs…',
  'algs.loadFailed': 'the alg sets could not be loaded. reload to try again. sorry!',
  'algs.empty': 'no case by that name.',
  'algs.noMatch': 'no alg starts like that.',
  'algs.note.solves': 'this alg solves',
  'algs.note.none': 'this alg doesn’t solve a case of these sets.',
  'algs.src.db': 'community',
  'algs.src.dbTop': 'community favourite',
  'algs.src.gen': 'found by the tree-searcher',
  'algs.src.genNew': 'new find: faster than the community’s',

  // --- info dialog sections (title, text) ---
  'info.how.title': 'how it works',
  'info.how.text': 'type your solution, or press tab to take the fastest next step. type a few moves of your own and the ghost finishes the step you have in mind. your tree-searcher explains its picks.',
  'info.profile.title': 'profiles',
  'info.profile.text': 'your answers and settings are saved in this browser only, one profile per person. export a code to move a profile to another device.',
  'info.cube.title': 'cube',
  'info.cube.text': 'drag to turn the cube, pinch or scroll (or + and −) to zoom, double-click to reset the view. while you type, the cube follows your cursor; the bar below plays your solution back.',
  'info.ranking.title': 'ranking',
  'info.ranking.text': 'every step type, colour and rotation is weighed together by how fast it is to execute. pair planning (on by default) prefers steps that leave the remaining edges oriented and the back slots solved first; off, each step is ranked by itself alone.',
  'info.filters.title': 'filters',
  'info.filters.text': 'they only hide results: multislot, wide moves, hide awkward f2l solutions, simple pseudo only.',
  'info.lookahead.title': 'look-ahead',
  'info.lookahead.text': 're-rank the best few steps (breadth) by how fast they go together with the next steps. 3 is slow.',
  'info.critique.title': 'critique',
  'info.critique.text': 'type a whole solution and ask for a critique: each step is compared with the solver’s list for the same step.',
  'info.lastlayer.title': 'last layer',
  'info.lastlayer.text': 'once the f2l is solved, keep typing: each line that orients or solves the last layer is read as a step and named after its case. tab takes the fastest alg for the case on the cube, in your method (settings: oll + pll, coll or zbll). at the last pair, zbls and ols algs show up when they fit. every case and its algs are on the algs page.',
  'info.background.title': 'background',
  'info.background.text': 'every scramble keeps searching while you look at another one; background tabs get less cpu.',
};

const INFO_SECTION_KEYS = ['how', 'profile', 'cube', 'ranking', 'filters', 'lookahead', 'critique', 'lastlayer', 'background'];

function caption(key, vars) {
  const text = Object.prototype.hasOwnProperty.call(CAPTIONS, key) ? CAPTIONS[key] : key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CAPTIONS, INFO_SECTION_KEYS, caption };
}
