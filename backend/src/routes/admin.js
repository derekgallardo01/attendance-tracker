const { Router } = require('express');
const log = require('../lib/logger');
const { upsertTenantConfig, getTenantConfig, getDb, getAllUsersAcrossTenants, getAggregatedInsights, setUserAcquisitionSource, getOutreachList, getRecentActivity, getReachOutSuggestions, getPowerUserPipeline, markUserContacted, getUserDetail, setAdminNote, searchAdminNotes, appendConversation, setOutreachStatus, createReminder, markReminderDone, getDueReminders, getEmailTemplates, setEmailTemplates, getAdvancedAnalytics, getWeeklySelfReport } = require('../services/firestore');
const { sendAdminEmail, sendWeeklySelfReport } = require('../lib/notifications');

const SUPER_ADMIN_EMAIL = 'derekgallardo01@gmail.com';
const MARKETPLACE_REVIEW_URL = 'https://workspace.google.com/marketplace/app/attendance_tracker/829771833968';

const ACQUISITION_SOURCES = new Set([
  'google_search', 'marketplace', 'reddit', 'youtube', 'friend', 'other',
]);

// Quote a CSV field per RFC 4180: wrap in double quotes and double any
// embedded double quotes. Only quote when needed (contains , " or newline).
function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const router = Router();

// POST /api/admin/install — Marketplace install webhook
// Called by Google when a Workspace admin installs the app
router.post('/admin/install', async (req, res) => {
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
router.post('/admin/uninstall', async (req, res) => {
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

// GET /api/admin/stats — Basic usage stats (protected by admin check)
router.get('/admin/stats', async (req, res) => {
  try {
    // Only allow authenticated users with a known domain
    if (!req.user?.email) return res.status(401).json({ error: 'Authentication required' });

    const { Firestore } = require('@google-cloud/firestore');
    const db = new Firestore();

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
      const dom = d.ref.parent.parent.id;
      if (!tenantMap.has(dom)) {
        tenantMap.set(dom, { domain: dom, active: true, installedAt: null });
      }
    }
    const tenants = [...tenantMap.values()];

    // Count users for the requesting user's domain
    const domain = req.user.domain;
    const usersSnap = await db.collection('tenants').doc(domain).collection('users').get();
    const meetingsSnap = await db.collection('tenants').doc(domain).collection('meetings').get();
    const exportsSnap = await db.collection('tenants').doc(domain).collection('exports').get();

    // Get recent users with last login
    const recentUsers = usersSnap.docs
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
      }));

    res.json({
      totalTenants: tenants.length,
      tenants: tenants.map(t => ({
        domain: t.domain,
        active: t.active !== false,
        installedAt: t.installedAt?.toDate?.()?.toISOString?.() || t.installedAt || null,
      })),
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
router.get('/admin/all-users', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Forbidden' });
    }
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
router.get('/admin/activity', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const events = await getRecentActivity({ limit });
    res.json({ events });
  } catch (err) {
    log.error('admin: activity failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch activity' });
  }
});

// GET /api/admin/suggestions — "reach out NOW" cards
router.get('/admin/suggestions', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    const suggestions = await getReachOutSuggestions();
    res.json({ suggestions });
  } catch (err) {
    log.error('admin: suggestions failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch suggestions' });
  }
});

// GET /api/admin/power-users — power users who haven't been contacted yet
router.get('/admin/power-users', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 7));
    const minTracked = Math.max(1, Math.min(50, Number(req.query.minTracked) || 5));
    const users = await getPowerUserPipeline({ days, minTracked });
    res.json({ users, days, minTracked });
  } catch (err) {
    log.error('admin: power-users failed', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch power users' });
  }
});

// POST /api/admin/contacted — mark a user as reached out to
router.post('/admin/contacted', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
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
router.get('/admin/weekly-report', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    const report = await getWeeklySelfReport();
    res.json(report || { error: 'failed' });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/admin/weekly-report', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    const report = await getWeeklySelfReport();
    if (!report) return res.status(500).json({ error: 'Could not generate report' });
    const result = await sendWeeklySelfReport(report);
    res.json(result);
  } catch (err) {
    log.error('admin: weekly-report send failed', { error: err.message });
    res.status(500).json({ error: err.message || 'Failed' });
  }
});

// GET /api/admin/analytics — segments, funnels, time patterns, drop-off
router.get('/admin/analytics', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    const data = await getAdvancedAnalytics();
    if (!data) return res.status(500).json({ error: 'Failed' });
    res.json(data);
  } catch (err) {
    log.error('admin: analytics failed', { error: err.message });
    res.status(500).json({ error: 'Failed' });
  }
});

