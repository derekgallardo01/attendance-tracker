// Tests for the notifications module — Resend wiring, From-address resolution,
// HTML escaping, and the no-op behavior when RESEND_API_KEY is unset.

describe('notifications — module structure', () => {
  test('exports all expected send functions', () => {
    const n = require('../../src/lib/notifications');
    expect(typeof n.sendSignupWebhook).toBe('function');
    expect(typeof n.sendAdminEmail).toBe('function');
    expect(typeof n.sendWeeklySelfReport).toBe('function');
    expect(typeof n.sendExportNotification).toBe('function');
    expect(typeof n.sendSeriesAlertEmail).toBe('function');
    expect(typeof n.sendFeedbackEmail).toBe('function');
    expect(typeof n.sendReactivationEmail).toBe('function');
    expect(typeof n.sendForgottenMeetingEmail).toBe('function');
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
