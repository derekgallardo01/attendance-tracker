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
    // full is null everywhere — the strikethrough "was" price was retired with
    // LAUNCH50 (mirrors src/config/pricing.js; these files must stay in sync).
    lifetime:    { label: '$9.99',  full: null, period: 'one-time' },
    educator:    { label: '$4.99',  full: null, period: '/yr' },
    team:        { label: '$19.99', full: null, period: 'one-time' },
    department:  { label: '$59',    full: null, period: '/yr' },
    institution: { label: '$149',   full: null, period: '/yr' },
    quotaLimit: 2,
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

  // Approximate local currency anchor for top non-USD markets.
  // Helps teachers understand local equivalent (e.g. Philippines, India, Brazil).
  const LOCAL_CURRENCY_ESTIMATES = {
    PH: { educator: '~₱280/yr', lifetime: '~₱560', educatorPpp: '~₱140/yr', lifetimePpp: '~₱280', department: '~₱3,300/yr' },
    IN: { educator: '~₹415/yr', lifetime: '~₹830', educatorPpp: '~₹205/yr', lifetimePpp: '~₹415', department: '~₹4,900/yr' },
    ID: { educator: '~Rp 78.000/yr', lifetime: '~Rp 155.000', educatorPpp: '~Rp 39.000/yr', lifetimePpp: '~Rp 78.000', department: '~Rp 920.000/yr' },
    BR: { educator: '~R$ 27/yr', lifetime: '~R$ 55', educatorPpp: '~R$ 14/yr', lifetimePpp: '~R$ 27', department: '~R$ 325/yr' },
    MX: { educator: '~MX$ 95/yr', lifetime: '~MX$ 190', educatorPpp: '~MX$ 48/yr', lifetimePpp: '~MX$ 95', department: '~MX$ 1,150/yr' },
    CO: { educator: '~COP 20.000/yr', lifetime: '~COP 40.000', educatorPpp: '~COP 10.000/yr', lifetimePpp: '~COP 20.000', department: '~COP 240.000/yr' },
    MY: { educator: '~RM 22/yr', lifetime: '~RM 44', educatorPpp: '~RM 11/yr', lifetimePpp: '~RM 22', department: '~RM 260/yr' },
    ES: { educator: '~4,50 €/yr', lifetime: '~8,99 €', educatorPpp: '~2,25 €/yr', lifetimePpp: '~4,50 €', department: '~53 €/yr' },
    DE: { educator: '~4,50 €/yr', lifetime: '~8,99 €', educatorPpp: '~2,25 €/yr', lifetimePpp: '~4,50 €', department: '~53 €/yr' },
    FR: { educator: '~4,50 €/yr', lifetime: '~8,99 €', educatorPpp: '~2,25 €/yr', lifetimePpp: '~4,50 €', department: '~53 €/yr' },
    IT: { educator: '~4,50 €/yr', lifetime: '~8,99 €', educatorPpp: '~2,25 €/yr', lifetimePpp: '~4,50 €', department: '~53 €/yr' },
    NL: { educator: '~4,50 €/yr', lifetime: '~8,99 €', educatorPpp: '~2,25 €/yr', lifetimePpp: '~4,50 €', department: '~53 €/yr' },
    PT: { educator: '~4,50 €/yr', lifetime: '~8,99 €', educatorPpp: '~2,25 €/yr', lifetimePpp: '~4,50 €', department: '~53 €/yr' },
    IE: { educator: '~4,50 €/yr', lifetime: '~8,99 €', educatorPpp: '~2,25 €/yr', lifetimePpp: '~4,50 €', department: '~53 €/yr' },
    GB: { educator: '~£3.95/yr', lifetime: '~£7.90', educatorPpp: '~£1.95/yr', lifetimePpp: '~£3.95', department: '~£47/yr' },
    IL: { educator: '~₪18.50/yr', lifetime: '~₪37', educatorPpp: '~₪9.25/yr', lifetimePpp: '~₪18.50', department: '~₪220/yr' },
    KZ: { educator: '~2,500 ₸/yr', lifetime: '~5,000 ₸', educatorPpp: '~1,250 ₸/yr', lifetimePpp: '~2,500 ₸', department: '~29,500 ₸/yr' },
  };

  function localCurrencyAnchor(countryCode, plan) {
    if (!countryCode || typeof countryCode !== 'string') return '';
    const upper = countryCode.toUpperCase().trim();
    const rates = LOCAL_CURRENCY_ESTIMATES[upper];
    if (!rates) return '';
    return rates[plan] || '';
  }

  const api = { DEFAULTS, LOCAL_CURRENCY_ESTIMATES, fromStatus, price, quotaLimit, localCurrencyAnchor, _reset: function () { current = DEFAULTS; } };
  root.AttPricing = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
