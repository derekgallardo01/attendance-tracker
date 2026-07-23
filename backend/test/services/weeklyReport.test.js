// Tests for getWeeklySelfReport — the every-Monday email that summarizes the
// past week. Uses collectionGroup queries so it aggregates ALL tenants, not
// just one. Bugs here send you a wrong "signups: +200%" alarm bell or hide
// real concerns (users who signed up + never tracked).
//
// Also covers deleteUser since it's tiny and lives in the same "user
// lifecycle" mental bucket.

const { installFirestoreMock, wrapTimestamp } = require('../helpers/firestoreMock');

let ctx, firestore;

const NOW = Date.now();
const DAY = 86400000;

beforeEach(() => {
  ctx = installFirestoreMock();
  firestore = require('../../src/services/firestore');
});

afterEach(() => {
  ctx.uninstall();
});

function seedUser(domain, email, opts = {}) {
  const createdAgoMs = opts.createdDaysAgo !== undefined ? opts.createdDaysAgo * DAY : 0;
  ctx.seed(`tenants/${domain}/users/${email}`, {
    displayName: opts.displayName || email.split('@')[0],
    createdAt: wrapTimestamp(new Date(NOW - createdAgoMs)),
    acquisitionSource: opts.acquisitionSource || null,
  });
}

function seedEvent(domain, id, { email, type, daysAgo }) {
  ctx.seed(`tenants/${domain}/events/${id}`, {
    email, type,
    createdAt: wrapTimestamp(new Date(NOW - daysAgo * DAY)),
  });
}

describe('getWeeklySelfReport — signups', () => {
  test('counts signups this week vs last week + computes % delta', async () => {
    seedUser('acme.com', 'this1@acme.com', { createdDaysAgo: 2 });
    seedUser('acme.com', 'this2@acme.com', { createdDaysAgo: 4 });
    seedUser('acme.com', 'last1@acme.com', { createdDaysAgo: 10 });
    const r = await firestore.getWeeklySelfReport();
    expect(r.signups.thisWeek).toBe(2);
    expect(r.signups.lastWeek).toBe(1);
    expect(r.signups.delta).toBe('+100%');
  });

  test('surfaces the new-signup roster with source attribution', async () => {
    seedUser('yacht.com', 'ken@yacht.com', {
      createdDaysAgo: 1, displayName: 'Ken', acquisitionSource: 'reddit',
    });
    const r = await firestore.getWeeklySelfReport();
    expect(r.signups.new).toContainEqual({
      email: 'ken@yacht.com',
      displayName: 'Ken',
      domain: 'yacht.com',
      source: 'reddit',
    });
  });

  test('delta reads "+∞" when this-week has signups after zero last-week', async () => {
    seedUser('acme.com', 'new@acme.com', { createdDaysAgo: 3 });
    const r = await firestore.getWeeklySelfReport();
    expect(r.signups.delta).toBe('+∞');
  });

  test('delta reads "0" when both weeks had zero signups', async () => {
    const r = await firestore.getWeeklySelfReport();
    expect(r.signups.delta).toBe('0');
  });
});

describe('getWeeklySelfReport — tracks + exports deltas', () => {
  test('counts tracked/exported events, sliced by week', async () => {
    seedUser('acme.com', 'u@acme.com', { createdDaysAgo: 60 });
    seedEvent('acme.com', 'e1', { email: 'u@acme.com', type: 'tracked', daysAgo: 1 });
    seedEvent('acme.com', 'e2', { email: 'u@acme.com', type: 'tracked', daysAgo: 3 });
    seedEvent('acme.com', 'e3', { email: 'u@acme.com', type: 'exported', daysAgo: 2 });
    seedEvent('acme.com', 'e4', { email: 'u@acme.com', type: 'tracked', daysAgo: 10 });
    seedEvent('acme.com', 'e5', { email: 'u@acme.com', type: 'exported', daysAgo: 12 });
    const r = await firestore.getWeeklySelfReport();
    expect(r.tracks.thisWeek).toBe(2);
    expect(r.tracks.lastWeek).toBe(1);
    expect(r.exports.thisWeek).toBe(1);
    expect(r.exports.lastWeek).toBe(1);
    expect(r.exports.delta).toBe('+0%');
  });

  test('drops events with no email (defensive against malformed rows)', async () => {
    seedUser('acme.com', 'u@acme.com', { createdDaysAgo: 60 });
    ctx.seed('tenants/acme.com/events/broken', {
      email: null, type: 'tracked',
      createdAt: wrapTimestamp(new Date(NOW - 1 * DAY)),
    });
    seedEvent('acme.com', 'good', { email: 'u@acme.com', type: 'tracked', daysAgo: 1 });
    const r = await firestore.getWeeklySelfReport();
    expect(r.tracks.thisWeek).toBe(1);
  });
});

