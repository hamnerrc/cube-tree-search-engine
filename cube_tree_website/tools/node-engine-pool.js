/**
 * A pool of engine helpers on Node worker threads -- the Node counterpart of
 * solver-ui.js's browser worker pool (PROJECT_STATUS.md §4.34), so harnesses
 * and benchmarks can measure parallel searches the way the app runs them.
 *
 *   const pool = await createEnginePool('cross', 3);   // or 'pseudo'
 *   await searchCurrentNode(session, pool, null, pseudoPool);
 *   pool.terminate();
 *
 * The returned object has the helper's solve* methods; each call runs on a
 * free worker (queued FIFO when all are busy). It is marked `__gated`, so
 * solver-bridge.js's serialEngine passes it through and a search's calls run
 * side by side. Callback options (onProgress etc.) are not forwarded.
 */
'use strict';
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const HELPERS = {
  cross: path.join(__dirname, '..', 'crossSolver', 'solver-helper-node.js'),
  pseudo: path.join(__dirname, '..', 'pseudoCrossSolver', 'solver-helper-node.js'),
};

if (!isMainThread && workerData && workerData.enginePool) {
  const Helper = require(HELPERS[workerData.kind]);
  const h = new Helper();
  const ready = h.init();
  parentPort.on('message', async ({ id, method, args }) => {
    try {
      await ready;
      parentPort.postMessage({ id, result: await h[method](...args) });
    } catch (err) {
      parentPort.postMessage({ id, error: String(err && err.stack || err) });
    }
  });
}

async function createEnginePool(kind, size) {
  if (!HELPERS[kind]) throw new Error(`unknown engine kind ${kind}`);
  const workers = Array.from({ length: Math.max(1, size) }, () => new Worker(__filename, { workerData: { enginePool: true, kind } }));
  const pending = new Map();
  let nextId = 0;
  const free = workers.slice();
  const waiting = [];
  for (const w of workers) {
    w.on('message', ({ id, result, error }) => {
      const p = pending.get(id); pending.delete(id);
      // Hand the worker straight to the next waiter (no window where two
      // callers can both see it free).
      if (waiting.length) waiting.shift()(w); else free.push(w);
      if (error) p.reject(new Error(error)); else p.resolve(result);
    });
  }
  const acquire = () => (free.length ? Promise.resolve(free.shift()) : new Promise(r => waiting.push(r)));
  const stats = [];
  const call = (method, args) => acquire().then(w => new Promise((resolve, reject) => {
    const id = nextId++;
    const t0 = Date.now();
    pending.set(id, {
      resolve: r => {
        if (process.env.POOL_LOG && Date.now() - t0 > +process.env.POOL_LOG) console.error(`[pool] ${((Date.now() - t0) / 1000).toFixed(1)} s ${method}(${args.slice(0, -1).slice(1).join(',')}) ${JSON.stringify({ len: args[args.length - 1].maxLength, rot: args[args.length - 1].rotation, post: args[args.length - 1].postAlg, max: args[args.length - 1].maxSolutions, moves: (args[args.length - 1].allowedMoves || '').length })} -> ${r ? r.length : 0}`);
        stats.push({ method, args: args.slice(0, -1), opts: args[args.length - 1], ms: Date.now() - t0, n: r ? r.length : 0 }); resolve(r); },
      reject,
    });
    // Functions can't cross threads; drop callback options.
    const clean = args.map(a => (a && typeof a === 'object' && !Array.isArray(a)
      ? Object.fromEntries(Object.entries(a).filter(([, v]) => typeof v !== 'function')) : a));
    w.postMessage({ id, method, args: clean });
  }));
  // Warm every worker's module so the first search isn't charged for loading it.
  const methods = kind === 'cross' ? ['solveCross', 'solveXcross', 'solveXxcross', 'solveXxxcross', 'solveXxxxcross'] : ['solvePseudo'];
  const pool = { __gated: true, size: workers.length, stats, terminate: () => Promise.all(workers.map(w => w.terminate())) };
  for (const m of methods) pool[m] = (...args) => call(m, args);
  return pool;
}

module.exports = { createEnginePool };
