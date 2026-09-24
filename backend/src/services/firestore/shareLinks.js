const crypto = require('crypto');
const { getDb, tenantRef, FieldValue, log, tsMs } = require('./_core');

// ── Public share links for series dashboards & meeting reports ──
// Owner mints a token; recipient hits /api/public/share/:token and sees a
// read-only view of one series or meeting. Tokens are opaque random strings stored as
// Firestore doc IDs. 30-day expiry by default so a leaked link doesn't haunt
// the owner forever — they can re-mint when they need it again.
const SHARE_LINK_TTL_DAYS = 30;

async function createShareLink(domain, ownerEmail, { type, recurringEventId, meetingId, conferenceId }) {
  if (type === 'series') {
    if (!recurringEventId) {
      throw new Error('type=series and recurringEventId required');
    }
  } else if (type === 'meeting') {
    if (!meetingId && !conferenceId) {
      throw new Error('type=meeting and meetingId or conferenceId required');
    }
  } else {
    throw new Error('type must be series or meeting');
  }
  const token = crypto.randomBytes(12).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); // url-safe
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHARE_LINK_TTL_DAYS * 86400000);
  const docData = {
    token, type, domain, ownerEmail: ownerEmail.toLowerCase(),
    createdAt: FieldValue.serverTimestamp(),
    expiresAt,
    revoked: false,
    viewCount: 0,
  };
  if (type === 'series') {
    docData.recurringEventId = recurringEventId;
  } else {
    docData.meetingId = meetingId || conferenceId;
    docData.conferenceId = conferenceId || meetingId;
  }
  await getDb().collection('shareLinks').doc(token).set(docData);
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
    const out = {
      token,
      type: d.type,
      domain: d.domain,
      ownerEmail: d.ownerEmail,
    };
    if (d.type === 'series') {
      out.recurringEventId = d.recurringEventId;
    } else {
      out.meetingId = d.meetingId || null;
      out.conferenceId = d.conferenceId || null;
    }
    return out;
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
    // Per-instance model: each session is its own doc; a legacy code-keyed doc
    // counts as one merged instance only while it holds participants, and a
    // post-migration code doc (metadata-only series anchor) is skipped so it
    // can't dilute attendance rates as a phantom empty session.
    const seriesMeetings = meetingsSnap.docs
      .filter(d => {
        const data = d.data();
        const isInstance = !!data.meetingCode && d.id !== data.meetingCode;
        return isInstance || !data.hasInstances; // hasInstances = metadata-only series anchor (post-migration code doc)
      })
      .map(d => ({ id: d.id, ref: d.ref, data: d.data() }));
    if (!seriesMeetings.length) return null;
    const participantSnaps = await Promise.all(seriesMeetings.map(m => m.ref.collection('participants').get()));

    // Identity canonicalization (Sweep-10 class): merge a name-only appearance
    // into its email identity so a student reported name-only one week and by
    // email another isn't double-counted as two people in the shared roll-up.
    const nameToEmail = new Map();
    for (const snap of participantSnaps) {
      for (const p of snap.docs) {
        const e = (p.data().email || '').toLowerCase();
        const n = (p.data().displayName || '').toLowerCase();
        if (e && n && !nameToEmail.has(n)) nameToEmail.set(n, e);
      }
    }

    seriesMeetings.sort((a, b) => {
      const aT = tsMs(a.data.startTime) || tsMs(a.data.createdAt) || 0;
      const bT = tsMs(b.data.startTime) || tsMs(b.data.createdAt) || 0;
      return aT - bT;
    });

    const title = seriesMeetings[seriesMeetings.length - 1].data.title || 'Recurring meeting';
    const instanceCount = seriesMeetings.length;
    let firstAt = null, lastAt = null;
    const peopleMap = new Map();
    for (let i = 0; i < seriesMeetings.length; i++) {
      const m = seriesMeetings[i];
      const ts = tsMs(m.data.startTime) || tsMs(m.data.createdAt) || null;
      if (ts) {
        // seriesMeetings is pre-sorted ascending, so firstAt is set on the
        // first timestamped meeting and the `ts < firstAt` guard never fires
        // afterwards — the not-taken branch is unreachable here.
        /* istanbul ignore next */
        if (!firstAt || ts < firstAt) firstAt = ts;
        if (!lastAt || ts > lastAt) lastAt = ts;
      }
      const seen = new Set();
      for (const p of participantSnaps[i].docs) {
        const pdata = p.data();
        const e = (pdata.email || '').toLowerCase();
        const n = pdata.displayName || '';
        const canonEmail = e || nameToEmail.get(n.toLowerCase()) || '';
        const key = canonEmail || `name:${n.toLowerCase()}`;
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

// Revoke a share link (owner-only). resolveShareLink already returns null for a
// revoked doc, so this is the missing write side — a kill switch for a leaked
// link before its 30-day TTL. Verifies the caller owns the token.
async function revokeShareLink(token, ownerEmail) {
  try {
    const ref = getDb().collection('shareLinks').doc(token);
    const doc = await ref.get();
    if (!doc.exists) return { revoked: false, reason: 'not_found' };
    if ((doc.data().ownerEmail || '').toLowerCase() !== (ownerEmail || '').toLowerCase()) {
      return { revoked: false, reason: 'not_owner' };
    }
    await ref.set({ revoked: true, revokedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { revoked: true };
  } catch (err) {
    log.warn('firestore: revokeShareLink failed', { error: err.message });
    return { revoked: false, reason: 'error' };
  }
}

// Build a public-safe view of a single meeting. Personal emails are stripped
// so recipient only sees names, dwell time, and attendance status.
async function getSharedMeetingView(domain, meetingId) {
  try {
    const tenant = tenantRef(domain);
    let mRef = tenant.collection('meetings').doc(meetingId);
    let mDoc = await mRef.get();
    if (!mDoc.exists) {
      // Try searching by meetingCode / conferenceId
      const codeSnap = await tenant.collection('meetings')
        .where('meetingCode', '==', meetingId).get();
      if (!codeSnap.empty) {
        const instances = codeSnap.docs.filter(d => d.id !== meetingId);
        const docs = instances.length ? instances : codeSnap.docs;
        const ms = (v) => (v?.toDate ? v.toDate().getTime() : (v ? new Date(v).getTime() : 0));
        docs.sort((a, b) => ms(b.data().startTime) - ms(a.data().startTime));
        mRef = docs[0].ref;
        mDoc = docs[0];
      }
    }
    if (!mDoc.exists) return null;
    const m = mDoc.data();
    const pSnap = await mRef.collection('participants').get();

    const iso = (v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : (v ? new Date(v).toISOString() : null));

    const people = pSnap.docs.map(d => {
      const p = d.data();
      return {
        displayName: p.displayName || 'Guest',
        present: p.present !== false,
        joinTime: iso(p.joinTime),
        leaveTime: iso(p.leaveTime),
        durationMin: typeof p.durationMin === 'number' ? p.durationMin : Math.round((p.durationMs || 0) / 60000),
      };
    }).sort((a, b) => (b.durationMin || 0) - (a.durationMin || 0) || a.displayName.localeCompare(b.displayName));

    const totalAttendees = people.length;
    const presentCount = people.filter(p => p.present).length;
    const attendanceRate = totalAttendees > 0 ? (presentCount / totalAttendees) : 1;

    return {
      title: m.title || 'Google Meet',
      meetingCode: m.meetingCode || m.conferenceId || null,
      startTime: iso(m.startTime),
      endTime: iso(m.endTime),
      totalAttendees,
      presentCount,
      attendanceRate,
      people,
    };
  } catch (err) {
    log.error('firestore: getSharedMeetingView failed', { domain, meetingId, error: err.message });
    return null;
  }
}

module.exports = { createShareLink, resolveShareLink, getSharedSeriesView, getSharedMeetingView, revokeShareLink };
