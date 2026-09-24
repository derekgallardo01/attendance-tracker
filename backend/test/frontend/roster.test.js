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

describe('findParticipantForStudent — guard branches', () => {
  test('returns null for a missing student or participants list', () => {
    expect(findParticipantForStudent(null, [])).toBeNull();
    expect(findParticipantForStudent({ name: 'x' }, null)).toBeNull();
  });

  test('skips null entries and empty display names, then matches by substring', () => {
    // 'Zoe' vs 'Zoe Q': normalized names differ ('zoe' != 'zoeq'), so the
    // first loop passes over every entry and the substring loop matches.
    const target = { displayName: 'Zoe Q' };
    const p = findParticipantForStudent(
      { name: 'Zoe', email: '' },
      [null, { displayName: '' }, target]
    );
    expect(p).toBe(target);
  });
});

describe('buildAttendanceCsv — fallback and departure branches', () => {
  const startTime = new Date('2026-09-07T14:00:00Z');
  const now = new Date('2026-09-07T15:00:00Z');

  test('defaults every opts field when called with an empty opts object', () => {
    const csv = buildAttendanceCsv(
      [{ displayName: 'A', present: true, joinTime: new Date(), _accumulatedMs: 0 }],
      null,
      {}
    );
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('"A"');
    // meetingMinutes falls back to opts.meetingMinutes when totalMeetingMs is absent
    const half = buildAttendanceCsv(
      [{ displayName: 'B', present: false, _accumulatedMs: 15 * 60000 }],
      null,
      { meetingMinutes: 30, now }
    );
    expect(half).toContain('"50%"');
  });

  test('roster rows fall back through every identity/time field', () => {
    const roster = [
      { name: 'NoEmail Kid' },                       // no email — matched by name
      { name: 'Ghost', email: 'ghost@x.com' },       // matched by email
      { name: 'Away' },                              // absent, no email
      {},                                            // degenerate: no identity at all
    ];
    const parts = [
      // matched by name; participant has NO email
      { displayName: 'NoEmail Kid', present: true, joinTime: startTime, _accumulatedMs: 0 },
      // matched by email; participant has NO displayName, NO joinTime, left with leaveTime
      { email: 'ghost@x.com', present: false, leaveTime: now, _accumulatedMs: 30 * 60000 },
    ];
    const csv = buildAttendanceCsv(parts, roster, {
      totalMeetingMs: 3600000, startTime, now,
      // excused entry with NO note (note fallback branch)
      excusedStudents: { 'noemail kid': { excused: true } },
    });
    expect(csv).toContain('"NoEmail Kid"'); // name kept, email column empty
    expect(csv).toContain('"Ghost"');       // displayName fell back to roster name
    expect(csv).toContain(now.toLocaleTimeString()); // leaveTime column rendered
    expect(csv).toContain('"Away"');
    expect(csv).toContain('"Absent"');
  });

  test('departed guests and no-roster departures render "Guest (Left)" / "Left"', () => {
    const roster = [{ name: 'Registered', email: 'r@x.com' }];
    const parts = [
      { displayName: 'Registered', email: 'r@x.com', present: true, joinTime: startTime, _accumulatedMs: 0 },
      // unmatched guest: departed, no email, never got a joinTime, has leaveTime
      { displayName: 'Ivan Ghost', present: false, leaveTime: now, _accumulatedMs: 60000 },
    ];
    const withRoster = buildAttendanceCsv(parts, roster, { totalMeetingMs: 3600000, startTime, now });
    expect(withRoster).toContain('"Guest (Left)"');

    const noRoster = buildAttendanceCsv(
      [{ displayName: 'Dep', present: false, leaveTime: now, _accumulatedMs: 0 }],
      null,
      { totalMeetingMs: 3600000, startTime, now }
    );
    expect(noRoster).toContain('"Left"');
    expect(noRoster).toContain(now.toLocaleTimeString());
  });

  test('defensive: tolerates a nonsensical negative meetingMinutes (pct pins to 100)', () => {
    // meetingMinutes is always >= 1 for real inputs (Math.max(1, ...) or the
    // || 1 default); a negative survives only via explicit opts. This test
    // exists purely to exercise the defensive `: 100` branches.
    const parts = [
      { displayName: 'M', email: 'm@x.com', present: true, joinTime: startTime, _accumulatedMs: 0 },
      { displayName: 'G', present: true, joinTime: startTime, _accumulatedMs: 0 },
    ];
    const withRoster = buildAttendanceCsv(parts, [{ name: 'M', email: 'm@x.com' }], {
      totalMeetingMs: 0, meetingMinutes: -1, startTime, now,
    });
    expect(withRoster).toContain('"100%"');
    const noRoster = buildAttendanceCsv(parts, null, { totalMeetingMs: 0, meetingMinutes: -1, startTime, now });
    expect(noRoster).toContain('"100%"');
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

  test('minMinutes rule: absolute-minutes floor flags short stays independent of percent', () => {
    // 60-min meeting, no percent floor, 45-minute minimum-stay rule.
    // Hana stayed 30 min (below the floor), Ivan 50 min (above it).
    const minRoster = [
      { name: 'Hana Short', email: 'hana@school.edu' },
      { name: 'Ivan Stays', email: 'ivan@school.edu' }
    ];
    const minParts = [
      { displayName: 'Hana Short', email: 'hana@school.edu', present: false, joinTime: new Date('2026-09-07T14:00:00Z'), _accumulatedMs: 30 * 60000, rejoins: 0 },
      { displayName: 'Ivan Stays', email: 'ivan@school.edu', present: false, joinTime: new Date('2026-09-07T14:00:00Z'), _accumulatedMs: 50 * 60000, rejoins: 0 }
    ];
    const csv = buildAttendanceCsv(minParts, minRoster, {
      meetingTitle: 'Biology 101',
      startTime,
      now,
      totalMeetingMs: 3600000,
      lateMinutes: 10,
      minPercent: 0,
      minMinutes: 45,
      excusedStudents: {}
    });
    expect(csv).toContain('"Hana Short","hana@school.edu","Left Early / Incomplete"');
    expect(csv).toContain('"Ivan Stays","ivan@school.edu","Present (Left)"');
  });

  test('minMinutes rule: excused short stay reads Excused (Short Stay)', () => {
    const csv = buildAttendanceCsv(
      [{ displayName: 'Dave Excused', email: 'dave@school.edu', present: false, joinTime: new Date('2026-09-07T14:00:00Z'), _accumulatedMs: 5 * 60000, rejoins: 0 }],
      [{ name: 'Dave Excused', email: 'dave@school.edu' }],
      { startTime, now, totalMeetingMs: 3600000, lateMinutes: 10, minMinutes: 45, excusedStudents }
    );
    expect(csv).toContain('"Excused (Short Stay)"');
  });

  test('appends free-tier watermark when isFreePlan is true', () => {
    const csv = buildAttendanceCsv(
      [{ displayName: 'Dave', email: 'dave@school.edu', present: true, joinTime: new Date('2026-09-07T14:00:00Z'), _accumulatedMs: 3600000, rejoins: 0 }],
      null,
      { isFreePlan: true }
    );
    expect(csv).toContain('# Generated with Attendance Tracker Free Plan');
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

describe('buildAttendanceCsv — self-check-in notes', () => {
  const startTime = new Date('2026-09-07T14:00:00Z');
  const now = new Date('2026-09-07T15:00:00Z');
  const checkedInAt = '2026-09-07T14:03:00.000Z';
  const chkStr = new Date(checkedInAt).toLocaleTimeString();

  test('roster row: check-in note joins an existing excuse note with "; "', () => {
    const csv = buildAttendanceCsv(
      [{ displayName: 'Dave Excused', email: 'dave@school.edu', present: false, joinTime: startTime, _accumulatedMs: 5 * 60000, rejoins: 0, checkedInAt }],
      [{ name: 'Dave Excused', email: 'dave@school.edu' }],
      {
        startTime, now, totalMeetingMs: 3600000, minPercent: 50,
        excusedStudents: { 'dave@school.edu': { excused: true, note: 'Dentist appointment' } },
      }
    );
    expect(csv).toContain(`"Dentist appointment; Checked in ${chkStr}"`);
  });

  test('guest row: check-in note appends to the Unregistered guest marker', () => {
    const csv = buildAttendanceCsv(
      [{ displayName: 'Eve Guest', email: 'eve@guest.org', present: true, joinTime: startTime, _accumulatedMs: 0, rejoins: 0, checkedInAt }],
      [{ name: 'Someone Else', email: 'other@school.edu' }],
      { startTime, now, totalMeetingMs: 3600000, excusedStudents: {} }
    );
    expect(csv).toContain(`"Unregistered guest; Checked in ${chkStr}"`);
  });

  test('no-roster row: check-in stands alone in the Notes column', () => {
    const csv = buildAttendanceCsv(
      [{ displayName: 'Solo', email: 's@x.com', present: true, joinTime: startTime, _accumulatedMs: 0, rejoins: 0, checkedInAt }],
      null,
      { startTime, now, totalMeetingMs: 3600000 }
    );
    expect(csv).toContain(`"Checked in ${chkStr}"`);
  });
});

describe('buildAttendanceCsv — localization & timezone', () => {
  const startTime = new Date('2026-09-07T14:00:00Z');
  const now = new Date('2026-09-07T15:00:00Z');
  const joinTime = '2026-09-07T14:05:00.000Z';
  const leaveTime = '2026-09-07T14:50:00.000Z';

  test('localizes headers, status, and formats times with locale and timezone', () => {
    const parts = [
      { displayName: 'Larissa', email: 'l@test.com', present: false, joinTime, leaveTime, rejoins: 1 }
    ];
    const csv = buildAttendanceCsv(parts, null, {
      locale: 'pt-BR',
      timezone: 'America/Sao_Paulo',
      startTime,
      now,
      totalMeetingMs: 3600000,
    });
    expect(csv).toContain('"Nome","E-mail","Status","% Presença"');
    expect(csv).toContain('Saiu');
    const expectedJoin = new Date(joinTime).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    expect(csv).toContain(expectedJoin);
  });

  test('formats times when only timezone is provided', () => {
    const parts = [{ displayName: 'User', email: 'u@test.com', present: true, joinTime }];
    const csv = buildAttendanceCsv(parts, null, {
      timezone: 'America/New_York',
    });
    const expectedJoin = new Date(joinTime).toLocaleTimeString(undefined, { timeZone: 'America/New_York' });
    expect(csv).toContain(expectedJoin);
    expect(csv).toContain('"Name","Email","Status"');
  });

  test('formats times and localizes when only locale is provided', () => {
    const parts = [{ displayName: 'User', email: 'u@test.com', present: true, joinTime }];
    const csv = buildAttendanceCsv(parts, null, {
      locale: 'es',
    });
    const expectedJoin = new Date(joinTime).toLocaleTimeString('es', { timeZone: undefined });
    expect(csv).toContain(expectedJoin);
    expect(csv).toContain('"Nombre","Correo","Estado"');
    expect(csv).toContain('Presente');
  });

  test('falls back to default toLocaleTimeString when timezone throws', () => {
    const parts = [{ displayName: 'User', email: 'u@test.com', present: true, joinTime }];
    const csv = buildAttendanceCsv(parts, null, {
      timezone: 'Invalid/NonExistent_Zone',
      locale: 'en',
    });
    const expectedJoin = new Date(joinTime).toLocaleTimeString();
    expect(csv).toContain(expectedJoin);
  });

  test('handles invalid date in checkedInAt gracefully in fmtTime', () => {
    const parts = [{ displayName: 'User', email: 'u@test.com', present: true, joinTime, checkedInAt: 'invalid-date' }];
    const csv = buildAttendanceCsv(parts, null, {
      locale: 'pt',
      timezone: 'America/Sao_Paulo',
    });
    expect(csv).toContain('Checked in');
  });

  test('localizes all statuses across roster, late, excused, short stay, and guests in Portuguese', () => {
    const roster = [
      { name: 'Late Student', email: 'late@test.com' },
      { name: 'Left Early Student', email: 'early@test.com' },
      { name: 'Excused Short Student', email: 'short@test.com' },
      { name: 'Left Student', email: 'left@test.com' },
      { name: 'Absent Student', email: 'absent@test.com' },
      { name: 'Excused Absent Student', email: 'absentexcused@test.com' },
    ];
    const parts = [
      { displayName: 'Late Student', email: 'late@test.com', present: true, joinTime: new Date('2026-09-07T14:20:00Z'), _accumulatedMs: 40 * 60000 },
      { displayName: 'Left Early Student', email: 'early@test.com', present: false, joinTime, leaveTime, _accumulatedMs: 10 * 60000 },
      { displayName: 'Excused Short Student', email: 'short@test.com', present: false, joinTime, leaveTime, _accumulatedMs: 10 * 60000 },
      { displayName: 'Left Student', email: 'left@test.com', present: false, joinTime, leaveTime, _accumulatedMs: 50 * 60000 },
      { displayName: 'Guest Present', email: 'gp@test.com', present: true, joinTime, _accumulatedMs: 40 * 60000 },
      { displayName: 'Guest Left', email: 'gl@test.com', present: false, joinTime, leaveTime, _accumulatedMs: 40 * 60000 },
    ];
    const csv = buildAttendanceCsv(parts, roster, {
      locale: 'pt',
      timezone: 'America/Sao_Paulo',
      startTime,
      now,
      totalMeetingMs: 3600000,
      minPercent: 50,
      lateMinutes: 10,
      excusedStudents: {
        'short@test.com': { excused: true, note: 'Allowed early departure' },
        'absentexcused@test.com': { excused: true, note: 'Illness' },
      },
    });

    expect(csv).toContain('Atrasado');
    expect(csv).toContain('Saiu antes / Incompleto');
    expect(csv).toContain('Justificado (Estadia curta)');
    expect(csv).toContain('Presente (Saiu)');
    expect(csv).toContain('Ausente');
    expect(csv).toContain('Ausente (Justificado)');
    expect(csv).toContain('Convidado (Presente)');
    expect(csv).toContain('Convidado (Saiu)');
  });

  test('falls back to default English headers and statuses when locale is unsupported', () => {
    const parts = [{ displayName: 'User', email: 'u@test.com', present: true, joinTime }];
    const csv = buildAttendanceCsv(parts, null, {
      locale: 'xx',
    });
    expect(csv).toContain('"Name","Email","Status"');
    expect(csv).toContain('Present');
  });
});

