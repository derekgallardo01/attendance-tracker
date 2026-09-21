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

module.exports = {
  getStrings,
  normalizeLocale,
  t,
  getSheetHeaders,
  LOCALIZED_HEADERS,
  _resetCache: () => { cachedStrings = null; },
};
