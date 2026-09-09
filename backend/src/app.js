const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Sentry = require('@sentry/node');
const CONFIG = require('./config');
const log = require('./lib/logger');
const auth = require('./middleware/auth');
const apiLimiter = require('./middleware/rateLimit');
const requestId = require('./middleware/requestId');
const attendanceRoutes = require('./routes/attendance');
const sheetsRoutes = require('./routes/sheets');
const calendarRoutes = require('./routes/calendar');
const oauthRoutes = require('./routes/oauth');
const adminRoutes = require('./routes/admin');
const publicRoutes = require('./routes/public');
const historyRoutes = require('./routes/history');
const pdfRoutes = require('./routes/pdf');
const teamRoutes = require('./routes/team');
const settingsRoutes = require('./routes/settings');
const classroomRoutes = require('./routes/classroom');
const checkinRoutes = require('./routes/checkin');
const { router: billingRoutes, webhookHandler: billingWebhookHandler } = require('./routes/billing');

const app = express();
app.set('trust proxy', 1); // Cloud Run runs behind a load balancer

// Security headers — allow framing from meet.google.com (side panel iframe)
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://accounts.google.com", "https://apis.google.com", "https://www.gstatic.com", "https://browser.sentry-cdn.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      imgSrc: ["'self'", "data:", "https://*.googleusercontent.com"],
      // youtube-nocookie: the demo-video embeds on index.html + ~18 SEO pages
      // (silently refused before — console-only error the e2e suite can't see
      // because it tests the Pages origin, which serves no CSP).
      frameSrc: ["https://accounts.google.com", "https://www.youtube-nocookie.com"],
      frameAncestors: ["https://meet.google.com", "'self'"],
      connectSrc: ["'self'", "https://accounts.google.com", "https://*.ingest.us.sentry.io"],
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // needed for GIS popup
}));

// Stripe webhook MUST see the raw request body to verify the signature, so it
// is mounted BEFORE express.json() with its own raw parser. Everything else
// uses JSON parsing below.
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingWebhookHandler);

// CORS BEFORE the body parser: a malformed/oversized JSON body throws inside
// express.json(), and with cors() mounted after it the 400/413 carried no
// Access-Control-Allow-Origin — cross-origin callers saw an opaque CORS
// failure instead of the clean JSON error. maxAge lets browsers cache the
// preflight (authed requests are non-simple, so every poll preflighted and
// double-counted against the rate limiter without it).
// credentials:true is required because navigator.sendBeacon (used by the
// landing-page pageview beacon) auto-includes cookies for cross-origin
// requests. Without this header on the preflight response the browser
// drops the beacon silently and we lose visit telemetry. Origin is still
// restricted to the allowedOrigins whitelist so nothing's been opened up.
app.use(cors({ origin: CONFIG.allowedOrigins, credentials: true, maxAge: 600 }));

app.use(express.json({ limit: '100kb' }));

// Request correlation IDs
app.use(requestId);

// OAuth routes — no auth middleware, own rate limit (10 req/min)
const oauthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many auth requests, please try again later.' },
  skip: () => process.env.NODE_ENV === 'test',
});
app.use('/api/oauth', oauthLimiter, oauthRoutes);

// Rate limit EVERYTHING under /api exactly once — mounting the same limiter
// instance twice (once with publicRoutes, once bare) double-counted every
// request, silently halving the real budget to 30/min: live-meeting polling
// (attendance + checkins) hit 429s at normal load.
app.use('/api', apiLimiter);

// Public routes — no auth. Mounted before the auth middleware so anonymous
// traffic works.
app.use('/api', publicRoutes);

// Auth on all other /api routes
app.use('/api', auth);

// API routes
app.use('/api', attendanceRoutes);
app.use('/api', sheetsRoutes);
app.use('/api', calendarRoutes);
app.use('/api', adminRoutes);
app.use('/api', historyRoutes);
app.use('/api', pdfRoutes);
app.use('/api', teamRoutes);
app.use('/api', settingsRoutes);
app.use('/api', classroomRoutes);
app.use('/api', checkinRoutes);
app.use('/api', billingRoutes); // checkout / portal / status (webhook mounted above)

// Serve frontend from public/
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// 404 fallbacks. API paths get JSON (previously a POST to a mistyped /api
// route fell through to Express's HTML finalhandler — "Cannot POST /api/…" —
// and a GET got the full marketing 404 page); browser navigation keeps the
// styled 404 page.
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found.' });
  }
  if (req.method === 'GET' && req.accepts('html')) {
    return res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));
  }
  next();
});

// Sentry error handler — must be after all routes
Sentry.setupExpressErrorHandler(app);

// Final error handler — normalize errors to JSON and NEVER leak stack traces or
// internal file paths. Express's built-in handler dumps the full stack (with
// /app/node_modules/... paths) unless NODE_ENV==='production', so a malformed
// JSON body from an anonymous caller could expose the dependency tree. This
// runs after Sentry has captured the error.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  // Malformed JSON body (body-parser) → clean 400, not a stack trace.
  if (status === 400 && (err.type === 'entity.parse.failed' || err instanceof SyntaxError)) {
    return res.status(400).json({ error: 'Invalid JSON body.' });
  }
  if (status === 413 || err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Request body too large.' });
  }
  // req.path can carry bearer-grade segments (share tokens, verify codes) —
  // log only the route shape, not the values.
  const safePath = req.path.replace(/(\/public\/(share|verify|unsubscribe))\/.+/, '$1/[redacted]');
  log.error('unhandled request error', { path: safePath, status, error: err.message });
  return res.status(status >= 400 && status < 600 ? status : 500).json({ error: 'Internal server error.' });
});

module.exports = app;
