// Tests for getUserDetail — the CRM drill-down modal. Aggregates a user's
// full state from five collections (users, events, adminNotes, outreach,
// reminders) plus a lookup for tracked meeting titles. Everything downstream
// (health score, activation counts, conversation timeline) hangs off this.

const { installFirestoreMock, wrapTimestamp } = require('../helpers/firestoreMock');

let ctx, firestore;

beforeEach(() => {
  ctx = installFirestoreMock();
  firestore = require('../../src/services/firestore');
});

afterEach(() => {
  ctx.uninstall();
});

function seedBasicUser() {
  ctx.seed('tenants/acme.com/users/ken@yacht.com', {
    email: 'ken@yacht.com',
    displayName: 'Ken',
    createdAt: wrapTimestamp(new Date('2026-05-01T00:00:00Z')),
    lastLoginAt: wrapTimestamp(new Date('2026-07-01T00:00:00Z')),
    acquisitionSource: 'reddit',
    utmSource: 'reddit_organic',
  });
}

describe('getUserDetail — nonexistent user', () => {
  test('returns null when the user doc does not exist', async () => {
    const res = await firestore.getUserDetail('acme.com', 'ghost@nobody.com');
    expect(res).toBeNull();
  });
});

describe('getUserDetail — basic shape', () => {
  test('returns the full detail object for a known user', async () => {
    seedBasicUser();
    const res = await firestore.getUserDetail('acme.com', 'ken@yacht.com');
    expect(res).toEqual(expect.objectContaining({
      email: 'ken@yacht.com',
      domain: 'acme.com',
      displayName: 'Ken',
      acquisitionSource: 'reddit',
      utmSource: 'reddit_organic',
      createdAt: '2026-05-01T00:00:00.000Z',
      lastLoginAt: '2026-07-01T00:00:00.000Z',
    }));
    // Defaults when there's no adjacent data
    expect(res.note).toBe('');
    expect(res.outreach).toBeNull();
    expect(res.conversation).toEqual([]);
    expect(res.reminders).toEqual([]);
    expect(res.events).toEqual([]);
    expect(res.meetings).toEqual([]);
  });

  test('lowercases the requested email in the response', async () => {
    seedBasicUser();
    const res = await firestore.getUserDetail('acme.com', 'KEN@YACHT.COM');
    expect(res.email).toBe('ken@yacht.com');
  });
});

describe('getUserDetail — activation counts + events', () => {
  test('breaks events down into tracked / exported / signin counts', async () => {
    seedBasicUser();
    ctx.seed('tenants/acme.com/events/e1', {
      email: 'ken@yacht.com', type: 'tracked',
      createdAt: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
      meta: { conferenceId: 'meet-1' },
    });
    ctx.seed('tenants/acme.com/events/e2', {
      email: 'ken@yacht.com', type: 'tracked',
      createdAt: wrapTimestamp(new Date('2026-06-08T10:00:00Z')),
      meta: { conferenceId: 'meet-1' }, // dedupe same conf
    });
    ctx.seed('tenants/acme.com/events/e3', {
      email: 'ken@yacht.com', type: 'exported',
      createdAt: wrapTimestamp(new Date('2026-06-15T10:00:00Z')),
    });
    ctx.seed('tenants/acme.com/events/e4', {
      email: 'ken@yacht.com', type: 'signin',
      createdAt: wrapTimestamp(new Date('2026-06-01T09:00:00Z')),
    });
    const res = await firestore.getUserDetail('acme.com', 'ken@yacht.com');
    expect(res.counts).toEqual({ tracked: 2, exported: 1, signins: 1 });
  });

  test('events sorted by createdAt DESCENDING (newest first)', async () => {
    seedBasicUser();
    ctx.seed('tenants/acme.com/events/e-old', {
      email: 'ken@yacht.com', type: 'tracked',
      createdAt: wrapTimestamp(new Date('2026-05-01T00:00:00Z')),
    });
    ctx.seed('tenants/acme.com/events/e-new', {
      email: 'ken@yacht.com', type: 'tracked',
      createdAt: wrapTimestamp(new Date('2026-07-01T00:00:00Z')),
    });
    const res = await firestore.getUserDetail('acme.com', 'ken@yacht.com');
    expect(res.events[0].id).toBe('e-new');
    expect(res.events[1].id).toBe('e-old');
  });

  test('events with Timestamp createdAt are transformed to ISO strings', async () => {
    seedBasicUser();
    ctx.seed('tenants/acme.com/events/e1', {
      email: 'ken@yacht.com', type: 'tracked',
      createdAt: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
    });
    const res = await firestore.getUserDetail('acme.com', 'ken@yacht.com');
    expect(res.events[0].createdAt).toBe('2026-06-01T10:00:00.000Z');
  });
});

