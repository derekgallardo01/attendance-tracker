// Tests for /api/public/* — unauthenticated endpoints. These take untrusted
// input so validation + rate-limiting matter most. Also covers the share-link
// resolver since recipients hit it without auth.

const request = require('supertest');
const { buildApp } = require('../helpers/testApp');

jest.mock('../../src/services/firestore', () => ({
  getDb: jest.fn(),
  resolveShareLink: jest.fn(),
  getSharedSeriesView: jest.fn(),
  suppressEmail: jest.fn(),
  // Auth middleware deps (unused on public routes but module is loaded)
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
}));
jest.mock('../../src/lib/notifications', () => ({
  sendFeedbackEmail: jest.fn(),
  verifyUnsubscribeToken: jest.fn(),
}));

const firestore = require('../../src/services/firestore');
const notifications = require('../../src/lib/notifications');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  // Stub the Firestore db pageview write so the beacon endpoint doesn't crash
  firestore.getDb.mockReturnValue({
    collection: () => ({
      add: jest.fn().mockResolvedValue(undefined),
      doc: () => ({
        set: jest.fn().mockResolvedValue(undefined),
      }),
    }),
  });
  app = buildApp();
});

describe('GET /api/public/stats', () => {
  // MUST run before any successful stats call populates the module-level cache,
  // so the fallback returns the zero state (cached is still null) rather than a
  // stale cached value.
  test('returns a zero state when uncached and the read fails', async () => {
    firestore.getDb.mockReturnValue({
      collection: () => ({ get: jest.fn().mockRejectedValue(new Error('boom')) }),
      collectionGroup: () => ({ get: jest.fn().mockRejectedValue(new Error('boom')) }),
    });
    const res = await request(app).get('/api/public/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ organizations: 0, meetings: 0 }));
  });

  test('returns org + meeting counts (or fallback on failure)', async () => {
    firestore.getDb.mockReturnValue({
      collection: () => ({ get: jest.fn().mockResolvedValue({ docs: [{ id: 'acme.com' }, { id: 'beta.com' }] }) }),
      collectionGroup: (name) => ({
        get: jest.fn().mockResolvedValue({
          docs: name === 'users'
            ? [{ ref: { parent: { parent: { id: 'acme.com' } } } }]
            : [{}, {}, {}], // 3 meetings
          size: name === 'users' ? 1 : 3,
        }),
      }),
    });
    const res = await request(app).get('/api/public/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('organizations');
    expect(res.body).toHaveProperty('meetings');
  });

  test('falls back gracefully when getDb throws', async () => {
    firestore.getDb.mockImplementation(() => { throw new Error('boom'); });
    const res = await request(app).get('/api/public/stats');
    // Endpoint catches and returns last-cached or zero state
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('organizations');
  });
});

describe('POST /api/public/pageview', () => {
  test('always returns 204 (fire-and-forget)', async () => {
    const res = await request(app)
      .post('/api/public/pageview')
      .set('Content-Type', 'application/json')
      .send({ path: '/', referrer: 'https://reddit.com' });
    expect(res.status).toBe(204);
  });

  test('204 even with empty body (beacon may have no data)', async () => {
    const res = await request(app)
      .post('/api/public/pageview')
      .set('Content-Type', 'application/json')
      .send({});
    expect(res.status).toBe(204);
  });

  test('records a cta_click event and bumps the daily ctaClicks counter', async () => {
    const addSpy = jest.fn().mockResolvedValue(undefined);
    const setSpy = jest.fn().mockResolvedValue(undefined);
    firestore.getDb.mockReturnValue({
      collection: (name) => name === 'pageviews'
        ? { add: addSpy }
        : { doc: () => ({ set: setSpy }) },
    });

    const res = await request(app)
      .post('/api/public/pageview')
      .set('Content-Type', 'application/json')
      .send({ path: '/', event: 'cta_click', eventLabel: 'marketplace_install_hero' });
    expect(res.status).toBe(204);
    // Give the fire-and-forget writes a tick to run.
    await new Promise((r) => setImmediate(r));

    expect(addSpy).toHaveBeenCalledWith(expect.objectContaining({
      event: 'cta_click', eventLabel: 'marketplace_install_hero',
    }));
    const dailyPatch = setSpy.mock.calls[0][0];
    expect(dailyPatch).toHaveProperty('ctaClicks'); // conversion counter incremented
  });

  test('an unknown event type falls back to pageview (allow-list) and has no ctaClicks', async () => {
    const addSpy = jest.fn().mockResolvedValue(undefined);
    const setSpy = jest.fn().mockResolvedValue(undefined);
    firestore.getDb.mockReturnValue({
      collection: (name) => name === 'pageviews'
        ? { add: addSpy }
        : { doc: () => ({ set: setSpy }) },
    });

    await request(app)
      .post('/api/public/pageview')
      .set('Content-Type', 'application/json')
      .send({ path: '/', event: 'hack_attempt' });
    await new Promise((r) => setImmediate(r));

    expect(addSpy).toHaveBeenCalledWith(expect.objectContaining({ event: 'pageview' }));
    expect(setSpy.mock.calls[0][0]).not.toHaveProperty('ctaClicks');
  });
});

describe('POST /api/public/feedback', () => {
  test('400 when body is missing', async () => {
    const res = await request(app)
      .post('/api/public/feedback')
      .set('Content-Type', 'application/json')
      .send({ fromEmail: 'a@b.com' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/body/i);
  });

  test('400 when body is too short', async () => {
    const res = await request(app)
      .post('/api/public/feedback')
      .set('Content-Type', 'application/json')
      .send({ body: 'x' });
    expect(res.status).toBe(400);
  });

  test('200 with valid body — sends email via notifications', async () => {
    notifications.sendFeedbackEmail.mockResolvedValue({ sent: true });
    const res = await request(app)
      .post('/api/public/feedback')
      .set('Content-Type', 'application/json')
      .send({
        body: 'This is real feedback that should land in the inbox.',
        fromEmail: 'happy@user.com',
        fromName: 'Happy User',
        source: 'landing_page',
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(notifications.sendFeedbackEmail).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining('real feedback'),
      fromEmail: 'happy@user.com',
      fromName: 'Happy User',
      source: 'landing_page',
    }));
  });

  test('500 when sendFeedbackEmail throws (SMTP unavailable)', async () => {
    notifications.sendFeedbackEmail.mockRejectedValue(new Error('SMTP down'));
    const res = await request(app)
      .post('/api/public/feedback')
      .set('Content-Type', 'application/json')
      .send({ body: 'Test feedback message here' });
    expect(res.status).toBe(500);
  });

  test('truncates very long body to 5000 chars before forwarding', async () => {
    notifications.sendFeedbackEmail.mockResolvedValue({ sent: true });
    const huge = 'x'.repeat(10000);
    await request(app)
      .post('/api/public/feedback')
      .set('Content-Type', 'application/json')
      .send({ body: huge });
    const callArg = notifications.sendFeedbackEmail.mock.calls[0][0];
    expect(callArg.body.length).toBeLessThanOrEqual(5000);
  });
});

describe('GET /api/public/share/:token', () => {
  test('404 when token does not exist', async () => {
    firestore.resolveShareLink.mockResolvedValue(null);
    const res = await request(app).get('/api/public/share/nonexistent-token');
    expect(res.status).toBe(404);
  });

  test('404 when token resolves but underlying series is gone', async () => {
    firestore.resolveShareLink.mockResolvedValue({
      type: 'series', domain: 'acme.com', recurringEventId: 'series-x',
    });
    firestore.getSharedSeriesView.mockResolvedValue(null);
    const res = await request(app).get('/api/public/share/valid-token');
    expect(res.status).toBe(404);
  });

  test('200 returns the series view (no emails leaked)', async () => {
    firestore.resolveShareLink.mockResolvedValue({
      type: 'series', domain: 'acme.com', recurringEventId: 'series-x', ownerEmail: 'admin@acme.com',
    });
    firestore.getSharedSeriesView.mockResolvedValue({
      title: 'Daily Standup', instanceCount: 12, uniquePeople: 5,
      firstAt: '2026-01-01T00:00:00Z', lastAt: '2026-06-01T00:00:00Z',
      // Note: production code strips emails from people array — only name + count
      people: [{ displayName: 'Alex', attended: 10, attendanceRate: 0.83 }],
    });
    const res = await request(app).get('/api/public/share/valid-token');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Daily Standup');
    expect(res.body.people[0]).not.toHaveProperty('email'); // privacy
  });

  test('400 for non-series link types (future-proofing)', async () => {
    firestore.resolveShareLink.mockResolvedValue({
      type: 'unknown_type', domain: 'acme.com',
    });
    const res = await request(app).get('/api/public/share/valid-token');
    expect(res.status).toBe(400);
  });

  test('Cache-Control: no-store (token might be revoked between hits)', async () => {
    firestore.resolveShareLink.mockResolvedValue({
      type: 'series', domain: 'acme.com', recurringEventId: 'series-x',
    });
    firestore.getSharedSeriesView.mockResolvedValue({
      title: 'X', instanceCount: 1, uniquePeople: 0, people: [],
    });
    const res = await request(app).get('/api/public/share/valid-token');
    expect(res.headers['cache-control']).toContain('no-store');
  });
});

describe('GET /api/public/unsubscribe', () => {
  test('valid token suppresses the email and returns a confirmation page', async () => {
    notifications.verifyUnsubscribeToken.mockReturnValue(true);
    firestore.suppressEmail.mockResolvedValue(true);
    const res = await request(app)
      .get('/api/public/unsubscribe')
      .query({ e: 'user@acme.com', t: 'goodtoken' });
    expect(res.status).toBe(200);
    expect(firestore.suppressEmail).toHaveBeenCalledWith(
      'user@acme.com', expect.objectContaining({ source: 'one_click_unsubscribe' })
    );
    expect(res.text).toContain('unsubscribed');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  test('invalid token returns 400 and does not suppress', async () => {
    notifications.verifyUnsubscribeToken.mockReturnValue(false);
    const res = await request(app)
      .get('/api/public/unsubscribe')
      .query({ e: 'user@acme.com', t: 'badtoken' });
    expect(res.status).toBe(400);
    expect(firestore.suppressEmail).not.toHaveBeenCalled();
  });

  test('missing email returns 400', async () => {
    notifications.verifyUnsubscribeToken.mockReturnValue(false);
    const res = await request(app).get('/api/public/unsubscribe').query({ t: 'x' });
    expect(res.status).toBe(400);
    expect(firestore.suppressEmail).not.toHaveBeenCalled();
  });

  test('reflected email is HTML-escaped in the confirmation page (no XSS)', async () => {
    notifications.verifyUnsubscribeToken.mockReturnValue(true);
    firestore.suppressEmail.mockResolvedValue(true);
    const res = await request(app)
      .get('/api/public/unsubscribe')
      .query({ e: '<script>alert(1)</script>@x.com', t: 'goodtoken' });
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });
});

describe('public — error paths + validation branches', () => {
  test('feedback tolerates a Firestore persist failure and still 200s', async () => {
    firestore.getDb.mockReturnValue({ collection: () => ({ add: jest.fn().mockRejectedValue(new Error('persist boom')) }) });
    notifications.sendFeedbackEmail.mockResolvedValue({ sent: true });
    const res = await request(app).post('/api/public/feedback').set('X-Forwarded-For', '10.9.0.1').send({ body: 'This is real feedback', fromEmail: 'a@x.com' });
    expect(res.status).toBe(200);
  });

  test('feedback 400 on too-short body', async () => {
    const res = await request(app).post('/api/public/feedback').set('X-Forwarded-For', '10.9.0.2').send({ body: 'x' });
    expect(res.status).toBe(400);
  });

  test('pageview swallows a write failure (still 204)', async () => {
    firestore.getDb.mockImplementation(() => { throw new Error('db boom'); });
    const res = await request(app).post('/api/public/pageview').set('Content-Type', 'application/json').send({ event: 'unknown_event', path: '/x' });
    expect(res.status).toBe(204);
    await new Promise((r) => setImmediate(r)); // let the fire-and-forget write reject into the catch
  });

  test('feedback 400 when body is not a string', async () => {
    const res = await request(app).post('/api/public/feedback').set('X-Forwarded-For', '10.9.0.3').send({ body: 12345 });
    expect(res.status).toBe(400);
  });

  test('stats falls back when the query throws', async () => {
    firestore.getDb.mockReturnValue({
      collection: () => ({ get: jest.fn().mockRejectedValue(new Error('boom')) }),
      collectionGroup: () => ({ get: jest.fn().mockRejectedValue(new Error('boom')) }),
    });
    const res = await request(app).get('/api/public/stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('organizations');
  });

  test('share resolve 500 when the lookup throws', async () => {
    firestore.resolveShareLink.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/public/share/tok');
    expect(res.status).toBe(500);
  });

  test('unsubscribe 400 on an invalid token', async () => {
    notifications.verifyUnsubscribeToken.mockReturnValue(false);
    const res = await request(app).get('/api/public/unsubscribe?e=a@x.com&t=bad');
    expect(res.status).toBe(400);
  });

  test('unsubscribe suppresses on a valid token', async () => {
    notifications.verifyUnsubscribeToken.mockReturnValue(true);
    firestore.suppressEmail.mockResolvedValue(true);
    const res = await request(app).get('/api/public/unsubscribe?e=a@x.com&t=good');
    expect(res.status).toBe(200);
    expect(firestore.suppressEmail).toHaveBeenCalled();
  });
});

describe('public — final residual branches', () => {
  test('pageview stores a numeric viewportWidth', async () => {
    const setSpy = jest.fn().mockResolvedValue(undefined);
    const addSpy = jest.fn().mockResolvedValue(undefined);
    firestore.getDb.mockReturnValue({ collection: (n) => n === 'pageviews' ? { add: addSpy } : { doc: () => ({ set: setSpy }) } });
    await request(app).post('/api/public/pageview').set('Content-Type', 'application/json').send({ path: '/', viewportWidth: 1280 });
    await new Promise((r) => setImmediate(r));
    expect(addSpy).toHaveBeenCalledWith(expect.objectContaining({ viewportWidth: 1280 }));
  });

  test('unsubscribe with a missing token → 400', async () => {
    notifications.verifyUnsubscribeToken.mockReturnValue(false);
    const res = await request(app).get('/api/public/unsubscribe?e=a@x.com');
    expect(res.status).toBe(400);
  });
});
