/**
 * search-scheduler.js — priority scheduling of searches onto the solver
 * engines (README "Multi-scramble queueing": the user's active focus comes
 * first).
 *
 * Each engine worker can only run one solve at a time, so searches used to be
 * chained FIFO: a search started by committing a result waited behind every
 * background scramble queued before it. Here:
 *
 *  - BACKGROUND jobs (other scrambles) start one at a time, only while
 *    nothing else is running.
 *  - ACTIVE jobs (the scramble on screen, e.g. the search started by
 *    committing a result) start immediately.
 *  - Every engine call of every job goes through a priority gate per engine
 *    (helper, or array of helpers = a worker pool, one slot per worker): calls
 *    already in flight finish, then the ACTIVE job's calls run, and a
 *    BACKGROUND job's calls wait for as long as any ACTIVE job is still
 *    running -- including its non-engine post-processing between calls -- so
 *    a background search pauses at its next engine call instead of competing.
 *    A pool runs up to one call per worker at once (PROJECT_STATUS.md §4.34).
 *  - A job's priority can change while it is queued or running (setPriority):
 *    switching scrambles promotes the newly active one and demotes the old.
 *  - A stale job (replaced on screen: the next step after a click, another
 *    setting) keeps its priority but its calls run after every other call
 *    of that priority; they still run whenever nothing else is waiting, so
 *    a job waiting on one of them (a shared engine call) is never stuck.
 *  - Within one priority, calls made through engine.withRank(rank) (the
 *    look-ahead's path of candidate indices, solver-bridge.js lookaheadFork)
 *    run lowest rank first -- the step's own calls (no rank) before any
 *    look-ahead call, the best candidate's follow-ups before the next one's
 *    -- and equal ranks in arrival order.
 *
 * Jobs talk to the engines only through wrap(helper), which gates the
 * helper's solve* methods (dispatching each call to a free pool member);
 * everything else passes through to the first member untouched.
 */
'use strict';

const SEARCH_PRIORITY = { BACKGROUND: 0, ACTIVE: 1 };

/** Lexicographic order of look-ahead ranks (null = [] = first). */
function compareSearchRanks(a, b) {
  a = a || [];
  b = b || [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

function createSearchScheduler() {
  const queued = []; // jobs not started yet, FIFO
  const running = new Set();
  const gates = new Map(); // engine (helper or helper array) -> { free: [slot], waiters: [{ job, resolve }] }

  const activeRunning = () => [...running].some(j => j.priority > SEARCH_PRIORITY.BACKGROUND);

  function pumpGate(g) {
    while (g.free.length && g.waiters.length) {
      let best = 0;
      for (let i = 1; i < g.waiters.length; i++) {
        const w = g.waiters[i];
        const b = g.waiters[best];
        if (w.job.priority > b.job.priority
          || (w.job.priority === b.job.priority && !w.job.stale && b.job.stale)
          || (w.job.priority === b.job.priority && !w.job.stale === !b.job.stale && compareSearchRanks(w.rank, b.rank) < 0)) best = i;
      }
      const waiter = g.waiters[best];
      if (waiter.job.priority === SEARCH_PRIORITY.BACKGROUND && activeRunning()) return;
      g.waiters.splice(best, 1);
      waiter.resolve(g.free.shift());
    }
  }
  const pumpGates = () => { for (const g of gates.values()) pumpGate(g); };

  function gateFor(engine, size) {
    if (!gates.has(engine)) gates.set(engine, { free: Array.from({ length: size }, (_, i) => i), waiters: [] });
    return gates.get(engine);
  }

  function gate(job, engine, size, fn, rank = null) {
    const g = gateFor(engine, size);
    return new Promise(resolve => { g.waiters.push({ job, resolve, rank }); pumpGate(g); })
      .then(slot => Promise.resolve()
        .then(() => fn(slot))
        .finally(() => { g.free.push(slot); pumpGates(); }));
  }

  function wrapFor(job) {
    return engine => {
      if (!engine) return engine;
      const members = Array.isArray(engine) ? engine : [engine];
      const view = rank => new Proxy(members[0], {
        get(target, prop) {
          if (prop === '__gated') return true;
          if (prop === 'size') return members.length; // engine workers (solver-bridge.js splitByFirstMove)
          if (prop === 'withRank') return r => view(r);
          const value = target[prop];
          if (typeof value !== 'function') return value;
          if (typeof prop === 'string' && prop.startsWith('solve')) {
            return (...args) => gate(job, engine, members.length, slot => members[slot][prop](...args), rank);
          }
          return value.bind(target);
        },
      });
      return view(null);
    };
  }

  function start(job) {
    queued.splice(queued.indexOf(job), 1);
    running.add(job);
    job.state = 'running';
    Promise.resolve()
      .then(() => job.run(wrapFor(job)))
      .then(job._resolve, job._reject)
      .finally(() => {
        running.delete(job);
        job.state = 'done';
        pump();
      });
  }

  function pump() {
    for (const job of queued.filter(j => j.priority > SEARCH_PRIORITY.BACKGROUND)) start(job);
    if (!running.size && queued.length) start(queued[0]);
    pumpGates();
  }

  return {
    /**
     * Queues run(wrap) -- wrap(helper or helper array) returns an engine whose
     * calls are gated (and spread over the array's members) -- and returns
     * the job; job.promise settles with run's result.
     */
    submit(run, priority = SEARCH_PRIORITY.BACKGROUND) {
      const job = { run, priority, state: 'queued' };
      job.promise = new Promise((resolve, reject) => { job._resolve = resolve; job._reject = reject; });
      queued.push(job);
      pump();
      return job;
    },
    /** Marks a job stale (its calls yield to other jobs' of its priority) or not. */
    setStale(job, stale = true) {
      if (!job || job.state === 'done') return;
      job.stale = !!stale;
      pumpGates();
    },
    setPriority(job, priority) {
      if (!job || job.state === 'done' || job.priority === priority) return;
      job.priority = priority;
      pump();
    },
    get idle() { return !queued.length && !running.size; },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createSearchScheduler, SEARCH_PRIORITY, compareSearchRanks };
}