describe('getUserDetail — meeting title resolution', () => {
  test('resolves titles for tracked events with a conferenceId', async () => {
    seedBasicUser();
    ctx.seed('tenants/acme.com/events/e1', {
      email: 'ken@yacht.com', type: 'tracked',
      createdAt: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
      meta: { conferenceId: 'meet-abc' },
    });
    ctx.seed('tenants/acme.com/meetings/meet-abc', {
      title: 'Sprint Planning',
      participantCount: 7,
      startTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
    });
    const res = await firestore.getUserDetail('acme.com', 'ken@yacht.com');
    expect(res.meetings).toHaveLength(1);
    expect(res.meetings[0]).toEqual({
      id: 'meet-abc',
      title: 'Sprint Planning',
      participantCount: 7,
      startTime: '2026-06-01T10:00:00.000Z',
    });
  });

  test('deduplicates meeting lookups when the user tracked the same conf multiple times', async () => {
    seedBasicUser();
    ctx.seed('tenants/acme.com/events/e1', {
      email: 'ken@yacht.com', type: 'tracked',
      createdAt: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
      meta: { conferenceId: 'meet-1' },
    });
    ctx.seed('tenants/acme.com/events/e2', {
      email: 'ken@yacht.com', type: 'tracked',
      createdAt: wrapTimestamp(new Date('2026-06-02T10:00:00Z')),
      meta: { conferenceId: 'meet-1' }, // same conference
    });
    ctx.seed('tenants/acme.com/meetings/meet-1', {
      title: 'Same Meeting',
      participantCount: 5,
    });
    const res = await firestore.getUserDetail('acme.com', 'ken@yacht.com');
    expect(res.meetings).toHaveLength(1);
    expect(res.meetings[0].id).toBe('meet-1');
  });

  test('meetings sorted by startTime descending (newest first)', async () => {
    seedBasicUser();
    ctx.seed('tenants/acme.com/events/e1', {
      email: 'ken@yacht.com', type: 'tracked',
      createdAt: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
      meta: { conferenceId: 'meet-old' },
    });
    ctx.seed('tenants/acme.com/events/e2', {
      email: 'ken@yacht.com', type: 'tracked',
      createdAt: wrapTimestamp(new Date('2026-06-08T10:00:00Z')),
      meta: { conferenceId: 'meet-new' },
    });
    ctx.seed('tenants/acme.com/meetings/meet-old', {
      title: 'Old', startTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
    });
    ctx.seed('tenants/acme.com/meetings/meet-new', {
      title: 'New', startTime: wrapTimestamp(new Date('2026-06-08T10:00:00Z')),
    });
    const res = await firestore.getUserDetail('acme.com', 'ken@yacht.com');
    expect(res.meetings[0].id).toBe('meet-new');
    expect(res.meetings[1].id).toBe('meet-old');
  });

  test('does NOT fetch meetings for events that have no conferenceId (e.g. signin events)', async () => {
    seedBasicUser();
    ctx.seed('tenants/acme.com/events/e1', {
      email: 'ken@yacht.com', type: 'signin',
      createdAt: wrapTimestamp(new Date('2026-06-01T00:00:00Z')),
      // no meta.conferenceId
    });
    const res = await firestore.getUserDetail('acme.com', 'ken@yacht.com');
    expect(res.meetings).toEqual([]);
  });
});

