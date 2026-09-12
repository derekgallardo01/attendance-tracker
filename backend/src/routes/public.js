const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { FieldValue } = require('@google-cloud/firestore');
const log = require('../lib/logger');
const { getDb, resolveShareLink, getSharedSeriesView, suppressEmail, getVerification, logEvent } = require('../services/firestore');
const { sendFeedbackEmail, verifyUnsubscribeToken, sendAdminEmail } = require('../lib/notifications');
const { escapeHtml } = require('../lib/html');

const router = Router();

// Cap a wire-supplied string to N chars (null if it isn't a string), so a
// malicious caller can't bloat Firestore docs. Shared by the feedback +
// pageview handlers.
const cap = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

// Tighter limit on the feedback endpoint than the general /api limiter
// because the failure mode is "spammer fills your inbox" not "API saturated".
const feedbackLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,                    // 5 submissions per hour per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many feedback submissions. Try again later.' },
});

// POST /api/public/feedback — In-product feedback widget submissions.
// Unauth (so people can submit from the landing page without signing in).
// Rate-limited per IP. Persists to Firestore + emails Derek.
router.post('/public/feedback', feedbackLimiter, async (req, res) => {
  try {
    /* istanbul ignore next: express.json always sets req.body to an object */
    const { body, fromEmail, fromName, source, conferenceId } = req.body || {};
    if (!body || typeof body !== 'string' || body.trim().length < 2) {
      return res.status(400).json({ error: 'Feedback body is required' });
    }
    const safeBody = body.trim().slice(0, 5000);
    const userAgent = cap(req.headers['user-agent'], 500);
    // CI smoke tests exercise this round-trip against live prod on every push
    // — skip BOTH the email (below) and the Firestore row (a junk feedback
    // doc per commit, forever).
    const isSmokeTest = source === 'github_actions' || fromEmail === 'ci-smoke@attendancetracker.dev';

    // Persist before sending so we have a record even if SMTP is down.
    try {
      if (!isSmokeTest) await getDb().collection('feedback').add({
        body: safeBody,
        fromEmail: cap(fromEmail, 200),
        fromName: cap(fromName, 200),
        source: cap(source, 100),
        conferenceId: cap(conferenceId, 100),
        userAgent,
        ip: cap(req.ip, 100),
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch (e) {
      log.warn('feedback: firestore persist failed', { error: e.message });
    }

    if (!isSmokeTest) {
      await sendFeedbackEmail({
        body: safeBody,
        fromEmail: cap(fromEmail, 200),
        fromName: cap(fromName, 200),
        source: cap(source, 100),
        conferenceId: cap(conferenceId, 100),
        userAgent,
      });
    }
    res.json({ success: true });
  } catch (err) {
    log.error('feedback: send failed', { error: err.message });
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// POST /api/public/quote-request — a school/org asks for a quote or invoice.
// Institutions rarely buy via a self-serve credit-card button — they need a PO,
// an invoice, and often a signed DPA before money moves. This captures that lead
// (persist + email Derek) so the institutional pivot has a buying path that
// matches how schools actually procure. Unauth (school admins land on /pricing
// before signing in), rate-limited per IP.
const quoteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Try again later.' },
});
router.post('/public/quote-request', quoteLimiter, async (req, res) => {
  try {
    /* istanbul ignore next: express.json always sets req.body to an object */
    const { workEmail, schoolName, seats, plan, notes } = req.body || {};
    if (!workEmail || typeof workEmail !== 'string' || !workEmail.includes('@')) {
      return res.status(400).json({ error: 'A work email is required.' });
    }
    const email = workEmail.trim().toLowerCase().slice(0, 200);
    const domain = email.split('@')[1] || '';
    const rec = {
      workEmail: email,
      domain,
      schoolName: cap(schoolName, 200),
      seats: cap(String(seats == null ? '' : seats), 40),
      plan: cap(plan, 40),
      notes: cap(notes, 2000),
      userAgent: cap(req.headers['user-agent'], 500),
      ip: cap(req.ip, 100),
      createdAt: FieldValue.serverTimestamp(),
    };
    const isSmokeTest = email === 'ci-smoke@attendancetracker.dev';
    try {
      if (!isSmokeTest) await getDb().collection('quoteRequests').add(rec);
    } catch (e) {
      log.warn('quote-request: firestore persist failed', { error: e.message });
    }
    if (!isSmokeTest) {
      const to = process.env.NOTIFY_EMAIL || process.env.GMAIL_USER;
      const subject = `🏫 Institution quote request: ${rec.schoolName || domain} (${domain})`;
      const body = [
        'A school or organization requested a quote / invoice from the pricing page.',
        '',
        `School / org:  ${rec.schoolName || '(not given)'}`,
        `Work email:    ${email}`,
        `Domain:        ${domain}`,
        `Teachers:      ${rec.seats || '(not given)'}`,
        `Interested in: ${rec.plan || '(not given)'}`,
        `Notes:         ${rec.notes || '(none)'}`,
        '',
        `IP: ${rec.ip}`,
      ].join('\n');
      await sendAdminEmail({ to, subject, body });
    }
    res.json({ success: true });
  } catch (err) {
    log.error('quote-request: failed', { error: err.message });
    res.status(500).json({ error: 'Failed to submit request' });
  }
});

// POST /api/public/pageview — Unauth'd, fire-and-forget beacon from the
// landing page. Lets us track inbound traffic + sources without a third-party
// analytics dependency. Schema is tiny — no cookies, no user IDs, just the
// minimum to answer "did anyone visit and where from".
router.post('/public/pageview', async (req, res) => {
  // Always respond 204 quickly — beacon caller doesn't read this.
  res.status(204).end();
  try {
    /* istanbul ignore next: express.json always sets req.body to an object */
    const body = req.body || {};
    const today = new Date().toISOString().slice(0, 10);
    const db = getDb();

    // Event type — 'pageview' by default, or an interaction like 'cta_click'
    // (e.g. the Marketplace install button) so we can measure landing→install
    // conversion, which was previously a blind spot. Allow-list to keep the
    const ALLOWED_EVENTS = new Set([
      'pageview',
      'cta_click',
      'pricing_checkout_clicked',
      'pricing_plan_hover',
      'pricing_lang_change',
      'pricing_faq_click',
    ]);
    const event = ALLOWED_EVENTS.has(body.event) ? body.event : 'pageview';
    const isCta = event === 'cta_click' || event === 'pricing_checkout_clicked';

    // CI smoke tests run against LIVE prod on every push — recording their
    // beacons permanently skewed the pageviewsDaily funnel counter (1–3 rows
    // per commit, forever). Acknowledge (204 already sent) but store nothing.
    if (String(body.path || '').startsWith('/e2e-smoke')) return;

    // Daily aggregate: always bump total count; bump a cta counter too when
    // this is a conversion click, so the funnel is trendable without scanning
    // the raw rows.
    const dailyPatch = {
      date: today,
      count: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (isCta) dailyPatch.ctaClicks = FieldValue.increment(1);

    // Two writes: one per-visit row for analysis, one daily aggregate counter
    // for cheap dashboard reads. Both fire-and-forget.
    await Promise.allSettled([
      db.collection('pageviews').add({
        path: cap(body.path, 200),
        referrer: cap(body.referrer, 500),
        viewportWidth: typeof body.viewportWidth === 'number' ? body.viewportWidth : null,
        utmSource: cap(body.utmSource, 100),
        utmMedium: cap(body.utmMedium, 100),
        utmCampaign: cap(body.utmCampaign, 100),
        event,
        eventLabel: cap(body.eventLabel, 100),
        userAgent: cap(req.headers['user-agent'], 500),
        ip: cap(req.ip, 100), // already truncated by trust proxy; useful for spam triage
        createdAt: FieldValue.serverTimestamp(),
      }),
      db.collection('pageviewsDaily').doc(today).set(dailyPatch, { merge: true }),
    ]);
  } catch (err) {
    log.warn('pageview beacon failed', { error: err.message });
  }
});

// Cache the public stats payload for 10 minutes so a viral landing page
// doesn't hammer Firestore. The counts move slowly enough that this is fine.
let cached = null;
let cachedAt = 0;
const CACHE_MS = 10 * 60 * 1000;

// GET /api/public/stats — Unauth'd, safe-to-cache counts for the landing
// page social proof bar. Returns derived org count (union of explicit tenant
// docs + unique user domains, same as the admin dashboard) plus meeting count.
// GET /api/public/billing-config — which optional tiers the pricing page may
// render. The Institution card advertises $149/yr and charges
// STRIPE_ANNUAL_PRICE_ID — but that env var predates the Institution tier
// (the old domain-annual dark launch), so the card must stay hidden until
// the price it would charge is ACTUALLY $149/yr. Verified against Stripe,
// cached 10 min, fail-closed.
const INSTITUTION_PRICE_CENTS = 14900;
const DEPARTMENT_PRICE_CENTS = 5900;
let _instCache = null; // { institutionAvailable, departmentAvailable, at }
router.get('/public/billing-config', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  if (_instCache && Date.now() - _instCache.at < 10 * 60 * 1000) {
    return res.json({ institutionAvailable: _instCache.institutionAvailable, departmentAvailable: _instCache.departmentAvailable });
  }
  // Each optional card advertises a specific price and must stay hidden until the
  // env var it would charge is ACTUALLY that price (both env vars predate their
  // tiers). Verified against Stripe, cached 10 min, fail-closed.
  let institutionAvailable = false;
  let departmentAvailable = false;
  let priceCheckFailed = false;
  try {
    const key = process.env.STRIPE_SECRET_KEY;
    if (key) {
      const stripe = require('stripe')(key);
      const instId = process.env.STRIPE_ANNUAL_PRICE_ID;
      const deptId = process.env.STRIPE_DEPARTMENT_PRICE_ID;
      if (instId) {
        const price = await stripe.prices.retrieve(instId);
        institutionAvailable = !!(price && price.unit_amount === INSTITUTION_PRICE_CENTS && (price.recurring?.interval === 'year'));
      }
      if (deptId) {
        const price = await stripe.prices.retrieve(deptId);
        departmentAvailable = !!(price && price.unit_amount === DEPARTMENT_PRICE_CENTS && (price.recurring?.interval === 'year'));
      }
    }
  } catch (err) {
    priceCheckFailed = true; // a transient Stripe blip — do NOT cache it
    log.warn('public: billing-config price check failed — optional cards stay hidden this call only', { error: err.message });
  }
  // Only cache a definitive answer; caching a transient failure would hide a
  // correctly-configured card for the whole 10-min TTL.
  if (!priceCheckFailed) _instCache = { institutionAvailable, departmentAvailable, at: Date.now() };
  res.json({ institutionAvailable, departmentAvailable });
});
// Test hook: the 10-min cache would otherwise leak between test cases.
router._resetInstitutionCache = () => { _instCache = null; };

router.get('/public/stats', async (_req, res) => {
  try {
    if (cached && (Date.now() - cachedAt) < CACHE_MS) {
      res.set('Cache-Control', 'public, max-age=300');
      return res.json(cached);
    }

    // count() aggregations instead of loading every user + meeting doc into
    // memory (the old approach was O(entire DB) on each cache miss). Every
    // domain gets a tenant doc on first sign-in (upsertUser creates it), so the
    // tenants count is a faithful proxy for distinct organizations.
    const db = getDb();
    const [tenantsCount, meetingsCount] = await Promise.all([
      db.collection('tenants').count().get(),
      db.collectionGroup('meetings').count().get(),
    ]);

    cached = {
      organizations: tenantsCount.data().count,
      meetings: meetingsCount.data().count,
      generatedAt: new Date().toISOString(),
    };
    cachedAt = Date.now();
    res.set('Cache-Control', 'public, max-age=300');
    res.json(cached);
  } catch (err) {
    log.error('public stats failed', { error: err.message });
    // Fall back to last cache or a sane zero state.
    res.json(cached || { organizations: 0, meetings: 0, generatedAt: new Date().toISOString() });
  }
});

// GET /api/public/share/:token — Resolve a share link and return the public
// read-only view of the linked series. Unauth so recipients can hit the URL
// without a Google account. Emails are stripped from the response — name +
// attendance count only.
router.get('/public/share/:token', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const link = await resolveShareLink(req.params.token);
    if (!link) return res.status(404).json({ error: 'Link not found, expired, or revoked' });
    if (link.type !== 'series') return res.status(400).json({ error: 'Unsupported share type' });
    const view = await getSharedSeriesView(link.domain, link.recurringEventId);
    if (!view) return res.status(404).json({ error: 'Series no longer available' });
    res.json({ type: link.type, ...view });
  } catch (err) {
    log.error('share: resolve failed', { error: err.message });
    res.status(500).json({ error: 'Failed to load shared view' });
  }
});

// GET /api/public/verify/:code — Independently confirm an issued attendance
// certificate. Unauth by design: a registrar / bar association holds only the
// code printed on the certificate. Returns just what the certificate already
// shows (name, session, date, credit/duration, issuer) — no email, no ids.
router.get('/public/verify/:code', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const code = String(req.params.code || '').trim().toUpperCase();
  if (!/^AT-[0-9A-F]{8}$/.test(code)) {
    return res.status(400).json({ verified: false, error: 'Invalid verification code format.' });
  }
  try {
    const record = await getVerification(code);
    if (!record) return res.status(404).json({ verified: false });
    res.json({ verified: true, ...record });
  } catch (err) {
    log.error('verify: lookup failed', { error: err.message });
    res.status(500).json({ verified: false, error: 'Verification lookup failed.' });
  }
});

// GET /api/public/unsubscribe — One-click CAN-SPAM unsubscribe. Unauth by
// design (recipients aren't signed in when they click an email link); the
// signed HMAC token in the URL proves the request came from a link we sent.
// Records suppression so no further lifecycle emails go to this address, and
// returns a tiny confirmation page.
function unsubscribePage(title, message) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>`
    + `<style>body{font-family:sans-serif;background:#0d1117;color:#e6edf3;display:flex;`
    + `min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center;padding:24px}`
    + `.card{max-width:420px}h1{font-size:20px;margin:0 0 12px}p{color:#8a8f98;line-height:1.5}`
    + `a{color:#1f6feb}</style></head><body><div class="card"><h1>${title}</h1>`
    + `<p>${message}</p><p><a href="https://attendancetracker.dev/">Back to Attendance Tracker</a></p>`
    + `</div></body></html>`;
}

// GET renders a CONFIRMATION page instead of unsubscribing directly: link
// scanners (Outlook SafeLinks, Proofpoint) prefetch every GET in an email,
// which used to silently unsubscribe recipients who never clicked — they then
// stopped getting alerts with no signal. The button POSTs; scanners don't.
router.get('/public/unsubscribe', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const email = typeof req.query.e === 'string' ? req.query.e : '';
  const token = typeof req.query.t === 'string' ? req.query.t : '';
  if (!email || !verifyUnsubscribeToken(email, token)) {
    return res.status(400).type('html').send(
      unsubscribePage('Invalid link', 'This unsubscribe link is invalid or has expired. If you keep getting emails, reply to any of them and I\'ll remove you.')
    );
  }
  res.type('html').send(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title>`
    + `<style>body{font-family:sans-serif;background:#0d1117;color:#e6edf3;display:flex;`
    + `min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center;padding:24px}`
    + `.card{max-width:420px}h1{font-size:20px;margin:0 0 12px}p{color:#8a8f98;line-height:1.5}`
    + `button{background:#f85149;color:#fff;border:none;border-radius:8px;padding:10px 22px;font-size:15px;cursor:pointer}`
    + `a{color:#1f6feb}</style></head><body><div class="card"><h1>Unsubscribe from emails?</h1>`
    + `<p>${escapeHtml(email)} will stop receiving re-engagement and alert emails. You can still use Attendance Tracker normally.</p>`
    + `<form method="POST" action="unsubscribe?e=${encodeURIComponent(email)}&amp;t=${encodeURIComponent(token)}">`
    + `<button type="submit">Unsubscribe</button></form>`
    + `<p><a href="https://attendancetracker.dev/">Never mind — back to Attendance Tracker</a></p>`
    + `</div></body></html>`
  );
});

// POST performs the actual suppression: reached from the confirmation page's
// button AND from mail clients' native one-click unsubscribe (the RFC 8058
// List-Unsubscribe-Post header points here).
router.post('/public/unsubscribe', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const email = typeof (req.body?.e ?? req.query.e) === 'string' ? (req.body?.e ?? req.query.e) : '';
  const token = typeof (req.body?.t ?? req.query.t) === 'string' ? (req.body?.t ?? req.query.t) : '';
  if (!email || !verifyUnsubscribeToken(email, token)) {
    return res.status(400).type('html').send(
      unsubscribePage('Invalid link', 'This unsubscribe link is invalid or has expired. If you keep getting emails, reply to any of them and I\'ll remove you.')
    );
  }
  await suppressEmail(email, { source: 'one_click_unsubscribe' });
  log.info('public: unsubscribe', { email: email.toLowerCase() });
  res.type('html').send(
    unsubscribePage('You\'re unsubscribed', `${escapeHtml(email)} won't receive any more re-engagement or alert emails. You can still use Attendance Tracker normally.`)
  );
});

