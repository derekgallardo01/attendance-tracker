const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const express = require('express');
const log = require('../lib/logger');
const CONFIG = require('../config');
const jwt = require('jsonwebtoken');
const { getTenantPlan, setTenantPlan, getUserPlan, setUserPlan, logEvent, recordCancellationTelemetry, countUserMonthlyExports, countUserAutoExports, getUserSettings, getDomainTeacherCount, claimWebhookEvent, releaseWebhookEvent, persistExport, isMeetingUnlocked, getUser, markUserLargeClassGraceUsed, isUserDeleted } = require('../services/firestore');
const { PERSONAL_EMAIL_DOMAINS, domainOf } = require('../services/firestore/_core');
const PRICING = require('../config/pricing');

// High-volume education & developing markets eligible for Purchasing Power Parity (PPP) subsidy
const PPP_COUNTRIES = new Set([
  'PH', 'IN', 'ID', 'MY', 'NG', 'VN', 'PK', 'BD', 'KE', 'ZA', 'BR', 'CO', 'PE',
  'UA', 'GH', 'EG', 'TH', 'TR', 'AR', 'LK',
  'MX', 'CL', 'TN', 'SO', 'EC', 'BO', 'GT', 'MA', 'DZ', 'ZM', 'KZ',
  'RO', 'HN', 'SV', 'NI', 'BG', 'PY',
]);

const PPP_FLAGS = {
  PH: '🇵🇭', IN: '🇮🇳', ID: '🇮🇩', MY: '🇲🇾', NG: '🇳🇬', VN: '🇻🇳', PK: '🇵🇰', BD: '🇧🇩',
  KE: '🇰🇪', ZA: '🇿🇦', BR: '🇧🇷', CO: '🇨🇴', PE: '🇵🇪', UA: '🇺🇦', GH: '🇬🇭', EG: '🇪🇬',
  TH: '🇹🇭', TR: '🇹🇷', AR: '🇦🇷', LK: '🇱🇰', MX: '🇲🇽', CL: '🇨🇱', TN: '🇹🇳', SO: '🇸🇴',
  EC: '🇪🇨', BO: '🇧🇴', GT: '🇬🇹', MA: '🇲🇦', DZ: '🇩🇿', ZM: '🇿🇲', KZ: '🇰🇿',
  RO: '🇷🇴', HN: '🇭🇳', SV: '🇸🇻', NI: '🇳🇮', BG: '🇧🇬', PY: '🇵🇾',
};


const { getClientIp, lookupGeo } = require('../lib/geoip');

