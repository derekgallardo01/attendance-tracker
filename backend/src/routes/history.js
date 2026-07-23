const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const log = require('../lib/logger');
const { getUserMeetingHistory, getUserMeetingSeries, getParticipantHistory, setParticipantNote, getParticipantNote, logEvent, createShareLink, revokeShareLink } = require('../services/firestore');
const { planIsPro } = require('./billing');

const router = Router();

// Free tier sees only their most-recent meetings in history; Pro sees all.
// This is a READ cap (nothing is deleted), so upgrading instantly restores the
// full view. The `meetings` array from getUserMeetingHistory is newest-first.
const FREE_HISTORY_LIMIT = 25;

// Allow-list of frontend-loggable event types. Keep this narrow so the client
// can't pollute the per-user event log with arbitrary strings. Each entry is
// a funnel signal we couldn't capture server-side (clicks, dismissals, etc.).
const FRONTEND_EVENT_TYPES = new Set([
  'export_clicked',
  'export_failed',
  'export_cancelled',
  // Fired when a user leaves with tracked-but-unexported data, tagged with a
  // reason (scope_blocked / meeting_not_ended / …) so we can measure and
  // diagnose the tracked→exported drop-off.
  'export_skipped',
]);

// POST /api/event — let the frontend record activation/funnel events that only
// exist in the browser (e.g. "user clicked Export but it failed" vs "user
// never clicked Export"). Validates the type and caps the meta blob size.
router.post('/event', requireAuth, async (req, res) => {
  /* istanbul ignore next: express.json always sets req.body to an object */
  const { type, meta } = req.body || {};
  if (!FRONTEND_EVENT_TYPES.has(type)) return res.status(400).json({ error: 'Invalid event type' });
  let safeMeta = null;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    safeMeta = {};
    for (const [k, v] of Object.entries(meta).slice(0, 10)) {
      const key = String(k).slice(0, 50);
      if (typeof v === 'string') safeMeta[key] = v.slice(0, 500);
      else if (typeof v === 'number' || typeof v === 'boolean') safeMeta[key] = v;
    }
  }
  try {
    await logEvent(req.user.domain, { email: req.user.email, type, meta: safeMeta });
    res.json({ ok: true });
  } catch (err) {
    log.error('event log failed', { error: err.message, type });
    res.status(500).json({ error: 'Failed to log event' });
  }
});

// POST /api/share — mint a public share link for a series. The owner picks
// a recurringEventId from their Series tab; we return an opaque token they
// can paste into Slack/email/etc. Recipients hit /share.html?t=<token>.
router.post('/share', requireAuth, async (req, res) => {
  /* istanbul ignore next: express.json always sets req.body to an object */
  const { recurringEventId, type } = req.body || {};
  if (!recurringEventId) return res.status(400).json({ error: 'recurringEventId is required' });
  try {
    const result = await createShareLink(req.user.domain, req.user.email, { type: type || 'series', recurringEventId });
    res.json({
      token: result.token,
      url: `https://attendancetracker.dev/share.html?t=${result.token}`,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    log.error('share: create failed', { error: err.message, email: req.user.email });
    res.status(500).json({ error: 'Failed to create share link' });
  }
});

// POST /api/share/revoke — kill a share link the caller owns before its 30-day
// TTL (a leaked/forwarded link had no revoke path before). Owner-verified.
router.post('/share/revoke', requireAuth, async (req, res) => {
  /* istanbul ignore next: express.json always sets req.body to an object */
  const { token } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token is required' });
  try {
    const result = await revokeShareLink(token, req.user.email);
    if (result.revoked) return res.json({ success: true });
    const status = { not_found: 404, not_owner: 403 };
    return res.status(status[result.reason] || 500).json({
      error: result.reason === 'not_owner' ? 'That share link belongs to someone else.' : 'Could not revoke the share link.',
    });
  } catch (err) {
    log.error('share: revoke failed', { error: err.message, email: req.user.email });
    res.status(500).json({ error: 'Failed to revoke share link' });
  }
});

// GET /api/series — recurring-meeting roll-ups for the signed-in user.
// Groups tracked meetings by Calendar's recurringEventId and aggregates per-person
// attendance ("Alex 12/15 standups, 80%"). Empty for users who've only tracked
// instant meetings or single-occurrence events.
router.get('/series', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const data = await getUserMeetingSeries(req.user.domain, req.user.email);
    res.json(data);
  } catch (err) {
    log.error('series: fetch failed', { error: err.message, email: req.user.email });
    res.status(500).json({ error: 'Failed to fetch series' });
  }
});

// GET /api/history — returns meetings + people + calendar for the signed-in
// user, scoped to their tenant. Requires the auth middleware (mounted before
// this route in app.js) to set req.user.
router.get('/history', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    // Free tier: cap at the DATA layer (pass the limit) so meetings AND the
    // derived people/calendar analytics reflect only the visible set — not just
    // the meetings list. The service returns historyCapped/freeLimit/totalMeetings
    // so the frontend can show "Upgrade to see all N". Pro passes no limit.
    const pro = await planIsPro(req.user.domain);
    const data = await getUserMeetingHistory(req.user.domain, req.user.email, {
      limit: pro ? null : FREE_HISTORY_LIMIT,
    });
    res.json(data);
  } catch (err) {
    log.error('history: fetch failed', { error: err.message, email: req.user.email });
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// GET /api/participant?key=email_or_name_key — history for one participant
// + the requester's private note attached to them.
router.get('/participant', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
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
router.put('/participant/note', requireAuth, async (req, res) => {
  /* istanbul ignore next: express.json always sets req.body to an object */
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
