// Logic of tools/pair-compare.js (PROJECT_STATUS.md roadmap item 7): the
// developer judges which of two algs is faster to execute; these answers are
// the training data for a step-independent alg_speed.
//
// Plain functions, no engine and no terminal, so test/pair-compare.test.js
// can check them directly:
// - storage: an append-only JSONL log of answers and retractions;
// - comparisonGraph: votes per pair, ties merged into classes, contradictions
//   (cycles) found, transitive closure and the derived comparisons;
// - selectPair: which pair to ask next (contradictions, spaced repeats, a
//   share of random pairs, otherwise the most informative pair).
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { algSpeed, stepPenalty, ALG_SPEED_DEFAULTS, STEP_PENALTIES } = require(path.join(__dirname, '..', 'js', 'script.js'));

/** Plain notation: single spaces, "R2'" -> "R2". The identity of an alg. */
function normalizeAlg(alg) {
  return String(alg || '').replace(/2'/g, '2').trim().split(/\s+/).filter(Boolean).join(' ');
}

/** A wide B turn (b, b', b2): never part of a solution, never asked. */
function hasWideB(alg) {
  return /(^| )b/.test(alg);
}

/** Unordered key of a pair of (normalised) algs. */
function pairKey(a, b) {
  return a < b ? `${a}\n${b}` : `${b}\n${a}`;
}

// Notation features the selection wants answers on. "rotMid" = a rotation
// after the first move (a leading one is done while looking ahead); length
// in face turns. (Regrips are not a feature: algSpeed does not expose its
// grip changes, and "a D/F/B turn mid-alg" matched 92% of the pool.)
const FEATURES = ['D', 'F', 'B', 'wideRL', 'wideUDFB', 'slice', 'rotLead', 'rotMid', 'short', 'medium', 'long'];

function algFeatures(alg) {
  const toks = normalizeAlg(alg).split(' ').filter(Boolean);
  const f = new Set();
  toks.forEach((t, i) => {
    const c = t[0];
    if (c === 'D') f.add('D');
    else if (c === 'F') f.add('F');
    else if (c === 'B') f.add('B');
    else if (c === 'r' || c === 'l') f.add('wideRL');
    else if ('udfb'.includes(c)) f.add('wideUDFB');
    else if ('MES'.includes(c)) f.add('slice');
    else if ('xyz'.includes(c)) f.add(i === 0 ? 'rotLead' : 'rotMid');
  });
  const turns = toks.filter(t => !'xyz'.includes(t[0])).length;
  f.add(turns <= 5 ? 'short' : turns <= 9 ? 'medium' : 'long');
  return [...f];
}

/** The current model's time for an alg executed on its own (MCC + step penalty). */
function modelTime(alg) {
  return algSpeed(normalizeAlg(alg)) + stepPenalty(normalizeAlg(alg));
}

/** Short hash of the current scoring constants, stored with every answer. */
function modelVersion() {
  const h = crypto.createHash('sha1').update(JSON.stringify([ALG_SPEED_DEFAULTS, STEP_PENALTIES])).digest('hex');
  return `mcc-${h.slice(0, 8)}`;
}

// ---------------------------------------------------------------- storage

/** Reads the JSONL log; a torn last line (crash mid-write) is ignored. */
function readLog(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch (e) { /* torn line */ }
  }
  return out;
}

function appendLog(file, record) {
  fs.appendFileSync(file, JSON.stringify(record) + '\n');
}

/** Answers that are not retracted, in log order. */
function activeAnswers(log) {
  const retracted = new Set(log.filter(r => r.type === 'retract').map(r => r.id));
  return log.filter(r => r.type === 'answer' && !retracted.has(r.id));
}

/** A new answer record. `answer` is 'a', 'b', 'tie' or 'skip' (a/b as shown). */
function answerRecord({ id, a, b, answer, ctxA, ctxB, reason, ms, speedA, speedB }) {
  return {
    type: 'answer', id, t: new Date().toISOString(),
    a: normalizeAlg(a), b: normalizeAlg(b), answer,
    ctxA: ctxA || null, ctxB: ctxB || null,
    speedA: speedA ?? null, speedB: speedB ?? null, model: modelVersion(),
    reason: reason || 'select', repeat: reason === 'repeat', ms: ms ?? null,
  };
}

