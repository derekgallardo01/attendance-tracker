const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { FieldValue } = require('@google-cloud/firestore');
const log = require('../lib/logger');
const geoip = require('geoip-lite');
const { getDb, resolveShareLink, getSharedSeriesView, suppressEmail, unsuppressEmail, isEmailSuppressed, getUserSettings, updateUserSettings, getVerification, logEvent, recordCancellationTelemetry, recordPublicPageview } = require('../services/firestore');
const { sendFeedbackEmail, verifyUnsubscribeToken, sendAdminEmail, sendAdminEmailUnsubscribedNotification } = require('../lib/notifications');
const { escapeHtml } = require('../lib/html');
const { verifyUserReview } = require('../services/review-verifier');

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
  skip: () => process.env.NODE_ENV === 'test',
});

// POST /api/public/feedback — In-product feedback widget submissions.
// Unauth (so people can submit from the landing page without signing in).
// Rate-limited per IP. Persists to Firestore + emails Derek.
router.post('/public/feedback', feedbackLimiter, async (req, res) => {
  try {
    /* istanbul ignore next: express.json always sets req.body to an object */
    const raw = req.body || {};
    const body = raw.body || raw.feedback;
    const fromEmail = raw.fromEmail || raw.email;
    const fromName = raw.fromName || raw.name || raw.declaredName;
    const { source, conferenceId, rating } = raw;
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
        rating: typeof rating === 'number' ? rating : null,
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

    let country = req.headers['x-client-geo-country'] || req.headers['cf-ipcountry'] || null;
    if (!country && req.ip) {
      try {
        const geo = geoip.lookup(req.ip);
        if (geo?.country) country = geo.country;
      } catch (_) {}
    }

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
    if (country) dailyPatch[`countries.${country}`] = FieldValue.increment(1);

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
        country: cap(country, 10),
        ref: cap(body.ref, 50),
        event,
        eventLabel: cap(body.eventLabel, 100),
        userAgent: cap(req.headers['user-agent'], 500),
        ip: cap(req.ip, 100), // already truncated by trust proxy; useful for spam triage
        createdAt: FieldValue.serverTimestamp(),
      }),
      db.collection('pageviewsDaily').doc(today).set(dailyPatch, { merge: true }),
      recordPublicPageview({ path: body.path, referrer: body.referrer, country, ref: body.ref }),
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
    + `<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;background:#0d1117;color:#e6edf3;display:flex;`
    + `min-height:100vh;margin:0;align-items:center;justify-content:center;text-align:center;padding:24px}`
    + `.card{max-width:460px;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:28px;box-shadow:0 8px 24px rgba(0,0,0,0.4)}`
    + `h1{font-size:20px;margin:0 0 12px;font-weight:600}p{color:#8b949e;line-height:1.5;font-size:14px}`
    + `a{color:#58a6ff;text-decoration:none}a:hover{text-decoration:underline}</style></head><body><div class="card"><h1>${title}</h1>`
    + `<p>${message}</p><p style="margin-top:20px"><a href="https://attendancetracker.dev/">Back to Attendance Tracker</a></p>`
    + `</div></body></html>`;
}

