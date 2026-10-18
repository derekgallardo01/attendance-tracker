#!/usr/bin/env node
/**
 * scripts/send-wave14-outreach.cjs
 *
 * Dedicated dispatcher for Wave 14 Backlink Outreach (30 Verified Targets):
 * - Carried-over Verified Reserve Targets from Wave 13 (Targets 1–15, DR 40–76)
 * - High-DR Editorial Publications, SaaS Blogs, Tech News & Agency Guides (Targets 16–30, DR 50–81)
 *
 * Sends personalized, anti-AI founder emails from Derek Gallardo <derek@attendancetracker.dev>
 * via the Resend API with reply-to derek@attendancetracker.dev.
 *
 * Safety & Execution features:
 * 1. Deduplication log in `docs/wave14-dispatch-log.json` (overridable via `WAVE14_LOG_FILE`) to prevent duplicate sends.
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
const LOG_FILE = path.resolve(__dirname, '../docs/wave14-dispatch-log.json');

const TARGETS = [
  {
    id: 1,
    name: 'Formbricks',
    to: ['hola@formbricks.com'],
    cc: ['support@formbricks.com'],
    subject: 'Google Meet REST API v2 attendance note for your churn reduction guide',
    text: `Hi Formbricks Team,

While reading your guide "How to Reduce Churn Rate: Proven Strategies & Examples" (https://formbricks.com/blog/reduce-churn-rate), I noticed you cite scribbl.co/post/meeting-facilitation-techniques on elevating client engagements.

In B2B SaaS, one of the strongest early churn signals is declining stakeholder attendance on onboarding calls and QBRs—yet Google Meet's built-in attendance reports require Enterprise plans and never trigger on calls under 5 participants. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that logs participant join/leave durations in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you ever expand that customer engagement section:
- Remote & customer success teams: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting attendance to Google Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 2,
    name: 'LiveWebinar',
    to: ['support@livewebinar.com'],
    cc: ['hello@livewebinar.com'],
    subject: 'Zero-bot Google Meet attendance add-on for your online meeting fails article',
    text: `Hi LiveWebinar Editorial Team,

I enjoyed reading your post "5 Online Meeting Fails and How to Avoid Them" (https://www.livewebinar.com/blog/webinar-marketing/5-online-meeting-fails-and-how-to-avoid-them), where you link to scribbl.co on managing online meeting records.

Another frequent headache for teams running training sessions or workshops in Google Meet is losing the attendance roster—since Google's native report requires Enterprise/Business Plus seats and refuses to fire on sessions under 5 people. I built Attendance Tracker (https://attendancetracker.dev), an official Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact attendee durations without bots and generates 1-click PDF completion certificates.

Useful resources if you update that article:
- Webinars & training attendance guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 3,
    name: 'Penji',
    to: ['support@penji.co'],
    cc: ['info@penji.co'],
    subject: 'Google Meet REST API v2 attendance companion for your Otter.ai review',
    text: `Hi Penji Editorial Team,

While reading your breakdown "Otter.AI Review: Is It Worth It?" (https://penji.co/otter-ai-review/) where you also reference scribbl.co/pricing for Google Meet users, I wanted to share a zero-bot Google Meet attendance companion built for creative agencies and remote teams.

Unlike bot-based note takers or legacy Chrome extensions that scrape the DOM, Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It runs directly inside the Meet side panel on any meeting size (even 1-on-1 client design reviews where Google's native report won't trigger) and exports timestamped logs to Google Sheets in one click.

Helpful resources if you update that review:
- Remote & creative teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 4,
    name: 'SendFame',
    to: ['support@sendfame.com'],
    cc: ['hello@sendfame.com'],
    subject: 'Google Meet attendance add-on for your marketing agency tools section',
    text: `Hi SendFame Editorial Team,

I just read your guide "How to Make AI Videos: Complete Beginner-to-Pro Guide" (https://sendfame.com/blog/how-to-make-ai-videos), where you link to scribbl.co/post/ai-tools-for-marketing-agencies on top tools for marketing agencies.

For agencies running daily standups and client review calls on Google Meet, Google's native attendance report is locked behind Business Plus/Enterprise tiers and won't trigger on calls under 5 participants. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that logs exact call durations in the Meet side panel and exports to Google Sheets in one click.

Useful links if you expand your agency workflow recommendations:
- Remote & agency teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 5,
    name: 'FitGap',
    to: ['info@fitgap.com'],
    cc: ['support@fitgap.com'],
    subject: 'Adding Attendance Tracker (Google Meet REST API v2) to FitGap’s software matrix',
    text: `Hi FitGap Editorial Team,

While reviewing your Google Meet software comparison page featuring Tactiq (https://us.fitgap.com/software/tactiq), I wanted to share Attendance Tracker (https://attendancetracker.dev) for inclusion in FitGap's B2B productivity and meeting software directory.

Whereas Tactiq focuses on transcription via a Chrome extension, Attendance Tracker is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It runs directly inside the Google Meet side panel without external bots, tracks exact join/leave timestamps on any meeting size (bypassing Google's 5-participant minimum), and exports attendance to Google Sheets or PDF certificates in one click.

Key resources for your software directory:
- Extensions vs. native REST API v2 add-on: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Happy to provide any product specs or screenshots for your team.

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 6,
    name: 'Les Outils TICE — Fidel Navamuel',
    to: ['contact@outilstice.com'],
    cc: ['fiducial@outilstice.com'],
    subject: 'Outil d’appel Google Meet (API REST v2) pour Les Outils TICE',
    text: `Bonjour Fidel,

En lisant votre article « Tactiq : transcrire vos réunions en ligne » sur Les Outils TICE (https://outilstice.com/2024/03/tactiq-transcrire-reunions-en-ligne/), j'ai pensé vous présenter un outil complémentaire pensé pour les enseignants et formateurs qui utilisent Google Meet.

Comme le rapport de présence natif de Google Meet exige une licence payante Education Plus et au moins 5 participants, j'ai développé Attendance Tracker (https://attendancetracker.dev). C'est un module complémentaire officiel sur le Google Workspace Marketplace, basé sur l'API REST v2 native de Google Meet et entièrement traduit en français. Il fonctionne directement dans le panneau latéral de Meet sans bot externe, fusionne les reconnexions et exporte la feuille de présence vers Google Sheets ou en certificats PDF en un clic.

Quelques liens utiles pour vos lecteurs enseignants :
- Guide pour les enseignants : https://attendancetracker.dev/attendance-tracker-for-teachers.html
- Tutoriel complet : https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Module officiel : https://attendancetracker.dev

Je serais ravi d'activer un accès Pro gratuit à vie pour vos tests.

Bien cordialement,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 7,
    name: 'Zanfia',
    to: ['hello@zanfia.com'],
    cc: ['support@zanfia.com'],
    subject: 'Google Meet cohort & training attendance add-on for Zanfia’s blog',
    text: `Hi Zanfia Editorial Team,

While reading your guide on high-ticket sales training and live coaching cohorts (https://zanfia.com/blog/high-ticket-sales-training/), I saw your link to scribbl.co/post/how-to-handle-sales-objections.

Many course creators and cohort hosts running live sessions on Google Meet hit a frustrating limitation: Google's built-in attendance report requires Enterprise/Business Plus tiers and never fires on small group coaching calls under 5 participants. I built Attendance Tracker (https://attendancetracker.dev), an official Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact student durations without bots, exports to Google Sheets, and issues 1-click PDF completion certificates.

Helpful links if you expand that training guide:
- Webinars & live training cohorts guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Exporting attendance to Google Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 8,
    name: 'Eden',
    to: ['hello@eden.so'],
    cc: ['support@eden.so'],
    subject: 'Non-competing Google Meet REST API v2 attendance layer for your note takers guide',
    text: `Hi Eden Editorial Team,

I enjoyed reading your roundup "Best AI Note Takers" (https://eden.so/blog/best-ai-note-takers), where you feature both tactiq.io and scribbl.co for Google Meet users.

Because note takers focus on transcripts rather than verified attendance logs—and Google Meet's native attendance report won't trigger on calls with fewer than 5 people or standard Workspace plans—I built Attendance Tracker (https://attendancetracker.dev). It's a 100% non-competing, zero-bot Google Workspace Marketplace add-on built on the native Google Meet REST API v2 that tracks exact join/leave durations inside the Meet side panel and exports to Google Sheets in one click.

Useful resources if you ever add a companion Google Meet section to that guide:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 9,
    name: 'Wudpecker',
    to: ['hello@wudpecker.io'],
    cc: ['support@wudpecker.io'],
    subject: 'Non-competing Google Meet link idea for Wudpecker’s meeting assistants blog',
    text: `Hi Wudpecker Team,

While reading your post "Best AI Meeting Assistants" (https://www.wudpecker.io/blog/best-ai-meeting-assistants), I noticed you link out to rival note-taker tactiq.io for Google Meet users.

If you ever want to cite a 100% non-competing Google Meet tool instead of a direct transcription competitor, I built Attendance Tracker (https://attendancetracker.dev). We don't do transcription or AI notes at all—we're an official Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that tracks participant join/leave durations inside the Meet side panel and exports to Google Sheets in one click.

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
    id: 10,
    name: 'AI Fire',
    to: ['hello@aifire.co'],
    cc: ['support@aifire.co'],
    subject: 'Native Google Meet REST API v2 add-on for AI Fire’s Chrome productivity roundup',
    text: `Hi AI Fire Editorial Team,

While reading your article "10 AI Chrome Extensions That Will Save You Hours of Work" (https://www.aifire.co/p/10-ai-chrome-extensions-that-will-save-you-hours-of-work) featuring tactiq.io for Google Meet, I wanted to share a zero-bot Google Meet add-on that saves hosts from manual attendance tracking.

Unlike traditional Chrome extensions that scrape the DOM and break whenever Google updates Meet's UI—or Google's native report that requires Enterprise tiers and 5+ participants—Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It runs inside the Meet side panel, merges reconnects, and exports attendance to Google Sheets in one click.

Helpful links if you update that roundup:
- Extensions vs. official REST API v2 add-on: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 11,
    name: 'MyCulture AI',
    to: ['hello@myculture.ai'],
    cc: ['support@myculture.ai'],
    subject: 'Google Meet REST API v2 attendance note for your performance management guide',
    text: `Hi MyCulture Editorial Team,

I enjoyed reading your guide "Performance Management Best Practices" (https://www.myculture.ai/blog/performance-management-best-practices), where you cite scribbl.co/post/how-to-improve-team-collaboration on improving remote team collaboration.

For people ops and engineering leads running 1-on-1 check-ins and team rituals on Google Meet, Google's built-in attendance report requires Enterprise plans and won't trigger at all on meetings under 5 people. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact meeting participation in the Meet side panel and exports to Google Sheets in one click.

Helpful resources if you expand that remote team section:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- How to track attendance in Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 12,
    name: 'Bricx Labs',
    to: ['hello@bricxlabs.com'],
    cc: ['info@bricxlabs.com'],
    subject: 'Zero-bot Google Meet attendance add-on for Bricx Labs’ UX research guide',
    text: `Hi Bricx Labs Team,

While reading your article "Market Research vs UX Research" (https://bricxlabs.com/blogs/market-research-vs-ux-research) where you cite scribbl.co/post/what-is-customer-sentiment-analysis, I wanted to share a zero-bot Google Meet add-on built for SaaS UX research sessions and client design reviews.

Because UX interviews and usability tests on Google Meet typically have 2 to 4 participants, Google's native attendance report (which requires 5+ attendees and Enterprise seats) never triggers—and external recording bots can make participants self-conscious. Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on on the native Google Meet REST API v2 that quietly logs exact session durations in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you update that article:
- Remote & SaaS design teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 13,
    name: 'Clepher',
    to: ['support@clepher.com'],
    cc: ['hello@clepher.com'],
    subject: 'Google Meet attendance automation for your Client Account Management playbook',
    text: `Hi Clepher Editorial Team,

I just read your guide "Client Account Management: A Practical Playbook" (https://clepher.com/client-account-management/), where you cite scribbl.co/post/account-management-best-practices on running structured client reviews.

When account managers host client check-ins or onboarding calls on Google Meet, Google's built-in attendance report requires Enterprise/Business Plus seats and skips any call with fewer than 5 people. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that logs exact participant durations inside the Meet side panel and exports to Google Sheets in one click.

Useful links if you expand that playbook:
- Remote & client account teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 14,
    name: 'Stagetimer',
    to: ['hello@stagetimer.io'],
    cc: ['support@stagetimer.io'],
    subject: 'Complementary Google Meet REST API v2 tool for Stagetimer’s meeting timer guide',
    text: `Hi Lukas and the Stagetimer Team,

I enjoyed reading your post "Free Online Timer for Meetings" (https://stagetimer.io/blog/free-online-timer-for-meetings/), where you recommend scribbl.co alongside Stagetimer for keeping virtual meetings and live events on track.

Since Stagetimer and our tool serve the exact same webinar producers and virtual event hosts without competing at all, I wanted to share Attendance Tracker (https://attendancetracker.dev). It's an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2 that tracks participant join/leave durations inside the Meet side panel (even on calls under 5 people where Google's native report won't fire), exports to Google Sheets, and issues 1-click PDF attendance certificates.

Helpful links if you ever update that post:
- Webinars & live events attendance guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 15,
    name: 'GAT Labs',
    to: ['support@gatlabs.com'],
    cc: ['info@gatlabs.com'],
    subject: 'Google Meet attendance report note (10090454) for GAT Labs’ Workspace Admin guide',
    text: `Hi GAT Labs Editorial Team,

While reading your "Admin's Guide to Google Workspace Security" (https://gatlabs.com/blogpost/admins-guide-to-google-workspace-security/), I noticed you link directly to Google's help page support.google.com/meet/answer/10090454 on "usage reports".

As Workspace specialists, you likely see admins and hosts run into the two big catches on that Google doc: native Meet attendance reports require eligible Enterprise/Education Plus editions and never generate on meetings with fewer than 5 participants. For organizations needing host-level attendance logs on any Workspace tier or meeting size without third-party bots, I built Attendance Tracker (https://attendancetracker.dev) on the official Google Meet REST API v2.

Helpful resources if you ever add a note alongside that link:
- How to track attendance in Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Why native Meet attendance reports don't show up: https://attendancetracker.dev/google-meet-attendance-report-not-showing-up.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 16,
    name: 'Xataka Spain',
    to: ['contacto@xataka.com'],
    cc: ['editores@xataka.com'],
    subject: 'Complemento nativo de Google Meet (API REST v2) para vuestro artículo en Xataka Pro',
    text: `Hola equipo editorial de Xataka,

Leyendo vuestro artículo en Xataka Pro «Cómo tomar notas en las reuniones: 9 herramientas y buenas prácticas» (https://www.xataka.com/pro/como-tomar-notas-reuniones-9-herramientas-buenas-practicas), donde destacáis a tactiq.io para Google Meet, quería presentaros una herramienta complementaria en español para el control de asistencia.

Como los informes nativos de Google Meet exigen cuentas Enterprise y un mínimo de 5 participantes, desarrollé Attendance Tracker (https://attendancetracker.dev): el add-on oficial en Google Workspace Marketplace construido sobre la API REST v2 nativa de Google Meet. Funciona directamente en el panel lateral de Meet sin bots externos, unifica reconexiones y exporta la asistencia a Google Sheets o certificados PDF en un clic.

Enlaces útiles por si actualizáis la guía:
- Guía en español: https://attendancetracker.dev/asistencia-google-meet.html
- Equipos remotos: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Add-on oficial: https://attendancetracker.dev

Un saludo cordial,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 17,
    name: 'TechBullion',
    to: ['editor@techbullion.com'],
    cc: ['info@techbullion.com'],
    subject: 'Native Google Meet REST API v2 add-on for TechBullion’s productivity tools feature',
    text: `Hi TechBullion Editorial Team,

While reading your feature "Top Tools to Simplify, Scale, and Succeed" (https://techbullion.com/top-tools-to-simplify-scale-and-succeed-in-2025/) where you highlight tactiq.io for virtual meetings, I wanted to share an official zero-bot Google Meet add-on for remote teams.

Unlike legacy browser extensions that scrape the DOM and break when Google updates Meet's interface—or Google's built-in attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on running on the native Google Meet REST API v2. It opens inside the Meet side panel, merges reconnects, and exports timestamped attendance to Google Sheets in one click.

Helpful resources if you expand that productivity roundup:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 18,
    name: 'Apollo Technical',
    to: ['info@apollotechnical.com'],
    cc: ['contact@apollotechnical.com'],
    subject: 'Google Meet attendance add-on for Apollo Technical’s workplace organization guide',
    text: `Hi Apollo Technical Editorial Team,

I enjoyed reading your article "9 Best Ways To Stay Organized At Work" (https://www.apollotechnical.com/9-best-ways-to-stay-organized-at-work/), where you link to tactiq.io/ai-tools/ai-note-taker on meeting transcription tools.

For engineering managers and technical recruiters running standups or panel interviews on Google Meet, Google's native attendance report requires Enterprise plans and won't trigger on calls under 5 participants—and external recording bots often make candidates uncomfortable. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact attendance in the Meet side panel and exports to Google Sheets in one click.

Useful links if you update that article:
- Remote engineering teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Technical interviews & recruiting guide: https://attendancetracker.dev/google-meet-attendance-for-job-interviews.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 19,
    name: 'Insight Partners',
    to: ['contact@insightpartners.com'],
    cc: ['datainquiries@insightpartners.com'],
    subject: 'Google Meet REST API v2 attendance automation for your GTM productivity piece',
    text: `Hi Insight Partners Editorial Team,

While reading your analysis on GTM productivity and workflow tooling (https://www.insightpartners.com/ideas/gtm-generative-ai/) where you mention tactiq.io, I wanted to share a zero-bot Google Meet attendance add-on built for B2B GTM teams running customer webinars, onboarding cohorts, and multi-stakeholder demos.

Because Google Meet's native attendance reports require specific Enterprise tiers and skip calls under 5 participants, GTM teams often lose verified attendance data unless they invite intrusive recording bots. Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2 that logs exact participant durations in the Meet side panel and syncs to Google Sheets or CRM webhooks in one click.

Helpful links for your GTM tooling coverage:
- Webinars & customer training guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 20,
    name: 'Outreach Monks',
    to: ['orders@outreachmonks.com'],
    cc: ['info@outreachmonks.com'],
    subject: 'Zero-bot Google Meet attendance add-on for Outreach Monks’ agency tools guide',
    text: `Hi Outreach Monks Editorial Team,

While reading your breakdown of workflow and content tools (https://outreachmonks.com/ai-content-generation-tools/) where you link to tactiq.io/ai-tools/ai-note-taker for meeting capture, I wanted to share a complementary Google Meet add-on built for agencies and remote teams.

When agencies run client reporting calls or internal standups on Google Meet, Google's built-in attendance report won't fire on calls under 5 participants and requires Enterprise Workspace seats. I built Attendance Tracker (https://attendancetracker.dev)—an official Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that logs exact join/leave timestamps inside the Meet side panel without bots and exports to Google Sheets in one click.

Helpful resources if you update that article:
- Remote & agency teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 21,
    name: 'Submagic',
    to: ['david@submagic.co'],
    cc: ['support@submagic.co'],
    subject: 'Google Meet REST API v2 companion for Submagic’s meeting & video tools guide',
    text: `Hi David and the Submagic Team,

While reading your comparison guide (https://www.submagic.co/alternatives/descript) where you highlight tactiq.io for capturing Google Meet sessions, I wanted to share a 100% non-competing Google Meet companion for remote teams and webinar hosts.

Unlike legacy Chrome extensions that scrape the browser DOM—or Google's built-in attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It runs directly inside the Meet side panel without external bots, merges reconnects, and exports attendance to Google Sheets in one click.

Useful links if you ever expand your Google Meet tooling recommendations:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 22,
    name: 'Aquent',
    to: ['questions@aquent.com'],
    cc: ['info@aquent.com'],
    subject: 'Zero-bot Google Meet attendance add-on for Aquent’s workplace assistants article',
    text: `Hi Aquent Editorial Team,

I enjoyed reading your article "New Potential for AI-Powered Assistants in the Workplace" (https://aquent.com/blog/new-potential-for-ai-powered-assistants-in-the-workplace), where you reference tactiq.io for virtual meetings.

For creative staffing teams, hiring managers, and remote departments running interviews or standups on Google Meet, external recording bots can feel intrusive—and Google's native attendance report won't trigger on calls with fewer than 5 people. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact participant timestamps in the Meet side panel and exports to Google Sheets in one click.

Helpful resources if you expand that workplace guide:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Job interviews & panel tracking guide: https://attendancetracker.dev/google-meet-attendance-for-job-interviews.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 23,
    name: 'ValiantCEO',
    to: ['editor@valiantceo.com'],
    cc: ['info@valiantceo.com'],
    subject: 'Google Meet REST API v2 attendance add-on for ValiantCEO’s academic & meeting tools guide',
    text: `Hi ValiantCEO Editorial Team,

While reading your article "Handy Applications That Assist in Essay Writing" (https://valiantceo.com/handy-applications-that-assist-in-essay-writing/), I noticed you link to scribbl.co on "note taker for meetings with AI".

For university faculty, study cohorts, and executive teams meeting on Google Meet, Google's built-in attendance report is locked behind Education Plus/Enterprise licenses and refuses to run on sessions under 5 participants. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that tracks join/leave times inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you update that article:
- University & higher-ed attendance guide: https://attendancetracker.dev/google-meet-attendance-for-universities.html
- How to track attendance in Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 24,
    name: 'PDF.ai',
    to: ['support@pdf.ai'],
    cc: ['hello@pdf.ai'],
    subject: 'Dedicated Google Meet legal deposition attendance guide for PDF.ai’s resource page',
    text: `Hi Damon and the PDF.ai Team,

While reading your resource guide "Deposition Preparation Tips" (https://pdf.ai/resources/deposition-preparation-tips), I noticed you currently cite a generic sales blog post (scribbl.co/post/how-to-handle-sales-objections) in that section.

Because remote legal depositions, witness prep sessions, and CLE trainings on Google Meet require an auditable record of who was present and when—and Google's native report never fires on proceedings under 5 people—we published a dedicated guide specifically for remote depositions alongside Attendance Tracker (https://attendancetracker.dev). Our official Google Workspace Marketplace add-on uses the native Google Meet REST API v2 (zero third-party recording bots) and exports timestamped logs and PDF certificates in one click.

If you'd like a legal-specific resource for that link:
- Google Meet Attendance for Legal Depositions: https://attendancetracker.dev/google-meet-attendance-for-legal-depositions.html
- CLE & CPE credit verification guide: https://attendancetracker.dev/google-meet-attendance-for-cpe-and-cle-credits.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 25,
    name: 'OneNine',
    to: ['hello@onenine.com'],
    cc: ['support@onenine.com'],
    subject: 'Google Meet attendance add-on for OneNine’s web development project timeline guide',
    text: `Hi OneNine Editorial Team,

I enjoyed reading your guide "Web Development Project Timeline: From Planning to Launch" (https://onenine.com/web-development-project-timeline/), where you cite scribbl.co/post/how-to-prevent-scope-creep on keeping stakeholder meetings aligned.

When web agencies run client kickoffs and sprint reviews on Google Meet, having a clear log of which client stakeholders attended each sign-off call helps prevent scope disputes—yet Google's built-in attendance report requires Enterprise seats and skips calls under 5 people. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact participant durations and exports to Google Sheets in one click.

Helpful links if you expand that project management guide:
- Remote & web agency teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 26,
    name: 'Resolution GmbH',
    to: ['info@resolution.de'],
    cc: ['privacy@resolution.de'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for Resolution’s team collaboration guide',
    text: `Hi Resolution Editorial Team,

While reading your guide "How to Use Confluence" (https://www.resolution.de/post/how-to-use-confluence/) where you link to scribbl.co/post/how-to-improve-team-collaboration on strategies for improving team collaboration, I wanted to share a zero-bot Google Meet add-on built for distributed engineering and product teams.

Because Google Meet's native attendance reports require Enterprise plans and never trigger on meetings under 5 participants, teams often have to log standup or workshop attendance manually. I built Attendance Tracker (https://attendancetracker.dev)—an official Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that tracks join/leave timestamps inside the Meet side panel and exports to Google Sheets in one click.

Helpful resources if you update that collaboration section:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 27,
    name: 'PPC Geeks UK',
    to: ['geeks@ppcgeeks.co.uk'],
    cc: ['hello@ppcgeeks.co.uk'],
    subject: 'Google Meet attendance & Sheets automation for PPC Geeks’ workflow section',
    text: `Hi PPC Geeks Team,

While reading your guide on Google Shopping and agency workflow automation (https://ppcgeeks.co.uk/ppc/advertising-on-google-shopping/), I noticed your link to scribbl.co/post/what-is-workflow-automation on implementing workflow automation.

For digital agencies running weekly client reporting calls and internal standups on Google Meet, Google's native attendance report requires Business Plus/Enterprise seats and won't trigger on calls with fewer than 5 people. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact call durations inside the Meet side panel and exports directly to Google Sheets in one click.

Useful links if you update your workflow automation references:
- Remote & agency teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 28,
    name: 'TimeTackle',
    to: ['support@timetackle.com'],
    cc: ['questions@timetackle.com'],
    subject: 'Complementary Google Meet REST API v2 duration tracker for TimeTackle’s blog',
    text: `Hi TimeTackle Editorial Team,

I enjoyed reading your guide "How to Manage Multiple Projects: 10 Proven Strategies" (https://www.timetackle.com/how-to-manage-multiple-projects/), where you cite scribbl.co/post/how-to-manage-multiple-projects.

Because TimeTackle helps teams analyze calendar time while Google Meet's native attendance report skips meetings under 5 people and requires Enterprise seats, I built a complementary real-time attendance layer: Attendance Tracker (https://attendancetracker.dev). It's an official Google Workspace Marketplace add-on on the native Google Meet REST API v2 that captures actual participant join/leave timestamps inside the Meet side panel (without bots) and exports to Google Sheets in one click.

Helpful resources if you expand that article:
- How to track attendance in Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 29,
    name: 'Postmake',
    to: ['hello@postmake.io'],
    cc: ['support@postmake.io'],
    subject: 'Listing Attendance Tracker (Google Meet REST API v2) on Postmake',
    text: `Hi Postmake Team,

While browsing your directory profile for Scribbl (https://postmake.io/tools/scribbl), I wanted to submit Attendance Tracker (https://attendancetracker.dev) for consideration in Postmake's curated tools directory.

Whereas Scribbl uses a bot for meeting transcription, Attendance Tracker is an official zero-bot Google Workspace Marketplace add-on built on the native Google Meet REST API v2. Project managers, educators, and remote leads use it inside the Google Meet side panel to automatically track join/leave timestamps on any meeting size, merge reconnects, and export attendance to Google Sheets or PDF certificates in one click.

Helpful links for your directory:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Remote teams & project managers guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Happy to share any icons, screenshots, or metadata you need!

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 30,
    name: 'Conzuri',
    to: ['support@conzuri.com'],
    cc: ['hello@conzuri.com'],
    subject: 'Google Meet facilitation & attendance tip for Conzuri’s workplace confidence guide',
    text: `Hi Conzuri Editorial Team,

While reading your article "How To Increase Confidence At Work" (https://www.conzuri.com/blogs/news/how-to-increase-confidence-at-work), I noticed your link to scribbl.co/post/meeting-facilitation-techniques on "meeting facilitation techniques".

One practical way hosts run smoother Google Meet sessions without fumbling with manual roll call is automating attendance—especially since Google's built-in attendance report requires Enterprise plans and won't trigger on meetings under 5 participants. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs attendance in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you ever update that meeting facilitation section:
- Remote teams meeting guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- How to track attendance in Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  }
];

function getLogFilePath() {
  const envPath = process.env.WAVE14_LOG_FILE ? process.env.WAVE14_LOG_FILE.trim() : '';
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
Wave 14 Outreach Dispatcher (30 Verified Backlink Outreach Targets)
Usage:
  node scripts/send-wave14-outreach.cjs --dry-run
  node scripts/send-wave14-outreach.cjs --dry-run --target=1
  node scripts/send-wave14-outreach.cjs --test
  node scripts/send-wave14-outreach.cjs --test --target=1
  node scripts/send-wave14-outreach.cjs --send --target=1
  node scripts/send-wave14-outreach.cjs --send --all
  node scripts/send-wave14-outreach.cjs --send --target=1 --force
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
