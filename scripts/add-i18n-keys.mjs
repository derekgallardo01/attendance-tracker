import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { EXTRA_LOCALE_OVERRIDES } from './build-locale-overrides.mjs';
import { GROWTH_KEYS_EN, GROWTH_LOCALE_MAPS, getGrowthTranslationsForLocale } from './add-growth-keys.mjs';
import { TRANSLATION_FIXES } from './translation-fixes.mjs';
import { ERROR_KEYS_EN, ERROR_KEY_TRANSLATIONS } from './i18n-error-keys.mjs';
import { NEW_WEBSITE_KEYS_EN, NEW_WEBSITE_KEY_LIST, NEW_WEBSITE_PART1 } from './new-website-keys-part1.mjs';
import { NEW_WEBSITE_PART2A } from './new-website-keys-part2a.mjs';
import { NEW_WEBSITE_PART2B } from './new-website-keys-part2b.mjs';
import { LP2_66_KEYS, LP2_SPANISH_FIXES_PART1 } from './lp2-spanish-fixes-part1.mjs';
import { LP2_SPANISH_FIXES_PART2, CA_EXTRA_FIXES } from './lp2-spanish-fixes-part2.mjs';
import { LP2_STRUCTURAL_KEYS, LP2_STRUCTURAL_FIXES, LP2_FREE_BODY_ALL } from './lp2-structural-and-free-fixes.mjs';
import { REMAINING_LP2_KEYS_EN, getRemainingLp2AndFixes } from './lp2-remaining-keys.mjs';
const require = createRequire(import.meta.url);
const i18nBackend = require('../backend/src/lib/i18n.js');

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const stringsPath = path.join(ROOT, 'js', 'strings.js');

const NEW_KEYS_EN = {
  "pricing.oneTime": "one-time",
  "history.downloadsLabel": "Downloads:",
  "history.downloadCertsTitle": "Generate verifiable student attendance certificates (Educator Pro)",
  "export.checkedInPrefix": "Checked in ",
  "pricing.teacherMigrationBanner": "<strong>Switching from a competitor or a retired tool?</strong> <a href=\"attendance-taker-for-classroom-alternative.html\" style=\"color:var(--blue);font-weight:600;text-decoration:underline;margin-left:4px\">Use our free 5-second roster migration tool &rarr;</a>",
  "pricing.promoApplied": "🎁 Promo code box enabled for checkout",
  "pricing.havePromoCode": "Have a promo or referral code?",
  "billing.lmsSyncPro": "Syncing grades directly to Google Classroom and Canvas requires an Educator or Pro plan.",
  "export.graceUsed": "🎉 Complimentary Full-Roster Export: We unlocked all {count} attendees for your first large class! Upgrade to Educator for unlimited class sizes on future classes.",
  "upgrade.singleAltPrefix": "Only need this single meeting? Unlock for",
  "history.clusterPromoCtaInst": "Upgrade to Institution Plan ($149/yr) →",
  "history.clusterPromoCtaQuote": "Request Custom School Quote →",
  "quote.askSchoolBtn": "Ask my school to pay (Download Quote PDF)",
  "renewal.noticeText": "Your Pro ended — renew to keep unlimited classes & auto-export",
  "empty.readySub": "Press <strong style=\"color:#4ade80\">Start</strong> above to begin tracking attendance",
  
  // Matrix Headers
  "pricing.matrixColFeature": "Feature / Capability",
  "pricing.matrixBadgeOurs": "OURS",
  "pricing.matrixColOtherAddons": "Other Workspace Add-ons",
  "pricing.matrixColExtensions": "Browser Extensions",
  "pricing.matrixColNative": "Native Meet Built-in",

  // Matrix Row 1: Architecture
  "pricing.matrixRowArch": "Architecture",
  "pricing.matrixArchOurs": "Official Meet REST API",
  "pricing.matrixArchOursSub": "100% DOM-immune, zero page scraping",
  "pricing.matrixArchOther": "DOM Screen Scraper",
  "pricing.matrixArchOtherSub": "Breaks on Meet UI changes",
  "pricing.matrixArchExt": "DOM Screen Scraper",
  "pricing.matrixArchExtSub": "Breaks on Meet UI changes",
  "pricing.matrixArchNative": "1st-party cloud",
  "pricing.matrixArchNativeSub": "Host-only, post-meeting email",

  // Matrix Row 2: Supported Browsers
  "pricing.matrixRowBrowsers": "Supported Browsers & Devices",
  "pricing.matrixBrowsersOurs": "Every Browser + Mobile",
  "pricing.matrixBrowsersOursSub": "Chrome, Edge, Safari, Firefox, Mac, Windows, iPads, Managed Chromebooks",
  "pricing.matrixBrowsersOther": "Chrome desktop only",
  "pricing.matrixBrowsersOtherSub": "No Safari, Firefox, or iPad",
  "pricing.matrixBrowsersExt": "Chrome desktop only",
  "pricing.matrixBrowsersExtSub": "No Safari, Firefox, or iPad",
  "pricing.matrixBrowsersNative": "Any browser",
  "pricing.matrixBrowsersNativeSub": "(High-tier Workspace only)",

  // Matrix Row 3: Team / School License
  "pricing.matrixRowTeam": "Team / School License",
  "pricing.matrixTeamOurs": "$59/yr Flat Department",
  "pricing.matrixTeamOursSub": "<strong>Unlimited Teachers</strong> across domain (or $149/yr Institution)",
  "pricing.matrixTeamOther5": "$149/yr (5 seats)",
  "pricing.matrixTeamOther20": "$499/yr (20 seats)",
  "pricing.matrixTeamOtherSub": "Steep per-seat penalty",
  "pricing.matrixTeamExt": "Not offered",
  "pricing.matrixTeamExtSub": "Per-user seat licenses only",
  "pricing.matrixTeamNative": "Domain Workspace upgrade",
  "pricing.matrixTeamNativeSub": "Requires $4–$20/user/mo domain-wide",

  // Matrix Row 4: Individual Pricing
  "pricing.matrixRowIndividual": "Individual Pricing",
  "pricing.matrixIndivOurs": "$9.99 Lifetime / $4.99/yr Edu",
  "pricing.matrixIndivOursSub": "Pay-once lifetime option; < 42¢/mo educator pass",
  "pricing.matrixIndivOther": "$39.00/yr recurring",
  "pricing.matrixIndivOtherSub": "No lifetime option",
  "pricing.matrixIndivExt": "Free / $30.00/yr ($2.50/mo)",
  "pricing.matrixIndivExtSub": "Recurring subscription",
  "pricing.matrixIndivNative": "Included in Education Plus",
  "pricing.matrixIndivNativeSub": "Unavailable on Starter / Free",

  // Matrix Row 5: LMS Gradebook Writeback
  "pricing.matrixRowLms": "LMS Gradebook Writeback",
  "pricing.matrixLmsOurs": "1-Click Google Classroom & Canvas",
  "pricing.matrixLmsOursSub": "Direct REST grade sync + Moodle gradebook CSV",
  "pricing.matrixLmsOther": "None",
  "pricing.matrixLmsExt": "None",
  "pricing.matrixLmsNative": "None",
  "pricing.matrixLmsNativeSub": "Manual grade entry only",

  // Matrix Row 6: Past Meeting Retrieval
  "pricing.matrixRowPast": "Past Meeting Retrieval",
  "pricing.matrixPastOurs": "14-Day Retroactive Import",
  "pricing.matrixPastOursSub": "Via conferenceRecords even if panel was closed",
  "pricing.matrixPastOther": "30-meeting lifetime limit",
  "pricing.matrixPastOtherSub": "Must be recorded live",
  "pricing.matrixPastExt": "None",
  "pricing.matrixPastExtSub": "Lost if tab closed",
  "pricing.matrixPastNative": "None",
  "pricing.matrixPastNativeSub": "No retroactive sync",

  // Matrix Row 7: Regional Payment Rails
  "pricing.matrixRowRails": "Regional Payment Rails",
  "pricing.matrixRailsOurs": "Localized Currencies & Wallets",
  "pricing.matrixRailsOursSub": "UPI (₹299), GCash/Maya (₱280), QRIS (Rp 78k), FPX (RM 22)",
  "pricing.matrixRailsOther": "USD Credit Card only",
  "pricing.matrixRailsExt": "USD Credit Card only",
  "pricing.matrixRailsNative": "Workspace Enterprise invoice",

  // Matrix Row 8: Languages Supported
  "pricing.matrixRowLanguages": "Languages Supported",
  "pricing.matrixLanguagesOurs": "60 Localized Languages",
  "pricing.matrixLanguagesOursSub": "Auto-detected browser locale + in-app switcher",
  "pricing.matrixLanguagesOther": "English-only",
  "pricing.matrixLanguagesExt": "English-only",
  "pricing.matrixLanguagesNative": "Standard Google UI",

  // LMS Sync Dialog Messages
  "lms.alertSignInRequired": "Please sign in from the main panel to grant Google Classroom write permissions.",
  "lms.failedToLoadCourses": "Failed to load courses",
  "lms.failedToLoadCoursesErr": "Failed to load courses: {err}",
  "lms.failedToLoadAssignments": "Failed to load assignments.",
  "lms.failedToLoadAssignmentsErr": "Failed to load assignments: {err}",
  "lms.failedToLoadCanvasCourses": "Failed to load Canvas courses. Check URL and token.",
  "lms.canvasConnectionError": "Canvas connection error: {err}",
  "lms.connectionFailed": "Connection failed",
  "lms.failedToLoadCanvasAssignments": "Failed to load Canvas assignments.",
  "lms.failedToLoadCanvasAssignmentsErr": "Failed to load Canvas assignments: {err}",
  "lms.selectClassroomCourse": "Please select a Classroom course.",
  "lms.classroomSyncFailed": "Classroom sync failed.",
  "lms.warningPrefix": "Warning: {msg}",
  "lms.noStudentsMatchedRoster": "No students matched the course roster.",
  "lms.selectCanvasCourse": "Please select a Canvas course.",
  "lms.canvasSyncFailed": "Canvas sync failed.",
  "lms.noAttendeesMatchedCanvas": "No meeting attendees matched students in the Canvas course roster.",
  "lms.errorPrefix": "Error: {msg}",
  "lms.sessionExpired": "Session expired",
  "lms.permissionRequired": "Permission required"
};

Object.assign(NEW_KEYS_EN, GROWTH_KEYS_EN, NEW_WEBSITE_KEYS_EN, ERROR_KEYS_EN);

