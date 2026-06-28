// Pure, dependency-free helpers shared by index.html (loaded as a <script src>)
// and the Jest jsdom unit tests. NO references to `state`, `APP_CONFIG`, DOM
// nodes, or other inline-script globals — everything takes its data as args.
//
// Exposed as both `window.AttUtils` (for the browser) and `module.exports`
// (for Jest). The inline script in index.html re-declares thin wrappers for
// each function so existing call sites don't have to change.

(function (root) {
  'use strict';

  // ─── threshold constants ───
  // Late-arrival cutoff. Anyone joining more than this many minutes after the
  // meeting's true start gets the +Nm late chip and a "Late?" column in the
  // exported sheet.
  const LATE_THRESHOLD_MIN = 5;

  // Avatar color palette — chosen for contrast on the dark side-panel theme.
  const AVATAR_PALETTE = ['#1f6feb', '#238636', '#9e6a03', '#b62324', '#5e35d6', '#0e7c66', '#bf3989', '#a04600'];

  // ─── HTML escape ───
  // Used in many template strings to prevent XSS from displayName / email
  // fields that originate in Google's directory (mostly trustworthy but not
  // guaranteed).
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ─── relative time formatter ───
  // "3 minutes ago" / "2 hours ago" — used in the "this meeting ended N min
  // ago" empty state. Caps at days; longer than that just shows day count.
  function formatRelative(d) {
    if (!d) return '';
    const date = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(date.getTime())) return '';
    const diffSec = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (diffSec < 60) return 'just now';
    const min = Math.floor(diffSec / 60);
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;
    const day = Math.floor(hr / 24);
    return `${day} day${day === 1 ? '' : 's'} ago`;
  }

  // ─── date / duration formatters ───
  function fmtTime(d) {
    if (!d) return '';
    const date = d instanceof Date ? d : new Date(d);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function fmtDur(start, end) {
    const m = Math.floor((end - start) / 60000);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  function fmtDurMs(ms) {
    const m = Math.floor(ms / 60000);
    if (m < 1) return '< 1m';
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }

  function isoFmt(d) { return d.toISOString(); }

  function datestamp() {
    return new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  }

  // ─── late-arrival math ───
  // Pure version of latenessMin: takes baseline times as args instead of
  // reading from `state`. The index.html wrapper passes state._eventStart
  // and state.conferenceStartTime in.
  //
  // Returns: minutes past the meeting's true start, or 0 if not late /
  // baseline unknown / participant never joined.
  function latenessMin(joinTime, eventStart, conferenceStartTime) {
    if (!joinTime) return 0;
    const evStart = eventStart ? new Date(eventStart).getTime() : 0;
    const confStart = conferenceStartTime ? new Date(conferenceStartTime).getTime() : 0;
    const baseline = evStart || confStart;
    if (!baseline) return 0;
    const joinMs = joinTime instanceof Date ? joinTime.getTime() : new Date(joinTime).getTime();
    if (Number.isNaN(joinMs)) return 0;
    const diffMin = Math.round((joinMs - baseline) / 60000);
    return diffMin > LATE_THRESHOLD_MIN ? diffMin : 0;
  }

  // ─── avatar / participant identity ───
  function avatarColor(name) {
    if (!name) return '#3d444d';
    let h = 0;
    for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
    return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
  }

  // Build the key used by the participant history endpoint — prefers email
  // when we have one, else marks the bucket as a displayName-only entry.
  function participantKey(p) {
    if (p?.email) return p.email.toLowerCase();
    return 'name:' + (p?.displayName || 'Unknown');
  }

  // ─── auto-match participants to calendar invitees ───
  // Used by the calendar-match modal to pre-fill which Meet participant
  // corresponds to which invited attendee. Strategy:
  //   1. Exact full-name match (case-insensitive, trimmed)
  //   2. Fall back to first-name match against an unused attendee email
  // Returns: { emailMap: { participantDisplayName -> attendeeEmail },
  //           unmatchedCount: number of participants with no match }
  //
  // Pure: takes both arrays as args instead of reading from state.
  function autoMatchAttendees(participants, calendarAttendees) {
    const emailMap = {};
    const usedEmails = new Set();
    const parts = Array.from(participants || []);
    const attendees = calendarAttendees || [];
    for (const p of parts) {
      const pName = (p.displayName || '').toLowerCase().trim();
      if (!pName) continue;
      let match = attendees.find(a => (a.displayName || '').toLowerCase().trim() === pName);
      if (!match) {
        const pFirst = pName.split(' ')[0];
        match = attendees.find(a =>
          (a.displayName || '').toLowerCase().split(' ')[0] === pFirst && !usedEmails.has(a.email)
        );
      }
      if (match) {
        emailMap[p.displayName] = match.email;
        usedEmails.add(match.email);
      }
    }
    const unmatchedCount = parts.length - Object.keys(emailMap).length;
    return { emailMap, unmatchedCount };
  }

  // ─── cumulative session time ───
  // Past sessions sit in _accumulatedMs (added when they leave). If they're
  // currently present, add the live elapsed since their current join.
  // Pure: now is injectable for tests.
  function participantTotalMs(p, now) {
    if (!p) return 0;
    const t = typeof now === 'number' ? now : Date.now();
    const past = p._accumulatedMs || 0;
    const join = p.joinTime instanceof Date ? p.joinTime.getTime()
      : (p.joinTime ? new Date(p.joinTime).getTime() : null);
    const active = p.present && join ? Math.max(0, t - join) : 0;
    return past + active;
  }

  // ─── self-presence detection ───
  // The Meet REST API has 2-5 min lag for new sessions, which means YOU as
  // the organizer often show up as "Left" right after rejoining. This
  // function decides whether a given participant record actually represents
  // the signed-in user — if so, the merge logic forces them present.
  //
  // Three strategies tried in order:
  //   1. emailMatch: incoming/stored email equals signed-in user's email
  //   2. nameMatch: incoming displayName equals signed-in user's name
  //   3. soloMatch: signed in + this is the only participant in the meeting
  //
  // Pure: takes the participant + the signed-in identity + crowd context
  // as args, no state coupling.
  function isSelfParticipant(p, ctx) {
    if (!p || !ctx) return false;
    const c = ctx;
    const pEmail = ((p.email || p.existingEmail || '') + '').toLowerCase();
    const selfEmail = (c.selfEmail || '').toLowerCase();
    const emailMatch = !!(pEmail && selfEmail && pEmail === selfEmail);
    const pName = ((p.displayName || '') + '').toLowerCase();
    const selfName = (c.selfDisplayName || '').toLowerCase();
    const nameMatch = !!(selfName && pName && pName === selfName);
    const soloMatch = !!(c.signedIn
      && (c.participantCount || 0) <= 1
      && (c.incomingCount || 0) <= 1);
    return emailMatch || nameMatch || soloMatch;
  }

  // ─── Slack webhook helpers ───
  // Slack incoming-webhook URLs have a fixed prefix + 3 path segments
  // separated by /. The team/bot/token segments are bearer-secret-ish, so
  // we mask them in any UI surface. Pure: tested in utils.test.js.
  const SLACK_WEBHOOK_PREFIX = 'https://hooks.slack.com/services/';

  function isValidSlackWebhook(url) {
    if (typeof url !== 'string') return false;
    if (!url.startsWith(SLACK_WEBHOOK_PREFIX)) return false;
    const rest = url.slice(SLACK_WEBHOOK_PREFIX.length);
    const parts = rest.split('/');
    // Expect 3 non-empty path segments (T*/B*/secret)
    return parts.length === 3 && parts.every(p => p.length > 0);
  }

  function maskWebhookUrl(url) {
    if (!isValidSlackWebhook(url)) return '';
    const rest = url.slice(SLACK_WEBHOOK_PREFIX.length);
    const [t, b, secret] = rest.split('/');
    // Show first 2-3 chars of each segment + last 4 of the secret.
    // Enough that the user recognizes their own URL without exposing it.
    const maskedT = t.slice(0, 2) + '***';
    const maskedB = b.slice(0, 2) + '***';
    const maskedSecret = '***' + (secret.length > 4 ? secret.slice(-4) : secret);
    return `${SLACK_WEBHOOK_PREFIX}${maskedT}/${maskedB}/${maskedSecret}`;
  }

  const api = {
    escHtml, formatRelative, fmtTime, fmtDur, fmtDurMs, isoFmt, datestamp,
    latenessMin, avatarColor, participantKey,
    autoMatchAttendees, participantTotalMs, isSelfParticipant,
    isValidSlackWebhook, maskWebhookUrl,
    LATE_THRESHOLD_MIN, AVATAR_PALETTE, SLACK_WEBHOOK_PREFIX,
  };

  root.AttUtils = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
