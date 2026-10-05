const request = require('supertest');
const express = require('express');
const requestId = require('../../src/middleware/requestId');

describe('requestId middleware integration', () => {
  let app;
  beforeEach(() => {
    app = express();
    app.use(requestId);
    app.get('/test-id', (req, res) => res.json({ id: req.id }));
  });

  test('attaches X-Request-Id header to HTTP responses', async () => {
    const res = await request(app).get('/test-id');
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe(res.body.id);
  });

  test('propagates existing incoming X-Request-Id header', async () => {
    const res = await request(app)
      .get('/test-id')
      .set('X-Request-Id', 'incoming-trace-abc');
    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe('incoming-trace-abc');
    expect(res.body.id).toBe('incoming-trace-abc');
  });
});
