const { Router } = require('express');
const log = require('../lib/logger');
const { getDb } = require('../services/firestore');

const router = Router();

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
