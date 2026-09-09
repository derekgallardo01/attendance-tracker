/** @jest-environment jsdom */
// LMS gradebook CSV builders — meeting-level (js/utils.js, from live roster +
// participants) and series-level (js/history.js, from a /api/series entry).
const path = require('path');
const utils = require(path.join(__dirname, '..', '..', '..', 'js', 'utils.js'));
const history = require(path.join(__dirname, '..', '..', '..', 'js', 'history.js'));

const startTime = new Date('2026-09-07T14:00:00Z');
const now = new Date('2026-09-07T15:00:00Z'); // 60-min meeting

const roster = [
  { name: 'Alice Walker', email: 'alice@school.edu' },
  { name: 'Bob Short', email: 'bob@school.edu' },
  { name: 'Carol Absent', email: 'carol@school.edu' },
  { name: 'Dave Excused', email: 'dave@school.edu' },
];

const participants = [
  // Full attendance, still present.
  { displayName: 'Alice Walker', email: 'alice@school.edu', present: true, joinTime: new Date('2026-09-07T14:00:00Z'), _accumulatedMs: 0, rejoins: 0 },
  // Left after 15 minutes.
  { displayName: 'Bob Short', email: 'bob@school.edu', present: false, joinTime: new Date('2026-09-07T14:00:00Z'), _accumulatedMs: 15 * 60000, rejoins: 0 },
];

const opts = {
  meetingTitle: 'Biology 101',
  totalMeetingMs: 3600000,
  startTime,
  now,
  excusedStudents: { 'dave@school.edu': { excused: true, note: 'Dentist' } },
};

describe('splitName', () => {
  test('splits on the last space', () => {
    expect(utils.splitName('Alice B Walker')).toEqual({ first: 'Alice B', last: 'Walker' });
  });
  test('single token goes in first; empty stays empty', () => {
    expect(utils.splitName('Cher')).toEqual({ first: 'Cher', last: '' });
    expect(utils.splitName('')).toEqual({ first: '', last: '' });
    expect(utils.splitName(null)).toEqual({ first: '', last: '' });
  });
});

describe('escapeCsv', () => {
  test('quotes values and doubles inner quotes', () => {
    expect(utils.escapeCsv('a "b" c')).toBe('"a ""b"" c"');
  });
  test('null/undefined become empty quoted fields', () => {
    expect(utils.escapeCsv(null)).toBe('""');
    expect(utils.escapeCsv(undefined)).toBe('""');
  });
});

describe('buildLmsGradebookRows', () => {
  test('grades: attendance % when joined, 0 when absent, blank when excused', () => {
    const rows = utils.buildLmsGradebookRows(participants, roster, opts);
    expect(rows).toEqual([
      { name: 'Alice Walker', email: 'alice@school.edu', grade: 100 },
      { name: 'Bob Short', email: 'bob@school.edu', grade: 25 },
      { name: 'Carol Absent', email: 'carol@school.edu', grade: 0 },
      { name: 'Dave Excused', email: 'dave@school.edu', grade: '' },
    ]);
  });

  test('minPercent threshold: below it the LMS grade is 0 (absent), excused stays blank', () => {
    // The Settings "Min stay %" was previously dead for gradebook exports.
    const rows = utils.buildLmsGradebookRows(participants, roster, { ...opts, minPercent: 50 });
    expect(rows.find(r => r.name === 'Alice Walker').grade).toBe(100); // above threshold — unchanged
    expect(rows.find(r => r.name === 'Bob Short').grade).toBe(0);      // 25% < 50% → counted absent
    expect(rows.find(r => r.name === 'Dave Excused').grade).toBe('');  // excused stays blank
  });

  test('handles missing opts, roster, and email-less name-only students', () => {
    expect(utils.buildLmsGradebookRows([], null)).toEqual([]);
    expect(utils.buildLmsGradebookRows([], [{ name: 'Nadia' }], undefined)).toEqual([
      { name: 'Nadia', email: '', grade: 0 },
    ]);
    // Degenerate student with neither email nor name still yields a row.
    expect(utils.buildLmsGradebookRows([], [{}], { now })).toEqual([
      { name: undefined, email: '', grade: 0 },
    ]);
  });

  test('falls back to opts.meetingMinutes (then 1) when totalMeetingMs is absent', () => {
    const p = [{ displayName: 'Alice Walker', email: 'alice@school.edu', present: false, joinTime: startTime, _accumulatedMs: 30 * 60000 }];
    const half = utils.buildLmsGradebookRows(p, roster.slice(0, 1), { meetingMinutes: 60, now });
    expect(half[0].grade).toBe(50);
    const capped = utils.buildLmsGradebookRows(p, roster.slice(0, 1), { now });
    expect(capped[0].grade).toBe(100); // 30 min vs 1-min floor, capped at 100
  });

  test('uses roster identity when the matched participant lacks email/name fields', () => {
    const p = [{ displayName: 'Alice Walker', present: false, _accumulatedMs: 60 * 60000 }];
    const rows = utils.buildLmsGradebookRows(p, [{ name: 'Alice Walker', email: 'alice@school.edu' }], { totalMeetingMs: 3600000, now });
    expect(rows[0]).toEqual({ name: 'Alice Walker', email: 'alice@school.edu', grade: 100 });
  });
});

