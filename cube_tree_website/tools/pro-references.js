// Parser + physical replay for pro_references.txt (professional reference
// solves the solver must be able to find; see PROJECT_STATUS.md §4.20).
// Plain helpers, no solver dependency: used by test/pro-references.test.js
// and test/pro-references-e2e.js.
'use strict';

const PRO_FS = require('fs');
const PRO_PATH = require('path');
const { applyAlgorithm, SOLVED_FACELETS, canonicalizeForEngine } = require('../js/facelet-cube.js');
const { solvedFlags, pseudoSolvedFlags } = require('../js/facelet-flags.js');

const PRO_CENTER_COLORS = { W: 'white', Y: 'yellow', G: 'green', B: 'blue', R: 'red', O: 'orange' };

/** Normalises human notation: "R2'" -> "R2", collapses whitespace. */
function normalizeAlg(alg) {
  return alg.replace(/2'/g, '2').trim().split(/\s+/).filter(Boolean).join(' ');
}

/** Parses pro_references.txt into [{ scramble, inspection, steps: [{ label, alg }] }]. */
function parseProReferences(text) {
  const lines = text.split('\n').map(l => l.trim());
  const solves = [];
  let cur = null;
  for (const line of lines) {
    if (!line) { cur = null; continue; }
    if (!line.includes('//')) {
      if (/^([URFDLB]['2]?\s*)+$/.test(line)) { cur = { scramble: normalizeAlg(line), inspection: '', steps: [] }; solves.push(cur); }
      else cur = null;
      continue;
    }
    if (!cur) continue;
    const [alg, label] = line.split('//').map(x => x.trim());
    if (/inspection/i.test(label)) cur.inspection = normalizeAlg(alg);
    else cur.steps.push({ label, alg: normalizeAlg(alg) });
  }
  return solves;
}

function loadProReferences() {
  return parseProReferences(PRO_FS.readFileSync(PRO_PATH.join(__dirname, '..', 'data', 'pro_references.txt'), 'utf8'));
}

/** Physical state after a facelet string: cross colour, cross, per-slot pairs/pieces. */
function describeState(facelets) {
  const f = solvedFlags(facelets);
  const p = pseudoSolvedFlags(facelets);
  const slots = ['BL', 'BR', 'FL', 'FR'];
  return {
    crossColor: PRO_CENTER_COLORS[facelets[31]],
    cross: f.cross,
    pairs: slots.filter(s => f[s]),
    corners: slots.filter(s => p.cornerAt[s]),
    edges: slots.filter(s => p.edgeAt[s]),
  };
}

/** Notation features of an alg: wide/slice tokens, rotations, HTM count. */
function algFeatures(alg) {
  const toks = alg.split(' ').filter(Boolean);
  return {
    tokens: toks.length,
    htm: toks.filter(t => !/^[xyz]/.test(t)).length,
    wide: toks.filter(t => /^[rludfb]/.test(t)),
    slice: toks.filter(t => /^[MES]/.test(t)),
    rotations: toks.filter(t => /^[xyz]/.test(t)),
    faceOnly: toks.every(t => /^[UDRLFB]/.test(t)),
  };
}

/** Replays a solve step by step: [{ label, alg, features, before, after, frame }]. */
function replayProSolve(solve) {
  let facelets = applyAlgorithm(SOLVED_FACELETS, [solve.scramble, solve.inspection].filter(Boolean).join(' '));
  let path = '';
  return solve.steps.map(step => {
    const before = describeState(facelets);
    facelets = applyAlgorithm(facelets, step.alg);
    path = [path, step.alg].filter(Boolean).join(' ');
    return {
      label: step.label, alg: step.alg, features: algFeatures(step.alg),
      before, after: describeState(facelets), facelets,
      frame: canonicalizeForEngine(solve.inspection, path),
    };
  });
}

/** Inverse of a whole-cube rotation string ("x y'" -> "y x'"). */
function invertRotation(rot) {
  return rot.split(' ').filter(Boolean).reverse()
    .map(t => (t.endsWith('2') ? t : t.endsWith("'") ? t[0] : t + "'")).join(' ');
}

/**
 * Groups a solve's steps into DAG transitions: a transition ends once the
 * cross is solved and no previously solved pair is lost (pros' labelled
 * steps sometimes leave the cross temporarily broken, e.g. a cross edge
 * parked in the R layer until the next step). Returns
 * [{ labels, alg, isRoot, before, after, afterStart, newPairs, totalPairs, features }].
 * Slot names in `after` are in the frame the segment ends in; `afterStart`
 * (and `newPairs`) name the same physical slots in the frame the segment
 * starts in, which is what the engine's goal is expressed in -- they differ
 * when the segment contains a mid-step y-family rotation (e.g. #11's `y'`).
 */
function segmentProSolve(solve) {
  const steps = replayProSolve(solve);
  const segments = [];
  let pending = [];
  let start = null;
  for (const st of steps) {
    if (!pending.length) start = st.before;
    pending.push(st);
    const alg = pending.map(x => x.alg).join(' ');
    const netRotation = canonicalizeForEngine('', alg).rotation;
    let afterStart = describeState(applyAlgorithm(st.facelets, invertRotation(netRotation)));
    // A wide move that brings the cross colour down (e.g. #8's r2 from a
    // yellow-down inspection) has no start frame with the cross on D; those
    // root segments keep the end-frame names, as the engine searches them
    // via the cross-down rewrite (inspectionWideVariants).
    if (afterStart.crossColor !== st.after.crossColor) afterStart = st.after;
    const lost = start.pairs.some(p => !afterStart.pairs.includes(p));
    if (!st.after.cross || lost) continue;
    segments.push({
      labels: pending.map(x => x.label),
      alg,
      isRoot: !start.cross,
      before: start,
      after: st.after,
      afterStart,
      newPairs: afterStart.pairs.filter(p => !start.pairs.includes(p)),
      totalPairs: st.after.pairs.length,
      features: algFeatures(alg),
    });
    pending = [];
  }
  if (pending.length) throw new Error('pro solve ends in a state that is not a DAG node');
  return segments;
}

/**
 * Moves of a segment (in its canonical face-turn form, i.e. what the engine
 * searches) that leave every goal piece -- cross edges plus the target
 * slots' corners/edges -- exactly where it was. The engine prunes any
 * solution containing such a move as redundant (crossSolver/solver.cpp's
 * "index unchanged" check), even though humans use them deliberately.
 * Returns the indices (into the canonical move list) of those moves.
 */
function goalNoopMoves(solve, segIndex) {
  const { MOVE_TABLE, composePerm, IDENTITY_PERM } = require('../js/facelet-cube.js');
  const { MASKS } = require('../js/facelet-flags.js');
  const segs = segmentProSolve(solve);
  const prior = segs.slice(0, segIndex).map(g => g.alg).join(' ');
  const seg = segs[segIndex];
  // The segment equals "its net rotation, then face turns" (in the frame
  // after that rotation) -- exactly the moves the engine would search.
  const before = canonicalizeForEngine(solve.inspection, prior);
  const seg1 = canonicalizeForEngine('', seg.alg);
  const segMoves = seg1.moves.split(' ').filter(Boolean);
  const permOf = alg => alg.split(' ').filter(Boolean).reduce((acc, t) => composePerm(acc, MOVE_TABLE[t]), IDENTITY_PERM);
  // state[i] = id of the sticker now at position i.
  let state = permOf([solve.scramble, before.rotation, before.moves, seg1.rotation].filter(Boolean).join(' '));
  const states = [state];
  for (const m of segMoves) { state = composePerm(state, MOVE_TABLE[m]); states.push(state); }
  const goalPositions = [];
  for (const name of ['cross', ...seg.after.pairs]) {
    [...MASKS[name]].forEach((ch, i) => { if (ch !== ch.toUpperCase()) goalPositions.push(i); });
  }
  const goalIds = new Set(goalPositions.map(i => state[i]));
  const where = st => { const m = {}; st.forEach((id, pos) => { if (goalIds.has(id)) m[id] = pos; }); return JSON.stringify(m); };
  const noops = [];
  for (let k = 0; k < segMoves.length; k++) if (where(states[k]) === where(states[k + 1])) noops.push(k);
  return { moves: segMoves, noops };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { invertRotation, goalNoopMoves, segmentProSolve, parseProReferences, loadProReferences, replayProSolve, describeState, algFeatures, normalizeAlg };
}
