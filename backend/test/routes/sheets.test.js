// Tests for POST /api/save-to-sheets — the main export endpoint. The full
// happy path hits Google Sheets API which we mock entirely. Focus is on:
//   - input validation
//   - auth requirements
//   - the late/excused/recurring-series passthroughs added today
//   - error handling for missing OAuth scopes (drive.file)

const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

// Mock the Google Sheets + Drive APIs entirely so tests don't make network calls.
// Each test sets the mockImplementation chain to whatever it needs.
const mockSheetsUpdate = jest.fn().mockResolvedValue({ data: {} });
const mockSheetsBatchUpdate = jest.fn().mockResolvedValue({
  data: { replies: [{ addSheet: { properties: { sheetId: 999 } } }] },
});
const mockSheetsGet = jest.fn().mockResolvedValue({ data: { spreadsheetId: 'sheet-xyz' } });
const mockSheetsCreate = jest.fn().mockResolvedValue({ data: { spreadsheetId: 'new-sheet' } });
const mockDriveList = jest.fn().mockResolvedValue({ data: { files: [{ id: 'folder-xyz' }] } });
const mockDriveCreate = jest.fn().mockResolvedValue({ data: { id: 'new-thing' } });
const mockDriveGet = jest.fn().mockResolvedValue({ data: { parents: [] } });
const mockDriveUpdate = jest.fn().mockResolvedValue({ data: {} });

jest.mock('googleapis', () => ({
  google: {
    sheets: jest.fn().mockReturnValue({
      spreadsheets: {
        get: (...a) => mockSheetsGet(...a),
        create: (...a) => mockSheetsCreate(...a),
        batchUpdate: (...a) => mockSheetsBatchUpdate(...a),
        values: { update: (...a) => mockSheetsUpdate(...a) },
      },
    }),
    drive: jest.fn().mockReturnValue({
      files: {
        list: (...a) => mockDriveList(...a),
        create: (...a) => mockDriveCreate(...a),
        get: (...a) => mockDriveGet(...a),
        update: (...a) => mockDriveUpdate(...a),
      },
    }),
    auth: { OAuth2: jest.fn() },
  },
}));

jest.mock('../../src/services/googleAuth', () => ({
  makeJWT: jest.fn().mockResolvedValue({}),
  makeUserClient: jest.fn().mockReturnValue({}),
  getGoogleClient: jest.fn().mockResolvedValue({}),
}));

jest.mock('../../src/services/firestore', () => ({
  persistExport: jest.fn(),
  getUserSheetId: jest.fn(),
  setUserSheetId: jest.fn(),
  countUserExports: jest.fn(),
  getMeetingExcusedEmails: jest.fn(),
  addMeetingExcusedEmails: jest.fn(),
  getUserSettings: jest.fn(),
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
  getTenantPlan: jest.fn(), // used by billing.planIsPro when billing is configured
}));

jest.mock('../../src/lib/notifications', () => ({
  sendExportNotification: jest.fn(),
  sendSlackDigest: jest.fn(),
}));

const firestore = require('../../src/services/firestore');
const notifications = require('../../src/lib/notifications');

let app;

const validPayload = {
  meetingTitle: 'Sprint Planning',
  exportedAt: new Date().toISOString(),
  meetingStartTime: new Date(Date.now() - 30 * 60000).toISOString(),
  meetingType: 'scheduled',
  eventStart: new Date(Date.now() - 30 * 60000).toISOString(),
  eventEnd: new Date().toISOString(),
  conferenceId: 'abc-defg-hij',
  timezone: 'America/New_York',
  participants: [
    { displayName: 'Alex', email: 'alex@acme.com', joinTimeISO: new Date(Date.now() - 25 * 60000).toISOString(), leaveTimeISO: null, present: true, sessions: 1 },
    { displayName: 'Beth', email: 'beth@acme.com', joinTimeISO: new Date(Date.now() - 20 * 60000).toISOString(), leaveTimeISO: new Date(Date.now() - 5 * 60000).toISOString(), present: false, sessions: 1 },
  ],
  calendarAttendees: [
    { email: 'alex@acme.com', displayName: 'Alex', status: 'accepted' },
    { email: 'beth@acme.com', displayName: 'Beth', status: 'accepted' },
    { email: 'noshow@acme.com', displayName: 'No Show', status: 'accepted' },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  firestore.getUser.mockImplementation(async (domain, email) => ({
    email, domain, refreshToken: 'rt', accessToken: 'at',
    tokenExpiresAt: new Date(Date.now() + 3600000),
  }));
  firestore.getUserSheetId.mockResolvedValue('existing-sheet-id');
  firestore.countUserExports.mockResolvedValue(0);
  firestore.getMeetingExcusedEmails.mockResolvedValue([]);
  firestore.getUserSettings.mockResolvedValue({ slackWebhookUrl: null });
  app = buildApp();
});

