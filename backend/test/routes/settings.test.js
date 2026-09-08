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
  sendChatTestPing: jest.fn(),
  sendDiscordTestPing: jest.fn(),
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

describe('multi-provider webhooks (Google Chat + Discord)', () => {
  const CHAT_URL = 'https://chat.googleapis.com/v1/spaces/AAAA/messages?key=k123&token=chatSecretToken99';
  const DISCORD_URL = 'https://discord.com/api/webhooks/123456789/discordSecretToken42';

  test('GET reports configured + masked state for all three providers', async () => {
    firestore.getUserSettings.mockResolvedValue({
      slackWebhookUrl: 'https://hooks.slack.com/services/T0/B0/slackSecret1234',
      googleChatWebhookUrl: CHAT_URL,
      discordWebhookUrl: DISCORD_URL,
    });
    const res = await request(app).get('/api/settings').set(authedHeader('u@a.com', 'a.com'));
    expect(res.status).toBe(200);
    expect(res.body.googleChatWebhookConfigured).toBe(true);
    expect(res.body.googleChatWebhookMasked).toContain('chat.googleapis.com');
    expect(res.body.discordWebhookConfigured).toBe(true);
    expect(res.body.discordWebhookMasked).toContain('discord.com');
    // No plaintext secret may appear anywhere in the response
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('chatSecretToken99');
    expect(json).not.toContain('discordSecretToken42');
    expect(json).not.toContain('slackSecret1234');
  });

  test('GET defaults both new providers to unconfigured', async () => {
    firestore.getUserSettings.mockResolvedValue({});
    const res = await request(app).get('/api/settings').set(authedHeader('u@a.com', 'a.com'));
    expect(res.body.googleChatWebhookConfigured).toBe(false);
    expect(res.body.googleChatWebhookMasked).toBeNull();
    expect(res.body.discordWebhookConfigured).toBe(false);
    expect(res.body.discordWebhookMasked).toBeNull();
  });

  test('PUT saves a valid Google Chat webhook', async () => {
    const res = await request(app).put('/api/settings').set(authedHeader('u@a.com', 'a.com'))
      .send({ googleChatWebhookUrl: CHAT_URL });
    expect(res.status).toBe(200);
    expect(firestore.updateUserSettings).toHaveBeenCalledWith('a.com', 'u@a.com', { googleChatWebhookUrl: CHAT_URL });
  });

  test('PUT saves a valid Discord webhook', async () => {
    const res = await request(app).put('/api/settings').set(authedHeader('u@a.com', 'a.com'))
      .send({ discordWebhookUrl: DISCORD_URL });
    expect(res.status).toBe(200);
    expect(firestore.updateUserSettings).toHaveBeenCalledWith('a.com', 'u@a.com', { discordWebhookUrl: DISCORD_URL });
  });

  test('PUT can save all three webhooks in one request', async () => {
    const slack = 'https://hooks.slack.com/services/T0/B0/secret';
    const res = await request(app).put('/api/settings').set(authedHeader('u@a.com', 'a.com'))
      .send({ slackWebhookUrl: slack, googleChatWebhookUrl: CHAT_URL, discordWebhookUrl: DISCORD_URL });
    expect(res.status).toBe(200);
    expect(firestore.updateUserSettings).toHaveBeenCalledWith('a.com', 'u@a.com', {
      slackWebhookUrl: slack, googleChatWebhookUrl: CHAT_URL, discordWebhookUrl: DISCORD_URL,
    });
  });

  test('PUT 400 for arbitrary/lookalike URLs in the new fields (SSRF protection)', async () => {
    for (const body of [
      { googleChatWebhookUrl: 'https://evil.example.com/v1/spaces/A/messages?key=k&token=t' },
      { googleChatWebhookUrl: 'https://chat.googleapis.com.evil.com/v1/spaces/A/messages?key=k&token=t' },
      { discordWebhookUrl: 'https://evil.example.com/api/webhooks/1/t' },
      { discordWebhookUrl: 'https://discord.com.evil.com/api/webhooks/1/t' },
    ]) {
      const res = await request(app).put('/api/settings').set(authedHeader('u@a.com', 'a.com')).send(body);
      expect(res.status).toBe(400);
    }
    expect(firestore.updateUserSettings).not.toHaveBeenCalled();
  });

  test('PUT null clears each new field; non-string non-null is rejected', async () => {
    let res = await request(app).put('/api/settings').set(authedHeader('u@a.com', 'a.com'))
      .send({ googleChatWebhookUrl: null, discordWebhookUrl: '' });
    expect(res.status).toBe(200);
    expect(firestore.updateUserSettings).toHaveBeenCalledWith('a.com', 'u@a.com', {
      googleChatWebhookUrl: null, discordWebhookUrl: null,
    });

    res = await request(app).put('/api/settings').set(authedHeader('u@a.com', 'a.com'))
      .send({ discordWebhookUrl: 42 });
    expect(res.status).toBe(400);
  });

  describe('POST /api/settings/test-webhook', () => {
    test('401 without auth', async () => {
      const res = await request(app).post('/api/settings/test-webhook').send({ provider: 'discord' });
      expect(res.status).toBe(401);
    });

    test('400 for an unknown provider', async () => {
      const res = await request(app).post('/api/settings/test-webhook')
        .set(authedHeader('u@a.com', 'a.com')).send({ provider: 'msteams' });
      expect(res.status).toBe(400);
    });

    test('sends a Google Chat ping with the supplied URL', async () => {
      notifications.sendChatTestPing.mockResolvedValue({ sent: true });
      const res = await request(app).post('/api/settings/test-webhook')
        .set(authedHeader('u@a.com', 'a.com'))
        .send({ provider: 'googleChat', googleChatWebhookUrl: CHAT_URL });
      expect(res.status).toBe(200);
      expect(notifications.sendChatTestPing).toHaveBeenCalledWith({ webhookUrl: CHAT_URL });
    });

    test('falls back to the saved Discord webhook and surfaces a rejection as 502', async () => {
      firestore.getUserSettings.mockResolvedValue({ discordWebhookUrl: DISCORD_URL });
      notifications.sendDiscordTestPing.mockResolvedValue({ sent: false, status: 401 });
      const res = await request(app).post('/api/settings/test-webhook')
        .set(authedHeader('u@a.com', 'a.com')).send({ provider: 'discord' });
      expect(res.status).toBe(502);
      expect(notifications.sendDiscordTestPing).toHaveBeenCalledWith({ webhookUrl: DISCORD_URL });
    });

    test('400 when nothing supplied or saved / invalid URL supplied', async () => {
      firestore.getUserSettings.mockResolvedValue({});
      let res = await request(app).post('/api/settings/test-webhook')
        .set(authedHeader('u@a.com', 'a.com')).send({ provider: 'googleChat' });
      expect(res.status).toBe(400);

      res = await request(app).post('/api/settings/test-webhook')
        .set(authedHeader('u@a.com', 'a.com'))
        .send({ provider: 'discord', discordWebhookUrl: 'https://evil.example.com/x' });
      expect(res.status).toBe(400);
      expect(notifications.sendDiscordTestPing).not.toHaveBeenCalled();
    });

    test('routes provider "slack" through the shared handler', async () => {
      notifications.sendSlackTestPing.mockResolvedValue({ sent: true });
      const res = await request(app).post('/api/settings/test-webhook')
        .set(authedHeader('u@a.com', 'a.com'))
        .send({ provider: 'slack', slackWebhookUrl: 'https://hooks.slack.com/services/T/B/x' });
      expect(res.status).toBe(200);
      expect(notifications.sendSlackTestPing).toHaveBeenCalled();
    });
  });
});

