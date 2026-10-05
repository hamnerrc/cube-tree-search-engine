#!/usr/bin/env node
/**
 * Where do the professional reference algs rank under alg_speed?
 * (PROJECT_STATUS.md §4.32; slow the first time, it hits the real engine.)
 *
 * Phase 1 (pool, cached to --cache): for every DAG segment of every solve in
 * pro_references.txt, the engine's solutions of that segment's goal up to the
 * pro's own length (pro move set, shortest first, capped at --max like the
 * app's per-search cap), plus their rotation spellings and, at the root, the
 * free inspection variants -- i.e. roughly what the app would rank there.
 *
 * Phase 2 (rank): scores the pool and the pro's alg the way the app does
 * (algSpeed of the whole path so far incl. the step; pieces solved is the
 * same for every alg of one segment, so TPP order == algSpeed order) and
 * reports the pro's percentile: the share of the pool that scores strictly
 * better. 0% = the pro's alg would be ranked first.
 *
 * --sweep name=v1,v2,...  re-ranks with each value of one algSpeed parameter
 * (see ALG_SPEED_PARAMS) to find the simplest tuning; --train 1-7 limits the
 * mean used for choosing to those solves and reports the rest as held out.
 *
 * Usage: node tools/pro-ranking.js [--cache file] [--max 5000] [--sample 1500]
 *        [--sweep rotation=1,2,3.5] [--train 1-7] [--params pushMult=0.7]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { loadProReferences, segmentProSolve } = require('./pro-references.js');
const { CONFIGS, searchSegment } = require('./pro-search.js');
const { rotationSpellings, relabelAlgForRotation, commuteNormalize } = require(path.join(root, 'js', 'facelet-cube.js'));
const { algSpeed, ALG_SPEED_DEFAULTS } = require(path.join(root, 'js', 'script.js'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const cacheFile = opt('cache', path.join(require('os').tmpdir(), 'cubetree-pro-pools.json'));
const maxSolutions = parseInt(opt('max', '5000'), 10);
const sampleSize = parseInt(opt('sample', '1500'), 10);
const sweep = opt('sweep', null);
const train = opt('train', null);
// --params a=1,b=2: algSpeed overrides for the per-segment table.
const tableParams = Object.fromEntries((opt('params', '') || '').split(',').filter(Boolean).map(kv => { const [k, v] = kv.split('='); return [k, Number(v)]; }));

const ALG_SPEED_PARAMS = Object.keys(ALG_SPEED_DEFAULTS);

async function buildPools() {
  const CrossSolverHelperNode = require(path.join(root, 'crossSolver', 'solver-helper-node.js'));
  const h = new CrossSolverHelperNode(); await h.init();
  const pools = [];
  const solves = loadProReferences();
  for (let i = 0; i < solves.length; i++) {
    const solve = solves[i];
    let prior = '';
    for (const seg of segmentProSolve(solve)) {
      const t0 = Date.now();
      const { raw } = await searchSegment(h, solve, seg, prior, CONFIGS.extended, maxSolutions);
      const algs = new Set();
      for (const a of raw) {
        if (seg.isRoot && /^[xyz]/.test(a)) continue; // the app drops these (duplicates of inspection variants)
        const spellings = [a, ...rotationSpellings(a, !seg.isRoot)
          .filter(sp => sp.split(' ').filter(t => /^[xyz]/.test(t)).length <= 1)];
        for (const sp of spellings) {
          algs.add(sp);
          if (seg.isRoot) for (const t of ['y', 'y2', "y'"]) algs.add(relabelAlgForRotation(sp, t));
        }
      }
      pools.push({ solve: i + 1, labels: seg.labels.join('+'), isRoot: seg.isRoot, prior, pro: seg.alg, algs: [...algs] });
      console.error(`#${i + 1} ${seg.labels.join('+')}: ${raw.length} sols, pool ${algs.size} (${Date.now() - t0} ms)`);
      prior = [prior, seg.alg].filter(Boolean).join(' ');
    }
  }
  await h.terminate?.();
  return pools;
}

// Deterministic sample so every parameter value is compared on the same algs.
function sample(arr, n, seed) {
  if (arr.length <= n) return arr;
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const a = arr.slice();
  for (let i = 0; i < n; i++) { const j = i + Math.floor(rnd() * (a.length - i)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
}

function scoreWith(params) {
  const p = { ...ALG_SPEED_DEFAULTS, ...params };
  const vals = ALG_SPEED_PARAMS.map(k => p[k]);
  return alg => algSpeed(alg, false, false, ...vals);
}

/** Pro percentile per segment (share of the pool scoring strictly better). */
function rankAll(pools, params) {
  const score = scoreWith(params);
  return pools.map((pl, k) => {
    const proKey = commuteNormalize(pl.pro);
    const algs = sample(pl.algs.filter(a => commuteNormalize(a) !== proKey), sampleSize, 1000 + k);
    const full = a => (pl.prior ? `${pl.prior} ${a}` : a);
    const proScore = score(full(pl.pro));
    const better = algs.filter(a => score(full(a)) < proScore).length;
    const frac = algs.length ? better / algs.length : 0;
    // Estimated rank in the full pool (1 = first); the app shows the top 500.
    return { ...pl, pct: frac, rank: 1 + Math.round(frac * (pl.algs.length - 1)), poolSize: pl.algs.length };
  });
}

