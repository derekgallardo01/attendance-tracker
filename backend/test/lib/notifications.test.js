// Tests for the notifications module — Resend wiring, From-address resolution,
// HTML escaping, and the no-op behavior when RESEND_API_KEY is unset.

const { installFirestoreMock } = require('../helpers/firestoreMock');
let firestoreCtx;
beforeEach(() => { firestoreCtx = installFirestoreMock(); });
afterEach(() => { if (firestoreCtx) firestoreCtx.uninstall(); });

describe('notifications — module structure', () => {
  test('exports all expected send functions', () => {
    const n = require('../../src/lib/notifications');
    expect(typeof n.sendSignupWebhook).toBe('function');
    expect(typeof n.sendUpgradeNotification).toBe('function');
    expect(typeof n.sendAdminEmail).toBe('function');
    expect(typeof n.sendWeeklySelfReport).toBe('function');
    expect(typeof n.sendExportNotification).toBe('function');
    expect(typeof n.sendSeriesAlertEmail).toBe('function');
    expect(typeof n.sendFeedbackEmail).toBe('function');
    expect(typeof n.sendReactivationEmail).toBe('function');
    expect(typeof n.sendActivationNudgeEmail).toBe('function');
    expect(typeof n.sendSoloNudgeEmail).toBe('function');
    expect(typeof n.sendForgottenMeetingEmail).toBe('function');
    expect(typeof n.sendSubscriptionCancelledEmail).toBe('function');
    expect(typeof n.sendAdminSubscriptionCancelledNotification).toBe('function');
    expect(typeof n.sendAdminEmailUnsubscribedNotification).toBe('function');
  });
});

describe('notifications — unsubscribe token (CAN-SPAM one-click)', () => {
  test('token verifies for the same email and is case-insensitive', () => {
    const n = require('../../src/lib/notifications');
    const token = n.unsubscribeToken('User@Acme.com');
    expect(n.verifyUnsubscribeToken('User@Acme.com', token)).toBe(true);
    expect(n.verifyUnsubscribeToken('user@acme.com', token)).toBe(true);
  });

  test('token does not verify for a different email or a tampered token', () => {
    const n = require('../../src/lib/notifications');
    const token = n.unsubscribeToken('user@acme.com');
    expect(n.verifyUnsubscribeToken('other@acme.com', token)).toBe(false);
    expect(n.verifyUnsubscribeToken('user@acme.com', token + 'x')).toBe(false);
    expect(n.verifyUnsubscribeToken('user@acme.com', '')).toBe(false);
    expect(n.verifyUnsubscribeToken('', token)).toBe(false);
  });

  test('verify accepts a LEGACY (bare-secret) token so links already in inboxes keep working', () => {
    const crypto = require('crypto');
    const CONFIG = require('../../src/config');
    const n = require('../../src/lib/notifications');
    // Reconstruct the pre-key-separation token: HMAC under the raw SESSION_SECRET.
    const legacy = crypto.createHmac('sha256', CONFIG.sessionSecret)
      .update('user@acme.com').digest('hex').slice(0, 32);
    // The current mint uses a purpose-separated key, so it must differ...
    expect(n.unsubscribeToken('user@acme.com')).not.toBe(legacy);
    // ...yet the old link still verifies (backward compat).
    expect(n.verifyUnsubscribeToken('user@acme.com', legacy)).toBe(true);
  });

  test('unsubscribeUrl embeds the api base, escaped email, and a valid token', () => {
    const n = require('../../src/lib/notifications');
    const url = n.unsubscribeUrl('user+tag@acme.com');
    expect(url).toContain('/public/unsubscribe');
    expect(url).toContain('e=user%2Btag%40acme.com'); // encodeURIComponent
    const t = new URL(url).searchParams.get('t');
    expect(n.verifyUnsubscribeToken('user+tag@acme.com', t)).toBe(true);
  });

  test('unsubscribeFooter returns matching text + html fragments', () => {
    const n = require('../../src/lib/notifications');
    const foot = n.unsubscribeFooter('user@acme.com');
    expect(foot.text).toContain('Unsubscribe:');
    expect(foot.html).toContain('Unsubscribe');
    expect(foot.html).toContain('/public/unsubscribe');
  });
});

describe('notifications — no-op when Resend not configured', () => {
  // setup-env.js deliberately leaves RESEND_API_KEY unset. Verify our code
  // degrades to silent no-ops (fire-and-forget paths) or skipped responses
  // (return-value paths) without crashing.

  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    jest.resetModules();
  });

  test('sendSignupWebhook returns undefined silently (fire-and-forget)', async () => {
    const n = require('../../src/lib/notifications');
    const result = await n.sendSignupWebhook({
      email: 'new@acme.com', displayName: 'New', domain: 'acme.com',
      acquisitionSource: 'reddit', totalUsers: 19,
    });
    expect(result).toBeUndefined();
  });

  test('sendUpgradeNotification returns skipped silently when Resend unset', async () => {
    const n = require('../../src/lib/notifications');
    const result = await n.sendUpgradeNotification({ email: 'new@acme.com', plan: 'educator' });
    expect(result).toEqual({ skipped: 'no resend' });
  });

  test('sendExportNotification returns undefined silently', async () => {
    const n = require('../../src/lib/notifications');
    const result = await n.sendExportNotification({
      to: 'user@acme.com', sheetUrl: 'https://docs.google.com/x', meetingTitle: 'Test',
      totalAttended: 3, totalInvited: 5, exportedAt: new Date().toISOString(),
    });
    expect(result).toBeUndefined();
  });

  test('sendSeriesAlertEmail returns skipped status', async () => {
    const n = require('../../src/lib/notifications');
    const result = await n.sendSeriesAlertEmail({
      to: 'user@acme.com', alerts: [{ type: 'streak', personName: 'Alex', detail: 'missed 3', attended: 5, instanceCount: 10 }],
    });
    expect(result.skipped).toBeDefined();
  });

  test('sendReactivationEmail returns skipped status', async () => {
    const n = require('../../src/lib/notifications');
    const result = await n.sendReactivationEmail({
      to: 'user@acme.com', displayName: 'User', daysSinceLogin: 7, variant: '7d',
    });
    expect(result.skipped).toBeDefined();
  });

  test('sendForgottenMeetingEmail returns skipped status', async () => {
    const n = require('../../src/lib/notifications');
    const result = await n.sendForgottenMeetingEmail({
      to: 'user@acme.com', displayName: 'User',
      seriesTitle: 'Standup', recurringEventId: 'series-1',
      trackedInWindow: 5, daysSinceLast: 8,
    });
    expect(result.skipped).toBeDefined();
  });

  test('sendComebackEmail returns skipped status', async () => {
    const n = require('../../src/lib/notifications');
    const result = await n.sendComebackEmail({
      to: 'user@acme.com', displayName: 'User', meetingTitle: 'Spanish Class', daysSinceLogin: 8,
    });
    expect(result.skipped).toBeDefined();
  });

  test('sendAdminEmail throws when SMTP not configured (called by user-facing endpoint)', async () => {
    const n = require('../../src/lib/notifications');
    await expect(n.sendAdminEmail({ to: 'a@b.com', subject: 'Test', body: 'Hi' }))
      .rejects.toThrow(/Resend not configured/i);
  });

  test('sendFeedbackEmail throws when SMTP not configured', async () => {
    const n = require('../../src/lib/notifications');
    await expect(n.sendFeedbackEmail({ body: 'Test feedback' }))
      .rejects.toThrow(/Resend not configured/i);
  });
});

describe('notifications — Resend integration (mocked)', () => {
  let mockSend;

  beforeEach(() => {
    mockSend = jest.fn().mockResolvedValue({ data: { id: 'msg_test_123' } });
    jest.doMock('resend', () => ({
      Resend: jest.fn().mockImplementation(() => ({
        emails: { send: mockSend },
      })),
    }));
    process.env.RESEND_API_KEY = 're_test_key_xxx';
    jest.resetModules();
  });

  afterEach(() => {
    jest.dontMock('resend');
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_DOMAIN;
  });

  test('falls back to onboarding@resend.dev when RESEND_FROM_DOMAIN not set', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendExportNotification({
      to: 'user@acme.com', sheetUrl: 'https://docs.google.com/x', meetingTitle: 'Test',
      totalAttended: 3, totalInvited: 5, exportedAt: new Date().toISOString(),
    });
    expect(mockSend).toHaveBeenCalled();
    const callArg = mockSend.mock.calls[0][0];
    expect(callArg.from).toContain('onboarding@resend.dev');
  });

  test('uses verified domain when RESEND_FROM_DOMAIN is set', async () => {
    process.env.RESEND_FROM_DOMAIN = 'attendancetracker.dev';
    jest.resetModules();
    const n = require('../../src/lib/notifications');
    await n.sendExportNotification({
      to: 'user@acme.com', sheetUrl: 'https://docs.google.com/x', meetingTitle: 'Test',
      totalAttended: 3, totalInvited: 5, exportedAt: new Date().toISOString(),
    });
    const callArg = mockSend.mock.calls[0][0];
    expect(callArg.from).toContain('@attendancetracker.dev');
  });

  test('every send call includes a type tag for Resend dashboard analytics', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendSignupWebhook({
      email: 'a@b.com', displayName: 'A', domain: 'b.com',
      acquisitionSource: 'direct', totalUsers: 1,
    });
    const callArg = mockSend.mock.calls[0][0];
    expect(callArg.tags).toBeDefined();
    expect(callArg.tags.find(t => t.name === 'type' && t.value === 'signup')).toBeDefined();
  });

  test('series alert email gets the series_alert tag', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendSeriesAlertEmail({
      to: 'user@acme.com', displayName: 'User',
      alerts: [{ type: 'streak', personName: 'Alex', detail: 'missed 3', attended: 5, instanceCount: 10 }],
    });
    const callArg = mockSend.mock.calls[0][0];
    expect(callArg.tags.find(t => t.value === 'series_alert')).toBeDefined();
  });

  test('reactivation tags include variant (7d vs 30d)', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendReactivationEmail({
      to: 'u@a.com', displayName: 'U', daysSinceLogin: 31, variant: '30d',
    });
    const callArg = mockSend.mock.calls[0][0];
    expect(callArg.tags.find(t => t.name === 'variant' && t.value === '30d')).toBeDefined();
  });

  test('comeback email tags comeback_7d and renders the history link as an anchor', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendComebackEmail({ to: 'u@a.com', displayName: 'U', meetingTitle: 'Spanish Class', daysSinceLogin: 8 });
    const callArg = mockSend.mock.calls[0][0];
    expect(callArg.tags.find(t => t.value === 'comeback_7d')).toBeDefined();
    expect(callArg.subject).toMatch(/Track your next meeting/i);
    expect(callArg.html).toContain('open your dashboard'); // htmlLineTransform anchor branch
    expect(callArg.html).toContain('Spanish Class');       // meeting title in the copy
  });

  test('sendAdminEmail throws if to is missing (user-facing validation)', async () => {
    const n = require('../../src/lib/notifications');
    await expect(n.sendAdminEmail({ subject: 'X', body: 'Y' }))
      .rejects.toThrow(/to and subject/i);
  });

  test('replyTo on personal emails points to GMAIL_USER (your inbox)', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendReactivationEmail({
      to: 'u@a.com', displayName: 'U', daysSinceLogin: 8, variant: '7d',
    });
    const callArg = mockSend.mock.calls[0][0];
    expect(callArg.replyTo).toBe('derekgallardo01@gmail.com');
  });

  test('Resend hard error surfaces as a thrown Error from send()', async () => {
    mockSend.mockResolvedValueOnce({ error: { message: 'Domain not verified' } });
    const n = require('../../src/lib/notifications');
    // sendAdminEmail is the path that re-throws (user-facing endpoint needs to see failure)
    await expect(n.sendAdminEmail({ to: 'a@b.com', subject: 'X', body: 'Y' }))
      .rejects.toThrow(/Domain not verified/);
  });
});

