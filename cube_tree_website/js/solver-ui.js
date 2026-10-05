/**
 * solver-ui.js — DOM glue between solver.html's markup and solver-bridge.js's
 * SolveSession / searchCurrentNode logic.
 *
 * One SolveSession per scramble (per README: "Multiple scrambles are solved
 * independently of one another... results are never merged or compared
 * across different scrambles"), created lazily and cached across scramble
 * navigation so switching back to an earlier scramble keeps its progress.
 *
 * README "Asynchronous background searching": every scramble's search is
 * enqueued as soon as the pruned tree is ready (scheduleBackgroundSearches),
 * not only when it becomes active -- switching scrambles never blocks on or
 * restarts a search, it just displays whatever that session's cached
 * promise resolves to, whenever it resolves. README "State persistence on
 * reload": committed progress for every scramble is written to
 * localStorage (SESSION_STATE_KEY) after every commit/undo/switch and
 * replayed back through the same SolveSession.commit() a click would use.
 *
 * Searches run through a priority scheduler (search-scheduler.js): the
 * scramble on screen -- e.g. the search started by committing a result --
 * jumps ahead of every background scramble, and switching scrambles promotes
 * the new one and demotes the old. With a look-ahead depth > 1 (README
 * "Look-ahead optimisation depth") each search re-ranks its top candidates
 * by the combined TPP of the best follow-up steps (searchWithLookahead).
 */
'use strict';

// Bump whenever crossSolver/ or pseudoCrossSolver/ binaries or workers change:
// the workers forward this query string to solver.js/pseudo.js and to the
// .wasm files, so a browser can never keep running a cached older engine
// (which would silently lack e.g. setNoopMoves; PROJECT_STATUS.md §4.27).
const ENGINE_VERSION = '20261005-deadline1';

// SESSION_STATE_KEY is declared once, in script.js (loaded before this file
// on solver.html, and needed standalone by index.html's clearScrambleData)
// -- plain <script> tags share one global scope, so redeclaring it here
// would break page load (see test/browser-globals.test.js).

