// Revenue ledger: pure session/invoice → payment mapping, idempotent writes,
// refund marking, and the founder revenue summary (cash vs MRR, owner and
// internal tenants excluded, regional currencies FX-estimated).

const { installFirestoreMock, wrapTimestamp } = require('../helpers/firestoreMock');

let ctx, payments;
const DAY = 86400000;
const SUPER_ADMIN = 'derekgallardo01@gmail.com';

beforeEach(() => {
  ctx = installFirestoreMock();
  payments = require('../../src/services/firestore/payments');
});

afterEach(() => ctx.uninstall());

function seedPayment(id, data, atMs = Date.now()) {
  ctx.seed(`payments/${id}`, { status: 'paid', ...data, createdAt: wrapTimestamp(new Date(atMs)) });
}

describe('resolvePaymentPlan', () => {
  const r = (args) => payments.resolvePaymentPlan(args);
  test('passes through unambiguous plans', () => {
    for (const p of ['single_meeting', 'lifetime', 'department', 'pro_monthly']) {
      expect(r({ plan: p })).toBe(p);
    }
  });
  test('pro_annual: subscription vs prepaid year', () => {
    expect(r({ plan: 'pro_annual', recurring: true })).toBe('pro_annual');
    expect(r({ plan: 'pro_annual', recurring: false })).toBe('pro_annual_prepaid');
  });
  test('educator: subscription vs regional one-time year', () => {
    expect(r({ plan: 'educator', recurring: true })).toBe('educator');
    expect(r({ plan: 'educator', recurring: false })).toBe('educator_annual');
  });
  test('team: annual subscription is Institution, one-time is the retired team pass', () => {
    expect(r({ plan: 'team', recurring: true })).toBe('institution');
    expect(r({ plan: 'team', recurring: false })).toBe('team');
  });
  test('plan-less sessions fall back on individual/recurring', () => {
    expect(r({ individual: true, recurring: false })).toBe('lifetime');
    expect(r({ individual: true, recurring: true })).toBe('individual_subscription');
    expect(r({ individual: false, recurring: true })).toBe('institution');
    expect(r({ individual: false, recurring: false })).toBe('team');
  });
});

describe('usdCents / approxUsdCents', () => {
  test('USD charges are exact; Adaptive Pricing uses the conversion block', () => {
    expect(payments.usdCents(999, 'USD', null)).toBe(999);
    expect(payments.usdCents(999, null, null)).toBeNull();
    expect(payments.usdCents(56000, 'php', { source_currency: 'usd', amount_total: 999 })).toBe(999);
    expect(payments.usdCents(56000, 'php', { source_currency: 'usd', amount_total: null })).toBeNull();
    expect(payments.usdCents(56000, 'php', { source_currency: null, amount_total: 999 })).toBeNull();
    expect(payments.usdCents(56000, 'php', { source_currency: 'eur', amount_total: 900 })).toBeNull();
    expect(payments.usdCents(28000, 'php', null)).toBeNull();
    expect(payments.usdCents(null, 'usd', null)).toBeNull();
  });
  test('approx falls back to the FX table, null for unknown currencies', () => {
    expect(payments.approxUsdCents({ amountUsd: 500 })).toBe(500);
    expect(payments.approxUsdCents({ amount: 28000, currency: 'php' })).toBe(482);
    expect(payments.approxUsdCents({ amount: 100, currency: 'xyz' })).toBeNull();
    expect(payments.approxUsdCents({ amount: 100 })).toBeNull();
    expect(payments.approxUsdCents({ currency: 'php' })).toBeNull();
  });
});

