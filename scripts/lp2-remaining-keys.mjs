import { LP2_REMAINING_PART1 } from './lp2-remaining-part1.mjs';
import { V, SHORT_DICT } from './lp2-remaining-part2.mjs';
import { REMAINING_43 } from './lp2-remaining-part3.mjs';
import { REMAINING_37 } from './lp2-remaining-part4.mjs';
import { REMAINING_32 } from './lp2-remaining-part5.mjs';
import { REMAINING_13A } from './lp2-remaining-part6a.mjs';
import { REMAINING_13B } from './lp2-remaining-part6b.mjs';

export const REMAINING_LP2_KEYS_EN = {
  "lp2_hamburger_aria": "Toggle navigation menu",
  "lp2_teacher_c3_body": "Stop reading names from a paper sheet while students wait. One click pulls your Google Classroom roster, logs late arrivals to the minute, and gives you back the first 5 minutes of every period.",
  "lp2_video_play_aria": "Play 90-second product demo",
  "lp2_cmp_link_vs": "Compare vs. Meet Attendance Extension",
  "lp2_cmp_link_best": "7 Best Google Meet Attendance Trackers (2026)",
  "lp2_rev_1_prob": "Manual roll call wasted class time",
  "lp2_rev_2_prob": "Logging attendance into gradebook by hand",
  "lp2_rev_3_prob": "No duration data for tutoring logs",
  "lp2_rev_4_prob": "Chrome extensions broke mid-semester",
  "lp2_rev_5_prob": "Daily standup tracking across remote teams",
  "lp2_rev_6_prob": "Tracking late arrivals in 40+ student classes",
  "lp2_rev_stars_aria": "5 out of 5 stars",
  "lp2_rev_verify": "Verify on Google Marketplace →",
  "lp2_rev_verify_pl": "Verify on Google Marketplace (Polish) →",
  "lp2_case_1_tag": "Case Study 01 · Live Session Hosting",
  "lp2_case_1_title": "Mike Haynes: Eliminating mid-call roll-call distractions with 1-click Google Sheets sync",
  "lp2_case_1_body": "<strong>The Challenge:</strong> Manually watching the Google Meet participant list to catch late arrivals and early drop-offs pulled focus away from leading the session.<br><br><strong>The Workflow:</strong> Installed Attendance Tracker from the Google Workspace Marketplace to record join timestamps and net duration automatically inside the Meet side panel, followed by one-click export to Google Sheets.",
  "lp2_case_1_outcome": "<strong>Outcome:</strong> Zero host distraction during live sessions and permanent attendance records stored in Google Sheets (<a href=\"https://workspace.google.com/marketplace/app/attendance_tracker/829771833968\" target=\"_blank\" rel=\"noopener\" style=\"color:inherit;text-decoration:underline\">Verified 5★ review, Aug 11, 2026</a>).",
  "lp2_case_2_tag": "Case Study 02 · Classroom & Team Check-Ins",
  "lp2_case_2_title": "Gift otindo: Cutting manual data entry errors across Google Classroom & Google Sheets",
  "lp2_case_2_body": "<strong>The Challenge:</strong> Cross-referencing expected class rosters against live Google Meet attendees by hand created transcription errors and hid multi-week tardiness trends.<br><br><strong>The Workflow:</strong> Connected Google Classroom rosters directly to Attendance Tracker so expected students are matched automatically against official Meet API join/leave events and exported to Sheets.",
  "lp2_case_2_outcome": "<strong>Outcome:</strong> Eliminated manual data entry errors and surfaced tardiness/absence trends without complex menus (<a href=\"https://workspace.google.com/marketplace/app/attendance_tracker/829771833968\" target=\"_blank\" rel=\"noopener\" style=\"color:inherit;text-decoration:underline\">Verified 5★ review, Oct 15, 2026</a>).",
  "lp2_case_3_tag": "Case Study 03 · Public Education (KPM Malaysia & LATAM)",
  "lp2_case_3_title": "LIM GUAN YOU (KPM-Murid) & Mirna Iveth Bustos: Multilingual classroom attendance",
  "lp2_case_3_body": "<strong>The Challenge:</strong> Teachers and education institutions across Malaysia (KPM) and Latin America needed an attendance tracker that works on standard school accounts in their native language without per-month subscriptions.<br><br><strong>The Workflow:</strong> Used Attendance Tracker's localized 60-language interface inside Google Meet to capture Present, Late, and Absent statuses and student statistics automatically.",
  "lp2_case_3_outcome": "<strong>Outcome:</strong> Saved 5–10 minutes of instructional time per class with organized, multi-session student statistics (<a href=\"https://workspace.google.com/marketplace/app/attendance_tracker/829771833968\" target=\"_blank\" rel=\"noopener\" style=\"color:inherit;text-decoration:underline\">Verified 5★ reviews, Oct 2026</a>).",
  "lp2_intent_sub": "Whether you searched for a <strong>Google Meet attendance tracker</strong>, a <strong>Google Meet attendance extension</strong>, a <strong>free Google Meet attendance tracker</strong>, or a <strong>Google Meet attendance tracker for teachers</strong>, here are the exact facts before you install.",
  "lp2_intent_1_title": "1. Pricing & Free Tier",
  "lp2_intent_1_body": "<strong>Free forever ($0, no credit card):</strong> Unlimited live participant tracking in the Google Meet side panel and 2 free exports per month across Google Sheets, CSV, or Excel for meetings up to 25 attendees (plus 1 lifetime large-class grace export). <strong>Paid upgrades:</strong> $9.99–$29 one-time Lifetime Pro (no recurring subscription), $4.99–$14.99/yr Educator Pro, $59/yr Department (unlimited school/department teachers), or $149/yr Institution (unlimited domain teachers + signed DPA). Automatic regional PPP discounts in 90+ countries.",
  "lp2_intent_2_title": "2. Setup (30 Seconds)",
  "lp2_intent_2_body": "<strong>No Chrome extension to maintain:</strong> Install once from the <a href=\"https://workspace.google.com/marketplace/app/attendance_tracker/829771833968\" target=\"_blank\" rel=\"noopener\">Google Workspace Marketplace</a>. In any Google Meet call, click the <strong>Activities</strong> icon (bottom-right puzzle piece) and open <strong>Attendance Tracker</strong>. Works immediately in Chrome, Safari, Edge, Brave, Firefox, and school-managed Chromebooks where Chrome Web Store extensions are blocked.",
  "lp2_intent_3_title": "3. Permissions & Privacy",
  "lp2_intent_3_body": "<strong>Narrow OAuth 2.0 scopes, zero DOM scraping:</strong> Unlike Chrome extensions that request broad <code>read and change all data on meet.google.com</code> permissions, Attendance Tracker uses scoped Google APIs: <code>meetings.space.readonly</code> (participant join/leave events), <code>drive.file</code> (writes only to Sheets it creates in your Drive), and optional <code>classroom.rosters.readonly</code>. OAuth tokens are encrypted with AES-256-GCM. FERPA, COPPA &amp; GDPR compliant.",
  "lp2_intent_4_title": "4. Accuracy & Rejoins",
  "lp2_intent_4_body": "<strong>Official Google Meet API precision:</strong> Because data comes from Google's server-side Meet conference APIs rather than reading browser HTML tiles, off-screen participants and layout changes never cause missed attendees. Disconnected participants who rejoin have their intervals automatically merged into a single row with first join time, last leave time, net duration, and re-entry count.",
  "lp2_intent_5_title": "5. Exports & LMS Formats",
  "lp2_intent_5_body": "<strong>Permanent records you own:</strong> One-click export to formatted <strong>Google Sheets</strong> (saved permanently in your own Google Drive with color-coded Present/Late/Absent tabs and a multi-meeting Overview matrix), <strong>CSV</strong>, and <strong>Excel (.xlsx)</strong>. Pro plans add pre-formatted <strong>Canvas</strong> and <strong>Moodle</strong> gradebook CSVs, verifiable PDF certificates, and Slack/Google Chat/Discord digests.",
  "lp2_intent_6_title": "6. Google Account Compatibility",
  "lp2_intent_6_body": "<strong>Works on every Google account tier:</strong> Unlike Google's built-in attendance report (which requires paid Workspace Business Standard/Plus or Education Plus), Attendance Tracker works on <strong>free personal <code>@gmail.com</code> accounts</strong>, <strong>Google Workspace for Education Fundamentals (free tier)</strong>, Workspace Starter, Business, and Enterprise. Co-hosts and TAs can also track via 2-minute admin delegation.",
  "lp2_intent_link_reviews": "Read 14 Verified Customer Reviews →",
  "lp2_intent_link_vs": "AttendanceTracker.dev vs Competitor →",
  "lp2_intent_link_guide": "Guide for K-12 & University Teachers →",
  "lp2_intent_link_ext": "2026 Google Meet Attendance Extensions Compared →",
  "lp2_llm_specs": "AI & Search Engine Specifications:"
};

