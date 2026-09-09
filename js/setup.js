// Pure, dependency-free helpers for the domain-wide-delegation setup wizard
// (setup.html), extracted from that page's inline <script> so the domain-parse
// and result-banner mapping can be unit-tested. DOM lookups, clipboard, and
// fetch orchestration stay inline in setup.html.
//
// Exposed as both `window.AttSetup` (browser) and `module.exports` (Jest),
// mirroring js/utils.js.

(function (root) {
  'use strict';

  // Translate via the global t() (present once js/strings.js is loaded in the
  // browser); fall back to the English literal when it isn't (Node/Jest).
  function tr(key, fallback) {
    return (typeof root.t === 'function') ? root.t(key, fallback) : fallback;
  }

  // Domain part of the admin's email, used for the verify-delegation call.
  // Returns '' when the input isn't a single-@ address so the caller can bail
  // before hitting the (rate-limited, domain-bound) endpoint.
  function parseDomain(email) {
    const parts = String(email || '').trim().split('@');
    return parts.length === 2 && parts[1] ? parts[1] : '';
  }

  // Map the verify-delegation API response to the result banner's state.
  // success → green "setup complete"; otherwise red with the server's error
  // (or a generic fallback when the response carries none).
  function verifyResult(data) {
    if (data && data.success) {
      return {
        className: 'result success',
        message: tr('setup.complete', 'Setup complete! Domain-wide delegation is working. You can now open Google Meet and start tracking attendance.'),
      };
    }
    return {
      className: 'result error',
      message: (data && data.error) || tr('setup.notConfigured', 'Delegation not configured correctly. Please check the steps above and try again.'),
    };
  }

  // Banner state when the request itself fails (network error / no JSON).
  function verifyNetworkError() {
    return { className: 'result error', message: tr('setup.serverError', 'Could not reach the server. Please try again.') };
  }

  const api = { parseDomain, verifyResult, verifyNetworkError };
  root.AttSetup = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
