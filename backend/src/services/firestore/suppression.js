const { getDb, FieldValue, log } = require('./_core');

// ── Email suppression (CAN-SPAM one-click unsubscribe) ──
// Root collection keyed by lowercased email so a single unsubscribe covers a
// person across every tenant they belong to. Checked before any promotional /
// lifecycle send.
async function suppressEmail(email, meta = {}) {
  try {
    await getDb().collection('suppression').doc(email.toLowerCase()).set({
      email: email.toLowerCase(),
      suppressedAt: FieldValue.serverTimestamp(),
      ...meta,
    }, { merge: true });
    log.info('firestore: email suppressed', { email: email.toLowerCase(), source: meta.source || null });
    return true;
  } catch (err) {
    log.error('firestore: suppressEmail failed', { email, error: err.message });
    return false;
  }
}

async function isEmailSuppressed(email) {
  try {
    const doc = await getDb().collection('suppression').doc(email.toLowerCase()).get();
    return doc.exists;
  } catch (err) {
    // Fail open on read error — better to risk one extra email than to silently
    // drop legitimate alerts because Firestore hiccuped.
    log.warn('firestore: isEmailSuppressed failed', { email, error: err.message });
    return false;
  }
}

// Remove a suppression record — the user re-opted into lifecycle emails from
// the in-product notification preferences.
async function unsuppressEmail(email) {
  try {
    await getDb().collection('suppression').doc(email.toLowerCase()).delete();
    return true;
  } catch (err) {
    log.warn('firestore: unsuppressEmail failed', { email, error: err.message });
    return false;
  }
}

module.exports = { suppressEmail, isEmailSuppressed, unsuppressEmail };
