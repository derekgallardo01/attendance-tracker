// Server-side i18n helper for Attendance Tracker.
//
// Reads translation tables from the synced public/js/strings.js (or ../js/strings.js
// in development/tests) and provides helper methods for localizing server-rendered
// content: Google Sheets headers & summary rows, email notification text, and error messages.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let cachedStrings = null;

function getStrings() {
  if (cachedStrings) return cachedStrings;

  const candidates = [
    path.join(__dirname, '..', '..', 'public', 'js', 'strings.js'),
    path.join(__dirname, '..', '..', '..', 'js', 'strings.js'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const code = fs.readFileSync(p, 'utf8');
        const m = { exports: {} };
        vm.runInNewContext(code, { module: m, exports: m.exports, console });
        cachedStrings = m.exports;
        return cachedStrings;
      } catch {
        /* istanbul ignore next: defensive fallback */
      }
    }
  }

  /* istanbul ignore next: fallback if file unreadable */
  return { STRINGS: { en: {} }, LOCALES: [{ code: 'en', label: 'English', flag: '🇺🇸' }] };
}

function normalizeLocale(rawLocale) {
  if (!rawLocale || typeof rawLocale !== 'string') return 'en';
  const raw = rawLocale.trim().toLowerCase();
  if (raw.startsWith('zh-cn') || raw.startsWith('zh-sg') || raw === 'zh-hans') return 'zh-CN';
  if (raw.startsWith('zh')) return 'zh';
  if (raw.startsWith('nb') || raw.startsWith('nn')) return 'no';
  const prefix = raw.split(/[-_]/)[0];
  const { STRINGS } = getStrings();
  if (STRINGS && STRINGS[prefix]) return prefix;
  if (STRINGS && STRINGS[raw]) return raw;
  return 'en';
}

function t(key, locale, fallback) {
  const norm = normalizeLocale(locale);
  const { STRINGS } = getStrings();
  if (STRINGS && STRINGS[norm] && STRINGS[norm][key]) {
    return STRINGS[norm][key];
  }
  if (STRINGS && STRINGS.en && STRINGS.en[key]) {
    return STRINGS.en[key];
  }
  return fallback != null ? fallback : key;
}

