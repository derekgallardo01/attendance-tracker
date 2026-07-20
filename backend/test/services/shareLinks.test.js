// Tests for the public share-link surface: createShareLink, resolveShareLink,
// getSharedSeriesView. Share links are public URLs anyone with the token can
// hit — so revocation, expiration, and email-stripping are load-bearing.

const { installFirestoreMock, wrapTimestamp } = require('../helpers/firestoreMock');

let ctx, firestore;

beforeEach(() => {
  ctx = installFirestoreMock();
  firestore = require('../../src/services/firestore');
});

afterEach(() => {
  ctx.uninstall();
});

// Flushes any fire-and-forget promises queued during the last await. Needed
// because resolveShareLink kicks off a viewCount bump with .catch(() => {})
// and returns without awaiting it — tests that assert on side effects have
// to yield the event loop first.
async function flush() {
  await new Promise(r => setImmediate(r));
}

describe('createShareLink', () => {
  test('rejects when type is not "series"', async () => {
    await expect(
      firestore.createShareLink('acme.com', 'owner@acme.com', {
        type: 'meeting', recurringEventId: 'x',
      })
    ).rejects.toThrow(/series/);
  });

  test('rejects when recurringEventId is missing', async () => {
    await expect(
      firestore.createShareLink('acme.com', 'owner@acme.com', {
        type: 'series',
      })
    ).rejects.toThrow(/recurringEventId/);
  });

  test('creates a doc at shareLinks/{token} with the right shape', async () => {
    const { token, expiresAt } = await firestore.createShareLink(
      'acme.com', 'owner@acme.com',
      { type: 'series', recurringEventId: 'series-xyz' }
    );
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(10);
    expect(expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const doc = ctx.read(`shareLinks/${token}`);
    expect(doc).toBeDefined();
    expect(doc.type).toBe('series');
    expect(doc.domain).toBe('acme.com');
    expect(doc.ownerEmail).toBe('owner@acme.com');
    expect(doc.recurringEventId).toBe('series-xyz');
    expect(doc.revoked).toBe(false);
    expect(doc.viewCount).toBe(0);
  });

  test('lowercases the owner email (case-insensitive match later)', async () => {
    const { token } = await firestore.createShareLink(
      'acme.com', 'Owner@Acme.COM',
      { type: 'series', recurringEventId: 'x' }
    );
    expect(ctx.read(`shareLinks/${token}`).ownerEmail).toBe('owner@acme.com');
  });

  test('token uses URL-safe characters only (base64url, no + / =)', async () => {
    const { token } = await firestore.createShareLink(
      'acme.com', 'o@acme.com',
      { type: 'series', recurringEventId: 'x' }
    );
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token).not.toContain('+');
    expect(token).not.toContain('/');
    expect(token).not.toContain('=');
  });

  test('sets expiresAt ~30 days in the future', async () => {
    const { expiresAt } = await firestore.createShareLink(
      'acme.com', 'o@acme.com',
      { type: 'series', recurringEventId: 'x' }
    );
    const deltaMs = new Date(expiresAt).getTime() - Date.now();
    const deltaDays = deltaMs / 86400000;
    expect(deltaDays).toBeGreaterThan(29.9);
    expect(deltaDays).toBeLessThan(30.1);
  });
});