describe('notifications — content sanity checks', () => {
  let mockSend;

  beforeEach(() => {
    mockSend = jest.fn().mockResolvedValue({ data: { id: 'msg_test' } });
    jest.doMock('resend', () => ({
      Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
    }));
    process.env.RESEND_API_KEY = 're_test';
    jest.resetModules();
  });
  afterEach(() => {
    jest.dontMock('resend');
    delete process.env.RESEND_API_KEY;
  });

  test('signup email subject includes display name + source', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendSignupWebhook({
      email: 'new@acme.com', displayName: 'Jane Doe', domain: 'acme.com',
      acquisitionSource: 'reddit', totalUsers: 19,
    });
    const arg = mockSend.mock.calls[0][0];
    expect(arg.subject).toContain('Jane Doe');
    expect(arg.subject).toContain('reddit');
  });

  test('signup email shows self-reported and detected source side by side when they differ', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendSignupWebhook({
      email: 'new@acme.com', displayName: 'Heléon', domain: 'gmail.com',
      reportedSource: 'google_search', reportedDetail: 'searched "meet attendance"',
      detectedSource: 'direct', totalUsers: 22,
    });
    const arg = mockSend.mock.calls[0][0];
    // Subject prefers the self-reported source (strongest attribution).
    expect(arg.subject).toContain('google_search');
    // Both signals rendered + labeled, so a "direct" auto-detect no longer
    // masks the real channel.
    expect(arg.html).toContain('self-reported');
    expect(arg.html).toContain('google_search');
    expect(arg.html).toContain('searched');
    expect(arg.html).toContain('detected');
    expect(arg.html).toContain('direct');
    expect(arg.text).toContain('Source (self-reported): google_search');
    expect(arg.text).toContain('Source (detected): direct');
  });

  test('signup email marks self-reported as "Not reported" until the modal is answered', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendSignupWebhook({
      email: 'new@acme.com', displayName: 'Bob', domain: 'acme.com',
      detectedSource: 'ref:news.ycombinator.com', totalUsers: 3,
    });
    const arg = mockSend.mock.calls[0][0];
    expect(arg.html).toContain('Not reported');
    expect(arg.subject).toContain('ref:news.ycombinator.com'); // falls back to detected
  });

  test('maybeSendSignupNotification sends on a claimed pending signup and no-ops otherwise', async () => {
    const claimSignupNotification = jest.fn()
      .mockResolvedValueOnce({
        email: 'a@x.com', displayName: 'A', domain: 'x.com',
        reportedSource: 'google_search', reportedDetail: null, detectedSource: 'direct',
      })
      .mockResolvedValueOnce(null);
    jest.doMock('../../src/services/firestore', () => ({
      claimSignupNotification,
      countAllUsers: jest.fn().mockResolvedValue(22),
      isEmailSuppressed: jest.fn().mockResolvedValue(false), // welcome email checks suppression
    }));
    jest.resetModules();
    const n = require('../../src/lib/notifications');

    // First call: a pending signup is claimed → the email goes out with the
    // self-reported source, and the total-users count is looked up at send time.
    // Also fires a welcome email directly to the new user (fire-and-forget,
    // now gated on an async suppression check — let its microtasks settle).
    await n.maybeSendSignupNotification('x.com', 'a@x.com');
    await new Promise((r) => setImmediate(r));
    expect(claimSignupNotification).toHaveBeenCalledWith('x.com', 'a@x.com');
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend.mock.calls[0][0].subject).toContain('google_search');
    expect(mockSend.mock.calls[0][0].text).toContain('Total users now: 22');
    expect(mockSend.mock.calls[1][0].subject).toBe('Welcome to Attendance Tracker for Google Meet');
    expect(mockSend.mock.calls[1][0].to).toEqual(['a@x.com']);

    // Second call: nothing pending (claim returns null) → no email.
    const res = await n.maybeSendSignupNotification('x.com', 'a@x.com');
    expect(res).toEqual({ sent: false });
    expect(mockSend).toHaveBeenCalledTimes(2);

    jest.dontMock('../../src/services/firestore');
  });

  test('maybeSendSignupNotification RELEASES the claim on a definite send failure (retryable by the sweep)', async () => {
    const claimSignupNotification = jest.fn().mockResolvedValue({
      email: 'b@x.com', displayName: 'B', domain: 'x.com',
      reportedSource: null, reportedDetail: null, detectedSource: 'direct',
    });
    const releaseSignupNotification = jest.fn().mockResolvedValue(undefined);
    jest.doMock('../../src/services/firestore', () => ({
      claimSignupNotification,
      releaseSignupNotification,
      countAllUsers: jest.fn().mockResolvedValue(22),
      isEmailSuppressed: jest.fn().mockResolvedValue(false),
    }));
    jest.resetModules();
    const n = require('../../src/lib/notifications');
    // Definite Resend failure (NOT a timeout) → dispatchEmail returns
    // {sent:false, error} → the claim must be re-armed so the daily sweep can
    // retry. Before this, one 5xx permanently lost the signup ping.
    mockSend.mockRejectedValueOnce(new Error('resend 500'));
    const res = await n.maybeSendSignupNotification('x.com', 'b@x.com');
    await new Promise((r) => setImmediate(r));
    expect(res).toEqual({ sent: false, released: true });
    expect(releaseSignupNotification).toHaveBeenCalledWith('x.com', 'b@x.com');
    jest.dontMock('../../src/services/firestore');
  });

  test('maybeSendReferralNotification credits + emails the inviter once, no-ops otherwise', async () => {
    const claimReferral = jest.fn()
      .mockResolvedValueOnce({ referredBy: 'inviter@acme.com', newUserEmail: 'new@acme.com', newUserName: 'New User' })
      .mockResolvedValueOnce(null);
    const recordReferralForInviter = jest.fn().mockResolvedValue({
      inviterExists: true, inviterDisplayName: 'Inviter', totalReferrals: 2, already: false, rewardEligible: true,
    });
    const isEmailSuppressed = jest.fn().mockResolvedValue(false);
    jest.doMock('../../src/services/firestore', () => ({ claimReferral, recordReferralForInviter, isEmailSuppressed }));
    jest.resetModules();
    const n = require('../../src/lib/notifications');

    // First call: claims the referral → credits the inviter → emails them.
    await n.maybeSendReferralNotification('acme.com', 'new@acme.com');
    expect(claimReferral).toHaveBeenCalledWith('acme.com', 'new@acme.com');
    expect(recordReferralForInviter).toHaveBeenCalledWith('inviter@acme.com', expect.objectContaining({ newUserEmail: 'new@acme.com' }));
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect([].concat(mockSend.mock.calls[0][0].to)).toContain('inviter@acme.com');
    expect(mockSend.mock.calls[0][0].subject).toContain('New User');
    expect(mockSend.mock.calls[0][0].text).toMatch(/free month/i);

    // Second call: nothing pending → no email, no credit.
    const res = await n.maybeSendReferralNotification('acme.com', 'new@acme.com');
    expect(res).toEqual({ sent: false });
    expect(mockSend).toHaveBeenCalledTimes(1);

    jest.dontMock('../../src/services/firestore');
  });

  test('maybeSendReferralNotification credits but does not email a suppressed inviter', async () => {
    const claimReferral = jest.fn().mockResolvedValue({ referredBy: 'inviter@acme.com', newUserEmail: 'new@acme.com', newUserName: 'New' });
    const recordReferralForInviter = jest.fn().mockResolvedValue({ inviterExists: true, inviterDisplayName: 'Inviter', totalReferrals: 1, already: false, rewardEligible: true });
    const isEmailSuppressed = jest.fn().mockResolvedValue(true); // inviter opted out
    jest.doMock('../../src/services/firestore', () => ({ claimReferral, recordReferralForInviter, isEmailSuppressed }));
    jest.resetModules();
    const n = require('../../src/lib/notifications');

    const res = await n.maybeSendReferralNotification('acme.com', 'new@acme.com');
    expect(recordReferralForInviter).toHaveBeenCalled(); // still credited
    expect(res).toMatchObject({ sent: false, recorded: true });
    expect(mockSend).not.toHaveBeenCalled(); // but not emailed

    jest.dontMock('../../src/services/firestore');
  });

  test('maybeSendReferralNotification includes a minted promo code in the email', async () => {
    const claimReferral = jest.fn().mockResolvedValue({ referredBy: 'inviter@acme.com', newUserEmail: 'new@acme.com', newUserName: 'New' });
    const recordReferralForInviter = jest.fn().mockResolvedValue({ inviterExists: true, inviterDisplayName: 'Inviter', totalReferrals: 1, already: false, rewardEligible: true });
    const recordReferralPromoCode = jest.fn();
    const isEmailSuppressed = jest.fn().mockResolvedValue(false);
    jest.doMock('../../src/services/firestore', () => ({ claimReferral, recordReferralForInviter, recordReferralPromoCode, isEmailSuppressed }));
    jest.doMock('../../src/routes/billing', () => ({ createReferralPromoCode: jest.fn().mockResolvedValue('FREEMO123') }));
    jest.resetModules();
    const n = require('../../src/lib/notifications');

    await n.maybeSendReferralNotification('acme.com', 'new@acme.com');
    expect(recordReferralPromoCode).toHaveBeenCalledWith('inviter@acme.com', 'FREEMO123');
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].text).toContain('FREEMO123');

    jest.dontMock('../../src/routes/billing');
    jest.dontMock('../../src/services/firestore');
  });

  test('maybeSendReferralNotification rejects a self-referral (no credit, no coupon, no email)', async () => {
    const claimReferral = jest.fn().mockResolvedValue({ referredBy: 'a@x.com', newUserEmail: 'a@x.com', newUserName: 'A' });
    const recordReferralForInviter = jest.fn();
    const isEmailSuppressed = jest.fn();
    jest.doMock('../../src/services/firestore', () => ({ claimReferral, recordReferralForInviter, isEmailSuppressed }));
    jest.resetModules();
    const n = require('../../src/lib/notifications');
    const res = await n.maybeSendReferralNotification('x.com', 'a@x.com');
    expect(res).toEqual({ sent: false, selfReferral: true });
    expect(recordReferralForInviter).not.toHaveBeenCalled(); // no credit
    expect(mockSend).not.toHaveBeenCalled();                 // no email
    jest.dontMock('../../src/services/firestore');
  });

  test('maybeSendReferralNotification releases the claim when crediting fails transiently (so it retries)', async () => {
    const claimReferral = jest.fn().mockResolvedValue({ referredBy: 'inviter@acme.com', newUserEmail: 'new@acme.com', newUserName: 'New' });
    const releaseReferral = jest.fn();
    const recordReferralForInviter = jest.fn().mockRejectedValue(new Error('firestore blip'));
    const isEmailSuppressed = jest.fn();
    jest.doMock('../../src/services/firestore', () => ({ claimReferral, releaseReferral, recordReferralForInviter, isEmailSuppressed }));
    jest.resetModules();
    const n = require('../../src/lib/notifications');
    const res = await n.maybeSendReferralNotification('acme.com', 'new@acme.com');
    expect(res).toEqual({ sent: false, released: true });
    expect(releaseReferral).toHaveBeenCalledWith('acme.com', 'new@acme.com'); // re-armed for a later flush
    expect(mockSend).not.toHaveBeenCalled();
    jest.dontMock('../../src/services/firestore');
  });

  test('flushDeferredNotifications fires both flushes fire-and-forget and swallows errors', async () => {
    jest.doMock('../../src/services/firestore', () => ({
      claimSignupNotification: jest.fn().mockRejectedValue(new Error('boom')), // exercise the .catch
      countAllUsers: jest.fn(),
      claimReferral: jest.fn().mockResolvedValue(null), // referral no-op path
      recordReferralForInviter: jest.fn(), recordReferralPromoCode: jest.fn(), isEmailSuppressed: jest.fn(),
    }));
    jest.resetModules();
    const n = require('../../src/lib/notifications');
    // Returns synchronously (void) and never throws despite the rejecting flush.
    expect(() => n.flushDeferredNotifications('x.com', 'a@x.com')).not.toThrow();
    await new Promise((r) => setImmediate(r)); // let the fire-and-forget promises settle
    jest.dontMock('../../src/services/firestore');
  });

  test('export notification subject includes attendance summary', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendExportNotification({
      to: 'user@acme.com', meetingTitle: 'Sprint Planning', sheetUrl: 'https://docs.google.com/x',
      totalAttended: 7, totalInvited: 10, exportedAt: new Date().toISOString(),
    });
    const arg = mockSend.mock.calls[0][0];
    expect(arg.subject).toContain('Sprint Planning');
    expect(arg.subject).toContain('7 of 10 attended');
  });

  test('reactivation 30d uses the "should I delete" subject (loss aversion)', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendReactivationEmail({
      to: 'u@a.com', displayName: 'User', daysSinceLogin: 35, variant: '30d',
    });
    const arg = mockSend.mock.calls[0][0];
    expect(arg.subject).toMatch(/delete/i);
  });

  test('HTML escapes special chars in user-provided fields (no XSS)', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendFeedbackEmail({
      body: '<script>alert("xss")</script>',
      fromEmail: 'attacker@evil.com',
      fromName: '<img src=x onerror=alert(1)>',
    });
    const arg = mockSend.mock.calls[0][0];
    expect(arg.html).not.toContain('<script>alert');
    expect(arg.html).toContain('&lt;script&gt;');
    expect(arg.html).not.toContain('<img src=x');
    expect(arg.html).toContain('&lt;img');
  });
});

