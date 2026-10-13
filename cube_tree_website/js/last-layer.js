/**
 * last-layer.js -- the last layer on the solving screen (README "Algorithm
 * sets"). Once the F2L is solved, what the user types next is read as
 * last-layer steps by replaying it on the facelet cube (never taken from a
 * claim): a line that moves the cube on to a later stage is a step, named
 * after the case it solved ("oll 27", "pll t", "zbll t 12"). The ghost and
 * the tree-searcher offer the algs of the case on the cube (data/ll/*.json),
 * in the solver's last-layer method; at the last pair, the last-slot sets
 * (ZBLS, OLS) whose case matches.
 */
'use strict';

const LastLayer = (() => {
  // stages of the last layer, in order (F2L solved in all); epll (the
  // corners solved, the edges oriented) is an oriented layer too
  const STAGE_RANK = { f2l: 0, eo: 1, oriented: 2, epll: 2, auf: 3, done: 4 };
  const isEpll = c => AlgSets.llEO(c) && AlgSets.uPowers().some(u => [0, 1, 2, 3].every(i => c.cp[i] === u.cp[i] && c.co[i] === 0));

  /** The stage of a cube (facelets, any colours), or null when its F2L is not solved. */
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

  // The sets that apply at each stage, and what finishing one leaves.
  const SETS_AT = {
    f2l: ['oll'],
    eo: ['zbll', 'coll', 'oll'],
    oriented: ['pll'],
    epll: ['pll'],
  };
  /** The sets a solver's method uses at a stage, best first. */
  function setsFor(stage, method = 'oll') {
    const all = SETS_AT[stage] || [];
    if (stage !== 'eo') return all;
    if (method === 'zbll') return ['zbll', 'oll'];
    if (method === 'coll') return ['coll', 'oll'];
    return ['oll'];
  }

  /**
   * The cases of a cube in the loaded sets: [{ setId, case, hit }] for every
   * set that applies at its stage. `data`: set id -> { data, index }.
   */
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

  /** The label of a case: "oll 27", "pll t", "zbll t 12". */
  const caseLabel = (setId, data, kase) => AlgSets.caseTitle(data[setId] ? data[setId].data.name : setId, kase.name);

  /**
   * The algs to offer on a cube: [{ setId, label, toks, score, src, alg }],
   * the method's first set first, each set by its ranking. AUFs included:
   * the tokens solve this cube as it stands.
   */
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
      for (const a of f.case.algs) {
        const w = AlgSets.algFor(a, f.hit, setId);
        out.push({ setId, label: caseLabel(setId, data, f.case), caseName: f.case.name, toks: w.text.split(' ').filter(Boolean), score: a.score, src: a.src, alg: a });
      }
    }
    return out;
  }

  /**
   * Reads the lines after the F2L (`lines`: [{ tokens: [tok...] }], from the
   * cube `start`): { steps: [{ firstLine, lastLine, label, toks }], tail:
   * { firstLine, tokens } }. A line is a step when, replayed, the cube is at
   * a later stage than before; a line that moves nothing on is merged into
   * the next.
   */
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

  /** What a step that took the cube from one stage to another did, with its case when known. */
  function stepLabel(before, from, to, data) {
    const found = data ? casesOf(before, data) : [];
    const named = setId => {
      const f = found.find(x => x.setId === setId);
      return f ? caseLabel(setId, data, f.case) : setId;
    };
    if (to === 'done' || to === 'auf') {
      if (from === 'auf') return 'auf';
      if (from === 'oriented' || from === 'epll') return named('pll');
      if (from === 'eo') return named('zbll');
      return '1lll';
    }
    if (to === 'oriented') return named('oll');
    if (to === 'epll') return from === 'eo' ? named('coll') : named('oll');
    if (to === 'eo') return 'eo';
    return 'last layer';
  }

  /**
   * The last-slot algs (ZBLS, OLS) for a cube whose F2L lacks one pair:
   * [{ setId, name, toks }], `toks` solving the cube as it stands. The sets
   * are for the front-right slot: a y brings the slot there, or the mirror
   * image does (left-hand algs for a left slot, mirrored back). `perCase`
   * algs per set and case.
   */
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
        for (const a of kase.algs.slice(0, perCase)) {
          const own = [rot, AlgSets.algFor(a, hit, setId).text].filter(Boolean).join(' ');
          const toks = (mirrored ? AlgSets.mirrorAlg(own) : own).split(' ');
          const key = toks.join(' ');
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ setId, name: AlgSets.caseTitle(d.data.name, kase.name), toks, mirrored });
        }
      }
    }
    return out;
  }

  // A step's alg as the sets store it: no AUF before or after (a leading y
  // on a last-layer case is an AUF too).
  const AUF_TOKEN = /^[Uy](2|'|)$/;
  function bodyOf(toks) {
    let a = 0, b = toks.length;
    while (a < b && AUF_TOKEN.test(toks[a])) a++;
    while (b > a && /^U(2|'|)$/.test(toks[b - 1])) b--;
    return toks.slice(a, b).join(' ');
  }
  const CRITIQUE_MARGIN = 3; // llScore units: less is noise (Sune ~ 37)

  /**
   * The critique of the last-layer steps (critique.js does the F2L): each
   * step against the algs of the case it solved, by the same ranking, in
   * words: my favourite, a great alg, or a quicker one to try.
   * [{ key, vars, alt, at }]: caption keys, `at` = the step's first move
   * (counted from the start of the last layer).
   */
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
        const algs = f.case.algs;
        const rank = algs.findIndex(a => a.alg === body);
        const mine = rank >= 0 ? algs[rank].score : AlgSets.llScore(body);
        const best = algs[0];
        if (rank === 0) items.push({ key: 'critique.ll.best', vars: { label }, at });
        else if (mine <= best.score + CRITIQUE_MARGIN) items.push({ key: 'critique.ll.good', vars: { label }, at });
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

  /** Every set's data and recognition index, loaded once: set id -> { data, index }. */
  const LOADED = {};
  const PENDING = {};
  function load(setId, url = `data/ll/${setId}.json`) {
    if (LOADED[setId]) return Promise.resolve(LOADED[setId]);
    if (!PENDING[setId]) {
      PENDING[setId] = fetch(url).then((r) => { if (!r.ok) throw new Error(`${setId}: ${r.status}`); return r.json(); })
        .then((d) => { LOADED[setId] = { data: d, index: AlgSets.indexSet(setId, d) }; return LOADED[setId]; });
    }
    return PENDING[setId];
  }

  return { stageOf, setsFor, casesOf, suggestions, readSteps, stepLabel, caseLabel, critique, bodyOf, lastSlotAlgs, load, LOADED, STAGE_RANK };
})();

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LastLayer };
}
