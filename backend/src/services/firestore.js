const { Firestore, FieldValue } = require('@google-cloud/firestore');
const crypto = require('crypto');
const CONFIG = require('../config');
const log = require('../lib/logger');

// ── Token encryption (AES-256-GCM using SESSION_SECRET as key) ──
const ALGO = 'aes-256-gcm';
function deriveKey() {
  return crypto.createHash('sha256').update(CONFIG.sessionSecret).digest();
}

function encryptToken(plaintext) {
  if (!plaintext) return null;
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag().toString('base64');
  return `${iv.toString('base64')}:${tag}:${encrypted}`;
}

function decryptToken(ciphertext) {
  if (!ciphertext || !ciphertext.includes(':')) return ciphertext; // not encrypted (legacy)
  try {
    const [ivB64, tagB64, data] = ciphertext.split(':');
    const key = deriveKey();
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    let decrypted = decipher.update(data, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    log.warn('token decryption failed — may be legacy plaintext', { error: err.message });
    return ciphertext;
  }
}

let db = null;

function getDb() {
  if (!db) {
    const opts = {};
    if (CONFIG.gcpProjectId) opts.projectId = CONFIG.gcpProjectId;
    db = new Firestore(opts);
  }
  return db;
}

// ── Tenant helper: all collections scoped under tenants/{domain} ──
function tenantRef(domain) {
  return getDb().collection('tenants').doc(domain);
}

// Extract last segment from Meet API resource name
function lastSegment(resourceName) {
  const parts = resourceName.split('/');
  return parts[parts.length - 1];
}

// ── Tenant config ──

async function getTenantConfig(domain) {
  try {
    const doc = await tenantRef(domain).get();
    return doc.exists ? doc.data() : null;
  } catch (err) {
    log.error('firestore: getTenantConfig failed', { domain, error: err.message });
    return null;
  }
}

async function upsertTenantConfig(domain, config) {
  try {
    await tenantRef(domain).set({
      domain,
      ...config,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    log.info('firestore: upserted tenant config', { domain });
  } catch (err) {
    log.error('firestore: upsertTenantConfig failed', { domain, error: err.message });
  }
}

// ── Meeting persistence (tenant-scoped) ──

async function persistAttendance(domain, conferenceId, recordName, participants) {
  try {
    const now = FieldValue.serverTimestamp();
    const meetingRef = tenantRef(domain).collection('meetings').doc(conferenceId);

    const joinTimes = participants.map(p => p.joinTime).filter(Boolean).map(t => new Date(t));
    const leaveTimes = participants.map(p => p.leaveTime).filter(Boolean).map(t => new Date(t));

    await meetingRef.set({
      conferenceId,
      recordName,
      participantCount: participants.length,
      startTime: joinTimes.length > 0 ? new Date(Math.min(...joinTimes)) : null,
      endTime: leaveTimes.length > 0 ? new Date(Math.max(...leaveTimes)) : null,
      lastFetchedAt: now,
      updatedAt: now,
      createdAt: now,
    }, { merge: true });

    const batch = getDb().batch();
    for (const p of participants) {
      const docId = lastSegment(p.participantId);
      const pRef = meetingRef.collection('participants').doc(docId);
      batch.set(pRef, {
        participantId: p.participantId,
        displayName: p.displayName,
        email: p.email,
        joinTime: p.joinTime ? new Date(p.joinTime) : null,
        leaveTime: p.leaveTime ? new Date(p.leaveTime) : null,
        present: p.present,
        sessions: p.sessions,
        lastSeenAt: now,
        updatedAt: now,
        createdAt: now,
      }, { merge: true });
    }
    await batch.commit();

    log.info('firestore: persisted attendance', { domain, conferenceId, participants: participants.length });
  } catch (err) {
    log.error('firestore: persistAttendance failed', { domain, conferenceId, error: err.message });
  }
}

async function persistCalendarData(domain, meetingCode, eventTitle, attendees) {
  try {
    const now = FieldValue.serverTimestamp();
    const meetingRef = tenantRef(domain).collection('meetings').doc(meetingCode);

    await meetingRef.set({
      conferenceId: meetingCode,
      title: eventTitle,
      calendarAttendees: attendees,
      updatedAt: now,
      createdAt: now,
    }, { merge: true });

    log.info('firestore: persisted calendar data', { domain, meetingCode, eventTitle });
  } catch (err) {
    log.error('firestore: persistCalendarData failed', { domain, meetingCode, error: err.message });
  }
}

async function persistExport(domain, { meetingTitle, tabName, exportedAt, participantCount, sheetUrl, email }) {
  try {
    const now = FieldValue.serverTimestamp();

    await tenantRef(domain).collection('exports').add({
      meetingTitle,
      tabName,
      exportedAt,
      participantCount,
      sheetUrl,
      email: email ? email.toLowerCase() : null,
      createdAt: now,
    });

    log.info('firestore: persisted export record', { domain, tabName, participantCount });
  } catch (err) {
    log.error('firestore: persistExport failed', { domain, tabName, error: err.message });
  }
}

// ── User management (tenant-scoped) ──

async function getUser(domain, email) {
  try {
    const doc = await tenantRef(domain).collection('users').doc(email.toLowerCase()).get();
    if (!doc.exists) {
      // Fallback: check legacy root-level users collection (migration support)
      const legacyDoc = await getDb().collection('users').doc(email.toLowerCase()).get();
      if (legacyDoc.exists) {
        log.info('firestore: found legacy user, migrating', { email, domain });
        const data = legacyDoc.data();
        // Migrate to tenant-scoped
        await tenantRef(domain).collection('users').doc(email.toLowerCase()).set(data);
        if (data.refreshToken) data.refreshToken = decryptToken(data.refreshToken);
        return data;
      }
      return null;
    }
    const data = doc.data();
    if (data.refreshToken) data.refreshToken = decryptToken(data.refreshToken);
    return data;
  } catch (err) {
    log.error('firestore: getUser failed', { domain, email, error: err.message });
    return null;
  }
}

async function upsertUser(domain, { email, displayName, refreshToken, sheetId }) {
  try {
    const now = FieldValue.serverTimestamp();
    const data = {
      email: email.toLowerCase(),
      domain,
      displayName,
      lastLoginAt: now,
      updatedAt: now,
      createdAt: now,
    };
    if (refreshToken !== undefined) data.refreshToken = encryptToken(refreshToken);
    if (sheetId !== undefined) data.sheetId = sheetId;

    // Ensure the parent tenant doc exists. Firestore doesn't auto-create it
    // for subcollection writes, so without this the tenants collection stays
    // empty even though users are being added under it.
    const tenantDoc = await tenantRef(domain).get();
    if (!tenantDoc.exists) {
      await tenantRef(domain).set({
        domain,
        active: true,
        installedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    await tenantRef(domain).collection('users').doc(email.toLowerCase()).set(data, { merge: true });
    log.info('firestore: upserted user', { domain, email });
  } catch (err) {
    log.error('firestore: upsertUser failed', { domain, email, error: err.message });
  }
}

async function getUserSheetId(domain, email) {
  const user = await getUser(domain, email);
  return user?.sheetId || null;
}

async function setUserSheetId(domain, email, sheetId) {
  try {
    await tenantRef(domain).collection('users').doc(email.toLowerCase()).set(
      { sheetId, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    log.info('firestore: set user sheetId', { domain, email, sheetId });
  } catch (err) {
    log.error('firestore: setUserSheetId failed', { domain, email, error: err.message });
  }
}

async function updateUserTokens(domain, email, { accessToken, tokenExpiresAt }) {
  try {
    await tenantRef(domain).collection('users').doc(email.toLowerCase()).set(
      { accessToken, tokenExpiresAt, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  } catch (err) {
    log.error('firestore: updateUserTokens failed', { domain, email, error: err.message });
  }
}

// ── Cross-tenant queries (super admin) ──

async function getAllUsersAcrossTenants() {
  try {
    const snap = await getDb().collectionGroup('users').get();
    return snap.docs.map(d => {
      const data = d.data();
      return {
        email: d.id,
        domain: d.ref.parent.parent.id,
        displayName: data.displayName || '',
        lastLoginAt: data.lastLoginAt?.toDate?.()?.toISOString() || null,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
      };
    });
  } catch (err) {
    log.error('firestore: getAllUsersAcrossTenants failed', { error: err.message });
    return [];
  }
}

async function getAggregatedInsights() {
  try {
    const db = getDb();
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    const [tenantsSnap, usersSnap, meetingsSnap, exportsSnap] = await Promise.all([
      db.collection('tenants').get(),
      db.collectionGroup('users').get(),
      db.collectionGroup('meetings').get(),
      db.collectionGroup('exports').get(),
    ]);

    const explicitTenants = tenantsSnap.docs.map(d => ({ domain: d.id, ...d.data() }));
    const users = usersSnap.docs.map(d => ({
      email: d.id,
      domain: d.ref.parent.parent.id,
      ...d.data(),
      createdAt: d.data().createdAt?.toDate?.()?.getTime() || null,
      lastLoginAt: d.data().lastLoginAt?.toDate?.()?.getTime() || null,
    }));

    // Derive the complete tenant set: explicit docs + any domain found in users.
    // Firestore doesn't auto-create parent docs for subcollections, so a user can
    // exist under tenants/{domain}/users/* without a tenants/{domain} doc.
    const tenantMap = new Map();
    for (const t of explicitTenants) tenantMap.set(t.domain, t);
    for (const u of users) {
      if (!tenantMap.has(u.domain)) {
        tenantMap.set(u.domain, { domain: u.domain, active: true, installedAt: null });
      }
    }
    const tenants = [...tenantMap.values()];
    const meetings = meetingsSnap.docs.map(d => ({
      id: d.id,
      domain: d.ref.parent.parent.id,
      ...d.data(),
      startTime: d.data().startTime?.toDate?.()?.getTime() || null,
      endTime: d.data().endTime?.toDate?.()?.getTime() || null,
      createdAt: d.data().createdAt?.toDate?.()?.getTime() || null,
    }));
    const exports_ = exportsSnap.docs.map(d => ({
      id: d.id,
      domain: d.ref.parent.parent.id,
      ...d.data(),
      createdAt: d.data().createdAt?.toDate?.()?.getTime() || null,
    }));

    // ── Per-domain meeting/export indices for fast lookup ──
    const meetingsByDomain = {};
    const earliestMeetingByDomain = {};
    for (const m of meetings) {
      (meetingsByDomain[m.domain] ||= []).push(m);
      const t = m.createdAt || m.startTime;
      if (t && (!earliestMeetingByDomain[m.domain] || t < earliestMeetingByDomain[m.domain])) {
        earliestMeetingByDomain[m.domain] = t;
      }
    }
    const exportsByEmail = {};
    const exportsByDomain = {};
    for (const e of exports_) {
      if (e.email) (exportsByEmail[e.email] ||= []).push(e);
      (exportsByDomain[e.domain] ||= []).push(e);
    }

    // ── Funnel ──
    // We don't have explicit per-user "tracked"/"exported" events, so we proxy
    // at the domain level: a user counts as tracked/exported if their domain
    // has at least one meeting/export.
    //  - Installed  = tenants count
    //  - Signed in  = users count
    //  - Tracked    = users whose domain has at least one meeting
    //  - Exported   = users whose domain has at least one export
    const domainsWithMeetings = new Set(Object.keys(meetingsByDomain));
    const domainsWithExports = new Set(Object.keys(exportsByDomain));
    const usersWhoTracked = users.filter(u => domainsWithMeetings.has(u.domain)).length;
    const usersWhoExported = users.filter(u => domainsWithExports.has(u.domain)).length;

    // ── Activation + first-export rates ──
    const activationRate = users.length > 0 ? usersWhoTracked / users.length : 0;
    const firstExportRate = users.length > 0 ? usersWhoExported / users.length : 0;

    // ── Time to first track (per-user proxy: user.createdAt → earliest meeting in their domain) ──
    // Skip users whose domain had meetings before they joined — that meeting wasn't theirs.
    const ttftValues = users
      .map(u => {
        const firstMeeting = earliestMeetingByDomain[u.domain];
        if (!u.createdAt || !firstMeeting) return null;
        if (firstMeeting < u.createdAt) return null;
        return firstMeeting - u.createdAt;
      })
      .filter(v => v !== null && v >= 0)
      .sort((a, b) => a - b);
    const medianTimeToFirstTrack = ttftValues.length > 0
      ? ttftValues[Math.floor(ttftValues.length / 2)]
      : null;

    // ── WAU / MAU (users whose domain had a meeting in the window) ──
    const activeDomainsInWindow = (windowMs) => {
      const cutoff = now - windowMs;
      return new Set(meetings
        .filter(m => (m.createdAt || m.startTime) >= cutoff)
        .map(m => m.domain));
    };
    const wauDomains = activeDomainsInWindow(7 * DAY);
    const mauDomains = activeDomainsInWindow(30 * DAY);
    const wau = users.filter(u => wauDomains.has(u.domain)).length;
    const mau = users.filter(u => mauDomains.has(u.domain)).length;

    // ── D7 / D30 retention ──
    // Of users who installed ≥7d ago, how many are in WAU.
    const cohort7 = users.filter(u => u.createdAt && (now - u.createdAt) >= 7 * DAY);
    const cohort30 = users.filter(u => u.createdAt && (now - u.createdAt) >= 30 * DAY);
    const d7Retained = cohort7.filter(u => wauDomains.has(u.domain)).length;
    const d30Retained = cohort30.filter(u => mauDomains.has(u.domain)).length;
    const d7Retention = cohort7.length > 0 ? d7Retained / cohort7.length : null;
    const d30Retention = cohort30.length > 0 ? d30Retained / cohort30.length : null;

    // ── Repeat usage histogram (meetings per domain since users are domain-bucketed) ──
    const meetingCountBuckets = { '0': 0, '1': 0, '2-4': 0, '5-9': 0, '10+': 0 };
    for (const t of tenants) {
      const count = (meetingsByDomain[t.domain] || []).length;
      if (count === 0) meetingCountBuckets['0']++;
      else if (count === 1) meetingCountBuckets['1']++;
      else if (count < 5) meetingCountBuckets['2-4']++;
      else if (count < 10) meetingCountBuckets['5-9']++;
      else meetingCountBuckets['10+']++;
    }

    // ── Churned users: signed in ≥7d ago, never tracked ──
    const churnedUsers = users
      .filter(u => u.createdAt && (now - u.createdAt) >= 7 * DAY && !domainsWithMeetings.has(u.domain))
      .map(u => ({
        email: u.email,
        domain: u.domain,
        displayName: u.displayName || '',
        createdAt: u.createdAt ? new Date(u.createdAt).toISOString() : null,
        lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
      }));

    // ── Meetings per day (last 30 days) ──
    const meetingsPerDay = {};
    for (let i = 0; i < 30; i++) {
      const d = new Date(now - i * DAY);
      meetingsPerDay[d.toISOString().slice(0, 10)] = 0;
    }
    for (const m of meetings) {
      const t = m.createdAt || m.startTime;
      if (!t || now - t > 30 * DAY) continue;
      const key = new Date(t).toISOString().slice(0, 10);
      if (key in meetingsPerDay) meetingsPerDay[key]++;
    }
    const meetingsByDay = Object.entries(meetingsPerDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));

    // ── Avg participants per meeting + median duration ──
    const participantCounts = meetings.map(m => m.participantCount || 0).filter(v => v > 0);
    const avgParticipants = participantCounts.length > 0
      ? participantCounts.reduce((a, b) => a + b, 0) / participantCounts.length
      : 0;
    const durations = meetings
      .filter(m => m.startTime && m.endTime && m.endTime > m.startTime)
      .map(m => m.endTime - m.startTime)
      .sort((a, b) => a - b);
    const medianDurationMs = durations.length > 0
      ? durations[Math.floor(durations.length / 2)]
      : null;

    // ── Exports per user (top 10) ──
    const exportsPerUser = Object.entries(exportsByEmail)
      .map(([email, list]) => ({ email, count: list.length, domain: list[0].domain }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // ── Top orgs by activity ──
    const orgActivity = tenants.map(t => {
      const m = meetingsByDomain[t.domain] || [];
      const e = exportsByDomain[t.domain] || [];
      const usersInOrg = users.filter(u => u.domain === t.domain);
      const lastActivity = Math.max(
        ...m.map(x => x.createdAt || 0),
        ...e.map(x => x.createdAt || 0),
        ...usersInOrg.map(x => x.lastLoginAt || 0),
        0,
      );
      return {
        domain: t.domain,
        users: usersInOrg.length,
        meetings: m.length,
        exports: e.length,
        active: t.active !== false,
        installedAt: t.installedAt || null,
        delegationConfigured: !!t.impersonateEmail,
        lastActivityAt: lastActivity ? new Date(lastActivity).toISOString() : null,
      };
    }).sort((a, b) => (b.meetings + b.exports) - (a.meetings + a.exports));

    return {
      counts: {
        installs: tenants.length,
        users: users.length,
        meetings: meetings.length,
        exports: exports_.length,
      },
      funnel: {
        installed: tenants.length,
        signedIn: users.length,
        tracked: usersWhoTracked,
        exported: usersWhoExported,
      },
      activationRate,
      firstExportRate,
      medianTimeToFirstTrackMs: medianTimeToFirstTrack,
      wau,
      mau,
      d7Retention,
      d30Retention,
      meetingCountBuckets,
      churnedUsers,
      meetingsByDay,
      avgParticipants,
      medianDurationMs,
      topExporters: exportsPerUser,
      orgActivity,
    };
  } catch (err) {
    log.error('firestore: getAggregatedInsights failed', { error: err.message });
    throw err;
  }
}

// ── Delete user data (Marketplace compliance) ──

async function deleteUser(domain, email) {
  try {
    await tenantRef(domain).collection('users').doc(email.toLowerCase()).delete();
    log.info('firestore: deleted user', { domain, email });
  } catch (err) {
    log.error('firestore: deleteUser failed', { domain, email, error: err.message });
  }
}

module.exports = {
  getTenantConfig, upsertTenantConfig,
  persistAttendance, persistCalendarData, persistExport,
  getUser, upsertUser, getUserSheetId, setUserSheetId, updateUserTokens,
  getAllUsersAcrossTenants,
  getAggregatedInsights,
  deleteUser,
};
