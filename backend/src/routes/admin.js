const { Router } = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const CONFIG = require('../config');
const log = require('../lib/logger');
const { upsertTenantConfig, getTenantConfig, getDb, getAllUsersAcrossTenants, getAggregatedInsights, setUserAcquisitionSource, getOutreachList, getRecentActivity, getActivityPulse, getRevenueFunnel, getReachOutSuggestions, getPowerUserPipeline, markUserContacted, dismissSuggestion, getUserDetail, setAdminNote, searchAdminNotes, appendConversation, setOutreachStatus, createReminder, markReminderDone, getDueReminders, getEmailTemplates, setEmailTemplates, getAdvancedAnalytics, getWeeklySelfReport, getActivationFunnel, evaluateSeriesAlerts, claimDailyAlertSlot, recordAlertsSent, seriesAlertKey, claimSeriesAlertCondition, evaluateReengagementForUser, claimReengagementSlot, logEvent, isEmailSuppressed, getSuppressedEmailSet, getUserSettings, getUser, getExportedConferenceIds, getUserMeetingSeries, persistAttendance, getTeamOverview, getRecentErrorSpike, getErrorAlertState, setErrorAlertState, getBillingAlertState, setBillingAlertState, getCancellationTelemetry, backfillAdminActivityIfSparse, checkAndRecordMilestones, getMilestoneProgress, getTenantPlan, getRevenueSummary } = require('../services/firestore');
const { sendAdminEmail, sendErrorSpikeAlertEmail, sendBillingSpikeAlertEmail, sendDailySummaryEmail, sendWeeklySelfReport, sendSeriesAlertEmail, sendReactivationEmail, sendActivationNudgeEmail, sendSoloNudgeEmail, sendForgottenMeetingEmail, sendComebackEmail, sendExportGapEmail, sendUpcomingMeetingEmail, sendOrgWeeklyDigest, flushDeferredNotifications,
  sendSourceReportedNotification, verifyReviewApprovalToken, sendReviewRewardEmail, sendPassExpiryReminderEmail } = require('../lib/notifications');
const { getBillingTelemetry, evaluateBillingWatchdog } = require('../services/billing-telemetry');
const { escapeHtml } = require('../lib/html');
const { requireSuperAdmin, requireSuperAdminOrScheduler, requireKhMetricsKey, safeEqual } = require('../middleware/adminAuth');
const { requireAuth } = require('../middleware/auth');
const { domainOf, lastSegment, PERSONAL_EMAIL_DOMAINS, FieldValue, tsMs } = require('../services/firestore/_core'); // pure util; imported directly (test firestore-mocks needn't stub it)
const { ACQUISITION_SOURCES } = require('../lib/constants');
const { planIsPro } = require('./billing');
const { refreshAccessToken, makeUserClient } = require('../services/googleAuth');
const { meetGet, fetchConferenceParticipants } = require('../services/meetApi');
const { google } = require('googleapis');
const { buildAndSaveExport } = require('./sheets');
const { reconcilePendingReviews } = require('../services/review-verifier');
const { syncMarketplaceReviews } = require('../services/marketplace-reviews');

async function createSuppressedChecker() {
  let suppressedSet = null;
  if (typeof getSuppressedEmailSet === 'function') {
    try {
      const loaded = await getSuppressedEmailSet();
      if (loaded instanceof Set) suppressedSet = loaded;
    } catch (_) {
      suppressedSet = null;
    }
  }
  return async (email) => {
    if (!email) return false;
    if (suppressedSet instanceof Set) {
      return suppressedSet.has(String(email).toLowerCase());
    }
    return isEmailSuppressed(email);
  };
}

function createDomainMeetingsLoader() {
  const cache = new Map();
  return async (domain) => {
    if (!domain) return null;
    const key = String(domain).toLowerCase();
    if (cache.has(key)) return cache.get(key);
    try {
      const db = typeof getDb === 'function' ? getDb() : null;
      const snap = await db?.collection?.('tenants')?.doc?.(domain)?.collection?.('meetings')?.get?.();
      const list = snap && Array.isArray(snap.docs)
        ? snap.docs.map(d => ({ id: d.id, ref: d.ref, data: typeof d.data === 'function' ? d.data() : (d.data || {}) }))
        : null;
      cache.set(key, list);
      return list;
    } catch (_) {
      cache.set(key, null);
      return null;
    }
  };
}

const SUPER_ADMIN_EMAIL = CONFIG.superAdminEmail;
function isSuperAdminUser(email) {
  if (!email) return false;
  if (typeof CONFIG.isSuperAdmin === 'function') {
    return CONFIG.isSuperAdmin(email);
  }
  return String(email).trim().toLowerCase() === (CONFIG.superAdminEmail || '').toLowerCase();
}
// Pro grants that were given away, not bought (35-day review/referral rewards).
const FREE_GRANT_PLAN_TYPES = new Set(['review_reward', 'referral_reward']);
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
  const isSuperAdmin = isSuperAdminUser(req.user?.email);
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
const _statsCache = new Map();
const STATS_CACHE_MS = 60 * 1000;

