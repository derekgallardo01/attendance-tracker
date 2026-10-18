// Tiered regional pricing: country → tier, local-currency prepaid markets vs
// USD subscription markets, the tier-3 experiment split, and money formatting.

const tiers = require('../../src/config/priceTiers');

const ENV_KEYS = ['TIERED_PRICING', 'TIER3_TEST', 'STRIPE_PRO_PRODUCT_ID'];
let saved;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  process.env.TIERED_PRICING = '1';
  delete process.env.TIER3_TEST;
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
  test('split is stable per email and covers both arms', () => {
    const a = emailInArm('tiered');
    const b = emailInArm('legacy');
    expect(tiers.tier3Arm(a)).toBe('tiered');
    expect(tiers.tier3Arm(` ${a.toUpperCase()} `)).toBe('tiered'); // normalized
    expect(tiers.tier3Arm(b)).toBe('legacy');
  });
  test('no email → legacy; all / off overrides', () => {
    expect(tiers.tier3Arm(null)).toBe('legacy');
    process.env.TIER3_TEST = 'all';
    expect(tiers.tier3Arm(null)).toBe('tiered');
    process.env.TIER3_TEST = 'off';
    expect(tiers.tier3Arm(emailInArm('tiered'))).toBe('legacy');
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

  test('tier 1 USD subscription market with monthly', () => {
    const o = tiers.getOffer({ country: 'US', email: 'a@b.com' });
    expect(o).toMatchObject({ tiered: true, tier: 1, arm: 'tiered', currency: 'usd', prepaid: false, monthlyAvailable: true, methods: null });
    expect(o.prices.pro_annual).toEqual({ amount: 2900, currency: 'usd', label: '$29', period: '/yr', full: null, perMonth: '$2.42' });
    expect(o.prices.pro_monthly.period).toBe('/mo');
    expect(o.prices.pro_monthly.perMonth).toBeUndefined();
    expect(o.prices.lifetime.period).toBe('one-time');
    expect(o.prices.educator.label).toBe('$19');
  });

  test('missing country defaults to tier 1', () => {
    expect(tiers.getOffer()).toMatchObject({ tiered: true, tier: 1, country: null });
  });

  test('local-currency market: prepaid, no monthly', () => {
    const o = tiers.getOffer({ country: 'MX', email: 'a@b.com' });
    expect(o).toMatchObject({ tiered: true, tier: 2, currency: 'mxn', prepaid: true, monthlyAvailable: false });
    expect(o.prices.pro_monthly).toBeUndefined();
    expect(o.prices.pro_annual.label).toBe('MX$279');
    expect(o.prices.pro_annual.perMonth).toBe('MX$23'); // whole units outside USD
    process.env.TIER3_TEST = 'all';
    expect(tiers.getOffer({ country: 'ID', email: 'a@b.com' }).prices.pro_annual.perMonth).toBe('Rp 11.583');
  });

  test('tier 3: legacy arm falls back; tiered arm gets local prices + methods', () => {
    expect(tiers.getOffer({ country: 'IN', email: emailInArm('legacy') })).toMatchObject({ tiered: false, tier: 3, arm: 'legacy' });
    const o = tiers.getOffer({ country: 'IN', email: emailInArm('tiered') });
    expect(o).toMatchObject({ tiered: true, tier: 3, arm: 'tiered', currency: 'inr', methods: ['card', 'upi'] });
  });

  test('tier 3 USD market (no local table) sells subscriptions', () => {
    const o = tiers.getOffer({ country: 'VN', email: emailInArm('tiered') });
    expect(o).toMatchObject({ tiered: true, currency: 'usd', prepaid: false, monthlyAvailable: true });
    expect(o.prices.pro_annual.label).toBe('$9');
  });
});

describe('lineItemFor', () => {
  test('subscription annual / monthly in USD markets', () => {
    const o = tiers.getOffer({ country: 'US', email: 'a@b.com' });
    const annual = tiers.lineItemFor(o, 'pro_annual');
    expect(annual).toEqual({
      lineItem: { price_data: { currency: 'usd', unit_amount: 2900, product_data: { name: 'Attendance Tracker Pro (Annual)' }, recurring: { interval: 'year' } }, quantity: 1 },
      mode: 'subscription', recurring: true, prepaidYear: false,
    });
    expect(tiers.lineItemFor(o, 'pro_monthly').lineItem.price_data.recurring).toEqual({ interval: 'month' });
    expect(tiers.lineItemFor(o, 'educator').recurring).toBe(true);
  });

  test('one-time lifetime / meeting pass; configured product id wins', () => {
    process.env.STRIPE_PRO_PRODUCT_ID = 'prod_123';
    const o = tiers.getOffer({ country: 'US', email: 'a@b.com' });
    const life = tiers.lineItemFor(o, 'lifetime');
    expect(life).toMatchObject({ mode: 'payment', recurring: false, prepaidYear: false });
    expect(life.lineItem.price_data).toEqual({ currency: 'usd', unit_amount: 4900, product: 'prod_123' });
  });

  test('prepaid annual in local markets; unavailable plan / legacy offer → null', () => {
    const br = tiers.getOffer({ country: 'BR', email: 'a@b.com' });
    expect(tiers.lineItemFor(br, 'pro_annual')).toMatchObject({ mode: 'payment', recurring: false, prepaidYear: true });
    expect(tiers.lineItemFor(br, 'lifetime').prepaidYear).toBe(false);
    expect(tiers.lineItemFor(br, 'pro_monthly')).toBeNull();
    expect(tiers.lineItemFor({ tiered: false }, 'pro_annual')).toBeNull();
    expect(tiers.lineItemFor(null, 'pro_annual')).toBeNull();
  });
});
