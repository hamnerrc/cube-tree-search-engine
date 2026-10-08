# cube⑂tree

cube⑂tree is a browser-based solver for the Cross + F2L part of a CFOP 3×3
solve. Given a scramble, it helps a human find the **fastest
humanly-executable** path through Cross + F2L, not the shortest one.

> **This document is the product specification**: what cube⑂tree should do.
> What is actually built, measured and still open is tracked in
> [PROJECT_STATUS.md](../PROJECT_STATUS.md).

## The core idea: a DAG of abstract F2L states

Cross + F2L has 12 pieces: 4 cross edges and the 4 corner/edge pairs of the
slots FR, FL, BR and BL. cube⑂tree precomputes a **DAG** of abstract states
(cross solved or not, which corners and edges are in their slots),
independent of any scramble. An edge is a "solve N more pieces in one step"
transition. A solution is a path from the unsolved node to the node with all
12 pieces solved, normally **2–5 steps** (an XCross solves the cross and a
pair at once, a multislot two pairs at once).

## How solving works

1. The solver searches the DAG edges leaving the **current node** (at first,
   the unsolved node).
2. Each result is **one DAG edge**: the next step, never a whole solution.
3. The user clicks a result; it is committed, the cube advances, and the
   solver searches again from the new node.
4. This repeats until Cross + F2L is solved.

### Look-ahead

An optional, per-step results-page setting ranks results by the best
combined next *N* steps (N = 2–5; default off).

1. Search step *n* and rank it by TPP.
2. For each of the top results (the **breadth**, default 5), commit it
   tentatively and search the next step; below the first level only the
   best 2 continuations are followed, down to step *n+N−1*.
3. Re-rank those results by the TPP after their best sequence (TPP is
   cumulative, so that is the combined score). The rest keep their order
   below. A sequence that finishes Cross + F2L early stops there; one with no
   continuation sinks to the bottom of the block.

The single-step ranking is shown first; the block then re-ranks as each
candidate's look-ahead finishes (best-ranked candidates first, unfinished
ones show "…"). Each re-ranked row shows its combined TPP and follow-up
steps. Only the clicked step is committed; changing the depth re-searches
the step, reusing its single-step search. Depths of 3 or more are marked as
slow (tens of seconds to minutes per step).

## Orientation

Scrambles are applied with **white on top, green in front**. The cross
always finishes on the **bottom** face. A first step may start with a free
inspection rotation that brings the chosen cross colour to the bottom.

## Ranking: Time Per Piece (TPP)

All results (every step type, colour and rotation) form **one ranked list**,
sorted by

```
TPP = alg_speed(entire path so far, including this step) / pieces solved by that path
```

Lower is better. TPP is scored over the whole path, so a longer but smoother
step can outrank a short awkward one, and a Cross and an XXCross are directly
comparable. Results are never grouped by type.

`alg_speed` estimates how fast a human executes a move sequence. It is
based on Triangium's **MCC** hand-movement model, with these rules:

- **Every action costs time**: face turns, wide moves, slices and every
  rotation, including `x` (untuned MCC treated `x` as free).
- A rotation that **starts** a step is free (inspection, or done while
  looking ahead between steps); `y2` is only allowed there.
- **One scoring function for every step.** The same alg costs the same
  whether it is a cross, a first-step xcross, a later pair or a multislot.
  This is arguably the most important part of the site: ranking by
  execution speed is what sets cube⑂tree apart from move-count solvers, and
  a rule that changes from step to step makes TPPs harder to trust.
- Penalties on top of MCC only, never discounts: each step pays extra for
  move types professionals use less than MCC predicts (`D`, `F`, `B`, wide
  and slice turns, mid-step `y`), and for **unnaturalness**: how unlike real
  F2L its move sequence is, measured in bits by a trigram language model of
  cube moves trained on standard F2L algorithms and professional solves.
  MCC prices each finger movement on its own; humans execute familiar
  sequences as one motion.

