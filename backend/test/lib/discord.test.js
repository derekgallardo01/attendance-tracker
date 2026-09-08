const { isValidDiscordWebhook, maskDiscordWebhook, DISCORD_WEBHOOK_PREFIXES } = require('../../src/lib/discord');

// Built from parts so a literal full webhook URL never appears in source
// (mirrors the secret-scanning-friendly pattern in slack.test.js).
const [PREFIX, LEGACY_PREFIX] = DISCORD_WEBHOOK_PREFIXES;
const VALID = `${PREFIX}123456789012345678/${'X'.repeat(60)}`;

describe('isValidDiscordWebhook', () => {
  test('accepts a canonical webhook URL', () => {
    expect(isValidDiscordWebhook(VALID)).toBe(true);
  });

  test('accepts the legacy discordapp.com domain', () => {
    expect(isValidDiscordWebhook(`${LEGACY_PREFIX}123456789012345678/tok`)).toBe(true);
  });

  test('rejects non-strings (the type-guard branch)', () => {
    expect(isValidDiscordWebhook(null)).toBe(false);
    expect(isValidDiscordWebhook(undefined)).toBe(false);
    expect(isValidDiscordWebhook(12345)).toBe(false);
  });

  test('rejects a URL on the wrong host, including lookalikes', () => {
    expect(isValidDiscordWebhook('https://evil.example.com/api/webhooks/1/t')).toBe(false);
    expect(isValidDiscordWebhook('https://discord.com.evil.com/api/webhooks/1/t')).toBe(false);
  });

  test('rejects the wrong number of path segments', () => {
    expect(isValidDiscordWebhook(`${PREFIX}12345`)).toBe(false);
    expect(isValidDiscordWebhook(`${PREFIX}12345/tok/extra`)).toBe(false);
  });

  test('rejects a non-numeric id', () => {
    expect(isValidDiscordWebhook(`${PREFIX}notanid/tok`)).toBe(false);
    expect(isValidDiscordWebhook(`${PREFIX}${'1'.repeat(31)}/tok`)).toBe(false);
  });

  test('rejects empty, over-long, or query-carrying tokens', () => {
    expect(isValidDiscordWebhook(`${PREFIX}12345/`)).toBe(false);
    expect(isValidDiscordWebhook(`${PREFIX}12345/${'x'.repeat(200)}`)).toBe(false);
    expect(isValidDiscordWebhook(`${PREFIX}12345/tok?wait=true`)).toBe(false);
  });
});

describe('maskDiscordWebhook', () => {
  test('returns (none) for a falsy URL', () => {
    expect(maskDiscordWebhook('')).toBe('(none)');
    expect(maskDiscordWebhook(null)).toBe('(none)');
  });

  test('returns (invalid) for a non-matching URL', () => {
    expect(maskDiscordWebhook('https://example.com/not-a-webhook')).toBe('(invalid)');
  });

  test('masks to host + last 4 of the token', () => {
    expect(maskDiscordWebhook(VALID)).toBe('discord.com/api/webhooks/...XXXX');
  });

  test('does not slice when the token is <= 4 chars', () => {
    expect(maskDiscordWebhook(`${PREFIX}12345/ab`)).toBe('discord.com/api/webhooks/...ab');
  });
});
