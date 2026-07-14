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

    await firestore.persistAttendance('acme.com', 'conf-big', 'records/conf-big', participants, 'me@acme.com');

    // Meeting doc reflects the full count...
    expect(ctx.read('tenants/acme.com/meetings/conf-big').participantCount).toBe(500);
    // ...and participants across the chunk boundary are all persisted.
    expect(ctx.read('tenants/acme.com/meetings/conf-big/participants/p0')).toBeDefined();
    expect(ctx.read('tenants/acme.com/meetings/conf-big/participants/p449')).toBeDefined();
    expect(ctx.read('tenants/acme.com/meetings/conf-big/participants/p450')).toBeDefined();
    expect(ctx.read('tenants/acme.com/meetings/conf-big/participants/p499')).toBeDefined();
  });

  test('stamps distinctAttendeeCount (deduped) alongside raw participantCount', async () => {
    // Two participant records, same person (same name, no email) + one other.
    const participants = [
      { participantId: 'p1', displayName: 'Darlene Diaz', email: '', present: true, sessions: 5 },
      { participantId: 'p2', displayName: 'Darlene Diaz', email: '', present: false, sessions: 2 },
      { participantId: 'p3', displayName: 'Sam Real', email: 'sam@acme.com', present: true, sessions: 1 },
    ];
    await firestore.persistAttendance('acme.com', 'conf-dup', 'records/conf-dup', participants, 'host@acme.com');

    const meeting = ctx.read('tenants/acme.com/meetings/conf-dup');
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

  test('swallows errors (does not throw — export flow keeps going)', async () => {
    // Empty payload — should log the error but return normally
    await expect(firestore.persistExport('acme.com', {})).resolves.toBeUndefined();
  });
});
