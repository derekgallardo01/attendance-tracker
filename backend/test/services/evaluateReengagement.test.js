// Tests for evaluateReengagementForUser — the user-state windows that fire
// reactivation + forgotten-meeting emails. Three reminder types, each with
// narrow firing windows. Off-by-one here = either spam or missed signal.

const { installFirestoreMock, wrapTimestamp } = require('../helpers/firestoreMock');

let ctx, firestore;
const DAY = 86400000;

beforeEach(() => {
  ctx = installFirestoreMock();
  firestore = require('../../src/services/firestore');
});

afterEach(() => {
  ctx.uninstall();
});

function seedUser(domain, email, lastLoginAgoDays) {
  const lastLogin = lastLoginAgoDays != null
    ? wrapTimestamp(new Date(Date.now() - lastLoginAgoDays * DAY))
    : null;
  ctx.seed(`tenants/${domain}/users/${email.toLowerCase()}`, {
    email: email.toLowerCase(),
    domain,
    displayName: 'Test User',
    lastLoginAt: lastLogin,
  });
}

function seedTracked(domain, email, conferenceId, atMs, participantCount, distinctAttendees) {
  const id = `ev_${atMs}_${conferenceId}_${Math.random().toString(36).slice(2, 8)}`;
  const meta = { conferenceId, participantCount: participantCount != null ? participantCount : 1 };
  if (distinctAttendees != null) meta.distinctAttendees = distinctAttendees;
  ctx.seed(`tenants/${domain}/events/${id}`, {
    email: email.toLowerCase(),
    type: 'tracked',
    meta,
    createdAt: wrapTimestamp(new Date(atMs)),
  });
}

// Mark a user as "activated" (exported at least once) so the engagement gate
// lets reactivation fire. Without this a user has no value signal and only
// qualifies for the activation nudge.
function seedExport(domain, email, atMs) {
  const id = `ex_${atMs}_${Math.random().toString(36).slice(2, 8)}`;
  ctx.seed(`tenants/${domain}/events/${id}`, {
    email: email.toLowerCase(),
    type: 'exported',
    meta: {},
    createdAt: wrapTimestamp(new Date(atMs || Date.now())),
  });
}

function seedRecurringMeeting(domain, conferenceId, recurringEventId, title, startMs) {
  ctx.seed(`tenants/${domain}/meetings/${conferenceId}`, {
    conferenceId,
    recurringEventId,
    title,
    startTime: wrapTimestamp(new Date(startMs)),
  });
}

describe('evaluateReengagementForUser — reactivation_7d window', () => {
  test.each([
    [6,  false, '6 days = inside the 7-day grace, no fire'],
    [7,  true,  '7 days = lower bound, fires'],
    [10, true,  '10 days = inside window, fires'],
    [13, true,  '13 days = upper bound, fires'],
    [14, false, '14 days = exclusive upper, no fire'],
    [20, false, '20 days = past 7d window, no fire'],
  ])('lastLogin %i days ago → 7d reminder fires=%s (%s)', async (days, shouldFire) => {
    seedUser('acme.com', 'user@acme.com', days);
    seedExport('acme.com', 'user@acme.com'); // activated → reactivation eligible
    const r = await firestore.evaluateReengagementForUser('acme.com', 'user@acme.com');
    const has7d = r.some(x => x.type === 'reactivation_7d');
    expect(has7d).toBe(shouldFire);
  });
});

describe('evaluateReengagementForUser — reactivation_30d window', () => {
  test.each([
    [29, false, 'inside the gap between windows'],
    [30, true,  '30 days = lower bound, fires'],
    [37, true,  'middle of window, fires'],
    [44, true,  '44 days = upper bound, fires'],
    [45, false, '45 days = exclusive upper, no fire'],
    [90, false, 'past window, no fire'],
  ])('lastLogin %i days ago → 30d reminder fires=%s (%s)', async (days, shouldFire) => {
    seedUser('acme.com', 'user@acme.com', days);
    seedExport('acme.com', 'user@acme.com'); // activated → reactivation eligible
    const r = await firestore.evaluateReengagementForUser('acme.com', 'user@acme.com');
    const has30d = r.some(x => x.type === 'reactivation_30d');
    expect(has30d).toBe(shouldFire);
  });
});

