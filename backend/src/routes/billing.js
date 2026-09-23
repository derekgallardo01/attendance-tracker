const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const express = require('express');
const log = require('../lib/logger');
const CONFIG = require('../config');
const { getTenantPlan, setTenantPlan, getUserPlan, setUserPlan, logEvent, recordCancellationTelemetry, countUserMonthlyExports, countUserAutoExports, getUserSettings, getDomainTeacherCount, claimWebhookEvent, releaseWebhookEvent } = require('../services/firestore');
const { PERSONAL_EMAIL_DOMAINS } = require('../services/firestore/_core');
const PRICING = require('../config/pricing');

// High-volume education & developing markets eligible for Purchasing Power Parity (PPP) subsidy
const PPP_COUNTRIES = new Set([
  'PH', 'IN', 'ID', 'MY', 'NG', 'VN', 'PK', 'BD', 'KE', 'ZA', 'BR', 'CO', 'PE',
  'UA', 'GH', 'EG', 'TH', 'TR', 'AR', 'LK',
  'MX', 'CL', 'TN', 'SO', 'EC', 'BO', 'GT', 'MA', 'DZ', 'ZM',
]);

const PPP_FLAGS = {
  PH: '🇵🇭', IN: '🇮🇳', ID: '🇮🇩', MY: '🇲🇾', NG: '🇳🇬', VN: '🇻🇳', PK: '🇵🇰', BD: '🇧🇩',
  KE: '🇰🇪', ZA: '🇿🇦', BR: '🇧🇷', CO: '🇨🇴', PE: '🇵🇪', UA: '🇺🇦', GH: '🇬🇭', EG: '🇪🇬',
  TH: '🇹🇭', TR: '🇹🇷', AR: '🇦🇷', LK: '🇱🇰', MX: '🇲🇽', CL: '🇨🇱', TN: '🇹🇳', SO: '🇸🇴',
  EC: '🇪🇨', BO: '🇧🇴', GT: '🇬🇹', MA: '🇲🇦', DZ: '🇩🇿', ZM: '🇿🇲',
};

const { getClientIp, lookupGeo } = require('../lib/geoip');

function detectCountry(req) {
  const rawHeader = req?.headers ? (req.headers['cf-ipcountry'] || req.headers['x-country-code']) : '';
  const header = (typeof rawHeader === 'string' ? rawHeader : '').trim().toUpperCase();
  if (header && header !== 'XX' && header !== 'T1') return header;
  const userCountry = typeof req?.user?.signupGeo?.country === 'string' ? req.user.signupGeo.country.trim().toUpperCase() : '';
  if (userCountry) return userCountry;
  if (req) {
    try {
      const ip = getClientIp(req);
      const geo = lookupGeo(ip);
      if (geo?.country) return geo.country.trim().toUpperCase();
    } catch (_) {}
  }
  return null;
}

// Personal-email tenants (gmail.com etc.) are shared by unrelated users, so they
// can't buy the per-domain org plan — they buy an INDIVIDUAL (per-user) plan
// stored on their user doc. Gated on its own price id so it dark-launches
// independently of the org tier.
const isPersonalDomain = (domain) => PERSONAL_EMAIL_DOMAINS.has((domain || '').toLowerCase());
function individualBillingConfigured() {
  // The individual tier is "launched" when ANY of its sellable prices exists.
  // Keying this on the legacy monthly id alone was a landmine: retiring that
  // env var would have made every personal-domain user Pro for free AND
  // stripped workspace users who PAID for a lifetime/educator pass.
  return !!process.env.STRIPE_SECRET_KEY && !!(
    process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID
    || process.env.STRIPE_EDUCATOR_PRICE_ID
    || process.env.STRIPE_INDIVIDUAL_PRICE_ID
  );
}

