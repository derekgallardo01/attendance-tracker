const crypto = require('crypto');
const { getDb, tenantRef, FieldValue, log } = require('./_core');

// ── Public share links for series dashboards ──
// Owner mints a token; recipient hits /api/public/share/:token and sees a
// read-only view of one series. Tokens are opaque random strings stored as
// Firestore doc IDs. 30-day expiry by default so a leaked link doesn't haunt
// the owner forever — they can re-mint when they need it again.
const SHARE_LINK_TTL_DAYS = 30;

async function createShareLink(domain, ownerEmail, { type, recurringEventId }) {
  if (type !== 'series' || !recurringEventId) {
    throw new Error('type=series and recurringEventId required');
  }
  const token = crypto.randomBytes(12).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); // url-safe
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHARE_LINK_TTL_DAYS * 86400000);
  await getDb().collection('shareLinks').doc(token).set({
    token, type, domain, ownerEmail: ownerEmail.toLowerCase(),
    recurringEventId,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
    revoked: false,
    viewCount: 0,
  });
  return { token, expiresAt: expiresAt.toISOString() };
}

async function resolveShareLink(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    const doc = await getDb().collection('shareLinks').doc(token).get();
    if (!doc.exists) return null;
    const d = doc.data();
    if (d.revoked) return null;
    const expiresAtMs = d.expiresAt?.toDate?.()?.getTime?.() || (d.expiresAt ? new Date(d.expiresAt).getTime() : 0);
    if (expiresAtMs && expiresAtMs < Date.now()) return null;
    // Bump view counter — fire-and-forget; failure shouldn't block the read.
    doc.ref.update({ viewCount: FieldValue.increment(1), lastViewedAt: FieldValue.serverTimestamp() })
      .catch(() => {});
    return { token, type: d.type, domain: d.domain, ownerEmail: d.ownerEmail, recurringEventId: d.recurringEventId };
  } catch (err) {
    log.warn('firestore: resolveShareLink failed', { error: err.message });
    return null;
  }
}

// Build a public-safe view of a single series. Same aggregation as
// getUserMeetingSeries but scoped to one recurringEventId and with personal
// emails stripped so the link recipient doesn't see contact info.
async function getSharedSeriesView(domain, recurringEventId) {
  try {
    const tenant = tenantRef(domain);
    const meetingsSnap = await tenant.collection('meetings').where('recurringEventId', '==', recurringEventId).get();
    if (meetingsSnap.empty) return null;
    const seriesMeetings = meetingsSnap.docs.map(d => ({ id: d.id, ref: d.ref, data: d.data() }));
    const participantSnaps = await Promise.all(seriesMeetings.map(m => m.ref.collection('participants').get()));

    seriesMeetings.sort((a, b) => {
      const aT = a.data.startTime?.toDate?.()?.getTime() || a.data.createdAt?.toDate?.()?.getTime() || 0;
      const bT = b.data.startTime?.toDate?.()?.getTime() || b.data.createdAt?.toDate?.()?.getTime() || 0;
      return aT - bT;
    });

    const title = seriesMeetings[seriesMeetings.length - 1].data.title || 'Recurring meeting';
    const instanceCount = seriesMeetings.length;
    let firstAt = null, lastAt = null;
    const peopleMap = new Map();
    for (let i = 0; i < seriesMeetings.length; i++) {
      const m = seriesMeetings[i];
      const ts = m.data.startTime?.toDate?.()?.getTime() || m.data.createdAt?.toDate?.()?.getTime() || null;
      if (ts) { if (!firstAt || ts < firstAt) firstAt = ts; if (!lastAt || ts > lastAt) lastAt = ts; }
      const seen = new Set();
      for (const p of participantSnaps[i].docs) {
        const pdata = p.data();
        const e = (pdata.email || '').toLowerCase();
        const n = pdata.displayName || '';
        const key = e || `name:${n.toLowerCase()}`;
        if (!key || key === 'name:' || seen.has(key)) continue;
        seen.add(key);
        let person = peopleMap.get(key);
        if (!person) { person = { displayName: n || 'Unknown', attended: 0 }; peopleMap.set(key, person); }
        person.attended++;
        if (n && n.length > person.displayName.length) person.displayName = n;
      }
    }
    const people = [...peopleMap.values()]
      .map(p => ({ displayName: p.displayName, attended: p.attended, attendanceRate: p.attended / instanceCount }))
      .sort((a, b) => b.attended - a.attended || a.displayName.localeCompare(b.displayName));
    return {
      title, instanceCount, uniquePeople: people.length,
      firstAt: firstAt ? new Date(firstAt).toISOString() : null,
      lastAt: lastAt ? new Date(lastAt).toISOString() : null,
      people,
    };
  } catch (err) {
    log.error('firestore: getSharedSeriesView failed', { domain, recurringEventId, error: err.message });
    return null;
  }
}

module.exports = { createShareLink, resolveShareLink, getSharedSeriesView };
