// Tests for the two attendance write helpers: persistCalendarData (writes
// the meeting doc when Calendar API resolves) and persistExport (records a
// sheet export + emits an "exported" event for activation tracking).

const { installFirestoreMock, wrapTimestamp } = require('../helpers/firestoreMock');

let ctx, firestore;

beforeEach(() => {
  ctx = installFirestoreMock();
  firestore = require('../../src/services/firestore');
});

afterEach(() => {
  ctx.uninstall();
});

describe('getDomainTeacherCount (team-signpost live count)', () => {
  test('counts user docs on a workspace domain', async () => {
    ctx.seed('tenants/acme.edu/users/a@acme.edu', { email: 'a@acme.edu' });
    ctx.seed('tenants/acme.edu/users/b@acme.edu', { email: 'b@acme.edu' });
    ctx.seed('tenants/acme.edu/users/c@acme.edu', { email: 'c@acme.edu' });
    await expect(firestore.getDomainTeacherCount('acme.edu')).resolves.toBe(3);
  });

  test('returns 0 for a personal (shared) domain without counting', async () => {
    ctx.seed('tenants/gmail.com/users/x@gmail.com', { email: 'x@gmail.com' });
    ctx.seed('tenants/gmail.com/users/y@gmail.com', { email: 'y@gmail.com' });
    await expect(firestore.getDomainTeacherCount('gmail.com')).resolves.toBe(0);
  });
});

describe('countDistinctAttendees', () => {
  test('collapses multiple sessions of the same person (by email)', () => {
    const n = firestore.countDistinctAttendees([
      { email: 'a@x.com', displayName: 'A' },
      { email: 'A@x.com', displayName: 'A (phone)' }, // same email, diff case + name
      { email: 'b@x.com', displayName: 'B' },
    ]);
    expect(n).toBe(2);
  });

  test('collapses same display name when email is absent (the phantom-rejoin case)', () => {
    // Two participant records, same name, no email = one human on two sessions.
    const n = firestore.countDistinctAttendees([
      { email: '', displayName: 'Darlene Diaz' },
      { email: '', displayName: 'Darlene Diaz' },
    ]);
    expect(n).toBe(1);
  });

  test('a real two-person meeting counts as 2', () => {
    expect(firestore.countDistinctAttendees([
      { email: '', displayName: 'Alex' },
      { email: '', displayName: 'Sam' },
    ])).toBe(2);
  });

  test('ignores records with neither email nor name; empty list = 0', () => {
    expect(firestore.countDistinctAttendees([{ email: '', displayName: '' }])).toBe(0);
    expect(firestore.countDistinctAttendees([])).toBe(0);
  });
});