// GET /api/public/review-click — Tracked redirect for Marketplace 5-star reviews.
// Unauth by design (clicked from email or in-app modal). Records click in telemetry & user doc,
// then redirects to the Workspace Marketplace review page.
router.get('/public/review-click', async (req, res) => {
  const MARKETPLACE_URL = 'https://workspace.google.com/marketplace/app/attendance_tracker/829771833968';
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  const source = typeof req.query.source === 'string' ? req.query.source.slice(0, 50) : 'unknown';

  if (email && email.includes('@')) {
    try {
      const domain = email.split('@')[1];
      // Stamp the CANONICAL user doc (tenants/…) — the old write went to a
      // `domains/…` collection nothing reads, so review clicks were lost.
      // Update-only (no create): this endpoint is unauthenticated, and a
      // fabricated ?email= must not mint phantom user docs that pollute
      // collectionGroup('users') scans and the public user counter.
      const ref = getDb().collection('tenants').doc(domain).collection('users').doc(email);
      await ref.update({
        reviewLinkClickedAt: new Date().toISOString(),
        reviewStatus: 'clicked',
      });
      logEvent(domain, { type: 'review_link_clicked', email, source });
      log.info('public: review link clicked', { email, source });
    } catch (err) {
      // update() throws NOT_FOUND for unknown users — expected for junk input.
      log.warn('public: review click tracking skipped', { email, error: err.message });
    }
  }

  res.redirect(302, `${MARKETPLACE_URL}?utm_source=${encodeURIComponent(source)}`);
});

