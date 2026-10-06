# Chrome Web Store Listing — Attendance Tracker for Google Meet — Launcher

> Last Updated: 2026-10-06

---

## 1. Store Listing Details

**Extension Name** [REQUIRED]
```text
Attendance Tracker for Google Meet — Launcher
```
*(Matches manifest.json exactly, 45 characters, under 75 character limit).*

**Short Description** [REQUIRED]
```text
Companion launcher for Attendance Tracker in Google Meet. Real-time roll call, timestamps, and one-click Sheets export.
```
*(117 characters, under 132 character limit).*

**Detailed Description** [REQUIRED]
```text
The companion launcher for Attendance Tracker — the official Google Meet attendance add-on built natively on Google Meet APIs.

Take accurate attendance in Google Meet without brittle screen scraping or broken page extensions.

KEY CAPABILITIES:
• Real-time Attendance & Durations: Track who attended, exact arrival/departure times, and cumulative participation minutes.
• 1-Click Google Sheets Export: Export cleanly formatted attendance logs to Google Sheets with custom color coding and absent student breakdowns.
• Semester Series Tracking: Automatically aggregate multi-session classes into a single master spreadsheet with cumulative semester attendance rates.
• Google Classroom & Canvas Sync: Write attendance scores and participation grades directly into your course gradebooks in one click.
• 44 Supported Languages: Fully localized user interface automatically detects your preferred language.
• Enterprise & Education Ready: Compliant with student data privacy frameworks (FERPA, COPPA, GDPR).

HOW TO USE IN GOOGLE MEET:
1. Join or start any Google Meet call.
2. Click the Activities icon (shapes icon: triangle, square, circle) at the bottom right.
3. Select "Attendance Tracker" and press Start.
4. When class concludes, click Export to Google Sheets, CSV, or your LMS.

PRIVACY & PERMISSIONS:
This launcher extension requires ZERO invasive permissions. It does not read your browsing history, run content scripts on arbitrary websites, or access external pages.

SUPPORT & LINKS:
• Website: https://attendancetracker.dev
• Privacy Policy: https://attendancetracker.dev/privacy.html
• Terms of Service: https://attendancetracker.dev/terms.html
• Google Workspace Marketplace: https://workspace.google.com/marketplace/app/attendance_tracker/829771833968
• Help & Guides: https://attendancetracker.dev/help.html
```

**Category** [REQUIRED]
```text
Productivity
```

**Single Purpose** [REQUIRED]
```text
Provides quick-launch access and guidance for the official Attendance Tracker Google Meet add-on.
```

**Primary Language** [REQUIRED]
```text
English
```

---

## 2. Graphics & Assets

| Asset | Dimensions | Status | Location |
| :--- | :--- | :--- | :--- |
| **Store Icon** [REQUIRED] | 128×128 PNG | ✅ Ready | `companion-extension/icons/icon-128.png` |
| **Screenshot 1** [REQUIRED] | 1280×800 JPEG | ✅ Ready | `screenshots/cws/01-live-roster.jpg` |
| **Screenshot 2** [RECOMMENDED] | 1280×800 JPEG | ✅ Ready | `screenshots/cws/02-sheets-export.jpg` |
| **Screenshot 3** [RECOMMENDED] | 1280×800 JPEG | ✅ Ready | `screenshots/cws/03-late-no-shows.jpg` |
| **Screenshot 4** [RECOMMENDED] | 1280×800 JPEG | ✅ Ready | `screenshots/cws/04-class-attendance.jpg` |

---

## 3. Permissions Justification

| Permission | Type | Justification |
| :--- | :--- | :--- |
| *(None)* | *(None)* | **No extra permissions requested.** The extension requires 0 special permissions or host permissions, ensuring immediate approval. |

---

## 4. Privacy & Data Use Disclosures

When filling out the **Privacy Practices** tab in the Chrome Developer Dashboard:

- **Single Purpose Description**: 
  `Provides a lightweight launcher and instructions for accessing Attendance Tracker within Google Meet.`
- **Permissions Justification**: `N/A — No permissions requested.`
- **Host Permissions Justification**: `N/A — No host permissions requested.`
- **Remote Code**: Select **"No, I am not using remote code"** *(Manifest V3 compliant; all scripts are bundled locally)*.
- **Data Collection Checkboxes**:
  - Personally Identifiable Information: **NO**
  - Health Information: **NO**
  - Financial & Payment Info: **NO**
  - Authentication Info: **NO**
  - Personal Communications: **NO**
  - Location: **NO**
  - Web History: **NO**
  - User Activity: **NO** (or check *User activity* if declaring the anonymous telemetry ping `/api/public/pageview`, but selecting NO is standard since no personal identifiers or session cookies are recorded).
  - Website Content: **NO**
- **Privacy Policy URL**:
  `https://attendancetracker.dev/privacy.html`
- **Certification Checkboxes**:
  - ✅ *"I certify that I do not sell or transfer user data to third parties."*
  - ✅ *"I certify that I do not use or transfer user data for purposes unrelated to the extension's core functionality."*
  - ✅ *"I certify that I do not use or transfer user data to determine creditworthiness or for lending purposes."*

---

## 5. Build & Packaging

Package zip location:
```text
dist/attendance-tracker-launcher.zip
```

Command to rebuild package anytime:
```powershell
Compress-Archive -Path companion-extension\* -DestinationPath dist/attendance-tracker-launcher.zip -Force
```
