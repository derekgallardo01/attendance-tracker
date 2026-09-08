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

describe('global error handler — never leaks stack traces', () => {
  test('malformed JSON body → clean 400 JSON, no stack trace / file paths', async () => {
    const res = await request(app)
      .post('/api/export/pdf')
      .set('Content-Type', 'application/json')
      .send('{"conferenceId": '); // truncated → body-parser SyntaxError
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid JSON body.' });
    // The old default handler dumped an HTML page with /app/node_modules paths.
    expect(res.text).not.toMatch(/node_modules|SyntaxError|at Object|\/app\//);
  });

  test('oversized JSON body → 413 JSON, not a stack trace', async () => {
    const huge = JSON.stringify({ blob: 'x'.repeat(150 * 1024) }); // > 100kb limit
    const res = await request(app)
      .post('/api/export/pdf')
      .set('Content-Type', 'application/json')
      .send(huge);
    expect(res.status).toBe(413);
    expect(res.body).toEqual({ error: 'Request body too large.' });
    expect(res.text).not.toMatch(/node_modules|\/app\//);
  });

  test('other body-parser errors (unsupported charset) → generic JSON error, no stack', async () => {
    // Hits the generic tail of the handler: preserves the error status but
    // returns a generic message rather than Express\'s default stack dump.
    const res = await request(app)
      .post('/api/export/pdf')
      .set('Content-Type', 'application/json; charset=foo-bar')
      .send('{"a":1}');
    expect(res.status).toBe(415);
    expect(res.body).toEqual({ error: 'Internal server error.' });
    expect(res.text).not.toMatch(/node_modules|SyntaxError|\/app\//);
  });
});