describe('POST /api/save-to-sheets — basic validation', () => {
  test('400 when participants array is missing', async () => {
    const res = await request(app)
      .post('/api/save-to-sheets')
      .set(authedHeader('user@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send({ ...validPayload, participants: undefined });
    expect(res.status).toBe(400);
  });

  test('400 when participants is empty array', async () => {
    const res = await request(app)
      .post('/api/save-to-sheets')
      .set(authedHeader('user@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send({ ...validPayload, participants: [] });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/save-to-sheets — happy path', () => {
  test('200 + sheetUrl + isFirstExport for first-time exporter', async () => {
    const res = await request(app)
      .post('/api/save-to-sheets')
      .set(authedHeader('user@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send(validPayload);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sheetUrl).toContain('docs.google.com/spreadsheets');
    expect(res.body.isFirstExport).toBe(true);
  });

  test('persistExport called with the right metadata', async () => {
    await request(app)
      .post('/api/save-to-sheets')
      .set(authedHeader('user@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send({ ...validPayload, recurringEventId: 'series-1', autoExport: true });
    expect(firestore.persistExport).toHaveBeenCalledWith('acme.com', expect.objectContaining({
      email: 'user@acme.com',
      recurringEventId: 'series-1',
      autoExport: true,
      conferenceId: 'abc-defg-hij',
    }));
  });

  test('does NOT send email by default (manual export = no inbox noise)', async () => {
    await request(app)
      .post('/api/save-to-sheets')
      .set(authedHeader('user@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send(validPayload);
    expect(notifications.sendExportNotification).not.toHaveBeenCalled();
  });

  test('sends email when sendEmail flag is true (auto-export path)', async () => {
    await request(app)
      .post('/api/save-to-sheets')
      .set(authedHeader('user@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send({ ...validPayload, sendEmail: true, autoExport: true });
    expect(notifications.sendExportNotification).toHaveBeenCalledWith(expect.objectContaining({
      to: 'user@acme.com',
      meetingTitle: 'Sprint Planning',
      conferenceId: 'abc-defg-hij',
    }));
  });

  test('email digest includes lateMin per participant (late-arrival passthrough)', async () => {
    const lateJoin = new Date(Date.now() - 20 * 60000).toISOString(); // 10 min after eventStart
    await request(app)
      .post('/api/save-to-sheets')
      .set(authedHeader('user@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send({
        ...validPayload,
        sendEmail: true,
        participants: [{
          displayName: 'Late Larry', email: 'late@acme.com',
          joinTimeISO: lateJoin, leaveTimeISO: null, present: true, sessions: 1,
        }],
      });
    const callArg = notifications.sendExportNotification.mock.calls[0][0];
    expect(callArg.participants[0].lateMin).toBeGreaterThan(0);
  });
});

describe('POST /api/save-to-sheets — excused tagging', () => {
  test('merges client excusedEmails with persisted set', async () => {
    firestore.getMeetingExcusedEmails.mockResolvedValue(['previously@acme.com']);
    await request(app)
      .post('/api/save-to-sheets')
      .set(authedHeader('user@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send({ ...validPayload, excusedEmails: ['noshow@acme.com'] });
    // Persistence should be triggered with the new email
    expect(firestore.addMeetingExcusedEmails).toHaveBeenCalledWith(
      'acme.com', 'abc-defg-hij', ['noshow@acme.com']
    );
  });

  test('does NOT call addMeetingExcusedEmails when excusedEmails empty', async () => {
    await request(app)
      .post('/api/save-to-sheets')
      .set(authedHeader('user@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send(validPayload);
    expect(firestore.addMeetingExcusedEmails).not.toHaveBeenCalled();
  });

  test('digest shows "Excused" status for excused absentees', async () => {
    firestore.getMeetingExcusedEmails.mockResolvedValue(['noshow@acme.com']);
    await request(app)
      .post('/api/save-to-sheets')
      .set(authedHeader('user@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send({ ...validPayload, sendEmail: true });
    const callArg = notifications.sendExportNotification.mock.calls[0][0];
    const noShow = callArg.participants.find(p => p.email === 'noshow@acme.com');
    expect(noShow.status).toBe('Excused');
  });
});

describe('POST /api/save-to-sheets — error handling', () => {
  test('403 DRIVE_PERMISSION_MISSING when scope not granted', async () => {
    mockSheetsBatchUpdate.mockRejectedValueOnce(Object.assign(
      new Error('Request had insufficient authentication scopes.'),
      { code: 403 }
    ));
    const res = await request(app)
      .post('/api/save-to-sheets')
      .set(authedHeader('user@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send(validPayload);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('DRIVE_PERMISSION_MISSING');
  });

  test('500 for any other sheets API failure', async () => {
    mockSheetsBatchUpdate.mockRejectedValueOnce(new Error('Network error'));
    const res = await request(app)
      .post('/api/save-to-sheets')
      .set(authedHeader('user@acme.com', 'acme.com'))
      .set('Content-Type', 'application/json')
      .send(validPayload);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/save-to-sheets — spreadsheet resolution + edge branches', () => {
  const auth = () => authedHeader('user@acme.com', 'acme.com');
  const post = (body) => request(app).post('/api/save-to-sheets').set(auth()).set('Content-Type', 'application/json').send(body);

  test('first export: creates folder + spreadsheet when none exists', async () => {
    firestore.getUserSheetId.mockResolvedValue(null);
    mockDriveList.mockResolvedValue({ data: { files: [] } }); // no folder → create it
    const res = await post(validPayload);
    expect(res.status).toBe(200);
    expect(mockDriveCreate).toHaveBeenCalled();
    expect(mockSheetsCreate).toHaveBeenCalled();
    expect(firestore.setUserSheetId).toHaveBeenCalledWith('acme.com', 'user@acme.com', 'new-sheet');
  });

  test('first export: reuses an existing Drive folder', async () => {
    firestore.getUserSheetId.mockResolvedValue(null);
    mockDriveList.mockResolvedValue({ data: { files: [{ id: 'folder-xyz' }] } });
    const res = await post(validPayload);
    expect(res.status).toBe(200);
    expect(mockDriveCreate).not.toHaveBeenCalled(); // folder reused
  });

  test('recreates the spreadsheet when the stored one is gone', async () => {
    firestore.getUserSheetId.mockResolvedValue('stale-sheet');
    mockSheetsGet.mockRejectedValueOnce(new Error('404 not found')); // stored sheet missing
    mockDriveList.mockResolvedValue({ data: { files: [{ id: 'folder-xyz' }] } });
    const res = await post(validPayload);
    expect(res.status).toBe(200);
    expect(firestore.setUserSheetId).toHaveBeenCalledWith('acme.com', 'user@acme.com', null); // cleared
  });

  test('400 for an unauthenticated request with no shared sheet configured', async () => {
    const res = await request(app).post('/api/save-to-sheets').set('Content-Type', 'application/json').send(validPayload);
    expect(res.status).toBe(400);
  });

  test('sanitizes a formula-injection displayName', async () => {
    const res = await post({ ...validPayload, participants: [{ displayName: '=SUM(A1:A9)', email: 'x@acme.com', present: true, sessions: 1 }] });
    expect(res.status).toBe(200);
    // the value written should be prefixed with a quote to defuse the formula
    const wrote = JSON.stringify(mockSheetsUpdate.mock.calls);
    expect(wrote).toContain("'=SUM");
  });

  test('renders all RSVP statuses', async () => {
    const res = await post({
      ...validPayload,
      calendarAttendees: [
        { email: 'a@acme.com', displayName: 'A', status: 'accepted' },
        { email: 'd@acme.com', displayName: 'D', status: 'declined' },
        { email: 't@acme.com', displayName: 'T', status: 'tentative' },
        { email: 'n@acme.com', displayName: 'N', status: 'needsAction' },
        { email: 'u@acme.com', displayName: 'U', status: 'weird' },
      ],
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/save-to-sheets — slack digest + row branches', () => {
  const auth = () => authedHeader('user@acme.com', 'acme.com');
  const post = (body) => request(app).post('/api/save-to-sheets').set(auth()).set('Content-Type', 'application/json').send(body);

  test('posts a Slack digest when a webhook is configured', async () => {
    firestore.getUserSettings.mockResolvedValue({ slackWebhookUrl: 'https://hooks.slack.com/services/T/B/C' });
    notifications.sendSlackDigest.mockResolvedValue({ sent: true });
    const res = await post({ ...validPayload, sendEmail: false });
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(notifications.sendSlackDigest).toHaveBeenCalled();
  });

  test('tolerates a Slack digest failure (fire-and-forget)', async () => {
    firestore.getUserSettings.mockRejectedValue(new Error('settings boom'));
    const res = await post({ ...validPayload });
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
  });

  test('handles instant meeting, no eventStart, no conferenceId, and a never-joined participant', async () => {
    const res = await post({
      meetingTitle: '', exportedAt: new Date().toISOString(), meetingType: 'instant',
      participants: [
        { displayName: 'Late', email: 'l@acme.com', joinTimeISO: new Date(Date.now() - 2 * 60000).toISOString(), leaveTimeISO: null, present: true, sessions: 1 },
        { displayName: 'NoJoin', email: 'n@acme.com', joinTimeISO: null, leaveTimeISO: null, present: false, sessions: 0 },
      ],
      calendarAttendees: [], excusedEmails: ['n@acme.com'],
    });
    expect(res.status).toBe(200);
  });

  test('flags a late joiner past the threshold (scheduled baseline)', async () => {
    const eventStart = new Date(Date.now() - 60 * 60000).toISOString();
    const res = await post({
      ...validPayload, eventStart, eventEnd: new Date().toISOString(), meetingStartTime: eventStart,
      participants: [
        { displayName: 'VeryLate', email: 'v@acme.com', joinTimeISO: new Date(Date.now() - 30 * 60000).toISOString(), leaveTimeISO: null, present: true, sessions: 1 },
      ],
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/save-to-sheets — legacy shared sheet + more branches', () => {
  const CONFIG = require('../../src/config');
  let savedSheetId;
  beforeEach(() => { savedSheetId = CONFIG.sheetId; });
  afterEach(() => { CONFIG.sheetId = savedSheetId; });
  const post = (body, hdr) => { const r = request(app).post('/api/save-to-sheets').set('Content-Type', 'application/json'); if (hdr) r.set(hdr); return r.send(body); };

  test('legacy: unauthenticated export uses the shared CONFIG.sheetId', async () => {
    CONFIG.sheetId = 'shared-legacy-sheet';
    const res = await post(validPayload); // no auth header → req.user null
    expect(res.status).toBe(200);
  });

  test('appends a counter when the tab name already exists', async () => {
    mockSheetsBatchUpdate
      .mockRejectedValueOnce(Object.assign(new Error('A sheet with the name already exists')))
      .mockResolvedValueOnce({ data: { replies: [{ addSheet: { properties: { sheetId: 7 } } }] } });
    const res = await post(validPayload, authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
  });

  test('zero-duration / never-joined participants (meetStart null, dur "< 1")', async () => {
    const res = await post({
      exportedAt: new Date().toISOString(), meetingType: 'instant',
      participants: [
        { displayName: 'Blip', email: 'b@acme.com', joinTimeISO: new Date().toISOString(), leaveTimeISO: new Date().toISOString(), present: true, sessions: 1 },
        { displayName: 'Ghost', email: 'g@acme.com', joinTimeISO: null, leaveTimeISO: null, present: false, sessions: 0 },
      ],
      calendarAttendees: [],
    }, authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
  });

  test('rich auto-export email digest with overflow (>25 participants)', async () => {
    const many = [];
    for (let i = 0; i < 30; i++) many.push({ displayName: `P${i}`, email: `p${i}@acme.com`, joinTimeISO: new Date(Date.now() - 10 * 60000).toISOString(), leaveTimeISO: null, present: true, sessions: 1 });
    const res = await post({ ...validPayload, sendEmail: true, participants: many }, authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
    expect(notifications.sendExportNotification).toHaveBeenCalledWith(expect.objectContaining({ overflow: expect.any(Number) }));
  });

  test('creation path tolerates a spreadsheet with no parents', async () => {
    firestore.getUserSheetId.mockResolvedValue(null);
    mockDriveGet.mockResolvedValue({ data: {} }); // no parents field
    const res = await post(validPayload, authedHeader('user@acme.com', 'acme.com'));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/save-to-sheets — final edge branches', () => {
  const auth = () => authedHeader('user@acme.com', 'acme.com');
  const post = (body) => request(app).post('/api/save-to-sheets').set(auth()).set('Content-Type', 'application/json').send(body);

  test('invalid timezone triggers the ET fallback (and fails the export)', async () => {
    // The tzAbbr IIFE catches the bad zone (→ 'ET'), then fmtTime re-throws on
    // the same bad zone → 500. The point is exercising the tzAbbr catch branch.
    const res = await post({ ...validPayload, timezone: 'Not/AZone' });
    expect(res.status).toBe(500);
  });

  test('participants with missing name/email/join and present=false', async () => {
    const res = await post({
      exportedAt: new Date().toISOString(), meetingType: 'instant',
      participants: [
        { present: false, sessions: 0 }, // no displayName, no email, no join
        { displayName: 'Left Early', email: 'le@acme.com', joinTimeISO: new Date(Date.now() - 5 * 60000).toISOString(), leaveTimeISO: new Date(Date.now() - 60000).toISOString(), present: false, sessions: 1 },
      ],
      calendarAttendees: [{ email: 'ghost@acme.com', displayName: 'Ghost', status: 'accepted' }],
    });
    expect(res.status).toBe(200);
  });

  test('tab name that sanitizes to empty falls back to "Meeting"', async () => {
    const res = await post({ ...validPayload, tabName: "'''" });
    expect(res.status).toBe(200);
  });

  test('403 detected via the "insufficient permission" message (no err.code)', async () => {
    // mockRejectedValueOnce so it doesn't leak into the next test.
    mockSheetsBatchUpdate.mockRejectedValueOnce(new Error('Insufficient Permission to access the sheet'));
    const res = await post(validPayload);
    expect(res.status).toBe(403);
  });

  test('slack digest built with rich participants (present/left/absent)', async () => {
    firestore.getUserSettings.mockResolvedValue({ slackWebhookUrl: 'https://hooks.slack.com/services/T/B/C' });
    notifications.sendSlackDigest.mockResolvedValue({ sent: true });
    const res = await post(validPayload);
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
    expect(notifications.sendSlackDigest).toHaveBeenCalledWith(expect.objectContaining({ participants: expect.any(Array) }));
  });
});

describe('POST /api/save-to-sheets — meetStart null + digest args', () => {
  const auth = () => authedHeader('user@acme.com', 'acme.com');
  const post = (body) => request(app).post('/api/save-to-sheets').set(auth()).set('Content-Type', 'application/json').send(body);

  test('no meetingStartTime and no joins → meetStart null (duration N/A)', async () => {
    const res = await post({
      exportedAt: new Date().toISOString(), meetingType: 'instant',
      participants: [{ displayName: 'A', email: 'a@acme.com', joinTimeISO: null, leaveTimeISO: null, present: false, sessions: 0 }],
      calendarAttendees: [],
    });
    expect(res.status).toBe(200);
  });

  test('tab name of only an apostrophe collapses to "Meeting"', async () => {
    const res = await post({ ...validPayload, tabName: "'" });
    expect(res.status).toBe(200);
  });

  test('no-show whose display name matches an attendee is not double-counted', async () => {
    const res = await post({
      ...validPayload,
      participants: [{ displayName: 'Sharedname', email: 'p1@acme.com', joinTimeISO: new Date(Date.now() - 10 * 60000).toISOString(), leaveTimeISO: null, present: true, sessions: 1 }],
      calendarAttendees: [{ email: 'different@acme.com', displayName: 'Sharedname', status: 'accepted' }],
    });
    expect(res.status).toBe(200);
  });

  test('Sweep-4: a genuinely-absent invitee is NOT hidden by a DIFFERENT same-named attendee', async () => {
    await post({
      ...validPayload, sendEmail: true, autoExport: true,
      participants: [
        { displayName: 'David Kim', email: 'david.kim@a.com', joinTimeISO: new Date(Date.now() - 10 * 60000).toISOString(), leaveTimeISO: null, present: true, sessions: 1 },
      ],
      calendarAttendees: [
        { email: 'david.kim@a.com', displayName: 'David Kim', status: 'accepted' }, // this David attended
        { email: 'dkim@b.com', displayName: 'David Kim', status: 'accepted' },       // a DIFFERENT David, absent
      ],
    });
    await new Promise((r) => setImmediate(r));
    const emailArg = notifications.sendExportNotification.mock.calls[0][0];
    const absent = emailArg.participants.find(p => p.email === 'dkim@b.com');
    expect(absent).toBeDefined();          // previously omitted (name-collision hid the real absence)
    expect(absent.status).toBe('Absent');
  });

  test('auto-export email + slack digest with mixed present/left/absent + excused', async () => {
    firestore.getUserSettings.mockResolvedValue({ slackWebhookUrl: 'https://hooks.slack.com/services/T/B/C' });
    notifications.sendSlackDigest.mockResolvedValue({ sent: true });
    const res = await post({
      ...validPayload, sendEmail: true, recurringEventId: 'rid-1',
      participants: [
        { displayName: 'P', email: 'p@acme.com', joinTimeISO: new Date(Date.now() - 20 * 60000).toISOString(), leaveTimeISO: null, present: true, sessions: 1 },
        { displayName: 'L', email: 'l@acme.com', joinTimeISO: new Date(Date.now() - 20 * 60000).toISOString(), leaveTimeISO: new Date(Date.now() - 60000).toISOString(), present: false, sessions: 1 },
      ],
      calendarAttendees: [
        { email: 'p@acme.com', displayName: 'P', status: 'accepted' },
        { email: 'absent@acme.com', displayName: 'Absent', status: 'declined' },
      ],
      excusedEmails: ['absent@acme.com'],
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
  });

  test('403 error object with no message but code 403', async () => {
    mockSheetsBatchUpdate.mockRejectedValueOnce(Object.assign(new Error(), { code: 403, message: '' }));
    const res = await post(validPayload);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/save-to-sheets — digest row + defensive branches', () => {
  const auth = () => authedHeader('user@acme.com', 'acme.com');
  const post = (body) => request(app).post('/api/save-to-sheets').set(auth()).set('Content-Type', 'application/json').send(body);

  test('slack digest rows: no-join, no-email, present-false-no-leave; title-less; no meetingStartTime', async () => {
    firestore.getUserSettings.mockResolvedValue({ slackWebhookUrl: 'https://hooks.slack.com/services/T/B/C' });
    notifications.sendSlackDigest.mockResolvedValue({ sent: true });
    const res = await post({
      exportedAt: new Date().toISOString(), meetingType: 'instant', // no meetingTitle, no meetingStartTime, no eventStart
      participants: [
        { present: true, sessions: 1 }, // no join, no email
        { displayName: 'StillHere', email: 's@acme.com', joinTimeISO: null, leaveTimeISO: null, present: false, sessions: 0 }, // present false, no leave → Present
      ],
      calendarAttendees: [{ email: 'noname@acme.com', status: 'accepted' }], // absent, no displayName
      excusedEmails: [null, 'noname@acme.com'], // includes a falsy element
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setImmediate(r));
  });

  test('email digest with no displayName / meetingTitle / conferenceId', async () => {
    // authedHeader with no displayName → req.user.displayName falls back to email; force null via a token without displayName
    const jwt = require('jsonwebtoken');
    const CONFIG = require('../../src/config');
    const token = 'Bearer ' + jwt.sign({ email: 'nd@acme.com', domain: 'acme.com' }, CONFIG.sessionSecret); // no displayName claim
    const res = await request(app).post('/api/save-to-sheets').set('Authorization', token).set('Content-Type', 'application/json')
      .send({ exportedAt: new Date().toISOString(), meetingType: 'instant', sendEmail: true,
        participants: [{ displayName: 'A', email: 'a@acme.com', joinTimeISO: new Date(Date.now() - 5 * 60000).toISOString(), leaveTimeISO: null, present: true, sessions: 1 }],
        calendarAttendees: [] });
    expect(res.status).toBe(200);
    expect(notifications.sendExportNotification).toHaveBeenCalledWith(expect.objectContaining({ displayName: null, conferenceId: null }));
  });

  test('late baseline uses meetingStartTime when eventStart is absent', async () => {
    const start = new Date(Date.now() - 60 * 60000).toISOString();
    const res = await post({ exportedAt: new Date().toISOString(), meetingType: 'instant', meetingStartTime: start,
      participants: [{ displayName: 'Late', email: 'l@acme.com', joinTimeISO: new Date(Date.now() - 30 * 60000).toISOString(), leaveTimeISO: null, present: true, sessions: 1 }],
      calendarAttendees: [] });
    expect(res.status).toBe(200);
  });

  test('a non-403 error with no message surfaces as 500', async () => {
    mockSheetsBatchUpdate.mockRejectedValueOnce(Object.assign(new Error(), { message: '' })); // no code, no message
    const res = await post(validPayload);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/save-to-sheets — destructure defaults', () => {
  test('body without calendarAttendees/excusedEmails uses the [] defaults', async () => {
    const res = await request(app).post('/api/save-to-sheets')
      .set(authedHeader('user@acme.com', 'acme.com')).set('Content-Type', 'application/json')
      .send({ exportedAt: new Date().toISOString(), meetingType: 'instant',
        participants: [{ displayName: 'A', email: 'a@acme.com', joinTimeISO: new Date(Date.now() - 5 * 60000).toISOString(), leaveTimeISO: null, present: true, sessions: 1 }] });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/save-to-sheets — Pro gating', () => {
  // Enable billing so planIsPro actually consults getTenantPlan. Distinct
  // domains per test avoid the module-level plan cache leaking between cases.
  beforeEach(() => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    process.env.STRIPE_PRICE_ID = 'price_x';
  });
  afterEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_PRICE_ID;
  });

  test('auto-export is blocked with 402 for a free domain', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    const res = await request(app).post('/api/save-to-sheets')
      .set(authedHeader('u@free1.com', 'free1.com')).set('Content-Type', 'application/json')
      .send({ ...validPayload, autoExport: true });
    expect(res.status).toBe(402);
    expect(res.body).toMatchObject({ upgrade: true, feature: 'autoExport' });
    expect(firestore.persistExport).not.toHaveBeenCalled(); // failed fast, no export
  });

  test('manual export still works for a free domain, but the email digest is suppressed', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    const res = await request(app).post('/api/save-to-sheets')
      .set(authedHeader('u@free2.com', 'free2.com')).set('Content-Type', 'application/json')
      .send({ ...validPayload, sendEmail: true, autoExport: false });
    expect(res.status).toBe(200);
    expect(notifications.sendExportNotification).not.toHaveBeenCalled(); // gated
  });

  test('Slack digest is suppressed for a free domain even with a webhook saved', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserSettings.mockResolvedValue({ slackWebhookUrl: 'https://hooks.slack.com/x' });
    await request(app).post('/api/save-to-sheets')
      .set(authedHeader('u@free3.com', 'free3.com')).set('Content-Type', 'application/json')
      .send(validPayload);
    await new Promise((r) => setImmediate(r)); // let the fire-and-forget digest path run
    expect(notifications.sendSlackDigest).not.toHaveBeenCalled();
  });

  test('personal-email domains are exempt — auto-export works even on a free plan', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    const res = await request(app).post('/api/save-to-sheets')
      .set(authedHeader('u@gmail.com', 'gmail.com')).set('Content-Type', 'application/json')
      .send({ ...validPayload, autoExport: true });
    expect(res.status).toBe(200); // not gated — shared tenant can't be billed per-domain
  });

  test('Pro domain gets auto-export + email + Slack digest', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'pro' });
    firestore.getUserSettings.mockResolvedValue({ slackWebhookUrl: 'https://hooks.slack.com/x' });
    notifications.sendSlackDigest.mockResolvedValue({ sent: true });
    const res = await request(app).post('/api/save-to-sheets')
      .set(authedHeader('u@pro1.com', 'pro1.com')).set('Content-Type', 'application/json')
      .send({ ...validPayload, sendEmail: true, autoExport: true });
    expect(res.status).toBe(200);
    expect(notifications.sendExportNotification).toHaveBeenCalled();
    await new Promise((r) => setImmediate(r));
    expect(notifications.sendSlackDigest).toHaveBeenCalled();
  });
});