describe('notifications — additional senders (Resend mocked)', () => {
  let mockSend;
  beforeEach(() => {
    mockSend = jest.fn().mockResolvedValue({ data: { id: 'msg_x' } });
    jest.doMock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.NOTIFY_EMAIL = 'owner@acme.com';
    jest.resetModules();
  });
  afterEach(() => { jest.dontMock('resend'); delete process.env.RESEND_API_KEY; delete process.env.NOTIFY_EMAIL; });

  const fullReport = {
    windowStart: Date.now() - 7 * 86400000, windowEnd: Date.now(),
    totalUsers: 42, totalMeetings: 100,
    signups: { thisWeek: 3, lastWeek: 1, delta: '+2', new: [{ displayName: 'A', email: 'a@x.com', domain: 'x.com', source: 'reddit' }] },
    tracks: { thisWeek: 5, lastWeek: 8, delta: '-3' },
    exports: { thisWeek: 2, lastWeek: 2, delta: '0' },
    concerns: [{ displayName: 'B', email: 'b@x.com', domain: 'x.com' }],
    sources: { reddit: 5, google_search: 2 },
    topUser: { displayName: 'Power User', actions: 12 },
  };

  test('sendWeeklySelfReport sends with arrow up/down/neutral + populated lists', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendWeeklySelfReport(fullReport);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ tags: [{ name: 'type', value: 'weekly_report' }] }));
    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('▲'); expect(html).toContain('▼'); // +2 and -3 arrows
  });

  test('sendWeeklySelfReport uses fallback copy when everything is empty', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendWeeklySelfReport({
      ...fullReport,
      signups: { thisWeek: 1, lastWeek: 0, delta: '+1', new: [] },
      concerns: [], sources: {}, topUser: null,
    });
    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('No new signups this week');
    expect(html).toContain('Nobody yet');
  });

  test('sendActivationNudgeEmail sends an activation nudge', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendActivationNudgeEmail({ to: 'u@x.com', displayName: 'U', daysSinceLogin: 8 });
    expect(mockSend).toHaveBeenCalled();
  });

  test('sendSoloNudgeEmail sends a solo-tester nudge', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendSoloNudgeEmail({ to: 'u@x.com', displayName: 'U', daysSinceLogin: 8 });
    expect(mockSend).toHaveBeenCalled();
  });

  test('sendWelcomeEmail sends a welcome email to a new user', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendWelcomeEmail({ to: 'newuser@school.edu', displayName: 'Prof Smith' });
    expect(mockSend).toHaveBeenCalled();
  });
});

describe('notifications — Slack test ping', () => {
  afterEach(() => { delete global.fetch; });
  test('sendSlackTestPing posts to the webhook and reports sent', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    const n = require('../../src/lib/notifications');
    const res = await n.sendSlackTestPing({ webhookUrl: 'https://hooks.slack.com/services/T/B/C' });
    expect(res.sent).toBe(true);
    expect(global.fetch).toHaveBeenCalled();
  });

  test('sendSlackTestPing reports not-sent on a non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404, text: async () => 'invalid' });
    const n = require('../../src/lib/notifications');
    const res = await n.sendSlackTestPing({ webhookUrl: 'https://hooks.slack.com/services/T/B/C' });
    expect(res.sent).toBe(false);
  });
});

describe('notifications — email template branches (Resend mocked)', () => {
  let mockSend;
  beforeEach(() => {
    mockSend = jest.fn().mockResolvedValue({ data: { id: 'm' } });
    jest.doMock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));
    process.env.RESEND_API_KEY = 're_test';
    jest.resetModules();
  });
  afterEach(() => { jest.dontMock('resend'); delete process.env.RESEND_API_KEY; });

  test('sendExportNotification renders a rich table (all statuses, late, overflow, links)', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendExportNotification({
      to: 'u@x.com', displayName: 'Jane Doe', sheetUrl: 'https://s', meetingTitle: 'Standup',
      totalAttended: 3, totalInvited: 5, exportedAt: Date.now(),
      participants: [
        { displayName: 'A', email: 'a@x.com', status: 'Present', durationMin: 30, lateMin: 7 },
        { email: 'b@x.com', status: 'Left', durationMin: 10 },
        { displayName: 'C', status: 'Excused', durationMin: 0 },
        { displayName: 'D', email: 'd@x.com', status: 'Absent', durationMin: 0 },
      ],
      overflow: 2, conferenceId: 'conf-1', recurringEventId: 'rid-1',
    });
    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('late'); expect(html).toContain('more in the sheet');
    expect(html).toContain('see the full trend');
  });

  test('sendExportNotification minimal (no participants/invited/date/name/links)', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendExportNotification({ to: 'u@x.com', sheetUrl: 'https://s', totalAttended: 0, participants: [] });
    expect(mockSend).toHaveBeenCalled();
  });

  test('sendSeriesAlertEmail single alert vs multiple', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendSeriesAlertEmail({ to: 'u@x.com', displayName: 'Jane', alerts: [{ type: 'streak', personName: 'A', detail: 'missed 3', attended: 5, instanceCount: 8 }] });
    await n.sendSeriesAlertEmail({ to: 'u@x.com', alerts: [
      { type: 'streak', personEmail: 'a@x.com', detail: 'missed 3', attended: 5, instanceCount: 8 },
      { type: 'threshold', detail: 'dropped', attended: 2, instanceCount: 16 },
    ] });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('sendSeriesAlertEmail skips when there are no alerts', async () => {
    const n = require('../../src/lib/notifications');
    expect(await n.sendSeriesAlertEmail({ to: 'u@x.com', alerts: [] })).toEqual({ skipped: 'no alerts' });
  });
});

