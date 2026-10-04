/**
 * Diagnostic probe (NOT a pass/fail test) backing the "pseudo.cpp's
 * corner (pslot) targeting looks unreliable" finding in PROJECT_STATUS.md.
 * Run and eyeball the output; see that doc's pseudo-dispatch-investigation
 * section for how to read it.
 *
 * Starting from a scramble where corners BR and FR are wrong (verified
 * below) but all edges and -- deliberately -- cross too are disturbed, this
 * asks pseudo xcross_search for "edge FR + corner X" across all four
 * possible X and checks, by real facelet replay (not the solver's own
 * accounting), which corner slot (if any) each returned solution actually
 * places correctly. If `pslot` targeting worked, requesting corner=BR
 * should reliably yield cornerAt.BR=true, requesting corner=FL should
 * yield cornerAt.FL=true, etc. It doesn't: see PROJECT_STATUS.md.
 *
 * Run: node pseudoCrossSolver/investigation/corner_targeting_probe.js
 */
const path = require('path');
const PseudoSolverHelperNode = require(path.join(__dirname, '..', 'solver-helper-node.js'));
const { applyAlgorithm, SOLVED_FACELETS } = require(path.join(__dirname, '..', '..', 'facelet-cube.js'));
const { pseudoSolvedFlags, solvedFlags } = require(path.join(__dirname, '..', '..', 'facelet-flags.js'));

const SCRAMBLE = "F2 D R2 U' R2 D' R2 U R2 F2"; // cross:false, corners BR+FR false, edges all true
console.log('before fix:', solvedFlags(applyAlgorithm(SOLVED_FACELETS, SCRAMBLE)), pseudoSolvedFlags(applyAlgorithm(SOLVED_FACELETS, SCRAMBLE)).cornerAt);

(async () => {
  const helper = new PseudoSolverHelperNode();
  await helper.init();
  for (const cornerSlot of ['FR', 'BR', 'BL', 'FL']) {
    const raw = await helper.solvePseudo(SCRAMBLE, ['FR'], [cornerSlot], { maxSolutions: 5, maxLength: 9 });
    console.log(`\ncornerSlot=${cornerSlot} raw:`, raw);
    for (const sol of raw) {
      const f = applyAlgorithm(SOLVED_FACELETS, SCRAMBLE + ' ' + sol.trim());
      const pf = pseudoSolvedFlags(f);
      console.log('  ', sol, '-> cornerAt:', JSON.stringify(pf.cornerAt), 'edgeAt.FR:', pf.edgeAt.FR, 'cross:', solvedFlags(f).cross);
    }
  }
})().catch((e) => { console.error(e); process.exit(1); });
