/**
 * critique.js — the buddy goes through a whole solution (README "Critique").
 *
 * The steps are the solution's committed steps (solve-editor.js reads them
 * off the typed text by replaying it). Each one is compared with the
 * solver's list for the same node: every result of the step's search,
 * unfiltered, at the same goal (the pieces it solved), the way the tuning
 * tools rank a professional's step in the app's list. Reported: its rank,
 * its TPP gap to the step the solver would play, and that step with the
 * fact that makes it better (shorter, no rotation, a free pair, oriented
 * edges...). A step the search cannot contain (longer than the move limit,
 * slices, a wide b, two rotations) is said to be outside it, never forced
 * into a rank; one it can contain but that ranks below the kept results
 * (the best 300 of each step type) is said to be below them.
 *
 * Engine-agnostic: the caller passes `search(fork, { multislot }) -> Promise<results>`.
 */
'use strict';

const isRotationTok = t => /^[xyz]/.test(t);

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

/**
 * { items: [{ text, alt, altRow, stepIndex, startMove, rank, total, gap, outside }], total }.
 * opts: { search(fork, { multislot }) -> Promise<results>, answers, onProgress(done, total) }.
 */
async function critiqueSolve(session, opts = {}) {
  const rows = session.committedRows.slice();
  const items = [];
  let startMove = 0;
  let pairs = 0;
  const style = opts.answers && opts.answers.style === 'efficiency' ? 'efficiency' : 'tps';
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
    const best = results[0] || null;
    const myTpp = at >= 0 ? sameGoal[at].tpp : row.tpp;
    const gap = best && Number.isFinite(myTpp) ? Math.max(0, myTpp - best.tpp) : 0;
    const item = { stepIndex: k, startMove, label, rank: at >= 0 ? at + 1 : null, total: sameGoal.length, gap, outside: null, alt: '', altRow: null };
    if (at === 0 && best && sameStep(best, row, isRoot)) {
      item.text = caption('critique.step.top', { label });
    } else if (at >= 0) {
      item.text = caption('critique.step.rank', { label, rank: at + 1, total: sameGoal.length, gap: gap.toFixed(2) });
    } else {
      const why = outsideReason(row, isRoot, session);
      if (why) {
        item.outside = why;
        item.text = caption('critique.step.outside', { label, why, tpp: Number.isFinite(row.tpp) ? row.tpp.toFixed(2) : '-' });
      } else {
        // in the search, but the list keeps only the best results of each step type
        item.text = caption('critique.step.below', { label, total: results.length, gap: gap.toFixed(2) });
      }
    }
    // the step the solver would play instead, and what makes it better
    if (best && !sameStep(best, row, isRoot)) {
      let reasons = [];
      try {
        const viewOf = (r) => {
          const f = replayFacelets(session.scramble, isRoot ? r.rotation : fork.rotation, isRoot ? '' : fork.scoredPath, r.coreAlg);
          return solvedFlags(f).cross ? cubeView(f) : null;
        };
        reasons = reasonsFor(best, {
          best: row, rank: 1, before: viewOf(row), after: viewOf(best), stepAlgs: isRoot ? [] : fork.stepAlgs,
          answers: opts.answers, isRoot,
        }).filter(x => x.key !== 'fastest' && x.key !== 'cancels');
      } catch (err) { reasons = []; }
      if (style === 'efficiency') reasons.sort((a, b) => (b.key === 'shorter') - (a.key === 'shorter'));
      const reason = reasons.length ? caption(`reason.${reasons[0].key}`, reasons[0].vars) : caption('reason.fastest');
      if (gap > 0.005 || reasons.length) {
        item.alt = caption('critique.alt', { alg: tokensOf(best, isRoot).join(' '), reason });
        item.altRow = best;
      }
    }
    items.push(item);
    startMove += mine.length;
    pairs = after;
  }
  const last = rows[rows.length - 1];
  const counts = typeof moveCounts === 'function' ? moveCounts(session).text : '';
  return {
    items,
    total: caption('critique.total', { stm: counts, tpp: last && Number.isFinite(last.tpp) ? last.tpp.toFixed(2) : '-' }),
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { critiqueSolve, outsideReason };
}
