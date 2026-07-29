/**
 * @jest-environment jsdom
 *
 * Tests for the pure share-page helpers in js/share.js (extracted from
 * share.html's inline script). Loaded from the root js/ dir (the canonical
 * source), NOT the backend/public/ mirror.
 */

const path = require('path');
const share = require(path.join(__dirname, '..', '..', '..', 'js', 'share.js'));

describe('fmtDate', () => {
  test('formats an ISO date to a short human date', () => {
    // Use a fixed date; assert the pieces rather than an exact locale string.
    const out = share.fmtDate('2026-03-15T00:00:00Z');
    expect(out).toMatch(/2026/);
    expect(out).not.toBe('—');
  });

  test('returns an em-dash for a missing date', () => {
    expect(share.fmtDate('')).toBe('—');
    expect(share.fmtDate(null)).toBe('—');
    expect(share.fmtDate(undefined)).toBe('—');
  });
});

describe('pct', () => {
  test('rounds a 0..1 rate to a whole-percent string', () => {
    expect(share.pct(0.833)).toBe('83%');
    expect(share.pct(1)).toBe('100%');
    expect(share.pct(0)).toBe('0%');
  });
});

describe('computeRange', () => {
  test('two distinct dates → a dash-joined range', () => {
    const r = share.computeRange('2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z');
    expect(r).toMatch(/–/); // en-dash between the two dates
    expect(r).toMatch(/2026/);
  });

  test('identical first/last → a single date (no range)', () => {
    const r = share.computeRange('2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z');
    expect(r).not.toMatch(/–/);
    expect(r).toMatch(/2026/);
  });

  test('only one endpoint present → that single date', () => {
    expect(share.computeRange('2026-03-01T00:00:00Z', null)).toMatch(/2026/);
    expect(share.computeRange(null, '2026-04-01T00:00:00Z')).toMatch(/2026/);
  });

  test('neither endpoint → em-dash', () => {
    expect(share.computeRange(null, null)).toBe('—');
  });
});

describe('renderPeopleRows', () => {
  const esc = (s) => String(s).replace(/</g, '&lt;'); // stand-in escaper

  test('renders a row per person with attended/total and a percent', () => {
    const html = share.renderPeopleRows(
      [{ displayName: 'Alex', attended: 5, attendanceRate: 0.5 }],
      10,
      esc,
    );
    expect(html).toContain('Alex');
    expect(html).toContain('5/10');
    expect(html).toContain('50%');
    expect(html).toContain('width:50%'); // progress bar width
  });

  test('escapes the display name via the injected escaper (no XSS)', () => {
    const html = share.renderPeopleRows(
      [{ displayName: '<script>', attended: 1, attendanceRate: 1 }],
      1,
      esc,
    );
    expect(html).toContain('&lt;script>');
    expect(html).not.toContain('<script>');
  });

  test('empty or missing list → a single "no participants" row', () => {
    expect(share.renderPeopleRows([], 5, esc)).toContain('No participants tracked.');
    expect(share.renderPeopleRows(undefined, 5, esc)).toContain('No participants tracked.');
  });
});
