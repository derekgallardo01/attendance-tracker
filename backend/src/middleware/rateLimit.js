const rateLimit = require('express-rate-limit');

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 60,               // 60 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  // Disable rate limits in the test environment so suites can blast through
  // dozens of requests without hitting the production-tuned cap.
  skip: () => process.env.NODE_ENV === 'test',
});

module.exports = apiLimiter;