describe('buildMoodleGradebookCsv', () => {
  test('emits BOM, Moodle headers, and one row per roster student', () => {
    const csv = utils.buildMoodleGradebookCsv(participants, roster, opts);
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('"First name","Last name","Email address","Biology 101 attendance (%)"');
    expect(lines[1]).toBe('"Alice","Walker","alice@school.edu","100"');
    expect(lines[3]).toBe('"Carol","Absent","carol@school.edu","0"');
    expect(lines[4]).toBe('"Dave","Excused","dave@school.edu",""');
    expect(lines).toHaveLength(5);
  });

  test('defaults the item name when no meeting title', () => {
    const csv = utils.buildMoodleGradebookCsv([], [], undefined);
    expect(csv).toContain('Google Meet attendance (%)');
  });
});

describe('buildCanvasGradebookCsv', () => {
  test('emits Canvas headers with the Points Possible row; email as SIS Login ID', () => {
    const csv = utils.buildCanvasGradebookCsv(participants, roster, opts);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('"Student","ID","SIS User ID","SIS Login ID","Section","Biology 101 attendance"');
    expect(lines[1]).toBe('"Points Possible","","","","","100"');
    expect(lines[2]).toBe('"Alice Walker","","","alice@school.edu","","100"');
    expect(lines).toHaveLength(6);
  });

  test('defaults the assignment name when no meeting title', () => {
    const csv = utils.buildCanvasGradebookCsv([], [], undefined);
    expect(csv).toContain('Google Meet attendance');
  });
});

describe('series gradebook CSVs (js/history.js)', () => {
  const series = {
    recurringEventId: 'r1',
    title: 'Algebra II',
    instanceCount: 8,
    people: [
      { displayName: 'Alice B Walker', email: 'alice@school.edu', attended: 8, missed: 0, attendanceRate: 1, totalMinutes: 480 },
      { displayName: 'Bob Jones', email: 'bob@school.edu', attended: 4, missed: 4, attendanceRate: 0.5, totalMinutes: 200 },
      { displayName: 'Nameless' }, // defaults: no email, no counts
    ],
  };

  test('generic format carries attended/missed/rate/minutes', () => {
    const csv = history.buildSeriesGradebookCsv(series, 'generic');
    expect(csv.startsWith('﻿')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe('"Name","Email","Attended","Missed","Attendance %","Total minutes"');
    expect(lines[1]).toBe('"Alice B Walker","alice@school.edu","8","0","100","480"');
    expect(lines[2]).toBe('"Bob Jones","bob@school.edu","4","4","50","200"');
    expect(lines[3]).toBe('"Nameless","","0","0","0","0"');
  });

  test('moodle format splits names and grades by attendance rate', () => {
    const lines = history.buildSeriesGradebookCsv(series, 'moodle').slice(1).split('\r\n');
    expect(lines[0]).toBe('"First name","Last name","Email address","Algebra II attendance (%)"');
    expect(lines[1]).toBe('"Alice B","Walker","alice@school.edu","100"');
    expect(lines[2]).toBe('"Bob","Jones","bob@school.edu","50"');
  });

  test('canvas format includes the Points Possible row and SIS Login ID', () => {
    const lines = history.buildSeriesGradebookCsv(series, 'canvas').slice(1).split('\r\n');
    expect(lines[0]).toBe('"Student","ID","SIS User ID","SIS Login ID","Section","Algebra II attendance"');
    expect(lines[1]).toBe('"Points Possible","","","","","100"');
    expect(lines[2]).toBe('"Alice B Walker","","","alice@school.edu","","100"');
  });

  test('formula-looking display names are defused in the series gradebook CSV', () => {
    // csvField was missing the injection prefix its AttUtils.escapeCsv twin
    // documents — display names are attacker-controlled by any meeting guest.
    const evil = {
      title: 'Algebra II',
      people: [{ displayName: '=HYPERLINK("http://evil","x")', email: 'e@x.com', attended: 1, missed: 0, attendanceRate: 1, totalMinutes: 60 }],
    };
    const csv = history.buildSeriesGradebookCsv(evil, 'generic');
    expect(csv).toContain('"\'=HYPERLINK');
    expect(csv).not.toContain('"=HYPERLINK');
  });

  test('tolerates a null series and defaults the title', () => {
    const csv = history.buildSeriesGradebookCsv(null, 'generic');
    expect(csv).toContain('"Name","Email"');
    const moodle = history.buildSeriesGradebookCsv(null, 'moodle');
    expect(moodle).toContain('Recurring meeting attendance (%)');
  });

  test('splitPersonName and csvField edge branches', () => {
    expect(history.splitPersonName('Cher')).toEqual({ first: 'Cher', last: '' });
    expect(history.splitPersonName(null)).toEqual({ first: '', last: '' });
    expect(history.csvField(null)).toBe('""');
    expect(history.csvField(undefined)).toBe('""');
    expect(history.csvField('a "b"')).toBe('"a ""b"""');
  });
});