const DIRECT_KEY_ORDER = Object.keys(REMAINING_LP2_KEYS_EN);

const PACK_KEY_ORDER = [
  "lp2_hamburger_aria",      // 0
  "lp2_video_play_aria",     // 1
  "lp2_cmp_link_vs",         // 2
  "lp2_cmp_link_best",       // 3
  "lp2_rev_1_prob",          // 4
  "lp2_rev_2_prob",          // 5
  "lp2_rev_3_prob",          // 6
  "lp2_rev_4_prob",          // 7
  "lp2_rev_5_prob",          // 8
  "lp2_rev_6_prob",          // 9
  "lp2_rev_stars_aria",      // 10
  "lp2_rev_verify",          // 11
  "lp2_rev_verify_pl",       // 12
  "lp2_case_1_tag",          // 13
  "lp2_case_1_title",        // 14
  "lp2_case_2_tag",          // 15
  "lp2_case_2_title",        // 16
  "lp2_case_3_tag",          // 17
  "lp2_case_3_title",        // 18
  "lp2_intent_1_title",      // 19
  "lp2_intent_2_title",      // 20
  "lp2_intent_3_title",      // 21
  "lp2_intent_4_title",      // 22
  "lp2_intent_5_title",      // 23
  "lp2_intent_6_title",      // 24
  "lp2_intent_link_reviews", // 25
  "lp2_intent_link_vs",      // 26
  "lp2_intent_link_guide",   // 27
  "lp2_intent_link_ext",     // 28
  "lp2_llm_specs",           // 29
  "lp2_teacher_c3_body",     // 30
  "lp2_case_1_body",         // 31
  "lp2_case_1_outcome",      // 32
  "lp2_case_2_body",         // 33
  "lp2_case_2_outcome",      // 34
  "lp2_case_3_body",         // 35
  "lp2_case_3_outcome",      // 36
  "lp2_intent_sub",          // 37
  "lp2_intent_1_body",       // 38
  "lp2_intent_2_body",       // 39
  "lp2_intent_3_body",       // 40
  "lp2_intent_4_body",       // 41
  "lp2_intent_5_body",       // 42
  "lp2_intent_6_body"        // 43
];

