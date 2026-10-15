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

// Every last-layer alg that keeps the F2L solves exactly one 1LLL case (the
// state it undoes) and, unless it only permutes, one COLL case: last-layer
// pages are harvested for every last-layer set.
const LL = ['oll', 'pll', 'coll', 'zbll', '1lll'];
const SHEET = id => `https://docs.google.com/spreadsheets/d/${id}`;
const CUBEROOT = 'https://api.cuberoot.me/v1/alg/sets/3x3/';
const MOISHY = 'https://registry.npmjs.org/@moishy/algsets/-/algsets-0.3.3.tgz';

// source id -> { name, url (credited), pages: [{ file, url, sets }] }
// (`sheet`: a public Google Sheet, every tab exported as CSV into one file;
// `tgz`: a member of a package)
const SOURCES = {
  zblssheet: {
    name: 'the community ZBLS spreadsheet (Chad Batten, Tao Yu; via @moishy/algsets, MIT)', url: 'https://jsr.io/@moishy/algsets',
    pages: [{ file: 'moishy-algsets.tgz', url: MOISHY, sets: ['zbls'], tgz: 'package/esm/src/zbls/index.js' }],
  },
  moishy: {
    name: '@moishy/algsets (MIT)', url: 'https://jsr.io/@moishy/algsets',
    pages: [['oll', LL], ['pll', LL], ['zbll', LL], ['coll-epll', LL], ['wv', ['ols']], ['sv', ['ols']]]
      .map(([m, sets]) => ({ file: 'moishy-algsets.tgz', url: MOISHY, sets, tgz: `package/esm/src/${m}/index.js` })),
  },
  cuberoot: {
    name: 'CubeRoot (cuberoot.me)', url: 'https://cuberoot.me/alg/3x3/1lll',
    // ollcp and 1lll also name the cases (SpeedCubeDB's names, scraped by CubeRoot): `names`
    pages: [['1lll', LL, '1lll'], ['ollcp', LL, 'coll'], ['zbll', LL], ['coll', LL], ['oll', LL], ['pll', LL], ['zbls', ['zbls']], ['wv', ['ols']], ['sv', ['ols']], ['vls', ['ols']]]
      .map(([p, sets, names]) => ({ file: `cuberoot-${p}.json`, url: `${CUBEROOT}${p}`, sets, names, headers: { origin: 'https://cuberoot.me', referer: 'https://cuberoot.me/' } })),
  },
  cuberpro: {
    name: 'algs.cuber.pro', url: 'https://algs.cuber.pro/333',
    pages: [
      ...['OLL', 'PLL', 'ELL', ...['AS', 'H', 'L', 'PI', 'S', 'T', 'U'].flatMap(o => [`COLL+${o}`, `ZBLL+${o}`]), ...Array.from({ length: 57 }, (_, k) => `OLLCP+${k + 1}`)]
        .map(p => ({ file: `cuberpro-${p}`, url: `https://algs.cuber.pro/333/${p}`, sets: LL, optional: true })),
      ...['WVLS', 'WVLS+FL', 'VLS+UB', 'VLS+UBUL', 'VLS+UF', 'VLS+UFUB', 'VLS+UFUL', 'VLS+UL', 'VLS+NO+EDGES']
        .map(p => ({ file: `cuberpro-${p}`, url: `https://algs.cuber.pro/333/${p}`, sets: ['ols'], optional: true })),
    ],
  },
  // the ZBLL compilations the Speedsolving wiki lists, and a 1LLL sheet
  juju: { name: 'Juliette Sébastien\'s ZBLL algorithms', url: SHEET('1-uwmZHf4vwJxFgeB3-TiF8MQ0RFSS30d5CUK96PoIwk'), pages: [{ file: 'sheet-juju.csv', sheet: '1-uwmZHf4vwJxFgeB3-TiF8MQ0RFSS30d5CUK96PoIwk', sets: LL }] },
  taoyu: { name: 'Tao Yu & Justin Taylor\'s ZBLL algorithms', url: SHEET('1uXwshDSwMPIxmAyrf40FxRNewGnlo8hTHHGQbHP8Mbk'), pages: [{ file: 'sheet-taoyu.csv', sheet: '1uXwshDSwMPIxmAyrf40FxRNewGnlo8hTHHGQbHP8Mbk', sets: LL }] },
  holbein: { name: 'Brant Holbein\'s ZBLL algorithms', url: SHEET('1eva73qzgmnsqMsLZ89Uqc-UURb0MPWgRppTf-KmAgRs'), pages: [{ file: 'sheet-holbein.csv', sheet: '1eva73qzgmnsqMsLZ89Uqc-UURb0MPWgRppTf-KmAgRs', sets: LL }] },
  gertner: { name: 'Nicolas Gertner\'s ZBLL algorithms', url: SHEET('1lERUMmQHtVcovzeTCCQx7iOe0ku_uIXGE2Snr-MZGAQ'), pages: [{ file: 'sheet-gertner.csv', sheet: '1lERUMmQHtVcovzeTCCQx7iOe0ku_uIXGE2Snr-MZGAQ', sets: LL }] },
  gftw: { name: 'goodforthewin\'s ZBLL algorithms', url: SHEET('1ty7aLoEGTgJMKp_qqA-5nuPKBIWbV4tFmTej46k0GRw'), pages: [{ file: 'sheet-gftw.csv', sheet: '1ty7aLoEGTgJMKp_qqA-5nuPKBIWbV4tFmTej46k0GRw', sets: LL }] },
  lllsheet: { name: 'the "most worth it 1LLL sets" sheet (Speedsolving)', url: SHEET('1pQjqOKxDGQldheg5PcAND7TvSpQb_hgl1rEzaFV88Rs'), pages: [{ file: 'sheet-1lll.csv', sheet: '1pQjqOKxDGQldheg5PcAND7TvSpQb_hgl1rEzaFV88Rs', sets: LL }] },
  wiki: {
    name: 'Speedsolving.com Wiki', url: 'https://www.speedsolving.com/wiki',
    pages: [
      { file: 'wiki-OLL', url: `${WIKI}OLL`, sets: LL },
      { file: 'wiki-PLL', url: `${WIKI}PLL`, sets: LL },
      { file: 'wiki-SV', url: `${WIKI}Summer_Variation`, sets: ['ols'] },
      ...CXLL.map(p => ({ file: `wiki-${p}`, url: `${WIKI}${p}`, sets: LL, optional: true })),
    ],
  },
  cubingapp: {
    name: 'CubingApp', url: 'https://cubingapp.com/algorithms',
    pages: ['OLL', 'PLL', 'COLL', 'ZBLL', 'Winter-Variation', 'OLLCP'].map(p => ({
      file: `cubingapp-${p}`, url: `https://cubingapp.com/algorithms/${p}/`,
      sets: p === 'Winter-Variation' ? ['ols'] : LL,
    })),
  },
  jperm: {
    name: 'J Perm (jperm.net)', url: 'https://jperm.net/algs',
    pages: [['oll', LL], ['pll', LL], ['coll', LL], ['wv', ['ols']], ['vls', ['ols']], ['zbll', LL]]
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
      if (p.sheet) { await fetchSheet(p.sheet, file); continue; }
      const res = await fetch(p.url, { headers: { 'user-agent': 'cube-tree alg import (one request a second)', ...(p.headers || {}) } });
      if (!res.ok) { console.log(`${p.url}: HTTP ${res.status}${p.optional ? ' (skipped)' : ''}`); if (!p.optional) process.exitCode = 1; continue; }
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      console.log('fetched', p.file);
      await sleep(1000);
    }
  }
}

