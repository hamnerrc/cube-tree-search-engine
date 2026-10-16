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
3. The user picks a result (Tab, a click on a suggestion) or types a step of
   their own; it is committed, the cube advances, and the solver searches
   again from the new node.
4. This repeats until Cross + F2L is solved.

### The solution bar, the cube, the suggestions

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
- **Suggestions**: two to four picks, each with one reason. The
  **critique** only suggests what the solver has switched on and their
  level allows, calls a step within a few percent of the best fine (pair
  choice is often taste), brings up other pieces only when they are clearly
  faster, and says so when every step was a top suggestion.
- **Setup** asks speed, inspection, style, goals, cross colours, the last
  layer they use (2-look, full OLL/PLL, COLL, ZBLL) and their last-slot
  sets (each switches its set on).

### Look

Restyled on 2026-10-15 to drop the 1-bit pixel skin. The look is an
old-school web utility, closest to Pokémon Showdown's client: Verdana at
13px, bevelled buttons, folder tabs, a Georgia italic wordmark, native
checkboxes and selects, a light grey-blue page with white panels (plus a
dark theme). No web fonts.

- **Solve screen**: the cube on the left, filling the window's height, with
  the stage bar (cross, four pairs, last layer) and playback under it. On
  the right: the scramble (prev / next / new, and "Edit list" for a list of
  scrambles), the **Next step** panel, then the solution. Both columns run
  to the bottom of the window. On phones it stacks: scramble, cube,
  suggestions, solution.
- **Suggestions** are one row each: the moves, the move count, the reason,
  and the step kind (cross, xcross, pair, multislot, pseudo, a last-slot
  set, OLL, PLL...), with a coloured stripe per kind. Last-layer
  suggestions carry a star that makes the alg your main one.
- **Critique**: shown in the same panel, a bar per step with a word after
  it -- *best*, *slower*, *beats the search* (a step the search doesn't
  look for, and nothing it found is faster) -- and the alternative under
  it. The same word appears after the step's line in the solution.
- **Options** is a popup under its button with tabs: Display (theme, cube
  rendering, animation, hidden faces), Steps, Last layer, Search.
- **Profiles**: a plain initial badge, no avatars. Setup is one form (name,
  average, goals, inspection, style, last layer, last slot, cross colours);
  the profile list has Edit / Export / Delete per profile.
- **Algs page**: the sets as tabs down the left of the panel; subsets as
  flat toggles; cases as tiles with the community nickname where there is
  one (Sune, Antisune, H, Pi, Headlights, Chameleon, Bowtie); a case's
  algs as a ranked list with an #/Alg/STM header.
- **The cube** is smooth by default (pixel art is an option) with dark
  plastic outlines in both themes.

Case names are written the standard way on screen (OLL 27, PLL Ja); the
labels written into the solution text stay lowercase like the other step
comments (`// oll 27`, `// cross`).

### Captions

Every sentence the interface shows a user is a key in `js/captions.js`;
code asks `caption(key, vars)` instead of writing prose inline.

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
  from cube⑂tree's own
  generator, run for every case in the move groups good algs use (RU, RUF,
  RUD, RUL, RUFD, r and M variants...), a few moves past the shortest in
  each. Every alg is replayed on the cube before it is kept. Nothing is
  labelled as found by cube⑂tree or as new; a community alg shows
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
  its case (★, on the algs page and in the suggestions); it is
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
  suggestions offer the algs of the case on the cube, in the solver's
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

## Design review

On 2026-10-15 the interface was restyled in a loop: change the site, have a
fresh AI agent (no memory of earlier rounds) score it from 0 to 10, act on
its feedback, repeat. The target was 8; the loop stopped after four rounds.
Scores: 3.5 before any change, then 4.6, 5.6, 6.2 and **6.4**.

### The reviewer prompt

Give this to a new agent as is (it takes the screenshots itself). Replace
`TAG` with a name for the round.

