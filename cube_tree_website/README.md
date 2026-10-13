# cube⑂tree

cube⑂tree is a browser-based solver for the Cross + F2L part of a CFOP 3×3
solve. Given a scramble, it helps a human find the **fastest
humanly-executable** path through Cross + F2L, not the shortest one. For
the last slot and the last layer it has six algorithm sets, ranked the same
way (see "Algorithm sets").

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
3. The user picks a result (Tab, a click, the tree-searcher) or types a step of
   their own; it is committed, the cube advances, and the solver searches
   again from the new node.
4. This repeats until Cross + F2L is solved.

### Look

The interface follows `UI_references/`: one-bit pixel art, pixel buttons,
pixel fonts, lowercase text (move notation keeps its case). **Few lines**:
the cube floats on the page, the scramble and the solution are labelled
text, and only the cube's stage and the solution bar carry frames, drawn
as **corner brackets** (no long edges, as in `UI_inspo.png`'s selection
marks); the buttons around them are plain text until hovered; the tree-searcher's
speech bubble is the one box. Four **themes**, two dark and two light, each
from a reference: ink (black and white), violet (purple and white, a green
accent), paper (black ink on paper) and mint (a soft pixel palette); the
cube is always full colour. **Pixels**: chunky (default), fine (the "reduce
pixel art for visibility" setting: about 2.5× the resolution) or smooth
(full screen resolution). Both pages work on phones, tablets and desktops.

### Captions

Every sentence the interface shows a user (onboarding, the tree-searcher's
reasons, the critique, the info dialog, empty and error states) is a key in
`js/captions.js`. The current texts are placeholders: the developer writes
them by hand; code never writes user-facing prose itself.

### Multiple scrambles, undo, persistence

- Every scramble's search starts when the list loads; one search runs at a
  time behind the scenes. Switching to a finished scramble is instant, to a
  running one does not restart it. Each scramble shows searching / ready /
  failed. `+` adds a random-state scramble.
- **The scramble on screen comes first**: its next search jumps the queue,
  and a background search pauses at its next solver call.
- Generated scrambles are random-state (a uniformly random state solved
  with a two-phase search and inverted, as WCA scramblers do).
- **Reload** restores every scramble's committed steps and solution text.
  Applying new search settings starts fresh.
- Scrambles are always solved independently; results are never merged.

## Algorithm sets

cube⑂tree also covers the last slot and the last layer with six standard
algorithm sets, meant to replace an alg database: **OLL** (57 cases),
**PLL** (21), **COLL** (42), **ZBLL** (472), **OLS** (VLS and HLS: the pair
ready for R U' R' or R U R' while the last layer is oriented, 216 + 216)
and **ZBLS** (302: the last pair inserted while the edges are oriented).

- **Cases** are enumerated from every state a set allows, so each list is
  complete; states that differ by a U turn before the alg or after it are
  one case. A case is shown as a pixel picture: the top view for the last
  layer, a small cube for the last slot; stickers a set does not look at
  are grey.
- **Algorithms** come from two sources: the community's (SpeedCubeDB, with
  its case names and votes) and the **tree-searcher's own**, generated for
  every case in the move groups good algs use (RU, RUF, RUD, RUL, RUFD,
  r and M variants...), a few moves past the shortest in each. Every alg is
  replayed on the cube before it is kept.
- **Ranking**: the solver's own step ranking (alg speed, move penalties,
  naturalness), without the AUFs. A generated alg that ranks above every
  community alg of its case is marked as a new find. The ranking is never
  shown as a number; each alg shows its move count and where it is from.
- **The algs page** (`algs.html`): the sets as tabs, subsets as chips, the
  cases as a grid. One search box finds cases by name ("oll 27", "t perm",
  "sune"), autocompletes moves like the solution bar (the algs that start
  with what is typed; Tab takes the ghost) and recognises a typed alg: the
  cases it solves, in every set. A case opens with its cube, which plays
  the chosen alg, and its algs.
- **On the solving screen**: once the F2L is solved, lines typed after it
  are read as last-layer steps by replaying them (oll, pll, coll, zbll,
  auf), labelled with their case ("oll 27", "pll t"). The ghost and the
  tree-searcher offer the algs of the case on the cube, in the solver's
  last-layer method (settings: oll + pll, coll or zbll when the edges are
  oriented). At the last pair, ZBLS and OLS algs that fit the cube are
  offered too, scored like any step, and the tree-searcher picks one only
  with a fact for it: it skips the OLL, or it orients the edges for a ZBLL
  solver.

## Out of scope (for now)

- EO-aware solving beyond the F2L DAG and the last-slot sets; other
  last-layer sets (1LLL, OLLCP, EOLL...).
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
- Community algorithms and case names: [SpeedCubeDB](https://www.speedcubedb.com)
  (OLL, PLL, COLL, ZBLL, VLS, Summer Variation, F2L names), imported with
  `tools/algdb.js` into `data/ll/scdb.json` with their vote counts.
- Fonts: [Silkscreen](https://fonts.google.com/specimen/Silkscreen) and
  [VT323](https://fonts.google.com/specimen/VT323) (SIL Open Font License),
  loaded from Google Fonts.
- Interface references: `UI_references/` (screenshots and third-party art the
  developer collected as the design brief; kept on the developer's machine
  only, git-ignored and not in the public repository).
- Other code (DAG generator, UI, cube renderer, scoring plumbing) was
  written with AI assistance.