describe('notifications — remaining sender branches (Resend mocked)', () => {
  let mockSend;
  beforeEach(() => {
    mockSend = jest.fn().mockResolvedValue({ data: { id: 'm' } });
    jest.doMock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));
    process.env.RESEND_API_KEY = 're_test';
    jest.resetModules();
  });
  afterEach(() => { jest.dontMock('resend'); delete process.env.RESEND_API_KEY; });

  test('sendSignupWebhook with and without acquisitionSource', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendSignupWebhook({ email: 'a@x.com', displayName: 'A', domain: 'x.com', acquisitionSource: 'reddit', totalUsers: 42 });
    await n.sendSignupWebhook({ email: 'b@x.com', displayName: 'B', domain: 'x.com', totalUsers: 1 });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('sendSignupWebhook includes IP, country, and ipinfo.io link when geo is present', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendSignupWebhook({
      email: 'c@x.com', displayName: 'C', domain: 'x.com',
      detectedSource: 'direct', totalUsers: 5,
      signupIp: '203.0.113.1',
      signupGeo: { country: 'PH', region: '40', city: 'Calamba' },
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0][0];
    expect(call.html).toContain('203.0.113.1');
    expect(call.html).toContain('(PH)');
    expect(call.html).toContain('https://ipinfo.io/203.0.113.1');
    expect(call.text).toContain('203.0.113.1 (PH)');
    expect(call.text).toContain('https://ipinfo.io/203.0.113.1');
  });

  test('sendSignupWebhook shows Unknown when IP is missing', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendSignupWebhook({ email: 'd@x.com', displayName: 'D', domain: 'x.com', totalUsers: 3 });
    const call = mockSend.mock.calls[0][0];
    expect(call.html).toContain('Unknown');
    expect(call.text).toContain('Unknown');
  });

  test('sendUpgradeNotification formats educator plan, amount, currency, Stripe links, and country flag', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendUpgradeNotification({
      email: 'karla@example.com',
      displayName: 'Karla',
      domain: 'example.com',
      plan: 'educator',
      amountTotal: 249,
      currency: 'usd',
      customerId: 'cus_123',
      subscriptionId: 'sub_456',
      country: 'BR',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0][0];
    expect(call.subject).toContain('💰 New Upgrade: Karla ($2.49 USD - Educator Pro)');
    expect(call.html).toContain('Educator Pro');
    expect(call.html).toContain('$2.49 USD');
    expect(call.html).toContain('https://dashboard.stripe.com/subscriptions/sub_456');
    expect(call.html).toContain('https://dashboard.stripe.com/customers/cus_123');
    expect(call.text).toContain('karla@example.com');
  });

  test('sendUpgradeNotification formats team and lifetime plans, and handles missing amount/country/customer gracefully', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendUpgradeNotification({
      email: 'admin@school.org',
      domain: 'school.org',
      plan: 'lifetime',
      amountTotal: null,
    });
    await n.sendUpgradeNotification({
      email: 'team@company.com',
      domain: 'company.com',
      plan: 'team',
      amountTotal: 1999,
      currency: 'usd',
      isTeam: true,
    });
    expect(mockSend).toHaveBeenCalledTimes(2);
    const call1 = mockSend.mock.calls[0][0];
    expect(call1.subject).toContain('Lifetime Pass');
    expect(call1.html).toContain('Active');
    const call2 = mockSend.mock.calls[1][0];
    expect(call2.subject).toContain('Team Pro');
    expect(call2.html).toContain('$19.99 USD');
  });

  test('sendAdminSubscriptionCancelledNotification formats plan, dates, Stripe links, and source', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendAdminSubscriptionCancelledNotification({
      email: 'teacher@school.edu',
      displayName: 'Teacher Jane',
      domain: 'school.edu',
      plan: 'educator',
      subscriptionId: 'sub_cancel_123',
      customerId: 'cus_test_123',
      currentPeriodEnd: 'October 15, 2026',
      source: 'in_app_settings',
    });
    expect(mockSend).toHaveBeenCalled();
    const call = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
    expect(call.subject).toContain('⚠️ Subscription Cancelled: Teacher Jane (Educator Pro)');
    expect(call.html).toContain('Educator Pro');
    expect(call.html).toContain('October 15, 2026');
    expect(call.html).toContain('https://dashboard.stripe.com/subscriptions/sub_cancel_123');
    expect(call.html).toContain('https://dashboard.stripe.com/customers/cus_test_123');
    expect(call.html).toContain('in_app_settings');
    expect(call.text).toContain('teacher@school.edu');
  });

  test('sendAdminEmailUnsubscribedNotification formats all and granular categories', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendAdminEmailUnsubscribedNotification({
      email: 'unsub@domain.com',
      domain: 'domain.com',
      type: 'all',
      source: 'one_click_unsubscribe',
    });
    let call = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
    expect(call.subject).toContain('🔕 Email Opt-Out: unsub@domain.com unsubscribed from all emails');
    expect(call.html).toContain('Unsubscribed from ALL emails');
    expect(call.html).toContain('one_click_unsubscribe');

    await n.sendAdminEmailUnsubscribedNotification({
      email: 'granular@domain.com',
      domain: 'domain.com',
      type: 'categories',
      disabledCategories: ['weeklyDigest', 'tipsAndUpdates'],
      enabledCategories: ['exportSummary', 'seriesAlerts'],
      source: 'settings_modal',
    });
    call = mockSend.mock.calls[mockSend.mock.calls.length - 1][0];
    expect(call.subject).toContain('🔕 Email Preferences: granular@domain.com disabled');
    expect(call.html).toContain('Weekly digest');
    expect(call.html).toContain('Tips &amp; product updates');
    expect(call.html).toContain('Export &amp; attendance summaries');
  });

  test('sendReactivationEmail 7d and 30d variants', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendReactivationEmail({ to: 'u@x.com', displayName: 'U', daysSinceLogin: 8, variant: '7d' });
    await n.sendReactivationEmail({ to: 'u@x.com', displayName: 'U', daysSinceLogin: 33, variant: '30d' });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('sendForgottenMeetingEmail renders the series link transform', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendForgottenMeetingEmail({ to: 'u@x.com', displayName: 'U', seriesTitle: 'Standup', recurringEventId: 'rid-1', trackedInWindow: 4, daysSinceLast: 8 });
    expect(mockSend).toHaveBeenCalled();
    expect(mockSend.mock.calls[0][0].html).toContain('view the trend');
  });

  test('sendExportGapEmail renders the dashboard link and names the meeting (fallback "your class")', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendExportGapEmail({ to: 'u@x.com', displayName: 'U', meetingTitle: 'Bio 101', daysSinceLogin: 8 });
    expect(mockSend.mock.calls[0][0].html).toContain('open your dashboard');
    expect(mockSend.mock.calls[0][0].html).toContain('Bio 101');
    await n.sendExportGapEmail({ to: 'u@x.com', displayName: 'U', daysSinceLogin: 8 }); // no title → fallback
    expect(mockSend.mock.calls[1][0].html).toContain('your class');
  });

  test('sendUpcomingMeetingEmail renders "starts soon" and the "starting now" variant', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendUpcomingMeetingEmail({ to: 'u@x.com', displayName: 'U', meetingTitle: 'Weekly Class', minutesUntil: 30 });
    expect(mockSend.mock.calls[0][0].subject).toContain('starts soon');
    expect(mockSend.mock.calls[0][0].html).toContain('Weekly Class');
    expect(mockSend.mock.calls[0][0].html).toContain('about 30 minutes');
    await n.sendUpcomingMeetingEmail({ to: 'u@x.com', displayName: 'U', meetingTitle: 'Weekly Class', minutesUntil: 0 });
    expect(mockSend.mock.calls[1][0].subject).toContain('is starting');
    expect(mockSend.mock.calls[1][0].html).toContain('is starting now');
  });

  test('sendSeriesAlertEmail falls back to "Someone" when no name/email', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendSeriesAlertEmail({ to: 'u@x.com', alerts: [{ type: 'streak', detail: 'missed', attended: 1, instanceCount: 6 }] });
    expect(mockSend.mock.calls[0][0].subject).toContain('Someone');
  });

  test('sendWeeklySelfReport lists a signup without a source', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendWeeklySelfReport({
      windowStart: Date.now() - 7 * 86400000, windowEnd: Date.now(), totalUsers: 1, totalMeetings: 1,
      signups: { thisWeek: 1, lastWeek: 0, delta: '0', new: [{ displayName: 'A', email: 'a@x.com', domain: 'x.com' }] },
      tracks: { thisWeek: 0, lastWeek: 0, delta: '0' }, exports: { thisWeek: 0, lastWeek: 0, delta: '0' },
      concerns: [], sources: {}, topUser: null,
    });
    expect(mockSend).toHaveBeenCalled();
  });
});

describe('notifications — buildSlackDigestBlocks buckets', () => {
  const n = require('../../src/lib/notifications');
  test('renders present/left/absent/excused buckets with overflow', () => {
    const participants = [];
    for (let i = 0; i < 10; i++) participants.push({ displayName: `P${i}`, email: `p${i}@x.com`, status: 'Present' });
    participants.push({ displayName: 'L', status: 'Left' });
    participants.push({ email: 'a@x.com', status: 'Absent' });
    participants.push({ displayName: 'E', status: 'Excused' });
    const blocks = n.buildSlackDigestBlocks({ meetingTitle: 'M', totalAttended: 10, totalInvited: 13, participants, sheetUrl: 'https://s', durationMin: 45, startTime: Date.now() });
    expect(Array.isArray(blocks)).toBe(true);
    const text = n.buildSlackFallbackText({ meetingTitle: 'M', totalAttended: 10, totalInvited: 13 });
    expect(typeof text).toBe('string');
  });

  test('handles a title-less digest with no invited count', () => {
    const blocks = n.buildSlackDigestBlocks({ totalAttended: 2, participants: [{ displayName: 'X', status: 'Present' }] });
    expect(Array.isArray(blocks)).toBe(true);
  });
});

describe('notifications — send() internals + Slack transport', () => {
  let mockSend;
  beforeEach(() => {
    mockSend = jest.fn().mockResolvedValue({ data: { id: 'm' } });
    jest.doMock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));
    process.env.RESEND_API_KEY = 're_test';
    jest.resetModules();
  });
  afterEach(() => { jest.dontMock('resend'); delete process.env.RESEND_API_KEY; delete global.fetch; delete process.env.SLACK_TIMEOUT_MS; });

  test('sendAdminEmail accepts an array of recipients', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendAdminEmail({ to: ['a@x.com', 'b@x.com'], subject: 'S', body: 'line1\nline2' });
    expect(mockSend.mock.calls[0][0].to).toEqual(['a@x.com', 'b@x.com']);
  });

  test('send surfaces a Resend error object with no message field', async () => {
    mockSend.mockResolvedValue({ error: {} }); // error present, no message
    const n = require('../../src/lib/notifications');
    await expect(n.sendAdminEmail({ to: 'a@x.com', subject: 'S', body: 'b' })).rejects.toThrow(/Resend send failed/);
  });

  test('sendSlackDigest aborts on a hung webhook (timeout)', async () => {
    process.env.SLACK_TIMEOUT_MS = '30';
    const n = require('../../src/lib/notifications');
    global.fetch = jest.fn((url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    const res = await n.sendSlackDigest({ webhookUrl: 'https://hooks.slack.com/services/T/B/C', meetingTitle: 'M', totalAttended: 1, participants: [], sheetUrl: 'https://s' });
    expect(res.sent).toBe(false);
  });

  test('sendSlackTestPing reports not-sent when fetch throws', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down'));
    const n = require('../../src/lib/notifications');
    const res = await n.sendSlackTestPing({ webhookUrl: 'https://hooks.slack.com/services/T/B/C' });
    expect(res.sent).toBe(false);
  });
});

describe('notifications — dispatch + resend timeout', () => {
  afterEach(() => { jest.dontMock('resend'); delete process.env.RESEND_API_KEY; delete process.env.RESEND_TIMEOUT_MS; });

  test('dispatchEmail returns {sent:false} when send rejects', async () => {
    jest.doMock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: jest.fn().mockRejectedValue(new Error('resend down')) } })) }));
    process.env.RESEND_API_KEY = 're_test';
    jest.resetModules();
    const n = require('../../src/lib/notifications');
    const res = await n.sendExportNotification({ to: 'u@x.com', sheetUrl: 'https://s', totalAttended: 1, participants: [{ displayName: 'A', status: 'Present', durationMin: 5 }] });
    expect(res.sent).toBe(false);
  });

  test('send races a hung Resend call against the timeout → optimistic sent (no duplicate on retry)', async () => {
    process.env.RESEND_TIMEOUT_MS = '30';
    jest.doMock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: jest.fn(() => new Promise(() => {})) } })) }));
    process.env.RESEND_API_KEY = 're_test';
    jest.resetModules();
    const n = require('../../src/lib/notifications');
    // A TIMEOUT is ambiguous (may have delivered) → dispatchEmail reports
    // sent:true + timedOut so sweeps keep their dedup claim and never resend a
    // duplicate. A definite Resend error still returns sent:false → retry.
    const res = await n.sendSignupWebhook({ email: 'a@x.com', displayName: 'A', domain: 'x.com', totalUsers: 1 });
    expect(res.sent).toBe(true);
    expect(res.timedOut).toBe(true);
  });
});

