// Tests for participant-scoped operations: private notes (setParticipantNote /
// getParticipantNote) and cross-meeting history rollup (getParticipantHistory).
// Notes are the CRM-style "remember to follow up with Ken" surface — they're
// private to the requesting user and stored at
// tenants/{domain}/users/{requester}/notes/{encodedKey}.

const { installFirestoreMock, wrapTimestamp } = require('../helpers/firestoreMock');

let ctx, firestore;

beforeEach(() => {
  ctx = installFirestoreMock();
  firestore = require('../../src/services/firestore');
});

afterEach(() => {
  ctx.uninstall();
});

// ── setParticipantNote / getParticipantNote ──

describe('setParticipantNote — private per-requester notes', () => {
  test('saves a new note under the requester\'s user doc', async () => {
    const res = await firestore.setParticipantNote(
      'acme.com', 'me@acme.com', 'ken@yacht.com', 'Follow up next week'
    );
    expect(res).toEqual({ saved: true });
    const doc = ctx.read('tenants/acme.com/users/me@acme.com/notes/ken@yacht.com');
    expect(doc.body).toBe('Follow up next week');
    expect(doc.participantKey).toBe('ken@yacht.com');
  });

  test('lowercases the requester email in the storage path', async () => {
    await firestore.setParticipantNote(
      'acme.com', 'ME@acme.com', 'other@x.com', 'hi'
    );
    // Doc lives at the lowercased path
    expect(ctx.read('tenants/acme.com/users/me@acme.com/notes/other@x.com')).toBeDefined();
  });

  test('caps the note body at 2000 characters', async () => {
    const bigNote = 'x'.repeat(5000);
    await firestore.setParticipantNote('acme.com', 'me@acme.com', 'k@x.com', bigNote);
    const doc = ctx.read('tenants/acme.com/users/me@acme.com/notes/k@x.com');
    expect(doc.body.length).toBe(2000);
  });

  test('empty body deletes the note (clear-out semantics)', async () => {
    ctx.seed('tenants/acme.com/users/me@acme.com/notes/k@x.com', {
      participantKey: 'k@x.com', body: 'old note',
    });
    const res = await firestore.setParticipantNote(
      'acme.com', 'me@acme.com', 'k@x.com', ''
    );
    expect(res).toEqual({ deleted: true });
    expect(ctx.read('tenants/acme.com/users/me@acme.com/notes/k@x.com')).toBeUndefined();
  });

  test('whitespace-only body also deletes (empty-check uses trim)', async () => {
    ctx.seed('tenants/acme.com/users/me@acme.com/notes/k@x.com', {
      participantKey: 'k@x.com', body: 'old',
    });
    const res = await firestore.setParticipantNote(
      'acme.com', 'me@acme.com', 'k@x.com', '   \n\t  '
    );
    expect(res).toEqual({ deleted: true });
  });

  test('sanitizes participantKey with slashes / hashes / question marks', async () => {
    // Firestore doc IDs cannot contain '/'. Notes on synthetic keys like
    // `name:First/Last` must not blow up.
    await firestore.setParticipantNote(
      'acme.com', 'me@acme.com', 'name:First/Last?', 'weird key'
    );
    // Sanitizer replaces / # ? with underscore
    const doc = ctx.read('tenants/acme.com/users/me@acme.com/notes/name:First_Last_');
    expect(doc).toBeDefined();
    expect(doc.body).toBe('weird key');
    // Original key preserved in the payload for readback
    expect(doc.participantKey).toBe('name:First/Last?');
  });

  test('multiple requesters can have INDEPENDENT notes about the same person', async () => {
    await firestore.setParticipantNote('acme.com', 'alice@acme.com', 'ken@x.com', 'Alice note');
    await firestore.setParticipantNote('acme.com', 'bob@acme.com', 'ken@x.com', 'Bob note');
    expect(ctx.read('tenants/acme.com/users/alice@acme.com/notes/ken@x.com').body).toBe('Alice note');
    expect(ctx.read('tenants/acme.com/users/bob@acme.com/notes/ken@x.com').body).toBe('Bob note');
  });
});