// Every plan value either checkout endpoint accepts. Anything else 400s —
// the fallthrough cascade once let an unknown/misspelled plan resolve to a
// DIFFERENT product's price (the documented "$9.99 button charged team price"
// class of bug).
const KNOWN_PLANS = new Set(['team', 'department', 'educator', 'lifetime', 'individual']);
function normalizePlan(raw) {
  if (raw == null || raw === '') return { plan: null };            // caller omitted it — legacy inference
  if (typeof raw !== 'string') return { invalid: true };
  const plan = raw.trim().toLowerCase();
  return KNOWN_PLANS.has(plan) ? { plan } : { invalid: true };
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
  const { plan: normalizedPlan, invalid: planInvalid } = normalizePlan(req.body?.plan);
  if (planInvalid) {
    return res.status(400).json({ error: 'Unknown plan.' });
  }
  const isEducator = normalizedPlan === 'educator';
  const isLifetime = normalizedPlan === 'lifetime';
  const isTeamPlan = normalizedPlan === 'team';
  const isDepartment = normalizedPlan === 'department';
  // Department is a DOMAIN plan (a mid tier between the $19.99 team lifetime and
  // the $149/yr Institution), so it shares every domain-plan rule with `team`.
  const isDomainPlan = isTeamPlan || isDepartment;
  // A personal-email buyer can't own the shared gmail.com/etc tenant — a domain
  // purchase from them would flip the SHARED tenant doc Pro (cross-tenant
  // grant) while granting the buyer nothing (their gates read the user doc).
  if (isDomainPlan && isPersonalDomain(domain)) {
    return res.status(400).json({ error: 'The domain license covers a Google Workspace domain. On a personal account, pick the Lifetime or Educator pass instead.' });
  }
  const individual = (isEducator || isLifetime)
    ? true
    : (isDomainPlan
      ? false
      : (normalizedPlan === 'individual' ? true : isPersonalDomain(domain)));
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
    ? process.env.STRIPE_EDUCATOR_PRICE_ID // no fallback: educator ($4.99/yr) and individual-annual are DIFFERENT products at different amounts
    : (isLifetime
      ? process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID
      : (isDepartment
        ? process.env.STRIPE_DEPARTMENT_PRICE_ID // recurring $59/yr domain mid-tier; NO fallback so it can never resolve to the team/institution price
        : (individual
          ? (annual && process.env.STRIPE_INDIVIDUAL_ANNUAL_PRICE_ID) || process.env.STRIPE_INDIVIDUAL_PRICE_ID
          : (annual && process.env.STRIPE_ANNUAL_PRICE_ID) || process.env.STRIPE_PRICE_ID)));
  if (!stripe || !priceId) {
    return res.status(503).json({ error: 'Billing is not configured yet.' });
  }
  try {
    // client_reference_id tags who the subscription is for: `user:<email>` for
    // an individual, or the bare domain for an org. Metadata carries both so the
    // webhook can route to setUserPlan vs setTenantPlan.
    // `plan` in metadata: the refund/dispute handler routes on it, and it
    // rides payment_intent_data so one-time charges carry it end-to-end.
    const planName = normalizedPlan || (individual ? 'individual' : 'team');
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

    // Prices are the real selling prices now — LAUNCH50 is retired. A CLEAN
    // Checkout Session (no `discounts`, and no `allow_promotion_codes` unless a
    // real code is passed) is what lets Stripe Adaptive Pricing present local
    // currency + local payment methods (UPI, wallets, …) to PPP buyers; a
    // `discounts` param or an open promo box suppresses Adaptive Pricing.
    // Ignore a stale `LAUNCH50` from an old cached client. An explicit
    // referral/promo code still opens the promo box for that one checkout
    // (Adaptive Pricing off there — a fair trade for the discount).
    const promo = (req.body.promo ?? '').trim().toUpperCase();
    const userCountry = detectCountry(req);
    const isPppEligible = !promo && userCountry && PPP_COUNTRIES.has(userCountry);

    const sessionMeta = {
      ...meta,
      ...(userCountry ? { country: userCountry } : {}),
      ...(isPppEligible ? { pppDiscount: '1' } : {}),
    };

    const sessionParams = {
      mode: isRecurring ? 'subscription' : 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: individual ? `user:${email.toLowerCase()}` : domain,
      customer_email: email,
      success_url: `${CONFIG.publicSiteUrl}/${backTo}?upgraded=1`,
      cancel_url: `${CONFIG.publicSiteUrl}/${backTo}`,
      metadata: sessionMeta,
      // Abandoned-checkout recovery: if the session expires unpaid (~24h),
      // Stripe emails the buyer a link to finish — recovering the highest-intent
      // non-payers (they already reached checkout).
      after_expiration: { recovery: { enabled: true } },
    };
    if (promo && promo !== 'LAUNCH50') {
      sessionParams.allow_promotion_codes = true;
    } else if (isPppEligible) {
      sessionParams.discounts = [{ coupon: 'PPP50' }];
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
      // Fail closed: we only get here when Stripe POSITIVELY reported the
      // price as one-time (retrieve errors default to recurring above).
      log.error('billing: educator price is one-time, not recurring — refusing checkout', { priceId });
      return res.status(503).json({ error: 'The educator plan is temporarily unavailable.' });
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    log.error('billing: checkout create failed', { domain, individual, error: err.message });
    res.status(502).json({ error: 'Could not start checkout.' });
  }
});

// Cooldown map: email -> timestamp (prevents spam / abuse; 10 min window for manual, 72h for automated)
const upgradeLinkCooldown = new Map();

/**
 * Send an upgrade link email with direct 1-click checkout sessions.
 * Applies a 24-hour 20% discount (or 50% regional PPP subsidy).
 */
