// Integration tests for /api/oauth/* — exchange, me, revoke. Focus on:
//  - /me returns the teamAdmin flag (newly added; frontend uses it to gate UI)
//  - exchange validates inputs and returns 400/401 on bad codes
//  - revoke requires auth and tolerates a bad/missing refresh token

const request = require('supertest');
const { authedHeader, buildApp, makeJwt } = require('../helpers/testApp');

jest.mock('../../src/services/firestore', () => ({
  upsertUser: jest.fn(),
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
  logEvent: jest.fn(),
  getUserActivationStatus: jest.fn(),
  countAllUsers: jest.fn(),
  getTenantConfig: jest.fn(),
  deleteUser: jest.fn(),
}));
jest.mock('../../src/services/googleAuth', () => ({
  exchangeCode: jest.fn(),
  revokeToken: jest.fn(),
}));
jest.mock('../../src/lib/notifications', () => ({
  sendSignupWebhook: jest.fn(),
  maybeSendSignupNotification: jest.fn().mockResolvedValue({ sent: false }),
}));
// google.auth.OAuth2 verifyIdToken is invoked inside exchange — mock it. The
// payload is mutable so a test can simulate a personal (no-hd) Google account.
let mockPayload = { email: 'newuser@acme.com', hd: 'acme.com', name: 'New User' };
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        verifyIdToken: jest.fn().mockResolvedValue({ getPayload: () => mockPayload }),
      })),
    },
  },
}));

const firestore = require('../../src/services/firestore');
const googleAuth = require('../../src/services/googleAuth');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  mockPayload = { email: 'newuser@acme.com', hd: 'acme.com', name: 'New User' };
  app = buildApp();
});

describe('POST /api/oauth/exchange', () => {
  test('400 when code is missing', async () => {
    const res = await request(app)
      .post('/api/oauth/exchange')
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/code/i);
  });

  test('401 when exchangeCode throws (invalid auth code)', async () => {
    googleAuth.exchangeCode.mockRejectedValue(new Error('Invalid grant'));
    const res = await request(app)
      .post('/api/oauth/exchange')
      .send({ code: 'bad-code' });
    expect(res.status).toBe(401);
  });

  test('200 returns sessionToken + teamAdmin status', async () => {
    googleAuth.exchangeCode.mockResolvedValue({
      id_token: 'fake-id-token',
      access_token: 'fake-access',
      refresh_token: 'fake-refresh',
      expiry_date: Date.now() + 3600 * 1000,
      scope: 'https://www.googleapis.com/auth/meetings.space.readonly https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/calendar.events.readonly openid email profile',
    });
    firestore.getUser.mockResolvedValue(null); // brand new user
    firestore.countAllUsers.mockResolvedValue(19);
    const res = await request(app)
      .post('/api/oauth/exchange')
      .send({ code: 'good-code' });
    expect(res.status).toBe(200);
    expect(res.body.sessionToken).toBeDefined();
    expect(res.body.email).toBe('newuser@acme.com');
    expect(res.body.isNewUser).toBe(true);
    // Brand-new user with no acquisitionSource = needs the modal
    expect(res.body.needsAcquisitionSource).toBe(true);
  });

  test('passes ?ref= acquisition data to upsertUser (referral attribution)', async () => {
    googleAuth.exchangeCode.mockResolvedValue({
      id_token: 'x', access_token: 'y', refresh_token: 'z',
      expiry_date: Date.now() + 3600000,
      scope: 'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/meetings.space.readonly https://www.googleapis.com/auth/calendar.events.readonly',
    });
    firestore.getUser.mockResolvedValue(null);
    firestore.countAllUsers.mockResolvedValue(1);
    await request(app)
      .post('/api/oauth/exchange')
      .send({
        code: 'c',
        acquisition: { ref: 'inviter@acme.com', utmSource: 'reddit' },
      });
    expect(firestore.upsertUser).toHaveBeenCalledWith('acme.com', expect.objectContaining({
      acquisition: expect.objectContaining({ ref: 'inviter@acme.com', utmSource: 'reddit' }),
    }));
  });
});