describe('getParticipantNote', () => {
  test('returns empty string when no note exists (defensive default)', async () => {
    const body = await firestore.getParticipantNote('acme.com', 'me@acme.com', 'k@x.com');
    expect(body).toBe('');
  });

  test('returns the stored body', async () => {
    ctx.seed('tenants/acme.com/users/me@acme.com/notes/k@x.com', {
      participantKey: 'k@x.com', body: 'saved note',
    });
    const body = await firestore.getParticipantNote('acme.com', 'me@acme.com', 'k@x.com');
    expect(body).toBe('saved note');
  });

  test('applies the same key encoding as setParticipantNote (round-trip)', async () => {
    await firestore.setParticipantNote(
      'acme.com', 'me@acme.com', 'name:With/Slash', 'the note'
    );
    const body = await firestore.getParticipantNote(
      'acme.com', 'me@acme.com', 'name:With/Slash'
    );
    expect(body).toBe('the note');
  });

  test('returns empty string when the doc exists but has no body field', async () => {
    ctx.seed('tenants/acme.com/users/me@acme.com/notes/k@x.com', {
      participantKey: 'k@x.com', // no body field
    });
    const body = await firestore.getParticipantNote('acme.com', 'me@acme.com', 'k@x.com');
    expect(body).toBe('');
  });
});

// ── getParticipantHistory ──

