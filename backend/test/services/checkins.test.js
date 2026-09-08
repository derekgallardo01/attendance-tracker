// Unit tests for the attendee self-check-in store. Contract: first check-in
// wins (re-tap keeps the original checkedInAt), stale docs (same meeting code
// reused a day later) start fresh, and reads fail SOFT (return []) so a
// Firestore hiccup never breaks the host's poll.

jest.mock('../../src/services/firestore/_core', () => ({
  getDb: jest.fn(),
  FieldValue: { serverTimestamp: () => 'TS' },
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const _core = require('../../src/services/firestore/_core');
const { saveCheckin, getCheckins, normalizeMeetingCode, CHECKIN_TTL_MS } = require('../../src/services/firestore/checkins');

function stubDb({ txGet, docGet } = {}) {
  const ref = {
    get: docGet || jest.fn().mockResolvedValue({ exists: false }),
  };
  const tx = {
    get: txGet || jest.fn().mockResolvedValue({ exists: false }),
    set: jest.fn(),
  };
  _core.getDb.mockReturnValue({
    collection: jest.fn(() => ({ doc: jest.fn(() => ref) })),
    runTransaction: (fn) => fn(tx),
  });
  return { tx, ref };
}

afterEach(() => jest.clearAllMocks());

describe('normalizeMeetingCode', () => {
  test('accepts the standard meeting-code shape and lowercases/trims', () => {
    expect(normalizeMeetingCode('abc-defg-hij')).toBe('abc-defg-hij');
    expect(normalizeMeetingCode('  ABC-DEFG-HIJ ')).toBe('abc-defg-hij');
  });

  test('rejects non-strings, too-short, too-long, and bad characters', () => {
    expect(normalizeMeetingCode(null)).toBeNull();
    expect(normalizeMeetingCode(42)).toBeNull();
    expect(normalizeMeetingCode('ab')).toBeNull();
    expect(normalizeMeetingCode('x'.repeat(80))).toBeNull();
    expect(normalizeMeetingCode('abc defg hij')).toBeNull();
    expect(normalizeMeetingCode('-abc-defg-')).toBeNull(); // must start/end alphanumeric
  });
});

describe('saveCheckin', () => {
  test('throws a badInput error for an invalid meeting code', async () => {
    stubDb();
    await expect(saveCheckin('!!', { email: 'a@b.com' })).rejects.toMatchObject({ badInput: true });
  });

  test('first check-in creates the doc with a sanitized email key', async () => {
    const { tx } = stubDb();
    const result = await saveCheckin('abc-defg-hij', { email: 'First.Last@School.EDU', displayName: 'First Last' });
    expect(result.already).toBe(false);
    expect(new Date(result.checkedInAt).getTime()).toBeGreaterThan(0);
    const written = tx.set.mock.calls[0][1];
    expect(written.meetingCode).toBe('abc-defg-hij');
    // dots swapped out of the map key; the real email preserved in the entry
    const entry = written.people['first_last@school_edu'];
    expect(entry.email).toBe('first.last@school.edu');
    expect(entry.displayName).toBe('First Last');
    expect(written.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(written.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + CHECKIN_TTL_MS + 1000);
  });

  test('re-check-in keeps the original checkedInAt (first tap wins)', async () => {
    const { tx } = stubDb({
      txGet: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          people: { 'a@b_com': { email: 'a@b.com', displayName: 'A', checkedInAt: '2026-09-08T10:00:00.000Z' } },
          expiresAt: new Date(Date.now() + 3600000),
        }),
      }),
    });
    const result = await saveCheckin('abc-defg-hij', { email: 'a@b.com', displayName: 'A' });
    expect(result).toEqual({ checkedInAt: '2026-09-08T10:00:00.000Z', already: true });
    expect(tx.set).not.toHaveBeenCalled();
  });

  test('a second person merges into the existing people map', async () => {
    const { tx } = stubDb({
      txGet: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          people: { 'a@b_com': { email: 'a@b.com', displayName: 'A', checkedInAt: '2026-09-08T10:00:00.000Z' } },
          expiresAt: new Date(Date.now() + 3600000),
        }),
      }),
    });
    await saveCheckin('abc-defg-hij', { email: 'c@d.com', displayName: 'C' });
    const written = tx.set.mock.calls[0][1];
    expect(Object.keys(written.people).sort()).toEqual(['a@b_com', 'c@d_com']);
  });

  test('an expired doc on the same code starts fresh (yesterday\'s class is dropped)', async () => {
    const { tx } = stubDb({
      txGet: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          people: { 'old@b_com': { email: 'old@b.com', checkedInAt: '2026-09-07T10:00:00.000Z' } },
          expiresAt: new Date(Date.now() - 1000),
        }),
      }),
    });
    await saveCheckin('abc-defg-hij', { email: 'new@b.com', displayName: 'New' });
    const written = tx.set.mock.calls[0][1];
    expect(Object.keys(written.people)).toEqual(['new@b_com']);
  });

  test('caps the display name at 100 chars', async () => {
    const { tx } = stubDb();
    await saveCheckin('abc-defg-hij', { email: 'a@b.com', displayName: 'x'.repeat(300) });
    expect(tx.set.mock.calls[0][1].people['a@b_com'].displayName).toHaveLength(100);
  });

  test('empty displayName falls back to the lowercased email', async () => {
    const { tx } = stubDb();
    await saveCheckin('abc-defg-hij', { email: 'A@B.com', displayName: '' });
    expect(tx.set.mock.calls[0][1].people['a@b_com'].displayName).toBe('a@b.com');
  });
});

describe('getCheckins', () => {
  test('returns [] for an invalid code without touching Firestore', async () => {
    stubDb();
    await expect(getCheckins('!!')).resolves.toEqual([]);
    expect(_core.getDb).not.toHaveBeenCalled();
  });

  test('returns [] when the doc does not exist', async () => {
    stubDb();
    await expect(getCheckins('abc-defg-hij')).resolves.toEqual([]);
  });

  test('returns [] when the doc is expired', async () => {
    stubDb({
      docGet: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({ people: { 'a@b_com': { email: 'a@b.com', checkedInAt: '2026-09-08T10:00:00.000Z' } }, expiresAt: new Date(Date.now() - 1000) }),
      }),
    });
    await expect(getCheckins('abc-defg-hij')).resolves.toEqual([]);
  });

  test('returns live check-ins sorted oldest-first (Timestamp-style expiresAt too)', async () => {
    stubDb({
      docGet: jest.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          people: {
            'b@x_com': { email: 'b@x.com', displayName: 'B', checkedInAt: '2026-09-08T10:05:00.000Z' },
            'a@x_com': { email: 'a@x.com', displayName: 'A', checkedInAt: '2026-09-08T10:00:00.000Z' },
          },
          // Firestore returns Timestamps from real reads — mimic the toDate() shape
          expiresAt: { toDate: () => new Date(Date.now() + 3600000) },
        }),
      }),
    });
    const result = await getCheckins('abc-defg-hij');
    expect(result.map(c => c.email)).toEqual(['a@x.com', 'b@x.com']);
  });

  test('fails SOFT (returns []) and warns when the read errors', async () => {
    stubDb({ docGet: jest.fn().mockRejectedValue(new Error('boom')) });
    await expect(getCheckins('abc-defg-hij')).resolves.toEqual([]);
    expect(_core.log.warn).toHaveBeenCalled();
  });
});
