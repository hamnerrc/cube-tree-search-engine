# cube⑂tree — Project Status (Working Document)

*Last updated 2026-10-04.*

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

## Quick orientation (read this first if you're new to the session)

**Current state:** the core interactive solver loop works end-to-end (pseudo F2L included as of the sixth pass below; slow) and is
verified — both in a Node harness driving the real WASM solver and physically
checked with a real cube simulator (`magiccube`) — for matched (non-pseudo)
Cross/XCross/XXCross/XXXCross plus later single-pair/multislot steps. **Luck
filtering is now implemented and verified** (see §4.3/§4.9/§4.12 below) — the
last of the "core loop" checklist items in §5 step 3 that was still open.

**2026-10-04 (second pass, same day): luck filtering implemented, and a
second, more serious bug discovered and fixed while verifying it — see §4.12
for the full writeup.** Summary:
1. **Luck filtering (§4.3) is now implemented**, resolving the open gap from
   §4.9 (the reverted solver-probe attempt). New files
   [facelet-cube.js](cube_tree_website/facelet-cube.js) (a plain-JS 54-facelet
   cube simulator, cross-verified bit-for-bit against `magiccube` for 328
   cases — see [test/facelet-cube.test.js](cube_tree_website/test/facelet-cube.test.js))
   and [facelet-flags.js](cube_tree_website/facelet-flags.js) (a JS port of
   `archived_attempts/try_1/utils/CFOPflags.py`'s facelet-mask slot check)
   give `searchCurrentNode` a real cube-state check: replay
   `[scramble, rotation, priorPath, coreAlg]` as literal moves and compare the
   resulting solved slots against exactly what the edge claims. A candidate
   that solves more than claimed is discarded (luck, per spec); one that
   solves less is also discarded, with a console warning (a solver/DAG bug,
   not luck).
2. **While verifying this against the real solver end-to-end, found a second,
   independent, more serious bug**: a later-step DAG edge (from `tree_gen.py`'s
   mid-solve y/y' exploration, previously known only as a *duplicate-edge*
   source — see §4.10 bug 2) can land on a target whose claimed solved
   corners/edges are **not a superset** of the current node's — i.e. the edge
   silently drops an already-committed slot's label (renamed by the
   relabeling instead of carried forward). `searchCurrentNode` had no
   mechanism to apply the implied second rotation, so it dispatched these
   edges using the solver class/slots implied by the (wrong) dropped label,
   which doesn't protect the real already-committed piece. **Verified
   directly against the real WASM solver + a real facelet replay: 26 of 86
   otherwise-normal-looking "Single pair" candidates disturbed an
   already-committed pair 100% of the time, with no error and a perfectly
   ordinary-looking label.** This predates luck filtering, is independent of
   it, and luck filtering's own check cannot catch it (the wrong claim and
   the real outcome agree the dropped slot isn't solved, so nothing looks
   wrong from that check's point of view). Fixed by filtering out, for any
   non-root search, every outgoing edge whose target doesn't preserve every
   corner/edge already solved at the current node — see §4.12.
3. A **third, related but lower-severity finding**: even after fix #2, a
   later-step edge from this same mid-solve-rotation family can still pass
   the superset check (the full target label set is correct) while its own
   per-edge "newly solved" display label is wrong (e.g. shows `BR` when the
   piece actually newly solved is `BL`) — confirmed cosmetic only (the
   candidate's `targetNodeId`, and therefore dispatch and the final solve,
   stay correct; only the UI-facing "corners"/"edges" column can be
   mislabeled). This is the non-root analogue of the already-documented
   §4.11 finding.

