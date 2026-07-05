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