// ---------------------------------------------------------------- the comparison graph

/**
 * Resolves the answers into a graph. Every pair's direct answers are votes;
 * the pair's verdict is the majority (a tied count: the latest answer).
 * Tie verdicts merge algs into classes; strict verdicts are edges between
 * classes. A strongly connected set of classes (A > B > C > A), or a strict
 * edge inside one tie class, is a contradiction: its pairs are not used for
 * inference and its weakest pair is asked again.
 */
function comparisonGraph(answers) {
  const pairs = new Map(); // key -> { a, b, votes: {a, b, tie}, n, last, lastIdx, verdict }
  const skipped = new Map(); // key -> count
  const skipsByAlg = new Map();
  answers.forEach((r, idx) => {
    const key = pairKey(r.a, r.b);
    if (r.answer === 'skip') {
      skipped.set(key, (skipped.get(key) || 0) + 1);
      for (const x of [r.a, r.b]) skipsByAlg.set(x, (skipsByAlg.get(x) || 0) + 1);
      return;
    }
    const [lo, hi] = r.a < r.b ? [r.a, r.b] : [r.b, r.a];
    let p = pairs.get(key);
    if (!p) { p = { a: lo, b: hi, votes: { lo: 0, hi: 0, tie: 0 }, n: 0, last: null, lastIdx: -1, first: idx }; pairs.set(key, p); }
    const winner = r.answer === 'tie' ? 'tie' : (r.answer === 'a' ? r.a : r.b) === lo ? 'lo' : 'hi';
    p.votes[winner]++;
    p.n++;
    p.last = winner;
    p.lastIdx = idx;
  });
  for (const p of pairs.values()) {
    const best = Math.max(p.votes.lo, p.votes.hi, p.votes.tie);
    const top = ['lo', 'hi', 'tie'].filter(k => p.votes[k] === best);
    p.verdict = top.length === 1 ? top[0] : p.last;
  }

  // Tie classes (union-find over the algs of every pair).
  const algs = new Set();
  for (const p of pairs.values()) { algs.add(p.a); algs.add(p.b); }
  const algList = [...algs].sort();
  const parent = new Map(algList.map(a => [a, a]));
  const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const p of pairs.values()) if (p.verdict === 'tie') { const x = find(p.a), y = find(p.b); if (x !== y) parent.set(x, y); }
  const classIndex = new Map();
  const classes = [];
  for (const a of algList) {
    const r = find(a);
    if (!classIndex.has(r)) { classIndex.set(r, classes.length); classes.push([]); }
    classes[classIndex.get(r)].push(a);
  }
  const classOf = new Map(algList.map(a => [a, classIndex.get(find(a))]));

  // Strict edges faster -> slower between classes.
  const n = classes.length;
  const out = Array.from({ length: n }, () => new Set());
  const selfLoop = new Set();
  for (const p of pairs.values()) {
    if (p.verdict === 'tie') continue;
    const [fast, slow] = p.verdict === 'lo' ? [p.a, p.b] : [p.b, p.a];
    const u = classOf.get(fast), v = classOf.get(slow);
    if (u === v) selfLoop.add(u); else out[u].add(v);
  }

  // Strongly connected components (iterative Tarjan).
  const comp = new Int32Array(n).fill(-1);
  const comps = [];
  {
    const index = new Int32Array(n).fill(-1), low = new Int32Array(n), onStack = new Uint8Array(n);
    const stack = [];
    let counter = 0;
    for (let s = 0; s < n; s++) {
      if (index[s] !== -1) continue;
      const work = [[s, [...out[s]], 0]];
      index[s] = low[s] = counter++; stack.push(s); onStack[s] = 1;
      while (work.length) {
        const frame = work[work.length - 1];
        const [v, succ] = frame;
        if (frame[2] < succ.length) {
          const w = succ[frame[2]++];
          if (index[w] === -1) {
            index[w] = low[w] = counter++; stack.push(w); onStack[w] = 1;
            work.push([w, [...out[w]], 0]);
          } else if (onStack[w]) low[v] = Math.min(low[v], index[w]);
        } else {
          work.pop();
          if (work.length) { const u = work[work.length - 1][0]; low[u] = Math.min(low[u], low[v]); }
          if (low[v] === index[v]) {
            const members = [];
            let w;
            do { w = stack.pop(); onStack[w] = 0; comp[w] = comps.length; members.push(w); } while (w !== v);
            comps.push(members);
          }
        }
      }
    }
  }
  const contradictory = comps.map((m, i) => m.length > 1 || m.some(c => selfLoop.has(c)));

  // Contradictions: the algs involved and the pairs to ask again (weakest
  // first: fewest answers, then the oldest latest answer).
  const contradictions = [];
  comps.forEach((members, ci) => {
    if (!contradictory[ci]) return;
    const inside = new Set(members.flatMap(c => classes[c]));
    const involved = [...pairs.values()].filter(p => inside.has(p.a) && inside.has(p.b))
      .sort((x, y) => x.n - y.n || x.lastIdx - y.lastIdx);
    contradictions.push({ algs: [...inside].sort(), pairs: involved });
  });

  // Condensation DAG over the non-contradictory components, then the
  // transitive closure as bitsets (Tarjan numbers components in reverse
  // topological order: successors first).
  const m = comps.length;
  const cout = Array.from({ length: m }, () => new Set());
  for (let u = 0; u < n; u++) for (const v of out[u]) if (comp[u] !== comp[v]) cout[comp[u]].add(comp[v]);
  const words = Math.ceil(m / 32) || 1;
  const reach = Array.from({ length: m }, () => new Uint32Array(words));
  for (let c = 0; c < m; c++) {
    for (const d of cout[c]) {
      reach[c][d >> 5] |= 1 << (d & 31);
      const rd = reach[d];
      for (let w = 0; w < words; w++) reach[c][w] |= rd[w];
    }
  }
  const compSize = comps.map(members => members.reduce((s, c) => s + classes[c].length, 0));

  const compOfAlg = a => (classOf.has(a) ? comp[classOf.get(a)] : -1);
  const reaches = (c, d) => (reach[c][d >> 5] >>> (d & 31)) & 1;

  /**
   * What the answers say about a vs b: 'a' (a faster), 'b', 'tie', or null
   * (unknown). Pairs inside a contradiction are unknown unless answered
   * directly; a direct answer always wins.
   */
  function relation(a, b) {
    a = normalizeAlg(a); b = normalizeAlg(b);
    const p = pairs.get(pairKey(a, b));
    if (p) return p.verdict === 'tie' ? 'tie' : ((p.verdict === 'lo' ? p.a : p.b) === a ? 'a' : 'b');
    if (!classOf.has(a) || !classOf.has(b)) return null;
    const ca = classOf.get(a), cb = classOf.get(b);
    const x = comp[ca], y = comp[cb];
    if (contradictory[x] || contradictory[y]) return null;
    if (ca === cb) return 'tie';
    if (reaches(x, y)) return 'a';
    if (reaches(y, x)) return 'b';
    return null;
  }

  // Counts. Ordered pairs implied by the closure (alg level) and pairs in the
  // same tie class; direct = pairs with a strict or tie verdict.
  let impliedOrdered = 0;
  for (let c = 0; c < m; c++) {
    if (contradictory[c]) continue;
    for (let d = 0; d < m; d++) if (d !== c && !contradictory[d] && reaches(c, d)) impliedOrdered += compSize[c] * compSize[d];
  }
  let impliedTies = 0;
  classes.forEach((cl, i) => { if (!contradictory[comp[i]]) impliedTies += cl.length * (cl.length - 1) / 2; });
  const directKnown = [...pairs.values()].filter(p => !contradictory[compOfAlg(p.a)] && !contradictory[compOfAlg(p.b)]).length;
  const directStrict = [...pairs.values()].filter(p => p.verdict !== 'tie').length;
  const directTie = pairs.size - directStrict;

  // Undirected components of everything answered (strict or tie), for the
  // selection's "join two parts of the graph" bonus.
  const ccParent = new Map(algList.map(a => [a, a]));
  const ccFind = x => { while (ccParent.get(x) !== x) { ccParent.set(x, ccParent.get(ccParent.get(x))); x = ccParent.get(x); } return x; };
  for (const p of pairs.values()) { const x = ccFind(p.a), y = ccFind(p.b); if (x !== y) ccParent.set(x, y); }
  const component = a => (ccParent.has(a) ? ccFind(a) : null);

  /**
   * Every comparison the answers imply, for fitting (roadmap 7c): direct
   * verdicts with dist 1, derived ones with the shortest chain of strict
   * answers between their tie classes (ties along the way are free). Derived
   * pairs are not independent of the direct ones; weight them by 1/dist and
   * validate on direct answers only. Contradictory algs get direct pairs only.
   */
  function derivedComparisons() {
    const outList = [];
    for (const p of pairs.values()) {
      if (p.verdict === 'tie') outList.push({ faster: p.a, slower: p.b, tie: true, dist: 1, direct: true, votes: p.n });
      else { const [f, s] = p.verdict === 'lo' ? [p.a, p.b] : [p.b, p.a]; outList.push({ faster: f, slower: s, tie: false, dist: 1, direct: true, votes: p.n }); }
    }
    for (let c = 0; c < n; c++) {
      if (contradictory[comp[c]]) continue;
      const dist = new Map([[c, 0]]);
      const queue = [c];
      for (let qi = 0; qi < queue.length; qi++) {
        const u = queue[qi];
        for (const v of out[u]) if (!dist.has(v) && !contradictory[comp[v]]) { dist.set(v, dist.get(u) + 1); queue.push(v); }
      }
      for (const [d, k] of dist) {
        if (d === c) continue;
        for (const f of classes[c]) for (const s of classes[d]) if (!pairs.has(pairKey(f, s))) outList.push({ faster: f, slower: s, tie: false, dist: k, direct: false });
      }
      const cl = classes[c];
      for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) {
        if (!pairs.has(pairKey(cl[i], cl[j]))) outList.push({ faster: cl[i], slower: cl[j], tie: true, dist: 2, direct: false });
      }
    }
    return outList;
  }

  return {
    pairs, skipped, skipsByAlg, classes, classOf, contradictions, relation, component, derivedComparisons,
    algs: algList,
    counts: {
      direct: pairs.size, directStrict, directTie, directKnown, skips: [...skipped.values()].reduce((s, x) => s + x, 0),
      implied: impliedOrdered + impliedTies, derived: Math.max(0, impliedOrdered + impliedTies - directKnown),
      contradictions: contradictions.length,
    },
  };
}

