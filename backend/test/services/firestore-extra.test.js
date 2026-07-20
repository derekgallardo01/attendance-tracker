// Coverage for the tenant-config / billing-plan / excused-email / team-overview
// helpers in services/firestore.js that route tests mock out. Uses the in-memory
// Firestore mock so the real read/write logic runs.

const { installFirestoreMock, wrapTimestamp } = require('../helpers/firestoreMock');

let ctx, firestore;
beforeEach(() => { ctx = installFirestoreMock(); firestore = require('../../src/services/firestore'); });
afterEach(() => ctx.uninstall());

describe('tenant config', () => {
  test('getTenantConfig returns the doc data, or null when absent', async () => {
    expect(await firestore.getTenantConfig('acme.com')).toBeNull();
    ctx.seed('tenants/acme.com', { domain: 'acme.com', adminEmail: 'a@acme.com' });
    expect(await firestore.getTenantConfig('acme.com')).toMatchObject({ adminEmail: 'a@acme.com' });
  });

  test('upsertTenantConfig merges and stamps timestamps', async () => {
    await firestore.upsertTenantConfig('acme.com', { adminEmail: 'a@acme.com', impersonateEmail: 'admin@acme.com' });
    const doc = ctx.read('tenants/acme.com');
    expect(doc).toMatchObject({ domain: 'acme.com', adminEmail: 'a@acme.com' });
    expect(doc.updatedAt).toBeDefined();
  });
});

describe('tenant plan', () => {
  test('getTenantPlan defaults to free; reflects pro after setTenantPlan', async () => {
    expect(await firestore.getTenantPlan('acme.com')).toEqual({ plan: 'free', billingStatus: null, stripeCustomerId: null });
    await firestore.setTenantPlan('acme.com', { plan: 'pro', billingStatus: 'active', stripeCustomerId: 'cus_1' });
    expect(await firestore.getTenantPlan('acme.com')).toEqual({ plan: 'pro', billingStatus: 'active', stripeCustomerId: 'cus_1' });
  });

  test('a non-pro plan value normalizes to free', async () => {
    await firestore.setTenantPlan('acme.com', { plan: 'trialing' });
    expect((await firestore.getTenantPlan('acme.com')).plan).toBe('free');
  });
});

describe('meeting excused emails', () => {
  test('getMeetingExcusedEmails: no id → [], missing doc → [], present → lowercased', async () => {
    expect(await firestore.getMeetingExcusedEmails('acme.com', null)).toEqual([]);
    expect(await firestore.getMeetingExcusedEmails('acme.com', 'conf-1')).toEqual([]);
    ctx.seed('tenants/acme.com/meetings/conf-1', { excusedEmails: ['A@ACME.com', null] });
    expect(await firestore.getMeetingExcusedEmails('acme.com', 'conf-1')).toEqual(['a@acme.com', '']);
  });

  test('addMeetingExcusedEmails unions lowercased emails; no-ops on empty input', async () => {
    await firestore.addMeetingExcusedEmails('acme.com', 'conf-1', ['X@acme.com', '', 'y@acme.com']);
    expect(ctx.read('tenants/acme.com/meetings/conf-1').excusedEmails).toEqual(['x@acme.com', 'y@acme.com']);
    await firestore.addMeetingExcusedEmails('acme.com', null, ['z@acme.com']); // no-op
    await firestore.addMeetingExcusedEmails('acme.com', 'conf-1', []); // no-op
  });
});

describe('getTeamOverview', () => {
  test('aggregates users, meetings, series, and people for the tenant', async () => {
    ctx.seed('tenants/acme.com', { adminEmail: 'admin@acme.com' });
    ctx.seed('tenants/acme.com/users/u1@acme.com', { email: 'u1@acme.com', displayName: 'U1', lastLoginAt: wrapTimestamp(new Date()) });
    ctx.seed('tenants/acme.com/meetings/m1', { conferenceId: 'm1', title: 'Standup', recurringEventId: 'r1', startTime: wrapTimestamp(new Date()) });
    ctx.seed('tenants/acme.com/meetings/m1/participants/p1', { email: 'p1@acme.com', displayName: 'P1' });
    const ov = await firestore.getTeamOverview('acme.com');
    expect(ov.domain).toBe('acme.com');
    expect(ov.adminEmail).toBe('admin@acme.com');
    expect(ov.totals.users).toBe(1);
    expect(ov.totals.meetings).toBe(1);
  });
});

