---
name: new-signup
description: Triage a new Attendance Tracker signup — parse the "🎉 New user" notification email, look up the user's real record in production Firestore (account, activation events, tracked meetings, acquisition source), and reconcile the email's auto-detected source against the user's self-reported one. Use when the user pastes/forwards a signup notification, asks to "look up" a new user, or wants to know whether a signup actually activated. Read-only: never fires emails or mutates production.
---

# New-signup triage (Attendance Tracker)

Turn a signup notification into a picture of who the user is and whether they activated. This is a **read-only investigation** against live Firestore — never send email, never write to a user doc, never trigger a sweep/webhook.

## What you're given

A notification email like:

```
A new user just signed up for Attendance Tracker.
Name    Heléon Advisory
Email   heleonadvisory@gmail.com
Domain  gmail.com
Source  direct
Total users now  22
```

The `Source` line is the **auto-detected** source at the OAuth instant — see [Reconciling the two sources](#reconciling-the-two-sources). Don't trust it as attribution on its own.

## Access facts (verify, don't assume)

- **You cannot use the Gmail / admin-dashboard connectors** — the claude.ai Gmail + Calendar connectors need interactive OAuth and this session is usually non-interactive. Work directly against Firestore.
- **GCP project:** `attendance-tracker-490319`. **Auth:** Application Default Credentials (`gcloud auth list` should show `derekgallardo01@gmail.com` active; ADC lives at `~/AppData/Roaming/gcloud/application_default_credentials.json`). Confirm both before querying.
- **User doc path:** `tenants/{domain}/users/{email-lowercased}`. For a `gmail.com` signup the domain literally is `gmail.com` (personal-email tenants are shared — see `PERSONAL_EMAIL_DOMAINS` in `backend/src/services/firestore/_core.js`).
- **Do NOT `require('../services/firestore')` in a script** — its `src/config` load throws `GOOGLE_CLIENT_ID env var not set` outside the running server. Query the Firestore SDK **directly** instead (script below). The service's `getUserDetail(domain, email)` in `backend/src/services/firestore/analytics.js` is the shape to mirror.

## Workflow

1. **Parse** the email → `{ name, email, domain, source, totalUsers }`. Lowercase the email for the doc id.
2. **Confirm access** (`gcloud config get-value project`, ADC file exists). If ADC is missing, tell the user to run `gcloud auth application-default login` — don't guess credentials.
3. **Query Firestore directly** with the script in [Lookup script](#lookup-script). Write it to the scratchpad and run it from `backend/` with `node` (its `node_modules` has `@google-cloud/firestore`). **Redact tokens** (`refreshToken`, `accessToken`, `tokenExpiresAt`) — never print them.
4. **Read the record:**
   - Account: `displayName`, `createdAt`, `lastLoginAt`, `exportScopeGranted`, `sheetId`, `grantedScopes`, `teamAdmin`.
   - Acquisition: `acquisitionSource` (self-reported), `acquisitionSourceDetail`, `acquisitionCapturedAt`, `utmSource`, `referredBy`, `landingUrl`, `signupDetectedSource`.
   - Activity: `events` subcollection → count `tracked` / `exported` / `signin` / `export_clicked`. Group `tracked` by `meta.conferenceId`.
   - Meetings: for each tracked `conferenceId`, read `tenants/{domain}/meetings/{conferenceId}` → `title`, `participantCount`, `distinctAttendeeCount`, `recurringEventId`, `startTime`.
   - Outreach/notes/reminders: `outreach`, `adminNotes/{email}`, `reminders` (usually empty for a fresh signup).
5. **Judge activation.** A real activation = signed up → tracked a **multi-person** meeting → exported, ideally on a **recurring** series (`recurringEventId` present = likely to return). A single solo `participantCount:1` self-test is *not* activation. Say which it is.
6. **Reconcile the source** (below) and flag any mismatch.
7. **Report** concisely: an Account table, a one-line activation verdict, the meeting(s) they tracked, and source reconciliation. Offer next steps (health score, meeting drill-down) — don't take mutating ones without being asked.

## Reconciling the two sources

The notification email's `Source` and the stored `acquisitionSource` measure **different things at different moments** — they are usually not in conflict:

- **Detected** (`signupDetectedSource`, what the email historically showed): derived in `backend/src/routes/oauth.js` at the OAuth exchange — priority `explicit source > invite:{ref} > utm:{source} > ref:{referrer-host} > "direct"`. Users entering via the in-Meet add-on (`landingUrl` has `meet_sdk=…&origin=meet.google.com`) have no web referrer, so this is almost always **`direct`**.
- **Self-reported** (`acquisitionSource`, e.g. `google_search`): the "how did you find us?" modal, POSTed to `/api/admin/source` a few seconds after signup (`acquisitionCapturedAt` ≈ `createdAt` + seconds). Overwrites passive guesses because self-report is the strongest signal. Allowed values: `ACQUISITION_SOURCES` in `backend/src/lib/constants.js` (`google_search`, `marketplace`, `reddit`, `youtube`, `friend`, `other`).

Since the **defer-signup-notification** change (commit `51dbb34`), the signup email is **deferred** and shows *both* labeled (`Source (self-reported)` / `Source (detected)`), flushed once the modal is answered. Older signups (created before that change) have no `signupNotifyPending` field and their original email only showed the detected value — that's why a historical "direct" can coexist with a stored `google_search`. Explain it that way rather than calling either one wrong.

## Lookup script

Write to scratchpad, fill in `DOMAIN`/`EMAIL`, run `node <path>` from `backend/`:

```js
const { Firestore } = require('@google-cloud/firestore'); // run from backend/
const db = new Firestore({ projectId: 'attendance-tracker-490319' });
const DOMAIN = 'gmail.com';
const EMAIL = 'heleonadvisory@gmail.com'.toLowerCase();
const iso = v => v?.toDate?.()?.toISOString?.() || v || null;
const redact = (k, v) => /token|Token/.test(k) ? `[REDACTED len=${String(v||'').length}]` : (v?.toDate ? iso(v) : v);

(async () => {
  const t = db.collection('tenants').doc(DOMAIN);
  const [u, ev, note, outreach, rem] = await Promise.all([
    t.collection('users').doc(EMAIL).get(),
    t.collection('events').where('email', '==', EMAIL).get(),
    t.collection('adminNotes').doc(EMAIL).get(),
    t.collection('outreach').doc(EMAIL).get(),
    t.collection('reminders').where('email', '==', EMAIL).get(),
  ]);
  if (!u.exists) { console.log('NOT FOUND at', `tenants/${DOMAIN}/users/${EMAIL}`); return; }
  const d = u.data();
  const acct = {}; for (const k of Object.keys(d).sort()) acct[k] = redact(k, d[k]);
  const events = ev.docs.map(x => ({ type: x.data().type, at: iso(x.data().createdAt), meta: x.data().meta || null }))
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  const counts = events.reduce((m, e) => (m[e.type] = (m[e.type] || 0) + 1, m), {});
  const confIds = [...new Set(events.filter(e => e.type === 'tracked' && e.meta?.conferenceId).map(e => e.meta.conferenceId))];
  const meetings = [];
  for (const id of confIds) {
    const m = await t.collection('meetings').doc(id).get();
    if (m.exists) { const md = m.data(); meetings.push({ id, title: md.title, participantCount: md.participantCount, recurring: !!md.recurringEventId, startTime: iso(md.startTime) }); }
  }
  console.log(JSON.stringify({
    path: u.ref.path, account: acct, counts, eventTotal: events.length,
    recentEvents: events.slice(0, 15), meetings,
    note: note.exists ? note.data().body : null,
    outreach: outreach.exists ? outreach.data() : null, reminders: rem.size,
  }, null, 2));
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
```

If the user doc isn't at the expected path, fall back to `db.collectionGroup('users')` and filter by id/displayName — a user may live under a different tenant than the email's `Domain` line implies.

## Guardrails

- **Read-only.** No `sendAdminEmail`, no `setUserAcquisitionSource`, no sweep endpoints, no writes. If the user asks to email/contact the person, that's a separate, explicit action — confirm first.
- **Redact tokens** in every output.
- **This is real user PII from production.** Don't paste it anywhere external; keep it in the local reply.
- **No Claude attribution** in any commit/PR made off the back of this (standing global rule): Derek's git identity only, no `Co-Authored-By`, no "Generated with" footer, no `claude/` branch names.