const PACK_LOCALES = {
  ...V,
  ...SHORT_DICT,
  ...REMAINING_43,
  ...REMAINING_37,
  ...REMAINING_32,
  ...REMAINING_13A,
  ...REMAINING_13B
};

// Additional fixes for existing keys (placeholder parity, script purity, and allowlist cleanup)
const EXTRA_EXISTING_KEY_FIXES = {
  nl: {
    "referral.bodyDomain": "Help collega-docenten bij @{domain} tijd te besparen bij het opnemen van aanwezigheid in Google Meet. Wanneer een collega via jouw link deelneemt en aanwezigheid bijhoudt, ontgrendelen jullie allebei 1 maand gratis Pro!"
  },
  gu: {
    "pricing.matrixBrowsersOther": "માત્ર Chrome ડેસ્કટોપ",
    "pricing.matrixBrowsersExt": "માત્ર Chrome ડેસ્કટોપ"
  },
  tl: {
    "lp2_who_4_tag": "Pagtuturo"
  }
};

const EDU_NAME_FIXES = {
  af: "Opvoeder", am: "መምህር", bg: "Преподавател", bn: "শিক্ষক", ceb: "Magtutudlo",
  el: "Εκπαιδευτικός", gu: "શિક્ષક", hr: "Edukator", kk: "Мұғалім", kn: "ಶಿಕ್ಷಕ",
  lo: "ຄູສອນ", lt: "Pedagogas", lv: "Pedagogs", mr: "शिक्षक", my: "ဆရာ",
  ne: "शिक्षक", pa: "ਅਧਿਆਪਕ", si: "ගුරු", sl: "Izobraževalec", so: "Macallin",
  sr: "Едукатор", sw: "Mwalimu", ta: "ஆசிரியர்", te: "ఉపాధ్యాయుడు", uk: "Освітянин", ur: "معلم"
};