function inTrain(solveNo) {
  if (!train) return true;
  const [a, b] = train.split('-').map(Number);
  return solveNo >= a && solveNo <= (b || a);
}

const mean = xs => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
// Mean log10(rank): every segment counts, a pro alg at rank 5000 vs 500
// matters as much as 10 vs 1.
function summary(ranked) {
  const lr = r => Math.log10(r.rank);
  const tr = ranked.filter(r => inTrain(r.solve));
  const ho = ranked.filter(r => !inTrain(r.solve));
  return {
    train: mean(tr.map(lr)), heldOut: mean(ho.map(lr)), all: mean(ranked.map(lr)),
    pctAll: mean(ranked.map(r => r.pct)), top500: ranked.filter(r => r.rank <= 500).length,
  };
}
const pct = x => (Number.isNaN(x) ? '   -  ' : `${(100 * x).toFixed(1).padStart(5)}%`);
const lg = x => (Number.isNaN(x) ? '  -  ' : x.toFixed(3));
const fmt = s => `mean log10 rank all ${lg(s.all)}${train ? ` (train ${lg(s.train)}, held-out ${lg(s.heldOut)})` : ''}; mean percentile ${pct(s.pctAll)}; in top 500: ${s.top500}`;

(async () => {
  let pools;
  if (fs.existsSync(cacheFile)) pools = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  else { pools = await buildPools(); fs.writeFileSync(cacheFile, JSON.stringify(pools)); }

  for (const k of Object.keys(tableParams)) if (!ALG_SPEED_PARAMS.includes(k)) throw new Error(`unknown algSpeed parameter ${k}`);
  const base = rankAll(pools, tableParams);
  for (const r of base) console.log(`#${r.solve} ${r.labels.padEnd(26)} pool ${String(r.poolSize).padStart(6)}  pro percentile ${pct(r.pct)}  rank ~${String(r.rank).padStart(5)}  ${r.pro}`);
  console.log(`\n${Object.keys(tableParams).length ? JSON.stringify(tableParams) : 'defaults'}: ${fmt(summary(base))} of ${base.length}`);

  if (sweep) {
    for (const spec of sweep.split(';')) {
      const [name, list] = spec.split('=');
      if (!ALG_SPEED_PARAMS.includes(name)) throw new Error(`unknown algSpeed parameter ${name}; one of ${ALG_SPEED_PARAMS}`);
      for (const v of list.split(',').map(Number)) {
        console.log(`${name}=${String(v).padEnd(6)} ${fmt(summary(rankAll(pools, { ...tableParams, [name]: v })))}`);
      }
    }
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(2); });
