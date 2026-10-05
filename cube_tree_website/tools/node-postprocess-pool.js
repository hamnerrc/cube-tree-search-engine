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
 * Each call's solutions go to the worker with the fewest pending jobs; the
 * worker runs solver-bridge.js's postProcessCall, the same function a search
 * runs in-thread without a postProcessor.
 */
'use strict';
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

if (!isMainThread && workerData && workerData.postProcessPool) {
  const js = path.join(__dirname, '..', 'js');
  for (const f of ['script.js', 'facelet-cube.js', 'facelet-flags.js', 'cross-optimization.js', 'solver-bridge.js']) {
    Object.assign(global, require(path.join(js, f)));
  }
  const { postProcessCall } = require(path.join(js, 'solver-bridge.js'));
  parentPort.on('message', async ({ id, ctx, job, cores }) => {
    try {
      parentPort.postMessage({ id, candidates: await postProcessCall(ctx, job, cores, null) });
    } catch (err) {
      parentPort.postMessage({ id, error: String((err && err.stack) || err) });
    }
  });
}

async function createPostProcessPool(size) {
  const workers = Array.from({ length: Math.max(1, size) }, () => {
    const w = new Worker(__filename, { workerData: { postProcessPool: true } });
    w.pending = 0;
    return w;
  });
  const waiting = new Map();
  let nextId = 0;
  for (const w of workers) {
    w.on('message', ({ id, candidates, error }) => {
      const p = waiting.get(id);
      waiting.delete(id);
      w.pending--;
      if (error) p.reject(new Error(error)); else p.resolve(candidates);
    });
  }
  const process = (ctx, job, cores) => new Promise((resolve, reject) => {
    const w = workers.reduce((a, b) => (b.pending < a.pending ? b : a));
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    w.pending++;
    w.postMessage({ id, ctx, job, cores });
  });
  return { process, size: workers.length, terminate: () => Promise.all(workers.map(w => w.terminate())) };
}

module.exports = { createPostProcessPool };
