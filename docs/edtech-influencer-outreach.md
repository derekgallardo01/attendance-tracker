# Track 4: EdTech Influencer Direct Outreach (Personalized Founder Pitches)

## Overview
This document outlines the high-impact founder outreach strategy for **Track 4**: engaging premier K-12 Google Workspace educational technology leaders and influencers:
1. **Eric Curts** (*Control Alt Achieve* / SPARCC)
2. **Richard Byrne** (*Free Technology for Teachers* / *Practical Ed Tech*)
3. **Kasey Bell** (*Shake Up Learning*)

During the transition to remote and hybrid teaching (2020–2022), each of these educators tackled the pervasive challenge of tracking student attendance in Google Meet. Because Google initially offered native attendance reports only on premium enterprise tiers (Workspace for Education Plus) and neglected automated roster tracking in Google Classroom, each influencer devised workarounds—ranging from Google Form check-in sheets and complex Sheets pivot tables to recommending third-party Chrome extensions (e.g. Clay Codes' "Meet Attendance").

Since 2023, those legacy Chrome extensions have either broken due to Google Meet UI redesigns, been blocked by district IT admins over student privacy (FERPA/COPPA), or remained unmaintained. Attendance Tracker directly resolves these historical friction points.

---

## Influencer Profiles & Research Dossier

### 1. Eric Curts
* **Role / Organizations:** EdTech Consultant, Speaker, Google Certified Innovator & Trainer; Technology Integration Specialist at Stark Portage Area Computer Consortium (SPARCC).
* **Website / Channel:** [Control Alt Achieve](https://www.controlaltachieve.com)
* **Verified Contact Channels:**
  * Primary Direct Email: `ericcurts@gmail.com`
  * Institutional / SPARCC Email: `eric.curts@email.sparcc.org`
  * Discussion Group: `caa-group@googlegroups.com`
  * Social: [@ericcurts](https://twitter.com/ericcurts)
* **Historical Articles / Pain Points Analyzed:**
  * **Article 1:** *"Alternative Google Meet Attendance with Forms and Sheets"* (January 2021) — [Link](https://www.controlaltachieve.com/2021/01/alt-attendance.html)
    * *Pain Point:* Google Meet's native attendance tracking was gated behind Enterprise editions. For teachers on free Google Workspace Fundamentals, Eric created an intricate workaround using a Google Form distributed via chat and linked to a Google Sheet with pivot tables to summarize attendance by student and date. While ingenious, this workaround requires teachers to manually distribute links, remind students to fill out the form mid-lesson, and maintain spreadsheet formulas.
  * **Article 2:** *"Google Meet Attendance Tracking and Reporting"* (January 2021) — [Link](https://www.controlaltachieve.com/2021/01/meet-attendance.html)
    * *Pain Point:* For Enterprise users who did receive Google's standalone CSV attendance reports, Eric had to build an entire yearly aggregation template with pivot tables because Google's built-in feature only outputs isolated, single-meeting CSVs.
* **Founder Angle:** Attendance Tracker eliminates the need for Form check-ins and formula maintenance for non-Enterprise schools by running natively in Meet on the Google Meet REST API v2, syncing directly with Google Classroom rosters.

---

### 2. Richard Byrne
* **Role / Organizations:** Educator, Author, International Speaker; Founder of *Free Technology for Teachers* and *Practical Ed Tech*.
* **Website / Channel:** [Free Technology for Teachers](https://www.freetech4teachers.com) | [Practical Ed Tech](https://www.practicaledtech.com) | [YouTube (@RichardByrne)](https://www.youtube.com/@RichardByrne)
* **Verified Contact Channels:**
  * Primary Direct Email: `richard@byrne.media`
  * Social / Twitter: [@rmbyrne](https://twitter.com/rmbyrne)
* **Historical Content / Pain Points Analyzed:**
  * **Blog & Video Tutorials:** Multiple guides and tutorials on taking attendance in Google Meet using Chrome extensions (such as Clay Codes' *Meet Attendance*) and Google Forms.
  * *Pain Point:* Third-party Chrome extensions relied on browser DOM scraping (inspecting the HTML elements of the Meet participant list). When Google redesigned the Meet UI in 2021 and 2023, these extensions completely broke, causing fatal console errors or corrupting attendance records. Furthermore, district IT administrators began banning third-party Chrome extensions en masse to comply with student privacy laws (FERPA/COPPA).
* **Founder Angle:** Attendance Tracker does not use DOM scraping or browser extensions; it is an official Google Workspace Marketplace add-on built on the native Google Meet REST API v2, functioning seamlessly in the Meet Activities panel even on managed district Chromebooks.

---

### 3. Kasey Bell
* **Role / Organizations:** Author, Speaker, Google Certified Innovator & Trainer; Creator of *Shake Up Learning* and host of *The Shake Up Learning Show*.
* **Website / Channel:** [Shake Up Learning](https://shakeuplearning.com)
* **Verified Contact Channels:**
  * Primary Direct Email: `kasey@shakeuplearning.com`
  * Social: [@ShakeUpLearning](https://twitter.com/ShakeUpLearning)
* **Historical Content / Pain Points Analyzed:**
  * **Content & Books:** *The Teacher's Guide to Google Classroom*, tutorials on Google Classroom roster management, and habit-stacking / question-based attendance tracking routines.
  * *Pain Point:* Google Classroom does not offer a native attendance tracking button. Kasey widely popularized the workaround of creating a multiple-choice "Question" assignment (e.g. "Daily Attendance [Date]" - "I am here") in the Classwork tab. Teachers had to juggle tabs during live Google Meet classes to compare active video participants against who answered the Google Classroom prompt.
* **Founder Angle:** Attendance Tracker connects the dots between Google Classroom and Google Meet. With one click inside the Google Meet side panel, it imports the teacher's active Google Classroom roster and marks who is present, late, or absent without leaving the call.

---

## Anti-AI Tone Guidelines & Philosophy
All pitches adhere to strict authentic founder communication principles:
1. **No Robotic Openings or Cliches:**
   * Banned: *"I hope this email finds you well"*, *"In today's fast-paced digital landscape"*, *"I am reaching out to introduce..."*
   * Replaced by: Direct, contextual opening referencing their specific tutorial or workaround.
2. **No Empty Flattery or Buzzwords:**
   * Banned: *"revolutionary"*, *"game-changer"*, *"seamlessly empowers"*, *"delighted"*, *"state-of-the-art"*, *"groundbreaking"*.
   * Replaced by: Concrete architectural distinctions (e.g., *"built on the Google Meet REST API v2 rather than scraping the DOM"*, *"syncs directly with Google Classroom rosters"*).
3. **Peer-to-Peer / Respectful of Time:**
   * Under 175 words.
   * Clear value proposition: A simple, friction-free tool built to solve the exact problem they covered.
   * Offer of a free lifetime educator account with zero strings attached or editorial obligations.

---

## Ready-to-Dispatch Pitch Copy

### Pitch 1: Eric Curts (Control Alt Achieve)
* **To:** `ericcurts@gmail.com`
* **CC:** `eric.curts@email.sparcc.org`
* **Subject:** Replacing the Google Forms attendance workaround for Google Meet

```text
Hi Eric,

I came across your 2021 post on Control Alt Achieve where you shared the Google Form and Sheets pivot table template for teachers on standard Google Workspace accounts without Enterprise attendance reporting. It was a clever workaround, but watching teachers juggle form links in the Meet chat and copy formulas across sheets always felt like way too much friction.

I'm Derek, a developer, and I built Attendance Tracker (https://attendancetracker.dev) to solve that exact gap. It's a Google Workspace Marketplace add-on built on the native Google Meet REST API v2, so it runs right inside the Meet side panel:

- Works on standard/Fundamentals accounts (doesn't require Workspace Plus/Enterprise).
- No browser extensions or DOM scraping—runs in Meet's native Activities panel on Chromebooks.
- Syncs rosters directly from Google Classroom to show who's present, late, or absent in real time.
- Exports clean CSVs and writes directly to the teacher's own Google Drive.

If you ever want to poke around or test it out, I'd be happy to set you up with a free lifetime educator pass. No expectations or pitch—just thought it might be useful for the Control Alt Achieve community or your SPARCC teachers.

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev
```

---

### Pitch 2: Richard Byrne (Free Technology for Teachers / Practical Ed Tech)
* **To:** `richard@byrne.media`
* **Subject:** A Meet attendance tool that doesn't break when Google updates the UI

```text
Hi Richard,

I've followed your posts on Free Tech for Teachers and your YouTube tutorials for years, especially back when you were reviewing Google Meet attendance extensions like Clay Codes' Meet Attendance and suggesting Google Form check-ins.

As you probably saw, those early DOM-scraping Chrome extensions completely broke once Google changed the Meet interface (and most haven't been updated since 2023). On top of that, a lot of IT admins started blocking third-party Chrome extensions entirely.

I built Attendance Tracker (https://attendancetracker.dev) to fix this properly. Instead of scraping the browser page, it's an official Google Workspace Marketplace add-on built on Google Meet's REST API v2:

- Runs natively inside Meet's Activities panel—no local Chrome extensions to install, so it works on locked-down district Chromebooks.
- Syncs directly with Google Classroom rosters to automatically highlight present, late, and absent students.
- Saves attendance sheets straight to the teacher's Google Drive and exports CSVs formatted for Canvas and Moodle.
- Privacy-friendly (FERPA/COPPA compliant, no third-party tracking scripts).

If you'd like to test it out or see how it works, I'd love to set you up with a free lifetime educator account. Either way, thanks for all the practical edtech resources you share.

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev
```

---

### Pitch 3: Kasey Bell (Shake Up Learning)
* **To:** `kasey@shakeuplearning.com`
* **Subject:** A native Google Classroom roster check-in for Google Meet

```text
Hi Kasey,

I've followed Shake Up Learning and your Google Classroom guides for a long time. I remember your tip on using the Classroom "Question" feature (posting a daily multiple-choice prompt) as an attendance workaround because Google never gave teachers an easy built-in attendance tool tied to class rosters.

It got the job done, but taking attendance during live calls still meant switching between tabs and manually checking off names.

I built Attendance Tracker (https://attendancetracker.dev) to bridge that gap between Google Classroom and Google Meet. It's an official Workspace Marketplace add-on built on the Meet REST API v2 that sits directly in the Meet side panel:

- 1-click Google Classroom sync: Pulls your actual class roster into the call so you immediately see who is present, late, or absent.
- No Chrome extensions needed: Runs natively inside Meet's Activities panel, so district Chromebook restrictions won't block it.
- Direct Drive exports: Generates clean attendance sheets in the teacher's own Google Drive and CSVs for school SIS gradebooks.
- Zero tracking or student data scraping (FERPA/COPPA compliant).

If you'd like to try it out or kick the tires, I'd be glad to give you a free lifetime educator pass. No strings attached—just wanted to share it with you since you've spent so much time helping teachers streamline their Google workflows.

Best,
Derek Gallardo
Founder, Attendance Tracker
https://attendancetracker.dev
```

---

## Execution & Automation
Outreach for Track 4 is managed by `scripts/send-track4-outreach.cjs`.

### CLI Command Reference
```bash
# Preview emails without sending
node scripts/send-track4-outreach.cjs --dry-run

# Dispatch a test preview to Derek's inbox (derekgallardo01@gmail.com)
node scripts/send-track4-outreach.cjs --test

# Send to an individual target by ID (1 = Eric Curts, 2 = Richard Byrne, 3 = Kasey Bell)
node scripts/send-track4-outreach.cjs --send --target=1

# Send to all pending targets (skips previously sent targets automatically)
node scripts/send-track4-outreach.cjs --send --all
```
All live dispatches are recorded in `docs/track4-dispatch-log.json` to prevent accidental duplicate transmissions.
