const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const express = require('express');
const log = require('../lib/logger');
const CONFIG = require('../config');
const { getTenantPlan, setTenantPlan, getUserPlan, setUserPlan, logEvent, countUserMonthlyExports, claimWebhookEvent, releaseWebhookEvent } = require('../services/firestore');
const { PERSONAL_EMAIL_DOMAINS } = require('../services/firestore/_core');
const PRICING = require('../config/pricing');

// Personal-email tenants (gmail.com etc.) are shared by unrelated users, so they
// can't buy the per-domain org plan — they buy an INDIVIDUAL (per-user) plan
// stored on their user doc. Gated on its own price id so it dark-launches
// independently of the org tier.
const isPersonalDomain = (domain) => PERSONAL_EMAIL_DOMAINS.has((domain || '').toLowerCase());
function individualBillingConfigured() {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_INDIVIDUAL_PRICE_ID;
}

// Per-domain Pro subscription via Stripe Checkout. Lazy-init the SDK (like the
// Resend wrapper) so the service boots and runs fine before billing is
// configured — every billing endpoint degrades to a clear 503 until the
// STRIPE_* env vars are set. Feature gating (see requireProPlan) is a no-op
// while billing is off, so nothing behind the paywall breaks pre-launch.
let cachedStripe = null;
function getStripe() {
  if (cachedStripe) return cachedStripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  cachedStripe = require('stripe')(key);
  return cachedStripe;
}

// True when Stripe is wired up enough to actually sell/gate.
function billingConfigured() {
  return !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PRICE_ID;
}

const router = Router();

