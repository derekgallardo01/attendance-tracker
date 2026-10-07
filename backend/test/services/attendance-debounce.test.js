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

  test('checkpoint interval triggers write even if roster is unchanged', async () => {
    const originalDateNow = Date.now;
    let mockNow = 1000000;
    Date.now = () => mockNow;

    try {
      await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu');

      // 1 minute later: still debounced
      mockNow += 60 * 1000;
      expect(await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu')).toBe(false);

      // 5 minutes later (total 6 minutes since first write): checkpoint due
      mockNow += 5 * 60 * 1000;
      expect(await firestore.persistAttendance('acme.edu', 'class-101', 'conferenceRecords/r1', baseParticipants, 'teacher@acme.edu')).toBe(true);
    } finally {
      Date.now = originalDateNow;
    }
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
  });
});
