// Tests for POST /api/export/pdf — auth, input validation, the inline-participants
// path, and the conferenceId (history) path. The PDF content itself is unit-tested
// in test/lib/certificate.test.js; here we assert plumbing + status codes.
const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

jest.mock('../../src/services/firestore', () => ({
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
  getMeetingWithParticipants: jest.fn(),
  saveVerifications: jest.fn(),
  getTenantPlan: jest.fn(),
  getUserPlan: jest.fn(),
  isMeetingUnlocked: jest.fn(),
  countUserMonthlyExports: jest.fn(),
  persistExport: jest.fn(),
  markUserLargeClassGraceUsed: jest.fn(),
  getExportReexportCount: jest.fn(),
  getUserMeetingHistory: jest.fn(),
  getDomainTeacherCount: jest.fn(),
  getDb: jest.fn(),
  logEvent: jest.fn(),
}));

jest.mock('../../src/lib/notifications', () => ({
  sendAdminEmail: jest.fn().mockResolvedValue({ sent: true }),
}));

const firestore = require('../../src/services/firestore');

// supertest doesn't buffer binary bodies by default — collect the raw bytes.
const binaryParser = (res, cb) => {
  const chunks = [];
  res.on('data', (c) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

const H = () => authedHeader('user@acme.com', 'acme.com', 'Dr. Smith');
const PARTS = [
  { displayName: 'Ada', email: 'ada@x.com', joinTimeISO: '2026-08-20T14:00:00Z', leaveTimeISO: '2026-08-20T14:50:00Z', present: false },
  { displayName: 'Grace', email: 'grace@x.com', joinTimeISO: '2026-08-20T14:05:00Z', present: true },
];

let app;
beforeEach(() => {
  jest.clearAllMocks();
  firestore.getUser.mockImplementation(async (domain, email) => ({ email, domain, hasUsedLargeClassGrace: false }));
  firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
  firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
  firestore.isMeetingUnlocked.mockResolvedValue(false);
  firestore.countUserMonthlyExports.mockResolvedValue(0);
  firestore.persistExport.mockResolvedValue({ created: true });
  firestore.markUserLargeClassGraceUsed.mockResolvedValue(true);
  firestore.getExportReexportCount.mockResolvedValue(0);
  app = buildApp();
});

test('401 without auth', async () => {
  const res = await request(app).post('/api/export/pdf').send({ participants: PARTS });
  expect(res.status).toBe(401);
});

test('400 for an unsupported type', async () => {
  const res = await request(app).post('/api/export/pdf').set(H()).send({ type: 'transcript', participants: PARTS });
  expect(res.status).toBe(400);
  expect(res.body.feature).toBe('transcript');
});

test('400 when neither participants nor conferenceId provided', async () => {
  const res = await request(app).post('/api/export/pdf').set(H()).send({});
  expect(res.status).toBe(400);
});

test('200 PDF from inline participants', async () => {
  const res = await request(app)
    .post('/api/export/pdf').set(H())
    .send({ meetingTitle: 'Bio 101', conferenceId: 'abc', participants: PARTS })
    .buffer(true).parse(binaryParser);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('application/pdf');
  expect(res.headers['content-disposition']).toContain('attendance-bio-101.pdf');
  expect(res.body.slice(0, 5).toString('latin1')).toBe('%PDF-');
  // inline participants must NOT trigger a Firestore read
  expect(firestore.getMeetingWithParticipants).not.toHaveBeenCalled();
});

test('conferenceId path regenerates from persisted attendance', async () => {
  firestore.getMeetingWithParticipants.mockResolvedValue({
    conferenceId: 'abc', title: 'History Class',
    startTime: '2026-08-20T14:00:00Z', endTime: '2026-08-20T15:00:00Z', participants: PARTS,
  });
  const res = await request(app)
    .post('/api/export/pdf').set(H())
    .send({ conferenceId: 'abc' })
    .buffer(true).parse(binaryParser);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toBe('application/pdf');
  // Ownership fence: the caller's email is passed so the helper can verify the
  // requester actually tracked this meeting (no cross-user roster leak).
  expect(firestore.getMeetingWithParticipants).toHaveBeenCalledWith('acme.com', 'abc', 'user@acme.com');
  expect(res.body.slice(0, 5).toString('latin1')).toBe('%PDF-');
});

test('404 when the conferenceId meeting is not found', async () => {
  firestore.getMeetingWithParticipants.mockResolvedValue(null);
  const res = await request(app).post('/api/export/pdf').set(H()).send({ conferenceId: 'missing' });
  expect(res.status).toBe(404);
});

test('404 when the caller did not track the meeting (helper returns null on ownership fail)', async () => {
  // getMeetingWithParticipants returns null when the requester has no tracked
  // event for the conferenceId — the route must not leak that it exists.
  firestore.getMeetingWithParticipants.mockResolvedValue(null);
  const res = await request(app).post('/api/export/pdf').set(H()).send({ conferenceId: 'someone-elses' });
  expect(res.status).toBe(404);
  expect(firestore.getMeetingWithParticipants).toHaveBeenCalledWith('acme.com', 'someone-elses', 'user@acme.com');
});

describe('certificates (Pro-gated)', () => {
  // Turn billing ON so the Pro gate is actually enforced (planIsPro reads the
  // tenant plan). Cleaned up so other suites keep the default free-for-all.
  beforeEach(() => { process.env.STRIPE_SECRET_KEY = 'sk_test_x'; process.env.STRIPE_PRICE_ID = 'price_x'; });
  afterEach(() => { delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_PRICE_ID; });

  test('402 for a free user', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    const res = await request(app).post('/api/export/pdf').set(H())
      .send({ type: 'certificates', meetingTitle: 'CLE', participants: PARTS });
    expect(res.status).toBe(402);
    expect(res.body.upgrade).toBe(true);
    expect(res.body.feature).toBe('certificates');
  });

  test('200 multi-page PDF for a Pro user', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'pro' });
    const res = await request(app).post('/api/export/pdf').set(H())
      .send({ type: 'certificates', meetingTitle: 'CLE', participants: PARTS })
      .buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('certificates-cle.pdf');
    expect(res.body.slice(0, 5).toString('latin1')).toBe('%PDF-');
    // each issued certificate is recorded for the public verify page
    expect(firestore.saveVerifications).toHaveBeenCalledTimes(1);
    const records = firestore.saveVerifications.mock.calls[0][0];
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ type: 'certificate', session: 'CLE', domain: 'acme.com' });
    expect(records[0].code).toMatch(/^AT-[0-9A-F]{8}$/);
  });

  test('400 when there are no present attendees to certify', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'pro' });
    const res = await request(app).post('/api/export/pdf').set(H())
      .send({ type: 'certificates', meetingTitle: 'CLE', participants: [{ displayName: 'Al', present: false, status: 'Absent' }] });
    expect(res.status).toBe(400);
  });

  test('issuer/courseCode/creditHours flow into the certificate records, LENGTH-CAPPED', async () => {
    // These fields were accepted by the backend forever but no frontend sent
    // them — this locks the now-wired contract (and the layout-overrun caps).
    firestore.getTenantPlan.mockResolvedValue({ plan: 'pro' });
    const res = await request(app).post('/api/export/pdf').set(H())
      .send({
        type: 'certificates', meetingTitle: 'CLE', participants: PARTS,
        issuer: '  Central Bicol State University ' + 'x'.repeat(200),
        courseCode: 'BIO-101' + 'y'.repeat(100),
        creditHours: 1.5,
      })
      .buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    const rec = firestore.saveVerifications.mock.calls[0][0][0];
    expect(rec.issuer.startsWith('Central Bicol State University')).toBe(true);
    expect(rec.issuer.length).toBeLessThanOrEqual(80);   // capped
    expect(rec.detailLabel).toContain('1.5');            // fixed credit label wins
  });

  test('free user report: brand is stripped (default footer), no hard block', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    const res = await request(app).post('/api/export/pdf').set(H())
      .send({ type: 'report', meetingTitle: 'CLE', participants: PARTS, brand: { name: 'Fancy Org' } })
      .buffer(true).parse(binaryParser);
    expect(res.status).toBe(200); // gentle: report succeeds, brand just ignored
  });

  test('200 multi-page PDF for a free user with unlocked meeting pass', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
    firestore.isMeetingUnlocked.mockResolvedValue(true);
    const res = await request(app).post('/api/export/pdf').set(H())
      .send({ type: 'certificates', meetingTitle: 'CLE', conferenceId: 'c1', participants: PARTS })
      .buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('certificates-cle.pdf');
    expect(res.body.slice(0, 5).toString('latin1')).toBe('%PDF-');
    expect(firestore.isMeetingUnlocked).toHaveBeenCalledWith('acme.com', 'user@acme.com', 'c1');
    expect(firestore.saveVerifications).toHaveBeenCalledTimes(1);
  });

  test('free user with unlocked meeting: brand is preserved in report', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
    firestore.isMeetingUnlocked.mockResolvedValue(true);
    const res = await request(app).post('/api/export/pdf').set(H())
      .send({ type: 'report', meetingTitle: 'CLE', conferenceId: 'c1', participants: PARTS, brand: { name: 'Fancy Org' } })
      .buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    expect(firestore.isMeetingUnlocked).toHaveBeenCalledWith('acme.com', 'user@acme.com', 'c1');
    expect(res.body.slice(0, 5).toString('latin1')).toBe('%PDF-');
  });

  test('free user report: returns 402 largeClass if participants > 25 and grace used', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUser.mockResolvedValue({ hasUsedLargeClassGrace: true });
    const parts26 = Array.from({ length: 26 }, (_, i) => ({ displayName: `Student ${i}`, email: `s${i}@x.com`, present: true }));
    const res = await request(app).post('/api/export/pdf').set(H())
      .send({ type: 'report', meetingTitle: 'Big Class', participants: parts26 });
    expect(res.status).toBe(402);
    expect(res.body.feature).toBe('largeClass');
    expect(res.body.participantCount).toBe(26);
    expect(firestore.persistExport).not.toHaveBeenCalled();
  });

  test('free user report: grants grace on first large class (>25 attendees)', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUser.mockResolvedValue({ hasUsedLargeClassGrace: false });
    const parts26 = Array.from({ length: 26 }, (_, i) => ({ displayName: `Student ${i}`, email: `s${i}@x.com`, present: true }));
    const res = await request(app).post('/api/export/pdf').set(H())
      .send({ type: 'report', meetingTitle: 'Big Class', participants: parts26 })
      .buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    expect(firestore.markUserLargeClassGraceUsed).toHaveBeenCalledWith('acme.com', 'user@acme.com');
    expect(firestore.persistExport).toHaveBeenCalledWith('acme.com', expect.objectContaining({
      participantCount: 26,
      exportType: 'pdf',
    }));
  });

  test('free user report: returns 402 exportQuota if monthly limit reached', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
    firestore.countUserMonthlyExports.mockResolvedValue(2);
    const res = await request(app).post('/api/export/pdf').set(H())
      .send({ type: 'report', meetingTitle: 'Class 3', participants: PARTS });
    expect(res.status).toBe(402);
    expect(res.body.feature).toBe('exportQuota');
    expect(res.body.used).toBe(2);
    expect(res.body.limit).toBe(2);
    expect(firestore.persistExport).not.toHaveBeenCalled();
  });

  test('free user report: records export via persistExport on success', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
    firestore.countUserMonthlyExports.mockResolvedValue(0);
    const res = await request(app).post('/api/export/pdf').set(H())
      .send({ type: 'report', meetingTitle: 'History Class', conferenceId: 'hist-1', participants: PARTS })
      .buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    expect(firestore.persistExport).toHaveBeenCalledWith('acme.com', expect.objectContaining({
      domain: 'acme.com',
      email: 'user@acme.com',
      meetingTitle: 'History Class',
      tabName: 'PDF Export',
      conferenceId: 'hist-1',
      participantCount: 2,
      exportType: 'pdf',
    }));
  });

  test('pro user report: does not invoke persistExport or quota check', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'pro' });
    const res = await request(app).post('/api/export/pdf').set(H())
      .send({ type: 'report', meetingTitle: 'Pro Class', participants: PARTS })
      .buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    expect(firestore.countUserMonthlyExports).not.toHaveBeenCalled();
    expect(firestore.persistExport).not.toHaveBeenCalled();
  });

  test('free user report: returns 402 exportQuota when re-export limit (2) is reached for the meeting', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
    firestore.countUserMonthlyExports.mockResolvedValue(1);
    firestore.getExportReexportCount.mockResolvedValue(2);
    const res = await request(app).post('/api/export/pdf').set(H())
      .send({ type: 'report', meetingTitle: 'History Class', conferenceId: 'hist-1', participants: PARTS });
    expect(res.status).toBe(402);
    expect(res.body.feature).toBe('exportQuota');
    expect(res.body.error).toContain('maximum number of times');
    expect(firestore.persistExport).not.toHaveBeenCalled();
  });

  test('free user report: counts calendarAttendees no-shows toward >25 largeClass check', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUser.mockResolvedValue({ email: 'user@acme.com', domain: 'acme.com', hasUsedLargeClassGrace: true });
    firestore.countUserMonthlyExports.mockResolvedValue(0);
    const calInvitees = Array.from({ length: 25 }, (_, i) => ({
      email: `invitee${i + 1}@acme.com`,
      displayName: `Invitee ${i + 1}`,
      responseStatus: 'accepted',
    }));
    const res = await request(app).post('/api/export/pdf').set(H())
      .send({ type: 'report', meetingTitle: 'Large Calendar Class', participants: PARTS, calendarAttendees: calInvitees });
    expect(res.status).toBe(402);
    expect(res.body.feature).toBe('largeClass');
    expect(res.body.participantCount).toBe(27);
  });

  test('free user report: derives deterministic fallback token when conferenceId is omitted', async () => {
    firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
    firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
    firestore.countUserMonthlyExports.mockResolvedValue(0);
    const res = await request(app).post('/api/export/pdf').set(H())
      .send({ type: 'report', meetingTitle: 'Adhoc Session', participants: PARTS })
      .buffer(true).parse(binaryParser);
    expect(res.status).toBe(200);
    expect(firestore.persistExport).toHaveBeenCalledWith('acme.com', expect.objectContaining({
      conferenceId: expect.stringMatching(/^Adhoc Session_\d{4}-\d{2}-\d{2}T\d{2}$/),
      exportType: 'pdf',
    }));
  });
});

