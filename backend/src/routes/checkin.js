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

// GET /api/checkin/export?meetingCode= — attestation CSV of a meeting's
// self-check-ins: who actively confirmed presence, with verified email and
// timestamp. This is the COMPLIANCE artifact built on the free check-in
// capture (gate the artifact, never the capture) — Pro only.
// Returns JSON {csv, count}: the Meet iframe can't download files directly,
// so the panel routes the text through its download relay like every CSV.
router.get('/checkin/export', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const { meetingCode } = req.query;
    if (!meetingCode) return res.status(400).json({ error: 'meetingCode is required' });
    const { planIsPro } = require('./billing');
    const pro = await planIsPro(req.user.domain, req.user.email);
    if (!pro) {
      return res.status(402).json({ error: 'Check-in attestation exports are a Pro feature.', upgrade: true, feature: 'attestation' });
    }
    // strict: a swallowed read error here would emit a plausible CSV
    // certifying zero check-ins — for a compliance artifact that must 500.
    const checkins = await getCheckins(meetingCode, { strict: true });
    const esc = (v) => {
      let s = String(v ?? '');
      // Formula-injection guard (same rule as sheets.js sanitizeCell):
      // display names are attendee-controlled and spreadsheets execute a
      // leading =/+/-/@ even in quoted CSV fields.
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const rows = [
      ['Name', 'Email', 'Checked in at (UTC)', 'Meeting code'].map(esc).join(','),
      ...checkins.map(c => [c.displayName, c.email, c.checkedInAt, String(meetingCode).toLowerCase()].map(esc).join(',')),
      '',
      esc(`Self-reported check-ins collected in-meeting via Attendance Tracker (attendancetracker.dev) · generated ${new Date().toISOString()} by ${req.user.email}`),
    ];
    res.json({ csv: '\uFEFF' + rows.join('\r\n'), count: checkins.length });
  } catch (err) {
    log.error('checkin: export failed', { email: req.user.email, error: err.message });
    res.status(500).json({ error: 'Failed to export check-ins' });
  }
});

module.exports = router;
