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

// Per-user event log — lets us compute true individual activity (most active
// this month, real per-user tracked/exported counts) instead of bucketing by
// domain. Fire-and-forget; never block the caller.
async function logEvent(domain, { email, type, meta }) {
  if (!domain || !email || !type) return;
  try {
    await tenantRef(domain).collection('events').add({
      email: email.toLowerCase(),
      type,
      meta: meta || null,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    log.warn('firestore: logEvent failed', { domain, email, type, error: err.message });
  }
}

async function persistAttendance(domain, conferenceId, recordName, participants, actorEmail) {
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

    if (actorEmail) {
      logEvent(domain, {
        email: actorEmail,
        type: 'tracked',
        meta: { conferenceId, participantCount: participants.length },
      });
    }

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

    if (email) {
      logEvent(domain, {
        email,
        type: 'exported',
        meta: { tabName, participantCount },
      });
    }

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

async function upsertUser(domain, { email, displayName, refreshToken, sheetId, acquisition }) {
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

    const userRef = tenantRef(domain).collection('users').doc(email.toLowerCase());

    // First-touch acquisition: only stamp source/utm/referrer on the first
    // sign-in (read the doc first so we don't overwrite an existing source on
    // every login). landingUrl + userAgent are also first-touch because they
    // describe the browser/entry point at signup, not now.
    if (acquisition) {
      const existing = await userRef.get();
      const hasSource = existing.exists && existing.data().acquisitionSource;
      const hasUserAgent = existing.exists && existing.data().userAgent;
      if (!hasSource) {
        if (acquisition.source) data.acquisitionSource = acquisition.source;
        if (acquisition.utmSource) data.utmSource = acquisition.utmSource;
        if (acquisition.utmMedium) data.utmMedium = acquisition.utmMedium;
        if (acquisition.utmCampaign) data.utmCampaign = acquisition.utmCampaign;
        if (acquisition.referrer) data.referrer = acquisition.referrer;
        data.acquisitionCapturedAt = now;
      }
      if (!hasUserAgent) {
        if (acquisition.userAgent) data.userAgent = acquisition.userAgent;
        if (acquisition.landingUrl) data.landingUrl = acquisition.landingUrl;
      }
    }

    await userRef.set(data, { merge: true });
    log.info('firestore: upserted user', { domain, email });
  } catch (err) {
    log.error('firestore: upsertUser failed', { domain, email, error: err.message });
  }
}

// Set acquisition source from the in-app modal. Overwrites any passive UTM
// guess because user self-report is the strongest signal.
async function setUserAcquisitionSource(domain, email, { source, detail }) {
  try {
    await tenantRef(domain).collection('users').doc(email.toLowerCase()).set(
      {
        acquisitionSource: source,
        acquisitionSourceDetail: detail || null,
        acquisitionCapturedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    log.info('firestore: set user acquisition source', { domain, email, source });
  } catch (err) {
    log.error('firestore: setUserAcquisitionSource failed', { domain, email, error: err.message });
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

// ── Per-user activation status (for in-product nudges + celebration moment) ──

async function getUserActivationStatus(domain, email) {
  try {
    const userRef = tenantRef(domain).collection('users').doc(email.toLowerCase());
    const eventsRef = tenantRef(domain).collection('events');
    const [userDoc, trackedSnap, exportedSnap] = await Promise.all([
      userRef.get(),
      eventsRef.where('email', '==', email.toLowerCase()).where('type', '==', 'tracked').limit(1).get(),
      eventsRef.where('email', '==', email.toLowerCase()).where('type', '==', 'exported').limit(1).get(),
    ]);
    const data = userDoc.exists ? userDoc.data() : {};
    return {
      firstSeenAt: data.createdAt?.toDate?.()?.toISOString() || null,
      lastLoginAt: data.lastLoginAt?.toDate?.()?.toISOString() || null,
      hasTracked: !trackedSnap.empty,
      hasExported: !exportedSnap.empty,
      acquisitionSource: data.acquisitionSource || null,
      utmSource: data.utmSource || null,
    };
  } catch (err) {
    log.error('firestore: getUserActivationStatus failed', { domain, email, error: err.message });
    return { hasTracked: false, hasExported: false };
  }
}

// Count this user's prior export events. Used to detect the first-export
// "aha moment" so the frontend can fire the celebration modal.
async function countUserExports(domain, email) {
  try {
    const snap = await tenantRef(domain).collection('events')
      .where('email', '==', email.toLowerCase())
      .where('type', '==', 'exported')
      .get();
    return snap.size;
  } catch (err) {
    log.warn('firestore: countUserExports failed', { domain, email, error: err.message });
    return 0;
  }
}

// Has this email ever appeared in any users subcollection? Used by the OAuth
// route to decide whether to fire the signup notification webhook.
async function isExistingUserAnywhere(email) {
  try {
    const snap = await getDb().collectionGroup('users')
      .where('email', '==', email.toLowerCase())
      .limit(1)
      .get();
    return !snap.empty;
  } catch (err) {
    log.warn('firestore: isExistingUserAnywhere failed', { email, error: err.message });
    return false;
  }
}

async function countAllUsers() {
  try {
    const snap = await getDb().collectionGroup('users').get();
    return snap.size;
  } catch (err) {
    log.warn('firestore: countAllUsers failed', { error: err.message });
    return null;
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

    const [tenantsSnap, usersSnap, meetingsSnap, exportsSnap, eventsSnap] = await Promise.all([
      db.collection('tenants').get(),
      db.collectionGroup('users').get(),
      db.collectionGroup('meetings').get(),
      db.collectionGroup('exports').get(),
      db.collectionGroup('events').get(),
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
    const events = eventsSnap.docs.map(d => ({
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

    // ── Per-user event index ──
    // Events were added in the user-engagement work — older meetings/exports
    // pre-date them, so we fall back to the domain-level proxy whenever the
    // events collection is empty (e.g. before the feature shipped).
    const eventsByEmail = {};
    for (const e of events) {
      if (e.email) (eventsByEmail[e.email] ||= []).push(e);
    }
    const emailsWhoTracked = new Set(events.filter(e => e.type === 'tracked').map(e => e.email));
    const emailsWhoExported = new Set(events.filter(e => e.type === 'exported').map(e => e.email));

    // ── Funnel ──
    // Prefer the real per-user events; fall back to the domain proxy when no
    // events exist yet so old data still shows something sensible.
    //  - Installed  = tenants count
    //  - Signed in  = users count
    //  - Tracked    = users with a 'tracked' event (or, if no events,
    //                 users whose domain has at least one meeting)
    //  - Exported   = users with an 'exported' event (or domain proxy)
    const domainsWithMeetings = new Set(Object.keys(meetingsByDomain));
    const domainsWithExports = new Set(Object.keys(exportsByDomain));
    const haveEvents = events.length > 0;
    const usersWhoTracked = haveEvents
      ? users.filter(u => emailsWhoTracked.has(u.email)).length
      : users.filter(u => domainsWithMeetings.has(u.domain)).length;
    const usersWhoExported = haveEvents
      ? users.filter(u => emailsWhoExported.has(u.email)).length
      : users.filter(u => domainsWithExports.has(u.domain)).length;

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

    // ── Top active users this month (real per-user, from events) ──
    const monthCutoff = now - 30 * DAY;
    const eventCountByEmail = {};
    for (const e of events) {
      if (!e.email || !e.createdAt || e.createdAt < monthCutoff) continue;
      if (e.type !== 'tracked' && e.type !== 'exported') continue; // signins are noisy
      eventCountByEmail[e.email] = (eventCountByEmail[e.email] || 0) + 1;
    }
    const userByEmail = Object.fromEntries(users.map(u => [u.email, u]));
    const topActiveUsersThisMonth = Object.entries(eventCountByEmail)
      .map(([email, count]) => {
        const u = userByEmail[email];
        return {
          email,
          domain: u?.domain || email.split('@')[1],
          displayName: u?.displayName || '',
          eventCount: count,
          tracked: events.filter(e => e.email === email && e.type === 'tracked' && e.createdAt >= monthCutoff).length,
          exported: events.filter(e => e.email === email && e.type === 'exported' && e.createdAt >= monthCutoff).length,
          acquisitionSource: u?.acquisitionSource || null,
        };
      })
      .sort((a, b) => b.eventCount - a.eventCount)
      .slice(0, 10);

    // ── Acquisition source breakdown ──
    const acquisitionSources = {};
    let usersWithSource = 0;
    for (const u of users) {
      const src = u.acquisitionSource || (u.utmSource ? `utm:${u.utmSource}` : null);
      if (!src) continue;
      acquisitionSources[src] = (acquisitionSources[src] || 0) + 1;
      usersWithSource++;
    }
    const acquisitionSourcesUnknown = users.length - usersWithSource;

    // ── Cohort retention by source ──
    // For each source, of users who signed up >=7d ago, how many tracked at
    // least one meeting? Tells us which channels deliver users that stick.
    // We require a minimum cohort size of 2 to avoid noisy 100% / 0% rows.
    const sourceCohortRetention = {};
    const bucketBySource = {};
    for (const u of users) {
      const src = u.acquisitionSource || (u.utmSource ? `utm:${u.utmSource}` : 'unknown');
      (bucketBySource[src] ||= []).push(u);
    }
    for (const [src, list] of Object.entries(bucketBySource)) {
      const cohort = list.filter(u => u.createdAt && (now - u.createdAt) >= 7 * DAY);
      if (cohort.length < 2) {
        sourceCohortRetention[src] = { cohortSize: cohort.length, activated: null, retention: null };
        continue;
      }
      const activated = cohort.filter(u => {
        if (haveEvents) return emailsWhoTracked.has(u.email);
        return domainsWithMeetings.has(u.domain);
      }).length;
      sourceCohortRetention[src] = {
        cohortSize: cohort.length,
        activated,
        retention: activated / cohort.length,
      };
    }

    return {
      counts: {
        installs: tenants.length,
        users: users.length,
        meetings: meetings.length,
        exports: exports_.length,
        events: events.length,
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
      topActiveUsersThisMonth,
      acquisitionSources,
      acquisitionSourcesUnknown,
      sourceCohortRetention,
      orgActivity,
    };
  } catch (err) {
    log.error('firestore: getAggregatedInsights failed', { error: err.message });
    throw err;
  }
}

// ── Per-user meeting history (Meetings / People / Calendar tabs) ──

// Returns everything the /history.html page needs in one shot:
//  - meetings:  meetings the user tracked, sorted newest first
//  - people:    aggregated participants across all those meetings
//  - calendar:  per-day meeting counts for the last 90 days
//
// We scope to the user's tenant for data isolation, then filter to meetings
// they have a 'tracked' event for (so two users in the same domain don't see
// each other's untracked meetings). For early users with no events yet we
// fall back to "all meetings in your domain" so the page isn't empty.
async function getUserMeetingHistory(domain, email) {
  try {
    const tenant = tenantRef(domain);
    const emailLower = email.toLowerCase();

    const [eventsSnap, meetingsSnap] = await Promise.all([
      tenant.collection('events').where('email', '==', emailLower).where('type', '==', 'tracked').get(),
      tenant.collection('meetings').get(),
    ]);

    // Conference IDs the user has actually tracked. If empty (e.g. tracked
    // before we shipped events), fall back to the domain's meetings.
    const trackedConferenceIds = new Set();
    for (const d of eventsSnap.docs) {
      const cid = d.data().meta?.conferenceId;
      if (cid) trackedConferenceIds.add(cid);
    }
    const useEventFilter = trackedConferenceIds.size > 0;

    const filteredMeetings = meetingsSnap.docs
      .filter(d => !useEventFilter || trackedConferenceIds.has(d.id))
      .map(d => {
        const data = d.data();
        return {
          id: d.id,
          ref: d.ref,
          conferenceId: data.conferenceId || d.id,
          title: data.title || 'Untitled meeting',
          participantCount: data.participantCount || 0,
          startTime: data.startTime?.toDate?.()?.getTime() || null,
          endTime: data.endTime?.toDate?.()?.getTime() || null,
          createdAt: data.createdAt?.toDate?.()?.getTime() || null,
        };
      });

    // Pull all participants for the filtered meetings in parallel. At ~7-15
    // users with <100 meetings each this is fine; if it gets heavy we paginate.
    const participantSnaps = await Promise.all(
      filteredMeetings.map(m => m.ref.collection('participants').get())
    );

    // ── Build the meetings array (drop the Firestore ref) ──
    const meetings = filteredMeetings
      .map((m, i) => {
        const parts = participantSnaps[i].docs.map(p => p.data());
        const presentNames = parts.filter(p => p.present).map(p => p.displayName).filter(Boolean);
        const durationMs = (m.startTime && m.endTime) ? (m.endTime - m.startTime) : null;
        return {
          conferenceId: m.conferenceId,
          title: m.title,
          participantCount: m.participantCount || parts.length,
          presentNames: presentNames.slice(0, 8),
          startTime: m.startTime ? new Date(m.startTime).toISOString() : null,
          endTime: m.endTime ? new Date(m.endTime).toISOString() : null,
          createdAt: m.createdAt ? new Date(m.createdAt).toISOString() : null,
          durationMs,
        };
      })
      .sort((a, b) => (new Date(b.createdAt || b.startTime || 0)) - (new Date(a.createdAt || a.startTime || 0)));

    // ── People aggregation across all meetings ──
    // Key by email when available, else displayName. Track meetings attended,
    // total minutes (summed across appearances), last seen.
    const totalMeetings = meetings.length;
    const peopleMap = new Map();
    for (let i = 0; i < filteredMeetings.length; i++) {
      const m = filteredMeetings[i];
      const meetingDate = m.startTime || m.createdAt || 0;
      for (const p of participantSnaps[i].docs) {
        const data = p.data();
        const email = (data.email || '').toLowerCase();
        const name = data.displayName || '';
        const key = email || `name:${name.toLowerCase()}`;
        if (!key || key === 'name:') continue;

        let entry = peopleMap.get(key);
        if (!entry) {
          entry = {
            key, email: email || null, displayName: name,
            meetingCount: 0, totalMinutes: 0, lastSeenAt: 0,
          };
          peopleMap.set(key, entry);
        }
        entry.meetingCount++;
        const join = data.joinTime?.toDate?.()?.getTime();
        const leave = data.leaveTime?.toDate?.()?.getTime();
        if (join && leave && leave > join) {
          entry.totalMinutes += Math.round((leave - join) / 60000);
        }
        if (meetingDate > entry.lastSeenAt) entry.lastSeenAt = meetingDate;
        // Prefer a longer displayName if we get one
        if (!entry.displayName || (name && name.length > entry.displayName.length)) {
          entry.displayName = name;
        }
      }
    }

    const people = [...peopleMap.values()]
      .map(p => ({
        email: p.email,
        displayName: p.displayName,
        meetingCount: p.meetingCount,
        totalMinutes: p.totalMinutes,
        attendanceRate: totalMeetings > 0 ? (p.meetingCount / totalMeetings) : 0,
        lastSeenAt: p.lastSeenAt ? new Date(p.lastSeenAt).toISOString() : null,
      }))
      .sort((a, b) => b.meetingCount - a.meetingCount);

    // ── Calendar grid: per-day counts for the last 90 days ──
    const DAY = 24 * 60 * 60 * 1000;
    const today = new Date();
    const calendar = [];
    const byDate = new Map();
    for (const m of filteredMeetings) {
      const ts = m.createdAt || m.startTime;
      if (!ts) continue;
      const key = new Date(ts).toISOString().slice(0, 10);
      const bucket = byDate.get(key) || { count: 0, titles: [] };
      bucket.count++;
      if (bucket.titles.length < 5) bucket.titles.push(m.title || 'Meeting');
      byDate.set(key, bucket);
    }
    for (let i = 89; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY);
      const key = d.toISOString().slice(0, 10);
      const b = byDate.get(key);
      calendar.push({ date: key, count: b?.count || 0, titles: b?.titles || [] });
    }

    return {
      meetings,
      people,
      calendar,
      totalMeetings,
    };
  } catch (err) {
    log.error('firestore: getUserMeetingHistory failed', { domain, email, error: err.message });
    return { meetings: [], people: [], calendar: [], totalMeetings: 0 };
  }
}

// ── Participant history (for the click-to-profile modal) ──
// `key` is either an email (preferred) or `name:<displayName>` when the
// participant never had an email captured. Returns every meeting in the
// user's tenant where this participant appeared, with per-appearance
// durations and aggregated stats.
async function getParticipantHistory(domain, userEmail, key) {
  try {
    const tenant = tenantRef(domain);
    const isEmail = key.includes('@');
    const normalizedKey = isEmail ? key.toLowerCase() : key;

    // Scope to meetings the requester has tracked (same filter as /history).
    const [eventsSnap, meetingsSnap] = await Promise.all([
      tenant.collection('events').where('email', '==', userEmail.toLowerCase()).where('type', '==', 'tracked').get(),
      tenant.collection('meetings').get(),
    ]);
    const trackedIds = new Set();
    for (const d of eventsSnap.docs) {
      const cid = d.data().meta?.conferenceId;
      if (cid) trackedIds.add(cid);
    }
    const useFilter = trackedIds.size > 0;

    const meetings = meetingsSnap.docs
      .filter(d => !useFilter || trackedIds.has(d.id))
      .map(d => ({ id: d.id, ref: d.ref, data: d.data() }));

    const participantSnaps = await Promise.all(meetings.map(m => m.ref.collection('participants').get()));

    const appearances = [];
    for (let i = 0; i < meetings.length; i++) {
      for (const p of participantSnaps[i].docs) {
        const data = p.data();
        const pEmail = (data.email || '').toLowerCase();
        const matches = isEmail
          ? (pEmail === normalizedKey)
          : (!pEmail && data.displayName === key.replace(/^name:/, ''));
        if (!matches) continue;
        const join = data.joinTime?.toDate?.()?.getTime() || null;
        const leave = data.leaveTime?.toDate?.()?.getTime() || null;
        const start = meetings[i].data.startTime?.toDate?.()?.getTime() || null;
        appearances.push({
          conferenceId: meetings[i].id,
          meetingTitle: meetings[i].data.title || 'Untitled meeting',
          meetingStart: start ? new Date(start).toISOString() : null,
          joinTime: join ? new Date(join).toISOString() : null,
          leaveTime: leave ? new Date(leave).toISOString() : null,
          durationMs: (join && leave && leave > join) ? (leave - join) : null,
          present: !!data.present,
          displayName: data.displayName || '',
          email: pEmail || null,
        });
      }
    }

    appearances.sort((a, b) => new Date(b.meetingStart || 0) - new Date(a.meetingStart || 0));

    const totalMeetings = meetings.length;
    const meetingCount = appearances.length;
    const totalMinutes = appearances.reduce((sum, a) => sum + (a.durationMs ? Math.round(a.durationMs / 60000) : 0), 0);
    const avgDurationMs = appearances.filter(a => a.durationMs).reduce((sum, a, _, arr) => sum + a.durationMs / arr.length, 0) || null;
    const displayName = appearances[0]?.displayName || (isEmail ? key.split('@')[0] : key.replace(/^name:/, ''));
    const email = isEmail ? normalizedKey : appearances.find(a => a.email)?.email || null;

    return {
      key: normalizedKey,
      email,
      displayName,
      meetingCount,
      totalMeetings,
      attendanceRate: totalMeetings > 0 ? (meetingCount / totalMeetings) : 0,
      totalMinutes,
      avgDurationMinutes: avgDurationMs ? Math.round(avgDurationMs / 60000) : null,
      recent: appearances.slice(0, 5),
      firstSeen: appearances.length > 0 ? appearances[appearances.length - 1].meetingStart : null,
      lastSeen: appearances.length > 0 ? appearances[0].meetingStart : null,
    };
  } catch (err) {
    log.error('firestore: getParticipantHistory failed', { domain, key, error: err.message });
    return null;
  }
}

// ── Per-participant notes (private to the requesting user) ──
// Stored under users/{requesterEmail}/notes/{participantKey} so the same
// requester can have notes on the same person across many meetings.
async function setParticipantNote(domain, requesterEmail, participantKey, body) {
  try {
    const ref = tenantRef(domain)
      .collection('users').doc(requesterEmail.toLowerCase())
      .collection('notes').doc(encodeNoteKey(participantKey));
    if (!body || !body.trim()) {
      await ref.delete();
      return { deleted: true };
    }
    await ref.set({
      participantKey,
      body: body.slice(0, 2000),
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { saved: true };
  } catch (err) {
    log.error('firestore: setParticipantNote failed', { domain, requesterEmail, error: err.message });
    throw err;
  }
}

async function getParticipantNote(domain, requesterEmail, participantKey) {
  try {
    const doc = await tenantRef(domain)
      .collection('users').doc(requesterEmail.toLowerCase())
      .collection('notes').doc(encodeNoteKey(participantKey))
      .get();
    return doc.exists ? (doc.data().body || '') : '';
  } catch (err) {
    return '';
  }
}

// Firestore doc IDs can't contain '/' — and email-like keys are fine, but
// `name:Joe Smith` has spaces which work. Just sanitize aggressively.
function encodeNoteKey(key) {
  return key.replace(/[\/#?]/g, '_').slice(0, 1500);
}

// ── Weekly self-report: what happened in the last 7 days ──
// One snapshot you can email to yourself every Monday so you stop
// relying on opening the dashboard. Reuses event/user/meeting queries.
async function getWeeklySelfReport() {
  try {
    const now = Date.now();
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    const weekAgo = now - WEEK;
    const twoWeeksAgo = now - 2 * WEEK;

    const [usersSnap, eventsSnap, meetingsSnap] = await Promise.all([
      getDb().collectionGroup('users').get(),
      getDb().collectionGroup('events').get(),
      getDb().collectionGroup('meetings').get(),
    ]);

    const users = usersSnap.docs.map(d => ({
      email: d.id,
      domain: d.ref.parent.parent.id,
      displayName: d.data().displayName || '',
      createdAt: d.data().createdAt?.toDate?.()?.getTime() || 0,
      acquisitionSource: d.data().acquisitionSource || null,
    }));

    const events = eventsSnap.docs.map(d => ({
      email: d.data().email,
      type: d.data().type,
      ts: d.data().createdAt?.toDate?.()?.getTime() || 0,
    })).filter(e => e.email);

    // Window slicing
    const thisWeek = events.filter(e => e.ts >= weekAgo);
    const lastWeek = events.filter(e => e.ts >= twoWeeksAgo && e.ts < weekAgo);
    const signupsThisWeek = users.filter(u => u.createdAt >= weekAgo);
    const signupsLastWeek = users.filter(u => u.createdAt >= twoWeeksAgo && u.createdAt < weekAgo);

    const tracksThis = thisWeek.filter(e => e.type === 'tracked').length;
    const tracksLast = lastWeek.filter(e => e.type === 'tracked').length;
    const exportsThis = thisWeek.filter(e => e.type === 'exported').length;
    const exportsLast = lastWeek.filter(e => e.type === 'exported').length;

    // Top user this week
    const userActions = {};
    for (const e of thisWeek) {
      if (e.type === 'tracked' || e.type === 'exported') {
        userActions[e.email] = (userActions[e.email] || 0) + 1;
      }
    }
    const topUser = Object.entries(userActions).sort((a, b) => b[1] - a[1])[0];
    const topUserName = topUser ? (users.find(u => u.email === topUser[0])?.displayName || topUser[0]) : null;

    // Concerns: users who signed up 3-7 days ago and never tracked
    const concerns = users
      .filter(u => {
        const age = now - u.createdAt;
        if (age < 3 * 86400000 || age > 7 * 86400000) return false;
        const userEvents = events.filter(e => e.email === u.email);
        return !userEvents.some(e => e.type === 'tracked');
      })
      .map(u => ({ email: u.email, displayName: u.displayName, domain: u.domain }));

    // Sources of new signups
    const sourcesThisWeek = {};
    for (const u of signupsThisWeek) {
      const src = u.acquisitionSource || 'unknown';
      sourcesThisWeek[src] = (sourcesThisWeek[src] || 0) + 1;
    }

    const pctChange = (curr, prev) => {
      if (prev === 0) return curr > 0 ? '+∞' : '0';
      const p = Math.round(((curr - prev) / prev) * 100);
      return (p >= 0 ? '+' : '') + p + '%';
    };

    return {
      windowStart: new Date(weekAgo).toISOString(),
      windowEnd: new Date(now).toISOString(),
      signups: {
        thisWeek: signupsThisWeek.length,
        lastWeek: signupsLastWeek.length,
        delta: pctChange(signupsThisWeek.length, signupsLastWeek.length),
        new: signupsThisWeek.map(u => ({ email: u.email, displayName: u.displayName, domain: u.domain, source: u.acquisitionSource })),
      },
      tracks: { thisWeek: tracksThis, lastWeek: tracksLast, delta: pctChange(tracksThis, tracksLast) },
      exports: { thisWeek: exportsThis, lastWeek: exportsLast, delta: pctChange(exportsThis, exportsLast) },
      topUser: topUser ? { email: topUser[0], displayName: topUserName, actions: topUser[1] } : null,
      concerns: concerns.slice(0, 10),
      sources: sourcesThisWeek,
      totalUsers: users.length,
      totalMeetings: meetingsSnap.size,
    };
  } catch (err) {
    log.error('firestore: getWeeklySelfReport failed', { error: err.message });
    return null;
  }
}

// ── Admin: cohort + funnel + segment + time analytics in one pass ──
// One call so we can compute everything off the same Firestore snapshot.
async function getAdvancedAnalytics() {
  try {
    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const HOUR = 60 * 60 * 1000;

    const [usersSnap, eventsSnap, meetingsSnap] = await Promise.all([
      getDb().collectionGroup('users').get(),
      getDb().collectionGroup('events').get(),
      getDb().collectionGroup('meetings').get(),
    ]);

    const users = usersSnap.docs.map(d => {
      const data = d.data();
      return {
        email: d.id,
        domain: d.ref.parent.parent.id,
        displayName: data.displayName || '',
        createdAt: data.createdAt?.toDate?.()?.getTime() || 0,
        lastLoginAt: data.lastLoginAt?.toDate?.()?.getTime() || 0,
        acquisitionSource: data.acquisitionSource || (data.utmSource ? `utm:${data.utmSource}` : null),
      };
    });

    const eventsByEmail = {};
    const eventsByType = { signin: [], tracked: [], exported: [] };
    for (const d of eventsSnap.docs) {
      const data = d.data();
      if (!data.email) continue;
      const ts = data.createdAt?.toDate?.()?.getTime() || 0;
      const ev = { type: data.type, ts };
      (eventsByEmail[data.email] ||= []).push(ev);
      if (eventsByType[data.type]) eventsByType[data.type].push({ email: data.email, ts });
    }

    // ── Health score + segment per user ──
    const segmentCounts = { new: 0, activating: 0, active: 0, atRisk: 0, churned: 0 };
    const userHealth = users.map(u => {
      const events = eventsByEmail[u.email] || [];
      const score = computeHealthScore({ createdAt: { toDate: () => new Date(u.createdAt) } }, events.map(e => ({ ...e, createdAt: { toDate: () => new Date(e.ts) } })));
      const last = events.reduce((m, e) => Math.max(m, e.ts), 0);
      const daysSinceLast = last ? (now - last) / DAY : 999;
      const ageDays = Math.max(0, (now - u.createdAt) / DAY);
      const tracked = events.filter(e => e.type === 'tracked').length;

      let segment;
      if (ageDays < 3 && tracked === 0) segment = 'new';
      else if (tracked === 0) segment = ageDays < 14 ? 'activating' : 'churned';
      else if (daysSinceLast > 30) segment = 'churned';
      else if (daysSinceLast > 14) segment = 'atRisk';
      else segment = 'active';

      segmentCounts[segment]++;
      return { ...u, healthScore: score, segment, daysSinceLast, tracked };
    });

    // ── Source attribution funnel ──
    // For each source, what % of users at each stage.
    const sourceFunnel = {};
    for (const u of userHealth) {
      const src = u.acquisitionSource || 'unknown';
      const bucket = sourceFunnel[src] ||= { signedIn: 0, tracked: 0, exported: 0 };
      bucket.signedIn++;
      const ev = eventsByEmail[u.email] || [];
      if (ev.some(e => e.type === 'tracked')) bucket.tracked++;
      if (ev.some(e => e.type === 'exported')) bucket.exported++;
    }

    // ── Org adoption funnel ──
    // 1-user orgs, 2-user orgs, 3+ orgs. Bigger = network effect kicking in.
    const usersByDomain = {};
    for (const u of users) (usersByDomain[u.domain] ||= []).push(u);
    const orgBuckets = { '1': 0, '2': 0, '3-4': 0, '5+': 0 };
    const multiUserOrgs = [];
    for (const [domain, list] of Object.entries(usersByDomain)) {
      const n = list.length;
      if (n === 1) orgBuckets['1']++;
      else if (n === 2) orgBuckets['2']++;
      else if (n < 5) orgBuckets['3-4']++;
      else orgBuckets['5+']++;
      if (n > 1) {
        // For each multi-user org, sort by createdAt to see the spread
        const sorted = list.sort((a, b) => a.createdAt - b.createdAt);
        const firstUserActive = (now - sorted[0].lastLoginAt) < 14 * DAY;
        multiUserOrgs.push({
          domain,
          userCount: n,
          firstUserAt: new Date(sorted[0].createdAt).toISOString(),
          mostRecentUserAt: new Date(sorted[n - 1].createdAt).toISOString(),
          firstUserStillActive: firstUserActive,
          users: sorted.map(u => ({ email: u.email, displayName: u.displayName, joinedAt: new Date(u.createdAt).toISOString() })),
        });
      }
    }
    multiUserOrgs.sort((a, b) => b.userCount - a.userCount);

    // ── Time-of-day signup pattern (UTC hour bucket, 0-23) ──
    const signupHours = Array(24).fill(0);
    for (const u of users) {
      if (u.createdAt) signupHours[new Date(u.createdAt).getUTCHours()]++;
    }
    const dayOfWeek = Array(7).fill(0);
    for (const u of users) {
      if (u.createdAt) dayOfWeek[new Date(u.createdAt).getUTCDay()]++;
    }

    // ── Drop-off in flows: signin -> tracked within N hours ──
    // For each user, time-to-first-track from first signin.
    const dropoff = { signedIn: 0, trackedWithin1h: 0, trackedWithin24h: 0, trackedWithin7d: 0, never: 0 };
    for (const [email, events] of Object.entries(eventsByEmail)) {
      const firstSignin = events.filter(e => e.type === 'signin').reduce((m, e) => Math.min(m, e.ts), Infinity);
      if (!isFinite(firstSignin)) continue;
      dropoff.signedIn++;
      const firstTrack = events.filter(e => e.type === 'tracked').reduce((m, e) => Math.min(m, e.ts), Infinity);
      if (!isFinite(firstTrack)) { dropoff.never++; continue; }
      const gapH = (firstTrack - firstSignin) / HOUR;
      if (gapH <= 1) dropoff.trackedWithin1h++;
      else if (gapH <= 24) dropoff.trackedWithin24h++;
      else if (gapH <= 168) dropoff.trackedWithin7d++;
      else dropoff.never++;
    }

    return {
      segments: segmentCounts,
      userHealth: userHealth.map(u => ({
        email: u.email,
        domain: u.domain,
        displayName: u.displayName,
        healthScore: u.healthScore,
        segment: u.segment,
        tracked: u.tracked,
        daysSinceLast: Math.round(u.daysSinceLast),
        acquisitionSource: u.acquisitionSource,
        createdAt: new Date(u.createdAt).toISOString(),
      })),
      sourceFunnel,
      orgBuckets,
      multiUserOrgs: multiUserOrgs.slice(0, 20),
      signupHoursUTC: signupHours,
      signupDayOfWeekUTC: dayOfWeek,
      dropoff,
    };
  } catch (err) {
    log.error('firestore: getAdvancedAnalytics failed', { error: err.message });
    return null;
  }
}

// ── Admin: full user detail (drill-down modal) ──
// Pulls everything we know about one user into one payload: profile, every
// event in their timeline, meetings they've tracked, admin notes, outreach
// conversation log.
async function getUserDetail(domain, email) {
  try {
    const tenant = tenantRef(domain);
    const emailLower = email.toLowerCase();
    const [userDoc, eventsSnap, notesDoc, outreachDoc, remindersSnap] = await Promise.all([
      tenant.collection('users').doc(emailLower).get(),
      tenant.collection('events').where('email', '==', emailLower).get(),
      tenant.collection('adminNotes').doc(emailLower).get(),
      tenant.collection('outreach').doc(emailLower).get(),
      tenant.collection('reminders').where('email', '==', emailLower).get(),
    ]);
    if (!userDoc.exists) return null;
    const user = userDoc.data();

    const events = eventsSnap.docs
      .map(d => ({ id: d.id, ...d.data(), createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null }))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Resolve meeting titles for tracked events that include a conferenceId.
    const trackedIds = [...new Set(events.filter(e => e.type === 'tracked' && e.meta?.conferenceId).map(e => e.meta.conferenceId))];
    const meetingsMap = {};
    if (trackedIds.length > 0) {
      const meetingDocs = await Promise.all(trackedIds.map(id => tenant.collection('meetings').doc(id).get()));
      for (const d of meetingDocs) {
        if (d.exists) {
          const m = d.data();
          meetingsMap[d.id] = {
            id: d.id,
            title: m.title || 'Untitled meeting',
            participantCount: m.participantCount || 0,
            startTime: m.startTime?.toDate?.()?.toISOString() || null,
          };
        }
      }
    }

    const note = notesDoc.exists ? (notesDoc.data().body || '') : '';
    const outreach = outreachDoc.exists ? outreachDoc.data() : null;
    const reminders = remindersSnap.docs
      .map(d => ({
        id: d.id,
        ...d.data(),
        remindAt: d.data().remindAt?.toDate?.()?.toISOString() || null,
        createdAt: d.data().createdAt?.toDate?.()?.toISOString() || null,
      }))
      .sort((a, b) => new Date(a.remindAt || 0) - new Date(b.remindAt || 0));

    // Conversation log lives inside the outreach doc as an appended array so
    // we can show "you sent X, no reply" / "they replied on date" style.
    const conversation = outreach?.conversation || [];

    return {
      email: emailLower,
      domain,
      displayName: user.displayName || '',
      acquisitionSource: user.acquisitionSource || null,
      utmSource: user.utmSource || null,
      createdAt: user.createdAt?.toDate?.()?.toISOString() || null,
      lastLoginAt: user.lastLoginAt?.toDate?.()?.toISOString() || null,
      counts: {
        tracked: events.filter(e => e.type === 'tracked').length,
        exported: events.filter(e => e.type === 'exported').length,
        signins: events.filter(e => e.type === 'signin').length,
      },
      events,
      meetings: Object.values(meetingsMap).sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0)),
      note,
      outreach: outreach ? {
        contactedAt: outreach.contactedAt?.toDate?.()?.toISOString() || null,
        replyStatus: outreach.replyStatus || null,
        lastEmailedAt: outreach.lastEmailedAt?.toDate?.()?.toISOString() || null,
      } : null,
      conversation,
      reminders,
      healthScore: computeHealthScore(user, events),
    };
  } catch (err) {
    log.error('firestore: getUserDetail failed', { domain, email, error: err.message });
    return null;
  }
}

// 0-100. Composite of recency, frequency, depth, account age.
function computeHealthScore(user, events) {
  const now = Date.now();
  const created = user.createdAt?.toDate?.()?.getTime() || now;
  const ageDays = Math.max(1, (now - created) / 86400000);

  const tracked = events.filter(e => e.type === 'tracked').length;
  const exported = events.filter(e => e.type === 'exported').length;
  const last = events.reduce((m, e) => Math.max(m, e.createdAt?.toDate?.()?.getTime() || 0), 0);
  const daysSinceLast = last ? (now - last) / 86400000 : 999;

  let score = 0;
  // Recency (40 pts): -1 per day since last activity
  score += Math.max(0, 40 - daysSinceLast * 1.5);
  // Frequency (30 pts): tracks per week, capped at 30
  score += Math.min(30, (tracked / Math.max(1, ageDays / 7)) * 6);
  // Depth (20 pts): exported vs only-tracked
  score += exported > 0 ? 20 : (tracked > 0 ? 8 : 0);
  // Stickiness bonus for surviving past day 30
  if (ageDays > 30 && daysSinceLast < 14) score += 10;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── Admin notes on any user (CRM-style) ──
async function setAdminNote(domain, email, body, authorEmail) {
  try {
    const ref = tenantRef(domain).collection('adminNotes').doc(email.toLowerCase());
    if (!body || !body.trim()) {
      await ref.delete();
      return { deleted: true };
    }
    await ref.set({
      body: body.slice(0, 5000),
      authorEmail,
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { saved: true };
  } catch (err) {
    log.error('firestore: setAdminNote failed', { domain, email, error: err.message });
    throw err;
  }
}

// Cross-tenant search of admin notes (super admin searches their CRM).
async function searchAdminNotes(query) {
  try {
    const q = (query || '').toLowerCase();
    if (!q) return [];
    const snap = await getDb().collectionGroup('adminNotes').get();
    return snap.docs
      .map(d => ({
        email: d.id,
        domain: d.ref.parent.parent.id,
        body: d.data().body || '',
        updatedAt: d.data().updatedAt?.toDate?.()?.toISOString() || null,
      }))
      .filter(n => n.body.toLowerCase().includes(q) || n.email.includes(q))
      .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  } catch (err) {
    log.error('firestore: searchAdminNotes failed', { error: err.message });
    return [];
  }
}

// ── Outreach: append a conversation entry + update reply status ──
async function appendConversation(domain, email, entry) {
  try {
    const ref = tenantRef(domain).collection('outreach').doc(email.toLowerCase());
    const doc = await ref.get();
    const existing = doc.exists ? (doc.data().conversation || []) : [];
    const newEntry = {
      direction: entry.direction || 'sent',
      subject: entry.subject || '',
      body: (entry.body || '').slice(0, 5000),
      at: new Date().toISOString(),
    };
    const update = {
      email: email.toLowerCase(),
      conversation: [...existing, newEntry],
      lastEmailedAt: entry.direction === 'sent' ? FieldValue.serverTimestamp() : undefined,
      contactedAt: entry.direction === 'sent' ? FieldValue.serverTimestamp() : undefined,
    };
    if (entry.replyStatus) update.replyStatus = entry.replyStatus;
    await ref.set(update, { merge: true });
    return newEntry;
  } catch (err) {
    log.error('firestore: appendConversation failed', { domain, email, error: err.message });
    throw err;
  }
}

async function setOutreachStatus(domain, email, status) {
  try {
    await tenantRef(domain).collection('outreach').doc(email.toLowerCase()).set({
      email: email.toLowerCase(),
      replyStatus: status,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    log.error('firestore: setOutreachStatus failed', { domain, email, error: err.message });
  }
}

// ── Reminders / follow-up scheduling ──
async function createReminder(domain, email, { remindAt, body, createdBy }) {
  try {
    const ref = await tenantRef(domain).collection('reminders').add({
      email: email.toLowerCase(),
      remindAt: new Date(remindAt),
      body: (body || '').slice(0, 500),
      createdBy: createdBy || null,
      done: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    return { id: ref.id };
  } catch (err) {
    log.error('firestore: createReminder failed', { domain, email, error: err.message });
    throw err;
  }
}

async function markReminderDone(domain, reminderId) {
  try {
    await tenantRef(domain).collection('reminders').doc(reminderId).set({
      done: true,
      doneAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    log.error('firestore: markReminderDone failed', { domain, reminderId, error: err.message });
  }
}

async function getDueReminders() {
  try {
    // Plain collectionGroup query — adding a where clause would require a
    // composite index. We filter `done` and `remindAt` in JS, which is fine
    // at our scale and avoids the index dependency.
    const snap = await getDb().collectionGroup('reminders').get();
    const now = Date.now();
    return snap.docs
      .map(d => ({
        id: d.id,
        domain: d.ref.parent.parent.id,
        ...d.data(),
        remindAt: d.data().remindAt?.toDate?.()?.getTime() || 0,
      }))
      .filter(r => !r.done && r.remindAt > 0 && r.remindAt <= now)
      .sort((a, b) => a.remindAt - b.remindAt)
      .map(r => ({ ...r, remindAt: new Date(r.remindAt).toISOString() }));
  } catch (err) {
    // Most common cause: the `reminders` collection group simply doesn't
    // exist yet because nobody has created one. Don't blow up the dashboard.
    if (/NOT_FOUND|does not exist|requires an index/i.test(err.message)) {
      log.info('reminders: no reminders yet', { detail: err.message });
      return [];
    }
    log.error('firestore: getDueReminders failed', { error: err.message });
    return [];
  }
}

// ── Email templates (stored under a single super-admin doc) ──
const TEMPLATES_DOC = () => getDb().collection('admin').doc('templates');

async function getEmailTemplates() {
  try {
    const doc = await TEMPLATES_DOC().get();
    const data = doc.exists ? (doc.data().items || []) : [];
    // Seed defaults the first time so the UI isn't empty.
    if (data.length === 0) {
      return [
        { name: 'Welcome', subject: 'Welcome to Attendance Tracker', body: "Hi {{firstName}},\n\nI'm Derek, the developer of Attendance Tracker -- thanks for signing up.\n\nQuick question: what brought you to the app, and what's the one thing you're hoping to do with it?\n\nDerek" },
        { name: 'Check-in (no track)', subject: 'Quick check-in on Attendance Tracker', body: "Hi {{firstName}},\n\nNoticed you signed up for Attendance Tracker {{daysAgo}} days ago but haven't tracked a meeting yet. Anything getting in the way?\n\nHappy to hop on a quick call or troubleshoot over email.\n\nDerek" },
        { name: 'Power user / testimonial ask', subject: 'You\'re one of our most active users', body: "Hi {{firstName}},\n\nYou've tracked {{tracked}} meetings and exported {{exported}} reports this week -- you're one of our most active users.\n\nWould you be willing to share a quick line about your experience? Anything you'd write back goes a long way.\n\nDerek" },
      ];
    }
    return data;
  } catch (err) {
    log.error('firestore: getEmailTemplates failed', { error: err.message });
    return [];
  }
}

async function setEmailTemplates(items) {
  try {
    await TEMPLATES_DOC().set({
      items: items.slice(0, 30).map(t => ({
        name: (t.name || '').slice(0, 100),
        subject: (t.subject || '').slice(0, 300),
        body: (t.body || '').slice(0, 5000),
      })),
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    log.error('firestore: setEmailTemplates failed', { error: err.message });
    throw err;
  }
}

// ── Admin: recent activity feed (super admin only) ──
// Returns the most recent events across every tenant for the live feed.
async function getRecentActivity({ limit = 50 } = {}) {
  try {
    const snap = await getDb().collectionGroup('events').get();
    return snap.docs
      .map(d => {
        const data = d.data();
        return {
          email: data.email || null,
          type: data.type,
          domain: d.ref.parent.parent.id,
          createdAt: data.createdAt?.toDate?.()?.getTime() || 0,
          meta: data.meta || null,
        };
      })
      .filter(e => e.createdAt > 0)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map(e => ({ ...e, createdAt: new Date(e.createdAt).toISOString() }));
  } catch (err) {
    log.error('firestore: getRecentActivity failed', { error: err.message });
    return [];
  }
}

// ── Admin: suggestions panel ──
// Surfaces users worth reaching out to RIGHT NOW based on event patterns.
async function getReachOutSuggestions() {
  try {
    const now = Date.now();
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;

    const [eventsSnap, usersSnap, outreachSnap] = await Promise.all([
      getDb().collectionGroup('events').get(),
      getDb().collectionGroup('users').get(),
      getDb().collectionGroup('outreach').get(),
    ]);

    const outreachByEmail = {};
    for (const d of outreachSnap.docs) {
      const data = d.data();
      const email = data.email || d.id;
      outreachByEmail[email] = data.contactedAt?.toDate?.()?.getTime() || 0;
    }

    const eventsByEmail = {};
    for (const d of eventsSnap.docs) {
      const data = d.data();
      if (!data.email) continue;
      const ts = data.createdAt?.toDate?.()?.getTime() || 0;
      (eventsByEmail[data.email] ||= []).push({ type: data.type, ts });
    }

    const usersByEmail = {};
    for (const d of usersSnap.docs) {
      const data = d.data();
      usersByEmail[d.id] = {
        email: d.id,
        domain: d.ref.parent.parent.id,
        displayName: data.displayName || '',
        createdAt: data.createdAt?.toDate?.()?.getTime() || 0,
        acquisitionSource: data.acquisitionSource || null,
      };
    }

    const suggestions = [];
    for (const [email, events] of Object.entries(eventsByEmail)) {
      const user = usersByEmail[email];
      if (!user) continue;
      const lastEvent = events.reduce((a, b) => b.ts > a.ts ? b : a, { ts: 0, type: null });
      const lastContacted = outreachByEmail[email] || 0;
      const wasContactedRecently = lastContacted && (now - lastContacted) < 7 * DAY;
      if (wasContactedRecently) continue;

      // a) Just signed in within the last hour and never tracked
      const justSignedIn = lastEvent.type === 'signin' && (now - lastEvent.ts) < HOUR;
      const hasTracked = events.some(e => e.type === 'tracked');
      if (justSignedIn && !hasTracked) {
        suggestions.push({
          priority: 1,
          email, ...user,
          reason: 'Signed in within the last hour, never tracked',
          ctaTime: 'Reach out NOW — they may still be in the app',
          lastEventAt: new Date(lastEvent.ts).toISOString(),
        });
        continue;
      }

      // b) First export happened in the last 24 hours
      const exports_ = events.filter(e => e.type === 'exported').sort((a, b) => a.ts - b.ts);
      if (exports_.length === 1 && (now - exports_[0].ts) < DAY) {
        suggestions.push({
          priority: 2,
          email, ...user,
          reason: 'Just had their first export — peak excitement',
          ctaTime: 'Ask them how it went today or tomorrow',
          lastEventAt: new Date(exports_[0].ts).toISOString(),
        });
        continue;
      }

      // c) Signed up 2-5 days ago, never tracked
      const ageMs = now - user.createdAt;
      if (ageMs >= 2 * DAY && ageMs <= 5 * DAY && !hasTracked) {
        suggestions.push({
          priority: 3,
          email, ...user,
          reason: `Signed up ${Math.round(ageMs / DAY)} days ago, never tracked`,
          ctaTime: 'Send a friendly check-in this week',
          lastEventAt: new Date(user.createdAt).toISOString(),
        });
        continue;
      }
    }

    suggestions.sort((a, b) => a.priority - b.priority || new Date(b.lastEventAt) - new Date(a.lastEventAt));
    return suggestions.slice(0, 20);
  } catch (err) {
    log.error('firestore: getReachOutSuggestions failed', { error: err.message });
    return [];
  }
}

// ── Admin: power user pipeline ──
// Active users who've crossed a threshold of recent activity but haven't been
// reached out to. Targets for personalized outreach + testimonial requests.
async function getPowerUserPipeline({ days = 7, minTracked = 5 } = {}) {
  try {
    const now = Date.now();
    const cutoff = now - days * 24 * 60 * 60 * 1000;

    const [eventsSnap, usersSnap, outreachSnap] = await Promise.all([
      getDb().collectionGroup('events').get(),
      getDb().collectionGroup('users').get(),
      getDb().collectionGroup('outreach').get(),
    ]);

    const outreachByEmail = {};
    for (const d of outreachSnap.docs) {
      const data = d.data();
      outreachByEmail[data.email || d.id] = data.contactedAt?.toDate?.()?.getTime() || 0;
    }

    const usersByEmail = {};
    for (const d of usersSnap.docs) {
      const data = d.data();
      usersByEmail[d.id] = {
        email: d.id,
        domain: d.ref.parent.parent.id,
        displayName: data.displayName || '',
        acquisitionSource: data.acquisitionSource || null,
        createdAt: data.createdAt?.toDate?.()?.getTime() || 0,
      };
    }

    const agg = {};
    for (const d of eventsSnap.docs) {
      const data = d.data();
      const ts = data.createdAt?.toDate?.()?.getTime() || 0;
      if (!data.email || ts < cutoff) continue;
      if (data.type !== 'tracked' && data.type !== 'exported') continue;
      const row = (agg[data.email] ||= { email: data.email, tracked: 0, exported: 0, lastActivity: 0 });
      if (data.type === 'tracked') row.tracked++;
      else row.exported++;
      if (ts > row.lastActivity) row.lastActivity = ts;
    }

    return Object.values(agg)
      .filter(row => row.tracked >= minTracked)
      .map(row => {
        const u = usersByEmail[row.email] || {};
        const lastContacted = outreachByEmail[row.email] || 0;
        return {
          email: row.email,
          domain: u.domain || row.email.split('@')[1],
          displayName: u.displayName || '',
          acquisitionSource: u.acquisitionSource || null,
          tracked: row.tracked,
          exported: row.exported,
          totalActions: row.tracked + row.exported,
          lastActivityAt: new Date(row.lastActivity).toISOString(),
          lastContactedAt: lastContacted ? new Date(lastContacted).toISOString() : null,
        };
      })
      .filter(row => !row.lastContactedAt)
      .sort((a, b) => b.totalActions - a.totalActions);
  } catch (err) {
    log.error('firestore: getPowerUserPipeline failed', { error: err.message });
    return [];
  }
}

// ── Outreach log (mark a user as contacted) ──
async function markUserContacted(domain, email, { note, contactedBy } = {}) {
  try {
    await tenantRef(domain)
      .collection('outreach').doc(email.toLowerCase())
      .set({
        email: email.toLowerCase(),
        contactedAt: FieldValue.serverTimestamp(),
        contactedBy: contactedBy || null,
        note: note || null,
      });
    log.info('firestore: marked user contacted', { domain, email });
  } catch (err) {
    log.error('firestore: markUserContacted failed', { domain, email, error: err.message });
    throw err;
  }
}

// ── Outreach list (super admin) ──
// Active users in the last N days, sorted by activity desc, joined with their
// user doc so we have first name + acquisition source for personalized email.
async function getOutreachList({ days = 30, limit = 50 } = {}) {
  try {
    const db = getDb();
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const [eventsSnap, usersSnap] = await Promise.all([
      db.collectionGroup('events').get(),
      db.collectionGroup('users').get(),
    ]);

    const usersByEmail = {};
    for (const d of usersSnap.docs) {
      const data = d.data();
      usersByEmail[d.id] = {
        email: d.id,
        domain: d.ref.parent.parent.id,
        displayName: data.displayName || '',
        acquisitionSource: data.acquisitionSource || null,
        createdAt: data.createdAt?.toDate?.()?.getTime() || null,
      };
    }

    const agg = {};
    for (const d of eventsSnap.docs) {
      const e = d.data();
      const ts = e.createdAt?.toDate?.()?.getTime() || 0;
      if (!e.email || ts < cutoff) continue;
      if (e.type !== 'tracked' && e.type !== 'exported') continue;
      const row = (agg[e.email] ||= { email: e.email, tracked: 0, exported: 0, lastActivityAt: 0 });
      if (e.type === 'tracked') row.tracked++;
      else row.exported++;
      if (ts > row.lastActivityAt) row.lastActivityAt = ts;
    }

    return Object.values(agg)
      .map(row => {
        const u = usersByEmail[row.email] || {};
        const firstName = (u.displayName || '').trim().split(/\s+/)[0]
          || row.email.split('@')[0].split(/[._]/)[0];
        return {
          email: row.email,
          firstName: firstName.charAt(0).toUpperCase() + firstName.slice(1),
          displayName: u.displayName || '',
          domain: u.domain || row.email.split('@')[1],
          tracked: row.tracked,
          exported: row.exported,
          totalActions: row.tracked + row.exported,
          lastActivityAt: new Date(row.lastActivityAt).toISOString(),
          acquisitionSource: u.acquisitionSource || null,
        };
      })
      .sort((a, b) => b.totalActions - a.totalActions)
      .slice(0, limit);
  } catch (err) {
    log.error('firestore: getOutreachList failed', { error: err.message });
    return [];
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
  setUserAcquisitionSource,
  logEvent,
  getUserActivationStatus, countUserExports, isExistingUserAnywhere, countAllUsers,
  getUserMeetingHistory,
  getParticipantHistory, setParticipantNote, getParticipantNote,
  getRecentActivity, getReachOutSuggestions, getPowerUserPipeline, markUserContacted,
  getUserDetail, setAdminNote, searchAdminNotes,
  getAdvancedAnalytics,
  getWeeklySelfReport,
  appendConversation, setOutreachStatus,
  createReminder, markReminderDone, getDueReminders,
  getEmailTemplates, setEmailTemplates,
  getAllUsersAcrossTenants,
  getAggregatedInsights,
  getOutreachList,
  deleteUser,
};
