// Tests for the atomic Firestore claim helpers — these prevent double-sends
// of alert and re-engagement emails. The whole "fire once per day per user"
// guarantee depends on Firestore create() throwing ALREADY_EXISTS. Breaking
// these = users get hammered with duplicate emails.

const { installFirestoreMock } = require('../helpers/firestoreMock');

let ctx, firestore;

beforeEach(() => {
  ctx = installFirestoreMock();
  firestore = require('../../src/services/firestore');
});

afterEach(() => {
  ctx.uninstall();
});

describe('claimDailyAlertSlot', () => {
  test('first call returns claimed:true', async () => {
    const result = await firestore.claimDailyAlertSlot('acme.com', 'user@acme.com');
    expect(result.claimed).toBe(true);
    expect(result.ref).toBeDefined();
  });

  test('second call same user same day returns claimed:false', async () => {
    const first = await firestore.claimDailyAlertSlot('acme.com', 'user@acme.com');
    expect(first.claimed).toBe(true);
    const second = await firestore.claimDailyAlertSlot('acme.com', 'user@acme.com');
    expect(second.claimed).toBe(false);
  });

  test('different users on same day each get claimed:true', async () => {
    const a = await firestore.claimDailyAlertSlot('acme.com', 'a@acme.com');
    const b = await firestore.claimDailyAlertSlot('acme.com', 'b@acme.com');
    expect(a.claimed).toBe(true);
    expect(b.claimed).toBe(true);
  });

  test('case-insensitive email — UPPER and lower share one slot', async () => {
    const lower = await firestore.claimDailyAlertSlot('acme.com', 'user@acme.com');
    const upper = await firestore.claimDailyAlertSlot('acme.com', 'USER@ACME.COM');
    expect(lower.claimed).toBe(true);
    expect(upper.claimed).toBe(false);
  });

  test('different domains: claims are independent', async () => {
    const acme = await firestore.claimDailyAlertSlot('acme.com', 'shared@example.com');
    const beta = await firestore.claimDailyAlertSlot('beta.com', 'shared@example.com');
    expect(acme.claimed).toBe(true);
    expect(beta.claimed).toBe(true);
  });

  test('dedup doc id includes the date — old days persist without blocking', async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Manually seed an old day's claim
    ctx.seed(`tenants/acme.com/alertsSent/2026-01-01-user@acme.com`, {
      email: 'user@acme.com', domain: 'acme.com',
    });
    // Today's claim should succeed
    const today_claim = await firestore.claimDailyAlertSlot('acme.com', 'user@acme.com');
    expect(today_claim.claimed).toBe(true);
    // Verify doc id format
    expect(ctx.read(`tenants/acme.com/alertsSent/${today}-user@acme.com`)).toBeDefined();
  });
});

describe('claimReengagementSlot', () => {
  test('first call with a key returns claimed:true', async () => {
    const result = await firestore.claimReengagementSlot('acme.com', 'user@acme.com', 'reactivation_7d');
    expect(result.claimed).toBe(true);
  });

  test('second call same key returns claimed:false (permanent dedup, no day suffix)', async () => {
    await firestore.claimReengagementSlot('acme.com', 'user@acme.com', 'reactivation_7d');
    const second = await firestore.claimReengagementSlot('acme.com', 'user@acme.com', 'reactivation_7d');
    expect(second.claimed).toBe(false);
  });

  test('different dedupKey for same user can each claim once', async () => {
    const r1 = await firestore.claimReengagementSlot('acme.com', 'user@acme.com', 'reactivation_7d');
    const r2 = await firestore.claimReengagementSlot('acme.com', 'user@acme.com', 'reactivation_30d');
    const r3 = await firestore.claimReengagementSlot('acme.com', 'user@acme.com', 'forgotten_meeting:series-x');
    expect(r1.claimed).toBe(true);
    expect(r2.claimed).toBe(true);
    expect(r3.claimed).toBe(true);
  });

  test('persists across days (no time component in dedup key)', async () => {
    // Unlike claimDailyAlertSlot, reengagement claims are permanent. Even if
    // a year passes, the same key can't be claimed again.
    await firestore.claimReengagementSlot('acme.com', 'user@acme.com', 'reactivation_7d');
    // Simulate "later" — no time advance needed because the mock dedup key
    // doesn't include a date.
    const later = await firestore.claimReengagementSlot('acme.com', 'user@acme.com', 'reactivation_7d');
    expect(later.claimed).toBe(false);
  });

  test('case-insensitive on email portion of dedup key', async () => {
    await firestore.claimReengagementSlot('acme.com', 'user@acme.com', 'reactivation_7d');
    const upper = await firestore.claimReengagementSlot('acme.com', 'USER@ACME.COM', 'reactivation_7d');
    expect(upper.claimed).toBe(false);
  });
});
