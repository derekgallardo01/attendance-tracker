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