const LIFE_NAME_FIXES = {
  am: "የዕድሜ ልክ", bg: "Доживотен", bn: "আজীবন", ceb: "Tibook Kinabuhi", el: "Εφ' όρου ζωής",
  gu: "આજીવન", kk: "Өмірлік", kn: "ಜೀವಿತಾವಧಿ", lo: "ຕະຫຼອດຊີວິດ", lt: "Visam gyvenimui",
  lv: "Mūža", mr: "आजीवन", ne: "आजीवन", ro: "Pe viață", si: "ජීවිත කාලයටම",
  so: "Nolol-dheer", sr: "Доживотни", sw: "Maisha Yote", ta: "வாழ்நாள்", te: "జీవితకాలం",
  uk: "Довічний", ur: "تاحیات"
};

const ROSTER_CLASS_FIXES = {
  am: "ባዮሎጂ 101 · 14:32", ar: "الأحياء 101 · 14:32", bn: "জীববিজ্ঞান 101 · 14:32",
  ca: "Biologia 101 · 14:32", ceb: "Biyolohiya 101 · 14:32", cs: "Biologie 101 · 14:32",
  da: "Biologi 101 · 14:32", de: "Biologie 101 · 14:32", el: "Βιολογία 101 · 14:32",
  es: "Biología 101 · 14:32", fi: "Biologia 101 · 14:32", fr: "Biologie 101 · 14:32",
  gu: "જીવવિજ્ઞાન 101 · 14:32", he: "ביולוגיה 101 · 14:32", hi: "जीवविज्ञान 101 · 14:32",
  hu: "Biológia 101 · 14:32", id: "Biologi 101 · 14:32", it: "Biologia 101 · 14:32",
  ja: "生物学 101 · 14:32", kn: "ಜೀವಶಾಸ್ತ್ರ 101 · 14:32", ko: "생물학 101 · 14:32",
  mr: "जीवशास्त्र 101 · 14:32", ms: "Biologi 101 · 14:32", my: "ဇီဝဗေဒ 101 · 14:32",
  ne: "जीवविज्ञान 101 · 14:32", nl: "Biologie 101 · 14:32", no: "Biologi 101 · 14:32",
  pa: "ਜੀਵ ਵਿਗਿਆਨ 101 · 14:32", pl: "Biologia 101 · 14:32", pt: "Biologia 101 · 14:32",
  ro: "Biologie 101 · 14:32", ru: "Биология 101 · 14:32", si: "ජීව විද්‍යාව 101 · 14:32",
  so: "Bayoolaji 101 · 14:32", sv: "Biologi 101 · 14:32", sw: "Biolojia 101 · 14:32",
  ta: "உயிரியல் 101 · 14:32", te: "జీవశాస్త్రం 101 · 14:32", th: "ชีววิทยา 101 · 14:32",
  tl: "Biyolohiya 101 · 14:32", tr: "Biyoloji 101 · 14:32", uk: "Біологія 101 · 14:32",
  ur: "حیاتیات 101 · 14:32", vi: "Sinh học 101 · 14:32", zh: "生物學 101 · 14:32",
  "zh-CN": "生物学 101 · 14:32"
};

