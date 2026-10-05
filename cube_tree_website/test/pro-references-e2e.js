#!/usr/bin/env node
/**
 * Professional reference solves (pro_references.txt) vs. the solver's
 * search tree -- slow, hits the real WASM engine; not part of the fast suite.
 *
 * For every DAG-level segment of every reference solve (see
 * pro-references.js segmentProSolve), asks the engine for ALL solutions of
 * the segment's own goal up to the segment's own length, using the move-set
 * configuration under test, and reports whether the professional's exact
 * algorithm (modulo the order of commuting opposite-face turns) is among
 * them. That is "in the search tree", independent of ranking or of the
 * bridge's per-call maxSolutions cap.
 *
 * --split N: for a segment longer than N moves, the first moves are replayed
 * as a fixed prefix and only the last N are searched (reported as
 * "FOUND(suffix)": the configuration admits those moves, weaker than full
 * membership but tractable for deep segments).
 *
 * Usage: node test/pro-references-e2e.js [--config current|extended] [--max N] [--only 3] [--split N]
 */
'use strict';
const path = require('path');
const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');
const { loadProReferences, segmentProSolve } = require(path.join(root, 'tools', 'pro-references.js'));
const { CONFIGS, searchSegment } = require(path.join(root, 'tools', 'pro-search.js'));
const { commuteNormalize } = require(path.join(jsRoot, 'facelet-cube.js'));
const { searchLimitFor } = require(path.join(jsRoot, 'solver-bridge.js'));
const CrossSolverHelperNode = require(path.join(root, 'crossSolver', 'solver-helper-node.js'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const configName = opt('config', 'current');
const maxSolutions = parseInt(opt('max', '200000'), 10);
const only = opt('only', null);
const split = parseInt(opt('split', '0'), 10);

(async () => {
  const cfg = CONFIGS[configName];
  const h = new CrossSolverHelperNode(); await h.init();
  let found = 0, total = 0;
  const solves = loadProReferences();
  for (let i = 0; i < solves.length; i++) {
    if (only && String(i + 1) !== only) continue;
    const solve = solves[i];
    let prior = '';
    for (const seg of segmentProSolve(solve)) {
      const depth = seg.features.tokens;
      const limit = searchLimitFor(seg.newPairs.length, seg.isRoot, seg.totalPairs);
      const t0 = Date.now();
      const { cores, target, cut, sols } = await searchSegment(h, solve, seg, prior, cfg, maxSolutions, split);
      const hit = cores.has(commuteNormalize(target));
      total++; if (hit) found++;
      console.log(`#${i + 1} ${seg.labels.join('+').padEnd(18)} ${hit ? (cut ? 'FOUND(suffix)' : 'FOUND        ') : 'missing      '} depth ${String(depth).padStart(2)} (limit ${limit}) ${sols.length} sols${sols.length >= maxSolutions ? ' (CAPPED)' : ''} ${Date.now() - t0}ms  ${seg.alg}`);
      prior = [prior, seg.alg].filter(Boolean).join(' ');
    }
  }
  console.log(`\n[${configName}] ${found}/${total} professional segments are in the search tree`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
