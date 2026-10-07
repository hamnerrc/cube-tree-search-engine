#!/usr/bin/env node
/**
 * Fits alg_speed to the developer's pairwise speed comparisons
 * (data/speed_comparisons.jsonl, tools/pair-compare.js; PROJECT_STATUS.md
 * roadmap 7c, §4.46). One step-independent model: time(alg) =
 * algSpeed(alg; ALG_SPEED_DEFAULTS) + stepPenalty(alg) with STEP_PENALTIES,
 * the same at every step.
 *
 * Likelihood: ordered logit on the time difference. With d = (tB - tA) / s,
 * P(A faster) = sig(d - c), P(B faster) = sig(-d - c), P(too close) = the
 * rest; s and c are fitted too. Direct answers count 1, derived ones
 * (transitivity, recomputed from the training answers only) 1 / (1 + dist)
 * times --derived. A ridge prior pulls every parameter towards its current
 * value (relative to max(|value|, 0.5)) with strength --lambda; parameters
 * not listed in --params stay fixed.
 *
 * Validation: K-fold cross-validation over the direct answers (pairs),
 * repeated; reported per lambda: held-out strict-pair accuracy (ties
 * excluded) and mean held-out log-likelihood per answer (ties included),
 * next to the current model's on the same folds. Pick the lambda by
 * held-out log-likelihood; switch only if it beats the current model.
 *
 * Usage: node tools/fit-alg-speed.js [--lambda 30,10,3,1] [--params all|mcc|penalties|name,name]
 *          [--folds 10] [--repeats 3] [--derived 1] [--fit lambda] (fit on all data and print the values)
 */
'use strict';
const path = require('path');
const root = path.join(__dirname, '..');
const L = require('./pair-compare-lib.js');
const { algSpeed, ALG_SPEED_DEFAULTS, STEP_PENALTIES, stepPenalty } = require(path.join(root, 'js', 'script.js'));

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const logFile = opt('log', path.join(root, 'data', 'speed_comparisons.jsonl'));
const lambdas = opt('lambda', '100,30,10,3,1').split(',').map(Number);
const folds = parseInt(opt('folds', '10'), 10);
const repeats = parseInt(opt('repeats', '3'), 10);
const derivedWeight = Number(opt('derived', '1'));
const fitOnly = opt('fit', null);

const MCC_KEYS = Object.keys(ALG_SPEED_DEFAULTS);
const PEN_KEYS = Object.keys(STEP_PENALTIES);
const ALL = [...MCC_KEYS.map(k => `mcc.${k}`), ...PEN_KEYS.map(k => `pen.${k}`)];
const paramSpec = opt('params', 'all');
const free = paramSpec === 'all' ? ALL
  : paramSpec === 'mcc' ? ALL.filter(k => k.startsWith('mcc.'))
  : paramSpec === 'penalties' ? ALL.filter(k => k.startsWith('pen.'))
  : paramSpec.split(',').map(k => (ALL.includes(k) ? k : ALL.find(a => a.endsWith(`.${k}`)))).filter(Boolean);

const base = Object.fromEntries([...MCC_KEYS.map(k => [`mcc.${k}`, ALG_SPEED_DEFAULTS[k]]), ...PEN_KEYS.map(k => [`pen.${k}`, STEP_PENALTIES[k]])]);

/** Model time of every alg under parameters `p` (step penalties applied as for a later step: one function for every step). */
function times(algs, p) {
  const mcc = MCC_KEYS.map(k => p[`mcc.${k}`]);
  const saved = { ...STEP_PENALTIES };
  for (const k of PEN_KEYS) STEP_PENALTIES[k] = p[`pen.${k}`];
  const out = new Map();
  for (const a of algs) out.set(a, algSpeed(a, false, false, ...mcc) + stepPenalty(a));
  Object.assign(STEP_PENALTIES, saved);
  return out;
}

const sig = x => 1 / (1 + Math.exp(-x));
/** Log-likelihood of one observation ('a' = first faster, 'tie') given times. */
function logLik(ta, tb, answer, s, c) {
  const d = (tb - ta) / s;
  const pa = sig(d - c), pb = sig(-d - c);
  const p = answer === 'a' ? pa : answer === 'b' ? pb : Math.max(1e-12, 1 - pa - pb);
  return Math.log(Math.max(1e-12, p));
}

/** Observations [a, b, answer, weight] from answers: direct verdicts + derived. */
function observations(answers) {
  const g = L.comparisonGraph(answers);
  const obs = [];
  for (const c of g.derivedComparisons()) {
    if (!c.direct && !derivedWeight) continue;
    const w = c.direct ? 1 : derivedWeight / (1 + c.dist);
    obs.push([c.faster, c.slower, c.tie ? 'tie' : 'a', w]);
  }
  return obs;
}

