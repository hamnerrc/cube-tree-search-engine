# cube⑂tree — Project Status (Working Document)

*Last updated 2026-10-07 (twenty-fourth pass).*

This document is the **mutable working record**: what actually exists in the
repo right now, what has been verified, what's broken or missing, completed
fixes, the active roadmap, and known deviations from the spec. It changes as
development changes the project.

The **authoritative product specification** lives in
[cube_tree_website/README.md](cube_tree_website/README.md) — what cube⑂tree
is supposed to do, independent of what the code currently does. When this
document and the README disagree about *intended* behavior, the README wins;
this document's job is to track the gap and close it, not to redefine the
target. Bug lists, implementation status, and roadmap detail belong here, not
in the README.

## Quick orientation (read this first if you're new to the session)

**WHERE WE LEFT OFF (2026-10-07, after the twenty-fifth pass):** read this first.
- Follow-up (user, same day, then push): new search defaults -- first-step
  move limits cross 9, xcross 10, xxcross 10, xxxcross 11 (were
  10/11/12/13; `DISTANCE1_LIMITS`), solutions per search 10,000 for every
  type (page field was 500 with max 5000, now 10000 / max 20000; bridge
  `DEFAULT_MAX_SOLUTIONS` 20 -> 10000). Saved settings with the old default
  500 migrate to 10000 (`CRITERIA_VERSION` 3, like the time limit's 60).
  Cost, measured (Node, 6 random-state scrambles, xcross + xxcross +
  multislot, no pseudo): first step 3.0 s -> 18.3 s mean (max 22.8),
  later steps 0.65 -> 4.7 s (max 13.2); ~370k first-step candidates.
  Headless Chrome: first step 20.8 s (286k results), second 3.7 s, no
  errors. With pseudo / every colour / look-ahead it will be slower; the
  README 1-minute worst-case goal needs re-measuring
  (`tools/worst-case-bench.js --max 10000`). Cache-buster 20261007c.
- Twenty-fifth pass (user: the ranking got worse after §4.46, the top
  results are far less ergonomic; find a better algorithm, be creative,
  revert only as a last resort). Writeup: §4.47.
  1. **Diagnosis** (real engine, 30 random-state scrambles, 92 full result
     lists re-ranked offline): §4.46's flat 0.5 per turn pushed short but
     awkward algs up (`R U2 F U' F' R'` over `y' U R' U' R U2 R U R'`;
     `U L2 z' U f U' L' U2 F' D'` into a first-step top 3). Both versions
     share the deeper gap: MCC prices each finger movement on its own, not
     how familiar the sequence is.
  2. **Naturalness model** (`algSurprise`, `buildNaturalnessModel` in
     js/script.js): an interpolated Kneser-Ney trigram language model of
     cube moves, trained on standard human F2L algs (`HUMAN_F2L_ALGS`,
     168 algs + mirrors) and the 66 pro steps (`PRO_STEP_ALGS`, x3).
     `STEP_PENALTIES.natural` = 0.15 x surprise in bits replaces `turn`.
     Pro benchmark (held out per solve): mean log10 rank 1.170 -> 0.967,
     top 10 37 -> 43, top 500 58 -> 60. Comparisons (10-fold CV): held-out
     strict accuracy 73.2% -> 76.8%.
  3. `tools/pro-ranking.js` now scores each solve with a model trained
     without it (`--in-sample` for the app's model).
  Next: more answers (7b); the remaining unergonomic tops are mostly a
  search-coverage gap (the list has no natural alg at all) -- see §4.47
  "Not done".

**Previous handoff (2026-10-07, after the twenty-fourth pass):**
- Twenty-fourth pass (user: commit my answers, tune alg_speed on them as
  one step-independent function without overfitting, never a wide B, push,
  then wait for more data). Writeup: §4.46.
  1. **Data:** the developer's 101 answers committed raw (333a750), then
     the 14 involving a wide `b` deleted (user request; in all 14 the `b`
     alg had been judged slower): 87 answers, 81 pairs (56 strict, 25 too
     close), 4 skips.
  2. **Never a wide B** (`hasWideB`, solver-bridge.js): dropped in
     postProcessCall's `push` and in `dedupeSolutions` (end of every
     list); `wideSpellingParts` makes none. Real engine, 6 scrambles incl.
     pseudo: 31,272 rows, 0 with `b`. The comparison tool never shows one
     (`indexPool` skips them); pool rebuilt: 308 lists, 16,635 algs, 0 `b`.
  3. **One scoring function for every step:** `stepPenalty(alg)` has no
     first-step values any more (`wideRLFirst`, first-step u/d/f/b gone);
     new `STEP_PENALTIES.turn` = 0.5 per face/wide/slice turn, from the
     comparisons (`tools/fit-alg-speed.js`, CV). Answered pairs ordered
     right: 27/56 -> 38/56. Pro benchmark (secondary): mean log10 rank
     0.929 -> 1.098, top 10 39 -> 37, top 500 59 -> 58; coverage 44/66
     unchanged.
  Next: wait for more answers (7b continues); refit with
  `node tools/fit-alg-speed.js` (CV per lambda / parameter set) when there
  are a few hundred.

**Previous handoff (2026-10-06, after the twenty-third pass):**
- Twenty-third pass: **roadmap 7a done** -- the pairwise speed-comparison
  tool exists and is ready for the developer (7b). Writeup: §4.45. Tree was
  clean at the start, all suites passing; no app code changed.
  - `node tools/pair-compare.js` (in `cube_tree_website/`): one pair at a
    time, `a`/`b` faster, `=` too close, `s` skip, `u` undo, `c` context,
    `q` quit. `stats` and `export [file]` subcommands; `pool` rebuilds the
    candidates (~10 min, real engine).
  - Logic in `tools/pair-compare-lib.js` (votes, tie classes, cycles,
    transitive closure, derived comparisons, pair selection), unit-tested in
    `test/pair-compare.test.js` (17 tests).
  - Candidate pool `data/speed_pool.json` (committed): 326 real result lists
    (80 random-state scrambles, every stage incl. pseudo + all 66 pro
    steps), 17,567 distinct algs. Answers go to
    `data/speed_comparisons.jsonl` (append-only; created on first answer).
  - Simulated judge on the real pool: 1441 direct answers -> 5633
    comparison points (~3.9x); selection ~40 ms per question.
  Next: 7b is the developer's (collect answers for ~1 week; commit the
  `.jsonl` now and then). 7c (fit) after that. Item 8 still waits for the
  developer's design.

**Previous handoff (2026-10-06, after the twenty-second pass):**
- Twenty-second pass: **planning and documentation only, no code changed**
  (user request). Two strategy changes, now roadmap items 7 and 8 (§5):
  1. **alg_speed will be trained on pairwise human comparisons**, not on
     pro solves: a terminal tool (`tools/pair-compare.js`, planned) shows
     two algs the current model scores as close; the developer picks the
     faster one. Goal: a few thousand comparison points over about a week,
     multiplied by transitive inference, with pairs chosen by how ambiguous
     and impactful they are. Full design: roadmap item 7. Pro solves stay
     the search-coverage requirement and become a secondary ranking check.
     README: "Planned: training `alg_speed` on pairwise speed comparisons".
  2. **Visual redesign**: the developer designs the new look and layout;
     the agent only implements the developer's spec (no own visual
     direction). Roadmap item 8; README "Planned: visual redesign".
  Next agent work on item 7 = build the tool (phase 7a) when the user asks;
  item 8 waits for the developer's design.

**Previous handoff (2026-10-06, after the twenty-first pass):**
- Twenty-first pass (user task list: remove the "no R2/L2 after step 1"
  option, R2/L2 in the unorthodox rule by displacement, README vision for a
  step-independent alg_speed). Writeup: §4.44. Tree clean, all suites
  passing at the start.
  1. **"No R2/L2 after step 1" removed** everywhere (bridge, UI, HTML, info
     text, README, tests). The unorthodox filter replaces it. A saved view
     with `noR2L2` is dropped on load.
  2. **Unorthodox rule restated as signed displacement**: R +1, R' -1, R2
     executed towards the other side (+1 -> -1, -1 -> +1; from 0 it reaches
     +-2 = unorthodox). Same verdicts as the old mod-4 code (200k random
     algs, 0 differences) -- the old code already did what the user
     described; the rewrite makes the rule readable and tested on their
     example (`R U R2 U' R` orthodox).
  3. **README: "Future: one scoring algorithm for every step"** -- the
     step-specific first-step penalties are a stop-gap; one step-independent
     alg_speed is planned for later, once enough pro solve data exists;
     flagged as arguably the most important part of the site.

**Previous handoff (2026-10-06, after the twentieth pass):**
- Twentieth pass (user task list: wide-move spellings of F2L steps,
  "unorthodox" steps, exact duplicate rows, a wide-moves toggle and an
  unorthodox filter on the results page, clearer R2/L2 label, general
  usability). Writeup: §4.43. The tree was clean and every suite passed at
  the start (the nineteenth pass had finished and committed).
  1. **Wide-move spellings** (`wideSpellingParts`, facelet-cube.js): D -> u,
     U -> d, B/F -> f/b with the rest relabelled and a now-redundant
     rotation absorbed (`D y R U' R'` -> `u R U' R'`, `B U' B'` ->
     `f R' f'`). Built only from permutation tables; kept only if easier
     (fewer D/F/B/rotations, no extra F/B, one wide family, <= 2 wide
     turns, cross stays down). Later steps only (doubled root candidates),
     matched and pseudo. Later-step u/d/f/b now reach the first page
     (#5-#16 in probes). Every one replayed physically in
     `test/wide-spellings-e2e.js` (`--pseudo` for pseudo solves).
  2. **Scoring:** `STEP_PENALTIES.wideUDFB` = 2.5 after the first step
     (first step keeps 3.31 = `wideOther`). No pro solve uses u/d/f/b, so the
     benchmark is monotone; 2.5 is the lowest value that keeps the pro
     top-10 count. Versus the pre-pass benchmark: mean log10 rank 0.970 ->
     0.949, top 10 43 -> 44, top 500 60 -> 60. `pro-ranking.js --penalty
     name=v1,v2` sweeps step penalties.
  3. **Unorthodox** (`isUnorthodox`): R/L layer displacement mod 4 reaches 2
     (R = +1, R' = -1, R2 = 2; r = R, l = L; y/z family resets). Later-step
     candidates carry `unorthodox`; "hide unorthodox" filter (step + look-
     ahead); first steps never flagged.
  4. **Exact dedupe** (`dedupeSolutions`): one row per rotation + alg text,
     at the end of `rankCandidates` and of every merge. None were found in
     probes before or after; it is a cheap guarantee.
  5. **Wide-moves toggle** (results page, default on): off = engine without
     r/l, no wide spellings, `searchSettingsKey` gains `nowide` (root too).
     memoSearch's "wide twin": off on a searched step = that list filtered
     (no engine call); on where only the no-wide list exists = wide search
     merged into it progressively (rows never cleared). Browser-checked.
  6. **UI:** grouped controls (search / filter / look-ahead), hover hints on
     options and column titles, "N hidden by filters" in the status line,
     `R2/L2` keeps its case (`.moves`), filters and the wide toggle keep the
     rows on screen while they apply, info dialog rewritten.

**Previous handoff (2026-10-06, after the nineteenth pass):**
- Nineteenth pass (user task list: finish interrupted work, Cubedb export,
  UI polish toward release, background-tab reliability, anything else
  needed). Writeup: §4.42. The previous session had left only the user's
  Cubedb example link (end of `data/pro_references.txt`) uncommitted;
  all tests passed at the start.
  1. **Cubedb export:** `solutionLines`/`cubedbUrl` (solver-bridge.js),
     the user's example link rebuilt byte for byte
     (`test/cubedb-export.test.js`); real-engine round trip
     (`test/cubedb-export-e2e.js`); a generated link loads and parses on
     cubedb.net (headless Chrome).
  2. **Results page polish:** labelled solution panel (copy / cubedb /
     undo), progress bar and placeholder rows, error and empty states, tab
     title shows a running search, phone cards, primary button on the
     config page.
  3. **Bugs fixed:** stale result rows stayed clickable after a commit /
     undo / scramble switch (could commit a candidate of another step or
     scramble); an engine abort after a yield hung the search forever
     (now reported, the worker is replaced, the list is marked and not
     memoised); solver.html without a saved search sat idle.
  4. **Background tabs (measured, §4.42):** searches continue in hidden
     tabs; Chrome gives hidden tabs' workers ~3x less CPU (OS priority, not
     timers -- a MessageChannel engine yield was tried and made no
     difference, so it was reverted) and Energy Saver may freeze them; a
     frozen-then-resumed search finishes with identical results. Nothing a
     page can legitimately do about either; the tab title and info dialog
     now tell the user.

**Previous handoff (2026-10-05, after the eighteenth pass):**
- Eighteenth pass (user task list: look-ahead too slow, especially breadth
  10; wide moves gone from first-step results; other README issues).
  Writeup: §4.41.
  1. **Look-ahead bottleneck was the engine's rotation/wide spellings.** In
     piece terms a wide move is a face turn and a rotation changes nothing,
     so the pro move set's `r`/`L` children and x/x'/y/y' branches all
     re-searched the same subtrees: 93% of the nodes of a later-step call.
     New goal-DAG search in `crossSolver/solver.cpp` (memoised per
     (state, moves left), replaying the original DFS order and rules):
     **byte-identical output**, battery 47.9 -> 13.9 s, 281 recorded
     look-ahead calls 108 -> 17 s, last-pair calls 3.0 -> 0.27 s. Also the
     per-depth `solver_yield` timer (a fixed ~10-40 ms per call) is now
     throttled to one per 25 ms. `ENGINE_VERSION` 20261005-dag1.
  2. **Best-first look-ahead:** search ranks (`lookaheadFork`,
     `withRank` on gated engines, rank-ordered post-processing pool) run the
     best candidates' follow-ups first. Browser, depth 5 / breadth 10,
     default config: first re-ranked result ~6 s (was ~18 s), total ~15-16 s
     (was ~20 s). Multislot (xcross+xxcross): 52 s -> ~17 s total.
  3. **Now JS-bound:** post-processing (MCC of ~386k candidates) is ~2/3 of a
     depth-5 breadth-10 look-ahead on this 2-core machine; see §4.41 for
     what was measured.
  4. **Wide moves:** not filtered anywhere -- buried by the flat +2.35
     r/l step penalty (§4.35, commit 4a77e7c). First-step r/l now cost 1.2
     (`STEP_PENALTIES.wideRLFirst`, LOO-CV on the pro root steps). Pro
     benchmark (all 66 steps) mean log10 rank 1.035 -> 1.016, top 10 41 -> 42.
     New `test/wide-moves-e2e.js` (fails with the old value).
  5. README: stale "no-op moves" gap fixed; first-step penalty and
     best-first look-ahead documented.

**Previous handoff (2026-10-05, after the seventeenth pass):**
- Seventeenth pass (user task: make the solver dramatically faster, exact
  output). Writeup: §4.40. Every change was checked byte-identical (engine
  batteries, full result lists of recorded searches, browser row hashes).
  1. **Engine: Asyncify was instrumenting the recursive searches.** Only the
     once-per-depth `solver_yield` needs it; `ASYNCIFY_REMOVE` for
     `depth_limited_search`/`create_prune_table` (build flag only, source
     unchanged) makes every matched-engine search ~25-30% faster (battery
     65.8 → 52 s; multislot look-ahead calls 93 → 66 s serial).
  2. **Prune-table sharing + persistence:** new engine API
     (`tableCacheKeys/Get/Put`), worker messages and helper methods; the page
     hands a table one worker built to the others and keeps tables in
     IndexedDB per `ENGINE_VERSION`. Browser, xcross+xxcross root: first list
     on a repeat page load **3.6-3.9 s (HEAD) → 1.6 s**; later steps that
     needed new tables 1.6-3.1 s → 0.3 s. First-ever load unchanged (~5 s).
  3. **Post-processing off the main thread:** `processCall`'s per-candidate
     work is now a pure `postProcessCall(ctx, job, cores)`; the page runs it
     on a small worker pool (`js/postprocess-worker.js`), Node harnesses can
     too (`tools/node-postprocess-pool.js`, `worst-case-bench.js --post N`).
  4. **JS per candidate** (exact): interned MCC move strings (MCC 11.9 → 9.1
     µs/call), `applyAlgorithm` on typed buffers (one string per alg, not per
     move), cached wide-move lookups, cheaper splits. Root post-processing
     2.2-2.4 → 1.6-1.7 s on a recorded xcross+xxcross search.
  5. **Measured and not kept:** "cross + edge" bound in xxcross (warm -23% but
     +1.5 s on every cold page load, before table persistence) and in
     xxxxcross (no gain); MCC round tracing for rotation spellings (5% fewer
     grip simulations); scalar finger state in MCC (3%); LTO (0%).

**Previous handoff (2026-10-05, after the sixteenth pass):**
- Sixteenth pass (user task list: look-ahead speed, multislot as a results-page
  toggle, a "no r2/l2 after step 1" option, blank = no time limit, other
  concrete bugs). Writeup: §4.39. Summary:
  1. **Look-ahead was main-thread-bound, not engine-bound:** at depth 5 the
     page's JS thread was ~89% busy while the engine workers sat ~65% idle
     (a warm engine call is ~10-100 ms; the 300-400 ms per call seen earlier
     was workers waiting for the busy main thread). Fixed exactly (byte-
     identical results on a 12-list snapshot): MCC checkpointed after the
     committed path (`algSpeedPrefix`/`algSpeedResume`, 34 → ~12 µs per
     candidate), no partial re-ranking of searches nobody watches, cheaper
     rotation spellings/`netRotation`. Warm, 3 workers: default config depth 5
     17.0 → 8.9 s, depth 3 4.6 → 3.2 s. Multislot-heavy look-ahead stays
     engine-bound (a "last two pairs" multislot call is 4-11 s on its own).
  2. **Engine-call cache** shared by a session and its forks: matched calls by
     the cube state they start from (verified: same state → identical
     solutions), pseudo calls by exact input, only without a time limit.
     Multislot toggled on reuses the single-pair calls; a multislot and its
     two single-pair halves share their follow-up calls.
  3. **Results page:** "multislot" (default off; was a config checkbox) and
     "no r2/l2 after step 1" (later steps and every look-ahead follow-up are
     searched without R2/L2; spellings that relabel into R2/L2 dropped).
     New real-engine test `test/search-options-e2e.js`.
  4. **Time limit blank = no limit** (stored as null; 0/invalid also none; a
     stored 60 from before the change counts as the old default).
  5. **Bugs fixed:** the search memo key used the committed path's text, so a
     multislot step and the same moves as two single pairs shared one search
     and one of them showed the other's TPPs (a step-starting y is free,
     mid-step +3.70); the memo held 48 searches but depth 5 makes ~76, so the
     searches needed right after a commit were already evicted (now 200
     entries / 500k candidates); solver.html wrote the whole pruned tree
     (~1.7 MB) to localStorage under a key nothing reads, outside any
     try/catch (a quota or private-mode error stopped the page before its
     first search) -- removed; a missing time limit silently meant 60 s;
     a look-ahead replaced by another setting kept searching at active
     priority and its end flipped the indicator to "ready" too early.

**Previous handoff (2026-10-05, after the fifteenth pass):**
- Fifteenth pass (user task list: live-site speed, defaults, streaming,
  per-step look-ahead, pseudo filter, results table, minimalist UI,
  responsiveness). Writeup: §4.38. Summary:
  1. **Live site slow = stale deploy.** GitHub Pages was still serving
     faae44e (ENGINE_VERSION 20261004-pairs1): the deploy of c3e8eca sat
     "queued" on GitHub for 1.5 h, so the fourteenth pass's JS speedups
     (incl. the cross-opt rewrite, 41% of root time) never went live.
     Headless Chrome, same config: live 14.7 s vs local 5.5 s. Workflow fixed
     (be914d1: new concurrency group, cancel-in-progress) and deployed; live
     now 2.0 s to first rows, 7.6 s total, files match the repo. Check
     `api.github.com/repos/hamnerrc/cube-tree-search-engine/actions/runs`
     after every push (no `gh` CLI on this machine).
  2. **JS hot paths** (output byte-identical on an 11-search snapshot):
     precomputed mask checks in `isSlotSolved`, `applyPerm` via char codes,
     Map-based `isMoveToken`, rotation spellings relabel each token once and
     replay once per rotation. Warm root 8.1 → ~7 s, cold 13-15 → 11.6 s; the
     engine is now most of the time.
  3. **Progressive results:** partial ranked lists while a step's calls run
     (first rows ~1.3 s instead of 6.5 s in the browser), look-ahead
     re-ranks live. New `test/progressive-e2e.js` (real WASM).
  4. **UI:** pro move set + cross optimisation always on (no checkboxes);
     look-ahead and a "simple pseudo only" filter moved to the results page
     (filter == old simplified-pseudo DAG, verified exactly); 25 results per
     page with page-size box and pagination; no clipped columns (cards on
     phones); lowercase minimal style; info dialog next to the logo.

**Previous handoff (2026-10-05, after the fourteenth pass):**
- Fourteenth pass: the README gained a long-term goal ("worst-case search
  with all settings enabled must complete in under 1 minute"). Writeups:
  §4.36 (performance and the search time limit) and §4.37 (alg_speed on all
  19 pro solves). Summary:
  1. **Worst case measured** (`tools/worst-case-bench.js`: every colour,
     every advanced option, 500/call): one root search is 378 engine calls,
     roughly 3.4 hours of engine time. Pro-move-set XXXCross is 116-494 s per
     call and pseudo XXXCross 45-81 s, so per-call speedups alone cannot
     reach 1 minute.
  2. **Search time limit** (new setting, default 60 s): the engine checks a
     per-call deadline itself; calls start cheapest first, and late calls
     return what they found. Root search with every setting, browser (cold):
     **48 s** (was hours); Node worst warm step 56.5 s at depth 1, 45.7 s at
     depth 5. Default-config output is byte-identical (57,100 root results).
  3. **JS post-processing** was the next wall (530k candidates): rewrote
     `optimizeCrossSolution` (2^n masks → DFS; was 41% of the time), cached
     replay prefixes and `nodeByLabels`, and each call is post-processed as
     soon as it finishes. Root with a 20 s limit: 174 s → 67 s → within limit.
  4. **Engines:** pseudo pairs bound (heavy pseudo XXXCross 31.7 → 24.8 s), a
     cross+edge bound in matched XXXCross (no measurable gain, kept since it
     is cheap and exact), pseudo engine on a worker pool in the browser. Both
     binaries byte-identical on batteries (`tools/engine-battery.js`).
  5. **alg_speed:** penalties fitted on #1-#11 hold up out of sample on
     #12-#19 (later steps in top 10: 9/22 → 16/22). Refits on all 19 (several
     losses, an outlier-robust one included) do not beat them under CV, so
     `STEP_PENALTIES` is unchanged. Two tool bugs fixed (§4.37).

**Previous handoff (end of 2026-10-04, after the thirteenth pass):**
- All work is committed and pushed (GitHub `main`; the local branch is
  `master`, so push with `git push origin master:main`).
- Thirteenth pass: search performance (§4.34) and `alg_speed` per-step
  penalties fitted on the pro references (§4.35); both summarised below.
