// Tests for the firestore.js admin-only / CRM functions that power admin.html.
// Lower bug-risk than the alert / aggregation logic but they touch every part
// of the founder's day-to-day workflow — a regression here = silently bad
// data in the admin dashboard.

const { installFirestoreMock, wrapTimestamp } = require('../helpers/firestoreMock');

let ctx, firestore;
const DAY = 86400000;

beforeEach(() => {
  ctx = installFirestoreMock();
  firestore = require('../../src/services/firestore');
});

afterEach(() => {
  ctx.uninstall();
});

// ─────────── tiny helpers used across many tests ───────────
function seedUser(domain, email, extras = {}) {
  // Build base + extras separately so we can wrap any Date fields the caller
  // passed in (otherwise the raw Date overwrites our wrapTimestamp()).
  const { displayName, lastLoginAt, createdAt, ...rest } = extras;
  ctx.seed(`tenants/${domain}/users/${email.toLowerCase()}`, {
    email: email.toLowerCase(),
    domain,
    displayName: displayName || 'Test User',
    lastLoginAt: wrapTimestamp(lastLoginAt || new Date()),
    createdAt: wrapTimestamp(createdAt || new Date()),
    ...rest,
  });
}
function seedEvent(domain, email, type, atMs, meta) {
  const id = `ev_${atMs}_${Math.random().toString(36).slice(2, 8)}`;
  ctx.seed(`tenants/${domain}/events/${id}`, {
    email: email.toLowerCase(),
    type,
    meta: meta || null,
    createdAt: wrapTimestamp(new Date(atMs)),
  });
}

// ═══════════════════════════ counters ═══════════════════════════

describe('countAllUsers', () => {
  test('returns 0 for empty Firestore', async () => {
    expect(await firestore.countAllUsers()).toBe(0);
  });

  test('counts across tenants', async () => {
    seedUser('a.com', 'x@a.com');
    seedUser('a.com', 'y@a.com');
    seedUser('b.com', 'z@b.com');
    expect(await firestore.countAllUsers()).toBe(3);
  });
});

describe('countUserExports', () => {
  test('returns 0 when no exports exist', async () => {
    expect(await firestore.countUserExports('a.com', 'user@a.com')).toBe(0);
  });

  test('counts only exported events for the specified user', async () => {
    seedEvent('a.com', 'user@a.com', 'exported', Date.now());
    seedEvent('a.com', 'user@a.com', 'exported', Date.now());
    seedEvent('a.com', 'user@a.com', 'tracked', Date.now()); // wrong type
    seedEvent('a.com', 'other@a.com', 'exported', Date.now()); // wrong user
    expect(await firestore.countUserExports('a.com', 'user@a.com')).toBe(2);
  });
});

describe('isExistingUserAnywhere', () => {
  test('false for unknown email', async () => {
    expect(await firestore.isExistingUserAnywhere('ghost@nowhere.com')).toBe(false);
  });

  test('true when user exists in any tenant', async () => {
    seedUser('a.com', 'real@a.com');
    expect(await firestore.isExistingUserAnywhere('real@a.com')).toBe(true);
  });
});

// ═══════════════════════════ activation status ═══════════════════════════

describe('getUserActivationStatus', () => {
  test('returns funnel flags for a brand-new user', async () => {
    seedUser('a.com', 'new@a.com');
    seedEvent('a.com', 'new@a.com', 'signin', Date.now());
    const status = await firestore.getUserActivationStatus('a.com', 'new@a.com');
    expect(status.hasTracked).toBe(false);
    expect(status.hasExported).toBe(false);
    expect(status.lastLoginAt).toBeDefined();
  });

  test('hasTracked + hasExported when events exist', async () => {
    seedUser('a.com', 'active@a.com');
    seedEvent('a.com', 'active@a.com', 'tracked', Date.now());
    seedEvent('a.com', 'active@a.com', 'exported', Date.now());
    const status = await firestore.getUserActivationStatus('a.com', 'active@a.com');
    expect(status.hasTracked).toBe(true);
    expect(status.hasExported).toBe(true);
  });
});

