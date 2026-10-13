// Single source of truth for the free-tier quota and DISPLAYED prices.
// Stripe price objects are the billing truth and now hold the REAL selling
// prices (LAUNCH50 retired — the discount is baked in so Stripe Adaptive
// Pricing can present local currency to international buyers). `full` is null
// everywhere: there is no strikethrough "was" price anymore.
// Change a price here (and in Stripe) — never in page markup.
module.exports = {
  FREE_MONTHLY_EXPORT_LIMIT: 2,
  // Maximum attendees allowed per free export. Classes with >25 attendees represent
  // institutional or large lecture value and require Pro.
  FREE_MAX_PARTICIPANTS_PER_EXPORT: 25,
  // Re-exports of the SAME meeting dedupe against one quota slot (legit:
  // mid-meeting save + end-of-meeting save). This caps how many times a free
  // user can ride that dedupe — beyond it, a constant conferenceId was an
  // unlimited-free-exports exploit. Generous for humans, fatal for scripts.
  FREE_REEXPORTS_PER_MEETING: 10,
  // Free trial of auto-export (a Pro feature). The clock starts on a free user's
  // FIRST auto-export attempt (not the toggle) and grants ~2 weeks of hands-free
  // exports so they feel the value before the paywall — targets the users who
  // toggled auto-export on (explicit Pro intent) but never converted.
  AUTO_EXPORT_TRIAL_DAYS: 14,
  PRICES: {
    single_meeting: { label: '$2.99', full: null, period: 'one-time' },
    lifetime:    { label: '$9.99',  full: null, period: 'one-time' },
    educator:    { label: '$4.99',  full: null, period: '/yr' },
    team:        { label: '$19.99', full: null, period: 'one-time' },
    department:  { label: '$59',    full: null, period: '/yr' },
    institution: { label: '$149',   full: null, period: '/yr' },
  },
  REGIONAL_PRICING: {
    PH: { currency: 'php', amount: 28000, symbol: '₱280', label: '₱280', eduLabel: '₱140/yr' },
    MY: { currency: 'myr', amount: 2200, symbol: 'RM 22', label: 'RM 22', eduLabel: 'RM 12/yr' },
    ID: { currency: 'idr', amount: 7800000, symbol: 'Rp 78.000', label: 'Rp 78.000', eduLabel: 'Rp 39.000/yr' },
    IN: { currency: 'inr', amount: 29900, symbol: '₹299', label: '₹299', eduLabel: '₹199/yr', methods: ['card', 'upi'] },
    MX: { currency: 'mxn', amount: 9900, symbol: '$99 MXN', label: '$99 MXN', eduLabel: '$49 MXN/año', singleMeetingAmount: 2900, singleMeetingLabel: '$29 MXN' },
    BR: { currency: 'brl', amount: 4900, symbol: 'R$ 49', label: 'R$ 49', eduLabel: 'R$ 27/ano', singleMeetingAmount: 1400, singleMeetingLabel: 'R$ 14' },
  },
};

