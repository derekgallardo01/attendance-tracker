const log = require('../lib/logger');

// Hard cap on how long a single Meet API request may hang. Without this a
// stuck upstream connection would tie up a Cloud Run request indefinitely.
const MEET_TIMEOUT_MS = Number(process.env.MEET_TIMEOUT_MS) || 10000;

async function meetGet(path, token, retries = 2) {
  const url = `https://meet.googleapis.com/v2/${path}`;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MEET_TIMEOUT_MS);
    let resp;
    let data;
    let body;
    try {
      resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (resp.ok) {
        data = await resp.json();
      } else {
        body = await resp.text();
      }
    } catch (err) {
      // Timeout (AbortError) or network error — retry like a transient 5xx.
      clearTimeout(timer);
      const isTimeout = err.name === 'AbortError';
      if (attempt < retries) {
        log.warn('meet api request failed, retrying', { reason: isTimeout ? 'timeout' : err.message, attempt });
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      const wrappedErr = new Error(isTimeout ? `Meet API timeout after ${MEET_TIMEOUT_MS}ms` : `Meet API request failed: ${err.message}`);
      wrappedErr.isNetworkError = true;
      throw wrappedErr;
    } finally {
      clearTimeout(timer);
    }
    if (resp.ok) return data;
    // 429 = quota exhausted (Meet's list_participant_sessions is 600/min/user).
    // A short honor-the-Retry-After backoff clears transient bursts; a persistent
    // 429 propagates with .status so callers can degrade gracefully (return a
    // "large meeting, try again" signal) instead of a blind 500. Retry window is
    // kept small so it can't eat the request's 30s budget on a large meeting.
    if (resp.status === 429 && attempt < retries) {
      const retryAfter = Number(resp.headers.get('retry-after'));
      const waitMs = Math.min((retryAfter > 0 ? retryAfter : 0.5 * (attempt + 1)) * 1000, 2000);
      log.warn('meet api rate limited (429), retrying', { attempt, waitMs });
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    if (resp.status >= 500 && attempt < retries) {
      log.warn('meet api transient error, retrying', { status: resp.status, attempt });
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }
    const err = new Error(`Meet API ${resp.status}: ${body}`);
    err.status = resp.status; // let callers detect 429/403 without string-matching
    throw err;
  }
}

// Fetch all pages for a list endpoint. Returns the combined array from the given response key.
// Cap total pages so a pathologically large (or looping) result set can't run
// unbounded sequential fetches inside the request's 30s window. 50 pages ×
// Meet's page size is far beyond any real meeting; hitting it is logged.
const MAX_PAGES = 50;
async function meetGetAll(path, token, responseKey) {
  const items = [];
  let pageToken = null;
  let pages = 0;
  do {
    const separator = path.includes('?') ? '&' : '?';
    // encodeURIComponent: Meet page tokens are base64url-ish and can contain
    // '+', '/', '='. An unencoded '+' decodes server-side as a space →
    // corrupted token → the loop errors or re-fetches a page, silently
    // dropping or duplicating participants on multi-page (large) meetings.
    const url = pageToken ? `${path}${separator}pageToken=${encodeURIComponent(pageToken)}` : path;
    const data = await meetGet(url, token);
    if (data[responseKey]) items.push(...data[responseKey]);
    pageToken = data.nextPageToken || null;
    if (++pages >= MAX_PAGES && pageToken) {
      require('../lib/logger').warn('meetGetAll hit page cap', { path, pages, items: items.length });
      break;
    }
  } while (pageToken);
  return items;
}

// Resolve a Meet v2 Participant's identity. The resource is a oneof of
// signedinUser / anonymousUser / phoneUser — there is NO `user` field, so the
// old `p.user?.…` fallbacks were dead code and every not-signed-in guest and
// every dial-in collapsed into a single "Unknown" person (poisoning distinct
// counts, sheets, digests and the series roll-up).
function participantIdentity(p) {
  const displayName = p?.signedinUser?.displayName
    || p?.anonymousUser?.displayName
    || p?.phoneUser?.displayName
    || 'Unknown';
  const email = p?.signedinUser?.email || '';
  return { displayName, email };
}

