# Test coverage status

**Backend: 86% statements / 87% lines / 80% branches / 80% functions — 1,002 tests.**

A regression gate is enforced in `jest.config.js` (`coverageThreshold.global`) and
runs in CI via `npm run test:coverage`. The floors are set just below the current
level: a PR that adds untested code fails the build. **Ratchet these up as
coverage climbs; never lower them.**

## Fully covered (100%)
All of `src/lib/`, `src/middleware/`, `src/services/{googleAuth,meetApi}`, every
`src/services/firestore/*` submodule **except analytics**, `src/app.js`,
`src/config.js`, and every route **except admin.js** (billing, calendar, history,
oauth, public, settings, sheets, team, attendance).

`src/services/firestore.js` is at **100% statements/functions, 87% branches**.

## Remaining to reach 100% (next session)
| File | Coverage | Work |
|------|----------|------|
| `src/routes/admin.js` | ~52% L / 48% B | ~20 CRM/outreach/scheduler handlers — happy paths + error catches + the cron-batch loops (check-reengagement, check-alerts) with time-budget branches. Biggest single file. |
| `src/services/firestore/analytics.js` | ~69% L / 46% B | The admin-analytics engine (getAggregatedInsights, getActivationFunnel, getAdvancedAnalytics). Needs rich seeded tenant datasets via `installFirestoreMock` to hit the funnel/segmentation branches. |
| `src/services/firestore.js` | 87% B | ~57 combinatorial rollup branch pairs (participant-identity, timestamp fallbacks, title-length, join/leave duration combos) in the getUserMeeting*/getTenant* aggregations. |

**Patterns that worked** (see the `/test` skill and existing tests):
- Error catches: a `_core`-mocked "throwing DB" smoke test (see `test/services/firestore-errors.test.js`).
- Aggregation branches: rich `installFirestoreMock` datasets (see `test/services/firestore-extra.test.js`).
- Route error paths: `mockRejectedValue`/`mockRejectedValueOnce` on the firestore/google mocks; watch for mock-implementation leakage between tests.
- Genuinely-unreachable defensive code (framework-guaranteed `req.body`, always-truthy guards, redundant `||` fallbacks): `/* istanbul ignore next */` with a one-line reason.

## Frontend

### Shared `js/` modules — 100%, gated ✅
`js/utils.js`, `js/api.js`, `js/strings.js` are at **100% statements / branches /
functions / lines** (113 jsdom tests). Because these files live in the repo-root
`js/` dir (outside the backend `rootDir`), coverage is measured by a dedicated
config, **`jest.frontend.config.js`** (rootDir = repo root, `coverageProvider: 'v8'`
— the babel provider can't instrument files required by absolute path). Run/gate
with `npm run test:coverage:frontend` (100% threshold, enforced in CI).

### HTML pages — NOT started (separate multi-session effort)
The **inline `<script>` logic in the pages has no coverage**. Reaching 100% there
requires **extracting `index.html`'s ~3,800 lines of inline JS into exported `js/`
modules** (plus admin/history/team/setup/share), then unit-testing them — a large
refactor, verified page-by-page in a browser since these pages have no automated
guard. Recommended order (smallest first): share → setup → team → history → admin
→ index. Playwright e2e (`e2e/`) covers landing + backend-API smoke only.
