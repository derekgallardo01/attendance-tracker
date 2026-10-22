// Tests for GET /api/attendance — the live attendance fetch. Most of the
// logic is in calls to the Meet REST API; we mock those entirely. Focus is on:
//   - input validation (conferenceId required)
//   - the conferenceStartTime/EndTime passthrough (used by meeting-ended UI)
//   - delegationConfigured flag (used by setup banner)
//   - empty-state response shape

const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

const mockMeetGet = jest.fn();
const mockMeetGetAll = jest.fn();

jest.mock('../../src/services/meetApi', () => ({
  meetGet: (...a) => mockMeetGet(...a),
  meetGetAll: (...a) => mockMeetGetAll(...a),
  // Pure helpers — pass the real implementations through.
  participantIdentity: jest.requireActual('../../src/services/meetApi').participantIdentity,
  sessionsDurationMs: jest.requireActual('../../src/services/meetApi').sessionsDurationMs,
}));
jest.mock('../../src/services/googleAuth', () => ({
  getMeetToken: jest.fn().mockResolvedValue('sa-token'),
  makeJWT: jest.fn().mockResolvedValue({}),
  loadServiceAccountKey: jest.fn().mockResolvedValue({ client_email: 'sa@x.iam', private_key: 'k' }),
  refreshAccessToken: jest.fn().mockResolvedValue({ access_token: 'refreshed-tok', expiry_date: Date.now() + 3600000 }),
}));
jest.mock('../../src/services/firestore', () => ({
  persistAttendance: jest.fn(),
  getTenantConfig: jest.fn(),
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
}));
jest.mock('googleapis', () => ({
  google: {
    admin: jest.fn().mockReturnValue({
      users: { get: jest.fn().mockRejectedValue(new Error('not in directory')) },
    }),
    auth: {
      JWT: jest.fn().mockImplementation(() => ({ authorize: jest.fn().mockResolvedValue(true) })),
    },
  },
}));

const firestore = require('../../src/services/firestore');

let app;

beforeEach(() => {
  jest.clearAllMocks();
  firestore.getUser.mockImplementation(async (domain, email) => ({
    email, domain, refreshToken: 'rt', accessToken: 'at',
    tokenExpiresAt: new Date(Date.now() + 3600000),
  }));
  firestore.getTenantConfig.mockResolvedValue(null);
  app = buildApp();
});