describe('settings — error + validation branches', () => {
  test('GET /settings 500 when the read throws', async () => {
    firestore.getUserSettings.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/settings').set(authedHeader('u@acme.com', 'acme.com'));
    expect(res.status).toBe(500);
  });

  test('PUT rejects a non-string, non-null slackWebhookUrl', async () => {
    const res = await request(app).put('/api/settings').set(authedHeader('u@acme.com', 'acme.com')).send({ slackWebhookUrl: 123 });
    expect(res.status).toBe(400);
  });

  test('PUT rejects a non-boolean autoExportOnEnd', async () => {
    const res = await request(app).put('/api/settings').set(authedHeader('u@acme.com', 'acme.com')).send({ autoExportOnEnd: 'yes' });
    expect(res.status).toBe(400);
  });

  test('PUT rejects a non-boolean emailOptOut', async () => {
    const res = await request(app).put('/api/settings').set(authedHeader('u@acme.com', 'acme.com')).send({ emailOptOut: 'yes' });
    expect(res.status).toBe(400);
  });

  test('PUT 500 when the write throws', async () => {
    firestore.updateUserSettings.mockRejectedValue(new Error('boom'));
    const res = await request(app).put('/api/settings').set(authedHeader('u@acme.com', 'acme.com')).send({ autoExportOnEnd: true });
    expect(res.status).toBe(500);
  });

  test('GET masks a configured webhook and nulls an invalid one', async () => {
    firestore.getUserSettings.mockResolvedValue({ slackWebhookUrl: 'https://hooks.slack.com/services/T0/B0/SECRETTAIL' });
    let res = await request(app).get('/api/settings').set(authedHeader('u@acme.com', 'acme.com'));
    expect(res.body.slackWebhookConfigured).toBe(true);
    expect(res.body.slackWebhookMasked).toContain('hooks.slack.com');

    firestore.getUserSettings.mockResolvedValue({ slackWebhookUrl: 'not-a-valid-webhook' });
    res = await request(app).get('/api/settings').set(authedHeader('u@acme.com', 'acme.com'));
    expect(res.body.slackWebhookMasked).toBeNull();
  });
});