// GET renders a granular preference & confirmation page instead of unsubscribing directly: link
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

  const domain = email.split('@')[1];
  let suppressed = false;
  let prefs = {};
  try {
    if (typeof isEmailSuppressed === 'function') {
      suppressed = await isEmailSuppressed(email);
    }
    if (domain && typeof getUserSettings === 'function') {
      const settings = await getUserSettings(domain, email);
      prefs = settings?.notificationPreferences || {};
    }
  } catch (err) {
    log.warn('public: error fetching preferences for unsubscribe page', { email, error: err.message });
  }

  const exportSummary = !suppressed && prefs.exportSummary !== false;
  const seriesAlerts = !suppressed && prefs.seriesAlerts !== false;
  const weeklyDigest = !suppressed && prefs.weeklyDigest !== false;
  const tipsAndUpdates = !suppressed && prefs.tipsAndUpdates !== false;

  res.type('html').send(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe &amp; Email Preferences</title>`
    + `<style>`
    + `body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;background:#0d1117;color:#e6edf3;display:flex;min-height:100vh;margin:0;align-items:center;justify-content:center;padding:24px;box-sizing:border-box}`
    + `.card{max-width:480px;width:100%;background:#161b22;border:1px solid #30363d;border-radius:12px;padding:28px;box-shadow:0 8px 24px rgba(0,0,0,0.4);text-align:center}`
    + `h1{font-size:20px;margin:0 0 8px;font-weight:600;color:#f0f6fc}`
    + `p.sub{color:#8b949e;line-height:1.5;font-size:14px;margin:0 0 20px}`
    + `.pref-group{text-align:left;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:14px 16px;margin-bottom:20px}`
    + `.pref-item{display:flex;align-items:flex-start;gap:12px;padding:8px 0;cursor:pointer}`
    + `.pref-item:not(:last-child){border-bottom:1px solid #21262d}`
    + `.pref-item input{margin-top:3px;accent-color:#238636;cursor:pointer}`
    + `.pref-title{font-size:14px;font-weight:600;color:#c9d1d9}`
    + `.pref-desc{font-size:12px;color:#8b949e;line-height:1.4;margin-top:2px}`
    + `.btn-save{background:#238636;color:#fff;border:none;border-radius:6px;padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer;width:100%;margin-bottom:10px}`
    + `.btn-save:hover{background:#2ea043}`
    + `.btn-unsub{background:transparent;color:#f85149;border:1px solid #30363d;border-radius:6px;padding:9px 16px;font-size:13px;cursor:pointer;width:100%}`
    + `.btn-unsub:hover{border-color:#f85149;background:rgba(248,81,73,0.08)}`
    + `.notice{background:#21262d;border-radius:6px;padding:10px 12px;margin-bottom:16px;font-size:13px;color:#f0883e;text-align:left}`
    + `a{color:#58a6ff;text-decoration:none;font-size:13px}a:hover{text-decoration:underline}`
    + `.footer-link{text-align:center;margin-top:18px}`
    + `</style></head><body><div class="card"><h1>Unsubscribe from emails?</h1>`
    + `<p class="sub">Choose which notifications <strong>${escapeHtml(email)}</strong> should receive, or opt out of all messages.</p>`
    + (suppressed ? `<div class="notice">⚠️ You are currently opted out of all emails. Checking any box below will reactivate that specific notification.</div>` : '')
    + `<form method="POST" action="unsubscribe?e=${encodeURIComponent(email)}&amp;t=${encodeURIComponent(token)}" id="pref-form">`
    + `<input type="hidden" name="action" id="action-input" value="save">`
    + `<div class="pref-group">`
    + `<label class="pref-item"><input type="checkbox" name="exportSummary" ${exportSummary ? 'checked' : ''}><div><div class="pref-title">Export &amp; Attendance Summaries</div><div class="pref-desc">Reports generated after taking attendance or exporting to Google Sheets.</div></div></label>`
    + `<label class="pref-item"><input type="checkbox" name="seriesAlerts" ${seriesAlerts ? 'checked' : ''}><div><div class="pref-title">Absence &amp; Streak Alerts</div><div class="pref-desc">Notifications when participants hit absence thresholds or notable streaks.</div></div></label>`
    + `<label class="pref-item"><input type="checkbox" name="weeklyDigest" ${weeklyDigest ? 'checked' : ''}><div><div class="pref-title">Weekly Digest</div><div class="pref-desc">Weekly summary of meetings held, attendance rates, and team trends.</div></div></label>`
    + `<label class="pref-item"><input type="checkbox" name="tipsAndUpdates" ${tipsAndUpdates ? 'checked' : ''}><div><div class="pref-title">Tips &amp; Feature Updates</div><div class="pref-desc">Helpful tips and major feature announcements.</div></div></label>`
    + `</div>`
    + `<button type="submit" class="btn-save">Save Preferences</button>`
    + `<button type="button" class="btn-unsub" onclick="document.getElementById('action-input').value='all';document.getElementById('pref-form').submit();">Unsubscribe from All Emails</button>`
    + `</form>`
    + `<div class="footer-link"><a href="https://attendancetracker.dev/">Never mind — back to Attendance Tracker</a></div>`
    + `</div></body></html>`
  );
});