describe('evaluateReengagementForUser — engagement gate (targeting)', () => {
  const D = 'acme.com';

  test('ACTIVATED via export: lapsed 10d → reactivation_7d (not activation)', async () => {
    seedUser(D, 'real@acme.com', 10);
    seedExport(D, 'real@acme.com');
    const r = await firestore.evaluateReengagementForUser(D, 'real@acme.com');
    expect(r.some(x => x.type === 'reactivation_7d')).toBe(true);
    expect(r.some(x => x.type === 'activation_7d')).toBe(false);
  });

  test('ACTIVATED via a real multi-person meeting (distinctAttendees>=2) → reactivation_7d', async () => {
    seedUser(D, 'host@acme.com', 10);
    seedTracked(D, 'host@acme.com', 'meet-x', Date.now() - 10 * DAY, 5, 5); // 5 distinct
    const r = await firestore.evaluateReengagementForUser(D, 'host@acme.com');
    expect(r.some(x => x.type === 'reactivation_7d')).toBe(true);
  });

  test('PHANTOM meeting (participantCount=2 but distinctAttendees=1) is NOT activated → solo nudge', async () => {
    // The Darlene-Diaz-twice case: raw count says 2, deduped says 1 human.
    seedUser(D, 'phantom@acme.com', 10);
    seedTracked(D, 'phantom@acme.com', 'meet-dup', Date.now() - 10 * DAY, 2, 1);
    const r = await firestore.evaluateReengagementForUser(D, 'phantom@acme.com');
    expect(r.some(x => x.type === 'reactivation_7d')).toBe(false);
    // Tracked but not activated → treated as a solo tester, not a signup.
    expect(r.some(x => x.type === 'solo_nudge_7d')).toBe(true);
    expect(r.some(x => x.type === 'activation_7d')).toBe(false);
  });

  test('legacy event without distinctAttendees falls back to participantCount', async () => {
    seedUser(D, 'legacy@acme.com', 10);
    seedTracked(D, 'legacy@acme.com', 'meet-old', Date.now() - 10 * DAY, 4); // no distinctAttendees
    const r = await firestore.evaluateReengagementForUser(D, 'legacy@acme.com');
    expect(r.some(x => x.type === 'reactivation_7d')).toBe(true);
  });

  test('NEVER TRACKED: lapsed 10d → activation_7d nudge (not reactivation)', async () => {
    seedUser(D, 'signup@acme.com', 10); // no events at all
    const r = await firestore.evaluateReengagementForUser(D, 'signup@acme.com');
    expect(r.some(x => x.type === 'activation_7d')).toBe(true);
    expect(r.some(x => x.type === 'reactivation_7d')).toBe(false);
  });

  test('SOLO-ONLY tester (tracked self, no export): gets solo_nudge_7d, not reactivation/activation', async () => {
    seedUser(D, 'solo@acme.com', 10);
    // Many tracked events but all solo (participantCount 1) and never exported.
    seedTracked(D, 'solo@acme.com', 'meet-solo', Date.now() - 10 * DAY, 1);
    seedTracked(D, 'solo@acme.com', 'meet-solo', Date.now() - 10 * DAY, 1);
    seedTracked(D, 'solo@acme.com', 'meet-solo', Date.now() - 10 * DAY, 1);
    const r = await firestore.evaluateReengagementForUser(D, 'solo@acme.com');
    expect(r.some(x => x.type === 'solo_nudge_7d')).toBe(true);
    expect(r.some(x => x.type === 'reactivation_7d')).toBe(false);
    expect(r.some(x => x.type === 'activation_7d')).toBe(false);
  });

  test('SOLO-ONLY tester lapsed 35d: no reminder (solo nudge is 7d-only, no 30d)', async () => {
    seedUser(D, 'solo30@acme.com', 35);
    seedTracked(D, 'solo30@acme.com', 'meet-solo', Date.now() - 35 * DAY, 1);
    const r = await firestore.evaluateReengagementForUser(D, 'solo30@acme.com');
    expect(r.some(x => x.type === 'reactivation_30d')).toBe(false);
    expect(r.some(x => x.type === 'solo_nudge_7d')).toBe(false);
    expect(r.some(x => x.type === 'activation_7d')).toBe(false);
  });
});