- **New data not yet used:** the user then added pro solves **#12-#19** to
  `data/pro_references.txt` (8 solves, committed in the handoff commit). They
  all parse and physically solve; `test/pro-references.test.js` was updated
  for them (19 solves; #13 starts with a plain cross step; #14 is yellow;
  #18's step labels say "cancel with...", meaning moves cancel across the
  pro's step boundary, and the segmenter merges those steps). **None of the
  benchmarks (§4.32/§4.35 numbers, 36 segments) include them.** They are a
  ready-made out-of-sample test of `STEP_PENALTIES`, which were fitted on #1-#11.
- Benchmark caches live outside the repo (they are big). Rebuild with
  `node tools/pro-ranking.js --app --sample 0 --cache <file>` (~4-5 min with
  the real engine), then refit or evaluate with
  `node --max-old-space-size=8000 tools/fit-step-penalties.js --cache <file>`.

**2026-10-04 (thirteenth pass): performance, root search 100 s → 5 s in the
browser, identical results.** Writeup in §4.34. The user also confirmed pro
solve #10's 4th pair on a physical cube: `y U2' L' U L U' L' U L`, which is
what the file already says since the twelfth pass (the uncommitted copy had
`L2`). The simulator agrees, so no simulator bug.
1. Engine (`crossSolver/solver.cpp`, rebuilt, `ENGINE_VERSION` 20261004-pairs1):
   shared "cross + corner" prune tables (up to 32 builds became ≤ 4 per move
   list), an admissible pairs-only bound in every F2L class, and a 5× faster
   table builder. Raw engine output is byte-identical to the previous binary on
   an 11-call battery.
2. Bridge: each search plans and starts all of its engine calls at once, then
   post-processes in plan order; `solver-ui.js` runs them on a pool of
   `cores − 1` (≤ 4) engine workers via the per-engine gates in
   `search-scheduler.js`. Look-ahead explores its candidates in parallel.
3. JS: table-driven rotation helpers in `facelet-cube.js` (5.0 s → ~0.4-2 s
   of post-processing per root search).
4. **Found and measured, deliberately not adopted:** the upstream engine's
   rotation-branch pruning uses `h >= depth` where a rotation consumes no move
   (needs `h > depth`), and it never explores a rotation followed by the last
   move. The fix gives a strict superset (all extras physically valid), but
   ~2× the raw solutions, mostly y-spellings the bridge already generates.
   That would crowd the per-call cap, and pro membership was unchanged; see §4.34.
5. **alg_speed tuned on the pros (§4.35):** per-step penalties for D/F/B,
   wide moves and mid-step y rotations, fitted with leave-one-solve-out
   cross-validation against where each pro step ranks in the app's real list
   (`tools/pro-ranking.js --app`, `tools/fit-step-penalties.js`). Pro steps in
   the top 10: 12 → 24/36 cross-validated (25/36 in production scoring), later
   steps 24/25. **Short of the 90% target:** root steps (XCross/XXCross from
   inspection) stay at 2/11; see §4.35 for why.

**2026-10-04 (twelfth pass): dynamic search priority, look-ahead depth, and
`alg_speed` tuned against the pro references; plus 4 new reference solves
(one typo fixed) and a segmenter frame bug.** Full writeups in §4.30-§4.33.
1. **Priority scheduling (§4.30):** new `js/search-scheduler.js` replaces the
   FIFO search chain. The active scramble's search starts immediately and
   pre-empts background searches at their next engine call; switching
   scrambles promotes/demotes. Headless Chrome, 5 scrambles: click → next
   step's results **83.4 s before, 7.0 s after**, identical result counts.
2. **Look-ahead (§4.31):** `searchWithLookahead` (depth 2-5, breadth
   default 5, inner breadth 2) re-ranks the top results by the combined TPP
   of the best follow-up sequence; settings + depth-3+ warning on index.html;
   TPP and look-ahead columns in the results table. Searches are memoised per
   session (`memoSearch`, shared with `SolveSession.fork()`), so committing an
   explored candidate is instant. `test/lookahead-e2e.js` re-derives every
   number against the real engine with fresh sessions.
3. **Tuning (§4.32):** new `tools/pro-ranking.js` benchmarks where each pro
   step ranks among the engine's alternatives. Single change:
   `pushMult` 1.3 → 0.8. Mean log10 rank 1.386 → 1.269 (tuned on #1-7:
   1.229 → 1.119; held out #8-11: 1.702 → 1.568); pro steps in the top 500:
   26 → 29 of 36. Raising rotation cost scored well on average but was
   rejected: it pushes down every pro step that rotates.
4. **Reference data (§4.33):** the user added solves #8-#11. #10's 4th pair
   ended `L2`; the only single-token edit that solves the cube is `L`, so it
   was corrected (flagged for the user). The segmenter compared slot names
   across a mid-step `y'` (#11) and merged three steps into one; it now
   compares in the segment's start frame (`afterStart`), which is also what
   the e2e harness passes the engine as the goal.

**Current state:** the core interactive solver loop works end-to-end (pseudo F2L included as of the sixth pass below; slow) and is
verified — both in a Node harness driving the real WASM solver and physically
checked with a real cube simulator (`magiccube`) — for matched (non-pseudo)
Cross/XCross/XXCross/XXXCross plus later single-pair/multislot steps. **Luck
filtering is now implemented and verified** (see §4.3/§4.9/§4.12 below) — the
last of the "core loop" checklist items in §5 step 3 that was still open.

**2026-10-04 (second pass, same day): luck filtering implemented, and a
second, more serious bug discovered and fixed while verifying it — see §4.12
for the full writeup.** Summary:
1. **Luck filtering (§4.3) is now implemented**, resolving the open gap from
   §4.9 (the reverted solver-probe attempt). New files
   [facelet-cube.js](cube_tree_website/js/facelet-cube.js) (a plain-JS 54-facelet
   cube simulator, cross-verified bit-for-bit against `magiccube` for 328
   cases — see [test/facelet-cube.test.js](cube_tree_website/test/facelet-cube.test.js))
   and [facelet-flags.js](cube_tree_website/js/facelet-flags.js) (a JS port of
   `archived_attempts/try_1/utils/CFOPflags.py`'s facelet-mask slot check)
   give `searchCurrentNode` a real cube-state check: replay
   `[scramble, rotation, priorPath, coreAlg]` as literal moves and compare the
   resulting solved slots against exactly what the edge claims. A candidate
   that solves more than claimed is discarded (luck, per spec); one that
   solves less is also discarded, with a console warning (a solver/DAG bug,
   not luck).
2. **While verifying this against the real solver end-to-end, found a second,
   independent, more serious bug**: a later-step DAG edge (from `tree_gen.py`'s
   mid-solve y/y' exploration, previously known only as a *duplicate-edge*
   source — see §4.10 bug 2) can land on a target whose claimed solved
   corners/edges are **not a superset** of the current node's — i.e. the edge
   silently drops an already-committed slot's label (renamed by the
   relabeling instead of carried forward). `searchCurrentNode` had no
   mechanism to apply the implied second rotation, so it dispatched these
   edges using the solver class/slots implied by the (wrong) dropped label,
   which doesn't protect the real already-committed piece. **Verified
   directly against the real WASM solver + a real facelet replay: 26 of 86
   otherwise-normal-looking "Single pair" candidates disturbed an
   already-committed pair 100% of the time, with no error and a perfectly
   ordinary-looking label.** This predates luck filtering, is independent of
   it, and luck filtering's own check cannot catch it (the wrong claim and
   the real outcome agree the dropped slot isn't solved, so nothing looks
   wrong from that check's point of view). Fixed by filtering out, for any
   non-root search, every outgoing edge whose target doesn't preserve every
   corner/edge already solved at the current node — see §4.12.
3. A **third, related but lower-severity finding**: even after fix #2, a
   later-step edge from this same mid-solve-rotation family can still pass
   the superset check (the full target label set is correct) while its own
   per-edge "newly solved" display label is wrong (e.g. shows `BR` when the
   piece actually newly solved is `BL`) — confirmed cosmetic only (the
   candidate's `targetNodeId`, and therefore dispatch and the final solve,
   stay correct; only the UI-facing "corners"/"edges" column can be
   mislabeled). This is the non-root analogue of the already-documented
   §4.11 finding.

**2026-10-04 (third pass, same day): §4.11 and finding #3 above are now
FIXED, and fixing them surfaced a fourth bug — this one inside luck
filtering itself, caught before it was ever exercised against a
non-trivial checkbox configuration.** Full writeup in §4.12's final
section. Summary:
4. The root (§4.11) and non-root (finding #3) display-label mismatches are
   fixed: a `y`/`y2`/`y'` rotation cycles F2L slot names through a fixed,
   empirically-derived order (`relabelSlotsForRotation`, derived the same
   "never hand-derive" way as every other rotation fact in this document —
   four different trigger algorithms, all agreeing, and matching §4.11's own
   prior data point exactly). Non-root display now uses a simpler, more
   robust fix needing no rotation algebra at all: the set difference
   between the target's full (already-trustworthy) claim and the current
   node's own corners/edges.
5. **While wiring the root fix in, found that `checkCandidateAgainstRealCubeState`
   (the luck check itself) had been comparing every root candidate's real
   outcome against the UNROTATED label** — meaning it would have wrongly
   discarded 3 of every 4 rotation variants of any XCross/XXCross/XXXCross
   result as a "solver/DAG bug" (the exact opposite of what luck filtering
   is for). This went undetected because this session's own smoke-test
   verification of luck filtering used `advanced: []` (XCross never ran).
   Re-running with `advanced: ['xcross']` surfaced hundreds of false
   warnings immediately; fixed by feeding the luck check the same
   rotation-corrected claim used for display. XCross candidate count went
   79 → 316 (≈4×) after the fix, with zero false warnings and zero
   label/replay mismatches.

**2026-10-04 (fourth pass, same day): Cross optimisation (README "Wide
moves and Cross optimisation") implemented — the last unimplemented item
from §0's original spec-alignment review.** Full writeup in §4.13. Summary:
6. New [cross-optimization.js](cube_tree_website/js/cross-optimization.js)
   explores rewriting a Cross solution's `L`/`R`/`D` (and primes/doubles,
   `D2` excluded) moves into wide-move form, tracking the cumulative
   rotation each substitution implies and keeping only combinations that
   leave cross on the bottom face. Both the six README equivalences and
   the move-relabeling rule they require were verified against
   `magiccube`/brute-force search, not hand-derived.
7. **Deliberately deviates from the README's literal `u = D + y` notation**
   — the real solver engine's own `"u"` means conventional wide-U, not
   wide-D (confirmed by reading `solver.cpp`'s axis-grouping table); using
   the README's literal letter would have silently corrupted any later
   step once a Cross-optimised result got committed. Uses `d`/`d'` instead
   (same underlying equivalence, different output letter) — see §4.13 for
   the full justification.
8. **Two integration bugs were found and fixed while verifying this
   end-to-end against the real solver**, both invisible from isolated unit
   tests: (a) the reported residual rotation was wrongly also prepended as
   a *leading* rotation for the safety-net luck check, when it's actually
   a *trailing* one — produced dozens of false "not actually solved"
   discards per scramble until fixed; (b) wide-move text in a committed
   path crashed every later step's own luck check, since
   `applyAlgorithm`/facelet-cube.js has no notion of wide moves by design —
   fixed centrally inside `checkCandidateAgainstRealCubeState` so every
   future caller is protected, not just the one call site that first hit
   it. Verified across 4 real scrambles: a cross-optimised result was the
   single top-ranked Cross candidate in 3 of 4, and a full 5-step solve
   chain reached independently-verified completion.

**2026-10-04 (sixth pass, same day): pseudo F2L dispatch is now wired up and
verified. The "unreliable pseudoCrossSolver" finding recorded earlier today
was a misreading and is retracted** — full writeup in §4.14. Summary:
9. **Root cause:** `pseudo.cpp` guarantees cross + targeted corners/edges
   solved only *up to one free trailing D turn* (D/D2/D' brings them all home
   at once). The earlier probes replayed results without it, so cross and the
   corner looked broken. With the right D, 96/96 results across 6 colors were
   exact under real facelet replay.
10. **Wired up:** `alignPseudoAlg` (merges the aligning D into the committed
    alg, "Design A": the committed path stays physically exact, at the cost of
    that D counting toward TPP), `pseudoCallFor`, pseudo dispatch in
    `searchCurrentNode` (needs a pseudo helper; max 3 pairs), a generalised
    luck check (`claimedEdges`, per-piece `cornerAt`/`edgeAt`), post-alignment
    dedupe, `ensurePseudoHelper()` in `solver-ui.js` (lazy), the helper script
    tag in `solver.html`, and a "(pseudo)" type label.
11. **Verified** with new unit tests (real pseudo fixture) and the new slow
    real-WASM harness `test/solver-bridge-e2e.js` (full sessions, independent
    replay; see §4.14). **Known gap: speed** -- pseudo tables are rebuilt on
    every call, 15-80 s per root step in Node; pseudo stays off by default.
12. **Browser-only bug found while verifying in the browser, present since luck
    filtering landed:** `facelet-cube.js` and `facelet-flags.js` both declared a
    top-level `const FACE_ORDER`; plain `<script>` tags share one global scope,
    so `facelet-flags.js` failed to load and every search died with
    `solvedFlags is not defined`. Node tests can't see this (per-file module
    scope). Fixed (renamed to `FLAGS_FACE_ORDER`) and guarded by the new
    `test/browser-globals.test.js` (static duplicate-top-level-declaration check
    over each page's script list). Lesson: browser-verify after any change to
    the script set, the Node harness is not sufficient.
13. Earlier same-day infrastructure still stands: `facelet-flags.js`
    `CORNER_MASKS`/`EDGE_MASKS`/`pseudoSolvedFlags()` (per-piece masks,
    verified against 2000 magiccube cases) and the Promise helpers
    `pseudoCrossSolver/solver-helper(-node).js`.

**2026-10-04 (seventh pass, same day): full vs. simplified pseudo, random-state
scrambles, and a serious rotated-root frame bug found by browser verification.**
Full writeups in §4.15-§4.17. Summary:
14. **Full pseudo + "simplified pseudo" checkbox (§4.15).** `tree_gen.py` now
    emits a superset DAG (same 238 nodes, 6425 edges) where each edge carries
    `full_pseudo_only`; `pruneGraph` drops those when the new
    `simplified_pseudo` checkbox (index.html) is on. Verified that the
    simplified-filtered graph is exactly the old DAG as the bridge sees it,
    and with real-WASM sessions in both modes (full mode: 6/6 sessions solved,
    10 full-pseudo-only steps, 0 warnings).
15. **Bug (§4.16), present since luck filtering/§4.11's relabel fix:** a
    root candidate from a y/y2/y' `altAlgs` variant committed the
    *unrotated* DAG node, so every later step read slot labels in the wrong
    frame. On one scramble 26 of 501 later-step candidates physically broke
    the committed pair while passing the luck check, and 46 showed the wrong
    slot name. Earlier "verified" runs missed it because their checks only
    compared candidates against their own (wrong-frame) claims. Fixed
    (`rootTargetByLabels`); the e2e harness now checks node-vs-physical
    state after every commit and every offered candidate (proven to fail on
    the pre-fix code).
16. **Random-state scrambles (§4.17):** new `random-state-scramble.js`
    (two-phase solver, cubie model derived from `facelet-cube.js`), used by
    "Generate Scrambles"; cross-checked against Python `kociemba`.
17. **Results cache + a pre-existing concurrency bug (§4.18):** switching
    scrambles mid-search made the new scramble's search fail outright
    ("Another solve is in progress" per solver call → "No results"). Searches
    are now queued, and each session caches its current step's results, so
    navigating back is instant.
18. Headless-Chrome verification over CDP works here without any browser
    extension (`/Applications/Google Chrome.app`, `--headless=new
    --remote-debugging-port`, Node's global WebSocket); see §4.16.

**2026-10-04 (first pass): the developer note below ("later steps don't generate valid
solutions, and all searches create many duplicate solutions") was
investigated, root-caused, fixed, and verified — see §4.10 for the full
writeup.** Both root causes were real bugs in `solver-bridge.js`
(`searchCurrentNode`), not in the DAG data or the WASM solver itself:
1. A later-step search pasted the already-rotated committed path text
   (`session.scoredPath`) into a fresh `scramble` string and passed
   `rotation` again, double-applying the rotation relabel. Verified with
   `magiccube`: this silently broke cross by the second committed step on
   every path whose rotation was non-empty (every color except yellow).
   Fixed by using the solver's own `postAlg` option instead.
2. `tree_gen.py` generates fully-redundant edges (same real action, same
   solved-corners/edges outcome) both via a mid-solve y/y' setup rotation at
   every cross-solved node, and via `permutations(edges)` for any
   `pair_size>=2` transition (the permutation never affects which pieces end
   up solved). Fixed by deduping `outgoingEdges()` by the target's solved
   corners/edges before searching, in `searchCurrentNode` — no DAG
   regeneration needed.

(Historical note, superseded by the above: the "verified working" claim in
earlier revisions of this document was based on Node/browser candidate-count
*agreement*, which only proves the two environments run the same code
identically — it never checked the committed path against a real cube
simulator, which is what actually caught this.)

A separate, narrower, **not yet fixed** cosmetic finding surfaced during the
same investigation — see §4.11: for a distance-1 XCross/XXCross/XXXCross
result, the "corners"/"edges" columns don't account for which `altAlgs`
rotation variant was picked, so a non-identity (y/y2/y') variant can display
the wrong slot name even though the underlying DAG bookkeeping (and thus the
actual solve) stays correct. Lower priority than the two fixes above since it
doesn't produce an invalid solve — just a potentially-mislabeled display.

Full test suite (10 fast suites) passes; run them before and after any change:

```
python3 cube_tree_website/test_tree_gen.py
node cube_tree_website/test/script.test.js
node cube_tree_website/test/solver-bridge.test.js
node cube_tree_website/test/facelet-cube.test.js
node cube_tree_website/test/cross-optimization.test.js
node cube_tree_website/test/browser-globals.test.js
node cube_tree_website/test/random-state-scramble.test.js
node cube_tree_website/test/pro-references.test.js
node cube_tree_website/test/search-scheduler.test.js
node cube_tree_website/test/search-budget.test.js
# slow-ish, real WASM (~35 s): node cube_tree_website/test/progressive-e2e.js
# slow-ish, real WASM (~25 s): node cube_tree_website/test/search-options-e2e.js
# slow-ish, real WASM (~1.5 min): node cube_tree_website/test/offload-e2e.js
#   (post-processing workers == in-thread; shared prune tables == own tables)
# engine rebuilds: node cube_tree_website/tools/engine-battery.js [--pseudo] --solver <old solver.js> --out old.json,
#   then the same without --solver and with --compare old.json (must say "all calls identical")
# worst case: node cube_tree_website/tools/worst-case-bench.js --scrambles 2 --depth 1|5
# slow-ish, real WASM: node cube_tree_website/test/lookahead-e2e.js
# slow-ish, real WASM: node cube_tree_website/test/wide-moves-e2e.js
# real WASM, ~10 s: node cube_tree_website/crossSolver/test/dag-search.test.js (DAG search == original DFS)
node cube_tree_website/crossSolver/test/slot-mapping.test.js   # slow-ish, hits real WASM
node cube_tree_website/crossSolver/test/color-orientation.test.js  # slow-ish, hits real WASM
# very slow (minutes; real WASM, full sessions, independent replay; exit!=0 on any bug):
node cube_tree_website/test/solver-bridge-e2e.js --pseudo --scrambles 2 --seed 1
#   --pick full exercises full-pseudo-only transitions; --simplified tests that mode;
#   use several --colors so y-variant root commits (§4.16) are covered
```

A good smoke test after touching `solver-bridge.js`: scramble
`R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2`, colors=`['white']`,
advanced=`[]`. As of the §4.12 fixes, expect **80 candidates at step 1, 80 at
step 2, 60 at step 3** (step 1/2 unchanged from the §4.10 baseline; step 3
dropped from 120 to 60 — 34 removed as luck-filtered over-solves, 26 removed
as the §4.12 superset-safety fix — both confirmed, not just counted, by
replaying the full committed path through `facelet-cube.js`/`facelet-flags.js`
and checking every claimed slot against the real resulting cube state). The
full chain for this scramble reaches a genuine, independently-verified
complete Cross+F2L solve in 5 steps (Cross + 4 single pairs). With
`advanced: ['cross_opt']` also enabled on this same scramble, step 1 gains
9 additional cross-optimised candidates (89 total) — all independently
verified to still solve cross — though for this specific scramble the plain
(unconverted) result still happens to win on TPP; see §4.13 for scrambles
where the optimised variant wins outright.

**Reasonable next tasks (as of the seventeenth pass):**
1. First-ever page load still builds every table in every worker (~5 s to
   the first xcross+xxcross list here). Building each table once (one worker
   per table, then sharing) or a "build this key" engine call would cut it.
2. With tables shared, the "cross + edge" bound in xxcross (warm -23%, §4.40)
   costs nothing after the first load: worth re-measuring and adopting.
3. Later-step pro-move-set searches (xxxcross 1-3 s per call warm) are the
   remaining engine cost; the rotation branches of `depth_limited_search`
   are never pruned (§4.40 notes), but their output must stay identical.
4. The pseudo engine still rebuilds per worker; same sharing would apply.

**Reasonable next tasks (as of the sixteenth pass):**
1. Multislot look-ahead is engine-bound: "last two pairs" multislot calls
   (`solveXxxxcross`, 16 moves, pro move set) take 4-11 s each, 3-pair
   multislots from a cross similar. Needs a stronger admissible bound or
   fewer redundant pro-move spellings inside the engine (battery-check any
   rebuild, §4.36 tools).
2. Every engine worker builds its own prune tables (~4.5 MB each per corner
   and move list; "no r2/l2" is a second move list): the first look-ahead
   after a page load pays this once per worker. Call-to-worker affinity or
   persisted tables (IndexedDB) would cut it.
3. The rest of the main-thread cost per candidate (~60 µs: MCC ~12 µs, facelet
   replays for the luck check, dedupe keys, ranking) -- profile with
   `--cpu-prof` and positionTicks as in §4.39.

**Older next tasks (fourteenth pass):**
1. Make the cut tail smaller under the 60 s limit (§4.36 "What is cut"):
   pro-move-set XXXCross (100-500 s per call) and pseudo XXXCross (~25-60 s)
   are what the limit drops. Ideas measured but not done: a face-turn
   search + post-hoc pro spellings (complete in 12 s where the pro search
   takes 494 s for a capped subset, but it misses slice-like spellings such
   as `L l'`); multi-goal search sharing one traversal across slot sets.
2. JS tail after the engine deadline is ~10-17 s with ~500k candidates
   (`SEARCH_ENGINE_SHARE` 0.75 leaves room for it). Cheaper per-candidate
   work (isSlotSolved/MCC/spelling replays) would let engines use more time.
3. Cold first search: prune-table builds (seconds, not interruptible) count
   against the limit; persisting tables (IndexedDB) would remove that.
4. Root-step ranking is still the alg_speed gap (0-2/19 root pro steps in the
   top 10, §4.37); needs more root data or an inspection-planning model.

**Older next tasks (thirteenth pass):**
1. **Out-of-sample check of the alg_speed penalties on pro solves #12-#19**
   (never seen by the fit): rebuild the `--app` pools for all 19 solves, then
   compare the top-10 rate on #12-#19 under `--no-penalty` vs default. If it
   holds up, refit on all 19 with `tools/fit-step-penalties.js` (leave-one-
   solve-out CV) and update `STEP_PENALTIES` only if the CV result improves.
   User target: pro steps in the top 10 90% of the time; currently 24/36
   cross-validated; root steps are the gap (§4.35).
2. Re-run `test/pro-references-e2e.js --config extended` for #12-#19
   (membership in the search tree; use `--only N`, and `--max 20000` for speed).
3. Root-step ranking (§4.35 "Why not 90%"): needs more pro root examples or a
   model of inspection planning; ranking within target type was measured
   and barely helps (3/11 vs 2/11).
4. Look-ahead cost: depth 3+ is still heavy. Ideas: render plain results
   first and re-rank when look-ahead finishes; a smaller `maxSolutions` for
   look-ahead-only searches.
5. Engine rotation-branch fix (§4.34): measured and not adopted; revisit if
   the per-call cap is raised, or apply it to x rotations only.
6. Remaining perf: root XXXCross (~11 s per call); persisting prune tables
   in IndexedDB would remove the ~3-5 s cold start per page load.
7. §4.28's open browser-worker finding is still open.

**Older list (eighth pass):**
0. pro_references.txt gaps (§4.20): non-cross-on-D inspection orientations
   (#6/#7). Goal-no-op moves need an engine change (emcc). Tune the default
   solutions-per-search (100) against real timing data.

**Earlier list (seventh pass):**
1. Pseudo performance: largely DONE (§4.23, tables built once).
2. Limited look-ahead (README; explicitly optional).

Everything else from the original §0 spec-alignment review is now
implemented and verified: luck filtering (§4.3/§4.12), the §4.11/§4.12
display-label findings (`relabelSlotsForRotation` + the non-root
set-difference fix), and Cross optimisation (§4.5/§4.13). If any of these
ever regress (label/replay mismatches, a candidate that doesn't solve what
it claims, etc.), re-derive/re-verify the same way each was built — real
DAG + real solver + `facelet-cube.js`/`facelet-flags.js` — never by
re-deriving rotation algebra by hand.

**Traps already discovered the hard way — don't rediscover these:**

- A root candidate's committed node must be the one labelled with what it
  *physically* solves after its full rotation (including the altAlgs y
  token), not the unrotated DAG target (§4.16). Any check that compares a
  candidate only against its own claim cannot see a wrong-frame node; check
  the session node against the physical cube.

- `pseudoCrossSolver` results are solved only *up to one free trailing D turn*
  (§4.14). Never replay or commit a raw pseudo result; run it through
  `alignPseudoAlg` first. Do not conclude the solver is "unreliable" from a
  replay that skipped this.
- A whole-cube rotation must go through the solver's `rotation` *option* on
  every call. Embedding it as a literal move in the `scramble` string
  silently corrupts parsing (§4.7 area / `solver-bridge.js` header comment).
- A later-step search must include every already-solved slot in its own
  goal (dispatch via the solver class matching *total* pairs needed, not
  just new ones), or it silently disturbs committed pairs about half the
  time (§4.7).
- Never paste the committed path-so-far into a fresh `scramble` string for a
  later-step call, even though it's plain text that looks like it'd
  concatenate fine. It's already expressed in the rotated frame the engine
  returned it in; passing `rotation` again on top of that double-relabels it
  and searches a bogus state. Use the engine's own `postAlg` option instead
  — verified with a real cube simulator, not just by re-reading the C++, see
  §4.10.
- A cross-solved (later-step) DAG node's outgoing edges are not 1:1 with
  real actions — `tree_gen.py` emits redundant edges for the same action
  (same target solved-corners/edges) via both a mid-solve y/y' setup
  rotation explored at every cross-solved node, and `permutations(edges)`
  for any 2+-pair transition. Dedupe by the target's solved corners/edges
  before searching (§4.10).
- A later step's move-limit must scale with total pairs in goal, not stay
  flat at the spec's "single pair=10/multislot=12" (§4.8).
- The same mid-solve y/y' exploration that causes the duplicate-edge trap
  above can ALSO produce a later-step target whose claimed solved
  corners/edges are not a superset of the current node's — i.e. it silently
  drops an already-committed slot's label instead of carrying it forward.
  Taking such an edge at face value lets the solver disturb a real,
  already-committed pair with no error. Filter out any non-root edge whose
  target doesn't preserve every corner/edge already solved at the current
  node, before searching (§4.12).
- A real cube-state check (facelet simulation + the CFOPflags-style mask
  check) is the only reliable way to verify which pieces a result *actually*
  solves — a solver probe is not (§4.9), and neither is trusting the DAG's
  own labels at face value (§4.12). `facelet-cube.js` must be
  cross-verified against `magiccube`, not hand-derived — see
  test/facelet-cube.test.js for the method (derive each base move's facelet
  permutation from many random before/after pairs, then verify independently).
- "0 `onProgress` events" from the solver does **not** reliably mean
  "already solved" — it's ambiguous whenever the call's `maxLength` is
  shorter than the true solution depth (IDA* silently skips announcing
  depths it can prove infeasible). Only trust this signal when `maxLength`
  is generous relative to the case being tested (§4.9).
- Browser HTTP caching in this dev setup (`python3 -m http.server`) is
  aggressive with no `Cache-Control` header. `script.js`/`solver-bridge.js`/
  `solver-ui.js` are loaded with a `?v=` cache-busting query string from
  `solver.html`/`index.html` — bump it if edits don't seem to take effect in
  the browser. `crossSolver/solver-helper.js` deliberately does **not** get
  one (breaks its self-path detection) — see §5 step 3's "Incidental fix"
  note.
- The repo is GPL-3.0 (§6). Any change to vendored engine code must be
  listed in THIRD_PARTY_NOTICES.md.
- After rebuilding an engine (`crossSolver/compile.sh`,
  `pseudoCrossSolver/compile.sh`; emsdk at `~/emsdk`), bump `ENGINE_VERSION`
  in solver-ui.js or browsers keep the cached old binary (§4.27), and check
  the dev server log shows the new `.wasm` being fetched.
- **Directory layout (2026-10-04 cleanup):** the browser app lives in
  `js/` (`script.js`, `facelet-cube.js`, `facelet-flags.js`,
  `cross-optimization.js`, `random-state-scramble.js`, `solver-bridge.js`,
  `solver-ui.js`); runtime/reference data is in `data/`
  (`F2L_tree.json`, `f2l_nodes_and_edges.json`, `pro_references.txt`);
  Node/Python dev scripts are in `tools/` (`backend_test.js`,
  `cross_xcross.js`, `pro-references.js`, `tree_gen.py`, `test_tree_gen.py`,
  `gen_facelet_fixture.py`, plus the new shared `harness.js`; twelfth pass:
  `pro-search.js`, the engine side of the pro harnesses, and `pro-ranking.js`,
  the alg_speed benchmark; `js/search-scheduler.js` is the search queue;
  seventeenth pass: `js/postprocess-worker.js` and its Node twin
  `tools/node-postprocess-pool.js`, §4.40); upstream docs
  are in `docs/`. `index.html`, `solver.html`, `f2l_table_inspector.html`,
  `styles.css` stay at the site root, as do the vendored `crossSolver/` and
  `pseudoCrossSolver/` engines (untouched — `THIRD_PARTY_NOTICES.md`
  documents their modifications by these exact paths). `test/` is unchanged.
  Old flat-layout paths you may remember from earlier entries in this file no
  longer exist; the file-path *links* throughout this document were updated
  for the move, but older prose mentions may still say e.g. "script.js"
  without the `js/` prefix — that's still the same file, just moved.

**2026-10-04 (tenth pass): background searching, undo, reload persistence,
and granular per-category search config all implemented — see §4.28 for the
full writeup. Includes one open, not-yet-root-caused finding**: a later-step
search that is the very first call on a fresh browser worker (reachable via
undo-then-recommit, or a reload that restores straight to a non-root node)
can show real candidates discarded by the luck check that three independent
Node reproductions of the same scenario against the real engine could not
reproduce — likely a pre-existing browser-worker timing issue, not this
pass's own dispatch logic (which the Node attempts rule out directly); fewer
results, never wrong ones, but worth a dedicated browser-side investigation.

**2026-10-04 (cleanup pass): codebase restructured from a flat
`cube_tree_website/` into `js/`/`data/`/`tools/`/`docs/` (see the layout
bullet above) and the copy-pasted `PATHS`/engine-bootstrap boilerplate in
`backend_test.js`/`cross_xcross.js` extracted into `tools/harness.js`
(also fixed a real bug there: a hardcoded machine-specific absolute
`BASE_DIR` became `path.join(__dirname, '..')`). Vendored engines
(`crossSolver/`, `pseudoCrossSolver/`) and `archived_attempts/` were left
untouched. Verified after the move: the full fast `test/` suite, both slow
real-WASM e2e harnesses (`solver-bridge-e2e.js`, `pro-references-e2e.js`),
`test_tree_gen.py`, both refactored `tools/` debug scripts end-to-end,
byte-identical `tree_gen.py` regeneration output, and a full headless-Chrome
browser run of index.html → solver.html (500 results populated, zero
console errors).**

---

## 0. Specification alignment (2026-10-03)

On 2026-10-02/03 the product specification was written down explicitly for
the first time (now captured in README.md) and is substantially richer than
what this document's prior roadmap assumed. The corrections below matter
enough to call out up front, because earlier roadmap language (written
before the spec existed) described something importantly simpler than the
real target:

- **The interaction model is multi-step DAG traversal, not a one-shot
  search.** The old roadmap's Step 3 ("walk root-level edges, call the
  solver, render rows") only ever described populating *one* results table
  from the unsolved node and stopping. The actual product is a **loop**:
  search the current node → user clicks a result → that edge is committed
  (cube state advances by scramble + every selected step so far) → search
  again from the new node → repeat until Cross+F2L is complete. A solve is
  normally 2–5 of these steps. This is a materially bigger piece of work
  than "populate one table," and the roadmap below has been rewritten
  accordingly.
- **TPP must be computed over the whole path, not a single edge in
  isolation.** There has only ever been one metric name, TPP (Time Per
  Piece); an earlier draft of this document used an outdated label for the
  identical formula shape, which wrongly implied two different metrics
  where there has only ever been one. The real gap is *what gets fed into*
  `alg_speed`, not what the result is called. The existing code (`script.js`'s
  `scoreAlgorithms`, `cross_xcross.js`, `backend_test.js`) computes
  `tpp = alg_speed(this edge's moves alone) / pieces this edge alone solves`
  — scoring **only the candidate edge being considered**. The spec's TPP is
  `alg_speed(entire committed path + this candidate step) / pieces solved by
  that whole path` — scoring **the whole path so far, including the new
  step**. These coincide for a distance-1 (first) result but diverge for
  every step after that. Nothing in the codebase currently tracks or scores
  a cumulative path; this has to be built, not ported. See §4.2.
- **Luck filtering does not exist yet.** No code currently discards a
  solution that accidentally solves more pieces than its DAG edge claims to.
  The WASM solvers' coordinate spaces generally don't track pieces outside
  the ones they were asked to search for, so an "Xcross" search can return a
  solution that happens to also complete a second pair, with the solver
  itself having no way to know. See §4.3.
- **The DAG, as currently generated, only supports "simplified pseudo" —
  not full/unrestricted pseudo.** This directly answers open question #1
  from the spec. See §4.1 for the full finding; the short version is that
  `tree_gen.py`'s `is_pure_mismatch_repair()` gate is unconditionally
  applied the moment any mismatch exists, which *is* the simplified-pseudo
  rule, and there is currently no code path that produces the broader
  "explore every relevant combination" DAG the full-pseudo checkbox needs.
- **Procedural inspection-rotation generation already exists, but is wired
  too broadly.** `script.js`'s `altAlgs()` already does roughly the right
  thing (derive y/y2/y' variants of one found solution instead of
  re-searching per rotation) — but `cross_xcross.js`/`backend_test.js` apply
  it to *every* result, not just distance-1 ones, which contradicts the
  spec's rule that rotation-variant generation is a distance-1-only
  concept. See §4.4.
- **Cross-optimisation (wide-move post-processing) does not exist at all.**
  There is no code anywhere that rewrites a Cross solution into r/l/u-wide
  form, tracks rotation state, or filters by final orientation. This is a
  net-new feature, not a bug fix. See §4.5.
- **Search-limit numbers in the existing test harnesses don't match the
  spec's authoritative table.** `cross_xcross.js` and `backend_test.js` use
  ad hoc depth limits (e.g. cross=8or9, xcross=8or10) left over from manual
  experimentation. The spec's numbers (Cross 10, XCross 11, XXCross 12,
  single-pair 10, multislot 12) are now authoritative; see §4.6.
- **Limited look-ahead is an optional future enhancement, not the core
  loop.** Nothing currently implements it, and nothing should block basic
  single-step-search integration on it.

None of this means the earlier verified fixes below are wrong or wasted —
the DAG and slot-index bugs fixed in §1.1/§1.2 are real, confirmed, and
still load-bearing for whatever gets built next. It means the *next* piece
of work (the browser-solver bridge) is scoped differently than previously
written, and §5's roadmap reflects that.

---

## 1. Current State Analysis

The codebase has three mostly-disconnected pieces: an abstract DAG
generator, two WASM solvers, and a frontend/scoring layer. Each piece works
in isolation (there are working proofs-of-concept), but they are not wired
together into the interactive multi-step loop the spec describes, and the
one place that *does* chain DAG → solver → scoring (the Node test scripts)
only ever does a single first step (plus an unfinished, unscored
experimental second phase), never a full interactive path.

### 1.1 The DAG ([tree_gen.py](cube_tree_website/tools/tree_gen.py))

- Builds a **purely abstract** state graph: each node is `{cross_solved,
  corners solved, edges solved}` (no real facelet/cubie state, no move
  sequences on nodes). Transitions model "solve N pairs, optionally rotate
  first" and encode the mismatch/pseudo-pair rules (`slot_mismatch_count`,
  `is_valid_pair_state`, `is_pure_mismatch_repair`).
- Correctly produces XCross/XXCross/XXXCross and pseudo-pair nodes via BFS,
  then prunes unreachable states. **As of 2026-10-02 this is verified**: 238
  nodes, 2393 edges, acyclic, monotonic, every node's solved-piece labels
  are real slot names, and 4 fully-solved terminal states exist with no
  outgoing edges — see [test_tree_gen.py](cube_tree_website/tools/test_tree_gen.py)
  and §5 roadmap for the two bugs that were found and fixed to get here (a
  wrong output path, and a label-extraction bug that silently zeroed out
  the mismatch-validity filtering and made the DAG unable to reach a
  fully-solved state at all).
- `f2l_nodes_and_edges.json` (consumed by the frontend) and
  [F2L_tree.json](cube_tree_website/data/F2L_tree.json) (consumed by the two
  Node.js test harnesses) are now redundant copies of the same graph — see
  the still-open cleanup item in §5 step 1.
- **Pseudo-mode finding (answers spec open question #1 — see §4.1):** the
  current generator produces only the **simplified-pseudo** DAG. Supporting
  the spec's separate "full pseudo" mode (explore every relevant
  corner/edge combination at a mismatched node, not just the direct repair)
  needs new generator logic / a broader DAG, not just a UI checkbox.

### 1.2 The WASM solvers

Two independent C++/Emscripten solvers, architecturally very different:

- **`crossSolver/`** ([solver.cpp](cube_tree_website/crossSolver/solver.cpp),
  ~7000 lines): mature, well-documented (see
  [IMPLEMENTATION_NOTES.md](cube_tree_website/crossSolver/IMPLEMENTATION_NOTES.md)).
  Implements Cross / Xcross / Xxcross / Xxxcross / Xxxxcross / LL-substeps /
  LL / LLAUF as **persistent** IDA* solvers (prune table built once, reused
  across calls), with cancel support, a worker (`worker-persistent.js`)
  that multiplexes all 8 solver types, and Node/browser helper wrappers.
  **Per the spec, `PersistentXxxxcrossSolver`/LL-family solvers are out of
  scope** — cube⑂tree only needs Cross/Xcross/Xxcross/Xxxcross plus
  later-step single-pair and multislot (two-pair) searches, which the
  Xxcross solver already covers (a later-step "solve 2 of the remaining
  pairs" multislot search is structurally the same shape as an Xxcross
  search, just not from the root). This solver code is **vendored from an
  external project**, not original — see §6 Provenance for the confirmed
  license.
- **`pseudoCrossSolver/`** ([pseudo.cpp](cube_tree_website/pseudoCrossSolver/pseudo.cpp),
  ~2900 lines): handles independent (non-matched) edge+corner slot solving
  for pseudo pairs, addressed by slot *name* strings (`"FR"`, `"BL"`, …)
  rather than opaque integers — verified by direct execution to work
  correctly for both matched-equivalent and genuinely mismatched requests
  (see §5 step 2 follow-up testing). Exposes a single non-persistent
  `solve()` (confirmed: no `Persistent*` embind classes exist in
  `pseudo.cpp`) — **every call rebuilds its BFS prune table from scratch**,
  unlike `crossSolver`.
- **Slot-index mismatch — RESOLVED (2026-10-02):** `crossSolver/README.md`
  documented the xcross/xxcross slot convention as `0=BR, 1=BL, 2=FL, 3=FR`,
  contradicting `cross_xcross.js`/`backend_test.js`'s
  `SLOT_INDICES = { BL: 0, BR: 1, FR: 2, FL: 3 }`. Verified empirically
  against the compiled `solver.wasm` (see
  [crossSolver/test/slot-mapping.test.js](cube_tree_website/crossSolver/test/slot-mapping.test.js)):
  the actual convention is **`0=BL, 1=BR, 2=FR, 3=FL`**, matching the JS
  side exactly. The docs (`README.md`, `IMPLEMENTATION_NOTES.md`,
  `solver-helper.js`, `solver-helper-node.js`) were wrong and have been
  corrected; `cross_xcross.js`/`backend_test.js` needed no changes.
- **Color/rotation mismatch — RESOLVED (2026-10-03):** the engine's C++ core
  has no color semantics at all (verified by reading `solver.cpp`: pure
  coordinate math, no "white"/"yellow" anywhere) — color is purely a
  label *we* choose to overlay on the `rotation` parameter, per the
  README's stated convention (White=U, Green=F, so by the standard color
  wheel Yellow=D, Blue=B, Red=R, Orange=L). `cross_xcross.js`/
  `backend_test.js`'s `COLOR_ORIENTATIONS` tables had **white and yellow
  swapped** (`white: ['none']` when `rotation=''` actually targets the
  D-face cross, which under our convention is yellow, not white) — green/
  blue/red/orange were already correct. Verified empirically (not just by
  re-deriving rotation algebra by hand, which produced a wrong answer on
  the first attempt) by testing, for each whole-cube rotation, which
  single original face's turns leave a solved cross undisturbed — that
  face is the new-U, and its antipode is the new-D/cross-color face. See
  [crossSolver/test/color-orientation.test.js](cube_tree_website/crossSolver/test/color-orientation.test.js).
  Fixed both tables; `cross_xcross.js`'s smoke-test output now correctly
  labels its (unchanged) results as `white` instead of `yellow`.

### 1.3 Frontend ([index.html](cube_tree_website/index.html) / [solver.html](cube_tree_website/solver.html) / [script.js](cube_tree_website/js/script.js))

- `index.html`: scramble entry + checkboxes for colors and advanced options
  (`xcross`, `xxcross`, `xxxcross`, `multislotting`, `full_pseudo`,
  `cross_opt`). Working UI, persists criteria to `localStorage` and
  navigates to `solver.html`. **Missing per spec:** a "simplified pseudo"
  checkbox, independent of `full_pseudo`, does not exist yet.
- `solver.html`: **now a working interactive solver** — see §5 step 3 for
  the full picture. `script.js`'s `DOMContentLoaded` handler still only
  fetches the graph JSON, prunes it, and stores it in `localStorage` as
  before, but now also calls `window.onPrunedTreeReady(...)` (a small hook
  added for this), which `solver-ui.js` uses to kick off the actual
  search/render/click-to-commit loop implemented in `solver-bridge.js`.
- `script.js` also contains, already implemented, tested, and usable as
  building blocks (though none of them yet implement the spec's
  path-cumulative TPP — see §0/§4.2):
  - `generateScramble` / `populateScrambles` — random scramble generation.
    **Per spec this is explicitly a placeholder**; the eventual goal is
    random-state WCA-legal scrambles.
  - `algSpeed` — a hand-movement-simulation heuristic (grip/wrist/finger
    state machine) that scores an algorithm's physical execution
    difficulty, based on Triangium's MCC model. This is the **deliberately
    untuned** version per spec — do not swap in the fitted constants from
    `archived_attempts/try_4/alg_speed.py` (see §2 item 1 and README
    "Out of scope").
  - `altAlgs` — generates the 4 y-rotation variants of a solution. This is
    the existing implementation of the spec's "procedural inspection
    rotation" mechanism, but see §4.4 for how it's currently over-applied.
  - `pruneGraph` — filters DAG nodes/edges by the UI's advanced-option
    checkboxes. Already confirmed correct by `test/script.test.js` for the
    checkbox-gating logic it currently implements (xcross/xxcross/
    multislotting/full_pseudo gating); does not yet know about
    "simplified pseudo" as a separate filter.
  - `scoreAlgorithms` / `calculateSolvedPieces` — TPP scoring plumbing that
    currently scores **a single edge in isolation**, not the spec's
    cumulative **whole path** (see §4.2), exported via `module.exports` for
    reuse in Node.

### 1.4 The original Node-only pipeline (superseded by §5 step 3 for the browser, kept as a CLI diagnostic tool)

[cross_xcross.js](cube_tree_website/tools/cross_xcross.js) and
[backend_test.js](cube_tree_website/tools/backend_test.js) are standalone CLI
scripts (hardcoded absolute `BASE_DIR`, not reusable as a library) that
**do** load the DAG, dispatch to both WASM solvers via forked child
processes (one process per solve call — far too slow for interactive use;
the real integration should use `worker-persistent.js` directly, which
keeps prune tables warm), score results with the per-edge `algSpeed`/TPP
scoring described above, rank, and print a table. They prove the
DAG+solver+scoring wiring *can* work, but:
- they only ever search and score the **first step** (distance-1 edges from
  the unsolved node) — there is no click-to-commit loop, no second search,
  and no cumulative path scoring;
- `backend_test.js`'s "Phase 2" expands into child transitions
  (multi-step) but is explicitly a crash/memory diagnostic harness, not a
  scored, ranked pipeline — it never computes TPP for its Phase 2 results
  at all;
- neither script implements luck filtering, simplified-pseudo-only
  traversal, cross-optimisation, or the distance-1-only scoping of rotation
  variants;
- their internal search-depth limits don't match the spec's authoritative
  numbers (see §4.6).

### 1.5 Spec-requirement coverage

| Spec requirement | Current state |
|---|---|
| Abstract F2L DAG (unsolved → full Cross+F2L) | **Done, verified.** 238 nodes / 6425 edges (2393 without the full-pseudo-only edges added in §4.15), see §1.1. |
| Multi-step click-to-commit interactive loop | **Working, verified in-browser** for matched (non-pseudo) Cross/XCross/XXCross/XXXCross + later single-pair/multislot. See §5 step 3. |
| TPP ranking over the cumulative path | **Working, verified.** See §5 step 3. |
| Luck filtering | **Done, verified.** A solver-probe approach was tried first and reverted as unreliable (§4.9); the real fix is a facelet-based real cube-state check (§4.12). |
| Simplified pseudo vs. full pseudo as distinct modes | **Done (2026-10-04, seventh pass).** Superset DAG with a per-edge `full_pseudo_only` flag; "simplified pseudo" checkbox filters it in `pruneGraph`. See §4.15. |
| Procedural (distance-1-only) inspection rotations | **Working, verified** — `altAlgs` now correctly scoped to distance-1 only. See §4.4/§5 step 3. |
| Cross optimisation (wide-move post-processing) | **Done, verified** (§4.5/§4.13), with the §4.19 fixes: README notation (`u = D + y`), committed results with a residual rotation now work. |
| Search limits matching the spec's table | **Working, verified** — see §4.6/§4.8 for the one place this needed to extend beyond the spec's literal numbers (later steps scale by total pairs, not a flat per-category number). |
| WASM scramble search (matched + pseudo) | Matched: **integrated and verified end-to-end in the browser.** Pseudo: **wired in and verified** (§4.14), but slow (tables rebuilt per call). |

**Bottom line:** the core interactive loop — the thing that was entirely
missing before — now works end-to-end in the actual browser for the
non-pseudo subset of the product, verified against both a Node harness and
a live click-through session with matching results, and now also with luck
filtering (§4.12) protecting every result against over-solving, silently
disturbing an already-committed pair, and (both found and fixed in the same
investigation) a mislabeled "corners"/"edges" display column, and now also
with Cross optimisation (§4.13) offering wide-move rewrites of Cross
results where they genuinely score better. The remaining gaps are specific
and bounded: pseudo dispatch, simplified-pseudo DAG support, multi-scramble
verification, and the Xxxxcross cold-start latency.

---

## 2. Recyclable Utilities from `archived_attempts/`

Non-ML logic worth pulling forward, found while reviewing `try_1`–`try_4`
(`try_2` and `try_3` are pure PyTorch model training code — cross-picker MLP
and a cube-state GNN — and are not reusable here):

1. **Tuned speed model — [`try_4/alg_speed.py`](archived_attempts/try_4/alg_speed.py)**
   A more mature version of `script.js`'s `algSpeed`, with the same core
   hand/finger/wrist simulation but differential-evolution-fit constants, a
   `scale` term converting the score to seconds, and optional n-gram
   corrections. **Per the spec this is explicitly out of scope for now** —
   cube⑂tree deliberately uses the untuned model. Keep this noted for
   whenever that changes, but do not port it speculatively.

2. **Mirror-move utility — [`try_4/mirror_alg.py`](archived_attempts/try_4/mirror_alg.py)**
   A clean `move_mapping` table that mirrors an algorithm over the R/L axis
   (`R U R' U'` → `L' U' L U`). Not mentioned by the spec one way or the
   other (the spec's rotation/duplicate-elimination rules are about y-axis
   whole-cube rotation, not R/L mirroring) — still a reasonable future
   addition for widening the ranked pool, but not required by anything
   currently specified. Treat as optional, not roadmap-blocking.

3. **Real-cube-state solved-pair detector — [`try_1/utils/CFOPflags.py`](archived_attempts/try_1/utils/CFOPflags.py)**
   — **ported, 2026-10-04, see §4.12.** Takes a 54-character Kociemba-style
   facelet string and, via fixed bitmasks, returns `[cross, bl, br, fl, fr]`
   solved flags by comparing facelets to their face centers. This was
   confirmed to be the right prerequisite for luck filtering (a solver-probe
   approach was tried first and found unreliable, §4.9) and is now ported as
   [facelet-flags.js](cube_tree_website/js/facelet-flags.js), operating on a
   purpose-built JS facelet simulator ([facelet-cube.js](cube_tree_website/js/facelet-cube.js))
   rather than `try_4/cubestate_encoder.py`'s `magiccube`-wrapping approach
   (item 4 below) — a self-contained JS simulator avoids a Python
   dependency in the browser-facing code path; `magiccube` was still used,
   at build/verification time only, as the ground truth to derive and
   cross-check `facelet-cube.js`'s move tables.

4. **Cube-state simulation plumbing — [`try_4/cubestate_encoder.py`](archived_attempts/try_4/cubestate_encoder.py)**
   Not ported directly (see item 3 above — a native JS simulator was built
   instead, since the browser-facing code can't depend on Python/`magiccube`
   at runtime), but `magiccube` itself (the library this file wraps) was
   used as the empirical ground truth to derive and verify `facelet-cube.js`'s
   move tables (`gen_facelet_fixture.py`), matching this item's original
   relevance to luck filtering. Note: as checked out, this file's
   `GRAPHML_PATH` is broken (points at a path one directory off from where
   the file actually lives under `try_3/data/`); not relevant to the path
   actually taken, but still broken if anyone reuses this file directly.

Not recommended to pull forward: `try_1/utils/npz_generate.py`,
`try_1/models/main.py`, `try_2/models/cross_picker.py`, `try_3/scripts/*` —
all are ML training/data-generation code for the abandoned neural-net
approach and have no bearing on the DAG+WASM design.

---

## 3. Verified-correct areas (no action needed)

Recorded so these don't get re-investigated or second-guessed later:

- **`worker-persistent.js` message routing** matches
  `solver-helper-node.js`'s `_args()` parameter order exactly
  (`scramble, rotation, maxSolutions, maxLength, allowedMoves, postAlg,
  centerOffset, maxRotCount, moveAfterMove, moveCount`, with `ll` inserted
  after `rotation` for `LLSubsteps`). No porting bug here.
- **`pseudo.cpp`'s `solve()`** was directly exercised (not just read) with
  both a matched-equivalent request (edge=FR, corner=FR) and a genuinely
  mismatched one (edge=FR, corner=FL); both returned correct, sane
  solutions with no crash.
- **`script.js`'s `algSpeed` is a faithful, bug-free port** of
  `alg_speed.py`'s core physics function. Verified by calling both with
  *identical* constants on 9 diverse algorithms (covering wide moves, slice
  moves, rotations, doubles, primes) and confirming bit-identical output.
  The only difference between the two is tuning (see §2 item 1), not logic.
- **`pruneGraph`'s existing checkbox-gating logic** (xcross/xxcross/
  xxxcross/multislotting/full_pseudo) is correct for what it currently
  implements, confirmed by `test/script.test.js`'s synthetic-tree tests. It
  does not yet implement simplified-pseudo gating, luck filtering, or
  distance-1-only rotation scoping — those are additions, not fixes to
  existing broken logic.

---

## 4. Deviations between spec and current implementation

These are the concrete technical gaps that will matter when the browser
bridge (§5 step 3) is built. Each is a deviation discovered by inspecting
the actual code against the spec, not a hypothetical.

### 4.1 FIXED (2026-10-04): DAG only supported simplified pseudo (answers spec open question #1) — see §4.15

**Resolved via option (b) below — see §4.15.** Kept as the original finding.

In `tree_gen.py`'s `generate_pair_transitions()`:

```python
has_mismatch = slot_mismatch_count(current_state) > 0
...
if has_mismatch and not is_pure_mismatch_repair(rotated, next_state):
    continue
```

The moment the *current* state has any mismatch at all, **every** candidate
transition — regardless of `pair_size` — must pass `is_pure_mismatch_repair`,
which requires that only the existing mismatched slots get newly solved
(`newly_solved.issubset(mismatched)`) and that the mismatch count strictly
decreases. This is precisely the spec's "simplified pseudo" rule (next step
must fix only the mismatch) applied unconditionally. There is currently no
code path — no flag, no alternate generation mode — that relaxes this to
produce the "full pseudo: explore every relevant combination" DAG the spec
also calls for.

**Implication for §5 step 3:** supporting the full-pseudo checkbox as
specified requires either (a) a second DAG-generation mode with the
`is_pure_mismatch_repair` gate relaxed (or removed) once a mismatch exists,
generated and shipped as a second JSON, or (b) regenerating a strict
superset DAG that includes both the simplified-repair edges and the
broader combinatorial edges, with the simplified/full distinction enforced
by `pruneGraph`-style filtering at load time (consistent with how every
other checkbox already works). Option (b) is more consistent with the
existing architecture (one DAG, filtered by checkboxes) and is the
recommended direction, but it means a real DAG-generation change, not a UI
change.

### 4.2 No cumulative-path scoring exists

TPP is the only metric; there is no separate metric this is being compared
against. The gap is entirely about **what solution text `alg_speed` is
applied to**, not what the result is called: today it's applied to a single
candidate edge's moves alone, where the spec requires it to be applied to
the entire committed path plus the candidate step.

Confirmed by reading `cross_xcross.js`: `scores = scoreAlgorithms(sol.moves)`
where `sol.moves` is that edge's algorithm text alone, and
`calculateSolvedPieces(rootNode, targetNode)` counts only that edge's newly
solved pieces. This scores a single edge in isolation. `backend_test.js`'s
Phase 2 (the only existing code that even attempts a second step) builds a
composite *scramble* string for the solver to search from
(`${SCRAMBLE} ${parentAlg}${edgeRot}`), which is necessary and correct for
finding the right solutions, but never computes a score over
`parentAlg + childAlg` together — it has no scoring step at all for Phase 2
results.

**Implication for §5 step 3:** the ranking/scoring layer needs to track,
per committed path, the concatenated algorithm string and cumulative pieces
solved so far, and score every new candidate as
`algSpeed(pathSoFar + candidate) / piecesSoFar(path + candidate)` — not by
reusing `scoreAlgorithms`/`calculateSolvedPieces` as they're called today.

### 4.3 FIXED (2026-10-04): no luck filtering existed — see §4.12

**Resolved — see §4.12 for the full implementation writeup.** The
description below is kept as the original problem statement.

Neither `cross_xcross.js` nor `backend_test.js` checks whether a returned
solution solved anything beyond what its DAG edge claims. The WASM solvers'
IDA* coordinate spaces generally only track the pieces relevant to the
specific search requested (e.g. an Xcross search for one slot has no
awareness of the other three slots' states), so an accidental
over-solve is structurally possible and currently unfiltered.

**Implication for §5 step 3:** implementing this requires knowing the true
post-solution state of all 12 pieces, not just the subset the solver
tracked — see §2 items 3–4 for the most relevant recyclable utility for
this.

### 4.4 Rotation-variant generation (`altAlgs`) is applied too broadly

`cross_xcross.js`/`backend_test.js` call `altAlgs([sol.moves])` on every
result they produce, including (in `backend_test.js`'s Phase 2) non-distance-1
results. Per spec, the y/y2/y' procedural-rotation trick is specifically a
distance-1 concept (choosing which side becomes "front" during the single
first-step search) — applying it to a later step would fabricate spurious
mid-solve reorientation variants of an algorithm whose orientation context
is already fixed by the committed path.

**Implication for §5 step 3:** scope `altAlgs`-style rotation expansion to
distance-1 candidates only.

### 4.5 FIXED (2026-10-04): Cross optimisation / wide-move post-processing now exists

**Implemented and verified — see §4.13 for the full writeup.** Kept below
as the original problem statement.

No code anywhere implements the `r/l/u`-wide rewrite, rotation-state
tracking, orientation-discard, or re-scoring described in the spec's "Wide
moves and Cross optimisation" section. This is net-new logic to write
against ordinary Cross results, not an existing feature to fix.

### 4.6 Existing test-harness search limits don't match the spec

| Step | `cross_xcross.js` | `backend_test.js` | **Spec (authoritative)** |
|---|---|---|---|
| Cross | 9 | 8 | **10** |
| XCross | 8 | 10 | **11** |
| XXCross | — | 11 | **12** |
| Single pair (later step) | — | 8 (phase2 "pair") | **10** |
| Multislot (later step) | — | 10 (phase2 "multislot") | **12** |

These two scripts are diagnostic harnesses, not the thing being built next,
so there's nothing to "fix" in them specifically — but whatever dispatch
code gets written for §5 step 3 should use the spec's numbers, not these.

**Note:** the spec's search-limits table does not give a number for
**XXXCross**, even though XXXCross is a named, still-in-scope checkbox
(only XXXXCross is explicitly out of scope). Not specified anywhere;
resolved experimentally as 13 moves (the `+1` pattern the given numbers
already follow) pending real-world evidence this needs adjusting.

### 4.7 CRITICAL: a later-step search must include every already-solved slot in its own goal, not just the new one(s)

Discovered empirically while building the step-3 dispatch logic (2026-10-03),
before this was ever shipped — not a production bug, a design trap avoided
during implementation. Hypothesis: for a later step (e.g. a "single pair"
search after an XCross already solved one pair elsewhere), dispatching via
`PersistentXcrossSolver(newSlot)` alone — mirroring exactly how a
*distance-1* XCross search is dispatched — would be the natural first
instinct, since that's the solver class whose name matches "solve one more
pair."

Tested directly: scripted solving an XCross at slot A, then another XCross
at a different slot B from the resulting compounded scramble, then checking
whether slot A was still solved afterward. Across 15 trials, slot A was
disturbed in **8 of them (~53%)**. The reason: `PersistentXcrossSolver`'s
IDA* coordinate space only tracks cross + the one slot it's constructed
with — it has zero awareness that slot A exists, so nothing stops a found
solution from moving slot A's pieces as a side effect.

**Fix, verified over 16 trials with zero disturbances:** dispatch using the
solver class whose *arity matches the total number of pairs that must be
solved after this step* (already-solved + newly-targeted), not just the new
ones — e.g. a single-pair step after one pair is already solved uses
`PersistentXxcrossSolver(oldSlot, newSlot)`, not `PersistentXcrossSolver(newSlot)`.
Concretely, by total-pairs-in-goal:

| Total pairs in goal | Solver class |
|---|---|
| 0 | `PersistentCrossSolver` |
| 1 | `PersistentXcrossSolver(slot)` |
| 2 | `PersistentXxcrossSolver(slot1, slot2)` |
| 3 | `PersistentXxxcrossSolver(slot1, slot2, slot3)` |
| 4 | `PersistentXxxxcrossSolver()` (no slot args — all four) |

This naturally covers every case, including "finish the last remaining pair
after XXXCross" (3 old + 1 new = 4 total → `Xxxxcross`). **This is not a
violation of the spec's "XXXXCross is deliberately not offered" rule** —
that rule is about never *offering* a distance-1 jump from the unsolved
node straight to all-four-pairs-at-once as a primary target; using
`Xxxxcross` internally to correctly finish an already-committed path's last
pair is a different thing entirely and never surfaces as a user-facing
"XXXXCross" result. **Update:** the search-limit number for a later step
also had to change as a result — see §4.8.

Not yet verified for the pseudo solver (`pseudoCrossSolver`) — defer that
check to when pseudo dispatch is actually wired up (§5 step 3); there is no
a priori reason to assume it behaves differently from `crossSolver` here,
but it hasn't been tested.

### 4.8 A later step's move-limit must scale with TOTAL pairs in goal, not stay flat at "single pair = 10 / multislot = 12"

Direct consequence of §4.7: since a later step must now be dispatched via
the solver class matching *all* pairs that have to end up solved (old +
new), the search is correspondingly more constrained as more pairs
accumulate, and a flat 10-move budget for every "single pair" step
(regardless of how many other pairs it also has to preserve) turned out to
be insufficient in practice. First discovered as a *correctness* failure
while building the step-3 loop (not a style preference): a real later-step
search (2 pairs already solved, 1 new) returned **zero solutions** at both
10 and 12 moves and needed 14.

Resolved by keying the later-step move limit off **total pairs in goal**
(1/2/3/4) instead of "single pair vs. multislot," using crossSolver's own
documented per-arity default maxLength for each total — `{1: 10, 2: 12,
3: 14, 4: 16}`. This is not an arbitrary table: for the *first* use of each
category it reproduces the spec's literal numbers exactly (total=1 from
Cross → 10, matching "single pair"; total=2 from Cross → 12, matching
"multislot"), and only extends beyond the spec's flat table for deeper,
more-constrained later steps the spec didn't originally distinguish.
Implemented as `searchLimitFor()` in
[solver-bridge.js](cube_tree_website/js/solver-bridge.js), covered by
[test/solver-bridge.test.js](cube_tree_website/test/solver-bridge.test.js).

**Known performance cost:** the total=4 ("finishing the last pair") case
uses `PersistentXxxxcrossSolver`, whose prune table is the largest the
engine builds (~22 MB). Measured cold-start cost for this one case: ~45
seconds for a single search in one trial, and over 8 minutes without
finishing in another (same scramble shape, fresh process) before being
killed. This is a one-time cost *per solver-class-arity, per browser
session* (the table is cached in the persistent worker and reused for
every subsequent "finish the last pair" search for any scramble in the
same session) — but it's a real, currently-unmitigated interactive-latency
problem for whichever scramble first triggers it. See §5 step 3 for
possible mitigations (not yet attempted): a progress indicator that sets
real expectations, pre-warming the Xxxxcross table in the background
during earlier steps, or investigating whether a tighter move-restriction
or different search strategy avoids needing the full 4-pair coordinate
space at all for what is, physically, usually a short remaining solve.

### 4.9 Luck filtering attempt #1: a solver-probe implementation was attempted and reverted — it was unreliable, not just slow

**Superseded — the real fix (a facelet-based cube-state check, not a solver
probe) is in §4.12, implemented and verified 2026-10-04.** Kept below as-is:
it's the reason the §4.12 implementation uses a real cube simulator instead
of another probe variant, and the failure mode here is still worth knowing.

Implemented, tested, and **reverted** on 2026-10-03. Worth recording in
detail because the failure mode is subtle and would be easy to
reintroduce.

**What was built:** for each candidate solution, probe every slot *not* in
the edge's own goal via a cheap `solveXcross(..., { maxLength: 1 })` call,
treating "0 `onProgress` (depth) events" as "already solved" — the exact
technique this document's own verified findings (slot mapping, color
orientation, §4.7) are built on, which all worked correctly when tested.

**What went wrong:** that technique is only valid when the probe's
`maxLength` comfortably exceeds the *true* solution depth for the
"needs search" case. IDA* with an admissible prune-table heuristic skips
announcing depths it can already prove infeasible (observed directly:
requesting `maxLength: 6` for a case whose real minimum depth was 7
produced **zero** `onProgress` events and an empty solution array —
indistinguishable from "already solved" from the outside — while
`maxLength: 11` on the identical call correctly found it, with progress
events starting at depth 7, not 0). Every earlier validated use of this
technique happened to use short, specifically-constructed test scrambles
(e.g. a single face turn, or the "sexy move" from a solved cube) where the
true "needs search" depth was always comfortably under the chosen
`maxLength` — so the ambiguity never triggered. A `maxLength: 1` luck-probe
against a real ~19-move WCA-style scramble is the opposite case: almost
any genuinely-unsolved slot has a true depth far above 1, so the probe
returned false "already solved" positives almost universally, making
nearly every real candidate look "lucky" and get discarded — confirmed
directly: on two different real scrambles, Cross, XCross, *and* XXCross
categories all returned **zero** surviving candidates, and spot-checking
individual "lucky" verdicts against a directly-run, adequately-deep search
showed the slot was genuinely not yet solved.

Separately (not the reason for reverting, but relevant to any future
attempt): even a *correct* version of this probe would need a `maxLength`
comparable to a real search of that category to avoid the ambiguity above,
which is expensive — for a Cross-only search (0 goal slots), that's up to
4 near-full-cost probes per candidate, across potentially dozens of unique
candidates.

**Conclusion:** solver probes are the wrong tool for luck filtering. The
reliable path is a real cube-state check — exactly what §2 items 3–4
(`CFOPflags.py`'s facelet-mask logic, ported to JS) were already flagged
for, now with concrete evidence for *why* the solver-probe shortcut doesn't
work rather than just "it wasn't built yet." Luck filtering remains
unimplemented; `solver-bridge.js` currently returns every raw (deduped)
candidate, including any that may over-solve. The rest of the loop
(dispatch, TPP scoring, commit, rotation handling) is unaffected and still
verified correct — this was caught and fully reverted before being
shipped as a silent correctness bug, not left half-working.

### 4.10 FIXED (2026-10-04): later-step searches produced invalid solutions, and every search showed duplicate rows

A developer note left in this document's previous revision flagged two
problems found by actually trying the tool: "the later single pairs and/or
multislots do not generate valid solutions, and all searches create many
duplicate solutions." Both were investigated end-to-end against the real
DAG and real `solver.wasm` (not mocked), and physically verified against a
real cube simulator (`magiccube`, via `pip`) rather than just re-reading the
code — the same "verify empirically" discipline §4.9/§1.2 already
established for this codebase. Both root causes were in
`solver-bridge.js`'s `searchCurrentNode`, not in the DAG or the solver.

**Bug 1 — invalid later-step solutions.** `searchCurrentNode` built a
later-step `scramble` by string-concatenating `session.scramble` with
`session.scoredPath` (the committed path so far), then passed `rotation:
session.rotation` to the solver call — the exact same pattern used
correctly for the very first call. The difference: `session.scoredPath` is
*already* text in the rotated frame the engine returned it in (per this
file's own header comment: raw solver output is `rotation + ' ' +
solution`, and the stored `coreAlg` is that `solution` with the rotation
prefix stripped — i.e. it's meant to be executed *after* physically doing
`rotation`, using that rotation's face labels). Pasting it into a fresh
`scramble` argument and passing `rotation` *again* makes the engine's
`AlgRotation` relabel it a second time — searching a bogus state that has
nothing to do with the real cube.

Verified directly: built a session for the documented smoke-test scramble
(white, no advanced options — a non-empty rotation, `z2`), ran step 1
(Cross) and step 2 (single pair) against the real solver, then took the
literal committed `scramble + rotation + stepAlgs` text the *old* code would
have executed and ran it through `magiccube`. Cross was solved after step 1
alone, but **broken** after step 1+2 together — on every single trial, for
every color except yellow (whose rotation is `''`, making the double-relabel
a no-op, which is almost certainly why this went unnoticed: plain-white
testing with the specific documented smoke scramble is the one case where
the bug is live).

**Fix:** pass the committed path via the solver's own `postAlg` option
instead of folding it into `scramble`. Reading `solver.cpp`'s
`start_search`/`start_search_persistent`: `post_alg`'s moves are applied
*directly*, continuing from wherever the (correctly-once-rotated) `scramble`
left the search coordinates — i.e. `postAlg` is interpreted in exactly the
already-rotated frame `session.scoredPath` is already expressed in, with no
further relabeling. `scramble` for a later-step call is now always
`session.scramble` unchanged; `postAlg` carries `session.scoredPath`. The
returned-solution prefix to strip changed to match: the engine emits
`rotation + ' ' + postAlg + ' ' + newSolution`, so the known prefix to strip
is now `[baseRotation, postAlgForCall].filter(Boolean).join(' ')`, not just
`baseRotation`. Re-verified the same way: cross (and each subsequently
claimed pair) stays physically solved after every committed step, including
a 3-step single-pair chain and a separate xcross→single-pair→multislot chain
that reaches full Cross+F2L completion (`isComplete: true`), both confirmed
against `magiccube` by color-identity (not just "a slot is occupied" —
actual corner+edge orientation/match).

**Bug 2 — duplicate rows.** Confirmed two independent, fully-redundant
sources of DAG edges, both in `tree_gen.py`:
1. `build_f2l_dag()` sets `rotations = ("-", "y", "y'")` whenever
   `is_cross_solved` is true — i.e. at *every* later-step node, not just a
   root-level color choice. This produces up to 3 edges per node that
   `extract_solved_slots()` labels identically (same `corners`/`edges`
   arrays), because that function only reports *which* pieces are solved,
   never which unsolved pieces got relabeled by the internal rot tag — the
   only thing that differs between the 3 copies.
2. `generate_pair_transitions()` loops `for edge_perm in
   permutations(edges)` for any `pair_size >= 2`, but `solve_pieces()` marks
   pieces solved by set membership (`for edge in solved_edges: ...`), never
   by position in that tuple — so every permutation of a given edge
   selection produces the exact same `next_state`. This duplicates every
   XXCross/XXXCross root edge and every multislot later-step edge by `N!`
   (2x for a pair, 6x for a triple).

Confirmed by instrumented count: a later-step node with 4 real actions
(single-pair to each of 4 slots) exposed 12 DAG edges; all 80 resulting
candidates (20 raw solver results × 4 slots) appeared in the table *exactly
3 times each* (240 total rows) — the `rotations=("-","y","y'")` tripling,
not the `permutations` one (pair_size=1 has only one trivial permutation).
A separate run with XXCross+multislotting enabled showed both effects (root
XXCross edges doubled by `permutations`, later multislot edges tripled by
the rot tag).

**Fix:** `searchCurrentNode` now dedupes `outgoingEdges()` by
`JSON.stringify([sortedCorners, sortedEdges])` of each edge's *target* node
before dispatching, for both root and non-root nodes. This is safe because
dispatch here is a pure function of the target's solved corners/edges (plus
session state) — any two edges that agree on that key are, by construction,
indistinguishable to this file regardless of *why* the DAG has both. No
`tree_gen.py` change or DAG regeneration was needed (lower risk: avoids
re-validating the committed 238-node/2393-edge baseline cited throughout
this document). Re-ran the smoke-test scramble: step 2 candidates went from
240 → 80 with zero duplicate `(alg, corners, edges, rotation)` keys (was 80
unique keys each appearing exactly 3×); step 3 went from 180 → 120, also
zero duplicates. The multislot scenario's step 1 went from 1360 → 880 (the
`permutations` 2x, confirmed by the exact halving), also zero duplicates
after the fix.

Both fixes are covered by existing unit tests passing unchanged (dedup and
`postAlg` logic don't touch anything `test/solver-bridge.test.js` already
pins down) — there is deliberately no *new* unit test added here, since the
actual bugs were only reachable by driving the real WASM solver end-to-end
and checking physical cube state, which is far too slow for a unit suite;
the Node diagnostic script used for this investigation was scratch, not
committed. If this area regresses again, re-verify the same way (real DAG +
real solver + `magiccube`), not by reasoning about the rotation algebra by
hand — see §4.11 for why that's a trap.

### 4.11 FIXED (2026-10-04): a distance-1 rotation-variant result could display the wrong slot name

**Fixed — see §4.12's final section for the implementation
(`relabelSlotsForRotation`) and the empirical derivation.** Kept below as
the original finding.

Found while verifying §4.10's fix, and *not* one of the two bugs the
developer note flagged — recorded separately because it's lower severity
(display-only, confirmed not to corrupt the actual solve) and because
fixing it correctly needs the same empirical rigor §4.9/§1.2 already had to
learn the hard way for this exact kind of rotation-algebra question.

**What's suspected:** for a distance-1 XCross/XXCross/XXXCross result
(`pairCount >= 1`), `searchCurrentNode` reads `newCorners`/`newEdges` once
per edge (the DAG's fixed label for that edge, e.g. `["FR"]`) and reuses it
for *every* `altAlgs` rotation variant of that edge's found algorithm,
without adjusting for which variant it is. Observed directly: in a session
with XCross enabled, the top-ranked (by TPP) distance-1 result was an
altAlgs `y'` variant labeled `corners: ["FR"]`, with `candidate.rotation`
(the full, composed setup rotation the user is told to perform) set to
include that `y'`. Replaying `scramble + rotation + coreAlg` for exactly
that result in `magiccube` and checking which physical slot ends up
genuinely paired (by color identity, not just "something is there") found
**BR** solved, not **FR**.

**Why this needs care, not a quick fix:** `candidate.targetNodeId` is always
the DAG edge's real target (set directly from `edge.target`, never derived
from the algorithm text), so the *session's* belief about which abstract
DAG node it's at — and therefore every subsequent search's dispatch — stays
internally consistent regardless of this. This looks like a display-only
bug (the "corners"/"edges" table columns, and the physical slot a human
would actually observe themselves solving, can disagree for a
non-identity-variant distance-1 result with `pairCount >= 1`), not a
solve-correctness one — unlike §4.10's bugs, this was not observed to
produce an invalid final state in either verification run. It's being
recorded rather than fixed now because the correct fix requires relabeling
`newCorners`/`newEdges` by the *same* rotation `altAlgs` applied to the
algorithm text — i.e. porting a slot-name analogue of `altAlgs`'s
`FACE_MAP`, a second piece of rotation algebra alongside the move-letter one
that already exists. Given this project's own track record on exactly this
kind of reasoning (§1.2's color/rotation finding: "verified empirically...
not just by re-deriving rotation algebra by hand, which produced a wrong
answer on the first attempt"), the right next step is a dedicated empirical
test (vary the rotation, use a real trigger algorithm, check with
`magiccube` which physical slot actually gets hit, the same method
§1.2/slot-mapping.test.js/§4.10 all used) before writing a fix, not a
hand-derived FACE_MAP-for-slot-names table. Not yet investigated further.

### 4.12 FIXED (2026-10-04): luck filtering implemented, plus a newly-discovered later-step dispatch bug found and fixed while verifying it

**Luck filtering (§4.3/§4.9) is now implemented.** Two new files:
[facelet-cube.js](cube_tree_website/js/facelet-cube.js) is a plain-JS 54-facelet
3×3 cube simulator (apply ordinary face turns plus whole-cube x/y/z
rotations to a Kociemba-convention facelet string). Its 9 base-generator
permutations (U/D/R/L/F/B/x/y/z) were **derived empirically against
`magiccube`**, not hand-derived — for each generator, many random scrambles
were run through both a "before" and "after" state, and for each output
position the set of input positions consistent with the observed color
transformation was intersected across trials until exactly one candidate
remained per position; every derived permutation was then independently
re-verified against 30 more random trials. The whole simulator is also
cross-checked bit-for-bit against 328 `magiccube`-generated cases (random
algorithms up to 30 moves, every single move token in isolation) in
[test/facelet-cube.test.js](cube_tree_website/test/facelet-cube.test.js) —
all match exactly. [facelet-flags.js](cube_tree_website/js/facelet-flags.js) is
a JS port of `archived_attempts/try_1/utils/CFOPflags.py`'s facelet-mask
slot-solved check (operating on the same facelet convention), sanity-checked
against the `R U R' U'` commutator this project's own
`crossSolver/test/slot-mapping.test.js` already established disturbs exactly
the FR pair from solved.

`solver-bridge.js`'s `checkCandidateAgainstRealCubeState` uses both: it
replays `[scramble, rotation, priorPath, coreAlg]` as literal moves (the
same replay order this file's header comment and §4.10 already established
is the correct physical reconstruction of a committed path) and compares the
resulting real solved slots against exactly what the candidate's DAG edge
claims (`allCorners`, the target's full old+new corner list) — a candidate
that solves more is discarded as luck (per spec, it belongs to a different,
higher-arity edge instead); a candidate that solves less is also discarded,
with a console warning, since that would mean the DAG/solver claim is
simply wrong. Verified on the documented smoke-test scramble: step 3's
candidate count drops from 120 (the §4.10 baseline) to 86 after luck
filtering alone, with the 34 removed candidates confirmed (via a temporary
diagnostic, not committed) to all be genuine over-solves of the committed
BR pair in an edge whose claim didn't include it.

**While verifying this end-to-end, a second, independent, and more serious
bug was found** — not a luck-filtering issue at all, but a pre-existing
later-step dispatch bug exposed by the same investigation. `tree_gen.py`'s
mid-solve y/y' exploration (§4.10 bug 2's `rotations = ("-","y","y'")` at
every cross-solved node, previously known only as a *duplicate-edge* source)
relabels ALL pieces' slot names when exploring from a rotated perspective —
including already-solved ones. For a node with, say, BR already solved, the
"y" exploration relabels that piece as "FR" (carried forward under the new
name) before selecting which additionally-unsolved piece to solve next; the
resulting target's `state.corners` genuinely does **not** contain "BR"
(e.g. `["BL", "FR"]` instead of `["BL", "BR", "FR"]`) even though the
*same physical BR piece* is still solved — it's just renamed. This differs
from the known duplicate-edge case (§4.10 bug 2) in a critical way: there,
multiple edges land on targets with *identical* labels (pure duplication,
safe to dedupe); here, a single edge lands on a target with *different,
non-superset* labels (not a duplicate of anything — a real, distinctly-named
target that silently drops a committed slot).

`searchCurrentNode` has no mechanism to apply this implied second rotation —
`session.rotation` is fixed once at the root commit and reused verbatim for
every later call (by design, per this file's header comment and §4.7/§4.10).
Taking such an edge's target labels at face value and dispatching via
`solverCallFor(helper, allCorners, ...)` therefore asks the solver to
protect the *wrong* slot (e.g. "FR", which isn't really at risk) while
leaving the *actually*-committed slot ("BR") completely unprotected —
exactly the §4.7 failure mode (an unprotected committed pair gets disturbed
close to half the time), just reached via a different, previously-unnoticed
edge class.

**Verified directly against the real WASM solver + a real facelet replay**
(not reasoned about by hand): for one committed session on the documented
smoke-test scramble (Cross, then BR as a single pair), 26 of the 86
luck-filtered step-3 candidates had a target whose full corner claim
excluded BR, and **every single one of those 26, when physically replayed,
had actually disturbed BR** — with no error, and a perfectly ordinary-looking
`type: "Single pair"` label (e.g. `corners: ["BL"]`). Luck filtering's own
check cannot catch this: both the (wrong) claim and the real outcome agree
BR isn't part of this edge, so nothing looks inconsistent from that check's
point of view. A separate, smaller investigation script run with the actual
fix in place (below) confirmed zero such candidates remain.

**Fix:** in `searchCurrentNode`, for any non-root search, filter out every
outgoing edge whose target's solved corners/edges are not a superset of the
*current* node's solved corners/edges, before the existing dedup/dispatch
logic runs. This is the direct DAG-edge-filtering analogue of §4.7's
dispatch-level fix (protect every already-committed slot), applied one level
earlier (at edge selection, not solver-call construction) because the
mislabeling here means the solver-call construction itself can't be trusted
for these edges. Re-ran the full 5-step smoke-test chain with the fix in
place: step 3 goes from 86 → 60 retained candidates (removing exactly the 26
disturbance cases, confirmed — none of the 60 remaining candidates have a
target that drops a committed slot), the chain still reaches a genuine,
independently-verified complete Cross+F2L solve (`isComplete: true`, and
separately confirmed via a full-path `facelet-cube.js`/`facelet-flags.js`
replay — `{cross: true, BL: true, BR: true, FL: true, FR: true}`), and the
top-ranked results at steps 1–2 are byte-for-byte unchanged from before
either fix (only step 3 onward, where the broken edge class exists, is
affected).

**A third, related, lower-severity finding surfaced while re-verifying the
fix, recorded but not fixed — the non-root analogue of §4.11.** Even after
the superset fix above, a later-step edge from this same mid-solve-rotation
family can still legitimately survive (its full target label set is a
correct superset) while its own per-edge "newly solved" label
(`edge.solved_step.corners`/`.edges`, shown in the UI as the result's
"corners"/"edges" columns) is wrong. Observed directly in the smoke-test's
step 5 (the "finish the last pair" step, 3 pairs already committed): the
top-ranked candidate displayed `corners: ["BR"]` — but BR was *already*
committed before this step, and the current node's state after committing
this candidate showed the new total was `["BL", "BR", "FL", "FR"]`, meaning
the piece actually newly solved was **BL**, not BR. Confirmed cosmetic only
— `allCorners`/`targetNodeId` (what dispatch and luck filtering actually
use) are correct for this edge, the superset filter above correctly allows
it through, and the final chain's independently-replayed state is fully and
correctly solved. This is the exact same class of bug as §4.11 (a rotation
applied to the underlying algorithm/state without equivalently relabeling
the *display* fields), just occurring for a non-root mid-solve-rotation edge
instead of a root `altAlgs` variant — strongly suggesting both should be
fixed together (likely the same underlying "relabel the display slot names
by whichever rotation was actually applied" fix), per the same
"verify-empirically-first" discipline §4.11 already called for.

**Update, same day: §4.11 and finding #3 above are now FIXED, and fixing
them surfaced a fourth, more serious issue in luck filtering itself — caught
before it was ever exercised against a non-trivial checkbox configuration.**
The relabeling rule was derived the same way every other rotation-algebra
fact in this document has been (never hand-derived): four different
single-pair-disturbing trigger algorithms (`R U R' U'` and its three mirror
analogues) were each expanded via `altAlgs`, and for each of the resulting
16 variants, `facelet-cube.js`/`facelet-flags.js` determined which slot was
*actually* disturbed. All four triggers agreed on the same cycle,
independent of the trigger's own original slot:
`CORNER_CYCLE = ['FR', 'FL', 'BL', 'BR']`, with a `y`/`y2`/`y'` token
advancing a slot 1/2/3 steps through that cycle. This exactly reproduces
§4.11's own prior empirical data point (claimed `FR`, `y'` variant actually
`BR`: index of `FR` is 0, `y'` is +3 steps, `CORNER_CYCLE[3]` is `BR`) — strong
independent confirmation the rule is right, not just internally consistent.
Implemented as `relabelSlotsForRotation` in `solver-bridge.js`, covered by a
self-verifying unit test in `test/solver-bridge.test.js` that re-derives and
checks the same mapping against `facelet-cube.js` rather than a hardcoded
table. For a root candidate, the display `corners`/`edges` are now this
relabeled set; for a non-root candidate (no `altAlgs`, no `yToken` — finding
#3 above), display is the set difference between the target's full claim
and the current node's own corners/edges, which needs no rotation algebra
at all.

**While wiring this in, re-examining `checkCandidateAgainstRealCubeState`'s
own call site surfaced the fourth issue: the luck check itself was built and
tested (above) using only the Cross-only/no-advanced-options smoke test,
which never exercises a root candidate with `pairCount >= 1` — so it was
never exercised against a non-identity `altAlgs` variant at all.** The luck
check was passing the *unrotated* `allCorners` label as the claim for every
candidate, root included — but per the finding above, a non-identity-rotation
root variant's real physical outcome matches the *relabeled* slot, not the
unrotated one. Left as originally written, the luck check would have
compared "physically solves `BR`" against "claims `FR`" for every such
variant and wrongly discarded it as a solver/DAG bug (the
"claimed solved but is not actually solved" branch) — silently throwing away
3 of every 4 candidate rotation variants for any root result with
`pairCount >= 1` (i.e. essentially all of XCross/XXCross/XXXCross), the
exact opposite of what luck filtering is supposed to do. **Caught before
this was ever exercised with a non-trivial checkbox configuration** — this
session's own earlier smoke-test verification (120→86→60, the §4.12 writeup
above) used `advanced: []`, so XCross never ran. Running the identical
scramble with `advanced: ['xcross']` surfaced hundreds of these false
"claimed solved but is not actually solved" warnings immediately. Fixed by
computing the claim once, correctly, as
`isRoot ? relabelSlotsForRotation(allCorners, yToken) : allCorners`, and
using that single corrected value for both the luck check and the display
label. Re-verified on the same XCross-enabled run: XCross candidate count
went from 79 (only the identity-rotation variants surviving, confirming the
bug) to 316 (≈4×, recovering the three previously-discarded rotation
variants per solution) with **zero** false "claimed but not solved"
warnings and zero display-label mismatches across all 316 when
independently replayed. Re-ran the same check with XXCross and XXXCross
also enabled (the relabeling logic applies per-slot, so it needed checking
for multi-slot claims too, not just the single-slot XCross case above):
1192 total root candidates (XCross 316, XXCross 480, XXXCross 316, Cross
80), 1112 non-Cross candidates independently replayed and checked against
their displayed claim — **zero mismatches and zero undetected over-solves**
across all of them.

Both the luck-filtering feature and the superset-safety fix are covered by
new unit tests in
[test/solver-bridge.test.js](cube_tree_website/test/solver-bridge.test.js)
(`checkCandidateAgainstRealCubeState`, using the same `R U R' U'`-commutator
methodology `crossSolver/test/slot-mapping.test.js` established) and by
[test/facelet-cube.test.js](cube_tree_website/test/facelet-cube.test.js).
The specific end-to-end real-solver investigation (counting 120→86→60,
confirming the 26 disturbances, confirming the final chain's independent
solved state) was done with scratch Node scripts, not committed — re-run the
same way (real DAG + real solver + `facelet-cube.js`/`facelet-flags.js`, or
`magiccube`) if this area regresses again.

### 4.13 DONE (2026-10-04): Cross optimisation (README "Wide moves and Cross optimisation") implemented

> **Correction (§4.19):** the "use `d`, not the README's `u`" deviation
> described below was a mistake: `u` (= D + y) is correct and `d` is U + y'.
> Committed results with a residual rotation were also broken. Fixed in §4.19.

New file [cross-optimization.js](cube_tree_website/js/cross-optimization.js),
wired into `searchCurrentNode` for root, Cross-only (`pairCount === 0`)
candidates, gated by a new `cross_opt` entry in `SolveSession`'s
`advancedOptions` (4th constructor arg; `solver-ui.js` now passes
`criteria.advanced` through when creating a session). Covered by
[test/cross-optimization.test.js](cube_tree_website/test/cross-optimization.test.js).

**The core mechanism, derived and verified empirically (never hand-derived
— see §1.2/§4.9/§4.10's standing rule, which this feature needed twice
over):**

1. **The six equivalences** the README states (`r=L+x`, `r'=L'+x'`,
   `l=R+x'`, `l'=R'+x`, and the D-layer pair, discussed separately below)
   were checked against `magiccube`'s own wide-move notation (`Rw`, `Lw`,
   `Uw`) for 20 random pre-scrambles each — not assumed from the README's
   prose, and not just checked from a solved cube. All six (plus the
   doubles, `Rw2=L2x2` etc.) held exactly.
2. **The relabeling rule**: converting one move (say `L`) to its wide form
   (`r`) doesn't just drop a redundant rotation — `r` is *defined* as
   "`L` then `x`", so the substitution secretly performs an `x` rotation
   the original algorithm never accounted for. Every move after that point
   must be relabeled to keep referring to the same physical layer. Solving
   "what should I type now, given a pending rotation `rho`, to achieve what
   the original move `M` intended" required a small equation
   (`compose(rho, M') == compose(M, rho)`); the closed-form solution
   (`M' = composePerm(invertPerm(rho), composePerm(M, rho))`) was verified
   by brute-force search over all 18 face turns (not assumed), for both a
   single generator (`rho=x`) and a composed one (`rho = x then y`), and
   shown to always yield a legitimate face-turn permutation.
3. **A short inductive argument** (by construction of the relabeling above)
   shows the whole rewritten sequence is exactly equal to "the original
   algorithm, followed by the final accumulated rotation" — which is why
   the orientation filter (keep only results whose final accumulated
   rotation leaves D mapped to D) is sufficient and correct: cross was
   already solved on D by the original algorithm, and appending a pure
   y-rotation can't move it off D, while any x/z component can and does.
   `optimizeCrossSolution` explores the full `2^k` subset space (k =
   algorithm length) of which eligible moves to convert, relabeling as it
   goes, and keeps only (deduplicated) combinations that survive the
   filter.
4. **`y2` is never used as a conversion's rotation increment** — `D2`'s
   only wide form would need one, and the README explicitly forbids y2 as
   a mid-algorithm move. `D2` is simply absent from the convertible set.

**Deliberate deviation from the README's literal notation (flagged, not
silently applied):** the README writes the D-layer equivalence as
`u = D + y`. Taken literally, this collides with this project's own solver
engine — `crossSolver/solver.cpp`'s move table groups `"u"` with the
U/E/y axis (`y_axis_order = {U:0, D:1, E:2, u:3, d:4, y:5}`), i.e. the
*engine's* `"u"` means conventional wide-U (top two layers), not wide-D;
`script.js`'s `algSpeed` likewise has a separate, distinct branch for `"d"`
with its own grip logic. Using the README's literal `"u"` would mean a
Cross-optimised result, once committed, gets silently misinterpreted as a
wide-U move the moment its text is fed back into the solver as `postAlg`
for a later step (or mis-scored by `algSpeed`) — a real correctness bug,
not a style question. This implementation emits the conventionally-correct,
solver-and-algSpeed-recognized `d`/`d'` instead; the underlying equivalence
(`D+y` / `D'+y'`) is unchanged, only the output letter differs from the
README's prose. Worth the user's attention since it's a deviation from the
literal spec text, even though it's clearly a bug-avoidance fix rather than
a product decision.

**Two integration bugs were found and fixed while verifying this
end-to-end against the real solver** (not just the isolated unit tests
above) — both are exactly the kind of mistake this project's "verify
empirically" rule exists to catch, and both would have been invisible from
unit tests alone since they only manifest once a cross-optimised result is
actually committed and chained into further dispatch:

- **Bug 1 — the reported `rotation` was wrongly also used as a literal
  leading rotation for the safety-net luck check.** `opt.rotation`
  (the residual rotation `optimizeCrossSolution` reports) is a *trailing*
  rotation that accumulates *during* the algorithm from wide-move
  conversions — unlike `baseRotation` (the genuine upfront inspection
  rotation) or `altAlgs`' `yToken` (also genuinely leading, stripped from
  the front of the variant text), it must never be prepended for literal
  replay. Composing it into the leading `rotation` parameter for the
  safety-net `checkCandidateAgainstRealCubeState` call corrupted the
  replay for almost every combination — confirmed directly: re-running
  3 real scrambles with `cross_opt` enabled before this fix produced
  dozens of false "claimed solved but is not actually solved" discards per
  scramble; after the fix, zero. The reported `rotation` field itself
  (`composeRotations(baseRotation, opt.rotation)`) was and remains correct
  for *display* and for *future dispatch* (once committed, the solver's
  `rotation` option only cares about the net accumulated rotation, not
  when during execution it happened) — only the literal-replay check
  needed the fix, using plain `baseRotation` paired with the already-fully
  -expanded algorithm text instead.
- **Bug 2 — wide-move text in a committed path crashed every later step's
  own luck check.** Once a cross-optimised result is committed,
  `session.scoredPath` (the running committed-path text) contains wide
  tokens (`r`, `l`, `d`, …) — but `checkCandidateAgainstRealCubeState`
  (used by *every* later step's own luck-filtering, not just
  cross-optimised candidates) passed that text straight to
  `applyAlgorithm`, which has no notion of wide moves by design and throws
  on an unrecognized token. Confirmed directly: committing a winning
  cross-optimised Cross result and then running the next (single-pair)
  search crashed immediately. Fixed centrally, in
  `checkCandidateAgainstRealCubeState` itself (not just at the
  cross-optimisation call site), by expanding any wide-move tokens in the
  *full* replay sequence back to their literal face-move+rotation
  definition (`cross-optimization.js`'s new `expandWideMoves`) before
  calling `applyAlgorithm` — this way every future caller is protected,
  not just the one call site that happened to trigger the crash first.
  Re-verified: committing a cross-optimised Cross result, then running the
  next step, then independently replaying the *entire* committed path
  (scramble + rotation + both committed steps, wide tokens expanded) now
  correctly shows cross **and** the newly-committed pair solved, matching
  the next step's own claim exactly.

**Does it actually help?** Across 4 real scrambles tested end-to-end
(real DAG + real solver, `cross_opt` enabled), a cross-optimised variant
was the single top-ranked (lowest-TPP) Cross result for 3 of the 4 — not
just a valid-but-worse alternative sitting in the list. A full 5-step
solve chain (Cross optimised + 4 single pairs) was carried through to
`isComplete: true` and independently re-verified against the real
committed path (wide tokens expanded), confirming cross and all 4 pairs
genuinely solved.

---

### 4.14 FIXED (2026-10-04): pseudo dispatch wired up; the "unreliable solver" finding was a misreading (free trailing D turn)

An earlier pass this day attempted pseudo dispatch, saw `pseudoCrossSolver`
return "solutions" that failed real facelet replay (cross broken, targeted
corner not home, 0/5 hit rate on some slots), and recorded the engine as
unreliable. **That was wrong.** Root cause, found in the follow-up pass:

**`pseudo.cpp`'s guarantee is "cross + the targeted corners/edges are solved
UP TO ONE FREE TRAILING D TURN."** A final `D`, `D2` or `D'` brings cross,
the targeted corner(s) and the targeted edge(s) home *simultaneously* (the
D layer is rotationally free in the search's goal test). The earlier probes
replayed the raw result without that final D, so cross and the pieces looked
broken. With the right D appended, results were exact: 24/24, then 96/96
across 6 colors, checked by real facelet replay (not by the solver's own
success signal). Nothing is wrong with corner targeting.

**What a pseudo DAG node is** (from `tree_gen.py` + real generated data):
a mismatch between `state.corners` and `state.edges`, e.g. corners `[BL]`,
edges `[FR]`. 180 of 238 nodes; symmetric difference always exactly one
corner-only slot and one edge-only slot. This includes root (distance-1)
edges, so pseudo needs the same `altAlgs`/`relabelSlotsForRotation` variant
treatment as matched root edges, applied to the corner and edge claim lists
independently. `pseudo.cpp`'s `solve(scramble, rotation, slot, pslot, ...)`
takes the edge home-slots and corner home-slots as two independent sets
(BL=0,BR=1,FR=2,FL=3), 1-3 pairs, and `postAlg` behaves as in crossSolver.

**Implementation (all in `solver-bridge.js` unless noted):**
1. `alignPseudoAlg(scramble, rotation, priorPath, coreAlg)`: replays the
   result, strips a trailing D-family token, tries the 4 possible trailing D
   totals, and returns the first alg whose replay has cross solved (`''` if
   the D merge cancels the whole alg; `null` if nothing aligns, which the
   caller logs and discards). **Design A:** the aligning D is merged into
   the committed alg so the committed path is physically exact for every
   later step. The cost: that D counts toward the path's TPP (a small,
   honest penalty; the alternative of leaving the offset un-applied would
   make later steps start from a state that is not the claimed one).
2. `pseudoCallFor(...)`: calls `pseudoHelper.solvePseudo` with independent
   edge/corner slot lists, `MOVE_RESTRICT`, `postAlg` and the cumulative
   rotation passed through the solver's `rotation` option (never in the
   scramble string, per the standing traps).
3. `searchCurrentNode(session, helper, onStatus, pseudoHelper)`: pseudo
   targets are dispatched when a pseudo helper is passed and the target has
   at most 3 corners; otherwise skipped as before. Candidates are labeled
   `... (pseudo)` via `edgeTypeLabel(pairCount, isRoot, isPseudo)`, and are
   deduped by (targetNodeId, rotation, coreAlg) after alignment because two
   distinct raw results can collapse to the same aligned alg.
4. **Luck filtering generalised** (`checkCandidateAgainstRealCubeState` gained
   an optional `claimedEdges` arg; omitted means "matched", unchanged
   behavior): per-piece `cornerAt`/`edgeAt` from `pseudoSolvedFlags` must
   match the claims; a slot counts as a complete pair only if both its
   corner and edge are home; any pair solved beyond the claim is luck and
   discarded, while a lone extra corner or edge piece is tolerated.
5. `solver-ui.js`: `ensurePseudoHelper()` lazily builds a
   `PseudoSolverHelper` (wrapping the unmodified `worker3.js`) only when the
   pruned tree has pseudo nodes; failure falls back to null (pseudo skipped).
   `solver.html` loads `pseudoCrossSolver/solver-helper.js`.
6. `script.js` exports `pruneGraph` (needed by the e2e harness).

**Verification:**
- Unit tests in `test/solver-bridge.test.js` use a real pseudo fixture
  (scramble `R F2 L F' D' B2 D' L2 R' D2 U2 B L' R D' U R' D2 F R`, rotation
  `z2 y'`, alg `R' D R U2 L2`: cross + corner BL + edge FR, no pair), plus
  alignment and merge cases and the label.
- `test/solver-bridge-e2e.js` (slow, real WASM, not part of the fast suite):
  drives full `SolveSession`s on random scrambles and independently replays
  each committed path, failing on any "claimed solved but not actually
  solved" warning or a completed session that is not a physically solved
  Cross+F2L. Flags: `--pseudo`, `--advanced`, `--scrambles`, `--seed`,
  `--pick top|random`, `--colors`, `--maxsteps`. A run with pseudo produced
  fully verified solves (e.g. 4 steps, 2 of them pseudo, 0 warnings).

**Broader verification (real WASM, random scrambles, random colors, `--pick random`):**
two completed runs, 11/11 sessions solved to a physically verified Cross+F2L, 38
steps (11 pseudo), 0 warnings, 0 bad finals. **In-browser** (the same scramble
with xcross + pseudo F2L checked): 1164 candidates, ~50 s total, `worker3.js`
loads, rows labelled `XCross (pseudo)`, top row is the real fixture alg.

**Known gap, performance:** `pseudo.cpp` rebuilds its prune tables on every
call (no persistent-table variant; porting it needs `emcc`, not available
here). A pseudo root step takes roughly 15-80 s in Node (about 12 distinct solver calls of ~2-3 s each for XCross; ~50 s in the browser) (an XCross pseudo
search with ~1700 pseudo candidates measured at ~79 s). Pseudo is off by
default in the UI; making it practical needs persistent tables or a
per-step candidate cap, see §5.

### 4.15 DONE (2026-10-04): full pseudo vs. simplified pseudo

Implements §4.1 option (b). `tree_gen.py` no longer drops non-repair
transitions out of a mismatched node; it keeps them and flags each edge
`full_pseudo_only = source has a mismatch and the edge is not a pure repair
of it` (judged in the source node's own labels, which is how
`solver-bridge.js` reads an edge). `is_valid_pair_state` (at most one
mismatched slot) is now applied to every transition; that changes nothing
for the old edges and bounds the new ones. Node set unchanged (238); edges
2393 → 6425 (4296 flagged). Export is now sorted per node, so regenerating
is deterministic (it used to depend on Python's string-hash seed).

`pruneGraph` drops flagged edges when `simplified_pseudo` is checked (new
checkbox on index.html, unchecked by default like every advanced option;
it has no effect unless "pseudo F2L" is also on). No bridge change was
needed: dispatch was already a function of the target's corner/edge sets.

**Verification:**
- `test_tree_gen.py`: the flag equals its definition on every edge, and the
  simplified subgraph has no dead ends. `test/script.test.js`: pruneGraph
  cases for both modes.
- At the level the bridge actually searches (label-level edges after the
  §4.12 superset filter, reachable from the root), the simplified-filtered
  superset is *identical* to the pre-change DAG (263 transitions); full
  pseudo has 539. The matched smoke test is unchanged (80/80/60/40/20).
- Real WASM (`test/solver-bridge-e2e.js --pseudo --pick full`): full mode
  6/6 sessions physically solved, 10 full-pseudo-only steps (mismatch →
  different mismatch, mismatch + extra pairs), 0 warnings, 0 frame
  failures; `--simplified`: 2/2, and at each mismatched node the only
  offers were the 20-candidate direct repair, as specified.

### 4.16 FIXED (2026-10-04): y-variant root commits put the session in the wrong DAG frame

**Symptom (found by browser verification of §4.15):** after committing an
XCross with rotation `z2 y` that physically filled BR, every next-step row
said "BR" again. Facelet replay showed those candidates actually filled BL.

**Root cause:** a root search runs once per colour with the colour's base
rotation; `altAlgs` then derives y/y2/y' variants, and §4.11/§4.12
correctly relabels each variant's *claim* for the luck check and the
display. But the candidate's `targetNodeId` stayed the unrotated DAG
target (labels `[BL]` while BR is physically solved). After commit, every
later search ran in the physical (`session.rotation`) frame but read the
node's labels as if they were physical: wrong display (set difference of
wrong-frame labels) and, worse, wrong dispatch. A target like `{BL, FR}`
asked the solver for BL+FR without protecting the real BR pair. The luck
check passed because it compared each result against that same
wrong-frame claim. On one scramble: 46/501 candidates mislabelled, **26/501
physically broke the committed pair**.

**Fix:** `rootTargetByLabels(session, trueClaimedCorners, trueClaimedEdges)`
commits the root target whose labels equal the rotation-corrected claim
(it always exists: the root's targets are closed under relabelling). After
the fix the same scramble gives 0/516 and 0/516; step 2 offers 60 valid
candidates instead of 46.

**Why earlier verification missed it:** the smoke test commits the top
result, which happened to be an identity variant; the e2e harness only
checked luck warnings and the final state (later steps re-solve a broken
pair, so completion still verified). New harness checks: after every commit
the node's claimed corners/edges must be physically home, and every offered
candidate must keep them home. Run against the pre-fix bridge it reports
frame failures; with the fix: matched, all 6 colours, cross-opt, 8/8;
XXXCross + multislotting, 6/6; full pseudo with y-variant roots, 3/3; all 0
frame failures, 0 warnings.

Also fixed: the cross-optimisation path logged *expected* luck discards via
`console.warn`, which the e2e harness counts as bugs (seen as 23 "warnings"
on a cross_opt run); it now warns only on a real "claimed but not solved".

**Headless-browser verification (no extension needed):** a small CDP
driver (headless Chrome, Node's global `WebSocket`) loaded index.html,
generated scrambles, checked boxes, navigated to solver.html, waited for
results, clicked a row and read the table: no exceptions or console
errors; after-commit labels physically spot-checked with the facelet sim.

### 4.47 DONE (2026-10-07, twenty-fifth pass): naturalness language model replaces the per-turn cost

**Request.** The user found the ranking worse since §4.46: the top results
were far less ergonomic. Asked for a new, creative way to put the fastest
algs on top (pro solves a good reference; revert only as a last resort).

**Diagnosis.** 30 random-state scrambles (seed 101, the pair-compare pool's
configs: xcross + xxcross + cross_opt + pro moves + multislot, every third
with pseudo) walked through `SolveSession` + `searchCurrentNode`, every
candidate of all 92 lists kept (pieces recovered from TPP), then re-ranked
offline under the pre-§4.46 scoring ("old"), §4.46 ("HEAD") and candidates.
§4.46's flat 0.5 per turn trades awkward-but-short for fluent-but-longer:
`R U2 F U' F' R'` went to #1 above `y' U R' U' R U2 R U R'`, `y F' L2 F U
L2 U2 L U L2` into a top 5, first steps gained `U L2 z' U f U' L' U2 F' D'`
and `U R2 L F z R' D' R2 f' D'`. Exact pro ranks (full lists, no sampling):
old 1.020 mean log10 rank / top 10 41; HEAD 1.170 / 37. Both versions put
machine-looking algs on top (`y U R2 U2 F R F' U2 R2`): MCC simulates each
finger movement but has no notion of a familiar sequence, which humans
execute as one motion (and the pro references' own note: pros prefer
"spammable" solutions).

**The model** (js/script.js, `buildNaturalnessModel`, `algSurprise`): a
language model of cube moves. Interpolated Kneser-Ney trigram (discount
0.75, 2% uniform floor, vocabulary: 54 move/rotation tokens + end) over the
alg's tokens after its leading rotations (free, like stepPenalty); a mid-step
rotation is a token (an earlier variant that restarted the context at every
rotation let `U l' x' U2 R U R' U' R` look natural). Training algs:
`HUMAN_F2L_ALGS` (standard F2L algorithms as commonly taught: basic
inserts and triggers, the 41 cases with usual alternatives, back-slot and
left-slot inserts without rotation, keyhole; written for this pass, not
taken from the pro solves) and `PRO_STEP_ALGS` (the 66 pro steps, 3 times),
every alg also left-right mirrored. `algSurprise` = sum of -log2 P(move |
two previous) plus the end token; e.g. `U R' U R U2 R' U R` 14.3 bits
(1.8 per move), `y U R2 U2 F R F' U2 R2` 44.1 (4.9 per move). Hot path: a
trigram table indexed by token ids, filled on first use: 2.4 us per alg
(MCC is ~25 us), identical to the reference implementation on 10k algs.

**Scoring.** `stepPenalty` = the old penalties (D/F/B/wide/slice/mid-y,
unchanged) + `STEP_PENALTIES.natural` x algSurprise; `turn` is gone. A
familiar move costs ~0.3, an unexpected one ~1, so length still costs,
but mostly where it breaks the flow.

**Selection** (scratch harness: exact pro ranks over the cached `--app`
pools, leave-one-solve-out for the language model; developer pairs; the
92 lists):

| model | pro all | root | later | top 10 | top 100 | top 500 | pairs right (in-sample) |
|---|---|---|---|---|---|---|---|
| old (pre-§4.46) | 1.020 | 2.210 | 0.539 | 41 | 51 | 59 | 29.5/56 |
| HEAD (§4.46, turn 0.5) | 1.170 | 2.522 | 0.624 | 37 | 49 | 58 | 39/56 |
| F2L corpus only, w 0.2 | 1.032 | 2.595 | 0.400 | 43 | 52 | 58 | 41/56 |
| + pro steps x3, w 0.2 | 0.970 | 2.404 | 0.390 | 43 | 54 | 60 | 41/56 |
| **+ pro steps x3, w 0.15** | **0.967** | 2.366 | 0.402 | **43** | 53 | **60** | 43/56 |
| + pro steps x3, w 0.25 | 0.972 | 2.438 | 0.379 | 43 | 52 | 60 | 41/56 |

Rejected variants: summed surprise with turn 0.5 kept (worse everywhere);
charging only bits above a threshold (2-4 bits; no better); order 2 (root
better, later worse), order 4 (worse); halving the old penalties (worse:
they still carry information the corpus does not); wide r/l 1.2 or 1.8 at
every step with the model (flat). Root steps stay behind "old", which had
the first-step-only r/l discount the user removed (one function for every
step); they are better than HEAD.

**Developer comparisons** (`tools/fit-alg-speed.js`, 10-fold CV x3; the
model was never fitted to them): held-out strict accuracy with `natural`
0.15 73.2% (HEAD) -> 76.8%; fitting `natural` alone gives 0.12 (75.0%,
log-lik -0.987, same as HEAD's fitted `turn`). 0.15 is where both sources
agree (pro benchmark flat from 0.15 to 0.25).

**Repo benchmark**: `tools/pro-ranking.js --app --sample 0` now gives each
solve a model trained without it (`buildNaturalnessModel({ excludeSolve })`,
`useNaturalnessModel`); `--in-sample` uses the app's. Result 1.170 / top 10
37 / top 500 58 -> 0.967 / 43 / 60, matching the harness.

**Top-5 check on the 92 lists** (HEAD -> new): later steps, top-5 entries
with a mid-step x/z 8% -> 6%, a B turn 12% -> 10%, u/d/f 20% -> 15%, above
4 bits per move 87% -> 76%; MCC 11.60 -> 11.41. Where a natural alg is in
the list it now usually wins (s5.2: `y' U R' U' R U2 R U R'` and its
mirrors fill the top 5; s2.2 `y F U F' U L' U' L` enters).

**Not done / found.** Many remaining unergonomic tops have no natural
alternative in their list at all: s10.4 (last pair, 75 candidates, the most
natural is `y U R2 U2 F R F' U2 R2`), s6.3: the engine returns the shortest
solutions and the 10-11 move human algs are missing. Ranking cannot fix
that; the next lever is search coverage (e.g. a later-step pass seeded with
the human corpus' algs, or a deeper R/U/F-restricted search for the last
pairs). Multislot steps' piece bonus in TPP (s23.2) is the other.

**Checks.** All unit suites (script.test.js: new naturalness tests; the
solver-bridge memo test now expects the step-penalty difference, not only
rotMidY). E2E: pro-references (44/66, unchanged), wide-spellings,
search-options, lookahead, cubedb-export, solver-bridge (3 scrambles): all
pass. Headless Chrome (index -> solver, two steps): no console errors,
`algSurprise` loaded in the page. Comparison pool rebuilt with the new
scoring (`pair-compare.js pool`, same settings: 320 lists, 17,066 algs);
`pair-compare stats`: 43/56 answered pairs ordered right (38 under §4.46).
Cache-buster 20261007a -> 20261007b (engine unchanged).

### 4.46 DONE (2026-10-07, twenty-fourth pass): first fit on the pairwise comparisons; one step-independent stepPenalty; never a wide B

**Data.** 101 answers (89 select, 9 random, 3 repeats; answer times 3 s to
45 min, the long ones are breaks). Committed raw first (333a750). Then every
answer with a wide `b` in either alg deleted from
`data/speed_comparisons.jsonl` (user request, the raw log stays in git
history): 14, and in every one the `b` alg had been judged slower or the
other alg chosen. Left: 87 answers, 81 pairs, 56 strict, 25 too close, 4
skips, 158 derived comparisons, no contradictions; repeats 1 of 2
consistent.

**Never a wide B (README "Wide moves").** Sources found in the old pool:
1,521 of 17,919 items, 341 of them first steps (the engine's `r`/`l`
relabelled by an inspection `y`, cross optimisation) and the rest wide
spellings (`B`/`F` -> `b`, and an `r` relabelled after a `d` conversion).
`hasWideB` (solver-bridge.js) is checked in postProcessCall's `push` (every
candidate passes it) and in `dedupeSolutions` (the end of `rankCandidates`
and every `mergeRanked`); `wideConversions` never converts to `b` and
`wideSpellingParts` rejects a spelling containing one. Unit tests: bridge
(hasWideB, dedupe/merge drop), facelet-cube (1500 random algs' spellings,
none with `b`), pair-compare (indexPool skips them). Real engine
(searchWithLookahead depth 1, 6 random-state scrambles, 3 with pseudo, 6
steps each): 31,272 rows, 0 with `b`, 12,264 with other wide moves. Info
dialog text now lists `r l u d f`.

**Fitting** (`tools/fit-alg-speed.js`, new). One model for every step:
time = algSpeed(alg) + stepPenalty(alg). Ordered logit with a "too close"
band (scale s and band c fitted), direct verdicts weight 1, derived ones
1/(1+dist) recomputed from the training fold only, ridge prior towards the
current values (relative to max(|v|, 0.5)), pattern search. 10-fold CV
over pairs x 3 repeats; held-out strict accuracy and log-likelihood per
answer (ties included). "current" = old constants as one step-independent
function (later-step values everywhere), s and c fitted:

| free parameters | best lambda | held-out strict right | held-out log-lik |
|---|---|---|---|
| none (current) | - | 62.5% | -1.086 |
| all 19 (MCC + penalties + turn) | 1 | 76.8% | -1.219 (worse) |
| MCC only | 1 | 72.6% | -1.087 |
| penalties incl. turn | 10 | 72.0% | -1.020 |
| **turn only** | 1 / 0.3 | 73.8% / 73.2% | **-0.997 / -0.983** |

All-parameter fits order a few more held-out pairs right but are
overconfident (log-likelihood worse than not fitting): overfitting 56
answers. The single new `turn` cost (fixed cost per face, wide or slice
turn; rotations excluded) is the robust signal: the slower alg had more
turns in 25 strict pairs and fewer in 4; MCC alone agreed 29/22. Full-data
fit: 0.785 (lambda 1), 0.994 (0.3), 0.563 (3). Fixed values, in-sample
(1 parameter): turn 0 -> 30/56, ll -1.033; 0.3 -> 39, -0.993; 0.5 -> 38,
-0.968; 0.8 -> 39, -0.942; 1.0 -> 38, -0.932.

**Secondary check** (`tools/pro-ranking.js --app`, mean log10 rank of the
66 pro steps; top 10; top 500): old split penalties 0.929; 39; 59. One
function, turn 0: 0.968; 39; 58. turn 0.5: 1.098; 37; 58. turn 0.8: 1.172;
37; 55. turn 1.0: 1.251; 37; 54. Chosen: **turn = 0.5**, the lowest value
that keeps nearly all of the comparisons' gain; higher values buy little on
the comparisons and keep costing the pro benchmark. Coverage
(`pro-references-e2e.js`) 44/66 before and after.

**Result.** `STEP_PENALTIES` = { D 1.06, F 0.86, B 2.22, wideRL 2.35, wideUDFB
2.5, wideOther 3.31 (slices only now), rotMidY 3.70, turn 0.5 };
`stepPenalty(alg)` (the old second argument is gone; callers in the
bridge's `stepsPathCost`, pro-ranking, pair-compare updated). `pair-compare
stats`: the current model orders 38/56 answered pairs right (27/56 before;
that count used first-step values for first-step algs). Not refitted:
ALG_SPEED_DEFAULTS (MCC) and the other penalties, by design -- refit when
there are a few hundred answers; the CV table above is the bar.

**Checks.** All unit suites; e2e: pro-references (44/66), wide-spellings,
search-options, lookahead, cubedb-export, solver-bridge (3 scrambles,
--pro): all pass. Candidate pool rebuilt with the new scoring (308 lists,
16,635 algs). Page assets cache-buster 20261006x -> 20261007a (engine
unchanged, ENGINE_VERSION kept).

### 4.45 DONE (2026-10-06, twenty-third pass): pairwise speed-comparison tool (roadmap 7a)

**What exists.** `cube_tree_website/tools/pair-compare.js` (CLI) on top of
`tools/pair-compare-lib.js` (pure logic, no engine, no terminal):

- `node tools/pair-compare.js` -- interactive: clears the screen, shows A and
  B (bold, moves spaced), A/B order random. Keys: `a` / `b` faster, `=` (or
  `e`) too close, `s` skip, `u` undo (appends a retraction and asks the same
  pair again), `c` shows the step context (first / later step, step types,
  best rank in a real list, pro), `q` / Ctrl-C quit. The header shows answers
  this session, direct + derived pair counts and open contradictions. The
  model's own scores are **never shown** (they would bias the judge). The
  time from showing to answering is stored (`ms`), the answer is the data.
  Needs a TTY.
- `stats` -- answers by reason, direct (strict / tie) and derived counts,
  open contradictions with their algs, self-consistency on repeats, how
  often the current alg_speed orders the answered pairs the same way (the
  7c baseline), answered algs per feature, fitted model scale.
- `export [file]` -- every direct and derived comparison as JSON
  (`faster`, `slower`, `tie`, `dist`, `direct`, `votes`) for 7c.
- `pool` -- rebuilds `data/speed_pool.json` from the real bridge
  (`--scrambles 80 --top 40 --sample 15 --seed 7`, ~10 min).

**Candidate pool** (`data/speed_pool.json`, 1.4 MB, committed so 7b can start
without the engine): random-state scrambles walked through `SolveSession` +
`searchCurrentNode` (the app's ranking), at every step the top 40 results
plus 15 drawn from further down (D/F/B, wide and long algs rarely reach the
top); the step committed to continue is drawn from the top 5. Two configs:
xcross + xxcross + cross_opt + pro moves + multislot, and every third
scramble the same plus pseudo F2L. Then the 19 pro solves replayed through
the bridge with the pro's own steps committed (66 lists); the pro step is
in its list, flagged `pro` (24 of 66 are in the top 40; the rest added with
their rank). Result: 326 lists, 17,567 distinct algs (5,464 first-step).
`searchWithLookahead` lists were not used: the look-ahead re-ranks the same
algs. No list contains a slice move (M/E/S); the `slice` feature stays at 0
until the pool has some.

**Storage** (`data/speed_comparisons.jsonl`, created on the first answer):
one JSON line per answer -- both algs (normalised: single spaces, `R2'` ->
`R2`; the alg text is the identity, no commutation or mirror merging), the
answer as shown (`a`, `b`, `tie`, `skip`), step contexts, both current model
times, `model` (hash of ALG_SPEED_DEFAULTS + STEP_PENALTIES), `reason`
(`select`, `random`, `repeat`, `contradiction`), `repeat`, `ms`, timestamp.
Undo appends `{type: 'retract', id}`; nothing is rewritten. A torn last line
(crash mid-write) is ignored on read.

**Inference** (`comparisonGraph`): each pair's answers are votes; verdict =
majority, a tied count takes the latest. Tie verdicts merge algs into
classes (union-find); strict verdicts are edges between classes. Strongly
connected sets of classes (Tarjan) and strict edges inside a tie class are
contradictions: listed, excluded from inference (a direct answer still
stands), and their pairs re-asked weakest first (fewest answers, then oldest),
each at most once more -- a set the developer re-confirms is a genuine
intransitivity and is left alone. Closure: bitset reachability over the
condensation. Counts: derived = implied pairs (ordered + same tie class)
minus direct ones. `derivedComparisons` gives each derived pair its shortest
chain length (`dist`) for weighting; validation in 7c must use direct
answers only, split by alg.

**Selection** (`selectPair`, ~40 ms on the real pool): (1) an open
contradiction's weakest pair; (2) 5%: a spaced repeat (an answer at least 40
answers old, each pair repeated once); (3) 10%: a random eligible pair;
(4) otherwise the best score over ~6-7k sampled candidates (all pairs among
the top 15 of 40 random lists, 30 random pairs per list, 800 close-in-model-
time pairs across lists, 600 pairs touching already-answered algs). Score =
ambiguity (1 - |2p - 1|, p = logistic in the relative time difference, its
scale fitted by maximum likelihood once 30 strict answers exist) + 0.8 impact
(both near the top of the same real list) + 0.5 coverage (features with few
answered algs: D, F, B, r/l, u/d/f/b, slices, leading / mid-step rotations,
length) + 1.0 connect (joins two components 1, a new alg next to answered
ones 0.8, unresolved inside one component 0.5, two new algs 0). Never asked:
answered or implied pairs, skipped pairs, algs in two skipped pairs, the
last 10 pairs; algs from the last 3 pairs score x0.5 (otherwise the
"extend" pull showed one alg in 4 of 5 consecutive questions).

**Tuning by simulation** (synthetic judge = algSpeed with other constants
+ a D/B surcharge + 5% noise, ties within 3%; 400 answers on the real pool):
derived pairs 315 with the first weights (connect 0.4, no
answered-alg candidates), 959 with connect 1.0 and answered-alg candidate
draws, 908 with the recent-alg factor. 1500 answers: 1441 direct -> 5633
comparison points (3.9x). A real judge's consistency will change the
multiplier; `stats` reports it.

**Differences from the roadmap design.** Regrips are not a coverage
feature (algSpeed does not expose grip changes; the proxy "D/F/B mid-alg"
matched 92% of the pool). The selection's "fitted model" is the current
model with a fitted logistic scale, not a fitted alg_speed (that is 7c).
Pool lists come from `searchCurrentNode` only (see above).

**Checks.** `test/pair-compare.test.js` (17 tests): normalisation and
features; log append / retract / torn line; closure (chain of 10 answers ->
45 comparisons, `dist` of the far pair 9); ties; vote majority and
latest-wins; a cycle reported, not inferred through, weakest pair first,
re-asked once then left, resolved by a flipped vote; a strict answer inside
a tie class; skips; 300 selections never ask a known pair; spaced repeats;
close/high-impact pairs beat clear-cut ones; connect values; fitted scale
small for a perfectly ordered judge and large for a coin flip; stats. The
interactive loop was driven through a pseudo-terminal (`script`): answers,
tie, skip, undo (re-asks the pair), context toggle, quit with stats; the
log lines were as expected. All other unit suites pass; no app code changed.

### 4.44 DONE (2026-10-06, twenty-first pass): "no R2/L2" option removed, unorthodox R2 by displacement, scoring vision

**Removed: "no R2/L2 after step 1".** It was a temporary fix (it removed every
half turn from later searches, orthodox or not); the unorthodox filter now
covers what it was for. Gone: `withoutR2L2`, `hasR2L2`,
`SolveSession.noLaterR2L2` and its part of `searchSettingsKey`, the
`noLaterR2L2` search option, the results-page checkbox and its cache-key
part, the info-dialog sentence, the README section. Later-step engine calls
always get the full move list again (unit test: R2 and L2 present), so the
second engine move list (and its second set of prune tables, §4.40) no
longer exists. `loadViewPrefs` deletes a saved `noR2L2`.

**Unorthodox R2/L2 by displacement (README "Unorthodox steps").** The user's
rule: displacement starts at 0, R +1, R' -1; an R2 is executed in whichever
direction keeps the layer within one quarter turn -- from +1 as R2' (to -1),
from -1 as R2 (to +1); from 0 it must reach +-2, so the step is unorthodox.
`isUnorthodox` now computes exactly that (signed, `turn(d, t)`), instead of
the equivalent mod-4 count. Equivalence checked on 200,000 random algs over
R/R'/R2/L/L'/L2/r/r2/l'/U/U'/y/F/u: 0 differences, so no result changes
flag. Tests: the user's example `R U R2 U' R` (1, 1, -1, -1, 0) orthodox;
`R2`, `L2`, `U R2 U'`, `R U R' R2` unorthodox. e2e (`search-options-e2e.js`,
real engine, later step after the best cross): 2540 R2/L2 results, 218 of
them orthodox (e.g. `y L U' L2 F' L F L`), flag == `isUnorthodox` for every
row, every row physically exact; root never flagged.

**Browser (headless Chrome, local):** no `no-r2l2` control; a saved view with
`noR2L2: true` loads and is dropped from storage; step 2 first page 36 R2/L2
rows of 100; "hide unorthodox" hides 2012 of 5165 and keeps orthodox R2 rows
(`U' R U' R2 F R F'`, `R' U2 R2 y R' F' U2 R`); no console errors.

**README vision.** New subsection "Future: one scoring algorithm for every
step": alg_speed should be the same algorithm at every step; the first-step
r/l and u/d/f/b values are a data-shortage stop-gap; planned for later, once
enough pro solve data exists to fit and hold-out-check one model; called out
as arguably the most important part of the site (execution-speed ranking is
what differs from other solvers). Roadmap item: gather more pro solves
(`data/pro_references.txt`), then refit a single step-independent penalty set
with `tools/pro-ranking.js` and compare against the current split.

### 4.43 DONE (2026-10-06, twentieth pass): wide-move spellings, unorthodox steps, exact dedupe, results-page options

**Wide-move spellings (README "Wide-move spellings of F2L steps").** In piece
terms `u` = `D y`, `d` = `U y'`, `f` = `B z`, `b` = `F z'` (checked by
permutation). `wideSpellingParts(alg)` walks the alg with a frame deviation
delta (written so far == alg's prefix, then delta): each token is written
relabelled by delta (`conjugateToken`); a D/U/F/B face turn may instead be
written as the wide token `wideTokenFor(turn, rho)` (delta := delta*rho); an
explicit rotation may be absorbed when delta != identity. Result: spellings
physically equal to "alg, then a y-family rotation". Filters: >= 1 u/d/f/b,
<= 2 conversions, end rotation y-family (cross stays down, so f/b come in
pairs), no more explicit rotations than the alg, strictly fewer awkward
tokens (D/F/B/x/y/z), no more F/B turns, one wide family. Measured on a real
later step (202 base algs): unfiltered 615 spellings, single family 284;
mixed families never ranked better than ~300th. Generation ~4 ms per search,
scoring dominates.
- Applied in `postProcessCall` to every later-step candidate (matched: node
  read off the physical replay, shared with rotation spellings via
  `nodeAfter`; pseudo: the claim relabelled with `relabelSlotsForRotation`,
  whose direction was checked empirically: labels after a trailing rot).
- **Not at the root:** root candidates 14.1k -> 28.7k and root time
  2.5 -> 4.0 s on the probe scramble; the root already has cross-opt `u`,
  engine `r/l` and side-cross inspections.
- Cost on later steps: depth-4 look-ahead warm JS 0.75 s -> 2.0 s with the
  unfiltered generator; with the final filters later-step lists grow ~1.4x
  (e.g. 1282 -> 1849 results).

**Scoring.** `stepPenalty` charged every u/d/f/b 3.31 (`wideOther`, fitted
with zero positive examples: no pro solve uses them), so `f R' f'` (MCC 4.10)
tied `B U' B'` (MCC 6.20 + 2 x 2.22). Split `wideUDFB` (later steps) from
`wideOther` (first-step u/d/f/b and M/E/S). `tools/pro-ranking.js --penalty
wideUDFB=...` on fresh `--app` pools (built with the new spellings):

| wideUDFB | mean log10 rank | top 10 | later steps top 10 |
|---|---|---|---|
| 0 | 1.190 | 32 | 28/47 |
| 1 | 1.007 | 41 | 37/47 |
| 2.25 | 0.969 | 42 | 38/47 |
| **2.5** | **0.949** | **44** | **40/47** |
| 3.31 | 0.943 | 44 | 40/47 |

Monotone, as it must be. 2.5 = the lowest value keeping the top-10 count.
Lowering the FIRST step's u/d/f/b as well moved root pro steps down (#12
xcross 486 -> 555, out of the top 500) through the pre-existing root
spellings, hence the split. Pre-pass pools (HEAD worktree): 0.970 / top 10
43 / top 500 60; now 0.949 / 44 / 60.

**Unorthodox.** `isUnorthodox`: R and L layer counts mod 4 (R/r +1, R' -1,
R2 2; same for L/l); 2 at any point = unorthodox; y/z-family tokens (y z u d f
b E S) reset both. The user's example `R U R U' R' U' R2 U R` is flagged,
`R U' R2 U' R` is not. Interpretation choice: "displacement greater than one"
read physically, as the layer being a half turn away (+2 and -2 are the same
position), so `R' U R'` and an `R2` from home are unorthodox too. Flag set in
postProcessCall for later steps only (it travels through the post-processing
workers); the results-page filter is a searchWithLookahead filter, so look-
ahead follows it. On probe solves 25-50% of later-step results are flagged
(e.g. `F' L2 F L2`).

**Exact dedupe.** `dedupeSolutions` (rotation + alg text, first kept) runs at
the end of `rankCandidates` and in `mergeRanked`. Probes on HEAD and now
found 0 such duplicates in single searches (the existing key
target|rotation|commuteNormalize(alg) already covered them); the new
guarantee matters for merged lists (wide toggle) and costs one Set pass.

**Wide-moves toggle.** `session.wideMoves` (default true) is a search
setting: engine `allowedMoves` without r/l (`withoutWide`), no cross-opt,
side-cross or wide spellings, and a final guard drops any wide/slice alg.
`searchSettingsKey` now includes it at the root too (multislot / R2L2 still
only later). memoSearch looks up the same step's search with the other
setting (`wideTwin`): off with an on-search known = that list filtered
(partials too; no engine call); on with only an off-search known (finished,
not truncated) = the wide search, each partial and the final list merged with
the off list (`mergeRanked`), first emitted at once. Not under a time
limit (a cut-short list is never reused, as before). Browser (headless
Chrome, 2 scrambles): off 2 ms, rows never cleared, no wide alg on screen;
on again identical first page; at a step searched without wide moves,
switching on kept the 25 rows while searching and grew 2,100 -> 4,786.

**UI.** Results controls in three fieldsets (search: multislot, wide moves,
no R2/L2 after step 1; filter: hide unorthodox, simple pseudo only;
look-ahead), page size on the right; `title` hints on every option and column
header; status "N results · M hidden by filters" (`filterResults(...,
countHidden)`); `.moves` spans keep move case (body is lowercased by CSS, so
"R2/L2" used to render as "r2/l2", i.e. wide moves); filters and the wide
toggle re-render without first clearing the table (`runSearch({ keepRows })`);
info dialog sections "search options", "filters", "look-ahead". Screenshots
at 1280 / 820 / 390 px.

**Tests.** Fast: facelet-cube (user examples + 1500 random algs, 3278
spellings, all physically "alg then rotation" and within the rules),
solver-bridge (unorthodox cases, dedupe/merge, isWideAlg/withoutWide, wide off
drops exactly r/l from every engine call, settings keys). Real engine: new
`test/wide-spellings-e2e.js` (physical replay of every later-step u/d/f/b
result on two solves, first page reached, unorthodox filter incl. look-ahead
and hiddenCount, wide-off twin with 0 engine calls, off-then-on superset with
no shorter partial; `--pseudo`: 7,887 pseudo-solve results replayed). Re-run
and passing: search-options, wide-moves, lookahead, progressive,
cubedb-export, offload, solver-bridge-e2e --pro, pro-references-e2e.

### 4.42 DONE (2026-10-06, nineteenth pass): Cubedb export, results-page polish, search reliability

**Cubedb export.** The user added a reference link to the end of
`data/pro_references.txt` (the pro-references parser ignores it: the line
holds `//` but no solve is open). Format, from that link: `puzzle=3x3`,
`scramble=` and `alg=` with spaces as `_`, primes as `-`, then
`encodeURIComponent` (`//` -> `%2F%2F`, newline -> `%0A`; parentheses stay).
`solutionLines(session)` writes the committed solve like the reference file
(`<rotation> // inspection`, first step labelled by type, later steps by the
pairs solved after them: `2nd pair`, `3rd/4th pairs`, `(pseudo)` marked);
`cubedbUrl(scramble, lines)` builds the link. Verified: the example link is
rebuilt byte for byte; three complete real-engine solves (four colours with
an inspection rotation; a wide first step + multislot; a pseudo step and its
repair) decode back, the way Cubedb reads them, to moves that physically
solve cross + F2L; a generated link loads on cubedb.net and shows the
scramble, all labelled lines and the move count.

**UI.** The solution textarea became a labelled step list with copy (scramble
+ lines, clipboard API with a fallback), cubedb and undo; a progress bar
while a search runs, placeholder rows, distinct empty/failed messages,
`searching… ·` / `failed ·` in the tab title, phone result cards with
rank/alg/tpp on top, right-aligned tabular rank and tpp columns, a primary
search button, and the config page's duplicated "generate" label removed.
`solver-helper.js` script tags had no cache-buster (now `?v=`).
Screenshots checked at 1280, 820 and 390 px.

**Bugs fixed.**
- Stale clickable rows: after a commit, undo or scramble switch, the old list
  stayed on screen (and clickable) until the new search's first partial list,
  so a click committed a candidate of another node or another scramble.
  Now the table is replaced at once and each rendered list remembers the
  scramble + steps it belongs to (`shownOwner`); clicks on a stale list do
  nothing. Browser-checked.
- Engine abort hang: an abort inside an Asyncify-resumed call is an
  unhandled rejection in the worker, outside its try/catch, so the call
  never ended and its pool slot hung forever (reproduced by injecting such a
  failure into the page's engine workers over CDP: the step and the next one
  stayed "searching…"). Now reported as a fatal error, the worker is
  replaced (stored prune tables re-loaded), the search's list carries
  `failedCalls` (status line, not memoised, so redoing the step retries).
  After the fix the same injection gives "148 results · 1 solver call
  failed…" and the next step searches normally. Test in
  `test/solver-bridge.test.js`.
- `solver.html` opened without a saved search (or with the DAG failing to
  load) now says so instead of showing nothing.

**Background tabs (measured, headless Chrome 150 on macOS, CDP).**
- Hidden-tab throttling exists for main-thread *and worker* timers
  (chained `setTimeout(0)` in a worker: 13 ticks in 10 s, up to 4.7 s each
  with intensive throttling); `MessageChannel` messages are not throttled.
  The page's search path uses no main-thread timers (messages + promises
  only); the engine yields with `setTimeout` once per 25 ms.
- A 10.5 s engine call took 18.1 s hidden. Replacing the engine's timer
  yield with a MessageChannel yield (rebuilt, byte-identical battery) gave
  18.5 s: no gain, so it was **reverted**. The cause is CPU: a pure busy
  loop in a worker ran 3.1 s visible, 10.2 s hidden, 3.1 s visible again
  (2x even with `--disable-renderer-backgrounding`) -- Chrome/macOS
  deprioritise hidden tabs' processes.
- Chrome's Energy Saver freezes CPU-heavy tabs hidden for 5 min; its
  documented exemptions (calls, device APIs, locks that block another
  context) are nothing this page can legitimately claim. A search frozen
  for 10 s mid-way (`Page.setWebLifecycleState`) resumed and finished with
  the same 25,145 / 25,873 results as a visible run.
- So searches do continue in the background, just slower; the info dialog
  says so and the tab title shows when a search is still running.

### 4.41 DONE (2026-10-05, eighteenth pass): look-ahead speed (goal-DAG engine search, best-first look-ahead) and wide first steps

**Where look-ahead time went.** Default config, depth 5, breadth 10, root of
`R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2`: 150 searches, 260
engine calls (all distinct inputs, so no duplicated work), ~15 s of warm
engine time on one engine; headless Chrome 20 s with nothing re-ranked for
the first 13 s. With multislot (xcross + xxcross) 105 calls, 124 s of engine
time across 3 workers, 52 s in the browser.

**Engine: the pro move set searched every subtree many times.** A node
counter (instrumented scratch build) gave only ~2M nodes/s, and on a
last-pair `solveXxxxcross` 382k nodes unrotated, 2.23M in x/x' branches and
3.18M in y/y' branches; 468 of its 500 solutions were rotation spellings of
32 distinct algs. `converter` maps r -> L, l -> R, ... and rotations change
no piece, while every prune/goal check reads piece indices only -- so `L`
and `r`, and each rotation branch at each node, re-explored identical
piece-state subtrees. Fix (`solver.cpp`, all five cross/F2L classes, used
when the move list has wide moves, slices or rotations):
`dag_mask_depth_limited_search(state, r)` = set of physical moves whose child
passes the same checks and still reaches the goal in exactly r moves,
memoised per (state, r) for the whole call (transpositions included; r = 1
not stored; 4M-slot cap, ~48 MB); `dag_walk_depth_limited_search` replays the
original DFS (same move order, `ma2` adjacency, move counts, rotation count,
rotation-branch checks, leaf validation copied verbatim) but only descends
where the mask allows. Byte-identical: `tools/engine-battery.js --compare`
(47.9 -> 13.9 s; heaviest later-step pro xxxcross 28.9 -> 0.96 s), 281
calls recorded from real look-ahead sessions on the old binary (108 -> 17 s,
0 differ), new `crossSolver/test/dag-search.test.js` (both searches in one
binary via `setDagSearch`). Face-only move lists keep the old DFS (the DAG
build, without adjacency pruning, was slower there). Heavy root pro
XXXCross (13 moves, 500 solutions): ~8.7 s per call, RSS ~200 MB.

**Engine: per-call yield.** Every IDA* depth awaited a `setTimeout(0)`
(clamped to 4 ms in browsers) -- a later-step call's median was ~40 ms, most
of it timers. `solver_yield` now only yields when 25 ms passed since the last
yield: median 4 ms.

**Best-first look-ahead.** All candidates' follow-ups used to interleave
FIFO, so every look-ahead finished near the end. Searches made by the
look-ahead carry a rank (`lookaheadFork`: path of candidate indices); the
scheduler's gates (`engine.withRank`) and the page's post-processing pool
(at most 2 calls in flight per worker) serve the lowest rank first, the
step's own calls before any. Same results. Browser A/B, alternating runs:
ranks first result 5.6-8 s / total 15-19 s; without 17-19 s / 20.5-21.6 s.
Measured and not kept: ranking only by top-level candidate (no clear
difference within the noise); 2 post workers on this 4-thread machine
(identical, the page is CPU-bound).

**Now JS-bound.** Serial, warm: ~4.3 s engine vs 8.7 s post-processing
(386k candidates; MCC `test`/`algSpeed` ~54%, facelet replays ~15%). Exact
duplicate candidates are only 5%; no admissible MCC bound strong enough to
skip candidates was found (a move can add 0 time: U/D parallel turns).

**Wide moves in first steps.** They are generated (2/3 of root candidates:
engine pro moves, cross optimisation, side-cross inspections) but the
§4.35 flat +2.35 per r/l (commit 4a77e7c) put the best wide Cross at rank
112 and no wide XCross in the top 100 (before 4a77e7c: wide at rank 1).
`f`/`b` spellings at the top are honest (inspection variants of r/l algs;
MCC scores f like F, wideOther applies). Swept a first-step-only r/l value
on the 19 root pro steps (`tools/pro-ranking.js --app` pools):
leave-one-solve-out CV mean log10 rank 2.279 -> 2.250, 18/19 folds pick 1.2
(0 is worse: 2.404). `STEP_PENALTIES.wideRLFirst = 1.2`, used by
`stepsPathCost` and `pro-ranking.js`. All 66 steps: 1.035 -> 1.016, top 10
41 -> 42 (later steps move slightly, all up: TPP divides by piece counts).
Best r/l result: default config #2, xcross+xxcross #6 (was 55); new
`test/wide-moves-e2e.js` checks first page + physical replay of the top 100
wide results, and fails with 2.35.

**Verification.** All fast suites; lookahead, progressive, search-options,
offload, wide-moves, dag-search, slot-mapping, color-orientation e2e;
`solver-bridge-e2e.js --pro --scrambles 2 --seed 3` (0 bad finals);
`pro-references-e2e.js`: 44/66 professional segments in the search tree
(engine output unchanged, so this is the standing figure).

**Worst case (README goal: < 1 min).** `worst-case-bench.js --budget 0
--no-pseudo --depth 1` (every colour, xcross..xxxcross, multislot, pro
moves, no time limit): root 165 s cold, 471k results (was ~3.4 h of engine
time, §4.36); the next step 1.0 s. Still over a minute without the time
limit, and pseudo calls (face-turn engine, no DAG gain) are unchanged --
the time limit remains the guarantee.

### 4.40 DONE (2026-10-05, seventeenth pass): solver performance -- Asyncify, shared prune tables, post-processing workers

**Measuring first.** Main-thread CPU profiles (inspector API, so the WASM
workers are not slowed by the profiler) and a record/replay harness (engine
calls recorded once, replayed without WASM) separated JS from engine time:
an xcross+xxcross root search was ~2.5 s of main-thread JS (MCC ~50%, facelet
replays ~17%, dedupe keys ~10%) next to ~2.4 s of engine CPU; later steps and
multislot look-ahead were engine-bound; and a cold search (fresh page) paid
~2.5-3 s of prune-table builds *per engine worker* (`create_prune_table`,
~0.4 s per 4.5 MB "cross + corner/edge" table).

**1. Asyncify (engine build).** `ASYNCIFY_ADVISE` showed every
`depth_limited_search` instrumented (it reaches imports through string and
vector code), though only `start_search_persistent`'s once-per-depth
`solver_yield()` and the two table builders' yield ever unwind.
`-s ASYNCIFY_REMOVE=["*depth_limited_search*","create_prune_table*"]` in
`crossSolver/compile.sh`; source unchanged. A build with Asyncify off
entirely is no faster, so this recovers all of it. Battery
(`tools/engine-battery.js --compare`): all calls identical, 65.8 → 52.0 s;
the heaviest pro xxxcross 41.5 → 31.7 s. The 68 engine calls of a multislot
depth-3 look-ahead, serial on one warm engine: 93.1 → 65.8 s (xxxxcross 58.0
→ 42.1 s). The rebuild from the committed source reproduces the binary
byte for byte. Tried and not kept: `ma2` as bytes instead of
`vector<bool>` (no change), `-flto` (no change).

**2. Prune-table sharing and persistence.** Engine API (`solver.cpp`,
THIRD_PARTY_NOTICES): `tableCacheKeys()` lists the shared corner / edge /
pair tables by key ("c|corner|moves", "e|edge|moves", "p|pieces|faces"),
`tableCacheGet(key)` returns a view of one, `tableCachePut(key, bytes)`
stores a table built elsewhere only if the key is new and the size right.
`worker-persistent.js` answers `tableKeys` / `getTables` / `putTables`
messages (queued while a solve runs: the engine must not be re-entered while
a search is paused at an Asyncify yield) and `solver-helper.js` has
`tableKeys()`, `getTables()`, `putTables()`. `solver-ui.js`: after a worker
finishes a call, tables it has that the page has not seen are copied to the
other workers and stored in IndexedDB (`cubetree-engine-tables`, keyed by
`ENGINE_VERSION`, other versions deleted on load); a new page puts the
stored tables into every worker before its first search. About 36 MB per
engine move list (pro set; "no r2/l2" is a second list). Failures (no
IndexedDB, quota) only cost the old rebuild.
- Node: 19 tables from one engine imported into a fresh one in 76 ms; that
  engine's output on 18 recorded calls identical, and it runs at warm speed
  (8.8 s vs 11.7 s cold). `test/offload-e2e.js` checks identity and refusal
  of wrong keys/sizes.
- Browser (headless Chrome, same profile, xcross+xxcross, white): first list
  on a repeat load 3.6-3.9 s at HEAD → 1.6-1.7 s; a session flow (commit,
  no r2/l2, multislot, depth 3, commit) gives the same page-1 row hashes as
  HEAD at every step, 0 console errors; commit 1.6 → 0.3 s, switching on
  no r2/l2 3.1 → 0.3 s (its tables were stored by an earlier load).
  First-ever load: 5.0-5.4 s, unchanged.
- **Live site** (c7f2e10 deployed, file hashes match the repo; headless
  Chrome, same flow): first visit 6.0 s to the first list (downloads
  included), repeat visit 1.7 s; commit 1.6 s first visit → 0.3 s repeat;
  page-1 row hashes equal the local/HEAD ones; 0 console errors.

**3. Post-processing workers.** `searchCurrentNode`'s per-call loop (luck
filter, inspection variants, cross optimisation, rotation spellings,
side-cross variants, TPP) became the pure `postProcessCall(ctx, job, cores)`
(`postProcessContext` / `postProcessJob` build its plain-data inputs;
`stepsPathCost` is shared with `SolveSession.pathCost`). With
`session.postProcessor` set it runs elsewhere: the page uses a pool of
`js/postprocess-worker.js` (cores left after the engine pool, 1-4; any
worker failure falls back to the main thread). Same function, so the same
output (`test/offload-e2e.js`: root with pseudo, later step, depth-2
look-ahead, no r2/l2 + multislot). On this 2-core machine the gain is
modest because the CPU is shared with the engines: warm depth-5 look-ahead
root 6.3-6.7 → 5.6-5.8 s with 1-2 post workers; more cores, more gain. The
main thread is mostly idle during searches now (profiled: 64% idle).

**4. Per-candidate JS** (each change verified on 81k recorded MCC inputs
and full replayed result lists):
- MCC's upper-cased move tokens are interned (an object key), so its string
  `switch` and `==` against literals compare pointers: 11.9 → 9.1 µs/call
  (with a loop instead of `forEach` in `stepPenalty`, the rotation-type
  check hoisted out of the regrip loop).
- `applyAlgorithm` permutes two reused char-code buffers and builds one
  string per call instead of one per move (no regex unless "none" appears).
- `inspectionWideVariants` caches the (token, rotation) → wide-token lookup
  (its permutation key was ~8% of a root search).
- Recorded xcross+xxcross root, JS only: 2.2-2.4 → 1.6-1.7 s; later steps
  25-40% less.

**End to end (Node, `worst-case-bench.js`, 3 engine workers, warm, 500
solutions/call):** xcross+xxcross root 3.7 → 2.6 s and its later steps
1.5-1.9 → 0.2-0.3 s; default config look-ahead depth 5 root 8.4 → 6.8 s
(5.6-5.8 s with a post worker); default depth 1 roughly unchanged (it was
already 0.1-2 s per step). Same results throughout.

**Measured and not kept:**
- "Cross + one edge" bound in xxcross: warm root xxcross calls -23%, but
  every worker then built four more 4.5 MB tables on the root search
  (browser cold first list 5.0 → 6.5 s, before table persistence existed).
  In xxxxcross: no gain (42.1 vs 41.5 s). With persistence this trade
  should be re-measured.
- MCC round tracing (a rotation spelling resumes the grip search from the
  last round that cannot see the inserted rotation): exact, but only 5%
  fewer grip simulations, since the first round usually reaches past the
  insertion point.
- Finger state as scalars in MCC's `test()`: 3%.

**Notes for later engine work:** in the pro move set every node also
expands 4 rotations (maxRotCount 1) whose subtrees are never pruned (a
rotation does not change the state, so the parent's bound already holds);
most of a later-step search is these rotated subtrees. Their solutions are
part of the required output, so any change there must keep the output
byte-identical.

### 4.39 DONE (2026-10-05, sixteenth pass): look-ahead speed, results-page search options, blank time limit

**Where look-ahead time went.** Measured with a Node harness that runs
`searchWithLookahead` on the 3-worker engine pool (as the app does) plus
`--cpu-prof` on every thread; scramble `R2 U2 L D' R' F' B' R F' R F2 D2 R F2
D2 B2 D2 L F2 D2`, white, pro move set + cross opt, 500 solutions per call,
this machine (2 physical cores). Depth 5 = 5 + 10 + 20 + 40 follow-up searches
(~76, fewer when sequences finish F2L early), 131 engine calls. The main
thread was busy ~89% of the time and the engine workers ~35%: replaying the
same 131 calls one by one on a single warm engine takes 5.4 s in total
(9.1 s cold). The per-call "engine time" of 300-400 ms the pool reported was
mostly a worker waiting for the busy main thread to collect its result and
hand it the next call. Each later-step search scores ~5-7k candidates (~17
rotation spellings per engine solution), and MCC (`algSpeed` of the whole path
for every candidate) was half of the JS time.

**Exact speedups** (12-list snapshot -- matched, multislot, full pseudo,
look-ahead depth 2/3, 2-3 committed steps each -- byte-identical to HEAD
after every change; `solver-bridge-e2e.js --pro` and `--pseudo`,
`lookahead-e2e.js`, `progressive-e2e.js` all pass):
- MCC is a greedy round-based grip search: each round simulates a few grips
  from one point, the furthest-reaching wins, the next round starts where it
  had to regrip. A round whose tests all fail before the last committed move
  cannot be influenced by what follows, so `algSpeedPrefix(path)` runs the
  committed path up to that point once and `algSpeedResume(checkpoint, alg)`
  finishes each candidate from there (`SolveSession.pathCost`, cached per
  committed steps). Equal to `algSpeed(path + alg)` on 40k random mixed-
  notation sequences (`test/script.test.js` keeps 12k). With an upper-case
  token cache and one `==` that coerced a number to "U" on every round,
  34 → ~12 µs per candidate.
- Partial result lists are only ranked when someone listens (memoSearch's
  emitter); the look-ahead's own searches have no listener.
- `rotationSpellingParts` builds spellings from cached prefix/suffix joins and
  reports each spelling's rotation (no regex re-split per spelling); an alg
  that already rotates has no valid spelling and skips them (same result as
  the old "more than one rotation" check). `netRotation` uses a per-token
  rotation table (checked equal to `canonicalizeForEngine` on 50k algs).

| look-ahead, 3 workers, warm (cold) | HEAD | now |
|---|---|---|
| default config, root, depth 3 | 4.6 s (10.7) | 3.2 s (9.1) |
| default config, root, depth 5 | 17.0 s (19.7) | 8.9 s (18.1) |
| xcross + multislot, after an xcross, depth 3 | 20.6 s (32.0) | ~21 s (24.8) |

Cold numbers are dominated by prune-table builds, which every worker does for
itself. The multislot row is engine-bound: the "last two pairs" multislot
calls (`solveXxxxcross`, 16 moves) take 4-11 s each on one warm engine; this
pass did not change the engines.

**Engine-call cache** (`engineCallMemo`, `session.engineMemo`, shared with
forks, 600 calls): the matched engine's solutions depend only on the state
its search starts from (the `y2 y2` postAlg boundary resets move pruning), so
calls are shared by the facelets of scramble + rotation + committed moves.
Verified on a real multislot look-ahead: 5 same-state groups reached through
different move text, identical stripped output in all 5. Pseudo calls are
shared only by exact input (no same-state pseudo pair occurred to verify).
Only without a time limit (a deadline makes output depend on timing). The
cache stores solutions with each call's own "rotation postAlg" prefix
stripped (`stripEnginePrefix`), so a shared call yields the same steps.
Multislot after a cross, depth 3: 52 → 47 calls.

**Search memo.** Limit 48 → 200 searches / 500k candidates held (~450 bytes
per candidate measured; the old worst case was about the same memory). A
depth-5 look-ahead makes ~76 searches, so with 48 the searches needed right
after committing an explored candidate had already been evicted.

**Bug: memo shared between different step splits.** The memo key was node +
rotation + the committed path's joined text, but TPP depends on where steps
start (`stepPenalty`: a `y` starting a step is free, mid-step +3.70). A
multislot "S" and the same moves committed as two single pairs reach the
same node with the same text, so the second one searched got the first one's
TPPs. Key now uses the committed steps; regression test in
`test/solver-bridge.test.js` (fails on the old key).

**Multislot on the results page.** The config checkbox is gone; the solver
page always builds its tree with the multislot edges (`pruneGraph` itself is
unchanged, so harnesses still choose with "multislotting"), and
`SolveSession.multislot` (results page, default off, stays as set from step
to step) drops later-step multi-pair edges first thing in
`searchCurrentNode`, exactly as `pruneGraph` would. `search-options-e2e.js`:
off == a tree without multislotting (step and depth-2 look-ahead, identical
lists), on == the multislotting tree. A saved search that had multislotting
on starts with the toggle on (`legacyView.multislot`).

**No R2/L2 after step 1** (REMOVED in the twenty-first pass, §4.44;
kept here as history) (results page, default off,
`SolveSession.noLaterR2L2`): later-step engine calls (matched and pseudo) get
the move list without `R2`/`L2` (`withoutR2L2`), and results that show them
anyway -- a rotation spelling can relabel `F2`/`B2` into `R2`/`L2` -- are
dropped (`hasR2L2`). Applies to every look-ahead follow-up too, also from the
root; the root step itself is unchanged (e2e: identical root list). Note: it
is a different engine move list, so the engines build a second set of prune
tables the first time it is used. Search options reach the bridge as
`searchWithLookahead` options (`session.withSettings`), are part of the memo
key (`searchSettingsKey`) and the results-page cache key.

**Time limit.** Blank (the new default) = no limit, stored as `null`
(`parseTimeLimit`; 0 or invalid = none too); `normalizeCriteria` maps a
stored 60 without `version: 2` to none (60 was the old default, not a
choice), and solver-ui no longer falls back to 60 for a missing value.

**Other fix:** the solver page stored the whole pruned tree in localStorage
(`cubecrit_pruned_tree`, ~870k characters) without a try/catch and nothing
read it; a quota or private-mode error there ended the page's start-up before
its first search. Removed.

**Replaced searches stop expanding.** Changing a results-page setting (or
committing/undoing) mid-look-ahead used to leave the old job expanding its
look-ahead at active priority, competing with the new search for the
engines; and when it finished it set the scramble's indicator to "ready"
while the new search was still running. `searchWithLookahead` takes
`isCancelled` (solver-ui: the job's cache entry was replaced): no new
follow-up searches start (running ones finish; they are memoised and may be
what the new search needs), and only the current job of a session sets its
status. e2e: a cancelled depth-3 look-ahead makes exactly the step's own
engine calls. Browser: depth 5 with multislot → back to depth 1 mid-search →
results at once, indicator stays "ready", 0 console errors. The root search's
memo key ignores the two later-step options (they cannot change it).

**Browser check** (headless Chrome, CDP): config page shows a blank time
limit and no multislotting box; stored criteria `timeLimit: null`; root →
commit a cross → multislot on (multislot rows appear) → no r2/l2 on (0 R2/L2
rows of 500 shown, 151 before) → look-ahead 3 → 5 → reload (settings and
progress restored); 0 console errors or warnings; 360 px: no horizontal
scroll. Cache-buster `?v=20261005c`.

### 4.38 DONE (2026-10-05, fifteenth pass): live-site speed, progressive results, results-page controls, UI pass

**Why the live site was slower than local benchmarks.** Measured with headless
Chrome on the same machine and config (white; xcross, pro moves, cross opt;
500/call): live 14.7 s to the full list, local 5.5 s. Every JS/WASM file on
Pages differed from the working tree: the live site ran faae44e
(`ENGINE_VERSION` 20261004-pairs1), because the Pages workflow run for
c3e8eca had been "queued" for 1.5 h (a GitHub-side stall; a newer push
supersedes it). So the fourteenth pass's post-processing speedups, including
the `optimizeCrossSolution` rewrite that was 41% of a cross-opt root search,
were never deployed. Lesson: after pushing, confirm the run completes via the
public Actions API and compare a file hash against the live site.

**JS hot paths** (profile of a warm root search, pro + cross opt, 57k results;
engine ~4 s wall of 8 s):
- `isSlotSolved` scanned the 54-char mask with `toUpperCase` per position on
  every call; the checked positions and their centres are now computed once
  per mask (`maskChecks`).
- `applyPerm` builds the string from a reused `Uint16Array` with one
  `fromCharCode` (1.6× in a micro-benchmark); `isMoveToken` is a Map lookup.
- Rotation spellings: every spelling with rotation r is physically "alg, then
  r", so the reached node is computed once per r instead of once per
  spelling; `rotationSpellings` relabels each token once per rotation instead
  of once per split point (checked equal to the old definition on 20k random
  mixed-notation algs).
- Not changed: `algSpeed` (MCC) is ~25% of JS time but 69k of 72k calls are
  unique strings, so memoising does not help; changing MCC itself was out of
  scope.

| measurement (Node, 3 workers, same scramble) | HEAD | now |
|---|---|---|
| root, cold | 13.0-15.0 s | 11.6-11.7 s |
| root, warm | 8.0-8.2 s | 6.5-7.4 s |
| browser, time to first results | 6.5 s (whole search) | ~1.3 s |

Equality: an 11-search snapshot (pro + cross opt two colours; full pseudo +
cross opt; matched multislot; look-ahead depth 2; 2-3 steps each) is
byte-identical to the pre-change output, as is `solver-bridge-e2e.js --pro`
(0 warnings, 0 bad finals, 0 frame failures).

**Progressive results.** `searchCurrentNode(..., onPartial)` ranks the calls
finished so far exactly like the final list (`rankCandidates`, shared with the
final ranking; dedupe keys cached per candidate) and emits at most every
`PARTIAL_INTERVAL_MS` (350 ms, or 4× the last ranking's cost). `memoSearch`
keeps listeners, so a search the user switches to while it runs in the
background still streams (a late listener gets the latest list at once).
`searchWithLookahead(..., { onUpdate })` emits the single-step ranking first,
then re-ranks the top block as each candidate's look-ahead resolves
(resolved first by combined TPP, pending ones marked `lookaheadPending`).
The returned list is unchanged. `test/progressive-e2e.js` checks all of it
against the real engines.

**Results-page controls** (`solver-ui.js`, settings in localStorage
`cubecrit_view_prefs`): look-ahead depth/breadth per step (background
scrambles search depth 1; the active one uses the control; changing it
re-searches, reusing the memoised depth-1 search); "simple pseudo only"
(visible with pseudo F2L) = `options.filter`, applied at the step and inside
look-ahead. Each candidate carries `fullPseudoOnly` when every DAG edge to its
target is `full_pseudo_only`; filtering on it equals the old
`simplified_pseudo` pruneGraph mode exactly (root + two later steps through a
mismatched node, real engines). `pruneGraph` keeps `simplified_pseudo` for the
harnesses (`solver-bridge-e2e.js --simplified`).

**Scheduler deadlock found and avoided.** A new ACTIVE job for a scramble
(e.g. look-ahead switched on) can await a memoised search whose engine calls
belong to an older job of the same scramble; if that older job is
BACKGROUND, the gate never lets its calls run while an ACTIVE job is running.
All unfinished jobs of a scramble now always share its priority (`trackJob`
/ `setJobsPriority`).

**Config/defaults.** `pro_moves` and `cross_opt` are always added
(`ALWAYS_ON_OPTIONS`, `normalizeCriteria`); saved criteria from before keep
their old look-ahead/simplified-pseudo choices as initial view settings
(`legacyView`).

**UI.** Rewritten `styles.css`, `index.html`, `solver.html`: lowercase,
monospace, no inline captions; info dialog (`installInfoDialog`, native
`<dialog>`) next to the logo on both pages; results table with no clipping
(algs wrap; ≤720 px: labelled cards; per-type limits table becomes blocks);
25 rows per page, page-size box, first/prev/next/last pagination. Checked in
headless Chrome at 360, 390, 768, 820, 1024, 1280 and 1440 px: no horizontal
page scroll, 0 cells with clipped content, 0 console errors; config → search
→ filter → commit → look-ahead → paginate → undo flow exercised.
Cache-buster `?v=20261005b` (styles.css now has one too).

### 4.37 (2026-10-05, fourteenth pass): alg_speed on all 19 pro solves — penalties kept, tools fixed

Data: pro solves #12-#19 (added by the user at the end of the thirteenth pass)
give 66 segments in total (19 root, 47 later). App pools rebuilt for all 19
(`tools/pro-ranking.js --app --sample 0`, ~11 min).

**Out-of-sample check** of `STEP_PENALTIES`, which were fitted on #1-#11 only:

| pro steps in the app's top 10 | no penalties | STEP_PENALTIES |
|---|---|---|
| #1-#11 later steps (in-sample) | 12/25 | 23/25 |
| #12-#19 later steps (never seen) | 9/22 | 16/22 |
| root steps, all 19 | 0/19 | 2/19 |
| all 66 | 21/66 | 41/66 |

**Refits on all 19** (leave-one-solve-out CV, `tools/fit-step-penalties.js`):

| variant | CV top 10 | CV mean log10 rank |
|---|---|---|
| production weights (fit on #1-#11) | 41/66 (in/out of sample mix) | 1.035 |
| logistic loss (as §4.35) | 40/66 | 1.057 |
| logistic, corrected tool (committed steps' penalties counted) | 39/66 | 1.093 |
| corrected tool + constant per-step cost ("step") | 39/66 (step weight fits to 0.00 in every fold) | 1.093 |
| sigmoid loss (bounded, outlier-robust; new `--loss sigmoid`) | 41/66 | 1.052 |
| + x-rotation feature | 40/66 | 1.059 |
| stronger L2 (0.01) | 36/66 | 1.211 |
| sigmoid + stronger L2 | 36/66 | 1.259 |

On the held-out #12-#19 alone, production gets 17/30 (mean log10 rank 1.074)
and the CV refits 17-18/30 (1.087-1.097). **No refit is better, so
`STEP_PENALTIES` is unchanged.** Weights refitted on 19 solves stay in the same
ranges (e.g. B 1.07-2.57, mid-step y 3.52-4.16 per fold), which suggests the
penalties capture something real rather than noise in the first 11 solves.
Human variance: a pro's step that is simply slower than the best alternative
should rank lower; the bounded sigmoid loss caps each such step's pull on the
weights, and it ties the logistic loss. So the current fit is not being
dragged by outliers either. A constant per-step cost (a recognition pause,
"step" feature, now in the fit tool) fits to zero: no evidence for it. The
rows above the "corrected tool" ones were computed before the fit-tool fix
below; the comparison against production is unchanged either way.

**Tool bugs fixed:**
- `tools/pro-ranking.js` rebuilt the pools (~10 min) on every run even with a
  valid cache (an `else` bound to the wrong `if`).
- `tools/fit-step-penalties.js` scored only the current step's penalty
  features, while the app adds every committed step's penalties too. That
  matters when candidates solve different numbers of pieces. The fit tool now
  includes them, and its production-weight ranks match `pro-ranking.js --app`
  exactly (41/66). New options: `--loss sigmoid`, `--weights` (evaluate fixed
  weights), `--seed`.

### 4.36 DONE (2026-10-05, fourteenth pass): worst-case search time — search time limit, engine deadline, JS post-processing

README goal (new): worst-case search with all settings enabled under 1
minute. New benchmark `tools/worst-case-bench.js` (all colours; xcross,
xxcross, xxxcross, multislotting, full pseudo, cross_opt, pro moves; 500/call;
optional look-ahead; engines on a Node worker-thread pool,
`tools/node-engine-pool.js`, like the browser's).

**Measured worst case before this pass** (no limit): one root search plans
378 engine calls (per colour: 15 matched + 48 pseudo). Per call: pro XXXCross
116-494 s, pseudo XXXCross 45-81 s, everything else 3-8 s, about 3.4 hours of
engine time in all. That is ~70x too slow for 1 minute on 3 workers.

**Engine work (exact, outputs byte-identical on batteries):**
- Pseudo engine: pairs-only bound (24^4 table of two corners + two edges,
  seeded at the goal's four D offsets) in xxcross/xxxcross. Heaviest battery
  call 31.7 → 24.8 s.
- Matched engine: "cross + one edge" tables in xxxcross. No measurable gain
  (6.77 → 6.64 s); the corner and pair bounds already dominate. Kept (cheap,
  exact); not added to the other classes.
- **Face search vs pro move set (measured, not adopted):** a face-turn XXXCross
  at length 13 enumerates its complete solution set (35) in 12 s, where the
  pro-move-set call spends 494 s on 500 spellings of a few of them. But the
  pro search also emits slice-like spellings (`L l'`, `r ... l'`) whose
  face form only appears unmerged (e.g. `L L`), so face search + post-hoc
  spellings cannot reproduce it exactly (7471 of 8349 physical pro solutions
  of one xcross call have no merged face equivalent in the face set).

**The guarantee: a search time limit** (index.html "search time limit (s)",
default 60, 0 = none; `SolveSession.timeBudgetMs`):
- Engine-side deadline (`setDeadlineCheck`, `Module._deadline`): the search
  checks the clock every 16384 nodes and ends like a capped call. A cancel
  message would not work here: the worker only sees it at the once-per-depth
  yield, which can be minutes apart. A call that starts after its deadline is
  skipped by the helper. Tested: a 494 s pro XXXCross call stops at 3.0 s
  with a 3 s deadline; the next call on the same engine is normal.
- Bridge: engines get 75% of the budget (`SEARCH_ENGINE_SHARE`; 85% left too
  little for the JS tail); calls start cheapest first (`callCostRank`) but
  are consumed in plan order, so completed calls give the same output as
  without a limit. Results carry `truncatedCalls`; the UI status line says
  when the limit was reached. Look-ahead: the step's own search gets 50%,
  follow-ups the rest; rows whose follow-up search was cut get
  `lookaheadTruncated`; a cut search is not kept in the memo (committing that
  step searches it again in full).

**JS post-processing** was the next wall: ~500k candidates at the root.
Profile (20 s limit): 174 s total, `findFaceTurnName` 41%.
- `optimizeCrossSolution`: DFS over convertible positions with orientation
  indices instead of 2^n masks × 54-element permutation compares. Same
  output and order (test against the original on 300 random algs).
- `replayFacelets` caches the scramble + rotation + committed-path state;
  `nodeByLabels` uses a per-tree index.
- Each call's solutions are post-processed as soon as that call finishes
  (overlapping the engines), joined in plan order at the end.
- Result: 174 s → 67 s at a 20 s limit; at 60 s, within the limit (below).

**Results** (same scramble set; 3 engine workers):

| measurement | before | after |
|---|---|---|
| Node, all settings, root (cold), 60 s limit | ~3.4 h engine time (no limit) | 62.0 s |
| Node, all settings, worst warm step, depth 1 | – | 56.5 s |
| Node, all settings, worst warm step, look-ahead depth 5 | – | 45.7 s |
| Browser (headless Chrome), all settings, root (cold) | – | 48.0 s, 490,124 results |
| Browser, default config, root (cold) | 12.6 s, 57,100 results | 11.2 s, 57,100 results |

**What is cut** under the limit with every option on: ~230-290 of 378 root
calls (mostly pseudo multi-pair and pro XXXCross); the common Cross/XCross/
XXCross matched results finish. The cold first search slightly exceeds 60 s
in Node (62 s) because prune-table builds are not interruptible.

**Verification:** no-limit output identical to HEAD, compared field by field
on 8 searches (pro + cross_opt with two colours, full pseudo, cross_opt; 2-3
steps each, `git archive HEAD` vs working tree). Battery identical for both
engines. All fast suites plus the new `test/search-budget.test.js`;
slot-mapping, colour-orientation, `lookahead-e2e.js`,
`solver-bridge-e2e.js --pro` (2/2) and `--pseudo --pick full` (2/2, 3
full-pseudo-only steps): 0 warnings, 0 bad finals, 0 frame failures. Browser:
0 console errors, the new engine version fetched. `ENGINE_VERSION`
20261005-deadline1, page cache-buster `?v=20261005a`.

### 4.35 DONE (2026-10-04, thirteenth pass): alg_speed tuned so pro steps rank near the top

User request: professional reference steps in the top 10 90% of the time if
possible, without overfitting.

**Benchmark: the real app list** (`tools/pro-ranking.js --app`). For each of
the 36 segments, the pro's earlier steps are committed in a `SolveSession`
and `searchCurrentNode` runs with the app defaults (500 per call, xcross +
xxcross + multislotting + pro move set, the pro's cross colour). The pro
step's TPP is then ranked among everything listed there: all targets,
rotations and spellings, 900-74,000 candidates per node, ranked exactly.
Baseline (pushMult 0.8 from §4.32): **12/36 in the top 10**; root steps rank
42-23,822.

**What beats the pros** (inspected, not guessed): (1) at the root, short
cross-only results (partial-path TPP favours cheap early pieces) and engine
XCross/XXCross algs built from wide moves, F/B and mid-alg rotations that MCC
prices well below the pros' choices (best XCross 8.3 vs the pro's 15.7); (2)
later, multislots and awkward spellings (`R r' U' F' …`, `l y' U R …`).

**Tried and rejected:**
- Estimated final TPP (charge each unsolved pair the pros' mean single-pair
  cost, 8.66): worse (9/36), because XXCross results take over the root.
- Learned remaining-pairs terms (one, or separate root/later): no CV gain.
- Signed per-move weights (U/R/L discounts): CV 26/36, but 7.6% of random
  U insertions then *lowered* an alg's cost (MCC's marginal U cost is
  sometimes below the discount), which rewards padding. Rejected.

**Chosen: penalties only**, fitted with an L2-regularised pairwise logistic
loss (the pro step should score below each candidate at its node; 400 hardest
+ 800 random candidates per node; nodes weighted equally; weights ≥ 0).
Overfitting control: leave-one-solve-out CV (11 folds), and every number
quoted as "honest" is the held-out rank. `STEP_PENALTIES` in script.js:
D +1.06, F +0.86, B +2.22, r/l +2.35, other wide +3.31, mid-step y +3.70 (a
y that starts the step is free). Per-fold weights are stable (e.g. B
1.84-2.62, mid-step y 3.27-3.89), and the in-sample fit (24/36) equals the CV
result (24/36). Applied per step: `SolveSession.pathCost(alg)` = MCC(path) +
Σ stepPenalty(each committed step) + stepPenalty(alg); every TPP in
`searchCurrentNode` uses it.

**Results** (production scoring; the honest CV figure is 24/36 = 67%):

| | before | after |
|---|---|---|
| app list: pro steps in top 10 | 12/36 | 25/36 |
| app list: in top 3 | 9 | 17 |
| app list: in top 500 | 28 | 33 |
| app list: later steps in top 10 | 12/25 | 24/25 |
| per-goal pools (§4.32): top 10 / top 500 | 22 / 29 | 26 / 35 |

| segment | candidates | rank before | rank after |
|---|---|---|---|
| #1 xcross | 46350 | 13597 | 281 |
| #1 2nd pair | 7374 | 83 | 2 |
| #1 3rd pair | 2893 | 25 | 3 |
| #1 4th pair | 1280 | 64 | 4 |
| #2 xcross | 48234 | 423 | 164 |
| #2 2nd pair | 6529 | 1 | 1 |
| #2 3rd pair | 3185 | 4 | 1 |
| #2 4th pair | 1172 | 1 | 1 |
| #3 xcross | 53734 | 1640 | 109 |
| #3 2nd pair | 6441 | 3 | 2 |
| #3 3rd pair+4th pair | 3494 | 232 | 9 |
| #4 xcross | 52631 | 223 | 1 |
| #4 2nd pair | 6941 | 139 | 6 |
| #4 3rd pair+4th pair | 2842 | 25 | 5 |
| #5 xcross | 62460 | 42 | 27 |
| #5 2nd pair | 7113 | 1 | 1 |
| #5 3rd pair | 3134 | 1 | 1 |
| #5 4th pair | 893 | 1 | 4 |
| #6 xcross | 74048 | 23822 | 4599 |
| #6 2nd pair | 6962 | 161 | 6 |
| #6 3rd pair | 2705 | 351 | 22 |
| #6 4th pair | 968 | 8 | 3 |
| #7 xcross+2nd pair | 40358 | 14488 | 1612 |
| #7 3rd pair+4th pair | 1959 | 1 | 1 |
| #8 xxcross | 52290 | 3278 | 256 |
| #8 3rd pair | 3165 | 1 | 1 |
| #8 4th pair | 794 | 16 | 1 |
| #9 xxcross | 55855 | 3433 | 450 |
| #9 3rd/4th pairs | 3394 | 14 | 5 |
| #10 xxcross | 60584 | 661 | 2 |
| #10 3rd pair | 2994 | 55 | 1 |
| #10 4th pair | 889 | 86 | 4 |
| #11 xcross | 49406 | 8975 | 1119 |
| #11 2nd pair | 5396 | 340 | 130 |
| #11 3rd pair | 3556 | 7 | 2 |
| #11 4th pair | 1184 | 3 | 1 |

**Why not 90%:** 10 of the 11 misses are root steps (XCross/XXCross chosen in
inspection; now ranked ~16-3000, previously 42-23,822). Their pools are
~50,000 results, and what separates a pro's choice is inspection planning:
what a human can see and plan in 15 s, which pairs are easy to track, and
cross-colour/slot preferences. An execution-speed model does not capture
that, and 11 root examples cannot teach it without overfitting. Ideas if this
matters: rank root results per target type (Cross / XCross / XXCross) so a
good XCross isn't buried under cheap crosses; or collect many more pro root
steps before fitting anything root-specific.

Verified: `script.test.js` (stepPenalty: penalties only, leading y free),
all fast suites, `lookahead-e2e.js`, `solver-bridge-e2e.js` (pro, pseudo):
0 warnings, 0 frame failures.

### 4.34 DONE (2026-10-04, thirteenth pass): search performance

User priority: "identify and implement every possible optimization to speed
up the search engine". Profiling (Node, one pro-move-set root search, white,
xcross+xxcross, 500 solutions per call): 121 s total = 99 s engine (11 calls) +
22 s JS. Cold engine calls were dominated by prune-table builds (1-15 s per
solver instance and slot); warm XXCross calls by weak pruning (the pair
edges were only checked at the leaves).

**Engine** (THIRD_PARTY_NOTICES.md; output verified byte-identical with an
11-call battery covering every F2L class, face and pro move sets, rotations,
postAlg, repeated calls and a move-set switch in one process):
- `corner_prune_table()`: every F2L class prunes on the same "cross + one
  corner" tables. They are now cached per (corner, exact move list) and shared:
  up to 32 builds (~145 MB) became at most 4 per move list. Keying on the move
  list also fixes a latent bug: a persistent solver reused its first table
  even after a call with a different move set.
- `pair_prune_table()`: an extra admissible bound, the distance to solve the
  target pairs' corners and edges alone (24^2 or 24^4 states, BFS in the
  centre-relative frame; all 18 faces when wide moves or rotations are
  allowed, so it is a superset and still a lower bound). It is checked in
  xcross (1 pair), xxcross (1 table), xxxcross (3) and xxxxcross (6).
  **Lesson:** a rotation consumes no move, so after a rotation the check must
  be `h > depth`. The first version used `>= depth` like the upstream code
  and dropped 3 valid pro solutions (caught by the battery, traced with a
  temporary debug export that replayed the path through the engine's indices).
- `create_prune_table()`: per centre state, the ordered list of distinct base
  moves is precomputed (first-occurrence order kept, so the table is
  identical), instead of trying every move × rotation per cell. Pro tables
  build ~5× faster.

**Upstream rotation-branch bug: measured, not adopted.** The original
rotation branches prune with `prune >= depth` on their own tables too, and at
depth 1 they never recurse, so a rotation followed by the last move is never
explored. The fix (`> depth`, always recurse) was built and measured on
uncapped pro-mode calls (3 scrambles × cross/xcross/xxcross). It gave a
**strict superset** (0 lost), and every extra solution (1.4k-104k per call)
was physically valid. Raw counts roughly double, though (e.g. 745 → 2172),
and the extras are mostly `... y X` spellings that `rotationSpellings`
already produces post hoc. Under the app's per-call cap they would displace
genuinely different algorithms, and pro-reference membership on the rotation
segments (#5, #8, #10, #11) was identical. Dropping y from the engine instead
was also measured and rejected: it loses y + wide-move combinations with no
face-turn equivalent (e.g. `U2 y r' U2 B' U' l' B'`). Reverted (the rebuilt
binary is byte-identical to the committed one). Revisit if the cap is ever
raised, or apply it to x rotations only.

**Bridge / UI:** `searchCurrentNode` now plans every call, starts them all,
then post-processes in plan order (output identical: three steps of a
pro-move-set session compared field-by-field). `serialEngine` chains calls
for a plain helper (the Node harnesses); `solver-ui.js` creates a pool of
`max(1, min(4, cores - 1))` engine workers, and `search-scheduler.js` gates are
per engine with one slot per worker (priority rules unchanged; new pool
tests). Look-ahead runs its candidates' continuations in parallel and picks
them in rank order (same ties).

**JS:** `canonicalizeForEngine`, `relabelAlgForRotation` and
`inverseRotation` use an index over the 24 orientations (multiplication table
plus a cached token-conjugation table) instead of string-keying 54-element
permutations per token; a new test checks them against the permutation
reference on 3000 random mixed-notation algs.

**Results** (same scramble/config throughout):

| measurement | before | after |
|---|---|---|
| Node, cold root, pro moves, 100/call (serial engine) | 90.7 s | 6.3 s |
| Node, warm root, same | ~30 s | 2.5-3.7 s |
| Node, step 2 (later single pair) | 49.0 s | < 1 s |
| Browser, cold root, pro moves, 100/call | 100.1 s | 5.1 s |
| Browser, step 2 after click | 36.3 s | 0.2 s |
| Browser, cold root, 500/call | ~121 s (Node) | 12.6 s |
| warm XCross ×6 / XXCross ×6 (face) | 1.5 s / 9.1 s | 0.13 s / 3.6 s |

Result counts were identical in every comparison (e.g. 13742 / 496 / 57100).
All fast suites, slot-mapping, colour-orientation, `lookahead-e2e.js` and three
`solver-bridge-e2e.js` configurations (pro; pseudo + full pseudo; xxxcross +
cross_opt, white+yellow) pass with 0 warnings and 0 frame failures. Remaining
slow spot: root XXXCross (13 moves, 3 pairs; ~11 s per call, off by default).

### 4.33 (2026-10-04, twelfth pass): reference solves #8-#11, one typo fixed, segmenter frame bug

The user added four solves (uncommitted at the start of this pass): #8
(`y2`), #9 (`y`, yellow cross, `// 3rd/4th pairs` as one step), #10 (no
inspection line, yellow cross, 3 steps), #11 (`x2`, a mid-step `y'` in its
2nd pair). `test/pro-references.test.js` failed on them, for three reasons:

1. **Test assumptions:** exactly 7 solves, always an inspection, always 4
   steps, always white. Relaxed to the real format (README now says
   inspection is optional and pairs may be combined).
2. **#10 doesn't solve as written:** `y U2' L' U L U' L' U L2` breaks the
   cross. An exhaustive search over every single- and double-token edit of
   that step found exactly one fix: the final `L2` → `L` (a natural typo).
   Corrected in `data/pro_references.txt`. **Flagged for the user to confirm.**
3. **Segmenter bug:** `segmentProSolve` decided "a pair was lost" by comparing
   slot names before and after a step. A mid-step `y'` relabels slots, so
   #11's 2nd pair looked like it lost BR and was merged with the 3rd and 4th
   pairs. It now also describes the state in the segment's **start** frame
   (`afterStart`: the step's net rotation undone) and uses that for the loss
   check and `newPairs`. The fallback for a root wide move that brings the
   cross colour down (#8's `r2`, no start frame with cross on D) keeps the
   end-frame names. The e2e harness had the same latent issue (it passed
   end-frame names as the engine's start-frame goal). It only worked before
   because every earlier rotated segment was a final 4-pair one. It now
   passes `afterStart.pairs`. The engine side of both harnesses moved into
   `tools/pro-search.js`.

**Membership (partial, `--config extended`, 200k cap):** the full run is
hours long on this machine (the 12-13-move 4-pair segments hit the cap at
~16 min each) and was stopped after 10 segments: #1 xcross/2nd/3rd, #2 all
four, #3 xcross/2nd FOUND; **#1 4th pair missing (CAPPED at 200k)**. The
pre-pass code (HEAD served from `git archive`, same data) gives the
identical result for #1 (3/4, 4th pair capped), so it is a cap limit and not
a regression. §4.26's "22/24" must have used a different cap. Re-run
segment-by-segment with `--only N` and a higher `--max` when there is time.
Regression runs this pass: `solver-bridge-e2e.js --pro` (3/3, white+green)
and `--pseudo` (2/2, 4 full-pseudo-only steps): 0 warnings, 0 frame
failures; slot-mapping and colour-orientation pass.

Segments now: #8 xxcross | 3rd | 4th; #9 xxcross | 3rd/4th; #10 xxcross |
3rd | 4th; #11 xcross | 2nd | 3rd | 4th (36 segments in total). Goal-no-op
moves are detected in #9 xxcross and #11 xcross too.

### 4.32 DONE (2026-10-04, twelfth pass): `alg_speed` tuned against the pro references (pushMult 1.3 → 0.8)

User request: adjust the speed algorithm in the simplest way possible so
professional solutions rank higher, benchmarked on `pro_references.txt`.

**Benchmark (`tools/pro-ranking.js`):** for each of the 36 segments, the
engine's solutions of that segment's goal up to the pro's length (pro move
set, shortest first, capped at 5000 like the app's per-search cap), plus
rotation spellings and root inspection variants, i.e. roughly what the app
ranks there. Pools have 14-67k algs, cached as JSON; building them takes
~10 min, and each ranking pass ~3-10 s. Each pool alg and the pro alg are
scored the way the app scores them (algSpeed of the whole path incl. the
step; the piece count is the same within a segment). The metric is the mean
log10 of the pro alg's estimated rank, so every segment counts and rank
5000 → 500 matters as much as 10 → 1. Also reported: mean percentile and the
count of pro steps inside the 500 rows the table shows. `--train 1-7` is the
tuning set; #8-#11 (new this pass) are held out.

**Sweep** (every algSpeed constant, one at a time, `--sweep`):
- `rotation` higher looked best on average (6: log rank 1.306, 32/36 in the
  top 500), but it only helps root steps (by burying rotation spellings)
  while it pushes down **every pro step that does rotate** (#5 4th pair:
  rank 2 → 38, #10 4th 83 → 194, #11 2nd 24 → 61). Rejected, since rotations
  are a mandatory requirement.
- `pushMult` lower (finger pushes on U/D turns) improves both train and
  held-out with no rotation penalty; 0.7-0.8 are equivalent (0.8 has the
  better mean percentile).
- Two-constant combinations on top of it (ringMult, double, addRegrip, ...)
  gain little and mostly on the train set. Not worth the extra change.

**Chosen: `pushMult` 0.8** (in `ALG_SPEED_DEFAULTS`, script.js; algSpeed's
signature now reads its defaults from that object). Mean log10 rank 1.386 →
1.269 (train 1.229 → 1.119, held-out 1.702 → 1.568); mean percentile 2.6% →
2.2%; top 500: 26 → 29 of 36; 20 segments better, 7 worse, 9 unchanged.
README "Ranking" and "Provenance" updated (it was "untuned except x").
Estimated ranks (sample 6000 per pool, so pools over 6000 have about ±0.02%
resolution):

| segment | pool | rank, pushMult 1.3 | rank, 0.8 |
|---|---|---|---|
| #1 xcross | 49828 | 4950 | 7317 |
| #1 2nd pair | 234 | 3 | 5 |
| #1 3rd pair | 1837 | 12 | 9 |
| #1 4th pair | 13630 | 1075 | 467 |
| #2 xcross | 63368 | 54 | 33 |
| #2 2nd pair | 18 | 1 | 1 |
| #2 3rd pair | 557 | 1 | 1 |
| #2 4th pair | 254 | 4 | 1 |
| #3 xcross | 50600 | 566 | 397 |
| #3 2nd pair | 3316 | 5 | 3 |
| #3 3rd pair+4th pair | 9133 | 572 | 426 |
| #4 xcross | 1380 | 2 | 2 |
| #4 2nd pair | 132 | 4 | 4 |
| #4 3rd pair+4th pair | 50 | 3 | 2 |
| #5 xcross | 33216 | 7 | 7 |
| #5 2nd pair | 14 | 1 | 1 |
| #5 3rd pair | 1187 | 1 | 1 |
| #5 4th pair | 3300 | 2 | 1 |
| #6 xcross | 66808 | 9810 | 7060 |
| #6 2nd pair | 472 | 10 | 7 |
| #6 3rd pair | 734 | 6 | 3 |
| #6 4th pair | 1564 | 5 | 8 |
| #7 xcross+2nd pair | 60828 | 4685 | 2150 |
| #7 3rd pair+4th pair | 39 | 1 | 1 |
| #8 xxcross | 43080 | 1739 | 1193 |
| #8 3rd pair | 34 | 2 | 1 |
| #8 4th pair | 8005 | 25 | 17 |
| #9 xxcross | 6040 | 1063 | 1102 |
| #9 3rd/4th pairs | 1084 | 12 | 9 |
| #10 xxcross | 48052 | 618 | 514 |
| #10 3rd pair | 951 | 2 | 2 |
| #10 4th pair | 9805 | 83 | 143 |
| #11 xcross | 35068 | 1480 | 2859 |
| #11 2nd pair | 2027 | 24 | 26 |
| #11 3rd pair | 306 | 5 | 1 |
| #11 4th pair | 4561 | 13 | 3 |

**Still weak:** root xcrosses (ranks ~200-8000). MCC is additive per move,
and the pros' xcrosses are longer (10-15 moves) than the best of the pool
(~9). No single constant fixes that.

### 4.31 DONE (2026-10-04, twelfth pass): look-ahead optimisation depth

User request: optimise results for the best combined next N steps (N = 2..5,
with a warning that 3+ is slow). Calculate the best step n, search step n+1
for each top solution (down to the depth), and re-rank step n by the
combined TPP of the sequence.

`solver-bridge.js`:
- `SolveSession.fork(candidate)` makes a copy that can commit without
  touching the original; it shares the tree, settings and `searchMemo`.
- `memoSearch` is `searchCurrentNode` memoised per (node, rotation, path),
  bounded to 48 entries.
- `bestContinuation` is a beam: at the first look-ahead level every top
  candidate is expanded, below that the best `LOOKAHEAD_INNER_BREADTH` (2).
  It returns the TPP after the last step. TPP is cumulative, so that IS the
  combined TPP. A path that completes early stops; a dead end is `Infinity`.
- `searchWithLookahead(session, h, onStatus, ph, {depth, breadth})`
  re-ranks the top `breadth` (default 5) by `lookaheadTpp` (stable sort);
  the rest keep single-step order. Re-ranked rows also carry
  `lookaheadAlgs`.

UI: index.html "look-ahead depth" (off/2-5) and "look-ahead breadth" plus a
performance note that turns orange at depth ≥ 3; saved as
`lookaheadDepth`/`lookaheadBreadth` in the criteria. solver.html gains TPP
and look-ahead columns (the look-ahead column shows the combined TPP → the
follow-up steps).

Search count per step: depth 2 = breadth extra searches; depth d ≥ 3 =
breadth × (1 + 2 + … + 2^(d-2)) at most (e.g. depth 5, breadth 5 = 75),
fewer when memo hits or the solve completes early.

**Verified:** `test/lookahead-e2e.js` (real WASM, smoke scramble). At
depth 2, every `lookaheadTpp` equals the best TPP from a fresh session (no
shared memo) that committed that candidate; re-ranked rows are sorted; the
rest keep single-step order; look-ahead changed the top-4 order. Committing
an explored candidate is a memo hit (< 50 ms). At depth 3, every
`lookaheadAlgs` sequence, replayed through fresh commits, reaches exactly
`lookaheadTpp`. Headless Chrome (depth 2, breadth 3): rows 1-3 show the
look-ahead, row 4+ "-", commit + next search fine, 0 exceptions/warnings;
the index note toggles at depth 3/5 and settings restore.

### 4.30 DONE (2026-10-04, twelfth pass): the active scramble's search jumps the queue

User request: a search started by committing a solution must go to the front
of the queue, with background scrambles deprioritised. Before, `solver-ui.js`
chained every search onto one FIFO promise, so a commit waited behind every
background scramble queued earlier.

New `js/search-scheduler.js` (`createSearchScheduler`, `SEARCH_PRIORITY`):
- BACKGROUND jobs start one at a time, only when nothing else is running.
- ACTIVE jobs start immediately.
- Every engine call goes through one priority gate (`wrap(helper)` proxies
  the helper's `solve*` methods). The call in flight finishes, then ACTIVE
  calls run. BACKGROUND calls wait for as long as any ACTIVE job is running,
  including the post-processing between its calls, so a background search
  pauses instead of interleaving.
- `setPriority` handles promotion and demotion.

`solver-ui.js`: `resultsFor(session, h, ph, priority)` submits or re-prioritises;
`runSearch` uses ACTIVE; `scheduleBackgroundSearches` uses BACKGROUND and
leaves already-queued sessions alone; `onActiveScrambleChanged` demotes the
scramble being left.

**Verified:** `test/search-scheduler.test.js` (fake timed helpers that throw
on overlapping calls): FIFO background, active pre-emption of queued and
running jobs, promotion, demotion, errors, no overlap under 6 mixed jobs.
Headless Chrome, same driver against HEAD (served from a `git archive`
copy) and the new code: 5 scrambles, xcross + xxcross, 500 solutions per
search. Clicking scramble 1's top result while the others search in the
background took **83.4 s → 7.0 s** to show step 2, with identical result
counts everywhere (21848/1000/21936/...), 0 exceptions, 0 warnings.

### 4.29 FIXED (2026-10-04, eleventh pass): background searching froze the whole page, including clicks on an unrelated, already-finished scramble

User report: with several scrambles queued, the page would go slow or
completely freeze while a background scramble was still searching -- and
this blocked interacting with a *different*, already-finished scramble
(e.g. picking scramble 1's best result and continuing to the next pair),
not just the one being searched.

**Root cause:** the WASM solve itself runs off-thread in a Worker (fine,
non-blocking), but `searchCurrentNode`'s post-processing of every raw
solution it returns -- a facelet replay for luck-filtering
(`checkCandidateAgainstRealCubeState`), plus rotation-spelling/
inspection-variant expansion under the pro move set -- is synchronous JS on
the main thread, with zero yield points, over a loop that commonly runs
into the hundreds or thousands of candidates per edge/color (`"4851 sols"`
in §4.24's own measurements). §4.28's background scheduler made this much
worse by queuing every scramble's search up front instead of only the
active one, so the *cumulative* time the main thread spends unbroken in
this loop grew with scramble count -- and since it's the main thread, no
click handler (even for an already-rendered, finished scramble's results
table) can fire until it yields.

**Fix:** `yieldIfDue()` (new, `solver-bridge.js`) hands control back to the
event loop via `await new Promise(r => setTimeout(r, 0))` whenever more than
48ms has elapsed since the last yield, checked once per iteration of the
main per-candidate loop (`for (const coreAlg of uniqueCoreAlgs)`). This
changes nothing about what gets searched, scored, or how candidates are
deduped -- only how the existing work is time-sliced -- so it's a pure
responsiveness fix, not a search-logic change.

**Verified:** `test/solver-bridge-e2e.js` (real WASM) gives byte-identical
candidate counts to before this change. Headless-Chrome CDP: with 5
scrambles (xcross on, pro move set on, for realistic candidate volume),
polled main-thread responsiveness every 150ms for 25s of sustained
background searching via trivial `Runtime.evaluate` round-trips -- max
117ms, zero samples over 300ms (previously, by the same mechanism this fix
targets, a single candidate loop could legitimately run unbroken for
seconds). With scramble 1 already "ready" and other scrambles still
searching, clicking its top result round-tripped in 14ms and committed
correctly.

### 4.28 (2026-10-04, tenth pass): background search, undo, reload persistence, granular config — implemented, plus one open finding

Four features added on top of the existing multi-scramble/queue
infrastructure (§4.18):

1. **Background searching.** `solver-ui.js`'s `scheduleBackgroundSearches`
   enqueues every scramble's search onto the existing single `searchQueue`
   as soon as the pruned tree is ready (active scramble first), instead of
   only when a scramble becomes active. `resultsFor`'s existing per-session
   cache means switching scrambles never restarts or blocks on a search —
   it either shows a cached result instantly or displays a per-scramble
   status badge (`pending`/`searching…`/`ready`/`search failed`) until the
   background entry resolves.
2. **Undo.** `SolveSession.undo()`/`canUndo` (solver-bridge.js) pop the last
   commit, step `currentNodeId` back, and — mirroring `commit()`'s root-only
   rotation capture — re-arm `rotation` when popped back to zero commits.
   Unit-tested (`test/solver-bridge.test.js`) including the "undo then
   commit a different branch" case and the rotation re-arm asymmetry.
3. **Reload persistence.** New `localStorage` key `cubecrit_session_state`
   (`{scrambles, colors, advanced, activeIndex, sessions}`, validated
   against the current criteria before being trusted) is written after
   every commit/undo/scramble-switch and replayed on load through the same
   `commit()` a click would use, not a hand-rolled reconstruction.
4. **Granular search configuration.** `categoryFor`/`categoryKeyFor` map an
   edge to one of `cross`/`xcross`/`xxcross`/`xxxcross`/`singlePair`/
   `multislot` (+ a `...Pseudo` variant each); `searchLimitFor` and the new
   `maxSolutionsFor` take optional `(searchConfig, isPseudo)` params that
   override the existing `DISTANCE1_LIMITS`/`LATER_LIMITS_BY_TOTAL`/
   `session.maxSolutions` defaults per category, falling back unchanged
   when no override is set (existing 3-arg call sites and
   `test/solver-bridge.test.js`'s exact-value assertions are untouched). A
   new `<details>` block on index.html exposes 6 rows × 4 fields; blank
   means "use the default."

**Verified:** full fast `test/` suite (new undo/config-override unit tests
included); `test/solver-bridge-e2e.js` and `test/pro-references-e2e.js`
(real WASM, unaffected — identical candidate counts to before this pass);
headless-Chrome CDP walkthroughs covering all four features end-to-end
(background fill-in while viewing another scramble, undo reverting then
re-committing a different pick, a simulated reload restoring committed
state from `localStorage`, and a deliberately-tiny `cfg-cross-maxlen`
override reducing a real search's result count to 0).

**Open finding, not yet root-caused — flagged for follow-up, not fixed
here:** while CDP-verifying undo and reload persistence, a cluster of
`"Discarding candidate: slot X claimed solved but is not actually solved"`
warnings appeared during the later-step (non-root) search that follows (a)
an undo-then-recommit cycle, and (b) a cold reload that lands straight on a
persisted non-root node (i.e. the search's *first-ever* call on a fresh
worker is a later-step, not a Cross-class root call — a code path reload
persistence newly makes reachable). This discards some real candidates
(never shows a wrong one — the luck-check's job is exactly to discard, not
to mislabel) so the user-visible effect is fewer results, not wrong ones.
**Could not reproduce in Node** despite three targeted attempts against the
real engine via `CrossSolverHelperNode`: (1) replaying the exact scramble +
exact committed candidate and searching the later step directly, (2) the
same thing with a second session's root search interleaved through one
shared queue (matching `scheduleBackgroundSearches`' actual call pattern),
and (3) a deliberate "cold start" that commits via `SolveSession.commit()`
directly (no prior search at all) before the later-step search — all three
gave 0 warnings. Since it only appears through the browser's persistent
Worker (`crossSolver/worker-persistent.js` + `solver-helper.js`), not
through `solver-helper-node.js`, and specifically for a later-step
(`postAlg`-bearing) call, this looks like a pre-existing timing fragility in
the worker/message-passing layer — possibly related to the per-call-state
isolation work already done for pseudoCrossSolver (§4.23's
`g_prune_cache`/"fresh per-call state" fix) but not yet confirmed to extend
to crossSolver's worker path — rather than anything in this pass's own
dispatch logic (which the Node reproductions rule out directly). **Next
step for whoever picks this up:** CDP-instrument `Runtime.consoleAPICalled`
warnings (not just exceptions) across a longer, repeated-navigation browser
session to get a reliable repro, then bisect `worker-persistent.js`'s
message handling for the specific call shape (non-root, `postAlg` set) as
the first call on a fresh worker.

### 4.27 FIXED (2026-10-04, ninth pass): browsers could keep running cached old engines

Found while browser-verifying the rebuilt engines: the server log showed no
requests at all for the workers, `solver.js`/`pseudo.js` or the `.wasm` files
-- Chrome served cached copies, so the page could silently run the old
engines (no `setNoopMoves`; the bridge's `typeof` guard then skips it). The
`?v=` cache-buster only covered the page scripts. Fix: `solver-ui.js` creates
both workers from explicit `…?v=${ENGINE_VERSION}` URLs and each worker
forwards its query string to its loader script and `.wasm` (vendored-file
change recorded in THIRD_PARTY_NOTICES.md). **Bump `ENGINE_VERSION` whenever
an engine binary or worker changes.** Verified (headless Chrome): all six
engine files fetched with the version (HTTP 200); 14,862 root results with
pro moves + pseudo (vs 11,356 when the stale engines ran), commit fine, no
console errors.

### 4.26 (2026-10-04, ninth pass): pro move set on by default; reference membership 22/24

Membership re-measured with both patched engines (no-op U moves, §4.22):
default move set **18/24** (was 16), pro move set **22/24** (was 20). The
two misses: #6 xcross (15 moves vs the 11-move limit, side-cross start) and
#7 xcross+2nd pair (side-cross start combined with a mid-step `x`). Per the
user's priority (professional-level solutions over speed), the "pro move
set" checkbox is now checked by default on index.html (saved criteria still
win). README "Move set" updated.

### 4.25 DONE (2026-10-04, ninth pass): side-cross inspections (pro move set, root)

Pros #6/#7 inspect with the cross on a side and bring it down with a wide
move; the engine can't search that directly (§4.20 item 6d). Built as the
rewrite designed there, generalised: `inspectionWideVariants(alg)` converts
an L/R-family turn among the first two into its wide form (identified by
permutation: e.g. R2 -> l2), which makes the alg "alg, then rho" for an
x-family rho, then undoes rho in the free inspection rotation and relabels
the alg — physically identical to the original including end orientation
(322/322 random checks; unit-tested). Root candidates in pro mode get these
variants (same node/labels, new inspection rotation via `rotationName`).
e2e `--pro --pick insp` (new pick mode: prefer inspections with the cross off
the bottom): 3/3 solved, one session committed `x' y'` + `l2 D2 R F R`; 0
warnings, 0 frame failures. Limits: only the first two turns (where the
technique is used; all subsets would multiply root candidates up to 64x), and
no mid-step `x` insertion, so pro #7 (`r2 U' D' x …`, two operations) and #6
(15 moves > the 11-move XCross limit) are still not found exactly.

### 4.24 (2026-10-04, ninth pass): default solutions per search raised to 500

User priority: accuracy over speed, maintain or increase solutions. Measured
(Node, white+yellow, xcross+xxcross+multislotting): 100 → root 8768 cands /
24.6 s (cold tables), step 2 2.3 s; 500 → root 43,084 / 21.9 s, step 2
8.9 s; 1000 → 76,424 / 32.7 s, step 2 18.9 s. UI default is now 500 (field
max 5000); the bridge's own default stays 20 so test baselines don't move.

### 4.23 DONE (2026-10-04, ninth pass): pseudo engine rebuilt — U-layer no-ops, tables built once

No upstream build script; the flags were inferred from `pseudo.js`
(non-MODULARIZE, memory growth, no Asyncify) and confirmed: rebuilding the
unmodified `pseudo.cpp` with `em++ -O3 --bind -s ALLOW_MEMORY_GROWTH=1` gave
output identical to the shipped binary. Saved as
`pseudoCrossSolver/compile.sh`.

Changes (THIRD_PARTY_NOTICES.md): the same `setNoopMoves()` gating (8
sites); each search class's move/multi tables (≈20 MB for xcross, the bulk
of the old 1-3 s per call) are built once into a pristine `static const`
prototype that is *copied* for each call (fresh per-call state, so nothing
can leak between calls); prune tables are cached in `g_prune_cache`, keyed
by kind, target index, depth parameter, table sizes and the sorted move set.
Verified: 30 calls (5 rotations incl. relabelled move lists, 1-3 pairs,
postAlg) run twice in one process in opposite orders are identical to each
other and to upstream. Two cached XXCross calls: 12 ms total (was ~2 s
each). Pseudo root XCross step in e2e: 12 s cold, then ~1.3 s (was 20-30 s);
e2e `--pseudo --pick full` 3/3 solved, 4 full-pseudo-only steps, 0
warnings, 0 frame failures. The bridge now passes `NOOP_MOVES` to pseudo
calls too.

### 4.22 DONE (2026-10-04, ninth pass): Emscripten installed; engine patched to allow U-layer "positioning" moves

User-authorised. emsdk installed at `~/emsdk` (emcc 6.0.11; `compile.sh`
already sources it; nothing added to shell profiles). **Baseline first:**
rebuilding the unmodified `solver.cpp` gives byte-identical output to the
shipped `solver.wasm` on a 15-call / 1597-solution battery (Cross..XXCross,
rotations, postAlg, wide/rotation move sets with centre offsets).

**Patch** (recorded in THIRD_PARTY_NOTICES.md): when a candidate reaches the
goal, the engine re-walks it and rejects it if any move leaves every tracked
index unchanged (16 copies of this check, all classes). That rule is what
excluded pro references #3 xcross / #3 2nd pair / #6 xcross (`R' U R'`
instead of `R2`). Now gated by `g_noop_allowed`, set per call via the new
exported `setNoopMoves()`; worker and both helpers pass a `noopMoves`
option and reset it on every call. The "goal already reached at an earlier
prefix" rule is kept (that one is genuinely redundant). With no moves
allowed the patched engine is byte-identical to upstream on the battery.

**Use:** `NOOP_MOVES = "U U2 U'"` for every matched search (U-layer turns
are the general human positioning technique; allowing every face would
mostly add idle B/F turns). Probe: #3 xcross found (2122 → 3295 solutions
at its depth), #3 2nd pair found (46 → 70), 0 physically invalid. e2e
default 6/6 (all colours), `--pro` 2/2, 0 warnings, 0 frame failures; smoke
counts unchanged; slot-mapping/color-orientation pass on the new binary.
The pseudo engine is not patched yet.

### 4.21 DONE (2026-10-04, ninth pass): every action has a cost, including x rotations

User decision. Measured first: `x`/`x'` cost 0 alone (MCC models them as a
wrist shift) and appending one added no cost ~85% of the time. `algSpeed`
now charges `x`/`x'` the rotation cost (3.5, same as `y`/`z`) and `x2`
`rotation * double`, only in the branches that consume the token (the
others hand back to the grip search, which re-runs it; charging there
double-counted: `x2` came out 12.5 instead of 7.8). Tests: every one of the
54 tokens costs > 0 alone, and appending `x`/`x'`/`x2` always increases cost
(0 exceptions in 2000 random contexts in the test, 15000 when measured).
Remaining non-monotonicity is not a free move: in ~0.04% of appends of an
ordinary move the total drops slightly (up to 2.6) because MCC re-optimises
grips for the whole sequence once it knows the next move. README "Ranking"
updated.

### 4.20 IN PROGRESS (2026-10-04, eighth pass): professional reference solves (`pro_references.txt`)

The user added `cube_tree_website/pro_references.txt`: 7 professional
solves (scramble, inspection, xcross + 3 pairs) that the solver must be able
to find "within its search tree, regardless of how the current scoring
algorithm ranks them", plus two stated gaps: the search doesn't use the move
subsets pros use, and rotations are not chosen during search ("mandatory").
They also edited README's procedural-rotation paragraph (rotation variants
are all valid results, the inspection rotation is free) and added
`or18_solver_docs.html` (upstream engine docs: move restrict incl. wide
moves/rotations, center restrict, max rotation count).

**Tooling:** `pro-references.js` (parse, physical replay, DAG segmentation,
goal-no-op detection), `test/pro-references.test.js` (fast), and
`test/pro-references-e2e.js` (slow: per DAG segment, asks the engine for
*all* solutions of that goal up to the pro's length with a given move-set
config and checks the pro's alg is among them, modulo commuting turns).

**Findings so far:**
1. All 7 solves physically complete. Pros' step boundaries sometimes leave
   the cross broken (#3, #4, #7); at DAG level those steps merge into one
   transition (e.g. #7 xcross+2nd pair = an XXCross).
2. **Bug, fixed:** the engine's move-adjacency pruning spans the postAlg
   boundary, so a later step could never start on the face/axis the previous
   step ended on (e.g. after "... R2" every R/L-first candidate was missing:
   19 of 33 found on #5's 2nd pair). Every later-step call now appends a
   neutral `y y'` (`POSTALG_BOUNDARY`); verified state-neutral, and e2e
   matched (6/6) + pseudo (2/2) runs have 0 frame failures.
3. **Membership, current config (18 face turns): 16/24 segments** (14 before
   the fix). Of the 8 missing: wide moves (#2 xcross, #7 xcross+2nd),
   mid-step rotations (#3 3rd+4th, #5 4th, #7 3rd+4th, #7 x), length over
   the spec limit (#6 xcross: 15 > 11), non-standard inspection (#6/#7 use
   `x'` then a wide move to bring white down), and moves that leave every
   goal piece in place (#3 xcross, #3 2nd pair, #6 xcross), which the
   engine prunes as redundant with no option to turn that off (needs a C++
   change).
4. **Boundary refined:** once rotations are searchable the engine groups `y`
   with the U/D axis, so a `y y'` tail blocked U/D-first candidates. The
   boundary is now `y2 y2` (y2 is never searchable): measured a superset of
   both `y y'` and no tail, in both move sets.
5. **"pro move set" option (new, opt-in, matched searches only):**
   `pro_moves` adds wide `r`/`l` and one mid-step `y`/`y'`/`x`/`x'`
   (`maxRotCount` 1, never y2) with the centre offsets that keep the cross
   colour on D (`proEngineOptions`). Bridge support: luck check in the
   step's starting frame (the candidate's own net rotation undone); the
   committed node is read off the physical result in the final frame
   (`nodeByLabels`, same lesson as §4.16); root results that *start* with a
   rotation are dropped (they duplicate free inspection variants); root
   inspection variants use the new mechanical `relabelAlgForRotation`
   (agrees with `altAlgs` on 900/900 face algs, physically exact on 1500/1500
   wide/slice/rotation algs). **Bug found on the way:** the variant loop
   stripped a *leading* rotation from every candidate, root or not, so a
   later step's `y' R U R'` became `R U R'` (33 false "not solved" warnings
   in one run, 0 after the fix). Verified: e2e `--pro --pick rot` 3/3
   sessions physically solved with `x`, `x'`, `y'`, `r`, `l` inside steps,
   0 warnings, 0 frame failures; headless Chrome: 176/392 root rows use
   rotations/wide moves, commit + re-search fine, no console errors. Cost:
   later single-pair searches can take 60-80 s in Node.
6. **Membership after all fixes:** current 16/24; extended (pro move set)
   **19/24** (wide-move #2 xcross, rotation #3 3rd+4th and #7 3rd+4th now
   found). Still missing: #3 xcross and #3 2nd pair (goal-no-op moves; engine
   change needed), #5 4th pair (the engine emits the un-rotated spelling
   `U' B U B'` for `y U' R U R'` -- a post-hoc rotation-spelling rewrite would
   close it), #6 xcross (15 > 11 moves, goal-no-op, `x'` inspection) and #7
   xcross+2nd (`x'` inspection + `r2 … x`). The harness normalises any run
   of same-axis moves (faces, wide, slices, the matching rotation) and
   never splits inside one; both were needed to avoid false misses.
6b. **Rotation spellings (closes the #5 4th-pair gap):** with the pro move
   set, every matched result also gets its rotation spellings
   (`rotationSpellings`: insert y/y' at each split point and relabel the rest
   mechanically; physically "alg, then that rotation", so validity carries
   over and only the end frame -- hence the node, read physically -- changes;
   at most one rotation per step, none leading at the root). Final dedupe
   now sorts by TPP first and keys on `commuteNormalize`d text, so `y U'` and
   `U' y` collapse to the better-scoring spelling. Membership with the pro
   move set: **20/24**. e2e `--pro` 3/3 (rotated spellings committed), 0
   warnings, 0 frame failures; headless Chrome fine (2976 root rows, 2792
   with rotations/wide). Remaining 4: goal-no-op moves (#3 xcross, #3 2nd
   pair; engine change), #6 xcross (15 moves, goal-no-op, `x'` inspection),
   #7 xcross+2nd (`x'` inspection).
   Note: `alg_speed` (MCC) treats `x` as a free wrist re-grip but charges
   3.5 for `y`/`z`, so x-rotation spellings rank high; faithful to the
   model, left untuned per spec.
6d. **Off-bottom inspections (#6/#7) can't be searched directly.** Probe:
   #7's root XXCross searched from its own `x'` inspection (green on D),
   pro move set, centre offsets that end with white on D, all 4 adjacent
   slot pairs, up to 400k solutions each (~5-6 min per pair): pro alg not
   found, and the engine's results end with white on D *without* a solved
   white cross -- its goal is tied to the starting frame, so starting off
   the cross colour searches the wrong thing. Such solutions can only come
   from rewriting white-down solutions: a generalised Cross optimisation
   that also absorbs the leftover x-rotation into the (free) inspection
   rotation (inspection J = I + M, alg = relabelAlgForRotation(converted,
   M) with M chosen so the net end rotation is y-family). Designed, not
   built: #6/#7 are also 15- and 12-move steps whose face-turn equivalents
   are one of hundreds of thousands of same-length solutions, so they would
   not reach the ranking at practical solutions-per-search anyway.
6c. **Solutions per search (UI):** index.html has a "solutions per search"
   field (default 100; the bridge's own default stays 20 so tests/smoke
   baselines are unchanged), saved with the criteria and applied as
   `SolveSession.maxSolutions`. The results table renders the top 500 rows
   only ("N result(s); showing the top 500"); ranking still covers every
   result. Headless Chrome: 8748 results, 500 rows, commit fine, no errors.
   Also: SEARCH with an empty scramble box now uses a random-state scramble.
7. README now documents these gaps ("Professional reference solves and known
   gaps") and the pro move set (as requested in pro_references.txt). The
   user's README edit (all inspection-rotation variants are valid results) is
   already what the code does: variants are deduped by rotation + alg, so all
   four are kept. `alg_speed` quirk noted: a bare `x` scores 0 (untuned model,
   left as is per spec).
8. **The per-call `maxSolutions` (20) hides almost all of them anyway:**
   #1's xcross is 1 of 2744 solutions at its depth; with 2000 per call it
   enters the pool (rank ~2500 of 39,832 by untuned TPP), with 20 never.
   `SolveSession.maxSolutions` now overrides the default (still 20).

### 4.19 FIXED (2026-10-04, eighth pass): committed Cross-optimised results with a residual rotation were dead ends; wide/slice moves now first-class

**Found while starting on `pro_references.txt`** (user-provided professional
solves using wide moves and mid-solve rotations).

1. **Notation bug (§4.13's "deliberate deviation" was wrong).** Cross
   optimisation emitted `d` for "D + y". Wide U (top two layers) *is* D + y,
   so the README's `u = D + y` was right all along; `d` means U + y'.
   Established three independent ways: automated search for each wide/slice
   move's decomposition against magiccube (`r = L x`, `l = R x'`, `u = D y`,
   `d = U y'`, `f = B z`, `b = F z'`, `M = R L' x'`, `E = U D' y'`,
   `S = F' B z`), the engine itself (every cross solution returned after a
   wide/slice `postAlg` physically solves the cross under those semantics),
   and the facelet fixture. The old cross-opt test hid the bug with a
   private expansion table that encoded the same mistake.
2. **Double rotation.** The candidate's `rotation` also had the residual
   composed in, and the wide text was passed to the engine as `postAlg`, so
   the residual was applied twice; and the engine returns nothing when a
   postAlg leaves the centres rotated. Measured: 12/12 committed cross-opt
   results with a `y`/`y'` residual broke the cross and offered 0 next-step
   candidates. (Earlier e2e runs never committed one.)

**Fix:**
- `facelet-cube.js` replays `r l u d f b M E S` (and `X2'`) natively;
  derived perms, verified by the regenerated magiccube fixture (555 cases).
- `canonicalizeForEngine(prefix, alg)` turns any committed text into
  `{rotation, moves}` (net rotation + face turns in the current frame) by
  conjugating with verified perms; 1000-sequence random identity test.
- `SolveSession.engineFrame` feeds every later-step engine call; candidates'
  `rotation` is the inspection rotation only; `replayFacelets` replays
  committed text as written; cross-opt emits `u`/`u'`.
- After: 12/12 with 76-80 next-step candidates; e2e `--pick wide` (new),
  8/8 sessions over 4 colours physically solved, 0 frame failures. Smoke
  test unchanged.

This is also the groundwork for mid-solve rotations and wide-move search
(pro_references.txt): any committed text, whatever its notation, now gives
the engine the right frame.

### 4.18 FIXED (2026-10-04): mid-search scramble navigation broke the next search; results cache added

`CrossSolverHelper` rejects a call while another is running ("Another solve
is in progress"). `solver-ui.js` discarded a stale search's *results* on
navigation but never stopped the search itself, so the newly shown
scramble's search ran concurrently and every one of its solver calls threw
(caught and skipped by `searchCurrentNode`), leaving "No results". Found by
a headless-Chrome scenario (search scramble 1, switch to 2 after 1 s):
0 rows and 10 console errors before; 796 rows, no errors after.

Fix (`solver-ui.js`): searches go through one promise queue, and each
session caches its current step's search promise keyed by node + committed
path (`resultsFor`). Returning to a scramble reuses the finished or in-flight
search (measured ~150-200 ms to render vs. a full re-search), which also
closes the §5 step 3 "no per-(session, node) results cache" note.

### 4.17 DONE (2026-10-04): random-state scrambles

README: "The eventual goal is proper random-state WCA-legal scrambles."
New `random-state-scramble.js`: picks a uniformly random reachable cubie
state (random permutations with matched parity, random orientations with a
fixed-up last piece), solves it with a two-phase search, and returns the
inverse (lengths ~20-22; rejects anything solvable in under 2 moves, per
WCA 4b3). No move tables are hand-typed. Each face turn's cubie form is
decoded from `facelet-cube.js` with the standard Kociemba facelet tables,
and coordinate move tables are built by BFS over real cubie states. Tables
take ~1-2 s once (first click), then ~30 ms per scramble. index.html loads
`facelet-cube.js` + this file; `populateScrambles` uses it, falling back to
the old random-move generator if absent.

Verified (`test/random-state-scramble.test.js`): cubie model == facelet sim
on 300 random sequences; 40 scrambles replay to exactly their random state;
invariants plus a loose uniformity check; the Python `kociemba` package
(independent solver) accepts and solves the scrambled states, confirmed by
replay. Browser: generates and feeds solver.html fine.

---

## 5. Actionable Roadmap

Ordered so each step unblocks the next; items in the same numbered step can
be done in parallel.

1. **Fix the DAG hand-off (blocking everything else) — DONE (2026-10-02)**
   - [x] `tree_gen.py` already wrote the right filename; the bug was that it
     resolved the path against the current working directory instead of its
     own location. Fixed to resolve against `SCRIPT_DIR`, and verified
     in-browser that `solver.html` fetches it with 200 OK (was a 404) and
     `pruneGraph` populates `localStorage` correctly.
   - [x] **Follow-up bug found and fixed:** the first regeneration surfaced
     a second, more serious bug in `extract_solved_slots()` — it read
     `c[0]`/`e[0]` (the first character of the piece's dict *key*, e.g.
     `"C_FR"[0]` → `"C"`) instead of `state["pieces"][c][0]` (the piece's
     actual current slot, e.g. `"FR"`), so every node's `corners`/`edges`
     labels were the literal strings `"C"`/`"E"` repeated, and — because
     `slot_mismatch_count()` depends on those labels — the mismatch-validity
     filtering used during generation was silently disabled. The buggy
     generator produced 174 nodes/449 edges with **zero fully-solved
     terminal states** (the DAG could never represent F2L being finished).
     Fixed to mirror `extract_action_slots()`'s already-correct pattern;
     corrected output is 238 nodes / 2393 edges / 4 terminal states, which
     exactly matches the old committed `F2L_tree.json` — confirming this
     was a regression introduced after that file was generated, not a
     long-standing design choice. Added
     [test_tree_gen.py](cube_tree_website/tools/test_tree_gen.py) as a regression
     test (structural + semantic DAG invariants, including a direct guard
     on real slot labels) — verified it fails on the buggy code and passes
     on the fix. Regenerated `f2l_nodes_and_edges.json` and
     `f2l_table_inspector.html` with the corrected generator.
   - [ ] Still open: decide whether `F2L_tree.json` (root) stays as a
     second copy for the Node scripts or is deleted in favor of one
     canonical file both browser and Node code read.

2. **Resolve the slot-index contradiction before trusting any multi-pair
   solve — DONE (2026-10-02)**
   - [x] Verified ground truth empirically by running the compiled
     `solver.wasm` directly (no `emcc` needed): a commutator that disturbs
     exactly one F2L pair was solved once per slot under four setup
     rotations, pinning down all four slots unambiguously. True mapping:
     `0=BL, 1=BR, 2=FR, 3=FL`. Saved as a regression test at
     [crossSolver/test/slot-mapping.test.js](cube_tree_website/crossSolver/test/slot-mapping.test.js).
   - [x] The docs side (`README.md`, `IMPLEMENTATION_NOTES.md`,
     `solver-helper.js`, `solver-helper-node.js`) was wrong and has been
     corrected to match. `cross_xcross.js`/`backend_test.js`'s
     `SLOT_INDICES` was already correct and needed no change.
   - [x] Follow-up: directly exercised `pseudo.cpp`'s `solve()` (which
     addresses slots by name string, not index, so it was never exposed to
     this particular ambiguity) to confirm it works correctly — see §3.

3. **Build the browser-side multi-step solver loop (the major remaining
   milestone) — CORE LOOP WORKING (2026-10-03), several items still open**

   This is the real product, scoped per README.md and the deviations in
   §4. New files:
   [solver-bridge.js](cube_tree_website/js/solver-bridge.js) (the search/
   scoring/session logic, Node-testable) and
   [solver-ui.js](cube_tree_website/js/solver-ui.js) (DOM glue for
   `solver.html`). `script.js` gained two small integration hooks
   (`window.onPrunedTreeReady`, `window.onActiveScrambleChanged`) called
   from the existing DOMContentLoaded handler and `scrambleController`,
   rather than duplicating that logic.

   **Verified working, both in Node (against the real DAG + real
   `solver.wasm`) and live in the browser (same scramble, same result
   counts and top results in both — 80 → 240 → 180 candidates across three
   real steps):** distance-1 search across multiple colors for
   Cross/XCross/XXCross/XXXCross, later-step single-pair and multislot
   search, TPP scored over the cumulative path (not per-edge), rotation
   carried correctly across every step via the solver's `rotation` option,
   the click-to-commit loop advancing the DAG node and re-searching, and
   the results table rendering the spec's columns.

   - [x] **Path/session state** — `SolveSession` class: current DAG node,
     cumulative `rotation` (locked in once, at the first commit),
     `scoredPath` (space-joined core algs), `committedRows` for display.
   - [x] **Single-step search dispatch** against `worker-persistent.js`
     (persistent prune tables) via the existing `CrossSolverHelper`
     Promise API, not forked child processes.
   - [x] **TPP scoring** (§4.2) over the cumulative path, reusing
     `calculateSolvedPieces(rootNode, targetNode)` as-is (pieces solved is
     monotonic, so scoring against the original root node already gives
     the cumulative total — no separate running counter needed) and
     `algSpeed(scoredPath + ' ' + candidate)`.
   - [x] **Distance-1-only rotation expansion** (§4.4) — `altAlgs` is only
     called when `isRoot`.
   - [x] **Single combined, TPP-sorted results table**, all spec columns.
   - [x] **Click-to-commit**, re-triggering search from the new node.
   - [x] **Search limits** per §4.6/§4.8 (`searchLimitFor`, keyed by total
     pairs in goal for later steps).
   - [x] **Luck filtering** (§4.3/§4.9) — **done (2026-10-04), see §4.12.**
     A solver-probe approach was tried first and reverted (§4.9: unreliable,
     false positives). The real fix ported `CFOPflags.py`'s facelet-mask
     logic to JS (`facelet-flags.js`) on top of a new, `magiccube`-verified
     facelet simulator (`facelet-cube.js`), and checks every candidate's
     real resulting cube state against its DAG edge's claim. Building this
     also surfaced and fixed an independent, more serious later-step
     dispatch bug (§4.12) that predated luck filtering.
   - [x] **Deduplication**: identical algorithm text returned multiple
     times by the solver (common — `maxSolutions` frequently yields
     repeats) is deduped before scoring/display. Note: dedup currently
     runs per (edge, color) only, so identical results from *different*
     edges can still both appear — a known, minor, low-priority cleanup
     item, not a correctness issue.
   - [x] **Fixed (2026-10-04) — later-step searches produced invalid
     solutions, and real duplicate DAG edges inflated every search's result
     count 2-3x.** Both root-caused and fixed in `searchCurrentNode`; see
     §4.10 for the full writeup and verification (real WASM solver + a real
     cube simulator, not just re-reading the code). The committed path is
     now re-verified to physically reach the claimed cross+pairs state at
     every step, for both a single-pair-only chain and a chain that
     includes a multislot step and reaches full completion.
   - [x] **§4.11: a distance-1 rotation-variant result could show the wrong
     slot name** in the "corners"/"edges" columns — **fixed (2026-10-04),
     see §4.12's final section** (`relabelSlotsForRotation`, derived
     empirically, not hand-derived). This checklist item was stale (still
     listed unfixed after the fix landed); corrected here.
   - [x] **Pseudo edges dispatched (2026-10-04, see §4.14).** The text below
     is the superseded pre-fix note, kept for history: (`isPseudoState` check just
     `continue`d past them) — `pseudoCrossSolver` dispatch isn't wired up
     yet. Not a regression: with the UI's current default checkboxes
     (pseudo off), this matches intended behavior already; it becomes a
     real gap only once "pseudo F2L" is checked. **Investigated
     2026-10-04 (see §4.14) but not fixed**: real infrastructure was built
     (Promise-based helpers, per-piece facelet masks) and is reusable, but
     the vendored `pseudoCrossSolver` binary itself was found to have an
     unreliable corner-targeting contract (root cause not yet identified),
     so dispatch was deliberately not wired in. Pick up from §4.14, not
     from scratch.
   - [x] **Simplified-pseudo checkbox** — **done (2026-10-04), see §4.15.**
     The DAG is now a superset (full pseudo); the checkbox restricts it.
   - [x] **Cross optimisation** (§4.5) — **done (2026-10-04), see §4.13.**
   - [x] **Multiple scrambles — verified in-browser (2026-10-03).** Set up
     two scrambles, searched and committed a step on scramble 1, navigated
     to scramble 2 (fresh search, empty solution box, independent results
     — confirmed not merged with scramble 1), then navigated back to
     scramble 1 (its committed step and prior result set were both
     correctly preserved). One minor, non-blocking inefficiency noted:
     `runSearch()` always re-invokes `searchCurrentNode` on navigation,
     even back to an already-searched node — there's no per-(session,
     node) results cache, so switching back and forth re-searches every
     time (fast in practice since the underlying solver's prune tables
     stay warm, but still redundant work worth caching later). **Done
     (2026-10-04), see §4.18**, which also fixes navigation mid-search.
   - [x] **Background searching, undo, reload persistence, granular
     per-category search config — done (2026-10-04, tenth pass), see §4.28**
     for the full writeup, including one open (unreproduced-in-Node) finding
     about later-step searches through the browser's persistent worker.
   - [ ] **Performance**: see §4.8's "finishing the last pair" cold-start
     cost (up to the better part of a minute, observed once over 8 minutes
     without finishing). No progress/latency mitigation beyond a generic
     "Searching..." status message yet. The *first* search of a session
     (distance-1, all checked colors × all checked pair-counts) is also
     unoptimized — fine for a handful of edges, untested at the scale of
     e.g. all 6 colors + xxcross + xxxcross + multislotting checked at
     once, which simplied to hundreds of edges in early testing and should
     be expected to take a while on first use.
   - [ ] **Look-ahead** deliberately left out, per spec.
   - [ ] **A concrete, reproducible test scramble + checkbox state was used
     for all verification above** (white only, no advanced options,
     scramble `R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2`) —
     worth re-running this same scenario as a quick smoke test after any
     future change to `solver-bridge.js`.

   **Incidental fix made while testing this in the browser:** `script.js`,
   `solver-bridge.js`, and `solver-ui.js` are now loaded with a
   `?v=20261003` cache-busting query string from `solver.html`/`index.html`
   — the browser was aggressively heuristic-caching these (no
   `Cache-Control` header from the dev server, only `Last-Modified`),
   serving stale JS across page loads within the same tab during testing.
   `crossSolver/solver-helper.js` deliberately does **not** get this query
   string: its `CrossSolverHelper` class self-detects its own script path
   via `document.currentScript.src` to compute the worker/wasm URLs, and a
   query string on that breaks the computed worker URL (confirmed: throws
   `Invalid URL` inside the worker). Bump the version string if
   `script.js`/`solver-bridge.js`/`solver-ui.js` change again and stale
   content seems to be served.

4. **Give `pseudoCrossSolver` the same persistent-table treatment as
   `crossSolver`**
   - [x] **Done (2026-10-04, §4.23).** Was: the main practical blocker for pseudo F2L (pseudo root steps
     take 15-80 s in Node, §4.14); a cheaper stopgap is capping candidates per
     step. Port the `Persistent*Solver` struct pattern documented in
     `crossSolver/IMPLEMENTATION_NOTES.md` §"Adding a New Solver" to
     `pseudo.cpp`, so pseudo-pair searches don't rebuild their BFS table on
     every call once multiple scrambles are searched per session. (Blocked
     on having `emcc`/Emscripten available to compile and verify — not
     present in this environment as of 2026-10-02.)

5. **Recyclable-utility follow-ups from §2**
   - [x] Port `CFOPflags.py`'s facelet-mask logic into a small JS
     verification helper — **done (2026-10-04), see §4.12** —
     `facelet-flags.js`, used by luck filtering.
   - [ ] `mirror_alg.py`'s R/L mirror utility remains optional, not
     spec-required; revisit only if/when widening the ranked pool beyond
     y-rotation variants becomes a priority.
   - [ ] Do **not** port `alg_speed.py`'s tuned constants — the spec is
     explicit that the untuned model is intentional for now.

6. **Extend beyond Cross/Xcross once the step-3 loop works for them**
   - [ ] Xxcross/Xxxcross as distance-1 options, and multislot/single-pair
     as later-step options — these reuse the same solver classes
     (`PersistentXxcrossSolver` etc. already exist), so this is mostly
     about exercising the step-3 loop's generality rather than new solver
     work.

7. **Train `alg_speed` on pairwise human speed comparisons, then one
   step-independent model (README "Future: one scoring algorithm for every
   step" and "Planned: training `alg_speed` on pairwise speed comparisons";
   7a done, 7b in progress, 7c fits §4.46 and §4.47)**

   *Why the change (2026-10-06, user decision):* 19 pro solves are too few
   to calibrate execution speed, and a pro's step only shows what they
   picked, not which of two steps is faster. Speed data will instead come
   from the developer judging pairs directly. `tools/pro-ranking.js` and
   `data/pro_references.txt` stay: coverage requirement (the solver must
   find the pro solutions) and a secondary ranking check.

   **System design: `tools/pair-compare.js` (terminal, Node, no browser)**

   - *Session loop.* Show one pair at a time: alg A and alg B (full move
     text, large and plain, A/B order randomised so position does not
     bias), optionally the step they belong to. Keys: `a` / `b` = that one
     is faster, `=` = too close to call, `s` = skip (not executable /
     unclear), `u` = undo the last answer, `q` = quit (everything already
     answered is saved). Show a running count (answers today, direct and
     derived totals, contradictions open). The developer executes both on
     a real cube before answering; the tool can optionally time how long
     an answer took, but the answer is the judgement, not the time.
   - *Candidate algs.* Drawn from what the app really ranks, so the data
     covers the decisions users see: result lists from the real bridge
     (`searchCurrentNode` / `searchWithLookahead` on random scrambles and
     at every stage: cross/xcross from inspection, single pairs, multislots,
     pseudo), plus the pro steps and their pools (`tools/pro-ranking.js
     --app` pools, cached). Each alg is stored with its step context
     (first step or later, step type) so a step-independent model can be
     checked per stage.
   - *Pair selection (most important first).* Only pairs whose answer is
     not already implied (see transitive inference). Among those, a score
     that favours: (1) pairs the current `algSpeed` (+ step penalty) scores
     as close (small relative difference) or a fitted model is least sure
     about (predicted win probability near 50%); (2) impact: both algs
     near the top of the same real result list, where a wrong order
     changes what the user sees first; (3) coverage: features the data has
     few answers for (`D`/`F`/`B`, wide `r l u d f b`, slices, mid-step
     rotations, regrips, long vs short algs); (4) algs that join separate
     components of the comparison graph, so transitivity can link them.
     A small share of random pairs keeps the selection from only checking
     the model's own blind spots, and a few already-answered pairs are
     asked again (spaced, unannounced) to measure the developer's own
     consistency.
   - *Storage.* Append-only `data/speed_comparisons.jsonl`, one line per
     answer: both algs (normalised notation), step context, the answer
     (`a`, `b`, `tie`, `skip`), timestamp, the `algSpeed` values and model
     version at the time, and whether it was a repeat. Raw answers are
     never rewritten; undo appends a retraction. Derived comparisons are
     recomputed from the raw answers, never stored as if judged.
   - *Transitive inference.* A directed "faster than" graph over algs, ties
     merged into equivalence classes. A > B and B > C gives A > C
     (transitive closure), so a few hundred answers yield thousands of
     ordered pairs. Cycles (A > B > C > A) are contradictions: reported,
     and their weakest edge (oldest / least consistent) is asked again
     instead of silently guessed. Derived pairs are weighted below direct
     ones (by path length) and are not independent, so validation uses
     direct answers only, split by alg (no held-out alg appears in
     training pairs).
   - *Fitting.* A pairwise model (Bradley-Terry / logistic on the
     difference of predicted times) over `algSpeed`'s existing parameters
     (`ALG_SPEED_PARAMS`, MCC) and one step-independent penalty set (the
     current `STEP_PENALTIES` without `wideRLFirst` / first-step
     `wideOther`). Measure: share of held-out direct comparisons ordered
     correctly (ties excluded), plus the old pro-ranking numbers as a
     secondary check. The new model replaces the current scoring only if
     it orders held-out comparisons better than the current one does.
   - *Target.* A few thousand comparison data points (direct + derived)
     from about a week of testing; a few hundred direct answers should
     already be useful thanks to transitivity and the pair selection.

   Phases:
   - [x] 7a. Build `tools/pair-compare.js` (candidate pool, selection,
     storage, transitive closure, contradiction check) with unit tests on
     the selection and closure logic; no app code changes. Done in the
     twenty-third pass (§4.45); differences from the design above are
     listed there.
   - [ ] 7b. The developer collects comparisons (~1 week). 101 answers
     so far (87 after removing wide-B pairs, §4.46).
   - [ ] 7c. Fit and validate one step-independent `alg_speed`; switch the
     app to it only if it wins on held-out comparisons; document the
     result in README "Ranking" and here.
     First pass done (§4.46): one step-independent stepPenalty + `turn`
     0.5 from 81 pairs (`tools/fit-alg-speed.js`). Second (§4.47): `turn`
     replaced by the naturalness language model (`natural` 0.15), which
     wins on held-out comparisons and on the pro benchmark. Refit (MCC
     constants, other penalties, `natural`) once there are a few hundred
     answers.

8. **Visual redesign (README "Planned: visual redesign"; waiting on the
   developer's design)**
   - [ ] Design phase -- the human developer designs the visuals and layout
     of both pages (typography, colour, spacing, structure, results table,
     controls, phone layouts), replacing the current placeholder look that
     reads as a default "AI-generated" site.
   - [ ] Implementation phase -- the agent codes the developer's design
     specification into `index.html`, `solver.html`, `styles.css` and the
     UI scripts without changing behaviour (all suites and a headless
     browser pass before and after). The agent does not invent visual
     direction; open questions in the spec go back to the developer.

---

## 6. Provenance & licensing housekeeping

**Resolved (2026-10-04, user-authorised):** the repository is licensed
**GPL-3.0** (`LICENSE`, canonical gnu.org text; or18's own LICENSE is the
same text modulo whitespace, checked). That is the simplest licence that
complies with everything included: the or18 engines are GPL-3.0, so the
combined work must be; Trangium's MCC (`algSpeed`) is MIT, which is
GPL-compatible as long as its notice is kept. `THIRD_PARTY_NOTICES.md`
reproduces the MCC notice verbatim (fetched from trangium/trangium.github.io),
credits or18, and lists every modification made to vendored engine files
(GPL-3.0 §5a) — keep that list current whenever `crossSolver/` or
`pseudoCrossSolver/` sources change. `magiccube`/`kociemba` are test-only
tools and are not distributed. `or18_solver_docs.html` (upstream docs) is
committed for context.

---

## 7. Open questions carried over from the spec

Per the spec, these four are explicitly implementation-level decisions, not
blocking ambiguities in the spec itself:

1. **DAG nodes for simplified vs. full pseudo** — **answered** (§4.1) and
   **implemented** (§4.15): same node set, superset edge set.
2. **UI/control mechanism for depth-N look-ahead** — deferred; single-step
   search is the correct default for the §5 step 3 build, per spec.
3. **Performance strategy for first-step wide-move generation** — **decided
   (2026-10-04, see §4.13):** every unique raw Cross solution gets the full
   `optimizeCrossSolution` treatment (not just the top-N), since the `2^k`
   subset search (k = algorithm length, capped at the Cross search limit of
   10) stayed fast enough in practice not to need throttling. Revisit if
   real usage with `maxSolutions` raised well beyond today's default shows
   otherwise.
4. **Concrete `maxSolutions`/time-budget defaults** — a placeholder
   `maxSolutions: 20` is hardcoded in `solver-bridge.js`'s `solverCallFor`
   now that the loop exists and can be observed; not yet tuned against real
   interactive-performance data (the Xxxxcross cold-start cost in §4.8 is
   the dominant latency issue right now, far more than this number). Revisit
   once luck filtering and pseudo dispatch are in and the loop's typical
   end-to-end timing is representative of the finished feature set.

A fifth, spec-adjacent gap surfaced during this review and is **not** one of
the four above, so it's called out separately: the spec's search-limits
table has no stated value for **XXXCross** (see §4.6). `solver-bridge.js`
currently uses 13 (the established `+1` pattern); this should be confirmed
or adjusted once real XXXCross usage data exists.
