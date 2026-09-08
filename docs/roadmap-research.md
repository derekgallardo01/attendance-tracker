# Roadmap research — competitors, voice of customer, content & listing

Compiled 2026-09-08 from three parallel research sweeps: a competitor product
teardown (Chrome Web Store + Marketplace, live install/rating data), a
voice-of-customer mine (CWS 1-star reviews, Google support forums, Reddit via
archive, compliance/procurement sources), and an SEO/listing landscape scan.
Full agent reports with all source URLs live in the session transcripts; this
doc is the synthesized, decision-ready version.

---

## 1. The market in one paragraph

The category is large (top rival: 726K Marketplace installs) but rotten:
the biggest extension by users (Clay Codes, 500K) is at 2.8★, unmaintained
since Feb 2023, and hated for surprise subscription billing; two other tools
are abandoned, one was delisted in 2025, and one Marketplace add-on
("Attendance Taker for Classroom") is being force-retired **March 1, 2026**.
Every major rival is either free-with-no-business or a $9.90+/mo subscription.
Extensions structurally break on Meet UI updates and can't run on
Firefox/Safari/managed Chromebooks. Nobody has a demo video on their listing,
nobody localizes, and the best content site in the niche has 21 URLs to our
52. Our weaknesses: 2 reviews at 3K installs, the harshest free tier in the
category (3 exports/mo vs everyone's unlimited), and several already-solved
differentiators nobody knows about.

## 2. Feature roadmap — ranked build candidates (post-telemetry)

| # | Feature | Effort | Why (evidence) |
|---|---------|--------|----------------|
| 1 | **Attendee self-check-in ("I'm here")** | S/M | 296K installs prove the demand (Meeting Notes & Attendance). Structural moat: as an add-on, every attendee has our side panel — extensions cannot render UI on students' screens. Also fixes anonymous/display-name identity, and is the foundation for compliance-grade attestation (the paid L&D segment requires attendee-signed, timestamped presence records). |
| 2 | **Presence-policy rule engine** | S | Configurable min-% / min-minutes / grace rules that auto-assign Present/Late/Absent. CEU bodies mandate numeric thresholds ("at least 75 of 90 minutes"); a rival hard-codes 65% and users like it. Bridges education → compliance training. |
| 3 | **Register email hardening** | S | "Email me the register" alone drove 464K installs (Meets Attendance Registers). We have the Pro auto-export email; gap is configurable recipients (co-teacher, admin list) + positioning. |
| 4 | **Roster cloud sync + persistent name aliasing** | M | Our rosters are localStorage-only — the cross-device complaint that dings the 726K leader applies to us too. Alias mapping ("iPhone" → Maria) was the delisted Attendance Collector's marquee feature. |
| 5 | **Free-tier rebalance** (decision) | — | Whole category is free-unlimited; our 3/mo cap is the harshest, and billing anger is the category's loudest 1★ driver. Consider: unlimited manual Sheets exports free; keep Pro = auto-capture, digests, semester roll-ups, certificates, org features. Gate scale & compliance, never core capture. |
| 6 | **Org roll-up dashboard + outbound webhook/API** | M | Admins explicitly ask for cross-host reporting without granting Workspace admin rights; AttendList's $29/mo tier is defined by API access. This is the site-license maker. |
| 7 | **Hybrid: "mark present in-room" toggle** (then QR check-in) | S→M | Post-2022 hybrid classrooms consolidate two rosters by hand today. The toggle is cheap; QR check-in later extends rosters/certificates to in-person with zero Meet-API dependency. |
| 8 | **Canvas REST + Moodle web-services attendance writeback** | M/L | "The report exists, but someone still has to act on it." OneRoster doesn't carry attendance; Zoom↔Canvas LTI is university-endorsed and Moodle has no equivalent. Moves us teacher-tool → institution-tool. Full LTI 1.3 registration is a later, larger step. |
| 9 | **Procurement trust pack** | S | Published DPA, student-data-privacy pledge, public changelog ("N updates shipped this year" vs a category of abandonware). 62% of mid-size tutoring centers reportedly dropped extensions over security; being an admin-installable Marketplace app with paperwork is what converts $19.99 into site licenses. |

Smaller delights: random student picker (S; listing bullet), "still there?"
prompts (engagement framing only — reaches only open panels), speaking time
(conditional on transcripts + eligible edition; best-effort only).

**Never build** (public APIs expose none of it; some reputationally toxic):
camera/attention state, chat contents, reactions, breakout-room membership,
auto-admit. Zoom removed attention tracking in 2020 under privacy backlash.
Use as marketing honesty: "Google's own report includes breakout rooms; no
third-party tool can — here's why."

## 3. Content pipeline (beyond the 4 pages shipped with this research)

Next batch candidates, in order: recurring-meetings attendance ·
admin-console "attendance greyed out" (admin persona = domain-license buyer) ·
FERPA/GDPR page (pairs with trust pack) · speaking-time/participation
explainer · Google-Form-attendance + a `/tools/` QR generator (linkbait) ·
Apps Script DIY page · attendance-vs-transcript disambiguation ·
timesheets/payroll page (only non-EDU buyer page) · save-Meet-chat page.

Copy claims to surface everywhere relevant (all true, all unmarketed):
merges rejoins (Google's report doesn't itemize them) · full external emails
(Google masks with asterisks) · works with 1 participant (built-in needs 2+) ·
real-time roster (built-in is a post-meeting email to the host only) ·
hands-free capture (the #1 rival 1★: "failed to detect I entered a meeting").

## 4. Localization order

1. **pt-BR** — native-language competitor exists, Brazilian universities
   publish DIY guides, Tactiq localizes its attendance article to pt-br, and
   no attendance competitor has a pt-BR site or listing. Do both: a small
   site cluster AND a localized Marketplace listing (Marketplace serves
   per-language listings; nobody does this).
2. **Indonesian** — real native-language demand (absensi Google Meet), incl.
   education-ministry platform content.
3. **Spanish cluster expansion** — our single page competes against an entire
   Spanish tool/content ecosystem; grow to ~5 pages.

Note: our Indonesia/Vietnam geo pages are English, but those markets search
in their own languages — treat them as brand-landing pages, not SEO winners.

## 5. Marketplace listing plan

Current: 3K+ installs, 5.0★ from 2 reviews, 4 screenshots, no video.

1. **Review velocity is the single biggest lever** — rankings weigh count +
   recency; 2 reviews reads "unproven". Re-tune the in-product review ask to
   fire right after a successful export; email the educator cohort. Target
   50+ reviews.
2. **Demo video (30–60s)** — no competitor in the niche (nor Kami) has one.
3. **Screenshots 4 → 8–10** — first: populated roster inside a real Meet;
   second: the resulting Sheet; annotate with callouts.
4. **Tagline**: lead with "take attendance" keyword + social proof number
   once credible; the tagline is the card copy in search.
5. **Category reconciliation** (Education "Teacher & admin tools" — the
   Education top-20 has no attendance app at all).
6. **Price transparency line** — "one-time purchase, nothing to cancel" is a
   direct answer to the category's dominant complaint.
7. Later: pt-BR localized listing; consider a thin companion Chrome
   extension listing for the extension-searching audience (the 726K leader's
   Marketplace listing outperforms its own extension 7:1, but the audience
   exists).

## 6. Pricing posture (evidence-backed)

- Sub-$20 one-time clears teachers' personal spending (43% buy tools with
  their own money) and skips procurement. Keep it.
- Lifetime framing is our wedge against the category's billing rage — say
  "nothing to cancel" out loud on the listing and pricing page.
- Institutional headroom is large (SIS suites run ~$10k/yr); the domain
  license can carry a higher-priced org tier once the trust pack + org
  roll-up exist. Gate on scale/compliance, never on core capture.
