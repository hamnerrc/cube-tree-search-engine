/**
 * The last layer on the solving screen. Once the F2L is
 * solved, what the user types next is read as last-layer steps by replaying it
 * on the facelet cube (never taken from a claim): a line that moves the cube on
 * to a later stage is a step, named after the case it solved ("oll 27", "pll
 * t", "zbll t 12"). The ghost and the suggestions offer the algs of the case
 * on the cube (data/ll/*.json), in the solver's last-layer method; at the last
 * pair, the last-slot sets (ZBLS, OLS) whose case matches.
 */
'use strict';

const LastLayer = (() => {
  const STAGE_RANK = { f2l: 0, eo: 1, oriented: 2, epll: 2, auf: 3, done: 4 };
  const isEpll = c => AlgSets.llEO(c) && AlgSets.uPowers().some(u => [0, 1, 2, 3].every(i => c.cp[i] === u.cp[i] && c.co[i] === 0));

  function stageOf(facelets) {
    const c = AlgSets.faceletCubie(facelets);
    if (!c || !AlgSets.f2lSolved(c)) return null;
    if (AlgSets.sameCubie(c, AlgSets.identity())) return 'done';
    if (AlgSets.reachesGoal(0, c)) return 'auf';
    if (isEpll(c)) return 'epll';
    if (AlgSets.llOriented(c)) return 'oriented';
    if (AlgSets.llEO(c)) return 'eo';
    return 'f2l';
  }

  const SETS_AT = {
    f2l: ['1lll', 'coll', 'oll'],
    eo: ['1lll', 'zbll', 'coll', 'oll'],
    oriented: ['pll'],
    epll: ['pll'],
  };
  function setsFor(stage, method = 'oll') {
    const all = SETS_AT[stage] || [];
    if (stage !== 'eo' && stage !== 'f2l') return all;
    if (method === '1lll') return ['1lll', 'oll'];
    if (method === 'coll') return ['coll', 'oll'];
    if (method === 'zbll' && stage === 'eo') return ['zbll', 'oll'];
    return ['oll'];
  }

  function casesOf(facelets, data) {
    const stage = stageOf(facelets);
    if (!stage) return [];
    const c = AlgSets.faceletCubie(facelets);
    const out = [];
    for (const setId of SETS_AT[stage] || []) {
      const d = data[setId];
      if (!d) continue;
      const hit = AlgSets.recognize(setId, d.index, c);
      if (hit) out.push({ setId, case: d.data.cases[hit.i], hit, name: d.data.name });
    }
    return out;
  }

  const caseLabel = (setId, data, kase) => AlgSets.caseTitle(data[setId] ? data[setId].data.name : setId, kase.name);

  const PREFS = { method: 'oll', style: 'tps', main: {}, known: {}, lastSlot: { zbls: true, ols: false, vls: false, hls: false, wv: true, sv: true }, hideAwkward: true };
  const STYLE_PER_MOVE = { efficiency: 1.2, tps: -0.6 };
  function setPrefs(p) { Object.assign(PREFS, p || {}); }
  const caseId = (setId, kase) => `${setId}/${String(kase.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  const stmOf = alg => String(alg).split(' ').filter(t => t && !/^[xyz]/.test(t)).length;
  const styledScore = a => a.score + (STYLE_PER_MOVE[PREFS.style] || 0) * stmOf(a.alg);
  function orderedAlgs(setId, kase) {
    const main = PREFS.main[caseId(setId, kase)];
    let algs = kase.algs.slice();
    if (PREFS.hideAwkward && !kase.awkOk) algs = algs.filter(a => !a.awk || a.alg === main);
    algs.sort((a, b) => (b.alg === main) - (a.alg === main) || styledScore(a) - styledScore(b));
    return algs;
  }
  function lastSlotAllowed(setId, kase) {
    const on = PREFS.lastSlot || {};
    if (setId === 'zbls') return !!on.zbls;
    if (on.ols) return true;
    return (kase.tags || []).some(t => on[t]);
  }

  function suggestions(facelets, data, method = 'oll') {
    const stage = stageOf(facelets);
    if (!stage) return [];
    if (stage === 'auf') {
      const c = AlgSets.faceletCubie(facelets);
      const U = AlgSets.uPowers();
      const k = U.findIndex(u => AlgSets.sameCubie(AlgSets.mul(c, u), AlgSets.identity()));
      return k > 0 ? [{ setId: 'auf', label: 'auf', toks: [AlgSets.AUF[k]], score: 0, src: 'auf' }] : [];
    }
    if (stage === 'done') return [];
    const order = setsFor(stage, method);
    const found = casesOf(facelets, data);
    const out = [];
    for (const setId of order) {
      const f = found.find(x => x.setId === setId);
      if (!f) continue;
      const id = caseId(setId, f.case);
      for (const a of orderedAlgs(setId, f.case)) {
        const w = AlgSets.algFor(a, f.hit, setId);
        out.push({
          setId, label: caseLabel(setId, data, f.case), caseName: f.case.name, caseId: id, toks: w.text.split(' ').filter(Boolean),
          score: styledScore(a), src: a.src, alg: a, main: PREFS.main[id] === a.alg,
        });
      }
    }
    return out;
  }

  function readSteps(start, lines, data) {
    const steps = [];
    let cube = start;
    let stage = stageOf(cube);
    let from = 0;
    let pending = [];
    for (let li = 0; li < lines.length; li++) {
      const toks = lines[li].tokens;
      if (!toks.length) continue;
      if (!pending.length) from = li;
      pending = pending.concat(toks);
      let after;
      try { after = applyAlgorithm(cube, pending.join(' ')); } catch (e) { continue; }
      const next = stageOf(after);
      if (!next || !stage || STAGE_RANK[next] <= STAGE_RANK[stage]) continue;
      steps.push({ firstLine: from, lastLine: li, label: stepLabel(cube, stage, next, data), toks: pending });
      cube = after;
      stage = next;
      pending = [];
    }
    return { steps, tail: { firstLine: pending.length ? from : lines.length, tokens: pending }, cube, stage };
  }

  function stepLabel(before, from, to, data) {
    const found = data ? casesOf(before, data) : [];
    const named = setId => {
      const f = found.find(x => x.setId === setId);
      return f ? caseLabel(setId, data, f.case) : setId.toUpperCase();
    };
    if (to === 'done' || to === 'auf') {
      if (from === 'auf') return 'auf';
      if (from === 'oriented' || from === 'epll') return named('pll');
      if (from === 'eo' && found.some(x => x.setId === 'zbll')) return named('zbll');
      return named('1lll');
    }
    if (to === 'oriented') return named('oll');
    // an OLL that happens to solve the corners keeps its OLL name unless COLL is the method
    if (to === 'epll') return PREFS.method !== 'coll' && found.some(x => x.setId === 'oll') ? named('oll') : named('coll');
    if (to === 'eo') return 'eo';
    return 'last layer';
  }

  const LS_ROTATIONS = ['', 'y', 'y2', "y'"];
  function lastSlotAlgs(facelets, data, perCase = 4) {
    const here = AlgSets.labelsOf(facelets);
    const out = [];
    const seen = new Set();
    for (const mirrored of [false, true]) for (const rot of LS_ROTATIONS) {
      const base = mirrored ? AlgSets.mirrorLabels(here) : here;
      const c = AlgSets.toCubie(AlgSets.labelsOf(rot ? applyAlgorithm(base, rot) : base));
      if (!c || !AlgSets.lsReady(c)) continue;
      for (const setId of ['zbls', 'ols']) {
        const d = data[setId];
        if (!d) continue;
        const hit = AlgSets.recognize(setId, d.index, c);
        if (!hit) continue;
        const kase = d.data.cases[hit.i];
        if (!lastSlotAllowed(setId, kase)) continue;
        const id = caseId(setId, kase);
        for (const a of orderedAlgs(setId, kase).slice(0, perCase)) {
          const own = [rot, AlgSets.algFor(a, hit, setId).text].filter(Boolean).join(' ');
          const toks = (mirrored ? AlgSets.mirrorAlg(own) : own).split(' ');
          const key = toks.join(' ');
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ setId, name: AlgSets.caseTitle(d.data.name, kase.name), toks, mirrored, caseId: id, alg: a, main: PREFS.main[id] === a.alg, tags: kase.tags || [] });
        }
      }
    }
    return out;
  }

  const AUF_TOKEN = /^[Uy](2|'|)$/;
  function bodyOf(toks) {
    let a = 0, b = toks.length;
    while (a < b && AUF_TOKEN.test(toks[a])) a++;
    while (b > a && /^U(2|'|)$/.test(toks[b - 1])) b--;
    return toks.slice(a, b).join(' ');
  }
  const CRITIQUE_MARGIN = 3; // llScore units: less is noise (Sune ~ 37)

  function critique(start, steps, data, method = 'oll') {
    const items = [];
    let cube = start;
    let at = 0;
    for (const st of steps) {
      const label = st.label;
      const stage = stageOf(cube);
      const sets = SETS_AT[stage] || [];
      const found = casesOf(cube, data).filter(f => sets.includes(f.setId) && label.startsWith(caseLabel(f.setId, data, f.case)));
      const body = bodyOf(st.toks);
      const f = found[0];
      if (!f || !body) items.push({ key: 'critique.ll.unknown', vars: { label }, at });
      else {
        const algs = orderedAlgs(f.setId, f.case);
        const rank = algs.findIndex(a => a.alg === body);
        const mine = rank >= 0 ? styledScore(algs[rank]) : AlgSets.llScore(body, null, f.setId) + (STYLE_PER_MOVE[PREFS.style] || 0) * stmOf(body);
        const best = algs[0];
        const main = PREFS.main[caseId(f.setId, f.case)];
        if (main && main === body) items.push({ key: 'critique.ll.main', vars: { label }, at });
        else if (main) {
          const w = AlgSets.algFor(f.case.algs.find(a => a.alg === main) || best, f.hit, f.setId);
          items.push({ key: 'critique.ll.notMain', vars: { label }, alt: { key: 'critique.ll.yourAlt', vars: { alg: w.text } }, at });
        } else if (rank === 0) items.push({ key: 'critique.ll.best', vars: { label }, at });
        else if (mine <= styledScore(best) + CRITIQUE_MARGIN) items.push({ key: 'critique.ll.good', vars: { label }, at });
        else {
          const w = AlgSets.algFor(best, f.hit, f.setId);
          items.push({ key: 'critique.ll.slower', vars: { label }, alt: { key: 'critique.ll.alt', vars: { alg: w.text } }, at });
        }
      }
      try { cube = applyAlgorithm(cube, st.toks.join(' ')); } catch (e) { break; }
      at += st.toks.length;
    }
    return items;
  }

  const LOADED = {};
  const PENDING = {};
  function load(setId, url = AlgSets.dataUrl(setId)) {
    if (LOADED[setId]) return Promise.resolve(LOADED[setId]);
    if (!PENDING[setId]) {
      PENDING[setId] = fetch(url).then((r) => { if (!r.ok) throw new Error(`${setId}: ${r.status}`); return r.json(); })
        .then((d) => { LOADED[setId] = { data: d, index: AlgSets.indexSet(setId, d) }; return LOADED[setId]; });
    }
    return PENDING[setId];
  }

  let MORE = null;
  function loadOlsMore(url = AlgSets.dataUrl('ols-more')) {
    if (MORE) return MORE;
    MORE = Promise.all([load('ols'), fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)]).then(([d, more]) => {
      if (more && !d.data.moreLoaded) {
        d.data.cases.push(...more.cases);
        d.data.moreLoaded = true;
        d.index = AlgSets.indexSet('ols', d.data);
      }
      return d;
    });
    return MORE;
  }

  return {
    loadOlsMore,
    stageOf, setsFor, casesOf, suggestions, readSteps, stepLabel, caseLabel, critique, bodyOf, lastSlotAlgs, load, LOADED, STAGE_RANK,
    PREFS, setPrefs, caseId, orderedAlgs, styledScore, lastSlotAllowed, stmOf,
  };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LastLayer };
}
