---
name: test
description: Write and run tests for the Attendance Tracker codebase (Jest — Node for backend, jsdom for shared frontend modules). Use when adding or updating tests, when a change needs test coverage, or when diagnosing a failing suite. Covers the repo's test layout, mocking helpers, and conventions.
---

# Test (Attendance Tracker)

Jest is the whole safety net. Backend code is well-covered (699 tests / 35 suites at last count); the shared frontend modules (`js/utils.js`, `js/api.js`, `js/strings.js`) have jsdom tests, but **the HTML pages themselves have no automated tests** — they're verified live in a browser.

## Running

- Full suite: `cd backend && npx jest` (must be green before any commit that touches `backend/`).
- Filter: `npx jest <pattern>` (e.g. `npx jest oauth`, `npx jest test/frontend/api.test.js`).
- Two Jest **projects** run together: `backend` (`testEnvironment: node`, covers `test/{services,lib,routes}`) and `frontend` (`testEnvironment: jsdom`, covers `test/frontend`). Config: `backend/jest.config.js`.
- `clearMocks`/`restoreMocks` are on; `testTimeout` is 10s. `test/setup-env.js` seeds required env vars before `src/` loads (config.js `required()` calls `process.exit(1)` if one is missing) — **add any new required env var there** or suites fail at module load.

## Layout & where a new test goes

- `test/routes/*.test.js` — HTTP endpoints, via `supertest`.
- `test/services/*.test.js` — Firestore service modules (`src/services/firestore/*`).
- `test/lib/*.test.js` — pure libs (`notifications`, `slack`, `html`, `logger`, …).
- `test/frontend/*.test.js` — the shared `js/*.js` modules under jsdom.
- `test/helpers/` — shared harness (see below). Don't reinvent these.

## Backend route tests (the common case)

Use the shared app builder + auth helper from `test/helpers/testApp.js`:
```js
const request = require('supertest');
const { buildApp, authedHeader } = require('../helpers/testApp');
// authedHeader(email, domain, displayName) → { Authorization: 'Bearer <jwt>' }
// signed with the test SESSION_SECRET, so the real auth middleware accepts it.

const res = await request(app).get('/api/history').set(authedHeader('u@acme.com', 'acme.com'));
expect(res.status).toBe(200);
```
Assert **both** status and the meaningful body shape. Cover the guard matrix explicitly: no Bearer → 401, wrong role → 403/402, happy path → 200. Never hit real network — mock Resend, Stripe, and Google.

## Mocking

- **Firestore:** `test/helpers/firestoreMock.js` — `installFirestoreMock`, `wrapTimestamp`, `MockFieldValue`. Use `wrapTimestamp` for fields the code reads via `.toDate()`.
- **Google / Firestore service modules:** `jest.mock('../../src/services/googleAuth', () => ({ ... }))`. ⚠️ **The factory must list every export the code under test calls.** Adding a new helper the route uses (e.g. `getGoogleClient`) without adding it to the mock fails with "X is not a function" — a known trap when refactoring (see the `/refactor` skill).
- **Email:** `RESEND_API_KEY` is deliberately unset in `setup-env.js`; tests either mock Resend or assert the "skipped" branch. Don't assert on exact log strings — several refactors normalize wording; assert behavior/return values instead.
- Some `src/` modules cache singletons (Firestore, Resend clients). If a test needs a fresh module, `jest.resetModules()` in that file — don't rely on global reset.

## Frontend (jsdom) tests

- Start the file with the docblock `/** @jest-environment jsdom */`.
- **Require the module from the root `js/` dir, NOT `backend/public/js/`** (that's the synced mirror): `require(path.join(__dirname, '..', '..', '..', 'js', 'utils.js'))`. The modules dual-export `window.AttXxx` + `module.exports`, so `require` returns the same API the browser gets.
- These modules are intentionally **DOM-free and pure** (`js/utils.js` header says so) — test them as pure functions. Anything DOM-coupled (sign-in, `authedFetch`) is thin; stub `global.fetch` and assert the call shape rather than the network.
- **When you add a shared FE module, add a jsdom test for its contract** (constants + that key functions exist + pure-helper behavior), mirroring `test/frontend/api.test.js`.

## Conventions

- `describe`/`test` names state the behavior ("401 without Bearer header", "escapes script-tag attempts"), not the function name.
- One behavior per `test`; prefer several focused assertions over one mega-test.
- New feature or bug fix → add/extend a test in the same PR. Bug fix → add the regression test that fails before the fix.
- Keep the exports-shape guard (`test/services/exports.test.js`) green — it pins the public service surface.
- No Claude attribution in commits (standing global rule): Derek's git identity, no `Co-Authored-By`, no "Generated with" footer.

## Checklist before done

- [ ] `cd backend && npx jest` — all green
- [ ] New required env vars added to `test/setup-env.js`
- [ ] New mocks list every export the code under test calls
- [ ] New shared FE module has a jsdom contract test
- [ ] Tests assert behavior/return values, not brittle log strings
