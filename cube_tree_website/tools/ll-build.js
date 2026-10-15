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
// the other databases (tools/alg-sources.js): Speedsolving Wiki, CubingApp, J Perm, the ZBLS sheet
const SOURCES_FILE = path.join(ROOT, 'data', 'll', 'sources.json');
const EXTRA = fs.existsSync(SOURCES_FILE) ? JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8')) : { sources: {}, rows: [] };
EXTRA.algs = require('./alg-sources.js').expand(EXTRA);

// 1LLL's database cases are PLL's and ZBLL's (the oriented-edge ones);
// SpeedCubeDB's 1LLL page names the rest (sources.json `names`, via CubeRoot)
const DB_SETS = { oll: ['oll'], pll: ['pll'], coll: ['coll'], zbll: ['zbll'], ols: ['vls', 'hls'], '1lll': ['pll', 'zbll'] };
const LL_SETS = new Set(['oll', 'pll', 'coll', 'zbll', '1lll']);
const PRE = ['', 'U', 'U2', "U'"];
const Y_TO_U = { y: 1, y2: 2, "y'": 3 };

/**
 * An alg as the sets store it: the moves after the pre-AUF (`body`) and the
 * pre-AUF itself. On a last-layer case a leading y is the same as a U turn
 * (the F2L is symmetric under y; checked by the replay), so "y A" is stored
 * as U, then A. Trailing U turns are the post-AUF and are dropped.
 */
function splitAlg(text, setId) {
  const toks = cancelTurns(AlgSets.normalizeAlg(text).split(' ').filter(Boolean));
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

/**
 * Adjacent turns of the same layer merged (a few community algs carry
 * "U' U" or "U' U' U'"): quarter turns summed, nothing left when they cancel,
 * repeated until stable ("R U U' R'" is nothing).
 */
function cancelTurns(toks) {
  const amount = t => (t.endsWith('2') ? 2 : t.endsWith("'") ? 3 : 1);
  const out = [];
  for (const t of toks) {
    const prev = out[out.length - 1];
    if (prev && prev[0] === t[0]) {
      const q = (amount(prev) + amount(t)) % 4;
      out.pop();
      if (q) out.push(t[0] + ['', '', '2', "'"][q]);
    } else out.push(t);
  }
  return out;
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
      if (setId === '1lll') continue; // PLL's and ZBLL's algs again
      for (const c of dbCases(setId)) {
        const seen = new Set();
        for (const a of c.algs) if (!seen.has(a.body)) { seen.add(a.body); CORPUS.push({ key: `${setId}|${c.name}`, body: a.body }); }
      }
    }
  }
  return CORPUS;
}
const MODELS = new Map();
// Each set's model also learns from what its professional executes in the
// other cases (data/ll/pro_ll.json, tools/ll-pros.js): leave-case-out, that
// put the pro's own alg first more often (tools/ll-tune.js; OLL 50.9% ->
// 59.8% of Yiheng Wang's steps). `weight`: how many times their algs count.
const PRO_LM = {
  oll: { solver: 'Yiheng Wang', weight: 1 },
  pll: { solver: 'Yiheng Wang', weight: 1 },
  zbll: { solver: 'Xuanyi Geng', weight: 3 },
  // ZBLS and COLL: everyone who uses them (62 and 225 steps on reco.nz; one
  // pro alone is too few). OLS has 3 steps in all of reco.nz: none.
  zbls: { solver: null, weight: 3 },
  coll: { solver: null, weight: 8 },
};
const PRO_FILE = path.join(ROOT, 'data', 'll', 'pro_ll.json');
const PRO_CASES = {}; // set -> [{ i (case index), body }] of its pro
function proAlgs(setId) {
  if (PRO_CASES[setId]) return PRO_CASES[setId];
  const lm = PRO_LM[setId];
  if (!lm || !fs.existsSync(PRO_FILE)) return (PRO_CASES[setId] = []);
  const byKey = new Map();
  AlgSets.enumerateCases(setId).forEach((c, i) => c.members.forEach((v, k) => byKey.set(k, i)));
  PRO_CASES[setId] = JSON.parse(fs.readFileSync(PRO_FILE, 'utf8')).rows
    // one professional, or (solver null) everyone who uses the set
    .filter(r => r.set === setId && (!lm.solver || r.solver === lm.solver) && byKey.has(r.key))
    .map(r => ({ i: byKey.get(r.key), body: r.body }));
  return PRO_CASES[setId];
}
/**
 * The last-layer naturalness model for a case: the community's algs without
 * the case's own (`key`; '' = the whole corpus), plus the set's pro's algs
 * of every other case (`setId`, `caseIndex`: enumerateCases order).
 */