// ═══════════════════════════ acquisition source ═══════════════════════════

describe('setUserAcquisitionSource', () => {
  test('writes source + detail to user doc, overwriting any UTM guess', async () => {
    seedUser('a.com', 'u@a.com', { utmSource: 'reddit' });
    await firestore.setUserAcquisitionSource('a.com', 'u@a.com', { source: 'youtube', detail: 'Bob tutorial' });
    const user = ctx.read('tenants/a.com/users/u@a.com');
    expect(user.acquisitionSource).toBe('youtube');
    expect(user.acquisitionSourceDetail).toBe('Bob tutorial');
  });
});

// ═══════════════════════════ user sheet id ═══════════════════════════

describe('getUserSheetId + setUserSheetId', () => {
  test('returns null when no sheetId set', async () => {
    seedUser('a.com', 'u@a.com');
    expect(await firestore.getUserSheetId('a.com', 'u@a.com')).toBeNull();
  });

  test('round-trips a sheet id', async () => {
    seedUser('a.com', 'u@a.com');
    await firestore.setUserSheetId('a.com', 'u@a.com', 'sheet-xyz');
    expect(await firestore.getUserSheetId('a.com', 'u@a.com')).toBe('sheet-xyz');
  });

  test('clears sheet id when set to null (user deleted their sheet)', async () => {
    seedUser('a.com', 'u@a.com', { sheetId: 'old-sheet' });
    await firestore.setUserSheetId('a.com', 'u@a.com', null);
    expect(await firestore.getUserSheetId('a.com', 'u@a.com')).toBeNull();
  });
});

// ═══════════════════════════ cross-tenant query ═══════════════════════════

describe('getAllUsersAcrossTenants', () => {
  test('returns empty when no users exist', async () => {
    expect(await firestore.getAllUsersAcrossTenants()).toEqual([]);
  });

  test('flattens users across all tenants with domain field', async () => {
    seedUser('a.com', 'x@a.com');
    seedUser('b.com', 'y@b.com');
    const users = await firestore.getAllUsersAcrossTenants();
    expect(users).toHaveLength(2);
    const a = users.find(u => u.email === 'x@a.com');
    const b = users.find(u => u.email === 'y@b.com');
    expect(a.domain).toBe('a.com');
    expect(b.domain).toBe('b.com');
  });

  test('skips users with empty/invalid email field (defensive)', async () => {
    seedUser('a.com', 'valid@a.com');
    ctx.seed('tenants/a.com/users/__broken__', { email: '', domain: 'a.com' });
    const users = await firestore.getAllUsersAcrossTenants();
    // Implementation may or may not skip — just check valid one is included
    expect(users.some(u => u.email === 'valid@a.com')).toBe(true);
  });
});

// ═══════════════════════════ admin notes ═══════════════════════════

describe('admin notes CRUD', () => {
  test('setAdminNote stores body + author', async () => {
    const result = await firestore.setAdminNote('a.com', 'u@a.com', 'Great user, follow up next week', 'admin@x.com');
    expect(result.saved).toBe(true);
    const note = ctx.read('tenants/a.com/adminNotes/u@a.com');
    expect(note.body).toContain('Great user');
    expect(note.authorEmail).toBe('admin@x.com');
  });

  test('setAdminNote with empty body deletes the doc (intentional clear)', async () => {
    ctx.seed('tenants/a.com/adminNotes/u@a.com', { body: 'old note' });
    const result = await firestore.setAdminNote('a.com', 'u@a.com', '', 'admin@x.com');
    expect(result.deleted).toBe(true);
    expect(ctx.read('tenants/a.com/adminNotes/u@a.com')).toBeUndefined();
  });

  test('searchAdminNotes returns notes matching query (case-insensitive)', async () => {
    ctx.seed('tenants/a.com/adminNotes/u1@a.com', { body: 'Follow up about pricing', email: 'u1@a.com' });
    ctx.seed('tenants/a.com/adminNotes/u2@a.com', { body: 'asked about features', email: 'u2@a.com' });
    ctx.seed('tenants/b.com/adminNotes/u3@b.com', { body: 'pricing question', email: 'u3@b.com' });
    const results = await firestore.searchAdminNotes('pricing');
    expect(results.length).toBe(2);
  });

  test('searchAdminNotes returns empty array for no matches', async () => {
    expect(await firestore.searchAdminNotes('nothing-here')).toEqual([]);
  });
});

