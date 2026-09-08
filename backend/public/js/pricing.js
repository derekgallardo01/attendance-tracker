// Display-price constants shared by every page — the frontend half of the
// single source of truth (backend: src/config/pricing.js, surfaced via
// /billing/status.pricing). Pages render from these instead of hardcoding
// "$9.99" in markup; once /billing/status has been fetched, fromStatus()
// lets the server-advertised prices win over this static fallback.
//
// Exposed as `window.AttPricing` (browser) and `module.exports` (Jest).
(function (root) {
  'use strict';

  const DEFAULTS = {
    lifetime:    { label: '$9.99',  full: '$19.99', period: 'one-time' },
    educator:    { label: '$4.99',  full: '$9.99',  period: '/yr' },
    team:        { label: '$19.99', full: null,      period: 'one-time' },
    institution: { label: '$149',   full: null,      period: '/yr' },
    quotaLimit: 3,
  };

  let current = DEFAULTS;

  // Merge the /billing/status payload's `pricing` object (if present) over
  // the defaults. Safe to call with anything — a missing payload keeps the
  // static fallback. Returns the active pricing table.
  function fromStatus(status) {
    if (status && status.pricing) current = { ...DEFAULTS, ...status.pricing };
    return current;
  }

  // "$9.99" for a known plan, '' for an unknown one (render-safe).
  function price(plan) {
    return (current[plan] && current[plan].label) || '';
  }

  // The free tier's monthly Sheets-export allowance.
  function quotaLimit() {
    return current.quotaLimit || DEFAULTS.quotaLimit;
  }

  const api = { DEFAULTS, fromStatus, price, quotaLimit, _reset: function () { current = DEFAULTS; } };
  root.AttPricing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
