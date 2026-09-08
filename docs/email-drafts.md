# Launch email drafts (ready to send)

Two prepared sends. Both written for Resend (`hello@attendancetracker.dev`) with
the standard unsubscribe footer appended by the mailer. Plain-conversational
style matching the existing lifecycle emails — short, one CTA each.

---

## 1. Classroom-import announcement — SEND WHEN GOOGLE APPROVES THE CLASSROOM SCOPES

**Audience:** education-cohort users (school/edu domains + gmail teachers with
`acquisitionSource`/events suggesting teaching; at minimum: every user on a
`.edu*`/`k12`/school-like domain plus anyone who ever created a Class Roster).
**Goal:** reactivate installed-but-never-tracked teachers by removing the
roster-setup friction that the cohort analysis identified as the #1 drop-off.

**Subject:** Your Google Classroom roster can now take attendance for you

**Body:**

Hi {firstName},

Quick update that I think removes the most annoying part of tracking
attendance on Google Meet: typing in your class list.

You can now import your Google Classroom roster in one click. Open the
Attendance Tracker panel in any Meet call → Class Roster tab → "Import from
Google Classroom" → pick your course. Every enrolled student's name and school
email fills in, and from that moment the panel sorts your class into Present,
Late, and Absent automatically — including students who never joined at all.

A few other things that shipped alongside it:

- **Moodle & Canvas gradebook exports** — download attendance as an
  import-ready gradebook CSV, matched to students by email, per session or
  across the whole semester.
- **Google Chat & Discord digests** — a formatted attendance card posted to
  your space or channel after every export (Slack already worked).
- **30 languages** — the panel now speaks Spanish, Tagalog, Hindi, Vietnamese,
  Bahasa, Arabic, and 24 more.

Everything above the gradebook semester roll-up is free.

Try the import on your next class: [Open Google Meet](https://meet.google.com)
— the panel is in the Activities menu.

If anything doesn't work the way you expect, just reply to this email — I read
every one.

— Derek
Attendance Tracker · attendancetracker.dev

*Send note: exclude suppressed emails (mailer does this), exclude the owner,
one send per user (claimReengagementSlot-style dedup key `classroom_announce`).*

---

## 2. "What's new" note — ACTIVE USERS (tracked ≥1 meeting in the last 60 days)

**Goal:** feature adoption of the new integrations by people already using the
product; secondary: gentle Pro surface via the semester gradebook line.

**Subject:** New in Attendance Tracker: gradebook exports, Classroom import, chat digests

**Body:**

Hi {firstName},

Three additions since you last heard from me, all live in your panel today:

**1. Gradebook exports for Moodle & Canvas.** With a Class Roster active,
click "Moodle" or "Canvas" in the roster tab to download an import-ready
gradebook CSV — attendance percentage as the grade, absences as 0, excused
absences left blank for you to decide. Recurring classes get a whole-semester
version from the Series tab in Meeting History.

**2. One-click Google Classroom roster import.** Class Roster tab → New Class
→ Import from Google Classroom. No more pasting student lists.

**3. Digests to Google Chat and Discord.** The Settings modal's webhook card
now has Slack, Google Chat, and Discord tabs — each posts a formatted
attendance card to your channel after every export.

Also: the panel is now available in 30 languages (Settings → language picker),
and downloads inside Meet got more reliable.

That's it — no action needed, everything is where you'd expect it.

— Derek
Attendance Tracker · attendancetracker.dev

*Send note: audience = users with a tracked event in the last 60 days,
excluding suppressed + owner; dedup key `whatsnew_2026_09`.*

---

## Sending mechanics (when ready)

Option A (manual, fine at current scale): export the audience emails from the
admin dashboard, BCC-batch via the derek@attendancetracker.dev alias.

Option B (scripted): a one-off `POST /api/admin/announce` route following the
`check-reengagement` pattern — audience filter + `claimReengagementSlot` dedup
+ `sendPersonalEmail` helper — run once via the scheduler secret, then removed
or left dormant. ~1 hour of work; ask Claude when ready to send.
