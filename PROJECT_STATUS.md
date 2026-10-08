# cube⑂tree — Project Status

*Last updated 2026-10-07 (twenty-sixth pass).*

The working record: what exists, what is verified, what is open. The
product specification is [cube_tree_website/README.md](cube_tree_website/README.md);
where the two disagree about intended behaviour, the README wins. Older
pass-by-pass writeups (§4.1–§4.47 of earlier versions, 4,300 lines) were
removed in the twenty-sixth pass; the "§4.x" references in code comments
point to them: `git show a89ec3d:PROJECT_STATUS.md`.

## Where we left off

**Twenty-sixth pass (2026-10-07).** User tasks: remove the terminal
speed-comparison data (it made the rankings worse), clean up the codebase
and shorten the docs, get professional solve data from reco.nz (Yiheng
Wang, Xuanyi Geng) and tune `alg_speed` on it.

1. **Removed:** `tools/pair-compare.js`, `pair-compare-lib.js`,
   `fit-alg-speed.js`, `test/pair-compare.test.js`,
   `data/speed_comparisons.jsonl`, `data/speed_pool.json`; the comparison
   roadmap item. Also the superseded Node-only pipeline
   (`tools/backend_test.js`, `cross_xcross.js`, `harness.js`,
   `data/F2L_tree.json`) and `tools/fit-step-penalties.js`. README and this
   file rewritten (690 → ~290 and 4,300 → ~250 lines).
2. **Data:** `tools/reco.js` downloads reconstructions and converts them to
   `data/reco_solves.txt` (pro_references format, one `# reco.nz/solve/<id>`
   line per solve): 936 reconstructions → 934 solves (637 Yiheng Wang, 297
   Xuanyi Geng), 3,652 DAG steps; every solve replayed on the simulated cube.
3. **Tuning** (`tools/tune-alg-speed.js`, method below): every MCC
   constant, step penalty and the language model refitted on Yiheng Wang,
   checked on held-out Xuanyi Geng and pro_references.txt. The naturalness
   corpus is now every pro solve (`js/pro-steps.js`, 953 solves). Mean
   log10 rank of the pro's step, before → after: Yiheng 0.751 → 0.522,
   Xuanyi (held out) 0.759 → 0.595, references (held out) 0.521 → 0.351.
   In the app's own lists (`pro-ranking.js --app`, held out per solve):
   0.967 → 0.529, reference steps in the top 10: 43 → 51 of 66.
4. **Corpus candidates** (README): later steps also try every corpus alg
   (standard F2L algs + every pro step, mirrored, × y-rotation × AUF); those
   that solve exactly a searched goal join that call's solutions. ~8 ms per
   step; on random scrambles about half of the top-10 rows are corpus algs
   (`test/corpus-candidates-e2e.js`). The engine-only coverage test
   (`pro-references-e2e.js`) is unaffected by them.
5. **Found and fixed:** with the 10,000-solutions default the look-ahead's
   memo (500k candidates) evicted every follow-up search at once, so
   committing an explored candidate searched again (`lookahead-e2e` failed).
   Cap now 1M candidates (~440 MB); the test runs at 500 per call.
   `crossSolver/test/dag-search.test.js` still called the removed
   `withoutR2L2` (twenty-first pass); fixed with a local helper.
6. Also removed as dead code: `scoreAlgorithms`, `applyPerm`,
   `rotationNameFor`. Corpus candidates need the pro move set (always on in
   the app; sessions without it, e.g. `solver-bridge-e2e.js` without
   `--pro`, get none).

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

Fast suites (run before and after any change, from the repo root):

```
python3 cube_tree_website/tools/test_tree_gen.py
for t in cube_tree_website/test/*.test.js; do node $t || echo FAIL $t; done
```

Real-engine checks (slower): `test/pro-references-e2e.js` (pro solutions in
the search tree), `test/solver-bridge-e2e.js --pseudo --scrambles 2`
(full sessions, physical replay), `test/progressive-e2e.js`,
`search-options-e2e.js`, `lookahead-e2e.js`, `offload-e2e.js`,
`wide-moves-e2e.js`, `wide-spellings-e2e.js`, `cubedb-export-e2e.js`,
`corpus-candidates-e2e.js`,
`crossSolver/test/{dag-search,slot-mapping,color-orientation}.test.js`.
Browser: headless Chrome over CDP (`--headless=new --remote-debugging-port`,
Node's WebSocket), site served with `python3 -m http.server`.

Tools: `tune-alg-speed.js` (tuning, below), `reco.js` (data),
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
- Worst case (every option, no time limit) was 165 s for a root search
  before the 10,000 default; the time limit is the guarantee. **Needs
  re-measuring** with `tools/worst-case-bench.js --max 10000`.
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
2. **Worst case** with the 10,000 default: re-measure; pseudo calls are the
   expensive tail.
3. **More tuning data:** more solvers from reco.nz (`node tools/reco.js
   fetch <raw.json> "Name"`, then `convert`, `corpus`, `pools`, `fit`).
   Yiheng Wang's style (many mid-step rotations) dominates the fit; another
   CFOP solver would make it less personal.
4. **Visual redesign** (README): waiting on the developer's design.
5. A later step searched as the first call of a fresh browser worker once
   showed fewer results than Node (tenth pass, never reproduced).
