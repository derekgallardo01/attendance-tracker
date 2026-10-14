# High-DR Broken Link Outreach & Listicle Insertion Dossier

This document outlines the background research, verified editorial contacts, broken link locations, and tailored pitches for:
1. **BizBash** (DR 79) — Broken Tactiq link replacement
2. **Tipalti** (DR 78) — Broken Tactiq link replacement
3. **StarterStory** (DR 76) — Broken Tactiq link replacement
4. **Tinrec** (DR 9) — Comparison guide feature pitch (*"2026 Google Meet Attendance Guide"*)

---

## Target Matrix

| Target | DR | Contact Email | Subject Line | Pitch Type | Key Asset Offered |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **BizBash** | 79 | `skloepple@bizbash.com`, `editorial@bizbash.com` | `quick heads-up on a broken link in your AI events column` | Broken Link (404) | `track-attendance-for-webinars-and-training-google-meet.html` |
| **Tipalti** | 78 | `contact@tipalti.com` | `404 link in your ChatGPT for finance guide` | Broken Link (404) | `how-to-track-attendance-in-google-meet.html` |
| **StarterStory** | 76 | `pat@starterstory.com` | `dead link on the Tactiq starter story interview` | Broken Link (403) | `see-who-attended-google-meet-after-it-ended.html` |
| **Tinrec** | 9 | `official@tinrec.com` | `建議收錄：Google Meet 出席紀錄評測補充（原生 REST API v2 與 Classroom 同步）` | Guide Feature Pitch | `best-google-meet-attendance-extensions.html` + Workspace Marketplace |

---

## Automation Script
All pitches can be tested and sent using:
```bash
# Dry run
node scripts/send-broken-and-listicle-outreach.cjs --dry-run

# Test preview to Derek's inbox
node scripts/send-broken-and-listicle-outreach.cjs --test --target=1

# Live send
node scripts/send-broken-and-listicle-outreach.cjs --send --all
```
All live sends log message IDs and timestamps to `docs/broken-and-listicle-dispatch-log.json`.
