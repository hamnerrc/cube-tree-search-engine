#!/usr/bin/env node
/**
 * ll-build.js -- builds data/ll/algsets.json, the algorithm sets the site
 * shows (README "Algorithm sets"): every case of OLL, PLL, COLL, ZBLL, OLS
 * and ZBLS with its best algorithms, from SpeedCubeDB (data/ll/scdb.json,
 * tools/algdb.js) and from the generator (tools/ll-gen.js), every one
 * replayed on the facelet cube, ranked by alg speed (llScore).
 *
 *   node tools/ll-build.js eval          how each candidate score agrees with the community's votes
 *   node tools/ll-build.js build         write data/ll/algsets.json (raw solutions from $LLGEN_WORK)
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
for (const f of ['script.js', 'facelet-cube.js']) Object.assign(global, require(path.join(ROOT, 'js', f)));
const { AlgSets } = require(path.join(ROOT, 'js', 'alg-sets.js'));
const SCDB = require(path.join(ROOT, 'data', 'll', 'scdb.json'));

const DB_SETS = { oll: ['oll'], pll: ['pll'], coll: ['coll'], zbll: ['zbll'], ols: ['vls', 'hls'] };
const LL_SETS = new Set(['oll', 'pll', 'coll', 'zbll']);
const PRE = ['', 'U', 'U2', "U'"];
const Y_TO_U = { y: 1, y2: 2, "y'": 3 };

/**
 * An alg as the sets store it: the moves after the pre-AUF (`body`) and the
 * pre-AUF itself. On a last-layer case a leading y is the same as a U turn
 * (the F2L is symmetric under y; checked by the replay), so "y A" is stored
 * as U, then A. Trailing U turns are the post-AUF and are dropped.
 */