// Specialized translations for non-English locales
const LOCALE_OVERRIDES = {
  es: {
    "pricing.oneTime": "pago único",
    "history.downloadsLabel": "Descargas:",
    "history.downloadCertsTitle": "Generar certificados de asistencia verificables para estudiantes (Educator Pro)",
    "pricing.teacherMigrationBanner": "<strong>¿Cambias desde Competitor o una herramienta retirada?</strong> <a href=\"attendance-taker-for-classroom-alternative.html\" style=\"color:var(--blue);font-weight:600;text-decoration:underline;margin-left:4px\">Usa nuestra herramienta de migración gratuita en 5 segundos &rarr;</a>",
    "pricing.promoApplied": "🎁 Casilla de código promocional activada para el pago",
    "pricing.havePromoCode": "¿Tienes un código promocional o de referido?",
    "history.clusterPromoCtaInst": "Mejorar a Plan Institucional ($149/año) →",
    "history.clusterPromoCtaQuote": "Solicitar cotización personalizada para la escuela →",
    "quote.askSchoolBtn": "Pedir a mi escuela que pague (Descargar cotización en PDF)",
    "renewal.noticeText": "Tu Pro terminó — renueva para mantener clases ilimitadas y exportación automática",
    "pricing.matrixColFeature": "Característica / Capacidad",
    "pricing.matrixBadgeOurs": "NUESTRO",
    "pricing.matrixColOtherAddons": "Otros complementos de Workspace",
    "pricing.matrixColExtensions": "Extensiones de navegador",
    "pricing.matrixColNative": "Integrado nativo de Meet",
    "pricing.matrixRowArch": "Arquitectura",
    "pricing.matrixArchOurs": "API REST oficial de Meet",
    "pricing.matrixArchOursSub": "100% inmune al DOM, sin scraping de páginas",
    "pricing.matrixArchOther": "Raspador de pantalla DOM",
    "pricing.matrixArchOtherSub": "Se rompe con cambios en la interfaz de Meet",
    "pricing.matrixArchExt": "Raspador de pantalla DOM",
    "pricing.matrixArchExtSub": "Se rompe con cambios en la interfaz de Meet",
    "pricing.matrixArchNative": "Nube oficial de Google",
    "pricing.matrixArchNativeSub": "Solo para el anfitrión, correo tras la reunión",
    "pricing.matrixRowBrowsers": "Navegadores y dispositivos compatibles",
    "pricing.matrixBrowsersOurs": "Todos los navegadores y móviles",
    "pricing.matrixBrowsersOursSub": "Chrome, Edge, Safari, Firefox, Mac, Windows, iPads, Chromebooks administrados",
    "pricing.matrixBrowsersOther": "Solo Chrome de escritorio",
    "pricing.matrixBrowsersOtherSub": "Sin Safari, Firefox ni iPad",
    "pricing.matrixBrowsersExt": "Solo Chrome de escritorio",
    "pricing.matrixBrowsersExtSub": "Sin Safari, Firefox ni iPad",
    "pricing.matrixBrowsersNative": "Cualquier navegador",
    "pricing.matrixBrowsersNativeSub": "(Solo en planes Workspace superiores)",
    "pricing.matrixRowTeam": "Licencia de equipo o escuela",
    "pricing.matrixTeamOurs": "Tarifa fija de $59/año (Departamento)",
    "pricing.matrixTeamOursSub": "<strong>Profesores ilimitados</strong> en todo el dominio (o $149/año Institución)",
    "pricing.matrixTeamOther5": "$149/año (5 usuarios)",
    "pricing.matrixTeamOther20": "$499/año (20 usuarios)",
    "pricing.matrixTeamOtherSub": "Fuerte penalización por usuario",
    "pricing.matrixTeamExt": "No ofrecido",
    "pricing.matrixTeamExtSub": "Solo licencias individuales por usuario",
    "pricing.matrixTeamNative": "Actualización de dominio de Workspace",
    "pricing.matrixTeamNativeSub": "Requiere $4–$20/usuario/mes en todo el dominio",
    "pricing.matrixRowIndividual": "Precios individuales",
    "pricing.matrixIndivOurs": "$9.99 de por vida / $4.99/año Edu",
    "pricing.matrixIndivOursSub": "Opción de por vida de pago único; < 42¢/mes pase para educadores",
    "pricing.matrixIndivOther": "$39.00/año recurrente",
    "pricing.matrixIndivOtherSub": "Sin opción de por vida",
    "pricing.matrixIndivExt": "Gratis / $30.00/año ($2.50/mes)",
    "pricing.matrixIndivExtSub": "Suscripción recurrente",
    "pricing.matrixIndivNative": "Incluido en Education Plus",
    "pricing.matrixIndivNativeSub": "No disponible en Starter / Free",
    "pricing.matrixRowLms": "Sincronización con LMS",
    "pricing.matrixLmsOurs": "Google Classroom y Canvas con 1 clic",
    "pricing.matrixLmsOursSub": "Sincronización directa REST + CSV para Moodle",
    "pricing.matrixLmsOther": "Ninguno",
    "pricing.matrixLmsExt": "Ninguno",
    "pricing.matrixLmsNative": "Ninguno",
    "pricing.matrixLmsNativeSub": "Solo entrada manual de calificaciones",
    "pricing.matrixRowPast": "Recuperación de reuniones pasadas",
    "pricing.matrixPastOurs": "Importación retroactiva de 14 días",
    "pricing.matrixPastOursSub": "Mediante conferenceRecords incluso si el panel estaba cerrado",
    "pricing.matrixPastOther": "Límite de 30 reuniones en total",
    "pricing.matrixPastOtherSub": "Debe registrarse en vivo",
    "pricing.matrixPastExt": "Ninguno",
    "pricing.matrixPastExtSub": "Se pierde si se cierra la pestaña",
    "pricing.matrixPastNative": "Ninguno",
    "pricing.matrixPastNativeSub": "Sin sincronización retroactiva",
    "pricing.matrixRowRails": "Métodos de pago regionales",
    "pricing.matrixRailsOurs": "Monedas y billeteras locales",
    "pricing.matrixRailsOursSub": "Billeteras locales: UPI (₹299), GCash/Maya (₱280), QRIS (Rp 78k), FPX (RM 22)",
    "pricing.matrixRailsOther": "Solo tarjeta de crédito en USD",
    "pricing.matrixRailsExt": "Solo tarjeta de crédito en USD",
    "pricing.matrixRailsNative": "Facturación Workspace Enterprise",
    "pricing.matrixRowLanguages": "Idiomas compatibles",
    "pricing.matrixLanguagesOurs": "60 idiomas nativos",
    "pricing.matrixLanguagesOursSub": "Detección automática del idioma del navegador + selector en la app",
    "pricing.matrixLanguagesOther": "Solo inglés",
    "pricing.matrixLanguagesExt": "Solo inglés",
    "pricing.matrixLanguagesNative": "Interfaz estándar de Google",
    "lms.alertSignInRequired": "Inicia sesión desde el panel principal para otorgar permisos de escritura en Google Classroom.",
    "lms.failedToLoadCourses": "Error al cargar los cursos",
    "lms.failedToLoadCoursesErr": "Error al cargar los cursos: {err}",
    "lms.failedToLoadAssignments": "Error al cargar las tareas.",
    "lms.failedToLoadAssignmentsErr": "Error al cargar las tareas: {err}",
    "lms.failedToLoadCanvasCourses": "Error al cargar los cursos de Canvas. Verifica la URL y el token.",
    "lms.canvasConnectionError": "Error de conexión con Canvas: {err}",
    "lms.connectionFailed": "Conexión fallida",
    "lms.failedToLoadCanvasAssignments": "Error al cargar las tareas de Canvas.",
    "lms.failedToLoadCanvasAssignmentsErr": "Error al cargar las tareas de Canvas: {err}",
    "lms.selectClassroomCourse": "Selecciona un curso de Classroom.",
    "lms.classroomSyncFailed": "Error en la sincronización con Classroom.",
    "lms.warningPrefix": "Advertencia: {msg}",
    "lms.noStudentsMatchedRoster": "Ningún estudiante coincidió con la lista del curso.",
    "lms.selectCanvasCourse": "Selecciona un curso de Canvas.",
    "lms.canvasSyncFailed": "Error en la sincronización con Canvas.",
    "lms.noAttendeesMatchedCanvas": "Ningún asistente a la reunión coincidió con estudiantes de la lista de Canvas.",
    "lms.errorPrefix": "Error: {msg}",
    "lms.sessionExpired": "Sesión expirada",
    "lms.permissionRequired": "Permiso requerido"
  },
  pt: {
    "pricing.oneTime": "pagamento único",
    "history.downloadsLabel": "Downloads:",
    "history.downloadCertsTitle": "Gerar certificados de presença verificáveis para alunos (Educator Pro)",
    "pricing.teacherMigrationBanner": "<strong>Migrando do Competitor ou ferramenta descontinuada?</strong> <a href=\"attendance-taker-for-classroom-alternative.html\" style=\"color:var(--blue);font-weight:600;text-decoration:underline;margin-left:4px\">Use nossa ferramenta gratuita de migração em 5 segundos &rarr;</a>",
    "pricing.promoApplied": "🎁 Campo de código promocional ativado para o checkout",
    "pricing.havePromoCode": "Tem um código promocional ou de indicação?",
    "history.clusterPromoCtaInst": "Fazer upgrade para o Plano Institucional ($149/ano) →",
    "history.clusterPromoCtaQuote": "Solicitar cotação personalizada para a escola →",
    "quote.askSchoolBtn": "Pedir para a minha escola pagar (Baixar cotação em PDF)",
    "renewal.noticeText": "Seu Pro expirou — renove para manter turmas ilimitadas e exportação automática",
    "pricing.matrixColFeature": "Recurso / Capacidade",
    "pricing.matrixBadgeOurs": "NOSSO",
    "pricing.matrixColOtherAddons": "Outros complementos do Workspace",
    "pricing.matrixColExtensions": "Extensões de navegador",
    "pricing.matrixColNative": "Nativo do Google Meet",
    "pricing.matrixRowArch": "Arquitetura",
    "pricing.matrixArchOurs": "API REST oficial do Meet",
    "pricing.matrixArchOursSub": "100% imune ao DOM, sem raspagem de páginas",
    "pricing.matrixArchOther": "Raspador de tela DOM",
    "pricing.matrixArchOtherSub": "Quebra com alterações na interface do Meet",
    "pricing.matrixArchExt": "Raspador de tela DOM",
    "pricing.matrixArchExtSub": "Quebra com alterações na interface do Meet",
    "pricing.matrixArchNative": "Nuvem proprietária do Google",
    "pricing.matrixArchNativeSub": "Apenas organizador, e-mail pós-reunião",
    "pricing.matrixRowBrowsers": "Navegadores e dispositivos suportados",
    "pricing.matrixBrowsersOurs": "Todos os navegadores e dispositivos móveis",
    "pricing.matrixBrowsersOursSub": "Chrome, Edge, Safari, Firefox, Mac, Windows, iPads, Chromebooks gerenciados",
    "pricing.matrixBrowsersOther": "Apenas Chrome para computador",
    "pricing.matrixBrowsersOtherSub": "Sem Safari, Firefox ou iPad",
    "pricing.matrixBrowsersExt": "Apenas Chrome para computador",
    "pricing.matrixBrowsersExtSub": "Sem Safari, Firefox ou iPad",
    "pricing.matrixBrowsersNative": "Qualquer navegador",
    "pricing.matrixBrowsersNativeSub": "(Apenas edições superiores do Workspace)",
    "pricing.matrixRowTeam": "Licença para escolas e equipes",
    "pricing.matrixTeamOurs": "Preço fixo de $59/ano (Departamento)",
    "pricing.matrixTeamOursSub": "<strong>Professores ilimitados</strong> em todo o domínio (ou $149/ano Instituição)",
    "pricing.matrixTeamOther5": "$149/ano (5 vagas)",
    "pricing.matrixTeamOther20": "$499/ano (20 vagas)",
    "pricing.matrixTeamOtherSub": "Penalidade alta por usuário",
    "pricing.matrixTeamExt": "Não disponível",
    "pricing.matrixTeamExtSub": "Apenas licenças individuais por usuário",
    "pricing.matrixTeamNative": "Atualização de domínio do Workspace",
    "pricing.matrixTeamNativeSub": "Exige $4–$20/usuário/mês em todo o domínio",
    "pricing.matrixRowIndividual": "Preços individuais",
    "pricing.matrixIndivOurs": "$9.99 vitalício / $4.99/ano Edu",
    "pricing.matrixIndivOursSub": "Opção vitalícia de pagamento único; < 42¢/mês passe para educadores",
    "pricing.matrixIndivOther": "$39.00/ano recorrente",
    "pricing.matrixIndivOtherSub": "Sem opção vitalícia",
    "pricing.matrixIndivExt": "Grátis / $30.00/ano ($2.50/mês)",
    "pricing.matrixIndivExtSub": "Assinatura recorrente",
    "pricing.matrixIndivNative": "Incluído no Education Plus",
    "pricing.matrixIndivNativeSub": "Indisponível no Starter / Free",
    "pricing.matrixRowLms": "Sincronização com LMS",
    "pricing.matrixLmsOurs": "Google Classroom e Canvas com 1 clique",
    "pricing.matrixLmsOursSub": "Sincronização REST direta + CSV para Moodle",
    "pricing.matrixLmsOther": "Nenhum",
    "pricing.matrixLmsExt": "Nenhum",
    "pricing.matrixLmsNative": "Nenhum",
    "pricing.matrixLmsNativeSub": "Apenas inserção manual de notas",
    "pricing.matrixRowPast": "Recuperação de reuniões anteriores",
    "pricing.matrixPastOurs": "Importação retroativa de 14 dias",
    "pricing.matrixPastOursSub": "Via conferenceRecords mesmo se o painel estiver fechado",
    "pricing.matrixPastOther": "Limite vitalício de 30 reuniões",
    "pricing.matrixPastOtherSub": "Deve ser registrado ao vivo",
    "pricing.matrixPastExt": "Nenhum",
    "pricing.matrixPastExtSub": "Perdido se a aba for fechada",
    "pricing.matrixPastNative": "Nenhum",
    "pricing.matrixPastNativeSub": "Sem sincronização retroativa",
    "pricing.matrixRowRails": "Métodos de pagamento regionais",
    "pricing.matrixRailsOurs": "Moedas e carteiras digitais locais",
    "pricing.matrixRailsOursSub": "Carteiras locais: UPI (₹299), GCash/Maya (₱280), QRIS (Rp 78k), FPX (RM 22)",
    "pricing.matrixRailsOther": "Apenas cartão de crédito em USD",
    "pricing.matrixRailsExt": "Apenas cartão de crédito em USD",
    "pricing.matrixRailsNative": "Fatura do Workspace Enterprise",
    "pricing.matrixRowLanguages": "Idiomas suportados",
    "pricing.matrixLanguagesOurs": "60 idiomas nativos",
    "pricing.matrixLanguagesOursSub": "Detecção automática do idioma do navegador + seletor no app",
    "pricing.matrixLanguagesOther": "Apenas inglês",
    "pricing.matrixLanguagesExt": "Apenas inglês",
    "pricing.matrixLanguagesNative": "Interface padrão do Google",
    "lms.alertSignInRequired": "Faça login no painel principal para conceder permissões de escrita no Google Classroom.",
    "lms.failedToLoadCourses": "Falha ao carregar cursos",
    "lms.failedToLoadCoursesErr": "Falha ao carregar cursos: {err}",
    "lms.failedToLoadAssignments": "Falha ao carregar tarefas.",
    "lms.failedToLoadAssignmentsErr": "Falha ao carregar tarefas: {err}",
    "lms.failedToLoadCanvasCourses": "Falha ao carregar cursos do Canvas. Verifique URL e token.",
    "lms.canvasConnectionError": "Erro de conexão com o Canvas: {err}",
    "lms.connectionFailed": "Conexão falhou",
    "lms.failedToLoadCanvasAssignments": "Falha ao carregar tarefas do Canvas.",
    "lms.failedToLoadCanvasAssignmentsErr": "Falha ao carregar tarefas do Canvas: {err}",
    "lms.selectClassroomCourse": "Selecione um curso do Classroom.",
    "lms.classroomSyncFailed": "Falha na sincronização com o Classroom.",
    "lms.warningPrefix": "Aviso: {msg}",
    "lms.noStudentsMatchedRoster": "Nenhum aluno correspondeu à lista do curso.",
    "lms.selectCanvasCourse": "Selecione um curso do Canvas.",
    "lms.canvasSyncFailed": "Falha na sincronização com o Canvas.",
    "lms.noAttendeesMatchedCanvas": "Nenhum participante da reunião correspondeu a alunos da lista do Canvas.",
    "lms.errorPrefix": "Erro: {msg}",
    "lms.sessionExpired": "Sessão expirada",
    "lms.permissionRequired": "Permissão necessária"
  },
  fr: {
    "pricing.oneTime": "paiement unique",
    "history.downloadsLabel": "Téléchargements :",
    "history.downloadCertsTitle": "Générer des certificats de présence vérifiables pour les étudiants (Educator Pro)",
    "pricing.teacherMigrationBanner": "<strong>Vous migrez depuis Competitor ou un outil arrêté ?</strong> <a href=\"attendance-taker-for-classroom-alternative.html\" style=\"color:var(--blue);font-weight:600;text-decoration:underline;margin-left:4px\">Utilisez notre outil gratuit de migration en 5 secondes &rarr;</a>",
    "pricing.promoApplied": "🎁 Champ de code promo activé pour le paiement",
    "pricing.havePromoCode": "Vous avez un code promo ou de parrainage ?",
    "pricing.matrixColFeature": "Fonctionnalité / Capacité",
    "pricing.matrixBadgeOurs": "LE NÔTRE",
    "pricing.matrixColOtherAddons": "Autres modules Workspace",
    "pricing.matrixColExtensions": "Extensions de navigateur",
    "pricing.matrixColNative": "Intégré natif de Meet",
    "pricing.matrixRowArch": "Architecture",
    "pricing.matrixArchOurs": "API REST officielle Meet",
    "pricing.matrixArchOursSub": "100 % insensible au DOM, zéro scraping de page",
    "pricing.matrixArchOther": "Scraping d'écran DOM",
    "pricing.matrixArchOtherSub": "Casse aux modifications de Meet",
    "pricing.matrixArchExt": "Scraping d'écran DOM",
    "pricing.matrixArchExtSub": "Casse aux modifications de Meet",
    "pricing.matrixArchNative": "Cloud propriétaire Google",
    "pricing.matrixArchNativeSub": "Hôte uniquement, e-mail après réunion",
    "pricing.matrixRowBrowsers": "Navigateurs et appareils compatibles",
    "pricing.matrixBrowsersOurs": "Tous les navigateurs et mobiles",
    "pricing.matrixBrowsersOursSub": "Chrome, Edge, Safari, Firefox, Mac, Windows, iPads, Chromebooks gérés",
    "pricing.matrixBrowsersOther": "Chrome bureau uniquement",
    "pricing.matrixBrowsersOtherSub": "Pas de Safari, Firefox ou iPad",
    "pricing.matrixBrowsersExt": "Chrome bureau uniquement",
    "pricing.matrixBrowsersExtSub": "Pas de Safari, Firefox ou iPad",
    "pricing.matrixBrowsersNative": "Tout navigateur",
    "pricing.matrixBrowsersNativeSub": "(Éditions supérieures Workspace uniquement)",
    "pricing.matrixRowTeam": "Licence équipe ou établissement",
    "pricing.matrixTeamOurs": "Tarif fixe de 59 $/an (Département)",
    "pricing.matrixTeamOursSub": "<strong>Enseignants illimités</strong> sur tout le domaine (ou 149 $/an Établissement)",
    "pricing.matrixTeamOther5": "149 $/an (5 sièges)",
    "pricing.matrixTeamOther20": "499 $/an (20 sièges)",
    "pricing.matrixTeamOtherSub": "Forte pénalité par utilisateur",
    "pricing.matrixTeamExt": "Non proposé",
    "pricing.matrixTeamExtSub": "Licences individuelles par utilisateur uniquement",
    "pricing.matrixTeamNative": "Mise à niveau de domaine Workspace",
    "pricing.matrixTeamNativeSub": "Exige 4 à 20 $/utilisateur/mois sur tout le domaine",
    "pricing.matrixRowIndividual": "Tarifs individuels",
    "pricing.matrixIndivOurs": "9,99 $ à vie / 4,99 $/an Éducateur",
    "pricing.matrixIndivOursSub": "Option à vie sans récurrence ; < 42¢/mois passe éducateur",
    "pricing.matrixIndivOther": "39,00 $/an récurrent",
    "pricing.matrixIndivOtherSub": "Aucune option à vie",
    "pricing.matrixIndivExt": "Gratuit / 30,00 $/an (2,50 $/mois)",
    "pricing.matrixIndivExtSub": "Abonnement récurrent",
    "pricing.matrixIndivNative": "Inclus dans Education Plus",
    "pricing.matrixIndivNativeSub": "Indisponible sur Starter / Gratuit",
    "pricing.matrixRowLms": "Rapport de notes LMS",
    "pricing.matrixLmsOurs": "Google Classroom et Canvas en 1 clic",
    "pricing.matrixLmsOursSub": "Synchronisation directe REST + CSV Moodle",
    "pricing.matrixLmsOther": "Aucun",
    "pricing.matrixLmsExt": "Aucun",
    "pricing.matrixLmsNative": "Aucun",
    "pricing.matrixLmsNativeSub": "Saisie manuelle des notes uniquement",
    "pricing.matrixRowPast": "Récupération des réunions passées",
    "pricing.matrixPastOurs": "Import rétroactif sur 14 jours",
    "pricing.matrixPastOursSub": "Via conferenceRecords même si le panneau était fermé",
    "pricing.matrixPastOther": "Limite à vie de 30 réunions",
    "pricing.matrixPastOtherSub": "Doit être enregistré en direct",
    "pricing.matrixPastExt": "Aucun",
    "pricing.matrixPastExtSub": "Perdu si l'onglet est fermé",
    "pricing.matrixPastNative": "Aucun",
    "pricing.matrixPastNativeSub": "Aucune synchronisation rétroactive",
    "pricing.matrixRowRails": "Moyens de paiement régionaux",
    "pricing.matrixRailsOurs": "Devises et portefeuilles locaux",
    "pricing.matrixRailsOursSub": "Portefeuilles locaux : UPI (₹299), GCash/Maya (₱280), QRIS (Rp 78k), FPX (RM 22)",
    "pricing.matrixRailsOther": "Carte bancaire en USD uniquement",
    "pricing.matrixRailsExt": "Carte bancaire en USD uniquement",
    "pricing.matrixRailsNative": "Facture Workspace Enterprise",
    "pricing.matrixRowLanguages": "Langues prises en charge",
    "pricing.matrixLanguagesOurs": "60 langues traduites",
    "pricing.matrixLanguagesOursSub": "Détection automatique de la langue du navigateur + sélecteur intégré",
    "pricing.matrixLanguagesOther": "Anglais uniquement",
    "pricing.matrixLanguagesExt": "Anglais uniquement",
    "pricing.matrixLanguagesNative": "Interface Google standard",
    "lms.alertSignInRequired": "Veuillez vous connecter depuis le panneau principal pour accorder les autorisations d'écriture Google Classroom.",
    "lms.failedToLoadCourses": "Échec du chargement des cours",
    "lms.failedToLoadCoursesErr": "Échec du chargement des cours : {err}",
    "lms.failedToLoadAssignments": "Échec du chargement des devoirs.",
    "lms.failedToLoadAssignmentsErr": "Échec du chargement des devoirs : {err}",
    "lms.failedToLoadCanvasCourses": "Échec du chargement des cours Canvas. Vérifiez l'URL et le jeton.",
    "lms.canvasConnectionError": "Erreur de connexion à Canvas : {err}",
    "lms.connectionFailed": "Échec de connexion",
    "lms.failedToLoadCanvasAssignments": "Échec du chargement des devoirs Canvas.",
    "lms.failedToLoadCanvasAssignmentsErr": "Échec du chargement des devoirs Canvas : {err}",
    "lms.selectClassroomCourse": "Veuillez sélectionner un cours Classroom.",
    "lms.classroomSyncFailed": "Échec de synchronisation Classroom.",
    "lms.warningPrefix": "Avertissement : {msg}",
    "lms.noStudentsMatchedRoster": "Aucun élève ne correspond à la liste du cours.",
    "lms.selectCanvasCourse": "Veuillez sélectionner un cours Canvas.",
    "lms.canvasSyncFailed": "Échec de synchronisation Canvas.",
    "lms.noAttendeesMatchedCanvas": "Aucun participant à la réunion ne correspond aux élèves du cours Canvas.",
    "lms.errorPrefix": "Erreur : {msg}",
    "lms.sessionExpired": "Session expirée",
    "lms.permissionRequired": "Autorisation requise"
  },
  de: {
    "pricing.oneTime": "einmalig",
    "history.downloadsLabel": "Downloads:",
    "history.downloadCertsTitle": "Überprüfbare Schüler-Anwesenheitszertifikate erstellen (Educator Pro)",
    "pricing.teacherMigrationBanner": "<strong>Wechseln Sie von Competitor oder einem eingestellten Tool?</strong> <a href=\"attendance-taker-for-classroom-alternative.html\" style=\"color:var(--blue);font-weight:600;text-decoration:underline;margin-left:4px\">Nutzen Sie unser kostenloses 5-Sekunden-Migrations-Tool &rarr;</a>",
    "pricing.promoApplied": "🎁 Gutscheincode-Feld für den Checkout aktiviert",
    "pricing.havePromoCode": "Haben Sie einen Gutschein- oder Empfehlungscode?",
    "pricing.matrixColFeature": "Funktion / Merkmal",
    "pricing.matrixBadgeOurs": "UNSERES",
    "pricing.matrixColOtherAddons": "Andere Workspace-Add-ons",
    "pricing.matrixColExtensions": "Browser-Erweiterungen",
    "pricing.matrixColNative": "Nativ in Meet integriert",
    "pricing.matrixRowArch": "Architektur",
    "pricing.matrixArchOurs": "Offizielle Meet REST API",
    "pricing.matrixArchOursSub": "100 % DOM-immun, kein Screen-Scraping",
    "pricing.matrixArchOther": "DOM Screen Scraper",
    "pricing.matrixArchOtherSub": "Bricht bei Meet-Updates ab",
    "pricing.matrixArchExt": "DOM Screen Scraper",
    "pricing.matrixArchExtSub": "Bricht bei Meet-Updates ab",
    "pricing.matrixArchNative": "Google Cloud nativ",
    "pricing.matrixArchNativeSub": "Nur Host, E-Mail nach Meeting",
    "pricing.matrixRowBrowsers": "Unterstützte Browser & Geräte",
    "pricing.matrixBrowsersOurs": "Jeder Browser & Mobilgeräte",
    "pricing.matrixBrowsersOursSub": "Chrome, Edge, Safari, Firefox, Mac, Windows, iPads, verwaltete Chromebooks",
    "pricing.matrixBrowsersOther": "Nur Chrome Desktop",
    "pricing.matrixBrowsersOtherSub": "Kein Safari, Firefox oder iPad",
    "pricing.matrixBrowsersExt": "Nur Chrome Desktop",
    "pricing.matrixBrowsersExtSub": "Kein Safari, Firefox oder iPad",
    "pricing.matrixBrowsersNative": "Jeder Browser",
    "pricing.matrixBrowsersNativeSub": "(Nur höhere Workspace-Tarife)",
    "pricing.matrixRowTeam": "Team- / Schullizenz",
    "pricing.matrixTeamOurs": "59 $/Jahr Pauschale (Fachbereich)",
    "pricing.matrixTeamOursSub": "<strong>Unbegrenzte Lehrkräfte</strong> domänenweit (oder 149 $/Jahr Schule)",
    "pricing.matrixTeamOther5": "149 $/Jahr (5 Lizenzen)",
    "pricing.matrixTeamOther20": "499 $/Jahr (20 Lizenzen)",
    "pricing.matrixTeamOtherSub": "Hohe Kosten pro Nutzer",
    "pricing.matrixTeamExt": "Nicht angeboten",
    "pricing.matrixTeamExtSub": "Nur Einzelplatzlizenzen pro Nutzer",
    "pricing.matrixTeamNative": "Workspace Domain-Upgrade",
    "pricing.matrixTeamNativeSub": "Erfordert 4–20 $/Nutzer/Monat domänenweit",
    "pricing.matrixRowIndividual": "Preise für Einzelpersonen",
    "pricing.matrixIndivOurs": "9,99 $ lebenslang / 4,99 $/Jahr Edu",
    "pricing.matrixIndivOursSub": "Einmalzahlung ohne Abo; < 42¢/Monat Educator-Pass",
    "pricing.matrixIndivOther": "39,00 $/Jahr wiederkehrend",
    "pricing.matrixIndivOtherSub": "Keine Einmalkauf-Option",
    "pricing.matrixIndivExt": "Kostenlos / 30,00 $/Jahr (2,50 $/Monat)",
    "pricing.matrixIndivExtSub": "Wiederkehrendes Abonnement",
    "pricing.matrixIndivNative": "In Education Plus enthalten",
    "pricing.matrixIndivNativeSub": "Nicht verfügbar bei Starter / Kostenlos",
    "pricing.matrixRowLms": "LMS-Notensynchronisierung",
    "pricing.matrixLmsOurs": "1-Klick Google Classroom & Canvas",
    "pricing.matrixLmsOursSub": "Direkte REST-Notensynchronisierung + Moodle-CSV",
    "pricing.matrixLmsOther": "Keine",
    "pricing.matrixLmsExt": "Keine",
    "pricing.matrixLmsNative": "Keine",
    "pricing.matrixLmsNativeSub": "Nur manuelle Noteneingabe",
    "pricing.matrixRowPast": "Wiederherstellung vergangener Meetings",
    "pricing.matrixPastOurs": "14 Tage rückwirkender Import",
    "pricing.matrixPastOursSub": "Über conferenceRecords auch bei geschlossenem Panel",
    "pricing.matrixPastOther": "30 Meetings Lebenszeitlimit",
    "pricing.matrixPastOtherSub": "Muss live aufgezeichnet werden",
    "pricing.matrixPastExt": "Keine",
    "pricing.matrixPastExtSub": "Geht verloren, wenn Tab geschlossen wird",
    "pricing.matrixPastNative": "Keine",
    "pricing.matrixPastNativeSub": "Kein nachträglicher Abruf",
    "pricing.matrixRowRails": "Regionale Zahlungsmethoden",
    "pricing.matrixRailsOurs": "Lokale Währungen & Wallets",
    "pricing.matrixRailsOursSub": "Lokale Wallets: UPI (₹299), GCash/Maya (₱280), QRIS (Rp 78k), FPX (RM 22)",
    "pricing.matrixRailsOther": "Nur USD-Kreditkarte",
    "pricing.matrixRailsExt": "Nur USD-Kreditkarte",
    "pricing.matrixRailsNative": "Workspace Enterprise Rechnung",
    "pricing.matrixRowLanguages": "Unterstützte Sprachen",
    "pricing.matrixLanguagesOurs": "60 lokalisierte Sprachen",
    "pricing.matrixLanguagesOursSub": "Automatische Erkennung der Browsersprache + In-App-Wechsler",
    "pricing.matrixLanguagesOther": "Nur Englisch",
    "pricing.matrixLanguagesExt": "Nur Englisch",
    "pricing.matrixLanguagesNative": "Standard-Google-Oberfläche",
    "lms.alertSignInRequired": "Bitte melden Sie sich im Hauptbereich an, um Schreibberechtigungen für Google Classroom zu erteilen.",
    "lms.failedToLoadCourses": "Kurse konnten nicht geladen werden",
    "lms.failedToLoadCoursesErr": "Kurse konnten nicht geladen werden: {err}",
    "lms.failedToLoadAssignments": "Aufgaben konnten nicht geladen werden.",
    "lms.failedToLoadAssignmentsErr": "Aufgaben konnten nicht geladen werden: {err}",
    "lms.failedToLoadCanvasCourses": "Canvas-Kurse konnten nicht geladen werden. Bitte URL und Token prüfen.",
    "lms.canvasConnectionError": "Canvas-Verbindungsfehler: {err}",
    "lms.connectionFailed": "Verbindung fehlgeschlagen",
    "lms.failedToLoadCanvasAssignments": "Canvas-Aufgaben konnten nicht geladen werden.",
    "lms.failedToLoadCanvasAssignmentsErr": "Canvas-Aufgaben konnten nicht geladen werden: {err}",
    "lms.selectClassroomCourse": "Bitte wählen Sie einen Classroom-Kurs aus.",
    "lms.classroomSyncFailed": "Classroom-Synchronisierung fehlgeschlagen.",
    "lms.warningPrefix": "Warnung: {msg}",
    "lms.noStudentsMatchedRoster": "Keine Schüler stimmten mit der Kursliste überein.",
    "lms.selectCanvasCourse": "Bitte wählen Sie einen Canvas-Kurs aus.",
    "lms.canvasSyncFailed": "Canvas-Synchronisierung fehlgeschlagen.",
    "lms.noAttendeesMatchedCanvas": "Keine Meeting-Teilnehmer stimmten mit Schülern der Canvas-Kursliste überein.",
    "lms.errorPrefix": "Fehler: {msg}",
    "lms.sessionExpired": "Sitzung abgelaufen",
    "lms.permissionRequired": "Berechtigung erforderlich"
  }
};

