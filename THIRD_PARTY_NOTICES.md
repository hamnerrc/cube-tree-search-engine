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
documentation `cube_tree_website/or18_solver_docs.html`.

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

## Trangium's MCC (Movecount Coefficient) — MIT

Source: https://github.com/trangium/trangium.github.io. The `algSpeed`
hand-movement model in `cube_tree_website/script.js` (and its Python port
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
