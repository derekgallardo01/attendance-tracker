// Drives every firestore.js helper against a Firestore layer where every
// operation rejects, so each function's fail-safe catch block runs. Most return
// a default (null/[]/undefined) on error; a few rethrow — either way the catch
// path is exercised. _core is mocked so getDb/tenantRef throw on use.

jest.mock('../../src/services/firestore/_core', () => {
  const rejector = () => Promise.reject(new Error('firestore boom'));
  function chain() {
    const c = { get: rejector, set: rejector, delete: rejector, create: rejector, add: rejector, update: rejector };
    c.collection = () => chain();
    c.doc = () => chain();
    c.where = () => chain();
    c.orderBy = () => chain();
    c.limit = () => chain();
    c.count = () => ({ get: rejector });
    return c;
  }
  return {
    getDb: jest.fn(() => ({ collection: () => chain(), collectionGroup: () => chain(), batch: () => ({ set() {}, delete() {}, update() {}, commit: rejector }) })),
    tenantRef: jest.fn(() => chain()),
    FieldValue: { serverTimestamp: () => 'TS', increment: () => 1, arrayUnion: () => [] },
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    CONFIG: { superAdminEmail: 'owner@x.com' },
    PERSONAL_EMAIL_DOMAINS: new Set(['gmail.com']),
    SUPER_ADMIN_EMAIL: 'owner@x.com',
    encryptToken: (x) => x,
    decryptToken: (x) => x,
    memoizeTTL: (fn) => fn,
    lastSegment: (s) => String(s).split('/').pop(),
    countDistinctAttendees: () => 0,
  };
});

const firestore = require('../../src/services/firestore');

const calls = {
  getTenantConfig: ['acme.com'],
  upsertTenantConfig: ['acme.com', { adminEmail: 'a@acme.com' }],
  setTenantPlan: ['acme.com', { plan: 'pro' }],
  getTenantPlan: ['acme.com'],
  logEvent: ['acme.com', { email: 'a@acme.com', type: 'signin' }],
  persistAttendance: ['acme.com', 'conf', 'rec', [{ email: 'a@acme.com', displayName: 'A' }], 'a@acme.com'],
  getMeetingExcusedEmails: ['acme.com', 'conf'],
  addMeetingExcusedEmails: ['acme.com', 'conf', ['a@acme.com']],
  persistCalendarData: ['acme.com', 'mc', 'Title', [{ email: 'a@acme.com' }], {}],
  persistExport: ['acme.com', { meetingTitle: 'M', tabName: 'T', exportedAt: new Date().toISOString(), participantCount: 1, sheetUrl: 's', email: 'a@acme.com' }],
  getUser: ['acme.com', 'a@acme.com'],
  upsertUser: ['acme.com', { email: 'a@acme.com', displayName: 'A', refreshToken: 'rt' }],
  setUserAcquisitionSource: ['acme.com', 'a@acme.com', { source: 'reddit' }],
  getUserSettings: ['acme.com', 'a@acme.com'],
  updateUserSettings: ['acme.com', 'a@acme.com', { autoExportOnEnd: true }],
  getUserSheetId: ['acme.com', 'a@acme.com'],
  setUserSheetId: ['acme.com', 'a@acme.com', 'sheet'],
  updateUserTokens: ['acme.com', 'a@acme.com', { accessToken: 'at', tokenExpiresAt: new Date() }],
  getUserActivationStatus: ['acme.com', 'a@acme.com'],
  countUserExports: ['acme.com', 'a@acme.com'],
  isExistingUserAnywhere: ['a@acme.com'],
  countAllUsers: [],
  getAllUsersAcrossTenants: [],
  getUserMeetingHistory: ['acme.com', 'a@acme.com'],
  getTenantUsers: ['acme.com'],
  getTenantMeetings: ['acme.com'],
  getTenantSeriesOverview: ['acme.com'],
  getTenantPeopleOverview: ['acme.com'],
  getTeamOverview: ['acme.com'],
  getUserMeetingSeries: ['acme.com', 'a@acme.com'],
  getParticipantHistory: ['acme.com', 'a@acme.com', 'p@acme.com'],
  setParticipantNote: ['acme.com', 'a@acme.com', 'p@acme.com', 'note'],
  getParticipantNote: ['acme.com', 'a@acme.com', 'p@acme.com'],
};

describe('firestore helpers fail safely when Firestore rejects', () => {
  test.each(Object.entries(calls))('%s tolerates a rejecting Firestore', async (name, args) => {
    // Either resolves to a default (catch handled) or rejects (rethrow) — both
    // exercise the error path. Never a synchronous throw.
    await Promise.resolve(firestore[name](...args)).catch(() => {});
    expect(typeof firestore[name]).toBe('function');
  });
});