(function () {
  let helper = null;
  let pseudoHelper = null;
  let prunedTree = null;
  let criteria = null;
  const sessions = new Map(); // scrambleIndex -> SolveSession
  let activeIndex = 0;
  let searchToken = 0; // bumped on every navigation/click to discard stale async results

  function statusEl() { return document.getElementById('search-status'); }
  function setStatus(msg) {
    const el = statusEl();
    if (el) el.textContent = msg || '';
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function getCheckedColors() {
    const colors = criteria && criteria.colors;
    return (colors && colors.length) ? colors : ['white'];
  }

  // A pool of engine workers (PROJECT_STATUS.md §4.34): each search starts all
  // of its solver calls at once and the scheduler runs one per worker, so the
  // calls of a search (one per DAG edge and colour) run in parallel. One core
  // is left for the page itself; each worker holds its own tables (~100 MB).
  const ENGINE_POOL_SIZE = Math.max(1, Math.min(4, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) - 1));

  async function ensureHelper() {
    if (!helper) {
      helper = (async () => {
        const started = Array.from({ length: ENGINE_POOL_SIZE }, async () => {
          const h = new CrossSolverHelper(`crossSolver/worker-persistent.js?v=${ENGINE_VERSION}`);
          await h.init();
          return h;
        });
        const settled = await Promise.allSettled(started);
        const pool = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
        if (!pool.length) throw settled[0].reason;
        return pool;
      })();
      helper.catch(() => { helper = null; });
    }
    return helper;
  }

  // The pseudo engine is only needed when the pruned tree actually contains
  // pseudo (mismatched) nodes, i.e. the "full pseudo" option is on. A load
  // failure degrades to matched-only search rather than breaking the page.
  async function ensurePseudoHelper() {
    const needed = prunedTree && typeof isPseudoState === 'function'
      && prunedTree.nodes.some(n => isPseudoState(n.state));
    if (!needed || typeof PseudoSolverHelper === 'undefined') return null;
    if (!pseudoHelper) {
      try {
        // A pool like the matched engine's (§4.36): with full pseudo on, most
        // of a root search's calls are pseudo ones (48 of 63 per colour).
        const started = Array.from({ length: ENGINE_POOL_SIZE }, async () => {
          const h = new PseudoSolverHelper(`pseudoCrossSolver/worker3.js?v=${ENGINE_VERSION}`);
          await h.init();
          return h;
        });
        const settled = await Promise.allSettled(started);
        const pool = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
        if (!pool.length) throw settled[0].reason;
        pseudoHelper = pool;
      } catch (err) {
        console.error('Failed to load pseudo solver; pseudo results disabled', err);
        return null;
      }
    }
    return pseudoHelper;
  }

  function getOrCreateSession(index) {
    if (!sessions.has(index)) {
      const raw = scrambleController.sequenceList[index];
      const scramble = cleanScramble(raw || '');
      const session = new SolveSession(scramble, prunedTree, getCheckedColors(), (criteria && criteria.advanced) || []);
      if (criteria && criteria.maxSolutions > 0) session.maxSolutions = criteria.maxSolutions;
      if (criteria && criteria.searchConfig) session.searchConfig = criteria.searchConfig;
      // README "Performance goal": each step's search stops after the time
      // limit (default 60 s; 0 = none) and shows what it found (§4.36).
      const limit = criteria && Number.isFinite(criteria.timeLimit) ? criteria.timeLimit : 60;
      session.timeBudgetMs = limit * 1000;
      session._status = 'pending'; // README "Asynchronous background searching": pending|searching|done|error
      sessions.set(index, session);
    }
    return sessions.get(index);
  }

  function renderPath(session) {
    const ta = document.getElementById('solution-output');
    if (!ta) return;
    const parts = session.committedRows.map(r => r.coreAlg);
    ta.value = session.rotation ? `[${session.rotation}]  ` + parts.join(' ') : parts.join(' ');
  }

  function renderUndoButton(session) {
    const btn = document.getElementById('undo-btn');
    if (btn) btn.disabled = !session.canUndo;
  }

  const STATUS_LABELS = { pending: 'queued', searching: 'searching…', done: 'ready', error: 'search failed' };

  function renderScrambleStatus() {
    const el = document.getElementById('scramble-status');
    if (!el) return;
    const session = sessions.get(activeIndex);
    const status = !session ? 'pending' : session.isComplete ? 'done' : (session._status || 'pending');
    el.textContent = STATUS_LABELS[status] || '';
    el.className = 'scramble-status scramble-status-' + status;
  }

  function renderScrambleStatusIfActive(session) {
    if (sessions.get(activeIndex) === session) renderScrambleStatus();
  }

  // ---------------------------------------------------------------------
  // Results-page view settings (look-ahead per step, simple-pseudo filter,
  // page size), remembered per browser. Changing look-ahead or the filter
  // re-searches the current step; the depth-1 search behind it is reused.
  // ---------------------------------------------------------------------
  const DEFAULT_PAGE_SIZE = 25;
  const view = { lookaheadDepth: 1, lookaheadBreadth: 5, simplePseudo: false, pageSize: DEFAULT_PAGE_SIZE };
  let currentPage = 0;
  let shownResults = null; // the list on screen (complete or partial)

  function loadViewPrefs(crit) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(VIEW_PREFS_KEY) || 'null'); } catch (err) { saved = null; }
    Object.assign(view, (crit && crit.legacyView) || {}, saved || {});
    view.lookaheadDepth = Math.max(1, Math.min(5, parseInt(view.lookaheadDepth, 10) || 1));
    view.lookaheadBreadth = Math.max(1, Math.min(50, parseInt(view.lookaheadBreadth, 10) || 5));
    view.pageSize = Math.max(1, Math.min(500, parseInt(view.pageSize, 10) || DEFAULT_PAGE_SIZE));
    view.simplePseudo = !!view.simplePseudo;
  }

  function saveViewPrefs() {
    try { localStorage.setItem(VIEW_PREFS_KEY, JSON.stringify(view)); } catch (err) { /* private mode: not remembered */ }
  }

  const pseudoOn = () => !!(criteria && (criteria.advanced || []).includes('full_pseudo'));

  function syncViewControls() {
    const depth = document.getElementById('lookahead-depth');
    if (depth) depth.value = String(view.lookaheadDepth);
    const breadth = document.getElementById('lookahead-breadth');
    if (breadth) {
      breadth.value = view.lookaheadBreadth;
      breadth.disabled = view.lookaheadDepth <= 1;
    }
    const slow = document.getElementById('lookahead-slow');
    if (slow) slow.hidden = view.lookaheadDepth < 3;
    const wrap = document.getElementById('simple-pseudo-wrap');
    if (wrap) wrap.hidden = !pseudoOn();
    const simple = document.getElementById('simple-pseudo');
    if (simple) simple.checked = view.simplePseudo;
    const size = document.getElementById('page-size');
    if (size) size.value = view.pageSize;
  }

  function bindViewControls() {
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    const research = () => { saveViewPrefs(); syncViewControls(); currentPage = 0; runSearch(); };
    on('lookahead-depth', 'change', (e) => { view.lookaheadDepth = parseInt(e.target.value, 10) || 1; research(); });
    on('lookahead-breadth', 'change', (e) => {
      view.lookaheadBreadth = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 5));
      research();
    });
    on('simple-pseudo', 'change', (e) => { view.simplePseudo = e.target.checked; research(); });
    on('page-size', 'change', (e) => {
      view.pageSize = Math.max(1, Math.min(500, parseInt(e.target.value, 10) || DEFAULT_PAGE_SIZE));
      saveViewPrefs();
      syncViewControls();
      currentPage = 0;
      if (shownResults) renderResults(shownResults);
    });
  }

  const formatTpp = (tpp) => (Number.isFinite(tpp) ? tpp.toFixed(2) : '-');
  const COLUMNS = ['#', 'colour', 'type', 'rotation', 'edges', 'corners', 'alg', 'tpp', 'look-ahead'];

  function lookaheadCell(r) {
    if (r.lookaheadPending) return '…';
    if (!r.lookaheadAlgs) return '-';
    return `${formatTpp(r.lookaheadTpp)}${r.lookaheadAlgs.length ? '  → ' + r.lookaheadAlgs.join(' | ') : ''}`;
  }

  // Only one page of rows is rendered; ranking still covers every result.
  function renderResults(results) {
    shownResults = results;
    const tbody = document.getElementById('results-body');
    if (!tbody) return;
    const pages = Math.max(1, Math.ceil(results.length / view.pageSize));
    currentPage = Math.max(0, Math.min(currentPage, pages - 1));
    const offset = currentPage * view.pageSize;
    tbody.innerHTML = '';
    results.slice(offset, offset + view.pageSize).forEach((r, i) => {
      const cells = [
        String(offset + i + 1),
        r.color || '-',
        String(r.type || '').toLowerCase(),
        r.rotation || '-',
        (r.edges || []).join('+') || '-',
        (r.corners || []).join('+') || '-',
        r.coreAlg,
        formatTpp(r.tpp),
        lookaheadCell(r),
      ];
      const tr = document.createElement('tr');
      tr.tabIndex = 0;
      tr.innerHTML = cells.map((c, k) => `<td data-label="${COLUMNS[k]}" class="col-${k}${c === '-' ? ' empty' : ''}">${escapeHtml(c)}</td>`).join('');
      tr.addEventListener('click', () => handleResultClick(r));
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleResultClick(r); });
      tbody.appendChild(tr);
    });
    renderPagination(results.length, pages);
  }

  function renderPagination(total, pages) {
    const nav = document.getElementById('pagination');
    if (!nav) return;
    nav.innerHTML = '';
    if (pages <= 1) return;
    const button = (label, page, aria) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('aria-label', aria);
      b.disabled = page < 0 || page >= pages || page === currentPage;
      b.addEventListener('click', () => { currentPage = page; renderResults(shownResults); });
      return b;
    };
    const info = document.createElement('span');
    info.className = 'page-info';
    info.textContent = `${currentPage + 1} / ${pages}`;
    nav.append(
      button('«', 0, 'first page'),
      button('‹', currentPage - 1, 'previous page'),
      info,
      button('›', currentPage + 1, 'next page'),
      button('»', pages - 1, 'last page'),
    );
  }

  function renderSolved() {
    shownResults = null;
    const tbody = document.getElementById('results-body');
    if (tbody) tbody.innerHTML = '<tr class="solved-row"><td colspan="9">cross + f2l solved.</td></tr>';
    const nav = document.getElementById('pagination');
    if (nav) nav.innerHTML = '';
  }

  const count = (n) => n.toLocaleString('en-US');

  function renderActiveResults(results, partial = false) {
    renderResults(results);
    // The time limit cut some engine calls (or look-ahead searches) short.
    const cut = results.truncatedCalls || results.lookaheadTruncated ? ' · time limit reached, best found shown' : '';
    let msg;
    if (partial && results.lookaheadPending) msg = `${count(results.length)} results · looking ahead (${results.lookaheadPending} left)…`;
    else if (partial) msg = `${count(results.length)} results so far · searching…`;
    else msg = results.length ? `${count(results.length)} results` : 'no results for the current filters at this step';
    setStatus(msg + cut);
  }

  // One search per (session, committed path, view settings): navigating away
  // from a scramble mid-search no longer throws the work away, and coming
  // back to an already-searched node (or one still searching) reuses it
  // instead of starting again. The path only grows by commits, so node +
  // path text identifies the step.
  //
  // The solver helpers reject a second call while one is running ("Another
  // solve is in progress", §4.18), so every engine call goes through one
  // scheduler. Background scrambles run one at a time; the active scramble's
  // search starts at once and pre-empts them at their next engine call
  // (README "Multi-scramble queueing"; PROJECT_STATUS.md §4.30).
  const scheduler = createSearchScheduler();
  const { ACTIVE, BACKGROUND } = SEARCH_PRIORITY;

  // Background scrambles search one step without look-ahead; the scramble
  // on screen uses the results page's look-ahead setting (reusing that
  // single-step search when it becomes active).
  function searchOptions(priority) {
    const lookahead = priority === ACTIVE ? view.lookaheadDepth : 1;
    return {
      depth: lookahead,
      breadth: view.lookaheadBreadth,
      filter: pseudoOn() && view.simplePseudo ? (r => !r.fullPseudoOnly) : null,
    };
  }

  function resultsFor(session, h, ph, priority) {
    const opts = searchOptions(priority);
    const key = [session.currentNodeId, session.scoredPath, opts.depth, opts.depth > 1 ? opts.breadth : '', opts.filter ? 'simple' : ''].join('|');
    if (!session.resultsCache || session.resultsCache.key !== key) {
      session._status = 'searching';
      renderScrambleStatusIfActive(session);
      // Set before the job starts: a search the memo already has running
      // reports its latest partial list synchronously.
      const cache = { key, live: null };
      session.resultsCache = cache;
      const isShown = () => sessions.get(activeIndex) === session && session.resultsCache === cache;
      const onStatus = (msg) => {
        if (isShown() && !cache.live) setStatus(msg);
      };
      onStatus(priority === ACTIVE ? 'searching…' : 'queued behind the active search…');
      // Progressive results: partial lists while the step's calls finish,
      // then look-ahead re-ranking as each candidate's look-ahead finishes.
      const onUpdate = (list) => {
        if (session.resultsCache !== cache) return;
        cache.live = list;
        if (isShown()) renderActiveResults(list, true);
      };
      const job = scheduler.submit(
        (wrap) => searchWithLookahead(session, wrap(h), onStatus, wrap(ph), { ...opts, onUpdate }),
        priority,
      );
      const promise = job.promise;
      cache.job = job;
      cache.promise = promise;
      trackJob(session, job, priority);
      promise.then(() => {
        cache.live = null;
        session._status = 'done';
        renderScrambleStatusIfActive(session);
      }).catch(() => {
        session._status = 'error';
        renderScrambleStatusIfActive(session);
        if (session.resultsCache && session.resultsCache.promise === promise) session.resultsCache = null;
      });
    } else {
      setJobsPriority(session, priority);
      if (session.resultsCache.live && sessions.get(activeIndex) === session) renderActiveResults(session.resultsCache.live, true);
    }
    return session.resultsCache.promise;
  }

  // Every unfinished job of a scramble runs at that scramble's priority: its
  // searches share one memo, so a new job (another look-ahead setting, the
  // next step) can be waiting on engine calls an older job started, and an
  // ACTIVE job waiting on BACKGROUND calls would never let them run.
  function trackJob(session, job, priority) {
    if (!session._jobs) session._jobs = new Set();
    session._jobs.add(job);
    const done = () => session._jobs.delete(job);
    job.promise.then(done, done);
    setJobsPriority(session, priority);
  }

  function setJobsPriority(session, priority) {
    for (const job of session._jobs || []) scheduler.setPriority(job, priority);
  }

  // The scramble the user is looking at always outranks the background.
  function setSessionPriority(index, priority) {
    const session = sessions.get(index);
    if (session) setJobsPriority(session, priority);
  }

  // Enqueues every OTHER scramble's search as BACKGROUND work -- not awaited
  // here; each one's own .then() re-renders only if that scramble happens to
  // be active by the time it resolves.
  function scheduleBackgroundSearches(h, ph) {
    scrambleController.sequenceList.forEach((_, idx) => {
      if (idx === activeIndex) return; // runSearch already enqueued this one
      const session = getOrCreateSession(idx);
      if (session.isComplete) return;
      if (session.resultsCache) return; // already queued/searched; keep its current priority
      const promise = resultsFor(session, h, ph, BACKGROUND);
      promise
        .then((results) => {
          if (sessions.get(activeIndex) === session && session.resultsCache && session.resultsCache.promise === promise) renderActiveResults(results);
        })
        .catch(() => {});
    });
  }

  async function runSearch() {
    if (!prunedTree) return;
    const session = getOrCreateSession(activeIndex);
    const myToken = ++searchToken;

    renderPath(session);
    renderUndoButton(session);
    renderScrambleStatus();

    if (session.isComplete) {
      renderSolved();
      setStatus('solved.');
      return;
    }

    setStatus('loading solver…');
    let h;
    try {
      h = await ensureHelper();
    } catch (err) {
      setStatus('failed to load the solver: ' + err.message);
      return;
    }
    if (myToken !== searchToken) return;

    const ph = await ensurePseudoHelper();
    if (myToken !== searchToken) return;

    const activePromise = resultsFor(session, h, ph, ACTIVE);
    scheduleBackgroundSearches(h, ph);

    let results;
    try {
      results = await activePromise;
    } catch (err) {
      if (myToken === searchToken) setStatus('search failed: ' + err.message);
      return;
    }
    if (myToken !== searchToken) return;

    renderActiveResults(results);
  }

  async function handleResultClick(candidate) {
    const session = getOrCreateSession(activeIndex);
    // Look-ahead annotations describe this step's ranking, not the commit.
    const { lookaheadPending, lookaheadTpp, lookaheadAlgs, lookaheadTruncated, ...row } = candidate;
    session.commit(row);
    currentPage = 0;
    persistSessionState();
    await runSearch();
  }

  async function handleUndo() {
    const session = getOrCreateSession(activeIndex);
    if (!session.undo()) return;
    currentPage = 0;
    persistSessionState();
    await runSearch();
  }
  window.handleUndoClick = handleUndo;

  // ---------------------------------------------------------------------
  // README "State persistence on reload"
  // ---------------------------------------------------------------------

  function sameList(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  }

  function persistSessionState() {
    try {
      const sessionsOut = {};
      for (const [idx, session] of sessions.entries()) {
        if (session.committedRows.length) sessionsOut[idx] = session.committedRows;
      }
      localStorage.setItem(SESSION_STATE_KEY, JSON.stringify({
        scrambles: criteria ? criteria.scrambles : [],
        colors: criteria ? criteria.colors : [],
        advanced: criteria ? criteria.advanced : [],
        activeIndex,
        sessions: sessionsOut,
      }));
    } catch (err) {
      console.error('Failed to persist session state', err);
    }
  }

  // A saved blob is only trusted when it matches the CURRENT search
  // criteria exactly -- a reload after starting a different scramble list
  // (or changing colors/advanced options) must not replay stale progress
  // onto a tree it wasn't computed against.
  function loadPersistedState(crit) {
    let raw;
    try {
      raw = localStorage.getItem(SESSION_STATE_KEY);
    } catch (err) {
      return null;
    }
    if (!raw) return null;
    let saved;
    try {
      saved = JSON.parse(raw);
    } catch (err) {
      return null;
    }
    if (!crit || !sameList(saved.scrambles, crit.scrambles)
      || !sameList(saved.colors, crit.colors) || !sameList(saved.advanced, crit.advanced)) {
      return null;
    }
    return saved;
  }

  // Replays each scramble's committed rows through the same commit() a click
  // would use, so rehydrated state goes through the exact tested mutation
  // path rather than reconstructing fields by hand.
  function rehydrateSessions(saved) {
    for (const [idxStr, rows] of Object.entries(saved.sessions || {})) {
      const idx = Number(idxStr);
      if (!Number.isInteger(idx) || idx < 0 || idx >= scrambleController.sequenceList.length) continue;
      const session = getOrCreateSession(idx);
      for (const row of rows) session.commit(row);
    }
  }

  function clampIndex(idx, length) {
    if (!Number.isInteger(idx) || !length) return 0;
    return Math.max(0, Math.min(idx, length - 1));
  }

  // Hooks called by script.js (see DOMContentLoaded handler and
  // scrambleController.render()).
  window.onPrunedTreeReady = function (tree, crit) {
    prunedTree = tree;
    criteria = crit;
    sessions.clear();
    loadViewPrefs(crit);
    syncViewControls();
    bindViewControls();

    const saved = loadPersistedState(crit);
    if (saved) {
      rehydrateSessions(saved);
      scrambleController.activeIndex = clampIndex(saved.activeIndex, scrambleController.sequenceList.length);
    }

    // scrambleController.render() fires onActiveScrambleChanged below, which
    // sets activeIndex and runs the search now that prunedTree is set --
    // this keeps the restored nav UI and the active session in sync in one
    // path, whether or not there was anything to rehydrate.
    scrambleController.render();
  };

  window.onActiveScrambleChanged = function (index) {
    if (index !== activeIndex) {
      setSessionPriority(activeIndex, BACKGROUND);
      currentPage = 0;
    }
    activeIndex = index;
    if (prunedTree) {
      persistSessionState();
      runSearch();
    }
  };
})();
