#!/usr/bin/env node
/**
 * Tunes alg_speed on professional solves (README "Ranking"): a good alg_speed
 * ranks the step a professional actually executed near the top of the
 * alternatives the engine finds for the same goal.
 *
 *   node tools/tune-alg-speed.js pools [--max 5000] [--extra 2] [--top 300] [--keep 700] [--shard k/n]
 *       For every DAG step of every solve in data/reco_solves.txt and
 *       data/pro_references.txt: the engine's solutions of that step's goal
 *       (pro move set, up to the pro's length + --extra moves, at most --max,
 *       shortest first; later steps also the corpus algs the app adds,
 *       solver-bridge.js corpusSolutions) plus the spellings the app adds (rotation, wide,
 *       inspection variants; never a wide b). Keeps the --top best distinct
 *       algs under the current scoring, a random sample of --keep of the
 *       rest, and the pool size. Cached per solve in --cache
 *       (JSON lines; resumable). ~0.1-1 s per step.
 *   node tools/tune-alg-speed.js eval [--params k=v,...] [--look app|w1,...,w5]
 *       --look adds the pair-choice term (script.js PAIR_CHOICE_LOOK, README
 *       "Pair choice") of the cube each alg leaves, replayed physically.
 *       Where the pro steps rank under the app's scoring, per group.
 *   node tools/tune-alg-speed.js corpus
 *       Writes js/pro-steps.js (the language model's professional corpus) from the data files.
 *   node tools/tune-alg-speed.js fit [--fit a,b,c] [--rounds 3]
 *       Coordinate search on the training group (mean log10 rank of the pro
 *       step), reporting the held-out groups after every round.
 *
 * Groups: by solver. --train "Yiheng Wang" (default; a comma list for several) is fitted; every other
 * solver and data/pro_references.txt are held out. The naturalness model is
 * never scored on a solve it was trained on: training solves are scored with
 * a model built without their fold (5 folds by solve), held-out solves with
 * a model built from the training solves only.
 *
 * Cost of a step (as SolveSession.pathCost): algSpeed(prior steps + step)
 * + stepPenalty(step); the prior steps' own penalties are the same for every
 * alternative and cancel. Rank 1 = the pro's step scores best. Steps that a
 * ZB / VH / winter-variation last slot produces ("zbls", "vls", "wvls",
 * "ols") are left out: they are chosen for the last layer, not for speed;
 * so are steps over 16 turns (longer than anything the app searches).
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.join(__dirname, '..');
const js = path.join(root, 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js']) Object.assign(global, require(path.join(js, f)));
const { loadProReferences, segmentProSolve } = require('./pro-references.js');
const S = require(path.join(js, 'script.js'));
const F = require(path.join(js, 'facelet-cube.js'));

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
// --cache a.jsonl,b.jsonl reads several (shards); pools writes to the first.
const cacheFiles = opt('cache', path.join(os.tmpdir(), 'cubetree-tune-pools.jsonl')).split(',');
const cacheFile = cacheFiles[0];
const DATA = [path.join(root, 'data', 'reco_solves.txt'), path.join(root, 'data', 'pro_references.txt')];
// --train "A,B": the solvers fitted on (the rest is held out).
const TRAIN = new Set(opt('train', 'Yiheng Wang').split(',').map(x => x.trim()));
const isTrain = s => TRAIN.has(s.solver);
const EXCLUDED_LABEL = /zbls|vls|wvls|\bols\b/i;

/** Every solve of the data files with a stable key and its solver. */
function loadSolves() {
  const out = [];
  for (const file of DATA) {
    const base = path.basename(file, '.txt');
    loadProReferences(file).forEach((solve, i) => {
      const parts = (solve.source || '').split('|').map(s => s.trim());
      const id = /reco\.nz\/solve\/(\d+)/.test(parts[0]) ? `reco${RegExp.$1}` : `${base}#${i + 1}`;
      out.push({ ...solve, key: id, solver: parts[1] || base, segAlgs: segmentProSolve(solve).map(g => g.alg) });
    });
  }
  return out;
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
function hashKey(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------- pools

async function buildPools() {
  const { CONFIGS, searchSegment } = require('./pro-search.js');
  const { hasWideB, corpusSolutions } = require(path.join(js, 'solver-bridge.js'));
  const maxSolutions = Number(opt('max', '5000'));
  const extra = Number(opt('extra', '2'));
  const keep = Number(opt('keep', '700'));
  const keepTop = Number(opt('top', '300'));
  const done = new Set();
  for (const f of cacheFiles) if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) if (l) done.add(JSON.parse(l).key);
  const CrossSolverHelperNode = require(path.join(root, 'crossSolver', 'solver-helper-node.js'));
  const h = new CrossSolverHelperNode(); await h.init();
  // --shard k/n: this process builds every n-th solve (run n processes, one cache file each, then cat them).
  const [shard, shards] = (opt('shard', '0/1')).split('/').map(Number);
  const solves = loadSolves().filter((s, i) => i % shards === shard && !done.has(s.key));
  console.error(`${done.size} solves cached, ${solves.length} to go -> ${cacheFile}`);
  const t0 = Date.now();
  for (let i = 0; i < solves.length; i++) {
    const solve = solves[i];
    const segs = segmentProSolve(solve);
    const out = [];
    let prior = [];
    for (const seg of segs) {
      // A long pro step searched 2 moves deeper can take many minutes; the
      // pool then keeps what the engine found by the deadline (shortest first).
      let { raw } = await searchSegment(h, solve, seg, prior.join(' '), CONFIGS.extended, maxSolutions, 0, extra, Date.now() + 20000);
      // Later steps: the corpus algs the app adds (solver-bridge.js corpusSolutions).
      if (!seg.isRoot) {
        const session = { scramble: solve.scramble, rotation: solve.inspection, scoredPath: prior.join(' '), proMoves: true, currentNode: { state: { corners: seg.before.pairs } } };
        const plan = [{ isPseudo: false, allCorners: seg.afterStart.pairs, maxLength: seg.alg.split(' ').length + extra }];
        for (const algs of corpusSolutions(session, plan).values()) raw = raw.concat(algs);
      }
      const proKey = F.commuteNormalize(seg.alg);
      const pool = new Map(); // commuteNormalize key -> alg
      const add = a => { if (!hasWideB(a)) { const k = F.commuteNormalize(a); if (!pool.has(k)) pool.set(k, a); } };
      for (const a of raw) {
        if (seg.isRoot && /^[xyz]/.test(a)) continue; // the app shows these as inspection variants
        const spellings = [a];
        if (!a.split(' ').some(t => /^[xyz]/.test(t))) {
          for (const sp of F.rotationSpellings(a, !seg.isRoot)) if (sp.split(' ').filter(t => /^[xyz]/.test(t)).length <= 1) spellings.push(sp);
        }
        if (!seg.isRoot) for (const { alg } of F.wideSpellingParts(a)) spellings.push(alg);
        for (const sp of spellings) {
          add(sp);
          if (seg.isRoot) {
            for (const t of ['y', 'y2', "y'"]) add(F.relabelAlgForRotation(sp, t));
            for (const v of F.inspectionWideVariants(sp)) add(v.alg);
          }
        }
      }
      const proInPool = pool.delete(proKey);
      // The `top` best alternatives under the current app scoring (exact
      // resolution where it matters: near the pro's rank), then a random
      // sample of the rest; `size` counts all of them.
      const all = [...pool.values()];
      const base = S.algSpeedPrefix(prior.join(' '));
      const appCost = a => S.algSpeedResume(base, a) + S.stepPenalty(a);
      const scored = all.map(a => [appCost(a), a]).sort((x, y) => x[0] - y[0]);
      const top = scored.slice(0, keepTop).map(x => x[1]);
      const rest = scored.slice(keepTop).map(x => x[1]);
      const rnd = seeded(hashKey(`${solve.key}/${out.length}`));
      for (let k = 0; k < Math.min(keep, rest.length); k++) { const j = k + Math.floor(rnd() * (rest.length - k)); [rest[k], rest[j]] = [rest[j], rest[k]]; }
      out.push({ labels: seg.labels.join('+'), isRoot: seg.isRoot, priorSteps: prior.slice(), pro: seg.alg, proInPool, size: all.length, top, rest: rest.slice(0, keep), restSize: rest.length });
      prior.push(seg.alg);
    }
    fs.appendFileSync(cacheFile, JSON.stringify({ key: solve.key, solver: solve.solver, segs: out }) + '\n');
    if ((i + 1) % 10 === 0) console.error(`${i + 1}/${solves.length} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  await h.terminate?.();
}

/**
 * Complete-search pools (`cpools`): for every pro step, what the app itself
 * lists for that step's goal -- SolveSession at the pro's node (the pro's
 * earlier steps committed), searchCurrentNode restricted to the edge that
 * solves the same physical pairs, the complete search's exact best --top
 * (default 300) by TPP, corpus candidates included. Each alg is stored with
 * its pair-choice cost (look + planning: TPP x pieces - pathCost), which
 * alg_speed parameters do not change, so `eval`/`fit` re-rank the list
 * exactly. Built with the naturalness model the solve is scored with (out of
 * fold / training solves only), like the metric. Ranks beyond --top are
 * censored (rank = list size + 1).
 */
const F2L_SLOTS = ['BL', 'BR', 'FR', 'FL'];
const SLOT_CENTRES = { FR: [22, 13], FL: [22, 40], BR: [49, 13], BL: [49, 40] };
const slotColours = (f, s) => SLOT_CENTRES[s].map(i => f[i]).sort().join('');
async function buildCompletePools() {
  for (const f of ['spelling-search.js']) Object.assign(global, require(path.join(js, f)));
  const B = require(path.join(js, 'solver-bridge.js'));
  const { completeSpaceStatus } = require('./complete-coverage.js');
  const keepTop = Number(opt('top', '300'));
  const done = new Set();
  for (const f of cacheFiles) if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf8').split('\n')) if (l) done.add(JSON.parse(l).key);
  const CrossSolverHelperNode = require(path.join(root, 'crossSolver', 'solver-helper-node.js'));
  const h = new CrossSolverHelperNode(); await h.init();
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const advanced = ['xcross', 'xxcross', 'xxxcross', 'multislotting'];
  const [shard, shards] = (opt('shard', '0/1')).split('/').map(Number);
  // --solves N: every solver's first N solves (in file order) only.
  const perSolver = Number(opt('solves', 'Infinity'));
  const count = new Map();
  const all = loadSolves().filter((s) => { const n = (count.get(s.solver) || 0) + 1; count.set(s.solver, n); return n <= perSolver; });
  const models = buildModels(loadSolves(), currentParams());
  const solves = all.filter((s, i) => i % shards === shard && !done.has(s.key));
  console.error(`${done.size} solves cached, ${solves.length} to go -> ${cacheFile}`);
  const look = (f) => {
    const w = S.PAIR_PLANNING.look;
    const x = pairLookFeatures(f);
    let v = 0;
    for (let k = 0; k < w.length; k++) v += w[k] * x[k];
    const pf = planFeatures(f);
    for (let k = 0; k < S.PAIR_PLANNING.plan.length; k++) v += S.PAIR_PLANNING.plan[k] * pf[k];
    return v;
  };
  const t0 = Date.now();
  for (let i = 0; i < solves.length; i++) {
    const solve = solves[i];
    S.useNaturalnessModel(models(solve));
    const segs = segmentProSolve(solve);
    const color = segs[segs.length - 1].after.crossColor;
    const pruned = S.pruneGraph(tree, { advanced, colors: [color] });
    const session = new B.SolveSession(solve.scramble, pruned, [color], advanced);
    session.topN = keepTop;
    session.resultViews = [{ test: () => true, wide: true }];
    const allEdges = session.outgoingEdges.bind(session);
    const out = [];
    let prior = [];
    for (const seg of segs) {
      const ts = Date.now();
      const proEnd = F.applyAlgorithm(SOLVED_FACELETS, [solve.scramble, solve.inspection, ...prior, seg.alg].filter(Boolean).join(' '));
      const endFlags = solvedFlags(proEnd);
      const proPairs = new Set(F2L_SLOTS.filter(s => endFlags[s]).map(s => slotColours(proEnd, s)));
      const before = F.applyAlgorithm(SOLVED_FACELETS, [solve.scramble, session.isAtRoot ? B.COLOR_ROTATIONS[color] : session.rotation, session.scoredPath].filter(Boolean).join(' '));
      const labels = F2L_SLOTS.filter(s => proPairs.has(slotColours(before, s))).sort();
      const want = JSON.stringify(labels);
      const record = { labels: seg.labels.join('+'), isRoot: seg.isRoot, priorSteps: prior.slice(), pro: seg.alg, top: [], topLook: [], rest: [], restSize: 0, size: 0, complete: true };
      const targetNode = pruned.nodes.find(n => n.state.cross_solved && JSON.stringify((n.state.corners || []).slice().sort()) === want && JSON.stringify((n.state.edges || []).slice().sort()) === want);
      session.outgoingEdges = () => allEdges().filter(e => e.target === (targetNode && targetNode.id) || (targetNode && JSON.stringify(session.nodeMap.get(e.target).state) === JSON.stringify(targetNode.state)));
      const proBase = session.pathCost(seg.alg);
      record.proLook = look(proEnd);
      record.proInSpace = completeSpaceStatus(seg);
      if (!targetNode || !session.outgoingEdges().length) {
        record.skipped = 'no such edge';
      } else {
        const results = await B.searchCurrentNode(session, h, null);
        const pieces = calculateSolvedPieces(session.rootNode, targetNode);
        const proKey = F.commuteNormalize(seg.alg);
        for (const r of results) {
          const lk = r.tpp * pieces - session.pathCost(r.coreAlg);
          if (F.commuteNormalize(r.coreAlg) === proKey) {
            record.proInList = true;
            if (Math.abs(lk - record.proLook) > 1e-6) record.lookMismatch = lk - record.proLook;
            continue;
          }
          record.top.push(r.coreAlg);
          record.topLook.push(+lk.toFixed(6));
        }
        record.size = record.top.length;
        record.proCost = +(proBase + record.proLook).toFixed(6);
      }
      record.ms = Date.now() - ts;
      out.push(record);
      session.outgoingEdges = allEdges;
      const target = B.nodeByLabels(session, seg.after.pairs, seg.after.pairs);
      session.commit({ rotation: solve.inspection, coreAlg: seg.alg, targetNodeId: target, color });
      prior.push(seg.alg);
    }
    S.useNaturalnessModel(null);
    fs.appendFileSync(cacheFile, JSON.stringify({ key: solve.key, solver: solve.solver, segs: out }) + '\n');
    console.error(`${i + 1}/${solves.length} ${solve.key} ${out.map(r => `${r.labels}:${r.ms}ms`).join(' ')} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  await h.terminate?.();
}

function loadPools() {
  const out = [];
  for (const f of cacheFiles) {
    if (!fs.existsSync(f)) throw new Error(`no pools at ${f}; run: node tools/tune-alg-speed.js pools`);
    for (const l of fs.readFileSync(f, 'utf8').split('\n')) if (l) out.push(JSON.parse(l));
  }
  return out;
}

// ---------------------------------------------------------------- scoring

const MCC_KEYS = Object.keys(S.ALG_SPEED_DEFAULTS);
const PEN_KEYS = Object.keys(S.STEP_PENALTIES);
const LM_KEYS = ['order', 'discount', 'proWeight'];

function currentParams() {
  return { ...S.ALG_SPEED_DEFAULTS, ...S.STEP_PENALTIES, turns: 0, midXZ: 0, order: S.NATURALNESS.order, discount: S.NATURALNESS.discount, proWeight: S.NATURALNESS.proWeight };
}

/** Naturalness models: per training fold, and one for the held-out groups. */
function buildModels(solves, params) {
  const trainSolves = solves.filter(isTrain);
  const opts = { order: params.order, discount: params.discount, proWeight: params.proWeight };
  const stepsOf = list => list.map(s => s.segAlgs);
  const foldOf = s => hashKey(s.key) % 5;
  const folds = [0, 1, 2, 3, 4].map(f => S.buildNaturalnessModel({ ...opts, proSteps: stepsOf(trainSolves.filter(s => foldOf(s) !== f)) }));
  const heldOut = S.buildNaturalnessModel({ ...opts, proSteps: stepsOf(trainSolves) });
  return s => (isTrain(s) ? folds[foldOf(s)] : heldOut);
}

// stepPenalty(alg) = sum over STEP_PENALTIES of weight x feature; the
// features are computed once per alg (checked against stepPenalty itself).
// Candidate features not (yet) in stepPenalty, weight 0 unless fitted
// (--fit turns,midXZ): a turn count and mid-step x/z rotations.
const FEATS = ['D', 'F', 'B', 'wideRL', 'wideUDFB', 'wideOther', 'rotMidY', 'natural'];
const EXTRA_FEATS = ['turns', 'midXZ'];
const ALL_FEATS = [...FEATS, ...EXTRA_FEATS];
const NF = ALL_FEATS.length;
if (FEATS.slice().sort().join() !== PEN_KEYS.slice().sort().join()) throw new Error(`stepPenalty changed: ${PEN_KEYS} vs ${FEATS}; update FEATS`);
function featuresInto(out, o, alg) {
  const tokens = alg.split(' ').filter(Boolean);
  for (let k = 0; k < NF; k++) out[o + k] = 0;
  tokens.forEach((t, i) => {
    const c = t[0];
    const k = c === 'D' ? 0 : c === 'F' ? 1 : c === 'B' ? 2 : (c === 'r' || c === 'l') ? 3
      : 'udfb'.includes(c) ? 4 : 'MES'.includes(c) ? 5 : (c === 'y' && i > 0) ? 6 : -1;
    if (k >= 0) out[o + k]++;
    if (!'xyz'.includes(c)) out[o + 8]++;
    else if (c !== 'y' && i > 0) out[o + 9]++;
  });
  out[o + 7] = tokens.length ? S.algSurprise(tokens) : 0;
}

/**
 * Per-step cache for fitting (index 0 = the pro's step, then the pool's top
 * alternatives, then up to `sample` of its random rest): every alternative's MCC (for the current MCC
 * parameters) and penalty features. Penalty
 * weights then re-rank without recomputing anything; an MCC parameter
 * recomputes `mcc`, a language-model parameter the `natural` feature.
 */
function buildCache(pools, solvesByKey, sample, filter) {
  const cache = [];
  for (const p of pools) {
    const solve = solvesByKey.get(p.key);
    if (!solve || !filter(solve)) continue;
    for (const seg of p.segs) {
      if (EXCLUDED_LABEL.test(seg.labels) || !seg.size) continue;
      // Longer than any step the app searches (a 4-pair multislot is 16 turns).
      if (seg.pro.split(' ').filter(t => !/^[xyz]/.test(t)).length > 16) continue;
      const rest = seg.rest.length > sample ? seg.rest.slice(0, sample) : seg.rest;
      const algs = [seg.pro, ...seg.top, ...rest];
      // Complete pools: each alg's pair-choice cost (look + planning), fixed.
      const look = new Float64Array(algs.length);
      if (seg.complete) { look[0] = seg.proLook; seg.topLook.forEach((v, k) => { look[k + 1] = v; }); }
      cache.push({
        solve, group: solve.solver, isRoot: seg.isRoot, size: seg.size, nTop: seg.top.length, restWeight: rest.length ? seg.restSize / rest.length : 0,
        // the pro's step can be the app's top result: in its pool, or (complete pools) in the search's space
        proInPool: seg.complete ? seg.proInSpace === 'in the search' : seg.proInPool,
        complete: !!seg.complete, prior: seg.priorSteps.join(' ').split(' ').filter(Boolean), algs, look, mcc: new Float64Array(algs.length), feat: new Float64Array(algs.length * NF),
      });
    }
  }
  return cache;
}
function fillMcc(cache, params) {
  const vals = MCC_KEYS.map(k => params[k]);
  for (const c of cache) {
    let tail = [];
    let state = null;
    if (c.prior.length) {
      const st = S.algSpeed(c.prior, false, false, ...vals, null, c.prior.length);
      tail = c.prior.slice(st.offset);
      state = { offset: 0, starts: st.starts };
    }
    for (let i = 0; i < c.algs.length; i++) {
      const toks = c.algs[i].split(' ');
      c.mcc[i] = (state ? S.algSpeed(tail.concat(toks), false, false, ...vals, state) : S.algSpeed(toks, false, false, ...vals)) + c.look[i];
    }
  }
}
function fillFeatures(cache, models, onlyNatural = false) {
  for (const c of cache) {
    S.useNaturalnessModel(models(c.solve));
    for (let i = 0; i < c.algs.length; i++) {
      if (onlyNatural) c.feat[i * NF + 7] = S.algSurprise(c.algs[i]);
      else featuresInto(c.feat, i * NF, c.algs[i]);
    }
  }
  S.useNaturalnessModel(null);
}
/** [{ group, isRoot, rank, frac, proInPool }] for penalty weights `params`. */
function rankCache(cache, params) {
  const w = ALL_FEATS.map(k => params[k] || 0);
  return cache.map(c => {
    const cost = i => { let t = c.mcc[i]; const o = i * NF; for (let k = 0; k < NF; k++) t += w[k] * c.feat[o + k]; return t; };
    const pro = cost(0);
    // Every top alternative counts once, each sampled one for restWeight.
    let better = 0;
    for (let i = 1; i <= c.nTop; i++) if (cost(i) < pro) better++;
    let betterRest = 0;
    for (let i = c.nTop + 1; i < c.algs.length; i++) if (cost(i) < pro) betterRest++;
    better += betterRest * c.restWeight;
    // the app's top result for this goal: the best of the pool (and the pro's
    // own step when the search can produce it)
    let top1 = c.proInPool ? 0 : -1;
    let top1Cost = c.proInPool ? pro : Infinity;
    for (let i = 1; i <= c.nTop; i++) { const v = cost(i); if (v < top1Cost) { top1Cost = v; top1 = i; } }
    return { group: c.group, train: isTrain(c.solve), isRoot: c.isRoot, rotates: / [xyz]/.test(` ${c.algs[0]}`), frac: better / c.size, rank: 1 + Math.round(better), proInPool: c.proInPool, top1: top1 >= 0 ? classesOf(c, top1) : null, pro: classesOf(c, 0) };
  });
}

/**
 * Move types whose frequency in the app's top result is compared with the
 * pro's step (does the step contain one?): the top result should use each
 * about as often as professionals do. Turns: the mean count.
 */
const MOVE_CLASSES = [
  ['wide', t => /^[rludfb]/.test(t)],
  ['wide r/l', t => /^[rl]/.test(t)],
  ['wide u/d/f', t => /^[udf]/.test(t)],
  ['slice', t => /^[MES]/.test(t)],
  ['D', t => t[0] === 'D'],
  ['F', t => t[0] === 'F'],
  ['B', t => t[0] === 'B'],
  ['L', t => t[0] === 'L'],
  ['half turn', t => /^[RLUDFBrludfb]2/.test(t)],
];
const NCLS = MOVE_CLASSES.length + 3; // + mid-step y, mid-step x/z, leading rotation
const CLASS_NAMES = [...MOVE_CLASSES.map(c => c[0]), 'mid-step y', 'mid-step x/z', 'leading rotation'];
function classesOf(c, i) {
  if (!c.cls) c.cls = new Map();
  let v = c.cls.get(i);
  if (v) return v;
  const toks = c.algs[i].split(' ').filter(Boolean);
  v = { has: new Uint8Array(NCLS), turns: 0 };
  let first = true;
  for (const t of toks) {
    if (/^[xyz]/.test(t)) {
      if (first) v.has[NCLS - 1] = 1;
      else v.has[t[0] === 'y' ? NCLS - 3 : NCLS - 2] = 1;
      continue;
    }
    first = false;
    v.turns++;
    MOVE_CLASSES.forEach(([, f], k) => { if (f(t)) v.has[k] = 1; });
  }
  c.cls.set(i, v);
  return v;
}
/**
 * Move-type frequency gap: per group of steps, for every class, the share
 * of top results containing it vs the share of pro steps; the loss is
 * sum of (gap^2 / (p (1 - p) + 0.01)) with p the mean of the two shares
 * (a chi-square-like distance), plus (turns gap / 2)^2.
 */
function moveFrequencies(results) {
  const rs = results.filter(r => r.top1);
  const top = new Float64Array(NCLS);
  const pro = new Float64Array(NCLS);
  let tTop = 0;
  let tPro = 0;
  for (const r of rs) {
    for (let k = 0; k < NCLS; k++) { top[k] += r.top1.has[k]; pro[k] += r.pro.has[k]; }
    tTop += r.top1.turns;
    tPro += r.pro.turns;
  }
  const n = rs.length || 1;
  let loss = ((tTop - tPro) / n / 2) ** 2;
  const rows = [];
  for (let k = 0; k < NCLS; k++) {
    const a = top[k] / n;
    const b = pro[k] / n;
    const p = (a + b) / 2;
    loss += (a - b) ** 2 / (p * (1 - p) + 0.01);
    rows.push([CLASS_NAMES[k], a, b]);
  }
  rows.push(['turns (mean)', tTop / n, tPro / n]);
  return { n: rs.length, loss, rows };
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
function summarize(results) {
  const groups = new Map();
  for (const r of results) {
    for (const g of [r.group, `${r.group} ${r.isRoot ? 'first' : 'later'}`, `all ${r.isRoot ? 'first' : 'later'}`, ...(r.rotates && !r.isRoot ? [`${r.group} later, rotating`] : []), ...(r.train ? ['train'] : [])]) {
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(r);
    }
  }
  const out = {};
  for (const [g, rs] of groups) {
    out[g] = {
      n: rs.length,
      freq: moveFrequencies(rs),
      logRank: mean(rs.map(r => Math.log10(r.rank))),
      top1: rs.filter(r => r.rank <= 1).length / rs.length,
      top10: rs.filter(r => r.rank <= 10).length / rs.length,
      pct: mean(rs.map(r => r.frac)),
    };
  }
  return out;
}
function printSummary(sum, label = '') {
  for (const g of Object.keys(sum).sort()) {
    const s = sum[g];
    console.log(`${label}${g.padEnd(30)} n ${String(s.n).padStart(5)}  mean log10 rank ${s.logRank.toFixed(3)}  top1 ${(100 * s.top1).toFixed(1)}%  top10 ${(100 * s.top10).toFixed(1)}%  mean pct ${(100 * s.pct).toFixed(2)}%  move-type gap ${s.freq.loss.toFixed(3)}`);
  }
}
/** The move-type frequencies of the top results vs the pro steps (README "Tuning data"). */
function printFrequencies(sum, groups) {
  for (const g of groups) {
    if (!sum[g]) continue;
    const f = sum[g].freq;
    console.log(`\n${g} (${f.n} steps): share of steps containing each move type, app's top result vs professional`);
    for (const [name, a, b] of f.rows) console.log(`  ${name.padEnd(18)} top ${name.startsWith('turns') ? a.toFixed(2).padStart(6) : (100 * a).toFixed(1).padStart(5) + '%'}   pro ${name.startsWith('turns') ? b.toFixed(2).padStart(6) : (100 * b).toFixed(1).padStart(5) + '%'}`);
    console.log(`  gap ${f.loss.toFixed(3)}`);
  }
}

function parseParams(spec) {
  return Object.fromEntries((spec || '').split(',').filter(Boolean).map(kv => { const [k, v] = kv.split('='); return [k, Number(v)]; }));
}

function setup(sample) {
  const solves = loadSolves();
  const solvesByKey = new Map(solves.map(s => [s.key, s]));
  const pools = loadPools();
  const params = { ...currentParams(), ...parseParams(opt('params', '')) };
  const models = buildModels(solves, params);
  const train = buildCache(pools, solvesByKey, sample, isTrain);
  const held = buildCache(pools, solvesByKey, sample, s => !isTrain(s));
  for (const c of [train, held]) { fillMcc(c, params); fillFeatures(c, models); }
  // The cached features must reproduce stepPenalty exactly.
  for (const k of PEN_KEYS) S.STEP_PENALTIES[k] = params[k];
  for (const c of train.slice(0, 50)) {
    S.useNaturalnessModel(models(c.solve));
    for (let i = 0; i < Math.min(5, c.algs.length); i++) {
      let t = 0;
      FEATS.forEach((k, j) => { t += params[k] * c.feat[i * NF + j]; });
      if (Math.abs(t - S.stepPenalty(c.algs[i])) > 1e-9) throw new Error(`feature mismatch on ${c.algs[i]}`);
    }
  }
  S.useNaturalnessModel(null);
  return { solves, params, models, train, held };
}

// Adds weights . pairLookFeatures(cube after the alg) to every cached cost.
// A root pool also lists algs relabelled for another inspection y: the frame
// is the one in which the alg solves the cross (the features ignore y).
function addLook(cache, weights) {
  for (const c of cache) {
    const before = [c.solve.scramble, c.solve.inspection, ...c.prior].filter(Boolean).join(' ');
    for (let i = 0; i < c.algs.length; i++) {
      let f = null;
      for (const t of c.isRoot ? ['', 'y', 'y2', "y'"] : ['']) {
        const g = F.applyAlgorithm(SOLVED_FACELETS, [before, t, c.algs[i]].filter(Boolean).join(' '));
        if (solvedFlags(g).cross) { f = g; break; }
      }
      if (!f) continue;
      const x = pairLookFeatures(f);
      for (let k = 0; k < 5; k++) c.mcc[i] += weights[k] * x[k];
    }
  }
}

function evaluate() {
  const t0 = Date.now();
  const { params, train, held } = setup(Number(opt('sample', 'Infinity')));
  const look = opt('look', '');
  if (look) addLook([...train, ...held], look === 'app' ? S.PAIR_CHOICE_LOOK : look.split(',').map(Number));
  const res = rankCache([...train, ...held], params);
  const sum = summarize(res);
  printSummary(sum);
  printFrequencies(sum, ['all first', 'all later']);
  console.log(`\npro step found by the search: ${res.filter(r => r.proInPool).length}/${res.length}; ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

function fit() {
  const t0 = Date.now();
  const sample = Number(opt('sample', '300'));
  let { solves, params, models, train, held } = setup(sample);
  console.error(`cache built (${train.length} train steps, ${held.length} held out) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const keys = (opt('fit', [...PEN_KEYS, ...MCC_KEYS].join(','))).split(',');
  const rounds = Number(opt('rounds', '3'));
  const score = (cache, p) => summarize(rankCache(cache, p));
  let best = score(train, params).train.logRank;
  const report = tag => {
    const s = { ...score(train, params), ...score(held, params) };
    const held2 = Object.keys(s).filter(g => g !== 'train' && !TRAIN.has(g) && !/ (first|later|rotating)$/.test(g));
    console.log(`${tag}: train ${s.train.logRank.toFixed(4)} (top10 ${(100 * s.train.top10).toFixed(1)}%, pct ${(100 * s.train.pct).toFixed(2)}) | ${held2.map(g => `${g} ${s[g].logRank.toFixed(4)} (top10 ${(100 * s[g].top10).toFixed(1)}%, pct ${(100 * s[g].pct).toFixed(2)})`).join(' | ')}  [${((Date.now() - t0) / 1000).toFixed(0)} s]`);
  };
  report('start');
  const mults = [0, 0.5, 0.7, 0.85, 0.93, 1.07, 1.15, 1.4, 2];
  for (let r = 0; r < rounds; r++) {
    let improved = false;
    for (const k of keys) {
      const cur = params[k];
      const isMcc = MCC_KEYS.includes(k);
      const isLm = LM_KEYS.includes(k);
      const cands = isLm
        ? (k === 'order' ? [2, 3, 4] : k === 'discount' ? [0.5, 0.6, 0.75, 0.85, 0.95] : [1, 3, 10])
        : [...new Set([...mults.map(m => +(cur * m).toPrecision(3)), ...(cur === 0 ? [0.1, 0.3, 1, 2] : [])])].filter(v => isMcc ? v > 0 : v >= 0);
      let bestV = cur;
      for (const v of cands) {
        if (v === cur) continue;
        const p = { ...params, [k]: v };
        if (isMcc) fillMcc(train, p);
        if (isLm) fillFeatures(train, buildModels(solves, p), true);
        const s = score(train, p).train.logRank;
        if (s < best - 1e-4) { best = s; bestV = v; }
      }
      params = { ...params, [k]: bestV };
      if (isMcc) { fillMcc(train, params); if (bestV !== cur) fillMcc(held, params); }
      if (isLm) { models = buildModels(solves, params); fillFeatures(train, models, true); if (bestV !== cur) fillFeatures(held, models, true); }
      if (bestV !== cur) { improved = true; report(`round ${r + 1} ${k} ${cur} -> ${bestV}`); }
    }
    if (!improved) break;
  }
  const base = currentParams();
  console.log(`\nfitted (changed): ${Object.entries(params).filter(([k, v]) => v !== base[k]).map(([k, v]) => `${k}=${v}`).join(',')}`);
}

/** Writes js/pro-steps.js: the naturalness model's professional corpus (every solve, pro_references.txt first). */
function writeCorpus() {
  const solves = loadSolves().sort((a, b) => (a.key.startsWith('pro_references') ? 0 : 1) - (b.key.startsWith('pro_references') ? 0 : 1));
  const lines = [
    '// Generated by `node tools/tune-alg-speed.js corpus`; do not edit by hand.',
    '// Every DAG step of every professional solve in data/pro_references.txt',
    '// (first, in file order) and data/reco_solves.txt, one array per solve, as',
    '// tools/pro-references.js segments them: the professional part of the',
    '// naturalness model\'s corpus (js/script.js, buildNaturalnessModel).',
    `// ${solves.length} solves, ${solves.reduce((t, s) => t + s.segAlgs.length, 0)} steps.`,
    'const PRO_STEP_ALGS = [',
    ...solves.map(s => `    ${JSON.stringify(s.segAlgs)},`),
    '];',
    '',
    "if (typeof module !== 'undefined' && module.exports) module.exports = { PRO_STEP_ALGS };",
    '',
  ];
  fs.writeFileSync(path.join(js, 'pro-steps.js'), lines.join('\n'));
  console.log(`js/pro-steps.js: ${solves.length} solves`);
}

if (cmd === 'corpus') writeCorpus();
else if (cmd === 'cpools') buildCompletePools().then(() => process.exit(0), e => { console.error(e); process.exit(2); });
else if (cmd === 'pools') buildPools().then(() => process.exit(0), e => { console.error(e); process.exit(2); });
else if (cmd === 'eval') evaluate();
else if (cmd === 'fit') fit();
else { console.error('usage: node tools/tune-alg-speed.js pools|eval|fit [options]  (see the header)'); process.exit(1); }
