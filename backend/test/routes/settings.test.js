// Integration tests for /api/settings* — Slack webhook configuration.
// Critical surface: webhook URLs are bearer secrets; the route must
// validate format, mask on read, and only accept Slack webhook hostnames
// (refusing arbitrary outbound).

const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

jest.mock('../../src/services/firestore', () => ({
  getUserSettings: jest.fn(),
  updateUserSettings: jest.fn(),
  isEmailSuppressed: jest.fn(),
  suppressEmail: jest.fn(),
  unsuppressEmail: jest.fn(),
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
}));
jest.mock('../../src/lib/notifications', () => ({
  sendSlackTestPing: jest.fn(),
  maskSlackWebhook: jest.requireActual('../../src/lib/notifications').maskSlackWebhook,
}));

const firestore = require('../../src/services/firestore');
const notifications = require('../../src/lib/notifications');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  firestore.getUser.mockImplementation(async (domain, email) => ({ email, domain }));
  firestore.isEmailSuppressed.mockResolvedValue(false);
  firestore.suppressEmail.mockResolvedValue(true);
  firestore.unsuppressEmail.mockResolvedValue(true);
  firestore.updateUserSettings.mockResolvedValue({ saved: true });
  app = buildApp();
});

describe('GET /api/settings', () => {
  test('401 without auth', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });

  test('returns slackWebhookConfigured:false when no settings doc', async () => {
    firestore.getUserSettings.mockResolvedValue({});
    const res = await request(app)
      .get('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'));
    expect(res.status).toBe(200);
    expect(res.body.slackWebhookConfigured).toBe(false);
    expect(res.body.slackWebhookMasked).toBeNull();
  });

  test('returns masked URL when configured (never echoes plaintext)', async () => {
    firestore.getUserSettings.mockResolvedValue({
      slackWebhookUrl: 'https://hooks.slack.com/services/T01ABC/B02DEF/superSecretToken1234',
    });
    const res = await request(app)
      .get('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'));
    expect(res.status).toBe(200);
    expect(res.body.slackWebhookConfigured).toBe(true);
    expect(res.body.slackWebhookMasked).toBeDefined();
    // The plaintext secret must never appear in the response
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('superSecretToken1234');
  });

  test('Cache-Control: no-store (settings might change between hits)', async () => {
    firestore.getUserSettings.mockResolvedValue({});
    const res = await request(app)
      .get('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'));
    expect(res.headers['cache-control']).toContain('no-store');
  });

  test('returns autoExportOnEnd and emailOptOut state', async () => {
    firestore.getUserSettings.mockResolvedValue({ autoExportOnEnd: true });
    firestore.isEmailSuppressed.mockResolvedValue(true);
    const res = await request(app)
      .get('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'));
    expect(res.body.autoExportOnEnd).toBe(true);
    expect(res.body.emailOptOut).toBe(true);
  });

  test('defaults autoExportOnEnd:false and emailOptOut:false when unset', async () => {
    firestore.getUserSettings.mockResolvedValue({});
    const res = await request(app)
      .get('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'));
    expect(res.body.autoExportOnEnd).toBe(false);
    expect(res.body.emailOptOut).toBe(false);
  });
});

