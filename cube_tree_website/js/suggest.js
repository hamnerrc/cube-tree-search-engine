/**
 * suggest.js — the avatar's three picks and their reasons (README "Avatar").
 *
 * The picks come from the step's ranked list (the same one the top 5 show);
 * the ranking itself is never changed. Pick 1 is the best TPP. Pick 2
 * depends on the solver's style: an efficiency solver gets the shortest step
 * within PICK_MARGIN of the best, a TPS solver the one that flows best (the
 * least time per turn). Pick 3 sets up what comes next: the look-ahead's best
 * when look-ahead is on, else the step leaving the best pair-choice view
 * (free pairs, oriented edges, open slots in front). Picks differ in
 * family (not the same moves after an AUF or rotation), and nothing above
 * the solver's level is suggested unless they chose to learn it.
 *
 * Reasons are facts, each with a captions.js key ('reason.<key>'); the
 * wording is the developer's.
 */
'use strict';

const PICK_MARGIN = 0.10;   // picks 2 and 3: within 10% of the best TPP
// Which facts a pick leads with, by its role (and pick 2 by style).
const ROLE_REASONS = {
  best: ['fastest', 'multislot', 'cancels', 'free_pair', 'no_rotation'],
  efficiency: ['shorter', 'multislot', 'no_rotation', 'cancels'],
  tps: ['smoother', 'wide_ergonomic', 'no_rotation', 'shorter'],
  setup: ['lookahead_best', 'free_pair', 'edges_good', 'back_slots', 'multislot', 'no_rotation'],
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

/**
 * The reasons for candidate `r`: [{ key, vars }] (most telling first).
 * ctx: { best, before (cubeView), after (cubeView), stepAlgs, rank, answers, lookahead }.
 */
function reasonsFor(r, ctx) {
  const out = [];
  const allowed = id => typeof goalAllowed !== 'function' || goalAllowed(id, ctx.answers);
  const best = ctx.best;
  if (ctx.rank === 0) out.push({ key: 'fastest' });
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
  if (ctx.before && ctx.after) {
    if (ctx.after.connected > ctx.before.connected) out.push({ key: 'free_pair' });
    if (ctx.after.badEdgesU < ctx.before.badEdgesU && allowed('pair_influencing')) out.push({ key: 'edges_good' });
  }
  if (best && r !== best) {
    const d = stmOf(best.coreAlg) - stmOf(r.coreAlg);
    if (d >= 2) out.push({ key: 'shorter', vars: { n: d } });
    else if (d < 0 && ctx.flow && ctx.flow(r) < ctx.flow(best)) out.push({ key: 'smoother' });
  }
  if (!rotationsIn(r.coreAlg) && best && (r === best ? false : rotationsIn(best.coreAlg) > 0)) out.push({ key: 'no_rotation' });
  if (typeof isWideAlg === 'function' && isWideAlg(r.coreAlg) && allowed('wide_cross')) out.push({ key: 'wide_ergonomic' });
  if ((r.corners || []).some(c => /^B/.test(c)) && !ctx.isRoot) out.push({ key: 'back_slots' });
  return out;
}

/**
 * The avatar's picks from `results` (ranked, filtered): up to 3 of
 * { r, role, reasons }. ctx: { style, answers, isRoot, stepAlgs, viewOf(r) ->
 * cubeView after r, before: cubeView now, lookahead: depth > 1 }.
 */
function avatarPicks(results, ctx = {}) {
  const list = (results || []).filter(r => Number.isFinite(r.tpp));
  if (!list.length) return [];
  const allowed = id => typeof goalAllowed !== 'function' || goalAllowed(id, ctx.answers);
  const usable = r => !(r.multislot && !allowed('multislot'));
  const best = list[0];
  const picks = [{ r: best, role: 'best' }];
  const families = new Set([pickFamily(best)]);
  const within = m => list.filter(r => r.tpp <= best.tpp * (1 + m) && usable(r) && !families.has(pickFamily(r)));
  const flowMemo = new Map();
  const flow = (r) => {
    if (!flowMemo.has(r)) {
      const n = Math.max(1, stmOf(r.coreAlg));
      flowMemo.set(r, (typeof algSpeed === 'function' ? algSpeed(r.coreAlg, false, false) : n) / n);
    }
    return flowMemo.get(r);
  };
  // pick 2: by style
  const near = within(PICK_MARGIN);
  let second = null;
  if (ctx.style === 'efficiency') {
    second = near.slice().sort((a, b) => stmOf(a.coreAlg) - stmOf(b.coreAlg) || a.tpp - b.tpp)[0];
    if (second && stmOf(second.coreAlg) >= stmOf(best.coreAlg)) second = near[0];
  } else {
    second = near.slice().sort((a, b) => flow(a) - flow(b) || a.tpp - b.tpp)[0];
  }
  if (!second) second = list.find(r => usable(r) && !families.has(pickFamily(r)));
  if (second) { picks.push({ r: second, role: `style.${ctx.style === 'efficiency' ? 'efficiency' : 'tps'}` }); families.add(pickFamily(second)); }
  // pick 3: sets up the next step
  let third = null;
  let lookaheadBest = false;
  if (ctx.lookahead) {
    const done = list.filter(r => Number.isFinite(r.lookaheadTpp) && usable(r));
    const top = done.slice().sort((a, b) => a.lookaheadTpp - b.lookaheadTpp)[0];
    if (top && !families.has(pickFamily(top))) { third = top; lookaheadBest = true; }
  }
  if (!third && ctx.viewOf && !ctx.finishing) {
    const pool = within(SETUP_MARGIN).slice(0, 40);
    let bestVal = Infinity;
    for (const r of pool) {
      const v = ctx.viewOf(r);
      if (!v) continue;
      const val = setupValue(v);
      if (val < bestVal) { bestVal = val; third = r; }
    }
  }
  if (!third) third = list.find(r => usable(r) && !families.has(pickFamily(r)));
  if (third) picks.push({ r: third, role: 'setup', lookaheadBest });
  // reasons, led by what the pick is for; a reason another pick already
  // leads with goes to the back
  const used = new Set();
  return picks.map((p) => {
    const rank = list.indexOf(p.r);
    const after = ctx.viewOf ? ctx.viewOf(p.r) : null;
    const reasons = reasonsFor(p.r, {
      best, rank, before: ctx.before, after, stepAlgs: ctx.stepAlgs, answers: ctx.answers,
      lookahead: ctx.lookahead, lookaheadBest: p.lookaheadBest, flow, isRoot: ctx.isRoot,
    });
    const lead = ROLE_REASONS[p.role === 'best' ? 'best' : p.role === 'setup' ? 'setup' : ctx.style === 'efficiency' ? 'efficiency' : 'tps'];
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
  module.exports = { avatarPicks, reasonsFor, pickFamily, stmOf, setupValue, cubeView, PICK_MARGIN };
}
