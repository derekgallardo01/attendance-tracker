// Tests for computeHealthScore — the pure scoring function that drives the
// admin dashboard's "who's healthy vs at-risk" signal. Bug earlier today:
// the function tried to call .toDate() on ISO strings and silently dropped
// scores by 40+ points. This file locks in both code paths (Timestamp AND
// ISO string) so that regression can't come back.

const { computeHealthScore } = require('../../src/services/firestore');

const now = Date.now();
const DAY_MS = 86400000;

function tsAgo(ms) {
  // Firestore Timestamp shape: { toDate: () => Date }
  const d = new Date(now - ms);
  return { toDate: () => d };
}

function isoAgo(ms) {
  return new Date(now - ms).toISOString();
}

describe('computeHealthScore — score bounds', () => {
  test('clamps to 0 for a brand-new user with no events', () => {
    const score = computeHealthScore({ createdAt: tsAgo(0) }, []);
    expect(score).toBe(0);
  });

  test('clamps to 100 even with implausibly generous inputs', () => {
    const user = { createdAt: tsAgo(60 * DAY_MS) };
    const events = Array.from({ length: 200 }, () => ({
      type: 'exported', createdAt: isoAgo(0),
    })).concat(Array.from({ length: 200 }, () => ({
      type: 'tracked', createdAt: isoAgo(0),
    })));
    const score = computeHealthScore(user, events);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('handles a missing createdAt without throwing', () => {
    // Real-world data has some users missing createdAt (early adopters
    // pre-instrumentation). Function should treat them as brand new.
    const score = computeHealthScore({}, []);
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('computeHealthScore — recency dimension (40 pts, -1.5/day)', () => {
  test('activity today gives near-max recency', () => {
    const score = computeHealthScore(
      { createdAt: tsAgo(5 * DAY_MS) },
      [{ type: 'tracked', createdAt: isoAgo(0) }]
    );
    // With 1 track today: recency ≈ 40, freq small (1/(5/7)*6≈8), depth 8
    expect(score).toBeGreaterThanOrEqual(40);
  });

  test('activity 30 days ago decays recency to zero', () => {
    // 30 * 1.5 = 45 → clamped to 0 recency contribution
    const score1 = computeHealthScore(
      { createdAt: tsAgo(60 * DAY_MS) },
      [{ type: 'tracked', createdAt: isoAgo(30 * DAY_MS) }]
    );
    const score2 = computeHealthScore(
      { createdAt: tsAgo(60 * DAY_MS) },
      [{ type: 'tracked', createdAt: isoAgo(0) }]
    );
    // Fresh activity should score meaningfully higher than 30-day-old
    expect(score2 - score1).toBeGreaterThan(20);
  });
});

describe('computeHealthScore — depth dimension', () => {
  test('user with only tracks (no exports) gets 8 depth pts', () => {
    // Recency 40, freq caps at ~30, no exports → depth 8, no stickiness (age<30)
    const score = computeHealthScore(
      { createdAt: tsAgo(7 * DAY_MS) },
      [{ type: 'tracked', createdAt: isoAgo(0) }]
    );
    // 40 (recency) + ~6 (freq: 1/1*6) + 8 (depth) = 54
    expect(score).toBeGreaterThan(45);
    expect(score).toBeLessThan(65);
  });

  test('user with exports gets 20 depth pts', () => {
    const trackOnly = computeHealthScore(
      { createdAt: tsAgo(7 * DAY_MS) },
      [{ type: 'tracked', createdAt: isoAgo(0) }]
    );
    const withExport = computeHealthScore(
      { createdAt: tsAgo(7 * DAY_MS) },
      [
        { type: 'tracked', createdAt: isoAgo(0) },
        { type: 'exported', createdAt: isoAgo(0) },
      ]
    );
    // Adding an export bumps depth from 8 → 20 (+12); may add a bit of freq too
    expect(withExport - trackOnly).toBeGreaterThanOrEqual(12);
  });

  test('no events at all: 0 depth pts', () => {
    const score = computeHealthScore({ createdAt: tsAgo(3 * DAY_MS) }, []);
    // No tracks, no exports → depth is 0. Recency also 0 (999 days since last).
    expect(score).toBe(0);
  });
});

describe('computeHealthScore — stickiness bonus', () => {
  test('adds 10 pts when account age > 30 days AND recent activity < 14 days', () => {
    // Both users saturated on frequency (many tracks) so the only difference
    // is the stickiness bonus — otherwise older users score LOWER on freq
    // (same track count spread over a longer age) and mask the bonus.
    const manyTracks = Array.from({ length: 50 }, (_, i) => ({
      type: 'tracked', createdAt: isoAgo(i * 0.1 * DAY_MS),
    }));
    const active = computeHealthScore(
      { createdAt: tsAgo(45 * DAY_MS) },
      manyTracks
    );
    const young = computeHealthScore(
      { createdAt: tsAgo(20 * DAY_MS) },
      manyTracks
    );
    expect(active - young).toBeGreaterThanOrEqual(10);
  });

  test('no stickiness bonus if last activity > 14 days ago (churn signal)', () => {
    const churnedButOld = computeHealthScore(
      { createdAt: tsAgo(60 * DAY_MS) },
      [{ type: 'tracked', createdAt: isoAgo(20 * DAY_MS) }]
    );
    // Same events, half the age. Sticky wouldn't apply either way.
    expect(churnedButOld).toBeLessThan(60);
  });
});

describe('computeHealthScore — TIMESTAMP vs ISO STRING createdAt (the regression that shipped)', () => {
  test('accepts events with ISO-string createdAt (getUserDetail transforms them)', () => {
    // Regression: earlier code called .toDate() unconditionally → threw on
    // strings and silently produced score=0 for all real users.
    const score = computeHealthScore(
      { createdAt: tsAgo(20 * DAY_MS) },
      [
        { type: 'tracked', createdAt: isoAgo(1 * DAY_MS) },
        { type: 'exported', createdAt: isoAgo(1 * DAY_MS) },
      ]
    );
    expect(score).toBeGreaterThan(50);
  });

  test('accepts events with Firestore-Timestamp createdAt (defensive)', () => {
    // Function is documented to tolerate either shape.
    const score = computeHealthScore(
      { createdAt: tsAgo(20 * DAY_MS) },
      [
        { type: 'tracked', createdAt: tsAgo(1 * DAY_MS) },
        { type: 'exported', createdAt: tsAgo(1 * DAY_MS) },
      ]
    );
    expect(score).toBeGreaterThan(50);
  });

  test('mixed ISO + Timestamp createdAt in the same event list', () => {
    // Belt-and-suspenders: real data has both shapes depending on how events
    // were loaded. Neither branch should short-circuit the reduce.
    const score = computeHealthScore(
      { createdAt: tsAgo(20 * DAY_MS) },
      [
        { type: 'tracked', createdAt: isoAgo(2 * DAY_MS) },      // ISO
        { type: 'tracked', createdAt: tsAgo(1 * DAY_MS) },       // Timestamp
        { type: 'exported', createdAt: isoAgo(1 * DAY_MS) },
      ]
    );
    expect(score).toBeGreaterThan(50);
  });
});