const LMS_SYNC_PRO_TRANSLATIONS = {
  es: "La sincronización de calificaciones directamente con Google Classroom y Canvas requiere un plan Educador o Pro.",
  pt: "A sincronização de notas diretamente com o Google Classroom e o Canvas requer um plano Educador ou Pro.",
  fr: "La synchronisation des notes directement avec Google Classroom et Canvas nécessite un forfait Éducateur ou Pro.",
  de: "Die direkte Synchronisierung von Noten mit Google Classroom und Canvas erfordert einen Educator- oder Pro-Plan.",
  it: "La sincronizzazione dei voti direttamente su Google Classroom e Canvas richiede un piano Educator o Pro.",
  nl: "Het rechtstreeks synchroniseren van cijfers naar Google Classroom en Canvas vereist een Educator- of Pro-abonnement.",
  ja: "Google ClassroomおよびCanvasへの成績の直接同期には、EducatorまたはProプランが必要です。",
  ko: "Google 클래스룸 및 Canvas로 성적을 직접 동기화하려면 Educator 또는 Pro 플랜이 필요합니다.",
  zh: "直接同步成績至 Google Classroom 與 Canvas 需要 Educator 或 Pro 方案。",
  "zh-CN": "直接同步成绩至 Google Classroom 和 Canvas 需要 Educator 或 Pro 方案。",
  hi: "Google Classroom और Canvas में सीधे ग्रेड सिंक करने के लिए Educator या Pro प्लान आवश्यक है।",
  ar: "تتطلب مزامنة الدرجات مباشرة مع Google Classroom و Canvas خطة المعلم أو Pro.",
  ru: "Для прямой синхронизации оценок с Google Classroom и Canvas требуется тариф Educator или Pro.",
  tr: "Notları doğrudan Google Classroom ve Canvas ile senkronize etmek için Educator veya Pro planı gerekir.",
  id: "Sinkronisasi nilai langsung ke Google Classroom dan Canvas memerlukan paket Educator atau Pro.",
  tl: "Ang direktang pag-sync ng mga marka sa Google Classroom at Canvas ay nangangailangan ng Educator o Pro plan.",
  vi: "Đồng bộ điểm trực tiếp với Google Classroom và Canvas yêu cầu gói Giáo viên hoặc Pro.",
  pl: "Bezpośrednia synchronizacja ocen z Google Classroom i Canvas wymaga planu Educator lub Pro.",
  uk: "Для прямої синхронізації оцінок із Google Classroom та Canvas потрібен тариф Educator або Pro.",
  th: "การซิงค์เกรดไปยัง Google Classroom และ Canvas โดยตรงต้องใช้แผน Educator หรือ Pro",
  ms: "Penyelarasan gred terus ke Google Classroom dan Canvas memerlukan pelan Educator atau Pro.",
  sv: "Direkt synkronisering av betyg till Google Classroom och Canvas kräver en Educator- eller Pro-plan.",
  da: "Direkte synkronisering af karakterer til Google Classroom og Canvas kræver en Educator- eller Pro-plan.",
  fi: "Arvosanojen suora synkronointi Google Classroomiin ja Canvasiin vaatii Educator- tai Pro-tilauksen.",
  no: "Direkte synkronisering av karakterer til Google Classroom og Canvas krever en Educator- eller Pro-plan.",
  cs: "Přímá synchronizace známek do Google Classroom a Canvas vyžaduje plán Educator nebo Pro.",
  hu: "A jegyek közvetlen szinkronizálása a Google Classroomba és a Canvasba Educator vagy Pro csomagot igényel.",
  el: "Ο άμεσος συγχρονισμός βαθμών με το Google Classroom και το Canvas απαιτεί πρόγραμμα Educator ή Pro.",
  ro: "Sincronizarea directă a notelor în Google Classroom și Canvas necesită un plan Educator sau Pro.",
  bg: "Директното синхронизиране на оценки с Google Classroom и Canvas изисква план Educator или Pro.",
  he: "סנכרון ציונים ישירות ל-Google Classroom ו-Canvas דורש תוכנית Educator או Pro.",
  bn: "সরাসরি Google Classroom এবং Canvas-এ গ্রেড সিঙ্ক করার জন্য একটি Educator বা Pro প্ল্যান প্রয়োজন।",
  ta: "Google Classroom மற்றும் Canvas-ல் நேரடியாக மதிப்பெண்களை ஒத்திசைக்க Educator அல்லது Pro திட்டம் தேவை.",
  te: "Google Classroom మరియు Canvas కు నేరుగా గ్రేడ్‌లను సమకాలీకరించడానికి Educator లేదా Pro ప్లాన్ అవసరం.",
  mr: "Google Classroom आणि Canvas वर थेट ग्रेड सिंक करण्यासाठी Educator किंवा Pro प्लॅन आवश्यक आहे.",
  ur: "براہ راست Google Classroom اور Canvas میں گریڈز سنک کرنے کے لیے Educator یا Pro پلان درکار ہے۔",
  fa: "همگام‌سازی مستقیم نمرات با Google Classroom و Canvas به طرح Educator یا Pro نیاز دارد.",
  sw: "Kulandanisha alama moja kwa moja kwenye Google Classroom na Canvas kunahitaji mpango wa Educator au Pro.",
  ca: "La sincronització directa de qualificacions amb Google Classroom i Canvas requereix un pla Educator o Pro.",
  hr: "Izravna sinkronizacija ocjena s Google Classroomom i Canvasom zahtijeva plan Educator ili Pro.",
  sr: "Директна синхронизација оцена са Google Classroom-ом и Canvas-ом захтева Educator или Pro план.",
  sk: "Priama synchronizácia známok do Google Classroom a Canvas vyžaduje plán Educator alebo Pro.",
  sl: "Neposredna sinhronizacija ocen v Google Classroom in Canvas zahteva paket Educator ali Pro.",
  lv: "Tiešai vērtējumu sinhronizēšanai ar Google Classroom un Canvas ir nepieciešams Educator vai Pro plāns.",
  lt: "Tiesioginiam pažymių sinchronizavimui su „Google Classroom“ ir „Canvas“ reikalingas „Educator“ arba „Pro“ planas.",
  et: "Hinsete otse sünkroonimine Google Classroomi ja Canvasega nõuab Educator või Pro paketti.",
  ceb: "Ang direktang pag-sync sa mga grado sa Google Classroom ug Canvas nagkinahanglan og Educator o Pro nga plano.",
  kk: "Бағаларды Google Classroom және Canvas жүйелеріне тікелей синхрондау үшін Educator немесе Pro жоспары қажет.",
  lo: "ການຊິ້ງຄະແນນໂດຍກົງໃສ່ Google Classroom ແລະ Canvas ຕ້ອງການແຜນ Educator ຫຼື Pro.",
  my: "အမှတ်များကို Google Classroom နှင့် Canvas သို့ တိုက်ရိုက်ချိတ်ဆက်ရန် Educator သို့မဟုတ် Pro အစီအစဉ် လိုအပ်ပါသည်။",
  km: "ការធ្វើសមកាលកម្មពិន្ទុដោយផ្ាល់ទៅ Google Classroom និង Canvas ទាមទារគម្រោង Educator ឬ Pro។",
  kn: "Google Classroom ಮತ್ತು Canvas ಗೆ ನೇರವಾಗಿ ಗ್ರೇಡ್‌ಗಳನ್ನು ಸಿಂಕ್ ಮಾಡಲು Educator ಅಥವಾ Pro ಯೋಜನೆ ಅಗತ್ಯವಿದೆ.",
  gu: "Google Classroom અને Canvas માં સીધા ગ્રેડ સમન્વયિત કરવા માટે Educator અથવા Pro પ્લાન જરૂરી છે.",
  pa: "Google Classroom ਅਤੇ Canvas ਵਿੱਚ ਸਿੱਧੇ ਗ੍ਰੇਡ ਸਿੰਕ ਕਰਨ ਲਈ ਇੱਕ Educator ਜਾਂ Pro ਪਲਾਨ ਦੀ ਲੋੜ ਹੈ।",
  ml: "Google Classroom, Canvas എന്നിവയിലേക്ക് ഗ്രേഡുകൾ നേരിട്ട് സമന്വയിപ്പിക്കുന്നതിന് Educator അല്ലെങ്കിൽ Pro പ്ലാൻ ആവശ്യമാണ്.",
  so: "Isku-xiridda darajooyinka si toos ah Google Classroom iyo Canvas waxay u baahan tahay qorshaha Educator ama Pro.",
  am: "ውጤቶችን በቀጥታ ወደ Google Classroom እና Canvas ማመሳሰል የ Educator ወይም Pro ዕቅድ ይጠይቃል።",
  si: "Google Classroom සහ Canvas වෙත සෘජුවම ලකුණු සමමුහුර්ත කිරීමට Educator හෝ Pro සැලැස්මක් අවශ්‍ය වේ.",
  ne: "Google Classroom र Canvas मा सिधै ग्रेड सिङ्क गर्न Educator वा Pro योजना आवश्यक छ।",
  af: "Om punte direk na Google Classroom en Canvas te sinkroniseer vereis ’n Educator- of Pro-plan."
};

