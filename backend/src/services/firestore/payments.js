// Revenue ledger — one root `payments/{id}` doc per real Stripe payment and one
// root `subscriptions/{subId}` doc per recurring plan. This is the ONLY source
// for revenue numbers: user/tenant plan flags can't tell a $9.99 sale from a
// free review-reward grant, and can't tell one-time cash from recurring MRR.
// Root collections (like `webhookEvents`): a payment belongs to Stripe, not to
// a tenant, and the admin summary reads them all at once.
const { getDb, FieldValue, log, isSuperAdmin, tsMs } = require('./_core');

const DAY = 24 * 60 * 60 * 1000;

// Non-customer money (owner self-tests, the internal founding tenant, Google's
// Marketplace review bots) never counts as revenue. Mirrors analytics.js.
const EXCLUDED_DOMAINS = new Set(['marketplacetest.net', 'theyachtgroup.com']);

// Billing interval per exact plan. One-time plans have none.
const PLAN_INTERVAL = {
  educator: 'year',
  department: 'year',
  institution: 'year',
  pro_annual: 'year',
  pro_monthly: 'month',
};

// Coarse USD conversion for the explicit regional-currency prices (those bypass
// Adaptive Pricing, so Stripe gives us no USD figure). Approximate by design —
// surfaced separately from the exact USD totals.
const FX_APPROX_USD = {
  usd: 1, php: 0.0172, myr: 0.225, idr: 0.000062, inr: 0.0119, mxn: 0.054,
  brl: 0.18, kes: 0.0077, eur: 1.08, gbp: 1.27, cop: 0.00025, pen: 0.27,
};

// The exact plan a checkout sold. `metadata.plan` alone is ambiguous: `team` is
// both the retired $19.99 one-time domain pass and (annual) the $149
// Institution subscription, and `educator` is either a US subscription or a
// regional one-time year.
function resolvePaymentPlan({ plan, individual, recurring }) {
  if (plan === 'pro_annual') return recurring ? 'pro_annual' : 'pro_annual_prepaid';
  if (plan === 'single_meeting' || plan === 'lifetime' || plan === 'department'
    || plan === 'pro_monthly') return plan;
  if (plan === 'educator') return recurring ? 'educator' : 'educator_annual';
  if (plan === 'team') return recurring ? 'institution' : 'team';
  if (individual) return recurring ? 'individual_subscription' : 'lifetime';
  return recurring ? 'institution' : 'team';
}

// Exact USD cents when Stripe gave us one: a USD charge, or an Adaptive Pricing
// session whose presentment currency differs (currency_conversion carries the
// merchant-currency amount). Otherwise null.
function usdCents(amount, currency, conversion) {
  if (amount == null) return null;
  if (String(currency || '').toLowerCase() === 'usd') return amount;
  if (conversion && String(conversion.source_currency || '').toLowerCase() === 'usd' && conversion.amount_total != null) {
    return conversion.amount_total;
  }
  return null;
}

function approxUsdCents(p) {
  if (p.amountUsd != null) return p.amountUsd;
  const rate = FX_APPROX_USD[String(p.currency || '').toLowerCase()];
  // Every currency we sell in is two-decimal in Stripe, so minor units × rate
  // gives USD cents directly.
  return rate != null && p.amount != null ? Math.round(p.amount * rate) : null;
}

const asId = (v) => (typeof v === 'string' ? v : v?.id) || null;

// Ledger record for a paid Checkout Session. Doc id prefers the PaymentIntent
// (one-time) or first Invoice (subscription) so refunds/renewals can find it.
function paymentFromSession(s) {
  const meta = s.metadata || {};
  const ref = s.client_reference_id || '';
  const subscriptionId = asId(s.subscription);
  const recurring = !!subscriptionId;
  const individual = ref.startsWith('user:') || meta.individual === '1' || meta.plan === 'single_meeting';
  const email = (meta.email || (ref.startsWith('user:') ? ref.slice(5) : (s.customer_details?.email || s.customer_email)) || '').toLowerCase() || null;
  const domain = (meta.domain || (!individual && ref && !ref.startsWith('user:') && !ref.startsWith('meet:') ? ref : null)
    || (email && email.includes('@') ? email.split('@')[1] : null) || '').toLowerCase() || null;
  const plan = resolvePaymentPlan({ plan: meta.plan, individual, recurring });
  const paymentIntentId = asId(s.payment_intent);
  const invoiceId = asId(s.invoice);
  return {
    id: paymentIntentId || invoiceId || s.id,
    source: 'checkout',
    sessionId: s.id,
    paymentIntentId,
    invoiceId,
    subscriptionId,
    amount: s.amount_total ?? null,
    currency: String(s.currency || '').toLowerCase() || null,
    amountUsd: usdCents(s.amount_total, s.currency, s.currency_conversion),
    plan,
    recurring,
    interval: recurring ? (PLAN_INTERVAL[plan] || 'year') : null,
    individual,
    email,
    domain,
    country: s.customer_details?.address?.country || null,
    regional: meta.isAnnualOneTime === '1' || (!!meta.currency && meta.currency !== 'usd') || (meta.pricing === 'tiered' && meta.tier != null && String(meta.tier) !== '1'),
    tier: meta.tier != null ? Number(meta.tier) : null,
    arm: meta.arm || null,
    expArm: meta.expArm || null,
    status: 'paid',
  };
}

