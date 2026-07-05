// Parameterized auth-gate coverage for every /api/admin/* endpoint.
//
// Existing admin.test.js covers a handful of super-admin endpoints with
// happy paths. This file's job is different: hit EVERY handler with a
// non-super-admin JWT (or no JWT) and assert the correct rejection status.
// Catches accidental middleware regressions — a slip that lets any signed-in
// user hit /admin/all-users would leak every tenant's email addresses.
//
// If a new /admin/* route is added, its auth gate MUST be added to one of
// the arrays below or CI will keep passing while the endpoint sits open.

const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

jest.mock('../../src/services/firestore', () => ({
  // Every service function admin.js pulls from firestore — return unhandled
  // rejections if they're ever called, since a passing test here means the
  // 403 fires BEFORE the handler runs.
  upsertTenantConfig: jest.fn(),
  getTenantConfig: jest.fn(),
  getDb: jest.fn(),
  getAllUsersAcrossTenants: jest.fn(),
  getAggregatedInsights: jest.fn(),
  setUserAcquisitionSource: jest.fn(),
  getOutreachList: jest.fn(),
  getRecentActivity: jest.fn(),
  getReachOutSuggestions: jest.fn(),
  getPowerUserPipeline: jest.fn(),
  markUserContacted: jest.fn(),
  getUserDetail: jest.fn(),
  setAdminNote: jest.fn(),
  searchAdminNotes: jest.fn(),
  appendConversation: jest.fn(),
  setOutreachStatus: jest.fn(),
  createReminder: jest.fn(),
  markReminderDone: jest.fn(),
  getDueReminders: jest.fn(),
  getEmailTemplates: jest.fn(),
  setEmailTemplates: jest.fn(),
  getAdvancedAnalytics: jest.fn(),
  getWeeklySelfReport: jest.fn(),
  evaluateSeriesAlerts: jest.fn(),
  claimDailyAlertSlot: jest.fn(),
  recordAlertsSent: jest.fn(),
  evaluateReengagementForUser: jest.fn(),
  claimReengagementSlot: jest.fn(),
  logEvent: jest.fn(),
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
}));
jest.mock('../../src/lib/notifications', () => ({
  sendAdminEmail: jest.fn(),
  sendWeeklySelfReport: jest.fn(),
  sendSeriesAlertEmail: jest.fn(),
  sendReactivationEmail: jest.fn(),
  sendForgottenMeetingEmail: jest.fn(),
}));

const firestore = require('../../src/services/firestore');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  firestore.getUser.mockImplementation(async (domain, email) => ({ email, domain }));
  app = buildApp();
});

// ── Every super-admin-gated endpoint. Adding a new one? Add it here. ──
const SUPER_ADMIN_ONLY = [
  { method: 'get', path: '/api/admin/all-users' },
  { method: 'get', path: '/api/admin/activity' },
  { method: 'get', path: '/api/admin/suggestions' },
  { method: 'get', path: '/api/admin/power-users' },
  { method: 'post', path: '/api/admin/contacted', body: { email: 'x@y.com', domain: 'y.com' } },
  { method: 'get', path: '/api/admin/weekly-report' },
  { method: 'post', path: '/api/admin/weekly-report', body: {} },
  { method: 'get', path: '/api/admin/analytics' },
  { method: 'get', path: '/api/admin/user?email=x@y.com&domain=y.com' },
  { method: 'put', path: '/api/admin/note', body: { email: 'x@y.com', domain: 'y.com', body: 'note' } },
  { method: 'get', path: '/api/admin/notes/search?q=foo' },
  { method: 'post', path: '/api/admin/send-email', body: { to: 'x@y.com', domain: 'y.com', subject: 's', body: 'b' } },
  { method: 'put', path: '/api/admin/outreach/status', body: { email: 'x@y.com', domain: 'y.com', status: 'replied' } },
  { method: 'post', path: '/api/admin/outreach/log-reply', body: { email: 'x@y.com', domain: 'y.com' } },
  { method: 'get', path: '/api/admin/templates' },
  { method: 'put', path: '/api/admin/templates', body: { items: [] } },
  { method: 'post', path: '/api/admin/reminders', body: { email: 'x@y.com', domain: 'y.com', remindAt: '2026-08-01' } },
  { method: 'put', path: '/api/admin/reminders/rem-1/done', body: { domain: 'y.com' } },
  { method: 'get', path: '/api/admin/reminders/due' },
  { method: 'get', path: '/api/admin/insights' },
  { method: 'get', path: '/api/admin/outreach-list?format=json' },
];

