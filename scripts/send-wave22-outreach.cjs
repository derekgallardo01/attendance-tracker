#!/usr/bin/env node
/**
 * scripts/send-wave22-outreach.cjs
 *
 * Dedicated dispatcher for Wave 22 Backlink Outreach (30 Verified Targets):
 * - Carried-over Verified Reserve Targets from Wave 21 (Targets 1–15, DR 15–18)
 * - High-Authority Universities, SaaS Publications, Marketing Blogs & AI Directories (Targets 16–30, DR 70–90)
 *
 * Sends personalized, anti-AI founder emails from Derek Gallardo <derek@attendancetracker.dev>
 * via the Resend API with reply-to derek@attendancetracker.dev.
 *
 * Safety & Execution features:
 * 1. Deduplication log in `docs/wave22-dispatch-log.json` (overridable via `WAVE22_LOG_FILE`) to prevent duplicate sends.
 * 2. `--test` flag: dispatches a sample preview to derekgallardo01@gmail.com (supports `--target=<id>`).
 * 3. `--dry-run`: previews emails without calling Resend API (supports `--target=<id>` or all).
 * 4. `--send --target=<id>` or `--send --all`: executes live send with rate limiting.
 * 5. `--force`: overrides deduplication log when combined with `--send`.
 */

const fs = require('fs');
const path = require('path');
const { Resend } = require(path.resolve(__dirname, '../backend/node_modules/resend'));

