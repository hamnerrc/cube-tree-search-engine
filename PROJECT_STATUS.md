# cube⑂tree — Project Status

*Last updated 2026-10-08 (twenty-seventh pass).*

The working record: what exists, what is verified, what is open. The
product specification is [cube_tree_website/README.md](cube_tree_website/README.md);
where the two disagree about intended behaviour, the README wins. Older
pass-by-pass writeups (§4.1–§4.47 of earlier versions, 4,300 lines) were
removed in the twenty-sixth pass; the "§4.x" references in code comments
point to them: `git show a89ec3d:PROJECT_STATUS.md`.

## Where we left off

**Twenty-seventh pass (2026-10-08).** User tasks: (1) "hide unorthodox"
missed a top result, (2) multislot and wide moves as instant filters,
(3) pair-choice intuition for alg_speed trained on look-ahead outcomes,
(4) UI/UX redesign: on hold until the developer's designs arrive. The tree
was clean and every fast suite passed at the start.

1. **Unorthodox fix.** The user's top result (`U' F2 U' B2 D' L2 B2 R2 U2 F2
   U F R2 D2 B' U L R U R B' F'`, yellow `y2 | R' U' R2 F R D L2 F' L'`, an
   XCross) was a *first* step, and first steps were exempt by design. The
   flag (`isUnorthodox`, unchanged) is now set at every step; the
   inspection rotation comes before the step and does not count. Browser:
   that row is #1 unfiltered and hidden with the filter.
2. **Multislot and wide moves are filters.** The results page always
   searches with both (`searchOptions` multislot/wideMoves true) and hides
   them in `resultFilter` (candidates carry `multislot`; wide = `isWideAlg`),
   like unorthodox: toggling either way takes ~10 ms in headless Chrome, no
   search. Cost: later steps always search multislots, ~2x a later step's
   search (Node, 10,000/call, xcross start: 5 s → 11 s). While multislots are
   hidden the look-ahead's follow-ups are searched without them
   (`lookaheadMultislot`; identical lists, `search-options-e2e.js`), so the
   look-ahead keeps its old cost (depth 2: 18 s; 35 s with them). Hiding
   wide moves now shows the wide search's non-wide results (fewer than a
   search without wide moves would list; the old "wide twin" did the same
   after a search). The bridge's `multislot`/`wideMoves` session settings
   and wide-twin memo remain (tools and tests use them).
3. **Pair choice** (README "Pair choice", `tools/pair-choice.js`,
   `PAIR_CHOICE_LOOK` in script.js, `pairLookFeatures` in facelet-flags.js):
   TPP = (path cost + w · look features of the cube the path leaves) / pieces.
   Details and numbers under "Pair choice tuning" below.

## Layout

