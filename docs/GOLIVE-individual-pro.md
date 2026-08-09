# Go-live runbook — Individual (per-user) Pro tier

The individual Pro tier lets personal-email users (gmail.com etc.) buy a per-USER
subscription — they can't buy the per-domain org plan because their tenant is
shared. It is **dark-launched**: the code is on `main`, but until the env var
`STRIPE_INDIVIDUAL_PRICE_ID` is set, personal users stay 100% free (no behavior
change). See `backend/src/routes/billing.js` and the 2026-08-09 note in the
monetization-decisions memory for the design.

## Facts
- GCP project: `attendance-tracker-490319` · Cloud Run service:
  `attendance-tracker-backend` (region `us-central1`).
- Org (team) price already live: `price_1TwOW5RPP93YBXrOgyxejaaM` ($19/mo,
  product `prod_Uv7QFqPvrmrbJ1`). Stripe is in **live** mode.
- The switch: env var **`STRIPE_INDIVIDUAL_PRICE_ID`** (plain env var, like
  `STRIPE_PRICE_ID`).
- **No webhook change needed.** The individual flow reuses the existing endpoint
  (`…/api/billing/webhook`) and the same three events
  (`checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`); the code routes org vs. individual by the
  subscription's `metadata.individual` flag.

## Step 1 — Create the individual price in Stripe (live mode)
1. Dashboard → **Products** → open **Attendance Tracker Pro**
   (`prod_Uv7QFqPvrmrbJ1`) → **+ Add another price** (or make a separate product
   "…— Individual" if you prefer cleaner reporting; only the price ID matters).
2. Recurring, **monthly**, USD. Suggested **$8/mo** (well below the $19 org
   price; $6 to reduce friction for teachers). Keep it in sync with
   `pricing.html`.
3. Copy the new **price ID** (`price_…`) → this is `PRICE_IND` below.

## Step 2 — Deploy + flip it on (one command)
Deploys everything on `main` (education/monetization **plus** the earlier
undeployed security-hardening + KH changes) and sets the price in one revision:
```bash
gcloud auth login   # if the session has expired

gcloud run deploy attendance-tracker-backend \
  --source backend \
  --region us-central1 \
  --project attendance-tracker-490319 \
  --update-env-vars STRIPE_INDIVIDUAL_PRICE_ID=PRICE_IND \
  --quiet
```
To also enable the KH command-center endpoints, append them (comma-separated):
`…STRIPE_INDIVIDUAL_PRICE_ID=PRICE_IND,KH_METRICS_KEY=…,KH_INGEST_KEY=…,KH_MRR_SEAT_CENTS=1900`

## Step 3 — Verify end-to-end (with a real personal Gmail)
1. `history.html` signed in as a **gmail.com** account → **Series** tab → the
   green **Upgrade to Pro** CTA appears (promotes the Class Summary export).
2. Click it → Stripe Checkout shows **your individual price** (not $19). Complete
   it (refundable test purchase in live mode).
3. Firestore: `tenants/gmail.com/users/<you>` now has `individualPlan: "pro"`
   (written by the webhook — the USER doc, not the tenant).
4. Re-open `history.html` → CTA flips to **Pro ✓ · Manage billing**.
5. Export a **recurring-series** meeting → the sheet gains a **"Class Summary —
   …"** tab with per-student attendance % across sessions.
6. A *different* gmail account is still **free** (per-user, not per shared tenant).

Server check:
```bash
curl -s -H "Authorization: Bearer <your-jwt>" \
  https://attendance-tracker-backend-829771833968.us-central1.run.app/api/billing/status
# expect: {"plan":"pro","individual":true,"billingConfigured":true,...}
```

## Rollback
Unset the var → personal users return to fully-free instantly, no code change:
```bash
gcloud run services update attendance-tracker-backend \
  --region us-central1 --project attendance-tracker-490319 \
  --remove-env-vars STRIPE_INDIVIDUAL_PRICE_ID
```

## Separate, do regardless
- **Rotate the live Stripe keys** that were pasted into chat (Dashboard →
  Developers → API keys → roll `sk_live_…`; update the `stripe-secret-key`
  Secret Manager secret).
