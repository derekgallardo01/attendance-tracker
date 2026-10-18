#!/usr/bin/env node
/**
 * scripts/send-wave17-outreach.cjs
 *
 * Dedicated dispatcher for Wave 17 Backlink Outreach (30 Verified Targets):
 * - Carried-over Verified Reserve Targets from Wave 16 (Targets 1–15, DR 34–37)
 * - Global SaaS Publications, Newsletters, AI Directories & Workflow Guides (Targets 16–30, DR 35–42)
 *
 * Sends personalized, anti-AI founder emails from Derek Gallardo <derek@attendancetracker.dev>
 * via the Resend API with reply-to derek@attendancetracker.dev.
 *
 * Safety & Execution features:
 * 1. Deduplication log in `docs/wave17-dispatch-log.json` (overridable via `WAVE17_LOG_FILE`) to prevent duplicate sends.
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
const LOG_FILE = path.resolve(__dirname, '../docs/wave17-dispatch-log.json');

const TARGETS = [
  {
    id: 1,
    name: 'Remote First Jobs',
    to: ['support@remotefirstjobs.com'],
    cc: ['hello@remotefirstjobs.com'],
    subject: 'Zero-bot Google Meet attendance add-on for your Remote-First guide',
    text: `Hi Remote First Jobs Editorial Team,

While reading your guide "What Does Remote First Mean? Discover Its Benefits & How to Thrive" (https://remotefirstjobs.com/blog/what-does-remote-first-mean), I noticed you link to scribbl.co/post/how-to-improve-team-collaboration on improving remote team collaboration.

For remote-first engineering teams and hiring managers running standups or candidate interviews on Google Meet, Google's native attendance report requires Enterprise plans and never triggers on calls under 5 participants. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact participant durations in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand that remote work guide:
- Remote-first teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Remote candidate interviews guide: https://attendancetracker.dev/google-meet-attendance-for-job-interviews.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 2,
    name: 'Elite Asia Singapore',
    to: ['enquiry-sg@eliteasia.co'],
    cc: ['enquiry-hk@eliteasia.co'],
    subject: 'Multilingual (44-locale) Google Meet attendance add-on for Elite Asia’s blog',
    text: `Hi Elite Asia Editorial Team,

While reading your guide "What Is an SRT File? How to Create It? A Complete Guide" (https://www.eliteasia.co/what-is-an-srt-file/), I noticed you link to tactiq.io/learn/step-by-step-guide-to-creating-srt-files regarding multilingual meeting records.

For language schools, corporate trainers, and APAC teams hosting multilingual sessions on Google Meet, Google's built-in attendance report requires Enterprise licenses and won't trigger on classes under 5 people. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 localized in 44 languages (including English, Chinese, Japanese, Korean, Malay, and Vietnamese) that exports attendance to Google Sheets and PDF certificates in one click.

Helpful resources if you update your guide:
- Language schools & multilingual training guide: https://attendancetracker.dev/google-meet-attendance-for-language-schools.html
- Webinars & corporate training guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 3,
    name: 'ScreenSnap Pro',
    to: ['support@screensnap.pro'],
    cc: ['hello@screensnap.pro'],
    subject: 'Native Google Meet REST API v2 companion for ScreenSnap Pro’s video tools blog',
    text: `Hi ScreenSnap Pro Team,

While reading your post "8 Best AI Video Summarizers (2026): How They Actually Work" (https://www.screensnap.pro/blog/ai-video-summarizer) where you feature tactiq.io for Google Meet users, I wanted to share a zero-bot Google Meet companion built for remote teams.

Unlike legacy Chrome extensions that scrape the DOM and break when Google updates Meet's interface—or Google's built-in attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on running on the native Google Meet REST API v2. It opens inside the Meet side panel, merges reconnects, and exports attendance to Google Sheets in one click.

Helpful links if you expand your Google Meet tools coverage:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 4,
    name: 'AI Parabellum',
    to: ['hello@aiparabellum.com'],
    cc: ['contact@aiparabellum.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for AI Parabellum’s Tactiq review',
    text: `Hi AI Parabellum Editorial Team,

I just read your detailed breakdown "Tactiq: Features, Benefits, Pricing, Alternatives and Review" (https://aiparabellum.com/tactiq-ai/), where you cover Google Meet workflow tools and alternatives.

For readers looking for a dedicated Google Meet attendance tracker that doesn't rely on browser caption scraping or external bots—especially on calls under 5 participants where Google's native report refuses to fire—I built Attendance Tracker (https://attendancetracker.dev). It's an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2 that logs exact join/leave durations in the Meet side panel and exports to Google Sheets in one click.

Useful links if you update your alternatives section:
- Extensions vs. native REST API v2 add-on: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 5,
    name: 'HoverNotes',
    to: ['support@hovernotes.io'],
    cc: ['hello@hovernotes.io'],
    subject: 'Non-competing Google Meet REST API v2 link idea for HoverNotes’ Obsidian blog',
    text: `Hi HoverNotes Team,

While reading your post "Obsidian Video-Notizen: Die besten Ansätze für 2026" (https://hovernotes.io/de/blog/obsidian-video-notes-2025), I noticed you link out to tactiq.io/learn/best-video-note-takers-2025.

Since HoverNotes and our tool serve students, university lecturers, and researchers without competing on video notes at all, I wanted to share Attendance Tracker (https://attendancetracker.dev). Built on the native Google Meet REST API v2 (with full German and English UI localization), our official Google Workspace Marketplace add-on tracks seminar and lecture attendance inside the Google Meet side panel without bots and exports to Google Sheets or PDF certificates in one click.

Helpful links if you'd like to cite a non-competing resource:
- University & seminar attendance guide: https://attendancetracker.dev/google-meet-attendance-for-universities.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 6,
    name: 'Toolfolio — Dudu',
    to: ['dudu@toolfolio.com'],
    cc: ['hello@toolfolio.com'],
    subject: 'Adding Attendance Tracker (Google Meet REST API v2) to Toolfolio’s Meeting collection',
    text: `Hi Dudu and the Toolfolio Team,

While browsing Toolfolio's curated "12 Best AI Meeting Assistants in 2026" collection (https://toolfolio.com/collections/ai-meeting-assistants) where you feature scribbl.co for Google Meet, I wanted to share Attendance Tracker (https://attendancetracker.dev) for consideration on Toolfolio.

Unlike bot-based tools or legacy Chrome extensions that scrape the DOM, Attendance Tracker is an official zero-bot Google Workspace Marketplace add-on built on the native Google Meet REST API v2. Remote teams, educators, and designers use it inside the Google Meet side panel to log exact join/leave durations on any meeting size and export to Google Sheets in one click.

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
    id: 7,
    name: 'GetElyxAI',
    to: ['help@getelyxai.com'],
    cc: ['hello@getelyxai.com'],
    subject: 'Export automatique Google Meet vers Google Sheets & Excel pour le blog ElyxAI',
    text: `Bonjour l'équipe ElyxAI,

En lisant votre article sur l'automatisation des feuilles de calcul (https://getelyxai.com/fr/blog/ai-for-spreadsheets), j'ai remarqué votre lien vers scribbl.co/post/what-is-workflow-automation à propos de l'automatisation des flux de travail.

Pour vos lecteurs qui travaillent sur Google Sheets et Excel, une tâche manuelle fréquente consiste à récupérer les listes de présence de Google Meet (car le rapport natif de Google exige un forfait Enterprise et au moins 5 participants). J'ai développé Attendance Tracker (https://attendancetracker.dev), un module officiel sur le Google Workspace Marketplace basé sur l'API REST v2 native de Google Meet (en français) qui exporte les présences vers Google Sheets ou Excel en un clic.

Quelques liens utiles pour compléter votre article :
- Exporter les présences Google Meet vers Sheets : https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Exporter les participants Google Meet vers Excel : https://attendancetracker.dev/export-google-meet-participants-to-excel.html
- Module officiel : https://attendancetracker.dev

Bien cordialement,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 8,
    name: 'Superdocu',
    to: ['hello@superdocu.com'],
    cc: ['team@superdocu.com'],
    subject: 'Google Meet client onboarding attendance logs for Superdocu’s 2026 Playbook',
    text: `Hi Superdocu Team,

I enjoyed reading your guide "How to Improve Client Experience: Playbook 2026" (https://www.superdocu.com/en/blog/how-to-improve-client-experience/), where you cite scribbl.co/post/client-onboarding-best-practices on structured client onboarding.

Alongside collecting client documents with Superdocu, B2B onboarding teams running kickoff and training calls on Google Meet often need an auditable log of which client stakeholders attended—especially since Google's native attendance report skips calls under 5 people and requires Enterprise seats. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that exports timestamped onboarding attendance to Google Sheets in one click.

Helpful links if you expand that onboarding playbook:
- Webinars & client training attendance guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 9,
    name: 'Keywordme',
    to: ['hello@keywordme.io'],
    cc: ['support@keywordme.io'],
    subject: 'Google Meet agency call duration & Sheets logging for Keywordme’s PPC blog',
    text: `Hi Keywordme Team,

While reading your post "Your Guide to Managing PPC Campaigns for Max ROI" (https://www.keywordme.io/blog/managing-ppc-campaigns), I noticed your link to scribbl.co/post/ai-tools-for-marketing-agencies on tools for marketing agencies.

When PPC and performance marketing agencies run weekly client reporting calls on Google Meet, Google's built-in attendance report requires Enterprise Workspace tiers and won't trigger on calls under 5 participants. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact call durations inside the Meet side panel and exports to Google Sheets in one click.

Useful links if you update that agency tools reference:
- Remote & marketing agency teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 10,
    name: 'Sotion',
    to: ['support@sotion.so'],
    cc: ['hello@sotion.so'],
    subject: 'Google Meet client call attendance automation for Sotion’s Notion Client Portal guide',
    text: `Hi Sotion Team,

While reading your guide "Build a Notion Client Portal Clients Actually Use" (https://sotion.so/blog/notion-client-portal), I saw your link to scribbl.co/post/how-to-improve-client-satisfaction on keeping agency clients engaged.

For agencies using Sotion portals alongside Google Meet for client check-ins and design reviews, Google's built-in attendance report won't fire on calls under 5 people and requires Enterprise seats. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact client call durations in the Meet side panel and exports to Google Sheets or webhooks in one click.

Helpful links if you expand that client management guide:
- Remote & client agency teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 11,
    name: 'Agidesk Brazil',
    to: ['contato@agidesk.com.br'],
    cc: ['suporte@agidesk.com.br'],
    subject: 'Complemento oficial do Google Meet (API REST v2) para o blog da Agidesk',
    text: `Olá equipe editorial da Agidesk,

Lendo o artigo de vocês «Da teoria à prática: transformando e inspirando negócios com a IA» (https://blog.agidesk.com.br/da-teoria-a-pratica-transformando-negocios-e-inspirando-inovacoes-com-a-ia), onde vocês recomendam o tactiq.io para reuniões no Google Meet, queria compartilhar um complemento oficial em português voltado para equipes de atendimento, suporte e gestão de serviços.

Como o relatório nativo de presença do Google Meet exige planos Enterprise e não funciona em reuniões com menos de 5 participantes, desenvolvi o Attendance Tracker (https://attendancetracker.dev) — add-on oficial no Google Workspace Marketplace construído sobre a API REST v2 nativa do Google Meet. Ele roda direto na barra lateral do Meet sem bots, registra horários exatos de entrada/saída e exporta para o Google Sheets em um clique.

Links úteis caso atualizem o artigo:
- Lista de presença no Google Meet: https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Guia para equipes remotas: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Add-on oficial: https://attendancetracker.dev

Um abraço,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 12,
    name: 'Sincomavi Brazil',
    to: ['sincomavi@sincomavi.org.br'],
    cc: ['contato@sincomavi.org.br'],
    subject: 'Controle oficial de presença e quórum no Google Meet (API REST v2) para o Sincomavi',
    text: `Olá equipe de comunicação do Sincomavi,

Ao ler a publicação de vocês «Transforme reuniões em documentos organizados» (https://sincomavi.org.br/?p=15187), em que mencionam o tactiq.io para reuniões online, pensei em compartilhar uma ferramenta oficial em português muito útil para assembleias sindicais, reuniões de diretoria e cursos no Google Meet.

Como o relatório nativo do Google Meet exige licenças Enterprise e mínimo de 5 participantes, criei o Attendance Tracker (https://attendancetracker.dev): o add-on oficial no Google Workspace Marketplace baseado na API REST v2 nativa do Google Meet. Ele funciona direto no painel lateral do Meet sem bots externos, registra presença e quórum com horários exatos, exporta para o Google Sheets e emite certificados PDF em um clique.

Links úteis para os associados e leitores do Sincomavi:
- Lista de presença no Google Meet: https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Controle de quórum e reuniões de diretoria: https://attendancetracker.dev/google-meet-quorum-and-board-meetings.html
- Add-on oficial: https://attendancetracker.dev

Atenciosamente,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 13,
    name: 'ChurchSpring',
    to: ['support@churchspring.com'],
    cc: ['hello@churchspring.com'],
    subject: 'Dedicated church & volunteer Google Meet attendance guide for ChurchSpring’s blog',
    text: `Hi Rohn and the ChurchSpring Team,

I enjoyed reading your guide "How to Measure the Success of Your Church Event Marketing Efforts" (https://churchspring.com/blog/measure-success-church-event/), where you link to tactiq.io/learn/what-is-a-zoom-event-how-to-use-it on tracking virtual ministry events.

For churches running online Bible studies, elders' board meetings, or volunteer trainings on Google Meet, Google's built-in attendance report requires paid Enterprise tiers and won't trigger on small groups under 5 people. We published a dedicated guide specifically for churches and ministries alongside Attendance Tracker (https://attendancetracker.dev)—our zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2.

Helpful links if you ever expand that virtual church events section:
- Google Meet Attendance for Churches & Ministries: https://attendancetracker.dev/google-meet-attendance-for-churches.html
- Volunteer hours & training verification: https://attendancetracker.dev/google-meet-attendance-for-volunteer-hours.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 14,
    name: 'GET THE POINT Germany — Wieland Schmoll',
    to: ['kontakt@getthepoint.de'],
    cc: ['wieland.schmoll@getthepoint.de'],
    subject: 'Offizielles Google Meet Add-on (REST API v2, auf Deutsch) für eure Werkzeug-Empfehlungen',
    text: `Hallo Wieland und das GET THE POINT Team,

beim Lesen eurer Seite «Unsere Arbeiten» (https://www.getthepoint.de/arbeiten/), auf der ihr unter anderem tactiq.io für Online-Meetings empfehlt, wollte ich euch ein ergänzendes Google Meet Tool (komplett auf Deutsch verfügbar) vorstellen.

Da der native Anwesenheitsbericht von Google Meet ein Enterprise-Abo und mindestens 5 Teilnehmende voraussetzt (und daher bei kleineren Kundenterminen oder Workshops gar nicht erst erstellt wird), habe ich Attendance Tracker (https://attendancetracker.dev) entwickelt. Es ist ein offizielles Google Workspace Marketplace Add-on auf Basis der nativen Google Meet REST API v2, das direkt in der Meet-Seitenleiste ohne externe Bots läuft und Teilnahmelisten mit einem Klick nach Google Sheets exportiert.

Hier sind die passenden Links für eure Übersicht:
- Leitfaden für Remote-Teams & Agenturen: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Schritt-für-Schritt-Anleitung für Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Offizielles Add-on: https://attendancetracker.dev

Beste Grüße
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 15,
    name: 'Postline AI',
    to: ['support@postline.ai'],
    cc: ['legal@postline.ai'],
    subject: 'Google Meet webinar & lead attendance automation for Postline.ai’s LinkedIn growth guide',
    text: `Hi Postline.ai Team,

While reading your guide "How to Increase Followers on LinkedIn" (https://postline.ai/blog/2/how-to-increase-followers-on-linkedin), I noticed your link to scribbl.co/post/what-is-customer-sentiment-analysis on analyzing audience and customer calls.

Many founders and B2B creators using LinkedIn content to drive signups for live Google Meet webinars or office hours hit a snag: Google's built-in attendance report requires Enterprise Workspace seats and skips sessions under 5 participants. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact attendee durations in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand that B2B workflow section:
- Webinars & live events attendance guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 16,
    name: 'Around The Bonfire',
    to: ['hello@aroundthebonfire.com'],
    cc: ['info@aroundthebonfire.com'],
    subject: 'Zero-bot Google Meet REST API v2 companion for Around The Bonfire #611',
    text: `Hi Around The Bonfire Editorial Team,

I enjoyed reading issue #611 ("Which of these AI notetakers would you pick?" — https://newsletter.aroundthebonfire.com/p/611-which-of-these-ai-notetakers), where you compare tactiq.io and other meeting assistants for agencies.

As you pointed out, agency leads are increasingly tired of third-party bots crashing client calls—yet Google Meet's native attendance report won't trigger on calls with fewer than 5 people and requires Enterprise tiers. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that quietly logs exact client call durations inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you ever cover zero-bot Google Meet tools:
- Remote & agency teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 17,
    name: 'ToolQuestor',
    to: ['support@toolquestor.com'],
    cc: ['hello@toolquestor.com'],
    subject: 'Listing Attendance Tracker (Google Meet REST API v2, 44 locales incl. Vietnamese) on ToolQuestor',
    text: `Hi ToolQuestor Team,

While browsing your meeting and audio tools directory (https://toolquestor.com/vi/use-case/transcribe-audio) where you feature tactiq.io for Google Meet, I wanted to submit Attendance Tracker (https://attendancetracker.dev) for ToolQuestor.

Unlike legacy Chrome extensions that scrape the DOM and break when Google updates Meet's UI—or Google's native attendance report that requires Enterprise tiers and 5+ participants—Attendance Tracker is an official zero-bot Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It supports 44 languages (including full Vietnamese and English UI localization), merges reconnects, and exports attendance to Google Sheets or PDF certificates in one click.

Key resources for your directory:
- Vietnamese Google Meet attendance guide: https://attendancetracker.dev/diem-danh-google-meet.html
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 18,
    name: 'Una Vida Online Spain — Pau Navarro',
    to: ['contacto@unavidaonline.com'],
    cc: ['info@unavidaonline.com'],
    subject: 'Complemento oficial de Google Meet (API REST v2) para tu Newsletter #73',
    text: `Hola Pau,

Leyendo el archivo de tu Newsletter #73 (https://unavidaonline.com/newsletter/newsletter-73/), vi que recomiendas tactiq.io/es para las reuniones online en Google Meet.

Para formadores, consultores y creadores que imparten mentorías grupales o webinars en Google Meet —donde el informe nativo de asistencia de Google exige cuentas Enterprise y un mínimo de 5 participantes—, desarrollé Attendance Tracker (https://attendancetracker.dev). Es el add-on oficial en Google Workspace Marketplace construido sobre la API REST v2 nativa de Google Meet en español: funciona en el panel lateral sin bots externos, exporta la asistencia a Google Sheets y genera certificados PDF en un clic.

Te dejo los enlaces por si te resulta útil para futuros envíos o actualizar esa nota:
- Guía de asistencia en Google Meet en español: https://attendancetracker.dev/asistencia-google-meet.html
- Asistencia para webinars y formaciones: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Add-on oficial: https://attendancetracker.dev

Un abrazo,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 19,
    name: 'Anarlog',
    to: ['hello@anarlog.so'],
    cc: ['support@anarlog.so'],
    subject: 'Non-competing Google Meet vs. Zoom attendance comparison for Anarlog’s blog',
    text: `Hi Anarlog Editorial Team,

While reading your roundup "7 Best AI Notetakers for Zoom in 2026" (https://anarlog.so/blog/best-ai-notetaker-for-zoom/) where you also cover tactiq.io for Google Meet and Zoom users, I wanted to share a 100% non-competing attendance resource.

Because teams switching between Zoom and Google Meet often discover that Google Meet's native attendance report is locked behind Enterprise plans and refuses to trigger on calls under 5 participants, we published a side-by-side breakdown of Google Meet vs. Zoom attendance tracking alongside Attendance Tracker (https://attendancetracker.dev)—our official zero-bot Google Workspace Marketplace add-on built on the native Google Meet REST API v2.

Helpful links if you expand your cross-platform meeting guides:
- Google Meet vs. Zoom Attendance Tracking Compared: https://attendancetracker.dev/google-meet-vs-zoom-attendance-tracking.html
- How to track attendance in Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 20,
    name: 'Matt Rutherford UK',
    to: ['matt@mattrutherford.co.uk'],
    cc: ['hello@mattrutherford.co.uk'],
    subject: 'Zero-bot Google Meet REST API v2 tool for "Stuff" (note on Stuff #188)',
    text: `Hi Matt,

Enjoyed reading your curated roundup in Stuff #188 (https://www.mattrutherford.co.uk/stuff-188/), where you featured tactiq.io/ai-tools/ai-note-taker for virtual meetings.

If you're ever looking for another practical, zero-bloat Google Meet tool for a future issue of Stuff: Google's built-in Meet attendance report requires Enterprise Workspace seats and won't trigger at all on calls under 5 people. So I built Attendance Tracker (https://attendancetracker.dev)—an official Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that lives quietly in the Meet side panel (zero third-party bots) and exports timestamped attendance to Google Sheets in one click.

Links if you'd like to check it out:
- Remote teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- How it works in Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 21,
    name: 'ITzen Hungary — Sándor Horváth',
    to: ['kozpont@itzen.hu'],
    cc: ['horvath.sandor@itzen.hu'],
    subject: 'Zero-bot Google Meet REST API v2 add-on (with Hungarian UI) for ITzen.hu',
    text: `Hi Sándor and the ITzen Team,

While reading your comprehensive productivity guide on ITzen.hu (https://itzen.hu/chatgpt/) where you recommend app.tactiq.io for Google Meet users, I wanted to share a complementary Google Meet add-on with full Hungarian (hu) interface localization.

Because Google Meet's built-in attendance report requires Enterprise Workspace licenses and won't trigger on meetings under 5 participants—and legacy Chrome extensions break whenever Google updates the DOM—I built Attendance Tracker (https://attendancetracker.dev). It's an official Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that tracks join/leave times inside the Meet side panel without bots and exports to Google Sheets in one click.

Helpful links if you update your Google Meet recommendations:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 22,
    name: 'VoicePing',
    to: ['support@voice-ping.com'],
    cc: ['info@voice-ping.com'],
    subject: 'VoicePing様の文字起こし比較記事へ：競合しないGoogle Meet公式出席管理アドオンのご紹介',
    text: `VoicePing 編集部 ご担当者様

貴社のブログ記事「会議文字起こしツール比較：料金と利用上限【2026年】」（https://voice-ping.com/blog/guide-automatic-meeting-transcription/）を拝読し、競合他社であるTactiq（help.tactiq.io）へ外部リンクされているのを拝見いたしました。

もし文字起こし・翻訳領域で直接競合しないGoogle Meet関連ツールへの参照をご検討される際があれば、私が開発した「Attendance Tracker」（https://attendancetracker.dev）をご活用ください。当ツールは文字起こし機能を一切持たず、Google MeetネイティブREST API v2を用いて会議の入退室時刻・滞在時間のみを正確に記録するGoogle Workspace Marketplace公式アドオンです（日本語UI完全対応・ワンクリックでGoogleスプレッドシートへ出力可能）。

記事のアップデート等の際にご参考になれば幸いです：
- Google Meetでの出席確認ガイド：https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Googleスプレッドシートへの出席データ出力：https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- 公式アドオン：https://attendancetracker.dev

何卒よろしくお願いいたします。

Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 23,
    name: 'Superpower Daily',
    to: ['tips@superpowerdaily.com'],
    cc: ['partnership@superpowerdaily.com'],
    subject: 'Tool submission for Superpower Daily: Official Google Meet REST API v2 Add-on',
    text: `Hi Superpower Daily Team,

While reading your tools roundup in "ChatGPT Can Now Use Adobe Apps to Edit Your Photos" (https://www.superpowerdaily.com/p/chatgpt-can-now-use-adobe-apps-to-edit-your-photos) where you featured tactiq.io for Google Meet, I wanted to share a zero-bot Google Meet add-on for your readers.

Unlike traditional Chrome extensions that scrape the DOM and break whenever Google updates Meet's UI—or Google's native attendance report that requires Enterprise tiers and 5+ participants—Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It runs inside the Meet side panel, merges reconnects, and exports attendance to Google Sheets in one click.

Helpful links if you feature Google Workspace tools in an upcoming issue:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 24,
    name: 'Psycray',
    to: ['contact@psycray.com'],
    cc: ['atcontact@psycray.com'],
    subject: 'Native Google Meet REST API v2 add-on for Psycray’s Google Workspace productivity guide',
    text: `Hi Psycray Editorial Team,

I enjoyed reading your guide "How Gemini Deep Research Assistant Can Save You Hours of Time" (https://psycray.com/how-gemini-deep-research-assistant-can-save-you-hours-of-time/), where you link to tactiq.io/learn on Google Workspace meeting workflows.

Another everyday time-saver for Google Workspace users hosting calls in Google Meet is automating attendance logs—especially since Google's built-in attendance report requires Enterprise plans and won't trigger on calls under 5 participants. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that logs join/leave timestamps in the Meet side panel and exports to Google Sheets in one click.

Helpful resources if you expand your Google Workspace coverage:
- How to track attendance in Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 25,
    name: 'Lead with AI',
    to: ['hello@leadwithai.co'],
    cc: ['info@leadwithai.co'],
    subject: 'Zero-bot Google Meet executive & board attendance add-on for Lead with AI’s guide',
    text: `Hi Daan and the Lead with AI Team,

While reading your executive guide "Building Your Team of AI Assistants for Business Leaders" (https://www.leadwithai.co/guides/ai-assistants-for-business-leaders) where you recommend tactiq.io for Google Meet, I wanted to share a zero-bot Google Meet add-on built for leadership teams and board meetings.

When executives run board meetings, leadership standups, or confidential 1-on-1s on Google Meet, external recording bots are often a non-starter—and Google's native attendance report won't trigger on calls under 5 people or standard Workspace plans. I built Attendance Tracker (https://attendancetracker.dev), an official Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact attendance and quorum inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you update that guide:
- Board meetings & quorum tracking guide: https://attendancetracker.dev/google-meet-quorum-and-board-meetings.html
- Remote leadership teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 26,
    name: 'ByWorking',
    to: ['hello@byworking.net'],
    cc: ['info@byworking.net'],
    subject: 'Google Meet to Sheets & Slack automation for ByWorking’s 10 automation practices guide',
    text: `Hi ByWorking Editorial Team,

I enjoyed reading your article "10 Automation Practices Saving Teams Hours Weekly" (https://byworking.net/blog/10-automation-practices-saving-teams-hours-weekly/), where you link to tactiq.io on automating virtual meeting admin.

Along that exact workflow theme, one repetitive task remote leads still do by hand is logging who attended standups and client calls on Google Meet—since Google's native attendance report requires Enterprise plans and skips meetings under 5 people. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that automatically pushes timestamped attendance to Google Sheets and Slack in one click.

Helpful links if you expand that automation list:
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Sending Google Meet attendance to Slack: https://attendancetracker.dev/how-to-send-google-meet-attendance-to-slack.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 27,
    name: 'WhatTheAI',
    to: ['hello@whattheai.tech'],
    cc: ['support@whattheai.tech'],
    subject: 'Adding Attendance Tracker (Google Meet REST API v2) to WhatTheAI’s Google Meet tools',
    text: `Hi WhatTheAI Team,

While reading your "Tactiq Review: Features, Pricing & Alternatives" page (https://whattheai.tech/tools/tactiq), I wanted to share Attendance Tracker (https://attendancetracker.dev) as a zero-bot Google Meet companion and alternative for your directory.

Unlike legacy Chrome extensions that scrape browser captions or DOM elements—and unlike Google's built-in attendance report that requires Enterprise tiers and 5+ participants—Attendance Tracker is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It opens directly in the Google Meet side panel, merges reconnects, and exports attendance to Google Sheets or PDF certificates in one click.

Key resources for your directory:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 28,
    name: 'PoweredByAI',
    to: ['support@poweredbyai.app'],
    cc: ['hello@poweredbyai.app'],
    subject: 'Listing Attendance Tracker (Google Meet REST API v2, 44 locales) on PoweredByAI',
    text: `Hi PoweredByAI Team,

While viewing your directory profile for Scribbl (https://poweredbyai.app/zh/project/scribbl), I wanted to submit Attendance Tracker (https://attendancetracker.dev) for consideration on PoweredByAI.

Whereas Scribbl uses a meeting bot for transcription, Attendance Tracker is an official zero-bot Google Workspace Marketplace add-on built on the native Google Meet REST API v2 (supporting 44 languages including English, Simplified Chinese, and Traditional Chinese). Remote teams and educators use it inside the Google Meet side panel to track exact participant join/leave durations on any meeting size and export to Google Sheets in one click.

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
    id: 29,
    name: 'NaturalWrite',
    to: ['support@naturalwrite.com'],
    cc: ['hello@naturalwrite.com'],
    subject: 'Non-competing Google Meet attendance guide for NaturalWrite’s NLP blog post',
    text: `Hi NaturalWrite Editorial Team,

While reading your article "What Is Natural Language Processing?" (https://naturalwrite.com/blog/what-is-natural-language-processing), I noticed your citation of scribbl.co/post/what-is-conversation-intelligence on meeting analysis.

For students, university instructors, and remote teams collaborating on Google Meet, Google's built-in attendance report is locked behind Education Plus/Enterprise plans and refuses to trigger on sessions under 5 participants. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that logs participant durations in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand your academic & meeting workflow resources:
- University & higher-ed attendance guide: https://attendancetracker.dev/google-meet-attendance-for-universities.html
- How to track attendance in Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 30,
    name: 'Barker Books',
    to: ['sales@barkerbooks.com'],
    cc: ['info@barkerbooks.com'],
    subject: 'Google Meet client call attendance logs for Barker Books’ scope creep section',
    text: `Hi Barker Books Editorial Team,

I enjoyed reading your guide "How to Hire a Ghostwriter: A Complete Guide" (https://barkerbooks.com/how-to-hire-a-ghostwriter/), where you link to scribbl.co/post/how-to-prevent-scope-creep on preventing scope creep during client projects.

When authors, editors, and agencies hold 1-on-1 interview or milestone sign-off calls on Google Meet, Google's native attendance report never triggers at all (because Google requires 5+ participants and Enterprise seats). I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact call timestamps and durations inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you update that project management section:
- Remote & client project teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  }
];

function getLogFilePath() {
  const envPath = process.env.WAVE17_LOG_FILE ? process.env.WAVE17_LOG_FILE.trim() : '';
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
Wave 17 Outreach Dispatcher (30 Verified Backlink Outreach Targets)
Usage:
  node scripts/send-wave17-outreach.cjs --dry-run
  node scripts/send-wave17-outreach.cjs --dry-run --target=1
  node scripts/send-wave17-outreach.cjs --test
  node scripts/send-wave17-outreach.cjs --test --target=1
  node scripts/send-wave17-outreach.cjs --send --target=1
  node scripts/send-wave17-outreach.cjs --send --all
  node scripts/send-wave17-outreach.cjs --send --target=1 --force
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
