#!/usr/bin/env node
/**
 * Fits STEP_PENALTIES (js/script.js) to the professional reference solves and
 * reports leave-one-solve-out cross-validated ranks (PROJECT_STATUS.md §4.35).
 *
 * Input: the --app pool cache written by tools/pro-ranking.js --app (what the
 * app lists at each pro node). Score of a candidate step with p pieces:
 *     (algSpeed(path) + sum_k w_k * count_k(step)) / p
 * with the counts of the chosen move types in the step. The weights minimise
 * an L2-regularised pairwise logistic loss "pro step scores below candidate"
 * over each node's 400 best-scoring candidates plus 800 random ones, every
 * node weighted equally; weights are kept >= 0 (penalties only, so no move
 * ever becomes cheaper than MCC says -- negative weights let padding with
 * extra U turns lower the cost). Ranks are always exact (every candidate).
 *
 * Usage: node tools/fit-step-penalties.js --cache <app pools json>
 *        [--use D,F,B,wideRL,wideOther,rotMidY] [--l2 0.001] [--iters 400]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { algSpeed } = require(path.join(__dirname, '..', 'js', 'script.js'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const pools = JSON.parse(fs.readFileSync(opt('cache'), 'utf8'));
const T = 0.2, LAMBDA = +opt('l2', '0.001'), ITERS = +opt('iters', '400');

const NAMES = ['U', 'D', 'R', 'L', 'F', 'B', 'wideRL', 'wideOther', 'rotLead', 'rotMidY', 'rotX'];
function counts(alg) {
  const v = new Array(NAMES.length).fill(0);
  alg.split(' ').filter(Boolean).forEach((x, i) => {
    const c = x[0];
    if ('UDRLFB'.includes(c)) v['UDRLFB'.indexOf(c)]++;
    else if ('rl'.includes(c)) v[6]++;
    else if ('fbudMES'.includes(c)) v[7]++;
    if (/^[xyz]/.test(x)) { if (i === 0) v[8]++; else if (c === 'y') v[9]++; if (c === 'x') v[10]++; }
  });
  return v;
}
const use = opt('use', 'D,F,B,wideRL,wideOther,rotMidY').split(',').map(n => {
  const i = NAMES.indexOf(n); if (i < 0) throw new Error(`unknown feature ${n}; one of ${NAMES}`); return i;
});
const D = use.length;

// [base cost of the whole path, pieces, selected counts] for the pro step and every candidate.
const data = pools.map(pl => {
  const full = a => (pl.prior ? `${pl.prior} ${a}` : a);
  const row = ([a, p]) => [algSpeed(full(a)), p, use.map(i => counts(a)[i])];
  return { solve: pl.solve, labels: pl.labels, pro: row(pl.pro), cands: pl.algs.map(row) };
});

let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const segs = data.map(d => {
  const [bp, pp, fp] = d.pro;
  const sorted = d.cands.slice().sort((x, y) => x[0] / x[1] - y[0] / y[1]);
  const extra = Array.from({ length: 800 }, () => sorted[400 + Math.floor(rnd() * Math.max(1, sorted.length - 400))]).filter(Boolean);
  return { solve: d.solve, pairs: sorted.slice(0, 400).concat(extra).map(([b, p, f]) => ({ a: b / p - bp / pp, g: f.map((x, i) => x / p - fp[i] / pp) })) };
});

function fit(train) {
  const w = new Array(D).fill(0), m = new Array(D).fill(0), v = new Array(D).fill(0);
  for (let it = 1; it <= ITERS; it++) {
    const grad = w.map(x => 2 * LAMBDA * x);
    for (const s of train) {
      const k = 1 / (s.pairs.length * train.length);
      for (const { a, g } of s.pairs) {
        let margin = a;
        for (let i = 0; i < D; i++) margin += w[i] * g[i];
        const sig = 1 / (1 + Math.exp(margin / T));
        for (let i = 0; i < D; i++) grad[i] -= k * sig / T * g[i];
      }
    }
    for (let i = 0; i < D; i++) {
      m[i] = 0.9 * m[i] + 0.1 * grad[i];
      v[i] = 0.999 * v[i] + 0.001 * grad[i] ** 2;
      w[i] -= 0.05 * (m[i] / (1 - 0.9 ** it)) / (Math.sqrt(v[i] / (1 - 0.999 ** it)) + 1e-8);
      w[i] = Math.max(0, w[i]);
    }
  }
  return w;
}
const score = (w, [b, p, f]) => { let s = b; for (let i = 0; i < D; i++) s += w[i] * f[i]; return s / p; };
const rankOf = (w, d) => { const ps = score(w, d.pro); let r = 1; for (const c of d.cands) if (score(w, c) < ps) r++; return r; };

const solves = [...new Set(data.map(d => d.solve))];
const cv = new Array(data.length);
const foldWeights = [];
for (const s of solves) {
  const w = fit(segs.filter(x => x.solve !== s));
  foldWeights.push(w);
  data.forEach((d, i) => { if (d.solve === s) cv[i] = rankOf(w, d); });
}
const base = data.map(d => rankOf(new Array(D).fill(0), d));
const wAll = fit(segs);
const all = data.map(d => rankOf(wAll, d));
const line = (name, r) => console.log(`${name.padEnd(30)} top 10: ${r.filter(x => x <= 10).length}/${r.length}  top 3: ${r.filter(x => x <= 3).length}  mean log10 rank: ${(r.reduce((a, x) => a + Math.log10(x), 0) / r.length).toFixed(3)}`);
line('no penalties', base);
line('leave-one-solve-out (honest)', cv);
line('fit on all solves (in-sample)', all);
console.log('weights (all solves):', use.map((i, k) => `${NAMES[i]}=${wAll[k].toFixed(2)}`).join(' '));
console.log('per-fold range:', use.map((i, k) => `${NAMES[i]} ${Math.min(...foldWeights.map(w => w[k])).toFixed(2)}..${Math.max(...foldWeights.map(w => w[k])).toFixed(2)}`).join(', '));
data.forEach((d, i) => console.log(`  #${d.solve} ${d.labels.padEnd(22)} rank ${String(base[i]).padStart(6)} -> held-out ${cv[i]}`));
