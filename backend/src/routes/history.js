const { Router } = require('express');
const log = require('../lib/logger');
const { getUserMeetingHistory } = require('../services/firestore');

const router = Router();

// GET /api/history — returns meetings + people + calendar for the signed-in
// user, scoped to their tenant. Requires the auth middleware (mounted before
// this route in app.js) to set req.user.
router.get('/history', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user?.email) return res.status(401).json({ error: 'Authentication required' });
  try {
    const data = await getUserMeetingHistory(req.user.domain, req.user.email);
    res.json(data);
  } catch (err) {
    log.error('history: fetch failed', { error: err.message, email: req.user.email });
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

module.exports = router;
