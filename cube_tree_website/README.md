# cube⑂tree

cube⑂tree is an interactive, browser-based solver for the Cross + F2L portion
of a CFOP-style 3×3 solve. Given a scramble, it helps a human find the
**fastest humanly-executable** path to Cross + F2L — not the shortest
(move-optimal) one.

> **This document is the product specification.** It describes what
> cube⑂tree is *supposed* to do. The current implementation does not yet
> match it in full (for example, pseudo searches are still slow). For what
> actually exists today, what has been verified,
> and the active development roadmap, see
> [PROJECT_STATUS.md](../PROJECT_STATUS.md).

---

## The core idea: a DAG of abstract F2L states

Cross + F2L has 12 relevant pieces: the 4 cross edges and the 4 corner/edge
pairs that fill the remaining four slots (FR, FL, BR, BL). cube⑂tree
pre-computes a **DAG (directed acyclic graph)** of abstract states describing
*which* of those pieces are solved — cross solved or not, which corner slots
are filled, which edge slots are filled — without reference to any specific
scramble. An edge in the DAG represents a legal "solve N more pieces in one
step" transition between two such states.

A full solution is a **path through this DAG**, from the unsolved node to a
node where all 12 pieces are solved. Because each step along the path can
solve more than one piece at a time (an XCross step solves cross + a pair in
one step; a multislot step solves two pairs in one step), a full solution is
normally **2–5 steps**, not 12 individual piece-by-piece moves.

## How solving works

1. The solver searches the DAG edges leading out of the **current node**.
   At the start of a scramble, the current node is the unsolved node.
2. Each result the solver presents corresponds to exactly **one DAG edge** —
   or, more precisely, an equivalence class of concrete algorithms that all
   reach the same successor node. A result is the **next step**, never a
   full completed solution baked in advance.
3. The user picks a result from the ranked list. That edge is committed: the
   cube's state advances by the scramble plus every selected step so far, and
   the solver searches again from the new current node.
4. This repeats until the current node is the fully-solved Cross + F2L node.

Limited look-ahead — pre-evaluating how a given next step affects the
*following* step's best options — is a desirable future enhancement, since it
can surface a step that looks slightly worse in isolation but opens up a much
better continuation. It is explicitly **not** the core interaction model,
though: single-step search of the current node is the baseline behavior, and
pre-searching the top-ranked current-step candidates one level further is the
intended form look-ahead should take when added, rather than a full
multi-step search at every click.

## Orientation

The scramble is always applied in the standard orientation: **white top,
green front**. Cross always finishes on the **bottom** face — solving cross
on a side or top face is out of scope. A result may include a pre-solve
inspection rotation (e.g. starting on yellow, or on a side color) that brings
the chosen cross color to the bottom before the first step's moves begin.

## Ranking: Time Per Piece (TPP)

All results — Cross, XCross, XXCross, multislot, pseudo, every color, every
rotation — are mixed into a **single ranked list**. There is no per-category
grouping; the one sort key is **TPP (Time Per Piece)**:

```
TPP = alg_speed(entire path so far, including this step) / pieces solved by that path
```

Lower TPP is better. Critically, TPP is **not** scored per step in isolation
— it is scored over the *whole path accumulated so far*, including the step
currently being offered as a candidate. Once cross is solved, the TPP shown
for each candidate next step reflects the cost of the complete path taken to
get there, not just the marginal cost of that one step. This is what lets a
longer-but-smoother two-step path legitimately outrank a shorter-but-awkward
one, and is why results are never grouped by type: a plain Cross result and
an XXCross result are directly comparable on the same list.

`alg_speed` is a hand-movement-simulation heuristic (based on Triangium's
MCC) that estimates how physically fast a given move sequence is to execute
— not just how many moves it has. cube⑂tree deliberately optimizes for this
over raw move count, because the goal is the fastest *human* solve, not HTM
optimality.

**Rotation cost:** a whole-cube rotation generally counts toward `alg_speed`
like any other move, *except* a pure inspection rotation on a distance-1
result (see below) — those are free, since a human absorbs them during
inspection rather than mid-solve. `y2` specifically is forbidden as a
mid-algorithm move; it may only appear as a distance-1 inspection rotation.

