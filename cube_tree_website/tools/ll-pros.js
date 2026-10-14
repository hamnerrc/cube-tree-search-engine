#!/usr/bin/env node
/**
 * ll-pros.js -- what professionals execute in the last slot and the last
 * layer (developer, 2026-10-13: tune the OLL/PLL ranking on Yiheng Wang,
 * ZBLL and ZBLS on Xuanyi Geng, niche sets on whoever uses them), read off
 * reco.nz reconstructions (tools/reco.js fetch; or a scan of every solve).
 *
 *   node tools/ll-pros.js extract <raw.json>... [--out data/ll/pro_ll.json]
 *
 * Each solve is replayed from its scramble. A step labelled with a set
 * (oll, pll, epll, coll, zbll, zbls, wv, sv, vls, hls, ols) is kept when the
 * cube before it is a case of that set and the step solves it (up to AUF):
 * { id, solver, set, key, body, pre }. Last-slot steps are brought to the
 * front-right slot first (a y, or the mirror image of a left-hand insert),
 * as the solving screen does. OLL with corner permutation (oll(cp)) is left
 * out: that alg is chosen for the PLL it leaves, not for its speed.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
for (const f of ['script.js', 'facelet-cube.js']) Object.assign(global, require(path.join(ROOT, 'js', f)));
const { AlgSets } = require(path.join(ROOT, 'js', 'alg-sets.js'));
const { cleanMoves } = require('./reco.js');
const { splitAlg, preAufFor } = require('./ll-build.js');

// a reconstruction's label -> the set its step belongs to
const LABEL_SET = [
  [/^(oll)$/, 'oll'], [/^(pll|epll)$/, 'pll'], [/^coll$/, 'coll'], [/^zbll$/, 'zbll'],
  [/^zbls$/, 'zbls'], [/^(wv|sv|vls|hls|ols|winter variation|summer variation)$/, 'ols'],
];
const setOfLabel = (label) => {
  const l = String(label).trim().toLowerCase();
  for (const [re, set] of LABEL_SET) if (re.test(l)) return set;
  return null;
};
const ROTS = ['', 'y', 'y2', "y'"];
const isRot = t => /^[xyz]/.test(t);

/** The step `toks` on cube `facelets` as a case of `setId`: { key, body, pre } or null. */
function asCase(setId, facelets, toks) {
  const set = AlgSets.SET_BY_ID[setId];
  const tries = [];
  if (!set.slot) tries.push({ labels: AlgSets.labelsOf(facelets), toks });
  else {
    // the slot brought to the front right: a y (its inverse goes before the
    // step), or the mirror image (a left-hand insert)
    for (const mirrored of [false, true]) for (const rot of ROTS) {
      let labels = AlgSets.labelsOf(facelets);
      let t = toks;
      if (mirrored) { labels = AlgSets.mirrorLabels(labels); try { t = AlgSets.mirrorAlg(toks.join(' ')).split(' '); } catch (e) { continue; } }
      if (rot) labels = AlgSets.labelsOf(applyAlgorithm(labels, rot));
      tries.push({ labels, toks: [...(rot ? AlgSets.invertAlg(rot).split(' ') : []), ...t] });
    }
  }
  for (const tr of tries) {
    const c = AlgSets.toCubie(tr.labels);
    const key = AlgSets.caseKeyOf(setId, c);
    if (key === null) continue;
    // leading rotations that cancel are dropped (a y to the slot, then its inverse)
    let toks2 = tr.toks.slice();
    let k = 0;
    while (k < toks2.length && isRot(toks2[k])) k++;
    if (k && applyAlgorithm(SOLVED_FACELETS, toks2.slice(0, k).join(' ')) === SOLVED_FACELETS) toks2 = toks2.slice(k);
    const { body } = splitAlg(toks2.join(' '), setId);
    if (!body) continue;
    const pre = preAufFor(setId, c, body);
    if (pre < 0) continue;
    return { key, body, pre };
  }
  return null;
}

function extract(rec) {
  const out = [];
  if (!rec.scramble || !rec.solution) return out;
  const scramble = cleanMoves(rec.scramble);
  if (!scramble) return out;
  let cube;
  try { cube = applyAlgorithm(SOLVED_FACELETS, scramble.join(' ')); } catch (e) { return out; }
  for (const line of rec.solution.split('\n')) {
    if (!line.trim()) continue;
    const [moves, label = ''] = line.split('//').map(s => s.trim());
    const toks = cleanMoves(moves);
    if (toks === null) return out; // notation the replay cannot follow: stop here
    const setId = setOfLabel(label);
    if (setId && toks.length) {
      const hit = asCase(setId, cube, toks);
      if (hit) out.push({ id: rec.id, solver: rec.solver || rec.solverQuery || '', set: setId, key: hit.key, body: hit.body });
    }
    try { cube = applyAlgorithm(cube, toks.join(' ')); } catch (e) { return out; }
  }
  return out;
}

function main(files, outFile) {
  const seen = new Set();
  const rows = [];
  for (const f of files) {
    for (const rec of JSON.parse(fs.readFileSync(f, 'utf8'))) {
      if (seen.has(rec.id)) continue;
      seen.add(rec.id);
      rows.push(...extract(rec));
    }
  }
  const per = {};
  for (const r of rows) { const k = `${r.solver} ${r.set}`; per[k] = (per[k] || 0) + 1; }
  console.log(Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, n]) => `${n} ${k}`).join('\n'));
  fs.writeFileSync(outFile, JSON.stringify({
    source: 'reco.nz reconstructions (https://reco.nz/solve/<id>), last-slot and last-layer steps; tools/ll-pros.js',
    rows,
  }));
  console.log(`${rows.length} steps -> ${outFile}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  const outFile = i >= 0 ? args.splice(i, 2)[1] : path.join(ROOT, 'data', 'll', 'pro_ll.json');
  if (args[0] === 'extract' && args.length > 1) main(args.slice(1), outFile);
  else console.log('usage: node tools/ll-pros.js extract <raw.json>... [--out file]');
}
module.exports = { extract, asCase, setOfLabel };
