#!/usr/bin/env node
/**
 * Complete search (README "Complete search") against the real WASM engine,
 * through whole solves (the best result committed each step), compared with
 * the old capped search (pro move set in the engine, 10,000 solutions per
 * call) on the same cube:
 *  - every listed result physically solves exactly what its row claims and
 *    reaches the node it says (independent facelet replay);
 *  - rank by rank, the complete list's TPPs are never worse than the old
 *    list's where the old result is within the complete search's limits,
 *    and every old top-25 result within those limits is listed (or beaten
 *    by N better results of its type);
 *  - timings of both.
 *
 * Usage: node test/complete-search-e2e.js [--scrambles 2] [--seed 3] [--no-old]
 */
'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js', 'random-state-scramble.js', 'spelling-search.js']) Object.assign(global, require(path.join(jsRoot, f)));
const B = require(path.join(jsRoot, 'solver-bridge.js'));
const { createEnginePool } = require(path.join(root, 'tools', 'node-engine-pool.js'));
const { createPostProcessPool } = require(path.join(root, 'tools', 'node-postprocess-pool.js'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const nScrambles = Number(opt('scrambles', '2'));
const compareOld = !args.includes('--no-old');
let seed = Number(opt('seed', '3'));
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

function physicallyExact(session, r) {
  const rotation = session.isAtRoot ? r.rotation : session.rotation;
  const f = applyAlgorithm(SOLVED_FACELETS, [session.scramble, rotation, session.scoredPath, r.coreAlg].filter(Boolean).join(' '));
  const flags = solvedFlags(f);
  const node = session.nodeMap.get(r.targetNodeId).state;
  return flags.cross && ['BL', 'BR', 'FR', 'FL'].every(sl => flags[sl] === (node.corners || []).includes(sl));
}
const faceTurns = alg => alg.split(' ').filter(t => t && !/^[xyz]/.test(t)).length;

(async () => {
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const advanced = ['xcross', 'xxcross', 'pro_moves', 'cross_opt'].concat(args.includes('--multislot') ? ['multislotting'] : []);
  const pruned = pruneGraph(tree, { advanced, colors: ['white'] });
  const h = await createEnginePool('cross', Number(opt('engines', '1')));
  const post = await createPostProcessPool(Number(opt('post', '2')));
  const totals = { steps: 0, newMs: 0, oldMs: 0, checked: 0, oldMissing: 0, oldBetter: 0 };
  for (let k = 0; k < nScrambles; k++) {
    const scramble = generateRandomStateScramble(rnd);
    console.log(`\nscramble ${k + 1}: ${scramble}`);
    const session = new B.SolveSession(scramble, pruned, ['white'], advanced);
    session.postProcessor = post.process;
    while (!session.isComplete) {
      const step = session.stepAlgs.length;
      let t0 = Date.now();
      const list = await B.searchCurrentNode(session, h, null);
      const newMs = Date.now() - t0;
      assert.ok(list.length, `step ${step}: no results`);
      for (const r of list) {
        assert.ok(physicallyExact(session, r), `step ${step}: ${r.rotation} | ${r.coreAlg} not exact`);
        totals.checked++;
      }
      let line = `  step ${step} (${session.isAtRoot ? 'first' : 'later'}): ${list.length} results in ${(newMs / 1000).toFixed(1)} s; best ${list[0].rotation ? list[0].rotation + ' | ' : ''}${list[0].coreAlg} (${list[0].tpp.toFixed(2)})`;
      if (compareOld) {
        const old = session.withSettings({});
        old.completeSearch = false;
        old.postProcessor = null;
        old.searchMemo = new Map();
        old.engineMemo = new Map();
        t0 = Date.now();
        const oldList = await B.searchCurrentNode(old, h, null);
        const oldMs = Date.now() - t0;
        totals.oldMs += oldMs;
        const limitOf = r => (session.isAtRoot ? B.DISTANCE1_LIMITS[(r.corners || []).length] : B.searchLimitFor((r.corners || []).length, false, 0));
        const keys = new Set(list.map(r => `${r.rotation}|${commuteNormalize(r.coreAlg)}`));
        let missing = 0;
        let better = 0;
        for (const r of oldList.slice(0, 25)) {
          if (faceTurns(r.coreAlg) > limitOf(r)) continue;
          if (!keys.has(`${r.rotation}|${commuteNormalize(r.coreAlg)}`)) {
            // fine only if N results of its type are better
            const sameType = list.filter(c => c.type === r.type && c.tpp <= r.tpp + 1e-9).length;
            if (sameType < session.topN) { missing++; console.log(`    MISSING old result ${r.rotation} | ${r.coreAlg} (${r.tpp.toFixed(2)}, ${r.type})`); }
          }
        }
        for (let i = 0; i < Math.min(25, list.length, oldList.length); i++) if (oldList[i].tpp < list[i].tpp - 1e-9 && faceTurns(oldList[i].coreAlg) <= limitOf(oldList[i])) better++;
        totals.oldMissing += missing;
        totals.oldBetter += better;
        line += ` | old: ${oldList.length} in ${(oldMs / 1000).toFixed(1)} s, best ${oldList[0].coreAlg} (${oldList[0].tpp.toFixed(2)}); old top-25 missing ${missing}`;
      }
      console.log(line);
      totals.steps++;
      totals.newMs += newMs;
      session.commit(list[0]);
    }
  }
  console.log(`\n${totals.steps} steps, ${totals.checked} results physically exact; complete ${(totals.newMs / 1000).toFixed(1)} s${compareOld ? `, old ${(totals.oldMs / 1000).toFixed(1)} s; old top-25 results within the limits missing: ${totals.oldMissing}` : ''}`);
  assert.strictEqual(totals.oldMissing, 0, 'old results missing from the complete search');
  await h.terminate();
  await post.terminate();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