const SINGLE_ALT_PREFIX_TRANSLATIONS = {
  es: "¿Solo necesitas esta reunión? Desbloquear por",
  pt: "Só precisa desta reunião? Desbloquear por",
  hi: "केवल इस मीटिंग की आवश्यकता है? इसके लिए अनलॉक करें",
  tl: "Kailangan lang ba ang pulong na ito? I-unlock sa halagang",
  ms: "Hanya perlukan mesyuarat ini? Buka kunci untuk",
  id: "Hanya butuh pertemuan ini? Buka kunci seharga",
  vi: "Chỉ cần cuộc họp này? Mở khóa với giá",
  fr: "Besoin uniquement de cette réunion ? Débloquer pour",
  de: "Nur dieses eine Meeting benötigt? Freischalten für",
  it: "Serve solo questa riunione? Sblocca per",
  nl: "Alleen deze vergadering nodig? Ontgrendel voor",
  pl: "Potrzebujesz tylko tego spotkania? Odblokuj za",
  ro: "Ai nevoie doar de această întâlnire? Deblochează pentru",
  ru: "Нужна только эта встреча? Разблокировать за",
  uk: "Потрібна лише ця зустріч? Розблокувати за",
  tr: "Yalnızca bu toplantıya mı ihtiyacınız var? Şunun için açın:",
  th: "ต้องการเพียงการประชุมนี้หรือไม่? ปลดล็อกสำหรับ",
  ar: "هل تحتاج إلى هذا الاجتماع فقط؟ افتح مقابل",
  ko: "이 모임만 필요하신가요? 잠금 해제:",
  zh: "只需要此單次會議？解鎖僅需",
  "zh-CN": "只需要此单次会议？解锁仅需",
  ja: "このミーティングのみ必要ですか？ロック解除:",
  he: "צריך רק את הפגישה הזו? בטל נעילה עבור",
  mr: "फक्त या मीटिंगची गरज आहे? अनलॉक करा",
  sv: "Behöver du bara detta möte? Lås upp för",
  cs: "Potřebujete jen tuto schůzku? Odemknout za",
  da: "Har du kun brug for dette møde? Lås op for",
  fi: "Tarvitsetko vain tämän kokouksen? Avaa lukitus hintaan",
  hu: "Csak erre a megbeszélésre van szüksége? Feloldás:",
  so: "Ma u baahan tahay kulankan kaliya? Ku fur",
  sw: "Unahitaji mkutano huu pekee? Fungua kwa",
  am: "ይህ ስብሰባ ብቻ ይፈልጋሉ? ይክፈቱ በ",
  si: "මෙම රැස්වීම පමණක් අවශ්‍යද? අගුළු හරින්න",
  el: "Χρειάζεστε μόνο αυτή τη συνάντηση; Ξεκλείδωμα για",
  no: "Trenger du bare dette møtet? Lås opp for",
  ca: "Només necessiteu aquesta reunió? Desbloqueja per",
  ne: "यो बैठक मात्र चाहिन्छ? को लागि अनलक गर्नुहोस्",
  ml: "ഈ മീറ്റിംഗ് മാത്രം മതിയോ? അൺലോക്ക് ചെയ്യുക",
  mn: "Зөвхөн энэ уулзалт хэрэгтэй юу? Түгжээ тайлах:",
  bn: "শুধু এই মিটিংটি প্রয়োজন? আনলক করুন",
  ta: "இந்த மீட்டிங் மட்டும் தேவையா? அன்லாக் செய்ய",
  te: "ఈ మీటింగ్ మాత్రమే అవసరమా? అన్‌లాక్ చేయండి",
  ur: "صرف اس میٹنگ کی ضرورت ہے؟ انلاک کریں برائے",
  fa: "فقط به این جلسه نیاز دارید؟ باز کردن برای",
  hr: "Trebate samo ovaj sastanak? Otključajte za",
  sr: "Потребан вам је само овај састанак? Откључајте за",
  sk: "Potrebujete len toto stretnutie? Odomknúť za",
  sl: "Potrebujete samo ta sestanek? Odklenite za",
  lv: "Nepieciešama tikai šī sanāksme? Atbloķēt par",
  lt: "Reikia tik šio susitikimo? Atrakinkite už",
  et: "Vajate ainult seda koosolekut? Avage hinnaga",
  ceb: "Kinahanglan ra kini nga miting? I-unlock sa",
  kk: "Тек осы кездесу қажет пе? Құлпын ашыңыз:",
  lo: "ຕ້ອງການພຽງແຕ່ກອງປະຊຸມນີ້ບໍ? ປົດລັອກສຳລັບ",
  my: "ဤအစည်းအဝေးတစ်ခုသာ လိုအပ်ပါသလား။ အတွက် ဖွင့်ပါ",
  km: "ត្រូវការតែការប្រជុំនេះប៉ុណ្ណោះមែនទេ? ដោះសោសម្រាប់",
  kn: "ಈ ಸಭೆ ಮಾತ್ರ ಅಗತ್ಯವಿದೆಯೇ? ಅನ್‌ಲಾಕ್ ಮಾಡಿ",
  gu: "માત્ર આ મીટિંગની જરૂર છે? અનલૉક કરો",
  pa: "ਸਿਰਫ਼ ਇਸ ਮੀਟਿੰਗ ਦੀ ਲੋੜ ਹੈ? ਅਨਲੌਕ ਕਰੋ",
  af: "Benodig net hierdie een vergadering? Ontsluit vir",
  bg: "Нуждаете се само от тази среща? Отключете за",
};