const INTENT_LINK_VS_FIXES = {
  es: "AttendanceTracker.dev vs. Competidor →", fr: "AttendanceTracker.dev vs Concurrent →", de: "AttendanceTracker.dev vs. Mitbewerber →",
  pt: "AttendanceTracker.dev vs. Concorrente →", it: "AttendanceTracker.dev vs Concorrente →", nl: "AttendanceTracker.dev vs. Concurrent →",
  pl: "AttendanceTracker.dev vs konkurencja →", ru: "AttendanceTracker.dev против конкурента →", ja: "AttendanceTracker.dev vs 競合ツール →",
  ko: "AttendanceTracker.dev vs 경쟁사 →", zh: "AttendanceTracker.dev 與競品對比 →", "zh-CN": "AttendanceTracker.dev 与竞品对比 →",
  ar: "AttendanceTracker.dev مقابل المنافس ←", hi: "AttendanceTracker.dev बनाम प्रतिस्पर्धी →", tr: "AttendanceTracker.dev vs. Rakip →",
  vi: "AttendanceTracker.dev so với đối thủ →", th: "AttendanceTracker.dev เทียบกับคู่แข่ง →", id: "AttendanceTracker.dev vs Kompetitor →",
  ms: "AttendanceTracker.dev lwn Pesaing →", tl: "AttendanceTracker.dev laban sa Kakumpitensya →", uk: "AttendanceTracker.dev проти конкурента →",
  cs: "AttendanceTracker.dev vs. konkurence →", ro: "AttendanceTracker.dev vs. Concurent →", el: "AttendanceTracker.dev έναντι ανταγωνιστή →",
  hu: "AttendanceTracker.dev vs. versenytárs →", sv: "AttendanceTracker.dev vs konkurrent →", da: "AttendanceTracker.dev vs. konkurrent →",
  fi: "AttendanceTracker.dev vs. kilpailija →", no: "AttendanceTracker.dev vs. konkurrent →", he: "AttendanceTracker.dev מול מתחרים ←",
  bn: "AttendanceTracker.dev বনাম প্রতিযোগী →", ta: "AttendanceTracker.dev எதிர் போட்டியாளர் →", te: "AttendanceTracker.dev vs పోటీదారు →",
  mr: "AttendanceTracker.dev विरुद्ध स्पर्धक →", ur: "AttendanceTracker.dev بمقابلہ حریف ←", sw: "AttendanceTracker.dev dhidi ya Mshindani →",
  am: "AttendanceTracker.dev ከተፎካካሪ ጋር →", ne: "AttendanceTracker.dev बनाम प्रतिस्पर्धी →", si: "AttendanceTracker.dev එදිරිව තරඟකරු →",
  km: "AttendanceTracker.dev ធៀបនឹងគូប្រជែង →", ca: "AttendanceTracker.dev vs. competidor →", af: "AttendanceTracker.dev vs. Mededinger →",
  so: "AttendanceTracker.dev vs Tartame →", kn: "AttendanceTracker.dev vs ಪ್ರತಿಸ್ಪರ್ಧಿ →", gu: "AttendanceTracker.dev વિરુદ્ધ હરીફ →",
  pa: "AttendanceTracker.dev ਬਨਾਮ ਵਿਰੋਧੀ →", kk: "AttendanceTracker.dev және бәсекелес →", lv: "AttendanceTracker.dev pret konkurentu →",
  lt: "AttendanceTracker.dev prieš konkurentą →", lo: "AttendanceTracker.dev ທຽບກັບຄູ່ແຂ່ງ →", my: "AttendanceTracker.dev နှင့် ပြိုင်ဘက် နှိုင်းယှဉ်ချက် →",
  ceb: "AttendanceTracker.dev batok Kakompetensya →", bg: "AttendanceTracker.dev срещу конкурент →", hr: "AttendanceTracker.dev naspram конкуренције →".replace("конкуренције", "konkurencije"),
  sr: "AttendanceTracker.dev наспрам конкурента →", sk: "AttendanceTracker.dev vs. konkurencia →", sl: "AttendanceTracker.dev proti konkurenci →",
  fa: "AttendanceTracker.dev در برابر رقیب ←", ml: "AttendanceTracker.dev vs എതിരാളി →", mn: "AttendanceTracker.dev ба өрсөлдөгч →"
};

