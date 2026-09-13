// Tests for backend/src/lib/i18n.js
const i18n = require('../../src/lib/i18n');

describe('backend i18n', () => {
  beforeEach(() => {
    i18n._resetCache();
  });

  describe('normalizeLocale', () => {
    test('returns "en" for null, undefined, non-string, or unknown locale', () => {
      expect(i18n.normalizeLocale(null)).toBe('en');
      expect(i18n.normalizeLocale(undefined)).toBe('en');
      expect(i18n.normalizeLocale(123)).toBe('en');
      expect(i18n.normalizeLocale('')).toBe('en');
      expect(i18n.normalizeLocale('xx-YY')).toBe('en');
    });

    test('handles Chinese language codes', () => {
      expect(i18n.normalizeLocale('zh-CN')).toBe('zh-CN');
      expect(i18n.normalizeLocale('zh-SG')).toBe('zh-CN');
      expect(i18n.normalizeLocale('zh-Hans')).toBe('zh-CN');
      expect(i18n.normalizeLocale('zh-TW')).toBe('zh');
      expect(i18n.normalizeLocale('zh')).toBe('zh');
    });

    test('normalizes standard locales by prefix or exact code', () => {
      expect(i18n.normalizeLocale('es-MX')).toBe('es');
      expect(i18n.normalizeLocale('de-DE')).toBe('de');
      expect(i18n.normalizeLocale('fr_FR')).toBe('fr');
      expect(i18n.normalizeLocale('cs-CZ')).toBe('cs');
      expect(i18n.normalizeLocale('da-DK')).toBe('da');
      expect(i18n.normalizeLocale('fi-FI')).toBe('fi');
      expect(i18n.normalizeLocale('hu-HU')).toBe('hu');
      expect(i18n.normalizeLocale('sv-SE')).toBe('sv');
      expect(i18n.normalizeLocale('he-IL')).toBe('he');
    });
  });

  describe('t() translation lookup', () => {
    test('looks up keys for valid locales', () => {
      expect(i18n.t('btn.start', 'es')).toBe('Iniciar');
      expect(i18n.t('btn.start', 'en')).toBe('Start');
    });

    test('falls back to English when key is missing in target locale', () => {
      expect(i18n.t('billing.lmsCsvPro', 'es')).toBeDefined();
    });

    test('falls back to fallback argument when key is missing in all locales', () => {
      expect(i18n.t('totally.unknown.key', 'es', 'My Fallback')).toBe('My Fallback');
    });

    test('returns key itself when key is missing and no fallback provided', () => {
      expect(i18n.t('totally.unknown.key', 'es')).toBe('totally.unknown.key');
    });
  });

  describe('getSheetHeaders', () => {
    test('returns standard English headers for en or unknown locale', () => {
      const headersEn = i18n.getSheetHeaders('en', 'EDT');
      expect(headersEn[0]).toBe('Name');
      expect(headersEn[1]).toBe('Email');
      expect(headersEn[4]).toBe('Join Time (EDT)');
      expect(headersEn[5]).toBe('Leave Time (EDT)');

      const headersUnknown = i18n.getSheetHeaders('zz', 'UTC');
      expect(headersUnknown[0]).toBe('Name');
      expect(headersUnknown[4]).toBe('Join Time (UTC)');

      const headersNoTz = i18n.getSheetHeaders('en');
      expect(headersNoTz[4]).toBe('Join Time');
    });

    test('returns localized headers for Czech, Danish, Finnish, Hungarian, Spanish, etc.', () => {
      const csHeaders = i18n.getSheetHeaders('cs-CZ', 'CET');
      expect(csHeaders[0]).toBe('Jméno');
      expect(csHeaders[1]).toBe('E-mail');
      expect(csHeaders[4]).toBe('Čas připojení (CET)');

      const daHeaders = i18n.getSheetHeaders('da-DK', 'CET');
      expect(daHeaders[0]).toBe('Navn');
      expect(daHeaders[1]).toBe('E-mail');

      const fiHeaders = i18n.getSheetHeaders('fi-FI', 'EET');
      expect(fiHeaders[0]).toBe('Nimi');
      expect(fiHeaders[1]).toBe('Sähköposti');

      const huHeaders = i18n.getSheetHeaders('hu-HU', 'CET');
      expect(huHeaders[0]).toBe('Név');
      expect(huHeaders[1]).toBe('E-mail');

      const esHeaders = i18n.getSheetHeaders('es-ES', 'GMT');
      expect(esHeaders[0]).toBe('Nombre');
      expect(esHeaders[1]).toBe('Correo');

      const frHeaders = i18n.getSheetHeaders('fr-FR', 'CET');
      expect(frHeaders[0]).toBe('Nom');
      expect(frHeaders[1]).toBe('E-mail');

      const deHeaders = i18n.getSheetHeaders('de-DE', 'CET');
      expect(deHeaders[0]).toBe('Name');
      expect(deHeaders[1]).toBe('E-Mail');

      const ptHeaders = i18n.getSheetHeaders('pt-BR', 'BRT');
      expect(ptHeaders[0]).toBe('Nome');
      expect(ptHeaders[1]).toBe('E-mail');

      const ukHeaders = i18n.getSheetHeaders('uk-UA', 'EET');
      expect(ukHeaders[0]).toBe("Ім'я");
      expect(ukHeaders[1]).toBe('Ел. пошта');

      const svHeaders = i18n.getSheetHeaders('sv-SE', 'CET');
      expect(svHeaders[0]).toBe('Namn');
      expect(svHeaders[1]).toBe('E-post');

      const heHeaders = i18n.getSheetHeaders('he-IL', 'IST');
      expect(heHeaders[0]).toBe('שם');
      expect(heHeaders[1]).toBe('אימייל');
    });
  });

  describe('getStrings caching', () => {
    test('reuses cached instance on repeated calls', () => {
      const s1 = i18n.getStrings();
      const s2 = i18n.getStrings();
      expect(s1).toBe(s2);
    });
  });
});
