/**
 * @jest-environment jsdom
 *
 * Tests for the i18n foundation in js/strings.js — t() lookup, locale
 * switching, and the fallback chain (locale → en → provided fallback → key).
 */

const path = require('path');
const strings = require(path.join(__dirname, '..', '..', '..', 'js', 'strings.js'));

describe('t() lookup', () => {
  beforeEach(() => strings.setLocale('en'));

  test('returns the English string for a known key', () => {
    expect(strings.t('toast.signedOut')).toBe('Signed out');
    expect(strings.t('btn.start')).toBe('Start');
  });

  test('unknown key falls back to the provided fallback', () => {
    expect(strings.t('does.not.exist', 'Fallback text')).toBe('Fallback text');
  });

  test('unknown key with no fallback returns the key itself (visible, not blank)', () => {
    expect(strings.t('totally.missing')).toBe('totally.missing');
  });
});

describe('setLocale + fallback chain', () => {
  afterEach(() => strings.setLocale('en'));

  test('unknown locale is ignored (stays on the current one)', () => {
    strings.setLocale('zz');
    expect(strings.getLocale()).toBe('en');
  });

  test('a new locale table would fall back to English for missing keys', () => {
    strings.STRINGS.es = { 'btn.start': 'Empezar' }; // partial locale
    strings.setLocale('es');
    expect(strings.t('btn.start')).toBe('Empezar');        // present in es
    expect(strings.t('toast.signedOut')).toBe('Signed out'); // falls back to en
    delete strings.STRINGS.es;
  });
});
