const { Router } = require('express');
const log = require('../lib/logger');
const { getUserMeetingHistory, getParticipantHistory, setParticipantNote, getParticipantNote } = require('../services/firestore');

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

// GET /api/participant?key=email_or_name_key — history for one participant
// + the requester's private note attached to them.
router.get('/participant', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user?.email) return res.status(401).json({ error: 'Authentication required' });
  const key = (req.query.key || '').toString().trim();
  if (!key) return res.status(400).json({ error: 'key is required' });
  try {
    const [history, note] = await Promise.all([
      getParticipantHistory(req.user.domain, req.user.email, key),
      getParticipantNote(req.user.domain, req.user.email, key),
    ]);
    if (!history) return res.status(404).json({ error: 'Not found' });
    res.json({ ...history, note });
  } catch (err) {
    log.error('participant fetch failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch participant' });
  }
});

// PUT /api/participant/note — save (or clear, with empty body) the
// requester's private note on a participant.
router.put('/participant/note', async (req, res) => {
  if (!req.user?.email) return res.status(401).json({ error: 'Authentication required' });
  const { key, body } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key is required' });
  try {
    const result = await setParticipantNote(req.user.domain, req.user.email, key, body || '');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save note' });
  }
});

module.exports = router;
