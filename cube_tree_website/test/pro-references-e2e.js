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
const { loadProReferences, segmentProSolve } = require(path.join(root, 'pro-references.js'));
const { canonicalizeForEngine, applyAlgorithm, SOLVED_FACELETS } = require(path.join(root, 'facelet-cube.js'));
const { searchLimitFor, SLOT_INDICES, POSTALG_BOUNDARY } = require(path.join(root, 'solver-bridge.js'));
const CrossSolverHelperNode = require(path.join(root, 'crossSolver', 'solver-helper-node.js'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const configName = opt('config', 'current');
const maxSolutions = parseInt(opt('max', '200000'), 10);
const only = opt('only', null);
const split = parseInt(opt('split', '0'), 10);

const FACE = [...'UDLRFB'].flatMap(f => [f, f + '2', f + '-']);
const CONFIGS = {
  // What solver-bridge.js searches today.
  current: { moves: FACE, maxRotCount: 0, centerOffset: null },
  // Pro move subsets: wide r/l, mid-step y/y'/x/x' (never y2 -- README),
  // any final orientation that keeps the cross colour on D.
  extended: {
    moves: FACE.concat(['r', 'r2', 'r-', 'l', 'l2', 'l-', 'y', 'y-', 'x', 'x-']),
    maxRotCount: 2,
    centerOffset: 'keep-cross-on-D',
  },
};

// The engine's 24 centre offsets (crossSolver/solver.cpp buildCenterOffset).
const CENTER_OFFSETS = ['', 'y', 'y2', "y'", 'z2', 'z2 y', 'z2 y2', "z2 y'", "z'", "z' y", "z' y2", "z' y'",
  'z', 'z y', 'z y2', "z y'", "x'", "x' y", "x' y2", "x' y'", 'x', 'x y', 'x y2', "x y'"];
/** Offsets (relative to `rotation`) after which `crossColorFacelet` is on D. */
function offsetsKeepingCrossDown(rotation, crossColorFacelet) {
  return CENTER_OFFSETS.filter(o => applyAlgorithm(SOLVED_FACELETS, [rotation, o].filter(Boolean).join(' '))[31] === crossColorFacelet);
}

// Same-axis faces commute; put each run of same-axis turns in a fixed order.
const AXIS = { U: 0, D: 0, R: 1, L: 1, F: 2, B: 2 };
const ORDER = 'UDRLFB';
function commuteNormalize(alg) {
  const t = alg.split(' ').filter(Boolean);
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 0; i + 1 < t.length; i++) {
      const a = t[i][0], b = t[i + 1][0];
      if (a in AXIS && b in AXIS && a !== b && AXIS[a] === AXIS[b] && ORDER.indexOf(a) > ORDER.indexOf(b)) {
        [t[i], t[i + 1]] = [t[i + 1], t[i]]; changed = true;
      }
    }
  }
  return t.join(' ');
}

function call(h, pairs, scramble, o) {
  const slots = pairs.slice().sort().map(p => SLOT_INDICES[p]);
  switch (slots.length) {
    case 0: return h.solveCross(scramble, o);
    case 1: return h.solveXcross(scramble, slots[0], o);
    case 2: return h.solveXxcross(scramble, slots[0], slots[1], o);
    case 3: return h.solveXxxcross(scramble, slots[0], slots[1], slots[2], o);
    default: return h.solveXxxxcross(scramble, o);
  }
}

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
      const frame = canonicalizeForEngine(solve.inspection, prior);
      const depth = seg.features.tokens;
      const limit = searchLimitFor(seg.newPairs.length, seg.isRoot, seg.totalPairs);
      const centerOffset = cfg.centerOffset === 'keep-cross-on-D'
        ? offsetsKeepingCrossDown(frame.rotation, seg.after.crossColor[0].toUpperCase())
        : '';
      // Same neutral boundary as solver-bridge.js (§4.20).
      const segTokens = seg.alg.split(' ');
      const cut = split && segTokens.length > split ? segTokens.length - split : 0;
      const fixed = segTokens.slice(0, cut).join(' ');
      const target = segTokens.slice(cut).join(' ');
      const postAlg = [frame.moves && `${frame.moves} ${POSTALG_BOUNDARY}`, fixed].filter(Boolean).join(' ');
      const t0 = Date.now();
      const sols = await call(h, seg.after.pairs, solve.scramble, {
        rotation: frame.rotation, postAlg, maxLength: segTokens.length - cut, maxSolutions,
        allowedMoves: cfg.moves.join('_'), maxRotCount: cfg.maxRotCount, centerOffset,
      });
      const prefix = [frame.rotation, postAlg].filter(Boolean).join(' ');
      const cores = new Set(sols.map(s => commuteNormalize(s.trim().slice(prefix.length).trim())));
      const hit = cores.has(commuteNormalize(target));
      total++; if (hit) found++;
      console.log(`#${i + 1} ${seg.labels.join('+').padEnd(18)} ${hit ? (cut ? 'FOUND(suffix)' : 'FOUND        ') : 'missing      '} depth ${String(depth).padStart(2)} (limit ${limit}) ${sols.length} sols${sols.length >= maxSolutions ? ' (CAPPED)' : ''} ${Date.now() - t0}ms  ${seg.alg}`);
      prior = [prior, seg.alg].filter(Boolean).join(' ');
    }
  }
  console.log(`\n[${configName}] ${found}/${total} professional segments are in the search tree`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
