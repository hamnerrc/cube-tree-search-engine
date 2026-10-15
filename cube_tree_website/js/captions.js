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
  'onboard.welcome.title': 'Hi! Who is solving?',
  'onboard.welcome.text': 'Pick a name and a tree-searcher. Everything stays on this device.',
  'onboard.speed.title': 'How fast are you?',
  'onboard.speed.text': 'Your usual average, in seconds.',
  'onboard.inspection.title': 'How far do you plan in inspection?',
  'onboard.inspection.text': '',
  'onboard.style.title': 'What kind of solver are you?',
  'onboard.style.text': '',
  'onboard.goals.title': 'What do you want to learn or explore next?',
  'onboard.goals.text': 'These fit your speed. Pick any.',
  'onboard.goals.showAll': 'Show all',
  'onboard.goals.later': 'Later',
  'onboard.goals.basics': 'Basics',
  'onboard.goals.settings': 'You can enable more advanced solutions in settings any time!',
  'onboard.lastlayer.title': 'How do you solve the last layer?',
  'onboard.lastlayer.text': 'I’ll suggest algs from what you use.',
  'onboard.lastslot.title': 'Any last-slot tricks?',
  'onboard.lastslot.text': 'Algs that do more while the last pair goes in. Pick the ones you use.',
  'onboard.lastslot.none': 'None of these? That’s fine, skip it. They are all in settings.',
  'onboard.chat.title': 'How much should your tree-searcher talk?',
  'onboard.chat.text': '',
  'lastlayer.twolook': '2-look: OLL in two steps, then PLL in two',
  'lastlayer.full': 'Full OLL, then full PLL',
  'lastlayer.coll': 'COLL: the OLL and the corners in one alg, then the edges',
  'lastlayer.1lll': '1LLL: the whole last layer in one alg (some or all of it)',
  'lastlayer.zbll': 'ZBLL when the edges are oriented (some or all of it)',
  'lastslot.wv': 'Winter variation (WV): connected pair, orient the corners',
  'lastslot.sv': 'Summer variation (SV): split pair, orient the corners',
  'lastslot.vls': 'VLS: connected pair, orient everything',
  'lastslot.hls': 'HLS: split pair, orient everything',
  'lastslot.ols': 'Full OLS: any pair, orient everything (8,000+ algs!)',
  'lastslot.zbls': 'ZBLS: any pair, orient the edges',
  'chat.chatty': 'Chatty: tell me all the reasons',
  'chat.normal': 'Normal',
  'chat.brief': 'Brief: just the moves, mostly',
  'onboard.colours.title': 'Which cross colours?',
  'onboard.colours.text': 'The solver searches these.',
  'onboard.done': 'Let’s solve',
  'profiles.title': 'Who is solving?',
  'profiles.new': 'New profile',
  'profiles.import': 'Import a code',
  'profiles.importFailed': 'That code did not work.',
  'profiles.exported': 'Copy this code to use your profile on another device.',
  'profiles.deleteConfirm': 'Delete {name} and its settings?',

  'level.building': 'Building speed (10 s +)',
  'level.building.note': 'Heads up: cube⑂tree is made for solvers pushing to get really fast. Plain, simple CFOP is enough for sub-10 (just ask Max Park!), so getting better at pure CFOP pays off most right now. But play with it for fun, of course! I’ll stick to xcrosses and optimal crosses with wide moves.',
  'level.intermediate': 'Intermediate (8–10 s)',
  'level.intermediate.note': 'Nice and quick! I’ll show you xcrosses, wide-move crosses and pair influencing, and leave multislotting for later.',
  'level.advanced': 'Advanced (6–8 s)',
  'level.advanced.note': 'Seriously fast. Everything is on the table except xxcrosses.',
  'level.professional': 'Professional (under 6 s)',
  'level.professional.note': 'All of it: xxcrosses, multislotting, even pseudo F2L.',

  'goal.xcross': 'Xcrosses',
  'goal.wide_cross': 'Wide move crosses',
  'goal.pair_influencing': 'Influence pairs and EO',
  'goal.multislot': 'Multislotting',
  'goal.xxcross': 'Xxcrosses',
  'goal.pseudo_f2l': 'Pseudo-F2L',

  'inspection.cross': 'The cross, or less',
  'inspection.cross_pair': 'The cross, and I spot the first pair',
  'inspection.pair_some_xcross': 'I see the first pair, and sometimes an XCross',
  'inspection.multi_pairs': 'I see several pairs or an XCross often',

  'style.efficiency': '"White collar": fewer moves, even if a bit awkward',
  'style.tps': '"Blue collar": fast turning, even if a few more moves',

  // --- main screen ---
  'solve.placeholder': 'Type moves, or press tab for the top suggestion',
  'solve.offNode': 'These moves don’t finish a step yet; suggestions come back once they do.',
  'solve.searching': 'Crafting solutions…',
  'solve.solved': 'Cross + F2L is solved...await last layer update',
  'solve.noMatch': 'No listed step starts like that, but you can keep writing your own solution',
  'solve.noResults': 'Nothing with these settings here. Try multislot, wide moves, or undo.',
  'solve.loadFailed': 'The solver could not be loaded. Reload to try again. Sorry!',
  'solve.searchFailed': 'This search failed. Undo, change a setting or reload. Sorry!',
  'solve.someFailed': 'Part of this search failed: undo and redo to try again. Sorry!',
  'solve.loadingSolver': 'Warming up…',
  'solve.noSetup': 'Nothing to solve yet: sign in (or answer the questions again) to set up your search.',

  // --- searcher: the three picks and their reasons ---
  'searcher.greeting': [
    'Here are my picks.',
    'A few ways to go:',
    'Take your pick!',
    'These look good to me.',
    'Here’s what I found.',
  ],
  'searcher.thinking': [
    'Let me think…',
    'Hmm, let me look…',
    'Searching the branches…',
    'One sec, climbing the tree…',
  ],
  'searcher.solved': [
    'All done! Want a critique?',
    'Solved! Shall I go through it?',
    'Nice, that’s it! Want my thoughts?',
  ],
  'searcher.offNode': 'I can’t see a step starting like that, but you can continue without me!',
  'searcher.following': 'Ooh, let me see where that goes…',
  'searcher.stepDone': 'That finishes the {label}! Press tab (or enter) and I’ll look at the next one.',
  'searcher.lastDone': 'That’s the last pair! Press tab (or enter) to finish.',
  'searcher.greetingOne': [
    'This is the one.',
    'Only one stands out here.',
  ],
  'searcher.keepGoing': [
    'Go on, I’m following.',
    'Keep going, I’m watching.',
    'Carry on!',
  ],
  'searcher.title': 'Tree-searcher',
  // the key legend under the solution bar
  'keys.tab': 'write the suggestion',
  'keys.arrows': 'other suggestions',
  'keys.esc': 'back to the first',
  // the box on the cube: the step it is in
  'stage.preview': 'Preview',
  'stage.typing': 'Typing',
  'stage.scrambled': 'Scrambled',
  'searcher.pick.best': 'My favourite',
  'searcher.pick.style.efficiency': 'Most efficient',
  'searcher.pick.style.tps': 'Smoothest',
  'searcher.pick.setup': 'Sets you up',
  'searcher.pick.next': 'Also quick',
  // --- searcher: the last layer and the last slot (README "Algorithm sets") ---
  'searcher.ll.case': [
    'Here is how I would solve this one.',
    'I know this one: {label}.',
    '{label}! Here are some ways.',
  ],
  'searcher.ll.stepDone': 'That finishes the {label}! Press tab (or enter) to write it down.',
  'searcher.ll.unknown': 'I don’t know an alg for this one. Finish it your way!',
  'searcher.ll.auf': 'One last turn of the top!',
  'searcher.ll.more': 'All algs for this case >',
  'searcher.ll.yours': 'Your alg for this case.',
  'searcher.ll.others': 'Some other ways to do {label}.',
  'searcher.ll.makeMain': 'Use it, and make it my main alg for this case',
  'searcher.ll.neither': 'Neither of these >',
  'searcher.ll.change': 'Other algs >',
  'searcher.pick.ll.best': 'My favourite',
  'searcher.pick.ll.main': 'Yours',
  'searcher.pick.ll.more': 'Another',
  'searcher.pick.ll.next': 'Also quick',
  'searcher.pick.ll.favourite': 'Community favourite',
  'searcher.pick.ll.set.zbll': 'Whole last layer',
  'searcher.pick.ll.set.oll': 'Two-look',
  'searcher.pick.ll.set.coll': 'Corners first',
  'searcher.pick.ll.set.pll': 'PLL',
  'searcher.pick.ll.set.1lll': 'Whole last layer',
  'searcher.pick.lastslot.ols': 'Skips the OLL',
  'searcher.pick.lastslot.zbls': 'Sets up ZBLL',
  'reason.ll.fastest': 'The fastest alg I know for {label}.',
  'reason.ll.main': 'The alg you picked for {label}.',
  'reason.ll.next': 'Nearly as quick, a different way.',
  'reason.ll.shorter': 'Fewer moves than my favourite.',
  'reason.ll.community': 'One the community uses.',
  'reason.ll.favourite': 'The one most cubers use.',
  'reason.ll.whole': 'The edges are oriented: this solves the whole last layer ({label}).',
  'reason.ll.twoLook': 'Or the two-look way: orient first ({label}), then PLL.',
  'reason.ll.other': 'Another way: {label}.',
  'reason.ls.skipsOll': 'Inserts the pair and orients the whole last layer ({label}): no OLL.',
  'reason.ls.edgesForZbll': 'Inserts the pair and orients the edges ({label}): then ZBLL.',
  'reason.fastest': 'Fastest to execute here.',
  'reason.nearly': 'Nearly as quick, a different way to go.',
  'reason.free_pair': 'Sets up a free pair. Fancy!',
  'reason.edges_good': 'Leaves the edges oriented: fewer rotations later.',
  'reason.no_rotation': 'No rotation needed.',
  'reason.wide_ergonomic': 'The wide move is quite ergonomic here.',
  'reason.shorter': '{n} moves shorter: pick it if you prefer efficiency.',
  'reason.efficient': 'Fewer moves for each piece it solves: pick it if you prefer efficiency.',
  'reason.smoother': 'More moves, but they flow: pick it if you like turning fast.',
  'reason.multislot': 'Solves {n} pairs at once.',
  'reason.cancels': 'Cancels into your last move.',
  'reason.back_slots': 'Solves a back slot while it’s easy to see.',
  'reason.lookahead_best': 'Best with what comes next: {next}',

  // --- critique (no numbers: why a step is slower, and a similar better one) ---
  'critique.button': 'Critique',
  'critique.title': 'How did it go?',
  'critique.intro': 'Here is what I noticed. Tap a step to see it on the cube.',
  'critique.step.top': [
    '{label}: nice, exactly what I would do!',
    '{label}: spot on.',
    '{label}: that’s my pick too.',
    '{label}: couldn’t do better myself.',
  ],
  'critique.step.goodOutside': '{label}: what!?! That is one I don’t even search for, and nothing I found beats it! Nice!',
  'critique.step.slower': '{label}: {why}',
  'critique.step.bestOfKind': [
    '{label}: the best one of its kind.',
    '{label}: a fine choice.',
  ],
  'critique.why.rotation': 'The rotation costs you time.',
  'critique.why.longer': 'It takes the long way round.',
  'critique.why.awkward': 'The turns don’t flow well together.',
  'critique.why.no_free_pair': [
    'The next pair is a bit harder to find after it.',
    'It leaves less set up for the next pair.',
  ],
  'critique.why.edges': 'It leaves a lot of bad edges.',
  'critique.why.slower': 'Something a little quicker fits here.',
  'critique.outside.long': 'It is longer than I would ever look for here.',
  'critique.outside.slices': 'Slice moves are slow to execute here.',
  'critique.outside.wide_b': 'A wide b is hard to turn quickly.',
  'critique.outside.rotations': 'Two rotations in one step slow you down.',
  'critique.outside.root_rotation': 'A rotation in the middle of the cross costs time.',
  'critique.alt.similar': 'Try {alg}: it starts the same way.',
  'critique.alt.samePieces': 'Try {alg}: it solves the same pieces.',
  'critique.alt.otherGoal': [
    'If you like, {alg} ({other}) is another way to go here.',
    '{alg} ({other}) is also worth a look here, if it suits you.',
  ],
  'critique.step.unsolved': 'This part doesn’t finish a step.',
  'critique.total.great': [
    'A great solve. I would not change a thing!',
    'Clean all the way through. Nice!',
    'That’s a solve I’d be proud of.',
  ],
  'critique.total.good': [
    'A good solve, with a couple of spots to polish.',
    'Solid! Just a couple of places to look at.',
    'Nicely done. A few small things above.',
  ],
  'critique.total.work': [
    'A few steps have quicker options. Have a look at the ones above!',
    'Some room to grow here: the steps above have quicker options.',
    'There’s speed to find in a few steps. No rush, one at a time!',
  ],
  'critique.ls.edges': 'But yours orients the edges too, which the quicker one doesn’t.',
  'critique.ls.oriented': 'But yours orients the whole last layer too, which the quicker one doesn’t.',
  'critique.ll.best': '{label}: my favourite alg for it!',
  'critique.ll.good': '{label}: a great alg for it.',
  'critique.ll.slower': '{label}: there is a quicker alg for this case.',
  'critique.ll.alt': 'Try {alg}',
  'critique.ll.unknown': '{label}: I don’t know this one well enough to say.',
  'critique.ll.main': '{label}: your alg, done right.',
  'critique.ll.notMain': '{label}: not the alg you picked for it.',
  'critique.ll.yourAlt': 'Yours is {alg}',
  'critique.step.fine': [
    '{label}: a solid choice.',
    '{label}: works well.',
    '{label}: good, that’s a perfectly fine way.',
  ],
  'critique.alt.optional': [
    'Another option: {alg}.',
    'There’s also {alg}, if you like it.',
  ],
  'critique.egg': [
    'Wait… You did every single thing I said. I can’t critique my own homework!',
    'Every step was one of my picks. This is just me grading myself, and I give me an A+.',
    'You followed me all the way. Critiquing that would be awkward for both of us!',
  ],
  'critique.ls.best': '{label}: your {set} alg is the fastest one I know.',
  'critique.ls.good': '{label}: a great {set} alg for this case.',
  'critique.ls.slower': '{label}: a quicker {set} alg fits here.',
  'critique.ls.alt': 'Try {alg}',
  'critique.ls.yours': '{label}: your {set} alg, done right.',
  'critique.intro#building': 'Here is what I noticed. Tap a step to see it on the cube. No stress: one thing at a time!',
  'critique.intro#professional': 'Here’s the breakdown. Tap a step to see it.',
  'critique.total.work#building': [
    'Some quicker options above. Pick one and practise it, that’s how it grows!',
    'A few places to look at. One step at a time!',
  ],
  'critique.total.great#professional': [
    'Clean. Nothing to add.',
    'Textbook.',
  ],
  'critique.why.longer#brief': 'Longer than needed.',
  'critique.why.rotation#brief': 'The rotation costs time.',
  'critique.why.awkward#brief': 'The turns don’t flow.',
  'critique.why.slower#brief': 'A quicker one fits.',
  'searcher.greeting#brief': 'Picks:',
  'searcher.thinking#brief': '…',
  'critique.needSolve': 'Type a solution (or finish this one) and I’ll go through it.',
  'critique.working': 'Going through it…',

  // --- the alg sets page (algs.html) ---
  'algs.search.placeholder': 'Search: OLL 27, t perm, sune, ZBLL as 3, or type moves',
  'algs.group.all': 'All',
  // what a set, or OLS's chosen subset, is: one line under the subsets
  'algs.subset.oll': 'Orients the last layer: 57 cases, grouped by shape.',
  'algs.subset.pll': 'Permutes the oriented last layer: 21 cases.',
  'algs.subset.coll': 'Orients the last layer and solves its corners in one alg, from any of the 57 OLLs (also called OLLCP); the edges are left for EPLL. One subset per OLL; a case is one corner permutation.',
  'algs.subset.zbll': 'The whole last layer when its edges are oriented. Subsets by corner orientation (T, U, L, H, Pi, S, AS), then by corner permutation (the COLL case).',
  'algs.subset.1lll': 'The whole last layer in one alg, from any state. One subset per OLL (PLL for an oriented layer), then one per corner permutation, as in COLL.',
  'algs.subset.zbls': 'Inserts the last pair and orients the edges, ready for ZBLL.',
  'algs.subset.ols.wv': 'WV (winter variation): the pair is connected and goes in with R U\' R\'; the edges are already oriented. The alg orients the corners as it inserts the pair.',
  'algs.subset.ols.sv': 'SV (summer variation): the pair is split and goes in with R U R\'; the edges are already oriented. The alg orients the corners as it inserts the pair.',
  'algs.subset.ols.vls': 'VLS: WV with any edges. Connected pair (R U\' R\'); the alg orients edges and corners.',
  'algs.subset.ols.hls': 'HLS: SV with any edges. Split pair (R U R\'); the alg orients edges and corners.',
  'algs.subset.ols.all': 'Every other pair placement (full OLS): the alg inserts the pair and orients the whole last layer. Pick a placement.',
  'algs.searchTab': 'Search',
  'algs.progress': '{known} of {total} known',
  'algs.allKnown': 'You know every case here. Nice!',
  'algs.noneKnown': 'None marked yet: press “mark what I know”, then sweep over the cases you know.',
  'algs.learn.button': 'Mark what I know',
  'algs.learn.hint': 'Tap a case to mark it known, or drag across many. Tap the button again when done.',
  'algs.known.yes': 'I know this case',
  'algs.known.no': 'Mark this case as known',
  'algs.main': 'Yours',
  'algs.main.set': 'Make this my alg for the case',
  'algs.main.clear': 'Not my alg any more',
  'algs.card.more': '+{n} more algs',
  'algs.loading': 'Loading the algs…',
  'algs.loadFailed': 'The alg sets could not be loaded. Reload to try again. Sorry!',
  'algs.empty': 'No case by that name.',
  'algs.noMatch': 'No alg starts like that.',
  'algs.note.solves': 'This alg solves',
  'algs.note.none': 'This alg doesn’t solve a case of these sets.',

  // --- settings hints ---
  'settings.ls.intro': 'Algs that do more while the last pair goes in. Turn on the ones you use.',
  'settings.ls.rule': 'While any of these is on, the last two pairs are never solved at once.',

  // --- info dialog sections (title, text) ---
  'info.how.title': 'How it works',
  'info.how.text': 'Type your solution, or press tab to take the fastest next step. Type a few moves of your own and the ghost finishes the step you have in mind. Your tree-searcher explains its picks.',
  'info.profile.title': 'Profiles',
  'info.profile.text': 'Your answers and settings are saved in this browser only, one profile per person. Export a code to move a profile to another device.',
  'info.cube.title': 'Cube',
  'info.cube.text': 'Drag to turn the cube, pinch or scroll (or + and −) to zoom, double-click to reset the view. While you type, the cube follows your cursor; the bar below plays your solution back.',
  'info.ranking.title': 'Ranking',
  'info.ranking.text': 'Every step type, colour and rotation is weighed together by how fast it is to execute. Pair planning (on by default) prefers steps that leave the remaining edges oriented and the back slots solved first; off, each step is ranked by itself alone.',
  'info.filters.title': 'Filters',
  'info.filters.text': 'Which steps to suggest only hides results: multislot, wide moves, R2 and L2 detours, simple pseudo only.',
  'info.lookahead.title': 'Look-ahead',
  'info.lookahead.text': 'Re-rank the steps by how fast they go together with the next one or two steps: the best few first, then more and more while nothing else needs the solver. Two steps ahead is slow.',
  'info.critique.title': 'Critique',
  'info.critique.text': 'Type a whole solution and ask for a critique: each step is compared with the solver’s list for the same step.',
  'info.lastlayer.title': 'Last layer',
  'info.lastlayer.text': 'Once the F2L is solved, keep typing: each line that orients or solves the last layer is read as a step and named after its case. Tab takes the fastest alg for the case on the cube, in your method (settings: OLL + PLL, COLL, ZBLL or 1LLL). At the last pair, ZBLS and OLS algs show up when they fit. Every case and its algs are on the algs page.',
  'info.background.title': 'Background',
  'info.background.text': 'Every scramble keeps searching while you look at another one; background tabs get less cpu.',
};

const INFO_SECTION_KEYS = ['how', 'profile', 'cube', 'ranking', 'filters', 'lookahead', 'critique', 'lastlayer', 'background'];

// Who is reading (solver-ui.js sets it from the profile): a caption can
// have a version per speed bracket ("key#professional") or per how much the
// solver wants the tree-searcher to talk ("key#brief", "key#chatty"); the
// plain key is the fallback. `seed` changes which variant of a list is said
// (a new step, a new critique) while the same screen keeps saying the same.
const CAPTION_CONTEXT = { level: '', chat: '', seed: 0 };

function captionHash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function caption(key, vars) {
  const has = k => Object.prototype.hasOwnProperty.call(CAPTIONS, k);
  const c = CAPTION_CONTEXT;
  const found = [c.level && `${key}#${c.level}`, c.chat && `${key}#${c.chat}`, key].find(k => k && has(k));
  let text = found ? CAPTIONS[found] : key;
  // a list: one of its variants, the same for the same context
  if (Array.isArray(text)) text = text[captionHash(`${key}|${c.seed}|${vars ? JSON.stringify(vars) : ''}`) % text.length];
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? String(vars[k]) : m));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CAPTIONS, INFO_SECTION_KEYS, caption, CAPTION_CONTEXT };
}
