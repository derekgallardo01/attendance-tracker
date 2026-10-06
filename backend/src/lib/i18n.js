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

const COUNTRY_TO_LOCALE = {
  "ES": "es",
  "MX": "es",
  "CO": "es",
  "AR": "es",
  "PE": "es",
  "VE": "es",
  "CL": "es",
  "EC": "es",
  "GT": "es",
  "CU": "es",
  "BO": "es",
  "DO": "es",
  "HN": "es",
  "PY": "es",
  "SV": "es",
  "NI": "es",
  "CR": "es",
  "PR": "es",
  "PA": "es",
  "UY": "es",
  "GQ": "es",
  "BR": "pt",
  "PT": "pt",
  "AO": "pt",
  "MZ": "pt",
  "GW": "pt",
  "CV": "pt",
  "ST": "pt",
  "TL": "pt",
  "BD": "bn",
  "IN": "hi",
  "PK": "ur",
  "LK": "si",
  "NP": "ne",
  "FR": "fr",
  "RW": "fr",
  "DE": "de",
  "AT": "de",
  "IT": "it",
  "NL": "nl",
  "PL": "pl",
  "RO": "ro",
  "MD": "ro",
  "RU": "ru",
  "BY": "ru",
  "UA": "uk",
  "TR": "tr",
  "TH": "th",
  "SA": "ar",
  "AE": "ar",
  "EG": "ar",
  "QA": "ar",
  "KW": "ar",
  "OM": "ar",
  "BH": "ar",
  "DZ": "ar",
  "MA": "ar",
  "TN": "ar",
  "IQ": "ar",
  "JO": "ar",
  "LB": "ar",
  "KR": "ko",
  "TW": "zh",
  "HK": "zh",
  "CN": "zh-CN",
  "SG": "zh-CN",
  "JP": "ja",
  "IL": "he",
  "SE": "sv",
  "CZ": "cs",
  "DK": "da",
  "FI": "fi",
  "HU": "hu",
  "SO": "so",
  "KE": "sw",
  "TZ": "sw",
  "ET": "am",
  "GR": "el",
  "CY": "el",
  "NO": "no",
  "PH": "tl",
  "MY": "ms",
  "ID": "id",
  "VN": "vi",
  "MN": "mn",
  "ZA": "en",
  "BW": "en",
  "MV": "en",
  "KZ": "kk",
  "LV": "lv",
  "LT": "lt",
  "LA": "lo",
  "MM": "my",
  "KH": "km",
  "BG": "bg",
  "HR": "hr",
  "RS": "sr",
  "SK": "sk",
  "SI": "sl"
};

