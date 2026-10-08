#!/usr/bin/env node
/**
 * Professional solve data from reco.nz (reconstructions of real solves) for
 * tuning alg_speed (README "Ranking"; PROJECT_STATUS.md "Tuning data").
 *
 *   node tools/reco.js fetch <raw.json> "Solver Name" ["Solver Name" ...]
 *       Downloads every 3x3 reconstruction of those solvers (resumable: ids
 *       already in <raw.json> are skipped; ~2 requests per second).
 *   node tools/reco.js convert <raw.json> [--out data/reco_solves.txt]
 *       Keeps each solve's Cross + F2L part, normalises the notation, replays
 *       it on a simulated cube and writes the solves that check out, in the
 *       format of data/pro_references.txt plus a "# reco.nz/solve/<id>" line.
 *
 * Notation clean-up (convert): R3 = R', U3' = U, "U'D" = U' D, R2' = R2, and
 * consecutive turns of the same layer are merged (U' U' U' = U, R R' = none);
 * a reconstruction writes those out to show regrips, the cube state is the same.
 * A solve is cut after its last step that ends on a DAG node (cross on the
 * bottom, no solved pair lost); solves with no such step are dropped.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { segmentProSolve } = require('./pro-references.js');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url) {
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'cube-tree alg_speed tuning (low rate)' } });
      if (r.ok) return await r.text();
      console.error('HTTP', r.status, url);
    } catch (e) { console.error('fetch error', url, e.message); }
    await sleep(2000 * (i + 1));
  }
  throw new Error(`failed: ${url}`);
}

const unescape = s => s.replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const text = html => unescape(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());

async function fetchSolves(rawFile, solvers) {
  const out = fs.existsSync(rawFile) ? JSON.parse(fs.readFileSync(rawFile, 'utf8')) : [];
  const done = new Set(out.map(s => s.id));
  const save = () => fs.writeFileSync(rawFile, JSON.stringify(out, null, 1));
  for (const solver of solvers) {
    const ids = [];
    for (let page = 1; ; page++) {
      const html = await get('https://reco.nz/solve/index?' + new URLSearchParams([['solver[]', solver], ['3x3', 'on'], ['page', String(page)]]));
      const got = [...html.matchAll(/data-id='(\d+)'/g)].map(m => Number(m[1]));
      ids.push(...got);
      if (!got.length || !html.includes(`page=${page + 1}`)) break;
      await sleep(400);
    }
    console.error(`${solver}: ${ids.length} solves`);
    for (const id of ids) {
      if (done.has(id)) continue;
      const html = await get(`https://reco.nz/solve/${id}`);
      const rec = {
        id, solver,
        title: text((html.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || ''),
        meta: text((html.match(/<h3>([\s\S]*?)<\/h3>/) || [])[1] || ''),
      };
      // The alg.cubing.net link carries the scramble and the labelled solution as plain text.
      const link = (html.match(/href="(https:\/\/alg\.cubing\.net\/\?[^"]*)"/) || [])[1];
      if (link) {
        const q = new URL(unescape(link)).searchParams;
        rec.scramble = q.get('setup');
        rec.solution = q.get('alg');
      }
      out.push(rec);
      done.add(id);
      if (out.length % 25 === 0) { save(); console.error(`${out.length} saved`); }
      await sleep(400);
    }
  }
  save();
  console.error(`total ${out.length}`);
}

// ---------------------------------------------------------------- convert

const LAYER_AMOUNT = { '': 1, "'": 3, '2': 2, "2'": 2, "'2": 2, '3': 3, "3'": 1 };
const TOKEN_RE = /([UDRLFBudrlfbMESxyz])(w?)(2'|'2|3'|2|3|')?/g;

/** Normalised tokens of one line of moves, or null if it has anything else. */
function cleanMoves(moves) {
  const stripped = moves.replace(/[()[\]]/g, ' ').trim();
  if (!stripped) return [];
  if (!/^([UDRLFBudrlfbMESxyz]w?(2'|'2|3'|2|3|')?\s*)+$/.test(stripped)) return null;
  const out = []; // [letter, amount mod 4]
  for (const m of stripped.matchAll(TOKEN_RE)) {
    const letter = m[2] ? m[1].toLowerCase() : m[1];
    const amount = LAYER_AMOUNT[m[3] || ''];
    const last = out[out.length - 1];
    if (last && last[0] === letter) {
      last[1] = (last[1] + amount) % 4;
      if (!last[1]) out.pop();
    } else out.push([letter, amount]);
  }
  return out.map(([l, a]) => l + ['', '', '2', "'"][a]);
}

