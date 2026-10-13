// Unit tests for attendee role path normalization in auth middleware.

const jwt = require('jsonwebtoken');
const CONFIG = require('../../src/config');
const auth = require('../../src/middleware/auth');

jest.mock('../../src/services/firestore', () => ({
  getUser: jest.fn().mockResolvedValue(null),
  updateUserTokens: jest.fn().mockResolvedValue(),
}));

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
