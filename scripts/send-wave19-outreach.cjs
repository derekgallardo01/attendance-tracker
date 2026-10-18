#!/usr/bin/env node
/**
 * scripts/send-wave19-outreach.cjs
 *
 * Dedicated dispatcher for Wave 19 Backlink Outreach (30 Verified Targets):
 * - Carried-over Verified Reserve Targets from Wave 18 (Targets 1–15, DR 26–30)
 * - Global SaaS Publications, Newsletters, AI Directories, Broken Link & Workflow Guides (Targets 16–30, DR 14–32)
 *
 * Sends personalized, anti-AI founder emails from Derek Gallardo <derek@attendancetracker.dev>
 * via the Resend API with reply-to derek@attendancetracker.dev.
 *
 * Safety & Execution features:
 * 1. Deduplication log in `docs/wave19-dispatch-log.json` (overridable via `WAVE19_LOG_FILE`) to prevent duplicate sends.
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
const LOG_FILE = path.resolve(__dirname, '../docs/wave19-dispatch-log.json');

const TARGETS = [
  {
    id: 1,
    name: 'UsefulAI',
    to: ['hello@usefulai.com'],
    cc: ['support@usefulai.com'],
    subject: 'Adding Attendance Tracker (Google Meet REST API v2) to UsefulAI’s Meeting Assistants directory',
    text: `Hi UsefulAI Editorial Team,

While browsing your "Best AI Meeting Assistants in 2026" directory (https://usefulai.com/tools/ai-meeting-assistants) where you feature tactiq.io for Google Meet, I wanted to share Attendance Tracker (https://attendancetracker.dev) for consideration.

Unlike Chrome extensions that scrape DOM captions—or Google's native attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker is an official zero-bot Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It tracks exact participant join/leave durations inside the Meet side panel and exports to Google Sheets in one click.

Helpful links for your directory:
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
    name: 'ShortVids',
    to: ['hello@shortvids.co'],
    cc: ['support@shortvids.co'],
    subject: 'Zero-bot Google Meet attendance add-on for ShortVids’ content repurposing guide',
    text: `Hi ShortVids Team,

While reading "The Ultimate Guide to Repurposing Long-form Content" (https://shortvids.co/how-to-repurpose-long-form-content/) where you recommend tactiq.io for recording and repurposing Google Meet webinars, I wanted to share a zero-bot Google Meet companion built for webinar hosts and remote teams.

Because Google's native attendance report requires Enterprise plans and won't trigger on calls under 5 people, I built Attendance Tracker (https://attendancetracker.dev)—an official Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact attendee durations in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand your webinar & video workflow tools:
- Webinars & training attendance guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 3,
    name: 'ProdShort',
    to: ['contact@prodshort.com'],
    cc: ['hello@prodshort.com'],
    subject: 'Google Workspace Marketplace attendance add-on for ProdShort’s Chromebook guide',
    text: `Hi ProdShort Editorial Team,

While reading your Chromebook tutorial (https://prodshort.com/blog/how-to-record-your-screen-on-chromebook), I noticed your link to tactiq.io/learn/screen-record-on-chromebook.

For teachers, students, and Chromebook users running classes or meetings on Google Meet, Google's built-in attendance report requires paid Enterprise licenses and never fires on sessions under 5 people. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on built on the native Google Meet REST API v2 that works on any Chromebook without heavy browser extensions and exports attendance to Google Sheets in one click.

Useful links if you update your Google Workspace resources:
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Guide for teachers & schools: https://attendancetracker.dev/attendance-tracker-for-teachers.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 4,
    name: 'MeowTxt',
    to: ['support@meowtxt.com'],
    cc: ['hello@meowtxt.com'],
    subject: 'Non-competing Google Meet attendance companion for MeowTxt’s blog',
    text: `Hi MeowTxt Team,

While reading your post "The 12 Best Meeting Transcription App Choices" (https://www.meowtxt.com/blog/meeting-transcription-app), I noticed you link out to rival tactiq.io.

Since Attendance Tracker (https://attendancetracker.dev) does zero audio recording or transcription, it's a 100% non-competing Google Meet companion for MeowTxt users. Built on the native Google Meet REST API v2 as an official Google Workspace Marketplace add-on, it runs inside the Meet side panel without bots, merges reconnects on any call size, and exports attendance to Google Sheets in one click.

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
    id: 5,
    name: 'Ask Maeve — Richard & Viktor',
    to: ['richard@ask-maeve.com'],
    cc: ['viktor@ask-maeve.com'],
    subject: 'Zero-bot Google Meet lecture attendance add-on for Ask Maeve’s blog',
    text: `Hi Richard and Viktor,

While reading your guide "10 Best Apps for Recording Lectures" on Ask Maeve (https://www.ask-maeve.com/blog/apps-for-recording-lectures/), I noticed you link to tactiq.io/learn/top-10-lecture-recording-apps-for-students.

Since Ask Maeve helps students and educators with lecture study tools—and we don't compete on study notes or transcription—I wanted to share Attendance Tracker (https://attendancetracker.dev). Built on the native Google Meet REST API v2 as an official Google Workspace Marketplace add-on, it lets university lecturers and teachers track seminar attendance inside the Meet side panel without bots and export to Google Sheets in one click.

Helpful links if you expand your education guides:
- University lectures & seminars guide: https://attendancetracker.dev/google-meet-attendance-for-universities.html
- Guide for teachers & schools: https://attendancetracker.dev/attendance-tracker-for-teachers.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 6,
    name: 'Tolky Brazil',
    to: ['negocios@tolky.to'],
    cc: ['contato@tolky.to'],
    subject: 'Add-on oficial de lista de presença no Google Meet (REST API v2) para o diretório Tolky',
    text: `Olá equipe da Tolky,

Ao visitar a página do Tactiq no diretório Descobrir IA da Tolky (https://tolky.to/descobrir-ia/tactiq), gostaria de apresentar o Attendance Tracker (https://attendancetracker.dev) como alternativa e complemento oficial para usuários do Google Meet no Brasil.

Diferente de extensões do Chrome que dependem de raspagem de tela—ou do relatório nativo do Google que exige planos Enterprise e mínimo de 5 participantes—o Attendance Tracker é um add-on oficial do Google Workspace Marketplace construído na API REST v2 nativa do Google Meet (totalmente em português). Ele registra presença sem bots no painel lateral e exporta para o Google Sheets em um clique.

Links úteis para o diretório:
- Lista de presença no Google Meet (PT-BR): https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Comparativo de extensões e add-ons: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Add-on oficial: https://attendancetracker.dev

Um abraço,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 7,
    name: 'Caiena Brazil',
    to: ['contato@caiena.net'],
    cc: ['ola@caiena.net'],
    subject: 'Lista de presença automática no Google Meet (sem bots) para o blog da Caiena',
    text: `Olá equipe editorial da Caiena,

Lendo o artigo de vocês "Como a inteligência artificial agiliza o desenvolvimento de software" (https://www.caiena.net/blog/inteligencia-artificial-agilidade-desenvolvimento-de-software), vi que vocês recomendam o tactiq.io para reuniões no Google Meet.

Para squads de engenharia e gestão pública que fazem dailies, plannings ou reuniões com menos de 5 pessoas no Google Meet, o relatório nativo do Google exige licenças Enterprise e não é gerado. Desenvolvi o Attendance Tracker (https://attendancetracker.dev), um add-on oficial no Google Workspace Marketplace baseado na API REST v2 nativa do Google Meet (em português) que registra horários exatos de entrada e saída sem bots e exporta para o Google Sheets em um clique.

Links úteis caso atualizem o artigo:
- Lista de presença no Google Meet (PT-BR): https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Guia para equipes remotas e ágeis: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Add-on oficial: https://attendancetracker.dev

Atenciosamente,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 8,
    name: 'Villaviciosa Digital Spain',
    to: ['redaccion@villaviciosadigital.es'],
    cc: ['info@villaviciosadigital.es'],
    subject: 'Complemento oficial de asistencia en Google Meet (sin bots) para Villaviciosa Digital',
    text: `Hola equipo de redacción de Villaviciosa Digital,

Leyendo vuestro artículo "Cómo transcribir videollamadas gratis" (https://villaviciosadigital.es/transcribir-videollamadas-gratis/), vi que enlazáis a tactiq.io/es/chrome-extension para usuarios de Google Meet.

Para docentes, universidades y equipos que necesitan controlar la asistencia en Google Meet, el informe nativo de Google exige cuentas Enterprise y no se activa en llamadas de menos de 5 personas. He creado Attendance Tracker (https://attendancetracker.dev), un complemento oficial en Google Workspace Marketplace basado en la API REST v2 nativa de Google Meet (en español) que registra entradas y salidas desde el panel lateral sin bots y exporta a Google Sheets en un clic.

Enlaces útiles por si deseáis ampliar vuestra guía:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Comparativa de extensiones y complementos: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Complemento oficial: https://attendancetracker.dev

Un cordial saludo,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 9,
    name: 'Ryan Darani SEO',
    to: ['ryan@ryan.biz'],
    cc: ['hello@ryan.biz'],
    subject: 'Quick note on your Customer Interview SEO guide + 1-on-1 Google Meet tracking',
    text: `Hi Ryan,

While reading your guide "How to Turn Customer Interviews Into SEO Content" (https://ryan.biz/blog/customer-interview-seo), I noticed your link to tactiq.io/learn/turning-an-interview-transcript-into-a-case-study.

When content and SEO teams run 1-on-1 customer interviews on Google Meet, external recording bots often make interviewees guarded—and Google's native attendance log never triggers on calls under 5 participants. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact 1-on-1 interview timestamps inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you ever update that post:
- Remote & content teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 10,
    name: 'FileTranscribe',
    to: ['contact@filetranscribe.com'],
    cc: ['support@filetranscribe.com'],
    subject: 'Non-competing Google Meet attendance companion for FileTranscribe’s blog',
    text: `Hi FileTranscribe Team,

While reading your post "Best Otter.ai Alternatives for Voice to Text" (https://filetranscribe.com/blog/otter-ai-alternatives-voice-to-text), I noticed you link out to rival tactiq.io.

Since Attendance Tracker (https://attendancetracker.dev) does zero audio recording or voice-to-text transcription, it's a 100% non-competing Google Meet companion for FileTranscribe readers. Built on the native Google Meet REST API v2 as an official Google Workspace Marketplace add-on, it runs inside the Meet side panel without bots, merges reconnections automatically, and exports attendance to Google Sheets in one click.

Helpful links if you'd like to cite a non-competing Google Meet resource:
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 11,
    name: 'MeetStream AI — Sidhdharth',
    to: ['sidhdharth@meetstream.ai'],
    cc: ['info@meetstream.ai'],
    subject: 'Native Google Meet REST API v2 duration tracking for MeetStream AI’s blog',
    text: `Hi Sidhdharth,

While reading your data breakdown on average meeting length on the MeetStream AI blog (https://meetstream.ai/blog/average-meeting-length/), I noticed you cite tactiq.io/learn/teams-meeting-limit.

Since you build meeting infrastructure, you'll appreciate why we built Attendance Tracker (https://attendancetracker.dev) directly on the native Google Meet REST API v2 as an official Google Workspace Marketplace add-on. Because Google's native attendance report requires Enterprise seats and never fires on meetings under 5 people, our zero-bot side-panel add-on tracks exact participant durations on any call size and exports to Google Sheets in one click.

Helpful links if you update your meeting duration resources:
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 12,
    name: 'ActorDO',
    to: ['contact@actordo.com'],
    cc: ['support@actordo.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for ActorDO’s Google Workspace readers',
    text: `Hi ActorDO Team,

While reading your roundup "Best AI Tools for Meeting Notes" (https://actordo.com/best-ai-tools-for-meeting-notes-in-2025-free-paid/) where you feature tactiq.io for Google Meet, I wanted to share a zero-bot Google Workspace Marketplace add-on that pairs naturally with ActorDO.

Because Google's native attendance report requires Enterprise plans and won't trigger on calls under 5 participants, I built Attendance Tracker (https://attendancetracker.dev) on the native Google Meet REST API v2. It runs inside the Meet side panel without bots, merges reconnects automatically, and exports attendance to Google Sheets in one click.

Helpful links if you update your Google Meet productivity guide:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 13,
    name: 'SE Soft Germany',
    to: ['kontakt@sesoft.de'],
    cc: ['info@sesoft.de'],
    subject: 'DSGVO-freundliches Google Meet REST API v2 Add-on (ohne Bots) für Ihren Artikel auf sesoft.de',
    text: `Hallo liebes SE Soft-Team,

beim Lesen Ihres Artikels „Tactiq.io: Der AI-Meeting-Assistent für produktivere Zusammenarbeit“ (https://sesoft.de/tactiq-io-der-ai-meeting-assistent-fuer-produktivere-zusammenarbeit/) wollte ich Ihnen eine datenschutzfreundliche Ergänzung für Google Meet vorstellen.

Da der native Google Meet-Anwesenheitsbericht ein Enterprise-Abo sowie mindestens 5 Teilnehmer voraussetzt (und Chrome-Erweiterungen oft beim nächsten UI-Update brechen), habe ich Attendance Tracker (https://attendancetracker.dev) entwickelt. Als offizielles Google Workspace Marketplace Add-on auf Basis der nativen Google Meet REST API v2 (mit kompletter deutscher Oberfläche) erfasst es Teilnahmedauern direkt im Seitenbereich ohne Bots und exportiert sie per Klick nach Google Sheets.

Passende Links als Ergänzung für Ihren Beitrag:
- Google Meet Anwesenheit für Remote-Teams: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Vergleich der besten Google Meet Erweiterungen & Add-ons: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Offizielles Add-on: https://attendancetracker.dev

Beste Grüße
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 14,
    name: 'Takeroon',
    to: ['hello@takeroon.com'],
    cc: ['support@takeroon.com'],
    subject: 'One-click Google Meet to Google Sheets add-on for Takeroon’s Productivity Hacks guide',
    text: `Hi Takeroon Editorial Team,

While reading your post "ChatGPT Productivity Hacks You Need" (https://www.takeroon.com/blog/chatgpt-productivity-hacks-save-hours), I noticed you link to tactiq.io/learn/chatgpt-productivity-tips... regarding meeting workflow automation.

For teams running daily standups or client workshops on Google Meet, Google's built-in attendance report requires Enterprise seats and never triggers on calls under 5 participants. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact participant durations inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand your productivity hacks post:
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 15,
    name: 'Atlas Workspace AI — Jet',
    to: ['jet@atlasworkspace.ai'],
    cc: ['hello@atlasworkspace.ai'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for Atlas Workspace’s meeting tools guide',
    text: `Hi Jet,

While reading your guide "Best Meeting Notes App 2026: 7 AI Tools" on Atlas Workspace (https://www.atlasworkspace.ai/blog/best-meeting-notes-app), I noticed your link to tactiq.io/transcribe/google-meet.

For Google Workspace teams that want accurate meeting attendance without inviting recording bots or installing fragile DOM-scraping Chrome extensions—especially on calls under 5 people where Google's native report refuses to fire—I built Attendance Tracker (https://attendancetracker.dev). It's an official Google Workspace Marketplace add-on on the native Google Meet REST API v2 that runs in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you update your Google Meet coverage:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 16,
    name: 'Podcast.fr France',
    to: ['contact@podcast.fr'],
    cc: ['info@podcast.fr'],
    subject: 'Module officiel de suivi de présence Google Meet (API REST v2, sans bot) pour Podcast.fr',
    text: `Bonjour l'équipe de Podcast.fr,

En écoutant et lisant les notes de votre épisode « 50 – Générer vos comptes rendus de réunion avec l'intelligence artificielle » (https://podcast.fr/episode/50-generer-vos-comptes-rendus-de-reunion-avec-lintelligence-artificielle/) où vous mentionnez tactiq.io, je souhaitais vous partager un outil complémentaire sans bot pour Google Meet.

Comme le rapport de présence natif de Google Meet exige un abonnement Enterprise et au moins 5 participants, j'ai développé Attendance Tracker (https://attendancetracker.dev). C'est un module officiel du Google Workspace Marketplace basé sur l'API REST v2 native de Google Meet (disponible en français) qui enregistre les temps de présence dans le panneau latéral et exporte vers Google Sheets en un clic.

Quelques liens utiles pour vos notes d'épisode :
- Suivi de présence pour équipes à distance : https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Guide pratique Google Meet : https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Module officiel : https://attendancetracker.dev

Bien cordialement,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 17,
    name: 'Elyex Spain',
    to: ['contacto@elyex.com'],
    cc: ['info@elyex.com'],
    subject: 'Complemento oficial de asistencia en Google Meet (sin bots) para el artículo de Elyex',
    text: `Hola equipo editorial de Elyex,

Leyendo vuestro artículo "Deja que la IA trabaje por ti" (https://elyex.com/deja-que-la-ia-trabaje-por-ti/), vi que destacáis a tactiq.io para automatizar tareas en reuniones de Google Meet.

Para equipos remotos y formadores que usan Google Meet a diario, el informe nativo de asistencia de Google requiere cuentas Enterprise y no se activa en reuniones de menos de 5 participantes. He creado Attendance Tracker (https://attendancetracker.dev), un complemento oficial en Google Workspace Marketplace basado en la API REST v2 nativa de Google Meet (en español) que registra entradas y salidas en el panel lateral sin bots y exporta a Google Sheets en un clic.

Enlaces útiles por si deseáis complementar el artículo:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Guía para equipos remotos: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Complemento oficial: https://attendancetracker.dev

Un saludo cordial,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 18,
    name: 'Aceleração Digital Brazil',
    to: ['contato@aceleracaodigital.com'],
    cc: ['ola@aceleracaodigital.com'],
    subject: 'Add-on oficial de lista de presença no Google Meet (sem bots) para o Aceleração Digital',
    text: `Olá equipe da Aceleração Digital,

Navegando pela página "Ferramentas de IA" de vocês (https://aceleracaodigital.com/ferramentas-de-ia/), vi que vocês recomendam o tactiq.io para reuniões no Google Meet.

Como o relatório nativo de presença do Google Meet exige planos Enterprise e não funciona em chamadas com menos de 5 pessoas (e extensões do Chrome costumam quebrar quando o Google atualiza o layout), desenvolvi o Attendance Tracker (https://attendancetracker.dev). É um add-on oficial no Google Workspace Marketplace construído na API REST v2 nativa do Google Meet (em português) que registra presença no painel lateral sem bots e exporta para o Google Sheets em um clique.

Links úteis para a curadoria de vocês:
- Lista de presença no Google Meet (PT-BR): https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Comparativo de extensões e add-ons: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Add-on oficial: https://attendancetracker.dev

Um abraço,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 19,
    name: 'CreatorHome Taiwan (創作邦)',
    to: ['hello@creatorhome.tw'],
    cc: ['contact@creatorhome.tw'],
    subject: '推薦給「創作邦 CreatorHome」讀者的 Google Meet 官方免機器人點名與出席紀錄外掛（支援繁體中文）',
    text: `創作邦 CreatorHome 編輯團隊您好：

在瀏覽貴站的「AI 工具與資源整理」（https://creatorhome.tw/ai-resources）時，看到您們收錄了 Google Meet 相關工具 tactiq.io，因此想向您們介紹一款專為創作者線上課程、工作坊與遠距團隊打造的官方工具。

由於 Google Meet 內建出席報告僅限 Enterprise 企業版且滿 5 人以上才會觸發，我開發了官方 Google Workspace Marketplace 附加元件「Attendance Tracker」（https://attendancetracker.dev）。它基於原生 Google Meet REST API v2（完整支援繁體中文介面），無須外部機器人即可在側邊欄自動記錄精確進出時間，並一鍵匯出至 Google 試算表或生成 PDF 證書。

提供以下資源供貴站收錄參考：
- Google Meet 點名與擴充功能評比：https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- 線上講座與工作坊出席追蹤指南：https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- 官方附加元件：https://attendancetracker.dev

祝 編安
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 20,
    name: 'TekiMobile Brazil',
    to: ['contato@tekimobile.com'],
    cc: ['redacao@tekimobile.com'],
    subject: 'Integração nativa Google Meet + Google Sheets (REST API v2) para os leitores do TekiMobile',
    text: `Olá redação do TekiMobile,

Lendo a matéria de vocês sobre produtividade no Google Workspace (https://tekimobile.com/noticia/chatgpt-invade-google-drive-e-edita-documentos-no-lugar-do-gemini/), notei o link para o guia do tactiq.io/pt-br sobre integração com o Google Drive.

Para equipes e professores que usam o Google Meet, o relatório nativo de presença do Google exige contas Enterprise e não funciona em chamadas com menos de 5 participantes. Criei o Attendance Tracker (https://attendancetracker.dev), um add-on oficial no Google Workspace Marketplace baseado na API REST v2 nativa do Google Meet (em português) que registra a presença no painel lateral sem bots e exporta direto para o Google Sheets no Google Drive em um clique.

Links úteis caso queiram complementar a pauta:
- Lista de presença no Google Meet (PT-BR): https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Exportar presença do Google Meet para o Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Add-on oficial: https://attendancetracker.dev

Atenciosamente,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 21,
    name: 'AllRemote Jobs',
    to: ['hello@allremote.jobs'],
    cc: ['support@allremote.jobs'],
    subject: 'Adding Attendance Tracker (Google Meet REST API v2) to AllRemote Jobs’ Remote Tools directory',
    text: `Hi AllRemote Jobs Team,

While browsing your Remote Tools directory where you list tactiq.io (https://allremote.jobs/remote-tools/tactiq/product), I wanted to share Attendance Tracker (https://attendancetracker.dev) for remote engineering teams and recruiters.

When distributed teams run standups or 1-on-1 candidate interviews on Google Meet, Google's built-in attendance report requires Enterprise seats and never triggers on calls under 5 participants. Attendance Tracker is an official zero-bot Google Workspace Marketplace add-on built on the native Google Meet REST API v2 that logs exact participant durations inside the Meet side panel and exports to Google Sheets in one click.

Helpful links for your remote tools directory:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Remote candidate job interviews guide: https://attendancetracker.dev/google-meet-attendance-for-job-interviews.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 22,
    name: 'Best AI Tools',
    to: ['hello@bestaitools.com'],
    cc: ['support@bestaitools.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for BestAITools.com’s Tactiq review page',
    text: `Hi Best AI Tools Editorial Team,

While reading your review "Tactiq - Is This The Best AI Meeting Tool?" (https://www.bestaitools.com/tool/tactiq/), I wanted to share a zero-bot Google Meet attendance add-on for your alternatives and related tools section.

Unlike Chrome extensions that scrape DOM captions—or Google's native attendance report that requires Enterprise licenses and 5+ participants—Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It opens right inside the Google Meet side panel, merges reconnections automatically, and exports attendance to Google Sheets in one click.

Helpful links for your directory:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 23,
    name: 'Outils Collaboratifs France',
    to: ['contact@outilscollaboratifs.com'],
    cc: ['redaction@outilscollaboratifs.com'],
    subject: 'Module officiel Google Meet (API REST v2, sans bot) pour Outils Collaboratifs',
    text: `Bonjour la rédaction d'Outils Collaboratifs,

En lisant votre article « 4 outils IA qui changent la donne en réunion » (https://outilscollaboratifs.com/2025/02/meilleurs-outils-ia-reunions/) où vous citez l'extension Chrome de tactiq.io, je souhaitais vous présenter un module complémentaire pour les utilisateurs de Google Meet.

Contrairement aux extensions Chrome qui scrutent le DOM (ou au rapport natif de Google qui exige un forfait Enterprise et au moins 5 participants), Attendance Tracker (https://attendancetracker.dev) est un module officiel du Google Workspace Marketplace basé sur l'API REST v2 native de Google Meet (en français). Il suit les présences directement dans le panneau latéral sans bot et exporte vers Google Sheets en un clic.

Liens utiles si vous mettez à jour votre sélection :
- Guide pour les équipes à distance : https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Comparatif des extensions et modules Google Meet : https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Module officiel : https://attendancetracker.dev

Bien cordialement,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 24,
    name: 'FiveAgents Indonesia',
    to: ['hello@fiveagents.io'],
    cc: ['support@fiveagents.io'],
    subject: 'Add-on absensi Google Meet resmi (REST API v2, Bahasa Indonesia) untuk blog FiveAgents',
    text: `Halo Tim Editorial FiveAgents,

Saat membaca panduan produktivitas enterprise Anda di https://www.fiveagents.io/intelligence/claude-pro-vs-free-bandingkan-paket-2026 yang menautkan ke tactiq.io/learn/claude-enterprise, saya ingin membagikan add-on Google Workspace resmi untuk tim dan pengajar di Indonesia.

Karena laporan kehadiran bawaan Google Meet memerlukan lisensi Enterprise dan tidak aktif pada rapat di bawah 5 peserta, saya membangun Attendance Tracker (https://attendancetracker.dev) di atas Google Meet REST API v2 asli (lengkap dengan antarmuka Bahasa Indonesia). Add-on ini mencatat waktu masuk/keluar secara akurat di panel samping Meet tanpa bot dan mengekspor langsung ke Google Sheets dalam satu klik.

Tautan bermanfaat untuk referensi pembaca Anda:
- Panduan absensi Google Meet untuk pengajar & institusi di Indonesia: https://attendancetracker.dev/google-meet-attendance-indonesia-teachers.html
- Panduan absensi untuk tim remote: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Add-on resmi: https://attendancetracker.dev

Salam hangat,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 25,
    name: 'Brain and Code Spain',
    to: ['info@brainandcode.tech'],
    cc: ['hola@brainandcode.tech'],
    subject: 'Control de asistencia en Google Meet (sin bots) para el blog y cursos de Brain and Code',
    text: `Hola equipo de Brain and Code,

Leyendo vuestro artículo "Haz que la IA trabaje para ti" (https://brainandcode.tech/blogs/el-blog-de-brain/haz-que-la-ia-trabaje-para-ti), vi que recomendáis tactiq.io para sesiones en Google Meet.

Tanto para formaciones tecnológicas y bootcamps en vivo como para reuniones de equipo en Google Meet, el informe nativo de asistencia de Google exige cuentas Enterprise y no se activa con menos de 5 participantes. He desarrollado Attendance Tracker (https://attendancetracker.dev), un complemento oficial en Google Workspace Marketplace sobre la API REST v2 nativa de Google Meet (en español) que registra la asistencia en el panel lateral sin bots y exporta a Google Sheets o certificados PDF en un clic.

Enlaces útiles por si actualizáis vuestro artículo:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Guía para formaciones en vivo y webinars: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Complemento oficial: https://attendancetracker.dev

Un cordial saludo,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 26,
    name: 'Diego Eis Brazil',
    to: ['contato@diegoeis.com'],
    cc: ['diego@diegoeis.com'],
    subject: 'Add-on nativo de lista de presença no Google Meet (REST API v2) para sua lista de ferramentas, Diego',
    text: `Olá Diego, tudo bem?

Lendo sua curadoria "Ferramentas e Links sobre Inteligência Artificial" (https://diegoeis.com/ferramentas-e-links-sobre-inteligencia-artificial/), vi que você recomenda o tactiq.io para reuniões no Google Meet.

Para líderes de produto e engenharia que fazem 1-on-1s, dailies ou reuniões no Google Meet, o relatório nativo do Google exige planos Enterprise e não dispara em chamadas com menos de 5 pessoas. Construí o Attendance Tracker (https://attendancetracker.dev), um add-on oficial no Google Workspace Marketplace usando a API REST v2 nativa do Google Meet (em português) que registra a presença direto no painel lateral sem bots e exporta para o Google Sheets em um clique.

Links úteis caso queira adicionar na sua página:
- Lista de presença no Google Meet (PT-BR): https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Guia para times remotos de tecnologia: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Add-on oficial: https://attendancetracker.dev

Um abraço,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 27,
    name: 'No Es Asunto Vuestro — Víctor Correal',
    to: ['hola@noesasuntovuestro.com'],
    cc: ['victor.correal@gmail.com'],
    subject: 'Nota rápida sobre tu episodio con Joan Boluda + asistencia en Google Meet sin bots',
    text: `Hola Víctor,

Revisando las notas del episodio "La inteligencia artificial 6 meses después con Joan Boluda" en No Es Asunto Vuestro (https://www.noesasuntovuestro.com/la-inteligencia-artificial-6-meses-despues-joan-boluda/), vi que mencionáis tactiq.io para reuniones en Google Meet.

Para emprendedores, consultores y equipos remotos que se reúnen por Google Meet, el informe nativo de asistencia de Google requiere licencias Enterprise y nunca se activa en llamadas de menos de 5 personas. He creado Attendance Tracker (https://attendancetracker.dev), un complemento oficial en Google Workspace Marketplace basado en la API REST v2 nativa de Google Meet (en español) que registra tiempos de asistencia en el panel lateral sin bots y exporta a Google Sheets en un clic.

Te dejo estos enlaces por si os resultan útiles para la comunidad:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Guía para equipos remotos: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Complemento oficial: https://attendancetracker.dev

Un abrazo,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 28,
    name: 'Klooks Brazil',
    to: ['contato@klooks.com.br'],
    cc: ['comercial@klooks.com.br'],
    subject: 'Controle de presença no Google Meet para equipes B2B no blog da Klooks',
    text: `Olá equipe da Klooks,

Lendo o guia de vocês "8 Maneiras das Equipes de Vendas B2B Utilizarem o ChatGPT" (https://www.klooks.com.br/blog/8-maneiras-das-equipes-de-vendas-b2b-utilizarem-o-chatgpt-um-guia-completo-de-como-comecar/), vi que vocês indicam o tactiq.io para reuniões no Google Meet.

Quando equipes de vendas B2B fazem calls de demonstração ou reuniões com menos de 5 participantes no Google Meet, o relatório nativo de presença do Google não é gerado (além de exigir planos Enterprise). Desenvolvi o Attendance Tracker (https://attendancetracker.dev), um add-on oficial no Google Workspace Marketplace baseado na API REST v2 nativa do Google Meet (em português) que registra horários exatos no painel lateral sem bots invasivos e exporta para o Google Sheets em um clique.

Links úteis caso atualizem o guia:
- Lista de presença no Google Meet (PT-BR): https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Exportar presença do Google Meet para o Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Add-on oficial: https://attendancetracker.dev

Atenciosamente,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 29,
    name: 'Alessandro Nicoli Italy',
    to: ['info@alessandronicoli.com'],
    cc: ['alessandro@alessandronicoli.com'],
    subject: 'Add-on ufficiale Google Meet per il registro presenze (senza bot) per il tuo articolo, Alessandro',
    text: `Ciao Alessandro,

leggendo il tuo articolo "Riepilogo AI nelle Call: Perché Docenti e Marketers Non Potranno Farne Più a Meno" (https://alessandronicoli.com/ripilogo-ai-nelle-call-perche-docenti-e-marketers-non-potranno-farne-piu-a-meno/) in cui consigli tactiq.io per Google Meet, volevo segnalarti uno strumento pensato proprio per docenti e formatori.

Poiché il report presenze nativo di Google Meet richiede piani Enterprise e non si attiva mai sotto i 5 partecipanti, ho sviluppato Attendance Tracker (https://attendancetracker.dev): un add-on ufficiale sul Google Workspace Marketplace basato sulla Google Meet REST API v2 nativa (con interfaccia completa in italiano) che registra orari di ingresso/uscita nel pannello laterale senza bot ed esporta su Google Sheets o certificati PDF in un clic.

Ecco i link utili se vorrai aggiornare l'articolo:
- Guida presenze Google Meet per docenti: https://attendancetracker.dev/attendance-tracker-for-teachers.html
- Guida per webinar e formazione: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Add-on ufficiale: https://attendancetracker.dev

Un caro saluto,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 30,
    name: 'Cloudo3 Poland',
    to: ['contact@cloudo3.com'],
    cc: ['info@cloudo3.com'],
    subject: 'Broken Chrome Web Store link on your Google Meet guide (cloudo3.com)',
    text: `Hi Cloudo3 Editorial Team,

While reading your Polish Google Meet guide "Jak wziąć udział w Google Meet" (https://cloudo3.com/pl/how-to/jak-wziac-udzia%C5%82-w-google-meet/88832038), I noticed that the Chrome Web Store link on the anchor text "kliknąć ten link" (pointing to extension ID nenibigflkdikhamlnekfppbganmojlg) is dead and returns a 404 page—Google removed that legacy attendance extension.

To replace that broken link for your readers, I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2 (with full Polish and English UI support) that tracks participant durations in the Meet side panel and exports to Google Sheets in one click.

Drop-in replacement links if you'd like to fix the 404:
- Why legacy Google Meet attendance extensions broke & how to switch: https://attendancetracker.dev/google-meet-attendance-extension-broken.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  }
];

function getLogFilePath() {
  const envPath = process.env.WAVE19_LOG_FILE ? process.env.WAVE19_LOG_FILE.trim() : '';
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
Wave 19 Outreach Dispatcher (30 Verified Backlink Outreach Targets)
Usage:
  node scripts/send-wave19-outreach.cjs --dry-run
  node scripts/send-wave19-outreach.cjs --dry-run --target=1
  node scripts/send-wave19-outreach.cjs --test
  node scripts/send-wave19-outreach.cjs --test --target=1
  node scripts/send-wave19-outreach.cjs --send --target=1
  node scripts/send-wave19-outreach.cjs --send --all
  node scripts/send-wave19-outreach.cjs --send --target=1 --force
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