describe('resolveShareLink', () => {
  test('returns null for a missing token', async () => {
    expect(await firestore.resolveShareLink(null)).toBeNull();
    expect(await firestore.resolveShareLink('')).toBeNull();
    expect(await firestore.resolveShareLink(undefined)).toBeNull();
  });

  test('returns null for non-string input (defensive)', async () => {
    expect(await firestore.resolveShareLink(12345)).toBeNull();
    expect(await firestore.resolveShareLink({})).toBeNull();
  });

  test('returns null when the token does not exist', async () => {
    const res = await firestore.resolveShareLink('never-created');
    expect(res).toBeNull();
  });

  test('returns null for a revoked token', async () => {
    ctx.seed('shareLinks/tok-revoked', {
      token: 'tok-revoked', type: 'series', domain: 'x.com', ownerEmail: 'o@x.com',
      recurringEventId: 'series-1', revoked: true,
      expiresAt: wrapTimestamp(new Date(Date.now() + 86400000)),
    });
    expect(await firestore.resolveShareLink('tok-revoked')).toBeNull();
  });

  test('returns null for an expired token', async () => {
    ctx.seed('shareLinks/tok-expired', {
      token: 'tok-expired', type: 'series', domain: 'x.com', ownerEmail: 'o@x.com',
      recurringEventId: 'series-1', revoked: false,
      expiresAt: wrapTimestamp(new Date(Date.now() - 86400000)),
    });
    expect(await firestore.resolveShareLink('tok-expired')).toBeNull();
  });

  test('returns the link view for a valid token', async () => {
    ctx.seed('shareLinks/tok-good', {
      token: 'tok-good', type: 'series', domain: 'yacht.com',
      ownerEmail: 'ken@yacht.com', recurringEventId: 'series-42',
      revoked: false,
      expiresAt: wrapTimestamp(new Date(Date.now() + 86400000)),
      viewCount: 0,
    });
    const res = await firestore.resolveShareLink('tok-good');
    expect(res).toEqual({
      token: 'tok-good', type: 'series', domain: 'yacht.com',
      ownerEmail: 'ken@yacht.com', recurringEventId: 'series-42',
    });
  });

  test('bumps viewCount fire-and-forget on successful resolve', async () => {
    ctx.seed('shareLinks/tok-count', {
      token: 'tok-count', type: 'series', domain: 'x.com', ownerEmail: 'o@x.com',
      recurringEventId: 'series-1', revoked: false,
      expiresAt: wrapTimestamp(new Date(Date.now() + 86400000)),
      viewCount: 3,
    });
    await firestore.resolveShareLink('tok-count');
    await flush(); // let the fire-and-forget update complete
    expect(ctx.read('shareLinks/tok-count').viewCount).toBe(4);
  });
});

describe('getSharedSeriesView', () => {
  function seedSeries() {
    // Two meetings in the same series, each with 3 participants
    ctx.seed('tenants/acme.com/meetings/meet-1', {
      recurringEventId: 'series-42',
      title: 'Sprint Planning',
      startTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
    });
    ctx.seed('tenants/acme.com/meetings/meet-2', {
      recurringEventId: 'series-42',
      title: 'Sprint Planning',
      startTime: wrapTimestamp(new Date('2026-06-08T10:00:00Z')),
    });
    // Meet 1 participants: Alex + Beth + Carlos
    ctx.seed('tenants/acme.com/meetings/meet-1/participants/p1', {
      email: 'alex@acme.com', displayName: 'Alex',
    });
    ctx.seed('tenants/acme.com/meetings/meet-1/participants/p2', {
      email: 'beth@acme.com', displayName: 'Beth',
    });
    ctx.seed('tenants/acme.com/meetings/meet-1/participants/p3', {
      email: 'carlos@acme.com', displayName: 'Carlos',
    });
    // Meet 2 participants: Alex + Beth (Carlos missed one)
    ctx.seed('tenants/acme.com/meetings/meet-2/participants/p4', {
      email: 'alex@acme.com', displayName: 'Alex',
    });
    ctx.seed('tenants/acme.com/meetings/meet-2/participants/p5', {
      email: 'beth@acme.com', displayName: 'Beth',
    });
  }

  test('returns null when no meetings match the recurringEventId', async () => {
    const res = await firestore.getSharedSeriesView('acme.com', 'series-missing');
    expect(res).toBeNull();
  });

  test('aggregates unique participants across series instances', async () => {
    seedSeries();
    const res = await firestore.getSharedSeriesView('acme.com', 'series-42');
    expect(res.instanceCount).toBe(2);
    expect(res.uniquePeople).toBe(3);
    expect(res.people).toHaveLength(3);
    const alex = res.people.find(p => p.displayName === 'Alex');
    expect(alex.attended).toBe(2);
    expect(alex.attendanceRate).toBe(1);
    const carlos = res.people.find(p => p.displayName === 'Carlos');
    expect(carlos.attended).toBe(1);
    expect(carlos.attendanceRate).toBe(0.5);
  });

  test('sorts people by attendance descending, then displayName ascending', async () => {
    seedSeries();
    const res = await firestore.getSharedSeriesView('acme.com', 'series-42');
    // Order: Alex/Beth both attended 2 → alphabetical → Alex, Beth. Then Carlos (1).
    expect(res.people.map(p => p.displayName)).toEqual(['Alex', 'Beth', 'Carlos']);
  });

  test('output does NOT include email addresses (privacy stripped)', async () => {
    seedSeries();
    const res = await firestore.getSharedSeriesView('acme.com', 'series-42');
    // Serialize the whole response and grep for emails — belt & suspenders
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain('alex@acme.com');
    expect(serialized).not.toContain('beth@acme.com');
    expect(serialized).not.toContain('carlos@acme.com');
    // And no `email` field on any person
    for (const p of res.people) {
      expect(p.email).toBeUndefined();
    }
  });

  test('reports first/last ISO timestamps across the series', async () => {
    seedSeries();
    const res = await firestore.getSharedSeriesView('acme.com', 'series-42');
    expect(res.firstAt).toBe('2026-06-01T10:00:00.000Z');
    expect(res.lastAt).toBe('2026-06-08T10:00:00.000Z');
  });

  test('deduplicates participants who appear TWICE in the same meeting', async () => {
    // Firestore participants collection: same person joins twice (rejoin)
    ctx.seed('tenants/acme.com/meetings/meet-x', {
      recurringEventId: 'series-x',
      title: 'X',
      startTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
    });
    ctx.seed('tenants/acme.com/meetings/meet-x/participants/p1', {
      email: 'alex@acme.com', displayName: 'Alex',
    });
    ctx.seed('tenants/acme.com/meetings/meet-x/participants/p2', {
      email: 'alex@acme.com', displayName: 'Alex', // rejoined
    });
    const res = await firestore.getSharedSeriesView('acme.com', 'series-x');
    expect(res.uniquePeople).toBe(1);
    expect(res.people[0].attended).toBe(1); // not 2
  });

  test('falls back to name-based key when email is missing', async () => {
    ctx.seed('tenants/acme.com/meetings/meet-y', {
      recurringEventId: 'series-y',
      title: 'Y',
      startTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
    });
    ctx.seed('tenants/acme.com/meetings/meet-y/participants/p1', {
      email: '', displayName: 'Anonymous Guest',
    });
    const res = await firestore.getSharedSeriesView('acme.com', 'series-y');
    expect(res.uniquePeople).toBe(1);
    expect(res.people[0].displayName).toBe('Anonymous Guest');
  });
});