describe('paymentFromSession', () => {
  test('individual one-time lifetime keyed by PaymentIntent', () => {
    const p = payments.paymentFromSession({
      id: 'cs_1', payment_intent: 'pi_1', client_reference_id: 'user:T@Gmail.com',
      amount_total: 999, currency: 'usd', metadata: { plan: 'lifetime', currency: 'usd' },
      customer_details: { address: { country: 'US' } },
    });
    expect(p).toMatchObject({
      id: 'pi_1', sessionId: 'cs_1', plan: 'lifetime', recurring: false, interval: null,
      individual: true, email: 't@gmail.com', domain: 'gmail.com', amountUsd: 999, country: 'US', regional: false,
    });
  });
  test('domain Institution subscription keyed by first invoice', () => {
    const p = payments.paymentFromSession({
      id: 'cs_2', invoice: { id: 'in_1' }, subscription: 'sub_1', client_reference_id: 'school.edu',
      amount_total: 14900, currency: 'usd', metadata: { plan: 'team' }, customer_email: 'admin@school.edu',
    });
    expect(p).toMatchObject({
      id: 'in_1', subscriptionId: 'sub_1', plan: 'institution', recurring: true, interval: 'year',
      individual: false, domain: 'school.edu', email: 'admin@school.edu',
    });
  });
  test('regional educator year is flagged regional with no exact USD', () => {
    const p = payments.paymentFromSession({
      id: 'cs_3', amount_total: 14000, currency: 'php',
      metadata: { plan: 'educator', individual: '1', email: 'x@deped.gov.ph', isAnnualOneTime: '1', currency: 'php' },
    });
    expect(p).toMatchObject({ id: 'cs_3', plan: 'educator_annual', regional: true, amountUsd: null, domain: 'deped.gov.ph' });
  });
  test('tiered pricing in tier 2/3 with USD is flagged regional on session', () => {
    const p = payments.paymentFromSession({
      id: 'cs_tier2', amount_total: 2500, currency: 'usd',
      metadata: { plan: 'individual_annual', individual: '1', email: 'user@school.in', pricing: 'tiered', tier: '2' },
    });
    expect(p).toMatchObject({ id: 'cs_tier2', regional: true, amountUsd: 2500 });
  });
  test('tiered pricing in tier 1 with USD is not flagged regional on session', () => {
    const p = payments.paymentFromSession({
      id: 'cs_tier1', amount_total: 4900, currency: 'usd',
      metadata: { plan: 'individual_annual', individual: '1', email: 'user@school.us', pricing: 'tiered', tier: '1' },
    });
    expect(p).toMatchObject({ id: 'cs_tier1', regional: false, amountUsd: 4900 });
  });
  test('tiered pricing with numeric tier values handles string vs number correctly', () => {
    const p1 = payments.paymentFromSession({
      id: 'cs_tier1_num', amount_total: 4900, currency: 'usd',
      metadata: { plan: 'individual_annual', individual: '1', email: 'user@school.us', pricing: 'tiered', tier: 1 },
    });
    expect(p1.regional).toBe(false);
    const p2 = payments.paymentFromSession({
      id: 'cs_tier2_num', amount_total: 2500, currency: 'usd',
      metadata: { plan: 'individual_annual', individual: '1', email: 'user@school.in', pricing: 'tiered', tier: 2 },
    });
    expect(p2.regional).toBe(true);
    const pNone = payments.paymentFromSession({
      id: 'cs_tier_none', amount_total: 4900, currency: 'usd',
      metadata: { plan: 'individual_annual', individual: '1', email: 'user@school.us', pricing: 'tiered' },
    });
    expect(pNone.regional).toBe(false);
  });
  test('missing identity yields nulls rather than throwing', () => {
    const p = payments.paymentFromSession({ id: 'cs_4', client_reference_id: 'meet:abc' });
    expect(p).toMatchObject({ id: 'cs_4', email: null, domain: null, amount: null, currency: null });
  });
});

describe('paymentFromInvoice', () => {
  test('renewal invoice carries subscription routing metadata and line interval', () => {
    const p = payments.paymentFromInvoice({
      id: 'in_9', payment_intent: 'pi_9', subscription: 'sub_9', amount_paid: 499, currency: 'usd',
      billing_reason: 'subscription_cycle', lines: { data: [{ price: { recurring: { interval: 'month' } } }] },
    }, { individual: '1', plan: 'pro_monthly', email: 'A@b.com' });
    expect(p).toMatchObject({
      id: 'pi_9', source: 'invoice', plan: 'pro_monthly', interval: 'month', recurring: true,
      email: 'a@b.com', domain: 'b.com', amountUsd: 499, billingReason: 'subscription_cycle',
    });
  });
  test('renewal invoice with tiered tier 3 USD is flagged regional', () => {
    const p = payments.paymentFromInvoice({
      id: 'in_tier3', payment_intent: 'pi_t3', subscription: 'sub_t3', amount_paid: 199, currency: 'usd',
      billing_reason: 'subscription_cycle', lines: { data: [{ price: { recurring: { interval: 'month' } } }] },
    }, { individual: '1', plan: 'pro_monthly', email: 'b@school.pk', pricing: 'tiered', tier: '3' });
    expect(p).toMatchObject({
      id: 'pi_t3', regional: true,
    });
  });
  test('falls back to the plan default interval, legacy plan interval, customer_address, and handles missing fields', () => {
    const p = payments.paymentFromInvoice(
      { id: 'in_8', amount_paid: 5900, currency: 'usd', customer_email: 'x@s.edu', customer_address: { country: 'US' } },
      { plan: 'department', domain: 's.edu', currency: 'usd' }
    );
    expect(p).toMatchObject({ id: 'in_8', plan: 'department', interval: 'year', email: 'x@s.edu', domain: 's.edu', country: 'US', regional: false });

    const pEmpty = payments.paymentFromInvoice(
      { id: 'in_empty', lines: { data: [{ plan: { interval: 'month' } }] } }
    );
    expect(pEmpty).toMatchObject({ id: 'in_empty', amount: null, currency: null, email: null, domain: null, interval: 'month', regional: true });

    const pNullMeta = payments.paymentFromInvoice({ id: 'in_null', currency: 'brl', amount_paid: 990 }, { individual: '1' });
    expect(pNullMeta).toMatchObject({ id: 'in_null', plan: 'individual_subscription', interval: 'year', currency: 'brl', regional: true });
    expect(payments.paymentFromInvoice({ id: 'in_null2' }, null)).toMatchObject({ id: 'in_null2', interval: 'year' });
  });
});