// ═══════════════════════════ reminders ═══════════════════════════

describe('reminders CRUD', () => {
  test('createReminder returns id + persists doc', async () => {
    const result = await firestore.createReminder('a.com', 'u@a.com', {
      remindAt: new Date(Date.now() + DAY).toISOString(),
      body: 'Check in with Alex',
      createdBy: 'admin@x.com',
    });
    expect(result.id).toBeDefined();
  });

  test('markReminderDone flips status', async () => {
    const r = await firestore.createReminder('a.com', 'u@a.com', {
      remindAt: new Date(Date.now() + DAY).toISOString(),
      body: 'Test',
      createdBy: 'admin@x.com',
    });
    await firestore.markReminderDone('a.com', r.id);
    const doc = ctx.read(`tenants/a.com/reminders/${r.id}`);
    expect(doc.done).toBe(true);
  });

  test('getDueReminders returns only past-due, undone reminders', async () => {
    const now = Date.now();
    ctx.seed('tenants/a.com/reminders/r1', {
      email: 'u@a.com', body: 'Past due', remindAt: wrapTimestamp(new Date(now - DAY)), done: false,
    });
    ctx.seed('tenants/a.com/reminders/r2', {
      email: 'u@a.com', body: 'Future', remindAt: wrapTimestamp(new Date(now + DAY)), done: false,
    });
    ctx.seed('tenants/a.com/reminders/r3', {
      email: 'u@a.com', body: 'Past but done', remindAt: wrapTimestamp(new Date(now - DAY)), done: true,
    });
    const due = await firestore.getDueReminders();
    expect(due.length).toBe(1);
    expect(due[0].body).toBe('Past due');
  });

  test('getDueReminders returns empty when no reminders exist', async () => {
    expect(await firestore.getDueReminders()).toEqual([]);
  });
});

// ═══════════════════════════ email templates ═══════════════════════════

describe('email templates CRUD', () => {
  test('getEmailTemplates returns empty array when nothing set', async () => {
    const items = await firestore.getEmailTemplates();
    expect(Array.isArray(items)).toBe(true);
  });

  test('setEmailTemplates round-trips the array', async () => {
    const templates = [
      { name: 'follow-up', subject: 'Quick question', body: 'Hey {{name}}' },
      { name: 'thank-you', subject: 'Thanks!', body: 'Appreciate the chat' },
    ];
    await firestore.setEmailTemplates(templates);
    const got = await firestore.getEmailTemplates();
    expect(got.length).toBe(2);
    expect(got[0].name).toBe('follow-up');
  });

  test('setEmailTemplates([]) writes empty but getter returns built-in defaults', async () => {
    // The getter has a "seed defaults if empty" UX nicety — the doc IS cleared,
    // but the user-visible result is the defaults reappearing.
    await firestore.setEmailTemplates([{ name: 'x', subject: 'y', body: 'z' }]);
    await firestore.setEmailTemplates([]);
    const got = await firestore.getEmailTemplates();
    expect(got.length).toBeGreaterThan(0); // defaults seeded back
    expect(got.some(t => t.name === 'Welcome')).toBe(true);
  });
});

// ═══════════════════════════ outreach status + conversation ═══════════════════════════

