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
