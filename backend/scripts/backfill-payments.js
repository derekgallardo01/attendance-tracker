#!/usr/bin/env node
// One-off: rebuild the revenue ledger (payments/ + subscriptions/) from Stripe
// history, for purchases made before the ledger existed.
//
// Reads Stripe; writes Firestore ONLY with --write (default is a dry run that
// prints what it would record). Idempotent — re-running overwrites the same
// docs by payment id.
//
//   STRIPE_SECRET_KEY="$(gcloud secrets versions access latest --secret=stripe-secret-key --project=attendance-tracker-490319)" \
//   GCP_PROJECT_ID=attendance-tracker-490319 node scripts/backfill-payments.js [--write]
//
// Firestore auth uses Application Default Credentials (gcloud auth application-default login).

const WRITE = process.argv.includes('--write');
const key = process.env.STRIPE_SECRET_KEY;
if (!key) { console.error('STRIPE_SECRET_KEY is required'); process.exit(1); }

// The firestore service pulls in config.js, which hard-requires these; the
// ledger itself never reads them.
for (const name of ['GOOGLE_CLIENT_ID', 'OAUTH_CLIENT_SECRET_NAME', 'SESSION_SECRET', 'SECRET_NAME']) {
  process.env[name] ||= 'backfill-unused';
}

const stripe = require('stripe')(key);
const { paymentFromSession, paymentFromInvoice, recordPayment, updateSubscriptionStatus } = require('../src/services/firestore/payments');

const toDate = (unix) => (unix ? new Date(unix * 1000) : null);

async function main() {
  const records = [];

  // 1. Every paid Checkout Session (first payment of every plan).
  for await (const s of stripe.checkout.sessions.list({ status: 'complete', limit: 100 })) {
    if (s.payment_status !== 'paid' && s.payment_status !== 'no_payment_required') continue;
    if (!s.amount_total) continue; // 100%-off sessions carry no revenue
    records.push({ ...paymentFromSession(s), createdAt: toDate(s.created) });
  }

  // 2. Renewal invoices (later billing cycles — first invoices came via 1).
  const subMetaCache = new Map();
  for await (const inv of stripe.invoices.list({ status: 'paid', limit: 100 })) {
    const subId = typeof inv.subscription === 'string' ? inv.subscription : inv.subscription?.id;
    if (!subId || inv.billing_reason === 'subscription_create' || !inv.amount_paid) continue;
    if (!subMetaCache.has(subId)) {
      const sub = await stripe.subscriptions.retrieve(subId).catch(() => null);
      subMetaCache.set(subId, sub?.metadata || {});
    }
    records.push({ ...paymentFromInvoice(inv, subMetaCache.get(subId)), createdAt: toDate(inv.status_transitions?.paid_at || inv.created) });
  }

  // 3. Current subscription statuses (drives MRR).
  const subStatuses = [];
  for await (const sub of stripe.subscriptions.list({ status: 'all', limit: 100 })) {
    subStatuses.push({ id: sub.id, status: sub.status, cancelAtPeriodEnd: !!sub.cancel_at_period_end });
  }

  // 4. Refunds → mark those payments refunded.
  const refundedPIs = new Set();
  for await (const ch of stripe.charges.list({ limit: 100 })) {
    if (ch.refunded) refundedPIs.add(typeof ch.payment_intent === 'string' ? ch.payment_intent : ch.payment_intent?.id);
  }
  for (const r of records) if (r.paymentIntentId && refundedPIs.has(r.paymentIntentId)) r.status = 'refunded';

  const byPlan = {};
  for (const r of records) byPlan[r.plan] = (byPlan[r.plan] || 0) + 1;
  console.log(`payments: ${records.length}  subscriptions: ${subStatuses.length}  refunded: ${records.filter(r => r.status === 'refunded').length}`);
  console.log('by plan:', byPlan);
  for (const r of records) {
    console.log([r.createdAt?.toISOString().slice(0, 10), r.plan, r.amount, r.currency, r.email || r.domain, r.status].join('  '));
  }

  if (!WRITE) { console.log('\nDry run — re-run with --write to persist.'); return; }
  let ok = 0;
  for (const r of records) if (await recordPayment(r)) ok++;
  for (const s of subStatuses) await updateSubscriptionStatus(s.id, s.status, { cancelAtPeriodEnd: s.cancelAtPeriodEnd });
  console.log(`\nWrote ${ok}/${records.length} payments and ${subStatuses.length} subscription statuses.`);
}

main().then(() => process.exit(0)).catch((err) => { console.error('backfill failed:', err); process.exit(1); });