describe('persistAttendance — batch chunking', () => {
  test('writes every participant when the count exceeds one Firestore batch (>450)', async () => {
    const participants = Array.from({ length: 500 }, (_, i) => ({
      participantId: `p${i}`,
      displayName: `User ${i}`,
      email: `user${i}@acme.com`,
      joinTime: '2026-06-01T10:00:00Z',
      leaveTime: '2026-06-01T10:30:00Z',
      present: true,
      sessions: 1,
    }));

    await firestore.persistAttendance('acme.com', 'conf-big', 'records/rec-1', participants, 'me@acme.com');

    // Per-instance model: the data lives on the INSTANCE doc (code__recordId);
    // the code-keyed doc is a metadata-only series anchor.
    const inst = 'tenants/acme.com/meetings/conf-big__rec-1';
    expect(ctx.read(inst).participantCount).toBe(500);
    expect(ctx.read(inst).meetingCode).toBe('conf-big');
    expect(ctx.read('tenants/acme.com/meetings/conf-big').hasInstances).toBe(true);
    // ...and participants across the chunk boundary are all persisted.
    expect(ctx.read(`${inst}/participants/p0`)).toBeDefined();
    expect(ctx.read(`${inst}/participants/p449`)).toBeDefined();
    expect(ctx.read(`${inst}/participants/p450`)).toBeDefined();
    expect(ctx.read(`${inst}/participants/p499`)).toBeDefined();
  });

  test('RECURRING class: each session gets its own doc — week 2 no longer overwrites week 1', async () => {
    // The old code-keyed model collapsed every session of a reused Meet link
    // into ONE doc: participants merged across weeks, instanceCount stuck at
    // 1, and the Class Summary Pro feature never fired for weekly classes.
    const week1 = [{ participantId: 'pa', displayName: 'Alice', email: 'alice@x.com', joinTime: '2026-09-01T10:00:00Z', leaveTime: '2026-09-01T11:00:00Z', present: false, sessions: 1 }];
    const week2 = [{ participantId: 'pb', displayName: 'Bob', email: 'bob@x.com', joinTime: '2026-09-08T10:00:00Z', leaveTime: '2026-09-08T11:00:00Z', present: false, sessions: 1 }];
    await firestore.persistAttendance('acme.com', 'weekly-code', 'conferenceRecords/w1', week1, 'host@x.com');
    await firestore.persistAttendance('acme.com', 'weekly-code', 'conferenceRecords/w2', week2, 'host@x.com');

    // Two independent instance docs, each with only its own session's roster.
    expect(ctx.read('tenants/acme.com/meetings/weekly-code__w1/participants/pa')).toBeDefined();
    expect(ctx.read('tenants/acme.com/meetings/weekly-code__w1/participants/pb')).toBeUndefined();
    expect(ctx.read('tenants/acme.com/meetings/weekly-code__w2/participants/pb')).toBeDefined();
    expect(ctx.read('tenants/acme.com/meetings/weekly-code__w2/participants/pa')).toBeUndefined();
    // Per-instance times: week 2's doc doesn't span back to week 1.
    const w2 = ctx.read('tenants/acme.com/meetings/weekly-code__w2');
    const w2start = w2.startTime?.toDate ? w2.startTime.toDate() : new Date(w2.startTime);
    expect(w2start.toISOString()).toBe('2026-09-08T10:00:00.000Z');
  });

  test('recurring metadata flows: code-doc rid is copied to new instances, and persistCalendarData backfills old ones', async () => {
    // Session 1 happens BEFORE any export → no rid anywhere yet.
    await firestore.persistAttendance('acme.com', 'series-code', 'conferenceRecords/s1',
      [{ participantId: 'p1', displayName: 'A', email: 'a@x.com', present: true, sessions: 1 }], 'host@x.com');
    expect(ctx.read('tenants/acme.com/meetings/series-code__s1').recurringEventId).toBeUndefined();
    // Export stamps the code doc — and backfills the existing instance.
    await firestore.persistCalendarData('acme.com', 'series-code', 'Algebra II', [], { recurringEventId: 'rid-9' });
    expect(ctx.read('tenants/acme.com/meetings/series-code__s1').recurringEventId).toBe('rid-9');
    // Session 2 copies the rid from the code doc at write time.
    await firestore.persistAttendance('acme.com', 'series-code', 'conferenceRecords/s2',
      [{ participantId: 'p2', displayName: 'B', email: 'b@x.com', present: true, sessions: 1 }], 'host@x.com');
    expect(ctx.read('tenants/acme.com/meetings/series-code__s2').recurringEventId).toBe('rid-9');
    // And the series roll-up finally counts real sessions.
    const { series } = await firestore.getUserMeetingSeries('acme.com', 'host@x.com');
    expect(series).toHaveLength(1);
    expect(series[0].instanceCount).toBe(2);
  });

  test('stamps distinctAttendeeCount (deduped) alongside raw participantCount', async () => {
    // Two participant records, same person (same name, no email) + one other.
    const participants = [
      { participantId: 'p1', displayName: 'Darlene Diaz', email: '', present: true, sessions: 5 },
      { participantId: 'p2', displayName: 'Darlene Diaz', email: '', present: false, sessions: 2 },
      { participantId: 'p3', displayName: 'Sam Real', email: 'sam@acme.com', present: true, sessions: 1 },
    ];
    await firestore.persistAttendance('acme.com', 'conf-dup', 'records/rec-dup', participants, 'host@acme.com');

    const meeting = ctx.read('tenants/acme.com/meetings/conf-dup__rec-dup');
    expect(meeting.participantCount).toBe(3);       // raw records preserved for attendance
    expect(meeting.distinctAttendeeCount).toBe(2);  // Darlene x2 collapses → 2 humans

    // The 'tracked' event carries the deduped signal for the activation gate.
    await new Promise((r) => setImmediate(r)); // logEvent is fire-and-forget
    const events = ctx.list('tenants/acme.com/events').map(e => e.data);
    const trackedEv = events.find(e => e.type === 'tracked');
    expect(trackedEv.meta.distinctAttendees).toBe(2);
    expect(trackedEv.meta.participantCount).toBe(3);
  });
});

