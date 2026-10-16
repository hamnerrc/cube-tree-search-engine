/**
 * Post-processing worker: runs solver-bridge.js's postProcessCall -- luck
 * filter, inspection variants, rotation spellings, TPP of every candidate of
 * one engine call -- off the page's main thread, so the calls of a search are
 * post-processed side by side.
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
