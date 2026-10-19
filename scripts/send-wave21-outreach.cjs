#!/usr/bin/env node
/**
 * scripts/send-wave21-outreach.cjs
 *
 * Dedicated dispatcher for Wave 21 Backlink Outreach (30 Verified Targets):
 * - Carried-over Verified Reserve Targets from Wave 20 (Targets 1–15, DR 18–21)
 * - Global SaaS Publications, Education Portals, AI Directories & Broken Link Replacements (Targets 16–30, DR 15–31)
 *
 * Sends personalized, anti-AI founder emails from Derek Gallardo <derek@attendancetracker.dev>
 * via the Resend API with reply-to derek@attendancetracker.dev.
 *
 * Safety & Execution features:
 * 1. Deduplication log in `docs/wave21-dispatch-log.json` (overridable via `WAVE21_LOG_FILE`) to prevent duplicate sends.
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
const LOG_FILE = path.resolve(__dirname, '../docs/wave21-dispatch-log.json');

const TARGETS = [
  {
    id: 1,
    name: 'Freed Tools',
    to: ['hola@freed.tools'],
    cc: ['info@freed.tools'],
    subject: 'Control de asistencia en Google Meet (sin bots) para vuestra guía de entrevistas UX/CX en Freed Tools',
    text: `Hola equipo de Freed Tools,

Leyendo vuestro artículo "Entrevista en profundidad: qué es, cómo diseñarla y ejemplos" (https://freed.tools/blogs/ux-cx/entrevistas-profundidad) donde recomendáis tactiq.io para sesiones en Google Meet, quería compartir un complemento oficial de Google Workspace pensado para investigadores UX y equipos remotos.

En entrevistas 1-a-1 o sesiones con menos de 5 participantes en Google Meet, los bots externos suelen intimidar al usuario y el informe nativo de Google nunca se activa (además de exigir cuentas Enterprise). He creado Attendance Tracker (https://attendancetracker.dev), un complemento oficial basado en la API REST v2 nativa de Google Meet (en español) que registra tiempos de sesión en el panel lateral sin bots y exporta a Google Sheets en un clic.

Enlaces útiles por si actualizáis vuestra guía:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Guía para equipos remotos y UX: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Complemento oficial: https://attendancetracker.dev

Un saludo cordial,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 2,
    name: 'Gianluigi Bonanomi Italy',
    to: ['info@gianluigibonanomi.com'],
    cc: ['contatti@gianluigibonanomi.com'],
    subject: 'Add-on ufficiale Google Meet (REST API v2, senza bot) per i tuoi corsi + pass formatore gratuito',
    text: `Ciao Gianluigi,

seguendo i tuoi approfondimenti e corsi sugli strumenti di produttività e IA (https://www.gianluigibonanomi.com/tag/corsi/) in cui citi anche tactiq.io per Google Meet, volevo presentarti uno strumento che ho creato per formatori, docenti e relatori di webinar.

Poiché il report presenze nativo di Google Meet richiede licenze Enterprise e non si attiva sotto i 5 partecipanti, ho sviluppato Attendance Tracker (https://attendancetracker.dev): un add-on ufficiale sul Google Workspace Marketplace basato sulla Google Meet REST API v2 nativa (con interfaccia in italiano) che traccia orari e durate nel pannello laterale senza bot ed esporta su Google Sheets o certificati PDF in un clic.

Se ti fa piacere provarlo nei tuoi corsi, rispondimi con la tua email Google Workspace e ti attivo subito un pass formatore gratuito a vita:
- Guida per webinar e formazione aziendale: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Guida per docenti e scuole: https://attendancetracker.dev/attendance-tracker-for-teachers.html
- Add-on ufficiale: https://attendancetracker.dev

Un caro saluto,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 3,
    name: 'Thalion Design & AI',
    to: ['hello@thalion.pro'],
    cc: ['contact@thalion.pro'],
    subject: 'Zero-bot Google Meet side-panel add-on for your UX/UI & AI Trends guide',
    text: `Hi Thalion,

While reading your post "UX/UI Design and AI Trends for 2025" (https://www.thalion.pro/post/ux-ui-design-and-ai-trends-for-2025) where you recommend tactiq.io for design critiques and user research calls on Google Meet, I wanted to share a zero-bot Google Meet add-on built for product teams.

When designers run 1-on-1 usability interviews or small design reviews on Google Meet, Google's native attendance report never triggers (it requires 5+ participants and Enterprise seats), and DOM-scraping Chrome extensions break whenever Google updates Meet's UI. I built Attendance Tracker (https://attendancetracker.dev) on the native Google Meet REST API v2 to log exact session timestamps inside the Meet side panel and export to Google Sheets in one click.

Helpful links if you update your toolkit post:
- Remote design & engineering teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 4,
    name: 'Schleifenquadrat Podcast Germany',
    to: ['moin@schleifenquadrat.fm'],
    cc: ['info@schleifenquadrat.fm'],
    subject: 'Kurzer Hinweis zu Episode SQ234 + botfreies Google Meet REST API v2 Add-on (auf Deutsch)',
    text: `Moin liebes Schleifenquadrat-Team,

beim Stöbern in euren Shownotes zu Episode „SQ234 Gefährliches Halbwissen!“ (https://www.schleifenquadrat.fm/sq234/), in denen ihr tactiq.io für Google Meet verlinkt habt, wollte ich euch ein datenschutzfreundliches, botfreies Google Workspace Add-on vorstellen.

Da der native Google Meet-Anwesenheitsbericht ein Enterprise-Abo und mindestens 5 Teilnehmende voraussetzt (und klassische Chrome-Extensions nur das DOM abgreifen), habe ich Attendance Tracker (https://attendancetracker.dev) direkt auf der nativen Google Meet REST API v2 gebaut – komplett auf Deutsch und Englisch. Es läuft direkt im Meet-Seitenbereich ohne Bots und exportiert Anwesenheitslisten per Klick nach Google Sheets.

Falls ihr das Tool in euren Shownotes oder einer kommenden Folge erwähnen möchtet:
- Google Meet Anwesenheit für Remote-Teams: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Schritt-für-Schritt-Anleitung für Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Offizielles Add-on: https://attendancetracker.dev

Viele Grüße
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 5,
    name: 'Yanai-Ke Japan',
    to: ['info@yanai-ke.com'],
    cc: ['contact@yanai-ke.com'],
    subject: '【yanai-ke.com様】Google Workspace記事へのGoogle Meet公式出席管理アドオン（日本語対応）のご提案',
    text: `yanai-ke.com 運営者様

貴サイトの解説記事「Gemini Live 2025年最新ガイド」（https://yanai-ke.com/2025-gemini-live/）にて、Google Meet関連リソースとして tactiq.io/ja/learn/... を紹介されているのを拝見し、ご連絡いたしました。

Google Meet標準の出席レポートはWorkspace Enterpriseプラン限定かつ5名以上の会議でしか作動しないため、私はネイティブのGoogle Meet REST API v2上で動作する公式Google Workspace Marketplaceアドオン「Attendance Tracker」（https://attendancetracker.dev）を開発いたしました（日本語UI完全対応）。ボット不要でサイドパネルから正確な参加・退出時間を記録し、ワンクリックでGoogleスプレッドシートへ出力できます。

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
    id: 6,
    name: 'Trending AI Tools',
    to: ['hello@trendingaitools.com'],
    cc: ['support@trendingaitools.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for TrendingAITools.com’s directory',
    text: `Hi Trending AI Tools Editorial Team,

While checking out your review "Tactiq: AI-Powered Meeting Transcription and Notes" (https://www.trendingaitools.com/ai-tools/tactiq/), I wanted to share Attendance Tracker (https://attendancetracker.dev) for your Google Meet tools directory and alternatives section.

Unlike Chrome extensions that scrape DOM captions—or Google's built-in attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker is an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2. It tracks exact participant join/leave durations inside the Google Meet side panel and exports to Google Sheets in one click.

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
    id: 7,
    name: 'TecnoloBlog Spain',
    to: ['contacto@tecnoloblog.com'],
    cc: ['info@tecnoloblog.com'],
    subject: 'Complemento oficial de asistencia en Google Meet a Google Sheets (sin bots) para TecnoloBlog',
    text: `Hola equipo de TecnoloBlog,

Leyendo vuestro tutorial "Cómo convertir reuniones grabadas en actas con IA y ChatGPT" (https://www.tecnoloblog.com/como-convertir-una-reunion-grabada-en-acta-usando-ia-y-chatgpt/) donde recomendáis tactiq.io para Google Meet, quería presentaros un complemento oficial de Google Workspace que automatiza la lista de asistentes para las actas.

Como el informe nativo de asistencia de Google Meet exige licencias Enterprise y no se activa en reuniones de menos de 5 personas, he desarrollado Attendance Tracker (https://attendancetracker.dev) sobre la API REST v2 nativa de Google Meet (en español). Registra entradas, salidas y duraciones exactas en el panel lateral sin bots y las exporta a Google Sheets en un clic.

Enlaces útiles por si deseáis complementar vuestro artículo:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Exportar asistencia de Google Meet a Google Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Complemento oficial: https://attendancetracker.dev

Un saludo cordial,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 8,
    name: 'Somi AI',
    to: ['support@somi.ai'],
    cc: ['hello@somi.ai'],
    subject: 'Adding Attendance Tracker (Google Meet REST API v2) to Somi AI’s directory',
    text: `Hi Somi AI Team,

While viewing your product directory page for Tactiq (https://somi.ai/products/tactiq), I wanted to share Attendance Tracker (https://attendancetracker.dev) for your Google Meet tools category and alternatives list.

Instead of injecting recording bots or relying on fragile DOM-scraping Chrome extensions, Attendance Tracker is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It opens right inside the Google Meet side panel, works on any call size (even under 5 participants), and exports attendance to Google Sheets in one click.

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
    name: 'Vaultr AI',
    to: ['hello@vaultrai.com'],
    cc: ['support@vaultrai.com'],
    subject: 'Native Google Meet REST API v2 add-on for Vaultr AI’s Meeting Tools category',
    text: `Hi Vaultr AI Editorial Team,

While browsing your Note Taking & Meeting Archives directory (https://vaultrai.com/ai-tools/note-taking/) where you list tactiq.io for Google Meet, I wanted to share Attendance Tracker (https://attendancetracker.dev) for consideration on Vaultr AI.

Because Google's native attendance report requires paid Enterprise seats and won't trigger on calls with fewer than 5 people, remote teams and educators use our official Google Workspace Marketplace add-on (built on the native Google Meet REST API v2) to track exact join/leave durations in the Meet side panel without bots and export to Google Sheets in one click.

Helpful links for your directory:
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
    name: 'PPC Cast Spain',
    to: ['hola@ppccast.com'],
    cc: ['info@ppccast.com'],
    subject: 'Nota sobre el episodio #160 de PPC Cast + control de asistencia en webinars por Google Meet',
    text: `Hola equipo de PPC Cast,

Escuchando y revisando las notas del episodio "160. Cómo debería ser una campaña para eventos" (https://ppccast.com/podcast/160-como-deberia-ser-una-campana-para-eventos/) donde recomendáis tactiq.io para reuniones en Google Meet, quería compartir una herramienta muy útil para medir la asistencia real en eventos online y webinars.

Como el informe nativo de Google Meet exige cuentas Enterprise y no se activa con menos de 5 personas, he creado Attendance Tracker (https://attendancetracker.dev): un complemento oficial en Google Workspace Marketplace sobre la API REST v2 nativa de Google Meet (en español) que registra cuánto tiempo permanece cada asistente sin usar bots y exporta todo a Google Sheets en un clic.

Os dejo estos enlaces por si os sirven para las notas del episodio:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Control de asistencia para webinars y eventos en Google Meet: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Complemento oficial: https://attendancetracker.dev

Un abrazo,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 11,
    name: 'Jamy AI',
    to: ['hello@jamy.ai'],
    cc: ['support@jamy.ai'],
    subject: 'Non-competing Google Meet attendance link for Jamy AI’s blog',
    text: `Hi Jamy AI Team,

While reading your post "5 Steps to Implement AI in Business Meetings" (https://www.jamy.ai/blog/5-steps-to-implement-ai-in-business-meetings/), I noticed you include an outbound link to rival tactiq.io.

Since Attendance Tracker (https://attendancetracker.dev) does zero audio recording, transcription, or meeting notes, it's a 100% non-competing Google Meet companion for Jamy AI users. Built on the native Google Meet REST API v2 as an official Google Workspace Marketplace add-on, it runs inside the Meet side panel without bots, merges reconnects automatically, and exports attendance to Google Sheets in one click.

Helpful links if you'd like to swap that competitor link for a non-competing resource:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 12,
    name: 'Callabo AI Korea',
    to: ['contact@callabo.ai'],
    cc: ['support@callabo.ai'],
    subject: 'Non-competing Google Meet attendance add-on (with Korean UI) for Callabo AI’s blog',
    text: `Hi Callabo AI Editorial Team,

While reading your comparison post "AI 회의록 17개 비교 — 직접 써보고 고른 추천 (2026)" (https://callabo.ai/blog/comparison-of-17-ai-notetakers-for-business), I noticed your outbound link to rival tactiq.io.

Because Attendance Tracker (https://attendancetracker.dev) does zero audio recording or meeting transcription, it is a 100% non-competing Google Meet companion for Callabo AI users—and includes full Korean (ko) and English UI localization. Built on the native Google Meet REST API v2 as an official Google Workspace Marketplace add-on, it logs exact join/leave durations inside the Meet side panel without bots and exports to Google Sheets in one click.

Non-competing links if you'd like to reference a dedicated Google Meet attendance tool:
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 13,
    name: 'Productivity Shift',
    to: ['hi@productivityshift.com'],
    cc: ['hello@productivityshift.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for Productivity Shift’s Meeting Software guide',
    text: `Hi Productivity Shift Editorial Team,

While reading your guide "14 Best Meeting Minute Software For Productivity" (https://productivityshift.com/best-meeting-minute-software/) where you feature tactiq.io for Google Meet, I wanted to share our official Google Workspace Marketplace add-on, Attendance Tracker (https://attendancetracker.dev).

Because Google's built-in attendance report requires Enterprise plans and never fires on meetings under 5 participants—and Chrome extensions often break when Google updates Meet's DOM—Attendance Tracker uses the native Google Meet REST API v2 to log exact participant durations in the Meet side panel without bots and export to Google Sheets in one click.

Helpful links if you update your roundup:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 14,
    name: 'HeyBRB UK',
    to: ['hello@heybrb.ai'],
    cc: ['support@heybrb.ai'],
    subject: 'Non-competing Google Meet CPD/CPE attendance companion for HeyBRB’s Accountants guide',
    text: `Hi HeyBRB Team,

While reading your UK comparison "AI Notetaker for Accountants — UK Comparison + Matcher" (https://heybrb.ai/tools/ai-notetakers-for-accountants), I noticed you link out to rival tactiq.io.

Since Attendance Tracker (https://attendancetracker.dev) does zero transcription or note-taking, it's a 100% non-competing Google Meet companion for accounting firms and HeyBRB users. Built on the native Google Meet REST API v2 as an official Google Workspace Marketplace add-on, it logs exact client call timestamps and CPD/CPE training durations inside the Meet side panel without bots, exporting Google Sheets logs or PDF attendance certificates in one click.

Helpful links if you'd like to cite a non-competing accounting & CPD resource:
- CPE, CPD & continuing education attendance guide: https://attendancetracker.dev/google-meet-attendance-for-cpe-and-cle-credits.html
- Remote accounting & advisory teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 15,
    name: 'Tooliverse AI',
    to: ['hello@tooliverse.ai'],
    cc: ['partnerships@tooliverse.ai'],
    subject: 'Bot-free Google Meet REST API v2 add-on for Tooliverse AI’s directory',
    text: `Hi Tooliverse AI Team,

While reading your page "Tactiq Review 2026 - Bot-Free Transcription" (https://tooliverse.ai/tools/tactiq), I wanted to share Attendance Tracker (https://attendancetracker.dev) for your bot-free Google Meet tools and alternatives section.

Unlike Chrome extensions that scrape live captions from the DOM—or Google's native attendance report that requires Enterprise licenses and 5+ participants—Attendance Tracker is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It runs inside the Meet side panel without bots, merges reconnects automatically, and exports attendance to Google Sheets in one click.

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
    id: 16,
    name: 'Madrasah UK Education',
    to: ['info@madrasah.co.uk'],
    cc: ['admin@madrasah.co.uk'],
    subject: 'Zero-bot Google Meet classroom attendance add-on for Madrasah UK + free educator pass',
    text: `Hi Madrasah UK Team,

While reading your resource page for "The Complete AI Prompting Course" (https://madrasah.co.uk/ai.html) where you link to tactiq.io for online sessions, I wanted to share a privacy-first Google Meet attendance tool built for teachers, tutors, and schools.

Because Google's built-in attendance report requires paid Enterprise licenses and never triggers on classes or tutoring sessions under 5 participants, I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs student join/leave durations in the Meet side panel and exports to Google Sheets in one click.

If your instructors would like to use it, reply with your Google Workspace email and I'll activate a free lifetime educator pass:
- Guide for teachers & schools: https://attendancetracker.dev/attendance-tracker-for-teachers.html
- University & higher-ed lectures guide: https://attendancetracker.dev/google-meet-attendance-for-universities.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 17,
    name: 'PromptPanda — Bram Billiet',
    to: ['hello@promptpanda.io'],
    cc: ['bram.billiet@usewhale.io'],
    subject: 'Quick note on your PromptPanda post + zero-bot Google Meet add-on for teams',
    text: `Hi Bram,

While reading your post "Elevate Your Teams AI Game with ChatGPT Library" on PromptPanda (https://www.promptpanda.io/blog/chatgpt-library/) where you cite tactiq.io for team meetings, I wanted to share a lightweight Google Workspace Marketplace add-on built for remote teams.

When teams run SOP training sessions, onboarding calls, or 1-on-1 check-ins on Google Meet, Google's native attendance report requires Enterprise seats and refuses to fire on meetings under 5 people. I built Attendance Tracker (https://attendancetracker.dev) on the native Google Meet REST API v2 to log exact participant durations inside the Meet side panel without bots and export to Google Sheets in one click.

Helpful links if you ever update your team productivity guides:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 18,
    name: 'Journaling Insights / IndiePenPress',
    to: ['contact@indiepenpress.com'],
    cc: ['hello@journalinginsights.com'],
    subject: 'Zero-bot Google Meet seminar attendance add-on for your Academic Journaling guide',
    text: `Hi Journaling Insights Editorial Team,

While reading your guide "Creating an Effective Academic Journaling in 2025" (https://journalinginsights.com/effective-academic-journaling/), I noticed your link to tactiq.io/learn/meeting-note-templates for academic study groups and seminars.

For university lecturers, graduate seminar leaders, and teachers meeting on Google Meet, Google's built-in attendance report requires Enterprise licenses and never fires on small-group sessions under 5 participants. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that tracks attendance inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand your academic resources:
- University lectures & seminars guide: https://attendancetracker.dev/google-meet-attendance-for-universities.html
- Guide for teachers & educators: https://attendancetracker.dev/attendance-tracker-for-teachers.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 19,
    name: 'Social Lady',
    to: ['support@social-lady.com'],
    cc: ['hello@social-lady.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for Social Lady’s workflow guide',
    text: `Hi Social Lady Team,

While reading your article "The Age of the Agent: Master Autonomous Action in AI" (https://social-lady.com/age-of-the-agent-autonomous-action-in-ai/) where you recommend tactiq.io for Google Meet workflows, I wanted to share a zero-bot Google Workspace Marketplace add-on built for agencies and remote teams.

Unlike Chrome extensions that scrape DOM elements—or Google's native attendance report that requires Enterprise plans and 5+ participants—Attendance Tracker (https://attendancetracker.dev) runs on the native Google Meet REST API v2 inside the Meet side panel, logging exact join/leave durations and exporting to Google Sheets in one click.

Helpful links if you update your Google Meet recommendations:
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
    name: 'BE Formazione Italy',
    to: ['info@beformazione.com'],
    cc: ['segreteria@beformazione.com'],
    subject: 'Add-on ufficiale Google Meet per registro presenze e attestati PDF (per BE Formazione)',
    text: `Gentile Team di BE Formazione,

leggendo il vostro articolo "I 10 migliori strumenti di IA per la produttività" nella sezione PMFacile (https://www.beformazione.com/pmfacile/i-10-migliori-strumenti-di-ia/) in cui consigliate tactiq.io per Google Meet, volevo segnalarvi uno strumento pensato specificamente per enti di formazione e project manager.

Poiché il report presenze nativo di Google Meet richiede piani Enterprise e non si attiva mai sotto i 5 partecipanti, ho sviluppato Attendance Tracker (https://attendancetracker.dev): un add-on ufficiale sul Google Workspace Marketplace basato sulla Google Meet REST API v2 nativa (con interfaccia completa in italiano) che registra gli orari di presenza nel pannello laterale senza bot ed esporta su Google Sheets o certificati PDF in un clic.

Link utili se vorrete aggiornare la vostra guida:
- Guida presenze Google Meet per webinar e corsi di formazione: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Guida per project manager e team remoti: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Add-on ufficiale: https://attendancetracker.dev

Cordiali saluti,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 21,
    name: 'RevOps Tools',
    to: ['hello@revops.tools'],
    cc: ['support@revops.tools'],
    subject: 'Native Google Meet REST API v2 add-on for RevOps Tools’ directory',
    text: `Hi RevOps Tools Team,

While reading your directory profile "Tactiq Review 2026 — Meeting Intelligence" (https://revops.tools/tactiq/), I wanted to share Attendance Tracker (https://attendancetracker.dev) for your RevOps & Google Workspace tools directory.

When sales, CS, and RevOps teams run discovery calls, onboarding sessions, or 1-on-1 check-ins on Google Meet, Google's native attendance report never triggers (it requires 5+ participants and Enterprise seats). Built on the native Google Meet REST API v2 as an official Google Workspace Marketplace add-on, Attendance Tracker logs exact call timestamps in the Meet side panel without bots and exports to Google Sheets in one click.

Helpful links for your directory:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 22,
    name: 'Best of AI',
    to: ['hello@bestofai.io'],
    cc: ['support@bestofai.io'],
    subject: 'Adding Attendance Tracker (Google Meet REST API v2) to BestofAI.io',
    text: `Hi Best of AI Editorial Team,

While browsing your listing for Tactiq (https://bestofai.io/tools/tactiq/), I wanted to share Attendance Tracker (https://attendancetracker.dev) for your Google Meet tools category and alternatives section.

Unlike Chrome extensions that scrape DOM captions—or Google's built-in attendance report that requires Enterprise licenses and 5+ participants—Attendance Tracker is an official zero-bot Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It tracks exact participant join/leave durations inside the Meet side panel and exports to Google Sheets in one click.

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
    name: 'IABOXTOOL Spain',
    to: ['hola@iaboxtool.es'],
    cc: ['info@iaboxtool.es'],
    subject: 'Complemento oficial de asistencia en Google Meet (REST API v2, sin bots) para IABOXTOOL',
    text: `Hola equipo de IABOXTOOL,

Leyendo vuestra reseña "Tactiq: El Futuro de las Reuniones Está Aquí" (https://iaboxtool.es/tactiq-futuro-reuniones/), quería presentaros Attendance Tracker (https://attendancetracker.dev) como alternativa y complemento especializado para usuarios de Google Meet en España.

A diferencia de las extensiones de Chrome que dependen del DOM—o del informe nativo de Google que exige planes Enterprise y al menos 5 participantes—Attendance Tracker es un complemento oficial en Google Workspace Marketplace construido sobre la API REST v2 nativa de Google Meet (en español). Registra entradas y salidas en el panel lateral sin bots y exporta a Google Sheets en un clic.

Enlaces útiles por si deseáis incluirlo en vuestro directorio o comparativas:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Comparativa de extensiones y complementos de Google Meet: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Complemento oficial: https://attendancetracker.dev

Un cordial saludo,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 24,
    name: 'Bianca Lincks',
    to: ['bianca@globallincks.com'],
    cc: ['info@biancalincks.com'],
    subject: 'Quick note on your 10 AI Tools post + Google Meet webinar attendance tracking',
    text: `Hi Bianca,

While reading your post "10 AI Tools to Clone Yourself and Dominate Your Real Estate Marketing" (https://biancalincks.com/10-ai-tools-to-clone-yourself-and-dominate-your-real-estate-marketing/) where you recommend tactiq.io for Google Meet calls, I wanted to share a zero-bot Google Meet add-on built for client consultations and training webinars.

When hosting buyer/seller consultations, team huddles, or marketing webinars on Google Meet, Google's built-in attendance report requires Enterprise seats and never triggers on calls under 5 people. I built Attendance Tracker (https://attendancetracker.dev)—an official Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact attendee durations in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you ever update your toolkit post:
- Webinars & client training attendance guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 25,
    name: 'AITDL Directory',
    to: ['hello@aitdl.com'],
    cc: ['support@aitdl.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for AITDL’s directory',
    text: `Hi AITDL Team,

While browsing your directory listing "Tactiq — Free AI Tool" (https://aitdl.com/tools/tactiq/), I wanted to share our free-tier Google Workspace Marketplace add-on, Attendance Tracker (https://attendancetracker.dev), for your Google Meet tools category.

Instead of relying on DOM-scraping Chrome extensions or intrusive meeting bots—and because Google's native report requires paid Enterprise seats and 5+ participants—Attendance Tracker is built on the native Google Meet REST API v2. It tracks exact participant join/leave durations inside the Meet side panel and exports to Google Sheets in one click.

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
    id: 26,
    name: 'Smatchu Japan',
    to: ['info@smatchu.com'],
    cc: ['contact@smatchu.com'],
    subject: '【Smatchu様】業務効率化コラムへのGoogle Meet公式出席管理アドオン（日本語対応）のご提案',
    text: `Smatchu（スマッチュ）編集部 ご担当者様

貴サイトの業務効率化コラム（https://smatchu.com/column/realestate-claude-guide）にて、外部リファレンスとして tactiq.io/learn/claude-vs-gemini を参照されているのを拝見し、ご連絡いたしました。

オンライン商談や社内定例をGoogle Meetで行う際、Google標準の出席レポートはEnterpriseプラン限定かつ5名未満の会議では作動しません。私が開発した公式Google Workspace Marketplaceアドオン「Attendance Tracker」（https://attendancetracker.dev）は、Google Meet REST API v2ネイティブ対応（日本語UI完備）で、ボット不要でサイドパネルから正確な参加時間を記録し、ワンクリックでGoogleスプレッドシートへ出力します。

業務効率化ツールの補足リソースとしてぜひご検討ください。
- Google Meet出席確認ガイド：https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- リモートチーム向け出席管理：https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- 公式アドオン：https://attendancetracker.dev

どうぞよろしくお願いいたします。

Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 27,
    name: 'Clarity Treinamentos Brazil — Marcelo',
    to: ['marcelo@claritytreinamentos.com.br'],
    cc: ['contato@claritytreinamentos.com.br'],
    subject: 'Add-on oficial de lista de presença e certificados no Google Meet para a Clarity Treinamentos, Marcelo',
    text: `Olá Marcelo, tudo bem?

Consultando o seu "Índice de Ferramentas de IA Generativa" na Clarity Treinamentos (https://claritytreinamentos.com.br/indice-de-ferramentas-de-ia-generativa/) onde você lista o tactiq.io para o Google Meet, queria apresentar uma ferramenta oficial que criei para treinamentos corporativos e aulas ao vivo.

Como o relatório nativo de presença do Google Meet exige licenças Enterprise e não funciona em turmas ou reuniões com menos de 5 pessoas, desenvolvi o Attendance Tracker (https://attendancetracker.dev): um add-on oficial no Google Workspace Marketplace baseado na API REST v2 nativa do Google Meet (em português) que registra horários exatos no painel lateral sem bots e exporta para o Google Sheets ou gera certificados PDF em um clique.

Links úteis caso queira incluir no índice da Clarity:
- Lista de presença no Google Meet (PT-BR): https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Guia para treinamentos e webinars no Google Meet: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Add-on oficial: https://attendancetracker.dev

Um abraço,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 28,
    name: 'Martin Kaessler Germany',
    to: ['info@martinkaessler.com'],
    cc: ['kontakt@martinkaessler.com'],
    subject: 'Kurzer Hinweis zu Ihrem Blogartikel + botfreies Google Meet REST API v2 Add-on (auf Deutsch)',
    text: `Hallo Herr Kaessler,

beim Lesen Ihres Artikels auf martinkaessler.com (https://www.martinkaessler.com/wie-kann-ich-mit-ki-youtube-videos-als-geschriebenen-text-zusammenfassen/), in dem Sie auf die Tools von tactiq.io verweisen, wollte ich Ihnen eine datenschutzfreundliche Ergänzung für Google Meet vorstellen.

Da der native Google Meet-Anwesenheitsbericht ein Enterprise-Abo und mindestens 5 Teilnehmende voraussetzt, habe ich Attendance Tracker (https://attendancetracker.dev) entwickelt: ein offizielles Google Workspace Marketplace Add-on auf Basis der nativen Google Meet REST API v2 (mit kompletter deutscher Oberfläche), das Teilnahmedauern auch in 1-zu-1-Calls direkt im Seitenbereich ohne Bots protokolliert und per Klick nach Google Sheets exportiert.

Hilfreiche Links als Ergänzung für Ihre Leser:
- Google Meet Anwesenheit für Remote-Teams: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Schritt-für-Schritt-Anleitung für Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Offizielles Add-on: https://attendancetracker.dev

Beste Grüße
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 29,
    name: 'Pocho Costa Podcast Spain',
    to: ['hola@pochocosta.com'],
    cc: ['info@pochocosta.com'],
    subject: 'Nota sobre tu episodio de reuniones en Google Meet + control de asistencia sin bots, Pocho',
    text: `Hola Pocho,

Escuchando y leyendo las notas de tu episodio "Potencia tus reuniones con la asistencia de la IA" (https://pochocosta.com/podcast/potencia-tus-reuniones-con-la-asistencia-de-la-ia/) donde recomiendas tactiq.io para Google Meet, quería compartirte un complemento oficial de Google Workspace muy práctico para consultores y equipos remotos.

En llamadas 1-a-1 con clientes o reuniones de menos de 5 personas en Google Meet, el informe nativo de asistencia de Google nunca se activa (y además exige planes Enterprise). He desarrollado Attendance Tracker (https://attendancetracker.dev), un complemento oficial basado en la API REST v2 nativa de Google Meet (en español) que registra entradas, salidas y duración exacta en el panel lateral sin bots y exporta a Google Sheets en un clic.

Te dejo estos enlaces por si te resultan útiles para las notas del podcast:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Guía para equipos remotos y proyectos: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Complemento oficial: https://attendancetracker.dev

Un abrazo,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 30,
    name: 'José David G-Suite Education Spain',
    to: ['hola@jose-david.com'],
    cc: ['contacto@jose-david.com'],
    subject: 'Enlace roto de Chrome Web Store en tu guía "Cómo pasar lista en Hangouts Meet", José David',
    text: `Hola José David,

Leyendo tu artículo para docentes "Cómo pasar lista automáticamente en Hangouts Meet" (https://jose-david.com/blog/g-for-education/como-pasar-lista-en-hangouts-meet/), vi que el enlace a la extensión de Chrome Web Store (con ID nenibigflkdikhamlnekfppbganmojlg) está caído y devuelve un error 404 porque Google retiró esa extensión antigua.

Para que los profesores que leen tu guía tengan una alternativa actual que no dependa de extensiones que rompen cuando cambia el diseño de Meet, he creado Attendance Tracker (https://attendancetracker.dev): un complemento oficial en Google Workspace Marketplace basado en la API REST v2 nativa de Google Meet (en español) que pasa lista desde el panel lateral sin bots y exporta a Google Sheets en un clic.

Enlaces de reemplazo por si quieres actualizar ese 404:
- Por qué dejaron de funcionar las extensiones antiguas de lista en Meet: https://attendancetracker.dev/google-meet-attendance-extension-broken.html
- Guía actualizada de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Complemento oficial: https://attendancetracker.dev

Un cordial saludo,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  }
];

function getLogFilePath() {
  const envPath = process.env.WAVE21_LOG_FILE ? process.env.WAVE21_LOG_FILE.trim() : '';
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
Wave 21 Outreach Dispatcher (30 Verified Backlink Outreach Targets)
Usage:
  node scripts/send-wave21-outreach.cjs --dry-run
  node scripts/send-wave21-outreach.cjs --dry-run --target=1
  node scripts/send-wave21-outreach.cjs --test
  node scripts/send-wave21-outreach.cjs --test --target=1
  node scripts/send-wave21-outreach.cjs --send --target=1
  node scripts/send-wave21-outreach.cjs --send --all
  node scripts/send-wave21-outreach.cjs --send --target=1 --force
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
