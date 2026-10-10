// Tests for /api/canvas/* — Canvas LMS integration routes.
// Covers: credential resolution, settings persistence, courses list, assignments,
// grade calculation and batch push to Canvas update_grades API.

const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

jest.mock('../../src/services/firestore', () => ({
  getUserSettings: jest.fn(),
  updateUserSettings: jest.fn(),
  getUser: jest.fn(),
  getTenantPlan: jest.fn(),
  getUserPlan: jest.fn(),
  isMeetingUnlocked: jest.fn(),
}));

const firestore = require('../../src/services/firestore');

let app;
const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_PRICE_ID;
  firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
  firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
  firestore.isMeetingUnlocked.mockResolvedValue(false);
  firestore.getUser.mockResolvedValue({ email: 'teacher@school.edu', domain: 'school.edu' });
  firestore.getUserSettings.mockResolvedValue({});
  firestore.updateUserSettings.mockResolvedValue({ saved: true });
  app = buildApp();
  global.fetch = jest.fn();
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('GET /api/canvas/settings', () => {
  test('401 without auth', async () => {
    const res = await request(app).get('/api/canvas/settings');
    expect(res.status).toBe(401);
  });

  test('returns unconfigured when settings empty', async () => {
    firestore.getUserSettings.mockResolvedValue({});
    const res = await request(app)
      .get('/api/canvas/settings')
      .set(authedHeader('teacher@school.edu', 'school.edu'));
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
    expect(res.body.instanceUrl).toBe('');
    expect(res.body.tokenMasked).toBe('');
  });

  test('returns masked token and instanceUrl when configured', async () => {
    firestore.getUserSettings.mockResolvedValue({
      canvasInstanceUrl: 'https://myschool.instructure.com',
      canvasToken: 'secretToken1234',
    });
    const res = await request(app)
      .get('/api/canvas/settings')
      .set(authedHeader('teacher@school.edu', 'school.edu'));
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.instanceUrl).toBe('https://myschool.instructure.com');
    expect(res.body.tokenMasked).toBe('••••1234');
    expect(JSON.stringify(res.body)).not.toContain('secretToken1234');
  });
});

describe('POST /api/canvas/settings', () => {
  test('401 without auth', async () => {
    const res = await request(app).post('/api/canvas/settings').send({ instanceUrl: 'https://canvas.edu' });
    expect(res.status).toBe(401);
  });

  test('400 on invalid URL', async () => {
    const res = await request(app)
      .post('/api/canvas/settings')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .send({ instanceUrl: 'not-a-valid-domain' });
    expect(res.status).toBe(400);
  });

  test('saves cleaned URL and token', async () => {
    const res = await request(app)
      .post('/api/canvas/settings')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .send({
        instanceUrl: 'https://myschool.instructure.com/some/path',
        token: 'newtoken9876',
      });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
    expect(res.body.instanceUrl).toBe('https://myschool.instructure.com');
    expect(res.body.tokenMasked).toBe('••••9876');
    expect(firestore.updateUserSettings).toHaveBeenCalledWith(
      'school.edu',
      'teacher@school.edu',
      expect.objectContaining({
        canvasInstanceUrl: 'https://myschool.instructure.com',
        canvasToken: 'newtoken9876',
      })
    );
  });
});