router.get('/admin/stats', requireAuth, async (req, res) => {
  try {
    const isSuper = isSuperAdminUser(req.user.email);
    const domain = req.user.domain;
    const force = req.query.nocache === '1' || req.query.refresh === '1';
    const cacheKey = `${domain}:${isSuper}`;

    if (!force && process.env.NODE_ENV !== 'test') {
      const hit = _statsCache.get(cacheKey);
      if (hit && (Date.now() - hit.at) < STATS_CACHE_MS) {
        return res.json(hit.data);
      }
    }

    const db = getDb();

    let tenants = [];
    let allUsers = [];
    if (isSuper) {
      // Tenant list: explicit docs + any domain we have users in.
      const [tenantsSnap, fetchedUsers] = await Promise.all([
        db.collection('tenants').get(),
        getAllUsersAcrossTenants(),
      ]);
      allUsers = fetchedUsers || [];
      const tenantMap = new Map();
      for (const d of tenantsSnap.docs) {
        tenantMap.set(d.id, { domain: d.id, ...d.data() });
      }
      for (const u of allUsers) {
        const dom = u.domain;
        if (dom && !tenantMap.has(dom)) {
          tenantMap.set(dom, { domain: dom, active: true, installedAt: null });
        }
      }
      tenants = [...tenantMap.values()];
    }

    // Count users, meetings, exports for the requesting user's domain
    const usersRef = db.collection('tenants').doc(domain).collection('users');
    const meetingsRef = db.collection('tenants').doc(domain).collection('meetings');
    const exportsRef = db.collection('tenants').doc(domain).collection('exports');

    const [usersSnap, meetingsCountSnap, exportsCountSnap] = await Promise.all([
      usersRef.get(),
      typeof meetingsRef.count === 'function' ? meetingsRef.count().get() : meetingsRef.get(),
      typeof exportsRef.count === 'function' ? exportsRef.count().get() : exportsRef.get(),
    ]);

    const meetingsCount = meetingsCountSnap.data ? meetingsCountSnap.data().count : meetingsCountSnap.size;
    const exportsCount = exportsCountSnap.data ? exportsCountSnap.data().count : exportsCountSnap.size;

    // Recent users are per-user PII. Gate it to the founder.
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

    let globalStats = null;
    let activeProUsers = 0;
    let estimatedMrr = 0;
    let milestones = null;
    let revenue = null;
    if (isSuper) {
      // Paying customers only: the owner's own account and the free 35-day
      // review/referral reward grants are Pro but never paid anything.
      const activeProList = (allUsers || []).filter(u =>
        u.individualPlan === 'pro' &&
        u.individualBillingStatus === 'active' &&
        !isSuperAdminUser(u.email) &&
        !FREE_GRANT_PLAN_TYPES.has(u.individualPlanType) &&
        (!u.individualPlanExpiresAt || new Date(u.individualPlanExpiresAt).getTime() > Date.now())
      );
      activeProUsers = activeProList.length;
      // MRR comes from the revenue ledger (active recurring subscriptions,
      // normalized to monthly). One-time Lifetime/meeting passes are cash, not
      // MRR — the old pro-users × $9.99 figure counted them as monthly revenue.
      try {
        revenue = await getRevenueSummary();
      } catch (rErr) {
        log.warn('admin: revenue summary failed', { error: rErr.message });
      }
      estimatedMrr = revenue ? Math.round((revenue.mrrApproxUsd || 0) / 100) : 0;

      const [usersAgg, meetingsAgg, exportsAgg] = await Promise.all([
        db.collectionGroup('users').count().get().catch(() => null),
        db.collectionGroup('meetings').count().get().catch(() => null),
        db.collectionGroup('exports').count().get().catch(() => null),
      ]);
      globalStats = {
        users: usersAgg?.data ? usersAgg.data().count : null,
        meetings: meetingsAgg?.data ? meetingsAgg.data().count : null,
        exports: exportsAgg?.data ? exportsAgg.data().count : null,
        activeProUsers,
        estimatedMrr,
      };

      try {
        const counts = {
          userCount: globalStats.users || 0,
          proCount: activeProUsers || 0,
          meetingCount: globalStats.meetings || 0,
        };
        await checkAndRecordMilestones(counts);
        milestones = await getMilestoneProgress(counts);
      } catch (mErr) {
        log.warn('admin: milestone check in stats failed', { error: mErr.message });
      }
    }

    const responseData = {
      totalTenants: isSuper ? tenants.length : null,
      activeProUsers: isSuper ? activeProUsers : null,
      estimatedMrr: isSuper ? estimatedMrr : null,
      revenue: isSuper ? revenue : null,
      globalStats,
      milestones: isSuper ? milestones : null,
      tenants: isSuper ? tenants.map(t => ({
        domain: t.domain,
        active: t.active !== false,
        installedAt: t.installedAt?.toDate?.()?.toISOString?.() || t.installedAt || null,
      })) : [],
      yourDomain: {
        domain,
        users: usersSnap.size,
        meetings: meetingsCount,
        exports: exportsCount,
        recentUsers,
      },
    };

    if (process.env.NODE_ENV !== 'test') {
      _statsCache.set(cacheKey, { at: Date.now(), data: responseData });
    }

    res.json(responseData);
  } catch (err) {
    log.error('admin: stats failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// GET /api/admin/milestones — Return achieved and upcoming founder growth milestones
router.get('/admin/milestones', requireSuperAdmin, async (req, res) => {
  try {
    const db = getDb();
    const hasColGroup = typeof db?.collectionGroup === 'function';
    const [usersAgg, meetingsAgg, allUsers] = await Promise.all([
      hasColGroup ? Promise.resolve().then(() => db.collectionGroup('users').count().get()).catch(() => null) : null,
      hasColGroup ? Promise.resolve().then(() => db.collectionGroup('meetings').count().get()).catch(() => null) : null,
      Promise.resolve().then(() => typeof getAllUsersAcrossTenants === 'function' ? getAllUsersAcrossTenants() : []).catch(() => []),
    ]);

    const userList = Array.isArray(allUsers) ? allUsers : [];
    const activeProUsers = userList.filter(u =>
      u?.individualPlan === 'pro' &&
      u?.individualBillingStatus === 'active' &&
      (!u?.individualPlanExpiresAt || new Date(u.individualPlanExpiresAt).getTime() > Date.now())
    ).length;
    const counts = {
      userCount: usersAgg?.data ? usersAgg.data().count : userList.length,
      proCount: activeProUsers,
      meetingCount: meetingsAgg?.data ? meetingsAgg.data().count : 0,
    };

    const progress = await getMilestoneProgress(counts);
    res.json({
      success: true,
      counts,
      ...progress,
    });
  } catch (err) {
    log.error('admin: failed to get milestones', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch growth milestones' });
  }
});

// POST /api/admin/check-milestones — Trigger milestone evaluation and alert dispatch
router.post('/admin/check-milestones', requireSuperAdminOrScheduler, async (req, res) => {
  try {
    const db = getDb();
    const hasColGroup = typeof db?.collectionGroup === 'function';
    const [usersAgg, meetingsAgg, allUsers] = await Promise.all([
      hasColGroup ? Promise.resolve().then(() => db.collectionGroup('users').count().get()).catch(() => null) : null,
      hasColGroup ? Promise.resolve().then(() => db.collectionGroup('meetings').count().get()).catch(() => null) : null,
      Promise.resolve().then(() => typeof getAllUsersAcrossTenants === 'function' ? getAllUsersAcrossTenants() : []).catch(() => []),
    ]);

    const userList = Array.isArray(allUsers) ? allUsers : [];
    const activeProUsers = userList.filter(u =>
      u?.individualPlan === 'pro' &&
      u?.individualBillingStatus === 'active' &&
      (!u?.individualPlanExpiresAt || new Date(u.individualPlanExpiresAt).getTime() > Date.now())
    ).length;
    const counts = {
      userCount: usersAgg?.data ? usersAgg.data().count : userList.length,
      proCount: activeProUsers,
      meetingCount: meetingsAgg?.data ? meetingsAgg.data().count : 0,
    };

    const newlyUnlocked = await checkAndRecordMilestones(counts);
    const progress = await getMilestoneProgress(counts);

    res.json({
      success: true,
      newlyUnlockedCount: newlyUnlocked.length,
      newlyUnlocked,
      progress,
    });
  } catch (err) {
    log.error('admin: failed to check milestones', { error: err.message });
    res.status(500).json({ error: 'Failed to check growth milestones' });
  }
});

// GET /api/admin/all-users — List every user across every tenant (super admin only)
router.get('/admin/all-users', requireSuperAdmin, async (req, res) => {
  try {
    const rawUsers = await getAllUsersAcrossTenants();
    const users = (Array.isArray(rawUsers) ? rawUsers : []).map(({ refreshToken, ...rest }) => rest);
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

// GET /api/admin/telemetry/cancellations — dedicated stream of subscription and email cancellations
router.get('/admin/telemetry/cancellations', requireSuperAdmin, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const category = typeof req.query.category === 'string' ? req.query.category : null;
    const cancellations = await getCancellationTelemetry({ limit, category });
    res.json({ cancellations });
  } catch (err) {
    log.error('admin: telemetry/cancellations failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch cancellation telemetry' });
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
    const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));
    const suggestions = await getReachOutSuggestions({ limit });
    res.json({ suggestions: suggestions.slice(0, limit) });
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

// POST /api/admin/backfill-activity — seeds recent activity events into root admin_activity
router.post('/admin/backfill-activity', requireSuperAdmin, async (req, res) => {
  try {
    const force = Boolean(req.query.force || req.body?.force);
    const result = await backfillAdminActivityIfSparse({ force });
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('admin: backfill-activity failed', { error: err.message });
    res.status(500).json({ error: 'Failed to backfill admin activity' });
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

// POST /api/admin/dismiss-suggestion — dismiss or snooze a reach-out suggestion
router.post('/admin/dismiss-suggestion', requireSuperAdmin, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email required' });
    }
    await dismissSuggestion(email);
    res.json({ ok: true });
  } catch (err) {
    log.error('admin: dismiss-suggestion failed', { error: err.message });
    res.status(500).json({ error: 'Failed to dismiss suggestion' });
  }
});

// GET /api/admin/weekly-report?preview=1 — returns the JSON for inspection
// POST /api/admin/weekly-report — actually sends the email to NOTIFY_EMAIL
// Two endpoints so you can preview before triggering. Cloud Scheduler can
// hit the POST endpoint every Monday morning.
router.get('/admin/weekly-report', requireSuperAdmin, async (req, res) => {
  try {
    const report = await getWeeklySelfReport();
    if (report && req.query.includeBilling !== '0' && (process.env.NODE_ENV !== 'test' || req.query.includeBilling === '1')) {
      try {
        const billing = await getBillingTelemetry({ useCache: process.env.NODE_ENV !== 'test' });
        if (billing) report.billing = billing;
      } catch (_) {}
    }
    res.json(report || { error: 'failed' });
  } catch (err) {
    log.error('admin: weekly-report get failed', { error: err.message });
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
    if (req.query.includeBilling !== '0' && req.body?.includeBilling !== false && (process.env.NODE_ENV !== 'test' || req.query.includeBilling === '1' || req.body?.includeBilling === true)) {
      try {
        const billing = await getBillingTelemetry({ useCache: process.env.NODE_ENV !== 'test' });
        if (billing) report.billing = billing;
      } catch (_) {}
    }
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
    await sendErrorSpikeAlertEmail({
      to,
      total: spike.total,
      threshold: THRESHOLD,
      windowMin: WINDOW_MIN,
      byReason: spike.byReason,
      users: spike.users,
      samples: spike.samples,
    });
    await setErrorAlertState({ lastAlertedAt: new Date().toISOString(), lastTotal: spike.total });
    res.json({ ok: true, total: spike.total, alerted: true });
  } catch (err) {
    log.error('admin: check-errors failed', { err, error: err.message });
    res.status(500).json({ error: err.message || 'Failed' });
  }
});

// GET /api/admin/billing-telemetry — Live Cloud Monitoring Firestore & Cloud Run
// usage + estimated USD cost (memoized for 12 minutes so polling costs zero
// Firestore reads).
router.get('/admin/billing-telemetry', requireSuperAdmin, async (req, res) => {
  try {
    const force = req.query.refresh === '1' || req.query.force === '1';
    const useCache = process.env.NODE_ENV !== 'test' || req.query.useCache === '1';
    const telemetry = await getBillingTelemetry({ force, useCache });
    const watchdog = evaluateBillingWatchdog(telemetry);
    res.json({ ...telemetry, watchdog });
  } catch (err) {
    log.error('admin: billing-telemetry failed', { error: err.message });
    res.status(500).json({ error: err.message || 'Failed to load billing telemetry' });
  }
});

// POST /api/admin/check-billing — Automated Cloud Billing & Firestore spike
// watchdog. Evaluates trailing 1h read/write rates and 24h estimated USD cost
// against safe thresholds ($2.00/day or 500k reads/hr or 25k writes/hr) and
// sends a deduplicated high-priority alert email (max 1 alert per 24h cooldown
// unless force=true or a new 1h read/write spike escalates).
router.post('/admin/check-billing', requireSuperAdminOrScheduler, async (req, res) => {
  try {
    const force = req.query.force === '1' || req.body?.force === true;
    const dryRun = req.query.dryRun === '1' || req.body?.dryRun === true;
    const cooldownHours = Number(process.env.BILLING_ALERT_COOLDOWN_H) || 24;
    const dailyCostUsdThreshold = Number(req.body?.dailyCostUsdThreshold || process.env.BILLING_ALERT_DAILY_USD) || 2.0;
    const hourlyReadThreshold = Number(req.body?.hourlyReadThreshold || process.env.BILLING_ALERT_HOURLY_READS) || 500_000;
    const hourlyWriteThreshold = Number(req.body?.hourlyWriteThreshold || process.env.BILLING_ALERT_HOURLY_WRITES) || 25_000;

    const telemetry = await getBillingTelemetry({
      force: true,
      useCache: false,
    });
    const evaluation = evaluateBillingWatchdog(telemetry, {
      dailyCostUsdThreshold,
      hourlyReadThreshold,
      hourlyWriteThreshold,
    });
    const summary = {
      currentHourReads: telemetry.currentHour?.reads || 0,
      currentHourWrites: telemetry.currentHour?.writes || 0,
      last24hReads: telemetry.last24h?.reads || 0,
      last24hWrites: telemetry.last24h?.writes || 0,
      last24hDeletes: telemetry.last24h?.deletes || 0,
      last24hCostUsd: telemetry.last24h?.cost?.totalCostUsd || 0,
      monthToDateReads: telemetry.monthToDate?.reads || 0,
      monthToDateWrites: telemetry.monthToDate?.writes || 0,
      monthToDateCostUsd: telemetry.monthToDate?.cost?.totalCostUsd || 0,
      projectedMonthCostUsd: telemetry.projections?.monthTotalFrom24hRateUsd || 0,
    };

    if (!evaluation.breached) {
      return res.json({
        ok: true,
        alerted: false,
        reason: 'healthy',
        evaluation,
        summary,
      });
    }

    if (!force && typeof getBillingAlertState === 'function') {
      const state = await getBillingAlertState();
      const lastMs = state && state.lastAlertedAt ? Date.parse(state.lastAlertedAt) : 0;
      const isEscalation = Boolean(
        state &&
        ((state.readSpike1h === false && evaluation.readSpike1h) ||
         (state.writeSpike1h === false && evaluation.writeSpike1h))
      );
      if (lastMs && !isEscalation && (Date.now() - lastMs) < cooldownHours * 3600 * 1000) {
        return res.json({
          ok: true,
          alerted: false,
          reason: 'cooldown',
          lastAlertedAt: state.lastAlertedAt,
          evaluation,
          summary,
        });
      }
    }

    if (dryRun) {
      return res.json({
        ok: true,
        alerted: false,
        reason: 'dry_run',
        evaluation,
        summary,
      });
    }

    const recipients = [
      process.env.NOTIFY_EMAIL || CONFIG.superAdminEmail || 'derek@attendancetracker.dev',
      'derekgallardo01@gmail.com',
    ].filter(Boolean);

    const emailResult = await sendBillingSpikeAlertEmail({
      to: recipients,
      telemetry,
      evaluation,
      projectId: telemetry.projectId,
    });

    if (typeof setBillingAlertState === 'function') {
      await setBillingAlertState({
        lastAlertedAt: new Date().toISOString(),
        last24hCostUsd: telemetry.last24h?.cost?.totalCostUsd || 0,
        currentHourReads: telemetry.currentHour?.reads || 0,
        readSpike1h: evaluation.readSpike1h,
        writeSpike1h: evaluation.writeSpike1h,
        costSpike24h: evaluation.costSpike24h,
        reasons: evaluation.reasons,
      });
    }

    res.json({
      ok: true,
      alerted: true,
      evaluation,
      summary,
      emailResult,
    });
  } catch (err) {
    log.error('admin: check-billing failed', { error: err.message });
    res.status(500).json({ error: err.message || 'Failed to check billing' });
  }
});

// GET /api/admin/daily-summary — Preview daily ops + cloud billing summary JSON
router.get('/admin/daily-summary', requireSuperAdmin, async (req, res) => {
  try {
    const [pulse, billing] = await Promise.all([
      getActivityPulse(),
      getBillingTelemetry({ useCache: process.env.NODE_ENV !== 'test' }),
    ]);
    res.json({ ok: true, pulse, billing });
  } catch (err) {
    log.error('admin: daily-summary get failed', { error: err.message });
    res.status(500).json({ error: err.message || 'Failed to build daily summary' });
  }
});

// POST /api/admin/daily-summary — Send daily ops + cloud billing digest email
router.post('/admin/daily-summary', requireSuperAdminOrScheduler, async (req, res) => {
  try {
    const [pulse, billing] = await Promise.all([
      getActivityPulse(),
      getBillingTelemetry({ useCache: process.env.NODE_ENV !== 'test' }),
    ]);
    const to = req.body?.to || process.env.NOTIFY_EMAIL || CONFIG.superAdminEmail;
    const result = await sendDailySummaryEmail({ to, pulse, billing });
    res.json({
      ok: true,
      result,
      summary: {
        last24hCostUsd: billing?.last24h?.cost?.totalCostUsd || 0,
        last24hReads: billing?.last24h?.reads || 0,
        monthToDateCostUsd: billing?.monthToDate?.cost?.totalCostUsd || 0,
        monthToDateReads: billing?.monthToDate?.reads || 0,
      },
    });
  } catch (err) {
    log.error('admin: daily-summary send failed', { error: err.message });
    res.status(500).json({ error: err.message || 'Failed to send daily summary' });
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
    const isSuppressed = await createSuppressedChecker();
    const getDomainMeetings = createDomainMeetingsLoader();
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
      // timer was lost to a Cloud Run instance restart. Only invoke when the
      // preloaded user doc shows a pending flag (or when flags are omitted in
      // unit test fixtures) so we don't perform 2 extra user-doc reads per user.
      if (
        user.signupNotifyPending ||
        user.referralNotifyPending ||
        (user.signupNotifyPending === undefined && user.referralNotifyPending === undefined)
      ) {
        flushDeferredNotifications(user.domain, user.email);
      }
      // Don't send lifecycle mail to the owner's own account (self/test).
      if (isSuperAdminUser(user.email)) continue;
      usersChecked++;
      try {
        // CAN-SPAM: never send lifecycle mail to a suppressed address.
        if (await isSuppressed(user.email)) { totalSkipped++; continue; }

        const reminders = await evaluateReengagementForUser(user.domain, user.email, {
          userDoc: user,
          domainMeetings: () => getDomainMeetings(user.domain),
        });
        if (reminders.length === 0) continue;
        let fired = 0;

        for (const r of reminders) {
          // Dedup key shape: type, type:recurringEventId, or type:YYYY-MM-DD.
          // Persistent so each kind of reminder fires once per user/window.
          const dedupKey = r.dedupKey || (r.type === 'forgotten_meeting'
            ? `forgotten_meeting:${r.recurringEventId}`
            : r.type);
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
              domain: user.domain,
              country: user.signupGeo?.country,
              language: user.language,
            });
          } else if (r.type === 'activation_7d') {
            result = await sendActivationNudgeEmail({
              to: user.email,
              displayName: user.displayName || null,
              daysSinceLogin: r.daysSinceLogin,
              domain: user.domain,
              country: user.signupGeo?.country,
              language: user.language,
            });
          } else if (r.type === 'solo_nudge_7d') {
            result = await sendSoloNudgeEmail({
              to: user.email,
              displayName: user.displayName || null,
              daysSinceLogin: r.daysSinceLogin,
              domain: user.domain,
              country: user.signupGeo?.country,
              language: user.language,
            });
          } else if (r.type === 'forgotten_meeting') {
            result = await sendForgottenMeetingEmail({
              to: user.email,
              displayName: user.displayName || null,
              seriesTitle: r.seriesTitle,
              recurringEventId: r.recurringEventId,
              trackedInWindow: r.trackedInWindow,
              daysSinceLast: r.daysSinceLast,
              domain: user.domain,
              country: user.signupGeo?.country,
              language: user.language,
            });
          } else if (r.type === 'comeback_7d') {
            result = await sendComebackEmail({
              to: user.email,
              displayName: user.displayName || null,
              meetingTitle: r.meetingTitle,
              daysSinceLogin: r.daysSinceLogin,
              domain: user.domain,
              country: user.signupGeo?.country,
              language: user.language,
            });
          } else if (r.type === 'export_gap') {
            result = await sendExportGapEmail({
              to: user.email,
              displayName: user.displayName || null,
              meetingTitle: r.meetingTitle,
              daysSinceLogin: r.daysSinceLogin,
              domain: user.domain,
              country: user.signupGeo?.country,
              language: user.language,
            });
          } else if (r.type && (r.type.startsWith('expiry_') || r.type.startsWith('grant_expiry_') || r.type.startsWith('trial_expiry_'))) {
            let checkoutUrl = null;
            if (CONFIG.sessionSecret) {
              const token = jwt.sign(
                { email: user.email.toLowerCase(), domain: user.domain, purpose: 'checkout_redirect', country: user.signupGeo?.country || null },
                CONFIG.sessionSecret,
                { expiresIn: '7d' }
              );
              const baseUrl = (CONFIG.appUrl || 'https://attendance-tracker-backend-829771833968.us-central1.run.app').replace(/\/$/, '');
              checkoutUrl = `${baseUrl}/api/billing/checkout-redirect?token=${encodeURIComponent(token)}&plan=pro_annual`;
            }
            result = await sendPassExpiryReminderEmail({
              to: user.email,
              displayName: user.displayName || null,
              reminderType: r.type,
              planType: r.planType || user.individualPlanType || 'annual',
              expiresAt: r.expiresAt || user.individualPlanExpiresAt,
              daysUntilExpiry: r.daysUntilExpiry,
              stats: r.stats || {},
              checkoutUrl,
              domain: user.domain,
              country: user.signupGeo?.country,
              language: user.language,
            });
          }
          if (!result || result.sent !== true) {
            // Release the claim; leave it open for the next run.
            try { await claim.ref.delete(); } catch (delErr) { log.warn('admin: failed to release reengagement claim', { email: user.email, error: delErr.message }); }
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

    // Daily review sweep: scrape marketplace reviews across all languages and reconcile with pending users
    let reviewSweep = null;
    try {
      reviewSweep = await reconcilePendingReviews(users);
      log.info('admin: check-reengagement review sweep completed', reviewSweep);
    } catch (err) {
      log.error('admin: check-reengagement review sweep failed', { error: err.message });
    }

    const remaining = timedOut ? users.length - index : 0;
    if (timedOut) log.warn('admin: check-reengagement hit time budget', { processed: index, remaining });
    res.json({ usersChecked, usersWithReminders, totalSent, totalSkipped, errors, timedOut, remaining, reviewSweep });
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
    const isSuppressed = await createSuppressedChecker();
    const getDomainMeetings = createDomainMeetingsLoader();
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
      if (isSuperAdminUser(user.email)) continue; // no self-mail
      usersChecked++;
      try {
        // CAN-SPAM: skip suppressed addresses before doing any work.
        if (await isSuppressed(user.email)) { usersSkipped++; continue; }

        const claim = await claimDailyAlertSlot(user.domain, user.email);
        if (!claim.claimed) { usersSkipped++; continue; }

        const alerts = await evaluateSeriesAlerts(user.domain, user.email, {
          domainMeetings: () => getDomainMeetings(user.domain),
        });
        if (alerts === null) {
          // Evaluation ERRORED (Firestore blip) — release the day slot so the
          // next run retries instead of silencing the user until tomorrow.
          try { await claim.ref.delete(); } catch (delErr) { log.warn('admin: failed to release alert claim on eval error', { email: user.email, error: delErr.message }); }
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
          language: user.language || null,
          country: user.country || null,
          domain: user.domain || null,
        });
        if (!result || result.sent !== true) {
          try { await claim.ref.delete(); } catch (delErr) { log.warn('admin: failed to release alert claim on send failure', { email: user.email, error: delErr.message }); }
          for (const c of conditionClaims) { try { await c.ref.delete(); } catch (delErr) { log.warn('admin: failed to release condition claim', { email: user.email, error: delErr.message }); } }
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
    log.error('admin: set note failed', { email: req.body?.email, domain: req.body?.domain, error: err.message });
    res.status(500).json({ error: 'Failed to save note' });
  }
});

router.get('/admin/notes/search', requireSuperAdmin, async (req, res) => {
  try {
    const results = await searchAdminNotes(req.query.q || '');
    res.json({ results });
  } catch (err) {
    log.error('admin: search notes failed', { query: req.query?.q, error: err.message });
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
    log.error('admin: set outreach status failed', { email: req.body?.email, domain: req.body?.domain, error: err.message });
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
    log.error('admin: log reply failed', { email: req.body?.email, domain: req.body?.domain, error: err.message });
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/admin/templates', requireSuperAdmin, async (req, res) => {
  try {
    const items = await getEmailTemplates();
    res.json({ items });
  } catch (err) {
    log.error('admin: get email templates failed', { error: err.message });
    res.status(500).json({ error: 'Failed' });
  }
});

router.put('/admin/templates', requireSuperAdmin, async (req, res) => {
  try {
    await setEmailTemplates(req.body?.items || []);
    res.json({ success: true });
  } catch (err) {
    log.error('admin: set email templates failed', { error: err.message });
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
    log.error('admin: create reminder failed', { email: req.body?.email, domain: req.body?.domain, error: err.message });
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
    log.error('admin: mark reminder done failed', { id: req.params.id, domain: req.body?.domain, error: err.message });
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/admin/reminders/due', requireSuperAdmin, async (req, res) => {
  try {
    const reminders = await getDueReminders();
    res.json({ reminders });
  } catch (err) {
    log.error('admin: get due reminders failed', { error: err.message });
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

// Module-level cache for /kh/metrics so frequent polling (e.g. every 30s)
// from monitoring dashboards (Kinetic Helix) does not query Firestore on every call.
let _khMetricsCache = null;
let _khMetricsCachedAt = 0;
let _khMetricsInFlight = null;
const KH_METRICS_CACHE_MS = 2 * 60 * 60 * 1000; // 2 hours

// GET /api/kh/metrics — durable metrics pull for the Kinetic Helix command
// center. Same aggregate as /admin/insights (plus revenue), gated by a static
// x-kh-key header (KH_METRICS_KEY) so the connection doesn't expire.
router.get('/kh/metrics', requireKhMetricsKey, async (req, res) => {
  try {
    const force = req.query.refresh === '1' || req.query.force === '1';
    if (!force && process.env.NODE_ENV !== 'test' && _khMetricsCache && (Date.now() - _khMetricsCachedAt) < KH_METRICS_CACHE_MS) {
      return res.json(_khMetricsCache);
    }
    if (!force && _khMetricsInFlight) {
      const payload = await _khMetricsInFlight;
      return res.json(payload);
    }

    const run = (async () => {
      try {
        const insights = await getAggregatedInsights({ force });
        // MRR from the payments ledger (active recurring subscriptions). The old
        // pro-tenants × KH_MRR_SEAT_CENTS guess counted one-time domain passes as
        // monthly revenue.
        let revenue = { mrrCents: 0, proTenants: 0 };
        try {
          const [proSnap, summary] = await Promise.all([
            getDb().collection('tenants').where('plan', '==', 'pro').get(),
            getRevenueSummary(),
          ]);
          revenue = {
            mrrCents: summary?.mrrApproxUsd || 0,
            proTenants: proSnap.size,
            activeSubscriptions: summary?.activeSubscriptions || 0,
            cash30dCents: summary?.approxUsd?.last30d || 0,
          };
        } catch (e) {
          log.warn('admin: kh revenue failed', { error: e.message });
        }
        let billing = null;
        if (process.env.NODE_ENV !== 'test' || req.query.includeBilling === '1') {
          try {
            billing = await getBillingTelemetry({ force, useCache: process.env.NODE_ENV !== 'test' }) || null;
          } catch (_) {}
        }
        _khMetricsCache = { ...insights, revenue, ...(billing ? { billing } : {}), cachedAt: new Date().toISOString() };
        _khMetricsCachedAt = Date.now();
        return _khMetricsCache;
      } finally {
        _khMetricsInFlight = null;
      }
    })();

    if (!force) _khMetricsInFlight = run;
    const payload = await run;
    res.json(payload);
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
      await Promise.resolve(flushDeferredNotifications(req.user.domain, req.user.email)).catch(() => {});
      return res.json({ success: true, dismissed: true });
    }
    if (!ACQUISITION_SOURCES.has(source)) {
      return res.status(400).json({ error: 'Invalid source' });
    }
    const cleanDetail = typeof detail === 'string' ? detail.slice(0, 200) : null;
    await setUserAcquisitionSource(req.user.domain, req.user.email, { source, detail: cleanDetail });
    const flushed = await Promise.resolve(flushDeferredNotifications(req.user.domain, req.user.email)).catch(() => null);
    const signupJustFlushed = Array.isArray(flushed) && flushed[0]?.value && flushed[0].value.sent !== false;
    if (!signupJustFlushed && typeof sendSourceReportedNotification === 'function') {
      const u = await getUser(req.user.domain, req.user.email).catch(() => null);
      await Promise.resolve(sendSourceReportedNotification({
        email: req.user.email,
        displayName: u?.displayName || req.user.displayName || null,
        domain: req.user.domain,
        reportedSource: source,
        reportedDetail: cleanDetail,
        detectedSource: u?.signupDetectedSource || u?.acquisitionDetected || null,
      })).catch(() => {});
    }
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

// POST /api/admin/auto-capture — server-side attendance capture. Lists each

// active user's recent COMPLETED Meet conferences server-side and persists the
// final attendance roster to Firestore so meeting history is never lost even if
// the side panel was closed early. For Pro users, automatically exports to Google
// Sheets (unless explicitly disabled in settings). Dual auth: Scheduler or SuperAdmin.
function hasActiveIndividualProOnUser(u, nowMs = Date.now()) {
  if (u?.individualPlan !== 'pro') return false;
  if (u.individualPlanExpiresAt) {
    const expMs = Date.parse(u.individualPlanExpiresAt);
    const hasSub = !!u.individualStripeSubscriptionId;
    const isLifetime = u.individualPlanType === 'lifetime';
    if (!isNaN(expMs) && expMs <= nowMs && !hasSub && !isLifetime) return false;
  }
  return true;
}

router.post('/admin/auto-capture', requireSuperAdminOrScheduler, async (req, res) => {
  const startedAt = Date.now();
  const budgetMs = sweepBudgetMs();
  const RECENT_MS = 3 * 60 * 60 * 1000; // only conferences that ended in the last 3 hours (cron runs every 15 min)
  const ACTIVE_USER_CUTOFF_MS = 30 * 24 * 60 * 60 * 1000; // active in the last 30 days
  let scannedUsers = 0, captured = 0, detectedMeetings = 0, skippedUsers = 0, errored = 0;
  const errors = [];
  try {
    const users = rotateForFairness(await getAllUsersAcrossTenants());
    const isBillingLive = !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PRICE_ID;
    const isIndividualBillingLive = !!process.env.STRIPE_SECRET_KEY && !!(
      process.env.STRIPE_INDIVIDUAL_LIFETIME_PRICE_ID
      || process.env.STRIPE_EDUCATOR_PRICE_ID
      || process.env.STRIPE_INDIVIDUAL_PRICE_ID
    );
    let proTenantDomains = null;
    if (isBillingLive) {
      try {
        const db = typeof getDb === 'function' ? getDb() : null;
        const snap = await db?.collection?.('tenants')?.where?.('plan', '==', 'pro')?.get?.();
        if (snap && Array.isArray(snap.docs)) {
          proTenantDomains = new Set();
          const nowMs = Date.now();
          for (const doc of snap.docs) {
            const cfg = typeof doc.data === 'function' ? doc.data() : (doc.data || {});
            if (cfg?.plan !== 'pro') continue;
            if (cfg.planExpiresAt) {
              const expMs = Date.parse(cfg.planExpiresAt);
              if (!isNaN(expMs) && expMs <= nowMs && !cfg.stripeSubscriptionId) continue;
            }
            proTenantDomains.add(String(doc.id).toLowerCase());
          }
        }
      } catch (_) {
        proTenantDomains = null;
      }
    }

    let budgetExhausted = false;
    for (const u of users) {
      if (budgetMs - (Date.now() - startedAt) <= 30000) {
        log.warn('auto-capture: remaining budget under 30s before user sweep, breaking early', {
          scannedUsers,
          elapsedMs: Date.now() - startedAt,
          budgetMs,
        });
        break;
      }
      try {
        // Skip users dormant for over 30 days
        const lastActive = u.lastLoginAt || u.createdAt;
        if (lastActive && (Date.now() - new Date(lastActive).getTime()) > ACTIVE_USER_CUTOFF_MS) {
          skippedUsers++;
          continue;
        }

        // Fast-path skip before any Firestore point reads when getAllUsersAcrossTenants()
        // already tells us this user has no stored OAuth refreshToken.
        if (u.hasRefreshToken === false || u.refreshToken === null || u.refreshToken === '') {
          skippedUsers++;
          continue;
        }

        // Zero-read Pro check using pre-loaded Pro tenant set + u's individual Pro fields
        // (falls back to planIsPro only when proTenantDomains could not be pre-loaded, e.g. in unit tests).
        let isPro = false;
        if (isSuperAdminUser(u.email) || !isBillingLive) {
          isPro = true;
        } else if (proTenantDomains instanceof Set) {
          const domainLower = String(u.domain || '').toLowerCase();
          const isPersonal = PERSONAL_EMAIL_DOMAINS.has(domainLower);
          if (isPersonal) {
            isPro = (!u.email || !isIndividualBillingLive) ? true : hasActiveIndividualProOnUser(u);
          } else {
            isPro = proTenantDomains.has(domainLower) || (isIndividualBillingLive && hasActiveIndividualProOnUser(u));
          }
        } else if (hasActiveIndividualProOnUser(u)) {
          isPro = true;
        } else {
          isPro = await planIsPro(u.domain, u.email);
        }

        // Auto-capture is a paid feature (pricing sells "Hands-Free Auto-Capture"
        // on paid tiers only). Skipping free users entirely both enforces that —
        // the old `!!settings.autoExportOnEnd` branch let a free user opt into
        // unlimited server-side exports + Pro digests, bypassing the monthly
        // quota — and saves Meet API quota on accounts that can't export anyway.
        if (!isPro) { skippedUsers++; continue; }

        const userDoc = u.refreshToken ? u : await getUser(u.domain, u.email);
        if (!userDoc || !userDoc.refreshToken) { skippedUsers++; continue; }

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
          if (budgetMs - (Date.now() - startedAt) <= 30000) {
            budgetExhausted = true;
            break;
          }
          // Resolve meeting code from space
          let meetingCode = null;
          try {
            if (rec.space && rec.space !== 'spaces/-' && rec.space.startsWith('spaces/') && rec.space.length > 7) {
              const space = await meetGet(rec.space, accessToken);
              meetingCode = space.meetingCode || null;
            }
          } catch (e) { log.warn('auto-capture: space fetch failed', { record: rec.name, error: e.message }); }
          if (!meetingCode) continue;
          const instanceKey = `${meetingCode}__${lastSegment(rec.name)}`;
          if (alreadyExported.has(instanceKey)) continue;

          try {
            if (budgetMs - (Date.now() - startedAt) <= 30000) {
              log.warn('auto-capture: remaining budget under 30s before fetchConferenceParticipants, breaking early', {
                email: u.email,
                record: rec.name,
                elapsedMs: Date.now() - startedAt,
                budgetMs,
              });
              budgetExhausted = true;
              break;
            }
            const participants = await fetchConferenceParticipants(rec.name, accessToken, rec.endTime);
            if (!participants.length) continue;

            // Persist full attendance to Firestore so History & dashboard reflect actual attendance
            await persistAttendance(u.domain, meetingCode, rec.name, participants, u.email);
            detectedMeetings++;

            // For Pro users (or opted-in users): auto-export to Sheets.
            // Atomic per-meeting claim closes the concurrent-fire race
            // (Cloud Scheduler is at-least-once) — getExportedConferenceIds is
            // read-once so two overlapping sweeps could otherwise both export,
            // producing a duplicate Sheet tab AND a duplicate "ready" email.
            const isAlreadyExported = alreadyExported.has(instanceKey);
            if (shouldAutoExport && !isAlreadyExported) {
              const claim = await claimReengagementSlot(u.domain, u.email, `autocap:${instanceKey}`);
              if (!claim.claimed) {
                alreadyExported.add(instanceKey);
                continue;
              }
              if (budgetMs - (Date.now() - startedAt) <= 30000) {
                log.warn('auto-capture: remaining budget under 30s before buildAndSaveExport, breaking early', {
                  email: u.email,
                  record: rec.name,
                  elapsedMs: Date.now() - startedAt,
                  budgetMs,
                });
                budgetExhausted = true;
                break;
              }
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
                    conferenceId: instanceKey,
                    timezone: settings.timezone || userDoc.timezone || userDoc.signupGeo?.timezone || 'America/New_York',
                  },
                  options: { sendEmail: true, autoExport: true, proAllowed: true },
                });
              } catch (exportErr) {
                // Release the claim so the NEXT sweep retries — a transient
                // Sheets 429/5xx used to leave the claim held forever, and the
                // meeting was silently never exported (permanent data loss on
                // the hands-free paid feature).
                try { await claim.ref?.delete(); } catch (delErr) { log.warn('auto-capture: failed to release claim', { email: u.email, conferenceId: instanceKey, error: delErr.message }); }
                throw exportErr;
              }
              alreadyExported.add(instanceKey);
              captured++;
            }
          } catch (e) {
            errored++;
            errors.push({ email: u.email, conferenceId: instanceKey, error: e.message });
            log.warn('auto-capture: process failed', { email: u.email, conferenceId: instanceKey, error: e.message });
          }
        }
        if (budgetExhausted) break;
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
        const tenantPlan = await getTenantPlan(domain);
        if (tenantPlan.plan !== 'pro') { skipped++; continue; }
        if (await isEmailSuppressed(adminEmail)) { skipped++; continue; }
        const slot = await claimReengagementSlot(domain, adminEmail, `orgdigest:${week}`);
        if (!slot.claimed) { skipped++; continue; }
        // From here on, a failure must RELEASE the week slot — the claim is
        // permanent, so leaving it would silently cancel this domain's digest
        // for the week (dispatchEmail returns {sent:false} rather than throw).
        const release = async () => { try { await slot.ref?.delete(); } catch (delErr) { log.warn('admin: failed to release digest slot', { domain, adminEmail, error: delErr.message }); } };
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

const UPCOMING_SERIES_CACHE_MS = 6 * 60 * 60 * 1000; // 6 hours (LAPSE_MS is 6 days)
const _upcomingSeriesCache = new Map(); // emailLower -> { at, series }
let _upcomingSeriesSnapLoadedAt = 0;

router.post('/admin/check-upcoming', requireSuperAdminOrScheduler, async (req, res) => {
  const startedAt = Date.now();
  const budgetMs = sweepBudgetMs();
  const now = Date.now();
  const LAPSE_MS = 6 * 24 * 60 * 60 * 1000;        // only remind about series untracked 6+ days
  const DORMANT_MS = 45 * 24 * 60 * 60 * 1000;     // skip long-dormant accounts
  const WIN_FROM = 25 * 60000, WIN_TO = 40 * 60000; // remind ~30 min out (email-checkable lead)
  const useSeriesCache = process.env.NODE_ENV !== 'test' || req.query?.useCache === '1';
  if (req.query?.refresh === '1') {
    _upcomingSeriesCache.clear();
    _upcomingSeriesSnapLoadedAt = 0;
  }
  let scanned = 0, reminded = 0, skipped = 0, errored = 0;
  const errors = [];
  try {
    const users = rotateForFairness(await getAllUsersAcrossTenants());
    const isSuppressed = await createSuppressedChecker();
    const getDomainMeetings = createDomainMeetingsLoader();

    // Hydrate the 6-hour series cache from Firestore on cold start / new instance (1 doc read).
    if (useSeriesCache && req.query?.refresh !== '1' && ((now - _upcomingSeriesSnapLoadedAt) >= UPCOMING_SERIES_CACHE_MS || _upcomingSeriesCache.size === 0)) {
      try {
        const db = typeof getDb === 'function' ? getDb() : null;
        const snap = await db?.collection?.('ops')?.doc?.('upcomingSeriesCache')?.get?.();
        if (snap && snap.exists) {
          const cached = (typeof snap.data === 'function' ? snap.data() : snap.data) || {};
          const cachedAtMs = tsMs(cached.cachedAtMs) || Number(cached.cachedAtMs) || 0;
          if (cachedAtMs > 0 && (now - cachedAtMs) < UPCOMING_SERIES_CACHE_MS && cached.users && typeof cached.users === 'object') {
            for (const [k, v] of Object.entries(cached.users)) {
              if (v && Array.isArray(v.series) && (now - (Number(v.at) || cachedAtMs)) < UPCOMING_SERIES_CACHE_MS) {
                _upcomingSeriesCache.set(k, { at: Number(v.at) || cachedAtMs, series: v.series });
              }
            }
            _upcomingSeriesSnapLoadedAt = cachedAtMs;
          }
        }
      } catch (_) { /* best-effort snapshot load */ }
    }

    let seriesCacheDirty = false;
    for (const u of users) {
      if (Date.now() - startedAt > budgetMs) { log.warn('check-upcoming: budget exhausted', { scanned }); break; }
      try {
        const lastActive = u.lastLoginAt || u.createdAt;
        if (!lastActive || (now - new Date(lastActive).getTime()) > DORMANT_MS) { skipped++; continue; }
        if (await isSuppressed(u.email)) { skipped++; continue; }

        // Pre-filter on refreshToken BEFORE calling getUserMeetingSeries: a user
        // without a stored OAuth refreshToken cannot have their Google Calendar
        // queried below anyway, so reading their events + meetings docs was pure waste.
        if (u.hasRefreshToken === false || u.refreshToken === null || u.refreshToken === '') {
          skipped++;
          continue;
        }

        // Which recurring series does this user track — and which are LAPSING?
        // Use the 6-hour series cache (since LAPSE_MS is 6 days) and lazy-load domain meetings on cache miss.
        const emailKey = String(u.email || '').toLowerCase();
        let series = null;
        if (useSeriesCache && emailKey) {
          const hit = _upcomingSeriesCache.get(emailKey);
          if (hit && (now - hit.at) < UPCOMING_SERIES_CACHE_MS) {
            series = hit.series;
          }
        }
        if (!Array.isArray(series)) {
          const resSeries = await getUserMeetingSeries(u.domain, u.email, {
            includeParticipants: false,
            domainMeetings: () => getDomainMeetings(u.domain),
          });
          series = (resSeries && Array.isArray(resSeries.series)) ? resSeries.series : [];
          if (useSeriesCache && emailKey) {
            const compactSeries = series
              .filter(s => s && s.recurringEventId)
              .map(s => ({ recurringEventId: s.recurringEventId, title: s.title || null, lastAt: s.lastAt || null }));
            _upcomingSeriesCache.set(emailKey, { at: now, series: compactSeries });
            seriesCacheDirty = true;
          }
        }

        const lapsing = new Map();
        for (const s of (series || [])) {
          if (!s.recurringEventId) continue;
          const lastMs = typeof s.lastAt === 'number' ? s.lastAt : Date.parse(s.lastAt);
          if (lastMs && (now - lastMs) >= LAPSE_MS) lapsing.set(s.recurringEventId, s.title);
        }
        if (!lapsing.size) { skipped++; continue; }

        const userDoc = u.refreshToken ? u : await getUser(u.domain, u.email);
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
            domain: u.domain,
            country: userDoc?.signupGeo?.country || u.signupGeo?.country,
            language: userDoc?.language || u.language,
          });
          if (!result || result.sent !== true) {
            try { await claim.ref.delete(); } catch (delErr) { log.warn('admin: failed to release upcoming claim', { email: u.email, error: delErr.message }); }
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

    if (useSeriesCache && seriesCacheDirty) {
      try {
        const db = typeof getDb === 'function' ? getDb() : null;
        const usersObj = {};
        for (const [k, v] of _upcomingSeriesCache.entries()) {
          if (v && (now - v.at) < UPCOMING_SERIES_CACHE_MS) usersObj[k] = v;
        }
        _upcomingSeriesSnapLoadedAt = now;
        db?.collection?.('ops')?.doc?.('upcomingSeriesCache')?.set?.({
          cachedAtMs: now,
          updatedAt: FieldValue.serverTimestamp(),
          users: usersObj,
        }, { merge: true })?.catch?.(() => {});
      } catch (_) { /* best-effort snapshot save */ }
    }

    log.info('check-upcoming sweep done', { scanned, reminded, skipped, errored });
    res.json({ scanned, reminded, skipped, errored, errors: errors.slice(0, 20), tookMs: Date.now() - startedAt });
  } catch (err) {
    log.error('check-upcoming sweep failed', { error: err.message });
    res.status(500).json({ error: 'check-upcoming sweep failed' });
  }
});

// GET /api/admin/marketplace-reviews — Fetch all reviews, rewards, and matching statuses
router.get('/admin/marketplace-reviews', requireSuperAdmin, async (req, res) => {
  try {
    const db = getDb();
    const reviewsSnap = await db.collection('marketplace_reviews').get();
    const reviews = [];
    reviewsSnap.forEach(d => {
      const data = d.data();
      reviews.push({
        reviewId: d.id,
        ...data,
        firstSeenAt: data.firstSeenAt?.toDate?.() ? data.firstSeenAt.toDate().toISOString() : data.firstSeenAt,
        redeemedAt: data.redeemedAt?.toDate?.() ? data.redeemedAt.toDate().toISOString() : data.redeemedAt,
        lastSyncedAt: data.lastSyncedAt?.toDate?.() ? data.lastSyncedAt.toDate().toISOString() : data.lastSyncedAt,
      });
    });

    reviews.sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));

    // Fetch users with review rewards or who interacted with the review system
    const usersSnap = await db.collectionGroup('users').get();
    const rewardedUsers = [];
    const pendingClickers = [];

    usersSnap.forEach(doc => {
      if (!doc.ref.parent || !doc.ref.parent.parent) return;
      const data = doc.data();
      const domain = doc.ref.parent.parent.id;
      const email = doc.id.toLowerCase();

      if (data.individualPlanType === 'review_reward' || data.reviewStatus === 'verified_reviewed') {
        rewardedUsers.push({
          email,
          domain,
          displayName: data.displayName || '',
          individualPlan: data.individualPlan || 'pro',
          individualBillingStatus: data.individualBillingStatus || 'active',
          individualPlanType: data.individualPlanType || 'review_reward',
          individualPlanGrantedAt: data.individualPlanGrantedAt || null,
          individualPlanExpiresAt: data.individualPlanExpiresAt || null,
          reviewId: data.reviewId || null,
          reviewRating: data.reviewRating || 5,
          reviewStatus: data.reviewStatus || 'verified_reviewed',
          reviewVerifiedAt: data.reviewVerifiedAt || null,
          reviewRewardEmailSent: !!data.reviewRewardEmailSent,
          reviewRewardEmailPendingApproval: !!data.reviewRewardEmailPendingApproval,
          reviewRewardEmailSentAt: data.reviewRewardEmailSentAt || null,
          language: data.language || null,
          country: data.signupGeo?.country || null,
        });
      } else if (data.reviewStatus === 'clicked' || data.reviewLinkClickedAt) {
        pendingClickers.push({
          email,
          domain,
          displayName: data.displayName || '',
          reviewStatus: data.reviewStatus || null,
          reviewLinkClickedAt: data.reviewLinkClickedAt || null,
        });
      }
    });

    const totalReviews = reviews.length;
    const avgRating = totalReviews > 0
      ? Number((reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / totalReviews).toFixed(1))
      : 5.0;
    const redeemedCount = reviews.filter(r => r.redeemed).length;

    res.json({
      reviews,
      rewardedUsers,
      pendingClickers,
      summary: {
        totalReviews,
        avgRating,
        rewardedCount: rewardedUsers.length,
        unredeemedReviews: Math.max(0, totalReviews - redeemedCount),
        pendingClickersCount: pendingClickers.length,
      },
    });
  } catch (err) {
    log.error('admin: failed to get marketplace reviews', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch marketplace reviews' });
  }
});

// POST /api/admin/sync-reviews — On-demand marketplace scraping and pending review reconciliation
router.post('/admin/sync-reviews', requireSuperAdmin, async (req, res) => {
  try {
    const syncRes = await syncMarketplaceReviews();
    const reconcileRes = await reconcilePendingReviews();
    res.json({
      success: true,
      synced: syncRes.total,
      newlyDiscovered: syncRes.newlyDiscovered,
      reconciled: reconcileRes.reconciled || 0,
      candidatesChecked: reconcileRes.candidatesChecked || 0,
    });
  } catch (err) {
    log.error('admin: sync-reviews failed', { error: err.message });
    res.status(500).json({ error: 'Failed to sync marketplace reviews' });
  }
});

// POST /api/admin/reviews/sync — Sweep and reconcile marketplace reviews against pending users (scheduler / legacy)
router.post('/admin/reviews/sync', requireSuperAdminOrScheduler, async (req, res) => {
  try {
    const result = await reconcilePendingReviews();
    res.json({ success: true, ...result });
  } catch (err) {
    log.error('admin: reviews/sync failed', { error: err.message });
    res.status(500).json({ error: 'Failed to sync reviews' });
  }
});

// GET & POST /api/admin/reviews/approve-reward — Tokenized approval to send review reward email (with bot pre-fetch protection)
router.all('/admin/reviews/approve-reward', async (req, res) => {
  const reviewId = req.query.reviewId || req.body?.reviewId;
  const email = req.query.email || req.body?.email;
  const token = req.query.t || req.query.token || req.body?.t || req.body?.token;
  if (!reviewId || !email || !token) {
    return res.status(400).send('<h3>Invalid or missing approval parameters.</h3>');
  }

  if (!verifyReviewApprovalToken(reviewId, email, token)) {
    return res.status(403).send('<h3>Invalid or expired approval token.</h3>');
  }

  try {
    const db = getDb();
    const emailLower = String(email).toLowerCase();
    const domainLower = emailLower.split('@')[1] || 'gmail.com';
    const userRef = db.collection('tenants').doc(domainLower).collection('users').doc(emailLower);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).send(`<h3>User document not found for ${escapeHtml(emailLower)}.</h3>`);
    }

    const userData = userSnap.data();
    if (userData.reviewRewardEmailSent) {
      return res.status(200).send(`
        <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:40px auto;padding:28px;border:1px solid #d0d7de;border-radius:10px;background:#ffffff;">
          <h2 style="color:#0969da;margin-top:0;">ℹ️ Reward Email Already Sent</h2>
          <p style="font-size:15px;color:#24292f;line-height:1.6;">The reward email for <strong>${escapeHtml(emailLower)}</strong> was already sent on ${escapeHtml(userData.reviewRewardEmailSentAt || 'a previous date')}.</p>
          <hr style="border:none;border-top:1px solid #d0d7de;margin:20px 0;">
          <p><a href="https://attendancetracker.dev/admin.html" style="color:#0969da;text-decoration:none;font-weight:600;">← Return to Admin Dashboard</a></p>
        </div>
      `);
    }

    const isAuto = req.query.auto === '1';
    if (req.method === 'GET' && !isAuto) {
      return res.status(200).send(`
        <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:40px auto;padding:28px;border:1px solid #d0d7de;border-radius:10px;background:#ffffff;">
          <h2 style="color:#0969da;margin-top:0;">⭐ Review Reward Approval</h2>
          <p style="font-size:15px;color:#24292f;line-height:1.6;">A verified review reward of 1 Month Pro has been drafted for <strong>${escapeHtml(emailLower)}</strong> (${escapeHtml(userData.displayName || 'Reviewer')}).</p>
          <div style="margin:20px 0;padding:16px;background:#f6f8fa;border-radius:8px;border:1px solid #d0d7de;">
            <p style="margin:0 0 8px 0;font-size:14px;color:#57606a;"><strong>Review ID:</strong> ${escapeHtml(reviewId)}</p>
            <p style="margin:0 0 8px 0;font-size:14px;color:#57606a;"><strong>Rating:</strong> ${'★'.repeat(userData.reviewRating || 5)}</p>
            <p style="margin:0;font-size:14px;color:#57606a;"><strong>Language:</strong> ${escapeHtml(userData.language || 'en')}</p>
          </div>
          <form method="POST" action="/api/admin/reviews/approve-reward" style="margin-top:24px;">
            <input type="hidden" name="reviewId" value="${escapeHtml(reviewId)}">
            <input type="hidden" name="email" value="${escapeHtml(emailLower)}">
            <input type="hidden" name="t" value="${escapeHtml(token)}">
            <button type="submit" style="background:#2da44e;color:#ffffff;font-size:15px;font-weight:600;padding:10px 20px;border:none;border-radius:6px;cursor:pointer;">
              Confirm &amp; Send Reward Email
            </button>
          </form>
          <hr style="border:none;border-top:1px solid #d0d7de;margin:24px 0 16px;">
          <p><a href="https://attendancetracker.dev/admin.html" style="color:#0969da;text-decoration:none;font-weight:600;font-size:14px;">← Return to Admin Dashboard</a></p>
        </div>
      `);
    }

    const sendResult = await sendReviewRewardEmail({
      to: emailLower,
      displayName: userData.displayName,
      domain: domainLower,
      country: userData.signupGeo?.country,
      language: userData.language,
      expiresAt: userData.individualPlanExpiresAt,
      reviewId,
      rating: userData.reviewRating || 5,
    });

    if (!sendResult.sent) {
      return res.status(500).send(`<h3>Failed to dispatch email: ${escapeHtml(sendResult.reason || 'Unknown error')}</h3>`);
    }

    await userRef.set({
      reviewRewardEmailSent: true,
      reviewRewardEmailPendingApproval: false,
      reviewRewardEmailSentAt: new Date().toISOString(),
    }, { merge: true });

    return res.status(200).send(`
      <div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:40px auto;padding:28px;border:1px solid #2da44e;border-radius:10px;background:#f6f8fa;">
        <h2 style="color:#1a7f37;margin-top:0;">✅ Review Reward Email Dispatched!</h2>
        <p style="font-size:15px;color:#24292f;line-height:1.6;">Successfully dispatched personalized reward email to <strong>${escapeHtml(emailLower)}</strong>.</p>
        <ul style="font-size:14px;color:#57606a;line-height:1.8;">
          <li><strong>Sender:</strong> Derek Gallardo &lt;derek@attendancetracker.dev&gt;</li>
          <li><strong>Language:</strong> ${escapeHtml(sendResult.lang || 'en')}</li>
          <li><strong>Resend ID:</strong> ${escapeHtml(sendResult.id || 'ok')}</li>
        </ul>
        <hr style="border:none;border-top:1px solid #d0d7de;margin:20px 0;">
        <p><a href="https://attendancetracker.dev/admin.html" style="color:#0969da;text-decoration:none;font-weight:600;">← Return to Admin Dashboard</a></p>
      </div>
    `);
  } catch (err) {
    log.error('admin: failed to approve review reward email', { error: err.message, reviewId, email });
    return res.status(500).send(`<h3>Error approving reward email: ${escapeHtml(err.message)}</h3>`);
  }
});

// POST /api/admin/reviews/send-reward-email — Dispatch or re-send review reward email (Super Admin)
router.post('/admin/reviews/send-reward-email', requireSuperAdmin, async (req, res) => {
  const { email, customSubject, customText, customHtml } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email is required' });
  }

  try {
    const db = getDb();
    const emailLower = String(email).toLowerCase();
    const domainLower = emailLower.split('@')[1] || 'gmail.com';
    const userRef = db.collection('tenants').doc(domainLower).collection('users').doc(emailLower);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userData = userSnap.data();
    const sendResult = await sendReviewRewardEmail({
      to: emailLower,
      displayName: userData.displayName,
      domain: domainLower,
      country: userData.signupGeo?.country,
      language: userData.language,
      expiresAt: userData.individualPlanExpiresAt,
      reviewId: userData.reviewId,
      rating: userData.reviewRating || 5,
      customSubject,
      customText,
      customHtml,
    });

    if (!sendResult.sent) {
      return res.status(500).json({ error: 'Failed to send email', reason: sendResult.reason });
    }

    await userRef.set({
      reviewRewardEmailSent: true,
      reviewRewardEmailPendingApproval: false,
      reviewRewardEmailSentAt: new Date().toISOString(),
    }, { merge: true });

    res.json({ success: true, ...sendResult });
  } catch (err) {
    log.error('admin: send-reward-email failed', { error: err.message, email });
    res.status(500).json({ error: 'Failed to send reward email' });
  }
});

let _schoolClustersCache = null;
let _schoolClustersCachedAt = 0;
let _schoolClustersInFlight = null;
const SCHOOL_CLUSTERS_CACHE_MS = 15 * 60 * 1000; // 15 minutes
const CLUSTER_SIGNAL_EVENT_TYPES = [
  'large_class_banner_clicked',
  'paywall_objection',
  'school_quote_generated',
  'school_license_requested',
];

// GET /api/admin/school-clusters — Groups multi-teacher institutional clusters for B2B department outreach
router.get('/admin/school-clusters', requireSuperAdmin, async (req, res) => {
  try {
    const force = req.query.refresh === '1' || req.query.force === '1';
    const allowCache = process.env.NODE_ENV !== 'test' || req.query.useCache === '1';
    if (!force && allowCache && _schoolClustersCache && (Date.now() - _schoolClustersCachedAt) < SCHOOL_CLUSTERS_CACHE_MS) {
      return res.json(_schoolClustersCache);
    }
    if (!force && allowCache && _schoolClustersInFlight) {
      const payload = await _schoolClustersInFlight;
      return res.json(payload);
    }

    const run = (async () => {
      try {
        const PUBLIC_DOMAINS = new Set([
          'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.co.in',
          'hotmail.com', 'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com',
          'aol.com', 'mail.ru', 'protonmail.com', 'proton.me', 'zoho.com', 'yandex.ru'
        ]);

        const usersSnap = await getDb().collectionGroup('users').get();
        const domainMap = new Map();

        usersSnap.forEach(doc => {
          const u = doc.data();
          if (!u.email) return;
          const domain = (u.domain || u.email.split('@')[1] || '').toLowerCase().trim();
          if (!domain || PUBLIC_DOMAINS.has(domain)) return;

          if (!domainMap.has(domain)) {
            domainMap.set(domain, []);
          }
          const createdAt = u.createdAt?.toDate ? u.createdAt.toDate().toISOString() : (u.createdAt || null);
          const country = u.signupGeo?.country || u.signupCountry || null;
          domainMap.get(domain).push({
            email: u.email,
            displayName: u.displayName || '',
            createdAt,
            country,
            plan: u.individualPlanType || u.plan || 'free',
            lastLoginAt: u.lastLoginAt ? (u.lastLoginAt.toDate ? u.lastLoginAt.toDate().toISOString() : u.lastLoginAt) : null,
          });
        });

        const clusterEntries = Array.from(domainMap.entries())
          .filter(([, teachers]) => teachers.length >= 2)
          .sort((a, b) => b[1].length - a[1].length);

        const clusters = await Promise.all(clusterEntries.map(async ([domain, teachers]) => {
          let totalExports = 0;
          let totalParticipants = 0;
          let largeClassHits = 0;
          let objections = 0;
          let tenantData = {};

          try {
            const tenantDocRef = getDb().collection('tenants').doc(domain);
            const [tenantDoc, exportsSnap] = await Promise.all([
              tenantDocRef.get(),
              tenantDocRef.collection('exports').get(),
            ]);
            if (tenantDoc && tenantDoc.exists) {
              tenantData = tenantDoc.data() || {};
            }
            if (exportsSnap && exportsSnap.size) {
              totalExports = exportsSnap.size;
              exportsSnap.forEach(expDoc => {
                const exp = expDoc.data();
                const pCount = Number(exp.participantCount) || 0;
                totalParticipants += pCount;
                if (pCount > 12) largeClassHits++;
              });
            }
            try {
              const eventsCol = tenantDocRef.collection('events');
              if (eventsCol && typeof eventsCol.get === 'function') {
                let evQuery = eventsCol;
                if (typeof evQuery.where === 'function') {
                  evQuery = evQuery.where('type', 'in', CLUSTER_SIGNAL_EVENT_TYPES) || evQuery;
                }
                if (typeof evQuery.select === 'function') {
                  evQuery = evQuery.select('type', 'email', 'actor') || evQuery;
                }
                const evSnap = await evQuery.get();
                if (evSnap && typeof evSnap.forEach === 'function') {
                  evSnap.forEach(evDoc => {
                    const ev = evDoc.data() || {};
                    if (ev.type === 'large_class_banner_clicked') largeClassHits++;
                    if (ev.type === 'paywall_objection' || ev.type === 'school_quote_generated' || ev.type === 'school_license_requested') objections++;
                  });
                }
              }
            } catch (_) {}
          } catch (err) {
            log.warn('admin: failed fetching tenant details for cluster', { domain, error: err.message });
          }

          const country = teachers.find(t => t.country)?.country || 'Unknown';
          const primaryContact = tenantData.adminEmail || teachers[0]?.email;
          const teacherCount = teachers.length;
          const outreachScore = teacherCount * (1 + largeClassHits) * (1 + objections);
          const recommendedPlan = teacherCount >= 10 ? 'institution' : 'department';
          const priceLabel = recommendedPlan === 'institution' ? '$149/year (unlimited educators)' : '$59/year (up to 10 educators)';

          return {
            domain,
            teacherCount,
            teachers,
            totalExports,
            totalParticipants,
            largeClassHits,
            objections,
            outreachScore,
            recommendedPlan,
            country,
            primaryContact,
            planStatus: tenantData.plan || (teachers.some(t => t.plan === 'pro') ? 'pro' : 'free'),
            installedAt: tenantData.installedAt?.toDate ? tenantData.installedAt.toDate().toISOString() : (tenantData.installedAt || teachers[teachers.length - 1]?.createdAt),
            draftedEmail: {
              to: primaryContact,
              subject: `${teacherCount} educators at ${domain} are using Google Meet Attendance Tracker`,
              body: `Hi ${teachers[0]?.displayName ? teachers[0].displayName.split(' ')[0] : 'there'},\n\nI noticed ${teacherCount} educators at ${domain} are using Google Meet Attendance Tracker. Rather than having each teacher pay individually ($19/yr), we can cover your whole ${recommendedPlan === 'institution' ? 'school' : 'department'} for ${priceLabel}.\n\nWould you like me to send over a 1-page PDF quote for your department chair or business office?\n\nBest,\nDerek`,
            },
          };
        }));

        const topOutreachClusters = clusters
          .filter(c => c.planStatus !== 'pro')
          .slice()
          .sort((a, b) => b.outreachScore - a.outreachScore || b.teacherCount - a.teacherCount)
          .slice(0, 10);

        const payload = {
          success: true,
          totalClusters: clusters.length,
          totalClusterTeachers: clusters.reduce((sum, c) => sum + c.teacherCount, 0),
          clusters,
          topOutreachClusters,
        };
        _schoolClustersCache = payload;
        _schoolClustersCachedAt = Date.now();
        return payload;
      } finally {
        _schoolClustersInFlight = null;
      }
    })();

    if (!force && allowCache) _schoolClustersInFlight = run;
    const payload = await run;
    res.json(payload);
  } catch (err) {
    log.error('admin: failed to get school clusters', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch school clusters' });
  }
});

module.exports = router;

