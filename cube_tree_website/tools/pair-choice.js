#!/usr/bin/env node
/**
 * Pair-choice intuition (README "Pair choice"): fits PAIR_CHOICE_LOOK
 * (script.js) so that the single-step ranking anticipates the 2-step
 * look-ahead, the way a solver's pair choice anticipates the next pair
 * without working it out. The model sees what a solver sees: which slots
 * are solved and, of the unsolved pairs, what look-ahead shows
 * (facelet-flags.js pairLookFeatures); the look-ahead's TPPs are only the
 * training signal. The app uses the feature weights only ("none+look"):
 * values by solved slots ("frame", "turn") did not generalise (PROJECT_STATUS).
 *
 *   node tools/pair-choice.js data --scrambles 50 --seed 1 --out a.jsonl [--max 1000]
 *       walks random-state solves (xcross + xxcross, later steps with
 *       multislots). At every step it records a diverse set of candidates
 *       (the 3 best of each target node plus the overall top 10): path cost,
 *       pieces, solved slots, look-ahead features and the label -- the
 *       combined TPP of the candidate and its best next step (the
 *       look-ahead's 2-step TPP), from a real search of that next step --
 *       then commits one of the 3 best by label. Appends; skips scrambles it
 *       has. ~1-2 min per scramble.
 *   node tools/pair-choice.js features --data a.jsonl   (re)computes the
 *       features in place (reconstructing paths in files written without).
 *   node tools/pair-choice.js fit --data a.jsonl,b.jsonl [--model turn+look]
 *       fits the values (listwise loss: the expected label of the candidate
 *       ranked first, softmax at --temp; l2), reports 5-fold cross-validated
 *       metrics by scramble, then prints the values fitted on everything.
 *       Models: slot values by "frame", "turn" (tied up to y rotations) or
 *       "none", "+look" adds the feature weights; the last 5 printed values
 *       are PAIR_CHOICE_LOOK.
 *   node tools/pair-choice.js eval --data a.jsonl [--values none|app|v0,..,v20]
 *   node tools/pair-choice.js pro --solves 150 --out p.jsonl [--solver "Xuanyi Geng"]
 *   node tools/pair-choice.js proeval --data p.jsonl [--values "none;app"]
 *       independent check on reco.nz solves: does the pro's pair choice
 *       (which pairs a step solves) rank higher among the app's choices?
 *
 * Metrics (per step, over its recorded candidates): regret = label of the
 * candidate ranked first minus the best label; top-1 = the look-ahead's best
 * candidate ranked first; pair top-1 = its target node ranked first;
 * Kendall tau between the ranking and the label order.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js', 'pro-steps.js']) Object.assign(global, require(path.join(jsRoot, f)));
const B = require(path.join(jsRoot, 'solver-bridge.js'));
const { generateRandomStateScramble } = require(path.join(jsRoot, 'random-state-scramble.js'));

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };

function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

const SLOTS = ['BL', 'BR', 'FR', 'FL'];
// The state after a step as a 4-bit mask over SLOTS (the node's labels are
// in the frame the solver holds the cube in after the step).
function slotMask(node) {
  const corners = node.state.corners || [];
  const edges = node.state.edges || [];
  let m = 0;
  SLOTS.forEach((sl, i) => { if (corners.includes(sl) && edges.includes(sl)) m |= 1 << i; });
  return m;
}

async function collect() {
  const { createEnginePool } = require(path.join(root, 'tools', 'node-engine-pool.js'));
  const n = +opt('scrambles', 10);
  const seed = +opt('seed', 1);
  const out = opt('out', 'pair-choice.jsonl');
  const maxSolutions = +opt('max', 1000);
  const rand = seeded(seed);
  // Costs and labels without the values being fitted.
  PAIR_CHOICE_LOOK.fill(0);
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const advanced = ['xcross', 'xxcross', 'cross_opt', 'pro_moves'];
  const pruned = pruneGraph(tree, { advanced: [...advanced, 'multislotting'], colors: ['white'] });
  const h = await createEnginePool('cross', +opt('workers', 2));
  const done = new Set();
  if (fs.existsSync(out)) for (const line of fs.readFileSync(out, 'utf8').split('\n')) if (line) done.add(JSON.parse(line).scr);
  for (let k = 0; k < n; k++) {
    const scramble = generateRandomStateScramble(rand);
    if (done.has(scramble)) continue;
    const t0 = Date.now();
    const s = new B.SolveSession(scramble, pruned, ['white'], advanced);
    s.maxSolutions = maxSolutions;
    let step = 0;
    while (!s.isComplete) {
      const list = await B.searchWithLookahead(s, h, null, null, { depth: 1 });
      if (!list.length) break;
      const picked = new Set(list.slice(0, 10));
      const perNode = new Map();
      for (const c of list) {
        const k2 = c.targetNodeId;
        const got = perNode.get(k2) || 0;
        if (got < 3) { picked.add(c); perNode.set(k2, got + 1); }
      }
      const cands = [];
      for (const c of picked) {
        const node = s.nodeMap.get(c.targetNodeId);
        const pieces = calculateSolvedPieces(s.rootNode, node);
        const f = s.fork(c);
        let label = c.tpp;
        let nextPieces = pieces;
        if (!f.isComplete) {
          const next = await B.searchWithLookahead(f, h, null, null, { depth: 1 });
          label = next.length ? next[0].tpp : Infinity;
          nextPieces = next.length ? calculateSolvedPieces(s.rootNode, s.nodeMap.get(next[0].targetNodeId)) : pieces;
        }
        const after = applyAlgorithm(SOLVED_FACELETS, [scramble, s.isAtRoot ? c.rotation : s.rotation, s.scoredPath, c.coreAlg].filter(Boolean).join(' '));
        const look = pairLookFeatures(after);
        cands.push({ c, rec: { node: c.targetNodeId, mask: slotMask(node), cost: c.tpp * pieces, pieces, tpp: c.tpp, label, nextPieces, rot: c.rotation, alg: c.coreAlg, look } });
      }
      fs.appendFileSync(out, JSON.stringify({ scr: scramble, step, rot: s.rotation, path: s.stepAlgs, from: slotMask(s.nodeMap.get(s.currentNodeId)), cands: cands.map(x => x.rec) }) + '\n');
      // Continue like a solver with look-ahead: one of the 3 best by label.
      const best = cands.slice().sort((a, b) => a.rec.label - b.rec.label).slice(0, 3);
      s.commit(best[Math.floor(rand() * best.length)].c);
      step++;
    }
    console.log(`${k + 1}/${n} ${scramble}: ${step} steps, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  await h.terminate();
}

// Which physical pairs are solved (colours of each solved slot's corner),
// so pair choices compare across the frames candidates end in.
function pairKey(f) {
  const fl = solvedFlags(f);
  const corners = { FR: [29, 26, 15], FL: [27, 44, 24], BL: [33, 53, 42], BR: [35, 17, 51] };
  return SLOTS.filter(sl => fl[sl]).map(sl => corners[sl].map(i => f[i]).sort().join('')).sort().join(',');
}

// Pro pair choice (independent check): at every step of a sample of reco.nz
// solves, the app's candidates (5 best of each pair choice) and which pair
// choice the professional made. `proeval` ranks the pair choices by their
// best candidate, with and without the values.
async function collectPro() {
  const { loadProReferences, segmentProSolve } = require('./pro-references.js');
  const { createEnginePool } = require(path.join(root, 'tools', 'node-engine-pool.js'));
  const out = opt('out', 'pair-choice-pro.jsonl');
  const n = +opt('solves', 100);
  const solver = opt('solver', 'Xuanyi Geng');
  PAIR_CHOICE_LOOK.fill(0);
  const done = new Set();
  if (fs.existsSync(out)) for (const line of fs.readFileSync(out, 'utf8').split('\n')) if (line) done.add(JSON.parse(line).src);
  const solves = loadProReferences(path.join(root, 'data', 'reco_solves.txt')).filter(sv => (sv.source || '').includes(solver));
  const rand = seeded(+opt('seed', 5));
  for (let i = solves.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [solves[i], solves[j]] = [solves[j], solves[i]]; }
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const advanced = ['xcross', 'xxcross', 'cross_opt', 'pro_moves'];
  const h = await createEnginePool('cross', +opt('workers', 2));
  for (const solve of solves.slice(0, n)) {
    if (done.has(solve.source)) continue;
    let segs;
    try { segs = segmentProSolve(solve); } catch (e) { continue; }
    if (segs.some(g => g.after.pairs.length !== (g.after.corners || g.after.pairs).length)) continue;
    const color = segs[segs.length - 1].after.crossColor;
    const pruned = pruneGraph(tree, { advanced: [...advanced, 'multislotting'], colors: [color] });
    const s = new B.SolveSession(solve.scramble, pruned, [color], advanced);
    s.maxSolutions = +opt('max', 1000);
    const steps = [];
    for (const seg of segs) {
      const target = B.nodeByLabels(s, seg.after.pairs, seg.after.pairs);
      if (!target) break;
      const rot = s.isAtRoot ? solve.inspection : s.rotation;
      const after = alg => applyAlgorithm(SOLVED_FACELETS, [solve.scramble, rot, s.scoredPath, alg].filter(Boolean).join(' '));
      const proKey = pairKey(after(seg.alg));
      const list = await B.searchWithLookahead(s, h, null, null, { depth: 1 });
      const perKey = new Map();
      const cands = [];
      for (const c of list) {
        const f = applyAlgorithm(SOLVED_FACELETS, [solve.scramble, s.isAtRoot ? c.rotation : s.rotation, s.scoredPath, c.coreAlg].filter(Boolean).join(' '));
        const key = pairKey(f);
        const got = perKey.get(key) || 0;
        if (got >= 5) continue;
        perKey.set(key, got + 1);
        const node = s.nodeMap.get(c.targetNodeId);
        const pieces = calculateSolvedPieces(s.rootNode, node);
        cands.push({ key, mask: slotMask(node), cost: c.tpp * pieces, pieces, look: pairLookFeatures(f) });
      }
      steps.push({ step: steps.length, proKey, choices: perKey.size, cands });
      s.commit({ rotation: solve.inspection, coreAlg: seg.alg, targetNodeId: target, color });
    }
    fs.appendFileSync(out, JSON.stringify({ src: solve.source, steps }) + '\n');
    console.log(`${solve.source.slice(0, 40)}: ${steps.length} steps`);
  }
  await h.terminate();
}

function proEvaluate() {
  const recs = fs.readFileSync(opt('data'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const specs = String(opt('values', 'none,app')).split(';');
  for (const spec of specs) {
    const V = spec === 'none' ? null : spec === 'app' ? [...new Array(16).fill(0), ...PAIR_CHOICE_LOOK] : spec.split(',').map(Number);
    for (const [label, filter] of [['all', () => true], ['first steps', st => st.step === 0], ['later steps', st => st.step > 0]]) {
      let n = 0, top1 = 0, rr = 0, lr = 0;
      for (const rec of recs) for (const st of rec.steps) {
        if (!filter(st) || st.choices < 2 || !st.cands.some(c => c.key === st.proKey)) continue;
        const best = new Map();
        for (const c of st.cands) { const x = score(c, V); if (!best.has(c.key) || x < best.get(c.key)) best.set(c.key, x); }
        const order = [...best.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
        const rank = order.indexOf(st.proKey) + 1;
        n++; if (rank === 1) top1++; rr += 1 / rank; lr += Math.log2(rank);
      }
      console.log(`${(spec.length > 12 ? 'fitted' : spec).padEnd(8)} ${label.padEnd(12)} steps ${String(n).padStart(4)}  pro pair choice first ${(100 * top1 / n).toFixed(1)}%  MRR ${(rr / n).toFixed(3)}  mean log2 rank ${(lr / n).toFixed(3)}`);
    }
  }
}

// Adds `look` (pairLookFeatures of the cube after the candidate) to every
// candidate; the path of a step is recorded (newer files) or reconstructed:
// the committed candidate is the one of the previous step's 3 best whose
// replay reaches the next step's start, checked on that step's candidates.
function addFeatures() {
  for (const file of String(opt('data')).split(',')) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    let prev = null;
    let lost = 0;
    const cube = (st, rot, alg) => applyAlgorithm(SOLVED_FACELETS, [st.scr, rot, ...st.path, alg].filter(Boolean).join(' '));
    const maskOf = (f) => { const fl = solvedFlags(f); return fl.cross ? SLOTS.reduce((m, sl, i) => m | (fl[sl] ? 1 << i : 0), 0) : -1; };
    for (const st of lines) {
      if (st.step === 0) { st.rot = ''; st.path = []; }
      else if (!st.path) {
        st.path = null;
        if (prev && prev.scr === st.scr && prev.path) {
          const best = prev.cands.slice().sort((a, b) => a.label - b.label).slice(0, 3);
          for (const c of best) {
            const rot = prev.step === 0 ? c.rot : prev.rot;
            const trial = { scr: st.scr, path: [...prev.path, c.alg] };
            if (maskOf(cube(trial, rot, '')) !== st.from) continue;
            if (st.cands.slice(0, 5).every(n => maskOf(cube(trial, rot, n.alg)) === n.mask)) { st.rot = rot; st.path = trial.path; break; }
          }
        }
      }
      if (!st.path) { lost++; prev = st; continue; }
      for (const c of st.cands) {
        const f = cube(st, st.step === 0 ? c.rot : st.rot, c.alg);
        if (maskOf(f) !== c.mask) throw new Error(`${st.scr} step ${st.step}: ${c.alg} replays to another state`);
        c.look = pairLookFeatures(f);
        c.plan = planFeatures(f); // in the frame the candidate ends in
      }
      prev = st;
    }
    fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
    console.log(`${file}: ${lines.length} steps, ${lost} without a path`);
  }
}

// ---------------------------------------------------------------------------

function loadSteps() {
  const steps = [];
  for (const file of String(opt('data', 'pair-choice.jsonl')).split(',')) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      const st = JSON.parse(line);
      st.cands = st.cands.filter(c => Number.isFinite(c.label) && Number.isFinite(c.cost));
      if (st.cands.length > 1) steps.push(st);
    }
  }
  return steps;
}

// Parameters: V[0..15] by solved-slot mask (V[15] = 0), V[16..20] weights of
// the look-ahead features (pairLookFeatures, LOOK_FEATURES order), V[21..24]
// weights of the pair-planning features (planFeatures, PLAN_FEATURES order).
const NPARAM = 25;
function extra(c, V) {
  if (!V) return 0;
  let x = V[c.mask] || 0;
  if (c.look && V.length > 16) for (let k = 0; k < 5; k++) x += V[16 + k] * c.look[k];
  if (c.plan && V.length > 21) for (let k = 0; k < 4; k++) x += V[21 + k] * c.plan[k];
  return x;
}
const score = (c, V) => (c.cost + extra(c, V)) / c.pieces;

// --model frame: one value per solved-slot set as held (15 free values).
// --model turn: sets equal up to a y rotation share a value (0, 1, 2
// adjacent, 2 opposite, 3 solved; 5 free values) -- what the solver could
// know if the frame did not matter (a step may start with a free y).
// --model: slot values by "frame" (15 free), "turn" (sets equal up to a y
// rotation tied: 5 free -- the solver may start a step with a free y) or
// "none", plus "+look" for the look-ahead feature weights.
function tieClasses(model) {
  const [slots, ...parts] = model.split('+');
  const look = parts.includes('look') ? 'look' : '';
  const cls = new Array(NPARAM).fill(-1);
  if (slots === 'frame') for (let m = 0; m < 15; m++) cls[m] = m;
  else if (slots === 'turn') {
    // slots in ring order BL(1) BR(2) FR(4) FL(8): a y turn cycles them
    const turn = r => [1, 2, 4, 8].reduce((o, b, i) => o | ((r & b) ? [2, 4, 8, 1][i] : 0), 0);
    let next = 0;
    for (let m = 0; m < 15; m++) {
      if (cls[m] >= 0) continue;
      for (let k = 0, r = m; k < 4; k++, r = turn(r)) cls[r] = next;
      next++;
    }
  }
  if (look === 'look') for (let k = 0; k < 5; k++) cls[16 + k] = 100 + k;
  if (parts.includes('plan')) for (let k = 0; k < 4; k++) cls[21 + k] = 200 + k;
  return cls;
}

function metrics(steps, V) {
  let regret = 0, top1 = 0, pairTop1 = 0, tau = 0, tauN = 0;
  for (const st of steps) {
    const byScore = st.cands.slice().sort((a, b) => score(a, V) - score(b, V));
    const bestLabel = Math.min(...st.cands.map(c => c.label));
    const bestCand = st.cands.find(c => c.label === bestLabel);
    regret += byScore[0].label - bestLabel;
    if (byScore[0].label === bestLabel) top1++;
    if (byScore[0].node === bestCand.node) pairTop1++;
    let conc = 0, disc = 0;
    for (let i = 0; i < st.cands.length; i++) for (let j = i + 1; j < st.cands.length; j++) {
      const a = st.cands[i], b = st.cands[j];
      const dl = a.label - b.label, ds = score(a, V) - score(b, V);
      if (!dl || !ds) continue;
      if (dl * ds > 0) conc++; else disc++;
    }
    if (conc + disc) { tau += (conc - disc) / (conc + disc); tauN++; }
  }
  const n = steps.length;
  return { steps: n, regret: regret / n, top1: top1 / n, pairTop1: pairTop1 / n, tau: tau / tauN };
}

function printMetrics(label, m) {
  console.log(`${label.padEnd(26)} steps ${String(m.steps).padStart(5)}  regret ${m.regret.toFixed(4)}  top-1 ${(100 * m.top1).toFixed(1)}%  pair top-1 ${(100 * m.pairTop1).toFixed(1)}%  tau ${m.tau.toFixed(3)}`);
}

// Listwise loss: the expected label (the look-ahead's 2-step TPP) of the
// candidate ranked first, with "first" softened to a softmax over the
// adjusted TPPs at temperature `temp`; plus l2 on the values. Values tied by
// the model's classes; V[15] (all solved) stays 0. Gradient descent with an
// analytic gradient.
function expectedLabel(steps, V, temp, grad) {
  let total = 0;
  for (const st of steps) {
    const cs = st.cands;
    const sc = cs.map(c => score(c, V));
    const lo = Math.min(...sc);
    const w = sc.map(x => Math.exp(-(x - lo) / temp));
    const Z = w.reduce((a, b) => a + b, 0);
    const E = cs.reduce((a, c, k) => a + w[k] * c.label, 0) / Z;
    total += E;
    if (grad) {
      // dE/dscore_k = -(p_k / temp) (label_k - E); dscore_k/dV[mask_k] = 1/pieces_k
      cs.forEach((c, k) => {
        const d = -(w[k] / Z / temp) * (c.label - E) / c.pieces;
        grad[c.mask] += d;
        if (c.look) for (let q = 0; q < 5; q++) grad[16 + q] += d * c.look[q];
        if (c.plan) for (let q = 0; q < 4; q++) grad[21 + q] += d * c.plan[q];
      });
    }
  }
  return total / steps.length;
}

function fitValues(steps, { temp = 0.3, l2 = 0.002, iters = 1500, lr = 20, model = 'none+look' } = {}) {
  const cls = tieClasses(model);
  const V = new Array(NPARAM).fill(0);
  const m1 = new Array(NPARAM).fill(0), m2 = new Array(NPARAM).fill(0);
  for (let it = 1; it <= iters; it++) {
    const g = new Array(NPARAM).fill(0);
    expectedLabel(steps, V, temp, g);
    const gc = new Map();
    for (let m = 0; m < NPARAM; m++) if (cls[m] >= 0) gc.set(cls[m], (gc.get(cls[m]) || 0) + g[m] / steps.length);
    for (let m = 0; m < NPARAM; m++) {
      if (cls[m] < 0) continue;
      const gm = gc.get(cls[m]) + l2 * V[m];
      m1[m] = 0.9 * m1[m] + 0.1 * gm; m2[m] = 0.999 * m2[m] + 0.001 * gm * gm; // Adam
      V[m] -= (lr / 1000) * (m1[m] / (1 - 0.9 ** it)) / (Math.sqrt(m2[m] / (1 - 0.999 ** it)) + 1e-8);
    }
  }
  return V;
}

function maskName(m) {
  const s = SLOTS.filter((_, i) => m & (1 << i));
  return s.length ? s.join('+') : 'none';
}

const fitOptions = () => ({ temp: +opt('temp', 0.3), l2: +opt('l2', 0.002), iters: +opt('iters', 1500), lr: +opt('lr', 20), model: opt('model', 'none+look') });

// 5-fold cross-validation by scramble, then the values fitted on everything.
function fit() {
  const steps = loadSteps();
  const folds = +opt('folds', 5);
  const fold = st => { let h = 2166136261; for (let i = 0; i < st.scr.length; i++) h = Math.imul(h ^ st.scr.charCodeAt(i), 16777619); return (h >>> 0) % folds; };
  const held = { all: [], root: [], later: [] };
  const base = { all: [], root: [], later: [] };
  const pooled = [];
  for (let f = 0; f < folds; f++) {
    const train = steps.filter(st => fold(st) !== f);
    const test = steps.filter(st => fold(st) === f);
    const V = fitValues(train, fitOptions());
    for (const st of test) pooled.push({ st, V });
  }
  const pooledMetrics = (filter, useV) => {
    const sel = pooled.filter(x => filter(x.st));
    // metrics() takes one V; evaluate per step and average
    const per = sel.map(x => metrics([x.st], useV ? x.V : null));
    const n = per.length;
    const avg = k => per.reduce((a, m) => a + m[k], 0) / n;
    return { steps: n, regret: avg('regret'), top1: avg('top1'), pairTop1: avg('pairTop1'), tau: per.filter(m => !Number.isNaN(m.tau)).reduce((a, m) => a + m.tau, 0) / per.filter(m => !Number.isNaN(m.tau)).length };
  };
  for (const [label, filter] of [['all', () => true], ['root', st => st.step === 0], ['later', st => st.step > 0]]) {
    printMetrics(`held out ${label}, no values`, pooledMetrics(filter, false));
    printMetrics(`held out ${label}, fitted`, pooledMetrics(filter, true));
  }
  const V = fitValues(steps, fitOptions());
  printMetrics('in sample, fitted', metrics(steps, V));
  console.log('values by solved slots (end-of-step frame):');
  for (let m = 0; m < 15; m++) console.log(`  ${maskName(m).padEnd(16)} ${V[m].toFixed(3)}`);
  LOOK_FEATURES.forEach((name, k) => console.log(`  ${name.padEnd(16)} ${V[16 + k].toFixed(3)} per piece/pair`));
  PLAN_FEATURES.forEach((name, k) => console.log(`  ${name.padEnd(16)} ${V[21 + k].toFixed(3)} per edge/slot`));
  console.log(`[${V.map(v => +v.toFixed(2)).join(', ')}]`);
}

function evaluate() {
  const steps = loadSteps();
  const spec = opt('values', 'app');
  const V = spec === 'none' ? null : spec === 'app' ? [...new Array(16).fill(0), ...PAIR_CHOICE_LOOK] : spec.split(',').map(Number);
  printMetrics('all', metrics(steps, V));
  printMetrics('root', metrics(steps.filter(st => st.step === 0), V));
  printMetrics('later', metrics(steps.filter(st => st.step > 0), V));
}

if (cmd === 'data') collect().catch((e) => { console.error(e); process.exit(1); });
else if (cmd === 'features') addFeatures();
else if (cmd === 'pro') collectPro().catch((e) => { console.error(e); process.exit(1); });
else if (cmd === 'proeval') proEvaluate();
else if (cmd === 'fit') fit();
else if (cmd === 'eval') evaluate();
else { console.error('usage: pair-choice.js data|fit|eval (see the header)'); process.exit(1); }