/** A public Google Sheet: every tab (found on its htmlview page) as CSV, one after another. */
async function fetchSheet(id, file) {
  const ua = { 'user-agent': 'Mozilla/5.0 (cube-tree alg import)' };
  const page = await (await fetch(`${SHEET(id)}/htmlview`, { headers: ua })).text();
  const gids = [...new Set([...page.matchAll(/gid: "(\d+)"/g)].map(m => m[1]))];
  if (!gids.length) gids.push('0');
  let out = '';
  for (const gid of gids) {
    const res = await fetch(`${SHEET(id)}/export?format=csv&gid=${gid}`, { headers: ua });
    if (res.ok) out += `\n# tab ${gid}\n${await res.text()}`;
    await sleep(1000);
  }
  fs.writeFileSync(file, out);
  console.log('fetched', path.basename(file), `${gids.length} tabs`);
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

const CASE_OF = {}; // set -> Map key -> its case (enumerateCases)
function caseOfKey(setId) {
  if (!CASE_OF[setId]) {
    CASE_OF[setId] = new Map();
    for (const c of AlgSets.enumerateCases(setId)) for (const k of c.members.keys()) CASE_OF[setId].set(k, c);
  }
  return CASE_OF[setId];
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
    // the run as written, or with up to two stray moves cut: the first
    // that solves a case of one of the page's sets, kept for every set it fits
    for (let a = 0, done = false; a <= 2 && !done; a++) for (let b = 0; b <= 2 && !done; b++) {
      const toks = run.slice(a, run.length - b);
      if (toks.length < 4) continue;
      for (const setId of sets) { const c = classify(toks, setId); if (c) { found.push({ setId, ...c }); done = true; } }
    }
  }
  return found;
}

