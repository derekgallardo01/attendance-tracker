// Tests for the Slack digest helpers in notifications.js.
// Block Kit shape, fallback text, fire-and-forget failure mode, masking.

const notifications = require('../../src/lib/notifications');

describe('maskSlackWebhook', () => {
  test('masks a valid webhook to a short, debug-safe form', () => {
    const masked = notifications.maskSlackWebhook(
      'https://hooks.slack.com/services/T01ABC/B02DEF/superSecretToken1234'
    );
    expect(masked).toContain('hooks.slack.com');
    expect(masked).toContain('1234');
    expect(masked).not.toContain('superSecret');
  });

  test('returns "(none)" for missing webhook', () => {
    expect(notifications.maskSlackWebhook(null)).toBe('(none)');
    expect(notifications.maskSlackWebhook('')).toBe('(none)');
  });

  test('returns "(invalid)" for non-Slack URL', () => {
    expect(notifications.maskSlackWebhook('https://evil.com/foo')).toBe('(invalid)');
  });
});

describe('buildSlackDigestBlocks', () => {
  test('includes header with meeting title', () => {
    const blocks = notifications.buildSlackDigestBlocks({
      meetingTitle: 'Sprint Planning',
      totalAttended: 5, totalInvited: 7,
      participants: [], sheetUrl: 'https://docs.google.com/x',
      durationMin: 45,
    });
    expect(blocks[0].type).toBe('header');
    expect(blocks[0].text.text).toContain('Sprint Planning');
  });

  test('summary line shows "X of Y attended"', () => {
    const blocks = notifications.buildSlackDigestBlocks({
      meetingTitle: 'X', totalAttended: 5, totalInvited: 7,
      participants: [], sheetUrl: '', durationMin: 30,
    });
    const summary = blocks[1].text.text;
    expect(summary).toContain('5 of 7 attended');
    expect(summary).toContain('30m');
  });

  test('summary uses "X attended" when totalInvited is missing', () => {
    const blocks = notifications.buildSlackDigestBlocks({
      meetingTitle: 'X', totalAttended: 5, totalInvited: 0,
      participants: [], sheetUrl: '', durationMin: 0,
    });
    expect(blocks[1].text.text).toContain('5 attended');
  });

  test('groups present / left / absent into separate fields', () => {
    const blocks = notifications.buildSlackDigestBlocks({
      meetingTitle: 'X', totalAttended: 2, totalInvited: 4,
      participants: [
        { displayName: 'Alex', status: 'Present', durationMin: 30 },
        { displayName: 'Beth', status: 'Present', durationMin: 30 },
        { displayName: 'Carlos', status: 'Left', durationMin: 10 },
        { displayName: 'Dana', status: 'Absent', durationMin: 0 },
      ],
      sheetUrl: 'https://x',
    });
    const fieldsBlock = blocks.find(b => b.fields);
    expect(fieldsBlock.fields).toHaveLength(3); // Present + Left + Absent
    const presentField = fieldsBlock.fields.find(f => f.text.includes('Present'));
    expect(presentField.text).toContain('Alex, Beth');
    const absentField = fieldsBlock.fields.find(f => f.text.includes('Absent'));
    expect(absentField.text).toContain('Dana');
  });

  test('caps each bucket at 8 names + "+N more" overflow', () => {
    const participants = Array.from({ length: 12 }, (_, i) => ({
      displayName: `Person${i + 1}`, status: 'Present', durationMin: 30,
    }));
    const blocks = notifications.buildSlackDigestBlocks({
      meetingTitle: 'Big Meeting', totalAttended: 12, totalInvited: 12,
      participants, sheetUrl: '',
    });
    const fieldsBlock = blocks.find(b => b.fields);
    const presentField = fieldsBlock.fields.find(f => f.text.includes('Present'));
    expect(presentField.text).toMatch(/\+4 more/);
  });

  test('appends Excused suffix to excused absentees', () => {
    const blocks = notifications.buildSlackDigestBlocks({
      meetingTitle: 'X', totalAttended: 0, totalInvited: 2,
      participants: [
        { displayName: 'Alex', status: 'Excused', durationMin: 0 },
        { displayName: 'Beth', status: 'Absent', durationMin: 0 },
      ],
      sheetUrl: '',
    });
    const fieldsBlock = blocks.find(b => b.fields);
    const absentField = fieldsBlock.fields[0];
    expect(absentField.text).toContain('Alex (excused)');
    expect(absentField.text).toContain('Beth');
    expect(absentField.text).not.toContain('Beth (excused)');
  });

  test('includes Open sheet button when sheetUrl present', () => {
    const blocks = notifications.buildSlackDigestBlocks({
      meetingTitle: 'X', totalAttended: 1, totalInvited: 1,
      participants: [{ displayName: 'A', status: 'Present', durationMin: 30 }],
      sheetUrl: 'https://docs.google.com/spreadsheets/xyz',
    });
    const actionsBlock = blocks.find(b => b.type === 'actions');
    expect(actionsBlock).toBeDefined();
    expect(actionsBlock.elements[0].url).toBe('https://docs.google.com/spreadsheets/xyz');
  });

  test('omits Open sheet button when sheetUrl is empty', () => {
    const blocks = notifications.buildSlackDigestBlocks({
      meetingTitle: 'X', totalAttended: 1, totalInvited: 1,
      participants: [{ displayName: 'A', status: 'Present', durationMin: 30 }],
      sheetUrl: '',
    });
    expect(blocks.find(b => b.type === 'actions')).toBeUndefined();
  });

  test('truncates very long meeting titles', () => {
    const longTitle = 'X'.repeat(300);
    const blocks = notifications.buildSlackDigestBlocks({
      meetingTitle: longTitle, totalAttended: 0, totalInvited: 0,
      participants: [], sheetUrl: '',
    });
    expect(blocks[0].text.text.length).toBeLessThanOrEqual(150);
  });
});

