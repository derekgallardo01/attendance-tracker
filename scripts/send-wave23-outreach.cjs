#!/usr/bin/env node
/**
 * Wave 23 Outreach Dispatcher — Attendance Tracker (attendancetracker.dev)
 *
 * Sends personalized outreach emails via Resend API to 30 verified Wave 23
 * targets (DR 14-70 across SaaS/AI/EdTech blogs, .edu/.org academic &
 * educational directories, and international resources in EN, ES, JA, ID, AR).
 *
 * Usage:
 *   node scripts/send-wave23-outreach.cjs --dry-run
 *   node scripts/send-wave23-outreach.cjs --test --target=1
 *   node scripts/send-wave23-outreach.cjs --send --target=1
 *   node scripts/send-wave23-outreach.cjs --send --all
 */

const fs = require('fs');
const path = require('path');

function loadResendApiKey() {
  if (process.env.RESEND_API_KEY) return process.env.RESEND_API_KEY.trim();
  const envCandidates = [
    path.join(__dirname, '..', '.env'),
    path.join(__dirname, '..', 'backend', '.env'),
  ];
  for (const envPath of envCandidates) {
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      const match = content.match(/^RESEND_API_KEY\s*=\s*["']?([^"'\r\n]+)["']?/m);
      if (match && match[1]) return match[1].trim();
    }
  }
  return '';
}

const RESEND_API_KEY = loadResendApiKey();
const FROM_EMAIL = 'Derek Gallardo <derek@attendancetracker.dev>';
const REPLY_TO = 'derek@attendancetracker.dev';
const TEST_TO_EMAIL = 'derekgallardo01@gmail.com';
const LOG_FILE =
  process.env.WAVE23_LOG_FILE || path.join(__dirname, '..', 'docs', 'wave23-dispatch-log.json');

