// Single source of truth for the free-tier quota and DISPLAYED prices.
// Stripe price objects are the billing truth and now hold the REAL selling
// prices (LAUNCH50 retired — the discount is baked in so Stripe Adaptive
// Pricing can present local currency to international buyers). `full` is null
// everywhere: there is no strikethrough "was" price anymore.
// Change a price here (and in Stripe) — never in page markup.
module.exports = {
  FREE_MONTHLY_EXPORT_LIMIT: 3,
  PRICES: {
    lifetime:    { label: '$9.99',  full: null, period: 'one-time' },
    educator:    { label: '$4.99',  full: null, period: '/yr' },
    team:        { label: '$19.99', full: null, period: 'one-time' },
    institution: { label: '$149',   full: null, period: '/yr' },
  },
};