// POST /api/billing/checkout — start a Checkout Session for the caller's
// Workspace domain. Per-domain billing: whoever completes checkout pays for the
// whole org, keyed by domain via client_reference_id + subscription metadata.
router.post('/billing/checkout', requireAuth, async (req, res) => {
  const stripe = getStripe();
  const domain = req.user.domain;
  const email = req.user.email;
  const isEducator = req.body && req.body.plan === 'educator';
  const isLifetime = req.body && req.body.plan === 'lifetime';
  const isTeamPlan = req.body && req.body.plan === 'team';
  // A personal-email buyer can't own the shared gmail.com/etc tenant — a team
  // purchase from them would flip the SHARED tenant doc Pro (cross-tenant
  // grant) while granting the buyer nothing (their gates read the user doc).
  if (isTeamPlan && isPersonalDomain(domain)) {
    return res.status(400).json({ error: 'The domain license covers a Google Workspace domain. On a personal account, pick the Lifetime or Educator pass instead.' });
  }
  const individual = (isEducator || isLifetime)
    ? true
    : (isTeamPlan
      ? false
      : (req.body && req.body.plan === 'individual' ? true : isPersonalDomain(domain)));
  // Personal-email users buy the INDIVIDUAL (per-user) plan; Workspace domains
  // buy the per-domain org plan. Each has monthly + optional annual prices.
  // Annual falls back to monthly when its price id isn't set, so annual can be
  // dark-launched (and the frontend only offers it when annualAvailable, below).
  /* istanbul ignore next: express.json always sets req.body to an object */
  const annual = (req.body || {}).interval === 'annual';
  // Fallbacks stay WITHIN a product: a chain that terminates in the domain
  // price could charge a "$4.99/yr" button the $19.99+ team price. Missing
  // price id for the named plan = fail closed (503), never cross products.
  const priceId = isEducator
    ? (process.env.STRIPE_EDUCATOR_PRICE_ID || process.env.STRIPE_INDIVIDUAL_ANNUAL_PRICE_ID)
    : (isLifetime
      ? process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID
      : (individual
        ? (annual && process.env.STRIPE_INDIVIDUAL_ANNUAL_PRICE_ID) || process.env.STRIPE_INDIVIDUAL_PRICE_ID
        : (annual && process.env.STRIPE_ANNUAL_PRICE_ID) || process.env.STRIPE_PRICE_ID));
  if (!stripe || !priceId) {
    return res.status(503).json({ error: 'Billing is not configured yet.' });
  }
  try {
    // client_reference_id tags who the subscription is for: `user:<email>` for
    // an individual, or the bare domain for an org. Metadata carries both so the
    // webhook can route to setUserPlan vs setTenantPlan.
    // `plan` in metadata: the refund/dispute handler routes on it, and it
    // rides payment_intent_data so one-time charges carry it end-to-end.
    const planName = req.body?.plan || (individual ? 'individual' : 'team');
    const meta = individual
      ? { individual: '1', plan: planName, domain, email: email.toLowerCase() }
      : { individual: '0', plan: planName, domain, initiatedBy: email };
    const backTo = individual ? 'history.html' : 'team.html';
    // Retrieve price details to dynamically use 'subscription' for recurring plans
    // or 'payment' for one-time / lifetime purchases.
    let isRecurring = !isLifetime;
    if (isLifetime) {
      isRecurring = false;
    } else if (stripe.prices && typeof stripe.prices.retrieve === 'function') {
      try {
        const priceObj = await stripe.prices.retrieve(priceId);
        isRecurring = priceObj ? (priceObj.type === 'recurring' || !!priceObj.recurring) : true;
      } catch (e) {
        log.warn('billing: could not retrieve price object, defaulting to subscription', { priceId, error: e.message });
      }
    }

    // `??` not `||`: an explicit empty promo must skip the LAUNCH50 auto-apply.
    // Defense-in-depth: the Institution/annual domain price never carries the
    // launch discount, whatever the client sends.
    const resolvesToInstitution = isTeamPlan && annual && priceId === process.env.STRIPE_ANNUAL_PRICE_ID;
    const promo = resolvesToInstitution ? '' : (req.body.promo ?? 'LAUNCH50').toUpperCase();
    const LAUNCH_PROMO_ID = process.env.STRIPE_LAUNCH_PROMO_CODE || 'promo_1UBiZORPP93YBXrOlZdFv8zM';

    const sessionParams = {
      mode: isRecurring ? 'subscription' : 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: individual ? `user:${email.toLowerCase()}` : domain,
      customer_email: email,
      success_url: `${CONFIG.publicSiteUrl}/${backTo}?upgraded=1`,
      cancel_url: `${CONFIG.publicSiteUrl}/${backTo}`,
      metadata: meta,
    };
    if (promo === 'LAUNCH50' && LAUNCH_PROMO_ID) {
      sessionParams.discounts = [{ promotion_code: LAUNCH_PROMO_ID }];
    } else {
      sessionParams.allow_promotion_codes = true;
    }
    if (isRecurring) {
      sessionParams.subscription_data = { metadata: meta };
    } else {
      sessionParams.payment_intent_data = { metadata: meta };
      // Payment mode doesn't create a Stripe customer by default, which leaves
      // stripeCustomerId null in the webhook → the billing portal (receipts,
      // payment history) 404s for one-time buyers. Always create one.
      sessionParams.customer_creation = 'always';
    }
    if (isEducator && !isRecurring) {
      // The educator plan is sold as an ANNUAL pass — a one-time price never
      // renews (and never emits subscription webhooks), so a misconfigured
      // STRIPE_EDUCATOR_PRICE_ID silently turns annual revenue into lifetime.
      log.warn('billing: educator price is one-time, not recurring — annual pass will not renew', { priceId });
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    log.error('billing: checkout create failed', { domain, individual, error: err.message });
    res.status(502).json({ error: 'Could not start checkout.' });
  }
});

// POST /api/billing/public-checkout — start a Checkout Session from the public
// pricing page without requiring a pre-existing session token. Stripe collects
// the customer's email and payment info, and the webhook provisions Pro.
router.post('/billing/public-checkout', async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ error: 'Billing is not configured yet.' });
  }
  const plan = req.body?.plan || 'lifetime';
  // Annual is opt-IN only (mirrors the authed checkout at :66). Defaulting to
  // 'annual' was a trap: a bare {plan:'team'} would resolve to the $149/yr
  // Institution price AND auto-apply LAUNCH50 — wrong tier + a discount
  // Institution must never get.
  const annual = req.body?.interval === 'annual';
  const email = (req.body?.email || '').trim().toLowerCase() || undefined;
  const isTeam = plan === 'team';
  const isEducator = plan === 'educator';

  // A domain purchase MUST know which domain it activates. Without this, a
  // signed-out visitor could pay for the team plan and the webhook's org
  // branch would have nothing to provision — money taken, nothing granted.
  if (isTeam) {
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'A work email is required for the domain license — it tells us which domain to activate.' });
    }
    if (isPersonalDomain(email.split('@')[1])) {
      return res.status(400).json({ error: 'The domain license covers a Google Workspace domain. Personal Gmail accounts should pick the Lifetime or Educator pass instead.' });
    }
  }
  // Same fail-closed rule as the authed checkout: fallbacks never cross
  // product boundaries (a "$4.99/yr" button must never resolve to the
  // domain price). Missing price for the named plan → 503.
  const priceId = isEducator
    ? (process.env.STRIPE_EDUCATOR_PRICE_ID || process.env.STRIPE_INDIVIDUAL_ANNUAL_PRICE_ID)
    : (isTeam
        ? ((annual && process.env.STRIPE_ANNUAL_PRICE_ID) || process.env.STRIPE_PRICE_ID)
        : (plan === 'lifetime'
            ? process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID
            : ((annual && process.env.STRIPE_INDIVIDUAL_ANNUAL_PRICE_ID) || process.env.STRIPE_INDIVIDUAL_PRICE_ID)));

  if (!priceId) {
    return res.status(503).json({ error: 'Selected plan price is not configured.' });
  }

  try {
    let isRecurring = true;
    if (plan === 'lifetime') {
      isRecurring = false;
    } else if (stripe.prices && typeof stripe.prices.retrieve === 'function') {
      try {
        const priceObj = await stripe.prices.retrieve(priceId);
        isRecurring = priceObj ? (priceObj.type === 'recurring' || !!priceObj.recurring) : true;
      } catch (e) {
        log.warn('billing: could not retrieve price object in public checkout', { priceId, error: e.message });
      }
    }

    const meta = {
      individual: isTeam ? '0' : '1',
      plan,
      source: 'public_pricing',
      ...(email ? { email } : {}),
      // Stamp the domain for team purchases so the webhook can provision even
      // if client_reference_id is ever absent from the completed session.
      ...(isTeam && email ? { domain: email.split('@')[1] } : {}),
    };

    // `??` not `||`: an explicit empty promo ('' from the Institution card)
    // must SKIP the LAUNCH50 auto-apply and re-enable the promo-code box.
    // Defense-in-depth: whenever the resolved price IS the Institution/annual
    // domain price, force-skip LAUNCH50 regardless of what the client sent —
    // the Institution tier never carries the launch discount.
    const resolvesToInstitution = isTeam && annual && priceId === process.env.STRIPE_ANNUAL_PRICE_ID;
    const promo = resolvesToInstitution ? '' : (req.body?.promo ?? 'LAUNCH50').toUpperCase();
    const LAUNCH_PROMO_ID = process.env.STRIPE_LAUNCH_PROMO_CODE || 'promo_1UBiZORPP93YBXrOlZdFv8zM';

    const sessionParams = {
      mode: isRecurring ? 'subscription' : 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${CONFIG.publicSiteUrl}/history.html?upgraded=1`,
      cancel_url: `${CONFIG.publicSiteUrl}/pricing.html`,
      metadata: meta,
    };
    if (email) {
      sessionParams.customer_email = email;
      sessionParams.client_reference_id = isTeam ? email.split('@')[1] : `user:${email}`;
    }
    if (promo === 'LAUNCH50' && LAUNCH_PROMO_ID) {
      sessionParams.discounts = [{ promotion_code: LAUNCH_PROMO_ID }];
    } else {
      sessionParams.allow_promotion_codes = true;
    }
    if (isRecurring) {
      sessionParams.subscription_data = { metadata: meta };
    } else {
      sessionParams.payment_intent_data = { metadata: meta };
      // Same as the authed checkout: make one-time purchases create a Stripe
      // customer so the buyer's portal (receipts) works post-purchase.
      sessionParams.customer_creation = 'always';
    }
    if (isEducator && !isRecurring) {
      log.warn('billing: educator price is one-time, not recurring — annual pass will not renew', { priceId });
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    log.error('billing: public checkout failed', { plan, error: err.message });
    res.status(502).json({ error: 'Could not start checkout.' });
  }
});

// GET /api/billing/portal — Stripe Customer Portal link so the org admin can
// update payment method or cancel. Requires a stored customer id (set by the
// webhook on first successful checkout).
router.get('/billing/portal', requireAuth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured yet.' });
  let individual = isPersonalDomain(req.user.domain);
  try {
    let { stripeCustomerId } = individual
      ? await getUserPlan(req.user.domain, req.user.email)
      : await getTenantPlan(req.user.domain);
    // Workspace-domain user managing an INDIVIDUAL pass they bought themselves
    // (mirrors the planIsPro fallback).
    if (!stripeCustomerId && !individual) {
      ({ stripeCustomerId } = await getUserPlan(req.user.domain, req.user.email));
      if (stripeCustomerId) individual = true;
    }
    if (!stripeCustomerId) return res.status(404).json({ error: 'No active subscription.' });
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${CONFIG.publicSiteUrl}/${individual ? 'history.html' : 'team.html'}`,
    });
    res.json({ url: session.url });
  } catch (err) {
    log.error('billing: portal create failed', { domain: req.user.domain, individual, error: err.message });
    res.status(502).json({ error: 'Could not open the billing portal.' });
  }
});

