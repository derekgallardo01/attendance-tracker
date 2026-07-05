// Tests for getUserMeetingHistory — the /history page's data source. Aggregates
// per-user tracked meetings, cross-meeting people rollup, and a 90-day
// calendar heatmap. Bugs here surface as "wrong meeting list" / "wrong
// attendance rate" — user-facing, easy to notice, hard to test manually.

const { installFirestoreMock, wrapTimestamp } = require('../helpers/firestoreMock');

let ctx, firestore;

beforeEach(() => {
  ctx = installFirestoreMock();
  firestore = require('../../src/services/firestore');
});

afterEach(() => {
  ctx.uninstall();
});

function seedTracked(conferenceIds) {
  for (const cid of conferenceIds) {
    ctx.seed(`tenants/acme.com/events/e-${cid}`, {
      email: 'me@acme.com', type: 'tracked',
      meta: { conferenceId: cid },
    });
  }
}

function seedMeeting(cid, { title, startTime, endTime, participantCount, participants = [] }) {
  ctx.seed(`tenants/acme.com/meetings/${cid}`, {
    conferenceId: cid,
    title: title || 'X',
    participantCount: participantCount || 0,
    startTime: startTime ? wrapTimestamp(startTime) : undefined,
    endTime: endTime ? wrapTimestamp(endTime) : undefined,
    createdAt: startTime ? wrapTimestamp(startTime) : undefined,
  });
  participants.forEach((p, i) => {
    ctx.seed(`tenants/acme.com/meetings/${cid}/participants/p${i}`, {
      email: p.email || '',
      displayName: p.displayName || '',
      present: p.present !== false,
      joinTime: p.joinTime ? wrapTimestamp(p.joinTime) : undefined,
      leaveTime: p.leaveTime ? wrapTimestamp(p.leaveTime) : undefined,
    });
  });
}

describe('getUserMeetingHistory — empty state', () => {
  test('returns empty structure when nothing is seeded', async () => {
    const res = await firestore.getUserMeetingHistory('acme.com', 'nobody@acme.com');
    expect(res.meetings).toEqual([]);
    expect(res.people).toEqual([]);
    expect(res.totalMeetings).toBe(0);
    // Calendar always has 90 zero-count buckets for the heatmap grid
    expect(res.calendar).toHaveLength(90);
    expect(res.calendar.every(c => c.count === 0)).toBe(true);
  });
});

describe('getUserMeetingHistory — meeting filter by tracked events', () => {
  test('returns ONLY meetings the requester has tracked events for', async () => {
    seedTracked(['meet-A']); // Only tracked meet-A
    seedMeeting('meet-A', {
      title: 'Sprint Planning',
      startTime: new Date('2026-06-01T10:00:00Z'),
      endTime: new Date('2026-06-01T11:00:00Z'),
      participantCount: 5,
    });
    // meet-B exists in the tenant but the user didn't track it
    seedMeeting('meet-B', {
      title: 'Someone else\'s meeting',
      startTime: new Date('2026-06-05T10:00:00Z'),
      participantCount: 3,
    });
    const res = await firestore.getUserMeetingHistory('acme.com', 'me@acme.com');
    expect(res.meetings).toHaveLength(1);
    expect(res.meetings[0].title).toBe('Sprint Planning');
    expect(res.meetings[0].conferenceId).toBe('meet-A');
  });

  test('falls back to ALL tenant meetings when user has no tracked events', async () => {
    // Legacy safety net: users who tracked before the events collection existed
    seedMeeting('meet-old', {
      title: 'Old',
      startTime: new Date('2026-05-01T10:00:00Z'),
    });
    const res = await firestore.getUserMeetingHistory('acme.com', 'brandnew@acme.com');
    expect(res.meetings).toHaveLength(1);
    expect(res.meetings[0].title).toBe('Old');
  });

  test('sorts meetings by createdAt/startTime DESCENDING (newest first)', async () => {
    seedTracked(['meet-old', 'meet-new']);
    seedMeeting('meet-old', {
      title: 'Old', startTime: new Date('2026-06-01T10:00:00Z'),
    });
    seedMeeting('meet-new', {
      title: 'New', startTime: new Date('2026-06-15T10:00:00Z'),
    });
    const res = await firestore.getUserMeetingHistory('acme.com', 'me@acme.com');
    expect(res.meetings.map(m => m.title)).toEqual(['New', 'Old']);
  });

  test('computes durationMs from start/end times when both are present', async () => {
    seedTracked(['meet-1']);
    seedMeeting('meet-1', {
      title: 'X',
      startTime: new Date('2026-06-01T10:00:00Z'),
      endTime: new Date('2026-06-01T10:45:00Z'),
    });
    const res = await firestore.getUserMeetingHistory('acme.com', 'me@acme.com');
    expect(res.meetings[0].durationMs).toBe(45 * 60 * 1000);
  });

  test('caps presentNames at 8 per meeting (UI truncation)', async () => {
    seedTracked(['meet-big']);
    const participants = Array.from({ length: 15 }, (_, i) => ({
      email: `p${i}@acme.com`, displayName: `Person ${i}`, present: true,
    }));
    seedMeeting('meet-big', { title: 'Big', participants });
    const res = await firestore.getUserMeetingHistory('acme.com', 'me@acme.com');
    expect(res.meetings[0].presentNames).toHaveLength(8);
  });
});

