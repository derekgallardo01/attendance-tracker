// Tests for /api/history, /api/series, /api/participant*, /api/event, /api/share.
// Most of these just verify auth + plumbing — the heavy logic is unit-tested.

const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

jest.mock('../../src/services/firestore', () => ({
  getUserMeetingHistory: jest.fn(),
  getUserMeetingSeries: jest.fn(),
  getParticipantHistory: jest.fn(),
  setParticipantNote: jest.fn(),
  getParticipantNote: jest.fn(),
  logEvent: jest.fn(),
  createShareLink: jest.fn(),
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
}));

const firestore = require('../../src/services/firestore');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  firestore.getUser.mockImplementation(async (domain, email) => ({ email, domain }));
  app = buildApp();
});

describe('GET /api/history', () => {
  test('401 without auth', async () => {
    const res = await request(app).get('/api/history');
    expect(res.status).toBe(401);
  });

  test('200 with user-scoped data', async () => {
    firestore.getUserMeetingHistory.mockResolvedValue({
      meetings: [], people: [], calendar: [], totalMeetings: 0,
    });
    const res = await request(app)
      .get('/api/history')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(firestore.getUserMeetingHistory).toHaveBeenCalledWith('acme.com', 'user@acme.com');
  });

  test('500 when getUserMeetingHistory throws', async () => {
    firestore.getUserMeetingHistory.mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .get('/api/history')
      .set(authedHeader('u@a.com', 'a.com'));
    expect(res.status).toBe(500);
  });
});

describe('GET /api/series', () => {
  test('401 without auth', async () => {
    const res = await request(app).get('/api/series');
    expect(res.status).toBe(401);
  });

  test('200 with series data', async () => {
    firestore.getUserMeetingSeries.mockResolvedValue({ series: [], totalSeries: 0 });
    const res = await request(app)
      .get('/api/series')
      .set(authedHeader('u@a.com', 'a.com'));
    expect(res.status).toBe(200);
    expect(firestore.getUserMeetingSeries).toHaveBeenCalledWith('a.com', 'u@a.com');
  });
});

describe('GET /api/participant', () => {
  test('400 when key is missing', async () => {
    const res = await request(app)
      .get('/api/participant')
      .set(authedHeader('u@a.com', 'a.com'));
    expect(res.status).toBe(400);
  });

  test('404 when participant not found', async () => {
    firestore.getParticipantHistory.mockResolvedValue(null);
    firestore.getParticipantNote.mockResolvedValue('');
    const res = await request(app)
      .get('/api/participant?key=alex@acme.com')
      .set(authedHeader('u@a.com', 'a.com'));
    expect(res.status).toBe(404);
  });

  test('200 with participant history + note', async () => {
    firestore.getParticipantHistory.mockResolvedValue({
      displayName: 'Alex', meetings: [], totalMeetings: 5,
    });
    firestore.getParticipantNote.mockResolvedValue('Met at conf');
    const res = await request(app)
      .get('/api/participant?key=alex@acme.com')
      .set(authedHeader('u@a.com', 'a.com'));
    expect(res.status).toBe(200);
    expect(res.body.note).toBe('Met at conf');
  });
});

