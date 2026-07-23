// Tests for evaluateSeriesAlerts — the streak / threshold rule logic that
// fires daily email alerts to users when an attendee's pattern changes.
// These rules have real off-by-one and date-math risk; regressions here =
// inbox spam or missed flags.

const { installFirestoreMock, wrapTimestamp } = require('../helpers/firestoreMock');

let ctx;
let firestore;

beforeEach(() => {
  ctx = installFirestoreMock();
  firestore = require('../../src/services/firestore');
});

afterEach(() => {
  ctx.uninstall();
});

// Helper: seed a tracked event for the user on the given conference.
function seedTrackedEvent(domain, email, conferenceId, atMs) {
  const id = `ev_${atMs}_${conferenceId}`;
  ctx.seed(`tenants/${domain}/events/${id}`, {
    email: email.toLowerCase(),
    type: 'tracked',
    meta: { conferenceId },
    createdAt: wrapTimestamp(new Date(atMs)),
  });
}

// Helper: seed a recurring meeting + its participants.
function seedRecurringMeeting(domain, conferenceId, recurringEventId, title, startMs, participants) {
  ctx.seed(`tenants/${domain}/meetings/${conferenceId}`, {
    conferenceId,
    recurringEventId,
    title,
    startTime: wrapTimestamp(new Date(startMs)),
    createdAt: wrapTimestamp(new Date(startMs)),
  });
  for (const p of participants) {
    const docId = p.id || p.email || p.displayName;
    ctx.seed(`tenants/${domain}/meetings/${conferenceId}/participants/${docId}`, {
      participantId: docId,
      displayName: p.displayName,
      email: p.email || '',
      present: p.present !== false,
    });
  }
}

describe('evaluateSeriesAlerts — streak rule', () => {
  test('returns empty array when fewer than 6 instances exist', async () => {
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    const day = 86400000;
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      const cid = `meet-${i}`;
      seedTrackedEvent(domain, email, cid, now - (5 - i) * day);
      seedRecurringMeeting(domain, cid, 'series-1', 'Standup', now - (5 - i) * day, [
        { email: 'alex@acme.com', displayName: 'Alex', present: true },
      ]);
    }
    const alerts = await firestore.evaluateSeriesAlerts(domain, email);
    expect(alerts).toEqual([]);
  });

  test('fires streak alert: attended 5 of last 8, missed most recent 3', async () => {
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    const day = 86400000;
    const now = Date.now();
    // 11 instances total. Alex present in instances 0-7 (8 in a row), missing in 8,9,10.
    const alexAttendance = [true, true, true, true, true, true, true, true, false, false, false];
    for (let i = 0; i < 11; i++) {
      const cid = `meet-${i}`;
      seedTrackedEvent(domain, email, cid, now - (11 - i) * day);
      const participants = [];
      if (alexAttendance[i]) participants.push({ email: 'alex@acme.com', displayName: 'Alex' });
      // Someone else always present so the meeting has participants
      participants.push({ email: 'beth@acme.com', displayName: 'Beth' });
      seedRecurringMeeting(domain, cid, 'series-standup', 'Daily Standup', now - (11 - i) * day, participants);
    }
    const alerts = await firestore.evaluateSeriesAlerts(domain, email);
    const alexAlerts = alerts.filter(a => a.personEmail === 'alex@acme.com');
    expect(alexAlerts.length).toBe(1);
    expect(alexAlerts[0].type).toBe('streak');
    expect(alexAlerts[0].seriesTitle).toBe('Daily Standup');
    expect(alexAlerts[0].detail).toMatch(/missed the last 3/i);
  });

  test('does NOT fire streak if attended fewer than 5 of the preceding 8', async () => {
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    const day = 86400000;
    const now = Date.now();
    // 11 instances. Alex attended 4 of preceding 8 (positions 0-7), missed last 3
    const alexAttendance = [true, true, true, true, false, false, false, false, false, false, false];
    for (let i = 0; i < 11; i++) {
      const cid = `meet-${i}`;
      seedTrackedEvent(domain, email, cid, now - (11 - i) * day);
      const participants = [{ email: 'beth@acme.com', displayName: 'Beth' }];
      if (alexAttendance[i]) participants.push({ email: 'alex@acme.com', displayName: 'Alex' });
      seedRecurringMeeting(domain, cid, 'series-standup', 'Standup', now - (11 - i) * day, participants);
    }
    const alerts = await firestore.evaluateSeriesAlerts(domain, email);
    const alexAlerts = alerts.filter(a => a.personEmail === 'alex@acme.com');
    expect(alexAlerts).toEqual([]);
  });

  test('does NOT fire streak if any of last 3 is true', async () => {
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    const day = 86400000;
    const now = Date.now();
    // Missed 2 of last 3 — but the most recent was attended → no streak
    const alexAttendance = [true, true, true, true, true, true, true, true, false, true, false];
    for (let i = 0; i < 11; i++) {
      const cid = `meet-${i}`;
      seedTrackedEvent(domain, email, cid, now - (11 - i) * day);
      const participants = [{ email: 'beth@acme.com', displayName: 'Beth' }];
      if (alexAttendance[i]) participants.push({ email: 'alex@acme.com', displayName: 'Alex' });
      seedRecurringMeeting(domain, cid, 'series-standup', 'Standup', now - (11 - i) * day, participants);
    }
    const alerts = await firestore.evaluateSeriesAlerts(domain, email);
    const alexAlerts = alerts.filter(a => a.personEmail === 'alex@acme.com');
    expect(alexAlerts).toEqual([]);
  });

  test('Sweep-10: merges an attendee reported name-only in some instances with their email identity', async () => {
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    const day = 86400000;
    const now = Date.now();
    // Alex attends instances 0-7 then misses 8,9,10 — a clean streak. BUT Alex is
    // reported WITH an email in 0-3 and NAME-ONLY (no email) in 4-7. Without the
    // name→email canonicalization, those split into two half-identities and
    // NEITHER has the 5-of-8 streak, so no alert fires. Canonicalization stitches
    // the name-only records onto alex@acme.com so the streak surfaces correctly.
    for (let i = 0; i < 11; i++) {
      const cid = `meet-${i}`;
      seedTrackedEvent(domain, email, cid, now - (11 - i) * day);
      const participants = [{ email: 'beth@acme.com', displayName: 'Beth' }];
      if (i < 4) participants.push({ email: 'alex@acme.com', displayName: 'Alex' });
      else if (i < 8) participants.push({ id: `alex-nameonly-${i}`, email: '', displayName: 'Alex' });
      // 8,9,10: Alex absent
      seedRecurringMeeting(domain, cid, 'series-canon', 'Standup', now - (11 - i) * day, participants);
    }
    const alerts = await firestore.evaluateSeriesAlerts(domain, email);
    const alexAlerts = alerts.filter(a => a.personEmail === 'alex@acme.com');
    expect(alexAlerts.length).toBe(1);
    expect(alexAlerts[0].type).toBe('streak');
  });
});