describe('buildSlackFallbackText', () => {
  test('produces a plain-text summary with sheet URL', () => {
    const text = notifications.buildSlackFallbackText({
      meetingTitle: 'Sprint Planning',
      totalAttended: 5, totalInvited: 7,
      sheetUrl: 'https://docs.google.com/x',
    });
    expect(text).toContain('Sprint Planning');
    expect(text).toContain('5 of 7 attended');
    expect(text).toContain('https://docs.google.com/x');
  });

  test('omits sheet URL line when not provided', () => {
    const text = notifications.buildSlackFallbackText({
      meetingTitle: 'X', totalAttended: 5, totalInvited: 7, sheetUrl: '',
    });
    expect(text).not.toContain('Open sheet:');
  });
});

describe('sendSlackDigest — fire-and-forget HTTP', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });
  afterEach(() => { delete global.fetch; });

  test('returns { sent: false, reason: no_webhook } when no URL', async () => {
    const result = await notifications.sendSlackDigest({ webhookUrl: '' });
    expect(result.sent).toBe(false);
    expect(result.reason).toBe('no_webhook');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('returns { sent: true } when Slack responds 200', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200 });
    const result = await notifications.sendSlackDigest({
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
      meetingTitle: 'X', totalAttended: 1, totalInvited: 1, participants: [], sheetUrl: '',
    });
    expect(result.sent).toBe(true);
  });

  test('returns { sent: false, status } when Slack rejects', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404, text: async () => 'invalid_token' });
    const result = await notifications.sendSlackDigest({
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
      meetingTitle: 'X', totalAttended: 1, totalInvited: 1, participants: [], sheetUrl: '',
    });
    expect(result.sent).toBe(false);
    expect(result.status).toBe(404);
  });

  test('returns { sent: false, error } when fetch throws (network)', async () => {
    global.fetch.mockRejectedValue(new Error('ENOTFOUND'));
    const result = await notifications.sendSlackDigest({
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
      meetingTitle: 'X', totalAttended: 1, totalInvited: 1, participants: [], sheetUrl: '',
    });
    expect(result.sent).toBe(false);
    expect(result.error).toBe('ENOTFOUND');
  });

  test('POSTs JSON body with both text fallback and blocks', async () => {
    global.fetch.mockResolvedValue({ ok: true });
    await notifications.sendSlackDigest({
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
      meetingTitle: 'Test', totalAttended: 1, totalInvited: 1,
      participants: [{ displayName: 'Alex', status: 'Present', durationMin: 5 }],
      sheetUrl: 'https://x',
    });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/services/T/B/x');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(opts.body);
    expect(body.text).toBeDefined();
    expect(body.blocks).toBeDefined();
    expect(Array.isArray(body.blocks)).toBe(true);
  });
});

describe('sendSlackTestPing', () => {
  beforeEach(() => { global.fetch = jest.fn(); });
  afterEach(() => { delete global.fetch; });

  test('posts a "connected" message and returns sent:true', async () => {
    global.fetch.mockResolvedValue({ ok: true });
    const result = await notifications.sendSlackTestPing({
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
    });
    expect(result.sent).toBe(true);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.text).toMatch(/connected/i);
  });

  test('returns sent:false when Slack rejects', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404, text: async () => 'invalid_token' });
    const result = await notifications.sendSlackTestPing({
      webhookUrl: 'https://hooks.slack.com/services/T/B/x',
    });
    expect(result.sent).toBe(false);
    expect(result.status).toBe(404);
  });
});
