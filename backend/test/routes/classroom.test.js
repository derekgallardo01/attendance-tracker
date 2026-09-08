// Tests for /api/classroom/* — the roster-import routes. Focus: auth gate,
// user-token-only auth (no service-account fallback), pagination, the
// scope-missing 403 contract the frontend's re-consent flow depends on, and
// the { name, email } shaping the roster modal consumes.

const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

const mockCoursesList = jest.fn();
const mockStudentsList = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    classroom: jest.fn().mockReturnValue({
      courses: {
        list: (...a) => mockCoursesList(...a),
        students: { list: (...a) => mockStudentsList(...a) },
      },
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
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
}));

const { google } = require('googleapis');
const googleAuth = require('../../src/services/googleAuth');
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

describe('GET /api/classroom/courses', () => {
  test('401 without auth', async () => {
    const res = await request(app).get('/api/classroom/courses');
    expect(res.status).toBe(401);
    expect(mockCoursesList).not.toHaveBeenCalled();
  });

  test('uses the USER client only — never the service-account fallback', async () => {
    mockCoursesList.mockResolvedValue({ data: { courses: [] } });
    await request(app).get('/api/classroom/courses').set(authedHeader('t@school.edu', 'school.edu'));
    expect(googleAuth.makeUserClient).toHaveBeenCalledWith('at');
    expect(googleAuth.getGoogleClient).not.toHaveBeenCalled();
    expect(googleAuth.makeJWT).not.toHaveBeenCalled();
  });

  test('returns active courses shaped { id, name, section }', async () => {
    mockCoursesList.mockResolvedValue({
      data: {
        courses: [
          { id: 'c1', name: 'Biology 101', section: 'Period 2', extra: 'dropped' },
          { id: 'c2', name: 'Algebra II' },
        ],
      },
    });
    const res = await request(app).get('/api/classroom/courses').set(authedHeader('t@school.edu', 'school.edu'));
    expect(res.status).toBe(200);
    expect(res.body.courses).toEqual([
      { id: 'c1', name: 'Biology 101', section: 'Period 2' },
      { id: 'c2', name: 'Algebra II', section: '' },
    ]);
    expect(mockCoursesList).toHaveBeenCalledWith(expect.objectContaining({
      teacherId: 'me', courseStates: ['ACTIVE'],
    }));
    expect(res.headers['cache-control']).toContain('no-store');
  });

  test('follows nextPageToken across pages', async () => {
    mockCoursesList
      .mockResolvedValueOnce({ data: { courses: [{ id: 'c1', name: 'A' }], nextPageToken: 'p2' } })
      .mockResolvedValueOnce({ data: { courses: [{ id: 'c2', name: 'B' }] } });
    const res = await request(app).get('/api/classroom/courses').set(authedHeader('t@school.edu', 'school.edu'));
    expect(res.body.courses).toHaveLength(2);
    expect(mockCoursesList).toHaveBeenCalledTimes(2);
    expect(mockCoursesList.mock.calls[1][0]).toEqual(expect.objectContaining({ pageToken: 'p2' }));
  });

  test('403 from Google surfaces as scopeMissing (drives frontend re-consent)', async () => {
    mockCoursesList.mockRejectedValue(Object.assign(new Error('Insufficient Permission'), { code: 403 }));
    const res = await request(app).get('/api/classroom/courses').set(authedHeader('t@school.edu', 'school.edu'));
    expect(res.status).toBe(403);
    expect(res.body.scopeMissing).toBe(true);
  });

  test('500 on other Google errors', async () => {
    mockCoursesList.mockRejectedValue(new Error('backend exploded'));
    const res = await request(app).get('/api/classroom/courses').set(authedHeader('t@school.edu', 'school.edu'));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/classroom/courses/:courseId/students', () => {
  test('401 without auth', async () => {
    const res = await request(app).get('/api/classroom/courses/c1/students');
    expect(res.status).toBe(401);
    expect(mockStudentsList).not.toHaveBeenCalled();
  });

  test('returns students shaped { name, email } with lowercased emails', async () => {
    mockStudentsList.mockResolvedValue({
      data: {
        students: [
          { profile: { name: { fullName: 'Alice Walker' }, emailAddress: 'Alice@School.EDU' } },
          { profile: { name: { fullName: 'No Email Kid' } } },
          { profile: {} },
        ],
      },
    });
    const res = await request(app)
      .get('/api/classroom/courses/c1/students')
      .set(authedHeader('t@school.edu', 'school.edu'));
    expect(res.status).toBe(200);
    expect(res.body.students).toEqual([
      { name: 'Alice Walker', email: 'alice@school.edu' },
      { name: 'No Email Kid', email: '' },
      { name: '', email: '' },
    ]);
    expect(mockStudentsList).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'c1' }));
  });

  test('follows nextPageToken across pages', async () => {
    mockStudentsList
      .mockResolvedValueOnce({ data: { students: [{ profile: { name: { fullName: 'A' } } }], nextPageToken: 'p2' } })
      .mockResolvedValueOnce({ data: { students: [{ profile: { name: { fullName: 'B' } } }] } });
    const res = await request(app)
      .get('/api/classroom/courses/c1/students')
      .set(authedHeader('t@school.edu', 'school.edu'));
    expect(res.body.students).toHaveLength(2);
    expect(mockStudentsList).toHaveBeenCalledTimes(2);
  });

  test('403 surfaces as scopeMissing; 404 as course not found; 500 otherwise', async () => {
    mockStudentsList.mockRejectedValueOnce(Object.assign(new Error('PERMISSION_DENIED'), { code: 403 }));
    let res = await request(app).get('/api/classroom/courses/c1/students').set(authedHeader('t@school.edu', 'school.edu'));
    expect(res.status).toBe(403);
    expect(res.body.scopeMissing).toBe(true);

    mockStudentsList.mockRejectedValueOnce(Object.assign(new Error('not found'), { code: 404 }));
    res = await request(app).get('/api/classroom/courses/nope/students').set(authedHeader('t@school.edu', 'school.edu'));
    expect(res.status).toBe(404);

    mockStudentsList.mockRejectedValueOnce(new Error('boom'));
    res = await request(app).get('/api/classroom/courses/c1/students').set(authedHeader('t@school.edu', 'school.edu'));
    expect(res.status).toBe(500);
  });

  test('classroom client is constructed with the user auth client', async () => {
    const userClient = { marker: 'user' };
    googleAuth.makeUserClient.mockReturnValue(userClient);
    mockStudentsList.mockResolvedValue({ data: { students: [] } });
    await request(app).get('/api/classroom/courses/c1/students').set(authedHeader('t@school.edu', 'school.edu'));
    expect(google.classroom).toHaveBeenCalledWith({ version: 'v1', auth: userClient });
  });
});
