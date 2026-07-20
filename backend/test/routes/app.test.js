// Smoke test for the assembled Express app. Route behaviour is covered by the
// per-route suites; this just exercises app.js's own wiring — the /health
// endpoint — against the real app instance.

const request = require('supertest');
const app = require('../../src/app');

test('GET /health returns { status: "ok" }', async () => {
  const res = await request(app).get('/health');
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ status: 'ok' });
});
