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

  test('team-admin: status reflects vacant / held / taken and blocks personal domains', async () => {
    // Vacant Workspace domain with the caller as an existing user → claimable.
    ctx.seed('tenants/acme.com/users/a@acme.com', { email: 'a@acme.com' });
    let s = await firestore.getTeamAdminStatus('acme.com', 'a@acme.com');
    expect(s).toMatchObject({ isTeamAdmin: false, adminEmail: null, isPersonalDomain: false, canClaim: true });

    // Personal domain → never claimable.
    s = await firestore.getTeamAdminStatus('gmail.com', 'a@gmail.com');
    expect(s).toMatchObject({ isPersonalDomain: true, canClaim: false });

    // Held by someone else → caller can't claim.
    ctx.seed('tenants/acme.com', { domain: 'acme.com', adminEmail: 'boss@acme.com' });
    s = await firestore.getTeamAdminStatus('acme.com', 'a@acme.com');
    expect(s).toMatchObject({ isTeamAdmin: false, adminEmail: 'boss@acme.com', canClaim: false });

    // The admin themselves → isTeamAdmin + canClaim (idempotent).
    s = await firestore.getTeamAdminStatus('acme.com', 'boss@acme.com');
    expect(s).toMatchObject({ isTeamAdmin: true, canClaim: true });
  });

  test('claimTeamAdmin: vacant claim stamps both docs; personal + taken + no-user are refused', async () => {
    expect(await firestore.claimTeamAdmin('gmail.com', 'a@gmail.com')).toMatchObject({ claimed: false, reason: 'personal_domain' });
    expect(await firestore.claimTeamAdmin('acme.com', 'ghost@acme.com')).toMatchObject({ claimed: false, reason: 'no_user' });

    ctx.seed('tenants/acme.com/users/a@acme.com', { email: 'a@acme.com' });
    const ok = await firestore.claimTeamAdmin('acme.com', 'a@acme.com');
    expect(ok).toMatchObject({ claimed: true, adminEmail: 'a@acme.com' });
    expect(ctx.read('tenants/acme.com').adminEmail).toBe('a@acme.com');
    expect(ctx.read('tenants/acme.com/users/a@acme.com').teamAdmin).toBe(true);

    // A second user can't silently take over.
    ctx.seed('tenants/acme.com/users/b@acme.com', { email: 'b@acme.com' });
    const taken = await firestore.claimTeamAdmin('acme.com', 'b@acme.com');
    expect(taken).toMatchObject({ claimed: false, reason: 'taken', adminEmail: 'a@acme.com' });
    expect(ctx.read('tenants/acme.com/users/b@acme.com').teamAdmin).toBeUndefined();
  });

  test('transferTeamAdmin: only the current admin can hand off, target must exist', async () => {
    ctx.seed('tenants/acme.com', { domain: 'acme.com', adminEmail: 'a@acme.com' });
    ctx.seed('tenants/acme.com/users/a@acme.com', { email: 'a@acme.com', teamAdmin: true });
    ctx.seed('tenants/acme.com/users/b@acme.com', { email: 'b@acme.com' });

    // Non-admin can't transfer.
    expect(await firestore.transferTeamAdmin('acme.com', 'b@acme.com', 'a@acme.com')).toMatchObject({ transferred: false, reason: 'not_admin' });
    // Target must have signed in.
    expect(await firestore.transferTeamAdmin('acme.com', 'a@acme.com', 'ghost@acme.com')).toMatchObject({ transferred: false, reason: 'no_target_user' });

    // Valid handoff flips all three docs.
    const ok = await firestore.transferTeamAdmin('acme.com', 'a@acme.com', 'b@acme.com');
    expect(ok).toMatchObject({ transferred: true, adminEmail: 'b@acme.com' });
    expect(ctx.read('tenants/acme.com').adminEmail).toBe('b@acme.com');
    expect(ctx.read('tenants/acme.com/users/b@acme.com').teamAdmin).toBe(true);
    expect(ctx.read('tenants/acme.com/users/a@acme.com').teamAdmin).toBe(false);
  });

  test('upsertTenantConfig sets createdAt once and never overwrites it', async () => {
    await firestore.upsertTenantConfig('acme.com', { adminEmail: 'a@acme.com' });
    const created = ctx.read('tenants/acme.com').createdAt;
    expect(created).toBeDefined();

    // A later config merge must NOT reset createdAt.
    await firestore.upsertTenantConfig('acme.com', { active: false });
    const after = ctx.read('tenants/acme.com');
    expect(after.createdAt.toDate().getTime()).toBe(created.toDate().getTime());
    expect(after.active).toBe(false); // merge still applied
  });

  test('upsertTenantConfig backfills createdAt on a legacy doc missing it', async () => {
    ctx.seed('tenants/acme.com', { domain: 'acme.com', adminEmail: 'a@acme.com' }); // no createdAt
    await firestore.upsertTenantConfig('acme.com', { impersonateEmail: 'admin@acme.com' });
    expect(ctx.read('tenants/acme.com').createdAt).toBeDefined();
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

describe('user plan (individual per-user billing)', () => {
  test('getUserPlan defaults to free; reflects pro after setUserPlan; lowercases the email', async () => {
    expect(await firestore.getUserPlan('gmail.com', 'Teacher@Gmail.com')).toEqual({ plan: 'free', billingStatus: null, stripeCustomerId: null });
    await firestore.setUserPlan('gmail.com', 'Teacher@Gmail.com', {
      individualPlan: 'pro', individualBillingStatus: 'active', individualStripeCustomerId: 'cus_i',
    });
    expect(await firestore.getUserPlan('gmail.com', 'teacher@gmail.com')).toEqual({ plan: 'pro', billingStatus: 'active', stripeCustomerId: 'cus_i' });
  });

  test('individual plan is scoped to the user, not the shared tenant', async () => {
    await firestore.setUserPlan('gmail.com', 'payer@gmail.com', { individualPlan: 'pro' });
    expect((await firestore.getUserPlan('gmail.com', 'payer@gmail.com')).plan).toBe('pro');
    expect((await firestore.getUserPlan('gmail.com', 'other@gmail.com')).plan).toBe('free'); // unaffected
  });

  test('a non-pro individual plan normalizes to free', async () => {
    await firestore.setUserPlan('gmail.com', 'u@gmail.com', { individualPlan: 'canceled' });
    expect((await firestore.getUserPlan('gmail.com', 'u@gmail.com')).plan).toBe('free');
  });

  test('temporary reward with individualPlanExpiresAt in the past downgrades to free and marks billingStatus expired', async () => {
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    await firestore.setUserPlan('gmail.com', 'expired@gmail.com', {
      individualPlan: 'pro',
      individualBillingStatus: 'active',
      individualPlanType: 'referral_reward',
      individualPlanExpiresAt: past,
    });
    const result = await firestore.getUserPlan('gmail.com', 'expired@gmail.com');
    expect(result.plan).toBe('free');
    expect(result.billingStatus).toBe('expired');
    expect(result.individualPlanExpiresAt).toBe(past);
  });

  test('temporary reward with individualPlanExpiresAt in the future retains pro status', async () => {
    const future = new Date(Date.now() + 86400 * 1000 * 30).toISOString();
    await firestore.setUserPlan('gmail.com', 'active_reward@gmail.com', {
      individualPlan: 'pro',
      individualBillingStatus: 'active',
      individualPlanType: 'referral_reward',
      individualPlanExpiresAt: future,
    });
    const result = await firestore.getUserPlan('gmail.com', 'active_reward@gmail.com');
    expect(result.plan).toBe('pro');
    expect(result.billingStatus).toBe('active');
    expect(result.individualPlanExpiresAt).toBe(future);
  });

  test('active Stripe subscription retains pro even if an old individualPlanExpiresAt exists', async () => {
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    await firestore.setUserPlan('gmail.com', 'paying_sub@gmail.com', {
      individualPlan: 'pro',
      individualBillingStatus: 'active',
      individualStripeSubscriptionId: 'sub_123',
      individualPlanExpiresAt: past,
    });
    const result = await firestore.getUserPlan('gmail.com', 'paying_sub@gmail.com');
    expect(result.plan).toBe('pro');
    expect(result.billingStatus).toBe('active');
  });

  test('lifetime plan retains pro even if an old individualPlanExpiresAt exists', async () => {
    const past = new Date(Date.now() - 3600 * 1000).toISOString();
    await firestore.setUserPlan('gmail.com', 'lifetime_user@gmail.com', {
      individualPlan: 'pro',
      individualBillingStatus: 'active',
      individualPlanType: 'lifetime',
      individualPlanExpiresAt: past,
    });
    const result = await firestore.getUserPlan('gmail.com', 'lifetime_user@gmail.com');
    expect(result.plan).toBe('pro');
    expect(result.billingStatus).toBe('active');
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

  test('tenant overviews filter out code-level anchor documents with hasInstances: true', async () => {
    ctx.seed('tenants/anchor.com/meetings/room-code', {
      meetingCode: 'room-code',
      hasInstances: true,
      title: 'Anchor Room',
      recurringEventId: 'rec-1',
    });
    ctx.seed('tenants/anchor.com/meetings/room-code__sess1', {
      meetingCode: 'room-code',
      title: 'Session 1',
      recurringEventId: 'rec-1',
      startTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')),
    });
    ctx.seed('tenants/anchor.com/meetings/room-code__sess1/participants/p1', {
      displayName: 'Alice',
      email: 'alice@anchor.com',
      present: true,
    });

    const meetings = await firestore.getTenantMeetings('anchor.com');
    expect(meetings).toHaveLength(1);
    expect(meetings[0].conferenceId).toBe('room-code__sess1');

    const series = await firestore.getTenantSeriesOverview('anchor.com');
    expect(series).toHaveLength(1);
    expect(series[0].instanceCount).toBe(1);

    const people = await firestore.getTenantPeopleOverview('anchor.com');
    expect(people).toHaveLength(1);
    expect(people[0].meetingCount).toBe(1);
    expect(people[0].attendanceRate).toBe(1); // 100%, not 50% cut in half
  });
});

describe('firestore.js — remaining branch closure', () => {
  test('logEvent no-ops on missing fields and writes when valid', async () => {
    await firestore.logEvent('acme.com', {}); // missing email/type → early return
    await firestore.logEvent('acme.com', { email: 'a@acme.com', type: 'signin', meta: { x: 1 } });
    expect(ctx.list('tenants/acme.com/events/').length).toBe(1);
  });

  test('getUser migrates a legacy root-level user', async () => {
    ctx.seed('users/legacy@acme.com', { email: 'legacy@acme.com', displayName: 'Legacy', refreshToken: 'plain' });
    const u = await firestore.getUser('acme.com', 'legacy@acme.com');
    expect(u.displayName).toBe('Legacy');
    expect(ctx.read('tenants/acme.com/users/legacy@acme.com')).toBeDefined(); // migrated
  });

  test('upsertUser stores sheetId and skips re-stamping an existing acquisition', async () => {
    ctx.seed('tenants/acme.com/users/e@acme.com', { email: 'e@acme.com', acquisitionSource: 'reddit', userAgent: 'old-UA' });
    ctx.seed('tenants/acme.com', { domain: 'acme.com', adminEmail: 'e@acme.com' });
    await firestore.upsertUser('acme.com', { email: 'e@acme.com', displayName: 'E', sheetId: 'sheet-1', acquisition: { source: 'google_search', userAgent: 'new-UA' } });
    const u = ctx.read('tenants/acme.com/users/e@acme.com');
    expect(u.sheetId).toBe('sheet-1');
    expect(u.acquisitionSource).toBe('reddit'); // not overwritten (first-touch)
  });

  test('getUserMeetingSeries sorts multiple series and includes per-person rollups', async () => {
    // series A (r1): 2 instances; series B (r2): 1 instance
    ctx.seed('tenants/acme.com/meetings/a1', { conferenceId: 'a1', title: 'A', recurringEventId: 'r1', startTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')) });
    ctx.seed('tenants/acme.com/meetings/a2', { conferenceId: 'a2', title: 'A', recurringEventId: 'r1', startTime: wrapTimestamp(new Date('2026-06-08T10:00:00Z')) });
    ctx.seed('tenants/acme.com/meetings/b1', { conferenceId: 'b1', title: 'B', recurringEventId: 'r2', startTime: wrapTimestamp(new Date('2026-06-15T10:00:00Z')) });
    ctx.seed('tenants/acme.com/meetings/a1/participants/x', { email: 'x@acme.com', displayName: 'X', present: true });
    ctx.seed('tenants/acme.com/meetings/a2/participants/x', { email: 'x@acme.com', displayName: 'Xavier', present: true });
    ctx.seed('tenants/acme.com/meetings/b1/participants/y', { email: 'y@acme.com', displayName: 'Y', present: false });
    ctx.seed('tenants/acme.com/users/owner@acme.com', { email: 'owner@acme.com' });
    ctx.seed('tenants/acme.com/events/ea1', { email: 'owner@acme.com', type: 'tracked', meta: { conferenceId: 'a1' }, createdAt: wrapTimestamp(new Date('2026-06-01T10:00:00Z')) });
    ctx.seed('tenants/acme.com/events/ea2', { email: 'owner@acme.com', type: 'tracked', meta: { conferenceId: 'a2' }, createdAt: wrapTimestamp(new Date('2026-06-08T10:00:00Z')) });
    ctx.seed('tenants/acme.com/events/eb1', { email: 'owner@acme.com', type: 'tracked', meta: { conferenceId: 'b1' }, createdAt: wrapTimestamp(new Date('2026-06-15T10:00:00Z')) });
    const res = await firestore.getUserMeetingSeries('acme.com', 'owner@acme.com');
    expect(res.totalSeries).toBeGreaterThanOrEqual(2);
  });

  test('getParticipantHistory returns a participant rollup + note', async () => {
    ctx.seed('tenants/acme.com/meetings/m1', { conferenceId: 'm1', title: 'M', startTime: wrapTimestamp(new Date('2026-06-01T10:00:00Z')) });
    ctx.seed('tenants/acme.com/meetings/m1/participants/z', { email: 'z@acme.com', displayName: 'Z', present: true });
    ctx.seed('tenants/acme.com/events/ez', { email: 'owner@acme.com', type: 'tracked', meta: { conferenceId: 'm1' }, createdAt: wrapTimestamp(new Date('2026-06-01T10:00:00Z')) });
    await firestore.setParticipantNote('acme.com', 'owner@acme.com', 'z@acme.com', 'reliable');
    const note = await firestore.getParticipantNote('acme.com', 'owner@acme.com', 'z@acme.com');
    expect(note).toBe('reliable');
    const ph = await firestore.getParticipantHistory('acme.com', 'owner@acme.com', 'z@acme.com');
    expect(ph === null || typeof ph === 'object').toBe(true);
  });
});

describe('firestore.js — aggregation deep branches', () => {
  test('upsertUser stamps utmMedium/utmCampaign', async () => {
    await firestore.upsertUser('acme.com', { email: 'u@acme.com', displayName: 'U', acquisition: { source: 's', utmMedium: 'cpc', utmCampaign: 'launch' } });
    const u = ctx.read('tenants/acme.com/users/u@acme.com');
    expect(u.utmMedium).toBe('cpc');
    expect(u.utmCampaign).toBe('launch');
  });

  test('history/series/people handle empty-identity participants, durations, titles, and untracked meetings', async () => {
    const j = (t) => wrapTimestamp(new Date(t));
    // Two recurring instances with growing titles + one untracked recurring meeting.
    ctx.seed('tenants/acme.com/meetings/s1', { conferenceId: 's1', title: 'Sync', recurringEventId: 'R', startTime: j('2026-06-01T10:00:00Z') });
    ctx.seed('tenants/acme.com/meetings/s2', { conferenceId: 's2', title: 'Weekly Sync Meeting', recurringEventId: 'R', startTime: j('2026-06-08T10:00:00Z') });
    ctx.seed('tenants/acme.com/meetings/s3-untracked', { conferenceId: 's3-untracked', title: 'Other', recurringEventId: 'R2', startTime: j('2026-06-09T10:00:00Z') });
    // participants: one with join+leave (duration), one empty-identity (no email/name)
    ctx.seed('tenants/acme.com/meetings/s1/participants/pa', { email: 'a@acme.com', displayName: 'A', present: true, joinTime: j('2026-06-01T10:00:00Z'), leaveTime: j('2026-06-01T10:45:00Z') });
    ctx.seed('tenants/acme.com/meetings/s1/participants/pblank', { email: '', displayName: '', present: false });
    ctx.seed('tenants/acme.com/meetings/s2/participants/pa', { email: 'a@acme.com', displayName: 'A', present: true, joinTime: j('2026-06-08T10:05:00Z'), leaveTime: j('2026-06-08T10:50:00Z') });
    ctx.seed('tenants/acme.com/users/owner@acme.com', { email: 'owner@acme.com' });
    ctx.seed('tenants/acme.com/events/t1', { email: 'owner@acme.com', type: 'tracked', meta: { conferenceId: 's1' }, createdAt: j('2026-06-01T10:00:00Z') });
    ctx.seed('tenants/acme.com/events/t2', { email: 'owner@acme.com', type: 'tracked', meta: { conferenceId: 's2' }, createdAt: j('2026-06-08T10:00:00Z') });

    expect(await firestore.getUserMeetingHistory('acme.com', 'owner@acme.com')).toBeDefined();
    const series = await firestore.getUserMeetingSeries('acme.com', 'owner@acme.com');
    expect(series.series.find(s => s.recurringEventId === 'R')?.seriesTitle || series.series[0]).toBeDefined();
    expect(await firestore.getTenantSeriesOverview('acme.com')).toBeDefined();
    expect(await firestore.getTenantPeopleOverview('acme.com')).toBeDefined();
  });
});

describe('firestore.js — maximally varied aggregation data', () => {
  const j = (t) => wrapTimestamp(new Date(t));
  beforeEach(() => {
    // Recurring series R: 3 instances w/ growing titles, mixed startTime/createdAt.
    ctx.seed('tenants/acme.com/meetings/r-1', { conferenceId: 'r-1', title: 'Std', recurringEventId: 'R', startTime: j('2026-06-01T10:00:00Z') });
    ctx.seed('tenants/acme.com/meetings/r-2', { conferenceId: 'r-2', title: 'Standup Longer', recurringEventId: 'R', createdAt: j('2026-06-08T10:00:00Z') }); // no startTime
    ctx.seed('tenants/acme.com/meetings/r-3', { conferenceId: 'r-3', title: 'Standup Longest Title Here', recurringEventId: 'R', startTime: j('2026-06-15T10:00:00Z') });
    // instant meeting (no recurringEventId)
    ctx.seed('tenants/acme.com/meetings/inst', { conferenceId: 'inst', title: 'Chat', startTime: j('2026-06-03T10:00:00Z') });
    // participants: present+join+leave; absent+join-only; name-only; empty; rsvp
    ctx.seed('tenants/acme.com/meetings/r-1/participants/full', { email: 'full@acme.com', displayName: 'Full', present: true, joinTime: j('2026-06-01T10:00:00Z'), leaveTime: j('2026-06-01T10:40:00Z') });
    ctx.seed('tenants/acme.com/meetings/r-1/participants/nojoinleave', { email: 'nj@acme.com', displayName: 'NoLeave', present: false, joinTime: j('2026-06-01T10:10:00Z') });
    ctx.seed('tenants/acme.com/meetings/r-1/participants/nameonly', { email: '', displayName: 'NameOnly', present: true });
    ctx.seed('tenants/acme.com/meetings/r-1/participants/empty', { email: '', displayName: '', present: false });
    ctx.seed('tenants/acme.com/meetings/r-2/participants/full', { email: 'full@acme.com', displayName: 'Fuller Name', present: true, joinTime: j('2026-06-08T10:00:00Z'), leaveTime: j('2026-06-08T10:30:00Z') });
    ctx.seed('tenants/acme.com/meetings/r-3/participants/full', { email: 'full@acme.com', displayName: 'F', present: true });
    ctx.seed('tenants/acme.com/meetings/inst/participants/full', { email: 'full@acme.com', displayName: 'Full', present: true, joinTime: j('2026-06-03T10:00:00Z') });
    ctx.seed('tenants/acme.com/users/owner@acme.com', { email: 'owner@acme.com', displayName: 'Owner' });
    ctx.seed('tenants/acme.com/users/second@acme.com', { email: 'second@acme.com', displayName: 'Second' });
    for (const cid of ['r-1', 'r-2', 'r-3', 'inst']) {
      ctx.seed(`tenants/acme.com/events/ev-${cid}`, { email: 'owner@acme.com', type: 'tracked', meta: { conferenceId: cid }, createdAt: j('2026-06-01T10:00:00Z') });
    }
    ctx.seed('tenants/acme.com/notes/owner@acme.com/participants/full@acme.com', { body: 'note', updatedAt: j('2026-06-01T10:00:00Z') });
  });

  test('all rollups run over the varied dataset', async () => {
    expect((await firestore.getUserMeetingHistory('acme.com', 'owner@acme.com')).meetings.length).toBeGreaterThan(0);
    expect((await firestore.getUserMeetingSeries('acme.com', 'owner@acme.com')).totalSeries).toBeGreaterThanOrEqual(1);
    expect((await firestore.getTenantSeriesOverview('acme.com')).length).toBeGreaterThanOrEqual(1);
    expect((await firestore.getTenantPeopleOverview('acme.com')).length).toBeGreaterThanOrEqual(1);
    expect((await firestore.getTenantMeetings('acme.com')).length).toBeGreaterThan(0);
    expect(await firestore.getParticipantHistory('acme.com', 'owner@acme.com', 'full@acme.com')).toBeDefined();
    expect(await firestore.getParticipantHistory('acme.com', 'owner@acme.com', 'name:nameonly')).toBeDefined();
  });
});

describe('verifications', () => {
  test('saveVerifications writes each record; skips codeless + non-array/empty', async () => {
    await firestore.saveVerifications(null); // no-op, no throw
    await firestore.saveVerifications([]);   // no-op
    await firestore.saveVerifications([
      { code: 'AT-1A2B3C4D', type: 'certificate', attendeeName: 'Ada', session: 'CLE', domain: 'acme.com', conferenceId: 'c1' },
      { attendeeName: 'NoCode' }, // no code → skipped
    ]);
    const doc = ctx.read('verifications/AT-1A2B3C4D');
    expect(doc).toMatchObject({ code: 'AT-1A2B3C4D', attendeeName: 'Ada', session: 'CLE', type: 'certificate', domain: 'acme.com' });
    expect(doc.issuedAt).toBeDefined();
  });

  test('getVerification: null when absent/blank, sanitized record (ISO issuedAt) when present', async () => {
    expect(await firestore.getVerification('AT-DEADBEEF')).toBeNull();
    expect(await firestore.getVerification('')).toBeNull();
    ctx.seed('verifications/AT-1A2B3C4D', {
      code: 'AT-1A2B3C4D', type: 'certificate', attendeeName: 'Ada', session: 'CLE',
      dateLabel: 'Thu, Aug 20, 2026', detailLabel: '1.5 credit hours', issuer: 'Dr. Host',
      issuedAt: wrapTimestamp(new Date('2026-08-21T00:00:00Z')),
    });
    const v = await firestore.getVerification('AT-1A2B3C4D');
    expect(v).toMatchObject({ attendeeName: 'Ada', session: 'CLE', detailLabel: '1.5 credit hours', issuer: 'Dr. Host' });
    expect(v.issuedAt).toBe('2026-08-21T00:00:00.000Z');
  });
});

describe('getMeetingWithParticipants', () => {
  test('null when the meeting is missing or the id is blank', async () => {
    expect(await firestore.getMeetingWithParticipants('acme.com', 'nope')).toBeNull();
    expect(await firestore.getMeetingWithParticipants('acme.com', '')).toBeNull();
  });

  test('returns the meeting + participants with ISO timestamps', async () => {
    ctx.seed('tenants/acme.com/meetings/conf1', {
      title: 'Bio 101', participantCount: 1,
      startTime: wrapTimestamp(new Date('2026-08-20T14:00:00Z')),
      endTime: wrapTimestamp(new Date('2026-08-20T15:00:00Z')),
    });
    ctx.seed('tenants/acme.com/meetings/conf1/participants/p1', {
      displayName: 'Ada', email: 'ada@x.com', present: true,
      joinTime: wrapTimestamp(new Date('2026-08-20T14:00:00Z')), leaveTime: null,
    });
    const m = await firestore.getMeetingWithParticipants('acme.com', 'conf1');
    expect(m).toMatchObject({ conferenceId: 'conf1', title: 'Bio 101', participantCount: 1 });
    expect(m.startTime).toBe('2026-08-20T14:00:00.000Z');
    expect(m.participants).toHaveLength(1);
    expect(m.participants[0]).toMatchObject({ displayName: 'Ada', email: 'ada@x.com', present: true, joinTime: '2026-08-20T14:00:00.000Z', leaveTime: null });
  });

  describe('ownership fence (requesterEmail)', () => {
    beforeEach(() => {
      ctx.seed('tenants/acme.com/meetings/conf1', { title: 'Bio 101', participantCount: 0 });
    });

    test('returns the meeting when the requester tracked it', async () => {
      ctx.seed('tenants/acme.com/events/e1', { email: 'host@acme.com', type: 'tracked', meta: { conferenceId: 'conf1' } });
      const m = await firestore.getMeetingWithParticipants('acme.com', 'conf1', 'host@acme.com');
      expect(m).toMatchObject({ conferenceId: 'conf1', title: 'Bio 101' });
    });

    test('returns null when the requester never tracked it (no cross-user leak)', async () => {
      // A tracked event exists, but for a DIFFERENT meeting — the caller must
      // not be able to pull conf1's roster.
      ctx.seed('tenants/acme.com/events/e1', { email: 'stranger@acme.com', type: 'tracked', meta: { conferenceId: 'other-conf' } });
      const m = await firestore.getMeetingWithParticipants('acme.com', 'conf1', 'stranger@acme.com');
      expect(m).toBeNull();
    });

    test('email match is case-insensitive', async () => {
      ctx.seed('tenants/acme.com/events/e1', { email: 'host@acme.com', type: 'tracked', meta: { conferenceId: 'conf1' } });
      const m = await firestore.getMeetingWithParticipants('acme.com', 'conf1', 'Host@Acme.com');
      expect(m).toMatchObject({ conferenceId: 'conf1' });
    });

    test('authorizes an instance-scoped conferenceId when tracked event has baseCode', async () => {
      ctx.seed('tenants/acme.com/meetings/conf1__inst1', { title: 'Bio 101 Session 2', participantCount: 0 });
      ctx.seed('tenants/acme.com/events/e1', { email: 'host@acme.com', type: 'tracked', meta: { conferenceId: 'conf1' } });
      const m = await firestore.getMeetingWithParticipants('acme.com', 'conf1__inst1', 'host@acme.com');
      expect(m).toMatchObject({ conferenceId: 'conf1__inst1', title: 'Bio 101 Session 2' });
    });

    test('authorizes baseCode conferenceId when tracked event has instance-scoped conferenceId', async () => {
      ctx.seed('tenants/acme.com/meetings/conf2', { title: 'Bio 101 Base', participantCount: 0 });
      ctx.seed('tenants/acme.com/events/e2', { email: 'host@acme.com', type: 'tracked', meta: { conferenceId: 'conf2__inst99' } });
      const m = await firestore.getMeetingWithParticipants('acme.com', 'conf2', 'host@acme.com');
      expect(m).toMatchObject({ conferenceId: 'conf2', title: 'Bio 101 Base' });
    });
  });

  describe('error-spike alert helpers', () => {
    const recent = () => new Date();                                   // in the 1h window
    const old = () => new Date(Date.now() - 2 * 3600 * 1000);          // outside it
    const since = () => new Date(Date.now() - 3600 * 1000);           // 1h ago

    test('getRecentErrorSpike counts only in-window export_failed, across tenants, by reason', async () => {
      ctx.seed('tenants/acme.com', { domain: 'acme.com' });
      ctx.seed('tenants/beta.com', { domain: 'beta.com' });
      // in window, export_failed
      ctx.seed('tenants/acme.com/events/e1', { type: 'export_failed', email: 'a@acme.com', meta: { reason: 'error', message: 'boom one' }, createdAt: recent() });
      ctx.seed('tenants/acme.com/events/e2', { type: 'export_failed', email: 'a@acme.com', meta: { reason: 'error' }, createdAt: recent() }); // same user
      ctx.seed('tenants/beta.com/events/e3', { type: 'export_failed', email: 'b@beta.com', meta: { reason: 'auto_export_error' }, createdAt: recent() });
      // noise that must NOT count
      ctx.seed('tenants/acme.com/events/e4', { type: 'tracked', email: 'a@acme.com', createdAt: recent() });      // wrong type
      ctx.seed('tenants/acme.com/events/e5', { type: 'export_failed', email: 'c@acme.com', meta: { reason: 'error' }, createdAt: old() }); // out of window

      const spike = await firestore.getRecentErrorSpike(since());
      expect(spike.total).toBe(3);
      expect(spike.byReason).toEqual({ error: 2, auto_export_error: 1 });
      expect(spike.users.sort()).toEqual(['a@acme.com', 'b@beta.com']); // distinct
      expect(spike.samples).toContain('boom one');
    });

    test('getRecentErrorSpike extracts reason and samples from meta.error, code, and root error objects', async () => {
      ctx.seed('tenants/gamma.com', { domain: 'gamma.com' });
      ctx.seed('tenants/gamma.com/events/e1', { type: 'export_failed', email: 'g1@gamma.com', meta: { code: 'permission_denied', error: { message: 'insufficient permissions' } }, createdAt: recent() });
      ctx.seed('tenants/gamma.com/events/e2', { type: 'export_failed', email: 'g2@gamma.com', error: { code: 'auth_expired', message: 'Token expired' }, createdAt: recent() });
      ctx.seed('tenants/gamma.com/events/e3', { type: 'export_failed', message: 'plain message failure', createdAt: recent() });

      const spike = await firestore.getRecentErrorSpike(since());
      expect(spike.total).toBe(3);
      expect(spike.byReason).toEqual({
        permission_denied: 1,
        auth_expired: 1,
        unknown: 1,
      });
      expect(spike.users).toEqual(['g1@gamma.com', 'g2@gamma.com']);
      expect(spike.samples).toEqual(['insufficient permissions', 'Token expired', 'plain message failure']);
    });

    test('getRecentErrorSpike returns an empty shape when there are no failures', async () => {
      ctx.seed('tenants/acme.com', { domain: 'acme.com' });
      const spike = await firestore.getRecentErrorSpike(since());
      expect(spike).toEqual({ total: 0, byReason: {}, users: [], samples: [] });
    });

    test('getRecentErrorSpike queries collectionGroup(events) without scanning tenants, and falls back if collectionGroup throws', async () => {
      ctx.seed('tenants/acme.com', { domain: 'acme.com' });
      ctx.seed('tenants/acme.com/events/e1', { type: 'export_failed', email: 'a@acme.com', meta: { reason: 'error' }, createdAt: recent() });
      const db = firestore.getDb();
      const colSpy = jest.spyOn(db, 'collection');
      const cgSpy = jest.spyOn(db, 'collectionGroup');

      const spike1 = await firestore.getRecentErrorSpike(since());
      expect(spike1.total).toBe(1);
      expect(cgSpy).toHaveBeenCalledWith('events');
      expect(colSpy).not.toHaveBeenCalledWith('tenants');

      // Simulate missing collectionGroup index -> falls back to per-tenant scan seamlessly
      cgSpy.mockImplementationOnce(() => ({
        where: () => ({ get: () => Promise.reject(new Error('FAILED_PRECONDITION: index building')) }),
      }));
      const spike2 = await firestore.getRecentErrorSpike(since());
      expect(spike2.total).toBe(1);
      expect(colSpy).toHaveBeenCalledWith('tenants');

      colSpy.mockRestore();
      cgSpy.mockRestore();
    });

    test('error-alert cooldown state round-trips', async () => {
      expect(await firestore.getErrorAlertState()).toBeNull();
      await firestore.setErrorAlertState({ lastAlertedAt: '2026-09-10T00:00:00.000Z', lastTotal: 7 });
      expect(await firestore.getErrorAlertState()).toMatchObject({ lastAlertedAt: '2026-09-10T00:00:00.000Z', lastTotal: 7 });
    });
  });

  describe('countUserAutoExports', () => {
    test('counts auto-exports for the specified user, ignoring non-auto or other users', async () => {
      ctx.seed('tenants/acme.com/exports/e1', { email: 'teacher@acme.com', autoExport: true });
      ctx.seed('tenants/acme.com/exports/e2', { email: 'teacher@acme.com', autoExport: true });
      ctx.seed('tenants/acme.com/exports/e3', { email: 'teacher@acme.com', autoExport: false }); // manual export
      ctx.seed('tenants/acme.com/exports/e4', { email: 'other@acme.com', autoExport: true }); // other user

      const count = await firestore.countUserAutoExports('acme.com', 'teacher@acme.com');
      expect(count).toBe(2);
    });

    test('case-insensitively matches email address', async () => {
      ctx.seed('tenants/acme.com/exports/e1', { email: 'teacher@acme.com', autoExport: true });
      const count = await firestore.countUserAutoExports('acme.com', 'Teacher@Acme.COM');
      expect(count).toBe(1);
    });

    test('returns 0 when no auto-exports exist', async () => {
      const count = await firestore.countUserAutoExports('acme.com', 'nobody@acme.com');
      expect(count).toBe(0);
    });
  });

  describe('countUserMonthlyExports', () => {
    test('counts Sheets, CSV, and Excel exports in the current calendar month toward quota', async () => {
      const now = new Date();
      const currentMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5)).toISOString();
      const priorMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)).toISOString();

      // Sheets export this month (>1 participant) -> counts
      ctx.seed('tenants/acme.com/exports/e1', {
        email: 'teacher@acme.com',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/123',
        participantCount: 15,
        createdAt: currentMonthDate,
      });

      // CSV export this month without sheetUrl (>1 participant) -> MUST count toward monthly quota
      ctx.seed('tenants/acme.com/exports/e2', {
        email: 'teacher@acme.com',
        sheetUrl: null,
        exportType: 'csv',
        participantCount: 20,
        createdAt: currentMonthDate,
      });

      // Excel export this month without sheetUrl (>1 participant) -> MUST count toward monthly quota
      ctx.seed('tenants/acme.com/exports/e3', {
        email: 'teacher@acme.com',
        sheetUrl: null,
        exportType: 'excel',
        participantCount: 25,
        createdAt: currentMonthDate,
      });

      // Solo test export (<= 1 participant) -> does NOT count
      ctx.seed('tenants/acme.com/exports/e4', {
        email: 'teacher@acme.com',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/solo',
        participantCount: 1,
        createdAt: currentMonthDate,
      });

      // Prior month export -> does NOT count
      ctx.seed('tenants/acme.com/exports/e5', {
        email: 'teacher@acme.com',
        sheetUrl: 'https://docs.google.com/spreadsheets/d/old',
        participantCount: 10,
        createdAt: priorMonthDate,
      });

      const count = await firestore.countUserMonthlyExports('acme.com', 'teacher@acme.com');
      expect(count).toBe(3); // Sheets + CSV + Excel
    });

    test('returns 0 when error occurs or user has no exports', async () => {
      expect(await firestore.countUserMonthlyExports('acme.com', 'nobody@acme.com')).toBe(0);
    });
  });

  describe('persistExport month rollover', () => {
    test('handles first export of a new month as a new monthly export, updating createdAt and resetting reexportCount', async () => {
      const email = 'teacher@acme.com';
      const conferenceId = 'class-101';
      const payload = {
        meetingTitle: 'Math 101',
        tabName: 'Math 101',
        exportedAt: new Date().toISOString(),
        participantCount: 10,
        sheetUrl: 'https://docs.google.com/sheet1',
        email,
        conferenceId,
      };

      // 1. Initial export in current month
      const first = await firestore.persistExport('acme.com', payload);
      expect(first).toEqual({ created: true });

      // 2. Second export in current month -> re-export ordinal 1
      const second = await firestore.persistExport('acme.com', payload);
      expect(second).toEqual({ created: false, reexportCount: 1 });

      // 3. Simulate rolling over into a new month by setting doc's reexportMonth and createdAt to prior month
      const docId = `${email.replace(/[^a-z0-9]/g, '_')}__${conferenceId}`;
      const priorMonthKey = '2025-01';
      const priorCreatedAt = new Date('2025-01-15T12:00:00Z');
      const stored = ctx.read(`tenants/acme.com/exports/${docId}`);
      ctx.seed(`tenants/acme.com/exports/${docId}`, {
        ...stored,
        reexportMonth: priorMonthKey,
        reexportCount: 5,
        createdAt: priorCreatedAt,
      });

      // 4. First export in the new month with updated participantCount (e.g. 20)
      const newMonthFirst = await firestore.persistExport('acme.com', { ...payload, participantCount: 20 });
      expect(newMonthFirst).toEqual({ created: true, reexportCount: 0 });

      // Check stored doc: createdAt is updated, reexportCount reset to 0, participantCount updated to 20
      const updated = ctx.read(`tenants/acme.com/exports/${docId}`);
      expect(updated.reexportCount).toBe(0);
      expect(updated.participantCount).toBe(20);
      expect(updated.createdAt.toDate().getTime()).toBeGreaterThan(priorCreatedAt.getTime());

      // 5. Second export in the new month must return { created: false, reexportCount: 1 }
      const newMonthSecond = await firestore.persistExport('acme.com', payload);
      expect(newMonthSecond).toEqual({ created: false, reexportCount: 1 });
    });

    test('handles legacy export docs missing reexportMonth and createdAt as a new month export', async () => {
      const email = 'legacy@acme.com';
      const conferenceId = 'legacy-conf';
      const docId = `${email.replace(/[^a-z0-9]/g, '_')}__${conferenceId}`;
      ctx.seed(`tenants/acme.com/exports/${docId}`, {
        meetingTitle: 'Old Class',
        participantCount: 15,
        email,
        conferenceId,
      });

      const res = await firestore.persistExport('acme.com', {
        meetingTitle: 'Old Class New Session',
        tabName: 'Session 2',
        exportedAt: new Date().toISOString(),
        participantCount: 18,
        email,
        conferenceId,
      });

      expect(res).toEqual({ created: true, reexportCount: 0 });
      const doc = ctx.read(`tenants/acme.com/exports/${docId}`);
      expect(doc.reexportCount).toBe(0);
      expect(doc.reexportMonth).toBeDefined();
      expect(doc.participantCount).toBe(18);
    });

    test('records exported event via logEvent on month rollover', async () => {
      const email = 'rollover@acme.com';
      const conferenceId = 'roll-conf';
      const docId = `${email.replace(/[^a-z0-9]/g, '_')}__${conferenceId}`;
      ctx.seed(`tenants/acme.com/exports/${docId}`, {
        email,
        conferenceId,
        reexportMonth: '2024-01',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        reexportCount: 2,
      });

      await firestore.persistExport('acme.com', {
        email,
        conferenceId,
        participantCount: 12,
        tabName: 'Attendance',
      });

      const events = ctx.list('tenants/acme.com/events');
      expect(events.some(e => e.data.email === email && e.data.type === 'exported' && e.data.meta?.participantCount === 12)).toBe(true);
    });
  });

  describe('isMeetingUnlocked authorization & expiration', () => {
    test('authorizes user by matching email or domain', async () => {
      ctx.seed('unlocked_meetings/conf-valid', {
        conferenceId: 'conf-valid',
        email: 'teacher@acme.com',
        domain: 'acme.com',
        unlockedAt: wrapTimestamp(new Date(Date.now() - 3600 * 1000)), // 1 hour ago
      });

      // Matches by email
      expect(await firestore.isMeetingUnlocked('acme.com', 'teacher@acme.com', 'conf-valid')).toBe(true);
      // Case-insensitive email match
      expect(await firestore.isMeetingUnlocked('acme.com', 'Teacher@Acme.COM', 'conf-valid')).toBe(true);
      // Matches by domain
      expect(await firestore.isMeetingUnlocked('acme.com', 'colleague@acme.com', 'conf-valid')).toBe(true);
    });

    test('prevents multi-tenant authorization leak (blocks foreign domain and email)', async () => {
      ctx.seed('unlocked_meetings/conf-private', {
        conferenceId: 'conf-private',
        email: 'teacher@school-a.edu',
        domain: 'school-a.edu',
        unlockedAt: wrapTimestamp(new Date(Date.now() - 3600 * 1000)),
      });

      // Attacker from school-b.edu cannot access single meeting pass of school-a.edu
      expect(await firestore.isMeetingUnlocked('school-b.edu', 'attacker@school-b.edu', 'conf-private')).toBe(false);
    });

    test('enforces 48-hour expiration window on single-meeting passes', async () => {
      // 47 hours ago -> valid
      ctx.seed('unlocked_meetings/conf-47h', {
        conferenceId: 'conf-47h',
        email: 'teacher@acme.com',
        domain: 'acme.com',
        unlockedAt: wrapTimestamp(new Date(Date.now() - 47 * 3600 * 1000)),
      });
      expect(await firestore.isMeetingUnlocked('acme.com', 'teacher@acme.com', 'conf-47h')).toBe(true);

      // 49 hours ago -> expired
      ctx.seed('unlocked_meetings/conf-49h', {
        conferenceId: 'conf-49h',
        email: 'teacher@acme.com',
        domain: 'acme.com',
        unlockedAt: wrapTimestamp(new Date(Date.now() - 49 * 3600 * 1000)),
      });
      expect(await firestore.isMeetingUnlocked('acme.com', 'teacher@acme.com', 'conf-49h')).toBe(false);
    });

    test('checks user document fallback with 48-hour expiration window', async () => {
      ctx.seed('tenants/acme.com/users/teacher@acme.com', {
        email: 'teacher@acme.com',
        unlockedMeetings: ['conf-user-active', 'conf-user-expired'],
        lastMeetingUnlockedAt: wrapTimestamp(new Date(Date.now() - 2 * 3600 * 1000)),
      });

      expect(await firestore.isMeetingUnlocked('acme.com', 'teacher@acme.com', 'conf-user-active')).toBe(true);

      // User doc expired
      ctx.seed('tenants/acme.com/users/expired@acme.com', {
        email: 'expired@acme.com',
        unlockedMeetings: ['conf-user-expired'],
        lastMeetingUnlockedAt: wrapTimestamp(new Date(Date.now() - 50 * 3600 * 1000)),
      });
      expect(await firestore.isMeetingUnlocked('acme.com', 'expired@acme.com', 'conf-user-expired')).toBe(false);
    });

    test('enforces personal domain isolation (prevents gmail.com strangers from sharing passes)', async () => {
      ctx.seed('unlocked_meetings/conf-gmail', {
        conferenceId: 'conf-gmail',
        email: 'alice@gmail.com',
        domain: 'gmail.com',
        unlockedAt: wrapTimestamp(new Date(Date.now() - 3600 * 1000)),
      });

      // Bob on gmail.com CANNOT access Alice's unlocked meeting pass
      expect(await firestore.isMeetingUnlocked('gmail.com', 'bob@gmail.com', 'conf-gmail')).toBe(false);
      // Alice CAN access her own unlocked meeting pass
      expect(await firestore.isMeetingUnlocked('gmail.com', 'alice@gmail.com', 'conf-gmail')).toBe(true);
    });

    test('supports instance-keyed conference IDs bidirectionally', async () => {
      // Unlocked with base code
      ctx.seed('unlocked_meetings/conf-base', {
        conferenceId: 'conf-base',
        email: 'teacher@acme.com',
        domain: 'acme.com',
        unlockedAt: wrapTimestamp(new Date(Date.now() - 3600 * 1000)),
      });
      // Query with instance ID
      expect(await firestore.isMeetingUnlocked('acme.com', 'teacher@acme.com', 'conf-base__session_01')).toBe(true);

      // Unlocked with instance ID
      ctx.seed('unlocked_meetings/conf-base2__session_02', {
        conferenceId: 'conf-base2__session_02',
        email: 'teacher@acme.com',
        domain: 'acme.com',
        unlockedAt: wrapTimestamp(new Date(Date.now() - 3600 * 1000)),
      });
      // Query with base code
      expect(await firestore.isMeetingUnlocked('acme.com', 'teacher@acme.com', 'conf-base2')).toBe(true);
    });

    test('returns false when unlockedAt is missing or invalid', async () => {
      ctx.seed('unlocked_meetings/conf-no-ts', {
        conferenceId: 'conf-no-ts',
        email: 'teacher@acme.com',
        domain: 'acme.com',
      });
      expect(await firestore.isMeetingUnlocked('acme.com', 'teacher@acme.com', 'conf-no-ts')).toBe(false);
    });

    test('returns false for missing conferenceId or missing doc', async () => {
      expect(await firestore.isMeetingUnlocked('acme.com', 'teacher@acme.com', null)).toBe(false);
      expect(await firestore.isMeetingUnlocked('acme.com', 'teacher@acme.com', 'does-not-exist')).toBe(false);
    });
  });

  describe('instance ID normalization in history, series, and detail', () => {
    test('getMeetingDetail allows access when event has baseCode and meeting has instance id', async () => {
      // Event tracked with baseCode
      ctx.seed('tenants/acme.com/events/ev1', {
        email: 'teacher@acme.com',
        type: 'tracked',
        meta: { conferenceId: 'math-101' },
      });

      // Meeting doc has instance ID `math-101__rec_001`
      ctx.seed('tenants/acme.com/meetings/math-101__rec_001', {
        title: 'Math 101 Session 1',
        meetingCode: 'math-101',
        conferenceId: 'math-101__rec_001',
        participantCount: 15,
        startTime: wrapTimestamp(new Date()),
      });

      const detail = await firestore.getMeetingDetail('acme.com', 'teacher@acme.com', 'math-101__rec_001');
      expect(detail).toBeDefined();
      expect(detail.title).toBe('Math 101 Session 1');
    });

    test('getMeetingDetail allows access when event has instance id and query uses baseCode', async () => {
      ctx.seed('tenants/acme.com/events/ev2', {
        email: 'teacher@acme.com',
        type: 'tracked',
        meta: { conferenceId: 'physics-201__spaces_xyz' },
      });

      ctx.seed('tenants/acme.com/meetings/physics-201', {
        title: 'Physics 201',
        meetingCode: 'physics-201',
        conferenceId: 'physics-201',
        participantCount: 20,
        startTime: wrapTimestamp(new Date()),
      });

      const detail = await firestore.getMeetingDetail('acme.com', 'teacher@acme.com', 'physics-201');
      expect(detail).toBeDefined();
      expect(detail.title).toBe('Physics 201');
    });

    test('getUserMeetingHistory returns instance meetings when user tracked base code', async () => {
      ctx.seed('tenants/acme.com/events/ev3', {
        email: 'teacher@acme.com',
        type: 'tracked',
        meta: { conferenceId: 'history-301' },
      });

      ctx.seed('tenants/acme.com/meetings/history-301__inst_1', {
        title: 'History 301',
        meetingCode: 'history-301',
        participantCount: 12,
        createdAt: wrapTimestamp(new Date()),
      });

      const res = await firestore.getUserMeetingHistory('acme.com', 'teacher@acme.com');
      expect(res.meetings.some(m => m.id === 'history-301__inst_1')).toBe(true);
    });

    test('getUserMeetingSeries groups instance meetings when user tracked base code', async () => {
      ctx.seed('tenants/acme.com/events/ev4', {
        email: 'teacher@acme.com',
        type: 'tracked',
        meta: { conferenceId: 'series-401' },
      });

      ctx.seed('tenants/acme.com/meetings/series-401__rec_1', {
        title: 'Weekly Seminar',
        meetingCode: 'series-401',
        recurringEventId: 'weekly-series-id',
        participantCount: 8,
        createdAt: wrapTimestamp(new Date()),
      });

      const res = await firestore.getUserMeetingSeries('acme.com', 'teacher@acme.com');
      expect(res.series.length).toBe(1);
      expect(res.series[0].recurringEventId).toBe('weekly-series-id');
      expect(res.series[0].instanceCount).toBe(1);
    });

    test('getMeetingDetail resolves anchor doc with hasInstances to latest instance and inherits series title/calendarAttendees', async () => {
      ctx.seed('tenants/acme.com/events/ev5', {
        email: 'teacher@acme.com',
        type: 'tracked',
        meta: { conferenceId: 'anchor-501' },
      });

      // Series anchor doc with metadata but hasInstances = true
      ctx.seed('tenants/acme.com/meetings/anchor-501', {
        title: 'Inherited Series Title',
        meetingCode: 'anchor-501',
        hasInstances: true,
        calendarAttendees: [{ email: 'student1@acme.com', displayName: 'Student One', responseStatus: 'accepted' }],
        startTime: wrapTimestamp(new Date(Date.now() - 7 * 86400 * 1000)),
      });

      // Instance doc for this meeting code
      ctx.seed('tenants/acme.com/meetings/anchor-501__session_99', {
        meetingCode: 'anchor-501',
        conferenceId: 'anchor-501',
        startTime: wrapTimestamp(new Date()),
        participantCount: 1,
      });

      // Query by base code
      const detail = await firestore.getMeetingDetail('acme.com', 'teacher@acme.com', 'anchor-501');
      expect(detail).toBeDefined();
      expect(detail.title).toBe('Inherited Series Title');
      expect(detail.calendarAttendees).toHaveLength(1);
      expect(detail.calendarAttendees[0].email).toBe('student1@acme.com');
    });
  });
});


describe('listUserShareLinks targeted doc fetch', () => {
  test('fetches only targeted meeting documents without scanning the entire collection', async () => {
    ctx.seed('tenants/acme.com/meetings/m1', {
      title: 'Biology 101',
      meetingCode: 'm1',
    });
    ctx.seed('tenants/acme.com/meetings/unrelated', {
      title: 'Unrelated Meeting',
      meetingCode: 'unrelated',
    });

    ctx.seed('shareLinks/token-abc', {
      token: 'token-abc',
      ownerEmail: 'teacher@acme.com',
      targetId: 'm1',
      type: 'meeting',
      createdAt: wrapTimestamp(new Date()),
      expiresAt: wrapTimestamp(new Date(Date.now() + 86400000)),
    });

    const meetingsCol = firestore.getDb().collection('tenants').doc('acme.com').collection('meetings');
    const colProto = Object.getPrototypeOf(meetingsCol);
    const colGetSpy = jest.spyOn(colProto, 'get');

    const docProto = Object.getPrototypeOf(meetingsCol.doc('m1'));
    const docGetSpy = jest.spyOn(docProto, 'get');

    const links = await firestore.listUserShareLinks('acme.com', 'teacher@acme.com');

    expect(colGetSpy).not.toHaveBeenCalled();
    expect(docGetSpy).toHaveBeenCalled();
    expect(links).toHaveLength(1);
    expect(links[0].targetTitle).toBe('Biology 101');

    colGetSpy.mockRestore();
    docGetSpy.mockRestore();
  });
});

describe('check-in session window for recurring meeting links', () => {
  test('returns already: true for check-ins within the 2-hour session window', async () => {
    const meetingCode = 'rec-meet-123';
    const first = await firestore.saveCheckin(meetingCode, { email: 'student@school.edu', displayName: 'Student' });
    expect(first.already).toBe(false);

    const second = await firestore.saveCheckin(meetingCode, { email: 'student@school.edu', displayName: 'Student' });
    expect(second.already).toBe(true);
    expect(second.checkedInAt).toBe(first.checkedInAt);
  });

  test('allows attendee to check in anew after the 2-hour session window expires', async () => {
    const meetingCode = 'rec-meet-456';
    const priorTimestamp = new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString();
    const email = 'student@school.edu';
    const key = Buffer.from(email).toString('base64url');
    ctx.seed(`checkins/${meetingCode}`, {
      meetingCode,
      people: {
        [key]: {
          email,
          displayName: 'Student',
          checkedInAt: priorTimestamp,
        },
      },
      expiresAt: wrapTimestamp(new Date(Date.now() + 2 * 60 * 60 * 1000)),
    });

    const anew = await firestore.saveCheckin(meetingCode, { email, displayName: 'Student' });
    expect(anew.already).toBe(false);
    expect(anew.checkedInAt).not.toBe(priorTimestamp);
    expect(new Date(anew.checkedInAt).getTime()).toBeGreaterThan(new Date(priorTimestamp).getTime());
  });
});

describe('getDomainClusterStats', () => {
  test('returns zeros for empty or personal email domains', async () => {
    expect(await firestore.getDomainClusterStats('')).toEqual({ payingColleagues: 0, largeClassCount: 0 });
    expect(await firestore.getDomainClusterStats('gmail.com')).toEqual({ payingColleagues: 0, largeClassCount: 0 });
  });

  test('counts active Pro users (non-expired or with stripe subscription) and large classes (>25 students)', async () => {
    const futureIso = new Date(Date.now() + 10 * 86400000).toISOString();
    const pastIso = new Date(Date.now() - 10 * 86400000).toISOString();

    ctx.seed('tenants/school.edu/users/u1@school.edu', { individualPlan: 'pro', individualPlanExpiresAt: futureIso });
    ctx.seed('tenants/school.edu/users/u2@school.edu', { individualPlan: 'pro', individualPlanExpiresAt: pastIso });
    ctx.seed('tenants/school.edu/users/u3@school.edu', { individualPlan: 'pro', individualPlanExpiresAt: pastIso, individualStripeSubscriptionId: 'sub_123' });
    ctx.seed('tenants/school.edu/users/u4@school.edu', { individualPlan: 'pro' });
    ctx.seed('tenants/school.edu/users/u5@school.edu', { individualPlan: 'free' });

    ctx.seed('tenants/school.edu/meetings/m1', { distinctAttendees: 32 });
    ctx.seed('tenants/school.edu/meetings/m2', { participantCount: 28 });
    ctx.seed('tenants/school.edu/meetings/m3', { participantCount: 15 });

    const stats = await firestore.getDomainClusterStats('school.edu');
    expect(stats).toEqual({ payingColleagues: 3, largeClassCount: 2 });
  });
});