// Ledger record for a subscription RENEWAL invoice. The first invoice of a
// subscription is already recorded via its Checkout Session, so callers skip
// billing_reason 'subscription_create'.
function paymentFromInvoice(inv, subMeta = {}) {
  const meta = subMeta || {};
  const line = inv.lines?.data?.[0];
  const interval = line?.price?.recurring?.interval || line?.plan?.interval || null;
  const individual = meta.individual === '1';
  const plan = resolvePaymentPlan({ plan: meta.plan, individual, recurring: true });
  const email = (meta.email || inv.customer_email || '').toLowerCase() || null;
  return {
    id: asId(inv.payment_intent) || inv.id,
    source: 'invoice',
    sessionId: null,
    paymentIntentId: asId(inv.payment_intent),
    invoiceId: inv.id,
    subscriptionId: asId(inv.subscription),
    amount: inv.amount_paid ?? null,
    currency: String(inv.currency || '').toLowerCase() || null,
    amountUsd: usdCents(inv.amount_paid, inv.currency, null),
    plan,
    recurring: true,
    interval: interval || PLAN_INTERVAL[plan] || 'year',
    individual,
    email,
    domain: (meta.domain || (email && email.includes('@') ? email.split('@')[1] : null) || '').toLowerCase() || null,
    country: inv.customer_address?.country || null,
    regional: meta.isAnnualOneTime === '1' || (!!meta.currency && meta.currency !== 'usd') || (meta.pricing === 'tiered' && meta.tier != null && String(meta.tier) !== '1') || (String(inv.currency || '').toLowerCase() !== 'usd'),
    tier: meta.tier != null ? Number(meta.tier) : null,
    arm: meta.arm || null,
    expArm: meta.expArm || null,
    status: 'paid',
    billingReason: inv.billing_reason || null,
  };
}