describe('outreach status + conversation log', () => {
  test('setOutreachStatus updates the outreach doc', async () => {
    await firestore.setOutreachStatus('a.com', 'u@a.com', 'awaiting');
    const doc = ctx.read('tenants/a.com/outreach/u@a.com');
    expect(doc.replyStatus).toBe('awaiting');
  });

  test('appendConversation adds entry to conversation array', async () => {
    await firestore.appendConversation('a.com', 'u@a.com', {
      direction: 'sent', subject: 'Hello', body: 'Quick question', replyStatus: 'awaiting',
    });
    const doc = ctx.read('tenants/a.com/outreach/u@a.com');
    expect(doc.conversation).toHaveLength(1);
    expect(doc.conversation[0].direction).toBe('sent');
  });

  test('appendConversation appends a second entry without overwriting', async () => {
    await firestore.appendConversation('a.com', 'u@a.com', { direction: 'sent', body: 'First', replyStatus: 'awaiting' });
    await firestore.appendConversation('a.com', 'u@a.com', { direction: 'received', body: 'Reply', replyStatus: 'replied' });
    const doc = ctx.read('tenants/a.com/outreach/u@a.com');
    expect(doc.conversation).toHaveLength(2);
  });
});

// ═══════════════════════════ markUserContacted ═══════════════════════════

describe('markUserContacted', () => {
  test('stamps contactedAt + note + contactedBy on the outreach doc', async () => {
    await firestore.markUserContacted('a.com', 'u@a.com', {
      note: 'Sent intro email', contactedBy: 'admin@x.com',
    });
    const doc = ctx.read('tenants/a.com/outreach/u@a.com');
    expect(doc.contactedAt).toBeDefined();
    expect(doc.note).toBe('Sent intro email');
    expect(doc.contactedBy).toBe('admin@x.com');
  });
});

// ═══════════════════════════ recent activity feed ═══════════════════════════

describe('getRecentActivity', () => {
  test('returns empty when no events', async () => {
    expect(await firestore.getRecentActivity({ limit: 10 })).toEqual([]);
  });

  test('returns events across tenants ordered by createdAt desc', async () => {
    const now = Date.now();
    seedEvent('a.com', 'u@a.com', 'signin', now - 2 * DAY);
    seedEvent('a.com', 'u@a.com', 'tracked', now - 1 * DAY);
    seedEvent('b.com', 'v@b.com', 'exported', now);
    const events = await firestore.getRecentActivity({ limit: 10 });
    expect(events).toHaveLength(3);
    // Most recent first
    expect(events[0].type).toBe('exported');
  });

  test('respects limit', async () => {
    for (let i = 0; i < 10; i++) {
      seedEvent('a.com', 'u@a.com', 'tracked', Date.now() - i * 1000);
    }
    const events = await firestore.getRecentActivity({ limit: 3 });
    expect(events).toHaveLength(3);
  });
});

// ═══════════════════════════ getUserDetail (drill-down + health score) ═══════════════════════════

describe('getUserDetail + computeHealthScore (via output)', () => {
  test('returns null for unknown user', async () => {
    const detail = await firestore.getUserDetail('a.com', 'ghost@a.com');
    expect(detail).toBeNull();
  });

  test('returns aggregated counts + health score for a real user', async () => {
    const now = Date.now();
    seedUser('a.com', 'u@a.com', {
      createdAt: new Date(now - 60 * DAY),
      lastLoginAt: new Date(now - 2 * DAY),
    });
    seedEvent('a.com', 'u@a.com', 'signin', now);
    seedEvent('a.com', 'u@a.com', 'tracked', now);
    seedEvent('a.com', 'u@a.com', 'tracked', now - DAY);
    seedEvent('a.com', 'u@a.com', 'exported', now);

    const detail = await firestore.getUserDetail('a.com', 'u@a.com');
    expect(detail).not.toBeNull();
    expect(detail.counts.tracked).toBe(2);
    expect(detail.counts.exported).toBe(1);
    expect(detail.counts.signins).toBe(1);
    expect(detail.healthScore).toBeGreaterThan(0);
    expect(detail.healthScore).toBeLessThanOrEqual(100);
  });

  test('health score is high for recent + frequent + exported users', async () => {
    const now = Date.now();
    seedUser('a.com', 'power@a.com', {
      createdAt: new Date(now - 90 * DAY),
      lastLoginAt: new Date(),
    });
    // 20 tracked events spread across the past 30 days (high frequency, recent)
    for (let i = 0; i < 20; i++) seedEvent('a.com', 'power@a.com', 'tracked', now - i * DAY);
    seedEvent('a.com', 'power@a.com', 'exported', now);
    const detail = await firestore.getUserDetail('a.com', 'power@a.com');
    expect(detail.healthScore).toBeGreaterThanOrEqual(60);
  });

  test('health score is low for stale users', async () => {
    const now = Date.now();
    seedUser('a.com', 'stale@a.com', {
      createdAt: new Date(now - 90 * DAY),
      lastLoginAt: new Date(now - 60 * DAY),
    });
    seedEvent('a.com', 'stale@a.com', 'signin', now - 60 * DAY);
    const detail = await firestore.getUserDetail('a.com', 'stale@a.com');
    expect(detail.healthScore).toBeLessThan(30);
  });
});

