# cube⑂tree — Project Status & Archaeological Review

*Written 2026-10-02. This document is a snapshot of what actually exists in the
repo today, not a design doc. See [cube_tree_website/README.md](cube_tree_website/README.md)
for the intended end state.*

---

## 1. Current State Analysis

The codebase has three mostly-disconnected pieces: an abstract DAG generator, two
WASM solvers, and a frontend/scoring layer. Each piece works in isolation (there
are working proofs-of-concept), but they are not wired together into the single
pipeline the README describes, and the one place that *does* wire them together
(Node test scripts) bypasses the actual website entirely.

### 1.1 The DAG ([tree_gen.py](cube_tree_website/tree_gen.py))

- Builds a **purely abstract** state graph: each node is `{cross_solved, corners
  solved, edges solved}` (no real facelet/cubie state, no move sequences on
  nodes). Transitions model "solve N pairs, optionally rotate first" and encode
  the mismatch/pseudo-pair rules (`slot_mismatch_count`, `is_valid_pair_state`,
  `is_pure_mismatch_repair`).
- Correctly produces XCross/XXCross/XXXCross and pseudo-pair nodes via BFS, then
  prunes unreachable states.
- **Output bug:** writes `f2l_nodes_and_edges.json`, but the frontend
  ([script.js:1017](cube_tree_website/script.js:1017)) fetches that exact
  filename and **the file does not exist anywhere in the repo**. The only
  committed graph export is [F2L_tree.json](cube_tree_website/F2L_tree.json)
  (36k lines, dated Jul 26, one commit behind the current `tree_gen.py`), which
  is read only by the two Node.js test harnesses, never by the browser. **The
  website's graph fetch 404s today; `solver.html` cannot load the DAG at all.**
- No test/validation that the abstract DAG actually corresponds to reachable
  real cube states — it's bookkeeping, not cube simulation.

### 1.2 The WASM solvers

Two independent C++/Emscripten solvers, architecturally very different:

- **`crossSolver/`** ([solver.cpp](cube_tree_website/crossSolver/solver.cpp),
  ~7000 lines): mature, well-documented (see
  [IMPLEMENTATION_NOTES.md](cube_tree_website/crossSolver/IMPLEMENTATION_NOTES.md)).
  Implements Cross / Xcross / Xxcross / Xxxcross / Xxxxcross / LL-substeps / LL /
  LLAUF as **persistent** IDA* solvers (prune table built once, reused across
  calls), with cancel support, a worker (`worker-persistent.js`) that
  multiplexes all 8 solver types, and Node/browser helper wrappers. This is
  **vendored from an external project** (`or18/RubiksSolverDemo` — see the CDN
  example in its own README and the hardcoded `/Users/rc/RubiksSolverDemo/...`
  paths still present in `archived_attempts/try_4/solve_search.js`), not
  original code. Its own README/docs describe a `dist/src/crossSolver/...`
  directory layout and a `2x2solver` sibling that don't exist in this repo —
  the docs are the upstream project's, only partially adapted to
  `cube_tree_website/crossSolver/`.
- **`pseudoCrossSolver/`** ([pseudo.cpp](cube_tree_website/pseudoCrossSolver/pseudo.cpp),
  ~2900 lines): handles independent (non-matched) edge+corner slot solving for
  pseudo pairs. Exposes a single non-persistent `solve()` (confirmed: no
  `Persistent*` embind classes exist in `pseudo.cpp`) — **every call rebuilds
  its BFS prune table from scratch**, unlike `crossSolver`. Its worker
  ([worker3.js](cube_tree_website/pseudoCrossSolver/worker3.js)) is a thin
  17-line shim with no cancel support and no result-type normalization (just
  forwards raw `postMessage` strings).
