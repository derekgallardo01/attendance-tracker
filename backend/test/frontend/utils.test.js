/**
 * @jest-environment jsdom
 *
 * Tests for the pure frontend helpers in js/utils.js. Runs under jsdom so
 * `window`, `Date`, `navigator`, and other browser globals are available.
 * The module is imported via Node's require (utils.js exports both window
 * and module.exports).
 *
 * Loads the file from the root js/ directory, NOT from backend/public/js/,
 * so that updates to the canonical source are what get tested. (backend/
 * public/ is a synced copy.)
 */

const path = require('path');
const utils = require(path.join(__dirname, '..', '..', '..', 'js', 'utils.js'));

describe('escHtml', () => {
  test('escapes & < >', () => {
    expect(utils.escHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });

  test('coerces non-strings safely', () => {
    expect(utils.escHtml(null)).toBe('');
    expect(utils.escHtml(undefined)).toBe('');
    expect(utils.escHtml(42)).toBe('42');
  });

  test('escapes script tag attempts', () => {
    const xss = '<script>alert("xss")</script>';
    const escaped = utils.escHtml(xss);
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&lt;script&gt;');
  });

  test('escapes injected img onerror', () => {
    const xss = '<img src=x onerror=alert(1)>';
    expect(utils.escHtml(xss)).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('formatRelative', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-28T12:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  test('empty string for null', () => {
    expect(utils.formatRelative(null)).toBe('');
  });

  test('empty string for invalid date', () => {
    expect(utils.formatRelative('not-a-date')).toBe('');
  });

  test('"just now" for under a minute', () => {
    expect(utils.formatRelative(new Date('2026-06-28T11:59:30Z'))).toBe('just now');
  });

  test('minutes', () => {
    expect(utils.formatRelative(new Date('2026-06-28T11:55:00Z'))).toBe('5 minutes ago');
  });

  test('singular minute (1)', () => {
    expect(utils.formatRelative(new Date('2026-06-28T11:59:00Z'))).toBe('1 minute ago');
  });

  test('hours', () => {
    expect(utils.formatRelative(new Date('2026-06-28T09:00:00Z'))).toBe('3 hours ago');
  });

  test('singular hour', () => {
    expect(utils.formatRelative(new Date('2026-06-28T11:00:00Z'))).toBe('1 hour ago');
  });

  test('days', () => {
    expect(utils.formatRelative(new Date('2026-06-25T12:00:00Z'))).toBe('3 days ago');
  });

  test('singular day', () => {
    expect(utils.formatRelative(new Date('2026-06-27T12:00:00Z'))).toBe('1 day ago');
  });

  test('accepts ISO string input', () => {
    expect(utils.formatRelative('2026-06-28T11:55:00Z')).toBe('5 minutes ago');
  });

  test('returns "just now" (not negative) for future dates', () => {
    expect(utils.formatRelative(new Date('2026-06-28T12:05:00Z'))).toBe('just now');
  });
});

describe('fmtTime', () => {
  test('empty for null/undefined', () => {
    expect(utils.fmtTime(null)).toBe('');
    expect(utils.fmtTime(undefined)).toBe('');
  });

  test('empty for invalid date', () => {
    expect(utils.fmtTime(new Date('invalid'))).toBe('');
  });

  test('returns HH:MM-style string for valid Date', () => {
    const d = new Date('2026-06-28T15:30:00Z');
    const result = utils.fmtTime(d);
    // Format varies by locale; assert it contains a colon-separated time
    expect(result).toMatch(/\d{1,2}[:.][0-5]\d/);
  });
});

describe('fmtDur', () => {
  test('under an hour shows minutes', () => {
    const start = new Date('2026-01-01T10:00:00Z').getTime();
    const end = new Date('2026-01-01T10:45:00Z').getTime();
    expect(utils.fmtDur(start, end)).toBe('45m');
  });

  test('over an hour shows Xh Ym', () => {
    const start = new Date('2026-01-01T10:00:00Z').getTime();
    const end = new Date('2026-01-01T12:30:00Z').getTime();
    expect(utils.fmtDur(start, end)).toBe('2h 30m');
  });

  test('exactly one hour shows 1h 0m', () => {
    const start = new Date('2026-01-01T10:00:00Z').getTime();
    const end = new Date('2026-01-01T11:00:00Z').getTime();
    expect(utils.fmtDur(start, end)).toBe('1h 0m');
  });
});

describe('fmtDurMs', () => {
  test('"< 1m" for under a minute', () => {
    expect(utils.fmtDurMs(30_000)).toBe('< 1m');
  });

  test('minutes under an hour', () => {
    expect(utils.fmtDurMs(45 * 60_000)).toBe('45m');
  });

  test('hours + minutes', () => {
    expect(utils.fmtDurMs(150 * 60_000)).toBe('2h 30m');
  });
});

describe('latenessMin', () => {
  // The most important pure helper — its math drives the in-panel chip,
  // sheet column, and email badge. Off-by-one here is user-visible.

  test('returns 0 when no joinTime', () => {
    expect(utils.latenessMin(null, '2026-06-28T10:00:00Z', null)).toBe(0);
    expect(utils.latenessMin(undefined, '2026-06-28T10:00:00Z', null)).toBe(0);
  });

  test('returns 0 when no baseline known (instant meeting before tracking)', () => {
    expect(utils.latenessMin(new Date('2026-06-28T10:05:00Z'), null, null)).toBe(0);
  });

  test('returns 0 for joins within the 5-min grace period', () => {
    const base = new Date('2026-06-28T10:00:00Z').toISOString();
    expect(utils.latenessMin(new Date('2026-06-28T10:00:00Z'), base, null)).toBe(0);
    expect(utils.latenessMin(new Date('2026-06-28T10:03:00Z'), base, null)).toBe(0);
    expect(utils.latenessMin(new Date('2026-06-28T10:05:00Z'), base, null)).toBe(0); // exactly threshold
  });

  test('returns minute count for joins past threshold', () => {
    const base = new Date('2026-06-28T10:00:00Z').toISOString();
    expect(utils.latenessMin(new Date('2026-06-28T10:08:00Z'), base, null)).toBe(8);
    expect(utils.latenessMin(new Date('2026-06-28T10:15:00Z'), base, null)).toBe(15);
  });

  test('returns 0 for joins BEFORE baseline (early bird is not late)', () => {
    const base = new Date('2026-06-28T10:00:00Z').toISOString();
    expect(utils.latenessMin(new Date('2026-06-28T09:55:00Z'), base, null)).toBe(0);
  });

  test('prefers eventStart over conferenceStartTime when both known', () => {
    // Calendar event is at 10:00; Meet conference actually started at 9:55
    // (early bird joined and triggered the room). Someone joining at 10:08
    // is 8 min late by event time (correct) — NOT 13 min by conference time.
    const eventStart = new Date('2026-06-28T10:00:00Z').toISOString();
    const confStart = new Date('2026-06-28T09:55:00Z').toISOString();
    expect(utils.latenessMin(new Date('2026-06-28T10:08:00Z'), eventStart, confStart)).toBe(8);
  });

  test('falls back to conferenceStartTime when no eventStart', () => {
    const confStart = new Date('2026-06-28T10:00:00Z').toISOString();
    expect(utils.latenessMin(new Date('2026-06-28T10:10:00Z'), null, confStart)).toBe(10);
  });

  test('accepts Date OR ISO string for joinTime', () => {
    const base = new Date('2026-06-28T10:00:00Z').toISOString();
    const asDate = utils.latenessMin(new Date('2026-06-28T10:08:00Z'), base, null);
    const asIso = utils.latenessMin('2026-06-28T10:08:00Z', base, null);
    expect(asDate).toBe(asIso);
  });

  test('returns 0 for invalid joinTime (defensive)', () => {
    const base = new Date('2026-06-28T10:00:00Z').toISOString();
    expect(utils.latenessMin('not-a-date', base, null)).toBe(0);
  });
});

describe('avatarColor', () => {
  test('returns gray for missing name', () => {
    expect(utils.avatarColor(null)).toBe('#3d444d');
    expect(utils.avatarColor('')).toBe('#3d444d');
  });

  test('returns a color from the palette', () => {
    const color = utils.avatarColor('Alex');
    expect(utils.AVATAR_PALETTE).toContain(color);
  });

  test('same name always returns same color (deterministic)', () => {
    expect(utils.avatarColor('Alex')).toBe(utils.avatarColor('Alex'));
    expect(utils.avatarColor('Beth')).toBe(utils.avatarColor('Beth'));
  });

  test('different names usually return different colors (8-way palette)', () => {
    // Statistically — across 20 names we expect mostly different colors
    const names = ['Alex', 'Beth', 'Carlos', 'Dana', 'Erik', 'Fatima', 'Gao', 'Heather',
                   'Ian', 'Jess', 'Kim', 'Luis', 'Maya', 'Noah', 'Oscar', 'Priya'];
    const colors = new Set(names.map(n => utils.avatarColor(n)));
    expect(colors.size).toBeGreaterThan(3);
  });
});

describe('participantKey', () => {
  test('returns lowercased email when present', () => {
    expect(utils.participantKey({ email: 'Alex@ACME.COM', displayName: 'Alex' })).toBe('alex@acme.com');
  });

  test('falls back to name: prefix when no email', () => {
    expect(utils.participantKey({ displayName: 'Anonymous' })).toBe('name:Anonymous');
  });

  test('handles null participant defensively', () => {
    expect(utils.participantKey(null)).toBe('name:Unknown');
    expect(utils.participantKey(undefined)).toBe('name:Unknown');
  });

  test('handles empty participant object', () => {
    expect(utils.participantKey({})).toBe('name:Unknown');
  });
});

describe('isoFmt + datestamp', () => {
  test('isoFmt returns ISO string', () => {
    const d = new Date('2026-06-28T15:30:00Z');
    expect(utils.isoFmt(d)).toBe('2026-06-28T15:30:00.000Z');
  });

  test('datestamp returns filename-safe ISO slice', () => {
    const stamp = utils.datestamp();
    // No colons or T — filesystem safe
    expect(stamp).not.toContain(':');
    expect(stamp).not.toContain('T');
    expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/);
  });
});

describe('isValidSlackWebhook', () => {
  test('accepts a well-formed webhook URL', () => {
    expect(utils.isValidSlackWebhook('https://hooks.slack.com/services/T01ABC/B02DEF/secretToken123')).toBe(true);
  });

  test('rejects non-Slack URLs', () => {
    expect(utils.isValidSlackWebhook('https://evil.example.com/webhook')).toBe(false);
    expect(utils.isValidSlackWebhook('https://hooks.slack.com.evil.com/services/A/B/C')).toBe(false);
  });

  test('rejects http (not https)', () => {
    expect(utils.isValidSlackWebhook('http://hooks.slack.com/services/T/B/x')).toBe(false);
  });

  test('rejects URLs with missing path segments', () => {
    expect(utils.isValidSlackWebhook('https://hooks.slack.com/services/T01/B02')).toBe(false);
    expect(utils.isValidSlackWebhook('https://hooks.slack.com/services/T01/B02/')).toBe(false);
    expect(utils.isValidSlackWebhook('https://hooks.slack.com/services/')).toBe(false);
  });

  test('rejects null / undefined / non-string', () => {
    expect(utils.isValidSlackWebhook(null)).toBe(false);
    expect(utils.isValidSlackWebhook(undefined)).toBe(false);
    expect(utils.isValidSlackWebhook(123)).toBe(false);
    expect(utils.isValidSlackWebhook({})).toBe(false);
  });

  test('rejects extra path segments', () => {
    expect(utils.isValidSlackWebhook('https://hooks.slack.com/services/T/B/x/extra')).toBe(false);
  });
});

describe('maskWebhookUrl', () => {
  test('returns empty string for invalid input', () => {
    expect(utils.maskWebhookUrl('not a url')).toBe('');
    expect(utils.maskWebhookUrl(null)).toBe('');
    expect(utils.maskWebhookUrl('')).toBe('');
  });

  test('masks the team/bot/secret segments', () => {
    const masked = utils.maskWebhookUrl('https://hooks.slack.com/services/T01ABC/B02DEF/superSecretToken1234');
    expect(masked).toBe('https://hooks.slack.com/services/T0***/B0***/***1234');
  });

  test('shows enough to be recognizable but hides the secret', () => {
    const masked = utils.maskWebhookUrl('https://hooks.slack.com/services/T01ABC/B02DEF/abcdefghij');
    expect(masked).not.toContain('abcdefghij'); // full secret never appears
    expect(masked).toContain('T0***'); // first 2 chars of team prefix shown
    expect(masked).toContain('***ghij'); // last 4 of secret shown for recognizability
  });

  test('handles a short secret defensively', () => {
    const masked = utils.maskWebhookUrl('https://hooks.slack.com/services/T1/B1/abc');
    expect(masked).toContain('***abc');
  });
});

describe('module exposure', () => {
  test('exposes window.AttUtils when loaded in browser env', () => {
    // Re-import in jsdom env — utils.js IIFE sets window.AttUtils
    require(path.join(__dirname, '..', '..', '..', 'js', 'utils.js'));
    expect(typeof window).toBe('object');
    expect(window.AttUtils).toBeDefined();
    expect(typeof window.AttUtils.escHtml).toBe('function');
    expect(window.AttUtils.LATE_THRESHOLD_MIN).toBe(5);
  });

  test('exposes the same API on module.exports and window.AttUtils', () => {
    require(path.join(__dirname, '..', '..', '..', 'js', 'utils.js'));
    expect(utils.escHtml).toBe(window.AttUtils.escHtml);
    expect(utils.latenessMin).toBe(window.AttUtils.latenessMin);
  });
});