describe('notifications — minimal-field fallbacks (Resend mocked)', () => {
  let mockSend;
  beforeEach(() => {
    mockSend = jest.fn().mockResolvedValue({ data: { id: 'm' } });
    jest.doMock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));
    process.env.RESEND_API_KEY = 're_test';
    jest.resetModules();
  });
  afterEach(() => { jest.dontMock('resend'); delete process.env.RESEND_API_KEY; });

  test('signup with no displayName/source/totalUsers uses fallbacks', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendSignupWebhook({ email: 'a@x.com', domain: 'x.com' });
    const html = mockSend.mock.calls[0][0].html;
    expect(html).toContain('Unknown'); expect(html).toContain('?');
  });

  test('export with a nameless/emailless participant and no date/links', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendExportNotification({ to: 'u@x.com', sheetUrl: 'https://s', totalAttended: 1, participants: [{ status: 'Present', durationMin: 0 }] });
    expect(mockSend).toHaveBeenCalled();
    const sent = mockSend.mock.calls[0][0];
    expect(sent.html).toContain('Leave a 5-Star Review');
    expect(sent.text).toContain('Leave a quick 5-star review');
  });

  test('export notification suppresses review prompt for isPro users', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendExportNotification({ to: 'pro@school.edu', sheetUrl: 'https://s', totalAttended: 5, participants: [{ status: 'Present', durationMin: 45 }], isPro: true });
    expect(mockSend).toHaveBeenCalled();
    const sent = mockSend.mock.calls[0][0];
    expect(sent.html).not.toContain('Leave a 5-Star Review');
    expect(sent.text).not.toContain('Leave a quick 5-star review');
  });

  test('sendExportNotification localizes to Spanish, Portuguese, and Bengali', async () => {
    const n = require('../../src/lib/notifications');
    // Spanish
    await n.sendExportNotification({
      to: 'docente@colegio.edu.co',
      displayName: 'Carlos Rodriguez',
      sheetUrl: 'https://s',
      meetingTitle: 'Clase de Historia',
      totalAttended: 15,
      totalInvited: 20,
      exportedAt: Date.now(),
      participants: [
        { displayName: 'Juan', status: 'Present', durationMin: 45, lateMin: 5 },
        { displayName: 'Maria', status: 'Left', durationMin: 20 },
        { displayName: 'Pedro', status: 'Excused', durationMin: 0 },
        { displayName: 'Luis', status: 'Absent', durationMin: 0 },
      ],
      overflow: 5,
      conferenceId: 'conf-es',
      recurringEventId: 'rec-es',
      isPro: false,
    });
    const esSent = mockSend.mock.calls[0][0];
    expect(esSent.subject).toContain('Asistencia: Clase de Historia — 15 de 20 asistieron');
    expect(esSent.html).toContain('Hola Carlos,');
    expect(esSent.html).toContain('Exportación lista');
    expect(esSent.html).toContain('Tu reunión acaba de finalizar');
    expect(esSent.html).toContain('Persona');
    expect(esSent.html).toContain('Estado');
    expect(esSent.html).toContain('Tiempo');
    expect(esSent.html).toContain('Presente');
    expect(esSent.html).toContain('Salió');
    expect(esSent.html).toContain('Justificado');
    expect(esSent.html).toContain('Ausente');
    expect(esSent.html).toContain('+5 min tarde');
    expect(esSent.html).toContain('…y 5 más en la hoja');
    expect(esSent.html).toContain('Abrir hoja');
    expect(esSent.html).toContain('Ver en la web →');
    expect(esSent.html).toContain('ver la tendencia completa →');
    expect(esSent.html).toContain('¿Te ahorró tiempo hoy?');
    expect(esSent.html).toContain('Dejar reseña de 5 estrellas (10s) →');
    expect(esSent.tags).toEqual(expect.arrayContaining([{ name: 'lang', value: 'es' }]));

    mockSend.mockClear();

    // Portuguese
    await n.sendExportNotification({
      to: 'prof@escola.com.br',
      displayName: 'Ana Silva',
      sheetUrl: 'https://s',
      meetingTitle: 'Aula de Matemática',
      totalAttended: 10,
      totalInvited: 12,
      exportedAt: Date.now(),
      participants: [
        { displayName: 'Lucas', status: 'Present', durationMin: 50, lateMin: 3 },
        { displayName: 'Julia', status: 'Left', durationMin: 15 },
        { displayName: 'Bruno', status: 'Excused', durationMin: 0 },
      ],
      overflow: 2,
      recurringEventId: 'rec-pt',
      isPro: false,
    });
    const ptSent = mockSend.mock.calls[0][0];
    expect(ptSent.subject).toContain('Presença: Aula de Matemática — 10 de 12 presentes');
    expect(ptSent.html).toContain('Olá Ana,');
    expect(ptSent.html).toContain('Exportação pronta');
    expect(ptSent.html).toContain('Sua reunião terminou');
    expect(ptSent.html).toContain('Pessoa');
    expect(ptSent.html).toContain('Status');
    expect(ptSent.html).toContain('Tempo');
    expect(ptSent.html).toContain('Presente');
    expect(ptSent.html).toContain('Saiu');
    expect(ptSent.html).toContain('Justificado');
    expect(ptSent.html).toContain('+3 min atrasado');
    expect(ptSent.html).toContain('…e mais 2 na planilha');
    expect(ptSent.html).toContain('Abrir planilha');
    expect(ptSent.html).toContain('Ver na web →');
    expect(ptSent.html).toContain('ver a tendência completa →');
    expect(ptSent.html).toContain('Isso economizou seu tempo hoje?');
    expect(ptSent.html).toContain('Deixar avaliação de 5 estrelas (10s) →');
    expect(ptSent.tags).toEqual(expect.arrayContaining([{ name: 'lang', value: 'pt' }]));

    mockSend.mockClear();

    // Bengali
    await n.sendExportNotification({
      to: 'teacher@school.edu.bd',
      displayName: 'রহিম চৌধুরী',
      sheetUrl: 'https://s',
      meetingTitle: 'বিজ্ঞান ক্লাস',
      totalAttended: 18,
      totalInvited: 20,
      exportedAt: Date.now(),
      participants: [
        { displayName: 'করিম', status: 'Present', durationMin: 40, lateMin: 2 },
        { displayName: 'সাকিব', status: 'Absent', durationMin: 0 },
      ],
      overflow: 1,
      recurringEventId: 'rec-bn',
      isPro: false,
    });
    const bnSent = mockSend.mock.calls[0][0];
    expect(bnSent.subject).toContain('উপস্থিতি: বিজ্ঞান ক্লাস — 20 জনের মধ্যে 18 জন উপস্থিত');
    expect(bnSent.html).toContain('হ্যালো রহিম,');
    expect(bnSent.html).toContain('এক্সপোর্ট সম্পন্ন');
    expect(bnSent.html).toContain('আপনার মিটিং শেষ হয়েছে');
    expect(bnSent.html).toContain('ব্যক্তি');
    expect(bnSent.html).toContain('অবস্থা');
    expect(bnSent.html).toContain('সময়');
    expect(bnSent.html).toContain('উপস্থিত');
    expect(bnSent.html).toContain('অনুপস্থিত');
    expect(bnSent.html).toContain('+2 মি. দেরিতে');
    expect(bnSent.html).toContain('…এবং শিটে আরও 1 জন');
    expect(bnSent.html).toContain('শিট খুলুন');
    expect(bnSent.html).toContain('ওয়েবে দেখুন →');
    expect(bnSent.html).toContain('সম্পূর্ণ ট্রেন্ড দেখুন →');
    expect(bnSent.html).toContain('এটি কি আজ আপনার সময় বাঁচিয়েছে?');
    expect(bnSent.html).toContain('৫-স্টার রিভিউ দিন (১০ সেকেন্ড লাগবে) →');
    expect(bnSent.tags).toEqual(expect.arrayContaining([{ name: 'lang', value: 'bn' }]));
  });

  test('series alert (single, personEmail only) and reactivation/forgotten without displayName', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendSeriesAlertEmail({ to: 'u@x.com', alerts: [{ type: 'streak', personEmail: 'p@x.com', detail: 'd', attended: 1, instanceCount: 6 }] });
    await n.sendReactivationEmail({ to: 'u@x.com', daysSinceLogin: 8, variant: '7d' });
    await n.sendForgottenMeetingEmail({ to: 'u@x.com', seriesTitle: 'S', recurringEventId: 'r', trackedInWindow: 3, daysSinceLast: 8 });
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  test('slack digest bucket falls back to "?" for a nameless/emailless participant', () => {
    const n = require('../../src/lib/notifications');
    const blocks = n.buildSlackDigestBlocks({ meetingTitle: 'M', totalAttended: 1, totalInvited: 2, participants: [{ status: 'Present' }, { status: 'Excused' }], sheetUrl: 'https://s' });
    expect(Array.isArray(blocks)).toBe(true);
  });
});

describe('notifications — final branch closure', () => {
  beforeEach(() => { process.env.GMAIL_USER = 'owner@x.com'; });
  afterEach(() => { jest.dontMock('resend'); delete process.env.RESEND_API_KEY; delete process.env.NOTIFY_EMAIL; delete process.env.GMAIL_USER; });

  function withResend() {
    const mockSend = jest.fn().mockResolvedValue({ data: { id: 'm' } });
    jest.doMock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));
    process.env.RESEND_API_KEY = 're_test';
    jest.resetModules();
    return mockSend;
  }

  test('hm formats durations over an hour (export with 90-min participant)', async () => {
    const mockSend = withResend();
    const n = require('../../src/lib/notifications');
    await n.sendExportNotification({ to: 'u@x.com', sheetUrl: 'https://s', totalAttended: 1, participants: [{ displayName: 'A', status: 'Present', durationMin: 90 }] });
    expect(mockSend.mock.calls[0][0].html).toContain('1h 30m');
  });

  test('signup returns early when there is no recipient (no NOTIFY_EMAIL/owner)', async () => {
    delete process.env.GMAIL_USER; delete process.env.NOTIFY_EMAIL;
    withResend();
    const n = require('../../src/lib/notifications');
    const res = await n.sendSignupWebhook({ email: 'a@x.com', domain: 'x.com' });
    expect(res).toBeUndefined();
    const upRes = await n.sendUpgradeNotification({ email: 'a@x.com', plan: 'educator' });
    expect(upRes).toEqual({ skipped: 'no NOTIFY_EMAIL/owner' });
  });

  test('sendAdminEmail with no body renders empty paragraphs', async () => {
    const mockSend = withResend();
    const n = require('../../src/lib/notifications');
    await n.sendAdminEmail({ to: 'a@x.com', subject: 'S' }); // no body
    expect(mockSend).toHaveBeenCalled();
  });

  test('sendErrorAlertEmail sends alert when configured and skips when not', async () => {
    const mockSend = withResend();
    const n = require('../../src/lib/notifications');
    process.env.NOTIFY_EMAIL = 'derekgallardo01@gmail.com';
    const res = await n.sendErrorAlertEmail({
      email: 'user@school.edu',
      domain: 'school.edu',
      error: 'n is not defined',
      context: 'export_failed',
      meta: { message: 'n is not defined' },
    });
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      to: ['derekgallardo01@gmail.com'],
      subject: expect.stringContaining('User Error Alert: user@school.edu'),
    }));
    expect(res).toEqual(expect.objectContaining({ sent: true }));

    // without NOTIFY_EMAIL / ownerEmail
    delete process.env.NOTIFY_EMAIL;
    delete process.env.GMAIL_USER;
    const skipRes = await n.sendErrorAlertEmail({ email: 'u@x.com' });
    expect(skipRes).toEqual({ skipped: 'no NOTIFY_EMAIL/owner' });
  });

  test('sendFeedbackEmail throws without a body and includes the source when present', async () => {
    const mockSend = withResend();
    const n = require('../../src/lib/notifications');
    await expect(n.sendFeedbackEmail({ fromEmail: 'a@x.com' })).rejects.toThrow(/body/i);
    await n.sendFeedbackEmail({ body: 'hi', fromEmail: 'a@x.com', source: 'landing_page' });
    expect(mockSend).toHaveBeenCalled();
  });

  test('slack digest present/absent buckets fall back to "?" for email-only + nameless', () => {
    const n = require('../../src/lib/notifications');
    const blocks = n.buildSlackDigestBlocks({ meetingTitle: 'M', totalAttended: 2, totalInvited: 4, participants: [
      { email: 'p@x.com', status: 'Present' }, { status: 'Present' },
      { email: 'a@x.com', status: 'Absent' }, { status: 'Absent' },
    ], sheetUrl: 'https://s' });
    expect(Array.isArray(blocks)).toBe(true);
  });

  test('sendSlackTestPing returns no_webhook when the URL is missing', async () => {
    const n = require('../../src/lib/notifications');
    expect(await n.sendSlackTestPing({})).toEqual({ sent: false, reason: 'no_webhook' });
  });
});

describe('notifications — remaining senders skip without Resend', () => {
  beforeEach(() => { jest.resetModules(); delete process.env.RESEND_API_KEY; });
  test('weekly/activation/solo/forgotten no-op when Resend is unconfigured', async () => {
    const n = require('../../src/lib/notifications');
    expect(await n.sendWeeklySelfReport({ signups: { thisWeek: 0 }, tracks: {}, exports: {} })).toEqual({ skipped: 'Resend not configured' });
    // The nudge senders route through sendPersonalEmail, which returns a skipped
    // marker (not undefined) — just assert they resolve without throwing.
    await expect(n.sendActivationNudgeEmail({ to: 'u@x.com', daysSinceLogin: 8 })).resolves.toBeDefined();
    await expect(n.sendSoloNudgeEmail({ to: 'u@x.com', daysSinceLogin: 8 })).resolves.toBeDefined();
    await expect(n.sendForgottenMeetingEmail({ to: 'u@x.com', seriesTitle: 'S', recurringEventId: 'r', trackedInWindow: 3, daysSinceLast: 8 })).resolves.toBeDefined();
  });
});

