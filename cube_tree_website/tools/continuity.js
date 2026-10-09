#!/usr/bin/env node
/**
 * Solution continuity (README "Pair planning"): what a solve looks like when
 * the top result is committed at every step, with pair planning on and off,
 * on the same random-state scrambles:
 *  - rotations per solve (x/y/z tokens inside the steps; a step's leading y
 *    counts, the first step's inspection does not),
 *  - steps that rotate,
 *  - how often the first two pairs solved are both front slots (FR + FL in
 *    the orientation the cube is held in after them: the back slots, out of
 *    view, are still open),
 *  - bad U-layer edges left after each step (planFeatures), on average,
 *  - the solve's TPP (time per piece of the whole Cross + F2L).
 *
 *   node tools/continuity.js [--scrambles 20] [--seed 11] [--complete] [--max 2000]
 *
 * Without --complete the capped engine search is used (completeSearch off,
 * --max solutions per call): the same ranking, much faster.
 */
'use strict';
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js', 'random-state-scramble.js', 'spelling-search.js']) Object.assign(global, require(path.join(jsRoot, f)));
const B = require(path.join(jsRoot, 'solver-bridge.js'));
const { createEnginePool } = require(path.join(root, 'tools', 'node-engine-pool.js'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const nScrambles = Number(opt('scrambles', '20'));
const complete = args.includes('--complete');
let seed = Number(opt('seed', '11'));
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

const rotationsIn = (alg, first) => {
  const toks = alg.split(' ').filter(Boolean);
  return toks.filter((t, i) => /^[xyz]/.test(t) && !(first && i === 0)).length;
};

async function solve(scramble, pruned, h, planning) {
  const advanced = ['xcross', 'xxcross', 'pro_moves', 'cross_opt'];
  const s = new B.SolveSession(scramble, pruned, ['white'], advanced);
  s.planning = planning;
  if (!complete) { s.completeSearch = false; s.maxSolutions = Number(opt('max', '2000')); }
  const out = { rotations: 0, rotatingSteps: 0, steps: 0, frontFirst: 0, badU: 0, badUSteps: 0, tpp: 0 };
  while (!s.isComplete) {
    const list = await B.searchCurrentNode(s, h, null);
    if (!list.length) throw new Error(`${scramble}: no results`);
    const top = list[0];
    const rot = rotationsIn(top.coreAlg, false);
    out.rotations += rot;
    if (rot) out.rotatingSteps++;
    s.commit(top);
    out.steps++;
    const held = applyAlgorithm(SOLVED_FACELETS, [s.scramble, s.rotation, s.scoredPath].filter(Boolean).join(' '));
    const plan = planFeatures(held);
    const solvedPairs = (s.currentNode.state.corners || []).length;
    if (solvedPairs < 4) { out.badU += plan[0]; out.badUSteps++; }
    if (solvedPairs === 2 && out.pairsAt2 === undefined) {
      out.pairsAt2 = true;
      const fl = solvedFlags(held);
      if (fl.FR && fl.FL) out.frontFirst = 1;
    }
    out.tpp = top.tpp;
  }
  return out;
}

(async () => {
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const pruned = pruneGraph(tree, { advanced: ['xcross', 'xxcross', 'pro_moves', 'cross_opt', 'multislotting'], colors: ['white'] });
  const h = await createEnginePool('cross', Number(opt('workers', '2')));
  const sum = { on: null, off: null };
  for (let k = 0; k < nScrambles; k++) {
    const scramble = generateRandomStateScramble(rnd);
    const row = [];
    for (const [key, planning] of [['off', false], ['on', true]]) {
      const r = await solve(scramble, pruned, h, planning);
      if (!sum[key]) sum[key] = { n: 0, rotations: 0, rotatingSteps: 0, steps: 0, frontFirst: 0, badU: 0, badUSteps: 0, tpp: 0 };
      const S = sum[key];
      S.n++; S.rotations += r.rotations; S.rotatingSteps += r.rotatingSteps; S.steps += r.steps; S.frontFirst += r.frontFirst; S.badU += r.badU; S.badUSteps += r.badUSteps; S.tpp += r.tpp;
      row.push(`${key}: ${r.rotations} rot, ${r.steps} steps, front-first ${r.frontFirst}, tpp ${r.tpp.toFixed(2)}`);
    }
    console.log(`${k + 1}. ${row.join(' | ')}`);
  }
  console.log('');
  for (const key of ['off', 'on']) {
    const S = sum[key];
    console.log(`planning ${key.padEnd(3)}: rotations/solve ${(S.rotations / S.n).toFixed(2)}, rotating steps ${(100 * S.rotatingSteps / S.steps).toFixed(1)}%, first two pairs both front ${(100 * S.frontFirst / S.n).toFixed(0)}%, bad U edges left/step ${(S.badU / S.badUSteps).toFixed(2)}, steps/solve ${(S.steps / S.n).toFixed(2)}, solve tpp ${(S.tpp / S.n).toFixed(3)}`);
  }
  await h.terminate();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
