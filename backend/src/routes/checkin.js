const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const log = require('../lib/logger');
const { saveCheckin, getCheckins } = require('../services/firestore');

const router = Router();

// Check-ins are cheap writes from a wide audience (every attendee, not just
// hosts), so they get their own limiter on top of the global apiLimiter —
// modeled on verifyDelegationLimiter, with the test skip feedbackLimiter
// forgot.
const checkinLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many check-in requests, please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});

// POST /api/checkin — attendee taps "I'm here". Identity comes ONLY from the
// authenticated session (the delete-account precedent) — the body just names
// the meeting. Works for both full users and attendee-mode sessions (which
// have no Firestore user doc).
router.post('/checkin', checkinLimiter, requireAuth, async (req, res) => {
  try {
    const { meetingCode } = req.body || {};
    if (!meetingCode) return res.status(400).json({ error: 'meetingCode is required' });
    const result = await saveCheckin(meetingCode, {
      email: req.user.email,
      displayName: req.user.displayName,
    });
    res.json({ checkedInAt: result.checkedInAt, already: result.already });
  } catch (err) {
    if (err.badInput) return res.status(400).json({ error: 'Invalid meeting code' });
    log.error('checkin: save failed', { email: req.user.email, error: err.message });
    res.status(500).json({ error: 'Check-in failed' });
  }
});

// GET /api/checkins?meetingCode=… — the host's poll companion: everyone who
// has checked in to this meeting. Any authenticated caller may read a code's
// check-ins — the meeting code itself is the shared secret (same trust model
// as joining the Meet), and the payload is data attendees deliberately
// submitted to be shown to the host.
router.get('/checkins', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { meetingCode } = req.query;
    if (!meetingCode) return res.status(400).json({ error: 'meetingCode is required' });
    const checkins = await getCheckins(meetingCode);
    res.json({ checkins });
  } catch (err) {
    log.error('checkin: read failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch check-ins' });
  }
});

module.exports = router;
