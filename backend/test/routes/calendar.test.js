// Tests for GET /api/calendar-attendees — looks up the Calendar event for a
// Meet code and returns attendees + recurringEventId. Focus on the
// recurringEventId passthrough (used by Series roll-up).

const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

const mockEventsList = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    calendar: jest.fn().mockReturnValue({
      events: { list: (...a) => mockEventsList(...a) },
    }),
    auth: { OAuth2: jest.fn() },
  },
}));
jest.mock('../../src/services/googleAuth', () => ({
  makeJWT: jest.fn().mockResolvedValue({}),
  makeUserClient: jest.fn().mockReturnValue({}),
  getGoogleClient: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/services/firestore', () => ({
  persistCalendarData: jest.fn(),
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
}));

const firestore = require('../../src/services/firestore');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  firestore.getUser.mockImplementation(async (domain, email) => ({
    email, domain, refreshToken: 'rt', accessToken: 'at',
    tokenExpiresAt: new Date(Date.now() + 3600000),
  }));
  app = buildApp();
});

describe('GET /api/calendar-attendees', () => {
  test('400 when meetingCode is missing', async () => {
    const res = await request(app)
      .get('/api/calendar-attendees')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(400);
  });

  test('returns isScheduled:false when no matching event found', async () => {
    mockEventsList.mockResolvedValue({ data: { items: [] } });
    const res = await request(app)
      .get('/api/calendar-attendees?meetingCode=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.isScheduled).toBe(false);
    expect(res.body.attendees).toEqual([]);
  });

  test('returns isScheduled:true + attendees when matching event found', async () => {
    mockEventsList.mockResolvedValue({
      data: {
        items: [{
          id: 'evt-1',
          summary: 'Sprint Planning',
          start: { dateTime: '2026-06-28T10:00:00Z' },
          end: { dateTime: '2026-06-28T11:00:00Z' },
          conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] },
          attendees: [
            { email: 'alex@acme.com', displayName: 'Alex', responseStatus: 'accepted' },
            { email: 'beth@acme.com', displayName: 'Beth', responseStatus: 'declined' },
          ],
        }],
      },
    });
    const res = await request(app)
      .get('/api/calendar-attendees?meetingCode=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.isScheduled).toBe(true);
    expect(res.body.eventTitle).toBe('Sprint Planning');
    expect(res.body.attendees).toHaveLength(2);
    expect(res.body.attendees[0].status).toBe('accepted');
  });

  test('returns recurringEventId when event is part of a series (Series roll-up join key)', async () => {
    mockEventsList.mockResolvedValue({
      data: {
        items: [{
          id: 'evt-instance-1',
          recurringEventId: 'recurring-parent-id',
          summary: 'Daily Standup',
          start: { dateTime: '2026-06-28T10:00:00Z' },
          end: { dateTime: '2026-06-28T10:15:00Z' },
          conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] },
          attendees: [],
        }],
      },
    });
    const res = await request(app)
      .get('/api/calendar-attendees?meetingCode=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.recurringEventId).toBe('recurring-parent-id');
    expect(res.body.eventId).toBe('evt-instance-1');
  });

  test('returns null recurringEventId for one-off events', async () => {
    mockEventsList.mockResolvedValue({
      data: {
        items: [{
          id: 'evt-1',
          // no recurringEventId field
          summary: 'One-off',
          start: { dateTime: '2026-06-28T10:00:00Z' },
          end: { dateTime: '2026-06-28T11:00:00Z' },
          conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] },
          attendees: [],
        }],
      },
    });
    const res = await request(app)
      .get('/api/calendar-attendees?meetingCode=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.body.recurringEventId).toBeNull();
  });

  test('persistCalendarData receives the recurringEventId', async () => {
    mockEventsList.mockResolvedValue({
      data: {
        items: [{
          id: 'evt-1', recurringEventId: 'series-x',
          summary: 'Weekly',
          start: { dateTime: '2026-06-28T10:00:00Z' },
          end: { dateTime: '2026-06-28T11:00:00Z' },
          conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] },
          attendees: [],
        }],
      },
    });
    await request(app)
      .get('/api/calendar-attendees?meetingCode=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(firestore.persistCalendarData).toHaveBeenCalledWith(
      'acme.com', 'abc-defg-hij', 'Weekly', [],
      expect.objectContaining({ recurringEventId: 'series-x', eventId: 'evt-1' })
    );
  });

  test('gracefully degrades when Calendar API returns 403 (scope not granted)', async () => {
    const err = Object.assign(new Error('Insufficient Permission'), { code: 403 });
    mockEventsList.mockRejectedValue(err);
    const res = await request(app)
      .get('/api/calendar-attendees?meetingCode=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.calendarPermissionMissing).toBe(true);
    expect(res.body.attendees).toEqual([]);
  });

  test('filters out room resources from attendees', async () => {
    mockEventsList.mockResolvedValue({
      data: {
        items: [{
          id: 'evt-1', summary: 'X',
          start: { dateTime: '2026-06-28T10:00:00Z' },
          end: { dateTime: '2026-06-28T11:00:00Z' },
          conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] },
          attendees: [
            { email: 'alex@acme.com', displayName: 'Alex', responseStatus: 'accepted' },
            { email: 'room1@acme.com', displayName: 'Conference Room 1', resource: true, responseStatus: 'accepted' },
          ],
        }],
      },
    });
    const res = await request(app)
      .get('/api/calendar-attendees?meetingCode=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.body.attendees).toHaveLength(1);
    expect(res.body.attendees[0].email).toBe('alex@acme.com');
  });
});