function detectCountry(req) {
  const queryCountry = (typeof req?.query?.country === 'string' ? req.query.country : (typeof req?.body?.country === 'string' ? req.body.country : '')).trim().toUpperCase();
  if (queryCountry && queryCountry.length === 2 && queryCountry !== 'XX' && queryCountry !== 'T1') return queryCountry;
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
const KNOWN_PLANS = new Set(['team', 'department', 'educator', 'lifetime', 'individual', 'single_meeting']);
function normalizePlan(raw) {
  if (raw == null || raw === '') return { plan: null };            // caller omitted it — legacy inference
  if (typeof raw !== 'string') return { invalid: true };
  const plan = raw.trim().toLowerCase();
  return KNOWN_PLANS.has(plan) ? { plan } : { invalid: true };
}

// Dedicated INR prices for India (₹399 lifetime, ₹199/yr educator).
// Cross-border USD payments in India face severe RBI friction (mandatory international
// transaction enablement, 2FA e-mandate rules for recurring subs). Presenting INR
// with UPI + Card support unlocks local payment rails (GPay, PhonePe, Paytm, RuPay).
function getInrPrices() {
  return {
    lifetime: process.env.STRIPE_INDIVIDUAL_LIFETIME_INR_PRICE_ID || 'price_1UKfQpRPP93YBXrOP42OOuV0',
  };
}

// Sanitizes a Stripe price ID string, stripping accidental extra whitespace,
// newlines, or concatenated env-var keys (e.g. from space-separated CLI updates).
function sanitizePriceId(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const token = raw.trim().split(/\s+/)[0];
  return token || null;
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

/**
 * Safely create a Stripe checkout session with defensive parameter sanitization and fallback:
 * 1. Sanitizes metadata (ensures values are strings <= 500 chars, eliminates undefined/null)
 * 2. Removes any unsupported properties (e.g. automatic_payment_methods is only valid on PaymentIntents, not Checkout Sessions)
 * 3. Catches coupon/discount rejection errors (e.g. invalid, inactive, or currency mismatch)
 *    and retries creation without discounts so the buyer never suffers a 502 checkout crash.
 * 4. Logs detailed context on any unhandled Stripe API errors.
 */
async function createSafeCheckoutSession(stripe, sessionParams, context = {}) {
  const params = { ...sessionParams };

  // Never pass automatic_payment_methods to stripe.checkout.sessions.create
  delete params.automatic_payment_methods;

  // Sanitize metadata objects
  const sanitizeMeta = (metaObj) => {
    if (!metaObj || typeof metaObj !== 'object') return metaObj;
    const clean = {};
    for (const [k, v] of Object.entries(metaObj)) {
      if (v !== undefined && v !== null) {
        clean[String(k).slice(0, 40)] = String(v).slice(0, 500);
      }
    }
    return clean;
  };

  if (params.metadata) {
    params.metadata = sanitizeMeta(params.metadata);
  }
  if (params.subscription_data?.metadata) {
    params.subscription_data = {
      ...params.subscription_data,
      metadata: sanitizeMeta(params.subscription_data.metadata),
    };
  }
  if (params.payment_intent_data?.metadata) {
    params.payment_intent_data = {
      ...params.payment_intent_data,
      metadata: sanitizeMeta(params.payment_intent_data.metadata),
    };
  }

  try {
    return await stripe.checkout.sessions.create(params);
  } catch (err) {
    if (params.discounts && /coupon|promo|discount/i.test(err.message)) {
      log.warn('billing: checkout coupon error, falling back without discount', {
        error: err.message,
        discounts: params.discounts,
        context,
      });
      const { discounts, ...paramsWithoutDiscounts } = params;
      return await stripe.checkout.sessions.create(paramsWithoutDiscounts);
    }
    throw err;
  }
}

const router = Router();

async function createCheckoutSessionForUser({ user, plan, interval, conferenceId, country, promo, req, returnUrl }) {
  const stripe = getStripe();
  const domain = user.domain;
  const email = user.email;
  const { plan: normalizedPlan, invalid: planInvalid } = normalizePlan(plan);
  if (planInvalid) {
    const err = new Error('Unknown plan.');
    err.statusCode = 400;
    throw err;
  }
  const isSingleMeeting = normalizedPlan === 'single_meeting';
  const isEducator = normalizedPlan === 'educator';
  const isLifetime = normalizedPlan === 'lifetime';
  const isTeamPlan = normalizedPlan === 'team';
  const isDepartment = normalizedPlan === 'department';
  const isDomainPlan = isTeamPlan || isDepartment;
  if (isDomainPlan && isPersonalDomain(domain)) {
    const err = new Error('The domain license covers a Google Workspace domain. On a personal account, pick the Lifetime or Educator pass instead.');
    err.statusCode = 400;
    throw err;
  }
  const individual = (isEducator || isLifetime || isSingleMeeting)
    ? true
    : (isDomainPlan
      ? false
      : (normalizedPlan === 'individual' ? true : isPersonalDomain(domain)));

  const annual = interval === 'annual';
  const promoCode = (promo ?? '').trim().toUpperCase();
  const userCountry = (country && typeof country === 'string' ? country.trim().toUpperCase() : null) || detectCountry(req) || (typeof user?.signupGeo?.country === 'string' ? user.signupGeo.country.trim().toUpperCase() : null);
  const isIndia = userCountry === 'IN';
  const isPppEligible = !promoCode && userCountry && PPP_COUNTRIES.has(userCountry);
  const regionalConfig = PRICING.REGIONAL_PRICING ? PRICING.REGIONAL_PRICING[userCountry] : null;
  const isRegional = !!(regionalConfig && !isIndia);
  const regionalPriceEnv = userCountry === 'PH'
    ? process.env.STRIPE_INDIVIDUAL_LIFETIME_PHP_PRICE_ID
    : (userCountry === 'MY'
      ? process.env.STRIPE_INDIVIDUAL_LIFETIME_MYR_PRICE_ID
      : (userCountry === 'ID'
        ? process.env.STRIPE_INDIVIDUAL_LIFETIME_IDR_PRICE_ID
        : null));
  const isRegionalEducator = isEducator && (isRegional || isIndia || isPppEligible) && !isDomainPlan;
  const isRegionalTarget = isRegional && !isEducator && (isLifetime || individual) && !isSingleMeeting && !isDomainPlan;
  const isRegionalMeetingPass = isSingleMeeting && (isRegional || isIndia || isPppEligible);

  const configuredEduPrice = (userCountry === 'PH' && process.env.STRIPE_EDUCATOR_PHP_PRICE_ID)
    || (userCountry === 'MY' && process.env.STRIPE_EDUCATOR_MYR_PRICE_ID)
    || (userCountry === 'ID' && process.env.STRIPE_EDUCATOR_IDR_PRICE_ID)
    || (isIndia && process.env.STRIPE_EDUCATOR_INR_PRICE_ID)
    || (!isPppEligible && process.env.STRIPE_EDUCATOR_ANNUAL_PRICE_ID);

  let eduCurrency = 'usd';
  let eduUnitAmount = 249; // $2.49 USD equivalent for PPP countries
  if (isIndia) {
    eduCurrency = 'inr';
    eduUnitAmount = 19900;
  } else if (regionalConfig) {
    eduCurrency = regionalConfig.currency;
    if (userCountry === 'PH') eduUnitAmount = 14000;
    else if (userCountry === 'MY') eduUnitAmount = 1200;
    else if (userCountry === 'ID') eduUnitAmount = 3900000;
    else eduUnitAmount = Math.round(regionalConfig.amount / 2);
  }

  // Single-Meeting Pass regional pricing
  let smCurrency = 'usd';
  let smUnitAmount = 299;
  if (userCountry === 'IN') {
    smCurrency = 'inr';
    smUnitAmount = 9900;
  } else if (userCountry === 'PH') {
    smCurrency = 'php';
    smUnitAmount = 9900;
  } else if (userCountry === 'MY') {
    smCurrency = 'myr';
    smUnitAmount = 1200;
  } else if (userCountry === 'ID') {
    smCurrency = 'idr';
    smUnitAmount = 2900000;
  } else if (userCountry === 'MX') {
    smCurrency = 'mxn';
    smUnitAmount = 2900;
  } else {
    smCurrency = 'usd';
    smUnitAmount = 299;
  }

  const priceId = isSingleMeeting
    ? (isRegionalMeetingPass ? 'price_single_meeting_regional' : (process.env.STRIPE_SINGLE_MEETING_PRICE_ID || 'price_1ULk3CRPP93YBXrOlYO6xpWk'))
    : (isEducator
      ? (isRegionalEducator
        ? (configuredEduPrice || process.env.STRIPE_EDUCATOR_PRICE_ID || (individualBillingConfigured() ? 'price_regional_educator' : null))
        : process.env.STRIPE_EDUCATOR_PRICE_ID)
      : ((isIndia && (isLifetime || individual))
        ? getInrPrices().lifetime
        : (isRegionalTarget
          ? (regionalPriceEnv || process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID || (individualBillingConfigured() ? 'price_regional_dynamic' : null))
          : (isLifetime
            ? process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID
            : (isDepartment
              ? process.env.STRIPE_DEPARTMENT_PRICE_ID
              : (individual
                ? (annual && process.env.STRIPE_INDIVIDUAL_ANNUAL_PRICE_ID) || process.env.STRIPE_INDIVIDUAL_PRICE_ID
                : (annual && process.env.STRIPE_ANNUAL_PRICE_ID) || process.env.STRIPE_PRICE_ID))))));

  if (!stripe || !priceId) {
    const err = new Error('Billing is not configured yet.');
    err.statusCode = 503;
    throw err;
  }

  let planName = normalizedPlan || (individual ? 'individual' : 'team');
  if ((isIndia || isRegionalTarget) && isLifetime && !isSingleMeeting) {
    planName = 'lifetime';
  } else if (isRegionalEducator) {
    planName = 'educator';
  }
  const meta = individual
    ? { individual: '1', plan: planName, domain, email: email.toLowerCase() }
    : { individual: '0', plan: planName, domain, initiatedBy: email };

  if (isRegionalEducator) {
    meta.plan = 'educator';
    meta.isAnnualOneTime = '1';
    meta.individual = '1';
  }

  const confId = conferenceId ? String(conferenceId).trim().toLowerCase() : null;
  if (isSingleMeeting && !confId) {
    const err = new Error('Conference ID is required for a single-meeting pass.');
    err.statusCode = 400;
    throw err;
  }
  if (isSingleMeeting && confId) {
    meta.conferenceId = confId;
    meta.meetingPass = '1';
  }
  const defaultBackTo = isSingleMeeting
    ? (confId ? `index.html?unlocked=${encodeURIComponent(confId)}` : 'index.html')
    : (individual ? 'history.html' : 'team.html');
  let backTo = returnUrl || defaultBackTo;
  if (isSingleMeeting && confId && !backTo.includes('unlocked=')) {
    const bSep = backTo.includes('?') ? '&' : '?';
    backTo = `${backTo}${bSep}unlocked=${encodeURIComponent(confId)}`;
  }
  const sep = backTo.includes('?') ? '&' : '?';
  const successUrl = backTo.startsWith('http://') || backTo.startsWith('https://')
    ? `${backTo}${sep}upgraded=1`
    : `${CONFIG.publicSiteUrl}/${backTo.replace(/^\//, '')}${sep}upgraded=1`;
  const cancelUrl = backTo.startsWith('http://') || backTo.startsWith('https://')
    ? backTo
    : `${CONFIG.publicSiteUrl}/${backTo.replace(/^\//, '')}`;

  let resolvedPriceId = sanitizePriceId(priceId);
  let isRecurring = !isLifetime && !isSingleMeeting && !(isIndia && !isEducator && (isLifetime || individual)) && !isRegionalTarget && !isRegionalEducator;

  if (isLifetime || isSingleMeeting || (isIndia && !isEducator && (isLifetime || individual)) || isRegionalTarget || isRegionalEducator) {
    isRecurring = false;
  } else if (stripe.prices && typeof stripe.prices.retrieve === 'function') {
    try {
      const priceObj = await stripe.prices.retrieve(resolvedPriceId);
      isRecurring = priceObj ? (priceObj.type === 'recurring' || !!priceObj.recurring) : true;
    } catch (e) {
      log.warn('billing: could not retrieve price object, defaulting to subscription', { priceId: resolvedPriceId, error: e.message });
    }
  }

  const sessionMeta = {
    ...meta,
    ...(userCountry ? { country: userCountry } : {}),
    ...(isRegionalTarget ? { currency: regionalConfig.currency } : {}),
    ...(isRegionalEducator ? { currency: eduCurrency } : {}),
    ...(isRegionalMeetingPass ? { currency: smCurrency } : {}),
    ...(isPppEligible ? { pppDiscount: '1' } : {}),
  };

  const lineItems = (isSingleMeeting && isRegionalMeetingPass)
    ? [{
        price_data: {
          currency: smCurrency,
          unit_amount: smUnitAmount,
          product_data: { name: 'Attendance Tracker Pro (Single Meeting Pass)' },
        },
        quantity: 1,
      }]
    : (isRegionalEducator
      ? (configuredEduPrice
          ? [{ price: sanitizePriceId(configuredEduPrice), quantity: 1 }]
          : [{
              price_data: {
                currency: eduCurrency,
                unit_amount: eduUnitAmount,
                product_data: { name: 'Attendance Tracker Pro (Educator - 1 Year)' },
              },
              quantity: 1,
            }])
      : ((isRegionalTarget && !regionalPriceEnv)
          ? [{
              price_data: {
                currency: regionalConfig.currency,
                unit_amount: regionalConfig.amount,
                product_data: { name: 'Attendance Tracker Pro (Lifetime)' },
              },
              quantity: 1,
            }]
          : [{ price: resolvedPriceId, quantity: 1 }]));

  const sessionParams = {
    mode: isRecurring ? 'subscription' : 'payment',
    line_items: lineItems,
    client_reference_id: individual ? `user:${email.toLowerCase()}` : domain,
    customer_email: email,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: sessionMeta,
    after_expiration: { recovery: { enabled: true } },
  };

  // Payment methods: India card+upi; regionalConfig methods for regional markets (e.g. PH, MY, ID)
  if (isIndia) {
    sessionParams.payment_method_types = ['card', 'upi'];
  } else if (regionalConfig?.methods && regionalConfig.methods.length > 0) {
    sessionParams.payment_method_types = regionalConfig.methods;
  }

  if (promoCode && promoCode !== 'LAUNCH50') {
    sessionParams.allow_promotion_codes = true;
  } else if (!isDomainPlan && isPppEligible && !isRegionalEducator && (isEducator || (!isIndia && !isRegionalTarget && !isSingleMeeting))) {
    sessionParams.discounts = [{ coupon: 'PPP50' }];
  }
  if (isRecurring) {
    sessionParams.subscription_data = { metadata: meta };
  } else {
    sessionParams.payment_intent_data = { metadata: meta };
    sessionParams.customer_creation = 'always';
  }
  if (isEducator && !isRecurring && meta.isAnnualOneTime !== '1') {
    log.error('billing: educator price is one-time, not recurring — refusing checkout', { priceId: resolvedPriceId });
    const err = new Error('The educator plan is temporarily unavailable.');
    err.statusCode = 503;
    throw err;
  }

  return await createSafeCheckoutSession(stripe, sessionParams, { domain, email, plan: normalizedPlan });
}

// POST /api/billing/checkout (and /api/billing/create-checkout-session) — start a Checkout Session for the caller's
// Workspace domain. Per-domain billing: whoever completes checkout pays for the
// whole org, keyed by domain via client_reference_id + subscription metadata.
router.post(['/billing/checkout', '/billing/create-checkout-session'], requireAuth, async (req, res) => {
  try {
    const session = await createCheckoutSessionForUser({
      user: req.user,
      plan: req.body?.plan,
      interval: req.body?.interval,
      conferenceId: req.body?.conferenceId,
      country: req.body?.country || detectCountry(req),
      promo: req.body?.promo,
      returnUrl: req.body?.returnUrl || req.body?.redirect,
      req,
    });
    res.json({ url: session.url });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    log.error('billing: checkout create failed', { domain: req.user?.domain, email: req.user?.email, plan: req.body?.plan, error: err.message, code: err.code });
    res.status(502).json({ error: 'Could not start checkout.' });
  }
});

// GET /api/billing/checkout-redirect — synchronous redirect endpoint to bypass browser popup blockers
router.get(['/billing/checkout-redirect', '/checkout-redirect'], async (req, res) => {
  const queryToken = req.query?.token;
  let user = req.user;
  if (!user && queryToken) {
    try {
      const decoded = jwt.verify(queryToken, CONFIG.sessionSecret);
      if (decoded && decoded.email) {
        const domain = decoded.domain || domainOf(decoded.email);
        const userDoc = await getUser(domain, decoded.email);
        user = {
          email: decoded.email,
          domain,
          displayName: decoded.displayName,
          role: decoded.role || 'user',
          signupGeo: userDoc?.signupGeo || null,
        };
      }
    } catch (err) {
      log.warn('billing: checkout-redirect token verification failed', { error: err.message });
    }
  }

  if (!user || !user.email) {
    const errorMsg = 'Please sign in to proceed with checkout.';
    return res.redirect(`${CONFIG.publicSiteUrl}/index.html?checkout_error=${encodeURIComponent(errorMsg)}`);
  }

  const userDomain = user.domain || domainOf(user.email);
  if (typeof isUserDeleted === 'function' && await isUserDeleted(userDomain, user.email)) {
    log.warn('billing: checkout-redirect account deleted', { email: user.email });
    const errorMsg = 'This account has been deleted.';
    return res.redirect(`${CONFIG.publicSiteUrl}/index.html?checkout_error=${encodeURIComponent(errorMsg)}`);
  }

  try {
    const returnUrl = req.query?.returnUrl || req.query?.redirect;
    const session = await createCheckoutSessionForUser({
      user,
      plan: req.query?.plan,
      interval: req.query?.interval || (req.query?.plan === 'team' || req.query?.plan === 'lifetime' || req.query?.plan === 'single_meeting' ? 'once' : 'annual'),
      conferenceId: req.query?.conferenceId,
      country: (typeof req.query?.country === 'string' ? req.query.country.trim().toUpperCase() : null) || detectCountry(req),
      promo: req.query?.promo,
      returnUrl,
      req,
    });
    if (!session || !session.url) {
      throw new Error('Could not start checkout.');
    }
    return res.redirect(session.url);
  } catch (err) {
    log.error('billing: checkout-redirect failed', { email: user.email, plan: req.query?.plan, error: err.message });
    const errorMsg = err.message || 'Could not start checkout.';
    return res.redirect(`${CONFIG.publicSiteUrl}/index.html?checkout_error=${encodeURIComponent(errorMsg)}`);
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

  // STRICT OPT-IN GUARDRAIL: Upgrade link emails are user-initiated only
  // (teacher clicked "Teaching right now? Email me a link to upgrade later" in Meet).
  // Background/automated sales pitches to inboxes are disabled to eliminate spam complaints.
  if (reason !== 'manual') {
    return { skipped: 'automated_sales_disabled' };
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
  const isIndia = userCountry === 'IN';
  const regionalConfig = PRICING.REGIONAL_PRICING ? PRICING.REGIONAL_PRICING[userCountry] : null;
  const isRegional = !!(regionalConfig && !isIndia);
  const isPppEligible = userCountry && PPP_COUNTRIES.has(userCountry);
  const flag = userCountry ? (PPP_FLAGS[userCountry] || '') : '';

  let educatorUrl = `${CONFIG.publicSiteUrl}/history.html?upgrade=educator`;
  let lifetimeUrl = `${CONFIG.publicSiteUrl}/history.html?upgrade=lifetime`;

  if (stripe) {
    try {
      const meta = { individual: '1', domain, email: normalizedEmail, source: 'upgrade_link_email', reason };
      const commonDiscounts = (isIndia || isRegional) ? null : (isPppEligible ? [{ coupon: 'PPP50' }] : [{ coupon: 'SAVE20' }]);

      const createSession = (params) => createSafeCheckoutSession(stripe, params, { email: normalizedEmail, source: 'upgrade_link_email' });

      const inrPrices = isIndia ? getInrPrices() : null;
      const educatorPriceId = (isIndia || isRegional)
        ? null // In India / regional markets, kill recurring subscriptions — Lifetime Pass is the ONLY option
        : sanitizePriceId(process.env.STRIPE_EDUCATOR_PRICE_ID);
      const regionalPriceEnv = userCountry === 'PH'
        ? process.env.STRIPE_INDIVIDUAL_LIFETIME_PHP_PRICE_ID
        : (userCountry === 'MY'
          ? process.env.STRIPE_INDIVIDUAL_LIFETIME_MYR_PRICE_ID
          : (userCountry === 'ID'
            ? process.env.STRIPE_INDIVIDUAL_LIFETIME_IDR_PRICE_ID
            : null));
      const lifetimePriceId = isIndia
        ? sanitizePriceId(inrPrices.lifetime)
        : (isRegional
          ? sanitizePriceId(regionalPriceEnv)
          : sanitizePriceId(process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID));
      const inPaymentMethods = isIndia
        ? { payment_method_types: ['card', 'upi'] }
        : (isRegional ? { payment_method_types: regionalConfig.methods } : {});

      const lifetimeLineItems = (isRegional && !regionalPriceEnv)
        ? [{
            price_data: {
              currency: regionalConfig.currency,
              unit_amount: regionalConfig.amount,
              product_data: { name: 'Attendance Tracker Pro (Lifetime)' },
            },
            quantity: 1,
          }]
        : (lifetimePriceId ? [{ price: lifetimePriceId, quantity: 1 }] : null);

      const [educatorSession, lifetimeSession] = await Promise.all([
        educatorPriceId ? createSession({
          mode: 'subscription',
          line_items: [{ price: educatorPriceId, quantity: 1 }],
          client_reference_id: `user:${normalizedEmail}`,
          customer_email: normalizedEmail,
          success_url: `${CONFIG.publicSiteUrl}/history.html?upgraded=1`,
          cancel_url: `${CONFIG.publicSiteUrl}/history.html`,
          metadata: { ...meta, plan: 'educator', ...(isPppEligible ? { pppDiscount: '1' } : { promoDiscount: 'SAVE20' }) },
          ...(commonDiscounts ? { discounts: commonDiscounts } : {}),
          ...inPaymentMethods,
        }) : null,
        lifetimeLineItems ? createSession({
          mode: 'payment',
          customer_creation: 'always',
          line_items: lifetimeLineItems,
          client_reference_id: `user:${normalizedEmail}`,
          customer_email: normalizedEmail,
          success_url: `${CONFIG.publicSiteUrl}/history.html?upgraded=1`,
          cancel_url: `${CONFIG.publicSiteUrl}/history.html`,
          metadata: { ...meta, plan: 'lifetime', ...(isPppEligible ? { pppDiscount: '1' } : { promoDiscount: 'SAVE20' }), ...(isRegional ? { currency: regionalConfig.currency } : {}) },
          ...(commonDiscounts ? { discounts: commonDiscounts } : {}),
          ...inPaymentMethods,
        }) : null,
      ]);

      if (educatorSession?.url) educatorUrl = educatorSession.url;
      else if (isIndia || isRegional) educatorUrl = null;
      if (lifetimeSession?.url) lifetimeUrl = lifetimeSession.url;
    } catch (e) {
      log.warn('billing: could not pre-create Stripe checkout sessions for upgrade email', { error: e.message });
    }
  }

  // 24-hour special offer: 20% discount ($3.99/yr, $7.99) or 50% PPP subsidy ($2.49/yr, $4.99; ₹299 lifetime in India; localized regional pricing)
  const educatorPrice = (isIndia || isRegional) ? null : (isPppEligible ? '$2.49' : '$3.99');
  const lifetimePrice = isIndia
    ? '₹299'
    : (isRegional
      ? regionalConfig.label
      : (isPppEligible ? '$4.99' : '$7.99'));

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
  if (plan === 'single_meeting') {
    return res.status(400).json({ error: 'Single-meeting pass must be purchased from within an active meeting session.' });
  }
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
  const userCountry = detectCountry(req);
  const isIndia = userCountry === 'IN';
  const regionalConfig = PRICING.REGIONAL_PRICING ? PRICING.REGIONAL_PRICING[userCountry] : null;
  const isRegional = !!(regionalConfig && !isIndia);
  const promo = (req.body?.promo ?? '').trim().toUpperCase();
  const isPppEligible = !promo && userCountry && PPP_COUNTRIES.has(userCountry);
  const isRegionalEducator = isEducator && (isRegional || isIndia || isPppEligible) && !isDomain;
  const regionalPriceEnv = userCountry === 'PH'
    ? process.env.STRIPE_INDIVIDUAL_LIFETIME_PHP_PRICE_ID
    : (userCountry === 'MY'
      ? process.env.STRIPE_INDIVIDUAL_LIFETIME_MYR_PRICE_ID
      : (userCountry === 'ID'
        ? process.env.STRIPE_INDIVIDUAL_LIFETIME_IDR_PRICE_ID
        : null));
  const isRegionalTarget = !isDomain && isRegional && !isEducator;

  const configuredEduPrice = (userCountry === 'PH' && process.env.STRIPE_EDUCATOR_PHP_PRICE_ID)
    || (userCountry === 'MY' && process.env.STRIPE_EDUCATOR_MYR_PRICE_ID)
    || (userCountry === 'ID' && process.env.STRIPE_EDUCATOR_IDR_PRICE_ID)
    || (isIndia && process.env.STRIPE_EDUCATOR_INR_PRICE_ID)
    || (!isPppEligible && process.env.STRIPE_EDUCATOR_ANNUAL_PRICE_ID);

  let eduCurrency = 'usd';
  let eduUnitAmount = 249;
  if (isIndia) {
    eduCurrency = 'inr';
    eduUnitAmount = 19900;
  } else if (regionalConfig) {
    eduCurrency = regionalConfig.currency;
    if (userCountry === 'PH') eduUnitAmount = 14000;
    else if (userCountry === 'MY') eduUnitAmount = 1200;
    else if (userCountry === 'ID') eduUnitAmount = 3900000;
    else eduUnitAmount = Math.round(regionalConfig.amount / 2);
  }

  // Same fail-closed rule as the authed checkout: fallbacks never cross
  // product boundaries (a "$4.99/yr" button must never resolve to the
  // domain price). Missing price for the named plan → 503.
  const priceId = isEducator
    ? (isRegionalEducator
        ? (configuredEduPrice || process.env.STRIPE_EDUCATOR_PRICE_ID || 'price_regional_educator')
        : process.env.STRIPE_EDUCATOR_PRICE_ID) // no fallback: educator and individual-annual are DIFFERENT products
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

  let resolvedPriceId = sanitizePriceId(priceId);
  if (!isDomain && !isEducator) {
    if (isIndia) {
      const inrPrices = getInrPrices();
      resolvedPriceId = inrPrices.lifetime;
    } else if (regionalConfig) {
      if (regionalPriceEnv) {
        resolvedPriceId = sanitizePriceId(regionalPriceEnv);
      }
    }
  }

  try {
    let isRecurring = plan !== 'lifetime' && !(!isDomain && !isEducator && (isIndia || isRegionalTarget)) && !isRegionalEducator;
    if (plan === 'lifetime' || (!isDomain && !isEducator && (isIndia || isRegionalTarget)) || isRegionalEducator) {
      isRecurring = false;
    } else if (stripe.prices && typeof stripe.prices.retrieve === 'function') {
      try {
        const priceObj = await stripe.prices.retrieve(resolvedPriceId);
        isRecurring = priceObj ? (priceObj.type === 'recurring' || !!priceObj.recurring) : true;
      } catch (e) {
        log.warn('billing: could not retrieve price object in public checkout', { priceId: resolvedPriceId, error: e.message });
      }
    }

    const meta = {
      individual: isDomain ? '0' : '1',
      plan: (!isDomain && !isEducator && (isIndia || isRegionalTarget)) ? 'lifetime' : plan,
      source: 'public_pricing',
      ...(email ? { email } : {}),
      // Stamp the domain for domain purchases so the webhook can provision even
      // if client_reference_id is ever absent from the completed session.
      ...(isDomain && email ? { domain: email.split('@')[1] } : {}),
      ...(userCountry ? { country: userCountry } : {}),
      ...(isRegionalTarget ? { currency: regionalConfig.currency } : {}),
      ...(isRegionalEducator ? { currency: eduCurrency, isAnnualOneTime: '1', individual: '1', plan: 'educator' } : {}),
    };

    const lineItems = isRegionalEducator
      ? (configuredEduPrice
          ? [{ price: sanitizePriceId(configuredEduPrice), quantity: 1 }]
          : [{
              price_data: {
                currency: eduCurrency,
                unit_amount: eduUnitAmount,
                product_data: { name: 'Attendance Tracker Pro (Educator - 1 Year)' },
              },
              quantity: 1,
            }])
      : ((isRegionalTarget && !regionalPriceEnv)
          ? [{
              price_data: {
                currency: regionalConfig.currency,
                unit_amount: regionalConfig.amount,
                product_data: { name: 'Attendance Tracker Pro (Lifetime)' },
              },
              quantity: 1,
            }]
          : [{ price: resolvedPriceId, quantity: 1 }]);

    const sessionParams = {
      mode: isRecurring ? 'subscription' : 'payment',
      line_items: lineItems,
      success_url: `${CONFIG.publicSiteUrl}/history.html?upgraded=1`,
      cancel_url: `${CONFIG.publicSiteUrl}/pricing.html`,
      metadata: meta,
      // Abandoned-checkout recovery (see authed checkout above for rationale).
      after_expiration: { recovery: { enabled: true } },
    };
    if (email) {
      sessionParams.client_reference_id = isDomain ? email.split('@')[1] : `user:${email}`;
    }
    // Payment methods: India card+upi; regionalConfig methods for regional markets (e.g. PH, MY, ID)
    if (isIndia) {
      sessionParams.payment_method_types = ['card', 'upi'];
    } else if (regionalConfig?.methods && regionalConfig.methods.length > 0) {
      sessionParams.payment_method_types = regionalConfig.methods;
    }
    if (promo && promo !== 'LAUNCH50') {
      sessionParams.allow_promotion_codes = true;
    } else if (!isDomain && isPppEligible && !isRegionalEducator && (isEducator || (!isIndia && !isRegionalTarget))) {
      sessionParams.discounts = [{ coupon: 'PPP50' }];
    }
    if (isRecurring) {
      sessionParams.subscription_data = { metadata: meta };
    } else {
      sessionParams.payment_intent_data = { metadata: meta };
      // Same as the authed checkout: make one-time purchases create a Stripe
      // customer so the buyer's portal (receipts) works post-purchase.
      sessionParams.customer_creation = 'always';
    }
    if (isEducator && !isRecurring && meta.isAnnualOneTime !== '1') {
      // Same fail-closed rule as the authed checkout: a one-time educator price
      // silently converts annual revenue into a lifetime pass.
      log.error('billing: educator price is one-time, not recurring — refusing public checkout', { priceId: resolvedPriceId });
      return res.status(503).json({ error: 'The educator plan is temporarily unavailable.' });
    }

    const session = await createSafeCheckoutSession(stripe, sessionParams, { email, plan, source: 'public_checkout' });
    res.json({ url: session.url });
  } catch (err) {
    log.error('billing: public checkout failed', { plan, email, error: err.message, code: err.code });
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

function isSuperAdminUser(email) {
  if (!email) return false;
  if (typeof CONFIG.isSuperAdmin === 'function') {
    return CONFIG.isSuperAdmin(email);
  }
  return String(email).trim().toLowerCase() === (CONFIG.superAdminEmail || '').toLowerCase();
}

// POST /api/billing/record-export — counts CSV and Excel downloads toward monthly export quota
router.post('/billing/record-export', requireAuth, async (req, res) => {
  try {
    const { exportType = 'csv', conferenceId = null, meetingTitle = null, participantCount = 0 } = req.body || {};
    const isPro = await planIsPro(req.user.domain, req.user.email);
    if (isPro) {
      return res.json({ success: true, isPro: true });
    }

    const confId = conferenceId || null;
    const meetingUnlocked = confId && typeof isMeetingUnlocked === 'function'
      ? await isMeetingUnlocked(req.user.domain, req.user.email, confId)
      : false;
    if (meetingUnlocked) {
      return res.json({ success: true, meetingUnlocked: true });
    }

    const used = await countUserMonthlyExports(req.user.domain, req.user.email);
    const limit = PRICING.FREE_MONTHLY_EXPORT_LIMIT || 2;
    if (used >= limit) {
      return res.status(402).json({
        error: 'Monthly export quota reached',
        feature: 'exportQuota',
        used,
        limit,
        quota: { used, limit },
      });
    }

    const count = typeof participantCount === 'number' ? participantCount : (parseInt(participantCount, 10) || 0);
    const maxParticipants = PRICING.FREE_MAX_PARTICIPANTS_PER_EXPORT || 25;
    let graceUsed = false;
    if (count > maxParticipants) {
      const userDoc = await getUser(req.user.domain, req.user.email);
      if (userDoc?.hasUsedLargeClassGrace === true) {
        return res.status(402).json({
          error: 'Free tier supports exporting up to 25 attendees per meeting. Upgrade to Pro for unlimited class sizes.',
          feature: 'largeClass',
          participantCount: count,
        });
      }
      await markUserLargeClassGraceUsed(req.user.domain, req.user.email);
      graceUsed = true;
    }

    await persistExport(req.user.domain, {
      domain: req.user.domain,
      email: req.user.email,
      meetingTitle: meetingTitle || null,
      conferenceId: conferenceId || null,
      participantCount: count,
      exportType,
      exportedAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      quota: {
        used: used + 1,
        limit,
      },
      ...(graceUsed ? { graceUsed: true, participantCount: count } : {}),
    });
  } catch (err) {
    log.error('billing: record-export failed', { domain: req.user?.domain, email: req.user?.email, error: err.message });
    return res.status(500).json({ error: 'Failed to record export' });
  }
});

// GET /api/billing/status — current plan for the caller's domain (drives the
// upgrade CTA in the UI).
router.get('/billing/status', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  let individual = isPersonalDomain(req.user.domain);
  try {
    let plan;
    if (isSuperAdminUser(req.user.email)) {
      plan = { plan: 'pro', status: 'active', billingStatus: 'active', isSuperAdmin: true };
    } else {
      plan = individual
        ? await getUserPlan(req.user.domain, req.user.email)
        : await getTenantPlan(req.user.domain);
      // Workspace-domain user without a domain plan may hold an INDIVIDUAL pass
      // (mirrors planIsPro). Report it as their plan so the UI shows Pro +
      // Manage billing instead of an upgrade CTA for something already bought.
      if (!individual && plan.plan !== 'pro' && individualBillingConfigured()) {
        const userPlan = await getUserPlan(req.user.domain, req.user.email);
        if (userPlan.plan === 'pro') { plan = userPlan; individual = true; }
      }
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

    let hasUsedLargeClassGrace = false;
    if (plan.plan !== 'pro' && req.user) {
      try {
        const u = await getUser(req.user.domain, req.user.email);
        hasUsedLargeClassGrace = !!u?.hasUsedLargeClassGrace;
      } catch (_) {}
    }

    let meetingUnlocked = false;
    if (req.query?.conferenceId) {
      try {
        const { isMeetingUnlocked } = require('../services/firestore');
        meetingUnlocked = await isMeetingUnlocked(req.user.domain, req.user.email, req.query.conferenceId);
      } catch (_) {}
    }

    res.json({
      ...plan,
      individual,
      isEdu,
      meetingUnlocked,
      hasUsedLargeClassGrace,
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
      pricing: {
        ...PRICING.PRICES,
        ...(userCountry === 'IN' ? {
          lifetime: { label: '₹299', full: null, period: 'one-time' },
          educator: { label: PRICING.REGIONAL_PRICING?.IN?.eduLabel || '₹199/yr', full: null, period: '/yr' },
        } : ((PRICING.REGIONAL_PRICING && PRICING.REGIONAL_PRICING[userCountry]) ? {
          lifetime: { label: PRICING.REGIONAL_PRICING[userCountry].label, full: null, period: 'one-time' },
          educator: { label: PRICING.REGIONAL_PRICING[userCountry].eduLabel || '$2.49/yr', full: null, period: '/yr' },
        } : {})),
        quotaLimit: PRICING.FREE_MONTHLY_EXPORT_LIMIT,
      },
    });
  } catch (err) {
    log.error('billing: status failed', { domain: req.user.domain, error: err.message });
    res.status(500).json({ error: 'Failed to fetch plan.' });
  }
});

function isEduDomain(email, domain) {
  const e = (email || '').toLowerCase().trim();
  const d = (domain || (e.includes('@') ? e.split('@')[1] : '')).toLowerCase().trim();
  const target = d || e;
  if (!target) return false;
  return /\.(edu(\.[a-z]{2,})?|ac\.[a-z0-9.-]+|gov\.[a-z]{2,}|k12\.[a-z0-9.-]+|sch\.[a-z0-9.-]+|education)$/i.test(target) ||
         /\.education\b/i.test(target) ||
         /@(.*\.)?(school|academy|college|university|deped|alokitohridoy|education|gymnasium|lyceum)/i.test(e) ||
         /\.(edu|ac|education)\b/i.test(target);
}

// POST /api/billing/school-license-request — 1-click inquiry from institutional / .edu / .ac users
router.post('/billing/school-license-request', requireAuth, async (req, res) => {
  try {
    const email = (req.user.email || '').toLowerCase();
    const domain = req.user.domain || email.split('@')[1] || '';
    const isEdu = isEduDomain(email, domain);
    const { teacherName, organizationName, tier, adminEmail } = req.body || {};

    await logEvent(req.user.domain, {
      email,
      type: 'school_license_requested',
      meta: {
        domain,
        isEdu,
        teacherName: teacherName || null,
        organizationName: organizationName || null,
        tier: tier || null,
        adminEmail: adminEmail || null,
        requestedAt: new Date().toISOString(),
      },
    });

    log.info('billing: school license requested', { domain, email, isEdu, teacherName, organizationName, tier, adminEmail });

    const to = process.env.NOTIFY_EMAIL || process.env.GMAIL_USER;
    if (to) {
      try {
        const { sendAdminEmail } = require('../lib/notifications');
        const subject = `🏫 School License Request: ${organizationName || domain} (${tier || 'inquiry'})`;
        const body = [
          'A teacher requested a school or department license.',
          '',
          `Teacher:       ${teacherName || '(not given)'}`,
          `Teacher email: ${email}`,
          `School / org:  ${organizationName || '(not given)'}`,
          `Domain:        ${domain}`,
          `Plan tier:     ${tier || '(not specified)'}`,
          `Admin email:   ${adminEmail || '(none)'}`,
        ].join('\n');
        await sendAdminEmail({ to, subject, body });
      } catch (e) {
        log.warn('billing: school license sendAdminEmail failed', { error: e.message });
      }
    }

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
        const { handleSingleMeetingCheckout } = require('./webhooks');
        if (await handleSingleMeetingCheckout(s)) {
          log.info('billing: handled single_meeting checkout in webhook', { sessionId: s.id });
          break;
        }
        if (s.metadata?.plan === 'single_meeting') {
          log.warn('billing: single_meeting checkout unhandled or missing conferenceId, skipping pro grant', { sessionId: s.id });
          break;
        }
        if (ref.startsWith('user:') || s.metadata?.individual === '1') {
          // Individual (per-user) plan → write the user doc.
          const email = s.metadata?.email || (ref.startsWith('user:') ? ref.slice(5) : (s.customer_details?.email || s.customer_email));
          const domain = s.metadata?.domain || (email && email.includes('@') ? email.split('@')[1] : null);
          if (domain && email) {
            const isEducatorAnnualOneTime = s.metadata?.plan === 'educator' && !s.subscription;
            const planType = isEducatorAnnualOneTime
              ? 'educator_annual'
              : (s.metadata?.plan || (s.subscription ? 'subscription' : 'lifetime'));
            const individualPlanExpiresAt = isEducatorAnnualOneTime
              ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
              : null;
            await setUserPlan(domain, email.toLowerCase(), {
              individualPlan: 'pro',
              individualBillingStatus: 'active',
              individualPlanType: planType,
              individualPlanExpiresAt,
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
            if (event.type === 'customer.subscription.deleted') {
              const userPlan = await getUserPlan(domain, email);
              if (userPlan?.individualPlanType === 'lifetime' || (userPlan?.stripeSubscriptionId && userPlan.stripeSubscriptionId !== sub.id)) {
                log.info('billing: ignoring subscription.deleted for lifetime or superseded individual subscription', {
                  domain, email, deletedSubId: sub.id, activeSubId: userPlan?.stripeSubscriptionId, planType: userPlan?.individualPlanType,
                });
                break;
              }
            }
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
            if (event.type === 'customer.subscription.deleted') {
              const tenant = await getTenantPlan(domain);
              if (tenant?.planType === 'lifetime' || (tenant?.stripeSubscriptionId && tenant.stripeSubscriptionId !== sub.id)) {
                log.info('billing: ignoring subscription.deleted for lifetime or superseded tenant subscription', {
                  domain, deletedSubId: sub.id, activeSubId: tenant?.stripeSubscriptionId, planType: tenant?.planType,
                });
                break;
              }
            }
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
  if (isSuperAdminUser(req.user?.email)) return next();
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
  if (isSuperAdminUser(email)) return true;
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
  if (isSuperAdminUser(email)) return true;
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
  createSafeCheckoutSession,
};
