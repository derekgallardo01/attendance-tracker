// Tiered regional pricing: country → tier, local-currency prepaid markets vs
// USD subscription markets, the tier-3 experiment split, and money formatting.

const tiers = require('../../src/config/priceTiers');

const ENV_KEYS = ['TIERED_PRICING', 'TIER3_TEST', 'PRICING_EXP', 'STRIPE_PRO_PRODUCT_ID'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  process.env.TIERED_PRICING = '1';
  delete process.env.TIER3_TEST;
  delete process.env.PRICING_EXP;
  delete process.env.STRIPE_PRO_PRODUCT_ID;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

// An email that lands in each tier-3 arm (sha256 first byte parity).
const crypto = require('crypto');
const emailInArm = (want) => {
  for (let i = 0; i < 100; i++) {
    const e = `t${i}@x.com`;
    const even = crypto.createHash('sha256').update(e).digest()[0] % 2 === 0;
    if ((want === 'tiered') === even) return e;
  }
  throw new Error('unreachable');
};

// An email that lands in each pricing experiment arm (sha256('pricing_exp_v1:' + email)).
const emailInExpArm = (want) => {
  for (let i = 0; i < 100; i++) {
    const e = `exp${i}@school.edu`;
    const even = crypto.createHash('sha256').update('pricing_exp_v1:' + e).digest()[0] % 2 === 0;
    if ((want === 'recurring_first') === even) return e;
  }
  throw new Error('unreachable');
};

describe('tierFor', () => {
  test('tier 3, tier 2, default tier 1, and junk input', () => {
    expect(tiers.tierFor('in')).toBe(3);
    expect(tiers.tierFor(' MX ')).toBe(2);
    expect(tiers.tierFor('US')).toBe(1);
    expect(tiers.tierFor('DE')).toBe(1);
    expect(tiers.tierFor(null)).toBe(1);
    expect(tiers.tierFor('USA')).toBe(1);
    expect(tiers.tierFor(42)).toBe(1);
  });
});

describe('tier3Arm', () => {
  test('defaults to all (tiered) when TIER3_TEST is unset; split is stable per email and covers both arms', () => {
    const a = emailInArm('tiered');
    const b = emailInArm('legacy');
    expect(tiers.tier3Arm(a)).toBe('tiered');
    expect(tiers.tier3Arm(b)).toBe('tiered');
    expect(tiers.tier3Arm(null)).toBe('tiered');
    process.env.TIER3_TEST = 'split';
    expect(tiers.tier3Arm(a)).toBe('tiered');
    expect(tiers.tier3Arm(` ${a.toUpperCase()} `)).toBe('tiered'); // normalized
    expect(tiers.tier3Arm(b)).toBe('legacy');
  });
  test('no email → legacy in split mode; all / off overrides; armOverride wins', () => {
    expect(tiers.tier3Arm(null, 'tiered')).toBe('tiered');
    expect(tiers.tier3Arm(emailInArm('tiered'), 'legacy')).toBe('legacy');
    process.env.TIER3_TEST = 'split';
    expect(tiers.tier3Arm(null)).toBe('legacy');
    process.env.TIER3_TEST = 'all';
    expect(tiers.tier3Arm(null)).toBe('tiered');
    process.env.TIER3_TEST = 'off';
    expect(tiers.tier3Arm(emailInArm('tiered'))).toBe('legacy');
  });
});

describe('pricingExpArm', () => {
  test('defaults to 50/50 split by sha256(pricing_exp_v1:email), falls back to three_option_control when signed out', () => {
    const rf = emailInExpArm('recurring_first');
    const ctrl = emailInExpArm('three_option_control');
    expect(tiers.pricingExpArm(rf)).toBe('recurring_first');
    expect(tiers.pricingExpArm(` ${rf.toUpperCase()} `)).toBe('recurring_first');
    expect(tiers.pricingExpArm(ctrl)).toBe('three_option_control');
    expect(tiers.pricingExpArm(null)).toBe('three_option_control');
    expect(tiers.pricingExpArm('   ')).toBe('three_option_control');
  });
  test('respects expArmOverride and PRICING_EXP env var', () => {
    const rf = emailInExpArm('recurring_first');
    const ctrl = emailInExpArm('three_option_control');
    expect(tiers.pricingExpArm(rf, 'three_option_control')).toBe('three_option_control');
    expect(tiers.pricingExpArm(ctrl, 'recurring_first')).toBe('recurring_first');
    expect(tiers.pricingExpArm(ctrl, 'invalid_arm')).toBe('three_option_control');
    process.env.PRICING_EXP = 'recurring_first';
    expect(tiers.pricingExpArm(ctrl)).toBe('recurring_first');
    expect(tiers.pricingExpArm(null)).toBe('recurring_first');
    process.env.PRICING_EXP = 'three_option_control';
    expect(tiers.pricingExpArm(rf)).toBe('three_option_control');
  });
});

describe('formatMoney', () => {
  test('symbols, grouping, decimals', () => {
    expect(tiers.formatMoney(2900, 'usd')).toBe('$29');
    expect(tiers.formatMoney(499, 'usd')).toBe('$4.99');
    expect(tiers.formatMoney(159900, 'inr')).toBe('₹1,599');
    expect(tiers.formatMoney(13900000, 'idr')).toBe('Rp 139.000');
    expect(tiers.formatMoney(7950, 'brl')).toBe('R$ 79,50');
    expect(tiers.formatMoney(12345, 'eur')).toBe('EUR 123.45');
    expect(tiers.formatMoney(100, undefined)).toBe(' 1');
  });
});

describe('getOffer', () => {
  test('flag off → never tiered (arm null)', () => {
    delete process.env.TIERED_PRICING;
    expect(tiers.getOffer({ country: 'US', email: 'a@b.com' })).toEqual({ tiered: false, tier: 1, arm: null, country: 'US' });
  });

  test('tier 1 USD subscription market with monthly in both experiment arms', () => {
    const ctrl = tiers.getOffer({ country: 'US', email: emailInExpArm('three_option_control') });
    expect(ctrl).toMatchObject({
      tiered: true, tier: 1, arm: 'tiered', expArm: 'three_option_control',
      currency: 'usd', prepaid: false, monthlyAvailable: true, methods: null,
    });
    expect(ctrl.prices.pro_annual).toEqual({ amount: 2900, currency: 'usd', label: '$29', period: '/yr', full: null, perMonth: '$2.42' });
    expect(ctrl.prices.pro_monthly).toEqual({ amount: 399, currency: 'usd', label: '$3.99', period: '/mo', full: null });
    expect(ctrl.prices.lifetime).toEqual({ amount: 2900, currency: 'usd', label: '$29', period: 'one-time', full: null });
    expect(ctrl.prices.educator.label).toBe('$14.99');

    const rf = tiers.getOffer({ country: 'US', email: emailInExpArm('recurring_first') });
    expect(rf.expArm).toBe('recurring_first');
    expect(rf.prices.lifetime).toEqual({ amount: 4900, currency: 'usd', label: '$49', period: 'one-time', full: null });
    expect(rf.prices.educator.label).toBe('$14.99');
    expect(rf.prices.pro_monthly.label).toBe('$3.99');
  });

  test('missing country defaults to tier 1', () => {
    expect(tiers.getOffer()).toMatchObject({ tiered: true, tier: 1, country: null, expArm: 'three_option_control' });
  });

  test('local-currency markets (MX, BR, MY): recurring subscriptions + monthly available', () => {
    const mx = tiers.getOffer({ country: 'MX', expArm: 'three_option_control' });
    expect(mx).toMatchObject({ tiered: true, tier: 2, currency: 'mxn', prepaid: false, monthlyAvailable: true });
    expect(mx.prices.pro_monthly.label).toBe('MX$39');
    expect(mx.prices.pro_annual.label).toBe('MX$279');
    expect(mx.prices.pro_annual.perMonth).toBe('MX$23'); // whole units outside USD
    expect(mx.prices.lifetime.label).toBe('MX$299');
    expect(tiers.getOffer({ country: 'MX', expArm: 'recurring_first' }).prices.lifetime.label).toBe('MX$549');

    const br = tiers.getOffer({ country: 'BR', expArm: 'recurring_first' });
    expect(br).toMatchObject({ tiered: true, tier: 2, currency: 'brl', prepaid: false, monthlyAvailable: true });
    expect(br.prices.pro_monthly.label).toBe('R$ 9,90');
    expect(br.prices.educator.label).toBe('R$ 39');
    expect(br.prices.lifetime.label).toBe('R$ 149');

    const my = tiers.getOffer({ country: 'MY', expArm: 'recurring_first' });
    expect(my.prices.pro_monthly.label).toBe('RM 9');
    expect(my.prices.lifetime.label).toBe('RM 129');

    process.env.TIER3_TEST = 'all';
    expect(tiers.getOffer({ country: 'ID', email: 'a@b.com' }).prices.pro_annual.perMonth).toBe('Rp 8.250');
  });

  test('tier 3: legacy arm falls back in split mode; IN stays prepaid for annual while offering monthly subscription; PH/ID/KE are recurring', () => {
    expect(tiers.getOffer({ country: 'IN', email: emailInArm('legacy') })).toMatchObject({ tiered: true, tier: 3, arm: 'tiered' });
    process.env.TIER3_TEST = 'split';
    expect(tiers.getOffer({ country: 'IN', email: emailInArm('legacy') })).toMatchObject({ tiered: false, tier: 3, arm: 'legacy' });
    const o = tiers.getOffer({ country: 'IN', email: emailInArm('tiered'), expArm: 'three_option_control' });
    expect(o).toMatchObject({ tiered: true, tier: 3, arm: 'tiered', expArm: 'three_option_control', currency: 'inr', prepaid: true, monthlyAvailable: true, methods: ['card', 'upi'] });
    expect(o.prices.educator.label).toBe('₹249');
    expect(o.prices.pro_annual.label).toBe('₹499');
    expect(o.prices.pro_monthly.label).toBe('₹59');
    expect(o.prices.lifetime.label).toBe('₹499');
    expect(o.prices.single_meeting.label).toBe('₹129');
    expect(tiers.getOffer({ country: 'IN', arm: 'tiered', expArm: 'recurring_first' }).prices.lifetime.label).toBe('₹999');

    // PH
    const ph = tiers.getOffer({ country: 'PH', arm: 'tiered', expArm: 'three_option_control' });
    expect(ph).toMatchObject({ prepaid: false, monthlyAvailable: true });
    expect(ph.prices.educator.label).toBe('₱199');
    expect(ph.prices.pro_annual.label).toBe('₱399');
    expect(ph.prices.pro_monthly.label).toBe('₱49');
    expect(ph.prices.lifetime.label).toBe('₱399');
    expect(tiers.getOffer({ country: 'PH', arm: 'tiered', expArm: 'recurring_first' }).prices.lifetime.label).toBe('₱799');

    // ID
    const id = tiers.getOffer({ country: 'ID', arm: 'tiered', expArm: 'three_option_control' });
    expect(id).toMatchObject({ prepaid: false, monthlyAvailable: true });
    expect(id.prices.educator.label).toBe('Rp 49.000');
    expect(id.prices.pro_annual.label).toBe('Rp 99.000');
    expect(id.prices.pro_monthly.label).toBe('Rp 14.900');
    expect(id.prices.lifetime.label).toBe('Rp 99.000');
    expect(tiers.getOffer({ country: 'ID', arm: 'tiered', expArm: 'recurring_first' }).prices.lifetime.label).toBe('Rp 199.000');

    // KE
    const ke = tiers.getOffer({ country: 'KE', arm: 'tiered', expArm: 'three_option_control' });
    expect(ke).toMatchObject({ prepaid: false, monthlyAvailable: true });
    expect(ke.prices.educator.label).toBe('KSh 390');
    expect(ke.prices.pro_annual.label).toBe('KSh 790');
    expect(ke.prices.pro_monthly.label).toBe('KSh 99');
    expect(ke.prices.lifetime.label).toBe('KSh 790');
    expect(tiers.getOffer({ country: 'KE', arm: 'tiered', expArm: 'recurring_first' }).prices.lifetime.label).toBe('KSh 1,590');
  });

  test('tier 2 and tier 3 USD markets sell subscriptions with recalibrated monthly and experiment lifetime anchor', () => {
    const co = tiers.getOffer({ country: 'CO', expArm: 'recurring_first' });
    expect(co.prices.pro_monthly.label).toBe('$1.99');
    expect(co.prices.educator.label).toBe('$7.99');
    expect(co.prices.lifetime.label).toBe('$29');

    const o = tiers.getOffer({ country: 'VN', email: emailInArm('tiered'), expArm: 'three_option_control' });
    expect(o).toMatchObject({ tiered: true, currency: 'usd', prepaid: false, monthlyAvailable: true });
    expect(o.prices.pro_annual.label).toBe('$9');
    expect(o.prices.pro_monthly.label).toBe('$0.99');
    expect(o.prices.educator.label).toBe('$3.99');
    expect(o.prices.lifetime.label).toBe('$7.99');
    expect(o.prices.single_meeting.label).toBe('$1.99');
    expect(tiers.getOffer({ country: 'VN', arm: 'tiered', expArm: 'recurring_first' }).prices.lifetime.label).toBe('$19');
  });
});

describe('lineItemFor', () => {
  test('subscription annual / monthly in USD and card-capable local markets', () => {
    const o = tiers.getOffer({ country: 'US', expArm: 'three_option_control' });
    const annual = tiers.lineItemFor(o, 'pro_annual');
    expect(annual).toEqual({
      lineItem: { price_data: { currency: 'usd', unit_amount: 2900, product_data: { name: 'Attendance Tracker Pro (Annual)' }, recurring: { interval: 'year' } }, quantity: 1 },
      mode: 'subscription', recurring: true, prepaidYear: false,
    });
    expect(tiers.lineItemFor(o, 'pro_monthly').lineItem.price_data.recurring).toEqual({ interval: 'month' });
    expect(tiers.lineItemFor(o, 'educator').recurring).toBe(true);

    const br = tiers.getOffer({ country: 'BR', expArm: 'recurring_first' });
    expect(tiers.lineItemFor(br, 'educator')).toMatchObject({ mode: 'subscription', recurring: true, prepaidYear: false });
    expect(tiers.lineItemFor(br, 'pro_monthly')).toMatchObject({ mode: 'subscription', recurring: true, prepaidYear: false });
    expect(tiers.lineItemFor(br, 'lifetime').lineItem.price_data.unit_amount).toBe(14900);
  });

  test('one-time lifetime / meeting pass; configured product id wins', () => {
    process.env.STRIPE_PRO_PRODUCT_ID = 'prod_123';
    const o = tiers.getOffer({ country: 'US', expArm: 'three_option_control' });
    const life = tiers.lineItemFor(o, 'lifetime');
    expect(life).toMatchObject({ mode: 'payment', recurring: false, prepaidYear: false });
    expect(life.lineItem.price_data).toEqual({ currency: 'usd', unit_amount: 2900, product: 'prod_123' });
  });

  test('prepaid annual in IN while IN pro_monthly is a recurring subscription; unknown plan / legacy offer → null', () => {
    const ind = tiers.getOffer({ country: 'IN', arm: 'tiered', expArm: 'three_option_control' });
    expect(tiers.lineItemFor(ind, 'pro_annual')).toMatchObject({ mode: 'payment', recurring: false, prepaidYear: true });
    expect(tiers.lineItemFor(ind, 'educator')).toMatchObject({ mode: 'payment', recurring: false, prepaidYear: true });
    expect(tiers.lineItemFor(ind, 'pro_monthly')).toMatchObject({ mode: 'subscription', recurring: true, prepaidYear: false });
    expect(tiers.lineItemFor(ind, 'lifetime').prepaidYear).toBe(false);
    expect(tiers.lineItemFor(ind, 'unknown_plan')).toBeNull();
    expect(tiers.lineItemFor({ tiered: false }, 'pro_annual')).toBeNull();
    expect(tiers.lineItemFor(null, 'pro_annual')).toBeNull();
  });
});
