---
name: refactor
description: Behavior-preserving refactoring for the Attendance Tracker codebase — find and safely remove duplication/dead code across the Node/Express+Firestore backend and the static frontend. Use when asked to refactor, dedup, clean up, or consolidate code, or to hunt for "refactor opportunities". Not for feature work or behavior changes.
---

# Refactor (Attendance Tracker)

Reduce duplication and dead code **without changing behavior**. The test suite is the safety net for the backend; the non-`index.html` frontend pages have **no automated tests**, so they need extra care and human verification.

## Golden rules

1. **Behavior-preserving, always.** If a "pure swap" needs a non-mechanical change to keep output identical, STOP — that's a behavior shift, not a refactor. Leave it and note why. (Example: the per-page `fmt*`/date helpers were left inline because their signatures — iso-string input, em-dash fallbacks, `hour:'numeric'` vs `'2-digit'` — differ from the shared `AttUtils` versions.)
2. **One logical dedup per commit.** Small, reviewable, individually revertible.
3. **Run the guard after every backend step:** `cd backend && npx jest` (expect all green — 699+ at last count, 35 suites). Never commit backend changes without a green run.
4. **After any frontend edit:** `npm run sync:public` then `npm run check:public` (CI enforces the mirror). The mirror copies root HTML/JS into `backend/public/`; only `index.html` differs (its backendUrl is rewritten to `/api`).
5. **Skip net-negative trades.** A dedup that adds a fragile dependency for tiny gain is not worth it. Judged net-negative before:
   - Extracting ~3 identical CSS lines into a render-blocking external stylesheet (a fetch failure would unstyle the whole page).
   - Loading a shared JS module into a page just for one constant, when the module exists to dedup a flow that page doesn't have.
6. **No Claude attribution** in commits/PRs (standing global rule): use Derek's git identity, no `Co-Authored-By`, no "Generated with" footer, no `claude/` branch names.

## Workflow

1. **Explore first.** Grep for repeated blocks across the least-touched areas (non-admin routes, libs, the non-`index.html` HTML pages). Verify each candidate is *actually* identical before treating it as dedupable — read all copies.
2. **Tier by risk.** Do test-guarded backend dedup first, then observability/mechanical fixes, then frontend helper swaps, then bigger consolidations last. Stop at any tier where a test needs a non-mechanical change.
3. **Reuse existing patterns**, don't invent new ones:
   - Guard middlewares: `requireAuth` (`middleware/auth.js`), `requireTeamAdmin`/`requireSuperAdmin` (`middleware/adminAuth.js`), `requireProPlan` (`routes/billing.js`).
   - Shared FE module pattern: `js/utils.js` / `js/api.js` — IIFE exposing both `window.AttXxx` and `module.exports`, jsdom-tested under `backend/test/frontend/`. Loaded via `<script src>` in `<head>`; pages keep thin local wrappers/aliases so call sites don't churn.
   - Backend shared libs live in `backend/src/lib/` (e.g. `slack.js`, `notifications.js`).
4. **Add a test when you create a shared module** (jsdom test in `backend/test/frontend/` for FE modules).
5. **Commit each unit** with a message that states the dedup and confirms "behavior-preserving; N green".
6. **Frontend has no test guard** — after converting a page, it must be verified live in a browser (sign-in + each view renders). Convert auth-touching pages **one at a time** and hand off for prod verification before continuing.

## Known traps (learned the hard way)

- **Module-level state during extraction.** When splitting a file, state declared *outside* functions (caches, module constants) is easy to strand in the wrong module — tests catch it, but look for it up front.
- **Test mocks coupled to helper names.** `jest.mock('../../src/services/googleAuth', ...)` factories list specific exports; if you introduce a new helper (e.g. `getGoogleClient`) the route calls, add it to the mock or the suite fails with "X is not a function".
- **`function` → `const` loses hoisting.** When converting an inline `function esc(){}` to `const esc = ...`, confirm no call site runs before the declaration (TDZ).
- **Heredocs mangle JS backslashes.** For scripted mechanical refactors, write the Node script via the Write tool to the scratchpad, don't inline it in a bash heredoc (`\\n` → `\n`).
- **Cloud Run env merges.** Use `--update-env-vars` / `--update-secrets` (not `--set-*`, which clobbers existing config).

## Verification checklist before calling it done

- [ ] `cd backend && npx jest` — all green
- [ ] `npm run check:public` — mirror in sync (if any FE file changed)
- [ ] Each commit is one logical change with a behavior-preserving message
- [ ] Any untested frontend page change is flagged for the user to verify live
- [ ] Net-negative or non-mechanical candidates were skipped and noted, not forced