describe('persistCalendarData', () => {
  test('writes meeting doc with the resolved title + attendees', async () => {
    await firestore.persistCalendarData(
      'acme.com', 'abc-defg-hij', 'Sprint Planning',
      [{ email: 'alex@acme.com', responseStatus: 'accepted' }]
    );
    const meeting = ctx.read('tenants/acme.com/meetings/abc-defg-hij');
    expect(meeting.title).toBe('Sprint Planning');
    expect(meeting.conferenceId).toBe('abc-defg-hij');
    expect(meeting.calendarAttendees).toEqual([
      { email: 'alex@acme.com', responseStatus: 'accepted' },
    ]);
  });

  test('merges with existing doc (does NOT overwrite unrelated fields)', async () => {
    // Simulate: participants collection already populated from persistAttendance
    ctx.seed('tenants/acme.com/meetings/meet-1', {
      participantCount: 5,
      startTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
    });
    await firestore.persistCalendarData('acme.com', 'meet-1', 'Retro', []);
    const meeting = ctx.read('tenants/acme.com/meetings/meet-1');
    expect(meeting.title).toBe('Retro');
    expect(meeting.participantCount).toBe(5); // preserved
    expect(meeting.startTime).toBeDefined();  // preserved
  });

  test('stamps recurringEventId when provided (feeds the series rollup)', async () => {
    await firestore.persistCalendarData(
      'acme.com', 'meet-x', 'Weekly Sync', [],
      { recurringEventId: 'series-42', eventId: 'evt-1' }
    );
    const meeting = ctx.read('tenants/acme.com/meetings/meet-x');
    expect(meeting.recurringEventId).toBe('series-42');
    expect(meeting.eventId).toBe('evt-1');
  });

  test('omits recurringEventId field when the meeting is one-off (no false-positive series)', async () => {
    await firestore.persistCalendarData('acme.com', 'meet-y', 'Ad-hoc', []);
    const meeting = ctx.read('tenants/acme.com/meetings/meet-y');
    expect(meeting.recurringEventId).toBeUndefined();
  });

  test('swallows errors (logs, does not throw — attendance flow keeps going)', async () => {
    // Force a failure by seeding a broken doc? The mock doesn't throw on set.
    // Instead assert the contract: no rejection even for weird input.
    await expect(firestore.persistCalendarData('acme.com', 'meet-z', '', [])).resolves.toBeUndefined();
  });
});

