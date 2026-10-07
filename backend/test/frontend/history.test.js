/**
 * @jest-environment jsdom
 *
 * Tests for the pure history-page helpers in js/history.js (extracted from
 * history.html's inline script). Loaded from the root js/ dir (canonical source).
 */

const path = require('path');
const h = require(path.join(__dirname, '..', '..', '..', 'js', 'history.js'));

describe('formatters', () => {
  test('fmtDate / fmtTime', () => {
    expect(h.fmtDate('2026-03-15T12:00:00Z')).toMatch(/2026/);
    expect(h.fmtDate(null)).toBe('—');
    expect(h.fmtTime(null)).toBe('');
    expect(h.fmtTime('2026-03-15T12:00:00Z')).toMatch(/\d/);
  });
  test('fmtDuration', () => {
    expect(h.fmtDuration(45 * 60000)).toBe('45m');
    expect(h.fmtDuration(60 * 60000)).toBe('1h');
    expect(h.fmtDuration(80 * 60000)).toBe('1h 20m');
    expect(h.fmtDuration(0)).toBe('—');
    expect(h.fmtDuration(-1)).toBe('—');
  });
  test('fmtMinutes', () => {
    expect(h.fmtMinutes(45)).toBe('45m');
    expect(h.fmtMinutes(120)).toBe('2h');
    expect(h.fmtMinutes(150)).toBe('2h 30m');
    expect(h.fmtMinutes(0)).toBe('—');
  });
  test('pct', () => {
    expect(h.pct(0.5)).toBe('50%');
    expect(h.pct(0.833)).toBe('83%');
  });
  test('computeRange', () => {
    expect(h.computeRange('2026-03-01T00:00:00Z', '2026-04-01T00:00:00Z')).toMatch(/–/);
    expect(h.computeRange('2026-03-01T00:00:00Z', '2026-03-01T00:00:00Z')).not.toMatch(/–/);
    expect(h.computeRange(null, '2026-04-01T00:00:00Z')).toMatch(/2026/);
    expect(h.computeRange(null, null)).toBe('—');
  });
});

describe('cssEscape', () => {
  test('backslash-escapes non-word characters so it is querySelector-safe', () => {
    expect(h.cssEscape('abc-123')).toBe('abc-123'); // word chars + hyphen untouched
    expect(h.cssEscape('a.b:c')).toBe('a\\.b\\:c');
    expect(h.cssEscape(42)).toBe('42'); // coerces non-strings
  });
});

describe('filters', () => {
  test('filterMeetings matches title or a present name; null-safe', () => {
    const meetings = [
      { title: 'Standup', presentNames: ['Alex'] },
      { title: 'Retro', presentNames: [] },
      { title: 'Orphan' }, // no presentNames
    ];
    expect(h.filterMeetings(meetings, '')).toHaveLength(3);
    expect(h.filterMeetings(meetings, 'alex')).toEqual([meetings[0]]);
    expect(h.filterMeetings(meetings, 'zzz')).toEqual([]);
    expect(h.filterMeetings(null, 'x')).toEqual([]);
  });
  test('filterPeople matches name or email; null-safe', () => {
    const people = [{ displayName: 'Alex', email: 'alex@acme.com' }, { email: 'x@acme.com' }];
    expect(h.filterPeople(people, '')).toHaveLength(2);
    expect(h.filterPeople(people, 'alex')).toEqual([people[0]]);
    expect(h.filterPeople(null, 'x')).toEqual([]);
  });
  test('filterSeries returns all on empty query, filters by title otherwise; null-safe', () => {
    const series = [{ title: 'Weekly Sync' }, { title: 'Daily Standup' }];
    expect(h.filterSeries(series, '')).toBe(series);
    expect(h.filterSeries(series, 'daily')).toEqual([series[1]]);
    expect(h.filterSeries(null, 'x')).toEqual([]); // null list, with a query
    expect(h.filterSeries(null, '')).toEqual([]);  // null list, empty query (else branch)
  });
});

