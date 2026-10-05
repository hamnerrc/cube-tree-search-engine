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
 *  - Every engine call of every job goes through one priority gate: the
 *    engine call already in flight finishes, then the ACTIVE job's calls run,
 *    and a BACKGROUND job's calls wait for as long as any ACTIVE job is still
 *    running -- including its non-engine post-processing between calls -- so
 *    a background search pauses at its next engine call instead of competing.
 *  - A job's priority can change while it is queued or running (setPriority):
 *    switching scrambles promotes the newly active one and demotes the old.
 *
 * Jobs talk to the engines only through wrap(helper), which gates the
 * helper's solve* methods; everything else passes through untouched.
 */
'use strict';

const SEARCH_PRIORITY = { BACKGROUND: 0, ACTIVE: 1 };

function createSearchScheduler() {
  const queued = []; // jobs not started yet, FIFO
  const running = new Set();
  const gateWaiters = []; // { job, resolve }, FIFO within a priority
  let gateBusy = false;

  const activeRunning = () => [...running].some(j => j.priority > SEARCH_PRIORITY.BACKGROUND);

  function pumpGate() {
    if (gateBusy || !gateWaiters.length) return;
    let best = 0;
    for (let i = 1; i < gateWaiters.length; i++) {
      if (gateWaiters[i].job.priority > gateWaiters[best].job.priority) best = i;
    }
    const waiter = gateWaiters[best];
    if (waiter.job.priority === SEARCH_PRIORITY.BACKGROUND && activeRunning()) return;
    gateWaiters.splice(best, 1);
    gateBusy = true;
    waiter.resolve();
  }

  function gate(job, fn) {
    return new Promise(resolve => { gateWaiters.push({ job, resolve }); pumpGate(); })
      .then(fn)
      .finally(() => { gateBusy = false; pumpGate(); });
  }

  function wrapFor(job) {
    return helper => {
      if (!helper) return helper;
      return new Proxy(helper, {
        get(target, prop) {
          const value = target[prop];
          if (typeof value !== 'function') return value;
          if (typeof prop === 'string' && prop.startsWith('solve')) {
            return (...args) => gate(job, () => value.apply(target, args));
          }
          return value.bind(target);
        },
      });
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
    pumpGate();
  }

  return {
    /**
     * Queues run(wrap) -- wrap(helper) returns that helper with its engine
     * calls gated -- and returns the job; job.promise settles with run's result.
     */
    submit(run, priority = SEARCH_PRIORITY.BACKGROUND) {
      const job = { run, priority, state: 'queued' };
      job.promise = new Promise((resolve, reject) => { job._resolve = resolve; job._reject = reject; });
      queued.push(job);
      pump();
      return job;
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
  module.exports = { createSearchScheduler, SEARCH_PRIORITY };
}