- **Slot-index mismatch — RESOLVED (2026-10-02):** `crossSolver/README.md`
  documented the xcross/xxcross slot convention as `0=BR, 1=BL, 2=FL, 3=FR`,
  contradicting `cross_xcross.js`/`backend_test.js`'s
  `SLOT_INDICES = { BL: 0, BR: 1, FR: 2, FL: 3 }`. Verified empirically
  against the compiled `solver.wasm` (see
  [crossSolver/test/slot-mapping.test.js](cube_tree_website/crossSolver/test/slot-mapping.test.js)):
  the actual convention is **`0=BL, 1=BR, 2=FR, 3=FL`**, matching the JS side
  exactly. The docs (`README.md`, `IMPLEMENTATION_NOTES.md`,
  `solver-helper.js`, `solver-helper-node.js`) were wrong and have been
  corrected; `cross_xcross.js`/`backend_test.js` needed no changes.

### 1.3 Frontend ([index.html](cube_tree_website/index.html) / [solver.html](cube_tree_website/solver.html) / [script.js](cube_tree_website/script.js))

- `index.html`: scramble entry + checkboxes for colors and advanced options
  (xcross/xxcross/xxxcross/multislotting/pseudo/cross-opt). Working UI,
  persists criteria to `localStorage` and navigates to `solver.html`.
- `solver.html`: scramble viewer + empty results table. **Nothing in `script.js`
  ever populates `#results-body` or calls either WASM solver.** The
  `DOMContentLoaded` handler on this page only fetches the (missing) graph JSON,
  prunes it per the checked options (`pruneGraph`), and stores the pruned tree
  in `localStorage` — then stops. There is no code path from "pruned tree +
  scramble" to "call the solver and render a row."
- `script.js` also contains, already fully implemented and usable:
  - `generateScramble` / `populateScrambles` — random WCA-style scramble
    generation.
  - `algSpeed` — a hand-movement-simulation heuristic (grip/wrist/finger state
    machine) that scores an algorithm's physical execution difficulty. This is
    a **JS port of an older, less-tuned version** of the Python model in
    `archived_attempts/try_4/alg_speed.py` (see §2).
  - `altAlgs` — generates the 4 y-rotation variants of a solution for ranking.
  - `pruneGraph` — filters DAG nodes/edges by the UI's advanced-option
    checkboxes.
  - `scoreAlgorithms` / `calculateSolvedPieces` — SPP (speed-per-piece) scoring
    plumbing, exported via `module.exports` for reuse in Node.

### 1.4 The only working end-to-end pipeline today is in Node, not the browser

[cross_xcross.js](cube_tree_website/cross_xcross.js) and
[backend_test.js](cube_tree_website/backend_test.js) are standalone CLI scripts
(hardcoded absolute `BASE_DIR`, not reusable as a library) that **do** load
`F2L_tree.json`, dispatch to both WASM solvers via forked child processes (one
process per solve call — `fork()` + `execArgv: ['-e', ...]`, which re-pays
Node+WASM startup cost on every single solve), score results with `algSpeed`,
rank by SPP, and print a table. `backend_test.js` additionally does two-phase
(Cross/Xcross → child Xxcross/Xxxcross) expansion and memory/crash diagnostics.
These prove the DAG+solver+scoring concept works, but:
- they're diagnostic harnesses, not library code the website can call;
- forking a child process per solve is far too slow for interactive use (the
  in-browser path should use the existing persistent worker instead);
- they only cover Phase 1 cleanly — `backend_test.js`'s Phase 2 (multislotting)
  is present but explicitly flagged as the part that triggers OOM/crash
  diagnostics, i.e. not yet reliable.

### 1.5 Distance from the README's goal

| README step | Status |
|---|---|
| 1. Pre-compute DAG of F2L states | Done, but output filename doesn't match what the frontend expects |
| 2. Use DAG to guide legal piece combos | Done abstractly (`pruneGraph`); never actually drives a solver call |
| 3. Run WASM scramble searches (matched + pseudo) | Both solvers work in isolation and via Node CLI harnesses; **zero integration into the website UI** |
| 4. Score by speed model (SPP) and rank | `algSpeed`/`scoreAlgorithms` work and are proven in the Node harnesses; not connected to `solver.html`'s results table |

