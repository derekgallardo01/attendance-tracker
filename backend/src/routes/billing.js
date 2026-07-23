const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const express = require('express');
const log = require('../lib/logger');
const CONFIG = require('../config');
const { getTenantPlan, setTenantPlan } = require('../services/firestore');

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
  if (!stripe || !process.env.STRIPE_PRICE_ID) {
    return res.status(503).json({ error: 'Billing is not configured yet.' });
  }
  const domain = req.user.domain;
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      client_reference_id: domain,
      customer_email: req.user.email,
      success_url: `${CONFIG.publicSiteUrl}/team.html?upgraded=1`,
      cancel_url: `${CONFIG.publicSiteUrl}/team.html`,
      metadata: { domain, initiatedBy: req.user.email },
      subscription_data: { metadata: { domain } },
      allow_promotion_codes: true,
    });
    res.json({ url: session.url });
  } catch (err) {
    log.error('billing: checkout create failed', { domain, error: err.message });
    res.status(502).json({ error: 'Could not start checkout.' });
  }
});

// GET /api/billing/portal — Stripe Customer Portal link so the org admin can
// update payment method or cancel. Requires a stored customer id (set by the
// webhook on first successful checkout).
router.get('/billing/portal', requireAuth, async (req, res) => {
  const stripe = getStripe();
  if (!stripe) return res.status(503).json({ error: 'Billing is not configured yet.' });
  try {
    const { stripeCustomerId } = await getTenantPlan(req.user.domain);
    if (!stripeCustomerId) return res.status(404).json({ error: 'No active subscription for this domain.' });
    const session = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: `${CONFIG.publicSiteUrl}/team.html`,
    });
    res.json({ url: session.url });
  } catch (err) {
    log.error('billing: portal create failed', { domain: req.user.domain, error: err.message });
    res.status(502).json({ error: 'Could not open the billing portal.' });
  }
});

// GET /api/billing/status — current plan for the caller's domain (drives the
// upgrade CTA in the UI).
router.get('/billing/status', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const plan = await getTenantPlan(req.user.domain);
    res.json({ ...plan, billingConfigured: billingConfigured() });
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
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const domain = s.client_reference_id || s.metadata?.domain;
        if (domain) {
          await setTenantPlan(domain, {
            plan: 'pro',
            billingStatus: 'active',
            stripeCustomerId: s.customer || null,
            stripeSubscriptionId: s.subscription || null,
          });
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const domain = sub.metadata?.domain;
        if (domain) {
          const active = sub.status === 'active' || sub.status === 'trialing';
          await setTenantPlan(domain, {
            plan: active ? 'pro' : 'free',
            billingStatus: sub.status,
            stripeSubscriptionId: sub.id,
          });
        }
        break;
      }
      default:
        // Ignore other event types.
        break;
    }
    res.json({ received: true });
  } catch (err) {
    log.error('billing: webhook handling failed', { type: event.type, error: err.message });
    res.status(500).json({ error: 'Webhook handling failed.' });
  }
}

// Short-lived cache of the last successfully-read plan per domain. Lets the gate
// ride out a transient Firestore blip for a paying customer WITHOUT the old
// fail-open behavior, which silently granted Pro to every domain on any read
// error — the opposite of what a paywall should do once it's live.
const planCache = new Map(); // domain -> { plan, at }
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
async function planIsPro(domain) {
  if (!billingConfigured()) return true; // pre-launch: nothing is gated
  try {
    const { plan } = await getTenantPlan(domain);
    planCache.set(domain, { plan, at: Date.now() });
    return plan === 'pro';
  } catch (err) {
    const cached = planCache.get(domain);
    const fresh = cached && (Date.now() - cached.at) < PLAN_CACHE_TTL_MS;
    log.warn('billing: planIsPro read failed', { domain, usedCache: !!fresh, error: err.message });
    return !!(fresh && cached.plan === 'pro');
  }
}

module.exports = { router, webhookHandler, requireProPlan, planIsPro };
