# Attendance Tracker — working rules for Claude sessions

Google Meet add-on (side panel) + marketing site on GitHub Pages
(attendancetracker.dev, via Cloudflare) + Node/Express/Firestore backend on
Cloud Run (`attendance-tracker-backend`, project `attendance-tracker-490319`,
us-central1). Multiple Claude sessions often work this repo in parallel —
check `git status`/`git log` before assuming the tree is yours alone.

## The mirror (breaks CI if forgotten)

- Root HTML/JS is the source of truth; `backend/public/` is a generated
  mirror. After ANY frontend edit: `npm run sync:public`. CI runs
  `npm run check:public` and fails when stale.
- New page or `js/` file? Add it to `MIRRORED` in `scripts/sync-public.mjs`
  AND to `sitemap.xml` (pages only). The check only verifies files ON the
  list — an unlisted file 404s on the Cloud Run copy silently.
- `index.html` is the one transformed file (its `backendUrl` becomes `/api`
  in the mirror). Never hand-edit `backend/public/*`.

## Meet iframe sandbox (three traps, all learned the hard way)

1. **No `allow-downloads`** — anchor-click downloads are silently swallowed.
   All panel downloads go through the `download.html` relay tab
   (`relayDownload`/`triggerCsvDownload` in index.html).
2. **Storage partitioning** — the panel's localStorage is NOT the same store
   as top-level attendancetracker.dev tabs. Cross-context handoff must use
   postMessage (the relay does); panel-internal localStorage is fine.
3. **No `allow-modals`** — `confirm()`/`alert()`/`prompt()` are silently
   ignored in index.html. Use `armedConfirm()` (click-again pattern) and
   toasts/inline errors. Top-level pages (history.html etc.) may use them.

Also: modal overlays cover the bottom toast — validation inside a modal must
render inside the modal (see `#roster-modal-error`).

## i18n (breaks tests if forgotten)

- `js/strings.js` holds 30 locales; a parity test requires EVERY `en` key to
  exist in all 30. Adding a key = adding 30 translations (use the generator
  pattern: script that inserts after each `"xx": {` line — see memory /
  scratchpad `add-i18n-keys*.js`). `zh` = Traditional, `zh-CN` = Simplified.
- User-facing strings in index.html go through `t('key', 'English fallback')`
  or `data-i18n`; missing keys fall back to the English text (never blank).
- JS-set text is NOT re-translated by `applyTranslations` on language change —
  re-run the painter (see `updateUiLanguage`'s `selectWebhookProvider` hook).

## Coverage gates (CI runs them on every push)

- Frontend `js/**` is held to **100% statements/branches/functions/lines**
  (`backend/jest.frontend.config.js`, v8 provider). Every new pure function
  needs tests covering every branch side, including `||` fallbacks.
- Backend floors: 86/80/80/87 — branch margin is thin (~+0.3); test what you
  add.
- New `js/` module? Register it in `test/frontend/modules-node-env.test.js`.

## Backend conventions

- Frontend event beacons must be in `FRONTEND_EVENT_TYPES`
  (`backend/src/routes/history.js`) or they 400 silently. Server-side
  `logEvent()` calls bypass the allowlist.
- Webhook validators exist twice ON PURPOSE: `backend/src/lib/{slack,googleChat,discord}.js`
  and `js/utils.js` must stay character-equivalent.
- Pro gating: `planIsPro(domain, email)` — individual passes live on the USER
  doc and are honored for personal AND workspace domains; domain plans on the
  tenant doc. Auto-capture, digests, email summaries, certificates, semester
  exports are Pro. `/save-to-sheets` enforces the 3/month free quota; nothing
  else is quota'd. Upsells stay GENTLE (no popup spam — flash existing CTAs).
- Classroom routes use the user's token ONLY (`makeUserClient`) — the
  `getGoogleClient` service-account fallback must never be reachable there.
- Jest gotcha: `clearMocks` clears calls, NOT implementations — use
  `mockResolvedValueOnce` for one-off overrides of shared factory defaults.

## Deploys & propagation

- Frontend: `git push origin main` → GitHub Pages in 30–90s, BUT pages are
  served with `max-age=600` — an open Meet panel picks changes up only after
  ~10 min or a DevTools disable-cache reload. Verify with `curl | grep`
  markers, not by eyeballing a browser.
- Backend: `cd backend && gcloud run deploy attendance-tracker-backend
  --source=. --project=attendance-tracker-490319 --region=us-central1`.
  Smoke: `/api/public/stats` → 200.
- Playwright e2e (`e2e/`) runs against LIVE prod; `backend-api.spec.js` sends
  a real feedback email per run. Visual specs are Windows-local only.

## Copy & legal consistency

- Pricing appears in: pricing.html, terms, refunds, FAQ/help, the Marketplace
  listing (`docs/marketplace-listing.md` → pasted manually into the console),
  and SEO pages. Current truth: Free (3 Sheets exports/mo) · $9.99 lifetime
  individual · $4.99/yr educator · $19.99 lifetime domain. If pricing changes,
  grep all of them.
- `faq.html` and `help.html` are the same document; edit faq.html, regenerate
  help.html by swapping ONLY the `og:url` line (help's canonical deliberately
  points at faq.html).
- New OAuth scopes must be reflected in privacy.html's scope list AND the
  Limited Use section stays intact (Google verification requirement).

## Never do

- Commit as Claude or add AI-attribution trailers (see global CLAUDE.md).
- Use `confirm()`/`alert()` in index.html.
- Add a frontend event type without allowlisting it.
- Edit `backend/public/*` directly.
- Ship a `js/strings.js` key to fewer than 30 locales.
