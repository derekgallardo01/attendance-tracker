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
  getActivationFunnel: jest.fn(),
  evaluateSeriesAlerts: jest.fn(),
  claimDailyAlertSlot: jest.fn(),
  recordAlertsSent: jest.fn(),
  seriesAlertKey: jest.fn((a) => `${a.type}:${a.recurringEventId}:${a.instanceCount}`),
  claimSeriesAlertCondition: jest.fn().mockResolvedValue({ claimed: true, ref: { delete: jest.fn() } }),
  evaluateReengagementForUser: jest.fn(),
  claimReengagementSlot: jest.fn(),
  logEvent: jest.fn(),
  isEmailSuppressed: jest.fn(),
  // For auth middleware
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
}));
jest.mock('../../src/lib/notifications', () => ({
  sendAdminEmail: jest.fn(),
  sendWeeklySelfReport: jest.fn(),
  sendSeriesAlertEmail: jest.fn(),
  sendReactivationEmail: jest.fn(),
  sendActivationNudgeEmail: jest.fn(),
  sendSoloNudgeEmail: jest.fn(),
  sendForgottenMeetingEmail: jest.fn(),
  flushDeferredNotifications: jest.fn(), // single flush point (signup + referral)
}));

const firestore = require('../../src/services/firestore');
const notifications = require('../../src/lib/notifications');

const SUPER_ADMIN = 'derekgallardo01@gmail.com';
const SCHEDULER_SECRET = 'test-scheduler-secret-xyz';
const MARKETPLACE_SECRET = 'test-marketplace-secret-abc';

let app;

beforeEach(() => {
  jest.clearAllMocks();
  process.env.SCHEDULER_SECRET = SCHEDULER_SECRET;
  process.env.MARKETPLACE_WEBHOOK_SECRET = MARKETPLACE_SECRET;
  // Auth middleware needs a user doc to attach
  firestore.getUser.mockImplementation(async (domain, email) => ({
    email, domain,
  }));
  // Default: nobody is suppressed (individual tests can override).
  firestore.isEmailSuppressed.mockResolvedValue(false);
  // Sends succeed by default — mirror the real send helpers which return
  // { sent: true } on success. Failure tests override with { sent: false }.
  notifications.sendSeriesAlertEmail.mockResolvedValue({ sent: true });
  notifications.sendReactivationEmail.mockResolvedValue({ sent: true });
  notifications.sendActivationNudgeEmail.mockResolvedValue({ sent: true });
  notifications.sendSoloNudgeEmail.mockResolvedValue({ sent: true });
  notifications.sendForgottenMeetingEmail.mockResolvedValue({ sent: true });
  app = buildApp();
});

afterEach(() => {
  delete process.env.SCHEDULER_SECRET;
  delete process.env.MARKETPLACE_WEBHOOK_SECRET;
  delete process.env.SWEEP_BUDGET_MS;
});

