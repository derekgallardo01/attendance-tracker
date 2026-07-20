const { getDb, tenantRef, FieldValue, log } = require('./_core');

// Evaluate per-series attendance rules for one user and return the alerts that
// should fire today. Pure read — caller is responsible for idempotency and the
// actual email send. Two hardcoded rules:
//   - streak: someone missed the last 3 instances after attending 5+ of the
//     preceding 8 (reliable attendee suddenly went dark)
//   - threshold: avg of last 8 dropped to <50% from ≥80% in the prior 8 (slow
//     fade we want to catch before they fully disengage)
async function evaluateSeriesAlerts(domain, email) {
  try {
    const tenant = tenantRef(domain);
    const emailLower = email.toLowerCase();

    const [eventsSnap, meetingsSnap] = await Promise.all([
      tenant.collection('events').where('email', '==', emailLower).where('type', '==', 'tracked').get(),
      tenant.collection('meetings').get(),
    ]);

    const trackedIds = new Set();
    for (const d of eventsSnap.docs) {
      const cid = d.data().meta?.conferenceId;
      if (cid) trackedIds.add(cid);
    }
    const useFilter = trackedIds.size > 0;

    const seriesMeetings = meetingsSnap.docs
      .filter(d => {
        const data = d.data();
        if (!data.recurringEventId) return false;
        if (useFilter && !trackedIds.has(d.id)) return false;
        return true;
      })
      .map(d => ({ id: d.id, ref: d.ref, data: d.data() }));

    if (seriesMeetings.length < 6) return []; // streak rule needs 6+, threshold needs 16+

    // Pull participants for every series meeting in parallel.
    const participantSnaps = await Promise.all(seriesMeetings.map(m => m.ref.collection('participants').get()));
    const partsByMeetingId = new Map();
    for (let i = 0; i < seriesMeetings.length; i++) {
      partsByMeetingId.set(seriesMeetings[i].id, participantSnaps[i].docs.map(p => p.data()));
    }

    // Group by recurringEventId.
    const bySeries = new Map();
    for (const m of seriesMeetings) {
      const sid = m.data.recurringEventId;
      let arr = bySeries.get(sid);
      if (!arr) { arr = []; bySeries.set(sid, arr); }
      arr.push(m);
    }

    const alerts = [];

    for (const [sid, meetings] of bySeries) {
      if (meetings.length < 6) continue;

      // Sort oldest-first so timeline indices map to chronological order.
      meetings.sort((a, b) => {
        const aT = a.data.startTime?.toDate?.()?.getTime() || a.data.createdAt?.toDate?.()?.getTime() || 0;
        const bT = b.data.startTime?.toDate?.()?.getTime() || b.data.createdAt?.toDate?.()?.getTime() || 0;
        return aT - bT;
      });

      // Build per-person attendance timeline keyed by email-or-name.
      const peopleTimeline = new Map();
      for (let i = 0; i < meetings.length; i++) {
        const parts = partsByMeetingId.get(meetings[i].id) || [];
        for (const p of parts) {
          const e = (p.email || '').toLowerCase();
          const n = p.displayName || '';
          const key = e || `name:${n.toLowerCase()}`;
          if (!key || key === 'name:') continue;
          let entry = peopleTimeline.get(key);
          if (!entry) {
            entry = { email: e || null, displayName: n, attendance: new Array(meetings.length).fill(false) };
            peopleTimeline.set(key, entry);
          }
          entry.attendance[i] = true;
          if (n && n.length > (entry.displayName || '').length) entry.displayName = n;
        }
      }

      const seriesTitle = meetings[meetings.length - 1].data.title || 'Recurring meeting';

      for (const [, p] of peopleTimeline) {
        const t = p.attendance;
        const n = t.length;
        const totalAttended = t.filter(Boolean).length;

        // Streak: last 3 false AND 5+ of the prior 8 true.
        if (n >= 6) {
          const last3 = t.slice(n - 3);
          if (last3.every(x => !x)) {
            const preceding = t.slice(Math.max(0, n - 11), n - 3);
            const trueCount = preceding.filter(Boolean).length;
            if (trueCount >= 5) {
              alerts.push({
                type: 'streak',
                seriesTitle,
                recurringEventId: sid,
                personName: p.displayName,
                personEmail: p.email,
                detail: `missed the last 3 of "${seriesTitle}"`,
                attended: totalAttended,
                instanceCount: n,
              });
              continue; // don't double-alert on threshold rule for the same person/series
            }
          }
        }

        // Threshold: rate of last 8 <50% AND prior 8 was ≥80%.
        if (n >= 16) {
          const last8 = t.slice(n - 8);
          const prev8 = t.slice(n - 16, n - 8);
          const lastRate = last8.filter(Boolean).length / 8;
          const prevRate = prev8.filter(Boolean).length / 8;
          if (lastRate < 0.5 && prevRate >= 0.8) {
            alerts.push({
              type: 'threshold',
              seriesTitle,
              recurringEventId: sid,
              personName: p.displayName,
              personEmail: p.email,
              detail: `attendance dropped from ${Math.round(prevRate * 100)}% to ${Math.round(lastRate * 100)}% in "${seriesTitle}"`,
              attended: totalAttended,
              instanceCount: n,
            });
          }
        }
      }
    }

    return alerts;
  } catch (err) {
    log.error('firestore: evaluateSeriesAlerts failed', { domain, email, error: err.message });
    return [];
  }
}