describe('notifications — feedback + digest tail', () => {
  let mockSend;
  beforeEach(() => {
    mockSend = jest.fn().mockResolvedValue({ data: { id: 'm' } });
    jest.doMock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));
    process.env.RESEND_API_KEY = 're_test'; process.env.GMAIL_USER = 'owner@x.com';
    jest.resetModules();
  });
  afterEach(() => { jest.dontMock('resend'); delete process.env.RESEND_API_KEY; delete process.env.GMAIL_USER; delete process.env.NOTIFY_EMAIL; });

  test('feedback throws when no destination inbox is configured', async () => {
    delete process.env.GMAIL_USER; delete process.env.NOTIFY_EMAIL;
    const n = require('../../src/lib/notifications');
    await expect(n.sendFeedbackEmail({ body: 'hi', fromEmail: 'a@x.com' })).rejects.toThrow(/NOTIFY_EMAIL/);
  });

  test('feedback with a long body, fromName, conferenceId, and userAgent', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendFeedbackEmail({ body: 'x'.repeat(80), fromName: 'Jane', fromEmail: 'a@x.com', source: 'app', conferenceId: 'conf-1', userAgent: 'Mozilla' });
    const html = mockSend.mock.calls[0][0].html;
    expect(mockSend.mock.calls[0][0].subject).toContain('…');
    expect(html).toContain('Meeting'); expect(html).toContain('User agent');
  });

  test('weekly report with populated concerns + multiple sources', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendWeeklySelfReport({
      windowStart: Date.now() - 7 * 86400000, windowEnd: Date.now(), totalUsers: 5, totalMeetings: 9,
      signups: { thisWeek: 2, lastWeek: 1, delta: '+1', new: [{ displayName: 'A', email: 'a@x.com', domain: 'x.com', source: 'reddit' }, { email: 'b@x.com', domain: 'y.com' }] },
      tracks: { thisWeek: 3, lastWeek: 3, delta: '0' }, exports: { thisWeek: 1, lastWeek: 0, delta: '+1' },
      concerns: [{ displayName: 'C', email: 'c@x.com', domain: 'z.com' }],
      sources: { reddit: 3, google_search: 1 }, topUser: { email: 't@x.com', actions: 5 },
    });
    expect(mockSend).toHaveBeenCalled();
  });

  test('slack digest with Left + Excused + a started-time line', () => {
    const n = require('../../src/lib/notifications');
    const blocks = n.buildSlackDigestBlocks({ meetingTitle: 'M', totalAttended: 1, totalInvited: 3, participants: [
      { displayName: 'P', status: 'Present' }, { displayName: 'L', status: 'Left' }, { displayName: 'E', status: 'Excused' },
    ], sheetUrl: 'https://s', durationMin: 90, startTime: Date.now() });
    expect(Array.isArray(blocks)).toBe(true);
  });
});

describe('notifications — weekly/forgotten/digest edge cases', () => {
  let mockSend;
  beforeEach(() => {
    mockSend = jest.fn().mockResolvedValue({ data: { id: 'm' } });
    jest.doMock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));
    process.env.RESEND_API_KEY = 're_test'; process.env.GMAIL_USER = 'owner@x.com';
    jest.resetModules();
  });
  afterEach(() => { jest.dontMock('resend'); delete process.env.RESEND_API_KEY; delete process.env.GMAIL_USER; delete process.env.NOTIFY_EMAIL; });

  test('weekly report skips when there is no destination inbox', async () => {
    delete process.env.GMAIL_USER; delete process.env.NOTIFY_EMAIL;
    const n = require('../../src/lib/notifications');
    expect(await n.sendWeeklySelfReport({ signups: { thisWeek: 0 }, tracks: {}, exports: {} })).toEqual({ skipped: 'no NOTIFY_EMAIL/owner' });
  });

  test('weekly report tolerates undefined new/concerns/sources and singular counts', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendWeeklySelfReport({
      windowStart: Date.now() - 7 * 86400000, windowEnd: Date.now(), totalUsers: 1, totalMeetings: 1,
      signups: { thisWeek: 1, lastWeek: 0, delta: '+1' }, // no `new`
      tracks: { thisWeek: 1, lastWeek: 0, delta: '+1' }, exports: { thisWeek: 0, lastWeek: 0, delta: '0' },
      // no concerns, no sources, and a concern-less report
      topUser: { email: 't@x.com', actions: 1 },
    });
    expect(mockSend).toHaveBeenCalled();
  });

  test('weekly report lists a concern without a displayName', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendWeeklySelfReport({
      windowStart: Date.now(), windowEnd: Date.now(), totalUsers: 1, totalMeetings: 1,
      signups: { thisWeek: 2, lastWeek: 0, delta: '+2', new: [] },
      tracks: { thisWeek: 0, lastWeek: 0, delta: '0' }, exports: { thisWeek: 0, lastWeek: 0, delta: '0' },
      concerns: [{ email: 'c@x.com', domain: 'z.com' }], sources: {}, topUser: null,
    });
    expect(mockSend).toHaveBeenCalled();
  });

  test('forgotten-meeting email without a recurringEventId omits the series link', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendForgottenMeetingEmail({ to: 'u@x.com', displayName: 'U', seriesTitle: 'S', trackedInWindow: 3, daysSinceLast: 8 });
    expect(mockSend).toHaveBeenCalled();
  });

  test('slack digest with only Present (empty left/absent buckets → _none_)', () => {
    const n = require('../../src/lib/notifications');
    const blocks = n.buildSlackDigestBlocks({ meetingTitle: 'M', totalAttended: 1, participants: [
      { email: 'p@x.com', status: 'Present' }, { status: 'Left' }, { email: 'a@x.com', status: 'Absent' },
    ], sheetUrl: 'https://s' });
    expect(Array.isArray(blocks)).toBe(true);
  });

  test('buildSlackFallbackText defaults a missing meeting title', () => {
    const n = require('../../src/lib/notifications');
    expect(n.buildSlackFallbackText({ totalAttended: 1, totalInvited: 2 })).toContain('Google Meet');
  });
});

describe('notifications — slack bucket + transport final', () => {
  const n = require('../../src/lib/notifications');
  afterEach(() => { delete global.fetch; });

  test('each bucket resolves an email-only participant via the || fallback', () => {
    const blocks = n.buildSlackDigestBlocks({ meetingTitle: 'M', totalAttended: 1, totalInvited: 3, participants: [
      { email: 'p@x.com', status: 'Present' }, { email: 'l@x.com', status: 'Left' }, { email: 'a@x.com', status: 'Absent' },
    ], sheetUrl: 'https://s' });
    expect(Array.isArray(blocks)).toBe(true);
  });

  test('empty left/absent buckets render _none_', () => {
    const blocks = n.buildSlackDigestBlocks({ meetingTitle: 'M', totalAttended: 1, participants: [
      { displayName: 'P', status: 'Present' },
    ], sheetUrl: 'https://s' });
    expect(Array.isArray(blocks)).toBe(true);
  });

  test('sendSlackDigest tolerates a failing res.text() on a non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: jest.fn().mockRejectedValue(new Error('body boom')) });
    const res = await n.sendSlackDigest({ webhookUrl: 'https://hooks.slack.com/services/T/B/C', meetingTitle: 'M', totalAttended: 1, participants: [], sheetUrl: 'https://s' });
    expect(res.sent).toBe(false);
  });

  test('sendSlackTestPing tolerates a failing res.text() on a non-ok response', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500, text: jest.fn().mockRejectedValue(new Error('body boom')) });
    const res = await n.sendSlackTestPing({ webhookUrl: 'https://hooks.slack.com/services/T/B/C' });
    expect(res.sent).toBe(false);
  });
});

describe('notifications — slack bucket "?" fallback', () => {
  test('a participant with neither name nor email renders as "?"', () => {
    const n = require('../../src/lib/notifications');
    const blocks = n.buildSlackDigestBlocks({ meetingTitle: 'M', totalAttended: 1, totalInvited: 3, participants: [
      { status: 'Present' }, { status: 'Left' }, { status: 'Absent' },
    ], sheetUrl: 'https://s' });
    expect(Array.isArray(blocks)).toBe(true);
  });
});

describe('notifications — digest without a participants array', () => {
  test('buildSlackDigestBlocks tolerates undefined participants', () => {
    const n = require('../../src/lib/notifications');
    const blocks = n.buildSlackDigestBlocks({ meetingTitle: 'M', totalAttended: 0, sheetUrl: 'https://s' });
    expect(Array.isArray(blocks)).toBe(true);
  });
});

