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

### The solution bar, the cube, the tree-searcher

- **Steps** are read off the typed text by replaying it; a step ends at its
  line's end, except the last one: the step that finishes the F2L (or a
  last-layer line that solves the cube) needs no newline after it, and Tab
  writes none. A line never gets a second comment: nothing is offered to
  the right of a comment, and Tab on a finished, commented line only goes
  to the next line.
- **The cube never cuts** to a new state: it glides through the moves
  between what it shows and where it should be -- back to the moves both
  share, then forward -- in about half a second however far (one move: one
  turn), for typing, Tab, the caret, hovering a pick, the playback buttons
  and the critique. No fullscreen button.
- **Look-ahead** has only a depth (off, 2, 3). Its breadth grows by itself:
  the best three candidates first, then one more at a time for as long as
  the step is on screen and no other search needs the engines.
- **The tree-searcher** makes two to four picks, each with a reason, and
  speaks to the solver's level and to how much they want it to talk
  (onboarding). Its **critique** only suggests what the solver has switched
  on and their level allows, calls a step within a few percent of the best
  "a solid choice" (pair choice is often taste), brings up other pieces only
  when they are clearly faster, and declines, jokingly, when every step was
  one of its own suggestions.
- **Onboarding** asks, besides speed, inspection, style, goals and cross
  colours: the last layer they use (2-look, full OLL/PLL, COLL, ZBLL), their
  last-slot tricks (each switches its set on) and how chatty the
  tree-searcher should be.

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

cube⑂tree also covers the last slot and the last layer with algorithm sets,
meant to replace an alg database: **OLL** (57 cases), **PLL** (21),
**COLL** (42), **ZBLL** (472), **OLS** and **ZBLS** (302: the last pair
inserted while the edges are oriented).

- **OLS** solves the last pair and orients the whole last layer at once,
  for **every** placement of the pair: 8,054 cases (with the 57 OLL cases of
  a solved pair and the solved state, the 8,112 of the Speedsolving wiki).
  Its named subsets: **VLS** (216: the pair connected, ready for R U' R'),
  **HLS** (216: the pair split, ready for R U R'), and within them **WV**
  (27: VLS with the last-layer edges oriented) and **SV** (27: HLS with the
  edges oriented). VLS and HLS are in `ols.json`; the other ~7,600 cases in
  `ols-more.json`, loaded only where they are wanted.
- **Cases** are enumerated from every state a set allows, so each list is
  complete; states that differ by a U turn before the alg or after it are
  one case. A case is shown as a pixel picture: the top view for the last
  layer, a small cube for the last slot; stickers a set does not look at
  are grey.
- **Algorithms** come from the community's databases -- SpeedCubeDB (with
  its votes), the Speedsolving wiki, CubingApp, J Perm, and the community
  ZBLS spreadsheet (Chad Batten, Tao Yu) -- and from the tree-searcher's
  generator, run for every case in the move groups good algs use (RU, RUF,
  RUD, RUL, RUFD, r and M variants...), a few moves past the shortest in
  each. Every alg is replayed on the cube before it is kept. Nothing is
  labelled as found by the tree-searcher or as new; a community alg shows
  where it is listed.
- **Ranking**: each set has its own constants (alg speed, move penalties,
  left-hand turns, naturalness), fitted on what professionals execute
  (reco.nz reconstructions): OLL and PLL on Yiheng Wang, ZBLL and ZBLS on
  Xuanyi Geng; sets without enough professional data keep the constants
  fitted on the community's votes. Each set's naturalness model learns from
  the community's algs and its professional's algs of the other cases. The
  ranking is never shown as a number; each alg shows its move count.
- **Style**: a "white collar" solver (efficiency) sees shorter algs a little
  higher, a "blue collar" one (fast turning) faster-turning ones.
- **Awkward algs**: an alg that turns slowly for its length, uses an unusual
  move (B, a wide f/b/u/d, S, E) or rotates twice is awkward. "Hide awkward
  algs" (on by default) hides them in every case whose community favourite
  is not awkward itself; algs awkward beyond doubt are not kept at all,
  unless the community voted for them.
- **Main and known algs**: a solver can make any alg their **main** alg for
  its case (★, on the algs page and in the tree-searcher's picks); it is
  then the only suggestion ("your alg for this case") and the ghost. They
  mark the cases they **know** (one by one, by sweeping across the case
  grid in "mark what I know", or by answering which last layer they use);
  a last-layer alg they type themselves on the solving screen marks its
  case known on its own. The algs page counts what they know of each set.
- **The algs page** (`algs.html`): the sets as a menu with the known count,
  the set as a window, its subsets as a row of slots (OLS: wv, sv, vls, hls,
  every pair, then the pair's placement), the cases as a grid with a hover
  card for the first alg; filters all / to learn / known. One search box
  finds cases by name ("oll 27", "t perm", "sune"), autocompletes moves like
  the solution bar (Tab takes the ghost) and recognises a typed alg. A case
  opens with its cube, which plays the chosen alg, and its algs as buttons.
- **On the solving screen**: once the F2L is solved, lines typed after it
  are read as last-layer steps by replaying them (oll, pll, coll, zbll,
  auf), labelled with their case ("oll 27", "pll t"). The ghost and the
  tree-searcher offer the algs of the case on the cube, in the solver's
  last-layer method (settings: oll + pll, coll or zbll when the edges are
  oriented): two to four picks, each with a star to use it and make it
  main, and "neither of these" for more. A PLL typed without its AUF gets
  the AUF with Tab.
- **Last slot**: each set is switched on by itself in the settings (ZBLS;
  WV, SV, VLS, HLS, full OLS), described in words with the acronym beside
  them. At the last pair the algs of the sets that are on are offered
  (a left slot gets the mirrored, left-hand algs). While any of them is on,
  the last two pairs are never solved at once, multislot or not: the last
  pair stays one pair. The critique judges a last pair done with one of
  these sets against that set's algs, not against a plain insert.

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
  `tools/algdb.js` into `data/ll/scdb.json` with their vote counts; the
  [Speedsolving wiki](https://www.speedsolving.com/wiki), [CubingApp](https://cubingapp.com/algorithms),
  [J Perm](https://jperm.net/algs) and the community ZBLS spreadsheet (Chad
  Batten, Tao Yu; via [@moishy/algsets](https://jsr.io/@moishy/algsets), MIT),
  imported with `tools/alg-sources.js` into `data/ll/sources.json` (each alg
  with the databases that list it).
- Last-layer tuning data: the last-slot and last-layer steps of reco.nz
  reconstructions (`tools/ll-pros.js`, `data/ll/pro_ll.json`, each credited
  by its solve id).
- Fonts: [Silkscreen](https://fonts.google.com/specimen/Silkscreen) and
  [VT323](https://fonts.google.com/specimen/VT323) (SIL Open Font License),
  loaded from Google Fonts.
- Interface references: `UI_references/` (screenshots and third-party art the
  developer collected as the design brief; kept on the developer's machine
  only, git-ignored and not in the public repository).
- Other code (DAG generator, UI, cube renderer, scoring plumbing) was
  written with AI assistance.
