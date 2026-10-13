#!/usr/bin/env node
/**
 * ll-gen.js -- generates the algorithms of the last-layer and last-slot sets
 * (README "Algorithm sets") with tools/llgen/llgen.cpp: for every case and
 * every move set, all solutions up to a few moves above the shortest in that
 * set. tools/ll-build.js ranks them with the database algorithms.
 *
 *   node tools/ll-gen.js build                    compile tools/llgen/llgen.cpp into <work>/llgen
 *   node tools/ll-gen.js run <set> [from] [to]    generate cases [from, to) of a set into <work>/raw/<set>/
 *   node tools/ll-gen.js case <set> <index>       one case, every move set, counts and timings
 *
 * <work> is $LLGEN_WORK (default: ./llgen-work, outside git): the binary,
 * its pruning tables (~86 MB per move set and goal) and the raw solutions.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
Object.assign(global, require(path.join(ROOT, 'js', 'facelet-cube.js')));
const { AlgSets } = require(path.join(ROOT, 'js', 'alg-sets.js'));

const WORK = path.resolve(process.env.LLGEN_WORK || path.join(ROOT, 'llgen-work'));
const BIN = process.env.LLGEN_BIN || path.join(WORK, 'llgen');

// The move sets searched (token families), from the groups the community's
// top algorithms use (tools note in PROJECT_STATUS "Algorithm sets").
const MOVE_SETS = {
  RU: 'RU', RUF: 'RUF', RUD: 'RUD', RUL: 'RUL', RUB: 'RUB', RUFD: 'RUFD', RUFL: 'RUFL',
  RUFr: 'RUFr', RUDr: 'RUDr', RUMr: 'RUMr', RUFMr: 'RUFMr', RUFSf: 'RUFSf', RUSr: 'RUSr',
  LUF: 'LUF', LUFl: 'LUFl', RUFl: 'RUFl',
};
// per alg set: [move set, slack above its own shortest solution]; maxLen caps all
const PLAN = {
  oll: { maxLen: 16, sets: [['RUF', 3], ['RUFr', 3], ['RUFl', 2], ['LUF', 3], ['LUFl', 2], ['RUD', 2], ['RUL', 2], ['RUFMr', 2], ['RUFSf', 2], ['RUFD', 2]] },
  pll: { maxLen: 20, sets: [['RU', 3], ['RUF', 2], ['RUD', 2], ['RUL', 2], ['RUFD', 2], ['RUFr', 2], ['RUDr', 2], ['RUMr', 2], ['RUFL', 1], ['RUB', 1]] },
  coll: { maxLen: 18, sets: [['RU', 3], ['RUF', 2], ['RUD', 2], ['RUL', 2], ['RUFD', 2], ['RUFr', 2], ['LUF', 2], ['RUDr', 2], ['RUMr', 1]] },
  zbll: { maxLen: 19, sets: [['RU', 3], ['RUF', 1], ['RUD', 2], ['RUL', 2], ['RUFD', 1], ['RUFr', 1], ['RUDr', 1], ['RUMr', 1]] },
  ols: { maxLen: 16, sets: [['RUF', 2], ['RUD', 2], ['RUL', 2], ['RUFr', 2], ['RUFD', 1], ['RUDr', 1], ['RUFSf', 1], ['RUFL', 1]] },
  zbls: { maxLen: 16, sets: [['RU', 3], ['RUF', 2], ['RUD', 2], ['RUL', 2], ['RUFr', 2], ['RUFD', 1], ['RUDr', 1], ['RUB', 1]] },
};
const MAX_SOLS = 20000;     // per case and move set
const NODE_LIMIT = Number(process.env.LLGEN_NODES) || 1.5e8; // per case and move set (~1 min)

const TOKENS = [];
for (const f of 'URFDLBurfdlbMES') for (const s of ['', "'", '2']) TOKENS.push(f + s);
const AXIS = { R: 0, L: 0, r: 0, l: 0, M: 0, U: 1, D: 1, u: 1, d: 1, E: 1, F: 2, B: 2, f: 2, b: 2, S: 2 };
const cub = c => [...c.cp, ...c.co, ...c.ep, ...c.eo].join(' ');
const CENTRES = [4, 13, 22, 31, 40, 49];
const centres = f => CENTRES.map(i => f[i]).join('');
const SCHEME = {};
for (let f = 0; f < 6; f++) SCHEME[SOLVED_FACELETS[9 * f + 4]] = 'URFDLB'[f];
/** The solver's view of a cube: pieces by the solved colour scheme, centres ignored. */
const humanCubie = facelets => AlgSets.toCubie([...facelets].map(c => SCHEME[c]).join(''));

