# Attendance Tracker

A Google Meet add-on that tracks who joins, who leaves, and how long they stay — then auto-exports attendance reports to Google Sheets when the meeting ends and posts a summary to your Slack channel. Available on the [Google Workspace Marketplace](https://workspace.google.com/marketplace/app/attendance_tracker/829771833968).

- **Live site:** https://attendancetracker.dev
- **Backend:** https://attendance-tracker-backend-829771833968.us-central1.run.app
- **GCP project:** `attendance-tracker-490319` (project number `829771833968`)

---

## Features

**Core capture**
- Real-time participant tracking via Meet REST API v2 (10-30s adaptive polling)
- Self-presence detection (3 strategies) keeps you marked Present during API lag
- Late-arrival highlighting (`+Nm late` chip) using the calendar-event start as the baseline
- Excused-absence tagging persisted per meeting

**Export + digest**
- One-click export to a per-user Google Sheet (tabbed by meeting)
- Auto-export when the Meet API reports `endTime` and the panel is still open
- Inline attendance digest email via Resend, with deep links to `history.html`
- Slack post-meeting digest via incoming webhook (per-user config, Block Kit message)

**Recurring meeting roll-up**
- `recurringEventId` join key captured from Calendar API
- `history.html` Series tab with collapsible per-person attendance breakdowns
- Public share-link dashboards via `share.html?t=<token>` (30-day expiry)

**Retention**
- Daily series-attendance alerts (streak + threshold rules) emailed to organizers
- Daily re-engagement sweep: 7-day + 30-day reactivation + forgotten-meeting nudges
- All idempotent via Firestore atomic-create (`claimDailyAlertSlot` / `claimReengagementSlot`)

**Team admin view**
- First Workspace-domain signin auto-becomes the team admin
- `team.html` shows org-wide attendance across users / meetings / series / people
- Personal-email providers (gmail.com, outlook.com, etc.) excluded from auto-claim

**Distribution surface**
- Landing page with CSS mockup of the side panel
- Open Graph + Twitter Card meta + JSON-LD SoftwareApplication structured data
- 3 SEO content pages targeting long-tail queries + `sitemap.xml` + `robots.txt`
- Referral attribution via `?ref=<email>` (celebrate-modal share links auto-append)
- In-product feedback widget (floating bottom-right) on every public page
- Private pageview beacon → `pageviews` collection (no third-party analytics dependency)

---

## Architecture

| Component | Location | Tech |
|-----------|----------|------|
| Frontend (side panel + landing page + auth pages) | GitHub Pages (`attendancetracker.dev`) | HTML/JS, Meet Add-ons SDK |
| Backend | Google Cloud Run (`us-central1`) | Node.js 18+ / Express |
| Data store | Google Firestore (tenant-scoped) | Native mode, free tier |
| Transactional email | Resend | `resend` Node SDK |
| Daily crons | Google Cloud Scheduler | x-scheduler-secret header auth |
| Auth | OAuth 2.0 (user) + Service Account JWT (admin delegation) | Google Identity Services + Secret Manager |
| Error tracking | Sentry | `@sentry/node` + browser SDK |

### Data model

Firestore is tenant-scoped under `tenants/{domain}`:

```
tenants/{domain}                      - install config, adminEmail, delegationVerified
tenants/{domain}/users/{email}        - profile + encrypted refresh token + teamAdmin flag
tenants/{domain}/userSettings/{email} - Slack webhook URL + future notification prefs
tenants/{domain}/meetings/{id}        - meeting metadata + recurringEventId + excusedEmails
tenants/{domain}/meetings/{id}/participants/{userId}
tenants/{domain}/events/{auto-id}     - per-user event log (signin, tracked, exported, etc.)
tenants/{domain}/exports/{auto-id}    - export audit trail
tenants/{domain}/adminNotes/{email}   - super-admin CRM notes
tenants/{domain}/reminders/{auto-id}  - super-admin follow-up reminders
tenants/{domain}/outreach/{email}     - outreach status + conversation log
tenants/{domain}/alertsSent/{date-email}    - daily series-alert dedup
tenants/{domain}/reengagementSent/{key}     - permanent reengagement dedup

Top-level (admin / global):
shareLinks/{token}            - public share-link records
pageviews/{auto-id}           - landing-page pageview beacon log
pageviewsDaily/{YYYY-MM-DD}   - daily pageview counter doc
feedback/{auto-id}            - in-product feedback submissions
emailTemplates/_singleton     - super-admin email composer templates
```

---

## OAuth scopes

| Scope | Why |
|-------|-----|
| `openid` `email` `profile` | Identify the signed-in user |
| `meetings.space.readonly` | Read participant join/leave times from the active Meet call |
| `drive.file` | Create a "Meet Attendance Tracker" folder + spreadsheet in the user's Drive |
| `calendar.events.readonly` | Match the active meeting to a calendar event for RSVP / no-show data |

---

## Project structure

```
.
├── index.html                          - Side panel UI + landing page (loaded inside Meet OR at attendancetracker.dev)
├── admin.html                          - Super-admin dashboard (analytics + CRM + outreach tools)
├── history.html                        - Per-user history (Meetings / Series / People / Calendar tabs)
├── team.html                           - Team admin view (Users / Meetings / Series / People — org-wide)
├── share.html                          - Public share-link recipient page (read-only series view)
├── setup.html                          - Domain-wide-delegation walkthrough for Workspace admins
├── privacy.html / terms.html / support.html
├── how-to-track-attendance-in-google-meet.html  - SEO content
├── attendance-tracker-for-teachers.html         - SEO content
├── export-google-meet-attendance-to-sheets.html - SEO content
├── sitemap.xml / robots.txt
├── CNAME                               - GitHub Pages custom domain
├── js/utils.js                         - Shared pure helpers (loaded by index.html, tested via Jest jsdom)
├── icons/                              - 32/48/96/128 PNG + SVG source
│
├── backend/
│   ├── server.js                       - Express entry point
│   ├── Dockerfile                      - Cloud Run build
│   ├── package.json / package-lock.json
│   ├── jest.config.js                  - 2 projects: backend (node) + frontend (jsdom)
│   ├── public/                         - Mirror of root frontend files (served by Express static fallback)
│   │   ├── index.html                  (backendUrl = '/api' in this copy)
│   │   ├── js/utils.js
│   │   ├── team.html / history.html / share.html / admin.html
│   │   ├── sitemap.xml / robots.txt
│   │   └── (3 SEO content pages)
│   ├── src/
│   │   ├── app.js                      - Middleware pipeline + route mounting
│   │   ├── config.js                   - Env var loading + validation
│   │   ├── middleware/
│   │   │   ├── auth.js                 - JWT verify + token refresh
│   │   │   ├── rateLimit.js
│   │   │   └── requestId.js
│   │   ├── routes/
│   │   │   ├── attendance.js           - GET /api/attendance (Meet REST API proxy)
│   │   │   ├── sheets.js               - POST /api/save-to-sheets (export + notify)
│   │   │   ├── calendar.js             - GET /api/calendar-attendees
│   │   │   ├── oauth.js                - /exchange /me /revoke
│   │   │   ├── admin.js                - super-admin dashboard endpoints + cron sweeps
│   │   │   ├── public.js               - /stats /pageview /feedback /share/:token
│   │   │   ├── history.js              - /history /series /participant /event /share
│   │   │   ├── team.js                 - /team/overview (requireTeamAdmin gate)
│   │   │   └── settings.js             - /settings + /settings/test-slack
│   │   ├── services/
│   │   │   ├── firestore.js            - ALL DB access (tenant-scoped helpers, encryption, aggregations)
│   │   │   ├── googleAuth.js           - Service-account JWT + user OAuth token refresh
│   │   │   └── meetApi.js              - Meet REST API thin wrapper
│   │   ├── lib/
│   │   │   ├── notifications.js        - Resend email + Slack Block Kit digest
│   │   │   └── logger.js               - JSON structured logging (Sentry error escalation)
│   │   └── instrument.js               - Sentry bootstrap
│   └── test/
│       ├── setup-env.js                - Stub env vars before any src/ module loads
│       ├── helpers/
│       │   ├── firestoreMock.js        - In-memory Firestore stand-in
│       │   └── testApp.js              - authedHeader() + buildApp() for Supertest
│       ├── services/                   - 7 suites — alert eval, re-engagement, upsertUser, claims, aggregations, admin CRM, userSettings
│       ├── lib/                        - 2 suites — notifications + slack-digest
│       ├── routes/                     - 9 suites — every Express endpoint
│       └── frontend/                   - 2 suites — pure helpers via jsdom
│
├── e2e/                                - Playwright production smokes
│   ├── package.json
│   ├── playwright.config.js
│   └── tests/
│       ├── landing.spec.js             - Hero, SEO, sitemap, feedback widget
│       ├── backend-api.spec.js         - Health, public endpoints, auth gates, feedback round-trip
│       ├── visual.spec.js              - Visual regression baselines (8)
│       ├── visual-auth-pages.spec.js   - Auth-page login screen baselines (3)
│       └── visual-mobile.spec.js       - Mobile (Pixel 5) baselines (4)
│
├── .github/workflows/test.yml          - CI: Jest on every push, Playwright non-visual on main
├── scripts/setup-public-project.sh     - One-time GCP setup walkthrough
└── README.md
```

---

## Backend env vars (Cloud Run)

Required (server exits on startup if missing):

| Variable | Purpose |
|----------|---------|
| `GOOGLE_CLIENT_ID` | OAuth 2.0 web client ID |
| `OAUTH_CLIENT_SECRET_NAME` | Secret Manager resource for the OAuth client secret |
| `SESSION_SECRET` | 32-byte secret for signing session JWTs + encrypting refresh tokens (AES-256-GCM) |
| `SECRET_NAME` | Secret Manager resource for the service account JSON key |

Optional / feature-specific:

| Variable | Default | Purpose |
|----------|---------|---------|
| `RESEND_API_KEY` | _(none, emails skipped)_ | Resend transactional email key |
| `RESEND_FROM_DOMAIN` | `resend.dev` | Verified send-from domain (set to `attendancetracker.dev` once verified in Resend) |
| `SCHEDULER_SECRET` | _(none, cron blocked)_ | Shared secret for Cloud Scheduler → POST /api/admin/check-* endpoints |
| `MARKETPLACE_WEBHOOK_SECRET` | _(none, webhooks blocked)_ | Shared secret for POST /api/admin/install and /uninstall. Sent as the `x-marketplace-secret` header. Without it, only a super-admin session can call these (they write tenant config). |
| `PUBLIC_API_URL` | Cloud Run `…/api` | Absolute URL of this backend's `/api` mount; used to build email links (e.g. one-click unsubscribe) that must hit the API directly. |
| `IMPERSONATE_EMAIL` | _(none)_ | Legacy single-tenant fallback for the service account |
| `ADMIN_EMAIL` | _(none)_ | Workspace admin for Directory API enrichment |
| `ALLOWED_ORIGINS` | `https://attendancetracker.dev,https://derekgallardo01.github.io` | CORS allowlist (in addition to `https://meet.google.com`) |
| `ALLOWED_DOMAINS` | `*` | Tenant domain allowlist; `*` = public SaaS mode |
| `PORT` | `8080` | Cloud Run port |
| `GCP_PROJECT_ID` | auto | Firestore project ID |

---

## Deploying

### Backend (Cloud Run)

```powershell
cd backend
gcloud run deploy attendance-tracker-backend `
  --source=. `
  --project=attendance-tracker-490319 `
  --region=us-central1
```

Env vars persist across deploys — only update them when something changes:

```powershell
gcloud run services update attendance-tracker-backend `
  --update-env-vars "RESEND_FROM_DOMAIN=attendancetracker.dev" `
  --region=us-central1 `
  --project=attendance-tracker-490319
```

For multi-var updates that include commas (URL lists), use the `^##^` separator trick:

```powershell
gcloud run services update attendance-tracker-backend `
  --update-env-vars "^##^ALLOWED_DOMAINS=*##ALLOWED_ORIGINS=https://attendancetracker.dev,https://derekgallardo01.github.io" `
  --region=us-central1 --project=attendance-tracker-490319
```

### Frontend (GitHub Pages)

```bash
git push origin main
```

GitHub Pages auto-deploys from `main`. Custom domain (`attendancetracker.dev`) is set via `CNAME`. Allow 30-90 seconds to propagate.

**Important**: every frontend change touching `index.html` (or `team.html` / `history.html` / etc.) must be synced to `backend/public/`. Then re-fix the backend copy's `backendUrl` from the full Cloud Run URL to `/api`. The two `index.html` files must stay identical except for that one line.

### Cloud Scheduler (one-time setup for daily crons)

```bash
gcloud scheduler jobs create http series-alerts-daily \
  --schedule="0 14 * * *" \
  --uri="https://attendance-tracker-backend-829771833968.us-central1.run.app/api/admin/check-alerts" \
  --http-method=POST \
  --headers="x-scheduler-secret=<your-secret>" \
  --location=us-central1 \
  --project=attendance-tracker-490319

gcloud scheduler jobs create http reengagement-daily \
  --schedule="0 15 * * *" \
  --uri="https://attendance-tracker-backend-829771833968.us-central1.run.app/api/admin/check-reengagement" \
  --http-method=POST \
  --headers="x-scheduler-secret=<your-secret>" \
  --location=us-central1 \
  --project=attendance-tracker-490319
```

Manual trigger for testing:
```bash
curl -X POST .../api/admin/check-alerts \
  -H "x-scheduler-secret: <secret>" -H "Content-Type: application/json" -d '{}'
```

---

## Testing

```bash
# Backend + frontend (Jest, ~16s)
cd backend
npm test                  # all tests
npm run test:watch        # auto-rerun on change
npm run test:coverage     # HTML coverage report → backend/coverage/

# Production smokes (Playwright, ~8s, hits live URLs)
cd e2e
npm install
npx playwright install chromium
npm test                  # all incl. visual regression
npm run test:ci           # CI mode (skips platform-specific visual specs)
npm run test:visual       # visual regression only
npm run update-snapshots  # refresh visual baselines after intentional changes
```

CI runs on every push via `.github/workflows/test.yml`:
- `backend-unit-and-integration` job — Jest, every push + PR
- `e2e-smoke` job — Playwright non-visual, main pushes only

Visual baselines are platform-specific (Playwright stores them with the OS suffix), so they're only checked locally pre-push. Don't try to commit Windows baselines and expect them to pass on the Linux CI runner.

---

## Admin dashboard

Available at https://attendancetracker.dev/admin.html. Sign in with any Google account to see basic stats. The super-admin email (`derekgallardo01@gmail.com`) sees:

- **Insights**: activation funnel, WAU/MAU, retention, top orgs, churn risk
- **All Users**: every user across every tenant (cross-tenant `collectionGroup('users')` query)
- **Live activity feed** + **reach-out suggestions** + **power-user pipeline**
- **Outreach tools**: per-user notes, reminders, email composer with templates, conversation log
- **Weekly self-report**: scannable Monday-morning email digest

Founder CRM endpoints are all gated by `req.user.email === SUPER_ADMIN_EMAIL`.

---

## Marketplace listing

- **App ID:** `829771833968`
- **Listing:** https://workspace.google.com/marketplace/app/attendance_tracker/829771833968
- **OAuth verification:** approved
- **Visibility:** Public

Both the Marketplace SDK App Configuration scopes and the Google Auth Platform Data Access scopes must match the scopes the code actually requests. The current set is: `openid`, `email`, `profile`, `calendar.events.readonly`, `drive.file`, `meetings.space.readonly`.

---

## Common operations

### Rotate the service account key

```bash
gcloud iam service-accounts keys create new-key.json \
  --iam-account=attendance-tracker-sa@attendance-tracker-490319.iam.gserviceaccount.com \
  --project=attendance-tracker-490319

gcloud secrets versions add service-account-key \
  --data-file=new-key.json \
  --project=attendance-tracker-490319

rm new-key.json
```

Cloud Run picks up the new version on the next cold start (or redeploy to force it). The backend caches the key for 24h.

### Tail backend logs

```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=attendance-tracker-backend" \
  --project=attendance-tracker-490319 \
  --limit=100 --freshness=1h
```

### Domain-wide delegation (optional, per tenant)

For tenants that want to see all participants (including external guests) the Workspace admin can authorize the service account's client ID `106374345279786114388` for `meetings.space.readonly` at https://admin.google.com/ac/owl/domainwidedelegation. The setup flow is documented at https://attendancetracker.dev/setup.html.

Without delegation the app falls back to the signed-in user's OAuth token, which only sees participants from the same organization (still works for personal Gmail accounts running 1:1 meetings).
