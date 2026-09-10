const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const CONFIG = require('../config');
const log = require('../lib/logger');
const { upsertTenantConfig, getTenantConfig, getDb, getAllUsersAcrossTenants, getAggregatedInsights, setUserAcquisitionSource, getOutreachList, getRecentActivity, getActivityPulse, getRevenueFunnel, getReachOutSuggestions, getPowerUserPipeline, markUserContacted, getUserDetail, setAdminNote, searchAdminNotes, appendConversation, setOutreachStatus, createReminder, markReminderDone, getDueReminders, getEmailTemplates, setEmailTemplates, getAdvancedAnalytics, getWeeklySelfReport, getActivationFunnel, evaluateSeriesAlerts, claimDailyAlertSlot, recordAlertsSent, seriesAlertKey, claimSeriesAlertCondition, evaluateReengagementForUser, claimReengagementSlot, logEvent, isEmailSuppressed, getUserSettings, getUser, getExportedConferenceIds, getUserMeetingSeries, persistAttendance, getTeamOverview, getRecentErrorSpike, getErrorAlertState, setErrorAlertState } = require('../services/firestore');
const { sendAdminEmail, sendWeeklySelfReport, sendSeriesAlertEmail, sendReactivationEmail, sendActivationNudgeEmail, sendSoloNudgeEmail, sendForgottenMeetingEmail, sendComebackEmail, sendExportGapEmail, sendUpcomingMeetingEmail, sendOrgWeeklyDigest, flushDeferredNotifications } = require('../lib/notifications');
const { requireSuperAdmin, requireSuperAdminOrScheduler, requireKhMetricsKey, safeEqual } = require('../middleware/adminAuth');
const { requireAuth } = require('../middleware/auth');
const { domainOf } = require('../services/firestore/_core'); // pure util; imported directly (test firestore-mocks needn't stub it)
const { ACQUISITION_SOURCES } = require('../lib/constants');
const { planIsPro } = require('./billing');
const { refreshAccessToken, makeUserClient } = require('../services/googleAuth');
const { meetGet, meetGetAll, participantIdentity, sessionsDurationMs } = require('../services/meetApi');
const { google } = require('googleapis');
const { buildAndSaveExport } = require('./sheets');

const SUPER_ADMIN_EMAIL = CONFIG.superAdminEmail;
const MARKETPLACE_REVIEW_URL = 'https://workspace.google.com/marketplace/app/attendance_tracker/829771833968';

// Quote a CSV field per RFC 4180: wrap in double quotes and double any
// embedded double quotes. Only quote when needed (contains , " or newline).
function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const router = Router();

// Time budget for the cron sweeps. The loops stop once elapsed exceeds this so
// idempotent per-user work resumes on the next run (and rotateForFairness
// ensures a different slice is reached each run).
// The ceiling is Cloud Run's REQUEST timeout, not Node's `requestTimeout`
// (which only bounds time to RECEIVE the request — a fully-received cron POST
// with an empty body is not aborted by it, so the old requestTimeoutMs-5s
// clamp needlessly cut sweeps to ~25s and starved the tail). Cloud Run
// defaults to 300s; leave a margin for the response to flush.
const SWEEP_CEILING_MS = Number(process.env.SWEEP_CEILING_MS) || 280000;
function sweepBudgetMs() {
  const configured = Number(process.env.SWEEP_BUDGET_MS) || 240000;
  if (configured > SWEEP_CEILING_MS) {
    log.warn('admin: SWEEP_BUDGET_MS exceeds the Cloud Run request-timeout ceiling — clamping', {
      configured, ceiling: SWEEP_CEILING_MS,
    });
    return SWEEP_CEILING_MS;
  }
  return configured;
}

// Rotate a user list by a time-derived offset so a budget-truncated sweep does
// NOT process the same front-of-list users every run — collectionGroup returns
// a stable order, so without rotation the tail is never reached. Deterministic
// (no Math.random) and cheap. `dayOffset` is passed so callers can vary the
// clock read for tests.
// The offset is a Knuth-multiplicative HASH of the 15-minute bucket. A plain
// stride aliases badly for the daily/6-hourly sweeps: a daily job advances 96
// buckets/run, and 96×stride ≡ 0 (mod len) for many list lengths — the
// rotation would be IDENTICAL every day, freezing the truncated tail out
// forever. Hashing the bucket gives a well-spread pseudo-random offset for
// every cadence and every length. Per-user claims/dedup keys make re-visiting
// the same user a cheap no-op, so randomized coverage is strictly better.
function rotateForFairness(arr, dayOffset) {
  if (!Array.isArray(arr) || arr.length < 2) return arr || [];
  const bucket = dayOffset == null ? Math.floor(Date.now() / 900000) : dayOffset;
  const off = ((Math.imul(bucket, 2654435761) >>> 0) % arr.length + arr.length) % arr.length;
  return off === 0 ? arr : arr.slice(off).concat(arr.slice(0, off));
}

// Marketplace webhooks mutate tenant config (activate/deactivate a whole
// domain) so they must not be openly writable. We require a shared secret
// header (MARKETPLACE_WEBHOOK_SECRET) — same pattern as the scheduler crons —
// or a super-admin session for manual triggering. Rate-limited as defense in
// depth. Nothing in the app calls these except the external install pipeline,
// and tenants are auto-created on first sign-in, so requiring the secret does
// not affect normal usage.
const marketplaceLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests.' },
  skip: () => process.env.NODE_ENV === 'test',
});

function requireMarketplaceAuth(req, res, next) {
  const secret = process.env.MARKETPLACE_WEBHOOK_SECRET;
  const hasSecret = !!secret && safeEqual(req.headers['x-marketplace-secret'] || '', secret);
  const isSuperAdmin = req.user?.email === SUPER_ADMIN_EMAIL;
  if (!hasSecret && !isSuperAdmin) {
    log.warn('marketplace: unauthorized webhook call', { path: req.path, ip: req.ip });
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// POST /api/admin/install — Marketplace install webhook
// Called by the install pipeline; authenticated via shared secret (see above).
router.post('/admin/install', marketplaceLimiter, requireMarketplaceAuth, async (req, res) => {
  try {
    const { domain, adminEmail } = req.body;
    if (!domain) return res.status(400).json({ error: 'domain required' });

    await upsertTenantConfig(domain, {
      installedAt: new Date().toISOString(),
      adminEmail: adminEmail || null,
      active: true,
    });

    log.info('marketplace: app installed', { domain });
    res.json({ success: true });
  } catch (err) {
    log.error('marketplace: install failed', { error: err.message });
    res.status(500).json({ error: 'Install registration failed' });
  }
});

// POST /api/admin/uninstall — Marketplace uninstall webhook
router.post('/admin/uninstall', marketplaceLimiter, requireMarketplaceAuth, async (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'domain required' });

    await upsertTenantConfig(domain, {
      active: false,
      uninstalledAt: new Date().toISOString(),
    });

    log.info('marketplace: app uninstalled', { domain });
    res.json({ success: true });
  } catch (err) {
    log.error('marketplace: uninstall failed', { error: err.message });
    res.status(500).json({ error: 'Uninstall registration failed' });
  }
});