describe('getWeeklySelfReport — top user of the week', () => {
  test('identifies the user with the most actions this week', async () => {
    seedUser('acme.com', 'quiet@acme.com', { createdDaysAgo: 60, displayName: 'Quiet' });
    seedUser('acme.com', 'busy@acme.com', { createdDaysAgo: 60, displayName: 'Busy' });
    seedEvent('acme.com', 'q1', { email: 'quiet@acme.com', type: 'tracked', daysAgo: 2 });
    for (let i = 0; i < 5; i++) {
      seedEvent('acme.com', `b${i}`, {
        email: 'busy@acme.com',
        type: i % 2 === 0 ? 'tracked' : 'exported',
        daysAgo: i * 0.5,
      });
    }
    const r = await firestore.getWeeklySelfReport();
    expect(r.topUser).toEqual({
      email: 'busy@acme.com',
      displayName: 'Busy',
      actions: 5,
    });
  });

  test('topUser is null when nobody did anything this week', async () => {
    const r = await firestore.getWeeklySelfReport();
    expect(r.topUser).toBeNull();
  });

  test('signin events do NOT count toward top-user actions', async () => {
    seedUser('acme.com', 'u@acme.com', { createdDaysAgo: 60, displayName: 'U' });
    // 10 signins but no tracks/exports — user shouldn't top the leaderboard
    for (let i = 0; i < 10; i++) {
      seedEvent('acme.com', `s${i}`, {
        email: 'u@acme.com', type: 'signin', daysAgo: i * 0.5,
      });
    }
    const r = await firestore.getWeeklySelfReport();
    expect(r.topUser).toBeNull();
  });
});

describe('getWeeklySelfReport — concerns (churn-risk signals)', () => {
  test('flags users who signed up 3-7 days ago and never tracked', async () => {
    seedUser('acme.com', 'ghost@acme.com', { createdDaysAgo: 5, displayName: 'Ghost' });
    // No events for ghost
    const r = await firestore.getWeeklySelfReport();
    expect(r.concerns).toContainEqual({
      email: 'ghost@acme.com', displayName: 'Ghost', domain: 'acme.com',
    });
  });

  test('does NOT flag users who signed up 3-7 days ago and DID track', async () => {
    seedUser('acme.com', 'converted@acme.com', { createdDaysAgo: 5 });
    seedEvent('acme.com', 'e1', {
      email: 'converted@acme.com', type: 'tracked', daysAgo: 2,
    });
    const r = await firestore.getWeeklySelfReport();
    expect(r.concerns.find(c => c.email === 'converted@acme.com')).toBeUndefined();
  });

  test('does NOT flag users younger than 3 days (still onboarding)', async () => {
    seedUser('acme.com', 'brandnew@acme.com', { createdDaysAgo: 1 });
    const r = await firestore.getWeeklySelfReport();
    expect(r.concerns.find(c => c.email === 'brandnew@acme.com')).toBeUndefined();
  });

  test('does NOT flag users older than 7 days (past the alert window)', async () => {
    seedUser('acme.com', 'stale@acme.com', { createdDaysAgo: 30 });
    const r = await firestore.getWeeklySelfReport();
    expect(r.concerns.find(c => c.email === 'stale@acme.com')).toBeUndefined();
  });

  test('caps concerns array at 10 entries (email length management)', async () => {
    for (let i = 0; i < 15; i++) {
      seedUser('acme.com', `ghost${i}@acme.com`, { createdDaysAgo: 5 });
    }
    const r = await firestore.getWeeklySelfReport();
    expect(r.concerns.length).toBeLessThanOrEqual(10);
  });
});

