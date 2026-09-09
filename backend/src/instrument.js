const Sentry = require('@sentry/node');

// sendDefaultPii:false suppresses cookies/headers/body/IP — it does NOT strip
// the request URL or query string. Several public routes carry bearer-grade
// material right in the URL: /public/share/<token> (a credential to a whole
// series roster), /public/unsubscribe?e=<email>&t=<HMAC>, and
// /public/verify/<code>. Scrub those from every event and transaction —
// with tracesSampleRate 0.1, 10% of ALL traffic ships a URL otherwise.
const SENSITIVE_PATH = /(\/public\/(share|verify|unsubscribe))[/?][^\s"']*/g;
function scrubUrlish(s) {
  return typeof s === 'string' ? s.replace(SENSITIVE_PATH, '$1/[redacted]') : s;
}
function scrubEvent(event) {
  try {
    if (event.request) {
      event.request.url = scrubUrlish(event.request.url);
      if (event.request.query_string) delete event.request.query_string;
    }
    if (event.transaction) event.transaction = scrubUrlish(event.transaction);
    if (event.extra) {
      for (const k of Object.keys(event.extra)) event.extra[k] = scrubUrlish(event.extra[k]);
    }
  } catch { /* never block delivery over scrubbing */ }
  return event;
}

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
  beforeSend: scrubEvent,
  beforeSendTransaction: scrubEvent,
});

console.log('[Sentry] initialized');
