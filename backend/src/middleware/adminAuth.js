// Super-admin route guards. Mirrors the requireTeamAdmin pattern in
// routes/team.js, but gates on the app owner (config.superAdminEmail) — the
// single source of truth for who can reach the admin dashboard / CRM routes.
// Replaces ~24 identical inline `if (req.user?.email !== …) return 403` checks.
const CONFIG = require('../config');

function requireSuperAdmin(req, res, next) {
  if (req.user?.email !== CONFIG.superAdminEmail) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// For the daily cron sweeps: allow the super-admin session OR a matching
// x-scheduler-secret header (so Cloud Scheduler can call them unauthenticated).
function requireSuperAdminOrScheduler(req, res, next) {
  const schedulerSecret = process.env.SCHEDULER_SECRET;
  const hasSchedulerToken = !!schedulerSecret && req.headers['x-scheduler-secret'] === schedulerSecret;
  if (req.user?.email !== CONFIG.superAdminEmail && !hasSchedulerToken) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

const crypto = require('crypto');

// Constant-time compare that tolerates unequal lengths without leaking them.
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

// Durable metrics pull for the Kinetic Helix command center. Gated by a static
// x-kh-key header (vs KH_METRICS_KEY) instead of an expiring super-admin session
// cookie, so the command-center connection never drops.
function requireKhMetricsKey(req, res, next) {
  const key = process.env.KH_METRICS_KEY;
  const provided = req.headers['x-kh-key'];
  if (!key || !provided || !safeEqual(provided, key)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

module.exports = { requireSuperAdmin, requireSuperAdminOrScheduler, requireKhMetricsKey };