// ---------------------------------------------------------------- the candidate pool

/**
 * Indexes the pool file ({ lists: [{ id, first, type, items: [{ alg, rank, type }] }] })
 * by alg: contexts (first step or later, step types), every (list, rank)
 * occurrence, features and the current model time.
 */
function indexPool(pool) {
  const byAlg = new Map();
  for (const list of pool.lists) {
    for (const it of list.items) {
      const alg = normalizeAlg(it.alg);
      // Never a wide B (README "Wide moves"): such algs are not solutions.
      if (!alg || hasWideB(alg)) continue;
      let e = byAlg.get(alg);
      if (!e) { e = { alg, first: 0, later: 0, types: new Set(), occ: [], pro: false }; byAlg.set(alg, e); }
      if (list.first) e.first++; else e.later++;
      e.types.add(it.type || list.type || '?');
      e.occ.push({ list: list.id, rank: it.rank });
      if (it.pro) e.pro = true;
    }
  }
  const algs = [...byAlg.values()];
  for (const e of algs) {
    e.isFirst = e.first > e.later; // the context its model time uses
    e.time = modelTime(e.alg);
    e.features = algFeatures(e.alg);
    e.bestRank = Math.min(...e.occ.map(o => o.rank));
    e.types = [...e.types];
  }
  const lists = pool.lists.map(l => ({ ...l, algs: [...new Set(l.items.map(it => normalizeAlg(it.alg)).filter(a => a && !hasWideB(a)))] }));
  const sortedByTime = algs.slice().sort((x, y) => x.time - y.time);
  sortedByTime.forEach((e, i) => { e.timeIndex = i; });
  return { byAlg, algs, lists, sortedByTime };
}

