/**
 * The solution bar's logic.
 *
 * The text the user types is the source of truth. It is read as lines of
 * moves with optional `// comments`; the steps are found by replaying it on
 * the facelet cube, never taken from a claim:
 *
 * - committed steps the text still starts with are kept (a clicked or
 *   tab-filled suggestion keeps its row: pseudo pairs, its TPP);
 * - after them, at each line end, the moves so far are replayed; once the
 *   cross is solved and the solved pairs are a strict superset of the
 *   current ones, they form a new step (a line that finishes nothing is
 *   merged into the next, the way pro reconstructions are segmented);
 * - whatever follows the last step is the tail: the step being typed.
 *
 * Nothing typed is ever refused: text that finishes no step just stays the
 * tail, and the suggestions wait until it does.
 */
'use strict';

/**
 * The lines of an editor text: [{ start, end, code, comment, tokens: [{ tok,
 * start, end, valid }] }], offsets into `text`; `code` is the part before
 * '//'.
 */
function editorLines(text) {
  const out = [];
  let start = 0;
  for (const raw of String(text).split('\n')) {
    const cut = raw.indexOf('//');
    const code = cut >= 0 ? raw.slice(0, cut) : raw;
    const tokens = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(code))) {
      tokens.push({ tok: m[0], start: start + m.index, end: start + m.index + m[0].length, valid: isMoveToken(m[0]) });
    }
    out.push({ start, end: start + raw.length, code, comment: cut >= 0 ? raw.slice(cut + 2).trim() : null, commentStart: cut >= 0 ? start + cut : -1, tokens });
    start += raw.length + 1;
  }
  return out;
}

const SE_ROTATION = /^[xyz](2'|2|'|)$/;
// "U2'" is "U2": typed half turns are compared and committed in the
// search's spelling (the engine path only knows X2).
const normTok = t => (t.length > 2 && t.endsWith("2'") ? t.slice(0, -1) : t);

/** A committed row's tokens as typed: the first step's inspection rotation, then its alg. */
function rowTokens(row, first) {
  const alg = String(row.coreAlg || '').split(/\s+/).filter(Boolean);
  if (!first) return alg;
  return [...String(row.rotation || '').split(/\s+/).filter(Boolean), ...alg];
}

/** Solved pairs (slot names) of a cube, or null when its cross is not solved. */
function solvedPairsOf(facelets) {
  const f = solvedFlags(facelets);
  return f.cross ? F2L_SLOTS.filter(s => f[s]) : null;
}

/**
 * The row for a step the user wrote (`tokens`, after the committed steps of
 * `session`), scored exactly as a search scores a corpus step; null when it
 * does not finish a step: the cross unsolved, a solved pair broken, nothing new
 * solved, or a node outside the tree.
 */
function userStepRow(session, tokens) {
  const isRoot = session.isAtRoot;
  let k = 0;
  if (isRoot) while (k < tokens.length && SE_ROTATION.test(tokens[k])) k++;
  const rotation = isRoot ? tokens.slice(0, k).map(normTok).join(' ') : session.rotation;
  const alg = tokens.slice(k).map(normTok).join(' ');
  if (!alg || tokens.some(t => !isMoveToken(t))) return null;
  const held = replayFacelets(session.scramble, rotation, isRoot ? '' : session.scoredPath, alg);
  const pairs = solvedPairsOf(held); // named in the frame the step ends in (the node's labels)
  if (!pairs) return null;
  // kept and new pairs are compared in the frame the step starts in: a y
  // inside the step renames every slot
  const stepRotation = netRotation(alg);
  const unrotated = stepRotation ? applyAlgorithm(held, inverseRotation(stepRotation)) : held;
  const pairsStart = isRoot ? pairs : (solvedPairsOf(unrotated) || []);
  const before = isRoot ? [] : (session.currentNode.state.corners || []);
  if (!before.every(s => pairsStart.includes(s)) || (!isRoot && pairsStart.length === before.length)) return null;
  const targetNodeId = nodeByLabels(session, pairs, pairs);
  if (!targetNodeId || targetNodeId === session.currentNodeId) return null;
  const target = session.nodeMap.get(targetNodeId);
  // the pair-choice term of the cube it leaves, as the search adds it
  const probe = isRoot ? Object.assign(Object.create(SolveSession.prototype), session, { rotation, stepAlgs: [], committedRows: [] }) : session;
  let look = 0;
  const lw = lookWeightsFor(probe);
  if (lw) {
    const f = pairLookFeatures(unrotated);
    for (let i = 0; i < lw.length; i++) look += lw[i] * f[i];
  }
  const planWeights = probe.planning !== false && typeof PAIR_PLANNING !== 'undefined' ? PAIR_PLANNING.plan : null;
  const plan = planCost(planWeights, held);
  const pieces = calculateSolvedPieces(session.rootNode, target);
  const isFinished = pairs.length === 4;
  const tpp = (probe.pathCost(alg) + (isFinished ? 0 : look + plan)) / pieces;
  const down = held[31]; // the D centre: the cross colour
  const COLOUR_BY_FACELET = { W: 'white', Y: 'yellow', G: 'green', B: 'blue', R: 'red', O: 'orange' };
  const newPairs = pairsStart.filter(s => !before.includes(s)); // in the start frame, as a search's rows name them
  return {
    color: isRoot ? COLOUR_BY_FACELET[down] : (session.committedRows[0] ? session.committedRows[0].color : ''),
    type: edgeTypeLabel(isRoot ? pairs.length : newPairs.length, isRoot, false),
    rotation,
    edges: newPairs,
    corners: newPairs,
    coreAlg: alg,
    tpp: Number.isFinite(tpp) ? tpp : Infinity,
    targetNodeId,
    user: true,
  };
}

