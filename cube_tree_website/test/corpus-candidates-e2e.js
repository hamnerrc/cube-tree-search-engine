#!/usr/bin/env node
/**
 * Corpus candidates (README "Corpus candidates", solver-bridge.js
 * corpusSolutions) against the real WASM engine -- slow-ish, not part of the
 * fast suite. On random-state scrambles, through a whole solve (the best
 * result committed each step):
 *  - every corpus alg offered for a planned call physically solves exactly
 *    that call's goal from the current cube (cross, every committed pair,
 *    the new pairs, nothing else);
 *  - the results that came only from the corpus are physically exact too,
 *    and never use a mid-step y2 or a wide b;
 *  - how many results the corpus adds and what it costs.
 *
 * Usage: node test/corpus-candidates-e2e.js [--scrambles 4] [--seed 7] [--max 10000]
 */
'use strict';
const { fastLimits } = require('./fast-limits.js');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js', 'random-state-scramble.js']) Object.assign(global, require(path.join(jsRoot, f)));
const B = require(path.join(jsRoot, 'solver-bridge.js'));
const { createEnginePool } = require(path.join(root, 'tools', 'node-engine-pool.js'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const nScrambles = Number(opt('scrambles', '4'));
const maxSolutions = Number(opt('max', '10000'));
let seed = Number(opt('seed', '7'));
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

function physicallyExact(session, r) {
  const f = applyAlgorithm(SOLVED_FACELETS, [session.scramble, session.rotation || r.rotation, session.scoredPath, r.coreAlg].filter(Boolean).join(' '));
  const flags = solvedFlags(f);
  const node = session.nodeMap.get(r.targetNodeId).state;
  return flags.cross && ['BL', 'BR', 'FR', 'FL'].every(sl => flags[sl] === (node.corners || []).includes(sl));
}

(async () => {
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const advanced = ['xcross', 'xxcross', 'multislotting', 'pro_moves', 'cross_opt'];
  const pruned = pruneGraph(tree, { advanced, colors: ['white'] });
  const h = await createEnginePool('cross', 2);
  const stats = { steps: 0, offered: 0, onlyCorpus: 0, top10Corpus: 0, ms: 0 };
  for (let k = 0; k < nScrambles; k++) {
    const scramble = generateRandomStateScramble(rnd);
    const session = new B.SolveSession(scramble, pruned, ['white'], advanced);
    session.maxSolutions = maxSolutions;
    fastLimits(session, { depth: 1 });
    session.multislot = true;
    while (!session.isComplete) {
      const list = await B.searchCurrentNode(session, h, null);
      assert.ok(list.length, `${scramble}: no results at ${session.stepAlgs.length} steps`);
      if (!session.isAtRoot) {
        stats.steps++;
        // Every offered corpus alg solves its call's goal exactly.
        const plan = session.outgoingEdges().map(e => session.nodeMap.get(e.target))
          .filter(n => !isPseudoState(n.state)).map(n => ({ isPseudo: false, allCorners: n.state.corners || [], maxLength: 20 }));
        const t0 = Date.now();
        const offered = B.corpusSolutions(session, plan);
        stats.ms += Date.now() - t0;
        for (const [p, algs] of offered) {
          for (const alg of algs) {
            stats.offered++;
            const f = B.replayFacelets(session.scramble, session.rotation, session.scoredPath, `${alg} ${inverseRotation(netRotation(alg))}`);
            const flags = solvedFlags(f);
            assert.ok(flags.cross, `${alg}: cross`);
            for (const sl of ['BL', 'BR', 'FR', 'FL']) assert.strictEqual(flags[sl], p.allCorners.includes(sl), `${alg}: slot ${sl}`);
            assert.ok(!/ y2/.test(alg), `${alg}: mid-step y2`);
          }
        }
        // Results that are corpus algs (the engine may have found some too).
        const keys = new Set();
        for (const algs of offered.values()) for (const a of algs) keys.add(commuteNormalize(a));
        const fromCorpus = list.filter(r => keys.has(commuteNormalize(r.coreAlg)));
        for (const r of fromCorpus) {
          assert.ok(physicallyExact(session, r), `${r.coreAlg} not exact`);
          assert.ok(!B.hasWideB(r.coreAlg));
        }
        stats.onlyCorpus += fromCorpus.length;
        stats.top10Corpus += list.slice(0, 10).filter(r => keys.has(commuteNormalize(r.coreAlg))).length;
        console.log(`#${k + 1} step ${session.stepAlgs.length + 1}: ${list.length} results, corpus offered ${[...offered.values()].reduce((t, a) => t + a.length, 0)}, top 3: ${list.slice(0, 3).map(r => r.coreAlg + (keys.has(commuteNormalize(r.coreAlg)) ? ' *' : '')).join(' | ')}`);
      }
      session.commit(list[0]);
    }
  }
  console.log(`\n${stats.steps} later steps: ${stats.offered} corpus algs offered (all exact), ${stats.onlyCorpus} results match a corpus alg, ${stats.top10Corpus} of the top-10 rows; corpusSolutions ${(stats.ms / Math.max(1, stats.steps)).toFixed(1)} ms per step`);
  console.log('All corpus-candidates checks passed.');
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
