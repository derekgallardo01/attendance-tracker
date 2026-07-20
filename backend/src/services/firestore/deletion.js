const { getDb, tenantRef, FieldValue, log } = require('./_core');

// Delete an array of DocumentReferences in batches under Firestore's 500-op
// limit. Best-effort per chunk; logs and continues on a chunk failure so a
// single bad ref can't abort the whole cascade.
async function deleteRefsInBatches(refs, ctx = {}) {
  let deleted = 0;
  for (let i = 0; i < refs.length; i += 450) {
    const chunk = refs.slice(i, i + 450);
    const batch = getDb().batch();
    for (const ref of chunk) batch.delete(ref);
    try {
      await batch.commit();
      deleted += chunk.length;
    } catch (err) {
      log.warn('firestore: batch delete failed', { ...ctx, error: err.message });
    }
  }
  return deleted;
}

// Delete a user and cascade every record that carries their PII, for
// Marketplace / GDPR data-deletion compliance. We purge:
//   users/{email}, userSettings/{email}, adminNotes/{email}, outreach/{email}
//   events, reminders, reengagementSent, alertsSent  (where email == user)
//   participant docs across meetings where the participant IS this user
// We deliberately do NOT delete meetings/{conferenceId} — those are
// tenant-owned org records keyed by conference, not by one user; deleting them
// would erase other attendees' data. Meetings are scrubbed of this user's
// participant sub-doc instead.
async function deleteUser(domain, email) {
  const emailLower = email.toLowerCase();
  const tenant = tenantRef(domain);
  try {
    // 1) Docs keyed directly by the user's email.
    const keyedRefs = [
      tenant.collection('users').doc(emailLower),
      tenant.collection('userSettings').doc(emailLower),
      tenant.collection('adminNotes').doc(emailLower),
      tenant.collection('outreach').doc(emailLower),
    ];

    // 2) Collections that store the email as a field — query then delete.
    const [eventsSnap, remindersSnap, reengSnap, alertsSnap] = await Promise.all([
      tenant.collection('events').where('email', '==', emailLower).get(),
      tenant.collection('reminders').where('email', '==', emailLower).get(),
      tenant.collection('reengagementSent').where('email', '==', emailLower).get(),
      tenant.collection('alertsSent').where('email', '==', emailLower).get(),
    ]);
    const fieldRefs = [
      ...eventsSnap.docs, ...remindersSnap.docs, ...reengSnap.docs, ...alertsSnap.docs,
    ].map(d => d.ref);

    // 3) Participant sub-docs where this user is the attendee. Scan the tenant's
    //    meetings, then their participants, matching on the participant email.
    const meetingsSnap = await tenant.collection('meetings').get();
    const participantSnaps = await Promise.all(
      meetingsSnap.docs.map(m => m.ref.collection('participants').where('email', '==', emailLower).get())
    );
    const participantRefs = participantSnaps.flatMap(s => s.docs.map(d => d.ref));

    const deleted = await deleteRefsInBatches(
      [...keyedRefs, ...fieldRefs, ...participantRefs],
      { domain, email: emailLower }
    );
    log.info('firestore: deleted user + PII cascade', {
      domain, email: emailLower,
      events: eventsSnap.size, reminders: remindersSnap.size,
      reengagementSent: reengSnap.size, alertsSent: alertsSnap.size,
      participants: participantRefs.length, docsDeleted: deleted,
    });
  } catch (err) {
    log.error('firestore: deleteUser failed', { domain, email: emailLower, error: err.message });
  }
}

// deleteRefsInBatches is exported for direct unit testing of its batch-chunk
// failure handling; firestore.js only re-exports deleteUser.
module.exports = { deleteUser, deleteRefsInBatches };
