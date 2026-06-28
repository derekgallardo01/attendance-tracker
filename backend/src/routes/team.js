const { Router } = require('express');
const log = require('../lib/logger');
const { getUser, getTeamOverview } = require('../services/firestore');

const router = Router();

// Middleware: every endpoint in this router requires the caller to be the
// team admin for their own tenant. Pattern mirrors the super-admin check in
// admin.js but reads the flag off the user doc instead of a hardcoded email.
async function requireTeamAdmin(req, res, next) {
  if (!req.user?.email || !req.user?.domain) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const user = await getUser(req.user.domain, req.user.email);
    if (!user?.teamAdmin) {
      return res.status(403).json({ error: 'Team admin role required' });
    }
    next();
  } catch (err) {
    log.error('team: auth check failed', { error: err.message });
    return res.status(500).json({ error: 'Authorization check failed' });
  }
}

// GET /api/team/overview — one-shot fetch with all four tabs' data.
// team.html does a single round-trip and renders Users / Meetings / Series /
// People from the same payload, so tab switches are instant.
router.get('/team/overview', requireTeamAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const data = await getTeamOverview(req.user.domain);
    if (!data) return res.status(500).json({ error: 'Failed to build team overview' });
    res.json(data);
  } catch (err) {
    log.error('team: overview failed', { error: err.message, domain: req.user.domain });
    res.status(500).json({ error: 'Failed to fetch team overview' });
  }
});

module.exports = router;
