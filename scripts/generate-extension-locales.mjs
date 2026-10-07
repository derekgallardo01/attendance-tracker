import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES_DIR = path.join(ROOT, 'companion-extension', '_locales');

const TRANSLATIONS = {
  en: {
    appName: "Attendance Tracker for Google Meet — Launcher",
    appShortName: "Attendance Tracker",
    appDesc: "Companion launcher for Attendance Tracker in Google Meet. Real-time roll call, timestamps, and one-click Sheets export.",
    actionTitle: "Attendance Tracker for Google Meet"
  },
  es: {
    appName: "Attendance Tracker para Google Meet — Launcher",
    appShortName: "Attendance Tracker",
    appDesc: "Iniciador complementario para Attendance Tracker en Google Meet. Control de asistencia en tiempo real y exportación a Sheets.",
    actionTitle: "Attendance Tracker para Google Meet"
  },
  pt: {
    appName: "Attendance Tracker para Google Meet — Launcher",
    appShortName: "Attendance Tracker",
    appDesc: "Iniciador complementar para o Attendance Tracker no Google Meet. Chamada em tempo real e exportação para o Google Sheets.",
    actionTitle: "Attendance Tracker para Google Meet"
  },
  pt_BR: {
    appName: "Attendance Tracker para Google Meet — Launcher",
    appShortName: "Attendance Tracker",
    appDesc: "Iniciador complementar para o Attendance Tracker no Google Meet. Chamada em tempo real e exportação para o Google Sheets.",
    actionTitle: "Attendance Tracker para Google Meet"
  },
  pt_PT: {
    appName: "Attendance Tracker para Google Meet — Launcher",
    appShortName: "Attendance Tracker",
    appDesc: "Iniciador complementar para o Attendance Tracker no Google Meet. Chamada em tempo real e exportação para o Google Sheets.",
    actionTitle: "Attendance Tracker para Google Meet"
  },
  fr: {
    appName: "Attendance Tracker pour Google Meet — Lanceur",
    appShortName: "Attendance Tracker",
    appDesc: "Lanceur compagnon pour Attendance Tracker dans Google Meet. Appel en temps réel, horodatages et export Sheets en un clic.",
    actionTitle: "Attendance Tracker pour Google Meet"
  },
  de: {
    appName: "Attendance Tracker für Google Meet — Launcher",
    appShortName: "Attendance Tracker",
    appDesc: "Begleitender Launcher für Attendance Tracker in Google Meet. Echtzeit-Anwesenheit und 1-Klick-Export nach Google Sheets.",
    actionTitle: "Attendance Tracker für Google Meet"
  },
  it: {
    appName: "Attendance Tracker per Google Meet — Launcher",
    appShortName: "Attendance Tracker",
    appDesc: "Launcher per Attendance Tracker in Google Meet. Appello in tempo reale, registrazioni orarie ed esportazione in Sheets.",
    actionTitle: "Attendance Tracker per Google Meet"
  },
  nl: {
    appName: "Attendance Tracker voor Google Meet — Launcher",
    appShortName: "Attendance Tracker",
    appDesc: "Begeleidende launcher voor Attendance Tracker in Google Meet. Realtime aanwezigheid en export naar Google Sheets met één klik.",
    actionTitle: "Attendance Tracker voor Google Meet"
  },
  pl: {
    appName: "Attendance Tracker dla Google Meet — Launcher",
    appShortName: "Attendance Tracker",
    appDesc: "Pomocniczy program uruchamiający Attendance Tracker w Google Meet. Lista obecności w czasie rzeczywistym i eksport do Sheets.",
    actionTitle: "Attendance Tracker dla Google Meet"
  },
  ru: {
    appName: "Attendance Tracker для Google Meet — Запуск",
    appShortName: "Attendance Tracker",
    appDesc: "Средство запуска для Attendance Tracker в Google Meet. Отслеживание посещаемости в реальном времени и экспорт в Таблицы.",
    actionTitle: "Attendance Tracker для Google Meet"
  },
  tr: {
    appName: "Google Meet için Attendance Tracker — Başlatıcı",
    appShortName: "Attendance Tracker",
    appDesc: "Google Meet'te Attendance Tracker için başlatıcı. Gerçek zamanlı yoklama ve tek tıkla E-Tablolar'a dışa aktarma.",
    actionTitle: "Google Meet için Attendance Tracker"
  },
  ja: {
    appName: "Google Meet用出席トラッカー — ランチャー",
    appShortName: "出席トラッカー",
    appDesc: "Google Meet用出席トラッカーのランチャー。リアルタイムの点呼、入退出時間、Googleスプレッドシートへのワンクリック出力。",
    actionTitle: "Google Meet用出席トラッカー"
  },
  ko: {
    appName: "Google Meet 출석 트래커 — 실행기",
    appShortName: "출석 트래커",
    appDesc: "Google Meet용 Attendance Tracker 실행기. 실시간 출석 체크, 타임스탬프 및 클릭 한 번으로 스프레드시트 내보내기.",
    actionTitle: "Google Meet 출석 트래커"
  },
  zh_CN: {
    appName: "Google Meet 出勤跟踪器 — 启动器",
    appShortName: "出勤跟踪器",
    appDesc: "Google Meet 出勤跟踪器的配套启动器。实时点名、时间戳记录及一键导出到 Google 表格。",
    actionTitle: "Google Meet 出勤跟踪器"
  },
  zh_TW: {
    appName: "Google Meet 出勤追蹤器 — 啟動器",
    appShortName: "出勤追蹤器",
    appDesc: "Google Meet 出勤追蹤器的附屬啟動器。即時點名、時間戳記及一鍵匯出到 Google 試算表。",
    actionTitle: "Google Meet 出勤追蹤器"
  },
  hi: {
    appName: "Google Meet के लिए Attendance Tracker — लॉन्चर",
    appShortName: "Attendance Tracker",
    appDesc: "Google Meet में Attendance Tracker के लिए साथी लॉन्चर। रीयल-टाइम उपस्थिति और Google Sheets में एक-क्लिक निर्यात।",
    actionTitle: "Google Meet के लिए Attendance Tracker"
  },
  id: {
    appName: "Attendance Tracker untuk Google Meet — Peluncur",
    appShortName: "Attendance Tracker",
    appDesc: "Peluncur untuk Attendance Tracker di Google Meet. Presensi kehadiran langsung dan ekspor Google Spreadsheet dalam satu klik.",
    actionTitle: "Attendance Tracker untuk Google Meet"
  },
  th: {
    appName: "Attendance Tracker สำหรับ Google Meet — ตัวเปิดใช้",
    appShortName: "Attendance Tracker",
    appDesc: "ตัวเปิดใช้สำหรับ Attendance Tracker ใน Google Meet เช็คชื่อแบบเรียลไทม์ และส่งออกไปยัง Google ชีตในคลิกเดียว",
    actionTitle: "Attendance Tracker สำหรับ Google Meet"
  },
  vi: {
    appName: "Attendance Tracker cho Google Meet — Trình khởi chạy",
    appShortName: "Attendance Tracker",
    appDesc: "Trình khởi chạy cho Attendance Tracker trong Google Meet. Điểm danh theo thời gian thực và xuất Google Trang tính với 1 cú nhấp.",
    actionTitle: "Attendance Tracker cho Google Meet"
  },
  ar: {
    appName: "Attendance Tracker لـ Google Meet — المشغّل",
    appShortName: "Attendance Tracker",
    appDesc: "مشغّل ملحق لـ Attendance Tracker في Google Meet. تسجيل الحضور في الوقت الفعلي والتصدير بنقرة واحدة إلى Google Sheets.",
    actionTitle: "Attendance Tracker لـ Google Meet"
  },
  he: {
    appName: "Attendance Tracker עבור Google Meet — מפעיל",
    appShortName: "Attendance Tracker",
    appDesc: "משגר נלווה עבור Attendance Tracker ב-Google Meet. נוכחות בזמן אמת וייצוא ל-Google Sheets בלחיצה אחת.",
    actionTitle: "Attendance Tracker עבור Google Meet"
  },
  sv: {
    appName: "Attendance Tracker för Google Meet — Startprogram",
    appShortName: "Attendance Tracker",
    appDesc: "Snabbstartare för Attendance Tracker i Google Meet. Närvaro i realtid och export till Google Kalkylark med ett klick.",
    actionTitle: "Attendance Tracker för Google Meet"
  },
  da: {
    appName: "Attendance Tracker til Google Meet — Starter",
    appShortName: "Attendance Tracker",
    appDesc: "Startprogram til Attendance Tracker i Google Meet. Fremmøderegistrering i realtid og eksport til Google Sheets med et enkelt klik.",
    actionTitle: "Attendance Tracker til Google Meet"
  },
  fi: {
    appName: "Attendance Tracker Google Meetille — Käynnistin",
    appShortName: "Attendance Tracker",
    appDesc: "Attendance Trackerin käynnistin Google Meetissä. Reaaliaikainen nimenhuuto ja vienti Google Sheetsiin yhdellä klikkauksella.",
    actionTitle: "Attendance Tracker Google Meetille"
  },
  nb: {
    appName: "Attendance Tracker for Google Meet — Starter",
    appShortName: "Attendance Tracker",
    appDesc: "Oppstartsverktøy for Attendance Tracker i Google Meet. Oppmøte i sanntid og eksport til Google Regneark med ett klikk.",
    actionTitle: "Attendance Tracker for Google Meet"
  },
  cs: {
    appName: "Attendance Tracker pro Google Meet — Spouštěč",
    appShortName: "Attendance Tracker",
    appDesc: "Doprovodný spouštěč pro Attendance Tracker v Google Meet. Docházka v reálném čase a export do Tabulek Google jedním kliknutím.",
    actionTitle: "Attendance Tracker pro Google Meet"
  },
  hu: {
    appName: "Attendance Tracker a Google Meet-hez — Indító",
    appShortName: "Attendance Tracker",
    appDesc: "Indítóprogram az Attendance Trackerhez a Google Meetben. Valós idejű jelenléti ív és exportálás a Google Táblázatokba egyetlen kattintással.",
    actionTitle: "Attendance Tracker a Google Meet-hez"
  },
  el: {
    appName: "Attendance Tracker για το Google Meet — Πρόγραμμα εκκίνησης",
    appShortName: "Attendance Tracker",
    appDesc: "Βοηθητικό πρόγραμμα εκκίνησης για το Attendance Tracker στο Google Meet. Παρουσίες σε πραγματικό χρόνο και εξαγωγή στα Φύλλα Google.",
    actionTitle: "Attendance Tracker για το Google Meet"
  },
  ro: {
    appName: "Attendance Tracker pentru Google Meet — Lansator",
    appShortName: "Attendance Tracker",
    appDesc: "Lansator pentru Attendance Tracker în Google Meet. Prezență în timp real și export cu un singur clic în Google Sheets.",
    actionTitle: "Attendance Tracker pentru Google Meet"
  },
  bg: {
    appName: "Attendance Tracker за Google Meet — Стартер",
    appShortName: "Attendance Tracker",
    appDesc: "Стартер за Attendance Tracker в Google Meet. Присъствие в реално време и експортиране в Google Таблици с едно щракване.",
    actionTitle: "Attendance Tracker за Google Meet"
  },
  hr: {
    appName: "Attendance Tracker za Google Meet — Pokretač",
    appShortName: "Attendance Tracker",
    appDesc: "Prateći pokretač za Attendance Tracker u usluzi Google Meet. Praćenje prisutnosti u stvarnom vremenu i izvoz u Google tablice jednim klikom.",
    actionTitle: "Attendance Tracker za Google Meet"
  },
  sr: {
    appName: "Attendance Tracker за Google Meet — Покретач",
    appShortName: "Attendance Tracker",
    appDesc: "Пратећи покретач за Attendance Tracker у услузи Google Meet. Праћење присутности у реалном времену и извоз у Google табеле једним кликом.",
    actionTitle: "Attendance Tracker за Google Meet"
  },
  sk: {
    appName: "Attendance Tracker pre Google Meet — Spúšťač",
    appShortName: "Attendance Tracker",
    appDesc: "Sprievodný spúšťač pre Attendance Tracker v službe Google Meet. Dochádzka v reálnom čase a export do Tabuliek Google jedným kliknutím.",
    actionTitle: "Attendance Tracker pre Google Meet"
  },
  sl: {
    appName: "Attendance Tracker za Google Meet — Zaganjalnik",
    appShortName: "Attendance Tracker",
    appDesc: "Spremljevalni zaganjalnik za Attendance Tracker v storitvi Google Meet. Prisotnost v realnem času in izvoz v Google Preglednice z enim klikom.",
    actionTitle: "Attendance Tracker za Google Meet"
  },
  uk: {
    appName: "Attendance Tracker для Google Meet — Запуск",
    appShortName: "Attendance Tracker",
    appDesc: "Засіб запуску для Attendance Tracker у Google Meet. Відстеження відвідуваності в реальному часі та експорт у Google Таблиці.",
    actionTitle: "Attendance Tracker для Google Meet"
  },
  ca: {
    appName: "Attendance Tracker per a Google Meet — Llançador",
    appShortName: "Attendance Tracker",
    appDesc: "Llançador complementari per a Attendance Tracker a Google Meet. Control d'assistència en temps real i exportació a Google Sheets.",
    actionTitle: "Attendance Tracker per a Google Meet"
  },
  fil: {
    appName: "Attendance Tracker para sa Google Meet — Launcher",
    appShortName: "Attendance Tracker",
    appDesc: "Kasabayang launcher para sa Attendance Tracker sa Google Meet. Real-time na attendance at 1-click export sa Google Sheets.",
    actionTitle: "Attendance Tracker para sa Google Meet"
  },
  ms: {
    appName: "Attendance Tracker untuk Google Meet — Pelancar",
    appShortName: "Attendance Tracker",
    appDesc: "Pelancar untuk Attendance Tracker di Google Meet. Kehadiran masa nyata dan eksport satu klik ke Google Sheets.",
    actionTitle: "Attendance Tracker untuk Google Meet"
  }
};