describe('POST /api/admin/source — self-reported source + deferred signup flush', () => {
  test('saves the source and flushes the deferred signup notification', async () => {
    const res = await request(app)
      .post('/api/admin/source')
      .set(authedHeader('u@acme.com', 'acme.com'))
      .send({ source: 'google_search', detail: 'found via search' });
    expect(res.status).toBe(200);
    expect(firestore.setUserAcquisitionSource).toHaveBeenCalledWith(
      'acme.com', 'u@acme.com', { source: 'google_search', detail: 'found via search' });
    expect(notifications.flushDeferredNotifications).toHaveBeenCalledWith('acme.com', 'u@acme.com');
  });

  test('rejects an invalid source and does not flush', async () => {
    const res = await request(app)
      .post('/api/admin/source')
      .set(authedHeader('u@acme.com', 'acme.com'))
      .send({ source: 'totally-made-up' });
    expect(res.status).toBe(400);
    expect(notifications.flushDeferredNotifications).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/verify-delegation — domain binding (unauthenticated endpoint)', () => {
  test('400 when adminEmail does not belong to the given domain (config-poisoning guard)', async () => {
    const res = await request(app)
      .post('/api/admin/verify-delegation')
      .set('Content-Type', 'application/json')
      .send({ domain: 'acme.com', adminEmail: 'admin@evil.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/belong to the given domain/i);
    expect(firestore.upsertTenantConfig).not.toHaveBeenCalled();
  });

  test('400 when domain or adminEmail is missing', async () => {
    const res = await request(app)
      .post('/api/admin/verify-delegation')
      .set('Content-Type', 'application/json')
      .send({ domain: 'acme.com' });
    expect(res.status).toBe(400);
  });
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

  test('Sweep-1: does not re-fire an alert whose per-condition slot is already claimed', async () => {
    // Daily slot is fresh (new day), but the specific "missed last 3" condition
    // was already alerted on a prior day — so it must be filtered out and NOT
    // re-emailed. Without per-condition dedup this ongoing condition would spam
    // the organizer every day for the life of the streak.
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'admin@acme.com', domain: 'acme.com', displayName: 'Admin' },
    ]);
    firestore.claimDailyAlertSlot.mockResolvedValue({ claimed: true, ref: {} });
    firestore.evaluateSeriesAlerts.mockResolvedValue([
      { type: 'streak', personName: 'Alex', detail: 'missed the last 3', attended: 5, instanceCount: 10 },
    ]);
    firestore.claimSeriesAlertCondition.mockResolvedValueOnce({ claimed: false }); // already sent earlier (Once: don't pollute the shared default)

    const res = await request(app)
      .post('/api/admin/check-alerts')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.usersAlerted).toBe(0);
    expect(res.body.totalAlerts).toBe(0);
    expect(notifications.sendSeriesAlertEmail).not.toHaveBeenCalled();
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

  test('skips suppressed recipients without claiming or sending (CAN-SPAM)', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'optout@acme.com', domain: 'acme.com' },
    ]);
    firestore.isEmailSuppressed.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/admin/check-alerts')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.body.usersSkipped).toBe(1);
    expect(firestore.claimDailyAlertSlot).not.toHaveBeenCalled();
    expect(notifications.sendSeriesAlertEmail).not.toHaveBeenCalled();
  });

  test('stops at the time budget and reports remaining work', async () => {
    process.env.SWEEP_BUDGET_MS = '-1'; // force immediate timeout
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'a@x.com', domain: 'x.com' },
      { email: 'b@y.com', domain: 'y.com' },
    ]);
    const res = await request(app)
      .post('/api/admin/check-alerts')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    delete process.env.SWEEP_BUDGET_MS;
    expect(res.body.timedOut).toBe(true);
    expect(res.body.remaining).toBe(2);
    expect(firestore.claimDailyAlertSlot).not.toHaveBeenCalled();
  });

  test('releases the day slot and skips recordAlertsSent when the send fails', async () => {
    const del = jest.fn().mockResolvedValue(undefined);
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'a@x.com', domain: 'x.com' },
    ]);
    firestore.claimDailyAlertSlot.mockResolvedValue({ claimed: true, ref: { delete: del } });
    firestore.evaluateSeriesAlerts.mockResolvedValue([
      { type: 'streak', personName: 'Bob', detail: 'missed the last 3', attended: 5, instanceCount: 13 },
    ]);
    notifications.sendSeriesAlertEmail.mockResolvedValue({ sent: false, error: 'Resend 500' });

    const res = await request(app)
      .post('/api/admin/check-alerts')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(del).toHaveBeenCalledTimes(1);
    expect(firestore.recordAlertsSent).not.toHaveBeenCalled();
    expect(res.body.totalAlerts).toBe(0);
    expect(res.body.usersSkipped).toBe(1);
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

  test('flushes deferred signup notifications for every user as a backstop', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'a@acme.com', domain: 'acme.com' },
      { email: 'b@acme.com', domain: 'acme.com' },
    ]);
    firestore.evaluateReengagementForUser.mockResolvedValue([]);

    const res = await request(app)
      .post('/api/admin/check-reengagement')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(200);
    expect(notifications.flushDeferredNotifications).toHaveBeenCalledWith('acme.com', 'a@acme.com');
    expect(notifications.flushDeferredNotifications).toHaveBeenCalledWith('acme.com', 'b@acme.com');
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

  test('skips suppressed recipients without claiming or sending (CAN-SPAM)', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'optout@acme.com', domain: 'acme.com' },
    ]);
    firestore.isEmailSuppressed.mockResolvedValue(true);

    const res = await request(app)
      .post('/api/admin/check-reengagement')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.body.totalSkipped).toBe(1);
    expect(firestore.evaluateReengagementForUser).not.toHaveBeenCalled();
    expect(firestore.claimReengagementSlot).not.toHaveBeenCalled();
    expect(notifications.sendReactivationEmail).not.toHaveBeenCalled();
  });

  test('routes an activation_7d reminder to the activation-nudge email', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'signup@acme.com', domain: 'acme.com', displayName: 'New' },
    ]);
    firestore.evaluateReengagementForUser.mockResolvedValue([
      { type: 'activation_7d', daysSinceLogin: 10 },
    ]);
    firestore.claimReengagementSlot.mockResolvedValue({ claimed: true, ref: {} });

    await request(app)
      .post('/api/admin/check-reengagement')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(notifications.sendActivationNudgeEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'signup@acme.com',
    }));
    expect(notifications.sendReactivationEmail).not.toHaveBeenCalled();
  });

  test('routes a solo_nudge_7d reminder to the solo-nudge email', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'solo@acme.com', domain: 'acme.com', displayName: 'Solo' },
    ]);
    firestore.evaluateReengagementForUser.mockResolvedValue([
      { type: 'solo_nudge_7d', daysSinceLogin: 9 },
    ]);
    firestore.claimReengagementSlot.mockResolvedValue({ claimed: true, ref: {} });

    await request(app)
      .post('/api/admin/check-reengagement')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(notifications.sendSoloNudgeEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'solo@acme.com',
    }));
    expect(notifications.sendReactivationEmail).not.toHaveBeenCalled();
    expect(notifications.sendActivationNudgeEmail).not.toHaveBeenCalled();
  });

  test('never emails the owner/super-admin account', async () => {
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: SUPER_ADMIN, domain: 'gmail.com' },
    ]);
    const res = await request(app)
      .post('/api/admin/check-reengagement')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.body.usersChecked).toBe(0);
    expect(firestore.evaluateReengagementForUser).not.toHaveBeenCalled();
  });

  test('stops at the time budget and reports remaining work', async () => {
    process.env.SWEEP_BUDGET_MS = '-1'; // force immediate timeout
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'a@x.com', domain: 'x.com' },
      { email: 'b@y.com', domain: 'y.com' },
      { email: 'c@z.com', domain: 'z.com' },
    ]);
    const res = await request(app)
      .post('/api/admin/check-reengagement')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    delete process.env.SWEEP_BUDGET_MS;
    expect(res.body.timedOut).toBe(true);
    expect(res.body.remaining).toBe(3);
    expect(firestore.evaluateReengagementForUser).not.toHaveBeenCalled();
  });

  test('releases the claim when the send fails so it is not lost forever', async () => {
    const del = jest.fn().mockResolvedValue(undefined);
    firestore.getAllUsersAcrossTenants.mockResolvedValue([
      { email: 'lapsed@acme.com', domain: 'acme.com' },
    ]);
    firestore.evaluateReengagementForUser.mockResolvedValue([
      { type: 'reactivation_7d', daysSinceLogin: 10 },
    ]);
    firestore.claimReengagementSlot.mockResolvedValue({ claimed: true, ref: { delete: del } });
    notifications.sendReactivationEmail.mockResolvedValue({ sent: false, error: 'Resend 500' });

    const res = await request(app)
      .post('/api/admin/check-reengagement')
      .set('x-scheduler-secret', SCHEDULER_SECRET)
      .set('Content-Type', 'application/json')
      .send({});
    expect(del).toHaveBeenCalledTimes(1);      // slot released for retry
    expect(res.body.totalSent).toBe(0);
    expect(res.body.totalSkipped).toBe(1);
    expect(firestore.logEvent).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/activation-funnel', () => {
  test('403 for a non-super-admin', async () => {
    const res = await request(app)
      .get('/api/admin/activation-funnel')
      .set(authedHeader('random@acme.com', 'acme.com'));
    expect(res.status).toBe(403);
    expect(firestore.getActivationFunnel).not.toHaveBeenCalled();
  });

  test('200 returns the funnel for the super-admin', async () => {
    firestore.getActivationFunnel.mockResolvedValue({
      totals: { signedUp: 3, tracked: 2, realMeeting: 1, exported: 1, retained: 2 },
      bySource: [{ source: 'reddit', signedUp: 2, tracked: 1, realMeeting: 0, exported: 0 }],
      generatedAt: '2026-07-14T00:00:00Z',
    });
    const res = await request(app)
      .get('/api/admin/activation-funnel')
      .set(authedHeader(SUPER_ADMIN, 'gmail.com'));
    expect(res.status).toBe(200);
    expect(res.body.totals.realMeeting).toBe(1);
    expect(res.body.bySource[0].source).toBe('reddit');
  });
});