function tgzFile(file, member) {
  const { execFileSync } = require('child_process');
  return execFileSync('tar', ['-xzOf', file, member], { maxBuffer: 64 << 20 }).toString('utf8');
}

/**
 * Case names from a page that lists cases with setups (CubeRoot's JSON):
 * set -> { case key -> name }, the first name of a case kept (SpeedCubeDB
 * lists OLLCP 57 x 6, symmetric OLLs twice). A setup is the case as made
 * from a solved cube.
 */
function caseNames(text, setId, into) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return 0; }
  const out = into[setId] || (into[setId] = {});
  let n = 0;
  for (const c of data.cases || []) {
    if (!c.setup || !c.name) continue;
    let state;
    try { state = AlgSets.algCubie(AlgSets.normalizeAlg(c.setup)); } catch (e) { continue; }
    const key = AlgSets.caseKeyOf(setId, state);
    if (key === null || !caseKeys(setId).has(key)) continue;
    // one key per case (the build finds the case of any of its AUF variants)
    const kase = caseOfKey(setId).get(key);
    if ([...kase.members.keys()].some(k => out[k])) continue;
    out[key] = c.name;
    n++;
  }
  return n;
}

function parseAll(dir) {
  const algs = new Map(); // set|key|alg -> { set, key, alg, from: [], votes }
  const names = {};
  const stats = {};
  for (const [id, src] of Object.entries(SOURCES)) {
    for (const p of src.pages) {
      const file = path.join(dir, p.file);
      if (!fs.existsSync(file)) { if (!p.optional) console.log(`missing ${p.file}`); continue; }
      const text = p.tgz ? tgzFile(file, p.tgz) : fs.readFileSync(file, 'utf8');
      if (p.names) console.log(`${p.file}: ${caseNames(text, p.names, names)} named cases`);
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
  // stored once per alg: [alg, sets, sources] (the case keys are the alg's
  // inverse, recomputed by `expand`)
  const byAlg = new Map();
  for (const a of list) {
    const row = byAlg.get(a.alg) || byAlg.set(a.alg, [a.alg, [], []]).get(a.alg);
    if (!row[1].includes(a.set)) row[1].push(a.set);
    for (const f of a.from) if (!row[2].includes(f)) row[2].push(f);
  }
  const out = {
    fetched: new Date().toISOString().slice(0, 10),
    sources: Object.fromEntries(Object.entries(SOURCES).map(([id, s]) => [id, { name: s.name, url: s.url }])),
    rows: [...byAlg.values()],
    names,
  };
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('wrote', OUT, list.length, 'algs', out.rows.length, 'distinct');
}

/** sources.json's rows as { set, key, alg, from } per set (the key: the case the alg undoes). */
function expand(data) {
  if (data.algs) return data.algs; // the older format
  const out = [];
  for (const [alg, sets, from] of data.rows || []) {
    let state;
    try { state = AlgSets.algCubie(AlgSets.invertAlg(alg)); } catch (e) { continue; }
    for (const set of sets) {
      const key = AlgSets.caseKeyOf(set, state);
      if (key !== null) out.push({ set, key, alg, from });
    }
  }
  return out;
}

if (require.main === module) {
  const [cmd, dir] = process.argv.slice(2);
  if (cmd === 'fetch' && dir) fetchAll(dir).catch((e) => { console.error(e); process.exit(1); });
  else if (cmd === 'parse' && dir) parseAll(dir);
  else console.log('usage: node tools/alg-sources.js fetch|parse <dir>');
}
module.exports = { moveRuns, classify, harvest, SOURCES, expand };