const LOCALIZED_HEADERS = {
  cs: {
    name: 'Jméno',
    email: 'E-mail',
    rsvp: 'Stav RSVP',
    late: 'Zpoždění?',
    joinTime: 'Čas připojení',
    leaveTime: 'Čas odpojení',
    duration: 'Délka (min)',
    pct: 'Docházka %',
    sessions: 'Relace',
    status: 'Stav',
    checkedIn: 'Zkontrolováno',
  },
  da: {
    name: 'Navn',
    email: 'E-mail',
    rsvp: 'RSVP-status',
    late: 'Forsinket?',
    joinTime: 'Tidspunkt for tilslutning',
    leaveTime: 'Tidspunkt for afgang',
    duration: 'Varighed (min)',
    pct: 'Fremmøde %',
    sessions: 'Sessioner',
    status: 'Status',
    checkedIn: 'Tjekket ind',
  },
  fi: {
    name: 'Nimi',
    email: 'Sähköposti',
    rsvp: 'RSVP-tila',
    late: 'Myöhässä?',
    joinTime: 'Liittymisaika',
    leaveTime: 'Poistumisaika',
    duration: 'Kesto (min)',
    pct: 'Läsnäolo %',
    sessions: 'Istunnot',
    status: 'Tila',
    checkedIn: 'Kirjautunut',
  },
  hu: {
    name: 'Név',
    email: 'E-mail',
    rsvp: 'RSVP állapot',
    late: 'Késett?',
    joinTime: 'Csatlakozás ideje',
    leaveTime: 'Távozás ideje',
    duration: 'Időtartam (perc)',
    pct: 'Részvétel %',
    sessions: 'Munkamenetek',
    status: 'Állapot',
    checkedIn: 'Bejelentkezve',
  },
  es: {
    name: 'Nombre',
    email: 'Correo',
    rsvp: 'Estado de RSVP',
    late: '¿Tarde?',
    joinTime: 'Hora de entrada',
    leaveTime: 'Hora de salida',
    duration: 'Duración (min)',
    pct: '% Asistencia',
    sessions: 'Sesiones',
    status: 'Estado',
    checkedIn: 'Registrado',
  },
  fr: {
    name: 'Nom',
    email: 'E-mail',
    rsvp: 'Statut RSVP',
    late: 'En retard ?',
    joinTime: "Heure d'arrivée",
    leaveTime: 'Heure de départ',
    duration: 'Durée (min)',
    pct: '% Présence',
    sessions: 'Sessions',
    status: 'Statut',
    checkedIn: 'Enregistré',
  },
  de: {
    name: 'Name',
    email: 'E-Mail',
    rsvp: 'RSVP-Status',
    late: 'Verspätet?',
    joinTime: 'Beitrittszeit',
    leaveTime: 'Verlassenszeit',
    duration: 'Dauer (Min.)',
    pct: 'Anwesenheit %',
    sessions: 'Sitzungen',
    status: 'Status',
    checkedIn: 'Eingecheckt',
  },
  pt: {
    name: 'Nome',
    email: 'E-mail',
    rsvp: 'Status RSVP',
    late: 'Atrasado?',
    joinTime: 'Horário de entrada',
    leaveTime: 'Horário de saída',
    duration: 'Duração (min)',
    pct: '% Presença',
    sessions: 'Sessões',
    status: 'Status',
    checkedIn: 'Confirmado',
  },
  uk: {
    name: "Ім'я",
    email: 'Ел. пошта',
    rsvp: 'Статус RSVP',
    late: 'Запізнення?',
    joinTime: 'Час приєднання',
    leaveTime: 'Час відключення',
    duration: 'Тривалість (хв)',
    pct: 'Відвідуваність %',
    sessions: 'Сесії',
    status: 'Статус',
    checkedIn: 'Відмічено',
  },
  sv: {
    name: 'Namn',
    email: 'E-post',
    rsvp: 'RSVP-status',
    late: 'Sen ankomst?',
    joinTime: 'Ankomsttid',
    leaveTime: 'Lämningstid',
    duration: 'Längd (min)',
    pct: 'Närvaro %',
    sessions: 'Sessioner',
    status: 'Status',
    checkedIn: 'Incheckad',
  },
  he: {
    name: 'שם',
    email: 'אימייל',
    rsvp: 'סטטוס אישור',
    late: 'איחור?',
    joinTime: 'זמן כניסה',
    leaveTime: 'זמן עזיבה',
    duration: 'משך (דקות)',
    pct: '% נוכחות',
    sessions: 'מפגשים',
    status: 'סטטוס',
    checkedIn: 'נרשם',
  },
  sw: {
    name: 'Jina',
    email: 'Barua pepe',
    rsvp: 'Hali ya RSVP',
    late: 'Amechelewa?',
    joinTime: 'Wakati wa Kujiunga',
    leaveTime: 'Wakati wa Kuondoka',
    duration: 'Muda (dakika)',
    pct: '% ya Mahudhurio',
    sessions: 'Vipindi',
    status: 'Hali',
    checkedIn: 'Ameingia',
  },
  am: {
    name: 'ስም',
    email: 'ኢሜይል',
    rsvp: 'የRSVP ሁኔታ',
    late: 'ዘግይቷል?',
    joinTime: 'የመቀላቀያ ሰዓት',
    leaveTime: 'የመውጫ ሰዓት',
    duration: 'ቆይታ (ደቂቃ)',
    pct: 'የተሳትፎ %',
    sessions: 'ክፍለ-ጊዜዎች',
    status: 'ሁኔታ',
    checkedIn: 'ተመዝግቧል',
  },
  si: {
    name: 'නම',
    email: 'විද්‍යුත් තැපෑල',
    rsvp: 'RSVP තත්වය',
    late: 'ප්‍රමාදද?',
    joinTime: 'සම්බන්ධ වූ වේලාව',
    leaveTime: 'ඉවත් වූ වේලාව',
    duration: 'කාලය (මිනි)',
    pct: 'පැමිණීම %',
    sessions: 'සැසි',
    status: 'තත්වය',
    checkedIn: 'ලියාපදිංචි වී ඇත',
  },
  el: {
    name: 'Όνομα',
    email: 'Email',
    rsvp: 'Κατάσταση RSVP',
    late: 'Καθυστερημένος;',
    joinTime: 'Ώρα εισόδου',
    leaveTime: 'Ώρα εξόδου',
    duration: 'Διάρκεια (λεπτά)',
    pct: '% Παρουσίας',
    sessions: 'Συνεδρίες',
    status: 'Κατάσταση',
    checkedIn: 'Καταχωρήθηκε',
  },
  no: {
    name: 'Navn',
    email: 'E-post',
    rsvp: 'RSVP-status',
    late: 'Forsinket?',
    joinTime: 'Tidspunkt tilkoblet',
    leaveTime: 'Tidspunkt frakoblet',
    duration: 'Varighet (min)',
    pct: 'Oppmøte %',
    sessions: 'Økter',
    status: 'Status',
    checkedIn: 'Innsjekket',
  },
  ca: {
    name: 'Nom',
    email: 'Correu electrònic',
    rsvp: 'Estat RSVP',
    late: 'Amb retard?',
    joinTime: "Hora d'entrada",
    leaveTime: 'Hora de sortida',
    duration: 'Durada (min)',
    pct: '% Assistència',
    sessions: 'Sessions',
    status: 'Estat',
    checkedIn: 'Registrat',
  },
};