const LL_LABEL = /\b(oll|pll|coll|zbll|ell|epll|cll|auf|ollcp|eo|1lll|cmll|ll)\b/;

/** One raw reconstruction -> { solve, reason } (solve null if unusable). */
function convertSolve(rec) {
  if (!rec.scramble || !rec.solution) return { solve: null, reason: 'no solution' };
  const scramble = cleanMoves(rec.scramble);
  if (!scramble || scramble.some(t => !/^[UDRLFB]/.test(t))) return { solve: null, reason: 'scramble notation' };
  let inspection = [];
  const steps = [];
  for (const line of rec.solution.split('\n')) {
    if (!line.trim()) continue;
    const [moves, label = 'step'] = line.split('//').map(s => s.trim());
    const lab = label.toLowerCase();
    if (/inspection/.test(lab)) {
      const t = cleanMoves(moves);
      if (!t || t.some(x => !/^[xyz]/.test(x))) return { solve: null, reason: 'inspection notation' };
      inspection = t;
      continue;
    }
    if (LL_LABEL.test(lab) && !/pair|cross|slot/.test(lab)) break; // last layer: F2L is over
    const t = cleanMoves(moves);
    if (t === null) return { solve: null, reason: `notation: ${moves}` };
    if (t.length) steps.push({ label: label.replace(/\s+/g, ' '), alg: t.join(' ') });
  }
  // Cut after the last step that ends on a DAG node.
  for (let n = steps.length; n > 0; n--) {
    const solve = { scramble: scramble.join(' '), inspection: inspection.join(' '), steps: steps.slice(0, n) };
    try {
      const segs = segmentProSolve(solve);
      return { solve, segs, cut: steps.length - n };
    } catch (e) { /* the solve's state after step n is not a DAG node */ }
  }
  return { solve: null, reason: 'never reaches a DAG node' };
}

function convert(rawFile, outFile) {
  const raw = JSON.parse(fs.readFileSync(rawFile, 'utf8')).sort((a, b) => a.id - b.id);
  const reasons = {};
  const lines = [
    '# Professional Cross + F2L reconstructions from reco.nz (community',
    '# reconstructions of real solves), written by tools/reco.js convert.',
    '# Same format as pro_references.txt; each solve starts with its source line.',
    '# Notation normalised, same-layer turns merged, last-layer steps dropped;',
    '# every solve replays to the cross plus the solved pairs its steps claim.',
    '',
  ];
  let kept = 0, complete = 0, segments = 0;
  const bySolver = {};
  for (const rec of raw) {
    const { solve, segs, reason } = convertSolve(rec);
    if (!solve) { reasons[reason.startsWith('notation') ? 'notation' : reason] = (reasons[reason.startsWith('notation') ? 'notation' : reason] || 0) + 1; continue; }
    kept++;
    segments += segs.length;
    if (segs[segs.length - 1].after.pairs.length === 4) complete++;
    bySolver[rec.solver || rec.solverQuery] = (bySolver[rec.solver || rec.solverQuery] || 0) + 1;
    const result = (rec.title.match(/ - (\S+) /) || [])[1] || '';
    lines.push(`# reco.nz/solve/${rec.id} | ${rec.solver || rec.solverQuery} | ${result} | ${rec.meta}`);
    lines.push(solve.scramble);
    if (solve.inspection) lines.push(`${solve.inspection} // inspection`);
    for (const st of solve.steps) lines.push(`${st.alg} // ${st.label}`);
    lines.push('');
  }
  fs.writeFileSync(outFile, lines.join('\n'));
  console.log(`${raw.length} reconstructions -> ${kept} solves (${complete} with all four pairs), ${segments} DAG steps -> ${outFile}`);
  console.log('per solver:', bySolver);
  console.log('dropped:', reasons);
}

if (require.main === module) {
  const [cmd, rawFile, ...rest] = process.argv.slice(2);
  if (cmd === 'fetch' && rawFile && rest.length) fetchSolves(rawFile, rest).catch(e => { console.error(e); process.exit(1); });
  else if (cmd === 'convert' && rawFile) {
    const i = rest.indexOf('--out');
    convert(rawFile, i === -1 ? path.join(__dirname, '..', 'data', 'reco_solves.txt') : rest[i + 1]);
  } else {
    console.error('usage: node tools/reco.js fetch <raw.json> "Solver" ... | convert <raw.json> [--out file]');
    process.exit(1);
  }
}

module.exports = { cleanMoves, convertSolve };