describe('GET /api/oauth/me', () => {
  test('401 without Bearer header', async () => {
    const res = await request(app).get('/api/oauth/me');
    expect(res.status).toBe(401);
  });

  test('401 with invalid JWT', async () => {
    const res = await request(app)
      .get('/api/oauth/me')
      .set('Authorization', 'Bearer not.valid.token');
    expect(res.status).toBe(401);
  });

  test('returns teamAdmin:true for team admin user', async () => {
    firestore.getUser.mockResolvedValue({
      email: 'admin@acme.com', domain: 'acme.com', teamAdmin: true,
    });
    firestore.getUserActivationStatus.mockResolvedValue({
      hasSignedIn: true, hasTracked: true, hasExported: false,
    });
    const res = await request(app)
      .get('/api/oauth/me')
      .set(authedHeader('admin@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.teamAdmin).toBe(true);
    expect(res.body.email).toBe('admin@acme.com');
  });

  test('returns teamAdmin:false for regular user', async () => {
    firestore.getUser.mockResolvedValue({
      email: 'regular@acme.com', domain: 'acme.com',
    });
    firestore.getUserActivationStatus.mockResolvedValue({
      hasSignedIn: true, hasTracked: false, hasExported: false,
    });
    const res = await request(app)
      .get('/api/oauth/me')
      .set(authedHeader('regular@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.teamAdmin).toBe(false);
  });

  test('returns teamAdmin:false when getUser returns null (defensive)', async () => {
    firestore.getUser.mockResolvedValue(null);
    firestore.getUserActivationStatus.mockResolvedValue({});
    const res = await request(app)
      .get('/api/oauth/me')
      .set(authedHeader('ghost@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.teamAdmin).toBe(false);
  });

  test('401 when JWT is expired', async () => {
    const expired = makeJwt({ email: 'a@b.com', domain: 'b.com' }, { expiresIn: '-1h' });
    const res = await request(app)
      .get('/api/oauth/me')
      .set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
  });
});

describe('POST /api/oauth/revoke', () => {
  test('401 without Bearer header', async () => {
    const res = await request(app).post('/api/oauth/revoke');
    expect(res.status).toBe(401);
  });

  test('200 when user has a refresh token to revoke', async () => {
    firestore.getUser.mockResolvedValue({
      email: 'user@acme.com', domain: 'acme.com', refreshToken: 'rt-xxx',
    });
    googleAuth.revokeToken.mockResolvedValue(undefined);
    const res = await request(app)
      .post('/api/oauth/revoke')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(googleAuth.revokeToken).toHaveBeenCalledWith('rt-xxx');
  });

  test('200 tolerated even if user has no refresh token (idempotent sign-out)', async () => {
    firestore.getUser.mockResolvedValue({
      email: 'user@acme.com', domain: 'acme.com',
    });
    const res = await request(app)
      .post('/api/oauth/revoke')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(googleAuth.revokeToken).not.toHaveBeenCalled();
  });
});

describe('POST /api/oauth/delete-account', () => {
  test('401 without Bearer header', async () => {
    const res = await request(app).post('/api/oauth/delete-account');
    expect(res.status).toBe(401);
    expect(firestore.deleteUser).not.toHaveBeenCalled();
  });

  test('revokes the token and cascades the delete for the authenticated user', async () => {
    firestore.getUser.mockResolvedValue({ email: 'gone@acme.com', domain: 'acme.com', refreshToken: 'rt-1' });
    googleAuth.revokeToken.mockResolvedValue(undefined);
    firestore.deleteUser.mockResolvedValue(undefined);
    const res = await request(app)
      .post('/api/oauth/delete-account')
      .set(authedHeader('gone@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(googleAuth.revokeToken).toHaveBeenCalledWith('rt-1');
    expect(firestore.deleteUser).toHaveBeenCalledWith('acme.com', 'gone@acme.com');
  });

  test('acts on the JWT identity, never an email in the body', async () => {
    firestore.getUser.mockResolvedValue({ email: 'me@acme.com', domain: 'acme.com' });
    firestore.deleteUser.mockResolvedValue(undefined);
    const res = await request(app)
      .post('/api/oauth/delete-account')
      .set(authedHeader('me@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send({ email: 'victim@acme.com' }); // attempt to delete someone else
    expect(res.status).toBe(200);
    expect(firestore.deleteUser).toHaveBeenCalledWith('acme.com', 'me@acme.com');
    expect(firestore.deleteUser).not.toHaveBeenCalledWith('acme.com', 'victim@acme.com');
  });

  test('still deletes even if token revoke fails (best-effort revoke)', async () => {
    firestore.getUser.mockResolvedValue({ email: 'gone@acme.com', domain: 'acme.com', refreshToken: 'rt-1' });
    googleAuth.revokeToken.mockRejectedValue(new Error('google down'));
    firestore.deleteUser.mockResolvedValue(undefined);
    const res = await request(app)
      .post('/api/oauth/delete-account')
      .set(authedHeader('gone@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(firestore.deleteUser).toHaveBeenCalledWith('acme.com', 'gone@acme.com');
  });
});

describe('POST /api/oauth/exchange — acquisition + scopes + webhook', () => {
  const jwt = require('jsonwebtoken');
  const CONFIG = require('../../src/config');

  function exchangeTokens(scope) {
    googleAuth.exchangeCode.mockResolvedValue({ id_token: 'x', access_token: 'a', refresh_token: 'r', expiry_date: Date.now() + 3600000, scope });
  }
  const FULL = 'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/meetings.space.readonly https://www.googleapis.com/auth/calendar.events.readonly';

  test('warns + reports missingScopes when the user unchecks a scope', async () => {
    exchangeTokens('openid email profile'); // no drive/meet/calendar
    firestore.getUser.mockResolvedValue(null);
    firestore.countAllUsers.mockResolvedValue(1);
    const res = await request(app).post('/api/oauth/exchange').send({ code: 'c' });
    expect(res.status).toBe(200);
    expect(res.body.missingScopes.length).toBeGreaterThan(0);
  });

  test('sanitizes a full acquisition payload and derives detectedSource from an explicit source', async () => {
    exchangeTokens(FULL);
    firestore.getUser.mockResolvedValue(null);
    firestore.countAllUsers.mockResolvedValue(5);
    const res = await request(app).post('/api/oauth/exchange').send({
      code: 'c',
      acquisition: { source: 'reddit', utmSource: 'r', utmMedium: 'm', utmCampaign: 'c', referrer: 'https://news.ycombinator.com/x', landingUrl: 'https://attendancetracker.dev/?utm_source=r', userAgent: 'Mozilla/5.0' },
    });
    expect(res.body.detectedSource).toBe('reddit');
    expect(firestore.upsertUser).toHaveBeenCalledWith('acme.com', expect.objectContaining({ acquisition: expect.objectContaining({ source: 'reddit' }) }));
  });

  test('derives detectedSource from referrer hostname when no source/ref/utm', async () => {
    exchangeTokens(FULL);
    firestore.getUser.mockResolvedValue(null);
    firestore.countAllUsers.mockResolvedValue(5);
    const res = await request(app).post('/api/oauth/exchange').send({ code: 'c', acquisition: { referrer: 'https://www.google.com/search' } });
    expect(res.body.detectedSource).toBe('ref:www.google.com');
  });

  test('falls back to "direct" when only a userAgent is known', async () => {
    exchangeTokens(FULL);
    firestore.getUser.mockResolvedValue(null);
    firestore.countAllUsers.mockResolvedValue(5);
    const res = await request(app).post('/api/oauth/exchange').send({ code: 'c', acquisition: { userAgent: 'Mozilla/5.0' } });
    expect(res.body.detectedSource).toBe('direct');
  });

  test('ignores a malformed referrer URL', async () => {
    exchangeTokens(FULL);
    firestore.getUser.mockResolvedValue(null);
    firestore.countAllUsers.mockResolvedValue(5);
    const res = await request(app).post('/api/oauth/exchange').send({ code: 'c', acquisition: { referrer: 'not a url', userAgent: 'UA' } });
    expect(res.body.detectedSource).toBe('direct');
  });

  test('an existing user with an acquisitionSource skips the modal + deferred signup notification', async () => {
    exchangeTokens(FULL);
    firestore.getUser.mockResolvedValue({ email: 'newuser@acme.com', acquisitionSource: 'reddit' });
    const res = await request(app).post('/api/oauth/exchange').send({ code: 'c' });
    expect(res.body.isNewUser).toBe(false);
    expect(res.body.needsAcquisitionSource).toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(notifications.maybeSendSignupNotification).not.toHaveBeenCalled();
  });

  test('brand-new user: seeds the deferred signup notification (detected source) + grace-timer flush', async () => {
    process.env.SIGNUP_NOTIFY_GRACE_MS = '5'; // short fallback window so the timer fires in-test
    exchangeTokens(FULL);
    firestore.getUser.mockResolvedValue(null);
    await request(app).post('/api/oauth/exchange').send({ code: 'c', acquisition: { userAgent: 'UA' } });
    // The detected source is stamped on the new user doc for the deferred ping.
    expect(firestore.upsertUser).toHaveBeenCalledWith('acme.com', expect.objectContaining({ signupDetectedSource: 'direct' }));
    // The fallback grace timer flushes the notification (no webhook fired inline).
    await new Promise((r) => setTimeout(r, 40));
    expect(notifications.maybeSendSignupNotification).toHaveBeenCalledWith('acme.com', 'newuser@acme.com');
    expect(notifications.sendSignupWebhook).not.toHaveBeenCalled();
    delete process.env.SIGNUP_NOTIFY_GRACE_MS;
  });
});

const notifications = require('../../src/lib/notifications');

describe('oauth account routes — error mapping', () => {
  const jwt = require('jsonwebtoken');
  const CONFIG = require('../../src/config');
  const valid = () => 'Bearer ' + jwt.sign({ email: 'u@acme.com', domain: 'acme.com' }, CONFIG.sessionSecret);

  test('GET /me 500 when the activation read throws', async () => {
    firestore.getUserActivationStatus.mockRejectedValue(new Error('boom'));
    firestore.getUser.mockResolvedValue({});
    const res = await request(app).get('/api/oauth/me').set('Authorization', valid());
    expect(res.status).toBe(500);
  });

  test('POST /revoke 500 when the user lookup throws', async () => {
    firestore.getUser.mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/api/oauth/revoke').set('Authorization', valid());
    expect(res.status).toBe(500);
  });

  test('POST /delete-account 401 Session expired on an expired token', async () => {
    const expired = 'Bearer ' + jwt.sign({ email: 'u@acme.com', domain: 'acme.com' }, CONFIG.sessionSecret, { expiresIn: -10 });
    const res = await request(app).post('/api/oauth/delete-account').set('Authorization', expired);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/expired/i);
  });

  test('POST /delete-account 401 Invalid token on a malformed token', async () => {
    const res = await request(app).post('/api/oauth/delete-account').set('Authorization', 'Bearer garbage');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid/i);
  });
});

describe('oauth exchange — residual acquisition/scope/error branches', () => {
  const FULL = 'openid email profile https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/meetings.space.readonly https://www.googleapis.com/auth/calendar.events.readonly';
  function tok(scope) { googleAuth.exchangeCode.mockResolvedValue({ id_token: 'x', access_token: 'a', refresh_token: 'r', expiry_date: Date.now() + 3600000, scope }); }

  test('personal (no-hd) account derives domain from the email', async () => {
    mockPayload = { email: 'me@gmail.com', name: 'Me' }; // no hd
    tok(FULL);
    firestore.getUser.mockResolvedValue(null); firestore.countAllUsers.mockResolvedValue(1);
    await request(app).post('/api/oauth/exchange').send({ code: 'c' });
    expect(firestore.upsertUser).toHaveBeenCalledWith('gmail.com', expect.anything());
  });

  test('detectedSource = invite:<ref> when only a ref is present', async () => {
    tok(FULL);
    firestore.getUser.mockResolvedValue(null); firestore.countAllUsers.mockResolvedValue(1);
    const res = await request(app).post('/api/oauth/exchange').send({ code: 'c', acquisition: { ref: 'friend@x.com' } });
    expect(res.body.detectedSource).toBe('invite:friend@x.com');
  });

  test('detectedSource = utm:<source> when only a utmSource is present', async () => {
    tok(FULL);
    firestore.getUser.mockResolvedValue(null); firestore.countAllUsers.mockResolvedValue(1);
    const res = await request(app).post('/api/oauth/exchange').send({ code: 'c', acquisition: { utmSource: 'reddit' } });
    expect(res.body.detectedSource).toBe('utm:reddit');
  });

  test('drops a non-email ref value', async () => {
    tok(FULL);
    firestore.getUser.mockResolvedValue(null); firestore.countAllUsers.mockResolvedValue(1);
    const res = await request(app).post('/api/oauth/exchange').send({ code: 'c', acquisition: { ref: 'not-an-email', userAgent: 'UA' } });
    expect(res.body.detectedSource).toBe('direct'); // ref rejected → falls through
  });

  test('existing user WITHOUT a source but with a UTM captures from UTM (no modal)', async () => {
    tok(FULL);
    firestore.getUser.mockResolvedValue({ email: 'newuser@acme.com' }); // exists, no acquisitionSource
    const res = await request(app).post('/api/oauth/exchange').send({ code: 'c', acquisition: { utmSource: 'reddit' } });
    expect(res.body.needsAcquisitionSource).toBe(false);
  });

  test('delete-account 500 on an unexpected (non-token) failure', async () => {
    const jwt = require('jsonwebtoken');
    const CONFIG = require('../../src/config');
    firestore.deleteUser.mockRejectedValue(new Error('cascade boom'));
    firestore.getUser.mockResolvedValue({ refreshToken: null });
    const token = 'Bearer ' + jwt.sign({ email: 'u@acme.com', domain: 'acme.com' }, CONFIG.sessionSecret);
    const res = await request(app).post('/api/oauth/delete-account').set('Authorization', token);
    expect(res.status).toBe(500);
  });
});

describe('oauth exchange — optional-field fallbacks', () => {
  test('minimal tokens (no scope/refresh/access) + payload without a name', async () => {
    mockPayload = { email: 'min@acme.com' }; // no hd, no name
    googleAuth.exchangeCode.mockResolvedValue({ id_token: 'x' }); // no scope/access/refresh/expiry
    firestore.getUser.mockResolvedValue(null); firestore.countAllUsers.mockResolvedValue(1);
    const res = await request(app).post('/api/oauth/exchange').send({ code: 'c' });
    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe('min@acme.com'); // name fell back to email
    expect(firestore.updateUserTokens).not.toHaveBeenCalled(); // no access_token
  });

  test('access token without an expiry_date uses a 1h default', async () => {
    googleAuth.exchangeCode.mockResolvedValue({ id_token: 'x', access_token: 'a' }); // no expiry_date
    firestore.getUser.mockResolvedValue(null); firestore.countAllUsers.mockResolvedValue(1);
    const res = await request(app).post('/api/oauth/exchange').send({ code: 'c' });
    expect(res.status).toBe(200);
    expect(firestore.updateUserTokens).toHaveBeenCalled();
  });
});

describe('oauth decodeSession — domain from email', () => {
  test('GET /me derives domain from email when the token omits it', async () => {
    const jwt = require('jsonwebtoken');
    const CONFIG = require('../../src/config');
    const token = 'Bearer ' + jwt.sign({ email: 'nodomain@acme.com' }, CONFIG.sessionSecret);
    firestore.getUser.mockResolvedValue({});
    firestore.getUserActivationStatus.mockResolvedValue({});
    const res = await request(app).get('/api/oauth/me').set('Authorization', token);
    expect(res.status).toBe(200);
    expect(res.body.domain).toBe('acme.com');
  });
});