describe('recordPayment / updateSubscriptionStatus / markPaymentStatus', () => {
  test('writes the payment and an MRR row for recurring plans; idempotent on id', async () => {
    const p = { id: 'in_1', subscriptionId: 'sub_1', recurring: true, plan: 'department', interval: 'year', amount: 5900, currency: 'usd', amountUsd: 5900, status: 'paid' };
    expect(await payments.recordPayment(p)).toBe(true);
    expect(await payments.recordPayment(p)).toBe(true);
    expect(ctx.read('payments/in_1')).toMatchObject({ plan: 'department', amount: 5900 });
    expect(ctx.read('subscriptions/sub_1')).toMatchObject({ status: 'active', plan: 'department' });
    expect(ctx.list('payments')).toHaveLength(1);
  });
  test('one-time payments create no subscription row; bad input is a no-op', async () => {
    expect(await payments.recordPayment({ id: 'pi_1', recurring: false })).toBe(true);
    expect(ctx.list('subscriptions').length > 0).toBe(false);
    expect(await payments.recordPayment(null)).toBe(false);
    expect(await payments.recordPayment({})).toBe(false);
  });
  test('subscription status mirrors Stripe; missing id is a no-op', async () => {
    expect(await payments.updateSubscriptionStatus('sub_1', 'canceled')).toBe(true);
    expect(ctx.read('subscriptions/sub_1')).toMatchObject({ status: 'canceled' });
    expect(await payments.updateSubscriptionStatus(null, 'canceled')).toBe(false);
  });
  test('marks refunds by PaymentIntent, then by Invoice; false when nothing matches', async () => {
    seedPayment('pi_1', { paymentIntentId: 'pi_1' });
    seedPayment('in_2', { invoiceId: 'in_2' });
    expect(await payments.markPaymentStatus({ paymentIntentId: 'pi_1' }, 'refunded')).toBe(true);
    expect(ctx.read('payments/pi_1').status).toBe('refunded');
    expect(await payments.markPaymentStatus({ paymentIntentId: 'pi_x', invoiceId: 'in_2' }, 'disputed')).toBe(true);
    expect(ctx.read('payments/in_2').status).toBe('disputed');
    expect(await payments.markPaymentStatus({ paymentIntentId: 'nope' }, 'refunded')).toBe(false);
    expect(await payments.markPaymentStatus({}, 'refunded')).toBe(false);
  });
  test('write failures are swallowed (ledger never blocks provisioning)', async () => {
    const db = require('../../src/services/firestore/_core').getDb();
    const original = db.collection;
    db.collection = () => { throw new Error('down'); };
    try {
      expect(await payments.recordPayment({ id: 'x' })).toBe(false);
      expect(await payments.updateSubscriptionStatus('sub', 'active')).toBe(false);
      expect(await payments.markPaymentStatus({ paymentIntentId: 'pi' }, 'refunded')).toBe(false);
    } finally {
      db.collection = original;
    }
  });
});

