const required = (name) => {
  const val = process.env[name];
  if (!val) { console.error(`FATAL: ${name} env var not set`); process.exit(1); }
  return val;
};

const CONFIG = {
  // OAuth (Phase 3)
  googleClientId:        required('GOOGLE_CLIENT_ID'),
  oauthClientSecretName: required('OAUTH_CLIENT_SECRET_NAME'),
  sessionSecret:         required('SESSION_SECRET'),

  // Service account (legacy / Meet API)
  secretName:       required('SECRET_NAME'),
  impersonateEmail: process.env.IMPERSONATE_EMAIL || null,
  sheetId:          process.env.SHEET_ID || null,
  adminEmail:       process.env.ADMIN_EMAIL || null, // Directory API enrichment (NOT the app owner)

  // The app owner / super-admin — gates the admin dashboard + CRM routes and is
  // excluded from lifecycle email + analytics. Single source of truth (was
  // hardcoded separately in routes/admin.js and services/firestore.js).
  superAdminEmail:  process.env.SUPER_ADMIN_EMAIL || 'derekgallardo01@gmail.com',

  // General — meet.google.com always allowed (side panel iframe)
  allowedOrigins:  [...new Set([
    'https://meet.google.com',
    ...(process.env.ALLOWED_ORIGINS || 'https://attendancetracker.dev,https://derekgallardo01.github.io').split(','),
  ])],
  allowedDomains:  (process.env.ALLOWED_DOMAINS || '*').split(','),
  port:             process.env.PORT || 8080,
  gcpProjectId:     process.env.GCP_PROJECT_ID || null,

  // How long any single request may run before the socket is destroyed. Shared
  // (was inline in server.js) so long-running handlers — notably the cron sweeps
  // — can keep their work budget safely under it instead of being silently
  // killed mid-loop. Raise REQUEST_TIMEOUT_MS on the service that runs the crons
  // if you want longer sweeps.
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS) || 30000,

  // Public, absolute URL of this backend's /api mount. Used to build links in
  // emails (e.g. one-click unsubscribe) that must hit the API directly — the
  // marketing site on attendancetracker.dev is static GitHub Pages and does
  // not proxy /api. Overridable via env for staging.
  publicApiUrl:     process.env.PUBLIC_API_URL || 'https://attendance-tracker-backend-829771833968.us-central1.run.app/api',

  // Public marketing/app site (GitHub Pages). Used for Stripe success/cancel
  // redirect URLs.
  publicSiteUrl:    process.env.PUBLIC_SITE_URL || 'https://attendancetracker.dev',
};

// The superAdminEmail fallback is a convenience for local dev, but in a deployed
// environment an unset SUPER_ADMIN_EMAIL silently binds ALL admin/CRM/analytics
// routes to a hardcoded personal Gmail — a security landmine. Warn loudly at
// boot so a missing env var can't pass unnoticed. K_SERVICE is Cloud-Run-set, so
// this fires in prod even when NODE_ENV isn't explicitly 'production'.
if (!process.env.SUPER_ADMIN_EMAIL && (process.env.NODE_ENV === 'production' || process.env.K_SERVICE)) {
  console.warn(JSON.stringify({
    severity: 'WARNING',
    msg: 'SUPER_ADMIN_EMAIL not set — admin routes fall back to a hardcoded email. Set it in the environment.',
    ts: new Date().toISOString(),
  }));
}

module.exports = CONFIG;