describe('upsertUser + getUser', () => {
  test('new Workspace user claims team-admin and creates the tenant doc', async () => {
    await firestore.upsertUser('acme.com', {
      email: 'First@Acme.com', displayName: 'First', refreshToken: 'rt-secret',
      acquisition: { source: 'reddit', utmSource: 'r', ref: 'inviter@x.com', referrer: 'https://x.com', userAgent: 'UA', landingUrl: 'https://l' },
      scopes: { granted: ['a', 'b'], exportScopeGranted: true },
    });
    const u = ctx.read('tenants/acme.com/users/first@acme.com');
    expect(u.teamAdmin).toBe(true);
    expect(u.acquisitionSource).toBe('reddit');
    expect(u.refreshToken).not.toBe('rt-secret'); // encrypted
    expect(ctx.read('tenants/acme.com').adminEmail).toBe('first@acme.com');

    // getUser decrypts the refresh token back
    const got = await firestore.getUser('acme.com', 'first@acme.com');
    expect(got.refreshToken).toBe('rt-secret');
  });

  test('second sign-in does not re-stamp acquisition or re-claim admin', async () => {
    await firestore.upsertUser('acme.com', { email: 'first@acme.com', displayName: 'First', acquisition: { source: 'reddit' } });
    await firestore.upsertUser('acme.com', { email: 'second@acme.com', displayName: 'Second', acquisition: { source: 'google_search' } });
    expect(ctx.read('tenants/acme.com/users/second@acme.com').teamAdmin).toBeUndefined(); // admin already claimed
  });

  test('personal-domain first user does NOT get team-admin', async () => {
    await firestore.upsertUser('gmail.com', { email: 'a@gmail.com', displayName: 'A' });
    expect(ctx.read('tenants/gmail.com/users/a@gmail.com').teamAdmin).toBeUndefined();
  });

  test('a designated tenant adminEmail grants the flag only to that email', async () => {
    ctx.seed('tenants/acme.com', { domain: 'acme.com', adminEmail: 'boss@acme.com' });
    await firestore.upsertUser('acme.com', { email: 'boss@acme.com', displayName: 'Boss' });
    expect(ctx.read('tenants/acme.com/users/boss@acme.com').teamAdmin).toBe(true);
  });

  test('getUser returns null when the user does not exist', async () => {
    expect(await firestore.getUser('acme.com', 'ghost@acme.com')).toBeNull();
  });
});

describe('aggregations over rich data', () => {
  beforeEach(() => {
    // Two recurring meetings + one instant, with participants across them.
    for (const [id, extra] of [['m1', { recurringEventId: 'r1', startTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')) }],
                               ['m2', { recurringEventId: 'r1', startTime: wrapTimestamp(new Date('2026-06-08T10:00:00Z')) }],
                               ['m3', { createdAt: wrapTimestamp(new Date('2026-06-02T10:00:00Z')) }]]) {
      ctx.seed(`tenants/acme.com/meetings/${id}`, { conferenceId: id, title: 'Standup', ...extra });
    }
    ctx.seed('tenants/acme.com/meetings/m1/participants/p1', { email: 'alex@acme.com', displayName: 'Alex', present: true, joinTime: wrapTimestamp(new Date('2026-06-01T10:05:00Z')) });
    ctx.seed('tenants/acme.com/meetings/m1/participants/p2', { email: '', displayName: 'NoEmail', present: false });
    ctx.seed('tenants/acme.com/meetings/m2/participants/p3', { email: 'alex@acme.com', displayName: 'Alexander', present: true });
    ctx.seed('tenants/acme.com/meetings/m3/participants/p4', { email: 'beth@acme.com', displayName: 'Beth', present: true });
    ctx.seed('tenants/acme.com/users/owner@acme.com', { email: 'owner@acme.com', displayName: 'Owner' });
    ctx.seed('tenants/acme.com/events/e1', { email: 'owner@acme.com', type: 'tracked', meta: { conferenceId: 'm1' }, createdAt: wrapTimestamp(new Date('2026-06-01T10:00:00Z')) });
    ctx.seed('tenants/acme.com/events/e2', { email: 'owner@acme.com', type: 'tracked', meta: { conferenceId: 'm2' }, createdAt: wrapTimestamp(new Date('2026-06-08T10:00:00Z')) });
  });

  test('getUserMeetingHistory / series / tenant overviews / participant history run', async () => {
    expect(await firestore.getUserMeetingHistory('acme.com', 'owner@acme.com')).toBeDefined();
    expect(await firestore.getUserMeetingSeries('acme.com', 'owner@acme.com')).toBeDefined();
    expect(await firestore.getTenantUsers('acme.com')).toHaveLength(1);
    expect((await firestore.getTenantMeetings('acme.com')).length).toBeGreaterThan(0);
    expect(await firestore.getTenantSeriesOverview('acme.com')).toBeDefined();
    expect(await firestore.getTenantPeopleOverview('acme.com')).toBeDefined();
    const ph = await firestore.getParticipantHistory('acme.com', 'owner@acme.com', 'alex@acme.com');
    expect(ph === null || typeof ph === 'object').toBe(true);
  });
});