// POST performs the actual suppression or updates granular preferences:
// reached from the confirmation page buttons AND from mail clients' native
// one-click unsubscribe (the RFC 8058 List-Unsubscribe-Post header points here).
router.post('/public/unsubscribe', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const email = typeof (req.body?.e ?? req.query.e) === 'string' ? (req.body?.e ?? req.query.e) : '';
  const token = typeof (req.body?.t ?? req.query.t) === 'string' ? (req.body?.t ?? req.query.t) : '';
  if (!email || !verifyUnsubscribeToken(email, token)) {
    return res.status(400).type('html').send(
      unsubscribePage('Invalid link', 'This unsubscribe link is invalid or has expired. If you keep getting emails, reply to any of them and I\'ll remove you.')
    );
  }

  const action = req.body?.action;
  // If explicitly 'all', or if neither 'action' nor any category is provided
  // (e.g. standard RFC 8058 one-click unsubscribe from email clients)
  if (action === 'all' || (!action && !req.body?.exportSummary && !req.body?.seriesAlerts && !req.body?.weeklyDigest && !req.body?.tipsAndUpdates)) {
    await suppressEmail(email, { source: 'one_click_unsubscribe' });
    const unsubSource = action === 'all' ? 'public_all_button' : 'one_click_unsubscribe';
    const domain = email.split('@')[1];
    try {
      await recordCancellationTelemetry({
        category: 'email',
        type: 'unsubscribed_all',
        email,
        domain,
        meta: { source: unsubSource },
      });
      log.info('telemetry: email_unsubscribed_all', { email: email.toLowerCase(), domain, source: unsubSource });
    } catch {}
    try {
      sendAdminEmailUnsubscribedNotification({
        email,
        domain,
        type: 'all',
        source: unsubSource,
      }).catch(err => log.warn('public: sendAdminEmailUnsubscribedNotification failed', { email, error: err.message }));
    } catch {}
    log.info('public: unsubscribe all', { email: email.toLowerCase() });
    return res.type('html').send(
      unsubscribePage('You\'re unsubscribed', `${escapeHtml(email)} won't receive any more re-engagement or alert emails. You can still use Attendance Tracker normally.`)
    );
  }

  // Otherwise, user submitted granular preferences form
  const exportSummary = req.body.exportSummary === 'on' || req.body.exportSummary === true || req.body.exportSummary === 'true';
  const seriesAlerts = req.body.seriesAlerts === 'on' || req.body.seriesAlerts === true || req.body.seriesAlerts === 'true';
  const weeklyDigest = req.body.weeklyDigest === 'on' || req.body.weeklyDigest === true || req.body.weeklyDigest === 'true';
  const tipsAndUpdates = req.body.tipsAndUpdates === 'on' || req.body.tipsAndUpdates === true || req.body.tipsAndUpdates === 'true';

  const domain = email.split('@')[1];
  const disabledCategories = [];
  const enabledCategories = [];
  if (exportSummary) enabledCategories.push('exportSummary'); else disabledCategories.push('exportSummary');
  if (seriesAlerts) enabledCategories.push('seriesAlerts'); else disabledCategories.push('seriesAlerts');
  if (weeklyDigest) enabledCategories.push('weeklyDigest'); else disabledCategories.push('weeklyDigest');
  if (tipsAndUpdates) enabledCategories.push('tipsAndUpdates'); else disabledCategories.push('tipsAndUpdates');

  if (disabledCategories.length === 4) {
    // All unchecked = full unsubscribe
    await suppressEmail(email, { source: 'granular_unsubscribe_all' });
    if (domain && typeof updateUserSettings === 'function') {
      try {
        await updateUserSettings(domain, email, {
          notificationPreferences: { exportSummary: false, seriesAlerts: false, weeklyDigest: false, tipsAndUpdates: false }
        });
      } catch (err) {
        log.warn('public: updateUserSettings failed on granular unsubscribe all', { email, error: err.message });
      }
    }
    try {
      await recordCancellationTelemetry({
        category: 'email',
        type: 'unsubscribed_all',
        email,
        domain,
        meta: { source: 'granular_unsubscribe_all' },
      });
      log.info('telemetry: email_unsubscribed_all', { email: email.toLowerCase(), domain, source: 'granular_unsubscribe_all' });
    } catch {}
    try {
      sendAdminEmailUnsubscribedNotification({
        email,
        domain,
        type: 'all',
        source: 'granular_unsubscribe_all',
      }).catch(err => log.warn('public: sendAdminEmailUnsubscribedNotification failed', { email, error: err.message }));
    } catch {}
    log.info('public: unsubscribe all via preferences', { email: email.toLowerCase() });
    return res.type('html').send(
      unsubscribePage('You\'re unsubscribed', `${escapeHtml(email)} won't receive any more re-engagement or alert emails. You can still use Attendance Tracker normally.`)
    );
  }

  // At least one notification enabled -> unsuppress from global suppression if suppressed
  if (typeof unsuppressEmail === 'function') {
    await unsuppressEmail(email);
  }
  if (domain && typeof updateUserSettings === 'function') {
    try {
      await updateUserSettings(domain, email, {
        notificationPreferences: { exportSummary, seriesAlerts, weeklyDigest, tipsAndUpdates }
      });
    } catch (err) {
      log.warn('public: updateUserSettings failed on save preferences', { email, error: err.message });
    }
  }
  try {
    await recordCancellationTelemetry({
      category: 'email',
      type: 'preferences_updated',
      email,
      domain,
      meta: { disabledCategories, enabledCategories, source: 'public_preferences' },
    });
    log.info('telemetry: email_preferences_updated', { email: email.toLowerCase(), domain, disabledCategories, enabledCategories, source: 'public_preferences' });
  } catch {}
  if (disabledCategories.length > 0) {
    try {
      sendAdminEmailUnsubscribedNotification({
        email,
        domain,
        type: 'categories',
        disabledCategories,
        enabledCategories,
        source: 'public_preferences',
      }).catch(err => log.warn('public: sendAdminEmailUnsubscribedNotification failed', { email, error: err.message }));
    } catch {}
  }
  log.info('public: preferences updated', { email: email.toLowerCase(), exportSummary, seriesAlerts, weeklyDigest, tipsAndUpdates });
  return res.type('html').send(
    unsubscribePage('Preferences updated', `Your email notification preferences for ${escapeHtml(email)} have been updated.`)
  );
});

