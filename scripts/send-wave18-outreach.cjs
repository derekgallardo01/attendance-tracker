#!/usr/bin/env node
/**
 * scripts/send-wave18-outreach.cjs
 *
 * Dedicated dispatcher for Wave 18 Backlink Outreach (30 Verified Targets):
 * - Carried-over Verified Reserve Targets from Wave 17 (Targets 1–15, DR 29–35)
 * - Global SaaS Publications, Newsletters, AI Directories & Workflow Guides (Targets 16–30, DR 31–41)
 *
 * Sends personalized, anti-AI founder emails from Derek Gallardo <derek@attendancetracker.dev>
 * via the Resend API with reply-to derek@attendancetracker.dev.
 *
 * Safety & Execution features:
 * 1. Deduplication log in `docs/wave18-dispatch-log.json` (overridable via `WAVE18_LOG_FILE`) to prevent duplicate sends.
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
const LOG_FILE = path.resolve(__dirname, '../docs/wave18-dispatch-log.json');

const TARGETS = [
  {
    id: 1,
    name: 'SwiftNet WiFi',
    to: ['support@swiftnetwifi.com'],
    cc: ['info@swiftnetwifi.com'],
    subject: 'Automatic WiFi-reconnect attendance merging for your Remote Work Apps guide',
    text: `Hi SwiftNet WiFi Editorial Team,

While reading your "Remote Work Apps" guide (https://swiftnetwifi.com/blogs/news/remote-work-apps), I noticed your link to scribbl.co/post/how-to-record-and-transcribe-a-zoom-conference-using-scribbl.

For remote workers on cellular or mobile WiFi hotspots, brief connection drops during Google Meet calls often split a single person into multiple duplicate entries—and Google's native attendance report won't fire on calls under 5 participants or without Enterprise seats. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that automatically merges reconnections when WiFi drops and exports clean logs to Google Sheets in one click.

Helpful links if you update your remote work apps post:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 2,
    name: 'Statisfy',
    to: ['hello@statisfy.com'],
    cc: ['support@statisfy.com'],
    subject: 'Zero-bot Google Meet attendance add-on for Statisfy’s Customer Engagement guide',
    text: `Hi Statisfy Team,

While reading your post on customer engagement models (https://www.statisfy.com/blog/customer-engagement-models), I noticed you cite scribbl.co/post/meeting-facilitation-techniques regarding customer workshops and check-ins.

When customer success teams host onboarding webinars or 1-on-1 check-ins on Google Meet, Google's built-in attendance report requires Enterprise licenses and never triggers on calls under 5 participants. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that tracks exact participant durations inside the Meet side panel and exports directly to Google Sheets in one click.

Helpful links if you expand that section:
- Webinars & customer training guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 3,
    name: 'Make It Simple UK',
    to: ['info@makeitsimple.co.uk'],
    cc: ['hello@makeitsimple.co.uk'],
    subject: 'Google Meet to Google Sheets automation for your Business Growth guide',
    text: `Hi Make It Simple Team,

While reading your guide "AI Automation: Your Guide to Smarter Business Growth" (https://www.makeitsimple.co.uk/blog/ai-automation-your-guide-to-smarter-business-growth/), I noticed your link to scribbl.co/post/how-to-use-ai-to-take-meeting-notes-guide.

For UK businesses running team meetings or client workshops on Google Meet, Google's native attendance report requires Enterprise tiers and refuses to fire on calls with fewer than 5 people. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on built on the native Google Meet REST API v2 that logs exact join/leave timestamps in the Meet side panel and exports to Google Sheets in one click.

Useful resources if you update your business automation guide:
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 4,
    name: 'SpeakNotes',
    to: ['hello@speaknotes.io'],
    cc: ['support@speaknotes.io'],
    subject: 'Non-competing Google Meet attendance template link for SpeakNotes’ blog',
    text: `Hi SpeakNotes Team,

While reading your post "Meeting Agenda Template Google Docs" (https://speaknotes.io/blog/meeting-agenda-template-google-docs), I noticed you link out to tactiq.io/learn/5-google-docs-meeting-agenda-templates—a direct transcription competitor to SpeakNotes.

If you'd rather link to a 100% non-competing resource, we do zero audio recording or transcription. We built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that tracks participant join/leave timestamps inside the Meet side panel and exports attendance to Google Sheets in one click.

Non-competing links if you'd like to swap out that competitor citation:
- Free Google Meet attendance sheet template: https://attendancetracker.dev/google-meet-attendance-template.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 5,
    name: 'MinutesLink',
    to: ['support@minuteslink.com'],
    cc: ['hello@minuteslink.com'],
    subject: 'Non-competing Google Meet attendance companion for MinutesLink’s blog',
    text: `Hi MinutesLink Team,

While reading your post "Krisp AI: Review and Best Alternatives for 2025" (https://minuteslink.com/blog/krisp-ai-review-and-best-alternatives-for-2025), I noticed you include an outbound link to rival tactiq.io.

Since Attendance Tracker (https://attendancetracker.dev) does zero transcription or note-taking, it's a 100% non-competing Google Meet companion for MinutesLink users. Built on the native Google Meet REST API v2 as an official Google Workspace Marketplace add-on, it runs inside the Meet side panel without bots, merges reconnects on any call size, and exports attendance to Google Sheets in one click.

Helpful links if you'd like a non-competing resource to cite:
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Webinars & training attendance guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 6,
    name: 'SmartBizTools',
    to: ['support@smartbiztools.io'],
    cc: ['hello@smartbiztools.io'],
    subject: 'Native Google Meet REST API v2 add-on for SmartBizTools’ directory',
    text: `Hi SmartBizTools Editorial Team,

While viewing your product profile for tactiq.io (https://smartbiztools.io/ai-tools/tactiq/), I wanted to share a zero-bot Google Meet attendance add-on for your directory and alternatives section.

Unlike Chrome extensions that scrape DOM captions—or Google's built-in attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It tracks exact participant join/leave durations inside the Google Meet side panel and exports to Google Sheets in one click.

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
    name: 'AllAIWebsite',
    to: ['hi@allaiwebsite.com'],
    cc: ['support@allaiwebsite.com'],
    subject: 'Zero-bot Google Meet attendance add-on for AllAIWebsite’s Top 50 Free Tools guide',
    text: `Hi AllAIWebsite Editorial Team,

While reading your roundup "Top 50 Free AI Tools You Need" (https://allaiwebsite.com/blog/top-50-free-ai-tools-you-need-in-2025/) where you feature tactiq.io for Google Meet, I wanted to share our free-tier Google Workspace Marketplace add-on, Attendance Tracker (https://attendancetracker.dev).

Because Google's native attendance report requires paid Enterprise licenses and never fires on meetings under 5 people, teachers and remote teams use our official Google Meet REST API v2 add-on to log exact join/leave durations in the Meet side panel without bots and export to Google Sheets in one click.

Useful links if you update your roundup:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Attendance tracker guide for teachers: https://attendancetracker.dev/attendance-tracker-for-teachers.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 8,
    name: 'AICavo',
    to: ['hello@aicavo.com'],
    cc: ['support@aicavo.com'],
    subject: 'Adding Attendance Tracker (Google Meet REST API v2) to AICavo’s directory',
    text: `Hi AICavo Team,

While checking out your meeting tools comparison page (https://aicavo.com/tools/minuteslink) where you link to tactiq.io, I wanted to share Attendance Tracker (https://attendancetracker.dev) for your Google Meet tools coverage.

Instead of injecting recording bots or scraping browser captions via a fragile Chrome extension, Attendance Tracker is an official Google Workspace Marketplace add-on running on the native Google Meet REST API v2. It opens right inside the Google Meet side panel, works on any call size (including 1-on-1s), and exports attendance to Google Sheets in one click.

Helpful links if you list or compare Google Meet tools:
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
    name: 'Subanana Japan',
    to: ['editor@subanana.com'],
    cc: ['hello@subanana.com'],
    subject: '【Subanana様】記事内の競合リンク（Tactiq）に代わる非競合Google Meet出席管理アドオンのご案内',
    text: `Subanana 編集部 ご担当者様

貴社ブログ記事「Subanana vs Tactiq 2026：会議AIのドキュメント基準比較」（https://subanana.com/ja/blog/subanana-vs-tactiq）を拝読いたしました。記事内で競合である tactiq.io への外部リンクが設置されているのを拝見し、ご連絡いたしました。

私が開発した「Attendance Tracker」（https://attendancetracker.dev）は、文字起こしや議事録作成を一切行わない、100%非競合のGoogle Meet公式アドオン（Google Meet REST API v2ネイティブ対応・日本語UI完備）です。ボット不要でサイドパネルから参加・退出時刻を正確に記録し、ワンクリックでGoogleスプレッドシートへ出力できます。

Subanana様の機能を補完する非競合リソースとして、ぜひ記事内でのご紹介をご検討いただけますと幸いです。
- Google Meet出席確認ガイド：https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Googleスプレッドシート自動出力：https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- 公式アドオン：https://attendancetracker.dev

どうぞよろしくお願いいたします。

Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 10,
    name: 'Honeybear AI',
    to: ['support@honeybear.ai'],
    cc: ['hello@honeybear.ai'],
    subject: 'Zero-bot Google Meet attendance add-on for Honeybear AI’s Stakeholder Analysis guide',
    text: `Hi Honeybear AI Team,

While reading your guide "What Is Stakeholder Analysis?" (https://www.honeybear.ai/blog/what-is-stakeholder-analysis), I noticed you cite scribbl.co/post/project-management-for-agencies on agency project management.

When agencies and board committees run stakeholder reviews or quorum votes on Google Meet, Google's built-in attendance report requires Enterprise seats and never fires on meetings under 5 participants. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact participant durations inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand that resource section:
- Quorum & stakeholder board meetings guide: https://attendancetracker.dev/google-meet-quorum-and-board-meetings.html
- Remote project teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 11,
    name: 'DraftBot Pro',
    to: ['support@draftbotpro.com'],
    cc: ['hello@draftbotpro.com'],
    subject: 'Legal deposition & CLE attendance tracking on Google Meet for DraftBot Pro’s blog',
    text: `Hi DraftBot Pro Editorial Team,

While reading your legal insights post (https://www.draftbotpro.com/post/understanding-article-247-of-indian-constitution-key-insights), I noticed your link to scribbl.co/post/how-to-use-ai-to-take-meeting-notes-guide.

For law firms, legal educators, and compliance teams hosting remote depositions or CLE sessions on Google Meet, Google's native attendance report won't trigger on calls with fewer than 5 people and requires Enterprise seats. We built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs tamper-free join/leave timestamps and exports Google Sheets logs or PDF attendance certificates in one click.

Helpful legal attendance guides if you update that link:
- Legal depositions & hearings guide: https://attendancetracker.dev/google-meet-attendance-for-legal-depositions.html
- CLE & CPE continuing education credits guide: https://attendancetracker.dev/google-meet-attendance-for-cpe-and-cle-credits.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 12,
    name: 'Unreal Speech',
    to: ['contact@unrealspeech.com'],
    cc: ['support@unrealspeech.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for Unreal Speech’s AI Apps directory',
    text: `Hi Unreal Speech Team,

While browsing your directory page for tactiq.io (https://unrealspeech.com/ai-apps/tactiq), I wanted to share a zero-bot Google Meet attendance add-on for your directory and alternatives list.

Unlike browser extensions that scrape live captions from the DOM—or Google's native attendance report that requires Enterprise licenses and 5+ participants—Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It runs inside the Meet side panel, merges reconnections automatically, and exports attendance to Google Sheets in one click.

Helpful links if you expand your Google Meet tools directory:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 13,
    name: 'Greensighter',
    to: ['hello@greensighter.com'],
    cc: ['info@greensighter.com'],
    subject: 'Native Google Meet side-panel add-on for Greensighter’s SaaS UX Design guide',
    text: `Hi Greensighter Team,

While reading "The Ultimate Guide to SaaS UX Design" (https://www.greensighter.com/blog/saas-ux-design), I noticed you link to tactiq.io when discussing remote user research and design critiques.

When product designers run 1-on-1 usability interviews or design sprints on Google Meet, external recording bots can make participants self-conscious—and Google's native attendance report never triggers on calls under 5 people. I built Attendance Tracker (https://attendancetracker.dev), an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that lives quietly inside the Meet side panel and exports session timestamps to Google Sheets in one click.

Helpful links if you update your SaaS UX toolkit:
- Remote design & engineering teams guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 14,
    name: 'Optimational',
    to: ['solutions@optimational.com'],
    cc: ['info@optimational.com'],
    subject: 'Complemento multilingüe (44 idiomas) de asistencia en Google Meet para el blog de Optimational',
    text: `Hola equipo editorial de Optimational,

Leyendo vuestro artículo sobre transcripción, SEO e idiomas (https://optimational.com/es/blog/transcripcion-seo-idioma-algoritmos/) vi que mencionáis a tactiq.io para reuniones en Google Meet.

Para equipos internacionales y escuelas de idiomas que usan Google Meet, el informe nativo de asistencia de Google exige licencias Enterprise y no se activa en sesiones de menos de 5 personas. He desarrollado Attendance Tracker (https://attendancetracker.dev), un complemento oficial en Google Workspace Marketplace basado en la API REST v2 nativa de Google Meet, localizado en 44 idiomas (incluido español), que registra la asistencia sin bots y exporta a Google Sheets o certificados PDF en un clic.

Enlaces útiles por si actualizáis vuestra guía:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Guía para academias y escuelas de idiomas: https://attendancetracker.dev/google-meet-attendance-for-language-schools.html
- Complemento oficial: https://attendancetracker.dev

Un cordial saludo,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 15,
    name: 'XALT Germany',
    to: ['hallo@xalt.de'],
    cc: ['hello@xalt.de'],
    subject: 'Zero-bot Google Meet REST API v2 add-on (with German UI) for XALT’s Meeting Productivity guide',
    text: `Hi XALT Editorial Team,

While reading your article on maximizing team productivity in meetings (https://www.xalt.de/en/notwendige-vs-unnoetige-meetings-maximiere-die-teamproduktivitaet/) where you link to tactiq.io, I wanted to share a privacy-first Google Meet add-on built for European engineering and consulting teams.

Unlike bot-based tools or fragile browser extensions, Attendance Tracker (https://attendancetracker.dev) is an official Google Workspace Marketplace add-on running on the native Google Meet REST API v2 (with full German and English UI localization). It tracks exact participant durations inside the Meet side panel on any meeting size and exports directly to Google Sheets in one click.

Helpful links if you expand your meeting productivity guide:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 16,
    name: 'Marketing Examined — Alex Garcia',
    to: ['alex@marketingexamined.com'],
    cc: ['hello@marketingexamined.com'],
    subject: 'Quick note on your Marketing Examined post + zero-bot Google Meet add-on',
    text: `Hi Alex,

While reading your growth breakdown on Marketing Examined (https://www.marketingexamined.com/blog/organic-tiktok), I noticed you recommend tactiq.io in your workflow stack.

For marketing agencies and remote growth teams running client check-ins or standups on Google Meet, Google's built-in attendance report requires Enterprise seats and never fires on calls under 5 people. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact participant timestamps in the Meet side panel and exports to Google Sheets in one click.

Thought these might be useful if you ever update your remote team stack recommendations:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 17,
    name: 'MOUSHI',
    to: ['hello@moushi.co'],
    cc: ['info@moushi.co'],
    subject: 'Adding Attendance Tracker (Google Meet REST API v2) to MOUSHI’s Essential Business Tools',
    text: `Hi MOUSHI Team,

While browsing your "Explore Essential Business Tools" directory (https://www.moushi.co/tools) where you feature tactiq.io for Google Meet, I wanted to share Attendance Tracker (https://attendancetracker.dev) for consideration.

Unlike Chrome extensions that scrape DOM captions and break when Google updates Meet's layout—or Google's native report that requires Enterprise licenses and 5+ participants—Attendance Tracker is an official zero-bot Google Workspace Marketplace add-on built on the native Google Meet REST API v2. It runs inside the Meet side panel and exports participant durations to Google Sheets in one click.

Helpful links for your business tools directory:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 18,
    name: 'AISecret',
    to: ['hello@aisecret.us'],
    cc: ['contact@aisecret.us'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for AISecret readers',
    text: `Hi AISecret Editorial Team,

While reading your AISecret newsletter edition (https://aisecret.us/openai-targets-tiktok/) where you link to tactiq.io/in-meeting-ai, I wanted to share a zero-bot Google Workspace Marketplace add-on built for Google Meet users.

Because Google's native attendance report requires Enterprise seats and won't trigger on calls with fewer than 5 participants, I built Attendance Tracker (https://attendancetracker.dev) on the native Google Meet REST API v2. It runs directly inside the Google Meet side panel without intrusive bots, merges reconnections automatically, and exports attendance to Google Sheets in one click.

Helpful links if you feature Google Meet tools in an upcoming issue:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Step-by-step Google Meet tracking guide: https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 19,
    name: 'Women Make',
    to: ['hello@womenmake.com'],
    cc: ['info@womenmake.com'],
    subject: 'Zero-bot Google Meet attendance add-on for Women Make’s meeting kits post',
    text: `Hi Women Make Team,

While reading your post on efficient meeting kits (https://womenmake.com/posts/0gj0T0djcr/generative-ai-meeting-kits-custom-prompts-for-efficient-meetings) linking to tactiq.io/ai-meeting-kits, I wanted to share a lightweight Google Meet add-on built for founders and community hosts.

When hosting cohort workshops, community sessions, or 1-on-1 calls on Google Meet, Google's built-in attendance report requires Enterprise plans and never fires on meetings under 5 people. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact participant durations in the Meet side panel and exports to Google Sheets in one click.

Helpful links if you expand your meeting resources:
- Remote teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Webinars & cohort training guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 20,
    name: 'Steal AI Tools',
    to: ['hello@stealaitools.com'],
    cc: ['contact@stealaitools.com'],
    subject: 'Google Meet to Google Sheets workflow add-on for Steal AI Tools',
    text: `Hi Steal AI Tools Editorial Team,

While reading your Google Workspace workflow guide (https://stealaitools.com/chatgpt-content-calendar-build-a-90-day-plan-in-2026/) where you link to tactiq.io/learn/connect-google-calendar-to-chatgpt, I wanted to share a native Google Workspace Marketplace add-on for Google Meet and Google Sheets.

Unlike Chrome extensions that scrape DOM elements—or Google's built-in attendance report that requires Enterprise seats and 5+ participants—Attendance Tracker (https://attendancetracker.dev) is built on the native Google Meet REST API v2. It tracks participant join/leave timestamps in the Meet side panel without bots and exports formatted sheets to Google Sheets in one click.

Useful links if you update your Google Workspace guides:
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 21,
    name: 'SoftRiver',
    to: ['hello@softriver.co'],
    cc: ['support@softriver.co'],
    subject: 'Zero-bot Google Meet attendance add-on for SoftRiver’s agency blog',
    text: `Hi SoftRiver Team,

While reading your guide "A Smart Guide to Logo Design Pricing" (https://www.softriver.co/blog/a-smart-guide-to-logo-design-pricing), I noticed you cite scribbl.co/pricing when discussing client consultation tools.

When creative agencies and freelance designers hold 1-on-1 discovery or revision calls with clients on Google Meet, Google's native attendance report never triggers at all (since it requires 5+ participants and Enterprise seats). I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact call timestamps inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you update that resource link:
- Remote & creative teams attendance guide: https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- Exporting Google Meet attendance to Sheets: https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 22,
    name: 'Hakky Handbook Japan',
    to: ['info@st-hakky.com'],
    cc: ['contact@st-hakky.com'],
    subject: '【Hakky Handbook様】Google Meet REST API v2対応・日本語版出席管理アドオンのご紹介',
    text: `株式会社Hakky（Hakky Handbook 編集部）ご担当者様

いつもHakky Handbookの技術解説記事を拝読しております。貴メディアの記事（https://book.st-hakky.com/docs/chatgpt-android）にて、Google Meet関連リソースとして tactiq.io/ja/learn/... を参照されているのを拝見し、ご連絡いたしました。

Google Meet標準の出席レポートはWorkspace Enterpriseプラン限定かつ5名以上の会議でしか作動しないため、私はネイティブのGoogle Meet REST API v2上で動作する公式Google Workspace Marketplaceアドオン「Attendance Tracker」（https://attendancetracker.dev）を開発いたしました（日本語UI完全対応）。ボット不要でサイドパネルから参加・退出時間を自動記録し、Googleスプレッドシートへワンクリックで出力できます。

関連記事の補足リソースとしてご活用いただけましたら幸いです。
- Google Meet出席確認ガイド：https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- Google Meet拡張機能・アドオン比較：https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- 公式アドオン：https://attendancetracker.dev

どうぞよろしくお願いいたします。

Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 23,
    name: 'Timewitch Japan',
    to: ['info@timewitch.jp'],
    cc: ['contact@timewitch.jp'],
    subject: '【Timewitch様】会議効率化記事へのGoogle Meet公式出席管理アドオン（日本語対応）のご提案',
    text: `株式会社Timewitch 編集部 ご担当者様

貴社note記事「AI議事録ツールの比較3選！主要機能と選び方を解説」（https://note.timewitch.jp/n/n82d4de61971e）にて、Google Meet対応ツールとして tactiq.io/ja を紹介されているのを拝見し、ご連絡いたしました。

リモートチームの定例会議や1on1において、Google Meet標準の出席レポートはEnterpriseプラン限定かつ5名未満の会議では出力されません。私が開発した公式Google Workspace Marketplaceアドオン「Attendance Tracker」（https://attendancetracker.dev）は、Google Meet REST API v2ネイティブ対応（日本語UI完備）で、ボットを参加させずにサイドパネル内で正確な入退室時間を記録し、ワンクリックでGoogleスプレッドシートへ出力します。

会議効率化ツールの補足リソースとしてぜひご検討ください。
- Google Meet出席確認ガイド：https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html
- リモートチーム向け出席管理：https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html
- 公式アドオン：https://attendancetracker.dev

どうぞよろしくお願いいたします。

Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 24,
    name: 'Bytemarks Cafe — Burt Lum & Ryan Ozawa',
    to: ['burt@bytemarkscafe.org'],
    cc: ['info@bytemarkscafe.org'],
    subject: 'Aloha Burt & Ryan — zero-bot Google Meet add-on for Bytemarks Cafe listeners',
    text: `Aloha Burt and Ryan,

While browsing your Bytemarks Cafe archive (https://bytemarkscafe.org/2022/12/) where you highlighted tactiq.io for virtual meetings, I wanted to share a privacy-first Google Meet tool built for educators, nonprofits, and community boards.

Because Google's built-in attendance report requires paid Enterprise licenses and never triggers on meetings under 5 people, many teachers and civic organizations rely on fragile Chrome extensions. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on running on the native Google Meet REST API v2 that tracks attendance inside the Meet side panel and exports to Google Sheets in one click.

Helpful links if you ever revisit Google Meet tools on the show:
- Best Google Meet extensions & add-ons compared: https://attendancetracker.dev/best-google-meet-attendance-extensions.html
- Guide for teachers & schools: https://attendancetracker.dev/attendance-tracker-for-teachers.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 25,
    name: 'Aidar Solutions',
    to: ['info@aidarsolutions.com'],
    cc: ['hello@aidarsolutions.com'],
    subject: 'Corporate training attendance tracking on Google Meet for Aidar Solutions’ blog',
    text: `Hi Aidar Solutions Team,

While reading your article "Workforce Development Strategies" (https://aidarsolutions.com/workforce-development-strategies/), I noticed you cite scribbl.co/post/how-to-delegate-tasks-effectively.

For HR and L&D teams running workforce training sessions on Google Meet, Google's native attendance report requires Enterprise licenses and won't fire on small-group coaching calls under 5 people. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 that logs exact training durations inside the Meet side panel and exports Google Sheets reports or PDF completion certificates in one click.

Helpful links if you update your workforce development guide:
- Corporate training attendance guide: https://attendancetracker.dev/google-meet-attendance-corporate-training.html
- Webinars & employee training guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Official add-on: https://attendancetracker.dev

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 26,
    name: 'CPO Creativity Bulgaria',
    to: ['info@cpocreativity.com'],
    cc: ['cpocreativity@gmail.com'],
    subject: 'Native Google Meet REST API v2 add-on (with Bulgarian UI) for CPO Creativity',
    text: `Hi CPO Creativity Team,

While reading your productivity apps article (https://cpocreativity.com/%D1%82%D1%80%D0%B8-ai-%D0%BF%D1%80%D0%B8%D0%BB%D0%BE%D0%B6%D0%B5%D0%BD%D0%B8%D1%8F-%D0%BA%D0%BE%D0%B8%D1%82%D0%BE-%D1%89%D0%B5-%D0%B2%D0%B8-%D0%BD%D0%B0%D0%BF%D1%80%D0%B0%D0%B2%D1%8F%D1%82-%D0%BF/) where you feature tactiq.io for Google Meet, I wanted to share our official Google Workspace Marketplace add-on, Attendance Tracker (https://attendancetracker.dev), which includes full Bulgarian (bg) and English UI localization.

Unlike Chrome extensions that scrape DOM captions—or Google's native attendance report that requires Enterprise tiers and 5+ participants—Attendance Tracker runs on the native Google Meet REST API v2 inside the Meet side panel without bots, logging exact join/leave times and exporting to Google Sheets in one click.

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
    id: 27,
    name: 'IZA Business Centers Mexico',
    to: ['contacto@izabc.com.mx'],
    cc: ['info@izabc.com.mx'],
    subject: 'Control de asistencia y quórum en Google Meet para el blog de IZA Business Centers',
    text: `Hola equipo editorial de IZA Business Centers,

Leyendo vuestro artículo "Herramientas de inteligencia artificial para transcribir reuniones" (https://blog.izabc.com.mx/herramientas-de-inteligencia-artificial-para-transcribir-reuniones), vi que recomendáis tactiq.io para usuarios de Google Meet.

Para empresas y consejos directivos que realizan juntas híbridas en Google Meet, el reporte nativo de asistencia de Google exige cuentas Enterprise y no se activa en reuniones de menos de 5 personas. He creado Attendance Tracker (https://attendancetracker.dev), un complemento oficial en Google Workspace Marketplace basado en la API REST v2 nativa de Google Meet (en español) que registra entradas, salidas y quórum desde el panel lateral sin bots y exporta a Google Sheets en un clic.

Enlaces útiles por si deseáis complementar vuestra guía:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Control de quórum y juntas directivas: https://attendancetracker.dev/google-meet-quorum-and-board-meetings.html
- Complemento oficial: https://attendancetracker.dev

Saludos cordiales,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 28,
    name: 'Persona Institut Germany',
    to: ['info@persona-institut.de'],
    cc: ['kontakt@persona-institut.de'],
    subject: 'Zero-bot Google Meet attendance add-on (German UI) for Persona Institut’s Recruiting guide',
    text: `Hi Persona Institut Editorial Team,

While reading your article on AI in recruiting (https://www.persona-institut.de/en/kuenstliche-intelligenz-im-recruiting/) where you feature tactiq.io, I wanted to share a privacy-first Google Meet add-on built for HR and recruiting teams (with full German and English UI support).

When recruiters run 1-on-1 candidate interviews or small assessment panels on Google Meet, external recording bots can feel intrusive—and Google's native attendance report never fires on calls under 5 participants. I built Attendance Tracker (https://attendancetracker.dev) on the native Google Meet REST API v2 to log exact interview durations inside the Meet side panel without bots and export to Google Sheets in one click.

Helpful links if you expand your recruiting tools guide:
- Candidate job interviews guide: https://attendancetracker.dev/google-meet-attendance-for-job-interviews.html
- Webinars & HR training guide: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 29,
    name: 'The Hero Camp Spain',
    to: ['hola@theherocamp.com'],
    cc: ['info@theherocamp.com'],
    subject: 'Control de asistencia en Google Meet (sin bots) para el blog de The Hero Camp',
    text: `Hola equipo de The Hero Camp,

Leyendo vuestro artículo "¿Cómo usar Product Discovery con IA?" (https://theherocamp.com/como-usar-product-discovery-con-ia/), vi que recomendáis tactiq.io/es para entrevistas y sesiones en Google Meet.

Tanto en entrevistas 1-a-1 de Product Discovery como en bootcamps y clases en vivo por Google Meet, el informe nativo de asistencia de Google exige licencias Enterprise y no se activa con menos de 5 participantes. He desarrollado Attendance Tracker (https://attendancetracker.dev), un complemento oficial en Google Workspace Marketplace sobre la API REST v2 nativa de Google Meet (en español) que registra tiempos exactos en el panel lateral sin bots y exporta a Google Sheets o certificados PDF en un clic.

Enlaces útiles por si actualizáis vuestros recursos:
- Guía de asistencia en Google Meet (ES): https://attendancetracker.dev/asistencia-google-meet.html
- Guía para formaciones y webinars: https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html
- Complemento oficial: https://attendancetracker.dev

Un abrazo,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  },
  {
    id: 30,
    name: 'Prof. Erkan Saka — Istanbul Bilgi University',
    to: ['erkan@erkansaka.net'],
    cc: ['sakaerka@gmail.com'],
    subject: 'Zero-bot Google Meet attendance add-on (Turkish & English UI) + free faculty pass',
    text: `Hi Prof. Saka,

While reading your post "Claude vs Perplexity Comparison" on erkansaka.net (https://erkansaka.net/2026/03/16/claude-vs-perplexity-comparison/), I noticed your link to tactiq.io/learn/claude-vs-perplexity.

For university lectures, seminars, and office hours on Google Meet, Google's native attendance report requires Enterprise licenses and never triggers on sessions under 5 participants. I built Attendance Tracker (https://attendancetracker.dev)—an official zero-bot Google Workspace Marketplace add-on on the native Google Meet REST API v2 (with full Turkish and English UI localization) that tracks student join/leave durations inside the Meet side panel and exports to Google Sheets in one click.

If you'd like to try it for your courses at Istanbul Bilgi University, reply with your Google Workspace email and I'll activate a free lifetime faculty pass:
- University lectures & seminars guide: https://attendancetracker.dev/google-meet-attendance-for-universities.html
- Guide for educators: https://attendancetracker.dev/attendance-tracker-for-teachers.html
- Official add-on: https://attendancetracker.dev

Best regards,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev`
  }
];

function getLogFilePath() {
  const envPath = process.env.WAVE18_LOG_FILE ? process.env.WAVE18_LOG_FILE.trim() : '';
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
Wave 18 Outreach Dispatcher (30 Verified Backlink Outreach Targets)
Usage:
  node scripts/send-wave18-outreach.cjs --dry-run
  node scripts/send-wave18-outreach.cjs --dry-run --target=1
  node scripts/send-wave18-outreach.cjs --test
  node scripts/send-wave18-outreach.cjs --test --target=1
  node scripts/send-wave18-outreach.cjs --send --target=1
  node scripts/send-wave18-outreach.cjs --send --all
  node scripts/send-wave18-outreach.cjs --send --target=1 --force
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