**Bottom line:** every individual component has a working implementation
somewhere, but `solver.html` — the actual product — does not call a solver at
all. The README's own update log already says this ("the code does not work
currently"); this review confirms why: the DAG's own output file doesn't exist
under the name the frontend expects, and no browser-side code bridges the DAG
to the workers.

---

## 2. Recyclable Utilities from `archived_attempts/`

Non-ML logic worth pulling forward, found while reviewing `try_1`–`try_4`
(`try_2` and `try_3` are pure PyTorch model training code — cross-picker MLP and
a cube-state GNN — and are not reusable here):

1. **Better speed model — [`try_4/alg_speed.py`](archived_attempts/try_4/alg_speed.py)**
   This is a **more mature version of `script.js`'s `algSpeed`**, with the same
   core hand/finger/wrist simulation but three additions not yet in the JS
   port:
   - Differential-evolution-fit physics constants (`wrist_mult=0.9245`,
     `scale=0.0261`, etc.) instead of the JS version's unfit defaults
     (`wristMult = 0.8`, no scale factor).
   - A `scale` term that converts the raw difficulty score into actual
     **seconds**, which `calculateStatistics`-style ranking needs for anything
     user-facing ("this alg takes ~1.3s") rather than just a relative score.
   - Optional bigram/trigram correction terms (`_DEFAULT_BIGRAM_WEIGHTS`,
     `_DEFAULT_TRIGRAM_WEIGHTS`, fit by regression against real LL solve data)
     layered on top via `_count_ngrams`, applied to both the algorithm and its
     mirror.
   **Action:** port the tuned constants (and optionally the ngram correction)
   into `script.js`'s `algSpeed`, rather than keeping two divergent
   implementations of the same model.

2. **Mirror-move utility — [`try_4/mirror_alg.py`](archived_attempts/try_4/mirror_alg.py)**
   A clean `move_mapping` table that mirrors an algorithm over the R/L axis
   (`R U R' U'` → `L' U' L U`). `script.js`'s `altAlgs` only generates
   y-rotation variants today — it has no mirror variant. Mirroring doubles the
   algorithm pool for ranking (useful for color-neutral / lefty-friendly
   solutions) and is already inlined as `_MIRROR_MAP` inside
   `alg_speed.py` too, so porting it once to JS serves both the solution-ranking
   and speed-scoring paths.

3. **Real-cube-state solved-pair detector — [`try_1/utils/CFOPflags.py`](archived_attempts/try_1/utils/CFOPflags.py)**
   Takes a 54-character Kociemba-style facelet string and, via fixed bitmasks,
   returns `[cross, bl, br, fl, fr]` solved flags by comparing facelets to their
   face centers. This is exactly the abstract-state fingerprint that
   `tree_gen.py` tracks symbolically — but computed from an **actual cube
   state** instead of bookkeeping. There is currently no code anywhere in
   `cube_tree_website/` that can take a real scramble + solution and verify
   which DAG node it actually lands on. Porting this (as JS, operating on
   whatever facelet format the WASM solvers expose, or on a simple cube
   simulator) gives a correctness check: "does the DAG's claimed transition
   match what actually happened on the cube?" — valuable for validating both
   the DAG and the slot-index question in §1.2.

4. **Cube-state simulation plumbing — [`try_4/cubestate_encoder.py`](archived_attempts/try_4/cubestate_encoder.py)**
   Partially reusable: it wraps the `magiccube` Python library plus a
   face-adjacency graph (`archived_attempts/try_3/data/cube.graphml`) to apply a
   scramble string and read back facelet colors. The one-hot GNN encoding
   (`COLOR_TO_ONEHOT`, `value` field) is ML-specific and not relevant here, but
   the underlying "apply scramble → get facelet colors" wrapper is a
   ready-made way to drive `CFOPflags`-style verification in Python without
   writing a cube simulator from scratch. Note: as checked out, this file is
   already broken — it points at `BASE_DIR/data/cube.graphml`
   (`archived_attempts/data/cube.graphml`), but the graphml file only exists
   under `try_3/data/`, not `try_4`'s parent. Fix the path or copy the file
   before reusing.