```text
You are an independent, skeptical design reviewer: a senior professional web
developer / product designer who has seen hundreds of AI-generated
("vibecoded") websites and knows their tells. You have no stake in this
project and you must not be generous.

## The site
cube⑂tree is a static web tool for speedcubers (Rubik's cube solvers): you
get a scramble, and it suggests and critiques human-executable solution steps
for the Cross + F2L stage of a CFOP solve; there is also an algorithm-set
browser (OLL/PLL/etc.). Source: cube_tree_website/ (pages: index.html =
sign-in/setup, solver.html = main tool, algs.html = alg browser; CSS in
styles.css; JS in js/). Ignore the folder UI_references/ entirely, and
ignore README.md / PROJECT_STATUS.md claims -- judge only what ships to the
browser.

## How to look at it
1. Serve the site: `cd cube_tree_website && python3 -m http.server 8765`
   (check that http://127.0.0.1:8765/index.html answers 200).
2. Take fresh screenshots: `node tools/review-shots.js <outdir> TAG` (about
   a minute). It prints the PNG paths: sign-in, solver (viewport + full
   page), Options, algs page, phone width. Look at EVERY screenshot. You may
   modify a COPY of the script (never the original) for extra views (e.g.
   THEME=dark, a few steps taken, the critique, a case dialog).
3. Inspect the shipped source like a pro would with view-source / devtools:
   the HTML of the three pages, styles.css, and skim the UI JS
   (js/solver-ui.js, js/onboarding.js, js/algs-ui.js, js/captions.js,
   js/segmented.js).

## The scale (use this definition exactly)
10 = "a website that looks completely original, with UI design that fits
the use case perfectly. If a professional web developer inspected the
website, they would find no signs of AI usage in the creation."
0 = unmistakably AI-generated, generic, and ill-fitted to the use case.
Score holistically on visual design AND source inspection. Be calibrated:
most competent indie sites with some AI tells land 4-6; 8 means a pro would
genuinely believe a human designer/developer with taste made it on purpose
for cubers.

Things that typically mark AI-made sites (check for these, but also anything
else you notice): generic dark-mode-with-one-accent aesthetics;
trendy-retro theming applied uniformly as a skin rather than serving
function; decorative corner brackets/frames everywhere; letter-spaced
all-caps micro labels everywhere; monospace-for-everything; overly chatty or
cutesy microcopy, exclamation marks, mascot speech; inconsistent
density/spacing; huge empty regions; layouts that don't reflect how the task
is actually done; source comments that narrate design decisions, cite
"references", "the developer", "the brief", "README", spec-section numbers,
or explain obvious things; over-long explanatory comments; uniform naming
patterns; features presented with marketing tone; emoji; gradients/glows;
etc. Also judge positives: does it feel purpose-built for speedcubers
(notation, timing culture, cubing community conventions), is the
information hierarchy right for the workflow, does it have idiosyncratic,
deliberate choices a human would make?

## Output (your final message -- be concrete and actionable)
- `SCORE: X/10` (one decimal allowed) on the first line.
- The 5-10 strongest AI tells you found, most damaging first, each pointing
  at a specific screen element or file:line, and saying what a human
  designer would have done instead.
- What already works and should be kept.
- The 3 changes that would raise the score most.
Do not modify any project files.
```

### The fourth review (6.4 / 10)

File and line numbers are as of the commit that added this section.

**Strongest AI tells, most damaging first**

1. **The source comments read like a model explaining itself.** For a pro
   opening devtools, this is the biggest giveaway.
   - Every function has a `/** … */` doc comment, all in the same "A thing:
     explanation (other-file.js symbol)" pattern with parenthetical
     cross-references. Examples: `js/solver-ui.js:47-61`, `:214-217`,
     `:252-288` (paragraphs on worker-pool sizing and job ordering), and
     `js/algs-ui.js:1-17`.
   - The section banners are padded to the same width in every file
     (`// ---- the case dialog ------`), and the same in `styles.css`.
   - Some comments narrate design rules instead of code: `captions.js:141`
     "critique (no numbers: why a step is slower…)", and `styles.css:211`
     "both columns run to the bottom of the window…".
   - A human would write far fewer comments, mostly *why*-comments at
     tricky spots: terser, inconsistent, some files with almost none.
2. **`js/captions.js` is a keyed string table for a single-language indie
   tool.** Every sentence sits behind `caption('reason.shorter', …)`.
   - Some keys are stale or dead: `:88` still says "the three picks" but
     the UI shows two; `reason.wide_ergonomic` is never referenced.
   - Some copy was wrong: the note shown for a 10 s+ average said "Below 10
     seconds, plain CFOP is still the bottleneck", which is backwards (fixed
     in the same commit).
   - A human would inline the strings or keep only the long help text
     separate.
3. **The suggestion rows use a coloured left-stripe accent**
   (`box-shadow: inset 4px 0 0 var(--kind)`), plus a faint right-aligned
   kind label ("cross" / "pair") far from the moves. This is the stock AI
   "category stripe on a card" pattern. A cuber-designer would put the step
   kind next to the alg, e.g. as the `// cross` comment style the solution
   editor already uses, and drop the stripe.
