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
}));
jest.mock('../../src/services/googleAuth', () => ({
  getMeetToken: jest.fn().mockResolvedValue('sa-token'),
  makeJWT: jest.fn().mockResolvedValue({}),
  loadServiceAccountKey: jest.fn().mockResolvedValue({ client_email: 'sa@x.iam', private_key: 'k' }),
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
    expect(res.body.conferenceStartTime).toBe(startTime);
    expect(res.body.conferenceEndTime).toBe(endTime);
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
          user: { displayName: 'Alex', email: 'alex@acme.com' },
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
    wireMeet({ records: oneRecord, participants: [{ name: 'conferenceRecords/rec-1/participants/999', user: { displayName: 'A', email: 'a@acme.com' } }], sessions: [{ startTime: '2026-06-01T10:00:00Z', endTime: '2026-06-01T10:30:00Z' }] });
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
    wireMeet({ records: oneRecord, participants: [{ name: 'conferenceRecords/rec-1/participants/123456', user: { displayName: 'NoEmail' } }], sessions: [] });
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
    wireMeet({ records: oneRecord, participants: [{ name: 'conferenceRecords/rec-1/participants/123456', user: { displayName: 'NoEmail' } }], sessions: [] });
    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(200);
    CONFIG.adminEmail = savedAdmin;
  });

  test('falls back per-participant when the session fetch throws', async () => {
    firestore.getTenantConfig.mockResolvedValue({ impersonateEmail: 'admin@acme.com' });
    mockMeetGet.mockResolvedValue({ conferenceRecords: oneRecord });
    mockMeetGetAll.mockImplementation(async (pathArg) => {
      if (pathArg.endsWith('/participants')) return [{ name: 'conferenceRecords/rec-1/participants/p1', user: { displayName: 'P', email: 'p@acme.com' } }];
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
      ? [{ name: 'conferenceRecords/rec-1/participants/123456', user: { displayName: 'NoEmail' } }] : []);
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
      ? [{ name: 'conferenceRecords/rec-1/participants/123456', user: { displayName: 'External' } }] : []);
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
          { name: '', user: {} }, // no path, no name/email → Unknown
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
      ? [{ name: 'conferenceRecords/rec-3/participants/123456', user: { displayName: 'X' } }] : []);
    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.body.participants[0].email).toBe('');
    CONFIG.adminEmail = savedAdmin;
  });

  test('unauthenticated-but-service-account export persists with a null email', async () => {
    firestore.getTenantConfig.mockResolvedValue({ impersonateEmail: 'admin@acme.com' }); // SA token, no req.user
    mockMeetGet.mockResolvedValue({ conferenceRecords: [{ name: 'conferenceRecords/rec-4' }] });
    mockMeetGetAll.mockImplementation(async (p) => p.endsWith('/participants') ? [] : []);
    const res = await request(app).get('/api/attendance?conferenceId=abc'); // no bearer
    expect(res.status).toBe(200);
    expect(firestore.persistAttendance).toHaveBeenCalledWith('default', 'abc', 'conferenceRecords/rec-4', [], undefined);
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
        { name: 'conferenceRecords/rec-9/participants/p-none', user: {} }, // → Unknown / ''
      ];
      throw new Error('sessions boom'); // force the per-participant catch fallback
    });
    const res = await request(app).get('/api/attendance?conferenceId=abc').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.participants.map(p => p.displayName).sort()).toEqual(['SignedIn', 'Unknown']);
  });
});