describe('evaluateReengagementForUser — forgotten_meeting', () => {
  test('fires when user tracked series 3+ times in 30 days but last was 7-9 days ago', async () => {
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    const now = Date.now();
    seedUser(domain, email, 1); // recent login so no reactivation reminders interfere
    // Three tracked events spaced ~7 days apart, most recent 8 days ago
    seedTracked(domain, email, 'meet-a', now - 22 * DAY);
    seedTracked(domain, email, 'meet-b', now - 15 * DAY);
    seedTracked(domain, email, 'meet-c', now - 8 * DAY);
    seedRecurringMeeting(domain, 'meet-a', 'series-x', 'Weekly Sync', now - 22 * DAY);
    seedRecurringMeeting(domain, 'meet-b', 'series-x', 'Weekly Sync', now - 15 * DAY);
    seedRecurringMeeting(domain, 'meet-c', 'series-x', 'Weekly Sync', now - 8 * DAY);

    const r = await firestore.evaluateReengagementForUser(domain, email);
    const forgotten = r.filter(x => x.type === 'forgotten_meeting');
    expect(forgotten.length).toBe(1);
    expect(forgotten[0].recurringEventId).toBe('series-x');
    expect(forgotten[0].trackedInWindow).toBe(3);
    expect(forgotten[0].seriesTitle).toBe('Weekly Sync');
  });

  test('does NOT fire when last tracking was <7 days ago', async () => {
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    const now = Date.now();
    seedUser(domain, email, 1);
    seedTracked(domain, email, 'meet-a', now - 22 * DAY);
    seedTracked(domain, email, 'meet-b', now - 15 * DAY);
    seedTracked(domain, email, 'meet-c', now - 4 * DAY); // too recent
    seedRecurringMeeting(domain, 'meet-a', 'series-x', 'Weekly', now - 22 * DAY);
    seedRecurringMeeting(domain, 'meet-b', 'series-x', 'Weekly', now - 15 * DAY);
    seedRecurringMeeting(domain, 'meet-c', 'series-x', 'Weekly', now - 4 * DAY);
    const r = await firestore.evaluateReengagementForUser(domain, email);
    expect(r.filter(x => x.type === 'forgotten_meeting')).toEqual([]);
  });

  test('does NOT fire when last tracking was 10+ days ago (outside catch window)', async () => {
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    const now = Date.now();
    seedUser(domain, email, 1);
    seedTracked(domain, email, 'meet-a', now - 30 * DAY);
    seedTracked(domain, email, 'meet-b', now - 20 * DAY);
    seedTracked(domain, email, 'meet-c', now - 11 * DAY); // past upper bound
    seedRecurringMeeting(domain, 'meet-a', 'series-x', 'Weekly', now - 30 * DAY);
    seedRecurringMeeting(domain, 'meet-b', 'series-x', 'Weekly', now - 20 * DAY);
    seedRecurringMeeting(domain, 'meet-c', 'series-x', 'Weekly', now - 11 * DAY);
    const r = await firestore.evaluateReengagementForUser(domain, email);
    expect(r.filter(x => x.type === 'forgotten_meeting')).toEqual([]);
  });

  test('requires 3+ events in past 30 days, not just 3 events ever', async () => {
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    const now = Date.now();
    seedUser(domain, email, 1);
    // 2 old events (outside 30-day window) + 1 recent
    seedTracked(domain, email, 'meet-a', now - 100 * DAY);
    seedTracked(domain, email, 'meet-b', now - 90 * DAY);
    seedTracked(domain, email, 'meet-c', now - 8 * DAY);
    seedRecurringMeeting(domain, 'meet-a', 'series-x', 'Weekly', now - 100 * DAY);
    seedRecurringMeeting(domain, 'meet-b', 'series-x', 'Weekly', now - 90 * DAY);
    seedRecurringMeeting(domain, 'meet-c', 'series-x', 'Weekly', now - 8 * DAY);
    const r = await firestore.evaluateReengagementForUser(domain, email);
    expect(r.filter(x => x.type === 'forgotten_meeting')).toEqual([]);
  });

  test('non-recurring meetings never produce forgotten_meeting alerts', async () => {
    const domain = 'acme.com';
    const email = 'admin@acme.com';
    const now = Date.now();
    seedUser(domain, email, 1);
    seedTracked(domain, email, 'meet-a', now - 22 * DAY);
    seedTracked(domain, email, 'meet-b', now - 15 * DAY);
    seedTracked(domain, email, 'meet-c', now - 8 * DAY);
    // Meetings exist but have no recurringEventId
    ctx.seed(`tenants/${domain}/meetings/meet-a`, { conferenceId: 'meet-a', title: 'Instant', startTime: wrapTimestamp(new Date(now - 22 * DAY)) });
    ctx.seed(`tenants/${domain}/meetings/meet-b`, { conferenceId: 'meet-b', title: 'Instant', startTime: wrapTimestamp(new Date(now - 15 * DAY)) });
    ctx.seed(`tenants/${domain}/meetings/meet-c`, { conferenceId: 'meet-c', title: 'Instant', startTime: wrapTimestamp(new Date(now - 8 * DAY)) });
    const r = await firestore.evaluateReengagementForUser(domain, email);
    expect(r.filter(x => x.type === 'forgotten_meeting')).toEqual([]);
  });
});