function normalizeLocale(rawLocale, countryHint) {
  if (!rawLocale || typeof rawLocale !== 'string') {
    if (countryHint && typeof countryHint === 'string') {
      const c = countryHint.trim().toUpperCase();
      if (COUNTRY_TO_LOCALE[c]) return COUNTRY_TO_LOCALE[c];
    }
    return 'en';
  }
  const raw = rawLocale.trim().toLowerCase();
  if (raw.startsWith('zh-cn') || raw.startsWith('zh-sg') || raw === 'zh-hans') return 'zh-CN';
  if (raw.startsWith('zh')) return 'zh';
  if (raw.startsWith('nb') || raw.startsWith('nn')) return 'no';
  const prefix = raw.split(/[-_]/)[0];
  const parts = raw.split(/[-_]/);
  const country = String(countryHint || (parts.length > 1 ? parts[1] : '') || '').trim().toUpperCase();
  if (prefix !== 'en') {
    const { STRINGS } = getStrings();
    if (STRINGS && STRINGS[prefix]) return prefix;
    if (STRINGS && STRINGS[raw]) return raw;
  }
  if (country && COUNTRY_TO_LOCALE[country]) return COUNTRY_TO_LOCALE[country];
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
  "it": {
    "name": "Nome",
    "email": "Email",
    "rsvp": "Stato RSVP",
    "late": "In ritardo?",
    "joinTime": "Ora di accesso",
    "leaveTime": "Ora di uscita",
    "duration": "Durata (min)",
    "pct": "Presenza %",
    "sessions": "Sessioni",
    "status": "Stato",
    "checkedIn": "Registrato"
  },
  "nl": {
    "name": "Naam",
    "email": "E-mail",
    "rsvp": "RSVP-status",
    "late": "Te laat?",
    "joinTime": "Tijdstip van deelnemen",
    "leaveTime": "Tijdstip van verlaten",
    "duration": "Duur (min)",
    "pct": "Aanwezigheid %",
    "sessions": "Sessies",
    "status": "Status",
    "checkedIn": "Ingecheckt"
  },
  "so": {
    "name": "Magaca",
    "email": "Emailka",
    "rsvp": "Xaaladda RSVP",
    "late": "Soo daahay?",
    "joinTime": "Waqtiga ku biirista",
    "leaveTime": "Waqtiga ka bixitaanka",
    "duration": "Muddada (daqiiqo)",
    "pct": "Xaadirinta %",
    "sessions": "Kulamada",
    "status": "Xaaladda",
    "checkedIn": "Diiwaangashan"
  },
  "mr": {
    "name": "नाव",
    "email": "ईमेल",
    "rsvp": "RSVP स्थिती",
    "late": "उशीर?",
    "joinTime": "सामील होण्याची वेळ",
    "leaveTime": "सोडण्याची वेळ",
    "duration": "कालावधी (मिनिटे)",
    "pct": "उपस्थिती %",
    "sessions": "सत्रे",
    "status": "स्थिती",
    "checkedIn": "चेक इन केले"
  },
  "ja": {
    "name": "氏名",
    "email": "メールアドレス",
    "rsvp": "RSVPステータス",
    "late": "遅刻？",
    "joinTime": "参加時間",
    "leaveTime": "退出時間",
    "duration": "滞在時間 (分)",
    "pct": "出席率 %",
    "sessions": "セッション数",
    "status": "ステータス",
    "checkedIn": "チェックイン済"
  },
  "zh-CN": {
    "name": "姓名",
    "email": "电子邮件",
    "rsvp": "RSVP 状态",
    "late": "迟到？",
    "joinTime": "加入时间",
    "leaveTime": "离开时间",
    "duration": "时长 (分钟)",
    "pct": "出席率 %",
    "sessions": "会议场次",
    "status": "状态",
    "checkedIn": "已签到"
  },
  "zh": {
    "name": "姓名",
    "email": "電子郵件",
    "rsvp": "RSVP 狀態",
    "late": "遲到？",
    "joinTime": "加入時間",
    "leaveTime": "離開時間",
    "duration": "時長 (分鐘)",
    "pct": "出席率 %",
    "sessions": "會議場次",
    "status": "狀態",
    "checkedIn": "已簽到"
  },
  "ko": {
    "name": "이름",
    "email": "이메일",
    "rsvp": "RSVP 상태",
    "late": "지각 여부",
    "joinTime": "참여 시간",
    "leaveTime": "퇴장 시간",
    "duration": "시간 (분)",
    "pct": "출석률 %",
    "sessions": "세션",
    "status": "상태",
    "checkedIn": "체크인됨"
  },
  "ar": {
    "name": "الاسم",
    "email": "البريد الإلكتروني",
    "rsvp": "حالة الرد",
    "late": "متأخر؟",
    "joinTime": "وقت الانضمام",
    "leaveTime": "وقت المغادرة",
    "duration": "المدة (دقيقة)",
    "pct": "نسبة الحضور %",
    "sessions": "الجلسات",
    "status": "الحالة",
    "checkedIn": "تم تسجيل الحضور"
  },
  "th": {
    "name": "ชื่อ",
    "email": "อีเมล",
    "rsvp": "สถานะ RSVP",
    "late": "มาสาย?",
    "joinTime": "เวลาเข้าร่วม",
    "leaveTime": "เวลาออก",
    "duration": "ระยะเวลา (นาที)",
    "pct": "การเข้าร่วม %",
    "sessions": "เซสชัน",
    "status": "สถานะ",
    "checkedIn": "เช็คอินแล้ว"
  },
  "tr": {
    "name": "Ad",
    "email": "E-posta",
    "rsvp": "RSVP Durumu",
    "late": "Geç mi?",
    "joinTime": "Katılma saati",
    "leaveTime": "Ayrılma saati",
    "duration": "Süre (dk)",
    "pct": "Katılım %",
    "sessions": "Oturumlar",
    "status": "Durum",
    "checkedIn": "Giriş Yapıldı"
  },
  "ru": {
    "name": "Имя",
    "email": "E-mail",
    "rsvp": "Статус RSVP",
    "late": "Опоздание?",
    "joinTime": "Время входа",
    "leaveTime": "Время выхода",
    "duration": "Длительность (мин)",
    "pct": "Посещаемость %",
    "sessions": "Сессии",
    "status": "Статус",
    "checkedIn": "Отмечен"
  },
  "ro": {
    "name": "Nume",
    "email": "Email",
    "rsvp": "Stare RSVP",
    "late": "Întârziat?",
    "joinTime": "Ora conectării",
    "leaveTime": "Ora deconectării",
    "duration": "Durată (min)",
    "pct": "Prezență %",
    "sessions": "Sesiuni",
    "status": "Stare",
    "checkedIn": "Înregistrat"
  },
  "pl": {
    "name": "Imię i nazwisko",
    "email": "E-mail",
    "rsvp": "Status RSVP",
    "late": "Spóźnienie?",
    "joinTime": "Czas dołączenia",
    "leaveTime": "Czas opuszczenia",
    "duration": "Czas trwania (min)",
    "pct": "Obecność %",
    "sessions": "Sesje",
    "status": "Status",
    "checkedIn": "Zarejestrowano"
  },
  "vi": {
    "name": "Tên",
    "email": "Email",
    "rsvp": "Trạng thái RSVP",
    "late": "Muộn?",
    "joinTime": "Thời gian tham gia",
    "leaveTime": "Thời gian rời đi",
    "duration": "Thời lượng (phút)",
    "pct": "% Tham dự",
    "sessions": "Phiên",
    "status": "Trạng thái",
    "checkedIn": "Đã điểm danh"
  },
  "id": {
    "name": "Nama",
    "email": "Email",
    "rsvp": "Status RSVP",
    "late": "Terlambat?",
    "joinTime": "Waktu bergabung",
    "leaveTime": "Waktu keluar",
    "duration": "Durasi (menit)",
    "pct": "Kehadiran %",
    "sessions": "Sesi",
    "status": "Status",
    "checkedIn": "Sudah Masuk"
  },
  "ms": {
    "name": "Nama",
    "email": "E-mel",
    "rsvp": "Status RSVP",
    "late": "Lewat?",
    "joinTime": "Masa sertai",
    "leaveTime": "Masa keluar",
    "duration": "Tempoh (min)",
    "pct": "Kehadiran %",
    "sessions": "Sesi",
    "status": "Status",
    "checkedIn": "Didaftarkan"
  },
  "tl": {
    "name": "Pangalan",
    "email": "Email",
    "rsvp": "Katayuan ng RSVP",
    "late": "Huli?",
    "joinTime": "Oras ng pagsali",
    "leaveTime": "Oras ng pag-alis",
    "duration": "Tagal (min)",
    "pct": "Attendance %",
    "sessions": "Mga session",
    "status": "Katayuan",
    "checkedIn": "Naka-check In"
  },
  "ur": {
    "name": "نام",
    "email": "ای میل",
    "rsvp": "RSVP کی حیثیت",
    "late": "تاخیر؟",
    "joinTime": "شمولیت کا وقت",
    "leaveTime": "چھوڑنے کا وقت",
    "duration": "مدت (منٹ)",
    "pct": "حاضری %",
    "sessions": "سیشنز",
    "status": "حیثیت",
    "checkedIn": "چیک ان کیا گیا"
  },
  "bn": {
    "name": "নাম",
    "email": "ইমেইল",
    "rsvp": "RSVP অবস্থা",
    "late": "দেরি?",
    "joinTime": "যোগদানের সময়",
    "leaveTime": "ত্যাগের সময়",
    "duration": "সময়কাল (মিনিট)",
    "pct": "উপস্থিতি %",
    "sessions": "সেশন",
    "status": "অবস্থা",
    "checkedIn": "চেক ইন করা হয়েছে"
  },
  "te": {
    "name": "పేరు",
    "email": "ఇమెయిల్",
    "rsvp": "RSVP స్థితి",
    "late": "ఆలస్యం?",
    "joinTime": "చేరిన సమయం",
    "leaveTime": "నిష్క్రమించిన సమయం",
    "duration": "వ్యవధి (నిమి)",
    "pct": "హాజరు %",
    "sessions": "సెషన్‌లు",
    "status": "స్థితి",
    "checkedIn": "చెక్ ఇన్ చేయబడింది"
  },
  "ta": {
    "name": "பெயர்",
    "email": "மின்னஞ்சல்",
    "rsvp": "RSVP நிலை",
    "late": "தாமதம்?",
    "joinTime": "சேர்ந்த நேரம்",
    "leaveTime": "வெளியேறிய நேரம்",
    "duration": "காலம் (நிமிடம்)",
    "pct": "வருகை %",
    "sessions": "அமர்வுகள்",
    "status": "நிலை",
    "checkedIn": "சரிபார்க்கப்பட்டது"
  },
  "hi": {
    "name": "नाम",
    "email": "ईमेल",
    "rsvp": "RSVP स्थिति",
    "late": "देर?",
    "joinTime": "शामिल होने का समय",
    "leaveTime": "छोड़ने का समय",
    "duration": "अवधि (मिनट)",
    "pct": "उपस्थिति %",
    "sessions": "सत्र",
    "status": "स्थिति",
    "checkedIn": "चेक इन किया गया"
  },
  "cs": {
    "name": "Jméno",
    "email": "E-mail",
    "rsvp": "Stav RSVP",
    "late": "Zpoždění?",
    "joinTime": "Čas připojení",
    "leaveTime": "Čas odpojení",
    "duration": "Délka (min)",
    "pct": "Docházka %",
    "sessions": "Relace",
    "status": "Stav",
    "checkedIn": "Zkontrolováno"
  },
  "da": {
    "name": "Navn",
    "email": "E-mail",
    "rsvp": "RSVP-status",
    "late": "Forsinket?",
    "joinTime": "Tidspunkt for tilslutning",
    "leaveTime": "Tidspunkt for afgang",
    "duration": "Varighed (min)",
    "pct": "Fremmøde %",
    "sessions": "Sessioner",
    "status": "Status",
    "checkedIn": "Tjekket ind"
  },
  "fi": {
    "name": "Nimi",
    "email": "Sähköposti",
    "rsvp": "RSVP-tila",
    "late": "Myöhässä?",
    "joinTime": "Liittymisaika",
    "leaveTime": "Poistumisaika",
    "duration": "Kesto (min)",
    "pct": "Läsnäolo %",
    "sessions": "Istunnot",
    "status": "Tila",
    "checkedIn": "Kirjautunut"
  },
  "hu": {
    "name": "Név",
    "email": "E-mail",
    "rsvp": "RSVP állapot",
    "late": "Késett?",
    "joinTime": "Csatlakozás ideje",
    "leaveTime": "Távozás ideje",
    "duration": "Időtartam (perc)",
    "pct": "Részvétel %",
    "sessions": "Munkamenetek",
    "status": "Állapot",
    "checkedIn": "Bejelentkezve"
  },
  "es": {
    "name": "Nombre",
    "email": "Correo",
    "rsvp": "Estado de RSVP",
    "late": "¿Tarde?",
    "joinTime": "Hora de entrada",
    "leaveTime": "Hora de salida",
    "duration": "Duración (min)",
    "pct": "% Asistencia",
    "sessions": "Sesiones",
    "status": "Estado",
    "checkedIn": "Registrado"
  },
  "fr": {
    "name": "Nom",
    "email": "E-mail",
    "rsvp": "Statut RSVP",
    "late": "En retard ?",
    "joinTime": "Heure d'arrivée",
    "leaveTime": "Heure de départ",
    "duration": "Durée (min)",
    "pct": "% Présence",
    "sessions": "Sessions",
    "status": "Statut",
    "checkedIn": "Enregistré"
  },
  "de": {
    "name": "Name",
    "email": "E-Mail",
    "rsvp": "RSVP-Status",
    "late": "Verspätet?",
    "joinTime": "Beitrittszeit",
    "leaveTime": "Verlassenszeit",
    "duration": "Dauer (Min.)",
    "pct": "Anwesenheit %",
    "sessions": "Sitzungen",
    "status": "Status",
    "checkedIn": "Eingecheckt"
  },
  "pt": {
    "name": "Nome",
    "email": "E-mail",
    "rsvp": "Status RSVP",
    "late": "Atrasado?",
    "joinTime": "Horário de entrada",
    "leaveTime": "Horário de saída",
    "duration": "Duração (min)",
    "pct": "% Presença",
    "sessions": "Sessões",
    "status": "Status",
    "checkedIn": "Confirmado"
  },
  "uk": {
    "name": "Ім'я",
    "email": "Ел. пошта",
    "rsvp": "Статус RSVP",
    "late": "Запізнення?",
    "joinTime": "Час приєднання",
    "leaveTime": "Час відключення",
    "duration": "Тривалість (хв)",
    "pct": "Відвідуваність %",
    "sessions": "Сесії",
    "status": "Статус",
    "checkedIn": "Відмічено"
  },
  "sv": {
    "name": "Namn",
    "email": "E-post",
    "rsvp": "RSVP-status",
    "late": "Sen ankomst?",
    "joinTime": "Ankomsttid",
    "leaveTime": "Lämningstid",
    "duration": "Längd (min)",
    "pct": "Närvaro %",
    "sessions": "Sessioner",
    "status": "Status",
    "checkedIn": "Incheckad"
  },
  "he": {
    "name": "שם",
    "email": "אימייל",
    "rsvp": "סטטוס אישור",
    "late": "איחור?",
    "joinTime": "זמן כניסה",
    "leaveTime": "זמן עזיבה",
    "duration": "משך (דקות)",
    "pct": "% נוכחות",
    "sessions": "מפגשים",
    "status": "סטטוס",
    "checkedIn": "נרשם"
  },
  "sw": {
    "name": "Jina",
    "email": "Barua pepe",
    "rsvp": "Hali ya RSVP",
    "late": "Amechelewa?",
    "joinTime": "Wakati wa Kujiunga",
    "leaveTime": "Wakati wa Kuondoka",
    "duration": "Muda (dakika)",
    "pct": "% ya Mahudhurio",
    "sessions": "Vipindi",
    "status": "Hali",
    "checkedIn": "Ameingia"
  },
  "am": {
    "name": "ስም",
    "email": "ኢሜይል",
    "rsvp": "የRSVP ሁኔታ",
    "late": "ዘግይቷል?",
    "joinTime": "የመቀላቀያ ሰዓት",
    "leaveTime": "የመውጫ ሰዓት",
    "duration": "ቆይታ (ደቂቃ)",
    "pct": "የተሳትፎ %",
    "sessions": "ክፍለ-ጊዜዎች",
    "status": "ሁኔታ",
    "checkedIn": "ተመዝግቧል"
  },
  "si": {
    "name": "නම",
    "email": "විද්‍යුත් තැපෑල",
    "rsvp": "RSVP තත්වය",
    "late": "ප්‍රමාදද?",
    "joinTime": "සම්බන්ධ වූ වේලාව",
    "leaveTime": "ඉවත් වූ වේලාව",
    "duration": "කාලය (මිනි)",
    "pct": "පැමිණීම %",
    "sessions": "සැසි",
    "status": "තත්වය",
    "checkedIn": "ලියාපදිංචි වී ඇත"
  },
  "el": {
    "name": "Όνομα",
    "email": "Email",
    "rsvp": "Κατάσταση RSVP",
    "late": "Καθυστερημένος;",
    "joinTime": "Ώρα εισόδου",
    "leaveTime": "Ώρα εξόδου",
    "duration": "Διάρκεια (λεπτά)",
    "pct": "% Παρουσίας",
    "sessions": "Συνεδρίες",
    "status": "Κατάσταση",
    "checkedIn": "Καταχωρήθηκε"
  },
  "no": {
    "name": "Navn",
    "email": "E-post",
    "rsvp": "RSVP-status",
    "late": "Forsinket?",
    "joinTime": "Tidspunkt tilkoblet",
    "leaveTime": "Tidspunkt frakoblet",
    "duration": "Varighet (min)",
    "pct": "Oppmøte %",
    "sessions": "Økter",
    "status": "Status",
    "checkedIn": "Innsjekket"
  },
  "ca": {
    "name": "Nom",
    "email": "Correu electrònic",
    "rsvp": "Estat RSVP",
    "late": "Amb retard?",
    "joinTime": "Hora d'entrada",
    "leaveTime": "Hora de sortida",
    "duration": "Durada (min)",
    "pct": "% Assistència",
    "sessions": "Sessions",
    "status": "Estat",
    "checkedIn": "Registrat"
  },
  "ne": {
    "name": "नाम",
    "email": "इमेल",
    "rsvp": "RSVP स्थिति",
    "late": "ढिलो?",
    "joinTime": "सामेल भएको समय",
    "leaveTime": "छोडेको समय",
    "duration": "अवधि (मिनेट)",
    "pct": "उपस्थिति %",
    "sessions": "सत्रहरू",
    "status": "स्थिति",
    "checkedIn": "चेक इन गरिएको"
  },
  "ml": {
    "name": "പേര്",
    "email": "ഇമെയിൽ",
    "rsvp": "RSVP സ്റ്റാറ്റസ്",
    "late": "വൈകിയോ?",
    "joinTime": "ചേർന്ന സമയം",
    "leaveTime": "ഇറങ്ങിയ സമയം",
    "duration": "ദൈർഘ്യം (മിനിറ്റ്)",
    "pct": "ഹാജർ %",
    "sessions": "സെഷനുകൾ",
    "status": "സ്റ്റാറ്റസ്",
    "checkedIn": "ചെക്ക് ഇൻ ചെയ്തു"
  },
  "mn": {
    "name": "Нэр",
    "email": "Имэйл",
    "rsvp": "RSVP төлөв",
    "late": "Хоцорсон уу?",
    "joinTime": "Нэвтэрсэн цаг",
    "leaveTime": "Гарсан цаг",
    "duration": "Хугацаа (мин)",
    "pct": "Ирц %",
    "sessions": "Хичээлүүд",
    "status": "Төлөв",
    "checkedIn": "Бүртгүүлсэн"
  },
  "kn": {
    "name": "ಹೆಸರು",
    "email": "ಇಮೇಲ್",
    "rsvp": "RSVP ಸ್ಥಿತಿ",
    "late": "ತಡವಾಗಿ?",
    "joinTime": "ಸೇರಿದ ಸಮಯ",
    "leaveTime": "ನಿರ್ಗಮಿಸಿದ ಸಮಯ",
    "duration": "ಅವಧಿ (ನಿಮಿಷ)",
    "pct": "ಹಾಜರಾತಿ %",
    "sessions": "ಅಧಿವೇಶನಗಳು",
    "status": "ಸ್ಥಿತಿ",
    "checkedIn": "ದಾಖಲಿಸಲಾಗಿದೆ"
  },
  "gu": {
    "name": "નામ",
    "email": "ઇમેઇલ",
    "rsvp": "RSVP સ્થિતિ",
    "late": "મોડું થયું?",
    "joinTime": "જોડાયાનો સમય",
    "leaveTime": "છોડ્યાનો સમય",
    "duration": "સમયગાળો (મિનિટ)",
    "pct": "હાજરી %",
    "sessions": "સત્રો",
    "status": "સ્થિતિ",
    "checkedIn": "ચેક-ઇન કર્યું"
  },
  "pa": {
    "name": "ਨਾਮ",
    "email": "ਈਮੇਲ",
    "rsvp": "RSVP ਸਥਿਤੀ",
    "late": "ਦੇਰ ਨਾਲ?",
    "joinTime": "ਸ਼ਾਮਲ ਹੋਣ ਦਾ ਸਮਾਂ",
    "leaveTime": "ਛੱਡਣ ਦਾ ਸਮਾਂ",
    "duration": "ਮਿਆਦ (ਮਿੰਟ)",
    "pct": "ਹਾਜ਼ਰੀ %",
    "sessions": "ਸੈਸ਼ਨ",
    "status": "ਸਥਿਤੀ",
    "checkedIn": "ਚੈੱਕ ਇਨ ਕੀਤਾ"
  },
  "kk": {
    "name": "Аты-жөні",
    "email": "Эл. пошта",
    "rsvp": "RSVP күйі",
    "late": "Кешікті ме?",
    "joinTime": "Қосылу уақыты",
    "leaveTime": "Шығу уақыты",
    "duration": "Ұзақтығы (мин)",
    "pct": "Қатысу %",
    "sessions": "Сессиялар",
    "status": "Күйі",
    "checkedIn": "Тіркелді"
  },
  "lv": {
    "name": "Vārds",
    "email": "E-pasts",
    "rsvp": "RSVP statuss",
    "late": "Kavēja?",
    "joinTime": "Pievienošanās laiks",
    "leaveTime": "Izrakstīšanās laiks",
    "duration": "Ilgums (min)",
    "pct": "Apmeklējums %",
    "sessions": "Sesijas",
    "status": "Statuss",
    "checkedIn": "Reģistrēts"
  },
  "lt": {
    "name": "Vardas",
    "email": "El. paštas",
    "rsvp": "RSVP būsena",
    "late": "Pavėlavo?",
    "joinTime": "Prisijungimo laikas",
    "leaveTime": "Atsijungimo laikas",
    "duration": "Trukmė (min.)",
    "pct": "Lankomumas %",
    "sessions": "Sesijos",
    "status": "Būsena",
    "checkedIn": "Užregistruotas"
  },
  "lo": {
    "name": "ຊື່",
    "email": "ອີເມວ",
    "rsvp": "ສະຖານະ RSVP",
    "late": "ມາຊ້າບໍ?",
    "joinTime": "ເວລາເຂົ້າຮ່ວມ",
    "leaveTime": "ເວລາອອກ",
    "duration": "ໄລຍະເວລາ (ນາທີ)",
    "pct": "ການເຂົ້າຮ່ວມ %",
    "sessions": "ຮອບການປະຊຸມ",
    "status": "ສະຖານະ",
    "checkedIn": "ເຊັກອິນແລ້ວ"
  },
  "my": {
    "name": "အမည်",
    "email": "အီးမေးလ်",
    "rsvp": "RSVP အခြေအနေ",
    "late": "နောက်ကျသလား?",
    "joinTime": "ဝင်ရောက်ချိန်",
    "leaveTime": "ထွက်ခွာချိန်",
    "duration": "ကြာချိန် (မိနစ်)",
    "pct": "တက်ရောက်မှု %",
    "sessions": "စက်ရှင်များ",
    "status": "အခြေအနေ",
    "checkedIn": "ဝင်ရောက်ပြီး"
  },
  "km": {
    "name": "ឈ្មោះ",
    "email": "អ៊ីមែល",
    "rsvp": "ស្ថានភាព RSVP",
    "late": "យឺតទេ?",
    "joinTime": "ម៉ោងចូលរួម",
    "leaveTime": "ម៉ោងចាកចេញ",
    "duration": "រយៈពេល (នាទី)",
    "pct": "វត្តមាន %",
    "sessions": "វគ្គប្រជុំ",
    "status": "ស្ថានភាព",
    "checkedIn": "បានចុះឈ្មោះ"
  },
  "ceb": {
    "name": "Ngalan",
    "email": "Email",
    "rsvp": "Kahimtang sa RSVP",
    "late": "Naulahi?",
    "joinTime": "Oras sa Pagsulod",
    "leaveTime": "Oras sa Paggula",
    "duration": "Gidugayon (min)",
    "pct": "Pagtambong %",
    "sessions": "Mga Sesyon",
    "status": "Kahimtang",
    "checkedIn": "Naka-check in"
  },
  "bg": {
    "name": "Име",
    "email": "Имейл",
    "rsvp": "RSVP статус",
    "late": "Закъснял?",
    "joinTime": "Време на присъединяване",
    "leaveTime": "Време на напускане",
    "duration": "Продължителност (мин)",
    "pct": "Присъствие %",
    "sessions": "Сесии",
    "status": "Статус",
    "checkedIn": "Регистриран"
  },
  "hr": {
    "name": "Ime",
    "email": "E-pošta",
    "rsvp": "RSVP status",
    "late": "Kasni?",
    "joinTime": "Vrijeme ulaska",
    "leaveTime": "Vrijeme izlaska",
    "duration": "Trajanje (min)",
    "pct": "Prisutnost %",
    "sessions": "Sesije",
    "status": "Status",
    "checkedIn": "Prijavljen"
  },
  "sr": {
    "name": "Име",
    "email": "Е-пошта",
    "rsvp": "RSVP статус",
    "late": "Касни?",
    "joinTime": "Време приступања",
    "leaveTime": "Време напуштања",
    "duration": "Трајање (мин)",
    "pct": "Присуство %",
    "sessions": "Сесије",
    "status": "Статус",
    "checkedIn": "Пријављен"
  },
  "sk": {
    "name": "Meno",
    "email": "E-mail",
    "rsvp": "Stav RSVP",
    "late": "Meškanie?",
    "joinTime": "Čas pripojenia",
    "leaveTime": "Čas odchodu",
    "duration": "Trvanie (min)",
    "pct": "Účasť %",
    "sessions": "Relácie",
    "status": "Stav",
    "checkedIn": "Zaregistrovaný"
  },
  "sl": {
    "name": "Ime",
    "email": "E-pošta",
    "rsvp": "Stanje RSVP",
    "late": "Zamuda?",
    "joinTime": "Čas pridružitve",
    "leaveTime": "Čas odhoda",
    "duration": "Trajanje (min)",
    "pct": "Prisotnost %",
    "sessions": "Seje",
    "status": "Stanje",
    "checkedIn": "Prijavljen"
  },
  "af": {
    "name": "Naam",
    "email": "E-pos",
    "rsvp": "RSVP-status",
    "late": "Laat?",
    "joinTime": "Aansluittyd",
    "leaveTime": "Verlaattyd",
    "duration": "Duur (min)",
    "pct": "Bywoning %",
    "sessions": "Sessies",
    "status": "Status",
    "checkedIn": "Ingeklok"
  }
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
  "hi": {
    "meeting": "मीटिंग",
    "meetingId": "मीटिंग आईडी",
    "type": "प्रकार",
    "scheduledRange": "निर्धारित समय",
    "scheduledEvent": "निर्धारित कार्यक्रम",
    "instantMeeting": "तत्काल मीटिंग",
    "date": "तारीख",
    "duration": "अवधि (मिनट)",
    "totalInvited": "कुल आमंत्रित",
    "totalAttended": "कुल उपस्थित",
    "attendanceRate": "उपस्थिति दर"
  },
  "bn": {
    "meeting": "মিটিং",
    "meetingId": "মিটিং आईडी",
    "type": "ধরন",
    "scheduledRange": "নির্ধারিত সময়",
    "scheduledEvent": "নির্ধারিত ইভেন্ট",
    "instantMeeting": "তাৎক্ষণিক মিটিং",
    "date": "তারিখ",
    "duration": "সময়কাল (মিনিট)",
    "totalInvited": "মোট আমন্ত্রিত",
    "totalAttended": "মোট উপস্থিত",
    "attendanceRate": "উপস্থিতির হার"
  },
  "zh": {
    "meeting": "會議",
    "meetingId": "會議 ID",
    "type": "類型",
    "scheduledRange": "預定時間",
    "scheduledEvent": "預定活動",
    "instantMeeting": "即時會議",
    "date": "日期",
    "duration": "時長 (分鐘)",
    "totalInvited": "邀請總數",
    "totalAttended": "出席總數",
    "attendanceRate": "出席率"
  },
  "zh-CN": {
    "meeting": "会议",
    "meetingId": "会议 ID",
    "type": "类型",
    "scheduledRange": "预定时间",
    "scheduledEvent": "预定活动",
    "instantMeeting": "即时会议",
    "date": "日期",
    "duration": "时长 (分钟)",
    "totalInvited": "邀请总数",
    "totalAttended": "出席总数",
    "attendanceRate": "出席率"
  },
  "ja": {
    "meeting": "ミーティング",
    "meetingId": "ミーティングID",
    "type": "タイプ",
    "scheduledRange": "予定時間",
    "scheduledEvent": "スケジュールされた予定",
    "instantMeeting": "今すぐ開始した会議",
    "date": "日付",
    "duration": "滞在時間 (分)",
    "totalInvited": "招待者総数",
    "totalAttended": "参加者総数",
    "attendanceRate": "出席率"
  },
  "ru": {
    "meeting": "Встреча",
    "meetingId": "ID встречи",
    "type": "Тип",
    "scheduledRange": "Запланированное время",
    "scheduledEvent": "Запланированное событие",
    "instantMeeting": "Быстрая встреча",
    "date": "Дата",
    "duration": "Длительность (мин)",
    "totalInvited": "Всего приглашено",
    "totalAttended": "Всего присутствовало",
    "attendanceRate": "Процент посещаемости"
  },
  "tr": {
    "meeting": "Toplantı",
    "meetingId": "Toplantı Kimliği",
    "type": "Tür",
    "scheduledRange": "Planlanan Zaman",
    "scheduledEvent": "Planlanan Etkinlik",
    "instantMeeting": "Anlık Toplantı",
    "date": "Tarih",
    "duration": "Süre (dk)",
    "totalInvited": "Toplam Davetli",
    "totalAttended": "Toplam Katılan",
    "attendanceRate": "Katılım Oranı"
  },
  "pt": {
    "meeting": "Reunião",
    "meetingId": "ID da Reunião",
    "type": "Tipo",
    "scheduledRange": "Horário Agendado",
    "scheduledEvent": "Evento Agendado",
    "instantMeeting": "Reunião Instantânea",
    "date": "Data",
    "duration": "Duração (min)",
    "totalInvited": "Total de Convidados",
    "totalAttended": "Total Presente",
    "attendanceRate": "Taxa de Presença"
  },
  "es": {
    "meeting": "Reunión",
    "meetingId": "ID de la Reunión",
    "type": "Tipo",
    "scheduledRange": "Hora Programada",
    "scheduledEvent": "Evento Programado",
    "instantMeeting": "Reunión Instantánea",
    "date": "Fecha",
    "duration": "Duración (min)",
    "totalInvited": "Total Invitados",
    "totalAttended": "Total Asistentes",
    "attendanceRate": "Tasa de Asistencia"
  },
  "fr": {
    "meeting": "Réunion",
    "meetingId": "ID de la Réunion",
    "type": "Type",
    "scheduledRange": "Heure Prévue",
    "scheduledEvent": "Événement Programmé",
    "instantMeeting": "Réunion Instantanée",
    "date": "Date",
    "duration": "Durée (min)",
    "totalInvited": "Total Invités",
    "totalAttended": "Total Participants",
    "attendanceRate": "Taux de Présence"
  },
  "de": {
    "meeting": "Meeting",
    "meetingId": "Meeting-ID",
    "type": "Typ",
    "scheduledRange": "Geplante Zeit",
    "scheduledEvent": "Geplantes Ereignis",
    "instantMeeting": "Sofort-Meeting",
    "date": "Datum",
    "duration": "Dauer (Min.)",
    "totalInvited": "Insgesamt Eingeladen",
    "totalAttended": "Insgesamt Anwesend",
    "attendanceRate": "Anwesenheitsrate"
  },
  "it": {
    "meeting": "Riunione",
    "meetingId": "ID Riunione",
    "type": "Tipo",
    "scheduledRange": "Orario Programmato",
    "scheduledEvent": "Evento Programmato",
    "instantMeeting": "Riunione Istantanea",
    "date": "Data",
    "duration": "Durata (min)",
    "totalInvited": "Totale Invitati",
    "totalAttended": "Totale Presenti",
    "attendanceRate": "Tasso di Presenza"
  },
  "nl": {
    "meeting": "Vergadering",
    "meetingId": "Vergadering-ID",
    "type": "Type",
    "scheduledRange": "Geplande Tijd",
    "scheduledEvent": "Gepland Evenement",
    "instantMeeting": "Directe Vergadering",
    "date": "Datum",
    "duration": "Duur (min)",
    "totalInvited": "Totaal Uitgenodigd",
    "totalAttended": "Totaal Aanwezig",
    "attendanceRate": "Aanwezigheidspercentage"
  },
  "pl": {
    "meeting": "Spotkanie",
    "meetingId": "ID spotkania",
    "type": "Typ",
    "scheduledRange": "Zaplanowany czas",
    "scheduledEvent": "Zaplanowane wydarzenie",
    "instantMeeting": "Spotkanie natychmiastowe",
    "date": "Data",
    "duration": "Czas trwania (min)",
    "totalInvited": "Łącznie zaproszonych",
    "totalAttended": "Łącznie obecnych",
    "attendanceRate": "Wskaźnik obecności"
  },
  "vi": {
    "meeting": "Cuộc họp",
    "meetingId": "ID cuộc họp",
    "type": "Loại",
    "scheduledRange": "Thời gian đã lên lịch",
    "scheduledEvent": "Sự kiện đã lên lịch",
    "instantMeeting": "Cuộc họp tức thì",
    "date": "Ngày",
    "duration": "Thời lượng (phút)",
    "totalInvited": "Tổng số người được mời",
    "totalAttended": "Tổng số người tham dự",
    "attendanceRate": "Tỷ lệ tham dự"
  },
  "id": {
    "meeting": "Rapat",
    "meetingId": "ID Rapat",
    "type": "Jenis",
    "scheduledRange": "Waktu Terjadwal",
    "scheduledEvent": "Acara Terjadwal",
    "instantMeeting": "Rapat Instan",
    "date": "Tanggal",
    "duration": "Durasi (menit)",
    "totalInvited": "Total Diundang",
    "totalAttended": "Total Hadir",
    "attendanceRate": "Tingkat Kehadiran"
  },
  "ko": {
    "meeting": "회의",
    "meetingId": "회의 ID",
    "type": "유형",
    "scheduledRange": "예약된 시간",
    "scheduledEvent": "예약된 일정",
    "instantMeeting": "즉석 회의",
    "date": "날짜",
    "duration": "시간 (분)",
    "totalInvited": "총 초대 인원",
    "totalAttended": "총 참석 인원",
    "attendanceRate": "출석률"
  },
  "ar": {
    "meeting": "اجتماع",
    "meetingId": "معرف الاجتماع",
    "type": "النوع",
    "scheduledRange": "الوقت المحدد",
    "scheduledEvent": "الحدث المحدد",
    "instantMeeting": "اجتماع فوري",
    "date": "التاريخ",
    "duration": "المدة (دقيقة)",
    "totalInvited": "إجمالي المدعوين",
    "totalAttended": "إجمالي الحاضرين",
    "attendanceRate": "نسبة الحضور"
  },
  "th": {
    "meeting": "การประชุม",
    "meetingId": "รหัสการประชุม",
    "type": "ประเภท",
    "scheduledRange": "เวลาที่กำหนด",
    "scheduledEvent": "กิจกรรมที่กำหนด",
    "instantMeeting": "การประชุมทันที",
    "date": "วันที่",
    "duration": "ระยะเวลา (นาที)",
    "totalInvited": "จำนวนผู้ได้รับเชิญทั้งหมด",
    "totalAttended": "จำนวนผู้เข้าร่วมทั้งหมด",
    "attendanceRate": "อัตราการเข้าร่วม"
  },
  "ro": {
    "meeting": "Întâlnire",
    "meetingId": "ID Întâlnire",
    "type": "Tip",
    "scheduledRange": "Ora programată",
    "scheduledEvent": "Eveniment programat",
    "instantMeeting": "Întâlnire instant",
    "date": "Data",
    "duration": "Durată (min)",
    "totalInvited": "Total invitați",
    "totalAttended": "Total prezenți",
    "attendanceRate": "Rată de prezență"
  },
  "uk": {
    "meeting": "Зустріч",
    "meetingId": "ID зустрічі",
    "type": "Тип",
    "scheduledRange": "Запланований час",
    "scheduledEvent": "Запланована подія",
    "instantMeeting": "Миттєва зустріч",
    "date": "Дата",
    "duration": "Тривалість (хв)",
    "totalInvited": "Всього запрошено",
    "totalAttended": "Всього присутніх",
    "attendanceRate": "Відсоток відвідуваності"
  },
  "cs": {
    "meeting": "Schůzka",
    "meetingId": "ID schůzky",
    "type": "Typ",
    "scheduledRange": "Naplánovaný čas",
    "scheduledEvent": "Naplánovaná událost",
    "instantMeeting": "Okamžitá schůzka",
    "date": "Datum",
    "duration": "Délka (min)",
    "totalInvited": "Celkem pozvaných",
    "totalAttended": "Celkem přítomných",
    "attendanceRate": "Míra účasti"
  },
  "da": {
    "meeting": "Møde",
    "meetingId": "Møde-ID",
    "type": "Type",
    "scheduledRange": "Planlagt tid",
    "scheduledEvent": "Planlagt begivenhed",
    "instantMeeting": "Øjeblikkeligt møde",
    "date": "Dato",
    "duration": "Varighed (min)",
    "totalInvited": "Inviterede i alt",
    "totalAttended": "Deltagere i alt",
    "attendanceRate": "Deltagelsesrate"
  },
  "sv": {
    "meeting": "Möte",
    "meetingId": "Mötes-ID",
    "type": "Typ",
    "scheduledRange": "Schemalagd tid",
    "scheduledEvent": "Schemalagd händelse",
    "instantMeeting": "Direktmöte",
    "date": "Datum",
    "duration": "Längd (min)",
    "totalInvited": "Totalt inbjudna",
    "totalAttended": "Totalt närvarande",
    "attendanceRate": "Närvarograd"
  },
  "el": {
    "meeting": "Συνάντηση",
    "meetingId": "ID συνάντησης",
    "type": "Τύπος",
    "scheduledRange": "Προγραμματισμένη ώρα",
    "scheduledEvent": "Προγραμματισμένο συμβάν",
    "instantMeeting": "Άμεση συνάντηση",
    "date": "Ημερομηνία",
    "duration": "Διάρκεια (λεπτά)",
    "totalInvited": "Σύνολο προσκεκλημένων",
    "totalAttended": "Σύνολο παρόντων",
    "attendanceRate": "Ποσοστό παρουσίας"
  },
  "ca": {
    "meeting": "Reunió",
    "meetingId": "ID de reunió",
    "type": "Tipus",
    "scheduledRange": "Hora programada",
    "scheduledEvent": "Esdeveniment programat",
    "instantMeeting": "Reunió instantània",
    "date": "Data",
    "duration": "Durada (min)",
    "totalInvited": "Total convidats",
    "totalAttended": "Total assistents",
    "attendanceRate": "Taxa d'assistència"
  },
  "ne": {
    "meeting": "बैठक",
    "meetingId": "बैठक आईडी",
    "type": "प्रकार",
    "scheduledRange": "निर्धारित समय",
    "scheduledEvent": "निर्धारित कार्यक्रम",
    "instantMeeting": "तत्काल बैठक",
    "date": "मिति",
    "duration": "अवधि (मिनेट)",
    "totalInvited": "कुल आमन्त्रित",
    "totalAttended": "कुल उपस्थित",
    "attendanceRate": "उपस्थिति दर"
  },
  "ml": {
    "meeting": "മീറ്റിംഗ്",
    "meetingId": "മീറ്റിംഗ് ഐഡി",
    "type": "തരം",
    "scheduledRange": "നിശ്ചയിച്ച സമയം",
    "scheduledEvent": "നിശ്ചയിച്ച ഇവന്റ്",
    "instantMeeting": "തൽക്ഷണ മീറ്റിംഗ്",
    "date": "തീയതി",
    "duration": "ദൈർഘ്യം (മിനിറ്റ്)",
    "totalInvited": "ആകെ ക്ഷണിക്കപ്പെട്ടവർ",
    "totalAttended": "ആകെ പങ്കെടുത്തവർ",
    "attendanceRate": "ഹാജർ നിരക്ക്"
  },
  "mn": {
    "meeting": "Уулзалт",
    "meetingId": "Уулзалтын ID",
    "type": "Төрөл",
    "scheduledRange": "Төлөвлөсөн цаг",
    "scheduledEvent": "Төлөвлөсөн арга хэмжээ",
    "instantMeeting": "Шуурхай уулзалт",
    "date": "Огноо",
    "duration": "Хугацаа (мин)",
    "totalInvited": "Нийт уригдсан",
    "totalAttended": "Нийт оролцсон",
    "attendanceRate": "Ирцийн хувь"
  },
  "ta": {
    "meeting": "கூட்டம்",
    "meetingId": "கூட்ட ஐடி",
    "type": "வகை",
    "scheduledRange": "திட்டமிடப்பட்ட நேரம்",
    "scheduledEvent": "திட்டமிடப்பட்ட நிகழ்வு",
    "instantMeeting": "உடனடி கூட்டம்",
    "date": "தேதி",
    "duration": "கால அளவு (நிமிடம்)",
    "totalInvited": "மொத்த அழைக்கப்பட்டவர்கள்",
    "totalAttended": "மொத்த பங்கேற்பாளர்கள்",
    "attendanceRate": "வருகை விகிதம்"
  },
  "te": {
    "meeting": "సమావేశం",
    "meetingId": "సమావేశం ID",
    "type": "రకం",
    "scheduledRange": "షెడ్యూల్ చేసిన సమయం",
    "scheduledEvent": "షెడ్యూల్ చేసిన ఈవెంట్",
    "instantMeeting": "తక్షణ సమావేశం",
    "date": "తేదీ",
    "duration": "వ్యవధి (నిమిషాలు)",
    "totalInvited": "మొత్తం ఆహ్వానితులు",
    "totalAttended": "మొత్తం హాజరైనవారు",
    "attendanceRate": "హాజరు శాతం"
  },
  "mr": {
    "meeting": "मीटिंग",
    "meetingId": "मीटिंग आयडी",
    "type": "प्रकार",
    "scheduledRange": "नियोजित वेळ",
    "scheduledEvent": "नियोजित कार्यक्रम",
    "instantMeeting": "तात्काळ मीटिंग",
    "date": "तारीख",
    "duration": "कालावधी (मिनिटे)",
    "totalInvited": "एकूण आमंत्रित",
    "totalAttended": "एकूण उपस्थित",
    "attendanceRate": "उपस्थिती दर"
  },
  "ur": {
    "meeting": "میٹنگ",
    "meetingId": "میٹنگ آئی ڈی",
    "type": "قسم",
    "scheduledRange": "طے شدہ وقت",
    "scheduledEvent": "طے شدہ تقریب",
    "instantMeeting": "فوری میٹنگ",
    "date": "تاریخ",
    "duration": "دورانیہ (منٹ)",
    "totalInvited": "کل مدعوئین",
    "totalAttended": "کل حاضرین",
    "attendanceRate": "حاضری کی شرح"
  },
  "tl": {
    "meeting": "Pulong",
    "meetingId": "ID ng Pulong",
    "type": "Uri",
    "scheduledRange": "Nakatakdang Oras",
    "scheduledEvent": "Nakatakdang Kaganapan",
    "instantMeeting": "Mabilisang Pulong",
    "date": "Petsa",
    "duration": "Tagal (min)",
    "totalInvited": "Kabuuang Inimbitahan",
    "totalAttended": "Kabuuang Dumalo",
    "attendanceRate": "Antas ng Pagdalo"
  },
  "ms": {
    "meeting": "Mesyuarat",
    "meetingId": "ID Mesyuarat",
    "type": "Jenis",
    "scheduledRange": "Masa Dijadualkan",
    "scheduledEvent": "Acara Dijadualkan",
    "instantMeeting": "Mesyuarat Segera",
    "date": "Tarikh",
    "duration": "Tempoh (min)",
    "totalInvited": "Jumlah Dijemput",
    "totalAttended": "Jumlah Hadir",
    "attendanceRate": "Kadar Kehadiran"
  },
  "he": {
    "meeting": "פגישה",
    "meetingId": "מזהה פגישה",
    "type": "סוג",
    "scheduledRange": "זמן מתוזמן",
    "scheduledEvent": "אירוע מתוזמן",
    "instantMeeting": "פגישה מיידית",
    "date": "תאריך",
    "duration": "משך (דקות)",
    "totalInvited": "סה\"כ מוזמנים",
    "totalAttended": "סה\"כ נוכחים",
    "attendanceRate": "אחוז נוכחות"
  },
  "fi": {
    "meeting": "Kokous",
    "meetingId": "Kokoustunnus",
    "type": "Tyyppi",
    "scheduledRange": "Aikataulutettu aika",
    "scheduledEvent": "Aikataulutettu tapahtuma",
    "instantMeeting": "Pikakokous",
    "date": "Päivämäärä",
    "duration": "Kesto (min)",
    "totalInvited": "Kutsutut yhteensä",
    "totalAttended": "Osallistujat yhteensä",
    "attendanceRate": "Osallistumisaste"
  },
  "hu": {
    "meeting": "Értekezlet",
    "meetingId": "Értekezlet azonosító",
    "type": "Típus",
    "scheduledRange": "Ütemezett időpont",
    "scheduledEvent": "Ütemezett esemény",
    "instantMeeting": "Azonnali értekezlet",
    "date": "Dátum",
    "duration": "Időtartam (perc)",
    "totalInvited": "Összes meghívott",
    "totalAttended": "Összes résztvevő",
    "attendanceRate": "Részvételi arány"
  },
  "so": {
    "meeting": "Kulan",
    "meetingId": "Aqoonsiga Kulanka",
    "type": "Nooca",
    "scheduledRange": "Waqtiga Qorshaysan",
    "scheduledEvent": "Dhacdada Qorshaysan",
    "instantMeeting": "Kulan Degdeg ah",
    "date": "Taariikhda",
    "duration": "Muddada (daqiiqo)",
    "totalInvited": "Wadarta La Casumay",
    "totalAttended": "Wadarta Ka Qaybgashay",
    "attendanceRate": "Heerka Xaadirinta"
  },
  "sw": {
    "meeting": "Mkutano",
    "meetingId": "Kitambulisho cha Mkutano",
    "type": "Aina",
    "scheduledRange": "Muda Uliopangwa",
    "scheduledEvent": "Tukio Lililopangwa",
    "instantMeeting": "Mkutano wa Papo Hapo",
    "date": "Tarehe",
    "duration": "Muda (dak)",
    "totalInvited": "Jumla ya Walioalikwa",
    "totalAttended": "Jumla ya Waliohudhuria",
    "attendanceRate": "Kiwango cha Mahudhurio"
  },
  "am": {
    "meeting": "ስብሰባ",
    "meetingId": "የስብሰባ መታወቂያ",
    "type": "ዓይነት",
    "scheduledRange": "የተያዘለት ጊዜ",
    "scheduledEvent": "የተያዘለት ዝግጅት",
    "instantMeeting": "አስቸኳይ ስብሰባ",
    "date": "ቀን",
    "duration": "የፈጀው ጊዜ (ደቂቃ)",
    "totalInvited": "አጠቃላይ የተጋበዙ",
    "totalAttended": "አጠቃላይ የተገኙ",
    "attendanceRate": "የተሳትፎ መጠን"
  },
  "si": {
    "meeting": "රැස්වීම",
    "meetingId": "රැස්වීම් හැඳුනුම්පත",
    "type": "වර්ගය",
    "scheduledRange": "නියමිත වේලාව",
    "scheduledEvent": "නියමිත සිදුවීම",
    "instantMeeting": "ක්ෂණික රැස්වීම",
    "date": "දිනය",
    "duration": "කාලසීමාව (මිනි)",
    "totalInvited": "මුළු ආරාධිතයන්",
    "totalAttended": "මුළු පැමිණීම",
    "attendanceRate": "පැමිණීමේ අනුපාතය"
  },
  "no": {
    "meeting": "Møte",
    "meetingId": "Møte-ID",
    "type": "Type",
    "scheduledRange": "Planlagt tid",
    "scheduledEvent": "Planlagt hendelse",
    "instantMeeting": "Direktemøte",
    "date": "Dato",
    "duration": "Varighet (min)",
    "totalInvited": "Totalt inviterte",
    "totalAttended": "Totalt tilstede",
    "attendanceRate": "Oppmøteprosent"
  },
  "kn": {
    "meeting": "ಸಭೆ",
    "meetingId": "ಸಭೆಯ ID",
    "type": "ಪ್ರಕಾರ",
    "scheduledRange": "ನಿಗದಿತ ಸಮಯ",
    "scheduledEvent": "ನಿಗದಿತ ಕಾರ್ಯಕ್ರಮ",
    "instantMeeting": "ತ್ವರಿತ ಸಭೆ",
    "date": "ದಿನಾಂಕ",
    "duration": "ಅವಧಿ (ನಿಮಿಷ)",
    "totalInvited": "ಒಟ್ಟು ಆಹ್ವಾನಿತರು",
    "totalAttended": "ಒಟ್ಟು ಹಾಜರಾದವರು",
    "attendanceRate": "ಹಾಜರಾತಿ ದರ"
  },
  "gu": {
    "meeting": "મીટિંગ",
    "meetingId": "મીટિંગ ID",
    "type": "પ્રકાર",
    "scheduledRange": "નિયત સમય",
    "scheduledEvent": "નિયત કાર્યક્રમ",
    "instantMeeting": "ત્વરિત મીટિંગ",
    "date": "તારીખ",
    "duration": "સમયગાળો (મિનિટ)",
    "totalInvited": "કુલ આમંત્રિત",
    "totalAttended": "કુલ ઉપસ્થિત",
    "attendanceRate": "હાજરી દર"
  },
  "pa": {
    "meeting": "ਮੀਟਿੰਗ",
    "meetingId": "ਮੀਟਿੰਗ ID",
    "type": "ਕਿਸਮ",
    "scheduledRange": "ਨਿਰਧਾਰਤ ਸਮਾਂ",
    "scheduledEvent": "ਨਿਰਧਾਰਤ ਸਮਾਗਮ",
    "instantMeeting": "ਤੁਰੰਤ ਮੀਟਿੰਗ",
    "date": "ਮਿਤੀ",
    "duration": "ਮਿਆਦ (ਮਿੰਟ)",
    "totalInvited": "ਕੁੱਲ ਸੱਦੇ ਗਏ",
    "totalAttended": "ਕੁੱਲ ਹਾਜ਼ਰ",
    "attendanceRate": "ਹਾਜ਼ਰੀ ਦਰ"
  },
  "kk": {
    "meeting": "Кездесу",
    "meetingId": "Кездесу ID-і",
    "type": "Түрі",
    "scheduledRange": "Жоспарланған уақыт",
    "scheduledEvent": "Жоспарланған шара",
    "instantMeeting": "Жедел кездесу",
    "date": "Күні",
    "duration": "Ұзақтығы (мин)",
    "totalInvited": "Барлық шақырылғандар",
    "totalAttended": "Барлық қатысқандар",
    "attendanceRate": "Қатысу пайызы"
  },
  "lv": {
    "meeting": "Sapulce",
    "meetingId": "Sapulces ID",
    "type": "Veids",
    "scheduledRange": "Ieplānotais laiks",
    "scheduledEvent": "Ieplānotais notikums",
    "instantMeeting": "Tūlītēja sapulce",
    "date": "Datums",
    "duration": "Ilgums (min)",
    "totalInvited": "Kopā uzaicināti",
    "totalAttended": "Kopā apmeklēja",
    "attendanceRate": "Apmeklējuma līmenis"
  },
  "lt": {
    "meeting": "Susitikimas",
    "meetingId": "Susitikimo ID",
    "type": "Tipas",
    "scheduledRange": "Suplanuotas laikas",
    "scheduledEvent": "Suplanuotas įvykis",
    "instantMeeting": "Greitas susitikimas",
    "date": "Data",
    "duration": "Trukmė (min.)",
    "totalInvited": "Iš viso pakviesta",
    "totalAttended": "Iš viso dalyvavo",
    "attendanceRate": "Lankomumo rodiklis"
  },
  "lo": {
    "meeting": "ການປະຊຸມ",
    "meetingId": "ລະຫັດການປະຊຸມ",
    "type": "ປະເພດ",
    "scheduledRange": "ເວລາກຳນົດໄວ້",
    "scheduledEvent": "ເຫດການກຳນົດໄວ້",
    "instantMeeting": "ການປະຊຸມທັນທີ",
    "date": "ວັນທີ",
    "duration": "ໄລຍະເວລາ (ນາທີ)",
    "totalInvited": "ຈຳນວນເຊີນທັງໝົດ",
    "totalAttended": "ຈຳນວນເຂົ້າຮ່ວມທັງໝົດ",
    "attendanceRate": "ອັດຕາການເຂົ້າຮ່ວມ"
  },
  "my": {
    "meeting": "အစည်းအဝေး",
    "meetingId": "အစည်းအဝေး ID",
    "type": "အမျိုးအစား",
    "scheduledRange": "သတ်မှတ်ချိန်",
    "scheduledEvent": "သတ်မှတ်ထားသောအစီအစဉ်",
    "instantMeeting": "ချက်ချင်းအစည်းအဝေး",
    "date": "ရက်စွဲ",
    "duration": "ကြာချိန် (မိနစ်)",
    "totalInvited": "စုစုပေါင်း ဖိတ်ကြားသူ",
    "totalAttended": "စုစုပေါင်း တက်ရောက်သူ",
    "attendanceRate": "တက်ရောက်မှုနှုန်း"
  },
  "km": {
    "meeting": "កិច្ចប្រជុំ",
    "meetingId": "លេខសម្គាល់កិច្ចប្រជុំ",
    "type": "ប្រភេទ",
    "scheduledRange": "ម៉ោងកំណត់ទុក",
    "scheduledEvent": "ព្រឹត្តិការណ៍កំណត់ទុក",
    "instantMeeting": "កិច្ចប្រជុំបន្ទាន់",
    "date": "កាលបរិច្ឆេទ",
    "duration": "រយៈពេល (នាទី)",
    "totalInvited": "អ្នកអញ្ជើញសរុប",
    "totalAttended": "អ្នកចូលរួមសរុប",
    "attendanceRate": "អត្រាវត្តមាន"
  },
  "ceb": {
    "meeting": "Tigom",
    "meetingId": "ID sa Tigom",
    "type": "Matang",
    "scheduledRange": "Gitakdang Oras",
    "scheduledEvent": "Gitakdang Kalihokan",
    "instantMeeting": "Dinalian nga Tigom",
    "date": "Petsa",
    "duration": "Gidugayon (min)",
    "totalInvited": "Kinatibuk-ang Gidapit",
    "totalAttended": "Kinatibuk-ang Mitambong",
    "attendanceRate": "Gidaghanon sa Pagtambong"
  },
  "bg": {
    "meeting": "Среща",
    "meetingId": "ID на срещата",
    "type": "Тип",
    "scheduledRange": "Планирано време",
    "scheduledEvent": "Планирано събитие",
    "instantMeeting": "Незабавна среща",
    "date": "Дата",
    "duration": "Продължителност (мин)",
    "totalInvited": "Общо поканени",
    "totalAttended": "Общо присъствали",
    "attendanceRate": "Процент присъствие"
  },
  "hr": {
    "meeting": "Sastanak",
    "meetingId": "ID sastanka",
    "type": "Vrsta",
    "scheduledRange": "Zakazano vrijeme",
    "scheduledEvent": "Zakazani događaj",
    "instantMeeting": "Trenutačni sastanak",
    "date": "Datum",
    "duration": "Trajanje (min)",
    "totalInvited": "Ukupno pozvano",
    "totalAttended": "Ukupno prisutno",
    "attendanceRate": "Stopa prisutnosti"
  },
  "sr": {
    "meeting": "Састанак",
    "meetingId": "ID састанка",
    "type": "Тип",
    "scheduledRange": "Заказано време",
    "scheduledEvent": "Заказани догађај",
    "instantMeeting": "Тренутни састанак",
    "date": "Датум",
    "duration": "Трајање (мин)",
    "totalInvited": "Укупно позвано",
    "totalAttended": "Укупно присутно",
    "attendanceRate": "Стопа присутности"
  },
  "sk": {
    "meeting": "Stretnutie",
    "meetingId": "ID stretnutia",
    "type": "Typ",
    "scheduledRange": "Naplánovaný čas",
    "scheduledEvent": "Naplánovaná udalosť",
    "instantMeeting": "Okamžité stretnutie",
    "date": "Dátum",
    "duration": "Trvanie (min)",
    "totalInvited": "Spolu pozvaných",
    "totalAttended": "Spolu prítomných",
    "attendanceRate": "Miera účasti"
  },
  "sl": {
    "meeting": "Sestanek",
    "meetingId": "ID sestanka",
    "type": "Vrsta",
    "scheduledRange": "Načrtovani čas",
    "scheduledEvent": "Načrtovani dogodek",
    "instantMeeting": "Takojšnji sestanek",
    "date": "Datum",
    "duration": "Trajanje (min)",
    "totalInvited": "Vseh povabljenih",
    "totalAttended": "Vseh prisotnih",
    "attendanceRate": "Stopnja prisotnosti"
  },
  "af": {
    "meeting": "Vergadering",
    "meetingId": "Vergadering-ID",
    "type": "Tipe",
    "scheduledRange": "Geskeduleerde tyd",
    "scheduledEvent": "Geskeduleerde geleentheid",
    "instantMeeting": "Kitsvergadering",
    "date": "Datum",
    "duration": "Duur (min)",
    "totalInvited": "Totaal genooi",
    "totalAttended": "Totaal bygewoon",
    "attendanceRate": "Bywoningskoers"
  }
};

