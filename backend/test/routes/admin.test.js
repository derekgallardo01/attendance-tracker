// Integration tests for /api/admin/* — super-admin gate + scheduler secret
// + the two cron sweep endpoints (alerts + re-engagement). Auth gating is
// the highest-risk surface: a regression that bypasses the super-admin
// check would expose every tenant's data + every user's email.

const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

jest.mock('../../src/services/firestore', () => ({
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
  // For auth middleware
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
const notifications = require('../../src/lib/notifications');

const SUPER_ADMIN = 'derekgallardo01@gmail.com';
const SCHEDULER_SECRET = 'test-scheduler-secret-xyz';

let app;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SCHEDULER_SECRET = SCHEDULER_SECRET;
  // Auth middleware needs a user doc to attach
  firestore.getUser.mockImplementation(async (domain, email) => ({
    email, domain,
  }));
  app = buildApp();
});

afterEach(() => {
  delete process.env.SCHEDULER_SECRET;
});

describe('Super-admin gated endpoints', () => {
  test('403 when caller is not the super-admin (regular user)', async () => {
    const res = await request(app)
      .get('/api/admin/all-users')
      .set(authedHeader('random@acme.com', 'acme.com'));
    expect(res.status).toBe(403);
    expect(firestore.getAllUsersAcrossTenants).not.toHaveBeenCalled();
  });

  test('200 when caller IS the super-admin', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'a@x.com', domain: 'x.com' },
    ]);
    const res = await request(app)
      .get('/api/admin/all-users')
      .set(authedHeader(SUPER_ADMIN, 'gmail.com'));
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(1);
    expect(res.body.totalCount).toBe(1);
  });

  test('403 for /admin/suggestions when not super-admin', async () => {
    const res = await request(app)
      .get('/api/admin/suggestions')
      .set(authedHeader('random@acme.com', 'acme.com'));
    expect(res.status).toBe(403);
  });

  test('403 for /admin/power-users when not super-admin', async () => {
    const res = await request(app)
      .get('/api/admin/power-users')
      .set(authedHeader('random@acme.com', 'acme.com'));
    expect(res.status).toBe(403);
  });

  test('403 for /admin/analytics when not super-admin', async () => {
    const res = await request(app)
      .get('/api/admin/analytics')
      .set(authedHeader('random@acme.com', 'acme.com'));
    expect(res.status).toBe(403);
  });

  test('403 for /admin/outreach-list when not super-admin', async () => {
    const res = await request(app)
      .get('/api/admin/outreach-list?days=30&format=json')
      .set(authedHeader('random@acme.com', 'acme.com'));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/check-alerts — dual auth (super-admin OR scheduler secret)', () => {
  test('403 with no auth at all', async () => {
    const res = await request(app)
      .post('/api/admin/check-alerts')
      .send({});
    expect(res.status).toBe(403);
    expect(firestore.getAllUsersAcrossTenants).not.toHaveBeenCalled();
  });

  test('403 with a regular user JWT (no scheduler secret)', async () => {
    const res = await request(app)
      .post('/api/admin/check-alerts')
      .set(authedHeader('random@acme.com', 'acme.com'))
      .send({});
    expect(res.status).toBe(403);
  });

  test('403 with a wrong scheduler secret', async () => {
    const res = await request(app)
      .post('/api/admin/check-alerts')
      .set('x-scheduler-secret', 'wrong-secret')
      .send({});
    expect(res.status).toBe(403);
  });

  test('200 with valid scheduler secret (no Bearer token needed)', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([]);
    const res = await request(app)
      .post('/api/admin/check-alerts')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.usersChecked).toBe(0);
  });

  test('200 with super-admin JWT (no scheduler secret needed)', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([]);
    const res = await request(app)
      .post('/api/admin/check-alerts')
      .set(authedHeader(SUPER_ADMIN, 'gmail.com'))
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(200);
  });

  test('fires alert email for users with triggered rules + claims daily slot', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'admin@acme.com', domain: 'acme.com', displayName: 'Admin' },
    ]);
    firestore.claimDailyAlertSlot.mockResolvedValue({ claimed: true, ref: {} });
    firestore.evaluateSeriesAlerts.mockResolvedValue([
      { type: 'streak', personName: 'Alex', detail: 'missed the last 3', attended: 5, instanceCount: 10 },
    ]);
    notifications.sendSeriesAlertEmail.mockResolvedValue({ sent: true });
    firestore.recordAlertsSent.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/admin/check-alerts')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.usersAlerted).toBe(1);
    expect(res.body.totalAlerts).toBe(1);
    expect(notifications.sendSeriesAlertEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'admin@acme.com', alerts: expect.any(Array),
    }));
  });

  test('skips users whose slot was already claimed today (dedup)', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'admin@acme.com', domain: 'acme.com', displayName: 'Admin' },
    ]);
    firestore.claimDailyAlertSlot.mockResolvedValue({ claimed: false });

    const res = await request(app)
      .post('/api/admin/check-alerts')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.usersSkipped).toBe(1);
    expect(notifications.sendSeriesAlertEmail).not.toHaveBeenCalled();
  });

  test('does not send email when evaluateSeriesAlerts returns empty array', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'admin@acme.com', domain: 'acme.com' },
    ]);
    firestore.claimDailyAlertSlot.mockResolvedValue({ claimed: true, ref: {} });
    firestore.evaluateSeriesAlerts.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/admin/check-alerts')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.totalAlerts).toBe(0);
    expect(notifications.sendSeriesAlertEmail).not.toHaveBeenCalled();
  });

  test('continues processing users when one throws (resilient)', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'a@x.com', domain: 'x.com' },
      { email: 'b@y.com', domain: 'y.com' },
    ]);
    firestore.claimDailyAlertSlot
      .mockResolvedValueOnce({ claimed: true, ref: {} })
      .mockResolvedValueOnce({ claimed: true, ref: {} });
    firestore.evaluateSeriesAlerts
      .mockRejectedValueOnce(new Error('boom for user a'))
      .mockResolvedValueOnce([]);

    const res = await request(app)
      .post('/api/admin/check-alerts')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.usersChecked).toBe(2);
    expect(res.body.errors).toHaveLength(1);
  });
});