/** The label a reconstruction gives a step (solutionLines' wording): "cross", "2nd pair", "3rd/4th pairs". */
function stepLabel(isFirst, pairsBefore, pairsAfter, pseudo = false) {
  const ordinal = n => ['1st', '2nd', '3rd', '4th'][n - 1] || `${n}th`;
  let label;
  if (isFirst) label = ['cross', 'xcross', 'xxcross', 'xxxcross'][pairsAfter] || `cross + ${pairsAfter} pairs`;
  else if (pairsAfter - pairsBefore <= 1) label = `${ordinal(pairsAfter)} pair`;
  else label = `${ordinal(pairsBefore + 1)}/${ordinal(pairsAfter)} pairs`;
  return pseudo ? `${label} (pseudo)` : label;
}

/** A candidate's row as committed (look-ahead annotations describe the ranking, not the step). */
function committableRow(candidate) {
  const { lookaheadPending, lookaheadTpp, lookaheadAlgs, lookaheadTruncated, unorthodox, multislot, key, ...row } = candidate;
  return row;
}

/**
 * Reads `text` against `session`: { keep, steps, tail, lines } where `keep`
 * is how many committed rows the text still starts with, `steps` the new
 * rows after them ({ row, firstLine, lastLine }), `tail` the tokens after the
 * last step ({ tokens, partial, line }: `partial` is the token the caret is
 * still typing, when the text does not end in white space), and `lines` per
 * line: { kind: 'step'|'tail'|'merged'|'empty', label }.
 * `candidates`: the current step's list; a step that equals one of them
 * commits that row. The session is not changed (a fork is used).
 */
