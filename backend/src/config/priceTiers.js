// Tiered regional pricing — the single source of truth for INDIVIDUAL plan
// prices once TIERED_PRICING=1. Domain plans (Department / Institution) stay
// on their fixed USD Stripe prices.
//
// Model:
//   - Every country is in tier 1 (default), 2 or 3; each tier has USD prices.
//   - Countries whose buyers mostly pay with local rails (UPI, GCash, QRIS,
//     M-Pesa, OXXO, Pix, FPX) get hand-picked local-currency prices and buy
//     annual plans as a PREPAID YEAR (those rails can't auto-renew; renewal
//     reminders bring them back). Monthly isn't offered there.
//   - Everywhere else annual/monthly are real Stripe subscriptions in USD;
//     Stripe Adaptive Pricing shows card buyers their local currency. No
//     coupons are ever attached (a `discounts` param disables Adaptive Pricing).
//   - Tier 3 launches as an experiment: TIER3_TEST=split (default) shows tiered
//     prices to half of tier-3 users (stable per email) and the legacy offer to
//     the rest; 'all' → everyone tiered; 'off' → everyone legacy.
const crypto = require('crypto');

const TIERED_PLANS = ['pro_annual', 'pro_monthly', 'educator', 'lifetime', 'single_meeting'];

const TIER_2 = new Set([
  'MX', 'BR', 'MY', 'TR', 'CO', 'PE', 'AR', 'CL', 'ZA', 'TH', 'EC', 'BO', 'GT', 'PY', 'UY',
  'HN', 'SV', 'NI', 'DO', 'CR', 'PA', 'RO', 'BG', 'RS', 'KZ', 'UA', 'MA', 'TN', 'DZ', 'JO', 'LB',
]);
const TIER_3 = new Set([
  'IN', 'PH', 'ID', 'VN', 'EG', 'NG', 'KE', 'PK', 'BD', 'UG', 'TZ', 'RW', 'ET', 'BI', 'GH', 'LK',
  'NP', 'MM', 'KH', 'LA', 'ZM', 'SO', 'MW', 'MZ', 'ZW', 'SN', 'CM', 'CI', 'AF', 'HT', 'YE', 'SD', 'MN',
]);

// USD cents per tier.
const USD_PRICES = {
  1: { pro_annual: 2900, pro_monthly: 499, educator: 1900, lifetime: 4900, single_meeting: 299 },
  2: { pro_annual: 1500, pro_monthly: 299, educator: 1000, lifetime: 2900, single_meeting: 199 },
  3: { pro_annual: 900, pro_monthly: 199, educator: 500, lifetime: 1200, single_meeting: 149 },
};

// Local-currency markets (minor units). Each ≈ its tier's USD price, rounded
// to a clean local number. All are prepaid-year markets.
const LOCAL_PRICES = {
  IN: { currency: 'inr', methods: ['card', 'upi'], prices: { pro_annual: 49900, educator: 34900, lifetime: 79900, single_meeting: 9900 } },
  PH: { currency: 'php', prices: { pro_annual: 39900, educator: 24900, lifetime: 59900, single_meeting: 9900 } },
  ID: { currency: 'idr', prices: { pro_annual: 9900000, educator: 6900000, lifetime: 14900000, single_meeting: 2900000 } },
  KE: { currency: 'kes', prices: { pro_annual: 79000, educator: 49000, lifetime: 129000, single_meeting: 19500 } },
  MX: { currency: 'mxn', prices: { pro_annual: 27900, educator: 18900, lifetime: 54900, single_meeting: 3900 } },
  BR: { currency: 'brl', prices: { pro_annual: 7900, educator: 5400, lifetime: 15900, single_meeting: 1400 } },
  MY: { currency: 'myr', prices: { pro_annual: 6500, educator: 4500, lifetime: 12900, single_meeting: 1200 } },
};

const CURRENCY_FORMAT = {
  usd: { symbol: '$', sep: ',' },
  inr: { symbol: '₹', sep: ',' },
  php: { symbol: '₱', sep: ',' },
  idr: { symbol: 'Rp ', sep: '.' },
  kes: { symbol: 'KSh ', sep: ',' },
  mxn: { symbol: 'MX$', sep: ',' },
  brl: { symbol: 'R$ ', sep: '.' },
  myr: { symbol: 'RM ', sep: ',' },
};

const PRODUCT_NAMES = {
  pro_annual: 'Attendance Tracker Pro (Annual)',
  pro_monthly: 'Attendance Tracker Pro (Monthly)',
  educator: 'Attendance Tracker Pro (Educator Annual)',
  lifetime: 'Attendance Tracker Pro (Lifetime)',
  single_meeting: 'Attendance Tracker Pro (Single Meeting Pass)',
};