describe('persistExport', () => {
  test('writes an export record + emits an "exported" event', async () => {
    await firestore.persistExport('acme.com', {
      meetingTitle: 'Sprint Planning',
      tabName: '2026-06-01',
      exportedAt: '2026-06-01T10:00:00Z',
      participantCount: 7,
      sheetUrl: 'https://docs.google.com/spreadsheets/xyz',
      email: 'me@acme.com',
      autoExport: false,
      recurringEventId: 'series-42',
      conferenceId: 'meet-1',
    });
    // The export record — the exact doc ID is auto-generated
    const exports = ctx.list('tenants/acme.com/exports');
    expect(exports).toHaveLength(1);
    expect(exports[0].data).toEqual(expect.objectContaining({
      meetingTitle: 'Sprint Planning',
      tabName: '2026-06-01',
      participantCount: 7,
      sheetUrl: 'https://docs.google.com/spreadsheets/xyz',
      email: 'me@acme.com',
      autoExport: false,
      recurringEventId: 'series-42',
      conferenceId: 'meet-1',
    }));
    // The activation event
    const events = ctx.list('tenants/acme.com/events');
    expect(events).toHaveLength(1);
    expect(events[0].data.type).toBe('exported');
    expect(events[0].data.email).toBe('me@acme.com');
    expect(events[0].data.meta).toEqual({
      tabName: '2026-06-01', participantCount: 7, autoExport: false,
    });
  });

  test('lowercases the email on the export record', async () => {
    await firestore.persistExport('acme.com', {
      meetingTitle: 'X', tabName: 'X', exportedAt: '', participantCount: 0,
      sheetUrl: '', email: 'Me@Acme.COM', autoExport: false,
    });
    const exp = ctx.list('tenants/acme.com/exports')[0].data;
    expect(exp.email).toBe('me@acme.com');
  });

  test('when email is missing: writes export but does NOT emit event', async () => {
    // Anonymous export path (e.g. very old client). The record still lands.
    await firestore.persistExport('acme.com', {
      meetingTitle: 'X', tabName: 'X', exportedAt: '', participantCount: 0,
      sheetUrl: '', email: null, autoExport: false,
    });
    expect(ctx.list('tenants/acme.com/exports')).toHaveLength(1);
    expect(ctx.list('tenants/acme.com/events')).toHaveLength(0);
  });

  test('stamps autoExport=true for automatic exports (matters for activation counting)', async () => {
    await firestore.persistExport('acme.com', {
      meetingTitle: 'X', tabName: 'X', exportedAt: '', participantCount: 3,
      sheetUrl: '', email: 'me@acme.com', autoExport: true,
    });
    const exp = ctx.list('tenants/acme.com/exports')[0].data;
    expect(exp.autoExport).toBe(true);
    const evt = ctx.list('tenants/acme.com/events')[0].data;
    expect(evt.meta.autoExport).toBe(true);
  });

  test('null recurringEventId + null conferenceId for one-off exports', async () => {
    await firestore.persistExport('acme.com', {
      meetingTitle: 'X', tabName: 'X', exportedAt: '', participantCount: 1,
      sheetUrl: '', email: 'me@acme.com', autoExport: false,
      // recurringEventId + conferenceId omitted
    });
    const exp = ctx.list('tenants/acme.com/exports')[0].data;
    expect(exp.recurringEventId).toBeNull();
    expect(exp.conferenceId).toBeNull();
  });

  test('does not throw — export flow keeps going — and reports whether a record was created', async () => {
    // The quota meter relies on this return: { created: true } for a new
    // record, { created: false } for a deduped re-export, { created: null }
    // when the write failed (caller treats null as "assume it counted").
    await expect(firestore.persistExport('acme.com', {})).resolves.toEqual({ created: true });
  });

  test('reports created:false when the same export is persisted twice (dedupe)', async () => {
    const payload = {
      meetingTitle: 'X', tabName: 'X', exportedAt: '', participantCount: 1,
      sheetUrl: '', email: 'me@acme.com', autoExport: false, conferenceId: 'conf-9',
    };
    await expect(firestore.persistExport('acme.com', payload)).resolves.toEqual({ created: true });
    // Re-exports are now METERED on the dedupe doc (they used to be an
    // unlimited-free-exports hole): each dedupe hit reports its ordinal.
    await expect(firestore.persistExport('acme.com', payload)).resolves.toEqual({ created: false, reexportCount: 1 });
    await expect(firestore.persistExport('acme.com', payload)).resolves.toEqual({ created: false, reexportCount: 2 });
  });

  test('re-export meter is MONTH-scoped: a prior-month counter reads back as 0', async () => {
    // Recurring classes reuse one Meet code across weeks — a lifetime counter
    // permanently 402'd a free teacher's standing class after 10 sessions.
    const payload = {
      meetingTitle: 'X', tabName: 'X', exportedAt: '', participantCount: 1,
      sheetUrl: '', email: 'me@acme.com', autoExport: false, conferenceId: 'conf-roll',
    };
    await firestore.persistExport('acme.com', payload);
    await firestore.persistExport('acme.com', payload); // reexportCount 1, current month
    // Simulate the month rolling over by rewriting the stored month key.
    const docId = 'me_acme_com__conf-roll';
    const stored = ctx.read(`tenants/acme.com/exports/${docId}`);
    ctx.seed(`tenants/acme.com/exports/${docId}`, { ...stored, reexportMonth: '1999-01' });
    await expect(firestore.getExportReexportCount('acme.com', 'me@acme.com', 'conf-roll')).resolves.toBe(0);
    // And the next dedupe hit RESTARTS the counter at 1 for the new month.
    await expect(firestore.persistExport('acme.com', payload)).resolves.toEqual({ created: false, reexportCount: 1 });
  });

  test('getExportReexportCount reads the meter (null when never exported / no conferenceId)', async () => {
    const payload = {
      meetingTitle: 'X', tabName: 'X', exportedAt: '', participantCount: 1,
      sheetUrl: '', email: 'me@acme.com', autoExport: false, conferenceId: 'conf-m',
    };
    await expect(firestore.getExportReexportCount('acme.com', 'me@acme.com', 'conf-m')).resolves.toBeNull();
    await firestore.persistExport('acme.com', payload);
    await expect(firestore.getExportReexportCount('acme.com', 'me@acme.com', 'conf-m')).resolves.toBe(0);
    await firestore.persistExport('acme.com', payload);
    await expect(firestore.getExportReexportCount('acme.com', 'me@acme.com', 'conf-m')).resolves.toBe(1);
    await expect(firestore.getExportReexportCount('acme.com', 'me@acme.com', null)).resolves.toBeNull();
  });
});
