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
    try {
      resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } catch (err) {
      // Timeout (AbortError) or network error — retry like a transient 5xx.
      clearTimeout(timer);
      const isTimeout = err.name === 'AbortError';
      if (attempt < retries) {
        log.warn('meet api request failed, retrying', { reason: isTimeout ? 'timeout' : err.message, attempt });
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw new Error(isTimeout ? `Meet API timeout after ${MEET_TIMEOUT_MS}ms` : `Meet API request failed: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
    if (resp.ok) return resp.json();
    const body = await resp.text();
    if (resp.status >= 500 && attempt < retries) {
      log.warn('meet api transient error, retrying', { status: resp.status, attempt });
      await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      continue;
    }
    throw new Error(`Meet API ${resp.status}: ${body}`);
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
// `now`). The old first-join→last-leave span credited people for time they
// were AWAY between sessions.
function sessionsDurationMs(sessions, nowMs = Date.now()) {
  let total = 0;
  for (const s of sessions || []) {
    if (!s.startTime) continue;
    const start = new Date(s.startTime).getTime();
    const end = s.endTime ? new Date(s.endTime).getTime() : nowMs;
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) total += end - start;
  }
  return total;
}

module.exports = { meetGet, meetGetAll, participantIdentity, sessionsDurationMs };
