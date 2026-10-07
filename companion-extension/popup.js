(function () {
  'use strict';

  var EXT_STRINGS = {
  "en": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Official Google Meet Add-on",
    "ext.howToTitle": "🚀 How to Open in Google Meet:",
    "ext.step1": "Join or start any Google Meet call.",
    "ext.step2": "Click the Activities icon (shapes) at the bottom right.",
    "ext.step3": "Select Attendance Tracker & press Start.",
    "ext.openMeet": "Open Google Meet",
    "ext.openMarketplace": "Install / View on Marketplace",
    "ext.openHistory": "View Meeting History Dashboard",
    "ext.privacy": "Privacy"
  },
  "es": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Complemento oficial de Google Meet",
    "ext.howToTitle": "🚀 Cómo abrir en Google Meet:",
    "ext.step1": "Únete o inicia cualquier llamada de Google Meet.",
    "ext.step2": "Haz clic en el icono de Actividades (figuras geométricas) en la parte inferior derecha.",
    "ext.step3": "Selecciona Attendance Tracker y presiona Iniciar.",
    "ext.openMeet": "Abrir Google Meet",
    "ext.openMarketplace": "Instalar / Ver en Marketplace",
    "ext.openHistory": "Ver panel de historial de reuniones",
    "ext.privacy": "Privacidad"
  },
  "pt": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Complemento oficial do Google Meet",
    "ext.howToTitle": "🚀 Como abrir no Google Meet:",
    "ext.step1": "Participe ou inicie qualquer chamada do Google Meet.",
    "ext.step2": "Clique no ícone de Atividades (formas) no canto inferior direito.",
    "ext.step3": "Selecione o Attendance Tracker e clique em Iniciar.",
    "ext.openMeet": "Abrir o Google Meet",
    "ext.openMarketplace": "Instalar / Ver no Marketplace",
    "ext.openHistory": "Ver painel de histórico de reuniões",
    "ext.privacy": "Privacidade"
  },
  "hi": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "आधिकारिक Google Meet ऐड-ऑन",
    "ext.howToTitle": "🚀 Google Meet में कैसे खोलें:",
    "ext.step1": "किसी भी Google Meet कॉल में शामिल हों या शुरू करें।",
    "ext.step2": "नीचे दाईं ओर गतिविधियाँ आइकन (आकृतियाँ) पर क्लिक करें।",
    "ext.step3": "Attendance Tracker चुनें और शुरू करें दबाएं।",
    "ext.openMeet": "Google Meet खोलें",
    "ext.openMarketplace": "मार्केटप्लेस पर इंस्टॉल करें / देखें",
    "ext.openHistory": "मीटिंग इतिहास डैशबोर्ड देखें",
    "ext.privacy": "गोपनीयता"
  },
  "ta": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "அதிகாரப்பூர்வ Google Meet துணை நிரல்",
    "ext.howToTitle": "🚀 Google Meet இல் எவ்வாறு திறப்பது:",
    "ext.step1": "எந்தவொரு Google Meet அழைப்பிலும் சேரவும் அல்லது தொடங்கவும்.",
    "ext.step2": "கீழ் வலதுபுறத்தில் உள்ள செயல்பாடுகள் ஐகானை (வடிவங்கள்) கிளிக் செய்யவும்.",
    "ext.step3": "Attendance Tracker-ஐத் தேர்ந்தெடுத்து தொடங்கு என்பதை அழுத்தவும்.",
    "ext.openMeet": "Google Meet-ஐத் திற",
    "ext.openMarketplace": "Marketplace இல் நிறுவவும் / பார்க்கவும்",
    "ext.openHistory": "கூட்ட வரலாற்று டாஷ்போர்டைக் காண்க",
    "ext.privacy": "தனியுரிமை"
  },
  "te": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "అధికారిక Google Meet యాడ్-ఆన్",
    "ext.howToTitle": "🚀 Google Meet లో ఎలా తెరవాలి:",
    "ext.step1": "ఏదైనా Google Meet కాల్‌లో చేరండి లేదా ప్రారంభించండి.",
    "ext.step2": "దిగువ కుడివైపున ఉన్న యాక్టివిటీస్ చిహ్నాన్ని (ఆకారాలు) క్లిక్ చేయండి.",
    "ext.step3": "Attendance Tracker ని ఎంచుకుని, ప్రారంభించు నొక్కండి.",
    "ext.openMeet": "Google Meet తెరవండి",
    "ext.openMarketplace": "మార్కెట్‌ప్లేస్‌లో ఇన్‌స్టాల్ చేయండి / చూడండి",
    "ext.openHistory": "సమావేశ చరిత్ర డాష్‌బోర్డ్‌ను వీక్షించండి",
    "ext.privacy": "గోప్యత"
  },
  "bn": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "অফিশিয়াল Google Meet অ্যাড-অন",
    "ext.howToTitle": "🚀 Google Meet-এ কীভাবে খুলবেন:",
    "ext.step1": "যেকোনো Google Meet কলে যোগ দিন বা শুরু করুন।",
    "ext.step2": "নিচে ডানদিকের অ্যাক্টিভিটিজ আইকনে (আকৃতি) ক্লিক করুন।",
    "ext.step3": "Attendance Tracker নির্বাচন করুন এবং শুরু বাটনে চাপ দিন।",
    "ext.openMeet": "Google Meet খুলুন",
    "ext.openMarketplace": "Marketplace-এ ইনস্টল করুন / দেখুন",
    "ext.openHistory": "মিটিংয়ের ইতিহাস ড্যাশবোর্ড দেখুন",
    "ext.privacy": "গোপনীয়তা"
  },
  "ur": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "باضابطہ Google Meet ایڈ آن",
    "ext.howToTitle": "🚀 Google Meet میں کیسے کھولیں:",
    "ext.step1": "کسی بھی Google Meet کال میں شامل ہوں یا شروع کریں۔",
    "ext.step2": "نیچے دائیں جانب سرگرمیوں کے آئیکن (شکلیں) پر کلک کریں۔",
    "ext.step3": "Attendance Tracker منتخب کریں اور شروع کریں دبائیں۔",
    "ext.openMeet": "Google Meet کھولیں",
    "ext.openMarketplace": "مارکیٹ پلیس پر انسٹال کریں / دیکھیں",
    "ext.openHistory": "میٹنگ کی تاریخ کا ڈیش بورڈ دیکھیں",
    "ext.privacy": "رازداری"
  },
  "tl": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Opisyal na Google Meet Add-on",
    "ext.howToTitle": "🚀 Paano Buksan sa Google Meet:",
    "ext.step1": "Sumali o magsimula ng anumang tawag sa Google Meet.",
    "ext.step2": "I-click ang Activities icon (mga hugis) sa kanang ibaba.",
    "ext.step3": "Piliin ang Attendance Tracker at pindutin ang Simulan.",
    "ext.openMeet": "Buksan ang Google Meet",
    "ext.openMarketplace": "I-install / Tingnan sa Marketplace",
    "ext.openHistory": "Tingnan ang Dashboard ng Kasaysayan ng Meeting",
    "ext.privacy": "Privacy"
  },
  "ms": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Add-on Rasmi Google Meet",
    "ext.howToTitle": "🚀 Cara Membuka dalam Google Meet:",
    "ext.step1": "Sertai atau mulakan sebarang panggilan Google Meet.",
    "ext.step2": "Klik ikon Aktiviti (bentuk) di bahagian bawah sebelah kanan.",
    "ext.step3": "Pilih Attendance Tracker & tekan Mula.",
    "ext.openMeet": "Buka Google Meet",
    "ext.openMarketplace": "Pasang / Lihat di Marketplace",
    "ext.openHistory": "Lihat Papan Pemuka Sejarah Mesyuarat",
    "ext.privacy": "Privasi"
  },
  "id": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Add-on Resmi Google Meet",
    "ext.howToTitle": "🚀 Cara Membuka di Google Meet:",
    "ext.step1": "Bergabung atau mulai panggilan Google Meet apa pun.",
    "ext.step2": "Klik ikon Aktivitas (bentuk) di kanan bawah.",
    "ext.step3": "Pilih Attendance Tracker & tekan Mulai.",
    "ext.openMeet": "Buka Google Meet",
    "ext.openMarketplace": "Pasang / Lihat di Marketplace",
    "ext.openHistory": "Lihat Dasbor Riwayat Rapat",
    "ext.privacy": "Privasi"
  },
  "vi": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Tiện ích bổ sung Google Meet chính thức",
    "ext.howToTitle": "🚀 Cách mở trong Google Meet:",
    "ext.step1": "Tham gia hoặc bắt đầu bất kỳ cuộc gọi Google Meet nào.",
    "ext.step2": "Nhấp vào biểu tượng Hoạt động (hình khối) ở góc dưới cùng bên phải.",
    "ext.step3": "Chọn Attendance Tracker & nhấn Bắt đầu.",
    "ext.openMeet": "Mở Google Meet",
    "ext.openMarketplace": "Cài đặt / Xem trên Marketplace",
    "ext.openHistory": "Xem Trang tổng quan Lịch sử Cuộc họp",
    "ext.privacy": "Quyền riêng tư"
  },
  "fr": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Module complémentaire officiel Google Meet",
    "ext.howToTitle": "🚀 Comment ouvrir dans Google Meet :",
    "ext.step1": "Rejoignez ou lancez un appel Google Meet.",
    "ext.step2": "Cliquez sur l'icône Activités (formes géométriques) en bas à droite.",
    "ext.step3": "Sélectionnez Attendance Tracker et appuyez sur Démarrer.",
    "ext.openMeet": "Ouvrir Google Meet",
    "ext.openMarketplace": "Installer / Voir sur le Marketplace",
    "ext.openHistory": "Voir le tableau de bord de l'historique des réunions",
    "ext.privacy": "Confidentialité"
  },
  "de": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Offizielles Google Meet Add-on",
    "ext.howToTitle": "🚀 So öffnen Sie es in Google Meet:",
    "ext.step1": "Treten Sie einem Google Meet-Anruf bei oder starten Sie einen.",
    "ext.step2": "Klicken Sie unten rechts auf das Aktivitäten-Symbol (Formen).",
    "ext.step3": "Wählen Sie Attendance Tracker aus und klicken Sie auf Start.",
    "ext.openMeet": "Google Meet öffnen",
    "ext.openMarketplace": "Im Marketplace installieren / ansehen",
    "ext.openHistory": "Meeting-Verlaufs-Dashboard anzeigen",
    "ext.privacy": "Datenschutz"
  },
  "it": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Componente aggiuntivo ufficiale di Google Meet",
    "ext.howToTitle": "🚀 Come aprire in Google Meet:",
    "ext.step1": "Partecipa o avvia una chiamata Google Meet.",
    "ext.step2": "Fai clic sull'icona Attività (forme) in basso a destra.",
    "ext.step3": "Seleziona Attendance Tracker e premi Avvia.",
    "ext.openMeet": "Apri Google Meet",
    "ext.openMarketplace": "Installa / Visualizza su Marketplace",
    "ext.openHistory": "Visualizza dashboard cronologia riunioni",
    "ext.privacy": "Privacy"
  },
  "nl": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Officiële Google Meet add-on",
    "ext.howToTitle": "🚀 Hoe te openen in Google Meet:",
    "ext.step1": "Neem deel aan of start een Google Meet-gesprek.",
    "ext.step2": "Klik rechtsonder op het Activiteiten-pictogram (vormen).",
    "ext.step3": "Selecteer Attendance Tracker en druk op Start.",
    "ext.openMeet": "Open Google Meet",
    "ext.openMarketplace": "Installeren / bekijken op Marketplace",
    "ext.openHistory": "Vergadergeschiedenis dashboard bekijken",
    "ext.privacy": "Privacy"
  },
  "pl": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Oficjalny dodatek do Google Meet",
    "ext.howToTitle": "🚀 Jak otworzyć w Google Meet:",
    "ext.step1": "Dołącz do spotkania Google Meet lub je rozpocznij.",
    "ext.step2": "Kliknij ikonę Działania (kształty) w prawym dolnym rogu.",
    "ext.step3": "Wybierz Attendance Tracker i naciśnij Start.",
    "ext.openMeet": "Otwórz Google Meet",
    "ext.openMarketplace": "Zainstaluj / Zobacz w Marketplace",
    "ext.openHistory": "Wyświetl historię spotkań",
    "ext.privacy": "Prywatność"
  },
  "ro": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Supliment oficial Google Meet",
    "ext.howToTitle": "🚀 Cum se deschide în Google Meet:",
    "ext.step1": "Alăturați-vă sau începeți orice apel Google Meet.",
    "ext.step2": "Faceți clic pe pictograma Activități (forme) din dreapta jos.",
    "ext.step3": "Selectați Attendance Tracker și apăsați Start.",
    "ext.openMeet": "Deschide Google Meet",
    "ext.openMarketplace": "Instalează / Vezi pe Marketplace",
    "ext.openHistory": "Vezi panoul cu istoricul întâlnirilor",
    "ext.privacy": "Confidențialitate"
  },
  "ru": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Официальное дополнение для Google Meet",
    "ext.howToTitle": "🚀 Как открыть в Google Meet:",
    "ext.step1": "Присоединитесь к звонку Google Meet или начните его.",
    "ext.step2": "Нажмите на значок «Действия» (геометрические фигуры) в правом нижнем углу.",
    "ext.step3": "Выберите Attendance Tracker и нажмите «Начать».",
    "ext.openMeet": "Открыть Google Meet",
    "ext.openMarketplace": "Установить / Открыть в Marketplace",
    "ext.openHistory": "Панель истории встреч",
    "ext.privacy": "Конфиденциальность"
  },
  "uk": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Офіційне доповнення для Google Meet",
    "ext.howToTitle": "🚀 Як відкрити в Google Meet:",
    "ext.step1": "Приєднайтеся до дзвінка Google Meet або почніть його.",
    "ext.step2": "Натисніть піктограму «Дії» (фігури) у правому нижньому куті.",
    "ext.step3": "Виберіть Attendance Tracker і натисніть «Почати».",
    "ext.openMeet": "Відкрити Google Meet",
    "ext.openMarketplace": "Установити / Переглянути в Marketplace",
    "ext.openHistory": "Переглянути панель історії зустрічей",
    "ext.privacy": "Конфіденційність"
  },
  "tr": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Resmi Google Meet Eklentisi",
    "ext.howToTitle": "🚀 Google Meet'te Nasıl Açılır:",
    "ext.step1": "Herhangi bir Google Meet aramasına katılın veya başlatın.",
    "ext.step2": "Sağ alttaki Etkinlikler simgesine (şekiller) tıklayın.",
    "ext.step3": "Attendance Tracker'ı seçin ve Başlat'a basın.",
    "ext.openMeet": "Google Meet'i Aç",
    "ext.openMarketplace": "Marketplace'te Yükle / Görüntüle",
    "ext.openHistory": "Toplantı Geçmişi Panelini Görüntüle",
    "ext.privacy": "Gizlilik"
  },
  "th": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "ส่วนเสริม Google Meet อย่างเป็นทางการ",
    "ext.howToTitle": "🚀 วิธีเปิดใน Google Meet:",
    "ext.step1": "เข้าร่วมหรือเริ่มการโทร Google Meet ใดก็ได้",
    "ext.step2": "คลิกไอคอนกิจกรรม (รูปทรง) ที่ด้านล่างขวา",
    "ext.step3": "เลือก Attendance Tracker แล้วกด เริ่ม",
    "ext.openMeet": "เปิด Google Meet",
    "ext.openMarketplace": "ติดตั้ง / ดูบน Marketplace",
    "ext.openHistory": "ดูแดชบอร์ดประวัติการประชุม",
    "ext.privacy": "ความเป็นส่วนตัว"
  },
  "ar": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "إضافة Google Meet الرسمية",
    "ext.howToTitle": "🚀 كيفية الفتح في Google Meet:",
    "ext.step1": "انضم إلى أي مكالمة Google Meet أو ابدأها.",
    "ext.step2": "انقر على رمز الأنشطة (الأشكال) في أسفل اليمين.",
    "ext.step3": "حدد Attendance Tracker واضغط على بدء.",
    "ext.openMeet": "فتح Google Meet",
    "ext.openMarketplace": "تثبيت / عرض في Marketplace",
    "ext.openHistory": "عرض لوحة سجل الاجتماعات",
    "ext.privacy": "الخصوصية"
  },
  "ko": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "공식 Google Meet 부가기능",
    "ext.howToTitle": "🚀 Google Meet에서 여는 방법:",
    "ext.step1": "Google Meet 통화에 참여하거나 시작합니다.",
    "ext.step2": "오른쪽 하단의 활동 아이콘(도형)을 클릭합니다.",
    "ext.step3": "Attendance Tracker를 선택하고 시작을 누릅니다.",
    "ext.openMeet": "Google Meet 열기",
    "ext.openMarketplace": "Marketplace에서 설치 / 보기",
    "ext.openHistory": "회의 기록 대시보드 보기",
    "ext.privacy": "개인정보처리방침"
  },
  "zh": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Google Meet 官方外掛程式",
    "ext.howToTitle": "🚀 如何在 Google Meet 中開啟：",
    "ext.step1": "加入或發起任何 Google Meet 通話。",
    "ext.step2": "點擊右下角的「活動」圖示（幾何形狀）。",
    "ext.step3": "選擇 Attendance Tracker 並點擊「開始」。",
    "ext.openMeet": "開啟 Google Meet",
    "ext.openMarketplace": "在 Marketplace 上安裝 / 查看",
    "ext.openHistory": "查看會議歷史記錄資訊主頁",
    "ext.privacy": "隱私權政策"
  },
  "zh-CN": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Google Meet 官方插件",
    "ext.howToTitle": "🚀 如何在 Google Meet 中打开：",
    "ext.step1": "加入或发起任何 Google Meet 通话。",
    "ext.step2": "点击右下角的“活动”图标（几何形状）。",
    "ext.step3": "选择 Attendance Tracker 并点击“开始”。",
    "ext.openMeet": "打开 Google Meet",
    "ext.openMarketplace": "在 Marketplace 上安装 / 查看",
    "ext.openHistory": "查看会议历史记录仪表板",
    "ext.privacy": "隐私政策"
  },
  "ja": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Google Meet 公式アドオン",
    "ext.howToTitle": "🚀 Google Meetでの開き方：",
    "ext.step1": "Google Meet の通話に参加または開始します。",
    "ext.step2": "右下の「アクティビティ」アイコン（図形）をクリックします。",
    "ext.step3": "「Attendance Tracker」を選択して「開始」を押します。",
    "ext.openMeet": "Google Meet を開く",
    "ext.openMarketplace": "Marketplaceでインストール / 表示",
    "ext.openHistory": "ミーティング履歴ダッシュボードを表示",
    "ext.privacy": "プライバシー"
  },
  "he": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "תוסף רשמי של Google Meet",
    "ext.howToTitle": "🚀 איך לפתוח ב-Google Meet:",
    "ext.step1": "הצטרף או התחל שיחת Google Meet.",
    "ext.step2": "לחץ על סמל הפעילויות (צורות) בצד ימין למטה.",
    "ext.step3": "בחר ב-Attendance Tracker ולחץ על התחל.",
    "ext.openMeet": "פתח את Google Meet",
    "ext.openMarketplace": "התקן / צפה ב-Marketplace",
    "ext.openHistory": "צפה בלוח הבקרה של היסטוריית הפגישות",
    "ext.privacy": "פרטיות"
  },
  "mr": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "अधिकृत Google Meet ॲड-ऑन",
    "ext.howToTitle": "🚀 Google Meet मध्ये कसे उघडावे:",
    "ext.step1": "कोणत्याही Google Meet कॉलमध्ये सामील व्हा किंवा सुरू करा.",
    "ext.step2": "खाली उजवीकडे अ‍ॅक्टिव्हिटीज चिन्हावर (आकार) क्लिक करा.",
    "ext.step3": "Attendance Tracker निवडा आणि सुरू करा दाबा.",
    "ext.openMeet": "Google Meet उघडा",
    "ext.openMarketplace": "Marketplace वर स्थापित करा / पहा",
    "ext.openHistory": "मीटिंग इतिहास डॅशबोर्ड पहा",
    "ext.privacy": "गोपनीयता"
  },
  "sv": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Officiellt Google Meet-tillägg",
    "ext.howToTitle": "🚀 Så öppnar du i Google Meet:",
    "ext.step1": "Gå med i eller starta ett Google Meet-samtal.",
    "ext.step2": "Klicka på ikonen Aktiviteter (former) längst ner till höger.",
    "ext.step3": "Välj Attendance Tracker och tryck på Start.",
    "ext.openMeet": "Öppna Google Meet",
    "ext.openMarketplace": "Installera / Visa på Marketplace",
    "ext.openHistory": "Visa instrumentpanel för möteshistorik",
    "ext.privacy": "Integritet"
  },
  "cs": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Oficiální doplněk pro Google Meet",
    "ext.howToTitle": "🚀 Jak otevřít v Google Meet:",
    "ext.step1": "Připojte se k libovolnému hovoru Google Meet nebo jej zahajte.",
    "ext.step2": "Klikněte na ikonu Aktivity (tvary) vpravo dole.",
    "ext.step3": "Vyberte Attendance Tracker a stiskněte Start.",
    "ext.openMeet": "Otevřít Google Meet",
    "ext.openMarketplace": "Nainstalovat / Zobrazit v Marketplace",
    "ext.openHistory": "Zobrazit přehled historie schůzek",
    "ext.privacy": "Soukromí"
  },
  "da": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Officielt Google Meet-tilføjelse",
    "ext.howToTitle": "🚀 Sådan åbner du i Google Meet:",
    "ext.step1": "Deltag i eller start et Google Meet-opkald.",
    "ext.step2": "Klik på ikonet Aktiviteter (former) nederst til højre.",
    "ext.step3": "Vælg Attendance Tracker og tryk på Start.",
    "ext.openMeet": "Åbn Google Meet",
    "ext.openMarketplace": "Installer / Se på Marketplace",
    "ext.openHistory": "Se dashboard for mødehistorik",
    "ext.privacy": "Privatliv"
  },
  "fi": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Virallinen Google Meet -lisäosa",
    "ext.howToTitle": "🚀 Kuinka avata Google Meetissä:",
    "ext.step1": "Liity mihin tahansa Google Meet -puheluun tai aloita se.",
    "ext.step2": "Napsauta Toiminnot-kuvaketta (muodot) oikeassa alakulmassa.",
    "ext.step3": "Valitse Attendance Tracker ja paina Aloita.",
    "ext.openMeet": "Avaa Google Meet",
    "ext.openMarketplace": "Asenna / Näytä Marketplacessa",
    "ext.openHistory": "Näytä kokoushistorian hallintapaneeli",
    "ext.privacy": "Tietosuoja"
  },
  "hu": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Hivatalos Google Meet bővítmény",
    "ext.howToTitle": "🚀 Hogyan nyitható meg a Google Meetben:",
    "ext.step1": "Csatlakozzon bármelyik Google Meet-híváshoz, vagy indítson egyet.",
    "ext.step2": "Kattintson a Tevékenységek ikonra (alakzatok) a jobb alsó sarokban.",
    "ext.step3": "Válassza ki az Attendance Tracker elemet, és nyomja meg a Start gombot.",
    "ext.openMeet": "Google Meet megnyitása",
    "ext.openMarketplace": "Telepítés / Megtekintés a Marketplace-en",
    "ext.openHistory": "Megbeszélési előzmények irányítópult megtekintése",
    "ext.privacy": "Adatvédelem"
  },
  "so": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Ku-darka Rasmiga ah ee Google Meet",
    "ext.howToTitle": "🚀 Sida loogu furo Google Meet:",
    "ext.step1": "Ku biir ama bilow wicitaan kasta oo Google Meet ah.",
    "ext.step2": "Guji summadda Hawlaha (qaababka) ee hoose midig.",
    "ext.step3": "Dooro Attendance Tracker oo taabo Bilow.",
    "ext.openMeet": "Fur Google Meet",
    "ext.openMarketplace": "Ku rakib / Ka eeg Marketplace",
    "ext.openHistory": "Eeg Dashboard-ka Taariikhda Kulanka",
    "ext.privacy": "Qarsoodiga"
  },
  "sw": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Kijalizo Rasmi cha Google Meet",
    "ext.howToTitle": "🚀 Jinsi ya Kufungua katika Google Meet:",
    "ext.step1": "Jiunge au uanzishe simu yoyote ya Google Meet.",
    "ext.step2": "Bofya aikoni ya Shughuli (maumbo) chini kulia.",
    "ext.step3": "Chagua Attendance Tracker kisha ubonyeze Anza.",
    "ext.openMeet": "Fungua Google Meet",
    "ext.openMarketplace": "Sakinisha / Tazama kwenye Marketplace",
    "ext.openHistory": "Tazama Dashibodi ya Historia ya Mkutano",
    "ext.privacy": "Faragha"
  },
  "am": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "ይፋዊ የGoogle Meet ተጨማሪ",
    "ext.howToTitle": "🚀 በGoogle Meet ውስጥ እንዴት እንደሚከፈት፡",
    "ext.step1": "ማንኛውንም የGoogle Meet ጥሪ ይቀላቀሉ ወይም ይጀምሩ።",
    "ext.step2": "ከታች በቀኝ በኩል ያለውን የተግባራት አዶ (ቅርጾች) ጠቅ ያድርጉ።",
    "ext.step3": "Attendance Tracker ን ይምረጡ እና ጀምር የሚለውን ይጫኑ።",
    "ext.openMeet": "Google Meet ን ክፈት",
    "ext.openMarketplace": "በMarketplace ላይ ጫን / እይ",
    "ext.openHistory": "የስብሰባ ታሪክ ዳሽቦርድን ይመልከቱ",
    "ext.privacy": "ግላዊነት"
  },
  "si": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "නිල Google Meet ඇඩෝනය",
    "ext.howToTitle": "🚀 Google Meet හි විවෘත කරන්නේ කෙසේද:",
    "ext.step1": "ඕනෑම Google Meet ඇමතුමකට සම්බන්ධ වන්න හෝ ආරම්භ කරන්න.",
    "ext.step2": "පහළ දකුණේ ඇති ක්‍රියාකාරකම් නිරූපකය (හැඩතල) ක්ලික් කරන්න.",
    "ext.step3": "Attendance Tracker තෝරා ආරම්භ කරන්න ඔබන්න.",
    "ext.openMeet": "Google Meet විවෘත කරන්න",
    "ext.openMarketplace": "Marketplace හි ස්ථාපනය කරන්න / බලන්න",
    "ext.openHistory": "රැස්වීම් ඉතිහාස උපකරණ පුවරුව බලන්න",
    "ext.privacy": "පෞද්ගලිකත්වය"
  },
  "el": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Επίσημο πρόσθετο Google Meet",
    "ext.howToTitle": "🚀 Πώς να το ανοίξετε στο Google Meet:",
    "ext.step1": "Συμμετάσχετε ή ξεκινήστε οποιαδήποτε κλήση Google Meet.",
    "ext.step2": "Κάντε κλικ στο εικονίδιο Δραστηριότητες (σχήματα) κάτω δεξιά.",
    "ext.step3": "Επιλέξτε Attendance Tracker και πατήστε Έναρξη.",
    "ext.openMeet": "Άνοιγμα του Google Meet",
    "ext.openMarketplace": "Εγκατάσταση / Προβολή στο Marketplace",
    "ext.openHistory": "Προβολή πίνακα ιστορικού συναντήσεων",
    "ext.privacy": "Απόρρητο"
  },
  "no": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Offisielt Google Meet-tillegg",
    "ext.howToTitle": "🚀 Slik åpner du i Google Meet:",
    "ext.step1": "Bli med i eller start en Google Meet-samtale.",
    "ext.step2": "Klikk på Aktiviteter-ikonet (former) nederst til høyre.",
    "ext.step3": "Velg Attendance Tracker og trykk Start.",
    "ext.openMeet": "Åpne Google Meet",
    "ext.openMarketplace": "Installer / Vis på Marketplace",
    "ext.openHistory": "Se oversikt over møtehistorikk",
    "ext.privacy": "Personvern"
  },
  "ca": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Complement oficial de Google Meet",
    "ext.howToTitle": "🚀 Com obrir a Google Meet:",
    "ext.step1": "Uneix-te o inicia qualsevol trucada de Google Meet.",
    "ext.step2": "Fes clic a la icona d'Activitats (figures geomètriques) a la part inferior dreta.",
    "ext.step3": "Selecciona Attendance Tracker i prem Inicia.",
    "ext.openMeet": "Obrir Google Meet",
    "ext.openMarketplace": "Instal·lar / Veure al Marketplace",
    "ext.openHistory": "Veure tauler d'historial de reunions",
    "ext.privacy": "Privacidea"
  },
  "ne": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "आधिकारिक Google Meet एड-अन",
    "ext.howToTitle": "🚀 Google Meet मा कसरी खोल्ने:",
    "ext.step1": "कुनै पनि Google Meet कलमा सामेल हुनुहोस् वा सुरु गर्नुहोस्।",
    "ext.step2": "तल दायाँमा रहेको गतिविधि आइकन (आकारहरू) मा क्लिक गर्नुहोस्।",
    "ext.step3": "Attendance Tracker चयन गर्नुहोस् र सुरु गर्नुहोस् थिच्नुहोस्।",
    "ext.openMeet": "Google Meet खोल्नुहोस्",
    "ext.openMarketplace": "Marketplace मा स्थापना / अवलोकन गर्नुहोस्",
    "ext.openHistory": "बैठक इतिहास ड्यासबोर्ड हेर्नुहोस्",
    "ext.privacy": "गोपनीयता"
  },
  "ml": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "ഔദ്യോഗിക Google Meet ആഡ്-ഓൺ",
    "ext.howToTitle": "🚀 Google Meet-ൽ എങ്ങനെ തുറക്കാം:",
    "ext.step1": "ഏതെങ്കിലും Google Meet കോളിൽ ചേരുക അല്ലെങ്കിൽ ആരംഭിക്കുക.",
    "ext.step2": "താഴെ വലതുവശത്തുള്ള ആക്റ്റിവിറ്റീസ് ഐക്കണിൽ (രൂപങ്ങൾ) ക്ലിക്ക് ചെയ്യുക.",
    "ext.step3": "Attendance Tracker തിരഞ്ഞെടുത്ത് ആരംഭിക്കുക അമർത്തുക.",
    "ext.openMeet": "Google Meet തുറക്കുക",
    "ext.openMarketplace": "Marketplace-ൽ ഇൻസ്റ്റാൾ ചെയ്യുക / കാണുക",
    "ext.openHistory": "മീറ്റിംഗ് ഹിസ്റ്ററി ഡാഷ്‌ബോർഡ് കാണുക",
    "ext.privacy": "സ്വകാര്യത"
  },
  "mn": {
    "ext.title": "Attendance Tracker",
    "ext.subtitle": "Албан ёсны Google Meet нэмэлт",
    "ext.howToTitle": "🚀 Google Meet дээр хэрхэн нээх вэ:",
    "ext.step1": "Google Meet дуудлагад нэгдэх эсвэл шинээр эхлүүлэх.",
    "ext.step2": "Баруун доод буланд байрлах Үйл ажиллагаа (дүрсүүд) дээр дарна уу.",
    "ext.step3": "Attendance Tracker-ийг сонгоод Эхлүүлэх товчийг дарна уу.",
    "ext.openMeet": "Google Meet нээх",
    "ext.openMarketplace": "Marketplace дээр үзэх / суулгах",
    "ext.openHistory": "Уулзалтын түүхийн самбарыг үзэх",
    "ext.privacy": "Нууцлал"
  },
  "kn": {
      "ext.title": "Attendance Tracker",
      "ext.subtitle": "ಅಧಿಕೃತ Google Meet ಆಡ್-ಆನ್",
      "ext.howToTitle": "🚀 Google Meet ನಲ್ಲಿ ಹೇಗೆ ತೆರೆಯುವುದು:",
      "ext.step1": "ಯಾವುದೇ Google Meet ಕರೆಗೆ ಸೇರಿ ಅಥವಾ ಪ್ರಾರಂಭಿಸಿ.",
      "ext.step2": "ಕೆಳಗಿನ ಬಲಭಾಗದಲ್ಲಿರುವ ಚಟುವಟಿಕೆಗಳ ಐಕಾನ್ (ಆಕಾರಗಳು) ಮೇಲೆ ಕ್ಲಿಕ್ ಮಾಡಿ.",
      "ext.step3": "Attendance Tracker ಆಯ್ಕೆಮಾಡಿ ಮತ್ತು ಪ್ರಾರಂಭಿಸಿ (Start) ಒತ್ತಿ.",
      "ext.openMeet": "Google Meet ತೆರೆಯಿರಿ",
      "ext.openMarketplace": "Marketplace ನಲ್ಲಿ ಇನ್‌ಸ್ಟಾಲ್ ಮಾಡಿ / ವೀಕ್ಷಿಸಿ",
      "ext.openHistory": "ಸಭೆಯ ಇತಿಹಾಸದ ಡ್ಯಾಶ್‌ಬೋರ್ಡ್ ವೀಕ್ಷಿಸಿ",
      "ext.privacy": "ಗೌಪ್ಯತೆ"
  },
  "gu": {
      "ext.title": "Attendance Tracker",
      "ext.subtitle": "સત્તાવાર Google Meet ઍડ-ઑન",
      "ext.howToTitle": "🚀 Google Meet માં કેવી રીતે ખોલવું:",
      "ext.step1": "કોઈપણ Google Meet કૉલમાં જોડાઓ અથવા શરૂ કરો.",
      "ext.step2": "નીચે જમણી બાજુએ પ્રવૃત્તિઓ આઇકન (આકારો) પર ક્લિક કરો.",
      "ext.step3": "Attendance Tracker પસંદ કરો અને Start દબાવો.",
      "ext.openMeet": "Google Meet ખોલો",
      "ext.openMarketplace": "Marketplace પર ઇન્સ્ટોલ કરો / જુઓ",
      "ext.openHistory": "મીટિંગ હિસ્ટ્રી ડેશબોર્ડ જુઓ",
      "ext.privacy": "ગોપનીયતા"
  },
  "pa": {
      "ext.title": "Attendance Tracker",
      "ext.subtitle": "ਅਧਿਕਾਰਤ Google Meet ਐਡ-ਆਨ",
      "ext.howToTitle": "🚀 Google Meet ਵਿੱਚ ਕਿਵੇਂ ਖੋਲ੍ਹਣਾ ਹੈ:",
      "ext.step1": "ਕੋਈ ਵੀ Google Meet ਕਾਲ ਵਿੱਚ ਸ਼ਾਮਲ ਹੋਵੋ ਜਾਂ ਸ਼ੁਰੂ ਕਰੋ।",
      "ext.step2": "ਹੇਠਾਂ ਸੱਜੇ ਪਾਸੇ ਗਤੀਵਿਧੀਆਂ (ਆਕਾਰ) ਆਈਕਨ 'ਤੇ ਕਲਿੱਕ ਕਰੋ।",
      "ext.step3": "Attendance Tracker ਚੁਣੋ ਅਤੇ Start ਦਬਾਓ।",
      "ext.openMeet": "Google Meet ਖੋਲ੍ਹੋ",
      "ext.openMarketplace": "ਮਾਰਕੀਟਪਲੇਸ 'ਤੇ ਇੰਸਟਾਲ ਕਰੋ / ਵੇਖੋ",
      "ext.openHistory": "ਮੀਟਿੰਗ ਇਤਿਹਾਸ ਡੈਸ਼ਬੋਰਡ ਵੇਖੋ",
      "ext.privacy": "ਗੋਪਨੀਯਤਾ"
  },
  "kk": {
      "ext.title": "Attendance Tracker",
      "ext.subtitle": "Ресми Google Meet қосымшасы",
      "ext.howToTitle": "🚀 Google Meet-те қалай ашуға болады:",
      "ext.step1": "Кез келген Google Meet қоңырауына қосылыңыз немесе бастаңыз.",
      "ext.step2": "Төменгі оң жақтағы «Әрекеттер» (пішіндер) белгішесін басыңыз.",
      "ext.step3": "Attendance Tracker таңдап, «Бастау» түймесін басыңыз.",
      "ext.openMeet": "Google Meet-ті ашу",
      "ext.openMarketplace": "Marketplace-тен орнату / көру",
      "ext.openHistory": "Кездесулер тарихы панелін көру",
      "ext.privacy": "Құпиялылық"
  },
  "lv": {
      "ext.title": "Attendance Tracker",
      "ext.subtitle": "Oficiālais Google Meet papildinājums",
      "ext.howToTitle": "🚀 Kā atvērt programmā Google Meet:",
      "ext.step1": "Pievienojieties vai sāciet jebkuru Google Meet zvanu.",
      "ext.step2": "Apakšējā labajā stūrī noklikšķiniet uz ikonas Aktivitātes (ģeometriskās figūras).",
      "ext.step3": "Izvēlieties Attendance Tracker un nospiediet Sākt.",
      "ext.openMeet": "Atvērt Google Meet",
      "ext.openMarketplace": "Instalēt / skatīt vietnē Marketplace",
      "ext.openHistory": "Skatīt sapulču vēstures informācijas paneli",
      "ext.privacy": "Privātums"
  },
  "lt": {
      "ext.title": "Attendance Tracker",
      "ext.subtitle": "Oficialus „Google Meet“ priedas",
      "ext.howToTitle": "🚀 Kaip atidaryti „Google Meet“:",
      "ext.step1": "Prisijunkite prie bet kurio „Google Meet“ skambučio arba pradėkite jį.",
      "ext.step2": "Spustelėkite piktogramą „Veiklos“ (geometrinės figūros) apačioje dešinėje.",
      "ext.step3": "Pasirinkite „Attendance Tracker“ ir paspauskite „Start“.",
      "ext.openMeet": "Atidaryti „Google Meet“",
      "ext.openMarketplace": "Įdiegti / peržiūrėti „Marketplace“",
      "ext.openHistory": "Atidaryti susitikimų istorijos suvestinę",
      "ext.privacy": "Privatumas"
  },
  "lo": {
      "ext.title": "Attendance Tracker",
      "ext.subtitle": "ສ່ວນເສີມທາງການຂອງ Google Meet",
      "ext.howToTitle": "🚀 ວິທີເປີດໃນ Google Meet:",
      "ext.step1": "ເຂົ້າຮ່ວມ ຫຼື ເລີ່ມການໂທ Google Meet ໃດກໍໄດ້.",
      "ext.step2": "ຄລິກໄອຄອນກິດຈະກຳ (ຮູບຮ່າງຕ່າງໆ) ຢູ່ມຸມຂວາລຸ່ມ.",
      "ext.step3": "ເລືອກ Attendance Tracker & ກົດ ເລີ່ມ.",
      "ext.openMeet": "ເປີດ Google Meet",
      "ext.openMarketplace": "ຕິດຕັ້ງ / ເບິ່ງໃນ Marketplace",
      "ext.openHistory": "ເບິ່ງແດຊບອດປະຫວັດການປະຊຸມ",
      "ext.privacy": "ຄວາມເປັນສ່ວນຕົວ"
  },
  "my": {
      "ext.title": "Attendance Tracker",
      "ext.subtitle": "တရားဝင် Google Meet Add-on",
      "ext.howToTitle": "🚀 Google Meet တွင် ဖွင့်နည်း-",
      "ext.step1": "Google Meet အစည်းအဝေးသို့ ဝင်ရောက်ပါ သို့မဟုတ် စတင်ပါ။",
      "ext.step2": "ညာဘက်အောက်ခြေရှိ Activities အိုင်ကွန် (ပုံသဏ္ဌာန်များ) ကို နှိပ်ပါ။",
      "ext.step3": "Attendance Tracker ကို ရွေးချယ်ပြီး Start ကို နှိပ်ပါ။",
      "ext.openMeet": "Google Meet ကို ဖွင့်ရန်",
      "ext.openMarketplace": "Marketplace တွင် ထည့်သွင်းရန် / ကြည့်ရှုရန်",
      "ext.openHistory": "အစည်းအဝေးမှတ်တမ်း ဒက်ရှ်ဘုတ်ကို ကြည့်ရန်",
      "ext.privacy": "ကိုယ်ရေးကိုယ်တာလုံခြုံမှု"
  },
  "km": {
      "ext.title": "Attendance Tracker",
      "ext.subtitle": "កម្មវិធីបន្ថែមផ្លូវការសម្រាប់ Google Meet",
      "ext.howToTitle": "🚀 របៀបបើកដំណើរការក្នុង Google Meet៖",
      "ext.step1": "ចូលរួម ឬចាប់ផ្តើមការហៅទូរសព្ទ Google Meet ណាមួយ។",
      "ext.step2": "ចុចលើរូបតំណាង សកម្មភាព (រូបរាងធរណីមាត្រ) នៅជ្រុងខាងក្រោមស្តាំ។",
      "ext.step3": "ជ្រើសរើស Attendance Tracker ហើយចុច ចាប់ផ្តើម។",
      "ext.openMeet": "បើក Google Meet",
      "ext.openMarketplace": "ដំឡើង / មើលនៅលើ Marketplace",
      "ext.openHistory": "មើលផ្ទាំងគ្រប់គ្រងប្រវត្តិនៃការប្រជុំ",
      "ext.privacy": "ភាពឯកជន"
  },
  "ceb": {
      "ext.title": "Attendance Tracker",
      "ext.subtitle": "Opisyal nga Google Meet Add-on",
      "ext.howToTitle": "🚀 Unsaon Pag-abli sa Google Meet:",
      "ext.step1": "Apil o pagsugod og bisan unsang tawag sa Google Meet.",
      "ext.step2": "I-klik ang icon sa Activities (mga porma) sa ubos sa tuo.",
      "ext.step3": "Pilia ang Attendance Tracker ug pindota ang Start.",
      "ext.openMeet": "Ablihi ang Google Meet",
      "ext.openMarketplace": "I-install / Tan-awa sa Marketplace",
      "ext.openHistory": "Tan-awa ang Dashboard sa Kasaysayan sa Miting",
      "ext.privacy": "Pribasiya"
  },
  "bg": {
      "ext.title": "Attendance Tracker",
      "ext.subtitle": "Официална добавка за Google Meet",
      "ext.howToTitle": "🚀 Как да отворите в Google Meet:",
      "ext.step1": "Присъединете се към или стартирайте среща в Google Meet.",
      "ext.step2": "Кликнете върху иконата „Дейности“ (фигури) долу вдясно.",
      "ext.step3": "Изберете Attendance Tracker и натиснете „Старт“.",
      "ext.openMeet": "Отваряне на Google Meet",
      "ext.openMarketplace": "Инсталиране / Преглед в Marketplace",
      "ext.openHistory": "Преглед на таблото с история на срещите",
      "ext.privacy": "Поверителност"
  },
  "hr": {
      "ext.title": "Attendance Tracker",
      "ext.subtitle": "Službeni dodatak za Google Meet",
      "ext.howToTitle": "🚀 Kako otvoriti u Google Meetu:",
      "ext.step1": "Pridružite se ili pokrenite bilo koji Google Meet poziv.",
      "ext.step2": "Kliknite ikonu Aktivnosti (oblici) u donjem desnom kutu.",
      "ext.step3": "Odaberite Attendance Tracker i pritisnite Pokreni.",
      "ext.openMeet": "Otvori Google Meet",
      "ext.openMarketplace": "Instaliraj / Pogledaj na Marketplaceu",
      "ext.openHistory": "Otvori nadzornu ploču povijesti sastanaka",
      "ext.privacy": "Privatnost"
  },
  "sr": {
      "ext.title": "Attendance Tracker",
      "ext.subtitle": "Званични додатак за Google Meet",
      "ext.howToTitle": "🚀 Како отворити у Google Meet-у:",
      "ext.step1": "Придружите се или покрените било који Google Meet позив.",
      "ext.step2": "Кликните на икону за активности (геометријски облици) доле десно.",
      "ext.step3": "Изаберите Attendance Tracker и притисните Покрени.",
      "ext.openMeet": "Отвори Google Meet",
      "ext.openMarketplace": "Инсталирај / Погледај на Marketplace-у",
      "ext.openHistory": "Погледај контролну таблу историје састанака",
      "ext.privacy": "Приватност"
  },
  "sk": {
      "ext.title": "Attendance Tracker",
      "ext.subtitle": "Oficiálny doplnok pre Google Meet",
      "ext.howToTitle": "🚀 Ako otvoriť v Google Meet:",
      "ext.step1": "Pripojte sa k hovoru Google Meet alebo ho spustite.",
      "ext.step2": "Kliknite na ikonu Aktivity (tvary) vpravo dole.",
      "ext.step3": "Vyberte Attendance Tracker a stlačte Štart.",
      "ext.openMeet": "Otvoriť Google Meet",
      "ext.openMarketplace": "Inštalovať / Zobraziť na Marketplace",
      "ext.openHistory": "Zobraziť prehľad histórie stretnutí",
      "ext.privacy": "Súkromie"
  },
  "sl": {
      "ext.title": "Attendance Tracker",
      "ext.subtitle": "Uradni dodatek za Google Meet",
      "ext.howToTitle": "🚀 Kako odpreti v Google Meet:",
      "ext.step1": "Pridružite se ali začnite kateri koli klic v storitvi Google Meet.",
      "ext.step2": "Kliknite ikono Dejavnosti (oblike) spodaj desno.",
      "ext.step3": "Izberite Attendance Tracker in pritisnite Začni.",
      "ext.openMeet": "Odpri Google Meet",
      "ext.openMarketplace": "Namesti / Ogled v trgovini Marketplace",
      "ext.openHistory": "Ogled nadzorne plošče z zgodovino sestankov",
      "ext.privacy": "Zasebnost"
  },
  "af": {
      "ext.title": "Attendance Tracker",
      "ext.subtitle": "Amptelike Google Meet-byvoeging",
      "ext.howToTitle": "🚀 Hoe om oop te maak in Google Meet:",
      "ext.step1": "Sluit aan by of begin enige Google Meet-oproep.",
      "ext.step2": "Klik op die Aktiwiteite-ikoon (vorms) regs onder.",
      "ext.step3": "Kies Attendance Tracker en klik Begin.",
      "ext.openMeet": "Maak Google Meet oop",
      "ext.openMarketplace": "Installeer / Bekyk op Marketplace",
      "ext.openHistory": "Bekyk vergaderinggeskiedenis-kontroleskerm",
      "ext.privacy": "Privaatheid"
  }
};

  // Localize popup UI from chrome.i18n, bundled translations, or navigator
  function localizePopup() {
    var raw = (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getUILanguage ? chrome.i18n.getUILanguage() : (navigator.language || 'en')).toLowerCase();
    var lang = raw.split(/[-_]/)[0];
    if (raw.startsWith('zh-cn') || raw.startsWith('zh-sg') || raw === 'zh-hans') lang = 'zh-CN';
    else if (raw.startsWith('zh')) lang = 'zh';

    var dict = EXT_STRINGS[raw] || EXT_STRINGS[lang] || EXT_STRINGS['en'] || {};

    function formatStepHtml(key, text) {
      if (!text) return '';
      if (text.indexOf('<strong>') !== -1) return text;
      if (key === 'ext.step2') {
        return text.replace(/(Activities(?: icon)?|Actividades|Atividades|активности|figuras geométricas|formas|आकृतियाँ|செயல்பாடுகள்|యాక్టిവിటీస్|অ্যাক্টিভিটিজ|سرگرمیوں|กิจกรรม|Hoạt động|الأنشطة|פעילויות|Aktiviteter|Toiminnot|Aktivita|Tevékenységek|Δραστηριότητες|Activități|Дейности|Aktivnosti|Aktivity|Dejavnosti|Дії|Activitats|Mga Aktibidad|Aktiviti)/i, '<strong>$1</strong>');
      }
      if (key === 'ext.step3') {
        var res = text.replace(/(Attendance Tracker)/g, '<strong>$1</strong>');
        return res.replace(/(Start|Iniciar|Démarrer|Starten|Avvia|Início|Başlat|Rozpocznij|Начать|Запустить|開始|시작|开始|शुरू करें|தொடங்கு|ప్రారంభించు|শুরু|شروع کریں|Bắt đầu|เริ่ม|ابدأ|התחל|Aloita|Kezdés|Έναρξη|Pornire|Старт|Pokreni|Začni|Почати|Inicia|Magsimula|Mula)/i, '<strong>$1</strong>');
      }
      return text;
    }

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      if (!key) return;
      if (typeof chrome !== 'undefined' && chrome.i18n && chrome.i18n.getMessage) {
        var msgKey = key.replace(/[^a-zA-Z0-9_]/g, '_');
        var msg = chrome.i18n.getMessage(msgKey);
        if (msg) {
          el.innerHTML = formatStepHtml(key, msg);
          return;
        }
      }
      if (dict[key]) {
        el.innerHTML = formatStepHtml(key, dict[key]);
      }
    });
  }
  localizePopup();


  function openUrl(url) {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.create) {
      chrome.tabs.create({ url: url });
    } else {
      window.open(url, '_blank');
    }
  }

  document.getElementById('btn-open-meet').addEventListener('click', function () {
    openUrl('https://meet.google.com');
  });

  document.getElementById('btn-open-marketplace').addEventListener('click', function () {
    openUrl(
      'https://workspace.google.com/marketplace/app/attendance_tracker/829771833968?utm_source=cws_companion_extension'
    );
  });

  document.getElementById('btn-open-history').addEventListener('click', function () {
    openUrl('https://attendancetracker.dev/history.html?utm_source=cws_companion');
  });
})();
