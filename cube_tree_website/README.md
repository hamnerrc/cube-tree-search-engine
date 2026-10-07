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
*following* steps' best options — can surface a step that looks slightly
worse in isolation but opens up a much better continuation. It is an
optional setting, **not** the core interaction model: single-step search of
the current node is the baseline behavior (see
[Look-ahead optimisation depth](#look-ahead-optimisation-depth)).

### Look-ahead optimisation depth

A control on the **results page** optimises results for the best combined
next *N* steps, for N = 2, 3, 4 or 5 (default: off, i.e. 1 step). It is set
**per step**: it applies to the step on screen and stays as chosen until
changed, so e.g. look-ahead can be on while choosing the cross and turned off
for the later pairs. Changing it re-searches the current step, reusing its
single-step search.

1. Search step *n* as usual and rank it by TPP.
2. For each of the top results of step *n* (the **look-ahead breadth**,
   default 5), commit it tentatively and search step *n+1*; repeat down to
   step *n+N-1*. Below the first look-ahead level only the best 2
   continuations of each searched step are followed further, which keeps
   depth 5 finite.
3. Re-rank those top step-*n* results by the **combined TPP** of the best
   look-ahead sequence starting with each — since TPP is cumulative over the
   whole path, that is simply the TPP after the sequence's last step. The
   remaining results keep their single-step order below them. A sequence that
   completes Cross + F2L early stops there; one with no continuation at all
   sinks to the bottom of the re-ranked block.

Each re-ranked result shows its combined TPP and the follow-up steps of its
best sequence. The single-step ranking is shown first, as soon as it is
available; the top block then re-ranks on screen as each candidate's
look-ahead finishes (candidates still being looked at show "…"). The
candidates are looked at best-first: the follow-up searches of a
better-ranked candidate run before those of the next one, so the top of the
list settles first. Only the clicked step is committed — the follow-ups are a
preview, and the next search starts from the committed node as usual (reusing
the look-ahead's searches where it can).

> Look-ahead multiplies the searching per step: depth 2 adds one search per
> re-ranked result, and **depths of 3 or more cause significant performance
> delays** (tens of seconds per step with the pro move set, up to minutes
> with multislot or pseudo F2L on, whose multi-pair searches are the
> expensive ones). The results page marks depths of 3 or more as slow.

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

**Every action has a cost.** Every move — face turn, wide move, slice, and
every whole-cube rotation including `x`/`x'`/`x2` — adds time. (Untuned MCC
modelled `x` as a free wrist shift; cube⑂tree charges it like `y`/`z`.)

**Rotation cost:** a whole-cube rotation generally counts toward `alg_speed`
like any other move, *except* a pure inspection rotation on a distance-1
result (see below) — those are free, since a human absorbs them during
inspection rather than mid-solve. `y2` specifically is forbidden as a
mid-algorithm move; it may only appear as a distance-1 inspection rotation.

**Tuning.** `alg_speed` is MCC with these adjustments, the same at every
step of the solve:

1. Finger pushes on `U`/`D` turns (MCC's `pushMult`) cost 0.8 instead of 1.3.
2. Each step pays a small extra cost for the moves professionals use less
   than MCC's hand model predicts: `D` +1.06, `F` +0.86, `B` +2.22, wide
   `r`/`l` +2.35, `u`/`d`/`f` +2.5, slices `M`/`E`/`S` +3.31, and a `y`
   rotation in the middle of a step +3.70 (a rotation that *starts* a step
   is free: it happens while looking ahead between steps).
3. Every turn (face, wide or slice; not rotations) costs +0.5 on top of
   MCC. This one comes from the developer's own pairwise speed judgements
   (below): MCC alone underrated how much each extra turn slows a step.

These are penalties only, so no move ever costs less than MCC says. A
path's time is MCC of the whole path plus the penalty of each of its steps.

Items 1 and 2 were fitted to the
[professional reference solves](#professional-reference-solves-and-known-gaps)
by where each professional step would rank in the app's own result list
(`tools/pro-ranking.js --app`), with leave-one-solve-out cross-validation
(fit on all solves but one, rank the held-out one) and confirmed on solves
the fit never saw. Item 3 was fitted to the pairwise comparisons with
cross-validation and a prior that keeps every value close to the previous
one unless the data clearly says otherwise; fitting all the constants at
once to the first ~80 answers was rejected as overfitting. The
professional benchmark is now the secondary check: the per-turn cost was
set to the lowest value that keeps nearly all of what the comparisons
show (0.5; the fit alone suggested 0.56-0.99), because higher values rank
the professionals' steps lower. Professionals sometimes execute a slower
step than the best available, and such a step should rank lower; the
tuning targets where pro steps rank overall, not every single step at the
top. Further tuning should go through the same tools
(`tools/fit-alg-speed.js`, `tools/pro-ranking.js`) rather than hand-picked
constants.

### One scoring algorithm for every step

**This is arguably the most important part of the whole website.** Sorting
results by how fast they are to *execute* is what sets cube⑂tree apart from
other solvers, which sort by move count; the ranking is only as trustworthy
as the scoring behind it, and a scoring rule that changes from step to step
makes TPPs harder to compare and to trust.

`alg_speed` is **the exact same algorithm regardless of the step**: the same
move costs and the same penalties for the cross, an xcross from inspection,
a later pair or a multislot, with nothing tuned per step. (Until the first
pairwise comparisons the first step had its own values for wide moves, a
stop-gap for too little professional data; they were removed, which barely
changed where the professional steps rank.) As more comparisons come in,
the model is refitted with `tools/fit-alg-speed.js` and changed only when
it orders held-out comparisons better than the current one.

### Planned: training `alg_speed` on pairwise speed comparisons

Nineteen professional solves are too little data to calibrate `alg_speed`,
and a professional's choice says which step they *picked*, not which of two
steps is faster to execute. The planned source of speed data is therefore
**direct human judgement**: a terminal tool shows two algorithms that the
current `alg_speed` scores as close, the developer executes both and picks
the faster one (or calls them even), and the answers become the training
and validation data for the single step-independent model above.

- **Human in the loop.** The developer makes the comparisons by hand,
  aiming for a few thousand comparison data points over about a week of
  testing.
- **Transitive inference.** Answers are combined: if A is faster than B
  and B faster than C, then A is faster than C. A few hundred manual
  answers therefore yield far more derived comparisons. Contradictions
  (A > B > C > A) are detected and shown again for a fresh judgement rather
  than silently kept.
- **Choosing pairs.** The tool does not pick pairs at random. It asks first
  about the comparisons whose answer matters most: pairs the current model
  scores as nearly equal or is least sure about, pairs that would decide
  the order near the top of real result lists (where a wrong order changes
  what the user sees first), pairs that exercise moves the model has little
  data on (`D`, `F`, `B`, wide moves, slices, rotations), and never
  pairs whose answer already follows from earlier answers. It never shows
an algorithm with a wide `b` (see [Wide moves](#wide-moves-and-cross-optimisation)).
- **What it replaces.** The fitted model is judged on how many held-out
  human comparisons it orders correctly. The professional reference solves
  stay the search-coverage requirement (the solver must still find them)
  and become a secondary ranking check instead of the fitting target.

The tool exists: `node tools/pair-compare.js` (from `cube_tree_website/`)
asks one pair at a time -- `a` / `b` for the faster one, `=` too close to
call, `s` skip, `u` undo, `c` step context, `q` quit -- and never shows the
model's own scores. `node tools/pair-compare.js stats` reports the counts
(direct and derived), contradictions, self-consistency on repeated pairs and
how often the current `alg_speed` agrees; `export` writes every comparison
for fitting. Candidates come from `data/speed_pool.json` (real result lists
of random scrambles at every stage plus the professional solves' lists,
rebuilt with `pool`); answers are appended to `data/speed_comparisons.jsonl`.
Details are in PROJECT_STATUS.md (roadmap item 7, §4.45). The first fit
(item 3 of "Tuning" above) used the first ~80 answers; `node
tools/fit-alg-speed.js` cross-validates candidate models on the answers so
far, and a new `alg_speed` replaces the current one only if it orders
held-out comparisons better.

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
  Multislotting is a **results-page toggle** (default off), not part of the
  search configuration: it applies to the step on screen (and its
  look-ahead) and stays as set until changed, so it can be off while
  choosing the first pairs and switched on to explore a multislot later in
  the same solve.
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
- **Simple pseudo only** (a results-page filter, shown when pseudo F2L is
  on): once a mismatch has been introduced, the *next* step is limited to
  fixing **only that mismatch** — the results that also solve other pieces
  alongside the repair are hidden (look-ahead follows the same filter).
  Unticked, every relevant corner/edge combination at a mismatched node is
  listed, not just the direct repair. The search itself always covers the
  full pseudo space, so toggling the filter needs no new engine search.

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

### Performance goal

Long-term goal: **worst-case search execution with all settings enabled must
complete in under 1 minute.** "All settings" means every advanced option on
at once (XCross through XXXCross, multislotting, pseudo F2L with full pseudo,
cross optimisation, the pro move set, every cross colour, the deepest
look-ahead), and "search" means one step's search, from clicking a result (or
loading a scramble) to its ranked list. Current measurements, and how far
they are from this goal, are tracked in PROJECT_STATUS.md.

The **search time limit** setting is the guarantee behind this goal. It is
**blank by default, meaning no limit** (as is 0 or anything that is not a
positive number); with a limit set, each step's search (its look-ahead
included) stops when the limit is reached and lists the best results found
so far.
Cheap searches run first, so the limit cuts the expensive tail (pseudo,
XXXCross, long pro-move-set searches), not the common results. The status
line says when the limit cut a search short. Making the searches themselves
faster, so the limit cuts less, is the ongoing work.

### Granular search configuration

The table above and the single `maxSolutions` value are the *defaults*. Each
row of the table — Cross, XCross, XXCross, XXXCross, Single pair, Multislot
— can be given its own `maxSolutions`/move-depth override, independently for
the matched and pseudo variant of that same category (e.g. a tighter depth
for plain XCross than for pseudo XCross, or a larger `maxSolutions` just for
Multislot). An override on Single pair or Multislot replaces the whole
step's depth for every later occurrence of that category, regardless of how
many pairs are already committed — the per-total-pairs nuance behind the
default table (see PROJECT_STATUS §4.8) is an internal tuning detail, not
something this override is meant to re-expose. Leaving a field blank keeps
the corresponding default.

## Procedural inspection rotations

A single null-rotation (no pre-rotation) search at distance-1 is enough to
derive every equivalent rotated variant of a Cross/XCross/XXCross/XXXCross
result — rotated variants are **not** independently re-searched. For example,
a Cross solution of `F` mechanically produces the equivalent rotated
variants `y L`, `y2 B`, and `y' R`: these should all be considered valid solutions
since some may be faster to execute. For instance, doing a `y'` in inspection
that doesn't count for the speed score, followed by a `R` for the cross is
much faster than the F move cross from the original orientation. Rotation
variants that lead to genuinely different follow-up paths
(because they leave the cube in a different orientation for the next step)
remain distinct results, since the choice of rotation is itself part of the committed path.

## Wide moves and Cross optimisation

**No wide `B`.** A wide back turn (`b`, `b'`, `b2`) never appears in a
solution, at any step, whatever produced it (cross optimisation, an
inspection rotation relabelling the engine's `r`/`l`, or a wide spelling).
Such candidates are dropped before ranking.

Outside the pro move set's `r`/`l` (see [Move set](#move-set)), wide moves
(`r`, `r'`, `l`, `l'`, `u`, `u'`, …) are not searched directly: they come
from rewriting found solutions — Cross optimisation for the first step, and
wide-move spellings for later steps (below). Cross
optimisation (always on; it has no checkbox) applies a **post-hoc,
first-step-only** transformation to ordinary Cross results:

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

### Wide-move spellings of F2L steps

After the first step, every result is also offered in its wide-move
spellings. A `D` turn can be done as a wide `u` (the same pieces move, and
the cube turns with it: `D` = `u y'`), a `U` as a wide `d`, and a `B` or `F`
as a wide `f` (never a wide `b`); the rest of the step is relabelled for the new
orientation. This can save a rotation or replace awkward turns:

- `D y R U' R'` (a `D` setup, then a rotation) is `u R U' R'`;
- `U y' L' U L` is `d L' U L`;
- `y R U' R'` is `B U' B'`, which is `f R' f'` — the fastest of the three.

The cross must stay on the bottom, so the step may end in a different `y`
orientation but never a sideways one (an `f` comes with an `f'`). Only
spellings that turn out easier are kept: fewer `D`/`F`/`B` turns and
rotations than the original, no extra `F`/`B` turns, at most two wide turns
and only one kind of them (mixed `d`…`f` spellings never ranked well). They
apply to pseudo pairs too (the `D` turn that aligns a pseudo pair can be a
`u`). The first step is left to cross optimisation, the engine's `r`/`l` and
side-cross inspections: these spellings doubled its candidates.

**Wide moves** (a results-page checkbox, default on): unticked, no result at
any step uses a wide move (`r l u d f`) or a slice — the engine searches
without `r`/`l` and no wide spelling is made. Unticking it on a step already
searched with wide moves just hides them (nothing is searched again, and
ticking it again shows them at once). Ticking it on a step that was searched
without them searches the wide moves and adds them to the list on screen as
they are found, without clearing it.

## Move set

Ordinary search uses the 18 standard face turns (`U U' U2 D D' D2 R R' R2
L L' L2 F F' F2 B B' B2`) plus whole-cube rotations where relevant. By
default, slice moves and wide moves are not part of the search move set —
wide moves come from the post-hoc rewrites described above (Cross
optimisation and wide-move spellings).

The **pro move set** (always on; it has no checkbox) widens the search to
the move subsets professionals actually use: wide `r`/`l` and at most one
mid-step `y`, `y'`, `x` or `x'` rotation (never `y2`), with the cross still
required to finish on the bottom, plus rotated spellings and side-cross
inspections (below). It is slower, and it applies to matched (non-pseudo)
searches. In every mode, `U`-layer turns may be used to position other
pieces even when they move no goal piece (e.g. `R' U R'` instead of `R2`).

**Unorthodox steps** (a results-page filter, "hide unorthodox", default
off): for an orthodox F2L step, the `R` layer never gets more than one
quarter turn away from where the step started. Its displacement starts at 0;
`R` is +1 and `R'` is −1, and the step is unorthodox as soon as the
displacement reaches +2 or −2: in `R (1) U R (2!) U' R' (1) U' R2 (−1) U
R (0)` the second `R` makes the step unorthodox. Whether an `R2`
disqualifies a step depends on the displacement when it is executed: at 0
it must take the layer to ±2, so the step is unorthodox; at +1 it can be
executed as `R2'` (−2, to −1), and at −1 as `R2` (+2, to +1), so `R (1) U
(1) R2 (−1) U' (−1) R (0)` is orthodox. `L` is counted the same way, `r`
counts as `R` and `l` as `L`, and a `y` or `z` rotation (also inside `u d f
b`) starts both counts again. Ticked, unorthodox later steps are hidden,
also in the look-ahead; **first steps are never hidden**. It only filters,
so it needs no new search. (It replaces an earlier "no `R2`/`L2` after step
1" option, which removed half turns from later searches outright, including
the orthodox ones.)

## Professional reference solves and known gaps

[pro_references.txt](data/pro_references.txt) contains benchmark solves from
professional cubers. **The solver must be capable of processing these
scrambles and finding the exact same solutions within its search tree,
regardless of how the current scoring algorithm ranks them.** They are the
validation set for search coverage: `test/pro-references.test.js` checks the
reference data itself, and `test/pro-references-e2e.js` measures, for every
step, whether the professional's exact algorithm is in the search tree.
They are also the current ranking benchmark: `tools/pro-ranking.js`
measures where each professional step ranks among the engine's alternatives
under `alg_speed` (planned to become a secondary check once `alg_speed` is
trained on pairwise comparisons; see "Planned: training `alg_speed` on
pairwise speed comparisons"). Reference entries may omit the inspection line (no rotation)
and may combine pairs into one step (e.g. `// 3rd/4th pairs`).

Professional step boundaries do not always land on a DAG node (a cross edge
is sometimes parked in a side layer until the next step), so the reference
solves are compared at DAG-transition granularity: such steps count as one
transition (e.g. "xcross + 2nd pair" as one XXCross).

**Known gaps** (what still keeps some reference solutions out of the
search; current measurements are in PROJECT_STATUS.md):

- **Move subsets.** Professionals rely on wide moves (`r`, `l`) and slice-like
  combinations (`l L'`) inside steps, not only in the cross. The default
  search does not use them; the pro move set covers `r`/`l`.
- **Rotations chosen during search.** Professionals rotate mid-solve
  (`y' R U R' …`) and even mid-step (`U R' U' R y U' R U R'`), favouring
  "spammable" `R`/`U`-heavy solutions that ease lookahead. Including rotation
  choices in solution finding is a **mandatory requirement**; the pro move set
  does this for one rotation per step. Because the engine often returns the
  equivalent un-rotated spelling (`U' B U B'` for `y U' R U R'`), every
  result is also offered in its rotated spellings, which `alg_speed` then
  ranks like any other result.
- **Inspection orientations off the cross colour.** Some professionals inspect
  with the cross on a side (e.g. `x'`) and bring it to the bottom with a wide
  move during the XCross. The engine's goal is tied to the colour on the
  bottom at the start, so with the pro move set these are produced by
  rewriting cross-on-bottom solutions: an early `L`/`R` turn becomes a wide
  move and its leftover rotation is absorbed into the free inspection
  rotation. Combinations with a mid-step `x` are not generated yet.
- **Moves that do not touch any goal piece.** Professionals use moves like the
  `U` in `… R' U R'` (instead of `R2`) to position other pieces. The vendored
  engine pruned any solution containing a move that leaves every goal piece
  in place; it is patched to allow such `U`-layer turns (see
  THIRD_PARTY_NOTICES.md), but other moves that leave every goal piece in
  place are still pruned.
- **Step length.** Some professional steps exceed the search limits above
  (e.g. a 15-move XCross against the 11-move limit).
- **Solutions per search.** Even when a professional solution is in the
  search tree, it can be one of thousands of equally long solutions; with
  a small per-search solution cap it is never generated, so it never
  reaches the ranking.

## Configuration and results pages

The configuration page holds the search settings (colours, which first-step
types to search (xcross, xxcross, xxxcross), pseudo F2L, solutions per
search, the time limit, per-type limits) and the scramble list. The pro move set and cross optimisation are always on.
The interface is lowercase and minimal, except move notation, which keeps
its case (`R2` is not the wide `r2`): options carry no inline explanations;
hovering an option or a column title shows a one-line hint, and an info icon
next to the logo opens a short description of every option, on both pages.
Both pages work on phones, tablets and desktops.

The results page holds the per-step settings, in labelled groups: search
(multislot, wide moves), filter (hide unorthodox,
simple pseudo only), look-ahead (depth and breadth), and how many results to
show per page. Changing a search setting re-searches the current step
(reusing what it can) and applies to every later step until changed; a
filter only hides results, and the status line says how many it hid.

### Planned: visual redesign

The current look (dark, monospace, lowercase, minimal) is a functional
placeholder and still reads as a default "AI-generated" site. A complete
visual and layout redesign is planned, to make the site polished and
appealing to cubers. The work is divided:

- **Design phase (the developer):** the visuals and layout are designed
  entirely by the human developer -- typography, colour, spacing, page
  structure, the results table, controls and phone layouts.
- **Implementation phase (the AI agent):** the agent codes the developer's
  design specification into the existing pages and integrates it without
  changing what the pages do. It does not invent visual direction of its
  own; anything the specification leaves open goes back to the developer.

The behaviour described in this README (settings, filters, progressive
results, undo, persistence) stays the same through the redesign.

## Results table

Results appear **progressively**: the first results are listed as soon as
the first solver calls finish, and the ranking updates on screen as the
remaining calls (and any look-ahead) complete. The final list is the same as
if it had been shown only at the end.

The table shows **25 results per page** by default; a "show" box changes the
page size and controls below the table move between pages. No column is ever
clipped: long algorithms wrap, and on narrow screens each result becomes a
labelled card.

At minimum, a results table shows:

| rank | colour | type | rotation | edges | corners | alg | TPP | look-ahead |
|---|---|---|---|---|---|---|---|---|

- **colour** — which cross color this result targets.
- **type** — Cross / XCross / XXCross / XXXCross / multislot / single-pair,
  per the edge the result represents, noting whether it's a pseudo (mismatched)
  pair rather than a true matched one.
- **rotation** — for distance-1 results, the pre-solve inspection
  rotation/color-orientation that brings the chosen color to the bottom.
- **edges** / **corners** — which F2L slots this step solves.
- **alg** — the move sequence.
- **TPP** — the path's time per piece including this step.
- **look-ahead** — with look-ahead on, the combined TPP of the best sequence
  starting with this result, and that sequence's follow-up steps.

Each row is a distinct solution: two rows never show the same inspection
rotation and alg (the same moves from the same cube), whichever DAG edge or
search setting produced them; the better-ranked copy is kept.

Clicking a result appends its moves to the current committed path and
triggers a fresh search from the resulting node. Multiple scrambles are
solved completely independently of one another, each with its own result
table — results are never merged or compared across different scrambles.

The solution so far is shown above the results one step per line, labelled
the way the professional reference solves are (`z y // inspection`,
`… // xcross`, `… // 2nd pair`, `… // 3rd/4th pairs` for a multislot). It
can be copied as text (scramble first) or **exported to
[Cubedb](https://cubedb.net)**: a link opens the scramble and the labelled
solution there for playback. Cubedb keeps the whole solve in the link
itself (spaces as `_`, primes as `-`, the rest URL-encoded), in the same
format as the example link at the end of
[pro_references.txt](data/pro_references.txt).

Generated scrambles are random-state (a uniformly random cube state, solved
with a two-phase search and inverted), the same approach WCA scramble
programs use.

## Multi-scramble queueing, undo, and persistence

- **Asynchronous background searching.** Every scramble's search starts as
  soon as the scramble list loads, not only when it becomes the one on
  screen. Switching to a scramble whose search is still running does not
  restart it; switching to one that already finished shows its results
  instantly. A small status indicator next to the scramble shows whether its
  current step is still searching, ready, or failed. Because the underlying
  solver can only run one search at a time, scrambles are still searched one
  at a time behind the scenes — "background" means *you* never have to wait
  idle for it, not that every scramble searches in true parallel.
- **Your focus comes first.** The scramble on screen always outranks the
  background: when you commit a result, that scramble's next search jumps to
  the front of the queue and starts at once; a background search that is
  running pauses at its next solver call (only the call already in flight
  finishes first) and resumes when the active search is done. Switching to
  another scramble moves that scramble's search to the front and sends the
  one you left back to the background.
- **Undo.** Each committed step can be undone, one at a time, back to the
  unsolved start. Undoing does not just erase the step — it re-runs the
  search at the node you've stepped back to, so every other option at that
  point (including ones you didn't pick the first time) is available again.
  This is the mechanism for exploring a different branch of the search tree,
  not a separate branching-history view.
- **State persistence on reload.** Every committed step, for every scramble
  in the current list, is saved as it happens. Reloading the page (by
  accident or on purpose) restores exactly where you left off — the same
  scramble active, the same steps committed, each scramble's own progress
  intact — rather than starting over. Starting a new search from the config
  page (a new scramble list, or different colors/advanced options) does not
  carry old progress forward; it's tied to the exact search configuration it
  was made under.

## Out of scope (for now)

- Full Last Layer solving.
- EO-aware solving beyond what the F2L DAG already captures.
- Automatic batch ranking across multiple scrambles at once.
- Swapping in a fully fitted `alg_speed` model (see Provenance); only the
  validated adjustments above are applied. More of `alg_speed` is refitted
  as the pairwise speed comparisons grow (see "One scoring algorithm for
  every step" and "Planned: training `alg_speed` on pairwise speed
  comparisons").
- XXXXCross as a primary, directly-offered target.
- Cross finishing anywhere other than the bottom face.

## Provenance & licensing

cube⑂tree is licensed under the **GNU General Public License v3.0** — see
[LICENSE](../LICENSE). GPL-3.0 is required (and is the simplest compliant
choice) because the solver engines are GPL-3.0; the MIT-licensed `alg_speed`
model is GPL-compatible and keeps its notice. Third-party notices, and the
record of changes made to the vendored engine code, are in
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

- The core solver engines — F2L Lite, Pseudo F2L Lite, and Pairing, plus
  related solver infrastructure (prune-table construction, move tables, the
  persistent-solver/worker architecture) — come from
  [or18/RubiksSolverDemo](https://github.com/or18/RubiksSolverDemo) (GPL-3.0).
  Any modifications made here are listed in THIRD_PARTY_NOTICES.md, as
  GPL-3.0 requires. The upstream engine documentation is kept as
  [or18_solver_docs.html](docs/or18_solver_docs.html) for reference.
- `alg_speed` is based on **Triangium's MCC** (move-cost/comfort) model,
  MIT-licensed (Copyright (c) 2021 trangium). cube⑂tree uses the **untuned**
  version of this model with these changes (see Ranking, above): every move
  has a cost, including `x` rotations; `pushMult` is 0.8; and per-step
  penalties for D/F/B turns, wide moves and mid-step rotations (benchmarked
  against the professional reference solves).
- Other utility/glue code (the DAG generator, UI, scoring plumbing) was
  originally written with AI assistance.