// GET /api/public/offer-click — Tracked redirect for domain and promotional offers.
// Unauth by design (clicked from outbound campaign emails). Records click in telemetry & user doc,
// then redirects to pricing page or designated target.
router.get('/public/offer-click', async (req, res) => {
  const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  const campaign = typeof req.query.campaign === 'string' ? req.query.campaign.slice(0, 50) : 'domain_offer';
  const plan = typeof req.query.plan === 'string' ? req.query.plan.slice(0, 20) : 'team';
  const target = `https://attendancetracker.dev/pricing.html?plan=${encodeURIComponent(plan)}&ref=${encodeURIComponent(campaign)}&email=${encodeURIComponent(email)}`;

  if (email && email.includes('@')) {
    try {
      const domain = email.split('@')[1];
      const updateData = {
        offerLinkClickedAt: new Date().toISOString(),
        offerStatus: 'clicked',
        offerCampaign: campaign,
      };
      // Canonical path only, update-only: the old `domains/…` write fed a
      // collection nothing reads, and set({merge}) let a fabricated ?email=
      // mint phantom user docs (unauthenticated endpoint) that inflated
      // every collectionGroup('users') scan and the sweeps' budgets.
      await getDb().collection('tenants').doc(domain).collection('users').doc(email).update(updateData);
      logEvent(domain, { type: 'offer_link_clicked', email, campaign, plan });
      log.info('public: offer link clicked', { email, campaign, plan });
    } catch (err) {
      log.warn('public: offer click tracking failed', { email, error: err.message });
    }
  }

  res.redirect(302, target);
});

module.exports = router;
