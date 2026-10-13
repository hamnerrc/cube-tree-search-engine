# cube⑂tree — Project Status

*Last updated 2026-10-12 (thirty-seventh pass).*

The working record: what exists, what is verified, what is open. The
product specification is [cube_tree_website/README.md](cube_tree_website/README.md);
where the two disagree about intended behaviour, the README wins. Older
pass-by-pass writeups (§4.1–§4.47 of earlier versions, 4,300 lines) were
removed in the twenty-sixth pass; the "§4.x" references in code comments
point to them: `git show a89ec3d:PROJECT_STATUS.md`.

## Where we left off

**Thirty-seventh pass (2026-10-12): the last slot and the last layer.**
Tree clean at the start (only the developer's `docs/metric_info.txt`
untracked, left out of every commit), every fast suite passing. The
developer asked for OLL, PLL, COLL, OLS, ZBLS and ZBLL: a community
baseline, generated algs that rank better under the internal ranking, and
a CubeDB replacement with autocomplete. Built (details in "Algorithm sets"
below):

1. **Cases** (`js/alg-sets.js`): every set enumerated from the states it
   allows, AUF classes; counts checked against the known numbers (OLL 57,
   PLL 21, COLL 42, ZBLL 472, VLS 216, ZBLS 302) and every SpeedCubeDB case
   maps to exactly one class. Recognition, case pictures, mirror.
2. **Community baseline** (`tools/algdb.js` -> `data/ll/scdb.json`):
   SpeedCubeDB's OLL, PLL, COLL, ZBLL, VLS/WV, SV and F2L pages (names,
   setups, algs, votes); 3,043 of 3,045 algs replay on their case (one
   needed a U2 pre-AUF, one is a 50-move joke).
3. **Generator** (`tools/llgen/llgen.cpp`, `tools/ll-gen.js`): every
   solution up to a few moves past the shortest in each human move set,
   per case; ~3.5 h of CPU on this machine for all six sets.
4. **Ranking** (`AlgSets.llScore`, `tools/ll-build.js`): the step
   ranking's formula with last-layer constants fitted on the community's
   votes: 79.4% agreement on clearly ordered pairs (the F2L constants:
   68.8%).
5. **The algs page** (`algs.html`, `js/algs-ui.js`, `js/case-diagram.js`)
   and **the solving screen** (`js/last-layer.js`, `solver-ui.js`): last-
   layer steps read by replay and named by case, ghost/Tab and tree-
   searcher picks in the solver's method, ZBLS/OLS at the last pair (left
   slots mirrored), a last-layer critique, links between the pages.
6. **Fixes elsewhere**: solver.html never loaded
   `random-state-scramble.js`, so "+" made random-move scrambles (README:
   random-state); a signed-in profile without a saved search (storage
   cleared, an imported profile) was stuck on "go back to choose the
   options" (a page that no longer exists): the search is now rebuilt from
   the profile's answers (`criteriaFromProfile`), the message a caption;
   a failed load of alg-sets.js could break the F2L editor (the last-layer
   code now needs both scripts or stays out); the critique credits a last
   pair that orients the edges or the layer when the quicker alternative
   does not.

All fast suites pass; real-engine suites re-run and passing:
solver-bridge-e2e, cubedb-export-e2e, wide-spellings-e2e, progressive-e2e,
crossSolver/test (dag-search, slot-mapping, color-orientation).

**Rename (2026-10-11, developer):** the solving companion is **the
tree-searcher** everywhere -- captions, aria labels, docs and code
(`js/searchers.js`, `SEARCHER_SHEET`, `drawSearcher`, `searcherPicks`,
`#searcher`, `searcher.*` caption keys, the profile's `searcher` field;
profiles saved with the old `avatar` field are read as their
tree-searcher). The developer's own caption edits went in with it.

**Thirty-sixth pass (2026-10-11): bug fixes, polish, solver input.** Tree
clean at the start (the 35th pass committed), every fast suite passing.
The developer's list, in order:

1. **Onboarding** (`js/skill-levels.js`, `js/onboarding.js`, captions):
   four inspection answers (the cross / the cross + spot the first pair /
   the first pair, sometimes an xcross / several pairs and/or xcross often;
   old saved ids map over); the developer's brackets -- 10 s+ xcrosses and
   wide-move crosses only, 8-10 no multislotting, 6-8 no xxcross, under 6
   everything with pseudo F2L -- each with a kind note (sub-10 with plain
   CFOP, Max Park), and a "more in settings later" line. The brief gave
   "8-12" and "10+"; read as 8-10 and 10+ (the Max Park line is about
   sub-10). A first-step type above the bracket is not switched on by the
   inspection answer unless its goal was chosen.
2. **De-cluttering** (`solver.html`, `styles.css`): the top-5 list is gone
   (autocomplete is the ghost after the caret; ↑/↓ cycle it); the tree-searcher
   sits in its place under the bar; no stat cards, no result counts, no
   engine progress text, **no TPP anywhere a user sees** (info captions
   rewritten); the Cubedb button removed. Frames: only the cube stage and
   the bar, as corner brackets; the cube on a transparent background with a
   dithered floor shadow (`PixelCube` `clear`, `floorShadow`); text buttons.
3. **Cube**: zoom (wheel, pinch, +/−; reset on double-click); playback
   starts from the scrambled cube (the scramble is not played); the cube
   follows the caret while the bar has it, back to the end on blur unless
   the controls or the cube were used. "Cursor in the scramble bar" in the
   brief read as the solution bar (the scramble is not editable).
4. **Tab bug**: Tab used to fill the moves and leave them greyed and
   uncommitted (the tree-searcher then said "finish the step"); now Tab writes the
   step with its label and a newline, so it commits at once. A tail typed
   by hand that finishes a step is drawn as a step and the tree-searcher says so
   (the last pair: "press tab to finish").
5. **Continuation search** (solver-ui.js `runContinuation`): complete typed
   moves that start no listed step are searched onward (later steps: a fork
   with the moves as an extra path piece; first step: the moves moved into
   the scramble as face turns before the inspection rotation, checked
   physically, one colour, fresh memos since memo keys hold no scramble);
   each continuation = typed + rest, rescored by userStepRow; rests that
   cancel into the typed moves are dropped. Browser: after a cross, typed
   `R2 ` gave `R2 U' R' U R U' R U L' U' L` as the ghost.
6. **Tree-searcher picks** (`js/suggest.js`): fastest; a style pick only when
   quantified (TPS: top three, > 2 moves above the goal's move-optimal and
   longer than the fastest; efficiency: >= 2 moves shorter within 10%); the
   free pair setup (fastest within 16% leaving more connected pairs; none
   when the fastest does). No arbitrary fallbacks. Shine (pixel diagonal,
   `--shine` per theme), blink cells per sprite, idle bob, thinking dots.
7. **Critique** (`js/critique.js`): no numbers; why in words
   (`critique.why.*`, `critique.outside.*`); the alternative is the same
   goal, longest shared start, then fastest; "best of its kind" when another
   goal was faster. Browser: a solve of weaker picks got "1st pair: it takes
   the long way round. try R' U R: it starts the same way."

Tests updated (onboarding, suggest, critique); all fast suites pass.
Browser-checked in headless Chrome: onboarding screens, Tab commits, the
continuation ghost, caret following, blur to the end, the start button,
zoom, a full Tab solve, both critiques, paper theme, the shine frame, phone
width. Open: the developer's tree-searcher art and info page (they will make them);
the copy in captions.js is still the agent's draft.

**Thirty-fifth pass (2026-10-11): the UI overhaul.** The developer's
blueprint arrived as `cube_tree_website/UI_references/` (local only and
git-ignored: partly third-party art, kept out of the public repo; CubeDB
screenshots, one-bit pixel art and UI kit, pixel avatars, two pixel cubes,
Pokémon Showdown) plus a brief; the agent composes the visuals from those
references (developer decisions: 2 dark + 2 light themes; the results table
replaced entirely by the top 5 and the tree-searcher; style changes only the
tree-searcher's picks; agent-drawn placeholder tree-searcher sprites; chunky/fine/smooth pixels;
strict prefixes; free entry; Showdown ideas without the battle theme;
look-ahead without clutter; **no last-layer work at all**). Tree clean at
the start (only the new references untracked), every fast suite passing.
Plan: `~/.claude/plans/pasted-content-id-ed99-phase-0-floofy-giraffe.md`.
README sections "Profiles", "Onboarding", "The solving screen" replace the
configuration/results pages and the planned redesign. The solver, the
ranking and the search are unchanged (real-engine e2e suites re-run:
cubedb-export, pair-choice).

1. **Profiles** (`js/profile.js`): sign-in = picking a local profile; every
   saved key scoped per profile (`profileKey`, script.js `scopedKey`); the
   first profile takes over the pre-profile keys; export/import codes.
2. **Onboarding** (`index.html`, `js/onboarding.js`, `js/skill-levels.js`):
   name + tree-searcher, average, inspection planning, style, goals gated by draft
   brackets (rest behind "show all"), colours -> existing settings.
3. **Captions** (`js/captions.js`): every user-facing sentence by key,
   placeholders for the developer (TODO(copy)); the info dialog reads them.
4. **Themes** (`styles.css` rewritten): ink, violet, paper, mint; pixel
   frames with corner brackets; Silkscreen + VT323.
5. **Pixel cube** (`js/pixel-cube.js`): software rasteriser (z-buffer,
   perspective, outlines, bevels, back-face panels), orbit, turn animation,
   playback. Geometry == MOVE_TABLE for all 54 tokens and 500 random algs
   (`test/pixel-cube.test.js`; signs and layout were right first time, the
   test is the guard). ~5 ms per frame at 356x320 in headless Chrome after
   culling hidden faces (11.6 ms before).
