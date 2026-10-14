# Community, LMS Forum & Technical Backlink Kit (Tracks 5, 6 & Self-Serve Directories)

This document contains publication-ready assets for **Track 6** (Dev.to / Hashnode / Hacker News technical deep-dive), **Track 5** (Canvas Community DR 88 & Moodle Forum DR 90 step-by-step educator guides), and **Part 3** (8 high-DR self-serve software & indie developer directories extracted from competitor Ahrefs backlink exports).

---

## Part 1: Track 6 — Dev.to / Hashnode / Hacker News ("Show HN") Technical Article

### Publishing Checklist & Frontmatter
- **Dev.to**: [https://dev.to/new](https://dev.to/new)
- **Hashnode**: [https://hashnode.com/draft](https://hashnode.com/draft)
- **Hacker News ("Show HN")**: [https://news.ycombinator.com/submit](https://news.ycombinator.com/submit)
  - **HN Title**: `Show HN: Why Chrome extensions break on Google Meet, and 3 Meet iframe sandbox traps`
  - **HN URL / Text**: Link to the canonical blog or paste the technical post below.

```markdown
---
title: "Why Chrome Extensions Keep Breaking on Google Meet — And 3 Undocumented Iframe Sandbox Traps in the Google Meet REST API v2"
published: true
description: "How Material 3 DOM churn broke legacy Google Meet attendance extensions, how conferenceRecords.participants.participantSessions works in Meet REST API v2, and the 3 iframe sandbox traps we hit building a native Google Meet Side Panel add-on."
tags: googleworkspace, javascript, webdev, chromeextensions
canonical_url: https://attendancetracker.dev/google-meet-attendance-extension-broken.html
---

If you have ever built—or relied on—a Chrome extension for Google Meet, you already know the cycle: everything works fine for six months, Google pushes a silent Material 3 UI rollout on a Tuesday night, and by Wednesday morning thousands of teachers and team leads are staring at broken buttons or infinite `"First join a meeting"` error loops.

Over the past year, almost every legacy Google Meet attendance extension from the 2020–2022 era (such as Clay Codes' *Meet Attendance* or *Attendance for Google Meet*) either broke completely or was abandoned. We wrote a full post-mortem on why those extensions stopped working at [Google Meet Attendance Extension Broken? Here's Why](https://attendancetracker.dev/google-meet-attendance-extension-broken.html).

When we set out to build [Attendance Tracker](https://attendancetracker.dev), we decided to skip client-side DOM scraping entirely and build a native **Google Workspace Marketplace Add-on** using the official **Google Meet REST API v2** and the **Google Meet Add-ons SDK**.

Moving from a `content_script` scraper to an official side-panel iframe inside Google Meet solved the fragility problem—but it introduced three undocumented iframe sandbox traps and a subtle multi-tenant OAuth privilege-escalation hazard that aren't mentioned anywhere in Google's quickstart guides. Here is everything we learned the hard way.

---

### 1. Why DOM Scrapers Die on Material 3 Updates (`"First join a meeting"` Loops)

Legacy Chrome extensions for Google Meet all worked the same way:
1. Inject a `content_script` into `https://meet.google.com/*`.
2. Poll `document.querySelectorAll()` for obfuscated Closure/Wiz CSS classes like `.cxdMu`, `.zWGUib`, or `[data-participant-id]`.
3. Programmatically click the "People" button in the bottom bar to force Google Meet's virtualized DOM list to mount participant nodes, then scrape `innerText`.

This architecture fails for three reasons:
- **Virtualized DOM Lists**: Google Meet only renders DOM nodes for the ~12–15 participants currently visible in the scroll viewport of the People drawer. If 60 students join a lecture and the drawer is closed (or scrolled to the top), a DOM scraper literally cannot see the other 45 attendees.
- **Material 3 Class Churn & Shadow Boundaries**: Google's compiler regenerates minified class names across releases. When the selector for the "in-call" indicator changes, extensions get stuck in the infamous `"First join a meeting"` loop even while the user is actively speaking on camera.
- **Chromebook & Enterprise Policy Blocks**: School districts and enterprise Workspace admins increasingly block unverified Manifest V2/V3 extensions that request broad host permissions on `meet.google.com`.

---

### 2. Moving to Google Meet REST API v2 (`conferenceRecords.participants.participantSessions`)

Instead of reading HTML nodes from the browser tab, the **Google Meet REST API v2** exposes authoritative server-side telemetry via three hierarchical resources:

```text
conferenceRecords/{conferenceRecord}
  └── participants/{participant}
        └── participantSessions/{participantSession}
```

When a participant's Wi-Fi drops and they rejoin the call three times—or when someone joins on both their laptop and phone—Google Meet creates multiple `participantSessions` under the same `participant` resource (or multiple participant entries sharing the same `signedinUser.user` / `displayName`).

Instead of dumping messy duplicate rows into a spreadsheet, we aggregate session intervals server-side and merge overlapping or fragmented reconnects into a single clean attendee record:

```javascript
function mergeParticipantSessions(sessions, ongoingEndTime = new Date()) {
  if (!sessions || sessions.length === 0) return { firstJoin: null, lastLeave: null, totalSeconds: 0 };

  const intervals = sessions
    .map(s => {
      const start = new Date(s.startTime).getTime();
      const end = s.endTime ? new Date(s.endTime).getTime() : ongoingEndTime.getTime();
      return [start, Math.max(start, end)];
    })
    .sort((a, b) => a[0] - b[0]);

  // Merge overlapping [start, end] intervals (e.g. dual-device join or rapid reconnect)
  const merged = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = intervals[i];
    if (curr[0] <= prev[1]) {
      prev[1] = Math.max(prev[1], curr[1]);
    } else {
      merged.push(curr);
    }
  }

  const totalMs = merged.reduce((acc, [s, e]) => acc + (e - s), 0);
  return {
    firstJoin: new Date(merged[0][0]).toISOString(),
    lastLeave: new Date(merged[merged.length - 1][1]).toISOString(),
    totalSeconds: Math.round(totalMs / 1000),
    segmentCount: sessions.length
  };
}
```

Whether a meeting has 2 people or 200, and whether the host ever opens the People tab or not, the REST API returns exact timestamps straight from Google's media servers.

---

### 3. The 3 Undocumented Iframe Sandbox Traps in Google Meet Side Panels

When you build a Google Meet Add-on, your UI runs inside a cross-origin `<iframe>` embedded in Google Meet's right-hand Activities drawer. Google applies a strict `sandbox` attribute to that iframe. Three restrictions bit us immediately in production:

#### Trap #1: Missing `allow-downloads` (Anchor Downloads Silently Fail)
If a user clicks an `<a download="attendance.csv" href="blob:...">` inside the Google Meet side panel, **nothing happens**. Chrome silently blocks the download because the parent Meet iframe lacks `allow-downloads` in its sandbox token list.

**The Fix (`download.html` `postMessage` Relay)**:
You cannot trigger a file download from the iframe itself. Instead, on user click, open a lightweight top-level relay window (`window.open('/download.html', '_blank')`) on your own origin, wait for it to send a `{ type: 'RELAY_READY' }` message back via `window.opener.postMessage`, and then post the CSV payload across to the top-level tab—which *does* have download privileges and triggers the browser download before closing itself:

```javascript
function relayDownload(filename, csvContent, mimeType = 'text/csv;charset=utf-8;') {
  const relayWin = window.open('https://attendancetracker.dev/download.html', '_blank');
  if (!relayWin) return;

  const onMessage = (event) => {
    if (event.origin !== 'https://attendancetracker.dev') return;
    if (event.data && event.data.type === 'RELAY_READY') {
      window.removeEventListener('message', onMessage);
      relayWin.postMessage({ type: 'TRIGGER_DOWNLOAD', filename, csvContent, mimeType }, 'https://attendancetracker.dev');
    }
  };
  window.addEventListener('message', onMessage);
}
```

#### Trap #2: Third-Party Storage Partitioning (Isolated `localStorage`)
Since Chrome 115+, third-party storage partitioning keys `localStorage`, `sessionStorage`, and `IndexedDB` by the `(top-level site, frame origin)` tuple.
- Inside the Meet side panel, your storage key is `(https://meet.google.com, https://attendancetracker.dev)`.
- When the user opens your dashboard or OAuth popup in a top-level tab, your storage key is `(https://attendancetracker.dev, https://attendancetracker.dev)`.

**They do not share `localStorage`!** If your OAuth popup writes a JWT to `localStorage` and closes, the Meet side panel will never see it. Any cross-context handoff (OAuth tokens, checkout completion, CSV export payloads) *must* travel via `window.opener.postMessage()` rather than shared browser storage.

#### Trap #3: Missing `allow-modals` (`confirm()`, `alert()`, and `prompt()` Return `false` Instantly)
In standard web apps, `if (!window.confirm('Clear roster?')) return;` is a quick way to guard destructive actions. Inside Google Meet's side-panel iframe, `allow-modals` is not set. Calling `window.confirm()` does **not** throw an exception—it logs a console warning and immediately returns `false`, making every confirmation-guarded button in your app completely dead.

**The Fix (Two-Tap `armedConfirm()` Pattern)**:
Replace every native modal call with an inline two-tap state machine that arms a button for 3 seconds on first tap and executes on second tap:

```javascript
const armedButtons = new WeakMap();

function armedConfirm(btnElement, confirmLabel, onConfirm, timeoutMs = 3000) {
  const existingTimer = armedButtons.get(btnElement);
  if (existingTimer) {
    clearTimeout(existingTimer);
    armedButtons.delete(btnElement);
    btnElement.textContent = btnElement.dataset.originalLabel;
    btnElement.classList.remove('btn-armed');
    onConfirm();
    return;
  }

  btnElement.dataset.originalLabel = btnElement.textContent;
  btnElement.textContent = confirmLabel; // e.g., "Tap again to confirm"
  btnElement.classList.add('btn-armed');

  const timer = setTimeout(() => {
    btnElement.textContent = btnElement.dataset.originalLabel;
    btnElement.classList.remove('btn-armed');
    armedButtons.delete(btnElement);
  }, timeoutMs);

  armedButtons.set(btnElement, timer);
}
```

---

### 4. Multi-Tenant OAuth Security: Isolating `mode: 'attendee'` from Organizer Provisioning

When building a Workspace tool used by universities and K-12 school districts, users share the same Google Workspace domain (`@university.edu`).

In our app, hosts/instructors authenticate via OAuth to pull Meet API records and sync Google Classroom rosters, while students can optionally tap a 1-click "Verify My Presence" check-in button inside the panel.

Early on, we realized a critical multi-tenant trap: **if a student signs in on a fresh `@university.edu` domain before any teacher has signed up, a naive `/oauth/exchange` endpoint will provision the tenant record and make that student the organization's team admin.**

To prevent privilege escalation and unwanted side effects:
- Every OAuth flow explicitly declares its intent (`mode: 'organizer'` vs. `mode: 'attendee'`).
- When `/oauth/exchange` receives `mode: 'attendee'`, it verifies the Google ID token, mints a short-lived, read/checkin-scoped session JWT, and **immediately discards the OAuth tokens** with zero organizer side effects:
  - No user document is created in Firestore.
  - No domain tenant is initialized or claimed.
  - No onboarding or welcome emails are triggered.
- Student check-ins write exclusively to an isolated `checkins/{meetingCode}` document where the first verified tap wins and records auto-expire after 24 hours.

---

### Try It Out (Plus a Free Google Sheets Template)

If you're managing classes, webinars, or remote standups on Google Meet—or if your team was burned by legacy Chrome extensions breaking—you can check out:
- **[Attendance Tracker for Google Meet](https://attendancetracker.dev)** (Official Google Workspace Marketplace add-on, localized in 44 languages, with a free tier and 1-click Google Classroom & LMS exports).
- **[Free 1-Click Google Sheets Attendance Template](https://attendancetracker.dev/google-meet-attendance-template.html)** (Pre-built formulas for Present/Late/Absent rollups that you can copy straight into your Google Drive).
- **[Why Legacy Google Meet Attendance Extensions Broke (Technical Breakdown)](https://attendancetracker.dev/google-meet-attendance-extension-broken.html)**.

Happy to answer any questions about the Google Meet REST API v2, Workspace Marketplace verification, or debugging sandboxed iframes!
```

---

## Part 2: Track 5 — Canvas Community (DR 88) & Moodle Forum (DR 90) Guides

### 1. Instructure Canvas Community Guide (DR 88)
- **Target Forum**: [Instructure Canvas Community — Instructional Designers / Canvas Question Forum](https://community.canvaslms.com/)
- **Post Title**: `How to Export Google Meet Attendance Directly into Canvas Gradebook & Roll Call (Without Chrome Extensions)`

```markdown
If your institution uses **Google Meet** alongside **Canvas LMS**, you have probably run into a frustrating gap: Google Meet does not natively sync attendance into the Canvas Gradebook, and Google's built-in attendance CSVs (which require Workspace Education Plus/Enterprise and at least 5 attendees) are not formatted for Canvas's gradebook importer.

Meanwhile, most of the third-party Chrome extensions faculty used between 2020 and 2023 rely on browser HTML scraping and now fail whenever Google updates Meet's layout (or get blocked on managed school Chromebooks).

Here is a clean, step-by-step workflow to capture live Google Meet attendance and import it into Canvas in under 60 seconds using the official **Google Meet REST API v2**.

### Step 1: Capture the Session via the Google Meet Activities Panel
Instead of installing a local Chrome extension, install **[Attendance Tracker](https://attendancetracker.dev)** from the official Google Workspace Marketplace. Because it runs natively inside Google Meet's right-hand **Activities** side panel:
- It works on any Windows, Mac, or locked-down Chromebook.
- It automatically merges duplicate rows when students drop and rejoin a lecture.
- It works on standard Google Workspace accounts (even for small seminars or 1-on-1 office hours with fewer than 5 participants).

### Step 2: Export the Canvas-Formatted CSV
At the end of your lecture (or from your meeting history dashboard):
1. Click **Export CSV** in the Attendance Tracker panel and select **Canvas LMS Format**.
2. The exported CSV automatically structures student names, email/SIS identifiers, arrival timestamps, total duration, and Present/Late/Absent scores to match Canvas's expected Gradebook columns.

### Step 3: Upload to Canvas Gradebook
1. Open your course in Canvas and go to **Grades**.
2. Click **Actions > Import** at the top of the Gradebook.
3. Upload the exported CSV file. Canvas will match students by their institutional email/login ID and populate the attendance assignment column in one step.

### Full Visual Walkthrough & Free Template
We put together a complete faculty guide with screenshots and column mapping tips here:
- **[How to Export Google Meet Attendance to Canvas Gradebook](https://attendancetracker.dev/export-google-meet-attendance-to-canvas.html)**
- **[Free 1-Click Google Sheets Attendance Template](https://attendancetracker.dev/google-meet-attendance-template.html)**

*(Note for Faculty & Instructional Designers: There is a free tier for 5 exports/month, and we provide $4.99/yr Educator Passes as well as complimentary evaluation passes for university CTL/IT teams.)*
```

---

### 2. Moodle Community Forum Guide (DR 90)
- **Target Forum**: [Moodle.org Community Forums — General Plugins / Attendance Module](https://moodle.org/mod/forum/)
- **Post Title**: `Automating Google Meet Attendance Imports into the Moodle Attendance Activity (REST API v2 Workflow)`

```markdown
For universities and schools running **Moodle** with **Google Workspace for Education**, taking attendance in synchronous Google Meet lectures often requires manual cross-checking between post-call spreadsheets and the Moodle **Attendance (`mod_attendance`)** plugin.

Older Chrome extensions that scraped Google Meet's participant list frequently break on UI updates and violate institutional student privacy policies (FERPA / GDPR / LGPD).

Here is how instructors can bridge Google Meet sessions directly into Moodle's Attendance module using an official Google Workspace Marketplace add-on built on the **Google Meet REST API v2**.

### How the Workflow Works
1. **Open the Native Side Panel in Google Meet**: **[Attendance Tracker](https://attendancetracker.dev)** runs directly inside the Google Meet Activities panel—requiring zero client-side Chrome extensions and storing zero student PII on third-party servers.
2. **Automatic Reconnect Merging & Tardy Detection**: If a student disconnects and rejoins three times during a 60-minute lecture, the add-on merges their segments into a single row with their first arrival time, last departure time, and combined duration.
3. **1-Click Moodle CSV Export**: Select the **Moodle CSV** export option to generate a file pre-mapped for Moodle's Attendance activity import (`email` / `username`, `status` mapped to `P` / `L` / `A`, and session remarks with duration).
4. **Import into Moodle**:
   - Open your Moodle course -> **Attendance** activity -> select the session -> click **Import**.
   - Upload the generated CSV, set the identifier field to **Email address**, and confirm.

### Step-by-Step Documentation
We documented the exact Moodle status code mappings (`P`, `L`, `E`, `A`) and CSV field configurations in our open guide for Moodle administrators and teachers:
- **[How to Export Google Meet Attendance to Moodle](https://attendancetracker.dev/export-google-meet-attendance-to-moodle.html)**
- **[Attendance Tracker Official Site](https://attendancetracker.dev)** (Localized in 44 languages, including English, Spanish, Portuguese, French, German, Swedish, and Finnish).
```

---

## Part 3: 8 Self-Serve Competitor Directories (Extracted from Ahrefs CSVs)

These 8 self-serve directories actively give dofollow/indexed links to `attendlist.com` and `tactiq.io` in our Ahrefs backlink exports. Use the ready-to-paste blocks below to claim our listings immediately.

### Shared Canonical Metadata (Truth from `CLAUDE.md`)
- **Product Name**: `Attendance Tracker for Google Meet`
- **Primary URL**: `https://attendancetracker.dev`
- **Google Workspace Marketplace URL**: `https://workspace.google.com/marketplace/app/attendance_tracker/829771833968`
- **Tagline (< 60 chars)**: `Official Google Meet REST API v2 Attendance Add-on`
- **Pricing (Current Truth)**:
  - **Free Tier**: 5 exports/month (Google Sheets or CSV combined)
  - **Individual Lifetime Pass**: $9.99 one-time
  - **Educator Pass**: $4.99/year
  - **Department License**: $59/year (small-school domain plan)
  - **Institution License**: $149/year (whole-domain Google Workspace deployment)
- **Languages Supported**: 44 languages

---

### 1. Startup Fame (`startupfa.me` — DR 84)
- **Competitor Listed**: `attendlist.com`
- **Submission URL**: `https://startupfa.me/submit`
- **Category**: Productivity / Education / Google Workspace
- **Copy-Paste Description**:
  ```text
  Attendance Tracker is an official Google Workspace Marketplace add-on for Google Meet built on the native Google Meet REST API v2. Unlike brittle Chrome extensions that scrape browser HTML and break on UI updates, it runs directly inside Meet's side panel with zero extensions or recording bots. Features live Present/Late/Absent badges, automatic rejoin merging, 1-click Google Classroom roster sync, and direct exports to Google Sheets, Canvas, and Moodle across 44 languages. Free tier (5 exports/month) with a $9.99 one-time Individual Lifetime Pass and $4.99/yr Educator Pass.
  ```

### 2. Twelve Tools (`twelve.tools` — DR 83)
- **Competitor Listed**: `attendlist.com`
- **Submission URL**: `https://twelve.tools/`
- **Category**: Productivity / Remote Work / Education
- **Copy-Paste Description**:
  ```text
  Official Google Workspace Marketplace add-on that automates participant attendance and duration tracking inside Google Meet via the native REST API v2. Zero Chrome extensions, zero call bots, 1-click Google Classroom sync, automatic reconnect merging, and instant Google Sheets/CSV exports in 44 languages. Includes a free tier (5 exports/month), $9.99 one-time Lifetime Pass, and $4.99/yr Educator Pass.
  ```

### 3. Dang.ai (`dang.ai` — DR 82)
- **Competitor Listed**: `tactiq.io` (`https://dang.ai/tool/ai-meeting-and-summarization-tool-tactiq`)
- **Submission URL**: `https://dang.ai/submit`
- **Category**: Meeting Tools / Chrome & Workspace Add-ons / EdTech
- **Copy-Paste Description**:
  ```text
  Attendance Tracker is a bot-free Google Meet attendance and engagement add-on built on Google's official Meet REST API v2. Operating directly inside the Google Meet Activities side panel, it captures exact join/leave timestamps, merges multi-session reconnects, syncs Google Classroom rosters, and dispatches reports to Google Sheets, Canvas, Moodle, Slack, and Discord. Available in 44 languages with a free tier (5 exports/mo), $9.99 one-time Individual Lifetime Pass, and $4.99/yr Educator Pass.
  ```

### 4. Toolify.ai (`toolify.ai` — DR 73)
- **Competitor Listed**: `tactiq.io` (`https://www.toolify.ai/tool/tactiq` + localized pages in `/es/`, `/pt/`, `/de/`, `/fr/`, `/ja/`, `/ko/`, `/tw/`, `/vi/`)
- **Submission URL**: `https://www.toolify.ai/submit`
- **Category**: Meeting Assistant / Google Workspace Add-ons / Education
- **Copy-Paste Description**:
  ```text
  Attendance Tracker for Google Meet is an official Google Workspace Marketplace add-on engineered on the native Google Meet REST API v2. It eliminates manual roll calls and broken DOM-scraping Chrome extensions by running natively inside the Google Meet side panel. Key features include real-time Present/Late/Absent tracking, automatic rejoin merging, 1-click Google Classroom roster import, webhook notifications (Slack, Discord, Google Chat), and formatted exports to Google Sheets, Canvas, and Moodle in 44 languages. Pricing: Free (5 exports/mo: Sheets or CSV combined), $9.99 one-time Individual Lifetime Pass, $4.99/yr Educator Pass, $59/yr Department License, and $149/yr Institution License.
  ```

### 5. SideProjectors (`sideprojectors.com` — DR 71)
- **Competitor Listed**: `attendlist.com`
- **Submission URL**: `https://www.sideprojectors.com/project/submit`
- **Category**: SaaS / Google Workspace / EdTech
- **Copy-Paste Description**:
  ```text
  I built Attendance Tracker after watching legacy Google Meet attendance Chrome extensions break every time Google updated Meet's Material 3 DOM. Instead of scraping HTML, Attendance Tracker is an official Google Workspace Marketplace add-on powered by the Google Meet REST API v2. It runs inside Meet's native side panel, merges participant reconnects, syncs Google Classroom rosters, and exports directly to Google Sheets and LMS CSVs in 44 languages.
  ```

### 6. Remote Tools (`remote.tools` — DR 57)
- **Competitor Listed**: `tactiq.io` (`https://www.remote.tools/notepadpw/alternatives`)
- **Submission URL**: `https://www.remote.tools/submit-product`
- **Category**: Remote Team Collaboration / Video Conferencing Tools
- **Copy-Paste Description**:
  ```text
  Attendance Tracker is a native Google Workspace Marketplace add-on that automates attendance and duration logging for remote team standups, all-hands meetings, training webinars, and virtual classrooms in Google Meet. Built on the official Google Meet REST API v2, it requires zero browser extensions or intrusive recording bots, supports Slack/Discord/Google Chat webhooks, and exports clean attendance sheets to Google Drive in one click. Localized in 44 languages with a free tier (5 exports/month) and a $9.99 one-time Individual Lifetime Pass.
  ```

### 7. 500.tools (`500.tools` — DR 39)
- **Competitor Listed**: `attendlist.com`
- **Submission URL**: `https://500.tools/submit`
- **Category**: Meeting Software Tools / Productivity
- **Copy-Paste Description**:
  ```text
  Official Google Workspace Marketplace add-on for Google Meet built on the native REST API v2. Tracks participant arrival/departure times, merges reconnects, syncs Google Classroom rosters, and exports attendance logs to Google Sheets, Canvas, and Moodle in one click without Chrome extensions.
  ```

### 8. Indie Hacker Stacks (`indiehackerstacks.com` — DR 26)
- **Competitor Listed**: `attendlist.com`
- **Submission URL**: `https://indiehackerstacks.com/`
- **Tech Stack Tags**: `Node.js`, `Express`, `Google Cloud Run`, `Firestore`, `Google Meet REST API v2`, `Google Workspace Add-ons SDK`, `Stripe`, `Resend`, `GitHub Pages`, `Cloudflare`
- **Copy-Paste Description**:
  ```text
  Attendance Tracker (https://attendancetracker.dev) is a multi-tenant Google Workspace Marketplace add-on for automated Google Meet attendance tracking, built with a zero-framework vanilla JS side panel on GitHub Pages/Cloudflare and a Node.js + Express + Firestore backend on Google Cloud Run integrating the Google Meet REST API v2, Classroom API, Drive/Sheets API, and Stripe.
  ```