describe('GET /api/attendance', () => {
  test('400 when conferenceId missing', async () => {
    const res = await request(app)
      .get('/api/attendance')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(400);
  });

  test('401 without auth', async () => {
    const res = await request(app).get('/api/attendance?conferenceId=abc-defg-hij');
    expect(res.status).toBe(401);
  });

  test('returns empty participants + message when no conferenceRecord exists yet', async () => {
    mockMeetGet.mockResolvedValue({ conferenceRecords: [] });
    const res = await request(app)
      .get('/api/attendance?conferenceId=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.participants).toEqual([]);
    expect(res.body.message).toMatch(/may still be live/i);
  });

  test('returns conferenceStartTime + conferenceEndTime from the record (meeting-ended UI uses these)', async () => {
    const startTime = '2026-06-28T10:00:00Z';
    const endTime = '2026-06-28T10:30:00Z';
    mockMeetGet.mockResolvedValue({
      conferenceRecords: [{
        name: 'conferenceRecords/abc',
        startTime,
        endTime,
      }],
    });
    mockMeetGetAll
      .mockResolvedValueOnce([]) // participants
      .mockResolvedValue([]);
    const res = await request(app)
      .get('/api/attendance?conferenceId=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.conferenceRecord).toBe('conferenceRecords/abc');
    expect(res.body.conferenceStartTime).toBe(startTime);
    expect(res.body.conferenceEndTime).toBe(endTime);
  });

  test('REUSED meeting code: picks the ONGOING record, not the oldest (the Five Iron Golf bug)', async () => {
    // API returns newest-first; the old records[length-1] read the stale
    // record and showed an empty roster for 46 minutes of a live meeting.
    mockMeetGet.mockResolvedValue({
      conferenceRecords: [
        { name: 'conferenceRecords/live', startTime: '2026-09-08T17:00:00Z' }, // ongoing: no endTime
        { name: 'conferenceRecords/stale', startTime: '2026-08-01T10:00:00Z', endTime: '2026-08-01T10:05:00Z' },
      ],
    });
    mockMeetGetAll.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/attendance?conferenceId=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(mockMeetGetAll).toHaveBeenCalledWith('conferenceRecords/live/participants', expect.anything(), 'participants');
    expect(res.body.conferenceStartTime).toBe('2026-09-08T17:00:00Z');
  });

  test('REUSED code with only ENDED records: picks the most recent by startTime regardless of API order', async () => {
    mockMeetGet.mockResolvedValue({
      conferenceRecords: [
        { name: 'conferenceRecords/older', startTime: '2026-08-01T10:00:00Z', endTime: '2026-08-01T11:00:00Z' },
        { name: 'conferenceRecords/newest', startTime: '2026-09-08T17:00:00Z', endTime: '2026-09-08T18:00:00Z' },
      ],
    });
    mockMeetGetAll.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/attendance?conferenceId=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(mockMeetGetAll).toHaveBeenCalledWith('conferenceRecords/newest/participants', expect.anything(), 'participants');
  });

  test('delegationConfigured:false when no service account configured for tenant', async () => {
    mockMeetGet.mockResolvedValue({
      conferenceRecords: [{ name: 'conferenceRecords/abc', startTime: 'x', endTime: 'y' }],
    });
    mockMeetGetAll.mockResolvedValue([]);
    const res = await request(app)
      .get('/api/attendance?conferenceId=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.body.delegationConfigured).toBe(false);
  });

  test('Meet API failure on the conference-record lookup degrades to empty (not 500)', async () => {
    // Both filter attempts fail — endpoint logs warnings and returns the
    // "may still be live" empty state rather than surfacing the error.
    mockMeetGet.mockRejectedValue(new Error('Meet API down'));
    const res = await request(app)
      .get('/api/attendance?conferenceId=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.participants).toEqual([]);
    expect(res.body.message).toMatch(/may still be live/i);
  });

  test('500 when participants fetch fails after conference record is found', async () => {
    mockMeetGet.mockResolvedValue({
      conferenceRecords: [{ name: 'conferenceRecords/abc', startTime: 'x', endTime: 'y' }],
    });
    mockMeetGetAll.mockRejectedValue(new Error('Participants endpoint exploded'));
    const res = await request(app)
      .get('/api/attendance?conferenceId=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(500);
  });

  test('returns participants array with extracted fields', async () => {
    mockMeetGet.mockResolvedValue({
      conferenceRecords: [{ name: 'conferenceRecords/abc', startTime: 'x', endTime: 'y' }],
    });
    mockMeetGetAll
      .mockResolvedValueOnce([
        {
          name: 'conferenceRecords/abc/participants/p1',
          signedinUser: { displayName: 'Alex', email: 'alex@acme.com' },
        },
      ])
      .mockResolvedValueOnce([
        { startTime: '2026-06-28T10:00:00Z', endTime: '2026-06-28T10:30:00Z' },
      ]);
    const res = await request(app)
      .get('/api/attendance?conferenceId=abc-defg-hij')
      .set(authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(res.body.participants).toHaveLength(1);
    expect(res.body.participants[0].displayName).toBe('Alex');
    expect(res.body.participants[0].email).toBe('alex@acme.com');
    expect(res.body.participants[0].joinTime).toBe('2026-06-28T10:00:00.000Z');
  });
});

describe('GET /api/attendance — service account, enrichment, sessions', () => {
  const { google } = require('googleapis');
  const auth = () => authedHeader('user@acme.com', 'acme.com');

  // meetGetAll dispatches by path: participants list vs per-participant sessions.
  function wireMeet({ records, participants, sessions }) {
    mockMeetGet.mockResolvedValue({ conferenceRecords: records });
    mockMeetGetAll.mockImplementation(async (pathArg) => {
      if (pathArg.endsWith('/participants')) return participants;
      if (pathArg.endsWith('/participantSessions')) return sessions;
      return [];
    });
  }
  const oneRecord = [{ name: 'conferenceRecords/rec-1', startTime: '2026-06-01T10:00:00Z', endTime: '2026-06-01T11:00:00Z' }];

  test('uses the service account when an impersonation email matches the domain', async () => {
    firestore.getTenantConfig.mockResolvedValue({ impersonateEmail: 'admin@acme.com' });
    wireMeet({ records: oneRecord, participants: [{ name: 'conferenceRecords/rec-1/participants/999', signedinUser: { displayName: 'A', email: 'a@acme.com' } }], sessions: [{ startTime: '2026-06-01T10:00:00Z', endTime: '2026-06-01T10:30:00Z' }] });
    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.delegationConfigured).toBe(true);
  });

  test('falls back to user OAuth when the service account token fails', async () => {
    const googleAuth = require('../../src/services/googleAuth');
    firestore.getTenantConfig.mockResolvedValue({ impersonateEmail: 'admin@acme.com' });
    googleAuth.getMeetToken.mockRejectedValueOnce(new Error('delegation not configured'));
    wireMeet({ records: oneRecord, participants: [], sessions: [] });
    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.delegationConfigured).toBe(false);
  });

  test('skips the service account on an impersonation-domain mismatch', async () => {
    firestore.getTenantConfig.mockResolvedValue({ impersonateEmail: 'admin@other.com' });
    wireMeet({ records: oneRecord, participants: [], sessions: [] });
    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.delegationConfigured).toBe(false);
  });

  test('401 when no auth source is available', async () => {
    firestore.getTenantConfig.mockResolvedValue(null); // no impersonate
    const res = await request(app).get('/api/attendance?conferenceId=abc'); // no bearer → req.user null
    expect(res.status).toBe(401);
  });

  test('enriches a missing email via the Directory API', async () => {
    google.admin.mockReturnValue({ users: { get: jest.fn().mockResolvedValue({ data: { primaryEmail: 'found@acme.com' } }) } });
    const CONFIG = require('../../src/config'); const savedAdmin = CONFIG.adminEmail; CONFIG.adminEmail = 'dir-admin@acme.com';
    firestore.getTenantConfig.mockResolvedValue({ impersonateEmail: 'admin@acme.com' });
    wireMeet({ records: oneRecord, participants: [{ name: 'conferenceRecords/rec-1/participants/123456', signedinUser: { displayName: 'NoEmail' } }], sessions: [] });
    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.participants[0].email).toBe('found@acme.com');
    CONFIG.adminEmail = savedAdmin;
  });

  test('tolerates a directory lookup miss and a directory-unavailable error', async () => {
    const CONFIG = require('../../src/config'); const savedAdmin = CONFIG.adminEmail; CONFIG.adminEmail = 'dir-admin@acme.com';
    firestore.getTenantConfig.mockResolvedValue({ impersonateEmail: 'admin@acme.com' });
    // JWT.authorize throws → the whole enrichment is skipped (outer catch)
    google.auth.JWT.mockImplementation(() => ({ authorize: jest.fn().mockRejectedValue(new Error('no directory scope')) }));
    wireMeet({ records: oneRecord, participants: [{ name: 'conferenceRecords/rec-1/participants/123456', signedinUser: { displayName: 'NoEmail' } }], sessions: [] });
    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(200);
    CONFIG.adminEmail = savedAdmin;
  });

  test('falls back per-participant when the session fetch throws', async () => {
    firestore.getTenantConfig.mockResolvedValue({ impersonateEmail: 'admin@acme.com' });
    mockMeetGet.mockResolvedValue({ conferenceRecords: oneRecord });
    mockMeetGetAll.mockImplementation(async (pathArg) => {
      if (pathArg.endsWith('/participants')) return [{ name: 'conferenceRecords/rec-1/participants/p1', signedinUser: { displayName: 'P', email: 'p@acme.com' } }];
      throw new Error('session fetch boom'); // sessions call fails
    });
    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.participants[0].present).toBe(true); // fallback shape
  });
});

describe('GET /api/attendance — auth gate + enrichment skips', () => {
  const { google } = require('googleapis');
  const auth = () => authedHeader('user@acme.com', 'acme.com');
  const oneRecord = [{ name: 'conferenceRecords/rec-1', startTime: null, endTime: null }];

  test('403 when the org domain is not in ALLOWED_DOMAINS', async () => {
    const CONFIG = require('../../src/config');
    const saved = CONFIG.allowedDomains;
    CONFIG.allowedDomains = ['other.com'];
    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(403);
    CONFIG.allowedDomains = saved;
  });

  test('enrichment is skipped when no admin email is configured', async () => {
    const CONFIG = require('../../src/config');
    const savedAdmin = CONFIG.adminEmail; CONFIG.adminEmail = null;
    firestore.getTenantConfig.mockResolvedValue({ impersonateEmail: 'admin@acme.com' }); // no adminEmail
    mockMeetGet.mockResolvedValue({ conferenceRecords: oneRecord });
    mockMeetGetAll.mockImplementation(async (p) => p.endsWith('/participants')
      ? [{ name: 'conferenceRecords/rec-1/participants/123456', signedinUser: { displayName: 'NoEmail' } }] : []);
    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(200);
    CONFIG.adminEmail = savedAdmin;
  });

  test('per-participant directory lookup miss (external user) is tolerated', async () => {
    const CONFIG = require('../../src/config');
    const savedAdmin = CONFIG.adminEmail; CONFIG.adminEmail = 'dir-admin@acme.com';
    google.auth.JWT.mockImplementation(() => ({ authorize: jest.fn().mockResolvedValue(true) }));
    google.admin.mockReturnValue({ users: { get: jest.fn().mockRejectedValue(new Error('not found in directory')) } });
    firestore.getTenantConfig.mockResolvedValue({ impersonateEmail: 'admin@acme.com' });
    mockMeetGet.mockResolvedValue({ conferenceRecords: oneRecord });
    mockMeetGetAll.mockImplementation(async (p) => p.endsWith('/participants')
      ? [{ name: 'conferenceRecords/rec-1/participants/123456', signedinUser: { displayName: 'External' } }] : []);
    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.participants[0].email).toBe(''); // still no email after miss
    CONFIG.adminEmail = savedAdmin;
  });
});

