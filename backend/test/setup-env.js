// Test env defaults — set BEFORE any test loads src/ modules so config.js's
// required() helper doesn't process.exit(1) during module load. Real values
// come from .env / secret manager in production; here every required var
// just needs to be defined with something non-empty.
process.env.NODE_ENV = 'test';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.OAUTH_CLIENT_SECRET_NAME = 'test-oauth-secret';
process.env.SESSION_SECRET = 'test-session-secret-do-not-use-in-prod-32bytes-min';
process.env.SECRET_NAME = 'test-service-account-secret';
process.env.ALLOWED_DOMAINS = '*';
process.env.GMAIL_USER = 'derekgallardo01@gmail.com';
process.env.NOTIFY_EMAIL = 'derekgallardo01@gmail.com';
// RESEND_API_KEY deliberately unset — tests that exercise email paths
// either mock Resend or assert the "skipped" branch.