// Sum of actual in-meeting time across sessions (an open session counts up to
// `now`). Overlapping intervals (e.g. multi-device sessions) are merged first
// so concurrent minutes are not double-counted.
function sessionsDurationMs(sessions, nowMs = Date.now()) {
  const intervals = [];
  for (const s of sessions || []) {
    if (!s.startTime) continue;
    const start = new Date(s.startTime).getTime();
    const end = s.endTime ? new Date(s.endTime).getTime() : nowMs;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      intervals.push([start, end]);
    }
  }
  if (intervals.length === 0) return 0;
  intervals.sort((a, b) => a[0] - b[0]);

  const merged = [intervals[0]];
  for (let i = 1; i < intervals.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = intervals[i];
    if (curr[0] <= prev[1]) {
      prev[1] = Math.max(prev[1], curr[1]);
    } else {
      merged.push(curr);
    }
  }

  return merged.reduce((total, [start, end]) => total + (end - start), 0);
}

// Fetch all participants and their sessions for a conferenceRecord.
async function fetchConferenceParticipants(recordName, token, meetingEndTime = null) {
  const raw = await meetGetAll(`${recordName}/participants`, token, 'participants');
  const BATCH = 10;
  const participantData = [];
  for (let i = 0; i < raw.length; i += BATCH) {
    const results = await Promise.all(raw.slice(i, i + BATCH).map(async (p) => {
      let sessions = [];
      let sessionsFetchFailed = false;
      try { sessions = await meetGetAll(`${p.name}/participantSessions`, token, 'participantSessions'); }
      catch (e) { sessionsFetchFailed = true; log.warn('meetApi: sessions fetch failed', { participant: p.name, error: e.message }); }
      return { p, sessions, sessionsFetchFailed };
    }));
    participantData.push(...results);
  }

  let meetingEndMs = meetingEndTime ? (typeof meetingEndTime?.toDate === 'function' ? meetingEndTime.toDate().getTime() : new Date(meetingEndTime).getTime()) : NaN;
  if (isNaN(meetingEndMs)) {
    let maxMs = 0;
    for (const { sessions } of participantData) {
      for (const s of sessions) {
        const end = s.endTime ? new Date(s.endTime).getTime() : (s.startTime ? new Date(s.startTime).getTime() : 0);
        if (!isNaN(end) && end > maxMs) maxMs = end;
      }
    }
    meetingEndMs = maxMs > 0 ? maxMs : null;
  }

  const PRESENCE_GRACE_MS = 3 * 60 * 1000; // 3 minutes grace window before meeting completion

  return participantData.map(({ p, sessions, sessionsFetchFailed }) => {
    const joins  = sessions.map(s => s.startTime).filter(Boolean).map(t => new Date(t)).filter(d => !isNaN(d.getTime()));
    const leaves = sessions.map(s => s.endTime).filter(Boolean).map(t => new Date(t)).filter(d => !isNaN(d.getTime()));
    const joinIso = joins.length ? new Date(Math.min(...joins)).toISOString() : null;
    const leaveIso = leaves.length ? new Date(Math.max(...leaves)).toISOString() : null;

    let present = false;
    if (sessionsFetchFailed) {
      present = true;
    } else if (sessions.some(s => !s.endTime)) {
      present = true;
    } else if (leaves.length > 0) {
      const lastLeaveMs = Math.max(...leaves.map(t => t.getTime()));
      if (meetingEndMs) {
        present = (meetingEndMs - lastLeaveMs) <= PRESENCE_GRACE_MS;
      } else {
        present = true;
      }
    }

    return {
      participantId: p.name,
      ...participantIdentity(p),
      joinTimeISO:  joinIso,
      leaveTimeISO: leaveIso,
      joinTime:     joinIso,
      leaveTime:    leaveIso,
      ...(sessionsFetchFailed ? {} : { durationMs: sessionsDurationMs(sessions) }),
      present,
      sessions:     sessions.length || 1,
    };
  });
}

module.exports = { meetGet, meetGetAll, participantIdentity, sessionsDurationMs, fetchConferenceParticipants };

