/**
 * Which suggestions to show, and why.
 */
'use strict';

const PICK_MARGIN = 0.10;   // the efficiency pick: within 10% of the best TPP
const SMOOTH_TOP = 3;       // the smoother pick: among the top three
const SMOOTH_EXTRA = 2;     // ... more than this many moves above the move-optimal step
const ROLE_REASONS = {
  best: ['fastest', 'multislot', 'cancels', 'free_pair', 'no_rotation'],
  efficiency: ['shorter', 'efficient', 'multislot', 'no_rotation', 'cancels'],
  tps: ['smoother', 'wide_ergonomic', 'no_rotation', 'shorter'],
  setup: ['lookahead_best', 'free_pair', 'edges_good', 'back_slots', 'multislot', 'no_rotation'],
  next: ['nearly', 'no_rotation', 'shorter', 'free_pair', 'cancels'],
};
const SETUP_MARGIN = 0.16;

const isRotTok = t => /^[xyz]/.test(t);
const stmOf = alg => String(alg || '').split(/\s+/).filter(t => t && !isRotTok(t)).length;
const piecesOf = (r, isRoot) => {
  const corners = (r.corners || []).length;
  return (isRoot ? 4 : 0) + corners + (r.edges ? r.edges.length : corners);
};
function movesSaved(r, best, isRoot) {
  const pr = piecesOf(r, isRoot), pb = piecesOf(best, isRoot);
  if (!pr || !pb) return 0;
  return (stmOf(best.coreAlg) / pb) * pr - stmOf(r.coreAlg);
}
const rotationsIn = alg => String(alg || '').split(/\s+/).filter(t => t && isRotTok(t)).length;

function pickFamily(r) {
  const toks = String(r.coreAlg || '').split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < toks.length && (/^[UD]/.test(toks[i]) || isRotTok(toks[i]))) i++;
  return `${r.targetNodeId}|${toks.slice(i).join(' ')}`;
}

function cubeView(facelets) {
  const look = pairLookFeatures(facelets);
  const plan = planFeatures(facelets);
  const v = {};
  LOOK_FEATURES.forEach((k, i) => { v[k] = look[i]; });
  PLAN_FEATURES.forEach((k, i) => { v[k] = plan[i]; });
  return v;
}

function setupValue(v) {
  const w = typeof PAIR_PLANNING !== 'undefined' ? PAIR_PLANNING : { look: [0, 0, 0, 0, 0], plan: [0, 0, 0, 0] };
  return LOOK_FEATURES.reduce((s, k, i) => s + w.look[i] * v[k], 0) + PLAN_FEATURES.reduce((s, k, i) => s + w.plan[i] * v[k], 0);
}

function leavesFreePair(before, after) {
  return !!after && after.connected > (before ? before.connected : 0);
}

function isSmoother(r, rank, best, optimal) {
  const n = stmOf(r.coreAlg);
  return rank > 0 && rank < SMOOTH_TOP && Number.isFinite(optimal) && n > optimal + SMOOTH_EXTRA && n > stmOf(best.coreAlg);
}

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
    const saved = movesSaved(r, best, ctx.isRoot);
    const same = piecesOf(r, ctx.isRoot) === piecesOf(best, ctx.isRoot);
    // fewer moves per piece: "n moves shorter" for the same pieces, else "fewer moves per piece"
    if (saved >= 2 - 1e-9) out.push(same ? { key: 'shorter', vars: { n: Math.round(saved) } } : { key: 'efficient' });
    else if (ctx.optimalStm && isSmoother(r, ctx.rank, best, ctx.optimalStm(r))) out.push({ key: 'smoother' });
  }
  if (!rotationsIn(r.coreAlg) && best && (r === best ? false : rotationsIn(best.coreAlg) > 0)) out.push({ key: 'no_rotation' });
  if (typeof isWideAlg === 'function' && isWideAlg(r.coreAlg) && allowed('wide_cross')) out.push({ key: 'wide_ergonomic' });
  if ((r.corners || []).some(c => /^B/.test(c)) && !ctx.isRoot) out.push({ key: 'back_slots' });
  return out;
}

function searcherPicks(results, ctx = {}) {
  const list = (results || []).filter(r => Number.isFinite(r.tpp));
  if (!list.length) return [];
  const allowed = id => typeof goalAllowed !== 'function' || goalAllowed(id, ctx.answers);
  const usable = r => !(r.multislot && !allowed('multislot'));
  const best = list[0];
  const picks = [{ r: best, role: 'best' }];
  const families = new Set([pickFamily(best)]);
  const fresh = r => usable(r) && !families.has(pickFamily(r));
  const optimal = new Map();
  for (const r of list) {
    const n = stmOf(r.coreAlg);
    if (!(optimal.get(r.targetNodeId) <= n)) optimal.set(r.targetNodeId, n);
  }
  const optimalStm = r => optimal.get(r.targetNodeId);
  let second = null;
  if (ctx.style === 'efficiency') {
    const isRoot = !!ctx.isRoot;
    const mpp = r => stmOf(r.coreAlg) / Math.max(1, piecesOf(r, isRoot));
    second = list.filter(r => r.tpp <= best.tpp * (1 + PICK_MARGIN) && fresh(r) && movesSaved(r, best, isRoot) >= 2 - 1e-9)
      .sort((a, b) => mpp(a) - mpp(b) || a.tpp - b.tpp)[0] || null;
  } else {
    second = list.slice(1, SMOOTH_TOP).find((r, i) => fresh(r) && isSmoother(r, i + 1, best, optimalStm(r))) || null;
  }
  if (second) { picks.push({ r: second, role: `style.${ctx.style === 'efficiency' ? 'efficiency' : 'tps'}` }); families.add(pickFamily(second)); }
  let third = null;
  let lookaheadBest = false;
  if (ctx.lookahead) {
    const done = list.filter(r => Number.isFinite(r.lookaheadTpp) && usable(r));
    const top = done.slice().sort((a, b) => a.lookaheadTpp - b.lookaheadTpp)[0];
    if (top && !families.has(pickFamily(top))) { third = top; lookaheadBest = true; }
  }
  if (!third && ctx.viewOf && !ctx.finishing && !leavesFreePair(ctx.before, ctx.viewOf(best))) {
    third = list.filter(r => r.tpp <= best.tpp * (1 + SETUP_MARGIN) && fresh(r)).slice(0, 60)
      .find(r => leavesFreePair(ctx.before, ctx.viewOf(r))) || null;
  }
  if (third) picks.push({ r: third, role: 'setup', lookaheadBest });
  // Never fewer than two: the next fastest of another family, nearly as quick
  if (picks.length < 2) {
    const next = list.slice(1, 60).find(r => fresh(r) && !picks.some(p => p.r === r));
    if (next) { picks.push({ r: next, role: 'next' }); families.add(pickFamily(next)); }
  }
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
  module.exports = { searcherPicks, reasonsFor, pickFamily, stmOf, piecesOf, movesSaved, setupValue, cubeView, isSmoother, leavesFreePair, PICK_MARGIN };
}
