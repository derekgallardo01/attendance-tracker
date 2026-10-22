// Tests for attendance persistence debouncing and roster fingerprinting.
// Prevents high-frequency 10–30s polling loops from hammering Firestore when
// attendance data has not changed, while guaranteeing immediate writes on any
// roster change (joins, leaves, reconnects) and periodic 5-minute checkpoints.

const { installFirestoreMock } = require('../helpers/firestoreMock');

let ctx, firestore;

beforeEach(() => {
  ctx = installFirestoreMock();
  firestore = require('../../src/services/firestore');
  firestore.clearAttendanceDebounceCache();
});

afterEach(() => {
  ctx.uninstall();
});

describe('persistAttendance — write debouncing', () => {
  const baseParticipants = [
    { participantId: 'p1', displayName: 'Alice', email: 'alice@acme.edu', present: true, sessions: 1, joinTime: '2026-10-07T10:00:00Z', leaveTime: null },
    { participantId: 'p2', displayName: 'Bob', email: 'bob@acme.edu', present: true, sessions: 1, joinTime: '2026-10-07T10:01:00Z', leaveTime: null },
  ];

  test('first call writes meeting doc, participant subdocs, and tracked event', async () => {
    const res = await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu');
    expect(res).toBe(true);

    const meeting = ctx.read('tenants/acme.edu/meetings/class-101__r1');
    expect(meeting).toBeDefined();
    expect(meeting.participantCount).toBe(2);

    expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p1')).toBeDefined();
    expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p2')).toBeDefined();

    await new Promise(r => setImmediate(r));
    const events = ctx.list('tenants/acme.edu/events').map(e => e.data);
    const tracked = events.filter(e => e.type === 'tracked');
    expect(tracked).toHaveLength(1);
    expect(tracked[0].email).toBe('teacher@acme.edu');
    expect(tracked[0].meta.conferenceId).toBe('class-101');
  });

  test('second call with identical roster is debounced (skips Firestore writes)', async () => {
    await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu');

    // Mutate a field in the mock doc to check if a second call overwrites it
    ctx.seed('tenants/acme.edu/meetings/class-101__r1', {
      ...ctx.read('tenants/acme.edu/meetings/class-101__r1'),
      sentinel: 'untouched',
    });

    const res = await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu');
    expect(res).toBe(false);

    // Sentinel must still be present because no write occurred
    const meeting = ctx.read('tenants/acme.edu/meetings/class-101__r1');
    expect(meeting.sentinel).toBe('untouched');

    await new Promise(r => setImmediate(r));
    const events = ctx.list('tenants/acme.edu/events').map(e => e.data);
    expect(events.filter(e => e.type === 'tracked')).toHaveLength(1); // still only 1 event
  });

  test('new participant joining triggers immediate delta write only for added participant, skips unchanged participants and codeRef write, and reuses cached metadata without re-reading', async () => {
    await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu');

    // Stamp sentinels onto p1, p2, and the code doc to verify they are NOT re-written on p3 join
    const p1Before = ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p1');
    const p2Before = ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p2');
    const codeBefore = ctx.read('tenants/acme.edu/meetings/class-101');
    ctx.seed('tenants/acme.edu/meetings/class-101__r1/participants/p1', { ...p1Before, updatedAt: 'sentinel-p1' });
    ctx.seed('tenants/acme.edu/meetings/class-101__r1/participants/p2', { ...p2Before, updatedAt: 'sentinel-p2' });
    ctx.seed('tenants/acme.edu/meetings/class-101', { ...codeBefore, updatedAt: 'sentinel-code' });
    // Also mutate the stored meeting doc's participantCount to 999 in the backing store:
    // if persistAttendance re-read meetingRef.get(), it would take Math.max(3, 999) = 999;
    // because it reuses cached entry.prevMeetingMeta (participantCount: 2), it writes Math.max(3, 2) = 3.
    ctx.seed('tenants/acme.edu/meetings/class-101__r1', {
      ...ctx.read('tenants/acme.edu/meetings/class-101__r1'),
      participantCount: 999,
    });

    const expandedRoster = [
      ...baseParticipants,
      { participantId: 'p3', displayName: 'Charlie', email: 'charlie@acme.edu', present: true, sessions: 1, joinTime: '2026-10-07T10:05:00Z', leaveTime: null },
    ];

    const res = await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', expandedRoster, 'teacher@acme.edu');
    expect(res).toBe(true);

    const meeting = ctx.read('tenants/acme.edu/meetings/class-101__r1');
    expect(meeting.participantCount).toBe(3);
    expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p3')).toBeDefined();
    // Unchanged participants p1 and p2 were NOT re-written
    expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p1').updatedAt).toBe('sentinel-p1');
    expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p2').updatedAt).toBe('sentinel-p2');
    // Code doc was NOT re-written on mid-checkpoint join
    expect(ctx.read('tenants/acme.edu/meetings/class-101').updatedAt).toBe('sentinel-code');
  });

  test('participant leave status change writes only the changed participant doc', async () => {
    await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu');

    ctx.seed('tenants/acme.edu/meetings/class-101__r1/participants/p1', {
      ...ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p1'),
      updatedAt: 'sentinel-p1-untouched',
    });

    const updatedRoster = [
      baseParticipants[0],
      { ...baseParticipants[1], present: false, leaveTime: '2026-10-07T10:25:00Z' },
    ];

    const res = await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', updatedRoster, 'teacher@acme.edu');
    expect(res).toBe(true);

    const bob = ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p2');
    expect(bob.present).toBe(false);
    expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p1').updatedAt).toBe('sentinel-p1-untouched');
  });

  test('force option bypasses debounce even when roster is identical', async () => {
    await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu');

    const res = await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu', { force: true });
    expect(res).toBe(true);
  });

  test('checkpoint interval triggers meeting write, skips unchanged participant batch writes, and writes only participants whose duration changed', async () => {
    const originalDateNow = Date.now;
    let mockNow = 1000000;
    Date.now = () => mockNow;

    try {
      await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu');

      // Tag participants p1 and p2 with sentinels to verify unchanged checkpoint does NOT overwrite participant docs
      ctx.seed('tenants/acme.edu/meetings/class-101__r1/participants/p1', {
        ...ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p1'),
        updatedAt: 'sentinel-p1',
      });
      ctx.seed('tenants/acme.edu/meetings/class-101__r1/participants/p2', {
        ...ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p2'),
        updatedAt: 'sentinel-p2',
      });

      // 1 minute later: still debounced
      mockNow += 60 * 1000;
      expect(await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu')).toBe(false);

      // 5 minutes later (total 6 minutes since first write): checkpoint due, durations unchanged
      mockNow += 5 * 60 * 1000;
      expect(await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu')).toBe(true);
      expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p1').updatedAt).toBe('sentinel-p1');
      expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p2').updatedAt).toBe('sentinel-p2');

      // Another 5 minutes later with updated durationMs on p1 only: p1 IS written, p2 is NOT re-written
      mockNow += 5 * 60 * 1000;
      const durationUpdated = [
        { ...baseParticipants[0], durationMs: 600000, durationMin: 10 },
        baseParticipants[1],
      ];
      expect(await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', durationUpdated, 'teacher@acme.edu')).toBe(true);
      expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p1').durationMin).toBe(10);
      expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p1').updatedAt).not.toBe('sentinel-p1');
      expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p2').updatedAt).toBe('sentinel-p2');
    } finally {
      Date.now = originalDateNow;
    }
  });

  test('mid-checkpoint rosterChanged delta writes do not starve the 5-minute checkpoint timer for existing participants', async () => {
    const originalDateNow = Date.now;
    let mockNow = 1000000;
    Date.now = () => mockNow;

    try {
      // t = 0: Initial persist with p1 (active, 0m) and p2 (already left at 5m, duration ثابت)
      const initialRoster = [
        { ...baseParticipants[0], durationMs: 0, durationMin: 0 },
        { ...baseParticipants[1], present: false, leaveTime: '2026-10-07T10:05:00Z', durationMs: 240000, durationMin: 4 },
      ];
      await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', initialRoster, 'teacher@acme.edu');

      ctx.seed('tenants/acme.edu/meetings/class-101__r1/participants/p2', {
        ...ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p2'),
        updatedAt: 'sentinel-p2-left',
      });

      // t = 3 min: p3 joins (rosterChanged = true, isCheckpointDue = false).
      // p1 now has durationMin: 3, but since this is a mid-checkpoint rosterChanged poll,
      // only p3 is written and p1's duration update is deferred until the 5-min checkpoint.
      mockNow += 3 * 60 * 1000;
      const rosterAt3m = [
        { ...baseParticipants[0], durationMs: 180000, durationMin: 3 },
        initialRoster[1],
        { participantId: 'p3', displayName: 'Charlie', email: 'charlie@acme.edu', present: true, sessions: 1, joinTime: '2026-10-07T10:03:00Z', leaveTime: null, durationMs: 0, durationMin: 0 },
      ];
      expect(await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', rosterAt3m, 'teacher@acme.edu')).toBe(true);
      expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p3')).toBeDefined();
      expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p1').durationMin).toBe(0); // deferred

      // t = 5 min (5 minutes since t = 0 initial checkpoint, only 2 minutes since t = 3m join):
      // Even though a rosterChanged happened at t = 3m, the 5-minute checkpoint MUST fire at t = 5m!
      // Simultaneously, p4 joins at t = 5m (both isCheckpointDue and rosterChanged are true).
      mockNow += 2 * 60 * 1000;
      const rosterAt5m = [
        { ...baseParticipants[0], durationMs: 300000, durationMin: 5 },
        initialRoster[1], // p2 left earlier, duration unchanged -> must NOT be re-written
        { ...rosterAt3m[2], durationMs: 120000, durationMin: 2 },
        { participantId: 'p4', displayName: 'Dana', email: 'dana@acme.edu', present: true, sessions: 1, joinTime: '2026-10-07T10:05:00Z', leaveTime: null, durationMs: 0, durationMin: 0 },
      ];
      expect(await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', rosterAt5m, 'teacher@acme.edu')).toBe(true);
      // p1 and p3 had duration updates flushed at the 5-min checkpoint, p4 was added, and p2 remained untouched
      expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p1').durationMin).toBe(5);
      expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p3').durationMin).toBe(2);
      expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p4')).toBeDefined();
      expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p2').updatedAt).toBe('sentinel-p2-left');
    } finally {
      Date.now = originalDateNow;
    }
  });

  test('updates deterministic tracked event doc monotonically when students join after teacher opens panel solo', async () => {
    const soloTeacher = [
      { participantId: 'p0', displayName: 'Teacher', email: 'teacher@acme.edu', present: true, sessions: 1, joinTime: '2026-10-07T09:59:00Z', leaveTime: null },
    ];
    await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', soloTeacher, 'teacher@acme.edu');
    await new Promise(r => setImmediate(r));

    let trackedEvents = ctx.list('tenants/acme.edu/events').filter(e => e.data.type === 'tracked');
    expect(trackedEvents).toHaveLength(1);
    expect(trackedEvents[0].data.meta.participantCount).toBe(1);
    expect(trackedEvents[0].data.meta.distinctAttendees).toBe(1);
    const initialCreatedAt = trackedEvents[0].data.createdAt;

    // Students join the class
    const withStudents = [
      ...soloTeacher,
      ...baseParticipants,
    ];
    await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', withStudents, 'teacher@acme.edu');
    await new Promise(r => setImmediate(r));

    trackedEvents = ctx.list('tenants/acme.edu/events').filter(e => e.data.type === 'tracked');
    expect(trackedEvents).toHaveLength(1); // still strictly 1 doc
    expect(trackedEvents[0].data.meta.participantCount).toBe(3);
    expect(trackedEvents[0].data.meta.distinctAttendees).toBe(3);
    expect(trackedEvents[0].data.createdAt).toEqual(initialCreatedAt);
  });

  test('second actor accessing unchanged meeting emits a tracked event for the new actor', async () => {
    await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu');

    // Co-host/TA loads panel on identical roster
    const res = await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'ta@acme.edu');
    expect(res).toBe(false); // meeting doc write skipped

    await new Promise(r => setImmediate(r));
    const events = ctx.list('tenants/acme.edu/events').map(e => e.data);
    const trackedEvents = events.filter(e => e.type === 'tracked');
    expect(trackedEvents).toHaveLength(2);
    expect(trackedEvents.map(e => e.email).sort()).toEqual(['ta@acme.edu', 'teacher@acme.edu']);
  });

  test('clearAttendanceDebounceCache resets cache completely', async () => {
    await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu');

    firestore.clearAttendanceDebounceCache();

    // After clearing, same roster writes as a fresh first persist
    const res = await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu');
    expect(res).toBe(true);

    // Deterministic tracked event doc ID ensures only ONE tracked event doc exists per (conferenceId, instanceId, email)
    await new Promise(r => setImmediate(r));
    const trackedEvents = ctx.list('tenants/acme.edu/events').filter(e => e.data.type === 'tracked');
    expect(trackedEvents).toHaveLength(1);
    expect(trackedEvents[0].path).toBe('tenants/acme.edu/events/tracked_class_101_r1_teacher_acme_edu');
  });
});
