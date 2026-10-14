#!/usr/bin/env node
/**
 * ll-tune.js -- fits each alg set's ranking constants on what professionals
 * execute (developer, 2026-10-13: OLL and PLL on Yiheng Wang, ZBLL and ZBLS
 * on Xuanyi Geng; a set without pro data keeps the vote-fitted constants).
 *
 *   node tools/ll-tune.js eval [sets]        the pros' algs' ranks under the current constants
 *   node tools/ll-tune.js fit <set> [--solver "Name"]   coordinate fit, 2-fold CV over cases
 *
 * Data: data/ll/pro_ll.json (tools/ll-pros.js). Each pro step is ranked among
 * its case's candidates: every generated solution of the case (raw, from
 * $LLGEN_WORK; else the built list), every community alg, and the pro's alg
 * itself. Metric: mean log2 of the pro alg's rank (ties share), and how often
 * it is first. The naturalness model of a case leaves out that case's own
 * community algs (tools/ll-build.js llModel), so no candidate is favoured.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
for (const f of ['script.js', 'facelet-cube.js']) Object.assign(global, require(path.join(ROOT, 'js', f)));
const { AlgSets } = require(path.join(ROOT, 'js', 'alg-sets.js'));
const B = require('./ll-build.js');

const MCC_KEYS = ['wristMult', 'pushMult', 'ringMult', 'destabilize', 'addRegrip', 'double', 'sesliceMult', 'overWorkMult', 'moveblock', 'rotation'];
const PEN_KEYS = ['D', 'F', 'B', 'wideRL', 'wideUDFB', 'wideOther'];
const POOL_CAP = 400; // candidates per case, best first by the current score

/** A body's features: counts per penalty class, left-hand turns, STM. */
function features(body) {
  const f = { D: 0, F: 0, B: 0, wideRL: 0, wideUDFB: 0, wideOther: 0, left: 0, stm: 0 };
  for (const t of body.split(' ')) {
    const c = t[0];
    if (c === 'D') f.D++; else if (c === 'F') f.F++; else if (c === 'B') f.B++;
    else if (c === 'r' || c === 'l') f.wideRL++;
    else if ('udfb'.includes(c)) f.wideUDFB++;
    else if ('MES'.includes(c)) f.wideOther++;
    if (c === 'L' || c === 'l') f.left++;
    if (!/^[xyz]/.test(t)) f.stm++;
  }
  return f;
}

/** The pros' rows of a set, each with its case's candidate pool. */
function loadSet(setId, solver = undefined) {
  // the set's own professional (tools/ll-build.js PRO_LM), unless named; null: everyone
  if (solver === undefined) solver = B.PRO_LM[setId] ? B.PRO_LM[setId].solver : null;
  const pro = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'll', 'pro_ll.json'), 'utf8')).rows
    .filter(r => r.set === setId && (!solver || r.solver === solver));
  const cases = B.namedCases(setId);
  const byKey = new Map();
  const enumerated = AlgSets.enumerateCases(setId);
  enumerated.forEach((c, i) => c.members.forEach((v, k) => byKey.set(k, i)));
  const caseByIndex = new Map(cases.map(c => [c.index, c]));
  const built = fs.existsSync(path.join(ROOT, 'data', 'll', `${setId}.json`)) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'll', `${setId}.json`), 'utf8')) : null;
  const builtIndex = built ? AlgSets.indexSet(setId, built) : null;
  const pools = new Map(); // case index -> { bodies, feats, surprise, mcc cache }
  const rows = [];
  for (const r of pro) {
    const i = byKey.get(r.key);
    if (i === undefined) continue;
    if (!pools.has(i)) {
      const c = caseByIndex.get(i);
      const set = new Set();
      for (const a of c.db) set.add(a.body);
      for (const a of c.extra || []) { const b = B.splitAlg(a.alg, setId).body; if (b) set.add(b); }
      const raw = B.rawSolutions(setId, i);
      if (raw) for (const part of raw) for (const [, body] of part.algs) set.add(body);
      else if (builtIndex) {
        const st = c.state;
        const hit = AlgSets.recognize(setId, builtIndex, st);
        if (hit) for (const a of built.cases[hit.i].algs) set.add(a.alg);
      }
      const model = B.llModel(c.dbKey || '', setId, i);
      let bodies = [...set];
      // the pool: the best by the current score (the pro's alg is added below)
      if (bodies.length > POOL_CAP) {
        const sc = new Map(bodies.map(b => [b, AlgSets.llScore(b, model, setId)]));
        bodies.sort((a, b) => sc.get(a) - sc.get(b));
        bodies = bodies.slice(0, POOL_CAP);
      }
      pools.set(i, { bodies, model, key: c.dbKey || '' });
    }
    const pool = pools.get(i);
    if (!pool.bodies.includes(r.body)) pool.bodies.push(r.body);
    rows.push({ ...r, i });
  }
  // the community's votes on the same set: pairs whose votes differ clearly
  const votes = [];
  for (const c of B.dbCases(setId)) {
    const algs = c.algs.filter((a, k, all) => all.findIndex(b => b.body === a.body) === k);
    if (algs.length < 2) continue;
    const i = byKey.get(AlgSets.caseKeyOf(setId, c.state));
    const pool = { bodies: algs.map(a => a.body), votes: algs.map(a => a.votes), model: B.llModel(`${setId}|${c.name}`, setId, i === undefined ? -1 : i), i };
    votes.push(pool);
  }
  for (const pool of [...pools.values(), ...votes]) {
    pool.feats = pool.bodies.map(features);
    pool.surprise = pool.bodies.map(b => pool.model.surprise(b));
    pool.mcc = new Map();
  }
  return { setId, rows, pools, votes };
}

