#!/usr/bin/env node
/**
 * End-to-end verification harness (NOT part of the fast unit-test suite --
 * slow, hits the real WASM solvers): drives full SolveSession loops over
 * random scrambles and independently checks, with the facelet simulator,
 * that every committed step really solves what it claims and that a
 * completed session really is a solved Cross+F2L.
 *
 * Usage: node test/solver-bridge-e2e.js [--pseudo [--simplified]] [--advanced xcross,...]
 *          [--scrambles N] [--seed S] [--pick top|random|full|wide|rot|insp] [--pro] [--colors white,green]
 *
 * --pick full steers toward full-pseudo-only transitions (README "Pseudo
 * pairs", simplified pseudo off): a pseudo result when no mismatch exists
 * yet, then a non-repair transition out of each mismatched node.
 * --pick wide prefers results containing wide/slice moves (cross_opt).
 *
 * Exits non-zero if any "claimed solved but not actually solved" warning
 * fires (a real solver/DAG/bridge bug, never mere luck), if a completed
 * session isn't physically a solved cross + 4 pairs, or if a frame check
 * fails: after every commit the session's DAG node must claim exactly the
 * corners/edges that are physically home, and EVERY candidate offered (not
 * just the committed one) must keep the current node's claimed pieces home
 * (PROJECT_STATUS.md §4.16 -- a wrong-frame node let 26 of 501 candidates
 * on one scramble break a committed pair while passing the luck check).
 */
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');
Object.assign(global, require(path.join(jsRoot, 'script.js')));
Object.assign(global, require(path.join(jsRoot, 'facelet-cube.js')));
Object.assign(global, require(path.join(jsRoot, 'facelet-flags.js')));
Object.assign(global, require(path.join(jsRoot, 'cross-optimization.js')));
const { SolveSession, searchCurrentNode, replayFacelets, COLOR_ROTATIONS } = require(path.join(jsRoot, 'solver-bridge.js'));
const CrossSolverHelperNode = require(path.join(root, 'crossSolver', 'solver-helper-node.js'));
const PseudoSolverHelperNode = require(path.join(root, 'pseudoCrossSolver', 'solver-helper-node.js'));

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i === -1 ? dflt : args[i + 1]; };
const withPseudo = args.includes('--pseudo');
const advanced = (opt('advanced', '') || '').split(',').filter(Boolean);
if (withPseudo) advanced.push('full_pseudo');
if (args.includes('--simplified')) advanced.push('simplified_pseudo');
if (args.includes('--pro')) advanced.push('pro_moves');
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
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const pruned = pruneGraph(tree, { advanced: ['xcross', 'multislotting', ...advanced], colors });
  const cross = new CrossSolverHelperNode(); await cross.init();
  let pseudo = null;
  if (withPseudo) { pseudo = new PseudoSolverHelperNode(); await pseudo.init(); }

  const fullOnly = new Set(pruned.edges.filter(e => e.full_pseudo_only).map(e => `${e.source}>${e.target}`));
  const isMismatched = st => (st.corners || []).slice().sort().join() !== (st.edges || []).slice().sort().join();
  const pieces = (sc, rot, pathSoFar, alg) => pseudoSolvedFlags(replayFacelets(sc, rot, pathSoFar, alg));
  const homeSet = map => Object.keys(map).filter(k => map[k]).sort().join(',');
  let frameFailures = 0;
  let badWarnings = 0, badFinal = 0, completed = 0, pseudoSteps = 0, totalSteps = 0, fullOnlySteps = 0;
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
      const cur = session.currentNode.state;
      for (const r of results) {
        // In the step's starting frame: undo the candidate's own net rotation.
        const net = netRotation(r.coreAlg);
        const after = pieces(scramble, r.rotation, session.scoredPath, net ? `${r.coreAlg} ${inverseRotation(net)}` : r.coreAlg);
        const lost = (cur.corners || []).filter(sl => !after.cornerAt[sl]).concat((cur.edges || []).filter(sl => !after.edgeAt[sl]));
        if (lost.length) {
          frameFailures++;
          if (frameFailures <= 5) console.log(`  FRAME: candidate ${r.type} ${r.coreAlg} un-solves claimed ${lost} of current node`);
        }
      }
      let pool = results;
      if (pick === 'insp') {
        // Prefer root results whose inspection leaves the cross off the bottom.
        const down = results.filter(r => applyAlgorithm(SOLVED_FACELETS, r.rotation || '')[31] !== applyAlgorithm(SOLVED_FACELETS, COLOR_ROTATIONS[r.color] || '')[31]);
        if (down.length) pool = down;
      }
      if (pick === 'rot') {
        const rot = results.filter(r => r.coreAlg.split(' ').some(t => /^[xyzrl]/.test(t)));
        if (rot.length) pool = rot;
      }
      if (pick === 'wide') {
        const wide = results.filter(r => r.coreAlg.split(' ').some(t => /^[rludfbMES]/.test(t)));
        if (wide.length) pool = wide;
      }
      if (pick === 'full') {
        const from = session.currentNodeId;
        const preferred = isMismatched(session.currentNode.state)
          ? results.filter(r => fullOnly.has(`${from}>${r.targetNodeId}`))
          : results.filter(r => /pseudo/.test(r.type));
        if (preferred.length) pool = preferred;
      }
      const c = pick === 'top' || pick === 'wide' || pick === 'rot' || pick === 'insp' ? pool[0] : pool[Math.floor(rnd() * pool.length)];
      const wasFullOnly = fullOnly.has(`${session.currentNodeId}>${c.targetNodeId}`);
      if (wasFullOnly) fullOnlySteps++;
      const nPseudo = results.filter(r => /pseudo/.test(r.type)).length;
      trace.push(`${wasFullOnly ? '[full-only] ' : ''}${c.type}[${(results.length)} cands, ${nPseudo} pseudo, ${Date.now() - t0}ms] ${c.coreAlg}`);
      if (/pseudo/.test(c.type)) pseudoSteps++;
      totalSteps++;
      session.commit(c);
      const now = pieces(scramble, session.rotation, session.scoredPath, '');
      const st = session.currentNode.state;
      const missing = (st.corners || []).filter(sl => !now.cornerAt[sl]).concat((st.edges || []).filter(sl => !now.edgeAt[sl]));
      if (missing.length) {
        frameFailures++;
        trace.push(`FRAME: node claims ${st.corners}/${st.edges} but physically corners ${homeSet(now.cornerAt)} edges ${homeSet(now.edgeAt)}`);
      }
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
  console.log(`\nsummary: ${completed}/${nScrambles} completed, ${totalSteps} steps (${pseudoSteps} pseudo, ${fullOnlySteps} full-pseudo-only), ${badWarnings} warnings, ${badFinal} bad finals, ${frameFailures} frame failures`);
  process.exit(badWarnings || badFinal || frameFailures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