/** The step context stored with an answer. */
function contextOf(e) {
  return { first: e.isFirst, types: e.types, bestRank: e.bestRank, pro: e.pro };
}

// ---------------------------------------------------------------- pair selection

const SELECT_DEFAULTS = {
  randomShare: 0.1, // pairs drawn at random among the eligible ones
  repeatShare: 0.05, // already-answered pairs asked again, unannounced
  repeatMinAge: 40, // ... only once at least this many answers have passed since
  scale: 0.1, // relative time difference giving the model a 73% win probability
  listsPerDraw: 40, // result lists sampled per question
  topPerList: 15, // all pairs among each sampled list's top items
  extraPerList: 30, // plus this many random pairs within the list
  crossDraws: 800, // pairs of close-scoring algs from different lists
  window: 25, // ... partner within this many places in model-time order
  graphDraws: 600, // pairs with an already-answered alg
  recentAlgFactor: 0.5, // score factor for a pair with an alg from the last few questions
  // connect: joins two components / one new alg next to answered ones /
  // both already in one component (order still unknown) / both new. Tuned in
  // simulation on the real pool (PROJECT_STATUS.md §4.45): with these, 1441
  // direct answers gave 5633 comparisons (0.4 / no "inside": 999 from 385).
  weights: { ambiguity: 1, impact: 0.8, coverage: 0.5, connect: 1 },
  connectValues: { join: 1, extend: 0.8, inside: 0.5, fresh: 0 },
};