**Tuning data: professional solves.** `alg_speed` is fitted so that the step
a professional actually executed ranks near the top of the alternatives the
search finds for the same goal. The data is
[reco_solves.txt](data/reco_solves.txt): reconstructions of real solves from
[reco.nz](https://reco.nz) (currently Yiheng Wang and Xuanyi Geng, ~930
solves, ~3,600 steps; `tools/reco.js` downloads and validates them), plus
[pro_references.txt](data/pro_references.txt). Fitting and validation use
`tools/tune-alg-speed.js`; a change is kept only if it also improves solves
the fit never saw (another solver's solves, the reference solves). The
language model is never evaluated on a solve it was trained on. Fitted on
Yiheng Wang, the current function ranks the held-out solver's later steps
in the top 10 of their alternatives 94% of the time (87% before), and puts
51 of the 66 reference steps in the app's own top 10 (43 before). A
professional sometimes executes a slower step than the best available, so
the target is where pro steps rank overall, not every pro step on top.

## What the DAG edges mean

A **distance-1** step starts from the unsolved node (the first step).

- **Cross**: the cross only.
- **XCross / XXCross / XXXCross**: the cross plus exactly 1 / 2 / 3 pairs in
  one first step. **XXXXCross is not offered.**
- **Single pair**: a later step that solves one pair.
- **Multislot**: a later step that solves several pairs at once. A
  results-page toggle (default off), set per step.

Configuration checkboxes **filter which edges are searched**; they never
create separate ranking buckets or change scores.

### Pseudo pairs

Normally a pair counts only when its corner and edge match and are aligned
with the D layer. **Pseudo F2L** (off by default) lets the search pass
through states with mismatched pieces in a slot, fixed later. **Simple pseudo
only** (results-page filter): after a mismatch, the next step may only repair
that mismatch. A lone corner or edge is never a target of its own.

### Luck filtering

A result must solve **exactly** what its DAG edge claims. A result that
solves more by luck is discarded there; it appears under the matching edge
instead (an XCross that also solves a second pair is an XXCross result).

## Search limits

| Step type | Max moves |
|---|---|
| Cross | 9 |
| XCross | 10 |
| XXCross | 10 |
| XXXCross | 11 |
| Single pair (later step) | 10 |
| Two pairs at once / multislot (later step) | 12 |

These are generous on purpose, to capture longer but smoother solutions.
Solutions per solver call default to **10,000** for every type (a saved 500,
the old default, becomes 10,000). Each row can get its own solution and depth
limit, separately for matched and pseudo searches; blank keeps the default.
A Single pair or Multislot override applies to every later step of that kind,
however many pairs are already solved.

**Performance goal:** one step's search with every option on (XCross to
XXXCross, multislot, full pseudo, the pro move set, every colour, the
deepest look-ahead) finishes in **under 1 minute**. The **search time limit**
(blank = none) guarantees it: the search stops at the limit and lists the
best results so far, cheap searches running first so the limit cuts the
expensive tail. The status line says when it did.

## Move set and spellings

The search uses the 18 face turns, plus the always-on **pro move set**: wide
`r`/`l` and at most one mid-step `y`, `y'`, `x` or `x'` (never `y2`), with the
cross still finishing on the bottom (matched searches; pseudo searches use
face turns). `U` turns may position pieces even when
they move no goal piece (`R' U R'` instead of `R2`).

Results are also offered in equivalent spellings, which `alg_speed` ranks like
any other result:

- **Inspection rotations.** One search derives every rotated variant of a
  first step (`F` = `y L` = `y2 B` = `y' R`); the free inspection rotation
  can make a step much faster. Variants leaving the cube in different
  orientations stay distinct results.
- **Rotation spellings.** The engine often returns `U' B U B'` for what a
  human does as `y U' R U R'`; both are offered.
- **Side-cross inspections.** An inspection with the cross on a side,
  brought down by a wide move in the first step.
- **Cross optimisation** (first step): rewrites with `r = L x`, `l = R x'`,
  `u = D y`, keeping only those that leave the cross on the bottom.
- **Wide spellings** (later steps): `D` as `u`, `U` as `d`, `B`/`F` as `f`,
  the rest relabelled (`D y R U' R'` = `u R U' R'`, `B U' B'` = `f R' f'`).
  Kept only if easier: fewer `D`/`F`/`B`/rotations, no extra `F`/`B`, at
  most two wide turns of one kind, cross still down. Also for pseudo pairs.
- **No wide `B`**: `b`, `b'`, `b2` never appear in any result.

**Corpus candidates** (later steps): the engine lists the shortest
solutions first, so with thousands of short ones a natural 9–11 move alg is
often never generated. Every later step therefore also tries the F2L
algorithms people actually use: the standard F2L algorithms and every
professional step in the tuning data, with their left-right mirrors, each
after a free `y`-family rotation and an optional `U` turn. Those that solve
exactly a searched goal from the current cube join that search's solutions
(luck filter, spellings and ranking as usual; at most the search limit's
number of turns, no mid-step `y2`). They are written as the professionals
wrote them, so they may rotate more than once.

Results-page options, set per step:

- **Wide moves** (default on): unticked, no result uses a wide or slice
  move. Unticking only hides; ticking a step searched without them searches
  them and adds them to the list.
