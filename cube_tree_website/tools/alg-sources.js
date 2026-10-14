#!/usr/bin/env node
/**
 * alg-sources.js -- community algorithms from more databases than
 * SpeedCubeDB (data/ll/scdb.json, tools/algdb.js; SpeedCubeDB has no ZBLS page) (README "Algorithm sets"; developer, 2026-10-13: at least
 * three more, and ZBLS scavenged where it can be found).
 *
 *   node tools/alg-sources.js fetch <dir>    download every source page into <dir> (raw pages stay outside git)
 *   node tools/alg-sources.js parse <dir>    write data/ll/sources.json
 *
 * Case names are not parsed: every move sequence on a page is replayed and
 * kept only when it solves a case of the set the page is about (its inverse
 * from a solved cube is a state of that set; a pre- or post-AUF is fine, the
 * build finds it). A last-slot alg written for the left slot is kept as its
 * mirror image when that solves a right-slot case. The build
 * (tools/ll-build.js) replays every alg again on its case.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
for (const f of ['script.js', 'facelet-cube.js']) Object.assign(global, require(path.join(ROOT, 'js', f)));
const { AlgSets } = require(path.join(ROOT, 'js', 'alg-sets.js'));

const OUT = path.join(ROOT, 'data', 'll', 'sources.json');
const WIKI = 'https://www.speedsolving.com/wiki/index.php?title=';
const CXLL = ['H', 'L', 'Pi', 'S', 'T', 'U', 'aS'].flatMap(o => ['B', 'D', 'F', 'L', 'O', 'R', 'U'].map(s => `CxLL_${o}_${s}`));

// source id -> { name, url (credited), pages: [{ file, url, sets }] }
const SOURCES = {
  zblssheet: {
    name: 'the community ZBLS spreadsheet (Chad Batten, Tao Yu; via @moishy/algsets, MIT)', url: 'https://jsr.io/@moishy/algsets',
    pages: [{ file: 'moishy-algsets.tgz', url: 'https://registry.npmjs.org/@moishy/algsets/-/algsets-0.3.3.tgz', sets: ['zbls'], tgz: 'package/esm/src/zbls/index.js' }],
  },
  wiki: {
    name: 'Speedsolving.com Wiki', url: 'https://www.speedsolving.com/wiki',
    pages: [
      { file: 'wiki-OLL', url: `${WIKI}OLL`, sets: ['oll'] },
      { file: 'wiki-PLL', url: `${WIKI}PLL`, sets: ['pll'] },
      { file: 'wiki-SV', url: `${WIKI}Summer_Variation`, sets: ['ols'] },
      ...CXLL.map(p => ({ file: `wiki-${p}`, url: `${WIKI}${p}`, sets: ['coll'] })),
    ],
  },
  cubingapp: {
    name: 'CubingApp', url: 'https://cubingapp.com/algorithms',
    pages: ['OLL', 'PLL', 'COLL', 'ZBLL', 'Winter-Variation', 'OLLCP'].map(p => ({
      file: `cubingapp-${p}`, url: `https://cubingapp.com/algorithms/${p}/`,
      sets: { OLL: ['oll'], PLL: ['pll'], COLL: ['coll'], ZBLL: ['zbll'], 'Winter-Variation': ['ols'], OLLCP: ['oll'] }[p],
    })),
  },
  jperm: {
    name: 'J Perm (jperm.net)', url: 'https://jperm.net/algs',
    pages: [['oll', ['oll']], ['pll', ['pll']], ['coll', ['coll']], ['wv', ['ols']], ['vls', ['ols']], ['zbll', ['zbll']]]
      .map(([p, sets]) => ({ file: `jperm-${p}`, url: `https://jperm.net/lib/${p}.js`, sets, optional: true })),
  },
};

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function fetchAll(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const src of Object.values(SOURCES)) {
    for (const p of src.pages) {
      const file = path.join(dir, p.file);
      if (fs.existsSync(file)) continue;
      const res = await fetch(p.url, { headers: { 'user-agent': 'cube-tree alg import (one request a second)' } });
      if (!res.ok) { console.log(`${p.url}: HTTP ${res.status}${p.optional ? ' (skipped)' : ''}`); if (!p.optional) process.exitCode = 1; continue; }
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      console.log('fetched', p.file);
      await sleep(1000);
    }
  }
}

const decode = s => s.replace(/&#x27;|&#0?39;|&apos;|&rsquo;|’|′/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ');

/** Every maximal run of move tokens in a text (4+ moves), normalised. */
function moveRuns(text) {
  const clean = decode(String(text).replace(/<[^>]*>/g, '\n')).replace(/\\'/g, "'").replace(/[()[\]{}]/g, ' ');
  const out = [];
  for (const line of clean.split(/[\n"`|•;,\\/*=:<>]+/)) {
    let run = [];
    const flush = () => { if (run.length >= 4) out.push(run); run = []; };
    for (const raw of line.split(/\s+/)) {
      if (!raw) continue;
      const t = AlgSets.normalizeAlg(raw);
      if (t && !t.includes(' ') && isMoveToken(t)) run.push(t);
      else flush();
    }
    flush();
  }
  return out;
}

let KEYS = null; // set -> Set of case keys (every AUF variant)
function caseKeys(setId) {
  if (!KEYS) KEYS = {};
  if (!KEYS[setId]) {
    KEYS[setId] = new Set();
    for (const c of AlgSets.enumerateCases(setId)) for (const k of c.members.keys()) KEYS[setId].add(k);
  }
  return KEYS[setId];
}

/** The alg (or its mirror, for a last-slot set) if it solves a case of the set; null otherwise. */
function classify(toks, setId) {
  const slot = !!AlgSets.SET_BY_ID[setId].slot;
  const tries = [toks.join(' ')];
  if (slot) { try { tries.push(AlgSets.mirrorAlg(tries[0])); } catch (e) { /* a token without a mirror */ } }
  for (const alg of tries) {
    let state;
    try { state = AlgSets.algCubie(AlgSets.invertAlg(alg)); } catch (e) { continue; }
    const key = AlgSets.caseKeyOf(setId, state);
    if (key !== null && caseKeys(setId).has(key)) return { alg, key };
  }
  return null;
}

/** Runs of a page, each tried whole, then with up to two stray moves cut from either end. */
function harvest(text, sets) {
  const found = [];
  for (const run of moveRuns(text)) {
    let hit = null;
    for (let a = 0; a <= 2 && !hit; a++) for (let b = 0; b <= 2 && !hit; b++) {
      const toks = run.slice(a, run.length - b);
      if (toks.length < 4) continue;
      for (const setId of sets) { const c = classify(toks, setId); if (c) { hit = { setId, ...c }; break; } }
    }
    if (hit) found.push(hit);
  }
  return found;
}

function tgzFile(file, member) {
  const { execFileSync } = require('child_process');
  return execFileSync('tar', ['-xzOf', file, member], { maxBuffer: 64 << 20 }).toString('utf8');
}

function parseAll(dir) {
  const algs = new Map(); // set|key|alg -> { set, key, alg, from: [], votes }
  const stats = {};
  for (const [id, src] of Object.entries(SOURCES)) {
    for (const p of src.pages) {
      const file = path.join(dir, p.file);
      if (!fs.existsSync(file)) { if (!p.optional) console.log(`missing ${p.file}`); continue; }
      const text = p.tgz ? tgzFile(file, p.tgz) : fs.readFileSync(file, 'utf8');
      const found = harvest(text, p.sets);
      for (const f of found) {
        const k = `${f.setId}|${f.key}|${f.alg}`;
        const old = algs.get(k);
        if (old) { if (!old.from.includes(id)) old.from.push(id); continue; }
        algs.set(k, { set: f.setId, key: f.key, alg: f.alg, from: [id] });
      }
      const s = stats[`${id} ${p.sets.join('+')}`] || (stats[`${id} ${p.sets.join('+')}`] = { pages: 0, algs: 0 });
      s.pages++; s.algs += found.length;
    }
  }
  for (const [k, s] of Object.entries(stats)) console.log(`${k.padEnd(22)} ${s.pages} pages, ${s.algs} algs solving a case`);
  const list = [...algs.values()];
  const per = {};
  for (const a of list) { per[a.set] = per[a.set] || new Set(); per[a.set].add(a.key); }
  console.log(Object.entries(per).map(([s, k]) => `${s}: ${list.filter(a => a.set === s).length} algs over ${k.size} case keys`).join('; '));
  const out = {
    fetched: new Date().toISOString().slice(0, 10),
    sources: Object.fromEntries(Object.entries(SOURCES).map(([id, s]) => [id, { name: s.name, url: s.url }])),
    algs: list,
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('wrote', OUT, list.length, 'algs');
}

if (require.main === module) {
  const [cmd, dir] = process.argv.slice(2);
  if (cmd === 'fetch' && dir) fetchAll(dir).catch((e) => { console.error(e); process.exit(1); });
  else if (cmd === 'parse' && dir) parseAll(dir);
  else console.log('usage: node tools/alg-sources.js fetch|parse <dir>');
}
module.exports = { moveRuns, classify, harvest, SOURCES };
