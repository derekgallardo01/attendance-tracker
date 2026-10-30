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

describe('tf() named placeholders', () => {
  beforeEach(() => strings.setLocale('en'));
  afterEach(() => { delete strings.STRINGS.en['test.tfNonString']; });

  test('fills known placeholders and leaves unknown ones visible', () => {
    expect(strings.tf('missing.key', { a: 1 }, 'A={a} B={b}')).toBe('A=1 B={b}');
  });

  test('without vars the raw string is returned', () => {
    expect(strings.tf('missing.key', null, 'A={a}')).toBe('A={a}');
  });

  test('non-string dictionary values pass through untouched', () => {
    strings.STRINGS.en['test.tfNonString'] = 42;
    expect(strings.tf('test.tfNonString', { a: 1 })).toBe(42);
  });
});

describe('tn() plural-aware lookup', () => {
  const KEY = 'test.apples';
  beforeAll(() => {
    strings.STRINGS.en[KEY + '.one'] = '{count} apple';
    strings.STRINGS.en[KEY + '.other'] = '{count} apples in {place}';
    strings.STRINGS.ru[KEY + '.one'] = '{count} яблоко';
    strings.STRINGS.ru[KEY + '.few'] = '{count} яблока';
    strings.STRINGS.ru[KEY + '.many'] = '{count} яблок';
    strings.STRINGS.de[KEY + '.other'] = '{count} Äpfel';
  });
  afterAll(() => {
    for (const loc of ['en', 'ru', 'de']) {
      for (const c of ['one', 'few', 'many', 'other']) delete strings.STRINGS[loc][KEY + '.' + c];
    }
  });
  afterEach(() => strings.setLocale('en'));

  test('English one/other with extra vars', () => {
    expect(strings.tn(KEY, 1)).toBe('1 apple');
    expect(strings.tn(KEY, 3, { place: 'a box' })).toBe('3 apples in a box');
  });

  test('Russian uses one/few/many categories and locale number formatting', () => {
    strings.setLocale('ru');
    expect(strings.tn(KEY, 1)).toBe('1 яблоко');
    expect(strings.tn(KEY, 3)).toBe('3 яблока');
    expect(strings.tn(KEY, 5)).toBe('5 яблок');
    expect(strings.tn(KEY, 1000)).toBe('1 000 яблок');
  });

  test('falls back to the locale .other, then English, then fallback, then key', () => {
    strings.setLocale('de');
    expect(strings.tn(KEY, 1)).toBe('1 Äpfel'); // no de .one → de .other
    strings.setLocale('fr');
    expect(strings.tn(KEY, 2, { place: 'x' })).toBe('2 apples in x'); // English
    expect(strings.tn('test.none', 2, null, '{count} things')).toBe('2 things');
    expect(strings.tn('test.none', 2)).toBe('test.none');
  });

  test('non-numeric counts are treated as 0', () => {
    expect(strings.tn(KEY, 'abc', { place: 'p' })).toBe('0 apples in p');
  });

  test('survives Intl failures (number formatting and plural rules)', () => {
    const realNF = Intl.NumberFormat;
    Intl.NumberFormat = function () { throw new Error('nope'); };
    try {
      expect(strings.tn(KEY, 1)).toBe('1 apple');
    } finally {
      Intl.NumberFormat = realNF;
    }
    expect(strings.pluralCategory(1, 'not a locale!!')).toBe('one');
    expect(strings.pluralCategory(2, 'not a locale!!')).toBe('other');
  });
});

