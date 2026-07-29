const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Sentry = require('@sentry/node');
const CONFIG = require('../config');
const log = require('../lib/logger');
const { getUser, updateUserTokens } = require('../services/firestore');
const { domainOf } = require('../services/firestore/_core'); // pure util; imported directly so test firestore-mocks needn't stub it
const { refreshAccessToken } = require('../services/googleAuth');

// Kinetic Helix command center: report "online now" from authed requests.
// Throttled per user (~60s) and hashed so no email/PII leaves the service.
// Fire-and-forget; a dropped ping just decays the session sooner.
const KH_PRESENCE_THROTTLE_MS = 60_000;
// Bound the throttle map so a long-lived Cloud Run instance can't accumulate one
// entry per distinct email forever (a slow memory leak). A pruned entry just lets
// that user ping again immediately — harmless.
const KH_PRESENCE_MAX = 5000;
const khPresenceLast = new Map();
function reportPresence(email) {
  const key = process.env.KH_INGEST_KEY;
  if (!key || !email) return;
  const now = Date.now();
  if (now - (khPresenceLast.get(email) || 0) < KH_PRESENCE_THROTTLE_MS) return;
  if (khPresenceLast.size >= KH_PRESENCE_MAX) {
    // Drop entries past the throttle window; if everyone is still fresh, evict
    // oldest-inserted until under the cap. Guarantees a hard bound.
    for (const [e, t] of khPresenceLast) {
      if (now - t >= KH_PRESENCE_THROTTLE_MS) khPresenceLast.delete(e);
    }
    while (khPresenceLast.size >= KH_PRESENCE_MAX) {
      khPresenceLast.delete(khPresenceLast.keys().next().value);
    }
  }
  khPresenceLast.set(email, now);
  const sessionId = crypto.createHash('sha256').update(email).digest('hex').slice(0, 24);
  const url = process.env.KH_INGEST_URL || 'https://kinetichelix.io/api/ingest/presence';
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-KH-Key': key },
    body: JSON.stringify({ slug: 'attendance-tracker', sessionId }),
  }).catch(() => {});
}

// Validates session JWT and attaches req.user with fresh Google access token.
// If no Authorization header, req.user = null (backward compat with service account).
async function auth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(authHeader.slice(7), CONFIG.sessionSecret);
    const domain = decoded.domain || domainOf(decoded.email);
    const user = await getUser(domain, decoded.email);

    let accessToken = null;
    if (user?.refreshToken) {
      // Try to get/refresh access token
      accessToken = user.accessToken || null;
      const expiresAt = user.tokenExpiresAt?.toDate ? user.tokenExpiresAt.toDate() : user.tokenExpiresAt;
      const needsRefresh = !accessToken || !expiresAt || Date.now() > (new Date(expiresAt).getTime() - 5 * 60 * 1000);

      if (needsRefresh) {
        try {
          const credentials = await refreshAccessToken(user.refreshToken);
          accessToken = credentials.access_token;
          const tokenExpiresAt = new Date(credentials.expiry_date || Date.now() + 3600 * 1000);
          await updateUserTokens(domain, decoded.email, { accessToken, tokenExpiresAt });
        } catch (refreshErr) {
          log.warn('token refresh failed, continuing without accessToken', { error: refreshErr.message });
          accessToken = null;
        }
      }
    } else {
      log.info('user not in Firestore or no refreshToken, continuing without accessToken', { email: decoded.email });
    }

    req.user = {
      email: decoded.email,
      domain, // computed above (decoded.domain || domainOf(email)) — must match the getUser lookup
      displayName: decoded.displayName,
      accessToken,
    };

    // Attach user context to Sentry for error tracking
    Sentry.setUser({ email: decoded.email, segment: decoded.domain });

    reportPresence(req.user.email);
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired' });
    }
    log.error('auth middleware error', { error: err.message });
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

// Route guard: reject when the global `auth` middleware didn't attach a user
// (it's optional-auth — sets req.user=null and continues). Collapses the
// per-handler `if (!req.user?.email) return 401` checks. Mirrors the
// requireTeamAdmin / requireSuperAdmin guard pattern.
function requireAuth(req, res, next) {
  if (!req.user?.email) return res.status(401).json({ error: 'Authentication required' });
  next();
}

module.exports = auth;
module.exports.requireAuth = requireAuth;
// Exposed for unit tests (throttle/cap behavior). Not part of the request API.
module.exports.reportPresence = reportPresence;
module.exports._khPresenceLast = khPresenceLast;