describe('GET /api/attendance — participant + filter edge branches', () => {
  const auth = () => authedHeader('user@acme.com', 'acme.com');

  test('space.name filter fallback + signedinUser/Unknown names + non-numeric ids', async () => {
    firestore.getTenantConfig.mockResolvedValue({ impersonateEmail: 'admin@acme.com' });
    // first (meeting_code) filter → empty; second (space.name) → records
    mockMeetGet
      .mockResolvedValueOnce({ conferenceRecords: [] })
      .mockResolvedValueOnce({ conferenceRecords: [{ name: 'conferenceRecords/rec-2', startTime: null, endTime: null }] });
    mockMeetGetAll.mockImplementation(async (p) => p.endsWith('/participants')
      ? [
          { name: 'conferenceRecords/rec-2/participants/anon-abc', signedinUser: { displayName: 'Signed In', email: 'si@acme.com' } }, // non-numeric id, signedinUser
          { name: '', signedinUser: {} }, // no path, no name/email → Unknown
        ]
      : [{ startTime: '2026-06-01T10:00:00Z' }]); // a session with start, no end → present
    const res = await request(app).get('/api/attendance?conferenceId=spaces/xyz').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.participants.some(p => p.displayName === 'Unknown')).toBe(true);
  });

  test('directory response without primaryEmail leaves the email empty', async () => {
    const { google } = require('googleapis');
    const CONFIG = require('../../src/config'); const savedAdmin = CONFIG.adminEmail; CONFIG.adminEmail = 'dir-admin@acme.com';
    google.auth.JWT.mockImplementation(() => ({ authorize: jest.fn().mockResolvedValue(true) }));
    google.admin.mockReturnValue({ users: { get: jest.fn().mockResolvedValue({ data: {} }) } }); // no primaryEmail
    firestore.getTenantConfig.mockResolvedValue({ impersonateEmail: 'admin@acme.com' });
    mockMeetGet.mockResolvedValue({ conferenceRecords: [{ name: 'conferenceRecords/rec-3' }] });
    mockMeetGetAll.mockImplementation(async (p) => p.endsWith('/participants')
      ? [{ name: 'conferenceRecords/rec-3/participants/123456', signedinUser: { displayName: 'X' } }] : []);
    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.body.participants[0].email).toBe('');
    CONFIG.adminEmail = savedAdmin;
  });

  test('SECURITY: an unauthenticated request no longer falls through to the service account', async () => {
    // Previously `!userDomain` let an anonymous request impersonate the legacy
    // admin via the SA and read that org's attendance. Now anonymous → no SA
    // token → 401, and nothing is persisted.
    firestore.getTenantConfig.mockResolvedValue({ impersonateEmail: 'admin@acme.com' });
    mockMeetGet.mockResolvedValue({ conferenceRecords: [{ name: 'conferenceRecords/rec-4' }] });
    const res = await request(app).get('/api/attendance?conferenceId=abc'); // no bearer
    expect(res.status).toBe(401);
    expect(firestore.persistAttendance).not.toHaveBeenCalled();
  });
});

