// Tests for /api/classroom/* — the roster-import routes. Focus: auth gate,
// user-token-only auth (no service-account fallback), pagination, the
// scope-missing 403 contract the frontend's re-consent flow depends on, and
// the { name, email } shaping the roster modal consumes.

const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

const mockCoursesList = jest.fn();
const mockStudentsList = jest.fn();
const mockCourseWorkList = jest.fn();
const mockCourseWorkCreate = jest.fn();
const mockSubmissionsList = jest.fn();
const mockSubmissionsPatch = jest.fn();
const mockSubmissionsReturn = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    classroom: jest.fn().mockReturnValue({
      courses: {
        list: (...a) => mockCoursesList(...a),
        students: { list: (...a) => mockStudentsList(...a) },
        courseWork: {
          list: (...a) => mockCourseWorkList(...a),
          create: (...a) => mockCourseWorkCreate(...a),
          studentSubmissions: {
            list: (...a) => mockSubmissionsList(...a),
            patch: (...a) => mockSubmissionsPatch(...a),
            return: (...a) => mockSubmissionsReturn(...a),
          },
        },
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

  test('401 AUTH_EXPIRED when the session has no access token (refresh failed / token gone)', async () => {
    // Used to be a generic 500 that never triggered the frontend re-auth flow
    // (Google answers 401 to a credential-less client, which scopeMissing()
    // doesn't match). Mirrors sheets.js's explicit contract.
    firestore.getUser.mockResolvedValue({ email: 't@school.edu', domain: 'school.edu' }); // no refreshToken
    const res = await request(app).get('/api/classroom/courses').set(authedHeader('t@school.edu', 'school.edu'));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_EXPIRED');
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

describe('GET /api/classroom/courses/:courseId/courseWork', () => {
  test('401 without auth', async () => {
    const res = await request(app).get('/api/classroom/courses/c1/courseWork');
    expect(res.status).toBe(401);
  });

  test('returns coursework list shaped { id, title, state, maxPoints }', async () => {
    mockCourseWorkList.mockResolvedValue({
      data: {
        courseWork: [
          { id: 'cw1', title: 'Lesson 1 Attendance', state: 'PUBLISHED', maxPoints: 100, alternateLink: 'https://classroom.google.com/c/1/cw/1' },
          { id: 'cw2', title: 'Lesson 2 Attendance', state: 'PUBLISHED', maxPoints: 50 },
        ],
      },
    });
    const res = await request(app).get('/api/classroom/courses/c1/courseWork').set(authedHeader('t@school.edu', 'school.edu'));
    expect(res.status).toBe(200);
    expect(res.body.courseWork).toHaveLength(2);
    expect(res.body.courseWork[0]).toEqual({
      id: 'cw1',
      title: 'Lesson 1 Attendance',
      state: 'PUBLISHED',
      maxPoints: 100,
      alternateLink: 'https://classroom.google.com/c/1/cw/1',
      creationTime: undefined,
    });
  });

  test('403 surfaces as scopeMissing', async () => {
    mockCourseWorkList.mockRejectedValue(Object.assign(new Error('insufficientPermissions'), { code: 403 }));
    const res = await request(app).get('/api/classroom/courses/c1/courseWork').set(authedHeader('t@school.edu', 'school.edu'));
    expect(res.status).toBe(403);
    expect(res.body.scopeMissing).toBe(true);
  });

  test('404 surfaces as course not found', async () => {
    mockCourseWorkList.mockRejectedValue(Object.assign(new Error('Course not found'), { code: 404 }));
    const res = await request(app).get('/api/classroom/courses/notfound/courseWork').set(authedHeader('t@school.edu', 'school.edu'));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/classroom/courses/:courseId/courseWork', () => {
  test('401 without auth', async () => {
    const res = await request(app).post('/api/classroom/courses/c1/courseWork').send({ title: 'Attendance' });
    expect(res.status).toBe(401);
  });

  test('400 when title is missing or empty', async () => {
    const res = await request(app).post('/api/classroom/courses/c1/courseWork').set(authedHeader('t@school.edu', 'school.edu')).send({});
    expect(res.status).toBe(400);
  });

  test('creates coursework with specified title and maxPoints', async () => {
    mockCourseWorkCreate.mockResolvedValue({
      data: { id: 'cw-new', title: 'Math Roll Call', maxPoints: 100 },
    });
    const res = await request(app)
      .post('/api/classroom/courses/c1/courseWork')
      .set(authedHeader('t@school.edu', 'school.edu'))
      .send({ title: 'Math Roll Call', maxPoints: 100 });
    expect(res.status).toBe(200);
    expect(res.body.courseWork.id).toBe('cw-new');
    expect(mockCourseWorkCreate).toHaveBeenCalledWith(expect.objectContaining({
      courseId: 'c1',
      requestBody: expect.objectContaining({ title: 'Math Roll Call', maxPoints: 100 }),
    }));
  });
});

describe('POST /api/classroom/courses/:courseId/courseWork/:courseWorkId/sync-grades', () => {
  test('401 without auth', async () => {
    const res = await request(app).post('/api/classroom/courses/c1/courseWork/cw1/sync-grades').send({ records: [] });
    expect(res.status).toBe(401);
  });

  test('400 when records array is empty or missing', async () => {
    const res = await request(app)
      .post('/api/classroom/courses/c1/courseWork/cw1/sync-grades')
      .set(authedHeader('t@school.edu', 'school.edu'))
      .send({ records: [] });
    expect(res.status).toBe(400);
  });

  test('matches students by email and patches grades', async () => {
    mockStudentsList.mockResolvedValue({
      data: {
        students: [
          { userId: 'u1', profile: { name: { fullName: 'Alice Walker' }, emailAddress: 'alice@school.edu' } },
          { userId: 'u2', profile: { name: { fullName: 'Bob Builder' }, emailAddress: 'bob@school.edu' } },
        ],
      },
    });
    mockSubmissionsList.mockResolvedValue({
      data: {
        studentSubmissions: [
          { id: 'sub1', userId: 'u1' },
          { id: 'sub2', userId: 'u2' },
        ],
      },
    });
    mockSubmissionsPatch.mockResolvedValue({ data: {} });

    const res = await request(app)
      .post('/api/classroom/courses/c1/courseWork/cw1/sync-grades')
      .set(authedHeader('t@school.edu', 'school.edu'))
      .send({
        records: [
          { email: 'alice@school.edu', status: 'present' },
          { email: 'bob@school.edu', status: 'late' },
          { email: 'unknown@school.edu', status: 'present' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.syncedCount).toBe(2);
    expect(mockSubmissionsPatch).toHaveBeenCalledTimes(2);

    // Alice: present -> 100 points
    expect(mockSubmissionsPatch).toHaveBeenCalledWith(expect.objectContaining({
      courseId: 'c1',
      courseWorkId: 'cw1',
      id: 'sub1',
      requestBody: { assignedGrade: 100, draftGrade: 100 },
    }));

    // Bob: late -> 80 points
    expect(mockSubmissionsPatch).toHaveBeenCalledWith(expect.objectContaining({
      courseId: 'c1',
      courseWorkId: 'cw1',
      id: 'sub2',
      requestBody: { assignedGrade: 80, draftGrade: 80 },
    }));

    // Unknown student tracked as unmatched
    const unmatched = res.body.results.find(r => r.email === 'unknown@school.edu');
    expect(unmatched.status).toBe('unmatched');
  });

  test('supports returnGrades flag', async () => {
    mockStudentsList.mockResolvedValue({
      data: {
        students: [{ userId: 'u1', profile: { emailAddress: 'alice@school.edu' } }],
      },
    });
    mockSubmissionsList.mockResolvedValue({
      data: { studentSubmissions: [{ id: 'sub1', userId: 'u1' }] },
    });
    mockSubmissionsPatch.mockResolvedValue({ data: {} });
    mockSubmissionsReturn.mockResolvedValue({ data: {} });

    const res = await request(app)
      .post('/api/classroom/courses/c1/courseWork/cw1/sync-grades')
      .set(authedHeader('t@school.edu', 'school.edu'))
      .send({
        records: [{ email: 'alice@school.edu', points: 95 }],
        returnGrades: true,
      });

    expect(res.status).toBe(200);
    expect(mockSubmissionsPatch).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sub1',
      requestBody: { assignedGrade: 95, draftGrade: 95 },
    }));
    expect(mockSubmissionsReturn).toHaveBeenCalledWith(expect.objectContaining({
      courseId: 'c1',
      courseWorkId: 'cw1',
      id: 'sub1',
    }));
  });

  test('auto-creates assignment if courseWorkId is missing but title provided', async () => {
    mockCourseWorkCreate.mockResolvedValue({ data: { id: 'cw-created' } });
    mockStudentsList.mockResolvedValue({
      data: { students: [{ userId: 'u1', profile: { emailAddress: 'a@b.com' } }] },
    });
    mockSubmissionsList.mockResolvedValue({
      data: { studentSubmissions: [{ id: 'sub-new', userId: 'u1' }] },
    });
    mockSubmissionsPatch.mockResolvedValue({ data: {} });

    const res = await request(app)
      .post('/api/classroom/sync-grades')
      .set(authedHeader('t@school.edu', 'school.edu'))
      .send({
        courseId: 'c1',
        title: 'New Grade Item',
        records: [{ email: 'a@b.com', status: 'present' }],
      });

    expect(res.status).toBe(200);
    expect(mockCourseWorkCreate).toHaveBeenCalledWith(expect.objectContaining({
      courseId: 'c1',
      requestBody: expect.objectContaining({ title: 'New Grade Item' }),
    }));
    expect(res.body.courseWorkId).toBe('cw-created');
  });

  test('400 when courseWorkId is __new__ but title is missing or whitespace', async () => {
    const res = await request(app)
      .post('/api/classroom/sync-grades')
      .set(authedHeader('t@school.edu', 'school.edu'))
      .send({
        courseId: 'c1',
        courseWorkId: '__new__',
        title: '   ',
        records: [{ email: 'a@b.com', status: 'present' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('courseWorkId is required');
  });

  test('returns success: false and message when no students match (syncedCount === 0)', async () => {
    mockStudentsList.mockResolvedValue({
      data: { students: [{ userId: 'u1', profile: { emailAddress: 'enrolled@school.edu' } }] },
    });
    mockSubmissionsList.mockResolvedValue({
      data: { studentSubmissions: [{ id: 'sub1', userId: 'u1' }] },
    });

    const res = await request(app)
      .post('/api/classroom/courses/c1/courseWork/cw1/sync-grades')
      .set(authedHeader('t@school.edu', 'school.edu'))
      .send({
        records: [{ email: 'different@school.edu', status: 'present' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.syncedCount).toBe(0);
    expect(res.body.message).toContain('No meeting attendees matched');
  });

  test('supports numeric strings and decimal ratios for points, grade, and percentage', async () => {
    mockStudentsList.mockResolvedValue({
      data: {
        students: [
          { userId: 'u1', profile: { emailAddress: 'a@school.edu' } },
          { userId: 'u2', profile: { emailAddress: 'b@school.edu' } },
          { userId: 'u3', profile: { emailAddress: 'c@school.edu' } },
        ],
      },
    });
    mockSubmissionsList.mockResolvedValue({
      data: {
        studentSubmissions: [
          { id: 'sub1', userId: 'u1' },
          { id: 'sub2', userId: 'u2' },
          { id: 'sub3', userId: 'u3' },
        ],
      },
    });
    mockSubmissionsPatch.mockResolvedValue({ data: {} });

    const res = await request(app)
      .post('/api/classroom/courses/c1/courseWork/cw1/sync-grades')
      .set(authedHeader('t@school.edu', 'school.edu'))
      .send({
        maxPoints: '50',
        records: [
          { email: 'a@school.edu', points: '45' },
          { email: 'b@school.edu', grade: '40' },
          { email: 'c@school.edu', percentage: '0.8' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.syncedCount).toBe(3);

    // sub1: 45 / 50
    expect(mockSubmissionsPatch).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sub1',
      requestBody: { assignedGrade: 45, draftGrade: 45 },
    }));
    // sub2: 40 / 50
    expect(mockSubmissionsPatch).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sub2',
      requestBody: { assignedGrade: 40, draftGrade: 40 },
    }));
    // sub3: 80% of 50 = 40
    expect(mockSubmissionsPatch).toHaveBeenCalledWith(expect.objectContaining({
      id: 'sub3',
      requestBody: { assignedGrade: 40, draftGrade: 40 },
    }));
  });

  test('handles individual patch failure with failed status', async () => {
    mockStudentsList.mockResolvedValue({
      data: { students: [{ userId: 'u1', profile: { emailAddress: 'a@school.edu' } }] },
    });
    mockSubmissionsList.mockResolvedValue({
      data: { studentSubmissions: [{ id: 'sub1', userId: 'u1' }] },
    });
    mockSubmissionsPatch.mockRejectedValue(new Error('Quota exceeded'));

    const res = await request(app)
      .post('/api/classroom/courses/c1/courseWork/cw1/sync-grades')
      .set(authedHeader('t@school.edu', 'school.edu'))
      .send({
        records: [{ email: 'a@school.edu', status: 'present' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.syncedCount).toBe(0);
    expect(res.body.success).toBe(false);
    expect(res.body.results[0].status).toBe('failed');
    expect(res.body.results[0].error).toBe('Quota exceeded');
  });
});

