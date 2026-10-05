const crypto = require('crypto');
let Sentry;
/* istanbul ignore next */
try { Sentry = require('@sentry/node'); } catch { Sentry = null; }

function requestId(req, _res, next) {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  _res.setHeader('X-Request-Id', req.id);
  if (req.id && Sentry && typeof Sentry.getIsolationScope === 'function') {
    try {
      const scope = Sentry.getIsolationScope();
      if (scope && typeof scope.setTag === 'function') {
        scope.setTag('request_id', req.id);
      }
    } catch (_) {}
  }
  next();
}

module.exports = requestId;