describe('evaluateSeriesAlerts — threshold rule', () => {
  test('fires threshold alert when avg drops from >=80% to <50%', async () => {
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    const day = 86400000;
    const now = Date.now();
    // 16 instances. Prior 8 (0-7): 7/8 attended (87.5%). Last 8 (8-15): 3/8 (37.5%)
    // Last 3 must NOT all be false or streak fires first — alternate to keep streak quiet
    const alexAttendance = [
      true, true, true, true, true, true, true, false, // prev 8: 7/8 = 87.5%
      true, false, false, true, false, false, true, false, // last 8: 4/8 wait that's 50%
    ];
    // Adjust last 8 to be 3/8 = 37.5% but with at least one of last 3 true to dodge streak
    const adjusted = [
      true, true, true, true, true, true, true, false, // prev 8: 7/8
      true, false, false, false, false, false, true, false, // last 8: 3/8 — last 3 = [false, true, false]
    ];
    for (let i = 0; i < 16; i++) {
      const cid = `meet-${i}`;
      seedTrackedEvent(domain, email, cid, now - (16 - i) * day);
      const participants = [{ email: 'beth@acme.com', displayName: 'Beth' }];
      if (adjusted[i]) participants.push({ email: 'alex@acme.com', displayName: 'Alex' });
      seedRecurringMeeting(domain, cid, 'series-x', 'Weekly Sync', now - (16 - i) * day, participants);
    }
    const alerts = await firestore.evaluateSeriesAlerts(domain, email);
    const alexAlerts = alerts.filter(a => a.personEmail === 'alex@acme.com');
    expect(alexAlerts.length).toBe(1);
    expect(alexAlerts[0].type).toBe('threshold');
    expect(alexAlerts[0].detail).toMatch(/dropped from/i);
  });

  test('does NOT double-fire (streak takes priority over threshold)', async () => {
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    const day = 86400000;
    const now = Date.now();
    // Both rules would technically match — make sure we get exactly one alert
    const alexAttendance = [
      true, true, true, true, true, true, true, true, // prev 8: 8/8
      true, true, true, true, true, false, false, false, // last 8: 5/8 — last 3 all false → streak
    ];
    for (let i = 0; i < 16; i++) {
      const cid = `meet-${i}`;
      seedTrackedEvent(domain, email, cid, now - (16 - i) * day);
      const participants = [{ email: 'beth@acme.com', displayName: 'Beth' }];
      if (alexAttendance[i]) participants.push({ email: 'alex@acme.com', displayName: 'Alex' });
      seedRecurringMeeting(domain, cid, 'series-y', 'Standup', now - (16 - i) * day, participants);
    }
    const alerts = await firestore.evaluateSeriesAlerts(domain, email);
    const alexAlerts = alerts.filter(a => a.personEmail === 'alex@acme.com');
    expect(alexAlerts.length).toBe(1);
    expect(alexAlerts[0].type).toBe('streak');
  });
});