// Evaluate user-state re-engagement reminders. Different from series alerts
// (which fire on attendee behavior) — these fire on the *user's own* lapse
// patterns: "you signed up but stopped using it" / "you tracked this every
// week and missed one". Each reminder type has its own dedup key so a 7-day
// reactivation can fire alongside a forgotten-meeting nudge without conflict.
async function evaluateReengagementForUser(domain, email) {
  try {
    const tenant = tenantRef(domain);
    const emailLower = email.toLowerCase();

    const [userDoc, eventsSnap] = await Promise.all([
      tenant.collection('users').doc(emailLower).get(),
      tenant.collection('events').where('email', '==', emailLower).get(),
    ]);
    if (!userDoc.exists) return [];

    const user = userDoc.data();
    const lastLogin = user.lastLoginAt?.toDate?.()?.getTime() || 0;
    const now = Date.now();
    const reminders = [];

    // ── Engagement quality gate ──
    // Only spend a warm "we miss you" reactivation on users who actually got
    // value: they exported at least once, OR tracked a meeting with other
    // people (participantCount >= 2). Raw tracked-event count is NOT a signal —
    // the poll loop emits a 'tracked' event every ~15s, so a single solo test
    // inflates it to dozens. Solo-only self-tests (participantCount<=1, no
    // export) are low intent; we don't reactivate them. Never-tracked signups
    // get a different, activation-focused nudge instead.
    const exportedCount = eventsSnap.docs.filter(d => d.data().type === 'exported').length;
    const trackedDocs = eventsSnap.docs.filter(d => d.data().type === 'tracked');
    // Real-meeting signal = distinct human attendees. Prefer the deduped
    // distinctAttendees stamped on newer events; fall back to raw
    // participantCount for events logged before we tracked it.
    const maxDistinctAttendees = Math.max(0, ...trackedDocs.map(d => {
      const m = d.data().meta || {};
      return m.distinctAttendees != null ? m.distinctAttendees : (m.participantCount || 0);
    }));
    const everTracked = trackedDocs.length > 0;
    const activated = exportedCount >= 1 || maxDistinctAttendees >= 2;

    if (lastLogin) {
      const daysSinceLogin = Math.floor((now - lastLogin) / 86400000);
      // Narrow firing windows so the daily cron doesn't double-fire if a user
      // sat at "lapsed for X days" for a stretch — we want one shot per lapse.
      const window7 = daysSinceLogin >= 7 && daysSinceLogin < 14;
      const window30 = daysSinceLogin >= 30 && daysSinceLogin < 45;
      if (activated) {
        // Got real value → warm win-back (with a 30-day follow-up).
        if (window7) reminders.push({ type: 'reactivation_7d', daysSinceLogin });
        else if (window30) reminders.push({ type: 'reactivation_30d', daysSinceLogin });
      } else if (window7) {
        // Not activated. Two sub-segments, each with tailored copy:
        //  - tried it but only on a solo test → coach them to use it for real.
        //  - never tracked at all → basic activation how-to.
        // Solo testers are high-intent (they learned the tool), just in a fake
        // context, so they get their own nudge rather than nothing.
        reminders.push({ type: everTracked ? 'solo_nudge_7d' : 'activation_7d', daysSinceLogin });
      }
    }

    // Forgotten recurring meeting: user tracked a series 3+ times in past 30d,
    // but hasn't tracked it in 7+ days. Catches lapsed habits before they die.
    const trackedEvents = eventsSnap.docs
      .filter(d => d.data().type === 'tracked')
      .map(d => ({
        conferenceId: d.data().meta?.conferenceId || null,
        at: d.data().createdAt?.toDate?.()?.getTime() || 0,
      }))
      .filter(e => e.conferenceId);

    if (trackedEvents.length >= 3) {
      const meetingsSnap = await tenant.collection('meetings').get();
      const cidToRid = new Map();
      const ridToTitle = new Map();
      for (const m of meetingsSnap.docs) {
        const d = m.data();
        if (d.recurringEventId) {
          cidToRid.set(m.id, d.recurringEventId);
          const existing = ridToTitle.get(d.recurringEventId) || '';
          if (d.title && d.title.length > existing.length) ridToTitle.set(d.recurringEventId, d.title);
        }
      }

      const bySeries = new Map();
      for (const ev of trackedEvents) {
        const rid = cidToRid.get(ev.conferenceId);
        if (!rid) continue;
        if (!bySeries.has(rid)) bySeries.set(rid, []);
        bySeries.get(rid).push(ev.at);
      }

      const THIRTY_DAYS = 30 * 86400000;
      const SEVEN_DAYS = 7 * 86400000;
      const TEN_DAYS = 10 * 86400000;
      for (const [rid, times] of bySeries) {
        const past30 = times.filter(t => t > now - THIRTY_DAYS);
        if (past30.length < 3) continue;
        const lastTrack = Math.max(...times);
        const sinceLast = now - lastTrack;
        // 3-day catch window so we fire exactly once per lapse (daily cron
        // gives 3 chances within 7-10 days; once we claim, we skip the rest).
        if (sinceLast < SEVEN_DAYS || sinceLast >= TEN_DAYS) continue;
        reminders.push({
          type: 'forgotten_meeting',
          recurringEventId: rid,
          seriesTitle: ridToTitle.get(rid) || 'a recurring meeting',
          trackedInWindow: past30.length,
          daysSinceLast: Math.floor(sinceLast / 86400000),
        });
      }
    }

    return reminders;
  } catch (err) {
    log.error('firestore: evaluateReengagementForUser failed', { domain, email, error: err.message });
    return [];
  }
}

