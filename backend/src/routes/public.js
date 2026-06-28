const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { FieldValue } = require('@google-cloud/firestore');
const log = require('../lib/logger');
const { getDb, resolveShareLink, getSharedSeriesView } = require('../services/firestore');
const { sendFeedbackEmail } = require('../lib/notifications');

const router = Router();

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
    const { body, fromEmail, fromName, source, conferenceId } = req.body || {};
    if (!body || typeof body !== 'string' || body.trim().length < 2) {
      return res.status(400).json({ error: 'Feedback body is required' });
    }
    const cap = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
    const safeBody = body.trim().slice(0, 5000);
    const userAgent = cap(req.headers['user-agent'], 500);

    // Persist before sending so we have a record even if SMTP is down.
    try {
      await getDb().collection('feedback').add({
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

    await sendFeedbackEmail({
      body: safeBody,
      fromEmail: cap(fromEmail, 200),
      fromName: cap(fromName, 200),
      source: cap(source, 100),
      conferenceId: cap(conferenceId, 100),
      userAgent,
    });
    res.json({ success: true });
  } catch (err) {
    log.error('feedback: send failed', { error: err.message });
    res.status(500).json({ error: 'Failed to submit feedback' });
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
    const body = req.body || {};
    // Cap every string so a malicious caller can't bloat docs.
    const cap = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
    const today = new Date().toISOString().slice(0, 10);
    const db = getDb();

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
        userAgent: cap(req.headers['user-agent'], 500),
        ip: cap(req.ip, 100), // already truncated by trust proxy; useful for spam triage
        createdAt: FieldValue.serverTimestamp(),
      }),
      db.collection('pageviewsDaily').doc(today).set({
        date: today,
        count: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true }),
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
router.get('/public/stats', async (_req, res) => {
  try {
    if (cached && (Date.now() - cachedAt) < CACHE_MS) {
      res.set('Cache-Control', 'public, max-age=300');
      return res.json(cached);
    }

    const db = getDb();
    const [tenantsSnap, usersSnap, meetingsSnap] = await Promise.all([
      db.collection('tenants').get(),
      db.collectionGroup('users').get(),
      db.collectionGroup('meetings').get(),
    ]);

    const domains = new Set();
    for (const d of tenantsSnap.docs) domains.add(d.id);
    for (const d of usersSnap.docs) domains.add(d.ref.parent.parent.id);

    cached = {
      organizations: domains.size,
      meetings: meetingsSnap.size,
      generatedAt: new Date().toISOString(),
    };
    cachedAt = Date.now();
    res.set('Cache-Control', 'public, max-age=300');
    res.json(cached);
  } catch (err) {
    log.warn('public stats failed', { error: err.message });
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
    log.warn('share: resolve failed', { error: err.message });
    res.status(500).json({ error: 'Failed to load shared view' });
  }
});

module.exports = router;