4. **The solver opens with huge empty regions.** The Solution panel is
   about 550 px of blank textarea holding one placeholder line; "Next step"
   holds only two rows; in the alg case dialog the cube column leaves a
   large dead area under "Mark this case as known". A human would size the
   editor to its content, or use the space (the scramble's cross/inspection
   view, past solves, more suggestions).
5. **The bevelled gradient buttons are one global skin** (`--bevel`, used
   by every `.btn`), together with Verdana everywhere. It reads as a "retro
   desktop" theme laid over everything rather than a choice made per
   control, especially on the toolbar (Undo / Copy / Copy all / Critique
   all styled the same) and the playback row.
6. **Inconsistent cubing terms and capitalisation**: "Xcrosses" /
   "Xxcrosses" (`captions.js:60,64`, onboarding) beside "XCross" /
   "XXCross" in the setup radios and Options, and "xcrosses" in the level
   notes; the case dialog subheading "Dot Case" next to "Orientation of the
   last layer"; the lowercase `<h2 id="set-name">oll</h2>` placeholder in
   `algs.html`.
7. **The theme control is duplicated and inconsistent.** On index.html
   Light/Dark is a segmented control in the header; on solver.html it is in
   Options > Display. The header mixes underlined text links ("Help", and
   "Algs" on index) with bevel buttons ("Options"). Pick one header
   vocabulary.
8. **The "Cross ... F2L ... LL" stage gauge labels** under the cube are
   three words spread under seven unlabelled segments and don't line up
   with the segment groups. Label each segment, or put tick marks at the
   group boundaries.

**What already works and should be kept**

- The solution editor as a reconstruction text file, exactly how cubers
  write solves: one step per line, `// inspection`, `// cross`,
  `// 1st pair` comments, a line-number gutter, Tab takes the grey ghost
  suggestion and ↑/↓ cycle the others, "14 STM · 14 ETM" in the header.
- The cubing-culture details: setup asks for your ao12, inspection depth
  and a turning-speed vs move-count style, with cross-colour swatches;
  WV/SV/VLS/HLS/OLS/ZBLS described by pair shape; the OLL shape groups;
  nicknames (Sune, Headlights, Chameleon, Bowtie); each alg credited with
  its sources (speedcubedb · algsets · cuberoot · j perm · 1lll sheet ·
  cubingapp).
- Short, specific copy ("Every step was the top suggestion. Nothing to
  critique.", "Leaves a free pair.", "Fastest to execute."), with no
  marketing tone, exclamation marks or emoji.
- The plain two-column setup form, the light grey-blue default theme,
  dense panels and the `cube⑂tree` serif logo, which avoid the dark-neon AI
  look.
- Clean, semantic HTML with sensible aria labels.
- The algs browser: a set rail with case counts, "0 of 57 known",
  sweep-to-mark learning mode, and a search box that takes "OLL 27, t perm,
  sune" or moves.
- The phone layout stacks in the right order: scramble, cube, next step,
  solution.

**The 3 changes that would raise the score most**

1. **Strip and rewrite the source comments.** Delete about 80% of the doc
   comments and banner rules, and every comment that narrates a design rule
   or architecture across files. Keep a few blunt *why* notes
   (cache-busting, prune-table sharing) in a human voice. Inline the short
   UI strings and remove `captions.js`, or keep it only for the help text;
   fix the dead and stale keys while doing it.
2. **Rework the main screen's empty space and the suggestion rows.**
   Shrink the solution editor to its content; show more candidates, with
   the kind written inline next to the alg (cuber-style), and drop the left
   stripe and the far-right label; fill or collapse the dead areas,
   including the case dialog's empty left column.
3. **Make the controls and terms consistent.** One header vocabulary and
   one place for the theme; flat buttons for secondary actions, the bevel
   only for the primary ones (Critique, Start solving); "XCross/XXCross"
   everywhere; fix "Dot Case"; label the gauge segments properly.

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
- Fonts: none loaded; the system's Verdana and Georgia.
- Interface references: `UI_references/` (screenshots and third-party art the
  developer collected as the design brief; kept on the developer's machine
  only, git-ignored and not in the public repository).
- Other code (DAG generator, UI, cube renderer, scoring plumbing) was
  written with AI assistance.
