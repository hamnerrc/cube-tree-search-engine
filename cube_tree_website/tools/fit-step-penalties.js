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
 * --loss sigmoid (PROJECT_STATUS.md §4.36) bounds each pair's loss, so a
 * pro step that is simply a slow choice (human variance: pros sometimes
 * execute a suboptimal step, which should rank lower) cannot pull the
 * weights arbitrarily far; the default logistic loss grows without bound
 * for such a step. --weights D=1,B=2 evaluates fixed weights instead of
 * fitting (e.g. the production STEP_PENALTIES).
 *
 * Usage: node tools/fit-step-penalties.js --cache <app pools json>
 *        [--use D,F,B,wideRL,wideOther,rotMidY] [--l2 0.001] [--iters 400]
 *        [--loss logistic|sigmoid] [--weights name=v,...] [--seed 7]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { algSpeed } = require(path.join(__dirname, '..', 'js', 'script.js'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const pools = JSON.parse(fs.readFileSync(opt('cache'), 'utf8'));
const T = +opt('temp', '0.2'), LAMBDA = +opt('l2', '0.001'), ITERS = +opt('iters', '400');
const LOSS = opt('loss', 'logistic');
if (!['logistic', 'sigmoid'].includes(LOSS)) throw new Error(`unknown --loss ${LOSS}`);

const NAMES = ['U', 'D', 'R', 'L', 'F', 'B', 'wideRL', 'wideOther', 'rotLead', 'rotMidY', 'rotX', 'step'];
function counts(alg) {
  const v = new Array(NAMES.length).fill(0);
  v[11] = 1; // 'step': a constant cost per step (recognition / look-ahead pause)
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
  // Penalties apply per step over the whole path, as in SolveSession.pathCost:
  // the committed steps' features count too (they matter when candidates
  // solve different numbers of pieces, e.g. a single pair vs a multislot).
  const priorCounts = (pl.priorSteps || []).reduce((acc, x) => acc.map((v, i) => v + counts(x)[i]), new Array(NAMES.length).fill(0));
  const row = ([a, p]) => { const c = counts(a); return [algSpeed(full(a)), p, use.map(i => c[i] + priorCounts[i])]; };
  return { solve: pl.solve, labels: pl.labels, pro: row(pl.pro), cands: pl.algs.map(row) };
});

let seed = +opt('seed', '7');
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
        // d/dmargin of log(1 + e^(-m/T)) is -sig/T; of sigmoid(-m/T), -sig(1-sig)/T.
        const dl = LOSS === 'sigmoid' ? sig * (1 - sig) / T : sig / T;
        for (let i = 0; i < D; i++) grad[i] -= k * dl * g[i];
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
const fixed = opt('weights', null);
if (fixed) {
  const kv = Object.fromEntries(fixed.split(',').map(x => { const [k, v] = x.split('='); return [k, +v]; }));
  const w = use.map(i => kv[NAMES[i]] || 0);
  const r = data.map(d => rankOf(w, d));
  const grp = (name, f) => { const idx = data.map((d, i) => i).filter(i => f(data[i])); console.log(`${name.padEnd(12)} top 10: ${idx.filter(i => r[i] <= 10).length}/${idx.length}  mean log10 rank: ${(idx.reduce((a, i) => a + Math.log10(r[i]), 0) / idx.length).toFixed(3)}`); };
  grp('all', () => true);
  grp('root', d => /cross/.test(d.labels));
  grp('later', d => !/cross/.test(d.labels));
  data.forEach((d, i) => console.log(`  #${d.solve} ${d.labels.padEnd(22)} rank ${r[i]}`));
  process.exit(0);
}
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
const isRoot = d => /cross/.test(d.labels);
const sub = (name, r, f) => { const idx = data.map((d, i) => i).filter(i => f(data[i])); console.log(`  ${name.padEnd(28)} top 10: ${idx.filter(i => r[i] <= 10).length}/${idx.length}`); };
sub('CV, root steps', cv, isRoot); sub('CV, later steps', cv, d => !isRoot(d));
console.log('weights (all solves):', use.map((i, k) => `${NAMES[i]}=${wAll[k].toFixed(2)}`).join(' '));
console.log('per-fold range:', use.map((i, k) => `${NAMES[i]} ${Math.min(...foldWeights.map(w => w[k])).toFixed(2)}..${Math.max(...foldWeights.map(w => w[k])).toFixed(2)}`).join(', '));
data.forEach((d, i) => console.log(`  #${d.solve} ${d.labels.padEnd(22)} rank ${String(base[i]).padStart(6)} -> held-out ${cv[i]}`));
