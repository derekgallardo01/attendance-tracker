#!/usr/bin/env node
/**
 * scripts/send-wave20-outreach.cjs
 *
 * Dedicated dispatcher for Wave 20 Backlink Outreach (30 Verified Targets):
 * - Carried-over Verified Reserve Targets from Wave 19 (Targets 1–15, DR 24–26)
 * - Global SaaS Publications, Newsletters, AI Directories & Workflow Guides (Targets 16–30, DR 22–43)
 *
 * Sends personalized, anti-AI founder emails from Derek Gallardo <derek@attendancetracker.dev>
 * via the Resend API with reply-to derek@attendancetracker.dev.
 *
 * Safety & Execution features:
 * 1. Deduplication log in `docs/wave20-dispatch-log.json` (overridable via `WAVE20_LOG_FILE`) to prevent duplicate sends.
 * 2. `--test` flag: dispatches a sample preview to derekgallardo01@gmail.com (supports `--target=<id>`).
 * 3. `--dry-run`: previews emails without calling Resend API (supports `--target=<id>` or all).
 * 4. `--send --target=<id>` or `--send --all`: executes live send with rate limiting.
 * 5. `--force`: overrides deduplication log when combined with `--send`.
 */

const fs = require('fs');
const path = require('path');
const { Resend } = require(path.resolve(__dirname, '../backend/node_modules/resend'));

