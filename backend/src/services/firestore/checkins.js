const { getDb, FieldValue, log } = require('./_core');

// ── Attendee self-check-in ──
// A participant taps "I'm here" in the side panel and we record a verified
// (email, name, time) tuple keyed by the meeting code. TOP-LEVEL collection
// (like `verifications`): the host and the attendee may be in different
// tenants, and both sides only share the meeting code.
//
// One doc per meeting with a `people` map rather than a subcollection: a
// meeting's check-ins are always read together, the volume is bounded by
// real meeting sizes, and a single get keeps the host's poll cheap.
//
// Check-ins are ephemeral by design — they only matter while the host is
// still looking at that meeting. `expiresAt` (rolling 24h from the last
// check-in) is enforced on read, shareLinks-style. Enabling a Firestore TTL
// policy on `expiresAt` for the `checkins` collection group makes Google
// garbage-collect the docs too (console/gcloud step, optional).
const CHECKIN_TTL_MS = 24 * 60 * 60 * 1000;

// Meeting codes look like abc-defg-hij, but the SDK can also hand back other
// id shapes — bound the doc-id space without being brittle about format.
function normalizeMeetingCode(code) {
  if (typeof code !== 'string') return null;
  const c = code.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{4,62}[a-z0-9]$/.test(c) ? c : null;
}

// Map keys must not contain characters Firestore field paths treat specially.
// base64url is collision-free — the previous dot→underscore swap collided
// john.doe@ with john_doe@ (both real, distinct accounts), silently dropping
// the second student from the attestation. The real email lives in the entry.
function emailKey(email) {
  return Buffer.from(email.toLowerCase(), 'utf8').toString('base64url');
}

// Record a check-in. First check-in wins: re-tapping "I'm here" keeps the
// original checkedInAt (that's the attestation-relevant timestamp).
async function saveCheckin(meetingCode, { email, displayName }) {
  const code = normalizeMeetingCode(meetingCode);
  if (!code) throw Object.assign(new Error('Invalid meeting code'), { badInput: true });
  const lower = String(email).toLowerCase();
  const key = emailKey(lower);
  const ref = getDb().collection('checkins').doc(code);
  return getDb().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : {};
    const existing = data.people?.[key];
    const expiresAtMs = data.expiresAt?.toDate?.()?.getTime?.() || (data.expiresAt ? new Date(data.expiresAt).getTime() : 0);
    const stale = !snap.exists || (expiresAtMs && expiresAtMs < Date.now());
    if (!stale && existing) {
      return { checkedInAt: existing.checkedInAt, already: true };
    }
    const checkedInAt = new Date().toISOString();
    const entry = {
      email: lower,
      displayName: String(displayName || '').slice(0, 100) || lower,
      checkedInAt,
    };
    // A stale doc is a previous day's meeting on the same code — start fresh.
    const people = stale ? { [key]: entry } : { ...(data.people || {}), [key]: entry };
    tx.set(ref, {
      meetingCode: code,
      people,
      updatedAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + CHECKIN_TTL_MS),
    });
    return { checkedInAt, already: false };
  });
}

// All live check-ins for a meeting, oldest first. Empty array for unknown
// codes and expired docs. `strict: true` makes read failures THROW instead of
// returning [] — required for the attestation export, where a swallowed error
// would produce a signed-looking CSV certifying "nobody checked in".
async function getCheckins(meetingCode, { strict = false } = {}) {
  const code = normalizeMeetingCode(meetingCode);
  if (!code) return [];
  try {
    const doc = await getDb().collection('checkins').doc(code).get();
    if (!doc.exists) return [];
    const d = doc.data();
    const expiresAtMs = d.expiresAt?.toDate?.()?.getTime?.() || (d.expiresAt ? new Date(d.expiresAt).getTime() : 0);
    if (expiresAtMs && expiresAtMs < Date.now()) return [];
    return Object.values(d.people || {})
      .sort((a, b) => String(a.checkedInAt).localeCompare(String(b.checkedInAt)));
  } catch (err) {
    if (strict) throw err;
    log.warn('firestore: getCheckins failed', { error: err.message });
    return [];
  }
}

module.exports = { saveCheckin, getCheckins, normalizeMeetingCode, CHECKIN_TTL_MS };
