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
  isMeetingUnlocked: jest.fn().mockResolvedValue(false),
  countUserMonthlyExports: jest.fn().mockResolvedValue(0),
  persistExport: jest.fn().mockResolvedValue({ created: true, reexportCount: 0 }),
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
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.STRIPE_PRICE_ID = 'price_x';
  firestore.getUser.mockResolvedValue({ email: 'user@acme.com', domain: 'acme.com', refreshToken: 'rt-123' });
  firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
  firestore.getTrackedConferenceIds.mockResolvedValue(new Set());
  firestore.isMeetingUnlocked.mockResolvedValue(false);
  firestore.countUserMonthlyExports.mockResolvedValue(0);
  googleAuth.refreshAccessToken.mockResolvedValue({ access_token: 'fresh-tok', expiry_date: Date.now() + 3600000 });
  app = buildApp();
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_ID;
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

  test('caps attendees at 25 for free user when > 25 unless meeting is unlocked', async () => {
    firestore.getUser.mockResolvedValue({ email: 'user@cap1.com', domain: 'cap1.com', refreshToken: 'rt-123' });
    const attendees30 = Array.from({ length: 30 }, (_, i) => ({
      displayName: `Student ${i + 1}`,
      email: `s${i + 1}@cap1.com`,
      status: 'present',
      durationMin: 50,
    }));
    firestore.getMeetingDetail.mockResolvedValue({
      id: 'm-large',
      title: 'Large Lecture',
      conferenceId: 'conf-large',
      attendees: attendees30,
    });

    const cappedRes = await request(app)
      .get('/api/history/meeting/m-large')
      .set(authedHeader('user@cap1.com', 'cap1.com'));
    expect(cappedRes.status).toBe(200);
    expect(cappedRes.body.attendees).toHaveLength(25);
    expect(cappedRes.body.attendeesCapped).toBe(true);
    expect(cappedRes.body.totalAttendeeCount).toBe(30);

    firestore.isMeetingUnlocked.mockResolvedValue(true);
    const unlockedRes = await request(app)
      .get('/api/history/meeting/m-large')
      .set(authedHeader('user@cap1.com', 'cap1.com'));
    expect(unlockedRes.status).toBe(200);
    expect(unlockedRes.body.attendees).toHaveLength(30);
    expect(unlockedRes.body.attendeesCapped).toBe(false);
    expect(unlockedRes.body.meetingUnlocked).toBe(true);
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
    expect(firestore.persistExport).toHaveBeenCalledWith(
      'acme.com',
      expect.objectContaining({
        email: 'user@acme.com',
        conferenceId: 'abc-defg-hij',
        participantCount: 1,
        exportType: 'import',
      })
    );
  });

  test('402 exportQuota when free user has exhausted monthly exports', async () => {
    firestore.getUser.mockResolvedValue({ email: 'user@quota1.com', domain: 'quota1.com', refreshToken: 'rt-123' });
    firestore.countUserMonthlyExports.mockResolvedValue(2);
    const res = await request(app)
      .post('/api/history/import-conference')
      .set(authedHeader('user@quota1.com', 'quota1.com'))
      .send({ conferenceRecordName: 'conferenceRecords/c1' });
    expect(res.status).toBe(402);
    expect(res.body.feature).toBe('exportQuota');
  });

  test('402 largeClass when free user imports conference with > 25 participants', async () => {
    firestore.getUser.mockResolvedValue({ email: 'user@large1.com', domain: 'large1.com', refreshToken: 'rt-123' });
    const nowIso = new Date().toISOString();
    meetApi.meetGet.mockResolvedValue({ name: 'conferenceRecords/c-big', space: 'spaces/s1', startTime: nowIso, endTime: nowIso });
    const parts26 = Array.from({ length: 26 }, (_, i) => ({
      participantId: `p${i}`, displayName: `Student ${i}`, email: `s${i}@large1.com`, present: true, sessions: 1,
    }));
    meetApi.fetchConferenceParticipants.mockResolvedValue(parts26);

    const res = await request(app)
      .post('/api/history/import-conference')
      .set(authedHeader('user@large1.com', 'large1.com'))
      .send({ conferenceRecordName: 'conferenceRecords/c-big' });
    expect(res.status).toBe(402);
    expect(res.body.feature).toBe('largeClass');
    expect(res.body.participantCount).toBe(26);
    expect(firestore.persistAttendance).not.toHaveBeenCalled();
  });
});
