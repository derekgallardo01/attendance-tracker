import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const backendI18n = require('../backend/src/lib/i18n.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const utilsFile = path.join(ROOT, 'js', 'utils.js');

export function expandUtilsLocales() {
  const LOCALIZED_HEADERS = backendI18n.LOCALIZED_HEADERS || {};
  const STATUS_TRANSLATIONS = backendI18n.STATUS_TRANSLATIONS || {};
  const LOCALES = backendI18n.getStrings().LOCALES || [];

  // Existing 5 languages in CSV_HEADER_LOCALIZATIONS to preserve exact phrasing
  const existingHeaders = {
    pt: ['Nome', 'E-mail', 'Status', '% Presença', 'Duração (min)', 'Horário de Entrada', 'Horário de Saída', 'Reconexões', 'Notas'],
    es: ['Nombre', 'Correo', 'Estado', '% Asistencia', 'Duración (min)', 'Hora de Entrada', 'Hora de Salida', 'Reingresos', 'Notas'],
    fr: ['Nom', 'E-mail', 'Statut', '% Présence', 'Durée (min)', 'Heure d\'Arrivée', 'Heure de Départ', 'Reconnexions', 'Remarques'],
    de: ['Name', 'E-Mail', 'Status', 'Anwesenheit %', 'Dauer (Min.)', 'Beitrittszeit', 'Verlassenszeit', 'Wiedereintritte', 'Notizen'],
    it: ['Nome', 'E-mail', 'Stato', '% Presenze', 'Durata (min)', 'Ora di Entrata', 'Ora di Uscita', 'Riconnessioni', 'Note'],
  };

  const existingStatuses = {
    pt: {
      'Present': 'Presente',
      'Left': 'Saiu',
      'Present (Left)': 'Presente (Saiu)',
      'Left Early / Incomplete': 'Saiu antes / Incompleto',
      'Late': 'Atrasado',
      'Excused (Short Stay)': 'Justificado (Estadia curta)',
      'Absent': 'Ausente',
      'Absent (Excused)': 'Ausente (Justificado)',
      'Guest (Present)': 'Convidado (Presente)',
      'Guest (Left)': 'Convidado (Saiu)',
    },
    es: {
      'Present': 'Presente',
      'Left': 'Salió',
      'Present (Left)': 'Presente (Salió)',
      'Left Early / Incomplete': 'Salió antes / Incompleto',
      'Late': 'Tarde',
      'Excused (Short Stay)': 'Justificado (Estadía corta)',
      'Absent': 'Ausente',
      'Absent (Excused)': 'Ausente (Justificado)',
      'Guest (Present)': 'Invitado (Presente)',
      'Guest (Left)': 'Invitado (Salió)',
    },
    fr: {
      'Present': 'Présent',
      'Left': 'Parti',
      'Present (Left)': 'Présent (Parti)',
      'Left Early / Incomplete': 'Parti plus tôt / Incomplet',
      'Late': 'En retard',
      'Excused (Short Stay)': 'Excusé (Court séjour)',
      'Absent': 'Absent',
      'Absent (Excused)': 'Absent (Excusé)',
      'Guest (Present)': 'Invité (Présent)',
      'Guest (Left)': 'Invité (Parti)',
    },
    de: {
      'Present': 'Anwesend',
      'Left': 'Verlassen',
      'Present (Left)': 'Anwesend (Verlassen)',
      'Left Early / Incomplete': 'Frühzeitig verlassen / Unvollständig',
      'Late': 'Verspätet',
      'Excused (Short Stay)': 'Entschuldigt (Kurzer Aufenthalt)',
      'Absent': 'Abwesend',
      'Absent (Excused)': 'Abwesend (Entschuldigt)',
      'Guest (Present)': 'Gast (Anwesend)',
      'Guest (Left)': 'Gast (Verlassen)',
    },
    it: {
      'Present': 'Presente',
      'Left': 'Uscito',
      'Present (Left)': 'Presente (Uscito)',
      'Left Early / Incomplete': 'Uscito prima / Incompleto',
      'Late': 'In ritardo',
      'Excused (Short Stay)': 'Giustificato (Breve permanenza)',
      'Absent': 'Assente',
      'Absent (Excused)': 'Assente (Giustificato)',
      'Guest (Present)': 'Ospite (Presente)',
      'Guest (Left)': 'Ospite (Uscito)',
    },
  };

  const extraColsMap = {
    es: { notes: 'Notas', attended: 'Asistió', missed: 'Ausente', totalMinutes: 'Minutos totales' },
    pt: { notes: 'Notas', attended: 'Compareceu', missed: 'Ausente', totalMinutes: 'Minutos totais' },
    hi: { notes: 'नोट्स', attended: 'उपस्थित', missed: 'अनुपस्थित', totalMinutes: 'कुल मिनट' },
    tl: { notes: 'Mga Tala', attended: 'Dumalo', missed: 'Lumiban', totalMinutes: 'Kabuuang minuto' },
    ms: { notes: 'Nota', attended: 'Hadir', missed: 'Tidak hadir', totalMinutes: 'Jumlah minit' },
    id: { notes: 'Catatan', attended: 'Hadir', missed: 'Tidak hadir', totalMinutes: 'Total menit' },
    vi: { notes: 'Ghi chú', attended: 'Đã tham dự', missed: 'Vắng mặt', totalMinutes: 'Tổng số phút' },
    fr: { notes: 'Remarques', attended: 'Présent', missed: 'Absent', totalMinutes: 'Minutes totales' },
    de: { notes: 'Notizen', attended: 'Anwesend', missed: 'Abwesend', totalMinutes: 'Gesamtminuten' },
    it: { notes: 'Note', attended: 'Presente', missed: 'Assente', totalMinutes: 'Minuti totali' },
    nl: { notes: 'Notities', attended: 'Aanwezig', missed: 'Gemist', totalMinutes: 'Totale minuten' },
    pl: { notes: 'Notatki', attended: 'Obecny', missed: 'Nieobecny', totalMinutes: 'Łączna liczba minut' },
    ro: { notes: 'Note', attended: 'Prezent', missed: 'Absent', totalMinutes: 'Total minute' },
    ru: { notes: 'Заметки', attended: 'Присутствовал', missed: 'Пропущено', totalMinutes: 'Всего минут' },
    uk: { notes: 'Нотатки', attended: 'Присутній', missed: 'Пропущено', totalMinutes: 'Усього хвилин' },
    tr: { notes: 'Notlar', attended: 'Katıldı', missed: 'Katılmadı', totalMinutes: 'Toplam dakika' },
    th: { notes: 'หมายเหตุ', attended: 'เข้าร่วม', missed: 'ขาด', totalMinutes: 'นาทีทั้งหมด' },
    ar: { notes: 'ملاحظات', attended: 'حضر', missed: 'غاب', totalMinutes: 'إجمالي الدقائق' },
    ko: { notes: '메모', attended: '참석', missed: '결석', totalMinutes: '총 시간(분)' },
    zh: { notes: '備註', attended: '已出席', missed: '缺席', totalMinutes: '總分鐘數' },
    'zh-CN': { notes: '备注', attended: '已出席', missed: '缺席', totalMinutes: '总分钟数' },
    ja: { notes: 'メモ', attended: '出席', missed: '欠席', totalMinutes: '合計時間（分）' },
    he: { notes: 'הערות', attended: 'נכח', missed: 'נעדר', totalMinutes: 'סה"כ דקות' },
    mr: { notes: 'नोंदी', attended: 'उपस्थित', missed: 'अनुपस्थित', totalMinutes: 'एकूण मिनिटे' },
    sv: { notes: 'Anteckningar', attended: 'Närvarande', missed: 'Frånvarande', totalMinutes: 'Totalt antal minuter' },
    cs: { notes: 'Poznámky', attended: 'Přítomen', missed: 'Zmeškáno', totalMinutes: 'Celkem minut' },
    da: { notes: 'Noter', attended: 'Deltog', missed: 'Fraværende', totalMinutes: 'Minutter i alt' },
    fi: { notes: 'Muistiinpanot', attended: 'Osallistui', missed: 'Poissa', totalMinutes: 'Kokonaisminuutit' },
    hu: { notes: 'Jegyzetek', attended: 'Részt vett', missed: 'Hiányzott', totalMinutes: 'Összes perc' },
    so: { notes: 'Qoraallo', attended: 'Ka qaybgalay', missed: 'Maqnaa', totalMinutes: 'Wadarta daqiiqadaha' },
    sw: { notes: 'Maelezo', attended: 'Alihudhuria', missed: 'Alikosa', totalMinutes: 'Jumla ya dakika' },
    am: { notes: 'ማስታወሻዎች', attended: 'ተገኝቷል', missed: 'ቀርቷል', totalMinutes: 'ጠቅላላ ደቂቃዎች' },
    si: { notes: 'සටහන්', attended: 'සහභාගී විය', missed: 'මඟ හැරුණි', totalMinutes: 'මුළු මිනිත්තු' },
    el: { notes: 'Σημειώσεις', attended: 'Παρακολούθησε', missed: 'Απουσίασε', totalMinutes: 'Συνολικά λεπτά' },
    no: { notes: 'Notater', attended: 'Deltok', missed: 'Fravær', totalMinutes: 'Totalt antall minutter' },
    ca: { notes: 'Notes', attended: 'Ha assistit', missed: 'Absent', totalMinutes: 'Minuts totals' },
    ne: { notes: 'टिप्पणीहरू', attended: 'उपस्थित', missed: 'अनुपस्थित', totalMinutes: 'कुल मिनेट' },
    ml: { notes: 'കുറിപ്പുകൾ', attended: 'പങ്കെടുത്തു', missed: 'ഹാജരായില്ല', totalMinutes: 'ആകെ മിനിറ്റുകൾ' },
    mn: { notes: 'Тэмдэглэл', attended: 'Оролцсон', missed: 'Тасалсан', totalMinutes: 'Нийт минут' },
    bn: { notes: 'নোট', attended: 'উপস্থিত', missed: 'অনুপস্থিত', totalMinutes: 'মোট মিনিট' },
    ta: { notes: 'குறிப்புகள்', attended: 'கலந்துகொண்டது', missed: 'தவறியது', totalMinutes: 'மொத்த நிமிடங்கள்' },
    te: { notes: 'గమనికలు', attended: 'హాజరైనవి', missed: 'హాజరుకానివి', totalMinutes: 'మొత్తం నిమిషాలు' },
    ur: { notes: 'نوٹس', attended: 'حاضر', missed: 'غیر حاضر', totalMinutes: 'کل منٹ' },
    fa: { notes: 'یادداشت‌ها', attended: 'حاضر', missed: 'غایب', totalMinutes: 'مجموع دقایق' },
    af: { notes: 'Notas', attended: 'Bygewoon', missed: 'Gemis', totalMinutes: 'Totale minute' },
    bg: { notes: 'Бележки', attended: 'Присъствал', missed: 'Пропуснал', totalMinutes: 'Общо минути' },
    hr: { notes: 'Bilješke', attended: 'Prisustvovao', missed: 'Izostao', totalMinutes: 'Ukupno minuta' },
    sr: { notes: 'Белешке', attended: 'Присуствовао', missed: 'Изостао', totalMinutes: 'Укупно минута' },
    sk: { notes: 'Poznámky', attended: 'Zúčastnil sa', missed: 'Vynechal', totalMinutes: 'Celkovo minút' },
    sl: { notes: 'Opombe', attended: 'Prisoten', missed: 'Odsoten', totalMinutes: 'Skupaj minut' },
    lv: { notes: 'Piezīmes', attended: 'Apmeklēja', missed: 'Neapmeklēja', totalMinutes: 'Kopā minūtes' },
    lt: { notes: 'Pastabos', attended: 'Dalyvavo', missed: 'Praleido', totalMinutes: 'Iš viso minučių' },
    et: { notes: 'Märkmed', attended: 'Osales', missed: 'Puudus', totalMinutes: 'Kokku minuteid' },
    ceb: { notes: 'Mga Nota', attended: 'Mitambong', missed: 'Palta', totalMinutes: 'Kinatibuk-ang minuto' },
    kk: { notes: 'Ескертпелер', attended: 'Қатысты', missed: 'Қатыспады', totalMinutes: 'Барлық минуттар' },
    lo: { notes: 'ໝາຍເຫດ', attended: 'ເຂົ້າຮ່ວມ', missed: 'ຂາດ', totalMinutes: 'ນາທີທັງໝົດ' },
    my: { notes: 'မှတ်စုများ', attended: 'တက်ရောက်ခဲ့သည်', missed: 'ပျက်ကွက်ခဲ့သည်', totalMinutes: 'စုစုပေါင်း မိနစ်' },
    km: { notes: 'កំណត់សម្គាល់', attended: 'បានចូលរួម', missed: 'អវត្តមាន', totalMinutes: 'នាទីសរុប' },
    kn: { notes: 'ಟಿಪ್ಪಣಿಗಳು', attended: 'ಹಾಜರಾಗಿದ್ದಾರೆ', missed: 'ಗೈರುಹಾಜರಾಗಿದ್ದಾರೆ', totalMinutes: 'ಒಟ್ಟು ನಿಮಿಷಗಳು' },
    gu: { notes: 'નોંધો', attended: 'હાજર', missed: 'ગેરહાજર', totalMinutes: 'કુલ મિનિટ' },
    pa: { notes: 'ਨੋਟਸ', attended: 'ਹਾਜ਼ਰ', missed: 'ਗੈਰ-ਹਾਜ਼ਰ', totalMinutes: 'ਕੁੱਲ ਮਿੰਟ' },
  };

  const headerDict = {};
  const statusDict = {};

  for (const locObj of LOCALES) {
    const loc = locObj.code;
    if (loc === 'en') continue;
    const h = LOCALIZED_HEADERS[loc] || LOCALIZED_HEADERS['en'] || {};
    const s = STATUS_TRANSLATIONS[loc] || STATUS_TRANSLATIONS['en'] || {};
    const ex = extraColsMap[loc] || {};

    // 1. Build header list
    let cols;
    if (existingHeaders[loc]) {
      cols = [...existingHeaders[loc]];
    } else {
      cols = [
        h.name || 'Name',
        h.email || 'Email',
        h.status || 'Status',
        h.pct || 'Attendance %',
        h.duration || 'Duration (min)',
        h.joinTime || 'Join Time',
        h.leaveTime || 'Leave Time',
        h.sessions || 'Rejoins',
        ex.notes || 'Notes'
      ];
    }

    // Attach meeting & series sub-headers
    const rsvp = h.rsvp || 'Calendar RSVP';
    const attended = ex.attended || 'Attended';
    const missed = ex.missed || 'Missed';
    const totalMinutes = ex.totalMinutes || 'Total minutes';

    const meetingHeaders = [
      h.name || cols[0],
      h.email || cols[1],
      h.status || cols[2],
      rsvp,
      h.joinTime || cols[5],
      h.leaveTime || cols[6],
      h.duration || cols[4],
    ];

    const seriesHeaders = [
      h.name || cols[0],
      h.email || cols[1],
      attended,
      missed,
      h.pct || cols[3],
      totalMinutes,
    ];

    headerDict[loc] = {
      cols,
      meeting: meetingHeaders,
      series: seriesHeaders,
      checkedIn: `${h.checkedIn} `,
    };

    if (existingStatuses[loc]) {
      statusDict[loc] = {
        ...existingStatuses[loc],
        'Absent (excused)': existingStatuses[loc]['Absent (Excused)'],
      };
    } else {
      // 2. Build status dictionary
      const stPresent = s['Present'] || 'Present';
      const stLeft = s['Left'] || 'Left';
      const stAbsent = s['Absent'] || 'Absent';
      const stLate = s['Late'] || 'Late';
      const stPresentLeft = s['Present (Left)'] || `${stPresent} (${stLeft})`;
      const stLeftEarly = s['Left Early / Incomplete'] || 'Left Early / Incomplete';
      const stExcused = s['Excused (Short Stay)'] || 'Excused (Short Stay)';
      const stAbsentExcused = s['Absent (excused)'] || s['Absent (Excused)'] || `${stAbsent} (${stExcused.split(' ')[0]})`;
      const stGuestPresent = s['Guest (Present)'] || `Guest (${stPresent})`;
      const stGuestLeft = s['Guest (Left)'] || `Guest (${stLeft})`;

      statusDict[loc] = {
        'Present': stPresent,
        'Left': stLeft,
        'Present (Left)': stPresentLeft,
        'Left Early / Incomplete': stLeftEarly,
        'Late': stLate,
        'Excused (Short Stay)': stExcused,
        'Absent': stAbsent,
        'Absent (Excused)': stAbsentExcused,
        'Absent (excused)': stAbsentExcused,
        'Guest (Present)': stGuestPresent,
        'Guest (Left)': stGuestLeft,
      };
    }
  }

  // Generate JS code for CSV_HEADER_LOCALIZATIONS and CSV_STATUS_LOCALIZATIONS
  const headerCodeLines = ['  const CSV_HEADER_LOCALIZATIONS = {'];
  for (const [loc, data] of Object.entries(headerDict)) {
    const colsJson = JSON.stringify(data.cols);
    const meetingJson = JSON.stringify(data.meeting);
    const seriesJson = JSON.stringify(data.series);
    const checkedInJson = JSON.stringify(data.checkedIn);
    headerCodeLines.push(`    ${JSON.stringify(loc)}: Object.assign(${colsJson}, { meeting: ${meetingJson}, series: ${seriesJson}, checkedIn: ${checkedInJson} }),`);
  }
  headerCodeLines.push('  };');
  const newHeaderCode = headerCodeLines.join('\n');

  const statusJson = JSON.stringify(statusDict, null, 2)
    .split('\n')
    .map(line => '  ' + line)
    .join('\n');
  const newStatusCode = `  const CSV_STATUS_LOCALIZATIONS = ${statusJson.trim()};`;

  let content = fs.readFileSync(utilsFile, 'utf8');

  // Replace CSV_HEADER_LOCALIZATIONS and CSV_STATUS_LOCALIZATIONS
  const startHeadersIdx = content.indexOf('  const CSV_HEADER_LOCALIZATIONS = {');
  const funcIdx = content.indexOf('  function buildAttendanceCsv', startHeadersIdx);

  if (startHeadersIdx === -1 || funcIdx === -1) {
    throw new Error('Could not find CSV_HEADER_LOCALIZATIONS block in js/utils.js');
  }

  const replacement = `${newHeaderCode}\n\n${newStatusCode}\n\n`;
  content = content.slice(0, startHeadersIdx) + replacement + content.slice(funcIdx);

  // Ensure CSV_HEADER_LOCALIZATIONS and CSV_STATUS_LOCALIZATIONS are exported on api object
  if (!content.includes('CSV_HEADER_LOCALIZATIONS, CSV_STATUS_LOCALIZATIONS')) {
    content = content.replace(
      'buildCanvasGradebookCsv, escapeCsv, escapeXml,',
      'buildCanvasGradebookCsv, escapeCsv, escapeXml,\n    CSV_HEADER_LOCALIZATIONS, CSV_STATUS_LOCALIZATIONS,'
    );
  }

  // Ensure t() helper is present for localization
  if (!content.includes('function t(key, fallback) {')) {
    content = content.replace(
      /'use strict';\r?\n/,
      "'use strict';\r\n\r\n  function t(key, fallback) {\r\n    if (typeof root !== 'undefined' && typeof root.t === 'function') {\r\n      return root.t(key, fallback);\r\n    }\r\n    return fallback;\r\n  }\r\n"
    );
  }

  // Ensure resolveCsvLocale() helper is present for zh-CN vs zh resolution
  if (!content.includes('function resolveCsvLocale(raw) {')) {
    content = content.replace(
      /function t\(key, fallback\) \{[\s\S]*?return fallback;\r?\n  \}/,
      (m) => m + "\r\n\r\n  function resolveCsvLocale(raw) {\r\n    const s = String(raw || 'en');\r\n    if (CSV_HEADER_LOCALIZATIONS[s]) return s;\r\n    if (/^zh[-_](?:cn|hans|sg)\\b/i.test(s)) return 'zh-CN';\r\n    return s.split(/[-_]/)[0].toLowerCase();\r\n  }"
    );
  }

  content = content.replace(
    /const loc = \(opts\.locale \|\| 'en'\)\.split\(\/\[\-_\]\/\)\[0\]\.toLowerCase\(\);/g,
    'const loc = resolveCsvLocale(opts.locale);'
  );

  // Ensure truncation notice is localized and always starts with '# ... '
  content = content.replace(
    /rows\.push\((?:`# \.\.\. 25 of \$\{totalCsvAttendees\} attendees shown\. Upgrade to Educator or Pro for unlimited rosters\.`|(?:['"]# \.\.\. ['"] \+ )?t\('exportTruncated\.banner'[^)]*\)\.replace\('\{total\}', totalCsvAttendees\))\);/,
    "rows.push('# ... ' + t('exportTruncated.banner', '25 of {total} attendees shown. Upgrade to Educator or Pro for unlimited rosters.').replace('{total}', totalCsvAttendees));"
  );
  content = content.replace(
    /truncatedNotice = (?:`# \.\.\. 25 of \$\{dataRows\.length\} attendees shown\. Upgrade to Educator or Pro for unlimited rosters\.`|(?:['"]# \.\.\. ['"] \+ )?t\('exportTruncated\.banner'[^)]*\)\.replace\('\{total\}', dataRows\.length\));/,
    "truncatedNotice = '# ... ' + t('exportTruncated.banner', '25 of {total} attendees shown. Upgrade to Educator or Pro for unlimited rosters.').replace('{total}', dataRows.length);"
  );

  // Ensure check-in prefix is localized via opts.locale (headerCols.checkedIn) or t()
  content = content.replace(
    /const chk = p && p\.checkedInAt \? [^+]+ \+ fmtTime\(p\.checkedInAt\) : '';/,
    "const chk = p && p.checkedInAt ? (headerCols.checkedIn || t('export.checkedInPrefix', 'Checked in ')) + fmtTime(p.checkedInAt) : '';"
  );
  content = content.replace(
    /const chk = p && p\.checkedInAt \? [^+]+ \+ fmtTimeVal\(p\.checkedInAt\) : '';/,
    "const chk = p && p.checkedInAt ? (headerCols.checkedIn || t('export.checkedInPrefix', 'Checked in ')) + fmtTimeVal(p.checkedInAt) : '';"
  );

  fs.writeFileSync(utilsFile, content, 'utf8');
  console.log(`Updated js/utils.js with 60-language CSV localizations and check-in prefix.`);
}

expandUtilsLocales();