describe('POST /api/admin/check-reengagement', () => {
  test('403 with no auth', async () => {
    const res = await request(app)
      .post('/api/admin/check-reengagement')
      .send({});
    expect(res.status).toBe(403);
  });

  test('200 with valid scheduler secret', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([]);
    const res = await request(app)
      .post('/api/admin/check-reengagement')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.totalSent).toBe(0);
  });

  test('fires reactivation_7d email when window matches', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'lapsed@acme.com', domain: 'acme.com', displayName: 'Lapsed' },
    ]);
    firestore.evaluateReengagementForUser.mockResolvedValue([
      { type: 'reactivation_7d', daysSinceLogin: 10 },
    ]);
    firestore.claimReengagementSlot.mockResolvedValue({ claimed: true, ref: {} });

    await request(app)
      .post('/api/admin/check-reengagement')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(notifications.sendReactivationEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'lapsed@acme.com', variant: '7d',
    }));
    expect(notifications.sendForgottenMeetingEmail).not.toHaveBeenCalled();
  });

  test('fires forgotten_meeting email with the right series context', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'user@acme.com', domain: 'acme.com', displayName: 'User' },
    ]);
    firestore.evaluateReengagementForUser.mockResolvedValue([
      { type: 'forgotten_meeting', recurringEventId: 'series-x', seriesTitle: 'Standup', trackedInWindow: 5, daysSinceLast: 8 },
    ]);
    firestore.claimReengagementSlot.mockResolvedValue({ claimed: true, ref: {} });

    await request(app)
      .post('/api/admin/check-reengagement')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(notifications.sendForgottenMeetingEmail).toHaveBeenCalledWith(expect.objectContaining({
      seriesTitle: 'Standup', recurringEventId: 'series-x',
    }));
  });

  test('uses dedupKey containing recurringEventId for forgotten-meeting claims', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'user@acme.com', domain: 'acme.com' },
    ]);
    firestore.evaluateReengagementForUser.mockResolvedValue([
      { type: 'forgotten_meeting', recurringEventId: 'series-x', seriesTitle: 'X', trackedInWindow: 5, daysSinceLast: 8 },
    ]);
    firestore.claimReengagementSlot.mockResolvedValue({ claimed: true, ref: {} });

    await request(app)
      .post('/api/admin/check-reengagement')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(firestore.claimReengagementSlot).toHaveBeenCalledWith(
      'acme.com', 'user@acme.com', 'forgotten_meeting:series-x'
    );
  });
});

describe('POST /api/admin/install — marketplace webhook (unauthenticated)', () => {
  test('400 when domain is missing', async () => {
    const res = await request(app)
      .post('/api/admin/install')
      .set('Content-Type', 'application/json')
      .send({ adminEmail: 'admin@acme.com' });
    expect(res.status).toBe(400);
  });

  test('200 and persists tenant config', async () => {
    firestore.upsertTenantConfig.mockResolvedValue(undefined);
    const res = await request(app)
      .post('/api/admin/install')
      .set('Content-Type', 'application/json')
      .send({ domain: 'newco.com', adminEmail: 'admin@newco.com' });
    expect(res.status).toBe(200);
    expect(firestore.upsertTenantConfig).toHaveBeenCalledWith('newco.com', expect.objectContaining({
      adminEmail: 'admin@newco.com',
      active: true,
    }));
  });
});