// GET /api/admin/stats — Basic usage stats. Any signed-in user gets THEIR
// OWN domain's numbers; the cross-tenant list (every customer domain + when
// they installed) is founder-only — it was previously returned to any
// authenticated session, i.e. a full customer-list disclosure.
router.get('/admin/stats', requireAuth, async (req, res) => {
  try {

    const { Firestore } = require('@google-cloud/firestore');
    const db = new Firestore();

    const isSuper = req.user.email === CONFIG.superAdminEmail;
    let tenants = [];
    if (isSuper) {
      // Tenant list: explicit docs + any domain we have users in.
      // Firestore doesn't auto-create the parent doc for subcollection writes,
      // so users can exist under tenants/{domain}/users/* without a tenant doc.
      const [tenantsSnap, allUsersSnap] = await Promise.all([
        db.collection('tenants').get(),
        db.collectionGroup('users').get(),
      ]);
      const tenantMap = new Map();
      for (const d of tenantsSnap.docs) {
        tenantMap.set(d.id, { domain: d.id, ...d.data() });
      }
      for (const d of allUsersSnap.docs) {
        const parent = d.ref.parent.parent;
        if (!parent) continue; // legacy root-level users doc
        const dom = parent.id;
        if (!tenantMap.has(dom)) {
          tenantMap.set(dom, { domain: dom, active: true, installedAt: null });
        }
      }
      tenants = [...tenantMap.values()];
    }

    // Count users for the requesting user's domain
    const domain = req.user.domain;
    const usersSnap = await db.collection('tenants').doc(domain).collection('users').get();
    const meetingsSnap = await db.collection('tenants').doc(domain).collection('meetings').get();
    const exportsSnap = await db.collection('tenants').doc(domain).collection('exports').get();

    // Recent users are per-user PII (email, name, last login). This endpoint
    // returns aggregate counts to ANY authenticated caller, but on a shared
    // tenant (every gmail.com user lands in tenants/gmail.com) that list would
    // hand any signed-in stranger 20 unrelated users' emails. Gate it to the
    // founder; a real Workspace admin has /team/overview for their roster.
    const recentUsers = isSuper
      ? usersSnap.docs
        .map(d => ({ email: d.id, ...d.data() }))
        .sort((a, b) => {
          const aTime = a.lastLoginAt?.toDate?.() || new Date(0);
          const bTime = b.lastLoginAt?.toDate?.() || new Date(0);
          return bTime - aTime;
        })
        .slice(0, 20)
        .map(u => ({
          email: u.email,
          displayName: u.displayName || '',
          lastLogin: u.lastLoginAt?.toDate?.()?.toISOString() || null,
        }))
      : [];

    res.json({
      totalTenants: isSuper ? tenants.length : null,
      tenants: isSuper ? tenants.map(t => ({
        domain: t.domain,
        active: t.active !== false,
        installedAt: t.installedAt?.toDate?.()?.toISOString?.() || t.installedAt || null,
      })) : [],
      yourDomain: {
        domain,
        users: usersSnap.size,
        meetings: meetingsSnap.size,
        exports: exportsSnap.size,
        recentUsers,
      },
    });
  } catch (err) {
    log.error('admin: stats failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/admin/all-users — List every user across every tenant (super admin only)
router.get('/admin/all-users', requireSuperAdmin, async (req, res) => {
  try {
    const users = await getAllUsersAcrossTenants();
    users.sort((a, b) => {
      const aTime = a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0;
      const bTime = b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0;
      return bTime - aTime;
    });
    res.json({ users, totalCount: users.length });
  } catch (err) {
    log.error('admin: all-users failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch all users' });
  }
});

// GET /api/admin/insights — Activation funnel, retention, top orgs (super admin only)
// GET /api/admin/activity — recent events across all tenants for the live feed
router.get('/admin/activity', requireSuperAdmin, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const events = await getRecentActivity({ limit });
    res.json({ events });
  } catch (err) {
    log.error('admin: activity failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

// GET /api/admin/pulse — the real-time header numbers for the dashboard:
// distinct active users (15min/24h/7d), signups, exports, upgrades, check-ins.
// Backed by a 60s-memoized full scan, so the 30s dashboard poll is cheap.
router.get('/admin/pulse', requireSuperAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const pulse = await getActivityPulse();
    if (!pulse) return res.status(500).json({ error: 'Failed to compute pulse' });
    res.json(pulse);
  } catch (err) {
    log.error('admin: pulse failed', { error: err.message });
    res.status(500).json({ error: 'Failed to compute pulse' });
  }
});

// GET /api/admin/revenue-funnel — the paid-conversion story: activated →
// saw gate → clicked checkout → paid, per-trigger and per-country, plus the
// CSV quota-leak and the warm-but-stuck outreach list.
router.get('/admin/revenue-funnel', requireSuperAdmin, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const days = Math.max(7, Math.min(90, Number(req.query.days) || 30));
    const data = await getRevenueFunnel({ days });
    if (!data) return res.status(500).json({ error: 'Failed to compute revenue funnel' });
    res.json(data);
  } catch (err) {
    log.error('admin: revenue-funnel failed', { error: err.message });
    res.status(500).json({ error: 'Failed to compute revenue funnel' });
  }
});

// GET /api/admin/suggestions — "reach out NOW" cards
router.get('/admin/suggestions', requireSuperAdmin, async (req, res) => {
  try {
    const suggestions = await getReachOutSuggestions();
    res.json({ suggestions });
  } catch (err) {
    log.error('admin: suggestions failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

// GET /api/admin/power-users — power users who haven't been contacted yet
router.get('/admin/power-users', requireSuperAdmin, async (req, res) => {
  try {
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 7));
    // minMeetings replaced minTracked when the pipeline switched from raw
    // poll events to distinct meetings; accept the legacy name as an alias.
    const minMeetings = Math.max(1, Math.min(50, Number(req.query.minMeetings) || Number(req.query.minTracked) || 3));
    const users = await getPowerUserPipeline({ days, minMeetings });
    res.json({ users, days, minMeetings });
  } catch (err) {
    log.error('admin: power-users failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch power users' });
  }
});

// POST /api/admin/contacted — mark a user as reached out to
router.post('/admin/contacted', requireSuperAdmin, async (req, res) => {
  try {
    const { email, domain, note } = req.body || {};
    if (!email || !domain) return res.status(400).json({ error: 'email and domain required' });
    await markUserContacted(domain, email, { note, contactedBy: req.user.email });
    res.json({ success: true });
  } catch (err) {
    log.error('admin: contacted failed', { error: err.message });
    res.status(500).json({ error: 'Failed to mark contacted' });
  }
});

// GET /api/admin/weekly-report?preview=1 — returns the JSON for inspection
// POST /api/admin/weekly-report — actually sends the email to NOTIFY_EMAIL
// Two endpoints so you can preview before triggering. Cloud Scheduler can
// hit the POST endpoint every Monday morning.
router.get('/admin/weekly-report', requireSuperAdmin, async (req, res) => {
  try {
    const report = await getWeeklySelfReport();
    res.json(report || { error: 'failed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// requireSuperAdminOrScheduler (not just super-admin) so Cloud Scheduler can fire
// the weekly report. It only ever emails NOTIFY_EMAIL/owner, so the scheduler
// secret carries no data-exposure risk.
router.post('/admin/weekly-report', requireSuperAdminOrScheduler, async (req, res) => {
  try {
    const report = await getWeeklySelfReport();
    if (!report) return res.status(500).json({ error: 'Could not generate report' });
    const result = await sendWeeklySelfReport(report);
    res.json(result);
  } catch (err) {
    log.error('admin: weekly-report send failed', { err, error: err.message });
    res.status(500).json({ error: err.message || 'Failed' });
  }
});

// POST /api/admin/check-errors — hourly export-failure spike alert. Fired by
// Cloud Scheduler (x-scheduler-secret) like the other crons; only ever emails
// the owner inbox. Closes the "93 silent failures" gap: export_failed events
// used to dead-end in Firestore, read by nobody. Emails when failures cross a
// threshold in the last hour, with a cooldown so an ongoing incident doesn't
// email every run.
router.post('/admin/check-errors', requireSuperAdminOrScheduler, async (req, res) => {
  try {
    const THRESHOLD = Number(process.env.ERROR_ALERT_THRESHOLD) || 5;
    const COOLDOWN_H = Number(process.env.ERROR_ALERT_COOLDOWN_H) || 6;
    const WINDOW_MIN = 60;
    const since = new Date(Date.now() - WINDOW_MIN * 60 * 1000);
    const spike = await getRecentErrorSpike(since);
    if (spike.total < THRESHOLD) {
      return res.json({ ok: true, total: spike.total, alerted: false, reason: 'below_threshold' });
    }
    // Cooldown — don't re-alert while an incident is still ongoing.
    const state = await getErrorAlertState();
    const lastMs = state && state.lastAlertedAt ? Date.parse(state.lastAlertedAt) : 0;
    if (Date.now() - lastMs < COOLDOWN_H * 3600 * 1000) {
      return res.json({ ok: true, total: spike.total, alerted: false, reason: 'cooldown' });
    }
    const to = process.env.NOTIFY_EMAIL || process.env.GMAIL_USER;
    if (!to) {
      return res.json({ ok: true, total: spike.total, alerted: false, reason: 'no_recipient' });
    }
    const reasons = Object.entries(spike.byReason).sort((a, b) => b[1] - a[1]).map(([r, n]) => `  ${n}× ${r}`).join('\n');
    const body = [
      `${spike.total} Attendance Tracker export failures in the last ${WINDOW_MIN} minutes (alert threshold: ${THRESHOLD}).`,
      '',
      'By reason:',
      reasons || '  (none categorized)',
      '',
      `Affected users (${spike.users.length}): ${spike.users.slice(0, 20).join(', ')}${spike.users.length > 20 ? ' …' : ''}`,
      spike.samples.length ? `\nSample messages:\n${spike.samples.map(s => '  ' + s).join('\n')}` : '',
      '',
      'Full detail + stack traces are in Sentry (issue "sheets export failed" and recent frontend exceptions).',
    ].join('\n');
    await sendAdminEmail({ to, subject: `⚠️ ${spike.total} Attendance Tracker export failures in the last hour`, body });
    await setErrorAlertState({ lastAlertedAt: new Date().toISOString(), lastTotal: spike.total });
    res.json({ ok: true, total: spike.total, alerted: true });
  } catch (err) {
    log.error('admin: check-errors failed', { err, error: err.message });
    res.status(500).json({ error: err.message || 'Failed' });
  }
});

// POST /api/admin/check-reengagement — Daily lapsed-user sweep.
// Different from check-alerts: fires on the *user's* lapse patterns, not
// on attendee behavior. Three reminder types:
//   - reactivation_7d: signed up, hasn't logged in for 7-13 days
//   - reactivation_30d: 30-44 days inactive — last-chance + "delete me?"
//   - forgotten_meeting: tracked a recurring series 3+ times then skipped
// Each fires at most once per user per dedup key forever (permanent claim).
// Same auth model as check-alerts: super-admin OR x-scheduler-secret header.
router.post('/admin/check-reengagement', requireSuperAdminOrScheduler, async (req, res) => {
  try {
    const users = rotateForFairness(await getAllUsersAcrossTenants());
    let usersChecked = 0;
    let usersWithReminders = 0;
    let totalSent = 0;
    let totalSkipped = 0;
    const errors = [];

    // Stop before Cloud Run's request timeout (default 300s). Work is idempotent
    // (permanent per-user claims) and firing windows span days, so any users we
    // don't reach this run are picked up by the next daily sweep.
    const startedAt = Date.now();
    const BUDGET_MS = sweepBudgetMs();
    let timedOut = false;
    let index = 0;

    for (const user of users) {
      if (Date.now() - startedAt > BUDGET_MS) { timedOut = true; break; }
      index++;
      if (!user?.email || !user?.domain) continue;
      // Backstop: flush any signup notification that never fired — the user
      // dismissed the "how did you find us?" modal AND the post-signup grace
      // timer was lost to a Cloud Run instance restart. No-op unless this user
      // has one pending; claimed transactionally so it sends at most once.
      flushDeferredNotifications(user.domain, user.email);
      // Don't send lifecycle mail to the owner's own account (self/test).
      if (user.email.toLowerCase() === SUPER_ADMIN_EMAIL) continue;
      usersChecked++;
      try {
        // CAN-SPAM: never send lifecycle mail to a suppressed address.
        if (await isEmailSuppressed(user.email)) { totalSkipped++; continue; }

        const reminders = await evaluateReengagementForUser(user.domain, user.email);
        if (reminders.length === 0) continue;
        let fired = 0;

        for (const r of reminders) {
          // Dedup key shape: type or type:recurringEventId. Persistent (no day
          // suffix) so each kind of reminder fires once per user forever.
          const dedupKey = r.type === 'forgotten_meeting'
            ? `forgotten_meeting:${r.recurringEventId}`
            : r.type;
          const claim = await claimReengagementSlot(user.domain, user.email, dedupKey);
          if (!claim.claimed) { totalSkipped++; continue; }

          // Send AFTER claiming (the claim is the concurrency lock), but if the
          // send doesn't succeed, release the slot so a later run retries —
          // otherwise a transient Resend failure would suppress this reminder
          // forever (the slot is permanent).
          let result;
          if (r.type === 'reactivation_7d' || r.type === 'reactivation_30d') {
            result = await sendReactivationEmail({
              to: user.email,
              displayName: user.displayName || null,
              daysSinceLogin: r.daysSinceLogin,
              variant: r.type === 'reactivation_7d' ? '7d' : '30d',
            });
          } else if (r.type === 'activation_7d') {
            result = await sendActivationNudgeEmail({
              to: user.email,
              displayName: user.displayName || null,
              daysSinceLogin: r.daysSinceLogin,
            });
          } else if (r.type === 'solo_nudge_7d') {
            result = await sendSoloNudgeEmail({
              to: user.email,
              displayName: user.displayName || null,
              daysSinceLogin: r.daysSinceLogin,
            });
          } else if (r.type === 'forgotten_meeting') {
            result = await sendForgottenMeetingEmail({
              to: user.email,
              displayName: user.displayName || null,
              seriesTitle: r.seriesTitle,
              recurringEventId: r.recurringEventId,
              trackedInWindow: r.trackedInWindow,
              daysSinceLast: r.daysSinceLast,
            });
          } else if (r.type === 'comeback_7d') {
            result = await sendComebackEmail({
              to: user.email,
              displayName: user.displayName || null,
              meetingTitle: r.meetingTitle,
              daysSinceLogin: r.daysSinceLogin,
            });
          } else if (r.type === 'export_gap') {
            result = await sendExportGapEmail({
              to: user.email,
              displayName: user.displayName || null,
              meetingTitle: r.meetingTitle,
              daysSinceLogin: r.daysSinceLogin,
            });
          }
          if (!result || result.sent !== true) {
            // Release the claim; leave it open for the next run.
            try { await claim.ref.delete(); } catch (_) { /* best-effort */ }
            totalSkipped++;
            if (result?.error) errors.push({ email: user.email, error: result.error });
            continue;
          }

          logEvent(user.domain, {
            email: user.email,
            type: 'reengagement_fired',
            meta: { reminderType: r.type, dedupKey },
          });
          fired++;
          totalSent++;
        }
        if (fired > 0) usersWithReminders++;
      } catch (e) {
        log.warn('admin: check-reengagement per-user failed', { email: user.email, error: e.message });
        errors.push({ email: user.email, error: e.message });
      }
    }

    const remaining = timedOut ? users.length - index : 0;
    if (timedOut) log.warn('admin: check-reengagement hit time budget', { processed: index, remaining });
    res.json({ usersChecked, usersWithReminders, totalSent, totalSkipped, errors, timedOut, remaining });
  } catch (err) {
    log.error('admin: check-reengagement failed', { error: err.message });
    res.status(500).json({ error: 'Failed to run re-engagement sweep' });
  }
});

// POST /api/admin/check-alerts — Daily series-attendance alert sweep
// Auth: super-admin OR x-scheduler-secret header matching SCHEDULER_SECRET env
// var. Designed to be called once/day by Cloud Scheduler. Idempotent via
// per-user daily slot — safe to retry on transient failures.
router.post('/admin/check-alerts', requireSuperAdminOrScheduler, async (req, res) => {
  try {
    const users = rotateForFairness(await getAllUsersAcrossTenants());
    let usersChecked = 0;
    let usersAlerted = 0;
    let usersSkipped = 0;
    let totalAlerts = 0;
    const errors = [];

    // Stop before Cloud Run's request timeout; per-day claims make the sweep
    // safe to resume on the next run (see check-reengagement for rationale).
    const startedAt = Date.now();
    const BUDGET_MS = sweepBudgetMs();
    let timedOut = false;
    let index = 0;

    // Sequential to keep memory/quota predictable. Per-user work is small.
    for (const user of users) {
      if (Date.now() - startedAt > BUDGET_MS) { timedOut = true; break; }
      index++;
      if (!user?.email || !user?.domain) continue;
      if (user.email.toLowerCase() === SUPER_ADMIN_EMAIL) continue; // no self-mail
      usersChecked++;
      try {
        // CAN-SPAM: skip suppressed addresses before doing any work.
        if (await isEmailSuppressed(user.email)) { usersSkipped++; continue; }

        const claim = await claimDailyAlertSlot(user.domain, user.email);
        if (!claim.claimed) { usersSkipped++; continue; }

        const alerts = await evaluateSeriesAlerts(user.domain, user.email);
        if (alerts === null) {
          // Evaluation ERRORED (Firestore blip) — release the day slot so the
          // next run retries instead of silencing the user until tomorrow.
          try { await claim.ref.delete(); } catch (_) { /* best-effort */ }
          continue;
        }
        if (alerts.length === 0) continue; // genuinely nothing: slot stays — the once-a-day evaluation throttle

        // Per-condition dedup: only send alerts we haven't already sent for THIS
        // exact condition (series + person + rule + instanceCount). Without this,
        // an ongoing "missed the last 3" condition stays true for a week and the
        // daily sweep would re-email it every day. Each fresh condition claims a
        // permanent slot; on send failure we release them so they retry.
        const conditionClaims = [];
        for (const a of alerts) {
          const c = await claimSeriesAlertCondition(user.domain, user.email, seriesAlertKey(a));
          if (c.claimed) conditionClaims.push({ alert: a, ref: c.ref });
        }
        const fresh = conditionClaims.map(c => c.alert);
        if (fresh.length === 0) continue; // all conditions already alerted

        // Send, then release the day's slot + the per-condition claims if it
        // didn't go out so the sweep can retry rather than silently dropping them.
        const result = await sendSeriesAlertEmail({
          to: user.email,
          displayName: user.displayName || null,
          alerts: fresh,
        });
        if (!result || result.sent !== true) {
          try { await claim.ref.delete(); } catch (_) { /* best-effort */ }
          for (const c of conditionClaims) { try { await c.ref.delete(); } catch (_) { /* best-effort */ } }
          usersSkipped++;
          if (result?.error) errors.push({ email: user.email, error: result.error });
          continue;
        }
        await recordAlertsSent(claim.ref, fresh);

        logEvent(user.domain, {
          email: user.email,
          type: 'series_alert_fired',
          meta: { alertCount: fresh.length, types: fresh.map(a => a.type) },
        });

        usersAlerted++;
        totalAlerts += fresh.length;
      } catch (e) {
        log.warn('admin: check-alerts per-user failed', { email: user.email, error: e.message });
        errors.push({ email: user.email, error: e.message });
      }
    }

    const remaining = timedOut ? users.length - index : 0;
    if (timedOut) log.warn('admin: check-alerts hit time budget', { processed: index, remaining });
    res.json({ usersChecked, usersAlerted, usersSkipped, totalAlerts, errors, timedOut, remaining });
  } catch (err) {
    log.error('admin: check-alerts failed', { error: err.message });
    res.status(500).json({ error: 'Failed to check alerts' });
  }
});

// GET /api/admin/activation-funnel — the real activation funnel (signup →
// tracked → real multi-person meeting → exported → retained), deduped so solo
// self-tests don't count as real usage.
router.get('/admin/activation-funnel', requireSuperAdmin, async (req, res) => {
  try {
    const data = await getActivationFunnel();
    if (!data) return res.status(500).json({ error: 'Failed' });
    res.json(data);
  } catch (err) {
    log.error('admin: activation-funnel failed', { error: err.message });
    res.status(500).json({ error: 'Failed' });
  }
});

// GET /api/admin/analytics — segments, funnels, time patterns, drop-off
router.get('/admin/analytics', requireSuperAdmin, async (req, res) => {
  try {
    const data = await getAdvancedAnalytics();
    if (!data) return res.status(500).json({ error: 'Failed' });
    res.json(data);
  } catch (err) {
    log.error('admin: analytics failed', { error: err.message });
    res.status(500).json({ error: 'Failed' });
  }
});

// ── User detail (drill-down modal) ──
router.get('/admin/user', requireSuperAdmin, async (req, res) => {
  try {
    const { email, domain } = req.query;
    if (!email || !domain) return res.status(400).json({ error: 'email and domain required' });
    const detail = await getUserDetail(domain, email);
    if (!detail) return res.status(404).json({ error: 'Not found' });
    res.json(detail);
  } catch (err) {
    log.error('admin: user detail failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

router.put('/admin/note', requireSuperAdmin, async (req, res) => {
  try {
    const { email, domain, body } = req.body || {};
    if (!email || !domain) return res.status(400).json({ error: 'email and domain required' });
    const result = await setAdminNote(domain, email, body || '', req.user.email);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save note' });
  }
});

router.get('/admin/notes/search', requireSuperAdmin, async (req, res) => {
  try {
    const results = await searchAdminNotes(req.query.q || '');
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// ── Email-from-dashboard + templates + outreach log ──
router.post('/admin/send-email', requireSuperAdmin, async (req, res) => {
  try {
    const { to, domain, subject, body } = req.body || {};
    if (!to || !domain || !subject || !body) return res.status(400).json({ error: 'to, domain, subject, body required' });
    // Every automated sender honors the suppression list; the owner's manual
    // outreach — the send an unsubscriber is most likely to complain about —
    // used to bypass it entirely.
    if (await isEmailSuppressed(to)) {
      return res.status(400).json({ error: 'This address unsubscribed from emails — not sending.' });
    }
    const result = await sendAdminEmail({ to, subject, body });
    // Log the conversation entry + mark contacted in one shot.
    await appendConversation(domain, to, { direction: 'sent', subject, body, replyStatus: 'awaiting' });
    res.json(result);
  } catch (err) {
    log.error('admin: send-email failed', { error: err.message });
    res.status(500).json({ error: err.message || 'Failed to send' });
  }
});

router.put('/admin/outreach/status', requireSuperAdmin, async (req, res) => {
  try {
    const { email, domain, status } = req.body || {};
    if (!email || !domain || !status) return res.status(400).json({ error: 'email, domain, status required' });
    await setOutreachStatus(domain, email, status);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/admin/outreach/log-reply', requireSuperAdmin, async (req, res) => {
  try {
    const { email, domain, body, status } = req.body || {};
    if (!email || !domain) return res.status(400).json({ error: 'email, domain required' });
    await appendConversation(domain, email, { direction: 'received', subject: '', body: body || '', replyStatus: status || 'replied' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/admin/templates', requireSuperAdmin, async (req, res) => {
  try {
    const items = await getEmailTemplates();
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.put('/admin/templates', requireSuperAdmin, async (req, res) => {
  try {
    await setEmailTemplates(req.body?.items || []);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ── Reminders ──
router.post('/admin/reminders', requireSuperAdmin, async (req, res) => {
  try {
    const { email, domain, remindAt, body } = req.body || {};
    if (!email || !domain || !remindAt) return res.status(400).json({ error: 'email, domain, remindAt required' });
    const r = await createReminder(domain, email, { remindAt, body, createdBy: req.user.email });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.put('/admin/reminders/:id/done', requireSuperAdmin, async (req, res) => {
  try {
    const { domain } = req.body || {};
    if (!domain) return res.status(400).json({ error: 'domain required' });
    await markReminderDone(domain, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/admin/reminders/due', requireSuperAdmin, async (req, res) => {
  try {
    const reminders = await getDueReminders();
    res.json({ reminders });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/admin/insights', requireSuperAdmin, async (req, res) => {
  try {
    const insights = await getAggregatedInsights();
    res.json(insights);
  } catch (err) {
    log.error('admin: insights failed', { error: err.message });
    res.status(500).json({ error: 'Failed to compute insights' });
  }
});

// GET /api/kh/metrics — durable metrics pull for the Kinetic Helix command
// center. Same aggregate as /admin/insights (plus revenue), gated by a static
// x-kh-key header (KH_METRICS_KEY) so the connection doesn't expire.
router.get('/kh/metrics', requireKhMetricsKey, async (req, res) => {
  try {
    const insights = await getAggregatedInsights();
    // MRR = pro tenants × seat price (KH_MRR_SEAT_CENTS, set to match Stripe).
    let revenue = { mrrCents: 0, proTenants: 0 };
    try {
      const seatCents = Number(process.env.KH_MRR_SEAT_CENTS || 0) || 0;
      const proSnap = await getDb().collection('tenants').where('plan', '==', 'pro').get();
      revenue = { mrrCents: proSnap.size * seatCents, proTenants: proSnap.size };
    } catch (e) {
      log.warn('admin: kh revenue failed', { error: e.message });
    }
    res.json({ ...insights, revenue });
  } catch (err) {
    log.error('admin: kh metrics failed', { error: err.message });
    res.status(500).json({ error: 'Failed to compute insights' });
  }
});

// GET /api/admin/outreach-list — Mail-merge-ready CSV of active users (super admin only)
// Query params: ?days=30 (window), ?limit=50 (max rows), ?format=csv|json (default csv)
router.get('/admin/outreach-list', requireSuperAdmin, async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const format = req.query.format === 'json' ? 'json' : 'csv';

    const rows = await getOutreachList({ days, limit });

    if (format === 'json') {
      return res.json({ rows, marketplaceReviewUrl: MARKETPLACE_REVIEW_URL });
    }

    const header = ['email', 'firstName', 'displayName', 'domain', 'tracked', 'exported', 'totalActions', 'lastActivityAt', 'acquisitionSource', 'marketplaceReviewUrl'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        r.email, r.firstName, r.displayName, r.domain,
        r.tracked, r.exported, r.totalActions,
        r.lastActivityAt, r.acquisitionSource || '',
        MARKETPLACE_REVIEW_URL,
      ].map(csvField).join(','));
    }
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="outreach-list-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(lines.join('\n'));
  } catch (err) {
    log.error('admin: outreach-list failed', { error: err.message });
    res.status(500).json({ error: 'Failed to build outreach list' });
  }
});

// POST /api/admin/source — User self-reports how they found us (from the modal)
router.post('/admin/source', requireAuth, async (req, res) => {
  try {
    const { source, detail, dismissed } = req.body || {};
    // Dismissal is an answer too: persist it so /oauth/exchange and /oauth/me
    // stop re-arming the modal on every new session. (acquisitionDismissed was
    // read by /oauth/me since forever but nothing ever wrote it.)
    if (dismissed === true && !source) {
      const { setUserAcquisitionDismissed } = require('../services/firestore');
      await setUserAcquisitionDismissed(req.user.domain, req.user.email);
      return res.json({ success: true, dismissed: true });
    }
    if (!ACQUISITION_SOURCES.has(source)) {
      return res.status(400).json({ error: 'Invalid source' });
    }
    const cleanDetail = typeof detail === 'string' ? detail.slice(0, 200) : null;
    await setUserAcquisitionSource(req.user.domain, req.user.email, { source, detail: cleanDetail });
    // Flush the deferred signup notification now that we have the self-reported
    // source. Usually this is the trigger that actually sends the email (the
    // modal is answered seconds after signup). Fire-and-forget — a pending
    // signup, if any, is claimed transactionally so this can't double-send.
    flushDeferredNotifications(req.user.domain, req.user.email);
    res.json({ success: true });
  } catch (err) {
    log.error('admin: source failed', { error: err.message });
    res.status(500).json({ error: 'Failed to save source' });
  }
});

// POST /api/admin/verify-delegation — Test if domain-wide delegation works
// Intentionally UNAUTHENTICATED — called from setup.html BEFORE the admin
// has signed in to the add-on. Tightly rate-limited to prevent using it
// as a Meet-API-token-burn vector: each call impersonates the given admin
// email via getMeetToken() which hits Google.
const verifyDelegationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 min
  max: 10,                  // 10 attempts per 10 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many delegation verification attempts. Try again in a few minutes.' },
  skip: () => process.env.NODE_ENV === 'test',
});
router.post('/admin/verify-delegation', verifyDelegationLimiter, async (req, res) => {
  try {
    const { domain, adminEmail } = req.body;
    if (!domain || !adminEmail) {
      return res.status(400).json({ error: 'domain and adminEmail required' });
    }
    // This endpoint is unauthenticated (called from setup.html pre-signin) and
    // writes tenant config. Bind adminEmail to domain so a caller can't point
    // one tenant's impersonation at another domain's admin (config poisoning /
    // re-activation of an arbitrary tenant).
    if (domainOf(adminEmail)?.toLowerCase() !== String(domain).toLowerCase()) {
      return res.status(400).json({ error: 'adminEmail must belong to the given domain' });
    }
    const domainLower = String(domain).toLowerCase();
    const adminEmailLower = String(adminEmail).toLowerCase();

    // tenant.adminEmail is the single source of truth requireTeamAdmin
    // authorizes against — this unauthenticated endpoint must never OVERWRITE
    // an existing holder (with DWD configured, getMeetToken succeeds for ANY
    // address in the domain, so overwriting = anonymous seat takeover). But it
    // must also not DEAD-END legit setup: the first teacher who signs in
    // auto-claims adminEmail, and the IT admin runs this endpoint later — so
    // the DELEGATION fields (impersonateEmail/verified/active) always write;
    // only the authz seat is claim-if-vacant. The read THROWS on failure
    // (getTenantConfig swallows errors into null, which would fail this guard
    // OPEN on a Firestore blip; a throw here lands in the catch → safe no-op).
    const { getTenantAdminEmailStrict } = require('../services/firestore');
    const { adminEmail: existingAdmin, impersonateEmail: existingImpersonate } = await getTenantAdminEmailStrict(domainLower);
    const seatHeldByOther = !!existingAdmin && existingAdmin !== adminEmailLower;

    // Try to get a Meet API token by impersonating the admin
    const { getMeetToken } = require('../services/googleAuth');
    await getMeetToken(adminEmailLower);

    // If we get here, delegation works — store the config (lowercased domain:
    // a case-variant would silently fork a phantom tenant). On a tenant whose
    // admin seat is held by SOMEONE ELSE, this unauthenticated endpoint only
    // records the verification — it must not re-point an already-configured
    // impersonateEmail (config poisoning: aim it at a suspended mailbox and
    // every SA lookup silently degrades) nor flip `active` back on for a
    // possibly-uninstalled tenant.
    await upsertTenantConfig(domainLower, {
      delegationVerified: true,
      ...(seatHeldByOther
        ? (existingImpersonate ? {} : { impersonateEmail: adminEmailLower })
        : { adminEmail: adminEmailLower, impersonateEmail: adminEmailLower, active: true }),
    });
    if (seatHeldByOther) {
      log.info('admin: delegation verified; admin seat already held — partial config write', { domain: domainLower, impersonateSet: !existingImpersonate });
    }

    log.info('admin: delegation verified', { domain, adminEmail });
    res.json({ success: true });
  } catch (err) {
    log.warn('admin: delegation verification failed', { error: err.message });
    res.json({ success: false, error: 'Domain-wide delegation is not configured correctly. Please check the setup steps and try again.' });
  }
});

// ── Server-side auto-capture (WS3b) ──

// Fetch a completed conference's participants server-side (mirrors the
// /attendance route's participant + session shaping), shaped for
// buildAndSaveExport (…ISO field names). Best-effort per participant: a failed
// session fetch still yields a present-only row rather than dropping the person.
async function fetchConferenceParticipants(recordName, token) {
  const raw = await meetGetAll(`${recordName}/participants`, token, 'participants');
  const out = [];
  const BATCH = 10;
  for (let i = 0; i < raw.length; i += BATCH) {
    const results = await Promise.all(raw.slice(i, i + BATCH).map(async (p) => {
      let sessions = [];
      let sessionsFetchFailed = false;
      try { sessions = await meetGetAll(`${p.name}/participantSessions`, token, 'participantSessions'); }
      catch (e) { sessionsFetchFailed = true; log.warn('auto-capture: sessions fetch failed', { participant: p.name, error: e.message }); }
      const joins  = sessions.map(s => s.startTime).filter(Boolean).map(t => new Date(t));
      const leaves = sessions.map(s => s.endTime).filter(Boolean).map(t => new Date(t));
      const joinIso = joins.length ? new Date(Math.min(...joins)).toISOString() : null;
      const leaveIso = leaves.length ? new Date(Math.max(...leaves)).toISOString() : null;
      return {
        participantId: p.name,
        ...participantIdentity(p),
        joinTimeISO:  joinIso,
        leaveTimeISO: leaveIso,
        joinTime:     joinIso,
        leaveTime:    leaveIso,
        // A FAILED fetch means "unknown", not "attended 0 minutes" — omitting
        // the field lets the sheet render blanks instead of a hard 0%.
        ...(sessionsFetchFailed ? {} : { durationMs: sessionsDurationMs(sessions) }),
        present:      sessions.some(s => !s.endTime),
        sessions:     sessions.length || 1,
      };
    }));
    out.push(...results);
  }
  return out;
}

// POST /api/admin/auto-capture — server-side attendance capture. Lists each
// active user's recent COMPLETED Meet conferences server-side and persists the
// final attendance roster to Firestore so meeting history is never lost even if
// the side panel was closed early. For Pro users, automatically exports to Google
// Sheets (unless explicitly disabled in settings). Dual auth: Scheduler or SuperAdmin.
router.post('/admin/auto-capture', requireSuperAdminOrScheduler, async (req, res) => {
  const startedAt = Date.now();
  const budgetMs = sweepBudgetMs();
  const RECENT_MS = 2 * 24 * 60 * 60 * 1000; // only conferences that ended in the last 2 days
  const ACTIVE_USER_CUTOFF_MS = 30 * 24 * 60 * 60 * 1000; // active in the last 30 days
  let scannedUsers = 0, captured = 0, detectedMeetings = 0, skippedUsers = 0, errored = 0;
  const errors = [];
  try {
    const users = rotateForFairness(await getAllUsersAcrossTenants());
    for (const u of users) {
      if (Date.now() - startedAt > budgetMs) { log.warn('auto-capture: budget exhausted', { scannedUsers }); break; }
      try {
        // Skip users dormant for over 30 days
        if (u.lastLoginAt && (Date.now() - new Date(u.lastLoginAt).getTime()) > ACTIVE_USER_CUTOFF_MS) {
          skippedUsers++;
          continue;
        }

        const userDoc = await getUser(u.domain, u.email);
        if (!userDoc || !userDoc.refreshToken) { skippedUsers++; continue; }

        const isPro = await planIsPro(u.domain, u.email);
        // Auto-capture is a paid feature (pricing sells "Hands-Free Auto-Capture"
        // on paid tiers only). Skipping free users entirely both enforces that —
        // the old `!!settings.autoExportOnEnd` branch let a free user opt into
        // unlimited server-side exports + Pro digests, bypassing the monthly
        // quota — and saves Meet API quota on accounts that can't export anyway.
        if (!isPro) { skippedUsers++; continue; }

        const settings = await getUserSettings(u.domain, u.email);
        // Pro users get automated exports by default unless explicitly disabled.
        const shouldAutoExport = settings.autoExportOnEnd !== false;

        // Mint a fresh access token from the stored refresh token.
        let accessToken;
        try {
          const creds = await refreshAccessToken(userDoc.refreshToken);
          accessToken = creds.access_token;
        } catch (e) {
          log.warn('auto-capture: token refresh failed', { email: u.email, error: e.message });
          skippedUsers++; continue;
        }

        // Recent conference records for this user (most recent first).
        let records = [];
        try {
          const data = await meetGet('conferenceRecords?pageSize=20', accessToken);
          records = data.conferenceRecords || [];
        } catch (e) {
          log.warn('auto-capture: conferenceRecords list failed', { email: u.email, error: e.message });
          skippedUsers++; continue;
        }
        const now = Date.now();
        const completed = records.filter(r => r.endTime && (now - new Date(r.endTime).getTime()) < RECENT_MS);
        if (!completed.length) { skippedUsers++; continue; }
        scannedUsers++;

        const alreadyExported = await getExportedConferenceIds(u.domain, u.email);
        const sheetsAuth = shouldAutoExport ? makeUserClient(accessToken) : null;

        for (const rec of completed) {
          if (Date.now() - startedAt > budgetMs) break;
          // Resolve meeting code from space
          let meetingCode = null;
          try {
            if (rec.space) { const space = await meetGet(rec.space, accessToken); meetingCode = space.meetingCode || null; }
          } catch (e) { log.warn('auto-capture: space fetch failed', { record: rec.name, error: e.message }); }
          if (!meetingCode) continue;

          try {
            const participants = await fetchConferenceParticipants(rec.name, accessToken);
            if (!participants.length) continue;

            // Persist full attendance to Firestore so History & dashboard reflect actual attendance
            await persistAttendance(u.domain, meetingCode, rec.name, participants, u.email);
            detectedMeetings++;

            // For Pro users (or opted-in users): auto-export to Sheets.
            // Atomic per-meeting claim closes the concurrent-fire race
            // (Cloud Scheduler is at-least-once) — getExportedConferenceIds is
            // read-once so two overlapping sweeps could otherwise both export,
            // producing a duplicate Sheet tab AND a duplicate "ready" email.
            if (shouldAutoExport && !alreadyExported.has(meetingCode)) {
              const claim = await claimReengagementSlot(u.domain, u.email, `autocap:${meetingCode}`);
              if (!claim.claimed) { alreadyExported.add(meetingCode); continue; }
              try {
                await buildAndSaveExport({
                  user: { domain: u.domain, email: u.email, displayName: u.displayName },
                  sheetsAuth,
                  data: {
                    meetingTitle: `Meeting ${meetingCode}`,
                    exportedAt: rec.endTime,
                    participants,
                    calendarAttendees: [],
                    meetingStartTime: rec.startTime || null,
                    meetingType: 'scheduled',
                    conferenceId: meetingCode,
                    timezone: settings.timezone || 'America/New_York',
                  },
                  options: { sendEmail: true, autoExport: true, proAllowed: true },
                });
              } catch (exportErr) {
                // Release the claim so the NEXT sweep retries — a transient
                // Sheets 429/5xx used to leave the claim held forever, and the
                // meeting was silently never exported (permanent data loss on
                // the hands-free paid feature).
                try { await claim.ref?.delete(); } catch { /* best-effort */ }
                throw exportErr;
              }
              alreadyExported.add(meetingCode);
              captured++;
            }
          } catch (e) {
            errored++;
            errors.push({ email: u.email, conferenceId: meetingCode, error: e.message });
            log.warn('auto-capture: process failed', { email: u.email, conferenceId: meetingCode, error: e.message });
          }
        }
      } catch (e) {
        errored++;
        errors.push({ email: u.email, error: e.message });
        log.warn('auto-capture: user failed', { email: u.email, error: e.message });
      }
    }
    log.info('auto-capture sweep done', { scannedUsers, captured, detectedMeetings, skippedUsers, errored });
    res.json({ scannedUsers, captured, detectedMeetings, skippedUsers, errored, errors: errors.slice(0, 20), tookMs: Date.now() - startedAt });
  } catch (err) {
    log.error('auto-capture sweep failed', { error: err.message });
    res.status(500).json({ error: 'Auto-capture sweep failed' });
  }
});

// POST /api/admin/check-upcoming — pre-meeting reminder for LAPSING recurring
// trackers. Builds the habit loop: nudge a user shortly before the next instance
// of a series they used to track but have slipped on, so they open the panel
// when they join. Self-limiting on purpose — a series only qualifies if it hasn't
// been tracked in LAPSE_DAYS, so reliable daily/weekly trackers never get emailed
// (respects the "don't annoy" line). DORMANT until a ~15-min Cloud Scheduler job
// hits it. Same dual auth as the other sweeps.
//   Scale note: this reads getUserMeetingSeries per active user per run. Fine at
//   current scale; at 1000s of users, gate on a maintained `tracksRecurring` flag.
// POST /api/admin/org-digest — weekly attendance summary to each Pro
// domain's team admin (Cloud Scheduler: Mondays). The retention spine of the
// domain/Institution tier. Dedupe: claimReengagementSlot keyed by ISO week,
// so retries and manual triggers never double-send.
router.post('/admin/org-digest', requireSuperAdminOrScheduler, async (req, res) => {
  const startedAt = Date.now();
  const budgetMs = sweepBudgetMs();
  const now = new Date();
  // Epoch-week bucket (Monday-aligned): the old Jan-1-anchored ceil produced
  // a 1–2 day stub week at year rollover, so the digest could double-send on
  // consecutive Mondays straddling New Year. Epoch weeks are continuous.
  const EPOCH_MONDAY_MS = Date.UTC(1970, 0, 5); // first Monday after the epoch
  const week = `w${Math.floor((now.getTime() - EPOCH_MONDAY_MS) / (7 * 86400000))}`;
  let scanned = 0, sent = 0, skipped = 0, errored = 0;
  try {
    const snap = await getDb().collection('tenants').where('plan', '==', 'pro').get();
    // Rotate + budget-guard like the other sweeps — the ISO-week claim makes
    // the tail resume next run without double-sending.
    for (const doc of rotateForFairness(snap.docs)) {
      if (Date.now() - startedAt > budgetMs) break;
      scanned++;
      const domain = doc.id;
      const adminEmail = (doc.data()?.adminEmail || '').toLowerCase();
      try {
        if (!adminEmail) { skipped++; continue; }
        if (await isEmailSuppressed(adminEmail)) { skipped++; continue; }
        const slot = await claimReengagementSlot(domain, adminEmail, `orgdigest:${week}`);
        if (!slot.claimed) { skipped++; continue; }
        // From here on, a failure must RELEASE the week slot — the claim is
        // permanent, so leaving it would silently cancel this domain's digest
        // for the week (dispatchEmail returns {sent:false} rather than throw).
        const release = async () => { try { await slot.ref?.delete(); } catch { /* best-effort */ } };
        try {
          const overview = await getTeamOverview(domain);
          // Nothing tracked yet → nothing to digest (no empty-brag emails).
          if (!overview || !(overview.totals?.meetings > 0)) { await release(); skipped++; continue; }
          const weekAgo = Date.now() - 7 * 86400000;
          const weeklyMeetings = (overview.meetings || []).filter(m => {
            const ts = new Date(m.startTime || m.createdAt || m.exportedAt || 0).getTime();
            return ts > weekAgo;
          }).length;
          const result = await sendOrgWeeklyDigest({ to: adminEmail, domain, totals: overview.totals, weeklyMeetings });
          if (result && result.sent) {
            sent++;
          } else {
            await release();
            errored++;
            log.warn('org-digest: send did not complete — slot released for retry', { domain, result });
          }
        } catch (inner) {
          await release();
          throw inner;
        }
      } catch (e) {
        errored++;
        log.warn('org-digest: tenant failed', { domain, error: e.message });
      }
    }
    res.json({ scanned, sent, skipped, errored, week });
  } catch (err) {
    log.error('admin: org-digest failed', { error: err.message });
    res.status(500).json({ error: 'Org digest sweep failed' });
  }
});

router.post('/admin/check-upcoming', requireSuperAdminOrScheduler, async (req, res) => {
  const startedAt = Date.now();
  const budgetMs = sweepBudgetMs();
  const now = Date.now();
  const LAPSE_MS = 6 * 24 * 60 * 60 * 1000;        // only remind about series untracked 6+ days
  const DORMANT_MS = 45 * 24 * 60 * 60 * 1000;     // skip long-dormant accounts
  const WIN_FROM = 25 * 60000, WIN_TO = 40 * 60000; // remind ~30 min out (email-checkable lead)
  let scanned = 0, reminded = 0, skipped = 0, errored = 0;
  const errors = [];
  try {
    const users = rotateForFairness(await getAllUsersAcrossTenants());
    for (const u of users) {
      if (Date.now() - startedAt > budgetMs) { log.warn('check-upcoming: budget exhausted', { scanned }); break; }
      try {
        if (u.lastLoginAt && (now - new Date(u.lastLoginAt).getTime()) > DORMANT_MS) { skipped++; continue; }
        if (await isEmailSuppressed(u.email)) { skipped++; continue; }

        // Which recurring series does this user track — and which are LAPSING?
        const { series } = await getUserMeetingSeries(u.domain, u.email);
        const lapsing = new Map();
        for (const s of (series || [])) {
          if (!s.recurringEventId) continue;
          const lastMs = typeof s.lastAt === 'number' ? s.lastAt : Date.parse(s.lastAt);
          if (lastMs && (now - lastMs) >= LAPSE_MS) lapsing.set(s.recurringEventId, s.title);
        }
        if (!lapsing.size) { skipped++; continue; }

        const userDoc = await getUser(u.domain, u.email);
        if (!userDoc || !userDoc.refreshToken) { skipped++; continue; }
        let accessToken;
        try { accessToken = (await refreshAccessToken(userDoc.refreshToken)).access_token; }
        catch (e) { log.warn('check-upcoming: token refresh failed', { email: u.email, error: e.message }); skipped++; continue; }

        // Calendar instances starting inside the reminder window.
        let items = [];
        try {
          const cal = google.calendar({ version: 'v3', auth: makeUserClient(accessToken) });
          const resp = await cal.events.list({
            calendarId: 'primary',
            timeMin: new Date(now + WIN_FROM).toISOString(),
            timeMax: new Date(now + WIN_TO).toISOString(),
            singleEvents: true, orderBy: 'startTime', maxResults: 20,
          });
          items = (resp.data && resp.data.items) || [];
        } catch (e) { log.warn('check-upcoming: calendar list failed', { email: u.email, error: e.message }); skipped++; continue; }
        scanned++;

        for (const ev of items) {
          if (Date.now() - startedAt > budgetMs) break;
          // Only an instance of a LAPSING series the user tracks, with a Meet link.
          if (!ev.recurringEventId || !lapsing.has(ev.recurringEventId)) continue;
          const hasMeet = !!ev.hangoutLink || !!(ev.conferenceData && ev.conferenceData.conferenceId);
          const startIso = ev.start && (ev.start.dateTime || ev.start.date);
          if (!hasMeet || !startIso) continue;

          const dedupKey = `upcoming:${ev.id}`; // unique per calendar instance → once ever
          const claim = await claimReengagementSlot(u.domain, u.email, dedupKey);
          if (!claim.claimed) continue;
          const minutesUntil = Math.max(0, Math.round((new Date(startIso).getTime() - now) / 60000));
          const result = await sendUpcomingMeetingEmail({
            to: u.email, displayName: u.displayName || null,
            meetingTitle: ev.summary || lapsing.get(ev.recurringEventId) || 'your meeting',
            minutesUntil,
          });
          if (!result || result.sent !== true) {
            try { await claim.ref.delete(); } catch (_) { /* let a later run retry */ }
            errored++; if (result && result.error) errors.push({ email: u.email, error: result.error });
            continue;
          }
          logEvent(u.domain, { email: u.email, type: 'reengagement_fired', meta: { reminderType: 'upcoming_reminder', dedupKey } });
          reminded++;
        }
      } catch (e) {
        errored++; errors.push({ email: u.email, error: e.message });
        log.warn('check-upcoming: user failed', { email: u.email, error: e.message });
      }
    }
    log.info('check-upcoming sweep done', { scanned, reminded, skipped, errored });
    res.json({ scanned, reminded, skipped, errored, errors: errors.slice(0, 20), tookMs: Date.now() - startedAt });
  } catch (err) {
    log.error('check-upcoming sweep failed', { error: err.message });
    res.status(500).json({ error: 'check-upcoming sweep failed' });
  }
});

module.exports = router;
