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
async function meetGetAll(path, token, responseKey) {
  const items = [];
  let pageToken = null;
  do {
    const separator = path.includes('?') ? '&' : '?';
    const url = pageToken ? `${path}${separator}pageToken=${pageToken}` : path;
    const data = await meetGet(url, token);
    if (data[responseKey]) items.push(...data[responseKey]);
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return items;
}

module.exports = { meetGet, meetGetAll };