describe('getRevenueSummary', () => {
  test('empty ledger', async () => {
    const s = await payments.getRevenueSummary();
    expect(s).toMatchObject({ payments: 0, refundedOrDisputed: 0, activeSubscriptions: 0, mrrApproxUsd: 0, arrApproxUsd: 0 });
    expect(s.cashUsd).toEqual({ allTime: 0, last30d: 0, last7d: 0 });
  });

  test('cash vs MRR, windows, exclusions, refunds and FX', async () => {
    const now = Date.now();
    seedPayment('pi_life', { plan: 'lifetime', recurring: false, amount: 999, currency: 'usd', amountUsd: 999, email: 'a@x.com', domain: 'x.com' }, now - DAY);
    seedPayment('pi_old', { plan: 'lifetime', recurring: false, amount: 999, currency: 'usd', amountUsd: 999, email: 'b@x.com', domain: 'x.com' }, now - 40 * DAY);
    seedPayment('pi_php', { plan: 'lifetime', recurring: false, amount: 28000, currency: 'php', amountUsd: null, email: 'c@x.ph', domain: 'x.ph' }, now - 10 * DAY);
    ctx.seed('payments/pi_php_null', { status: 'paid', plan: 'lifetime', recurring: false, amount: null, currency: 'php', amountUsd: null, email: 'c2@x.ph', domain: 'x.ph', createdAt: null });
    seedPayment('in_dept', { plan: 'department', recurring: true, interval: 'year', amount: 5900, currency: 'usd', amountUsd: 5900, domain: 's.edu' }, now - 2 * DAY);
    seedPayment('pi_ref', { plan: 'lifetime', status: 'refunded', amount: 999, currency: 'usd', amountUsd: 999, email: 'd@x.com' }, now - DAY);
    seedPayment('pi_me', { plan: 'lifetime', amount: 999, currency: 'usd', amountUsd: 999, email: SUPER_ADMIN }, now - DAY);
    seedPayment('pi_yacht', { plan: 'team', amount: 1999, currency: 'usd', amountUsd: 1999, domain: 'theyachtgroup.com' }, now - DAY);
    ctx.seed('subscriptions/sub_dept', { status: 'active', interval: 'year', amount: 5900, currency: 'usd', amountUsd: 5900, domain: 's.edu' });
    ctx.seed('subscriptions/sub_mo', { status: 'past_due', interval: 'month', amount: 499, currency: 'usd', amountUsd: 499, domain: 'm.com' });
    ctx.seed('subscriptions/sub_gone', { status: 'canceled', interval: 'year', amount: 2900, currency: 'usd', amountUsd: 2900 });
    ctx.seed('subscriptions/sub_xyz', { status: 'active', interval: 'year', amount: 100, currency: 'xyz' });

    const s = await payments.getRevenueSummary({ now });
    expect(s.payments).toBe(5);
    expect(s.refundedOrDisputed).toBe(1);
    expect(s.cashUsd).toEqual({ allTime: 999 + 999 + 5900, last30d: 999 + 5900, last7d: 999 + 5900 });
    expect(s.approxUsd.allTime).toBe(999 + 999 + 482 + 5900);
    expect(s.approxUsd.oneTime).toBe(999 + 999 + 482);
    expect(s.approxUsd.recurring).toBe(5900);
    expect(s.unconverted).toEqual({ php: 28000 });
    expect(s.byPlan.lifetime).toEqual({ count: 4, approxUsd: 999 + 999 + 482 });
    expect(s.activeSubscriptions).toBe(3); // active + past_due (dunning) + the unconvertible one
    expect(s.mrrApproxUsd).toBe(Math.round(5900 / 12) + 499);
    expect(s.arrApproxUsd).toBe(s.mrrApproxUsd * 12);
  });

  test('tracks tier, arm, expArm on payments/subscriptions and aggregates byExpArm in getRevenueSummary', async () => {
    const p1 = payments.paymentFromSession({
      id: 'cs_exp1', invoice: 'in_exp1', subscription: 'sub_exp1',
      amount_total: 1499, currency: 'usd',
      metadata: { plan: 'educator', individual: '1', email: 'u1@school.edu', pricing: 'tiered', tier: '1', arm: 'tiered', expArm: 'recurring_first' },
    });
    expect(p1).toMatchObject({ tier: 1, arm: 'tiered', expArm: 'recurring_first' });
    await payments.recordPayment(p1);
    expect(ctx.read('subscriptions/sub_exp1')).toMatchObject({ tier: 1, arm: 'tiered', expArm: 'recurring_first' });

    const p2 = payments.paymentFromInvoice({
      id: 'in_exp2', payment_intent: 'pi_exp2', subscription: 'sub_exp2', amount_paid: 399, currency: 'usd',
      billing_reason: 'subscription_cycle', lines: { data: [{ price: { recurring: { interval: 'month' } } }] },
    }, { individual: '1', plan: 'pro_monthly', email: 'u2@school.edu', pricing: 'tiered', tier: '1', arm: 'tiered', expArm: 'three_option_control' });
    expect(p2).toMatchObject({ tier: 1, arm: 'tiered', expArm: 'three_option_control' });
    await payments.recordPayment(p2);

    const p3 = payments.paymentFromSession({
      id: 'cs_exp3', payment_intent: 'pi_exp3',
      amount_total: 4900, currency: 'xyz',
      metadata: { plan: 'lifetime', individual: '1', email: 'u3@school.edu', pricing: 'tiered', tier: '1', arm: 'tiered', expArm: 'recurring_first' },
    });
    await payments.recordPayment(p3);

    const s = await payments.getRevenueSummary();
    expect(s.byExpArm.recurring_first).toEqual({
      count: 2,
      approxUsd: 1499,
      recurringCount: 1,
      oneTimeCount: 1,
      mrrApproxUsd: Math.round(1499 / 12),
    });
    expect(s.byExpArm.three_option_control).toEqual({
      count: 1,
      approxUsd: 399,
      recurringCount: 1,
      oneTimeCount: 0,
      mrrApproxUsd: 399,
    });
  });
});
