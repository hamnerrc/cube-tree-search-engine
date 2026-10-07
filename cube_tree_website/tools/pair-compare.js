#!/usr/bin/env node
/**
 * Pairwise speed comparisons for training alg_speed (PROJECT_STATUS.md
 * roadmap item 7; README "Planned: training alg_speed on pairwise speed
 * comparisons"). Terminal only, no browser.
 *
 *   node tools/pair-compare.js              compare: one pair at a time, you pick the faster
 *   node tools/pair-compare.js stats        totals, consistency, contradictions, coverage
 *   node tools/pair-compare.js export [f]   every direct + derived comparison as JSON (for fitting)
 *   node tools/pair-compare.js pool         (re)build the candidate pool from the real engine (slow)
 *
 * Comparing: execute both algs on a real cube, then press
 *   a / b   that one is faster        =   too close to call
 *   s       skip (not executable / unclear)
 *   u       undo the last answer (asks it again)
 *   c       show / hide the step context
 *   q       quit (every answer is already saved)
 * The model's own scores are never shown, so they cannot bias the answer.
 *
 * Files: data/speed_pool.json (candidate algs: real result lists of random
 * scrambles at every stage plus the pro reference solves' lists) and
 * data/speed_comparisons.jsonl (append-only answers; undo appends a
 * retraction). Options: --pool file, --log file, --seed n (pool building),
 * --scrambles n, --top n, --sample n.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const L = require('./pair-compare-lib.js');

const root = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const command = args[0] && !args[0].startsWith('--') ? args[0] : 'compare';
const poolFile = opt('pool', path.join(root, 'data', 'speed_pool.json'));
const logFile = opt('log', path.join(root, 'data', 'speed_comparisons.jsonl'));

// ---------------------------------------------------------------- pool building

/**
 * Walks random scrambles through the real bridge like the app does
 * (searchCurrentNode, the app's ranking) and keeps each step's result list:
 * the top --top results plus --sample drawn from further down (so D/F/B,
 * wide and long algs that rarely reach the top are covered too). The step
 * committed to continue is drawn from the top 5, so later lists cover
 * different situations. Then the pro reference solves, replayed with the
 * pro's own steps committed; the pro step is added to its list.
 */