describe('GET /api/attendance — large-meeting cap (A6) + rate limiting (A9)', () => {
  const auth = () => authedHeader('user@acme.com', 'acme.com');
  const oneRecord = [{ name: 'conferenceRecords/big', startTime: '2026-09-10T10:00:00Z', endTime: null }];

  test('caps the participant working set and flags truncated (a giant meeting cannot build an unbounded array)', async () => {
    // 501 participants → only MAX_PARTICIPANTS (default 500) are processed.
    const many = Array.from({ length: 501 }, (_, i) => ({ name: `conferenceRecords/big/participants/${i}`, signedinUser: { displayName: `P${i}`, email: `p${i}@acme.com` } }));
    mockMeetGet.mockResolvedValue({ conferenceRecords: oneRecord });
    mockMeetGetAll.mockImplementation(async (p) => p.endsWith('/participants') ? many : []); // sessions → []
    const res = await request(app).get('/api/attendance?conferenceId=big').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.totalParticipants).toBe(501);
    expect(res.body.truncated).toBe(true);
    expect(res.body.participants).toHaveLength(500);
    expect(res.body.rateLimited).toBe(false);
  });

  test('a small meeting is not truncated', async () => {
    mockMeetGet.mockResolvedValue({ conferenceRecords: oneRecord });
    mockMeetGetAll.mockImplementation(async (p) => p.endsWith('/participants')
      ? [{ name: 'conferenceRecords/big/participants/1', signedinUser: { displayName: 'A', email: 'a@acme.com' } }] : []);
    const res = await request(app).get('/api/attendance?conferenceId=big').set(auth());
    expect(res.body.truncated).toBe(false);
    expect(res.body.totalParticipants).toBe(1);
  });

  test('top-level Meet 429 returns a clear 429 RATE_LIMITED (not a blind 500)', async () => {
    mockMeetGet.mockResolvedValue({ conferenceRecords: oneRecord });
    mockMeetGetAll.mockRejectedValue(Object.assign(new Error('Meet API 429: RESOURCE_EXHAUSTED'), { status: 429 }));
    const res = await request(app).get('/api/attendance?conferenceId=big').set(auth());
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('RATE_LIMITED');
    expect(res.headers['retry-after']).toBe('30');
  });

  test('dedupes reconnection records to distinct people (a churny 257-person / 5000-record meeting keeps everyone, one session call each)', async () => {
    // Same person rejoining creates multiple participant records. Dedupe by the
    // countDistinctAttendees identity key so the cap counts PEOPLE, not records.
    mockMeetGet.mockResolvedValue({ conferenceRecords: oneRecord });
    let sessionCalls = 0;
    mockMeetGetAll.mockImplementation(async (p) => {
      if (p.endsWith('/participants')) return [
        { name: 'conferenceRecords/big/participants/r1', signedinUser: { displayName: 'Ana', email: 'ana@acme.com' } },
        { name: 'conferenceRecords/big/participants/r2', signedinUser: { displayName: 'Ana', email: 'ana@acme.com' } }, // Ana rejoined → 2nd record
        { name: 'conferenceRecords/big/participants/r3', signedinUser: { displayName: 'Ana', email: 'ana@acme.com' } }, // and again
        { name: 'conferenceRecords/big/participants/r4', signedinUser: { displayName: 'Bo', email: 'bo@acme.com' } },
      ];
      sessionCalls++;
      return [{ startTime: '2026-09-10T10:00:00Z', endTime: '2026-09-10T10:05:00Z' }];
    });
    const res = await request(app).get('/api/attendance?conferenceId=big').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.totalParticipants).toBe(4);          // raw records
    expect(res.body.distinctCount).toBe(2);              // Ana + Bo
    expect(res.body.participants).toHaveLength(2);        // one entry per person
    expect(sessionCalls).toBe(4);                         // fetches sessions for all participant records to merge
    expect(res.body.participants.map(p => p.email).sort()).toEqual(['ana@acme.com', 'bo@acme.com']);
    expect(res.body.truncated).toBe(false);
  });

  test('anonymous (no email, no name) participants are NOT collapsed into one', async () => {
    mockMeetGet.mockResolvedValue({ conferenceRecords: oneRecord });
    mockMeetGetAll.mockImplementation(async (p) => p.endsWith('/participants')
      ? [
          { name: 'conferenceRecords/big/participants/a1', anonymousUser: {} },
          { name: 'conferenceRecords/big/participants/a2', anonymousUser: {} },
          { name: 'conferenceRecords/big/participants/a3', anonymousUser: {} },
        ]
      : []);
    const res = await request(app).get('/api/attendance?conferenceId=big').set(auth());
    expect(res.body.distinctCount).toBe(3); // three separate anon guests, not merged
    expect(res.body.participants).toHaveLength(3);
  });

  test('a 429 mid session-fetch degrades to partial data with rateLimited:true (200, still shows everyone)', async () => {
    mockMeetGet.mockResolvedValue({ conferenceRecords: oneRecord });
    mockMeetGetAll.mockImplementation(async (p) => {
      if (p.endsWith('/participants')) return [
        { name: 'conferenceRecords/big/participants/1', signedinUser: { displayName: 'A', email: 'a@acme.com' } },
        { name: 'conferenceRecords/big/participants/2', signedinUser: { displayName: 'B', email: 'b@acme.com' } },
      ];
      throw Object.assign(new Error('Meet API 429: RESOURCE_EXHAUSTED'), { status: 429 }); // sessions rate-limited
    });
    const res = await request(app).get('/api/attendance?conferenceId=big').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.rateLimited).toBe(true);
    expect(res.body.participants).toHaveLength(2); // everyone still listed
  });

  test('gracefully degrades sessions with degraded:true when processing deadline exceeded', async () => {
    let currentTime = 100000;
    const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => currentTime);
    mockMeetGet.mockResolvedValue({ conferenceRecords: oneRecord });
    mockMeetGetAll.mockImplementation(async (p) => {
      if (p.endsWith('/participants')) {
        currentTime += 26000; // advance time by 26s so batch loop hits REQUEST_DEADLINE_MS
        return [
          { name: 'conferenceRecords/big/participants/1', signedinUser: { displayName: 'User 1', email: 'u1@acme.com' } },
          { name: 'conferenceRecords/big/participants/2', signedinUser: { displayName: 'User 2', email: 'u2@acme.com' } },
        ];
      }
      return [];
    });

    try {
      const res = await request(app).get('/api/attendance?conferenceId=big').set(auth());
      expect(res.status).toBe(200);
      expect(res.body.degraded).toBe(true);
      expect(res.body.participants).toHaveLength(2);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe('GET /api/attendance — final residual branches', () => {
  const auth = () => authedHeader('user@acme.com', 'acme.com');

  test('both filters return objects without a conferenceRecords array', async () => {
    firestore.getTenantConfig.mockResolvedValue({ impersonateEmail: 'admin@acme.com' });
    mockMeetGet.mockResolvedValue({}); // no conferenceRecords on either filter
    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/No conference record/);
  });

  test('session-fetch fallback uses signedinUser / Unknown names', async () => {
    firestore.getTenantConfig.mockResolvedValue({ impersonateEmail: 'admin@acme.com' });
    mockMeetGet.mockResolvedValue({ conferenceRecords: [{ name: 'conferenceRecords/rec-9' }] });
    mockMeetGetAll.mockImplementation(async (p) => {
      if (p.endsWith('/participants')) return [
        { name: 'conferenceRecords/rec-9/participants/p-si', signedinUser: { displayName: 'SignedIn', email: 'si@acme.com' } },
        { name: 'conferenceRecords/rec-9/participants/p-none', signedinUser: {} }, // → Unknown / ''
      ];
      throw new Error('sessions boom'); // force the per-participant catch fallback
    });
    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.participants.map(p => p.displayName).sort()).toEqual(['SignedIn', 'Unknown']);
  });

  test('Meet API 401 auto-refreshes token and retries successfully', async () => {
    firestore.getTenantConfig.mockResolvedValue(null); // use user OAuth
    mockMeetGet.mockResolvedValue({ conferenceRecords: [{ name: 'conferenceRecords/rec-401' }] });
    const googleAuth = require('../../src/services/googleAuth');
    googleAuth.refreshAccessToken.mockResolvedValue({ access_token: 'fresh-token-401', expiry_date: Date.now() + 3600000 });

    let callCount = 0;
    mockMeetGetAll.mockImplementation(async (p, tok) => {
      if (p.endsWith('/participants')) {
        callCount++;
        if (callCount === 1) {
          const err = new Error('Meet API 401: {"error":{"status":"UNAUTHENTICATED"}}');
          err.status = 401;
          throw err;
        }
        // Second call with refreshed token succeeds
        expect(tok).toBe('fresh-token-401');
        return [
          { name: 'conferenceRecords/rec-401/participants/p-1', signedinUser: { displayName: 'Student 1', email: 's1@acme.com' } }
        ];
      }
      return [];
    });

    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.participants).toHaveLength(1);
    expect(googleAuth.refreshAccessToken).toHaveBeenCalledWith('rt');
    expect(firestore.updateUserTokens).toHaveBeenCalledWith('acme.com', 'user@acme.com', expect.objectContaining({ accessToken: 'fresh-token-401' }));
  });

  test('Meet API 401 returns 401 AUTH_EXPIRED when token refresh fails', async () => {
    firestore.getTenantConfig.mockResolvedValue(null);
    mockMeetGet.mockResolvedValue({ conferenceRecords: [{ name: 'conferenceRecords/rec-fail' }] });
    const googleAuth = require('../../src/services/googleAuth');
    googleAuth.refreshAccessToken.mockRejectedValue(new Error('invalid_grant'));

    mockMeetGetAll.mockImplementation(async () => {
      const err = new Error('Meet API 401: {"error":{"status":"UNAUTHENTICATED"}}');
      err.status = 401;
      throw err;
    });

    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_EXPIRED');
    expect(res.body.error).toMatch(/session expired/i);
  });

  test('Meet API transient socket drop returns 503 UPSTREAM_NETWORK_ERROR without 500 crash', async () => {
    mockMeetGet.mockResolvedValue({ conferenceRecords: [{ name: 'conferenceRecords/rec-net' }] });
    mockMeetGetAll.mockRejectedValue(new TypeError('terminated'));

    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(503);
    expect(res.header['retry-after']).toBe('5');
    expect(res.body.code).toBe('UPSTREAM_NETWORK_ERROR');
    expect(res.body.error).toMatch(/Temporary connection issue/i);
  });

  test('participant rejoin merges records sharing the same identity (combining sessions, summing durations, setting present=true for open session)', async () => {
    firestore.getTenantConfig.mockResolvedValue(null);
    mockMeetGet.mockResolvedValue({ conferenceRecords: [{ name: 'conferenceRecords/rec-rejoin', startTime: null, endTime: null }] });

    mockMeetGetAll.mockImplementation(async (pathArg) => {
      if (pathArg.endsWith('/participants')) {
        return [
          {
            name: 'conferenceRecords/rec-rejoin/participants/part-1',
            signedinUser: { displayName: 'Rejoining User', email: 'rejoin@acme.com' },
          },
          {
            name: 'conferenceRecords/rec-rejoin/participants/part-2',
            signedinUser: { displayName: 'Rejoining User', email: 'rejoin@acme.com' },
          },
        ];
      }
      if (pathArg.includes('part-1/participantSessions')) {
        return [
          { startTime: '2026-06-01T10:00:00.000Z', endTime: '2026-06-01T10:15:00.000Z' },
        ];
      }
      if (pathArg.includes('part-2/participantSessions')) {
        return [
          { startTime: '2026-06-01T10:20:00.000Z', endTime: null },
        ];
      }
      return [];
    });

    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.participants).toHaveLength(1);
    const p = res.body.participants[0];
    expect(p.email).toBe('rejoin@acme.com');
    expect(p.sessions).toBe(2);
    expect(p.present).toBe(true);
    expect(p.durationMs).toBeGreaterThanOrEqual(900000);
  });

  test('participant rejoin preserves presence and duration for successfully fetched sessions even when another session fetch in the group throws a transient error', async () => {
    firestore.getTenantConfig.mockResolvedValue(null);
    mockMeetGet.mockResolvedValue({ conferenceRecords: [{ name: 'conferenceRecords/rec-rejoin-partial', startTime: null, endTime: null }] });

    mockMeetGetAll.mockImplementation(async (pathArg) => {
      if (pathArg.endsWith('/participants')) {
        return [
          {
            name: 'conferenceRecords/rec-rejoin-partial/participants/part-1',
            signedinUser: { displayName: 'Rejoining User', email: 'rejoin-partial@acme.com' },
          },
          {
            name: 'conferenceRecords/rec-rejoin-partial/participants/part-2',
            signedinUser: { displayName: 'Rejoining User', email: 'rejoin-partial@acme.com' },
          },
        ];
      }
      if (pathArg.includes('part-1/participantSessions')) {
        return [
          { startTime: '2026-06-01T10:00:00.000Z', endTime: '2026-06-01T10:20:00.000Z' },
        ];
      }
      if (pathArg.includes('part-2/participantSessions')) {
        throw new Error('Meet API transient socket hang up');
      }
      return [];
    });

    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.participants).toHaveLength(1);
    const p = res.body.participants[0];
    expect(p.email).toBe('rejoin-partial@acme.com');
    expect(p.present).toBe(true);
    expect(p.durationMs).toBe(1200000);
    expect(p.joinTime).toBe('2026-06-01T10:00:00.000Z');
    expect(p.leaveTime).toBe('2026-06-01T10:20:00.000Z');
  });

  test('deduplicates repeated p.name records across pagination pages so group.length and session calls are not inflated', async () => {
    firestore.getTenantConfig.mockResolvedValue(null);
    mockMeetGet.mockResolvedValue({ conferenceRecords: [{ name: 'conferenceRecords/rec-dup-pages', startTime: null, endTime: null }] });
    let sessionCalls = 0;
    mockMeetGetAll.mockImplementation(async (pathArg) => {
      if (pathArg.endsWith('/participants')) {
        // Simulate Meet API pagination repeating the same participant record name 5 times
        return Array.from({ length: 5 }, () => ({
          name: 'conferenceRecords/rec-dup-pages/participants/same-id',
          signedinUser: { displayName: 'Repeated Page User', email: 'repeat@acme.com' },
        }));
      }
      sessionCalls++;
      return [{ startTime: '2026-06-01T10:00:00.000Z', endTime: '2026-06-01T10:30:00.000Z' }];
    });

    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.participants).toHaveLength(1);
    expect(sessionCalls).toBe(1); // Only 1 session call for the unique p.name, not 5
    expect(res.body.participants[0].sessions).toBe(1);
  });

  test('per-conference session cache reuses fresh sessions, prioritizes unfetched tail participants after 429, and preserves cached sessions on subsequent 429s', async () => {
    const attendanceRoute = require('../../src/routes/attendance');
    attendanceRoute.setSessionCacheEnabledForTest(true);
    try {
      firestore.getTenantConfig.mockResolvedValue(null);
      mockMeetGet.mockResolvedValue({ conferenceRecords: [{ name: 'conferenceRecords/rec-cache-429', startTime: '2026-10-22T18:00:00Z', endTime: null }] });

      // 15 participants: batch 0 (0..9) + batch 1 (10..14)
      const rawList = Array.from({ length: 15 }, (_, i) => ({
        name: `conferenceRecords/rec-cache-429/participants/p${i}`,
        signedinUser: { displayName: `User ${i}`, email: `u${i}@acme.com` },
        earliestStartTime: '2026-10-22T18:00:00Z',
      }));

      // Poll 1: batch 0 (p0..p9) succeeds, p9 throws 429 so batch 1 (p10..p14) is skipped early
      const fetchedOnPoll1 = [];
      mockMeetGetAll.mockImplementation(async (pathArg) => {
        if (pathArg.endsWith('/participants')) return rawList;
        fetchedOnPoll1.push(pathArg);
        if (pathArg.includes('/p9/')) {
          throw Object.assign(new Error('Meet API 429: RESOURCE_EXHAUSTED'), { status: 429 });
        }
        return [{ startTime: '2026-10-22T18:00:00Z', endTime: '2026-10-22T18:10:00Z' }];
      });

      const res1 = await request(app).get('/api/attendance?conferenceId=cache-test').set(auth());
      expect(res1.status).toBe(200);
      expect(res1.body.rateLimited).toBe(true);
      expect(res1.body.participants[0].joinTime).toBe('2026-10-22T18:00:00.000Z');
      expect(res1.body.participants[10].joinTime).toBeNull(); // unfetched on Poll 1

      // Poll 2: quota recovered. p0..p8 are reused from cache (0 API calls), and unfetched p9..p14 are fetched!
      const fetchedOnPoll2 = [];
      mockMeetGetAll.mockImplementation(async (pathArg) => {
        if (pathArg.endsWith('/participants')) return rawList;
        fetchedOnPoll2.push(pathArg);
        return [{ startTime: '2026-10-22T18:01:00Z', endTime: '2026-10-22T18:15:00Z' }];
      });

      const res2 = await request(app).get('/api/attendance?conferenceId=cache-test').set(auth());
      expect(res2.status).toBe(200);
      expect(res2.body.rateLimited).toBe(false);
      // Only the 6 previously unfetched participants (p9..p14) were queried on Poll 2!
      expect(fetchedOnPoll2).toHaveLength(6);
      expect(res2.body.participants[0].joinTime).toBe('2026-10-22T18:00:00.000Z');
      expect(res2.body.participants[14].joinTime).toBe('2026-10-22T18:01:00.000Z');
    } finally {
      attendanceRoute.setSessionCacheEnabledForTest(false);
    }
  });

  test('skips Directory API enrichment when resolvedAdmin domain does not match userDomain', async () => {
    const { google } = require('googleapis');
    const getSpy = jest.fn().mockResolvedValue({ data: { primaryEmail: 'x@other.com' } });
    google.admin.mockReturnValue({ users: { get: getSpy } });
    const CONFIG = require('../../src/config');
    const savedAdmin = CONFIG.adminEmail;
    CONFIG.adminEmail = 'admin@theyachtgroup.com'; // different domain from user@acme.com
    firestore.getTenantConfig.mockResolvedValue(null);
    mockMeetGet.mockResolvedValue({ conferenceRecords: [{ name: 'conferenceRecords/rec-dir-mismatch' }] });
    mockMeetGetAll.mockImplementation(async (p) => p.endsWith('/participants')
      ? [{ name: 'conferenceRecords/rec-dir-mismatch/participants/123456789', signedinUser: { displayName: 'External Org User' } }]
      : []);

    try {
      const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
      expect(res.status).toBe(200);
      expect(getSpy).not.toHaveBeenCalled();
    } finally {
      CONFIG.adminEmail = savedAdmin;
    }
  });

  test('retains known raw participant records across polls when Meet pagination omits a trailing page', async () => {
    const attendanceRoute = require('../../src/routes/attendance');
    attendanceRoute.setSessionCacheEnabledForTest(true);
    try {
      mockMeetGet.mockResolvedValue({
        conferenceRecords: [{ name: 'conferenceRecords/rec-raw-retain' }],
      });
      const fullRaw = [
        { name: 'conferenceRecords/rec-raw-retain/participants/p1', signedinUser: { displayName: 'Alice', email: 'alice@acme.com' } },
        { name: 'conferenceRecords/rec-raw-retain/participants/p2', signedinUser: { displayName: 'Bob', email: 'bob@acme.com' } },
        { name: 'conferenceRecords/rec-raw-retain/participants/p1-rejoin', signedinUser: { displayName: 'Alice', email: 'alice@acme.com' } },
      ];
      // Poll 1: all 3 records returned (2 distinct people, Alice has 2 sessions)
      mockMeetGetAll.mockImplementation(async (pathArg) => {
        if (pathArg.endsWith('/participants')) return fullRaw;
        return [{ startTime: '2026-10-22T18:00:00Z', endTime: '2026-10-22T18:10:00Z' }];
      });
      const res1 = await request(app).get('/api/attendance?conferenceId=retain-test').set(auth());
      expect(res1.status).toBe(200);
      expect(res1.body.participants).toHaveLength(2);
      expect(res1.body.participants.find(p => p.email === 'alice@acme.com').sessions).toBe(2);

      // Poll 2: cyclic pagination omits p2 and p1-rejoin from rawParticipants
      mockMeetGetAll.mockImplementation(async (pathArg) => {
        if (pathArg.endsWith('/participants')) return [fullRaw[0]];
        return [{ startTime: '2026-10-22T18:00:00Z', endTime: '2026-10-22T18:10:00Z' }];
      });
      const res2 = await request(app).get('/api/attendance?conferenceId=retain-test').set(auth());
      expect(res2.status).toBe(200);
      expect(res2.body.participants).toHaveLength(2);
      expect(res2.body.participants.find(p => p.email === 'alice@acme.com').sessions).toBe(2);
      expect(res2.body.participants.find(p => p.email === 'alice@acme.com').participantId).toBe('conferenceRecords/rec-raw-retain/participants/p1');

      // Poll 3: cyclic pagination returns ONLY p1-rejoin (omitting p1 from current poll) -> deterministic sort & pinned primaryName keep participantId as p1!
      mockMeetGetAll.mockImplementation(async (pathArg) => {
        if (pathArg.endsWith('/participants')) return [fullRaw[2]];
        return [{ startTime: '2026-10-22T18:00:00Z', endTime: '2026-10-22T18:10:00Z' }];
      });
      const res3 = await request(app).get('/api/attendance?conferenceId=retain-test').set(auth());
      expect(res3.status).toBe(200);
      expect(res3.body.participants.find(p => p.email === 'alice@acme.com').participantId).toBe('conferenceRecords/rec-raw-retain/participants/p1');
    } finally {
      attendanceRoute.setSessionCacheEnabledForTest(false);
    }
  });

  test('reconnected participant with multiple records reuses per-record cached sessions when a new reconnect record hits 429 and tags degradedSession', async () => {
    const attendanceRoute = require('../../src/routes/attendance');
    attendanceRoute.setSessionCacheEnabledForTest(true);
    try {
      mockMeetGet.mockResolvedValue({
        conferenceRecords: [{ name: 'conferenceRecords/rec-partial-group-429' }],
      });
      const rec1 = {
        name: 'conferenceRecords/rec-partial-group-429/participants/p1-initial',
        signedinUser: { displayName: 'Alice', email: 'alice@acme.com' },
        earliestStartTime: '2026-10-22T18:00:00Z',
      };
      const rec2 = {
        name: 'conferenceRecords/rec-partial-group-429/participants/p1-reconnect',
        signedinUser: { displayName: 'Alice', email: 'alice@acme.com' },
        earliestStartTime: '2026-10-22T18:30:00Z',
      };

      // Poll 1: Alice has rec1 only, session fetch succeeds
      mockMeetGetAll.mockImplementation(async (pathArg) => {
        if (pathArg.endsWith('/participants')) return [rec1];
        return [{ startTime: '2026-10-22T18:00:00Z', endTime: '2026-10-22T18:20:00Z' }];
      });
      const res1 = await request(app).get('/api/attendance?conferenceId=partial-group').set(auth());
      expect(res1.status).toBe(200);
      expect(res1.body.participants[0].joinTime).toBe('2026-10-22T18:00:00.000Z');
      expect(res1.body.participants[0].durationMs).toBe(1200000);

      // Poll 2: Alice reconnects (group = [rec2, rec1] out of order), and rec1 + rec2 both fail with 429 on refresh:
      // rec1 reuses its cached session from confCache.recordSessions, primary stays p1-initial, and persisted object has degradedSession: true
      mockMeetGetAll.mockImplementation(async (pathArg) => {
        if (pathArg.endsWith('/participants')) return [rec2, rec1];
        throw Object.assign(new Error('Meet API 429: RESOURCE_EXHAUSTED'), { status: 429 });
      });
      const res2 = await request(app).get('/api/attendance?conferenceId=partial-group').set(auth());
      expect(res2.status).toBe(200);
      expect(res2.body.participants[0].participantId).toBe('conferenceRecords/rec-partial-group-429/participants/p1-initial');
      expect(res2.body.participants[0].joinTime).toBe('2026-10-22T18:00:00.000Z');
      expect(res2.body.participants[0].durationMs).toBe(1200000);
      const persistedParticipants = firestore.persistAttendance.mock.calls[1][3];
      expect(persistedParticipants[0].degradedSession).toBe(true);
    } finally {
      attendanceRoute.setSessionCacheEnabledForTest(false);
    }
  });
});
