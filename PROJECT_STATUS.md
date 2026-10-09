# cube⑂tree — Project Status

*Last updated 2026-10-08 (twenty-eighth pass).*

The working record: what exists, what is verified, what is open. The
product specification is [cube_tree_website/README.md](cube_tree_website/README.md);
where the two disagree about intended behaviour, the README wins. Older
pass-by-pass writeups (§4.1–§4.47 of earlier versions, 4,300 lines) were
removed in the twenty-sixth pass; the "§4.x" references in code comments
point to them: `git show a89ec3d:PROJECT_STATUS.md`.

## Where we left off

**Twenty-eighth pass (2026-10-08).** User tasks: (1) UI: "hide unorthodox"
renamed "hide awkward f2l solutions" and never hides a first step; the
configuration page's "search" box (solutions per search, time limit)
removed; (2) solution continuity: EO-aware pair planning, learned, no rigid
rules, toggleable for beginners; (3) a complete search: the best N
solutions under the move limit, every rotation and wide-move insertion
checked, optimisation after. The tree was clean and every fast suite
passed at the start.

1. **UI.** Done as asked. Saved criteria from before (CRITERIA_VERSION 4)
   lose `maxSolutions` / `timeLimit`; first steps are never flagged
   `unorthodox` (`postProcessCall`, `postProcessComplete`).
2. **Complete search** (README "Complete search", `js/spelling-search.js`,
   `postProcessComplete` in solver-bridge.js). Details and numbers under
   "Complete search" below. Correct and verified (exact against brute
   force; zero of the old capped search's top-25 rows missing within the
   limits; every result physically replayed), but **slower than before**:
   on this 2-core machine a first step takes ~25-90 s and a later step
   ~10-50 s (old: ~20 s and ~5-13 s). The performance goal (one step < 1
   min with every option on) is **not met** yet: see Open 1.
3. **Pair planning** (README "Pair planning", `planFeatures` in
   facelet-flags.js, `PAIR_PLANNING` in script.js, results-page "ranking"
   group). Details under "Pair choice tuning" below.

## Layout

```
cube_tree_website/          the site (GitHub Pages root)
  index.html, solver.html   configuration page, results page
  js/script.js              DAG pruning, criteria, MCC algSpeed, stepPenalty, naturalness model
  js/pro-steps.js           generated: the naturalness model's professional corpus
  js/solver-bridge.js       SolveSession, searchCurrentNode, post-processing, look-ahead, export
  js/solver-ui.js           results page DOM, worker pools, IndexedDB prune-table cache
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

Tools: `tune-alg-speed.js` (tuning, below), `pair-choice.js` (pair-choice
weights, below; `--model none+look+plan`), `continuity.js` (greedy solves:
rotations, slot order, planning on/off), `complete-coverage.js` (pro steps
in the complete search's space, no engine), `reco.js` (data),
`pro-ranking.js` (rank of the 19 reference steps in the app's real lists,
`--app`), `pro-references.js` (parser, segmenter), `pro-search.js`,
`worst-case-bench.js`, `engine-battery.js` (engine rebuilds must give
identical batteries), `node-engine-pool.js`, `node-postprocess-pool.js`,
`tree_gen.py`, `gen_facelet_fixture.py`.

## State of the product

Everything in the README is implemented except the visual redesign
(waiting on the developer's design) and the gaps listed under "Open".

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
- **Results page:** progressive results, look-ahead (best-first), filters
  (multislot, wide moves, hide awkward, simple pseudo), pair planning,
  pagination, phone cards, Cubedb export, undo, reload persistence,
  background searching with the active scramble first.
- **Engines:** prune tables shared between workers and kept in IndexedDB per
  `ENGINE_VERSION`; the cross engine worker sends solutions in batches
  (`ENGINE_GLUE_VERSION`, its own URL parameter so the table cache stays).

### Measurements

- Complete search, this 2-core machine (4 threads), headless Chrome (1
  engine worker, 2 post-processing workers), white, xcross + xxcross:
  scramble `R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2` first
  step 58 s, second 44 s (old capped search: 21 s, 13 s; before the
  second round of bound work 82 s / 48 s). Node, same pools: 42 s / 39 s
  (were 65 s / 40 s); scramble `D R2 U' B2 ...` 63 s / 85 s. On it, every engine call of the first step is done
  after 5.3 s; the rest is ranking spellings of 64,162 crosses (≤9 turns)
  in 24 inspection orientations. Other scrambles: first steps 23-25 s,
  later steps 2-57 s (`complete-search-e2e.js`).