// ── User detail (drill-down modal) ──
router.get('/admin/user', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
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

router.put('/admin/note', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    const { email, domain, body } = req.body || {};
    if (!email || !domain) return res.status(400).json({ error: 'email and domain required' });
    const result = await setAdminNote(domain, email, body || '', req.user.email);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to save note' });
  }
});

router.get('/admin/notes/search', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    const results = await searchAdminNotes(req.query.q || '');
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// ── Email-from-dashboard + templates + outreach log ──
router.post('/admin/send-email', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    const { to, domain, subject, body } = req.body || {};
    if (!to || !domain || !subject || !body) return res.status(400).json({ error: 'to, domain, subject, body required' });
    const result = await sendAdminEmail({ to, subject, body });
    // Log the conversation entry + mark contacted in one shot.
    await appendConversation(domain, to, { direction: 'sent', subject, body, replyStatus: 'awaiting' });
    res.json(result);
  } catch (err) {
    log.error('admin: send-email failed', { error: err.message });
    res.status(500).json({ error: err.message || 'Failed to send' });
  }
});

router.put('/admin/outreach/status', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    const { email, domain, status } = req.body || {};
    if (!email || !domain || !status) return res.status(400).json({ error: 'email, domain, status required' });
    await setOutreachStatus(domain, email, status);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.post('/admin/outreach/log-reply', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    const { email, domain, body, status } = req.body || {};
    if (!email || !domain) return res.status(400).json({ error: 'email, domain required' });
    await appendConversation(domain, email, { direction: 'received', subject: '', body: body || '', replyStatus: status || 'replied' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/admin/templates', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    const items = await getEmailTemplates();
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.put('/admin/templates', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    await setEmailTemplates(req.body?.items || []);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// ── Reminders ──
router.post('/admin/reminders', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    const { email, domain, remindAt, body } = req.body || {};
    if (!email || !domain || !remindAt) return res.status(400).json({ error: 'email, domain, remindAt required' });
    const r = await createReminder(domain, email, { remindAt, body, createdBy: req.user.email });
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.put('/admin/reminders/:id/done', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    const { domain } = req.body || {};
    if (!domain) return res.status(400).json({ error: 'domain required' });
    await markReminderDone(domain, req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/admin/reminders/due', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) return res.status(403).json({ error: 'Forbidden' });
    const reminders = await getDueReminders();
    res.json({ reminders });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/admin/insights', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const insights = await getAggregatedInsights();
    res.json(insights);
  } catch (err) {
    log.error('admin: insights failed', { error: err.message });
    res.status(500).json({ error: 'Failed to compute insights' });
  }
});

// GET /api/admin/outreach-list — Mail-merge-ready CSV of active users (super admin only)
// Query params: ?days=30 (window), ?limit=50 (max rows), ?format=csv|json (default csv)
router.get('/admin/outreach-list', async (req, res) => {
  try {
    if (req.user?.email !== SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ error: 'Forbidden' });
    }
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
router.post('/admin/source', async (req, res) => {
  try {
    if (!req.user?.email) return res.status(401).json({ error: 'Authentication required' });
    const { source, detail } = req.body || {};
    if (!ACQUISITION_SOURCES.has(source)) {
      return res.status(400).json({ error: 'Invalid source' });
    }
    const cleanDetail = typeof detail === 'string' ? detail.slice(0, 200) : null;
    await setUserAcquisitionSource(req.user.domain, req.user.email, { source, detail: cleanDetail });
    res.json({ success: true });
  } catch (err) {
    log.error('admin: source failed', { error: err.message });
    res.status(500).json({ error: 'Failed to save source' });
  }
});

// POST /api/admin/verify-delegation — Test if domain-wide delegation works
router.post('/admin/verify-delegation', async (req, res) => {
  try {
    const { domain, adminEmail } = req.body;
    if (!domain || !adminEmail) {
      return res.status(400).json({ error: 'domain and adminEmail required' });
    }

    // Try to get a Meet API token by impersonating the admin
    const { getMeetToken } = require('../services/googleAuth');
    await getMeetToken(adminEmail);

    // If we get here, delegation works — store the config
    await upsertTenantConfig(domain, {
      adminEmail,
      impersonateEmail: adminEmail,
      delegationVerified: true,
      active: true,
    });

    log.info('admin: delegation verified', { domain, adminEmail });
    res.json({ success: true });
  } catch (err) {
    log.warn('admin: delegation verification failed', { error: err.message });
    res.json({ success: false, error: 'Domain-wide delegation is not configured correctly. Please check the setup steps and try again.' });
  }
});

module.exports = router;
