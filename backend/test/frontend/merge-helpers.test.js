/**
 * @jest-environment jsdom
 *
 * Tests for the three additional pure helpers extracted from index.html in
 * batch 9: autoMatchAttendees, participantTotalMs, isSelfParticipant.
 * Each was tightly coupled to `state` in the inline version — now they
 * take their data as args and live in js/utils.js.
 */

const path = require('path');
const utils = require(path.join(__dirname, '..', '..', '..', 'js', 'utils.js'));

// ════════════════════════════════════════════════════════════════════
// autoMatchAttendees — calendar-match modal pre-fill logic
// ════════════════════════════════════════════════════════════════════
describe('autoMatchAttendees', () => {
  test('returns empty emailMap for no participants', () => {
    const r = utils.autoMatchAttendees([], [{ email: 'a@x.com', displayName: 'Alex' }]);
    expect(r.emailMap).toEqual({});
    expect(r.unmatchedCount).toBe(0);
  });

  test('returns empty emailMap for no attendees', () => {
    const r = utils.autoMatchAttendees([{ displayName: 'Alex' }], []);
    expect(r.emailMap).toEqual({});
    expect(r.unmatchedCount).toBe(1);
  });

  test('exact full-name match (case-insensitive)', () => {
    const r = utils.autoMatchAttendees(
      [{ displayName: 'Alex Smith' }],
      [{ email: 'alex@x.com', displayName: 'ALEX SMITH' }],
    );
    expect(r.emailMap).toEqual({ 'Alex Smith': 'alex@x.com' });
    expect(r.unmatchedCount).toBe(0);
  });

  test('first-name fallback when full name does not match', () => {
    const r = utils.autoMatchAttendees(
      [{ displayName: 'Alex (External)' }],
      [{ email: 'alex@x.com', displayName: 'Alex Smith' }],
    );
    expect(r.emailMap).toEqual({ 'Alex (External)': 'alex@x.com' });
  });

  test('first-name fallback does NOT reuse an already-matched email', () => {
    // Two participants both named "Alex" — only one Alex in the invite list,
    // so only one gets the match; the other stays unmatched.
    const r = utils.autoMatchAttendees(
      [{ displayName: 'Alex Smith' }, { displayName: 'Alex Jones' }],
      [{ email: 'alex@x.com', displayName: 'Alex Smith' }],
    );
    expect(r.emailMap).toEqual({ 'Alex Smith': 'alex@x.com' });
    expect(r.unmatchedCount).toBe(1);
  });

  test('handles a mix of matched + unmatched participants', () => {
    const r = utils.autoMatchAttendees(
      [
        { displayName: 'Alex Smith' },
        { displayName: 'Random Guest' },
        { displayName: 'Beth Jones' },
      ],
      [
        { email: 'alex@x.com', displayName: 'Alex Smith' },
        { email: 'beth@x.com', displayName: 'Beth Jones' },
      ],
    );
    expect(r.emailMap).toEqual({ 'Alex Smith': 'alex@x.com', 'Beth Jones': 'beth@x.com' });
    expect(r.unmatchedCount).toBe(1);
  });

  test('exact match wins over first-name match', () => {
    // Two attendees both start with "Alex" — exact match should pick Smith.
    const r = utils.autoMatchAttendees(
      [{ displayName: 'Alex Smith' }],
      [
        { email: 'jones@x.com', displayName: 'Alex Jones' },
        { email: 'smith@x.com', displayName: 'Alex Smith' },
      ],
    );
    expect(r.emailMap).toEqual({ 'Alex Smith': 'smith@x.com' });
  });

  test('ignores participants with no displayName', () => {
    const r = utils.autoMatchAttendees(
      [{ displayName: '' }, { displayName: null }, { displayName: 'Alex' }],
      [{ email: 'alex@x.com', displayName: 'Alex' }],
    );
    expect(Object.keys(r.emailMap)).toHaveLength(1);
  });

  test('handles attendees with missing displayName defensively', () => {
    expect(() => utils.autoMatchAttendees(
      [{ displayName: 'Alex' }],
      [{ email: 'x@x.com' /* no displayName */ }],
    )).not.toThrow();
  });

  test('accepts an iterator/Map.values() (not just arrays)', () => {
    const map = new Map([
      ['p1', { displayName: 'Alex' }],
      ['p2', { displayName: 'Beth' }],
    ]);
    const r = utils.autoMatchAttendees(map.values(), [
      { email: 'a@x.com', displayName: 'Alex' },
      { email: 'b@x.com', displayName: 'Beth' },
    ]);
    expect(Object.keys(r.emailMap)).toHaveLength(2);
  });
});

