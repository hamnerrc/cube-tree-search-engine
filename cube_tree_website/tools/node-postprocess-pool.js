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
 * runs in-thread without a postProcessor.
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
  parentPort.on('message', async ({ id, ctx, job, cores }) => {
    try {
      const candidates = await postProcessCall(ctx, job, cores, null);
      parentPort.postMessage({ id, candidates, stopped: !!candidates.stopped });
    } catch (err) {
      parentPort.postMessage({ id, error: String((err && err.stack) || err) });
    }
  });
}

// Two, so a worker has the next call while its last result is on its way back.
const IN_FLIGHT = 2;

async function createPostProcessPool(size) {
  const workers = Array.from({ length: Math.max(1, size) }, () => {
    const w = new Worker(__filename, { workerData: { postProcessPool: true } });
    w.pending = 0;
    return w;
  });
  const inFlight = new Map();
  // Calls wait here, at most IN_FLIGHT per worker, lowest look-ahead rank
  // first (as the page's pool does).
  const queue = [];
  let nextId = 0;
  const pump = () => {
    for (;;) {
      const w = workers.find(x => x.pending < IN_FLIGHT);
      if (!w || !queue.length) return;
      let best = 0;
      for (let i = 1; i < queue.length; i++) if (compareSearchRanks(queue[i].rank, queue[best].rank) < 0) best = i;
      const { ctx, job, cores, resolve, reject } = queue.splice(best, 1)[0];
      const id = nextId++;
      inFlight.set(id, { resolve, reject });
      w.pending++;
      w.postMessage({ id, ctx, job, cores });
    }
  };
  for (const w of workers) {
    w.on('message', ({ id, candidates, error, stopped }) => {
      if (stopped && candidates) candidates.stopped = true;
      const p = inFlight.get(id);
      inFlight.delete(id);
      w.pending--;
      if (error) p.reject(new Error(error)); else p.resolve(candidates);
      pump();
    });
  }
  const process = (ctx, job, cores, rank = null) => new Promise((resolve, reject) => {
    queue.push({ ctx, job, cores, rank, resolve, reject });
    pump();
  });
  return { process, size: workers.length, terminate: () => Promise.all(workers.map(w => w.terminate())) };
}

module.exports = { createPostProcessPool };