describe('GET /api/canvas/courses', () => {
  test('400 if credentials missing from headers and settings', async () => {
    firestore.getUserSettings.mockResolvedValue({});
    const res = await request(app)
      .get('/api/canvas/courses')
      .set(authedHeader('teacher@school.edu', 'school.edu'));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CANVAS_AUTH_REQUIRED');
  });

  test('lists courses using header credentials', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: 101, name: 'Physics 1', course_code: 'PHY101' },
        { id: 102, name: 'Chemistry 1', course_code: 'CHEM101' },
      ],
    });

    const res = await request(app)
      .get('/api/canvas/courses')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'tok123');

    expect(res.status).toBe(200);
    expect(res.body.courses).toHaveLength(2);
    expect(res.body.courses[0]).toEqual({ id: 101, name: 'Physics 1', courseCode: 'PHY101' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://canvas.school.edu/api/v1/courses?enrollment_type=teacher&state[]=available&per_page=100',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer tok123' }),
      })
    );
  });

  test('401 when Canvas rejects token', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => 'Invalid token',
    });

    const res = await request(app)
      .get('/api/canvas/courses')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'bad-tok');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('CANVAS_UNAUTHORIZED');
  });

  test('502 when Canvas connection throws', async () => {
    global.fetch.mockRejectedValue(new Error('Network error'));
    const res = await request(app)
      .get('/api/canvas/courses')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'tok');

    expect(res.status).toBe(502);
    expect(res.body.code).toBe('CANVAS_NETWORK_ERROR');
  });

  test('paginates courses following RFC 5988 Link header', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name) => name.toLowerCase() === 'link' ? '<https://canvas.school.edu/api/v1/courses?page=2&per_page=100>; rel="next", <https://canvas.school.edu/api/v1/courses?page=2&per_page=100>; rel="last"' : null,
        },
        json: async () => [{ id: 101, name: 'Course 1', course_code: 'C1' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: () => null,
        },
        json: async () => [{ id: 102, name: 'Course 2', course_code: 'C2' }],
      });

    const res = await request(app)
      .get('/api/canvas/courses')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'tok123');

    expect(res.status).toBe(200);
    expect(res.body.courses).toHaveLength(2);
    expect(res.body.courses[0].id).toBe(101);
    expect(res.body.courses[1].id).toBe(102);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenLastCalledWith('https://canvas.school.edu/api/v1/courses?page=2&per_page=100', expect.any(Object));
  });

  test('paginates courses with unquoted rel=next and relative URLs', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name) => name.toLowerCase() === 'link' ? '</api/v1/courses?page=2&per_page=100>; title="next"; rel=next' : null,
        },
        json: async () => [{ id: 103, name: 'Course 3', course_code: 'C3' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: () => null,
        },
        json: async () => [{ id: 104, name: 'Course 4', course_code: 'C4' }],
      });

    const res = await request(app)
      .get('/api/canvas/courses')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'tok123');

    expect(res.status).toBe(200);
    expect(res.body.courses).toHaveLength(2);
    expect(res.body.courses[0].id).toBe(103);
    expect(res.body.courses[1].id).toBe(104);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch).toHaveBeenLastCalledWith('https://canvas.school.edu/api/v1/courses?page=2&per_page=100', expect.any(Object));
  });
});

describe('GET /api/canvas/courses/:courseId/assignments', () => {
  test('returns assignment list', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { id: 201, name: 'Lecture 1 Attendance', points_possible: 100, published: true, html_url: 'https://canvas.school.edu/courses/1/assignments/201' },
      ],
    });

    const res = await request(app)
      .get('/api/canvas/courses/101/assignments')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'tok');

    expect(res.status).toBe(200);
    expect(res.body.assignments).toHaveLength(1);
    expect(res.body.assignments[0]).toEqual({
      id: 201,
      name: 'Lecture 1 Attendance',
      pointsPossible: 100,
      published: true,
      htmlUrl: 'https://canvas.school.edu/courses/1/assignments/201',
    });
  });

  test('404 when course not found in Canvas', async () => {
    global.fetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const res = await request(app)
      .get('/api/canvas/courses/999/assignments')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'tok');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('CANVAS_NOT_FOUND');
  });

  test('paginates assignments following RFC 5988 Link header', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name) => name.toLowerCase() === 'link' ? '<https://canvas.school.edu/api/v1/courses/101/assignments?page=2>; rel="next"' : null,
        },
        json: async () => [{ id: 201, name: 'Assignment 1', points_possible: 100 }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: () => null,
        },
        json: async () => [{ id: 202, name: 'Assignment 2', points_possible: 50 }],
      });

    const res = await request(app)
      .get('/api/canvas/courses/101/assignments')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'tok');

    expect(res.status).toBe(200);
    expect(res.body.assignments).toHaveLength(2);
    expect(res.body.assignments[0].id).toBe(201);
    expect(res.body.assignments[1].id).toBe(202);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('POST /api/canvas/courses/:courseId/assignments', () => {
  test('400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/canvas/courses/101/assignments')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'tok')
      .send({});
    expect(res.status).toBe(400);
  });

  test('creates assignment in Canvas', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        id: 301,
        name: 'Weekly Roll Call',
        points_possible: 50,
        html_url: 'https://canvas/courses/101/assignments/301',
      }),
    });

    const res = await request(app)
      .post('/api/canvas/courses/101/assignments')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'tok')
      .send({ name: 'Weekly Roll Call', pointsPossible: 50 });

    expect(res.status).toBe(200);
    expect(res.body.assignment.id).toBe(301);
    expect(res.body.assignment.pointsPossible).toBe(50);
  });
});