function getSheetSummaryLabels(locale) {
  const norm = normalizeLocale(locale);
  return LOCALIZED_SUMMARY_LABELS[norm] || DEFAULT_SUMMARY_LABELS;
}

const STATUS_TRANSLATIONS = {
  "hi": {
    "Present": "उपस्थित",
    "Left": "छोड़ दिया",
    "Absent": "अनुपस्थित",
    "Absent (excused)": "अनुपस्थित (माफ)",
    "Late": "देर",
    "Left Early / Incomplete": "जल्दी छोड़ा / अधूरा",
    "Excused (Short Stay)": "माफ (कम समय)",
    "Present (Left)": "उपस्थित (छोड़ा)",
    "Guest (Present)": "अतिथि (उपस्थित)",
    "Guest (Left)": "अतिथि (छोड़ा)"
  },
  "bn": {
    "Present": "উপস্থিত",
    "Left": "চলে গেছে",
    "Absent": "অনুপস্থিত",
    "Absent (excused)": "অনুপস্থিত (অনুমোদিত)",
    "Late": "দেরি",
    "Left Early / Incomplete": "আগে চলে গেছে / অসম্পূর্ণ",
    "Excused (Short Stay)": "অনুমোদিত (স্বল্প সময়)",
    "Present (Left)": "উপস্থিত (চলে গেছে)",
    "Guest (Present)": "অতিথি (উপস্থিত)",
    "Guest (Left)": "অতিথি (চলে গেছে)"
  },
  "zh": {
    "Present": "出席",
    "Left": "已離開",
    "Absent": "缺席",
    "Absent (excused)": "缺席 (已請假)",
    "Late": "遲到",
    "Left Early / Incomplete": "早退 / 未全程參與",
    "Excused (Short Stay)": "已請假 (短暫停留)",
    "Present (Left)": "出席 (已離開)",
    "Guest (Present)": "來賓 (出席)",
    "Guest (Left)": "來賓 (已離開)"
  },
  "zh-CN": {
    "Present": "出席",
    "Left": "已离开",
    "Absent": "缺席",
    "Absent (excused)": "缺席 (已请假)",
    "Late": "迟到",
    "Left Early / Incomplete": "早退 / 未全程参与",
    "Excused (Short Stay)": "已请假 (短暂离开)",
    "Present (Left)": "出席 (已离开)",
    "Guest (Present)": "来宾 (出席)",
    "Guest (Left)": "来宾 (已离开)"
  },
  "ja": {
    "Present": "出席",
    "Left": "退出済",
    "Absent": "欠席",
    "Absent (excused)": "公欠",
    "Late": "遅刻",
    "Left Early / Incomplete": "早退 / 不完全",
    "Excused (Short Stay)": "公欠 (短時間滞在)",
    "Present (Left)": "出席 (退出)",
    "Guest (Present)": "ゲスト (出席)",
    "Guest (Left)": "ゲスト (退出)"
  },
  "pt": {
    "Present": "Presente",
    "Left": "Saiu",
    "Absent": "Ausente",
    "Absent (excused)": "Ausente (justificado)",
    "Late": "Atrasado",
    "Left Early / Incomplete": "Saiu antes / Incompleto",
    "Excused (Short Stay)": "Justificado (Estadia curta)",
    "Present (Left)": "Presente (Saiu)",
    "Guest (Present)": "Convidado (Presente)",
    "Guest (Left)": "Convidado (Saiu)"
  },
  "es": {
    "Present": "Presente",
    "Left": "Salió",
    "Absent": "Ausente",
    "Absent (excused)": "Ausente (justificado)",
    "Late": "Tarde",
    "Left Early / Incomplete": "Salió antes / Incompleto",
    "Excused (Short Stay)": "Justificado (Estadía corta)",
    "Present (Left)": "Presente (Salió)",
    "Guest (Present)": "Invitado (Presente)",
    "Guest (Left)": "Invitado (Salió)"
  },
  "fr": {
    "Present": "Présent",
    "Left": "Parti",
    "Absent": "Absent",
    "Absent (excused)": "Absent (excusé)",
    "Late": "En retard",
    "Left Early / Incomplete": "Parti plus tôt / Incomplet",
    "Excused (Short Stay)": "Excusé (Court séjour)",
    "Present (Left)": "Présent (Parti)",
    "Guest (Present)": "Invité (Présent)",
    "Guest (Left)": "Invité (Parti)"
  },
  "de": {
    "Present": "Anwesend",
    "Left": "Verlassen",
    "Absent": "Abwesend",
    "Absent (excused)": "Abwesend (entschuldigt)",
    "Late": "Verspätet",
    "Left Early / Incomplete": "Frühzeitig verlassen / Unvollständig",
    "Excused (Short Stay)": "Entschuldigt (Kurzer Aufenthalt)",
    "Present (Left)": "Anwesend (Verlassen)",
    "Guest (Present)": "Gast (Anwesend)",
    "Guest (Left)": "Gast (Verlassen)"
  },
  "it": {
    "Present": "Presente",
    "Left": "Uscito",
    "Absent": "Assente",
    "Absent (excused)": "Assente (giustificato)",
    "Late": "In ritardo",
    "Left Early / Incomplete": "Uscito prima / Incompleto",
    "Excused (Short Stay)": "Giustificato (Breve permanenza)",
    "Present (Left)": "Presente (Uscito)",
    "Guest (Present)": "Ospite (Presente)",
    "Guest (Left)": "Ospite (Uscito)"
  },
  "ru": {
    "Present": "Присутствовал",
    "Left": "Покинул",
    "Absent": "Отсутствовал",
    "Absent (excused)": "Отсутствовал (уваж.)",
    "Late": "Опоздал",
    "Left Early / Incomplete": "Ушёл раньше / Не полностью",
    "Excused (Short Stay)": "Уважительно (короткое преб.)",
    "Present (Left)": "Присутствовал (ушёл)",
    "Guest (Present)": "Гость (присутствовал)",
    "Guest (Left)": "Гость (ушёл)"
  },
  "tr": {
    "Present": "Katıldı",
    "Left": "Ayrıldı",
    "Absent": "Katılmadı",
    "Absent (excused)": "Mazeretli",
    "Late": "Geç Kaldı",
    "Left Early / Incomplete": "Erken Ayrıldı / Eksik",
    "Excused (Short Stay)": "Mazeretli (Kısa Süreli)",
    "Present (Left)": "Katıldı (Ayrıldı)",
    "Guest (Present)": "Misafir (Katıldı)",
    "Guest (Left)": "Misafir (Ayrıldı)"
  },
  "vi": {
    "Present": "Có mặt",
    "Left": "Đã rời",
    "Absent": "Vắng mặt",
    "Absent (excused)": "Vắng mặt (có phép)",
    "Late": "Đi muộn",
    "Left Early / Incomplete": "Rời sớm / Chưa hoàn thành",
    "Excused (Short Stay)": "Có phép (Ở lại ngắn)",
    "Present (Left)": "Có mặt (Đã rời)",
    "Guest (Present)": "Khách (Có mặt)",
    "Guest (Left)": "Khách (Đã rời)"
  },
  "id": {
    "Present": "Hadir",
    "Left": "Keluar",
    "Absent": "Tidak Hadir",
    "Absent (excused)": "Tidak Hadir (izin)",
    "Late": "Terlambat",
    "Left Early / Incomplete": "Keluar Lebih Awal / Tidak Lengkap",
    "Excused (Short Stay)": "Izin (Tinggal Singkat)",
    "Present (Left)": "Hadir (Keluar)",
    "Guest (Present)": "Tamu (Hadir)",
    "Guest (Left)": "Tamu (Keluar)"
  },
  "pl": {
    "Present": "Obecny",
    "Left": "Opuścił",
    "Absent": "Nieobecny",
    "Absent (excused)": "Nieobecny (usprawiedliwiony)",
    "Late": "Spóźniony",
    "Left Early / Incomplete": "Wyszedł wcześniej / Niepełny czas",
    "Excused (Short Stay)": "Usprawiedliwiony (Krótki pobyt)",
    "Present (Left)": "Obecny (Opuścił)",
    "Guest (Present)": "Gość (Obecny)",
    "Guest (Left)": "Gość (Opuścił)"
  },
  "ko": {
    "Present": "출석",
    "Left": "퇴장",
    "Absent": "결석",
    "Absent (excused)": "공결",
    "Late": "지각",
    "Left Early / Incomplete": "조퇴 / 미완료",
    "Excused (Short Stay)": "공결 (짧은 체류)",
    "Present (Left)": "출석 (퇴장)",
    "Guest (Present)": "게스트 (출석)",
    "Guest (Left)": "게스트 (퇴장)"
  },
  "ar": {
    "Present": "حاضر",
    "Left": "غادر",
    "Absent": "غائب",
    "Absent (excused)": "غائب (بعذر)",
    "Late": "متأخر",
    "Left Early / Incomplete": "غادر مبكراً / غير مكتمل",
    "Excused (Short Stay)": "معذور (إقامة قصيرة)",
    "Present (Left)": "حاضر (غادر)",
    "Guest (Present)": "ضيف (حاضر)",
    "Guest (Left)": "ضيف (غادر)"
  },
  "ne": {
    "Present": "उपस्थित",
    "Left": "छोडियो",
    "Absent": "अनुपस्थित",
    "Absent (excused)": "अनुपस्थित (माफ गरिएको)",
    "Late": "ढिलो",
    "Left Early / Incomplete": "छिटो छोडेको / अपूर्ण",
    "Excused (Short Stay)": "माफ गरिएको (छोटो बसाइ)",
    "Present (Left)": "उपस्थित (छोडियो)",
    "Guest (Present)": "अतिथि (उपस्थित)",
    "Guest (Left)": "अतिथि (छोडियो)"
  },
  "ml": {
    "Present": "ഹാജർ",
    "Left": "പുറത്തുപോയി",
    "Absent": "ഹാജരായില്ല",
    "Absent (excused)": "ഹാജരായില്ല (അനുവദിച്ചത്)",
    "Late": "വൈകി",
    "Left Early / Incomplete": "നേരത്തെ ഇറങ്ങി / അപൂർണ്ണം",
    "Excused (Short Stay)": "അനുവദിച്ചത് (കുറഞ്ഞ സമയം)",
    "Present (Left)": "ഹാജർ (പുറത്തുപോയി)",
    "Guest (Present)": "അതിഥി (ഹാജർ)",
    "Guest (Left)": "അതിഥി (പുറത്തുപോയി)"
  },
  "mn": {
    "Present": "Ирсэн",
    "Left": "Гарсан",
    "Absent": "Тасалсан",
    "Absent (excused)": "Тасалсан (чөлөөтэй)",
    "Late": "Хоцорсон",
    "Left Early / Incomplete": "Эрт гарсан / Дутуу",
    "Excused (Short Stay)": "Чөлөөтэй (богино хугацаа)",
    "Present (Left)": "Ирсэн (гарсан)",
    "Guest (Present)": "Зочин (ирсэн)",
    "Guest (Left)": "Зочин (гарсан)"
  },
  "ta": {
    "Present": "வந்தவர் (Present)",
    "Left": "வெளியேறினார்",
    "Absent": "வராதவர் (Absent)",
    "Absent (excused)": "வராதவர் (விலக்களிக்கப்பட்டவர்)",
    "Late": "தாமதம்",
    "Left Early / Incomplete": "முன்னதாக வெளியேறினார் / முழுமையடையவில்லை",
    "Excused (Short Stay)": "விலக்களிக்கப்பட்டது (குறுகிய தங்கல்)",
    "Present (Left)": "வந்தவர் (வெளியேறினார்)",
    "Guest (Present)": "விருந்தினர் (வந்தவர்)",
    "Guest (Left)": "விருந்தினர் (வெளியேறினார்)"
  },
  "te": {
    "Present": "హాజరయ్యారు (Present)",
    "Left": "నిష్క్రమించారు",
    "Absent": "హాజరుకాలేదు (Absent)",
    "Absent (excused)": "హాజరుకాలేదు (క్షమించబడింది)",
    "Late": "ఆలస్యం",
    "Left Early / Incomplete": "ముందుగానే నిష్క్రమించారు / అసంపూర్ణం",
    "Excused (Short Stay)": "క్షమించబడింది (స్వల్ప బస)",
    "Present (Left)": "హాజరయ్యారు (నిష్క్రమించారు)",
    "Guest (Present)": "అతిథి (హాజరయ్యారు)",
    "Guest (Left)": "అతిథి (నిష్క్రమించారు)"
  },
  "ur": {
    "Present": "حاضر (Present)",
    "Left": "چھوڑ دیا",
    "Absent": "غیر حاضر (Absent)",
    "Absent (excused)": "غیر حاضر (معذرت)",
    "Late": "تاخیر",
    "Left Early / Incomplete": "جلدی چلے گئے / نامکمل",
    "Excused (Short Stay)": "معذرت (مختصر قیام)",
    "Present (Left)": "حاضر (چھوڑ دیا)",
    "Guest (Present)": "مہمان (حاضر)",
    "Guest (Left)": "مہمان (چھوڑ دیا)"
  },
  "tl": {
    "Present": "Dumalo (Present)",
    "Left": "Umalis",
    "Absent": "Liban (Absent)",
    "Absent (excused)": "Liban (may paumanhin)",
    "Late": "Huli (Late)",
    "Left Early / Incomplete": "Umalis nang Maaga / Hindi Kumpleto",
    "Excused (Short Stay)": "May Paumanhin (Maikling Pananatili)",
    "Present (Left)": "Dumalo (Umalis)",
    "Guest (Present)": "Bisita (Dumalo)",
    "Guest (Left)": "Bisita (Umalis)"
  },
  "ms": {
    "Present": "Hadir",
    "Left": "Keluar",
    "Absent": "Tidak Hadir",
    "Absent (excused)": "Tidak Hadir (bersebab)",
    "Late": "Lewat",
    "Left Early / Incomplete": "Keluar Awal / Tidak Lengkap",
    "Excused (Short Stay)": "Dikecualikan (Tinggal Singkat)",
    "Present (Left)": "Hadir (Keluar)",
    "Guest (Present)": "Tetamu (Hadir)",
    "Guest (Left)": "Tetamu (Keluar)"
  },
  "nl": {
    "Present": "Aanwezig",
    "Left": "Verlaten",
    "Absent": "Afwezig",
    "Absent (excused)": "Afwezig (met kennisgeving)",
    "Late": "Te laat",
    "Left Early / Incomplete": "Vroegtijdig verlaten / Onvolledig",
    "Excused (Short Stay)": "Vrijgesteld (Kort verblijf)",
    "Present (Left)": "Aanwezig (Verlaten)",
    "Guest (Present)": "Gast (Aanwezig)",
    "Guest (Left)": "Gast (Verlaten)"
  },
  "ro": {
    "Present": "Prezent",
    "Left": "A plecat",
    "Absent": "Absent",
    "Absent (excused)": "Absent (motivat)",
    "Late": "Întârziat",
    "Left Early / Incomplete": "Plecat devreme / Incomplet",
    "Excused (Short Stay)": "Motivat (Scurtă durată)",
    "Present (Left)": "Prezent (A plecat)",
    "Guest (Present)": "Oaspete (Prezent)",
    "Guest (Left)": "Oaspete (A plecat)"
  },
  "uk": {
    "Present": "Присутній",
    "Left": "Вийшов",
    "Absent": "Відсутній",
    "Absent (excused)": "Відсутній (поважна причина)",
    "Late": "Запізнився",
    "Left Early / Incomplete": "Вийшов раніше / Неповний",
    "Excused (Short Stay)": "Поважна причина (Коротке перебування)",
    "Present (Left)": "Присутній (Вийшов)",
    "Guest (Present)": "Гість (Присутній)",
    "Guest (Left)": "Гість (Вийшов)"
  },
  "th": {
    "Present": "เข้าร่วม",
    "Left": "ออกจากการประชุม",
    "Absent": "ขาด",
    "Absent (excused)": "ขาด (ลา)",
    "Late": "สาย",
    "Left Early / Incomplete": "ออกก่อนเวลา / ไม่สมบูรณ์",
    "Excused (Short Stay)": "ได้รับอนุญาต (อยู่ระยะสั้น)",
    "Present (Left)": "เข้าร่วม (ออกแล้ว)",
    "Guest (Present)": "ผู้มาเยือน (เข้าร่วม)",
    "Guest (Left)": "ผู้มาเยือน (ออกแล้ว)"
  },
  "he": {
    "Present": "נוכח",
    "Left": "עזב",
    "Absent": "נעדר",
    "Absent (excused)": "נעדר (מאושר)",
    "Late": "איחר",
    "Left Early / Incomplete": "עזב מוקדם / חלקי",
    "Excused (Short Stay)": "מאושר (שהות קצרה)",
    "Present (Left)": "נוכח (עזב)",
    "Guest (Present)": "אורח (נוכח)",
    "Guest (Left)": "אורח (עזב)"
  },
  "mr": {
    "Present": "उपस्थित",
    "Left": "सोडले",
    "Absent": "अनुपस्थित",
    "Absent (excused)": "अनुपस्थित (रजा)",
    "Late": "उशिरा",
    "Left Early / Incomplete": "लवकर सोडले / अपूर्ण",
    "Excused (Short Stay)": "सूट दिली (अल्प मुक्काम)",
    "Present (Left)": "उपस्थित (सोडले)",
    "Guest (Present)": "पाहुणा (उपस्थित)",
    "Guest (Left)": "पाहुणा (सोडले)"
  },
  "sv": {
    "Present": "Närvarande",
    "Left": "Lämnade",
    "Absent": "Frånvarande",
    "Absent (excused)": "Frånvarande (giltig)",
    "Late": "Sen",
    "Left Early / Incomplete": "Lämnade tidigt / Ofullständig",
    "Excused (Short Stay)": "Giltig (Kort vistelse)",
    "Present (Left)": "Närvarande (Lämnade)",
    "Guest (Present)": "Gäst (Närvarande)",
    "Guest (Left)": "Gäst (Lämnade)"
  },
  "cs": {
    "Present": "Přítomen",
    "Left": "Odešel",
    "Absent": "Nepřítomen",
    "Absent (excused)": "Nepřítomen (omluven)",
    "Late": "Zpožděn",
    "Left Early / Incomplete": "Odešel dříve / Neúplné",
    "Excused (Short Stay)": "Omluven (Krátký pobyt)",
    "Present (Left)": "Přítomen (Odešel)",
    "Guest (Present)": "Host (Přítomen)",
    "Guest (Left)": "Host (Odešel)"
  },
  "da": {
    "Present": "Til stede",
    "Left": "Forlod",
    "Absent": "Fraværende",
    "Absent (excused)": "Fraværende (undskyldt)",
    "Late": "Forsinket",
    "Left Early / Incomplete": "Gik tidligt / Ufuldstændig",
    "Excused (Short Stay)": "Undskyldt (Kort ophold)",
    "Present (Left)": "Til stede (Forlod)",
    "Guest (Present)": "Gæst (Til stede)",
    "Guest (Left)": "Gæst (Forlod)"
  },
  "fi": {
    "Present": "Paikalla",
    "Left": "Poistui",
    "Absent": "Poissa",
    "Absent (excused)": "Poissa (luvallinen)",
    "Late": "Myöhässä",
    "Left Early / Incomplete": "Lähti aikaisin / Keskeneräinen",
    "Excused (Short Stay)": "Luvallinen (Lyhyt viipymä)",
    "Present (Left)": "Paikalla (Poistui)",
    "Guest (Present)": "Vieras (Paikalla)",
    "Guest (Left)": "Vieras (Poistui)"
  },
  "hu": {
    "Present": "Jelen van",
    "Left": "Távozott",
    "Absent": "Hiányzik",
    "Absent (excused)": "Hiányzik (igazolt)",
    "Late": "Késett",
    "Left Early / Incomplete": "Korán távozott / Befejezetlen",
    "Excused (Short Stay)": "Igazolt (Rövid tartózkodás)",
    "Present (Left)": "Jelen (Távozott)",
    "Guest (Present)": "Vendég (Jelen)",
    "Guest (Left)": "Vendég (Távozott)"
  },
  "so": {
    "Present": "Xaadir",
    "Left": "Baxay",
    "Absent": "Maqan",
    "Absent (excused)": "Maqan (Cudurdaar)",
    "Late": "Daahay",
    "Left Early / Incomplete": "Goor hore baxay / Aan dhamaystirnayn",
    "Excused (Short Stay)": "La cudurdaaray (Joogitaan gaaban)",
    "Present (Left)": "Xaadir (Baxay)",
    "Guest (Present)": "Marti (Xaadir)",
    "Guest (Left)": "Marti (Baxay)"
  },
  "sw": {
    "Present": "Yupo",
    "Left": "Ameondoka",
    "Absent": "Hayupo",
    "Absent (excused)": "Hayupo (Udhuru)",
    "Late": "Amechelewa",
    "Left Early / Incomplete": "Ameondoka Mapema / Haijakamilika",
    "Excused (Short Stay)": "Amesamehewa (Muda Mfupi)",
    "Present (Left)": "Yupo (Ameondoka)",
    "Guest (Present)": "Mgeni (Yupo)",
    "Guest (Left)": "Mgeni (Ameondoka)"
  },
  "am": {
    "Present": "ተገኝቷል",
    "Left": "ወጥቷል",
    "Absent": "ቀርቷል",
    "Absent (excused)": "ቀርቷል (በፈቃድ)",
    "Late": "ዘግይቷል",
    "Left Early / Incomplete": "ቀድሞ ወጥቷል / ያልተሟላ",
    "Excused (Short Stay)": "ፈቃድ ተሰጥቷል (አጭር ቆይታ)",
    "Present (Left)": "ተገኝቷል (ወጥቷል)",
    "Guest (Present)": "እንግዳ (ተገኝቷል)",
    "Guest (Left)": "እንግዳ (ወጥቷል)"
  },
  "si": {
    "Present": "පැමිණ සිටී",
    "Left": "ඉවත් විය",
    "Absent": "නොපැමිණි",
    "Absent (excused)": "නොපැමිණි (නිවාඩු)",
    "Late": "ප්‍රමාදයි",
    "Left Early / Incomplete": "කලින් ඉවත් විය / අසම්පූර්ණයි",
    "Excused (Short Stay)": "නිදහස් කරන ලදී (කෙටි කාලයක්)",
    "Present (Left)": "පැමිණ සිටී (ඉවත් විය)",
    "Guest (Present)": "ආරාධිතයා (පැමිණ සිටී)",
    "Guest (Left)": "ආරාධිතයා (ඉවත් විය)"
  },
  "el": {
    "Present": "Παρών",
    "Left": "Αποχώρησε",
    "Absent": "Απών",
    "Absent (excused)": "Απών (δικαιολογημένος)",
    "Late": "Καθυστερημένος",
    "Left Early / Incomplete": "Αποχώρησε νωρίς / Ημιτελές",
    "Excused (Short Stay)": "Δικαιολογημένος (Σύντομη παραμονή)",
    "Present (Left)": "Παρών (Αποχώρησε)",
    "Guest (Present)": "Επισκέπτης (Παρών)",
    "Guest (Left)": "Επισκέπτης (Αποχώρησε)"
  },
  "no": {
    "Present": "Tilstede",
    "Left": "Forlot",
    "Absent": "Fraværende",
    "Absent (excused)": "Fraværende (gyldig)",
    "Late": "Forsinket",
    "Left Early / Incomplete": "Forlot tidlig / Ufullstendig",
    "Excused (Short Stay)": "Gyldig (Kort opphold)",
    "Present (Left)": "Tilstede (Forlot)",
    "Guest (Present)": "Gjest (Tilstede)",
    "Guest (Left)": "Gjest (Forlot)"
  },
  "ca": {
    "Present": "Present",
    "Left": "Ha marxat",
    "Absent": "Absent",
    "Absent (excused)": "Absent (justificat)",
    "Late": "Tard",
    "Left Early / Incomplete": "Ha marxat d'hora / Incomplet",
    "Excused (Short Stay)": "Justificat (Estada curta)",
    "Present (Left)": "Present (Ha marxat)",
    "Guest (Present)": "Convidat (Present)",
    "Guest (Left)": "Convidat (Ha marxat)"
  },
  "kn": {
    "Present": "ಹಾಜರಿದ್ದಾರೆ",
    "Left": "ನಿರ್ಗಮಿಸಿದ್ದಾರೆ",
    "Absent": "ಗೈರುಹಾಜರಾಗಿದ್ದಾರೆ",
    "Absent (excused)": "ಗೈರುಹಾಜರಿ (ಅನುಮೋದಿತ)",
    "Late": "ತಡವಾಗಿ",
    "Left Early / Incomplete": "ಬೇಗ ನಿರ್ಗಮಿಸಿದ್ದಾರೆ / ಅಪೂರ್ಣ",
    "Excused (Short Stay)": "ಅನುಮೋದಿತ (ಅಲ್ಪಾವಧಿ)",
    "Present (Left)": "ಹಾಜರು (ನಿರ್ಗಮಿಸಿದ್ದಾರೆ)",
    "Guest (Present)": "ಅತಿಥಿ (ಹಾಜರು)",
    "Guest (Left)": "ಅತಿಥಿ (ನಿರ್ಗಮಿಸಿದ್ದಾರೆ)"
  },
  "gu": {
    "Present": "હાજર",
    "Left": "છોડ્યું",
    "Absent": "ગેરહાજર",
    "Absent (excused)": "ગેરહાજર (મંજૂર)",
    "Late": "મોડું",
    "Left Early / Incomplete": "વહેલા છોડ્યું / અપૂર્ણ",
    "Excused (Short Stay)": "મંજૂર (ટૂંકું રોકાણ)",
    "Present (Left)": "હાજર (છોડ્યું)",
    "Guest (Present)": "મહેમાન (હાજર)",
    "Guest (Left)": "મહેમાન (છોડ્યું)"
  },
  "pa": {
    "Present": "ਹਾਜ਼ਰ",
    "Left": "ਛੱਡਿਆ",
    "Absent": "ਗੈਰ-ਹਾਜ਼ਰ",
    "Absent (excused)": "ਗੈਰ-ਹਾਜ਼ਰ (ਛੁੱਟੀ)",
    "Late": "ਦੇਰ ਨਾਲ",
    "Left Early / Incomplete": "ਜਲਦੀ ਛੱਡਿਆ / ਅਧੂਰਾ",
    "Excused (Short Stay)": "ਮਨਜ਼ੂਰ (ਥੋੜ੍ਹੀ ਦੇਰ)",
    "Present (Left)": "ਹਾਜ਼ਰ (ਛੱਡਿਆ)",
    "Guest (Present)": "ਮਹਿਮਾਨ (ਹਾਜ਼ਰ)",
    "Guest (Left)": "ਮਹਿਮਾਨ (ਛੱਡਿਆ)"
  },
  "kk": {
    "Present": "Қатысты",
    "Left": "Шықты",
    "Absent": "Қатыспады",
    "Absent (excused)": "Қатыспады (себепті)",
    "Late": "Кешікті",
    "Left Early / Incomplete": "Ерте шықты / Толық емес",
    "Excused (Short Stay)": "Себепті (Қысқа уақыт)",
    "Present (Left)": "Қатысты (Шықты)",
    "Guest (Present)": "Қонақ (Қатысты)",
    "Guest (Left)": "Қонақ (Шықты)"
  },
  "lv": {
    "Present": "Piedalījās",
    "Left": "Pameta",
    "Absent": "Kavēja",
    "Absent (excused)": "Attaisnots kavējums",
    "Late": "Nokavēja",
    "Left Early / Incomplete": "Izgāja agrāk / Nepilnīgs",
    "Excused (Short Stay)": "Attaisnots (Īss laiks)",
    "Present (Left)": "Piedalījās (Izgāja)",
    "Guest (Present)": "Viesis (Piedalījās)",
    "Guest (Left)": "Viesis (Izgāja)"
  },
  "lt": {
    "Present": "Dalyvavo",
    "Left": "Išėjo",
    "Absent": "Nedalyvavo",
    "Absent (excused)": "Nedalyvavo (pateisinta)",
    "Late": "Pavėlavo",
    "Left Early / Incomplete": "Išėjo anksčiau / Neišbuvo",
    "Excused (Short Stay)": "Pateisinta (Trumpas buvimas)",
    "Present (Left)": "Dalyvavo (Išėjo)",
    "Guest (Present)": "Svečias (Dalyvavo)",
    "Guest (Left)": "Svečias (Išėjo)"
  },
  "lo": {
    "Present": "ເຂົ້າຮ່ວມ",
    "Left": "ອອກແລ້ວ",
    "Absent": "ຂາດ",
    "Absent (excused)": "ຂາດ (ມີເຫດຜົນ)",
    "Late": "ມາຊ້າ",
    "Left Early / Incomplete": "ອອກກ່ອນ / ບໍ່ຄົບ",
    "Excused (Short Stay)": "ອະນຸຍາດ (ຢູ່ຊົ່ວຄາວ)",
    "Present (Left)": "ເຂົ້າຮ່ວມ (ອອກແລ້ວ)",
    "Guest (Present)": "ແຂກ (ເຂົ້າຮ່ວມ)",
    "Guest (Left)": "ແຂກ (ອອກແລ້ວ)"
  },
  "my": {
    "Present": "တက်ရောက်သည်",
    "Left": "ထွက်ခွာသွားသည်",
    "Absent": "ပျက်ကွက်",
    "Absent (excused)": "ပျက်ကွက် (ခွင့်နှင့်)",
    "Late": "နောက်ကျ",
    "Left Early / Incomplete": "စောထွက် / မပြည့်စုံ",
    "Excused (Short Stay)": "ခွင့်ပြု (ခေတ္တသာ)",
    "Present (Left)": "တက်ရောက် (ထွက်ခွာ)",
    "Guest (Present)": "ဧည့်သည် (တက်ရောက်)",
    "Guest (Left)": "ဧည့်သည် (ထွက်ခွာ)"
  },
  "km": {
    "Present": "មានវត្តមាន",
    "Left": "បានចាកចេញ",
    "Absent": "អវត្តមាន",
    "Absent (excused)": "អវត្តមាន (មានច្បាប់)",
    "Late": "យឺត",
    "Left Early / Incomplete": "ចាកចេញមុន / មិនពេញលេញ",
    "Excused (Short Stay)": "លើកលែង (ស្នាក់នៅខ្លី)",
    "Present (Left)": "មានវត្តមាន (បានចាកចេញ)",
    "Guest (Present)": "ភ្ញៀវ (មានវត្តមាន)",
    "Guest (Left)": "ភ្ញៀវ (បានចាកចេញ)"
  },
  "ceb": {
    "Present": "Mitambong",
    "Left": "Mibiya",
    "Absent": "Wala Mitambong",
    "Absent (excused)": "Wala Mitambong (Gipasaylo)",
    "Late": "Naulahi",
    "Left Early / Incomplete": "Mibiya og Sayo / Wala Mahuman",
    "Excused (Short Stay)": "Gipasaylo (Mubo nga Puyo)",
    "Present (Left)": "Mitambong (Mibiya)",
    "Guest (Present)": "Bisita (Mitambong)",
    "Guest (Left)": "Bisita (Mibiya)"
  },
  "bg": {
    "Present": "Присъствал",
    "Left": "Напуснал",
    "Absent": "Отсъствал",
    "Absent (excused)": "Отсъствал (уважително)",
    "Late": "Закъснял",
    "Left Early / Incomplete": "Напуснал по-рано / Непълен",
    "Excused (Short Stay)": "Извинен (Кратък престой)",
    "Present (Left)": "Присъствал (Напуснал)",
    "Guest (Present)": "Гост (Присъствал)",
    "Guest (Left)": "Гост (Напуснал)"
  },
  "hr": {
    "Present": "Prisutan",
    "Left": "Izašao",
    "Absent": "Odsutan",
    "Absent (excused)": "Odsutan (opravdano)",
    "Late": "Zakasnio",
    "Left Early / Incomplete": "Izašao ranije / Nepotpuno",
    "Excused (Short Stay)": "Opravdano (Kratak boravak)",
    "Present (Left)": "Prisutan (Izašao)",
    "Guest (Present)": "Gost (Prisutan)",
    "Guest (Left)": "Gost (Izašao)"
  },
  "sr": {
    "Present": "Присутан",
    "Left": "Изашао",
    "Absent": "Одсутан",
    "Absent (excused)": "Одсутан (оправдано)",
    "Late": "Закаснио",
    "Left Early / Incomplete": "Изашао раније / Непотпуно",
    "Excused (Short Stay)": "Оправдано (Кратак боравак)",
    "Present (Left)": "Присутан (Изашао)",
    "Guest (Present)": "Гост (Присутан)",
    "Guest (Left)": "Гост (Изашао)"
  },
  "sk": {
    "Present": "Prítomný",
    "Left": "Odišiel",
    "Absent": "Neprítomný",
    "Absent (excused)": "Neprítomný (ospravedlnený)",
    "Late": "Meškanie",
    "Left Early / Incomplete": "Odišiel skôr / Neúplné",
    "Excused (Short Stay)": "Ospravedlnené (Krátky pobyt)",
    "Present (Left)": "Prítomný (Odišiel)",
    "Guest (Present)": "Hosť (Prítomný)",
    "Guest (Left)": "Hosť (Odišiel)"
  },
  "sl": {
    "Present": "Prisoten",
    "Left": "Zapustil",
    "Absent": "Odsoten",
    "Absent (excused)": "Odsoten (opravičeno)",
    "Late": "Zamuda",
    "Left Early / Incomplete": "Zapustil prezgodaj / Nepopolno",
    "Excused (Short Stay)": "Opravičeno (Kratko bivanje)",
    "Present (Left)": "Prisoten (Zapustil)",
    "Guest (Present)": "Gost (Prisoten)",
    "Guest (Left)": "Gost (Zapustil)"
  },
  "af": {
    "Present": "Teenwoordig",
    "Left": "Het verlaat",
    "Absent": "Afwesig",
    "Absent (excused)": "Afwesig (verskoon)",
    "Late": "Laat",
    "Left Early / Incomplete": "Vroeg weg / Onvolledig",
    "Excused (Short Stay)": "Verskoon (Kort kuier)",
    "Present (Left)": "Teenwoordig (Het verlaat)",
    "Guest (Present)": "Gas (Teenwoordig)",
    "Guest (Left)": "Gas (Het verlaat)"
  }
};

