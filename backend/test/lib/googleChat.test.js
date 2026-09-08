const { isValidGoogleChatWebhook, maskGoogleChatWebhook, CHAT_WEBHOOK_PREFIX } = require('../../src/lib/googleChat');

// Built from parts so a literal full webhook URL never appears in source
// (mirrors the secret-scanning-friendly pattern in slack.test.js).
const VALID = `${CHAT_WEBHOOK_PREFIX}AAAA1234/messages?key=${'K'.repeat(10)}&token=${'T'.repeat(20)}`;

describe('isValidGoogleChatWebhook', () => {
  test('accepts a canonical Chat incoming-webhook URL', () => {
    expect(isValidGoogleChatWebhook(VALID)).toBe(true);
  });

  test('rejects non-strings (the type-guard branch)', () => {
    expect(isValidGoogleChatWebhook(null)).toBe(false);
    expect(isValidGoogleChatWebhook(undefined)).toBe(false);
    expect(isValidGoogleChatWebhook(12345)).toBe(false);
    expect(isValidGoogleChatWebhook({})).toBe(false);
  });

  test('rejects over-long URLs', () => {
    expect(isValidGoogleChatWebhook(`${CHAT_WEBHOOK_PREFIX}A/messages?key=k&token=` + 't'.repeat(1000))).toBe(false);
  });

  test('rejects a URL on the wrong host, including lookalikes', () => {
    expect(isValidGoogleChatWebhook('https://evil.example.com/v1/spaces/A/messages?key=k&token=t')).toBe(false);
    expect(isValidGoogleChatWebhook('https://chat.googleapis.com.evil.com/v1/spaces/A/messages?key=k&token=t')).toBe(false);
  });

  test('rejects a malformed path', () => {
    expect(isValidGoogleChatWebhook(`${CHAT_WEBHOOK_PREFIX}A/B/messages?key=k&token=t`)).toBe(false);
    expect(isValidGoogleChatWebhook(`${CHAT_WEBHOOK_PREFIX}A/notmessages?key=k&token=t`)).toBe(false);
  });

  test('rejects missing or empty key/token params', () => {
    expect(isValidGoogleChatWebhook(`${CHAT_WEBHOOK_PREFIX}A/messages?key=k`)).toBe(false);
    expect(isValidGoogleChatWebhook(`${CHAT_WEBHOOK_PREFIX}A/messages?token=t`)).toBe(false);
    expect(isValidGoogleChatWebhook(`${CHAT_WEBHOOK_PREFIX}A/messages?key=&token=t`)).toBe(false);
    expect(isValidGoogleChatWebhook(`${CHAT_WEBHOOK_PREFIX}A/messages`)).toBe(false);
  });

  test('rejects over-long key/token params', () => {
    expect(isValidGoogleChatWebhook(`${CHAT_WEBHOOK_PREFIX}A/messages?key=${'k'.repeat(200)}&token=t`)).toBe(false);
    expect(isValidGoogleChatWebhook(`${CHAT_WEBHOOK_PREFIX}A/messages?key=k&token=${'t'.repeat(200)}`)).toBe(false);
  });
});

describe('maskGoogleChatWebhook', () => {
  test('returns (none) for a falsy URL', () => {
    expect(maskGoogleChatWebhook('')).toBe('(none)');
    expect(maskGoogleChatWebhook(null)).toBe('(none)');
  });

  test('returns (invalid) for a non-matching URL', () => {
    expect(maskGoogleChatWebhook('https://example.com/not-a-webhook')).toBe('(invalid)');
  });

  test('masks to host + last 4 of the token', () => {
    expect(maskGoogleChatWebhook(VALID)).toBe('chat.googleapis.com/...TTTT');
  });

  test('does not slice when the token is <= 4 chars', () => {
    expect(maskGoogleChatWebhook(`${CHAT_WEBHOOK_PREFIX}A/messages?key=k&token=ab`)).toBe('chat.googleapis.com/...ab');
  });
});