function llModel(key = '', setId = null, caseIndex = -1) {
  const lm = setId && PRO_LM[setId];
  const id = lm ? `${key}|${setId}:${caseIndex}` : key;
  if (!MODELS.has(id)) {
    if (MODELS.size > 4) MODELS.delete(MODELS.keys().next().value);
    const corpus = llCorpus().filter(x => x.key !== key).map(x => x.body);
    if (lm) {
      const extra = proAlgs(setId).filter(x => x.i !== caseIndex).map(x => x.body);
      for (let k = 0; k < lm.weight; k++) corpus.push(...extra);
    }
    MODELS.set(id, buildNaturalnessModel({ corpus }));
  }
  return MODELS.get(id);
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
      out.push({ name: c.name, subgroup: c.subgroup, page: c.page, setup: c.setup, state, algs, dbSet });
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
const MAX_ALGS_OLS_MORE = 8;  // ... for the ~7,600 OLS cases beyond VLS and HLS
const MAX_ALGS_1LLL = 8;      // ... for 1LLL beyond ZBLL and PLL (~3,400 cases)
const MAX_DB = 4;             // ... always including up to this many database ones (by votes)
const MAX_SLOWER = 2.5;       // nothing scoring above this many times the case's best
// Algs put first by hand (developer, 2026-10-14: "I would rather just hard
// code those A perms to the top than let x rotation algorithms start showing
// up way too high"). The professionals' choice beyond doubt on reco.nz
// (data/ll/pro_ll.json, every solver: Aa 105 steps + 84 without the final
// x', Ab 120 + 92, E 47 + 25 with an extra final turn), and the community's
// most voted; the ranking had them 4th, 12th and 12th: their rotations are
// regrips the formula cannot see. The score is set below the case's best
// by PIN_MARGIN, which no style term can undo (the style terms move a 15-
// move alg by at most ~3.6 against a 9-move one).
const PINNED = {
  pll: { Aa: "x R' U R' D2 R U' R' D2 R2 x'", Ab: "x R2 D2 R U R' D2 R U' R x'", E: "x' R U' R' D R U R' D' R U R' D R U' R' D' x" },
};
const PIN_MARGIN = 5;
// an alg pros executed this often (reco.nz, any solver) or with this many votes is not awkward
const AWK_PRO_USES = 2, AWK_VOTES = 5;
const PRO_USE = {};
/** body -> how often any professional executed it in a set (1LLL: ZBLL's and PLL's). */
function proUse(setId) {
  if (PRO_USE[setId]) return PRO_USE[setId];
  const m = new Map();
  const sets = setId === '1lll' ? ['zbll', 'pll', 'coll', 'oll'] : [setId];
  if (fs.existsSync(PRO_FILE)) {
    for (const r of JSON.parse(fs.readFileSync(PRO_FILE, 'utf8')).rows) {
      if (!sets.includes(r.set)) continue;
      const b = splitAlg(r.body, setId).body;
      m.set(b, (m.get(b) || 0) + 1);
    }
  }
  return (PRO_USE[setId] = m);
}
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

// a run under way keeps one file per move set until the case is finished
const RAW_PARTS = {};
function rawSolutions(setId, i) {
  const dir = path.join(WORK, 'raw', setId);
  const file = path.join(dir, `${i}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!RAW_PARTS[setId]) {
    RAW_PARTS[setId] = new Map();
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        const m = /^(\d+)\.([A-Za-z]+)\.json$/.exec(f);
        if (m) (RAW_PARTS[setId].get(+m[1]) || RAW_PARTS[setId].set(+m[1], []).get(+m[1])).push(f);
      }
    }
  }
  const parts = RAW_PARTS[setId].get(i);
  return parts ? parts.map(f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) : null;
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
    Object.assign(out[i], { state: d.state, name: setId === '1lll' && d.dbSet === 'pll' ? `PLL ${d.name}` : d.name, db: d.algs, setup: d.setup, dbKey: `${d.dbSet}|${d.name}`, order,
      group: setId === 'zbll' ? zbllGroup(d.page) : setId === 'ols' ? (VLS_PAGE_GROUP[d.page] || 'SV') : d.subgroup });
  });
  if (setId === 'coll' || setId === '1lll' || setId === 'zbll') nameLastLayer(setId, out, byKey);
  // the other databases' algs, by the case their key belongs to
  for (const a of EXTRA.algs) {
    if (a.set !== setId) continue;
    const i = byKey.get(a.key);
    if (i === undefined) continue;
    (out[i].extra = out[i].extra || []).push(a);
  }
  if (setId === 'ols') {
    for (const c of out) { c.tags = AlgSets.olsSubsets(c.state); if (!c.tags.length) c.maxAlgs = MAX_ALGS_OLS_MORE; }
    const sv = out.find(c => c.group === 'SV');
    const svPair = pairKey(sv.state);
    const fresh = out.filter(c => !c.name && c.tags.includes('hls'));
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
    // every other pair placement (full OLS): named after its F2L case, then
    // numbered within it by the flipped edges and the corner twists
    const f2l = SCDB.sets.f2l.map(d => ({ name: d.name, pair: pairKey(AlgSets.algCubie(AlgSets.normalizeAlg(d.setup))) }));
    const rest = out.filter(c => !c.name);
    for (const c of rest) {
      let hit = null;
      c.state = preRotated(c.state, s => (hit = f2l.find(f => f.pair === pairKey(s))));
      if (!c.state) throw new Error('ols: a pair placement with no F2L case');
      c.f2l = hit.name;
    }
    const num = n => +((/(\d+)\s*$/.exec(n) || [])[1] || 0); // "F2L 17" -> 17 (not the 2 of "F2L")
    rest.sort((a, b) => num(a.f2l) - num(b.f2l) || flips(a).length - flips(b).length || flips(a).join().localeCompare(flips(b).join())
      || a.state.co.join('').localeCompare(b.state.co.join('')));
    const counter = {};
    rest.forEach((c, k) => {
      counter[c.f2l] = (counter[c.f2l] || 0) + 1;
      Object.assign(c, { name: `${c.f2l} · ${counter[c.f2l]}`, group: c.f2l, order: 2e6 + k });
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
    const num = n => +((/(\d+)\s*$/.exec(n) || [])[1] || 0); // "F2L 17" -> 17 (not the 2 of "F2L")
    out.sort((a, b) => num(a.group) - num(b.group) || a.name.length - b.name.length || a.name.localeCompare(b.name));
  }
  return out;
}

// ---- names and subsets of COLL, ZBLL and 1LLL (developer, 2026-10-14) -------------
// COLL: one subset per OLL. ZBLL: by corner orientation (SpeedCubeDB's
// pages), then by corner permutation -- the COLL case of its corners. 1LLL:
// one subset per OLL (PLL for an oriented layer), then one per corner
// permutation, as in COLL; the oriented layer's by PLL's corner kinds.
const BUILT = {};
function builtSet(setId) {
  if (!BUILT[setId]) {
    const file = path.join(OUT_DIR, `${setId}.json`);
    if (!fs.existsSync(file)) throw new Error(`${setId}.json must be built first`);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    BUILT[setId] = { data, index: AlgSets.indexSet(setId, data) };
  }
  return BUILT[setId];
}
/** The case of a state in a built set ({ i, a, b } and the case), or null. */
function builtCase(setId, state) {
  const b = builtSet(setId);
  const hit = AlgSets.recognize(setId, b.index, state);
  return hit ? { hit, kase: b.data.cases[hit.i] } : null;
}
const ollNumber = name => +((/(\d+)/.exec(name) || [])[1] || 0);
/** PLL's corner kinds for an oriented layer: corners solved, an adjacent or a diagonal swap. */
function cornerKind(state) {
  const vs = AlgSets.aufVariants(state).map(v => v.c.cp.slice(0, 4).join(''));
  const U = AlgSets.uPowers().map(u => u.cp.slice(0, 4).join(''));
  if (vs.some(v => U.includes(v))) return 'Corners solved';
  if (vs.some(v => v === '2103' || v === '0321')) return 'Diagonal corner swap';
  return 'Adjacent corner swap';
}
function nameLastLayer(setId, out, byKey) {
  // the databases' names by case index (sources.json keeps one key per case)
  const named = {};
  for (const [k, name] of Object.entries((EXTRA.names || {})[setId] || {})) if (byKey.has(k)) named[byKey.get(k)] = name;
  const counter = {};
  for (const c of out) {
    const oll = AlgSets.llOriented(c.state) ? null : builtCase('oll', c.state);
    const ollName = oll ? oll.kase.name : 'PLL';
    if (setId === 'zbll') {
      const cc = builtCase('coll', c.state);
      c.sub = cc ? cc.kase.name : '';
      continue;
    }
    if (setId === 'coll') {
      c.group = ollName;
      if (!c.name) {
        // SpeedCubeDB's OLLCP number within the OLL ("OLLCP12 3" -> "OLL 12 · 3")
        const m = /^OLLCP\s*(\d+)\s+(\d+)/i.exec(named[c.index] || '');
        c.name = m ? `OLL ${m[1]} · ${m[2]}` : '';
      }
      c.tags = ['ollcp'];
      c.order = ollNumber(ollName) * 100 + (c.name.includes('·') ? +c.name.split('·')[1] || 50 : 0);
      continue;
    }
    // 1LLL
    c.group = ollName;
    if (oll) {
      const cc = builtCase('coll', c.state);
      c.sub = cc ? cc.kase.name : '';
    } else c.sub = cornerKind(c.state);
    let num = c.order ?? 5e3;
    if (!c.name) {
      const m = /^1LLL\s*(\d+)\s+(\d+)/i.exec(named[c.index] || '');
      c.name = m ? `1LLL ${m[1]} ${m[2]}` : '';
      if (m) num = +m[2];
    }
    c.order = (oll ? ollNumber(ollName) : 58) * 1e4 + num;
    if (oll && AlgSets.llEO(c.state) === false) c.maxAlgs = MAX_ALGS_1LLL;
  }
  // names the databases do not have: numbered after the last one in the group
  for (const c of out) {
    if (c.name || setId === 'zbll') continue;
    const g = c.group;
    counter[g] = (counter[g] || 0) + 1;
    c.name = setId === 'coll' ? `${g} · ${6 + counter[g]}` : `1LLL ${ollNumber(g)} x${counter[g]}`;
    c.order = (c.order || 0) + 90 + counter[g];
  }
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
  let missing = 0, genBest = 0, dbBest = 0, withDb = 0, rejected = 0, noAlgs = 0;
  const outCases = cases.map((c) => {
    // 1LLL's oriented-edge cases are ZBLL's and PLL's: their lists as built there
    if (setId === '1lll' && AlgSets.llEO(c.state)) {
      const from = AlgSets.llOriented(c.state) ? 'pll' : 'zbll';
      const b = builtCase(from, c.state);
      if (!b) throw new Error(`1lll ${c.name}: not a ${from} case`);
      return { name: c.name, group: c.group, sub: c.sub, state: b.kase.state, ...(b.kase.awkOk ? { awkOk: 1 } : {}), algs: b.kase.algs };
    }
    const cand = new Map();
    const model = llModel(c.dbKey || '', setId, c.index);
    const add = (body, pre, src, votes, from = []) => {
      const old = cand.get(body);
      if (old) {
        if (src === 'db') Object.assign(old, { src, votes: Math.max(old.votes || 0, votes || 0) });
        for (const f of from) if (!old.from.includes(f)) old.from.push(f);
        return;
      }
      cand.set(body, { body, pre, src, votes, from: from.slice(), score: AlgSets.llScore(body, model, setId) });
    };
    for (const a of c.db) add(a.body, a.pre, 'db', a.votes, ['scdb']);
    for (const a of c.extra || []) {
      const { body } = splitAlg(a.alg, setId);
      if (!body) continue;
      const p = preAufFor(setId, c.state, body);
      if (p < 0) { rejected++; continue; }
      add(body, p, 'db', 0, a.from);
    }
    const raw = rawSolutions(setId, c.index);
    if (!raw) missing++;
    if (!raw && setId === '1lll' && !c.db.length && !(c.extra || []).length) noAlgs++;
    for (const part of raw || []) {
      for (const [, body] of part.algs) {
        if (cand.has(body)) continue;
        const p = preAufFor(setId, c.state, body);
        if (p < 0) { rejected++; continue; }
        add(body, p, 'gen');
      }
    }
    // far slower than the best (a few community entries are jokes), or
    // awkward beyond doubt: out, unless the community voted for them
    for (const a of cand.values()) {
      a.awk = AlgSets.awkwardness(a.body, setId);
      // what professionals execute, or the community votes for, is never
      // awkward, whatever its moves (developer, 2026-10-14: pros turn the
      // u G perms, f OLL 51, B OLL 52, S algs; the rule had hidden them)
      if ((proUse(setId).get(a.body) || 0) >= AWK_PRO_USES || (a.votes || 0) >= AWK_VOTES) a.awk = { ...a.awk, awkward: false, drop: false };
    }
    // (an alg several databases list counts as a vote from each of the others)
    const weight = a => (a.votes || 0) + Math.max(0, a.from.length - 1);
    // the case's community favourite (votes, then how many databases list it)
    const fav = [...cand.values()].filter(a => a.src === 'db').sort((a, b) => weight(b) - weight(a) || a.score - b.score)[0];
    // awkward beyond doubt: out, whatever the votes, unless it is the favourite
    const voted = a => a.src === 'db' && a.votes > 0 && !a.awk.drop;
    const sorted = [...cand.values()].sort((a, b) => a.score - b.score);
    const all = sorted.filter(a => a === fav || (a.score <= MAX_SLOWER * sorted[0].score && !a.awk.drop) || voted(a));
    const keep = all.slice(0, c.maxAlgs || MAX_ALGS);
    // the community's algs with a vote always stay (a 0-vote one competes on speed)
    const dbTop = all.filter(a => a.src === 'db' && weight(a) > 0 && (a === fav || !a.awk.drop)).sort((a, b) => weight(b) - weight(a)).slice(0, MAX_DB);
    for (const a of dbTop) if (!keep.includes(a)) keep.push(a);
    keep.sort((a, b) => a.score - b.score);
    // the standard alg of a case, first (PINNED)
    const pin = (PINNED[setId] || {})[c.name];
    if (pin) {
      const a = keep.find(x => x.body === pin) || cand.get(pin);
      if (!a) throw new Error(`${setId} ${c.name}: pinned alg ${pin} is not a candidate`);
      if (!keep.includes(a)) keep.push(a);
      a.score = Math.min(a.score, keep[0].score - PIN_MARGIN);
      a.pin = true;
      keep.sort((x, y) => x.score - y.score);
    }
    if (keep.length && c.db.length) {
      withDb++;
      if (keep[0].src === 'gen') genBest++; else dbBest++;
    }
    const awkOk = !!(fav && fav.awk.awkward);
    return {
      name: c.name, group: c.group, ...(c.sub ? { sub: c.sub } : {}), state: AlgSets.fromCubie(c.state), ...(c.tags && c.tags.length ? { tags: c.tags } : {}),
      ...(awkOk ? { awkOk: 1 } : {}),
      algs: keep.map(a => ({ alg: a.body, pre: a.pre, post: postAuf(setId, c.state, a.pre, a.body), score: Math.round(a.score * 10) / 10, src: a.src,
        ...(a.src === 'db' ? { votes: a.votes || 0, from: a.from } : {}), ...(a.awk.awkward && !a.pin ? { awk: 1 } : {}) })),
    };
  });
  if (requireRaw && missing) throw new Error(`${setId}: ${missing} cases have no generated solutions in ${WORK}`);
  if (noAlgs) console.log(`${setId}: ${noAlgs} cases with no alg at all yet`);
  console.log(`${setId}: ${outCases.length} cases, ${outCases.reduce((n, c) => n + c.algs.length, 0)} algs; best alg generated in ${genBest} of ${withDb} database cases (database best in ${dbBest}); ${rejected} raw solutions failed the replay; ${missing} cases without raw solutions`);
  return outCases;
}

function build(setIds, opts) {
  const meta = { version: 2, built: new Date().toISOString().slice(0, 10), source: SCDB.source, fetched: SCDB.fetched,
    sources: { scdb: { name: 'SpeedCubeDB', url: 'https://www.speedcubedb.com' }, ...EXTRA.sources } };
  for (const setId of setIds) {
    const set = AlgSets.SET_BY_ID[setId];
    const cases = buildSet(setId, opts);
    if (setId === 'ols') {
      // OLS: WV, SV, VLS and HLS in ols.json; every other pair placement
      // (~7,600 cases) in ols-more.json, loaded only where it is wanted
      const write = (file, list) => fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify({ ...meta, set: setId, name: set.name, title: set.title, cases: list }));
      write('ols.json', cases.filter(c => c.tags));
      write('ols-more.json', cases.filter(c => !c.tags));
      continue;
    }
    fs.writeFileSync(path.join(OUT_DIR, `${setId}.json`), JSON.stringify({ ...meta, set: setId, name: set.name, title: set.title, cases }));
  }
}

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'eval') evaluate();
  else if (cmd === 'build') build(rest.length ? rest.filter(x => !x.startsWith('--')) : AlgSets.SETS.map(s => s.id), { requireRaw: !rest.includes('--partial') });
  else console.log('usage: node tools/ll-build.js eval | build [sets...] [--partial]');
}

module.exports = { splitAlg, cancelTurns, preAufFor, dbCases, SCORES, namedCases, buildSet, llModel, llCorpus, rawSolutions, EXTRA, PRO_LM };