const GRACE_USED_TRANSLATIONS = {
  es: "🎉 Exportación completa de cortesía: ¡Desbloqueamos a los {count} asistentes para tu primera clase grande! Actualiza a Educator para clases ilimitadas en el futuro.",
  pt: "🎉 Exportação completa cortesia: Desbloqueamos todos os {count} participantes para sua primeira turma grande! Atualize para Educator para turmas ilimitadas no futuro.",
  hi: "🎉 मानार्थ पूर्ण-रोस्टर निर्यात: हमने आपकी पहली बड़ी कक्षा के लिए सभी {count} उपस्थित लोगों को अनलॉक कर दिया है! भविष्य में असीमित कक्षाओं के लिए Educator में अपग्रेड करें।",
  tl: "🎉 Libreng Buong Talaan ng Export: Na-unlock namin ang lahat ng {count} dumalo para sa iyong unang malaking klase! Mag-upgrade sa Educator para sa walang limitasyong mga klase sa hinaharap.",
  ms: "🎉 Eksport Senarai Penuh Percuma: Kami membuka kunci semua {count} peserta untuk kelas besar pertama anda! Naik taraf ke Educator untuk kelas tanpa had pada masa hadapan.",
  id: "🎉 Ekspor Daftar Lengkap Gratis: Kami membuka kunci semua {count} peserta untuk kelas besar pertama Anda! Tingkatkan ke Educator untuk ukuran kelas tak terbatas di masa mendatang.",
  vi: "🎉 Xuất danh sách đầy đủ miễn phí: Chúng tôi đã mở khóa tất cả {count} người tham dự cho lớp học lớn đầu tiên của bạn! Nâng cấp lên Giáo viên cho các lớp học tương lai không giới hạn.",
  fr: "🎉 Exportation complète offerte : Nous avons débloqué les {count} participants pour votre première grande classe ! Passez à Educator pour des tailles de classe illimitées.",
  de: "🎉 Kostenloser vollständiger Roster-Export: Wir haben alle {count} Teilnehmer für Ihre erste große Klasse freigeschaltet! Upgraden Sie auf Educator für unbegrenzte Klassengrößen.",
  it: "🎉 Esportazione completa omaggio: Abbiamo sbloccato tutti i {count} partecipanti per la tua prima grande classe! Passa a Educator per classi illimitate.",
  nl: "🎉 Gratis volledige rooster-export: We hebben alle {count} deelnemers ontgrendeld voor je eerste grote klas! Upgrade naar Educator voor onbeperkte klasgroottes.",
  pl: "🎉 Bezpłatny pełny eksport listy: Odblokowaliśmy wszystkich {count} uczestników na Twoje pierwsze duże zajęcia! Przejdź na Educator na przyszłość.",
  ro: "🎉 Export complet gratuit: Am deblocat toți cei {count} participanți pentru prima dvs. clasă mare! Faceți upgrade la Educator pentru clase nelimitate.",
  ru: "🎉 Бесплатный полный экспорт: Мы разблокировали всех {count} участников для вашего первого большого занятия! Перейдите на Educator для неограниченных классов.",
  uk: "🎉 Безкоштовний повний експорт: Ми розблокували всіх {count} учасників для вашого першого великого заняття! Оновіть до Educator для необмежених класів.",
  tr: "🎉 Ücretsiz Tam Liste Dışa Aktarma: İlk büyük sınıfınız için {count} katılımcının tamamının kilidini açtık! Sınırsız sınıf boyutları için Educator planına yükseltin.",
  th: "🎉 ส่งออกรายชื่อเต็มฟรี: เราได้ปลดล็อกผู้เข้าร่วมทั้งหมด {count} คนสำหรับชั้นเรียนขนาดใหญ่ครั้งแรกของคุณ! อัปเกรดเป็น Educator สำหรับขนาดชั้นเรียนไม่จำกัด",
  ar: "🎉 تصدير مجاني للقائمة الكاملة: لقد فتحنا جميع الحاضرين البالغ عددهم {count} لفصلك الكبير الأول! قم بالترقية إلى Educator لأحجام فصول غير محدودة.",
  ko: "🎉 무료 전체 명단 내보내기: 첫 번째 대규모 수업의 참석자 {count}명을 모두 잠금 해제했습니다! 향후 무제한 수업을 위해 Educator로 업그레이드하세요.",
  zh: "🎉 免費完整名單匯出：我們已為您的首次大型課程解鎖所有 {count} 位出席者！升級至 Educator 即可在未來享有無限制班級人數。",
  "zh-CN": "🎉 免费完整名单导出：我们已为您的首次大型课程解锁所有 {count} 位出席者！升级至 Educator 即可在未来享有无限制班级人数。",
  ja: "🎉 無料の完全な名簿エクスポート: 最初の大きなクラスの参加者 {count} 人全員のロックを解除しました! 今後の無制限のクラスのために Educator にアップグレードしてください。",
  he: "🎉 ייצוא רשימה מלאה בחינם: ביטלנו את הנעילה של כל {count} המשתתפים עבור הכיתה הגדולה הראשונה שלך! שדרג ל-Educator עבור כיתות ללא הגבלה.",
  mr: "🎉 मानार्थ पूर्ण-रोस्टर निर्यात: आम्ही तुमच्या पहिल्या मोठ्या वर्गासाठी सर्व {count} उपस्थितांना अनलॉक केले आहे! भविष्यातील अमर्यादित वर्गांसाठी Educator वर अपग्रेड करा.",
  sv: "🎉 Kostnadsfri fullständig export: Vi har låst upp alla {count} deltagare för din första stora klass! Uppgradera till Educator för obegränsade framtida klasser.",
  cs: "🎉 Bezplatný úplný export: Odemkli jsme všech {count} účastníků pro vaši první velkou třídu! Upgradujte na Educator pro neomezené budoucí třídy.",
  da: "🎉 Gratis fuld eksport: Vi har låst op for alle {count} deltagere til din første store klasse! Opgrader til Educator for ubegrænsede klasser i fremtiden.",
  fi: "🎉 Ilmainen täysi vienti: Avasimme kaikki {count} osallistujaa ensimmäiselle suurelle luokallesi! Päivitä Educator-tilaukseen rajattomia luokkakokoja varten.",
  hu: "🎉 Ingyenes teljes névsor-exportálás: Feloldottuk mind a(z) {count} résztvevőt az első nagy órájához! Váltson Educator csomagra a jövőbeli korlátlan méretekért.",
  so: "🎉 Dhoofinta Liiska Buuxa oo Bilaash ah: Waxaan furnay dhammaan {count} kaqaybgalayaasha fasalkaaga weyn ee ugu horreeya! U cusboonaysii Educator fasallo aan xadidnayn.",
  sw: "🎉 Uhamishaji Kamili wa Orodha Bila Malipo: Tumefungua wahudhuriaji wote {count} kwa darasa lako kubwa la kwanza! Pata daraja la Educator kwa madarasa yasiyo na kikomo.",
  am: "🎉 ነፃ ሙሉ ዝርዝር ኤክስፖርት፡ ለመጀመሪያው ትልቅ ክፍልዎ ሁሉንም {count} ተሳታፊዎች ከፍተናል! ወደ Educator ያሻሽሉ።",
  si: "🎉 නොමිලේ සම්පූර්ණ ලැයිස්තු අපනයනය: ඔබගේ පළමු විශාල පන්තිය සඳහා සහභාගී වූවන් {count} දෙනාම අපි අගුළු හැරියෙමු! අනාගත අසීමිත පන්ති සඳහා Educator වෙත උත්ශ්‍රේණි කරන්න.",
  el: "🎉 Δωρεάν πλήρης εξαγωγή καταλόγου: Ξεκλειδώσαμε και τους {count} συμμετέχοντες για την πρώτη σας μεγάλη τάξη! Αναβαθμίστε σε Educator για απεριόριστες τάξεις.",
  no: "🎉 Gratis fullstendig eksport: Vi har låst opp alle {count} deltakere for din første store klasse! Oppgrader til Educator for ubegrensede klasser i fremtiden.",
  ca: "🎉 Exportació completa gratuïta: Hem desbloquejat tots els {count} assistents per a la vostra primera classe gran! Actualitzeu a Educator per a classes il·limitades.",
  ne: "🎉 निःशुल्क पूर्ण-रोस्टर निर्यात: हामीले तपाईंको पहिलो ठूलो कक्षाका लागि सबै {count} सहभागीहरूलाई अनलक गरेका छौं! असीमित कक्षाहरूको लागि Educator मा अपग्रेड गर्नुहोस्।",
  ml: "🎉 സൗജന്യ ഫുൾ-റോസ്റ്റർ എക്‌സ്‌പോർട്ട്: നിങ്ങളുടെ ആദ്യത്തെ വലിയ ക്ലാസിനായി ഞങ്ങൾ എല്ലാ {count} പങ്കാളികളെയും അൺലോക്ക് ചെയ്‌തു! അൺലിമിറ്റഡ് ക്ലാസുകൾക്കായി Educator ലേക്ക് അപ്‌ഗ്രേഡ് ചെയ്യുക.",
  mn: "🎉 Үнэгүй бүрэн бүртгэл экспортлох: Бид таны анхны том ангид зориулж {count} оролцогчийн түгжээг тайллаа! Цаашид хязгааргүй анги танхимтай болохын тулд Educator болгон шинэчилнэ үү.",
  bn: "🎉 প্রশংসাসূচক পূর্ণ-রোস্টার রপ্তানি: আমরা আপনার প্রথম বড় ক্লাসের জন্য সমস্ত {count} অংশগ্রহণকারীকে আনলক করেছি! ভবিষ্যতে সীমাহীন ক্লাসের আকারের জন্য Educator এ আপগ্রেড করুন।",
  ta: "🎉 இலவச முழு-பட்டியல் ஏற்றுமதி: உங்கள் முதல் பெரிய வகுப்பிற்கான அனைத்து {count} பங்கேற்பாளர்களையும் நாங்கள் திறந்துள்ளோம்! வரம்பற்ற வகுப்புகளுக்கு Educator க்கு மேம்படுத்தவும்.",
  te: "🎉 ఉచిత పూర్తి-రోస్టర్ ఎగుమతి: మీ మొదటి పెద్ద తరగతి కోసం మేము అందరు {count} మంది హాజరైన వారిని అన్‌లాక్ చేసాము! అపరిమిత తరగతుల కోసం Educator కి అప్‌గ్రేడ్ చేయండి.",
  ur: "🎉 اعزازی مکمل روسٹر ایکسپورٹ: ہم نے آپ کی پہلی بڑی کلاس کے لیے تمام {count} شرکاء کو انلاک کر دیا ہے! لامحدود کلاسوں کے لیے Educator میں اپ گریڈ کریں۔",
  fa: "🎉 صادرات رایگان کل فهرست: ما همه {count} شرکت‌کننده را برای اولین کلاس بزرگ شما باز کردیم! برای کلاس‌های نامحدود به Educator ارتقا دهید.",
  hr: "🎉 Besplatan potpuni izvoz popisa: Otključali smo svih {count} sudionika za vaš prvi veliki razred! Nadogradite na Educator za neograničene razrede.",
  sr: "🎉 Бесплатан потпуни извоз списка: Откључали смо свих {count} учесника за ваш први велики разред! Надоградите на Educator за неограничене разреде.",
  sk: "🎉 Bezplatný úplný export zoznamu: Odomkli sme všetkých {count} účastníkov pre vašu prvú veľkú triedu! Inovujte na Educator pre neobmedzené triedy.",
  sl: "🎉 Brezplačen popoln izvoz seznama: Odklenili smo vseh {count} udeležencev za vaš prvi veliki razred! Nadgradite na Educator za neomejene razrede.",
  lv: "🎉 Bezmaksas pilna saraksta eksports: Mēs esam atbloķējuši visus {count} dalībniekus jūsu pirmajai lielajai klasei! Jauniniet uz Educator neierobežotām klasēm.",
  lt: "🎉 Nemokamas viso sąrašo eksportavimas: Atrakinome visus {count} dalyvius jūsų pirmajai didelei klasei! Naujovinkite į „Educator“ neribotoms klasėms.",
  et: "🎉 Tasuta täielik nimekirja eksport: Avasime kõik {count} osalejat teie esimese suure klassi jaoks! Uuendage paketile Educator piiramatute klasside jaoks.",
  ceb: "🎉 Libreng Tibuok Listahan sa Export: Giablihan namo ang tanang {count} nanambong para sa imong unang dakong klase! Pag-upgrade sa Educator para sa walay limitasyong mga klase.",
  kk: "🎉 Тегін толық тізімді экспорттау: Біз сіздің алғашқы үлкен сыныбыңыз үшін барлық {count} қатысушының құлпын аштық! Шексіз сабақтар үшін Educator нұсқасына жаңартыңыз.",
  lo: "🎉 ການສົ່ງອອກລາຍຊື່ເຕັມຟຣີ: ພວກເຮົາໄດ້ປົດລັອກຜູ້ເຂົ້າຮ່ວມທັງໝົດ {count} ຄົນສຳລັບຫ້ອງຮຽນໃຫຍ່ທຳອິດຂອງທ່ານ! ອັບເກຣດເປັນ Educator ສຳລັບຫ້ອງຮຽນບໍ່ຈຳກັດ.",
  my: "🎉 အခမဲ့စာရင်းအပြည့်အစုံ ထုတ်ယူခြင်း- သင်၏ ပထမဆုံး အတန်းကြီးအတွက် တက်ရောက်သူ {count} ဦးစလုံးကို လော့ခ်ဖွင့်ပေးထားပါသည်။ အကန့်အသတ်မရှိ အတန်းများအတွက် Educator သို့ အဆင့်မြှင့်ပါ။",
  km: "🎉 ការនាំចេញបញ្ជីឈ្មោះពេញដោយឥតគិតថ្លៃ៖ យើងបានដោះសោអ្នកចូលរួមទាំងអស់ {count} នាក់សម្រាប់ថ្នាក់ធំដំបូងរបស់អ្នក! ដំឡើងកំណែទៅ Educator សម្រាប់ថ្នាក់រៀນគ្មានដែនកំណត់។",
  kn: "🎉 ಪೂರಕ ಪೂರ್ಣ-ರೋಸ್ಟರ್ ರಫ್ತು: ನಿಮ್ಮ ಮೊದಲ ದೊಡ್ಡ ತರಗತಿಗಾಗಿ ನಾವು ಎಲ್ಲಾ {count} ಪಾಲ್ಗೊಳ್ಳುವವರನ್ನು ಅನ್‌ಲಾಕ್ ಮಾಡಿದ್ದೇವೆ! ಅನಿಯಮಿತ ತರಗತಿಗಳಿಗಾಗಿ Educator ಗೆ ಅಪ್‌ಗ್ರೇಡ್ ಮಾಡಿ.",
  gu: "🎉 પ્રશંસનીય સંપૂર્ણ-રોસ્ટર નિકાસ: અમે તમારા પ્રથમ મોટા વર્ગ માટે તમામ {count} સહભાગીઓને અનલૉક કર્યા છે! અમર્યાદિત વર્ગો માટે Educator માં અપગ્રેડ કરો.",
  pa: "🎉 ਮੁਫ਼ਤ ਪੂਰੀ-ਰੋਸਟਰ ਨਿਰਯਾਤ: ਅਸੀਂ ਤੁਹਾਡੀ ਪਹਿਲੀ ਵੱਡੀ ਕਲਾਸ ਲਈ ਸਾਰੇ {count} ਹਾਜ਼ਰੀਨ ਨੂੰ ਅਨਲੌਕ ਕਰ ਦਿੱਤਾ ਹੈ! ਅਸੀਮਤ ਕਲਾਸਾਂ ਲਈ Educator ਵਿੱਚ ਅੱਪਗ੍ਰੇਡ ਕਰੋ।",
  af: "🎉 Gratis volledige roosteruitvoer: Ons het al {count} deelnemers vir jou eerste groot klas ontsluit! Gradeer op na Educator vir onbeperkte klasgroottes in toekomstige klasse.",
  bg: "🎉 Безплатен пълен експорт на списък: Отключихме всички {count} участници за вашия първи голям клас! Надстройте до Educator за неограничени класове.",
};

