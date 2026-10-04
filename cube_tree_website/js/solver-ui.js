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
 */
'use strict';

// Bump whenever crossSolver/ or pseudoCrossSolver/ binaries or workers change:
// the workers forward this query string to solver.js/pseudo.js and to the
// .wasm files, so a browser can never keep running a cached older engine
// (which would silently lack e.g. setNoopMoves; PROJECT_STATUS.md §4.27).
const ENGINE_VERSION = '20261004-noop1';

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

  async function ensureHelper() {
    if (!helper) {
      helper = new CrossSolverHelper(`crossSolver/worker-persistent.js?v=${ENGINE_VERSION}`);
      await helper.init();
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
        const h = new PseudoSolverHelper(`pseudoCrossSolver/worker3.js?v=${ENGINE_VERSION}`);
        await h.init();
        pseudoHelper = h;
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

  // Rendering tens of thousands of rows freezes the page; the ranking still
  // runs over every result, only the table is capped.
  const MAX_ROWS = 500;

  function renderResults(results) {
    const tbody = document.getElementById('results-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    results.slice(0, MAX_ROWS).forEach((r, i) => {
      const tr = document.createElement('tr');
      const cells = [
        String(i + 1),
        r.color || '-',
        r.type,
        r.rotation || '-',
        (r.edges || []).join('+') || '-',
        (r.corners || []).join('+') || '-',
        r.coreAlg,
      ];
      tr.innerHTML = cells.map(c => `<td>${escapeHtml(c)}</td>`).join('');
      tr.style.cursor = 'pointer';
      tr.addEventListener('click', () => handleResultClick(r));
      tbody.appendChild(tr);
    });
  }

  function renderSolved() {
    const tbody = document.getElementById('results-body');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7">Cross + F2L solved.</td></tr>';
  }

  function renderActiveResults(results) {
    renderResults(results);
    setStatus(results.length
      ? (results.length > MAX_ROWS ? `${results.length} result(s); showing the top ${MAX_ROWS}.` : `${results.length} result(s).`)
      : 'No results found for the current filters at this step.');
  }

  // One search per (session, committed path): navigating away from a scramble
  // mid-search no longer throws the work away, and coming back to an
  // already-searched node (or one still searching) reuses it instead of
  // starting again. The path only grows by commits, so node + path text
  // identifies the step.
  //
  // Searches are also serialised: the solver helpers reject a second call
  // while one is running ("Another solve is in progress"), which used to make
  // every solver call of a search started mid-way through another one fail,
  // leaving that scramble with "No results" (found 2026-10-04, §4.18).
  // README "Asynchronous background searching" builds on exactly this queue:
  // every scramble's search gets enqueued onto it up front (see
  // scheduleBackgroundSearches), so it runs to completion in the background
  // regardless of which scramble is active when it finishes.
  let searchQueue = Promise.resolve();
  function resultsFor(session, h, ph) {
    const key = session.currentNodeId + '|' + session.scoredPath;
    if (!session.resultsCache || session.resultsCache.key !== key) {
      session._status = 'searching';
      renderScrambleStatusIfActive(session);
      const onStatus = (msg) => {
        if (sessions.get(activeIndex) === session) setStatus(msg);
      };
      onStatus('Waiting for the previous search to finish...');
      const promise = searchQueue.then(() => searchCurrentNode(session, h, onStatus, ph));
      searchQueue = promise.catch(() => {});
      session.resultsCache = { key, promise };
      promise.then(() => {
        session._status = 'done';
        renderScrambleStatusIfActive(session);
      }).catch(() => {
        session._status = 'error';
        renderScrambleStatusIfActive(session);
        if (session.resultsCache && session.resultsCache.promise === promise) session.resultsCache = null;
      });
    }
    return session.resultsCache.promise;
  }

  // Enqueues every OTHER scramble's search right behind the active one
  // (already enqueued by runSearch before this is called), so they all run
  // to completion in the background -- not awaited here; each one's own
  // .then() re-renders only if that scramble happens to be active by the
  // time it resolves.
  function scheduleBackgroundSearches(h, ph) {
    scrambleController.sequenceList.forEach((_, idx) => {
      if (idx === activeIndex) return; // runSearch already enqueued this one
      const session = getOrCreateSession(idx);
      if (session.isComplete) return;
      resultsFor(session, h, ph)
        .then((results) => {
          if (sessions.get(activeIndex) === session) renderActiveResults(results);
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
      setStatus('Solved.');
      return;
    }

    setStatus('Loading solver...');
    let h;
    try {
      h = await ensureHelper();
    } catch (err) {
      setStatus('Failed to load solver: ' + err.message);
      return;
    }
    if (myToken !== searchToken) return;

    const ph = await ensurePseudoHelper();
    if (myToken !== searchToken) return;

    const activePromise = resultsFor(session, h, ph);
    scheduleBackgroundSearches(h, ph);

    let results;
    try {
      results = await activePromise;
    } catch (err) {
      if (myToken === searchToken) setStatus('Search failed: ' + err.message);
      return;
    }
    if (myToken !== searchToken) return;

    renderActiveResults(results);
  }

  async function handleResultClick(candidate) {
    const session = getOrCreateSession(activeIndex);
    session.commit(candidate);
    persistSessionState();
    await runSearch();
  }

  async function handleUndo() {
    const session = getOrCreateSession(activeIndex);
    if (!session.undo()) return;
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
    activeIndex = index;
    if (prunedTree) {
      persistSessionState();
      runSearch();
    }
  };
})();
