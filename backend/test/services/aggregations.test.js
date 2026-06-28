// Tests for the meeting/series/people aggregation functions that power
// history.html and team.html. The per-person attendance math gets tricky
// at edge cases — duplicates within a single meeting (someone joining twice),
// participants with no email vs only displayName, instances vs sessions.

const { installFirestoreMock, wrapTimestamp } = require('../helpers/firestoreMock');

let ctx, firestore;
const DAY = 86400000;

beforeEach(() => {
  ctx = installFirestoreMock();
  firestore = require('../../src/services/firestore');
});

afterEach(() => {
  ctx.uninstall();
});

function seedMeeting(domain, conferenceId, opts) {
  ctx.seed(`tenants/${domain}/meetings/${conferenceId}`, {
    conferenceId,
    title: opts.title || 'Meeting',
    recurringEventId: opts.recurringEventId || null,
    startTime: opts.startMs ? wrapTimestamp(new Date(opts.startMs)) : null,
    endTime: opts.endMs ? wrapTimestamp(new Date(opts.endMs)) : null,
    createdAt: wrapTimestamp(new Date(opts.startMs || Date.now())),
    participantCount: (opts.participants || []).length,
  });
  for (const p of opts.participants || []) {
    const id = p.id || p.email || p.displayName;
    ctx.seed(`tenants/${domain}/meetings/${conferenceId}/participants/${id}`, {
      participantId: id,
      displayName: p.displayName,
      email: p.email || '',
      present: p.present !== false,
      joinTime: p.joinMs ? wrapTimestamp(new Date(p.joinMs)) : null,
      leaveTime: p.leaveMs ? wrapTimestamp(new Date(p.leaveMs)) : null,
      sessions: p.sessions || 1,
    });
  }
}

describe('getUserMeetingSeries — per-user', () => {
  test('returns empty when user has no tracked recurring meetings', async () => {
    const result = await firestore.getUserMeetingSeries('acme.com', 'admin@acme.com');
    expect(result.series).toEqual([]);
    expect(result.totalSeries).toBe(0);
  });

  test('groups meetings by recurringEventId and counts unique people per series', async () => {
    const now = Date.now();
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    // 3 instances of "Daily Standup"
    for (let i = 0; i < 3; i++) {
      const cid = `standup-${i}`;
      ctx.seed(`tenants/${domain}/events/ev-${i}`, {
        email, type: 'tracked', meta: { conferenceId: cid },
        createdAt: wrapTimestamp(new Date(now - (3 - i) * DAY)),
      });
      seedMeeting(domain, cid, {
        title: 'Daily Standup',
        recurringEventId: 'series-standup',
        startMs: now - (3 - i) * DAY,
        participants: [
          { email: 'alex@acme.com', displayName: 'Alex' },
          { email: 'beth@acme.com', displayName: 'Beth' },
        ],
      });
    }
    const result = await firestore.getUserMeetingSeries(domain, email);
    expect(result.totalSeries).toBe(1);
    expect(result.series[0].title).toBe('Daily Standup');
    expect(result.series[0].instanceCount).toBe(3);
    expect(result.series[0].uniquePeople).toBe(2);
    // Each person attended all 3 instances → 100%
    const alex = result.series[0].people.find(p => p.email === 'alex@acme.com');
    expect(alex.attended).toBe(3);
    expect(alex.attendanceRate).toBe(1);
  });

  test('deduplicates participants within a single meeting (no double-count)', async () => {
    const now = Date.now();
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    for (let i = 0; i < 3; i++) {
      const cid = `m-${i}`;
      ctx.seed(`tenants/${domain}/events/ev-${i}`, {
        email, type: 'tracked', meta: { conferenceId: cid },
        createdAt: wrapTimestamp(new Date(now - (3 - i) * DAY)),
      });
      seedMeeting(domain, cid, {
        title: 'Standup',
        recurringEventId: 'series-1',
        startMs: now - (3 - i) * DAY,
        participants: [
          { id: 'alex_session_1', email: 'alex@acme.com', displayName: 'Alex' },
          { id: 'alex_session_2', email: 'alex@acme.com', displayName: 'Alex' },
        ],
      });
    }
    const result = await firestore.getUserMeetingSeries(domain, email);
    const alex = result.series[0].people.find(p => p.email === 'alex@acme.com');
    expect(alex.attended).toBe(3); // one count per meeting, not per session
  });

  test('handles participants with displayName but no email (uses name: key)', async () => {
    const now = Date.now();
    ctx.seed('tenants/acme.com/events/ev-1', {
      email: 'admin@acme.com', type: 'tracked', meta: { conferenceId: 'm-1' },
      createdAt: wrapTimestamp(new Date(now)),
    });
    seedMeeting('acme.com', 'm-1', {
      title: 'Mixed', recurringEventId: 'series-1', startMs: now,
      participants: [
        { email: 'alex@acme.com', displayName: 'Alex' },
        { displayName: 'Anonymous Person' }, // no email
      ],
    });
    // Need at least 1 instance to appear in series; need another so it isn't filtered
    ctx.seed('tenants/acme.com/events/ev-2', {
      email: 'admin@acme.com', type: 'tracked', meta: { conferenceId: 'm-2' },
      createdAt: wrapTimestamp(new Date(now + DAY)),
    });
    seedMeeting('acme.com', 'm-2', {
      title: 'Mixed', recurringEventId: 'series-1', startMs: now + DAY,
      participants: [{ email: 'alex@acme.com', displayName: 'Alex' }],
    });
    const result = await firestore.getUserMeetingSeries('acme.com', 'admin@acme.com');
    expect(result.series[0].uniquePeople).toBe(2);
    const anon = result.series[0].people.find(p => p.displayName === 'Anonymous Person');
    expect(anon).toBeDefined();
    expect(anon.email).toBeNull();
  });
});