describe('getUserMeetingHistory — people rollup', () => {
  test('aggregates participants by email across meetings', async () => {
    seedTracked(['m1', 'm2']);
    seedMeeting('m1', {
      title: 'X', startTime: new Date('2026-06-01T10:00:00Z'),
      participants: [{ email: 'alex@x.com', displayName: 'Alex' }],
    });
    seedMeeting('m2', {
      title: 'X', startTime: new Date('2026-06-08T10:00:00Z'),
      participants: [{ email: 'alex@x.com', displayName: 'Alex' }],
    });
    const res = await firestore.getUserMeetingHistory('acme.com', 'me@acme.com');
    expect(res.people).toHaveLength(1);
    expect(res.people[0]).toEqual(expect.objectContaining({
      email: 'alex@x.com', displayName: 'Alex', meetingCount: 2, attendanceRate: 1,
    }));
  });

  test('computes attendance rate = attended / totalMeetings', async () => {
    seedTracked(['m1', 'm2', 'm3']);
    seedMeeting('m1', {
      startTime: new Date('2026-06-01T10:00:00Z'),
      participants: [{ email: 'alex@x.com', displayName: 'Alex' }],
    });
    seedMeeting('m2', {
      startTime: new Date('2026-06-08T10:00:00Z'),
      participants: [], // Alex missed
    });
    seedMeeting('m3', {
      startTime: new Date('2026-06-15T10:00:00Z'),
      participants: [{ email: 'alex@x.com', displayName: 'Alex' }],
    });
    const res = await firestore.getUserMeetingHistory('acme.com', 'me@acme.com');
    const alex = res.people.find(p => p.email === 'alex@x.com');
    expect(alex.meetingCount).toBe(2);
    expect(alex.attendanceRate).toBeCloseTo(2 / 3, 5);
  });

  test('sums totalMinutes across appearances', async () => {
    seedTracked(['m1', 'm2']);
    seedMeeting('m1', {
      startTime: new Date('2026-06-01T10:00:00Z'),
      participants: [{
        email: 'alex@x.com', displayName: 'Alex',
        joinTime: new Date('2026-06-01T10:00:00Z'),
        leaveTime: new Date('2026-06-01T10:30:00Z'),
      }],
    });
    seedMeeting('m2', {
      startTime: new Date('2026-06-08T10:00:00Z'),
      participants: [{
        email: 'alex@x.com', displayName: 'Alex',
        joinTime: new Date('2026-06-08T10:00:00Z'),
        leaveTime: new Date('2026-06-08T11:00:00Z'),
      }],
    });
    const res = await firestore.getUserMeetingHistory('acme.com', 'me@acme.com');
    const alex = res.people.find(p => p.email === 'alex@x.com');
    expect(alex.totalMinutes).toBe(90);
  });

  test('email-less participants get name-based keys', async () => {
    seedTracked(['m1']);
    seedMeeting('m1', {
      startTime: new Date('2026-06-01T10:00:00Z'),
      participants: [
        { email: '', displayName: 'Anonymous Guest' },
        { email: '', displayName: 'Another Guest' },
      ],
    });
    const res = await firestore.getUserMeetingHistory('acme.com', 'me@acme.com');
    expect(res.people).toHaveLength(2);
    expect(res.people.map(p => p.email)).toEqual([null, null]);
  });

  test('people sorted by meetingCount DESCENDING (most active first)', async () => {
    seedTracked(['m1', 'm2', 'm3']);
    seedMeeting('m1', {
      startTime: new Date('2026-06-01T10:00:00Z'),
      participants: [
        { email: 'active@x.com', displayName: 'Active' },
        { email: 'once@x.com', displayName: 'Once' },
      ],
    });
    seedMeeting('m2', {
      startTime: new Date('2026-06-08T10:00:00Z'),
      participants: [{ email: 'active@x.com', displayName: 'Active' }],
    });
    seedMeeting('m3', {
      startTime: new Date('2026-06-15T10:00:00Z'),
      participants: [{ email: 'active@x.com', displayName: 'Active' }],
    });
    const res = await firestore.getUserMeetingHistory('acme.com', 'me@acme.com');
    expect(res.people[0].email).toBe('active@x.com');
    expect(res.people[0].meetingCount).toBe(3);
    expect(res.people[1].email).toBe('once@x.com');
    expect(res.people[1].meetingCount).toBe(1);
  });
});

