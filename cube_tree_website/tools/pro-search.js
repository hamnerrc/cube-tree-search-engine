// Engine side of the professional-reference harnesses (PROJECT_STATUS.md
// §4.20): for one DAG segment of a reference solve, ask the real engine for
// ALL solutions of that segment's goal up to the segment's own length.
// Shared by test/pro-references-e2e.js (membership) and
// tools/pro-ranking.js (where the pro's alg ranks under alg_speed).
'use strict';

const path = require('path');
const jsRoot = path.join(__dirname, '..', 'js');
const { canonicalizeForEngine, applyAlgorithm, SOLVED_FACELETS, commuteNormalize, rotationSpellings } = require(path.join(jsRoot, 'facelet-cube.js'));
const { SLOT_INDICES, POSTALG_BOUNDARY, NOOP_MOVES } = require(path.join(jsRoot, 'solver-bridge.js'));

const FACE = [...'UDLRFB'].flatMap(f => [f, f + '2', f + '-']);
const CONFIGS = {
  // What solver-bridge.js searches without the pro move set.
  current: { moves: FACE, maxRotCount: 0, centerOffset: null },
  // Pro move subsets: wide r/l, one mid-step y/y'/x/x' (never y2 -- README),
  // any final orientation that keeps the cross colour on D.
  extended: {
    moves: FACE.concat(['r', 'r2', 'r-', 'l', 'l2', 'l-', 'y', 'y-', 'x', 'x-']),
    maxRotCount: 1,
    centerOffset: 'keep-cross-on-D',
    spellings: true,
  },
};

// The engine's 24 centre offsets (crossSolver/solver.cpp buildCenterOffset).
const CENTER_OFFSETS = ['', 'y', 'y2', "y'", 'z2', 'z2 y', 'z2 y2', "z2 y'", "z'", "z' y", "z' y2", "z' y'",
  'z', 'z y', 'z y2', "z y'", "x'", "x' y", "x' y2", "x' y'", 'x', 'x y', 'x y2', "x y'"];
/** Offsets (relative to `rotation`) after which `crossColorFacelet` is on D. */
function offsetsKeepingCrossDown(rotation, crossColorFacelet) {
  return CENTER_OFFSETS.filter(o => applyAlgorithm(SOLVED_FACELETS, [rotation, o].filter(Boolean).join(' '))[31] === crossColorFacelet);
}

const axisOf = tok => ({ U: 0, D: 0, u: 0, d: 0, E: 0, y: 0, R: 1, L: 1, r: 1, l: 1, M: 1, x: 1, F: 2, B: 2, f: 2, b: 2, S: 2, z: 2 })[tok[0]];

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

/**
 * Searches one segment. `prior` is the reference solve's alg text before
 * this segment; `split` (optional) searches only the last N moves with the
 * rest as a fixed prefix. Returns { raw, cores, target, cut, sols } where
 * `raw` are the engine's step algs (prefix stripped), `cores` the
 * commuteNormalize'd set incl. rotation spellings (with the pro move set the
 * bridge offers those too), and `target` the pro's searched suffix.
 * `extraDepth` searches that many moves beyond the segment's own length;
 * `deadline` (epoch ms) stops the engine there with what it found.
 */
async function searchSegment(h, solve, seg, prior, cfg, maxSolutions, split = 0, extraDepth = 0, deadline = 0) {
  const frame = canonicalizeForEngine(solve.inspection, prior);
  const centerOffset = cfg.centerOffset === 'keep-cross-on-D'
    ? offsetsKeepingCrossDown(frame.rotation, seg.after.crossColor[0].toUpperCase())
    : '';
  const segTokens = seg.alg.split(' ');
  // Never cut inside a run of same-axis moves: the engine's axis-order
  // pruning would apply across the fixed prefix and hide the suffix.
  let cut = split && segTokens.length > split ? segTokens.length - split : 0;
  while (cut > 0 && axisOf(segTokens[cut - 1]) === axisOf(segTokens[cut])) cut--;
  const fixed = segTokens.slice(0, cut).join(' ');
  const target = segTokens.slice(cut).join(' ');
  // Same neutral boundary as solver-bridge.js (§4.20).
  const postAlg = [frame.moves && `${frame.moves} ${POSTALG_BOUNDARY}`, fixed].filter(Boolean).join(' ');
  // Goal slots in the frame the segment STARTS in (§4.20: a mid-step
  // rotation relabels the end-frame names).
  const sols = await call(h, seg.afterStart.pairs, solve.scramble, {
    rotation: frame.rotation, postAlg, maxLength: segTokens.length - cut + extraDepth, maxSolutions,
    allowedMoves: cfg.moves.join('_'), maxRotCount: cfg.maxRotCount, centerOffset, noopMoves: NOOP_MOVES,
    ...(deadline ? { deadline } : {}),
  });
  const prefix = [frame.rotation, postAlg].filter(Boolean).join(' ');
  const raw = [...new Set(sols.map(s => s.trim().slice(prefix.length).trim()))];
  const cores = new Set(raw.map(commuteNormalize));
  if (cfg.spellings && !cut) {
    for (const c of raw) for (const sp of rotationSpellings(c, !seg.isRoot)) {
      if (sp.split(' ').filter(t => /^[xyz]/.test(t)).length <= 1) cores.add(commuteNormalize(sp));
    }
  }
  return { raw, cores, target, cut, sols };
}

module.exports = { CONFIGS, searchSegment, offsetsKeepingCrossDown };
