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
  test('defaults to 3', () => {
    expect(pricing.quotaLimit()).toBe(3);
  });

  test('falls back to the default when the server sends a falsy limit', () => {
    pricing.fromStatus({ pricing: { quotaLimit: 0 } });
    expect(pricing.quotaLimit()).toBe(3);
  });
});