function frames() {
  const out = [];
  const index = new Map();
  for (const a of ['', 'x', 'x2', "x'", 'z', "z'"]) for (const b of ['', 'y', 'y2', "y'"]) {
    const r = [a, b].filter(Boolean).join(' ');
    const k = centres(applyAlgorithm(SOLVED_FACELETS, r));
    if (!index.has(k)) { index.set(k, out.length); out.push(r); }
  }
  if (out.length !== 24) throw new Error(`expected 24 frames, got ${out.length}`);
  return { list: out, index };
}

function header() {
  const F = frames();
  let s = '';
  TOKENS.forEach((t, i) => {
    s += `TOKEN ${i} ${t} ${AXIS[t[0]]} ${/^U/.test(t) ? 1 : 0} ${cub(humanCubie(applyAlgorithm(SOLVED_FACELETS, t)))}\n`;
  });
  F.list.forEach((r, i) => {
    const f = applyAlgorithm(SOLVED_FACELETS, r || '');
    s += `FRAME ${i} ${f[4] === SOLVED_FACELETS[4] ? 1 : 0} ${cub(humanCubie(f))}\n`;
  });
  F.list.forEach((r, fi) => TOKENS.forEach((t, ti) => {
    s += `NF ${fi} ${ti} ${F.index.get(centres(applyAlgorithm(SOLVED_FACELETS, `${r} ${t}`.trim())))}\n`;
  }));
  s += `TABLES ${path.join(WORK, 'tables')}\n`;
  return s;
}

const tokensOf = families => TOKENS.map((t, i) => (families.includes(t[0]) ? i : -1)).filter(i => i >= 0);

/** The CASE lines of one case of a set, one per move set of its plan. */
function caseLines(setId, index, rep, plan = PLAN[setId]) {
  const goal = AlgSets.SET_BY_ID[setId].goal;
  const starts = AlgSets.uPowers().map(u => AlgSets.mul(rep, u));
  return plan.sets.map(([ms, slack]) => {
    const tk = tokensOf(MOVE_SETS[ms] || ms);
    return `CASE ${setId}:${index}:${ms} ${goal} ${plan.maxLen} ${slack} ${MAX_SOLS} ${NODE_LIMIT} ${ms} ${tk.length} ${tk.join(' ')} 4\n${starts.map(cub).join('\n')}\n`;
  });
}

/** Runs llgen on CASE lines; calls onCase({ id, opt, bound, count, truncated, nodes, sols: [[start, alg]] }). */
function runLlgen(lines, onCase) {
  return new Promise((resolve, reject) => {
    const child = spawn(BIN, [], { stdio: ['pipe', 'pipe', 'inherit'] });
    let buf = '';
    let cur = null;
    child.stdout.on('data', (d) => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (line.startsWith('CASE ')) {
          const [, id, opt, bound, count, truncated, nodes] = line.split(' ');
          cur = { id, opt: +opt, bound: +bound, count: +count, truncated: truncated === '1', nodes: +nodes, sols: [] };
        } else if (line.startsWith('S ')) {
          const parts = line.split(' ');
          cur.sols.push([+parts[2], parts.slice(3).join(' ')]);
        } else if (line.startsWith('END ')) {
          onCase(cur); cur = null;
        }
      }
    });
    child.on('error', reject);
    // a signal (killed, crashed) is a failure too: its cases were not all written
    child.on('close', (code, signal) => (code || signal ? reject(new Error(`llgen exited ${code === null ? signal : code}`)) : resolve()));
    child.stdin.write(header());
    for (const l of lines) child.stdin.write(l);
    child.stdin.end();
  });
}