describe('POST /api/export/quote-pdf', () => {
  test('401 without auth', async () => {
    const res = await request(app).post('/api/export/quote-pdf').send({});
    expect(res.status).toBe(401);
  });

  test('200 generates forwardable school quote PDF, persists quoteRequests, and logs event', async () => {
    const mockAdd = jest.fn().mockResolvedValue({ id: 'q1' });
    firestore.getDb.mockReturnValue({ collection: jest.fn(() => ({ add: mockAdd })) });
    firestore.getUserMeetingHistory.mockResolvedValue({
      totalMeetings: 18,
      people: [{ email: 's1@acme.com' }, { email: 's2@acme.com' }],
    });
    firestore.getDomainTeacherCount.mockResolvedValue(6);
    firestore.logEvent.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/export/quote-pdf')
      .set(H())
      .send({ schoolName: 'Acme Academy', department: 'Biology', notes: 'Need PO for Fall semester' })
      .buffer(true).parse(binaryParser);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('quote-acme-academy-qt-');
    expect(res.body.slice(0, 5).toString('latin1')).toBe('%PDF-');
    expect(mockAdd).toHaveBeenCalledWith(expect.objectContaining({
      email: 'user@acme.com',
      domain: 'acme.com',
      schoolName: 'Acme Academy',
      department: 'Biology',
      recommendedPlan: 'department',
    }));
    expect(firestore.logEvent).toHaveBeenCalledWith('acme.com', expect.objectContaining({
      email: 'user@acme.com',
      type: 'school_quote_generated',
    }));
  });
});