function getSheetHeaders(locale, tzAbbr) {
  const norm = normalizeLocale(locale);
  const h = LOCALIZED_HEADERS[norm];
  const tz = tzAbbr ? ` (${tzAbbr})` : '';
  if (!h) {
    return [
      'Name',
      'Email',
      'RSVP Status',
      'Late?',
      `Join Time${tz}`,
      `Leave Time${tz}`,
      'Duration (min)',
      'Attendance %',
      'Sessions',
      'Status',
      'Checked In',
    ];
  }
  return [
    h.name,
    h.email,
    h.rsvp,
    h.late,
    `${h.joinTime}${tz}`,
    `${h.leaveTime}${tz}`,
    h.duration,
    h.pct,
    h.sessions,
    h.status,
    h.checkedIn,
  ];
}

const DEFAULT_SUMMARY_LABELS = {
  meeting: 'Meeting',
  meetingId: 'Meeting ID',
  type: 'Type',
  scheduledRange: 'Scheduled Time',
  scheduledEvent: 'Scheduled Event',
  instantMeeting: 'Instant Meeting',
  date: 'Date',
  duration: 'Duration (min)',
  totalInvited: 'Total Invited',
  totalAttended: 'Total Attended',
  attendanceRate: 'Attendance Rate',
};

const LOCALIZED_SUMMARY_LABELS = {
  pt: {
    meeting: 'Reunião',
    meetingId: 'ID da Reunião',
    type: 'Tipo',
    scheduledRange: 'Horário Agendado',
    scheduledEvent: 'Evento Agendado',
    instantMeeting: 'Reunião Instantânea',
    date: 'Data',
    duration: 'Duração (min)',
    totalInvited: 'Total de Convidados',
    totalAttended: 'Total Presente',
    attendanceRate: 'Taxa de Presença',
  },
  es: {
    meeting: 'Reunión',
    meetingId: 'ID de la Reunión',
    type: 'Tipo',
    scheduledRange: 'Hora Programada',
    scheduledEvent: 'Evento Programado',
    instantMeeting: 'Reunión Instantánea',
    date: 'Fecha',
    duration: 'Duración (min)',
    totalInvited: 'Total Invitados',
    totalAttended: 'Total Asistentes',
    attendanceRate: 'Tasa de Asistencia',
  },
  fr: {
    meeting: 'Réunion',
    meetingId: 'ID de la Réunion',
    type: 'Type',
    scheduledRange: 'Heure Prévue',
    scheduledEvent: 'Événement Programmé',
    instantMeeting: 'Réunion Instantanée',
    date: 'Date',
    duration: 'Durée (min)',
    totalInvited: 'Total Invités',
    totalAttended: 'Total Participants',
    attendanceRate: 'Taux de Présence',
  },
  de: {
    meeting: 'Meeting',
    meetingId: 'Meeting-ID',
    type: 'Typ',
    scheduledRange: 'Geplante Zeit',
    scheduledEvent: 'Geplantes Ereignis',
    instantMeeting: 'Sofort-Meeting',
    date: 'Datum',
    duration: 'Dauer (Min.)',
    totalInvited: 'Insgesamt Eingeladen',
    totalAttended: 'Insgesamt Anwesend',
    attendanceRate: 'Anwesenheitsrate',
  },
  it: {
    meeting: 'Riunione',
    meetingId: 'ID Riunione',
    type: 'Tipo',
    scheduledRange: 'Orario Programmato',
    scheduledEvent: 'Evento Programmato',
    instantMeeting: 'Riunione Istantanea',
    date: 'Data',
    duration: 'Durata (min)',
    totalInvited: 'Totale Invitati',
    totalAttended: 'Totale Presenti',
    attendanceRate: 'Tasso di Presenza',
  },
  nl: {
    meeting: 'Vergadering',
    meetingId: 'Vergadering-ID',
    type: 'Type',
    scheduledRange: 'Geplande Tijd',
    scheduledEvent: 'Gepland Evenement',
    instantMeeting: 'Directe Vergadering',
    date: 'Datum',
    duration: 'Duur (min)',
    totalInvited: 'Totaal Uitgenodigd',
    totalAttended: 'Totaal Aanwezig',
    attendanceRate: 'Aanwezigheidspercentage',
  },
};

