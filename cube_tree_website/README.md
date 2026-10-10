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
combined next *N* steps (N = 2 or 3; default off). Deeper look-aheads
(4 or 5 steps) are not offered: they are no use for finding a human solution.

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
the step, reusing its single-step search. Depth 3 is marked as slow (tens
of seconds per step or more).

## Orientation

Scrambles are applied with **white on top, green in front**. The cross
always finishes on the **bottom** face. A first step may start with a free
inspection rotation that brings the chosen cross colour to the bottom.

## Ranking: Time Per Piece (TPP)

All results (every step type, colour and rotation) form **one ranked list**,
sorted by

```
TPP = (alg_speed(entire path so far, including this step) + pair_choice(cube it leaves))
      / pieces solved by that path
```

Lower is better. TPP is scored over the whole path, so a longer but smoother
step can outrank a short awkward one, and a Cross and an XXCross are directly
comparable. Results are never grouped by type.

`alg_speed` estimates how fast a human executes a move sequence. It is
based on Triangium's **MCC** hand-movement model, with these rules:

- **Every action costs time**: face turns, wide moves, slices and every
  rotation, including `x` (untuned MCC treated `x` as free).
- A rotation that **starts** a step pays no penalty (inspection, or done
  while looking ahead between steps); `y2` is only allowed there. **A first
  step never rotates inside its alg**: its only rotation is the inspection
  (professionals' habit; wide moves and side-cross inspections stay). At a later
  step the naturalness model still scores it like any move (professionals
  rotate mid-step, after an AUF, about as often as at the start; with the
  rotation free, the top results rotated at the start far more often).
  A first step's inspection is not part of its alg.
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

**Tuning data: professional solves.** Every ranking weight (`alg_speed`
and `pair_choice`) is fitted on professional solves: the step a
professional actually executed should rank near the top of what the app
lists for the same goal, i.e. the complete search's best 300 for that step
(every spelling, the same pair-choice term), and the app's top result should
use each kind of move (wide, `D`, `F`, `B`, `L`, half turns, mid-step and
leading rotations; turn count) about as often as the professionals do. The
loss is the mean log rank of the professional's step plus 0.1 x a
chi-square-like distance between those move-type frequencies (first and
later steps separately). The data is
[reco_solves.txt](data/reco_solves.txt): reconstructions of real solves from
[reco.nz](https://reco.nz) (currently Yiheng Wang and Xuanyi Geng, ~930
solves, ~3,600 steps; `tools/reco.js` downloads and validates them), plus
[pro_references.txt](data/pro_references.txt). Fitting and validation use
`tools/tune-alg-speed.js` (`cpools` builds the lists, `fit`, `eval`): fitted
on 300 reco.nz solves of both solvers, kept only if it also improves solves
the fit never saw (cross-validation by solve; the reference solves). The
language model is never evaluated on a solve it was trained on. Current
function: 94% of the professionals' later steps and 28% of their first
steps rank in the top 10 of the app's list for their goal (91% and 21%
before this tuning), the reference solves 86% (first steps 58%). Most of
the professional steps outside the top 10 (74%) are longer than the app's
best: what a solver finds while planning, not what is fastest to execute. A professional
sometimes executes a slower step than the best available, so the target is
where pro steps rank overall, not every pro step on top.

### Pair choice

Which pair to solve next matters beyond the step itself: a fast step that
leaves the remaining pairs trapped can lose to a slower one that leaves a
free pair. The look-ahead computes this; `pair_choice` gives the
single-step ranking the same **intuition**, the way a solver picks a pair
without working out the next one. It is learned, not a hand-written rule:

- **What it sees** is what a solver sees during look-ahead, of the pairs
  still unsolved after the step: corners stuck in a bottom slot, edges stuck
  in a middle slot, lone pieces already home, pairs with both pieces in the
  top layer, and pairs already connected there. Each count has a weight.
- **What it is trained on**: first on random-state solves, where at every
  step the candidates (the best few of each pair choice) are labelled with
  their 2-step look-ahead TPP from a real search of the next step. The
  weights minimise the expected look-ahead TPP of the candidate the
  single-step ranking puts first (`tools/pair-choice.js`); the look-ahead's
  TPPs are only the training signal. It cannot be exact (the next step
  depends on more than a solver sees at a glance); it learns the
  heuristics. Then, like `alg_speed`, refined on professional solves (see
  Tuning data).
- It is added once, for the cube the path leaves (not per step), and is 0
  once F2L is solved, so the cost of a complete solution is unchanged. Like
  the rest of `alg_speed`, it is the same at every step.