function objective(p, obs, lambda) {
  const t = times(new Set(obs.flatMap(o => [o[0], o[1]])), p);
  let ll = 0;
  for (const [a, b, ans, w] of obs) ll += w * logLik(t.get(a), t.get(b), ans, p.s, p.c);
  let prior = 0;
  for (const k of free) { const sc = Math.max(Math.abs(base[k]), 0.5); prior += ((p[k] - base[k]) / sc) ** 2; }
  return ll - lambda * prior;
}

/** Pattern search from the current values; s and c always free (nuisance). */
function fit(obs, lambda, keys = free) {
  let p = { ...base, s: 1, c: 0.5 };
  let best = objective(p, obs, lambda);
  const all = [...keys, 's', 'c'];
  const step = Object.fromEntries(all.map(k => [k, k === 's' ? 0.5 : k === 'c' ? 0.25 : Math.max(Math.abs(base[k]), 0.5) * 0.25]));
  for (let iter = 0; iter < 60; iter++) {
    let improved = false;
    for (const k of all) {
      for (const dir of [1, -1]) {
        const q = { ...p, [k]: p[k] + dir * step[k] };
        if (k === 's' && q.s <= 0.05) continue;
        if (k === 'c' && q.c < 0) continue;
        if (k !== 's' && k !== 'c' && q[k] < 0) continue; // no negative costs
        const v = objective(q, obs, lambda);
        if (v > best + 1e-9) { p = q; best = v; improved = true; break; }
      }
    }
    if (!improved) {
      let any = false;
      for (const k of all) { step[k] /= 2; if (step[k] > 1e-3) any = true; }
      if (!any) break;
    }
  }
  return p;
}

/** Seeded shuffle. */
function shuffled(arr, seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function evaluate(p, testPairs) {
  const t = times(new Set(testPairs.flatMap(o => [o.a, o.b])), p);
  let correct = 0, strict = 0, ll = 0;
  for (const o of testPairs) {
    ll += logLik(t.get(o.a), t.get(o.b), o.answer, p.s, p.c);
    if (o.answer === 'tie') continue;
    strict++;
    if ((t.get(o.a) < t.get(o.b)) === (o.answer === 'a')) correct++;
  }
  return { correct, strict, ll, n: testPairs.length };
}

const answers = L.activeAnswers(L.readLog(logFile)).filter(r => r.answer !== 'skip' && !L.hasWideB(r.a) && !L.hasWideB(r.b));
// One verdict per pair (as the graph resolves it), as {a, b, answer}.
const graph = L.comparisonGraph(answers);
const pairs = [...graph.pairs.values()].map(p => ({ a: p.a, b: p.b, answer: p.verdict === 'tie' ? 'tie' : p.verdict === 'lo' ? 'a' : 'b' }));
const asAnswers = ps => ps.map((p, i) => ({ type: 'answer', id: `p${i}`, a: p.a, b: p.b, answer: p.answer }));
console.log(`${answers.length} answers -> ${pairs.length} pairs (${pairs.filter(p => p.answer !== 'tie').length} strict); free: ${free.join(' ')}`);

if (fitOnly !== null) {
  const p = fit(observations(asAnswers(pairs)), Number(fitOnly));
  const changed = free.filter(k => Math.abs(p[k] - base[k]) > 1e-6).map(k => `${k} ${base[k]} -> ${+p[k].toFixed(3)}`);
  console.log(`lambda ${fitOnly}: s ${p.s.toFixed(3)} c ${p.c.toFixed(3)}\n  ${changed.join('\n  ') || 'no change'}`);
  const e = evaluate(p, pairs), e0 = evaluate(fit(observations(asAnswers(pairs)), Infinity, []), pairs);
  console.log(`in-sample: fitted ${e.correct}/${e.strict} strict, ll/answer ${(e.ll / e.n).toFixed(3)}; current ${e0.correct}/${e0.strict}, ll/answer ${(e0.ll / e0.n).toFixed(3)}`);
  console.log(JSON.stringify(Object.fromEntries(free.map(k => [k, +p[k].toFixed(3)]))));
  process.exit(0);
}

const rows = [{ label: 'current', lambda: Infinity, keys: [] }, ...lambdas.map(l => ({ label: `lambda ${l}`, lambda: l, keys: free }))];
const tot = rows.map(() => ({ correct: 0, strict: 0, ll: 0, n: 0 }));
for (let r = 0; r < repeats; r++) {
  const order = shuffled(pairs, 100 + r);
  for (let f = 0; f < folds; f++) {
    const test = order.filter((_, i) => i % folds === f);
    const train = order.filter((_, i) => i % folds !== f);
    const obs = observations(asAnswers(train));
    rows.forEach((row, i) => {
      const p = fit(obs, row.lambda, row.keys);
      const e = evaluate(p, test);
      for (const k of Object.keys(e)) tot[i][k] += e[k];
    });
  }
}
rows.forEach((row, i) => {
  const t = tot[i];
  console.log(`${row.label.padEnd(12)} held-out strict accuracy ${(100 * t.correct / t.strict).toFixed(1)}% (${t.correct}/${t.strict}), log-lik/answer ${(t.ll / t.n).toFixed(3)}`);
});
