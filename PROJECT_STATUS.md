# cube⑂tree — Project Status

*Last updated 2026-10-09 (twenty-ninth pass).*

The working record: what exists, what is verified, what is open. The
product specification is [cube_tree_website/README.md](cube_tree_website/README.md);
where the two disagree about intended behaviour, the README wins. Older
pass-by-pass writeups (§4.1–§4.47 of earlier versions, 4,300 lines) were
removed in the twenty-sixth pass; the "§4.x" references in code comments
point to them: `git show a89ec3d:PROJECT_STATUS.md`.

## Where we left off

**Twenty-ninth pass (2026-10-09).** User tasks: (1) rankings had got much
worse with the complete search: retune on the professional solves only,
including how often each move type (wide moves etc.) is in the top result
vs the pro's step, and keep raising the top-10 rate; (2) make the searcher
significantly faster; (3) no UI/UX redesign yet. The tree was clean and
every fast suite passed at the start.

1. **Ranking** ("alg_speed tuning" below): pro steps are now ranked in the
   complete search's own list for their goal (`tune-alg-speed.js cpools`),
   the loss adds a move-type frequency gap, pair-choice weights are fitted
   with alg_speed, λ chosen by CV. New weights: first-step pro steps in the
   top 10 21% → 27%, later 91% → 92%, references 0.521 → 0.454 mean log10
   rank; first-step wide moves in the top result 54% → 45% (pros 46%).
   Ceiling: 74% of the pro steps still outside the top 10 are longer than
   the app's top result (54-58% by 2+ turns): planning/findability, not
   execution speed.
2. **Speed** ("Complete search" and "Measurements" below; every change
   checked for identical result lists): cheaper bound tables, first-token
   rows at the root, meet-in-the-middle rows, seeding, tighter walks,
   planning features in one pass, and above all the worker pools (the page
   ranked on one worker; one call per worker; chunks ≤ workers with shared
   seed limits). Browser (headless Chrome, this 2-core machine, warm):
   scramble `R2 U2 L D' ...` first step 58 s → 14.8 s, second 44 s →
   7-9 s; the hardest known scramble's first step ~35 s.

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

- Browser, headless Chrome on this 2-core machine (it reports 2 threads:
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

Twenty-ninth pass (speed; every change verified by identical result lists
on captured real calls -- 6 later-step/cross captures and the 11 calls of a
root search -- plus the brute-force tests):
- The table above replaced an exact-context one (memo per written token,
  rotation-used state): ~8x cheaper per row, looser (passes 8.6% vs 3.6% of
  a later step's solutions, 12.5% vs 2.5% of root crosses), but walking
  with it is faster: a 166k-solution later call 70 s -> 11 s.
- First steps (`opts.root`) add a second tier: rows that keep, per frame,
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
- GitHub Pages: after `git push origin master:main`, check
  `api.github.com/repos/hamnerrc/cube-tree-search-engine/actions/runs` and
  compare live file hashes before judging live performance.

## Open

1. **Speed** (user task, twenty-ninth pass: "significantly faster before we
   can call it finished"): a first step is 15-35 s on this 2-core machine
   (more workers help on bigger machines). Next levers: first-step walks
   (most nodes are children pruned on entry; MCC's regrips are most of the
   remaining slack -- an exact incremental MCC lower bound would need
   algSpeed as a per-token state machine: the round-based version via
   `stopAt` cost more than it pruned, see "Complete search"); fewer
   spellings to rank at the root (24 orientations); small xxcross calls.
   Side-cross inspections (20 of the 24) take 85% of a root call's walk
   nodes (~3,900 per exactly scored spelling vs ~1,750 for y-family ones)
   and give 50-70% of its results: their bound (wide/rotation counts and
   the rotation-used state are not in the tables) is the place to start.
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
5. **Visual redesign** (README): waiting on the developer's design.
6. **Pair planning:** checked (twenty-ninth pass) on 80 reco.nz solves the
   tuning pools did not use, the app's full search at every pro node (best
   5 per pair choice, re-scored offline): the pro's pair choice ranks first
   at 28.0% of first steps (22.7% with the weights from before the pass)
   and 62.8% of later steps (64.2%; MRR 0.788 vs 0.792). Still open: a
   slot-order (visibility) preference fitted on pro pair choices.
7. A later step searched as the first call of a fresh browser worker once
   showed fewer results than Node (tenth pass, never reproduced).
8. **Worst case** (every option on): not re-measured with the complete
   search; the search time limit (`SolveSession.timeBudgetMs`) still exists
   for tools but is no longer on the configuration page and does not cut
   the complete search's ranking.