function splitAlg(text, setId) {
  const toks = AlgSets.normalizeAlg(text).split(' ').filter(Boolean);
  let pre = 0;
  for (;;) {
    const t = toks[0];
    if (t && /^U['2]?$/.test(t)) { pre = (pre + ({ U: 1, U2: 2, "U'": 3 })[t]) % 4; toks.shift(); continue; }
    if (t && LL_SETS.has(setId) && Y_TO_U[t] !== undefined) { pre = (pre + Y_TO_U[t]) % 4; toks.shift(); continue; }
    break;
  }
  while (toks.length && /^U['2]?$/.test(toks[toks.length - 1])) toks.pop();
  return { body: toks.join(' '), pre };
}

/** The pre-AUF (0-3) with which `body` solves the case state, or -1. */
function preAufFor(setId, state, body, hint = 0) {
  for (let k = 0; k < 4; k++) {
    const a = (hint + k) % 4;
    if (AlgSets.solves(setId, state, `${PRE[a]} ${body}`)) return a;
  }
  return -1;
}

// ---- the last-layer naturalness model ----------------------------------------------
// Trained on every verified community alg (all sets); a case is always ranked
// with a model that leaves its own algs out, so neither its community algs
// nor the generated ones are favoured (AlgSets.llScore).
let CORPUS = null;
function llCorpus() {
  if (!CORPUS) {
    CORPUS = [];
    for (const setId of Object.keys(DB_SETS)) {
      for (const c of dbCases(setId)) {
        const seen = new Set();
        for (const a of c.algs) if (!seen.has(a.body)) { seen.add(a.body); CORPUS.push({ key: `${setId}|${c.name}`, body: a.body }); }
      }
    }
  }
  return CORPUS;
}
const MODELS = new Map();
/** The last-layer naturalness model for a case (its algs left out; '' = the whole corpus). */
function llModel(key = '') {
  if (!MODELS.has(key)) {
    if (MODELS.size > 4) MODELS.delete(MODELS.keys().next().value);
    MODELS.set(key, buildNaturalnessModel({ corpus: llCorpus().filter(x => x.key !== key).map(x => x.body) }));
  }
  return MODELS.get(key);
}

// ---- scores ---------------------------------------------------------------------
const mcc = body => algSpeed(body, false, true);
const SCORES = {
  mcc: body => mcc(body),
  'mcc+pen': body => mcc(body) + stepPenalty(body, { ...STEP_PENALTIES, natural: 0 }),
  'mcc+pen+nat': body => mcc(body) + stepPenalty(body, STEP_PENALTIES),
  'mcc+pen/2': body => mcc(body) + 0.5 * stepPenalty(body, { ...STEP_PENALTIES, natural: 0 }),
  stm: body => body.split(' ').filter(t => !/^[xyz]/.test(t)).length,
  'llScore (used)': (body, key) => AlgSets.llScore(body, llModel(key)),
};

/** The SpeedCubeDB cases of a set with their state and verified algs. */
function dbCases(setId) {
  const out = [];
  for (const dbSet of DB_SETS[setId] || []) {
    for (const c of SCDB.sets[dbSet]) {
      const state = AlgSets.algCubie(AlgSets.normalizeAlg(c.setup));
      const algs = [];
      for (const a of c.algs) {
        const { body, pre } = splitAlg(a.alg, setId);
        if (!body) continue;
        const p = preAufFor(setId, state, body, pre);
        if (p < 0) continue;
        algs.push({ body, pre: p, votes: a.votes });
      }
      out.push({ name: c.name, subgroup: c.subgroup, page: c.page, setup: c.setup, state, algs });
    }
  }
  return out;
}

function evaluate() {
  const rows = [];
  for (const setId of Object.keys(DB_SETS)) {
    for (const c of dbCases(setId)) {
      const algs = c.algs.filter((a, i, all) => all.findIndex(b => b.body === a.body) === i);
      if (algs.length < 2) continue;
      rows.push({ setId, algs, key: `${setId}|${c.name}` });
    }
  }
  console.log(`${rows.length} cases with 2+ verified algs`);
  for (const [name, f] of Object.entries(SCORES)) {
    const per = {};
    for (const { setId, algs, key } of rows) {
      const s = algs.map(a => f(a.body, key));
      const p = per[setId] || (per[setId] = { agree: 0, pairs: 0, top: 0, cases: 0 });
      // pairs whose votes differ clearly (by 2+ and 25%+)
      for (let i = 0; i < algs.length; i++) for (let j = 0; j < algs.length; j++) {
        const vi = algs[i].votes, vj = algs[j].votes;
        if (!(vi >= vj + 2 && vi >= 1.25 * vj)) continue;
        p.pairs++;
        if (s[i] < s[j]) p.agree++;
        else if (s[i] === s[j]) p.agree += 0.5;
      }
      const best = algs.reduce((b, a, i) => (a.votes > algs[b].votes ? i : b), 0);
      if (algs[best].votes > 0 && algs.filter(a => a.votes === algs[best].votes).length === 1) {
        p.cases++;
        if (s.every((x, i) => i === best || x > s[best])) p.top++;
      }
    }
    const tot = Object.values(per).reduce((a, p) => ({ agree: a.agree + p.agree, pairs: a.pairs + p.pairs, top: a.top + p.top, cases: a.cases + p.cases }), { agree: 0, pairs: 0, top: 0, cases: 0 });
    const fmt = p => `${(100 * p.agree / p.pairs).toFixed(1)}% of ${p.pairs} pairs, top-voted first ${(100 * p.top / p.cases).toFixed(1)}% of ${p.cases}`;
    console.log(`${name.padEnd(12)} all: ${fmt(tot)}`);
    for (const [k, p] of Object.entries(per)) console.log(`${''.padEnd(12)} ${k.padEnd(5)} ${fmt(p)}`);
  }
}

// ---- building the sets ------------------------------------------------------------
const MAX_ALGS = 12;          // algorithms kept per case
const MAX_DB = 4;             // ... always including up to this many database ones (by votes)
const WORK = path.resolve(process.env.LLGEN_WORK || path.join(ROOT, 'llgen-work'));
const OUT_DIR = path.join(ROOT, 'data', 'll');
const POS = ['UR', 'UF', 'UL', 'UB'];
const flipDesc = c => [0, 1, 2, 3].filter(p => c.ep[p] < 4 && c.eo[p]).map(p => POS[p]).join(' ');
const pairKey = (c) => { const pc = c.cp.indexOf(4), pe = c.ep.indexOf(8); return `${pc}/${c.co[pc]} ${pe}/${c.eo[pe]}`; };
const VLS_PAGE_GROUP = { WV: 'WV', VLSUF: 'VLS UF', VLSUL: 'VLS UL', VLSUB: 'VLS UB', VLSUFUL: 'VLS UF UL', VLSUBUL: 'VLS UL UB', VLSUFUB: 'VLS UF UB', VLSNE: 'VLS no edges' };
const zbllGroup = page => page.replace(/^ZBLL/, '');

/** The state rotated by the U turn (0-3) that makes `test` true, or null. */
function preRotated(state, test) {
  const U = AlgSets.uPowers();
  for (let a = 0; a < 4; a++) { const s = AlgSets.mul(state, U[a]); if (test(s)) return s; }
  return null;
}

function rawSolutions(setId, i) {
  const file = path.join(WORK, 'raw', setId, `${i}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Every case of a set: display state, name, group, database algs. */
function namedCases(setId) {
  const cases = AlgSets.enumerateCases(setId);
  const byKey = new Map();
  cases.forEach((c, i) => c.members.forEach((v, k) => byKey.set(k, i)));
  // index: the case's place in enumerateCases (the raw solutions' file name)
  const out = cases.map((c, index) => ({ state: c.rep, name: '', group: '', db: [], index }));
  dbCases(setId).forEach((d, order) => {
    const i = byKey.get(AlgSets.caseKeyOf(setId, d.state));
    if (i === undefined) throw new Error(`${setId}: database case ${d.name} is not a case of the set`);
    if (out[i].name) throw new Error(`${setId}: two database cases for one case (${out[i].name}, ${d.name})`);
    Object.assign(out[i], { state: d.state, name: d.name, db: d.algs, setup: d.setup, dbKey: `${setId}|${d.name}`, order,
      group: setId === 'zbll' ? zbllGroup(d.page) : setId === 'ols' ? (VLS_PAGE_GROUP[d.page] || 'SV') : d.subgroup });
  });
  if (setId === 'coll') {
    for (const c of out) {
      if (c.name) continue;
      const diag = AlgSets.aufVariants(c.state).some(v => [[2, 1, 0, 3], [0, 3, 2, 1]].some(p => p.every((x, k) => v.c.cp[k] === x)));
      Object.assign(c, { name: diag ? 'O diagonal' : 'O adjacent', group: 'O', order: diag ? 1e6 + 1 : 1e6 });
    }
  }
  if (setId === 'ols') {
    const sv = out.find(c => c.group === 'SV');
    const svPair = pairKey(sv.state);
    const fresh = out.filter(c => !c.name);
    for (const c of fresh) c.state = preRotated(c.state, s => pairKey(s) === svPair);
    // like VLS's subsets: by the flipped LL edges (one, two, all three)
    const flips = c => flipDesc(c.state).split(' ').filter(Boolean);
    const posKey = c => flips(c).map(p => POS.indexOf(p)).join('');
    fresh.sort((a, b) => flips(a).length - flips(b).length || posKey(a).localeCompare(posKey(b))
      || a.state.co.join('').localeCompare(b.state.co.join('')));
    fresh.forEach((c, k) => {
      const f = flips(c);
      Object.assign(c, { name: `HLS ${28 + k}`, group: f.length === 3 ? 'HLS no edges' : `HLS ${f.join(' ')}`, order: 1e6 + k });
    });
  }
  // the database's order (OLL 1-57, ZBLL by subset and number...); cases it
  // does not have follow, in the order named below
  if (setId !== 'zbls') out.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));
  if (setId === 'zbls') {
    const f2l = SCDB.sets.f2l.map(d => ({ name: d.name, pair: pairKey(AlgSets.algCubie(AlgSets.normalizeAlg(d.setup))) }));
    for (const c of out) {
      let hit = null;
      c.state = preRotated(c.state, s => (hit = f2l.find(f => f.pair === pairKey(s))));
      if (!c.state) throw new Error('zbls: a pair placement with no F2L case');
      const f = flipDesc(c.state);
      Object.assign(c, { name: f ? `${hit.name} · flip ${f}` : hit.name, group: hit.name });
    }
    const num = n => +n.match(/\d+/)[0];
    out.sort((a, b) => num(a.group) - num(b.group) || a.name.length - b.name.length || a.name.localeCompare(b.name));
  }
  return out;
}

/** The post-AUF (0-3) after pre-AUF + body on a state, for the sets that solve the whole layer. */
function postAuf(setId, state, pre, body) {
  if (AlgSets.SET_BY_ID[setId].goal !== 0) return 0;
  const after = AlgSets.algCubie(`${PRE[pre]} ${body}`, AlgSets.fromCubie(state));
  const U = AlgSets.uPowers();
  for (let k = 0; k < 4; k++) if (AlgSets.sameCubie(AlgSets.mul(after, U[k]), AlgSets.identity())) return k;
  throw new Error('postAuf: not solved');
}

function buildSet(setId, { requireRaw = true } = {}) {
  const cases = namedCases(setId);
  let missing = 0, genBest = 0, dbBest = 0, withDb = 0, rejected = 0;
  const outCases = cases.map((c) => {
    const cand = new Map();
    const model = llModel(c.dbKey || '');
    const add = (body, pre, src, votes) => {
      const old = cand.get(body);
      if (old) { if (src === 'db') Object.assign(old, { src, votes }); return; }
      cand.set(body, { body, pre, src, votes, score: AlgSets.llScore(body, model) });
    };
    for (const a of c.db) add(a.body, a.pre, 'db', a.votes);
    const raw = rawSolutions(setId, c.index);
    if (!raw) missing++;
    for (const part of raw || []) {
      for (const [, body] of part.algs) {
        if (cand.has(body)) continue;
        const p = preAufFor(setId, c.state, body);
        if (p < 0) { rejected++; continue; }
        add(body, p, 'gen');
      }
    }
    const all = [...cand.values()].sort((a, b) => a.score - b.score);
    const keep = all.slice(0, MAX_ALGS);
    const dbTop = all.filter(a => a.src === 'db').sort((a, b) => b.votes - a.votes).slice(0, MAX_DB);
    for (const a of dbTop) if (!keep.includes(a)) keep.push(a);
    keep.sort((a, b) => a.score - b.score);
    if (keep.length && c.db.length) {
      withDb++;
      if (keep[0].src === 'gen') genBest++; else dbBest++;
    }
    return {
      name: c.name, group: c.group, state: AlgSets.fromCubie(c.state),
      algs: keep.map(a => ({ alg: a.body, pre: a.pre, post: postAuf(setId, c.state, a.pre, a.body), score: Math.round(a.score * 10) / 10, src: a.src, ...(a.src === 'db' ? { votes: a.votes } : {}) })),
    };
  });
  if (requireRaw && missing) throw new Error(`${setId}: ${missing} cases have no generated solutions in ${WORK}`);
  console.log(`${setId}: ${outCases.length} cases, ${outCases.reduce((n, c) => n + c.algs.length, 0)} algs; best alg generated in ${genBest} of ${withDb} database cases (database best in ${dbBest}); ${rejected} raw solutions failed the replay; ${missing} cases without raw solutions`);
  return outCases;
}

function build(setIds, opts) {
  const meta = { version: 1, built: new Date().toISOString().slice(0, 10), source: SCDB.source, fetched: SCDB.fetched };
  for (const setId of setIds) {
    const set = AlgSets.SET_BY_ID[setId];
    const cases = buildSet(setId, opts);
    fs.writeFileSync(path.join(OUT_DIR, `${setId}.json`), JSON.stringify({ ...meta, set: setId, name: set.name, title: set.title, cases }));
  }
}

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'eval') evaluate();
  else if (cmd === 'build') build(rest.length ? rest.filter(x => !x.startsWith('--')) : AlgSets.SETS.map(s => s.id), { requireRaw: !rest.includes('--partial') });
  else console.log('usage: node tools/ll-build.js eval | build [sets...] [--partial]');
}

module.exports = { splitAlg, preAufFor, dbCases, SCORES, namedCases, buildSet, llModel, llCorpus };
