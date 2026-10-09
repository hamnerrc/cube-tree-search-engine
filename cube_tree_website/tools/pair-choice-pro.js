#!/usr/bin/env node
/**
 * Professional pair choice under the app's real search (twenty-ninth pass;
 * PROJECT_STATUS "Open" 6): at every node of reco.nz solves, which pair
 * choice (the physical pairs a step solves) does the app rank first, and
 * where is the professional's?
 *
 *   node tools/pair-choice-pro.js collect --out p.jsonl [--solves 40] [--shard k/n]
 *       The last --solves solves of each solver (the tuning pools use the
 *       first ones): a SolveSession at each pro node runs the full search
 *       (xcross + xxcross + multislots, the pro's cross colour) and keeps the
 *       best 5 candidates of each pair choice with their algs, pieces and
 *       pair-choice features. ~1 min per solve.
 *   node tools/pair-choice-pro.js eval --data p.jsonl[,q.jsonl] [--root <repo checkout>]...
 *       Re-scores every candidate with the scoring of each given checkout
 *       (default this one; PLAN / LOOK env vars override the pair-choice
 *       weights) and reports how often the pro's pair choice ranks first and
 *       its mean reciprocal rank, first and later steps.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const cmd = args[0];
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i === -1 ? d : args[i + 1]; };
const optAll = (n) => args.flatMap((a, i) => (a === `--${n}` ? [args[i + 1]] : []));

const SLOT_CENTRES = { FR: [22, 13], FL: [22, 40], BR: [49, 13], BL: [49, 40] };

async function collect() {
  const js = path.join(root, 'js');
  for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js', 'spelling-search.js']) Object.assign(global, require(path.join(js, f)));
  const B = require(path.join(js, 'solver-bridge.js'));
  const { loadProReferences, segmentProSolve } = require('./pro-references.js');
  const { createEnginePool } = require('./node-engine-pool.js');
  const { createPostProcessPool } = require('./node-postprocess-pool.js');
  const pairKey = (f) => { const fl = solvedFlags(f); return ['BL', 'BR', 'FR', 'FL'].filter(s => fl[s]).map(s => SLOT_CENTRES[s].map(i => f[i]).sort().join('')).sort().join(','); };
  const out = opt('out', 'pair-choice-pro.jsonl');
  const [k, K] = opt('shard', '0/1').split('/').map(Number);
  const per = Number(opt('solves', '40'));
  const done = new Set(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l).src) : []);
  const bySolver = new Map();
  for (const sv of loadProReferences(path.join(root, 'data', 'reco_solves.txt'))) {
    const who = (sv.source || '').split('|')[1].trim();
    if (!bySolver.has(who)) bySolver.set(who, []);
    bySolver.get(who).push(sv);
  }
  const pick = [...bySolver.values()].flatMap(list => list.slice(-per)).filter((_, i) => i % K === k);
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const advanced = ['xcross', 'xxcross', 'multislotting'];
  const h = await createEnginePool('cross', 1);
  const post = await createPostProcessPool(1);
  for (const solve of pick) {
    if (done.has(solve.source)) continue;
    let segs;
    try { segs = segmentProSolve(solve); } catch (e) { continue; }
    const color = segs[segs.length - 1].after.crossColor;
    const pruned = pruneGraph(tree, { advanced, colors: [color] });
    const s = new B.SolveSession(solve.scramble, pruned, [color], advanced);
    s.postProcessor = post.process;
    const steps = [];
    for (const seg of segs) {
      const target = B.nodeByLabels(s, seg.after.pairs, seg.after.pairs);
      if (!target) break;
      const held = (r, alg) => applyAlgorithm(SOLVED_FACELETS, [solve.scramble, r, s.scoredPath, alg].filter(Boolean).join(' '));
      const proKey = pairKey(held(s.isAtRoot ? solve.inspection : s.rotation, seg.alg));
      const t0 = Date.now();
      const list = await B.searchCurrentNode(s, h, null);
      const choices = new Map();
      for (const c of list) {
        const f = held(s.isAtRoot ? c.rotation : s.rotation, c.coreAlg);
        const key = pairKey(f);
        const arr = choices.get(key) || [];
        if (arr.length >= 5) continue;
        arr.push({ alg: c.coreAlg, rot: c.rotation, tpp: c.tpp, pieces: calculateSolvedPieces(s.rootNode, s.nodeMap.get(c.targetNodeId)), feat: [...pairLookFeatures(f), ...planFeatures(f)] });
        choices.set(key, arr);
      }
      steps.push({ isRoot: s.isAtRoot, prior: s.stepAlgs.slice(), proKey, pro: seg.alg, ms: Date.now() - t0, choices: Object.fromEntries(choices) });
      s.commit({ rotation: solve.inspection, coreAlg: seg.alg, targetNodeId: target, color });
    }
    fs.appendFileSync(out, JSON.stringify({ src: solve.source, steps }) + '\n');
    console.log(`${solve.source.slice(0, 50)}: ${steps.length} steps, ${steps.map(x => x.ms).join('/')} ms`);
  }
  await post.terminate();
  await h.terminate();
}

function evaluate() {
  const recs = opt('data', '').split(',').filter(Boolean).flatMap(f => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(JSON.parse));
  const roots = optAll('root');
  for (const r of roots.length ? roots : [path.join(root, '..')]) {
    const S = require(path.join(r, 'cube_tree_website', 'js', 'script.js'));
    const w = { look: S.PAIR_PLANNING.look.slice(), plan: S.PAIR_PLANNING.plan.slice() };
    if (process.env.PLAN) w.plan = process.env.PLAN.split(',').map(Number);
    if (process.env.LOOK) w.look = process.env.LOOK.split(',').map(Number);
    const pair = fv => fv.slice(0, 5).reduce((t, x, k) => t + w.look[k] * x, 0) + fv.slice(5).reduce((t, x, k) => t + w.plan[k] * x, 0);
    const ranks = { first: [], later: [] };
    for (const rec of recs) {
      for (const st of rec.steps) {
        const keys = Object.keys(st.choices);
        if (keys.length < 2 || !st.choices[st.proKey]) continue;
        const priorPen = st.prior.reduce((t, a) => t + S.stepPenalty(a), 0);
        const base = S.algSpeedPrefix(st.prior.join(' '));
        const best = keys.map(k => [k, Math.min(...st.choices[k].map(c => (S.algSpeedResume(base, c.alg) + priorPen + S.stepPenalty(c.alg) + pair(c.feat)) / c.pieces))]);
        best.sort((a, b) => a[1] - b[1]);
        ranks[st.isRoot ? 'first' : 'later'].push(best.findIndex(x => x[0] === st.proKey) + 1);
      }
    }
    for (const g of ['first', 'later']) {
      const v = ranks[g];
      console.log(`${r} ${g} steps: ${v.length}; the pro's pair choice ranked first ${(100 * v.filter(x => x === 1).length / v.length).toFixed(1)}%, MRR ${(v.reduce((t, x) => t + 1 / x, 0) / v.length).toFixed(3)}`);
    }
  }
}

if (cmd === 'collect') collect().then(() => process.exit(0), (e) => { console.error(e); process.exit(2); });
else if (cmd === 'eval') evaluate();
else { console.error('usage: node tools/pair-choice-pro.js collect|eval (see the header)'); process.exit(1); }
