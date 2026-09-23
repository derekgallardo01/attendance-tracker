/**
 * @jest-environment jsdom
 *
 * Tests for js/pricing.js — the frontend half of the display-price single
 * source of truth.
 */

const path = require('path');
const pricing = require(path.join(__dirname, '..', '..', '..', 'js', 'pricing.js'));

beforeEach(() => pricing._reset());

describe('price()', () => {
  test('returns the default label for every known plan', () => {
    expect(pricing.price('lifetime')).toBe('$9.99');
    expect(pricing.price('educator')).toBe('$4.99');
    expect(pricing.price('team')).toBe('$19.99');
    expect(pricing.price('institution')).toBe('$149');
  });

  test('returns an empty string for an unknown plan (render-safe)', () => {
    expect(pricing.price('yacht')).toBe('');
  });

  test('returns an empty string when a plan entry has no label', () => {
    pricing.fromStatus({ pricing: { lifetime: {} } });
    expect(pricing.price('lifetime')).toBe('');
  });
});

describe('fromStatus()', () => {
  test('server pricing overrides the static fallback', () => {
    const table = pricing.fromStatus({ pricing: { lifetime: { label: '$14.99', period: 'one-time' }, quotaLimit: 5 } });
    expect(pricing.price('lifetime')).toBe('$14.99');
    expect(pricing.quotaLimit()).toBe(5);
    expect(table.educator.label).toBe('$4.99'); // untouched plans keep defaults
  });

  test('a payload without pricing keeps the defaults', () => {
    pricing.fromStatus({ plan: 'free' });
    expect(pricing.price('lifetime')).toBe('$9.99');
  });

  test('a null/undefined payload keeps the defaults', () => {
    pricing.fromStatus(null);
    pricing.fromStatus(undefined);
    expect(pricing.price('educator')).toBe('$4.99');
  });
});

describe('quotaLimit()', () => {
  test('defaults to 2', () => {
    expect(pricing.quotaLimit()).toBe(2);
  });

  test('falls back to the default when the server sends a falsy limit', () => {
    pricing.fromStatus({ pricing: { quotaLimit: 0 } });
    expect(pricing.quotaLimit()).toBe(2);
  });
});

describe('localCurrencyAnchor()', () => {
  test('returns local currency estimate for supported countries and plans', () => {
    expect(pricing.localCurrencyAnchor('PH', 'educator')).toBe('~₱280/yr');
    expect(pricing.localCurrencyAnchor('PH', 'lifetime')).toBe('~₱560');
    expect(pricing.localCurrencyAnchor('IN', 'educator')).toBe('~₹415/yr');
    expect(pricing.localCurrencyAnchor('IN', 'lifetime')).toBe('~₹830');
    expect(pricing.localCurrencyAnchor('ID', 'lifetime')).toBe('~Rp 155.000');
    expect(pricing.localCurrencyAnchor('BR', 'educator')).toBe('~R$ 27/yr');
    expect(pricing.localCurrencyAnchor('MX', 'department')).toBe('~MX$ 1,150/yr');
    expect(pricing.localCurrencyAnchor('CO', 'lifetime')).toBe('~COP 40.000');
    expect(pricing.localCurrencyAnchor('MY', 'educator')).toBe('~RM 22/yr');
    expect(pricing.localCurrencyAnchor('ES', 'lifetime')).toBe('~8,99 €');
    expect(pricing.localCurrencyAnchor('GB', 'lifetime')).toBe('~£7.90');
    expect(pricing.localCurrencyAnchor('IL', 'educator')).toBe('~₪18.50/yr');
    expect(pricing.localCurrencyAnchor('KZ', 'educator')).toBe('~2,500 ₸/yr');
    expect(pricing.localCurrencyAnchor('KZ', 'lifetime')).toBe('~5,000 ₸');
  });

  test('normalizes lowercase and whitespace in country code', () => {
    expect(pricing.localCurrencyAnchor(' ph ', 'educator')).toBe('~₱280/yr');
  });

  test('returns empty string for unsupported countries', () => {
    expect(pricing.localCurrencyAnchor('US', 'lifetime')).toBe('');
    expect(pricing.localCurrencyAnchor('AU', 'educator')).toBe('');
  });

  test('returns empty string for invalid/missing country code', () => {
    expect(pricing.localCurrencyAnchor(null, 'lifetime')).toBe('');
    expect(pricing.localCurrencyAnchor(undefined, 'lifetime')).toBe('');
    expect(pricing.localCurrencyAnchor('', 'lifetime')).toBe('');
    expect(pricing.localCurrencyAnchor(123, 'lifetime')).toBe('');
  });

  test('returns empty string for unknown plan', () => {
    expect(pricing.localCurrencyAnchor('PH', 'unknown_plan')).toBe('');
  });
});

