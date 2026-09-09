const crypto = require('crypto');
const { getDb, tenantRef, FieldValue, log } = require('./_core');

// Tombstone id: hashed so the marker itself retains no PII after deletion.
function deletedUserDocId(email) {
  return crypto.createHash('sha256').update((email || '').toLowerCase()).digest('hex').slice(0, 32);
}

// True when this email was deleted via deleteUser. The auth middleware checks
// this whenever a session presents a valid JWT but no user doc exists — the
// 8h token otherwise outlives the deletion, and any merge:true write
// (settings, survey, source, event beacons) would silently RESURRECT the PII
// the user just asked us to erase.
async function isUserDeleted(domain, email) {
  try {
    const doc = await tenantRef(domain).collection('deletedUsers').doc(deletedUserDocId(email)).get();
    return doc.exists;
  } catch (err) {
    log.warn('firestore: isUserDeleted check failed', { domain, error: err.message });
    return false; // fail open — a read blip must not lock out a live user
  }
}

// Delete an array of DocumentReferences in batches under Firestore's 500-op
// limit. Best-effort per chunk; logs and continues on a chunk failure so a
// single bad ref can't abort the whole cascade.
async function deleteRefsInBatches(refs, ctx = {}) {
  let deleted = 0;
  let failedChunks = 0;
  for (let i = 0; i < refs.length; i += 450) {
    const chunk = refs.slice(i, i + 450);
    const batch = getDb().batch();
    for (const ref of chunk) batch.delete(ref);
    try {
      await batch.commit();
      deleted += chunk.length;
    } catch (err) {
      failedChunks++;
      log.warn('firestore: batch delete failed', { ...ctx, error: err.message });
    }
  }
  return { deleted, failedChunks };
}

// Delete a user and cascade every record that carries their PII, for
// Marketplace / GDPR data-deletion compliance. We purge:
//   users/{email}, userSettings/{email}, adminNotes/{email}, outreach/{email}
//   events, reminders, reengagementSent, alertsSent  (where email == user)
//   participant docs across meetings where the participant IS this user
//   shareLinks (where ownerEmail == user) + feedback (where fromEmail == user) — top-level
// We deliberately do NOT delete meetings/{conferenceId} — those are
// tenant-owned org records keyed by conference, not by one user; deleting them
// would erase other attendees' data. Meetings are scrubbed of this user's
// participant sub-doc instead.
// Returns { ok } — ok:false when the cascade threw or any batch chunk failed,
// so the caller can avoid falsely reporting a complete deletion.
async function deleteUser(domain, email) {
  const emailLower = email.toLowerCase();
  const tenant = tenantRef(domain);
  const db = getDb();
  try {
    // Tombstone FIRST (hashed id, no PII): the caller's session JWT stays
    // valid for up to 8h, and without this marker any later authed write
    // recreates the user doc via merge:true.
    await tenant.collection('deletedUsers').doc(deletedUserDocId(emailLower)).set({
      deletedAt: FieldValue.serverTimestamp(),
    });
    // 1) Docs keyed directly by the user's email.
    const keyedRefs = [
      tenant.collection('users').doc(emailLower),
      tenant.collection('userSettings').doc(emailLower),
      tenant.collection('adminNotes').doc(emailLower),
      tenant.collection('outreach').doc(emailLower),
    ];

    // 2) Collections that store the email as a field — query then delete.
    //    shareLinks + feedback are TOP-LEVEL (not tenant-scoped). shareLinks
    //    matches reliably (ownerEmail stored lowercased); feedback is
    //    best-effort (fromEmail is user-typed, unnormalized).
    const [eventsSnap, remindersSnap, reengSnap, alertsSnap, seriesAlertsSnap, shareSnap, feedbackSnap] = await Promise.all([
      tenant.collection('events').where('email', '==', emailLower).get(),
      tenant.collection('reminders').where('email', '==', emailLower).get(),
      tenant.collection('reengagementSent').where('email', '==', emailLower).get(),
      tenant.collection('alertsSent').where('email', '==', emailLower).get(),
      tenant.collection('seriesAlertsSent').where('email', '==', emailLower).get(),
      db.collection('shareLinks').where('ownerEmail', '==', emailLower).get(),
      db.collection('feedback').where('fromEmail', '==', emailLower).get(),
    ]);
    const fieldRefs = [
      ...eventsSnap.docs, ...remindersSnap.docs, ...reengSnap.docs, ...alertsSnap.docs,
      ...seriesAlertsSnap.docs, ...shareSnap.docs, ...feedbackSnap.docs,
    ].map(d => d.ref);

    // 3) Participant sub-docs where this user is the attendee. Scan the tenant's
    //    meetings, then their participants, matching on the participant email.
    const meetingsSnap = await tenant.collection('meetings').get();
    const participantSnaps = await Promise.all(
      meetingsSnap.docs.map(m => m.ref.collection('participants').where('email', '==', emailLower).get())
    );
    const participantRefs = participantSnaps.flatMap(s => s.docs.map(d => d.ref));

    const { deleted, failedChunks } = await deleteRefsInBatches(
      [...keyedRefs, ...fieldRefs, ...participantRefs],
      { domain, email: emailLower }
    );
    log.info('firestore: deleted user + PII cascade', {
      domain, email: emailLower,
      events: eventsSnap.size, reminders: remindersSnap.size,
      reengagementSent: reengSnap.size, alertsSent: alertsSnap.size,
      shareLinks: shareSnap.size, feedback: feedbackSnap.size,
      participants: participantRefs.length, docsDeleted: deleted, failedChunks,
    });
    return { ok: failedChunks === 0 };
  } catch (err) {
    log.error('firestore: deleteUser failed', { domain, email: emailLower, error: err.message });
    return { ok: false };
  }
}

// deleteRefsInBatches is exported for direct unit testing of its batch-chunk
// failure handling; firestore.js only re-exports deleteUser.
// Remove the tombstone when a deleted user signs up again. Without this, the
// stale marker + a transient getUser read failure would hard-401 a live,
// legitimately re-registered user with "This account was deleted."
async function clearDeletedTombstone(domain, email) {
  try {
    await tenantRef(domain).collection('deletedUsers').doc(deletedUserDocId(email)).delete();
  } catch (err) {
    log.warn('firestore: clearDeletedTombstone failed', { domain, error: err.message });
  }
}

module.exports = { deleteUser, deleteRefsInBatches, isUserDeleted, clearDeletedTombstone };
