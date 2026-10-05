#!/usr/bin/env node
/**
 * Engine regression battery: runs a fixed list of crossSolver calls against a
 * solver.js build and prints (or saves) every solution list plus timings, so a
 * rebuilt engine can be checked byte-for-byte against the previous binary
 * before it is installed (memory: "diff a battery of engine outputs vs the
 * previous binary"; PROJECT_STATUS.md §4.34/§4.36).
 *
 * Covers every F2L class, face and pro move sets, several rotations, a postAlg
 * with the bridge's boundary, a repeated call and a move-set switch inside one
 * process (persistent solvers, shared tables).
 *
 *   node tools/engine-battery.js [--solver path/to/solver.js] [--out file.json] [--compare old.json] [--quick]
 *   node tools/engine-battery.js --pseudo [--solver path/to/pseudo.js] ...   (pseudoCrossSolver)
 *
 * --compare exits 1 when any call's solution list differs.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
Object.assign(global, require(path.join(root, 'js', 'facelet-cube.js')));
const bridge = require(path.join(root, 'js', 'solver-bridge.js'));
const CrossSolverHelperNode = require(path.join(root, 'crossSolver', 'solver-helper-node.js'));
const PseudoSolverHelperNode = require(path.join(root, 'pseudoCrossSolver', 'solver-helper-node.js'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const quick = args.includes('--quick');

const S1 = "R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2";
const S2 = "D2 F2 U' B2 U R2 D' L2 U2 F2 R' D' F' L2 D B R' F2 U' R";
const FACE = 'U_U2_U-_D_D2_D-_L_L2_L-_R_R2_R-_F_F2_F-_B_B2_B-';
const base = { allowedMoves: FACE, noopMoves: bridge.NOOP_MOVES, postAlg: '' };
const pro = rot => ({ ...base, ...bridge.proEngineOptions(rot) });

const CALLS = [
  ['solveCross', S1, { ...base, rotation: 'z2', maxLength: 8, maxSolutions: 200 }],
  ['solveXcross', S1, 2, { ...base, rotation: 'z2', maxLength: 10, maxSolutions: 300 }],
  ['solveXcross', S1, 0, { ...pro('x'), rotation: 'x', maxLength: 10, maxSolutions: 300 }],
  ['solveXxcross', S1, 0, 1, { ...base, rotation: '', maxLength: 11, maxSolutions: 300 }],
  ['solveXxcross', S2, 2, 3, { ...pro('z2'), rotation: 'z2', maxLength: 11, maxSolutions: 300 }],
  ['solveXxxcross', S1, 0, 1, 3, { ...base, rotation: 'z2', maxLength: 12, maxSolutions: 100 }],
  ['solveXxxcross', S2, 1, 2, 3, { ...pro(''), rotation: '', maxLength: quick ? 11 : 12, maxSolutions: 100 }],
  // later steps: postAlg with the bridge's boundary, more pairs in the goal
  ['solveXxcross', S1, 2, 3, { ...base, rotation: 'z2', postAlg: `D R' F R D' ${bridge.POSTALG_BOUNDARY}`, maxLength: 10, maxSolutions: 300 }],
  ['solveXxxcross', S1, 0, 2, 3, { ...pro('z2'), rotation: 'z2', postAlg: `D R' F R D' ${bridge.POSTALG_BOUNDARY}`, maxLength: quick ? 11 : 12, maxSolutions: 200 }],
  ['solveXxxxcross', S2, { ...base, rotation: '', postAlg: `R U R' F' L F L' ${bridge.POSTALG_BOUNDARY}`, maxLength: quick ? 12 : 13, maxSolutions: 50 }],
  // repeat (persistent solver) and a switch back to the face move set
  ['solveXcross', S1, 2, { ...base, rotation: 'z2', maxLength: 10, maxSolutions: 300 }],
  ['solveXxxcross', S2, 1, 2, 3, { ...base, rotation: 'x', maxLength: 12, maxSolutions: 100 }],
];

// pseudo: [edges, corners] home slots, independent; the bridge's face move set.
const PSEUDO_CALLS = [
  ['solvePseudo', S1, ['FR'], ['FL'], { ...base, rotation: 'z2', maxLength: 10, maxSolutions: 300 }],
  ['solvePseudo', S1, ['BL', 'FR'], ['BL', 'FR'], { ...base, rotation: 'z2', maxLength: 11, maxSolutions: 300 }],
  ['solvePseudo', S2, ['BL', 'FL'], ['BL', 'BR'], { ...base, rotation: '', maxLength: 11, maxSolutions: 300 }],
  ['solvePseudo', S2, ['BR', 'FR'], ['BL', 'FL'], { ...base, rotation: "x'", maxLength: 12, maxSolutions: 500 }],
  ['solvePseudo', S1, ['BL', 'BR', 'FR'], ['BL', 'BR', 'FL'], { ...base, rotation: 'z2', maxLength: quick ? 12 : 13, maxSolutions: 500 }],
  ['solvePseudo', S2, ['BL', 'FL', 'FR'], ['BL', 'BR', 'FL'], { ...base, rotation: 'z', maxLength: 12, maxSolutions: 200 }],
  ['solvePseudo', S1, ['BR', 'FL'], ['BR', 'FR'], { ...base, rotation: 'z2', postAlg: `D R' F R D' ${bridge.POSTALG_BOUNDARY}`, maxLength: 11, maxSolutions: 300 }],
  ['solvePseudo', S1, ['BL', 'BR', 'FL'], ['BL', 'BR', 'FL'], { ...base, rotation: 'z2', postAlg: `D R' F R D' ${bridge.POSTALG_BOUNDARY}`, maxLength: 12, maxSolutions: 300 }],
  ['solvePseudo', S1, ['BL', 'FR'], ['BL', 'FR'], { ...base, rotation: 'z2', maxLength: 11, maxSolutions: 300 }],
];

(async () => {
  const pseudo = args.includes('--pseudo');
  const solverPath = opt('solver', null);
  const h = pseudo
    ? new PseudoSolverHelperNode(solverPath, solverPath && solverPath.replace(/\.js$/, '.wasm'))
    : new CrossSolverHelperNode(solverPath);
  await h.init();
  const out = [];
  for (const [method, ...a] of (pseudo ? PSEUDO_CALLS : CALLS)) {
    const t0 = Date.now();
    const sols = await h[method](...a);
    const ms = Date.now() - t0;
    const o = a[a.length - 1];
    const label = `${method}(${a.slice(1, -1).map(x => (Array.isArray(x) ? x.join('+') : x)).join(',')}) rot '${o.rotation}'${o.postAlg ? ' post' : ''} ${o.allowedMoves.length > FACE.length ? 'pro' : 'face'} len ${o.maxLength}`;
    out.push({ label, ms, sols });
    console.log(`${(ms / 1000).toFixed(2).padStart(7)} s  ${String(sols.length).padStart(4)} sols  ${label}`);
  }
  console.log(`total ${(out.reduce((s, c) => s + c.ms, 0) / 1000).toFixed(1)} s`);
  if (opt('out', null)) fs.writeFileSync(opt('out'), JSON.stringify(out));
  if (opt('compare', null)) {
    const old = JSON.parse(fs.readFileSync(opt('compare'), 'utf8'));
    let bad = 0;
    out.forEach((c, i) => {
      const same = JSON.stringify(c.sols) === JSON.stringify(old[i].sols);
      if (!same) bad++;
      console.log(`${same ? 'same' : 'DIFF'}  ${(old[i].ms / 1000).toFixed(2).padStart(7)} s -> ${(c.ms / 1000).toFixed(2).padStart(7)} s  ${c.label}`);
    });
    console.log(bad ? `${bad} call(s) differ` : 'all calls identical');
    process.exit(bad ? 1 : 0);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
