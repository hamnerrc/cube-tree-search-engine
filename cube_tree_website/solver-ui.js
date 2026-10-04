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
      sessions.set(index, new SolveSession(scramble, prunedTree, getCheckedColors(), (criteria && criteria.advanced) || []));
    }
    return sessions.get(index);
  }

  function renderPath(session) {
    const ta = document.getElementById('solution-output');
    if (!ta) return;
    const parts = session.committedRows.map(r => r.coreAlg);
    ta.value = session.rotation ? `[${session.rotation}]  ` + parts.join(' ') : parts.join(' ');
  }

  function renderResults(results) {
    const tbody = document.getElementById('results-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    results.forEach((r, i) => {
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

    const results = await searchCurrentNode(session, h, (msg) => {
      if (myToken === searchToken) setStatus(msg);
    }, ph);
    if (myToken !== searchToken) return;

    renderResults(results);
    setStatus(results.length
      ? `${results.length} result(s).`
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