const ANNUAL_PLANS = new Set(['pro_annual', 'educator']);

function tieredPricingEnabled() {
  return process.env.TIERED_PRICING === '1';
}

function normalizeCountry(country) {
  const c = typeof country === 'string' ? country.trim().toUpperCase() : '';
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

function tierFor(country) {
  const c = normalizeCountry(country);
  if (c && TIER_3.has(c)) return 3;
  if (c && TIER_2.has(c)) return 2;
  return 1;
}

// Stable 50/50 experiment arm for tier-3 users. Signed-out visitors (no
// email) get the legacy offer so a later signed-in view can't contradict it,
// unless an explicit arm override is provided (e.g. public offer check with arm=tiered).
function tier3Arm(email, armOverride = null) {
  if (armOverride === 'tiered' || armOverride === 'legacy') return armOverride;
  const mode = process.env.TIER3_TEST || 'all';
  if (mode === 'all') return 'tiered';
  if (mode === 'off' || !email) return 'legacy';
  const byte = crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest()[0];
  return byte % 2 === 0 ? 'tiered' : 'legacy';
}

// "₹749", "Rp 139.000", "$4.99", "$29". Whole amounts drop the decimals.
function formatMoney(amount, currency) {
  const fmt = CURRENCY_FORMAT[currency] || { symbol: `${String(currency || '').toUpperCase()} `, sep: ',' };
  const whole = amount % 100 === 0;
  const major = whole ? String(amount / 100) : (amount / 100).toFixed(2);
  const [int, dec] = major.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, fmt.sep);
  const decSep = fmt.sep === '.' ? ',' : '.';
  return `${fmt.symbol}${grouped}${dec ? decSep + dec : ''}`;
}

function monthlyEquivalent(amount, currency) {
  const cents = Math.round(amount / 12);
  return currency === 'usd' ? cents : Math.round(cents / 100) * 100;
}

// The full individual offer for a buyer. `tiered:false` means the caller must
// use the legacy pricing path (flag off, or a tier-3 legacy-arm user).
function getOffer({ country, email, arm: armOverride } = {}) {
  const c = normalizeCountry(country);
  const tier = tierFor(c);
  const arm = tier === 3 ? tier3Arm(email, armOverride) : 'tiered';
  if (!tieredPricingEnabled() || arm === 'legacy') {
    return { tiered: false, tier, arm: tieredPricingEnabled() ? arm : null, country: c };
  }
  const local = c ? LOCAL_PRICES[c] : null;
  const currency = local ? local.currency : 'usd';
  const prepaid = !!local;
  const source = local ? local.prices : USD_PRICES[tier];
  const prices = {};
  for (const plan of TIERED_PLANS) {
    const amount = source[plan];
    if (amount == null) continue; // e.g. no monthly in prepaid markets
    const period = plan === 'pro_monthly' ? '/mo' : (ANNUAL_PLANS.has(plan) ? '/yr' : 'one-time');
    prices[plan] = {
      amount, currency, label: formatMoney(amount, currency), period, full: null,
      // Annual plans also advertise their monthly equivalent: cents in USD
      // ("$2.42/mo"), whole units elsewhere ("₹62", not "₹62.42").
      ...(ANNUAL_PLANS.has(plan) ? { perMonth: formatMoney(monthlyEquivalent(amount, currency), currency) } : {}),
    };
  }
  return {
    tiered: true,
    tier,
    arm,
    country: c,
    currency,
    prepaid,
    monthlyAvailable: !!prices.pro_monthly,
    methods: local?.methods || null,
    prices,
  };
}

// Stripe line item + session mode for one plan of a tiered offer, or null if
// the offer doesn't sell that plan.
function lineItemFor(offer, plan) {
  const p = offer?.tiered ? offer.prices[plan] : null;
  if (!p) return null;
  const recurring = !offer.prepaid && (ANNUAL_PLANS.has(plan) || plan === 'pro_monthly');
  const productId = process.env.STRIPE_PRO_PRODUCT_ID;
  const price_data = {
    currency: p.currency,
    unit_amount: p.amount,
    ...(productId ? { product: productId } : { product_data: { name: PRODUCT_NAMES[plan] } }),
    ...(recurring ? { recurring: { interval: plan === 'pro_monthly' ? 'month' : 'year' } } : {}),
  };
  return {
    lineItem: { price_data, quantity: 1 },
    mode: recurring ? 'subscription' : 'payment',
    recurring,
    prepaidYear: offer.prepaid && ANNUAL_PLANS.has(plan),
  };
}

module.exports = {
  TIERED_PLANS,
  USD_PRICES,
  LOCAL_PRICES,
  tieredPricingEnabled,
  tierFor,
  tier3Arm,
  formatMoney,
  getOffer,
  lineItemFor,
};
