/**
 * solver-ui.js — DOM glue between solver.html's markup and solver-bridge.js's
 * SolveSession / searchCurrentNode logic: the solution bar (solve-editor.js)
 * with its inline autocomplete, the tree-searcher (suggest.js), the critique (critique.js), the cube
 * (pixel-cube.js) and the settings drawer (README "The solving screen").
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
            if (job.seed) w.seeding = false;
            if (job.live) job.live.detach();
            if (error) job.reject(new Error(error)); else job.resolve(candidates);
          };
          w.onerror = (e) => {
            console.error('Post-processing worker failed; using the main thread', e.message || e);
            w.broken = true;
            for (const id of w.pending) { const job = jobs.get(id); jobs.delete(id); if (job) { if (job.live) job.live.detach(); job.reject(new Error('worker failed')); } }
            w.pending.clear();
            w.seeding = false;
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
            if (!waiting.length) return;
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
            // A seed job (a big call's first, quick job: its type's limits
            // for every other job) may share a worker with a running job,
            // which waits at its next pause (solver-bridge.js liveHooks).
            const seed = !!waiting[best].job.seedOnly;
            const w = workers.find(x => !x.broken && x.pending.size < 1)
              || (seed ? workers.find(x => !x.broken && x.pending.size < 2 && !x.seeding) : null);
            if (!w) return;
            const { ctx, job: queued, cores, prepare, live, resolve, reject } = waiting.splice(best, 1)[0];
            // prepare: the caller's last word on the job when it starts
            // (solver-bridge.js: its type's current limits)
            const job = prepare ? prepare(queued) : queued;
            const id = nextId++;
            // window.CUBETREE_TRACE = [] records ranking jobs (dev timing)
            const trace = typeof window !== 'undefined' && Array.isArray(window.CUBETREE_TRACE) ? window.CUBETREE_TRACE : null;
            if (trace) trace.push([performance.now(), 'start', id, job.pairCount, cores.length, job.seedOnly ? 'seed' : '']);
            jobs.set(id, { resolve: trace ? (c) => { trace.push([performance.now(), 'end', id, c ? c.length : 0]); resolve(c); } : resolve, reject, live, seed });
            w.pending.add(id);
            if (seed) w.seeding = true;
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

  const $ = id => document.getElementById(id);
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const profile = () => (typeof cubeProfiles !== 'undefined' && cubeProfiles ? cubeProfiles.active() : null);
  const answers = () => (profile() && profile().answers) || {};
  const prefs = () => ({ ...(typeof PROFILE_DEFAULT_PREFS !== 'undefined' ? PROFILE_DEFAULT_PREFS : {}), ...((profile() && profile().prefs) || {}) });

  // ---------------------------------------------------------------------
  // The solution as text: committed steps written back (rowsText), copy,
  // copy all, move count (README "Solution entry").
  // ---------------------------------------------------------------------

  /** The committed steps as editor text, one per line (as found: the editor keeps steps uncancelled). */
  function rowsText(session) {
    const out = [];
    let pairs = 0;
    session.committedRows.forEach((row, i) => {
      const node = session.nodeMap.get(row.targetNodeId);
      const after = node ? (node.state.corners || []).length : pairs;
      if (i === 0 && row.rotation) out.push(`${row.rotation} // inspection`);
      out.push(`${row.coreAlg} // ${stepLabel(i === 0, pairs, after, /pseudo/i.test(row.type || ''))}`);
      pairs = after;
    });
    return out.length ? out.join('\n') + '\n' : '';
  }

  /**
   * What follows the F2L steps: the last-layer steps, one per line with their
   * labels, then any unfinished moves (as typed).
   */
  function tailText() {
    if (!reading || !reading.tail.tokens.length) return '';
    if (!llRead) return reading.tail.tokens.join(' ');
    const lines = llRead.steps.map(st => `${st.toks.join(' ')} // ${st.label}`);
    if (llRead.tailTokens.length) lines.push(llRead.tailTokens.join(' '));
    return lines.join('\n');
  }

  /** STM / ETM of the solution and its last-layer steps. */
  function solutionCounts(session) {
    const c = moveCounts(session);
    if (!llRead) return c.text;
    let stm = c.stm, etm = c.etm;
    for (const st of llRead.steps) for (const t of st.toks) { etm++; if (!/^[xyz]/.test(t)) stm++; }
    return `${stm}STM / ${etm}ETM`;
  }

  /** What copy writes: the scramble, the solution as a reconstruction (cancellations merged), then any unfinished moves. */
  function copyText(session, tail = '') {
    return solutionText(session) + (tail ? `\n${tail}` : '');
  }

  function renderPath(session) {
    const lines = solutionLines(session);
    const copy = $('copy-btn');
    if (copy) copy.disabled = !lines.length && !tailText();
    const copyAll = $('copy-all-btn');
    if (copyAll) copyAll.disabled = ![...sessions.values()].some(s => s.committedRows.length);
    const count = $('move-count');
    if (count) count.textContent = lines.length ? solutionCounts(session) : '';
  }

  function allSolutionsText() {
    return scrambleController.sequenceList.map((raw, idx) => {
      const session = sessions.get(idx);
      if (!session) return cleanScramble(raw || '');
      if (idx === activeIndex) return copyText(session, tailText());
      // another scramble: its finished last-layer steps, read from its text
      let ll = '';
      if (session.isComplete && session._text) {
        const r = readLastLayerOf(session, readSolution(session, session._text, []), session._text);
        if (r) ll = r.steps.map(st => `${st.toks.join(' ')} // ${st.label}`).join('\n');
      }
      return copyText(session, ll);
    }).join('\n\n');
  }

  function bindSolutionActions() {
    const copy = $('copy-btn');
    if (copy) copy.addEventListener('click', () => {
      const session = sessions.get(activeIndex);
      if (session) copyToClipboard(copy, 'copy', copyText(session, tailText()));
    });
    const copyAll = $('copy-all-btn');
    if (copyAll) copyAll.addEventListener('click', () => copyToClipboard(copyAll, 'copy all', allSolutionsText()));
    const undo = $('undo-btn');
    if (undo) undo.addEventListener('click', handleUndo);
    const crit = $('critique-btn');
    if (crit) crit.addEventListener('click', runCritique);
  }

  async function copyToClipboard(btn, label, text) {
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
    btn.textContent = ok ? 'copied' : 'copy failed';
    clearTimeout(btn._reset);
    btn._reset = setTimeout(() => { btn.textContent = label; }, 1500);
  }

  function renderUndoButton(session) {
    const btn = $('undo-btn');
    if (btn) btn.disabled = !session.canUndo && !tailText();
  }

  const STATUS_LABELS = { pending: 'queued', searching: 'searching…', done: 'ready', error: 'failed' };
  const PAGE_TITLE = typeof document !== 'undefined' ? document.title : '';

  function renderScrambleStatus() {
    const el = $('scramble-status');
    const session = sessions.get(activeIndex);
    const status = !session ? 'pending' : session.isComplete ? 'done' : (session._status || 'pending');
    if (el) {
      el.textContent = STATUS_LABELS[status] || '';
      el.className = 'scramble-status ' + status;
    }
    // Also in the tab title: a search keeps running in a background tab.
    const prefix = status === 'searching' ? 'searching… · ' : status === 'error' ? 'failed · ' : '';
    document.title = prefix + PAGE_TITLE;
  }

  function renderScrambleStatusIfActive(session) {
    if (sessions.get(activeIndex) === session) renderScrambleStatus();
  }

  // ---------------------------------------------------------------------
  // Per-step settings (filters, pair planning, look-ahead), remembered per
  // profile. Look-ahead and pair planning re-search the step (reusing the
  // depth-1 search behind it); filters only hide.
  // ---------------------------------------------------------------------
  const view = {
    lookaheadDepth: 1, lookaheadBreadth: 5, multislot: false, wideMoves: true,
    hideUnorthodox: false, simplePseudo: false, planning: true,
    llMethod: 'oll', lastSlot: true, // README "Algorithm sets": oll | coll | zbll; zbls/ols picks at the last pair
  };
  let shownResults = null; // the current step's list (complete or partial)
  // The scramble and step the list belongs to: a pick from a list that is no
  // longer current must never be committed at another node.
  let shownOwner = null;
  let shownPartial = false;
  let shownFinal = false; // the list on screen will not change any more (what is still searched is hidden)
  function activeStepKey() {
    const s = sessions.get(activeIndex);
    return s ? `${activeIndex}|${s.rotation}|${s.stepAlgs.join(' | ')}` : null;
  }
  const currentList = () => (shownResults && shownOwner === activeStepKey() ? shownResults : null);

  function loadViewPrefs(crit) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(scopedKey(VIEW_PREFS_KEY)) || 'null'); } catch (err) { saved = null; }
    Object.assign(view, (crit && crit.legacyView) || {}, saved || {});
    view.lookaheadDepth = Math.max(1, Math.min(LOOKAHEAD_MAX_DEPTH, parseInt(view.lookaheadDepth, 10) || 1));
    view.lookaheadBreadth = Math.max(1, Math.min(50, parseInt(view.lookaheadBreadth, 10) || 5));
    view.simplePseudo = !!view.simplePseudo;
    view.multislot = !!view.multislot;
    delete view.noR2L2; // a removed option, maybe still saved
    delete view.pageSize; // the results table is gone
    view.wideMoves = view.wideMoves !== false;
    view.hideUnorthodox = !!view.hideUnorthodox;
    view.planning = view.planning !== false;
    view.llMethod = ['oll', 'coll', 'zbll'].includes(view.llMethod) ? view.llMethod : 'oll';
    view.lastSlot = view.lastSlot !== false;
  }

  function saveViewPrefs() {
    try { localStorage.setItem(scopedKey(VIEW_PREFS_KEY), JSON.stringify(view)); } catch (err) { /* private mode: not remembered */ }
  }

  const pseudoOn = () => !!(criteria && (criteria.advanced || []).includes('full_pseudo'));

  function syncViewControls() {
    const set = (id, prop, value) => { const el = $(id); if (el) el[prop] = value; };
    set('lookahead-depth', 'value', String(view.lookaheadDepth));
    set('lookahead-breadth', 'value', view.lookaheadBreadth);
    set('lookahead-breadth', 'disabled', view.lookaheadDepth <= 1);
    const wrap = $('simple-pseudo-wrap');
    if (wrap) wrap.hidden = !pseudoOn();
    set('multislot', 'checked', view.multislot);
    set('wide-moves', 'checked', view.wideMoves);
    set('hide-unorthodox', 'checked', view.hideUnorthodox);
    set('simple-pseudo', 'checked', view.simplePseudo);
    set('pair-planning', 'checked', view.planning);
    set('ll-method', 'value', view.llMethod);
    set('last-slot', 'checked', view.lastSlot);
  }

  function bindViewControls() {
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    const research = () => { saveViewPrefs(); syncViewControls(); runSearch(); };
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
    // the last layer's settings only change what is suggested
    const relist = () => { saveViewPrefs(); syncViewControls(); lastSlotMemo.clear(); renderSuggestions(); renderSearcher(); };
    on('ll-method', 'change', (e) => { view.llMethod = e.target.value; relist(); });
    on('last-slot', 'change', (e) => { view.lastSlot = e.target.checked; relist(); });
  }


  function setStatus(msg, kind = 'busy') {
    const el = $('search-status');
    if (el) {
      el.textContent = msg || '';
      el.dataset.state = kind;
    }
    const searcher = $('searcher');
    if (searcher) searcher.classList.toggle('thinking', kind === 'busy');
  }

  function renderActiveResults(results, partial = false) {
    // dev timing hook (window.CUBETREE_TRACE): the list on screen
    if (Array.isArray(window.CUBETREE_TRACE)) window.CUBETREE_SHOWN = results;
    shownResults = results;
    shownOwner = activeStepKey();
    shownPartial = partial;
    // No counts or other numbers on screen (developer, 2026-10-11): the
    // tree-searcher says when it is thinking; the line only speaks up when it must.
    const final = !partial || (results.onlyMultislotPending && !view.multislot && !results.lookaheadPending);
    shownFinal = final;
    if (results.failedCalls) setStatus(caption('solve.someFailed'), 'error');
    else if (final && !results.length) setStatus(caption('solve.noResults'), 'done');
    else setStatus('', final ? 'done' : 'busy');
    renderSuggestions();
    renderSearcher();
    if (final) maybeContinuationSearch();
  }

  // ---------------------------------------------------------------------
  // Searching (unchanged machinery: one search per session, path and
  // settings; a priority scheduler; background scrambles one at a time).
  // ---------------------------------------------------------------------
  const scheduler = createSearchScheduler();
  const { ACTIVE, BACKGROUND } = SEARCH_PRIORITY;

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
      if (session.resultsCache && session.resultsCache.job) scheduler.setStale(session.resultsCache.job);
      session._status = 'searching';
      renderScrambleStatusIfActive(session);
      const cache = { key, live: null };
      session.resultsCache = cache;
      const isShown = () => sessions.get(activeIndex) === session && session.resultsCache === cache;
      // the engine's progress messages are technical: only 'busy' reaches the screen
      const onStatus = () => { if (isShown() && !cache.live) setStatus('', 'busy'); };
      onStatus();
      const onUpdate = (list) => {
        if (session.resultsCache !== cache) return;
        cache.live = list;
        if (isShown()) renderActiveResults(list, true);
      };
      const isCancelled = () => session.resultsCache !== cache;
      const job = scheduler.submit((wrap) => {
        if (session.postProcessor && session.postProcessor.forJob) session.postProcessor = session.postProcessor.forJob(job);
        return searchWithLookahead(session, wrap(h), onStatus, wrap(ph), { ...opts, onUpdate, isCancelled });
      }, priority);
      const promise = job.promise;
      cache.job = job;
      cache.promise = promise;
      trackJob(session, job, priority);
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

  function setSessionPriority(index, priority) {
    const session = sessions.get(index);
    if (session) setJobsPriority(session, priority);
  }

  function scheduleBackgroundSearches(h, ph) {
    scrambleController.sequenceList.forEach((_, idx) => {
      if (idx === activeIndex) return;
      const session = getOrCreateSession(idx);
      if (session.isComplete || session.resultsCache) return;
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
    renderPath(session);
    renderUndoButton(session);
    renderScrambleStatus();
    if (session.isComplete) {
      shownResults = null;
      shownOwner = null;
      setStatus('', 'done');
      renderSuggestions();
      renderSearcher();
      return;
    }
    if (!keepRows || shownOwner !== activeStepKey()) {
      shownResults = null;
      shownOwner = null;
      renderSuggestions();
      renderSearcher();
      setStatus('', 'busy');
    }
    let h;
    try {
      h = await ensureHelper();
    } catch (err) {
      setStatus(caption('solve.loadFailed'), 'error');
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
      if (myToken === searchToken) setStatus(caption('solve.searchFailed'), 'error');
      return;
    }
    if (myToken !== searchToken) return;
    renderActiveResults(results);
  }

  // ---------------------------------------------------------------------
  // The solution bar (solve-editor.js): the text is the truth; committed
  // steps follow it.
  // ---------------------------------------------------------------------
  let editor = null;
  let editorSession = null; // the session whose text the editor holds
  let reading = null;      // readSolution of the active session's text
  let activeIdx = -1;      // keyboard-selected suggestion (shown as the ghost)
  let suggestions = [];    // [{ kind: 'alg'|'comment', r?, toks?, text }]
  let tailStep = null;     // the typed tail as a finished step ({ label, row }), or null
  let llRead = null;       // after the F2L: the last-layer steps read from the tail (readLastLayer)
  let syncTimer = 0;

  function syncEditor() {
    clearTimeout(syncTimer);
    if (!prunedTree || !editor) return;
    const session = getOrCreateSession(activeIndex);
    if (editorSession !== session) return; // the editor is not showing this session yet
    session._text = editor.value;
    const atNode = session.committedRows.length;
    const list = currentList() || [];
    const read = readSolution(session, editor.value, list);
    let changed = false;
    while (session.committedRows.length > read.keep) { session.undo(); changed = true; }
    for (const st of read.steps) { session.commit(st.row); changed = true; }
    reading = read;
    llRead = readLastLayer(session);
    if (changed || atNode !== session.committedRows.length) {
      persistSessionState();
      runSearch();
    } else {
      persistSessionState();
    }
    renderSuggestions();
    renderSearcher();
    renderPath(session);
    renderUndoButton(session);
    updatePlayer();
    maybeContinuationSearch();
  }

  /**
   * After the F2L (README "Algorithm sets"): the tail's finished lines read
   * as last-layer steps (last-layer.js, by replay), their lines drawn as
   * steps; what follows the last of them is the last layer's tail.
   */
  function readLastLayer(session) {
    return reading && editor ? readLastLayerOf(session, reading, editor.value) : null;
  }
  /** readLastLayer for any session's reading of its text (copy all reads the other scrambles' texts). */
  function readLastLayerOf(session, reading, text) {
    if (!session.isComplete || !reading || typeof LastLayer === 'undefined') return null;
    ensureLastLayerData();
    const first = reading.tail.onNewLine ? reading.parsed.length - 1 : reading.tail.line;
    const parsed = reading.parsed.slice(first);
    // the last line is still being typed unless the text ends with a newline
    const done = text.endsWith('\n') ? parsed.length : parsed.length - 1;
    const lineToks = l => l.tokens.filter(t => t.valid).map(t => normTok(t.tok));
    const start = applyAlgorithm(scrambledState(session.scramble), solutionTokens(session).join(' '));
    const r = LastLayer.readSteps(start, parsed.slice(0, done).map(l => ({ tokens: lineToks(l) })), LastLayer.LOADED);
    for (const st of r.steps) {
      for (let li = st.firstLine; li <= st.lastLine; li++) {
        reading.lines[first + li] = { kind: li === st.lastLine ? 'step' : 'merged', label: li === st.lastLine ? st.label : null };
      }
    }
    const open = done < parsed.length ? lineToks(parsed[done]) : [];
    const tailTokens = [...r.tail.tokens, ...open];
    const tailLine = first + (r.tail.tokens.length ? r.tail.firstLine : done);
    // the tail as a finished stage (its comment is suggested, as for a pair)
    let finished = null;
    if (tailTokens.length && done < parsed.length) {
      try {
        const after = applyAlgorithm(r.cube, tailTokens.join(' '));
        const next = LastLayer.stageOf(after);
        if (next && r.stage && LastLayer.STAGE_RANK[next] > LastLayer.STAGE_RANK[r.stage]) {
          finished = { label: LastLayer.stepLabel(r.cube, r.stage, next, LastLayer.LOADED), stage: next };
        }
      } catch (e) { finished = null; }
    }
    return { steps: r.steps, base: first, cube: r.cube, stage: r.stage, tailTokens, tailLine, finished };
  }

  const LL_DATA_VERSION = '20261015a';
  let llLoading = null;
  /** Loads every alg set once (data/ll/*.json); re-renders when they arrive. */
  function ensureLastLayerData() {
    if (llLoading || typeof LastLayer === 'undefined') return llLoading;
    llLoading = Promise.all(AlgSets.SETS.map(s => LastLayer.load(s.id, `data/ll/${s.id}.json?v=${LL_DATA_VERSION}`).catch(() => null)))
      .then(() => {
        lastSlotMemo.clear();
        if (reading) {
          const session = sessions.get(activeIndex);
          if (session) llRead = readLastLayer(session);
        }
        renderSuggestions();
        renderSearcher();
      });
    return llLoading;
  }

  /** The moves typed after the last finished step: the F2L tail, or the last layer's. */
  function typedTail() {
    if (llRead) {
      const partial = reading.tail.partial && llRead.tailTokens.length ? reading.tail.partial : '';
      return { tokens: llRead.tailTokens, partial, line: llRead.tailLine };
    }
    return { tokens: reading.tail.tokens, partial: reading.tail.partial, line: reading.tail.line };
  }

  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncEditor, 40);
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** The coloured copy of the text under the transparent textarea, plus the ghost of the top suggestion. */
  function renderEditor() {
    if (!editor || !reading) return;
    const text = editor.value;
    const shadow = $('editor-shadow');
    const sizer = $('editor-sizer');
    let html = '';
    reading.parsed.forEach((line, li) => {
      const kind = reading.lines[li].kind;
      let pos = line.start;
      // a tail that already finishes a step reads as one (it commits at the line end)
      const cls = kind === 'tail' && !tailStep ? 'tok-pending' : 'tok-step';
      for (const t of line.tokens) {
        html += esc(text.slice(pos, t.start));
        html += `<span class="${cls}${t.valid ? '' : ' tok-bad'}">${esc(t.tok)}</span>`;
        pos = t.end;
      }
      if (line.commentStart >= 0) {
        html += esc(text.slice(pos, line.commentStart));
        html += `<span class="tok-comment">${esc(text.slice(line.commentStart, line.end))}</span>`;
      } else html += esc(text.slice(pos, line.end));
      if (li < reading.parsed.length - 1) html += '\n';
    });
    const ghost = ghostText();
    if (ghost && document.activeElement === editor && editor.selectionStart === text.length) {
      html += `<span class="ghost">${esc(ghost)}</span><span class="ghost-key">tab</span>`;
    }
    if (!text) html = `<span class="ghost">${esc(caption('solve.placeholder'))}</span>`;
    shadow.innerHTML = html + '\n';
    sizer.textContent = text + (ghost ? ghost + '     ' : '') + '\n';
  }

  /** The rest of the top (or chosen) suggestion after what is typed (shown greyed after the caret). */
  function ghostText() {
    const top = suggestions[activeIdx >= 0 ? activeIdx : 0];
    if (!top || !reading) return '';
    const text = editor.value;
    if (top.kind === 'comment') return (/\s$/.test(text) ? '' : ' ') + top.text;
    const { tokens: typed, partial } = typedTail();
    const rest = top.toks.slice(typed.length - (partial ? 1 : 0));
    if (!rest.length) return '';
    if (partial) {
      const first = rest[0].slice(partial.length);
      return first + (rest.length > 1 ? ' ' + rest.slice(1).join(' ') : '');
    }
    return (text && !/\s$/.test(text) ? ' ' : '') + rest.join(' ');
  }

  /** The label a candidate's step gets in the solution. */
  function labelFor(session, r) {
    const before = session.isAtRoot ? 0 : (session.currentNode.state.corners || []).length;
    const node = session.nodeMap.get(r.targetNodeId);
    const after = node ? (node.state.corners || []).length : before + (r.corners || []).length;
    return stepLabel(session.isAtRoot, before, after, /pseudo/i.test(r.type || ''));
  }

  /** Text before the tail (the committed steps' lines), ending at a line start. */
  function textBeforeTail() {
    const text = editor.value;
    const tail = reading ? typedTail() : null;
    if (!tail || !tail.tokens.length) {
      return text && !text.endsWith('\n') ? text + '\n' : text;
    }
    const line = reading.parsed[tail.line];
    return text.slice(0, line.start);
  }

  function setEditorText(text) {
    editor.value = text;
    editor.selectionStart = editor.selectionEnd = text.length;
    activeIdx = -1;
    syncEditor();
  }

  /** A candidate the solution bar may commit: from the step's list or the continuation search. */
  const committable = r => !!r && ((currentList() || []).includes(r) || !!(continuation && continuation.list && continuation.list.includes(r))
    || lastSlotRows().includes(r));

  /** Writes candidate `r` as the next step (with its label) and commits it. */
  function commitSuggestion(r) {
    const session = getOrCreateSession(activeIndex);
    if (!committable(r)) return;
    const label = labelFor(session, r) + (r.lastSlot ? ` (${r.lastSlot.name})` : '');
    const lines = session.isAtRoot && r.rotation
      ? `${r.rotation} // inspection\n${r.coreAlg} // ${label}\n`
      : `${r.coreAlg} // ${label}\n`;
    const before = textBeforeTail();
    animateFrom = player ? player.length : 0;
    setEditorText(before + lines);
    editor.focus();
  }

  /**
   * Tab: commit the top (or chosen) suggestion with its label, or write the
   * label of a typed step that is finished; either way the caret goes to the
   * next line, which commits the step (developer, 2026-10-11: a filled step
   * is committed at once, never left greyed out).
   */
  function acceptSuggestion() {
    const s = suggestions[activeIdx >= 0 ? activeIdx : 0];
    if (!s) return false;
    if (s.kind === 'comment') {
      const text = editor.value.replace(/\s+$/, '');
      animateFrom = null;
      setEditorText(`${text} ${s.text}\n`);
      return true;
    }
    if (s.kind === 'll') { commitLastLayer(s); return true; }
    commitSuggestion(s.r);
    return true;
  }

  /** Writes a last-layer alg (with its AUFs) and its label as the next line. */
  function commitLastLayer(s) {
    const before = textBeforeTail();
    animateFrom = player ? player.length : 0;
    setEditorText(`${before}${s.toks.join(' ')} // ${s.label}\n`);
    editor.focus();
  }

  /** The suggestions after what is typed (the ghost, Tab and ↑/↓ use them; nothing is listed on screen). */
  function renderSuggestions() {
    const session = sessions.get(activeIndex);
    suggestions = [];
    tailStep = null;
    if (session && reading && session.isComplete && llRead && llRead.stage && llRead.stage !== 'done') {
      // the last layer: the algs of the case on the cube, in the solver's method
      const { tokens, partial } = typedTail();
      if (llRead.finished && tokens.length) suggestions.push({ kind: 'comment', text: `// ${llRead.finished.label}` });
      else {
        const pool = LastLayer.suggestions(llRead.cube, LastLayer.LOADED, view.llMethod);
        for (const m of tokenPrefixMatches(pool, tokens, partial)) {
          if (suggestions.length >= 5) break;
          if (suggestions.some(x => x.toks.join(' ') === m.toks.join(' '))) continue;
          suggestions.push({ kind: 'll', toks: m.toks, label: m.label, s: m });
        }
      }
    }
    if (session && reading && !session.isComplete) {
      const tail = reading.tail;
      const list = currentList();
      // a tail that finishes a step: suggest its comment (CubeDB-style)
      const done = tail.tokens.length && !tail.onNewLine ? stepFromTail(session, tail.tokens, list) : null;
      tailStep = done;
      const line = reading.parsed[tail.line];
      if (done && line && line.commentStart < 0) suggestions.push({ kind: 'comment', text: `// ${done.label}` });
      const pools = [list, continuationFor(tail), lastSlotRows()].filter(p => p && p.length);
      for (const pool of pools) {
        for (const m of prefixMatches(pool, tail.tokens, tail.partial, session.isAtRoot)) {
          if (suggestions.length >= 5) break;
          if (done && m.toks.length === tail.tokens.length) continue; // that one is typed already
          if (suggestions.some(x => x.kind === 'alg' && x.toks.join(' ') === m.toks.join(' '))) continue;
          suggestions.push({ kind: 'alg', r: m.r, toks: m.toks });
        }
        if (suggestions.some(x => x.kind === 'alg')) break; // the step's own list first
      }
    }
    if (activeIdx >= suggestions.length) activeIdx = -1;
    renderEditor();
  }

  /**
   * The last-slot pick, when there is a fact for it: a ZBLS alg for a ZBLL
   * solver whose other picks leave edges to orient ("leaves the edges
   * oriented"), or an OLS alg ("skips the oll"). None otherwise.
   */
  function lastSlotPick(session, picks) {
    const rows = lastSlotRows();
    if (!rows.length) return null;
    const leaves = (r) => {
      try {
        const f = replayFacelets(session.scramble, session.rotation, session.scoredPath, r.coreAlg);
        return LastLayer.stageOf(f);
      } catch (e) { return null; }
    };
    const ols = rows.find(r => r.lastSlot.setId === 'ols');
    const pickStages = picks.map(p => leaves(p.r));
    if (ols && !pickStages.some(st => st === 'oriented' || st === 'auf' || st === 'done')) {
      return { r: ols, role: 'lastslot.ols', reasons: [{ key: 'ls.skipsOll', vars: { label: ols.lastSlot.name } }] };
    }
    const zbls = rows.find(r => r.lastSlot.setId === 'zbls');
    if (zbls && view.llMethod === 'zbll' && !pickStages.some(st => st && st !== 'f2l')) {
      return { r: zbls, role: 'lastslot.zbls', reasons: [{ key: 'ls.edgesForZbll', vars: { label: zbls.lastSlot.name } }] };
    }
    return null;
  }

  /** Items ({ toks }) whose tokens start with the typed ones (the strict prefix of prefixMatches). */
  function tokenPrefixMatches(items, typed, partial) {
    typed = typed.map(normTok);
    const done = partial ? typed.slice(0, -1) : typed;
    return items.filter((it) => {
      const t = it.toks;
      if (t.length < done.length + (partial ? 1 : 0)) return false;
      for (let i = 0; i < done.length; i++) if (t[i] !== done[i]) return false;
      return !partial || t[done.length].startsWith(partial);
    });
  }

  /**
   * At the last pair (README "Algorithm sets"): the ZBLS and OLS algs of the
   * cube's last-slot case, the slot turned to the front right by a y, each
   * replayed and scored as a step the user wrote (userStepRow), so they rank
   * like any step. Memoised per node.
   */
  const lastSlotMemo = new Map();
  const LS_PER_SET = 4; // algs per set and case
  function lastSlotRows() {
    const session = sessions.get(activeIndex);
    if (!session || session.isComplete || session.isAtRoot || !view.lastSlot || typeof LastLayer === 'undefined') return [];
    if ((session.currentNode.state.corners || []).length !== 3) return [];
    const key = `${activeIndex}|${session.scoredPath}|${session.rotation}`;
    if (lastSlotMemo.has(key)) return lastSlotMemo.get(key);
    const sets = ['zbls', 'ols'].filter(id => LastLayer.LOADED[id]);
    if (sets.length < 2) { ensureLastLayerData(); return []; }
    const rows = [];
    const here = replayFacelets(session.scramble, session.rotation, session.scoredPath, '');
    for (const ls of LastLayer.lastSlotAlgs(here, LastLayer.LOADED, LS_PER_SET)) {
      const row = userStepRow(session, ls.toks);
      if (!row) continue;
      row.coreAlg = ls.toks.join(' ');
      row.lastSlot = { setId: ls.setId, name: ls.name };
      rows.push(row);
    }
    rows.sort((a, b) => a.tpp - b.tpp);
    lastSlotMemo.set(key, rows);
    return rows;
  }

  /** The tail as a finished step: { label, row, last } (a listed candidate or the user's own), or null. */
  function stepFromTail(session, tokens, list) {
    const cand = (list || []).find((c) => {
      const want = rowTokens(c, session.isAtRoot);
      return want.length === tokens.length && want.every((t, j) => t === normTok(tokens[j]));
    });
    const row = cand || userStepRow(session, tokens);
    if (!row) return null;
    const node = session.nodeMap.get(row.targetNodeId);
    return { label: labelFor(session, row), row, last: !!node && (node.state.corners || []).length >= 4 };
  }

  // ---------------------------------------------------------------------
  // The continuation search (developer, 2026-10-11): moves typed that start
  // no listed step are searched onward -- the step's search again from the
  // cube after those moves -- so the ghost can still finish the step the
  // solver has in mind. Each continuation is the typed moves plus a found
  // rest, scored as a step the user wrote (userStepRow: replayed on the
  // real cube, so a wrong frame can only drop rows, never mis-score them).
  // ---------------------------------------------------------------------
  let continuation = null; // { key, list (null while searching), job }
  let continuationTimer = 0;
  const CONTINUATION_DELAY = 350; // ms after the last keystroke
  const CONTINUATION_ROWS = 400;  // rescored found rests (best first)
  const COLOUR_OF_FACELET = { W: 'white', Y: 'yellow', G: 'green', B: 'blue', R: 'red', O: 'orange' };

  /** The complete typed moves a continuation is searched for (the token still being typed filters it). */
  const continuationTyped = tail => (tail.partial ? tail.tokens.slice(0, -1) : tail.tokens).map(normTok);
  const continuationKey = typed => `${activeStepKey()}|${typed.join(' ')}`;

  /** The continuation list for this tail, if it was searched. */
  function continuationFor(tail) {
    if (!continuation || !continuation.list) return null;
    return continuation.key === continuationKey(continuationTyped(tail)) ? continuation.list : null;
  }
  const continuationPending = () => !!(continuation && !continuation.list && reading
    && continuation.key === continuationKey(continuationTyped(reading.tail)));

  function maybeContinuationSearch() {
    clearTimeout(continuationTimer);
    const session = sessions.get(activeIndex);
    const list = currentList();
    if (!session || !reading || session.isComplete || !list || !shownFinal) return;
    const typed = continuationTyped(reading.tail);
    if (!typed.length || typed.some(t => !isMoveToken(t))) return;
    if (prefixMatches(list, typed, '', session.isAtRoot).length) return; // the step's list has it
    if (stepFromTail(session, typed, list)) return; // already a finished step
    const key = continuationKey(typed);
    if (continuation && continuation.key === key) return;
    if (continuation && continuation.job) scheduler.setStale(continuation.job);
    const mine = { key, list: null, job: null };
    continuation = mine; // pending from now on: the tree-searcher says it is following
    renderSearcher();
    continuationTimer = setTimeout(() => {
      runContinuation(session, typed, mine).catch(() => { if (continuation === mine) { mine.list = []; renderSearcher(); } });
    }, CONTINUATION_DELAY);
  }

  async function runContinuation(session, typed, mine) {
    if (continuation !== mine) return;
    const h = await ensureHelper();
    const ph = await ensurePseudoHelper();
    if (continuation !== mine) return;
    const isRoot = session.isAtRoot;
    let fork;
    let rotToks = [];
    let algToks = typed;
    let wantRotation = -1;
    if (isRoot) {
      // the typed rotation and moves, moved into the scramble: "scramble F'"
      // then the rotation Q is the cube as typed (Q F == rotation + moves)
      let k = 0;
      while (k < typed.length && SE_ROTATION.test(typed[k])) k++;
      rotToks = typed.slice(0, k);
      algToks = typed.slice(k);
      if (!algToks.length) { mine.list = []; return; }
      const frame = canonicalizeForEngine(rotToks.join(' '), algToks.join(' '));
      const early = frame.moves ? relabelAlgForRotation(frame.moves, inverseRotation(frame.rotation)) : '';
      const scramble = [session.scramble, early].filter(Boolean).join(' ');
      const asTyped = applyAlgorithm(SOLVED_FACELETS, [session.scramble, ...typed].join(' '));
      if (applyAlgorithm(SOLVED_FACELETS, [scramble, frame.rotation].filter(Boolean).join(' ')) !== asTyped) { mine.list = []; return; }
      wantRotation = rotationIndex(frame.rotation || '');
      fork = Object.assign(Object.create(SolveSession.prototype), session, {
        scramble,
        colors: [COLOUR_OF_FACELET[asTyped[31]]].filter(Boolean), // the cross on D, as typed
        stepAlgs: [], committedRows: [], resultsCache: null,
        searchMemo: new Map(), engineMemo: new Map(), // their keys do not hold the scramble
      });
    } else {
      fork = session.fork();
      fork.stepAlgs = [...session.stepAlgs, typed.join(' ')];
    }
    const job = scheduler.submit(wrap => searchWithLookahead(fork, wrap(h), () => {}, wrap(ph), {
      ...searchOptions(ACTIVE), depth: 1, isCancelled: () => continuation !== mine,
    }), ACTIVE);
    mine.job = job;
    let results = [];
    try { results = (await job.promise) || []; } catch (err) { results = []; }
    if (continuation !== mine) return;
    const out = [];
    const seen = new Set();
    for (const r of results) {
      if (out.length >= CONTINUATION_ROWS) break;
      if (isRoot && rotationIndex(r.rotation || '') !== wantRotation) continue;
      const rest = String(r.coreAlg || '').split(/\s+/).filter(Boolean);
      // a rest that cancels into the typed moves is another spelling of what was typed: skip it
      if (cancelBoundary(algToks, rest).merged) continue;
      const toks = [...typed, ...rest];
      const k = toks.join(' ');
      if (seen.has(k)) continue;
      seen.add(k);
      let row = null;
      try { row = userStepRow(session, toks); } catch (err) { row = null; }
      if (row) out.push(row);
    }
    out.sort((a, b) => a.tpp - b.tpp);
    mine.list = out;
    renderSuggestions();
    renderSearcher();
  }

  function bindEditor() {
    editor = $('solution-input');
    if (!editor) return;
    editor.addEventListener('input', () => { activeIdx = -1; animateFrom = player ? player.length : null; scheduleSync(); });
    editor.addEventListener('keydown', (e) => {
      if (e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
        if (acceptSuggestion()) e.preventDefault();
        return;
      }
      const atEnd = editor.selectionStart === editor.value.length;
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && suggestions.length > 1 && atEnd) {
        e.preventDefault();
        const n = suggestions.length;
        activeIdx = e.key === 'ArrowDown' ? (activeIdx + 1) % n : (activeIdx <= 0 ? n - 1 : activeIdx - 1);
        renderEditor();
        return;
      }
      if (e.key === 'Enter' && activeIdx >= 0 && suggestions[activeIdx]) {
        e.preventDefault();
        acceptSuggestion();
        return;
      }
      if (e.key === 'Escape') { activeIdx = -1; renderEditor(); }
    });
    for (const ev of ['click', 'keyup', 'focus', 'blur']) editor.addEventListener(ev, () => renderEditor());
    // the cube follows the caret while the solution bar has it, and goes
    // back to the end of the solution when it leaves (unless the playback
    // controls or the cube took it)
    for (const ev of ['click', 'keyup', 'focus', 'select']) editor.addEventListener(ev, followCaret);
    document.addEventListener('selectionchange', () => { if (document.activeElement === editor) followCaret(); });
    editor.addEventListener('focus', () => { manualPlayback = false; });
    editor.addEventListener('blur', () => {
      if (manualPlayback || !player || previewing) return;
      player.pause();
      player.seek(player.length, false);
    });
  }

  // ---------------------------------------------------------------------
  // The cube (pixel-cube.js) and playback of the solution and the typed
  // moves, from the scrambled cube (the scramble itself is not played)
  // ---------------------------------------------------------------------
  let pixelCube = null;
  let player = null;
  let animateFrom = null; // the playback position to animate from after the next change
  let previewing = false;
  let manualPlayback = false; // the playback controls or the cube were used since the bar lost the caret
  const scrambledMemo = new Map();

  function cubeTheme() {
    if (!pixelCube) return;
    pixelCube.setTheme({ bg: cssVar('--bg') || '#161618', line: cssVar('--line') || '#f1f1ee', clear: true, floorShadow: true });
  }

  function scrambledState(scramble) {
    if (!scrambledMemo.has(scramble)) scrambledMemo.set(scramble, applyAlgorithm(SOLVED_FACELETS, playbackTokens(scramble).join(' ')));
    return scrambledMemo.get(scramble);
  }

  function solutionTokens(session) {
    const toks = [];
    session.committedRows.forEach((row, i) => toks.push(...rowTokens(row, i === 0)));
    return toks;
  }

  /** Moves of the text before the caret (the playback position the caret stands for). */
  function caretMoveIndex() {
    if (!reading || !editor) return Infinity;
    const caret = editor.selectionEnd;
    let n = 0;
    for (const line of reading.parsed) for (const t of line.tokens) if (t.valid && t.start < caret) n++;
    return n;
  }
  const caretInBar = () => !!editor && document.activeElement === editor;

  function followCaret() {
    if (!player || previewing || player.playing || !caretInBar()) return;
    const k = Math.min(player.length, caretMoveIndex());
    if (k !== player.pos) player.seek(k, Math.abs(k - player.pos) === 1 && prefs().animSpeed > 0);
  }

  function updatePlayer() {
    if (!player || previewing) return;
    const session = sessions.get(activeIndex);
    if (!session) return;
    const sol = solutionTokens(session);
    const tail = reading ? reading.tail.tokens.filter(t => isMoveToken(t)) : [];
    const tokens = [...sol, ...tail];
    const target = caretInBar() ? Math.min(tokens.length, caretMoveIndex()) : tokens.length;
    const from = animateFrom;
    animateFrom = null;
    const start = scrambledState(session.scramble);
    const animate = from !== null && from < tokens.length && target === tokens.length && tokens.length - from <= 24 && prefs().animSpeed > 0
      && player.start === start && player.tokens.length === from && player.pos === from && tokens.slice(0, from).every((t, i) => t === player.tokens[i]);
    if (animate) {
      player.setSequence(tokens, [], from, start);
      player.playTo(tokens.length);
    } else player.setSequence(tokens, [], target, start);
  }

  function renderPlayback() {
    const scrub = $('scrub');
    if (scrub && player) {
      scrub.max = String(player.length);
      scrub.value = String(player.pos);
    }
    const label = $('cube-step');
    if (label && player) label.textContent = player.length ? `${player.pos}/${player.length}` : '';
    const play = $('pb-play');
    if (play && player) play.textContent = player.playing ? '||' : '>>';
  }

  function previewCandidate(r) {
    if (!player || !pixelCube || matchMedia('(hover: none)').matches) return;
    const session = sessions.get(activeIndex);
    if (!session) return;
    previewing = true;
    player.pause();
    const toks = [...playbackTokens(session.scramble), ...solutionTokens(session), ...rowTokens(r, session.isAtRoot)];
    pixelCube.setFacelets(applyAlgorithm(SOLVED_FACELETS, toks.join(' ')));
    const note = $('stage-note');
    if (note) note.textContent = 'preview';
  }

  function endPreview() {
    if (!previewing) return;
    previewing = false;
    const note = $('stage-note');
    if (note) note.textContent = '';
    if (player) pixelCube.setFacelets(player.stateAt(player.pos));
  }

  function bindCube() {
    const canvas = $('cube-canvas');
    if (!canvas || typeof PixelCube === 'undefined') return;
    const p = prefs();
    pixelCube = new PixelCube(canvas, { resolution: p.pixelRes, backFaces: p.backFaces });
    cubeTheme();
    player = new CubePlayer(pixelCube, renderPlayback);
    player.speed = p.animSpeed > 0 ? p.animSpeed : 1;
    const stage = $('cube-stage');
    const panel = stage.closest('.cube-panel') || stage;
    // using the cube or its controls keeps the playback where the user put it
    panel.addEventListener('pointerdown', () => { manualPlayback = true; });
    // drag to orbit; two fingers pinch to zoom; the wheel zooms
    const pointers = new Map();
    let pinch = 0;
    const spread = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      stage.setPointerCapture(e.pointerId);
      if (pointers.size === 2) pinch = spread();
    });
    stage.addEventListener('pointermove', (e) => {
      const last = pointers.get(e.pointerId);
      if (!last) return;
      const now = { x: e.clientX, y: e.clientY };
      pointers.set(e.pointerId, now);
      if (pointers.size === 2) {
        const d = spread();
        if (pinch > 0) pixelCube.zoomBy(d / pinch);
        pinch = d;
        return;
      }
      pixelCube.orbit((now.x - last.x) * 0.012, (now.y - last.y) * 0.012);
    });
    const end = (e) => { pointers.delete(e.pointerId); pinch = 0; };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      pixelCube.zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
    }, { passive: false });
    stage.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) pixelCube.resetView(); });
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    on('zoom-in', () => pixelCube.zoomBy(1.2));
    on('zoom-out', () => pixelCube.zoomBy(1 / 1.2));
    on('pb-start', () => { player.pause(); player.seek(0, false); });
    on('pb-end', () => { player.pause(); player.seek(player.length, false); });
    on('pb-back', () => { player.pause(); player.step(-1); });
    on('pb-fwd', () => { player.pause(); player.step(1); });
    on('pb-play', () => player.play());
    on('pb-full', () => {
      if (document.fullscreenElement) document.exitFullscreen();
      else if (stage.requestFullscreen) stage.requestFullscreen();
    });
    document.addEventListener('fullscreenchange', () => setTimeout(() => pixelCube.resize(), 50));
    const scrub = $('scrub');
    if (scrub) scrub.addEventListener('input', () => { player.pause(); player.seek(parseInt(scrub.value, 10) || 0, false); });
    let resizeTimer = 0;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => pixelCube.resize(), 80); });
  }

  // ---------------------------------------------------------------------
  // The tree-searcher (suggest.js): its picks with reasons, or the critique
  // ---------------------------------------------------------------------
  let critiqueShown = null; // { key, items } while the critique is on screen
  const viewMemo = new Map();

  function viewAfter(session, r) {
    const key = `${session.scramble}|${session.isAtRoot ? r.rotation : session.rotation}|${session.scoredPath}|${r.coreAlg}`;
    if (!viewMemo.has(key)) {
      if (viewMemo.size > 2000) viewMemo.clear();
      const f = replayFacelets(session.scramble, session.isAtRoot ? r.rotation : session.rotation, session.isAtRoot ? '' : session.scoredPath, r.coreAlg);
      viewMemo.set(key, solvedFlags(f).cross ? cubeView(f) : null);
    }
    return viewMemo.get(key);
  }

  function pickContext(session) {
    const a = answers();
    return {
      style: a.style === 'efficiency' ? 'efficiency' : 'tps',
      answers: a,
      isRoot: session.isAtRoot,
      stepAlgs: session.isAtRoot ? [] : session.stepAlgs,
      before: session.isAtRoot ? null : cubeView(replayFacelets(session.scramble, session.rotation, session.scoredPath, '')),
      viewOf: r => viewAfter(session, r),
      lookahead: view.lookaheadDepth > 1,
      finishing: (session.currentNode.state.corners || []).length >= 3,
    };
  }

  function drawSearcherSprites() {
    const p = profile();
    const sprite = $('searcher-sprite');
    if (sprite) searcherAnimator.redraw();
    const chip = $('profile-chip');
    if (chip) {
      drawSearcher(chip.querySelector('canvas'), p ? p.searcher : 0, cssVar('--ink'), cssVar('--bg'));
      const name = $('profile-name');
      if (name) name.textContent = p ? p.name : '';
    }
  }

  /**
   * The tree-searcher's minimal life (developer, 2026-10-11): a pixel shine that
   * runs diagonally across it now and then, a blink when idle, a faster bob
   * and thinking dots while it searches (CSS, .thinking). Off with reduced
   * motion.
   */
  const searcherAnimator = (() => {
    let timer = 0;
    let frame = null; // { shine, blink }
    const still = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    function redraw() {
      const sprite = $('searcher-sprite');
      if (!sprite) return;
      const p = profile();
      drawSearcher(sprite.querySelector('canvas'), p ? p.searcher : 0, cssVar('--ink'), cssVar('--panel'), {
        blink: !!(frame && frame.blink),
        shine: frame && frame.shine !== undefined ? { band: frame.shine, colour: cssVar('--shine') || '#7dff9a' } : null,
      });
    }
    function play(frames, ms) {
      let i = 0;
      const next = () => {
        frame = frames[i++] || null;
        redraw();
        if (frame) timer = setTimeout(next, ms);
        else schedule();
      };
      next();
    }
    function schedule() {
      clearTimeout(timer);
      if (still()) return;
      timer = setTimeout(() => {
        if (document.hidden) { schedule(); return; }
        if (Math.random() < 0.45) play(Array.from({ length: 36 }, (_, k) => ({ shine: k - 4 })), 40);
        else play([{ blink: true }], 140);
      }, 2600 + Math.random() * 3600);
    }
    return { redraw, start: () => { redraw(); schedule(); } };
  })();

  function setThinking(on) {
    const searcher = $('searcher');
    if (searcher) searcher.classList.toggle('thinking', !!on);
  }

  function renderSearcher() {
    const say = $('searcher-say');
    const picksEl = $('picks');
    const actions = $('bubble-actions');
    const title = $('bubble-title');
    if (!say || !picksEl) return;
    const session = sessions.get(activeIndex);
    if (critiqueShown && session && critiqueShown.key === `${activeIndex}|${session.scoredPath}`) return; // the critique stays until something changes
    critiqueShown = null;
    picksEl.innerHTML = '';
    actions.innerHTML = '';
    title.textContent = '';
    const list = currentList();
    const statusBusy = ($('search-status') || {}).dataset ? $('search-status').dataset.state === 'busy' : false;
    setThinking(!session || (!session.isComplete && (!list || statusBusy)) || continuationPending());
    if (!session) { say.textContent = caption('searcher.thinking'); return; }
    if (session.isComplete && llRead && llRead.stage && llRead.stage !== 'done' && llRead.stage !== 'auf') {
      renderLastLayerPicks(session, say, picksEl, title, actions);
      return;
    }
    if (session.isComplete) {
      say.textContent = caption(llRead && llRead.stage === 'auf' ? 'searcher.ll.auf' : 'searcher.solved');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'px-btn primary';
      b.textContent = caption('critique.button');
      b.addEventListener('click', runCritique);
      actions.appendChild(b);
      return;
    }
    let pickList = list;
    if (reading && reading.tail.tokens.length) {
      if (tailStep) {
        say.textContent = caption(tailStep.last ? 'searcher.lastDone' : 'searcher.stepDone', { label: tailStep.label });
        return;
      }
      if (!suggestions.some(s => s.kind === 'alg')) {
        say.textContent = caption(continuationPending() || !shownFinal ? 'searcher.following' : 'searcher.offNode');
        return;
      }
      // picks that carry on what is typed, when only the continuation has it
      const cont = continuationFor(reading.tail);
      if (cont && list && !prefixMatches(list, reading.tail.tokens, reading.tail.partial, session.isAtRoot).length) pickList = cont;
    }
    if (!pickList || !pickList.length) { say.textContent = caption(list ? 'solve.noResults' : 'searcher.thinking'); return; }
    let picks = searcherPicks(pickList, pickContext(session));
    if (reading && reading.tail.tokens.length) {
      // only picks that start like what is typed
      picks = picks.filter(p => prefixMatches([p.r], reading.tail.tokens, reading.tail.partial, session.isAtRoot).length);
    }
    const ls = lastSlotPick(session, picks);
    if (ls && (!reading || !reading.tail.tokens.length || prefixMatches([ls.r], reading.tail.tokens, reading.tail.partial, false).length)) picks.push(ls);
    say.textContent = caption(!picks.length ? 'searcher.keepGoing' : picks.length > 1 ? 'searcher.greeting' : 'searcher.greetingOne');
    picks.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick';
      const why = p.reasons.slice(0, 1).map(x => caption(`reason.${x.key}`, x.vars)).join(' ');
      const tokens = rowTokens(p.r, session.isAtRoot).join(' ');
      b.innerHTML = `<span class="tag">${esc(caption(`searcher.pick.${p.role}`))}</span><span class="alg">${esc(tokens)}</span><span class="why">${esc(why)}</span>`;
      b.addEventListener('click', () => commitSuggestion(p.r));
      b.addEventListener('mouseenter', () => previewCandidate(p.r));
      b.addEventListener('mouseleave', endPreview);
      picksEl.appendChild(b);
    });
  }

  /**
   * After the F2L: the case on the cube and up to three algs -- the fastest
   * of the method's set, the community's favourite when it is another one,
   * and the fastest of the other set that applies (a whole last layer when
   * the edges are oriented). Every pick says why, in words.
   */
  function renderLastLayerPicks(session, say, picksEl, title, actions) {
    if (!Object.keys(LastLayer.LOADED).length) { say.textContent = caption('searcher.thinking'); ensureLastLayerData(); return; }
    if (llRead.finished) { say.textContent = caption('searcher.ll.stepDone', { label: llRead.finished.label }); return; }
    const pool = LastLayer.suggestions(llRead.cube, LastLayer.LOADED, view.llMethod);
    const { tokens, partial } = typedTail();
    const fits = tokenPrefixMatches(pool, tokens, partial);
    if (!pool.length) { say.textContent = caption('searcher.ll.unknown'); return; }
    if (!fits.length) { say.textContent = caption('searcher.keepGoing'); return; }
    const picks = [];
    const add = (m, role, why) => { if (m && !picks.some(p => p.m === m)) picks.push({ m, role, why }); };
    const firstSet = fits[0].setId;
    const own = fits.filter(m => m.setId === firstSet);
    add(own[0], 'll.best', own[0].src === 'gen' ? 'll.new' : 'll.fastest');
    const fav = own.filter(m => m.src === 'db').sort((a, b) => (b.alg.votes || 0) - (a.alg.votes || 0))[0];
    if (fav && fav !== own[0]) add(fav, 'll.favourite', 'll.favourite');
    const other = fits.find(m => m.setId !== firstSet);
    if (other) add(other, `ll.set.${other.setId}`, other.setId === 'zbll' ? 'll.whole' : other.setId === 'oll' ? 'll.twoLook' : 'll.other');
    title.textContent = fits[0].label;
    say.textContent = caption('searcher.ll.case', { label: fits[0].label });
    picks.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick';
      b.innerHTML = `<span class="tag">${esc(caption(`searcher.pick.${p.role}`, { set: p.m.setId }))}</span><span class="alg">${esc(p.m.toks.join(' '))}</span><span class="why">${esc(caption(`reason.${p.why}`, { label: p.m.label }))}</span>`;
      b.addEventListener('click', () => commitLastLayer({ toks: p.m.toks, label: p.m.label }));
      picksEl.appendChild(b);
    });
    // every alg of the case, on the algs page
    const more = document.createElement('a');
    more.className = 'px-btn quiet';
    more.href = `algs.html#${fits[0].setId}/${String(fits[0].caseName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    more.target = '_blank';
    more.rel = 'noopener';
    more.textContent = caption('searcher.ll.more');
    actions.appendChild(more);
  }

  function bindSearcher() {
    const sprite = $('searcher-sprite');
    const searcher = $('searcher');
    if (!sprite || !searcher) return;
    if (matchMedia('(max-width: 600px)').matches) { searcher.classList.add('collapsed'); sprite.setAttribute('aria-expanded', 'false'); }
    sprite.addEventListener('click', () => {
      const collapsed = searcher.classList.toggle('collapsed');
      sprite.setAttribute('aria-expanded', String(!collapsed));
    });
    drawSearcherSprites();
    searcherAnimator.start();
  }

  // ---------------------------------------------------------------------
  // The critique (critique.js)
  // ---------------------------------------------------------------------
  async function runCritique() {
    const session = getOrCreateSession(activeIndex);
    const say = $('searcher-say');
    const picksEl = $('picks');
    const actions = $('bubble-actions');
    const searcher = $('searcher');
    if (searcher) searcher.classList.remove('collapsed');
    $('bubble-title').textContent = caption('critique.title');
    picksEl.innerHTML = '';
    actions.innerHTML = '';
    critiqueShown = { key: `${activeIndex}|${session.scoredPath}`, items: null };
    if (!session.committedRows.length) { say.textContent = caption('critique.needSolve'); return; }
    say.textContent = caption('critique.working');
    setThinking(true);
    let h;
    try { h = await ensureHelper(); } catch (err) { say.textContent = caption('solve.loadFailed'); setThinking(false); return; }
    const ph = await ensurePseudoHelper();
    const myKey = critiqueShown.key;
    const report = await critiqueSolve(session, {
      search: (fork, { multislot }) => {
        // through the scheduler; unfiltered: the step is ranked among every result for its goal
        const opts = searchOptions(ACTIVE);
        const job = scheduler.submit(wrap => searchWithLookahead(fork, wrap(h), () => {}, wrap(ph), {
          ...opts, depth: 1, filter: null, filterKey: '', multislot, lookaheadMultislot: multislot,
        }), ACTIVE);
        return job.promise;
      },
      answers: answers(),
    });
    setThinking(false);
    if (!critiqueShown || critiqueShown.key !== myKey) return;
    say.textContent = caption('critique.intro');
    const ol = document.createElement('ol');
    ol.className = 'critique-list';
    for (const item of report.items) {
      const li = document.createElement('li');
      li.innerHTML = `<div>${esc(item.text)}</div>${item.alt ? `<div class="alt">${esc(item.alt)}</div>` : ''}`;
      li.addEventListener('click', () => {
        if (!player) return;
        manualPlayback = true;
        player.pause();
        player.seek(item.startMove, false);
        if (item.altRow) previewCandidateAt(session, item.stepIndex, item.altRow);
      });
      ol.appendChild(li);
    }
    // the last layer (last-layer.js): each step against its case's algs
    if (llRead && llRead.steps.length && typeof LastLayer !== 'undefined') {
      const start = applyAlgorithm(scrambledState(session.scramble), solutionTokens(session).join(' '));
      const f2lMoves = solutionTokens(session).length;
      for (const item of LastLayer.critique(start, llRead.steps, LastLayer.LOADED, view.llMethod)) {
        const li = document.createElement('li');
        const alt = item.alt ? caption(item.alt.key, item.alt.vars) : '';
        li.innerHTML = `<div>${esc(caption(item.key, item.vars))}</div>${alt ? `<div class="alt">${esc(alt)}</div>` : ''}`;
        li.addEventListener('click', () => {
          if (!player) return;
          manualPlayback = true;
          player.pause();
          player.seek(f2lMoves + item.at, false);
        });
        ol.appendChild(li);
      }
    }
    const total = document.createElement('li');
    total.className = 'total';
    total.textContent = report.total;
    ol.appendChild(total);
    picksEl.appendChild(ol);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'px-btn';
    close.textContent = 'ok';
    close.addEventListener('click', () => { critiqueShown = null; renderSearcher(); });
    actions.appendChild(close);
  }

  /** Shows the cube after the critique's alternative for step `k` (instead of the user's step). */
  function previewCandidateAt(session, k, row) {
    if (!pixelCube) return;
    const toks = [...playbackTokens(session.scramble)];
    session.committedRows.slice(0, k).forEach((r, i) => toks.push(...rowTokens(r, i === 0)));
    toks.push(...rowTokens(row, k === 0));
    pixelCube.setFacelets(applyAlgorithm(SOLVED_FACELETS, toks.join(' ')));
    const note = $('stage-note');
    if (note) note.textContent = 'my alternative · press > to go back';
  }

  // ---------------------------------------------------------------------
  // Undo, settings drawer, new scramble
  // ---------------------------------------------------------------------
  async function handleUndo() {
    const session = getOrCreateSession(activeIndex);
    if (!editor || !reading) return;
    if (llRead && !llRead.tailTokens.length && llRead.steps.length) {
      // a last-layer step: its lines go
      const st = llRead.steps[llRead.steps.length - 1];
      setEditorText(editor.value.slice(0, reading.parsed[llRead.base + st.firstLine].start));
      return;
    }
    if (reading.tail.tokens.length) {
      // first the unfinished moves
      setEditorText(textBeforeTail());
      return;
    }
    if (!session.canUndo) return;
    const last = session.committedRows.length - 1;
    const first = reading.lines.findIndex(l => l.row === last);
    if (first < 0) { session.undo(); setEditorText(rowsText(session)); return; }
    let start = reading.parsed[first].start;
    // the inspection line belongs to the first step
    if (last === 0) start = 0;
    setEditorText(editor.value.slice(0, start));
  }
  window.handleUndoClick = handleUndo;

  function applyLook() {
    const p = prefs();
    applyProfileLook(profile());
    if (pixelCube) {
      pixelCube.setResolution(p.pixelRes);
      pixelCube.setBackFaces(p.backFaces);
      cubeTheme();
    }
    if (player) player.speed = p.animSpeed > 0 ? p.animSpeed : 1;
    drawSearcherSprites();
  }

  function bindSettings() {
    const dialog = $('settings');
    const btn = $('settings-btn');
    if (!dialog || !btn || typeof dialog.showModal !== 'function') return;
    btn.addEventListener('click', () => { syncLookControls(); dialog.showModal(); });
    $('settings-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    const themes = $('theme-choices');
    if (themes) {
      for (const t of PROFILE_THEMES) {
        const label = document.createElement('label');
        label.className = 'px-check';
        label.innerHTML = `<input type="radio" name="theme" value="${t}"> ${t}`;
        label.querySelector('input').addEventListener('change', () => setPref({ theme: t }));
        themes.appendChild(label);
      }
    }
    const res = $('pixel-res');
    if (res) res.addEventListener('change', () => setPref({ pixelRes: res.value }));
    const back = $('back-faces');
    if (back) back.addEventListener('change', () => setPref({ backFaces: back.checked }));
    const speed = $('anim-speed');
    if (speed) speed.addEventListener('change', () => setPref({ animSpeed: Number(speed.value) }));
    const signOut = $('sign-out');
    if (signOut) signOut.addEventListener('click', () => { cubeProfiles.signOut(); location.href = 'index.html'; });
    const apply = $('apply-search');
    if (apply) apply.addEventListener('click', () => persistAndNavigate());
  }

  function syncLookControls() {
    const p = prefs();
    document.querySelectorAll('#theme-choices input').forEach((i) => { i.checked = i.value === (p.theme || 'ink'); });
    const res = $('pixel-res');
    if (res) res.value = p.pixelRes || 'chunky';
    const back = $('back-faces');
    if (back) back.checked = p.backFaces !== false;
    const speed = $('anim-speed');
    if (speed) speed.value = String(p.animSpeed === undefined ? 1 : p.animSpeed);
  }

  function setPref(patch) {
    const p = profile();
    if (p) cubeProfiles.update(p.id, { prefs: patch });
    applyLook();
  }

  function bindNewScramble() {
    const btn = $('new-scramble-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const scr = typeof generateRandomStateScramble === 'function' ? generateRandomStateScramble() : generateScramble();
      scrambleController.sequenceList.push(scr);
      if (criteria) {
        criteria.scrambles = scrambleController.sequenceList.slice();
        try { localStorage.setItem(scopedKey(STORAGE_KEY), JSON.stringify(normalizeCriteria({ ...criteria, version: CRITERIA_VERSION }))); } catch (err) { /* not remembered */ }
        const ta = $('scramble-input');
        if (ta) ta.value = criteria.scrambles.join('\n');
      }
      scrambleController.activeIndex = scrambleController.sequenceList.length - 1;
      scrambleController.render();
    });
  }

  // ---------------------------------------------------------------------
  // Persistence: committed rows and the solution text of every scramble
  // ---------------------------------------------------------------------
  function sameList(a, b) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
  }

  function persistSessionState() {
    try {
      const sessionsOut = {};
      const texts = {};
      for (const [idx, session] of sessions.entries()) {
        if (session.committedRows.length) sessionsOut[idx] = session.committedRows;
        if (session._text) texts[idx] = session._text;
      }
      localStorage.setItem(scopedKey(SESSION_STATE_KEY), JSON.stringify({
        scrambles: criteria ? criteria.scrambles : [],
        colors: criteria ? criteria.colors : [],
        advanced: criteria ? criteria.advanced : [],
        activeIndex,
        sessions: sessionsOut,
        texts,
      }));
    } catch (err) {
      console.error('Failed to persist session state', err);
    }
  }

  // A saved blob is only trusted when it matches the CURRENT search criteria
  // exactly: progress is never replayed onto a tree it was not made on.
  function loadPersistedState(crit) {
    let raw;
    try { raw = localStorage.getItem(scopedKey(SESSION_STATE_KEY)); } catch (err) { return null; }
    if (!raw) return null;
    let saved;
    try { saved = JSON.parse(raw); } catch (err) { return null; }
    if (!crit || !sameList(saved.scrambles, crit.scrambles)
      || !sameList(saved.colors, crit.colors) || !sameList(saved.advanced, crit.advanced)) {
      return null;
    }
    return saved;
  }

  // Replays each scramble's committed rows through the same commit() a click
  // would use; the text comes back as it was typed.
  function rehydrateSessions(saved) {
    const n = scrambleController.sequenceList.length;
    for (const [idxStr, rows] of Object.entries(saved.sessions || {})) {
      const idx = Number(idxStr);
      if (!Number.isInteger(idx) || idx < 0 || idx >= n) continue;
      const session = getOrCreateSession(idx);
      for (const row of rows) session.commit(row);
    }
    for (const [idxStr, text] of Object.entries(saved.texts || {})) {
      const idx = Number(idxStr);
      if (!Number.isInteger(idx) || idx < 0 || idx >= n) continue;
      getOrCreateSession(idx)._text = String(text);
    }
  }

  function clampIndex(idx, length) {
    if (!Number.isInteger(idx) || !length) return 0;
    return Math.max(0, Math.min(idx, length - 1));
  }

  // Hooks called by script.js (DOMContentLoaded and scrambleController.render()).
  window.onPrunedTreeReady = function (tree, crit) {
    // the alg sets load once the solver is up (the last pair and the last layer use them)
    setTimeout(ensureLastLayerData, 1500);
    prunedTree = tree;
    criteria = crit;
    sessions.clear();
    loadViewPrefs(crit);
    syncViewControls();
    bindViewControls();
    bindSolutionActions();
    bindEditor();
    bindCube();
    bindSearcher();
    bindSettings();
    bindNewScramble();
    const saved = loadPersistedState(crit);
    if (saved) {
      rehydrateSessions(saved);
      scrambleController.activeIndex = clampIndex(saved.activeIndex, scrambleController.sequenceList.length);
    }
    scrambleController.render();
  };

  window.onActiveScrambleChanged = function (index) {
    if (index !== activeIndex) {
      setSessionPriority(activeIndex, BACKGROUND);
      critiqueShown = null;
    }
    // the editor's text belongs to the session it was loaded for
    if (editorSession && editor) editorSession._text = editor.value;
    activeIndex = index;
    if (!prunedTree) return;
    const session = getOrCreateSession(index);
    if (editor) {
      editor.value = session._text !== undefined ? session._text : rowsText(session);
      editorSession = session;
      animateFrom = null;
    }
    shownResults = null;
    shownOwner = null;
    reading = null;
    continuation = null;
    syncEditor();
    persistSessionState();
    runSearch();
  };
})();