/** Model win probability of x over y: logistic in the relative time difference. */
function winProbability(tx, ty, scale) {
  const d = (ty - tx) / Math.max(1e-9, (tx + ty) / 2);
  return 1 / (1 + Math.exp(-d / scale));
}

/**
 * Fits `scale` to the direct strict answers (maximum likelihood, grid
 * search). Too few answers (or a model that orders none of them right):
 * the default. Larger = the model is less sure.
 */
function fitScale(graph, pidx, fallback = SELECT_DEFAULTS.scale) {
  const obs = [];
  for (const p of graph.pairs.values()) {
    if (p.verdict === 'tie') continue;
    const [f, s] = p.verdict === 'lo' ? [p.a, p.b] : [p.b, p.a];
    const tf = pidx.byAlg.has(f) ? pidx.byAlg.get(f).time : modelTime(f);
    const ts = pidx.byAlg.has(s) ? pidx.byAlg.get(s).time : modelTime(s);
    obs.push([tf, ts]);
  }
  if (obs.length < 30) return fallback;
  let best = fallback, bestLL = -Infinity;
  for (let s = 0.02; s <= 2.0001; s *= 1.15) {
    const ll = obs.reduce((t, [tf, ts]) => t + Math.log(Math.max(1e-12, winProbability(tf, ts, s))), 0);
    if (ll > bestLL) { bestLL = ll; best = s; }
  }
  return best;
}

/** Feature answer counts: how many answered algs have each feature. */
function featureCounts(graph, pidx) {
  const counts = Object.fromEntries(FEATURES.map(f => [f, 0]));
  for (const a of graph.algs) for (const f of (pidx.byAlg.has(a) ? pidx.byAlg.get(a).features : algFeatures(a))) counts[f]++;
  return counts;
}

/**
 * The selection score of an eligible pair (higher = ask first), and its parts:
 * ambiguity (model win probability near 50%), impact (both near the top of
 * the same real result list), coverage (features with few answers) and
 * connect (joins separate parts of the comparison graph).
 */
