# cube⑂tree — Project Status (Working Document)

*Last updated 2026-10-03.*

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

### 1.1 The DAG ([tree_gen.py](cube_tree_website/tree_gen.py))

- Builds a **purely abstract** state graph: each node is `{cross_solved,
  corners solved, edges solved}` (no real facelet/cubie state, no move
  sequences on nodes). Transitions model "solve N pairs, optionally rotate
  first" and encode the mismatch/pseudo-pair rules (`slot_mismatch_count`,
  `is_valid_pair_state`, `is_pure_mismatch_repair`).
- Correctly produces XCross/XXCross/XXXCross and pseudo-pair nodes via BFS,
  then prunes unreachable states. **As of 2026-10-02 this is verified**: 238
  nodes, 2393 edges, acyclic, monotonic, every node's solved-piece labels
  are real slot names, and 4 fully-solved terminal states exist with no
  outgoing edges — see [test_tree_gen.py](cube_tree_website/test_tree_gen.py)
  and §5 roadmap for the two bugs that were found and fixed to get here (a
  wrong output path, and a label-extraction bug that silently zeroed out
  the mismatch-validity filtering and made the DAG unable to reach a
  fully-solved state at all).
- `f2l_nodes_and_edges.json` (consumed by the frontend) and
  [F2L_tree.json](cube_tree_website/F2L_tree.json) (consumed by the two
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

### 1.3 Frontend ([index.html](cube_tree_website/index.html) / [solver.html](cube_tree_website/solver.html) / [script.js](cube_tree_website/script.js))

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

[cross_xcross.js](cube_tree_website/cross_xcross.js) and
[backend_test.js](cube_tree_website/backend_test.js) are standalone CLI
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
| Abstract F2L DAG (unsolved → full Cross+F2L) | **Done, verified.** 238 nodes / 2393 edges, see §1.1. |
| Multi-step click-to-commit interactive loop | **Working, verified in-browser** for matched (non-pseudo) Cross/XCross/XXCross/XXXCross + later single-pair/multislot. See §5 step 3. |
| TPP ranking over the cumulative path | **Working, verified.** See §5 step 3. |
| Luck filtering | **Not built.** See §4.3. |
| Simplified pseudo vs. full pseudo as distinct modes | **DAG only supports simplified pseudo today; pseudo dispatch not wired up at all yet.** See §4.1 and §5 step 3. |
| Procedural (distance-1-only) inspection rotations | **Working, verified** — `altAlgs` now correctly scoped to distance-1 only. See §4.4/§5 step 3. |
| Cross optimisation (wide-move post-processing) | **Not built at all.** See §4.5. |
| Search limits matching the spec's table | **Working, verified** — see §4.6/§4.8 for the one place this needed to extend beyond the spec's literal numbers (later steps scale by total pairs, not a flat per-category number). |
| WASM scramble search (matched + pseudo) | Matched: **integrated and verified end-to-end in the browser.** Pseudo: still solver-only, not wired into the website UI. |

**Bottom line:** the core interactive loop — the thing that was entirely
missing before — now works end-to-end in the actual browser for the
non-pseudo subset of the product, verified against both a Node harness and
a live click-through session with matching results. The remaining gaps are
specific and bounded: luck filtering, pseudo dispatch, simplified-pseudo
DAG support, cross optimisation, multi-scramble verification, and the
Xxxxcross cold-start latency.

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
   Takes a 54-character Kociemba-style facelet string and, via fixed
   bitmasks, returns `[cross, bl, br, fl, fr]` solved flags by comparing
   facelets to their face centers. **This is now directly relevant to luck
   filtering (§4.3)**: discarding a solution that solved more than its DAG
   edge claims requires knowing the *actual* resulting state of all 12
   pieces, not just the subset the solver's own coordinate space tracked.
   Porting this (as JS, operating on whatever facelet format the WASM
   solvers expose, or a simple cube simulator) is close to a prerequisite
   for implementing luck filtering correctly.

4. **Cube-state simulation plumbing — [`try_4/cubestate_encoder.py`](archived_attempts/try_4/cubestate_encoder.py)**
   Partially reusable: wraps the `magiccube` Python library plus a
   face-adjacency graph (`archived_attempts/try_3/data/cube.graphml`) to
   apply a scramble string and read back facelet colors. The one-hot GNN
   encoding is ML-specific and not relevant here, but the "apply scramble →
   get facelet colors" wrapper is a ready-made way to drive
   `CFOPflags`-style verification without writing a cube simulator from
   scratch — same relevance to luck filtering as item 3. Note: as checked
   out, this file's `GRAPHML_PATH` is broken (points at a path one
   directory off from where the file actually lives under `try_3/data/`);
   fix the path or copy the file before reusing.

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

