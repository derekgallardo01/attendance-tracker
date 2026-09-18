const request = require('supertest');
const crypto = require('crypto');
const { buildApp } = require('../helpers/testApp');
const { verifySvixSignature } = require('../../src/routes/webhooks');

jest.mock('../../src/services/firestore', () => ({
  updateNotificationWebhook: jest.fn(),
  suppressEmail: jest.fn(),
  getDb: jest.fn(),
}));

const firestore = require('../../src/services/firestore');

describe('Resend Webhook & Svix Verification', () => {
  const TEST_SECRET = 'whsec_' + Buffer.from('test-secret-key-32-bytes-long-12345').toString('base64');
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.RESEND_WEBHOOK_SECRET = TEST_SECRET;
    app = buildApp();
  });

  afterEach(() => {
    delete process.env.RESEND_WEBHOOK_SECRET;
  });

  function generateSvixHeaders(payload, secret = TEST_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
    const svixId = 'msg_' + Math.random().toString(36).slice(2);
    const svixTimestamp = String(timestamp);
    const keyBuf = secret.startsWith('whsec_') ? Buffer.from(secret.slice(6), 'base64') : Buffer.from(secret, 'utf8');
    const toSign = `${svixId}.${svixTimestamp}.${typeof payload === 'string' ? payload : JSON.stringify(payload)}`;
    const sig = crypto.createHmac('sha256', keyBuf).update(toSign).digest('base64');
    return {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': `v1,${sig}`,
    };
  }

  describe('verifySvixSignature', () => {
    test('verifies valid signature', () => {
      const body = JSON.stringify({ hello: 'world' });
      const headers = generateSvixHeaders(body, TEST_SECRET);
      expect(verifySvixSignature(body, headers, TEST_SECRET)).toBe(true);
    });

    test('rejects expired timestamp (>5min old)', () => {
      const body = JSON.stringify({ hello: 'world' });
      const oldTime = Math.floor(Date.now() / 1000) - 400;
      const headers = generateSvixHeaders(body, TEST_SECRET, oldTime);
      expect(verifySvixSignature(body, headers, TEST_SECRET)).toBe(false);
    });

    test('rejects tampered body or invalid signature', () => {
      const body = JSON.stringify({ hello: 'world' });
      const headers = generateSvixHeaders(body, TEST_SECRET);
      expect(verifySvixSignature('tampered', headers, TEST_SECRET)).toBe(false);
    });

    test('returns false when secret or headers missing', () => {
      expect(verifySvixSignature('{}', {}, null)).toBe(false);
      expect(verifySvixSignature('{}', {}, TEST_SECRET)).toBe(false);
    });
  });

  describe('POST /api/webhooks/resend', () => {
    test('401 when signature is invalid', async () => {
      const res = await request(app)
        .post('/api/webhooks/resend')
        .set('Content-Type', 'application/json')
        .set('svix-id', 'test-id')
        .set('svix-timestamp', String(Math.floor(Date.now() / 1000)))
        .set('svix-signature', 'v1,invalid-sig')
        .send({ type: 'email.delivered', data: { email_id: '123' } });

      expect(res.status).toBe(401);
      expect(firestore.updateNotificationWebhook).not.toHaveBeenCalled();
    });

    test('200 and processes email.delivered event', async () => {
      const event = {
        type: 'email.delivered',
        data: {
          email_id: 'resend-123',
          to: ['teacher@school.edu'],
          subject: 'Weekly Report',
        },
      };
      const rawBody = JSON.stringify(event);
      const headers = generateSvixHeaders(rawBody, TEST_SECRET);

      firestore.updateNotificationWebhook.mockResolvedValue(true);

      const res = await request(app)
        .post('/api/webhooks/resend')
        .set('Content-Type', 'application/json')
        .set(headers)
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.received).toBe(true);
      expect(firestore.updateNotificationWebhook).toHaveBeenCalledWith('resend-123', 'email.delivered', event.data);
    });

    test('200 and processes email.bounced event', async () => {
      const event = {
        type: 'email.bounced',
        data: {
          email_id: 'resend-456',
          to: ['invalid@school.edu'],
          bounce: { type: 'hard' },
        },
      };
      const rawBody = JSON.stringify(event);
      const headers = generateSvixHeaders(rawBody, TEST_SECRET);

      firestore.updateNotificationWebhook.mockResolvedValue(true);

      const res = await request(app)
        .post('/api/webhooks/resend')
        .set('Content-Type', 'application/json')
        .set(headers)
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(firestore.updateNotificationWebhook).toHaveBeenCalledWith('resend-456', 'email.bounced', event.data);
    });

    test('ignores events without email_id gracefully', async () => {
      const event = { type: 'unknown_event', data: {} };
      const rawBody = JSON.stringify(event);
      const headers = generateSvixHeaders(rawBody, TEST_SECRET);

      const res = await request(app)
        .post('/api/webhooks/resend')
        .set('Content-Type', 'application/json')
        .set(headers)
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.ignored).toBe(true);
      expect(firestore.updateNotificationWebhook).not.toHaveBeenCalled();
    });

    test('500 when updateNotificationWebhook rejects', async () => {
      const event = {
        type: 'email.opened',
        data: { email_id: 'resend-789' },
      };
      const rawBody = JSON.stringify(event);
      const headers = generateSvixHeaders(rawBody, TEST_SECRET);

      firestore.updateNotificationWebhook.mockRejectedValue(new Error('firestore timeout'));

      const res = await request(app)
        .post('/api/webhooks/resend')
        .set('Content-Type', 'application/json')
        .set(headers)
        .send(rawBody);

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Failed to process webhook');
    });
  });
});
