# Attendance Tracker — Automated Daily Backlink Discovery & Outreach Routine

This guide documents the automated daily backlink discovery, Ahrefs CSV ingestion, Composite Opportunity Score queue builder, and 7-day follow-up engine for **Attendance Tracker (`attendancetracker.dev`)**.

---

## 1. Automated Scheduled Sidecar (`Daily Backlink Outreach & Reply Triage`)

Every morning at **9:00 AM `America/New_York`**, the scheduled automation runs automatically across `i:\Projects\attendance-tracker` and `i:\Projects\music-genie` to:

1. **Triage Gmail Replies (`mcp(gmail/gmail_search)`)**:
   - Checks `derek@attendancetracker.dev` and `support@musicgenie.ai` for new human replies from the last 24 hours.
   - Surfaces warm leads (e.g., partnership referrals, reciprocal link requests, free directory submission invites) and dispatches warm follow-ups.
2. **Ingest New Ahrefs CSV Exports & Build Daily Queue ([`scripts/daily-backlink-routine.cjs`](../scripts/daily-backlink-routine.cjs))**:
   - Automatically detects any new Ahrefs CSV exports in `C:\Users\Derek\Downloads\` (`meet-atten`, `google-mee`, `support.google.com-meet`, `scribbl.co`, `tactiq.io`, `attendlist.com`, `claycodes.org`, `meetlist.io`), converts UTF-16LE exports to UTF-8 in `docs/ahrefs-exports/`, and deduplicates against all dispatched waves (`docs/*-dispatch-log.json` and `scripts/send-*.cjs`).
   - Scores all remaining uncontacted domains using a **Composite Opportunity Score (0–100)** (DR weight + Dofollow bonus + Broken/Deprecated Chrome Extension bonus + `.edu`/`.gov`/`.org` authority bonus + Google Meet/attendance keyword relevance) and writes `docs/daily-outreach-queue.json`.
3. **Dispatch Daily Wave & 7-Day Follow-Ups**:
   - Dispatches the next verified wave of Attendance Tracker outreach emails via Resend (`Derek Gallardo <derek@attendancetracker.dev>`) and runs 1-touch 7-day follow-ups (`docs/followup-dispatch-log.json`).
   - Runs Music Genie's daily queue and wave dispatcher (`scripts/seo/daily-outreach-queue.cjs` + `scripts/seo/send-outreach-wave.cjs`).

---

## 2. CLI Commands (`i:\Projects\attendance-tracker`)

```powershell
# 1. Ingest new Ahrefs CSVs from Downloads + rebuild top 30 uncontacted queue
node scripts/daily-backlink-routine.cjs --ingest --queue --limit 30

# 2. Preview 7-day follow-ups (dry-run)
node scripts/daily-backlink-routine.cjs --follow-up --dry-run --limit 10

# 3. Dispatch 7-day follow-ups live via Resend
node scripts/daily-backlink-routine.cjs --follow-up --send --limit 10
```

---

## 3. High-Yield Ahrefs CSV Exports to Drop into `C:\Users\Derek\Downloads\` Anytime

Whenever you want to top up the uncontacted domain pool, export any of these targets in **Ahrefs Site Explorer -> Backlinks** (One link per domain, All / Dofollow, Export UTF-8 or UTF-16 CSV directly into `C:\Users\Derek\Downloads\`):

1. `chrome.google.com/webstore/detail/google-meet-attendance/fkdjflnaggakjamjkmimcbfefhppfljd` (Al Caughey's delisted *Google Meet Attendance* extension — `Prefix` mode)
2. `chrome.caughey.ca` (Al Caughey's companion help site — `Subdomains` mode)
3. `chromewebstore.google.com/detail/meet-attendance/nenibigflkdikhamlnekfppbganmojlg` (New `chromewebstore.google.com` host URL for delisted ClayCodes extension — `Prefix` mode)
4. `chromewebstore.google.com/detail/google-meet-attendance-li/appcnhiefcidclcdjeahgklghghihfok` (New `chromewebstore.google.com` host URL for *Google Meet Attendance List* — `Prefix` mode)
5. `bluedot.hq` / `bluedothq.com` (Google Meet bot-free recorder competitor — `Subdomains` mode)
