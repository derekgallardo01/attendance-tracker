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
    expect(strings.t('roster.copyList')).toBe('Copiar lista');

    // Portuguese
    strings.setLocale('pt');
    expect(strings.t('btn.start')).toBe('Iniciar');
    expect(strings.t('status.tracking')).toBe('Registrando presença…');
    expect(strings.t('btn.sheet')).toBe('Planilha');
    expect(strings.t('roster.copyList')).toBe('Copiar lista');

    // Hindi
    strings.setLocale('hi');
    expect(strings.t('btn.start')).toBe('शुरू करें');
    expect(strings.t('attendee.present')).toBe('उपस्थित');
    expect(strings.t('roster.copyList')).toBe('सूची कॉपी करें');

    // Tagalog / Filipino
    strings.setLocale('tl');
    expect(strings.t('btn.start')).toBe('Simulan');
    expect(strings.t('attendee.present')).toBe('Dumalo (Present)');
    expect(strings.t('roster.copyList')).toBe('Kopyahin ang Listahan');

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

    // Tamil
    strings.setLocale('ta');
    expect(strings.t('btn.start')).toBe('தொடங்கு');
    expect(strings.t('attendee.present')).toBe('வந்தவர் (Present)');

    // Telugu
    strings.setLocale('te');
    expect(strings.t('btn.start')).toBe('ప్రారంభించు');
    expect(strings.t('attendee.present')).toBe('హాజరయ్యారు (Present)');

    // Bengali
    strings.setLocale('bn');
    expect(strings.t('btn.start')).toBe('শুরু');
    expect(strings.t('attendee.present')).toBe('উপস্থিত (Present)');

    // Urdu
    strings.setLocale('ur');
    expect(strings.t('btn.start')).toBe('شروع کریں');
    expect(strings.t('attendee.present')).toBe('حاضر (Present)');

    // Simplified Chinese
    strings.setLocale('zh-CN');
    expect(strings.t('btn.start')).toBe('开始');
    expect(strings.t('attendee.present')).toBe('出勤 (Present)');

    // Russian
    strings.setLocale('ru');
    expect(strings.t('btn.start')).toBe('Начать');
    expect(strings.t('attendee.present')).toBe('Присутствует (Present)');

    // Ukrainian
    strings.setLocale('uk');
    expect(strings.t('btn.start')).toBe('Почати');
    expect(strings.t('attendee.present')).toBe('Присутній (Present)');

    // Romanian
    strings.setLocale('ro');
    expect(strings.t('btn.start')).toBe('Start');
    expect(strings.t('attendee.present')).toBe('Prezent (Present)');

    // Hebrew
    strings.setLocale('he');
    expect(strings.t('btn.start')).toBe('התחל');
    expect(strings.t('attendee.present')).toBe('נוכח (Present)');
    expect(strings.t('status.tracking')).toBe('מתעד נוכחות…');

    // Marathi
    strings.setLocale('mr');
    expect(strings.t('btn.start')).toBe('सुरू करा');
    expect(strings.t('attendee.present')).toBe('उपस्थित (Present)');
    expect(strings.t('status.tracking')).toBe('उपस्थिती नोंदवत आहे…');

    // Swedish
    strings.setLocale('sv');
    expect(strings.t('btn.start')).toBe('Starta');
    expect(strings.t('attendee.present')).toBe('Närvarande (Present)');
    expect(strings.t('status.tracking')).toBe('Spårar närvaro…');

    // Czech
    strings.setLocale('cs');
    expect(strings.t('btn.start')).toBe('Začít');
    expect(strings.t('attendee.present')).toBe('Přítomen (Present)');
    expect(strings.t('status.tracking')).toBe('Zaznamenávání docházky…');

    // Danish
    strings.setLocale('da');
    expect(strings.t('btn.start')).toBe('Start');
    expect(strings.t('attendee.present')).toBe('Til stede (Present)');
    expect(strings.t('status.tracking')).toBe('Registrerer fremmøde…');

    // Finnish
    strings.setLocale('fi');
    expect(strings.t('btn.start')).toBe('Aloita');
    expect(strings.t('attendee.present')).toBe('Paikalla (Present)');
    expect(strings.t('status.tracking')).toBe('Läsnäoloa seurataan…');

    // Hungarian
    strings.setLocale('hu');
    expect(strings.t('btn.start')).toBe('Indítás');
    expect(strings.t('attendee.present')).toBe('Jelen (Present)');
    expect(strings.t('status.tracking')).toBe('Jelenlét rögzítése…');
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
    delete window.location;
    window.location = new URL('https://attendancetracker.dev/');
  });

  test('detects locale from browser language prefix', () => {
    expect(strings.detectLocale('es-MX')).toBe('es');
    expect(strings.detectLocale('es-AR')).toBe('es');
    expect(strings.detectLocale('es-ES')).toBe('es');
    expect(strings.detectLocale('pt-BR')).toBe('pt');
    expect(strings.detectLocale('pt-PT')).toBe('pt');
    expect(strings.detectLocale('hi-IN')).toBe('hi');
    expect(strings.detectLocale('ta-IN')).toBe('ta');
    expect(strings.detectLocale('te-IN')).toBe('te');
    expect(strings.detectLocale('bn-BD')).toBe('bn');
    expect(strings.detectLocale('bn-IN')).toBe('bn');
    expect(strings.detectLocale('ur-PK')).toBe('ur');
    expect(strings.detectLocale('tl-PH')).toBe('tl');
    expect(strings.detectLocale('fil-PH')).toBe('tl');
    expect(strings.detectLocale('ms-MY')).toBe('ms');
    expect(strings.detectLocale('id-ID')).toBe('id');
    expect(strings.detectLocale('in-ID')).toBe('id');
    expect(strings.detectLocale('vi-VN')).toBe('vi');
    expect(strings.detectLocale('fr-FR')).toBe('fr');
    expect(strings.detectLocale('de-DE')).toBe('de');
    expect(strings.detectLocale('it-IT')).toBe('it');
    expect(strings.detectLocale('nl-NL')).toBe('nl');
    expect(strings.detectLocale('pl-PL')).toBe('pl');
    expect(strings.detectLocale('ro-RO')).toBe('ro');
    expect(strings.detectLocale('ro-MD')).toBe('ro');
    expect(strings.detectLocale('ru-RU')).toBe('ru');
    expect(strings.detectLocale('uk-UA')).toBe('uk');
    expect(strings.detectLocale('tr-TR')).toBe('tr');
    expect(strings.detectLocale('th-TH')).toBe('th');
    expect(strings.detectLocale('ar-AE')).toBe('ar');
    expect(strings.detectLocale('ko-KR')).toBe('ko');
    expect(strings.detectLocale('zh-CN')).toBe('zh-CN');
    expect(strings.detectLocale('zh-SG')).toBe('zh-CN');
    expect(strings.detectLocale('zh-Hans')).toBe('zh-CN');
    expect(strings.detectLocale('zh-TW')).toBe('zh');
    expect(strings.detectLocale('zh-HK')).toBe('zh');
    expect(strings.detectLocale('ja-JP')).toBe('ja');
    expect(strings.detectLocale('he-IL')).toBe('he');
    expect(strings.detectLocale('iw-IL')).toBe('he');
    expect(strings.detectLocale('mr-IN')).toBe('mr');
    expect(strings.detectLocale('sv-SE')).toBe('sv');
    expect(strings.detectLocale('cs-CZ')).toBe('cs');
    expect(strings.detectLocale('da-DK')).toBe('da');
    expect(strings.detectLocale('fi-FI')).toBe('fi');
    expect(strings.detectLocale('hu-HU')).toBe('hu');
    expect(strings.detectLocale('en-US')).toBe('en');
    expect(strings.detectLocale('xx-YY')).toBe('en'); // unknown fallback
  });

  test('prefers stored locale in localStorage over browser language', () => {
    localStorage.setItem('att_locale', 'ja');
    expect(strings.detectLocale('es-ES')).toBe('ja');
  });

  test('prefers URL query parameter lang over localStorage and browser language', () => {
    delete window.location;
    window.location = new URL('https://attendancetracker.dev/?lang=pt');
    localStorage.setItem('att_locale', 'ja');
    expect(strings.detectLocale('es-ES')).toBe('pt');
    expect(localStorage.getItem('att_locale')).toBe('pt');
  });

  test('ignores unknown URL query parameter lang and falls back', () => {
    delete window.location;
    window.location = new URL('https://attendancetracker.dev/?lang=nonexistent');
    localStorage.setItem('att_locale', 'ja');
    expect(strings.detectLocale('es-ES')).toBe('ja');
  });

  test('renderLanguagePicker renders select with all 35 locales and handles selection', () => {
    delete window.location;
    window.location = {
      href: 'http://localhost/?lang=en',
      search: '?lang=en',
    };
    const replaceSpy = jest.fn();
    window.history.replaceState = replaceSpy;

    document.body.innerHTML = '<div id="picker-mount"></div>';
    strings.renderLanguagePicker('picker-mount');
    const select = document.querySelector('.att-lang-picker');
    expect(select).not.toBeNull();
    expect(select.children.length).toBe(35);

    // Trigger language switch via picker with history.replaceState
    select.value = 'es';
    select.dispatchEvent(new Event('change'));
    expect(strings.getLocale()).toBe('es');
    expect(replaceSpy).toHaveBeenCalled();

    // Trigger language switch via picker without replaceState
    window.history.replaceState = null;
    select.value = 'de';
    select.dispatchEvent(new Event('change'));
    expect(strings.getLocale()).toBe('de');
    expect(window.location.href).toContain('lang=de');
  });

  test('supports ?hl= query parameter as alternative to ?lang=', () => {
    delete window.location;
    window.location = new URL('https://attendancetracker.dev/?hl=fr');
    expect(strings.detectLocale()).toBe('fr');
  });

  test('handles query param matching when localStorage.setItem throws', () => {
    delete window.location;
    window.location = new URL('https://attendancetracker.dev/?lang=es');
    jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('storage disabled'); });
    expect(strings.detectLocale()).toBe('es');
  });

  test('handles query param without lang or hl and falls back', () => {
    delete window.location;
    window.location = new URL('https://attendancetracker.dev/?other=123');
    expect(strings.detectLocale('fr-FR')).toBe('fr');
  });

  test('handles URLSearchParams throwing inside detectLocale', () => {
    delete window.location;
    window.location = new URL('https://attendancetracker.dev/?lang=es');
    const origURLSearchParams = global.URLSearchParams;
    global.URLSearchParams = function() { throw new Error('parse error'); };
    try {
      expect(strings.detectLocale('de-DE')).toBe('de');
    } finally {
      global.URLSearchParams = origURLSearchParams;
    }
  });

  test('detects Somali locale', () => {
    expect(strings.detectLocale('so-SO')).toBe('so');
  });

  test('setLocale handles document.cookie throwing', () => {
    const origCookie = Object.getOwnPropertyDescriptor(document, 'cookie');
    Object.defineProperty(document, 'cookie', {
      get: () => '',
      set: () => { throw new Error('cookie blocked'); },
      configurable: true,
    });
    try {
      expect(strings.setLocale('es', true)).toBe('es');
    } finally {
      if (origCookie) Object.defineProperty(document, 'cookie', origCookie);
    }
  });

  test('renderLanguagePicker accepts direct HTMLElement container', () => {
    const container = document.createElement('div');
    strings.renderLanguagePicker(container);
    expect(container.querySelector('select')).not.toBeNull();
  });

  test('renderLanguagePicker handles container not found gracefully', () => {
    expect(() => strings.renderLanguagePicker('non-existent-id')).not.toThrow();
    expect(() => strings.renderLanguagePicker(null)).not.toThrow();
  });
});