Learned weights (time units, per counted pair or piece; pair planning off,
see below for on): connected pair −5.7, both pieces in the top layer −1.4,
edge stuck +0.78, corner stuck +0.54, lone piece home +0.45. (Refining these
on professional solves gained too little to keep: the reference solves
ranked worse.) On held-out scrambles the candidate ranked
first is on average 26% closer to the look-ahead's best (first steps 33%,
later steps 15%). Checked on professional solves it never saw: their
executed steps rank higher among same-goal alternatives, and at later
steps their pair choice ranks first more often (61% → 65% of Xuanyi
Geng's); at first steps less often (20% → 15%), where the look-ahead
prefers first steps that are hard to plan in inspection. Which slots
are solved (e.g. "back slots first") was offered to the fit as well and
did not generalise: a step may start with a free `y`, so the solved slots'
position hardly predicts the next step's cost.

### Pair planning

Picking the best step at every step is not the best solve: two front slots
first leave the back slots (and their pieces) out of view, and a pair
solved with a rotation can leave every remaining edge needing another.
Experienced solvers plan with **edge orientation (EO)**: with the cross on
the bottom, an unsolved pair's edge is *good* when it inserts with `R`, `U`
and `L` turns alone (in the U layer: its top sticker has the front or back
centre's colour; in a middle slot: its sticker facing front or back does)
and *bad* otherwise. A `y` turns every U-layer edge good↔bad and leaves
middle-layer edges alone, so solving the good edges first and then
rotating once (or rotating once when all are bad) leaves the rest
rotationless.

`pair_choice` therefore also sees, of the unsolved pairs and **in the
orientation the step leaves the cube in** (so two spellings of a step that
end rotated differently score differently): bad and good U-layer edges,
bad middle-layer edges, and open back slots. Like the look features it is
learned, not a rule: its weights are fitted together with them on the same
2-step look-ahead outcomes, and kept only because they rank the look-ahead's
best candidate first more often on scrambles the fit never saw.

Learned weights (time units per edge or slot): bad U edge +0.60, good U
edge −1.59, bad middle edge +0.78, open back slot +2.54 (+0.54 from the
look-ahead fit; refined on professional solves, who leave the back slots
solved and the open ones in front much more than the look-ahead asks).
The look weights with planning on: connected −5.58, both in U −1.40,
trapped corner +0.40, trapped edge −0.80 (+0.20 before the refinement),
lone piece home +0.24. Held out (look-ahead fit), the candidate ranked
first is closer to the look-ahead's best (regret 0.222 → 0.211; first
steps 0.398 → 0.377, later steps 0.143 → 0.136), and in solves that commit
the top result at every step, solves rotate less and solve the two front
slots first less often (`tools/continuity.js`; numbers in
PROJECT_STATUS.md).

**Pair planning** is a results-page setting, on by default. Off, steps are
ranked by their own speed plus the look features (`PAIR_CHOICE_LOOK`), for
solvers who want the plain solution of each pair, not a plan.

## What the DAG edges mean

A **distance-1** step starts from the unsolved node (the first step).

- **Cross**: the cross only.
- **XCross / XXCross / XXXCross**: the cross plus exactly 1 / 2 / 3 pairs in
  one first step. **XXXXCross is not offered.**
- **Single pair**: a later step that solves one pair.
- **Multislot**: a later step that solves several pairs at once. Always
  searched; a results-page filter (default hidden) shows them.

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

## Complete search

The search finds **exactly the best N results of every step type, among
every solution within its move limit, in every spelling** (rotations and
wide moves included). No solution is lost to a per-call cap or to the order
an engine happens to list solutions in; the speed-ups below are exact.

1. **Every face-turn solution.** For each DAG edge the engine lists every
   face-turn solution of its goal up to the move limit (the 18 face turns;
   `U` turns may position pieces even when they move no goal piece, `R' U R'`
   instead of `R2`). The limit counts turns: a wide turn is one turn, a
   rotation none.
2. **Every spelling.** A human may write each solution in many ways, and
   every one is considered:
   - a free **leading rotation**: the inspection rotation at the first step
     (any orientation, so the cross may start on a side or on top and be
     brought down by a wide turn, e.g. `x' y2 | l' U r ...`); `y`, `y'` or
     `y2` at a later step;
   - at most **one mid-step rotation**, `y`, `y'`, `x` or `x'` (never `y2`),
     anywhere in a later step; **never in a first step** (wide moves only);
   - any turn as a **wide turn** (`r` `l`, and at most three of `u` `d`
     `f`; **never a wide `b`**), e.g. `D y R U' R'` as `u R U' R'`,
     `B U' B'` as `f R' f'`, `L x` as `r`;
   - a half turn as one plain and one wide quarter turn (`U2` + `y` as
     `d' U'`), or (later steps) as two quarter turns around the mid-step
     rotation (`U y' U R' U' R`);
   - the cross always ends on the bottom;
   - never more turns than the solution has: spellings whose turns cancel
     (`L' l r` for `R`) are not generated.
   Every spelling of a solution is physically "that solution, then a
   y-family rotation", so it solves the same pieces; the slots it reaches
   are read off the physical result.
3. **The best N, exactly.** Scoring every spelling would take far too long
   (hundreds of spellings per solution, up to hundreds of thousands of
   solutions per edge), so the ranking is a branch and bound that skips only
   spellings provably outside the top N: each move adds at least its
   penalties, its naturalness surprise and MCC's smallest time for that
   move, and a bound over the moves still to write decides when a solution
   or a partial spelling cannot reach the top N. Everything that can is
   scored with the real `alg_speed`. Tests compare it with brute force.

The best N are kept for each step type (cross, xcross, ..., single pair,
multislot) and for each combination of the instant filters (wide moves,
hide awkward), so a filter never empties the list.

**Corpus candidates** (later steps) are scored as well: the standard F2L
algorithms and every professional step in the tuning data, mirrored, each
after a free `y`-family rotation and an optional `U` turn, written as the
professionals wrote them (they may rotate twice). Pseudo steps keep the
capped engine search (10,000 solutions per call) with wide spellings only.

| Step type | Move limit | Results kept (N) |
|---|---|---|
| Cross | 9 | 300 |
| XCross | 10 | 300 |
| XXCross | 10 | 300 |
| XXXCross | 11 | 300 |
| Single pair (later step) | 10 | 300 |
| Multislot (later step) | 12 | 300 |

These cover most of what professionals execute: of the reco.nz steps in
the tuning data, 89.7% of later steps and 60% of first steps are in the
complete search exactly as the professional wrote them (within the limit,
in a spelling above; `tools/complete-coverage.js`). A single-pair limit of
11 raises that to 92.8% but lists about five times as many solutions. A
later goal with no solution within its limit is searched up to 3 turns
deeper (its shortest solutions).
The configuration page's per-type limits override both columns
("max solutions" is N, "move depth" the limit); blank keeps the default. A
Single pair or Multislot override applies to every later step of that kind.

**Performance** comes after completeness. The engine calls are face turns
only and mostly quick (a later step's multislot call, the slow one, is
split by its first move, so engine workers share it and other searches can
run between its parts); ranking the spellings runs on a worker pool, big
edges split across workers. Measured times are in PROJECT_STATUS.md; the
goal stays one step in **under 1 minute** with every option on, and about
**10 seconds per step** with the default settings, so a solver hardly
waits.

Results-page filters, set per step. They only hide: every search includes
multislot, wide-move and awkward results, so changing a filter either way
is instant and never searches again; the look-ahead follows them.

- **Multislot** (default off): ticked, later steps that solve several pairs
  at once are shown. Their engine search (two pairs, up to 12 turns) is a
  later step's slowest part, so while they are hidden the status line says
  as soon as the rows shown are final, and the multislot search goes on
  behind them; clicking a row then stops it (a step left behind is searched
  again in full if it is ever shown again).
- **Wide moves** (default on): unticked, no result uses a wide or slice
  move.
- **Hide awkward F2L solutions** (default off): hides later steps that
  turn the `R` (or `L`) layer two quarter turns away from where the step
  started. `R` = +1, `R'` = −1; an `R2` at 0 reaches ±2 (awkward), at ±1 it
  goes to ∓1 (fine), so `R U R2 U' R` is fine and `R U R U' R'` is not. `r`
  counts as `R`, `l` as `L`; a `y`/`z` (also inside `u d f b`) resets both
  counts. **First steps are never hidden**: crosses are often awkward by
  nature, unlike F2L's set algorithms.

## Professional solves and coverage

[pro_references.txt](data/pro_references.txt) holds benchmark solves. **The
solver must be able to find these exact solutions in its search tree,
whatever their rank** (`test/pro-references-e2e.js`). Professional step
boundaries that do not land on a DAG node are merged (e.g. "xcross + 2nd
pair" as one XXCross). Including **rotation choices during the search is a
mandatory requirement**: professionals favour "spammable" `R`/`U` solutions
with rotations because they ease look-ahead.

Known gaps (measurements in PROJECT_STATUS.md): first steps that rotate
inside the alg (excluded on purpose, 12% of the reco.nz first steps);
more than one mid-step rotation (only corpus candidates have them); slice-like combinations beyond
`r`/`l`; goal-no-op moves other than `U` turns (pruned by the engine); and
steps longer than the move limits.

## Configuration and results pages

The **configuration page** holds the search settings (colours, first-step
types, pseudo F2L, per-type limits) and the scramble list. Generated scrambles are random-state (a uniformly random
state solved with a two-phase search and inverted, as WCA scramblers do).

The **results page** holds the per-step settings in labelled groups: filter
(multislot, wide moves, hide awkward F2L solutions, simple pseudo only),
ranking (pair planning), look-ahead (depth, breadth), and results per
page. Every setting applies to later steps until changed; a look-ahead or
ranking setting re-searches the current step (reusing what it can), a
filter only hides, and the status line says how many.

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
