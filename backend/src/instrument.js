const Sentry = require('@sentry/node');

Sentry.init({
  dsn: 'https://ca6640c2e0299ad6aa313f210faae19f@o4510162222448640.ingest.us.sentry.io/4511049298280448',
  // Do NOT auto-attach request PII (IP, cookies, headers, body). Our privacy
  // policy says we don't ship user PII to third parties; the logger additionally
  // scrubs/hashes email+IP from error extras, and auth attaches only a hashed
  // user id to Sentry — so no raw email/IP reaches Sentry.
  sendDefaultPii: false,
  environment: process.env.NODE_ENV || 'production',
  tracesSampleRate: 0.1,
  debug: false,
});

console.log('[Sentry] initialized');