const READY_SUB_TRANSLATIONS = {
  es: "Pulsa <strong style=\"color:#4ade80\">Iniciar</strong> arriba para empezar a registrar la asistencia",
  pt: "Toque em <strong style=\"color:#4ade80\">Iniciar</strong> acima para começar a registrar a presença",
  hi: "उपस्थिति ट्रैक करना शुरू करने के लिए ऊपर <strong style=\"color:#4ade80\">शुरू करें</strong> दबाएं",
  tl: "Pindutin ang <strong style=\"color:#4ade80\">Simulan</strong> sa itaas para simulan ang pag-track",
  ms: "Tekan <strong style=\"color:#4ade80\">Mula</strong> di atas untuk mula menjejak kehadiran",
  id: "Tekan <strong style=\"color:#4ade80\">Mulai</strong> di atas untuk mulai melacak kehadiran",
  vi: "Nhấn <strong style=\"color:#4ade80\">Bắt đầu</strong> ở trên để bắt đầu theo dõi điểm danh",
  fr: "Appuyez sur <strong style=\"color:#4ade80\">Démarrer</strong> ci-dessus pour suivre la présence",
  de: "Oben auf <strong style=\"color:#4ade80\">Starten</strong> drücken, um die Anwesenheit zu erfassen",
  it: "Premi <strong style=\"color:#4ade80\">Avvia</strong> in alto per iniziare a tracciare le presenze",
  nl: "Druk hierboven op <strong style=\"color:#4ade80\">Starten</strong> om aanwezigheid te volgen",
  pl: "Naciśnij <strong style=\"color:#4ade80\">Rozpocznij</strong> powyżej, aby śledzić obecność",
  tr: "Yoklamaya başlamak için yukarıdan <strong style=\"color:#4ade80\">Başlat</strong>’a basın",
  th: "กด <strong style=\"color:#4ade80\">เริ่ม</strong> ด้านบนเพื่อเริ่มติดตามการเข้าร่วม",
  ar: "اضغط <strong style=\"color:#4ade80\">بدء</strong> بالأعلى لبدء تتبّع الحضور",
  ko: "위의 <strong style=\"color:#4ade80\">시작</strong>을 눌러 출석 기록을 시작하세요",
  zh: "按上方的「<strong style=\"color:#4ade80\">開始</strong>」以追蹤出席",
  ja: "上の「<strong style=\"color:#4ade80\">開始</strong>」を押して出席の記録を始めましょう",
  ta: "வருகையைப் பதிவு செய்யத் தொடங்க மேலே <strong style=\"color:#4ade80\">தொடங்கு</strong> ஐ அழுத்தவும்",
  te: "హాజరును ట్రాక్ చేయడం ప్రారంభించడానికి పైన <strong style=\"color:#4ade80\">ప్రారంభించు</strong> నొక్కండి",
  bn: "উপস্থিতি ট্র্যাক শুরু করতে উপরে <strong style=\"color:#4ade80\">শুরু</strong> চাপুন",
  ur: "حاضری ٹریک کرنا شروع کرنے کے لیے اوپر <strong style=\"color:#4ade80\">شروع کریں</strong> دبائیں",
  "zh-CN": "按上方的“<strong style=\"color:#4ade80\">开始</strong>”以跟踪出勤",
  ru: "Нажмите «<strong style=\"color:#4ade80\">Начать</strong>» выше, чтобы отслеживать посещаемость",
  uk: "Натисніть «<strong style=\"color:#4ade80\">Почати</strong>» вгорі, щоб відстежувати відвідуваність",
  ro: "Apasă <strong style=\"color:#4ade80\">Start</strong> mai sus pentru a urmări prezența",
  he: "לחצו על <strong style=\"color:#4ade80\">התחל</strong> למעלה כדי לעקוב אחר נוכחות",
  mr: "उपस्थिती ट्रॅक करण्यासाठी वर <strong style=\"color:#4ade80\">सुरू करा</strong> दाबा",
  sv: "Tryck på <strong style=\"color:#4ade80\">Starta</strong> ovan för att spåra närvaro",
  cs: "Stisknutím <strong style=\"color:#4ade80\">Začít</strong> výše zahájíte sledování docházky",
  da: "Tryk på <strong style=\"color:#4ade80\">Start</strong> ovenfor for at begynde at spore fremmøde",
  fi: "Aloita osallistumisen seuranta painamalla yllä olevaa <strong style=\"color:#4ade80\">Aloita</strong>-painiketta",
  hu: "Nyomja meg a fenti <strong style=\"color:#4ade80\">Indítás</strong> gombot a részvétel nyomon követéséhez",
  so: "Riix <strong style=\"color:#4ade80\">Bilow</strong> xagga sare si aad u bilowdo la socoshada imaanshaha",
  sw: "Bonyeza <strong style=\"color:#4ade80\">Anza</strong> hapo juu ili kuanza kufuatilia mahudhurio",
  am: "መገኘትን መከታተል ለመጀመር ከላይ <strong style=\"color:#4ade80\">ጀምር</strong> የሚለውን ይጫኑ",
  si: "පැමිණීම ලුහුබැඳීම ආරම්භ කිරීමට ඉහතින් ඇති <strong style=\"color:#4ade80\">ආරම්භ කරන්න</strong> ඔබන්න",
  el: "Πατήστε <strong style=\"color:#4ade80\">Έναρξη</strong> παραπάνω για να ξεκινήσετε την καταγραφή παρουσιών",
  no: "Trykk <strong style=\"color:#4ade80\">Start</strong> ovenfor for å begynne sporing av oppmøte",
  ca: "Prem <strong style=\"color:#4ade80\">Inicia</strong> a dalt per començar a fer el seguiment d'assistència",
  ne: "उपस्थिति ट्र्याक गर्न माथि <strong style=\"color:#4ade80\">सुरु गर्नुहोस्</strong> थिच्नुहोस्",
  ml: "ഹാജർ രേഖപ്പെടുത്താൻ മുകളിലുള്ള <strong style=\"color:#4ade80\">ആരംഭിക്കുക</strong> അമർത്തുക",
  mn: "Ирц бүртгэж эхлэхийн тулд дээрх <strong style=\"color:#4ade80\">Эхлүүлэх</strong> товчийг дарна уу",
  kn: "ಹಾಜರಾತಿಯನ್ನು ಟ್ರ್ಯಾಕ್ ಮಾಡಲು ಪ್ರಾರಂಭಿಸಲು ಮೇಲೆ <strong style=\"color:#4ade80\">ಪ್ರಾರಂಭಿಸಿ</strong> ಒತ್ತಿ",
  gu: "હાજરી ટ્રેકિંગ શરૂ કરવા માટે ઉપર <strong style=\"color:#4ade80\">શરૂ કરો</strong> દબાવો",
  pa: "ਹਾਜ਼ਰੀ ਟ੍ਰੈਕ ਕਰਨੀ ਸ਼ੁਰੂ ਕਰਨ ਲਈ ਉੱਪਰ <strong style=\"color:#4ade80\">ਸ਼ੁਰੂ ਕਰੋ</strong> ਦਬਾਓ",
  kk: "Қатысуды тіркей бастау үшін жоғарыдағы «<strong style=\"color:#4ade80\">Бастау</strong>» батырмасын басыңыз",
  lv: "Nospiediet <strong style=\"color:#4ade80\">Sākt</strong> augstāk, lai sāktu apmeklējuma uzskaiti",
  lt: "Paspauskite „<strong style=\"color:#4ade80\">Pradėti</strong>“ viršuje, kad pradėtumėte fiksuoti lankomumą",
  lo: "ກົດ <strong style=\"color:#4ade80\">ເລີ່ມ</strong> ຂ້າງເທິງເພື່ອເລີ່ມຕົ້ນຕິດຕາມການເຂົ້າຮ່ວມ",
  my: "တက်ရောက်မှု စတင်မှတ်တမ်းတင်ရန် အထက်ပါ <strong style=\"color:#4ade80\">စတင်ရန်</strong> ကို နှိပ်ပါ",
  km: "ចុច <strong style=\"color:#4ade80\">ចាប់ផ្តើម</strong> ខាងលើដើម្បីចាប់ផ្តើមតាមដានវត្តមាន",
  ceb: "Pindota ang <strong style=\"color:#4ade80\">Sugdi</strong> sa ibabaw aron masugdan ang pagsubay sa attendance",
  bg: "Натиснете „<strong style=\"color:#4ade80\">Старт</strong>“ по-горе, за да започнете проследяване на присъствието",
  hr: "Pritisnite <strong style=\"color:#4ade80\">Pokreni</strong> iznad za početak praćenja prisutnosti",
  sr: "Притисните <strong style=\"color:#4ade80\">Покрени</strong> изнад да започнете праћење присуства",
  sk: "Stlačením <strong style=\"color:#4ade80\">Štart</strong> vyššie spustíte sledovanie dochádzky",
  sl: "Pritisnite <strong style=\"color:#4ade80\">Začni</strong> zgoraj, da začnete beležiti prisotnost",
  af: "Klik <strong style=\"color:#4ade80\">Begin</strong> hierbo om bywoning te begin volg",
};

