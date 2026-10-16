/**
 * solver.html: the solution bar (solve-editor.js), the
 * suggestions (suggest.js), the critique (critique.js), the cube and Options.
 */
'use strict';

// Bump whenever crossSolver/ or pseudoCrossSolver/ binaries or workers change:
// the workers forward this query string to solver.js/pseudo.js and to the
// .wasm files, so a browser can never keep running a cached older engine
// (which would silently lack e.g. setNoopMoves).
const ENGINE_VERSION = '20261006b';
const ENGINE_GLUE_VERSION = '2';

// The cache-buster this script was loaded with (solver.html's ?v=...), passed
// on to the post-processing workers so they load the same script versions.
const UI_SCRIPT_QUERY = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src)
  ? new URL(document.currentScript.src).search : '';

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

  const HARDWARE_THREADS = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
  const ENGINE_POOL_SIZE = HARDWARE_THREADS >= 8 ? 2 : 1;

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

  async function ensurePseudoHelper() {
    const needed = prunedTree && typeof isPseudoState === 'function'
      && prunedTree.nodes.some(n => isPseudoState(n.state));
    if (!needed || typeof PseudoSolverHelper === 'undefined') return null;
    if (!pseudoHelper) {
      try {
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
            const seed = !!waiting[best].job.seedOnly;
            const w = workers.find(x => !x.broken && x.pending.size < 1)
              || (seed ? workers.find(x => !x.broken && x.pending.size < 2 && !x.seeding) : null);
            if (!w) return;
            const { ctx, job: queued, cores, prepare, live, resolve, reject } = waiting.splice(best, 1)[0];
            const job = prepare ? prepare(queued) : queued;
            const id = nextId++;
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
      session._status = 'pending'; // pending|searching|done|error
      sessions.set(index, session);
    }
    return sessions.get(index);
  }

  const $ = id => document.getElementById(id);
  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const profile = () => (typeof cubeProfiles !== 'undefined' && cubeProfiles ? cubeProfiles.active() : null);
  const answers = () => (profile() && profile().answers) || {};
  const prefs = () => ({ ...(typeof PROFILE_DEFAULT_PREFS !== 'undefined' ? PROFILE_DEFAULT_PREFS : {}), ...((profile() && profile().prefs) || {}) });

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

  function tailText() {
    if (!reading || !reading.tail.tokens.length) return '';
    if (!llRead) return reading.tail.tokens.join(' ');
    const lines = llRead.steps.map(st => `${st.toks.join(' ')} // ${st.label}`);
    if (llRead.tailTokens.length) lines.push(llRead.tailTokens.join(' '));
    return lines.join('\n');
  }

  function solutionCounts(session) {
    const c = moveCounts(session);
    let stm = c.stm, etm = c.etm;
    if (llRead) for (const st of llRead.steps) for (const t of st.toks) { etm++; if (!/^[xyz]/.test(t)) stm++; }
    return `${stm} STM · ${etm} ETM`;
  }

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

  const STATUS_LABELS = { pending: 'queued', searching: 'searching…', done: '', error: 'search failed' };
  const PAGE_TITLE = typeof document !== 'undefined' ? document.title : '';

  function renderScrambleStatus() {
    const el = $('scramble-status');
    const session = sessions.get(activeIndex);
    const status = !session ? 'pending' : session.isComplete ? 'done' : (session._status || 'pending');
    if (el) {
      el.textContent = STATUS_LABELS[status] || '';
      el.className = 'scramble-status ' + status;
    }
    const prefix = status === 'searching' ? 'searching… · ' : status === 'error' ? 'failed · ' : '';
    document.title = prefix + PAGE_TITLE;
  }

  function renderScrambleStatusIfActive(session) {
    if (sessions.get(activeIndex) === session) renderScrambleStatus();
  }

  const view = {
    lookaheadDepth: 1, multislot: false, wideMoves: true,
    hideUnorthodox: false, simplePseudo: false, planning: true,
    llMethod: 'oll', // oll | coll | zbll | 1lll
    lsSets: null, // last-slot sets; with any on, the last two pairs are solved one at a time
    hideAwkwardAlgs: true,
  };
  const LS_SET_IDS = ['zbls', 'wv', 'sv', 'vls', 'hls', 'ols'];
  const lastSlotOn = () => !!view.lsSets && LS_SET_IDS.some(k => view.lsSets[k]);
  let shownResults = null; // the current step's list (complete or partial)
  // the scramble and step the list belongs to, so a stale pick can't be committed elsewhere
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
    // keys saved by older versions
    delete view.lookaheadBreadth;
    delete view.noR2L2;
    delete view.pageSize;
    view.simplePseudo = !!view.simplePseudo;
    view.multislot = !!view.multislot;
    view.wideMoves = view.wideMoves !== false;
    view.hideUnorthodox = !!view.hideUnorthodox;
    view.planning = view.planning !== false;
    view.llMethod = ['oll', 'coll', 'zbll', '1lll'].includes(view.llMethod) ? view.llMethod : 'oll';
    // the last-slot sets: saved, else the setup answer, else WV and SV (plus ZBLS with ZBLL)
    const a = answers();
    if (!view.lsSets || typeof view.lsSets !== 'object') {
      const fromAnswers = Array.isArray(a.lastSlot) ? a.lastSlot : null;
      const old = view.lastSlot;
      view.lsSets = Object.fromEntries(LS_SET_IDS.map(k => [k, fromAnswers ? fromAnswers.includes(k)
        : old === false ? false : (k === 'wv' || k === 'sv' || (k === 'zbls' && view.llMethod === 'zbll'))]));
    }
    for (const k of LS_SET_IDS) view.lsSets[k] = !!view.lsSets[k];
    delete view.lastSlot;
    view.hideAwkwardAlgs = view.hideAwkwardAlgs !== false;
    syncLastLayerPrefs();
  }

  function syncLastLayerPrefs() {
    if (typeof LastLayer === 'undefined') return;
    const p = profile();
    const algs = p && cubeProfiles ? cubeProfiles.algs(p.id) : { main: {}, known: {} };
    LastLayer.setPrefs({
      method: view.llMethod,
      style: answers().style === 'efficiency' ? 'efficiency' : 'tps',
      main: algs.main, known: algs.known, knownSets: answers().knownSets || [],
      lastSlot: { ...(view.lsSets || {}) }, hideAwkward: view.hideAwkwardAlgs !== false,
    });
  }

  function saveViewPrefs() {
    try { localStorage.setItem(scopedKey(VIEW_PREFS_KEY), JSON.stringify(view)); } catch (err) { /* private mode: not remembered */ }
  }

  const pseudoOn = () => !!(criteria && (criteria.advanced || []).includes('full_pseudo'));

  function syncViewControls() {
    const set = (id, prop, value) => { const el = $(id); if (el) el[prop] = value; };
    set('lookahead-depth', 'value', String(view.lookaheadDepth));
    const wrap = $('simple-pseudo-wrap');
    if (wrap) wrap.hidden = !pseudoOn();
    set('multislot', 'checked', view.multislot);
    set('wide-moves', 'checked', view.wideMoves);
    set('hide-unorthodox', 'checked', view.hideUnorthodox);
    set('simple-pseudo', 'checked', view.simplePseudo);
    set('pair-planning', 'checked', view.planning);
    set('ll-method', 'value', view.llMethod);
    for (const k of LS_SET_IDS) set(`ls-${k}`, 'checked', !!(view.lsSets && view.lsSets[k]));
    set('hide-awkward-algs', 'checked', view.hideAwkwardAlgs !== false);
  }

  function bindViewControls() {
    const on = (id, ev, fn) => { const el = $(id); if (el) el.addEventListener(ev, fn); };
    const research = () => { saveViewPrefs(); syncViewControls(); runSearch(); };
    const refine = () => { saveViewPrefs(); syncViewControls(); runSearch({ keepRows: true }); };
    on('lookahead-depth', 'change', (e) => { view.lookaheadDepth = parseInt(e.target.value, 10) || 1; research(); });
    on('simple-pseudo', 'change', (e) => { view.simplePseudo = e.target.checked; refine(); });
    on('hide-unorthodox', 'change', (e) => { view.hideUnorthodox = e.target.checked; refine(); });
    on('wide-moves', 'change', (e) => { view.wideMoves = e.target.checked; refine(); });
    on('multislot', 'change', (e) => { view.multislot = e.target.checked; refine(); });
    on('pair-planning', 'change', (e) => { view.planning = e.target.checked; research(); });
    const relist = () => { saveViewPrefs(); syncViewControls(); syncLastLayerPrefs(); lastSlotMemo.clear(); renderSuggestions(); renderSearcher(); };
    on('ll-method', 'change', (e) => {
      view.llMethod = e.target.value;
      if (view.llMethod === '1lll' && llAvailable() && !LastLayer.LOADED['1lll']) LastLayer.load('1lll', AlgSets.dataUrl('1lll')).then(() => { renderSuggestions(); renderSearcher(); }).catch(() => null);
      relist();
    });
    on('hide-awkward-algs', 'change', (e) => { view.hideAwkwardAlgs = e.target.checked; relist(); });
    for (const k of LS_SET_IDS) {
      on(`ls-${k}`, 'change', (e) => {
        view.lsSets[k] = e.target.checked;
        syncLastLayerPrefs();
        lastSlotMemo.clear();
        if (k === 'ols' && e.target.checked && llAvailable()) LastLayer.loadOlsMore().then(() => { lastSlotMemo.clear(); renderSuggestions(); renderSearcher(); });
        refine();
      });
    }
  }

  function setStatus(msg, kind = 'busy') {
    const el = $('search-status');
    if (el) {
      el.textContent = msg || '';
      el.dataset.state = kind;
    }
    const searcher = $('suggestions');
    if (searcher) searcher.classList.toggle('thinking', kind === 'busy');
  }

  function renderActiveResults(results, partial = false) {
    if (Array.isArray(window.CUBETREE_TRACE)) window.CUBETREE_SHOWN = results;
    shownResults = results;
    shownOwner = activeStepKey();
    shownPartial = partial;
    const final = !partial || results.lookaheadPending === 0
      || (results.onlyMultislotPending && !view.multislot && !results.lookaheadPending);
    shownFinal = final;
    if (results.failedCalls) setStatus(caption('solve.someFailed'), 'error');
    else if (final && !results.length) setStatus(caption('solve.noResults'), 'done');
    else setStatus('', final ? 'done' : 'busy');
    renderSuggestions();
    renderSearcher();
    if (final) maybeContinuationSearch();
  }

  const scheduler = createSearchScheduler();
  const { ACTIVE, BACKGROUND } = SEARCH_PRIORITY;

  let nodeById = null;
  function finishesF2l(r) {
    if (!prunedTree) return false;
    if (!nodeById || nodeById.tree !== prunedTree) { nodeById = new Map(prunedTree.nodes.map(n => [n.id, n])); nodeById.tree = prunedTree; }
    const node = nodeById.get(r.targetNodeId);
    return !!node && (node.state.corners || []).length >= 4;
  }

  function resultFilter() {
    const simple = pseudoOn() && view.simplePseudo;
    const orthodox = view.hideUnorthodox;
    const single = !view.multislot;
    const noWide = !view.wideMoves;
    // with a last-slot set on, the last pair goes in on its own
    const lastTwo = !single && lastSlotOn();
    if (!simple && !orthodox && !single && !noWide && !lastTwo) return { fn: null, key: '' };
    return {
      fn: r => !(simple && r.fullPseudoOnly) && !(orthodox && r.unorthodox)
        && !(single && r.multislot) && !(noWide && isWideAlg(r.coreAlg))
        && !(lastTwo && r.multislot && (r.corners || []).length > 1 && finishesF2l(r)),
      key: [simple ? 'simple' : '', orthodox ? 'orthodox' : '', single ? 'single' : '', noWide ? 'nowide' : '', lastTwo ? 'lastslot' : ''].join(''),
    };
  }

  function searchOptions(priority) {
    const lookahead = priority === ACTIVE ? view.lookaheadDepth : 1;
    const filter = resultFilter();
    return {
      depth: lookahead,
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
    const key = [session.currentNodeId, session.scoredPath, opts.depth, opts.filterKey, opts.planning ? '' : 'noplan'].join('|');
    if (!session.resultsCache || session.resultsCache.key !== key) {
      if (session.resultsCache && session.resultsCache.job) scheduler.setStale(session.resultsCache.job);
      session._status = 'searching';
      renderScrambleStatusIfActive(session);
      const cache = { key, live: null, bests: new Map() };
      session.resultsCache = cache;
      const isShown = () => sessions.get(activeIndex) === session && session.resultsCache === cache;
      const onStatus = () => { if (isShown() && !cache.live) setStatus('', 'busy'); };
      onStatus();
      const onUpdate = (list) => {
        if (session.resultsCache !== cache) return;
        cache.live = list;
        if (isShown()) renderActiveResults(list, true);
      };
      const isCancelled = () => session.resultsCache !== cache;
      const job = submitLookahead(session, cache, h, ph, opts, priority, { onUpdate, onStatus, isCancelled, isShown });
      const promise = job.promise;
      cache.job = job;
      cache.promise = promise;
      promise.then((list) => {
        cache.live = null;
        if (session.resultsCache !== cache) return;
        session._status = 'done';
        renderScrambleStatusIfActive(session);
        if (list && list.stepResults) cache.stepResults = list.stepResults;
        if (list && list.lookaheadMore) growLater(session, cache, h, ph, opts, { onUpdate, onStatus, isCancelled, isShown });
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

  function submitLookahead(session, cache, h, ph, opts, priority, { onUpdate, onStatus, isCancelled, isShown }, stepResults = null) {
    let job = null;
    const grow = () => isShown() && !isCancelled() && !document.hidden && !!job && !scheduler.busyBesides(job)
      && !continuationPending();
    job = scheduler.submit((wrap) => {
      if (session.postProcessor && session.postProcessor.forJob) session.postProcessor = session.postProcessor.forJob(job);
      return searchWithLookahead(session, wrap(h), onStatus, wrap(ph), { ...opts, onUpdate, isCancelled, grow, bests: cache.bests, stepResults });
    }, priority);
    trackJob(session, job, priority);
    return job;
  }

  function growLater(session, cache, h, ph, opts, hooks) {
    const stepResults = session.resultsCache === cache ? cache.stepResults : null;
    scheduler.whenIdle(() => {
      if (session.resultsCache !== cache || !hooks.isShown()) return;
      if (document.hidden) { document.addEventListener('visibilitychange', () => growLater(session, cache, h, ph, opts, hooks), { once: true }); return; }
      const job = submitLookahead(session, cache, h, ph, opts, ACTIVE, hooks, stepResults);
      cache.job = job;
      job.promise.then((list) => {
        if (session.resultsCache !== cache || !list) return;
        renderActiveResults(list);
        if (list.lookaheadMore) growLater(session, cache, h, ph, opts, hooks);
      }, () => {});
    });
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
    if (llRead) { try { markTypedKnown(session); } catch (e) { /* the marking is a convenience */ } }
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

  function readLastLayer(session) {
    return reading && editor ? readLastLayerOf(session, reading, editor.value) : null;
  }
  function readLastLayerOf(session, reading, text) {
    if (!session.isComplete || !reading || !llAvailable()) return null;
    ensureLastLayerData();
    let lastF2l = -1;
    reading.lines.forEach((x, li) => { if (x.kind === 'step' || x.kind === 'merged') lastF2l = li; });
    const first = reading.tail.tokens.length ? reading.tail.line : lastF2l + 1;
    const parsed = reading.parsed.slice(first);
    const lineToks = l => l.tokens.filter(t => t.valid).map(t => normTok(t.tok));
    const start = applyAlgorithm(scrambledState(session.scramble), solutionTokens(session).join(' '));
    const readLines = n => LastLayer.readSteps(start, parsed.slice(0, n).map(l => ({ tokens: lineToks(l) })), LastLayer.LOADED);
    let done = text.endsWith('\n') ? parsed.length : Math.max(0, parsed.length - 1);
    let r = readLines(done);
    if (done < parsed.length) {
      const all = readLines(parsed.length);
      if (all.stage === 'done' && !all.tail.tokens.length) { done = parsed.length; r = all; }
    }
    for (const st of r.steps) {
      for (let li = st.firstLine; li <= st.lastLine; li++) {
        reading.lines[first + li] = { kind: li === st.lastLine ? 'step' : 'merged', label: li === st.lastLine ? st.label : null };
      }
    }
    const open = done < parsed.length ? lineToks(parsed[done]) : [];
    const tailTokens = [...r.tail.tokens, ...open];
    const tailLine = first + (r.tail.tokens.length ? r.tail.firstLine : done);
    let finished = null;
    if (tailTokens.length && done < parsed.length) {
      try {
        const after = applyAlgorithm(r.cube, tailTokens.join(' '));
        const next = LastLayer.stageOf(after);
        if (next && r.stage && LastLayer.STAGE_RANK[next] > LastLayer.STAGE_RANK[r.stage]) {
          const auf = next === 'auf' ? (LastLayer.suggestions(after, LastLayer.LOADED)[0] || {}).toks || [] : [];
          finished = { label: LastLayer.stepLabel(r.cube, r.stage, next, LastLayer.LOADED), stage: auf.length ? 'done' : next, auf };
        }
      } catch (e) { finished = null; }
    }
    return { steps: r.steps, base: first, cube: r.cube, stage: r.stage, tailTokens, tailLine, finished };
  }

  const llAvailable = () => typeof LastLayer !== 'undefined' && typeof AlgSets !== 'undefined';
  let llLoading = null;
  function ensureLastLayerData() {
    if (llLoading || !llAvailable()) return llLoading;
    llLoading = Promise.all(AlgSets.SETS.filter(s => s.id !== '1lll' || view.llMethod === '1lll').map(s => LastLayer.load(s.id, AlgSets.dataUrl(s.id)).catch(() => null)))
      .then(() => (view.lsSets && view.lsSets.ols ? LastLayer.loadOlsMore() : null))
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

  function renderEditor() {
    if (!editor || !reading) return;
    const text = editor.value;
    const shadow = $('editor-shadow');
    const sizer = $('editor-sizer');
    let html = '';
    reading.parsed.forEach((line, li) => {
      const kind = reading.lines[li].kind;
      let pos = line.start;
      html += '<span class="ln">';
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
      html += line.start === line.end ? '\u200b</span>' : '</span>';
      if (li < reading.parsed.length - 1) html += '\n';
    });
    const ghost = ghostText();
    if (ghost && document.activeElement === editor && editor.selectionStart === text.length) {
      html += `<span class="ghost">${esc(ghost)}</span><span class="ghost-key">tab</span>`;
    }
    if (!text) html = `<span class="ghost">${esc(caption('solve.placeholder'))}</span>`;
    shadow.innerHTML = html + '\n';
    sizer.textContent = text + (ghost ? ghost + '     ' : '') + '\n';
    layoutGutter();
  }

  function stepGroups() {
    const out = [];
    if (!reading) return out;
    const startMove = [];
    let n = 0;
    reading.parsed.forEach((line, li) => { startMove[li] = n; n += line.tokens.filter(t => t.valid).length; });
    startMove.push(n);
    let first = -1;
    reading.lines.forEach((info, li) => {
      const next = reading.lines[li + 1];
      const joins = info.kind === 'step' && info.row !== undefined && next && next.kind === 'step' && next.row === info.row;
      if (info.kind === 'merged' || joins) { if (first < 0) first = li; return; }
      if (info.kind === 'step') {
        const f = first < 0 ? li : first;
        out.push({ first: f, last: li, label: info.label, from: startMove[f], to: startMove[li + 1] });
      }
      first = -1;
    });
    return out;
  }

  let critiqueMarks = null;
  const MARKS = { beyond: 'beats the search', best: 'best', slower: 'slower', off: 'slower, unusual' };
  const markHtml = (mark, style = '') => `<b class="mark" data-mark="${mark}"${style}>${MARKS[mark]}</b>`;

  function layoutGutter() {
    const gutter = $('editor-gutter');
    const shadow = $('editor-shadow');
    if (!gutter || !shadow || !reading) return;
    const lines = shadow.querySelectorAll('.ln');
    const box = gutter.getBoundingClientRect();
    if (!box.height) return;
    const rectsOf = (li) => { const el = lines[li]; return el ? el.getClientRects() : []; };
    const session = sessions.get(activeIndex);
    // the marks stay until the solution changes
    const marks = critiqueMarks && session && editor && critiqueMarks.key === `${activeIndex}|${session.scoredPath}` && critiqueMarks.text === editor.value ? critiqueMarks.at : null;
    const pos = player && !previewing ? player.pos : -1;
    let html = '';
    let lit = false;
    stepGroups().forEach((g, i) => {
      const a = rectsOf(g.first);
      const b = rectsOf(g.last);
      if (!a.length || !b.length) return;
      const top = a[0].top - box.top;
      const bottom = b[b.length - 1].bottom - box.top;
      const labelTop = b[0].top - box.top;
      const on = pos > g.from && pos <= g.to;
      if (on) { lit = true; html += `<i class="row-lit" style="top:${top}px;height:${bottom - top}px"></i>`; }
      html += `<b class="step-no${on ? ' on' : ''}" style="top:${labelTop}px">${i + 1}</b>`;
      const mark = marks && marks.get(g.from);
      if (mark) {
        const end = b[b.length - 1];
        const left = Math.min(end.right - box.left + 8, box.width - 34);
        html += markHtml(mark, ` style="top:${end.top - box.top}px;left:${left}px"`);
      }
    });
    if (!lit && pos > 0 && reading.tail.tokens.length) {
      const r = rectsOf(reading.tail.line);
      if (r.length) html += `<i class="row-lit tail" style="top:${r[0].top - box.top}px;height:${r[r.length - 1].bottom - r[0].top}px"></i>`;
    }
    gutter.innerHTML = html;
  }

  function ghostText() {
    const top = suggestions[activeIdx >= 0 ? activeIdx : 0];
    if (!top || !reading) return '';
    const text = editor.value;
    if (top.kind === 'comment') return (/\s$/.test(text) ? '' : ' ') + top.text;
    const { tokens: typed, partial } = typedTail();
    const rest = top.toks.slice(typed.length - (partial ? 1 : 0));
    if (!rest.length) return '';
    if (!typed.length && text && !text.endsWith('\n')) return '\n' + rest.join(' ');
    if (partial) {
      const first = rest[0].slice(partial.length);
      return first + (rest.length > 1 ? ' ' + rest.slice(1).join(' ') : '');
    }
    return (text && !/\s$/.test(text) ? ' ' : '') + rest.join(' ');
  }

  function labelFor(session, r) {
    const before = session.isAtRoot ? 0 : (session.currentNode.state.corners || []).length;
    const node = session.nodeMap.get(r.targetNodeId);
    const after = node ? (node.state.corners || []).length : before + (r.corners || []).length;
    return stepLabel(session.isAtRoot, before, after, /pseudo/i.test(r.type || ''));
  }

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
    endPreview(); // the cube shows the new text, not a preview
    editor.value = text;
    editor.selectionStart = editor.selectionEnd = text.length;
    activeIdx = -1;
    syncEditor();
  }

  const committable = r => !!r && ((currentList() || []).includes(r) || !!(continuation && continuation.list && continuation.list.includes(r))
    || lastSlotRows().includes(r));

  function commitSuggestion(r) {
    const session = getOrCreateSession(activeIndex);
    if (!committable(r)) return;
    (session._followed = session._followed || new Set()).add(rowTokens(r, session.isAtRoot).join(' '));
    const label = labelFor(session, r) + (r.lastSlot ? ` (${r.lastSlot.name})` : '');
    const node = session.nodeMap.get(r.targetNodeId);
    const end = node && (node.state.corners || []).length >= 4 ? '' : '\n'; // the last pair ends the text
    const lines = session.isAtRoot && r.rotation
      ? `${r.rotation} // inspection\n${r.coreAlg} // ${label}${end}`
      : `${r.coreAlg} // ${label}${end}`;
    const before = textBeforeTail();
    setEditorText(before + lines);
    editor.focus();
  }

  function acceptSuggestion() {
    const s = suggestions[activeIdx >= 0 ? activeIdx : 0];
    if (!s) {
      if (finishedTailCommented()) { setEditorText(`${editor.value.replace(/[ \t]+$/, '')}\n`); return true; }
      return false;
    }
    if (s.kind === 'comment') {
      const text = editor.value.replace(/\s+$/, '');
      if (lastLineOf(text).includes('//')) return false; // never a second comment on a line
      setEditorText(`${text} ${s.text}${s.final ? '' : '\n'}`);
      return true;
    }
    if (s.kind === 'll') { commitLastLayer(s); return true; }
    commitSuggestion(s.r);
    return true;
  }

  function commitLastLayer(s) {
    const before = textBeforeTail();
    let solved = false;
    try { solved = LastLayer.stageOf(applyAlgorithm(llRead.cube, s.toks.join(' '))) === 'done'; } catch (e) { solved = false; }
    tabbedLL.add(s.toks.join(' '));
    setEditorText(`${before}${s.toks.join(' ')} // ${s.label}${solved ? '' : '\n'}`);
    editor.focus();
  }

  const lastLineOf = text => text.slice(text.lastIndexOf('\n') + 1);
  function finishedTailCommented() {
    const text = editor.value;
    if (!reading || text.endsWith('\n') || !lastLineOf(text).includes('//')) return false;
    return !!(tailStep || (llRead && llRead.finished));
  }

  function renderSuggestions() {
    const session = sessions.get(activeIndex);
    suggestions = [];
    tailStep = null;
    const text = editor ? editor.value : '';
    const lastLine = reading ? reading.parsed[reading.parsed.length - 1] : null;
    const lastInfo = reading ? reading.lines[reading.parsed.length - 1] : null;
    const commented = !!lastLine && lastLine.commentStart >= 0 && !text.endsWith('\n');
    if (lastLine && !commented && !text.endsWith('\n') && lastInfo && lastInfo.kind === 'step' && lastInfo.label && lastLine.tokens.length) {
      suggestions.push({ kind: 'comment', text: `// ${lastInfo.label}`, final: isLastStepFinal(session) });
    }
    const llTail = session && reading && session.isComplete && llRead && llRead.stage && llRead.stage !== 'done' ? typedTail() : null;
    if (llTail && (!commented || !llTail.tokens.length)) {
      const { tokens, partial } = llTail;
      if (llRead.finished && tokens.length) {
        const f = llRead.finished;
        suggestions.push({ kind: 'comment', text: `${f.auf.length ? `${f.auf.join(' ')} ` : ''}// ${f.label}`, final: f.stage === 'done' });
      } else {
        const pool = LastLayer.suggestions(llRead.cube, LastLayer.LOADED, view.llMethod);
        for (const m of tokenPrefixMatches(pool, tokens, partial)) {
          if (suggestions.length >= 5) break;
          if (suggestions.some(x => x.toks && x.toks.join(' ') === m.toks.join(' '))) continue;
          suggestions.push({ kind: 'll', toks: m.toks, label: m.label, s: m });
        }
      }
    }
    if (session && reading && !session.isComplete) {
      const tail = reading.tail;
      const list = currentList();
      const done = tail.tokens.length && !tail.onNewLine ? stepFromTail(session, tail.tokens, list) : null;
      tailStep = done;
      if (done && !commented) suggestions.push({ kind: 'comment', text: `// ${done.label}`, final: false });
      const pools = commented ? [] : [list, continuationFor(tail), lastSlotRows()].filter(p => p && p.length);
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

  function isLastStepFinal(session) {
    if (!session || !session.isComplete) return false;
    if (!llRead || !llRead.steps.length) return true; // the f2l's last pair
    return llRead.stage === 'done';
  }

  function lastSlotPick(session, picks) {
    const rows = lastSlotRows();
    if (!rows.length) return null;
    const leaves = (r) => {
      try {
        const f = replayFacelets(session.scramble, session.rotation, session.scoredPath, r.coreAlg);
        return LastLayer.stageOf(f);
      } catch (e) { return null; }
    };
    const ofSet = setId => rows.find(r => r.lastSlot.setId === setId && r.lastSlot.main) || rows.find(r => r.lastSlot.setId === setId);
    const ols = ofSet('ols');
    const pickStages = picks.map(p => leaves(p.r));
    if (ols && !pickStages.some(st => st === 'oriented' || st === 'auf' || st === 'done')) {
      return { r: ols, role: 'lastslot.ols', reasons: [{ key: 'ls.skipsOll', vars: { label: ols.lastSlot.name } }] };
    }
    const zbls = ofSet('zbls');
    if (zbls && view.llMethod === 'zbll' && !pickStages.some(st => st && st !== 'f2l')) {
      return { r: zbls, role: 'lastslot.zbls', reasons: [{ key: 'ls.edgesForZbll', vars: { label: zbls.lastSlot.name } }] };
    }
    return null;
  }

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

  const lastSlotMemo = new Map();
  const LS_PER_SET = 4; // algs per set and case
  function lastSlotRows() {
    const session = sessions.get(activeIndex);
    if (!session || session.isComplete || session.isAtRoot || !lastSlotOn() || !llAvailable()) return [];
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
      row.lastSlot = { setId: ls.setId, name: ls.name, caseId: ls.caseId, alg: ls.alg, main: ls.main, tags: ls.tags };
      rows.push(row);
    }
    rows.sort((a, b) => a.tpp - b.tpp);
    lastSlotMemo.set(key, rows);
    return rows;
  }

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

  let continuation = null; // { key, list (null while searching), job }
  let continuationTimer = 0;
  const CONTINUATION_DELAY = 350; // ms after the last keystroke
  const CONTINUATION_ROWS = 400;  // rescored found rests (best first)
  const COLOUR_OF_FACELET = { W: 'white', Y: 'yellow', G: 'green', B: 'blue', R: 'red', O: 'orange' };

  const continuationTyped = tail => (tail.partial ? tail.tokens.slice(0, -1) : tail.tokens).map(normTok);
  const continuationKey = typed => `${activeStepKey()}|${typed.join(' ')}`;

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
    continuation = mine; // pending from now on: the suggestions panel says it's searching
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

  function renderKeyLegend() {
    const el = $('key-legend');
    if (!el) return;
    const keys = k => k.split(' ').map(x => `<kbd>${esc(x)}</kbd>`).join('');
    el.innerHTML = [['tab', 'keys.tab'], ['↑ ↓', 'keys.arrows'], ['esc', 'keys.esc']]
      .map(([k, c]) => `<span>${keys(k)} ${esc(caption(c))}</span>`).join('');
    let t = 0;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(layoutGutter, 60); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(layoutGutter);
  }

  function bindEditor() {
    editor = $('solution-input');
    if (!editor) return;
    editor.addEventListener('input', () => { activeIdx = -1; scheduleSync(); });
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
    for (const ev of ['click', 'keyup', 'focus', 'select']) editor.addEventListener(ev, followCaret);
    document.addEventListener('selectionchange', () => { if (document.activeElement === editor) followCaret(); });
    editor.addEventListener('focus', () => { manualPlayback = false; });
    editor.addEventListener('input', endPreview);
    editor.addEventListener('blur', () => {
      if (manualPlayback || !player || previewing) return;
      player.seek(player.length);
    });
  }

  let pixelCube = null;
  let player = null;
  let previewing = false;
  let previewEl = null; // the button whose preview the cube shows
  let manualPlayback = false; // the playback controls or the cube were used since the bar lost the caret
  const scrambledMemo = new Map();

  function cubeTheme() {
    if (!pixelCube) return;
    pixelCube.setTheme({ bg: cssVar('--field') || '#161618', line: cssVar('--cube-line') || '#f1f1ee', clear: true, floorShadow: true, shadow: cssVar('--shadow') || undefined });
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
    if (k !== player.pos) player.goTo(k);
  }

  function updatePlayer() {
    if (!player || previewing) return;
    const session = sessions.get(activeIndex);
    if (!session) return;
    const sol = solutionTokens(session);
    const tail = reading ? reading.tail.tokens.filter(t => isMoveToken(t)) : [];
    const tokens = [...sol, ...tail];
    const target = caretInBar() ? Math.min(tokens.length, caretMoveIndex()) : tokens.length;
    player.setSequence(tokens, [], target, scrambledState(session.scramble));
  }

  function renderPlayback() {
    const scrub = $('scrub');
    if (scrub && player) {
      scrub.max = String(player.length);
      scrub.value = String(player.pos);
    }
    const label = $('cube-step');
    if (label && player) {
      const g = previewing ? null : stepGroups().find(x => player.pos > x.from && player.pos <= x.to);
      const name = previewing ? caption('stage.preview') : g ? g.label : player.pos ? caption('stage.typing') : caption('stage.scrambled');
      const shown = caseName(name);
      label.innerHTML = player.length || !previewing ? `<b>${esc(shown)}</b>${player.length ? ` <small title="move, rotations included">${player.pos}/${player.length}</small>` : ''}` : '';
    }
    const play = $('pb-play');
    if (play && player) play.textContent = player.playing ? 'Pause' : 'Play';
    renderGauge();
    layoutGutter();
  }

  function renderGauge() {
    const gauge = $('gauge');
    if (!gauge || !player) return;
    const f = player.stateAt(Math.min(player.pos, player.length));
    const flags = solvedFlags(f);
    const faceDone = face => { for (let i = face * 9; i < face * 9 + 9; i++) if (f[i] !== f[face * 9 + 4]) return false; return true; };
    const pairs = flags.cross ? F2L_SLOTS.filter(sl => flags[sl]).length : 0;
    const f2l = flags.cross && pairs === 4;
    const solved = f2l && [0, 1, 2, 3, 4, 5].every(faceDone);
    const on = {
      cross: flags.cross, p1: pairs >= 1, p2: pairs >= 2, p3: pairs >= 3, p4: pairs >= 4,
      oll: f2l && faceDone(0), pll: solved,
    };
    for (const cell of gauge.children) cell.classList.toggle('on', !!on[cell.dataset.stage]);
    gauge.classList.toggle('done', solved);
  }

  function previewCandidate(r, el = null) {
    if (!player || !pixelCube || matchMedia('(hover: none)').matches) return;
    const session = sessions.get(activeIndex);
    if (!session) return;
    previewing = true;
    previewEl = el;
    player.pause();
    const toks = [...solutionTokens(session), ...rowTokens(r, session.isAtRoot)];
    player.setSequence(toks, [], toks.length, scrambledState(session.scramble));
    renderPlayback(); // the box on the cube says it is a preview
  }

  function endPreview() {
    if (!previewing) return;
    previewing = false;
    previewEl = null;
    const note = $('stage-note');
    if (note) note.textContent = '';
    updatePlayer();
  }

  function bindCube() {
    const canvas = $('cube-canvas');
    if (!canvas || typeof PixelCube === 'undefined') return;
    const p = prefs();
    pixelCube = new PixelCube(canvas, { resolution: p.pixelRes, backFaces: p.backFaces });
    cubeTheme();
    player = new CubePlayer(pixelCube, renderPlayback);
    player.speed = p.animSpeed > 0 ? p.animSpeed : 1;
    player.animated = p.animSpeed > 0;
    const stage = $('cube-stage');
    const panel = stage.closest('.cube-panel') || stage;
    panel.addEventListener('pointerdown', () => { manualPlayback = true; });
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
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', (e) => { if (previewing && /^pb-/.test(id)) endPreview(); fn(e); }); };
    on('zoom-in', () => pixelCube.zoomBy(1.2));
    on('zoom-out', () => pixelCube.zoomBy(1 / 1.2));
    on('pb-start', () => player.seek(0));
    on('pb-end', () => player.seek(player.length));
    on('pb-back', () => player.step(-1));
    on('pb-fwd', () => player.step(1));
    on('pb-play', () => player.play());
    const scrub = $('scrub');
    if (scrub) scrub.addEventListener('input', () => player.seek(parseInt(scrub.value, 10) || 0));
    let resizeTimer = 0;
    window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => pixelCube.resize(), 80); });
  }

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

  function drawProfileChip() {
    const p = profile();
    const chip = $('profile-chip');
    if (chip) {
      chip.querySelector('.initial').textContent = p ? (p.name || '?')[0].toUpperCase() : '';
      const name = $('profile-name');
      if (name) name.textContent = p ? p.name : '';
    }
  }

  function setThinking(on) {
    const searcher = $('suggestions');
    if (searcher) searcher.classList.toggle('thinking', !!on);
  }

  const SET_PREFIX = /^(oll|pll|epll|coll|zbll|1lll|ols|zbls|vls|hls|wv|sv)( |$)/i;
  function caseName(label) {
    const s = String(label || '');
    if (!SET_PREFIX.test(s)) return s.replace(/^./, c => c.toUpperCase());
    return s.replace(SET_PREFIX, (m, set, sp) => set.toUpperCase() + sp).replace(/ ([a-z])/, (m, c) => ' ' + c.toUpperCase());
  }

  const comment = label => (label ? `<span class="kind"> // ${esc(label)}</span>` : '');

  const turnCount = moves => String(moves).split(' ').filter(t => t && !/^[xyz]/.test(t)).length;

  function renderSearcher() {
    renderSearcherInner();
    if (!previewing || !previewEl) return;
    if (previewEl.isConnected) return;
    const again = previewEl.dataset.preview && [...document.querySelectorAll('#picks [data-preview]')].find(b => b.dataset.preview === previewEl.dataset.preview);
    if (again) previewEl = again;
    else endPreview();
  }
  function renderSearcherInner() {
    const say = $('suggest-note');
    const picksEl = $('picks');
    const actions = $('suggest-actions');
    const title = $('suggest-title');
    if (!say || !picksEl) return;
    const session = sessions.get(activeIndex);
    if (critiqueShown && session && critiqueShown.key === `${activeIndex}|${session.scoredPath}`) return; // the critique stays until something changes
    critiqueShown = null;
    picksEl.innerHTML = '';
    actions.innerHTML = '';
    title.textContent = caption('suggest.title');
    const list = currentList();
    const statusBusy = ($('search-status') || {}).dataset ? $('search-status').dataset.state === 'busy' : false;
    setThinking(!session || (!session.isComplete && (!list || statusBusy)) || continuationPending());
    if (!session) { say.textContent = caption('suggest.thinking'); return; }
    if (session.isComplete && llRead && llRead.stage && llRead.stage !== 'done' && llRead.stage !== 'auf') {
      renderLastLayerPicks(session, say, picksEl, title, actions);
      return;
    }
    if (session.isComplete) {
      say.textContent = caption(llRead && llRead.stage === 'auf' ? 'suggest.ll.auf' : 'suggest.solved');
      return;
    }
    let pickList = list;
    if (reading && reading.tail.tokens.length) {
      if (tailStep) {
        say.textContent = caption(tailStep.last ? 'suggest.lastDone' : 'suggest.stepDone', { label: caseName(tailStep.label) });
        return;
      }
      if (!suggestions.some(s => s.kind === 'alg')) {
        say.textContent = caption(continuationPending() || !shownFinal ? 'suggest.following' : 'suggest.offNode');
        return;
      }
      const cont = continuationFor(reading.tail);
      if (cont && list && !prefixMatches(list, reading.tail.tokens, reading.tail.partial, session.isAtRoot).length) pickList = cont;
    }
    if (!pickList || !pickList.length) { say.textContent = caption(list ? 'solve.noResults' : 'suggest.thinking'); return; }
    let picks = searcherPicks(pickList, pickContext(session));
    if (reading && reading.tail.tokens.length) {
      picks = picks.filter(p => prefixMatches([p.r], reading.tail.tokens, reading.tail.partial, session.isAtRoot).length);
    }
    const ls = lastSlotPick(session, picks);
    if (ls && (!reading || !reading.tail.tokens.length || prefixMatches([ls.r], reading.tail.tokens, reading.tail.partial, false).length)) picks.push(ls);
    say.textContent = !picks.length ? caption('suggest.keepGoing') : picks.length === 1 ? caption('suggest.greetingOne') : '';
    picks.forEach((p) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick';
      const why = p.reasons.slice(0, 1).map(x => caption(`reason.${x.key}`, x.vars)).join(' ');
      const tokens = rowTokens(p.r, session.isAtRoot).join(' ');
      b.innerHTML = `<span class="alg">${esc(tokens)}${comment(labelFor(session, p.r))}</span><span class="cnt">${turnCount(tokens)} STM</span><span class="why">${esc(why)}</span>`;
      b.addEventListener('click', () => commitSuggestion(p.r));
      b.dataset.preview = `${activeIndex}|${session.committedRows.length}|${tokens}`;
      b.addEventListener('mouseenter', () => previewCandidate(p.r, b));
      b.addEventListener('mouseleave', endPreview);
      const ls = p.r.lastSlot;
      if (ls && ls.caseId && ls.alg && !ls.main) {
        const row = document.createElement('div');
        row.className = 'pick-row';
        const star = document.createElement('button');
        star.type = 'button';
        star.className = 'btn quiet star';
        star.textContent = '★';
        star.title = caption('suggest.ll.makeMain');
        star.setAttribute('aria-label', star.title);
        star.addEventListener('click', () => { setMainAlg(ls.caseId, ls.alg.alg); commitSuggestion(p.r); });
        row.append(b, star);
        picksEl.appendChild(row);
      } else picksEl.appendChild(b);
    });
  }

  let llMore = { caseId: null, page: 0 };
  const LL_PAGE = 3;
  function renderLastLayerPicks(session, say, picksEl, title, actions) {
    if (!Object.keys(LastLayer.LOADED).length) { say.textContent = caption('suggest.thinking'); ensureLastLayerData(); return; }
    if (llRead.finished) { say.textContent = caption('suggest.ll.stepDone', { label: caseName(llRead.finished.label) }); return; }
    const pool = LastLayer.suggestions(llRead.cube, LastLayer.LOADED, view.llMethod);
    const { tokens, partial } = typedTail();
    const fits = tokenPrefixMatches(pool, tokens, partial);
    if (!pool.length) { say.textContent = caption('suggest.ll.unknown'); return; }
    if (!fits.length) { say.textContent = caption('suggest.keepGoing'); return; }
    const firstSet = fits[0].setId;
    const own = fits.filter(m => m.setId === firstSet);
    const cid = own[0].caseId;
    if (llMore.caseId !== cid) llMore = { caseId: cid, page: 0 };
    const picks = [];
    const add = (m, role, why) => { if (m && picks.length < 4 && !picks.some(p => p.m.alg === m.alg && p.m.setId === m.setId)) picks.push({ m, role, why }); };
    const main = own.find(m => m.main);
    const first = [];
    if (main) first.push(main);
    else {
      first.push(own[0]);
      const weight = m => (m.alg.votes || 0) + Math.max(0, (m.alg.from || []).length - 1);
      const fav = own.filter(m => m.src === 'db').sort((a, b) => weight(b) - weight(a))[0];
      if (fav && fav !== own[0]) first.push(fav);
      if (first.length < 2 && own[1]) first.push(own[1]);
    }
    const others = own.filter(m => !first.includes(m));
    const pages = 1 + Math.ceil(others.length / LL_PAGE);
    if (llMore.page >= pages) llMore.page = 0;
    if (main && !llMore.page) {
      add(main, 'll.main', 'll.main');
    } else if (llMore.page) {
      const stm0 = LastLayer.stmOf(own[0].alg.alg);
      others.slice((llMore.page - 1) * LL_PAGE, llMore.page * LL_PAGE).forEach((m) => {
        const d = stm0 - LastLayer.stmOf(m.alg.alg);
        add(m, 'll.more', d >= 1 ? 'll.shorter' : m.src === 'db' ? 'll.community' : 'll.other');
      });
    } else {
      add(own[0], 'll.best', 'll.fastest');
      const weight = m => (m.alg.votes || 0) + Math.max(0, (m.alg.from || []).length - 1);
      const fav = own.filter(m => m.src === 'db').sort((a, b) => weight(b) - weight(a))[0];
      if (fav && fav !== own[0]) add(fav, 'll.favourite', 'll.favourite');
      const other = fits.find(m => m.setId !== firstSet);
      if (other) add(other, `ll.set.${other.setId}`, other.setId === 'zbll' ? 'll.whole' : other.setId === 'oll' ? 'll.twoLook' : 'll.other');
      // at least two
      for (const m of own) { if (picks.length >= 2) break; add(m, 'll.next', 'll.next'); }
    }
    title.textContent = caseName(fits[0].label);
    say.textContent = main && !llMore.page ? caption('suggest.ll.yours') : llMore.page ? caption('suggest.ll.others', { label: caseName(fits[0].label) }) : '';
    picks.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'pick-row';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pick';
      b.innerHTML = `<span class="alg">${esc(p.m.toks.join(' '))}${comment(p.m.label)}</span><span class="cnt">${turnCount(p.m.toks.join(' '))} STM</span><span class="why">${esc(caption(`reason.${p.why}`, { label: caseName(p.m.label) }))}</span>`;
      b.addEventListener('click', () => commitLastLayer({ toks: p.m.toks, label: p.m.label }));
      row.appendChild(b);
      if (!p.m.main) {
        const star = document.createElement('button');
        star.type = 'button';
        star.className = 'btn quiet star';
        star.textContent = '★';
        star.title = caption('suggest.ll.makeMain');
        star.setAttribute('aria-label', caption('suggest.ll.makeMain'));
        star.addEventListener('click', () => { setMainAlg(p.m.caseId, p.m.alg.alg); commitLastLayer({ toks: p.m.toks, label: p.m.label }); });
        row.appendChild(star);
      }
      picksEl.appendChild(row);
    });
    if (pages > 1) {
      const neither = document.createElement('button');
      neither.type = 'button';
      neither.className = 'btn quiet';
      neither.textContent = caption(main && !llMore.page ? 'suggest.ll.change' : 'suggest.ll.neither');
      neither.addEventListener('click', () => { llMore.page = (llMore.page + 1) % pages; renderSearcher(); });
      actions.appendChild(neither);
    }
    const more = document.createElement('a');
    more.className = 'btn quiet';
    more.href = `algs.html#${fits[0].setId}/${String(fits[0].caseName).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    more.target = '_blank';
    more.rel = 'noopener';
    more.textContent = caption('suggest.ll.more');
    actions.appendChild(more);
  }

  function setMainAlg(caseId, alg) {
    const p = profile();
    if (!p || !cubeProfiles) return;
    cubeProfiles.setMainAlg(p.id, caseId, alg);
    syncLastLayerPrefs();
    lastSlotMemo.clear();
  }

  const tabbedLL = new Set(); // alg texts written by tab or a pick
  function markTypedKnown(session) {
    if (!llRead || !cubeProfiles || !profile()) return;
    if (!session._llBaseline) { session._llBaseline = new Set(llRead.steps.map(st => st.toks.join(' '))); return; }
    if (!llRead.steps.length) return;
    let cube = applyAlgorithm(scrambledState(session.scramble), solutionTokens(session).join(' '));
    const ids = [];
    for (const st of llRead.steps) {
      const text = st.toks.join(' ');
      if (!tabbedLL.has(text) && !session._llBaseline.has(text)) {
        for (const f of LastLayer.casesOf(cube, LastLayer.LOADED)) {
          if (st.label.startsWith(LastLayer.caseLabel(f.setId, LastLayer.LOADED, f.case))) ids.push(LastLayer.caseId(f.setId, f.case));
        }
      }
      try { cube = applyAlgorithm(cube, text); } catch (e) { return; }
    }
    const known = LastLayer.PREFS.known || {};
    const fresh = ids.filter(id => !known[id]);
    if (!fresh.length) return;
    cubeProfiles.setKnown(profile().id, fresh, true);
    syncLastLayerPrefs();
  }

  function bindSearcher() {
    drawProfileChip();
  }

  async function runCritique() {
    const session = getOrCreateSession(activeIndex);
    const say = $('suggest-note');
    const picksEl = $('picks');
    const actions = $('suggest-actions');
    const searcher = $('suggestions');
    if (searcher) searcher.classList.remove('collapsed');
    $('suggest-title').textContent = caption('critique.title');
    picksEl.innerHTML = '';
    actions.innerHTML = '';
    critiqueShown = { key: `${activeIndex}|${session.scoredPath}`, items: null };
    if (!session.committedRows.length) { say.textContent = caption('critique.needSolve'); return; }
    const followed = session._followed || new Set();
    const allFollowed = session.committedRows.length >= 2
      && session.committedRows.every((row, i) => followed.has(rowTokens(row, i === 0).join(' ')))
      && (!llRead || llRead.steps.every(st => tabbedLL.has(st.toks.join(' '))));
    if (allFollowed) {
      say.textContent = caption('critique.allTop');
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'btn';
      ok.textContent = 'Close';
      ok.addEventListener('click', () => { critiqueShown = null; renderSearcher(); });
      actions.appendChild(ok);
      return;
    }
    say.textContent = caption('critique.working');
    setThinking(true);
    let h;
    try { h = await ensureHelper(); } catch (err) { say.textContent = caption('solve.loadFailed'); setThinking(false); return; }
    const ph = await ensurePseudoHelper();
    const myKey = critiqueShown.key;
    const report = await critiqueSolve(session, {
      search: (fork, { multislot }) => {
        const opts = searchOptions(ACTIVE);
        const job = scheduler.submit(wrap => searchWithLookahead(fork, wrap(h), () => {}, wrap(ph), {
          ...opts, depth: 1, filter: null, filterKey: '', multislot, lookaheadMultislot: multislot,
        }), ACTIVE);
        return job.promise;
      },
      answers: answers(),
      allow: (r) => {
        const f = resultFilter().fn;
        return (!f || f(r)) && !(r.multislot && typeof goalAllowed === 'function' && !goalAllowed('multislot', answers()));
      },
    });
    setThinking(false);
    if (!critiqueShown || critiqueShown.key !== myKey) return;
    say.textContent = caption('critique.intro');
    for (const item of report.items) item.mark = critiqueMark(item);
    creditLastSlot(session, report);
    const marks = new Map();
    const ol = document.createElement('ol');
    ol.className = 'critique-list';
    for (const item of report.items) {
      const li = document.createElement('li');
      if (item.mark) marks.set(item.startMove, item.mark);
      li.innerHTML = logEntry(item.label, item.mark, item.text, item.alt, item.altRow ? rowTokens(item.altRow, item.stepIndex === 0).join(' ') : '');
      li.addEventListener('click', () => {
        if (!player) return;
        manualPlayback = true;
        if (item.altRow) { previewCandidateAt(session, item.stepIndex, item.altRow, li); return; }
        endPreview();
        player.seek(item.startMove);
      });
      ol.appendChild(li);
    }
    if (llRead && llRead.steps.length && llAvailable()) {
      const start = applyAlgorithm(scrambledState(session.scramble), solutionTokens(session).join(' '));
      const f2lMoves = solutionTokens(session).length;
      for (const item of LastLayer.critique(start, llRead.steps, LastLayer.LOADED, view.llMethod)) {
        const li = document.createElement('li');
        const alt = item.alt ? caption(item.alt.key, item.alt.vars) : '';
        const mark = LL_MARKS[item.key] || '';
        if (mark) marks.set(f2lMoves + item.at, mark);
        li.innerHTML = logEntry(item.vars && item.vars.label, mark, caption(item.key, item.vars), alt, item.alt && item.alt.vars ? item.alt.vars.alg : '');
        li.addEventListener('click', () => {
          if (!player) return;
          manualPlayback = true;
          endPreview();
          player.seek(f2lMoves + item.at);
        });
        ol.appendChild(li);
      }
    }
    const total = document.createElement('li');
    total.className = 'total';
    total.textContent = report.total;
    ol.appendChild(total);
    picksEl.appendChild(ol);
    critiqueMarks = { key: myKey, text: editor ? editor.value : '', at: marks };
    layoutGutter();
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn';
    close.textContent = 'Close';
    close.addEventListener('click', () => { critiqueShown = null; renderSearcher(); });
    actions.appendChild(close);
  }

  function critiqueMark(item) {
    if (item.why && item.why.length) return item.outside ? 'off' : 'slower';
    if (item.fine) return '';
    if (item.altRow) return 'slower';
    return item.outside ? 'beyond' : 'best';
  }
  const LL_MARKS = { 'critique.ll.best': 'best', 'critique.ll.main': 'best', 'critique.ll.slower': 'slower', 'critique.ll.notMain': 'slower' };

  function logEntry(label, mark, text, alt, altAlg) {
    const g = mark ? ` ${markHtml(mark)}` : '';
    if (label && String(text).startsWith(`${label}: `)) text = String(text).slice(label.length + 2).replace(/^./, c => c.toUpperCase());
    let altHtml = esc(alt || '');
    if (altAlg && alt && alt.includes(altAlg)) altHtml = altHtml.replace(esc(altAlg), `<b class="moves">${esc(altAlg)}</b>`);
    return `<h4 class="turn">${esc(caseName(label))}${g}</h4><div>${esc(text)}</div>${alt ? `<div class="alt">${altHtml}</div>` : ''}`;
  }

  function creditLastSlot(session, report) {
    if (!llAvailable() || !session.isComplete) return;
    const k = session.committedRows.length - 1;
    const item = report.items.find(x => x.stepIndex === k);
    if (!item) return;
    const toks = solutionTokens(session);
    const mine = rowTokens(session.committedRows[k], k === 0);
    const before = applyAlgorithm(scrambledState(session.scramble), toks.slice(0, toks.length - mine.length).join(' '));
    const myStage = LastLayer.stageOf(applyAlgorithm(before, mine.join(' ')));
    if (!myStage) return;
    const rank = LastLayer.STAGE_RANK[myStage];
    const setId = rank >= LastLayer.STAGE_RANK.oriented ? 'ols' : rank >= LastLayer.STAGE_RANK.eo ? 'zbls' : null;
    const algs = setId ? LastLayer.lastSlotAlgs(before, LastLayer.LOADED, 12).filter(a => a.setId === setId) : [];
    if (algs.length) {
      const label = item.label;
      const tags = algs[0].tags || [];
      const set = setId === 'zbls' ? 'zbls' : ['wv', 'sv', 'vls', 'hls'].find(t => tags.includes(t)) || 'ols';
      const at = algs.findIndex(a => a.toks.join(' ') === mine.join(' '));
      const first = algs[0];
      let body = mine.join(' ');
      const myScore = at >= 0 ? LastLayer.styledScore(algs[at].alg) : AlgSets.llScore(body, null, setId);
      if (at === 0) { item.text = caption(first.main ? 'critique.ls.yours' : 'critique.ls.best', { label, set }); item.mark = 'best'; }
      else if (at > 0 && myScore <= LastLayer.styledScore(first.alg) + 3) { item.text = caption('critique.ls.good', { label, set }); item.mark = ''; }
      else {
        item.text = caption('critique.ls.slower', { label, set });
        item.mark = 'slower';
        item.alt = caption('critique.ls.alt', { alg: first.toks.join(' ') });
        item.altRow = { coreAlg: first.toks.join(' '), rotation: '' };
        return;
      }
      item.alt = '';
      item.altRow = null;
      item.why = [];
      return;
    }
    if (!item.altRow) return;
    let altStage = null;
    try { altStage = LastLayer.stageOf(applyAlgorithm(before, rowTokens(item.altRow, k === 0).join(' '))); } catch (e) { return; }
    if (!altStage || rank <= LastLayer.STAGE_RANK[altStage]) return;
    const key = rank >= LastLayer.STAGE_RANK.oriented ? 'critique.ls.oriented' : 'critique.ls.edges';
    item.text = `${item.text} ${caption(key)}`;
  }

  function previewCandidateAt(session, k, row, el = null) {
    if (!player) return;
    const toks = [];
    session.committedRows.slice(0, k).forEach((r, i) => toks.push(...rowTokens(r, i === 0)));
    toks.push(...rowTokens(row, k === 0));
    previewing = true;
    previewEl = el;
    player.pause();
    player.setSequence(toks, [], toks.length, scrambledState(session.scramble));
    const note = $('stage-note');
    if (note) note.textContent = 'my alternative';
  }

  async function handleUndo() {
    const session = getOrCreateSession(activeIndex);
    if (!editor || !reading) return;
    if (llRead && !llRead.tailTokens.length && llRead.steps.length) {
      const st = llRead.steps[llRead.steps.length - 1];
      setEditorText(editor.value.slice(0, reading.parsed[llRead.base + st.firstLine].start));
      return;
    }
    if (reading.tail.tokens.length) {
      setEditorText(textBeforeTail());
      return;
    }
    if (!session.canUndo) return;
    const last = session.committedRows.length - 1;
    const first = reading.lines.findIndex(l => l.row === last);
    if (first < 0) { session.undo(); setEditorText(rowsText(session)); return; }
    let start = reading.parsed[first].start;
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
    if (player) { player.speed = p.animSpeed > 0 ? p.animSpeed : 1; player.animated = p.animSpeed > 0; }
    drawProfileChip();
  }

  function bindSettings() {
    document.querySelectorAll('[data-caption]').forEach((el) => { el.textContent = caption(el.dataset.caption); });
    const dialog = $('settings');
    const btn = $('settings-btn');
    if (!dialog || !btn || typeof dialog.showModal !== 'function') return;
    btn.addEventListener('click', () => { syncLookControls(); dialog.showModal(); });
    const tabs = [...dialog.querySelectorAll('[data-tab]')];
    for (const t of tabs) {
      t.addEventListener('click', () => {
        for (const o of tabs) o.setAttribute('aria-selected', String(o === t));
        dialog.querySelectorAll('[data-page]').forEach((pg) => { pg.hidden = pg.dataset.page !== t.dataset.tab; });
      });
    }
    $('settings-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
    const theme = $('theme-select');
    if (theme) theme.addEventListener('change', () => setPref({ theme: theme.value }));
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
    if (location.hash === '#settings') {
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* file: */ }
      setTimeout(() => { syncLookControls(); if (!dialog.open) dialog.showModal(); }, 0);
    }
  }

  function syncLookControls() {
    const p = prefs();
    const theme = $('theme-select');
    if (theme) theme.value = document.documentElement.dataset.theme;
    const res = $('pixel-res');
    if (res) res.value = p.pixelRes || 'smooth';
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

  function bindScrambleList() {
    const on = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    on('scramble-prev', () => scrambleController.navigate(-1));
    on('scramble-next', () => scrambleController.navigate(1));
    on('generate-scrambles', () => populateScrambles());
    on('apply-scrambles', () => persistAndNavigate());
    on('scramble-edit-btn', (e) => {
      const box = $('scramble-edit');
      box.hidden = !box.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!box.hidden));
      e.currentTarget.setAttribute('aria-pressed', String(!box.hidden));
      if (!box.hidden) $('scramble-input').focus();
    });
  }

  function bindNewScramble() {
    bindScrambleList();
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

  // saved progress only loads onto the tree it was made on (same criteria)
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

  window.onPrunedTreeReady = function (tree, crit) {
    setTimeout(ensureLastLayerData, 1500);
    prunedTree = tree;
    criteria = crit;
    sessions.clear();
    loadViewPrefs(crit);
    syncViewControls();
    bindViewControls();
    bindSolutionActions();
    bindEditor();
    renderKeyLegend();
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
    if (editorSession && editor) editorSession._text = editor.value;
    activeIndex = index;
    if (!prunedTree) return;
    const session = getOrCreateSession(index);
    if (editor) {
      editor.value = session._text !== undefined ? session._text : rowsText(session);
      editorSession = session;
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