describe('getUserMeetingHistory — calendar heatmap', () => {
  test('always emits 90 daily buckets (dense, not sparse)', async () => {
    seedTracked(['m1']);
    seedMeeting('m1', {
      startTime: new Date(),
      participants: [],
    });
    const res = await firestore.getUserMeetingHistory('acme.com', 'me@acme.com');
    expect(res.calendar).toHaveLength(90);
    // Every entry has a date + count + titles array
    for (const bucket of res.calendar) {
      expect(typeof bucket.date).toBe('string');
      expect(typeof bucket.count).toBe('number');
      expect(Array.isArray(bucket.titles)).toBe(true);
    }
  });

  test('bumps count on the day the meeting happened', async () => {
    const today = new Date();
    seedTracked(['m1', 'm2']);
    seedMeeting('m1', { title: 'A', startTime: today });
    seedMeeting('m2', { title: 'B', startTime: today });
    const res = await firestore.getUserMeetingHistory('acme.com', 'me@acme.com');
    const todayKey = today.toISOString().slice(0, 10);
    const bucket = res.calendar.find(c => c.date === todayKey);
    expect(bucket.count).toBe(2);
    expect(bucket.titles).toEqual(expect.arrayContaining(['A', 'B']));
  });

  test('caps titles at 5 per day (dense clusters don\'t bloat)', async () => {
    const today = new Date();
    const cids = Array.from({ length: 10 }, (_, i) => `m${i}`);
    seedTracked(cids);
    cids.forEach((c, i) => seedMeeting(c, { title: `Meeting ${i}`, startTime: today }));
    const res = await firestore.getUserMeetingHistory('acme.com', 'me@acme.com');
    const todayKey = today.toISOString().slice(0, 10);
    const bucket = res.calendar.find(c => c.date === todayKey);
    expect(bucket.count).toBe(10);
    expect(bucket.titles.length).toBeLessThanOrEqual(5);
  });
});
