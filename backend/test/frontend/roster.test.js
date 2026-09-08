/**
 * @jest-environment jsdom
 *
 * Tests for Class Rosters, Student Matching, and Instant CSV Generation
 * in js/utils.js.
 */

const path = require('path');
const utils = require(path.join(__dirname, '..', '..', '..', 'js', 'utils.js'));
const { parseStudentsInput, findParticipantForStudent, buildAttendanceCsv } = utils;

describe('parseStudentsInput', () => {
  test('returns empty array for falsy or whitespace input', () => {
    expect(parseStudentsInput('')).toEqual([]);
    expect(parseStudentsInput(null)).toEqual([]);
    expect(parseStudentsInput('   \n  \n  ')).toEqual([]);
  });

  test('parses Name <email> angle-bracket lines', () => {
    const text = 'Alice Walker <alice@school.edu>\nBob Ross <bob@art.org>';
    const parsed = parseStudentsInput(text);
    expect(parsed).toEqual([
      { name: 'Alice Walker', email: 'alice@school.edu' },
      { name: 'Bob Ross', email: 'bob@art.org' }
    ]);
  });

  test('parses Name, email comma lines', () => {
    const text = 'Charlie Chaplin, charlie@film.org\nDana Scully, scully@fbi.gov';
    const parsed = parseStudentsInput(text);
    expect(parsed).toEqual([
      { name: 'Charlie Chaplin', email: 'charlie@film.org' },
      { name: 'Dana Scully', email: 'scully@fbi.gov' }
    ]);
  });

  test('parses plain emails and plain names', () => {
    const text = 'student1@school.edu\nJane Doe\nstudent2@university.edu';
    const parsed = parseStudentsInput(text);
    expect(parsed).toEqual([
      { name: 'student1', email: 'student1@school.edu' },
      { name: 'Jane Doe', email: '' },
      { name: 'student2', email: 'student2@university.edu' }
    ]);
  });
});

describe('findParticipantForStudent', () => {
  const participants = [
    { displayName: 'Alice Walker', email: 'alice@school.edu', present: true },
    { displayName: 'Bob Smith', email: 'bob.smith@company.com', present: true },
    { displayName: 'Charlie D.', email: '', present: true }
  ];

  test('matches by exact email case-insensitively', () => {
    const student = { name: 'Alice', email: 'ALICE@SCHOOL.EDU' };
    expect(findParticipantForStudent(student, participants)).toBe(participants[0]);
  });

  test('matches by normalized name when email is missing or different', () => {
    const student = { name: 'Bob Smith', email: 'other@school.edu' };
    expect(findParticipantForStudent(student, participants)).toBe(participants[1]);
  });

  test('matches by name substring when email is missing', () => {
    const student = { name: 'Charlie', email: '' };
    expect(findParticipantForStudent(student, participants)).toBe(participants[2]);
  });

  test('returns null when no match found', () => {
    const student = { name: 'Zack Taylor', email: 'zack@powerrangers.com' };
    expect(findParticipantForStudent(student, participants)).toBeNull();
  });
});

