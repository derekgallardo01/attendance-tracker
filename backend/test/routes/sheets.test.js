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
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
}));

jest.mock('../../src/lib/notifications', () => ({
  sendExportNotification: jest.fn(),
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
