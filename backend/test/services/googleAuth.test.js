// Tests for googleAuth.js — the auth surface that gates every Meet-API and
// user-token operation in the app. Zero direct coverage previously; this file
// closes that gap by mocking googleapis + Secret Manager and asserting the
// caching + fallback semantics.
//
// Module scope caches (serviceAccountKey, oauthClientSecret) persist for
// 24h — we work with that by asserting cache-hit paths after warm-up rather
// than trying to bust it. jest.clearAllMocks() resets call counts between
// tests but the mocked return values (set at jest.mock time) stay live.

// ── Mock googleapis: JWT + OAuth2 with per-instance jest fns ──
const mockJwtInstance = {
  authorize: jest.fn().mockResolvedValue({ access_token: 'fake-meet-token-xyz' }),
};
const mockOAuthInstance = {
  setCredentials: jest.fn(),
  refreshAccessToken: jest.fn(),
  revokeToken: jest.fn(),
  getToken: jest.fn(),
  redirectUri: null,
};

jest.mock('googleapis', () => ({
  google: {
    auth: {
      JWT: jest.fn().mockImplementation(() => mockJwtInstance),
      OAuth2: jest.fn().mockImplementation(() => mockOAuthInstance),
    },
  },
}));

// ── Mock Secret Manager: return fake service-account JSON + client secret ──
const FAKE_SA_KEY = {
  client_email: 'sa@attendance-tracker-490319.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----',
};

const mockAccessSecret = jest.fn();

jest.mock('@google-cloud/secret-manager', () => ({
  SecretManagerServiceClient: jest.fn().mockImplementation(() => ({
    accessSecretVersion: mockAccessSecret,
  })),
}));

// Both `google` and `googleAuth` must be re-required after resetModules so
// the JWT/OAuth2 spy references stay live with the module under test.
let google;
let googleAuth;

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();

  // Provide the default secret-manager response. accessSecretVersion returns
  // an array with [version] destructured at the callsite.
  mockAccessSecret.mockImplementation(async ({ name }) => {
    if (name.includes('oauth-client-secret') || name === 'test-oauth-secret/versions/latest') {
      return [{ payload: { data: Buffer.from('super-secret-client-secret') } }];
    }
    return [{ payload: { data: Buffer.from(JSON.stringify(FAKE_SA_KEY)) } }];
  });

  google = require('googleapis').google;
  googleAuth = require('../../src/services/googleAuth');
});

describe('loadServiceAccountKey', () => {
  test('loads and parses the SA JSON from Secret Manager', async () => {
    const key = await googleAuth.loadServiceAccountKey();
    expect(key.client_email).toBe(FAKE_SA_KEY.client_email);
    expect(mockAccessSecret).toHaveBeenCalledTimes(1);
  });

  test('caches the loaded key — second call does NOT re-hit Secret Manager', async () => {
    await googleAuth.loadServiceAccountKey();
    await googleAuth.loadServiceAccountKey();
    await googleAuth.loadServiceAccountKey();
    expect(mockAccessSecret).toHaveBeenCalledTimes(1);
  });
});

describe('makeJWT', () => {
  test('constructs a JWT with the expected scopes + impersonation subject', async () => {
    await googleAuth.makeJWT(['https://foo/scope'], 'admin@company.com');
    expect(google.auth.JWT).toHaveBeenCalledWith(expect.objectContaining({
      email: FAKE_SA_KEY.client_email,
      key: FAKE_SA_KEY.private_key,
      scopes: ['https://foo/scope'],
      subject: 'admin@company.com',
    }));
    expect(mockJwtInstance.authorize).toHaveBeenCalledTimes(1);
  });

  test('falls back to CONFIG.impersonateEmail when caller passes no subject', async () => {
    // config.js reads process.env.IMPERSONATE_EMAIL, which is unset in tests
    // → CONFIG.impersonateEmail is undefined. Assert we pass undefined
    // through faithfully rather than throwing.
    await googleAuth.makeJWT(['https://foo/scope']);
    const args = google.auth.JWT.mock.calls[0][0];
    // In tests IMPERSONATE_EMAIL is unset → CONFIG.impersonateEmail is null.
    // makeJWT should pass that through, not throw.
    expect(args.subject).toBeFalsy();
  });

  test('propagates authorize() rejection (delegation-not-configured signal)', async () => {
    mockJwtInstance.authorize.mockRejectedValueOnce(new Error('invalid_grant'));
    await expect(googleAuth.makeJWT(['s'], 'admin@x.com')).rejects.toThrow('invalid_grant');
  });
});

