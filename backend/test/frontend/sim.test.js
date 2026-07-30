/**
 * @jest-environment jsdom
 *
 * Tests for the demo/simulation logic in js/sim.js (extracted from index.html).
 * The randomised builders take an injectable rng so they are deterministic here;
 * participantsAt is pure time-math (the demo mirror of real attendance).
 */

const path = require('path');
const sim = require(path.join(__dirname, '..', '..', '..', 'js', 'sim.js'));

describe('joinDelay (rng injected)', () => {
  const r0 = () => 0;   // rng returns 0 → the base of each cohort's window
  const r1 = () => 0.999999;

  test('buckets by arrival cohort using the rng floor', () => {
    expect(sim.joinDelay(0, 100, r0)).toBe(0);      // pct 0 → early birds, base 0
    expect(sim.joinDelay(20, 100, r0)).toBe(60);    // pct .2 → main wave, base 60
    expect(sim.joinDelay(60, 100, r0)).toBe(180);   // pct .6 → on-time, base 180
    expect(sim.joinDelay(90, 100, r0)).toBe(300);   // pct .9 → stragglers, base 300
  });

  test('rng near 1 reaches the top of each window', () => {
    expect(sim.joinDelay(0, 100, r1)).toBeCloseTo(60, 0);     // 0..60
    expect(sim.joinDelay(20, 100, r1)).toBeCloseTo(180, 0);   // 60..180
  });

  test('defaults rng to Math.random when omitted (stays in range)', () => {
    const d = sim.joinDelay(0, 100);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(d).toBeLessThanOrEqual(60);
  });
});

describe('buildSchedule (rng injected)', () => {
  const names = [
    { name: 'A', email: 'a@x.com' }, { name: 'B', email: 'b@x.com' }, { name: 'C', email: 'c@x.com' },
  ];

  test('everyone stays (rng ≥ 0.2 for the leave roll) → single session, no leave', () => {
    const pool = sim.buildSchedule(names, 3, () => 0.5); // 0.5 !< 0.2 → willLeave false
    expect(pool).toHaveLength(3);
    for (const p of pool) {
      expect(p.sessions).toBe(1);
      expect(p.leaveDelay).toBeNull();
      expect(p.rejoinDelay).toBeNull();
      expect(p.participantId).toMatch(/^sim\/participants\/\d$/);
      expect(typeof p.joinDelay).toBe('number');
    }
  });

  test('everyone leaves and rejoins (rng = 0 → both rolls fire) → 2 sessions', () => {
    const pool = sim.buildSchedule(names, 3, () => 0); // 0 < 0.2 leave, 0 < 0.5 rejoin
    for (const p of pool) {
      expect(p.sessions).toBe(2);
      expect(p.leaveDelay).not.toBeNull();
      expect(p.rejoinDelay).not.toBeNull();
      expect(p.rejoinDelay).toBeGreaterThan(p.leaveDelay);
    }
  });

  test('caps at count', () => {
    expect(sim.buildSchedule(names, 2, () => 0.5)).toHaveLength(2);
  });

  test('defaults rng to Math.random when omitted', () => {
    const pool = sim.buildSchedule(names, 3);
    expect(pool).toHaveLength(3);
    for (const p of pool) expect(typeof p.joinDelay).toBe('number');
  });
});

describe('participantsAt (deterministic snapshot)', () => {
  const base = 1_000_000_000_000; // fixed epoch ms
  const pool = [
    { participantId: 'p/0', displayName: 'Early', email: 'e@x.com', joinDelay: 0, leaveDelay: null, rejoinDelay: null },
    { participantId: 'p/1', displayName: 'Leaver', email: 'l@x.com', joinDelay: 60, leaveDelay: 600, rejoinDelay: null },
    { participantId: 'p/2', displayName: 'Rejoiner', email: 'r@x.com', joinDelay: 60, leaveDelay: 600, rejoinDelay: 900 },
    { participantId: 'p/3', displayName: 'Late', email: 'n@x.com', joinDelay: 1200, leaveDelay: null, rejoinDelay: null },
  ];

  test('excludes people who have not joined yet', () => {
    const { participants } = sim.participantsAt(pool, base, 30); // 30s in
    expect(participants.map(p => p.displayName)).toEqual(['Early']); // only joinDelay ≤ 30
  });

  test('present members carry an ISO joinTime and no leaveTime', () => {
    const { participants } = sim.participantsAt(pool, base, 120);
    const early = participants.find(p => p.displayName === 'Early');
    expect(early.present).toBe(true);
    expect(early.leaveTime).toBeNull();
    expect(early.joinTime).toBe(new Date(base).toISOString());
  });

  test('after leaveDelay (no rejoin) → present:false with a leaveTime', () => {
    const { participants } = sim.participantsAt(pool, base, 700); // past Leaver's 600 leave
    const leaver = participants.find(p => p.displayName === 'Leaver');
    expect(leaver.present).toBe(false);
    expect(leaver.leaveTime).toBe(new Date(base + 600 * 1000).toISOString());
    expect(leaver.sessions).toBe(1);
  });

  test('after rejoinDelay → present again, leaveTime cleared, sessions:2', () => {
    const { participants } = sim.participantsAt(pool, base, 1000); // past Rejoiner's 900 rejoin
    const rj = participants.find(p => p.displayName === 'Rejoiner');
    expect(rj.present).toBe(true);
    expect(rj.leaveTime).toBeNull();
    expect(rj.sessions).toBe(2);
  });

  test('between leave and rejoin → still counted as left', () => {
    const { participants } = sim.participantsAt(pool, base, 700); // 600 ≤ 700 < 900
    const rj = participants.find(p => p.displayName === 'Rejoiner');
    expect(rj.present).toBe(false);
    expect(rj.sessions).toBe(1);
  });
});