function pairScore(x, y, ctx) {
  const { graph, opts, featCount, rankIn } = ctx;
  const p = winProbability(x.time, y.time, ctx.scale);
  const ambiguity = 1 - Math.abs(2 * p - 1);
  let impact = 0;
  const ry = rankIn.get(y.alg);
  for (const o of x.occ) {
    const r2 = ry && ry.get(o.list);
    if (r2) impact = Math.max(impact, 1 / Math.sqrt(Math.sqrt(o.rank * r2)));
  }
  if (!impact) impact = 0.25 / Math.sqrt(Math.sqrt(x.bestRank * y.bestRank));
  let coverage = 0;
  for (const f of new Set([...x.features, ...y.features])) coverage = Math.max(coverage, 1 / Math.sqrt(1 + featCount[f]));
  const cx = graph.component(x.alg), cy = graph.component(y.alg);
  const v = ctx.connectValues || opts.connectValues;
  const connect = cx && cy ? (cx !== cy ? v.join : v.inside) : cx || cy ? v.extend : v.fresh;
  const w = opts.weights;
  return { score: w.ambiguity * ambiguity + w.impact * impact + w.coverage * coverage + w.connect * connect, ambiguity, impact, coverage, connect, p };
}

/** Is this pair worth asking normally: distinct, not known, not skipped, no often-skipped alg. */
function eligible(x, y, graph) {
  if (!x || !y || x.alg === y.alg) return false;
  if (graph.skipped.has(pairKey(x.alg, y.alg))) return false;
  if ((graph.skipsByAlg.get(x.alg) || 0) >= 2 || (graph.skipsByAlg.get(y.alg) || 0) >= 2) return false;
  return graph.relation(x.alg, y.alg) === null;
}

/**
 * Candidate pairs for one question (sampled; see SELECT_DEFAULTS): pairs
 * within real result lists, close-scoring pairs across lists, and pairs with
 * an already-answered alg (another answered one, or a new alg close to it in
 * model time), which is what lets transitivity chain the answers.
 */
function candidatePairs(pidx, rng, opts, answered = []) {
  const out = [];
  const lists = pidx.lists;
  for (let k = 0; k < Math.min(opts.listsPerDraw, lists.length); k++) {
    const l = lists[Math.floor(rng() * lists.length)];
    const top = l.algs.slice(0, opts.topPerList);
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) out.push([top[i], top[j]]);
    for (let e = 0; e < opts.extraPerList && l.algs.length > 1; e++) {
      const i = Math.floor(rng() * l.algs.length), j = Math.floor(rng() * l.algs.length);
      if (i !== j) out.push([l.algs[i], l.algs[j]]);
    }
  }
  const sorted = pidx.sortedByTime;
  for (let k = 0; k < opts.crossDraws && sorted.length > 1; k++) {
    const i = Math.floor(rng() * sorted.length);
    const j = Math.min(sorted.length - 1, Math.max(0, i + Math.round((rng() * 2 - 1) * opts.window)));
    if (i !== j) out.push([sorted[i].alg, sorted[j].alg]);
  }
  const inPool = answered.filter(a => pidx.byAlg.has(a));
  for (let k = 0; k < opts.graphDraws && inPool.length; k++) {
    const x = pidx.byAlg.get(inPool[Math.floor(rng() * inPool.length)]);
    if (rng() < 0.5 && inPool.length > 1) { out.push([x.alg, inPool[Math.floor(rng() * inPool.length)]]); continue; }
    const j = Math.min(sorted.length - 1, Math.max(0, x.timeIndex + Math.round((rng() * 2 - 1) * opts.window)));
    if (j !== x.timeIndex) out.push([x.alg, sorted[j].alg]);
  }
  return out;
}

/**
 * The next pair to ask: { a, b, reason, parts }. In order: an open
 * contradiction's weakest pair (each pair re-asked at most once, so a
 * genuinely intransitive set stops being asked); a spaced repeat
 * (repeatShare); a random eligible pair (randomShare); otherwise the
 * best-scoring sampled candidate. The A/B order is randomised. `recent`:
 * pair keys asked in the last few questions (never asked again right away);
 * `recentAlgs`: their algs (scored down, see recentAlgFactor).
 */
