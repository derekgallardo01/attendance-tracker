const { Router } = require('express');
const log = require('../lib/logger');
const { requireAuth } = require('../middleware/auth');
const { getTeamOverview, getTeamAdminStatus, claimTeamAdmin, transferTeamAdmin } = require('../services/firestore');
const { requireProPlan } = require('./billing');

const router = Router();

// Human-readable messages for the claim/transfer failure reasons + the HTTP
// status each maps to. Kept together so the two routes can't drift.
const ADMIN_FAIL = {
  personal_domain: { status: 403, error: 'Team admin is only available for Google Workspace domains, not personal email accounts.' },
  taken:           { status: 409, error: 'This domain already has a team admin. Ask them to transfer the role to you.' },
  no_user:         { status: 404, error: 'Your account was not found for this domain.' },
  not_admin:       { status: 403, error: 'Only the current team admin can transfer the role.' },
  no_target_user:  { status: 404, error: 'That person has not signed in to Attendance Tracker on this domain yet.' },
  invalid_target:  { status: 400, error: 'Pick a different teammate to transfer the role to.' },
  error:           { status: 500, error: 'Something went wrong. Please try again.' },
};

// Middleware: every endpoint in this router requires the caller to be the team
// admin for their own tenant. Authorizes against the SINGLE SOURCE OF TRUTH —
// tenant.adminEmail (via getTeamAdminStatus) — NOT the denormalized
// user.teamAdmin cache. The cache can drift high (two concurrent first-signins
// both auto-claim; an admin change via the install webhook doesn't clear the
// prior admin's flag), and gating on it would grant a stale user org-wide data
// access. tenant.adminEmail is the one value the claim/transfer transactions
// keep authoritative.
async function requireTeamAdmin(req, res, next) {
  if (!req.user?.email || !req.user?.domain) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  try {
    const { isTeamAdmin } = await getTeamAdminStatus(req.user.domain, req.user.email);
    if (!isTeamAdmin) {
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
// The org-wide team dashboard is a Pro feature (per-domain billing). While
// billing is unconfigured requireProPlan is a pass-through, so this stays free
// until monetization is switched on.
// GET /api/team/admin-status — what team.html needs to render the admin /
// claim-role UI: whether the caller is the admin, who the admin is, and whether
// they can claim the role (vacant seat on a real Workspace domain).
router.get('/team/admin-status', requireAuth, async (req, res) => {
  try {
    const status = await getTeamAdminStatus(req.user.domain, req.user.email);
    res.json(status);
  } catch (err) {
    log.error('team: admin-status failed', { error: err.message, domain: req.user.domain });
    res.status(500).json({ error: 'Failed to fetch admin status' });
  }
});

// POST /api/team/claim-admin — claim the team-admin role when it's vacant (or
// the caller already holds it). Refuses personal-email tenants and silent
// takeover of an existing admin (409 → ask them to transfer).
router.post('/team/claim-admin', requireAuth, async (req, res) => {
  try {
    const result = await claimTeamAdmin(req.user.domain, req.user.email);
    if (result.claimed) return res.json({ success: true, adminEmail: result.adminEmail });
    const f = ADMIN_FAIL[result.reason] || ADMIN_FAIL.error;
    return res.status(f.status).json({ error: f.error, adminEmail: result.adminEmail || null });
  } catch (err) {
    log.error('team: claim-admin failed', { error: err.message, domain: req.user.domain });
    res.status(500).json({ error: 'Failed to claim team admin' });
  }
});

// POST /api/team/transfer-admin — current admin hands the role to another user
// in the same domain. Guarded by requireTeamAdmin so only the admin can call.
router.post('/team/transfer-admin', requireTeamAdmin, async (req, res) => {
  const { toEmail } = req.body || {};
  if (!toEmail) return res.status(400).json({ error: 'toEmail is required' });
  try {
    const result = await transferTeamAdmin(req.user.domain, req.user.email, toEmail);
    if (result.transferred) return res.json({ success: true, adminEmail: result.adminEmail });
    const f = ADMIN_FAIL[result.reason] || ADMIN_FAIL.error;
    return res.status(f.status).json({ error: f.error });
  } catch (err) {
    log.error('team: transfer-admin failed', { error: err.message, domain: req.user.domain });
    res.status(500).json({ error: 'Failed to transfer team admin' });
  }
});

router.get('/team/overview', requireTeamAdmin, requireProPlan, async (req, res) => {
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