function getWebsiteAndLp2FixesForLocale(loc) {
  if (loc === 'en') return {};
  const map = {};
  const webArr = NEW_WEBSITE_PART1[loc] || NEW_WEBSITE_PART2A[loc] || NEW_WEBSITE_PART2B[loc];
  if (webArr) {
    NEW_WEBSITE_KEY_LIST.forEach((k, i) => {
      if (webArr[i] !== undefined) map[k] = webArr[i];
    });
  }
  const spArr = LP2_SPANISH_FIXES_PART1[loc] || LP2_SPANISH_FIXES_PART2[loc];
  if (spArr) {
    LP2_66_KEYS.forEach((k, i) => {
      if (spArr[i] !== undefined) map[k] = spArr[i];
    });
  }
  const stArr = LP2_STRUCTURAL_FIXES[loc];
  if (stArr) {
    LP2_STRUCTURAL_KEYS.forEach((k, i) => {
      if (stArr[i] !== undefined) map[k] = stArr[i];
    });
  }
  if (LP2_FREE_BODY_ALL[loc]) {
    map.lp2_plan_free_body = LP2_FREE_BODY_ALL[loc];
  }
  if (loc === 'ca') {
    Object.assign(map, CA_EXTRA_FIXES);
  }
  Object.assign(map, getRemainingLp2AndFixes(loc));
  return map;
}