describe('buildAttendanceCsv', () => {
  const startTime = new Date('2026-09-07T14:00:00Z');
  const now = new Date('2026-09-07T15:00:00Z'); // 60 min total

  const roster = [
    { name: 'Alice Walker', email: 'alice@school.edu' },
    { name: 'Bob Late', email: 'bob@school.edu' },
    { name: 'Carol Absent', email: 'carol@school.edu' },
    { name: 'Dave Excused', email: 'dave@school.edu' }
  ];

  const participants = [
    {
      displayName: 'Alice Walker',
      email: 'alice@school.edu',
      present: true,
      joinTime: new Date('2026-09-07T14:01:00Z'),
      _accumulatedMs: 0,
      rejoins: 0
    },
    {
      displayName: 'Bob Late',
      email: 'bob@school.edu',
      present: true,
      joinTime: new Date('2026-09-07T14:20:00Z'),
      _accumulatedMs: 0,
      rejoins: 1
    },
    {
      displayName: 'Eve Guest',
      email: 'eve@guest.org',
      present: true,
      joinTime: new Date('2026-09-07T14:05:00Z'),
      _accumulatedMs: 0,
      rejoins: 0
    }
  ];

  const excusedStudents = {
    'dave@school.edu': { excused: true, note: 'Dentist appointment' }
  };

  test('generates valid UTF-8 BOM CSV with correct headers', () => {
    const csv = buildAttendanceCsv(participants, roster, {
      meetingTitle: 'Biology 101',
      startTime,
      now,
      totalMeetingMs: 3600000,
      lateMinutes: 10,
      minPercent: 50,
      excusedStudents
    });

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Name","Email","Status","Attendance %","Duration (min)","Join Time","Leave Time","Rejoins","Notes"');
  });

  test('covers the short-stay statuses: Left Early, Excused (Short Stay), Present (Left)', () => {
    // 60-min meeting, 50% floor. Fran stayed 10 min (short, not excused),
    // Dave stayed 5 min (short, excused), Gina attended fully but left
    // before the CSV was generated (present:false).
    const shortRoster = [
      { name: 'Fran Short', email: 'fran@school.edu' },
      { name: 'Dave Excused', email: 'dave@school.edu' },
      { name: 'Gina Gone', email: 'gina@school.edu' }
    ];
    const shortParts = [
      { displayName: 'Fran Short', email: 'fran@school.edu', present: false, joinTime: new Date('2026-09-07T14:00:00Z'), _accumulatedMs: 10 * 60000, rejoins: 0 },
      { displayName: 'Dave Excused', email: 'dave@school.edu', present: false, joinTime: new Date('2026-09-07T14:00:00Z'), _accumulatedMs: 5 * 60000, rejoins: 0 },
      { displayName: 'Gina Gone', email: 'gina@school.edu', present: false, joinTime: new Date('2026-09-07T14:00:00Z'), _accumulatedMs: 55 * 60000, rejoins: 0 }
    ];
    const csv = buildAttendanceCsv(shortParts, shortRoster, {
      meetingTitle: 'Biology 101',
      startTime,
      now,
      totalMeetingMs: 3600000,
      lateMinutes: 10,
      minPercent: 50,
      excusedStudents
    });
    expect(csv).toContain('"Left Early / Incomplete"');
    expect(csv).toContain('"Excused (Short Stay)"');
    expect(csv).toContain('"Present (Left)"');
  });

  test('marks on-time attendee as Present and late attendee as Late', () => {
    const csv = buildAttendanceCsv(participants, roster, {
      meetingTitle: 'Biology 101',
      startTime,
      now,
      totalMeetingMs: 3600000,
      lateMinutes: 10,
      minPercent: 50,
      excusedStudents
    });

    expect(csv).toContain('"Alice Walker","alice@school.edu","Present"');
    expect(csv).toContain('"Bob Late","bob@school.edu","Late"');
  });

  test('marks absent students as Absent and Excused with notes', () => {
    const csv = buildAttendanceCsv(participants, roster, {
      meetingTitle: 'Biology 101',
      startTime,
      now,
      totalMeetingMs: 3600000,
      lateMinutes: 10,
      minPercent: 50,
      excusedStudents
    });

    expect(csv).toContain('"Carol Absent","carol@school.edu","Absent"');
    expect(csv).toContain('"Dave Excused","dave@school.edu","Absent (Excused)","0%","0","","","0","Dentist appointment"');
  });

  test('categorizes unregistered live attendee as Guest', () => {
    const csv = buildAttendanceCsv(participants, roster, {
      meetingTitle: 'Biology 101',
      startTime,
      now,
      totalMeetingMs: 3600000,
      lateMinutes: 10,
      minPercent: 50,
      excusedStudents
    });

    expect(csv).toContain('"Eve Guest","eve@guest.org","Guest (Present)"');
    expect(csv).toContain('"Unregistered guest"');
  });

  test('exports standard attendance list without roster', () => {
    const csv = buildAttendanceCsv(participants, null, {
      meetingTitle: 'Standup',
      startTime,
      now,
      totalMeetingMs: 3600000
    });

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Alice Walker","alice@school.edu","Present"');
    expect(csv).toContain('"Eve Guest","eve@guest.org","Present"');
  });
});
