let Sentry;
// @sentry/node is a hard dependency in this service, so the catch is a
// belt-and-suspenders guard that never fires in practice (unreachable in tests).
/* istanbul ignore next */
try { Sentry = require('@sentry/node'); } catch { Sentry = null; }

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
      if (data) scope.setExtras(data);
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