function resolveResendApiKey() {
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

const RESEND_API_KEY = resolveResendApiKey();
const resend = new Resend(RESEND_API_KEY);

const SENDER = 'Derek Gallardo <derek@attendancetracker.dev>';
const REPLY_TO = 'derek@attendancetracker.dev';
const DEREK_INBOX = 'derekgallardo01@gmail.com';
const LOG_FILE = path.resolve(__dirname, '../docs/wave20-dispatch-log.json');

const TARGETS = [
  {
    id: 1,
    name: 'AionX',
    to: ['support@aionx.co'],
    cc: ['hello@aionx.co'],
    subject: 'Zero-bot Google Meet attendance add-on for AionX’s Team Collaboration guide',
    text: `Hi AionX Editorial Team,

While reading your guide "Claude Pro for Team Collaboration" (https://aionx.co/claude-ai-reviews/claude-pro-team-collaboration/), I noticed your link to tactiq.io for Google Meet workflows.

When distributed teams run standups or 1-on-1 check-ins on Google Meet, Google's built-in attendance report requires Enterprise seats and never fires on meetings under 5 participants. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that logs exact participant durations inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand your team collaboration tools:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 2,
    name: 'FVivas Spain',
    to: ['hola@fvivas.com'],
    cc: ['info@fvivas.com'],
    subject: 'Complemento oficial de asistencia en Google Meet (REST API v2, sin bots) para el directorio de FVivas',
    text: `Hola equipo de FVivas,

Revisando vuestra ficha y análisis de Tactiq en vuestro directorio (https://fvivas.com/es/ai/tactiq/), quería presentaros Attendance Tracker (https://attendancetracker.dev) como alternativa y complemento especializado para usuarios de Google Meet.

A diferencia de las extensiones de Chrome que raspan el DOM—o del informe nativo de Google que exige cuentas Enterprise y mínimo 5 participantes—Attendance Tracker es un complemento oficial en Google Workspace Marketplace construido sobre la API REST v2 nativa de Google Meet (en español). Registra entradas y salidas desde el panel lateral sin bots y exporta a Google Sheets en un clic.

Enlaces útiles para vuestro directorio:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Comparativa de extensiones y complementos: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Complemento oficial: https://attendancetracker.dev

Un cordial saludo,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 3,
    name: 'Do Ngoc Hoan Vietnam',
    to: ['contact@dongochoan.com'],
    cc: ['hello@dongochoan.com'],
    subject: 'Tiện ích điểm danh Google Meet chính thức (REST API v2, Tiếng Việt) cho bài viết trên dongochoan.com',
    text: `Chào anh Đỗ Ngọc Hoàn,

Khi đọc bài đánh giá công cụ họp Google Meet trên blog của anh (https://www.dongochoan.com/blog/tactiq-free-ai-meeting-note-takers-vietnamese), mình muốn chia sẻ thêm một tiện ích Google Workspace chính thức hỗ trợ tiếng Việt dành cho giáo viên và nhóm làm việc từ xa.

Vì báo cáo điểm danh mặc định của Google Meet yêu cầu gói Enterprise và không hoạt động khi cuộc họp dưới 5 người, mình đã phát triển Attendance Tracker (https://attendancetracker.dev) trên nền Google Meet REST API v2 gốc. Tiện ích chạy trực tiếp trong thanh bên Google Meet không cần bot và xuất danh sách điểm danh ra Google Sheets chỉ với 1 cú nhấp chuột.

Một số liên kết hữu ích nếu anh cập nhật bài viết:
- Hướng dẫn điểm danh Google Meet (Tiếng Việt): https://attendancetracker.dev/diem-danh-google-meet.html
- So sánh các tiện ích điểm danh Google Meet: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Tiện ích chính thức: https://attendancetracker.dev

Trân trọng,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 4,
    name: 'AINOW Japan',
    to: ['info@ainow.jp'],
    cc: ['contact@ainow.jp'],
    subject: '【AINOW様】Google Meet REST API v2対応・日本語版出席管理アドオンのご紹介',
    text: `AINOW 編集部 ご担当者様

いつもAINOWのAI・業務効率化に関する記事（https://ainow.jp/）を拝読しております。貴メディアにてGoogle Meet関連ツールとして tactiq.io を紹介されている記事を拝見し、ご連絡いたしました。

Google Meet標準の出席レポートはWorkspace Enterpriseプラン限定かつ5名以上の会議でしか作動しないため、私はネイティブのGoogle Meet REST API v2上で動作する公式Google Workspace Marketplaceアドオン「Attendance Tracker」（https://attendancetracker.dev）を開発いたしました（日本語UI完全対応）。ボット不要でサイドパネルから正確な入退室時間を記録し、ワンクリックでGoogleスプレッドシートへ出力できます。

会議効率化記事の補足リソースとしてぜひご検討ください。
- Google Meet出席確認ガイド：https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- リモートチーム向け出席管理：https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- 公式アドオン：https://attendancetracker.dev

どうぞよろしくお願いいたします。

Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 5,
    name: 'Aguacatec Spain',
    to: ['hola@aguacatec.es'],
    cc: ['contacto@aguacatec.es'],
    subject: 'Control de asistencia en Google Meet (REST API v2, sin bots) para la guía de Aguacatec',
    text: `Hola equipo de Aguacatec,

Leyendo vuestro tutorial "Tomar notas automáticas en Google Meet" (https://aguacatec.es/tomar-notas-automaticas-en-google-meet/) donde recomendáis tactiq.io, quería compartir con vosotros un complemento oficial de Google Workspace pensado para quienes usan Google Meet a diario.

Como el informe nativo de asistencia de Google Meet exige cuentas Enterprise y nunca se activa en llamadas de menos de 5 personas, he desarrollado Attendance Tracker (https://attendancetracker.dev). Funciona sobre la API REST v2 nativa de Google Meet (en español), registrando entradas y salidas en el panel lateral sin bots y exportando a Google Sheets en un clic.

Enlaces útiles por si deseáis ampliar vuestra guía de Google Meet:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Paso a paso para registrar asistencia en Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Complemento oficial: https://attendancetracker.dev

Un saludo cordial,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 6,
    name: 'Gest24 Italy',
    to: ['info@gest24.com'],
    cc: ['redazione@gest24.com'],
    subject: 'Add-on ufficiale Google Meet (REST API v2, senza bot) per la guida di Gest24',
    text: `Gentile Redazione di Gest24,

leggendo la vostra guida "AI Tools Marketing e Vendite 2026" (https://gest24.com/ai-tools-marketing-vendite-2026/) in cui citate tactiq.io per i meeting su Google Meet, volevo segnalarvi uno strumento complementare pensato per team commerciali e remoti.

Poiché il report presenze nativo di Google Meet richiede piani Enterprise e non si attiva mai nelle call sotto i 5 partecipanti, ho sviluppato Attendance Tracker (https://attendancetracker.dev): un add-on ufficiale sul Google Workspace Marketplace basato sulla Google Meet REST API v2 nativa (con interfaccia in italiano) che registra orari e durate nel pannello laterale senza bot ed esporta su Google Sheets in un clic.

Link utili se vorrete aggiornare la vostra guida:
- Guida presenze Google Meet per team remoti: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Esportare le presenze Google Meet su Google Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Add-on ufficiale: https://attendancetracker.dev

Cordiali saluti,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 7,
    name: 'Furlan Webdesigner France',
    to: ['contact@furlan-webdesigner.fr'],
    cc: ['bonjour@furlan-webdesigner.fr'],
    subject: 'Module officiel de présence Google Meet (API REST v2, sans bot) pour votre guide webdesigner',
    text: `Bonjour,

En lisant votre article sur les outils de productivité pour webdesigners (https://furlan-webdesigner.fr/chatgpt-outil-webdesigner/) où vous mentionnez tactiq.io pour vos réunions clients sur Google Meet, je souhaitais vous partager un module officiel sans bot très pratique pour les freelances et agences.

Lors des appels clients 1-à-1 sur Google Meet, le rapport de présence natif de Google ne se déclenche jamais (il exige un forfait Enterprise et au moins 5 participants). J'ai créé Attendance Tracker (https://attendancetracker.dev), un module officiel sur le Google Workspace Marketplace basé sur l'API REST v2 native de Google Meet (en français) qui note les durées exactes d'appel dans le panneau latéral et exporte vers Google Sheets en un clic.

Quelques liens utiles pour compléter votre article :
- Guide pour les équipes et freelances à distance : https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporter les présences Google Meet vers Sheets : https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Module officiel : https://attendancetracker.dev

Bien cordialement,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 8,
    name: 'NexTool AI',
    to: ['hello@nextool.ai'],
    cc: ['support@nextool.ai'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for NexTool AI',
    text: `Hi NexTool AI Editorial Team,

While reading your NexTool AI newsletter and directory (https://newsletter.nextool.ai/p/why-is-openai-working-with-governments) where you cover tactiq.io and workplace productivity tools, I wanted to share Attendance Tracker (https://attendancetracker.dev).

Unlike Chrome extensions that scrape DOM captions—or Google's built-in attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker is an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2. It tracks participant join/leave durations inside the Meet side panel and exports to Google Sheets in one click.

Helpful links for your directory or upcoming issues:
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
    name: 'TheWearify',
    to: ['admin@thewearify.com'],
    cc: ['hello@thewearify.com'],
    subject: 'Native Google Meet REST API v2 add-on for TheWearify’s Meeting Agents roundup',
    text: `Hi TheWearify Editorial Team,

While reading your roundup on AI meeting agents and assistants (https://thewearify.com/ai-meeting-agents/) where you feature tactiq.io for Google Meet, I wanted to share a zero-bot Google Workspace Marketplace add-on for your readers.

Because Google's native attendance report requires Enterprise licenses and won't trigger on calls under 5 people, I built Attendance Tracker (https://attendancetracker.dev) on the native Google Meet REST API v2. It opens right inside the Google Meet side panel without intrusive bots, merges reconnects automatically, and exports attendance to Google Sheets in one click.

Helpful links if you update your Google Meet guide:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 10,
    name: 'FindMyAITool',
    to: ['hello@findmyaitool.io'],
    cc: ['support@findmyaitool.io'],
    subject: 'Adding Attendance Tracker (Google Meet REST API v2) to FindMyAITool’s Meeting Assistant category',
    text: `Hi FindMyAITool Team,

While browsing your AI Meeting Assistant category (https://findmyaitool.io/tool-category/ai-meeting-assistant/) featuring tactiq.io, I wanted to share Attendance Tracker (https://attendancetracker.dev) for consideration on FindMyAITool.

Instead of injecting recording bots or relying on fragile DOM-scraping Chrome extensions, Attendance Tracker is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It tracks exact participant join/leave durations inside the Google Meet side panel on any call size and exports to Google Sheets in one click.

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
    id: 11,
    name: 'The Xperts Pakistan',
    to: ['info@thexperts.pk'],
    cc: ['thexpert.services@gmail.com'],
    subject: 'Zero-bot Google Meet attendance add-on for The Xperts Pakistan’s productivity guide',
    text: `Hi The Xperts Editorial Team,

While reading your productivity tools guide (https://thexperts.pk/artificial-intelligence-ai/8-notion-ai-alternatives-worth-considering-in-2025-the-xperts-pakistan/) where you link to tactiq.io for meeting workflows, I wanted to share our official Google Workspace Marketplace add-on, Attendance Tracker (https://attendancetracker.dev).

Because Google's native attendance report requires paid Enterprise seats and never fires on meetings under 5 participants, remote teams and educators use our native Google Meet REST API v2 add-on (localized in 44 languages, including English and Urdu) to log exact join/leave durations inside the Meet side panel and export to Google Sheets in one click.

Useful links if you update your article:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 12,
    name: 'JNG Web France',
    to: ['contact@jng-web.com'],
    cc: ['info@jng-web.com'],
    subject: 'Module officiel Google Meet (API REST v2, sans bot) pour le labo JNG Web',
    text: `Bonjour l'équipe JNG Web,

En lisant votre article sur l'automatisation des réunions (https://jng-web.com/labo/generer-le-resume-dune-reunion-teams-automatiquement/) où vous mentionnez tactiq.io pour Google Meet et Teams, je souhaitais vous présenter un module complémentaire sans bot pour Google Meet.

Comme le rapport de présence natif de Google Meet exige un abonnement Enterprise et au moins 5 participants, j'ai développé Attendance Tracker (https://attendancetracker.dev). Ce module officiel du Google Workspace Marketplace utilise l'API REST v2 native de Google Meet (en français) pour enregistrer les durées de présence dans le panneau latéral et exporter vers Google Sheets en un clic.

Liens utiles pour compléter votre article :
- Suivi de présence pour équipes à distance : https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporter les présences Google Meet vers Sheets : https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Module officiel : https://attendancetracker.dev

Bien cordialement,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 13,
    name: 'Rizal Consulting Indonesia',
    to: ['info@rizalconsulting.id'],
    cc: ['rizalconsultingid@gmail.com'],
    subject: 'Add-on absensi Google Meet resmi (REST API v2, Bahasa Indonesia) untuk blog Rizal Consulting',
    text: `Halo Tim Rizal Consulting,

Saat membaca artikel ulasan produktivitas Anda (https://rizalconsulting.id/blog/review-ulasan/tingkatkan-produktivitasmu-dengan-ai-video-summarizer-gratis) yang merekomendasikan tactiq.io untuk rapat virtual, saya ingin memperkenalkan add-on resmi Google Workspace untuk pengguna Google Meet di Indonesia.

Karena laporan kehadiran bawaan Google Meet membutuhkan lisensi Enterprise dan tidak aktif pada rapat di bawah 5 peserta, saya membuat Attendance Tracker (https://attendancetracker.dev) berbasis Google Meet REST API v2 asli (dengan antarmuka Bahasa Indonesia). Add-on ini mencatat jam masuk/keluar peserta di panel samping tanpa bot dan mengekspornya ke Google Sheets dalam satu klik.

Tautan bermanfaat jika Anda memperbarui artikel tersebut:
- Panduan absensi Google Meet untuk pengajar & konsultan di Indonesia: https://attendancetracker.dev/google-meet-attendance-indonesia-teachers.html
- Panduan untuk tim remote: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Add-on resmi: https://attendancetracker.dev

Salam hangat,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 14,
    name: 'BrassTranscripts',
    to: ['support@brasstranscripts.com'],
    cc: ['hello@brasstranscripts.com'],
    subject: 'Non-competing Google Meet attendance link for your BrassTranscripts vs Tactiq post',
    text: `Hi BrassTranscripts Team,

While reading your comparison "BrassTranscripts vs Tactiq: Honest Comparison" (https://brasstranscripts.com/blog/brasstranscripts-vs-tactiq-honest-comparison), I noticed you include an outbound link to rival tactiq.io.

Since Attendance Tracker (https://attendancetracker.dev) does zero audio recording or transcription, it's a 100% non-competing Google Meet companion for BrassTranscripts readers. Built on the native Google Meet REST API v2 as an official Google Workspace Marketplace add-on, it tracks exact participant join/leave durations inside the Meet side panel without bots and exports to Google Sheets in one click.

Helpful links if you'd like to cite a non-competing resource:
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 15,
    name: 'EONSR Vietnam — Smith & Howard',
    to: ['smith@eonsr.com'],
    cc: ['howard@eonsr.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on (with Vietnamese UI) for EONSR’s PM guide',
    text: `Hi Smith and Howard,

While reading your project management meeting guide on EONSR (https://eonsr.com/vi/tom-tat-cuoc-hop-thong-minh-va-theo-doi-muc-hanh-dong-trong-microsoft-teams-giup-ich-gi-cho-cac-chuyen-gia-quan-ly-du-an/) where you link to tactiq.io, I wanted to share our official Google Workspace Marketplace add-on, Attendance Tracker (https://attendancetracker.dev), localized in both Vietnamese and English.

When project managers run daily standups or stakeholder syncs on Google Meet, Google's native attendance report requires Enterprise seats and never triggers on calls under 5 participants. Attendance Tracker uses the native Google Meet REST API v2 to log exact durations in the Meet side panel without bots and export to Google Sheets in one click.

Helpful links if you update your project management resources:
- Vietnamese Google Meet attendance guide: https://attendancetracker.dev/diem-danh-google-meet.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 16,
    name: 'Signalbase',
    to: ['hello@trysignalbase.com'],
    cc: ['contact@trysignalbase.com'],
    subject: 'Native Google Meet REST API v2 add-on for Signalbase’s meeting intelligence coverage',
    text: `Hi Signalbase Editorial Team,

While reading your coverage of Google Meet workflow tools on Signalbase (https://www.trysignalbase.com/news/funding/tactiq-raises-100) linking to tactiq.io, I wanted to share how we approached Google Meet attendance using Google's new native architecture.

Instead of relying on DOM-scraping Chrome extensions or intrusive meeting bots—and because Google's native report requires Enterprise seats and 5+ participants—we built Attendance Tracker (https://attendancetracker.dev) as an official Google Workspace Marketplace add-on on the native Google Meet REST API v2. It runs inside the Meet side panel, merges reconnects automatically, and exports to Google Sheets in one click.

Helpful links if you cover Google Workspace add-ons:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 17,
    name: 'AI PICKS Magazine Japan',
    to: ['info@aipicks.jp'],
    cc: ['contact@aipicks.jp'],
    subject: '【AI PICKSマガジン様】Google Meet REST API v2対応・日本語版出席管理アドオンのご紹介',
    text: `AI PICKSマガジン 編集部 ご担当者様

貴メディアの比較記事「Manus と ChatGPT を比較、性能とコストで選ぶ判断基準 (2026年版)」（https://aipicks.jp/mag/manus-vs-chatgpt-comparison-2026）にて、外部リソースとして tactiq.io/ja/learn/... を参照されているのを拝見し、ご連絡いたしました。

Google Meetの標準出席レポートはEnterpriseプラン限定かつ5名未満の会議では出力されないため、私はネイティブのGoogle Meet REST API v2上で動作する公式Google Workspace Marketplaceアドオン「Attendance Tracker」（https://attendancetracker.dev）を開発いたしました（日本語UI完備）。ボット不要でサイドパネルから参加・退出時間を自動記録し、ワンクリックでGoogleスプレッドシートへ出力します。

業務効率化ツールの補足リソースとしてご活用いただけましたら幸いです。
- Google Meet出席確認ガイド：https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- リモートチーム向け出席管理：https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- 公式アドオン：https://attendancetracker.dev

どうぞよろしくお願いいたします。

Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 18,
    name: 'ProgrammiFree Italy',
    to: ['info@programmifree.com'],
    cc: ['redazione@programmifree.com'],
    subject: 'Add-on ufficiale Google Meet (REST API v2, con piano gratuito) per ProgrammiFree',
    text: `Gentile Redazione di ProgrammiFree,

leggendo la vostra scheda dedicata agli strumenti per Google Meet (https://www.programmifree.com/web/schede/tactiq-riassunto-meeting-tramite-gpt.htm), volevo segnalarvi Attendance Tracker (https://attendancetracker.dev), un add-on ufficiale sul Google Workspace Marketplace con piano gratuito e interfaccia completamente in italiano.

A differenza delle estensioni Chrome che leggono il DOM (o del report nativo di Google che richiede un piano Enterprise e almeno 5 partecipanti), Attendance Tracker usa la Google Meet REST API v2 nativa per registrare gli orari di ingresso e uscita direttamente nel pannello laterale senza bot ed esportare i dati su Google Sheets in un clic.

Link utili per una scheda o come risorsa correlata:
- Come tracciare le presenze su Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Confronto migliori estensioni e add-on Google Meet: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Add-on ufficiale: https://attendancetracker.dev

Un cordiale saluto,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 19,
    name: 'Choge Blog Japan (ちょげぶろぐ)',
    to: ['info@choge-blog.com'],
    cc: ['contact@choge-blog.com'],
    subject: '【ちょげぶろぐ様】Web会議記事へのGoogle Meet公式出席管理アドオン（日本語対応）のご提案',
    text: `ちょげぶろぐ 運営者様

貴ブログの記事「会議時間制限を徹底解説｜無料版・有料版の違いと対処法」（https://www.choge-blog.com/programming/microsoft-teams-limit/）にて、Web会議リソースとして tactiq.io/learn/teams-meeting-limit を参照されているのを拝見し、ご連絡いたしました。

Google Meetでは、無料版や通常のビジネスプランでは標準の出席レポート機能が使えず（Enterpriseプランかつ5名以上が必須）、参加時間の記録に手間がかかります。私が開発した公式Google Workspace Marketplaceアドオン「Attendance Tracker」（https://attendancetracker.dev）は、Google Meet REST API v2ネイティブ対応（日本語UI完備）で、ボット不要でサイドパネルから入退室時間を記録し、ワンクリックでGoogleスプレッドシートへ出力できます。

Web会議関連の補足リソースとしてぜひご検討ください。
- Google Meet出席確認ガイド：https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- リモートチーム向け出席管理：https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- 公式アドオン：https://attendancetracker.dev

どうぞよろしくお願いいたします。

Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 20,
    name: 'AI Kaptan',
    to: ['contact@aikaptan.com'],
    cc: ['hello@aikaptan.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for AI Kaptan’s directory',
    text: `Hi AI Kaptan Editorial Team,

While checking out your review page "Tactiq - AI Tool Review & Features" (https://www.aikaptan.com/tools/tactiq), I wanted to share Attendance Tracker (https://attendancetracker.dev) for your Google Meet tools directory and alternatives section.

Unlike Chrome extensions that scrape DOM captions—or Google's built-in attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker is an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2. It logs exact participant durations inside the Meet side panel and exports to Google Sheets in one click.

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
    id: 21,
    name: 'AI Journey',
    to: ['admin@aijourney.so'],
    cc: ['ceo@aijourney.so'],
    subject: 'Non-competing Google Meet REST API v2 add-on for AI Journey’s AI Academy',
    text: `Hi AI Journey Team,

While reading your AI Academy article "MinutesLink: The Best Tactiq Alternative for Meeting Transcription" (https://aijourney.so/ai-academy/minuteslink-tactiq-alternative), I wanted to share a zero-bot Google Meet companion that pairs with transcription tools without competing with them.

Because Google's native attendance report requires Enterprise licenses and won't trigger on calls under 5 people, I built Attendance Tracker (https://attendancetracker.dev)—an official Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact participant join/leave durations inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand your Google Meet tools coverage:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 22,
    name: 'VozToVoice',
    to: ['info@voztovoice.org'],
    cc: ['contacto@voztovoice.org'],
    subject: 'Complemento oficial de asistencia en Google Meet (sin bots) para los lectores de VozToVoice',
    text: `Hola equipo editorial de VozToVoice,

Leyendo vuestro análisis comparativo en VozToVoice (https://www.voztovoice.org/?q=node/3103) donde enlazáis a tactiq.io como recurso de productividad, quería presentaros un complemento oficial de Google Workspace para usuarios hispanohablantes de Google Meet.

Dado que el reporte nativo de asistencia de Google Meet requiere cuentas Enterprise y nunca se activa en llamadas con menos de 5 participantes, desarrollé Attendance Tracker (https://attendancetracker.dev). Está construido sobre la API REST v2 nativa de Google Meet (en español), registra entradas y salidas en el panel lateral sin bots y exporta a Google Sheets en un clic.

Enlaces útiles por si deseáis compartirlo con vuestros lectores:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Guía para equipos remotos: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Complemento oficial: https://attendancetracker.dev

Un cordial saludo,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 23,
    name: 'What AI Do I Need',
    to: ['info@whataidoineed.com'],
    cc: ['hello@whataidoineed.com'],
    subject: 'Bot-free Google Meet REST API v2 add-on for WhatAIDoINeed.com',
    text: `Hi What AI Do I Need Team,

While reading your review "Tactiq Review 2026: Bot-Free AI Meeting Notes" (https://whataidoineed.com/tool/tactiq), I noticed you highlight why users prefer bot-free Google Meet tools.

For teams and educators who want bot-free Google Meet attendance tracking without installing DOM-scraping Chrome extensions—especially on calls under 5 participants where Google's native report never fires—I built Attendance Tracker (https://attendancetracker.dev). It's an official Google Workspace Marketplace add-on running on the native Google Meet REST API v2 inside the Meet side panel with one-click Google Sheets export.

Helpful links for your alternatives or related tools section:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 24,
    name: 'Kylon',
    to: ['hello@kylon.io'],
    cc: ['privacy@kylon.io'],
    subject: 'Privacy-first Google Meet REST API v2 add-on for Kylon’s Team Collaboration guide',
    text: `Hi Kylon Team,

While reading your post "7 Best Claude Cowork Alternatives for Teams (2026)" (https://kylon.io/blog/claude-cowork-alternatives) where you link to tactiq.io for team meetings, I wanted to share a privacy-first, zero-bot Google Meet add-on.

Because Google's native attendance report requires Enterprise seats and refuses to fire on meetings under 5 people, I built Attendance Tracker (https://attendancetracker.dev) as an official Google Workspace Marketplace add-on on the native Google Meet REST API v2. It tracks exact participant durations inside the Meet side panel without recording audio or injecting bots, and exports to Google Sheets in one click.

Helpful links if you expand your team productivity stack:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 25,
    name: 'Meeting Reminders',
    to: ['support@meeting-reminders.com'],
    cc: ['hello@meeting-reminders.com'],
    subject: 'Complementary Google Meet REST API v2 add-on for Meeting Reminders’ blog',
    text: `Hi Meeting Reminders Team,

While reading your article "History and Evolution of Google Meet" (https://docs.meeting-reminders.com/blog/google_meets_history/) where you link out to tactiq.io, I wanted to reach out since our two tools complement each other cleanly—you make sure people join on time, and we log their attendance once they arrive.

Built on the native Google Meet REST API v2 as an official Google Workspace Marketplace add-on, Attendance Tracker (https://attendancetracker.dev) runs inside the Google Meet side panel without bots, tracks exact join/leave durations on any call size (even under 5 participants), and exports to Google Sheets in one click.

Complementary links if you'd like to cite them in your Google Meet guide:
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 26,
    name: 'Office no Mori Japan (officeの杜)',
    to: ['info@officeforest.org'],
    cc: ['contact@officeforest.org'],
    subject: '【officeの杜様】Google Workspace記事へのGoogle Meet公式出席管理アドオン（日本語対応）のご提案',
    text: `officeの杜 運営者様

貴サイトの解説記事「2025年アップデート Google Geminiの新機能」（https://officeforest.org/wp/2025%E5%B9%B4%E3%82%A2%E3%83%83%E3%83%97%E3%83%87%E3%83%BC%E3%83%88-google-gemini%E3%81%AE%E6%96%B0%E6%A9%9F%E8%83%BD/）にて、Google Meet関連ツールとして tactiq.io を紹介されているのを拝見し、ご連絡いたしました。

Google Meet標準の出席レポートはEnterpriseプラン限定かつ5名以上の会議でしか作動しないため、私はネイティブのGoogle Meet REST API v2上で動作する公式Google Workspace Marketplaceアドオン「Attendance Tracker」（https://attendancetracker.dev）を開発いたしました（日本語UI完全対応）。ボット不要でサイドパネルから正確な参加時間を記録し、ワンクリックでGoogleスプレッドシートへ出力できます。

Google Workspace活用記事の補足リソースとしてぜひご検討ください。
- Google Meet出席確認ガイド：https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Googleスプレッドシート自動出力：https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- 公式アドオン：https://attendancetracker.dev

どうぞよろしくお願いいたします。

Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 27,
    name: 'FreeShiuan Taiwan (Shiuan)',
    to: ['shiuan@freeshiuan.com'],
    cc: ['hello@freeshiuan.com'],
    subject: '推薦給 Shiuan 讀者的 Google Meet 官方免機器人出席紀錄外掛（支援繁體中文）',
    text: `Shiuan 您好：

剛拜讀了您部落格上的深度評測「Plaud Note Pro 評價｜2026 實測 30 天」（https://freeshiuan.com/plaud-ai-meeting-review/），看到文中提及線上 Google Meet 會議工具 tactiq.io，因此想與您分享一款無須錄音機器人的 Google Meet 官方出席追蹤工具。

因為 Google Meet 內建出席報告僅限 Enterprise 企業版且滿 5 人以上才會觸發，我基於原生 Google Meet REST API v2 開發了官方 Google Workspace Marketplace 附加元件「Attendance Tracker」（https://attendancetracker.dev，完整支援繁體中文介面）。它能直接在 Meet 側邊欄自動記錄每位與會者的精確進出時間，並一鍵匯出至 Google 試算表。

提供以下連結供您未來撰寫遠距工作或 Google Meet 主題時參考：
- Google Meet 點名與擴充功能評比：https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- 遠距團隊 Google Meet 出席管理指南：https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- 官方附加元件：https://attendancetracker.dev

祝 順心
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 28,
    name: 'Nerdin Brazil',
    to: ['contato@nerdin.com.br'],
    cc: ['comercial@nerdin.com.br'],
    subject: 'Add-on oficial de presença no Google Meet (REST API v2) para o Guia de Ferramentas do Nerdin',
    text: `Olá equipe do Nerdin,

Lendo o "Guia de Ferramentas de Inteligência Artificial" de vocês (https://nerdin.com.br/guia_ferramentas_inteligencia_artificial.php) onde vocês recomendam o tactiq.io para reuniões no Google Meet, gostaria de compartilhar uma ferramenta oficial pensada para recrutadores de TI e squads remotos.

Nas entrevistas técnicas 1-on-1 ou dailies pequenas pelo Google Meet, o relatório nativo de presença do Google nunca é gerado (pois exige planos Enterprise e mínimo de 5 participantes). Criei o Attendance Tracker (https://attendancetracker.dev), um add-on oficial no Google Workspace Marketplace baseado na API REST v2 nativa do Google Meet (em português) que registra horários exatos no painel lateral sem bots e exporta para o Google Sheets em um clique.

Links úteis para complementar o guia do Nerdin:
- Lista de presença no Google Meet (PT-BR): https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Guia para entrevistas de emprego no Google Meet: https://attendancetracker.dev/google-meet-attendance-for-job-interviews.html
- Add-on oficial: https://attendancetracker.dev

Um abraço,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 29,
    name: 'Ninja do Excel Brazil',
    to: ['contato@ninjadoexcel.com.br'],
    cc: ['atendimento@ninjadoexcel.com.br'],
    subject: 'Exportar lista de presença do Google Meet para Google Sheets e Excel (para o Ninja do Excel)',
    text: `Olá equipe do Ninja do Excel,

Lendo o tutorial de vocês (https://ninjadoexcel.com.br/como-transcrever-video-youtube/) onde vocês indicam ferramentas do tactiq.io, lembrei de uma dúvida muito comum entre usuários de Google Sheets e Excel que dão treinamentos ou fazem reuniões no Google Meet.

Como o relatório nativo de presença do Google Meet exige licenças Enterprise e não funciona em chamadas com menos de 5 pessoas, desenvolvi o Attendance Tracker (https://attendancetracker.dev): um add-on oficial no Google Workspace Marketplace construído na API REST v2 nativa do Google Meet (em português) que registra entradas e saídas no painel lateral sem bots e exporta planilhas prontas para o Google Sheets ou Excel em um clique.

Links úteis caso queiram indicar para os alunos e leitores:
- Exportar presença do Google Meet para o Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Lista de presença no Google Meet (PT-BR): https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Add-on oficial: https://attendancetracker.dev

Atenciosamente,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 30,
    name: 'AI Hunt',
    to: ['hello@aihunt.app'],
    cc: ['support@aihunt.app'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for AI Hunt’s Tactiq Alternatives page',
    text: `Hi AI Hunt Team,

While viewing your page "Tactiq Information, Pricing and Alternatives 2026" (https://aihunt.app/products/tactiq), I wanted to share Attendance Tracker (https://attendancetracker.dev) for your Google Meet alternatives section.

Unlike Chrome extensions that scrape DOM captions—or Google's built-in attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker is an official zero-bot Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It tracks exact participant join/leave durations inside the Google Meet side panel and exports to Google Sheets in one click.

Helpful links for your directory:
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
  const envPath = process.env.WAVE20_LOG_FILE ? process.env.WAVE20_LOG_FILE.trim() : '';
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
Wave 20 Outreach Dispatcher (30 Verified Backlink Outreach Targets)
Usage:
  node scripts/send-wave20-outreach.cjs --dry-run
  node scripts/send-wave20-outreach.cjs --dry-run --target=1
  node scripts/send-wave20-outreach.cjs --test
  node scripts/send-wave20-outreach.cjs --test --target=1
  node scripts/send-wave20-outreach.cjs --send --target=1
  node scripts/send-wave20-outreach.cjs --send --all
  node scripts/send-wave20-outreach.cjs --send --target=1 --force
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