// Dual-auth: super-admin OR scheduler secret. Neither → 403.
const DUAL_AUTH = [
  { method: 'post', path: '/api/admin/check-alerts', body: {} },
  { method: 'post', path: '/api/admin/check-reengagement', body: {} },
];

// Authed (any user) — reject 401 when no JWT at all.
const AUTHED_ANY = [
  { method: 'get', path: '/api/admin/stats' },
  { method: 'post', path: '/api/admin/source', body: { source: 'reddit' } },
];

describe('SUPER-ADMIN-ONLY endpoints reject non-super-admin JWTs', () => {
  test.each(SUPER_ADMIN_ONLY)('$method $path → 403 for regular user', async ({ method, path, body }) => {
    const req = request(app)[method](path).set(authedHeader('regular@acme.com', 'acme.com'));
    if (body) req.send(body).set('Content-Type', 'application/json');
    const res = await req;
    expect(res.status).toBe(403);
  });

  test.each(SUPER_ADMIN_ONLY)('$method $path → 401 with no JWT at all', async ({ method, path, body }) => {
    // No auth header → auth middleware sets req.user = null → super-admin check
    // reads req.user?.email as undefined → not equal to SUPER_ADMIN_EMAIL → 403.
    // We assert 401 OR 403 to permit either mode; both are non-2xx.
    const req = request(app)[method](path);
    if (body) req.send(body).set('Content-Type', 'application/json');
    const res = await req;
    expect([401, 403]).toContain(res.status);
  });
});

describe('DUAL-AUTH endpoints reject when NEITHER super-admin NOR scheduler secret', () => {
  test.each(DUAL_AUTH)('$method $path → 403 for regular user (no scheduler secret)', async ({ method, path, body }) => {
    const req = request(app)[method](path).set(authedHeader('regular@acme.com', 'acme.com'));
    if (body) req.send(body).set('Content-Type', 'application/json');
    const res = await req;
    expect(res.status).toBe(403);
  });

  test.each(DUAL_AUTH)('$method $path → 403 with a WRONG scheduler secret', async ({ method, path, body }) => {
    const req = request(app)[method](path).set('x-scheduler-secret', 'not-the-real-secret');
    if (body) req.send(body).set('Content-Type', 'application/json');
    const res = await req;
    expect(res.status).toBe(403);
  });
});

describe('AUTHED-ANY endpoints reject when no JWT is present', () => {
  test.each(AUTHED_ANY)('$method $path → 401 without Authorization header', async ({ method, path, body }) => {
    const req = request(app)[method](path);
    if (body) req.send(body).set('Content-Type', 'application/json');
    const res = await req;
    expect(res.status).toBe(401);
  });
});

describe('Handler never runs when auth is rejected (guards against future middleware slips)', () => {
  test('403 on /admin/all-users does NOT call getAllUsersAcrossTenants', async () => {
    await request(app)
      .get('/api/admin/all-users')
      .set(authedHeader('regular@acme.com', 'acme.com'));
    expect(firestore.getAllUsersAcrossTenants).not.toHaveBeenCalled();
  });

  test('403 on /admin/send-email does NOT actually send an email', async () => {
    const notifications = require('../../src/lib/notifications');
    await request(app)
      .post('/api/admin/send-email')
      .set(authedHeader('regular@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send({ to: 'target@x.com', domain: 'x.com', subject: 'evil', body: 'evil' });
    expect(notifications.sendAdminEmail).not.toHaveBeenCalled();
  });

  test('403 on PUT /admin/note does NOT persist the note', async () => {
    await request(app)
      .put('/api/admin/note')
      .set(authedHeader('regular@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send({ email: 'x@y.com', domain: 'y.com', body: '<script>alert(1)</script>' });
    expect(firestore.setAdminNote).not.toHaveBeenCalled();
  });
});