- **Hide unorthodox** (default off): hides later steps that turn the `R` (or
  `L`) layer two quarter turns away from where the step started. `R` = +1,
  `R'` = −1; an `R2` at 0 reaches ±2 (unorthodox), at ±1 it goes to ∓1 (fine),
  so `R U R2 U' R` is orthodox and `R U R U' R'` is not. `r` counts as `R`,
  `l` as `L`; a `y`/`z` (also inside `u d f b`) resets both counts. First
  steps are never hidden; filtering needs no new search.

## Professional solves and coverage

[pro_references.txt](data/pro_references.txt) holds benchmark solves. **The
solver must be able to find these exact solutions in its search tree,
whatever their rank** (`test/pro-references-e2e.js`). Professional step
boundaries that do not land on a DAG node are merged (e.g. "xcross + 2nd
pair" as one XXCross). Including **rotation choices during the search is a
mandatory requirement**: professionals favour "spammable" `R`/`U` solutions
with rotations because they ease look-ahead.

Known gaps (measurements in PROJECT_STATUS.md): more than one rotation per
step; slice-like combinations beyond `r`/`l`; goal-no-op moves other than
`U` turns (pruned by the engine); steps longer than the search limits; and
pro solutions that are in the tree but lost among thousands of equally long
solutions when the per-call cap is reached.

## Configuration and results pages

The **configuration page** holds the search settings (colours, first-step
types, pseudo F2L, solutions per search, time limit, per-type limits) and
the scramble list. Generated scrambles are random-state (a uniformly random
state solved with a two-phase search and inverted, as WCA scramblers do).

The **results page** holds the per-step settings in labelled groups: search
(multislot, wide moves), filter (hide unorthodox, simple pseudo only),
look-ahead (depth, breadth), and results per page. A search setting
re-searches the current step (reusing what it can) and applies to later
steps until changed; a filter only hides, and the status line says how many.

The interface is lowercase and minimal (move notation keeps its case). No
inline explanations: hovering shows a one-line hint and an info icon opens a
short description of every option. Both pages work on phones, tablets and
desktops.

### Results table

Results appear **progressively** and re-rank as calls (and look-ahead)
finish; the final list equals the one shown at the end. 25 rows per page by
default; nothing is clipped (long algs wrap; narrow screens show cards).

| rank | colour | type | rotation | edges | corners | alg | TPP | look-ahead |
|---|---|---|---|---|---|---|---|---|

Type notes pseudo pairs; rotation is the first step's inspection rotation;
edges/corners are the slots this step solves. Two rows never show the same
rotation and alg; the better-ranked copy is kept. Clicking a row commits it.

The solution so far is shown one step per line, labelled like a
reconstruction (`z y // inspection`, `… // xcross`, `… // 3rd/4th pairs`).
It can be copied (scramble first) or opened on [Cubedb](https://cubedb.net)
(spaces as `_`, primes as `-`, the rest URL-encoded).

### Multiple scrambles, undo, persistence

- Every scramble's search starts when the list loads; one search runs at a
  time behind the scenes. Switching to a finished scramble is instant, to a
  running one does not restart it. Each scramble shows searching / ready /
  failed.
- **The scramble on screen comes first**: its next search jumps the queue,
  and a background search pauses at its next solver call.
- **Undo** steps back one committed step and re-runs the search there, so
  every alternative is available again.
- **Reload** restores every scramble's committed steps. A new search from the
  configuration page starts fresh.
- Scrambles are always solved independently; results are never merged.

### Planned: visual redesign

The current dark, monospace look is a placeholder. The **developer designs**
the new visuals and layout (typography, colour, spacing, structure, table,
controls, phone layouts); the **agent only implements** that design, invents
no visual direction, and changes no behaviour.

## Out of scope (for now)

- Last layer solving; EO-aware solving beyond the F2L DAG.
- Batch ranking across scrambles.
- XXXXCross as a target; a cross anywhere but the bottom.

## Provenance & licensing

Licensed under **GPL-3.0** ([LICENSE](../LICENSE)), required by the solver
engines. Notices and the list of changes to vendored code are in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

- Solver engines (F2L Lite, Pseudo F2L Lite, Pairing, prune tables, worker
  architecture): [or18/RubiksSolverDemo](https://github.com/or18/RubiksSolverDemo),
  GPL-3.0; upstream docs in [docs/or18_solver_docs.html](docs/or18_solver_docs.html).
- `alg_speed`: Triangium's MCC, MIT (Copyright (c) 2021 trangium), with the
  changes described under Ranking.
- Tuning data: reconstructions from [reco.nz](https://reco.nz), each
  credited by its solve id in `data/reco_solves.txt`.
- Other code (DAG generator, UI, scoring plumbing) was written with AI
  assistance.