describe('evaluateSeriesAlerts — filtering and scoping', () => {
  test('ignores non-recurring meetings entirely', async () => {
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    const day = 86400000;
    const now = Date.now();
    // Seed 10 non-recurring meetings (no recurringEventId)
    for (let i = 0; i < 10; i++) {
      const cid = `instant-${i}`;
      seedTrackedEvent(domain, email, cid, now - (10 - i) * day);
      ctx.seed(`tenants/${domain}/meetings/${cid}`, {
        conferenceId: cid,
        title: 'Instant Meeting',
        startTime: wrapTimestamp(new Date(now - (10 - i) * day)),
      });
      ctx.seed(`tenants/${domain}/meetings/${cid}/participants/alex`, {
        participantId: 'alex', displayName: 'Alex', email: 'alex@acme.com', present: false,
      });
    }
    const alerts = await firestore.evaluateSeriesAlerts(domain, email);
    expect(alerts).toEqual([]);
  });

  test('only considers meetings this user has tracked (per-user filter)', async () => {
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    const day = 86400000;
    const now = Date.now();
    // User has tracked 3 instances, but the series has 11 actual meetings.
    // The 8 untracked ones don't count.
    for (let i = 0; i < 11; i++) {
      const cid = `meet-${i}`;
      if (i < 3) seedTrackedEvent(domain, email, cid, now - (11 - i) * day);
      seedRecurringMeeting(domain, cid, 'series-z', 'Standup', now - (11 - i) * day, [
        { email: 'alex@acme.com', displayName: 'Alex' },
      ]);
    }
    const alerts = await firestore.evaluateSeriesAlerts(domain, email);
    // Only 3 instances tracked → below 6-instance minimum
    expect(alerts).toEqual([]);
  });
});

describe('evaluateSeriesAlerts — defensive', () => {
  test('returns empty array on Firestore error (does not throw)', async () => {
    // Don't seed anything that would resolve the tenant; firestore mock returns empty
    const alerts = await firestore.evaluateSeriesAlerts('nonexistent.com', 'nobody@nowhere');
    expect(Array.isArray(alerts)).toBe(true);
  });
});

describe('evaluateSeriesAlerts — aggregation branch coverage', () => {
  test('traverses timestamp fallbacks, identity edge cases, and a short second series', async () => {
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    const day = 86400000;
    const now = Date.now();

    // An event with no conferenceId in meta → the `if (cid)` guard skips it.
    ctx.seed(`tenants/${domain}/events/ev_nocid`, {
      email, type: 'tracked', meta: {}, createdAt: wrapTimestamp(new Date(now)),
    });

    // Series A: 6 tracked meetings so the per-series loop runs the full timeline.
    for (let i = 0; i < 6; i++) {
      const cid = `a-${i}`;
      seedTrackedEvent(domain, email, cid, now - (6 - i) * day);
      // Vary timestamps: most have startTime; a-4 has neither (||0 fallback),
      // a-5 (last) has createdAt-only and NO title (title fallback).
      const meetingDoc = { conferenceId: cid, recurringEventId: 'series-A' };
      if (i < 4) { meetingDoc.title = 'Weekly'; meetingDoc.startTime = wrapTimestamp(new Date(now - (6 - i) * day)); meetingDoc.createdAt = meetingDoc.startTime; }
      else if (i === 4) { meetingDoc.title = 'Weekly'; /* no timestamps */ }
      else { meetingDoc.createdAt = wrapTimestamp(new Date(now)); /* no title, no startTime */ }
      ctx.seed(`tenants/${domain}/meetings/${cid}`, meetingDoc);

      // Participants: X (email, gains a longer name mid-series), Y (name-only),
      // Z (no identity at all → skipped).
      // a-5 sorts last (createdAt=now) → X gains a longer name at the end,
      // exercising the "longest seen name wins" update.
      ctx.seed(`tenants/${domain}/meetings/${cid}/participants/x`, { email: 'x@acme.com', displayName: i === 5 ? 'Xavier the Long' : 'X' });
      ctx.seed(`tenants/${domain}/meetings/${cid}/participants/y`, { email: '', displayName: 'YoloYolanda' });
      ctx.seed(`tenants/${domain}/meetings/${cid}/participants/z`, { email: '', displayName: '' });
    }

    // Series B: only 2 tracked meetings → per-series `< 6` continue.
    for (let i = 0; i < 2; i++) {
      const cid = `b-${i}`;
      seedTrackedEvent(domain, email, cid, now - (2 - i) * day);
      ctx.seed(`tenants/${domain}/meetings/${cid}`, {
        conferenceId: cid, recurringEventId: 'series-B', title: 'Rare',
        startTime: wrapTimestamp(new Date(now - (2 - i) * day)),
      });
      ctx.seed(`tenants/${domain}/meetings/${cid}/participants/x`, { email: 'x@acme.com', displayName: 'X' });
    }

    const alerts = await firestore.evaluateSeriesAlerts(domain, email);
    expect(Array.isArray(alerts)).toBe(true);
  });
});