/** Agreement with the votes: the share of clearly ordered pairs the score orders the same way. */
function voteAgreement(data, P, use = () => true) {
  let agree = 0, pairs = 0;
  for (const pool of data.votes) {
    if (!use({ i: pool.i })) continue;
    const s = poolScores(pool, P);
    for (let a = 0; a < s.length; a++) for (let b = 0; b < s.length; b++) {
      const va = pool.votes[a], vb = pool.votes[b];
      if (!(va >= vb + 2 && va >= 1.25 * vb)) continue;
      pairs++;
      if (s[a] < s[b]) agree++; else if (s[a] === s[b]) agree += 0.5;
    }
  }
  return pairs ? agree / pairs : null;
}
// the votes as a regulariser: one point of agreement weighs this much log2 rank
const VOTE_WEIGHT = 2;
function objective(data, P, use) {
  const e = evaluate(data, P, use);
  const v = voteAgreement(data, P, use);
  return e.logRank - (v === null ? 0 : VOTE_WEIGHT * v);
}

/** Scores of a pool under constants P = { mcc, pen, left, natural }. */
function poolScores(pool, P) {
  const mk = MCC_KEYS.map(k => P.mcc[k]).join(',');
  let m = pool.mcc.get(mk);
  if (!m) {
    m = pool.bodies.map(b => algSpeed(b, false, true, ...MCC_KEYS.map(k => P.mcc[k])));
    if (pool.mcc.size > 40) pool.mcc.clear();
    pool.mcc.set(mk, m);
  }
  return pool.bodies.map((b, j) => {
    const f = pool.feats[j];
    let s = m[j] + P.left * f.left + P.natural * pool.surprise[j];
    for (const k of PEN_KEYS) s += P.pen[k] * f[k];
    return s;
  });
}

/** Mean log2 rank and top-1 rate of the pros' algs (rows filtered by `use`). */
function evaluate(data, P, use = () => true) {
  let sum = 0, n = 0, top = 0;
  const memo = new Map();
  for (const r of data.rows) {
    if (!use(r)) continue;
    const pool = data.pools.get(r.i);
    if (!memo.has(r.i)) memo.set(r.i, poolScores(pool, P));
    const s = memo.get(r.i);
    const mine = s[pool.bodies.indexOf(r.body)];
    let better = 0, ties = 0;
    for (const x of s) { if (x < mine - 1e-9) better++; else if (Math.abs(x - mine) <= 1e-9) ties++; }
    const rank = better + (ties + 1) / 2;
    sum += Math.log2(rank);
    if (rank < 1.5) top++;
    n++;
  }
  return { logRank: n ? sum / n : 0, top: n ? top / n : 0, n };
}

/** The constants a set ranks with now (alg-sets.js). */
const current = setId => JSON.parse(JSON.stringify(AlgSets.llParams(setId)));