describe('PUT /api/participant/note', () => {
  test('401 without auth', async () => {
    const res = await request(app).put('/api/participant/note').send({ key: 'a', body: 'x' });
    expect(res.status).toBe(401);
  });

  test('400 when key is missing', async () => {
    const res = await request(app)
      .put('/api/participant/note')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ body: 'x' });
    expect(res.status).toBe(400);
  });

  test('200 when note saved', async () => {
    firestore.setParticipantNote.mockResolvedValue({ saved: true });
    const res = await request(app)
      .put('/api/participant/note')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ key: 'alex@acme.com', body: 'Met at conf' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/event — frontend event logging', () => {
  test('401 without auth', async () => {
    const res = await request(app).post('/api/event').send({ type: 'export_clicked' });
    expect(res.status).toBe(401);
  });

  test('400 for event type not on the allow-list', async () => {
    const res = await request(app)
      .post('/api/event')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ type: 'arbitrary_event_name' });
    expect(res.status).toBe(400);
  });

  test.each(['export_clicked', 'export_failed', 'export_cancelled', 'export_skipped'])(
    'accepts allow-listed event type: %s',
    async (type) => {
      firestore.logEvent.mockResolvedValue(undefined);
      const res = await request(app)
        .post('/api/event')
        .set(authedHeader('u@a.com', 'a.com'))
        .set('Content-Type', 'application/json')
        .send({ type, meta: { participantCount: 5 } });
      expect(res.status).toBe(200);
      expect(firestore.logEvent).toHaveBeenCalledWith('a.com', expect.objectContaining({
        type, email: 'u@a.com',
      }));
    }
  );

  test('caps meta values + sanitizes non-primitives', async () => {
    firestore.logEvent.mockResolvedValue(undefined);
    const giant = 'x'.repeat(2000);
    await request(app)
      .post('/api/event')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ type: 'export_failed', meta: { reason: giant, n: 3, ok: true } });
    const callArg = firestore.logEvent.mock.calls[0][1];
    expect(callArg.meta.reason.length).toBeLessThanOrEqual(500);
    expect(callArg.meta.n).toBe(3);
    expect(callArg.meta.ok).toBe(true);
  });
});