describe('fmt — locale-aware formatting', () => {
  const F = strings.fmt;
  const D = new Date(Date.UTC(2026, 2, 5, 14, 7)); // 5 Mar 2026 14:07 UTC
  afterEach(() => strings.setLocale('en'));

  test('date/time/dateTime follow the CHOSEN locale and accept options', () => {
    strings.setLocale('de');
    expect(F.date(D, { timeZone: 'UTC' })).toBe('5. März 2026');
    expect(F.date(D)).toMatch(/2026/);
    expect(F.time(D, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })).toBe('14:07');
    expect(F.time(D)).toMatch(/\d/);
    expect(F.dateTime(D, null, 'en')).toMatch(/Mar 5, 2026/);
    expect(F.date(D.toISOString(), { timeZone: 'UTC' }, 'ja')).toBe('2026年3月5日');
  });

  test('empty and invalid dates render as empty strings', () => {
    for (const bad of [null, undefined, '', 'not a date']) {
      expect(F.date(bad)).toBe('');
      expect(F.time(bad)).toBe('');
      expect(F.relative(bad)).toBe('');
    }
  });

  test('numbers and percents use locale digits and symbols', () => {
    expect(F.number(1234.5, null, 'de')).toBe('1.234,5');
    expect(F.number('x')).toBe('');
    expect(F.percent(0.875, 'en')).toBe('88%');
    expect(F.percent(0.5, 'fr')).toBe('50 %');
    expect(F.percent('nope')).toBe('');
  });

  test('minutes/duration render localized units', () => {
    expect(F.minutes(0, 'en')).toBe('< 1 min');
    expect(F.minutes(5, 'en')).toBe('5 min');
    expect(F.minutes(60, 'en')).toBe('1 hr');
    expect(F.minutes(65, 'en')).toBe('1 hr 5 min');
    expect(F.minutes('junk', 'en')).toBe('< 1 min');
    expect(F.duration(65 * 60000, 'de')).toBe('1 Std. 5 Min.');
    expect(F.duration(null, 'en')).toBe('< 1 min');
  });

  test('relative times use Intl.RelativeTimeFormat', () => {
    const now = D.getTime();
    expect(F.relative(D, now, 'en')).toBe('now');
    expect(F.relative(now - 5 * 60000, now, 'en')).toBe('5 minutes ago');
    expect(F.relative(now - 2 * 3600000, now, 'en')).toBe('2 hours ago');
    expect(F.relative(now - 86400000, now, 'en')).toBe('yesterday');
    expect(F.relative(now - 3 * 86400000, now, 'es')).toBe('hace 3 días');
    expect(F.relative(new Date(Date.now() - 1000))).not.toBe('');
  });

  test('weekStart from Intl week info', () => {
    expect(F.weekStart('en-US')).toBe(0);
    expect(F.weekStart('de-DE')).toBe(1);
    strings.setLocale('de');
    expect([0, 1]).toContain(F.weekStart());
  });

  test('fallbacks when Intl throws or lacks week info', () => {
    const real = { DTF: Intl.DateTimeFormat, NF: Intl.NumberFormat, RTF: Intl.RelativeTimeFormat, L: Intl.Locale };
    const boom = function () { throw new Error('no intl'); };
    Intl.DateTimeFormat = boom; Intl.NumberFormat = boom; Intl.RelativeTimeFormat = boom;
    try {
      expect(F.date(D)).toBe(D.toDateString());
      expect(F.time(D)).toBe(D.toTimeString().slice(0, 5));
      expect(F.number(3)).toBe('3');
      expect(F.relative(D, D.getTime())).toBe('now');
      expect(F.relative(D, D.getTime() + 60000)).toBe('1 minute ago');
      expect(F.relative(D, D.getTime() + 120000)).toBe('2 minutes ago');
    } finally {
      Intl.DateTimeFormat = real.DTF; Intl.NumberFormat = real.NF; Intl.RelativeTimeFormat = real.RTF;
    }
    // Intl.Locale without week info → region fallback table.
    Intl.Locale = function () { return { weekInfo: undefined }; };
    try {
      expect(F.weekStart('pt')).toBe(0);
      expect(F.weekStart('fr')).toBe(1);
    } finally {
      Intl.Locale = real.L;
    }
    // getWeekInfo() path.
    Intl.Locale = function () { return { getWeekInfo: () => ({ firstDay: 6 }) }; };
    try {
      expect(F.weekStart('ar')).toBe(6);
    } finally {
      Intl.Locale = real.L;
    }
  });
});

