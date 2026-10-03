#!/usr/bin/env node
/**
 * Regression test for the xcross/xxcross/xxxcross `slot` convention.
 *
 * Background: the vendored docs (README.md, IMPLEMENTATION_NOTES.md) and the
 * JSDoc comments in solver-helper.js / solver-helper-node.js previously
 * claimed `0=BR, 1=BL, 2=FL, 3=FR`, while the only code that actually drove
 * the solver end-to-end (../../cross_xcross.js, ../../backend_test.js) used
 * `{ BL: 0, BR: 1, FR: 2, FL: 3 }` -- the opposite pairing. One of these was
 * wrong, and picking the wrong slot silently searches for the wrong F2L pair
 * instead of erroring. This test pins down the correct mapping empirically
 * and fails loudly if solver.wasm's behavior ever changes (e.g. after a
 * recompile) without the docs being updated to match.
 *
 * Method: "R U R' U'" is a textbook commutator that, from a solved cube,
 * disturbs the cross-plus-Front-Right pair only, leaving the cross and the
 * other three F2L pairs solved. Prepending a whole-cube `rotation` (y/y2/y')
 * before running that same trigger cycles which *physical* pair gets
 * disturbed. For each rotation, calling solveXcross once per slot (0-3) and
 * checking which slot actually required a search (as opposed to reporting
 * the cross+pair already solved) identifies that slot's physical pair
 * unambiguously -- exactly one slot should need a search per rotation.
 *
 * Run: node crossSolver/test/slot-mapping.test.js
 */
const path = require('path');
const CrossSolverHelperNode = require(path.join(__dirname, '..', 'solver-helper-node.js'));

const TRIGGER = "R U R' U'";

// Expected physical pair disturbed by TRIGGER under each setup rotation.
const CASES = [
  { rotation: '', expectedPair: 'FR' },
  { rotation: 'y', expectedPair: 'FL' },
  { rotation: 'y2', expectedPair: 'BL' },
  { rotation: "y'", expectedPair: 'BR' },
];

// The mapping under test: slot index -> pair name.
const SLOT_TO_PAIR = { 0: 'BL', 1: 'BR', 2: 'FR', 3: 'FL' };

async function slotNeedsSearch(helper, rotation, slot) {
  let depthEvents = 0;
  await helper.solveXcross(TRIGGER, slot, {
    maxSolutions: 1,
    maxLength: 6,
    rotation,
    onProgress: () => { depthEvents++; },
  });
  return depthEvents > 0;
}

(async () => {
  const helper = new CrossSolverHelperNode();
  await helper.init();

  let failures = 0;

  for (const { rotation, expectedPair } of CASES) {
    const expectedSlot = Number(Object.keys(SLOT_TO_PAIR).find(k => SLOT_TO_PAIR[k] === expectedPair));
    const needsSearch = [];

    for (let slot = 0; slot <= 3; slot++) {
      if (await slotNeedsSearch(helper, rotation, slot)) needsSearch.push(slot);
    }

    const label = `rotation=${JSON.stringify(rotation)} (expect pair ${expectedPair} -> slot ${expectedSlot})`;

    if (needsSearch.length !== 1) {
      console.error(`FAIL: ${label} -- expected exactly one slot to need a search, got [${needsSearch.join(', ')}]`);
      failures++;
      continue;
    }

    if (needsSearch[0] !== expectedSlot) {
      console.error(`FAIL: ${label} -- slot ${needsSearch[0]} needed the search, not ${expectedSlot}`);
      failures++;
      continue;
    }

    console.log(`PASS: ${label} -- slot ${needsSearch[0]} correctly needed the search`);
  }

  if (failures > 0) {
    console.error(`\n${failures} case(s) failed. The slot <-> F2L pair mapping documented in README.md / solver-helper*.js no longer matches solver.wasm's actual behavior.`);
    process.exit(1);
  }

  console.log('\nAll slot-mapping cases passed: 0=BL, 1=BR, 2=FR, 3=FL confirmed against solver.wasm.');
  process.exit(0);
})().catch(err => {
  console.error('ERROR running slot-mapping test:', err);
  process.exit(1);
});
