// Integration tests for /api/team/* — the org-admin endpoints. Auth gating
// here is critical: a regression that drops the teamAdmin check would expose
// every user's meetings to anyone in the same domain.

const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

// Mock the firestore service before requiring the app.
jest.mock('../../src/services/firestore', () => ({
  getUser: jest.fn(),
  getTeamOverview: jest.fn(),
  // Auth middleware calls these even on non-team endpoints — stub them so
  // requiring the app doesn't crash on transitive deps.
  updateUserTokens: jest.fn(),
}));

const firestore = require('../../src/services/firestore');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  app = buildApp();
});

describe('GET /api/team/overview — auth gating', () => {
  test('401 without any Authorization header', async () => {
    const res = await request(app).get('/api/team/overview');
    expect(res.status).toBe(401);
  });

  test('401 with malformed Authorization header', async () => {
    const res = await request(app)
      .get('/api/team/overview')
      .set('Authorization', 'NotBearer foo');
    expect(res.status).toBe(401);
  });

  test('401 with valid Bearer but expired/invalid JWT', async () => {
    const res = await request(app)
      .get('/api/team/overview')
      .set('Authorization', 'Bearer not.a.valid.jwt');
    expect(res.status).toBe(401);
  });

  test('403 when authenticated user has no teamAdmin flag', async () => {
    firestore.getUser.mockResolvedValue({
      email: 'regular@acme.com',
      domain: 'acme.com',
      displayName: 'Regular',
      teamAdmin: false,
    });
    const res = await request(app)
      .get('/api/team/overview')
      .set(authedHeader('regular@acme.com', 'acme.com'));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/team admin/i);
    expect(firestore.getTeamOverview).not.toHaveBeenCalled();
  });

  test('403 when getUser returns null (user has been deleted)', async () => {
    firestore.getUser.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/team/overview')
      .set(authedHeader('ghost@acme.com', 'acme.com'));
    expect(res.status).toBe(403);
    expect(firestore.getTeamOverview).not.toHaveBeenCalled();
  });

  test('200 when caller is the team admin', async () => {
    firestore.getUser.mockResolvedValue({
      email: 'admin@acme.com',
      domain: 'acme.com',
      teamAdmin: true,
    });
    firestore.getTeamOverview.mockResolvedValue({
      domain: 'acme.com',
      adminEmail: 'admin@acme.com',
      totals: { users: 5, meetings: 23, series: 2, people: 14 },
      users: [], meetings: [], series: [], people: [],
    });
    const res = await request(app)
      .get('/api/team/overview')
      .set(authedHeader('admin@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.totals.users).toBe(5);
    expect(firestore.getTeamOverview).toHaveBeenCalledWith('acme.com');
  });

  test('caller cannot view another domain (always scoped to req.user.domain)', async () => {
    firestore.getUser.mockResolvedValue({
      email: 'admin@acme.com',
      domain: 'acme.com',
      teamAdmin: true,
    });
    firestore.getTeamOverview.mockResolvedValue({
      domain: 'acme.com', adminEmail: 'admin@acme.com',
      totals: { users: 0, meetings: 0, series: 0, people: 0 },
      users: [], meetings: [], series: [], people: [],
    });
    // The endpoint takes no domain query param — it derives from JWT
    await request(app)
      .get('/api/team/overview?domain=enemy.com')
      .set(authedHeader('admin@acme.com', 'acme.com'));
    expect(firestore.getTeamOverview).toHaveBeenCalledWith('acme.com');
    expect(firestore.getTeamOverview).not.toHaveBeenCalledWith('enemy.com');
  });

  test('500 when getTeamOverview throws (defensive — caller sees clean error)', async () => {
    firestore.getUser.mockResolvedValue({
      email: 'admin@acme.com', domain: 'acme.com', teamAdmin: true,
    });
    firestore.getTeamOverview.mockRejectedValue(new Error('Firestore unavailable'));
    const res = await request(app)
      .get('/api/team/overview')
      .set(authedHeader('admin@acme.com', 'acme.com'));
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });

  test('500 with body.error when getTeamOverview returns null', async () => {
    firestore.getUser.mockResolvedValue({
      email: 'admin@acme.com', domain: 'acme.com', teamAdmin: true,
    });
    firestore.getTeamOverview.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/team/overview')
      .set(authedHeader('admin@acme.com', 'acme.com'));
    expect(res.status).toBe(500);
  });

  test('Cache-Control: no-store on the response', async () => {
    firestore.getUser.mockResolvedValue({
      email: 'admin@acme.com', domain: 'acme.com', teamAdmin: true,
    });
    firestore.getTeamOverview.mockResolvedValue({
      domain: 'acme.com', adminEmail: 'admin@acme.com',
      totals: { users: 1, meetings: 0, series: 0, people: 0 },
      users: [], meetings: [], series: [], people: [],
    });
    const res = await request(app)
      .get('/api/team/overview')
      .set(authedHeader('admin@acme.com', 'acme.com'));
    expect(res.headers['cache-control']).toContain('no-store');
  });
});