describe('POST /api/canvas/courses/:courseId/assignments/:assignmentId/sync-grades', () => {
  test('400 when records missing or empty', async () => {
    const res = await request(app)
      .post('/api/canvas/courses/101/assignments/201/sync-grades')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'tok')
      .send({ records: [] });
    expect(res.status).toBe(400);
  });

  test('matches students by email and posts batch grades', async () => {
    // 1st call: fetch assignment details
    // 2nd call: fetch enrolled students
    // 3rd call: post update_grades
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 201, points_possible: 100 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { id: 1001, name: 'Charlie Brown', email: 'charlie@school.edu', login_id: 'cbrown' },
          { id: 1002, name: 'Lucy Van Pelt', email: 'lucy@school.edu', login_id: 'lucy' },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 9999, workflow_state: 'queued' }),
      });

    const res = await request(app)
      .post('/api/canvas/courses/101/assignments/201/sync-grades')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'tok')
      .send({
        records: [
          { email: 'charlie@school.edu', status: 'present' },
          { email: 'lucy@school.edu', status: 'late' },
          { email: 'snoopy@school.edu', status: 'present' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.syncedCount).toBe(2);

    expect(global.fetch).toHaveBeenCalledTimes(3);

    // Verify batch update_grades body
    const updateCall = global.fetch.mock.calls[2];
    expect(updateCall[0]).toBe('https://canvas.school.edu/api/v1/courses/101/assignments/201/submissions/update_grades');
    const updateBody = JSON.parse(updateCall[1].body);
    expect(updateBody.grade_data['1001']).toEqual(expect.objectContaining({ posted_grade: '100' }));
    expect(updateBody.grade_data['1002']).toEqual(expect.objectContaining({ posted_grade: '80' }));

    const unmatched = res.body.results.find(r => r.email === 'snoopy@school.edu');
    expect(unmatched.status).toBe('unmatched');
  });

  test('fetches existing assignment points_possible to scale grades dynamically when maxPoints not specified', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 201, points_possible: 50 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          { id: 101, email: 'p@school.edu' },
          { id: 102, email: 'l@school.edu' },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 999 }),
      });

    const res = await request(app)
      .post('/api/canvas/courses/101/assignments/201/sync-grades')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'tok')
      .send({
        records: [
          { email: 'p@school.edu', status: 'present' },
          { email: 'l@school.edu', status: 'late' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const updateCall = global.fetch.mock.calls[2];
    const updateBody = JSON.parse(updateCall[1].body);
    expect(updateBody.grade_data['101'].posted_grade).toBe('50');
    expect(updateBody.grade_data['102'].posted_grade).toBe('40'); // 80% of 50
  });

  test('auto-creates assignment if assignmentId is __new__ with title', async () => {
    // 1st call: create assignment
    // 2nd call: fetch students
    // 3rd call: post update_grades
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 555, name: 'Created Assignment' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: 1001, name: 'Charlie', email: 'c@school.edu' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 888 }),
      });

    const res = await request(app)
      .post('/api/canvas/sync-grades')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'tok')
      .send({
        courseId: '101',
        assignmentId: '__new__',
        title: 'Created Assignment',
        records: [{ email: 'c@school.edu', status: 'present' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.assignmentId).toBe(555);
    expect(res.body.syncedCount).toBe(1);
  });

  test('handles saveToken: true by persisting to userSettings', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: 1001, email: 'c@school.edu' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 1 }),
      });

    await request(app)
      .post('/api/canvas/sync-grades')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .send({
        instanceUrl: 'https://myschool.instructure.com',
        token: 'persistedToken123',
        saveToken: true,
        courseId: '101',
        assignmentId: '201',
        records: [{ email: 'c@school.edu', points: 100 }],
      });

    expect(firestore.updateUserSettings).toHaveBeenCalledWith(
      'school.edu',
      'teacher@school.edu',
      expect.objectContaining({
        canvasInstanceUrl: 'https://myschool.instructure.com',
        canvasToken: 'persistedToken123',
      })
    );
  });

  test('400 when assignmentId is __new__ but title is missing or whitespace', async () => {
    const res = await request(app)
      .post('/api/canvas/sync-grades')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'tok')
      .send({
        courseId: '101',
        assignmentId: '__new__',
        title: '   ',
        records: [{ email: 'c@school.edu', status: 'present' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('assignmentId is required');
  });

  test('follows pagination Link headers to load full student roster (>100 students)', async () => {
    // 1st call: fetch assignment details
    // 2nd call: page 1 of students with Link header pointing to page 2
    // 3rd call: page 2 of students
    // 4th call: post update_grades
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 201, points_possible: 100 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (name) => name.toLowerCase() === 'link' ? '<https://canvas.school.edu/api/v1/courses/101/users?page=2>; rel="next"' : null,
        },
        json: async () => [{ id: 101, email: 'p1@school.edu' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => [{ id: 102, email: 'p2@school.edu' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 999 }),
      });

    const res = await request(app)
      .post('/api/canvas/courses/101/assignments/201/sync-grades')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'tok')
      .send({
        records: [
          { email: 'p1@school.edu', status: 'present' },
          { email: 'p2@school.edu', status: 'present' },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.syncedCount).toBe(2);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  test('matches students by institutional username against login_id', async () => {
    // 1st call: fetch assignment details
    // 2nd call: fetch students
    // 3rd call: post update_grades
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 201, points_possible: 100 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: 501, name: 'Student J', login_id: 'jdoe', email: 'jdoe@instructure.internal' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 999 }),
      });

    const res = await request(app)
      .post('/api/canvas/courses/101/assignments/201/sync-grades')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'https://canvas.school.edu')
      .set('x-canvas-token', 'tok')
      .send({
        // Google Meet attendee email is jdoe@gmail.com, where username 'jdoe' matches Canvas login_id
        records: [{ email: 'jdoe@gmail.com', name: 'John Doe', status: 'present' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.syncedCount).toBe(1);
    expect(res.body.results[0].canvasUserId).toBe(501);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('supports numeric strings and custom maxPoints', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ id: 701, email: 'a@school.edu' }],
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 999 }),
      });

    const res = await request(app)
      .post('/api/canvas/courses/101/assignments/201/sync-grades')
      .set(authedHeader('teacher@school.edu', 'school.edu'))
      .set('x-canvas-url', 'http://canvas-internal:8080')
      .set('x-canvas-token', 'tok')
      .send({
        maxPoints: '50',
        records: [{ email: 'a@school.edu', points: '42' }],
      });

    expect(res.status).toBe(200);
    expect(res.body.syncedCount).toBe(1);
    expect(res.body.results[0].grade).toBe(42);

    const updateCall = global.fetch.mock.calls[1];
    const updateBody = JSON.parse(updateCall[1].body);
    expect(updateBody.grade_data['701'].posted_grade).toBe('42');
  });

  describe('Canvas Pro gating (lmsSync)', () => {
    beforeEach(() => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_123';
      process.env.STRIPE_PRICE_ID = 'price_123';
      app = buildApp();
    });

    afterEach(() => {
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_PRICE_ID;
    });

    test('POST /canvas/courses/:courseId/assignments returns 402 lmsSync when user is on free tier', async () => {
      firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
      firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
      const res = await request(app)
        .post('/api/canvas/courses/101/assignments')
        .set(authedHeader('teacher@school.edu', 'school.edu'))
        .set('x-canvas-url', 'https://canvas.school.edu')
        .set('x-canvas-token', 'tok')
        .send({ name: 'Attendance Assignment' });
      expect(res.status).toBe(402);
      expect(res.body.feature).toBe('lmsSync');
      expect(res.body.error).toContain('Canvas LMS grade sync is a Pro feature');
    });

    test('POST /canvas/courses/:courseId/assignments allows Pro user through', async () => {
      firestore.getTenantPlan.mockResolvedValue({ plan: 'pro' });
      firestore.getUserPlan.mockResolvedValue({ plan: 'pro' });
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 555, name: 'Attendance Assignment', points_possible: 100 }),
      });
      const res = await request(app)
        .post('/api/canvas/courses/101/assignments')
        .set(authedHeader('teacher@school.edu', 'school.edu'))
        .set('x-canvas-url', 'https://canvas.school.edu')
        .set('x-canvas-token', 'tok')
        .send({ name: 'Attendance Assignment' });
      expect(res.status).toBe(200);
      expect(res.body.assignment.id).toBe(555);
    });

    test('POST /canvas/sync-grades returns 402 lmsSync when user is on free tier', async () => {
      firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
      firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
      const res = await request(app)
        .post('/api/canvas/courses/101/assignments/201/sync-grades')
        .set(authedHeader('teacher@school.edu', 'school.edu'))
        .set('x-canvas-url', 'https://canvas.school.edu')
        .set('x-canvas-token', 'tok')
        .send({ records: [{ email: 'a@school.edu', points: '10' }] });
      expect(res.status).toBe(402);
      expect(res.body.feature).toBe('lmsSync');
    });

    test('POST /canvas/courses/:courseId/assignments allows unlocked single-meeting pass holder through', async () => {
      firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
      firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
      firestore.isMeetingUnlocked.mockResolvedValue(true);
      global.fetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ id: 777, name: 'Single Meeting Assignment', points_possible: 100 }),
      });
      const res = await request(app)
        .post('/api/canvas/courses/101/assignments')
        .set(authedHeader('teacher@school.edu', 'school.edu'))
        .set('x-canvas-url', 'https://canvas.school.edu')
        .set('x-canvas-token', 'tok')
        .send({ name: 'Single Meeting Assignment', conferenceId: 'conf-123' });
      expect(res.status).toBe(200);
      expect(res.body.assignment.id).toBe(777);
      expect(firestore.isMeetingUnlocked).toHaveBeenCalledWith('school.edu', 'teacher@school.edu', 'conf-123');
    });

    test('POST /canvas/sync-grades allows unlocked single-meeting pass holder through', async () => {
      firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
      firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
      firestore.isMeetingUnlocked.mockResolvedValue(true);
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 201, points_possible: 100 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ id: 1001, email: 'a@school.edu' }],
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ id: 1 }),
        });

      const res = await request(app)
        .post('/api/canvas/courses/101/assignments/201/sync-grades')
        .set(authedHeader('teacher@school.edu', 'school.edu'))
        .set('x-canvas-url', 'https://canvas.school.edu')
        .set('x-canvas-token', 'tok')
        .send({
          conferenceId: 'conf-123',
          records: [{ email: 'a@school.edu', points: '10' }],
        });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});

