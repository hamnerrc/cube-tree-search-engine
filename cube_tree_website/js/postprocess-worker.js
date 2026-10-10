/**
 * Post-processing worker (PROJECT_STATUS.md §4.40): runs solver-bridge.js's
 * postProcessCall -- luck filter, inspection variants, rotation spellings,
 * TPP of every candidate of one engine call -- off the page's main thread.
 * That work used to be most of a root search's time and nearly all of a
 * look-ahead's main-thread time, while the engine workers sat idle; a pool of
 * these lets the calls of a search be post-processed side by side.
 *
 * Message in:  { id, ctx, job, cores, live }  (see postProcessContext / postProcessJob)
 *              { id, limits }  (live jobs: the type's latest limits)
 * Message out: { id, candidates } or { id, error }; live jobs also
 *              { id, report } (their kept candidates, now and then)
 *
 * The scripts are the page's own, so the output is the same function's output.
 * The query string (cache-buster) is passed through from the worker's URL.
 */
'use strict';
const version = self.location.search || '';
importScripts(
  `pro-steps.js${version}`,
  `script.js${version}`,
  `facelet-cube.js${version}`,
  `facelet-flags.js${version}`,
  `cross-optimization.js${version}`,
  `spelling-search.js${version}`,
  `solver-bridge.js${version}`,
);

// Live limits (solver-bridge.js liveHooks): a running job posts its kept
// candidates ({ id, report }) and takes the latest limits the page sent
// ({ id, limits }) at its pauses; a message to itself lets those in.
const liveLimits = new Map();
const pausePort = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const pauseWaiters = [];
if (pausePort) pausePort.port1.onmessage = () => { const r = pauseWaiters.shift(); if (r) r(); };
const pause = () => new Promise((resolve) => {
  if (!pausePort) { setTimeout(resolve, 0); return; }
  pauseWaiters.push(resolve);
  pausePort.port2.postMessage(0);
});

self.onmessage = async (event) => {
  const { id, ctx, job, cores, live, limits } = event.data;
  if (limits) { liveLimits.set(id, limits); return; }
  const exchange = live ? async (snap) => {
    if (snap) self.postMessage({ id, report: snap });
    await pause();
    const l = liveLimits.get(id);
    liveLimits.delete(id);
    return l || null;
  } : null;
  try {
    const candidates = await postProcessCall(ctx, job, cores, null, exchange);
    liveLimits.delete(id);
    // (an array's own flags do not survive postMessage)
    self.postMessage({ id, candidates, stopped: !!candidates.stopped });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};
