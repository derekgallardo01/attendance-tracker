/**
 * @jest-environment jsdom
 *
 * Tests for the pure admin/CRM helpers in js/admin.js (extracted from
 * admin.html's inline script). Loaded from the root js/ dir (canonical source).
 */

const path = require('path');
const a = require(path.join(__dirname, '..', '..', '..', 'js', 'admin.js'));

describe('pct', () => {
  test('one-decimal percent; em-dash for null/undefined', () => {
    expect(a.pct(0.833)).toBe('83.3%');
    expect(a.pct(1)).toBe('100.0%');
    expect(a.pct(null)).toBe('—');
    expect(a.pct(undefined)).toBe('—');
  });
});

describe('fmtMs', () => {
  test('picks the largest sensible unit', () => {
    expect(a.fmtMs(null)).toBe('—');
    expect(a.fmtMs(5000)).toBe('5s');
    expect(a.fmtMs(90 * 1000)).toBe('2m');       // 90s → 1.5m → rounds to 2m
    expect(a.fmtMs(2 * 3600 * 1000)).toBe('2.0h');
    expect(a.fmtMs(3 * 86400 * 1000)).toBe('3.0d');
  });
});

describe('fmtDate / fmtDateTime', () => {
  test('formats when present, em-dash when absent', () => {
    expect(a.fmtDate('2026-03-15T00:00:00Z')).not.toBe('—');
    expect(a.fmtDate(null)).toBe('—');
    expect(a.fmtDateTime('2026-03-15T00:00:00Z')).not.toBe('—');
    expect(a.fmtDateTime(null)).toBe('—');
  });
});

describe('timeAgo (now injected for determinism)', () => {
  const now = Date.parse('2026-07-29T12:00:00Z');
  const ago = (ms) => new Date(now - ms).toISOString();
  test('buckets seconds / minutes / hours / days', () => {
    expect(a.timeAgo(null, now)).toBe('—');
    expect(a.timeAgo(ago(30 * 1000), now)).toBe('30s ago');
    expect(a.timeAgo(ago(5 * 60 * 1000), now)).toBe('5m ago');
    expect(a.timeAgo(ago(3 * 3600 * 1000), now)).toBe('3h ago');
    expect(a.timeAgo(ago(2 * 86400 * 1000), now)).toBe('2d ago');
  });
  test('defaults now to the current time when omitted', () => {
    expect(a.timeAgo(new Date(Date.now() - 30 * 1000).toISOString())).toMatch(/s ago$/);
  });
});

describe('ageDaysCalc (now injected)', () => {
  const now = Date.parse('2026-07-29T12:00:00Z');
  test('whole days since the date; "?" when absent', () => {
    expect(a.ageDaysCalc(null, now)).toBe('?');
    expect(a.ageDaysCalc(new Date(now - 3 * 86400000).toISOString(), now)).toBe('3');
    expect(a.ageDaysCalc(new Date(Date.now() - 86400000).toISOString())).toBe('1'); // default now
  });
});

describe('priorityBadge', () => {
  test('1 → HOT, 2 → TODAY, else THIS WEEK', () => {
    expect(a.priorityBadge(1)).toContain('HOT');
    expect(a.priorityBadge(2)).toContain('TODAY');
    expect(a.priorityBadge(3)).toContain('THIS WEEK');
    expect(a.priorityBadge(99)).toContain('THIS WEEK');
  });
});

describe('healthBadge', () => {
  test('colour bands at 70 / 40', () => {
    expect(a.healthBadge(85)).toContain('var(--accent)');
    expect(a.healthBadge(70)).toContain('var(--accent)');
    expect(a.healthBadge(55)).toContain('#fbbf24');
    expect(a.healthBadge(40)).toContain('#fbbf24');
    expect(a.healthBadge(10)).toContain('var(--error)');
    expect(a.healthBadge(30)).toContain('Health 30'); // score echoed
  });
});

describe('templateSubs / fillTemplate', () => {
  test('templateSubs derives firstName from displayName, else email local part', () => {
    expect(a.templateSubs({ displayName: 'Alex Kim', email: 'x@y.com' }).firstName).toBe('Alex');
    expect(a.templateSubs({ email: 'bob@corp.com' }).firstName).toBe('bob');
  });

  test('fillTemplate substitutes {{vars}} and blanks unknown/missing keys', () => {
    const subs = a.templateSubs({ displayName: 'Alex Kim', email: 'a@acme.com', tracked: 5, exported: 2, daysAgo: 7, domain: 'acme.com' });
    expect(a.fillTemplate('Hi {{firstName}}, you tracked {{tracked}} at {{domain}}', subs))
      .toBe('Hi Alex, you tracked 5 at acme.com');
    expect(a.fillTemplate('{{unknown}} tail', subs)).toBe(' tail'); // unknown key → ''
    expect(a.fillTemplate(null, subs)).toBe('');                    // null template → ''
    expect(a.fillTemplate('', subs)).toBe('');
  });

  test('fillTemplate blanks a key whose value is null', () => {
    expect(a.fillTemplate('x{{exported}}y', { exported: null })).toBe('xy');
  });
});