function build() {
  fs.mkdirSync(WORK, { recursive: true });
  execFileSync('c++', ['-O3', '-march=native', '-std=c++17', '-o', BIN, path.join(__dirname, 'llgen', 'llgen.cpp')], { stdio: 'inherit' });
  console.log('built', BIN);
}

const PRE = ['', 'U', 'U2', "U'"];

async function runSet(setId, from = 0, to = Infinity) {
  const cases = AlgSets.enumerateCases(setId);
  const dir = path.join(WORK, 'raw', setId);
  fs.mkdirSync(dir, { recursive: true });
  const todo = [];
  for (let i = from; i < Math.min(to, cases.length); i++) {
    if (!fs.existsSync(path.join(dir, `${i}.json`))) todo.push(i);
  }
  // grouped by move set, so each move set's tables are loaded once; a move
  // set's result already on disk is kept (a run can be stopped and resumed)
  const plan = PLAN[setId];
  for (const [ms, slack] of plan.sets) {
    const lines = [];
    for (const i of todo) {
      if (fs.existsSync(path.join(dir, `${i}.${ms}.json`))) continue;
      lines.push(caseLines(setId, i, cases[i].rep, { maxLen: plan.maxLen, sets: [[ms, slack]] })[0]);
    }
    if (!lines.length) continue;
    const t0 = Date.now();
    await runLlgen(lines, (r) => {
      const i = +r.id.split(':')[1];
      const file = path.join(dir, `${i}.${ms}.json`);
      fs.writeFileSync(file, JSON.stringify({ ms, opt: r.opt, bound: r.bound, count: r.count, truncated: r.truncated, nodes: r.nodes, algs: r.sols.map(([a, alg]) => [PRE[a], alg]) }));
    });
    console.log(`${setId} ${ms}: ${lines.length} cases, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  // one file per case: every move set's solutions (a case missing a move
  // set waits for the next run)
  let incomplete = 0;
  for (const i of todo) {
    const files = plan.sets.map(([ms]) => path.join(dir, `${i}.${ms}.json`));
    if (!files.every(f => fs.existsSync(f))) { incomplete++; continue; }
    fs.writeFileSync(path.join(dir, `${i}.json`), JSON.stringify(files.map(f => JSON.parse(fs.readFileSync(f, 'utf8')))));
    for (const f of files) fs.unlinkSync(f);
  }
  if (incomplete) console.log(`${setId}: ${incomplete} cases still miss a move set: run again`);
}

async function oneCase(setId, index) {
  const cases = AlgSets.enumerateCases(setId);
  const lines = caseLines(setId, index, cases[index].rep);
  for (const l of lines) {
    const t0 = Date.now();
    await runLlgen([l], (r) => {
      console.log(`${r.id} opt ${r.opt} bound ${r.bound} count ${r.count}${r.truncated ? ' TRUNCATED' : ''} nodes ${r.nodes} ${((Date.now() - t0) / 1000).toFixed(1)} s  e.g. ${r.sols[0] ? r.sols[0].join(' ') : ''}`);
    });
  }
}

if (require.main === module) {
  const [cmd, a, b, c] = process.argv.slice(2);
  const fail = (e) => { console.error(e.stack || e); process.exit(1); };
  if (cmd === 'build') build();
  else if (cmd === 'run') runSet(a, b ? +b : 0, c ? +c : Infinity).catch(fail);
  else if (cmd === 'case') oneCase(a, +b).catch(fail);
  else console.log('usage: node tools/ll-gen.js build | run <set> [from] [to] | case <set> <index>');
}

module.exports = { MOVE_SETS, PLAN, TOKENS, humanCubie, frames, header, caseLines, runLlgen, WORK };