async function sendUpgradeLinkForUser({
  email,
  domain,
  displayName = null,
  reason = 'manual',
  country = null,
  language = null,
  req = null,
  cooldownMs = null,
}) {
  const normalizedEmail = email ? email.toLowerCase() : null;
  if (!normalizedEmail) return { error: 'Email required.' };

  // CAN-SPAM: honor suppression list
  try {
    const { isEmailSuppressed } = require('../services/firestore');
    if (await isEmailSuppressed(normalizedEmail)) {
      return { skipped: 'suppressed' };
    }
  } catch (e) {
    log.warn('billing: suppression check failed in sendUpgradeLinkForUser', { error: e.message });
  }

  // For automated triggers, skip if user is already Pro (only when billing is configured)
  if (reason !== 'manual' && domain && billingConfigured()) {
    try {
      const pro = await planIsPro(domain, normalizedEmail);
      if (pro) return { skipped: 'already_pro' };
    } catch (e) {
      log.warn('billing: sendUpgradeLinkForUser pro check failed', { error: e.message });
    }
  }

  // Cooldown check (10 min for manual, 72h for automated by default)
  const now = Date.now();
  const lastSent = upgradeLinkCooldown.get(normalizedEmail) || 0;
  const cooldown = cooldownMs != null
    ? cooldownMs
    : (reason === 'manual' ? 10 * 60 * 1000 : 72 * 60 * 60 * 1000);

  if (now - lastSent < cooldown) {
    return { success: true, alreadySent: true, email: normalizedEmail };
  }

  const stripe = getStripe();
  const userCountry = country || (req ? detectCountry(req) : null);
  const isPppEligible = userCountry && PPP_COUNTRIES.has(userCountry);
  const flag = userCountry ? (PPP_FLAGS[userCountry] || '') : '';

  let educatorUrl = `${CONFIG.publicSiteUrl}/history.html?upgrade=educator`;
  let lifetimeUrl = `${CONFIG.publicSiteUrl}/history.html?upgrade=lifetime`;

  if (stripe) {
    try {
      const meta = { individual: '1', domain, email: normalizedEmail, source: 'upgrade_link_email', reason };
      const commonDiscounts = isPppEligible ? [{ coupon: 'PPP50' }] : [{ coupon: 'SAVE20' }];

      const createSession = async (params) => {
        try {
          return await stripe.checkout.sessions.create(params);
        } catch (err) {
          if (params.discounts && /coupon|promo/i.test(err.message)) {
            log.warn('billing: checkout coupon error, falling back without discount', { error: err.message });
            const { discounts, ...rest } = params;
            return await stripe.checkout.sessions.create(rest);
          }
          throw err;
        }
      };

      const [educatorSession, lifetimeSession] = await Promise.all([
        process.env.STRIPE_EDUCATOR_PRICE_ID ? createSession({
          mode: 'subscription',
          line_items: [{ price: process.env.STRIPE_EDUCATOR_PRICE_ID, quantity: 1 }],
          client_reference_id: `user:${normalizedEmail}`,
          customer_email: normalizedEmail,
          success_url: `${CONFIG.publicSiteUrl}/history.html?upgraded=1`,
          cancel_url: `${CONFIG.publicSiteUrl}/history.html`,
          metadata: { ...meta, plan: 'educator', ...(isPppEligible ? { pppDiscount: '1' } : { promoDiscount: 'SAVE20' }) },
          ...(commonDiscounts ? { discounts: commonDiscounts } : {}),
        }) : null,
        process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID ? createSession({
          mode: 'payment',
          customer_creation: 'always',
          line_items: [{ price: process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID, quantity: 1 }],
          client_reference_id: `user:${normalizedEmail}`,
          customer_email: normalizedEmail,
          success_url: `${CONFIG.publicSiteUrl}/history.html?upgraded=1`,
          cancel_url: `${CONFIG.publicSiteUrl}/history.html`,
          metadata: { ...meta, plan: 'lifetime', ...(isPppEligible ? { pppDiscount: '1' } : { promoDiscount: 'SAVE20' }) },
          ...(commonDiscounts ? { discounts: commonDiscounts } : {}),
        }) : null,
      ]);

      if (educatorSession?.url) educatorUrl = educatorSession.url;
      if (lifetimeSession?.url) lifetimeUrl = lifetimeSession.url;
    } catch (e) {
      log.warn('billing: could not pre-create Stripe checkout sessions for upgrade email', { error: e.message });
    }
  }

  // 24-hour special offer: 20% discount ($3.99/yr, $7.99) or 50% PPP subsidy ($2.49/yr, $4.99)
  const educatorPrice = isPppEligible ? '$2.49' : '$3.99';
  const lifetimePrice = isPppEligible ? '$4.99' : '$7.99';

  const { sendUpgradeLinkEmail } = require('../lib/notifications');
  await sendUpgradeLinkEmail({
    to: normalizedEmail,
    displayName,
    educatorUrl,
    lifetimeUrl,
    educatorPrice,
    lifetimePrice,
    flag,
    isPpp: isPppEligible,
    country: userCountry,
    domain,
    language,
  });
  upgradeLinkCooldown.set(normalizedEmail, now);
  try {
    await logEvent(domain, { email: normalizedEmail, type: 'upgrade_link_emailed', meta: { isPpp: isPppEligible, country: userCountry, reason } });
  } catch {}
  return { success: true, email: normalizedEmail };
}