// GET /api/billing/status — current plan for the caller's domain (drives the
// upgrade CTA in the UI).
router.get('/billing/status', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  let individual = isPersonalDomain(req.user.domain);
  try {
    let plan = individual
      ? await getUserPlan(req.user.domain, req.user.email)
      : await getTenantPlan(req.user.domain);
    // Workspace-domain user without a domain plan may hold an INDIVIDUAL pass
    // (mirrors planIsPro). Report it as their plan so the UI shows Pro +
    // Manage billing instead of an upgrade CTA for something already bought.
    if (!individual && plan.plan !== 'pro' && individualBillingConfigured()) {
      const userPlan = await getUserPlan(req.user.domain, req.user.email);
      if (userPlan.plan === 'pro') { plan = userPlan; individual = true; }
    }
    // annualAvailable tells the frontend whether to offer the monthly/annual
    // toggle — only once the matching annual price id is set (so we never show
    // an annual price the checkout can't actually charge).
    const annualAvailable = individual
      ? !!process.env.STRIPE_INDIVIDUAL_ANNUAL_PRICE_ID
      : !!process.env.STRIPE_ANNUAL_PRICE_ID;
    let exportQuota = null;
    if (plan.plan !== 'pro' && typeof countUserMonthlyExports === 'function') {
      try {
        const used = await countUserMonthlyExports(req.user.domain, req.user.email);
        exportQuota = { used, limit: PRICING.FREE_MONTHLY_EXPORT_LIMIT };
      } catch (e) {
        log.warn('billing: countUserMonthlyExports failed in status', { error: e.message });
      }
    }
    res.json({
      ...plan,
      individual,
      billingConfigured: individual ? individualBillingConfigured() : billingConfigured(),
      annualAvailable,
      educatorAvailable: !!process.env.STRIPE_EDUCATOR_PRICE_ID,
      exportQuota,
      // Display-price truth for every frontend surface (see config/pricing.js).
      pricing: { ...PRICING.PRICES, quotaLimit: PRICING.FREE_MONTHLY_EXPORT_LIMIT },
    });
  } catch (err) {
    log.error('billing: status failed', { domain: req.user.domain, error: err.message });
    res.status(500).json({ error: 'Failed to fetch plan.' });
  }
});