async function buildPool() {
  const js = path.join(root, 'js');
  for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js']) Object.assign(global, require(path.join(js, f)));
  const B = require(path.join(js, 'solver-bridge.js'));
  const { generateRandomStateScramble } = require(path.join(js, 'random-state-scramble.js'));
  const { createEnginePool } = require(path.join(root, 'tools', 'node-engine-pool.js'));
  const { loadProReferences, segmentProSolve } = require('./pro-references.js');

  const nScrambles = parseInt(opt('scrambles', '60'), 10);
  const top = parseInt(opt('top', '40'), 10);
  const nSample = parseInt(opt('sample', '15'), 10);
  let seed = parseInt(opt('seed', '7'), 10) >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const cross = await createEnginePool('cross', 3);
  const pseudo = await createEnginePool('pseudo', 1);
  // Two configurations: the full pro set (xcross, xxcross, wide/slice
  // spellings, multislot) and, every third scramble, pseudo F2L too.
  const base = ['xcross', 'xxcross', 'cross_opt', 'pro_moves'];
  const configs = [
    { advanced: base, pseudo: false },
    { advanced: [...base, 'full_pseudo'], pseudo: true },
  ];
  const pruned = configs.map(c => pruneGraph(tree, { advanced: [...c.advanced, 'multislotting'], colors: ['white'] }));

  const lists = [];
  const keep = (results) => {
    const items = results.slice(0, top).map((r, i) => ({ alg: r.coreAlg, rank: i + 1, type: r.type, tpp: +r.tpp.toFixed(3) }));
    const rest = results.slice(top);
    for (let k = 0; k < nSample && rest.length; k++) {
      const j = Math.floor(rnd() * rest.length);
      const r = rest.splice(j, 1)[0];
      items.push({ alg: r.coreAlg, rank: results.indexOf(r) + 1, type: r.type, tpp: +r.tpp.toFixed(3) });
    }
    return items.sort((x, y) => x.rank - y.rank);
  };

  for (let i = 0; i < nScrambles; i++) {
    const ci = i % 3 === 2 ? 1 : 0;
    const scramble = generateRandomStateScramble(rnd);
    const session = new B.SolveSession(scramble, pruned[ci], ['white'], configs[ci].advanced);
    const t0 = Date.now();
    for (let step = 0; step < 8 && !session.isComplete; step++) {
      const results = await B.searchCurrentNode(session, cross, null, configs[ci].pseudo ? pseudo : null);
      if (!results.length) break;
      lists.push({
        id: `r${i + 1}.${step + 1}`, source: 'random', scramble, step: step + 1, first: step === 0,
        priorSteps: session.stepAlgs.slice(), size: results.length, pseudo: configs[ci].pseudo, items: keep(results),
      });
      session.commit(results[Math.floor(rnd() * Math.min(5, results.length))]);
    }
    console.error(`scramble ${i + 1}/${nScrambles}: ${session.stepAlgs.length} steps (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  }

  const solves = loadProReferences();
  for (let i = 0; i < solves.length; i++) {
    const solve = solves[i];
    const segs = segmentProSolve(solve);
    const color = segs[segs.length - 1].after.crossColor;
    const advanced = ['xcross', 'xxcross', 'multislotting', 'pro_moves'];
    const session = new B.SolveSession(solve.scramble, pruneGraph(tree, { advanced, colors: [color] }), [color], advanced);
    for (let k = 0; k < segs.length; k++) {
      const seg = segs[k];
      const results = await B.searchCurrentNode(session, cross, null, null);
      const target = B.nodeByLabels(session, seg.after.pairs, seg.after.pairs);
      if (!target) break;
      const items = keep(results);
      const proAlg = L.normalizeAlg(seg.alg);
      const at = results.findIndex(r => L.normalizeAlg(r.coreAlg) === proAlg);
      const listed = items.find(it => L.normalizeAlg(it.alg) === proAlg);
      if (listed) listed.pro = true;
      else items.push({ alg: seg.alg, rank: at === -1 ? results.length + 1 : at + 1, type: 'pro', pro: true });
      items.sort((x, y) => x.rank - y.rank);
      lists.push({
        id: `p${i + 1}.${k + 1}`, source: 'pro', scramble: solve.scramble, step: k + 1, first: seg.isRoot,
        labels: seg.labels.join('+'), priorSteps: session.stepAlgs.slice(), size: results.length, pseudo: false, items,
      });
      session.commit({ rotation: solve.inspection, coreAlg: seg.alg, targetNodeId: target, color });
    }
    console.error(`pro solve ${i + 1}/${solves.length}`);
  }

  const pool = { version: 1, built: new Date().toISOString(), model: L.modelVersion(), settings: { scrambles: nScrambles, top, sample: nSample, seed: parseInt(opt('seed', '7'), 10) }, lists };
  fs.writeFileSync(poolFile, JSON.stringify(pool));
  const idx = L.indexPool(pool);
  console.log(`${lists.length} result lists, ${idx.algs.length} distinct algs -> ${path.relative(process.cwd(), poolFile)}`);
  await cross.terminate?.();
  await pseudo.terminate?.();
}

// ---------------------------------------------------------------- shared

function loadPool() {
  if (!fs.existsSync(poolFile)) {
    console.error(`No candidate pool at ${poolFile}. Build it first: node tools/pair-compare.js pool`);
    process.exit(1);
  }
  return L.indexPool(JSON.parse(fs.readFileSync(poolFile, 'utf8')));
}

const pct = (x, n) => (n ? `${(100 * x / n).toFixed(1)}%` : '-');

function printStats(pidx) {
  const answers = L.activeAnswers(L.readLog(logFile));
  const s = L.answerStats(answers, pidx);
  const c = s.graph.counts;
  const byReason = {};
  for (const r of answers) byReason[r.reason || 'select'] = (byReason[r.reason || 'select'] || 0) + 1;
  console.log(`answers: ${answers.length} (${Object.entries(byReason).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'})`);
  console.log(`pairs answered: ${c.direct} (${c.directStrict} faster/slower, ${c.directTie} too close), skipped: ${c.skips}`);
  console.log(`comparison data points: ${c.direct + c.derived} (${c.direct} direct + ${c.derived} derived by transitivity)`);
  console.log(`algs answered: ${s.graph.algs.length} in ${s.graph.classes.length} tie classes`);
  console.log(`open contradictions: ${c.contradictions}`);
  for (const k of s.graph.contradictions) console.log(`  ${k.algs.join('  |  ')}`);
  console.log(`self-consistency on repeats: ${s.consistent}/${s.repeats} (${pct(s.consistent, s.repeats)})`);
  console.log(`current alg_speed orders the answered pairs right: ${s.agree}/${s.strict} (${pct(s.agree, s.strict)})`);
  console.log(`algs answered per feature: ${L.FEATURES.map(f => `${f} ${s.featCount[f]}`).join(', ')}`);
  console.log(`pool: ${pidx.lists.length} lists, ${pidx.algs.length} algs; model scale ${L.fitScale(s.graph, pidx).toFixed(3)}`);
}

// ---------------------------------------------------------------- interactive session

const ESC = '\x1b[';
const bold = s => `${ESC}1m${s}${ESC}0m`;
const dim = s => `${ESC}2m${s}${ESC}0m`;
const spaced = alg => alg.split(' ').join('  ');

async function compare(pidx) {
  if (!process.stdin.isTTY) { console.error('pair-compare needs an interactive terminal'); process.exit(1); }
  let log = L.readLog(logFile);
  const sessionIds = []; // this session's answers, for undo
  const recent = [];
  let showContext = false;
  let answeredNow = 0;
  let pending = null; // a pair to ask again after an undo
  const nextId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  const key = () => new Promise(resolve => process.stdin.once('keypress', (str, k) => resolve(k && k.ctrl && k.name === 'c' ? 'q' : str || (k && k.name))));

  for (;;) {
    const answers = L.activeAnswers(log);
    const graph = L.comparisonGraph(answers);
    let pair = pending;
    pending = null;
    if (!pair) {
      const recentAlgs = new Set(recent.slice(-3).flatMap(k => k.split('\n')));
      pair = L.selectPair(pidx, answers, Math.random, { graph, recent: new Set(recent), recentAlgs, scale: L.fitScale(graph, pidx) });
    }
    if (!pair) { console.log('\nNo eligible pair left in the pool. Rebuild a larger pool: node tools/pair-compare.js pool --scrambles 120'); break; }
    const ea = pidx.byAlg.get(pair.a), eb = pidx.byAlg.get(pair.b);
    const c = graph.counts;
    const ctxLine = e => (e ? `${e.isFirst ? 'first step' : 'later step'}, ${e.types.join(' / ')}${e.pro ? ', pro' : ''}, best rank ${e.bestRank}` : '');
    const draw = () => {
      process.stdout.write(`${ESC}2J${ESC}H`);
      console.log(dim(`cube⑂tree pair-compare   this session ${answeredNow} · pairs ${c.direct} direct + ${c.derived} derived · contradictions ${c.contradictions}`));
      console.log(`\n  Which is faster to execute?${pair.reason === 'contradiction' ? dim('   (asked again: contradiction)') : ''}\n`);
      console.log(`  ${bold('A')}    ${bold(spaced(pair.a))}${showContext ? '\n       ' + dim(ctxLine(ea)) : ''}\n`);
      console.log(`  ${bold('B')}    ${bold(spaced(pair.b))}${showContext ? '\n       ' + dim(ctxLine(eb)) : ''}\n`);
      console.log(dim('  [a] A faster   [b] B faster   [=] too close   [s] skip   [u] undo   [c] context   [q] quit'));
    };
    draw();
    const shown = Date.now();
    let answer = null;
    while (!answer) {
      const k = await key();
      if (k === 'a' || k === 'b') answer = k;
      else if (k === '=' || k === 'e') answer = 'tie';
      else if (k === 's') answer = 'skip';
      else if (k === 'c') { showContext = !showContext; draw(); }
      else if (k === 'u') {
        const id = sessionIds.pop();
        if (!id) continue;
        const undone = log.find(r => r.id === id);
        L.appendLog(logFile, { type: 'retract', id, t: new Date().toISOString() });
        log = L.readLog(logFile);
        answeredNow--;
        pending = { a: undone.a, b: undone.b, reason: undone.reason };
        answer = 'undo';
      } else if (k === 'q') answer = 'quit';
    }
    if (answer === 'quit') break;
    if (answer === 'undo') continue;
    const rec = L.answerRecord({
      id: nextId(), a: pair.a, b: pair.b, answer, reason: pair.reason, ms: Date.now() - shown,
      ctxA: ea ? L.contextOf(ea) : null, ctxB: eb ? L.contextOf(eb) : null,
      speedA: ea ? +ea.time.toFixed(3) : null, speedB: eb ? +eb.time.toFixed(3) : null,
    });
    L.appendLog(logFile, rec);
    log.push(rec);
    sessionIds.push(rec.id);
    answeredNow++;
    recent.push(L.pairKey(pair.a, pair.b));
    if (recent.length > 10) recent.shift();
  }
  process.stdin.setRawMode(false);
  console.log(`\n${answeredNow} answers this session, saved to ${path.relative(process.cwd(), logFile)}.\n`);
  printStats(pidx);
  process.exit(0);
}

// ---------------------------------------------------------------- main

(async () => {
  if (command === 'pool') { await buildPool(); process.exit(0); }
  const pidx = loadPool();
  if (command === 'stats') { printStats(pidx); return; }
  if (command === 'export') {
    const graph = L.comparisonGraph(L.activeAnswers(L.readLog(logFile)));
    const out = { model: L.modelVersion(), counts: graph.counts, comparisons: graph.derivedComparisons() };
    const file = args[1] && !args[1].startsWith('--') ? args[1] : null;
    if (file) { fs.writeFileSync(file, JSON.stringify(out, null, 1)); console.log(`${out.comparisons.length} comparisons -> ${file}`); } else console.log(JSON.stringify(out, null, 1));
    return;
  }
  if (command === 'compare') { await compare(pidx); return; }
  console.error(`unknown command ${command}; one of compare, stats, export, pool`);
  process.exit(1);
})().catch(e => { console.error(e); process.exit(2); });