describe('evaluateReengagementForUser — defensive', () => {
  test('returns empty array when user does not exist', async () => {
    const r = await firestore.evaluateReengagementForUser('acme.com', 'ghost@acme.com');
    expect(r).toEqual([]);
  });

  test('handles missing lastLoginAt without throwing', async () => {
    ctx.seed('tenants/acme.com/users/user@acme.com', {
      email: 'user@acme.com',
      domain: 'acme.com',
      displayName: 'No-login User',
    });
    const r = await firestore.evaluateReengagementForUser('acme.com', 'user@acme.com');
    // Should return empty (no reactivation possible without lastLogin)
    expect(r.filter(x => x.type === 'reactivation_7d')).toEqual([]);
    expect(r.filter(x => x.type === 'reactivation_30d')).toEqual([]);
  });
});

describe('evaluateReengagementForUser — fallback branch coverage', () => {
  test('handles participantCount fallback, conferenceId/createdAt gaps, and a title-less forgotten series', async () => {
    const domain = 'acme.com';
    const email = 'lapsed@acme.com';
    const now = Date.now();
    seedUser(domain, email, 20); // 20d since login → outside reactivation windows

    // distinctAttendees absent → participantCount fallback; participantCount 0 → ||0.
    seedTracked(domain, email, 'cid-zero', now - DAY, 0, null);

    // A tracked event with neither conferenceId nor createdAt → the ||null / ||0
    // fallbacks fire, then it's filtered out (no conferenceId).
    ctx.seed(`tenants/${domain}/events/ev_raw`, { email, type: 'tracked', meta: {} });

    // Forgotten-meeting: same series tracked 3x ~8 days ago (inside the 7-10d
    // window), and the meeting doc has NO title → 'a recurring meeting' fallback.
    for (let i = 0; i < 3; i++) {
      seedTracked(domain, email, 'cid-fm', now - 8 * DAY + i * 1000, 2, 2);
    }
    ctx.seed(`tenants/${domain}/meetings/cid-fm`, { conferenceId: 'cid-fm', recurringEventId: 'rid-fm' }); // no title

    const reminders = await firestore.evaluateReengagementForUser(domain, email);
    const forgotten = reminders.find(r => r.type === 'forgotten_meeting');
    expect(forgotten).toBeDefined();
    expect(forgotten.seriesTitle).toBe('a recurring meeting');
  });
});

describe('evaluateReengagementForUser — not-activated window', () => {
  test('a solo tester lapsed 8 days gets solo_nudge_7d (activated=false path)', async () => {
    const domain = 'acme.com';
    const email = 'solo@acme.com';
    const now = Date.now();
    seedUser(domain, email, 8); // inside the 7-14 day window
    seedTracked(domain, email, 'cid-solo', now - 9 * DAY, 1, null); // solo, not activated
    const reminders = await firestore.evaluateReengagementForUser(domain, email);
    expect(reminders.some(r => r.type === 'solo_nudge_7d')).toBe(true);
  });
});

describe('evaluateReengagementForUser — 30-day window', () => {
  test('an activated user lapsed 35 days gets reactivation_30d (evaluates window30 fully)', async () => {
    const domain = 'acme.com';
    const email = 'winback@acme.com';
    const now = Date.now();
    seedUser(domain, email, 35);
    seedExport(domain, email, now - 40 * DAY); // activated
    const reminders = await firestore.evaluateReengagementForUser(domain, email);
    expect(reminders.some(r => r.type === 'reactivation_30d')).toBe(true);
  });
});

describe('evaluateReengagementForUser — missing meta', () => {
  test('tolerates a tracked event with no meta object (meta || {} fallback)', async () => {
    const domain = 'acme.com';
    const email = 'nometa@acme.com';
    const now = Date.now();
    seedUser(domain, email, 100); // no reactivation window
    ctx.seed(`tenants/${domain}/events/ev_nometa`, { email, type: 'tracked', createdAt: wrapTimestamp(new Date(now)) });
    const reminders = await firestore.evaluateReengagementForUser(domain, email);
    expect(Array.isArray(reminders)).toBe(true);
  });
});
