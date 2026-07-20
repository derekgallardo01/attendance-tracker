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

module.exports = { requireSuperAdmin, requireSuperAdminOrScheduler };