6. **Solution bar** (`js/solve-editor.js`): text is the truth; steps cut at
   line ends by facelet replay (strict superset of solved pairs, compared
   in the frame the step starts in); identical to `segmentProSolve` on all
   19 reference solves and 80 reco.nz solves (`test/solve-editor.test.js`);
   user steps scored with the search's TPP formula (checked: final step =
   pathCost / 12). Top 5 by strict token prefix; Tab fills, Tab again writes
   the label and commits.
7. **Tree-searcher** (`js/suggest.js`): best / style pick within 10% / setup pick
   (pair-choice view within 16% or look-ahead best); families differ; level
   gating; role-led reasons (`test/suggest.test.js`).
8. **Critique** (`js/critique.js`): each step ranked among its node's
   unfiltered same-goal results; "below my top N" vs "not in my search
   (why)"; inspection compared physically. Pro reference #1 typed in the
   browser: 12 s (xcross below the top results, +4.56 TPP; 2nd and 3rd pairs
   the best pick; 4th pair 12 turns > limit 10).
9. Browser-checked (headless Chrome, CDP): onboarding -> main screen,
   returning user skips onboarding, Tab/Tab/Enter/arrows, prefix filter,
   pick click, undo, critique, settings drawer, info dialog; screenshots of
   all four themes at 1180 px and 390 px.

Bugs found and fixed on the way: `U2'` typed by users (and in the pro data)
**hung the engine search** for the next step (the engine path only knows
`U2`; now normalised); the scramble-change hook saved the empty editor over
the restored text on reload (the editor now records which session it holds);
the critique waited minutes on hidden multislot searches (now only for a
multislot step); the page-wide lowercase reached the editor overlay.

Open from this pass: the developer's copy (captions.js), real tree-searcher art
(`SEARCHER_SHEET`), the bracket thresholds (skill-levels.js); the cube's
hover preview is a jump to the final state (no animation); a line that
merges cancelled turns across steps (`R2` written for `R` + `R`) is read as
one merged step.

**Thirty-fourth pass (2026-10-11).** Developer: pair planning off is for
solvers who want the best pair now, without knowing why a step sets up a
later pair; it must get no information about EO, the remaining pairs or
the slots, and its ranking is fitted to it -- a pro's step may rank lower
there. Every setting combination may be tuned separately.

1. **Planning off = a step ranked by itself alone**: no pair-choice term at
   all (`lookWeightsFor` returns null off; `PAIR_CHOICE_LOOK` is no longer
   used by the app, kept for tools/pair-choice.js). README "Pair planning",
   the info dialog and the checkbox hint say so.
2. **Per-setting scoring constants**: `scoringFor(settings)` (script.js)
   gives `{ mcc, pen }` -- `DEFAULT_SCORING` (= ALG_SPEED_DEFAULTS,
   STEP_PENALTIES) or `PLANNING_OFF_SCORING`. Threaded explicitly, no
   global switching (searches of both settings can interleave): session
   `scoring` getter -> costBase (cached per scoring) -> `algSpeedPrefix(prefix,
   A)` (the checkpoint keeps A) / `stepPenalty(alg, P)`; ctx.scoring (workers)
   -> complete search spec -> `mccMinimum(A)` (cached per constants),
   `penalties(P)` (naturalness weight now stored at index NT; the tables
   read `lam = pen[NT]`), `plainEstimator(root, scoring)`. Tests: brute
   force equals the branch and bound with constants far from the defaults
   (first and later step); stepsPathCost with any constants equals algSpeed
   + stepPenalty with them; the cached path follows a change of constants.
   Wide moves off has no slot of its own: its list is the wide search's
   minus wide rows (wideTwin), which needs the same constants.
3. **Fits, one setting at a time** (fresh pools of each combination under
   the new planning off, 319 solves; 2-fold CV + full fit; train Yiheng
   Wang + Xuanyi Geng, held out folds + pro_references). Pro top 10:

   | setting | references | reco.nz train | separate fit (held out) |
   |---|---|---|---|
   | planning on | 87.9% | 76.5% | (fitted on these lists already, 33rd pass) |
   | planning off, no pair term | 81.8% (was 84.8 with look terms) | 75.8% (was 76.1) | log rank + gap, top-10, pure log rank: folds pick different constants; held-out top 10 down or flat |
   | wide off, planning on | 96.5% | 87.0% | rotation 4.8 -> 2.4-3.4, B 3.5 -> 7 in every run; references down (fold 0 93.0 -> 91.2), one solver up, the other down |
   | wide off, planning off | 94.7% | 87.0% | same direction; references down (full 94.7 -> 93.0, fold 1 91.2 -> 89.5) |

   Wide-off rows count only professional steps without a wide move
   (`fit --wide off` now drops the others: ranking them only rewarded
   pricing B/F up, B went to 14-28). **No separate constants pass** the
   acceptance rule; `PLANNING_OFF_SCORING` holds the default values. The
   drop in planning off (references 84.8 -> 81.8%) is the information the
   developer asked to take away: steps pros chose for what they set up.
   The one consistent signal (wide off: cheaper rotations) is worth
   re-testing with more data (a third solver).

**Thirty-third pass (2026-10-11).** Tree clean at the start (prompt and
metric notes untracked), every fast suite passing; every real-engine e2e
suite re-run this pass and passing.

1. **Cancellations across steps** (README "Results table"; developer's
   example): a step ending `R` then `R U' R' U' L U L'` is written
   `R' U R U R' U' R2 // 1st pair (cancels with 2nd pair)` then
   `U' R' U' L U L' // 2nd pair`. `cancelBoundary` / `cancelledSteps` /
   `candidateCancellation` (solver-bridge.js): same layer (or rotation axis)
   only, quarter turns summed mod 4, a full cancel tries the next pair, a
   step that cancels away entirely lets the next one meet the step before.
   Copy, copy all, Cubedb and STM/ETM use the cancelled text. Result rows
   whose first turns cancel with the solution's end show them struck through
   with the result (`R R → R2`), recomputed on every render. Committed rows,
   the engine's postAlg and the ranking keep the steps as found (same cube;
   test: 2,000 random step triples replayed on facelets). Checked in
   headless Chrome on the developer's scramble: the copied text is exactly
   the developer's expected output; 390 px and 1180 px screenshots.
   Not done: scoring the cancelled text (MCC prices `R R` 1.1 units below
   `R2`); the complete search's bounds would need the merged first token in
   the grammar to stay exact. Look-ahead chains are shown as found.
