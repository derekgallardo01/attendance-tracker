// Shared-contract guard: the frontend AttUtils.distinctAttendees (js/utils.js)
// and the backend countDistinctAttendees (services/firestore.js) MUST agree —
// they're the same "real meeting" signal computed on both sides of the wire,
// and they can't share code (utils.js is a browser module the backend can't
// import). Runs in the backend/node project so it can require both.
const utils = require('../../../js/utils.js');
const { countDistinctAttendees } = require('../../src/services/firestore');

const CASES = [
  [],
  [{ email: 'a@x.com', displayName: 'A' }],
  [{ email: 'a@x.com', displayName: 'A' }, { email: 'A@x.com', displayName: 'A (phone)' }], // same email, diff case
  [{ email: '', displayName: 'Darlene Diaz' }, { email: '', displayName: 'Darlene Diaz' }], // phantom rejoin
  [{ email: '', displayName: 'darlene diaz' }, { email: '', displayName: 'Darlene Diaz' }], // name case-insensitive
  [{ email: '', displayName: 'Alex' }, { email: '', displayName: 'Sam' }],                  // two real people
  [{ email: '', displayName: '' }],                                                          // no identity → 0
  [{ email: ' A@X.com ', displayName: '' }, { email: '', displayName: ' alex ' }],           // trimming
];

describe('distinct-attendee contract (frontend utils ↔ backend firestore)', () => {
  test.each(CASES.map((c, i) => [i, c]))('case %i: FE and BE produce the same count', (_i, participants) => {
    expect(utils.distinctAttendees(participants)).toBe(countDistinctAttendees(participants));
  });
});