// The webhook handler is exported separately so app.js can mount it with a RAW
// body parser BEFORE express.json() — Stripe signature verification needs the
// exact bytes. Mounting it inside this (post-json) router would break the
// signature check.
async function webhookHandler(req, res) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return res.status(503).json({ error: 'Billing webhook not configured.' });

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], secret);
  } catch (err) {
    log.warn('billing: webhook signature verification failed', { error: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Stripe retries deliveries — claim the event id exactly once so a retry
    // can't double-log `upgraded` analytics or replay a downgrade.
    if (!(await claimWebhookEvent(event.id))) {
      log.info('billing: duplicate webhook delivery skipped', { eventId: event.id, type: event.type });
      return res.json({ received: true, duplicate: true });
    }
    switch (event.type) {
      case 'checkout.session.async_payment_failed': {
        // Delayed payment method (e.g. bank debit) ultimately failed AFTER
        // checkout.session.completed fired with payment_status 'unpaid'.
        log.warn('billing: async payment failed — nothing was provisioned', { eventId: event.id, sessionId: event.data.object?.id });
        break;
      }
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.completed': {
        const s = event.data.object;
        // Delayed-notification payment methods fire `completed` with
        // payment_status 'unpaid' — granting Pro then would keep it even if
        // the payment later fails. Wait for async_payment_succeeded.
        if (event.type === 'checkout.session.completed' && s.payment_status && s.payment_status === 'unpaid') {
          log.info('billing: checkout completed but unpaid (delayed method) — waiting for async_payment_succeeded', { sessionId: s.id });
          break;
        }
        const ref = s.client_reference_id || '';
        if (ref.startsWith('user:') || s.metadata?.individual === '1') {
          // Individual (per-user) plan → write the user doc.
          const email = s.metadata?.email || (ref.startsWith('user:') ? ref.slice(5) : (s.customer_details?.email || s.customer_email));
          const domain = s.metadata?.domain || (email && email.includes('@') ? email.split('@')[1] : null);
          if (domain && email) {
            await setUserPlan(domain, email.toLowerCase(), {
              individualPlan: 'pro',
              individualBillingStatus: 'active',
              individualStripeCustomerId: s.customer || null,
              individualStripeSubscriptionId: s.subscription || null,
            });
            try { await logEvent(domain, { email, type: 'upgraded', meta: { plan: 'individual', amount: s.amount_total, currency: s.currency } }); } catch {}
          }
        } else {
          // Provisioning fallback chain: client_reference_id → metadata.domain
          // → the buyer's email domain (guarded against personal domains so a
          // stray gmail purchase can't flip the shared gmail.com tenant Pro).
          const buyerEmailDomain = ((s.customer_details?.email || s.customer_email || '').split('@')[1] || '').toLowerCase();
          let domain = ref || s.metadata?.domain
            || (buyerEmailDomain && !isPersonalDomain(buyerEmailDomain) ? buyerEmailDomain : null);
          // The shared personal tenants (gmail.com …) must NEVER be flipped
          // Pro — that would grant every personal user org features via one
          // stray purchase. Applies to EVERY resolution path, not just the
          // email fallback.
          if (domain && isPersonalDomain(domain)) {
            log.error('billing: refusing to provision a domain plan onto a shared personal tenant — manual review + refund needed', { sessionId: s.id, domain });
            domain = null;
          }
          if (!domain) {
            log.error('billing: team checkout completed with NO resolvable domain — manual provisioning needed', { sessionId: s.id, email: s.customer_details?.email || s.customer_email || null });
          }
          if (domain) {
            await setTenantPlan(domain, {
              plan: 'pro',
              billingStatus: 'active',
              stripeCustomerId: s.customer || null,
              stripeSubscriptionId: s.subscription || null,
            });
            try { await logEvent(domain, { email: s.customer_email || s.metadata?.initiatedBy || 'admin', type: 'upgraded', meta: { plan: 'team', amount: s.amount_total, currency: s.currency } }); } catch {}
          }
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        // Keep Pro through Stripe's dunning window: `past_due` means the latest
        // invoice failed but Stripe is still auto-retrying, so a temporary card
        // decline shouldn't yank access mid-retry. `unpaid`/`canceled`/etc.
        // (retries exhausted or ended) downgrade to Free.
        const active = ['active', 'trialing', 'past_due'].includes(sub.status);
        if (sub.metadata?.individual === '1') {
          const domain = sub.metadata?.domain;
          const email = sub.metadata?.email;
          if (domain && email) {
            await setUserPlan(domain, email, {
              individualPlan: active ? 'pro' : 'free',
              individualBillingStatus: sub.status,
              individualStripeSubscriptionId: sub.id,
              ...(sub.customer ? { individualStripeCustomerId: sub.customer } : {}),
            });
          }
        } else {
          const domain = sub.metadata?.domain;
          if (domain) {
            await setTenantPlan(domain, {
              plan: active ? 'pro' : 'free',
              billingStatus: sub.status,
              stripeSubscriptionId: sub.id,
              ...(sub.customer ? { stripeCustomerId: sub.customer } : {}), // also persist on subscription events (B6/portal)
            });
          }
        }
        break;
      }
      case 'charge.refunded':
      case 'charge.dispute.created': {
        // refunds.html promises refunds — honoring one must also revoke the
        // plan (before this, a refunded lifetime pass kept Pro forever).
        // Metadata resolution, in order of where Stripe actually puts it:
        //   1. the PaymentIntent (one-time purchases: payment_intent_data)
        //   2. the Charge itself
        //   3. subscription invoices: charge → invoice → subscription.metadata
        //      (invoice charges do NOT inherit subscription metadata)
        const obj = event.data.object; // Charge for refunds, Dispute for disputes
        const asId = (v) => (typeof v === 'string' ? v : v?.id) || null;
        const nonEmpty = (m) => (m && Object.keys(m).length ? m : null);
        let meta = nonEmpty(event.type === 'charge.refunded' ? obj.metadata : null);
        try {
          if (!meta && asId(obj.payment_intent)) {
            meta = nonEmpty((await stripe.paymentIntents.retrieve(asId(obj.payment_intent)))?.metadata);
          }
          if (!meta && asId(obj.charge)) {
            const ch = await stripe.charges.retrieve(asId(obj.charge));
            meta = nonEmpty(ch?.metadata);
            if (!meta && asId(ch?.payment_intent)) {
              meta = nonEmpty((await stripe.paymentIntents.retrieve(asId(ch.payment_intent)))?.metadata);
            }
            if (!meta && asId(ch?.invoice)) {
              const inv = await stripe.invoices.retrieve(asId(ch.invoice));
              if (asId(inv?.subscription)) {
                meta = nonEmpty((await stripe.subscriptions.retrieve(asId(inv.subscription)))?.metadata);
              }
            }
          }
          // Refunded Charge with an invoice but no PI-borne metadata:
          if (!meta && event.type === 'charge.refunded' && asId(obj.invoice)) {
            const inv = await stripe.invoices.retrieve(asId(obj.invoice));
            if (asId(inv?.subscription)) {
              meta = nonEmpty((await stripe.subscriptions.retrieve(asId(inv.subscription)))?.metadata);
            }
          }
        } catch (e) {
          log.warn('billing: metadata lookup for refund/dispute failed', { eventId: event.id, error: e.message });
        }
        // Route on identity, not on a `plan` label (older sessions lack it).
        // A present buyer email means an individual pass UNLESS explicitly
        // flagged as an org (individual==='0'). Authed individual metadata
        // carries `domain` too (billing.js:88), so keying off `!domain` would
        // misroute such a refund into a whole-domain downgrade.
        const email = (meta?.email || '').toLowerCase();
        const isIndividual = meta?.individual === '1' || (!!email && meta?.individual !== '0');
        const orgDomain = isIndividual ? null : meta?.domain;
        const planLabel = meta?.plan || (isIndividual ? 'individual' : 'team');
        const status = event.type === 'charge.refunded' ? 'refunded' : 'disputed';
        if (isIndividual && email.includes('@')) {
          const domain = meta?.domain || email.split('@')[1];
          await setUserPlan(domain, email, { individualPlan: 'free', individualBillingStatus: status });
          try { await logEvent(domain, { email, type: 'refunded', meta: { plan: planLabel, kind: event.type } }); } catch {}
        } else if (orgDomain && !isPersonalDomain(orgDomain)) {
          await setTenantPlan(orgDomain, { plan: 'free', billingStatus: status });
          try { await logEvent(orgDomain, { email: meta?.email || meta?.initiatedBy || 'admin', type: 'refunded', meta: { plan: planLabel, kind: event.type } }); } catch {}
        } else {
          log.error('billing: refund/dispute with no resolvable owner — manual review needed', { eventId: event.id, type: event.type });
        }
        break;
      }
      case 'invoice.payment_failed':
        // Dunning downgrade is handled via customer.subscription.updated →
        // past_due/unpaid; this is observability only.
        log.warn('billing: invoice payment failed', { eventId: event.id, customer: event.data.object?.customer || null });
        break;
      default:
        // Ignore other event types.
        break;
    }
    res.json({ received: true });
  } catch (err) {
    log.error('billing: webhook handling failed', { type: event.type, error: err.message });
    // Release the dedupe claim so Stripe's retry can actually reprocess —
    // otherwise a transient failure here permanently drops the provisioning.
    await releaseWebhookEvent(event.id);
    res.status(500).json({ error: 'Webhook handling failed.' });
  }
}

// Short-lived cache of the last successfully-read plan per domain. Lets the gate
// ride out a transient Firestore blip for a paying customer WITHOUT the old
// fail-open behavior, which silently granted Pro to every domain on any read
// error — the opposite of what a paywall should do once it's live.
const planCache = new Map(); // domain -> { plan, at }
const userPlanCache = new Map(); // `${domain}:${email}` -> { plan, at }
const PLAN_CACHE_TTL_MS = 5 * 60 * 1000;

// Express middleware: gate a route behind the Pro plan (per-domain). While
// billing is not configured the gate is OPEN, so paywalled features keep
// working until monetization is switched on. Once configured, non-Pro domains
// get 402 with an upgrade hint. On a read error we fall back to a recent known
// plan; absent that we fail CLOSED (the gated features are non-critical
// dashboards, so a brief denial beats giving Pro away for free).
async function requireProPlan(req, res, next) {
  if (!billingConfigured()) return next(); // pre-launch: nothing is gated
  const domain = req.user?.domain;
  try {
    const { plan } = await getTenantPlan(domain);
    planCache.set(domain, { plan, at: Date.now() });
    if (plan === 'pro') return next();
    return res.status(402).json({ error: 'This is a Pro feature.', upgrade: true });
  } catch (err) {
    const cached = planCache.get(domain);
    const fresh = cached && (Date.now() - cached.at) < PLAN_CACHE_TTL_MS;
    log.warn('billing: requireProPlan read failed', {
      domain, usedCache: !!fresh, cachedPlan: cached?.plan || null, error: err.message,
    });
    if (fresh && cached.plan === 'pro') return next();
    return res.status(402).json({ error: 'This is a Pro feature.', upgrade: true, transient: !fresh });
  }
}

// Boolean form of the gate, for features that DEGRADE gracefully rather than
// hard-block a route (auto-export, digests, full history). Pre-launch (billing
// unconfigured) every feature is allowed. Shares requireProPlan's cache + fail
// behavior: a transient read error rides the last-known plan, else denies.
// Per-user individual-plan check with the last-known-plan cache ride. Used
// for personal-domain users AND as the fallback for workspace-domain users
// who bought an individual pass themselves.
async function userPlanIsPro(domain, email) {
  const key = `${(domain || '').toLowerCase()}:${email.toLowerCase()}`;
  try {
    const { plan } = await getUserPlan(domain, email);
    userPlanCache.set(key, { plan, at: Date.now() });
    return plan === 'pro';
  } catch (err) {
    const cached = userPlanCache.get(key);
    const fresh = cached && (Date.now() - cached.at) < PLAN_CACHE_TTL_MS;
    log.warn('billing: planIsPro (per-user) read failed', { usedCache: !!fresh, error: err.message });
    return !!(fresh && cached.plan === 'pro');
  }
}

async function planIsPro(domain, email) {
  if (!billingConfigured()) return true; // pre-launch: nothing is gated
  if (isPersonalDomain(domain)) {
    // Personal-email tenants bill per USER, not per domain. Gate ONLY when the
    // caller passes an email AND the individual tier is launched — existing call
    // sites that pass no email keep personal users on the feature set they
    // already had for free (no regression); individual-Pro features pass email.
    if (!email || !individualBillingConfigured()) return true;
    return userPlanIsPro(domain, email);
  }
  try {
    const { plan } = await getTenantPlan(domain);
    planCache.set(domain, { plan, at: Date.now() });
    if (plan === 'pro') return true;
  } catch (err) {
    const cached = planCache.get(domain);
    const fresh = cached && (Date.now() - cached.at) < PLAN_CACHE_TTL_MS;
    log.warn('billing: planIsPro read failed', { domain, usedCache: !!fresh, error: err.message });
    if (fresh && cached.plan === 'pro') return true;
  }
  // Workspace-domain user without a domain plan may still hold an INDIVIDUAL
  // pass (e.g. a teacher whose school won't buy the org plan) — honor what
  // they paid for. Previously this purchase was silently ignored.
  if (!email || !individualBillingConfigured()) return false;
  return userPlanIsPro(domain, email);
}

// Mint a single-use Stripe promotion code for a referral reward, referencing
// the configured coupon (STRIPE_REFERRAL_COUPON_ID — e.g. "100% off once" = one
// free month on a monthly plan). Returns the human-usable code (e.g. "AB12CD"),
// or null when billing/coupon isn't set up — in which case the reward still
// accrues on the inviter's doc and the email falls back to "we'll apply it".
async function createReferralPromoCode(inviterEmail) {
  const couponId = process.env.STRIPE_REFERRAL_COUPON_ID;
  const stripe = getStripe();
  if (!stripe || !couponId) return null;
  try {
    const pc = await stripe.promotionCodes.create({
      coupon: couponId,
      max_redemptions: 1,
      metadata: { referrer: inviterEmail, kind: 'referral_reward' },
    });
    return pc.code;
  } catch (err) {
    log.error('billing: createReferralPromoCode failed', { inviterEmail, error: err.message });
    return null;
  }
}

module.exports = { router, webhookHandler, requireProPlan, planIsPro, createReferralPromoCode };