describe('POST /api/admin/install — marketplace webhook (authenticated)', () => {
  test('403 when no secret and not super-admin (cannot pollute tenant config)', async () => {
    const res = await request(app)
      .post('/api/admin/install')
      .set('Content-Type', 'application/json')
      .send({ domain: 'evil.com', adminEmail: 'attacker@evil.com' });
    expect(res.status).toBe(403);
    expect(firestore.upsertTenantConfig).not.toHaveBeenCalled();
  });

  test('403 with a wrong secret', async () => {
    const res = await request(app)
      .post('/api/admin/install')
      .set('x-marketplace-secret', 'nope')
      .set('Content-Type', 'application/json')
      .send({ domain: 'evil.com' });
    expect(res.status).toBe(403);
    expect(firestore.upsertTenantConfig).not.toHaveBeenCalled();
  });

  test('400 when domain is missing (with valid secret)', async () => {
    const res = await request(app)
      .post('/api/admin/install')
      .set('x-marketplace-secret', MARKETPLACE_SECRET)
      .set('Content-Type', 'application/json')
      .send({ adminEmail: 'admin@acme.com' });
    expect(res.status).toBe(400);
  });

  test('200 and persists tenant config with a valid shared secret', async () => {
    firestore.upsertTenantConfig.mockResolvedValue(undefined);
    const res = await request(app)
      .post('/api/admin/install')
      .set('x-marketplace-secret', MARKETPLACE_SECRET)
      .set('Content-Type', 'application/json')
      .send({ domain: 'newco.com', adminEmail: 'admin@newco.com' });
    expect(res.status).toBe(200);
    expect(firestore.upsertTenantConfig).toHaveBeenCalledWith('newco.com', expect.objectContaining({
      adminEmail: 'admin@newco.com',
      active: true,
    }));
  });

  test('super-admin session can also trigger it (manual/testing)', async () => {
    firestore.upsertTenantConfig.mockResolvedValue(undefined);
    const res = await request(app)
      .post('/api/admin/install')
      .set(authedHeader(SUPER_ADMIN, 'gmail.com'))
      .set('Content-Type', 'application/json')
      .send({ domain: 'newco.com' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/admin/uninstall — marketplace webhook (authenticated)', () => {
  test('403 without a secret (cannot deactivate an arbitrary tenant)', async () => {
    const res = await request(app)
      .post('/api/admin/uninstall')
      .set('Content-Type', 'application/json')
      .send({ domain: 'victim.com' });
    expect(res.status).toBe(403);
    expect(firestore.upsertTenantConfig).not.toHaveBeenCalled();
  });

  test('200 deactivates the tenant with a valid secret', async () => {
    firestore.upsertTenantConfig.mockResolvedValue(undefined);
    const res = await request(app)
      .post('/api/admin/uninstall')
      .set('x-marketplace-secret', MARKETPLACE_SECRET)
      .set('Content-Type', 'application/json')
      .send({ domain: 'leaving.com' });
    expect(res.status).toBe(200);
    expect(firestore.upsertTenantConfig).toHaveBeenCalledWith('leaving.com', expect.objectContaining({
      active: false,
    }));
  });
});

// ── Happy-path coverage for the 4 highest-risk super-admin endpoints ──
// Auth gates are exhaustively tested in admin-auth-gates.test.js. These
// tests verify that when the super-admin DOES hit them, the right data
// flows through and (where applicable) side effects fire correctly.

describe('POST /api/admin/send-email — super admin can send from the dashboard', () => {
  test('400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/admin/send-email')
      .set(authedHeader(SUPER_ADMIN, 'gmail.com'))
      .set('Content-Type', 'application/json')
      .send({ to: 'user@x.com', subject: 's' }); // missing domain + body
    expect(res.status).toBe(400);
    expect(notifications.sendAdminEmail).not.toHaveBeenCalled();
  });

  test('sends email AND logs a conversation entry (single transaction)', async () => {
    notifications.sendAdminEmail.mockResolvedValue({ sent: true, id: 're_abc' });
    firestore.appendConversation.mockResolvedValue(undefined);
    const res = await request(app)
      .post('/api/admin/send-email')
      .set(authedHeader(SUPER_ADMIN, 'gmail.com'))
      .set('Content-Type', 'application/json')
      .send({
        to: 'ken@yacht.com', domain: 'yacht.com',
        subject: 'Quick check-in', body: 'Hey Ken, how\'s the tracker working?',
      });
    expect(res.status).toBe(200);
    expect(notifications.sendAdminEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: 'ken@yacht.com',
      subject: 'Quick check-in',
    }));
    // Conversation log is the audit trail — must fire on every send
    expect(firestore.appendConversation).toHaveBeenCalledWith('yacht.com', 'ken@yacht.com', expect.objectContaining({
      direction: 'sent',
      subject: 'Quick check-in',
      replyStatus: 'awaiting',
    }));
  });

  test('500 when Resend rejects (dashboard shouldn\'t swallow send failures)', async () => {
    notifications.sendAdminEmail.mockRejectedValue(new Error('Resend rejected'));
    const res = await request(app)
      .post('/api/admin/send-email')
      .set(authedHeader(SUPER_ADMIN, 'gmail.com'))
      .set('Content-Type', 'application/json')
      .send({ to: 'x@y.com', domain: 'y.com', subject: 's', body: 'b' });
    expect(res.status).toBe(500);
    // Failed send must NOT create a misleading "sent" conversation row
    expect(firestore.appendConversation).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/weekly-report — super admin can trigger the Monday email', () => {
  test('sends the weekly-self-report email when a report is available', async () => {
    firestore.getWeeklySelfReport.mockResolvedValue({
      week: '2026-06-29', totalTracked: 47, newUsers: 3,
    });
    notifications.sendWeeklySelfReport.mockResolvedValue({ sent: true });
    const res = await request(app)
      .post('/api/admin/weekly-report')
      .set(authedHeader(SUPER_ADMIN, 'gmail.com'))
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    expect(notifications.sendWeeklySelfReport).toHaveBeenCalledWith(expect.objectContaining({
      totalTracked: 47, newUsers: 3,
    }));
  });

  test('500 when the report generator returns null (no data to send)', async () => {
    firestore.getWeeklySelfReport.mockResolvedValue(null);
    const res = await request(app)
      .post('/api/admin/weekly-report')
      .set(authedHeader(SUPER_ADMIN, 'gmail.com'))
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(500);
    expect(notifications.sendWeeklySelfReport).not.toHaveBeenCalled();
  });
});

describe('GET /api/admin/user — user drill-down detail', () => {
  test('400 when email or domain query params are missing', async () => {
    const res = await request(app)
      .get('/api/admin/user?email=x@y.com') // no domain
      .set(authedHeader(SUPER_ADMIN, 'gmail.com'));
    expect(res.status).toBe(400);
    expect(firestore.getUserDetail).not.toHaveBeenCalled();
  });

  test('404 when the user does not exist', async () => {
    firestore.getUserDetail.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/admin/user?email=ghost@x.com&domain=x.com')
      .set(authedHeader(SUPER_ADMIN, 'gmail.com'));
    expect(res.status).toBe(404);
  });

  test('200 returns the user detail object', async () => {
    firestore.getUserDetail.mockResolvedValue({
      email: 'ken@yacht.com', displayName: 'Ken', tracked: 12, exported: 5,
    });
    const res = await request(app)
      .get('/api/admin/user?email=ken@yacht.com&domain=yacht.com')
      .set(authedHeader(SUPER_ADMIN, 'gmail.com'));
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('ken@yacht.com');
    expect(res.body.tracked).toBe(12);
    expect(firestore.getUserDetail).toHaveBeenCalledWith('yacht.com', 'ken@yacht.com');
  });
});

describe('PUT /api/admin/note — save private admin note about a user', () => {
  test('400 when email or domain is missing', async () => {
    const res = await request(app)
      .put('/api/admin/note')
      .set(authedHeader(SUPER_ADMIN, 'gmail.com'))
      .set('Content-Type', 'application/json')
      .send({ body: 'note' });
    expect(res.status).toBe(400);
    expect(firestore.setAdminNote).not.toHaveBeenCalled();
  });

  test('200 persists the note with author attribution', async () => {
    firestore.setAdminNote.mockResolvedValue({ saved: true, updatedAt: '2026-07-05T00:00:00Z' });
    const res = await request(app)
      .put('/api/admin/note')
      .set(authedHeader(SUPER_ADMIN, 'gmail.com'))
      .set('Content-Type', 'application/json')
      .send({ email: 'ken@yacht.com', domain: 'yacht.com', body: 'follow up next week' });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
    expect(firestore.setAdminNote).toHaveBeenCalledWith(
      'yacht.com', 'ken@yacht.com', 'follow up next week', SUPER_ADMIN
    );
  });

  test('200 with empty body — allows clearing an existing note', async () => {
    firestore.setAdminNote.mockResolvedValue({ saved: true });
    const res = await request(app)
      .put('/api/admin/note')
      .set(authedHeader(SUPER_ADMIN, 'gmail.com'))
      .set('Content-Type', 'application/json')
      .send({ email: 'x@y.com', domain: 'y.com' }); // no body → clear
    expect(res.status).toBe(200);
    expect(firestore.setAdminNote).toHaveBeenCalledWith('y.com', 'x@y.com', '', SUPER_ADMIN);
  });
});
