// Tests for backend/src/lib/i18n.js
const i18n = require('../../src/lib/i18n');

describe('backend i18n', () => {
  beforeEach(() => {
    i18n._resetCache();
  });

  describe('strictLocale', () => {
    test('maps supported tags, legacy aliases and Chinese scripts; null otherwise', () => {
      expect(i18n.strictLocale('pt-BR')).toBe('pt');
      expect(i18n.strictLocale('es_MX')).toBe('es');
      expect(i18n.strictLocale('fil')).toBe('tl');
      expect(i18n.strictLocale('iw-IL')).toBe('he');
      expect(i18n.strictLocale('in')).toBe('id');
      expect(i18n.strictLocale('nb-NO')).toBe('no');
      expect(i18n.strictLocale('zh-Hans')).toBe('zh-CN');
      expect(i18n.strictLocale('zh-SG')).toBe('zh-CN');
      expect(i18n.strictLocale('zh-TW')).toBe('zh');
      expect(i18n.strictLocale('en-GB')).toBe('en');
      for (const bad of ['klingon', '', '   ', null, 42]) expect(i18n.strictLocale(bad)).toBeNull();
    });
  });

  describe('localeFromRequest', () => {
    const req = (headers) => ({ headers });
    test('header > stored > cookie > Accept-Language > country > en', () => {
      expect(i18n.localeFromRequest(req({ 'x-app-locale': 'de', cookie: 'att_locale=fr' }), { storedLanguage: 'es' })).toBe('de');
      expect(i18n.localeFromRequest(req({ cookie: 'att_locale=fr' }), { storedLanguage: 'es' })).toBe('es');
      expect(i18n.localeFromRequest(req({ cookie: 'a=1; att_locale=fr', 'accept-language': 'ja' }))).toBe('fr');
      expect(i18n.localeFromRequest(req({ 'accept-language': 'ja-JP,ja;q=0.9' }))).toBe('ja');
      expect(i18n.localeFromRequest(req({}), { country: 'BR' })).toBe('pt');
      expect(i18n.localeFromRequest(req({}))).toBe('en');
      expect(i18n.localeFromRequest(null)).toBe('en');
    });
    test('a malformed cookie value is ignored', () => {
      expect(i18n.localeFromRequest(req({ cookie: 'att_locale=%E0%A4%A', 'accept-language': 'ko' }))).toBe('ko');
    });
  });

  describe('tf / tn', () => {
    test('tf fills placeholders and leaves unknown ones', () => {
      expect(i18n.tf('missing.key', 'en', { a: 1 }, 'A={a} B={b}')).toBe('A=1 B={b}');
      expect(i18n.fill(5, { a: 1 })).toBe(5);
      expect(i18n.fill('x', null)).toBe('x');
    });
    test('tn uses CLDR categories with fallback to other / English / fallback', () => {
      const { STRINGS } = i18n.getStrings();
      STRINGS.en['zz.apples.one'] = '{count} apple';
      STRINGS.en['zz.apples.other'] = '{count} apples';
      STRINGS.ru['zz.apples.few'] = '{count} яблока';
      STRINGS.ru['zz.apples.many'] = '{count} яблок';
      expect(i18n.tn('zz.apples', 1, 'en')).toBe('1 apple');
      expect(i18n.tn('zz.apples', 3, 'ru')).toBe('3 яблока');
      expect(i18n.tn('zz.apples', 5, 'ru')).toBe('5 яблок');
      expect(i18n.tn('zz.apples', 1, 'ru')).toBe('1 apple'); // no ru .one/.other → English
      expect(i18n.tn('zz.none', 2, 'fr', null, '{count} things')).toBe('2 things');
      expect(i18n.tn('zz.none', 'x', 'fr')).toBe('zz.none');
    });
    test('tn survives Intl failures', () => {
      const { STRINGS } = i18n.getStrings();
      STRINGS.en['zz.pears.other'] = '{count} pears';
      const realPR = Intl.PluralRules;
      const realNF = Intl.NumberFormat;
      Intl.PluralRules = function () { throw new Error('x'); };
      Intl.NumberFormat = function () { throw new Error('x'); };
      try {
        expect(i18n.tn('zz.pears', 2, 'en')).toBe('2 pears');
      } finally {
        Intl.PluralRules = realPR;
        Intl.NumberFormat = realNF;
      }
    });
  });

  describe('normalizeLocale', () => {
    test('returns "en" for null, undefined, non-string, or unknown locale', () => {
      expect(i18n.normalizeLocale(null)).toBe('en');
      expect(i18n.normalizeLocale(undefined)).toBe('en');
      expect(i18n.normalizeLocale(123)).toBe('en');
      expect(i18n.normalizeLocale('')).toBe('en');
      expect(i18n.normalizeLocale('xx-YY')).toBe('en');
    });

    test('returns country-based fallback in normalizeLocale', () => {
      expect(i18n.normalizeLocale('en-BR')).toBe('pt');
      expect(i18n.normalizeLocale('en-MX')).toBe('es');
      expect(i18n.normalizeLocale('en-BD')).toBe('bn');
      expect(i18n.normalizeLocale('en-FR')).toBe('fr');
      expect(i18n.normalizeLocale(null, 'CO')).toBe('es');
      expect(i18n.normalizeLocale(null, 'BR')).toBe('pt');
      expect(i18n.normalizeLocale(null, 'NP')).toBe('ne');
      expect(i18n.normalizeLocale(null, 'TN')).toBe('ar');
      expect(i18n.normalizeLocale(null, 'JO')).toBe('ar');
      expect(i18n.normalizeLocale(null, 'DZ')).toBe('ar');
      expect(i18n.normalizeLocale(null, 'MA')).toBe('ar');
      expect(i18n.normalizeLocale(null, 'IQ')).toBe('ar');
      expect(i18n.normalizeLocale(null, 'LB')).toBe('ar');
      expect(i18n.normalizeLocale(null, 'RW')).toBe('fr');
      expect(i18n.normalizeLocale(null, 'MN')).toBe('mn');
      expect(i18n.normalizeLocale(null, 'ZA')).toBe('en');
      expect(i18n.normalizeLocale(null, 'BW')).toBe('en');
      expect(i18n.normalizeLocale(null, 'MV')).toBe('en');
      expect(i18n.normalizeLocale('en', ' MN ')).toBe('mn');
      expect(i18n.normalizeLocale('en', ' TN ')).toBe('ar');
      expect(i18n.normalizeLocale('en', ' JO ')).toBe('ar');
      expect(i18n.normalizeLocale(null, 'US')).toBe('en');
    });

    test('maintains 100% parity between backend and frontend COUNTRY_TO_LOCALE tables', () => {
      const feStrings = i18n.getStrings();
      expect(feStrings.COUNTRY_TO_LOCALE).toBeDefined();
      const feKeys = Object.keys(feStrings.COUNTRY_TO_LOCALE);
      expect(feKeys.length).toBeGreaterThan(50);
      for (const c of feKeys) {
        expect(i18n.normalizeLocale(null, c)).toBe(feStrings.COUNTRY_TO_LOCALE[c]);
      }
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
      expect(i18n.normalizeLocale('sw-KE')).toBe('sw');
      expect(i18n.normalizeLocale('am-ET')).toBe('am');
      expect(i18n.normalizeLocale('si-LK')).toBe('si');
      expect(i18n.normalizeLocale('el-GR')).toBe('el');
      expect(i18n.normalizeLocale('nb-NO')).toBe('no');
      expect(i18n.normalizeLocale('nn-NO')).toBe('no');
      expect(i18n.normalizeLocale('ca-ES')).toBe('ca');
      expect(i18n.normalizeLocale('ne-NP')).toBe('ne');
      expect(i18n.normalizeLocale('ml-IN')).toBe('ml');
      expect(i18n.normalizeLocale('mn-MN')).toBe('mn');
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

      const swHeaders = i18n.getSheetHeaders('sw-KE', 'EAT');
      expect(swHeaders[0]).toBe('Jina');
      expect(swHeaders[1]).toBe('Barua pepe');

      const amHeaders = i18n.getSheetHeaders('am-ET', 'EAT');
      expect(amHeaders[0]).toBe('ስም');
      expect(amHeaders[1]).toBe('ኢሜይል');

      const siHeaders = i18n.getSheetHeaders('si-LK', 'IST');
      expect(siHeaders[0]).toBe('නම');
      expect(siHeaders[1]).toBe('විද්‍යුත් තැපෑල');

      const elHeaders = i18n.getSheetHeaders('el-GR', 'EET');
      expect(elHeaders[0]).toBe('Όνομα');
      expect(elHeaders[1]).toBe('Email');

      const noHeaders = i18n.getSheetHeaders('nb-NO', 'CET');
      expect(noHeaders[0]).toBe('Navn');
      expect(noHeaders[1]).toBe('E-post');

      const hiHeaders = i18n.getSheetHeaders('hi-IN', 'IST');
      expect(hiHeaders[0]).toBe('नाम');
      expect(hiHeaders[1]).toBe('ईमेल');

      const bnHeaders = i18n.getSheetHeaders('bn-BD', 'BST');
      expect(bnHeaders[0]).toBe('নাম');
      expect(bnHeaders[1]).toBe('ইমেইল');

      const itHeaders = i18n.getSheetHeaders('it-IT', 'CET');
      expect(itHeaders[0]).toBe('Nome');
      expect(itHeaders[1]).toBe('Email');

      const nlHeaders = i18n.getSheetHeaders('nl-NL', 'CET');
      expect(nlHeaders[0]).toBe('Naam');
      expect(nlHeaders[1]).toBe('E-mail');

      const jaHeaders = i18n.getSheetHeaders('ja-JP', 'JST');
      expect(jaHeaders[0]).toBe('氏名');
      expect(jaHeaders[1]).toBe('メールアドレス');

      const caHeaders = i18n.getSheetHeaders('ca-ES', 'CET');
      expect(caHeaders[0]).toBe('Nom');
      expect(caHeaders[1]).toBe('Correu electrònic');
 
      const neHeaders = i18n.getSheetHeaders('ne-NP', 'NPT');
      expect(neHeaders[0]).toBe('नाम');
      expect(neHeaders[1]).toBe('इमेल');

      const mlHeaders = i18n.getSheetHeaders('ml-IN', 'IST');
      expect(mlHeaders[0]).toBe('പേര്');
      expect(mlHeaders[1]).toBe('ഇമെയിൽ');

      const mnHeaders = i18n.getSheetHeaders('mn-MN', 'ULAT');
      expect(mnHeaders[0]).toBe('Нэр');
      expect(mnHeaders[1]).toBe('Имэйл');
    });
  });

  describe('getSheetSummaryLabels', () => {
    test('returns default English summary labels for en or unknown locale', () => {
      expect(i18n.getSheetSummaryLabels('en').meeting).toBe('Meeting');
      expect(i18n.getSheetSummaryLabels('unknown').date).toBe('Date');
    });

    test('returns localized summary labels for pt, es, fr, de', () => {
      expect(i18n.getSheetSummaryLabels('pt').meeting).toBe('Reunião');
      expect(i18n.getSheetSummaryLabels('pt').attendanceRate).toBe('Taxa de Presença');
      expect(i18n.getSheetSummaryLabels('es').meeting).toBe('Reunión');
      expect(i18n.getSheetSummaryLabels('fr').meeting).toBe('Réunion');
      expect(i18n.getSheetSummaryLabels('de').scheduledEvent).toBe('Geplantes Ereignis');
      expect(i18n.getSheetSummaryLabels('hi').meeting).toBe('मीटिंग');
      expect(i18n.getSheetSummaryLabels('bn').meeting).toBe('মিটিং');
      expect(i18n.getSheetSummaryLabels('ja').meeting).toBe('ミーティング');
      expect(i18n.getSheetSummaryLabels('ne').meeting).toBe('बैठक');
      expect(i18n.getSheetSummaryLabels('ml').meeting).toBe('മീറ്റിംഗ്');
      expect(i18n.getSheetSummaryLabels('mn').meeting).toBe('Уулзалт');
    });
  });

  describe('localizeStatus', () => {
    test('returns unchanged status for English or missing locale', () => {
      expect(i18n.localizeStatus('Present', 'en')).toBe('Present');
      expect(i18n.localizeStatus('', 'es')).toBe('');
      expect(i18n.localizeStatus('Present', null)).toBe('Present');
    });

    test('localizes statuses into pt, es, fr, de', () => {
      expect(i18n.localizeStatus('Present', 'pt')).toBe('Presente');
      expect(i18n.localizeStatus('Left', 'pt')).toBe('Saiu');
      expect(i18n.localizeStatus('Absent', 'pt')).toBe('Ausente');
      expect(i18n.localizeStatus('Absent (excused)', 'pt')).toBe('Ausente (justificado)');
      expect(i18n.localizeStatus('Left Early / Incomplete', 'pt')).toBe('Saiu antes / Incompleto');
      expect(i18n.localizeStatus('Left', 'es')).toBe('Salió');
      expect(i18n.localizeStatus('Present', 'de')).toBe('Anwesend');
      expect(i18n.localizeStatus('Present', 'hi')).toBe('उपस्थित');
      expect(i18n.localizeStatus('Present', 'bn')).toBe('উপস্থিত');
      expect(i18n.localizeStatus('Present', 'ja')).toBe('出席');
      expect(i18n.localizeStatus('Present', 'ne')).toBe('उपस्थित');
      expect(i18n.localizeStatus('Present', 'ml')).toBe('ഹാജർ');
      expect(i18n.localizeStatus('Present', 'mn')).toBe('Ирсэн');
      expect(i18n.localizeStatus('Unmapped Custom Status', 'pt')).toBe('Unmapped Custom Status');
    });
  });

  describe('localizeRsvp', () => {
    test('returns English RSVP for en or unknown', () => {
      expect(i18n.localizeRsvp('accepted', 'en')).toBe('Accepted');
      expect(i18n.localizeRsvp('declined', 'en')).toBe('Declined');
      expect(i18n.localizeRsvp('tentative', 'en')).toBe('Tentative');
      expect(i18n.localizeRsvp('needsAction', 'en')).toBe('No Response');
      expect(i18n.localizeRsvp('unknown_status', 'en')).toBe('');
      expect(i18n.localizeRsvp('', 'pt')).toBe('');
    });

    test('localizes RSVP into target languages', () => {
      expect(i18n.localizeRsvp('accepted', 'pt')).toBe('Aceito');
      expect(i18n.localizeRsvp('declined', 'pt')).toBe('Recusado');
      expect(i18n.localizeRsvp('tentative', 'es')).toBe('Provisional');
      expect(i18n.localizeRsvp('needsAction', 'de')).toBe('Keine Antwort');
      expect(i18n.localizeRsvp('accepted', 'hi')).toBe('स्वीकार किया');
      expect(i18n.localizeRsvp('accepted', 'bn')).toBe('গৃহীত');
      expect(i18n.localizeRsvp('accepted', 'ja')).toBe('承諾');
      expect(i18n.localizeRsvp('accepted', 'ne')).toBe('स्वीकार गरियो');
      expect(i18n.localizeRsvp('accepted', 'ml')).toBe('സ്വീകരിച്ചു');
      expect(i18n.localizeRsvp('accepted', 'mn')).toBe('Зөвшөөрсөн');
    });
  });

  describe('getPdfLabels', () => {
    test('returns default English labels for en or unknown locale', () => {
      const en = i18n.getPdfLabels('en');
      expect(en.reportTitle).toBe('Attendance Report');
      expect(en.columns.joined).toBe('Joined');
      expect(en.summaryFormat(5, 10)).toBe('5 of 10 recorded as present');
    });

    test('returns localized labels for pt, es, fr, de', () => {
      const pt = i18n.getPdfLabels('pt');
      expect(pt.reportTitle).toBe('Relatório de Presença');
      expect(pt.dateLabel).toBe('Data');
      expect(pt.columns.joined).toBe('Entrada');
      expect(pt.summaryFormat(5, 10)).toBe('5 de 10 registrados como presentes');

      const es = i18n.getPdfLabels('es');
      expect(es.reportTitle).toBe('Informe de Asistencia');
      expect(es.columns.status).toBe('Estado');

      const nl = i18n.getPdfLabels('nl');
      expect(nl.reportTitle).toBe('Aanwezigheidsrapport');
      expect(nl.columns.joined).toBe('Deelgenomen');

      const pl = i18n.getPdfLabels('pl');
      expect(pl.reportTitle).toBe('Raport obecności');

      const ru = i18n.getPdfLabels('ru');
      expect(ru.reportTitle).toBe('Отчёт о присутствии');

      const tr = i18n.getPdfLabels('tr');
      expect(tr.reportTitle).toBe('Yoklama Raporu');

      const vi = i18n.getPdfLabels('vi');
      expect(vi.reportTitle).toBe('Báo cáo điểm danh');

      const cs = i18n.getPdfLabels('cs');
      expect(cs.reportTitle).toBe('Zpráva o docházce');

      const da = i18n.getPdfLabels('da');
      expect(da.reportTitle).toBe('Deltagerrapport');

      const sv = i18n.getPdfLabels('sv');
      expect(sv.reportTitle).toBe('Närvarorapport');

      const el = i18n.getPdfLabels('el');
      expect(el.reportTitle).toBe('Αναφορά παρουσιών');

      const ca = i18n.getPdfLabels('ca');
      expect(ca.reportTitle).toBe("Informe d'assistència");
 
      const ne = i18n.getPdfLabels('ne');
      expect(ne.reportTitle).toBe('उपस्थिति प्रतिवेदन');
      expect(ne.columns.name).toBe('नाम');
      expect(ne.columns.status).toBe('स्थिति');
      expect(ne.summaryFormat(5, 10)).toBe('5 / 10 उपस्थितको रूपमा दर्ता गरियो');

      const ml = i18n.getPdfLabels('ml');
      expect(ml.reportTitle).toBe('ഹാജർ റിപ്പോർട്ട്');
      expect(ml.columns.name).toBe('പേര്');
      expect(ml.columns.status).toBe('സ്റ്റാറ്റസ്');
      expect(ml.summaryFormat(5, 10)).toBe('10-ൽ 5 പേർ ഹാജരായി രേഖപ്പെടുത്തി');

      const mn = i18n.getPdfLabels('mn');
      expect(mn.reportTitle).toBe('Ирцийн тайлан');
      expect(mn.columns.name).toBe('Нэр');
      expect(mn.columns.status).toBe('Төлөв');
      expect(mn.summaryFormat(5, 10)).toBe('10-аас 5 оролцогч ирснээр бүртгэгдсэн');
    });

    test('returns localized summary labels for Asian, European, and Middle Eastern locales', () => {
      const pl = i18n.getSheetSummaryLabels('pl');
      expect(pl.meeting).toBe('Spotkanie');
      expect(pl.attendanceRate).toBe('Wskaźnik obecności');

      const vi = i18n.getSheetSummaryLabels('vi');
      expect(vi.meeting).toBe('Cuộc họp');

      const id = i18n.getSheetSummaryLabels('id');
      expect(id.meeting).toBe('Rapat');

      const ko = i18n.getSheetSummaryLabels('ko');
      expect(ko.meeting).toBe('회의');

      const ar = i18n.getSheetSummaryLabels('ar');
      expect(ar.meeting).toBe('اجتماع');

      const th = i18n.getSheetSummaryLabels('th');
      expect(th.meeting).toBe('การประชุม');
    });

    test('localizes status across newly added European and Asian locales', () => {
      expect(i18n.localizeStatus('Present', 'ru')).toBe('Присутствовал');
      expect(i18n.localizeStatus('Absent', 'ru')).toBe('Отсутствовал');
      expect(i18n.localizeStatus('Present', 'tr')).toBe('Katıldı');
      expect(i18n.localizeStatus('Present', 'vi')).toBe('Có mặt');
      expect(i18n.localizeStatus('Present', 'id')).toBe('Hadir');
      expect(i18n.localizeStatus('Present', 'pl')).toBe('Obecny');
      expect(i18n.localizeStatus('Present', 'ko')).toBe('출석');
      expect(i18n.localizeStatus('Present', 'ar')).toBe('حاضر');
    });

    test('localizes RSVP responses across newly added European and Asian locales', () => {
      expect(i18n.localizeRsvp('accepted', 'ru')).toBe('Принято');
      expect(i18n.localizeRsvp('declined', 'ru')).toBe('Отклонено');
      expect(i18n.localizeRsvp('accepted', 'tr')).toBe('Kabul edildi');
      expect(i18n.localizeRsvp('accepted', 'vi')).toBe('Đã chấp nhận');
      expect(i18n.localizeRsvp('accepted', 'id')).toBe('Diterima');
      expect(i18n.localizeRsvp('accepted', 'pl')).toBe('Zaakceptowano');
      expect(i18n.localizeRsvp('accepted', 'ko')).toBe('수락됨');
      expect(i18n.localizeRsvp('accepted', 'ar')).toBe('تم القبول');
    });
  });

  describe('getStrings caching', () => {
    test('reuses cached instance on repeated calls', () => {
      const s1 = i18n.getStrings();
      const s2 = i18n.getStrings();
      expect(s1).toBe(s2);
    });
  });

  describe('all supported locales coverage', () => {
    test('getPdfLabels summaryFormat, getSheetHeaders, getSheetSummaryLabels, localizeStatus, and localizeRsvp work across all 60 locales', () => {
      const locales = Object.keys(i18n.getStrings().STRINGS || {});
      expect(locales.length).toBeGreaterThanOrEqual(48);
      for (const loc of locales) {
        const pdf = i18n.getPdfLabels(loc);
        expect(typeof pdf.reportTitle).toBe('string');
        expect(typeof pdf.summaryFormat(5, 10)).toBe('string');
        expect(pdf.summaryFormat(5, 10)).toContain('5');
        expect(pdf.summaryFormat(5, 10)).toContain('10');

        const headers = i18n.getSheetHeaders(loc, 'UTC');
        expect(Array.isArray(headers)).toBe(true);
        expect(headers.length).toBeGreaterThanOrEqual(6);
        const headersNoTz = i18n.getSheetHeaders(loc);
        expect(Array.isArray(headersNoTz)).toBe(true);

        const summary = i18n.getSheetSummaryLabels(loc);
        expect(typeof summary.meeting).toBe('string');

        for (const st of ['Present', 'Left', 'Absent', 'Excused', 'Absent (excused)', 'Left Early / Incomplete']) {
          expect(typeof i18n.localizeStatus(st, loc)).toBe('string');
        }
        for (const rv of ['accepted', 'declined', 'tentative', 'needsAction']) {
          expect(typeof i18n.localizeRsvp(rv, loc)).toBe('string');
        }

        const cert = i18n.getCertLabels(loc);
        expect(typeof cert.certTitle).toBe('string');
        expect(cert.onDate('2026-10-01')).toContain('2026-10-01');
        expect(cert.forDuration('45m')).toContain('45m');
        expect(cert.creditHours(1)).toContain('1');
        expect(cert.creditHours(2)).toContain('2');
      }
    });
  });
});
