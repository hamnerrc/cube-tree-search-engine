/**
 * suggest.js — the tree-searcher's picks and their reasons (README "Tree-searcher").
 *
 * The picks come from the step's ranked list; the ranking itself is never
 * changed. Every pick has to be justified by a fact, never by taste
 * (developer, 2026-10-11):
 * 1. the fastest (best TPP);
 * 2. only when one is quantifiably different: a TPS solver gets a
 *    **smoother** step -- one of the top three that is more than two moves
 *    longer than the move-optimal step for the same goal (and longer than
 *    the fastest), so its turns must flow; an efficiency solver a step at
 *    least two moves shorter than the fastest within PICK_MARGIN;
 * 3. the **free pair setup**: the fastest step within SETUP_MARGIN that
 *    leaves more free pairs than there are now (or the look-ahead's best
 *    when look-ahead is on).
 * 4. when only one of those exists, the next fastest of another family
 *    (developer, 2026-10-13: always two to four suggestions).
 * Picks differ in family (not the same
 * moves after an AUF or rotation), and nothing above the solver's level is
 * suggested unless they chose to learn it.
 *
 * Reasons are facts, each with a captions.js key ('reason.<key>'); the
 * wording is the developer's.
 */
'use strict';

const PICK_MARGIN = 0.10;   // the efficiency pick: within 10% of the best TPP
const SMOOTH_TOP = 3;       // the smoother pick: among the top three
const SMOOTH_EXTRA = 2;     // ... more than this many moves above the move-optimal step
// Which facts a pick leads with, by its role (and pick 2 by style).
const ROLE_REASONS = {
  best: ['fastest', 'multislot', 'cancels', 'free_pair', 'no_rotation'],
  efficiency: ['shorter', 'multislot', 'no_rotation', 'cancels'],
  tps: ['smoother', 'wide_ergonomic', 'no_rotation', 'shorter'],
  setup: ['lookahead_best', 'free_pair', 'edges_good', 'back_slots', 'multislot', 'no_rotation'],
  next: ['nearly', 'no_rotation', 'shorter', 'free_pair', 'cancels'],
};
const SETUP_MARGIN = 0.16;

const isRotTok = t => /^[xyz]/.test(t);
const stmOf = alg => String(alg || '').split(/\s+/).filter(t => t && !isRotTok(t)).length;
const rotationsIn = alg => String(alg || '').split(/\s+/).filter(t => t && isRotTok(t)).length;

/** The moves a step is "really" made of: without leading AUFs and rotations. */
function pickFamily(r) {
  const toks = String(r.coreAlg || '').split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < toks.length && (/^[UD]/.test(toks[i]) || isRotTok(toks[i]))) i++;
  return `${r.targetNodeId}|${toks.slice(i).join(' ')}`;
}

/** Look and plan features of the cube a candidate leaves (and the cube before), as numbers by name. */
function cubeView(facelets) {
  const look = pairLookFeatures(facelets);
  const plan = planFeatures(facelets);
  const v = {};
  LOOK_FEATURES.forEach((k, i) => { v[k] = look[i]; });
  PLAN_FEATURES.forEach((k, i) => { v[k] = plan[i]; });
  return v;
}

/** Pair-choice value of a view (lower is better), with the app's planning weights. */
function setupValue(v) {
  const w = typeof PAIR_PLANNING !== 'undefined' ? PAIR_PLANNING : { look: [0, 0, 0, 0, 0], plan: [0, 0, 0, 0] };
  return LOOK_FEATURES.reduce((s, k, i) => s + w.look[i] * v[k], 0) + PLAN_FEATURES.reduce((s, k, i) => s + w.plan[i] * v[k], 0);
}

/** More free (connected) pairs after the step than before it; the first step starts with none. */
function leavesFreePair(before, after) {
  return !!after && after.connected > (before ? before.connected : 0);
}

/**
 * The quantified "smoother" (README "Tree-searcher"): among the top three, more than
 * SMOOTH_EXTRA moves above the move-optimal step for the same goal, and
 * longer than the fastest -- it ranks that high only because its turns flow.
 */
function isSmoother(r, rank, best, optimal) {
  const n = stmOf(r.coreAlg);
  return rank > 0 && rank < SMOOTH_TOP && Number.isFinite(optimal) && n > optimal + SMOOTH_EXTRA && n > stmOf(best.coreAlg);
}

/**
 * The reasons for candidate `r`: [{ key, vars }] (most telling first).
 * ctx: { best, before (cubeView), after (cubeView), stepAlgs, rank, answers, lookahead }.
 */