const TARGETS = [
  {
    id: 1,
    name: 'HyScaler',
    to: ['info@hyscaler.com'],
    cc: ['sales@hyscaler.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for HyScaler’s AI & productivity insights',
    html: `<p>Hi HyScaler Editorial Team,</p>
<p>I enjoyed your article <em>Pioneering Top 7 Must-Use AI Tools</em> (<a href="https://hyscaler.com/insights/must-use-ai-tools-in-2024/">hyscaler.com/insights/must-use-ai-tools-in-2024/</a>), especially how you highlighted Tactiq for Google Meet workflows.</p>
<p>I'm the developer of <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>, an official Google Workspace Marketplace side-panel add-on built on the <strong>Google Meet REST API v2</strong> that tracks participant join/leave timestamps without injecting a recording bot:</p>
<ul>
  <li><strong>Remote Engineering &amp; Product Teams:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html">Google Meet Attendance for Remote Teams</a> (live participant duration tracking, automatic reconnect merging, and 1-click Google Sheets sync).</li>
  <li><strong>2026 Architecture Comparison:</strong> <a href="https://attendancetracker.dev/best-google-meet-attendance-extensions.html">Best Google Meet Attendance Extensions</a>.</li>
</ul>
<p>If you update your productivity and meeting guides, I'd be grateful if you considered including Attendance Tracker, and I'm happy to provide your team a free lifetime Pro workspace license to test.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 2,
    name: 'GUVI India EdTech',
    to: ['cs@guvi.in'],
    cc: ['info@guvi.in'],
    subject: 'Zero-bot Google Meet REST API v2 attendance add-on for GUVI’s blog + educator access',
    html: `<p>Hi GUVI Editorial Team,</p>
<p>I was reading your guide <em>Top AI Tools for Note Taking: Maximize Your Productivity</em> (<a href="https://www.guvi.in/blog/top-ai-tools-for-note-taking/">guvi.in/blog/top-ai-tools-for-note-taking/</a>), where you covered Tactiq for live classes and meetings.</p>
<p>For GUVI instructors and bootcamp mentors running live coding cohorts on Google Meet who need verifiable attendance rosters without a third-party bot joining the room, I built <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>:</p>
<ul>
  <li><strong>University &amp; Bootcamp Cohorts:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-universities.html">Google Meet Attendance for Universities</a> (built on the official <strong>Google Meet REST API v2</strong>, localized in English, Hindi, Tamil, and 44 languages).</li>
  <li><strong>Live Training &amp; Webinars:</strong> <a href="https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html">Track Attendance for Webinars and Training in Google Meet</a>.</li>
</ul>
<p>Would you be open to mentioning it in your productivity or EdTech guides? I'd be glad to activate free lifetime Pro licenses for GUVI's instructors.</p>
<p>Warm regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 3,
    name: 'Nimdzi Insights',
    to: ['info@nimdzi.com'],
    cc: ['research@nimdzi.com'],
    subject: 'Multilingual (44-language) Google Meet REST API v2 add-on for Nimdzi Insights',
    html: `<p>Hi Nimdzi Research Team,</p>
<p>I came across your profile of Tactiq in the <em>Nimdzi Language Technology Radar</em> (<a href="https://www.nimdzi.com/language-technology-radar/tactiq/">nimdzi.com/language-technology-radar/tactiq/</a>) while researching localization and virtual classroom tooling.</p>
<p>I'm the creator of <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>, a native Google Workspace Marketplace add-on localized into <strong>44 languages</strong> that uses the official <strong>Google Meet REST API v2</strong> to log exact participant attendance without audio capture or meeting bots:</p>
<ul>
  <li><strong>Language Schools &amp; Interpreter Training:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-language-schools.html">Google Meet Attendance for Language Schools</a> (tracks instructional hours and exports directly to Google Sheets).</li>
  <li><strong>Step-by-Step Workflow:</strong> <a href="https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html">How to Track Attendance in Google Meet</a>.</li>
</ul>
<p>If your team covers multilingual virtual classroom utilities or Google Meet add-ons, I'd be happy to share a free Pro workspace pass for your analysts.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 4,
    name: 'MeetJamie AI',
    to: ['hey@meetjamie.ai'],
    cc: ['support@meetjamie.ai'],
    subject: 'Non-competing Google Meet attendance link for MeetJamie’s blog',
    html: `<p>Hi MeetJamie Content Team,</p>
<p>I noticed your comparison post <em>AI Notes Generator: Top Apps Compared</em> (<a href="https://www.meetjamie.ai/blog/ai-notes-generator">meetjamie.ai/blog/ai-notes-generator</a>) includes an outbound link to rival AI note-taker <code>tactiq.io</code>.</p>
<p>Since Tactiq competes directly with Jamie for bot-free meeting notes and summaries, you might prefer linking to a 100% non-competing Google Meet utility when referencing participant attendance and roster exports: <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>.</p>
<ul>
  <li><strong>Zero Overlap with Jamie:</strong> We do zero audio recording, transcription, or AI note generation—only exact join/leave timestamps via the official <strong>Google Meet REST API v2</strong> (<a href="https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html">How to Track Attendance in Google Meet</a>).</li>
  <li><strong>Automated Sheets Export:</strong> <a href="https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html">Export Google Meet Attendance to Google Sheets</a>.</li>
</ul>
<p>It's a clean way to keep your Google Meet guides helpful without sending SEO equity to a direct note-taking competitor. Happy to share a free Pro workspace pass if your team wants to test it alongside Jamie.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 5,
    name: 'Fast.io',
    to: ['help@fast.io'],
    cc: ['privacy@fast.io'],
    subject: 'Google Meet to Google Drive/Sheets REST API v2 add-on for Fast.io’s resources',
    html: `<p>Hi Fast.io Editorial Team,</p>
<p>I was reading your Google Drive automation resource (<a href="https://fast.io/resources/can-chatgpt-upload-files-to-google-drive/">fast.io/resources/can-chatgpt-upload-files-to-google-drive/</a>), where you referenced Tactiq's Google Drive workflow guides.</p>
<p>If your readers automate Google Drive and Google Workspace workflows, I built a native companion add-on called <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a> that syncs live meeting rosters straight to Google Drive &amp; Sheets via the official <strong>Google Meet REST API v2</strong>:</p>
<ul>
  <li><strong>Direct Google Drive &amp; Sheets Sync:</strong> <a href="https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html">Export Google Meet Attendance to Google Sheets</a> (1-click formatted spreadsheets with arrival/departure times and net duration, zero bots).</li>
  <li><strong>Remote Team Operations:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html">Google Meet Attendance for Remote Teams</a>.</li>
</ul>
<p>Feel free to reference or link to our Google Sheets/Drive guide in your Workspace resources—and let me know if you'd like a free lifetime Pro license to test.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 6,
    name: 'Mapify',
    to: ['hi@mapify.so'],
    cc: ['support@mapify.so'],
    subject: 'Non-competing Google Meet REST API v2 companion for Mapify’s productivity blog',
    html: `<p>Hi Mapify Team,</p>
<p>I came across your guide <em>Top YouTube Videos to Transcript Tools</em> (<a href="https://mapify.so/blog/top-youtube-videos-to-transcript-tools">mapify.so/blog/top-youtube-videos-to-transcript-tools</a>), where you cited Tactiq alongside Mapify's workflow tools.</p>
<p>For Mapify users who run brainstorming sessions, classes, or standups in Google Meet and need an automatic attendance log without a recording bot, I built <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>:</p>
<ul>
  <li><strong>Remote Teams &amp; Standups:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html">Google Meet Attendance for Remote Teams</a> (uses the official <strong>Google Meet REST API v2</strong> inside the Meet side panel).</li>
  <li><strong>1-Click Google Sheets Export:</strong> <a href="https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html">Export Google Meet Attendance to Google Sheets</a>.</li>
</ul>
<p>Since we focus strictly on attendance rosters and duration tracking (never transcripts or mind maps), it's a 100% non-competing resource if you ever link to Google Meet utilities on your blog. Happy to provide a free Pro pass for your team!</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 7,
    name: 'Wellows',
    to: ['contact@wellows.com'],
    cc: ['media@wellows.com'],
    subject: 'Native Google Meet REST API v2 add-on for Wellows’ SaaS & startup roundups',
    html: `<p>Hi Wellows Editorial Team,</p>
<p>I enjoyed reading your roundup <em>85 Hottest AI Startups to Watch in 2026</em> (<a href="https://wellows.com/blog/ai-startups/">wellows.com/blog/ai-startups/</a>), where you featured Tactiq in the meeting productivity category.</p>
<p>As a founder building in the Google Workspace ecosystem, I wanted to share <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>—an official Google Workspace Marketplace add-on built on the <strong>Google Meet REST API v2</strong> that replaces fragile DOM scrapers and intrusive meeting bots:</p>
<ul>
  <li><strong>Extension vs. REST API v2 Comparison:</strong> <a href="https://attendancetracker.dev/best-google-meet-attendance-extensions.html">Best Google Meet Attendance Extensions (2026)</a>.</li>
  <li><strong>Distributed Team Standups:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html">Google Meet Attendance for Remote Teams</a>.</li>
</ul>
<p>If you update your workplace productivity or Google Meet coverage, I'd love for you to check it out, and I'm happy to set up a free Pro workspace license for your editorial team.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 8,
    name: 'Kripesh Adwani',
    to: ['contact@kripeshadwani.com'],
    cc: ['hello@kripeshadwani.com'],
    subject: 'Quick note on your meeting tools guide + zero-bot Google Meet REST API v2 add-on, Kripesh',
    html: `<p>Hi Kripesh,</p>
<p>I've been following your hands-on software reviews and just read your guide <em>9 Best AI Note Taking Apps (2026) - AI For Meetings, Students</em> (<a href="https://kripeshadwani.com/best-ai-note-taking-apps/">kripeshadwani.com/best-ai-note-taking-apps/</a>), where you tested Tactiq on Google Meet.</p>
<p>Many teachers, students, and remote managers in India use note-takers just to get a list of who attended a Google Meet call, but don't want a bot recording the session. To solve that cleanly, I built <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>:</p>
<ul>
  <li><strong>Official Google Meet REST API v2:</strong> Runs natively inside the Google Meet side panel—zero bots, zero audio recording, and immune to Meet UI updates (<a href="https://attendancetracker.dev/best-google-meet-attendance-extensions.html">Best Google Meet Attendance Extensions</a>).</li>
  <li><strong>Instant Google Sheets &amp; CSV Reports:</strong> <a href="https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html">How to Track Attendance in Google Meet</a>.</li>
</ul>
<p>I'd be happy to activate a lifetime Pro license on your Google account if you'd ever like to test it or mention it in your Google Meet / Chrome extension roundups.</p>
<p>Cheers,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 9,
    name: 'Peoplebox AI',
    to: ['hello@peoplebox.ai'],
    cc: ['support@peoplebox.ai'],
    subject: 'Zero-bot Google Meet attendance add-on for Peoplebox AI’s management guides',
    html: `<p>Hi Peoplebox Editorial Team,</p>
<p>I was reading your <em>Skip Level Meetings Guide With Questions</em> (<a href="https://www.peoplebox.ai/blog/skip-level-meetings/">peoplebox.ai/blog/skip-level-meetings/</a>), where you linked to Tactiq for meeting documentation.</p>
<p>For HR leaders and engineering managers running skip-level meetings, all-hands, and L&amp;D training on Google Meet who need verifiable participation metrics without a third-party recording bot, I built <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>:</p>
<ul>
  <li><strong>Remote Team All-Hands &amp; Rituals:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html">Google Meet Attendance for Remote Teams</a> (uses the official <strong>Google Meet REST API v2</strong> to log exact join/leave times and talk duration).</li>
  <li><strong>Automated Google Sheets Sync:</strong> <a href="https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html">Export Google Meet Attendance to Google Sheets</a>.</li>
</ul>
<p>If you're open to adding a dedicated attendance resource to your meeting guides, I'd be happy to provide a free Pro workspace license for your team.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 10,
    name: 'Universo Abierto — University of Salamanca Library Blog',
    to: ['contacto@universoabierto.org'],
    cc: ['info@universoabierto.org'],
    subject: 'Complemento oficial de asistencia en Google Meet (REST API v2, sin bots) para Universo Abierto',
    html: `<p>Estimado equipo editorial de Universo Abierto,</p>
<p>Leí con mucho interés su artículo sobre herramientas para vídeos y reuniones académicas (<a href="https://universoabierto.org/2025/04/10/como-obtener-la-transcripcion-de-un-video-de-youtube-con-inteligencia-artificial/">universoabierto.org/2025/04/10/como-obtener-la-transcripcion-de-un-video-de-youtube-con-inteligencia-artificial/</a>), donde mencionan la extensión Tactiq.</p>
<p>Para docentes, bibliotecarios y formadores universitarios que imparten seminarios en Google Meet y necesitan registrar la asistencia sin bots intrusivos y cumpliendo con el RGPD, he desarrollado <a href="https://attendancetracker.dev">Attendance Tracker para Google Meet</a>:</p>
<ul>
  <li><strong>Guía en Español (API REST v2 oficial de Google Meet):</strong> <a href="https://attendancetracker.dev/asistencia-google-meet.html">Control de Asistencia en Google Meet</a> (funciona en el panel lateral de Meet sin grabar audio ni vídeo).</li>
  <li><strong>Educación Superior y Seminarios:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-universities.html">Google Meet Attendance for Universities</a> (exportación directa a Google Sheets y CSV).</li>
</ul>
<p>¿Les parecería interesante compartir este recurso con su comunidad académica? Con gusto puedo activar licencias Pro gratuitas para sus colaboradores.</p>
<p>Un cordial saludo,<br>
<strong>Derek Gallardo</strong><br>
Fundador y Desarrollador, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 11,
    name: 'CIEC Education Colombia',
    to: ['info@ciec.edu.co'],
    cc: ['comunicaciones@ciec.edu.co'],
    subject: 'Complemento oficial de asistencia en Google Meet (sin bots) para los colegios de la CIEC',
    html: `<p>Estimado equipo de la CIEC (Confederación Interamericana de Educación Católica),</p>
<p>Leí su excelente artículo <em>Estas apps con IA son ideales para mejorar la productividad de los equipos directivos</em> (<a href="https://ciec.edu.co/estas-apps-con-ia-son-ideales-para-mejorar-la-productividad-de-los-equipos-directivos/">ciec.edu.co/estas-apps-con-ia-son-ideales-para-mejorar-la-productividad-de-los-equipos-directivos/</a>), donde recomiendan Tactiq para reuniones en Google Meet.</p>
<p>Para los equipos directivos y docentes de colegios y universidades que necesitan llevar el control de asistencia en Google Meet sin introducir bots externos y protegiendo la privacidad estudiantil, creé <a href="https://attendancetracker.dev">Attendance Tracker para Google Meet</a>:</p>
<ul>
  <li><strong>Guía en Español (API REST v2 de Google Meet):</strong> <a href="https://attendancetracker.dev/asistencia-google-meet.html">Control de Asistencia en Google Meet</a> (combina reconexiones automáticamente y exporta a Google Sheets en 1 clic).</li>
  <li><strong>Especial para Docentes y Colegios:</strong> <a href="https://attendancetracker.dev/attendance-tracker-for-teachers.html">Attendance Tracker for Teachers</a>.</li>
</ul>
<p>Estaría encantado de ofrecer acceso Pro gratuito para su equipo y de que puedan incluir esta herramienta en sus recursos tecnológicos para instituciones educativas.</p>
<p>Atentamente,<br>
<strong>Derek Gallardo</strong><br>
Fundador y Desarrollador, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 12,
    name: 'Teclab Instituto Técnico Superior Argentina',
    to: ['info@teclab.edu.ar'],
    cc: ['alumnos@teclab.edu.ar'],
    subject: 'Complemento oficial de asistencia en Google Meet (REST API v2) para el blog de Teclab',
    html: `<p>Hola equipo editorial y académico de Teclab,</p>
<p>Leí su nota <em>Cómo funciona la inteligencia artificial en la educación</em> (<a href="https://teclab.edu.ar/tecnologia-y-desarrollo/como-funciona-la-inteligencia-artificial-en-la-educacion/">teclab.edu.ar/tecnologia-y-desarrollo/como-funciona-la-inteligencia-artificial-en-la-educacion/</a>), donde mencionan Tactiq para clases virtuales.</p>
<p>Como complemento ideal para profesores y tutores de educación superior que dictan clases en vivo por Google Meet, desarrollé <a href="https://attendancetracker.dev">Attendance Tracker para Google Meet</a>, una aplicación nativa de Google Workspace Marketplace basada en la <strong>API REST v2 oficial de Google Meet</strong>:</p>
<ul>
  <li><strong>Control de Asistencia en Español:</strong> <a href="https://attendancetracker.dev/asistencia-google-meet.html">Cómo Tomar Asistencia en Google Meet Automáticamente</a> (registra entradas, salidas y minutos netos de conexión sin bots).</li>
  <li><strong>Para Institutos y Universidades:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-universities.html">Google Meet Attendance for Universities</a>.</li>
</ul>
<p>Si actualizan su artículo o desean probarlo en sus cátedras virtuales, con gusto activo cuentas Pro gratuitas para el equipo docente de Teclab.</p>
<p>Saludos cordiales,<br>
<strong>Derek Gallardo</strong><br>
Fundador y Desarrollador, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 13,
    name: 'The Wild RX Remote Work',
    to: ['hello@thewildrx.com'],
    cc: ['contact@thewildrx.com'],
    subject: 'Google Meet reconnect-merging attendance add-on for The Wild RX’s remote work guide',
    html: `<p>Hi there,</p>
<p>I enjoyed your practical guide <em>Reliable Internet for Working Remotely from an RV</em> (<a href="https://www.thewildrx.com/2025/07/reliable-internet-for-working-remotely-from-an-rv/">thewildrx.com/2025/07/reliable-internet-for-working-remotely-from-an-rv/</a>), where you referenced Tactiq's video call data usage guide.</p>
<p>For remote workers and team leads dealing with mobile or satellite connections on Google Meet calls, I built <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a> on the official <strong>Google Meet REST API v2</strong>:</p>
<ul>
  <li><strong>Automatic Reconnect Merging:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html">Google Meet Attendance for Remote Teams</a> (if a participant's connection drops and reconnects, it automatically merges their intervals into a single clean row with zero bandwidth-heavy meeting bots).</li>
  <li><strong>Lightweight Side-Panel Workflow:</strong> <a href="https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html">How to Track Attendance in Google Meet</a>.</li>
</ul>
<p>If you ever update your remote work resources, I'd love for you to check it out—and I'm happy to share a free lifetime Pro pass!</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 14,
    name: 'Crawlora',
    to: ['hello@crawlora.net'],
    cc: ['support@crawlora.net'],
    subject: 'Native Google Meet REST API v2 add-on for Crawlora’s tools & workflow directory',
    html: `<p>Hi Crawlora Team,</p>
<p>I noticed your tools page (<a href="https://crawlora.net/tools/youtube-transcript-extractor">crawlora.net/tools/youtube-transcript-extractor</a>) links to Tactiq for browser-based transcript and meeting utilities.</p>
<p>If you feature Google Workspace or Chrome productivity tools on Crawlora, I'd love to share <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>—a zero-bot Google Workspace Marketplace add-on engineered on the official <strong>Google Meet REST API v2</strong>:</p>
<ul>
  <li><strong>API v2 vs. DOM Scrapers:</strong> <a href="https://attendancetracker.dev/best-google-meet-attendance-extensions.html">Best Google Meet Attendance Extensions (2026)</a>.</li>
  <li><strong>1-Click Google Sheets Export:</strong> <a href="https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html">Export Google Meet Attendance to Google Sheets</a>.</li>
</ul>
<p>Happy to provide a free lifetime Pro license for your team if you'd like to review or list it on Crawlora.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 15,
    name: 'AI News Base',
    to: ['contact@ainewsbase.com'],
    cc: ['hello@ainewsbase.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for AI News Base’s Best Tools guide',
    html: `<p>Hi AI News Base Editorial Team,</p>
<p>I came across your roundup <em>50+ Best AI Tools</em> (<a href="https://ainewsbase.com/best-ai-tools-2023-artificial-intelligence-uses/">ainewsbase.com/best-ai-tools-2023-artificial-intelligence-uses/</a>), where you highlighted Tactiq for Google Meet users.</p>
<p>For readers who want automated Google Meet attendance tracking and Google Sheets reports without a recording bot joining their call, I built <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>:</p>
<ul>
  <li><strong>2026 Comparison Guide:</strong> <a href="https://attendancetracker.dev/best-google-meet-attendance-extensions.html">Best Google Meet Attendance Extensions</a> (compares legacy DOM extensions and bots against the official <strong>Google Meet REST API v2</strong>).</li>
  <li><strong>How It Works:</strong> <a href="https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html">How to Track Attendance in Google Meet</a>.</li>
</ul>
<p>If you're refreshing your productivity tools list for 2026, I'd be grateful if you considered including Attendance Tracker, and I can gladly share a free Pro license for your editors.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 16,
    name: 'AITNews',
    to: ['info@aitnews.com'],
    cc: ['contact@aitnews.com'],
    subject: 'Official Google Meet REST API v2 add-on (with full Arabic UI) for AITNews’s Google Meet coverage',
    html: `<p>Hello AITNews Editorial Team (تحية طيبة لفريق البوابة العربية للأخبار التقنية),</p>
<p>I read your dedicated Google Meet productivity article <em>أدوات ذكاء اصطناعي لتدوين الملاحظات في Google Meet</em> (<a href="https://aitnews.com/2024/12/23/%D8%A3%D8%AF%D9%88%D8%A7%D8%AA-%D8%B0%D9%83%D8%A7%D8%A1-%D8%A7%D8%B5%D8%B7%D9%86%D8%A7%D8%B9%D9%8A-%D9%84%D8%AA%D8%AF%D9%88%D9%8A%D9%86-%D8%A7%D9%84%D9%85%D9%84%D8%A7%D8%AD%D8%B8%D8%A7%D8%AA-%D9%81/">aitnews.com/2024/12/23/...</a>), where you featured Tactiq for Google Meet users across the MENA region.</p>
<p>For educators, universities, and remote teams in the Arab world who need automated Google Meet attendance tracking with <strong>full native Arabic (العربية) and English UI support</strong>—and without a third-party recording bot joining the call—I built <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>:</p>
<ul>
  <li><strong>Official Google Meet REST API v2 Architecture:</strong> <a href="https://attendancetracker.dev/best-google-meet-attendance-extensions.html">Best Google Meet Attendance Extensions</a> (runs natively inside the Google Meet side panel with zero audio recording).</li>
  <li><strong>1-Click Google Sheets &amp; CSV Reports:</strong> <a href="https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html">How to Track Attendance in Google Meet</a>.</li>
</ul>
<p>If your editorial team covers Google Meet add-ons for educators and enterprises, I'd be honored to provide free lifetime Pro workspace passes for AITNews journalists to test.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 17,
    name: 'AIR Creators Ecosystem',
    to: ['support@air.io'],
    cc: ['hello@air.io'],
    subject: 'Zero-bot Google Meet webinar & workshop attendance add-on for AIR.io’s blog',
    html: `<p>Hi AIR Creators Editorial Team,</p>
<p>I enjoyed your creator workflow guide <em>7 Script Writing Tools for YouTubers</em> (<a href="https://air.io/en/ai-tools/7-script-writing-tools-for-youtubers">air.io/en/ai-tools/7-script-writing-tools-for-youtubers</a>), where you highlighted Tactiq for collaborative calls and transcripts.</p>
<p>Many creators and community managers run live workshops, cohort courses, and team production calls on Google Meet and need an automatic attendance roster without an intrusive recording bot. To solve that, I built <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>:</p>
<ul>
  <li><strong>Creator Workshops &amp; Live Cohorts:</strong> <a href="https://attendancetracker.dev/track-attendance-for-webinars-and-training-google-meet.html">Track Attendance for Webinars and Training in Google Meet</a> (built on the official <strong>Google Meet REST API v2</strong>).</li>
  <li><strong>Distributed Production Teams:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html">Google Meet Attendance for Remote Teams</a>.</li>
</ul>
<p>If you ever cover live workshop or remote team tools on the AIR blog, I'd be happy to share a free lifetime Pro license for your team.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 18,
    name: 'AI For Everyone',
    to: ['hello@aiforeveryone.org'],
    cc: ['info@aiforeveryone.org'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for AI For Everyone’s directory',
    html: `<p>Hi AI For Everyone Team,</p>
<p>I saw that your directory (<a href="https://aiforeveryone.org/">aiforeveryone.org</a>) lists Tactiq among your recommended free meeting productivity tools.</p>
<p>For educators, non-profits, and remote teams who want a free, privacy-first way to track Google Meet attendance without a recording bot entering the meeting, I built <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>:</p>
<ul>
  <li><strong>Official Google Meet REST API v2:</strong> <a href="https://attendancetracker.dev/best-google-meet-attendance-extensions.html">Best Google Meet Attendance Extensions</a> (lives natively inside the Google Meet side panel, zero audio recording).</li>
  <li><strong>Free Core Tier + Instant Exports:</strong> <a href="https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html">How to Track Attendance in Google Meet</a> (1-click CSV, Excel, and Google Sheets export).</li>
</ul>
<p>Would you be open to adding Attendance Tracker to your directory? Happy to provide a complimentary Pro account for your editors to review.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 19,
    name: 'Aiarty',
    to: ['support@aiarty.com'],
    cc: ['marketing@aiarty.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for Aiarty’s Knowledge Base',
    html: `<p>Hi Aiarty Editorial Team,</p>
<p>I was reading your knowledge-base article <em>Best 6 YouTube Transcript Generators</em> (<a href="https://www.aiarty.com/knowledge-base/youtube-transcript-generator.htm">aiarty.com/knowledge-base/youtube-transcript-generator.htm</a>), where you covered Tactiq's browser extension.</p>
<p>If your team also writes about Google Workspace or online meeting utilities, I built <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>—an official Google Workspace Marketplace add-on powered by the <strong>Google Meet REST API v2</strong>:</p>
<ul>
  <li><strong>Zero-Bot Attendance Tracking:</strong> <a href="https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html">How to Track Attendance in Google Meet</a> (captures exact join/leave times and net duration natively inside the Meet side panel).</li>
  <li><strong>Automated Google Sheets Sync:</strong> <a href="https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html">Export Google Meet Attendance to Google Sheets</a>.</li>
</ul>
<p>Happy to provide a free Pro workspace license if your writers would like to test it for future guides!</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 20,
    name: 'RecCloud Japan',
    to: ['support@reccloud.com'],
    cc: ['marketing@reccloud.com'],
    subject: 'RecCloudブログ記事へのご提案：ボット不要の公式Google Meet出席管理アドオン（日本語完全対応）',
    html: `<p>RecCloud 編集部ご担当者様</p>
<p>突然のご連絡にて失礼いたします。貴社ブログの『YouTube文字起こしをダウンロードする方法』（<a href="https://reccloud.com/jp/download-transcript-youtube-video.html">reccloud.com/jp/download-transcript-youtube-video.html</a>）にて、Google Meet向けツールとしてTactiqが紹介されているのを拝見いたしました。</p>
<p>RecCloud様のAI音声・動画文字起こしツールと競合しない、100%出席管理特化の公式Google Workspace Marketplaceアドオン「<a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>」を開発しております（日本語UI完全対応）：</p>
<ul>
  <li><strong>公式Google Meet REST API v2採用（ボット不要）：</strong> 会議に外部ボットを入室させず、音声録音も一切行わずに、参加者の入退室時刻と滞在時間をGoogle Meetのサイドパネル内で自動記録します（<a href="https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html">How to Track Attendance in Google Meet</a>）。</li>
  <li><strong>Googleスプレッドシートへワンクリック出力：</strong> <a href="https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html">Export Google Meet Attendance to Google Sheets</a>。</li>
</ul>
<p>Web会議やオンライン授業の効率化ツールに関する記事にて、ぜひ補足リソースとしてご検討いただけますと幸いです。ご希望がございましたら、編集部様向けに無料のProライセンスを発行いたします。</p>
<p>何卒よろしくお願い申し上げます。<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 21,
    name: 'WebCatalog',
    to: ['support@webcatalog.io'],
    cc: ['hello@webcatalog.io'],
    subject: 'Adding Attendance Tracker (Google Meet REST API v2) to WebCatalog’s app directory',
    html: `<p>Hi WebCatalog Team,</p>
<p>I noticed your app directory page for Tactiq (<a href="https://webcatalog.io/en/apps/tactiq">webcatalog.io/en/apps/tactiq</a>) helps desktop and Google Workspace users discover meeting productivity apps.</p>
<p>I'm the developer of <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>, an official Google Workspace Marketplace add-on and web dashboard (` +
      '`app.attendancetracker.dev`' +
      `) built on the <strong>Google Meet REST API v2</strong>:</p>
<ul>
  <li><strong>Why Users Switch from DOM Extensions:</strong> <a href="https://attendancetracker.dev/best-google-meet-attendance-extensions.html">Best Google Meet Attendance Extensions (2026)</a> (zero meeting bots, automatic reconnect merging, and 44-language support).</li>
  <li><strong>Quick Setup &amp; Export Guide:</strong> <a href="https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html">How to Track Attendance in Google Meet</a>.</li>
</ul>
<p>Would you be open to listing Attendance Tracker in the WebCatalog directory or linking to it as a related Google Meet app? Happy to share any icons, metadata, or a free Pro license for your team.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 22,
    name: 'MyEssayWriter AI',
    to: ['support@myessaywriter.ai'],
    cc: ['hello@myessaywriter.ai'],
    subject: 'Zero-bot Google Meet attendance add-on for MyEssayWriter.ai’s 100+ Tools Directory',
    html: `<p>Hi MyEssayWriter Editorial Team,</p>
<p>I was browsing your <em>Best 100+ AI Tools Online - All AI Tools Directory</em> (<a href="https://www.myessaywriter.ai/blog/best-ai-tools-online">myessaywriter.ai/blog/best-ai-tools-online</a>), where you featured Tactiq for students and educators on Google Meet.</p>
<p>For university lecturers, teaching assistants, and student study groups who need automatic Google Meet attendance sheets without a recording bot joining the session, I built <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>:</p>
<ul>
  <li><strong>University Lectures &amp; Seminars:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-universities.html">Google Meet Attendance for Universities</a> (built on the official <strong>Google Meet REST API v2</strong>, FERPA/GDPR-friendly with zero audio recording).</li>
  <li><strong>2026 Comparison Guide:</strong> <a href="https://attendancetracker.dev/best-google-meet-attendance-extensions.html">Best Google Meet Attendance Extensions</a>.</li>
</ul>
<p>If you update your online tools directory, I'd love for you to include Attendance Tracker, and I'm happy to provide a free Pro account for your editorial team.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 23,
    name: 'AppsInsight',
    to: ['hello@appsinsight.co'],
    cc: ['appsinsightofficial@gmail.com'],
    subject: 'Native Google Meet REST API v2 add-on for AppsInsight’s productivity coverage',
    html: `<p>Hi AppsInsight Editorial Team,</p>
<p>I enjoyed reading your article <em>Top AI Tools For Note Taking: Maximize Your Productivity</em> (<a href="https://appsinsight.co/ai-tools-for-note-taking/">appsinsight.co/ai-tools-for-note-taking/</a>), where you reviewed Tactiq for Google Meet calls.</p>
<p>I'm the founder of <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>, an official Google Workspace Marketplace add-on engineered on the <strong>Google Meet REST API v2</strong> for teams and educators who want exact attendance rosters without a recording bot:</p>
<ul>
  <li><strong>Architecture Comparison:</strong> <a href="https://attendancetracker.dev/best-google-meet-attendance-extensions.html">Best Google Meet Attendance Extensions (2026)</a>.</li>
  <li><strong>Remote Teams &amp; Standups:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html">Google Meet Attendance for Remote Teams</a> (1-click Google Sheets sync and automatic reconnect merging).</li>
</ul>
<p>Would you consider featuring or linking to Attendance Tracker in your productivity guides? Happy to activate a free lifetime Pro workspace license for your reviewers.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 24,
    name: 'Inc. Arabia',
    to: ['editorial@incarabia.com'],
    cc: ['info@incarabia.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on (with Arabic & English UI) for Inc. Arabia',
    html: `<p>Dear Inc. Arabia Editorial Team,</p>
<p>I enjoyed your feature <em>10 AI Tools Every Busy Professional Should Use</em> (<a href="https://en.incarabia.com/ten-ai-tools-every-busyprofessional-should-use-625570.html">en.incarabia.com/ten-ai-tools-every-busyprofessional-should-use-625570.html</a>), which highlighted Tactiq for Google Meet users.</p>
<p>For executives, HR leaders, and educators across the MENA region who run meetings on Google Meet and need automated attendance rosters without an external recording bot joining sensitive calls, I built <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a> (fully localized in both English and Arabic):</p>
<ul>
  <li><strong>Executive &amp; Remote Team Governance:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html">Google Meet Attendance for Remote Teams</a> (powered by the official <strong>Google Meet REST API v2</strong> with zero audio capture).</li>
  <li><strong>2026 Enterprise Comparison:</strong> <a href="https://attendancetracker.dev/best-google-meet-attendance-extensions.html">Best Google Meet Attendance Extensions</a>.</li>
</ul>
<p>If your team covers Google Workspace productivity tools, I'd be delighted to provide complimentary Pro workspace passes for your editors.</p>
<p>Sincerely,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 25,
    name: 'VCGamers Indonesia',
    to: ['support@vcgamers.com'],
    cc: ['media@vcgamers.com'],
    subject: 'Add-on Absensi Google Meet Resmi (REST API v2, Bahasa Indonesia) untuk Artikel VCGamers',
    html: `<p>Halo Tim Editorial VCGamers,</p>
<p>Saya membaca artikel tutorial teknologi Anda (<a href="https://www.vcgamers.com/news/cara-transkrip-video-youtube-online-praktis/">vcgamers.com/news/cara-transkrip-video-youtube-online-praktis/</a>) yang menyebutkan ekstensi Tactiq untuk pengguna Chrome dan Google Meet.</p>
<p>Untuk guru, dosen, dan tim kerja di Indonesia yang membutuhkan daftar hadir (absensi) otomatis di Google Meet tanpa bot perekam dan sudah mendukung <strong>Bahasa Indonesia</strong> sepenuhnya, saya mengembangkan <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>:</p>
<ul>
  <li><strong>Panduan Khusus Pengajar Indonesia:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-indonesia-teachers.html">Cara Absen di Google Meet Otomatis untuk Guru &amp; Dosen Indonesia</a> (berbasis <strong>Google Meet REST API v2</strong> resmi di panel samping Meet).</li>
  <li><strong>Ekspor 1-Klik ke Google Sheets &amp; Excel:</strong> <a href="https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html">How to Track Attendance in Google Meet</a>.</li>
</ul>
<p>Jika tim VCGamers membuat artikel seputar tips Google Meet atau produktivitas kuliah/kerja online, saya dengan senang hati memberikan akses Pro gratis untuk tim redaksi Anda.</p>
<p>Salam hangat,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 26,
    name: 'Toolbit AI',
    to: ['contact@toolbit.ai'],
    cc: ['hello@toolbit.ai'],
    subject: 'Adding Attendance Tracker (Google Meet REST API v2) to Toolbit AI’s directory',
    html: `<p>Hi Toolbit AI Team,</p>
<p>I saw your review page <em>Tactiq: Reviews, Features, Pricing, Alternatives</em> (<a href="https://www.toolbit.ai/ai-tool/tactiq-io">toolbit.ai/ai-tool/tactiq-io</a>) and wanted to reach out with a complementary Google Meet tool for your directory.</p>
<p>I'm the developer of <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>, an official Google Workspace Marketplace add-on built on the <strong>Google Meet REST API v2</strong> that tracks participant join/leave times and exports directly to Google Sheets without a meeting bot:</p>
<ul>
  <li><strong>2026 Alternatives &amp; Comparison:</strong> <a href="https://attendancetracker.dev/best-google-meet-attendance-extensions.html">Best Google Meet Attendance Extensions</a>.</li>
  <li><strong>Step-by-Step Guide:</strong> <a href="https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html">How to Track Attendance in Google Meet</a>.</li>
</ul>
<p>Would you be open to listing Attendance Tracker on Toolbit AI or linking to it in your Google Meet alternatives section? Happy to provide a free lifetime Pro license for your team.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 27,
    name: 'BibiGPT',
    to: ['hi@bibigpt.co'],
    cc: ['support@bibigpt.co'],
    subject: 'Non-competing Google Meet attendance link for BibiGPT’s lecture guide',
    html: `<p>Hi BibiGPT Team,</p>
<p>I was reading your student guide <em>Zoom Lecture Recording AI Summary: Exam Study Notes (2026)</em> (<a href="https://bibigpt.co/en/blog/posts/zoom-lecture-recording-ai-summary-notes-guide">bibigpt.co/en/blog/posts/zoom-lecture-recording-ai-summary-notes-guide</a>) and noticed an outbound link to rival AI summary tool <code>tactiq.io</code>.</p>
<p>Since Tactiq competes directly with BibiGPT on video/meeting transcripts and AI study notes, you might prefer linking to a 100% non-competing academic utility when referencing live lecture attendance: <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>.</p>
<ul>
  <li><strong>University Lectures &amp; Labs:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-universities.html">Google Meet Attendance for Universities</a> (tracks student join/leave times via the official <strong>Google Meet REST API v2</strong> with zero audio recording or note generation).</li>
  <li><strong>Classroom Guide:</strong> <a href="https://attendancetracker.dev/attendance-tracker-for-teachers.html">Attendance Tracker for Teachers</a>.</li>
</ul>
<p>Happy to share a free Pro workspace pass if your team would like to test it or swap in a non-competing link!</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 28,
    name: 'Gadgets To Use India',
    to: ['admin@gadgetstouse.com'],
    cc: ['support@gadgetstouse.com'],
    subject: 'Zero-bot Google Meet REST API v2 add-on for Gadgets To Use’s Google Meet tutorials',
    html: `<p>Hi Gadgets To Use Editorial Team,</p>
<p>I read your tutorial (<a href="https://gadgetstouse.com/blog/2024/10/30/transcribe-youtube-videos-online/">gadgetstouse.com/blog/2024/10/30/transcribe-youtube-videos-online/</a>) where you covered the Tactiq Chrome extension.</p>
<p>Since your readers frequently look for practical Google Meet and Chrome tips, I wanted to share <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>—an official Google Workspace Marketplace add-on that uses the <strong>Google Meet REST API v2</strong> to record attendance automatically without a bot:</p>
<ul>
  <li><strong>Step-by-Step Google Meet Guide:</strong> <a href="https://attendancetracker.dev/how-to-track-attendance-in-google-meet.html">How to Track Attendance in Google Meet</a> (includes 1-click Google Sheets and CSV export, plus Hindi &amp; English UI).</li>
  <li><strong>Extension vs. Add-On Comparison:</strong> <a href="https://attendancetracker.dev/best-google-meet-attendance-extensions.html">Best Google Meet Attendance Extensions (2026)</a>.</li>
</ul>
<p>If your writers cover Google Meet tips for teachers or remote workers, I'd be happy to activate free lifetime Pro licenses for your editorial team to test.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 29,
    name: 'Ringover Spain',
    to: ['contacto@ringover.es'],
    cc: ['marketing@ringover.es'],
    subject: 'Complemento oficial de asistencia en Google Meet (REST API v2, sin bots) para el blog de Ringover',
    html: `<p>Hola equipo editorial de Ringover España,</p>
<p>Leí su artículo <em>Automatiza tus Actas de Reunión con Inteligencia Artificial</em> (<a href="https://www.ringover.es/blog/actas-de-reuniones-con-ia">ringover.es/blog/actas-de-reuniones-con-ia</a>), donde mencionan Tactiq para reuniones en Google Meet.</p>
<p>Dado que Tactiq compite en transcripción y resúmenes de llamadas, quería presentarles un recurso 100% complementario y no competidor enfocado exclusivamente en el control de asistencia en Google Meet: <a href="https://attendancetracker.dev">Attendance Tracker para Google Meet</a>.</p>
<ul>
  <li><strong>Guía en Español (API REST v2 oficial de Google Meet):</strong> <a href="https://attendancetracker.dev/asistencia-google-meet.html">Control de Asistencia en Google Meet</a> (sin bots externos ni grabación de voz, cumpliendo con el RGPD).</li>
  <li><strong>Para Equipos Remotos y Formaciones:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html">Google Meet Attendance for Remote Teams</a> (exportación en 1 clic a Google Sheets).</li>
</ul>
<p>Si actualizan sus guías de productividad en Google Meet, estaré encantado de facilitarles una licencia Pro gratuita para su equipo.</p>
<p>Un cordial saludo,<br>
<strong>Derek Gallardo</strong><br>
Fundador y Desarrollador, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
  {
    id: 30,
    name: 'Futuramo',
    to: ['hello@futuramo.com'],
    cc: ['partnerships@futuramo.com'],
    subject: 'Native Google Meet REST API v2 add-on for Futuramo’s 2026 Team Collaboration guide',
    html: `<p>Hi Futuramo Editorial Team,</p>
<p>I enjoyed your article <em>Team Collaboration in 2026: Tools, Trends &amp; What Works</em> (<a href="https://futuramo.com/blog/ai-workspaces-and-leading-collaboration-tools/">futuramo.com/blog/ai-workspaces-and-leading-collaboration-tools/</a>), especially your coverage of Tactiq for Google Meet collaboration.</p>
<p>For distributed teams that run daily standups, client workshops, and training on Google Meet and want automated attendance rosters without an external recording bot, I built <a href="https://attendancetracker.dev">Attendance Tracker for Google Meet</a>:</p>
<ul>
  <li><strong>Remote Team Rituals &amp; Standups:</strong> <a href="https://attendancetracker.dev/google-meet-attendance-for-remote-teams.html">Google Meet Attendance for Remote Teams</a> (powered by the official <strong>Google Meet REST API v2</strong> inside the Meet side panel).</li>
  <li><strong>1-Click Google Sheets Sync:</strong> <a href="https://attendancetracker.dev/export-google-meet-attendance-to-sheets.html">Export Google Meet Attendance to Google Sheets</a>.</li>
</ul>
<p>If you're open to adding a dedicated Google Meet attendance tool to your 2026 collaboration guide, I'd be happy to share a free lifetime Pro workspace license for your team.</p>
<p>Best regards,<br>
<strong>Derek Gallardo</strong><br>
Founder &amp; Developer, <a href="https://attendancetracker.dev">Attendance Tracker</a></p>`,
  },
];

function loadDispatchLog() {
  if (fs.existsSync(LOG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    } catch {
      return {};
    }
  }
  return {};
}

function saveDispatchLog(log) {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2), 'utf8');
}

async function sendEmail({ to, cc, subject, html, isTest }) {
  if (!RESEND_API_KEY) {
    throw new Error('Missing RESEND_API_KEY in environment or .env');
  }
  const payload = {
    from: FROM_EMAIL,
    to: isTest ? [TEST_TO_EMAIL] : to,
    reply_to: REPLY_TO,
    subject: isTest ? `[TEST PREVIEW] ${subject}` : subject,
    html,
  };
  if (!isTest && cc && cc.length > 0) {
    payload.cc = cc;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Resend API error (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const isTest = args.includes('--test');
  const isSend = args.includes('--send');
  const isAll = args.includes('--all');
  const isForce = args.includes('--force');

  const targetArg = args.find((a) => a.startsWith('--target='));
  const targetId = targetArg ? parseInt(targetArg.split('=')[1], 10) : null;

  if (!isDryRun && !isTest && !isSend) {
    console.log('Usage:');
    console.log('  node scripts/send-wave23-outreach.cjs --dry-run');
    console.log('  node scripts/send-wave23-outreach.cjs --test --target=1');
    console.log('  node scripts/send-wave23-outreach.cjs --send --target=1');
    console.log('  node scripts/send-wave23-outreach.cjs --send --all');
    process.exit(1);
  }

  let selectedTargets = [];
  if (isAll) {
    selectedTargets = TARGETS;
  } else if (targetId) {
    const found = TARGETS.find((t) => t.id === targetId);
    if (!found) {
      console.error(`Target #${targetId} not found (valid: 1-${TARGETS.length}).`);
      process.exit(1);
    }
    selectedTargets = [found];
  } else if (isDryRun) {
    selectedTargets = TARGETS;
  } else {
    console.error('Please specify --target=N or --all.');
    process.exit(1);
  }

  const dispatchLog = loadDispatchLog();

  for (let i = 0; i < selectedTargets.length; i++) {
    const t = selectedTargets[i];
    const logKey = `target_${t.id}`;

    console.log('\n==================================================');
    console.log(`Target #${t.id}: ${t.name}`);
    console.log(`From:     ${FROM_EMAIL}`);
    console.log(`Reply-To: ${REPLY_TO}`);
    console.log(`To:       ${t.to.join(', ')}`);
    if (t.cc && t.cc.length) console.log(`CC:       ${t.cc.join(', ')}`);
    console.log(`Subject:  ${t.subject}`);
    console.log('==================================================');

    if (isDryRun) {
      console.log(t.html);
      continue;
    }

    if (isTest) {
      console.log(`[TEST MODE] Sending preview of Target #${t.id} (${t.name}) to Derek's inbox: ${TEST_TO_EMAIL}`);
      const res = await sendEmail({ ...t, isTest: true });
      console.log(`Preview email dispatched! Resend ID: ${res.id}`);
      if (i < selectedTargets.length - 1) await sleep(1500);
      continue;
    }

    if (isSend) {
      if (dispatchLog[logKey] && !isForce) {
        console.log(
          `[SKIPPED] Target #${t.id} (${t.name}) was already dispatched on ${dispatchLog[logKey].dispatchedAt} (ID: ${dispatchLog[logKey].resendId}). Use --force to re-send.`
        );
        continue;
      }

      console.log(`[SENDING] Dispatching to ${t.to.join(', ')}...`);
      const res = await sendEmail({ ...t, isTest: false });
      console.log(`[SUCCESS] Dispatched Target #${t.id}! Resend ID: ${res.id}`);

      dispatchLog[logKey] = {
        targetId: t.id,
        name: t.name,
        to: t.to,
        cc: t.cc || [],
        subject: t.subject,
        dispatchedAt: new Date().toISOString(),
        resendId: res.id,
      };
      saveDispatchLog(dispatchLog);

      if (i < selectedTargets.length - 1) {
        await sleep(2000);
      }
    }
  }

  console.log('\nAll done.');
}

main().catch((err) => {
  console.error('\n[ERROR]', err.message);
  process.exit(1);
});
