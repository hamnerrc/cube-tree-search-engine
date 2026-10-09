#!/usr/bin/env node
/**
 * Cubedb export against the real WASM engines (about a minute; not part of
 * the fast suite): complete solves found by the app's own searches -- the
 * best result at each step, with inspection rotations (several cross
 * colours), wide moves, a multislot and a pseudo step -- are exported with
 * cubedbUrl, the link is decoded the way Cubedb reads it ("_" = space,
 * "-" = prime, "//" comments), and the decoded moves applied to the decoded
 * scramble must physically solve cross + all four F2L pairs (independent
 * facelet replay).
 *
 * Usage: node test/cubedb-export-e2e.js
 */
'use strict';
const { fastLimits } = require('./fast-limits.js');
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js']) Object.assign(global, require(path.join(jsRoot, f)));
const { SolveSession, searchWithLookahead, solutionLines, cubedbUrl } = require(path.join(jsRoot, 'solver-bridge.js'));
const { createEnginePool } = require(path.join(root, 'tools', 'node-engine-pool.js'));

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS: ${name}`); } catch (err) { failures++; console.error(`FAIL: ${name}\n  ${err.stack}`); }
}

/** Cubedb's reading of a link: { scramble, moves } in ordinary notation. */
function decodeCubedb(url) {
  const q = new URL(url).searchParams; // decodes %XX; "_" and "-" stay
  const alg = s => s.replace(/_/g, ' ').replace(/-/g, "'");
  const moves = alg(q.get('alg')).split('\n').map(l => l.split('//')[0].trim()).filter(Boolean).join(' ');
  assert.strictEqual(q.get('puzzle'), '3x3');
  return { scramble: alg(q.get('scramble')), moves, lines: alg(q.get('alg')).split('\n') };
}

/** Commits pick(results) step by step until cross + F2L is solved. */
async function solve(scramble, advanced, colors, opts, pick, h, ph) {
  const tree = JSON.parse(fs.readFileSync(path.join(root, 'data', 'f2l_nodes_and_edges.json'), 'utf8'));
  const s = new SolveSession(scramble, pruneGraph(tree, { advanced: [...advanced, 'multislotting'], colors }), colors, advanced);
  s.maxSolutions = 100;
  fastLimits(s);
  for (let step = 0; !s.isComplete; step++) {
    assert.ok(step < 8, 'solve did not finish');
    const list = await searchWithLookahead(s, h, null, ph, opts);
    assert.ok(list.length, `no results at step ${step + 1}`);
    s.commit(pick(list, step));
  }
  return s;
}

function checkRoundTrip(s) {
  const url = cubedbUrl(s.scramble, solutionLines(s));
  const { scramble, moves, lines } = decodeCubedb(url);
  assert.strictEqual(scramble, s.scramble);
  const f = applyAlgorithm(SOLVED_FACELETS, `${scramble} ${moves}`);
  const flags = solvedFlags(f);
  assert.ok(flags.cross && flags.BL && flags.BR && flags.FL && flags.FR, `not solved by ${url}`);
  return { url, lines };
}

(async () => {
  const h = await createEnginePool('cross', 3);
  const ph = await createEnginePool('pseudo', 2);
  const pro = ['xcross', 'xxcross', 'pro_moves', 'cross_opt'];

  await test('best result at every step, four cross colours: the exported link solves cross + F2L', async () => {
    const s = await solve("R2 D' F2 D L2 B2 U R2 D2 R2 B2 L2 U' R2 B' D' R U B' U R D'", pro,
      ['white', 'yellow', 'green', 'blue'], {}, list => list[0], h, null);
    const { lines } = checkRoundTrip(s);
    console.log('   ', lines.join(' | '));
  });

  await test('a rotated inspection, a wide first step and a multislot: the exported link solves cross + F2L', async () => {
    const pickWide = (list, step) => (step === 0
      ? list.find(r => r.rotation && /[rl]/.test(r.coreAlg) && r.type === 'XCross') || list[0]
      : list.find(r => r.type === 'Multislot') || list[0]);
    const s = await solve("U R L' F' R2 B U2 R F L2 D' B2 R2 F2 R2 U F2 R2 L2 F2 U", pro,
      ['white', 'yellow', 'red', 'orange'], { multislot: true }, pickWide, h, null);
    const { lines } = checkRoundTrip(s);
    assert.ok(/inspection/.test(lines[0]), 'expected an inspection rotation');
    assert.ok(lines.some(l => /pairs$/.test(l)), 'expected a multislot line');
    console.log('   ', lines.join(' | '));
  });

  await test('a pseudo step and its repair: the exported link solves cross + F2L', async () => {
    const pickPseudo = (list, step) => (step === 0 ? list.find(r => /pseudo/i.test(r.type)) || list[0] : list[0]);
    const s = await solve("L2 D' R F R B2 D L R2 F L2 F R2 L2 B L2 U2 R2 B L2 R", ['xcross', 'full_pseudo', 'pro_moves', 'cross_opt'],
      ['white'], {}, pickPseudo, h, ph);
    const { lines } = checkRoundTrip(s);
    assert.ok(lines.some(l => /pseudo/.test(l)), 'expected a pseudo step');
    console.log('   ', lines.join(' | '));
  });

  h.terminate();
  ph.terminate();
  if (failures) { console.error(`\n${failures} test(s) failed.`); process.exit(1); }
  console.log('\nAll cubedb export e2e tests passed.');
})().catch((err) => { console.error(err); process.exit(1); });