const INTENT_LINK_GUIDE_FIXES = {
  es: "Guía para docentes de K-12 y universidad →", fr: "Guide pour enseignants du primaire au supérieur →", de: "Leitfaden für Lehrkräfte an Schulen & Hochschulen →",
  pt: "Guia para professores do ensino básico e superior →", it: "Guida per docenti scolastici e universitari →", nl: "Gids voor docenten in het basis-, voortgezet en hoger onderwijs →",
  pl: "Przewodnik dla nauczycieli szkolnych i akademickich →", ru: "Руководство для школьных и вузовских преподавателей →", ja: "小中高・大学教員向けガイド →",
  ko: "초중고 및 대학 교원용 가이드 →", zh: "K-12 與大學教師指南 →", "zh-CN": "K-12 与高校教师指南 →",
  ar: "دليل لمعلمي المدارس والجامعات ←", hi: "K-12 और विश्वविद्यालय शिक्षकों के लिए गाइड →", tr: "K-12 ve Üniversite Öğretmenleri İçin Rehber →",
  vi: "Hướng dẫn cho giáo viên phổ thông & đại học →", th: "คู่มือสำหรับครู K-12 และอาจารย์มหาวิทยาลัย →", id: "Panduan untuk Guru Sekolah & Dosen Universitas →",
  ms: "Panduan untuk Guru Sekolah & Pensyarah Universiti →", tl: "Gabay para sa mga Guro sa K-12 at Unibersidad →", uk: "Посібник для вчителів шкіл і викладачів вишів →",
  cs: "Průvodce pro učitele ZŠ, SŠ a VŠ →", ro: "Ghid pentru profesori din învățământul preuniversitar și universitar →", el: "Οδηγός για εκπαιδευτικούς σχολείων & πανεπιστημίων →",
  hu: "Útmutató általános, középiskolai és egyetemi oktatóknak →", sv: "Guide för grundskole-, gymnasie- och universitetslärare →", da: "Guide til grundskole-, gymnasie- og universitetslærere →",
  fi: "Opas koulu- ja yliopisto-opettajille →", no: "Guide for skole- og universitetslærere →", he: "מדריך למורים בבתי ספר ובאוניברסיטאות ←",
  bn: "স্কুল ও বিশ্ববিদ্যালয়ের শিক্ষকদের জন্য নির্দেশিকা →", ta: "பள்ளி மற்றும் பல்கலைக்கழக ஆசிரியர்களுக்கான வழிகாட்டி →", te: "పాఠశాల & విశ్వవిద్యాలయ ఉపాధ్యాయుల కోసం గైడ్ →",
  mr: "शालेय आणि विद्यापीठ शिक्षकांसाठी मार्गदर्शक →", ur: "اسکول اور یونیورسٹی اساتذہ کے لیے گائیڈ ←", sw: "Mwongozo kwa Walimu wa Shule na Vyuo Vikuu →",
  am: "ለK-12 እና ዩኒቨርሲቲ መምህራን መመሪያ →", ne: "विद्यालय र विश्वविद्यालयका शिक्षकहरूको लागि गाइड →", si: "පාසල් සහ විශ්වවිද්‍යාල ගුරුවරුන් සඳහා මාර්ගෝපදේශය →",
  km: "មគ្គុទ្ទេសក៍សម្រាប់គ្រូបង្រៀន K-12 និងសាកលវិទ្យាល័យ →", ca: "Guia per a docents d'escola i universitat →", af: "Gids vir skool- en universiteitsopvoeders →",
  so: "Hagaha Macallimiinta Dugsiyada & Jaamacadaha →", kn: "ಶಾಲಾ ಮತ್ತು ವಿಶ್ವವಿದ್ಯಾಲಯದ ಶಿಕ್ಷಕರಿಗಾಗಿ ಮಾರ್ಗದರ್ಶಿ →", gu: "શાળા અને યુનિવર્સિટીના શિક્ષકો માટે માર્ગદર્શિકા →",
  pa: "ਸਕੂਲ ਅਤੇ ਯੂਨੀਵਰਸਿਟੀ ਅਧਿਆਪਕਾਂ ਲਈ ਗਾਈਡ →", kk: "Мектеп және университет оқытушыларына арналған нұсқаулық →", lv: "Ceļvedis skolu un universitāšu pasniedzējiem →",
  lt: "Vadovas mokyklų ir universitetų dėstytojams →", lo: "ຄູ່ມືສຳລັບຄູສອນໂຮງຮຽນ ແລະ ມະຫາວິທະຍາໄລ →", my: "ကျောင်းနှင့် တက္ကသိုល် ဆရာများအတွက် လမ်းညွှန် →".replace("တက္ကသိုល်", "တက္ကသိုလ်"),
  ceb: "Giya alang sa mga Magtutudlo sa K-12 ug Unibersidad →", bg: "Ръководство за училищни и университетски преподаватели →", hr: "Vodič za školske i sveučilišne nastavnike →",
  sr: "Водич за школске и универзитетске наставнике →", sk: "Sprievodca pre učiteľov ZŠ, SŠ a VŠ →", sl: "Vodnik za šolske in univerzitetne učitelje →",
  fa: "راهنمای معلمان مدارس و اساتید دانشگاه ←", ml: "സ്കൂൾ, യൂണിവേഴ്സിറ്റി അധ്യാപകർക്കുള്ള ഗൈഡ് →", mn: "Сургууль болон их сургуулийн багш нарт зориулсан гарын авлага →"
};

