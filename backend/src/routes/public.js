const { Router } = require('express');
const { FieldValue } = require('@google-cloud/firestore');
const log = require('../lib/logger');
const { getDb } = require('../services/firestore');

const router = Router();

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

module.exports = router;