// ════════════════════════════════════════════════════════════════════
// participantTotalMs — cumulative session time across rejoins
// ════════════════════════════════════════════════════════════════════
describe('participantTotalMs', () => {
  test('0 for null participant', () => {
    expect(utils.participantTotalMs(null)).toBe(0);
    expect(utils.participantTotalMs(undefined)).toBe(0);
  });

  test('0 for never-joined participant', () => {
    expect(utils.participantTotalMs({ joinTime: null, present: false })).toBe(0);
  });

  test('uses _accumulatedMs only for participants who have left', () => {
    const p = { _accumulatedMs: 5 * 60_000, joinTime: new Date('2026-06-28T10:00:00Z'), present: false };
    expect(utils.participantTotalMs(p)).toBe(5 * 60_000);
  });

  test('adds active session time for currently-present participants', () => {
    const now = new Date('2026-06-28T10:10:00Z').getTime();
    const p = {
      _accumulatedMs: 5 * 60_000, // 5 min from a prior session
      joinTime: new Date('2026-06-28T10:08:00Z'), // rejoined 2 min before "now"
      present: true,
    };
    expect(utils.participantTotalMs(p, now)).toBe(7 * 60_000); // 5 + 2
  });

  test('returns 0 active time if joinTime is in the future (clock skew)', () => {
    const now = new Date('2026-06-28T10:00:00Z').getTime();
    const p = {
      _accumulatedMs: 0,
      joinTime: new Date('2026-06-28T10:05:00Z'), // future relative to now
      present: true,
    };
    expect(utils.participantTotalMs(p, now)).toBe(0); // Math.max guard
  });

  test('accepts ISO string joinTime', () => {
    const now = new Date('2026-06-28T10:10:00Z').getTime();
    const p = { _accumulatedMs: 0, joinTime: '2026-06-28T10:00:00Z', present: true };
    expect(utils.participantTotalMs(p, now)).toBe(10 * 60_000);
  });

  test('defaults now to Date.now() when not provided', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-06-28T10:10:00Z'));
    const p = { _accumulatedMs: 0, joinTime: new Date('2026-06-28T10:00:00Z'), present: true };
    expect(utils.participantTotalMs(p)).toBe(10 * 60_000);
    jest.useRealTimers();
  });
});

// ════════════════════════════════════════════════════════════════════
// isSelfParticipant — three-strategy self-presence detection
// ════════════════════════════════════════════════════════════════════
describe('isSelfParticipant', () => {
  test('false when ctx is missing', () => {
    expect(utils.isSelfParticipant({ displayName: 'Alex' }, null)).toBe(false);
    expect(utils.isSelfParticipant({ displayName: 'Alex' }, undefined)).toBe(false);
  });

  test('false when participant is missing', () => {
    expect(utils.isSelfParticipant(null, { selfEmail: 'me@x.com' })).toBe(false);
  });

  test('true via emailMatch (incoming email)', () => {
    expect(utils.isSelfParticipant(
      { email: 'Me@Example.COM', displayName: 'Someone Else' },
      { selfEmail: 'me@example.com' },
    )).toBe(true);
  });

  test('true via emailMatch (existing stored email)', () => {
    // Incoming has no email, but we have one already stored on the participant.
    expect(utils.isSelfParticipant(
      { email: '', existingEmail: 'me@x.com', displayName: 'Different Name' },
      { selfEmail: 'me@x.com' },
    )).toBe(true);
  });

  test('true via nameMatch when emails differ', () => {
    expect(utils.isSelfParticipant(
      { email: '', displayName: 'Alex Smith' },
      { selfEmail: 'me@x.com', selfDisplayName: 'alex smith' },
    )).toBe(true);
  });

  test('true via soloMatch — signed in alone in the meeting', () => {
    expect(utils.isSelfParticipant(
      { displayName: 'Unknown Person' },
      { signedIn: true, participantCount: 1, incomingCount: 1 },
    )).toBe(true);
  });

  test('false via soloMatch when not signed in', () => {
    expect(utils.isSelfParticipant(
      { displayName: 'X' },
      { signedIn: false, participantCount: 1, incomingCount: 1 },
    )).toBe(false);
  });

  test('false via soloMatch when 2+ participants', () => {
    expect(utils.isSelfParticipant(
      { displayName: 'X' },
      { signedIn: true, participantCount: 2, incomingCount: 2 },
    )).toBe(false);
  });

  test('false when no strategy matches', () => {
    expect(utils.isSelfParticipant(
      { email: 'someone@x.com', displayName: 'Random Guest' },
      {
        selfEmail: 'me@x.com',
        selfDisplayName: 'My Name',
        signedIn: true,
        participantCount: 5,
        incomingCount: 5,
      },
    )).toBe(false);
  });

  test('email matching is case-insensitive both ways', () => {
    expect(utils.isSelfParticipant(
      { email: 'CAPS@X.COM' },
      { selfEmail: 'caps@x.com' },
    )).toBe(true);
    expect(utils.isSelfParticipant(
      { email: 'caps@x.com' },
      { selfEmail: 'CAPS@X.COM' },
    )).toBe(true);
  });

  test('empty/null selfEmail does not match empty/null participant email (no false positives)', () => {
    expect(utils.isSelfParticipant(
      { email: '', displayName: 'X' },
      { selfEmail: '', signedIn: false },
    )).toBe(false);
  });
});
