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
  1: { pro_annual: 2900, pro_monthly: 399, educator: 1499, lifetime: 2900, single_meeting: 399 },
  2: { pro_annual: 1500, pro_monthly: 199, educator: 799, lifetime: 1900, single_meeting: 299 },
  3: { pro_annual: 900, pro_monthly: 99, educator: 399, lifetime: 799, single_meeting: 199 },
};

// Local-currency markets (minor units). Each ≈ its tier's USD price, rounded
// to a clean local number. India (IN) keeps annual plans as prepaid-year due
// to RBI e-mandate friction on recurring UPI/cards; pro_monthly is always a
// true Stripe subscription across all tiers and markets.
const LOCAL_PRICES = {
  IN: { currency: 'inr', prepaid: true, methods: ['card', 'upi'], prices: { pro_annual: 49900, pro_monthly: 5900, educator: 24900, lifetime: 49900, single_meeting: 12900 } },
  PH: { currency: 'php', prices: { pro_annual: 39900, pro_monthly: 4900, educator: 19900, lifetime: 39900, single_meeting: 9900 } },
  ID: { currency: 'idr', prices: { pro_annual: 9900000, pro_monthly: 1490000, educator: 4900000, lifetime: 9900000, single_meeting: 2500000 } },
  KE: { currency: 'kes', prices: { pro_annual: 79000, pro_monthly: 9900, educator: 39000, lifetime: 79000, single_meeting: 19500 } },
  MX: { currency: 'mxn', prices: { pro_annual: 27900, pro_monthly: 3900, educator: 14900, lifetime: 29900, single_meeting: 5900 } },
  BR: { currency: 'brl', prices: { pro_annual: 7900, pro_monthly: 990, educator: 3900, lifetime: 7900, single_meeting: 1900 } },
  MY: { currency: 'myr', prices: { pro_annual: 6500, pro_monthly: 900, educator: 3500, lifetime: 7900, single_meeting: 1500 } },
};

// High-anchor Lifetime prices for the `recurring_first` experiment arm (~3.3x
// Educator Annual), positioning Educator Annual + Monthly Recurring as the
// primary choices while preserving Lifetime as a premium anchor.
const LIFETIME_ANCHOR_USD = {
  1: 4900,
  2: 2900,
  3: 1900,
};

const LIFETIME_ANCHOR_LOCAL = {
  IN: 99900,
  PH: 79900,
  ID: 19900000,
  KE: 159000,
  MX: 54900,
  BR: 14900,
  MY: 12900,
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
const PRICING_EXP_ARMS = new Set(['recurring_first', 'three_option_control']);

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

// Deterministic 50/50 pricing experiment arm (`recurring_first` vs
// `three_option_control`) across all tiers when TIERED_PRICING=1.
// Controlled by PRICING_EXP ('split' default, or 'recurring_first' / 'three_option_control').
function pricingExpArm(email, expArmOverride = null) {
  if (PRICING_EXP_ARMS.has(expArmOverride)) return expArmOverride;
  if (PRICING_EXP_ARMS.has(process.env.PRICING_EXP)) return process.env.PRICING_EXP;
  const e = email ? String(email).trim().toLowerCase() : '';
  if (!e) return 'three_option_control';
  const byte = crypto.createHash('sha256').update('pricing_exp_v1:' + e).digest()[0];
  return byte % 2 === 0 ? 'recurring_first' : 'three_option_control';
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
function getOffer({ country, email, arm: armOverride, expArm: expArmOverride } = {}) {
  const c = normalizeCountry(country);
  const tier = tierFor(c);
  const arm = tier === 3 ? tier3Arm(email, armOverride) : 'tiered';
  if (!tieredPricingEnabled() || arm === 'legacy') {
    return { tiered: false, tier, arm: tieredPricingEnabled() ? arm : null, country: c };
  }
  const expArm = pricingExpArm(email, expArmOverride);
  const local = c ? LOCAL_PRICES[c] : null;
  const currency = local ? local.currency : 'usd';
  const prepaid = Boolean(local && local.prepaid);
  const source = local ? local.prices : USD_PRICES[tier];
  const prices = {};
  for (const plan of TIERED_PLANS) {
    const amount = (plan === 'lifetime' && expArm === 'recurring_first')
      ? (local ? LIFETIME_ANCHOR_LOCAL[c] : LIFETIME_ANCHOR_USD[tier])
      : source[plan];
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
    expArm,
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
  const recurring = plan === 'pro_monthly' || (!offer.prepaid && ANNUAL_PLANS.has(plan));
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
  LIFETIME_ANCHOR_USD,
  LIFETIME_ANCHOR_LOCAL,
  tieredPricingEnabled,
  tierFor,
  tier3Arm,
  pricingExpArm,
  formatMoney,
  getOffer,
  lineItemFor,
};
