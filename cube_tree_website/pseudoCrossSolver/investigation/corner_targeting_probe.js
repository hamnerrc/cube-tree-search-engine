/**
 * Diagnostic probe. HISTORICAL: this is the probe that first (wrongly)
 * suggested pseudo.cpp's corner (pslot) targeting was unreliable. The "failures"
 * it prints are the free trailing D turn: pseudo.cpp only guarantees cross +
 * targets solved UP TO one D/D2/D'. Re-check any hit with `alignPseudoAlg`
 * (solver-bridge.js) applied and they all become exact -- see
 * PROJECT_STATUS.md §4.14. Kept as a repro of the symptom.
 *
 * Run: node pseudoCrossSolver/investigation/corner_targeting_probe.js
 */
const path = require('path');
const PseudoSolverHelperNode = require(path.join(__dirname, '..', 'solver-helper-node.js'));
const { applyAlgorithm, SOLVED_FACELETS } = require(path.join(__dirname, '..', '..', 'js', 'facelet-cube.js'));
const { pseudoSolvedFlags, solvedFlags } = require(path.join(__dirname, '..', '..', 'js', 'facelet-flags.js'));

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