describe('getSharedSeriesView — branch coverage', () => {
  test('adopts the longest seen displayName for a person', async () => {
    ctx.seed('tenants/acme.com/meetings/m1', { recurringEventId: 's', title: 'T', startTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')) });
    ctx.seed('tenants/acme.com/meetings/m2', { recurringEventId: 's', title: 'T', startTime: wrapTimestamp(new Date('2026-06-02T10:00:00Z')) });
    ctx.seed('tenants/acme.com/meetings/m1/participants/p1', { email: 'a@acme.com', displayName: 'Al' });
    ctx.seed('tenants/acme.com/meetings/m2/participants/p2', { email: 'a@acme.com', displayName: 'Alexander' });
    const res = await firestore.getSharedSeriesView('acme.com', 's');
    expect(res.people[0].displayName).toBe('Alexander');
  });

  test('falls back to createdAt when startTime is absent, and defaults a missing title', async () => {
    ctx.seed('tenants/acme.com/meetings/mc', { recurringEventId: 'sc', createdAt: wrapTimestamp(new Date('2026-06-03T10:00:00Z')) });
    ctx.seed('tenants/acme.com/meetings/mc/participants/p1', { email: 'z@acme.com', displayName: 'Zoe' });
    const res = await firestore.getSharedSeriesView('acme.com', 'sc');
    expect(res.title).toBe('Recurring meeting');
    expect(res.firstAt).toBe('2026-06-03T10:00:00.000Z');
  });

  test('leaves first/last null when no meeting has a timestamp', async () => {
    ctx.seed('tenants/acme.com/meetings/mn', { recurringEventId: 'sn', title: 'No times' });
    ctx.seed('tenants/acme.com/meetings/mn/participants/p1', { email: 'q@acme.com', displayName: 'Q' });
    const res = await firestore.getSharedSeriesView('acme.com', 'sn');
    expect(res.firstAt).toBeNull();
    expect(res.lastAt).toBeNull();
  });
});

describe('resolveShareLink — expiresAt as ISO string', () => {
  test('treats a string expiresAt in the future as valid', async () => {
    ctx.seed('shareLinks/tok-str', {
      token: 'tok-str', type: 'series', domain: 'acme.com', ownerEmail: 'o@acme.com',
      recurringEventId: 'r', revoked: false,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    const res = await firestore.resolveShareLink('tok-str');
    expect(res).toMatchObject({ token: 'tok-str', recurringEventId: 'r' });
  });
});

describe('getSharedSeriesView / resolveShareLink — residual branches', () => {
  test('resolveShareLink treats a doc with no expiresAt as non-expiring', async () => {
    ctx.seed('shareLinks/tok-noexp', {
      token: 'tok-noexp', type: 'series', domain: 'acme.com', ownerEmail: 'o@acme.com',
      recurringEventId: 'r', revoked: false, // no expiresAt field
    });
    const res = await firestore.resolveShareLink('tok-noexp');
    expect(res).toMatchObject({ token: 'tok-noexp' });
  });

  test('sort comparator handles createdAt-only and timestamp-less meetings', async () => {
    ctx.seed('tenants/acme.com/meetings/ca', { recurringEventId: 'sca', title: 'A', createdAt: wrapTimestamp(new Date('2026-06-05T10:00:00Z')) });
    ctx.seed('tenants/acme.com/meetings/cb', { recurringEventId: 'sca', title: 'B', createdAt: wrapTimestamp(new Date('2026-06-06T10:00:00Z')) });
    ctx.seed('tenants/acme.com/meetings/ca/participants/p1', { email: 'a@acme.com', displayName: 'A' });
    ctx.seed('tenants/acme.com/meetings/cb/participants/p2', { email: 'b@acme.com', displayName: 'B' });
    const res = await firestore.getSharedSeriesView('acme.com', 'sca');
    expect(res.instanceCount).toBe(2);
  });

  test('names an emailed participant "Unknown" when displayName is blank', async () => {
    ctx.seed('tenants/acme.com/meetings/mu', { recurringEventId: 'su', title: 'U', startTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')) });
    ctx.seed('tenants/acme.com/meetings/mu/participants/p1', { email: 'noname@acme.com', displayName: '' });
    const res = await firestore.getSharedSeriesView('acme.com', 'su');
    expect(res.people[0].displayName).toBe('Unknown');
  });
});

describe('getSharedSeriesView — sort with zero timestamps', () => {
  test('two meetings with no timestamps sort via the ||0 fallback', async () => {
    ctx.seed('tenants/acme.com/meetings/z1', { recurringEventId: 'sz', title: 'Z' });
    ctx.seed('tenants/acme.com/meetings/z2', { recurringEventId: 'sz', title: 'Z' });
    ctx.seed('tenants/acme.com/meetings/z1/participants/p1', { email: 'a@acme.com', displayName: 'A' });
    ctx.seed('tenants/acme.com/meetings/z2/participants/p2', { email: 'b@acme.com', displayName: 'B' });
    const res = await firestore.getSharedSeriesView('acme.com', 'sz');
    expect(res.instanceCount).toBe(2);
    expect(res.firstAt).toBeNull();
  });
});

describe('getSharedSeriesView — equal timestamps', () => {
  test('two meetings at the same instant do not double-advance lastAt', async () => {
    const t = wrapTimestamp(new Date('2026-06-01T10:00:00Z'));
    ctx.seed('tenants/acme.com/meetings/eq1', { recurringEventId: 'seq', title: 'E', startTime: t });
    ctx.seed('tenants/acme.com/meetings/eq2', { recurringEventId: 'seq', title: 'E', startTime: t });
    ctx.seed('tenants/acme.com/meetings/eq1/participants/p1', { email: 'a@acme.com', displayName: 'A' });
    ctx.seed('tenants/acme.com/meetings/eq2/participants/p2', { email: 'b@acme.com', displayName: 'B' });
    const res = await firestore.getSharedSeriesView('acme.com', 'seq');
    expect(res.firstAt).toBe('2026-06-01T10:00:00.000Z');
    expect(res.lastAt).toBe('2026-06-01T10:00:00.000Z');
  });
});