function localizeStatus(status, locale) {
  if (!status) return '';
  const norm = normalizeLocale(locale);
  if (norm === 'en') return status;
  return STATUS_TRANSLATIONS[norm]?.[status] || status;
}

const RSVP_TRANSLATIONS = {
  "hi": {
    "accepted": "स्वीकार किया",
    "declined": "अस्वीकार किया",
    "tentative": "अनंतिम",
    "needsAction": "कोई उत्तर नहीं"
  },
  "bn": {
    "accepted": "গৃহীত",
    "declined": "প্রত্যাখ্যাত",
    "tentative": "অস্থায়ী",
    "needsAction": "কোন প্রতিক্রিয়া নেই"
  },
  "zh": {
    "accepted": "已接受",
    "declined": "已拒絕",
    "tentative": "不確定",
    "needsAction": "尚未回覆"
  },
  "zh-CN": {
    "accepted": "已接受",
    "declined": "已拒绝",
    "tentative": "暂定",
    "needsAction": "无响应"
  },
  "ja": {
    "accepted": "承諾",
    "declined": "辞退",
    "tentative": "未定",
    "needsAction": "未回答"
  },
  "pt": {
    "accepted": "Aceito",
    "declined": "Recusado",
    "tentative": "Talvez",
    "needsAction": "Sem Resposta"
  },
  "es": {
    "accepted": "Aceptado",
    "declined": "Rechazado",
    "tentative": "Provisional",
    "needsAction": "Sin Respuesta"
  },
  "fr": {
    "accepted": "Accepté",
    "declined": "Refusé",
    "tentative": "Provisoire",
    "needsAction": "Sans Réponse"
  },
  "de": {
    "accepted": "Zugesagt",
    "declined": "Abgelehnt",
    "tentative": "Vorläufig",
    "needsAction": "Keine Antwort"
  },
  "it": {
    "accepted": "Accettato",
    "declined": "Rifiutato",
    "tentative": "Provvisorio",
    "needsAction": "Nessuna Risposta"
  },
  "ru": {
    "accepted": "Принято",
    "declined": "Отклонено",
    "tentative": "Возможно",
    "needsAction": "Без ответа"
  },
  "tr": {
    "accepted": "Kabul edildi",
    "declined": "Reddedildi",
    "tentative": "Belirsiz",
    "needsAction": "Yanıt Yok"
  },
  "vi": {
    "accepted": "Đã chấp nhận",
    "declined": "Đã từ chối",
    "tentative": "Dự kiến",
    "needsAction": "Chưa trả lời"
  },
  "id": {
    "accepted": "Diterima",
    "declined": "Ditolak",
    "tentative": "Tentatif",
    "needsAction": "Belum Menanggapi"
  },
  "pl": {
    "accepted": "Zaakceptowano",
    "declined": "Odrzucono",
    "tentative": "Niepewne",
    "needsAction": "Brak odpowiedzi"
  },
  "ko": {
    "accepted": "수락됨",
    "declined": "거절됨",
    "tentative": "미정",
    "needsAction": "응답 없음"
  },
  "ar": {
    "accepted": "تم القبول",
    "declined": "تم الرفض",
    "tentative": "مبدئي",
    "needsAction": "لا يوجد رد"
  },
  "ne": {
    "accepted": "स्वीकार गरियो",
    "declined": "अस्वीकार गरियो",
    "tentative": "अस्थायी",
    "needsAction": "कुनै प्रतिक्रिया छैन"
  },
  "ml": {
    "accepted": "സ്വീകരിച്ചു",
    "declined": "നിരസിച്ചു",
    "tentative": "താൽക്കാലികം",
    "needsAction": "പ്രതികരണമില്ല"
  },
  "mn": {
    "accepted": "Зөвшөөрсөн",
    "declined": "Татгалзсан",
    "tentative": "Тодорхойгүй",
    "needsAction": "Хариу өгөөгүй"
  },
  "ta": {
    "accepted": "ஏற்றுக்கொள்ளப்பட்டது",
    "declined": "நிராகரிக்கப்பட்டது",
    "tentative": "தற்காலிகமானது",
    "needsAction": "பதில் இல்லை"
  },
  "te": {
    "accepted": "ఆమోదించబడింది",
    "declined": "తిరస్కరించబడింది",
    "tentative": "తాత్కాలికం",
    "needsAction": "స్పందన లేదు"
  },
  "ur": {
    "accepted": "قبول کیا",
    "declined": "مسترد کیا",
    "tentative": "عارضی",
    "needsAction": "کوئی جواب نہیں"
  },
  "tl": {
    "accepted": "Tinanggap",
    "declined": "Tinanggihan",
    "tentative": "Tentatibo",
    "needsAction": "Walang Tugon"
  },
  "ms": {
    "accepted": "Diterima",
    "declined": "Ditolak",
    "tentative": "Tentatif",
    "needsAction": "Tiada Tindakan"
  },
  "nl": {
    "accepted": "Geaccepteerd",
    "declined": "Geweigerd",
    "tentative": "Voorlopig",
    "needsAction": "Geen antwoord"
  },
  "ro": {
    "accepted": "Acceptat",
    "declined": "Refuzat",
    "tentative": "Provizoriu",
    "needsAction": "Fără răspuns"
  },
  "uk": {
    "accepted": "Прийнято",
    "declined": "Відхилено",
    "tentative": "Попередньо",
    "needsAction": "Без відповіді"
  },
  "th": {
    "accepted": "ตอบรับแล้ว",
    "declined": "ปฏิเสธแล้ว",
    "tentative": "อาจจะไป",
    "needsAction": "ยังไม่ตอบ"
  },
  "he": {
    "accepted": "אישר",
    "declined": "דחה",
    "tentative": "אולי",
    "needsAction": "טרם השיב"
  },
  "mr": {
    "accepted": "स्वीकारले",
    "declined": "नाकारले",
    "tentative": "तात्पुरते",
    "needsAction": "प्रतिसाद नाही"
  },
  "sv": {
    "accepted": "Accepterat",
    "declined": "Avböjt",
    "tentative": "Kanske",
    "needsAction": "Inget svar"
  },
  "cs": {
    "accepted": "Přijato",
    "declined": "Odmítnuto",
    "tentative": "Nezávazně",
    "needsAction": "Bez odpovědi"
  },
  "da": {
    "accepted": "Accepteret",
    "declined": "Afvist",
    "tentative": "Måske",
    "needsAction": "Intet svar"
  },
  "fi": {
    "accepted": "Hyväksytty",
    "declined": "Hylätty",
    "tentative": "Ehkä",
    "needsAction": "Ei vastausta"
  },
  "hu": {
    "accepted": "Elfogadva",
    "declined": "Elutasítva",
    "tentative": "Feltételes",
    "needsAction": "Nincs válasz"
  },
  "so": {
    "accepted": "Waa la aqbalay",
    "declined": "Waa la diiday",
    "tentative": "Kumeel gaar",
    "needsAction": "Jawaab ma leh"
  },
  "sw": {
    "accepted": "Imekubaliwa",
    "declined": "Imekataliwa",
    "tentative": "Majaribio",
    "needsAction": "Hakuna Jibu"
  },
  "am": {
    "accepted": "ተቀብሏል",
    "declined": "አልተቀበለም",
    "tentative": "ጊዜያዊ",
    "needsAction": "ምላሽ የለም"
  },
  "si": {
    "accepted": "පිළිගන්නා ලදී",
    "declined": "ප්‍රතික්ෂේප විය",
    "tentative": "තාවකාලිකයි",
    "needsAction": "ප්‍රතිචාරයක් නැත"
  },
  "el": {
    "accepted": "Αποδεκτό",
    "declined": "Απορρίφθηκε",
    "tentative": "Επιφύλαξη",
    "needsAction": "Χωρίς απάντηση"
  },
  "no": {
    "accepted": "Godtatt",
    "declined": "Avslått",
    "tentative": "Foreløpig",
    "needsAction": "Ikke svart"
  },
  "ca": {
    "accepted": "Acceptat",
    "declined": "Rebutjat",
    "tentative": "Provisional",
    "needsAction": "Sense resposta"
  },
  "kn": {
    "accepted": "ಸ್ವೀಕರಿಸಲಾಗಿದೆ",
    "declined": "ತಿರಸ್ಕರಿಸಲಾಗಿದೆ",
    "tentative": "ತಾತ್ಕಾಲಿಕ",
    "needsAction": "ಯಾವುದೇ ಪ್ರತಿಕ್ರಿಯೆ ಇಲ್ಲ"
  },
  "gu": {
    "accepted": "સ્વીકાર્યું",
    "declined": "અસ્વીકાર્યું",
    "tentative": "કામચલાઉ",
    "needsAction": "કોઈ પ્રત્યુત્તર નથી"
  },
  "pa": {
    "accepted": "ਸਵੀਕਾਰ ਕੀਤਾ",
    "declined": "ਅਸਵੀਕਾਰ ਕੀਤਾ",
    "tentative": "ਆਰਜ਼ੀ",
    "needsAction": "ਕੋਈ ਜਵਾਬ ਨਹੀਂ"
  },
  "kk": {
    "accepted": "Қабылданды",
    "declined": "Бас тартылды",
    "tentative": "Бұлыңғыр",
    "needsAction": "Жауап жоқ"
  },
  "lv": {
    "accepted": "Pieņemts",
    "declined": "Noraidīts",
    "tentative": "Varbūt",
    "needsAction": "Nav atbildes"
  },
  "lt": {
    "accepted": "Priimta",
    "declined": "Atmesta",
    "tentative": "Neaišku",
    "needsAction": "Nėra atsakymo"
  },
  "lo": {
    "accepted": "ຕອບຮັບແລ້ວ",
    "declined": "ປະຕິເສດແລ້ວ",
    "tentative": "ອາດຈະໄປ",
    "needsAction": "ບໍ່ມີຄຳຕອບ"
  },
  "my": {
    "accepted": "လက်ခံသည်",
    "declined": "ငြင်းပယ်သည်",
    "tentative": "မသေချာ",
    "needsAction": "အကြောင်းမပြန်သေး"
  },
  "km": {
    "accepted": "បានយល់ព្រម",
    "declined": "បានបដិសេធ",
    "tentative": "មិនទាន់ប្រាកដ",
    "needsAction": "មិនមានការឆ្លើយតប"
  },
  "ceb": {
    "accepted": "Gidawat",
    "declined": "Gibalibaran",
    "tentative": "Wala Masiguro",
    "needsAction": "Walang Tubag"
  },
  "bg": {
    "accepted": "Прието",
    "declined": "Отказано",
    "tentative": "Несигурно",
    "needsAction": "Без отговор"
  },
  "hr": {
    "accepted": "Prihvaćeno",
    "declined": "Odbijeno",
    "tentative": "Možda",
    "needsAction": "Nema odgovora"
  },
  "sr": {
    "accepted": "Прихваћено",
    "declined": "Одбијено",
    "tentative": "Можда",
    "needsAction": "Нема одговора"
  },
  "sk": {
    "accepted": "Prijaté",
    "declined": "Odmietnuté",
    "tentative": "Nezáväzne",
    "needsAction": "Bez odpovede"
  },
  "sl": {
    "accepted": "Sprejeto",
    "declined": "Zavrnjeno",
    "tentative": "Mogoče",
    "needsAction": "Ni odgovora"
  },
  "af": {
    "accepted": "Aanvaar",
    "declined": "Van die hand gewys",
    "tentative": "Tentatief",
    "needsAction": "Geen antwoord"
  }
};
const LOCALIZED_RSVP = RSVP_TRANSLATIONS;

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
  "pt": {
    reportTitle: "Relatório de Presença",
    dateLabel: "Data",
    hostLabel: "Organizador",
    durationLabel: "Duração",
    columns: {"name":"Nome","email":"E-mail","joined":"Entrada","left":"Saída","active":"Duração","status":"Status"},
    summaryFormat: (present, total) => `${present} de ${total} registrados como presentes`
  },
  "es": {
    reportTitle: "Informe de Asistencia",
    dateLabel: "Fecha",
    hostLabel: "Organizador",
    durationLabel: "Duración",
    columns: {"name":"Nombre","email":"Correo","joined":"Entrada","left":"Salida","active":"Duración","status":"Estado"},
    summaryFormat: (present, total) => `${present} de ${total} registrados como presentes`
  },
  "fr": {
    reportTitle: "Rapport de Présence",
    dateLabel: "Date",
    hostLabel: "Hôte",
    durationLabel: "Durée",
    columns: {"name":"Nom","email":"E-mail","joined":"Arrivée","left":"Départ","active":"Durée","status":"Statut"},
    summaryFormat: (present, total) => `${present} sur ${total} enregistrés comme présents`
  },
  "de": {
    reportTitle: "Anwesenheitsbericht",
    dateLabel: "Datum",
    hostLabel: "Gastgeber",
    durationLabel: "Dauer",
    columns: {"name":"Name","email":"E-Mail","joined":"Beitritt","left":"Verlassen","active":"Dauer","status":"Status"},
    summaryFormat: (present, total) => `${present} von ${total} als anwesend erfasst`
  },
  "it": {
    reportTitle: "Rapporto Presenze",
    dateLabel: "Data",
    hostLabel: "Organizzatore",
    durationLabel: "Durata",
    columns: {"name":"Nome","email":"E-mail","joined":"Entrata","left":"Uscita","active":"Durata","status":"Stato"},
    summaryFormat: (present, total) => `${present} su ${total} registrati come presenti`
  },
  "nl": {
    reportTitle: "Aanwezigheidsrapport",
    dateLabel: "Datum",
    hostLabel: "Host",
    durationLabel: "Duur",
    columns: {"name":"Naam","email":"E-mail","joined":"Deelgenomen","left":"Verlaten","active":"Actief","status":"Status"},
    summaryFormat: (present, total) => `${present} van ${total} geregistreerd als aanwezig`
  },
  "pl": {
    reportTitle: "Raport obecności",
    dateLabel: "Data",
    hostLabel: "Organizator",
    durationLabel: "Czas trwania",
    columns: {"name":"Imię i nazwisko","email":"E-mail","joined":"Dołączono","left":"Opuszczono","active":"Czas aktywności","status":"Status"},
    summaryFormat: (present, total) => `${present} z ${total} oznaczonych jako obecni`
  },
  "ru": {
    reportTitle: "Отчёт о присутствии",
    dateLabel: "Дата",
    hostLabel: "Организатор",
    durationLabel: "Длительность",
    columns: {"name":"Имя","email":"Email","joined":"Присоединился","left":"Покинул","active":"Активность","status":"Статус"},
    summaryFormat: (present, total) => `${present} из ${total} отмечены как присутствующие`
  },
  "tr": {
    reportTitle: "Yoklama Raporu",
    dateLabel: "Tarih",
    hostLabel: "Düzenleyen",
    durationLabel: "Süre",
    columns: {"name":"Ad Soyad","email":"E-posta","joined":"Katıldı","left":"Ayrıldı","active":"Aktif Süre","status":"Durum"},
    summaryFormat: (present, total) => `${present} / ${total} kişi katıldı olarak kaydedildi`
  },
  "vi": {
    reportTitle: "Báo cáo điểm danh",
    dateLabel: "Ngày",
    hostLabel: "Chủ trì",
    durationLabel: "Thời lượng",
    columns: {"name":"Tên","email":"Email","joined":"Đã tham gia","left":"Đã rời","active":"Thời gian hoạt động","status":"Trạng thái"},
    summaryFormat: (present, total) => `${present} trên ${total} được ghi nhận có mặt`
  },
  "cs": {
    reportTitle: "Zpráva o docházce",
    dateLabel: "Datum",
    hostLabel: "Organizátor",
    durationLabel: "Délka",
    columns: {"name":"Jméno","email":"E-mail","joined":"Připojen","left":"Odpojen","active":"Aktivní","status":"Stav"},
    summaryFormat: (present, total) => `${present} z ${total} zaznamenáno jako přítomní`
  },
  "da": {
    reportTitle: "Deltagerrapport",
    dateLabel: "Dato",
    hostLabel: "Vært",
    durationLabel: "Varighed",
    columns: {"name":"Navn","email":"E-mail","joined":"Deltog","left":"Forlod","active":"Aktiv","status":"Status"},
    summaryFormat: (present, total) => `${present} af ${total} registreret som til stede`
  },
  "sv": {
    reportTitle: "Närvarorapport",
    dateLabel: "Datum",
    hostLabel: "Värd",
    durationLabel: "Längd",
    columns: {"name":"Namn","email":"E-post","joined":"Anslöt","left":"Lämnade","active":"Aktiv","status":"Status"},
    summaryFormat: (present, total) => `${present} av ${total} registrerade som närvarande`
  },
  "el": {
    reportTitle: "Αναφορά παρουσιών",
    dateLabel: "Ημερομηνία",
    hostLabel: "Διοργανωτής",
    durationLabel: "Διάρκεια",
    columns: {"name":"Όνομα","email":"Email","joined":"Συμμετοχή","left":"Αποχώρηση","active":"Ενεργός","status":"Κατάσταση"},
    summaryFormat: (present, total) => `${present} από ${total} καταγράφηκαν ως παρόντες`
  },
  "ca": {
    reportTitle: "Informe d'assistència",
    dateLabel: "Data",
    hostLabel: "Organitzador",
    durationLabel: "Durada",
    columns: {"name":"Nom","email":"Correu electrònic","joined":"Entrada","left":"Sortida","active":"Durada","status":"Estat"},
    summaryFormat: (present, total) => `${present} de ${total} registrats com a presents`
  },
  "id": {
    reportTitle: "Laporan Kehadiran",
    dateLabel: "Tanggal",
    hostLabel: "Tuan Rumah",
    durationLabel: "Durasi",
    columns: {"name":"Nama","email":"Email","joined":"Bergabung","left":"Keluar","active":"Aktif","status":"Status"},
    summaryFormat: (present, total) => `${present} dari ${total} tercatat hadir`
  },
  "ms": {
    reportTitle: "Laporan Kehadiran",
    dateLabel: "Tarikh",
    hostLabel: "Penganjur",
    durationLabel: "Tempoh",
    columns: {"name":"Nama","email":"E-mel","joined":"Menyertai","left":"Keluar","active":"Aktif","status":"Status"},
    summaryFormat: (present, total) => `${present} daripada ${total} direkodkan hadir`
  },
  "tl": {
    reportTitle: "Ulat ng Pagdalo",
    dateLabel: "Petsa",
    hostLabel: "Host",
    durationLabel: "Tagal",
    columns: {"name":"Pangalan","email":"Email","joined":"Sumali","left":"Umalis","active":"Aktibo","status":"Katayuan"},
    summaryFormat: (present, total) => `${present} sa ${total} ang naitalang dumalo`
  },
  "ro": {
    reportTitle: "Raport de prezență",
    dateLabel: "Data",
    hostLabel: "Gazdă",
    durationLabel: "Durată",
    columns: {"name":"Nume","email":"E-mail","joined":"Sosit","left":"Plecat","active":"Activ","status":"Stare"},
    summaryFormat: (present, total) => `${present} din ${total} înregistrați ca prezenți`
  },
  "uk": {
    reportTitle: "Звіт про відвідуваність",
    dateLabel: "Дата",
    hostLabel: "Організатор",
    durationLabel: "Тривалість",
    columns: {"name":"Ім'я","email":"Ел. пошта","joined":"Приєднався","left":"Покинув","active":"Активність","status":"Статус"},
    summaryFormat: (present, total) => `${present} із ${total} зареєстровано як присутні`
  },
  "fi": {
    reportTitle: "Läsnäoloraportti",
    dateLabel: "Päivämäärä",
    hostLabel: "Järjestäjä",
    durationLabel: "Kesto",
    columns: {"name":"Nimi","email":"Sähköposti","joined":"Liittyi","left":"Poistui","active":"Aktiivinen","status":"Tila"},
    summaryFormat: (present, total) => `${present}/${total} merkitty läsnäolevaksi`
  },
  "hu": {
    reportTitle: "Jelenléti jelentés",
    dateLabel: "Dátum",
    hostLabel: "Házigazda",
    durationLabel: "Időtartam",
    columns: {"name":"Név","email":"E-mail","joined":"Csatlakozott","left":"Távozott","active":"Aktív","status":"Állapot"},
    summaryFormat: (present, total) => `${present} / ${total} jelenlévőként rögzítve`
  },
  "no": {
    reportTitle: "Oppmøterapport",
    dateLabel: "Dato",
    hostLabel: "Vert",
    durationLabel: "Varighet",
    columns: {"name":"Navn","email":"E-post","joined":"Ble med","left":"Forlot","active":"Aktiv","status":"Status"},
    summaryFormat: (present, total) => `${present} av ${total} registrert som til stede`
  },
  "ne": {
    reportTitle: "उपस्थिति प्रतिवेदन",
    dateLabel: "मिति",
    hostLabel: "आयोजक",
    durationLabel: "अवधि",
    columns: {"name":"नाम","email":"इमेल","joined":"सामेल भएको","left":"छोडेको","active":"सक्रिय","status":"स्थिति"},
    summaryFormat: (present, total) => `${present} / ${total} उपस्थितको रूपमा दर्ता गरियो`
  },
  "ml": {
    reportTitle: "ഹാജർ റിപ്പോർട്ട്",
    dateLabel: "തീയതി",
    hostLabel: "ഹോസ്റ്റ്",
    durationLabel: "ദൈർഘ്യം",
    columns: {"name":"പേര്","email":"ഇമെയിൽ","joined":"ചേർന്നു","left":"ഇറങ്ങി","active":"സജീവം","status":"സ്റ്റാറ്റസ്"},
    summaryFormat: (present, total) => `${total}-ൽ ${present} പേർ ഹാജരായി രേഖപ്പെടുത്തി`
  },
  "mn": {
    reportTitle: "Ирцийн тайлан",
    dateLabel: "Огноо",
    hostLabel: "Зохион байгуулагч",
    durationLabel: "Үргэлжлэх хугацаа",
    columns: {"name":"Нэр","email":"Имэйл","joined":"Нэвтэрсэн","left":"Гарсан","active":"Идэвхтэй","status":"Төлөв"},
    summaryFormat: (present, total) => `${total}-аас ${present} оролцогч ирснээр бүртгэгдсэн`
  },
  "hi": {
    reportTitle: "उपस्थिति रिपोर्ट",
    dateLabel: "तारीख",
    hostLabel: "होस्ट",
    durationLabel: "अवधि",
    columns: {"name":"नाम","email":"ईमेल","joined":"शामिल हुए","left":"छोड़ा","active":"सक्रिय","status":"स्थिति"},
    summaryFormat: (present, total) => `${total} में से ${present} उपस्थित दर्ज किए गए`
  },
  "ta": {
    reportTitle: "வருகை அறிக்கை",
    dateLabel: "தேதி",
    hostLabel: "ஹோஸ்ட்",
    durationLabel: "கால அளவு",
    columns: {"name":"பெயர்","email":"மின்னஞ்சல்","joined":"இணைந்தார்","left":"வெளியேறினார்","active":"செயலில்","status":"நிலை"},
    summaryFormat: (present, total) => `${total}-இல் ${present} பேர் வருகை தந்ததாகப் பதிவு`
  },
  "te": {
    reportTitle: "హాజరు నివేదిక",
    dateLabel: "తేదీ",
    hostLabel: "హోస్ట్",
    durationLabel: "వ్యవధి",
    columns: {"name":"పేరు","email":"ఇమెయిల్","joined":"చేరారు","left":"నిష్క్రమించారు","active":"క్రియాశీలం","status":"స్థితి"},
    summaryFormat: (present, total) => `${total} మందిలో ${present} మంది హాజరైనట్లు నమోదు`
  },
  "bn": {
    reportTitle: "উপস্থিতি রিপোর্ট",
    dateLabel: "তারিখ",
    hostLabel: "হোস্ট",
    durationLabel: "সময়কাল",
    columns: {"name":"নাম","email":"ইমেল","joined":"যুক্ত হয়েছেন","left":"বেরিয়েছেন","active":"সক্রিয়","status":"স্ট্যাটাস"},
    summaryFormat: (present, total) => `${total} জনের মধ্যে ${present} জন উপস্থিত হিসেবে নথিভুক্ত`
  },
  "ur": {
    reportTitle: "حاضری کی رپورٹ",
    dateLabel: "تاریخ",
    hostLabel: "میزبان",
    durationLabel: "دورانیہ",
    columns: {"name":"نام","email":"ای میل","joined":"شامل ہوئے","left":"چھوڑا","active":"فعال","status":"حیثیت"},
    summaryFormat: (present, total) => `${total} میں سے ${present} کو حاضر درج کیا گیا`
  },
  "th": {
    reportTitle: "รายงานการเข้าร่วม",
    dateLabel: "วันที่",
    hostLabel: "ผู้จัด",
    durationLabel: "ระยะเวลา",
    columns: {"name":"ชื่อ","email":"อีเมล","joined":"เข้าร่วม","left":"ออก","active":"ใช้งาน","status":"สถานะ"},
    summaryFormat: (present, total) => `บันทึกว่าเข้าร่วม ${present} จากทั้งหมด ${total} คน`
  },
  "ar": {
    reportTitle: "تقرير الحضور",
    dateLabel: "التاريخ",
    hostLabel: "المضيف",
    durationLabel: "المدة",
    columns: {"name":"الاسم","email":"البريد الإلكتروني","joined":"انضم","left":"غادر","active":"نشط","status":"الحالة"},
    summaryFormat: (present, total) => `تم تسجيل ${present} من أصل ${total} كحاضرين`
  },
  "ko": {
    reportTitle: "출석 보고서",
    dateLabel: "날짜",
    hostLabel: "주최자",
    durationLabel: "소요 시간",
    columns: {"name":"이름","email":"이메일","joined":"참여","left":"퇴장","active":"참여 시간","status":"상태"},
    summaryFormat: (present, total) => `총 ${total}명 중 ${present}명이 출석으로 기록됨`
  },
  "zh": {
    reportTitle: "出席報告",
    dateLabel: "日期",
    hostLabel: "主持人",
    durationLabel: "時長",
    columns: {"name":"姓名","email":"電子郵件","joined":"加入","left":"離開","active":"活躍","status":"狀態"},
    summaryFormat: (present, total) => `已記錄 ${present}/${total} 人出席`
  },
  "zh-CN": {
    reportTitle: "出席报告",
    dateLabel: "日期",
    hostLabel: "主持人",
    durationLabel: "时长",
    columns: {"name":"姓名","email":"电子邮件","joined":"加入","left":"离开","active":"活跃","status":"状态"},
    summaryFormat: (present, total) => `已记录 ${present}/${total} 人出席`
  },
  "ja": {
    reportTitle: "出席レポート",
    dateLabel: "日付",
    hostLabel: "主催者",
    durationLabel: "滞在時間",
    columns: {"name":"氏名","email":"メールアドレス","joined":"参加","left":"退出","active":"滞在時間","status":"ステータス"},
    summaryFormat: (present, total) => `${total}名中${present}名が出席として記録されました`
  },
  "he": {
    reportTitle: "דוח נוכחות",
    dateLabel: "תאריך",
    hostLabel: "מארח",
    durationLabel: "משך",
    columns: {"name":"שם","email":"אימייל","joined":"הצטרף","left":"עזב","active":"פעיל","status":"סטטוס"},
    summaryFormat: (present, total) => `${present} מתוך ${total} נרשמו כנוכחים`
  },
  "mr": {
    reportTitle: "उपस्थिती अहवाल",
    dateLabel: "तारीख",
    hostLabel: "होस्ट",
    durationLabel: "कालावधी",
    columns: {"name":"नाव","email":"ईमेल","joined":"सामील झाले","left":"सोडले","active":"सक्रिय","status":"स्थिती"},
    summaryFormat: (present, total) => `${total} पैकी ${present} उपस्थित म्हणून नोंदवले गेले`
  },
  "so": {
    reportTitle: "Warbixinta Xaadirinta",
    dateLabel: "Taariikhda",
    hostLabel: "Martigeliyaha",
    durationLabel: "Muddada",
    columns: {"name":"Magaca","email":"Emailka","joined":"Ku biiray","left":"Baxay","active":"Firfircoon","status":"Xaaladda"},
    summaryFormat: (present, total) => `${present} ka mid ah ${total} ayaa loo diiwaangeliyay xaadir`
  },
  "sw": {
    reportTitle: "Ripoti ya Mahudhurio",
    dateLabel: "Tarehe",
    hostLabel: "Mwenyeji",
    durationLabel: "Muda",
    columns: {"name":"Jina","email":"Barua pepe","joined":"Amejiunga","left":"Ameondoka","active":"Inayotumika","status":"Hali"},
    summaryFormat: (present, total) => `${present} kati ya ${total} wamerekodiwa kama wapo`
  },
  "am": {
    reportTitle: "የተሳትፎ ሪፖርት",
    dateLabel: "ቀን",
    hostLabel: "አስተናጋጅ",
    durationLabel: "የፈጀው ጊዜ",
    columns: {"name":"ስም","email":"ኢሜይል","joined":"ገብቷል","left":"ወጥቷል","active":"ንቁ","status":"ሁኔታ"},
    summaryFormat: (present, total) => `ከ${total} ውስጥ ${present} እንደተገኙ ተመዝግቧል`
  },
  "si": {
    reportTitle: "පැමිණීමේ වාර්තාව",
    dateLabel: "දිනය",
    hostLabel: "සත්කාරක",
    durationLabel: "කාලසීමාව",
    columns: {"name":"නම","email":"විද්‍යුත් තැපෑල","joined":"සම්බන්ධ විය","left":"ඉවත් විය","active":"සක්‍රිය","status":"තත්ත්වය"},
    summaryFormat: (present, total) => `${total} දෙනෙකුගෙන් ${present} දෙනෙකු පැමිණි බව සටහන් විය`
  },
  "kn": {
    reportTitle: "ಹಾಜರಾತಿ ವರದಿ",
    dateLabel: "ದಿನಾಂಕ",
    hostLabel: "ಆತಿಥೇಯ",
    durationLabel: "ಅವಧಿ",
    columns: {"name":"ಹೆಸರು","email":"ಇಮೇಲ್","joined":"ಸೇರಿದರು","left":"ನಿರ್ಗಮಿಸಿದರು","active":"ಸಕ್ರಿಯ","status":"ಸ್ಥಿತಿ"},
    summaryFormat: (present, total) => `${total} ರಲ್ಲಿ ${present} ಜನ ಹಾಜರಾಗಿದ್ದಾರೆ ಎಂದು ದಾಖಲಿಸಲಾಗಿದೆ`
  },
  "gu": {
    reportTitle: "હાજરી અહેવાલ",
    dateLabel: "તારીખ",
    hostLabel: "હોસ્ટ",
    durationLabel: "સમયગાળો",
    columns: {"name":"નામ","email":"ઇમેઇલ","joined":"જોડાયા","left":"છોડ્યું","active":"સક્રિય","status":"સ્થિતિ"},
    summaryFormat: (present, total) => `${total} માંથી ${present} હાજર તરીકે નોંધાયા`
  },
  "pa": {
    reportTitle: "ਹਾਜ਼ਰੀ ਰਿਪੋਰਟ",
    dateLabel: "ਮਿਤੀ",
    hostLabel: "ਮੇਜ਼ਬਾਨ",
    durationLabel: "ਮਿਆਦ",
    columns: {"name":"ਨਾਮ","email":"ਈਮੇਲ","joined":"ਸ਼ਾਮਲ ਹੋਏ","left":"ਛੱਡਿਆ","active":"ਸਰਗਰਮ","status":"ਸਥਿਤੀ"},
    summaryFormat: (present, total) => `${total} ਵਿੱਚੋਂ ${present} ਹਾਜ਼ਰ ਵਜੋਂ ਦਰਜ ਕੀਤੇ ਗਏ`
  },
  "kk": {
    reportTitle: "Қатысу есебі",
    dateLabel: "Күні",
    hostLabel: "Ұйымдастырушы",
    durationLabel: "Ұзақтығы",
    columns: {"name":"Аты-жөні","email":"Эл. пошта","joined":"Қосылды","left":"Шықты","active":"Белсенді","status":"Күйі"},
    summaryFormat: (present, total) => `${total} қатысушының ${present}-і қатысты деп тіркелді`
  },
  "lv": {
    reportTitle: "Apmeklējuma pārskats",
    dateLabel: "Datums",
    hostLabel: "Rīkotājs",
    durationLabel: "Ilgums",
    columns: {"name":"Vārds","email":"E-pasts","joined":"Pievienojās","left":"Izgāja","active":"Aktīvs","status":"Statuss"},
    summaryFormat: (present, total) => `${present} no ${total} reģistrēti kā klātesoši`
  },
  "lt": {
    reportTitle: "Lankomumo ataskaita",
    dateLabel: "Data",
    hostLabel: "Organizatorius",
    durationLabel: "Trukmė",
    columns: {"name":"Vardas","email":"El. paštas","joined":"Prisijungė","left":"Išėjo","active":"Aktyvus","status":"Būsena"},
    summaryFormat: (present, total) => `${present} iš ${total} užregistruoti kaip dalyvavę`
  },
  "lo": {
    reportTitle: "ລາຍງານການເຂົ້າຮ່ວມ",
    dateLabel: "ວັນທີ",
    hostLabel: "ຜູ້ຈັດ",
    durationLabel: "ໄລຍະເວລາ",
    columns: {"name":"ຊື່","email":"ອີເມວ","joined":"ເຂົ້າຮ່ວມ","left":"ອອກ","active":"ກຳລັງເຮັດວຽກ","status":"ສະຖານະ"},
    summaryFormat: (present, total) => `ບັນທຶກວ່າເຂົ້າຮ່ວມ ${present} ຈາກທັງໝົດ ${total} ຄົນ`
  },
  "my": {
    reportTitle: "တက်ရောက်မှု အစီရင်ခံစာ",
    dateLabel: "ရက်စွဲ",
    hostLabel: "အစည်းအဝေးဦးဆောင်သူ",
    durationLabel: "ကြာချိန်",
    columns: {"name":"အမည်","email":"အီးမေးလ်","joined":"ဝင်ရောက်ချိန်","left":"ထွက်ခွာချိန်","active":"တက်ကြွ","status":"အခြေအနေ"},
    summaryFormat: (present, total) => `စုစုပေါင်း ${total} ဦးတွင် ${present} ဦး တက်ရောက်ကြောင်း မှတ်တမ်းတင်ထားသည်`
  },
  "km": {
    reportTitle: "របាយការណ៍វត្តមាន",
    dateLabel: "កាលបរិច្ឆេទ",
    hostLabel: "អ្នករៀបចំ",
    durationLabel: "រយៈពេល",
    columns: {"name":"ឈ្មោះ","email":"អ៊ីមែល","joined":"បានចូលរួម","left":"បានចាកចេញ","active":"សកម្ម","status":"ស្ថានភាព"},
    summaryFormat: (present, total) => `បានកត់ត្រាវត្តមាន ${present} នាក់ ក្នុងចំណោម ${total} នាក់`
  },
  "ceb": {
    reportTitle: "Taho sa Pagtambong",
    dateLabel: "Petsa",
    hostLabel: "Tig-organisar",
    durationLabel: "Gidugayon",
    columns: {"name":"Ngalan","email":"Email","joined":"Misulod","left":"Mibiya","active":"Aktibo","status":"Kahimtang"},
    summaryFormat: (present, total) => `${present} sa ${total} ang narekord nga mitambong`
  },
  "bg": {
    reportTitle: "Отчет за присъствие",
    dateLabel: "Дата",
    hostLabel: "Организатор",
    durationLabel: "Продължителност",
    columns: {"name":"Име","email":"Имейл","joined":"Присъединил се","left":"Напуснал","active":"Активен","status":"Статус"},
    summaryFormat: (present, total) => `${present} от ${total} записани като присъстващи`
  },
  "hr": {
    reportTitle: "Izvještaj o prisutnosti",
    dateLabel: "Datum",
    hostLabel: "Domaćin",
    durationLabel: "Trajanje",
    columns: {"name":"Ime","email":"E-pošta","joined":"Pristupio","left":"Napustio","active":"Aktivan","status":"Status"},
    summaryFormat: (present, total) => `${present} od ${total} zabilježeno kao prisutno`
  },
  "sr": {
    reportTitle: "Извештај о присутности",
    dateLabel: "Датум",
    hostLabel: "Домаћин",
    durationLabel: "Трајање",
    columns: {"name":"Име","email":"Е-пошта","joined":"Приступио","left":"Напустио","active":"Активан","status":"Статус"},
    summaryFormat: (present, total) => `${present} од ${total} евидентирано као присутно`
  },
  "sk": {
    reportTitle: "Správa o účasti",
    dateLabel: "Dátum",
    hostLabel: "Organizátor",
    durationLabel: "Trvanie",
    columns: {"name":"Meno","email":"E-mail","joined":"Pripojil sa","left":"Odišiel","active":"Aktívny","status":"Stav"},
    summaryFormat: (present, total) => `${present} z ${total} zaznamenaných ako prítomných`
  },
  "sl": {
    reportTitle: "Poročilo o prisotnosti",
    dateLabel: "Datum",
    hostLabel: "Gostitelj",
    durationLabel: "Trajanje",
    columns: {"name":"Ime","email":"E-pošta","joined":"Pridružil se","left":"Zapustil","active":"Aktiven","status":"Stanje"},
    summaryFormat: (present, total) => `${present} od ${total} zabeleženih kot prisotnih`
  },
  "af": {
    reportTitle: "Bywoningsverslag",
    dateLabel: "Datum",
    hostLabel: "Aanbieder",
    durationLabel: "Duur",
    columns: {"name":"Naam","email":"E-pos","joined":"Aangesluit","left":"Verlaat","active":"Aktief","status":"Status"},
    summaryFormat: (present, total) => `${present} van ${total} aangeteken as teenwoordig`
  }
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
  COUNTRY_TO_LOCALE,
  LOCALIZED_HEADERS,
  DEFAULT_SUMMARY_LABELS,
  LOCALIZED_SUMMARY_LABELS,
  DEFAULT_PDF_LABELS,
  STATUS_TRANSLATIONS,
  RSVP_TRANSLATIONS,
  LOCALIZED_RSVP,
  PDF_TRANSLATIONS,
  _resetCache: () => { cachedStrings = null; },
};