describe('POST /api/share — mint share link', () => {
  test('401 without auth', async () => {
    const res = await request(app).post('/api/share').send({ recurringEventId: 'series-x' });
    expect(res.status).toBe(401);
  });

  test('400 when recurringEventId is missing', async () => {
    const res = await request(app)
      .post('/api/share')
      .set(authedHeader('u@a.com', 'a.com'))
      .set('Content-Type', 'application/json')
      .send({ type: 'series' });
    expect(res.status).toBe(400);
  });

  test('200 returns url + token + expiresAt', async () => {
    firestore.createShareLink.mockResolvedValue({
      token: 'abc123', expiresAt: '2026-08-01T00:00:00Z',
    });
    const res = await request(app)
      .post('/api/share')
      .set(authedHeader('admin@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send({ recurringEventId: 'series-x', type: 'series' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe('abc123');
    expect(res.body.url).toContain('share.html?t=abc123');
    expect(res.body.expiresAt).toBeDefined();
  });

  test('passes ownerEmail + domain from req.user (not body — prevents impersonation)', async () => {
    firestore.createShareLink.mockResolvedValue({ token: 'tok', expiresAt: 'x' });
    await request(app)
      .post('/api/share')
      .set(authedHeader('actual@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send({
        recurringEventId: 'series-x',
        type: 'series',
        // Attacker tries to impersonate someone else's domain — endpoint must ignore
        ownerEmail: 'victim@enemy.com',
        domain: 'enemy.com',
      });
    expect(firestore.createShareLink).toHaveBeenCalledWith(
      'acme.com', 'actual@acme.com',
      expect.objectContaining({ recurringEventId: 'series-x' })
    );
  });

  test('500 when createShareLink throws', async () => {
    firestore.createShareLink.mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .post('/api/share')
      .set(authedHeader('a@b.com', 'b.com'))
      .set('Content-Type', 'application/json')
      .send({ recurringEventId: 'series-x' });
    expect(res.status).toBe(500);
  });
});

describe('history — error + validation branches', () => {
  test('POST /event 500 when logEvent throws; accepts rich meta', async () => {
    firestore.logEvent.mockRejectedValue(new Error('boom'));
    const res = await request(app).post('/api/event').set(authedHeader('u@acme.com', 'acme.com'))
      .send({ type: 'export_clicked', meta: { a: 'x'.repeat(600), n: 5, b: true, arr: [1, 2] } });
    expect(res.status).toBe(500);
  });

  test('GET /series 500 when the read throws', async () => {
    firestore.getUserMeetingSeries.mockRejectedValue(new Error('boom'));
    const res = await request(app).get('/api/series').set(authedHeader('u@acme.com', 'acme.com'));
    expect(res.status).toBe(500);
  });

  test('GET /participant requires a key and 500s on read failure', async () => {
    const noKey = await request(app).get('/api/participant').set(authedHeader('u@acme.com', 'acme.com'));
    expect(noKey.status).toBe(400);
    firestore.getParticipantHistory.mockRejectedValue(new Error('boom'));
    firestore.getParticipantNote.mockResolvedValue(null);
    const res = await request(app).get('/api/participant?key=a@acme.com').set(authedHeader('u@acme.com', 'acme.com'));
    expect(res.status).toBe(500);
  });

  test('PUT /participant/note requires a key and 500s on write failure', async () => {
    const noKey = await request(app).put('/api/participant/note').set(authedHeader('u@acme.com', 'acme.com')).send({ body: 'x' });
    expect(noKey.status).toBe(400);
    firestore.setParticipantNote.mockRejectedValue(new Error('boom'));
    const res = await request(app).put('/api/participant/note').set(authedHeader('u@acme.com', 'acme.com')).send({ key: 'a@acme.com', body: 'note' });
    expect(res.status).toBe(500);
  });
});

describe('history — meta + share + note residual branches', () => {
  test('POST /event ignores array meta, non-scalar values, and missing meta', async () => {
    firestore.logEvent.mockResolvedValue();
    // array meta → the object guard is false
    let res = await request(app).post('/api/event').set(authedHeader('u@acme.com', 'acme.com')).send({ type: 'export_clicked', meta: [1, 2] });
    expect(res.status).toBe(200);
    // object meta with a non-scalar value → that key is skipped
    res = await request(app).post('/api/event').set(authedHeader('u@acme.com', 'acme.com')).send({ type: 'export_clicked', meta: { good: 'x', bad: { nested: 1 } } });
    expect(res.status).toBe(200);
    // no meta at all
    res = await request(app).post('/api/event').set(authedHeader('u@acme.com', 'acme.com')).send({ type: 'export_clicked' });
    expect(res.status).toBe(200);
  });

  test('POST /share accepts an explicit type', async () => {
    firestore.createShareLink.mockResolvedValue({ token: 'tok', expiresAt: new Date().toISOString() });
    const res = await request(app).post('/api/share').set(authedHeader('u@acme.com', 'acme.com')).send({ recurringEventId: 'r', type: 'series' });
    expect(res.status).toBe(200);
  });

  test('PUT /participant/note clears with an empty body', async () => {
    firestore.setParticipantNote.mockResolvedValue({ saved: true });
    const res = await request(app).put('/api/participant/note').set(authedHeader('u@acme.com', 'acme.com')).send({ key: 'a@acme.com' });
    expect(res.status).toBe(200);
    expect(firestore.setParticipantNote).toHaveBeenCalledWith('acme.com', 'u@acme.com', 'a@acme.com', '');
  });
});

describe('history — final residual branches', () => {
  test('POST /event ignores a non-object meta (string)', async () => {
    firestore.logEvent.mockResolvedValue();
    const res = await request(app).post('/api/event').set(authedHeader('u@acme.com', 'acme.com')).send({ type: 'export_clicked', meta: 'nope' });
    expect(res.status).toBe(200);
  });

  test('POST /share defaults type to series when omitted', async () => {
    firestore.createShareLink.mockResolvedValue({ token: 'tok', expiresAt: new Date().toISOString() });
    const res = await request(app).post('/api/share').set(authedHeader('u@acme.com', 'acme.com')).send({ recurringEventId: 'r' });
    expect(res.status).toBe(200);
    expect(firestore.createShareLink).toHaveBeenCalledWith('acme.com', 'u@acme.com', expect.objectContaining({ type: 'series' }));
  });

  test('PUT /participant/note with no body → 400 key required', async () => {
    const res = await request(app).put('/api/participant/note').set(authedHeader('u@acme.com', 'acme.com'));
    expect(res.status).toBe(400);
  });
});

describe('history — non-JSON body (req.body || {})', () => {
  const auth = () => authedHeader('u@acme.com', 'acme.com');
  test('POST /event non-JSON → 400', async () => {
    const res = await request(app).post('/api/event').set(auth()).set('Content-Type', 'text/plain').send('x');
    expect(res.status).toBe(400);
  });
  test('POST /share non-JSON → 400', async () => {
    const res = await request(app).post('/api/share').set(auth()).set('Content-Type', 'text/plain').send('x');
    expect(res.status).toBe(400);
  });
  test('PUT /participant/note non-JSON → 400', async () => {
    const res = await request(app).put('/api/participant/note').set(auth()).set('Content-Type', 'text/plain').send('x');
    expect(res.status).toBe(400);
  });
});
