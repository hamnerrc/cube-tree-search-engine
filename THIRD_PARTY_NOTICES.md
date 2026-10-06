# Third-party notices

cube⑂tree as a whole is licensed under the **GNU General Public License,
version 3** (see [LICENSE](LICENSE)). It includes the third-party components
below; their notices are reproduced as their licences require.

## or18/RubiksSolverDemo — GPL-3.0

Source: https://github.com/or18/RubiksSolverDemo (licence: GPL-3.0, the same
text as [LICENSE](LICENSE)).

Included in `cube_tree_website/crossSolver/` and
`cube_tree_website/pseudoCrossSolver/` (solver engines, prune-table and
move-table construction, worker/helper glue), and the upstream engine
documentation `cube_tree_website/docs/or18_solver_docs.html`.

**Modifications** (GPL-3.0 §5a): files changed from the upstream copy are
listed here with the date of the change.

- **2026-10-04** `crossSolver/solver.cpp`: added `g_noop_allowed` and the
  exported `setNoopMoves()`, and gated the 16 "move leaves every goal piece
  unchanged ⇒ reject solution" checks on it (default: none allowed, i.e.
  upstream behaviour). Rebuilt `crossSolver/solver.js` / `solver.wasm` with
  `compile.sh` (emcc 6.0.11).
- **2026-10-04** `crossSolver/worker-persistent.js`, `solver-helper.js`,
  `solver-helper-node.js`: pass a `noopMoves` option through to
  `setNoopMoves()` on every call.
- **2026-10-04** `pseudoCrossSolver/pseudo.cpp`: the same `setNoopMoves()`
  gating (8 checks); move/multi tables built once per process (a pristine
  prototype of each search class is copied per call) and prune tables cached
  by their inputs (`g_prune_cache`). Rebuilt `pseudo.js` / `pseudo.wasm` with
  the new `pseudoCrossSolver/compile.sh`. `worker3.js`, `solver-helper.js`,
  `solver-helper-node.js`: pass `noopMoves` through.
- **2026-10-04** `crossSolver/worker-persistent.js`, `pseudoCrossSolver/worker3.js`:
  forward the worker's query string (engine version) to `solver.js` /
  `pseudo.js` and their `.wasm` files (cache busting).
- **2026-10-04** `crossSolver/solver.cpp` (performance; outputs verified
  byte-identical to the previous binary on a call battery):
  `corner_prune_table()` caches the "cross + one corner" prune tables per
  (corner, move list) and shares them between all xcross..xxxxcross solver
  instances, replacing each instance's own copy and its `_initialized` flag
  (this also stops a persistent solver reusing a table built for a different
  move list); `pair_prune_table()` adds an admissible pairs-only lower bound
  (cached per pieces and move list) checked in the xcross, xxcross, xxxcross
  and xxxxcross searches (`>= depth` after a move, `> depth` after a
  rotation, which consumes no move); `create_prune_table()` precomputes, per
  centre state, the ordered list of distinct base moves instead of re-trying
  every move/rotation combination per cell (same table).
- **2026-10-05** `crossSolver/solver.cpp`, `pseudoCrossSolver/pseudo.cpp`:
  a per-call search deadline (`setDeadlineCheck()`, `deadlineHit()`, and
  `Module._deadline` in epoch ms, read by an `EM_JS` clock check every 16384
  search nodes). When it passes, the search stops like a capped one ("Search
  finished." with the solutions found so far). It is off unless enabled, so
  default output is unchanged. `crossSolver/solver.cpp`: "cross + one edge"
  prune tables (`edge_prune_table()`, shared like the corner tables) as an
  extra admissible bound in the xxxcross search. `pseudoCrossSolver/pseudo.cpp`:
  a pairs-only admissible bound (`pair_prune_table()`, seeded at the goal's
  four D offsets) in the xxcross and xxxcross searches. Outputs verified
  byte-identical to the previous binaries on call batteries
  (`tools/engine-battery.js`, both engines).
- **2026-10-05** `crossSolver/worker-persistent.js`, `solver-helper.js`,
  `solver-helper-node.js`, `pseudoCrossSolver/worker3.js`, `solver-helper.js`,
  `solver-helper-node.js`: pass the `deadline` option to the engine, and skip
  (resolve with no solutions) a call that starts after its deadline.
- **2026-10-05** `crossSolver/compile.sh`: `ASYNCIFY_REMOVE` for the
  recursive searches and `create_prune_table`, which never yield, so Asyncify
  no longer instruments them (searches ~25-30% faster).
  `crossSolver/solver.cpp`: `tableCacheKeys()`, `tableCacheGet()` and
  `tableCachePut()` export and import the shared corner / edge / pair prune
  tables (a table is only accepted under a new key with the right size), so
  a page can build each table once and reuse it in its other workers and
  across page loads. `crossSolver/worker-persistent.js`: `tableKeys`,
  `getTables`, `putTables` messages (queued while a solve runs);
  `crossSolver/solver-helper.js`: matching `tableKeys()`, `getTables()`,
  `putTables()`. Search outputs verified byte-identical to the previous
  binary on the call battery (`tools/engine-battery.js`), and with imported
  tables (`test/offload-e2e.js`).
- **2026-10-05** `crossSolver/solver.cpp` (performance; outputs verified
  byte-identical): a goal-DAG search for the cross, xcross, xxcross,
  xxxcross and xxxxcross classes, used when the move list has wide moves,
  slices or rotations. The prune and goal checks depend only on the piece
  indices, so the spellings of one piece-state path (`L` / `r`, and every
  rotation branch) no longer each search its subtree: `dag_mask` computes,
  memoised per (state, moves left), which physical moves still reach the goal
  under the very same checks, and `dag_walk` replays the original depth-first
  order, move-adjacency, move-count, rotation and centre rules and leaf
  validation over it. `setDagSearch(false)` restores the original search
  (`crossSolver/test/dag-search.test.js` compares both). `solver_yield()`
  only yields to the event loop when 25 ms have passed since the last yield
  (it used to wait for a timer once per search depth). Verified on the call
  battery and 281 recorded look-ahead calls (identical output).
- **2026-10-06** `crossSolver/worker-persistent.js`: an engine failure after
  a search has paused at a yield (e.g. an Emscripten abort inside an
  Asyncify-resumed call) is reported as an `error` message with
  `fatal: true` instead of leaving the call without an end, a WebAssembly
  trap in the handler is reported the same way, and later solves on that
  worker are refused. `crossSolver/solver-helper.js`: a fatal error (or an
  uncaught worker error) rejects with `err.fatal`; `terminate()` settles the
  in-flight call and pending table requests. Search behaviour is unchanged.

## Trangium's MCC (Movecount Coefficient) — MIT

Source: https://github.com/trangium/trangium.github.io. The `algSpeed`
hand-movement model in `cube_tree_website/js/script.js` (and its Python port
`archived_attempts/try_4/alg_speed.py`) is derived from it.

```
MIT License

Copyright (c) 2021 trangium

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Development-only tools (not distributed)

The Python packages `magiccube` and `kociemba` are used only by the test
suite, as independent ground truth; no code from them is included here.