// POST /api/public/unsubscribe-direct — Self-serve unsubscription from /unsubscribe.html
// without requiring an email HMAC token (for users navigating from footers or site links).
const unsubDirectLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

router.post('/public/unsubscribe-direct', unsubDirectLimiter, async (req, res) => {
  try {
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!rawEmail || !rawEmail.includes('@') || rawEmail.length > 200) {
      return res.status(400).json({ error: 'A valid email address is required.' });
    }
    const email = rawEmail;
    const domain = email.split('@')[1] || '';
    const unsubSource = 'public_direct_form';

    await suppressEmail(email, { source: unsubSource });

    try {
      await recordCancellationTelemetry({
        category: 'email',
        type: 'unsubscribed_all',
        email,
        domain,
        meta: { source: unsubSource },
      });
      log.info('telemetry: email_unsubscribed_all', { email, domain, source: unsubSource });
    } catch {}

    try {
      sendAdminEmailUnsubscribedNotification({
        email,
        domain,
        type: 'all',
        source: unsubSource,
      }).catch(err => log.warn('public: sendAdminEmailUnsubscribedNotification failed', { email, error: err.message }));
    } catch {}

    log.info('public: direct unsubscribe', { email });
    return res.json({
      success: true,
      message: `${email} has been successfully unsubscribed from all emails.`,
    });
  } catch (err) {
    log.error('public: unsubscribe-direct failed', { error: err.message });
    return res.status(500).json({ error: 'Failed to process unsubscribe request.' });
  }
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

// POST /api/public/verify-review — Verify a submitted review and unlock 1 month of Pro
router.post('/public/verify-review', async (req, res) => {
  const { email, declaredName } = req.body || {};
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required.' });
  }
  const cleanEmail = email.trim().toLowerCase();
  const domain = cleanEmail.split('@')[1];
  try {
    const result = await verifyUserReview(domain, cleanEmail, declaredName);
    res.json(result);
  } catch (err) {
    log.error('public: verify-review failed', { email: cleanEmail, error: err.message });
    res.status(500).json({ error: 'Failed to verify review.' });
  }
});

module.exports = router;