describe('GET /api/calendar-attendees — branch coverage', () => {
  const CODE = 'abc-defg-hij';
  const vid = (code) => ({ conferenceData: { entryPoints: [{ entryPointType: 'video', uri: `https://meet.google.com/${code}` }] } });
  const get = (q) => request(app).get(`/api/calendar-attendees?meetingCode=${CODE}${q || ''}`).set(authedHeader('user@acme.com', 'acme.com'));

  test('skips all-day events and matches via hangoutLink', async () => {
    mockEventsList.mockResolvedValue({ data: { items: [
      { start: { date: '2026-06-01' }, summary: 'All day' }, // no dateTime → skipped
      { start: { dateTime: '2026-06-01T10:00:00Z' }, end: { dateTime: '2026-06-01T11:00:00Z' }, hangoutLink: `https://meet.google.com/${CODE}`, summary: 'Standup', attendees: [] },
    ] } });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.isScheduled).toBe(true);
  });

  test('picks the closest instance among multiple recurring matches', async () => {
    const now = Date.now();
    mockEventsList.mockResolvedValue({ data: { items: [
      { start: { dateTime: new Date(now - 100 * 86400000).toISOString() }, end: { dateTime: new Date(now - 100 * 86400000).toISOString() }, ...vid(CODE), summary: 'Old', attendees: [] },
      { start: { dateTime: new Date(now + 3600000).toISOString() }, end: { dateTime: new Date(now + 7200000).toISOString() }, ...vid(CODE), summary: 'Soon', attendees: [], recurringEventId: 'rid-1', id: 'ev-1', htmlLink: 'http://x' },
    ] } });
    const res = await get();
    expect(res.body.eventTitle).toBe('Soon');
    expect(res.body.recurringEventId).toBe('rid-1');
  });

  test('filters resource attendees, defaults displayName, and falls back on missing fields', async () => {
    mockEventsList.mockResolvedValue({ data: { items: [
      {
        start: { dateTime: '2026-06-01T10:00:00Z' }, end: { date: '2026-06-02' }, // end has date, not dateTime
        ...vid(CODE), // no summary, no recurringEventId/id/htmlLink
        attendees: [
          { email: 'room@acme.com', resource: true, responseStatus: 'accepted' }, // filtered
          { email: 'noname@acme.com', responseStatus: 'accepted' }, // displayName ← email split
        ],
      },
    ] } });
    const res = await get();
    expect(res.body.eventTitle).toBe('Scheduled Meeting'); // summary fallback
    expect(res.body.recurringEventId).toBeNull();
    expect(res.body.attendees).toHaveLength(1);
    expect(res.body.attendees[0].displayName).toBe('noname');
  });

  test('degrades gracefully when the calendar scope is missing (403)', async () => {
    mockEventsList.mockRejectedValue(Object.assign(new Error('Insufficient Permission'), { code: 403 }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.calendarPermissionMissing).toBe(true);
  });

  test('500 on an unexpected calendar API error', async () => {
    mockEventsList.mockRejectedValue(new Error('boom'));
    const res = await get();
    expect(res.status).toBe(500);
  });
});

describe('GET /api/calendar-attendees — residual branches', () => {
  const CODE = 'abc-defg-hij';
  const vid = () => ({ conferenceData: { entryPoints: [{ entryPointType: 'video', uri: `https://meet.google.com/${CODE}` }] } });

  test('handles a response with no items array', async () => {
    mockEventsList.mockResolvedValue({ data: {} });
    const res = await request(app).get(`/api/calendar-attendees?meetingCode=${CODE}`).set(authedHeader('u@acme.com', 'acme.com'));
    expect(res.body.isScheduled).toBe(false);
  });

  test('reduce keeps the closest when a later candidate is farther, and tolerates no attendees / no end', async () => {
    const now = Date.now();
    mockEventsList.mockResolvedValue({ data: { items: [
      { start: { dateTime: new Date(now + 3600000).toISOString() }, ...vid(), summary: 'Closest' }, // no attendees, no end
      { start: { dateTime: new Date(now + 200 * 86400000).toISOString() }, ...vid(), summary: 'Far' },
    ] } });
    const res = await request(app).get(`/api/calendar-attendees?meetingCode=${CODE}`).set(authedHeader('u@acme.com', 'acme.com'));
    expect(res.body.eventTitle).toBe('Closest');
    expect(res.body.eventEnd).toBeNull();
    expect(res.body.attendees).toEqual([]);
  });

  test('derives the persist domain from the email when the token carries no domain claim', async () => {
    const jwt = require('jsonwebtoken');
    const CONFIG = require('../../src/config');
    const token = 'Bearer ' + jwt.sign({ email: 'nodomain@acme.com' }, CONFIG.sessionSecret);
    mockEventsList.mockResolvedValue({ data: { items: [
      { start: { dateTime: '2026-06-01T10:00:00Z' }, end: { dateTime: '2026-06-01T11:00:00Z' }, ...vid(), summary: 'S', attendees: [] },
    ] } });
    const res = await request(app).get(`/api/calendar-attendees?meetingCode=${CODE}`).set('Authorization', token);
    expect(res.status).toBe(200);
    // auth middleware now sets req.user.domain = decoded.domain || domainOf(email),
    // so a domain-less token resolves to the user's real domain (not "default").
    expect(firestore.persistCalendarData).toHaveBeenCalledWith('acme.com', expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });
});
