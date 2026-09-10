const { Router } = require('express');
const { google } = require('googleapis');
const { getMeetToken, makeJWT, loadServiceAccountKey } = require('../services/googleAuth');
const { meetGet, meetGetAll, participantIdentity, sessionsDurationMs } = require('../services/meetApi');
const CONFIG = require('../config');
const log = require('../lib/logger');
const { persistAttendance, getTenantConfig } = require('../services/firestore');
const { domainOf } = require('../services/firestore/_core'); // pure util; imported directly so test firestore-mocks needn't stub it

const router = Router();

// Hard cap on participants processed per attendance read. A pathologically
// large meeting (e.g. a 5,000-person webinar) otherwise (a) built a 5,000-object
// array in memory on every ~10s poll — ×concurrency it OOM-killed the 1Gi
// instance — and (b) fired one participantSessions call per participant, blowing
// Meet's 600/min/user quota → 429. Real classes are far under this; when we cap,
// the panel is told (`truncated`) so it can show "first N of M".
const MAX_PARTICIPANTS = Number(process.env.MAX_ATTENDANCE_PARTICIPANTS) || 500;

// A Meet API 429 (quota exhausted) — detected by the .status meetApi now
// attaches, with a message fallback for older/wrapped errors.
function isRateLimited(err) {
  return err && (err.status === 429 || /Meet API 429|RESOURCE_EXHAUSTED|rate limit/i.test(String(err.message || '')));
}

// Extract Google user ID from participant path (e.g., "conferenceRecords/.../participants/117409479685467143851")
function extractUserId(participantPath) {
  const parts = (participantPath || '').split('/');
  const id = parts[parts.length - 1];
  // Google user IDs are numeric strings; skip non-numeric (anonymous/phone participants)
  return /^\d+$/.test(id) ? id : null;
}

// Look up emails from Google Workspace Directory for participants missing emails
async function enrichEmails(participants, adminEmail) {
  const needsLookup = participants.filter(p => !p.email && extractUserId(p.participantId));
  log.info('enrichEmails called', { total: participants.length, needsLookup: needsLookup.length });
  if (needsLookup.length === 0) return;
  const resolvedAdmin = adminEmail || CONFIG.adminEmail;
  if (!resolvedAdmin) {
    log.info('no admin email configured, skipping directory enrichment');
    return;
  }

  try {
    // Use admin email for Directory API (requires Workspace admin privileges)
    const key = await loadServiceAccountKey();
    const dirAuth = new google.auth.JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/admin.directory.user.readonly'],
      subject: resolvedAdmin,
    });
    await dirAuth.authorize();
    const directory = google.admin({ version: 'directory_v1', auth: dirAuth });

    await Promise.all(needsLookup.map(async (p) => {
      const userId = extractUserId(p.participantId);
      log.info('directory lookup', { userId, displayName: p.displayName });
      try {
        // Try direct user ID lookup first
        const resp = await directory.users.get({ userKey: userId });
        log.info('directory lookup result', { userId, email: resp.data.primaryEmail });
        if (resp.data.primaryEmail) {
          p.email = resp.data.primaryEmail;
        }
      } catch (e) {
        // User not in this Workspace directory (external/personal account) — skip name search
        // to avoid false matches (e.g., "Derek" matching the wrong Workspace user)
        log.info('directory id lookup miss — external user', { userId, displayName: p.displayName, error: e.message });
      }
    }));

    log.info('directory email enrichment', { looked: needsLookup.length, found: needsLookup.filter(p => p.email).length });
  } catch (err) {
    log.warn('directory API unavailable, skipping email enrichment', { error: err.message });
  }
}