describe('getWeeklySelfReport — sources aggregation', () => {
  test('counts new signups by acquisition source', async () => {
    seedUser('acme.com', 'r1@acme.com', { createdDaysAgo: 1, acquisitionSource: 'reddit' });
    seedUser('acme.com', 'r2@acme.com', { createdDaysAgo: 2, acquisitionSource: 'reddit' });
    seedUser('acme.com', 'y1@acme.com', { createdDaysAgo: 3, acquisitionSource: 'youtube' });
    seedUser('acme.com', 'x1@acme.com', { createdDaysAgo: 1 }); // no source
    const r = await firestore.getWeeklySelfReport();
    expect(r.sources).toEqual({ reddit: 2, youtube: 1, unknown: 1 });
  });
});

describe('getWeeklySelfReport — totals + window metadata', () => {
  test('reports totalUsers and totalMeetings across ALL tenants', async () => {
    seedUser('acme.com', 'a@acme.com', { createdDaysAgo: 60 });
    seedUser('yacht.com', 'b@yacht.com', { createdDaysAgo: 60 });
    ctx.seed('tenants/acme.com/meetings/m1', { title: 'X' });
    ctx.seed('tenants/yacht.com/meetings/m2', { title: 'Y' });
    ctx.seed('tenants/yacht.com/meetings/m3', { title: 'Z' });
    const r = await firestore.getWeeklySelfReport();
    expect(r.totalUsers).toBe(2);
    expect(r.totalMeetings).toBe(3);
  });

  test('windowStart is ~7 days before windowEnd (ISO strings)', async () => {
    const r = await firestore.getWeeklySelfReport();
    const startMs = new Date(r.windowStart).getTime();
    const endMs = new Date(r.windowEnd).getTime();
    const diffDays = (endMs - startMs) / DAY;
    expect(diffDays).toBeCloseTo(7, 5);
  });
});

// ── deleteUser (single-doc delete, no cascade — for completeness) ──

describe('deleteUser', () => {
  test('deletes the user doc at the tenant-scoped path', async () => {
    ctx.seed('tenants/acme.com/users/goodbye@acme.com', {
      email: 'goodbye@acme.com', displayName: 'Bye',
    });
    await firestore.deleteUser('acme.com', 'goodbye@acme.com');
    expect(ctx.read('tenants/acme.com/users/goodbye@acme.com')).toBeUndefined();
  });

  test('lowercases the email before deleting', async () => {
    ctx.seed('tenants/acme.com/users/uppercase@acme.com', { email: 'uppercase@acme.com' });
    await firestore.deleteUser('acme.com', 'UPPERCASE@ACME.COM');
    expect(ctx.read('tenants/acme.com/users/uppercase@acme.com')).toBeUndefined();
  });

  test('does not throw and reports ok for a non-existent user (no-op delete)', async () => {
    // Deleting a non-existent doc is a no-op in Firestore, not an error.
    await expect(firestore.deleteUser('acme.com', 'ghost@nowhere.com')).resolves.toMatchObject({ ok: true });
  });

  test('cascades the user\'s top-level share links + feedback (PII, GDPR)', async () => {
    ctx.seed('tenants/acme.com/users/owner@acme.com', { email: 'owner@acme.com' });
    ctx.seed('shareLinks/tok1', { token: 'tok1', ownerEmail: 'owner@acme.com' });   // theirs
    ctx.seed('shareLinks/tok2', { token: 'tok2', ownerEmail: 'other@acme.com' });    // someone else's
    ctx.seed('feedback/f1', { fromEmail: 'owner@acme.com', body: 'hi' });            // theirs
    await firestore.deleteUser('acme.com', 'owner@acme.com');
    expect(ctx.read('shareLinks/tok1')).toBeUndefined();   // deleted
    expect(ctx.read('shareLinks/tok2')).toBeDefined();     // NOT deleted (different owner)
    expect(ctx.read('feedback/f1')).toBeUndefined();       // deleted
  });
});
