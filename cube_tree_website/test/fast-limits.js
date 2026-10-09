'use strict';
/**
 * Real-engine tests that only need a few results per step (they used to set
 * a small maxSolutions, which the complete search no longer reads for
 * matched calls): shorter move limits and fewer kept results, so each step
 * is still searched completely, just less deeply.
 */
function fastLimits(session, { topN = 100, depth = 0 } = {}) {
  session.topN = topN;
  session.searchConfig = {
    cross: { maxLength: 7 + depth },
    xcross: { maxLength: 8 + depth },
    xxcross: { maxLength: 9 + depth },
    xxxcross: { maxLength: 10 + depth },
    singlePair: { maxLength: 9 + depth },
    multislot: { maxLength: 10 + depth },
    ...(session.searchConfig || {}),
  };
  return session;
}
module.exports = { fastLimits };
