#!/usr/bin/env node
/**
 * End-to-end verification harness (NOT part of the fast unit-test suite --
 * slow, hits the real WASM solvers): drives full SolveSession loops over
 * random scrambles and independently checks, with the facelet simulator,
 * that every committed step really solves what it claims and that a
 * completed session really is a solved Cross+F2L.
 *
 * Usage: node test/solver-bridge-e2e.js [--pseudo] [--advanced xcross,xxcross,...]
 *          [--scrambles N] [--seed S] [--pick top|random] [--colors white,green]
 *
 * Exits non-zero if any "claimed solved but not actually solved" warning
 * fires (a real solver/DAG/bridge bug, never mere luck), or if a completed
 * session isn't physically a solved cross + 4 pairs.
 */
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
Object.assign(global, require(path.join(root, 'script.js')));
Object.assign(global, require(path.join(root, 'facelet-cube.js')));
Object.assign(global, require(path.join(root, 'facelet-flags.js')));
Object.assign(global, require(path.join(root, 'cross-optimization.js')));
const { SolveSession, searchCurrentNode, replayFacelets } = require(path.join(root, 'solver-bridge.js'));
const CrossSolverHelperNode = require(path.join(root, 'crossSolver', 'solver-helper-node.js'));
const PseudoSolverHelperNode = require(path.join(root, 'pseudoCrossSolver', 'solver-helper-node.js'));

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i === -1 ? dflt : args[i + 1]; };
const withPseudo = args.includes('--pseudo');
const advanced = (opt('advanced', '') || '').split(',').filter(Boolean);
if (withPseudo) advanced.push('full_pseudo');
const nScrambles = parseInt(opt('scrambles', '3'), 10);
let seed = parseInt(opt('seed', '1'), 10);
const pick = opt('pick', 'top');
const colors = (opt('colors', 'white') || 'white').split(',');
const maxSteps = parseInt(opt('maxsteps', '8'), 10);

const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const FACES = 'UDLRFB'.split(''), MODS = ['', "'", '2'];
function randomScramble(n) {
  const out = []; let last = '';
  while (out.length < n) {
    const f = FACES[Math.floor(rnd() * 6)];
    if (f === last) continue;
    last = f; out.push(f + MODS[Math.floor(rnd() * 3)]);
  }
  return out.join(' ');
}

(async () => {
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'f2l_nodes_and_edges.json'), 'utf8'));
  const pruned = pruneGraph(tree, { advanced: ['xcross', 'multislotting', ...advanced], colors });
  const cross = new CrossSolverHelperNode(); await cross.init();
  let pseudo = null;
  if (withPseudo) { pseudo = new PseudoSolverHelperNode(); await pseudo.init(); }

  let badWarnings = 0, badFinal = 0, completed = 0, pseudoSteps = 0, totalSteps = 0;
  const origWarn = console.warn;
  console.warn = (...a) => { badWarnings++; origWarn(...a); };

  for (let i = 0; i < nScrambles; i++) {
    const scramble = randomScramble(20);
    const session = new SolveSession(scramble, pruned, colors, advanced);
    const trace = [];
    for (let step = 0; step < maxSteps && !session.isComplete; step++) {
      const t0 = Date.now();
      const results = await searchCurrentNode(session, cross, null, pseudo);
      if (!results.length) { trace.push('NO RESULTS'); break; }
      const c = pick === 'random' ? results[Math.floor(rnd() * results.length)] : results[0];
      const nPseudo = results.filter(r => /pseudo/.test(r.type)).length;
      trace.push(`${c.type}[${(results.length)} cands, ${nPseudo} pseudo, ${Date.now() - t0}ms] ${c.coreAlg}`);
      if (/pseudo/.test(c.type)) pseudoSteps++;
      totalSteps++;
      session.commit(c);
    }
    let final = 'incomplete';
    if (session.isComplete) {
      completed++;
      const f = replayFacelets(scramble, session.rotation, '', session.scoredPath);
      const sf = solvedFlags(f);
      const ok = sf.cross && sf.BL && sf.BR && sf.FL && sf.FR;
      final = ok ? 'VERIFIED SOLVED' : 'NOT ACTUALLY SOLVED';
      if (!ok) badFinal++;
    }
    console.log(`\n#${i + 1} ${scramble}\n  rotation=${session.rotation || '-'} -> ${final}`);
    trace.forEach(t => console.log('   ' + t));
  }
  console.log(`\nsummary: ${completed}/${nScrambles} completed, ${totalSteps} steps (${pseudoSteps} pseudo), ${badWarnings} warnings, ${badFinal} bad finals`);
  process.exit(badWarnings || badFinal ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
