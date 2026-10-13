#!/usr/bin/env node
/**
 * algdb.js -- imports the community last-layer and last-slot algorithms of
 * SpeedCubeDB (speedcubedb.com) as the baseline of the alg sets (README
 * "Algorithm sets"): each case's name, subgroup, setup, its algorithms and
 * their community votes. (The F2L page only names the ZBLS pair cases.)
 *
 *   node tools/algdb.js fetch <dir>      download the set pages into <dir> (one request a second)
 *   node tools/algdb.js parse <dir>      parse them into data/ll/scdb.json
 *
 * The raw pages stay outside the repository; only the parsed algorithms
 * (move sequences, case names, vote counts) are kept, credited per set.
 */
'use strict';
const fs = require('fs');
const path = require('path');

// page -> our set id (VLS is SpeedCubeDB's seven edge subsets plus WV)
const PAGES = {
  OLL: 'oll', PLL: 'pll', COLL: 'coll',
  ZBLLU: 'zbll', ZBLLL: 'zbll', ZBLLT: 'zbll', ZBLLH: 'zbll', ZBLLPi: 'zbll', ZBLLS: 'zbll', ZBLLAS: 'zbll',
  WV: 'vls', VLSUF: 'vls', VLSUL: 'vls', VLSUB: 'vls', VLSUFUL: 'vls', VLSUBUL: 'vls', VLSUFUB: 'vls', VLSNE: 'vls',
  SV: 'hls',
  F2L: 'f2l',
};
const OUT = path.join(__dirname, '..', 'data', 'll', 'scdb.json');

async function fetchAll(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const page of Object.keys(PAGES)) {
    const file = path.join(dir, `${page}.html`);
    if (fs.existsSync(file)) continue;
    const res = await fetch(`https://www.speedcubedb.com/a/3x3/${page}`, { headers: { 'user-agent': 'cube-tree alg import (one request a second)' } });
    if (!res.ok) throw new Error(`${page}: HTTP ${res.status}`);
    fs.writeFileSync(file, await res.text());
    console.log('fetched', page);
    await new Promise(r => setTimeout(r, 1000));
  }
}

const decode = s => s.replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const squash = s => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** One SpeedCubeDB page -> [{ name, subgroup, setup, standard, algs: [{ alg, votes }] }]. */
function parsePage(html) {
  const cases = [];
  const starts = [...html.matchAll(/<div class="row singlealgorithm[^"]*" data-subgroup="([^"]*)" data-alg="([^"]*)"/g)];
  starts.forEach((m, k) => {
    const block = html.slice(m.index, k + 1 < starts.length ? starts[k + 1].index : html.length);
    const setup = (block.match(/<div class="setup-case[^"]*"><div>setup:<\/div>([^<]*)<\/div>/) || [])[1];
    const standard = (block.match(/Standard Alg:<\/div>([\s\S]*?)<\/div>/) || [])[1];
    const algs = [];
    const items = block.split("<li class='list-group-item'>").slice(1);
    for (const item of items) {
      const alg = (item.match(/<div class="formatted-alg">([\s\S]*?)<\/div>/) || [])[1];
      if (!alg) continue;
      const votes = (item.match(/Community Votes:<\/div>[\s\S]*?<\/i>(\d+)/) || [])[1];
      algs.push({ alg: squash(alg), votes: votes ? +votes : 0 });
    }
    cases.push({ name: decode(m[2]), subgroup: decode(m[1]), setup: setup ? squash(setup) : '', standard: standard ? squash(standard) : '', algs });
  });
  return cases;
}

function parseAll(dir) {
  const sets = {};
  for (const [page, set] of Object.entries(PAGES)) {
    const file = path.join(dir, `${page}.html`);
    if (!fs.existsSync(file)) throw new Error(`missing ${file}: run fetch first`);
    const cases = parsePage(fs.readFileSync(file, 'utf8'));
    for (const c of cases) c.page = page;
    (sets[set] = sets[set] || []).push(...cases);
    console.log(page, cases.length, 'cases', cases.reduce((n, c) => n + c.algs.length, 0), 'algs');
  }
  const out = {
    source: 'SpeedCubeDB (https://www.speedcubedb.com), community algorithms and vote counts',
    fetched: new Date().toISOString().slice(0, 10),
    sets,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('wrote', OUT);
}

if (require.main === module) {
  const [cmd, dir] = process.argv.slice(2);
  if (cmd === 'fetch' && dir) fetchAll(dir).catch((e) => { console.error(e.message); process.exit(1); });
  else if (cmd === 'parse' && dir) parseAll(dir);
  else console.log('usage: node tools/algdb.js fetch|parse <dir>');
}
module.exports = { parsePage, PAGES };
