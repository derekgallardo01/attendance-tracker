// Google Chat + Discord digest builders and senders — sibling of
// slack-digest.test.js (which covers the shared bucketing via the Slack
// builder in detail; here we pin each provider's payload shape).
const {
  buildChatDigestCard, sendChatDigest, sendChatTestPing,
  buildDiscordDigestEmbed, sendDiscordDigest, sendDiscordTestPing,
} = require('../../src/lib/notifications');
const { CHAT_WEBHOOK_PREFIX } = require('../../src/lib/googleChat');
const { DISCORD_WEBHOOK_PREFIXES } = require('../../src/lib/discord');

const CHAT_URL = `${CHAT_WEBHOOK_PREFIX}AAAA/messages?key=k123&token=t456789`;
const DISCORD_URL = `${DISCORD_WEBHOOK_PREFIXES[0]}123456789/${'X'.repeat(30)}`;

const BASE = {
  meetingTitle: 'Weekly Sync',
  totalAttended: 2,
  totalInvited: 3,
  participants: [
    { displayName: 'Alice', status: 'Present' },
    { displayName: 'Bob', status: 'Left' },
    { displayName: 'Carol', status: 'Excused' },
  ],
  sheetUrl: 'https://docs.google.com/spreadsheets/d/abc',
  durationMin: 65,
  startTime: '2026-09-07T16:00:00Z',
};

describe('buildChatDigestCard', () => {
  test('builds a cardsV2 payload with header, buckets, and sheet button', () => {
    const payload = buildChatDigestCard(BASE);
    expect(payload.text).toContain('Weekly Sync');
    expect(payload.text).toContain('2 of 3 attended');
    const card = payload.cardsV2[0].card;
    expect(card.header.title).toBe('📊 Weekly Sync');
    expect(card.header.subtitle).toContain('2 of 3 attended');
    expect(card.header.subtitle).toContain('1h 5m');
    const widgets = card.sections[0].widgets;
    expect(widgets[0].textParagraph.text).toContain('Present (1)');
    expect(widgets[0].textParagraph.text).toContain('Alice');
    expect(widgets[1].textParagraph.text).toContain('Left early (1)');
    expect(widgets[2].textParagraph.text).toContain('Carol (excused)');
    expect(widgets[3].buttonList.buttons[0].onClick.openLink.url).toBe(BASE.sheetUrl);
  });

  test('escapes HTML in participant names', () => {
    const payload = buildChatDigestCard({
      ...BASE,
      participants: [{ displayName: '<img src=x>', status: 'Present' }],
    });
    const text = payload.cardsV2[0].card.sections[0].widgets[0].textParagraph.text;
    expect(text).not.toContain('<img');
    expect(text).toContain('&lt;img');
  });

  test('omits the button and empty buckets, defaults the title', () => {
    const payload = buildChatDigestCard({
      meetingTitle: '', totalAttended: 1, totalInvited: 0,
      participants: [{ displayName: 'Solo', status: 'Present' }],
      sheetUrl: null, durationMin: 0, startTime: null,
    });
    const card = payload.cardsV2[0].card;
    expect(card.header.title).toBe('📊 Google Meet');
    expect(card.header.subtitle).toBe('1 attended');
    expect(card.sections[0].widgets).toHaveLength(1);
  });
});

describe('buildDiscordDigestEmbed', () => {
  test('builds an embed with title link, description, and bucket fields', () => {
    const payload = buildDiscordDigestEmbed(BASE);
    const embed = payload.embeds[0];
    expect(embed.title).toBe('📊 Weekly Sync');
    expect(embed.url).toBe(BASE.sheetUrl);
    expect(embed.description).toContain('**2 of 3 attended**');
    expect(embed.description).toContain('1h 5m');
    expect(embed.fields).toHaveLength(3);
    expect(embed.fields[0].name).toBe('✅ Present (1)');
    expect(embed.fields[0].value).toBe('Alice');
    expect(embed.fields[2].value).toBe('Carol (excused)');
  });

  test('caps buckets at 8 names with an overflow marker', () => {
    const participants = Array.from({ length: 12 }, (_, i) => ({ displayName: `P${i}`, status: 'Present' }));
    const embed = buildDiscordDigestEmbed({ ...BASE, participants }).embeds[0];
    expect(embed.fields[0].name).toBe('✅ Present (12)');
    expect(embed.fields[0].value).toContain('+4 more');
  });

  test('omits url and fields when there is nothing to show', () => {
    const embed = buildDiscordDigestEmbed({
      meetingTitle: null, totalAttended: 0, totalInvited: 0,
      participants: [], sheetUrl: null, durationMin: null, startTime: null,
    }).embeds[0];
    expect(embed.title).toBe('📊 Google Meet');
    expect(embed.url).toBeUndefined();
    expect(embed.fields).toBeUndefined();
  });
});

describe('senders', () => {
  beforeEach(() => { global.fetch = jest.fn(); });
  afterEach(() => { delete global.fetch; });

  test.each([
    ['sendChatDigest', sendChatDigest],
    ['sendDiscordDigest', sendDiscordDigest],
  ])('%s returns no_webhook without a URL and never calls fetch', async (_name, fn) => {
    expect(await fn({ ...BASE, webhookUrl: null })).toEqual({ sent: false, reason: 'no_webhook' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('sendChatDigest POSTs the card payload to the webhook', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    const result = await sendChatDigest({ ...BASE, webhookUrl: CHAT_URL });
    expect(result).toEqual({ sent: true });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe(CHAT_URL);
    expect(JSON.parse(opts.body).cardsV2).toBeDefined();
  });

  test('sendDiscordDigest POSTs the embed payload to the webhook', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => '' });
    const result = await sendDiscordDigest({ ...BASE, webhookUrl: DISCORD_URL });
    expect(result).toEqual({ sent: true });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe(DISCORD_URL);
    expect(JSON.parse(opts.body).embeds).toHaveLength(1);
  });

  test('non-OK responses surface the status without throwing', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404, text: async () => 'no such webhook' });
    expect(await sendChatDigest({ ...BASE, webhookUrl: CHAT_URL })).toEqual({ sent: false, status: 404 });
    expect(await sendDiscordDigest({ ...BASE, webhookUrl: DISCORD_URL })).toEqual({ sent: false, status: 404 });
  });

  test('network errors surface as { sent: false, error } without throwing', async () => {
    global.fetch.mockRejectedValue(new Error('boom'));
    expect(await sendChatDigest({ ...BASE, webhookUrl: CHAT_URL })).toEqual({ sent: false, error: 'boom' });
    expect(await sendDiscordDigest({ ...BASE, webhookUrl: DISCORD_URL })).toEqual({ sent: false, error: 'boom' });
  });

  test('sendChatTestPing posts the connected text', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    expect(await sendChatTestPing({ webhookUrl: CHAT_URL })).toEqual({ sent: true });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.text).toContain('Attendance Tracker is connected');
  });

  test('sendDiscordTestPing posts the connected text as content', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 204, text: async () => '' });
    expect(await sendDiscordTestPing({ webhookUrl: DISCORD_URL })).toEqual({ sent: true });
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.content).toContain('Attendance Tracker is connected');
    expect(body.text).toBeUndefined();
  });

  test('test pings surface failures without throwing', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401, text: async () => 'invalid token' });
    expect(await sendChatTestPing({ webhookUrl: CHAT_URL })).toEqual({ sent: false, status: 401, response: 'invalid token' });
    expect(await sendDiscordTestPing({ webhookUrl: null })).toEqual({ sent: false, reason: 'no_webhook' });
  });
});