describe('calendar heatmap', () => {
  test('activeDays counts days with a positive count', () => {
    expect(h.activeDays([{ count: 0 }, { count: 3 }, { count: 1 }])).toBe(2);
    expect(h.activeDays(null)).toBe(0);
  });
  test('maxCalendarCount floors at 1', () => {
    expect(h.maxCalendarCount([{ count: 0 }, { count: 5 }])).toBe(5);
    expect(h.maxCalendarCount([{ count: 0 }])).toBe(1); // floor
    expect(h.maxCalendarCount([])).toBe(1);
    expect(h.maxCalendarCount(null)).toBe(1);
  });
  test('calendarLevel buckets a count into intensity classes', () => {
    expect(h.calendarLevel(0, 8)).toBe('');   // empty
    expect(h.calendarLevel(1, 8)).toBe('l1');  // <.25
    expect(h.calendarLevel(3, 8)).toBe('l2');  // <.5
    expect(h.calendarLevel(5, 8)).toBe('l3');  // <.75
    expect(h.calendarLevel(8, 8)).toBe('l4');  // top
  });
});

describe('donut svg and meeting helpers', () => {
  test('renderDonutSvg produces SVG with percentage text and stroke', () => {
    const svg = h.renderDonutSvg(0.85);
    expect(svg).toContain('<svg');
    expect(svg).toContain('85%');
    expect(svg).toContain('stroke="#4ade80"');
  });

  test('filterLinks matches by title, token, or type; null-safe', () => {
    const links = [
      { token: 'abc123xyz', targetTitle: 'Math 101', type: 'meeting' },
      { token: 'def456uvw', targetTitle: 'Daily Standup', type: 'series' },
    ];
    expect(h.filterLinks(links, 'math')).toHaveLength(1);
    expect(h.filterLinks(links, 'standup')).toHaveLength(1);
    expect(h.filterLinks(links, 'abc123xyz')).toHaveLength(1);
    expect(h.filterLinks(links, '')).toHaveLength(2);
    expect(h.filterLinks(null, 'test')).toHaveLength(0);
  });

  test('buildMeetingCsv generates CSV with header and attendee rows', () => {
    const detail = {
      title: 'Class A',
      attendees: [
        { displayName: 'Student One', email: 's1@acme.com', status: 'present', rsvpStatus: 'accepted', durationMin: 45 },
        { displayName: 'Student Two', email: 's2@acme.com', durationMs: 1800000 },
      ],
    };
    const csv = h.buildMeetingCsv(detail);
    expect(csv).toContain('"Name","Email","Status","Calendar RSVP"');
    expect(csv).toContain('"Student One","s1@acme.com","present","accepted"');
    expect(csv).toContain('30'); // 1,800,000 ms = 30 min
  });

  test('renderDonutSvg handles edge case percentage values', () => {
    expect(h.renderDonutSvg(-0.1)).toContain('0%');
    expect(h.renderDonutSvg(1.5)).toContain('100%');
    expect(h.renderDonutSvg('invalid')).toContain('0%');
  });

  test('buildMeetingCsv handles null detail and missing attendee properties', () => {
    expect(h.buildMeetingCsv(null)).toContain('"Name","Email"');
    expect(h.buildMeetingCsv({})).toContain('"Name","Email"');
    const csvMissing = h.buildMeetingCsv({ attendees: [{ displayName: '', email: '', durationMs: 0 }] });
    expect(csvMissing).toContain('"","","absent","needsAction"');
  });

  test('buildMeetingCsv supports localized meeting headers', () => {
    const detail = { attendees: [{ displayName: 'Juan', email: 'juan@test.com' }] };
    const locHeaders = { meeting: ['Nombre', 'Correo', 'Estado', 'RSVP', 'Entrada', 'Salida', 'Duración (min)'] };
    const csv = h.buildMeetingCsv(detail, locHeaders);
    expect(csv).toContain('"Nombre","Correo","Estado"');
    expect(csv).toContain('"Juan","juan@test.com"');
    expect(h.buildMeetingCsv(detail, {})).toContain('"Name","Email"');
    expect(h.buildMeetingCsv(detail, { series: [] })).toContain('"Name","Email"');

    delete global.AttUtils;
    expect(h.buildMeetingCsv(detail, 'es')).toContain('"Name","Email"');

    global.AttUtils = {};
    expect(h.buildMeetingCsv(detail, 'es')).toContain('"Name","Email"');

    global.AttUtils = {
      CSV_HEADER_LOCALIZATIONS: {
        es: { meeting: ['Nombre', 'Correo', 'Estado'], series: ['Nombre', 'Correo', 'Asistió'] }
      }
    };
    expect(h.buildMeetingCsv(detail, 'es')).toContain('"Nombre","Correo","Estado"');
    expect(h.buildMeetingCsv(detail, 'unknown')).toContain('"Name","Email"');
    delete global.AttUtils;
  });

  test('buildSeriesGradebookCsv formats moodle, canvas, generic and localized headers', () => {
    const series = {
      title: 'Math 101',
      people: [
        { displayName: 'Alice Smith', email: 'alice@test.com', attendanceRate: 0.95, attended: 9, missed: 1, totalMinutes: 450 },
        { displayName: 'Bob', attendanceRate: 0 },
      ],
    };

    // Generic default
    const genericCsv = h.buildSeriesGradebookCsv(series, 'generic');
    expect(genericCsv).toContain('"Name","Email","Attended","Missed","Attendance %","Total minutes"');
    expect(genericCsv).toContain('"Alice Smith","alice@test.com","9","1","95","450"');
    expect(genericCsv).toContain('"Bob","","0","0","0","0"');

    // Generic localized & empty locHeaders fallback & string locale code
    const locHeaders = { series: ['Nombre', 'Correo', 'Asistió', 'Ausente', '% Asistencia', 'Minutos totales'] };
    const locCsv = h.buildSeriesGradebookCsv(series, 'generic', locHeaders);
    expect(locCsv).toContain('"Nombre","Correo","Asistió"');
    expect(h.buildSeriesGradebookCsv(series, 'generic', {})).toContain('"Name","Email"');
    expect(h.buildSeriesGradebookCsv(series, 'generic', { meeting: [] })).toContain('"Name","Email"');

    delete global.AttUtils;
    expect(h.buildSeriesGradebookCsv(series, 'generic', 'es')).toContain('"Name","Email"');

    global.AttUtils = {};
    expect(h.buildSeriesGradebookCsv(series, 'generic', 'es')).toContain('"Name","Email"');

    global.AttUtils = {
      CSV_HEADER_LOCALIZATIONS: {
        es: { meeting: ['Nombre', 'Correo', 'Estado'], series: ['Nombre', 'Correo', 'Asistió'] }
      }
    };
    expect(h.buildSeriesGradebookCsv(series, 'generic', 'es')).toContain('"Nombre","Correo","Asistió"');
    expect(h.buildSeriesGradebookCsv(series, 'generic', 'unknown')).toContain('"Name","Email"');
    delete global.AttUtils;

    // Moodle format
    const moodleCsv = h.buildSeriesGradebookCsv(series, 'moodle');
    expect(moodleCsv).toContain('"First name","Last name","Email address","Math 101 attendance (%)"');
    expect(moodleCsv).toContain('"Alice","Smith","alice@test.com","95"');

    // Canvas format
    const canvasCsv = h.buildSeriesGradebookCsv(series, 'canvas');
    expect(canvasCsv).toContain('"Student","ID","SIS User ID","SIS Login ID","Section","Math 101 attendance"');
    expect(canvasCsv).toContain('"Alice Smith","","","alice@test.com","","95"');

    // Defaults for empty series
    expect(h.buildSeriesGradebookCsv(null, 'moodle')).toContain('"First name"');
    expect(h.buildSeriesGradebookCsv({}, 'canvas')).toContain('"Student"');
  });
});

