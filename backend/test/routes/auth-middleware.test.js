// Direct unit tests for the auth middleware — the token-refresh + error paths
// that route integration tests don't exercise (they use freshly-minted, non-
// expiring tokens for users without refresh tokens). Mock firestore + googleAuth
// so we control the user record and the refresh outcome.

const jwt = require('jsonwebtoken');
const CONFIG = require('../../src/config');

jest.mock('../../src/services/firestore', () => ({
  getUser: jest.fn(),
  updateUserTokens: jest.fn().mockResolvedValue(),
}));
jest.mock('../../src/services/googleAuth', () => ({
  refreshAccessToken: jest.fn(),
}));

const firestore = require('../../src/services/firestore');
const googleAuth = require('../../src/services/googleAuth');
const auth = require('../../src/middleware/auth');

function tokenFor(claims) { return 'Bearer ' + jwt.sign(claims, CONFIG.sessionSecret); }
function runAuth(authorization) {
  const req = { headers: authorization ? { authorization } : {} };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  return auth(req, res, next).then(() => ({ req, res, next }));
}

afterEach(() => jest.clearAllMocks());

test('no Authorization header → req.user = null, next()', async () => {
  const { req, next } = await runAuth(undefined);
  expect(req.user).toBeNull();
  expect(next).toHaveBeenCalled();
});

test('derives domain from the email when the token omits domain', async () => {
  firestore.getUser.mockResolvedValue(null);
  const { req, next } = await runAuth(tokenFor({ email: 'x@derived.com' }));
  expect(firestore.getUser).toHaveBeenCalledWith('derived.com', 'x@derived.com');
  expect(req.user.accessToken).toBeNull();
  expect(next).toHaveBeenCalled();
});

test('user without refreshToken → attaches user with null accessToken', async () => {
  firestore.getUser.mockResolvedValue({ email: 'u@acme.com' });
  const { req } = await runAuth(tokenFor({ email: 'u@acme.com', domain: 'acme.com' }));
  expect(req.user.accessToken).toBeNull();
});

test('refreshes when the stored access token is stale, storing the new one', async () => {
  firestore.getUser.mockResolvedValue({ refreshToken: 'rt', accessToken: null, tokenExpiresAt: new Date(Date.now() - 1000) });
  googleAuth.refreshAccessToken.mockResolvedValue({ access_token: 'fresh', expiry_date: Date.now() + 3600000 });
  const { req } = await runAuth(tokenFor({ email: 'u@acme.com', domain: 'acme.com' }));
  expect(googleAuth.refreshAccessToken).toHaveBeenCalledWith('rt');
  expect(firestore.updateUserTokens).toHaveBeenCalled();
  expect(req.user.accessToken).toBe('fresh');
});

test('refresh with no expiry_date falls back to a 1h expiry', async () => {
  firestore.getUser.mockResolvedValue({ refreshToken: 'rt' });
  googleAuth.refreshAccessToken.mockResolvedValue({ access_token: 'fresh' }); // no expiry_date
  const { req } = await runAuth(tokenFor({ email: 'u@acme.com', domain: 'acme.com' }));
  expect(req.user.accessToken).toBe('fresh');
  const { tokenExpiresAt } = firestore.updateUserTokens.mock.calls[0][2];
  expect(tokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
});

test('keeps the existing token when it is still valid (no refresh)', async () => {
  const future = { toDate: () => new Date(Date.now() + 3600000) };
  firestore.getUser.mockResolvedValue({ refreshToken: 'rt', accessToken: 'still-good', tokenExpiresAt: future });
  const { req } = await runAuth(tokenFor({ email: 'u@acme.com', domain: 'acme.com' }));
  expect(googleAuth.refreshAccessToken).not.toHaveBeenCalled();
  expect(req.user.accessToken).toBe('still-good');
});

test('continues without a token when the refresh call fails', async () => {
  firestore.getUser.mockResolvedValue({ refreshToken: 'rt' });
  googleAuth.refreshAccessToken.mockRejectedValue(new Error('google down'));
  const { req } = await runAuth(tokenFor({ email: 'u@acme.com', domain: 'acme.com' }));
  expect(req.user.accessToken).toBeNull();
});

test('expired session token → 401 Session expired', async () => {
  const expired = 'Bearer ' + jwt.sign({ email: 'u@acme.com', domain: 'acme.com' }, CONFIG.sessionSecret, { expiresIn: -10 });
  const { res } = await runAuth(expired);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith({ error: 'Session expired' });
});

test('malformed token → 401 Authentication failed', async () => {
  const { res } = await runAuth('Bearer not-a-real-jwt');
  expect(res.status).toHaveBeenCalledWith(401);
  expect(res.json).toHaveBeenCalledWith({ error: 'Authentication failed' });
});
