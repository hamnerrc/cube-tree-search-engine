#!/usr/bin/env node
/**
 * Coverage of professional steps by the complete search (README "Complete
 * search"), without the engine: a pro step is in the search's space when its
 * face turns are within the step's move limit and the way the pro wrote it
 * is one of the spellings spelling-search.js generates for them. (Whether it
 * is also among the best N depends on alg_speed: tools/tune-alg-speed.js.)
 * Reasons a step is not, counted separately: too long, two mid-step
 * rotations, slices / other notation.
 *
 *   node tools/complete-coverage.js [--file data/pro_references.txt]
 */
'use strict';
const path = require('path');
const root = path.join(__dirname, '..');
const jsRoot = path.join(root, 'js');
for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'spelling-search.js']) Object.assign(global, require(path.join(jsRoot, f)));
const B = require(path.join(jsRoot, 'solver-bridge.js'));
const { loadProReferences, segmentProSolve } = require('./pro-references.js');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const file = path.join(root, opt('file', 'data/pro_references.txt'));
const t = SpellingSearch.tables();

const tally = {};
const add = (group, key) => { tally[group] = tally[group] || {}; tally[group][key] = (tally[group][key] || 0) + 1; };
for (const solve of loadProReferences(file)) {
  let segs;
  try { segs = segmentProSolve(solve); } catch (e) { continue; }
  for (const seg of segs) {
    const group = seg.isRoot ? 'first steps' : 'later steps';
    const toks = seg.alg.split(' ').filter(Boolean);
    if (toks.some(x => /^[MESmes]|^[xyz]2?'?$/.test(x) && /^[MES]/i.test(x))) { add(group, 'slice'); continue; }
    // leading rotations: the inspection (first step) or a free y (later)
    let k = 0;
    while (k < toks.length && /^[xyz]/.test(toks[k])) k++;
    const lead = toks.slice(0, k).join(' ');
    const body = toks.slice(k);
    if (body.filter(x => /^[xyz]/.test(x)).length > 1) { add(group, 'two mid-step rotations'); continue; }
    if (!seg.isRoot && lead && !['y', "y'", 'y2'].includes(rotationName(lead))) { add(group, 'other leading rotation'); continue; }
    // the face turns in the frame the step starts in (canonicalizeForEngine
    // gives them after the net rotation: "rotation, then moves")
    let frame;
    let face;
    try {
      frame = canonicalizeForEngine('', (seg.isRoot ? body : toks).join(' '));
      // a first step: in the frame it ends in (cross on D), with the
      // inspection that undoes its rotation as the leading orientation
      const start = seg.isRoot || !frame.rotation ? frame.moves : relabelAlgForRotation(frame.moves, inverseRotation(frame.rotation));
      // as the engine lists it: consecutive turns of one face merged (r2 -> L L -> L2)
      const q = { '': 1, "'": 3, '2': 2 };
      face = [];
      for (const x of start.split(' ').filter(Boolean)) {
        const prev = face[face.length - 1];
        if (prev && prev[0] === x[0]) {
          const sum = (q[prev.slice(1)] + q[x.slice(1)]) % 4;
          face.pop();
          if (sum) face.push(x[0] + ['', '', '2', "'"][sum]);
        } else face.push(x);
      }
    } catch (e) { add(group, 'notation'); continue; }
    const pairs = seg.newPairs.length;
    const limit = seg.isRoot ? B.DISTANCE1_LIMITS[pairs] : B.searchLimitFor(pairs, false, seg.totalPairs);
    if (!limit) { add(group, 'no such step type'); continue; }
    if (face.length > limit) { add(group, 'longer than the limit'); continue; }
    if (face.some(x => !t.TID.has(x))) { add(group, 'notation'); continue; }
    const want = commuteNormalize((seg.isRoot ? body : toks).join(' '));
    const wantLead = seg.isRoot ? rotationName(inverseRotation(frame.rotation)) : '';
    let found = false;
    SpellingSearch.enumerate([{ face: face.map(x => t.TID.get(x)), look: 0 }], {
      root: seg.isRoot,
      budget: () => (found ? -Infinity : Infinity),
      leaf: (ids, lead) => {
        if (seg.isRoot && rotationName(SpellingSearch.orientationName(lead)) !== wantLead) return;
        if (commuteNormalize(Array.from(ids, i => t.TOK[i]).join(' ')) === want) found = true;
      },
    });
    add(group, found ? 'in the search' : 'spelling not generated');
    if (!found && args.includes('--list')) console.log(`  not generated: ${seg.alg}   (faces: ${face.join(' ')})`);
  }
}
for (const [group, counts] of Object.entries(tally)) {
  const n = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`${group}: ${n} steps, ${counts['in the search'] || 0} in the complete search (${(100 * (counts['in the search'] || 0) / n).toFixed(1)}%)`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) if (k !== 'in the search') console.log(`  ${k}: ${v}`);
}