> `alg_speed`'s constants are intentionally **untuned** for now (see
> [Provenance](#provenance--licensing)) — this is a deliberate, temporary
> choice, not an oversight.

## What the DAG edges mean

A **distance-1** result is one reached directly from the unsolved node — the
very first step of a solve. Everything below is phrased in terms of
distance-1 edges unless noted; the same pair/multislot/pseudo vocabulary
applies again to later steps once cross is already solved.

- **Cross** — solve the cross only (0 pairs).
- **XCross** — a distance-1 edge from the unsolved node directly to a state
  with cross solved plus exactly **one** naturally-paired corner/edge slot.
- **XXCross** — the same, with exactly **two** naturally-paired slots solved
  alongside cross in the one step.
- **XXXCross** — the same, with exactly **three** slots solved alongside
  cross.
- **XXXXCross is deliberately not offered.** Solving all four pairs together
  with cross is considered humanly infeasible to search for usefully in this
  tool. It may be revisited later as an experimental option, but it is not a
  target now.
- **Multislotting** — after a distance-1 step that leaves one or more pairs
  unsolved (anything XXCross or weaker), a later step may solve more than
  one of the remaining pairs at once. For example, after an XCross, the
  remaining two pairs might be solved together as one multislot step.
- **Single pair** — a later step that solves exactly one remaining pair.

Checkboxes in the UI **filter which DAG edges are considered** — they do not
create separate ranking buckets. Turning XXCross off simply removes
XXCross-shaped edges from the candidate pool before TPP ranking runs; it does
not change how a surviving XCross result is scored or where it lands in the
list.

### Pseudo pairs

A corner/edge pair is normally only "solved" when the corner and its
matching edge are both in place **and** correctly aligned with the D-layer
(a genuine, color-matched pair). **Pseudo** states relax this: a pair may be
considered filled even when the corner and edge in that slot don't actually
match colors, or the D-layer alignment is off — common side effects of an
efficient but imperfect insertion.

- **Pseudo F2L off:** only true, D-layer-aligned matched pairs count as
  solved. This is the default, stricter search.
- **Pseudo F2L on:** the solver may traverse states containing
  corner/edge mismatches, since these can be fixed up cheaply later and
  sometimes lead to a faster overall path.
- **Simplified pseudo** (a secondary checkbox, independent of plain pseudo):
  once a mismatch has been introduced, the *next* step is constrained to fix
  **only that mismatch** — it doesn't explore the full combinatorial space of
  what else could be solved alongside the repair. With simplified pseudo
  off, the solver explores every relevant corner/edge combination at a
  mismatched node, not just the direct repair.

A lone solved corner or lone solved edge (with no matching piece placed) is
never offered as a target in its own right — it may appear transiently as a
side effect of reaching some other intended state, but the DAG does not treat
"just a corner" or "just an edge" as a first-class destination.

### Luck filtering

A solver search can accidentally solve more than the DAG edge it was asked
to search for — e.g. an XCross search (cross + 1 pair) that happens to also
leave a second pair solved by luck. Results like this are **discarded**, not
kept as a bonus: a result must solve *exactly* what its DAG edge claims, no
more and no less. The lucky four-pieces-for-the-price-of-three solution still
appears, but as a result of the matching **XXCross** search instead, where it
belongs. This keeps every result unambiguously tied to one DAG edge and
prevents the same underlying algorithm from showing up multiple times under
different labels.

## Search limits

These move-count limits are deliberately generous compared to strict optimal
solving — the goal is to capture longer-but-smoother, more human-executable
solutions, not just the shortest ones:

| Step type | Max moves |
|---|---|
| Cross | 10 |
| XCross | 11 |
| XXCross | 12 |
| Single pair (later step) | 10 |
| Two pairs at once / multislot (later step) | 12 |

`maxSolutions` (how many candidate solutions a single search returns) should
be set as high as practical while the tool stays interactively responsive;
there is no fixed target number yet — see PROJECT_STATUS.md.

## Procedural inspection rotations

A single null-rotation (no pre-rotation) search at distance-1 is enough to
derive every equivalent rotated variant of a Cross/XCross/XXCross/XXXCross
result — rotated variants are **not** independently re-searched. For example,
a Cross solution of `F` mechanically produces the equivalent rotated
variants `y L`, `y2 B`, and `y' R`: the same move sequence up to a whole-cube
rotation is a duplicate and only shown once. Rotation variants that lead to
genuinely different follow-up paths (because they leave the cube in a
different orientation for the next step) remain distinct results, since the
choice of rotation is itself part of the committed path.

## Wide moves and Cross optimisation

Wide moves (`r`, `r'`, `l`, `l'`, `u`, `u'`) are **never searched directly** —
the underlying solvers only search ordinary face turns. Instead, the "Cross
optimisation" checkbox applies a **post-hoc, first-step-only**
transformation to ordinary Cross results:

1. Each face-turn Cross solution is rewritten using the equivalences below,
   tracking cumulative whole-cube rotation state as it goes:
   - `r` = `L` + `x`, `r'` = `L'` + `x'`
   - `l` = `R` + `x'`, `l'` = `R'` + `x`
   - `u` = `D` + `y`, `u'` = `D'` + `y'`
2. Any resulting sequence whose final orientation would leave cross
   somewhere other than the bottom is discarded.
3. Surviving sequences are re-scored with `alg_speed`, which naturally favors
   ones that lean on `R`/`U`/`D`/`L` generators and penalizes `B`/`F` turns
   and hand regrips.

This is specifically a first-step feature: Cross optimisation rewrites
*Cross* results into their wide-move-equivalent forms; it is not a general
wide-move search mode and does not apply to later steps.

## Move set

Ordinary search uses the 18 standard face turns (`U U' U2 D D' D2 R R' R2
L L' L2 F F' F2 B B' B2`) plus whole-cube rotations where relevant. Slice
moves and wide moves are not part of the search move set — wide moves exist
only as the post-hoc Cross-optimisation transform described above.

## Results table

At minimum, a results table shows:

| rank | colour | type | rotation | edges | corners | alg |
|---|---|---|---|---|---|---|

- **colour** — which cross color this result targets.
- **type** — Cross / XCross / XXCross / XXXCross / multislot / single-pair,
  per the edge the result represents, noting whether it's a pseudo (mismatched)
  pair rather than a true matched one.
- **rotation** — for distance-1 results, the pre-solve inspection
  rotation/color-orientation that brings the chosen color to the bottom.
- **edges** / **corners** — which F2L slots this step solves.
- **alg** — the move sequence.

Clicking a result appends its moves to the current committed path and
triggers a fresh search from the resulting node. Multiple scrambles are
solved completely independently of one another, each with its own result
table — results are never merged or compared across different scrambles.

Generated scrambles are random-state (a uniformly random cube state, solved
with a two-phase search and inverted), the same approach WCA scramble
programs use.

## Out of scope (for now)

- Full Last Layer solving.
- EO-aware solving beyond what the F2L DAG already captures.
- Automatic batch ranking across multiple scrambles at once.
- Swapping in the tuned/fitted `alg_speed` model (see Provenance).
- XXXXCross as a primary, directly-offered target.
- Cross finishing anywhere other than the bottom face.

## Provenance & licensing

- The core solver engines — F2L Lite, Pseudo F2L Lite, and Pairing, plus
  related solver infrastructure (prune-table construction, move tables, the
  persistent-solver/worker architecture) — were copied, without
  modification, from [or18/RubiksSolverDemo](https://github.com/or18/RubiksSolverDemo),
  which is licensed under the **GNU General Public License v3.0 (GPL-3.0)**.
  Any distribution of cube⑂tree that includes this solver code needs to
  honor those GPL-3.0 terms; see PROJECT_STATUS.md for the current state of
  license-file housekeeping in this repo.
- `alg_speed` is based on **Triangium's MCC** (move-cost/comfort) model and
  is MIT-licensed. cube⑂tree currently uses the **untuned** version of this
  model deliberately (see Ranking, above) — the fitted/tuned variant is out
  of scope for now.
- Other utility/glue code (the DAG generator, UI, scoring plumbing) was
  originally written with AI assistance.
