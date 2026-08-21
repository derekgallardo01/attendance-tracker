// Tests for POST /api/export/pdf — auth, input validation, the inline-participants
// path, and the conferenceId (history) path. The PDF content itself is unit-tested
// in test/lib/certificate.test.js; here we assert plumbing + status codes.
const request = require('supertest');
const { authedHeader, buildApp } = require('../helpers/testApp');

jest.mock('../../src/services/firestore', () => ({
  getUser: jest.fn(),
  updateUserTokens: jest.fn(),
  getMeetingWithParticipants: jest.fn(),
  getTenantPlan: jest.fn(),
  getUserPlan: jest.fn(),
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
  firestore.getUser.mockImplementation(async (domain, email) => ({ email, domain }));
  firestore.getTenantPlan.mockResolvedValue({ plan: 'free' });
  firestore.getUserPlan.mockResolvedValue({ plan: 'free' });
  app = buildApp();
});

test('401 without auth', async () => {
  const res = await request(app).post('/api/export/pdf').send({ participants: PARTS });
  expect(res.status).toBe(401);
});

test('400 for an unsupported type', async () => {
  const res = await request(app).post('/api/export/pdf').set(H()).send({ type: 'certificates', participants: PARTS });
  expect(res.status).toBe(400);
  expect(res.body.feature).toBe('certificates');
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
  expect(firestore.getMeetingWithParticipants).toHaveBeenCalledWith('acme.com', 'abc');
  expect(res.body.slice(0, 5).toString('latin1')).toBe('%PDF-');
});

test('404 when the conferenceId meeting is not found', async () => {
  firestore.getMeetingWithParticipants.mockResolvedValue(null);
  const res = await request(app).post('/api/export/pdf').set(H()).send({ conferenceId: 'missing' });
  expect(res.status).toBe(404);
});
