// Unit tests for the shared firestore/_core helpers: token encryption,
// TTL memoization, distinct-attendee counting, and the getDb projectId branch.
// These are pure (crypto uses CONFIG.sessionSecret from setup-env) except the
// getDb test, which isolates the module registry to mock Firestore.

const core = require('../../src/services/firestore/_core');

describe('encryptToken / decryptToken', () => {
  test('round-trips a token through AES-256-GCM', () => {
    const ct = core.encryptToken('refresh-token-abc');
    expect(ct).toMatch(/^[^:]+:[^:]+:[^:]+$/); // iv:tag:data
    expect(ct).not.toContain('refresh-token-abc');
    expect(core.decryptToken(ct)).toBe('refresh-token-abc');
  });

  test('encryptToken returns null for empty input (guard branch)', () => {
    expect(core.encryptToken('')).toBeNull();
    expect(core.encryptToken(null)).toBeNull();
    expect(core.encryptToken(undefined)).toBeNull();
  });

  test('decryptToken passes through legacy plaintext (no colon)', () => {
    expect(core.decryptToken('legacy-plaintext-token')).toBe('legacy-plaintext-token');
    expect(core.decryptToken('')).toBe('');
    expect(core.decryptToken(null)).toBeNull();
  });

  test('decryptToken returns the input unchanged when decryption throws', () => {
    // Well-formed iv:tag:data shape but garbage bytes → decipher throws → the
    // catch returns the original ciphertext (fail-safe for corrupt/legacy data).
    const bogus = 'AAAA:BBBB:CCCC';
    expect(core.decryptToken(bogus)).toBe(bogus);
  });
});

describe('memoizeTTL', () => {
  test('caches within the TTL then re-invokes after it (simulated clock)', async () => {
    let now = 1000;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    let calls = 0;
    const wrapped = core.memoizeTTL(async (x) => { calls++; return x * 2; }, 100);

    expect(await wrapped(5)).toBe(10);
    expect(await wrapped(5)).toBe(10); // cache hit — no re-invoke
    expect(calls).toBe(1);

    now += 200; // past the TTL
    expect(await wrapped(5)).toBe(10);
    expect(calls).toBe(2);

    // distinct args key → separate cache entry
    expect(await wrapped(6)).toBe(12);
    expect(calls).toBe(3);
    spy.mockRestore();
  });

  test('evicts the oldest entry once maxEntries is exceeded (bounded cache)', async () => {
    let calls = 0;
    const wrapped = core.memoizeTTL(async (x) => { calls++; return x; }, 100000, 2); // cap = 2
    await wrapped('a'); // cache: a
    await wrapped('b'); // cache: a, b
    await wrapped('c'); // size 3 > 2 → evict oldest (a) → cache: b, c
    expect(calls).toBe(3);
    await wrapped('b'); // still cached
    await wrapped('c'); // still cached
    expect(calls).toBe(3);
    await wrapped('a'); // was evicted → re-invokes
    expect(calls).toBe(4);
  });
});

describe('weeklyStreak', () => {
  const WEEK = 7 * 24 * 3600 * 1000;
  const now = 1_700_000_000_000; // subtracting whole weeks decrements the bucket exactly, regardless of alignment

  test('0 when there are no tracked events', () => {
    expect(core.weeklyStreak([], now)).toBe(0);
    expect(core.weeklyStreak(null, now)).toBe(0);
  });

  test('counts consecutive weeks back from the current week', () => {
    expect(core.weeklyStreak([now, now - WEEK, now - 2 * WEEK], now)).toBe(3);
  });

  test('a missing week breaks the streak', () => {
    expect(core.weeklyStreak([now, now - WEEK, now - 3 * WEEK], now)).toBe(2);
  });

  test('grace: nothing tracked yet this week but last week keeps the streak alive', () => {
    expect(core.weeklyStreak([now - WEEK, now - 2 * WEEK], now)).toBe(2);
  });

  test('stale activity (>1 week ago) resets to 0', () => {
    expect(core.weeklyStreak([now - 3 * WEEK, now - 4 * WEEK], now)).toBe(0);
  });
});

describe('countDistinctAttendees', () => {
  test('dedupes by email, else lowercased displayName', () => {
    const people = [
      { email: 'A@x.com' }, { email: 'a@x.com' }, // same person, two sessions
      { displayName: 'Bob' }, { displayName: 'bob' },
      { displayName: '' }, {}, // no identity → ignored
    ];
    expect(core.countDistinctAttendees(people)).toBe(2);
  });

  test('handles a null/undefined list (guard branch)', () => {
    expect(core.countDistinctAttendees(undefined)).toBe(0);
    expect(core.countDistinctAttendees(null)).toBe(0);
  });
});

describe('lastSegment', () => {
  test('returns the final path segment of a Meet resource name', () => {
    expect(core.lastSegment('conferenceRecords/abc/participants/xyz')).toBe('xyz');
  });
});

describe('getDb', () => {
  test('passes projectId to Firestore when GCP_PROJECT_ID is set', () => {
    const saved = process.env.GCP_PROJECT_ID;
    jest.resetModules();
    const FirestoreMock = jest.fn();
    jest.doMock('@google-cloud/firestore', () => ({ Firestore: FirestoreMock, FieldValue: {} }));
    process.env.GCP_PROJECT_ID = 'proj-123';
    try {
      const isolated = require('../../src/services/firestore/_core');
      isolated.getDb();
      expect(FirestoreMock).toHaveBeenCalledWith({ projectId: 'proj-123' });
    } finally {
      jest.dontMock('@google-cloud/firestore');
      if (saved === undefined) delete process.env.GCP_PROJECT_ID; else process.env.GCP_PROJECT_ID = saved;
      jest.resetModules();
    }
  });
});
