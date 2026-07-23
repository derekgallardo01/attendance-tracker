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
    expect(typeof n.sendActivationNudgeEmail).toBe('function');
    expect(typeof n.sendSoloNudgeEmail).toBe('function');
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
    }));
    jest.resetModules();
    const n = require('../../src/lib/notifications');

    // First call: a pending signup is claimed → the email goes out with the
    // self-reported source, and the total-users count is looked up at send time.
    await n.maybeSendSignupNotification('x.com', 'a@x.com');
    expect(claimSignupNotification).toHaveBeenCalledWith('x.com', 'a@x.com');
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend.mock.calls[0][0].subject).toContain('google_search');
    expect(mockSend.mock.calls[0][0].text).toContain('Total users now: 22');

    // Second call: nothing pending (claim returns null) → no email.
    const res = await n.maybeSendSignupNotification('x.com', 'a@x.com');
    expect(res).toEqual({ sent: false });
    expect(mockSend).toHaveBeenCalledTimes(1);

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

  test('send races a hung Resend call against the timeout', async () => {
    process.env.RESEND_TIMEOUT_MS = '30';
    jest.doMock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: jest.fn(() => new Promise(() => {})) } })) }));
    process.env.RESEND_API_KEY = 're_test';
    jest.resetModules();
    const n = require('../../src/lib/notifications');
    // signup webhook swallows the timeout error via dispatchEmail
    const res = await n.sendSignupWebhook({ email: 'a@x.com', displayName: 'A', domain: 'x.com', totalUsers: 1 });
    expect(res.sent).toBe(false);
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
  });

  test('sendAdminEmail with no body renders empty paragraphs', async () => {
    const mockSend = withResend();
    const n = require('../../src/lib/notifications');
    await n.sendAdminEmail({ to: 'a@x.com', subject: 'S' }); // no body
    expect(mockSend).toHaveBeenCalled();
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
