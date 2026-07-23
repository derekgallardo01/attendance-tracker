// Integration tests for /api/team/* — the org-admin endpoints. Auth gating
// here is critical: a regression that drops the teamAdmin check would expose
// every user's meetings to anyone in the same domain.

const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

// Mock the firestore service before requiring the app.
jest.mock('../../src/services/firestore', () => ({
  getUser: jest.fn(),
  getTeamOverview: jest.fn(),
  getTeamAdminStatus: jest.fn(),
  claimTeamAdmin: jest.fn(),
  transferTeamAdmin: jest.fn(),
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

describe('GET /api/team/admin-status', () => {
  test('401 without auth', async () => {
    const res = await request(app).get('/api/team/admin-status');
    expect(res.status).toBe(401);
  });

  test('200 returns the admin status payload', async () => {
    firestore.getTeamAdminStatus.mockResolvedValue({
      isTeamAdmin: false, adminEmail: 'boss@acme.com', isPersonalDomain: false, canClaim: false,
    });
    const res = await request(app).get('/api/team/admin-status').set(authedHeader('u@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ isTeamAdmin: false, adminEmail: 'boss@acme.com', canClaim: false });
    expect(firestore.getTeamAdminStatus).toHaveBeenCalledWith('acme.com', 'u@acme.com');
  });
});

describe('POST /api/team/claim-admin', () => {
  test('401 without auth', async () => {
    const res = await request(app).post('/api/team/claim-admin');
    expect(res.status).toBe(401);
  });

  test('200 when the role is vacant and gets claimed', async () => {
    firestore.claimTeamAdmin.mockResolvedValue({ claimed: true, adminEmail: 'me@acme.com' });
    const res = await request(app).post('/api/team/claim-admin').set(authedHeader('me@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, adminEmail: 'me@acme.com' });
  });

  test('409 when another admin already holds the role (no silent takeover)', async () => {
    firestore.claimTeamAdmin.mockResolvedValue({ claimed: false, reason: 'taken', adminEmail: 'boss@acme.com' });
    const res = await request(app).post('/api/team/claim-admin').set(authedHeader('me@acme.com', 'acme.com'));
    expect(res.status).toBe(409);
    expect(res.body.adminEmail).toBe('boss@acme.com');
  });

  test('403 for a personal-email domain', async () => {
    firestore.claimTeamAdmin.mockResolvedValue({ claimed: false, reason: 'personal_domain' });
    const res = await request(app).post('/api/team/claim-admin').set(authedHeader('me@gmail.com', 'gmail.com'));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/team/transfer-admin', () => {
  test('403 when caller is not the current team admin', async () => {
    firestore.getUser.mockResolvedValue({ email: 'u@acme.com', domain: 'acme.com', teamAdmin: false });
    const res = await request(app).post('/api/team/transfer-admin')
      .set(authedHeader('u@acme.com', 'acme.com')).send({ toEmail: 'new@acme.com' });
    expect(res.status).toBe(403);
    expect(firestore.transferTeamAdmin).not.toHaveBeenCalled();
  });

  test('400 when toEmail is missing', async () => {
    firestore.getUser.mockResolvedValue({ email: 'admin@acme.com', domain: 'acme.com', teamAdmin: true });
    const res = await request(app).post('/api/team/transfer-admin')
      .set(authedHeader('admin@acme.com', 'acme.com')).send({});
    expect(res.status).toBe(400);
  });

  test('200 when the current admin transfers to a valid teammate', async () => {
    firestore.getUser.mockResolvedValue({ email: 'admin@acme.com', domain: 'acme.com', teamAdmin: true });
    firestore.transferTeamAdmin.mockResolvedValue({ transferred: true, adminEmail: 'new@acme.com' });
    const res = await request(app).post('/api/team/transfer-admin')
      .set(authedHeader('admin@acme.com', 'acme.com')).send({ toEmail: 'new@acme.com' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, adminEmail: 'new@acme.com' });
    expect(firestore.transferTeamAdmin).toHaveBeenCalledWith('acme.com', 'admin@acme.com', 'new@acme.com');
  });

  test('404 when the target teammate has not signed in yet', async () => {
    firestore.getUser.mockResolvedValue({ email: 'admin@acme.com', domain: 'acme.com', teamAdmin: true });
    firestore.transferTeamAdmin.mockResolvedValue({ transferred: false, reason: 'no_target_user' });
    const res = await request(app).post('/api/team/transfer-admin')
      .set(authedHeader('admin@acme.com', 'acme.com')).send({ toEmail: 'ghost@acme.com' });
    expect(res.status).toBe(404);
  });
});

describe('requireTeamAdmin — error path', () => {
  test('500 when the admin-role check throws', async () => {
    // auth middleware calls getUser first (must succeed); the requireTeamAdmin
    // role check is the second call — make that one throw.
    firestore.getUser
      .mockResolvedValueOnce({ email: 'admin@acme.com', domain: 'acme.com' })
      .mockRejectedValue(new Error('lookup boom'));
    const res = await request(app).get('/api/team/overview').set(authedHeader('admin@acme.com', 'acme.com'));
    expect(res.status).toBe(500);
  });
});
