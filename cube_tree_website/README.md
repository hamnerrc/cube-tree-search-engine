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
- **"More efficient"** (the white-collar pick, "n moves shorter", the
  critique's "longer") means **fewer moves per piece solved** (the cross's
  four edges, then a corner and an edge per pair), never a shorter step
  that only solves fewer pieces.
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

`UI_references/` are the **guardrails** (developer, 2026-10-14): the
interface draws only what the references show, with their measured
proportions (the measurements are in the header of `styles.css`):

- **Windows** (`UI_inspo.png`): a 2-art-pixel line, square corner studs
  with a hole, a title tab centred on the top edge with cut corners and an
  ear at each end, a close box with an X on the top-right corner. The
  tree-searcher, the settings, the case on the algs page, the sets and the
  info are windows.
- **Keys**: the reference's check keys (cut corners, a deep bottom ledge,
  a pixel tick) for buttons and check boxes; **selection marks** (four L
  corners) only around what is chosen or pointed at -- the current page,
  the chosen set and filter, the solution bar (where the typing goes) and
  the search box; **slots**
  (rounded by one step) in a studded **inventory bar** for subsets and
  cases.
- **The menu** of `1-bit_inspo_UI.png`: capitals, the first letter lit
  ("SOLVE  ALGS  SETTINGS  WHAT'S THIS ?").
- **Move buttons** of `showdown_UI_inspo.png` for the tree-searcher's picks
  and a case's algs (the moves; their kind bottom left, the move count
  bottom right), its tooltip for a case's hover card.
- **CubeDB**: labels over their fields, the move counts at the right of
  the label, one row of equal playback keys.
- **The cube** floats on the page with the flat cast shadow of
  `cube_inspo_art.png`.

Text: the chrome in the pixel capitals of the references, sentences in
sentence case, move notation as typed. Four **themes**, two dark and two
light, each from a reference: ink (black and white), violet (purple and
white, a green accent), paper (black ink on paper) and mint (a soft pixel
palette); the cube is always full colour. **Pixels**: chunky (default),
fine (about 2.5x the resolution) or smooth. Every setting says in one line
what it does. Both pages work on phones, tablets and desktops.

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
**COLL** (329), **ZBLL** (472), **1LLL** (3,915), **OLS** and **ZBLS**
(302: the last pair inserted while the edges are oriented).

- **COLL** orients the last layer and solves its corners in one alg, from
  **any** of the 57 OLLs (developer, 2026-10-14; also called OLLCP): 329
  cases, one subset per OLL. Corners already oriented with the edges
  oriented is a PLL case, not a COLL one. Names: the classic COLL names
  ("AS 3") where the edges are oriented, otherwise SpeedCubeDB's OLLCP
  numbers ("OLL 12 · 3" is its OLLCP12 3).
- **ZBLL**: subsets by corner orientation (T, U, L, H, Pi, S, AS), each
  split by corner permutation (its COLL case: "T 1" ... "T 6").
- **1LLL** solves the whole last layer from any state: one subset per OLL
  (PLL for an oriented layer), then one per corner permutation, as in COLL
  (the oriented layer's by PLL's corner kinds). Its oriented-edge cases are
  ZBLL's and PLL's, with their lists; names from SpeedCubeDB's 1LLL page
  ("1LLL 12 5").

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
  its votes), the Speedsolving wiki, CubingApp, J Perm, CubeRoot (its 1LLL,
  OLLCP and ZBLS lists), algs.cuber.pro, the ZBLL sheets the wiki lists
  (Juliette Sébastien, Tao Yu & Justin Taylor, Brant Holbein, Nicolas
  Gertner, goodforthewin), a 1LLL sheet from Speedsolving,
  @moishy/algsets and the community ZBLS spreadsheet (Chad Batten, Tao
  Yu). Every last-layer alg found anywhere counts for every set it solves a
  case of (an OLL alg is also a 1LLL alg for the state it undoes) -- and
  from the tree-searcher's
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
  Every turn costs a little on top, so top algs are not long and blue
  collar where pros turn shorter ones (developer, 2026-10-14; checked on
  every pro's steps). A rotation and its inverse wrapped around an alg
  (the A perms' "x ... x'") cost a regrip, and a rotation at the end of an
  alg that finishes the cube costs nothing. The standard A and E perms are
  put first by hand (the professionals' choice beyond doubt).
- **Style**: a "white collar" solver (efficiency) sees shorter algs a little
  higher, a "blue collar" one (fast turning) faster-turning ones.
- **Awkward algs**: an alg that turns slowly for its length, uses an unusual
  move (B, a wide f/b/u/d, S, E) or rotates twice is awkward. "Hide awkward
  algs" (on by default) hides them in every case whose community favourite
  is not awkward itself; algs awkward beyond doubt are not kept at all,
  unless the community voted for them. An alg professionals execute (two
  or more reco.nz steps) or the community votes for (5+) is never awkward,
  whatever its moves: the u G perms, f OLL 51, B OLL 52, S algs.
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
  last-layer method (settings: OLL + PLL, COLL then EPLL, ZBLL when the
  edges are oriented, or 1LLL): two to four picks, each with a star to use it and make it
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
  last-layer sets (EOLL, ELL...).
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
  with the databases that list it), and, the same way, [CubeRoot](https://cuberoot.me/alg/3x3/1lll)
  (its 1LLL, OLLCP and ZBLS lists and SpeedCubeDB's 1LLL and OLLCP case
  names), [algs.cuber.pro](https://algs.cuber.pro/333), the public ZBLL
  sheets of Juliette Sébastien, Tao Yu & Justin Taylor, Brant Holbein,
  Nicolas Gertner and goodforthewin (as listed on the Speedsolving wiki's
  ZBLL page), the 1LLL sheet of the Speedsolving thread "most worth it 1LLL
  sets", and [@moishy/algsets](https://jsr.io/@moishy/algsets) (MIT).
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
