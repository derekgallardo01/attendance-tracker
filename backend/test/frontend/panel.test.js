/**
 * @jest-environment jsdom
 *
 * Tests for the pure side-panel logic in js/panel.js (extracted from
 * index.html's inline script). Loaded from the root js/ dir (canonical source).
 */

const path = require('path');
const panel = require(path.join(__dirname, '..', '..', '..', 'js', 'panel.js'));
const { computePollInterval, POLL_FAST, POLL_SLOW, FAST_PHASE_DURATION, RECENT_CHANGE_MS } = panel;

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
