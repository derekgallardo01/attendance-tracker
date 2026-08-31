/**
 * @jest-environment jsdom
 *
 * Tests for the i18n foundation in js/strings.js — t() lookup, locale
 * switching, language detection, DOM translation, and the fallback chain.
 */

const path = require('path');
const strings = require(path.join(__dirname, '..', '..', '..', 'js', 'strings.js'));

describe('t() lookup', () => {
  beforeEach(() => strings.setLocale('en'));

  test('returns the English string for a known key', () => {
    expect(strings.t('toast.signedOut')).toBe('Signed out');
    expect(strings.t('btn.start')).toBe('Start');
    expect(strings.t('attendee.present')).toBe('Present');
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

  test('switches between supported locales accurately', () => {
    // Spanish
    strings.setLocale('es');
    expect(strings.t('btn.start')).toBe('Iniciar');
    expect(strings.t('status.tracking')).toBe('Registrando asistencia…');
    expect(strings.t('attendee.present')).toBe('Presente');

    // Portuguese
    strings.setLocale('pt');
    expect(strings.t('btn.start')).toBe('Iniciar');
    expect(strings.t('status.tracking')).toBe('Registrando presença…');
    expect(strings.t('btn.sheet')).toBe('Planilha');

    // Hindi
    strings.setLocale('hi');
    expect(strings.t('btn.start')).toBe('शुरू करें');
    expect(strings.t('attendee.present')).toBe('उपस्थित');

    // Tagalog / Filipino
    strings.setLocale('tl');
    expect(strings.t('btn.start')).toBe('Simulan');
    expect(strings.t('attendee.present')).toBe('Dumalo (Present)');

    // Malay
    strings.setLocale('ms');
    expect(strings.t('btn.start')).toBe('Mula');
    expect(strings.t('attendee.present')).toBe('Hadir');

    // Traditional Chinese
    strings.setLocale('zh');
    expect(strings.t('btn.start')).toBe('開始');
    expect(strings.t('attendee.present')).toBe('出席');

    // Japanese
    strings.setLocale('ja');
    expect(strings.t('btn.start')).toBe('開始');
    expect(strings.t('attendee.present')).toBe('出席');
    expect(strings.t('status.tracking')).toBe('出席状況を記録中…');
  });

  test('persists locale to localStorage when requested', () => {
    strings.setLocale('es', true);
    expect(localStorage.getItem('att_locale')).toBe('es');
    localStorage.removeItem('att_locale');
  });
});

describe('detectLocale', () => {
  afterEach(() => {
    localStorage.removeItem('att_locale');
  });

  test('detects locale from browser language prefix', () => {
    expect(strings.detectLocale('es-MX')).toBe('es');
    expect(strings.detectLocale('es-AR')).toBe('es');
    expect(strings.detectLocale('es-ES')).toBe('es');
    expect(strings.detectLocale('pt-BR')).toBe('pt');
    expect(strings.detectLocale('pt-PT')).toBe('pt');
    expect(strings.detectLocale('hi-IN')).toBe('hi');
    expect(strings.detectLocale('tl-PH')).toBe('tl');
    expect(strings.detectLocale('fil-PH')).toBe('tl');
    expect(strings.detectLocale('ms-MY')).toBe('ms');
    expect(strings.detectLocale('zh-TW')).toBe('zh');
    expect(strings.detectLocale('zh-HK')).toBe('zh');
    expect(strings.detectLocale('ja-JP')).toBe('ja');
    expect(strings.detectLocale('en-US')).toBe('en');
    expect(strings.detectLocale('fr-FR')).toBe('en'); // fallback
  });

  test('prefers stored locale in localStorage over browser language', () => {
    localStorage.setItem('att_locale', 'ja');
    expect(strings.detectLocale('es-ES')).toBe('ja');
  });
});

describe('applyTranslations DOM helper', () => {
  afterEach(() => strings.setLocale('en'));

  test('updates data-i18n, placeholder, and title attributes in DOM', () => {
    document.body.innerHTML = `
      <div id="test-container">
        <button id="start-btn" data-i18n="btn.start">Start</button>
        <input id="search-input" data-i18n-placeholder="btn.filter" placeholder="Filter" />
        <span id="help-icon" data-i18n-title="nav.settings" title="Settings">?</span>
      </div>
    `;

    strings.setLocale('es');
    strings.applyTranslations(document.getElementById('test-container'));

    expect(document.getElementById('start-btn').textContent).toBe('Iniciar');
    expect(document.getElementById('search-input').getAttribute('placeholder')).toBe('Filtrar');
    expect(document.getElementById('help-icon').getAttribute('title')).toBe('Configuración');
  });
});

describe('dictionary parity across all locales', () => {
  const locales = strings.getAvailableLocales().map(l => l.code);
  const enKeys = Object.keys(strings.STRINGS.en);

  test('English dictionary has substantial UI coverage', () => {
    expect(enKeys.length).toBeGreaterThan(45);
  });

  test.each(locales.filter(l => l !== 'en'))('locale "%s" contains 100% of English translation keys', (localeCode) => {
    const localeDict = strings.STRINGS[localeCode];
    expect(localeDict).toBeDefined();
    for (const key of enKeys) {
      expect(localeDict[key]).toBeDefined();
      expect(typeof localeDict[key]).toBe('string');
      expect(localeDict[key].trim().length).toBeGreaterThan(0);
    }
  });
});