describe('errorText() — API errors in the user language', () => {
  beforeAll(() => {
    strings.STRINGS.en['error.ZZ_QUOTA'] = 'Used {limit} exports';
    strings.STRINGS.es['error.ZZ_QUOTA'] = 'Usaste {limit} exportaciones';
  });
  afterAll(() => {
    delete strings.STRINGS.en['error.ZZ_QUOTA'];
    delete strings.STRINGS.es['error.ZZ_QUOTA'];
  });
  afterEach(() => strings.setLocale('en'));

  test('a known code renders the translated message with params', () => {
    strings.setLocale('es');
    expect(strings.errorText({ error: 'English', code: 'ZZ_QUOTA', params: { limit: 2 } })).toBe('Usaste 2 exportaciones');
  });

  test('English UI shows the server message when the code is unknown or missing', () => {
    expect(strings.errorText({ error: 'Specific English detail', code: 'ZZ_UNKNOWN' })).toBe('Specific English detail');
  });

  test('non-English UI never shows raw English: fallback key, then generic', () => {
    strings.setLocale('es');
    expect(strings.errorText({ error: 'English only' }, 'btn.cancel')).toBe(strings.t('btn.cancel'));
    expect(strings.errorText({ error: 'English only' })).toBe(strings.t('error.SERVER_ERROR', 'Something went wrong. Please try again.'));
    expect(strings.errorText(null)).toBe(strings.t('error.SERVER_ERROR', 'Something went wrong. Please try again.'));
  });

  test('apiError carries localized text and the code', () => {
    strings.setLocale('es');
    const err = strings.apiError({ error: 'x', code: 'ZZ_QUOTA', params: { limit: 3 } });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('Usaste 3 exportaciones');
    expect(err.localized).toBe(true);
    expect(err.code).toBe('ZZ_QUOTA');
    expect(strings.apiError(null).code).toBeNull();
  });

  test('exceptionText: localized passes through, network → could-not-reach, raw only for English', () => {
    const generic = strings.t('error.SERVER_ERROR', 'Something went wrong. Please try again.');
    const reach = strings.t('common.couldNotReach', 'Could not reach server');
    expect(strings.exceptionText(Object.assign(new Error('ya traducido'), { localized: true }))).toBe('ya traducido');
    expect(strings.exceptionText(new TypeError('whatever'))).toBe(reach);
    expect(strings.exceptionText(new Error('Failed to fetch'))).toBe(reach);
    expect(strings.exceptionText(new Error('Specific detail'))).toBe('Specific detail');
    expect(strings.exceptionText(null)).toBe(generic);
    strings.setLocale('es');
    expect(strings.exceptionText(new Error('English detail'), 'btn.cancel')).toBe(strings.t('btn.cancel'));
    expect(strings.exceptionText(new Error('English detail'))).toBe(strings.t('error.SERVER_ERROR', 'Something went wrong. Please try again.'));
    expect(strings.exceptionText({ message: 42 })).toBe(strings.t('error.SERVER_ERROR', 'Something went wrong. Please try again.'));
  });

  test('English with an empty body and the pseudo-locale fall through to the generic message', () => {
    expect(strings.errorText('not an object')).toBe(strings.t('error.SERVER_ERROR', 'Something went wrong. Please try again.'));
    strings.setLocale('qps');
    expect(strings.errorText({ error: 'raw' })).toMatch(/^\[!! /);
  });
});

describe('pseudo-locale (qps)', () => {
  afterEach(() => {
    strings.setLocale('en');
    window.history.replaceState({}, '', '/');
  });

  test('wraps every lookup and renders English, without persisting', () => {
    localStorage.removeItem('att_locale');
    strings.setLocale('qps', true);
    expect(strings.isPseudo()).toBe(true);
    expect(strings.getLocale()).toBe('en');
    expect(strings.t('btn.start')).toBe('[!! Start !!]');
    expect(strings.tf('missing.key', { a: 1 }, 'A={a}')).toBe('[!! A=1 !!]');
    expect(strings.tn('missing.key', 2, null, '{count} x')).toBe('[!! 2 x !!]');
    expect(localStorage.getItem('att_locale')).toBeNull();
  });

  test('switching to a real locale turns it off', () => {
    strings.setLocale('qps');
    strings.setLocale('es');
    expect(strings.isPseudo()).toBe(false);
  });

  test('?lang=qps is detected', () => {
    window.history.replaceState({}, '', '/?lang=qps');
    expect(strings.detectLocale()).toBe('qps');
  });
});

describe('setLocale + fallback chain', () => {
  afterEach(() => strings.setLocale('en'));

  test('unknown locale is ignored (stays on the current one)', () => {
    strings.setLocale('zz');
    expect(strings.getLocale()).toBe('en');
  });

  test('sets documentElement.lang and documentElement.dir correctly for RTL and LTR', () => {
    strings.setLocale('ar');
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');

    strings.setLocale('he');
    expect(document.documentElement.lang).toBe('he');
    expect(document.documentElement.dir).toBe('rtl');

    strings.setLocale('ur');
    expect(document.documentElement.lang).toBe('ur');
    expect(document.documentElement.dir).toBe('rtl');

    strings.setLocale('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');

    strings.setLocale('es');
    expect(document.documentElement.lang).toBe('es');
    expect(document.documentElement.dir).toBe('ltr');
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

    // Swahili
    strings.setLocale('sw');
    expect(strings.t('btn.start')).toBe('Anza');
    expect(strings.t('attendee.present')).toBe('Yupo');

    // Amharic
    strings.setLocale('am');
    expect(strings.t('btn.start')).toBe('ጀምር');
    expect(strings.t('attendee.present')).toBe('ተገኝቷል');

    // Sinhala
    strings.setLocale('si');
    expect(strings.t('btn.start')).toBe('ආරම්භ කරන්න');
    expect(strings.t('attendee.present')).toBe('පැමිණ සිටී');

    // Greek
    strings.setLocale('el');
    expect(strings.t('btn.start')).toBe('Έναρξη');
    expect(strings.t('attendee.present')).toBe('Παρών/Παρούσα');

    // Norwegian
    strings.setLocale('no');
    expect(strings.t('btn.start')).toBe('Start');
    expect(strings.t('attendee.present')).toBe('Tilstede');

    // Catalan
    strings.setLocale('ca');
    expect(strings.t('btn.start')).toBe('Inicia');
    expect(strings.t('attendee.present')).toBe('Present');

    // Nepali
    strings.setLocale('ne');
    expect(strings.t('btn.start')).toBe('सुरु गर्नुहोस्');
    expect(strings.t('attendee.present')).toBe('उपस्थित');

    // Malayalam
    strings.setLocale('ml');
    expect(strings.t('btn.start')).toBe('ആരംഭിക്കുക');
    expect(strings.t('attendee.present')).toBe('ഹാജർ');

    // Mongolian
    strings.setLocale('mn');
    expect(strings.t('btn.start')).toBe('Эхлүүлэх');
    expect(strings.t('attendee.present')).toBe('Ирсэн');
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
    expect(strings.detectLocale('sw-KE')).toBe('sw');
    expect(strings.detectLocale('am-ET')).toBe('am');
    expect(strings.detectLocale('si-LK')).toBe('si');
    expect(strings.detectLocale('el-GR')).toBe('el');
    expect(strings.detectLocale('no-NO')).toBe('no');
    expect(strings.detectLocale('nb-NO')).toBe('no');
    expect(strings.detectLocale('nn-NO')).toBe('no');
    expect(strings.detectLocale('ca-ES')).toBe('ca');
    expect(strings.detectLocale('ne-NP')).toBe('ne');
    expect(strings.detectLocale('ml-IN')).toBe('ml');
    expect(strings.detectLocale('mn-MN')).toBe('mn');
    expect(strings.detectLocale('kn-IN')).toBe('kn');
    expect(strings.detectLocale('gu-IN')).toBe('gu');
    expect(strings.detectLocale('pa-IN')).toBe('pa');
    expect(strings.detectLocale('kk-KZ')).toBe('kk');
    expect(strings.detectLocale('lv-LV')).toBe('lv');
    expect(strings.detectLocale('lt-LT')).toBe('lt');
    expect(strings.detectLocale('lo-LA')).toBe('lo');
    expect(strings.detectLocale('my-MM')).toBe('my');
    expect(strings.detectLocale('km-KH')).toBe('km');
    expect(strings.detectLocale('ceb-PH')).toBe('ceb');
    expect(strings.detectLocale('bg-BG')).toBe('bg');
    expect(strings.detectLocale('hr-HR')).toBe('hr');
    expect(strings.detectLocale('sr-RS')).toBe('sr');
    expect(strings.detectLocale('sk-SK')).toBe('sk');
    expect(strings.detectLocale('sl-SI')).toBe('sl');
    expect(strings.detectLocale('af-ZA')).toBe('af');
    expect(strings.detectLocale('en-US')).toBe('en');
    expect(strings.detectLocale('xx-YY')).toBe('en'); // unknown fallback
  });

  test('resolves country fallback when browser language is English or generic', () => {
    expect(strings.detectLocale('en-MX')).toBe('es');
    expect(strings.detectLocale('en-BR')).toBe('pt');
    expect(strings.detectLocale('en-BD')).toBe('bn');
    expect(strings.detectLocale('en-FR')).toBe('fr');
    expect(strings.detectLocale('en-DE')).toBe('de');
    expect(strings.detectLocale('en', 'CO')).toBe('es');
    expect(strings.detectLocale('en-US', 'MX')).toBe('es');

    window._attCountry = 'MX';
    expect(strings.detectLocale('en-US')).toBe('es');
    window._attCountry = 'BR';
    expect(strings.detectLocale('en-US')).toBe('pt');
    delete window._attCountry;

    window._signupCountry = 'MX';
    expect(strings.detectLocale('en-US')).toBe('es');
    delete window._signupCountry;
  });

  test('newly added paywall, settings, and toast keys exist across locales', () => {
    strings.setLocale('es');
    expect(strings.t('settings.cancelBullet1')).toContain('Sin cargos futuros');
    expect(strings.t('referral.pillOffer')).toBe('Regala 1 mes de Pro · Recibe 1 mes de Pro');
    expect(strings.t('toast.pdfError')).toBe('Error de PDF:');

    strings.setLocale('pt');
    expect(strings.t('settings.cancelBullet1')).toContain('Sem cobranças futuras');
    expect(strings.t('referral.pillOffer')).toBe('Dê 1 mês de Pro · Ganhe 1 mês de Pro');
    expect(strings.t('toast.pdfError')).toBe('Erro no PDF:');

    strings.setLocale('bn');
    expect(strings.t('settings.cancelBullet1')).toContain('ভবিষ্যতে কোনো চার্জ নেই');
    expect(strings.t('referral.pillOffer')).toBe('১ মাস Pro দিন · ১ মাস Pro পান');

    strings.setLocale('en');
    expect(strings.t('settings.cancelBullet1')).toContain('No future charges');
    expect(strings.t('referral.pillOffer')).toBe('Give 1 Month Pro · Get 1 Month Pro');
    expect(strings.t('toast.pdfError')).toBe('PDF error:');
    expect(strings.t('lang.ne')).toBe('नेपाली');
    expect(strings.t('lang.ml')).toBe('മലയാളം');
    expect(strings.t('lang.mn')).toBe('Монгол');
  });

  test('conversion optimization and school license keys exist and are translated across locales', () => {
    const checkKeys = [
      'upgrade.singleMeetingName',
      'upgrade.ctaSingleMeetingNow',
      'upgrade.unlockThisMeetingBadge',
      'upgrade.badgesPH',
      'upgrade.badgesMY',
      'upgrade.badgesID',
      'upgrade.badgesIN',
      'upgrade.badgesDefault',
      'schoolLicense.subtitle',
      'schoolLicense.teacherName',
      'schoolLicense.teacherEmail',
      'schoolLicense.schoolName',
      'schoolLicense.tierLabel',
      'schoolLicense.tierDept',
      'schoolLicense.tierInst',
      'schoolLicense.adminEmail',
      'schoolLicense.submitBtn',
      'schoolLicense.submitting',
      'schoolLicense.success',
      'schoolLicense.error',
    ];

    strings.setLocale('tl');
    expect(strings.t('upgrade.singleMeetingName')).toBe('Pang-isahang Pulong na Pass');
    expect(strings.t('upgrade.badgesPH')).toContain('GCash');

    strings.setLocale('ms');
    expect(strings.t('upgrade.badgesMY')).toContain('GrabPay');

    strings.setLocale('id');
    expect(strings.t('upgrade.badgesID')).toContain('QRIS');

    strings.setLocale('hi');
    expect(strings.t('upgrade.badgesIN')).toContain('UPI');

    for (const loc of strings.getAvailableLocales()) {
      strings.setLocale(loc.code);
      for (const k of checkKeys) {
        const val = strings.t(k);
        expect(typeof val).toBe('string');
        expect(val.trim().length).toBeGreaterThan(0);
        expect(val).not.toBe(k);
      }
    }
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

  test('renderLanguagePicker renders select with all 60 locales and handles selection', () => {
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
    expect(select.children.length).toBe(60);

    // Trigger language switch via picker with history.replaceState and updateUiLanguage callback
    const updateUiSpy = jest.fn();
    window.updateUiLanguage = updateUiSpy;
    select.value = 'es';
    select.dispatchEvent(new Event('change'));
    expect(strings.getLocale()).toBe('es');
    expect(replaceSpy).toHaveBeenCalled();
    expect(updateUiSpy).toHaveBeenCalled();
    delete window.updateUiLanguage;

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

  test('normalizes Chinese and regional query parameters without throwing', () => {
    delete window.location;
    window.location = new URL('https://attendancetracker.dev/?lang=zh-Hant');
    expect(strings.detectLocale()).toBe('zh');

    window.location = new URL('https://attendancetracker.dev/?lang=zh-Hans');
    expect(strings.detectLocale()).toBe('zh-CN');

    window.location = new URL('https://attendancetracker.dev/?lang=zh-TW');
    expect(strings.detectLocale()).toBe('zh');

    window.location = new URL('https://attendancetracker.dev/?lang=pt-BR');
    expect(strings.detectLocale()).toBe('pt');

    window.location = new URL('https://attendancetracker.dev/?lang=es-MX');
    expect(strings.detectLocale()).toBe('es');
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

  test('detects locale from country fallback when language is English or unrecognized', () => {
    expect(strings.detectLocale('en-BR')).toBe('pt');
    expect(strings.detectLocale('en-MX')).toBe('es');
    expect(strings.detectLocale('en-CO')).toBe('es');
    expect(strings.detectLocale('en-BD')).toBe('bn');
    expect(strings.detectLocale('en-FR')).toBe('fr');
    expect(strings.detectLocale('en-DE')).toBe('de');
    expect(strings.detectLocale('en-IT')).toBe('it');
    expect(strings.detectLocale('en', 'ES')).toBe('es');
    expect(strings.detectLocale('en', 'BR')).toBe('pt');
    expect(strings.detectLocale('en-US')).toBe('en');
  });

  test('detects locale from window._attCountry fallback', () => {
    window._attCountry = 'MX';
    try {
      expect(strings.detectLocale('en')).toBe('es');
    } finally {
      delete window._attCountry;
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

  test('updates data-i18n, placeholder, title, aria-label, and alt attributes in DOM', () => {
    document.body.innerHTML = `
      <div id="test-container">
        <button id="start-btn" data-i18n="btn.start">Start</button>
        <input id="search-input" data-i18n-placeholder="btn.filter" placeholder="Filter" />
        <span id="help-icon" data-i18n-title="nav.settings" title="Settings">?</span>
        <button id="settings-btn" data-i18n-aria="nav.settings" aria-label="Settings"></button>
        <img id="demo-img" data-i18n-alt="lp2_video_alt" alt="Demo" />
        <img id="empty-alt-img" data-i18n-alt="" alt="Unchanged" />
        <span id="html-elem" data-i18n="pricing.matrixTeamOursSub">Unlimited</span>
      </div>
    `;

    strings.setLocale('es');
    strings.applyTranslations(document.getElementById('test-container'));

    expect(document.getElementById('start-btn').textContent).toBe('Iniciar');
    expect(document.getElementById('search-input').getAttribute('placeholder')).toBe('Filtrar');
    expect(document.getElementById('help-icon').getAttribute('title')).toBe('Configuración');
    expect(document.getElementById('settings-btn').getAttribute('aria-label')).toBe('Configuración');
    expect(document.getElementById('demo-img').getAttribute('alt')).toBe(strings.t('lp2_video_alt'));
    expect(document.getElementById('empty-alt-img').getAttribute('alt')).toBe('Unchanged');
    expect(document.getElementById('html-elem').innerHTML).toContain('<strong>');
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
  const THRESHOLD = Math.round(nonEn.length * 0.6); // English in >= 60% of the non-en locales (formerly 20 of ~29)

  // Intentionally-identical-across-locales keys:
  //  - lang.* : language names are written in their own language (endonyms),
  //    e.g. lang.es === "Español" in every locale by design.
  //  - brand / product-tier proper nouns kept in English on purpose.
  const isAllowed = (key) =>
    key.startsWith('lang.') ||
    key.startsWith('upgrade.badges') ||      // Regional payment brands (OXXO, GCash, UPI, QRIS, FPX)
    key === 'source.marketplace' ||          // "Workspace Marketplace" (Google product name)
    key === 'ext.title' ||                   // "Attendance Tracker" product title in companion extension
    key === 'pricing.planDomainName' ||      // "Domain Pro" tier — kept as a brand label
    key === 'roster.studentsPlaceholder' ||  // example names/emails — locale-invariant sample text
    key === 'setup.emailPlaceholder' ||      // "admin@yourcompany.com" — example email
    key === 'team.transferPlaceholder' ||    // "teammate@yourdomain.com" — example email
    key === 'team.adminBadge' ||             // "ADMIN" — compact status badge, kept short/uppercase
    key === 'setup.step2Link' ||             // admin.google.com console breadcrumb (URL + exact console labels)
    key === 'quote.emailPlaceholder' ||      // "you@yourschool.edu" — example email
    key === 'badge.pro' ||                   // "Pro" — tier brand label
    key === 'settings.extraEmailsPlaceholder' || // example emails — locale-invariant sample text
    key === 'lp2_cmp_th_us' ||               // "Attendance Tracker" brand name in comparison table header
    key === 'lp2_roster_p1_detail' ||        // "Joined 10:00 · 42m" sample join time in hero mockup
    key === 'lp2_roster_p2_detail' ||        // "Joined 10:01 · 41m" sample join time in hero mockup
    key === 'lp2_roster_p3_detail' ||        // "Joined 10:12 · 30m" sample join time in hero mockup
    key === 'lp2_roster_p3_status' ||        // "Late +12m" sample badge in hero mockup
    key === 'lp2_roster_p4_detail' ||        // "Invited · not joined" sample status in hero mockup
    key === 'lp2_plan_free_price' ||         // "$0" price amount
    key === 'lp2_plan_life_price' ||         // "$9.99" price amount
    key === 'lp2_plan_edu_price' ||          // "$4.99" price amount
    key === 'lp2_plan_school_price' ||       // "From $59" price amount
    key === 'lp2_nav_faq' ||                 // "FAQ" international acronym
    key === 'lp2_sheet_th_min' ||            // "Min" table column abbreviation for duration in minutes
    key === 'btn.exportExcel' ||             // "Excel" — Microsoft Excel product brand name
    key === 'lms.providerClassroom' ||       // "Google Classroom" brand name
    key === 'lms.providerCanvas' ||          // "Canvas LMS" brand name
    key === 'lms.canvasInstancePlaceholder' || // "https://canvas.instructure.com" example URL
    key === 'lp2_sheet_th_status';           // "Status" column header identical in English, German, Dutch, Nordic, Polish, etc.

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

describe('no English-identical value in ANY locale unless reviewed (strict guard)', () => {
  // The 60% threshold above let ~3,000 untranslated (key, locale) pairs slip
  // through (whole landing/history pages English in a dozen locales). This
  // guard is per pair: a value identical to English must be a language
  // endonym or listed in i18n-identical-allowlist.json (reviewed brand names,
  // example emails, and words that really are the same in that language).
  const allow = require('./i18n-identical-allowlist.json');
  const en = strings.STRINGS.en;
  const locales = strings.getAvailableLocales().map(l => l.code).filter(l => l !== 'en');
  const hasWords = (v) => /[A-Za-z]{3,}/.test(String(v).replace(/\{[^}]+\}/g, ''));

  test('every English-identical value is allowlisted', () => {
    const offenders = [];
    for (const key of Object.keys(en)) {
      if (key.startsWith('lang.') || !hasWords(en[key])) continue;
      for (const loc of locales) {
        if (strings.STRINGS[loc][key] === en[key] && !(allow[key] || []).includes(loc)) {
          offenders.push(`${loc}/${key}: "${en[key]}"`);
        }
      }
    }
    // Translate the value — or, if it is genuinely identical in that language,
    // add the locale under the key in i18n-identical-allowlist.json.
    expect(offenders).toEqual([]);
  });

  test('the allowlist has no stale entries (each pair is still identical)', () => {
    const stale = [];
    for (const [key, locs] of Object.entries(allow)) {
      if (key.startsWith('_')) continue;
      for (const loc of locs) {
        if (!strings.STRINGS[loc] || strings.STRINGS[loc][key] !== en[key]) stale.push(`${loc}/${key}`);
      }
    }
    expect(stale).toEqual([]);
  });
});

describe('60-locale number accuracy, placeholder parity, script purity, and HTML metadata', () => {
  const fs = require('fs');
  const rootDir = path.join(__dirname, '..', '..', '..');
  const locales = strings.getAvailableLocales().map(l => l.code);

  test('all 60 locales reflect accurate numbers (60 languages, 27 ratings, 14 reviews, 2 free exports, 25 attendees, $9.99) and placeholders', () => {
    const hasTwo = (s) => /(?:\b2\b|२|২|૨|୨|௨|౨|೨|൨|២|໒|၂|ሁለት|दो|দুই|બે|दो|రెండు|ಎರಡು|രണ്ട്|ពីរ|ສອງ|နှစ်|दो|දෙක|ពីរ|два|две|dva|dvě|dve|du|divi|kaksi|két|two|deux|dos|dois|due|zwei|twee|to|två|dwa|iki|două|δύο|שתי|اثنين|دو)/.test(s);
    const has60 = (s) => /60|६०|৬০|૬૦|୬૦|௬௦|౬౦|೬೦|六十|၆၀/.test(s);
    for (const loc of locales) {
      const dict = strings.STRINGS[loc];
      expect(has60(dict['lp2_proof_4_title'])).toBe(true);
      expect(dict['lp2_reviews_badge']).toMatch(/27|२७|২৭/);
      expect(dict['lp2_reviews_badge']).toMatch(/14|१४|১৪/);
      expect(hasTwo(dict['lp2_plan_free_body'])).toBe(true);
      expect(dict['lp2_plan_free_body']).toMatch(/25|२५|২৫|૨૫|౨౫|೨೫|២៥|໒໕|၂၅/);
      expect(hasTwo(dict['pricing.fineprintBody'])).toBe(true);
      expect(dict['pricing.fineprintBody']).toMatch(/25|२५|২৫|૨૫|౨౫|೨೫|២៥|໒໕|၂၅/);
      expect(dict['pricing.cmp6Body']).toMatch(/9[.,]99|९\.९९|৯\.৯৯/);
      expect(dict['referral.bodyDomain']).toContain('{domain}');
    }
  });

  test('Portuguese and Gujarati strings have no cross-language/script contamination', () => {
    expect(strings.STRINGS.pt['history.participantNotes']).toBe('Notas do anfitrião');
    expect(strings.STRINGS.gu['pricing.matrixBrowsersOther']).not.toMatch(/[\u0C80-\u0CFF]/);
    expect(strings.STRINGS.gu['pricing.matrixBrowsersExt']).not.toMatch(/[\u0C80-\u0CFF]/);
  });

  test('HTML pages with JSON-LD inLanguage and Google Translate includedLanguages list all 60 locales', () => {
    const jsonLdPages = [
      'index.html',
      'pricing.html',
      'privacy.html',
      'refunds.html',
      'student-data-privacy.html',
      'support.html',
      'terms.html',
    ];
    for (const page of jsonLdPages) {
      const html = fs.readFileSync(path.join(rootDir, page), 'utf8');
      for (const loc of locales) {
        if (loc === 'zh') {
          expect(html).toMatch(/"zh(?:-Hant|-TW)?"/);
        } else if (loc === 'zh-CN') {
          expect(html).toMatch(/"zh-(?:CN|Hans)"/);
        } else {
          expect(html).toContain(`"${loc}"`);
        }
      }
    }

    const gtPages = ['privacy.html', 'refunds.html', 'student-data-privacy.html', 'terms.html'];
    for (const page of gtPages) {
      const html = fs.readFileSync(path.join(rootDir, page), 'utf8');
      const m = html.match(/includedLanguages:\s*'([^']+)'/);
      expect(m).not.toBeNull();
      const codes = m[1].split(',');
      expect(codes.length).toBe(60);
    }
  });
});