function getSheetSummaryLabels(locale) {
  const norm = normalizeLocale(locale);
  return LOCALIZED_SUMMARY_LABELS[norm] || DEFAULT_SUMMARY_LABELS;
}

const STATUS_TRANSLATIONS = {
  pt: {
    'Present': 'Presente',
    'Left': 'Saiu',
    'Absent': 'Ausente',
    'Absent (excused)': 'Ausente (justificado)',
    'Late': 'Atrasado',
    'Left Early / Incomplete': 'Saiu antes / Incompleto',
    'Excused (Short Stay)': 'Justificado (Estadia curta)',
    'Present (Left)': 'Presente (Saiu)',
    'Guest (Present)': 'Convidado (Presente)',
    'Guest (Left)': 'Convidado (Saiu)',
  },
  es: {
    'Present': 'Presente',
    'Left': 'Salió',
    'Absent': 'Ausente',
    'Absent (excused)': 'Ausente (justificado)',
    'Late': 'Tarde',
    'Left Early / Incomplete': 'Salió antes / Incompleto',
    'Excused (Short Stay)': 'Justificado (Estadía corta)',
    'Present (Left)': 'Presente (Salió)',
    'Guest (Present)': 'Invitado (Presente)',
    'Guest (Left)': 'Invitado (Salió)',
  },
  fr: {
    'Present': 'Présent',
    'Left': 'Parti',
    'Absent': 'Absent',
    'Absent (excused)': 'Absent (excusé)',
    'Late': 'En retard',
    'Left Early / Incomplete': 'Parti plus tôt / Incomplet',
    'Excused (Short Stay)': 'Excusé (Court séjour)',
    'Present (Left)': 'Présent (Parti)',
    'Guest (Present)': 'Invité (Présent)',
    'Guest (Left)': 'Invité (Parti)',
  },
  de: {
    'Present': 'Anwesend',
    'Left': 'Verlassen',
    'Absent': 'Abwesend',
    'Absent (excused)': 'Abwesend (entschuldigt)',
    'Late': 'Verspätet',
    'Left Early / Incomplete': 'Frühzeitig verlassen / Unvollständig',
    'Excused (Short Stay)': 'Entschuldigt (Kurzer Aufenthalt)',
    'Present (Left)': 'Anwesend (Verlassen)',
    'Guest (Present)': 'Gast (Anwesend)',
    'Guest (Left)': 'Gast (Verlassen)',
  },
  it: {
    'Present': 'Presente',
    'Left': 'Uscito',
    'Absent': 'Assente',
    'Absent (excused)': 'Assente (giustificato)',
    'Late': 'In ritardo',
    'Left Early / Incomplete': 'Uscito prima / Incompleto',
    'Excused (Short Stay)': 'Giustificato (Breve permanenza)',
    'Present (Left)': 'Presente (Uscito)',
    'Guest (Present)': 'Ospite (Presente)',
    'Guest (Left)': 'Ospite (Uscito)',
  },
};

function localizeStatus(status, locale) {
  if (!status) return '';
  const norm = normalizeLocale(locale);
  if (norm === 'en') return status;
  return STATUS_TRANSLATIONS[norm]?.[status] || status;
}

