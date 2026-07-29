const crypto = require('crypto');

let Sentry;
// @sentry/node is a hard dependency in this service, so the catch is a
// belt-and-suspenders guard that never fires in practice (unreachable in tests).
/* istanbul ignore next */
try { Sentry = require('@sentry/node'); } catch { Sentry = null; }

// Emails/IPs must not reach Sentry (third party) per our privacy policy. The
// structured console line (first-party Cloud Logging, our own GCP) keeps raw
// values for debugging; only the Sentry extras are scrubbed.
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/g;
function hashPII(s) { return 'sha256:' + crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12); }
function scrubExtras(data) {
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    const key = k.toLowerCase();
    if (v == null || typeof v === 'number' || typeof v === 'boolean') { out[k] = v; continue; }
    if (key === 'ip' || key.includes('email') || key === 'to' || key === 'recipient') {
      out[k] = typeof v === 'string' ? hashPII(v) : v; // hash whole value on PII-named keys
    } else if (typeof v === 'string') {
      out[k] = v.replace(EMAIL_RE, hashPII); // redact any inline email (e.g. in err.message)
    } else {
      out[k] = v;
    }
  }
  return out;
}

function emit(severity, consoleFn, msg, data) {
  const entry = { severity, msg, ...data, ts: new Date().toISOString() };
  consoleFn(JSON.stringify(entry));
  // Send errors to Sentry
  if (severity === 'ERROR' && Sentry) {
    Sentry.withScope(scope => {
      scope.setLevel('error');
      // data is always an object here (the log.* wrappers default it to {}),
      // so the falsy branch is unreachable via the public API.
      /* istanbul ignore else */
      if (data) scope.setExtras(scrubExtras(data));
      Sentry.captureMessage(msg);
    });
  }
}

const log = {
  info:  (msg, data = {}) => emit('INFO',    console.log,   msg, data),
  warn:  (msg, data = {}) => emit('WARNING', console.warn,  msg, data),
  error: (msg, data = {}) => emit('ERROR',   console.error, msg, data),
};

module.exports = log;
