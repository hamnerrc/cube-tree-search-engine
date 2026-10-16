/**
 * The alg sets page (algs.html).
 */
'use strict';

(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const SET_IDS = AlgSets.SETS.map(s => s.id);
  const VIEW_KEY = 'cubetree_algs_view';
  const DATA = {};      // set id -> data/ll/<set>.json (OLS: plus ols-more.json once opened)
  const LOADING = {};   // set id -> promise
  const INDEX = {};     // set id -> AlgSets.indexSet
  let view = { set: 'oll', group: '', sub: '', show: 'all', olsTier: 'wv', placement: '' };
  let matches = [];     // move search results [{ setId, i, a, score }]
  let activeMatch = -1;
  let learnMode = false;
  const NICKNAMES = {
    oll: { 'OLL 21': 'H', 'OLL 22': 'Pi', 'OLL 23': 'Headlights', 'OLL 24': 'Chameleon', 'OLL 25': 'Bowtie', 'OLL 26': 'Antisune', 'OLL 27': 'Sune' },
  };
  const ALIASES = {
    oll: { 'OLL 21': 'h double headlights', 'OLL 22': 'pi bruno', 'OLL 23': 'headlights u', 'OLL 24': 't chameleon', 'OLL 25': 'l bowtie', 'OLL 26': 'antisune', 'OLL 27': 'sune' },
  };
  const OLS_TIERS = [['wv', 'WV'], ['sv', 'SV'], ['vls', 'VLS'], ['hls', 'HLS'], ['all', 'Every pair']];

  const profile = () => (typeof cubeProfiles !== 'undefined' && cubeProfiles ? cubeProfiles.active() : null);
  const storageKey = () => (typeof profileKey === 'function' ? profileKey(VIEW_KEY) : VIEW_KEY);
  function loadView() {
    try { Object.assign(view, JSON.parse(localStorage.getItem(storageKey()) || '{}')); } catch (e) { /* defaults */ }
    if (!SET_IDS.includes(view.set)) view.set = 'oll';
    if (!OLS_TIERS.some(t => t[0] === view.olsTier)) view.olsTier = 'wv';
    if (!['all', 'learn', 'known'].includes(view.show)) view.show = 'all';
  }
  function saveView() {
    try { localStorage.setItem(storageKey(), JSON.stringify(view)); } catch (e) { /* private mode */ }
  }
  function syncPrefs() {
    const p = profile();
    const a = (p && p.answers) || {};
    let solverView = {};
    try { solverView = JSON.parse(localStorage.getItem(typeof profileKey === 'function' ? profileKey('cubetree.view') : 'cubetree.view') || '{}') || {}; } catch (e) { solverView = {}; }
    const algs = p && cubeProfiles ? cubeProfiles.algs(p.id) : { main: {}, known: {} };
    LastLayer.setPrefs({
      style: a.style === 'efficiency' ? 'efficiency' : 'tps',
      main: algs.main, known: algs.known, knownSets: a.knownSets || [],
      hideAwkward: solverView.hideAwkwardAlgs !== false,
    });
  }
  const idOf = (setId, c) => LastLayer.caseId(setId, c);
  const isKnown = (setId, c) => !!LastLayer.PREFS.known[idOf(setId, c)] || (LastLayer.PREFS.knownSets || []).includes(setId);
  const mainOf = (setId, c) => LastLayer.PREFS.main[idOf(setId, c)] || null;

  function setKnown(setId, cases, on) {
    const p = profile();
    if (!p) return;
    const sets = (p.answers && p.answers.knownSets) || [];
    if (!on && sets.includes(setId)) {
      cubeProfiles.update(p.id, { answers: { knownSets: sets.filter(s => s !== setId) } });
      cubeProfiles.setKnown(p.id, DATA[setId].cases.map(c => idOf(setId, c)), true);
    }
    cubeProfiles.setKnown(p.id, cases.map(c => idOf(setId, c)), on);
    syncPrefs();
  }
  function setMain(setId, c, alg) {
    const p = profile();
    if (!p) return;
    cubeProfiles.setMainAlg(p.id, idOf(setId, c), alg);
    syncPrefs();
  }

  function prepare(setId, d) {
    d.cases.forEach((c) => {
      c.words = `${d.name} ${c.name} ${c.group} ${c.sub || ''} ${setId === 'pll' ? `${c.name} perm` : ''} ${(ALIASES[setId] || {})[c.name] || ''} ${(c.tags || []).join(' ')}`
        .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      c.algs.forEach((a) => { a.toks = a.alg.split(' '); });
    });
  }
  function load(setId) {
    if (DATA[setId]) return Promise.resolve(DATA[setId]);
    if (!LOADING[setId]) {
      LOADING[setId] = fetch(AlgSets.dataUrl(setId))
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then((d) => {
          prepare(setId, d);
          DATA[setId] = d;
          INDEX[setId] = AlgSets.indexSet(setId, d);
          return d;
        });
    }
    return LOADING[setId];
  }
  let moreLoading = null;
  function loadOlsMore() {
    if (moreLoading) return moreLoading;
    moreLoading = Promise.all([load('ols'), fetch(AlgSets.dataUrl('ols-more')).then(r => (r.ok ? r.json() : null)).catch(() => null)])
      .then(([d, more]) => {
        if (more && !d.moreLoaded) {
          prepare('ols', more);
          d.cases.push(...more.cases);
          d.moreLoaded = true;
          INDEX.ols = AlgSets.indexSet('ols', d);
        }
        return d;
      });
    return moreLoading;
  }
  const loadAll = () => Promise.all(SET_IDS.map(id => load(id).catch(() => null)));

  const stm = alg => alg.split(' ').filter(t => t && !/^[xyz]/.test(t)).length;
  function algHtml(a, typedCount = 0) {
    const toks = a.alg.split(' ');
    const body = toks.map((t, k) => (k < typedCount ? `<b>${esc(t)}</b>` : esc(t))).join(' ');
    const pre = a.pre ? `<span class="auf">(${AlgSets.AUF[a.pre]})</span> ` : '';
    const post = a.post ? ` <span class="auf">(${AlgSets.AUF[a.post]})</span>` : '';
    return `${pre}${body}${post}`;
  }
  const SOURCE_NAMES = {
    scdb: 'SpeedCubeDB', wiki: 'Speedsolving wiki', cubingapp: 'cubing.app', jperm: 'J Perm', zblssheet: 'ZBLS sheet', moishy: 'algsets',
    cuberoot: 'CubeRoot', cuberpro: 'cuber.pro', juju: 'Juju', taoyu: 'Tao Yu', holbein: 'Holbein', gertner: 'Gertner', gftw: 'goodforthewin', lllsheet: '1LLL sheet',
  };
  const allSources = a => (a.src === 'db' && a.from ? a.from.map(f => SOURCE_NAMES[f] || f).join(', ') : '');
  function sourcesOf(a) {
    if (a.src !== 'db' || !a.from || !a.from.length) return '';
    const names = a.from.map(f => SOURCE_NAMES[f] || f);
    return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0];
  }
  const isPartialMove = t => [...MOVE_PERMS.keys()].some(m => m.startsWith(t));
  function parseMoves(text) {
    const raw = text.trim();
    if (!raw) return null;
    const toks = raw.split(/\s+/);
    const partial = /\s$/.test(text) ? '' : toks[toks.length - 1];
    const done = partial ? toks.slice(0, -1) : toks;
    if (!done.every(t => isMoveToken(t))) return null;
    if (partial && !isPartialMove(partial)) return null;
    if (!done.length && /^[a-z]$/.test(partial) && !'rludfbmesxyz'.includes(partial)) return null;
    return { done: done.map(t => (t.length > 2 && t.endsWith("2'") ? t.slice(0, -1) : t)), partial };
  }

  function moveMatches(typed) {
    const out = [];
    for (const setId of SET_IDS) {
      const d = DATA[setId];
      if (!d) continue;
      d.cases.forEach((c, i) => c.algs.forEach((a) => {
        const t = a.toks;
        if (t.length < typed.done.length + (typed.partial ? 1 : 0)) return;
        for (let j = 0; j < typed.done.length; j++) if (t[j] !== typed.done[j]) return;
        if (typed.partial && !t[typed.done.length].startsWith(typed.partial)) return;
        out.push({ setId, i, a, score: LastLayer.styledScore(a) });
      }));
    }
    out.sort((x, y) => x.score - y.score);
    return out;
  }

  function solvedBy(done) {
    if (done.length < 2) return [];
    let state;
    try { state = AlgSets.algCubie(AlgSets.invertAlg(done.join(' '))); } catch (e) { return []; }
    const out = [];
    for (const setId of SET_IDS) {
      if (!INDEX[setId]) continue;
      const hit = AlgSets.recognize(setId, INDEX[setId], state);
      if (hit) out.push({ setId, i: hit.i, hit });
    }
    return out;
  }

  function slotsHtml(done, total, cells = 10) {
    const full = total ? Math.round(cells * done / total) : 0;
    return `<span class="slots" aria-hidden="true">${Array.from({ length: cells }, (_, k) => `<i class="${k < full ? 'on' : ''}"></i>`).join('')}</span>`;
  }
  function countKnown(setId) {
    const d = DATA[setId];
    if (!d) return null;
    return { known: d.cases.filter(c => isKnown(setId, c)).length, total: d.cases.length };
  }
  function renderTabs() {
    const list = $('set-tabs');
    list.innerHTML = '';
    for (const s of AlgSets.SETS) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'set-item';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(s.id === view.set));
      const n = countKnown(s.id);
      const name = s.name;
      b.innerHTML = `<span class="set-name"><span class="set-key">${esc(name[0])}</span><span class="set-rest">${esc(name.slice(1))}</span></span>`
        + `<span class="set-count">${n && n.known ? `${n.known}/${n.total}` : n ? String(n.total) : ''}</span>`;
      b.addEventListener('click', () => {
        view.set = s.id; view.group = ''; view.sub = ''; saveView(); setHash(s.id);
        $('alg-search').value = '';
        load(s.id).then(updateSearch, () => { $('case-grid').textContent = caption('algs.loadFailed'); });
        updateSearch();
      });
      li.appendChild(b);
      list.appendChild(li);
    }
  }

  function chipRow(box, items, current, onPick) {
    box.innerHTML = '';
    for (const [value, label] of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'slot-chip';
      b.setAttribute('aria-pressed', String(current === value));
      b.textContent = String(label).replace(/ (Shapes|Case)$/, '');
      b.title = label;
      b.addEventListener('click', () => onPick(value));
      box.appendChild(b);
    }
  }

  function shownCases(d) {
    let out = d.cases.map((c, i) => ({ c, i }));
    if (view.set === 'ols') {
      if (view.olsTier === 'all') out = out.filter(x => !(x.c.tags || []).length && (!view.placement || x.c.group === view.placement));
      else out = out.filter(x => (x.c.tags || []).includes(view.olsTier));
    } else if (view.group) {
      out = out.filter(x => x.c.group === view.group);
      if (view.sub) out = out.filter(x => x.c.sub === view.sub);
    }
    if (view.show === 'learn') out = out.filter(x => !isKnown(view.set, x.c));
    if (view.show === 'known') out = out.filter(x => isKnown(view.set, x.c));
    return out;
  }

  function renderGroups(d) {
    const box = $('group-chips');
    const box2 = $('group-chips-2');
    box2.hidden = true;
    if (view.set === 'ols') {
      chipRow(box, OLS_TIERS, view.olsTier, (v) => {
        view.olsTier = v; saveView();
        if (v === 'all') loadOlsMore().then(() => renderSet());
        renderSet();
      });
      if (view.olsTier === 'all') {
        box2.hidden = false;
        const placements = [...new Set(d.cases.filter(c => !(c.tags || []).length).map(c => c.group))];
        if (!placements.length) { box2.textContent = caption('algs.loading'); return; }
        if (!placements.includes(view.placement)) view.placement = placements[0];
        chipRow(box2, placements.map(g => [g, g.replace(/^F2L /i, '')]), view.placement, (v) => { view.placement = v; saveView(); renderSet(); });
        [...box2.children].forEach((chip, k) => {
          const c = d.cases.find(x => x.group === placements[k]);
          const canvas = document.createElement('canvas');
          canvas.setAttribute('aria-hidden', 'true');
          chip.classList.add('pair-chip');
          chip.title = placements[k].toLowerCase();
          chip.prepend(canvas);
          CaseDiagram.draw(canvas, 'ols', c.state, { line: cssVar('--cube-line'), mask: 'pair' });
        });
      }
      renderSubsetNote();
      return;
    }
    const groups = [...new Set(d.cases.map(c => c.group).filter(Boolean))];
    if (groups.length < 2) { box.innerHTML = ''; renderSubsetNote(); return; }
    if (view.group && !groups.includes(view.group)) view.group = '';
    const whole = d.cases.length <= MAX_WHOLE;
    if (!whole && !view.group) view.group = groups[0];
    chipRow(box, [...(whole ? [['', caption('algs.group.all')]] : []), ...groups.map(g => [g, g])], view.group, (v) => { view.group = v; view.sub = ''; saveView(); renderSet(); });
    if (OLL_GROUPS.has(view.set)) pictureChips(box, groups, g => d.cases.find(x => x.group === g), 'oll', whole ? 1 : 0);
    const subs = view.group ? [...new Set(d.cases.filter(c => c.group === view.group).map(c => c.sub).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true })) : [];
    if (subs.length > 1) {
      if (view.sub && !subs.includes(view.sub)) view.sub = '';
      box2.hidden = false;
      chipRow(box2, [['', caption('algs.group.all')], ...subs.map(g => [g, g])], view.sub, (v) => { view.sub = v; saveView(); renderSet(); });
      pictureChips(box2, subs, g => d.cases.find(x => x.group === view.group && x.sub === g), 'coll', 1);
    } else view.sub = '';
    renderSubsetNote();
  }
  const OLL_GROUPS = new Set(['coll', '1lll']);
  const MAX_WHOLE = 1000; // cases a set may show at once
  function pictureChips(box, values, caseOf, mask, skip = 0) {
    [...box.children].slice(skip).forEach((chip, k) => {
      const c = caseOf(values[k]);
      if (!c) return;
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      chip.classList.add('pair-chip');
      chip.title = values[k].toLowerCase();
      chip.prepend(canvas);
      CaseDiagram.draw(canvas, view.set, c.state, { line: cssVar('--cube-line'), mask });
    });
  }
  function renderSubsetNote() {
    const note = $('subset-note');
    if (!note) return;
    const keys = view.set === 'ols' ? [`algs.subset.ols.${view.olsTier}`] : [`algs.subset.${view.set}`];
    const key = keys.find(k => typeof CAPTIONS !== 'undefined' && CAPTIONS[k]);
    note.textContent = key ? caption(key) : '';
  }

  const drawQueue = new Map();
  const observer = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const job = drawQueue.get(e.target);
      if (job) { job(); drawQueue.delete(e.target); }
      observer.unobserve(e.target);
    }
  }, { rootMargin: '200px' }) : null;
  function resetPictures() {
    if (observer) observer.disconnect();
    drawQueue.clear();
  }
  function picture(canvas, setId, state) {
    const job = () => CaseDiagram.draw(canvas, setId, state, { line: cssVar('--cube-line'), body: cssVar('--field') });
    if (observer) { drawQueue.set(canvas, job); observer.observe(canvas); } else job();
  }

  let paint = null; // { on } while the pointer is down in learn mode
  function tile(setId, i, opts = {}) {
    const d = DATA[setId];
    const c = d.cases[i];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `case-tile${AlgSets.SET_BY_ID[setId].slot ? ' slot' : ''}`;
    b.dataset.set = setId;
    b.dataset.i = String(i);
    const known = isKnown(setId, c);
    b.classList.toggle('known', known);
    b.classList.toggle('has-main', !!mainOf(setId, c));
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'case-name';
    name.textContent = opts.withSet ? AlgSets.caseTitle(d.name, c.name) : c.name;
    const marks = document.createElement('span');
    marks.className = 'marks';
    marks.innerHTML = '<i class="m-known" title="known">✓</i><i class="m-main" title="your main alg">★</i>';
    const nick = (NICKNAMES[setId] || {})[c.name];
    b.append(canvas, name);
    if (nick) b.append(Object.assign(document.createElement('span'), { className: 'case-nick', textContent: nick }));
    b.append(marks);
    b.setAttribute('aria-label', `${name.textContent}${known ? ', known' : ''}`);
    b.addEventListener('click', () => { if (!learnMode) openCase(setId, i); });
    b.addEventListener('pointerdown', (e) => {
      if (!learnMode) return;
      e.preventDefault();
      paint = { on: !isKnown(setId, c) };
      flip(b, setId, c, paint.on);
    });
    b.addEventListener('pointerenter', (e) => {
      if (learnMode && paint && e.buttons) flip(b, setId, c, paint.on);
      else if (!learnMode && e.pointerType === 'mouse') showCard(b, setId, c);
    });
    b.addEventListener('pointerleave', hideCard);
    b.addEventListener('focus', () => { if (!learnMode) showCard(b, setId, c); });
    b.addEventListener('blur', hideCard);
    b.addEventListener('keydown', (e) => { if (learnMode && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); flip(b, setId, c, !isKnown(setId, c)); } });
    picture(canvas, setId, c.state);
    return b;
  }
  function flip(b, setId, c, on) {
    if (isKnown(setId, c) === on) return;
    setKnown(setId, [c], on);
    b.classList.toggle('known', on);
    renderProgress();
    renderTabs();
  }
  document.addEventListener('pointerup', () => { paint = null; });

  function showCard(anchor, setId, c) {
    const card = $('case-card');
    const d = DATA[setId];
    const algs = LastLayer.orderedAlgs(setId, c);
    const a = algs[0];
    if (!a) { card.hidden = true; return; }
    const main = mainOf(setId, c) === a.alg;
    card.innerHTML = `<div class="card-head"><span>${esc(AlgSets.caseTitle(d.name, c.name))}</span>${main ? `<span class="card-tag">${esc(caption('algs.main'))}</span>` : ''}</div>`
      + `<div class="alg">${algHtml(a)}</div>`
      + `<div class="card-meta"><span>${esc(sourcesOf(a))}</span><span>${stm(a.alg)} STM</span></div>`
      + (algs.length > 1 ? `<div class="card-more">${esc(caption('algs.card.more', { n: algs.length - 1 }))}</div>` : '');
    card.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = Math.min(320, window.innerWidth - 24);
    card.style.width = `${w}px`;
    const left = Math.max(12, Math.min(window.innerWidth - w - 12, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 8 + card.offsetHeight < window.innerHeight;
    card.style.left = `${left}px`;
    card.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - card.offsetHeight - 8)}px`;
  }
  function hideCard() { $('case-card').hidden = true; }
  function gridMessage(box, key) { box.innerHTML = `<p class="grid-empty">${esc(caption(key))}</p>`; }

  function renderProgress() {
    const box = $('progress');
    const n = countKnown(view.set);
    box.innerHTML = n ? `${slotsHtml(n.known, n.total, 16)}<span class="count">${esc(caption('algs.progress', { known: n.known, total: n.total }))}</span>` : '';
  }

  function renderSet() {
    const d = DATA[view.set];
    $('match-list').hidden = true;
    const grid = $('case-grid');
    grid.hidden = false;
    $('grid-tools').hidden = false;
    resetPictures();
    hideCard();
    grid.innerHTML = '';
    $('set-name').textContent = AlgSets.SET_BY_ID[view.set].name;
    if (!d) {
      gridMessage(grid, 'algs.loading');
      $('set-title').textContent = '';
      $('group-chips').innerHTML = '';
      return;
    }
    $('set-title').textContent = AlgSets.SET_BY_ID[view.set].title;
    renderGroups(d);
    renderProgress();
    document.querySelectorAll('#grid-tools [data-show]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.show === view.show)));
    const cases = shownCases(d);
    const frag = document.createDocumentFragment();
    // the big sets, shown whole, get a heading per corner case
    const grouped = ['zbll', 'coll', '1lll'].includes(view.set) && !view.group;
    let last = null;
    cases.forEach((x) => {
      const g = grouped ? x.c.sub || x.c.group : null;
      if (g && g !== last) frag.appendChild(Object.assign(document.createElement('h3'), { className: 'grid-group', textContent: g }));
      last = g;
      frag.appendChild(tile(view.set, x.i));
    });
    grid.appendChild(frag);
    if (!cases.length) gridMessage(grid, view.show === 'learn' ? 'algs.allKnown' : view.show === 'known' ? 'algs.noneKnown' : 'algs.loading');
    renderTabs();
  }

  function nameFit(caseWords, words) {
    let exact = 0;
    for (const w of words) {
      if (caseWords.includes(w)) exact++;
      else if (!caseWords.some(x => x.startsWith(w))) return null;
    }
    return exact;
  }

  function searchHead() {
    $('grid-tools').hidden = true;
    $('group-chips').innerHTML = '';
    $('group-chips-2').hidden = true;
    $('subset-note').textContent = '';
    $('set-title').textContent = '';
    $('progress').innerHTML = '';
    $('set-name').textContent = caption('algs.searchTab');
    resetPictures();
    hideCard();
  }

  function renderNameResults(words) {
    const grid = $('case-grid');
    $('match-list').hidden = true;
    grid.hidden = false;
    searchHead();
    grid.innerHTML = '';
    const hits = [];
    SET_IDS.forEach((setId, si) => {
      const d = DATA[setId];
      if (!d) return;
      d.cases.forEach((c, i) => {
        const fit = nameFit(c.words, words);
        if (fit !== null) hits.push({ setId, i, fit, si });
      });
    });
    hits.sort((a, b) => b.fit - a.fit || a.si - b.si || a.i - b.i);
    hits.slice(0, 120).forEach(h => grid.appendChild(tile(h.setId, h.i, { withSet: true })));
    if (!hits.length) gridMessage(grid, 'algs.empty');
  }

  function renderMoveResults(typed) {
    const list = $('match-list');
    $('case-grid').hidden = true;
    searchHead();
    list.hidden = false;
    list.innerHTML = '';
    const shown = matches.slice(0, 40);
    shown.forEach((m, k) => {
      const d = DATA[m.setId];
      const c = d.cases[m.i];
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `match-row${k === activeMatch ? ' active' : ''}`;
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'match-text';
      text.innerHTML = `<span class="case-name">${esc(AlgSets.caseTitle(d.name, c.name))}</span><span class="alg">${algHtml(m.a, typed.done.length)}</span>`;
      row.append(canvas, text);
      row.addEventListener('click', () => openCase(m.setId, m.i, m.a.alg));
      list.appendChild(row);
      picture(canvas, m.setId, c.state);
    });
    if (!shown.length) list.textContent = caption('algs.noMatch');
  }

  function renderNote(typed) {
    const note = $('search-note');
    note.innerHTML = '';
    if (!typed || typed.partial || typed.done.length < 2) return;
    const solved = solvedBy(typed.done);
    if (!solved.length) { note.textContent = caption('algs.note.none'); return; }
    note.append(caption('algs.note.solves') + ' ');
    solved.forEach((s, k) => {
      const d = DATA[s.setId];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link-btn';
      b.textContent = AlgSets.caseTitle(d.name, d.cases[s.i].name);
      b.addEventListener('click', () => openCase(s.setId, s.i));
      if (k) note.append(' · ');
      note.append(b);
    });
  }

  function renderGhost(typed) {
    const input = $('alg-search');
    const shadow = $('search-shadow');
    const text = input.value;
    let ghost = '';
    const m = typed && matches[activeMatch >= 0 ? activeMatch : 0];
    if (m && document.activeElement === input && input.selectionStart === text.length) {
      const rest = m.a.toks.slice(typed.done.length);
      if (typed.partial) ghost = rest[0].slice(typed.partial.length) + (rest.length > 1 ? ` ${rest.slice(1).join(' ')}` : '');
      else ghost = (text && !/\s$/.test(text) ? ' ' : '') + rest.join(' ');
    }
    shadow.innerHTML = text || ghost
      ? `<span class="typed">${esc(text)}</span><span class="ghost">${esc(ghost)}</span>${ghost ? '<span class="ghost-key">tab</span>' : ''}`
      : `<span class="ghost">${esc(caption('algs.search.placeholder'))}</span>`;
  }

  let typedNow = null;
  function updateSearch() {
    const text = $('alg-search').value;
    const typed = parseMoves(text);
    typedNow = typed;
    activeMatch = -1;
    if (typed) {
      matches = moveMatches(typed);
      renderMoveResults(typed);
      renderNote(typed);
    } else {
      matches = [];
      $('search-note').innerHTML = '';
      const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      if (words.length) renderNameResults(words);
      else renderSet();
    }
    renderGhost(typed);
  }

  function acceptGhost() {
    const m = typedNow && matches[activeMatch >= 0 ? activeMatch : 0];
    if (!m) return false;
    const input = $('alg-search');
    input.value = `${m.a.alg} `;
    input.selectionStart = input.selectionEnd = input.value.length;
    updateSearch();
    return true;
  }

  function bindSearch() {
    const input = $('alg-search');
    input.addEventListener('input', updateSearch);
    input.addEventListener('focus', () => renderGhost(typedNow));
    input.addEventListener('blur', () => renderGhost(typedNow));
    for (const ev of ['click', 'keyup', 'select']) input.addEventListener(ev, () => renderGhost(typedNow));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey && typedNow && matches.length) {
        e.preventDefault();
        acceptGhost();
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && matches.length) {
        e.preventDefault();
        const n = Math.min(matches.length, 40);
        activeMatch = e.key === 'ArrowDown' ? (activeMatch + 1) % n : (activeMatch <= 0 ? n - 1 : activeMatch - 1);
        renderMoveResults(typedNow);
        renderGhost(typedNow);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const m = typedNow && matches[activeMatch >= 0 ? activeMatch : 0];
        if (m) openCase(m.setId, m.i, m.a.alg);
        else {
          const first = $('case-grid').querySelector('.case-tile');
          if (first) openCase(first.dataset.set, +first.dataset.i);
        }
      } else if (e.key === 'Escape') {
        input.value = '';
        updateSearch();
      }
    });
  }

  function bindTools() {
    document.querySelectorAll('#grid-tools [data-show]').forEach((b) => {
      b.addEventListener('click', () => { view.show = b.dataset.show; saveView(); renderSet(); });
    });
    const learn = $('learn-mode');
    learn.textContent = caption('algs.learn.button');
    learn.addEventListener('click', () => {
      learnMode = !learnMode;
      learn.setAttribute('aria-pressed', String(learnMode));
      document.body.classList.toggle('learning', learnMode);
      $('learn-hint').hidden = !learnMode;
      $('learn-hint').textContent = caption('algs.learn.hint');
      hideCard();
    });
  }

  let cube = null;
  let player = null;
  let shown = null; // { setId, i, alg }
  function caseCube() {
    if (cube) return cube;
    cube = new PixelCube($('case-cube'), { resolution: profilePref('pixelRes', 'smooth'), backFaces: profilePref('backFaces', true) });
    cube.setTheme({ bg: cssVar('--field') || '#161618', line: cssVar('--cube-line') || '#f1f1ee', clear: true, floorShadow: true, shadow: cssVar('--shadow') || undefined });
    player = new CubePlayer(cube, () => {});
    player.speed = Number(profilePref('animSpeed', 1)) || 1;
    player.animated = Number(profilePref('animSpeed', 1)) > 0;
    return cube;
  }
  function profilePref(key, fallback) {
    const p = profile();
    return p && p.prefs && p.prefs[key] !== undefined ? p.prefs[key] : fallback;
  }

  // Choosing an alg (again) shows the case at once -- never the alg running
  // backwards -- and holds it a moment before the alg plays.
  const CASE_HOLD_MS = 700;
  let holdTimer = 0;
  function showAlg(a, { play = false } = {}) {
    const { setId, i } = shown;
    const c = DATA[setId].cases[i];
    shown.alg = a.alg;
    const start = CaseDiagram.toColours(AlgSets.maskedLabels(setId, AlgSets.toCubie(c.state)));
    const toks = [AlgSets.AUF[a.pre], ...a.toks, AlgSets.AUF[a.post]].filter(Boolean);
    caseCube();
    clearTimeout(holdTimer);
    player.pause();
    player.setSequence(toks, [], 0, start, { instant: true });
    if (play) holdTimer = setTimeout(() => { if (shown && shown.alg === a.alg && $('case-dialog').open) player.play(); }, CASE_HOLD_MS);
    [...$('alg-list').children].forEach(li => li.classList.toggle('active', li.dataset.alg === a.alg));
  }

  function renderCaseAlgs() {
    const { setId, i } = shown;
    const c = DATA[setId].cases[i];
    const list = $('alg-list');
    list.innerHTML = '';
    const main = mainOf(setId, c);
    const known = isKnown(setId, c);
    const kb = $('case-known');
    kb.setAttribute('aria-pressed', String(known));
    kb.textContent = caption(known ? 'algs.known.yes' : 'algs.known.no');
    for (const a of LastLayer.orderedAlgs(setId, c)) {
      const li = document.createElement('li');
      li.className = `alg-move${a.alg === main ? ' main' : ''}`;
      li.dataset.alg = a.alg;
      li.tabIndex = 0;
      li.innerHTML = `<span class="alg">${algHtml(a)}</span><span class="meta"><span class="src" title="${esc(allSources(a))}">${esc(a.alg === main ? caption('algs.main') : sourcesOf(a))}</span><span class="stm">${stm(a.alg)}</span></span>`;
      const tools = document.createElement('span');
      tools.className = 'alg-tools';
      const star = document.createElement('button');
      star.type = 'button';
      star.className = 'btn quiet star';
      star.textContent = '★';
      star.title = caption(a.alg === main ? 'algs.main.clear' : 'algs.main.set');
      star.setAttribute('aria-label', star.title);
      star.setAttribute('aria-pressed', String(a.alg === main));
      star.addEventListener('click', (e) => {
        e.stopPropagation();
        setMain(setId, c, a.alg === main ? null : a.alg);
        renderCaseAlgs();
        showAlg(a);
        renderTabs();
      });
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'btn quiet copy';
      copy.textContent = 'Copy';
      copy.addEventListener('click', async (e) => {
        e.stopPropagation();
        const text = [AlgSets.AUF[a.pre], a.alg, AlgSets.AUF[a.post]].filter(Boolean).join(' ');
        try { await navigator.clipboard.writeText(text); copy.textContent = 'Copied'; } catch (err) { copy.textContent = 'Failed'; }
        setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
      });
      tools.append(star, copy);
      li.appendChild(tools);
      li.addEventListener('click', () => showAlg(a, { play: true }));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showAlg(a, { play: true }); } });
      list.appendChild(li);
    }
  }

  function openCase(setId, i, alg = null) {
    const d = DATA[setId];
    const c = d.cases[i];
    shown = { setId, i, alg };
    hideCard();
    const nick = (NICKNAMES[setId] || {})[c.name];
    $('case-title').textContent = AlgSets.caseTitle(d.name, c.name) + (nick ? ` · ${nick}` : '');
    $('case-sub').textContent = [String(c.group || '').replace(/ (Shapes|Case)$/, ''), c.sub || '', ...(c.tags || []).map(t => t.toUpperCase())].filter((x, k, all) => x && all.indexOf(x) === k).join(' · ');
    renderCaseAlgs();
    const dlg = $('case-dialog');
    if (!dlg.open) dlg.showModal();
    caseCube().resize();
    const algs = LastLayer.orderedAlgs(setId, c);
    showAlg(algs.find(a => a.alg === alg) || algs[0] || c.algs[0]);
    setHash(`${setId}/${slug(c.name)}`);
  }

  const slug = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function setHash(h) {
    try { history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search); } catch (e) { /* file: */ }
  }
  async function openFromHash() {
    const m = /^#([a-z0-9]+)(?:\/(.+))?$/.exec(location.hash || '');
    if (!m || !SET_IDS.includes(m[1])) return;
    view.set = m[1];
    let d = await load(m[1]).catch(() => null);
    if (!d) return;
    const dlg = $('case-dialog');
    if (!m[2]) { renderSet(); if (dlg.open) dlg.close(); return; }
    const want = decodeURIComponent(m[2]);
    let i = d.cases.findIndex(c => slug(c.name) === want);
    if (i < 0 && m[1] === 'ols') { d = await loadOlsMore(); i = d.cases.findIndex(c => slug(c.name) === want); }
    if (i >= 0) {
      const c = d.cases[i];
      if (m[1] === 'ols') { view.olsTier = (c.tags || [])[0] || 'all'; if (view.olsTier === 'all') view.placement = c.group; } else if (view.group && view.group !== c.group) { view.group = ''; view.sub = ''; }
      renderSet();
      openCase(m[1], i);
    } else renderSet();
  }

  function bindDialog() {
    const dlg = $('case-dialog');
    $('case-close').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => {
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
    });
    dlg.addEventListener('close', () => {
      clearTimeout(holdTimer);
      if (player) player.pause();
      setHash(view.set);
      if (!$('alg-search').value) renderSet();
    });
    const stopHold = () => clearTimeout(holdTimer);
    $('case-reset').addEventListener('click', () => { stopHold(); if (player) player.seek(0, false); });
    $('case-back').addEventListener('click', () => { stopHold(); if (player) player.step(-1); });
    $('case-fwd').addEventListener('click', () => { stopHold(); if (player) player.step(1); });
    $('case-play').addEventListener('click', () => {
      stopHold();
      if (!player) return;
      if (!player.playing && player.pos >= player.length && shown) {
        const a = LastLayer.orderedAlgs(shown.setId, DATA[shown.setId].cases[shown.i]).find(x => x.alg === shown.alg);
        if (a) { showAlg(a, { play: true }); return; }
      }
      player.play();
    });
    $('case-known').addEventListener('click', () => {
      if (!shown) return;
      const c = DATA[shown.setId].cases[shown.i];
      setKnown(shown.setId, [c], !isKnown(shown.setId, c));
      renderCaseAlgs();
    });
    let drag = null;
    const stage = $('case-stage');
    stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; stage.setPointerCapture(e.pointerId); });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || !cube) return;
      cube.orbit((e.clientX - drag.x) * 0.01, (e.clientY - drag.y) * 0.01);
      drag = { x: e.clientX, y: e.clientY };
    });
    stage.addEventListener('pointerup', () => { drag = null; });
    stage.addEventListener('dblclick', () => cube && cube.resetView());
  }

  function drawChip() {
    const chip = $('profile-chip');
    const p = profile();
    if (!chip) return;
    if (!p) { chip.hidden = true; return; }
    chip.querySelector('.initial').textContent = (p.name || '?')[0].toUpperCase();
    $('profile-name').textContent = p.name;
  }

  async function start() {
    loadView();
    syncPrefs();
    drawChip();
    renderTabs();
    bindSearch();
    bindTools();
    bindDialog();
    renderGhost(null);
    try {
      await load(view.set);
      if (view.set === 'ols' && view.olsTier === 'all') await loadOlsMore();
    } catch (e) {
      $('case-grid').textContent = caption('algs.loadFailed');
      return;
    }
    updateSearch();
    await openFromHash();
    window.addEventListener('hashchange', openFromHash);
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== $('alg-search') && !$('case-dialog').open) { e.preventDefault(); $('alg-search').focus(); }
    });
    loadAll().then(() => { renderTabs(); if ($('alg-search').value) updateSearch(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