export function generateExtensionLocales() {
  if (!fs.existsSync(LOCALES_DIR)) {
    fs.mkdirSync(LOCALES_DIR, { recursive: true });
  }

  for (const [locale, msgs] of Object.entries(TRANSLATIONS)) {
    const dir = path.join(LOCALES_DIR, locale);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filePath = path.join(dir, 'messages.json');
    const content = {
      appName: {
        message: msgs.appName,
        description: "The title of the extension"
      },
      appShortName: {
        message: msgs.appShortName,
        description: "Short name for the extension"
      },
      appDesc: {
        message: msgs.appDesc,
        description: "Description of the extension"
      },
      actionTitle: {
        message: msgs.actionTitle,
        description: "Tooltip for the action icon"
      }
    };
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2) + '\n', 'utf8');
  }
  console.log(`Generated messages.json for ${Object.keys(TRANSLATIONS).length} Chrome extension locales.`);

  const popupJsPath = path.join(ROOT, 'companion-extension', 'popup.js');
  if (fs.existsSync(popupJsPath)) {
    let pjs = fs.readFileSync(popupJsPath, 'utf8');
    const oldStep2 = `return text.replace(/(Activities(?: icon)?|Actividades|Atividades|активности|figuras geométricas|formas|आकृतियाँ|செயல்பாடுகள்|యాక్టివిటీస్|অ্যাক্টিভিটিজ|سرگرمیوں|กิจกรรม|Hoạt động|الأنشطة|פעילויות|Aktiviteter|Toiminnot|Aktivita|Tevékenységek|Δραστηριότητες|Activități|Дейности|Aktivnosti|Aktivity|Dejavnosti|Дії|Activitats|Mga Aktibidad|Aktiviti)/i, '<strong>$1</strong>');`;
    const newStep2 = `return text.replace(/(Activities(?: icon)?|Actividades|Atividades|Activités|Aktivitäten|Attività|Activiteiten|Aktywności|Działania|Действия|активности|figuras geométricas|formas|formes géométriques|Formen|Aktiviteler|Etkinlikler|アクティビティ|활동|活动|活動|आकृतियाँ|செயல்பாடுகள்|యాక్టివిటీస్|অ্যাক্টিভিটিজ|سرگرمیوں|กิจกรรม|Hoạt động|الأنشطة|פעילויות|Aktiviteter|Toiminnot|Aktivita|Tevékenységek|Δραστηριότητες|Activități|Дейности|Aktivnosti|Aktivity|Dejavnosti|Дії|Activitats|Mga Aktibidad|Aktiviti)/i, '<strong>$1</strong>');`;
    const oldStep3 = `return res.replace(/(Start|Iniciar|Démarrer|Starten|Avvia|Início|शुरू करें|தொடங்கு|ప్రారంభించు|শুরু|شروع کریں|Bắt đầu|เริ่ม|ابدأ|התחל|Aloita|Kezdés|Έναρξη|Pornire|Старт|Pokreni|Začni|Почати|Inicia|Magsimula|Mula)/i, '<strong>$1</strong>');`;
    const newStep3 = `return res.replace(/(Start|Iniciar|Démarrer|Starten|Avvia|Início|Başlat|Rozpocznij|Начать|Запустить|開始|시작|开始|शुरू करें|தொடங்கு|ప్రారంభించు|শুরু|شروع کریں|Bắt đầu|เริ่ม|ابدأ|התחל|Aloita|Kezdés|Έναρξη|Pornire|Старт|Pokreni|Začni|Почати|Inicia|Magsimula|Mula)/i, '<strong>$1</strong>');`;
    pjs = pjs.replace(oldStep2, newStep2).replace(oldStep3, newStep3);
    fs.writeFileSync(popupJsPath, pjs, 'utf8');
  }
}

generateExtensionLocales();
