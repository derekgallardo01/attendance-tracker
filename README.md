# Attendance Tracker

A Google Meet add-on that tracks who joins, who leaves, and how long they stay -- then exports attendance reports to Google Sheets with one click. Available on the [Google Workspace Marketplace](https://workspace.google.com/marketplace/app/attendance_tracker/829771833968).

- **Live site:** https://attendancetracker.dev
- **Backend:** https://attendance-tracker-backend-829771833968.us-central1.run.app
- **GCP project:** `attendance-tracker-490319` (project number `829771833968`)

---

## Architecture

| Component | Location | Tech |
|-----------|----------|------|
| Frontend (side panel + landing page) | GitHub Pages (`attendancetracker.dev`) | HTML/JS, Meet Add-ons SDK |
| Backend | Google Cloud Run (`us-central1`) | Node.js / Express |
| Data store | Google Firestore (tenant-scoped) | Native mode |
| Auth | OAuth 2.0 (user) + Service Account JWT (admin delegation) | Google Identity Services + Secret Manager |
| Error tracking | Sentry | `@sentry/node` + browser SDK |

### Data model

Firestore is tenant-scoped under `tenants/{domain}`:

```
tenants/{domain}                     - install config, admin email, delegation status
tenants/{domain}/users/{email}       - user profile + encrypted refresh token
tenants/{domain}/meetings/{id}       - meeting metadata + participant snapshots
tenants/{domain}/meetings/{id}/participants/{userId}
tenants/{domain}/exports/{auto-id}   - export audit trail
```

---

## OAuth scopes

| Scope | Why |
|-------|-----|
| `openid` `email` `profile` | Identify the signed-in user |
| `calendar.events.readonly` | Match the active meeting to a calendar event for the invited-vs-attended view |
| `drive.file` | Create a "Meet Attendance Tracker" folder + spreadsheet in the user's Drive (per-user export sheet) |
| `meetings.space.readonly` | Read participant join/leave times from the active Meet call |

---

## Project structure

```
.
├── index.html                  - Side panel UI + landing page (served from GitHub Pages)
├── admin.html                  - Admin dashboard (analytics + super-admin all-users view)
├── privacy.html / terms.html / support.html
├── CNAME                       - GitHub Pages custom domain
├── icons/                      - 32/48/96/120/128 PNG + SVG source
├── scripts/setup-public-project.sh - One-time GCP setup walkthrough
└── backend/
    ├── server.js               - Express entry point
    ├── Dockerfile              - Cloud Run build
    ├── public/index.html       - Mirror of root index.html (served by Express when needed)
    └── src/
        ├── app.js              - Middleware pipeline + route mounting
        ├── config.js           - Env var loading + validation
        ├── middleware/         - JWT auth, rate limit, request ID
        ├── routes/             - attendance, sheets, calendar, oauth, admin
        └── services/           - googleAuth, meetApi, firestore
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

Optional:

| Variable | Default | Purpose |
|----------|---------|---------|
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

Env vars persist across deploys -- only update them when something changes:

```powershell
gcloud run services update attendance-tracker-backend `
  --update-env-vars "^##^ALLOWED_DOMAINS=*##ALLOWED_ORIGINS=https://attendancetracker.dev,https://derekgallardo01.github.io" `
  --region=us-central1 `
  --project=attendance-tracker-490319
```

The `^##^` prefix tells gcloud to use `##` as the separator so commas inside URL lists aren't misparsed.

### Frontend (GitHub Pages)

```bash
git push
```

GitHub Pages auto-deploys from `main`. Custom domain (`attendancetracker.dev`) is set via `CNAME`. Allow 1-2 minutes to propagate.

---

## Admin dashboard

Available at https://attendancetracker.dev/admin.html. Sign in with any Google account to see:

- Total organizations installed
- Your domain's users, meetings, exports
- List of all installed tenant domains

When signed in as the super admin (`derekgallardo01@gmail.com`), an additional **All Users** section appears listing every user across every tenant -- backed by a Firestore `collectionGroup('users')` query.

---

## Marketplace listing

- **App ID:** `829771833968`
- **Listing:** https://workspace.google.com/marketplace/app/attendance_tracker/829771833968
- **OAuth verification:** approved
- **Visibility:** Public

Both the Marketplace SDK App Configuration scopes and the Google Auth Platform Data Access scopes must match the scopes the code actually requests. The current set is: `userinfo.email`, `userinfo.profile`, `calendar.events.readonly`, `drive.file`, `meetings.space.readonly`.

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
  --limit=100 \
  --freshness=1h
```

### Domain-wide delegation (optional, per tenant)

For tenants that want to see all participants (including external guests) the Workspace admin can authorize the service account's client ID `103579252822182721837` for `meetings.space.readonly` at https://admin.google.com/ac/owl/domainwidedelegation. The setup flow is documented at https://attendancetracker.dev/setup.html.

Without delegation the app falls back to the signed-in user's OAuth token, which only sees participants from the same organization.