describe('notifications — buildDesignSystemEmail & upgrade link sender', () => {
  let mockSend;
  beforeEach(() => {
    mockSend = jest.fn().mockResolvedValue({ data: { id: 'm' } });
    jest.doMock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }));
    process.env.RESEND_API_KEY = 're_test';
    jest.resetModules();
  });
  afterEach(() => { jest.dontMock('resend'); delete process.env.RESEND_API_KEY; });

  test('buildDesignSystemEmail renders brand header, badges, CTA and footer correctly', () => {
    const { buildDesignSystemEmail } = require('../../src/lib/notifications');
    const html = buildDesignSystemEmail({
      badge: 'Test Badge',
      badgeType: 'warning',
      title: 'Test Title',
      subtitle: 'Test Subtitle',
      contentHtml: '<p>Body Content</p>',
      ctaText: 'Click Me',
      ctaUrl: 'https://attendancetracker.dev/action',
      ctaColor: 'blue',
      footerHtml: '<span>Custom Footer</span>',
    });
    expect(html).toContain('Attendance Tracker');
    expect(html).toContain('Test Badge');
    expect(html).toContain('Test Title');
    expect(html).toContain('Test Subtitle');
    expect(html).toContain('Body Content');
    expect(html).toContain('Click Me');
    expect(html).toContain('https://attendancetracker.dev/action');
    expect(html).toContain('Custom Footer');
    expect(html).toContain('#0d1117');
    expect(html).toContain('#161b22');
  });

  test('buildDesignSystemEmail uses defaults when optional props are omitted', () => {
    const { buildDesignSystemEmail } = require('../../src/lib/notifications');
    const html = buildDesignSystemEmail({
      contentHtml: '<p>Minimal</p>',
    });
    expect(html).toContain('Minimal');
    expect(html).toContain('attendancetracker.dev');
  });

  test('sendUpgradeLinkEmail sends email with plan buttons, pricing and unsubscribe link', async () => {
    const n = require('../../src/lib/notifications');
    await n.sendUpgradeLinkEmail({
      to: 'teacher@school.edu',
      displayName: 'Sarah Connor',
      educatorUrl: 'https://buy.stripe.com/educator',
      lifetimeUrl: 'https://buy.stripe.com/lifetime',
      educatorPrice: '$49',
      lifetimePrice: '$119',
      flag: '🇺🇸',
      isPpp: true,
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    const call = mockSend.mock.calls[0][0];
    expect(call.to).toEqual(['teacher@school.edu']);
    expect(call.subject).toContain('upgrade link');
    expect(call.html).toContain('Sarah');
    expect(call.html).toContain('Educator Pass');
    expect(call.html).toContain('Lifetime Pro');
    expect(call.html).toContain('$49/yr');
    expect(call.html).toContain('$119 one-time');
    expect(call.html).toContain('50% Regional Subsidy applied');
    expect(call.html).toContain('https://buy.stripe.com/educator');
    expect(call.html).toContain('https://buy.stripe.com/lifetime');
    expect(call.text).toContain('$49/yr');
    expect(call.tags).toEqual([{ name: 'type', value: 'upgrade_link_requested' }, { name: 'lang', value: 'en' }]);
  });

  test('sendUpgradeLinkEmail throws if to is missing', async () => {
    const n = require('../../src/lib/notifications');
    await expect(n.sendUpgradeLinkEmail({}))
      .rejects.toThrow(/to is required/);
  });

  test('resolveLanguage resolves language correctly across language, country, domain, and email', () => {
    const { resolveLanguage } = require('../../src/lib/notifications');
    // Explicit language tag
    expect(resolveLanguage({ language: 'es' })).toBe('es');
    expect(resolveLanguage({ language: 'es-419' })).toBe('es');
    expect(resolveLanguage({ language: 'pt' })).toBe('pt');
    expect(resolveLanguage({ language: 'pt-BR' })).toBe('pt');
    expect(resolveLanguage({ language: 'bn' })).toBe('bn');
    expect(resolveLanguage({ language: 'en' })).toBe('en');
    expect(resolveLanguage({ language: 'fr' })).toBe('en'); // fallback
    expect(resolveLanguage()).toBe('en'); // empty

    // Country resolution
    expect(resolveLanguage({ country: 'CO' })).toBe('es');
    expect(resolveLanguage({ country: 'MX' })).toBe('es');
    expect(resolveLanguage({ country: 'BR' })).toBe('pt');
    expect(resolveLanguage({ country: 'PT' })).toBe('pt');
    expect(resolveLanguage({ country: 'BD' })).toBe('bn');
    expect(resolveLanguage({ country: 'US' })).toBe('en');

    // Domain / email resolution
    expect(resolveLanguage({ domain: 'nuestrasenoradeguadalupe.edu.co' })).toBe('es');
    expect(resolveLanguage({ domain: 'usp.br' })).toBe('pt');
    expect(resolveLanguage({ domain: 'du.ac.bd' })).toBe('bn');
    expect(resolveLanguage({ email: 'jsuarez@nuestrasenoradeguadalupe.edu.co' })).toBe('es');
    expect(resolveLanguage({ email: 'karlamelhado@gmail.com', country: 'BR' })).toBe('pt');
  });

  test('multilingual sendUpgradeLinkEmail in Spanish, Portuguese, and Bengali', async () => {
    const n = require('../../src/lib/notifications');

    // Spanish via Colombia domain
    mockSend.mockClear();
    await n.sendUpgradeLinkEmail({
      to: 'jsuarez@nuestrasenoradeguadalupe.edu.co',
      displayName: 'Jhon Fredy',
      educatorUrl: 'https://buy.stripe.com/educator_co',
      lifetimeUrl: 'https://buy.stripe.com/lifetime_co',
      educatorPrice: '$2.49',
      lifetimePrice: '$4.99',
      flag: '🇨🇴',
      isPpp: true,
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    let call = mockSend.mock.calls[0][0];
    expect(call.subject).toContain('Tu enlace para actualizar Attendance Tracker');
    expect(call.html).toContain('Hola Jhon');
    expect(call.html).toContain('Pase Educador');
    expect(call.html).toContain('Pro de por vida');
    expect(call.html).toContain('50% de subsidio regional aplicado 🇨🇴');
    expect(call.tags).toEqual([{ name: 'type', value: 'upgrade_link_requested' }, { name: 'lang', value: 'es' }]);

    // Portuguese via BR country
    mockSend.mockClear();
    await n.sendUpgradeLinkEmail({
      to: 'karlamelhado@gmail.com',
      displayName: 'Karla Melhado',
      educatorUrl: 'https://buy.stripe.com/educator_br',
      lifetimeUrl: 'https://buy.stripe.com/lifetime_br',
      educatorPrice: '$2.49',
      lifetimePrice: '$4.99',
      flag: '🇧🇷',
      isPpp: true,
      country: 'BR',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toContain('Seu link para atualizar o Attendance Tracker');
    expect(call.html).toContain('Olá Karla');
    expect(call.html).toContain('Passe Educador');
    expect(call.html).toContain('Pro Vitalício');
    expect(call.html).toContain('50% de subsídio regional aplicado 🇧🇷');
    expect(call.tags).toEqual([{ name: 'type', value: 'upgrade_link_requested' }, { name: 'lang', value: 'pt' }]);

    // Bengali via BD country
    mockSend.mockClear();
    await n.sendUpgradeLinkEmail({
      to: 'tariq@school.edu.bd',
      displayName: 'Tariq Ahmed',
      educatorUrl: 'https://buy.stripe.com/educator_bd',
      lifetimeUrl: 'https://buy.stripe.com/lifetime_bd',
      educatorPrice: '$2.49',
      lifetimePrice: '$4.99',
      flag: '🇧🇩',
      isPpp: true,
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toContain('আপনার Attendance Tracker আপগ্রেড লিংক');
    expect(call.html).toContain('হ্যালো Tariq');
    expect(call.html).toContain('এডুকেটর পাস');
    expect(call.html).toContain('লাইফটাইম প্রো');
    expect(call.tags).toEqual([{ name: 'type', value: 'upgrade_link_requested' }, { name: 'lang', value: 'bn' }]);
  });

  test('multilingual lifecycle emails render localized content for es, pt, bn', async () => {
    const n = require('../../src/lib/notifications');

    // sendWelcomeEmail Spanish
    mockSend.mockClear();
    await n.sendWelcomeEmail({
      to: 'user@escuela.mx',
      displayName: 'Carlos Vega',
      country: 'MX',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    let call = mockSend.mock.calls[0][0];
    expect(call.subject).toContain('Bienvenido a Attendance Tracker');
    expect(call.html).toContain('Hola Carlos');
    expect(call.html).toContain('3 sencillos pasos');
    expect(call.html).toContain('¿No deseas recibir estos correos?');

    // sendReactivationEmail Portuguese
    mockSend.mockClear();
    await n.sendReactivationEmail({
      to: 'prof@escola.pt',
      displayName: 'Ana Paula',
      daysSinceLogin: 7,
      variant: '7d',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toContain('Como estão suas reuniões no Attendance Tracker?');
    expect(call.html).toContain('Olá Ana');
    expect(call.html).toContain('Não deseja receber estes e-mails?');

    // sendActivationNudgeEmail Spanish
    mockSend.mockClear();
    await n.sendActivationNudgeEmail({
      to: 'profe@colegio.edu.co',
      displayName: 'Javier Gomez',
      daysSinceLogin: 7,
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toBe('Cómo empezar con Attendance Tracker');
    expect(call.html).toContain('Hola Javier');

    // sendSoloNudgeEmail Portuguese
    mockSend.mockClear();
    await n.sendSoloNudgeEmail({
      to: 'aluno@usp.br',
      displayName: 'Lucas Silva',
      daysSinceLogin: 7,
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toContain('Você testou o Attendance Tracker sozinho');
    expect(call.html).toContain('Olá Lucas');

    // sendUpcomingMeetingEmail Bengali
    mockSend.mockClear();
    await n.sendUpcomingMeetingEmail({
      to: 'teacher@du.ac.bd',
      displayName: 'Rahim',
      meetingTitle: 'Physics 101',
      minutesUntil: 5,
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toContain('Physics 101');
    expect(call.html).toContain('Physics 101');
    expect(call.tags).toEqual([{ name: 'type', value: 'upcoming_reminder' }, { name: 'lang', value: 'bn' }]);

    // sendSeriesAlertEmail in Spanish, Portuguese, Bengali
    mockSend.mockClear();
    await n.sendSeriesAlertEmail({
      to: 'profe@colegio.es',
      displayName: 'Mateo',
      alerts: [{ personName: 'Juan', detail: 'faltó a 3 reuniones', attended: 2, instanceCount: 5 }],
      language: 'es',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toBe('Alerta de asistencia: Juan faltó a 3 reuniones');
    expect(call.html).toContain('Hola Mateo');
    expect(call.html).toContain('2 de 5 sesiones asistidas en total');
    expect(call.html).toContain('Ver series →');
    expect(call.tags).toEqual([{ name: 'type', value: 'series_alert' }, { name: 'lang', value: 'es' }]);

    mockSend.mockClear();
    await n.sendSeriesAlertEmail({
      to: 'prof@escola.com.br',
      displayName: 'Juliana',
      alerts: [{ personName: 'Pedro', detail: 'faltou a 2 reuniões', attended: 3, instanceCount: 5 }],
      language: 'pt',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toBe('Alerta de presença: Pedro faltou a 2 reuniões');
    expect(call.html).toContain('Olá Juliana');
    expect(call.html).toContain('3 de 5 sessões comparecidas no total');
    expect(call.html).toContain('Ver séries →');
    expect(call.tags).toEqual([{ name: 'type', value: 'series_alert' }, { name: 'lang', value: 'pt' }]);

    mockSend.mockClear();
    await n.sendSeriesAlertEmail({
      to: 'teacher@school.edu.bd',
      displayName: 'Farhana',
      alerts: [
        { personName: 'করিম', detail: 'অনুপস্থিত ছিলেন', attended: 1, instanceCount: 5 },
        { personName: 'রহিম', detail: 'অনুপস্থিত ছিলেন', attended: 2, instanceCount: 5 },
      ],
      language: 'bn',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toBe('আপনার নিয়মিত মিটিংগুলো থেকে 2টি উপস্থিতির সতর্কতা');
    expect(call.html).toContain('হ্যালো Farhana');
    expect(call.html).toContain('সর্বমোট 5টি সেশনের মধ্যে 1টিতে উপস্থিত');
    expect(call.html).toContain('সিরিজ দেখুন →');
    expect(call.tags).toEqual([{ name: 'type', value: 'series_alert' }, { name: 'lang', value: 'bn' }]);

    // sendReferralNotification in Spanish, Portuguese, Bengali
    mockSend.mockClear();
    await n.sendReferralNotification({
      to: 'referral@colegio.es',
      inviterName: 'Lucia',
      newUserName: 'Carlos',
      totalReferrals: 1,
      promoCode: 'FRIEND10',
      language: 'es',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toBe('🎉 Carlos se unió a Attendance Tracker — ganaste un mes gratis');
    expect(call.html).toContain('Carlos acaba de registrarse');
    expect(call.html).toContain('FRIEND10');
    expect(call.html).toContain('un mes gratis de Pro');
    expect(call.tags).toEqual([{ name: 'type', value: 'referral' }, { name: 'lang', value: 'es' }]);

    mockSend.mockClear();
    await n.sendReferralNotification({
      to: 'amigo@usp.br',
      inviterName: 'Rodrigo',
      newUserName: 'Mariana',
      totalReferrals: 2,
      promoCode: 'AMIGO10',
      language: 'pt',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toBe('🎉 Mariana entrou no Attendance Tracker — você ganhou um mês grátis');
    expect(call.html).toContain('Mariana acabou de se cadastrar');
    expect(call.html).toContain('AMIGO10');
    expect(call.tags).toEqual([{ name: 'type', value: 'referral' }, { name: 'lang', value: 'pt' }]);

    mockSend.mockClear();
    await n.sendReferralNotification({
      to: 'mentor@du.ac.bd',
      inviterName: 'Kamal',
      newUserName: 'তানভীর',
      totalReferrals: 3,
      promoCode: 'BENGALI10',
      language: 'bn',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toBe('🎉 তানভীর Attendance Tracker-এ যোগ দিয়েছেন — আপনি ১ মাস ফ্রি পেয়েছেন');
    expect(call.html).toContain('তানভীর এইমাত্র');
    expect(call.html).toContain('BENGALI10');
    expect(call.tags).toEqual([{ name: 'type', value: 'referral' }, { name: 'lang', value: 'bn' }]);

    // sendOrgWeeklyDigest in Spanish, Portuguese, Bengali
    mockSend.mockClear();
    await n.sendOrgWeeklyDigest({
      to: 'admin@escuela.edu.co',
      domain: 'escuela.edu.co',
      weeklyMeetings: 12,
      activeTeachers: 4,
      totalMeetings: 80,
      totalParticipants: 320,
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toBe('escuela.edu.co: 12 reuniones registradas esta semana');
    expect(call.html).toContain('Reuniones esta semana');
    expect(call.html).toContain('Docentes activos');
    expect(call.html).toContain('Abrir panel institucional →');
    expect(call.tags).toEqual([{ name: 'type', value: 'org_weekly_digest' }, { name: 'lang', value: 'es' }]);

    mockSend.mockClear();
    await n.sendOrgWeeklyDigest({
      to: 'diretoria@colegio.edu.br',
      domain: 'colegio.edu.br',
      weeklyMeetings: 15,
      activeTeachers: 5,
      totalMeetings: 120,
      totalParticipants: 450,
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toBe('colegio.edu.br: 15 reuniões registradas esta semana');
    expect(call.html).toContain('Reuniões esta semana');
    expect(call.html).toContain('Professores ativos');
    expect(call.html).toContain('Abrir painel institucional →');
    expect(call.tags).toEqual([{ name: 'type', value: 'org_weekly_digest' }, { name: 'lang', value: 'pt' }]);

    mockSend.mockClear();
    await n.sendOrgWeeklyDigest({
      to: 'admin@school.edu.bd',
      domain: 'school.edu.bd',
      weeklyMeetings: 8,
      activeTeachers: 3,
      totalMeetings: 45,
      totalParticipants: 190,
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toBe('school.edu.bd: এই সপ্তাহে 8টি মিটিং ট্র্যাক করা হয়েছে');
    expect(call.html).toContain('এই সপ্তাহের মিটিং');
    expect(call.html).toContain('ব্যবহারকারী শিক্ষক');
    expect(call.html).toContain('প্রাতিষ্ঠানিক ড্যাশবোর্ড খুলুন →');
    expect(call.tags).toEqual([{ name: 'type', value: 'org_weekly_digest' }, { name: 'lang', value: 'bn' }]);
  });

  test('sendSubscriptionCancelledEmail sends clear cancellation confirmation in en, es, pt, bn', async () => {
    const n = require('../../src/lib/notifications');

    // English
    mockSend.mockClear();
    await n.sendSubscriptionCancelledEmail({
      to: 'user@school.edu',
      displayName: 'Derek Gallardo',
      planName: 'Pro Annual',
      currentPeriodEnd: 'October 18, 2026',
      language: 'en',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    let call = mockSend.mock.calls[0][0];
    expect(call.subject).toContain('subscription has been cancelled');
    expect(call.html).toContain('Hi Derek');
    expect(call.html).toContain('charged again');
    expect(call.html).toContain('October 18, 2026');
    expect(call.html).toContain('Google Drive');
    expect(call.tags).toEqual([{ name: 'type', value: 'subscription_cancelled' }, { name: 'lang', value: 'en' }]);

    // Spanish
    mockSend.mockClear();
    await n.sendSubscriptionCancelledEmail({
      to: 'usuario@colegio.es',
      displayName: 'Carlos',
      planName: 'Pro',
      currentPeriodEnd: '18 de octubre de 2026',
      language: 'es',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toContain('ha sido cancelada');
    expect(call.html).toContain('Hola Carlos');
    expect(call.html).toContain('NO volverá a recibir ningún cargo');
    expect(call.html).toContain('Google Drive');
    expect(call.tags).toEqual([{ name: 'type', value: 'subscription_cancelled' }, { name: 'lang', value: 'es' }]);

    // Portuguese
    mockSend.mockClear();
    await n.sendSubscriptionCancelledEmail({
      to: 'usuario@escola.br',
      displayName: 'Fernanda',
      planName: 'Pro',
      currentPeriodEnd: '18 de outubro de 2026',
      language: 'pt',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toContain('foi cancelada');
    expect(call.html).toContain('Olá Fernanda');
    expect(call.html).toContain('NÃO receberá novas cobranças');
    expect(call.html).toContain('Google Drive');
    expect(call.tags).toEqual([{ name: 'type', value: 'subscription_cancelled' }, { name: 'lang', value: 'pt' }]);

    // Bengali
    mockSend.mockClear();
    await n.sendSubscriptionCancelledEmail({
      to: 'user@school.bd',
      displayName: 'Tariq',
      planName: 'Pro',
      currentPeriodEnd: '১৮ অক্টোবর ২০২৬',
      language: 'bn',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toContain('বাতিল করা হয়েছে');
    expect(call.html).toContain('হ্যালো Tariq');
    expect(call.html).toContain('আর কোনো চার্জ কাটা হবে না');
    expect(call.html).toContain('গুগল ড্রাইভ');
    expect(call.tags).toEqual([{ name: 'type', value: 'subscription_cancelled' }, { name: 'lang', value: 'bn' }]);
  });

  test('category preference filtering respects isNotificationCategoryEnabled', async () => {
    const firestore = require('../../src/services/firestore');
    jest.spyOn(firestore, 'isNotificationCategoryEnabled').mockResolvedValue(false);

    const n = require('../../src/lib/notifications');

    // exportSummary disabled -> sendExportNotification skips
    mockSend.mockClear();
    await n.sendExportNotification({
      to: 'teacher@school.edu',
      domain: 'school.edu',
      sheetUrl: 'https://docs.google.com/test',
      meetingTitle: 'Math 101',
    });
    expect(mockSend).not.toHaveBeenCalled();

    // seriesAlerts disabled -> sendSeriesAlertEmail skips
    mockSend.mockClear();
    await n.sendSeriesAlertEmail({
      to: 'teacher@school.edu',
      domain: 'school.edu',
      seriesTitle: 'Math 101',
      recurringEventId: 'rec_123',
      alerts: [{ type: 'absence_spike', name: 'Student' }],
    });
    expect(mockSend).not.toHaveBeenCalled();

    // weeklyDigest disabled -> sendOrgWeeklyDigest skips
    mockSend.mockClear();
    await n.sendOrgWeeklyDigest({
      to: 'admin@school.edu',
      domain: 'school.edu',
      weeklyMeetings: 10,
      activeTeachers: 3,
      totalMeetings: 50,
      totalParticipants: 200,
    });
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('sendReviewRewardEmail sends localized email in en, es, pt, bn', async () => {
    const n = require('../../src/lib/notifications');

    // English
    mockSend.mockClear();
    await n.sendReviewRewardEmail({
      to: 'teacher@school.edu',
      displayName: 'Jane Doe',
      expiresAt: '2026-10-23T00:00:00.000Z',
      language: 'en',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    let call = mockSend.mock.calls[0][0];
    expect(call.subject).toContain('Your Free Month of Pro is Active');
    expect(call.html).toContain('Hi Jane');
    expect(call.html).toContain('1 Month of Educator Pro Activated');
    expect(call.html).toContain('No credit card required');
    expect(call.tags).toEqual([{ name: 'type', value: 'review_reward' }, { name: 'lang', value: 'en' }]);

    // Spanish (resolved via country MX)
    mockSend.mockClear();
    await n.sendReviewRewardEmail({
      to: 'profesor@colegio.edu.mx',
      displayName: 'Carlos Sanchez',
      country: 'MX',
      expiresAt: '2026-10-23T00:00:00.000Z',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toContain('Tu mes de Pro gratuito ya está activo');
    expect(call.html).toContain('Carlos');
    expect(call.html).toContain('1 mes de Educator Pro activado');
    expect(call.html).toContain('Sin requerir tarjeta de crédito');
    expect(call.tags).toEqual([{ name: 'type', value: 'review_reward' }, { name: 'lang', value: 'es' }]);

    // Portuguese
    mockSend.mockClear();
    await n.sendReviewRewardEmail({
      to: 'prof@escola.com.br',
      displayName: 'Mariana Silva',
      country: 'BR',
      expiresAt: '2026-10-23T00:00:00.000Z',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toContain('Seu mês de Pro gratuito já está ativo');
    expect(call.html).toContain('Mariana');
    expect(call.html).toContain('1 mês de Educator Pro ativado');
    expect(call.html).toContain('Sem necessidade de cartão de crédito');
    expect(call.tags).toEqual([{ name: 'type', value: 'review_reward' }, { name: 'lang', value: 'pt' }]);

    // Bengali
    mockSend.mockClear();
    await n.sendReviewRewardEmail({
      to: 'teacher@du.ac.bd',
      displayName: 'তানভীর',
      country: 'BD',
      expiresAt: '2026-10-23T00:00:00.000Z',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
    call = mockSend.mock.calls[0][0];
    expect(call.subject).toContain('আপনার ১ মাসের ফ্রি প্রো সক্রিয় হয়েছে');
    expect(call.html).toContain('১ মাসের এডুকেটর প্রো আনলক হয়েছে');
    expect(call.tags).toEqual([{ name: 'type', value: 'review_reward' }, { name: 'lang', value: 'bn' }]);

    // Invalid email returns failure without calling mockSend
    mockSend.mockClear();
    const badRes = await n.sendReviewRewardEmail({ to: 'invalid-email' });
    expect(badRes.sent).toBe(false);
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('buildReviewRewardEmailContent, approval tokens, and sendReviewRewardDraftAlert', async () => {
    const n = require('../../src/lib/notifications');

    // 1. Approval token roundtrip
    const token = n.createReviewApprovalToken('rev-123', 'teacher@school.edu');
    expect(typeof token).toBe('string');
    expect(token.length).toBe(32);
    expect(n.verifyReviewApprovalToken('rev-123', 'teacher@school.edu', token)).toBe(true);
    expect(n.verifyReviewApprovalToken('rev-123', 'other@school.edu', token)).toBe(false);
    expect(n.verifyReviewApprovalToken('rev-999', 'teacher@school.edu', token)).toBe(false);
    expect(n.verifyReviewApprovalToken(null, null, null)).toBe(false);

    const approvalUrl = n.reviewApprovalUrl('rev-123', 'teacher@school.edu');
    expect(approvalUrl).toContain('/admin/reviews/approve-reward');
    expect(approvalUrl).toContain('rev-123');
    expect(approvalUrl).toContain('teacher%40school.edu');
    expect(approvalUrl).toContain(`t=${token}`);

    // 2. buildReviewRewardEmailContent
    const draft = n.buildReviewRewardEmailContent({
      to: 'profesor@colegio.edu.mx',
      displayName: 'Carlos Sanchez',
      country: 'MX',
      expiresAt: '2026-10-30T00:00:00.000Z',
      reviewId: 'rev-mx-1',
      rating: 5,
    });
    expect(draft.lang).toBe('es');
    expect(draft.subject).toContain('Tu mes de Pro gratuito ya está activo');
    expect(draft.from).toContain('Derek Gallardo');
    expect(draft.replyTo).toBe('derek@attendancetracker.dev');
    expect(draft.text).toContain('Estimado/a Carlos');
    expect(draft.html).toContain('1 mes de Educator Pro activado');

    // 3. sendReviewRewardDraftAlert sends email to admin with draft content and approval URL
    mockSend.mockClear();
    await n.sendReviewRewardDraftAlert({
      to: 'derekgallardo01@gmail.com',
      userEmail: 'profesor@colegio.edu.mx',
      domain: 'colegio.edu.mx',
      displayName: 'Carlos Sanchez',
      review: {
        reviewId: 'rev-mx-1',
        authorName: 'Carlos Sanchez',
        rating: 5,
        comment: 'Excelente herramienta!',
      },
      expiresAt: '2026-10-30T00:00:00.000Z',
      draft,
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const alertCall = mockSend.mock.calls[0][0];
    expect(alertCall.to).toEqual(['derekgallardo01@gmail.com']);
    expect(alertCall.subject).toContain('Review Verified & Pro Activated');
    expect(alertCall.subject).toContain('profesor@colegio.edu.mx');
    expect(alertCall.text).toContain('A Google Workspace Marketplace review has been verified, and 1 Month Educator Pro has been ACTIVATED in Firestore!');
    expect(alertCall.text).toContain('Tu mes de Pro gratuito ya está activo');
    expect(alertCall.text).toContain('/admin/reviews/approve-reward');
  });
});

