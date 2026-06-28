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
}));
jest.mock('../../src/services/googleAuth', () => ({
  exchangeCode: jest.fn(),
  revokeToken: jest.fn(),
}));
jest.mock('../../src/lib/notifications', () => ({
  sendSignupWebhook: jest.fn(),
}));
// google.auth.OAuth2 verifyIdToken is invoked inside exchange — mock it
jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        verifyIdToken: jest.fn().mockResolvedValue({
          getPayload: () => ({
            email: 'newuser@acme.com',
            hd: 'acme.com',
            name: 'New User',
          }),
        }),
      })),
    },
  },
}));

const firestore = require('../../src/services/firestore');
const googleAuth = require('../../src/services/googleAuth');

let app;

beforeEach(() => {
  jest.clearAllMocks();
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
