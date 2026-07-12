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
  adminEmail:       process.env.ADMIN_EMAIL || null,

  // General — meet.google.com always allowed (side panel iframe)
  allowedOrigins:  [...new Set([
    'https://meet.google.com',
    ...(process.env.ALLOWED_ORIGINS || 'https://attendancetracker.dev,https://derekgallardo01.github.io').split(','),
  ])],
  allowedDomains:  (process.env.ALLOWED_DOMAINS || '*').split(','),
  port:             process.env.PORT || 8080,
  gcpProjectId:     process.env.GCP_PROJECT_ID || null,

  // Public, absolute URL of this backend's /api mount. Used to build links in
  // emails (e.g. one-click unsubscribe) that must hit the API directly — the
  // marketing site on attendancetracker.dev is static GitHub Pages and does
  // not proxy /api. Overridable via env for staging.
  publicApiUrl:     process.env.PUBLIC_API_URL || 'https://attendance-tracker-backend-829771833968.us-central1.run.app/api',

  // Public marketing/app site (GitHub Pages). Used for Stripe success/cancel
  // redirect URLs.
  publicSiteUrl:    process.env.PUBLIC_SITE_URL || 'https://attendancetracker.dev',
};

module.exports = CONFIG;
