const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 60,               // 60 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  // OPTIONS preflights don't count: every authed request is non-simple (the
  // Authorization header), so counting preflights silently halved the real
  // budget for live-meeting polling — the exact bug the single-mount comment
  // in app.js fixed once already, reintroduced through CORS.
  // Test env skips entirely so suites can blast through requests.
  skip: (req) => process.env.NODE_ENV === 'test' || req.method === 'OPTIONS',
});

module.exports = apiLimiter;