- `complete-search-e2e.js --scrambles 2 --seed 5` (2-core box, old search
  run on the same cubes): 0 of the old top-25 rows within the limits
  missing over 7 steps, 5,364 results replayed exact. Scramble `D R2 U' B2
  U' R2 D2 R2 U B2 U' R2 B2 U' R' B2 F L D' F R' B2`: the complete search's
  best first step `z' y' | D L' U L U' L' r' D2 L` has TPP 5.79, the old
  search's best 7.21 (a side-cross spelling it never generated) -- but that
  step took 179 s (old 55 s); later steps 0.5-93 s (old 2-5 s).
- Solutions per goal (face turns, uncapped): cross ≤9 24k-65k; xcross ≤10
  0.5k-4.5k per slot; 2nd pair ≤10 3k-54k (≤11: 35k-300k, ≤12: 0.2M-1.8M);
  two pairs at once ≤12 1k-31k.
- Coverage (`complete-coverage.js`): reco.nz later steps in the complete
  search exactly as written 89.7% (limit 11: 92.8%), first steps 66.0%;
  pro_references 45/47 later, 11/19 first (the rest are longer than the
  limits). The old engine search had 44/66 of the reference steps in its
  tree, and its 10,000-solution cap lost more in practice.

## Complete search

Design (README "Complete search"): the engine lists every face-turn
solution within the limit (`COMPLETE_ENGINE_CAP` 3M only guards runaway
settings); `SpellingSearch.topSpellings` finds exactly the best N of each
RESULT_VIEWS filter among all spellings of all of them; calls of one step
type share the N-th best (`typeLimits`, a big call waits for its type's
smaller calls), and `trimToTypeBest` keeps exactly the best N per type and
view at the end. Big calls (> 25,000 solutions) are ranked in chunks on the
worker pool (`completeChunks`, solutions that end alike together).

The bound (spelling-search.js header): cost ≥ C0 + Σ tokens (penalty +
natural·bits + least MCC of the token) + look. C0 = least start time of the
committed path's MCC checkpoint. Per-token least MCC from algSpeed's cases
(`mccMinimum`; R quarter turns may get 0.5 back, the first of a U/D pair
may add nothing). The remaining moves are bounded by a DP over (moves
left, frame, mid rotation used, context flag): exact trigram bits for plain
runs, and after any other written token (wide, rotation, split quarter) an
exact-context continuation `afterKnown(j, frame, r, prev)`, memoised per
row. Rows depend only on the last moves + 2 of context, so solutions sorted
by their endings share rows. Per spelling the bound is within 0.2-3 units
of the real cost (MCC); the DP's minimum over spellings was the loose part:
without the rotation-used state and exact contexts after a frame change it
hopped between relabelings (slack 26 units on root crosses), now 11-16.

Order of work (`enumerate`): a cheap estimate of each solution's plain
spelling picks 256 to walk first (a tight N-th best early); then every other
solution in suffix order, its bound table shared with the previous one and
walked at once if the bound fits (the walk reuses the table). Exact either
way: each solution is walked or its bound exceeded the N-th best when it
was checked. Root capture (scramble `D R2 U' B2 ...`, 4 big calls): 153 s
→ 87 s single-threaded, identical top 50 per call.

Known exclusion: spellings whose turns cancel (`L' l r` for `R`) are not
generated; the old pro-move-set engine produced some.

Verification: `test/spelling-search.test.js` (best N of every view equal
brute force, first and later steps, shared rows; physical spellings; bound
≤ real cost; known spellings generated); `complete-search-e2e.js` (old
top-25 rows within the limits all present: 0 missing over 8 steps;
thousands of results replayed, all exact).

Things that did not help (do not retry as is): stopping a solution's bound
early once its ending alone is too costly (an ending is almost never too
costly alone); a prefix-shared walk without the per-solution DP (5x more
nodes).

## alg_speed tuning

Cost of a path = MCC(path) + Σ stepPenalty(step); stepPenalty = weights ×
(`D`, `F`, `B`, wide `r/l`, wide `u/d/f`, slices, mid-step `y`) + `natural`
× algSurprise (Kneser-Ney trigram LM over move tokens; corpus
`HUMAN_F2L_ALGS` + `js/pro-steps.js`, left-right mirrored; leading rotations
dropped, mid-step rotations are tokens). Same function at every step.

Method (`tools/tune-alg-speed.js`): for every pro step, the engine's
solutions of the same goal up to the pro's length + 2 (≤ 5,000, with the
app's spellings and corpus candidates) form a pool; the pool's 300 best under the current model
are kept exactly, plus 700 random others (weighted). Metric: mean log10
rank of the pro's step (also top-10 rate, mean percentile). Fit on Yiheng
Wang (coordinate search), held out: Xuanyi Geng and pro_references.txt. The
LM is out-of-fold for training solves (5 folds) and trained on Yiheng only
for held-out ones; the app's LM uses everything.

