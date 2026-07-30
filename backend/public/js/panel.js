// Pure, dependency-free logic for the in-Meet side panel (index.html). Most of
// index.html's pure helpers already live in js/utils.js; this module holds the
// bits that were still inline and testable. The panel's poll loop, DOM
// rendering, sim engine, and mergeParticipants stay inline (they are coupled to
// the live poll loop / global `state` and are extracted separately, if at all).
//
// Exposed as both `window.AttPanel` (browser) and `module.exports` (Jest),
// mirroring js/utils.js.

(function (root) {
  'use strict';

  // Poll cadence. Fast (10s) during the opening phase and for a short window
  // after any recent roster change; slow (30s) once the meeting has settled.
  const POLL_FAST = 10_000;                 // 10 seconds
  const POLL_SLOW = 30_000;                 // 30 seconds
  const FAST_PHASE_DURATION = 10 * 60_000;  // first 10 minutes always fast
  const RECENT_CHANGE_MS = 120_000;         // stay fast for 2 min after a change

  // Decide the next poll interval (pure). Takes the panel `state` (needs
  // .startTime and optional ._lastChangeTime) and an injectable `now` so tests
  // are deterministic; callers pass one arg and it defaults to the clock.
  function computePollInterval(state, now = Date.now()) {
    if (!state || !state.startTime) return POLL_FAST;
    const start = state.startTime instanceof Date ? state.startTime.getTime() : state.startTime;
    if (now - start < FAST_PHASE_DURATION) return POLL_FAST;           // opening phase
    if (state._lastChangeTime && (now - state._lastChangeTime) < RECENT_CHANGE_MS) return POLL_FAST; // recent change
    return POLL_SLOW;                                                   // settled
  }

  const api = { computePollInterval, POLL_FAST, POLL_SLOW, FAST_PHASE_DURATION, RECENT_CHANGE_MS };
  root.AttPanel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
