/**
 * Step-by-step review of a whole solution.
 *
 * The steps are the solution's committed steps (solve-editor.js reads them
 * off the typed text by replaying it). Each one is compared with the
 * solver's list for the same node: every result of the step's search,
 * unfiltered, at the same goal (the pieces it solved), the way the tuning
 * tools rank a professional's step in the app's list.
 *
 * What the solver reads has no numbers: each step gets why it is slower, in
 * words (longer, a rotation, turns that don't flow, nothing set up for the next
 * pair, outside what I search...), and a *similar* better step: the same pieces
 * solved, and among those the one that starts like the solver's step the
 * longest (the same first move, say), then the fastest. The numbers (rank, TPP
 * gap) stay on the items for the tests and tools.
 *
 * Engine-agnostic: the caller passes `search(fork, { multislot }) -> Promise<results>`.
 */
'use strict';

const isRotationTok = t => /^[xyz]/.test(t);
// A step this close to the best of its kind is a fine choice, not a slow one.
const FINE_MARGIN = 0.06;
// Another goal (other pieces) is brought up only when it is clearly faster.
const OTHER_GOAL_MARGIN = 0.10;

/** Why a step cannot be in the complete search's list (null: it could be). */
function outsideReason(row, isRoot, session) {
  const toks = String(row.coreAlg || '').split(/\s+/).filter(Boolean);
  const turns = toks.filter(t => !isRotationTok(t)).length;
  const node = session.nodeMap.get(row.targetNodeId);
  const pairsAfter = node ? (node.state.corners || []).length : 0;
  const pairCount = isRoot ? pairsAfter : (row.corners || []).length;
  const limit = searchLimitFor(pairCount, isRoot, pairsAfter, session.searchConfig, /pseudo/i.test(row.type || ''));
  if (limit && turns > limit) return `${turns} turns > limit ${limit}`;
  if (toks.some(t => /^[MES]/.test(t))) return 'slice moves';
  if (toks.some(t => /^b/.test(t))) return 'a wide b';
  const mid = toks.filter((t, i) => isRotationTok(t) && i > 0).length;
  if (isRoot && toks.some(isRotationTok)) return 'a rotation inside the first step';
  if (!isRoot && mid > 1) return 'two rotations';
  return null;
}

/** The captions.js key (critique.outside.<key>) for an outsideReason. */
function outsideKey(why) {
  if (/turns > limit/.test(why)) return 'long';
  return { 'slice moves': 'slices', 'a wide b': 'wide_b', 'two rotations': 'rotations', 'a rotation inside the first step': 'root_rotation' }[why] || 'long';
}

const tokensOf = (row, isRoot) => {
  const alg = String(row.coreAlg || '').split(/\s+/).filter(Boolean);
  return isRoot ? [...String(row.rotation || '').split(/\s+/).filter(Boolean), ...alg] : alg;
};
const sameTokens = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);
/** The same step: the same moves, and at the first step the same physical inspection however it is written. */
function sameStep(a, b, isRoot) {
  if (!sameTokens(tokensOf(a, false), tokensOf(b, false))) return false;
  return !isRoot || rotationIndex(a.rotation || '') === rotationIndex(b.rotation || '');
}