// Atomic per-(user, key) dedup for re-engagement reminders. Different from
// claimDailyAlertSlot — that one is per-day, this one is permanent (fire
// each kind of reminder once per user per dedup key, never again).
async function claimReengagementSlot(domain, email, dedupKey) {
  const id = `${email.toLowerCase()}__${dedupKey}`;
  const ref = tenantRef(domain).collection('reengagementSent').doc(id);
  try {
    await ref.create({
      email: email.toLowerCase(),
      domain,
      dedupKey,
      claimedAt: FieldValue.serverTimestamp(),
    });
    return { claimed: true, ref };
  } catch (err) {
    if (err.code === 6) return { claimed: false }; // ALREADY_EXISTS
    log.warn('firestore: claimReengagementSlot failed', { domain, email, dedupKey, error: err.message });
    return { claimed: false };
  }
}

// Atomically claim today's alert slot for a user. Returns true if claimed
// (caller should evaluate + send), false if already claimed today (skip).
// Uses Firestore create() which throws on existing doc — that throw IS the lock.
async function claimDailyAlertSlot(domain, email) {
  const today = new Date().toISOString().slice(0, 10);
  const id = `${today}-${email.toLowerCase()}`;
  const ref = tenantRef(domain).collection('alertsSent').doc(id);
  try {
    await ref.create({
      email: email.toLowerCase(),
      domain,
      claimedAt: FieldValue.serverTimestamp(),
    });
    return { claimed: true, ref };
  } catch (err) {
    // gRPC code 6 = ALREADY_EXISTS — expected race / replay
    if (err.code === 6) return { claimed: false };
    log.warn('firestore: claimDailyAlertSlot failed', { domain, email, error: err.message });
    return { claimed: false };
  }
}

// Update the alertsSent doc with the email payload after a successful send.
// Best-effort; never throws into the caller.
async function recordAlertsSent(ref, alerts) {
  try {
    await ref.set({
      alertCount: alerts.length,
      alerts,
      emailSentAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (err) {
    log.warn('firestore: recordAlertsSent failed', { error: err.message });
  }
}

module.exports = { evaluateSeriesAlerts, evaluateReengagementForUser, claimReengagementSlot, claimDailyAlertSlot, recordAlertsSent };
