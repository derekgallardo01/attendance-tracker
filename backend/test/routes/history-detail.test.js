const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

jest.mock('../../src/services/firestore', () => ({
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
  getTenantPlan: jest.fn(),
  getTenantConfig: jest.fn(),
  listUserShareLinks: jest.fn(),
  getMeetingDetail: jest.fn(),
  persistAttendance: jest.fn(),
  getTrackedConferenceIds: jest.fn(),
  updateMeetingTimes: jest.fn(),
}));

jest.mock('../../src/services/meetApi', () => ({
  meetGet: jest.fn(),
  fetchConferenceParticipants: jest.fn(),
}));

jest.mock('../../src/services/googleAuth', () => ({
  refreshAccessToken: jest.fn(),
}));

const firestore = require('../../src/services/firestore');
const meetApi = require('../../src/services/meetApi');
const googleAuth = require('../../src/services/googleAuth');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  firestore.getUser.mockResolvedValue({ email: 'user@acme.com', domain: 'acme.com', refreshToken: 'rt-123' });
  firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
  firestore.getTrackedConferenceIds.mockResolvedValue(new Set());
  googleAuth.refreshAccessToken.mockResolvedValue({ access_token: 'fresh-tok', expiry_date: Date.now() + 3600000 });
  app = buildApp();
});


describe('GET /api/share/links', () => {
  test('401 without auth', async () => {
    const res = await request(app).get('/api/share/links');
    expect(res.status).toBe(401);
  });

  test('200 returns user share links', async () => {
    const mockLinks = [
      { token: 'tok1', type: 'meeting', targetTitle: 'Math 101', viewCount: 3, revoked: false },
    ];
    firestore.listUserShareLinks.mockResolvedValue(mockLinks);

    const res = await request(app)
      .get('/api/share/links')
      .set(authedHeader('user@acme.com', 'acme.com'));

    expect(res.status).toBe(200);
    expect(res.body.links).toEqual(mockLinks);
    expect(firestore.listUserShareLinks).toHaveBeenCalledWith('acme.com', 'user@acme.com');
  });

  test('500 when listUserShareLinks fails', async () => {
    firestore.listUserShareLinks.mockRejectedValue(new Error('db error'));

    const res = await request(app)
      .get('/api/share/links')
      .set(authedHeader('user@acme.com', 'acme.com'));

    expect(res.status).toBe(500);
  });
});

describe('GET /api/history/meeting/:id', () => {
  test('401 without auth', async () => {
    const res = await request(app).get('/api/history/meeting/m123');
    expect(res.status).toBe(401);
  });

  test('404 when meeting not found', async () => {
    firestore.getMeetingDetail.mockResolvedValue(null);

    const res = await request(app)
      .get('/api/history/meeting/m404')
      .set(authedHeader('user@acme.com', 'acme.com'));

    expect(res.status).toBe(404);
  });

  test('403 when user does not own meeting', async () => {
    firestore.getMeetingDetail.mockRejectedValue(new Error('forbidden'));

    const res = await request(app)
      .get('/api/history/meeting/m-not-owned')
      .set(authedHeader('user@acme.com', 'acme.com'));

    expect(res.status).toBe(403);
  });

  test('200 returns meeting details with attendees and attendance metrics', async () => {
    const mockDetail = {
      id: 'm123',
      title: 'Biology Lab',
      conferenceId: 'bio-lab',
      meetingCode: 'bio-lab',
      startTime: '2026-10-01T14:00:00.000Z',
      endTime: '2026-10-01T15:00:00.000Z',
      attendanceRate: 0.75,
      presentCount: 3,
      lateCount: 0,
      absentCount: 1,
      totalCount: 4,
      attendees: [
        { displayName: 'Alice', email: 'alice@acme.com', rsvpStatus: 'accepted', status: 'present', durationMin: 60 },
        { displayName: 'Bob', email: 'bob@acme.com', rsvpStatus: 'needsAction', status: 'absent', durationMin: 0 },
      ],
    };
    firestore.getMeetingDetail.mockResolvedValue(mockDetail);

    const res = await request(app)
      .get('/api/history/meeting/m123')
      .set(authedHeader('user@acme.com', 'acme.com'));

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Biology Lab');
    expect(res.body.attendanceRate).toBe(0.75);
    expect(typeof res.body.isPro).toBe('boolean');
  });
});


describe('GET /api/history/recent-conferences', () => {
  test('401 without auth', async () => {
    const res = await request(app).get('/api/history/recent-conferences');
    expect(res.status).toBe(401);
  });

  test('401 when no token available and refresh fails', async () => {
    firestore.getUser.mockResolvedValue({ email: 'user@acme.com', domain: 'acme.com' }); // no refreshToken

    const res = await request(app)
      .get('/api/history/recent-conferences')
      .set(authedHeader('user@acme.com', 'acme.com'));

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SCOPE_REQUIRED');
  });

  test('200 returns recent conferences from Google Meet API', async () => {
    const nowIso = new Date().toISOString();
    meetApi.meetGet.mockImplementation(async (path) => {
      if (path.startsWith('conferenceRecords?')) {
        return {
          conferenceRecords: [
            { name: 'conferenceRecords/c1', space: 'spaces/s1', startTime: nowIso, endTime: nowIso },
          ],
        };
      }
      if (path === 'spaces/s1') return { meetingCode: 'abc-defg-hij' };
      return {};
    });

    const res = await request(app)
      .get('/api/history/recent-conferences')
      .set(authedHeader('user@acme.com', 'acme.com'));

    expect(res.status).toBe(200);
    expect(res.body.conferences).toHaveLength(1);
    expect(res.body.conferences[0].meetingCode).toBe('abc-defg-hij');
    expect(res.body.conferences[0].recordName).toBe('conferenceRecords/c1');
    expect(res.body.conferences[0].alreadyImported).toBe(false);
    expect(res.body.conferences[0].tracked).toBe(false);
  });
});

describe('POST /api/history/import-conference', () => {
  test('400 when missing conferenceRecordName', async () => {
    const res = await request(app)
      .post('/api/history/import-conference')
      .set(authedHeader('user@acme.com', 'acme.com'))
      .send({});

    expect(res.status).toBe(400);
  });

  test('200 imports conference and persists attendance', async () => {
    const nowIso = new Date().toISOString();
    meetApi.meetGet.mockImplementation(async (path) => {
      if (path === 'conferenceRecords/c1') {
        return { name: 'conferenceRecords/c1', space: 'spaces/s1', startTime: nowIso, endTime: nowIso };
      }
      if (path === 'spaces/s1') return { meetingCode: 'abc-defg-hij' };
      return {};
    });
    meetApi.fetchConferenceParticipants.mockResolvedValue([
      { participantId: 'p1', displayName: 'Student 1', email: 's1@acme.com', present: true, sessions: 1 },
    ]);

    const res = await request(app)
      .post('/api/history/import-conference')
      .set(authedHeader('user@acme.com', 'acme.com'))
      .send({ conferenceRecordName: 'conferenceRecords/c1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.meetingCode).toBe('abc-defg-hij');
    expect(res.body.participantCount).toBe(1);
    expect(firestore.persistAttendance).toHaveBeenCalledWith(
      'acme.com',
      'abc-defg-hij',
      'conferenceRecords/c1',
      expect.any(Array),
      'user@acme.com'
    );
  });
});