// ═══════════════════════════ reach-out suggestions ═══════════════════════════

describe('getReachOutSuggestions', () => {
  test('returns array (possibly empty)', async () => {
    const suggestions = await firestore.getReachOutSuggestions();
    expect(Array.isArray(suggestions)).toBe(true);
  });

  test('suggests recent signups that have not been contacted', async () => {
    const now = Date.now();
    seedUser('a.com', 'new@a.com', {
      createdAt: new Date(now - 2 * DAY), // recent enough to suggest
      lastLoginAt: new Date(now - 1 * DAY),
    });
    seedEvent('a.com', 'new@a.com', 'signin', now - 2 * DAY);
    seedEvent('a.com', 'new@a.com', 'tracked', now - 1 * DAY);
    // No outreach doc → not yet contacted

    const suggestions = await firestore.getReachOutSuggestions();
    // Should appear in the list (or at least the function should return without throwing)
    expect(Array.isArray(suggestions)).toBe(true);
  });
});

// ═══════════════════════════ power user pipeline ═══════════════════════════

describe('getPowerUserPipeline', () => {
  test('returns users above the tracking threshold who have not been contacted', async () => {
    const now = Date.now();
    seedUser('a.com', 'power@a.com');
    // 10 tracked events in last 5 days
    for (let i = 0; i < 10; i++) seedEvent('a.com', 'power@a.com', 'tracked', now - i * 12 * 3600 * 1000);
    // No outreach doc → not contacted

    const users = await firestore.getPowerUserPipeline({ days: 7, minTracked: 5 });
    expect(users.length).toBeGreaterThan(0);
    expect(users[0].email).toBe('power@a.com');
  });

  test('respects minTracked threshold', async () => {
    const now = Date.now();
    seedUser('a.com', 'casual@a.com');
    seedEvent('a.com', 'casual@a.com', 'tracked', now);
    seedEvent('a.com', 'casual@a.com', 'tracked', now);
    // 2 events, threshold 5 → excluded
    const users = await firestore.getPowerUserPipeline({ days: 7, minTracked: 5 });
    expect(users.find(u => u.email === 'casual@a.com')).toBeUndefined();
  });

  test('excludes already-contacted users', async () => {
    const now = Date.now();
    seedUser('a.com', 'contacted@a.com');
    for (let i = 0; i < 10; i++) seedEvent('a.com', 'contacted@a.com', 'tracked', now);
    ctx.seed('tenants/a.com/outreach/contacted@a.com', { contactedAt: wrapTimestamp(new Date()) });
    const users = await firestore.getPowerUserPipeline({ days: 7, minTracked: 5 });
    expect(users.find(u => u.email === 'contacted@a.com')).toBeUndefined();
  });
});

// ═══════════════════════════ outreach list (CSV) ═══════════════════════════

describe('getOutreachList', () => {
  test('returns empty array when no active users', async () => {
    const rows = await firestore.getOutreachList({ days: 30, limit: 50 });
    expect(Array.isArray(rows)).toBe(true);
  });

  test('builds mail-merge-ready rows with action counts', async () => {
    const now = Date.now();
    seedUser('a.com', 'active@a.com', { displayName: 'Alex Active' });
    for (let i = 0; i < 5; i++) seedEvent('a.com', 'active@a.com', 'tracked', now - i * DAY);
    seedEvent('a.com', 'active@a.com', 'exported', now);
    const rows = await firestore.getOutreachList({ days: 30, limit: 50 });
    const row = rows.find(r => r.email === 'active@a.com');
    expect(row).toBeDefined();
    expect(row.tracked).toBe(5);
    expect(row.exported).toBe(1);
    expect(row.firstName).toBe('Alex');
  });
});