describe('settings — empty body', () => {
  test('PUT with no body → 400 (no supported settings)', async () => {
    const res = await request(app).put('/api/settings').set(authedHeader('u@acme.com', 'acme.com'));
    expect(res.status).toBe(400);
  });
});

describe('settings — non-JSON body (req.body || {})', () => {
  test('PUT with a non-JSON content-type falls back to {} → 400', async () => {
    const res = await request(app).put('/api/settings').set(authedHeader('u@acme.com', 'acme.com')).set('Content-Type', 'text/plain').send('hello');
    expect(res.status).toBe(400);
  });
});

describe('digestExtraEmails (extra report recipients)', () => {
  test('GET returns [] when unset and the saved list when set', async () => {
    firestore.getUserSettings.mockResolvedValue({});
    let res = await request(app).get('/api/settings').set(authedHeader('u@a.com', 'a.com'));
    expect(res.body.digestExtraEmails).toEqual([]);

    firestore.getUserSettings.mockResolvedValue({ digestExtraEmails: ['co@a.com', 'office@a.com'] });
    res = await request(app).get('/api/settings').set(authedHeader('u@a.com', 'a.com'));
    expect(res.body.digestExtraEmails).toEqual(['co@a.com', 'office@a.com']);
  });

  test('PUT normalizes: trims, lowercases, dedupes', async () => {
    const res = await request(app)
      .put('/api/settings')
      .set(authedHeader('u@a.com', 'a.com'))
      .send({ digestExtraEmails: [' Co@A.com ', 'co@a.com', 'office@a.com'] });
    expect(res.status).toBe(200);
    expect(firestore.updateUserSettings).toHaveBeenCalledWith('a.com', 'u@a.com', {
      digestExtraEmails: ['co@a.com', 'office@a.com'],
    });
  });

  test('PUT null and PUT [] both clear the list', async () => {
    for (const value of [null, []]) {
      firestore.updateUserSettings.mockClear();
      const res = await request(app)
        .put('/api/settings')
        .set(authedHeader('u@a.com', 'a.com'))
        .send({ digestExtraEmails: value });
      expect(res.status).toBe(200);
      expect(firestore.updateUserSettings).toHaveBeenCalledWith('a.com', 'u@a.com', {
        digestExtraEmails: null,
      });
    }
  });

  test('PUT 400 for invalid shapes: non-array, >5 entries, non-string entry, bad address, overlong address', async () => {
    const bad = [
      'not-an-array',
      ['a@a.com', 'b@a.com', 'c@a.com', 'd@a.com', 'e@a.com', 'f@a.com'],
      [42],
      ['not-an-email'],
      ['missing-tld@x.c'],
      [`${'x'.repeat(250)}@a.com`],
    ];
    for (const value of bad) {
      const res = await request(app)
        .put('/api/settings')
        .set(authedHeader('u@a.com', 'a.com'))
        .send({ digestExtraEmails: value });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/digestExtraEmails/);
    }
    expect(firestore.updateUserSettings).not.toHaveBeenCalled();
  });
});
