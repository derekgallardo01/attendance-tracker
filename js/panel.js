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

  // How many consecutive "not present" polls before we believe someone left.
  // Meet's REST API lags on rejoins, so a single miss is not trusted.
  const LEFT_STREAK_THRESHOLD = 3;

  // Per-participant presence resolution — the heart of attendance accuracy,
  // extracted from mergeParticipants so the left-streak / rejoin / self logic is
  // unit-tested. PURE: no mutation, no DOM, no clock read; the caller applies the
  // returned decision and performs the side effects (activity note, joinTime
  // reset, accumulation). Inputs use plain values so it's trivially testable:
  //   existing: { present, leftStreak, sessions, joinTimeMs|null }
  //   incoming: { apiPresent, sessions }
  //   opts:     { isSelf, now }
  // Returns { present, leftStreak, changed, note, resetJoinTime, accumulateMs }.
  function resolvePresence(existing, incoming, opts) {
    const wasPresent = !!existing.present;
    const newSessions = incoming.sessions || existing.sessions;

    // Self-user is always present while the side panel is open — no left-streak.
    if (opts.isSelf) {
      return { present: true, leftStreak: 0, changed: !wasPresent, note: null, resetJoinTime: false, accumulateMs: 0 };
    }

    // A higher session count (rejoin) OR the API reporting present → present now.
    if (newSessions > existing.sessions || incoming.apiPresent) {
      const rejoined = !wasPresent;
      return {
        present: true, leftStreak: 0, changed: rejoined,
        note: rejoined ? 'rejoined' : null,
        resetJoinTime: rejoined, accumulateMs: 0,
      };
    }

    // Was present, now reported absent → tick the left-streak; only believe it
    // once the streak crosses the threshold, banking the session duration then.
    if (wasPresent) {
      const leftStreak = (existing.leftStreak || 0) + 1;
      const note = leftStreak === 1 ? 'may have left' : null;
      if (leftStreak >= LEFT_STREAK_THRESHOLD) {
        const accumulateMs = existing.joinTimeMs != null ? (opts.now - existing.joinTimeMs) : 0;
        return { present: false, leftStreak, changed: true, note, resetJoinTime: false, accumulateMs };
      }
      return { present: true, leftStreak, changed: false, note, resetJoinTime: false, accumulateMs: 0 };
    }

    // Already absent and still absent → nothing changes.
    return { present: false, leftStreak: existing.leftStreak || 0, changed: false, note: null, resetJoinTime: false, accumulateMs: 0 };
  }

  const api = {
    computePollInterval, resolvePresence,
    POLL_FAST, POLL_SLOW, FAST_PHASE_DURATION, RECENT_CHANGE_MS, LEFT_STREAK_THRESHOLD,
  };
  root.AttPanel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
