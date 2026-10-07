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

  const headerDict = {};
  const statusDict = {};

  for (const locObj of LOCALES) {
    const loc = locObj.code;
    if (loc === 'en') continue;
    const h = LOCALIZED_HEADERS[loc] || LOCALIZED_HEADERS['en'] || {};
    const s = STATUS_TRANSLATIONS[loc] || STATUS_TRANSLATIONS['en'] || {};

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
        loc === 'es' || loc === 'pt' ? 'Notas' : (loc === 'fr' ? 'Remarques' : (loc === 'de' ? 'Notizen' : (loc === 'it' ? 'Note' : 'Notes')))
      ];
    }

    // Attach meeting & series sub-headers
    const rsvp = h.rsvp || 'Calendar RSVP';
    const attended = loc === 'es' ? 'Asistió' : (loc === 'pt' ? 'Compareceu' : (loc === 'fr' ? 'Présent' : (loc === 'de' ? 'Anwesend' : (loc === 'it' ? 'Presente' : 'Attended'))));
    const missed = loc === 'es' ? 'Ausente' : (loc === 'pt' ? 'Ausente' : (loc === 'fr' ? 'Absent' : (loc === 'de' ? 'Abwesend' : (loc === 'it' ? 'Assente' : 'Missed'))));
    const totalMinutes = loc === 'es' ? 'Minutos totales' : (loc === 'pt' ? 'Minutos totais' : (loc === 'fr' ? 'Minutes totales' : (loc === 'de' ? 'Gesamtminuten' : (loc === 'it' ? 'Minuti totali' : 'Total minutes'))));

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
    headerCodeLines.push(`    ${JSON.stringify(loc)}: Object.assign(${colsJson}, { meeting: ${meetingJson}, series: ${seriesJson} }),`);
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

  // Ensure check-in prefix is localized
  content = content.replace(
    "const chk = p && p.checkedInAt ? 'Checked in ' + fmtTime(p.checkedInAt) : '';",
    "const chk = p && p.checkedInAt ? t('export.checkedInPrefix', 'Checked in ') + fmtTime(p.checkedInAt) : '';"
  );
  content = content.replace(
    "const chk = p && p.checkedInAt ? 'Checked in ' + fmtTimeVal(p.checkedInAt) : '';",
    "const chk = p && p.checkedInAt ? t('export.checkedInPrefix', 'Checked in ') + fmtTimeVal(p.checkedInAt) : '';"
  );

  fs.writeFileSync(utilsFile, content, 'utf8');
  console.log(`Updated js/utils.js with 60-language CSV localizations and check-in prefix.`);
}

expandUtilsLocales();
