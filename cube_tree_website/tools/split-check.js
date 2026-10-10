#!/usr/bin/env node
/**
 * The engine call split by first move (solver-bridge.js splitByFirstMove)
 * against the one call it replaces: identical solution sets, timings. Runs
 * random-state solves (best result committed each step) and checks every
 * later step's multislot calls.
 *
 *   node tools/split-check.js [--scrambles 3] [--seed 7] [--workers 2]
 */
'use strict';
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const js = path.join(root, 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js', 'random-state-scramble.js', 'spelling-search.js']) Object.assign(global, require(path.join(js, f)));
const B = require(path.join(js, 'solver-bridge.js'));
const { createEnginePool } = require('./node-engine-pool.js');
const { createPostProcessPool } = require('./node-postprocess-pool.js');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
let seed = Number(opt('seed', '7'));
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

(async () => {
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const advanced = ['xcross', 'xxcross', 'multislotting'];
  const pruned = pruneGraph(tree, { advanced, colors: ['white'] });
  const pool = await createEnginePool('cross', Number(opt('workers', '2')));
  const post = await createPostProcessPool(2);
  let checked = 0;
  let bad = 0;
  for (let s = 0; s < Number(opt('scrambles', '3')); s++) {
    const scramble = generateRandomStateScramble(rnd);
    console.log(`scramble ${s + 1}: ${scramble}`);
    const session = new B.SolveSession(scramble, pruned, ['white'], advanced);
    session.postProcessor = post.process;
    for (let step = 0; step < 5 && !session.isComplete; step++) {
      // the step's multislot calls, once whole and once split
      const calls = [];
      const spy = new Proxy(pool, { get(t, p) { if (p === 'size') return undefined; const v = t[p]; if (typeof v === 'function' && /^solve/.test(p)) return async (...a) => { calls.push([p, a]); return v.apply(t, a); }; return typeof v === 'function' ? v.bind(t) : v; } });
      const list = (await B.searchCurrentNode(session, step ? spy : pool, null)).filter(c => !c.multislot);
      for (const [method, a] of calls) {
        const o = a[a.length - 1];
        const slots = a.slice(1, -1);
        if (slots.length < 2 || method === 'solveXcross' || o.maxLength < 2 || session.isAtRoot) continue;
        const allCorners = slots.map(k => ['BL', 'BR', 'FR', 'FL'][k]);
        const p = { allCorners, scramble: a[0], callRotation: o.rotation, maxLength: o.maxLength, postAlgForCall: o.postAlg, effectiveMaxSolutions: o.maxSolutions };
        const extra = { ...o };
        for (const k of ['rotation', 'maxLength', 'postAlg', 'maxSolutions', 'allowedMoves', 'noopMoves']) delete extra[k];
        let t0 = Date.now();
        const whole = await pool[method](a[0], ...slots, o);
        const tWhole = Date.now() - t0;
        t0 = Date.now();
        const split = await B.splitByFirstMove(pool, p, extra);
        const tSplit = Date.now() - t0;
        const A = new Set(whole.map(x => x.trim()));
        const S = new Set(split.map(x => x.trim()));
        const same = A.size === S.size && [...A].every(x => S.has(x));
        checked++;
        if (!same) bad++;
        console.log(`  step ${step} ${method} max ${o.maxLength}: ${A.size} vs ${S.size} ${same ? 'same' : 'DIFFERENT'}  whole ${tWhole} ms, split ${tSplit} ms`);
      }
      if (!list.length) break;
      session.commit(list[0]);
    }
  }
  console.log(`${checked} calls checked, ${bad} different`);
  await post.terminate(); await pool.terminate();
  process.exit(bad ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