function readSolution(session, text, candidates = []) {
  const lines = editorLines(text);
  const info = lines.map(() => ({ kind: 'empty', label: null }));
  const flat = [];
  lines.forEach((l, li) => l.tokens.forEach(t => flat.push({ ...t, line: li })));
  // committed rows the text still starts with
  let pos = 0;
  let keep = 0;
  const rows = session.committedRows;
  for (; keep < rows.length; keep++) {
    const want = rowTokens(rows[keep], keep === 0);
    if (!want.length) continue;
    const got = flat.slice(pos, pos + want.length).map(t => normTok(t.tok));
    if (got.length !== want.length || got.some((t, i) => t !== want[i])) break;
    // a kept step must end its line (the next one starts a new line)
    const last = flat[pos + want.length - 1];
    const next = flat[pos + want.length];
    if (next && next.line === last.line) break;
    if (!next && !String(text).slice(last.end).includes('\n')) break; // still on the step's line: it is the tail
    for (let li = flat[pos].line; li <= last.line; li++) info[li] = { kind: 'step', label: null, row: keep };
    pos += want.length;
  }
  const s = session.fork();
  while (s.committedRows.length > keep) s.undo();
  const steps = [];
  let from = pos;
  const lineEnds = new Set();
  // a token is the last of its line when the next token is on a later line,
  // or it is the last token and the text goes on to a new line after it
  for (let i = from; i < flat.length; i++) {
    const nx = flat[i + 1];
    if (nx ? nx.line > flat[i].line : String(text).slice(flat[i].end).includes('\n')) lineEnds.add(i);
  }
  // a step: the tokens flat[from..i] read as one, committed when they finish
  // one (`final`: only when they finish the whole F2L)
  const tryStep = (i, final) => {
    const toks = flat.slice(from, i + 1).map(t => normTok(t.tok));
    let row = null;
    // the list belongs to the session's current step: only for the first new step right after it
    const cand = candidates.length && steps.length === 0 && keep === rows.length ? candidates.find(c => {
      const want = rowTokens(c, s.isAtRoot);
      return want.length === toks.length && want.every((t, j) => t === toks[j]);
    }) : null;
    if (cand) row = committableRow(cand);
    else row = userStepRow(s, toks);
    if (!row) return false;
    if (final) {
      const node = s.nodeMap.get(row.targetNodeId);
      if (!node || (node.state.corners || []).length < 4) return false;
    }
    const before = s.isAtRoot ? 0 : (s.currentNode.state.corners || []).length;
    const first = s.isAtRoot;
    s.commit(row);
    const after = (s.currentNode.state.corners || []).length;
    const firstLine = flat[from].line;
    const lastLine = flat[i].line;
    for (let li = firstLine; li <= lastLine; li++) info[li] = { kind: li === lastLine ? 'step' : 'merged', label: null, row: keep + steps.length };
    info[lastLine].label = stepLabel(first, before, after, /pseudo/i.test(row.type || ''));
    if (first && firstLine < lastLine && lines[firstLine].tokens.every(t => SE_ROTATION.test(t.tok))) info[firstLine].label = 'inspection';
    steps.push({ row, firstLine, lastLine });
    from = i + 1;
    return true;
  };
  for (let i = from; i < flat.length; i++) {
    if (!lineEnds.has(i)) continue;
    if (s.isComplete) break;
    tryStep(i, false);
  }
  // The step that finishes the F2L needs no line end after it
  if (from < flat.length && !s.isComplete && !lineEnds.has(flat.length - 1)) tryStep(flat.length - 1, true);
  const tailTokens = flat.slice(from);
  const endsInSpace = /\s$/.test(String(text)) || !String(text).length;
  for (const t of tailTokens) if (info[t.line].kind === 'empty') info[t.line] = { kind: 'tail', label: null };
  const tail = {
    tokens: tailTokens.map(t => t.tok),
    partial: !endsInSpace && tailTokens.length ? tailTokens[tailTokens.length - 1].tok : '',
    line: tailTokens.length ? tailTokens[0].line : lines.length - 1,
    onNewLine: !tailTokens.length,
  };
  // labels for kept steps: the solution's own wording
  let pairsSoFar = 0;
  rows.slice(0, keep).forEach((row, k) => {
    const node = session.nodeMap.get(row.targetNodeId);
    const after = node ? (node.state.corners || []).length : pairsSoFar;
    const li = info.map((x, j) => (x.row === k && x.kind === 'step' ? j : -1)).filter(j => j >= 0).pop();
    if (li !== undefined) info[li].label = stepLabel(k === 0, pairsSoFar, after, /pseudo/i.test(row.type || ''));
    pairsSoFar = after;
  });
  return { keep, steps, tail, lines: info, parsed: lines };
}

/**
 * Results whose tokens start with what is typed: every complete token must
 * match, and the token still being typed must start the next one ("R" matches
 * R, R' and R2). At the first step a result reads as its inspection rotation,
 * then its alg.
 */
function prefixMatches(results, typed, partial, isRoot) {
  typed = typed.map(normTok);
  const done = partial ? typed.slice(0, -1) : typed;
  const out = [];
  for (const r of results) {
    const toks = rowTokens(r, isRoot);
    if (toks.length < done.length + (partial ? 1 : 0)) continue;
    let ok = true;
    for (let i = 0; i < done.length; i++) if (toks[i] !== done[i]) { ok = false; break; }
    if (ok && partial && !toks[done.length].startsWith(partial)) ok = false;
    if (ok) out.push({ r, toks });
  }
  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { editorLines, readSolution, userStepRow, stepLabel, prefixMatches, rowTokens, committableRow, normTok };
}