const RSVP_TRANSLATIONS = {
  pt: {
    accepted: 'Aceito',
    declined: 'Recusado',
    tentative: 'Talvez',
    needsAction: 'Sem Resposta',
  },
  es: {
    accepted: 'Aceptado',
    declined: 'Rechazado',
    tentative: 'Provisional',
    needsAction: 'Sin Respuesta',
  },
  fr: {
    accepted: 'Accepté',
    declined: 'Refusé',
    tentative: 'Provisoire',
    needsAction: 'Sans Réponse',
  },
  de: {
    accepted: 'Zugesagt',
    declined: 'Abgelehnt',
    tentative: 'Vorläufig',
    needsAction: 'Keine Antwort',
  },
  it: {
    accepted: 'Accettato',
    declined: 'Rifiutato',
    tentative: 'Provvisorio',
    needsAction: 'Nessuna Risposta',
  },
};

function localizeRsvp(status, locale) {
  if (!status) return '';
  const norm = normalizeLocale(locale);
  if (norm === 'en') {
    switch (status) {
      case 'accepted':    return 'Accepted';
      case 'declined':    return 'Declined';
      case 'tentative':   return 'Tentative';
      case 'needsAction': return 'No Response';
      default:            return '';
    }
  }
  const map = RSVP_TRANSLATIONS[norm];
  if (map && map[status]) return map[status];
  switch (status) {
    case 'accepted':    return 'Accepted';
    case 'declined':    return 'Declined';
    case 'tentative':   return 'Tentative';
    case 'needsAction': return 'No Response';
    default:            return '';
  }
}

const PDF_TRANSLATIONS = {
  pt: {
    reportTitle: 'Relatório de Presença',
    dateLabel: 'Data',
    hostLabel: 'Organizador',
    durationLabel: 'Duração',
    columns: { name: 'Nome', email: 'E-mail', joined: 'Entrada', left: 'Saída', active: 'Duração', status: 'Status' },
    summaryFormat: (present, total) => `${present} de ${total} registrados como presentes`,
  },
  es: {
    reportTitle: 'Informe de Asistencia',
    dateLabel: 'Fecha',
    hostLabel: 'Organizador',
    durationLabel: 'Duración',
    columns: { name: 'Nombre', email: 'Correo', joined: 'Entrada', left: 'Salida', active: 'Duración', status: 'Estado' },
    summaryFormat: (present, total) => `${present} de ${total} registrados como presentes`,
  },
  fr: {
    reportTitle: 'Rapport de Présence',
    dateLabel: 'Date',
    hostLabel: 'Hôte',
    durationLabel: 'Durée',
    columns: { name: 'Nom', email: 'E-mail', joined: 'Arrivée', left: 'Départ', active: 'Durée', status: 'Statut' },
    summaryFormat: (present, total) => `${present} sur ${total} enregistrés comme présents`,
  },
  de: {
    reportTitle: 'Anwesenheitsbericht',
    dateLabel: 'Datum',
    hostLabel: 'Gastgeber',
    durationLabel: 'Dauer',
    columns: { name: 'Name', email: 'E-Mail', joined: 'Beitritt', left: 'Verlassen', active: 'Dauer', status: 'Status' },
    summaryFormat: (present, total) => `${present} von ${total} als anwesend erfasst`,
  },
  it: {
    reportTitle: 'Rapporto Presenze',
    dateLabel: 'Data',
    hostLabel: 'Organizzatore',
    durationLabel: 'Durata',
    columns: { name: 'Nome', email: 'E-mail', joined: 'Entrata', left: 'Uscita', active: 'Durata', status: 'Stato' },
    summaryFormat: (present, total) => `${present} su ${total} registrati come presenti`,
  },
};

const DEFAULT_PDF_LABELS = {
  reportTitle: 'Attendance Report',
  dateLabel: 'Date',
  hostLabel: 'Host',
  durationLabel: 'Duration',
  columns: { name: 'Name', email: 'Email', joined: 'Joined', left: 'Left', active: 'Active', status: 'Status' },
  summaryFormat: (present, total) => `${present} of ${total} recorded as present`,
};

function getPdfLabels(locale) {
  const norm = normalizeLocale(locale);
  return PDF_TRANSLATIONS[norm] || DEFAULT_PDF_LABELS;
}

module.exports = {
  getStrings,
  normalizeLocale,
  t,
  getSheetHeaders,
  getSheetSummaryLabels,
  localizeStatus,
  localizeRsvp,
  getPdfLabels,
  LOCALIZED_HEADERS,
  DEFAULT_SUMMARY_LABELS,
  LOCALIZED_SUMMARY_LABELS,
  DEFAULT_PDF_LABELS,
  _resetCache: () => { cachedStrings = null; },
};
