// Tests for GET /api/attendance — the live attendance fetch. Most of the
// logic is in calls to the Meet REST API; we mock those entirely. Focus is on:
//   - input validation (conferenceId required)
//   - the conferenceStartTime/EndTime passthrough (used by meeting-ended UI)
//   - delegationConfigured flag (used by setup banner)
//   - empty-state response shape

const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

const mockMeetGet = jest.fn();
const mockMeetGetAll = jest.fn();

jest.mock('../../src/services/meetApi', () => ({
  meetGet: (...a) => mockMeetGet(...a),
  meetGetAll: (...a) => mockMeetGetAll(...a),
}));
jest.mock('../../src/services/googleAuth', () => ({
  getMeetToken: jest.fn().mockResolvedValue('sa-token'),
  makeJWT: jest.fn().mockResolvedValue({}),
  loadServiceAccountKey: jest.fn().mockResolvedValue({ client_email: 'sa@x.iam', private_key: 'k' }),
}));
jest.mock('../../src/services/firestore', () => ({
  persistAttendance: jest.fn(),
  getTenantConfig: jest.fn(),
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
}));
jest.mock('googleapis', () => ({
  google: {
    admin: jest.fn().mockReturnValue({
      users: { get: jest.fn().mockRejectedValue(new Error('not in directory')) },
    }),
    auth: {
      JWT: jest.fn().mockImplementation(() => ({ authorize: jest.fn().mockResolvedValue(true) })),
    },
  },
}));

const firestore = require('../../src/services/firestore');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  firestore.getUser.mockImplementation(async (domain, email) => ({
    email, domain, refreshToken: 'rt', accessToken: 'at',
    tokenExpiresAt: new Date(Date.now() + 3600000),
  }));
  firestore.getTenantConfig.mockResolvedValue(null);
  app = buildApp();
});

describe('GET /api/attendance', () => {
  test('400 when conferenceId missing', async () => {
    const res = await request(app)
      .get('/api/attendance')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(400);
  });

  test('401 without auth', async () => {
    const res = await request(app).get('/api/attendance?conferenceId=abc-defg-hij');
    expect(res.status).toBe(401);
  });

  test('returns empty participants + message when no conferenceRecord exists yet', async () => {
    mockMeetGet.mockResolvedValue({ conferenceRecords: [] });
    const res = await request(app)
      .get('/api/attendance?conferenceId=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.participants).toEqual([]);
    expect(res.body.message).toMatch(/may still be live/i);
  });

  test('returns conferenceStartTime + conferenceEndTime from the record (meeting-ended UI uses these)', async () => {
    const startTime = '2026-06-28T10:00:00Z';
    const endTime = '2026-06-28T10:30:00Z';
    mockMeetGet.mockResolvedValue({
      conferenceRecords: [{
        name: 'conferenceRecords/abc',
        startTime,
        endTime,
      }],
    });
    mockMeetGetAll
      .mockResolvedValueOnce([]) // participants
      .mockResolvedValue([]);
    const res = await request(app)
      .get('/api/attendance?conferenceId=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.conferenceStartTime).toBe(startTime);
    expect(res.body.conferenceEndTime).toBe(endTime);
  });

  test('delegationConfigured:false when no service account configured for tenant', async () => {
    mockMeetGet.mockResolvedValue({
      conferenceRecords: [{ name: 'conferenceRecords/abc', startTime: 'x', endTime: 'y' }],
    });
    mockMeetGetAll.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/attendance?conferenceId=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.body.delegationConfigured).toBe(false);
  });

  test('Meet API failure on the conference-record lookup degrades to empty (not 500)', async () => {
    // Both filter attempts fail — endpoint logs warnings and returns the
    // "may still be live" empty state rather than surfacing the error.
    mockMeetGet.mockRejectedValue(new Error('Meet API down'));
    const res = await request(app)
      .get('/api/attendance?conferenceId=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.participants).toEqual([]);
    expect(res.body.message).toMatch(/may still be live/i);
  });

  test('500 when participants fetch fails after conference record is found', async () => {
    mockMeetGet.mockResolvedValue({
      conferenceRecords: [{ name: 'conferenceRecords/abc', startTime: 'x', endTime: 'y' }],
    });
    mockMeetGetAll.mockRejectedValue(new Error('Participants endpoint exploded'));
    const res = await request(app)
      .get('/api/attendance?conferenceId=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(500);
  });

  test('returns participants array with extracted fields', async () => {
    mockMeetGet.mockResolvedValue({
      conferenceRecords: [{ name: 'conferenceRecords/abc', startTime: 'x', endTime: 'y' }],
    });
    mockMeetGetAll
      .mockResolvedValueOnce([
        {
          name: 'conferenceRecords/abc/participants/p1',
          user: { displayName: 'Alex', email: 'alex@acme.com' },
        },
      ])
      .mockResolvedValueOnce([
        { startTime: '2026-06-28T10:00:00Z', endTime: '2026-06-28T10:30:00Z' },
      ]);
    const res = await request(app)
      .get('/api/attendance?conferenceId=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.participants).toHaveLength(1);
    expect(res.body.participants[0].displayName).toBe('Alex');
    expect(res.body.participants[0].email).toBe('alex@acme.com');
    expect(res.body.participants[0].joinTime).toBe('2026-06-28T10:00:00.000Z');
  });
});