// POST /api/billing/send-upgrade-link — user-initiated opt-in email with direct
// upgrade checkout links so teachers ending a live class can review & pay peacefully
// from their desk without students watching. Zero popup, zero spam.
router.post('/billing/send-upgrade-link', requireAuth, async (req, res) => {
  const email = req.user?.email;
  if (!email) return res.status(400).json({ error: 'Email required.' });

  try {
    const result = await sendUpgradeLinkForUser({
      email,
      domain: req.user.domain,
      displayName: req.user.displayName,
      reason: 'manual',
      req,
      language: req.user.language || req.user.locale || null,
    });
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch (err) {
    log.error('billing: sendUpgradeLinkEmail failed', { email, error: err.message });
    res.status(500).json({ error: 'Could not send upgrade email right now.' });
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
  const { plan: normalizedPublicPlan, invalid: publicPlanInvalid } = normalizePlan(req.body?.plan);
  if (publicPlanInvalid) {
    return res.status(400).json({ error: 'Unknown plan.' });
  }
  const plan = normalizedPublicPlan || 'lifetime';
  // Annual is opt-IN only (mirrors the authed checkout at :66). Defaulting to
  // 'annual' was a trap: a bare {plan:'team'} would resolve to the $149/yr
  // Institution price AND auto-apply LAUNCH50 — wrong tier + a discount
  // Institution must never get.
  const annual = req.body?.interval === 'annual';
  const email = (req.body?.email || '').trim().toLowerCase() || undefined;
  const isTeam = plan === 'team';
  const isDepartment = plan === 'department';
  const isDomain = isTeam || isDepartment; // both are per-domain plans
  const isEducator = plan === 'educator';

  // A domain purchase MUST know which domain it activates. Without this, a
  // signed-out visitor could pay for a domain plan and the webhook's org
  // branch would have nothing to provision — money taken, nothing granted.
  if (isDomain) {
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
    ? process.env.STRIPE_EDUCATOR_PRICE_ID // no fallback: educator and individual-annual are DIFFERENT products
    : (isDepartment
        ? process.env.STRIPE_DEPARTMENT_PRICE_ID // recurring $59/yr domain mid-tier; NO fallback (never the team/institution price)
        : (isTeam
            ? ((annual && process.env.STRIPE_ANNUAL_PRICE_ID) || process.env.STRIPE_PRICE_ID)
            : (plan === 'lifetime'
                ? process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID
                : ((annual && process.env.STRIPE_INDIVIDUAL_ANNUAL_PRICE_ID) || process.env.STRIPE_INDIVIDUAL_PRICE_ID))));

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
      individual: isDomain ? '0' : '1',
      plan,
      source: 'public_pricing',
      ...(email ? { email } : {}),
      // Stamp the domain for domain purchases so the webhook can provision even
      // if client_reference_id is ever absent from the completed session.
      ...(isDomain && email ? { domain: email.split('@')[1] } : {}),
    };

    // Real selling prices now — LAUNCH50 retired. Clean session (no discounts,
    // no promo box unless a real code is passed) so Stripe Adaptive Pricing can
    // present local currency + rails to PPP buyers. See the authed checkout
    // above for the full rationale. Ignore a stale LAUNCH50 from cached clients.
    const promo = (req.body?.promo ?? '').trim().toUpperCase();

    const sessionParams = {
      mode: isRecurring ? 'subscription' : 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${CONFIG.publicSiteUrl}/history.html?upgraded=1`,
      cancel_url: `${CONFIG.publicSiteUrl}/pricing.html`,
      metadata: meta,
      // Abandoned-checkout recovery (see authed checkout above for rationale).
      after_expiration: { recovery: { enabled: true } },
    };
    if (email) {
      // Deliberately NOT prefilled as customer_email: this endpoint is
      // unauthenticated, and prefilling a caller-supplied address combined with
      // abandoned-checkout recovery would let anyone queue Stripe-branded
      // "finish your purchase" emails to arbitrary victims (60/min/IP). The
      // buyer types their email into Stripe's hosted page instead; recovery
      // and receipts go to what THEY typed, while metadata/client_reference_id
      // (harmless — never emailed) keep provisioning intact.
      sessionParams.client_reference_id = isDomain ? email.split('@')[1] : `user:${email}`;
    }
    if (promo && promo !== 'LAUNCH50') {
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
      // Same fail-closed rule as the authed checkout: a one-time educator price
      // silently converts annual revenue into a lifetime pass.
      log.error('billing: educator price is one-time, not recurring — refusing public checkout', { priceId });
      return res.status(503).json({ error: 'The educator plan is temporarily unavailable.' });
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

// POST /api/billing/cancel-subscription — transparent self-serve cancellation.
// Tells Stripe to cancel the subscription AT PERIOD END:
// 1. The customer's credit card is NEVER charged again (auto-renewal stopped).
// 2. The customer keeps full Pro access through the end of the period they paid for.
// 3. Sends an immediate email confirmation with the exact end date.
router.post('/billing/cancel-subscription', requireAuth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured yet.' });
  const email = (req.user.email || '').toLowerCase();
  const domain = req.user.domain;
  let individual = isPersonalDomain(domain);

  try {
    let planInfo = individual
      ? await getUserPlan(domain, email)
      : await getTenantPlan(domain);
    if (!planInfo.stripeSubscriptionId && !individual) {
      const userPlan = await getUserPlan(domain, email);
      if (userPlan.stripeSubscriptionId) {
        planInfo = userPlan;
        individual = true;
      }
    }

    const subId = planInfo.stripeSubscriptionId;
    if (!subId) {
      return res.status(404).json({ error: 'No active recurring subscription found to cancel.' });
    }

    // Cancel at period end in Stripe — guarantees NO further charges while preserving access
    const subscription = await stripe.subscriptions.update(subId, {
      cancel_at_period_end: true,
    });

    const currentPeriodEnd = subscription.current_period_end
      ? new Date(subscription.current_period_end * 1000).toISOString()
      : null;

    const cancelPatch = {
      cancelAtPeriodEnd: true,
      cancelAt: currentPeriodEnd,
      currentPeriodEnd,
      canceledAt: new Date().toISOString(),
    };

    if (individual) {
      await setUserPlan(domain, email, {
        individualPlan: 'pro',
        individualBillingStatus: subscription.status,
        ...cancelPatch,
      });
    } else {
      await setTenantPlan(domain, {
        plan: 'pro',
        billingStatus: subscription.status,
        ...cancelPatch,
      });
    }

    try {
      await recordCancellationTelemetry({
        category: 'subscription',
        type: 'cancelled',
        email,
        domain,
        meta: { subId, currentPeriodEnd, individual, source: 'in_app_settings' },
      });
      log.info('telemetry: subscription_cancelled', { email, domain, subId, currentPeriodEnd, individual, source: 'in_app_settings' });
    } catch {}

    // Send immediate confirmation email with written guarantee to user
    const formattedDate = currentPeriodEnd
      ? new Date(currentPeriodEnd).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : null;
    try {
      const { sendSubscriptionCancelledEmail } = require('../lib/notifications');
      await sendSubscriptionCancelledEmail({
        to: email,
        displayName: req.user.displayName,
        planName: planInfo.plan || 'Pro',
        currentPeriodEnd: formattedDate,
        language: req.body?.language || req.user.language || req.user.locale || null,
        country: req.body?.country || detectCountry(req),
        domain,
      });
    } catch (e) {
      log.warn('billing: sendSubscriptionCancelledEmail failed', { email, error: e.message });
    }

    // Send admin notification alert to owner
    try {
      const { sendAdminSubscriptionCancelledNotification } = require('../lib/notifications');
      sendAdminSubscriptionCancelledNotification({
        email,
        displayName: req.user.displayName,
        domain,
        plan: planInfo.plan || (individual ? 'educator' : 'team'),
        subscriptionId: subId,
        customerId: subscription.customer,
        currentPeriodEnd: formattedDate,
        source: 'in_app_settings',
      }).catch(err => log.warn('billing: sendAdminSubscriptionCancelledNotification failed', { email, error: err.message }));
    } catch (e) {
      log.warn('billing: sendAdminSubscriptionCancelledNotification trigger error', { email, error: e.message });
    }

    res.json({
      success: true,
      cancelAtPeriodEnd: true,
      currentPeriodEnd,
      message: 'Subscription auto-renewal cancelled. Your card will not be charged again.',
    });
  } catch (err) {
    log.error('billing: cancel-subscription failed', { domain, email, error: err.message });
    res.status(500).json({ error: 'Could not cancel subscription right now. Please try again or contact support.' });
  }
});

// POST /api/billing/resume-subscription — revert cancellation before period end.
router.post('/billing/resume-subscription', requireAuth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured yet.' });
  const email = (req.user.email || '').toLowerCase();
  const domain = req.user.domain;
  let individual = isPersonalDomain(domain);

  try {
    let planInfo = individual
      ? await getUserPlan(domain, email)
      : await getTenantPlan(domain);
    if (!planInfo.stripeSubscriptionId && !individual) {
      const userPlan = await getUserPlan(domain, email);
      if (userPlan.stripeSubscriptionId) {
        planInfo = userPlan;
        individual = true;
      }
    }

    const subId = planInfo.stripeSubscriptionId;
    if (!subId) {
      return res.status(404).json({ error: 'No subscription found to resume.' });
    }

    const subscription = await stripe.subscriptions.update(subId, {
      cancel_at_period_end: false,
    });

    const resumePatch = {
      cancelAtPeriodEnd: false,
      cancelAt: null,
    };

    if (individual) {
      await setUserPlan(domain, email, {
        individualPlan: 'pro',
        individualBillingStatus: subscription.status,
        ...resumePatch,
      });
    } else {
      await setTenantPlan(domain, {
        plan: 'pro',
        billingStatus: subscription.status,
        ...resumePatch,
      });
    }

    try {
      await recordCancellationTelemetry({
        category: 'subscription',
        type: 'resumed',
        email,
        domain,
        meta: { subId, individual, source: 'in_app_settings' },
      });
      log.info('telemetry: subscription_resumed', { email, domain, subId, individual, source: 'in_app_settings' });
    } catch {}

    res.json({
      success: true,
      cancelAtPeriodEnd: false,
      message: 'Your subscription has been resumed.',
    });
  } catch (err) {
    log.error('billing: resume-subscription failed', { domain, email, error: err.message });
    res.status(500).json({ error: 'Could not resume subscription right now.' });
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
    let domainUserCount = 0;
    if (!individual && req.user.domain && typeof getDomainTeacherCount === 'function') {
      try {
        domainUserCount = await getDomainTeacherCount(req.user.domain);
      } catch (_) {}
    }

    const userCountry = detectCountry(req);
    const pppDiscount = userCountry && PPP_COUNTRIES.has(userCountry)
      ? { eligible: true, country: userCountry, percentOff: 50 }
      : null;

    let trialInfo = null;
    if (plan.plan !== 'pro' && req.user) {
      try {
        const settings = await getUserSettings(req.user.domain, req.user.email);
        if (settings?.autoExportTrialStartedAt) {
          const startMs = Date.parse(settings.autoExportTrialStartedAt);
          if (!isNaN(startMs)) {
            const elapsedDays = (Date.now() - startMs) / 86400000;
            const daysRemaining = Math.max(0, (PRICING.AUTO_EXPORT_TRIAL_DAYS || 14) - elapsedDays);
            const autoSavedClasses = typeof countUserAutoExports === 'function'
              ? await countUserAutoExports(req.user.domain, req.user.email)
              : 0;
            trialInfo = {
              active: daysRemaining > 0,
              daysRemaining: Math.ceil(daysRemaining),
              autoSavedClasses,
              pppDiscount: !!pppDiscount,
            };
          }
        }
      } catch (err) {
        log.warn('billing: trialInfo calculation failed', { error: err.message });
      }
    }

    const isEdu = isEduDomain(req.user?.email, req.user?.domain);

    res.json({
      ...plan,
      individual,
      isEdu,
      billingConfigured: individual ? individualBillingConfigured() : billingConfigured(),
      annualAvailable,
      educatorAvailable: !!process.env.STRIPE_EDUCATOR_PRICE_ID,
      exportQuota,
      pppDiscount,
      country: userCountry || null,
      trialInfo,
      domainUserCount,
      domain: req.user?.domain || null,
      cancelAtPeriodEnd: !!plan.cancelAtPeriodEnd,
      cancelAt: plan.cancelAt || null,
      currentPeriodEnd: plan.currentPeriodEnd || plan.cancelAt || null,
      isRecurring: !!plan.stripeSubscriptionId,
      subscriptionId: plan.stripeSubscriptionId || null,
      // Display-price truth for every frontend surface (see config/pricing.js).
      pricing: { ...PRICING.PRICES, quotaLimit: PRICING.FREE_MONTHLY_EXPORT_LIMIT },
    });
  } catch (err) {
    log.error('billing: status failed', { domain: req.user.domain, error: err.message });
    res.status(500).json({ error: 'Failed to fetch plan.' });
  }
});

function isEduDomain(email, domain) {
  const e = (email || '').toLowerCase();
  const d = (domain || '').toLowerCase();
  return /\.(edu|edu\.[a-z]{2}|ac\.[a-z]{2}|gov\.[a-z]{2}|k12\.[a-z]{2}(\.us)?|k12\.[a-z]{2}|sch\.[a-z]{2}|education)$/i.test(e) ||
         /@(.*\.)?(school|academy|college|university|deped|alokitohridoy|education|gymnasium|lyceum)/i.test(e) ||
         /\.(edu|ac|education)\b/i.test(d) ||
         /\.(edu|edu\.[a-z]{2}|ac\.[a-z]{2}|gov\.[a-z]{2}|k12\.[a-z]{2}(\.us)?|k12\.[a-z]{2}|sch\.[a-z]{2}|education)$/i.test(d);
}

// POST /api/billing/school-license-request — 1-click inquiry from institutional / .edu / .ac users
router.post('/billing/school-license-request', requireAuth, async (req, res) => {
  try {
    const email = (req.user.email || '').toLowerCase();
    const domain = req.user.domain || email.split('@')[1] || '';
    const isEdu = isEduDomain(email, domain);

    await logEvent(req.user.domain, {
      email,
      type: 'school_license_requested',
      meta: { domain, isEdu, requestedAt: new Date().toISOString() },
    });

    log.info('billing: school license requested', { domain, email, isEdu });
    res.json({ ok: true, message: 'School license request recorded' });
  } catch (err) {
    log.error('billing: school license request failed', { error: err.message });
    res.status(500).json({ error: 'Failed to record school license request' });
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
            try {
              const { sendUpgradeNotification } = require('../lib/notifications');
              const { getUser } = require('../services/firestore');
              const userDoc = await getUser(domain, email.toLowerCase());
              sendUpgradeNotification({
                email: email.toLowerCase(),
                displayName: userDoc?.displayName || s.customer_details?.name || '',
                domain,
                plan: s.metadata?.plan || 'individual',
                amountTotal: s.amount_total,
                currency: s.currency,
                customerId: s.customer || null,
                subscriptionId: s.subscription || null,
                country: s.customer_details?.address?.country || userDoc?.signupGeo?.country || null,
                isTeam: false,
              }).catch(err => log.warn('billing: sendUpgradeNotification failed (individual)', { email, error: err.message }));
            } catch (e) {
              log.warn('billing: error dispatching upgrade notification (individual)', { email, error: e.message });
            }
            // Backfill routing metadata onto the subscription when the session
            // was created signed-out (email unknown at session time). The
            // subscription.updated/deleted handlers route ONLY on
            // sub.metadata — without this, cancellation / non-payment of a
            // signed-out educator or annual pass never downgrades it.
            const subId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id;
            if (subId && !s.metadata?.email) {
              try {
                await stripe.subscriptions.update(subId, {
                  metadata: { individual: '1', plan: s.metadata?.plan || 'individual', email: email.toLowerCase(), domain },
                });
              } catch (e) {
                log.warn('billing: could not backfill subscription metadata (individual)', { subId, error: e.message });
              }
            }
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
            try {
              const { sendUpgradeNotification } = require('../lib/notifications');
              const buyerEmail = s.customer_details?.email || s.customer_email || s.metadata?.initiatedBy || 'admin';
              sendUpgradeNotification({
                email: buyerEmail,
                displayName: s.customer_details?.name || '',
                domain,
                plan: s.metadata?.plan || 'team',
                amountTotal: s.amount_total,
                currency: s.currency,
                customerId: s.customer || null,
                subscriptionId: s.subscription || null,
                country: s.customer_details?.address?.country || null,
                isTeam: true,
              }).catch(err => log.warn('billing: sendUpgradeNotification failed (team)', { domain, error: err.message }));
            } catch (e) {
              log.warn('billing: error dispatching upgrade notification (team)', { domain, error: e.message });
            }
            // Same backfill as the individual branch: lifecycle events for an
            // org subscription route on sub.metadata.domain only.
            const subId = typeof s.subscription === 'string' ? s.subscription : s.subscription?.id;
            if (subId && !s.metadata?.domain) {
              try {
                await stripe.subscriptions.update(subId, {
                  metadata: { individual: '0', plan: s.metadata?.plan || 'team', domain },
                });
              } catch (e) {
                log.warn('billing: could not backfill subscription metadata (org)', { subId, error: e.message });
              }
            }
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
        const cancelAtPeriodEnd = active && sub.cancel_at_period_end === true;
        const currentPeriodEnd = active && sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null;
        const cancelPatch = {
          cancelAtPeriodEnd,
          cancelAt: cancelAtPeriodEnd ? currentPeriodEnd : null,
          currentPeriodEnd: currentPeriodEnd || null,
        };
        if (sub.metadata?.individual === '1') {
          const domain = sub.metadata?.domain;
          const email = sub.metadata?.email;
          if (domain && email) {
            await setUserPlan(domain, email, {
              individualPlan: active ? 'pro' : 'free',
              individualBillingStatus: sub.status,
              individualStripeSubscriptionId: active ? sub.id : null,
              ...(sub.customer ? { individualStripeCustomerId: sub.customer } : {}),
              ...cancelPatch,
            });
          }
        } else {
          const domain = sub.metadata?.domain;
          if (domain) {
            await setTenantPlan(domain, {
              plan: active ? 'pro' : 'free',
              billingStatus: sub.status,
              stripeSubscriptionId: active ? sub.id : null,
              ...(sub.customer ? { stripeCustomerId: sub.customer } : {}), // also persist on subscription events (B6/portal)
              ...cancelPatch,
            });
          }
        }

        const subEmail = sub.metadata?.email || sub.customer;
        const subDomain = sub.metadata?.domain || (sub.metadata?.email ? sub.metadata.email.split('@')[1] : null);
        if (cancelAtPeriodEnd) {
          try {
            await recordCancellationTelemetry({
              category: 'subscription',
              type: 'cancelled_webhook',
              email: subEmail,
              domain: subDomain,
              meta: { subId: sub.id, customerId: sub.customer, source: 'stripe_webhook' },
            });
            log.info('telemetry: subscription_cancelled_webhook', { subId: sub.id, email: subEmail });
          } catch {}
        } else if (event.type === 'customer.subscription.deleted') {
          try {
            await recordCancellationTelemetry({
              category: 'subscription',
              type: 'deleted_webhook',
              email: subEmail,
              domain: subDomain,
              meta: { subId: sub.id, customerId: sub.customer, source: 'stripe_webhook' },
            });
            log.info('telemetry: subscription_deleted_webhook', { subId: sub.id, email: subEmail });
          } catch {}
        }
        break;
      }
      case 'charge.refunded':
      case 'charge.dispute.created':
      case 'charge.dispute.closed': {
        // refunds.html promises refunds — honoring one must also revoke the
        // plan (before this, a refunded lifetime pass kept Pro forever).
        // Metadata resolution, in order of where Stripe actually puts it:
        //   1. the PaymentIntent (one-time purchases: payment_intent_data)
        //   2. the Charge itself
        //   3. subscription invoices: charge → invoice → subscription.metadata
        //      (invoice charges do NOT inherit subscription metadata)
        const obj = event.data.object; // Charge for refunds, Dispute for disputes
        const asId = (v) => (typeof v === 'string' ? v : v?.id) || null;
        if (event.type === 'charge.refunded') {
          // charge.refunded fires on ANY refund, including partial. A $2
          // goodwill refund on a $149 Institution must not yank the whole
          // org's plan — skip only when Stripe POSITIVELY reports a partial
          // (refunded:false + amount_refunded < amount); ambiguity revokes,
          // matching the old behavior.
          const partialRefund = obj.refunded !== true
            && obj.amount_refunded != null && obj.amount != null
            && obj.amount_refunded < obj.amount;
          if (partialRefund) {
            log.info('billing: partial refund — plan retained', { eventId: event.id, amount: obj.amount, refunded: obj.amount_refunded });
            break;
          }
        }
        // A dispute we WON restores the plan the dispute.created handler
        // revoked; any other closure (lost, warning_closed) leaves the
        // downgrade in place.
        if (event.type === 'charge.dispute.closed' && obj.status !== 'won') break;
        const regrant = event.type === 'charge.dispute.closed';
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
        // Signed-out one-time purchases can lack metadata.email entirely — fall
        // back to the charge's billing details so a refund/chargeback still
        // revokes (the GRANT path already falls back to customer_details; the
        // revoke path must not be weaker than the grant path).
        let billingEmail = event.type === 'charge.refunded'
          ? (obj.billing_details?.email || obj.receipt_email || null)
          : null;
        if (!meta?.email && !billingEmail && asId(obj.charge)) {
          try {
            const ch = await stripe.charges.retrieve(asId(obj.charge));
            billingEmail = ch?.billing_details?.email || ch?.receipt_email || null;
          } catch (e) {
            log.warn('billing: billing_details fallback lookup failed', { eventId: event.id, error: e.message });
          }
        }
        // Route on identity, not on a `plan` label (older sessions lack it).
        // A present buyer email means an individual pass UNLESS explicitly
        // flagged as an org (individual==='0'). Authed individual metadata
        // carries `domain` too (billing.js:88), so keying off `!domain` would
        // misroute such a refund into a whole-domain downgrade.
        const email = ((meta?.email || billingEmail) || '').toLowerCase();
        const isIndividual = meta?.individual === '1' || (!!email && meta?.individual !== '0');
        const orgDomain = isIndividual ? null : meta?.domain;
        const planLabel = meta?.plan || (isIndividual ? 'individual' : 'team');
        const status = regrant ? 'active' : (event.type === 'charge.refunded' ? 'refunded' : 'disputed');
        const planValue = regrant ? 'pro' : 'free';
        if (isIndividual && email.includes('@')) {
          const domain = meta?.domain || email.split('@')[1];
          await setUserPlan(domain, email, { individualPlan: planValue, individualBillingStatus: status });
          try { await logEvent(domain, { email, type: regrant ? 'dispute_won' : 'refunded', meta: { plan: planLabel, kind: event.type } }); } catch {}
        } else if (orgDomain && !isPersonalDomain(orgDomain)) {
          await setTenantPlan(orgDomain, { plan: planValue, billingStatus: status });
          try { await logEvent(orgDomain, { email: meta?.email || meta?.initiatedBy || 'admin', type: regrant ? 'dispute_won' : 'refunded', meta: { plan: planLabel, kind: event.type } }); } catch {}
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

module.exports = {
  router,
  webhookHandler,
  requireProPlan,
  planIsPro,
  createReferralPromoCode,
  sendUpgradeLinkForUser,
  upgradeLinkCooldown,
};