export function getRemainingLp2AndFixes(loc) {
  if (loc === 'en') return {};
  const out = {};

  if (LP2_REMAINING_PART1[loc]) {
    const arr = LP2_REMAINING_PART1[loc];
    DIRECT_KEY_ORDER.forEach((k, idx) => {
      if (arr[idx] !== undefined) out[k] = arr[idx];
    });
  } else if (PACK_LOCALES[loc]) {
    const arr = PACK_LOCALES[loc];
    PACK_KEY_ORDER.forEach((k, idx) => {
      if (arr[idx] !== undefined) out[k] = arr[idx];
    });
  }

  if (INTENT_LINK_VS_FIXES[loc]) out["lp2_intent_link_vs"] = INTENT_LINK_VS_FIXES[loc];
  if (INTENT_LINK_GUIDE_FIXES[loc]) out["lp2_intent_link_guide"] = INTENT_LINK_GUIDE_FIXES[loc];
  if (EXTRA_EXISTING_KEY_FIXES[loc]) {
    Object.assign(out, EXTRA_EXISTING_KEY_FIXES[loc]);
  }
  if (EDU_NAME_FIXES[loc]) out["lp2_plan_edu_name"] = EDU_NAME_FIXES[loc];
  if (LIFE_NAME_FIXES[loc]) out["lp2_plan_life_name"] = LIFE_NAME_FIXES[loc];
  if (ROSTER_CLASS_FIXES[loc]) out["lp2_roster_class"] = ROSTER_CLASS_FIXES[loc];

  return out;
}

