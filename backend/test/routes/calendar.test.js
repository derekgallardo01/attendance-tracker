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
