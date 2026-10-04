/**
 * solver-ui.js — DOM glue between solver.html's markup and solver-bridge.js's
 * SolveSession / searchCurrentNode logic.
 *
 * One SolveSession per scramble (per README: "Multiple scrambles are solved
 * independently of one another... results are never merged or compared
 * across different scrambles"), created lazily and cached across scramble
 * navigation so switching back to an earlier scramble keeps its progress.
 */
'use strict';

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
      helper = new CrossSolverHelper();
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
        const h = new PseudoSolverHelper();
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
  let searchQueue = Promise.resolve();
  function resultsFor(session, h, ph) {
    const key = session.currentNodeId + '|' + session.scoredPath;
    if (!session.resultsCache || session.resultsCache.key !== key) {
      const onStatus = (msg) => {
        if (sessions.get(activeIndex) === session) setStatus(msg);
      };
      onStatus('Waiting for the previous search to finish...');
      const promise = searchQueue.then(() => searchCurrentNode(session, h, onStatus, ph));
      searchQueue = promise.catch(() => {});
      session.resultsCache = { key, promise };
      promise.catch(() => {
        if (session.resultsCache && session.resultsCache.promise === promise) session.resultsCache = null;
      });
    }
    return session.resultsCache.promise;
  }

  async function runSearch() {
    if (!prunedTree) return;
    const session = getOrCreateSession(activeIndex);
    const myToken = ++searchToken;

    renderPath(session);

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

    let results;
    try {
      results = await resultsFor(session, h, ph);
    } catch (err) {
      if (myToken === searchToken) setStatus('Search failed: ' + err.message);
      return;
    }
    if (myToken !== searchToken) return;

    renderResults(results);
    setStatus(results.length
      ? (results.length > MAX_ROWS ? `${results.length} result(s); showing the top ${MAX_ROWS}.` : `${results.length} result(s).`)
      : 'No results found for the current filters at this step.');
  }

  async function handleResultClick(candidate) {
    const session = getOrCreateSession(activeIndex);
    session.commit(candidate);
    await runSearch();
  }

  // Hooks called by script.js (see DOMContentLoaded handler and
  // scrambleController.render()).
  window.onPrunedTreeReady = function (tree, crit) {
    prunedTree = tree;
    criteria = crit;
    sessions.clear();
    runSearch();
  };

  window.onActiveScrambleChanged = function (index) {
    activeIndex = index;
    if (prunedTree) runSearch();
  };
})();