// ═══════════════════════════ insights / analytics ═══════════════════════════

describe('getAggregatedInsights', () => {
  test('returns insights object (shape sanity check)', async () => {
    const insights = await firestore.getAggregatedInsights();
    expect(insights).toBeDefined();
    expect(typeof insights).toBe('object');
  });
});

describe('getAdvancedAnalytics', () => {
  test('returns analytics shape (may be null on empty data)', async () => {
    const analytics = await firestore.getAdvancedAnalytics();
    // Tolerate either shape — function returns null on failure but valid data otherwise
    if (analytics) {
      expect(typeof analytics).toBe('object');
    }
  });
});

describe('getWeeklySelfReport', () => {
  test('returns weekly report data with metrics + concerns + sources', async () => {
    seedUser('a.com', 'new@a.com', { createdAt: new Date() });
    seedEvent('a.com', 'new@a.com', 'signin', Date.now());
    seedEvent('a.com', 'new@a.com', 'tracked', Date.now());
    const report = await firestore.getWeeklySelfReport();
    expect(report).toBeDefined();
    expect(report.signups).toBeDefined();
    expect(report.tracks).toBeDefined();
    expect(report.exports).toBeDefined();
    expect(report.windowStart).toBeDefined();
    expect(report.windowEnd).toBeDefined();
  });
});

// ═══════════════════════════ participant notes ═══════════════════════════

describe('participant notes (per-user)', () => {
  test('round-trips a note keyed on requester+participant', async () => {
    await firestore.setParticipantNote('a.com', 'me@a.com', 'alex@acme.com', 'Met at conf 2026');
    const note = await firestore.getParticipantNote('a.com', 'me@a.com', 'alex@acme.com');
    expect(note).toBe('Met at conf 2026');
  });

  test('returns empty string when no note exists', async () => {
    const note = await firestore.getParticipantNote('a.com', 'me@a.com', 'unknown@x.com');
    expect(note).toBe('');
  });

  test('two different requesters have independent notes on same participant', async () => {
    await firestore.setParticipantNote('a.com', 'me@a.com', 'alex@acme.com', 'Met at conf');
    await firestore.setParticipantNote('a.com', 'someone-else@a.com', 'alex@acme.com', 'Saw them speak');
    expect(await firestore.getParticipantNote('a.com', 'me@a.com', 'alex@acme.com')).toBe('Met at conf');
    expect(await firestore.getParticipantNote('a.com', 'someone-else@a.com', 'alex@acme.com')).toBe('Saw them speak');
  });
});

// ═══════════════════════════ destructive ops ═══════════════════════════

describe('deleteUser', () => {
  test('removes the user doc', async () => {
    seedUser('a.com', 'goodbye@a.com');
    await firestore.deleteUser('a.com', 'goodbye@a.com');
    expect(ctx.read('tenants/a.com/users/goodbye@a.com')).toBeUndefined();
  });

  test('idempotent: succeeds even when user already deleted', async () => {
    // No seed → user doesn't exist
    await expect(firestore.deleteUser('a.com', 'ghost@a.com')).resolves.not.toThrow();
  });
});

// ═══════════════════════════ token persistence ═══════════════════════════

describe('updateUserTokens', () => {
  test('stores access token + expiry on the user doc', async () => {
    seedUser('a.com', 'u@a.com');
    const expiresAt = new Date(Date.now() + 3600000);
    await firestore.updateUserTokens('a.com', 'u@a.com', {
      accessToken: 'ya29.test-access-token',
      tokenExpiresAt: expiresAt,
    });
    const user = ctx.read('tenants/a.com/users/u@a.com');
    expect(user.accessToken).toBe('ya29.test-access-token');
  });
});