function loadResendApiKey() {
  if (process.env.RESEND_API_KEY) return process.env.RESEND_API_KEY.trim();
  const rootDir = path.resolve(__dirname, '..');
  for (const rel of ['.env', 'backend/.env']) {
    const p = path.join(rootDir, rel);
    if (fs.existsSync(p)) {
      const m = fs.readFileSync(p, 'utf8').match(/^RESEND_API_KEY=(.+)$/m);
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  const wave13File = path.join(__dirname, 'send-wave13-outreach.cjs');
  if (fs.existsSync(wave13File)) {
    const m = fs.readFileSync(wave13File, 'utf8').match(/process\.env\.RESEND_API_KEY\s*\|\|\s*['"]([^'"]+)['"]/);
    if (m) return m[1].trim();
  }
  return 're_placeholder_for_dry_run';
}

const RESEND_API_KEY = loadResendApiKey();
const resend = new Resend(RESEND_API_KEY);

const SENDER = 'Derek Gallardo <derek@attendancetracker.dev>';
const REPLY_TO = 'derek@attendancetracker.dev';
const DEREK_INBOX = 'derekgallardo01@gmail.com';
const LOG_FILE = path.resolve(__dirname, '../docs/wave22-dispatch-log.json');

const TARGETS = [
  {
    id: 1,
    name: 'Tixu AI',
    to: ['support@tixu.ai'],
    cc: ['hello@tixu.ai'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for Tixu AI’s blog',
    text: `Hi Tixu AI Editorial Team,

While reading your workflow guide on the Tixu AI blog (https://blog.tixu.ai/build-a-viral-horror-channel-using-ai-in-7-steps/) where you cite tactiq.io, I wanted to share our official Google Workspace Marketplace add-on, Attendance Tracker (https://attendancetracker.dev).

Unlike Chrome extensions that scrape DOM elements—or Google's native attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker runs on the native Google Meet REST API v2 inside the Meet side panel without bots, logging exact join/leave durations and exporting to Google Sheets in one click.

Helpful links if you expand your Google Meet & remote workflow coverage:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 2,
    name: 'AI Rehberi Turkey',
    to: ['info@airehberi.org'],
    cc: ['iletisim@airehberi.org'],
    subject: 'AI Rehberi dizininiz için Türkçe arayüzlü resmi Google Meet Yoklama Eklentisi (REST API v2)',
    text: `Merhaba AI Rehberi Ekibi,

Sitenizdeki Tactiq inceleme sayfasını (https://airehberi.org/tactiq) incelerken, Google Meet kullanıcıları için geliştirdiğimiz resmi Google Workspace Marketplace eklentisi Attendance Tracker'ı (https://attendancetracker.dev) sizinle paylaşmak istedim.

Google Meet'in yerleşik yoklama raporu yalnızca Enterprise paketlerde ve en az 5 katılımcılı toplantılarda çalışır. Attendance Tracker ise doğrudan yerel Google Meet REST API v2 üzerinde (tam Türkçe ve İngilizce arayüz desteğiyle) çalışır; toplantıya bot sokmadan yan panelde katılımcı giriş/çıkış sürelerini kaydeder ve tek tıkla Google E-Tablolar'a aktarır.

Dizininizde veya alternatifler bölümünde değerlendirmek isterseniz:
- En iyi Google Meet yoklama eklentileri karşılaştırması: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Google Meet yoklama takip rehberi: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Resmi eklenti: https://attendancetracker.dev

Selamlar,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 3,
    name: 'TMA Innovation Park Binh Dinh Vietnam',
    to: ['info@tma-binhdinh.vn'],
    cc: ['contact@tma-binhdinh.vn'],
    subject: 'Tiện ích điểm danh Google Meet chính thức (REST API v2, Tiếng Việt) cho bài viết của TMA Bình Định',
    text: `Chào Ban biên tập TMA Innovation Park Bình Định,

Khi đọc bài viết "Tăng tốc hiệu suất – Bứt phá sáng tạo cùng hơn 50 công cụ AI nổi bật" (https://www.tma-binhdinh.vn/tin-tuc/tang-toc-hieu-suat-but-pha-sang-tao-cung-hon-50-cong-cu-ai-noi-bat) có giới thiệu tactiq.io cho Google Meet, mình muốn chia sẻ thêm tiện ích Google Workspace chính thức dành cho các đội ngũ kỹ sư và đào tạo nội bộ.

Vì báo cáo điểm danh mặc định của Google Meet yêu cầu gói Enterprise và chỉ hoạt động khi có từ 5 người trở lên, mình đã phát triển Attendance Tracker (https://attendancetracker.dev) dựa trên Google Meet REST API v2 gốc (hỗ trợ đầy đủ tiếng Việt). Tiện ích ghi lại chính xác thời gian tham gia ngay trong thanh bên mà không cần bot và xuất ra Google Sheets chỉ với 1 cú nhấp chuột.

Một số liên kết hữu ích để bổ sung vào bài viết:
- Hướng dẫn điểm danh Google Meet (Tiếng Việt): https://attendancetracker.dev/diem-danh-google-meet.html
- Quản lý điểm danh cho nhóm làm việc từ xa: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Tiện ích chính thức: https://attendancetracker.dev

Trân trọng,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 4,
    name: 'OverseerOS',
    to: ['hello@overseeros.com'],
    cc: ['support@overseeros.com'],
    subject: 'Zero-bot Google Meet to Google Sheets add-on for OverseerOS’s blog',
    text: `Hi OverseerOS Team,

While reading your post "Best YouTube Transcript Extractor Tools for Creators" (https://www.overseeros.com/blog/best-youtube-transcript-extractor) where you link to tactiq.io/tools/youtube-transcript, I wanted to share a zero-bot Google Workspace Marketplace add-on for remote teams.

When teams run daily standups or 1-on-1 check-ins on Google Meet, Google's native attendance report requires Enterprise seats and never triggers on calls under 5 participants. I built Attendance Tracker (https://attendancetracker.dev) on the native Google Meet REST API v2 to track exact participant durations inside the Meet side panel and export to Google Sheets in one click.

Helpful links if you expand your Google Workspace coverage:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 5,
    name: 'Taket Engenharia Brazil — Beto',
    to: ['beto@taket.com.br'],
    cc: ['contato@taket.com.br'],
    subject: 'Add-on oficial de lista de presença no Google Meet (sem bots) para o artigo da Taket, Beto',
    text: `Olá Beto, tudo bem?

Lendo o seu artigo "Inteligência artificial na engenharia: conheça as ferramentas que podem te ajudar" (https://taket.com.br/inteligencia-artificial-na-engenharia-conheca-as-ferramentas-que-podem-te-ajudar/) onde você recomenda o tactiq.io para reuniões no Google Meet, queria apresentar uma ferramenta oficial para equipes de engenharia e gestão de projetos.

Em reuniões de alinhamento técnico ou chamadas com menos de 5 pessoas no Google Meet, o relatório nativo de presença do Google não é gerado (além de exigir planos Enterprise). Criei o Attendance Tracker (https://attendancetracker.dev), um add-on oficial no Google Workspace Marketplace construído na API REST v2 nativa do Google Meet (em português) que registra horários exatos no painel lateral sem bots e exporta para o Google Sheets em um clique.

Links úteis caso queira complementar o artigo:
- Lista de presença no Google Meet (PT-BR): https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Guia para equipes remotas e projetos: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Add-on oficial: https://attendancetracker.dev

Um abraço,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 6,
    name: 'SME Jump Thailand',
    to: ['contact@smejump.co.th'],
    cc: ['info@smejump.co.th'],
    subject: 'Zero-bot Google Meet REST API v2 add-on (with Thai & English UI) for SME Jump’s 2026 guide',
    text: `Hi SME Jump Editorial Team,

While reading your article "AI แอปสำหรับคนทำงานในปี 2026" (https://www.smejump.co.th/blog/ai-tools-for-work-2026/) where you feature tactiq.io for Google Meet, I wanted to share our official Google Workspace Marketplace add-on, Attendance Tracker (https://attendancetracker.dev), which includes full Thai (th) and English UI localization.

Because Google's built-in attendance report requires Enterprise licenses and never fires on meetings under 5 participants, SMEs and agencies use our native Google Meet REST API v2 add-on to log exact participant durations inside the Meet side panel without bots and export to Google Sheets in one click.

Helpful links if you update your work tools guide:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 7,
    name: 'Strokecast',
    to: ['office@strokecast.com'],
    cc: ['hello@strokecast.com'],
    subject: 'Native Google Meet REST API v2 add-on for Strokecast’s creator workflow guide',
    text: `Hi Strokecast Team,

While reading your creator guide (https://strokecast.com/how-to-go-viral-on-youtube/) where you link to tactiq.io/tools/youtube-transcript, I wanted to share a zero-bot Google Meet add-on built for creators, educators, and community hosts.

Unlike Chrome extensions that scrape DOM captions—or Google's native attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It tracks attendee join/leave durations inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you cover Google Workspace tools:
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 8,
    name: 'Toolspedia',
    to: ['hello@toolspedia.io'],
    cc: ['support@toolspedia.io'],
    subject: 'Adding Attendance Tracker (Google Meet REST API v2) to Toolspedia’s directory',
    text: `Hi Toolspedia Editorial Team,

While browsing your directory listing for Tactiq (https://toolspedia.io/ai-tool/tactiq/), I wanted to share Attendance Tracker (https://attendancetracker.dev) for your Google Meet tools category and alternatives section.

Instead of injecting recording bots or relying on fragile DOM-scraping Chrome extensions, Attendance Tracker is an official Google Workspace Marketplace add-on running on the native Google Meet REST API v2. It opens right inside the Google Meet side panel, works on any call size (even under 5 participants), and exports attendance to Google Sheets in one click.

Helpful links for your directory:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 9,
    name: 'Vocova',
    to: ['contact@vocova.app'],
    cc: ['support@vocova.app'],
    subject: 'Non-competing Google Meet attendance link for Vocova’s blog',
    text: `Hi Vocova Team,

While reading your post "Transcribe online videos and podcasts by pasting a link" (https://vocova.app/blog/transcribe-online-media-by-link), I noticed you include an outbound link to rival tactiq.io.

Since Attendance Tracker (https://attendancetracker.dev) does zero audio recording or media transcription, it's a 100% non-competing Google Meet companion for Vocova users. Built on the native Google Meet REST API v2 as an official Google Workspace Marketplace add-on, it runs inside the Meet side panel without bots, merges reconnects automatically, and exports attendance to Google Sheets in one click.

Helpful links if you'd like to cite a non-competing resource:
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 10,
    name: 'ComunicaGenia Spain',
    to: ['hola@comunicagenia.com'],
    cc: ['info@comunicagenia.com'],
    subject: 'Complemento oficial de asistencia en Google Meet (REST API v2, sin bots) para ComunicaGenia',
    text: `Hola equipo de ComunicaGenia,

Leyendo vuestro artículo "Tactiq.io: Olvídate de tomar notas en tus reuniones virtuales" (https://comunicagenia.com/blog/tactiq-io-reuniones-virtuales/), quería presentaros un complemento oficial de Google Workspace que resuelve otra tarea manual en Google Meet: el control de asistencia.

Como el informe nativo de asistencia de Google Meet exige cuentas Enterprise y nunca se activa en sesiones de menos de 5 personas, he desarrollado Attendance Tracker (https://attendancetracker.dev) sobre la API REST v2 nativa de Google Meet (en español). Registra entradas, salidas y duración en el panel lateral sin bots y exporta a Google Sheets o certificados PDF en un clic.

Enlaces útiles por si deseáis complementar vuestra guía:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Control de asistencia para formaciones y webinars: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Complemento oficial: https://attendancetracker.dev

Un cordial saludo,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 11,
    name: 'Panoraia France',
    to: ['contact@panoraia.fr'],
    cc: ['bonjour@panoraia.fr'],
    subject: 'Module officiel Google Meet (API REST v2, sans bot) pour la catégorie Productivité de Panoraia',
    text: `Bonjour l'équipe Panoraia,

En parcourant votre catégorie Productivité (https://panoraia.fr/categories/productivite) où figure tactiq.io pour Google Meet, je souhaitais vous présenter Attendance Tracker (https://attendancetracker.dev) pour votre annuaire francophone.

Contrairement aux extensions Chrome qui scrutent le DOM (ou au rapport natif de Google qui exige un forfait Enterprise et au moins 5 participants), Attendance Tracker est un module officiel du Google Workspace Marketplace basé sur l'API REST v2 native de Google Meet (en français). Il suit les présences directement dans le panneau latéral sans bot et exporte vers Google Sheets en un clic.

Liens utiles pour votre annuaire :
- Guide pour les équipes à distance : https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Comparatif des extensions et modules Google Meet : https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Module officiel : https://attendancetracker.dev

Bien cordialement,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 12,
    name: 'Mutua Digital Brazil',
    to: ['hola@mutua.digital'],
    cc: ['info@mutua.digital'],
    subject: 'Add-on oficial de lista de presença no Google Meet (sem bots) para o blog da Mutua Digital',
    text: `Olá equipe da Mutua Digital,

Lendo o artigo de vocês "Como usar inteligência artificial para vender mais" (https://mutua.digital/como-usar-inteligencia-artificial-para-vender-mais/) onde vocês recomendam o tactiq.io para chamadas no Google Meet, gostaria de compartilhar um add-on oficial para equipes comerciais e remotas.

Em reuniões 1-a-1 de vendas ou calls com menos de 5 participantes no Google Meet, o relatório nativo de presença do Google nunca dispara (além de exigir planos Enterprise). Desenvolvi o Attendance Tracker (https://attendancetracker.dev), um add-on oficial no Google Workspace Marketplace baseado na API REST v2 nativa do Google Meet (em português) que registra horários exatos no painel lateral sem bots e exporta para o Google Sheets em um clique.

Links úteis caso atualizem o artigo:
- Lista de presença no Google Meet (PT-BR): https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Guia para equipes remotas e comerciais: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Add-on oficial: https://attendancetracker.dev

Um abraço,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 13,
    name: 'SellOnTube',
    to: ['hello@sellontube.com'],
    cc: ['support@sellontube.com'],
    subject: 'Zero-bot Google Meet webinar attendance add-on for SellOnTube’s blog',
    text: `Hi SellOnTube Team,

While reading your roundup "Best YouTube Transcript Generators (2026)" (https://sellontube.com/blog/best-youtube-transcript-generators) where you cite tactiq.io for live sessions and recordings, I wanted to share a zero-bot Google Meet add-on built for creators running live workshops and coaching calls.

Because Google's native attendance report requires Enterprise plans and won't trigger on calls under 5 participants, I built Attendance Tracker (https://attendancetracker.dev)—an official Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact attendee durations in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand your creator workflow guides:
- Webinars & live training attendance guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 14,
    name: 'RHEIS Consulting Brazil',
    to: ['rheis@rheis.com.br'],
    cc: ['contato@rheis.com.br'],
    subject: 'Add-on oficial de presença para entrevistas e treinamentos no Google Meet (para a RHEIS Consulting)',
    text: `Olá equipe da RHEIS Consulting,

Visitando a página de vocês sobre ferramentas para reuniões (https://www.rheis.com.br/product-page/tactiq), gostaria de apresentar o Attendance Tracker (https://attendancetracker.dev), um add-on oficial do Google Workspace Marketplace muito utilizado por equipes de RH, recrutamento e treinamento corporativo.

Em entrevistas de emprego 1-a-1 ou dinâmicas com menos de 5 pessoas no Google Meet, o relatório nativo do Google não é gerado (e exige licenças Enterprise). Construído na API REST v2 nativa do Google Meet (totalmente em português), o Attendance Tracker registra horários exatos de entrada e saída no painel lateral sem bots e exporta para o Google Sheets ou gera certificados PDF em um clique.

Links úteis para a curadoria da RHEIS:
- Lista de presença no Google Meet (PT-BR): https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Guia para entrevistas de emprego no Google Meet: https://attendancetracker.dev/google-meet-attendance-for-job-interviews.html
- Add-on oficial: https://attendancetracker.dev

Atenciosamente,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 15,
    name: 'Rojo.me Spain',
    to: ['hola@rojo.me'],
    cc: ['contact@rojo.me'],
    subject: 'Complemento oficial de asistencia en Google Meet (REST API v2, sin bots) para Rojo.me',
    text: `Hola equipo de Rojo.me,

Leyendo vuestra selección "Las Mejores App de IA" (https://www.rojo.me/las-mejores-app-de-ia-en-2024/) donde recomendáis tactiq.io para Google Meet, quería presentaros un complemento oficial de Google Workspace pensado para equipos y docentes.

Como el informe nativo de asistencia de Google Meet requiere cuentas Enterprise y nunca se activa en llamadas de menos de 5 personas (y las extensiones de Chrome suelen fallar cuando cambia la interfaz), he creado Attendance Tracker (https://attendancetracker.dev) sobre la API REST v2 nativa de Google Meet (en español). Registra entradas y salidas en el panel lateral sin bots y exporta a Google Sheets en un clic.

Enlaces útiles por si actualizáis el listado:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Paso a paso para registrar asistencia en Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Complemento oficial: https://attendancetracker.dev

Un saludo cordial,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 16,
    name: 'Rutgers University P3 Collaboratory',
    to: ['fjo22@newark.rutgers.edu'],
    cc: ['accessibility@rutgers.edu'],
    subject: 'Zero-bot Google Meet attendance add-on for Rutgers P3 Collaboratory + free faculty pass',
    text: `Hi Rutgers P3 Collaboratory Team,

While reading your faculty post "What We Are Learning: Summer of AI" (https://p3.rutgers.edu/post/what-we-are-learning-summer-of-ai-2024) where you highlight tactiq.io for virtual sessions, I wanted to share a privacy-first Google Meet attendance add-on built for university faculty and seminar instructors.

Because Google's built-in attendance report requires Enterprise licenses and never triggers on office hours or small seminars under 5 participants, I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that logs student join/leave durations inside the Meet side panel and exports to Google Sheets in one click.

If any Rutgers faculty would like to use it, reply with your university email and I'll gladly activate a free lifetime educator pass:
- University lectures & seminars guide: https://attendancetracker.dev/google-meet-attendance-for-universities.html
- Guide for educators: https://attendancetracker.dev/attendance-tracker-for-teachers.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 17,
    name: 'Geekflare',
    to: ['hello@geekflare.com'],
    cc: ['contact@geekflare.com'],
    subject: 'Native Google Meet REST API v2 add-on for Geekflare’s Google Meet tools coverage',
    text: `Hi Geekflare Editorial Team,

While reading your hands-on review "Tactiq Review: Testing its AI-Powered Meeting Transcription" (https://geekflare.com/reviews/tactiq-review/), I wanted to share how we solved Google Meet attendance tracking using Google's new native REST API v2 architecture.

Unlike legacy Chrome extensions that scrape DOM captions and break when Google updates Meet's layout—or Google's native report that requires Enterprise tiers and 5+ participants—Attendance Tracker (https://attendancetracker.dev) is an official zero-bot Google Workspace Marketplace add-on. It runs directly inside the Google Meet side panel, merges reconnections automatically, and exports attendance to Google Sheets in one click.

Helpful links if you expand your Google Meet tools coverage:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 18,
    name: 'ZipDo',
    to: ['info@zipdo.co'],
    cc: ['hello@zipdo.co'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for ZipDo’s Meeting Software comparison',
    text: `Hi ZipDo Team,

While reading your comparison "Top 10 Best Meeting Minute Software | Compared in 2026" (https://zipdo.co/best/meeting-minute-software/) where you feature tactiq.io for Google Meet, I wanted to share our official Google Workspace Marketplace add-on, Attendance Tracker (https://attendancetracker.dev).

Because Google's built-in attendance report requires Enterprise seats and never fires on meetings under 5 participants, remote teams use our native Google Meet REST API v2 add-on to log exact join/leave durations inside the Meet side panel without bots and export to Google Sheets in one click.

Helpful links if you update your meeting tools guide:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 19,
    name: 'Wbcom Designs — Shashank',
    to: ['shashank@wbcomdesigns.com'],
    cc: ['connect@wbcomdesigns.com'],
    subject: 'Quick note on your Wbcom Designs meeting tools post + native Google Meet REST API v2 add-on',
    text: `Hi Shashank,

While reading your roundup "Best AI Tools for Meeting Notes in 2026" on Wbcom Designs (https://wbcomdesigns.com/best-ai-tools-for-meeting-notes/) where you feature tactiq.io for Google Meet, I wanted to share a zero-bot Google Workspace Marketplace add-on built for remote agencies and dev teams.

When engineering or WordPress agency teams run standups or client calls under 5 people on Google Meet, Google's native attendance report refuses to fire (and requires Enterprise seats). I built Attendance Tracker (https://attendancetracker.dev) on the native Google Meet REST API v2 to log exact participant durations inside the Meet side panel without bots and export to Google Sheets in one click.

Helpful links if you ever update that post:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 20,
    name: 'Neal Schaffer',
    to: ['neal@nealschaffer.com'],
    cc: ['info@nealschaffer.com'],
    subject: 'Quick note on your nealschaffer.com post + zero-bot Google Meet webinar attendance tracking',
    text: `Hi Neal,

While reading your guide on nealschaffer.com (https://nealschaffer.com/youtube-transcript-generator/) where you highlight tactiq.io for video and meeting workflows, I wanted to share a lightweight Google Workspace Marketplace add-on I built for marketers, educators, and webinar hosts.

Because Google's native attendance report requires Enterprise seats and never fires on coaching calls or small group sessions under 5 people, Attendance Tracker (https://attendancetracker.dev) runs directly on the native Google Meet REST API v2 inside the Meet side panel without bots, logging exact attendee durations and exporting to Google Sheets or PDF certificates in one click.

Thought these might be useful if you cover Google Meet webinar or team tools:
- Webinars & training attendance guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Remote marketing teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 21,
    name: 'JivoChat',
    to: ['info@jivochat.com'],
    cc: ['support@jivochat.com'],
    subject: 'Zero-bot Google Meet to Google Sheets add-on for JivoChat’s marketing blog',
    text: `Hi JivoChat Editorial Team,

While reading your article "How AI is Changing Customer Targeting In Digital Marketing" (https://www.jivochat.com/blog/marketing/how-ai-is-changing-customer-targeting-in-digital-marketing.html), I noticed you cite tactiq.io when discussing customer discovery and sales calls on Google Meet.

When sales and customer success teams run 1-on-1 demos or onboarding calls on Google Meet, Google's native attendance report never triggers (it requires 5+ participants and Enterprise plans). I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact call timestamps in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand your remote sales & CS resources:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 22,
    name: 'Rocket.net',
    to: ['support@rocket.net'],
    cc: ['hello@rocket.net'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for Rocket.net’s productivity guide',
    text: `Hi Rocket.net Team,

While reading your blog post "Which AI Assistant Should You Choose?" (https://rocket.net/blog/which-ai-assistant-should-you-choose/) where you recommend tactiq.io for Google Meet users, I wanted to share a zero-bot Google Workspace Marketplace add-on built for remote agencies and engineering teams.

Unlike Chrome extensions that scrape DOM captions—or Google's built-in attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker (https://attendancetracker.dev) runs on the native Google Meet REST API v2 inside the Meet side panel, tracking exact join/leave durations and exporting to Google Sheets in one click.

Helpful links if you update your Google Meet tools section:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 23,
    name: 'eesel AI',
    to: ['hi@eesel.app'],
    cc: ['hello@eesel.ai'],
    subject: 'Native Google Meet REST API v2 companion for eesel AI’s Google Workspace readers',
    text: `Hi eesel AI Editorial Team,

While reading your post "ChatGPT alternatives: 7 tools for different jobs in 2026" (https://www.eesel.ai/blog/chatgpt-alternative) where you link to tactiq.io for Google Meet workflows, I wanted to share a non-competing Google Workspace Marketplace add-on built for remote teams.

Because Google's native attendance report requires Enterprise plans and won't trigger on calls under 5 people, I built Attendance Tracker (https://attendancetracker.dev) on the native Google Meet REST API v2. It runs inside the Meet side panel without bots, merges reconnects automatically, and exports attendance to Google Sheets in one click.

Helpful links if you update your Google Workspace workflow guides:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 24,
    name: 'Social Champ',
    to: ['support@socialchamp.com'],
    cc: ['hello@socialchamp.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for Social Champ’s 50+ Best SaaS Tools guide',
    text: `Hi Social Champ Editorial Team,

While reading your guide "50+ Best SaaS Tools For Business Operations In 2026" (https://www.socialchamp.com/blog/saas-tools/) where you feature tactiq.io for Google Meet, I wanted to share our official Google Workspace Marketplace add-on, Attendance Tracker (https://attendancetracker.dev).

Unlike browser extensions that scrape DOM elements and break when Google updates Meet's layout—or Google's native report that requires Enterprise licenses and 5+ participants—Attendance Tracker is built on the native Google Meet REST API v2. It logs exact participant durations inside the Meet side panel without bots and exports to Google Sheets in one click.

Helpful links if you update your SaaS tools roundup:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 25,
    name: 'Failory — Nico Cerdeira',
    to: ['nico@failory.com'],
    cc: ['hello@failory.com'],
    subject: 'Quick note on your Failory Chrome Extension interview + Google Meet REST API v2 architecture',
    text: `Hi Nico,

While reading your interview on Failory "Growing a B2B Productivity Chrome Extension 20x Year-on-Year" (https://www.failory.com/interview/tactiq), I wanted to share how the Google Meet ecosystem has shifted from DOM-scraping Chrome extensions to native Google Workspace Marketplace add-ons.

Because legacy Meet attendance Chrome extensions constantly break when Google changes Meet's DOM—and Google's native report requires Enterprise seats and 5+ participants—I built Attendance Tracker (https://attendancetracker.dev) directly on the native Google Meet REST API v2. It runs inside the official Meet side panel without bots and exports attendance to Google Sheets in one click.

Thought these might be interesting context if you update your B2B SaaS or extension coverage:
- Why Google Meet Chrome extensions break vs. native REST API v2 add-ons: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 26,
    name: 'IEBS Digital School Spain — Cristian',
    to: ['cristian@iebschool.com'],
    cc: ['info@iebschool.com'],
    subject: 'Complemento oficial de asistencia en Google Meet (sin bots) para IEBS Digital School, Cristian',
    text: `Hola Cristian,

Leyendo vuestro artículo en el Hub de IEBS Digital School (https://www.iebschool.com/hub/implementa-growth-hacking-etico-teniendo-en-cuenta-a-tus-personas-usuarias/) donde mencionáis herramientas para sesiones en Google Meet como tactiq.io, quería compartirte un complemento oficial pensado para escuelas de negocios, universidades y equipos remotos.

Como el informe nativo de asistencia de Google Meet exige cuentas Enterprise y no se activa en tutorías o grupos de menos de 5 personas, he desarrollado Attendance Tracker (https://attendancetracker.dev) sobre la API REST v2 nativa de Google Meet (en español). Registra entradas, salidas y duración en el panel lateral sin bots y exporta a Google Sheets o certificados PDF en un clic.

Enlaces útiles por si os sirven en IEBS:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Guía para universidades y escuelas de negocios: https://attendancetracker.dev/google-meet-attendance-for-universities.html
- Complemento oficial: https://attendancetracker.dev

Un cordial saludo,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 27,
    name: 'Learn Prompting',
    to: ['support@learnprompting.org'],
    cc: ['hello@learnprompting.org'],
    subject: 'Zero-bot Google Meet attendance add-on for Learn Prompting’s Productivity guide',
    text: `Hi Learn Prompting Editorial Team,

While reading your guide "Best AI Tools for Productivity in 2025" (https://learnprompting.org/blog/ai-tools-productivity) where you recommend tactiq.io for Google Meet sessions, I wanted to share our official Google Workspace Marketplace add-on, Attendance Tracker (https://attendancetracker.dev).

For educators, cohort instructors, and remote teams running live workshops or small-group sessions on Google Meet, Google's built-in attendance report requires Enterprise licenses and never fires under 5 participants. Built on the native Google Meet REST API v2, Attendance Tracker logs exact participant durations inside the Meet side panel without bots and exports to Google Sheets or PDF certificates in one click.

Helpful links if you update your productivity guide:
- University & cohort education attendance guide: https://attendancetracker.dev/google-meet-attendance-for-universities.html
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 28,
    name: 'All About AI',
    to: ['hello@allaboutai.com'],
    cc: ['info@allaboutai.com'],
    subject: 'Native Google Meet REST API v2 add-on for AllAboutAI.com',
    text: `Hi All About AI Editorial Team,

While reading your comparison article on AllAboutAI.com (https://www.allaboutai.com/comparison/perplexity-vs-chatgpt/) where you cite tactiq.io/learn/... for workflow productivity, I wanted to share our official Google Workspace Marketplace add-on, Attendance Tracker (https://attendancetracker.dev).

Unlike Chrome extensions that scrape DOM captions—or Google's built-in attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker runs on the native Google Meet REST API v2 inside the Meet side panel without bots, logging exact join/leave durations and exporting to Google Sheets in one click.

Helpful links if you expand your Google Workspace tools coverage:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 29,
    name: 'Pics.io',
    to: ['hello@pics.io'],
    cc: ['support@pics.io'],
    subject: 'Google Meet to Google Sheets attendance add-on for Pics.io’s Business Communication guide',
    text: `Hi Pics.io Editorial Team,

While reading your post "8 Best Business Communication Tools" (https://blog.pics.io/8-best-business-communication-tools-in-2024/) where you feature tactiq.io for Google Meet, I wanted to share a native Google Workspace Marketplace add-on that pairs naturally with Google Drive and Sheets workflows.

Because Google's native attendance report requires Enterprise plans and never fires on meetings under 5 people, I built Attendance Tracker (https://attendancetracker.dev) on the native Google Meet REST API v2. It tracks exact participant durations inside the Meet side panel without bots and exports formatted attendance logs directly to Google Sheets in one click.

Helpful links if you update your communication tools guide:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 30,
    name: 'OBSBOT',
    to: ['service@obsbot.com'],
    cc: ['marketing@obsbot.com'],
    subject: 'Official Google Meet REST API v2 side-panel add-on for OBSBOT’s Google Meet guide',
    text: `Hi OBSBOT Editorial & Marketing Team,

While reading your video conferencing guide "Top 7 AI Note Takers for Google Meet in 2026" (https://www.obsbot.com/blog/video-conferencing/ai-note-taker-for-google-meet) where you feature tactiq.io, I wanted to share a zero-bot Google Meet add-on built for educators, streamers, and remote teams using Google Meet.

Unlike Chrome extensions that scrape DOM elements—or Google's built-in attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It tracks exact participant join/leave durations inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand your Google Meet guides:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  }
];

function getLogFilePath() {
  const envPath = process.env.WAVE22_LOG_FILE ? process.env.WAVE22_LOG_FILE.trim() : '';
  return envPath || LOG_FILE;
}

function loadDispatchLog() {
  const logFile = getLogFilePath();
  if (fs.existsSync(logFile)) {
    const raw = fs.readFileSync(logFile, 'utf8').trim();
    if (!raw) return {};
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.error(`Error: Dispatch log at ${logFile} contains invalid JSON (${e.message}). Refusing to proceed to prevent duplicate sends.`);
      process.exit(1);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.getPrototypeOf(parsed) !== Object.prototype) {
      console.error(`Error: Dispatch log at ${logFile} must be a plain JSON object. Refusing to proceed to prevent duplicate sends.`);
      process.exit(1);
    }
    return parsed;
  }
  return {};
}

function saveDispatchLog(log) {
  const logFile = getLogFilePath();
  const dir = path.dirname(logFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(logFile, JSON.stringify(log, null, 2), 'utf8');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const isTest = args.includes('--test');
  const isDryRun = args.includes('--dry-run');
  const isSend = args.includes('--send');
  const isAll = args.includes('--all');
  const isForce = args.includes('--force');

  // Validate flags and support both --target=<id> and --target <id>
  const KNOWN_BOOL_FLAGS = new Set(['--test', '--dry-run', '--send', '--all', '--force']);
  const targetValues = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (KNOWN_BOOL_FLAGS.has(arg)) {
      continue;
    }
    if (arg.startsWith('--target=')) {
      targetValues.push(arg.slice('--target='.length));
      continue;
    }
    if (arg === '--target') {
      if (args[i + 1] && !args[i + 1].startsWith('--')) {
        targetValues.push(args[i + 1]);
        i++;
      } else {
        targetValues.push('');
      }
      continue;
    }
    console.error(`Unknown option: "${arg}".`);
    process.exit(1);
  }

  if (targetValues.length > 1) {
    console.error('Conflicting options: Cannot specify multiple --target flags.');
    process.exit(1);
  }

  const rawTarget = targetValues.length === 1 ? targetValues[0] : null;

  let targetId = null;
  if (rawTarget !== null) {
    if (!/^[1-9]\d*$/.test(rawTarget)) {
      console.error(`Invalid target ID: "${rawTarget}". Valid targets are 1-${TARGETS.length}.`);
      process.exit(1);
    }
    targetId = parseInt(rawTarget, 10);
    if (isNaN(targetId) || targetId < 1 || targetId > TARGETS.length) {
      console.error(`Invalid target ID: "${rawTarget}". Valid targets are 1-${TARGETS.length}.`);
      process.exit(1);
    }
  }

  if (isSend && isDryRun) {
    console.error('Conflicting options: Cannot specify both --send and --dry-run.');
    process.exit(1);
  }

  if (isSend && isTest) {
    console.error('Conflicting options: Cannot specify both --send and --test.');
    process.exit(1);
  }

  if (isTest && isDryRun) {
    console.error('Conflicting options: Cannot specify both --test and --dry-run.');
    process.exit(1);
  }

  if (isTest && isAll) {
    console.error('Conflicting options: Cannot specify both --test and --all.');
    process.exit(1);
  }

  if (isAll && targetId !== null) {
    console.error('Conflicting options: Cannot specify both --all and --target.');
    process.exit(1);
  }

  if (isForce && !isSend) {
    console.error('Conflicting options: --force can only be used with --send.');
    process.exit(1);
  }

  if (!isTest && !isDryRun && !isSend) {
    if (args.length > 0) {
      console.error('Missing action flag: Specify --dry-run, --test, or --send.');
      process.exit(1);
    }
    console.log(`
Wave 22 Outreach Dispatcher (30 Verified Backlink Outreach Targets)
Usage:
  node scripts/send-wave22-outreach.cjs --dry-run
  node scripts/send-wave22-outreach.cjs --dry-run --target=1
  node scripts/send-wave22-outreach.cjs --test
  node scripts/send-wave22-outreach.cjs --test --target=1
  node scripts/send-wave22-outreach.cjs --send --target=1
  node scripts/send-wave22-outreach.cjs --send --all
  node scripts/send-wave22-outreach.cjs --send --target=1 --force
`);
    process.exit(0);
  }

  if (isTest) {
    const sample = targetId !== null ? TARGETS.find(t => t.id === targetId) : TARGETS[0];
    if (!sample) {
      console.error(`Invalid target ID: ${targetId}. Valid targets are 1-${TARGETS.length}.`);
      process.exit(1);
    }
    console.log(`[TEST MODE] Sending preview of Target #${sample.id} (${sample.name}) to Derek's inbox: ${DEREK_INBOX}`);
    const payload = {
      from: SENDER,
      to: [DEREK_INBOX],
      reply_to: REPLY_TO,
      subject: `[TEST PREVIEW] ${sample.subject}`,
      text: `--- SENDER: ${SENDER} ---\n--- TARGET #${sample.id}: ${sample.name} ---\n--- ORIGINAL TO: ${sample.to.join(', ')} ---\n--- CC: ${sample.cc.join(', ') || 'none'} ---\n\n${sample.text}`
    };
    const res = await resend.emails.send(payload);
    if (res.error) {
      console.error(`[TEST ERROR] Failed to send preview:`, res.error);
      process.exit(1);
    } else {
      console.log(`Preview email dispatched! Resend ID: ${res.data ? res.data.id : 'ok'}`);
    }
    return;
  }

  const dispatchLog = loadDispatchLog();
  const queue = TARGETS.filter(t => {
    if (targetId !== null) return t.id === targetId;
    if (isAll || isDryRun) return true;
    return false;
  });

  if (queue.length === 0) {
    console.error(`No targets selected. Specify --target=<id> (1-${TARGETS.length}) or --all.`);
    process.exit(1);
  }

  let failureCount = 0;

  for (const item of queue) {
    const logKey = `target_${item.id}`;
    if (Object.prototype.hasOwnProperty.call(dispatchLog, logKey) && dispatchLog[logKey] && isSend && !isForce) {
      console.log(`[SKIPPED] Target #${item.id} (${item.name}) was already dispatched at ${dispatchLog[logKey].dispatchedAt} (Resend ID: ${dispatchLog[logKey].resendId})`);
      continue;
    }

    console.log(`\n==================================================`);
    console.log(`Target #${item.id}: ${item.name}`);
    console.log(`From:     ${SENDER}`);
    console.log(`Reply-To: ${REPLY_TO}`);
    console.log(`To:       ${item.to.join(', ')}`);
    console.log(`CC:       ${item.cc.join(', ') || 'none'}`);
    console.log(`Subject:  ${item.subject}`);
    console.log(`==================================================`);

    if (isDryRun) {
      console.log(`[DRY-RUN] Would send:\n\n${item.text}\n`);
      continue;
    }

    if (isSend) {
      console.log(`[SENDING] Dispatching to ${item.to.join(', ')}...`);
      try {
        const payload = {
          from: SENDER,
          to: item.to,
          reply_to: REPLY_TO,
          subject: item.subject,
          text: item.text
        };
        if (item.cc && item.cc.length > 0) {
          payload.cc = item.cc;
        }

        const res = await resend.emails.send(payload);
        if (res.error) {
          console.error(`[ERROR] Resend API error:`, res.error);
          failureCount++;
        } else {
          const resendId = res.data ? res.data.id : 'ok';
          console.log(`[SUCCESS] Dispatched Target #${item.id}! Resend ID: ${resendId}`);
          const logEntry = {
            targetId: item.id,
            name: item.name,
            to: item.to,
            subject: item.subject,
            dispatchedAt: new Date().toISOString(),
            resendId
          };
          if (item.cc && item.cc.length > 0) {
            logEntry.cc = item.cc;
          }
          dispatchLog[logKey] = logEntry;
          saveDispatchLog(dispatchLog);
        }
      } catch (err) {
        console.error(`[EXCEPTION] Failed sending to Target #${item.id}:`, err.message);
        failureCount++;
      }

      // 2-second rate-limit between dispatches
      await sleep(2000);
    }
  }

  if (failureCount > 0) {
    console.error(`\nCompleted with ${failureCount} dispatch failure(s).`);
    process.exit(1);
  }

  console.log(`\nAll done.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
