#!/usr/bin/env node
/**
 * Regression test for the color <-> rotation mapping used to decide which
 * setup rotation brings a given cross color to the bottom (D) face.
 *
 * Background: cube⑂tree's stated convention (README.md "Orientation") is
 * that a scramble is interpreted in the standard orientation White=U,
 * Green=F (so, by the standard color wheel, Yellow=D, Blue=B, Red=R,
 * Orange=L). `cross_xcross.js`/`backend_test.js` had a COLOR_ORIENTATIONS
 * table mapping each color to the rotation that brings it to D -- but
 * white and yellow were swapped (white: rotation='', yellow: rotation='z2'),
 * backwards from this convention. green/blue/red/orange were already
 * correct.
 *
 * Method: for each whole-cube rotation, the single original face whose
 * turns do NOT disrupt a solved cross under that rotation is the new-U
 * face (since only equatorial-layer turns touch the D-layer cross; a
 * pure U-layer turn never does). The new-D face is U's antipode. This is
 * a pure face-identity test -- no color-naming assumption is baked into
 * the probe itself, only into the final face->color translation step.
 *
 * Run: node crossSolver/test/color-orientation.test.js
 */
const path = require('path');
const CrossSolverHelperNode = require(path.join(__dirname, '..', 'solver-helper-node.js'));

const FACES = ['U', 'D', 'F', 'B', 'R', 'L'];
const ANTIPODE = { U: 'D', D: 'U', F: 'B', B: 'F', R: 'L', L: 'R' };

// Our stated convention (README "Orientation"): White=U, Green=F, Red=R
// (=> Yellow=D, Blue=B, Orange=L by the standard color wheel).
const FACE_TO_COLOR = { U: 'white', D: 'yellow', F: 'green', B: 'blue', R: 'red', L: 'orange' };

// rotation -> expected color now sitting on D, per the fixed
// COLOR_ORIENTATIONS tables in cross_xcross.js / backend_test.js.
const EXPECTED = {
  '': 'yellow',
  'x': 'blue',
  "x'": 'green',
  'x2': 'white',
  'z': 'red',
  "z'": 'orange',
};

async function newUFace(helper, rotation) {
  const notDisrupted = [];
  for (const face of FACES) {
    let depthEvents = 0;
    await helper.solveCross(face, {
      maxSolutions: 1, maxLength: 4, rotation,
      onProgress: () => { depthEvents++; },
    });
    if (depthEvents === 0) notDisrupted.push(face);
  }
  if (notDisrupted.length !== 1) {
    throw new Error(`rotation=${JSON.stringify(rotation)}: expected exactly one non-disrupting face, got [${notDisrupted.join(', ')}]`);
  }
  return notDisrupted[0];
}

(async () => {
  const helper = new CrossSolverHelperNode();
  await helper.init();

  let failures = 0;
  for (const [rotation, expectedColor] of Object.entries(EXPECTED)) {
    const newU = await newUFace(helper, rotation);
    const newD = ANTIPODE[newU];
    const actualColor = FACE_TO_COLOR[newD];

    if (actualColor === expectedColor) {
      console.log(`PASS: rotation=${JSON.stringify(rotation)} -> D=${newD} (${actualColor}), matches expected ${expectedColor}`);
    } else {
      failures++;
      console.error(`FAIL: rotation=${JSON.stringify(rotation)} -> D=${newD} (${actualColor}), expected ${expectedColor}`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} case(s) failed. The color<->rotation convention in cross_xcross.js/backend_test.js's COLOR_ORIENTATIONS no longer matches solver.wasm's actual behavior.`);
    process.exit(1);
  }

  console.log('\nAll color-orientation cases passed: rotation=\'\' -> yellow, x2 -> white, x -> blue, x\' -> green, z -> red, z\' -> orange.');
  process.exit(0);
})().catch(err => {
  console.error('ERROR running color-orientation test:', err);
  process.exit(1);
});
