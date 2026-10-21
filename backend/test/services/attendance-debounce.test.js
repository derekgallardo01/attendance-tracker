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

  test('new participant joining triggers immediate write', async () => {
    await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu');

    const expandedRoster = [
      ...baseParticipants,
      { participantId: 'p3', displayName: 'Charlie', email: 'charlie@acme.edu', present: true, sessions: 1, joinTime: '2026-10-07T10:05:00Z', leaveTime: null },
    ];

    const res = await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', expandedRoster, 'teacher@acme.edu');
    expect(res).toBe(true);

    const meeting = ctx.read('tenants/acme.edu/meetings/class-101__r1');
    expect(meeting.participantCount).toBe(3);
    expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p3')).toBeDefined();
  });

  test('participant leave status change triggers immediate write', async () => {
    await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu');

    const updatedRoster = [
      baseParticipants[0],
      { ...baseParticipants[1], present: false, leaveTime: '2026-10-07T10:25:00Z' },
    ];

    const res = await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', updatedRoster, 'teacher@acme.edu');
    expect(res).toBe(true);

    const bob = ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p2');
    expect(bob.present).toBe(false);
  });

  test('force option bypasses debounce even when roster is identical', async () => {
    await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu');

    const res = await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu', { force: true });
    expect(res).toBe(true);
  });

  test('checkpoint interval triggers meeting write, skips unchanged participant batch writes, and writes participants when duration changes', async () => {
    const originalDateNow = Date.now;
    let mockNow = 1000000;
    Date.now = () => mockNow;

    try {
      await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu');

      // Tag participant p1 with a sentinel to verify unchanged checkpoint does NOT overwrite participant docs
      ctx.seed('tenants/acme.edu/meetings/class-101__r1/participants/p1', {
        ...ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p1'),
        checkpointSentinel: 'kept',
      });

      // 1 minute later: still debounced
      mockNow += 60 * 1000;
      expect(await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu')).toBe(false);

      // 5 minutes later (total 6 minutes since first write): checkpoint due, durations unchanged
      mockNow += 5 * 60 * 1000;
      expect(await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu')).toBe(true);
      expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p1').checkpointSentinel).toBe('kept');

      // Another 5 minutes later with updated durationMs: participant doc IS written
      mockNow += 5 * 60 * 1000;
      const durationUpdated = [
        { ...baseParticipants[0], durationMs: 600000, durationMin: 10 },
        baseParticipants[1],
      ];
      expect(await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', durationUpdated, 'teacher@acme.edu')).toBe(true);
      expect(ctx.read('tenants/acme.edu/meetings/class-101__r1/participants/p1').durationMin).toBe(10);
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
