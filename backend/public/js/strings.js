// i18n foundation for the Meet side panel, history, and shared views.
//
// Groundwork: a single source of user-facing strings + a t() lookup, auto-detection
// via navigator.language / localStorage, and dynamic DOM translation helpers.
// Loaded synchronously in <head> so window.t exists before any inline script runs.
//
// Supported locales: en, es, pt, hi, tl, ms, zh, ja.
//
// Kept as a standalone file so it can be unit-tested in jsdom in isolation.
(function (root) {
  'use strict';

  const LOCALES = [
    { code: 'en', label: 'English', flag: '🇺🇸' },
    { code: 'es', label: 'Español', flag: '🇪🇸' },
    { code: 'pt', label: 'Português', flag: '🇧🇷' },
    { code: 'hi', label: 'हिन्दी', flag: '🇮🇳' },
    { code: 'tl', label: 'Tagalog', flag: '🇵🇭' },
    { code: 'ms', label: 'Bahasa Melayu', flag: '🇲🇾' },
    { code: 'zh', label: '繁體中文', flag: '🇹🇼' },
    { code: 'ja', label: '日本語', flag: '🇯🇵' },
  ];

  const STRINGS = {
    en: {
      // Language names
      'lang.en': 'English',
      'lang.es': 'Español',
      'lang.pt': 'Português',
      'lang.hi': 'हिन्दी',
      'lang.tl': 'Tagalog',
      'lang.ms': 'Bahasa Melayu',
      'lang.zh': '繁體中文',
      'lang.ja': '日本語',

      // Status bar
      'status.initializing': 'Initializing…',
      'status.tracking': 'Tracking attendance…',
      'status.stopped': 'Tracking stopped',
      'status.syncing': 'Syncing…',
      'status.exported': 'Exported to Google Sheets',
      'status.notTracking': 'Not tracking',
      'status.connected': 'Connected',

      // Buttons & Actions
      'btn.start': 'Start',
      'btn.stop': 'Stop',
      'btn.sync': 'Sync',
      'btn.sheet': 'Sheet',
      'btn.export': 'Export',
      'btn.exporting': 'Exporting…',
      'btn.saveToSheets': 'Save to Google Sheets',
      'btn.downloadCsv': 'Download CSV',
      'btn.share': 'Share',
      'btn.signIn': 'Sign in with Google',
      'btn.signOut': 'Sign out',
      'btn.copyLink': 'Copy Link',
      'btn.close': 'Close',
      'btn.cancel': 'Cancel',
      'btn.confirm': 'Confirm',
      'btn.refresh': 'Refresh',
      'btn.filter': 'Filter',

      // Attendee & Participant statuses
      'attendee.present': 'Present',
      'attendee.absent': 'Absent',
      'attendee.late': 'Late',
      'attendee.excused': 'Excused',
      'attendee.left': 'Left',
      'attendee.rejoined': 'Rejoined',
      'attendee.self': '(You)',
      'attendee.duration': 'Duration',
      'attendee.joinedAt': 'Joined at',
      'attendee.leftAt': 'Left at',
      'attendee.noShows': 'No-shows',
      'attendee.totalCount': 'Total participants',
      'attendee.activeCount': 'In call',

      // Navigation & Sections
      'nav.history': 'Meeting history',
      'nav.series': 'Series',
      'nav.people': 'People',
      'nav.calendar': 'Calendar',
      'nav.team': 'Team',
      'nav.admin': 'Admin',
      'nav.settings': 'Settings',

      // Filter chips
      'filter.all': 'All',
      'filter.present': 'Present',
      'filter.absent': 'Absent',
      'filter.late': 'Late',
      'filter.excused': 'Excused',

      // Toasts
      'toast.autoExportOn': 'Auto-export on',
      'toast.autoExportOff': 'Auto-export off',
      'toast.emailOn': 'Email notifications on',
      'toast.emailOff': 'Email notifications off',
      'toast.signedOut': 'Signed out',
      'toast.signInFirst': 'Please sign in to start tracking',
      'toast.accountDeleted': 'Your account and data have been deleted.',
      'toast.linkCopied': 'Link copied to clipboard',
      'toast.exportSuccess': 'Attendance saved to Google Sheets',
      'toast.exportFailed': 'Failed to export attendance',
      'toast.syncSuccess': 'Synced with Google Meet',
    },

    es: {
      'lang.en': 'English',
      'lang.es': 'Español',
      'lang.pt': 'Português',
      'lang.hi': 'हिन्दी',
      'lang.tl': 'Tagalog',
      'lang.ms': 'Bahasa Melayu',
      'lang.zh': '繁體中文',
      'lang.ja': '日本語',

      'status.initializing': 'Inicializando…',
      'status.tracking': 'Registrando asistencia…',
      'status.stopped': 'Registro detenido',
      'status.syncing': 'Sincronizando…',
      'status.exported': 'Exportado a Google Sheets',
      'status.notTracking': 'Sin registro activo',
      'status.connected': 'Conectado',

      'btn.start': 'Iniciar',
      'btn.stop': 'Detener',
      'btn.sync': 'Sincronizar',
      'btn.sheet': 'Hoja de cálculo',
      'btn.export': 'Exportar',
      'btn.exporting': 'Exportando…',
      'btn.saveToSheets': 'Guardar en Google Sheets',
      'btn.downloadCsv': 'Descargar CSV',
      'btn.share': 'Compartir',
      'btn.signIn': 'Iniciar sesión con Google',
      'btn.signOut': 'Cerrar sesión',
      'btn.copyLink': 'Copiar enlace',
      'btn.close': 'Cerrar',
      'btn.cancel': 'Cancelar',
      'btn.confirm': 'Confirmar',
      'btn.refresh': 'Actualizar',
      'btn.filter': 'Filtrar',

      'attendee.present': 'Presente',
      'attendee.absent': 'Ausente',
      'attendee.late': 'Tarde',
      'attendee.excused': 'Justificado',
      'attendee.left': 'Salió',
      'attendee.rejoined': 'Volvió a unirse',
      'attendee.self': '(Tú)',
      'attendee.duration': 'Duración',
      'attendee.joinedAt': 'Hora de entrada',
      'attendee.leftAt': 'Hora de salida',
      'attendee.noShows': 'No asistieron',
      'attendee.totalCount': 'Total de participantes',
      'attendee.activeCount': 'En la llamada',

      'nav.history': 'Historial de reuniones',
      'nav.series': 'Series recurrentes',
      'nav.people': 'Personas',
      'nav.calendar': 'Calendario',
      'nav.team': 'Equipo',
      'nav.admin': 'Administración',
      'nav.settings': 'Configuración',

      'filter.all': 'Todos',
      'filter.present': 'Presentes',
      'filter.absent': 'Ausentes',
      'filter.late': 'Tarde',
      'filter.excused': 'Justificados',

      'toast.autoExportOn': 'Exportación automática activada',
      'toast.autoExportOff': 'Exportación automática desactivada',
      'toast.emailOn': 'Notificaciones por correo activadas',
      'toast.emailOff': 'Notificaciones por correo desactivadas',
      'toast.signedOut': 'Sesión cerrada',
      'toast.signInFirst': 'Inicia sesión para comenzar a registrar la asistencia',
      'toast.accountDeleted': 'Tu cuenta y datos han sido eliminados.',
      'toast.linkCopied': 'Enlace copiado al portapapeles',
      'toast.exportSuccess': 'Asistencia guardada en Google Sheets',
      'toast.exportFailed': 'Error al exportar la asistencia',
      'toast.syncSuccess': 'Sincronizado con Google Meet',
    },

    pt: {
      'lang.en': 'English',
      'lang.es': 'Español',
      'lang.pt': 'Português',
      'lang.hi': 'हिन्दी',
      'lang.tl': 'Tagalog',
      'lang.ms': 'Bahasa Melayu',
      'lang.zh': '繁體中文',
      'lang.ja': '日本語',

      'status.initializing': 'Inicializando…',
      'status.tracking': 'Registrando presença…',
      'status.stopped': 'Registro interrompido',
      'status.syncing': 'Sincronizando…',
      'status.exported': 'Exportado para o Google Planilhas',
      'status.notTracking': 'Sem rastreamento ativo',
      'status.connected': 'Conectado',

      'btn.start': 'Iniciar',
      'btn.stop': 'Parar',
      'btn.sync': 'Sincronizar',
      'btn.sheet': 'Planilha',
      'btn.export': 'Exportar',
      'btn.exporting': 'Exportando…',
      'btn.saveToSheets': 'Salvar no Google Planilhas',
      'btn.downloadCsv': 'Baixar CSV',
      'btn.share': 'Compartilhar',
      'btn.signIn': 'Fazer login com o Google',
      'btn.signOut': 'Sair',
      'btn.copyLink': 'Copiar link',
      'btn.close': 'Fechar',
      'btn.cancel': 'Cancelar',
      'btn.confirm': 'Confirmar',
      'btn.refresh': 'Atualizar',
      'btn.filter': 'Filtrar',

      'attendee.present': 'Presente',
      'attendee.absent': 'Ausente',
      'attendee.late': 'Atrasado',
      'attendee.excused': 'Justificado',
      'attendee.left': 'Saiu',
      'attendee.rejoined': 'Entrou novamente',
      'attendee.self': '(Você)',
      'attendee.duration': 'Duração',
      'attendee.joinedAt': 'Entrada',
      'attendee.leftAt': 'Saída',
      'attendee.noShows': 'Faltas',
      'attendee.totalCount': 'Total de participantes',
      'attendee.activeCount': 'Na chamada',

      'nav.history': 'Histórico de reuniões',
      'nav.series': 'Séries recorrentes',
      'nav.people': 'Pessoas',
      'nav.calendar': 'Agenda',
      'nav.team': 'Equipe',
      'nav.admin': 'Administração',
      'nav.settings': 'Configurações',

      'filter.all': 'Todos',
      'filter.present': 'Presentes',
      'filter.absent': 'Ausentes',
      'filter.late': 'Atrasados',
      'filter.excused': 'Justificados',

      'toast.autoExportOn': 'Exportação automática ativada',
      'toast.autoExportOff': 'Exportação automática desativada',
      'toast.emailOn': 'Notificações por e-mail ativadas',
      'toast.emailOff': 'Notificações por e-mail desativadas',
      'toast.signedOut': 'Sessão encerrada',
      'toast.signInFirst': 'Faça login para começar a registrar a presença',
      'toast.accountDeleted': 'Sua conta e dados foram excluídos.',
      'toast.linkCopied': 'Link copiado para a área de transferência',
      'toast.exportSuccess': 'Presença salva no Google Planilhas',
      'toast.exportFailed': 'Falha ao exportar presença',
      'toast.syncSuccess': 'Sincronizado com o Google Meet',
    },

    hi: {
      'lang.en': 'English',
      'lang.es': 'Español',
      'lang.pt': 'Português',
      'lang.hi': 'हिन्दी',
      'lang.tl': 'Tagalog',
      'lang.ms': 'Bahasa Melayu',
      'lang.zh': '繁體中文',
      'lang.ja': '日本語',

      'status.initializing': 'प्रारंभ हो रहा है…',
      'status.tracking': 'उपस्थिति दर्ज की जा रही है…',
      'status.stopped': 'उपस्थिति ट्रैकिंग बंद है',
      'status.syncing': 'सिंक हो रहा है…',
      'status.exported': 'गूगल शीट्स में निर्यात किया गया',
      'status.notTracking': 'ट्रैकिंग चालू नहीं है',
      'status.connected': 'कनेक्टेड',

      'btn.start': 'शुरू करें',
      'btn.stop': 'रोकें',
      'btn.sync': 'सिंक करें',
      'btn.sheet': 'शीट',
      'btn.export': 'निर्यात करें',
      'btn.exporting': 'निर्यात हो रहा है…',
      'btn.saveToSheets': 'गूगल शीट्स में सहेजें',
      'btn.downloadCsv': 'CSV डाउनलोड करें',
      'btn.share': 'शेयर करें',
      'btn.signIn': 'गूगल से साइन इन करें',
      'btn.signOut': 'साइन आउट',
      'btn.copyLink': 'लिंक कॉपी करें',
      'btn.close': 'बंद करें',
      'btn.cancel': 'रद्द करें',
      'btn.confirm': 'पुष्टि करें',
      'btn.refresh': 'रिफ्रेश करें',
      'btn.filter': 'फ़िल्टर',

      'attendee.present': 'उपस्थित',
      'attendee.absent': 'अनुपस्थित',
      'attendee.late': 'देर से',
      'attendee.excused': 'स्वीकृत अनुपस्थिति',
      'attendee.left': 'छोड़ दिया',
      'attendee.rejoined': 'पुनः शामिल हुए',
      'attendee.self': '(आप)',
      'attendee.duration': 'अवधि',
      'attendee.joinedAt': 'शामिल होने का समय',
      'attendee.leftAt': 'छोड़ने का समय',
      'attendee.noShows': 'अनुपस्थित लोग',
      'attendee.totalCount': 'कुल प्रतिभागी',
      'attendee.activeCount': 'कॉल में सक्रिय',

      'nav.history': 'मीटिंग इतिहास',
      'nav.series': 'आवर्ती श्रृंखला',
      'nav.people': 'लोग',
      'nav.calendar': 'कैलेंडर',
      'nav.team': 'टीम',
      'nav.admin': 'व्यवस्थापक',
      'nav.settings': 'सेटिंग्स',

      'filter.all': 'सभी',
      'filter.present': 'उपस्थित',
      'filter.absent': 'अनुपस्थित',
      'filter.late': 'विलंबित',
      'filter.excused': 'स्वीकृत',

      'toast.autoExportOn': 'ऑटो-निर्यात चालू',
      'toast.autoExportOff': 'ऑटो-निर्यात बंद',
      'toast.emailOn': 'ईमेल सूचनाएं चालू',
      'toast.emailOff': 'ईमेल सूचनाएं बंद',
      'toast.signedOut': 'साइन आउट किया गया',
      'toast.signInFirst': 'ट्रैकिंग शुरू करने के लिए कृपया साइन इन करें',
      'toast.accountDeleted': 'आपका खाता और डेटा हटा दिया गया है।',
      'toast.linkCopied': 'लिंक क्लिपबोर्ड पर कॉपी किया गया',
      'toast.exportSuccess': 'उपस्थिति गूगल शीट्स में सहेजी गई',
      'toast.exportFailed': 'उपस्थिति निर्यात करने में विफल',
      'toast.syncSuccess': 'गूगल मीट के साथ सिंक किया गया',
    },

    tl: {
      'lang.en': 'English',
      'lang.es': 'Español',
      'lang.pt': 'Português',
      'lang.hi': 'हिन्दी',
      'lang.tl': 'Tagalog',
      'lang.ms': 'Bahasa Melayu',
      'lang.zh': '繁體中文',
      'lang.ja': '日本語',

      'status.initializing': 'Nagsisimula…',
      'status.tracking': 'Nagtatala ng pagdalo…',
      'status.stopped': 'Itinigil ang pagtala',
      'status.syncing': 'Nag-si-sync…',
      'status.exported': 'Na-export sa Google Sheets',
      'status.notTracking': 'Walang aktibong pagtala',
      'status.connected': 'Konektado',

      'btn.start': 'Simulan',
      'btn.stop': 'Itigil',
      'btn.sync': 'I-sync',
      'btn.sheet': 'Sheet',
      'btn.export': 'I-export',
      'btn.exporting': 'Nag-e-export…',
      'btn.saveToSheets': 'I-save sa Google Sheets',
      'btn.downloadCsv': 'I-download ang CSV',
      'btn.share': 'Ibahagi',
      'btn.signIn': 'Mag-sign in gamit ang Google',
      'btn.signOut': 'Mag-sign out',
      'btn.copyLink': 'Kopyahin ang Link',
      'btn.close': 'Isara',
      'btn.cancel': 'Kanselahin',
      'btn.confirm': 'Kumpirmahin',
      'btn.refresh': 'I-refresh',
      'btn.filter': 'I-filter',

      'attendee.present': 'Dumalo (Present)',
      'attendee.absent': 'Hindi Dumalo (Absent)',
      'attendee.late': 'Huli (Late)',
      'attendee.excused': 'May Paalam (Excused)',
      'attendee.left': 'Umalis',
      'attendee.rejoined': 'Muling sumali',
      'attendee.self': '(Ikaw)',
      'attendee.duration': 'Tagal',
      'attendee.joinedAt': 'Oras ng pagsali',
      'attendee.leftAt': 'Oras ng pag-alis',
      'attendee.noShows': 'Mga hindi sumipot',
      'attendee.totalCount': 'Kabuuang lumahok',
      'attendee.activeCount': 'Kasalukuyang nasa tawag',

      'nav.history': 'Kasaysayan ng Pagpupulong',
      'nav.series': 'Serye ng Pagpupulong',
      'nav.people': 'Mga Tao',
      'nav.calendar': 'Kalendaryo',
      'nav.team': 'Koponan',
      'nav.admin': 'Admin',
      'nav.settings': 'Mga Setting',

      'filter.all': 'Lahat',
      'filter.present': 'Dumalo',
      'filter.absent': 'Hindi Dumalo',
      'filter.late': 'Huli',
      'filter.excused': 'May Paalam',

      'toast.autoExportOn': 'Naka-on ang auto-export' ,
      'toast.autoExportOff': 'Naka-off ang auto-export',
      'toast.emailOn': 'Naka-on ang mga email notification',
      'toast.emailOff': 'Naka-off ang mga email notification',
      'toast.signedOut': 'Naka-sign out na',
      'toast.signInFirst': 'Mag-sign in muna para simulan ang pagtatala',
      'toast.accountDeleted': 'Ang iyong account at datos ay tinanggal na.',
      'toast.linkCopied': 'Nakopya ang link sa clipboard',
      'toast.exportSuccess': 'Na-save ang pagdalo sa Google Sheets',
      'toast.exportFailed': 'Hindi na-export ang pagdalo',
      'toast.syncSuccess': 'Naka-sync sa Google Meet',
    },

    ms: {
      'lang.en': 'English',
      'lang.es': 'Español',
      'lang.pt': 'Português',
      'lang.hi': 'हिन्दी',
      'lang.tl': 'Tagalog',
      'lang.ms': 'Bahasa Melayu',
      'lang.zh': '繁體中文',
      'lang.ja': '日本語',

      'status.initializing': 'Memulakan…',
      'status.tracking': 'Menjejak kehadiran…',
      'status.stopped': 'Penjejakan dihentikan',
      'status.syncing': 'Menyegerak…',
      'status.exported': 'Dieksport ke Google Sheets',
      'status.notTracking': 'Tiada penjejakan aktif',
      'status.connected': 'Disambungkan',

      'btn.start': 'Mula',
      'btn.stop': 'Henti',
      'btn.sync': 'Segerakkan',
      'btn.sheet': 'Helaian',
      'btn.export': 'Eksport',
      'btn.exporting': 'Mengeksport…',
      'btn.saveToSheets': 'Simpan ke Google Sheets',
      'btn.downloadCsv': 'Muat turun CSV',
      'btn.share': 'Kongsi',
      'btn.signIn': 'Log masuk dengan Google',
      'btn.signOut': 'Log keluar',
      'btn.copyLink': 'Salin Pautan',
      'btn.close': 'Tutup',
      'btn.cancel': 'Batal',
      'btn.confirm': 'Sahkan',
      'btn.refresh': 'Segar semula',
      'btn.filter': 'Tapis',

      'attendee.present': 'Hadir',
      'attendee.absent': 'Tidak Hadir',
      'attendee.late': 'Lewat',
      'attendee.excused': 'Dimaafkan',
      'attendee.left': 'Telah keluar',
      'attendee.rejoined': 'Menyertai semula',
      'attendee.self': '(Anda)',
      'attendee.duration': 'Tempoh',
      'attendee.joinedAt': 'Masa menyertai',
      'attendee.leftAt': 'Masa keluar',
      'attendee.noShows': 'Tidak hadir',
      'attendee.totalCount': 'Jumlah peserta',
      'attendee.activeCount': 'Dalam panggilan',

      'nav.history': 'Sejarah mesyuarat',
      'nav.series': 'Siri mesyuarat',
      'nav.people': 'Peserta',
      'nav.calendar': 'Kalendar',
      'nav.team': 'Pasukan',
      'nav.admin': 'Pentadbir',
      'nav.settings': 'Tetapan',

      'filter.all': 'Semua',
      'filter.present': 'Hadir',
      'filter.absent': 'Tidak Hadir',
      'filter.late': 'Lewat',
      'filter.excused': 'Dimaafkan',

      'toast.autoExportOn': 'Eksport automatik diaktifkan',
      'toast.autoExportOff': 'Eksport automatik dinyahaktifkan',
      'toast.emailOn': 'Pemberitahuan e-mel diaktifkan',
      'toast.emailOff': 'Pemberitahuan e-mel dinyahaktifkan',
      'toast.signedOut': 'Telah log keluar',
      'toast.signInFirst': 'Sila log masuk untuk memulakan penjejakan',
      'toast.accountDeleted': 'Akaun dan data anda telah dipadamkan.',
      'toast.linkCopied': 'Pautan disalin ke papan keratan',
      'toast.exportSuccess': 'Kehadiran disimpan ke Google Sheets',
      'toast.exportFailed': 'Gagal mengeksport kehadiran',
      'toast.syncSuccess': 'Diselaraskan dengan Google Meet',
    },

    zh: {
      'lang.en': 'English',
      'lang.es': 'Español',
      'lang.pt': 'Português',
      'lang.hi': 'हिन्दी',
      'lang.tl': 'Tagalog',
      'lang.ms': 'Bahasa Melayu',
      'lang.zh': '繁體中文',
      'lang.ja': '日本語',

      'status.initializing': '正在初始化…',
      'status.tracking': '正在記錄出席…',
      'status.stopped': '記錄已停止',
      'status.syncing': '正在同步…',
      'status.exported': '已匯出至 Google 試算表',
      'status.notTracking': '未在記錄中',
      'status.connected': '已連線',

      'btn.start': '開始',
      'btn.stop': '停止',
      'btn.sync': '同步',
      'btn.sheet': '試算表',
      'btn.export': '匯出',
      'btn.exporting': '正在匯出…',
      'btn.saveToSheets': '儲存至 Google 試算表',
      'btn.downloadCsv': '下載 CSV',
      'btn.share': '分享',
      'btn.signIn': '使用 Google 帳戶登入',
      'btn.signOut': '登出',
      'btn.copyLink': '複製連結',
      'btn.close': '關閉',
      'btn.cancel': '取消',
      'btn.confirm': '確認',
      'btn.refresh': '重新整理',
      'btn.filter': '篩選',

      'attendee.present': '出席',
      'attendee.absent': '缺席',
      'attendee.late': '遲到',
      'attendee.excused': '已請假',
      'attendee.left': '已離開',
      'attendee.rejoined': '重新加入',
      'attendee.self': '(您)',
      'attendee.duration': '時長',
      'attendee.joinedAt': '加入時間',
      'attendee.leftAt': '離開時間',
      'attendee.noShows': '未出席名單',
      'attendee.totalCount': '參與者總數',
      'attendee.activeCount': '通話中人數',

      'nav.history': '會議記錄',
      'nav.series': '週期性會議',
      'nav.people': '成員名冊',
      'nav.calendar': '日曆',
      'nav.team': '團隊',
      'nav.admin': '管理員',
      'nav.settings': '設定',

      'filter.all': '全部',
      'filter.present': '出席',
      'filter.absent': '缺席',
      'filter.late': '遲到',
      'filter.excused': '請假',

      'toast.autoExportOn': '已開啟自動匯出',
      'toast.autoExportOff': '已關閉自動匯出',
      'toast.emailOn': '已開啟電子郵件通知',
      'toast.emailOff': '已關閉電子郵件通知',
      'toast.signedOut': '已成功登出',
      'toast.signInFirst': '請先登入以開始記錄出席',
      'toast.accountDeleted': '您的帳戶及所有資料已刪除。',
      'toast.linkCopied': '連結已複製至剪貼簿',
      'toast.exportSuccess': '出席記錄已成功儲存至 Google 試算表',
      'toast.exportFailed': '匯出出席記錄失敗',
      'toast.syncSuccess': '已與 Google Meet 同步',
    },

    ja: {
      'lang.en': 'English',
      'lang.es': 'Español',
      'lang.pt': 'Português',
      'lang.hi': 'हिन्दी',
      'lang.tl': 'Tagalog',
      'lang.ms': 'Bahasa Melayu',
      'lang.zh': '繁體中文',
      'lang.ja': '日本語',

      'status.initializing': '初期化中…',
      'status.tracking': '出席状況を記録中…',
      'status.stopped': '記録を停止しました',
      'status.syncing': '同期中…',
      'status.exported': 'Google スプレッドシートに出力完了',
      'status.notTracking': '記録停止中',
      'status.connected': '接続完了',

      'btn.start': '開始',
      'btn.stop': '停止',
      'btn.sync': '同期',
      'btn.sheet': 'シート',
      'btn.export': 'エクスポート',
      'btn.exporting': 'エクスポート中…',
      'btn.saveToSheets': 'Google スプレッドシートに保存',
      'btn.downloadCsv': 'CSVをダウンロード',
      'btn.share': '共有',
      'btn.signIn': 'Googleでログイン',
      'btn.signOut': 'ログアウト',
      'btn.copyLink': 'リンクをコピー',
      'btn.close': '閉じる',
      'btn.cancel': 'キャンセル',
      'btn.confirm': '確認',
      'btn.refresh': '更新',
      'btn.filter': '絞り込み',

      'attendee.present': '出席',
      'attendee.absent': '欠席',
      'attendee.late': '遅刻',
      'attendee.excused': '公欠・免除',
      'attendee.left': '退出',
      'attendee.rejoined': '再参加',
      'attendee.self': '(自分)',
      'attendee.duration': '参加時間',
      'attendee.joinedAt': '参加時刻',
      'attendee.leftAt': '退出時刻',
      'attendee.noShows': '不参加者',
      'attendee.totalCount': '総参加者数',
      'attendee.activeCount': '通話中の参加者',

      'nav.history': 'ミーティング履歴',
      'nav.series': '定期ミーティング',
      'nav.people': '参加者一覧',
      'nav.calendar': 'カレンダー',
      'nav.team': 'チーム',
      'nav.admin': '管理者',
      'nav.settings': '設定',

      'filter.all': 'すべて',
      'filter.present': '出席',
      'filter.absent': '欠席',
      'filter.late': '遅刻',
      'filter.excused': '公欠',

      'toast.autoExportOn': '自動エクスポート: オン',
      'toast.autoExportOff': '自動エクスポート: オフ',
      'toast.emailOn': 'メール通知: オン',
      'toast.emailOff': 'メール通知: オフ',
      'toast.signedOut': 'ログアウトしました',
      'toast.signInFirst': '記録を開始するにはログインしてください',
      'toast.accountDeleted': 'アカウントおよびデータが削除されました。',
      'toast.linkCopied': 'リンクをクリップボードにコピーしました',
      'toast.exportSuccess': '出席データをスプレッドシートに保存しました',
      'toast.exportFailed': '出席データのエクスポートに失敗しました',
      'toast.syncSuccess': 'Google Meet と同期しました',
    },
  };

  let locale = 'en';

  // Look up a key for the active locale, falling back to English, then to the
  // provided fallback, then to the key itself (so a missing key is visible, not blank).
  function t(key, fallback) {
    const table = STRINGS[locale];
    if (table && Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    if (Object.prototype.hasOwnProperty.call(STRINGS.en, key)) return STRINGS.en[key];
    return fallback != null ? fallback : key;
  }

  // Detect appropriate locale from stored preference or browser language.
  function detectLocale(navLang) {
    if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem('att_locale');
        if (stored && STRINGS[stored]) return stored;
      } catch { /* ignored */ }
    }
    const raw = String(
      navLang ||
      (typeof navigator !== 'undefined' ? (navigator.language || (navigator.languages && navigator.languages[0])) : 'en') ||
      'en'
    ).toLowerCase();

    if (raw.startsWith('es')) return 'es';
    if (raw.startsWith('pt')) return 'pt';
    if (raw.startsWith('hi')) return 'hi';
    if (raw.startsWith('tl') || raw.startsWith('fil')) return 'tl';
    if (raw.startsWith('ms') || raw.startsWith('id')) return 'ms';
    if (raw.startsWith('zh')) return 'zh';
    if (raw.startsWith('ja')) return 'ja';
    return 'en';
  }

  function setLocale(l, persist) {
    if (STRINGS[l]) {
      locale = l;
      if (persist && typeof localStorage !== 'undefined') {
        try { localStorage.setItem('att_locale', l); } catch { /* quota/private mode */ }
      }
    }
    return locale;
  }

  // Automatically translate any elements in the DOM with data-i18n attributes.
  function applyTranslations(rootEl) {
    const doc = rootEl || (typeof document !== 'undefined' ? document : null);
    if (!doc || !doc.querySelectorAll) return;

    doc.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key, el.textContent);
    });

    doc.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key, el.getAttribute('placeholder')));
    });

    doc.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(key, el.getAttribute('title')));
    });
  }

  // Initialize locale on load if in browser
  if (typeof window !== 'undefined') {
    setLocale(detectLocale());
  }

  const api = {
    t,
    setLocale,
    getLocale: () => locale,
    detectLocale,
    applyTranslations,
    getAvailableLocales: () => LOCALES,
    LOCALES,
    STRINGS,
  };

  // Browser: expose window.t + window.AttStrings. Node/jsdom test: module.exports.
  if (root) {
    root.t = t;
    root.setLocale = setLocale;
    root.AttStrings = api;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);