2. **Planning-off ranking** (developer: "fails because it was trained with
   planning on"). New tooling: `cpools --planning off` and `--wide off`
   (the lists the app shows with those settings), and `joint --set
   on=... --set off=... --set nowide=...` (shared parameters fitted once on
   the summed loss of every setting; pair-choice weights per group, planning
   on (also wide off) vs off; `--objective top10` = smoothed share outside
   the top 10). Fresh pools of all three settings (319 solves each, current
   code). Current app, pro top 10:

   | setting | references (first / later) | reco.nz train (first / later) |
   |---|---|---|
   | planning on | 87.9% (63.2 / 97.9) | 76.5% (26.9 / 93.7) |
   | planning off | 84.8% (52.6 / 97.9) | 76.1% (25.8 / 93.5) |
   | wide moves off | 89.4% (68.4 / 97.9) | 79.0% (34.4 / 94.5) |

   The browser's planning-off lists equal Node's (same scramble, worker
   path). **No refit passes** the acceptance rule (pro top 10 as high as
   possible in every setting): log-rank joint fit (2-fold CV: held-out top
   10 down in on and off, both folds; full fit references 87.9 → 83.3% on,
   84.8 → 81.8% off), smoothed top-10 joint fit (fold 0 down in all three;
   full fit references on 87.9 → 83.3%), planning-off look weights alone on
   planning-off lists (CV flat or worse) or on planning-on lists (same).
   Parameters unchanged. Planning off's top result leads with a rotation
   more often (24.0% of later steps vs pros 18.4%, planning on 21.7%).
3. `test/pair-choice-e2e.js` failed at exactly 300/600 nonzero pair-choice
   terms: the 300 multislots that finish F2L have term 0 by design; it now
   counts rows that leave a pair open.

**Thirty-second pass (2026-10-10).** The developer tested on an iPad Air 5:
searches are far below the speed goals (this dev MacBook is old), and the
solver and rankings are right. **Solver optimisation and speed are DONE**;
what is left is minor details and the visual redesign (waiting on the
developer's blueprints; not started). Tree clean at the start, every fast
suite passing.

1. **Rotations first** (README "Ranking", "Complete search"): a later step
   never writes a `y`/`y'` after nothing but `U`/`D` turns (it commutes with
   them); the leading-rotation spelling is listed instead. Complete search:
   the walk skips those mid-step rotations (`ud`, the solution's leading
   U/D face turns: no mid y at move i <= ud, no split half turn around a y
   at i < ud); the bound tables are unchanged (still lower bounds of a
   smaller grammar), brute-force tests pass with the rule asserted.
   Corpus candidates and the old capped path go through `rotationFirst`
   (facelet-cube.js; physically identical, checked on facelets). The
   developer's scramble (`F2 D' F2 L2 ...`, `z y` + `D' L D R2 D U' r2 U r`):
   2nd pair was `U y L' U L` first with `y U L' U L` not in the top 300;
   now `y U L' U L` is first and no row has a y after only U/D turns; 3rd
   pair `y U L' U2 L R' U' R` ranks 2nd. 143 of 2,999 reco.nz later steps
   (4.8%) are written with a y after an AUF: the complete search still
   has them, but only rotated first (the "exactly as written" coverage
   below counts them as missing; not re-measured, nor the tuning numbers).
2. **Move count** in the solution card, `25STM / 28ETM` (`moveCounts`:
   STM every non-rotation token, ETM every token, inspection excluded;
   metric definitions from the developer's metric notes, ETM as the WCA defines it).
3. **Copy all** next to copy: every scramble of the list as copy writes it
   (scramble, then its steps), a blank line between them; a scramble with
   no committed step is only its scramble line. Checked in headless Chrome
   (390 px and 1180 px screenshots, clipboard text captured).

**Thirty-first pass (2026-10-10).** Same user tasks as the thirtieth
(speed with optimality kept, ~10 s per step; the two rules -- no rotation
inside a first step, look-ahead depth 1-3 -- were already in and verified:
tree clean, every suite passing, one commit not yet pushed).

**Result of the pass** (browser, headless Chrome, this 2-core machine, 8
random-state scrambles x 4 steps, top row clicked as soon as the rows are
final): default settings (cross only) first steps mean 3.0 s (max 4.1),
later steps mean 20.4 -> 8.1 s (max 103 -> 26.3 s; the first pair after the
cross 6.9-26.3 s, every later pair <= 12.9 s); xcross + xxcross first steps
mean 6.5 -> 5.6 s (max 10.3 -> 8.5), later mean 2.2 s (max 6.8). Every
change kept the result lists identical (md5).

1. **Default settings were the slow case.** With the configuration page's
   defaults (white, cross only) the first pair after a plain cross took
   10-103 s in the browser (8 random-state scrambles, `bench.js`-style CDP
   run: later steps mean 20.4 s): four single-pair calls of 28k-187k
   solutions (<= 10 turns) whose type-wide 300th best is ~7 TPP behind the
   best, so about half the solutions must be walked even with perfect
   limits. Chrome ranks as fast as Node (same call 7.0 vs 7.1 s): the loss
   was scheduling.
2. **Live limits** (`liveHooks`, `topSpellingsLive`, `TopViews.snapshot` /
   `tighten`): a pool job pauses about every 100 ms (enumerate is a
   generator; the sync path is unchanged), posts its kept candidates (key,
   TPP, views) and takes back, per view, the N-th best of its type among
   finished calls, every running job (each key once) and the seeds. The
   jobs of a type prune like one job. Brute-force test with two jobs.
3. **Chunks wait for every big call's seeds** of their type (`seedReady`;
   quick jobs): a call ranked before the others' engine calls finished only
   knew its own N-th best (the first of four calls walked 73% of its
   solutions, ~45% with the type's limit). A call's own seeds now count in
   its limits too (they were left out). Seed jobs may share a busy worker.
4. **Multislot engine calls start after the single-pair calls are ranked**
   (later steps, no time limit): the engine worker no longer takes a core
   from the rows being waited for. Only start order changes.
5. Results identical (md5 of whole lists, Node pools, 5 scrambles x 2-3
   steps, both settings). Browser, default settings, 8 scrambles x 4
   steps: later steps mean 20.4 -> 10.1 s, max 103 -> 30.3 s; first steps
   unchanged (2.6-6.7 s, one 9.9 s). Node pools, first pair after a cross:
   26.2 -> 17.7, 26.7 -> 20.3, 12.0 -> 9.5 s; third steps 8.6 -> 4.9 s.
   Tried and dropped: two jobs per worker (interleaved at pauses: slower),
   no in-chunk seeding when limits are known (noise), full seed jobs (every
   spelling of the 4N best-estimated solutions: their N-th best is exactly
   the final one, 22.556 vs 22.853, yet no faster -- live limits already
   converge), two engine workers (rows final unchanged; only the hidden
   multislot tail is shorter), three ranking workers on this 2-core/4-thread
   machine (no gain).
6. **Per-solution preparation** (every engine solution: luck replay and
   pair-choice / planning features, ~20% of a call): solved flags computed
   once per solution (were four times), no per-piece masks for claimed
   pairs (a pair's mask is its corner mask plus its edge mask), features
   with char-code tables (identical on 760k real cube states, ~2x faster),
   replay from the token ids (no second parse). A search abandoned while its
   chunks wait for seeds no longer dispatches them. Rejected: incremental
   replay along shared prefixes (engine order shares 7% of moves; sorting
   first saves ~2%), skipping rotation options in `boundTable` rows when a
   frame is already below any rotation's least cost (rarely true; no gain),
   Float32 LM tables (no gain: rows are instruction-bound, ~4.3 us each).
   Browser, default settings, same 8 scrambles: later steps mean 9.3 s
   (first pairs 8.8-33.9 s, the rest 1.9-11.4 s), first steps 2.6-5.1 s.
7. **Five-flag bound table** (`FLAGS` 5, `wideLanding`; boundTable,
   forwardStep, walks): the cheap table now follows a wide turn exactly for
   two tokens -- flag 4 "the last token is the wide turn of move i-1 that
   lands in frame d" (one per move and frame, so its token is known) and
   flag 3 "a plain token after it". The slack measured below was the bound
   using wide turns to forget the context. Big later-step call (187k):
   solutions walked 136k -> 34k (no limits; 83k -> 13k with the type's
   limit), walk nodes 12.6M -> 2.6M, rows 1.37x dearer each. Results
   identical (md5 of lists on 5 scrambles x 2-3 steps, both settings,
   identical exactly-scored spelling counts); brute force: 2.2M later-step
   and 15k first-step spellings, none below the bound; the tests (lower
   bound, MITM equal at every cut, best N = brute force) pass. Node pools:
   crosses 3.2 -> 2.4, 4.4 -> 3.3 s; xcross first steps 11.4 -> 10.0,
   8.2 -> 7.3 s; first pair after a cross -4%; whole later steps (with the
   hidden multislots) -5 to -13%.
8. **Browser deoptimisation loops** (found by profiling the page's workers
   over CDP and Chrome's `--js-flags=--trace-deopt[-verbose]`): one ranking
   job of a step often ran 3-9x longer than its same-size sibling (48 s vs
   5 s), different jobs in different runs. Two causes: (a) the search loops
   ran inside the `enumerateSteps` generator, whose optimised code V8 threw
   away at every live-limits yield (8,105 "exit from OSR'd inner loop"
   deopts in one step) -- the loops now run in plain functions a batch at a
   time (`prewalk`, `mainPass`) and the generator only yields between
   batches; (b) `boundTable` / `forwardStep` deopted thousands of times
   with "wrong map" at the move array (`face.length`, `face[i]`) -- every
   solution's moves are now an `Int8Array` (postProcessComplete). After:
   sibling jobs equal (7.3/7.1 s, 6.3/6.9 s), the scramble's first pair 41-99
   s -> 23-32 s in the same browser harness; results identical (md5).
   Also learned: headless Chrome numbers vary 2x with this machine's
   background load; `--disable-renderer-backgrounding` did not matter.
9. **Where the first pair after a cross still goes** (before item 7) (~24 s in Node pools,
   10-30 s in the browser; the type's limit is now the final one almost from
   the start, so this is the algorithm's own cost): per solution ~13 us of
   preparation (luck replay, look and plan features), ~1.5 cheap MITM rows,
   and for the ~45% whose bound fits, the rest of the table + a walk.
   Measured (`exp-slack`-style, 300 sampled walked solutions of the 187k
   call): the cheap bound is 43-79 units (median 63) below the solution's
   true best spelling, and none of them has a spelling inside the limit --
   almost all of it naturalness context the cheap table forgets after a
   wide/split token (real MCC minus least MCC only ~5). Exact-context tables
   at later steps (ideal limits, same call): walks 83k -> 3.4k, but 209k
   exact rows at ~50 us (mid-step rotation contexts and options are ~80% of
   a later-step row; root rows ~8 us): 8.4 -> 15.1 s. A relaxation that
   bounds the rotation token and the token after it by min-over-context
   would cut a row to ~20 us by count, about break-even; it needs < 16 us
   to pay. Rows cannot be shared across the step's calls (row 5: 362k
   distinct suffixes per call, 349k across all four).

**Thirtieth pass (2026-10-09).** User tasks: (1) search speed with the
optimality guarantee kept, ~10 s per step as the goal; (2) a first step
never rotates inside its alg (professionals' habit; wide moves and
side-cross inspections stay); (3) look-ahead depths 4 and 5 removed. The
tree was clean and every fast suite passed at the start.

1. **No mid-step rotation at the first step** (README "Ranking",
   "Complete search"): the grammar, both bound tables and the walks leave
   them out at the root; the old capped root engine calls get no y/x and
   post-processing drops a first-step candidate that rotates. Pro first
   steps in the complete search's space: reco.nz 66.0% -> 59.9% (12% of
   them rotate inside the alg; `complete-coverage.js` counts them),
   pro_references unchanged (11/19). Root ranking CPU on the hardest
   scramble 32 s -> 14 s from this alone.
2. **Look-ahead** depth 1-3 only (`LOOKAHEAD_MAX_DEPTH` 3; a stored 4/5
   is clamped).
3. **Exact-context bound** ("Complete search" below): measured, the old
   bound lost ~25 units per solution to the trigram context it forgot
   after a wide or split token (MCC only ~4). `exactTable` keeps the last
   two written tokens; first-step calls that solve a pair use it (walk
   nodes ~10x fewer). The first-token tier is gone (in Chrome its call
   ran 3-4x slower than in Node: one cross chunk took 10-16 s).
4. **Later steps**: the multislot engine call (two pairs, up to 12 turns;
   warm 1.2-5 s each, up to three per step, one engine worker) ended most
   later steps (single pairs: 0.1-0.3 s). Now split by first move
   (`splitByFirstMove`; identical sets on 24 real calls,
   `tools/split-check.js`; no extra cost on one worker), the page says
   when the shown rows are final (only hidden multislots left:
   `onlyMultislotPending`, the finished types trimmed to their best N),
   and a search nobody wants any more stops (memoSearch / engineCallMemo
   track interest; a stopped search is never reused). Replaced searches
   yield on the engine gate and the ranking pool.
5. Browser (headless Chrome, this 2-core machine, warm), scramble
   `R2 U2 L D' ...`: first step 14.1-14.8 s -> 6.2-6.6 s, second step's
   rows final 6.9-8.9 s -> 3.5-3.9 s; hardest known scramble
   `D R2 U' B2 ...` first step 25-35 s -> 9.6-11.8 s, second 5 -> 2-2.3 s;
   `F2 U2 B2 D ...` second step's rows final at 6.5-9.3 s (its multislots
   end at 16-18 s), the next step after an early click 2.3-2.5 s. Node
   (pools, quiet): hardest first step 24 s -> 10.0 s. Headless Chrome
   reports 2 threads here (2 ranking workers); a 4-thread report gets 3.

**Twenty-ninth pass (2026-10-09).** User tasks: (1) rankings had got much
worse with the complete search: retune on the professional solves only,
including how often each move type (wide moves etc.) is in the top result
vs the pro's step, and keep raising the top-10 rate; (2) make the searcher
significantly faster; (3) no UI/UX redesign yet. The tree was clean and
every fast suite passed at the start.

1. **Ranking** ("alg_speed tuning" below): pro steps are now ranked in the
   complete search's own list for their goal (`tune-alg-speed.js cpools`),
   the loss adds a move-type frequency gap, pair-choice weights are fitted
   with alg_speed, λ chosen by CV; the naturalness model now scores a later
   step's leading rotation. Pro steps in the top 10 of their goal's list:
   first steps 21% → 28.5%, later 91.4% → 93.8%, references 81.8% → 86.4%;
   first-step wide moves in the top result 54% → 44% (pros 46%), later
   steps' leading rotation 32% → 22% (pros 18%). The pro's pair choice
   (different goals, held-out solves) ranks first as often as before
   (first steps 22.7% → 28.0%, later 64.2% → 62.8%). Ceiling: 74% of the
   pro steps still outside the top 10 are longer than the app's top result
   (54-58% by 2+ turns): planning/findability, not execution speed.
2. **Speed** ("Complete search" and "Measurements" below; every change
   checked for identical result lists): cheaper bound tables, first-token
   rows at the root, meet-in-the-middle rows, seeding, tighter walks,
   planning features in one pass, and above all the worker pools (the page
   ranked on one worker; one call per worker; chunks ≤ workers with shared
   seed limits, limits refreshed at dispatch); later steps start their
   single-pair engine calls first (multislots are hidden by default), and
   the top N is chosen in a strict (TPP, key) order so results do not
   depend on call finishing order. Browser (headless Chrome, this 2-core
   machine, warm, quiet): scramble `R2 U2 L D' ...` first step 58 s →
   13-15 s, second 44 s → 6-9 s (rows shown final ~4 s); the hardest known
   scramble's first step ~25-30 s (Node 24 s).

## Layout

```
cube_tree_website/          the site (GitHub Pages root)
  index.html, solver.html   sign-in + onboarding, the solving screen
  UI_references/            the developer's design references (blueprint; local only, git-ignored)
  js/profile.js             local profiles, per-profile keys, themes
  js/onboarding.js, js/skill-levels.js   onboarding, brackets, answers -> settings
  js/captions.js            every user-facing sentence (developer's copy)
  js/searchers.js             placeholder tree-searcher sprites (SEARCHER_SHEET hook)
  js/pixel-cube.js          pixel-art cube renderer + playback
  algs.html                 the alg sets page (OLL PLL COLL ZBLL OLS ZBLS)
  js/alg-sets.js            the sets: cubies, cases, recognition, mirror, llScore
  js/algs-ui.js, js/case-diagram.js   the algs page, pixel case pictures
  js/last-layer.js          the last layer on the solving screen: steps by replay, suggestions, critique
  data/ll/<set>.json        each set's cases and ranked algs (tools/ll-build.js)
  data/ll/scdb.json         SpeedCubeDB's algs, names and votes (tools/algdb.js)
  js/solve-editor.js        solution bar: text -> steps by replay, prefix matches
  js/suggest.js             the tree-searcher's three picks and reasons
  js/critique.js            whole-solution critique
  js/script.js              DAG pruning, criteria, MCC algSpeed, stepPenalty, naturalness model
  js/pro-steps.js           generated: the naturalness model's professional corpus
  js/solver-bridge.js       SolveSession, searchCurrentNode, post-processing, look-ahead, export
  js/solver-ui.js           solving-screen DOM, worker pools, IndexedDB prune-table cache
  js/facelet-cube.js        facelet simulator (verified against magiccube), spellings
  js/facelet-flags.js       which pieces are solved (luck filter), pseudo masks, look/plan features
  js/spelling-search.js     complete search: every spelling of every face-turn solution, exact top N
  js/cross-optimization.js  first-step wide rewrites
  js/search-scheduler.js    one search at a time, active scramble first
  js/random-state-scramble.js, js/postprocess-worker.js
  crossSolver/, pseudoCrossSolver/   vendored or18 engines (GPL-3.0, patched; see THIRD_PARTY_NOTICES.md)
  data/f2l_nodes_and_edges.json      the DAG (tools/tree_gen.py)
  data/pro_references.txt   19 benchmark solves (coverage requirement)
  data/reco_solves.txt      934 reco.nz solves (tuning data)
  tools/                    dev tools (below); test/  tests
archived_attempts/          earlier ML attempts, not used by the site
```

## Tests

Fast suites (run before and after any change, from the repo root;
`test/pair-choice.test.js` is one of them):

```
python3 cube_tree_website/tools/test_tree_gen.py
for t in cube_tree_website/test/*.test.js; do node $t || echo FAIL $t; done
```

Alg sets: `alg-sets` (cubie model vs the facelet cube, the human view
llgen.cpp relies on, mirror, case counts, every SpeedCubeDB case mapped,
every alg in data/ll/*.json replayed with its AUFs, recognition of AUF
variants), `last-layer` (stages, steps by replay, labels, every
suggestion solves its cube, critique).

UI suites among them: `profile`, `onboarding` (brackets, captions, sprites),
`pixel-cube` (geometry vs MOVE_TABLE), `solve-editor` (segmentation vs the
pro segmenter), `suggest` (tree-searcher picks), `critique` (fake search).

`test/spelling-search.test.js` checks the complete search's branch and
bound against brute force (fast). Real-engine checks (slower; most set
small move limits with `test/fast-limits.js`): `test/complete-search-e2e.js`
(complete vs the old capped search, physical replay, timings;
`--multislot` as the app, `--no-old`), `test/pro-references-e2e.js` (pro solutions in
the search tree), `test/solver-bridge-e2e.js --pseudo --scrambles 2`
(full sessions, physical replay), `test/progressive-e2e.js`,
`search-options-e2e.js`, `lookahead-e2e.js`, `offload-e2e.js`,
`wide-moves-e2e.js`, `wide-spellings-e2e.js`, `cubedb-export-e2e.js`,
`corpus-candidates-e2e.js`, `pair-choice-e2e.js`,
`crossSolver/test/{dag-search,slot-mapping,color-orientation}.test.js`.
Browser: headless Chrome over CDP (`--headless=new --remote-debugging-port`,
Node's WebSocket), site served with `python3 -m http.server`.

Alg-set tools: `algdb.js fetch|parse` (SpeedCubeDB import), `ll-gen.js
build|run <set>|case <set> <i>` (the generator; work dir `$LLGEN_WORK`,
default `cube_tree_website/llgen-work/`, git-ignored: binary, ~2 GB of
pruning tables, raw solutions), `ll-build.js eval|build [sets]` (rank,
replay, write data/ll/; eval = agreement with the votes).

Tools: `split-check.js` (multislot split == the whole engine call),
`tune-alg-speed.js` (tuning, below), `pair-choice-pro.js` (pros'
pair choices under the real search), `pair-choice.js` (pair-choice
weights, below; `--model none+look+plan`), `continuity.js` (greedy solves:
rotations, slot order, planning on/off), `complete-coverage.js` (pro steps
in the complete search's space, no engine), `reco.js` (data),
`pro-ranking.js` (rank of the 19 reference steps in the app's real lists,
`--app`), `pro-references.js` (parser, segmenter), `pro-search.js`,
`worst-case-bench.js`, `engine-battery.js` (engine rebuilds must give
identical batteries), `node-engine-pool.js`, `node-postprocess-pool.js`,
`tree_gen.py`, `gen_facelet_fixture.py`.

## State of the product

Everything in the README is implemented, including the UI overhaul
(thirty-fifth pass; captions and tree-searcher art are placeholders for the
developer). Solver, rankings and speed are done (developer-confirmed on an
iPad Air 5, thirty-second pass).

- **Search loop:** DAG edges of the current node, deduplicated by target;
  later steps include every solved slot in their goal. Matched calls: the
  complete search (face turns only, uncapped, then spelling-search.js);
  pseudo calls via the pseudoCrossSolver (capped, aligned with
  `alignPseudoAlg`, old spelling path). Luck filter replays every solution
  on the facelet cube. `SolveSession.completeSearch = false` restores the
  old capped pro-move-set engine search (tools, comparisons).
- **Spellings:** one grammar (spelling-search.js) replaces inspection
  variants, rotation spellings, side-cross inspections, cross optimisation
  and wide spellings for matched calls; pseudo calls keep the old ones.
- **Solving screen:** solution bar (free entry, steps by replay, top 5 by
  prefix, Tab/comment completion), tree-searcher picks with reasons, critique,
  pixel cube with playback, settings drawer (look, filters, pair planning,
  look-ahead, search settings, scrambles, profile), copy / copy all / Cubedb,
  undo, reload persistence (rows and text), background searching with the
  active scramble first.
- **Alg sets:** OLL, PLL, COLL, ZBLL, OLS, ZBLS (see "Algorithm sets"):
  the algs page and the last layer / last slot on the solving screen.
- **Engines:** prune tables shared between workers and kept in IndexedDB per
  `ENGINE_VERSION`; the cross engine worker sends solutions in batches
  (`ENGINE_GLUE_VERSION`, its own URL parameter so the table cache stays).

### Measurements

- Thirty-first pass, browser, 8 random-state scrambles (seed 12345,
  `random-state-scramble.js`), 4 steps each, the top row clicked as soon as
  the rows are final: default settings later steps mean 20.4 -> 10.1 s (max
  103 -> 30.3 s); xcross + xxcross first mean 6.5 s (max 10.3), later mean
  2.1 s (max 7.3). This machine runs a background process at 4-50% CPU at
  times: repeat runs of one scramble vary by up to 2x; decide on alternating
  Node A/B runs (md5 of the lists must match), and park the headless page on
  about:blank after a run (its hidden multislot search keeps a core busy).
- Thirtieth pass, later steps (browser, clicking as soon as the rows are
  final): scramble `F2 U2 B2 D F2 U F2 L2 R2 F2 U' F2 R B D U B' L2 U'
  R U' R'` second step rows final 6.5-9.3 s (the step itself ends at
  16-18 s: three multislot calls), third 2.3-2.5 s (was 11 s while the
  previous step's multislots still ran); `R2 U2 L D' ...` second 3.5-3.9 s,
  third 0.5 s; hardest scramble second 2.0-2.3 s. Two engine workers on
  this machine (Node, 3 ranking workers): later steps -0.5 to -1.5 s, first
  steps +0.3-0.7 s: kept at one below 8 threads.
- Thirtieth pass, browser (warm, quiet): scramble `R2 U2 L D' ...` first
  step 6.2-6.6 s, second 6.9-7.9 s (the hidden multislot engine call sets
  its end; single-pair rows are final ~2 s earlier), third 0.3-0.5 s;
  hardest scramble first 10.2-10.9 s, second 5.4 s. Node pools: hardest
  first 10.0 s (seed jobs 2.5 s, xcross 9.7 s, cross 5.7 s, xxcross 1.6 s
  of worker time on 2 workers), second 6.0 s (engine: multislot call 3.6 s).
- Before (twenty-ninth pass): browser, headless Chrome on this 2-core machine (it reports 2 threads:
  1 engine worker, 2 ranking workers), white, xcross + xxcross, warm
  (prune tables in IndexedDB; a cold first load adds ~5 s): scramble
  `R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2` first step
  14.1-14.8 s, second 6.9-8.9 s, third 0.3-0.5 s (start of the pass: 58 s
  and 44 s; 29.9 s / 8.2 s after the search changes, before the pool
  fixes). Scramble `D R2 U' B2 U' R2 D2 R2 U B2 U' R2 B2 U' R' B2 F L D'
  F R' B2`: first step 35 s (57 s before the pool fixes), second 5 s.
- Node, the same pools: the two first steps 16-17 s and 30-33 s
  (`complete-search-e2e.js`, `toplist`-style runs); single-threaded CPU of
  their ranking 19.5 s and 36.9 s (start of the pass 24.7 s / 55 s for
  the same captured calls, old weights).
- Where a first step's time goes now: walks of the root xcross calls (24
  inspection orientations; ~15M walk nodes for ~6k exactly scored
  spellings), the cross call's bound rows, small xxcross calls that must
  fill 300 results per view from a few solutions. Two ranking workers give
  ~1.45x one on this machine (clock scaling).
- Solutions per goal (face turns, uncapped): cross ≤9 24k-65k; xcross ≤10
  0.5k-18k per slot; 2nd pair ≤10 3k-170k; two pairs at once ≤12 1k-31k.
- Coverage (`complete-coverage.js`): reco.nz later steps in the complete
  search exactly as written 89.7% (limit 11: 92.8%), first steps 66.0%;
  pro_references 45/47 later, 11/19 first (the rest are longer than the
  limits).

## Algorithm sets

README "Algorithm sets" is the spec. Thirty-seventh pass.

**Cases.** `AlgSets.enumerateCases(set)` builds every state the set allows
(last layer: 24 x 27 x 24 x 8 / 2 states; ZBLS: the FR pair anywhere in
the U layer or its slot x every edge flip; OLS: X * (R U R') and
X * (R U' R') for every LL orientation X) and groups them by the set's key
under pre-AUF (s * U^a) and post-AUF (U^b * s). Counts: OLL 57, PLL 21,
COLL 42, ZBLL 472, OLS 432 (VLS 216 + HLS 216), ZBLS 302 (305 minus the
3 "pair solved, only edges flipped" classes the standard count leaves
out). Names: SpeedCubeDB's (OLL n, PLL letters, COLL "AS 1", "ZBLL T 12",
WV/VLS n, SV n); ours for the rest: COLL "O adjacent / O diagonal", HLS
28-216 grouped by flipped edges like VLS, ZBLS "F2L n · flip UF UB" (the
pair placement named by SpeedCubeDB's F2L page, the flipped U-layer edges
in that orientation). Cases are listed in the database's order.

**Cubie model.** Read off facelet-cube.js: positions' facelets checked to
sit on their faces, round trips with every token kind, composition ==
replay. llgen.cpp works in the solver's view of the cube (pieces by
colour, fixed positions, centres tracked as a frame); its relation to the
centre-relative state is `human = rot * state` (rot first: 300/300 random
algs; the other order 9/300). A leading y on a last-layer case equals a U
turn (F2L symmetric), so database "y A" is stored as pre-AUF U, then A
(checked on every case). Mirror: the facelet reflection from the position
names, each token's mirror found on the cube (`mirrorAlg("R U R' U'")` =
`L' U' L U`); left-slot last pairs use mirrored ZBLS/OLS algs.

**Generation** (`tools/ll-gen.js run <set>`). For each case, the four
pre-AUF starts; for each move set of the set's plan, IDA* to the shortest
solution in that set, then every solution up to `slack` moves longer
(never starting or ending with U; U stays on top at the end). Pruning:
three pattern databases (8 corners 88M, two halves of the edges 42.6M
each) built by BFS **in the move set itself** from every goal state in
every final frame the set can reach (the full-cube tables were 25-50x
weaker: T perm RUD 6.9M nodes -> 281k). Tables ~86 MB per move set and
goal, cached on disk. A first attempt searched the normalised cube with
all 27 face/slice turns: fast near the optimum, but optimal algs are far
from human ones (T perm 10 HTM vs the 14-move standard; ZBLL optimum + 1:
96 solutions), so it was replaced. Plans (move set, slack): OLL RUF 3,
RUFr 3, RUFl 2, LUF 3, LUFl 2, RUD/RUL/RUFMr/RUFSf/RUFD 2; PLL RU 3, RUF,
RUD, RUL, RUFD, RUFr, RUDr, RUMr 2, RUFL, RUB 1; COLL similar; ZBLL RU 3,
RUD/RUL 2, RUF/RUFD/RUFr/RUDr/RUMr 1; OLS and ZBLS RUF/RUD/RUL/RUFr 2, the
rest 1. R, U and D never flip an edge, so in RUD/RUL only the 54
oriented-edge OLS cases are solvable (the tables say so at once).

**Ranking** (`AlgSets.llScore`). The step ranking's formula without the
AUFs, constants fitted for the last layer on SpeedCubeDB's votes (two
folds of cases; agreement on pairs whose votes differ clearly, by 2+ and
25%+, / the top-voted alg ranked first):

| score | pairs | top-voted first |
|---|---|---|
| move count (STM) | 52.8% | 16.4% |
| MCC alone | 63.0 | 40.4 |
| the F2L step ranking as is (MCC + penalties + F2L naturalness) | 68.8 | 48.7 |
| + 3 per left-hand turn | 72.6 | 54.5 |
| last-layer naturalness model (leave-one-case-out), left 2 | 77.2 | 61.0 |
| **used**: + last-layer move penalties (D 1.75, F 2.25, B 3.5, r/l 0, u/d/f/b 3.5, slices 3.5), naturalness 1.25, left 2.5 | **79.4** | **63.4** |

Folds of the used constants: 80.0 / 65.6 and 78.7 / 61.0; each fold's own
coordinate fit agreed on no r/l penalty, D about 2 and naturalness
1.25-1.5. Rejected: per-move terms on top of the F2L naturalness (did not
hold across folds), a lower slice penalty (on the 335 pairs of a slice alg
and a face-turn alg the votes favour face turns: 74.3% at 0, 75.8% at
3.5), a cheaper rotation (no effect on any pair). The naturalness model is
a trigram over the 2,986 verified community algs; a case is always ranked
with a model that leaves its own algs out (`ll-build.js llModel`), so its
community algs get no in-sample advantage over generated ones. The F2L
model had priced slice PLLs far down (M2 U M2 U2 M2 U M2: +88 from
naturalness vs 18 from MCC). What the votes cannot judge: a generated alg
against a community one (generated algs have no votes); the A perms' x
algs rank ~14th behind RU+D algs. Every list keeps the community's algs
(up to 4) and the pages show the community favourite next to the fastest.

**Build** (`tools/ll-build.js build`): community algs (notation
normalised, adjacent turns of one layer merged -- a few entries carry
"U' U" -- pre-AUF found by replay) and every raw generated solution are
replayed on the case; kept: the 12 best by llScore plus the community's
algs with a vote (up to 4), nothing scoring above 2.5x the case's best
unless voted for (a 20-move joke entry sat in WV 18), with pre/post-AUF,
score (never shown), source and votes. A body that appears twice keeps
the higher vote count.

**Generator runs** (this machine, 2 cores): OLL 15 min, PLL 32, COLL 8,
OLS ~25, ZBLS 9, ZBLL ~2 h (four processes at the end). Lessons: the
driver now treats a killed llgen as a failure (one OLS pass lost 180 cases
silently), resumes (finished move-set results are kept), and
`LLGEN_BIN`/`LLGEN_NODES` override the binary and node cap. llgen.cpp:
the active move set's move tables side by side and the three pruning
tables checked one at a time cut ~26% (identical output on a battery).

**The sets as built** (every alg replayed with its AUFs in
test/alg-sets.test.js; "generated first": a generated alg ranks above all
of the case's community algs; STM without AUFs):

| set | cases | algs kept | generated alg first (cases with community algs) | cases with generated algs only | STM of the first alg | STM of the community favourite |
|---|---|---|---|---|---|---|
| OLL | 57 | 737 | 14 of 57 | 0 | 10.1 | 9.7 |
| PLL | 21 | 291 | 13 of 21 | 0 | 15.4 | 13.2 |
| COLL | 42 | 518 | 6 of 40 | 2 | 11.5 | 11.2 |
| ZBLL | 472 | 5869 | 82 of 472 | 0 | 14.7 | 14.5 |
| OLS | 432 | 5008 | 71 of 242 | 190 | 10.9 | 9.7 |
| ZBLS | 302 | 3470 | - | 302 | 9.2 | - |

Data: 1.5 MB in all (197 KB gzipped; ZBLL 606 KB). Browser-checked
(headless Chrome): every tab, name search ("t perm", "sune", "oll 2",
"zbll as 3", "vls uf", "f2l 5"), move autocomplete and "this alg solves",
deep links, phone width, paper and violet themes; the solving screen in
each method (oll 27 -> pll t; "zbll s 34" with the two-look alternative;
"coll s 5"), the OLS pick at a Winter Variation last pair.

## Complete search

Design (README "Complete search"): the engine lists every face-turn
solution within the limit (`COMPLETE_ENGINE_CAP` 3M only guards runaway
settings); `SpellingSearch.topSpellings` finds exactly the best N of each
RESULT_VIEWS filter among all spellings of all of them; calls of one step
type share the N-th best (`typeLimits`, a big call waits for its type's
smaller calls), and `trimToTypeBest` keeps exactly the best N per type and
view at the end. Big calls (> 12,000 solutions) are ranked in chunks on the
worker pool (`completeChunks`, solutions that end alike together).

The bound (spelling-search.js header): cost ≥ C0 + Σ tokens (penalty +
natural·bits + least MCC of the token) + look. C0 = least start time of the
committed path's MCC checkpoint. Per-token least MCC from algSpeed's cases
(`mccMinimum`; R quarter turns may get 0.5 back, the first of a same-axis
pair may add nothing). The remaining moves are bounded by a DP over (moves
left, frame, context flag) (`boundTable`): exact trigram bits for plain
runs; after any other written token (wide, rotation, split quarter) the
next token's bits are MIN1 plus `AFTER` (the least extra any first token of
the next move has after that token). Rows depend only on the last moves +
2 of context, so solutions sorted by their endings share rows.
(Thirty-first pass: five flags -- a wide turn's own token and the plain
token after it are tracked exactly, `wideLanding` -- and the last rows stop
early against the solution's forward rows; see "Where we left off".)

Thirty-first pass: the jobs of a step type share their limits while they
run (worker pools): `enumerate` is a generator that pauses about every
100 ms (`opts.pauseMs`); `topSpellingsLive` posts `TopViews.snapshot()`
(key, TPP, view mask of every kept candidate) and tightens with what comes
back (`TopViews.tighten`). The page (`liveHooks` in searchCurrentNode, the
pools' `{ id, report }` / `{ id, limits }` messages) answers with, per view,
the N-th best among finished calls, every running job of the type (each key
once) and the seeds. A big call's chunks start once every big call of its
type has its seeds (`seedReady`). Tested: two live jobs together equal brute
force (spelling-search.test.js).

Thirtieth pass (every change verified by identical result lists on the
captured root calls and later-step calls, plus the brute-force tests):
- First steps have no mid-step rotation (user rule): `rowOptions(noMid)`,
  AFTER's rotation-used half, walks start with r = 1.
- Slack, measured (`slack.js`-style: every spelling of 12-40 sampled
  solutions, brute force): best real cost minus the bound ~31 units at a
  root xcross, ~27 at a later single pair; MCC's share only 4.1 / 2.5.
  The rest is the DP's relaxation: after a wide/split token the next
  token's bits are its least after anything (+AFTER), and the bound picks
  spellings that use that everywhere. The plain spelling itself is
  often the true best.
- `exactTable`: DP over (move, frame, last two written tokens); states are
  enumerated locally from the last two moves (rows still shared by
  suffix), grouped by (frame, last token) so each option's context-free
  part is computed once; written flat (closures cost 1.5x). No
  rotation-used state; later steps' rotations before a move are U states.
  ~8 us per root row (cheap table 2.7), ~43 later. Root xcross: walk
  nodes 2.8M -> 0.27M, solutions walked 17k -> 3.5k.
- Where it pays: first-step calls that solve a pair (cheap MITM first,
  exact for the rest, walks exact). Not for plain crosses (64k solutions
  whose walks end early: exact 4.2 s vs cheap 3.0-3.5 s) nor later steps
  (rows dominate: +27%); both keep the cheap table and AFTER walks.
- The exact table stops early when, frame by frame, the cheap forward
  rows of the first moves (memoised for the MITM) plus the exact row
  exceed the budget: exact rows -33%.
- Removed: the first-token tier (`afterBound`, K rows, GRP). In Chrome
  its call site ran 3-4x slower than in Node (profile: 3.2 s of self time
  on the call line in one worker); the browser's hardest first step went
  17.6-23 s -> 10.2-10.9 s when it was replaced.
- With the final type-wide limits given up front, the xcross calls take
  only 16% less: the cost is per solution, not late limits.

Twenty-ninth pass (speed; every change verified by identical result lists
on captured real calls -- 6 later-step/cross captures and the 11 calls of a
root search -- plus the brute-force tests):
- The table above replaced an exact-context one (memo per written token,
  rotation-used state): ~8x cheaper per row, looser (passes 8.6% vs 3.6% of
  a later step's solutions, 12.5% vs 2.5% of root crosses), but walking
  with it is faster: a 166k-solution later call 70 s -> 11 s.
- (Replaced in the thirtieth pass by the exact table.) First steps
  (`opts.root`) add a second tier: rows that keep, per frame,
  the least rest-of-step cost by the move's first token (`afterBound`:
  the exact first-token choice after a known token). Nearly as tight as the
  old exact table (2.6% vs 2.5%), ~2x the plain row; only for solutions the
  plain table cannot rule out, and their walks use it. Root calls -23% CPU.
  At later steps rows dominate and the second tier costs more than it saves.
- Meet in the middle (`forwardStep`): the plain table's DP forwards over a
  solution's first moves, memoised by prefix, plus only the last 5
  backward rows (shared by suffix) bound a solution; the rest of its table
  only if it is walked. Equal to the full table's root at every cut
  (tested). Backward rows 1.05M -> 0.44M on the 166k call; 0-12% faster
  (rows were no longer most of the time).
- Seeding: the plain spellings (every y-family lead) of the 2N
  best-estimated solutions are scored before any walk, so the N-th best is
  tight from the start (exactly scored spellings -25%).
- Planning features of the four end rotations in one pass
  (`planFeaturesY`): ~10% per later step.
- Browser pools: 1 engine worker (2 from 8 threads), the other threads
  (cap 12) rank; a queued call's type limits are refreshed when a worker
  takes it (calls of its type finished meanwhile): hardest first step
  29-32 s -> 25.5-27 s (Node), identical lists. A big call's seed results
  count toward its type's N-th best for the other calls until it is done
  (never for itself or twice): -> 24 s.
- Later steps: with three pairs committed the engine is most of a step
  (its calls run one after another on the one engine worker; a 4-pair
  multislot goal took 3 s of a 7.7 s step). Single-pair calls now start
  before multislot ones (hidden by default, always searched): the rows a
  solver sees are final at 3.9 s instead of 7.7 s; the step still ends at
  ~8 s. A second engine worker: 6.7 -> 5.7 s on one scramble, no change on
  another (its tables were cold in the Node harness); not changed.
- Order matters a lot: ranking a type's calls one after another, biggest
  first, each starting with the N-th best of the ones before, costs a
  third (xxcross) to 60% (xcross) of ranking them independently
  (single-threaded replay, identical tops). On the pool this was tried as
  "prefer a call whose type has nothing running" (no gain: idle workers
  take the blocked calls) and strictly (idle workers: +15-25%); rejected.
  Also rejected: one chain job per type with several calls (one worker,
  biggest first, limits carried over): hardest first step -11%, the
  typical one +13% (the chain loads one worker while the other idles).

Order of work (`enumerate`): a cheap estimate of each solution's plain
spelling picks 256 to walk first and 2N to seed; then every other solution
in suffix order, bounded as above and walked at once if the bound fits.
Exact either way: each solution is walked or its bound exceeded the N-th
best when it was checked.

Known exclusion: spellings whose turns cancel (`L' l r` for `R`) are not
generated; the old pro-move-set engine produced some.

Verification: `test/spelling-search.test.js` (best N of every view equal
brute force, first and later steps, shared rows; physical spellings; bound
≤ real cost; known spellings generated); `complete-search-e2e.js` (old
top-25 rows within the limits all present: 0 missing over 8 steps;
thousands of results replayed, all exact).

Things that did not help (do not retry as is): stopping a solution's bound
early once its ending alone is too costly (an ending is almost never too
costly alone; with a per-move lower bound for the moves not reached yet,
3% fewer rows); a prefix-shared walk without the per-solution DP (5x more
nodes); the first-token tier at later steps (+5%); an MCC bound inside
walks via algSpeed's `stopAt` pause (round start time + least increments:
leaf slack 5.5 -> 2.2 units, but at walk nodes it pruned 3%; with each
running grip test's time at the end of the written tokens it pruned half
the nodes it was tried on, yet walk nodes only fell 12.4M -> 10.8M and the
algSpeed calls made the call 25-50% slower); FIFO instead of
biggest-first ranking-job order (+5-10%).

## alg_speed tuning

Cost of a path = MCC(path) + Σ stepPenalty(step) + pair_choice(cube left);
stepPenalty = weights × (`D`, `F`, `B`, wide `r/l`, wide `u/d/f`, slices,
mid-step `y`) + `natural` × algSurprise (Kneser-Ney trigram LM over move
tokens; corpus `HUMAN_F2L_ALGS` + `js/pro-steps.js`, left-right mirrored;
leading rotations dropped, mid-step rotations are tokens). Same function at
every step.

**Twenty-ninth pass: tuned on the complete search's own lists** (user:
rankings got far worse with the complete search; loss always on pro
solves, including how often each move type is in the top result vs the
pro's step). `tune-alg-speed.js cpools`: for every pro step, a SolveSession
at the pro's node runs the app's complete search restricted to the edge
solving the same physical pairs (best 300 of the default view, corpus
candidates included) and stores each alg with its pair-choice feature
vector (checked against the app's own TPP). The pro's step is ranked
against that list (censored at 301). Built with the naturalness model the
solve is scored with (out of fold). ~25 s per solve with both cores
(`--solves 150 --shard k/2`, ~1 h for 319 solves). Pools are scratch data.

Loss (`fit`): mean log10 rank of the pro steps + λ × move-type gap. The gap
compares, separately for first and later steps, the share of the app's top
results containing each move type (wide, wide r/l, wide u/d/f, slice, D, F,
B, L, half turn, mid-step y, mid-step x/z, leading rotation) with the
share of pro steps, Σ (a−b)² / (p(1−p) + 0.01), plus (turns gap / 2)². The
coordinate search only changes a value for a gain > 0.002 (`--min-gain`;
smaller gains were noise in weakly identified weights). Pair-choice weights
(look + planning) are fitted with alg_speed (`look_*`, `plan_*`).
`--fold k/K` holds out the training solvers' solves by hash (CV); `eval
--explain` splits pro-vs-top cost differences by component.

λ by 2-fold CV over both solvers' solves (held-out mean log10 rank of
Yiheng / Xuanyi / references; first-step move-type gap):

| λ | Yiheng | Xuanyi | refs | mean | gap |
|---|---|---|---|---|---|
| start | 0.651 | 0.789 | 0.549 | 0.663 | 0.81 |
| 0 | 0.578 | 0.750 | 0.526 | 0.618 | 1.05 |
| 0.05 | 0.581 | 0.767 | 0.543 | 0.630 | 0.74 |
| **0.1** | 0.587 | 0.760 | 0.524 | 0.624 | 0.66 |
| 0.2 | 0.615 | 0.784 | 0.519 | 0.639 | 0.58 |

Fit on all 300 reco.nz solves (both solvers), λ 0.1: rotation 6.86 → 4.8,
B 5 → 3.5, wideRL 1.15 → 2.3, wideUDFB 4.31 → 3.02, natural 0.84 → 1.68,
look trapped edge 0.2 → −0.8, plan open back slot 0.54 → 2.54 (everything
else unchanged; turns / mid-step x/z penalties offered, stayed 0).

| (pro step's rank in the app's list for its goal) | before | after |
|---|---|---|
| reco.nz, both solvers (fit), mean log10 rank | 0.694 | 0.646 |
| … first steps top 10 | 21.1% | 26.8% |
| … later steps top 10 | 91.4% | 92.4% |
| pro_references (held out), mean log10 rank | 0.521 | 0.454 |
| … top 10 (first steps) | 81.8% (42.1%) | 81.8% (42.1%) |

Move types, first steps (top result vs pros): wide 54% → 45% (pros 46%),
B 7% → 13% (16%), half turns 60% → 65% (74%). Later steps: the top result
started with a free y 32% (pros 18%) and rotated mid-step 9% (pros 17%):
the naturalness model dropped a leading rotation but charged a mid-step
one. **Fixed** (same pass): the LM scores a leading rotation like any token
(`naturalTokens`; the inspection is never part of a first step's alg). The
complete search's bound tables use `TRIL` at later steps (a start context
also covers a written y / y' / y2: least over the four) and the walk
scores the lead token. Pools rebuilt: later steps top 10 92.4% → 93.8%
(log rank 0.289 → 0.259), move-type gap 0.256 → 0.087 (leading rotation
21.7% vs 18.4%, mid-step y 13.2% vs 16.9%), first steps 26.8% → 28.5%,
references top 10 81.8% → 86.4% (log rank 0.454 → 0.458). A refit on the
new pools moved only the open-back-slot weight (2.54 → 3.54, +0.0035):
kept as is.

Where pro first steps lose (`--explain`, before the fit): naturalness +5.9
units vs the top result on average, MCC +2.7, the pair-choice bonuses for
crosses that happen to connect a pair +4.2 (pros do not plan that in
inspection).

Rejected: refitting the planning-off look weights (PAIR_CHOICE_LOOK) on pro
solves (objective −0.01, references top 10 83% → 79%); λ 0 (best ranks but
the move-type gap grows).

Earlier (capped pools, twenty-sixth pass): fit on Yiheng Wang only, the
`pools` command (pro's length + 2, ≤ 5,000 engine solutions, the old
spellings, 300 best + 700 sampled). Its table and method:
`git show 22e60f7:PROJECT_STATUS.md`.

To retune: `node tools/tune-alg-speed.js cpools --solves 150 --shard 0/2
--cache a.jsonl` (and 1/2 into b.jsonl), then `fit --cache a.jsonl,b.jsonl
--train "Yiheng Wang,Xuanyi Geng" --fit <keys> --lambda 0.1` and `eval`.
After changing the data, `node tools/tune-alg-speed.js corpus` regenerates
`js/pro-steps.js`. Rebuild the pools after changing the search or the
weights a lot (the lists are the best 300 under the weights they were
built with).

Rejected or not worth retrying:
- Pairwise speed comparisons by the developer (twenty-third to twenty-fifth
  passes): too few answers, a flat per-turn cost fitted on them made the top
  results less ergonomic. Removed.
- Negative per-move weights (made `U` padding cheaper); first-step-only
  values (the README requires one function for every step).

## Pair choice tuning

Model: `pair_choice` = Σ w_k × count_k over the unsolved pairs of the cube a
path leaves (`pairLookFeatures`: trapped corners, trapped edges, lone
pieces home, pairs with both pieces in U, connected pairs in U; unchanged by
y rotations, so every spelling of an alg shares it). Added to the path cost
once (not per step), 0 when F2L is solved.

Data (`pair-choice.js data`, ~1-2 min per scramble, 1,000 solutions per
call, white, xcross + xxcross, multislots): random-state solves; at every
step the 3 best candidates of each target node plus the top 10, each
labelled with its 2-step look-ahead TPP (a real search of its next step);
then one of the 3 best by label is committed. Data files are not in the
repo (scratch; regenerate with seeds 1-4, 50 scrambles each).

Fit (`fit`): listwise loss = expected label of the first-ranked candidate
under a softmax of the adjusted TPPs (temp 0.3), l2 0.002; 5-fold CV by
scramble. Metric: regret = label of the first-ranked candidate − best label.

| model (held out, 435 steps, 134 scrambles) | regret all | first steps | later steps |
|---|---|---|---|
| none (alg_speed alone) | 0.300 | 0.590 | 0.169 |
| solved-slot values only (y-invariant; frame-relative the same) | 0.297 | 0.592 | 0.164 |
| look features only (**app**) | 0.222 | 0.398 | 0.143 |
| look + y-invariant slot values | 0.209 | 0.384 | 0.130 |

Top-1 (the look-ahead's best candidate ranked first): 52.9% → 58.4%.

Solved-slot values ("back slots first") do not generalise: a step may start
with a free `y`, so which slots are open hardly predicts the next step's
cost. With look features they add noise-level gains and hurt the pro check
below at first steps (they push plain crosses down), so the app has only
the 5 weights: [0.54, 0.78, 0.45, -1.43, -5.66]. Unregularised fits blow up
(connected −12, slot values ±8) for little gain.

Independent checks (no pro data in the fit):
- `pair-choice.js pro` / `proeval` (134 Xuanyi Geng solves, 357 steps): the
  pro's pair choice (which physical pairs a step solves) ranked first among
  the app's choices: later steps 60.9% → 65.1% (MRR 0.779 → 0.802), first
  steps 19.7% → 14.8% (MRR 0.394 → 0.367): the look-ahead prefers first
  steps that pros do not plan in inspection. Kept for every step anyway
  (README: one function for every step).
- `tune-alg-speed.js eval --look app` (the pro's step among same-goal
  alternatives, mean log10 rank): Xuanyi Geng 0.597 → 0.564, Yiheng Wang
  0.520 → 0.504, references 0.347 → 0.338; first steps clearly better
  (Xuanyi 1.261 → 1.142, top 10 45% → 52%), later steps slightly worse
  (0.274 → 0.282).
- Post-processing cost: not measurable (features once per luck-checked
  alg, ~3 µs).

To refit: run `data` shards, `features` (only for files from before the
path was recorded), then `fit --data a,b,c,d` and copy the last 5 printed
values into `PAIR_CHOICE_LOOK`.

### Pair planning (twenty-eighth pass)

User task: whole-solve continuity (the top result at every step gave 2+
rotations and front slots first), built around EO, learned, no rigid
filters, togglable for beginners. `planFeatures` (facelet-flags.js), of the
unsolved pairs **in the orientation the cube is held in** after the step:
bad / good U-layer edges (top sticker of a front/back colour = good), bad
middle-layer edges, open back slots. Verified: a y swaps good/bad U edges
and keeps middle ones; `R U R'` leaves a good edge, `F' U' F` a bad one.
Fitted with the look weights on the same 2-step look-ahead data (the
twenty-seventh pass's 435 steps, features recomputed from the recorded
paths; `pair-choice.js features`, `fit --model none+look+plan`):

| model (held out, 435 steps) | regret all | first steps | later steps | top-1 | pair top-1 |
|---|---|---|---|---|---|
| look only (planning off) | 0.222 | 0.398 | 0.143 | 58.4% | 68.3% |
| look + plan (**app default**) | 0.211 | 0.377 | 0.136 | 60.5% | 71.0% |

In sample 0.205 (small gap: 4 extra weights). Weights: plan [0.6, -1.59,
0.78, 0.54], look refitted [0.4, 0.2, 0.24, -1.4, -5.58]
(`PAIR_PLANNING`). In the complete search the plan cost is per solution
per end rotation (`lookByEnd`), so spellings that end rotated differently
rank differently; in the old path it is computed from the cube as written.

Continuity (`tools/continuity.js --scrambles 30 --seed 101 --max 1000`,
capped search for speed, same ranking; top result committed every step):

| planning | rotations/solve | rotating steps | first two pairs both front | bad U edges left/step | solve TPP |
|---|---|---|---|---|---|
| off | 1.17 | 33.3% | 23% | 0.72 | 9.477 |
| on | 0.93 | 25.7% | 20% | 0.53 | 9.370 |

Not done: the pro check (`pair-choice.js pro`/`proeval` needs regenerated
data with plan features; the old file has no algs), and a visibility
("back slots first") preference beyond what the look-ahead labels price:
the fitted open-back-slot weight is mechanical, and "both front first"
only fell 23% → 20%. Fitting slot order on professional choices is the
next lever (avoid the twenty-seventh pass's trap: pros' first steps are
not look-ahead optimal).

## Traps (verified the hard way)

- Verify cube-state claims physically (facelet replay, cross-checked against
  `magiccube`); never hand-derive rotation algebra. A check that compares a
  candidate with its own claim cannot see a wrong-frame node.
- A whole-cube rotation goes through the engine's `rotation` option; the
  committed path goes in as `postAlg` with the `y2 y2` boundary
  (`POSTALG_BOUNDARY`), never pasted into the scramble.
- Engine slot indices: `0=BL, 1=BR, 2=FR, 3=FL`. Colour → rotation: white
  `z2`, yellow none (`COLOR_ROTATIONS`).
- Raw pseudo results are solved only up to a free trailing `D`; always
  `alignPseudoAlg`.
- The engine prunes moves that leave all goal pieces in place; `setNoopMoves`
  allows `U` turns. Adjacency pruning spans the postAlg boundary (hence
  `y2 y2`, not `y y'`).
- After any engine rebuild: compare `engine-battery.js` outputs, record the
  change in THIRD_PARTY_NOTICES.md, bump `ENGINE_VERSION` (browsers keep the
  cached .wasm). After any JS change tested in a browser: bump the `?v=`
  cache-buster in index.html / solver.html (not on
  `crossSolver/solver-helper.js`, which reads its own URL).
- Plain `<script>` files share one global scope: no duplicate top-level
  names (`test/browser-globals.test.js`).
- Search memo keys use the committed steps, not the joined path text (step
  penalties depend on step boundaries).
- Pro steps are in the LM corpus: never quote in-sample ranks of pro steps.
- `canonicalizeForEngine(rot, alg)` returns `{ rotation, moves }` as
  "rotation, then moves": the face turns are in the frame the alg ENDS in.
  The face turns in the starting frame are
  `relabelAlgForRotation(moves, inverseRotation(rotation))`.
- The complete search ignores `maxSolutions` for matched calls: a test that
  wants a quick search sets small limits (`test/fast-limits.js`).
- The browser engine worker used to post one message per solution; with
  hundreds of thousands per call that was most of a browser step (fixed:
  batches). Measure browser and Node on the same scramble before blaming
  the browser: scrambles differ by 3x.
- `pgrep -f "<script> data"` inside a wait loop matches the loop's own
  command line: wait on a PID or a file instead.
- zsh does not word-split `${X:+--flag $X}`: pass flags explicitly.
- The dev machine has 2 physical cores: timings are noisy; alternate A/B
  runs, kill leftover headless Chromes.
- Typed half turns `X2'` must reach the engine as `X2` (solve-editor.js
  normTok): a postAlg with `U2'` hung the next step's search.
- Headless Chrome caches solver.html and scripts even with new `?v=`:
  drive it with `Network.setCacheDisabled`.
- After rebuilding `data/ll/*.json`, bump `DATA_VERSION` in
  js/alg-sets.js (both pages fetch the sets with it as the cache-buster).
- Background generator runs: kill them by PID, never `pkill -f` a
  pattern (it took down another run's llgen), and check for orphaned
  `llgen` processes after an interrupted shell (one ran unseen for an
  hour, halving every timing).
- GitHub Pages: after `git push origin master:main`, check
  `api.github.com/repos/hamnerrc/cube-tree-search-engine/actions/runs` and
  compare live file hashes before judging live performance.

## Open

Done (developer, thirty-second pass): solver optimisation and speed
(searches far below the goals on an iPad Air 5), and the rankings. Items 1-4
and 6-8 below stay as the record of where those stood; no further work is
planned on them unless the developer asks.

0. **Visual redesign** -- DONE (thirty-fifth pass, from UI_references/).
   Waiting on the developer: captions.js copy, tree-searcher art, bracket
   thresholds.
00. **Alg sets** -- built (thirty-seventh pass). For the developer's audit:
   the ranking of generated against community algs cannot be checked on
   votes (A perms: x R' U R' D2 R U' R' D2 R2 x' ranks ~14th behind RU+D
   algs; H and Z: RU algs ahead of the M-slice ones, which MCC itself
   rates faster -- the slice penalty, fitted on the votes, decides); the
   new captions (`algs.*`, `searcher.ll.*`, `reason.ll.*`, `critique.ll.*`,
   `info.lastlayer.*`) are drafts. Levers if wanted: more move sets or
   slack for ZBLL (RUF slack 1 found ~12 solutions per case), trailing
   rotations free after the last alg of a solve, a vote-weighted pick
   among near-equal algs. Not built (not asked): other sets (1LLL, OLLCP,
   EOLL, WV-only pages), a last-layer move in the F2L search itself.
1. **Speed** -- DONE (user goal, thirtieth/thirty-first pass: ~10 s per step,
   optimality kept). Browser, this 2-core machine: xcross + xxcross every
   step <= 8.5 s; default settings (cross only) first steps <= 4.1 s, later
   pairs <= 12.9 s, the first pair after the cross 6.9-26.3 s (the slow case
   left). That step: ~5-6 s of single-pair engine calls (one engine worker;
   two workers measured no gain in Node), then ranking ~420k solutions with
   the type's final limit almost from the start: per solution ~1.7 cheap
   MITM rows + ~0.8 forward rows (5 flags, ~5.9 / ~11 us), ~8 us of
   preparation; ~7% are walked. Next levers: preparation during the engine
   phase (seed jobs could prepare every solution of their call and hand the
   chunks typed arrays: ~10% of that step); the remaining bound slack is
   mostly mid-step rotations (no rotations: 6.6% -> 3.0% walked; walks are
   now cheap); the single-pair engine calls themselves (C++). Older levers: exact rows are still ~7 per root pair
   solution (an exact meet in the middle would share prefixes, but its
   forward memo is ~3 KB per prefix); per-solution work before ranking
   (luck check, pair-choice features: ~23 us x 65k crosses; engine order
   is DFS, so an incremental replay could share prefixes); the multislot
   engine search itself (now split and stoppable, but 1.2-5 s of engine
   time per call: a stronger admissible bound needs cross + two pieces,
   ~109 MB per table; a combined search of a step's 2-3 multislot goals
   from the one start state would share most of their trees -- engine C++
   work); small calls that must fill 300 results per view from a few
   solutions (~1 s each at the root).
2. **Ranking:** first steps' remaining misses are mostly longer pro steps
   (planning), not speed; later steps' rotation placement now matches pros
   closely (21.7% / 13.2% vs 18.4% / 16.9%).
3. **Search coverage:** 89.7% of pro later steps and 66% of first steps
   are in the complete search exactly as written; the rest are longer than
   the limits (single pair 10, first steps 9-11), use slices, or rotate
   twice mid-step.
4. **More tuning data:** more solvers from reco.nz (`node tools/reco.js
   fetch <raw.json> "Name"`, then `convert`, `corpus`, `cpools`, `fit`).
   The naturalness model is strongly solver-specific (an LM trained on
   another solver: mean log10 rank 0.62 → 0.77).
5. **Visual redesign**: done, see item 0.
6. **Pair planning:** checked (twenty-ninth pass) on 80 reco.nz solves the
   tuning pools did not use, the app's full search at every pro node (best
   5 per pair choice, re-scored offline): the pro's pair choice ranks first
   at 28.0% of first steps (22.7% with the weights from before the pass)
   and 62.8% of later steps (64.2%; MRR 0.788 vs 0.792). The open-back-
   slot weight on that data: later steps prefer 0.54-1.8 (66.4% first),
   first steps 2.5-3.5 (28%); overall MRR 0.671-0.678 for 1.5-2.5 (noise
   level), same-goal metrics flat over 1.5-2.5: kept at 2.54. Tool:
   `tools/pair-choice-pro.js collect|eval` (the app's search at every pro
   node, best 5 per pair choice with features, re-scored by any checkout;
   ~1 min per solve; data in scratch).
7. A later step searched as the first call of a fresh browser worker once
   showed fewer results than Node (tenth pass, never reproduced).
8. **Worst case** -- DONE (every option on): measured with
   `worst-case-bench.js --depth 1 --budget 0 --post 2 --workers 1`: all 6
   colours, xcross / xxcross / xxxcross, pseudo F2L, multislots, first
   step 44.4 s cold (thirty-first pass; 57.9 s in the twenty-ninth; prune
   tables built during it), warm searches worst 38.8 s, on this 2-core
   machine, inside the README's minute; look-ahead on top is not. The search time
   limit (`SolveSession.timeBudgetMs`) still exists for tools but is no
   longer on the configuration page and does not cut the complete
   search's ranking.