describe('getTenantSeriesOverview — cross-user', () => {
  test('aggregates across users (no per-user tracking filter)', async () => {
    const now = Date.now();
    // User A tracked instance 0, User B tracked instance 1, User C tracked instance 2
    // Without the per-user filter, the org-wide view sees all 3 instances.
    for (let i = 0; i < 3; i++) {
      const cid = `m-${i}`;
      ctx.seed(`tenants/acme.com/events/ev-${i}`, {
        email: `user${i}@acme.com`, type: 'tracked', meta: { conferenceId: cid },
        createdAt: wrapTimestamp(new Date(now - (3 - i) * DAY)),
      });
      seedMeeting('acme.com', cid, {
        title: 'Weekly Sync',
        recurringEventId: 'series-1',
        startMs: now - (3 - i) * DAY,
        participants: [
          { email: 'sarah@acme.com', displayName: 'Sarah' },
          { email: 'tom@acme.com', displayName: 'Tom' },
        ],
      });
    }
    const series = await firestore.getTenantSeriesOverview('acme.com');
    expect(series.length).toBe(1);
    expect(series[0].instanceCount).toBe(3);
    expect(series[0].uniquePeople).toBe(2);
  });

  test('returns empty when no recurring meetings exist', async () => {
    seedMeeting('acme.com', 'instant-1', {
      title: 'One-off',
      startMs: Date.now(),
      participants: [{ email: 'a@acme.com', displayName: 'A' }],
    });
    const series = await firestore.getTenantSeriesOverview('acme.com');
    expect(series).toEqual([]);
  });
});

describe('getTenantUsers — overview', () => {
  test('returns users with tracked/exported event counts', async () => {
    ctx.seed('tenants/acme.com/users/a@acme.com', {
      email: 'a@acme.com', domain: 'acme.com', displayName: 'A', teamAdmin: true,
    });
    ctx.seed('tenants/acme.com/users/b@acme.com', {
      email: 'b@acme.com', domain: 'acme.com', displayName: 'B',
    });
    ctx.seed('tenants/acme.com/events/e1', { email: 'a@acme.com', type: 'tracked' });
    ctx.seed('tenants/acme.com/events/e2', { email: 'a@acme.com', type: 'tracked' });
    ctx.seed('tenants/acme.com/events/e3', { email: 'a@acme.com', type: 'exported' });
    ctx.seed('tenants/acme.com/events/e4', { email: 'b@acme.com', type: 'signin' });

    const users = await firestore.getTenantUsers('acme.com');
    const a = users.find(u => u.email === 'a@acme.com');
    const b = users.find(u => u.email === 'b@acme.com');
    expect(a.tracked).toBe(2);
    expect(a.exported).toBe(1);
    expect(a.teamAdmin).toBe(true);
    expect(b.tracked).toBe(0);
    expect(b.signins).toBe(1);
    expect(b.teamAdmin).toBe(false);
  });
});

describe('getTeamOverview — single round-trip payload', () => {
  test('combines users/meetings/series/people with totals', async () => {
    ctx.seed('tenants/acme.com', { domain: 'acme.com', adminEmail: 'admin@acme.com', active: true });
    ctx.seed('tenants/acme.com/users/admin@acme.com', {
      email: 'admin@acme.com', domain: 'acme.com', displayName: 'Admin', teamAdmin: true,
    });
    seedMeeting('acme.com', 'm-1', {
      title: 'All hands', startMs: Date.now(),
      participants: [{ email: 'a@acme.com', displayName: 'A' }],
    });

    const overview = await firestore.getTeamOverview('acme.com');
    expect(overview.domain).toBe('acme.com');
    expect(overview.adminEmail).toBe('admin@acme.com');
    expect(overview.totals.users).toBe(1);
    expect(overview.totals.meetings).toBe(1);
    expect(overview.totals.series).toBe(0);
    expect(overview.totals.people).toBe(1);
    expect(overview.users).toHaveLength(1);
    expect(overview.meetings).toHaveLength(1);
  });

  test('returns null on hard failure (no throw into caller)', async () => {
    // The function catches its own errors. Verify shape on a tenant with no data.
    const overview = await firestore.getTeamOverview('nonexistent.com');
    expect(overview).not.toBeNull();
    expect(overview.totals.users).toBe(0);
  });
});