// Persist a payment (idempotent on id) and, for recurring plans, upsert the
// subscription's MRR row. Never throws — the ledger must not block provisioning.
async function recordPayment(p) {
  if (!p || !p.id) return false;
  try {
    const db = getDb();
    // createdAt override is for the Stripe backfill (real payment date);
    // live webhook writes stamp server time.
    await db.collection('payments').doc(String(p.id)).set({
      ...p,
      createdAt: p.createdAt || FieldValue.serverTimestamp(),
    }, { merge: true });
    if (p.recurring && p.subscriptionId) {
      await db.collection('subscriptions').doc(String(p.subscriptionId)).set({
        subscriptionId: p.subscriptionId,
        plan: p.plan,
        interval: p.interval,
        amount: p.amount,
        currency: p.currency,
        amountUsd: p.amountUsd,
        email: p.email,
        domain: p.domain,
        individual: p.individual,
        tier: p.tier ?? null,
        arm: p.arm || null,
        expArm: p.expArm || null,
        status: 'active',
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    return true;
  } catch (err) {
    log.warn('payments: recordPayment failed', { id: p.id, error: err.message });
    return false;
  }
}

// Mirror Stripe subscription status onto the MRR row (canceled/unpaid → out of
// MRR; past_due stays in, matching the plan-provisioning dunning window).
async function updateSubscriptionStatus(subId, status, extra = {}) {
  if (!subId) return false;
  try {
    await getDb().collection('subscriptions').doc(String(subId)).set({
      subscriptionId: subId,
      status,
      ...extra,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return true;
  } catch (err) {
    log.warn('payments: updateSubscriptionStatus failed', { subId, error: err.message });
    return false;
  }
}

// Mark a payment refunded/disputed (or restored, on a won dispute). Looks the
// payment up by PaymentIntent, then by Invoice.
async function markPaymentStatus({ paymentIntentId, invoiceId }, status) {
  try {
    const col = getDb().collection('payments');
    for (const [field, value] of [['paymentIntentId', paymentIntentId], ['invoiceId', invoiceId]]) {
      if (!value) continue;
      const snap = await col.where(field, '==', value).get();
      if (!snap.empty) {
        await Promise.all(snap.docs.map(d => d.ref.set({ status, statusUpdatedAt: FieldValue.serverTimestamp() }, { merge: true })));
        return true;
      }
    }
    return false;
  } catch (err) {
    log.warn('payments: markPaymentStatus failed', { paymentIntentId, invoiceId, error: err.message });
    return false;
  }
}

function isCustomerPayment(p) {
  if (p.email && isSuperAdmin(p.email)) return false;
  if (p.domain && EXCLUDED_DOMAINS.has(p.domain)) return false;
  return true;
}

const monthlyCents = (amount, interval) => (interval === 'month' ? amount : Math.round(amount / 12));

// Founder revenue summary. All amounts in USD cents. `cash*` are exact USD
// (Stripe-reported); `approx*` add FX-estimated regional-currency payments.
async function getRevenueSummary({ now = Date.now() } = {}) {
  const db = getDb();
  const [paySnap, subSnap] = await Promise.all([
    db.collection('payments').get(),
    db.collection('subscriptions').get(),
  ]);
  const payments = paySnap.docs.map(d => ({ ...d.data(), createdMs: tsMs(d.data().createdAt) || 0 }))
    .filter(isCustomerPayment);
  const paid = payments.filter(p => p.status === 'paid');

  const sum = (list, fn) => list.reduce((a, p) => a + (fn(p) || 0), 0);
  const since = (ms) => paid.filter(p => p.createdMs >= now - ms);
  const unconverted = {};
  for (const p of paid) {
    if (p.amountUsd == null && p.currency) unconverted[p.currency] = (unconverted[p.currency] || 0) + (p.amount || 0);
  }
  const byPlan = {};
  for (const p of paid) {
    const b = byPlan[p.plan] || (byPlan[p.plan] = { count: 0, approxUsd: 0 });
    b.count++;
    b.approxUsd += approxUsdCents(p) || 0;
  }

  const subs = subSnap.docs.map(d => d.data()).filter(isCustomerPayment);
  const activeSubs = subs.filter(s => ['active', 'trialing', 'past_due'].includes(s.status));
  const mrrApprox = sum(activeSubs, s => {
    const usd = approxUsdCents(s);
    return usd == null ? 0 : monthlyCents(usd, s.interval);
  });

  const byExpArm = {};
  const ensureArmBucket = (key) => byExpArm[key] || (byExpArm[key] = {
    count: 0,
    approxUsd: 0,
    recurringCount: 0,
    oneTimeCount: 0,
    mrrApproxUsd: 0,
  });
  for (const p of paid) {
    const b = ensureArmBucket(p.expArm || 'legacy');
    b.count++;
    b.approxUsd += approxUsdCents(p) || 0;
    if (p.recurring) b.recurringCount++;
    else b.oneTimeCount++;
  }
  for (const s of activeSubs) {
    const b = ensureArmBucket(s.expArm || 'legacy');
    const usd = approxUsdCents(s);
    if (usd != null) b.mrrApproxUsd += monthlyCents(usd, s.interval);
  }

  return {
    generatedAt: new Date(now).toISOString(),
    payments: paid.length,
    refundedOrDisputed: payments.length - paid.length,
    cashUsd: {
      allTime: sum(paid, p => p.amountUsd),
      last30d: sum(since(30 * DAY), p => p.amountUsd),
      last7d: sum(since(7 * DAY), p => p.amountUsd),
    },
    approxUsd: {
      allTime: sum(paid, approxUsdCents),
      last30d: sum(since(30 * DAY), approxUsdCents),
      last7d: sum(since(7 * DAY), approxUsdCents),
      oneTime: sum(paid.filter(p => !p.recurring), approxUsdCents),
      recurring: sum(paid.filter(p => p.recurring), approxUsdCents),
    },
    unconverted,
    byPlan,
    byExpArm,
    activeSubscriptions: activeSubs.length,
    mrrApproxUsd: mrrApprox,
    arrApproxUsd: mrrApprox * 12,
  };
}

module.exports = {
  resolvePaymentPlan,
  usdCents,
  approxUsdCents,
  paymentFromSession,
  paymentFromInvoice,
  recordPayment,
  updateSubscriptionStatus,
  markPaymentStatus,
  getRevenueSummary,
  PLAN_INTERVAL,
};
