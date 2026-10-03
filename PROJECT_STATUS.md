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

### 1.3 Frontend ([index.html](cube_tree_website/index.html) / [solver.html](cube_tree_website/solver.html) / [script.js](cube_tree_website/script.js))

- `index.html`: scramble entry + checkboxes for colors and advanced options
  (`xcross`, `xxcross`, `xxxcross`, `multislotting`, `full_pseudo`,
  `cross_opt`). Working UI, persists criteria to `localStorage` and
  navigates to `solver.html`. **Missing per spec:** a "simplified pseudo"
  checkbox, independent of `full_pseudo`, does not exist yet.
- `solver.html`: scramble viewer + empty results table, with no notion of a
  "current DAG node" or a committed path at all. **Nothing in `script.js`
  ever populates `#results-body`, calls either WASM solver, or implements
  the click-to-commit-and-research loop.** The `DOMContentLoaded` handler
  on this page only fetches the graph JSON, prunes it per the checked
  options (`pruneGraph`), and stores the pruned tree in `localStorage` —
  then stops.
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

### 1.4 The only working multi-piece pipeline today is in Node, not the browser

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
| Multi-step click-to-commit interactive loop | **Not built.** See §0 and §5 step 3. |
| TPP ranking over the cumulative path | **Not built.** Only per-edge TPP exists today. See §4.2. |
| Luck filtering | **Not built.** See §4.3. |
| Simplified pseudo vs. full pseudo as distinct modes | **DAG only supports simplified pseudo today.** See §4.1. |
| Procedural (distance-1-only) inspection rotations | **Partially exists** (`altAlgs`), applied too broadly today. See §4.4. |
| Cross optimisation (wide-move post-processing) | **Not built at all.** See §4.5. |
| Search limits matching the spec's table | **Not yet** — existing harnesses use different ad hoc numbers. See §4.6. |
| WASM scramble search (matched + pseudo) | Both solvers work correctly in isolation and via Node CLI harnesses; **zero integration into the website UI.** |

**Bottom line:** every individual component has a working implementation
somewhere, but `solver.html` — the actual product — does not call a solver
at all, and even the Node-only proof-of-concept pipeline only demonstrates
the first step of what's now a fully-specified multi-step product.

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
(only XXXXCross is explicitly out of scope). This is flagged to the user in
the accompanying report rather than guessed at here.

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
   milestone) — NOT STARTED**

   This is the real product, scoped per README.md and the deviations in
   §4. It is **not** "populate one results table" — it's the full
   interactive click-to-commit-and-research loop. Suggested build order:

   - [ ] **Path/session state.** A small piece of state (not necessarily
     more than a JS object) tracking: the current DAG node, the concatenated
     algorithm string of every committed step so far, cumulative pieces
     solved so far, and the committed display rows (for showing the
     solve-so-far above the active results table).
   - [ ] **Single-step search dispatch**, extracted from the proven logic
     in `cross_xcross.js` but rewritten against `worker-persistent.js`
     (persistent prune tables) instead of forked child processes: given the
     current node, walk its outgoing pruned-tree edges, dispatch each to
     the matched (`crossSolver`) or pseudo (`pseudoCrossSolver`) worker per
     `isPseudoState`, using the spec's search limits (§4.6) rather than the
     old harnesses' numbers.
   - [ ] **Luck filtering** (§4.3) on returned solutions before they're
     shown as candidates for a given edge.
   - [ ] **TPP scoring** (§4.2): score every candidate as
     `algSpeed(pathSoFar + candidate) / piecesSoFar(path + candidate)`, not
     via the existing per-edge `scoreAlgorithms`.
   - [ ] **Distance-1-only rotation expansion** (§4.4): apply `altAlgs`-style
     y/y2/y' variant generation only when searching from the unsolved root;
     treat it as fixed context for every later step.
   - [ ] **Single combined, TPP-sorted results table** — no per-type
     grouping — rendered into `#results-body`, including the `colour` /
     `type` / `rotation` / `edges` / `corners` / `alg` columns the spec
     requires.
   - [ ] **Click-to-commit**: clicking a row appends that edge's algorithm
     to the path, advances the current node, and re-triggers search from
     the new node (back to the top of this loop) instead of ending the
     interaction.
   - [ ] **Simplified-pseudo checkbox**, wired to whichever DAG-generation
     resolution is chosen per §4.1.
   - [ ] **Cross optimisation** (§4.5): implement the wide-move rewrite /
     rotation-tracking / orientation-filter / re-score pass against
     first-step Cross results only.
   - [ ] Multiple scrambles get independent path-state and independent
     results tables; never merge results across scrambles.
   - [ ] Leave look-ahead out of this pass (optional future enhancement per
     spec); single-step search of the current node is the correct scope
     for the initial build.

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
4. **Concrete `maxSolutions`/time-budget defaults** — not yet decided; per
   spec, these should come from observed interactive performance once the
   §5 step 3 loop exists, not be guessed at now.

A fifth, spec-adjacent gap surfaced during this review and is **not** one of
the four above, so it's called out separately: the spec's search-limits
table has no stated value for **XXXCross** (see §4.6). This should be
confirmed with the user before §5 step 3 needs it.
