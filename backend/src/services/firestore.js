const {
  FieldValue, log,
  PERSONAL_EMAIL_DOMAINS, SUPER_ADMIN_EMAIL,
  encryptToken, decryptToken,
  getDb, memoizeTTL, tenantRef, lastSegment, countDistinctAttendees, weeklyStreak, tsMs, domainOf,
} = require('./firestore/_core');
const { createShareLink, resolveShareLink, getSharedSeriesView } = require('./firestore/shareLinks');
const { evaluateSeriesAlerts, evaluateReengagementForUser, claimReengagementSlot, claimDailyAlertSlot, recordAlertsSent } = require('./firestore/reengagement');
const { suppressEmail, isEmailSuppressed, unsuppressEmail } = require('./firestore/suppression');
const { deleteUser } = require('./firestore/deletion');
const {
  getActivationFunnel, getAggregatedInsights, getWeeklySelfReport, getAdvancedAnalytics, getUserDetail, computeHealthScore, setAdminNote, searchAdminNotes, appendConversation, setOutreachStatus, markUserContacted, createReminder, markReminderDone, getDueReminders, getEmailTemplates, setEmailTemplates, getRecentActivity, getReachOutSuggestions, getPowerUserPipeline, getOutreachList,
} = require('./firestore/analytics');

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
    const ref = tenantRef(domain);
    const existing = await ref.get();
    const patch = {
      domain,
      ...config,
      updatedAt: FieldValue.serverTimestamp(),
    };
    // Only stamp createdAt on first write (or backfill a legacy doc missing it).
    // The previous unconditional write reset it on every config merge.
    if (!existing.exists || !existing.data()?.createdAt) {
      patch.createdAt = FieldValue.serverTimestamp();
    }
    await ref.set(patch, { merge: true });
    log.info('firestore: upserted tenant config', { domain });
  } catch (err) {
    log.error('firestore: upsertTenantConfig failed', { domain, error: err.message });
  }
}