describe('applyTranslations DOM helper', () => {
  afterEach(() => strings.setLocale('en'));

  test('updates data-i18n, placeholder, title, and aria-label attributes in DOM', () => {
    document.body.innerHTML = `
      <div id="test-container">
        <button id="start-btn" data-i18n="btn.start">Start</button>
        <input id="search-input" data-i18n-placeholder="btn.filter" placeholder="Filter" />
        <span id="help-icon" data-i18n-title="nav.settings" title="Settings">?</span>
        <button id="settings-btn" data-i18n-aria="nav.settings" aria-label="Settings"></button>
      </div>
    `;

    strings.setLocale('es');
    strings.applyTranslations(document.getElementById('test-container'));

    expect(document.getElementById('start-btn').textContent).toBe('Iniciar');
    expect(document.getElementById('search-input').getAttribute('placeholder')).toBe('Filtrar');
    expect(document.getElementById('help-icon').getAttribute('title')).toBe('Configuración');
    expect(document.getElementById('settings-btn').getAttribute('aria-label')).toBe('Configuración');
  });
});

describe('defensive branches (coverage completeness)', () => {
  afterEach(() => {
    strings.setLocale('en');
    jest.restoreAllMocks();
    try { localStorage.removeItem('att_locale'); } catch { /* ignore */ }
  });

  test('t() falls back to English when a locale is missing a key (mutation test)', () => {
    // Structurally unreachable with real data — the parity test guarantees
    // every locale carries every en key — so temporarily remove one to pin
    // the English-fallback behavior.
    const es = strings.STRINGS.es;
    const saved = es['btn.start'];
    delete es['btn.start'];
    try {
      strings.setLocale('es');
      expect(strings.t('btn.start')).toBe('Start');
    } finally {
      es['btn.start'] = saved;
    }
  });

  test('detectLocale survives a throwing localStorage (private mode)', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(strings.detectLocale('es')).toBe('es');
  });

  test('detectLocale walks navigator.language → languages[0] → en', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    const origLang = Object.getOwnPropertyDescriptor(window.navigator, 'language');
    const origLangs = Object.getOwnPropertyDescriptor(window.navigator, 'languages');
    try {
      Object.defineProperty(window.navigator, 'language', { value: '', configurable: true });
      Object.defineProperty(window.navigator, 'languages', { value: undefined, configurable: true });
      expect(strings.detectLocale()).toBe('en'); // both hints empty → final 'en'
      Object.defineProperty(window.navigator, 'languages', { value: ['pt-BR'], configurable: true });
      expect(strings.detectLocale()).toBe('pt'); // languages[0] path
    } finally {
      if (origLang) Object.defineProperty(window.navigator, 'language', origLang); else delete window.navigator.language;
      if (origLangs) Object.defineProperty(window.navigator, 'languages', origLangs); else delete window.navigator.languages;
    }
  });

  test('detectLocale returns en when navigator itself is absent', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
    const desc = Object.getOwnPropertyDescriptor(window, 'navigator');
    Object.defineProperty(window, 'navigator', { value: undefined, configurable: true });
    try {
      expect(strings.detectLocale()).toBe('en');
    } finally {
      Object.defineProperty(window, 'navigator', desc);
    }
  });

  test('setLocale still switches when localStorage.setItem throws (quota/private mode)', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(strings.setLocale('es', true)).toBe('es');
    expect(strings.getLocale()).toBe('es');
  });

  test('applyTranslations tolerates a missing or non-DOM root', () => {
    expect(() => strings.applyTranslations()).not.toThrow();   // no-arg → falls back to document
    expect(() => strings.applyTranslations({})).not.toThrow(); // no querySelectorAll → early return
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

describe('no "wired but English-valued" keys (translation-content guard)', () => {
  // Parity (above) proves every locale HAS every key. This guard proves the
  // values were actually TRANSLATED, not copied from English — the gap that
  // let the whole pricing.* set render English in all 30 locales while passing
  // parity. A key whose value equals English across nearly every locale is
  // almost certainly untranslated; the few legitimate exceptions are
  // allowlisted below (language endonyms + brand/tier proper nouns).
  const nonEn = strings.getAvailableLocales().map(l => l.code).filter(l => l !== 'en');
  const en = strings.STRINGS.en;
  const enKeys = Object.keys(en);
  const THRESHOLD = 20; // English in >= 20 of the ~29 non-en locales

  // Intentionally-identical-across-locales keys:
  //  - lang.* : language names are written in their own language (endonyms),
  //    e.g. lang.es === "Español" in every locale by design.
  //  - brand / product-tier proper nouns kept in English on purpose.
  const isAllowed = (key) =>
    key.startsWith('lang.') ||
    key === 'source.marketplace' ||          // "Workspace Marketplace" (Google product name)
    key === 'pricing.planDomainName' ||      // "Domain Pro" tier — kept as a brand label
    key === 'roster.studentsPlaceholder' ||  // example names/emails — locale-invariant sample text
    key === 'setup.emailPlaceholder' ||      // "admin@yourcompany.com" — example email
    key === 'team.transferPlaceholder' ||    // "teammate@yourdomain.com" — example email
    key === 'team.adminBadge' ||             // "ADMIN" — compact status badge, kept short/uppercase
    key === 'setup.step2Link' ||             // admin.google.com console breadcrumb (URL + exact console labels)
    key === 'quote.emailPlaceholder' ||      // "you@yourschool.edu" — example email
    key === 'badge.pro' ||                   // "Pro" — tier brand label
    key === 'settings.extraEmailsPlaceholder'; // example emails — locale-invariant sample text

  test('every non-allowlisted key is translated (not English-valued) in the locales', () => {
    const offenders = [];
    for (const key of enKeys) {
      if (isAllowed(key)) continue;
      let sameAsEn = 0;
      for (const loc of nonEn) {
        if (strings.STRINGS[loc][key] === en[key]) sameAsEn++;
      }
      if (sameAsEn >= THRESHOLD) {
        offenders.push(`${key} (English in ${sameAsEn}/${nonEn.length}: "${en[key]}")`);
      }
    }
    // If this fails, either translate the key across the 30 locales, or — if it
    // is genuinely meant to be identical everywhere (a brand/proper noun) — add
    // it to isAllowed() above with a comment saying why.
    expect(offenders).toEqual([]);
  });
});