// few knobs, small steps (a first fit of all eighteen constants on pro data
// alone overfitted: cross-validated rank got worse)
const KNOBS = [
  ...['D', 'F', 'B', 'wideRL', 'wideOther'].map(k => ({ get: P => P.pen[k], set: (P, v) => { P.pen[k] = v; }, steps: [-0.75, 0.75], min: 0, name: `pen.${k}` })),
  { get: P => P.left, set: (P, v) => { P.left = v; }, steps: [-0.5, 0.5], min: 0, name: 'left' },
  { get: P => P.natural, set: (P, v) => { P.natural = v; }, steps: [-0.25, 0.25], min: 0, name: 'natural' },
  ...['double', 'rotation', 'addRegrip'].map(k => ({ get: P => P.mcc[k], set: (P, v) => { P.mcc[k] = v; }, mult: [0.85, 1.15], min: 0, name: `mcc.${k}` })),
];

/** Coordinate descent on the rows `use` accepts. */
function fit(data, start, use, rounds = 3) {
  let P = JSON.parse(JSON.stringify(start));
  let best = objective(data, P, use);
  for (let round = 0; round < rounds; round++) {
    let moved = false;
    for (const kn of KNOBS) {
      const v0 = kn.get(P);
      const tries = kn.mult ? kn.mult.map(m => v0 * m) : kn.steps.map(d => v0 + d);
      for (const v of tries) {
        if (v < kn.min) continue;
        const Q = JSON.parse(JSON.stringify(P));
        kn.set(Q, v);
        const e = objective(data, Q, use);
        if (e < best - 1e-4) { best = e; P = Q; moved = true; }
      }
    }
    if (!moved) break;
  }
  return { P, best };
}

function cmdEval(sets) {
  for (const setId of sets) {
    const data = loadSet(setId);
    if (!data.rows.length) { console.log(`${setId}: no pro steps`); continue; }
    const e = evaluate(data, current(setId));
    console.log(`${setId}: ${e.n} pro steps over ${data.pools.size} cases: mean log2 rank ${e.logRank.toFixed(3)}, first ${(100 * e.top).toFixed(1)}%`);
  }
}

function cmdFit(setId, solver) {
  const data = loadSet(setId, solver);
  const start = current(setId);
  const base = evaluate(data, start);
  console.log(`${setId}${solver ? ` (${solver})` : ''}: ${base.n} steps, ${data.pools.size} cases; now ${base.logRank.toFixed(3)} / first ${(100 * base.top).toFixed(1)}%`);
  // 2-fold CV over cases: fit on one half, score the other
  const fold = r => (r.i * 2654435761 >>> 0) % 2;
  let cv = 0, cvTop = 0, n = 0, base2 = 0;
  for (const k of [0, 1]) {
    const { P } = fit(data, start, r => fold(r) !== k);
    const e = evaluate(data, P, r => fold(r) === k);
    const b = evaluate(data, start, r => fold(r) === k);
    const va = voteAgreement(data, start, r => fold(r) === k), vb = voteAgreement(data, P, r => fold(r) === k);
    console.log(`  fold ${k}: held out ${e.n} steps: ${b.logRank.toFixed(3)} -> ${e.logRank.toFixed(3)}, first ${(100 * b.top).toFixed(1)}% -> ${(100 * e.top).toFixed(1)}%; votes ${va === null ? '-' : (100 * va).toFixed(1)}% -> ${vb === null ? '-' : (100 * vb).toFixed(1)}%`);
    cv += e.logRank * e.n; cvTop += e.top * e.n; base2 += b.logRank * b.n; n += e.n;
  }
  console.log(`  cross-validated: ${(base2 / n).toFixed(3)} -> ${(cv / n).toFixed(3)}, first ${(100 * cvTop / n).toFixed(1)}%`);
  const { P } = fit(data, start, () => true);
  const all = evaluate(data, P);
  const v0 = voteAgreement(data, start), v1 = voteAgreement(data, P);
  console.log(`  fitted on all: ${all.logRank.toFixed(3)}, first ${(100 * all.top).toFixed(1)}%; votes ${v0 === null ? '-' : (100 * v0).toFixed(1)}% -> ${v1 === null ? '-' : (100 * v1).toFixed(1)}%`);
  console.log(JSON.stringify(P));
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const si = args.indexOf('--solver');
  let solver = si >= 0 ? args.splice(si, 2)[1] : undefined;
  if (solver === 'all') solver = null;
  const [cmd, ...rest] = args;
  if (cmd === 'eval') cmdEval(rest.length ? rest : ['oll', 'pll', 'zbll', 'zbls', 'coll', 'ols']);
  else if (cmd === 'fit' && rest[0]) cmdFit(rest[0], solver);
  else console.log('usage: node tools/ll-tune.js eval [sets] | fit <set> [--solver Name]');
}
module.exports = { loadSet, evaluate, fit, features, poolScores, voteAgreement };
