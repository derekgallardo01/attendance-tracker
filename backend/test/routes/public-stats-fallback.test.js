// The public-stats endpoint memoizes its result in a module-level cache, which
// short-circuits before the try/catch once populated. To exercise the failure
// fallback (uncached + query throws → zero state) we need a fresh module with an
// empty cache, so this lives in its own file.

const request = require('supertest');
const { buildApp } = require('../helpers/testApp');

jest.mock('../../src/services/firestore', () => ({
  getDb: jest.fn(() => { throw new Error('firestore down'); }),
  resolveShareLink: jest.fn(),
  getSharedSeriesView: jest.fn(),
  suppressEmail: jest.fn(),
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
}));

test('GET /api/public/stats returns a zero state when uncached and the read fails', async () => {
  const app = buildApp();
  const res = await request(app).get('/api/public/stats');
  expect(res.status).toBe(200);
  expect(res.body).toEqual(expect.objectContaining({ organizations: 0, meetings: 0 }));
});
