// Integration tests for /api/checkin + /api/checkins — attendee self-check-in.
// Security contract: identity comes ONLY from the authenticated session (a
// body-supplied email must be ignored), and the endpoints work for sessions
// with no Firestore user doc (attendee-mode sign-ins).

const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

jest.mock('../../src/services/firestore', () => ({
  saveCheckin: jest.fn(),
  getCheckins: jest.fn(),
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
}));

const firestore = require('../../src/services/firestore');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  // Attendee-mode sessions have NO user doc — the auth middleware tolerates
  // that (continues without an access token), and these routes must too.
  firestore.getUser.mockResolvedValue(undefined);
  firestore.saveCheckin.mockResolvedValue({ checkedInAt: '2026-09-08T10:00:00.000Z', already: false });
  firestore.getCheckins.mockResolvedValue([]);
  app = buildApp();
});

describe('POST /api/checkin', () => {
  test('401 without auth', async () => {
    const res = await request(app).post('/api/checkin').send({ meetingCode: 'abc-defg-hij' });
    expect(res.status).toBe(401);
  });

  test('400 when meetingCode is missing', async () => {
    const res = await request(app)
      .post('/api/checkin')
      .set(authedHeader('student@school.edu', 'school.edu'))
      .send({});
    expect(res.status).toBe(400);
  });

  test('records the check-in using the SESSION identity, ignoring any body email', async () => {
    const res = await request(app)
      .post('/api/checkin')
      .set(authedHeader('student@school.edu', 'school.edu'))
      .send({ meetingCode: 'abc-defg-hij', email: 'spoofed@evil.com', displayName: 'Spoofed' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checkedInAt: '2026-09-08T10:00:00.000Z', already: false });
    expect(firestore.saveCheckin).toHaveBeenCalledWith('abc-defg-hij', expect.objectContaining({
      email: 'student@school.edu',
    }));
    const args = firestore.saveCheckin.mock.calls[0][1];
    expect(args.email).not.toBe('spoofed@evil.com');
  });

  test('works for a session with no Firestore user doc (attendee mode)', async () => {
    firestore.getUser.mockResolvedValue(undefined);
    const res = await request(app)
      .post('/api/checkin')
      .set(authedHeader('outsider@gmail.com', 'gmail.com'))
      .send({ meetingCode: 'abc-defg-hij' });
    expect(res.status).toBe(200);
  });

  test('400 when the service flags a bad meeting code', async () => {
    firestore.saveCheckin.mockRejectedValue(Object.assign(new Error('Invalid meeting code'), { badInput: true }));
    const res = await request(app)
      .post('/api/checkin')
      .set(authedHeader('s@a.com', 'a.com'))
      .send({ meetingCode: '!!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid meeting code');
  });

  test('500 on an unexpected service failure', async () => {
    firestore.saveCheckin.mockRejectedValue(new Error('firestore down'));
    const res = await request(app)
      .post('/api/checkin')
      .set(authedHeader('s@a.com', 'a.com'))
      .send({ meetingCode: 'abc-defg-hij' });
    expect(res.status).toBe(500);
  });

  test('surfaces already:true for a repeat check-in', async () => {
    firestore.saveCheckin.mockResolvedValue({ checkedInAt: '2026-09-08T09:00:00.000Z', already: true });
    const res = await request(app)
      .post('/api/checkin')
      .set(authedHeader('s@a.com', 'a.com'))
      .send({ meetingCode: 'abc-defg-hij' });
    expect(res.body.already).toBe(true);
  });
});

describe('GET /api/checkins', () => {
  test('401 without auth', async () => {
    const res = await request(app).get('/api/checkins?meetingCode=abc-defg-hij');
    expect(res.status).toBe(401);
  });

  test('400 when meetingCode is missing', async () => {
    const res = await request(app)
      .get('/api/checkins')
      .set(authedHeader('host@a.com', 'a.com'));
    expect(res.status).toBe(400);
  });

  test('returns the check-ins with Cache-Control: no-store', async () => {
    firestore.getCheckins.mockResolvedValue([
      { email: 'a@x.com', displayName: 'A', checkedInAt: '2026-09-08T10:00:00.000Z' },
    ]);
    const res = await request(app)
      .get('/api/checkins?meetingCode=abc-defg-hij')
      .set(authedHeader('host@a.com', 'a.com'));
    expect(res.status).toBe(200);
    expect(res.body.checkins).toHaveLength(1);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(firestore.getCheckins).toHaveBeenCalledWith('abc-defg-hij');
  });

  test('500 on an unexpected service failure', async () => {
    firestore.getCheckins.mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .get('/api/checkins?meetingCode=abc-defg-hij')
      .set(authedHeader('host@a.com', 'a.com'));
    expect(res.status).toBe(500);
  });
});