describe('getUserDetail — admin notes / outreach / reminders', () => {
  test('surfaces the admin note when set', async () => {
    seedBasicUser();
    ctx.seed('tenants/acme.com/adminNotes/ken@yacht.com', {
      body: 'Chatted at the meetup; interested in Slack integration',
    });
    const res = await firestore.getUserDetail('acme.com', 'ken@yacht.com');
    expect(res.note).toBe('Chatted at the meetup; interested in Slack integration');
  });

  test('outreach block surfaces the outreach doc with ISO timestamps', async () => {
    seedBasicUser();
    ctx.seed('tenants/acme.com/outreach/ken@yacht.com', {
      contactedAt: wrapTimestamp(new Date('2026-06-15T00:00:00Z')),
      replyStatus: 'awaiting',
      lastEmailedAt: wrapTimestamp(new Date('2026-06-15T00:00:00Z')),
    });
    const res = await firestore.getUserDetail('acme.com', 'ken@yacht.com');
    expect(res.outreach).toEqual({
      contactedAt: '2026-06-15T00:00:00.000Z',
      replyStatus: 'awaiting',
      lastEmailedAt: '2026-06-15T00:00:00.000Z',
    });
  });

  test('conversation array pulled from the outreach doc', async () => {
    seedBasicUser();
    ctx.seed('tenants/acme.com/outreach/ken@yacht.com', {
      replyStatus: 'replied',
      conversation: [
        { direction: 'sent', subject: 'Hi', body: 'How is it going?', ts: '2026-06-15' },
        { direction: 'received', subject: '', body: 'Loving it!', ts: '2026-06-16' },
      ],
    });
    const res = await firestore.getUserDetail('acme.com', 'ken@yacht.com');
    expect(res.conversation).toHaveLength(2);
    expect(res.conversation[0].direction).toBe('sent');
  });

  test('reminders sorted by remindAt ASCENDING (oldest-due first)', async () => {
    seedBasicUser();
    ctx.seed('tenants/acme.com/reminders/r1', {
      email: 'ken@yacht.com',
      remindAt: wrapTimestamp(new Date('2026-08-01T00:00:00Z')),
      body: 'follow up',
    });
    ctx.seed('tenants/acme.com/reminders/r2', {
      email: 'ken@yacht.com',
      remindAt: wrapTimestamp(new Date('2026-07-15T00:00:00Z')),
      body: 'earlier',
    });
    const res = await firestore.getUserDetail('acme.com', 'ken@yacht.com');
    expect(res.reminders).toHaveLength(2);
    expect(res.reminders[0].id).toBe('r2'); // earlier remindAt first
    expect(res.reminders[1].id).toBe('r1');
  });
});

describe('getUserDetail — health score integration', () => {
  test('includes a healthScore in [0, 100] on the response', async () => {
    seedBasicUser();
    ctx.seed('tenants/acme.com/events/e1', {
      email: 'ken@yacht.com', type: 'tracked',
      createdAt: wrapTimestamp(new Date()),
    });
    const res = await firestore.getUserDetail('acme.com', 'ken@yacht.com');
    expect(typeof res.healthScore).toBe('number');
    expect(res.healthScore).toBeGreaterThanOrEqual(0);
    expect(res.healthScore).toBeLessThanOrEqual(100);
  });

  test('brand-new user with no activity scores lower than an active user', async () => {
    seedBasicUser();
    const inactive = await firestore.getUserDetail('acme.com', 'ken@yacht.com');

    // Now seed activity for a second user
    ctx.seed('tenants/acme.com/users/active@yacht.com', {
      email: 'active@yacht.com',
      displayName: 'Active',
      createdAt: wrapTimestamp(new Date(Date.now() - 45 * 86400000)),
    });
    for (let i = 0; i < 20; i++) {
      ctx.seed(`tenants/acme.com/events/e-active-${i}`, {
        email: 'active@yacht.com', type: i % 3 === 0 ? 'exported' : 'tracked',
        createdAt: wrapTimestamp(new Date(Date.now() - i * 86400000)),
      });
    }
    const active = await firestore.getUserDetail('acme.com', 'active@yacht.com');
    expect(active.healthScore).toBeGreaterThan(inactive.healthScore);
  });
});