function reasonsFor(r, ctx) {
  const out = [];
  const allowed = id => typeof goalAllowed !== 'function' || goalAllowed(id, ctx.answers);
  const best = ctx.best;
  if (ctx.rank === 0) out.push({ key: 'fastest' });
  if (ctx.role === 'next') out.push({ key: 'nearly' });
  if (r.multislot && allowed('multislot')) {
    const n = (r.corners || []).length;
    if (n > 1) out.push({ key: 'multislot', vars: { n } });
  }
  if (ctx.lookahead && r.lookaheadAlgs && r.lookaheadAlgs.length && ctx.lookaheadBest) {
    out.push({ key: 'lookahead_best', vars: { next: r.lookaheadAlgs.join(' | ') } });
  }
  if (ctx.stepAlgs && ctx.stepAlgs.length && typeof candidateCancellation === 'function' && candidateCancellation(ctx.stepAlgs, r.coreAlg)) {
    out.push({ key: 'cancels' });
  }
  if (ctx.after && leavesFreePair(ctx.before, ctx.after)) out.push({ key: 'free_pair' });
  if (ctx.before && ctx.after && ctx.after.badEdgesU < ctx.before.badEdgesU && allowed('pair_influencing')) out.push({ key: 'edges_good' });
  if (best && r !== best) {
    const d = stmOf(best.coreAlg) - stmOf(r.coreAlg);
    if (d >= 2) out.push({ key: 'shorter', vars: { n: d } });
    else if (ctx.optimalStm && isSmoother(r, ctx.rank, best, ctx.optimalStm(r))) out.push({ key: 'smoother' });
  }
  if (!rotationsIn(r.coreAlg) && best && (r === best ? false : rotationsIn(best.coreAlg) > 0)) out.push({ key: 'no_rotation' });
  if (typeof isWideAlg === 'function' && isWideAlg(r.coreAlg) && allowed('wide_cross')) out.push({ key: 'wide_ergonomic' });
  if ((r.corners || []).some(c => /^B/.test(c)) && !ctx.isRoot) out.push({ key: 'back_slots' });
  return out;
}

/**
 * The tree-searcher's picks from `results` (ranked, filtered): up to 3 of
 * { r, role, reasons }. ctx: { style, answers, isRoot, stepAlgs, viewOf(r) ->
 * cubeView after r, before: cubeView now, lookahead: depth > 1 }.
 */
function searcherPicks(results, ctx = {}) {
  const list = (results || []).filter(r => Number.isFinite(r.tpp));
  if (!list.length) return [];
  const allowed = id => typeof goalAllowed !== 'function' || goalAllowed(id, ctx.answers);
  const usable = r => !(r.multislot && !allowed('multislot'));
  const best = list[0];
  const picks = [{ r: best, role: 'best' }];
  const families = new Set([pickFamily(best)]);
  const fresh = r => usable(r) && !families.has(pickFamily(r));
  // the move-optimal step for each goal in the list
  const optimal = new Map();
  for (const r of list) {
    const n = stmOf(r.coreAlg);
    if (!(optimal.get(r.targetNodeId) <= n)) optimal.set(r.targetNodeId, n);
  }
  const optimalStm = r => optimal.get(r.targetNodeId);
  // pick 2: only when quantifiably different, by style
  let second = null;
  if (ctx.style === 'efficiency') {
    second = list.filter(r => r.tpp <= best.tpp * (1 + PICK_MARGIN) && fresh(r) && stmOf(best.coreAlg) - stmOf(r.coreAlg) >= 2)
      .sort((a, b) => stmOf(a.coreAlg) - stmOf(b.coreAlg) || a.tpp - b.tpp)[0] || null;
  } else {
    second = list.slice(1, SMOOTH_TOP).find((r, i) => fresh(r) && isSmoother(r, i + 1, best, optimalStm(r))) || null;
  }
  if (second) { picks.push({ r: second, role: `style.${ctx.style === 'efficiency' ? 'efficiency' : 'tps'}` }); families.add(pickFamily(second)); }
  // pick 3: the free pair setup (or the look-ahead's best)
  let third = null;
  let lookaheadBest = false;
  if (ctx.lookahead) {
    const done = list.filter(r => Number.isFinite(r.lookaheadTpp) && usable(r));
    const top = done.slice().sort((a, b) => a.lookaheadTpp - b.lookaheadTpp)[0];
    if (top && !families.has(pickFamily(top))) { third = top; lookaheadBest = true; }
  }
  // (none when the fastest already leaves a free pair: it is that setup)
  if (!third && ctx.viewOf && !ctx.finishing && !leavesFreePair(ctx.before, ctx.viewOf(best))) {
    third = list.filter(r => r.tpp <= best.tpp * (1 + SETUP_MARGIN) && fresh(r)).slice(0, 60)
      .find(r => leavesFreePair(ctx.before, ctx.viewOf(r))) || null;
  }
  if (third) picks.push({ r: third, role: 'setup', lookaheadBest });
  // never fewer than two (developer, 2026-10-13: between two and four
  // suggestions): the next fastest of another family, nearly as quick
  if (picks.length < 2) {
    const next = list.slice(1, 60).find(r => fresh(r) && !picks.some(p => p.r === r));
    if (next) { picks.push({ r: next, role: 'next' }); families.add(pickFamily(next)); }
  }
  // reasons, led by what the pick is for; a reason another pick already
  // leads with goes to the back
  const used = new Set();
  return picks.map((p) => {
    const rank = list.indexOf(p.r);
    const after = ctx.viewOf ? ctx.viewOf(p.r) : null;
    const reasons = reasonsFor(p.r, {
      role: p.role, best, rank, before: ctx.before, after, stepAlgs: ctx.stepAlgs, answers: ctx.answers,
      lookahead: ctx.lookahead, lookaheadBest: p.lookaheadBest, optimalStm, isRoot: ctx.isRoot,
    });
    const lead = ROLE_REASONS[p.role === 'best' || p.role === 'setup' || p.role === 'next' ? p.role : ctx.style === 'efficiency' ? 'efficiency' : 'tps'];
    const order = (x) => {
      const i = lead.indexOf(x.key);
      return (used.has(x.key) ? 100 : 0) + (i < 0 ? 50 : i);
    };
    reasons.sort((a, b) => order(a) - order(b));
    if (reasons.length) used.add(reasons[0].key);
    return { r: p.r, role: p.role, rank, reasons };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { searcherPicks, reasonsFor, pickFamily, stmOf, setupValue, cubeView, isSmoother, leavesFreePair, PICK_MARGIN };
}