// ── Billing / plan (per-domain) ──
// The Pro subscription is billed per Workspace domain; the plan state is written
// by the Stripe webhook and read to gate team features.
async function setTenantPlan(domain, patch) {
  try {
    await tenantRef(domain).set({
      domain,
      ...patch, // e.g. { plan:'pro', billingStatus:'active', stripeCustomerId, stripeSubscriptionId }
      planUpdatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    log.info('firestore: set tenant plan', { domain, plan: patch.plan, status: patch.billingStatus });
  } catch (err) {
    // Rethrow: the Stripe webhook is the only caller and it MUST see this fail so
    // it returns 500 and Stripe redelivers the event. Swallowing here would ack
    // the event 200 with the plan never written — a charged customer stuck on the
    // wrong plan with no retry.
    log.error('firestore: setTenantPlan failed', { domain, error: err.message });
    throw err;
  }
}

async function getTenantPlan(domain) {
  // Read the tenant doc directly rather than via getTenantConfig, which swallows
  // read errors and returns null. A genuine Firestore read error MUST propagate
  // so requireProPlan/planIsPro can catch it and ride the last-known-plan cache —
  // otherwise a transient blip silently downgrades a paying customer to Free.
  const doc = await tenantRef(domain).get();
  const cfg = doc.exists ? doc.data() : null;
  return {
    plan: cfg?.plan === 'pro' ? 'pro' : 'free',
    billingStatus: cfg?.billingStatus || null,
    stripeCustomerId: cfg?.stripeCustomerId || null,
  };
}

// ── Team-admin self-serve claim / transfer ──
// teamAdmin controls the org dashboard AND per-domain billing, so this is
// deliberately conservative: personal-email tenants (shared gmail.com etc.)
// never get an admin, an existing admin can't be silently overtaken (only
// vacant claims + admin-initiated transfers are allowed), and both writes run
// in a transaction so two racing claims can't split the role.

async function getTeamAdminStatus(domain, email) {
  const domainLower = (domain || '').toLowerCase();
  const isPersonalDomain = PERSONAL_EMAIL_DOMAINS.has(domainLower);
  const cfg = await getTenantConfig(domain);
  const adminEmail = cfg?.adminEmail?.toLowerCase?.() || null;
  const emailLower = (email || '').toLowerCase();
  const isTeamAdmin = !!adminEmail && adminEmail === emailLower;
  // Claimable when it's a real Workspace domain and the seat is vacant (or the
  // caller already holds it — idempotent).
  const canClaim = !isPersonalDomain && (!adminEmail || isTeamAdmin);
  return { isTeamAdmin, adminEmail, isPersonalDomain, canClaim };
}

async function claimTeamAdmin(domain, email) {
  const domainLower = (domain || '').toLowerCase();
  if (PERSONAL_EMAIL_DOMAINS.has(domainLower)) return { claimed: false, reason: 'personal_domain' };
  const emailLower = email.toLowerCase();
  try {
    const tenant = tenantRef(domain);
    const userRef = tenant.collection('users').doc(emailLower);
    return await getDb().runTransaction(async (tx) => {
      const [tenantDoc, userDoc] = await Promise.all([tx.get(tenant), tx.get(userRef)]);
      if (!userDoc.exists) return { claimed: false, reason: 'no_user' };
      const currentAdmin = tenantDoc.exists ? (tenantDoc.data().adminEmail?.toLowerCase?.() || null) : null;
      if (currentAdmin && currentAdmin !== emailLower) {
        return { claimed: false, reason: 'taken', adminEmail: currentAdmin };
      }
      const now = FieldValue.serverTimestamp();
      tx.set(tenant, { domain, adminEmail: emailLower, updatedAt: now }, { merge: true });
      tx.set(userRef, { teamAdmin: true, updatedAt: now }, { merge: true });
      return { claimed: true, adminEmail: emailLower };
    });
  } catch (err) {
    log.error('firestore: claimTeamAdmin failed', { domain, email, error: err.message });
    return { claimed: false, reason: 'error' };
  }
}

async function transferTeamAdmin(domain, fromEmail, toEmail) {
  const domainLower = (domain || '').toLowerCase();
  if (PERSONAL_EMAIL_DOMAINS.has(domainLower)) return { transferred: false, reason: 'personal_domain' };
  const fromLower = (fromEmail || '').toLowerCase();
  const toLower = (toEmail || '').toLowerCase();
  if (!toLower || toLower === fromLower) return { transferred: false, reason: 'invalid_target' };
  try {
    const tenant = tenantRef(domain);
    const fromRef = tenant.collection('users').doc(fromLower);
    const toRef = tenant.collection('users').doc(toLower);
    return await getDb().runTransaction(async (tx) => {
      const [tenantDoc, toDoc] = await Promise.all([tx.get(tenant), tx.get(toRef)]);
      const currentAdmin = tenantDoc.exists ? (tenantDoc.data().adminEmail?.toLowerCase?.() || null) : null;
      if (currentAdmin !== fromLower) return { transferred: false, reason: 'not_admin' };
      if (!toDoc.exists) return { transferred: false, reason: 'no_target_user' };
      const now = FieldValue.serverTimestamp();
      tx.set(tenant, { adminEmail: toLower, updatedAt: now }, { merge: true });
      tx.set(toRef, { teamAdmin: true, updatedAt: now }, { merge: true });
      tx.set(fromRef, { teamAdmin: false, updatedAt: now }, { merge: true });
      return { transferred: true, adminEmail: toLower };
    });
  } catch (err) {
    log.error('firestore: transferTeamAdmin failed', { domain, fromEmail, toEmail, error: err.message });
    return { transferred: false, reason: 'error' };
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
    const distinctAttendeeCount = countDistinctAttendees(participants);

    await meetingRef.set({
      conferenceId,
      recordName,
      participantCount: participants.length,
      distinctAttendeeCount, // unique humans (deduped by email/name) — activation signal
      startTime: joinTimes.length > 0 ? new Date(Math.min(...joinTimes)) : null,
      endTime: leaveTimes.length > 0 ? new Date(Math.max(...leaveTimes)) : null,
      lastFetchedAt: now,
      updatedAt: now,
      createdAt: now,
    }, { merge: true });

    // Chunk into batches under Firestore's 500-op limit — a very large meeting
    // (200+ participants) would otherwise exceed a single batch.
    const CHUNK = 450;
    for (let i = 0; i < participants.length; i += CHUNK) {
      const batch = getDb().batch();
      for (const p of participants.slice(i, i + CHUNK)) {
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
    }

    if (actorEmail) {
      logEvent(domain, {
        email: actorEmail,
        type: 'tracked',
        meta: { conferenceId, participantCount: participants.length, distinctAttendees: distinctAttendeeCount },
      });
    }

    log.info('firestore: persisted attendance', { domain, conferenceId, participants: participants.length });
  } catch (err) {
    log.error('firestore: persistAttendance failed', { domain, conferenceId, error: err.message });
  }
}

// Read the persisted "excused absentees" list for a meeting. Returns lowercased
// emails. Empty when the meeting doesn't exist yet or hasn't been tagged.
async function getMeetingExcusedEmails(domain, conferenceId) {
  if (!conferenceId) return [];
  try {
    const doc = await tenantRef(domain).collection('meetings').doc(conferenceId).get();
    if (!doc.exists) return [];
    return (doc.data().excusedEmails || []).map(e => (e || '').toLowerCase());
  } catch (err) {
    log.warn('firestore: getMeetingExcusedEmails failed', { domain, conferenceId, error: err.message });
    return [];
  }
}

// Append emails to a meeting's excusedEmails set. Uses arrayUnion so concurrent
// writes don't clobber each other, and lowercases on input so the set is a
// proper case-insensitive union.
async function addMeetingExcusedEmails(domain, conferenceId, emails) {
  if (!conferenceId || !emails?.length) return;
  try {
    await tenantRef(domain).collection('meetings').doc(conferenceId).set({
      excusedEmails: FieldValue.arrayUnion(...emails.map(e => (e || '').toLowerCase()).filter(Boolean)),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    log.warn('firestore: addMeetingExcusedEmails failed', { domain, conferenceId, error: err.message });
  }
}

async function persistCalendarData(domain, meetingCode, eventTitle, attendees, extras = {}) {
  try {
    const now = FieldValue.serverTimestamp();
    const meetingRef = tenantRef(domain).collection('meetings').doc(meetingCode);
    const patch = {
      conferenceId: meetingCode,
      title: eventTitle,
      calendarAttendees: attendees,
      updatedAt: now,
      createdAt: now,
    };
    // recurringEventId is the join key for the Series roll-up. Stored on the
    // meeting doc so getUserMeetingSeries() can aggregate without re-hitting
    // the Calendar API.
    if (extras.recurringEventId) patch.recurringEventId = extras.recurringEventId;
    if (extras.eventId) patch.eventId = extras.eventId;
    await meetingRef.set(patch, { merge: true });

    log.info('firestore: persisted calendar data', { domain, meetingCode, eventTitle, recurringEventId: extras.recurringEventId || null });
  } catch (err) {
    log.error('firestore: persistCalendarData failed', { domain, meetingCode, error: err.message });
  }
}

async function persistExport(domain, { meetingTitle, tabName, exportedAt, participantCount, sheetUrl, email, autoExport, recurringEventId, conferenceId }) {
  try {
    const now = FieldValue.serverTimestamp();

    await tenantRef(domain).collection('exports').add({
      meetingTitle,
      tabName,
      exportedAt,
      participantCount,
      sheetUrl,
      email: email ? email.toLowerCase() : null,
      autoExport: !!autoExport,
      // Series + conference identifiers — let getUserMeetingSeries() roll up
      // exports per recurring series without a join through meetings.
      recurringEventId: recurringEventId || null,
      conferenceId: conferenceId || null,
      createdAt: now,
    });

    if (email) {
      logEvent(domain, {
        email,
        type: 'exported',
        meta: { tabName, participantCount, autoExport: !!autoExport },
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

async function upsertUser(domain, { email, displayName, refreshToken, sheetId, acquisition, scopes, signupDetectedSource }) {
  try {
    const now = FieldValue.serverTimestamp();
    const emailLower = email.toLowerCase();
    const domainLower = (domain || '').toLowerCase();
    const data = {
      email: emailLower,
      domain,
      displayName,
      lastLoginAt: now,
      updatedAt: now,
      // createdAt is set below only on first write — see the isFirstSignin block.
      // Writing it here would reset signup age on every login and corrupt the
      // activation-funnel + health-score age inputs.
    };
    if (refreshToken !== undefined) data.refreshToken = encryptToken(refreshToken);
    if (sheetId !== undefined) data.sheetId = sheetId;
    // Persist granted OAuth scopes so we can diagnose why a user can track but
    // not export (the Drive scope is optional at consent and silently disables
    // Sheet export if unchecked). Refreshed on every sign-in.
    if (scopes) {
      if (Array.isArray(scopes.granted)) data.grantedScopes = scopes.granted;
      if (typeof scopes.exportScopeGranted === 'boolean') data.exportScopeGranted = scopes.exportScopeGranted;
      data.scopesUpdatedAt = now;
    }

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

    const userRef = tenantRef(domain).collection('users').doc(emailLower);
    const existing = await userRef.get();
    const isFirstSignin = !existing.exists;

    // Stamp createdAt only on the true first write (or backfill a legacy doc
    // that predates the field). Never overwrite it on subsequent logins.
    if (isFirstSignin || !existing.data()?.createdAt) data.createdAt = now;

    // First-touch acquisition: only stamp source/utm/referrer on the first
    // sign-in. landingUrl + userAgent are also first-touch because they
    // describe the browser/entry point at signup, not now.
    if (acquisition) {
      const hasSource = existing.exists && existing.data().acquisitionSource;
      const hasUserAgent = existing.exists && existing.data().userAgent;
      if (!hasSource) {
        if (acquisition.source) data.acquisitionSource = acquisition.source;
        if (acquisition.utmSource) data.utmSource = acquisition.utmSource;
        if (acquisition.utmMedium) data.utmMedium = acquisition.utmMedium;
        if (acquisition.utmCampaign) data.utmCampaign = acquisition.utmCampaign;
        if (acquisition.ref) data.referredBy = acquisition.ref; // who shared the ?ref= link
        if (acquisition.referrer) data.referrer = acquisition.referrer;
        data.acquisitionCapturedAt = now;
      }
      if (!hasUserAgent) {
        if (acquisition.userAgent) data.userAgent = acquisition.userAgent;
        if (acquisition.landingUrl) data.landingUrl = acquisition.landingUrl;
      }
    }

    // Team-admin auto-claim: the first user from a real Workspace domain
    // (not a personal-email provider where many strangers share a tenant)
    // becomes the team admin for that tenant. If the tenant doc already
    // designates an adminEmail (e.g. via the Marketplace install webhook),
    // only that exact email gets the flag — protects against random first-
    // signin if the Workspace admin signs up second.
    if (isFirstSignin && !PERSONAL_EMAIL_DOMAINS.has(domainLower)) {
      const tenantData = tenantDoc.exists ? tenantDoc.data() : null;
      const tenantAdminEmail = tenantData?.adminEmail?.toLowerCase?.() || null;
      if (!tenantAdminEmail) {
        // No admin yet — claim it and stamp the tenant doc so future
        // signins know who the admin is.
        data.teamAdmin = true;
        await tenantRef(domain).set({ adminEmail: emailLower, updatedAt: now }, { merge: true });
      } else if (tenantAdminEmail === emailLower) {
        // Tenant already designated this email as admin
        data.teamAdmin = true;
      }
    }

    // Signup notification is deferred, not fired here: we want it to carry the
    // user's self-reported source (from the "how did you find us?" modal, which
    // is answered a few seconds after signup) rather than the auto-detected
    // fallback. Stamp a pending marker + the detected source on the brand-new
    // user doc; a later trigger (modal answer / grace timer / sweep) flushes it
    // via claimSignupNotification. Only oauth passes signupDetectedSource, so
    // other callers never leave a user stuck pending.
    if (isFirstSignin && signupDetectedSource !== undefined) {
      data.signupNotifyPending = true;
      data.signupDetectedSource = signupDetectedSource || null;
    }

    // Referral loop: a brand-new user who arrived via a ?ref= invite gets a
    // pending marker so we credit + notify the inviter exactly once (claimed
    // from the same flush points as the signup notification). referredBy is
    // stamped first-touch in the acquisition block above.
    if (isFirstSignin && acquisition?.ref) {
      data.referralNotifyPending = true;
    }

    await userRef.set(data, { merge: true });
    log.info('firestore: upserted user', { domain, email, isFirstSignin, teamAdmin: !!data.teamAdmin });
  } catch (err) {
    log.error('firestore: upsertUser failed', { domain, email, error: err.message });
  }
}

// Current consecutive-week tracking streak for a user, from their 'tracked'
// events. Cheap single-collection read; drives the in-app retention chip.
async function getUserTrackingStreak(domain, email) {
  try {
    const snap = await tenantRef(domain).collection('events')
      .where('email', '==', email.toLowerCase()).where('type', '==', 'tracked').get();
    const ts = snap.docs.map(d => tsMs(d.data().createdAt)).filter(Boolean);
    return weeklyStreak(ts, Date.now());
  } catch (err) {
    log.warn('firestore: getUserTrackingStreak failed', { domain, email, error: err.message });
    return 0;
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

// Atomically claim a brand-new user's deferred signup notification. Returns the
// email payload (self-reported + auto-detected source) exactly once, then flips
// signupNotifyPending off so concurrent triggers (modal answer, grace timer,
// daily sweep) can't double-send. Returns null when there's nothing to send
// (no such user, or already notified). See notifications.maybeSendSignupNotification.
async function claimSignupNotification(domain, email) {
  try {
    const ref = tenantRef(domain).collection('users').doc(email.toLowerCase());
    return await getDb().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return null;
      const d = doc.data();
      if (d.signupNotifyPending !== true) return null;
      tx.set(ref, {
        signupNotifyPending: false,
        signupNotifiedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      return {
        email: d.email || email.toLowerCase(),
        displayName: d.displayName || '',
        domain,
        reportedSource: d.acquisitionSource || null,
        reportedDetail: d.acquisitionSourceDetail || null,
        detectedSource: d.signupDetectedSource || null,
      };
    });
  } catch (err) {
    log.error('firestore: claimSignupNotification failed', { domain, email, error: err.message });
    return null;
  }
}

// Atomically claim a referred user's pending referral notification (set when
// they arrived via a ?ref= invite). Returns { referredBy, newUserEmail,
// newUserName } once, then clears the flag; null if nothing pending. Mirrors
// claimSignupNotification. See notifications.maybeSendReferralNotification.
async function claimReferral(domain, email) {
  try {
    const ref = tenantRef(domain).collection('users').doc(email.toLowerCase());
    return await getDb().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return null;
      const d = doc.data();
      if (d.referralNotifyPending !== true) return null;
      // Clear the flag either way; only return a payload if there's an inviter.
      tx.set(ref, { referralNotifyPending: false, referralNotifiedAt: FieldValue.serverTimestamp() }, { merge: true });
      if (!d.referredBy) return null;
      return {
        referredBy: String(d.referredBy).toLowerCase(),
        newUserEmail: d.email || email.toLowerCase(),
        newUserName: d.displayName || '',
      };
    });
  } catch (err) {
    log.error('firestore: claimReferral failed', { domain, email, error: err.message });
    return null;
  }
}

// Max free-month reward coupons any single inviter can earn. Bounds the blast
// radius of referral farming (throwaway-account signups via a controlled
// ?ref=): attribution (referralCount) still accrues past the cap, but no
// further money-bearing coupons are minted. Tune as the referral program matures.
const REFERRAL_REWARD_CAP = 10;

// Credit the inviter for a successful referral: bump their referral count +
// reward accrual and log the referred user. Idempotent per referred-user so a
// retried flush can't double-credit. `rewardEligible` in the return says whether
// a coupon should be minted (first-time credit AND under the anti-farming cap).
// No-op-safe when the inviter never signed in (cross-domain invite to a stranger).
async function recordReferralForInviter(inviterEmail, { newUserEmail, rewardMonths = 1 }) {
  try {
    const inviterLower = (inviterEmail || '').toLowerCase();
    const inviterDomain = domainOf(inviterLower);
    if (!inviterDomain) return { inviterExists: false };
    const ref = tenantRef(inviterDomain).collection('users').doc(inviterLower);
    return await getDb().runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) return { inviterExists: false };
      const d = doc.data();
      const already = Array.isArray(d.referrals) && d.referrals.some(r => r.email === newUserEmail);
      const rewardEligible = !already && (d.referralRewardsEarned || 0) < REFERRAL_REWARD_CAP;
      if (!already) {
        const patch = {
          referralCount: FieldValue.increment(1),
          referrals: FieldValue.arrayUnion({ email: newUserEmail }),
          updatedAt: FieldValue.serverTimestamp(),
        };
        // Only accrue the money-bearing reward while under the cap.
        if (rewardEligible) patch.referralRewardsEarned = FieldValue.increment(rewardMonths);
        tx.set(ref, patch, { merge: true });
      }
      return {
        inviterExists: true,
        inviterDisplayName: d.displayName || '',
        totalReferrals: (d.referralCount || 0) + (already ? 0 : 1),
        already,
        rewardEligible,
      };
    });
  } catch (err) {
    log.error('firestore: recordReferralForInviter failed', { inviterEmail, error: err.message });
    return { inviterExists: false };
  }
}

// Record a minted referral promo code on the inviter's doc (for admin visibility
// + so we can see which rewards were issued). Best-effort; the code also lives
// in Stripe with referrer metadata.
async function recordReferralPromoCode(inviterEmail, code) {
  try {
    const inviterLower = (inviterEmail || '').toLowerCase();
    const inviterDomain = domainOf(inviterLower);
    if (!inviterDomain || !code) return;
    await tenantRef(inviterDomain).collection('users').doc(inviterLower).set({
      referralPromoCodes: FieldValue.arrayUnion(code),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    log.warn('firestore: recordReferralPromoCode failed', { inviterEmail, error: err.message });
  }
}

// ── Per-user settings (Slack webhook, future notification prefs, etc.) ──
// Lives under tenants/{domain}/userSettings/{email} so it's tenant-scoped
// like the rest of user data. Separate doc from the main user record
// because settings change shape over time and we don't want to bloat
// the user doc (which is read on every auth middleware pass).
async function getUserSettings(domain, email) {
  try {
    const doc = await tenantRef(domain).collection('userSettings').doc(email.toLowerCase()).get();
    return doc.exists ? doc.data() : {};
  } catch (err) {
    log.warn('firestore: getUserSettings failed', { domain, email, error: err.message });
    return {};
  }
}

// Merge a settings patch onto the user's settings doc. Caller is responsible
// for validating the patch (e.g. URL prefix check) — this just persists.
async function updateUserSettings(domain, email, patch) {
  try {
    await tenantRef(domain).collection('userSettings').doc(email.toLowerCase()).set({
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { saved: true };
  } catch (err) {
    log.error('firestore: updateUserSettings failed', { domain, email, error: err.message });
    throw err;
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
    // count() aggregation — server-side tally, doesn't stream every doc back.
    const agg = await tenantRef(domain).collection('events')
      .where('email', '==', email.toLowerCase())
      .where('type', '==', 'exported')
      .count().get();
    return agg.data().count;
  } catch (err) {
    log.warn('firestore: countUserExports failed', { domain, email, error: err.message });
    return 0;
  }
}

async function countAllUsers() {
  try {
    // count() aggregation instead of loading every user doc into memory.
    const agg = await getDb().collectionGroup('users').count().get();
    return agg.data().count;
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

// ── Per-user meeting history (Meetings / People / Calendar tabs) ──

// Returns everything the /history.html page needs in one shot:
//  - meetings:  meetings the user tracked, sorted newest first
//  - people:    aggregated participants across all those meetings
//  - calendar:  per-day meeting counts for the last 90 days
//
// We scope to the user's tenant for data isolation, then filter to meetings
// they have a 'tracked' event for (so two users in the same domain don't see
// each other's meetings). A user with no tracked events sees an empty list —
// we never fall back to "all meetings in the domain", because on shared tenants
// (every gmail.com user lands in one tenant) that would leak strangers' data.
async function getUserMeetingHistory(domain, email, { limit } = {}) {
  try {
    const tenant = tenantRef(domain);
    const emailLower = email.toLowerCase();

    const [eventsSnap, meetingsSnap] = await Promise.all([
      tenant.collection('events').where('email', '==', emailLower).where('type', '==', 'tracked').get(),
      tenant.collection('meetings').get(),
    ]);

    // Conference IDs the user has actually tracked. Always filter by this set —
    // if it's empty the user simply gets no meetings (see comment above).
    const trackedConferenceIds = new Set();
    for (const d of eventsSnap.docs) {
      const cid = d.data().meta?.conferenceId;
      if (cid) trackedConferenceIds.add(cid);
    }

    const filteredMeetings = meetingsSnap.docs
      .filter(d => trackedConferenceIds.has(d.id))
      .map(d => {
        const data = d.data();
        return {
          id: d.id,
          ref: d.ref,
          conferenceId: data.conferenceId || d.id,
          title: data.title || 'Untitled meeting',
          participantCount: data.participantCount || 0,
          startTime: tsMs(data.startTime) || null,
          endTime: tsMs(data.endTime) || null,
          createdAt: tsMs(data.createdAt) || null,
        };
      });

    // Newest-first, then apply the caller's cap (free tier) BEFORE reading
    // participants / building people + calendar — so ALL derived data reflects
    // only the visible meetings. Capping just the meetings array (as the route
    // used to) would leak the full per-person analytics + calendar density.
    filteredMeetings.sort((a, b) => (b.createdAt || b.startTime || 0) - (a.createdAt || a.startTime || 0));
    const totalTracked = filteredMeetings.length;
    const historyCapped = limit != null && totalTracked > limit;
    const visibleMeetings = historyCapped ? filteredMeetings.slice(0, limit) : filteredMeetings;

    // Pull all participants for the VISIBLE meetings in parallel. At ~7-15
    // users with <100 meetings each this is fine; if it gets heavy we paginate.
    const participantSnaps = await Promise.all(
      visibleMeetings.map(m => m.ref.collection('participants').get())
    );

    // ── Build the meetings array (drop the Firestore ref) ──
    const meetings = visibleMeetings
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
    // Denominator for attendanceRate = the number of meetings we aggregated
    // over (the visible set), NOT the true total — otherwise a capped free user
    // gets an understated rate.
    const visibleCount = visibleMeetings.length;
    const peopleMap = new Map();
    for (let i = 0; i < visibleMeetings.length; i++) {
      const m = visibleMeetings[i];
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
        const join = tsMs(data.joinTime);
        const leave = tsMs(data.leaveTime);
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
        attendanceRate: visibleCount > 0 ? (p.meetingCount / visibleCount) : 0,
        lastSeenAt: p.lastSeenAt ? new Date(p.lastSeenAt).toISOString() : null,
      }))
      .sort((a, b) => b.meetingCount - a.meetingCount);

    // ── Calendar grid: per-day counts for the last 90 days ──
    const DAY = 24 * 60 * 60 * 1000;
    const today = new Date();
    const calendar = [];
    const byDate = new Map();
    for (const m of visibleMeetings) {
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
      totalMeetings: totalTracked, // true count (for the stat + "see all N" CTA); the arrays above are capped
      ...(historyCapped ? { historyCapped: true, freeLimit: limit } : {}),
    };
  } catch (err) {
    log.error('firestore: getUserMeetingHistory failed', { domain, email, error: err.message });
    return { meetings: [], people: [], calendar: [], totalMeetings: 0 };
  }
}

// ── Team admin: tenant-wide aggregations ──
// All four functions below back the org-admin view on team.html. They return
// the same shape as the per-user equivalents (getUserMeetingHistory,
// getUserMeetingSeries) but scoped to one domain across every user — so a
// Workspace admin sees the whole org's attendance picture in one place.

async function getTenantUsers(domain) {
  try {
    const tenant = tenantRef(domain);
    const [usersSnap, eventsSnap] = await Promise.all([
      tenant.collection('users').get(),
      tenant.collection('events').get(),
    ]);
    // Pre-compute event counts per user so we can show tracked/exported in
    // the user table without a second query per user.
    const eventCounts = new Map();
    for (const d of eventsSnap.docs) {
      const data = d.data();
      const email = (data.email || '').toLowerCase();
      if (!email) continue;
      let counts = eventCounts.get(email);
      if (!counts) { counts = { tracked: 0, exported: 0, signins: 0 }; eventCounts.set(email, counts); }
      if (data.type === 'tracked') counts.tracked++;
      else if (data.type === 'exported') counts.exported++;
      else if (data.type === 'signin') counts.signins++;
    }
    return usersSnap.docs
      .map(d => {
        const data = d.data();
        const c = eventCounts.get(d.id) || { tracked: 0, exported: 0, signins: 0 };
        return {
          email: d.id,
          domain,
          displayName: data.displayName || null,
          teamAdmin: !!data.teamAdmin,
          lastLoginAt: data.lastLoginAt?.toDate?.()?.toISOString() || null,
          createdAt: data.createdAt?.toDate?.()?.toISOString() || null,
          acquisitionSource: data.acquisitionSource || null,
          tracked: c.tracked,
          exported: c.exported,
          signins: c.signins,
        };
      })
      .sort((a, b) => (new Date(b.lastLoginAt || 0)) - (new Date(a.lastLoginAt || 0)));
  } catch (err) {
    log.error('firestore: getTenantUsers failed', { domain, error: err.message });
    return [];
  }
}

async function getTenantMeetings(domain) {
  try {
    const tenant = tenantRef(domain);
    const meetingsSnap = await tenant.collection('meetings').get();
    const meetings = meetingsSnap.docs.map(d => ({ id: d.id, ref: d.ref, data: d.data() }));
    if (meetings.length === 0) return [];
    const partSnaps = await Promise.all(meetings.map(m => m.ref.collection('participants').get()));
    return meetings.map((m, i) => {
      const parts = partSnaps[i].docs.map(p => p.data());
      const presentNames = parts.filter(p => p.present).map(p => p.displayName).filter(Boolean);
      const startMs = tsMs(m.data.startTime) || null;
      const endMs = tsMs(m.data.endTime) || null;
      return {
        conferenceId: m.id,
        title: m.data.title || 'Untitled meeting',
        participantCount: parts.length || m.data.participantCount || 0,
        presentNames: presentNames.slice(0, 8),
        startTime: startMs ? new Date(startMs).toISOString() : null,
        endTime: endMs ? new Date(endMs).toISOString() : null,
        createdAt: m.data.createdAt?.toDate?.()?.toISOString() || null,
        durationMs: (startMs && endMs) ? (endMs - startMs) : null,
        recurringEventId: m.data.recurringEventId || null,
      };
    }).sort((a, b) => (new Date(b.startTime || b.createdAt || 0)) - (new Date(a.startTime || a.createdAt || 0)));
  } catch (err) {
    log.error('firestore: getTenantMeetings failed', { domain, error: err.message });
    return [];
  }
}

// Cross-user series view. Adapts getUserMeetingSeries by dropping the
// per-user trackedConferenceIds filter — every recurring meeting tracked by
// any user in the tenant rolls up here.
async function getTenantSeriesOverview(domain) {
  try {
    const tenant = tenantRef(domain);
    const meetingsSnap = await tenant.collection('meetings').get();
    const seriesMeetings = meetingsSnap.docs
      .filter(d => !!d.data().recurringEventId)
      .map(d => ({ id: d.id, ref: d.ref, data: d.data() }));
    if (seriesMeetings.length === 0) return [];
    const participantSnaps = await Promise.all(seriesMeetings.map(m => m.ref.collection('participants').get()));
    const seriesMap = new Map();
    for (let i = 0; i < seriesMeetings.length; i++) {
      const m = seriesMeetings[i];
      const sid = m.data.recurringEventId;
      let series = seriesMap.get(sid);
      if (!series) {
        series = {
          recurringEventId: sid,
          title: m.data.title || 'Recurring meeting',
          instanceCount: 0,
          firstAt: null, lastAt: null,
          peopleMap: new Map(),
        };
        seriesMap.set(sid, series);
      }
      series.instanceCount++;
      if (m.data.title && m.data.title.length > (series.title || '').length) series.title = m.data.title;
      const meetingStart = tsMs(m.data.startTime) || tsMs(m.data.createdAt) || null;
      if (meetingStart) {
        if (!series.firstAt || meetingStart < series.firstAt) series.firstAt = meetingStart;
        if (!series.lastAt || meetingStart > series.lastAt) series.lastAt = meetingStart;
      }
      const seen = new Set();
      for (const p of participantSnaps[i].docs) {
        const pdata = p.data();
        const e = (pdata.email || '').toLowerCase();
        const n = pdata.displayName || '';
        const key = e || `name:${n.toLowerCase()}`;
        if (!key || key === 'name:' || seen.has(key)) continue;
        seen.add(key);
        let person = series.peopleMap.get(key);
        if (!person) { person = { email: e || null, displayName: n, attended: 0 }; series.peopleMap.set(key, person); }
        person.attended++;
        if (n && n.length > person.displayName.length) person.displayName = n;
      }
    }
    return [...seriesMap.values()]
      .map(s => {
        const people = [...s.peopleMap.values()]
          .map(p => ({
            email: p.email,
            displayName: p.displayName || (p.email ? p.email.split('@')[0] : 'Unknown'),
            attended: p.attended,
            attendanceRate: s.instanceCount > 0 ? (p.attended / s.instanceCount) : 0,
          }))
          .sort((a, b) => b.attended - a.attended);
        return {
          recurringEventId: s.recurringEventId,
          title: s.title,
          instanceCount: s.instanceCount,
          uniquePeople: people.length,
          firstAt: s.firstAt ? new Date(s.firstAt).toISOString() : null,
          lastAt: s.lastAt ? new Date(s.lastAt).toISOString() : null,
          people,
        };
      })
      .sort((a, b) => (new Date(b.lastAt || 0)) - (new Date(a.lastAt || 0)));
  } catch (err) {
    log.error('firestore: getTenantSeriesOverview failed', { domain, error: err.message });
    return [];
  }
}

// Every participant (not just users) seen across the tenant's meetings, with
// cross-meeting attendance counts. Different from getTenantUsers — this
// includes external participants who joined org meetings but never signed up
// for the addon themselves.
async function getTenantPeopleOverview(domain) {
  try {
    const tenant = tenantRef(domain);
    const meetingsSnap = await tenant.collection('meetings').get();
    if (meetingsSnap.empty) return [];
    const meetings = meetingsSnap.docs.map(d => ({ id: d.id, ref: d.ref, data: d.data() }));
    const partSnaps = await Promise.all(meetings.map(m => m.ref.collection('participants').get()));
    const totalMeetings = meetings.length;
    const peopleMap = new Map();
    for (let i = 0; i < meetings.length; i++) {
      const m = meetings[i];
      const meetingDate = tsMs(m.data.startTime) || tsMs(m.data.createdAt) || 0;
      for (const p of partSnaps[i].docs) {
        const data = p.data();
        const email = (data.email || '').toLowerCase();
        const name = data.displayName || '';
        const key = email || `name:${name.toLowerCase()}`;
        if (!key || key === 'name:') continue;
        let entry = peopleMap.get(key);
        if (!entry) {
          entry = { key, email: email || null, displayName: name, meetingCount: 0, totalMinutes: 0, lastSeenAt: 0 };
          peopleMap.set(key, entry);
        }
        entry.meetingCount++;
        const join = tsMs(data.joinTime);
        const leave = tsMs(data.leaveTime);
        if (join && leave && leave > join) entry.totalMinutes += Math.round((leave - join) / 60000);
        if (meetingDate > entry.lastSeenAt) entry.lastSeenAt = meetingDate;
        if (!entry.displayName || (name && name.length > entry.displayName.length)) entry.displayName = name;
      }
    }
    return [...peopleMap.values()]
      .map(p => ({
        email: p.email,
        displayName: p.displayName,
        meetingCount: p.meetingCount,
        totalMinutes: p.totalMinutes,
        attendanceRate: totalMeetings > 0 ? (p.meetingCount / totalMeetings) : 0,
        lastSeenAt: p.lastSeenAt ? new Date(p.lastSeenAt).toISOString() : null,
      }))
      .sort((a, b) => b.meetingCount - a.meetingCount);
  } catch (err) {
    log.error('firestore: getTenantPeopleOverview failed', { domain, error: err.message });
    return [];
  }
}

// One-shot fetch for team.html — returns everything the page needs so it
// renders in a single round-trip. Counts come from the same source as the
// detail lists so they're guaranteed consistent.
async function getTeamOverview(domain) {
  try {
    const tenant = tenantRef(domain);
    const tenantDoc = await tenant.get();
    const [users, meetings, series, people] = await Promise.all([
      getTenantUsers(domain),
      getTenantMeetings(domain),
      getTenantSeriesOverview(domain),
      getTenantPeopleOverview(domain),
    ]);
    return {
      domain,
      adminEmail: tenantDoc.data()?.adminEmail || null,
      totals: {
        users: users.length,
        meetings: meetings.length,
        series: series.length,
        people: people.length,
      },
      users,
      meetings,
      series,
      people,
    };
  } catch (err) {
    log.error('firestore: getTeamOverview failed', { domain, error: err.message });
    return null;
  }
}

// ── Recurring-meeting series roll-up ──
// Groups the user's tracked meetings by Calendar's recurringEventId so they can
// see "Daily Standup: Alex attended 12/15, avg arrival +4 min late". Only
// meetings with a recurringEventId roll up — instant meetings stay out of this
// view (grouping by title alone produces too many false matches).
async function getUserMeetingSeries(domain, email) {
  try {
    const tenant = tenantRef(domain);
    const emailLower = email.toLowerCase();

    const [eventsSnap, meetingsSnap] = await Promise.all([
      tenant.collection('events').where('email', '==', emailLower).where('type', '==', 'tracked').get(),
      tenant.collection('meetings').get(),
    ]);

    // Same tracked-by-this-user filter as getUserMeetingHistory: only count
    // meetings the user has actually tracked. No eventless fallback — an
    // untracked user gets an empty series list rather than the domain's data.
    const trackedIds = new Set();
    for (const d of eventsSnap.docs) {
      const cid = d.data().meta?.conferenceId;
      if (cid) trackedIds.add(cid);
    }

    const seriesMeetings = meetingsSnap.docs
      .filter(d => {
        const data = d.data();
        if (!data.recurringEventId) return false; // skip non-recurring meetings
        if (!trackedIds.has(d.id)) return false;
        return true;
      })
      .map(d => ({ id: d.id, ref: d.ref, data: d.data() }));

    if (seriesMeetings.length === 0) {
      return { series: [], totalSeries: 0 };
    }

    // Pull participants in parallel for every series meeting. Each meeting is
    // a Firestore subcollection read; the count stays small because we already
    // filtered to recurring-only.
    const participantSnaps = await Promise.all(
      seriesMeetings.map(m => m.ref.collection('participants').get())
    );

    // Group meetings into series — keyed by recurringEventId.
    const seriesMap = new Map();
    for (let i = 0; i < seriesMeetings.length; i++) {
      const m = seriesMeetings[i];
      const data = m.data;
      const recurringEventId = data.recurringEventId;
      let series = seriesMap.get(recurringEventId);
      if (!series) {
        series = {
          recurringEventId,
          title: data.title || 'Recurring meeting',
          instanceCount: 0,
          firstAt: null,
          lastAt: null,
          totalParticipants: 0,
          peopleMap: new Map(),
        };
        seriesMap.set(recurringEventId, series);
      }
      series.instanceCount++;
      // Prefer the most descriptive title across instances
      if (data.title && data.title.length > (series.title || '').length) series.title = data.title;

      const meetingStart = tsMs(data.startTime) || tsMs(data.createdAt) || null;
      if (meetingStart) {
        if (!series.firstAt || meetingStart < series.firstAt) series.firstAt = meetingStart;
        if (!series.lastAt || meetingStart > series.lastAt) series.lastAt = meetingStart;
      }

      const meetingDurationMs = (data.startTime?.toDate && data.endTime?.toDate)
        ? (data.endTime.toDate().getTime() - data.startTime.toDate().getTime())
        : null;

      // Per-person aggregation: count meetings attended + sum minutes.
      const seenInThisMeeting = new Set();
      for (const p of participantSnaps[i].docs) {
        const pdata = p.data();
        const pEmail = (pdata.email || '').toLowerCase();
        const pName = pdata.displayName || '';
        const key = pEmail || `name:${pName.toLowerCase()}`;
        if (!key || key === 'name:') continue;
        if (seenInThisMeeting.has(key)) continue; // one count per meeting
        seenInThisMeeting.add(key);

        let person = series.peopleMap.get(key);
        if (!person) {
          person = { key, email: pEmail || null, displayName: pName, attended: 0, totalMinutes: 0 };
          series.peopleMap.set(key, person);
        }
        person.attended++;
        if (pName && pName.length > (person.displayName || '').length) person.displayName = pName;
        const join = tsMs(pdata.joinTime);
        const leave = tsMs(pdata.leaveTime);
        if (join && leave && leave > join) {
          person.totalMinutes += Math.round((leave - join) / 60000);
        } else if (meetingDurationMs && pdata.present) {
          person.totalMinutes += Math.round(meetingDurationMs / 60000);
        }
      }
      series.totalParticipants += seenInThisMeeting.size;
    }

    const series = [...seriesMap.values()]
      .map(s => {
        const people = [...s.peopleMap.values()]
          .map(p => ({
            email: p.email,
            displayName: p.displayName || (p.email ? p.email.split('@')[0] : 'Unknown'),
            attended: p.attended,
            missed: s.instanceCount - p.attended,
            attendanceRate: s.instanceCount > 0 ? (p.attended / s.instanceCount) : 0,
            totalMinutes: p.totalMinutes,
          }))
          .sort((a, b) => b.attended - a.attended || (a.displayName || '').localeCompare(b.displayName || ''));
        return {
          recurringEventId: s.recurringEventId,
          title: s.title,
          instanceCount: s.instanceCount,
          firstAt: s.firstAt ? new Date(s.firstAt).toISOString() : null,
          lastAt: s.lastAt ? new Date(s.lastAt).toISOString() : null,
          uniquePeople: people.length,
          avgAttendance: s.instanceCount > 0 ? Math.round(s.totalParticipants / s.instanceCount * 10) / 10 : 0,
          people,
        };
      })
      .sort((a, b) => (new Date(b.lastAt || 0)) - (new Date(a.lastAt || 0)));

    return { series, totalSeries: series.length };
  } catch (err) {
    log.error('firestore: getUserMeetingSeries failed', { domain, email, error: err.message });
    return { series: [], totalSeries: 0 };
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
    // Always filter — no eventless fallback (shared tenants would leak data).
    const meetings = meetingsSnap.docs
      .filter(d => trackedIds.has(d.id))
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
        const join = tsMs(data.joinTime) || null;
        const leave = tsMs(data.leaveTime) || null;
        const start = tsMs(meetings[i].data.startTime) || null;
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

// ── Delete user data (Marketplace compliance) ──

module.exports = {
  getDb,
  getTenantConfig, upsertTenantConfig,
  setTenantPlan, getTenantPlan,
  getTeamAdminStatus, claimTeamAdmin, transferTeamAdmin,
  countDistinctAttendees, getActivationFunnel,
  persistAttendance, persistCalendarData, persistExport,
  getMeetingExcusedEmails, addMeetingExcusedEmails,
  getUser, upsertUser, getUserSheetId, setUserSheetId, updateUserTokens,
  getUserSettings, updateUserSettings,
  setUserAcquisitionSource, claimSignupNotification,
  claimReferral, recordReferralForInviter, recordReferralPromoCode, getUserTrackingStreak,
  logEvent,
  getUserActivationStatus, countUserExports, countAllUsers,
  getUserMeetingHistory,
  getUserMeetingSeries,
  getTenantUsers, getTenantMeetings, getTenantSeriesOverview, getTenantPeopleOverview, getTeamOverview,
  evaluateSeriesAlerts, claimDailyAlertSlot, recordAlertsSent,
  evaluateReengagementForUser, claimReengagementSlot,
  createShareLink, resolveShareLink, getSharedSeriesView,
  getParticipantHistory, setParticipantNote, getParticipantNote,
  markUserContacted,
  getUserDetail, computeHealthScore, setAdminNote, searchAdminNotes,
  appendConversation, setOutreachStatus,
  suppressEmail, isEmailSuppressed, unsuppressEmail,
  createReminder, markReminderDone, getDueReminders,
  getEmailTemplates, setEmailTemplates,
  getAllUsersAcrossTenants,
  deleteUser,
  // ── Heavy full-DB admin reads: TTL-cached so a dashboard reload doesn't
  //    re-scan the whole users+events+meetings tree for each one. ──
  getAggregatedInsights: memoizeTTL(getAggregatedInsights, 120000),
  getAdvancedAnalytics: memoizeTTL(getAdvancedAnalytics, 120000),
  getWeeklySelfReport: memoizeTTL(getWeeklySelfReport, 120000),
  getReachOutSuggestions: memoizeTTL(getReachOutSuggestions, 120000),
  getPowerUserPipeline: memoizeTTL(getPowerUserPipeline, 120000),
  getOutreachList: memoizeTTL(getOutreachList, 120000),
  getRecentActivity: memoizeTTL(getRecentActivity, 60000),
};
