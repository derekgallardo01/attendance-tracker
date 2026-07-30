/**
 * @jest-environment jsdom
 *
 * Tests for the pure side-panel logic in js/panel.js (extracted from
 * index.html's inline script). Loaded from the root js/ dir (canonical source).
 */

const path = require('path');
const panel = require(path.join(__dirname, '..', '..', '..', 'js', 'panel.js'));
const { computePollInterval, resolvePresence, POLL_FAST, POLL_SLOW, FAST_PHASE_DURATION, RECENT_CHANGE_MS } = panel;

describe('computePollInterval', () => {
  const now = Date.parse('2026-07-29T12:00:00Z');

  test('no state / no startTime → fast (tracking not started)', () => {
    expect(computePollInterval(null, now)).toBe(POLL_FAST);
    expect(computePollInterval({}, now)).toBe(POLL_FAST);
  });

  test('within the opening fast phase → fast', () => {
    const startTime = new Date(now - (FAST_PHASE_DURATION - 1000)); // 1s inside the phase
    expect(computePollInterval({ startTime }, now)).toBe(POLL_FAST);
  });

  test('accepts startTime as an epoch number too', () => {
    const startTime = now - (FAST_PHASE_DURATION - 1000);
    expect(computePollInterval({ startTime }, now)).toBe(POLL_FAST);
  });

  test('past the opening phase with no recent change → slow', () => {
    const startTime = new Date(now - (FAST_PHASE_DURATION + 60_000)); // well past
    expect(computePollInterval({ startTime }, now)).toBe(POLL_SLOW);
  });

  test('past the opening phase but a recent change → fast', () => {
    const startTime = new Date(now - (FAST_PHASE_DURATION + 60_000));
    const _lastChangeTime = now - (RECENT_CHANGE_MS - 1000); // change 1s inside the window
    expect(computePollInterval({ startTime, _lastChangeTime }, now)).toBe(POLL_FAST);
  });

  test('past the opening phase with a stale change → slow', () => {
    const startTime = new Date(now - (FAST_PHASE_DURATION + 60_000));
    const _lastChangeTime = now - (RECENT_CHANGE_MS + 1000); // change just outside the window
    expect(computePollInterval({ startTime, _lastChangeTime }, now)).toBe(POLL_SLOW);
  });

  test('defaults now to the current clock when omitted', () => {
    // startTime just now → still in the opening phase → fast.
    expect(computePollInterval({ startTime: new Date() })).toBe(POLL_FAST);
  });
});

describe('resolvePresence (attendance-accuracy core)', () => {
  const NOW = 1_000_000;
  const base = { present: true, leftStreak: 0, sessions: 1, joinTimeMs: NOW - 60_000 };
  const call = (existing, incoming, opts) =>
    resolvePresence({ ...base, ...existing }, { apiPresent: false, sessions: 1, ...incoming }, { isSelf: false, now: NOW, ...opts });

  test('self is always present; no note, no left-streak', () => {
    expect(call({ present: true }, { apiPresent: false }, { isSelf: true }))
      .toEqual({ present: true, leftStreak: 0, changed: false, note: null, resetJoinTime: false, accumulateMs: 0 });
  });

  test('self flipping from absent → present counts as a change', () => {
    expect(call({ present: false }, { apiPresent: false }, { isSelf: true }))
      .toMatchObject({ present: true, changed: true, note: null });
  });

  test('rejoin by session bump while absent → present + rejoined note + joinTime reset', () => {
    expect(call({ present: false, sessions: 1 }, { apiPresent: false, sessions: 2 }))
      .toEqual({ present: true, leftStreak: 0, changed: true, note: 'rejoined', resetJoinTime: true, accumulateMs: 0 });
  });

  test('session bump while already present → present, no note, no change', () => {
    expect(call({ present: true, sessions: 1 }, { apiPresent: false, sessions: 2 }))
      .toEqual({ present: true, leftStreak: 0, changed: false, note: null, resetJoinTime: false, accumulateMs: 0 });
  });

  test('api reports present while absent → rejoined', () => {
    expect(call({ present: false }, { apiPresent: true }))
      .toMatchObject({ present: true, changed: true, note: 'rejoined', resetJoinTime: true, leftStreak: 0 });
  });

  test('api reports present while already present → no change, no note', () => {
    expect(call({ present: true }, { apiPresent: true }))
      .toEqual({ present: true, leftStreak: 0, changed: false, note: null, resetJoinTime: false, accumulateMs: 0 });
  });

  test('present→absent: 1st miss shows "may have left" but stays present', () => {
    expect(call({ present: true, leftStreak: 0 }, { apiPresent: false }))
      .toEqual({ present: true, leftStreak: 1, changed: false, note: 'may have left', resetJoinTime: false, accumulateMs: 0 });
  });

  test('present→absent: 2nd miss stays present, no note', () => {
    expect(call({ present: true, leftStreak: 1 }, { apiPresent: false }))
      .toMatchObject({ present: true, leftStreak: 2, changed: false, note: null });
  });

  test('present→absent: 3rd miss marks Left, banks the session duration', () => {
    const r = call({ present: true, leftStreak: 2, joinTimeMs: NOW - 90_000 }, { apiPresent: false });
    expect(r).toMatchObject({ present: false, leftStreak: 3, changed: true, note: null });
    expect(r.accumulateMs).toBe(90_000); // NOW - joinTimeMs
  });

  test('3rd miss with no known joinTime banks 0ms', () => {
    const r = call({ present: true, leftStreak: 2, joinTimeMs: null }, { apiPresent: false });
    expect(r).toMatchObject({ present: false, leftStreak: 3, accumulateMs: 0, changed: true });
  });

  test('already absent and still absent → no change at all', () => {
    expect(call({ present: false, leftStreak: 5 }, { apiPresent: false }))
      .toEqual({ present: false, leftStreak: 5, changed: false, note: null, resetJoinTime: false, accumulateMs: 0 });
    // ...and with no prior streak recorded (undefined → 0 fallback).
    expect(call({ present: false, leftStreak: undefined }, { apiPresent: false }))
      .toMatchObject({ present: false, leftStreak: 0, changed: false });
  });

  test('leftStreak defaults from undefined (first miss)', () => {
    expect(call({ present: true, leftStreak: undefined }, { apiPresent: false }))
      .toMatchObject({ leftStreak: 1, note: 'may have left' });
  });

  test('incoming.sessions falsy falls back to existing sessions (no phantom rejoin)', () => {
    // sessions:0 → newSessions = existing.sessions(1), not > 1, apiPresent false,
    // was present → left-streak path, not a rejoin.
    expect(call({ present: true, sessions: 1, leftStreak: 0 }, { apiPresent: false, sessions: 0 }))
      .toMatchObject({ leftStreak: 1, note: 'may have left', present: true });
  });
});
