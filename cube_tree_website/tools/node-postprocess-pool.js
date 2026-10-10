/**
 * Node counterpart of the page's post-processing worker pool
 * (js/postprocess-worker.js, PROJECT_STATUS.md §4.40), so harnesses and
 * benchmarks can run searches the way the page does:
 *
 *   const post = await createPostProcessPool(3);
 *   session.postProcessor = post.process;   // forks share it
 *   await searchCurrentNode(session, enginePool, null, pseudoPool);
 *   await post.terminate();
 *
 * Each call's solutions go to the next free worker, lowest look-ahead rank
 * first (as in the page); the worker runs solver-bridge.js's postProcessCall, the same function a search
 * runs in-thread without a postProcessor. Live jobs exchange limits with the
 * search while they run, as in the page (solver-bridge.js liveHooks).
 */
'use strict';
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { compareSearchRanks } = require('../js/search-scheduler.js');

if (!isMainThread && workerData && workerData.postProcessPool) {
  const js = path.join(__dirname, '..', 'js');
  for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js', 'spelling-search.js', 'solver-bridge.js']) {
    Object.assign(global, require(path.join(js, f)));
  }
  const { postProcessCall } = require(path.join(js, 'solver-bridge.js'));
  // live limits, as js/postprocess-worker.js
  const liveLimits = new Map();
  parentPort.on('message', async ({ id, ctx, job, cores, live, limits }) => {
    if (limits) { liveLimits.set(id, limits); return; }
    const exchange = live ? async (snap) => {
      if (snap) parentPort.postMessage({ id, report: snap });
      await new Promise(r => setImmediate(r));
      const l = liveLimits.get(id);
      liveLimits.delete(id);
      return l || null;
    } : null;
    try {
      const candidates = await postProcessCall(ctx, job, cores, null, exchange);
      liveLimits.delete(id);
      parentPort.postMessage({ id, candidates, stopped: !!candidates.stopped });
    } catch (err) {
      parentPort.postMessage({ id, error: String((err && err.stack) || err) });
    }
  });
}

// One call per worker (as the page's pool): with two, both chunks of a big
// call could queue behind each other on one worker while another idles.
const IN_FLIGHT = 1;

async function createPostProcessPool(size) {
  const workers = Array.from({ length: Math.max(1, size) }, () => {
    const w = new Worker(__filename, { workerData: { postProcessPool: true } });
    w.pending = 0;
    return w;
  });
  const inFlight = new Map();
  // Calls wait here, at most IN_FLIGHT per worker, lowest look-ahead rank
  // first, of equal ranks the biggest (as the page's pool does).
  const queue = [];
  let nextId = 0;
  const pump = () => {
    for (;;) {
      if (!queue.length) return;
      let best = 0;
      for (let i = 1; i < queue.length; i++) {
        const c = compareSearchRanks(queue[i].rank, queue[best].rank);
        if (c < 0 || (c === 0 && queue[i].cores.length > queue[best].cores.length)) best = i;
      }
      // a seed job (a big call's first, quick job: its type's limits for
      // every other job) may share a worker with a running job, which waits
      // at its next pause (as the page's pool)
      const seed = queue[best].job.seedOnly;
      const w = workers.find(x => x.pending < IN_FLIGHT)
        || (seed ? workers.find(x => x.pending < IN_FLIGHT + 1 && !x.seeding) : null);
      if (!w) return;
      const { ctx, job: queued, cores, prepare, live, resolve, reject } = queue.splice(best, 1)[0];
      const job = prepare ? prepare(queued) : queued; // the caller's last word (solver-bridge.js)
      const id = nextId++;
      inFlight.set(id, { resolve, reject, live, seed });
      w.pending++;
      if (seed) w.seeding = true;
      if (global.process.env.TRACE_POOL) console.error( // dev timing: job timeline
        'T', Date.now() % 1e6, 'start', id, 'w', workers.indexOf(w), job.pairCount, cores.length, seed ? 'seed' : '', JSON.stringify((job.limits || []).map(x => +x.toFixed(3))));
      w.postMessage({ id, ctx, job, cores, live: !!live });
      if (live) live.attach((limits) => { if (inFlight.has(id)) w.postMessage({ id, limits }); });
    }
  };
  for (const w of workers) {
    w.on('message', ({ id, candidates, error, stopped, report }) => {
      const p = inFlight.get(id);
      if (report) { if (p && p.live) p.live.report(report); return; }
      if (stopped && candidates) candidates.stopped = true;
      inFlight.delete(id);
      if (global.process.env.TRACE_POOL) console.error('T', Date.now() % 1e6, 'end', id);
      w.pending--;
      if (p.seed) w.seeding = false;
      if (p.live) p.live.detach();
      if (error) p.reject(new Error(error)); else p.resolve(candidates);
      pump();
    });
  }
  const process = (ctx, job, cores, rank = null, prepare = null, live = null) => new Promise((resolve, reject) => {
    queue.push({ ctx, job, cores, rank, prepare, live, resolve, reject });
    pump();
  });
  process.workers = workers.length; // solver-bridge.js completeChunks
  return { process, size: workers.length, terminate: () => Promise.all(workers.map(w => w.terminate())) };
}

module.exports = { createPostProcessPool };