Not recommended to pull forward: `try_1/utils/npz_generate.py`,
`try_1/models/main.py`, `try_2/models/cross_picker.py`,
`try_3/scripts/*` — all are ML training/data-generation code for the
abandoned neural-net approach and have no bearing on the DAG+WASM design.

---

## 3. Actionable Roadmap

Ordered so each step unblocks the next; items in the same numbered step can be
done in parallel.

1. **Fix the DAG hand-off (blocking everything else) — DONE (2026-10-02)**
   - [x] `tree_gen.py` already wrote the right filename; the bug was that it
     resolved the path against the current working directory instead of its
     own location. Fixed to resolve against `SCRIPT_DIR`, regenerated
     `f2l_nodes_and_edges.json` (174 nodes / 449 edges) and
     `f2l_table_inspector.html`, and verified in-browser that `solver.html`
     fetches it with 200 OK (was a 404) and `pruneGraph` populates
     `localStorage` correctly.
   - [ ] Still open: decide whether `F2L_tree.json` (root) stays as a second
     copy for the Node scripts or is deleted in favor of one canonical file
     both browser and Node code read.

2. **Resolve the slot-index contradiction before trusting any multi-pair solve — DONE (2026-10-02)**
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

3. **Build the missing browser-side bridge (DAG → solver → results table)**
   - [ ] Extract the solve-dispatch logic already proven in `cross_xcross.js`
     (minus the child-process forking — use `worker-persistent.js` directly,
     which already keeps prune tables warm) into a reusable module `script.js`
     (or a new file) can call from `solver.html`.
   - [ ] On `solver.html` load: take the pruned tree already being computed and
     stashed in `localStorage`, walk its root-level edges, and for each one
     call the appropriate persistent-worker method (`solveCross`,
     `solveXcross(slot)`, etc.) for matched-pair nodes and the pseudo worker
     for pseudo-pair nodes (`isPseudoState` already tells you which).
   - [ ] Feed results through the existing `altAlgs` → `scoreAlgorithms` →
     SPP-ranking pipeline (already written, just needs a caller in the browser
     context) and render rows into `#results-body`.

4. **Give `pseudoCrossSolver` the same persistent-table treatment as `crossSolver`**
   - [ ] Port the `Persistent*Solver` struct pattern documented in
     `crossSolver/IMPLEMENTATION_NOTES.md` §"Adding a New Solver" to
     `pseudo.cpp`, so pseudo-pair searches don't rebuild their BFS table on
     every call once multiple scrambles are searched per session.

5. **Fold in the recyclable utilities from §2**
   - [ ] Port `alg_speed.py`'s tuned constants (and `scale`) into `script.js`'s
     `algSpeed` so SPP rankings reflect real seconds, not an unfit relative
     score.
   - [ ] Port `mirror_alg.py`'s move-mapping into `altAlgs` (or a sibling
     function) to double the ranked-algorithm pool with mirrored variants.
   - [ ] Port `CFOPflags.py`'s facelet-mask logic into a small JS verification
     helper; use it in a test script to confirm a handful of DAG transitions
     against real WASM solver output (general DAG correctness checking — the
     slot-index question itself was already resolved in step 2 via direct
     empirical probing of `solver.wasm`, see
     [crossSolver/test/slot-mapping.test.js](cube_tree_website/crossSolver/test/slot-mapping.test.js)).

6. **Once the above works for Cross/Xcross, extend to Xxcross/Xxxcross/multislotting**
   - [ ] Revisit `backend_test.js`'s Phase 2 logic (already drafted, flagged as
     crash-prone) as the template for multi-pair expansion, but run it through
     the persistent worker instead of forked child processes before trusting
     its OOM diagnostics — some of the crashes may simply be artifacts of
     spawning a fresh WASM instance per call rather than a real solver bug.