**2026-10-04 (third pass, same day): §4.11 and finding #3 above are now
FIXED, and fixing them surfaced a fourth bug — this one inside luck
filtering itself, caught before it was ever exercised against a
non-trivial checkbox configuration.** Full writeup in §4.12's final
section. Summary:
4. The root (§4.11) and non-root (finding #3) display-label mismatches are
   fixed: a `y`/`y2`/`y'` rotation cycles F2L slot names through a fixed,
   empirically-derived order (`relabelSlotsForRotation`, derived the same
   "never hand-derive" way as every other rotation fact in this document —
   four different trigger algorithms, all agreeing, and matching §4.11's own
   prior data point exactly). Non-root display now uses a simpler, more
   robust fix needing no rotation algebra at all: the set difference
   between the target's full (already-trustworthy) claim and the current
   node's own corners/edges.
5. **While wiring the root fix in, found that `checkCandidateAgainstRealCubeState`
   (the luck check itself) had been comparing every root candidate's real
   outcome against the UNROTATED label** — meaning it would have wrongly
   discarded 3 of every 4 rotation variants of any XCross/XXCross/XXXCross
   result as a "solver/DAG bug" (the exact opposite of what luck filtering
   is for). This went undetected because this session's own smoke-test
   verification of luck filtering used `advanced: []` (XCross never ran).
   Re-running with `advanced: ['xcross']` surfaced hundreds of false
   warnings immediately; fixed by feeding the luck check the same
   rotation-corrected claim used for display. XCross candidate count went
   79 → 316 (≈4×) after the fix, with zero false warnings and zero
   label/replay mismatches.

**2026-10-04 (fourth pass, same day): Cross optimisation (README "Wide
moves and Cross optimisation") implemented — the last unimplemented item
from §0's original spec-alignment review.** Full writeup in §4.13. Summary:
6. New [cross-optimization.js](cube_tree_website/cross-optimization.js)
   explores rewriting a Cross solution's `L`/`R`/`D` (and primes/doubles,
   `D2` excluded) moves into wide-move form, tracking the cumulative
   rotation each substitution implies and keeping only combinations that
   leave cross on the bottom face. Both the six README equivalences and
   the move-relabeling rule they require were verified against
   `magiccube`/brute-force search, not hand-derived.
7. **Deliberately deviates from the README's literal `u = D + y` notation**
   — the real solver engine's own `"u"` means conventional wide-U, not
   wide-D (confirmed by reading `solver.cpp`'s axis-grouping table); using
   the README's literal letter would have silently corrupted any later
   step once a Cross-optimised result got committed. Uses `d`/`d'` instead
   (same underlying equivalence, different output letter) — see §4.13 for
   the full justification.
8. **Two integration bugs were found and fixed while verifying this
   end-to-end against the real solver**, both invisible from isolated unit
   tests: (a) the reported residual rotation was wrongly also prepended as
   a *leading* rotation for the safety-net luck check, when it's actually
   a *trailing* one — produced dozens of false "not actually solved"
   discards per scramble until fixed; (b) wide-move text in a committed
   path crashed every later step's own luck check, since
   `applyAlgorithm`/facelet-cube.js has no notion of wide moves by design —
   fixed centrally inside `checkCandidateAgainstRealCubeState` so every
   future caller is protected, not just the one call site that first hit
   it. Verified across 4 real scrambles: a cross-optimised result was the
   single top-ranked Cross candidate in 3 of 4, and a full 5-step solve
   chain reached independently-verified completion.

**2026-10-04 (sixth pass, same day): pseudo F2L dispatch is now wired up and
verified. The "unreliable pseudoCrossSolver" finding recorded earlier today
was a misreading and is retracted** — full writeup in §4.14. Summary:
9. **Root cause:** `pseudo.cpp` guarantees cross + targeted corners/edges
   solved only *up to one free trailing D turn* (D/D2/D' brings them all home
   at once). The earlier probes replayed results without it, so cross and the
   corner looked broken. With the right D, 96/96 results across 6 colors were
   exact under real facelet replay.
10. **Wired up:** `alignPseudoAlg` (merges the aligning D into the committed
    alg, "Design A": the committed path stays physically exact, at the cost of
    that D counting toward TPP), `pseudoCallFor`, pseudo dispatch in
    `searchCurrentNode` (needs a pseudo helper; max 3 pairs), a generalised
    luck check (`claimedEdges`, per-piece `cornerAt`/`edgeAt`), post-alignment
    dedupe, `ensurePseudoHelper()` in `solver-ui.js` (lazy), the helper script
    tag in `solver.html`, and a "(pseudo)" type label.
11. **Verified** with new unit tests (real pseudo fixture) and the new slow
    real-WASM harness `test/solver-bridge-e2e.js` (full sessions, independent
    replay; see §4.14). **Known gap: speed** -- pseudo tables are rebuilt on
    every call, 15-80 s per root step in Node; pseudo stays off by default.
12. **Browser-only bug found while verifying in the browser, present since luck
    filtering landed:** `facelet-cube.js` and `facelet-flags.js` both declared a
    top-level `const FACE_ORDER`; plain `<script>` tags share one global scope,
    so `facelet-flags.js` failed to load and every search died with
    `solvedFlags is not defined`. Node tests can't see this (per-file module
    scope). Fixed (renamed to `FLAGS_FACE_ORDER`) and guarded by the new
    `test/browser-globals.test.js` (static duplicate-top-level-declaration check
    over each page's script list). Lesson: browser-verify after any change to
    the script set, the Node harness is not sufficient.
13. Earlier same-day infrastructure still stands: `facelet-flags.js`
    `CORNER_MASKS`/`EDGE_MASKS`/`pseudoSolvedFlags()` (per-piece masks,
    verified against 2000 magiccube cases) and the Promise helpers
    `pseudoCrossSolver/solver-helper(-node).js`.

**2026-10-04 (seventh pass, same day): full vs. simplified pseudo, random-state
scrambles, and a serious rotated-root frame bug found by browser verification.**
Full writeups in §4.15-§4.17. Summary:
14. **Full pseudo + "simplified pseudo" checkbox (§4.15).** `tree_gen.py` now
    emits a superset DAG (same 238 nodes, 6425 edges) where each edge carries
    `full_pseudo_only`; `pruneGraph` drops those when the new
    `simplified_pseudo` checkbox (index.html) is on. Verified that the
    simplified-filtered graph is exactly the old DAG as the bridge sees it,
    and with real-WASM sessions in both modes (full mode: 6/6 sessions solved,
    10 full-pseudo-only steps, 0 warnings).
15. **Bug (§4.16), present since luck filtering/§4.11's relabel fix:** a
    root candidate from a y/y2/y' `altAlgs` variant committed the
    *unrotated* DAG node, so every later step read slot labels in the wrong
    frame. On one scramble 26 of 501 later-step candidates physically broke
    the committed pair while passing the luck check, and 46 showed the wrong
    slot name. Earlier "verified" runs missed it because their checks only
    compared candidates against their own (wrong-frame) claims. Fixed
    (`rootTargetByLabels`); the e2e harness now checks node-vs-physical
    state after every commit and every offered candidate (proven to fail on
    the pre-fix code).
16. **Random-state scrambles (§4.17):** new `random-state-scramble.js`
    (two-phase solver, cubie model derived from `facelet-cube.js`), used by
    "Generate Scrambles"; cross-checked against Python `kociemba`.
17. **Results cache + a pre-existing concurrency bug (§4.18):** switching
    scrambles mid-search made the new scramble's search fail outright
    ("Another solve is in progress" per solver call → "No results"). Searches
    are now queued, and each session caches its current step's results, so
    navigating back is instant.
18. Headless-Chrome verification over CDP works here without any browser
    extension (`/Applications/Google Chrome.app`, `--headless=new
    --remote-debugging-port`, Node's global WebSocket); see §4.16.

**2026-10-04 (first pass): the developer note below ("later steps don't generate valid
solutions, and all searches create many duplicate solutions") was
investigated, root-caused, fixed, and verified — see §4.10 for the full
writeup.** Both root causes were real bugs in `solver-bridge.js`
(`searchCurrentNode`), not in the DAG data or the WASM solver itself:
1. A later-step search pasted the already-rotated committed path text
   (`session.scoredPath`) into a fresh `scramble` string and passed
   `rotation` again, double-applying the rotation relabel. Verified with
   `magiccube`: this silently broke cross by the second committed step on
   every path whose rotation was non-empty (every color except yellow).
   Fixed by using the solver's own `postAlg` option instead.
2. `tree_gen.py` generates fully-redundant edges (same real action, same
   solved-corners/edges outcome) both via a mid-solve y/y' setup rotation at
   every cross-solved node, and via `permutations(edges)` for any
   `pair_size>=2` transition (the permutation never affects which pieces end
   up solved). Fixed by deduping `outgoingEdges()` by the target's solved
   corners/edges before searching, in `searchCurrentNode` — no DAG
   regeneration needed.

(Historical note, superseded by the above: the "verified working" claim in
earlier revisions of this document was based on Node/browser candidate-count
*agreement*, which only proves the two environments run the same code
identically — it never checked the committed path against a real cube
simulator, which is what actually caught this.)

A separate, narrower, **not yet fixed** cosmetic finding surfaced during the
same investigation — see §4.11: for a distance-1 XCross/XXCross/XXXCross
result, the "corners"/"edges" columns don't account for which `altAlgs`
rotation variant was picked, so a non-identity (y/y2/y') variant can display
the wrong slot name even though the underlying DAG bookkeeping (and thus the
actual solve) stays correct. Lower priority than the two fixes above since it
doesn't produce an invalid solve — just a potentially-mislabeled display.

Full test suite (9 fast suites) passes; run them before and after any change:

```
python3 cube_tree_website/test_tree_gen.py
node cube_tree_website/test/script.test.js
node cube_tree_website/test/solver-bridge.test.js
node cube_tree_website/test/facelet-cube.test.js
node cube_tree_website/test/cross-optimization.test.js
node cube_tree_website/test/browser-globals.test.js
node cube_tree_website/test/random-state-scramble.test.js
node cube_tree_website/crossSolver/test/slot-mapping.test.js   # slow-ish, hits real WASM
node cube_tree_website/crossSolver/test/color-orientation.test.js  # slow-ish, hits real WASM
# very slow (minutes; real WASM, full sessions, independent replay; exit!=0 on any bug):
node cube_tree_website/test/solver-bridge-e2e.js --pseudo --scrambles 2 --seed 1
#   --pick full exercises full-pseudo-only transitions; --simplified tests that mode;
#   use several --colors so y-variant root commits (§4.16) are covered
```

A good smoke test after touching `solver-bridge.js`: scramble
`R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2`, colors=`['white']`,
advanced=`[]`. As of the §4.12 fixes, expect **80 candidates at step 1, 80 at
step 2, 60 at step 3** (step 1/2 unchanged from the §4.10 baseline; step 3
dropped from 120 to 60 — 34 removed as luck-filtered over-solves, 26 removed
as the §4.12 superset-safety fix — both confirmed, not just counted, by
replaying the full committed path through `facelet-cube.js`/`facelet-flags.js`
and checking every claimed slot against the real resulting cube state). The
full chain for this scramble reaches a genuine, independently-verified
complete Cross+F2L solve in 5 steps (Cross + 4 single pairs). With
`advanced: ['cross_opt']` also enabled on this same scramble, step 1 gains
9 additional cross-optimised candidates (89 total) — all independently
verified to still solve cross — though for this specific scramble the plain
(unconverted) result still happens to win on TPP; see §4.13 for scrambles
where the optimised variant wins outright.

**Reasonable next tasks (as of the seventh pass):**
1. Pseudo performance (§5 step 4): persistent pseudo tables need `emcc`
   (not installed; installing a toolchain is the user's call), or a
   stopgap such as a per-step pseudo candidate cap. Full pseudo makes this
   worse: a root step is ~20-30 s per colour in Node.
2. Limited look-ahead (README; explicitly optional).

Everything else from the original §0 spec-alignment review is now
implemented and verified: luck filtering (§4.3/§4.12), the §4.11/§4.12
display-label findings (`relabelSlotsForRotation` + the non-root
set-difference fix), and Cross optimisation (§4.5/§4.13). If any of these
ever regress (label/replay mismatches, a candidate that doesn't solve what
it claims, etc.), re-derive/re-verify the same way each was built — real
DAG + real solver + `facelet-cube.js`/`facelet-flags.js` — never by
re-deriving rotation algebra by hand.

**Traps already discovered the hard way — don't rediscover these:**

- A root candidate's committed node must be the one labelled with what it
  *physically* solves after its full rotation (including the altAlgs y
  token), not the unrotated DAG target (§4.16). Any check that compares a
  candidate only against its own claim cannot see a wrong-frame node; check
  the session node against the physical cube.

- `pseudoCrossSolver` results are solved only *up to one free trailing D turn*
  (§4.14). Never replay or commit a raw pseudo result; run it through
  `alignPseudoAlg` first. Do not conclude the solver is "unreliable" from a
  replay that skipped this.
- A whole-cube rotation must go through the solver's `rotation` *option* on
  every call. Embedding it as a literal move in the `scramble` string
  silently corrupts parsing (§4.7 area / `solver-bridge.js` header comment).
- A later-step search must include every already-solved slot in its own
  goal (dispatch via the solver class matching *total* pairs needed, not
  just new ones), or it silently disturbs committed pairs about half the
  time (§4.7).
- Never paste the committed path-so-far into a fresh `scramble` string for a
  later-step call, even though it's plain text that looks like it'd
  concatenate fine. It's already expressed in the rotated frame the engine
  returned it in; passing `rotation` again on top of that double-relabels it
  and searches a bogus state. Use the engine's own `postAlg` option instead
  — verified with a real cube simulator, not just by re-reading the C++, see
  §4.10.
- A cross-solved (later-step) DAG node's outgoing edges are not 1:1 with
  real actions — `tree_gen.py` emits redundant edges for the same action
  (same target solved-corners/edges) via both a mid-solve y/y' setup
  rotation explored at every cross-solved node, and `permutations(edges)`
  for any 2+-pair transition. Dedupe by the target's solved corners/edges
  before searching (§4.10).
- A later step's move-limit must scale with total pairs in goal, not stay
  flat at the spec's "single pair=10/multislot=12" (§4.8).
- The same mid-solve y/y' exploration that causes the duplicate-edge trap
  above can ALSO produce a later-step target whose claimed solved
  corners/edges are not a superset of the current node's — i.e. it silently
  drops an already-committed slot's label instead of carrying it forward.
  Taking such an edge at face value lets the solver disturb a real,
  already-committed pair with no error. Filter out any non-root edge whose
  target doesn't preserve every corner/edge already solved at the current
  node, before searching (§4.12).
- A real cube-state check (facelet simulation + the CFOPflags-style mask
  check) is the only reliable way to verify which pieces a result *actually*
  solves — a solver probe is not (§4.9), and neither is trusting the DAG's
  own labels at face value (§4.12). `facelet-cube.js` must be
  cross-verified against `magiccube`, not hand-derived — see
  test/facelet-cube.test.js for the method (derive each base move's facelet
  permutation from many random before/after pairs, then verify independently).
- "0 `onProgress` events" from the solver does **not** reliably mean
  "already solved" — it's ambiguous whenever the call's `maxLength` is
  shorter than the true solution depth (IDA* silently skips announcing
  depths it can prove infeasible). Only trust this signal when `maxLength`
  is generous relative to the case being tested (§4.9).
- Browser HTTP caching in this dev setup (`python3 -m http.server`) is
  aggressive with no `Cache-Control` header. `script.js`/`solver-bridge.js`/
  `solver-ui.js` are loaded with a `?v=` cache-busting query string from
  `solver.html`/`index.html` — bump it if edits don't seem to take effect in
  the browser. `crossSolver/solver-helper.js` deliberately does **not** get
  one (breaks its self-path detection) — see §5 step 3's "Incidental fix"
  note.
- This repo has no `LICENSE` file and the vendored solver code is GPL-3.0
  (§6) — don't add one or make redistribution decisions without the user.

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
| Abstract F2L DAG (unsolved → full Cross+F2L) | **Done, verified.** 238 nodes / 6425 edges (2393 without the full-pseudo-only edges added in §4.15), see §1.1. |
| Multi-step click-to-commit interactive loop | **Working, verified in-browser** for matched (non-pseudo) Cross/XCross/XXCross/XXXCross + later single-pair/multislot. See §5 step 3. |
| TPP ranking over the cumulative path | **Working, verified.** See §5 step 3. |
| Luck filtering | **Done, verified.** A solver-probe approach was tried first and reverted as unreliable (§4.9); the real fix is a facelet-based real cube-state check (§4.12). |
| Simplified pseudo vs. full pseudo as distinct modes | **Done (2026-10-04, seventh pass).** Superset DAG with a per-edge `full_pseudo_only` flag; "simplified pseudo" checkbox filters it in `pruneGraph`. See §4.15. |
| Procedural (distance-1-only) inspection rotations | **Working, verified** — `altAlgs` now correctly scoped to distance-1 only. See §4.4/§5 step 3. |
| Cross optimisation (wide-move post-processing) | **Done, verified.** See §4.5/§4.13. One deliberate deviation from the README's literal notation (uses `d`/`d'`, not `u`/`u'`, for the D-layer wide move — see §4.13). |
| Search limits matching the spec's table | **Working, verified** — see §4.6/§4.8 for the one place this needed to extend beyond the spec's literal numbers (later steps scale by total pairs, not a flat per-category number). |
| WASM scramble search (matched + pseudo) | Matched: **integrated and verified end-to-end in the browser.** Pseudo: **wired in and verified** (§4.14), but slow (tables rebuilt per call). |

**Bottom line:** the core interactive loop — the thing that was entirely
missing before — now works end-to-end in the actual browser for the
non-pseudo subset of the product, verified against both a Node harness and
a live click-through session with matching results, and now also with luck
filtering (§4.12) protecting every result against over-solving, silently
disturbing an already-committed pair, and (both found and fixed in the same
investigation) a mislabeled "corners"/"edges" display column, and now also
with Cross optimisation (§4.13) offering wide-move rewrites of Cross
results where they genuinely score better. The remaining gaps are specific
and bounded: pseudo dispatch, simplified-pseudo DAG support, multi-scramble
verification, and the Xxxxcross cold-start latency.

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
   — **ported, 2026-10-04, see §4.12.** Takes a 54-character Kociemba-style
   facelet string and, via fixed bitmasks, returns `[cross, bl, br, fl, fr]`
   solved flags by comparing facelets to their face centers. This was
   confirmed to be the right prerequisite for luck filtering (a solver-probe
   approach was tried first and found unreliable, §4.9) and is now ported as
   [facelet-flags.js](cube_tree_website/facelet-flags.js), operating on a
   purpose-built JS facelet simulator ([facelet-cube.js](cube_tree_website/facelet-cube.js))
   rather than `try_4/cubestate_encoder.py`'s `magiccube`-wrapping approach
   (item 4 below) — a self-contained JS simulator avoids a Python
   dependency in the browser-facing code path; `magiccube` was still used,
   at build/verification time only, as the ground truth to derive and
   cross-check `facelet-cube.js`'s move tables.

4. **Cube-state simulation plumbing — [`try_4/cubestate_encoder.py`](archived_attempts/try_4/cubestate_encoder.py)**
   Not ported directly (see item 3 above — a native JS simulator was built
   instead, since the browser-facing code can't depend on Python/`magiccube`
   at runtime), but `magiccube` itself (the library this file wraps) was
   used as the empirical ground truth to derive and verify `facelet-cube.js`'s
   move tables (`gen_facelet_fixture.py`), matching this item's original
   relevance to luck filtering. Note: as checked out, this file's
   `GRAPHML_PATH` is broken (points at a path one directory off from where
   the file actually lives under `try_3/data/`); not relevant to the path
   actually taken, but still broken if anyone reuses this file directly.

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

### 4.1 FIXED (2026-10-04): DAG only supported simplified pseudo (answers spec open question #1) — see §4.15

**Resolved via option (b) below — see §4.15.** Kept as the original finding.

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

### 4.3 FIXED (2026-10-04): no luck filtering existed — see §4.12

**Resolved — see §4.12 for the full implementation writeup.** The
description below is kept as the original problem statement.

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

### 4.5 FIXED (2026-10-04): Cross optimisation / wide-move post-processing now exists

**Implemented and verified — see §4.13 for the full writeup.** Kept below
as the original problem statement.

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

### 4.9 Luck filtering attempt #1: a solver-probe implementation was attempted and reverted — it was unreliable, not just slow

**Superseded — the real fix (a facelet-based cube-state check, not a solver
probe) is in §4.12, implemented and verified 2026-10-04.** Kept below as-is:
it's the reason the §4.12 implementation uses a real cube simulator instead
of another probe variant, and the failure mode here is still worth knowing.

Implemented, tested, and **reverted** on 2026-10-03. Worth recording in
detail because the failure mode is subtle and would be easy to
reintroduce.

**What was built:** for each candidate solution, probe every slot *not* in
the edge's own goal via a cheap `solveXcross(..., { maxLength: 1 })` call,
treating "0 `onProgress` (depth) events" as "already solved" — the exact
technique this document's own verified findings (slot mapping, color
orientation, §4.7) are built on, which all worked correctly when tested.

**What went wrong:** that technique is only valid when the probe's
`maxLength` comfortably exceeds the *true* solution depth for the
"needs search" case. IDA* with an admissible prune-table heuristic skips
announcing depths it can already prove infeasible (observed directly:
requesting `maxLength: 6` for a case whose real minimum depth was 7
produced **zero** `onProgress` events and an empty solution array —
indistinguishable from "already solved" from the outside — while
`maxLength: 11` on the identical call correctly found it, with progress
events starting at depth 7, not 0). Every earlier validated use of this
technique happened to use short, specifically-constructed test scrambles
(e.g. a single face turn, or the "sexy move" from a solved cube) where the
true "needs search" depth was always comfortably under the chosen
`maxLength` — so the ambiguity never triggered. A `maxLength: 1` luck-probe
against a real ~19-move WCA-style scramble is the opposite case: almost
any genuinely-unsolved slot has a true depth far above 1, so the probe
returned false "already solved" positives almost universally, making
nearly every real candidate look "lucky" and get discarded — confirmed
directly: on two different real scrambles, Cross, XCross, *and* XXCross
categories all returned **zero** surviving candidates, and spot-checking
individual "lucky" verdicts against a directly-run, adequately-deep search
showed the slot was genuinely not yet solved.

Separately (not the reason for reverting, but relevant to any future
attempt): even a *correct* version of this probe would need a `maxLength`
comparable to a real search of that category to avoid the ambiguity above,
which is expensive — for a Cross-only search (0 goal slots), that's up to
4 near-full-cost probes per candidate, across potentially dozens of unique
candidates.

**Conclusion:** solver probes are the wrong tool for luck filtering. The
reliable path is a real cube-state check — exactly what §2 items 3–4
(`CFOPflags.py`'s facelet-mask logic, ported to JS) were already flagged
for, now with concrete evidence for *why* the solver-probe shortcut doesn't
work rather than just "it wasn't built yet." Luck filtering remains
unimplemented; `solver-bridge.js` currently returns every raw (deduped)
candidate, including any that may over-solve. The rest of the loop
(dispatch, TPP scoring, commit, rotation handling) is unaffected and still
verified correct — this was caught and fully reverted before being
shipped as a silent correctness bug, not left half-working.

### 4.10 FIXED (2026-10-04): later-step searches produced invalid solutions, and every search showed duplicate rows

A developer note left in this document's previous revision flagged two
problems found by actually trying the tool: "the later single pairs and/or
multislots do not generate valid solutions, and all searches create many
duplicate solutions." Both were investigated end-to-end against the real
DAG and real `solver.wasm` (not mocked), and physically verified against a
real cube simulator (`magiccube`, via `pip`) rather than just re-reading the
code — the same "verify empirically" discipline §4.9/§1.2 already
established for this codebase. Both root causes were in
`solver-bridge.js`'s `searchCurrentNode`, not in the DAG or the solver.

**Bug 1 — invalid later-step solutions.** `searchCurrentNode` built a
later-step `scramble` by string-concatenating `session.scramble` with
`session.scoredPath` (the committed path so far), then passed `rotation:
session.rotation` to the solver call — the exact same pattern used
correctly for the very first call. The difference: `session.scoredPath` is
*already* text in the rotated frame the engine returned it in (per this
file's own header comment: raw solver output is `rotation + ' ' +
solution`, and the stored `coreAlg` is that `solution` with the rotation
prefix stripped — i.e. it's meant to be executed *after* physically doing
`rotation`, using that rotation's face labels). Pasting it into a fresh
`scramble` argument and passing `rotation` *again* makes the engine's
`AlgRotation` relabel it a second time — searching a bogus state that has
nothing to do with the real cube.

Verified directly: built a session for the documented smoke-test scramble
(white, no advanced options — a non-empty rotation, `z2`), ran step 1
(Cross) and step 2 (single pair) against the real solver, then took the
literal committed `scramble + rotation + stepAlgs` text the *old* code would
have executed and ran it through `magiccube`. Cross was solved after step 1
alone, but **broken** after step 1+2 together — on every single trial, for
every color except yellow (whose rotation is `''`, making the double-relabel
a no-op, which is almost certainly why this went unnoticed: plain-white
testing with the specific documented smoke scramble is the one case where
the bug is live).

**Fix:** pass the committed path via the solver's own `postAlg` option
instead of folding it into `scramble`. Reading `solver.cpp`'s
`start_search`/`start_search_persistent`: `post_alg`'s moves are applied
*directly*, continuing from wherever the (correctly-once-rotated) `scramble`
left the search coordinates — i.e. `postAlg` is interpreted in exactly the
already-rotated frame `session.scoredPath` is already expressed in, with no
further relabeling. `scramble` for a later-step call is now always
`session.scramble` unchanged; `postAlg` carries `session.scoredPath`. The
returned-solution prefix to strip changed to match: the engine emits
`rotation + ' ' + postAlg + ' ' + newSolution`, so the known prefix to strip
is now `[baseRotation, postAlgForCall].filter(Boolean).join(' ')`, not just
`baseRotation`. Re-verified the same way: cross (and each subsequently
claimed pair) stays physically solved after every committed step, including
a 3-step single-pair chain and a separate xcross→single-pair→multislot chain
that reaches full Cross+F2L completion (`isComplete: true`), both confirmed
against `magiccube` by color-identity (not just "a slot is occupied" —
actual corner+edge orientation/match).

**Bug 2 — duplicate rows.** Confirmed two independent, fully-redundant
sources of DAG edges, both in `tree_gen.py`:
1. `build_f2l_dag()` sets `rotations = ("-", "y", "y'")` whenever
   `is_cross_solved` is true — i.e. at *every* later-step node, not just a
   root-level color choice. This produces up to 3 edges per node that
   `extract_solved_slots()` labels identically (same `corners`/`edges`
   arrays), because that function only reports *which* pieces are solved,
   never which unsolved pieces got relabeled by the internal rot tag — the
   only thing that differs between the 3 copies.
2. `generate_pair_transitions()` loops `for edge_perm in
   permutations(edges)` for any `pair_size >= 2`, but `solve_pieces()` marks
   pieces solved by set membership (`for edge in solved_edges: ...`), never
   by position in that tuple — so every permutation of a given edge
   selection produces the exact same `next_state`. This duplicates every
   XXCross/XXXCross root edge and every multislot later-step edge by `N!`
   (2x for a pair, 6x for a triple).

Confirmed by instrumented count: a later-step node with 4 real actions
(single-pair to each of 4 slots) exposed 12 DAG edges; all 80 resulting
candidates (20 raw solver results × 4 slots) appeared in the table *exactly
3 times each* (240 total rows) — the `rotations=("-","y","y'")` tripling,
not the `permutations` one (pair_size=1 has only one trivial permutation).
A separate run with XXCross+multislotting enabled showed both effects (root
XXCross edges doubled by `permutations`, later multislot edges tripled by
the rot tag).

**Fix:** `searchCurrentNode` now dedupes `outgoingEdges()` by
`JSON.stringify([sortedCorners, sortedEdges])` of each edge's *target* node
before dispatching, for both root and non-root nodes. This is safe because
dispatch here is a pure function of the target's solved corners/edges (plus
session state) — any two edges that agree on that key are, by construction,
indistinguishable to this file regardless of *why* the DAG has both. No
`tree_gen.py` change or DAG regeneration was needed (lower risk: avoids
re-validating the committed 238-node/2393-edge baseline cited throughout
this document). Re-ran the smoke-test scramble: step 2 candidates went from
240 → 80 with zero duplicate `(alg, corners, edges, rotation)` keys (was 80
unique keys each appearing exactly 3×); step 3 went from 180 → 120, also
zero duplicates. The multislot scenario's step 1 went from 1360 → 880 (the
`permutations` 2x, confirmed by the exact halving), also zero duplicates
after the fix.

Both fixes are covered by existing unit tests passing unchanged (dedup and
`postAlg` logic don't touch anything `test/solver-bridge.test.js` already
pins down) — there is deliberately no *new* unit test added here, since the
actual bugs were only reachable by driving the real WASM solver end-to-end
and checking physical cube state, which is far too slow for a unit suite;
the Node diagnostic script used for this investigation was scratch, not
committed. If this area regresses again, re-verify the same way (real DAG +
real solver + `magiccube`), not by reasoning about the rotation algebra by
hand — see §4.11 for why that's a trap.

### 4.11 FIXED (2026-10-04): a distance-1 rotation-variant result could display the wrong slot name

**Fixed — see §4.12's final section for the implementation
(`relabelSlotsForRotation`) and the empirical derivation.** Kept below as
the original finding.

Found while verifying §4.10's fix, and *not* one of the two bugs the
developer note flagged — recorded separately because it's lower severity
(display-only, confirmed not to corrupt the actual solve) and because
fixing it correctly needs the same empirical rigor §4.9/§1.2 already had to
learn the hard way for this exact kind of rotation-algebra question.

**What's suspected:** for a distance-1 XCross/XXCross/XXXCross result
(`pairCount >= 1`), `searchCurrentNode` reads `newCorners`/`newEdges` once
per edge (the DAG's fixed label for that edge, e.g. `["FR"]`) and reuses it
for *every* `altAlgs` rotation variant of that edge's found algorithm,
without adjusting for which variant it is. Observed directly: in a session
with XCross enabled, the top-ranked (by TPP) distance-1 result was an
altAlgs `y'` variant labeled `corners: ["FR"]`, with `candidate.rotation`
(the full, composed setup rotation the user is told to perform) set to
include that `y'`. Replaying `scramble + rotation + coreAlg` for exactly
that result in `magiccube` and checking which physical slot ends up
genuinely paired (by color identity, not just "something is there") found
**BR** solved, not **FR**.

**Why this needs care, not a quick fix:** `candidate.targetNodeId` is always
the DAG edge's real target (set directly from `edge.target`, never derived
from the algorithm text), so the *session's* belief about which abstract
DAG node it's at — and therefore every subsequent search's dispatch — stays
internally consistent regardless of this. This looks like a display-only
bug (the "corners"/"edges" table columns, and the physical slot a human
would actually observe themselves solving, can disagree for a
non-identity-variant distance-1 result with `pairCount >= 1`), not a
solve-correctness one — unlike §4.10's bugs, this was not observed to
produce an invalid final state in either verification run. It's being
recorded rather than fixed now because the correct fix requires relabeling
`newCorners`/`newEdges` by the *same* rotation `altAlgs` applied to the
algorithm text — i.e. porting a slot-name analogue of `altAlgs`'s
`FACE_MAP`, a second piece of rotation algebra alongside the move-letter one
that already exists. Given this project's own track record on exactly this
kind of reasoning (§1.2's color/rotation finding: "verified empirically...
not just by re-deriving rotation algebra by hand, which produced a wrong
answer on the first attempt"), the right next step is a dedicated empirical
test (vary the rotation, use a real trigger algorithm, check with
`magiccube` which physical slot actually gets hit, the same method
§1.2/slot-mapping.test.js/§4.10 all used) before writing a fix, not a
hand-derived FACE_MAP-for-slot-names table. Not yet investigated further.

### 4.12 FIXED (2026-10-04): luck filtering implemented, plus a newly-discovered later-step dispatch bug found and fixed while verifying it

**Luck filtering (§4.3/§4.9) is now implemented.** Two new files:
[facelet-cube.js](cube_tree_website/facelet-cube.js) is a plain-JS 54-facelet
3×3 cube simulator (apply ordinary face turns plus whole-cube x/y/z
rotations to a Kociemba-convention facelet string). Its 9 base-generator
permutations (U/D/R/L/F/B/x/y/z) were **derived empirically against
`magiccube`**, not hand-derived — for each generator, many random scrambles
were run through both a "before" and "after" state, and for each output
position the set of input positions consistent with the observed color
transformation was intersected across trials until exactly one candidate
remained per position; every derived permutation was then independently
re-verified against 30 more random trials. The whole simulator is also
cross-checked bit-for-bit against 328 `magiccube`-generated cases (random
algorithms up to 30 moves, every single move token in isolation) in
[test/facelet-cube.test.js](cube_tree_website/test/facelet-cube.test.js) —
all match exactly. [facelet-flags.js](cube_tree_website/facelet-flags.js) is
a JS port of `archived_attempts/try_1/utils/CFOPflags.py`'s facelet-mask
slot-solved check (operating on the same facelet convention), sanity-checked
against the `R U R' U'` commutator this project's own
`crossSolver/test/slot-mapping.test.js` already established disturbs exactly
the FR pair from solved.

`solver-bridge.js`'s `checkCandidateAgainstRealCubeState` uses both: it
replays `[scramble, rotation, priorPath, coreAlg]` as literal moves (the
same replay order this file's header comment and §4.10 already established
is the correct physical reconstruction of a committed path) and compares the
resulting real solved slots against exactly what the candidate's DAG edge
claims (`allCorners`, the target's full old+new corner list) — a candidate
that solves more is discarded as luck (per spec, it belongs to a different,
higher-arity edge instead); a candidate that solves less is also discarded,
with a console warning, since that would mean the DAG/solver claim is
simply wrong. Verified on the documented smoke-test scramble: step 3's
candidate count drops from 120 (the §4.10 baseline) to 86 after luck
filtering alone, with the 34 removed candidates confirmed (via a temporary
diagnostic, not committed) to all be genuine over-solves of the committed
BR pair in an edge whose claim didn't include it.

**While verifying this end-to-end, a second, independent, and more serious
bug was found** — not a luck-filtering issue at all, but a pre-existing
later-step dispatch bug exposed by the same investigation. `tree_gen.py`'s
mid-solve y/y' exploration (§4.10 bug 2's `rotations = ("-","y","y'")` at
every cross-solved node, previously known only as a *duplicate-edge* source)
relabels ALL pieces' slot names when exploring from a rotated perspective —
including already-solved ones. For a node with, say, BR already solved, the
"y" exploration relabels that piece as "FR" (carried forward under the new
name) before selecting which additionally-unsolved piece to solve next; the
resulting target's `state.corners` genuinely does **not** contain "BR"
(e.g. `["BL", "FR"]` instead of `["BL", "BR", "FR"]`) even though the
*same physical BR piece* is still solved — it's just renamed. This differs
from the known duplicate-edge case (§4.10 bug 2) in a critical way: there,
multiple edges land on targets with *identical* labels (pure duplication,
safe to dedupe); here, a single edge lands on a target with *different,
non-superset* labels (not a duplicate of anything — a real, distinctly-named
target that silently drops a committed slot).

`searchCurrentNode` has no mechanism to apply this implied second rotation —
`session.rotation` is fixed once at the root commit and reused verbatim for
every later call (by design, per this file's header comment and §4.7/§4.10).
Taking such an edge's target labels at face value and dispatching via
`solverCallFor(helper, allCorners, ...)` therefore asks the solver to
protect the *wrong* slot (e.g. "FR", which isn't really at risk) while
leaving the *actually*-committed slot ("BR") completely unprotected —
exactly the §4.7 failure mode (an unprotected committed pair gets disturbed
close to half the time), just reached via a different, previously-unnoticed
edge class.

**Verified directly against the real WASM solver + a real facelet replay**
(not reasoned about by hand): for one committed session on the documented
smoke-test scramble (Cross, then BR as a single pair), 26 of the 86
luck-filtered step-3 candidates had a target whose full corner claim
excluded BR, and **every single one of those 26, when physically replayed,
had actually disturbed BR** — with no error, and a perfectly ordinary-looking
`type: "Single pair"` label (e.g. `corners: ["BL"]`). Luck filtering's own
check cannot catch this: both the (wrong) claim and the real outcome agree
BR isn't part of this edge, so nothing looks inconsistent from that check's
point of view. A separate, smaller investigation script run with the actual
fix in place (below) confirmed zero such candidates remain.

**Fix:** in `searchCurrentNode`, for any non-root search, filter out every
outgoing edge whose target's solved corners/edges are not a superset of the
*current* node's solved corners/edges, before the existing dedup/dispatch
logic runs. This is the direct DAG-edge-filtering analogue of §4.7's
dispatch-level fix (protect every already-committed slot), applied one level
earlier (at edge selection, not solver-call construction) because the
mislabeling here means the solver-call construction itself can't be trusted
for these edges. Re-ran the full 5-step smoke-test chain with the fix in
place: step 3 goes from 86 → 60 retained candidates (removing exactly the 26
disturbance cases, confirmed — none of the 60 remaining candidates have a
target that drops a committed slot), the chain still reaches a genuine,
independently-verified complete Cross+F2L solve (`isComplete: true`, and
separately confirmed via a full-path `facelet-cube.js`/`facelet-flags.js`
replay — `{cross: true, BL: true, BR: true, FL: true, FR: true}`), and the
top-ranked results at steps 1–2 are byte-for-byte unchanged from before
either fix (only step 3 onward, where the broken edge class exists, is
affected).

**A third, related, lower-severity finding surfaced while re-verifying the
fix, recorded but not fixed — the non-root analogue of §4.11.** Even after
the superset fix above, a later-step edge from this same mid-solve-rotation
family can still legitimately survive (its full target label set is a
correct superset) while its own per-edge "newly solved" label
(`edge.solved_step.corners`/`.edges`, shown in the UI as the result's
"corners"/"edges" columns) is wrong. Observed directly in the smoke-test's
step 5 (the "finish the last pair" step, 3 pairs already committed): the
top-ranked candidate displayed `corners: ["BR"]` — but BR was *already*
committed before this step, and the current node's state after committing
this candidate showed the new total was `["BL", "BR", "FL", "FR"]`, meaning
the piece actually newly solved was **BL**, not BR. Confirmed cosmetic only
— `allCorners`/`targetNodeId` (what dispatch and luck filtering actually
use) are correct for this edge, the superset filter above correctly allows
it through, and the final chain's independently-replayed state is fully and
correctly solved. This is the exact same class of bug as §4.11 (a rotation
applied to the underlying algorithm/state without equivalently relabeling
the *display* fields), just occurring for a non-root mid-solve-rotation edge
instead of a root `altAlgs` variant — strongly suggesting both should be
fixed together (likely the same underlying "relabel the display slot names
by whichever rotation was actually applied" fix), per the same
"verify-empirically-first" discipline §4.11 already called for.

**Update, same day: §4.11 and finding #3 above are now FIXED, and fixing
them surfaced a fourth, more serious issue in luck filtering itself — caught
before it was ever exercised against a non-trivial checkbox configuration.**
The relabeling rule was derived the same way every other rotation-algebra
fact in this document has been (never hand-derived): four different
single-pair-disturbing trigger algorithms (`R U R' U'` and its three mirror
analogues) were each expanded via `altAlgs`, and for each of the resulting
16 variants, `facelet-cube.js`/`facelet-flags.js` determined which slot was
*actually* disturbed. All four triggers agreed on the same cycle,
independent of the trigger's own original slot:
`CORNER_CYCLE = ['FR', 'FL', 'BL', 'BR']`, with a `y`/`y2`/`y'` token
advancing a slot 1/2/3 steps through that cycle. This exactly reproduces
§4.11's own prior empirical data point (claimed `FR`, `y'` variant actually
`BR`: index of `FR` is 0, `y'` is +3 steps, `CORNER_CYCLE[3]` is `BR`) — strong
independent confirmation the rule is right, not just internally consistent.
Implemented as `relabelSlotsForRotation` in `solver-bridge.js`, covered by a
self-verifying unit test in `test/solver-bridge.test.js` that re-derives and
checks the same mapping against `facelet-cube.js` rather than a hardcoded
table. For a root candidate, the display `corners`/`edges` are now this
relabeled set; for a non-root candidate (no `altAlgs`, no `yToken` — finding
#3 above), display is the set difference between the target's full claim
and the current node's own corners/edges, which needs no rotation algebra
at all.

**While wiring this in, re-examining `checkCandidateAgainstRealCubeState`'s
own call site surfaced the fourth issue: the luck check itself was built and
tested (above) using only the Cross-only/no-advanced-options smoke test,
which never exercises a root candidate with `pairCount >= 1` — so it was
never exercised against a non-identity `altAlgs` variant at all.** The luck
check was passing the *unrotated* `allCorners` label as the claim for every
candidate, root included — but per the finding above, a non-identity-rotation
root variant's real physical outcome matches the *relabeled* slot, not the
unrotated one. Left as originally written, the luck check would have
compared "physically solves `BR`" against "claims `FR`" for every such
variant and wrongly discarded it as a solver/DAG bug (the
"claimed solved but is not actually solved" branch) — silently throwing away
3 of every 4 candidate rotation variants for any root result with
`pairCount >= 1` (i.e. essentially all of XCross/XXCross/XXXCross), the
exact opposite of what luck filtering is supposed to do. **Caught before
this was ever exercised with a non-trivial checkbox configuration** — this
session's own earlier smoke-test verification (120→86→60, the §4.12 writeup
above) used `advanced: []`, so XCross never ran. Running the identical
scramble with `advanced: ['xcross']` surfaced hundreds of these false
"claimed solved but is not actually solved" warnings immediately. Fixed by
computing the claim once, correctly, as
`isRoot ? relabelSlotsForRotation(allCorners, yToken) : allCorners`, and
using that single corrected value for both the luck check and the display
label. Re-verified on the same XCross-enabled run: XCross candidate count
went from 79 (only the identity-rotation variants surviving, confirming the
bug) to 316 (≈4×, recovering the three previously-discarded rotation
variants per solution) with **zero** false "claimed but not solved"
warnings and zero display-label mismatches across all 316 when
independently replayed. Re-ran the same check with XXCross and XXXCross
also enabled (the relabeling logic applies per-slot, so it needed checking
for multi-slot claims too, not just the single-slot XCross case above):
1192 total root candidates (XCross 316, XXCross 480, XXXCross 316, Cross
80), 1112 non-Cross candidates independently replayed and checked against
their displayed claim — **zero mismatches and zero undetected over-solves**
across all of them.

Both the luck-filtering feature and the superset-safety fix are covered by
new unit tests in
[test/solver-bridge.test.js](cube_tree_website/test/solver-bridge.test.js)
(`checkCandidateAgainstRealCubeState`, using the same `R U R' U'`-commutator
methodology `crossSolver/test/slot-mapping.test.js` established) and by
[test/facelet-cube.test.js](cube_tree_website/test/facelet-cube.test.js).
The specific end-to-end real-solver investigation (counting 120→86→60,
confirming the 26 disturbances, confirming the final chain's independent
solved state) was done with scratch Node scripts, not committed — re-run the
same way (real DAG + real solver + `facelet-cube.js`/`facelet-flags.js`, or
`magiccube`) if this area regresses again.

### 4.13 DONE (2026-10-04): Cross optimisation (README "Wide moves and Cross optimisation") implemented

New file [cross-optimization.js](cube_tree_website/cross-optimization.js),
wired into `searchCurrentNode` for root, Cross-only (`pairCount === 0`)
candidates, gated by a new `cross_opt` entry in `SolveSession`'s
`advancedOptions` (4th constructor arg; `solver-ui.js` now passes
`criteria.advanced` through when creating a session). Covered by
[test/cross-optimization.test.js](cube_tree_website/test/cross-optimization.test.js).

**The core mechanism, derived and verified empirically (never hand-derived
— see §1.2/§4.9/§4.10's standing rule, which this feature needed twice
over):**

1. **The six equivalences** the README states (`r=L+x`, `r'=L'+x'`,
   `l=R+x'`, `l'=R'+x`, and the D-layer pair, discussed separately below)
   were checked against `magiccube`'s own wide-move notation (`Rw`, `Lw`,
   `Uw`) for 20 random pre-scrambles each — not assumed from the README's
   prose, and not just checked from a solved cube. All six (plus the
   doubles, `Rw2=L2x2` etc.) held exactly.
2. **The relabeling rule**: converting one move (say `L`) to its wide form
   (`r`) doesn't just drop a redundant rotation — `r` is *defined* as
   "`L` then `x`", so the substitution secretly performs an `x` rotation
   the original algorithm never accounted for. Every move after that point
   must be relabeled to keep referring to the same physical layer. Solving
   "what should I type now, given a pending rotation `rho`, to achieve what
   the original move `M` intended" required a small equation
   (`compose(rho, M') == compose(M, rho)`); the closed-form solution
   (`M' = composePerm(invertPerm(rho), composePerm(M, rho))`) was verified
   by brute-force search over all 18 face turns (not assumed), for both a
   single generator (`rho=x`) and a composed one (`rho = x then y`), and
   shown to always yield a legitimate face-turn permutation.
3. **A short inductive argument** (by construction of the relabeling above)
   shows the whole rewritten sequence is exactly equal to "the original
   algorithm, followed by the final accumulated rotation" — which is why
   the orientation filter (keep only results whose final accumulated
   rotation leaves D mapped to D) is sufficient and correct: cross was
   already solved on D by the original algorithm, and appending a pure
   y-rotation can't move it off D, while any x/z component can and does.
   `optimizeCrossSolution` explores the full `2^k` subset space (k =
   algorithm length) of which eligible moves to convert, relabeling as it
   goes, and keeps only (deduplicated) combinations that survive the
   filter.
4. **`y2` is never used as a conversion's rotation increment** — `D2`'s
   only wide form would need one, and the README explicitly forbids y2 as
   a mid-algorithm move. `D2` is simply absent from the convertible set.

**Deliberate deviation from the README's literal notation (flagged, not
silently applied):** the README writes the D-layer equivalence as
`u = D + y`. Taken literally, this collides with this project's own solver
engine — `crossSolver/solver.cpp`'s move table groups `"u"` with the
U/E/y axis (`y_axis_order = {U:0, D:1, E:2, u:3, d:4, y:5}`), i.e. the
*engine's* `"u"` means conventional wide-U (top two layers), not wide-D;
`script.js`'s `algSpeed` likewise has a separate, distinct branch for `"d"`
with its own grip logic. Using the README's literal `"u"` would mean a
Cross-optimised result, once committed, gets silently misinterpreted as a
wide-U move the moment its text is fed back into the solver as `postAlg`
for a later step (or mis-scored by `algSpeed`) — a real correctness bug,
not a style question. This implementation emits the conventionally-correct,
solver-and-algSpeed-recognized `d`/`d'` instead; the underlying equivalence
(`D+y` / `D'+y'`) is unchanged, only the output letter differs from the
README's prose. Worth the user's attention since it's a deviation from the
literal spec text, even though it's clearly a bug-avoidance fix rather than
a product decision.

**Two integration bugs were found and fixed while verifying this
end-to-end against the real solver** (not just the isolated unit tests
above) — both are exactly the kind of mistake this project's "verify
empirically" rule exists to catch, and both would have been invisible from
unit tests alone since they only manifest once a cross-optimised result is
actually committed and chained into further dispatch:

- **Bug 1 — the reported `rotation` was wrongly also used as a literal
  leading rotation for the safety-net luck check.** `opt.rotation`
  (the residual rotation `optimizeCrossSolution` reports) is a *trailing*
  rotation that accumulates *during* the algorithm from wide-move
  conversions — unlike `baseRotation` (the genuine upfront inspection
  rotation) or `altAlgs`' `yToken` (also genuinely leading, stripped from
  the front of the variant text), it must never be prepended for literal
  replay. Composing it into the leading `rotation` parameter for the
  safety-net `checkCandidateAgainstRealCubeState` call corrupted the
  replay for almost every combination — confirmed directly: re-running
  3 real scrambles with `cross_opt` enabled before this fix produced
  dozens of false "claimed solved but is not actually solved" discards per
  scramble; after the fix, zero. The reported `rotation` field itself
  (`composeRotations(baseRotation, opt.rotation)`) was and remains correct
  for *display* and for *future dispatch* (once committed, the solver's
  `rotation` option only cares about the net accumulated rotation, not
  when during execution it happened) — only the literal-replay check
  needed the fix, using plain `baseRotation` paired with the already-fully
  -expanded algorithm text instead.
- **Bug 2 — wide-move text in a committed path crashed every later step's
  own luck check.** Once a cross-optimised result is committed,
  `session.scoredPath` (the running committed-path text) contains wide
  tokens (`r`, `l`, `d`, …) — but `checkCandidateAgainstRealCubeState`
  (used by *every* later step's own luck-filtering, not just
  cross-optimised candidates) passed that text straight to
  `applyAlgorithm`, which has no notion of wide moves by design and throws
  on an unrecognized token. Confirmed directly: committing a winning
  cross-optimised Cross result and then running the next (single-pair)
  search crashed immediately. Fixed centrally, in
  `checkCandidateAgainstRealCubeState` itself (not just at the
  cross-optimisation call site), by expanding any wide-move tokens in the
  *full* replay sequence back to their literal face-move+rotation
  definition (`cross-optimization.js`'s new `expandWideMoves`) before
  calling `applyAlgorithm` — this way every future caller is protected,
  not just the one call site that happened to trigger the crash first.
  Re-verified: committing a cross-optimised Cross result, then running the
  next step, then independently replaying the *entire* committed path
  (scramble + rotation + both committed steps, wide tokens expanded) now
  correctly shows cross **and** the newly-committed pair solved, matching
  the next step's own claim exactly.

**Does it actually help?** Across 4 real scrambles tested end-to-end
(real DAG + real solver, `cross_opt` enabled), a cross-optimised variant
was the single top-ranked (lowest-TPP) Cross result for 3 of the 4 — not
just a valid-but-worse alternative sitting in the list. A full 5-step
solve chain (Cross optimised + 4 single pairs) was carried through to
`isComplete: true` and independently re-verified against the real
committed path (wide tokens expanded), confirming cross and all 4 pairs
genuinely solved.

---

### 4.14 FIXED (2026-10-04): pseudo dispatch wired up; the "unreliable solver" finding was a misreading (free trailing D turn)

An earlier pass this day attempted pseudo dispatch, saw `pseudoCrossSolver`
return "solutions" that failed real facelet replay (cross broken, targeted
corner not home, 0/5 hit rate on some slots), and recorded the engine as
unreliable. **That was wrong.** Root cause, found in the follow-up pass:

**`pseudo.cpp`'s guarantee is "cross + the targeted corners/edges are solved
UP TO ONE FREE TRAILING D TURN."** A final `D`, `D2` or `D'` brings cross,
the targeted corner(s) and the targeted edge(s) home *simultaneously* (the
D layer is rotationally free in the search's goal test). The earlier probes
replayed the raw result without that final D, so cross and the pieces looked
broken. With the right D appended, results were exact: 24/24, then 96/96
across 6 colors, checked by real facelet replay (not by the solver's own
success signal). Nothing is wrong with corner targeting.

**What a pseudo DAG node is** (from `tree_gen.py` + real generated data):
a mismatch between `state.corners` and `state.edges`, e.g. corners `[BL]`,
edges `[FR]`. 180 of 238 nodes; symmetric difference always exactly one
corner-only slot and one edge-only slot. This includes root (distance-1)
edges, so pseudo needs the same `altAlgs`/`relabelSlotsForRotation` variant
treatment as matched root edges, applied to the corner and edge claim lists
independently. `pseudo.cpp`'s `solve(scramble, rotation, slot, pslot, ...)`
takes the edge home-slots and corner home-slots as two independent sets
(BL=0,BR=1,FR=2,FL=3), 1-3 pairs, and `postAlg` behaves as in crossSolver.

**Implementation (all in `solver-bridge.js` unless noted):**
1. `alignPseudoAlg(scramble, rotation, priorPath, coreAlg)`: replays the
   result, strips a trailing D-family token, tries the 4 possible trailing D
   totals, and returns the first alg whose replay has cross solved (`''` if
   the D merge cancels the whole alg; `null` if nothing aligns, which the
   caller logs and discards). **Design A:** the aligning D is merged into
   the committed alg so the committed path is physically exact for every
   later step. The cost: that D counts toward the path's TPP (a small,
   honest penalty; the alternative of leaving the offset un-applied would
   make later steps start from a state that is not the claimed one).
2. `pseudoCallFor(...)`: calls `pseudoHelper.solvePseudo` with independent
   edge/corner slot lists, `MOVE_RESTRICT`, `postAlg` and the cumulative
   rotation passed through the solver's `rotation` option (never in the
   scramble string, per the standing traps).
3. `searchCurrentNode(session, helper, onStatus, pseudoHelper)`: pseudo
   targets are dispatched when a pseudo helper is passed and the target has
   at most 3 corners; otherwise skipped as before. Candidates are labeled
   `... (pseudo)` via `edgeTypeLabel(pairCount, isRoot, isPseudo)`, and are
   deduped by (targetNodeId, rotation, coreAlg) after alignment because two
   distinct raw results can collapse to the same aligned alg.
4. **Luck filtering generalised** (`checkCandidateAgainstRealCubeState` gained
   an optional `claimedEdges` arg; omitted means "matched", unchanged
   behavior): per-piece `cornerAt`/`edgeAt` from `pseudoSolvedFlags` must
   match the claims; a slot counts as a complete pair only if both its
   corner and edge are home; any pair solved beyond the claim is luck and
   discarded, while a lone extra corner or edge piece is tolerated.
5. `solver-ui.js`: `ensurePseudoHelper()` lazily builds a
   `PseudoSolverHelper` (wrapping the unmodified `worker3.js`) only when the
   pruned tree has pseudo nodes; failure falls back to null (pseudo skipped).
   `solver.html` loads `pseudoCrossSolver/solver-helper.js`.
6. `script.js` exports `pruneGraph` (needed by the e2e harness).

**Verification:**
- Unit tests in `test/solver-bridge.test.js` use a real pseudo fixture
  (scramble `R F2 L F' D' B2 D' L2 R' D2 U2 B L' R D' U R' D2 F R`, rotation
  `z2 y'`, alg `R' D R U2 L2`: cross + corner BL + edge FR, no pair), plus
  alignment and merge cases and the label.
- `test/solver-bridge-e2e.js` (slow, real WASM, not part of the fast suite):
  drives full `SolveSession`s on random scrambles and independently replays
  each committed path, failing on any "claimed solved but not actually
  solved" warning or a completed session that is not a physically solved
  Cross+F2L. Flags: `--pseudo`, `--advanced`, `--scrambles`, `--seed`,
  `--pick top|random`, `--colors`, `--maxsteps`. A run with pseudo produced
  fully verified solves (e.g. 4 steps, 2 of them pseudo, 0 warnings).

**Broader verification (real WASM, random scrambles, random colors, `--pick random`):**
two completed runs, 11/11 sessions solved to a physically verified Cross+F2L, 38
steps (11 pseudo), 0 warnings, 0 bad finals. **In-browser** (the same scramble
with xcross + pseudo F2L checked): 1164 candidates, ~50 s total, `worker3.js`
loads, rows labelled `XCross (pseudo)`, top row is the real fixture alg.

**Known gap, performance:** `pseudo.cpp` rebuilds its prune tables on every
call (no persistent-table variant; porting it needs `emcc`, not available
here). A pseudo root step takes roughly 15-80 s in Node (about 12 distinct solver calls of ~2-3 s each for XCross; ~50 s in the browser) (an XCross pseudo
search with ~1700 pseudo candidates measured at ~79 s). Pseudo is off by
default in the UI; making it practical needs persistent tables or a
per-step candidate cap, see §5.

### 4.15 DONE (2026-10-04): full pseudo vs. simplified pseudo

Implements §4.1 option (b). `tree_gen.py` no longer drops non-repair
transitions out of a mismatched node; it keeps them and flags each edge
`full_pseudo_only = source has a mismatch and the edge is not a pure repair
of it` (judged in the source node's own labels, which is how
`solver-bridge.js` reads an edge). `is_valid_pair_state` (at most one
mismatched slot) is now applied to every transition; that changes nothing
for the old edges and bounds the new ones. Node set unchanged (238); edges
2393 → 6425 (4296 flagged). Export is now sorted per node, so regenerating
is deterministic (it used to depend on Python's string-hash seed).

`pruneGraph` drops flagged edges when `simplified_pseudo` is checked (new
checkbox on index.html, unchecked by default like every advanced option;
it has no effect unless "pseudo F2L" is also on). No bridge change was
needed: dispatch was already a function of the target's corner/edge sets.

**Verification:**
- `test_tree_gen.py`: the flag equals its definition on every edge, and the
  simplified subgraph has no dead ends. `test/script.test.js`: pruneGraph
  cases for both modes.
- At the level the bridge actually searches (label-level edges after the
  §4.12 superset filter, reachable from the root), the simplified-filtered
  superset is *identical* to the pre-change DAG (263 transitions); full
  pseudo has 539. The matched smoke test is unchanged (80/80/60/40/20).
- Real WASM (`test/solver-bridge-e2e.js --pseudo --pick full`): full mode
  6/6 sessions physically solved, 10 full-pseudo-only steps (mismatch →
  different mismatch, mismatch + extra pairs), 0 warnings, 0 frame
  failures; `--simplified`: 2/2, and at each mismatched node the only
  offers were the 20-candidate direct repair, as specified.

### 4.16 FIXED (2026-10-04): y-variant root commits put the session in the wrong DAG frame

**Symptom (found by browser verification of §4.15):** after committing an
XCross with rotation `z2 y` that physically filled BR, every next-step row
said "BR" again. Facelet replay showed those candidates actually filled BL.

**Root cause:** a root search runs once per colour with the colour's base
rotation; `altAlgs` then derives y/y2/y' variants, and §4.11/§4.12
correctly relabels each variant's *claim* for the luck check and the
display. But the candidate's `targetNodeId` stayed the unrotated DAG
target (labels `[BL]` while BR is physically solved). After commit, every
later search ran in the physical (`session.rotation`) frame but read the
node's labels as if they were physical: wrong display (set difference of
wrong-frame labels) and, worse, wrong dispatch. A target like `{BL, FR}`
asked the solver for BL+FR without protecting the real BR pair. The luck
check passed because it compared each result against that same
wrong-frame claim. On one scramble: 46/501 candidates mislabelled, **26/501
physically broke the committed pair**.

**Fix:** `rootTargetByLabels(session, trueClaimedCorners, trueClaimedEdges)`
commits the root target whose labels equal the rotation-corrected claim
(it always exists: the root's targets are closed under relabelling). After
the fix the same scramble gives 0/516 and 0/516; step 2 offers 60 valid
candidates instead of 46.

**Why earlier verification missed it:** the smoke test commits the top
result, which happened to be an identity variant; the e2e harness only
checked luck warnings and the final state (later steps re-solve a broken
pair, so completion still verified). New harness checks: after every commit
the node's claimed corners/edges must be physically home, and every offered
candidate must keep them home. Run against the pre-fix bridge it reports
frame failures; with the fix: matched, all 6 colours, cross-opt, 8/8;
XXXCross + multislotting, 6/6; full pseudo with y-variant roots, 3/3; all 0
frame failures, 0 warnings.

Also fixed: the cross-optimisation path logged *expected* luck discards via
`console.warn`, which the e2e harness counts as bugs (seen as 23 "warnings"
on a cross_opt run); it now warns only on a real "claimed but not solved".

**Headless-browser verification (no extension needed):** a small CDP
driver (headless Chrome, Node's global `WebSocket`) loaded index.html,
generated scrambles, checked boxes, navigated to solver.html, waited for
results, clicked a row and read the table: no exceptions or console
errors; after-commit labels physically spot-checked with the facelet sim.

### 4.18 FIXED (2026-10-04): mid-search scramble navigation broke the next search; results cache added

`CrossSolverHelper` rejects a call while another is running ("Another solve
is in progress"). `solver-ui.js` discarded a stale search's *results* on
navigation but never stopped the search itself, so the newly shown
scramble's search ran concurrently and every one of its solver calls threw
(caught and skipped by `searchCurrentNode`), leaving "No results". Found by
a headless-Chrome scenario (search scramble 1, switch to 2 after 1 s):
0 rows and 10 console errors before; 796 rows, no errors after.

Fix (`solver-ui.js`): searches go through one promise queue, and each
session caches its current step's search promise keyed by node + committed
path (`resultsFor`). Returning to a scramble reuses the finished or in-flight
search (measured ~150-200 ms to render vs. a full re-search), which also
closes the §5 step 3 "no per-(session, node) results cache" note.

### 4.17 DONE (2026-10-04): random-state scrambles

README: "The eventual goal is proper random-state WCA-legal scrambles."
New `random-state-scramble.js`: picks a uniformly random reachable cubie
state (random permutations with matched parity, random orientations with a
fixed-up last piece), solves it with a two-phase search, and returns the
inverse (lengths ~20-22; rejects anything solvable in under 2 moves, per
WCA 4b3). No move tables are hand-typed. Each face turn's cubie form is
decoded from `facelet-cube.js` with the standard Kociemba facelet tables,
and coordinate move tables are built by BFS over real cubie states. Tables
take ~1-2 s once (first click), then ~30 ms per scramble. index.html loads
`facelet-cube.js` + this file; `populateScrambles` uses it, falling back to
the old random-move generator if absent.

Verified (`test/random-state-scramble.test.js`): cubie model == facelet sim
on 300 random sequences; 40 scrambles replay to exactly their random state;
invariants plus a loose uniformity check; the Python `kociemba` package
(independent solver) accepts and solves the scrambled states, confirmed by
replay. Browser: generates and feeds solver.html fine.

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
   - [x] **Luck filtering** (§4.3/§4.9) — **done (2026-10-04), see §4.12.**
     A solver-probe approach was tried first and reverted (§4.9: unreliable,
     false positives). The real fix ported `CFOPflags.py`'s facelet-mask
     logic to JS (`facelet-flags.js`) on top of a new, `magiccube`-verified
     facelet simulator (`facelet-cube.js`), and checks every candidate's
     real resulting cube state against its DAG edge's claim. Building this
     also surfaced and fixed an independent, more serious later-step
     dispatch bug (§4.12) that predated luck filtering.
   - [x] **Deduplication**: identical algorithm text returned multiple
     times by the solver (common — `maxSolutions` frequently yields
     repeats) is deduped before scoring/display. Note: dedup currently
     runs per (edge, color) only, so identical results from *different*
     edges can still both appear — a known, minor, low-priority cleanup
     item, not a correctness issue.
   - [x] **Fixed (2026-10-04) — later-step searches produced invalid
     solutions, and real duplicate DAG edges inflated every search's result
     count 2-3x.** Both root-caused and fixed in `searchCurrentNode`; see
     §4.10 for the full writeup and verification (real WASM solver + a real
     cube simulator, not just re-reading the code). The committed path is
     now re-verified to physically reach the claimed cross+pairs state at
     every step, for both a single-pair-only chain and a chain that
     includes a multislot step and reaches full completion.
   - [x] **§4.11: a distance-1 rotation-variant result could show the wrong
     slot name** in the "corners"/"edges" columns — **fixed (2026-10-04),
     see §4.12's final section** (`relabelSlotsForRotation`, derived
     empirically, not hand-derived). This checklist item was stale (still
     listed unfixed after the fix landed); corrected here.
   - [x] **Pseudo edges dispatched (2026-10-04, see §4.14).** The text below
     is the superseded pre-fix note, kept for history: (`isPseudoState` check just
     `continue`d past them) — `pseudoCrossSolver` dispatch isn't wired up
     yet. Not a regression: with the UI's current default checkboxes
     (pseudo off), this matches intended behavior already; it becomes a
     real gap only once "pseudo F2L" is checked. **Investigated
     2026-10-04 (see §4.14) but not fixed**: real infrastructure was built
     (Promise-based helpers, per-piece facelet masks) and is reusable, but
     the vendored `pseudoCrossSolver` binary itself was found to have an
     unreliable corner-targeting contract (root cause not yet identified),
     so dispatch was deliberately not wired in. Pick up from §4.14, not
     from scratch.
   - [x] **Simplified-pseudo checkbox** — **done (2026-10-04), see §4.15.**
     The DAG is now a superset (full pseudo); the checkbox restricts it.
   - [x] **Cross optimisation** (§4.5) — **done (2026-10-04), see §4.13.**
   - [x] **Multiple scrambles — verified in-browser (2026-10-03).** Set up
     two scrambles, searched and committed a step on scramble 1, navigated
     to scramble 2 (fresh search, empty solution box, independent results
     — confirmed not merged with scramble 1), then navigated back to
     scramble 1 (its committed step and prior result set were both
     correctly preserved). One minor, non-blocking inefficiency noted:
     `runSearch()` always re-invokes `searchCurrentNode` on navigation,
     even back to an already-searched node — there's no per-(session,
     node) results cache, so switching back and forth re-searches every
     time (fast in practice since the underlying solver's prune tables
     stay warm, but still redundant work worth caching later). **Done
     (2026-10-04), see §4.18**, which also fixes navigation mid-search.
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
   - [ ] **Now the main practical blocker for pseudo F2L** (pseudo root steps
     take 15-80 s in Node, §4.14); a cheaper stopgap is capping candidates per
     step. Port the `Persistent*Solver` struct pattern documented in
     `crossSolver/IMPLEMENTATION_NOTES.md` §"Adding a New Solver" to
     `pseudo.cpp`, so pseudo-pair searches don't rebuild their BFS table on
     every call once multiple scrambles are searched per session. (Blocked
     on having `emcc`/Emscripten available to compile and verify — not
     present in this environment as of 2026-10-02.)

5. **Recyclable-utility follow-ups from §2**
   - [x] Port `CFOPflags.py`'s facelet-mask logic into a small JS
     verification helper — **done (2026-10-04), see §4.12** —
     `facelet-flags.js`, used by luck filtering.
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

1. **DAG nodes for simplified vs. full pseudo** — **answered** (§4.1) and
   **implemented** (§4.15): same node set, superset edge set.
2. **UI/control mechanism for depth-N look-ahead** — deferred; single-step
   search is the correct default for the §5 step 3 build, per spec.
3. **Performance strategy for first-step wide-move generation** — **decided
   (2026-10-04, see §4.13):** every unique raw Cross solution gets the full
   `optimizeCrossSolution` treatment (not just the top-N), since the `2^k`
   subset search (k = algorithm length, capped at the Cross search limit of
   10) stayed fast enough in practice not to need throttling. Revisit if
   real usage with `maxSolutions` raised well beyond today's default shows
   otherwise.
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