Current values (`js/script.js`): MCC wristMult 0.836, pushMult 1.2,
ringMult 1.72, destabilize 0.245, addRegrip 0.25, double 3.23, sesliceMult
1.25, overWorkMult 0.395, moveblock 0.28, rotation 6.86; penalties D 0,
F 2.41, B 5, wideRL 1.15, wideUDFB 4.31, wideOther 3.31, rotMidY 0, natural
0.84; LM order 3, discount 0.95, proWeight 3. Slice costs kept (19 of 3,342
pro steps use a slice: not identifiable; the fit's values changed nothing
measurable).

| group (mean log10 rank; top 10) | before | after |
|---|---|---|
| Yiheng Wang (fit), all 2,503 steps | 0.751; 69.4% | 0.522; 81.2% |
| Xuanyi Geng (held out), 773 | 0.759; 70.2% | 0.595; 77.7% |
| … first steps, 253 | 1.612; 36.0% | 1.258; 45.1% |
| … later steps, 520 | 0.344; 86.9% | 0.273; 93.7% |
| … later steps that rotate, 107 | 0.503; 79.4% | 0.363; 94.4% |
| pro_references (held out), 66 | 0.521; 75.8% | 0.351; 89.4% |

A joint refit of the penalties on both solvers gained nothing on the
references; a turn-count penalty and a mid-step x/z penalty were offered to
the fit and stayed at 0. First steps remain the weakest (inspection
planning is not modelled).

To retune: `node tools/tune-alg-speed.js pools --shard 0/2 --cache a.jsonl`
and `--shard 1/2 --cache b.jsonl` (~45 min with both cores; a 20 s engine
deadline per step), then `fit --cache a.jsonl,b.jsonl` (~1 h for all
parameters, seconds for penalties only) and `eval`. After changing the data,
`node tools/tune-alg-speed.js corpus` regenerates `js/pro-steps.js`.

Rejected or not worth retrying:
- Pairwise speed comparisons by the developer (twenty-third to twenty-fifth
  passes): too few answers, a flat per-turn cost fitted on them made the top
  results less ergonomic. Removed.
- (Revised) a higher MCC rotation cost was rejected on 19 solves because it
  buried rotating pro steps; on 3,000+ steps, rotation 6.86 together with
  rotMidY 0 ranks rotating pro steps much higher (table above).
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
- GitHub Pages: after `git push origin master:main`, check
  `api.github.com/repos/hamnerrc/cube-tree-search-engine/actions/runs` and
  compare live file hashes before judging live performance.

## Open

1. **Complete search speed** (user task 3, twenty-eighth pass): exact but
   slow; first steps ~25-90 s, later steps ~2-57 s on this 2-core machine
   (old: ~20 s / ~5-13 s). Where the time goes: ranking spellings (the
   engine is done in ~5 s); the bound pass over every solution (~6-15 µs
   per bound row) and walks of solutions the bound cannot rule out. Levers,
   in order: (a) a tighter MCC bound -- MCC's regrips are most of the ~23
   units of slack; a DP over wrist states (MCC's own state machine,
   minimising over grips is still a lower bound of its greedy result) would
   let most solutions be skipped; (b) the first step's 24 inspection
   orientations (most of a root walk's nodes): a per-orientation bound
   table; (c) typed-array, closure-free boundTable (~2-3x per row); (d)
   sharing work between the cross and xcross calls of a colour.
2. **Search coverage:** 89.7% of pro later steps and 66% of first steps
   are in the complete search exactly as written; the rest are longer than
   the limits (single pair 10, first steps 9-11), use slices, or rotate
   twice mid-step. First steps rank worst (no inspection model).
3. **More tuning data:** more solvers from reco.nz (`node tools/reco.js
   fetch <raw.json> "Name"`, then `convert`, `corpus`, `pools`, `fit`).
   Yiheng Wang's style (many mid-step rotations) dominates the fit; another
   CFOP solver would make it less personal. Also: refit `alg_speed` on the
   complete search's pools (the fit used capped pools).
4. **Visual redesign** (README): waiting on the developer's design.
5. **Pair planning:** pro check of the planning weights; slot-order
   (visibility) preference fitted on pro choices; more look-ahead data.
6. A later step searched as the first call of a fresh browser worker once
   showed fewer results than Node (tenth pass, never reproduced).
7. **Worst case** (every option on): not re-measured with the complete
   search; the search time limit (`SolveSession.timeBudgetMs`) still exists
   for tools but is no longer on the configuration page and does not cut
   the complete search's ranking.