describe('PUT /api/settings', () => {
  test('401 without auth', async () => {
    const res = await request(app)
      .put('/api/settings')
      .send({ slackWebhookUrl: 'https://hooks.slack.com/services/T/B/x' });
    expect(res.status).toBe(401);
  });

  test('200 with valid Slack webhook URL', async () => {
    firestore.updateUserSettings.mockResolvedValue({ saved: true });
    const res = await request(app)
      .put('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ slackWebhookUrl: 'https://hooks.slack.com/services/T01/B02/secret' });
    expect(res.status).toBe(200);
    expect(res.body.saved).toBe(true);
    expect(firestore.updateUserSettings).toHaveBeenCalledWith('a.com', 'u@a.com', expect.objectContaining({
      slackWebhookUrl: 'https://hooks.slack.com/services/T01/B02/secret',
    }));
  });

  test('400 for arbitrary URL (SSRF protection)', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ slackWebhookUrl: 'https://evil.example.com/webhook' });
    expect(res.status).toBe(400);
    expect(firestore.updateUserSettings).not.toHaveBeenCalled();
  });

  test('400 for hooks.slack.com-LOOKALIKE domain (defense in depth)', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ slackWebhookUrl: 'https://hooks.slack.com.evil.com/services/A/B/C' });
    expect(res.status).toBe(400);
  });

  test('400 for malformed Slack URL (missing path segments)', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ slackWebhookUrl: 'https://hooks.slack.com/services/T01' });
    expect(res.status).toBe(400);
  });

  test('200 with null clears the webhook', async () => {
    firestore.updateUserSettings.mockResolvedValue({ saved: true });
    const res = await request(app)
      .put('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ slackWebhookUrl: null });
    expect(res.status).toBe(200);
    expect(firestore.updateUserSettings).toHaveBeenCalledWith('a.com', 'u@a.com', { slackWebhookUrl: null });
  });

  test('400 when body has no supported fields', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ irrelevantField: 'x' });
    expect(res.status).toBe(400);
  });

  test('200 persists autoExportOnEnd boolean to userSettings', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ autoExportOnEnd: true });
    expect(res.status).toBe(200);
    expect(firestore.updateUserSettings).toHaveBeenCalledWith('a.com', 'u@a.com', { autoExportOnEnd: true });
  });

  test('400 when autoExportOnEnd is not a boolean', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ autoExportOnEnd: 'yes' });
    expect(res.status).toBe(400);
    expect(firestore.updateUserSettings).not.toHaveBeenCalled();
  });

  test('emailOptOut:true suppresses the address (no userSettings write)', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ emailOptOut: true });
    expect(res.status).toBe(200);
    expect(firestore.suppressEmail).toHaveBeenCalledWith('u@a.com', expect.objectContaining({ source: 'settings_toggle' }));
    expect(firestore.updateUserSettings).not.toHaveBeenCalled();
  });

  test('emailOptOut:false removes the suppression', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ emailOptOut: false });
    expect(res.status).toBe(200);
    expect(firestore.unsuppressEmail).toHaveBeenCalledWith('u@a.com');
  });

  test('can set a preference and email opt-out together in one request', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ autoExportOnEnd: false, emailOptOut: true });
    expect(res.status).toBe(200);
    expect(firestore.updateUserSettings).toHaveBeenCalledWith('a.com', 'u@a.com', { autoExportOnEnd: false });
    expect(firestore.suppressEmail).toHaveBeenCalled();
  });
});

describe('POST /api/settings/test-slack', () => {
  test('401 without auth', async () => {
    const res = await request(app).post('/api/settings/test-slack');
    expect(res.status).toBe(401);
  });

  test('400 when no webhook supplied or saved', async () => {
    firestore.getUserSettings.mockResolvedValue({});
    const res = await request(app)
      .post('/api/settings/test-slack')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(400);
  });

  test('400 for arbitrary URL (SSRF protection)', async () => {
    const res = await request(app)
      .post('/api/settings/test-slack')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ slackWebhookUrl: 'https://evil.example.com/x' });
    expect(res.status).toBe(400);
    expect(notifications.sendSlackTestPing).not.toHaveBeenCalled();
  });

  test('200 sent:true when Slack responds OK', async () => {
    notifications.sendSlackTestPing.mockResolvedValue({ sent: true });
    const res = await request(app)
      .post('/api/settings/test-slack')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ slackWebhookUrl: 'https://hooks.slack.com/services/T/B/x' });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
  });

  test('502 when Slack rejects the ping', async () => {
    notifications.sendSlackTestPing.mockResolvedValue({ sent: false, status: 404 });
    const res = await request(app)
      .post('/api/settings/test-slack')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ slackWebhookUrl: 'https://hooks.slack.com/services/T/B/x' });
    expect(res.status).toBe(502);
  });

  test('uses saved webhook when none supplied in body', async () => {
    firestore.getUserSettings.mockResolvedValue({
      slackWebhookUrl: 'https://hooks.slack.com/services/Tsaved/Bsaved/secret',
    });
    notifications.sendSlackTestPing.mockResolvedValue({ sent: true });
    const res = await request(app)
      .post('/api/settings/test-slack')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(200);
    expect(notifications.sendSlackTestPing).toHaveBeenCalledWith({
      webhookUrl: 'https://hooks.slack.com/services/Tsaved/Bsaved/secret',
    });
  });
});
