#!/usr/bin/env node
/**
 * scripts/send-wave16-outreach.cjs
 *
 * Dedicated dispatcher for Wave 16 Backlink Outreach (30 Verified Targets):
 * - Carried-over Verified Reserve Targets from Wave 15 (Targets 1–15, DR 38–45)
 * - High-Authority Global Publications, SaaS Blogs, AI Directories & Governance Guides (Targets 16–30, DR 37–51)
 *
 * Sends personalized, anti-AI founder emails from Derek Gallardo <derek@attendancetracker.dev>
 * via the Resend API with reply-to derek@attendancetracker.dev.
 *
 * Safety & Execution features:
 * 1. Deduplication log in `docs/wave16-dispatch-log.json` (overridable via `WAVE16_LOG_FILE`) to prevent duplicate sends.
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
const LOG_FILE = path.resolve(__dirname, '../docs/wave16-dispatch-log.json');

const TARGETS = [
  {
    id: 1,
    name: 'Make Math Moments — Kyle Pearce & Jon Orr',
    to: ['admin@makemathmoments.com'],
    cc: ['support@makemathmoments.com'],
    subject: 'Google Meet attendance & PD certificates for Make Math Moments Virtual Summit',
    text: `Hi Kyle, Jon, and the Make Math Moments Team,

While checking out your Make Math Moments Virtual Summit session page ("The Path Not Taken: Thin-Slicing in 6-12 Math" — https://learn.makemathmoments.com/courses/2025-make-math-moments-virtual-summit/modules/free-to-the-public-2/lessons/the-path-not-taken-thin-slicing-in-6-12-math-peter-liljedahl-and-kyle-webb/) where you link to tactiq.io/chrome, I wanted to share a zero-bot Google Meet add-on built for K-12 teachers and PD workshops.

Because Google Meet's native attendance report requires paid Education Plus licenses and won't trigger on small breakout or tutoring sessions under 5 participants, I built Attendance Tracker (https://attendancetracker.dev) on the native Google Meet REST API v2. It runs inside the Meet side panel, exports attendance to Google Sheets, and generates 1-click PDF PD completion certificates.

Helpful links for your educator community:
- Teacher attendance guide: https://attendancetracker.dev/attendance-tracker-for-teachers.html
- Live PD & webinar certificates guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Official add-on: https://attendancetracker.dev

Happy to set up free lifetime educator passes for your team!

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 2,
    name: 'Osher Digital Australia',
    to: ['info@osher.com.au'],
    cc: ['hello@osher.com.au'],
    subject: 'Google Meet REST API v2 webhook & Sheets automation for Osher Digital’s blog',
    text: `Hi Osher Digital Team,

I enjoyed reading your article "Unlocking Efficiency with Business Process Automation" (https://osher.com.au/blog/business-process-automation/), where you cite scribbl.co/post/how-to-use-ai-to-take-meeting-notes-guide on automating meeting workflows.

For organizations automating their Google Workspace stack, one common gap is that Google Meet's native attendance reports require Enterprise licenses and refuse to fire on client calls under 5 participants. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that logs exact participant durations inside the Meet side panel and pushes structured data to Google Sheets or automation webhooks in one click.

Helpful resources if you expand that automation guide:
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Remote teams workflow guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 3,
    name: 'Homebase CRE',
    to: ['info@homebasecre.com'],
    cc: ['support@homebasecre.com'],
    subject: 'Google Meet investor webinar & board attendance logs for Homebase CRE’s blog',
    text: `Hi Homebase CRE Team,

While reading your post "7 Client Communication Best Practices for Real Estate Success" (https://www.homebasecre.com/posts/client-communication-best-practices), I noticed your citation of scribbl.co/post/client-communication-best-practices.

When CRE sponsors and asset managers host investor webinars, partner updates, or 1-on-1 LP calls on Google Meet, Google's built-in attendance report requires Enterprise seats and never triggers on calls with fewer than 5 people. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact participant timestamps inside the Meet side panel and exports audit-ready records to Google Sheets in one click.

Helpful links if you update that post:
- Board meetings & quorum tracking guide: https://attendancetracker.dev/google-meet-quorum-and-board-meetings.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 4,
    name: 'Lathire',
    to: ['hello@lathire.com'],
    cc: ['info@lathire.com'],
    subject: 'Zero-bot Google Meet interview & remote team attendance add-on for LATAMHire',
    text: `Hi LATAMHire Editorial Team,

While reading your guide "A Guide to the Employee Selection Process" (https://lathire.com/employee-selection-process/), I saw your link to scribbl.co/post/how-to-use-ai-to-take-meeting-notes-guide on structuring candidate interviews.

Because remote candidate interviews and hiring panels on Google Meet typically have 2 to 4 people, Google's built-in attendance report (which requires 5+ participants and Enterprise tiers) never triggers—and external recording bots can make candidates uneasy. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs interview and remote standup attendance inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand that hiring guide:
- Job interviews & candidate screening guide: https://attendancetracker.dev/google-meet-attendance-for-job-interviews.html
- Distributed & remote teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 5,
    name: 'MIT Technology Review Arabia',
    to: ['info@mittrarabia.com'],
    cc: ['editor@mittrarabia.com'],
    subject: 'Note on Google’s 10090454 attendance doc in MIT Technology Review Arabia’s remote work feature',
    text: `Hi MIT Technology Review Arabia Editorial Team,

While reading your Arabic feature on managing remote teams and tracking productivity (https://mittrarabia.com/%D8%A5%D8%AF%D8%A7%D8%B1%D8%A9-%D8%A7%D9%84%D9%81%D8%B1%D9%82-%D8%A7%D9%84%D8%B9%D8%A7%D9%85%D9%84%D8%A9-%D8%B9%D9%86-%D8%A8%D8%B9%D8%AF/), I noticed you link directly to Google's official Meet attendance help page (support.google.com/meet/answer/10090454).

One limitation many organizations in the MENA region encounter with that Google help doc is that native Meet attendance reports require Enterprise/Business Plus licenses and never generate on meetings with fewer than 5 participants. To solve that, I built Attendance Tracker (https://attendancetracker.dev)—an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2 with full Arabic (RTL) and English localization that logs attendance without external bots and exports to Google Sheets in one click.

Helpful resources for your editorial team:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Why native Google Meet reports don't show up: https://attendancetracker.dev/google-meet-attendance-report-not-showing-up.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 6,
    name: 'EZTrackr — Harshdip Singh',
    to: ['harshdip@eztrackr.app'],
    cc: ['support@eztrackr.app'],
    subject: 'From a fellow founder: Google Meet link in your professional email writing guide',
    text: `Hi Harshdip,

Love what you've built with EZTrackr! While reading your post "7 Professional Email Writing Tips to Master in 2025" (https://www.eztrackr.app/blog/professional-email-writing-tips), I noticed your link to scribbl.co/post/how-to-write-a-follow-up-email.

Since EZTrackr helps job seekers and professionals stay on top of networking and interviews, I wanted to share a non-competing tool I built: Attendance Tracker (https://attendancetracker.dev). Because Google Meet's native attendance report skips 1-on-1 networking calls and interviews under 5 people, our official Google Workspace Marketplace add-on uses the native Google Meet REST API v2 (zero bots) to log exactly who attended and when right in the Meet side panel.

Helpful links if you ever update that post:
- Google Meet for job interviews & networking: https://attendancetracker.dev/google-meet-attendance-for-job-interviews.html
- See who attended a Google Meet call after it ended: https://attendancetracker.dev/see-who-attended-google-meet-after-it-ended.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 7,
    name: 'VentureFuel — Vanessa Ivette',
    to: ['vanessaivette@venturefuel.net'],
    cc: ['info@venturefuel.net'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for VentureFuel’s meeting startups POV',
    text: `Hi Vanessa and the VentureFuel Team,

I enjoyed reading your POV article "Innovative Notetaking AI Startups" (https://blog.venturefuel.net/pov/innovative-notetaking-ai-startups), where you highlight tactiq.io for capturing meeting insights.

For corporate innovation teams, accelerators, and venture studios hosting founder pitch days or partner briefings on Google Meet, external recording bots can make founders hesitant to share confidential metrics—and Google's native attendance report won't trigger on calls under 5 people. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact participant timestamps inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand your meeting workflow coverage:
- Remote & innovation teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Webinars & pitch events attendance guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 8,
    name: 'Viewber UK',
    to: ['info@viewber.co.uk'],
    cc: ['support@viewber.co.uk'],
    subject: 'Native Google Meet REST API v2 add-on for Viewber’s everyday productivity article',
    text: `Hi Viewber Editorial Team,

While reading your article "How Smart People Secretly Use AI to Win at Everyday Life" (https://viewber.co.uk/how-smart-people-secretly-use-ai-to-win-at-everyday-life) where you recommend tactiq.io for virtual meetings, I wanted to share a zero-bot Google Meet companion that saves hosts from manual admin.

Because Google Meet's built-in attendance report requires Enterprise Workspace tiers and refuses to fire on calls with fewer than 5 people, hosts running small client consultations or team check-ins often lose their attendance logs. I built Attendance Tracker (https://attendancetracker.dev)—an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2 that tracks join/leave times inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you update that article:
- How to track attendance in Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 9,
    name: 'Rachel Andrea Go',
    to: ['rachel@rachelandreago.com'],
    cc: ['hello@rachelandreago.com'],
    subject: 'Addition for your "200+ Content Creation Tools" guide (Google Meet REST API v2)',
    text: `Hi Rachel,

I just read your mega-guide "200+ Content creation tools to research, write, and share amazing blogs" (https://rachelandreago.com/content-creation-tools/), where you feature tactiq.io for capturing meeting discussions.

If you ever update that list, I'd love for you to consider Attendance Tracker (https://attendancetracker.dev) as a zero-bot Google Meet companion for content leads and remote teams. Unlike browser extensions that scrape the DOM—or Google's native attendance report that requires Enterprise plans and 5+ participants—our official Google Workspace Marketplace add-on runs on the native Google Meet REST API v2 inside the Meet side panel and exports attendance to Google Sheets in one click.

Useful links for your guide:
- Remote & content teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 10,
    name: 'CloudVara',
    to: ['contact@cloudvara.com'],
    cc: ['sutter@cloudvara.com'],
    subject: 'Google Meet attendance & Sheets automation for CloudVara’s team collaboration guide',
    text: `Hi CloudVara Editorial Team,

While reading your article "Cloud Based Document Management Done Right" (https://cloudvara.com/cloud-based-document-management/), I noticed your link to scribbl.co/post/how-to-improve-team-collaboration on improving remote team collaboration.

For accounting firms and remote businesses collaborating on Google Workspace, one frequent frustration is that Google Meet's native attendance report requires Enterprise seats and skips any call with fewer than 5 participants. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that logs exact participant durations in the Meet side panel and exports directly to Google Sheets in one click.

Helpful resources if you update that collaboration section:
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 11,
    name: 'Big Moves Marketing — Veb',
    to: ['veb@bigmoves.marketing'],
    cc: ['hello@bigmoves.marketing'],
    subject: 'Google Meet REST API v2 webinar & demo attendance for your AI B2B Marketing guide',
    text: `Hi Veb,

I enjoyed reading your article "AI B2B Marketing for Your Go-To-Market Evolution" (https://www.bigmoves.marketing/blog/ai-b2b-marketing), where you link to scribbl.co/post/how-to-use-ai-to-take-meeting-notes-guide on GTM meeting capture.

When B2B marketing and GTM teams host live roundtables, customer webinars, or multi-stakeholder demos on Google Meet, Google's built-in attendance report requires Enterprise licenses and won't trigger on calls under 5 people. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that tracks exact participant durations inside the Meet side panel and exports to Google Sheets or CRM webhooks in one click.

Helpful links if you expand that GTM tooling section:
- Webinars & B2B training attendance guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 12,
    name: 'Switas Consultancy',
    to: ['info@switas.com'],
    cc: ['hello@switas.com'],
    subject: 'Addition for Switas’ "100+ Underrated Tools" article (Native Google Meet REST API v2)',
    text: `Hi Switas Editorial Team,

While reading your roundup "100+ Underrated AI Tools You've Probably Never Heard Of" (https://www.switas.com/articles/100-underrated-ai-tools-you-ve-probably-never-heard-of) where you feature tactiq.io for Google Meet, I wanted to share an underrated Google Workspace add-on built for remote teams and educators.

Unlike Chrome extensions that rely on fragile DOM scraping—or Google's native attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on running on the native Google Meet REST API v2 (with full English, Turkish, Spanish, Japanese, and Italian UI localization). It opens inside the Meet side panel without bots and exports attendance to Google Sheets in one click.

Helpful links if you update your multi-language guide:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 13,
    name: 'Hunteed France',
    to: ['contact@hunteed.com'],
    cc: ['support@hunteed.com'],
    subject: 'Module officiel Google Meet (API REST v2) pour votre guide des outils recruteurs sur Hunteed',
    text: `Bonjour l'équipe Hunteed,

En lisant votre article « 10 outils incontournables pour les recruteurs indépendants - sourcing et qualification candidats » (https://www.hunteed.com/blog/10-outils-recruteurs-independants-sourcing-candidats) où vous présentez tactiq.io pour Google Meet, je voulais vous partager un outil complémentaire sans bot pensé pour les entretiens de recrutement.

Comme les entretiens de qualification sur Google Meet réunissent souvent 2 à 4 personnes, le rapport de présence natif de Google (qui exige 5 participants minimum et un forfait Enterprise) ne se déclenche jamais — et les bots externes peuvent intimider les candidats. J'ai créé Attendance Tracker (https://attendancetracker.dev), un module officiel sur le Google Workspace Marketplace basé sur l'API REST v2 native de Google Meet (en français) qui horodate les entretiens dans le panneau latéral et exporte vers Google Sheets en un clic.

Quelques liens utiles pour vos lecteurs recruteurs :
- Guide pour les entretiens de recrutement : https://attendancetracker.dev/google-meet-attendance-for-job-interviews.html
- Tutoriel complet : https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Module officiel : https://attendancetracker.dev

Bien cordialement,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 14,
    name: 'SFX Engine',
    to: ['support@sfxengine.com'],
    cc: ['hello@sfxengine.com'],
    subject: 'Non-competing Google Meet companion for SFX Engine’s podcast & remote recording blog',
    text: `Hi SFX Engine Team,

While reading your guide "Find the Best Podcast Editing Software" (https://sfxengine.com/blog/best-podcast-editing-software), I noticed your link to scribbl.co/post/meetgeek-vs-otter on comparing remote recording and transcription tools.

For production teams, creative agencies, and hosts running pre-interviews or live community sessions on Google Meet, Google's built-in attendance report requires Enterprise seats and won't trigger on calls under 5 people. I built Attendance Tracker (https://attendancetracker.dev)—a 100% non-competing, zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact participant durations inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand that workflow section:
- Remote & creative production teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 15,
    name: 'AI Gallery Japan',
    to: ['info@ai-gallery.jp'],
    cc: ['contact@ai-gallery.jp'],
    subject: 'AIツールギャラリー様のGoogle Meet比較記事へ：日本語対応・公式出席管理アドオンのご紹介',
    text: `AIツールギャラリー編集部 ご担当者様

貴メディアの特集記事「【2026年版】AI議事録ツールおすすめ比較｜Notion・Google Meet・Zoomも解説」（https://ai-gallery.jp/articles/ai-meeting-minutes-tools-comparison）にて、TactiqのGoogle Meet活用法（help.tactiq.io）を紹介されているのを拝読いたしました。

Google Meet標準の出席レポートは上位のWorkspaceプランかつ5名以上の会議でしか作動しないため、少人数の商談やオンライン研修での出席記録に課題を感じるチームが多くいらっしゃいます。そこで開発した「Attendance Tracker」（https://attendancetracker.dev）は、Google MeetネイティブREST API v2を採用したGoogle Workspace Marketplace公式アドオンです（日本語UIに完全対応）。外部ボット不要でMeetのサイドパネル内で動作し、ワンクリックでGoogleスプレッドシート出力やPDF受講証明書の発行が可能です。

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
    id: 16,
    name: 'AI Business Weekly',
    to: ['hello@aibusinessweekly.net'],
    cc: ['info@aibusinessweekly.net'],
    subject: 'Native Google Meet REST API v2 add-on for AI Business Weekly’s workflow coverage',
    text: `Hi AI Business Weekly Editorial Team,

While reading your comparison piece on Claude vs. Perplexity (https://aibusinessweekly.net/p/claude-vs-perplexity) where you link to tactiq.io/learn for meeting workflows, I wanted to share a zero-bot Google Meet add-on built for remote teams and executives.

Unlike browser extensions that scrape the DOM and break when Google updates Meet's interface—or Google's native attendance report that requires Enterprise tiers and 5+ participants—Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on running on the native Google Meet REST API v2. It opens inside the Meet side panel, merges reconnects, and exports timestamped attendance to Google Sheets in one click.

Helpful links if you cover Google Workspace tools in upcoming issues:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 17,
    name: 'Conecta Imobi Brazil',
    to: ['contato@conectaimobi.com.br'],
    cc: ['imprensa@olxbr.com'],
    subject: 'Complemento oficial do Google Meet (API REST v2) para o blog do Conecta Imobi',
    text: `Olá equipe editorial do Conecta Imobi,

Lendo o artigo de vocês sobre as lições do Inman Connect para o mercado imobiliário (https://blog.conectaimobi.com.br/inman-connect-2024-licoes-para-o-mercado/), onde vocês recomendam o tactiq.io para reuniões online, queria compartilhar uma ferramenta oficial em português para treinamentos de corretores, webinars e reuniões no Google Meet.

Como o relatório nativo de presença do Google Meet exige planos Enterprise e não funciona em reuniões com menos de 5 participantes, desenvolvi o Attendance Tracker (https://attendancetracker.dev) — add-on oficial no Google Workspace Marketplace construído sobre a API REST v2 nativa do Google Meet. Ele funciona direto no painel lateral do Meet sem bots, exporta a lista de presença para o Google Sheets e emite certificados PDF em um clique.

Links úteis caso atualizem o artigo:
- Lista de presença no Google Meet: https://attendancetracker.dev/lista-de-presenca-google-meet.html
- Guia para treinamentos e webinars: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Add-on oficial: https://attendancetracker.dev

Um abraço,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 18,
    name: 'Project Aeon',
    to: ['hello@project-aeon.com'],
    cc: ['support@project-aeon.com'],
    subject: 'Google Meet vs. Zoom attendance & recording workflow note for Project Aeon’s blog',
    text: `Hi Project Aeon Editorial Team,

While reading your guide "How to Make Highlights Video: Tips to Create Engaging Content" (https://project-aeon.com/blogs/how-to-make-highlights-video-tips-to-create-engaging-content), I noticed you link to scribbl.co/post/how-to-record-and-transcribe-a-zoom-conference-using-scribbl.

Since many creators and remote teams run their live workshops and community calls on Google Meet as well as Zoom—and hit Google Meet's 5-participant minimum and Enterprise tier lock on native attendance reports—we published a side-by-side comparison of Google Meet vs. Zoom attendance tracking alongside Attendance Tracker (https://attendancetracker.dev), our official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2.

Helpful links if you expand that section:
- Google Meet vs. Zoom Attendance Tracking Compared: https://attendancetracker.dev/google-meet-vs-zoom-attendance-tracking.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 19,
    name: 'AI Trendy Tools',
    to: ['hello@aitrendytools.com'],
    cc: ['aitrendytools@gmail.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for your Remote Teams 2025 guide',
    text: `Hi AI Trendy Tools Editorial Team,

While reading your guide "Best AI Tools for Remote Teams: Distributed Workforces 2025" (https://aitrendytools.com/blog/best-ai-tools-remote-teams-distributed-workforces-2025) where you link to tactiq.io for Google Meet, I wanted to share a zero-bot Google Meet add-on built for distributed teams.

Unlike legacy Chrome extensions that scrape the DOM and break when Google updates Meet's interface—or Google's native attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on running on the native Google Meet REST API v2. It opens inside the Meet side panel, merges reconnects, and exports attendance to Google Sheets in one click.

Helpful resources if you update that remote work guide:
- Remote & distributed teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 20,
    name: 'Max Productive AI',
    to: ['hello@max-productive.ai'],
    cc: ['info@max-productive.ai'],
    subject: 'Native Google Meet REST API v2 companion for Max Productive’s meeting tools directory',
    text: `Hi Max Productive Editorial Team,

While browsing your "Best AI Meeting Notetaker & Transcription Tools" guide (https://max-productive.ai/ai-tools/note-taking/) featuring tactiq.io for Google Meet, I wanted to share a 100% complementary, zero-bot Google Meet add-on focused on verified attendance and participant duration tracking.

Because Google Meet's native attendance report requires Enterprise Workspace plans and never triggers on calls under 5 participants, hosts on standard accounts often have no record of who attended after a meeting ends. I built Attendance Tracker (https://attendancetracker.dev)—an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2 that runs inside the Meet side panel and exports timestamped logs to Google Sheets in one click.

Helpful links if you expand your Google Meet tools coverage:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 21,
    name: 'Al Poniente Colombia',
    to: ['contacto@alponiente.com'],
    cc: ['info@alponiente.com'],
    subject: 'Herramienta gratuita de asistencia en Google Meet (API REST v2) para organizaciones sociales',
    text: `Hola equipo editorial de Al Poniente,

Leí con mucho interés vuestro artículo «Inteligencia Artificial (IA): una oportunidad para las organizaciones sociales» (https://alponiente.com/inteligencia-artificial-ia-una-oportunidad-para-las-organizaciones-sociales/), donde recomendáis a tactiq.io para reuniones virtuales en Google Meet.

Para fundaciones, ONGs y organizaciones sociales que coordinan voluntarios o talleres comunitarios en Google Meet, el informe nativo de Google exige planes Enterprise de pago y al menos 5 participantes. Por eso desarrollé Attendance Tracker (https://attendancetracker.dev): el complemento oficial en Google Workspace Marketplace basado en la API REST v2 nativa de Google Meet (en español), que registra horas de voluntariado y asistencia sin bots externos, exporta a Google Sheets y genera certificados PDF en un clic.

Enlaces útiles por si deseáis complementar el artículo:
- Guía de asistencia en español: https://attendancetracker.dev/asistencia-google-meet.html
- Control de horas para ONGs y voluntariado: https://attendancetracker.dev/google-meet-attendance-for-volunteer-hours.html
- Add-on oficial: https://attendancetracker.dev

Un saludo cordial,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 22,
    name: 'BugSmash',
    to: ['hello@bugsmash.io'],
    cc: ['support@bugsmash.com'],
    subject: 'Google Meet attendance template & REST API v2 add-on for BugSmash’s QA checklist guide',
    text: `Hi BugSmash Team,

While reading your post "Quality Assurance Checklist Template" (https://bugsmash.io/blog/quality-assurance-checklist-template/), I noticed your link to scribbl.co/post/meeting-action-items-template on effective meeting templates during QA and design reviews.

When engineering, design, and agency teams run bug triage or client UAT sign-off calls on Google Meet, Google's native attendance report won't trigger on calls with fewer than 5 people and requires Enterprise seats. We published a free Google Sheets attendance template alongside Attendance Tracker (https://attendancetracker.dev)—our official zero-bot Google Workspace Marketplace add-on built on the native Google Meet REST API v2 that logs participant durations in the Meet side panel and exports to Sheets in one click.

Helpful links if you expand that templates section:
- Free Google Meet Attendance Template: https://attendancetracker.dev/google-meet-attendance-template.html
- Remote engineering & QA teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 23,
    name: 'The Meaning Movement — Dan Cumberland',
    to: ['dan@themeaningmovement.com'],
    cc: ['hello@themeaningmovement.com'],
    subject: 'Google Meet REST API v2 companion for your video & meeting tools guide',
    text: `Hi Dan,

I enjoyed reading your comparison guide on video and meeting note tools (https://themeaningmovement.com/video-to-notes-ai-free/), where you feature tactiq.io for Google Meet users.

For coaches, educators, and cohort creators hosting live sessions on Google Meet, one common frustration is that Google's built-in attendance report requires Enterprise/Education Plus plans and never fires on small group calls under 5 people. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact attendee durations inside the Meet side panel, exports to Google Sheets, and issues 1-click PDF completion certificates.

Helpful links if you ever update that guide:
- Webinars & coaching cohorts guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 24,
    name: 'iSenaCode Spain — Sergio Navas',
    to: ['info@isenacode.com'],
    cc: ['sergio@isenacode.net'],
    subject: 'Complemento nativo de Google Meet (API REST v2) para los lectores de iSenaCode',
    text: `Hola Sergio y equipo de iSenaCode,

Leyendo vuestro artículo sobre la integración de Google Drive y herramientas de productividad en Google Workspace (https://isenacode.com/chatgpt-integra-google-drive-ya-puedes-abrir-y-editar-archivos-dentro-del-chat/), vi que enlazáis a tactiq.io/learn/how-to-connect-google-drive-to-chatgpt.

Para vuestros lectores que utilizan Google Meet a diario y necesitan exportar la asistencia a Google Drive/Sheets (ya que el informe nativo de Google exige cuentas Enterprise y al menos 5 participantes), desarrollé Attendance Tracker (https://attendancetracker.dev). Es el add-on oficial en Google Workspace Marketplace construido sobre la API REST v2 nativa de Google Meet en español: funciona en el panel lateral sin bots externos y exporta a Google Sheets en un clic.

Enlaces útiles por si queréis compartirlo o actualizar la guía:
- Guía de asistencia en español: https://attendancetracker.dev/asistencia-google-meet.html
- Exportar asistencia de Google Meet a Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Add-on oficial: https://attendancetracker.dev

Un saludo cordial,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 25,
    name: '5App AI',
    to: ['hello@5app.ai'],
    cc: ['support@5app.ai'],
    subject: 'Listing Attendance Tracker (Google Meet REST API v2) in 5App AI’s Meeting Assistant category',
    text: `Hi 5App AI Team,

While browsing your "Best 31+ AI Meeting Assistant Apps" category page (https://5app.ai/app-category/ai-meeting-assistant/) featuring tactiq.io for Google Meet, I wanted to share Attendance Tracker (https://attendancetracker.dev) as a zero-bot Google Meet add-on for your directory.

Unlike legacy Chrome extensions that scrape the DOM—or Google's native attendance report that requires Enterprise tiers and 5+ participants—Attendance Tracker is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It runs directly inside the Google Meet side panel without external bots, merges reconnects, and exports attendance to Google Sheets or PDF certificates in one click.

Helpful resources for your directory:
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
    name: 'ReadyContacts',
    to: ['sales@readycontacts.com'],
    cc: ['info@readycontacts.com'],
    subject: 'Adding Attendance Tracker (Google Meet REST API v2) to ReadyContacts’ B2B Tools List',
    text: `Hi ReadyContacts Editorial Team,

While reviewing your curated B2B "AI Tools List" (https://www.readycontacts.com/ai-tools-list/) where you feature scribbl.co for Google Meet users, I wanted to share Attendance Tracker (https://attendancetracker.dev) for inclusion in your meeting and GTM tools section.

When B2B revenue teams host multi-stakeholder demos or customer webinars on Google Meet, Google's built-in attendance report requires Enterprise plans and skips calls with fewer than 5 people. Attendance Tracker is an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact participant durations inside the Meet side panel and syncs to Google Sheets or CRM webhooks in one click.

Helpful links if you update that list:
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Webinars & B2B customer training guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 27,
    name: 'Approved Experiences',
    to: ['hello@approvedexperiences.com'],
    cc: ['support@approvedexperiences.com'],
    subject: 'Google Meet attendance template & REST API v2 add-on for your Meeting Preparation Checklist',
    text: `Hi Approved Experiences Editorial Team,

I enjoyed reading your guide "The Ultimate Meeting Preparation Checklist" (https://approvedexperiences.com/blog/meeting-preparation-checklist), where you cite scribbl.co/post/meeting-preparation-checklist.

For remote team leads and virtual team-building hosts running sessions on Google Meet, one item that often catches hosts off guard is that Google's native attendance report requires Enterprise seats and never fires on meetings under 5 participants. We published a free Google Sheets attendance template alongside Attendance Tracker (https://attendancetracker.dev)—our official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2.

Helpful links if you expand that checklist:
- Free Google Meet Attendance Template: https://attendancetracker.dev/google-meet-attendance-template.html
- Remote teams meeting guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 28,
    name: 'Hoeijmakers Netherlands — Rob Hoeijmakers',
    to: ['info@hoeijmakers.net'],
    cc: ['rob@schmuki.nl'],
    subject: 'Zero-bot Google Meet REST API v2 companion for your Tactiq vs Fireflies review',
    text: `Hi Rob,

I enjoyed reading your hands-on breakdown "Review of transcription software: Tactiq vs Fireflies.ai" (https://hoeijmakers.net/review-of-transcription-software-tactiq-vs-firefliesai/).

As you noted in your comparison, bot-based tools like Fireflies join the call as a visible participant while Chrome extensions like Tactiq rely on browser caption scraping. For Google Meet hosts who want verified participant join/leave timestamps without external bots or fragile DOM scraping—especially on calls under 5 people where Google's native attendance report won't trigger—I built Attendance Tracker (https://attendancetracker.dev) on the official Google Meet REST API v2 (with full English and Dutch UI support).

Helpful links if you ever update that comparison:
- Chrome extensions vs. native REST API v2 add-on: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- How to track attendance in Google Meet: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 29,
    name: 'Bianco Lavoro Italy',
    to: ['redazione@biancolavoro.it'],
    cc: ['info@biancolavoro.it'],
    subject: 'Componente aggiuntivo ufficiale Google Meet (API REST v2) per la vostra guida al lavoro da remoto',
    text: `Gentile Redazione di Bianco Lavoro,

Leggendo la vostra guida completa «Raccolta dei 160 migliori strumenti online per lavorare da remoto» (https://www.biancolavoro.it/raccolta-dei-160-migliori-strumenti-online-per-lavorare-da-remoto/), in cui segnalate tactiq.io per le riunioni su Google Meet, volevo presentarvi uno strumento complementare completamente tradotto in italiano.

Poiché il report di presenza nativo di Google Meet richiede licenze Enterprise e almeno 5 partecipanti (non attivandosi mai nei colloqui di selezione o nelle riunioni di piccoli team), ho sviluppato Attendance Tracker (https://attendancetracker.dev): il componente aggiuntivo ufficiale sul Google Workspace Marketplace basato sull'API REST v2 nativa di Google Meet. Funziona direttamente nel pannello laterale di Meet senza bot esterni ed esporta le presenze su Fogli Google in un clic.

Link utili se desiderate aggiornare la raccolta:
- Guida per team da remoto: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Guida per colloqui di lavoro su Google Meet: https://attendancetracker.dev/google-meet-attendance-for-job-interviews.html
- Add-on ufficiale: https://attendancetracker.dev

Un cordiale saluto,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 30,
    name: 'Stewart Accounting UK',
    to: ['info@stewartaccounting.co.uk'],
    cc: ['hello@stewartaccounting.co.uk'],
    subject: 'Dedicated board meeting quorum & attendance guide for your Company Secretarial Duties page',
    text: `Hi Stewart Accounting Team,

While reading your guide "Company Secretarial Duties: What Every Limited Company Director Needs to Know" (https://stewartaccounting.co.uk/company-secretarial-duties/), I noticed your citation of scribbl.co/post/a-guide-to-mastering-and-modernizing-the-art-of-board-meeting-minutes on recording board meeting minutes.

When company directors hold remote or hybrid board meetings on Google Meet, verifying quorum and keeping an auditable log of director attendance is critical—yet Google's built-in attendance report won't trigger on board meetings with fewer than 5 directors and requires Enterprise Workspace tiers. We published a dedicated governance guide for board meetings alongside Attendance Tracker (https://attendancetracker.dev), our zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2.

Helpful links if you'd like a governance-focused resource in that section:
- Google Meet Quorum & Board Meetings Guide: https://attendancetracker.dev/google-meet-quorum-and-board-meetings.html
- Exporting audit-ready attendance to Google Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  }
];

function getLogFilePath() {
  const envPath = process.env.WAVE16_LOG_FILE ? process.env.WAVE16_LOG_FILE.trim() : '';
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
Wave 16 Outreach Dispatcher (30 Verified Backlink Outreach Targets)
Usage:
  node scripts/send-wave16-outreach.cjs --dry-run
  node scripts/send-wave16-outreach.cjs --dry-run --target=1
  node scripts/send-wave16-outreach.cjs --test
  node scripts/send-wave16-outreach.cjs --test --target=1
  node scripts/send-wave16-outreach.cjs --send --target=1
  node scripts/send-wave16-outreach.cjs --send --all
  node scripts/send-wave16-outreach.cjs --send --target=1 --force
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
