/**
 * Post-processing worker (PROJECT_STATUS.md §4.40): runs solver-bridge.js's
 * postProcessCall -- luck filter, inspection variants, rotation spellings,
 * TPP of every candidate of one engine call -- off the page's main thread.
 * That work used to be most of a root search's time and nearly all of a
 * look-ahead's main-thread time, while the engine workers sat idle; a pool of
 * these lets the calls of a search be post-processed side by side.
 *
 * Message in:  { id, ctx, job, cores }  (see postProcessContext / postProcessJob)
 * Message out: { id, candidates } or { id, error }
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

self.onmessage = async (event) => {
  const { id, ctx, job, cores } = event.data;
  try {
    const candidates = await postProcessCall(ctx, job, cores, null);
    // (an array's own flags do not survive postMessage)
    self.postMessage({ id, candidates, stopped: !!candidates.stopped });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};
