#!/usr/bin/env node
/**
 * Worst-case search timing (README "Performance goal": one step's search with
 * all settings enabled must finish in under 1 minute).
 *
 * "All settings": every cross colour; xcross, xxcross, xxxcross,
 * multislotting, full pseudo (simplified pseudo OFF -- it only removes work),
 * cross optimisation, the pro move set; 500 solutions per call (the app
 * default); look-ahead depth 5, breadth 5 (--depth/--breadth to change).
 * Engines run on a worker pool like the browser's (--workers, default
 * cores - 1, at most 4; the pseudo engine gets a pool of the same size, as in the app).
 *
 * For each scramble it times the root search and then, committing the best
 * result each time, every later step until Cross + F2L is complete. Each
 * timed search starts from a fresh session (no memo), so look-ahead pays for
 * all of its searches; engine prune tables stay warm after the first call,
 * as in a page that is already open (the cold first search is reported
 * separately).
 *
 * Usage: node tools/worst-case-bench.js [--scrambles 2] [--seed 1] [--depth 5] [--breadth 5]
 *        [--workers 3] [--max 500] [--no-pseudo] [--colors white,yellow] [--steps 1] [--budget 60]
 *        [--advanced xcross,xxcross] [--post 3]
 *
 * --post: post-process each engine call's solutions on a pool of this many
 * worker threads (the page's post-processing workers, §4.40; default none).
 * --advanced: run a smaller config instead of "all settings" (cross_opt and
 * pro_moves are always added, as in the app; '' = the app's default config).
 *
 * --budget: the per-search time budget in seconds (SolveSession.timeBudgetMs,
 * the app's "search time limit"; default 60, 0 = none).
 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const root = path.join(__dirname, '..');
const js = path.join(root, 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js', 'random-state-scramble.js']) Object.assign(global, require(path.join(js, f)));
const { SolveSession, searchWithLookahead } = require(path.join(js, 'solver-bridge.js'));
const { createEnginePool } = require('./node-engine-pool.js');
const { createPostProcessPool } = require('./node-postprocess-pool.js');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const nScrambles = +opt('scrambles', '2');
const seed = +opt('seed', '1');
const depth = +opt('depth', '5');
const breadth = +opt('breadth', '5');
const workers = +opt('workers', String(Math.max(1, Math.min(4, os.cpus().length - 1))));
const maxSolutions = +opt('max', '500');
const maxSteps = +opt('steps', '99');
const colors = opt('colors', 'white,yellow,green,blue,red,orange').split(',');
const pseudo = !args.includes('--no-pseudo');
const budget = +opt('budget', '60');
const advanced = args.includes('--advanced')
  ? ['cross_opt', 'pro_moves', ...opt('advanced', '').split(',').filter(Boolean)]
  : ['xcross', 'xxcross', 'xxxcross', 'multislotting', 'cross_opt', 'pro_moves', ...(pseudo ? ['full_pseudo'] : [])];

const FIXED = ["R2 U2 L D' R' F' B' R F' R F2 D2 R F2 D2 B2 D2 L F2 D2"];
function scrambles() {
  const out = FIXED.slice(0, nScrambles);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  while (out.length < nScrambles) out.push(generateRandomStateScramble(rnd));
  return out;
}

(async () => {
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const pruned = pruneGraph(tree, { advanced, colors });
  const t0 = Date.now();
  const h = await createEnginePool('cross', workers);
  const ph = pseudo ? await createEnginePool('pseudo', workers) : null;
  const post = +opt('post', '0') > 0 ? await createPostProcessPool(+opt('post', '0')) : null;
  console.log(`config: ${colors.length} colours, [${advanced.join(', ')}], ${maxSolutions}/call, look-ahead depth ${depth} breadth ${breadth}, ${workers} engine workers, budget ${budget || 'none'} s`);
  const all = [];
  let first = true;
  for (const scramble of scrambles()) {
    console.log(`\nscramble ${scramble}`);
    const committed = [];
    for (let step = 1; step <= maxSteps; step++) {
      const s = new SolveSession(scramble, pruned, colors, advanced);
      s.maxSolutions = maxSolutions;
      s.timeBudgetMs = budget * 1000;
      if (post) s.postProcessor = post.process;
      for (const c of committed) s.commit(c);
      if (s.isComplete) break;
      const t = Date.now();
      const res = await searchWithLookahead(s, h, null, ph, { depth, breadth });
      const ms = Date.now() - t;
      if (args.includes('--profile')) {
        const calls = [...h.stats.splice(0), ...(ph ? ph.stats.splice(0).map(c => ({ ...c, method: 'pseudo' })) : [])];
        calls.sort((a, b) => b.ms - a.ms);
        const sum = calls.reduce((a, c) => a + c.ms, 0);
        console.log(`    ${calls.length} engine calls, ${(sum / 1000).toFixed(1)} s engine time; slowest:`);
        for (const c of calls.slice(0, 8)) console.log(`      ${(c.ms / 1000).toFixed(1).padStart(6)} s ${c.method}(${c.args.slice(1).join(',')}) len ${c.opts.maxLength} rot '${c.opts.rotation}' -> ${c.n}`);
      }
      console.log(`  step ${step}${first ? ' (cold)' : ''}: ${(ms / 1000).toFixed(1)} s, ${res.length} results, best ${res[0] ? `${res[0].type} ${res[0].coreAlg}` : '-'}${res.truncatedCalls ? `; ${res.truncatedCalls} call(s) cut by the budget` : ''}${res.lookaheadTruncated ? '; look-ahead cut' : ''}`);
      if (!first) all.push(ms);
      first = false;
      if (!res.length) break;
      committed.push(res[0]);
    }
  }
  all.sort((a, b) => a - b);
  console.log(`\nwarm searches: ${all.length}, worst ${(all[all.length - 1] / 1000).toFixed(1)} s, median ${(all[all.length >> 1] / 1000).toFixed(1)} s; total ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await h.terminate(); if (ph) await ph.terminate(); if (post) await post.terminate();
})().catch(e => { console.error(e); process.exit(2); });