/** How many leading tokens two steps share. */
function sharedStart(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/** Time per turn of a step (the ranking's own move-speed model); lower flows better. */
function flowOf(alg) {
  const n = Math.max(1, String(alg || '').split(/\s+/).filter(t => t && !isRotationTok(t)).length);
  return (typeof algSpeed === 'function' ? algSpeed(alg, false, false) : n) / n;
}

/**
 * Why `mine` is slower than `alt`, as critique.why.<key> keys (most telling
 * first): facts that hold between the two steps, never numbers.
 */
function whySlower(mine, alt, ctx) {
  const out = [];
  const turns = alg => String(alg || '').split(/\s+/).filter(t => t && !isRotationTok(t)).length;
  const rots = alg => String(alg || '').split(/\s+/).filter(t => t && isRotationTok(t)).length;
  if (rots(mine.coreAlg) > rots(alt.coreAlg)) out.push('rotation');
  // longer: more moves per piece (the alternative may solve other pieces)
  const pieces = r => (ctx.isRoot ? 4 : 0) + (r.corners || []).length + (r.edges ? r.edges.length : (r.corners || []).length);
  const pm = Math.max(1, pieces(mine)), pa = Math.max(1, pieces(alt));
  if ((turns(mine.coreAlg) / pm) * pa > turns(alt.coreAlg) + 1) out.push('longer');
  if (flowOf(mine.coreAlg) > flowOf(alt.coreAlg) * 1.08) out.push('awkward');
  if (ctx.mineView && ctx.altView && !ctx.finishing) {
    if (ctx.altView.connected > ctx.mineView.connected) out.push('no_free_pair');
    if (ctx.altView.badEdgesU < ctx.mineView.badEdgesU && ctx.edgesAllowed) out.push('edges');
  }
  if (!out.length) out.push('slower');
  return out;
}

/**
 * { items: [{ text, alt, altRow, stepIndex, startMove, rank, total, gap, outside, why }], total }.
 * opts: { search(fork, { multislot }) -> Promise<results>, answers, onProgress(done, total),
 *   allow(r) -> false for a result the solver has switched off or is above
 *   their level (never suggested as the alternative) }.
 */
async function critiqueSolve(session, opts = {}) {
  const rows = session.committedRows.slice();
  const items = [];
  let startMove = 0;
  let pairs = 0;
  const edgesAllowed = typeof goalAllowed !== 'function' || goalAllowed('pair_influencing', opts.answers);
  for (let k = 0; k < rows.length; k++) {
    const row = rows[k];
    const fork = session.fork();
    while (fork.committedRows.length > k) fork.undo();
    const isRoot = fork.isAtRoot;
    const node = session.nodeMap.get(row.targetNodeId);
    const after = node ? (node.state.corners || []).length : pairs;
    const label = typeof stepLabel === 'function' ? stepLabel(k === 0, pairs, after, /pseudo/i.test(row.type || '')) : `step ${k + 1}`;
    const mine = tokensOf(row, isRoot);
    // multislot searches (the slowest part of a later step) only for a multislot step
    const multislot = !isRoot && (row.corners || []).length > 1;
    let results = [];
    try { results = (await opts.search(fork, { multislot })) || []; } catch (err) { results = []; }
    if (opts.onProgress) opts.onProgress(k + 1, rows.length);
    const sameGoal = results.filter(r => r.targetNodeId === row.targetNodeId);
    const at = sameGoal.findIndex(r => sameStep(r, row, isRoot));
    // what may be suggested: what the solver has switched on (and their level allows)
    const allowed = opts.allow ? results.filter(r => sameStep(r, row, isRoot) || opts.allow(r)) : results;
    const best = allowed[0] || null;
    const myTpp = at >= 0 ? sameGoal[at].tpp : row.tpp;
    const gap = best && Number.isFinite(myTpp) ? Math.max(0, myTpp - best.tpp) : 0;
    const why = at >= 0 ? null : outsideReason(row, isRoot, session);
    const item = { stepIndex: k, startMove, label, rank: at >= 0 ? at + 1 : null, total: sameGoal.length, gap, outside: why, alt: '', altRow: null, why: [] };
    const viewOf = (r) => {
      try {
        const f = replayFacelets(session.scramble, isRoot ? r.rotation : fork.rotation, isRoot ? '' : fork.scoredPath, r.coreAlg);
        return solvedFlags(f).cross ? cubeView(f) : null;
      } catch (err) { return null; }
    };
    // the similar better step: the same pieces, starting like mine the longest, then the fastest
    const better = sameGoal.filter(r => !sameStep(r, row, isRoot) && Number.isFinite(r.tpp) && !(Number.isFinite(myTpp) && r.tpp >= myTpp - 1e-9)
      && (!opts.allow || opts.allow(r)));
    const bestSame = better.reduce((b, r) => (!b || r.tpp < b.tpp ? r : b), null);
    const fine = !!bestSame && Number.isFinite(myTpp) && myTpp <= bestSame.tpp * (1 + FINE_MARGIN);
    let alt = null;
    let shared = 0;
    for (const r of better) {
      const n = sharedStart(mine, tokensOf(r, isRoot));
      if (!alt || n > shared || (n === shared && r.tpp < alt.tpp)) { alt = r; shared = n; }
    }
    if (alt && fine && !why) {
      // close to the best: a fine choice; the quicker one only as an option
      item.text = caption('critique.step.fine', { label });
      item.alt = caption('critique.alt.optional', { alg: tokensOf(alt, isRoot).join(' ') });
      item.altRow = alt;
      item.fine = true;
    } else if (alt) {
      const keys = why ? [`outside.${outsideKey(why)}`] : [];
      for (const w of whySlower(row, alt, {
        mineView: viewOf(row), altView: viewOf(alt), finishing: after >= 4, edgesAllowed, isRoot,
      })) keys.push(`why.${w}`);
      item.why = keys.slice(0, 2);
      item.text = caption('critique.step.slower', { label, why: item.why.map(x => caption(`critique.${x}`)).join(' ') });
      item.alt = caption(shared > 0 ? 'critique.alt.similar' : 'critique.alt.samePieces', { alg: tokensOf(alt, isRoot).join(' ') });
      item.altRow = alt;
    } else if (best && best.targetNodeId !== row.targetNodeId && Number.isFinite(myTpp) && best.tpp < myTpp * (1 - OTHER_GOAL_MARGIN)) {
      // the best of its kind, but another goal was faster here (a cross where an xcross was there)
      const bestNode = session.nodeMap.get(best.targetNodeId);
      const bestAfter = bestNode ? (bestNode.state.corners || []).length : after;
      const otherLabel = typeof stepLabel === 'function' ? stepLabel(k === 0, pairs, bestAfter, /pseudo/i.test(best.type || '')) : '';
      item.text = caption('critique.step.bestOfKind', { label });
      item.alt = caption('critique.alt.otherGoal', { alg: tokensOf(best, isRoot).join(' '), other: otherLabel });
      item.altRow = best;
    } else {
      item.text = caption(at === 0 || !why ? 'critique.step.top' : 'critique.step.goodOutside', { label });
    }
    items.push(item);
    startMove += mine.length;
    pairs = after;
  }
  const slow = items.filter(x => x.why.length).length;
  const totalKey = !slow ? 'critique.total.great' : slow * 2 <= items.length ? 'critique.total.good' : 'critique.total.work';
  return { items, total: caption(totalKey) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { critiqueSolve, outsideReason, outsideKey, whySlower, sharedStart, FINE_MARGIN };
}