router.get('/attendance', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { conferenceId } = req.query;
  if (!conferenceId) return res.status(400).json({ error: 'conferenceId is required' });

  // Domain authorization: skip if ALLOWED_DOMAINS=* (public SaaS mode)
  const userDomain = req.user?.domain;
  if (userDomain && CONFIG.allowedDomains[0] !== '*' && !CONFIG.allowedDomains.includes(userDomain)) {
    log.warn('domain not authorized', { domain: userDomain, conferenceId });
    return res.status(403).json({ error: 'Your organization is not authorized to use this service.' });
  }

  try {
    // Try service account first (sees all participants including external guests).
    // Fall back to user OAuth token if delegation isn't configured for this org.
    const userDomainForTenant = req.user?.domain || 'default';
    const tenantConfig = await getTenantConfig(userDomainForTenant);
    const impersonateEmail = tenantConfig?.impersonateEmail || CONFIG.impersonateEmail;

    let token;
    let usingServiceAccount = false;
    // Only use service account if the impersonation email's domain matches the user's domain.
    // A service account impersonating user@domainA cannot see meetings from domainB.
    const impersonateDomain = impersonateEmail ? domainOf(impersonateEmail) : null;
    // Require an AUTHENTICATED user whose domain matches the impersonation target.
    // The old `!userDomain` disjunct let an UNAUTHENTICATED request fall through to
    // the service account impersonating the legacy admin (CONFIG.impersonateEmail)
    // — i.e. anyone could read that org's meeting attendance with no auth. Now an
    // anonymous request gets no SA token and 401s below (authenticated behavior is
    // unchanged: it was already `userDomain === impersonateDomain`).
    const shouldTryServiceAccount = impersonateEmail && userDomain && userDomain === impersonateDomain;
    if (shouldTryServiceAccount) {
      try {
        token = await getMeetToken(impersonateEmail);
        usingServiceAccount = true;
        log.info('using service account for Meet API', { impersonateEmail });
      } catch (saErr) {
        log.warn('service account failed, falling back to user OAuth', { error: saErr.message });
      }
    } else if (impersonateEmail && userDomain) {
      log.info('skipping service account — domain mismatch', { userDomain, impersonateDomain });
    }
    if (!token && req.user?.accessToken) {
      token = req.user.accessToken;
      log.info('using user OAuth for Meet API', { email: req.user.email });
    }
    if (!token) {
      return res.status(401).json({ error: 'No authentication available for Meet API. Admin setup may be required.' });
    }
    let records = [];

    try {
      const data = await meetGet(`conferenceRecords?filter=space.meeting_code%3D%22${conferenceId}%22`, token);
      records = data.conferenceRecords || [];
      log.info('records by meeting_code', { count: records.length });
    } catch (e) {
      log.warn('meeting_code filter failed', { error: e.message });
    }

    if (records.length === 0) {
      try {
        const spaceName = conferenceId.startsWith('spaces/') ? conferenceId : `spaces/${conferenceId}`;
        const encoded = encodeURIComponent(`space.name="${spaceName}"`);
        const data = await meetGet(`conferenceRecords?filter=${encoded}`, token);
        records = data.conferenceRecords || [];
        log.info('records by space.name', { count: records.length });
      } catch (e) {
        log.warn('space.name filter failed', { error: e.message });
      }
    }

    if (records.length === 0) {
      return res.json({ participants: [], message: 'No conference record yet — meeting may still be live.' });
    }

    // A REUSED meeting code (standing room link, recurring meeting) has one
    // record per past conference, returned NEWEST-FIRST by the API — the old
    // `records[records.length - 1]` therefore read the OLDEST conference and
    // showed an empty roster for the live one (a user watched an empty panel
    // for 46 minutes this way). Ordering-agnostic pick: the ongoing record
    // (no endTime) wins; otherwise the most recent startTime.
    const conferenceRecord = records.find(r => !r.endTime)
      || records.slice().sort((a, b) => new Date(b.startTime || 0) - new Date(a.startTime || 0))[0];
    log.info('using conference record', { name: conferenceRecord.name, ofRecords: records.length, ongoing: !conferenceRecord.endTime });
    const conferenceStartTime = conferenceRecord.startTime || null;
    const conferenceEndTime = conferenceRecord.endTime || null;

    const rawParticipants = await meetGetAll(`${conferenceRecord.name}/participants`, token, 'participants');
    const totalParticipants = rawParticipants.length;
    log.info('participants found', { count: totalParticipants });

    // A6: dedupe to DISTINCT people before capping. A churny meeting (people
    // dropping and rejoining) returns many participant records per person — one
    // 257-person webinar came back as 5,000 records, which OOM-killed the
    // instance and blew the Meet quota (one session call per record). Collapse
    // records to distinct identities using the SAME key as countDistinctAttendees
    // (_core.js) so the cap keeps real people, not reconnection noise. Anonymous
    // participants (no email AND no name) can't be safely merged — each stays
    // its own entry so a room full of anon guests isn't collapsed into one.
    const seen = new Map();
    let anonSeq = 0;
    for (const p of rawParticipants) {
      const idy = participantIdentity(p);
      const email = (idy.email || '').trim().toLowerCase();
      const rawName = (idy.displayName || '').trim().toLowerCase();
      // participantIdentity() returns the 'Unknown' sentinel for anonymous /
      // no-name participants — never merge those (a room of anon guests must not
      // collapse to one). Only real emails/names identify a person to dedupe.
      const name = rawName && rawName !== 'unknown' ? rawName : '';
      const key = email || (name ? `name:${name}` : `__anon_${anonSeq++}`);
      if (!seen.has(key)) seen.set(key, p); // first record represents the person
    }
    const distinctParticipants = [...seen.values()];
    const distinctCount = distinctParticipants.length;

    // Cap the DISTINCT set (bounds memory + the per-poll session-call count). For
    // the 5,000-record/257-person meeting this now processes all 257 rather than
    // an arbitrary first-500 slice of raw records.
    const truncated = distinctCount > MAX_PARTICIPANTS;
    const toProcess = truncated ? distinctParticipants.slice(0, MAX_PARTICIPANTS) : distinctParticipants;
    if (truncated) {
      log.warn('attendance: distinct participant list capped', { conferenceId, raw: totalParticipants, distinct: distinctCount, cap: MAX_PARTICIPANTS });
    }

    // Fetch participant sessions in batches of 10 to avoid rate limits.
    const BATCH_SIZE = 10;
    const participants = [];
    let rateLimited = false;
    for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
      const batch = toProcess.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (p) => {
          try {
            const sessions = await meetGetAll(`${p.name}/participantSessions`, token, 'participantSessions');
            const joinTimes  = sessions.map(s => s.startTime).filter(Boolean).map(t => new Date(t));
            const leaveTimes = sessions.map(s => s.endTime).filter(Boolean).map(t => new Date(t));
            return {
              participantId: p.name,
              ...participantIdentity(p),
              joinTime:      joinTimes.length  > 0 ? new Date(Math.min(...joinTimes)).toISOString()  : null,
              leaveTime:     leaveTimes.length > 0 ? new Date(Math.max(...leaveTimes)).toISOString() : null,
              // Actual in-meeting time (sum of sessions) — the join/leave span
              // above over-credits anyone who left and came back.
              durationMs:    sessionsDurationMs(sessions),
              present:       sessions.some(s => !s.endTime),
              sessions:      sessions.length,
            };
          } catch (err) {
            if (isRateLimited(err)) rateLimited = true;
            log.warn('failed to fetch sessions for participant', { name: p.name, error: err.message });
            return {
              participantId: p.name,
              ...participantIdentity(p),
              joinTime: null, leaveTime: null, present: true, sessions: 1,
            };
          }
        })
      );
      participants.push(...batchResults);
      // A9: once the quota is hit, stop firing more session calls — hammering it
      // only deepens the rate-limit. Return what we have with a rateLimited flag
      // (the remaining participants still show, just without precise timings).
      if (rateLimited) {
        log.warn('attendance: stopping session fetch early — rate limited', { conferenceId, done: participants.length, total: toProcess.length });
        for (const p of toProcess.slice(participants.length)) {
          participants.push({ participantId: p.name, ...participantIdentity(p), joinTime: null, leaveTime: null, present: true, sessions: 1 });
        }
        break;
      }
    }

    // Enrich missing emails via Workspace Directory API (bounded by the cap above)
    await enrichEmails(participants, tenantConfig?.adminEmail);

    res.json({
      participants,
      delegationConfigured: usingServiceAccount,
      conferenceStartTime,
      conferenceEndTime,
      totalParticipants, // raw Meet participant records (reconnection-inflated)
      distinctCount,     // distinct people (what "truncated" is measured against)
      truncated,
      rateLimited,
    });

    // Fire-and-forget: persist to Firestore for analytics
    const domain = req.user?.domain || 'default';
    persistAttendance(domain, conferenceId, conferenceRecord.name, participants, req.user?.email);

  } catch (err) {
    // A9: a quota-exhausted Meet API (429) on the record/participant-list fetch
    // used to surface as a blind 500. Return a clear, retryable signal instead
    // so the panel can show "large meeting — try again shortly" and back off.
    if (isRateLimited(err)) {
      log.warn('attendance: Meet API rate limited', { conferenceId, error: err.message });
      res.set('Retry-After', '30');
      return res.status(429).json({
        error: 'This meeting has a lot of participants and Google is briefly rate-limiting attendance lookups. Please try again in a moment.',
        code: 'RATE_LIMITED',
      });
    }
    log.error('attendance fetch failed', { err, error: err.message });
    res.status(500).json({ error: 'Failed to fetch attendance data.' });
  }
});

module.exports = router;
