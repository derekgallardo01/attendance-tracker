const { isValidSlackWebhook, maskSlackWebhook, SLACK_WEBHOOK_PREFIX } = require('../../src/lib/slack');

// Built from parts so the literal full-URL never appears in source (GitHub
// secret-scanning flags any hooks.slack.com/services/… URL, even a fake one).
const VALID = `${SLACK_WEBHOOK_PREFIX}T00000000/B00000000/${'X'.repeat(24)}`;

describe('isValidSlackWebhook', () => {
  test('accepts a canonical incoming-webhook URL', () => {
    expect(isValidSlackWebhook(VALID)).toBe(true);
  });

  test('rejects non-strings (the type-guard branch)', () => {
    expect(isValidSlackWebhook(null)).toBe(false);
    expect(isValidSlackWebhook(undefined)).toBe(false);
    expect(isValidSlackWebhook(12345)).toBe(false);
    expect(isValidSlackWebhook({})).toBe(false);
  });

  test('rejects a URL on the wrong host', () => {
    expect(isValidSlackWebhook('https://evil.example.com/services/a/b/c')).toBe(false);
  });

  test('rejects the wrong number of path segments', () => {
    expect(isValidSlackWebhook(SLACK_WEBHOOK_PREFIX + 'only/two')).toBe(false);
    expect(isValidSlackWebhook(SLACK_WEBHOOK_PREFIX + 'a/b/c/d')).toBe(false);
  });

  test('rejects empty or over-long segments', () => {
    expect(isValidSlackWebhook(SLACK_WEBHOOK_PREFIX + 'a//c')).toBe(false);
    expect(isValidSlackWebhook(SLACK_WEBHOOK_PREFIX + 'a/b/' + 'x'.repeat(200))).toBe(false);
  });
});

describe('maskSlackWebhook', () => {
  test('returns (none) for a falsy URL', () => {
    expect(maskSlackWebhook('')).toBe('(none)');
    expect(maskSlackWebhook(null)).toBe('(none)');
  });

  test('returns (invalid) for a non-matching URL', () => {
    expect(maskSlackWebhook('https://example.com/not-a-webhook')).toBe('(invalid)');
  });

  test('masks to host + last 4 of the secret', () => {
    expect(maskSlackWebhook(VALID)).toBe('hooks.slack.com/...XXXX');
  });

  test('does not slice when the secret tail is <= 4 chars', () => {
    expect(maskSlackWebhook(SLACK_WEBHOOK_PREFIX + 'T0/B0/ab')).toBe('hooks.slack.com/...ab');
  });
});
