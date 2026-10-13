/**
 * algs-ui.js -- the alg sets page (algs.html; README "Algorithm sets").
 *
 * Every case of OLL, PLL, COLL, ZBLL, OLS and ZBLS with its best algs,
 * ranked by the solver's own step ranking (never shown as a number). One
 * search box does three things:
 * - words find cases by name ("oll 27", "t perm", "sune", "zbll as 3");
 * - moves autocomplete like the solution bar: the algs that start with what
 *   is typed, the best as the ghost (tab takes it, ↑/↓ cycle, enter opens);
 * - a typed alg is recognised: the cases it solves, in every set.
 * A case opens a dialog with the cube (it plays the chosen alg) and its algs.
 */
'use strict';

(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const SET_IDS = AlgSets.SETS.map(s => s.id);
  const DATA_VERSION = '20261015a';
  const VIEW_KEY = 'cubetree_algs_view';
  const DATA = {};      // set id -> data/ll/<set>.json
  const LOADING = {};   // set id -> promise
  const INDEX = {};     // set id -> AlgSets.indexSet
  let view = { set: 'oll', group: '' };
  let matches = [];     // move search results [{ setId, i, a, toks, shown }]
  let activeMatch = -1;
  // familiar names a search also finds
  const ALIASES = {
    oll: { 'OLL 21': 'h double headlights', 'OLL 22': 'pi bruno', 'OLL 23': 'headlights u', 'OLL 24': 't chameleon', 'OLL 25': 'l bowtie', 'OLL 26': 'antisune anti sune', 'OLL 27': 'sune' },
  };

  const storageKey = () => (typeof profileKey === 'function' ? profileKey(VIEW_KEY) : VIEW_KEY);
  function loadView() {
    try { Object.assign(view, JSON.parse(localStorage.getItem(storageKey()) || '{}')); } catch (e) { /* defaults */ }
    if (!SET_IDS.includes(view.set)) view.set = 'oll';
  }
  function saveView() {
    try { localStorage.setItem(storageKey(), JSON.stringify(view)); } catch (e) { /* private mode */ }
  }

  function load(setId) {
    if (DATA[setId]) return Promise.resolve(DATA[setId]);
    if (!LOADING[setId]) {
      LOADING[setId] = fetch(`data/ll/${setId}.json?v=${DATA_VERSION}`)
        .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then((d) => {
          DATA[setId] = d;
          INDEX[setId] = AlgSets.indexSet(setId, d);
          d.cases.forEach((c) => {
            c.words = `${d.name} ${c.name} ${c.group} ${setId === 'pll' ? `${c.name} perm` : ''} ${(ALIASES[setId] || {})[c.name] || ''}`
              .toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
            c.algs.forEach((a) => { a.toks = a.alg.split(' '); });
          });
          return d;
        });
    }
    return LOADING[setId];
  }
  const loadAll = () => Promise.all(SET_IDS.map(id => load(id).catch(() => null)));

  // ---- moves ------------------------------------------------------------------
  const stm = alg => alg.split(' ').filter(t => t && !/^[xyz]/.test(t)).length;
  /** An alg with its AUFs for a case picture: "(U) R U R' (U2)". */
  function algHtml(a, typedCount = 0) {
    const toks = a.alg.split(' ');
    const body = toks.map((t, k) => (k < typedCount ? `<b>${esc(t)}</b>` : esc(t))).join(' ');
    const pre = a.pre ? `<span class="auf">(${AlgSets.AUF[a.pre]})</span> ` : '';
    const post = a.post ? ` <span class="auf">(${AlgSets.AUF[a.post]})</span>` : '';
    return `${pre}${body}${post}`;
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
    // a word like "t" or "h" is a name, not a move
    if (!done.length && /^[a-z]$/.test(partial) && !'rludfbmesxyz'.includes(partial)) return null;
    return { done: done.map(t => (t.length > 2 && t.endsWith("2'") ? t.slice(0, -1) : t)), partial };
  }

  /** Algs (all loaded sets) that start with the typed moves, best first. */
  function moveMatches(typed) {
    const out = [];
    for (const setId of SET_IDS) {
      const d = DATA[setId];
      if (!d) continue;
      d.cases.forEach((c, i) => c.algs.forEach((a, k) => {
        const t = a.toks;
        if (t.length < typed.done.length + (typed.partial ? 1 : 0)) return;
        for (let j = 0; j < typed.done.length; j++) if (t[j] !== typed.done[j]) return;
        if (typed.partial && !t[typed.done.length].startsWith(typed.partial)) return;
        out.push({ setId, i, k, a, score: a.score });
      }));
    }
    out.sort((x, y) => x.score - y.score);
    return out;
  }

  /** The cases a typed alg solves ({ setId, i, hit }), every set. */
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

  // ---- rendering ----------------------------------------------------------------
  function renderTabs() {
    const tabs = $('set-tabs');
    tabs.innerHTML = '';
    for (const s of AlgSets.SETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'px-btn quiet set-tab';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(s.id === view.set));
      b.textContent = s.name.toLowerCase();
      b.addEventListener('click', () => {
        view.set = s.id; view.group = ''; saveView(); setHash(s.id);
        $('alg-search').value = '';
        load(s.id).then(updateSearch, () => { $('case-grid').textContent = caption('algs.loadFailed'); });
        updateSearch();
      });
      tabs.appendChild(b);
    }
  }

  function renderGroups(d) {
    const box = $('group-chips');
    box.innerHTML = '';
    const groups = [...new Set(d.cases.map(c => c.group).filter(Boolean))];
    if (groups.length < 2) return;
    const chip = (label, value) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.setAttribute('aria-pressed', String(view.group === value));
      b.textContent = label.toLowerCase();
      b.addEventListener('click', () => { view.group = value; saveView(); renderSet(); });
      box.appendChild(b);
    };
    chip(caption('algs.group.all'), '');
    groups.forEach(g => chip(g, g));
  }

  // pictures are drawn when their tile scrolls into view
  const drawQueue = new Map();
  const observer = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const job = drawQueue.get(e.target);
      if (job) { job(); drawQueue.delete(e.target); }
      observer.unobserve(e.target);
    }
  }, { rootMargin: '200px' }) : null;
  /** Forgets the pictures of a list about to be replaced. */
  function resetPictures() {
    if (observer) observer.disconnect();
    drawQueue.clear();
  }
  function picture(canvas, setId, state) {
    const job = () => CaseDiagram.draw(canvas, setId, state, { line: cssVar('--line'), body: cssVar('--cube-bg') });
    if (observer) { drawQueue.set(canvas, job); observer.observe(canvas); } else job();
  }

  function tile(setId, i, opts = {}) {
    const d = DATA[setId];
    const c = d.cases[i];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `case-tile${AlgSets.SET_BY_ID[setId].slot ? ' slot' : ''}`;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'case-name';
    name.textContent = opts.withSet ? AlgSets.caseTitle(d.name, c.name) : c.name.toLowerCase();
    const alg = document.createElement('span');
    alg.className = 'alg';
    alg.innerHTML = c.algs[0] ? algHtml(c.algs[0]) : '';
    b.append(canvas, name, alg);
    b.addEventListener('click', () => openCase(setId, i));
    picture(canvas, setId, c.state);
    return b;
  }

  function renderSet() {
    const d = DATA[view.set];
    $('match-list').hidden = true;
    const grid = $('case-grid');
    grid.hidden = false;
    resetPictures();
    grid.innerHTML = '';
    if (!d) { grid.textContent = caption('algs.loading'); return; }
    $('set-title').textContent = d.title;
    renderGroups(d);
    d.cases.forEach((c, i) => { if (!view.group || c.group === view.group) grid.appendChild(tile(view.set, i)); });
    [...$('set-tabs').children].forEach((b, k) => b.setAttribute('aria-selected', String(SET_IDS[k] === view.set)));
  }

  /**
   * How well a case's words fit the query: every query word must start one
   * of them (null otherwise); exact words count more ("oll 2" puts OLL 2
   * before OLL 20-29).
   */
  function nameFit(caseWords, words) {
    let exact = 0;
    for (const w of words) {
      if (caseWords.includes(w)) exact++;
      else if (!caseWords.some(x => x.startsWith(w))) return null;
    }
    return exact;
  }

  function renderNameResults(words) {
    const grid = $('case-grid');
    $('match-list').hidden = true;
    grid.hidden = false;
    resetPictures();
    grid.innerHTML = '';
    $('group-chips').innerHTML = '';
    $('set-title').textContent = '';
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
    if (!hits.length) grid.textContent = caption('algs.empty');
  }

  function renderMoveResults(typed) {
    const list = $('match-list');
    $('case-grid').hidden = true;
    $('group-chips').innerHTML = '';
    $('set-title').textContent = '';
    list.hidden = false;
    resetPictures();
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
      row.addEventListener('click', () => openCase(m.setId, m.i, m.k));
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

  // the search box: its ghost is drawn in a shadow layer behind the transparent input
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
        if (m) openCase(m.setId, m.i, m.k);
        else {
          const first = $('case-grid').querySelector('.case-tile');
          if (first) first.click();
        }
      } else if (e.key === 'Escape') {
        input.value = '';
        updateSearch();
      }
    });
  }

  // ---- the case dialog -------------------------------------------------------------
  let cube = null;
  let player = null;
  let shown = null; // { setId, i, k }
  function caseCube() {
    if (cube) return cube;
    cube = new PixelCube($('case-cube'), { resolution: profilePref('pixelRes', 'chunky'), backFaces: profilePref('backFaces', true) });
    cube.setTheme({ bg: cssVar('--cube-bg') || '#161618', line: cssVar('--line') || '#f1f1ee', clear: true, floorShadow: true });
    player = new CubePlayer(cube, () => {});
    player.speed = Number(profilePref('animSpeed', 1)) || 1;
    return cube;
  }
  function profilePref(key, fallback) {
    const p = typeof cubeProfiles !== 'undefined' && cubeProfiles ? cubeProfiles.active() : null;
    return p && p.prefs && p.prefs[key] !== undefined ? p.prefs[key] : fallback;
  }

  function showAlg(k) {
    const { setId, i } = shown;
    const c = DATA[setId].cases[i];
    const a = c.algs[k];
    shown.k = k;
    const start = CaseDiagram.toColours(AlgSets.maskedLabels(setId, AlgSets.toCubie(c.state)));
    const toks = [AlgSets.AUF[a.pre], ...a.toks, AlgSets.AUF[a.post]].filter(Boolean);
    caseCube().stop();
    player.setSequence(toks, [], 0, start);
    [...$('alg-list').children].forEach((li, j) => li.classList.toggle('active', j === k));
  }

  function openCase(setId, i, k = 0) {
    const d = DATA[setId];
    const c = d.cases[i];
    shown = { setId, i, k };
    $('case-title').textContent = AlgSets.caseTitle(d.name, c.name);
    $('case-sub').textContent = c.group ? c.group.toLowerCase() : '';
    const list = $('alg-list');
    list.innerHTML = '';
    const topVotes = Math.max(0, ...c.algs.filter(a => a.src === 'db').map(a => a.votes || 0));
    const bestDb = c.algs.findIndex(a => a.src === 'db');
    c.algs.forEach((a, j) => {
      const li = document.createElement('li');
      li.className = 'alg-row';
      li.tabIndex = 0;
      const src = a.src === 'db'
        ? (a.votes && a.votes === topVotes ? caption('algs.src.dbTop') : caption('algs.src.db'))
        : (bestDb < 0 || j < bestDb ? caption('algs.src.genNew') : caption('algs.src.gen'));
      li.innerHTML = `<span class="alg">${algHtml(a)}</span><span class="meta">${stm(a.alg)} stm · ${esc(src)}</span>`;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'px-btn quiet copy';
      copy.textContent = 'copy';
      copy.addEventListener('click', async (e) => {
        e.stopPropagation();
        const text = [AlgSets.AUF[a.pre], a.alg, AlgSets.AUF[a.post]].filter(Boolean).join(' ');
        try { await navigator.clipboard.writeText(text); copy.textContent = 'copied'; } catch (err) { copy.textContent = 'copy failed'; }
        setTimeout(() => { copy.textContent = 'copy'; }, 1200);
      });
      li.appendChild(copy);
      li.addEventListener('click', () => { showAlg(j); player.play(); });
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showAlg(j); player.play(); } });
      list.appendChild(li);
    });
    const dlg = $('case-dialog');
    if (!dlg.open) dlg.showModal();
    caseCube().resize();
    showAlg(Math.min(k, c.algs.length - 1));
    setHash(`${setId}/${slug(c.name)}`);
  }

  // deep links: algs.html#<set>/<case> opens a case (names as slugs: "zbll-t-12")
  const slug = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  function setHash(h) {
    try { history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search); } catch (e) { /* file: */ }
  }
  async function openFromHash() {
    const m = /^#([a-z]+)(?:\/(.+))?$/.exec(location.hash || '');
    if (!m || !SET_IDS.includes(m[1])) return;
    view.set = m[1];
    const d = await load(m[1]).catch(() => null);
    if (!d) return;
    renderSet();
    if (!m[2]) return;
    const i = d.cases.findIndex(c => slug(c.name) === decodeURIComponent(m[2]));
    if (i >= 0) openCase(m[1], i);
  }

  function bindDialog() {
    const dlg = $('case-dialog');
    $('case-close').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => {
      const r = dlg.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) dlg.close();
    });
    dlg.addEventListener('close', () => { if (player) player.pause(); setHash(view.set); });
    $('case-reset').addEventListener('click', () => player && player.seek(0, false));
    $('case-back').addEventListener('click', () => player && player.step(-1));
    $('case-fwd').addEventListener('click', () => player && player.step(1));
    $('case-play').addEventListener('click', () => player && player.play());
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
    const p = typeof cubeProfiles !== 'undefined' && cubeProfiles ? cubeProfiles.active() : null;
    if (!chip) return;
    if (!p) { chip.hidden = true; return; }
    drawSearcher(chip.querySelector('canvas'), p.searcher !== undefined ? p.searcher : p.avatar || 0, cssVar('--ink'), cssVar('--bg'));
    $('profile-name').textContent = p.name;
  }

  async function start() {
    loadView();
    drawChip();
    renderTabs();
    bindSearch();
    bindDialog();
    renderGhost(null);
    try {
      await load(view.set);
    } catch (e) {
      $('case-grid').textContent = caption('algs.loadFailed');
      return;
    }
    updateSearch();
    await openFromHash();
    window.addEventListener('hashchange', openFromHash);
    // "/" goes to the search box
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== $('alg-search') && !$('case-dialog').open) { e.preventDefault(); $('alg-search').focus(); }
    });
    // the other sets load behind the scenes: move search and recognition use them all
    loadAll().then(() => { if ($('alg-search').value) updateSearch(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
