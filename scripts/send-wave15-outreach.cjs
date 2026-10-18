#!/usr/bin/env node
/**
 * scripts/send-wave15-outreach.cjs
 *
 * Dedicated dispatcher for Wave 15 Backlink Outreach (30 Verified Targets):
 * - Carried-over Verified Reserve Targets from Wave 14 (Targets 1–15, DR 32–49)
 * - High-DR Editorial Publications, Agencies, SaaS Directories & Global Media (Targets 16–30, DR 45–81)
 *
 * Sends personalized, anti-AI founder emails from Derek Gallardo <derek@attendancetracker.dev>
 * via the Resend API with reply-to derek@attendancetracker.dev.
 *
 * Safety & Execution features:
 * 1. Deduplication log in `docs/wave15-dispatch-log.json` (overridable via `WAVE15_LOG_FILE`) to prevent duplicate sends.
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
const LOG_FILE = path.resolve(__dirname, '../docs/wave15-dispatch-log.json');

const TARGETS = [
  {
    id: 1,
    name: 'PlusVibe AI',
    to: ['support@plusvibe.ai'],
    cc: ['hello@plusvibe.ai'],
    subject: 'Google Meet sales call attendance automation for PlusVibe’s follow-up email guide',
    text: `Hi PlusVibe Team,

While reading your guide "Effective Sales Call Follow Up Email Strategies to Close More Deals" (https://plusvibe.ai/blog/sales-call-follow-up-email), I noticed you cite scribbl.co/post/how-to-write-a-follow-up-email on post-call workflows.

One common bottleneck for B2B sales reps sending multi-stakeholder follow-ups after a Google Meet demo is knowing exactly which buyer stakeholders joined—since Google's built-in attendance report requires Enterprise plans and never triggers on calls under 5 participants. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs participant durations in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand that post-call workflow section:
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- See who attended Google Meet after it ended: https://attendancetracker.dev/see-who-attended-google-meet-after-it-ended.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 2,
    name: 'NILG.AI',
    to: ['info@nilg.ai'],
    cc: ['privacy@nilg.ai'],
    subject: 'Automação de presença no Google Meet (API REST v2) para o blog da NILG.AI',
    text: `Olá equipa da NILG.AI,

Ao ler o vosso artigo «8 Benefícios Essenciais da Automação de Processos para o seu Negócio» (https://nilg.ai/pt/202507/process-automation-benefits/), reparei que referenciam scribbl.co/post/how-to-use-ai-to-take-meeting-notes-guide sobre utilizar IA para anotações de reuniões.

Para equipas que também pretendem automatizar o registo de presenças no Google Meet — já que o relatório nativo da Google exige planos Enterprise e um mínimo de 5 participantes — desenvolvi o Attendance Tracker (https://attendancetracker.dev). É um add-on oficial no Google Workspace Marketplace construído sobre a API REST v2 nativa do Google Meet (sem bots externos), que regista entradas/saídas no painel lateral do Meet e exporta para o Google Sheets num clique.

Links úteis caso queiram complementar o artigo:
- Guia em português: https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Equipas remotas: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Add-on oficial: https://attendancetracker.dev

Melhores cumprimentos,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 3,
    name: 'Bubble Plan',
    to: ['contact@bubbleplan.net'],
    cc: ['support@bubbleplan.net'],
    subject: 'Module complémentaire Google Meet (API REST v2) pour le blog Bubble Plan',
    text: `Bonjour l'équipe Bubble Plan,

En lisant votre article « Restez focus sur votre réunion, Tactiq s’occupe du reste ! » (https://bubbleplan.net/blog/tactiq-outil-collaboratif/), j'ai pensé vous partager un outil complémentaire en français destiné aux chefs de projet et équipes utilisant Google Meet.

Comme le rapport de présence natif de Google Meet exige un forfait Enterprise et au moins 5 participants, j'ai développé Attendance Tracker (https://attendancetracker.dev). C'est un module officiel sur le Google Workspace Marketplace basé sur l'API REST v2 native de Google Meet (entièrement traduit en français). Il s'ouvre directement dans le panneau latéral de Meet sans bot externe, fusionne les reconnexions et exporte les présences vers Google Sheets en un clic.

Quelques ressources utiles si vous mettez à jour votre article :
- Guide pour les équipes à distance : https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Tutoriel complet : https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Module officiel : https://attendancetracker.dev

Bien cordialement,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 4,
    name: 'CF Contabilidade',
    to: ['faleconosco@cfcontabilidade.com.br'],
    cc: ['contato@cfcontabilidade.com.br'],
    subject: 'Complemento oficial do Google Meet (API REST v2) para o blog da CF Contabilidade',
    text: `Olá equipe editorial da CF Contabilidade,

Lendo o artigo de vocês «12 ferramentas de inteligência artificial na Contabilidade» (https://cfcontabilidade.com.br/ferramentas-de-inteligencia-artificial-na-contabilidade/), onde vocês destacam o tactiq.io para reuniões no Google Meet, queria compartilhar uma ferramenta oficial em português voltada para escritórios contábeis e treinamentos CRC/EPC.

Como o relatório nativo de presença do Google Meet exige planos Enterprise e não funciona em reuniões com menos de 5 pessoas, criei o Attendance Tracker (https://attendancetracker.dev) — add-on oficial no Google Workspace Marketplace construído na API REST v2 nativa do Google Meet. Ele roda direto na barra lateral do Meet sem bots, registra horários exatos de clientes e equipes, exporta para o Google Sheets e gera certificados PDF em um clique.

Links úteis caso atualizem o guia:
- Lista de presença no Google Meet: https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Controle para créditos CPE/educação continuada: https://attendancetracker.dev/google-meet-attendance-for-cpe-and-cle-credits.html
- Add-on oficial: https://attendancetracker.dev

Um abraço,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 5,
    name: 'Transcript.lol',
    to: ['support@transcript.lol'],
    cc: ['hello@transcript.lol'],
    subject: 'Non-competing Google Meet link idea for Transcript.lol’s speech-to-text blog',
    text: `Hi Transcript.lol Team,

While reading your post "Demystifying Speech to Text Accuracy" (https://transcript.lol/blog/speech-to-text-accuracy), I noticed you currently link out to rival transcription provider scribbl.co/post/best-meeting-transcription-software.

If you'd prefer to cite a 100% non-competing meeting tool instead of a competing transcription product, I built Attendance Tracker (https://attendancetracker.dev). We don't do speech-to-text or meeting notes at all—we're an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that logs participant join/leave durations inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you'd like to swap or add a non-competing reference:
- How to track attendance in Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 6,
    name: 'Textla',
    to: ['press@textla.com'],
    cc: ['support@textla.com'],
    subject: 'Google Meet webinar & demo attendance add-on for Textla’s sales guide',
    text: `Hi Textla Editorial Team,

While reading your guide "How-to Send Mass Texts The Right Way" (https://www.textla.com/post/how-to-send-mass-texts), I saw your link to scribbl.co/post/how-to-handle-sales-objections on effective sales objection handling.

When teams use SMS reminders to drive attendance to live Google Meet demos or webinars, they often hit a snag: Google's built-in attendance report requires Enterprise seats and never fires on calls under 5 participants. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact participant durations inside the Meet side panel and exports to Google Sheets in one click.

Helpful resources if you expand that sales workflow section:
- Webinars & live training attendance guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 7,
    name: 'Virtuall.pro',
    to: ['founders@virtuall.pro'],
    cc: ['support@virtuall.pro'],
    subject: 'Zero-bot Google Meet attendance add-on for Virtuall’s agency project management guide',
    text: `Hi Virtuall Team,

I enjoyed reading your guide "Kanban Board Project Management Explained" (https://virtuall.pro/blog/kanban-board-project-management), where you link to scribbl.co/post/project-management-for-agencies on project management for creative agencies.

For 3D, creative, and production teams running daily standups or client asset reviews on Google Meet, Google's native attendance report requires Enterprise plans and won't trigger on calls under 5 participants. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on built on the native Google Meet REST API v2 that tracks join/leave timestamps in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you update that agency workflow guide:
- Remote & creative agency teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 8,
    name: 'Simbie AI',
    to: ['founders@simbie.ai'],
    cc: ['info@simbie.ai'],
    subject: 'Privacy-first Google Meet attendance add-on for Simbie AI’s healthcare communication guide',
    text: `Hi Simbie AI Team,

While reading your article "A Guide to Modern Medical Call Centers" (https://www.simbie.ai/medical-call-centers/), I noticed your citation of scribbl.co/post/client-communication-best-practices on patient and client communication workflows.

In healthcare, clinical supervision, and telehealth training sessions on Google Meet, third-party recording bots raise immediate privacy concerns—and Google's native attendance report won't trigger on sessions with fewer than 5 people. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact session durations inside the Meet side panel without recording audio or video, and exports to Google Sheets or PDF certificates in one click.

Useful resources if you update that guide:
- Clinical supervision & healthcare teams guide: https://attendancetracker.dev/google-meet-clinical-supervision-and-therapy.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 9,
    name: 'Movavi.io',
    to: ['support@movavi.io'],
    cc: ['info@movavi.io'],
    subject: 'Native Google Meet REST API v2 companion for Movavi.io’s meeting productivity guide',
    text: `Hi Movavi.io Editorial Team,

While reading your guide "Top 11 AI Note Takers for Meetings & Productivity" (https://www.movavi.io/top-ai-note-takers-for-meetings-and-productivity/) featuring tactiq.io for Google Meet, I wanted to share a zero-bot Google Meet add-on built for verified attendance tracking.

Unlike browser extensions that scrape the DOM and break when Google updates Meet's UI—or Google's native attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on running on the native Google Meet REST API v2. It opens directly inside the Meet side panel, merges reconnects, and exports attendance to Google Sheets in one click.

Helpful links if you expand that meeting productivity guide:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 10,
    name: 'Icy Tales',
    to: ['team@icytales.com'],
    cc: ['ceo@icytales.com'],
    subject: 'Note on Google’s 10090454 attendance doc in your Google Workspace feature',
    text: `Hi Icy Tales Editorial Team,

I enjoyed reading your feature "The Boss In The Cloud: How Google Workspace Turned Productivity Tools Into A Surveillance Machine" (https://icytales.com/the-boss-in-the-cloud-how-google-workspace-turned-productivity-tools-into-a-surveillance-machine/), where you link directly to Google's support documentation (support.google.com/meet/answer/10090454).

As you highlighted, enterprise telemetry often feels opaque to participants—while paradoxically, independent educators and small teams on standard Workspace plans can't even get basic attendance logs from Google's native tool because it requires Enterprise tiers and 5+ attendees. To provide a transparent, zero-bot alternative with zero audio/video recording, I built Attendance Tracker (https://attendancetracker.dev) on the native Google Meet REST API v2.

Helpful links if you ever add context around how Meet attendance works:
- How Google Meet attendance tracking works: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Our zero-bot privacy architecture: https://attendancetracker.dev/student-data-privacy.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 11,
    name: 'Compresto — Hieu Dinh',
    to: ['hieu@compresto.app'],
    cc: ['support@compresto.app'],
    subject: 'From a fellow indie founder: Google Meet link in your team productivity post',
    text: `Hi Hieu,

Big fan of what you've built with Compresto! While reading your post "How to Improve Team Productivity Without Burning Out" (https://compresto.app/blog/how-to-improve-team-productivity), I noticed your link to scribbl.co/post/how-to-improve-team-collaboration.

As a fellow developer, I built Attendance Tracker (https://attendancetracker.dev) to solve a specific annoyance for remote teams on Google Meet: Google's native attendance report is locked behind Enterprise tiers and won't trigger on calls under 5 participants. Our official Google Workspace Marketplace add-on uses the native Google Meet REST API v2 (no creepy meeting bots), runs in the Meet side panel, and exports timestamped logs to Google Sheets in one click.

If you ever update that post, here are our guides:
- Remote teams productivity guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 12,
    name: 'SetSail',
    to: ['info@setsail.co'],
    cc: ['privacy@setsail.co'],
    subject: 'Google Meet REST API v2 attendance automation for SetSail’s B2B sales guide',
    text: `Hi SetSail Editorial Team,

While reading your guide "8 Ways B2B Sales Teams Can Use ChatGPT: A Complete Guide to Getting Started" (https://www.setsail.co/blog/chatgpt-b2b-sales-process) where you mention tactiq.io for sales calls, I wanted to share a zero-bot Google Meet add-on built for B2B revenue teams.

Because Google Meet's native attendance reports require specific Enterprise tiers and skip discovery or demo calls with fewer than 5 participants, sales teams often miss verified multi-stakeholder attendance data unless they invite external recording bots. Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact participant durations inside the Meet side panel and syncs to Google Sheets or CRM webhooks in one click.

Helpful resources if you update that B2B sales guide:
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Webinars & customer training guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 13,
    name: 'AonMeetings',
    to: ['info@aonmeetings.com'],
    cc: ['support@aonmeetings.com'],
    subject: 'Non-competing Google Meet attendance template & guide for AonMeetings’ blog',
    text: `Hi AonMeetings Editorial Team,

I enjoyed reading your guide "Your Best Team Meeting Agenda: A 2026 Guide" (https://aonmeetings.com/blog/meeting-guides/team-meeting-agenda), where you cite scribbl.co/post/meeting-management-best-practices.

For readers who also need a structured attendance template or have to run external client calls on Google Meet (where Google's native attendance report skips meetings under 5 people and requires Enterprise plans), we published a free attendance template alongside Attendance Tracker (https://attendancetracker.dev)—our official Google Workspace Marketplace add-on built on the native Google Meet REST API v2.

Helpful links if you expand that meeting management guide:
- Free Meeting Attendance Sheet Template: https://attendancetracker.dev/google-meet-attendance-template.html
- How to track attendance in Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 14,
    name: 'Aristo Meeting Center Netherlands',
    to: ['info@aristo.nl'],
    cc: ['boeking@aristo.nl'],
    subject: 'Aanvullende Google Meet aanwezigheidstool (met Nederlandse interface) voor jullie blog',
    text: `Beste redactie van Aristo Meeting Center,

Met veel interesse las ik jullie blogartikel «Notuleren met AI: 3 handige tools voor slimme samenvattingen» (https://aristo.nl/blog/notuleren-met-ai-3-handige-tools-voor-slimme-samenvattingen), waarin jullie tactiq.io aanbevelen voor online vergaderingen.

Voor trainers, docenten en organisatoren van hybride bijeenkomsten via Google Meet is het bijhouden van de presentielijst vaak lastig, omdat het standaardrapport van Google een Enterprise-licentie en minimaal 5 deelnemers vereist. Daarom heb ik Attendance Tracker (https://attendancetracker.dev) ontwikkeld: een officiële Google Workspace Marketplace add-on op basis van de native Google Meet REST API v2 (volledig beschikbaar in het Nederlands). Het werkt direct in het zijpaneel van Meet zonder bots, exporteert naar Google Spreadsheets en maakt met één klik PDF-deelnamecertificaten.

Handige links voor jullie lezers:
- Gids voor webinars en trainingen: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Stapsgewijze handleiding: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Officiële add-on: https://attendancetracker.dev

Met vriendelijke groet,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 15,
    name: 'MuteDeck',
    to: ['support@mutedeck.com'],
    cc: ['hello@mutedeck.com'],
    subject: 'Note on Google’s 10090454 attendance doc in MuteDeck’s meeting recap guide',
    text: `Hi Martijn and the MuteDeck Team,

I enjoyed reading your guide "Meeting Follow Up Recap: A Host Workflow That Sticks" (https://mutedeck.com/blog/2026-07-31-meeting-follow-up-recap-controls/), where you link directly to Google's help page support.google.com/meet/answer/10090454 on "Meet attendance report help".

One catch many hosts discover the hard way with that Google doc is that native Meet attendance reports require eligible Enterprise/Business Plus tiers and never generate at all on meetings with fewer than 5 participants. To give Google Meet hosts reliable attendance logs on any Workspace tier or call size without external bots, I built Attendance Tracker (https://attendancetracker.dev) on the native Google Meet REST API v2.

Helpful links if you'd like to give readers a workaround right beside that link:
- Why Google Meet attendance reports don't show up: https://attendancetracker.dev/google-meet-attendance-report-not-showing-up.html
- See who attended Google Meet after it ended: https://attendancetracker.dev/see-who-attended-google-meet-after-it-ended.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 16,
    name: 'Rappler Philippines',
    to: ['desk@rappler.com'],
    cc: ['info@rappler.com'],
    subject: 'Google Meet attendance add-on for Rappler’s student & classroom productivity list',
    text: `Hi Rappler Life & Tech Editorial Team,

While reading your feature "LIST: 11 websites, apps that help boost students' productivity" (https://www.rappler.com/technology/features/websites-apps-boost-students-productivity/) where you highlight tactiq.io for Google Meet classes, I wanted to share an official Google Meet add-on widely used by teachers and university faculty in the Philippines.

Because Google Meet's native attendance report is locked behind paid Education Plus tiers and won't trigger on small group sessions under 5 participants, teachers on standard Google Workspace for Education Fundamentals often have to check roll manually. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that automatically merges student reconnects on unstable mobile data and exports to Google Sheets or DepEd SF2-ready formats in one click.

Helpful resources for Filipino educators and students:
- Philippines Teachers & DepEd SF2 Guide: https://attendancetracker.dev/google-meet-attendance-philippines-teachers.html
- University & higher-ed guide: https://attendancetracker.dev/google-meet-attendance-for-universities.html
- Official add-on: https://attendancetracker.dev

We also provide free lifetime educator passes for teachers.

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 17,
    name: 'DEPT Agency',
    to: ['info@deptagency.com'],
    cc: ['hello@deptagency.com'],
    subject: 'Native Google Meet REST API v2 add-on for DEPT’s standup & workflow insights',
    text: `Hi DEPT Editorial Team,

While reading your insight piece "A Practical Guide to Implementing AI Agents" (https://www.deptagency.com/insight/a-practical-guide-to-implementing-ai-agents/), I noticed your link to tactiq.io/ai-tools/ai-note-taker-for-standup-meetings regarding daily standup automation.

For distributed engineering and creative teams running standups or client workshops on Google Meet, Google's native attendance report requires Enterprise seats and skips any call under 5 participants—while third-party recording bots often clutter the call. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that logs exact participant durations inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand your standup tooling references:
- Remote & distributed teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 18,
    name: 'Promo.com',
    to: ['support@promo.com'],
    cc: ['info@promo.com'],
    subject: 'Dedicated Google Meet fitness & coaching attendance guide for Promo.com’s blog',
    text: `Hi Promo.com Editorial Team,

I enjoyed reading your article "84% of Clients Want AI in Their Workouts: How Personal Trainers Can Stay Ahead" (https://promo.com/blog/84-of-clients-want-ai-in-their-workouts-how-personal-trainers-can-stay-ahead-in-2024), where you link to tactiq.io/ai-tools/ai-note-taker for online coaching sessions.

For personal trainers, yoga instructors, and wellness coaches hosting live virtual classes or 1-on-1 sessions on Google Meet, Google's built-in attendance report requires Enterprise Workspace plans and never triggers on sessions under 5 people. We published a dedicated guide for online fitness instructors alongside Attendance Tracker (https://attendancetracker.dev)—our official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs client attendance in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you update that trainer guide:
- Google Meet Attendance for Fitness & Yoga Instructors: https://attendancetracker.dev/google-meet-attendance-for-fitness-and-yoga.html
- Live training & webinar attendance guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 19,
    name: 'ClickMinded',
    to: ['hello@clickminded.com'],
    cc: ['support@clickminded.com'],
    subject: 'Google Meet REST API v2 attendance automation for ClickMinded’s marketing workflow guide',
    text: `Hi Tommy and the ClickMinded Team,

While reading your guide on marketing automation and Claude workflows (https://www.clickminded.com/claude-code-marketing/) where you link to tactiq.io/learn/claude-project-examples, I wanted to share a zero-bot Google Meet add-on built for live cohort trainings, webinars, and client calls.

Because Google Meet's native attendance report requires specific Enterprise tiers and won't trigger on calls under 5 participants, marketers and course creators often lose verified attendance data unless they invite third-party recording bots. I built Attendance Tracker (https://attendancetracker.dev), an official Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact participant durations in the Meet side panel and exports to Google Sheets or webhooks in one click.

Helpful resources if you expand your Google Workspace automation stack:
- Webinars & live training cohorts guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 20,
    name: 'Near Future Laboratory',
    to: ['chester@nearfuturelaboratory.com'],
    cc: ['hello@nearfuturelaboratory.com'],
    subject: 'Note on Office Hours Side Projects N°265 (Google Meet REST API v2 side project)',
    text: `Hi Julian and Chester,

I really enjoyed reading your dispatch "Office Hours Side Projects N°265" (https://nearfuturelaboratory.com/blog/2025/06/office-hours-side-projects-n265/), where you reference tactiq.io/r/transcribing for capturing live studio and office-hours sessions.

In the spirit of practical side projects that solve annoying everyday friction: Google Meet's built-in attendance tracker is locked behind Enterprise Workspace tiers and refuses to run on sessions with fewer than 5 people. So I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on built on the native Google Meet REST API v2 that lives quietly inside the Meet side panel, merges reconnects, and exports attendance logs to Google Sheets in one click.

Links if you ever want to check it out for Office Hours:
- Remote teams & studio sessions: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- How it works in Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 21,
    name: 'Remote Tools',
    to: ['hrishikesh@remote.tools'],
    cc: ['hello@remote.tools'],
    subject: 'Adding Attendance Tracker (Google Meet REST API v2) to Remote Tools',
    text: `Hi Hrishikesh and the Remote Tools Team,

While browsing your remote productivity and meeting tools directory where you feature tactiq.io (https://www.remote.tools/notepadpw/alternatives), I wanted to share Attendance Tracker (https://attendancetracker.dev) for Remote Tools.

Unlike legacy Chrome extensions that scrape the DOM and break when Google updates Meet's interface—or Google's built-in attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker is an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2. Remote teams use it directly inside the Google Meet side panel to log join/leave timestamps on any call size and export to Google Sheets in one click.

Helpful links for your directory:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 22,
    name: 'TechBase Directory',
    to: ['hello@techbasedirectory.com'],
    cc: ['support@techbasedirectory.com'],
    subject: 'Listing Attendance Tracker (Native Google Meet REST API v2 Add-on) on TechBase Directory',
    text: `Hi TechBase Directory Editorial Team,

While reviewing your product listing for Tactiq (https://techbasedirectory.com/product/tactiq-ai-workflows), I wanted to submit Attendance Tracker (https://attendancetracker.dev) as a complementary Google Meet tool for TechBase Directory.

Whereas Tactiq uses a browser extension for transcription, Attendance Tracker is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It runs directly inside the Google Meet side panel without external bots, logs exact participant join/leave durations on any meeting size (bypassing Google's 5-participant minimum), and exports attendance to Google Sheets or PDF certificates in one click.

Key links for your directory team:
- Extensions vs. official REST API v2 add-on: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 23,
    name: 'Awesome Agents AI',
    to: ['hello@awesomeagents.ai'],
    cc: ['info@awesomeagents.ai'],
    subject: 'Zero-bot Google Meet REST API v2 companion for your 2026 meeting assistants guide',
    text: `Hi Awesome Agents Editorial Team,

While reading your roundup "Best AI Meeting Assistants in 2026" (https://awesomeagents.ai/tools/best-ai-meeting-assistants-2026/) where you feature tactiq.io for Google Meet, I wanted to share a zero-bot Google Meet companion focused specifically on verified attendance and duration tracking.

Because legacy Chrome extensions rely on fragile DOM scraping and Google Meet's native attendance report won't trigger on calls with fewer than 5 people or non-Enterprise plans, I built Attendance Tracker (https://attendancetracker.dev). It's an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2 that opens in the Meet side panel, merges reconnects, and exports to Google Sheets in one click.

Helpful links if you expand your Google Meet tooling coverage:
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
    name: 'AI Acquisition',
    to: ['support@aiacquisition.com'],
    cc: ['info@aiacquisition.com'],
    subject: 'Google Meet REST API v2 attendance automation for your B2B sales blog',
    text: `Hi AI Acquisition Editorial Team,

I enjoyed reading your article "Will Sales Be Replaced by AI?" (https://www.aiacquisition.com/blog/will-sales-be-replaced-by-ai), where you link to tactiq.io/ai-tools/ai-meeting-summary on automating post-call sales workflows.

Another piece of manual admin B2B sales and onboarding teams deal with on Google Meet is logging which stakeholders attended discovery calls and live training sessions—since Google's native attendance report requires Enterprise seats and skips calls under 5 people. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs participant durations in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you update that sales automation section:
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Webinars & live sales training guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 25,
    name: 'ZeroDevice',
    to: ['theboss@zerodevice.net'],
    cc: ['contact@zerodevice.net'],
    subject: 'Official Google Meet REST API v2 add-on for ZeroDevice’s creator tools list',
    text: `Hi ZeroDevice Editorial Team,

While reading your roundup "13 Cool Apps and Tools Every Content Creator Should Know" (https://zerodevice.net/13-cool-apps-and-tools-every-content-creator-should-know/) where you feature tactiq.io for Google Meet, I wanted to share a zero-bot Google Meet add-on built for creators running live workshops, coaching cohorts, and community calls.

Because Google Meet's native attendance report requires Enterprise Workspace plans and never triggers on calls under 5 participants, creators hosting small group sessions often lose their attendance logs. I built Attendance Tracker (https://attendancetracker.dev)—an official Google Workspace Marketplace add-on on the native Google Meet REST API v2 that tracks participant join/leave durations in the Meet side panel, exports to Google Sheets, and generates 1-click PDF completion certificates.

Helpful links if you update that roundup:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Webinars & creator workshops guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 26,
    name: 'Interview Sidekick',
    to: ['ben@interviewsidekick.com'],
    cc: ['support@interviewsidekick.com'],
    subject: 'Non-competing Google Meet interview attendance guide for Interview Sidekick’s blog',
    text: `Hi Ben and the Interview Sidekick Team,

While reading your comparison guide "Cluely Alternatives 2026: 6 Tools Tested" (https://interviewsidekick.com/alternatives/cluely-alternatives) where you cover tactiq.io for Google Meet sessions, I wanted to share a 100% non-competing resource focused on Google Meet interview panel attendance.

Because technical interviews and hiring panels on Google Meet usually have 2 to 4 people, Google's native attendance report (which requires 5+ participants and Enterprise tiers) never triggers. We published a dedicated guide on tracking interview attendance without intrusive bots alongside Attendance Tracker (https://attendancetracker.dev), our official Google Workspace Marketplace add-on built on the native Google Meet REST API v2.

Helpful links if you ever reference Google Meet interview logistics:
- Google Meet Attendance for Job Interviews: https://attendancetracker.dev/google-meet-attendance-for-job-interviews.html
- How to track attendance in Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 27,
    name: 'Miralab Japan',
    to: ['info@miralab.co.jp'],
    cc: ['support@miralab.co.jp'],
    subject: 'Miralab様のTactiq解説記事へ：日本語対応・Google Meet公式出席管理アドオンのご紹介',
    text: `Miralab（ミララボ）編集部 ご担当者様

いつも有益なAI・業務効率化ツールの解説記事を拝見しております。貴メディアのTactiq解説記事（https://miralab.co.jp/media/tactiq/）を拝読し、Google Meetユーザー向けの公式出席管理アドオン「Attendance Tracker」をご紹介したくご連絡いたしました。

Google Meet標準の出席レポートは上位のWorkspaceプランかつ5名以上の会議でしか作動せず、従来のChrome拡張機能はDOMスクレイピングのためUI更新のたびに不具合が生じやすい課題がありました。そこで私が開発した「Attendance Tracker」（https://attendancetracker.dev）は、Google MeetネイティブREST API v2を採用したGoogle Workspace Marketplace公式アドオンです（日本語UIに完全対応）。外部ボット不要でMeetのサイドパネル内で動作し、ワンクリックでGoogleスプレッドシート出力やPDF受講証明書の発行が可能です。

記事のアップデート等の際にご参考になれば幸いです：
- Google Meet出席管理拡張機能と公式アドオンの比較：https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Google Meetでの出席確認ガイド：https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- 公式アドオン：https://attendancetracker.dev

何卒よろしくお願いいたします。

Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 28,
    name: 'Empathy First Media',
    to: ['info@empathyfirstmedia.com'],
    cc: ['hello@empathyfirstmedia.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for Empathy First Media’s workflow guide',
    text: `Hi Daniel and the Empathy First Media Team,

While reading your breakdown "OpenAI o1-mini vs GPT-4o" (https://empathyfirstmedia.com/openai-o1-mini-vs-gpt-4o/) where you reference tactiq.io for real-time meeting workflows, I wanted to share a zero-bot Google Meet companion built for digital agencies and remote teams.

When agencies host client discovery or reporting calls on Google Meet, Google's built-in attendance report requires Enterprise Workspace seats and won't trigger on calls with fewer than 5 people. I built Attendance Tracker (https://attendancetracker.dev)—an official Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that logs exact participant durations inside the Meet side panel and exports to Google Sheets in one click.

Helpful resources if you expand your Google Workspace tooling coverage:
- Remote & agency teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 29,
    name: 'PG Concept France',
    to: ['contact@pgconcept.com'],
    cc: ['info@pgconcept.com'],
    subject: 'Module officiel Google Meet (API REST v2) pour votre guide des outils 2025',
    text: `Bonjour l'équipe PG Concept,

En lisant votre sélection « Les meilleurs outils IA pour 2025 » (https://pgconcept.com/meilleurs-outils-ia-2025/) où vous mentionnez tactiq.io pour les réunions en ligne, je souhaitais vous présenter un outil complémentaire en français pour les utilisateurs de Google Meet.

Contrairement aux extensions Chrome classiques qui reposent sur le scraping du DOM — ou au rapport natif de Google Meet qui exige une licence Enterprise et un minimum de 5 participants — Attendance Tracker (https://attendancetracker.dev) est un module complémentaire officiel sur le Google Workspace Marketplace basé sur l'API REST v2 native de Google Meet. Entièrement traduit en français, il fonctionne directement dans le panneau latéral de Meet sans bot externe et exporte les feuilles de présence vers Google Sheets en un clic.

Quelques liens utiles si vous enrichissez votre guide :
- Équipes à distance : https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Comparatif des extensions et modules Google Meet : https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Module officiel : https://attendancetracker.dev

Bien cordialement,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 30,
    name: 'Traction Co.',
    to: ['info@tractionco.com'],
    cc: ['jobs@tractionco.com'],
    subject: 'Zero-bot Google Meet attendance add-on for Traction’s agency workflow insights',
    text: `Hi Adam and the Traction Team,

I enjoyed reading your insights piece "Data with Heart, Tech with Humanity" (https://www.tractionco.com/insights/data-with-heart-tech-with-humanity), where you reference tactiq.io on keeping human connection at the center of virtual meetings.

Along that exact theme, one thing that makes client calls and small-group workshops feel less human is when third-party recording bots join the call—yet Google Meet's native attendance report won't trigger on calls under 5 people or standard Workspace plans. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that quietly logs attendance durations in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you ever update that piece:
- Remote & agency teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  }
];

function getLogFilePath() {
  const envPath = process.env.WAVE15_LOG_FILE ? process.env.WAVE15_LOG_FILE.trim() : '';
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
Wave 15 Outreach Dispatcher (30 Verified Backlink Outreach Targets)
Usage:
  node scripts/send-wave15-outreach.cjs --dry-run
  node scripts/send-wave15-outreach.cjs --dry-run --target=1
  node scripts/send-wave15-outreach.cjs --test
  node scripts/send-wave15-outreach.cjs --test --target=1
  node scripts/send-wave15-outreach.cjs --send --target=1
  node scripts/send-wave15-outreach.cjs --send --all
  node scripts/send-wave15-outreach.cjs --send --target=1 --force
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