describe('getMeetToken', () => {
  test('returns the access_token from the impersonation JWT', async () => {
    const token = await googleAuth.getMeetToken('admin@company.com');
    expect(token).toBe('fake-meet-token-xyz');
    // authorize is called twice per getMeetToken (once inside makeJWT, once
    // to get tokens) — that's the current implementation.
    expect(mockJwtInstance.authorize).toHaveBeenCalledTimes(2);
    // Scope must be meetings.space.readonly
    expect(google.auth.JWT).toHaveBeenCalledWith(expect.objectContaining({
      scopes: ['https://www.googleapis.com/auth/meetings.space.readonly'],
      subject: 'admin@company.com',
    }));
  });

  test('rejects when Google returns a delegation error', async () => {
    mockJwtInstance.authorize.mockRejectedValueOnce(new Error('unauthorized_client'));
    await expect(googleAuth.getMeetToken('admin@nope.com')).rejects.toThrow('unauthorized_client');
  });
});

describe('exchangeCode', () => {
  test('exchanges a code and returns tokens; sets postmessage redirect', async () => {
    mockOAuthInstance.getToken.mockResolvedValueOnce({
      tokens: {
        access_token: 'a',
        refresh_token: 'r',
        expiry_date: 12345,
      },
    });
    const tokens = await googleAuth.exchangeCode('good-code');
    expect(tokens).toEqual(expect.objectContaining({
      access_token: 'a',
      refresh_token: 'r',
    }));
    // redirectUri must be 'postmessage' for GIS popup mode
    expect(mockOAuthInstance.redirectUri).toBe('postmessage');
    expect(mockOAuthInstance.getToken).toHaveBeenCalledWith('good-code');
  });

  test('propagates invalid-code error from Google', async () => {
    mockOAuthInstance.getToken.mockRejectedValueOnce(new Error('invalid_grant'));
    await expect(googleAuth.exchangeCode('bad')).rejects.toThrow('invalid_grant');
  });
});

describe('refreshAccessToken', () => {
  test('returns fresh credentials from refreshAccessToken()', async () => {
    mockOAuthInstance.refreshAccessToken.mockResolvedValueOnce({
      credentials: { access_token: 'new-access', expiry_date: 999 },
    });
    const creds = await googleAuth.refreshAccessToken('refresh-abc');
    expect(creds).toEqual({ access_token: 'new-access', expiry_date: 999 });
    expect(mockOAuthInstance.setCredentials).toHaveBeenCalledWith({ refresh_token: 'refresh-abc' });
    expect(mockOAuthInstance.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  test('rejects when Google returns invalid_grant (expired/revoked refresh)', async () => {
    mockOAuthInstance.refreshAccessToken.mockRejectedValueOnce(new Error('invalid_grant'));
    await expect(googleAuth.refreshAccessToken('rt')).rejects.toThrow('invalid_grant');
  });
});

describe('makeUserClient', () => {
  test('returns an OAuth2 client with only the access_token set', () => {
    const client = googleAuth.makeUserClient('user-access-abc');
    // Confirm setCredentials was called with the access_token only (no refresh)
    expect(mockOAuthInstance.setCredentials).toHaveBeenCalledWith({ access_token: 'user-access-abc' });
    expect(client).toBe(mockOAuthInstance);
  });
});

describe('revokeToken', () => {
  test('calls revokeToken on the OAuth2 client', async () => {
    mockOAuthInstance.revokeToken.mockResolvedValueOnce(undefined);
    await googleAuth.revokeToken('rt-xyz');
    expect(mockOAuthInstance.revokeToken).toHaveBeenCalledWith('rt-xyz');
  });

  test('swallows errors when Google returns 400 (token already invalid)', async () => {
    mockOAuthInstance.revokeToken.mockRejectedValueOnce(new Error('Token expired or revoked'));
    // Must NOT throw — sign-out should stay idempotent
    await expect(googleAuth.revokeToken('rt-xyz')).resolves.toBeUndefined();
  });
});