### 4.1 DAG only supports simplified pseudo (answers spec open question #1)

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

### 4.3 No luck filtering exists

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

### 4.5 Cross optimisation / wide-move post-processing does not exist

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
[solver-bridge.js](cube_tree_website/solver-bridge.js), covered by
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
     [test_tree_gen.py](cube_tree_website/test_tree_gen.py) as a regression
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
   [solver-bridge.js](cube_tree_website/solver-bridge.js) (the search/
   scoring/session logic, Node-testable) and
   [solver-ui.js](cube_tree_website/solver-ui.js) (DOM glue for
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
   - [ ] **Luck filtering** (§4.3) — not yet implemented. Candidates are
     shown as returned by the solver with no check for accidental
     over-solving. Next concrete step: probe the slots *not* in a
     candidate's own goal (via a cheap "already solved?" check, same
     technique used throughout §4's empirical tests) and discard results
     where one of those got solved too.
   - [ ] **Pseudo edges are skipped entirely** (`isPseudoState` check just
     `continue`s past them) — `pseudoCrossSolver` dispatch isn't wired up
     yet. Not a regression: with the UI's current default checkboxes
     (pseudo off), this matches intended behavior already; it becomes a
     real gap only once "pseudo F2L" is checked.
   - [ ] **Simplified-pseudo checkbox** doesn't exist in the UI yet, and
     per §4.1 the DAG itself doesn't yet support a "full pseudo" mode to
     distinguish from.
   - [ ] **Cross optimisation** (§4.5) — not implemented.
   - [ ] **Multiple scrambles**: `getOrCreateSession` is keyed per scramble
     index and `onActiveScrambleChanged` is wired to the existing
     scramble-navigation controls, but this has only been exercised with a
     single scramble so far — not yet verified in the browser with 2+
     scrambles and switching between them mid-solve.
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
   - [ ] Port the `Persistent*Solver` struct pattern documented in
     `crossSolver/IMPLEMENTATION_NOTES.md` §"Adding a New Solver" to
     `pseudo.cpp`, so pseudo-pair searches don't rebuild their BFS table on
     every call once multiple scrambles are searched per session. (Blocked
     on having `emcc`/Emscripten available to compile and verify — not
     present in this environment as of 2026-10-02.)

5. **Recyclable-utility follow-ups from §2**
   - [ ] Port `CFOPflags.py`'s facelet-mask logic into a small JS
     verification helper — now motivated specifically by luck filtering
     (§4.3/§2 items 3–4), not just general DAG correctness checking.
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

---

## 6. Provenance & licensing housekeeping

(See README.md's "Provenance & licensing" section for the user-facing
statement; this is the implementation-side follow-up.)

- Confirmed via the upstream GitHub repo: the vendored solver code in
  `crossSolver/` and `pseudoCrossSolver/` originates from
  [or18/RubiksSolverDemo](https://github.com/or18/RubiksSolverDemo), which
  is licensed **GPL-3.0** (confirmed by fetching that repo's actual
  `LICENSE` file, not just inferred).
- **This repo currently has no `LICENSE` file at all.** `crossSolver/README.md`
  itself references a top-level `LICENSE` (`../../../LICENSE`) that doesn't
  exist — another instance of the vendored docs describing the upstream
  project's layout rather than this repo's actual state.
- Adding an actual `LICENSE` file, and deciding how GPL-3.0 obligations
  interact with the rest of this repo (the MIT-licensed `alg_speed` logic,
  the AI-assisted utility code, the archived ML experiments), is a genuine
  decision with consequences and has **not** been made unilaterally here —
  it needs the user's input before any license file is added or any
  redistribution happens.

---

## 7. Open questions carried over from the spec

Per the spec, these four are explicitly implementation-level decisions, not
blocking ambiguities in the spec itself:

1. **DAG nodes for simplified vs. full pseudo** — **answered**, see §4.1.
2. **UI/control mechanism for depth-N look-ahead** — deferred; single-step
   search is the correct default for the §5 step 3 build, per spec.
3. **Performance strategy for first-step wide-move generation** (every
   first-step result vs. top-N only) — not yet decided; defer until
   cross-optimisation (§4.5/§5 step 3) is actually being built and real
   first-step result counts are known.
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
