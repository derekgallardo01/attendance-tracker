// Unit tests for the pure Meet-participant helpers. The Participant resource
// is a oneof of signedinUser / anonymousUser / phoneUser — there is no `user`
// field, and before these helpers every guest and dial-in collapsed into one
// merged "Unknown" person.

const { participantIdentity, sessionsDurationMs } = require('../../src/services/meetApi');

describe('participantIdentity', () => {
  test('signed-in user: name + email', () => {
    expect(participantIdentity({ signedinUser: { displayName: 'Alex', email: 'a@x.com' } }))
      .toEqual({ displayName: 'Alex', email: 'a@x.com' });
  });

  test('anonymous guest: display name preserved, no email', () => {
    expect(participantIdentity({ anonymousUser: { displayName: 'Guest Parent' } }))
      .toEqual({ displayName: 'Guest Parent', email: '' });
  });

  test('dial-in: phone display name preserved', () => {
    expect(participantIdentity({ phoneUser: { displayName: '+1 555-0100' } }))
      .toEqual({ displayName: '+1 555-0100', email: '' });
  });

  test('nothing known → Unknown', () => {
    expect(participantIdentity({})).toEqual({ displayName: 'Unknown', email: '' });
    expect(participantIdentity(undefined)).toEqual({ displayName: 'Unknown', email: '' });
  });
});

describe('sessionsDurationMs', () => {
  const T0 = Date.parse('2026-09-09T10:00:00Z');

  test('sums closed sessions, ignoring the away-gap between them', () => {
    const sessions = [
      { startTime: '2026-09-09T10:00:00Z', endTime: '2026-09-09T10:05:00Z' }, // 5m
      { startTime: '2026-09-09T10:55:00Z', endTime: '2026-09-09T11:00:00Z' }, // 5m (50m away)
    ];
    expect(sessionsDurationMs(sessions)).toBe(10 * 60000); // NOT the 60m span
  });

  test('an open session counts up to now', () => {
    const sessions = [{ startTime: '2026-09-09T10:00:00Z' }];
    expect(sessionsDurationMs(sessions, T0 + 7 * 60000)).toBe(7 * 60000);
  });

  test('malformed / empty input → 0', () => {
    expect(sessionsDurationMs([])).toBe(0);
    expect(sessionsDurationMs(null)).toBe(0);
    expect(sessionsDurationMs([{ endTime: '2026-09-09T10:05:00Z' }])).toBe(0); // no start
    expect(sessionsDurationMs([{ startTime: 'garbage', endTime: 'also' }])).toBe(0);
    // end before start contributes nothing
    expect(sessionsDurationMs([{ startTime: '2026-09-09T10:05:00Z', endTime: '2026-09-09T10:00:00Z' }])).toBe(0);
  });
});
