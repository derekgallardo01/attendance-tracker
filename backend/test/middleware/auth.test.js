// Unit tests for attendee role path normalization in auth middleware.

const jwt = require('jsonwebtoken');
const CONFIG = require('../../src/config');
const auth = require('../../src/middleware/auth');

jest.mock('../../src/services/firestore', () => ({
  getUser: jest.fn().mockResolvedValue(null),
  updateUserTokens: jest.fn().mockResolvedValue(),
  setUserLanguage: jest.fn().mockResolvedValue(),
}));
const firestore = require('../../src/services/firestore');

describe('auth middleware — request language', () => {
  const token = 'Bearer ' + jwt.sign({ email: 't@school.edu', domain: 'school.edu' }, CONFIG.sessionSecret);
  const run = async (headers, user) => {
    firestore.getUser.mockResolvedValueOnce(user);
    const req = { path: '/settings', headers: { authorization: token, ...headers } };
    await auth(req, { status: jest.fn().mockReturnThis(), json: jest.fn() }, jest.fn());
    return req;
  };
  beforeEach(() => firestore.setUserLanguage.mockClear());

  test('X-App-Locale wins and is persisted when it differs from the stored language', async () => {
    const req = await run({ 'x-app-locale': 'pt-BR' }, { language: 'es' });
    expect(req.user.language).toBe('pt');
    expect(firestore.setUserLanguage).toHaveBeenCalledWith('school.edu', 't@school.edu', 'pt');
  });

  test('unchanged language is not re-written; legacy tags are normalized', async () => {
    const req = await run({ 'x-app-locale': 'fil' }, { language: 'tl' });
    expect(req.user.language).toBe('tl');
    expect(firestore.setUserLanguage).not.toHaveBeenCalled();
  });

  test('falls back to stored language, then Accept-Language, then signup country', async () => {
    expect((await run({}, { language: 'de' })).user.language).toBe('de');
    expect((await run({ 'accept-language': 'ja-JP,ja;q=0.9' }, {})).user.language).toBe('ja');
    expect((await run({}, { signupGeo: { country: 'BR' } })).user.language).toBe('pt');
    expect((await run({ 'x-app-locale': 'klingon' }, null)).user.language).toBe('en');
    expect(firestore.setUserLanguage).not.toHaveBeenCalled(); // no user doc → nothing to persist
  });
});

describe('auth middleware — attendee role trailing slash', () => {
  function tokenFor(claims) {
    return 'Bearer ' + jwt.sign(claims, CONFIG.sessionSecret);
  }

  test('allows attendee session on /checkin/ with trailing slash', async () => {
    for (const path of ['/checkin', '/checkin/', '/checkin///']) {
      const req = {
        path,
        headers: { authorization: tokenFor({ email: 'student@school.edu', domain: 'school.edu', role: 'attendee' }) },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      const next = jest.fn();

      await auth(req, res, next);
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalledWith(403);
    }
  });

  test('blocks attendee session on non-checkin paths even with trailing slashes', async () => {
    for (const path of ['/checkins', '/checkins/', '/events', '/settings']) {
      const req = {
        path,
        headers: { authorization: tokenFor({ email: 'student@school.edu', domain: 'school.edu', role: 'attendee' }) },
      };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
      const next = jest.fn();

      await auth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'This session only supports meeting check-in.' });
      expect(next).not.toHaveBeenCalled();
    }
  });
});
