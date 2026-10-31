# Site translation brief (attendancetracker.dev)

You translate pages of the marketing / help site for **Attendance Tracker**, a
Google Meet add-on that takes attendance for teachers, schools and businesses.

## Input / output

- English source: `site-i18n/content/en/<page>.json` →
  `{ page, legal, segments: [{ id, kind, key, text }] }`
- Write: `site-i18n/content/<loc>/<page>.json` →
  `{ "page": "<page>.html", "translations": { "<id>": "<translated text>", ... } }`
  with **one entry for every segment id** in the English file.

Segment kinds:

- `head` — `<title>` / meta description / og / twitter text. Keep the
  " — Attendance Tracker" suffix pattern on titles. Descriptions ≤ ~160 chars.
- `html` — inner HTML of one block (paragraph, list item, heading, cell…).
  **Keep every tag exactly** (same tags, same attributes, same `href`/`src`
  values, same nesting); translate only the human text between tags. You may
  move inline tags (`<strong>`, `<a>`) to wrap the equivalent words.
- `attr` — an `alt` / `title` / `placeholder` / `aria-label` value (plain text).
- `textnode` — a bare text fragment (plain text).
- `jsonld` — a structured-data string (FAQ question/answer, HowTo step, name,
  description). Plain text, no HTML.

## Rules

- Natural, fluent, native-quality prose for the target market — not literal.
  Keep the meaning, facts, numbers and claims exactly.
- **Never translate:** Attendance Tracker, Google Meet, Google Workspace,
  Google Sheets, Google Drive, Google Classroom, Google Calendar, Google Chat,
  Gmail, Chrome, Canvas, Moodle, Schoology, Blackboard, Slack, Discord, Zoom,
  Microsoft Teams, Excel, CSV, PDF, API, LMS, SSO, FERPA, COPPA, GDPR, DPA,
  Stripe, Pro, Educator Pass, Lifetime Pro, Department, Institution, product
  or competitor names, URLs, email addresses, code, keyboard keys.
- UI labels quoted from the Meet / add-on interface (e.g. **Start**,
  **Activities**) may be translated to the label Google uses in that language.
- Prices, numbers and dates stay as written (`$59/yr`); localize only the
  surrounding words.
- Legal pages (`"legal": true`): precise, formal legal register; do not
  soften or add obligations. A notice that the English version governs is
  added automatically — do not add your own.
- Do not add or remove segments, links, or sentences.
- RTL languages (ar, he, ur): write normally; layout is handled by the page.

## Self-check before finishing

Run `node scripts/site-i18n/validate.mjs <loc>` from the repo root — it must
report 0 errors and 0 missing segments for the pages you wrote.
