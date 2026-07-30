// Pure logic for the side panel's demo/simulation mode (index.html), extracted
// so the schedule generation and the deterministic "who is present at time T"
// snapshot can be unit-tested. Demo-only — never runs during real tracking —
// but participantsAt is the demo mirror of real attendance, worth testing.
//
// Exposed as both `window.AttSim` (browser) and `module.exports` (Jest),
// mirroring js/utils.js. rng is injectable so the randomised builders can be
// tested deterministically; callers pass none and it defaults to Math.random.

(function (root) {
  'use strict';

  // Randomised join delay (seconds) by arrival cohort (early birds → stragglers).
  function joinDelay(index, total, rng) {
    const r = rng || Math.random;
    const pct = index / total;
    if (pct < 0.1) return r() * 60;          // early birds: 0–60s
    if (pct < 0.5) return 60 + r() * 120;    // main wave: 1–3 min
    if (pct < 0.8) return 180 + r() * 120;   // on-time: 3–5 min
    return 300 + r() * 300;                   // stragglers: 5–10 min
  }

  // Build a randomised join/leave/rejoin schedule for `count` people drawn from
  // `names` ([{ name, email }, …]).
  function buildSchedule(names, count, rng) {
    const r = rng || Math.random;
    const shuffled = [...names].sort(() => r() - 0.5).slice(0, count);
    return shuffled.map((person, i) => {
      const jd = joinDelay(i, count, r);
      const willLeave = r() < 0.2;
      const leaveDelay = willLeave ? jd + 300 + r() * 600 : null;
      const willRejoin = willLeave && r() < 0.5;
      const rejoinDelay = willRejoin ? leaveDelay + 120 + r() * 180 : null;
      return {
        displayName: person.name,
        email: person.email,
        participantId: `sim/participants/${i}`,
        joinDelay: jd,
        leaveDelay,
        rejoinDelay,
        sessions: willRejoin ? 2 : 1,
      };
    });
  }

  // Deterministic snapshot: given a schedule `pool`, the sim base time (ms), and
  // elapsed simulated seconds, return the participant list the poller would see.
  function participantsAt(pool, baseTimeMs, elapsedSec) {
    const participants = [];
    for (const p of pool) {
      if (elapsedSec < p.joinDelay) continue; // hasn't joined yet
      const joinTime = new Date(baseTimeMs + p.joinDelay * 1000);
      let present = true;
      let leaveTime = null;
      let sessions = 1;
      if (p.leaveDelay && elapsedSec >= p.leaveDelay) {
        leaveTime = new Date(baseTimeMs + p.leaveDelay * 1000);
        present = false;
        if (p.rejoinDelay && elapsedSec >= p.rejoinDelay) {
          present = true;
          leaveTime = null;
          sessions = 2;
        }
      }
      participants.push({
        participantId: p.participantId,
        displayName: p.displayName,
        email: p.email,
        joinTime: joinTime.toISOString(),
        leaveTime: leaveTime ? leaveTime.toISOString() : null,
        present,
        sessions,
      });
    }
    return { participants };
  }

  const api = { joinDelay, buildSchedule, participantsAt };
  root.AttSim = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
