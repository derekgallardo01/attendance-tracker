// Single source of truth for the free-tier quota and DISPLAYED prices.
// Stripe price objects are the billing truth (and are FULL price — the
// LAUNCH50 promo applies the discount at checkout), so these constants are
// the *display* truth: what buttons, toasts, and /billing/status advertise.
// Change a price here (and in Stripe) — never in page markup.
module.exports = {
  FREE_MONTHLY_EXPORT_LIMIT: 3,
  PRICES: {
    lifetime:    { label: '$9.99',  full: '$19.99', period: 'one-time' },
    educator:    { label: '$4.99',  full: '$9.99',  period: '/yr' },
    team:        { label: '$19.99', full: null,      period: 'one-time' },
    institution: { label: '$149',   full: null,      period: '/yr' },
  },
};
