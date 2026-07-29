/**
 * @jest-environment jsdom
 *
 * Tests for the pure team-dashboard helpers in js/team.js (extracted from
 * team.html's inline script). Loaded from the root js/ dir (canonical source).
 */

const path = require('path');
const team = require(path.join(__dirname, '..', '..', '..', 'js', 'team.js'));

describe('fmtDate', () => {
  test('formats an ISO date; em-dash when absent', () => {
    expect(team.fmtDate('2026-03-15T00:00:00Z')).toMatch(/2026/);
    expect(team.fmtDate(null)).toBe('—');
  });
});

describe('fmtDuration', () => {
  test('sub-hour, exact-hour, and hour+minute', () => {
    expect(team.fmtDuration(45 * 60000)).toBe('45m');
    expect(team.fmtDuration(60 * 60000)).toBe('1h');
    expect(team.fmtDuration(80 * 60000)).toBe('1h 20m');
  });
  test('em-dash for absent/non-positive', () => {
    expect(team.fmtDuration(0)).toBe('—');
    expect(team.fmtDuration(-5)).toBe('—');
    expect(team.fmtDuration(null)).toBe('—');
  });
});

describe('fmtMinutes', () => {
  test('sub-hour, exact-hour, and hour+minute', () => {
    expect(team.fmtMinutes(45)).toBe('45m');
    expect(team.fmtMinutes(120)).toBe('2h');
    expect(team.fmtMinutes(150)).toBe('2h 30m');
  });
  test('em-dash for falsy', () => {
    expect(team.fmtMinutes(0)).toBe('—');
    expect(team.fmtMinutes(null)).toBe('—');
  });
});

describe('pct', () => {
  test('rounds a 0..1 rate', () => {
    expect(team.pct(0.5)).toBe('50%');
    expect(team.pct(0.833)).toBe('83%');
  });
});

describe('computeRange', () => {
  test('distinct dates → range; identical/one/none → single or dash', () => {
    expect(team.computeRange('2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z')).toMatch(/–/);
    expect(team.computeRange('2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z')).not.toMatch(/–/);
    expect(team.computeRange('2026-03-01T00:00:00Z', null)).toMatch(/2026/);
    expect(team.computeRange(null, null)).toBe('—');
  });
});

describe('filterUsers', () => {
  const users = [
    { displayName: 'Alex Kim', email: 'alex@acme.com' },
    { displayName: 'Beth Ray', email: 'beth@acme.com' },
    { email: 'noname@acme.com' },
  ];
  test('empty query returns all; matches name or email (case-insensitive)', () => {
    expect(team.filterUsers(users, '')).toHaveLength(3);
    expect(team.filterUsers(users, '  ')).toHaveLength(3); // whitespace normalises to empty
    expect(team.filterUsers(users, 'ALEX')).toEqual([users[0]]);
    expect(team.filterUsers(users, 'beth@')).toEqual([users[1]]);
  });
  test('null list → []', () => {
    expect(team.filterUsers(null, 'x')).toEqual([]);
  });
});

describe('filterMeetings', () => {
  const meetings = [
    { title: 'Standup', presentNames: ['Alex', 'Beth'] },
    { title: 'Retro', presentNames: [] },
    { title: 'Planning', presentNames: [null, 'Carol'] }, // null name must not throw
  ];
  test('matches title or a present name', () => {
    expect(team.filterMeetings(meetings, '')).toHaveLength(3);
    expect(team.filterMeetings(meetings, 'stand')).toEqual([meetings[0]]);
    expect(team.filterMeetings(meetings, 'alex')).toEqual([meetings[0]]);
    expect(team.filterMeetings(meetings, 'carol')).toEqual([meetings[2]]);
  });
  test('null list → []', () => {
    expect(team.filterMeetings(null, 'x')).toEqual([]);
    expect(team.filterMeetings(null, '')).toEqual([]);
  });
  test('a meeting with no presentNames field does not throw under a query', () => {
    // Exercises the `(m.presentNames || [])` fallback: title miss + absent names.
    expect(team.filterMeetings([{ title: 'Orphan' }], 'zzz')).toEqual([]);
  });
});

describe('filterSeries', () => {
  const series = [{ title: 'Weekly Sync' }, { title: 'Daily Standup' }];
  test('empty query → all; else title match', () => {
    expect(team.filterSeries(series, '')).toBe(series); // returns the same array untouched
    expect(team.filterSeries(series, 'weekly')).toEqual([series[0]]);
    expect(team.filterSeries(null, '')).toEqual([]);
    expect(team.filterSeries(null, 'x')).toEqual([]); // null list with a query
  });
});

describe('filterPeople', () => {
  const people = [
    { displayName: 'Alex', email: 'alex@acme.com' },
    { email: 'noname@acme.com' },
  ];
  test('matches name or email', () => {
    expect(team.filterPeople(people, '')).toHaveLength(2);
    expect(team.filterPeople(people, 'alex')).toEqual([people[0]]);
    expect(team.filterPeople(people, 'noname')).toEqual([people[1]]);
  });
  test('null list → []', () => {
    expect(team.filterPeople(null, 'x')).toEqual([]);
  });
});