```
cube_tree_website/          the site (GitHub Pages root)
  index.html, solver.html   configuration page, results page
  js/script.js              DAG pruning, criteria, MCC algSpeed, stepPenalty, naturalness model
  js/pro-steps.js           generated: the naturalness model's professional corpus
  js/solver-bridge.js       SolveSession, searchCurrentNode, post-processing, look-ahead, export
  js/solver-ui.js           results page DOM, worker pools, IndexedDB prune-table cache
  js/facelet-cube.js        facelet simulator (verified against magiccube), spellings
  js/facelet-flags.js       which pieces are solved (luck filter), pseudo masks
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

Real-engine checks (slower): `test/pro-references-e2e.js` (pro solutions in
the search tree), `test/solver-bridge-e2e.js --pseudo --scrambles 2`
(full sessions, physical replay), `test/progressive-e2e.js`,
`search-options-e2e.js`, `lookahead-e2e.js`, `offload-e2e.js`,
`wide-moves-e2e.js`, `wide-spellings-e2e.js`, `cubedb-export-e2e.js`,
`corpus-candidates-e2e.js`, `pair-choice-e2e.js`,
`crossSolver/test/{dag-search,slot-mapping,color-orientation}.test.js`.
Browser: headless Chrome over CDP (`--headless=new --remote-debugging-port`,
Node's WebSocket), site served with `python3 -m http.server`.

Tools: `tune-alg-speed.js` (tuning, below), `pair-choice.js` (pair-choice
weights, below), `reco.js` (data),
`pro-ranking.js` (rank of the 19 reference steps in the app's real lists,
`--app`), `pro-references.js` (parser, segmenter), `pro-search.js`,
`worst-case-bench.js`, `engine-battery.js` (engine rebuilds must give
identical batteries), `node-engine-pool.js`, `node-postprocess-pool.js`,
`tree_gen.py`, `gen_facelet_fixture.py`.

## State of the product

Everything in the README is implemented except the visual redesign
(waiting on the developer's design) and the gaps listed under "Open".

- **Search loop:** DAG edges of the current node, deduplicated by target;
  later steps include every solved slot in their goal; matched calls via the
  crossSolver (pro move set, goal-DAG memoised search), pseudo calls via the
  pseudoCrossSolver (aligned with `alignPseudoAlg`). Luck filter replays
  every candidate on the facelet cube. Exact dedupe of rotation + alg.
- **Spellings:** inspection variants, rotation spellings, side-cross
  inspections, cross optimisation, wide spellings; no wide `b` anywhere.
- **Results page:** progressive results, look-ahead (best-first), per-step
  multislot / wide moves / filters, pagination, phone cards, Cubedb export,
  undo, reload persistence, background searching with the active scramble
  first, failed engine calls reported (worker restarted).
- **Engines:** prune tables shared between workers and kept in IndexedDB per
  `ENGINE_VERSION`; Asyncify kept off the hot recursion; post-processing on
  a worker pool. Engine changes are listed in THIRD_PARTY_NOTICES.md.

### Measurements

- Defaults (10,000 solutions per call, first-step limits 9/10/10/11; Node,
  xcross + xxcross + multislot, no pseudo): first step ~18 s, later steps
  ~4.7 s; headless Chrome first step 20.8 s (286k results), second 3.7 s.
- Worst case (`worst-case-bench.js --max 10000 --budget 60 --post 2`: every
  colour, xcross..xxxcross, multislot, full pseudo, pro moves): a root search
  took 155 s with the 60 s limit (2.7M results; post-processing and ranking
  ignored the limit). Now post-processing stops at the limit and the final
  ranking keeps only the best candidates that fit: 58–59 s (130–160k
  results), later steps 48–51 s. Without a limit a root search runs minutes.
- Coverage: 44/66 reference steps are in the engine's search tree
  (`pro-references-e2e.js`). For the reco data, 2,732 of 3,342 pro steps are
  in their tuning pool (engine up to the pro's length + 2, capped at 5,000,
  plus corpus algs, which include the solves' own steps).
- Memory: ~440 bytes per listed candidate; a root list at the default is
  ~300k candidates.

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
- `pgrep -f "<script> data"` inside a wait loop matches the loop's own
  command line: wait on a PID or a file instead.
- zsh does not word-split `${X:+--flag $X}`: pass flags explicitly.
- The dev machine has 2 physical cores: timings are noisy; alternate A/B
  runs, kill leftover headless Chromes.
- GitHub Pages: after `git push origin master:main`, check
  `api.github.com/repos/hamnerrc/cube-tree-search-engine/actions/runs` and
  compare live file hashes before judging live performance.

## Open

1. **Search coverage:** corpus candidates now put natural algs into later
   steps' lists; first steps (cross / xcross from inspection) have no such
   source and rank worst. Ideas: deeper R/U-restricted searches for the last
   pairs, more than one engine rotation per step, an inspection model.
2. **Worst case:** within the limit now, but only by cutting: with every
   option on, a root search lists ~150k of the ~1M+ candidates it could.
   Faster post-processing / ranking (commuteNormalize dedupe keys are most
   of the ~6.3 µs per candidate) would keep more.
3. **More tuning data:** more solvers from reco.nz (`node tools/reco.js
   fetch <raw.json> "Name"`, then `convert`, `corpus`, `pools`, `fit`).
   Yiheng Wang's style (many mid-step rotations) dominates the fit; another
   CFOP solver would make it less personal.
4. **Visual redesign** (README): waiting on the developer's design (user
   task 4, twenty-seventh pass: on hold).
5. A later step searched as the first call of a fresh browser worker once
   showed fewer results than Node (tenth pass, never reproduced).
6. **Pair choice:** more look-ahead data (pair-choice.js shards) and richer
   features (e.g. edge orientation of U-layer pieces, pairs one turn from
   connected) are the next levers; first-step pair choice (which xcross)
   gains most from the look-ahead and still trails it most.
7. **Later-step search cost doubled** by always searching multislots
   (task 2); a split multislot search (singles first, multislots merged
   in as the wide twin does) would make the visible list final sooner.
