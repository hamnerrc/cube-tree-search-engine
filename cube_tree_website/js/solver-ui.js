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
const ENGINE_VERSION = '20261006-fatal1';
// The engine worker's JS glue (crossSolver/worker-persistent.js) can change
// without the engine: its own URL parameter, so the prune-table cache
// (keyed by ENGINE_VERSION) stays valid.
const ENGINE_GLUE_VERSION = 'batch1';

// The cache-buster this script was loaded with (solver.html's ?v=...), passed
// on to the post-processing workers so they load the same script versions.
const UI_SCRIPT_QUERY = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src)
  ? new URL(document.currentScript.src).search : '';

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
  // kind: 'busy' (a search is running: progress bar), 'done' or 'error'.
  function setStatus(msg, kind = 'busy') {
    const el = statusEl();
    if (el) el.textContent = msg || '';
    const box = document.getElementById('search-state');
    if (box) box.dataset.state = kind;
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
  // The complete search's engine calls are face turns only and quick (a first
  // step's are all done in ~5 s on a 2-core machine); ranking every spelling
  // of their solutions (post-processing pool, below) is most of a search's
  // time, so the engines get one worker, two from 8 threads up.
  const HARDWARE_THREADS = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  const ENGINE_POOL_SIZE = HARDWARE_THREADS >= 8 ? 2 : 1;

  // Prune-table sharing (PROJECT_STATUS.md §4.40). Every engine worker used
  // to build the same "cross + corner/edge" tables itself (~0.4 s per 4.5 MB
  // table, up to 8 per move list), on every page load. Now a table one worker
  // has built is handed to the others, and kept in IndexedDB (per
  // ENGINE_VERSION), so a later page load starts with the tables in place.
  // A table depends only on its key (the engine checks key and size), so the
  // results are the same. Anything failing here only costs the old rebuild.
  const TABLE_DB = 'cubetree-engine-tables';
  const knownTables = new Set();
  function tableDb() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('no IndexedDB')); return; }
      const req = indexedDB.open(TABLE_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('tables');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function loadStoredTables() {
    try {
      const db = await tableDb();
      const prefix = `${ENGINE_VERSION}|`;
      const tables = await new Promise((resolve, reject) => {
        const out = [];
        const store = db.transaction('tables', 'readwrite').objectStore('tables');
        const req = store.openCursor();
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) { resolve(out); return; }
          if (String(cur.key).startsWith(prefix)) out.push({ key: String(cur.key).slice(prefix.length), data: cur.value });
          else cur.delete(); // another engine version's tables
          cur.continue();
        };
        req.onerror = () => reject(req.error);
      });
      db.close();
      return tables;
    } catch (err) {
      return [];
    }
  }
  async function storeTables(tables) {
    try {
      const db = await tableDb();
      const tx = db.transaction('tables', 'readwrite');
      for (const t of tables) tx.objectStore('tables').put(t.data, `${ENGINE_VERSION}|${t.key}`);
      await new Promise((resolve) => { tx.oncomplete = tx.onerror = tx.onabort = resolve; });
      db.close();
    } catch (err) { /* storage unavailable or full: tables are rebuilt next time */ }
  }
  // After a worker finishes a call: tables it built that the others lack.
  const tableSyncs = new Map();
  function syncTablesFrom(h, pool) {
    if (typeof h.tableKeys !== 'function') return;
    if (tableSyncs.get(h)) { tableSyncs.set(h, 'again'); return; }
    tableSyncs.set(h, 'running');
    (async () => {
      do {
        tableSyncs.set(h, 'running');
        const fresh = (await h.tableKeys()).filter(k => !knownTables.has(k));
        if (!fresh.length) continue;
        for (const k of fresh) knownTables.add(k);
        const tables = await h.getTables(fresh);
        if (!tables.length) continue;
        for (const other of pool) if (other !== h) other.putTables(tables);
        storeTables(tables);
      } while (tableSyncs.get(h) === 'again');
    })().catch(err => console.error('Table sharing failed', err))
      .finally(() => tableSyncs.delete(h));
  }

  // A fresh worker for a pool member whose engine failed, with the stored
  // prune tables (it starts without the ones its predecessor had built).
  async function restartEngine(h) {
    if (!h._restarting) {
      h._restarting = (async () => {
        try {
          console.error('Engine worker failed; restarting it');
          h.terminate();
          await h.init();
          const tables = await loadStoredTables();
          if (tables.length && typeof h.putTables === 'function') await h.putTables(tables);
        } catch (err) {
          console.error('Engine worker restart failed', err);
        } finally {
          h._restarting = null;
        }
      })();
    }
    return h._restarting;
  }

  async function ensureHelper() {
    if (!helper) {
      helper = (async () => {
        const stored = loadStoredTables();
        const started = Array.from({ length: ENGINE_POOL_SIZE }, async () => {
          const h = new CrossSolverHelper(`crossSolver/worker-persistent.js?v=${ENGINE_VERSION}&glue=${ENGINE_GLUE_VERSION}`);
          await h.init();
          return h;
        });
        const settled = await Promise.allSettled(started);
        const pool = settled.filter(r => r.status === 'fulfilled').map(r => r.value);
        if (!pool.length) throw settled[0].reason;
        const tables = await stored;
        if (tables.length && typeof pool[0].putTables === 'function') {
          for (const t of tables) knownTables.add(t.key);
          await Promise.all(pool.map(h => h.putTables(tables)));
        }
        for (const h of pool) {
          for (const m of ['solveCross', 'solveXcross', 'solveXxcross', 'solveXxxcross', 'solveXxxxcross']) {
            const solve = h[m].bind(h);
            // A fatal engine failure (an abort; see worker-persistent.js)
            // replaces the worker before its pool slot is free again, so the
            // next call runs on a working engine; this call still fails.
            h[m] = (...args) => Promise.resolve()
              .then(() => solve(...args))
              .catch(async (err) => {
                if (err && err.fatal) await restartEngine(h);
                throw err;
              })
              .finally(() => syncTablesFrom(h, pool));
          }
        }
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

  // Post-processing workers (PROJECT_STATUS.md §4.40): each engine call's
  // solutions are turned into ranked candidates (luck filter, spellings, TPP)
  // by solver-bridge.js's postProcessCall on a small worker pool instead of
  // the page's main thread, which used to be the bottleneck of root searches
  // and look-ahead. Same function, same output; any worker failure falls back
  // to running that call's post-processing here.
  // Sized to the threads the engine pool leaves (at least two, at most 12;
  // big calls are ranked in chunks side by side). The page's own thread is
  // idle while they rank, and the engines finish in seconds, so no thread is
  // kept back for them (on a 2-thread report, one worker ranked a first step
  // alone: 29 s instead of ~20 s).
  const POST_POOL_SIZE = Math.max(2, Math.min(12, HARDWARE_THREADS - ENGINE_POOL_SIZE));
  let postPool = null;
  function postProcessor() {
    if (postPool === false) return null;
    if (!postPool) {
      try {
        if (typeof Worker === 'undefined') throw new Error('no Worker');
        const jobs = new Map();
        let nextId = 0;
        const workers = Array.from({ length: POST_POOL_SIZE }, () => {
          const w = new Worker(`js/postprocess-worker.js${UI_SCRIPT_QUERY}`);
          w.pending = new Set();
          w.onmessage = (e) => {
            const { id, candidates, error, stopped, report } = e.data;
            const job = jobs.get(id);
            // a live job's kept candidates (solver-bridge.js liveHooks)
            if (report) { if (job && job.live) job.live.report(report); return; }
            if (stopped && candidates) candidates.stopped = true; // the time budget cut it (postProcessCall)
            if (!job) return;
            jobs.delete(id);
            w.pending.delete(id);
            if (job.live) job.live.detach();
            if (error) job.reject(new Error(error)); else job.resolve(candidates);
          };
          w.onerror = (e) => {
            console.error('Post-processing worker failed; using the main thread', e.message || e);
            w.broken = true;
            for (const id of w.pending) { const job = jobs.get(id); jobs.delete(id); if (job) { if (job.live) job.live.detach(); job.reject(new Error('worker failed')); } }
            w.pending.clear();
          };
          return w;
        });
        // Calls wait here, not in a worker's message queue, so the lowest
        // look-ahead rank (the best candidates' follow-ups; the step's own
        // calls have none) is processed first, like the engine calls
        // (search-scheduler.js), and of equal ranks the biggest first. One
        // call per worker: with two, both chunks of a big call could queue
        // behind each other on one worker while another one idles.
        const waiting = [];
        const pump = () => {
          if (!workers.some(w => !w.broken)) {
            while (waiting.length) waiting.shift().reject(new Error('no post-processing worker'));
            return;
          }
          for (;;) {
            const w = workers.find(x => !x.broken && x.pending.size < 1);
            if (!w || !waiting.length) return;
            // a replaced search's jobs (owner.stale) after everyone else's
            let best = 0;
            const stale = x => !!(x.owner && x.owner.stale);
            for (let i = 1; i < waiting.length; i++) {
              const x = waiting[i];
              const b = waiting[best];
              if (stale(x) !== stale(b)) { if (!stale(x)) best = i; continue; }
              const c = compareSearchRanks(x.rank, b.rank);
              if (c < 0 || (c === 0 && x.cores.length > b.cores.length)) best = i;
            }
            const { ctx, job: queued, cores, prepare, live, resolve, reject } = waiting.splice(best, 1)[0];
            // prepare: the caller's last word on the job when it starts
            // (solver-bridge.js: its type's current limits)
            const job = prepare ? prepare(queued) : queued;
            const id = nextId++;
            // window.CUBETREE_TRACE = [] records ranking jobs (dev timing)
            const trace = typeof window !== 'undefined' && Array.isArray(window.CUBETREE_TRACE) ? window.CUBETREE_TRACE : null;
            if (trace) trace.push([performance.now(), 'start', id, job.pairCount, cores.length, job.seedOnly ? 'seed' : '']);
            jobs.set(id, { resolve: trace ? (c) => { trace.push([performance.now(), 'end', id, c ? c.length : 0]); resolve(c); } : resolve, reject, live });
            w.pending.add(id);
            w.postMessage({ id, ctx, job, cores, live: !!live });
            if (live) live.attach((limits) => { if (jobs.has(id)) w.postMessage({ id, limits }); });
          }
        };
        const send = (ctx, job, cores, rank, prepare, owner, live) => new Promise((resolve, reject) => {
          if (!workers.some(w => !w.broken)) { reject(new Error('no post-processing worker')); return; }
          waiting.push({ ctx, job, cores, rank, prepare, resolve, reject, owner, live });
          pump();
        });
        for (const w of workers) {
          const settle = w.onmessage;
          w.onmessage = (e) => { settle(e); pump(); };
          const fail = w.onerror;
          w.onerror = (e) => { fail(e); pump(); };
        }
        const make = (owner) => {
          const f = (ctx, job, cores, rank, prepare, live) => send(ctx, job, cores, rank, prepare, owner, live)
            .catch(() => postProcessCall(ctx, job, cores, { lastYield: performance.now() }));
          f.workers = workers.length; // solver-bridge.js completeChunks
          // the same pool, its jobs tagged with a search job (stale: yields)
          f.forJob = make;
          return f;
        };
        postPool = make(null);
      } catch (err) {
        console.error('Post-processing workers unavailable; using the main thread', err);
        postPool = false;
        return null;
      }
    }
    return postPool;
  }

  function getOrCreateSession(index) {
    if (!sessions.has(index)) {
      const raw = scrambleController.sequenceList[index];
      const scramble = cleanScramble(raw || '');
      const session = new SolveSession(scramble, prunedTree, getCheckedColors(), (criteria && criteria.advanced) || []);
      const post = postProcessor();
      if (post) session.postProcessor = post;
      if (criteria && criteria.searchConfig) session.searchConfig = criteria.searchConfig;
      session._status = 'pending'; // README "Asynchronous background searching": pending|searching|done|error
      sessions.set(index, session);
    }
    return sessions.get(index);
  }

  // The committed solve, one labelled line per step as in pro_references.txt
  // ("alg // label"), with copy and a Cubedb link (solutionLines/cubedbUrl).
  function renderPath(session) {
    const lines = solutionLines(session);
    const list = document.getElementById('solution-steps');
    if (list) {
      list.innerHTML = lines.map((line) => {
        const [alg, label] = line.split(' // ');
        return `<li><span class="step-alg">${escapeHtml(alg)}</span><span class="step-label">${escapeHtml(label || '')}</span></li>`;
      }).join('');
    }
    const empty = document.getElementById('solution-empty');
    if (empty) empty.hidden = lines.length > 0;
    const link = document.getElementById('cubedb-link');
    if (link) link.href = cubedbUrl(session.scramble, lines);
    const copy = document.getElementById('copy-btn');
    if (copy) copy.disabled = !lines.length;
  }

  function bindSolutionActions() {
    const copy = document.getElementById('copy-btn');
    if (!copy) return;
    copy.addEventListener('click', async () => {
      const session = sessions.get(activeIndex);
      if (!session) return;
      const text = [session.scramble, ...solutionLines(session)].join('\n');
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch (err) {
        // No clipboard API (http, old browser): the classic textarea fallback.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
        ta.remove();
      }
      copy.textContent = ok ? 'copied' : 'copy failed';
      clearTimeout(copy._reset);
      copy._reset = setTimeout(() => { copy.textContent = 'copy'; }, 1500);
    });
  }

  function renderUndoButton(session) {
    const btn = document.getElementById('undo-btn');
    if (btn) btn.disabled = !session.canUndo;
  }

  const STATUS_LABELS = { pending: 'queued', searching: 'searching…', done: 'ready', error: 'search failed' };

  const PAGE_TITLE = typeof document !== 'undefined' ? document.title : '';

  function renderScrambleStatus() {
    const el = document.getElementById('scramble-status');
    const session = sessions.get(activeIndex);
    const status = !session ? 'pending' : session.isComplete ? 'done' : (session._status || 'pending');
    if (el) {
      el.textContent = STATUS_LABELS[status] || '';
      el.className = 'scramble-status scramble-status-' + status;
    }
    // Also in the tab title: a search keeps running in a background tab
    // (more slowly: browsers give hidden tabs less CPU), and the tab strip
    // shows when it is done.
    if (typeof document !== 'undefined') {
      const prefix = status === 'searching' ? 'searching… · ' : status === 'error' ? 'failed · ' : '';
      document.title = prefix + PAGE_TITLE;
    }
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
  const view = {
    lookaheadDepth: 1, lookaheadBreadth: 5, multislot: false, wideMoves: true,
    hideUnorthodox: false, simplePseudo: false, planning: true, pageSize: DEFAULT_PAGE_SIZE,
  };
  let currentPage = 0;
  let shownResults = null; // the list on screen (complete or partial)
  // The scramble and step the list on screen belongs to: a click on a row
  // of a list that is no longer current (a step committed or undone, another
  // scramble shown) must not commit it to the wrong node.
  let shownOwner = null;
  function activeStepKey() {
    const s = sessions.get(activeIndex);
    return s ? `${activeIndex}|${s.rotation}|${s.stepAlgs.join(' | ')}` : null;
  }

  function loadViewPrefs(crit) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(VIEW_PREFS_KEY) || 'null'); } catch (err) { saved = null; }
    Object.assign(view, (crit && crit.legacyView) || {}, saved || {});
    view.lookaheadDepth = Math.max(1, Math.min(LOOKAHEAD_MAX_DEPTH, parseInt(view.lookaheadDepth, 10) || 1));
    view.lookaheadBreadth = Math.max(1, Math.min(50, parseInt(view.lookaheadBreadth, 10) || 5));
    view.pageSize = Math.max(1, Math.min(500, parseInt(view.pageSize, 10) || DEFAULT_PAGE_SIZE));
    view.simplePseudo = !!view.simplePseudo;
    view.multislot = !!view.multislot;
    delete view.noR2L2; // a removed option (unorthodox filter replaces it), maybe still saved
    view.wideMoves = view.wideMoves !== false;
    view.hideUnorthodox = !!view.hideUnorthodox;
    view.planning = view.planning !== false;
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
    const multi = document.getElementById('multislot');
    if (multi) multi.checked = view.multislot;
    const wide = document.getElementById('wide-moves');
    if (wide) wide.checked = view.wideMoves;
    const unorthodox = document.getElementById('hide-unorthodox');
    if (unorthodox) unorthodox.checked = view.hideUnorthodox;
    const simple = document.getElementById('simple-pseudo');
    if (simple) simple.checked = view.simplePseudo;
    const planning = document.getElementById('pair-planning');
    if (planning) planning.checked = view.planning;
    const size = document.getElementById('page-size');
    if (size) size.value = view.pageSize;
  }

  function bindViewControls() {
    const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
    const research = () => { saveViewPrefs(); syncViewControls(); currentPage = 0; runSearch(); };
    // Settings that only hide results keep the list on screen until the new
    // one arrives instead of clearing it first.
    const refine = () => { saveViewPrefs(); syncViewControls(); runSearch({ keepRows: true }); };
    on('lookahead-depth', 'change', (e) => { view.lookaheadDepth = parseInt(e.target.value, 10) || 1; research(); });
    on('lookahead-breadth', 'change', (e) => {
      view.lookaheadBreadth = Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 5));
      research();
    });
    on('simple-pseudo', 'change', (e) => { view.simplePseudo = e.target.checked; refine(); });
    on('hide-unorthodox', 'change', (e) => { view.hideUnorthodox = e.target.checked; refine(); });
    on('wide-moves', 'change', (e) => { view.wideMoves = e.target.checked; refine(); });
    on('multislot', 'change', (e) => { view.multislot = e.target.checked; refine(); });
    // Pair planning changes the ranking itself: the step is searched again
    // (or taken from the memo, if it was searched with that setting before).
    on('pair-planning', 'change', (e) => { view.planning = e.target.checked; research(); });
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
  function renderResults(results, emptyText = 'no results yet.') {
    shownResults = results;
    const tbody = document.getElementById('results-body');
    if (!tbody) return;
    const pages = Math.max(1, Math.ceil(results.length / view.pageSize));
    currentPage = Math.max(0, Math.min(currentPage, pages - 1));
    const offset = currentPage * view.pageSize;
    tbody.innerHTML = '';
    if (!results.length) {
      tbody.innerHTML = `<tr class="placeholder-row"><td colspan="9">${escapeHtml(emptyText)}</td></tr>`;
    }
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
      const owner = shownOwner;
      const commit = () => { if (owner && owner === activeStepKey()) handleResultClick(r); };
      tr.addEventListener('click', commit);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); });
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

  // One row of text instead of results (solved, or no list yet). Old rows
  // must never stay clickable once the step they belong to is gone.
  function renderMessageRow(text, cls) {
    shownResults = null;
    shownOwner = null;
    const tbody = document.getElementById('results-body');
    if (tbody) tbody.innerHTML = `<tr class="${cls}"><td colspan="9">${escapeHtml(text)}</td></tr>`;
    const nav = document.getElementById('pagination');
    if (nav) nav.innerHTML = '';
  }

  function renderSolved() {
    renderMessageRow('cross + f2l solved. copy the solution or open it on cubedb above.', 'solved-row');
  }

  const count = (n) => n.toLocaleString('en-US');

  function renderActiveResults(results, partial = false) {
    // dev timing hook (window.CUBETREE_TRACE): the list on screen
    if (typeof window !== 'undefined' && Array.isArray(window.CUBETREE_TRACE)) window.CUBETREE_SHOWN = results;
    shownOwner = activeStepKey();
    renderResults(results, partial ? 'no results yet.' : 'no results at this step with the current settings. try multislot, wide moves, fewer filters, or undo.');
    // The time limit cut some engine calls (or look-ahead searches) short.
    const cut = results.truncatedCalls || results.lookaheadTruncated ? ' · time limit reached, best found shown' : '';
    // Some engine calls failed (the worker is restarted): results are missing.
    const failed = results.failedCalls ? ` · ${results.failedCalls} solver call${results.failedCalls > 1 ? 's' : ''} failed, results incomplete (undo and redo to retry)` : '';
    let msg;
    if (partial && results.lookaheadPending) msg = `${count(results.length)} results · looking ahead (${results.lookaheadPending} left)…`;
    // only hidden multislot calls are left: the rows shown are final
    else if (partial && results.onlyMultislotPending && !view.multislot) msg = `${count(results.length)} results · final (hidden multislots still searching)`;
    else if (partial) msg = `${count(results.length)} results so far · searching…`;
    else msg = results.length ? `${count(results.length)} results` : 'no results for the current filters at this step';
    const hidden = results.hiddenCount ? ` · ${count(results.hiddenCount)} hidden by filters` : '';
    const final = !partial || (results.onlyMultislotPending && !view.multislot && !results.lookaheadPending);
    setStatus(msg + hidden + cut + failed, !final ? 'busy' : results.failedCalls ? 'error' : 'done');
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
  // The results-page filters (they only hide results; look-ahead follows them).
  // Every search includes multislot and wide-move results, so ticking either
  // back shows them at once, like the other filters.
  function resultFilter() {
    const simple = pseudoOn() && view.simplePseudo;
    const orthodox = view.hideUnorthodox;
    const single = !view.multislot;
    const noWide = !view.wideMoves;
    if (!simple && !orthodox && !single && !noWide) return { fn: null, key: '' };
    return {
      fn: r => !(simple && r.fullPseudoOnly) && !(orthodox && r.unorthodox)
        && !(single && r.multislot) && !(noWide && isWideAlg(r.coreAlg)),
      key: [simple ? 'simple' : '', orthodox ? 'orthodox' : '', single ? 'single' : '', noWide ? 'nowide' : ''].join(''),
    };
  }

  function searchOptions(priority) {
    const lookahead = priority === ACTIVE ? view.lookaheadDepth : 1;
    const filter = resultFilter();
    return {
      depth: lookahead,
      breadth: view.lookaheadBreadth,
      filter: filter.fn,
      filterKey: filter.key,
      multislot: true,
      wideMoves: true,
      planning: view.planning,
      lookaheadMultislot: view.multislot,
    };
  }

  function resultsFor(session, h, ph, priority) {
    const opts = searchOptions(priority);
    const key = [session.currentNodeId, session.scoredPath, opts.depth, opts.depth > 1 ? opts.breadth : '', opts.filterKey, opts.planning ? '' : 'noplan'].join('|');
    if (!session.resultsCache || session.resultsCache.key !== key) {
      // the search it replaces (the step before a click, another setting)
      // lets this one's engine calls go first (search-scheduler.js)
      if (session.resultsCache && session.resultsCache.job) scheduler.setStale(session.resultsCache.job);
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
      // Replaced (another setting, a commit or an undo): its look-ahead stops
      // starting new searches, so it does not compete with the new one.
      const isCancelled = () => session.resultsCache !== cache;
      const job = scheduler.submit((wrap) => {
        // its ranking jobs carry it, so they yield once it is replaced (the
        // search forks the session at once, keeping this post-processor)
        if (session.postProcessor && session.postProcessor.forJob) session.postProcessor = session.postProcessor.forJob(job);
        return searchWithLookahead(session, wrap(h), onStatus, wrap(ph), { ...opts, onUpdate, isCancelled });
      }, priority);
      const promise = job.promise;
      cache.job = job;
      cache.promise = promise;
      trackJob(session, job, priority);
      // Only the current search of a session sets its status: a replaced one
      // finishing must not show "ready" while its replacement still runs.
      promise.then(() => {
        cache.live = null;
        if (session.resultsCache !== cache) return;
        session._status = 'done';
        renderScrambleStatusIfActive(session);
      }).catch(() => {
        if (session.resultsCache !== cache) return;
        session._status = 'error';
        renderScrambleStatusIfActive(session);
        session.resultsCache = null;
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

  async function runSearch({ keepRows = false } = {}) {
    if (!prunedTree) return;
    const session = getOrCreateSession(activeIndex);
    const myToken = ++searchToken;
    const keep = keepRows && shownResults && shownOwner === activeStepKey();

    renderPath(session);
    renderUndoButton(session);
    renderScrambleStatus();

    if (session.isComplete) {
      renderSolved();
      setStatus('cross + f2l solved.', 'done');
      return;
    }

    // Until this step's list arrives (at once if it is already known).
    if (!keep) {
      renderMessageRow(session.resultsCache ? 'searching…' : 'starting the search…', 'placeholder-row');
      setStatus('loading solver…');
    }
    let h;
    try {
      h = await ensureHelper();
    } catch (err) {
      setStatus('failed to load the solver: ' + err.message, 'error');
      renderMessageRow('the solver could not be loaded. reload the page to try again.', 'placeholder-row');
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
      if (myToken === searchToken) {
        setStatus('search failed: ' + err.message, 'error');
        renderMessageRow('this search failed. undo, change a setting or reload to try again.', 'placeholder-row');
      }
      return;
    }
    if (myToken !== searchToken) return;

    renderActiveResults(results);
  }

  async function handleResultClick(candidate) {
    const session = getOrCreateSession(activeIndex);
    // Look-ahead annotations describe this step's ranking, not the commit.
    const { lookaheadPending, lookaheadTpp, lookaheadAlgs, lookaheadTruncated, unorthodox, multislot, ...row } = candidate;
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
    bindSolutionActions();

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