export function updateStringsFile() {
  const backendI18n = i18nBackend;
  const LOCALIZED_HEADERS = backendI18n.LOCALIZED_HEADERS || {};

  let code = fs.readFileSync(stringsPath, 'utf8');
  const locales = backendI18n.getStrings().LOCALES || [];

  const dashExtraLocales = {};
  const dashKeys = [
    'history.retrievePastMeetings', 'history.importMeeting', 'history.attendanceRate',
    'history.scheduledVsActual', 'history.rsvpStatus', 'history.tabLinks',
    'history.linkViews', 'history.revokeLink', 'history.participantNotes',
    'history.meetingDetails', 'history.copyLink', 'history.linkRevoked',
    'history.linkActive', 'history.noShareLinks', 'history.saveNote', 'history.noteSaved'
  ];
  const missingDashCodes = new Set(['kn', 'gu', 'pa', 'kk', 'lv', 'lt', 'lo', 'my', 'km', 'ceb', 'bg', 'hr', 'sr', 'sk', 'sl', 'af']);

  for (const locObj of locales) {
    const loc = locObj.code;
    const locHeader = LOCALIZED_HEADERS[loc] || LOCALIZED_HEADERS['en'] || {};
    const checkedInWord = locHeader.checkedIn || (loc === 'es' || loc === 'pt' ? 'Registrado' : 'Checked in');
    const webAndLp2Fixes = getWebsiteAndLp2FixesForLocale(loc);

    const overrides = {
      ...(EXTRA_LOCALE_OVERRIDES[loc] || {}),
      ...(LOCALE_OVERRIDES[loc] || {}),
      ...(GROWTH_LOCALE_MAPS[loc] || getGrowthTranslationsForLocale(loc)),
      ...(LMS_SYNC_PRO_TRANSLATIONS[loc] ? { "billing.lmsSyncPro": LMS_SYNC_PRO_TRANSLATIONS[loc] } : {}),
      ...(SINGLE_ALT_PREFIX_TRANSLATIONS[loc] ? { "upgrade.singleAltPrefix": SINGLE_ALT_PREFIX_TRANSLATIONS[loc] } : {}),
      ...(GRACE_USED_TRANSLATIONS[loc] ? { "export.graceUsed": GRACE_USED_TRANSLATIONS[loc] } : {}),
      ...(READY_SUB_TRANSLATIONS[loc] ? { "empty.readySub": READY_SUB_TRANSLATIONS[loc] } : {}),
      // Audited fixes for values that were still English or Spanish — applied last.
      ...(ERROR_KEY_TRANSLATIONS[loc] || {}),
      ...(TRANSLATION_FIXES[loc] || {}),
      ...webAndLp2Fixes,
    };

    const locPattern = `"${loc}": {`;
    const locIdx = code.indexOf(locPattern);
    if (locIdx === -1) {
      console.warn(`Locale ${loc} not found in strings.js`);
      continue;
    }
    const nextCloseIdx = code.indexOf('\n    },', locIdx);
    if (nextCloseIdx === -1 && loc !== locales[locales.length - 1].code) {
      console.warn(`Could not find closing block for ${loc}`);
      continue;
    }
    const endBlockIdx = nextCloseIdx !== -1 ? nextCloseIdx : code.indexOf('\n    }', locIdx);
    let block = code.slice(locIdx, endBlockIdx);

    const allTargetKeys = { ...NEW_KEYS_EN, ...GROWTH_KEYS_EN, ...NEW_WEBSITE_KEYS_EN, ...ERROR_KEYS_EN, ...REMAINING_LP2_KEYS_EN };
    for (const [k, enVal] of Object.entries(allTargetKeys)) {
      const desiredVal = (k in overrides)
        ? overrides[k]
        : (k === 'export.checkedInPrefix'
            ? `${checkedInWord} `
            : enVal);

      const keyEscaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reg = new RegExp(`^[ \\t]*["']${keyEscaped}["']:\\s*(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'),?\\r?\\n?`, 'gm');

      if (reg.test(block)) {
        reg.lastIndex = 0;
        let first = true;
        block = block.replace(reg, () => {
          if (first) {
            first = false;
            return `        ${JSON.stringify(k)}: ${JSON.stringify(desiredVal)},\n`;
          }
          return ''; // Deduplicate extra entries
        });
      } else {
        const insertAt = locPattern.length;
        block = block.slice(0, insertAt) + `\n        ${JSON.stringify(k)}: ${JSON.stringify(desiredVal)},` + block.slice(insertAt);
      }
    }

    // Also apply any TRANSLATION_FIXES[loc] or webAndLp2Fixes keys that exist in strings.js outside allTargetKeys
    const extraFixes = { ...(TRANSLATION_FIXES[loc] || {}), ...webAndLp2Fixes };
    for (const [k, fixedVal] of Object.entries(extraFixes)) {
      if (k in allTargetKeys) continue;
      const keyEscaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reg = new RegExp(`^[ \\t]*["']${keyEscaped}["']:\\s*(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'),?\\r?\\n?`, 'gm');
      if (reg.test(block)) {
        reg.lastIndex = 0;
        let first = true;
        block = block.replace(reg, () => {
          if (first) {
            first = false;
            return `        ${JSON.stringify(k)}: ${JSON.stringify(fixedVal)},\n`;
          }
          return '';
        });
      }
    }

    if (missingDashCodes.has(loc)) {
      const dashMap = {};
      for (const dk of dashKeys) {
        const keyEscaped = dk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const m = block.match(new RegExp(`^[ \\t]*["']${keyEscaped}["']:\\s*("(?:[^"\\\\]|\\\\.)*"),?`, 'm'));
        if (m) dashMap[dk] = JSON.parse(m[1]);
      }
      dashExtraLocales[loc] = dashMap;
    }

    code = code.slice(0, locIdx) + block + code.slice(endBlockIdx);
  }

  // Update header comment to list all 60 locales
  code = code.replace(
    /\/\/ en, es, pt, hi, ta, te, bn, ur, tl, ms, id, vi, fr, de, it, nl, pl, ro, ru, uk, tr, th, ar, ko, zh, zh-CN, ja, he, mr, sv, cs, da, fi, hu, so, sw, am, si, el, no, ca, ne, ml, mn\./,
    '// en, es, pt, hi, ta, te, bn, ur, tl, ms, id, vi, fr, de, it, nl, pl, ro, ru, uk, tr, th, ar, ko, zh, zh-CN, ja, he, mr, sv, cs, da, fi, hu, so, sw, am, si, el, no, ca, ne, ml, mn, kn, gu, pa, kk, lv, lt, lo, my, km, ceb, bg, hr, sr, sk, sl, af.'
  );

  // Ensure DASHBOARD_STRINGS.ca uses Catalan 'Revoca' instead of Spanish 'Revocar'
  code = code.replace(
    /(ca:\s*\{[\s\S]*?'history\.revokeLink':\s*)'Revocar'/,
    "$1'Revoca'"
  );

  // Ensure DASHBOARD_STRINGS.pt uses Portuguese 'Notas do anfitrião' instead of Spanish 'Notas do anfitrión'
  code = code.replace(
    /(pt:\s*\{[\s\S]*?'history\.participantNotes':\s*)'Notas do anfitrión'/,
    "$1'Notas do anfitrião'"
  );

  // Populate the 16 missing locales (kn..af) in DASHBOARD_STRINGS if not present
  const dashStartIdx = code.indexOf('const DASHBOARD_STRINGS = {');
  const dashEndIdx = code.indexOf('  for (const [lang, map] of Object.entries(DASHBOARD_STRINGS))');
  if (dashStartIdx !== -1 && dashEndIdx !== -1) {
    let dashSection = code.slice(dashStartIdx, dashEndIdx);
    const missingEntries = [];
    for (const [loc, dashMap] of Object.entries(dashExtraLocales)) {
      if (!new RegExp(`\\b${loc}:\\s*\\{`).test(dashSection)) {
        const lines = Object.entries(dashMap).map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
        missingEntries.push(`    ${loc}: {\n${lines}\n    }`);
      }
    }
    if (missingEntries.length > 0) {
      dashSection = dashSection.replace(/(\n    \}\r?\n  \};)/, `,\n${missingEntries.join(',\n')}$1`);
      code = code.slice(0, dashStartIdx) + dashSection + code.slice(dashEndIdx);
    }
  }

  // Ensure applyTranslations supports [data-i18n-alt]
  if (!code.includes("doc.querySelectorAll('[data-i18n-alt]')")) {
    code = code.replace(
      /(doc\.querySelectorAll\('\[data-i18n-aria\]'\)\.forEach\(el => \{\r?\n\s*const key = el\.getAttribute\('data-i18n-aria'\);\r?\n\s*if \(key\) el\.setAttribute\('aria-label', t\(key, el\.getAttribute\('aria-label'\)\)\);\r?\n\s*\}\);)/,
      `$1\n\n    doc.querySelectorAll('[data-i18n-alt]').forEach(el => {\n      const key = el.getAttribute('data-i18n-alt');\n      if (key) el.setAttribute('alt', t(key, el.getAttribute('alt')));\n    });`
    );
  }

  fs.writeFileSync(stringsPath, code, 'utf8');
  console.log(`Updated js/strings.js with new keys across all 60 locales.`);
}

updateStringsFile();
