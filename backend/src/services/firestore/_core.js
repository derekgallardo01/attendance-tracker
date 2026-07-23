// Shared Firestore helpers + constants used across the firestore/* submodules
// and the parent services/firestore.js. Split out of the former monolith.
// This is the bottom layer — it must NOT require any firestore/* submodule.
const { Firestore, FieldValue } = require('@google-cloud/firestore');
const crypto = require('crypto');
const CONFIG = require('../../config');
const log = require('../../lib/logger');

// Personal email providers — these "tenants" are shared across many unrelated
// users so the "team admin" concept doesn't apply. Used by the team-admin
// auto-claim in upsertUser.
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com',
  'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.co.uk', 'ymail.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'protonmail.com', 'proton.me', 'pm.me',
  'gmx.com', 'gmx.net', 'mail.com',
  'fastmail.com', 'duck.com', 'zoho.com',
]);

// Owner / super-admin account — excluded from user-facing analytics + lifecycle
// email so the founder's own testing doesn't skew metrics.
const SUPER_ADMIN_EMAIL = CONFIG.superAdminEmail;

// ── Token encryption (AES-256-GCM using SESSION_SECRET as key) ──
const ALGO = 'aes-256-gcm';
function deriveKey() {
  return crypto.createHash('sha256').update(CONFIG.sessionSecret).digest();
}

function encryptToken(plaintext) {
  if (!plaintext) return null;
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag().toString('base64');
  return `${iv.toString('base64')}:${tag}:${encrypted}`;
}

function decryptToken(ciphertext) {
  if (!ciphertext || !ciphertext.includes(':')) return ciphertext; // not encrypted (legacy)
  try {
    const [ivB64, tagB64, data] = ciphertext.split(':');
    const key = deriveKey();
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    let decrypted = decipher.update(data, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    log.warn('token decryption failed — may be legacy plaintext', { error: err.message });
    return ciphertext;
  }
}

let db = null;
function getDb() {
  if (!db) {
    const opts = {};
    if (CONFIG.gcpProjectId) opts.projectId = CONFIG.gcpProjectId;
    db = new Firestore(opts);
  }
  return db;
}

// Wrap an async read in a short TTL cache keyed by its args. The admin analytics
// functions each scan the whole users+events+meetings tree; the dashboard fires
// several on load and the owner reloads often, so caching the result for a
// couple of minutes turns N full-DB re-scans into one. Admin-only data, so mild
// staleness is fine. (Does NOT bound a single cold call's memory.)
function memoizeTTL(fn, ttlMs, maxEntries = 200) {
  const cache = new Map(); // argsKey -> { at, value }
  return async function (...args) {
    const key = JSON.stringify(args);
    const hit = cache.get(key);
    if (hit && (Date.now() - hit.at) < ttlMs) return hit.value;
    const value = await fn.apply(this, args);
    cache.set(key, { at: Date.now(), value });
    // Bound the cache so a large spread of distinct arg keys can't grow it
    // without limit (it was only ever TTL-checked on read, never size-evicted).
    // Map preserves insertion order, so the first key is the oldest.
    if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return value;
  };
}

// All collections scoped under tenants/{domain}.
function tenantRef(domain) {
  return getDb().collection('tenants').doc(domain);
}

// Extract last segment from a Meet API resource name.
function lastSegment(resourceName) {
  const parts = resourceName.split('/');
  return parts[parts.length - 1];
}

// Count DISTINCT human attendees, not raw participant records. Meet assigns a
// fresh participant id per account/session, so one person joining from two
// devices (or rejoining) shows up as multiple records. We collapse by identity:
// email when present, else the lowercased display name. This is the "real
// multi-person meeting" signal — it must NOT replace participantCount on the
// meeting doc; it's a separate, conservative metric. Mirrors the frontend
// AttUtils.distinctAttendees (guarded by distinct-attendees-contract.test.js).
function countDistinctAttendees(participants) {
  const ids = new Set();
  for (const p of participants || []) {
    const email = (p.email || '').trim().toLowerCase();
    const name = (p.displayName || '').trim().toLowerCase();
    const key = email || (name ? `name:${name}` : null);
    if (key) ids.add(key);
  }
  return ids.size;
}

// Consecutive-week tracking streak from a list of tracked-event timestamps
// (ms). Weeks are epoch-aligned buckets (7-day); the exact alignment doesn't
// matter, only consistency. The streak counts back from the current week — or
// last week if nothing's tracked yet this week, so an in-progress week doesn't
// look like a broken streak. Pure + injectable `nowMs` so it's deterministic
// to test. Powers the in-app "N weeks running" retention chip.
const WEEK_MS = 7 * 24 * 3600 * 1000;
function weeklyStreak(timestamps, nowMs) {
  if (!timestamps || !timestamps.length) return 0;
  const weekOf = (ms) => Math.floor(ms / WEEK_MS);
  const weeks = new Set(timestamps.map(weekOf));
  const current = weekOf(nowMs);
  const start = weeks.has(current) ? current : (weeks.has(current - 1) ? current - 1 : null);
  if (start === null) return 0; // last activity is >1 week stale — streak broken
  let streak = 0;
  for (let w = start; weeks.has(w); w--) streak++;
  return streak;
}

module.exports = {
  FieldValue, log, CONFIG,
  PERSONAL_EMAIL_DOMAINS, SUPER_ADMIN_EMAIL,
  encryptToken, decryptToken,
  getDb, memoizeTTL, tenantRef, lastSegment, countDistinctAttendees, weeklyStreak,
};