describe('getParticipantHistory — cross-meeting rollup', () => {
  function seedThreeMeetings() {
    // Requester tracked all three meetings (events collection)
    ctx.seed('tenants/acme.com/events/e1', {
      email: 'me@acme.com', type: 'tracked',
      meta: { conferenceId: 'meet-1' },
    });
    ctx.seed('tenants/acme.com/events/e2', {
      email: 'me@acme.com', type: 'tracked',
      meta: { conferenceId: 'meet-2' },
    });
    ctx.seed('tenants/acme.com/events/e3', {
      email: 'me@acme.com', type: 'tracked',
      meta: { conferenceId: 'meet-3' },
    });
    // Three meetings, ordered by start time
    ctx.seed('tenants/acme.com/meetings/meet-1', {
      title: 'Sprint Planning',
      startTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
    });
    ctx.seed('tenants/acme.com/meetings/meet-2', {
      title: 'Sprint Planning',
      startTime: wrapTimestamp(new Date('2026-06-08T10:00:00Z')),
    });
    ctx.seed('tenants/acme.com/meetings/meet-3', {
      title: 'Retro',
      startTime: wrapTimestamp(new Date('2026-06-15T10:00:00Z')),
    });
    // Ken attended all three
    ctx.seed('tenants/acme.com/meetings/meet-1/participants/p1', {
      email: 'ken@yacht.com', displayName: 'Ken',
      joinTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
      leaveTime: wrapTimestamp(new Date('2026-06-01T10:30:00Z')),
      present: true,
    });
    ctx.seed('tenants/acme.com/meetings/meet-2/participants/p2', {
      email: 'ken@yacht.com', displayName: 'Ken',
      joinTime: wrapTimestamp(new Date('2026-06-08T10:00:00Z')),
      leaveTime: wrapTimestamp(new Date('2026-06-08T10:45:00Z')),
      present: true,
    });
    ctx.seed('tenants/acme.com/meetings/meet-3/participants/p3', {
      email: 'ken@yacht.com', displayName: 'Ken',
      joinTime: wrapTimestamp(new Date('2026-06-15T10:00:00Z')),
      leaveTime: wrapTimestamp(new Date('2026-06-15T11:00:00Z')),
      present: true,
    });
  }

  test('rolls up appearances across meetings the requester tracked', async () => {
    seedThreeMeetings();
    const res = await firestore.getParticipantHistory('acme.com', 'me@acme.com', 'ken@yacht.com');
    expect(res.meetingCount).toBe(3);
    expect(res.totalMeetings).toBe(3);
    expect(res.attendanceRate).toBe(1);
    expect(res.email).toBe('ken@yacht.com');
    expect(res.displayName).toBe('Ken');
  });

  test('appearances sorted by meeting start descending (most recent first)', async () => {
    seedThreeMeetings();
    const res = await firestore.getParticipantHistory('acme.com', 'me@acme.com', 'ken@yacht.com');
    const dates = res.recent.map(a => a.meetingStart);
    expect(dates[0]).toBe('2026-06-15T10:00:00.000Z');
    expect(dates[2]).toBe('2026-06-01T10:00:00.000Z');
  });

  test('firstSeen = oldest appearance, lastSeen = newest', async () => {
    seedThreeMeetings();
    const res = await firestore.getParticipantHistory('acme.com', 'me@acme.com', 'ken@yacht.com');
    expect(res.firstSeen).toBe('2026-06-01T10:00:00.000Z');
    expect(res.lastSeen).toBe('2026-06-15T10:00:00.000Z');
  });

  test('computes total + average minutes across appearances', async () => {
    seedThreeMeetings();
    const res = await firestore.getParticipantHistory('acme.com', 'me@acme.com', 'ken@yacht.com');
    // 30 + 45 + 60 = 135 min total; avg = 45
    expect(res.totalMinutes).toBe(135);
    expect(res.avgDurationMinutes).toBe(45);
  });

  test('case-insensitive email match', async () => {
    seedThreeMeetings();
    const res = await firestore.getParticipantHistory('acme.com', 'me@acme.com', 'KEN@YACHT.COM');
    expect(res.meetingCount).toBe(3);
  });

  test('name-based key matches participants who have no email', async () => {
    ctx.seed('tenants/acme.com/events/e1', {
      email: 'me@acme.com', type: 'tracked', meta: { conferenceId: 'm1' },
    });
    ctx.seed('tenants/acme.com/meetings/m1', {
      title: 'X', startTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
    });
    ctx.seed('tenants/acme.com/meetings/m1/participants/p1', {
      email: '', displayName: 'Anonymous Guest',
      joinTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
      leaveTime: wrapTimestamp(new Date('2026-06-01T10:30:00Z')),
      present: true,
    });
    const res = await firestore.getParticipantHistory('acme.com', 'me@acme.com', 'name:Anonymous Guest');
    expect(res.meetingCount).toBe(1);
    expect(res.displayName).toBe('Anonymous Guest');
    expect(res.email).toBeNull();
  });

  test('returns zero counts when the participant never appeared', async () => {
    seedThreeMeetings();
    const res = await firestore.getParticipantHistory(
      'acme.com', 'me@acme.com', 'ghost@nobody.com'
    );
    expect(res.meetingCount).toBe(0);
    expect(res.totalMeetings).toBe(3);
    expect(res.attendanceRate).toBe(0);
    expect(res.totalMinutes).toBe(0);
    expect(res.avgDurationMinutes).toBeNull();
    expect(res.recent).toEqual([]);
  });

  test('returns no meetings when the requester has no tracked events (no domain-wide fallback)', async () => {
    // No events seeded for the requester → they must see nothing, not the
    // whole domain's meetings. Guards against the same-domain data leak on
    // shared tenants (every gmail.com user lands in one tenant).
    ctx.seed('tenants/acme.com/meetings/m1', {
      title: 'X', startTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
    });
    ctx.seed('tenants/acme.com/meetings/m1/participants/p1', {
      email: 'ken@yacht.com', displayName: 'Ken',
      joinTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
      leaveTime: wrapTimestamp(new Date('2026-06-01T10:30:00Z')),
      present: true,
    });
    const res = await firestore.getParticipantHistory(
      'acme.com', 'brandnew@acme.com', 'ken@yacht.com'
    );
    expect(res.meetingCount).toBe(0);
    expect(res.totalMeetings).toBe(0);
  });
});