function selectPair(pidx, answers, rng = Math.random, options = {}) {
  const opts = { ...SELECT_DEFAULTS, ...options, weights: { ...SELECT_DEFAULTS.weights, ...(options.weights || {}) }, connectValues: { ...SELECT_DEFAULTS.connectValues, ...(options.connectValues || {}) } };
  const graph = options.graph || comparisonGraph(answers);
  const recent = options.recent || new Set();
  const recentAlgs = options.recentAlgs || new Set();
  const order = (a, b) => (rng() < 0.5 ? [a, b] : [b, a]);
  const finish = (a, b, reason, parts) => { const [x, y] = order(a, b); return { a: x, b: y, reason, parts: parts || null }; };

  for (const c of graph.contradictions) {
    const p = c.pairs.find(q => q.n < 2 && !recent.has(pairKey(q.a, q.b)));
    if (p) return finish(p.a, p.b, 'contradiction');
  }

  if (rng() < opts.repeatShare) {
    const total = answers.length;
    const repeated = new Set(answers.filter(r => r.repeat).map(r => pairKey(r.a, r.b)));
    const old = answers.filter((r, i) => r.answer !== 'skip' && !r.repeat && total - i >= opts.repeatMinAge
      && !repeated.has(pairKey(r.a, r.b)) && !recent.has(pairKey(r.a, r.b)));
    if (old.length) { const r = old[Math.floor(rng() * old.length)]; return finish(r.a, r.b, 'repeat'); }
  }

  const featCount = featureCounts(graph, pidx);
  const rankIn = new Map(pidx.algs.map(e => [e.alg, new Map(e.occ.map(o => [o.list, o.rank]))]));
  const ctx = { graph, opts, featCount, rankIn, scale: options.scale || opts.scale };
  const wantRandom = rng() < opts.randomShare;
  let best = null;
  const seen = new Set();
  for (const [a, b] of candidatePairs(pidx, rng, opts, graph.algs)) {
    const key = pairKey(a, b);
    if (seen.has(key) || recent.has(key)) continue;
    seen.add(key);
    const x = pidx.byAlg.get(a), y = pidx.byAlg.get(b);
    if (!eligible(x, y, graph)) continue;
    if (wantRandom) return finish(a, b, 'random', pairScore(x, y, ctx));
    const parts = pairScore(x, y, ctx);
    // An alg just shown again (the "extend" pull) gets tedious.
    if (recentAlgs.has(a) || recentAlgs.has(b)) parts.score *= opts.recentAlgFactor;
    if (!best || parts.score > best.parts.score) best = { a, b, parts };
  }
  return best ? finish(best.a, best.b, 'select', best.parts) : null;
}

// ---------------------------------------------------------------- statistics

/**
 * Consistency on repeated pairs (how often the later answer matched the
 * earlier ones' majority) and how often the current model orders the direct
 * strict verdicts the same way.
 */
function answerStats(answers, pidx) {
  const graph = comparisonGraph(answers);
  const firstAnswers = new Map();
  let repeats = 0, consistent = 0;
  for (const r of answers) {
    if (r.answer === 'skip') continue;
    const key = pairKey(r.a, r.b);
    const verdict = r.answer === 'tie' ? 'tie' : r.answer === 'a' ? r.a : r.b;
    if (r.repeat && firstAnswers.has(key)) { repeats++; if (firstAnswers.get(key) === verdict) consistent++; }
    if (!firstAnswers.has(key)) firstAnswers.set(key, verdict);
  }
  let agree = 0, strict = 0;
  for (const p of graph.pairs.values()) {
    if (p.verdict === 'tie') continue;
    const [f, s] = p.verdict === 'lo' ? [p.a, p.b] : [p.b, p.a];
    const time = a => (pidx && pidx.byAlg.has(a) ? pidx.byAlg.get(a).time : modelTime(a));
    strict++;
    if (time(f) < time(s)) agree++;
  }
  const featCount = pidx ? featureCounts(graph, pidx) : null;
  return { graph, repeats, consistent, strict, agree, featCount };
}

module.exports = {
  normalizeAlg, hasWideB, pairKey, algFeatures, FEATURES, modelTime, modelVersion,
  readLog, appendLog, activeAnswers, answerRecord,
  comparisonGraph, indexPool, contextOf,
  SELECT_DEFAULTS, winProbability, fitScale, pairScore, eligible, candidatePairs, selectPair, featureCounts,
  answerStats,
};
