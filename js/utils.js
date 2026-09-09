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
  // Escape the full 5-char set (incl. quotes) so the result is safe in both
  // text and attribute contexts — matches the backend escapers in
  // notifications.js / routes/public.js.
  const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
  }

  // Escape a value for use as a JS STRING LITERAL inside an inline handler
  // attribute — e.g. onclick="fn('${escJsArg(x)}')". escHtml is WRONG there:
  // the HTML parser decodes &#39; back to ' before the JS compiles, so an
  // apostrophe in a name breaks (or escapes) the handler. Backslash-escape the
  // JS metacharacters, then HTML-escape the quote/angle so the attribute stays
  // well-formed. Result is safe to drop inside a single-quoted JS string in a
  // double-quoted attribute.
  function escJsArg(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r?\n/g, '\\n')
      .replace(/[<>"&]/g, (c) => HTML_ESCAPES[c]);
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

  // Count DISTINCT human attendees among an iterable of participant objects,
  // deduped by identity (email, else lowercased display name) so one person on
  // two devices/sessions counts once. This is the "real meeting" signal and
  // MUST stay identical to the backend countDistinctAttendees() in
  // services/firestore.js (guarded by the shared-contract test).
  function distinctAttendees(participants) {
    const ids = new Set();
    for (const p of participants || []) {
      const email = (p.email || '').trim().toLowerCase();
      const name = (p.displayName || '').trim().toLowerCase();
      const key = email || (name ? `name:${name}` : null);
      if (key) ids.add(key);
    }
    return ids.size;
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
    // The map is keyed by displayName — with DUPLICATE names (two "Guest"s,
    // two same-named students) both export rows would inherit whichever
    // invitee matched first: a wrong-email attribution in the Sheet. Never
    // guess for ambiguous names; leave them for the manual match modal.
    const nameCounts = {};
    for (const p of parts) {
      const n = (p.displayName || '').toLowerCase().trim();
      if (n) nameCounts[n] = (nameCounts[n] || 0) + 1;
    }
    let matched = 0;
    let namedCount = 0;
    for (const p of parts) {
      const pName = (p.displayName || '').toLowerCase().trim();
      if (!pName) continue;
      namedCount++;
      if (nameCounts[pName] > 1) continue; // ambiguous — manual match only
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
        matched++;
      }
    }
    // Count actual unmatched NAMED participants — the old
    // `parts.length - keys(emailMap).length` over-reported for nameless rows
    // and name collisions, inflating the match-modal's warning copy.
    const unmatchedCount = namedCount - matched;
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
    // The Meet API often supplies NO joinTime (session fetch failed, API lag)
    // — the panel then tracks its own trackedJoinTime. Reading only joinTime
    // here returned 0 for a visibly-present participant, and the export layer
    // preferred that 0 over its own correct span fallback ("< 1 min / 0%"
    // rows for students present the whole meeting).
    const start = p.joinTime || p.trackedJoinTime || null;
    const join = start instanceof Date ? start.getTime()
      : (start ? new Date(start).getTime() : null);
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

  // ─── Chat webhook helpers (Slack / Google Chat / Discord) ───
  // Incoming-webhook URLs embed bearer-token secrets, so we validate the
  // canonical shape before submit and mask in any UI surface. Each validator
  // must match its backend twin (lib/slack.js, lib/googleChat.js,
  // lib/discord.js) exactly. Pure: tested in utils.test.js.
  const SLACK_WEBHOOK_PREFIX = 'https://hooks.slack.com/services/';
  const CHAT_WEBHOOK_PREFIX = 'https://chat.googleapis.com/v1/spaces/';
  const DISCORD_WEBHOOK_PREFIXES = [
    'https://discord.com/api/webhooks/',
    'https://discordapp.com/api/webhooks/',
  ];

  // Google Chat: fixed host + /v1/spaces/{space}/messages + non-empty bounded
  // key and token query params.
  function isValidGoogleChatWebhook(url) {
    if (typeof url !== 'string' || url.length > 1000) return false;
    if (!url.startsWith(CHAT_WEBHOOK_PREFIX)) return false;
    // The prefix check guarantees a parseable scheme+host, so URL() can't throw.
    const parsed = new URL(url);
    if (!/^\/v1\/spaces\/[^/]{1,200}\/messages$/.test(parsed.pathname)) return false;
    const key = parsed.searchParams.get('key');
    const token = parsed.searchParams.get('token');
    return !!(key && token && key.length < 200 && token.length < 200);
  }

  // Discord: pinned prefix + {numeric id}/{token}.
  function isValidDiscordWebhook(url) {
    if (typeof url !== 'string') return false;
    const prefix = DISCORD_WEBHOOK_PREFIXES.find(p => url.startsWith(p));
    if (!prefix) return false;
    const parts = url.slice(prefix.length).split('/');
    if (parts.length !== 2) return false;
    const id = parts[0], token = parts[1];
    return /^\d{1,30}$/.test(id) && token.length > 0 && token.length < 200 && !token.includes('?');
  }

  // CSV field escaping shared by the attendance + LMS builders. Always quotes,
  // doubles inner quotes, and defuses spreadsheet formula injection: Excel and
  // LibreOffice evaluate a leading =, +, -, @ (or tab/CR) even INSIDE a quoted
  // field, and Meet display names are attacker-controlled by anyone who joins
  // the meeting. The apostrophe prefix renders as a plain leading quote in the
  // worst case; a hijacked =HYPERLINK/DDE cell is strictly worse.
  function escapeCsv(val) {
    if (val === null || val === undefined) return '""';
    let s = String(val);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    s = s.replace(/"/g, '""');
    return `"${s}"`;
  }

  function isValidSlackWebhook(url) {
    if (typeof url !== 'string') return false;
    if (!url.startsWith(SLACK_WEBHOOK_PREFIX)) return false;
    const rest = url.slice(SLACK_WEBHOOK_PREFIX.length);
    const parts = rest.split('/');
    // Expect 3 path segments (T*/B*/secret), each non-empty and bounded — must
    // match the backend validator in routes/settings.js exactly.
    return parts.length === 3 && parts.every(p => p.length > 0 && p.length < 200);
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

  // ── Session persistence (sessionStorage snapshot) ──
  // Pure serialize/parse for the side-panel's restore-across-reloads snapshot.
  // The Date<->ISO conversions and the freshness cutoff are the error-prone
  // parts; keeping them here makes them unit-testable. saveState/restoreState in
  // index.html stay thin wrappers over sessionStorage + applying to `state`.
  function serializeSession(state, savedAtMs) {
    const iso = (d) => (d ? d.toISOString() : null);
    return {
      conferenceId: state.conferenceId,
      meetingTitle: state.meetingTitle,
      startTime: iso(state.startTime),
      tracking: state.tracking,
      sessionToken: state.sessionToken,
      userEmail: state.userEmail,
      userDisplayName: state._selfDisplayName || null,
      signedIn: state.signedIn,
      grantedScopes: state.grantedScopes || [],
      missingScopes: state.missingScopes || [],
      participants: [...state.participants.entries()].map(([k, v]) => [k, {
        ...v,
        joinTime: iso(v.joinTime),
        trackedJoinTime: iso(v.trackedJoinTime),
        leaveTime: iso(v.leaveTime),
        // Only the completed-session duration is persisted; the active session's
        // time is recomputed live from joinTime in renderList.
        _accumulatedMs: v._accumulatedMs || 0,
      }]),
      _lastSheetUrl: state._lastSheetUrl || null,
      autoExportedConferenceId: state.autoExportedConferenceId || null,
      soloNudgeConferenceId: state.soloNudgeConferenceId || null,
      // The escalated scope-banner state ("last sign-in left a checkbox
      // unticked") must survive a panel reload — it's the durable half of the
      // re-consent fix; without persistence it reverted to the passive banner.
      _scopeRetryFailed: !!state._scopeRetryFailed,
      // Attendee check-in session: without persistence a panel reload forced
      // the student through the Google popup again.
      _attendeeToken: state._attendeeToken || null,
      _attendeeEmail: state._attendeeEmail || null,
      savedAt: savedAtMs,
    };
  }

  // Parse a snapshot back into applyable fields. Returns null if the snapshot is
  // missing, unparseable, or older than maxAgeMs. Dates are revived; participant
  // streak counters reset so the API decides presence fresh on the next poll.
  function parseSession(snap, nowMs, maxAgeMs) {
    if (!snap || typeof snap !== 'object') return null;
    if (nowMs - snap.savedAt > maxAgeMs) return null;
    const date = (s) => (s ? new Date(s) : null);
    return {
      tracking: snap.tracking,
      conferenceId: snap.conferenceId,
      meetingTitle: snap.meetingTitle,
      startTime: date(snap.startTime),
      sessionToken: snap.sessionToken,
      userEmail: snap.userEmail,
      userDisplayName: snap.userDisplayName || null,
      signedIn: snap.signedIn,
      grantedScopes: snap.grantedScopes || [],
      missingScopes: snap.missingScopes || [],
      _lastSheetUrl: snap._lastSheetUrl,
      autoExportedConferenceId: snap.autoExportedConferenceId || null,
      soloNudgeConferenceId: snap.soloNudgeConferenceId || null,
      _scopeRetryFailed: !!snap._scopeRetryFailed,
      _attendeeToken: snap._attendeeToken || null,
      _attendeeEmail: snap._attendeeEmail || null,
      participants: (snap.participants || []).map(([k, v]) => [k, {
        ...v,
        joinTime: date(v.joinTime),
        trackedJoinTime: date(v.trackedJoinTime),
        leaveTime: date(v.leaveTime),
        _accumulatedMs: v._accumulatedMs || 0,
        // Reset the ACTUAL streak field (_leftStreak) so the API decides
        // presence fresh after a reload — the old `_notPresentStreak: 0` set a
        // field nothing reads, leaving a stale _leftStreak to mark a present
        // person "Left" one poll early.
        _leftStreak: 0,
      }]),
    };
  }

  // ─── class roster parsing & matching ───
  function parseStudentsInput(text) {
    if (!text || typeof text !== 'string') return [];
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const students = [];
    for (const line of lines) {
      const angleMatch = line.match(/^([^<]+)<([^>]+)>$/);
      if (angleMatch) {
        students.push({ name: angleMatch[1].trim(), email: angleMatch[2].trim().toLowerCase() });
        continue;
      }
      const commaParts = line.split(',');
      if (commaParts.length === 2 && commaParts[1].includes('@')) {
        students.push({ name: commaParts[0].trim(), email: commaParts[1].trim().toLowerCase() });
        continue;
      }
      if (line.includes('@')) {
        students.push({ name: line.split('@')[0].trim(), email: line.toLowerCase() });
      } else {
        students.push({ name: line, email: '' });
      }
    }
    return students;
  }

  function findParticipantForStudent(student, participants) {
    if (!student || !participants) return null;
    const sEmail = (student.email || '').trim().toLowerCase();
    const sName = (student.name || '').trim().toLowerCase();

    if (sEmail) {
      for (const p of participants) {
        if (p && p.email && p.email.trim().toLowerCase() === sEmail) return p;
      }
    }

    if (sName) {
      const sNorm = sName.replace(/[^a-z0-9]/g, '');
      for (const p of participants) {
        if (!p) continue;
        const pNorm = (p.displayName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (sNorm && pNorm && sNorm === pNorm) return p;
      }
      for (const p of participants) {
        if (!p) continue;
        const pLower = (p.displayName || '').toLowerCase();
        if (pLower && (pLower.includes(sName) || sName.includes(pLower))) return p;
      }
    }
    return null;
  }

  function buildAttendanceCsv(parts, activeRoster, opts = {}) {
    const meetingTitle = opts.meetingTitle || 'Meeting';
    const totalMeetingMs = opts.totalMeetingMs || 0;
    const meetingMinutes = totalMeetingMs > 0 ? Math.max(1, Math.round(totalMeetingMs / 60000)) : (opts.meetingMinutes || 1);
    const lateMinutes = (opts.lateMinutes !== undefined) ? Number(opts.lateMinutes) : 10;
    const minPercent = (opts.minPercent !== undefined) ? Number(opts.minPercent) : 0;
    const minMinutes = (opts.minMinutes !== undefined) ? Number(opts.minMinutes) : 0;
    const excusedStudents = opts.excusedStudents || {};
    const startTime = opts.startTime ? new Date(opts.startTime) : null;
    const now = opts.now ? new Date(opts.now) : new Date();

    // Self-check-in attestation rides the Notes column: it augments whatever
    // note is already there rather than claiming a column of its own.
    const withCheckinNote = (note, p) => {
      const chk = p && p.checkedInAt ? 'Checked in ' + new Date(p.checkedInAt).toLocaleTimeString() : '';
      return [note, chk].filter(Boolean).join('; ');
    };

    const rows = [];
    rows.push([
      'Name',
      'Email',
      'Status',
      'Attendance %',
      'Duration (min)',
      'Join Time',
      'Leave Time',
      'Rejoins',
      'Notes'
    ].map(escapeCsv).join(','));

    if (activeRoster && Array.isArray(activeRoster) && activeRoster.length > 0) {
      const matchedParticipants = new Set();

      for (const student of activeRoster) {
        const p = findParticipantForStudent(student, parts);
        const studentKey = (student.email || student.name || '').toLowerCase();
        const excuse = excusedStudents[studentKey] || null;
        const isExcused = !!(excuse && excuse.excused);
        const note = excuse ? (excuse.note || '') : '';

        if (p) {
          matchedParticipants.add(p);
          const durMs = (p._accumulatedMs || 0) + (p.present && p.joinTime ? (now.getTime() - new Date(p.joinTime).getTime()) : 0);
          const durMin = Math.round(durMs / 60000);
          const pct = meetingMinutes > 0 ? Math.min(100, Math.round((durMin / meetingMinutes) * 100)) : 100;

          let isLate = false;
          if (startTime && p.joinTime && lateMinutes > 0) {
            const diffMin = (new Date(p.joinTime).getTime() - startTime.getTime()) / 60000;
            if (diffMin > lateMinutes) isLate = true;
          }

          let status = 'Present';
          if ((minPercent > 0 && pct < minPercent) || (minMinutes > 0 && durMin < minMinutes)) {
            status = isExcused ? 'Excused (Short Stay)' : 'Left Early / Incomplete';
          } else if (isLate) {
            status = 'Late';
          } else if (!p.present) {
            status = 'Present (Left)';
          }

          rows.push([
            p.displayName || student.name,
            p.email || student.email || '',
            status,
            `${pct}%`,
            durMin,
            p.joinTime ? new Date(p.joinTime).toLocaleTimeString() : '',
            (!p.present && p.leaveTime) ? new Date(p.leaveTime).toLocaleTimeString() : '',
            Math.max(0, (p.rejoins != null ? p.rejoins : (p.sessions || 1) - 1)),
            withCheckinNote(note, p)
          ].map(escapeCsv).join(','));
        } else {
          const status = isExcused ? 'Absent (Excused)' : 'Absent';
          rows.push([
            student.name,
            student.email || '',
            status,
            '0%',
            0,
            '',
            '',
            0,
            note
          ].map(escapeCsv).join(','));
        }
      }

      for (const p of parts) {
        if (!matchedParticipants.has(p)) {
          const durMs = (p._accumulatedMs || 0) + (p.present && p.joinTime ? (now.getTime() - new Date(p.joinTime).getTime()) : 0);
          const durMin = Math.round(durMs / 60000);
          const pct = meetingMinutes > 0 ? Math.min(100, Math.round((durMin / meetingMinutes) * 100)) : 100;
          rows.push([
            p.displayName,
            p.email || '',
            p.present ? 'Guest (Present)' : 'Guest (Left)',
            `${pct}%`,
            durMin,
            p.joinTime ? new Date(p.joinTime).toLocaleTimeString() : '',
            (!p.present && p.leaveTime) ? new Date(p.leaveTime).toLocaleTimeString() : '',
            Math.max(0, (p.rejoins != null ? p.rejoins : (p.sessions || 1) - 1)),
            withCheckinNote('Unregistered guest', p)
          ].map(escapeCsv).join(','));
        }
      }
    } else {
      for (const p of parts) {
        const durMs = (p._accumulatedMs || 0) + (p.present && p.joinTime ? (now.getTime() - new Date(p.joinTime).getTime()) : 0);
        const durMin = Math.round(durMs / 60000);
        const pct = meetingMinutes > 0 ? Math.min(100, Math.round((durMin / meetingMinutes) * 100)) : 100;
        rows.push([
          p.displayName,
          p.email || '',
          p.present ? 'Present' : 'Left',
          `${pct}%`,
          durMin,
          p.joinTime ? new Date(p.joinTime).toLocaleTimeString() : '',
          (!p.present && p.leaveTime) ? new Date(p.leaveTime).toLocaleTimeString() : '',
          Math.max(0, (p.rejoins != null ? p.rejoins : (p.sessions || 1) - 1)),
          withCheckinNote('', p)
        ].map(escapeCsv).join(','));
      }
    }

    return '\uFEFF' + rows.join('\r\n');
  }

  // \u2500\u2500 LMS gradebook exports (Moodle / Canvas) \u2500\u2500
  // One row per ROSTER student \u2014 gradebooks only carry enrolled students, so
  // unregistered guests are omitted. Grade = attendance % for anyone who
  // joined, 0 for an unexcused absence, blank for an excused one (blank lets
  // the teacher decide instead of importing a zero).

  // "Alice B Walker" -> { first: "Alice B", last: "Walker" } (last token is the
  // surname; single-token names go in `first`).
  function splitName(full) {
    const s = String(full || '').trim();
    const i = s.lastIndexOf(' ');
    return i === -1 ? { first: s, last: '' } : { first: s.slice(0, i), last: s.slice(i + 1) };
  }

  // Shared per-student grade computation. Same duration/threshold inputs as
  // buildAttendanceCsv (opts: totalMeetingMs/meetingMinutes, startTime, now,
  // excusedStudents).
  function buildLmsGradebookRows(parts, activeRoster, opts) {
    opts = opts || {};
    const totalMeetingMs = opts.totalMeetingMs || 0;
    const meetingMinutes = totalMeetingMs > 0 ? Math.max(1, Math.round(totalMeetingMs / 60000)) : (opts.meetingMinutes || 1);
    const excusedStudents = opts.excusedStudents || {};
    const now = opts.now ? new Date(opts.now) : new Date();

    const rows = [];
    for (const student of (activeRoster || [])) {
      const p = findParticipantForStudent(student, parts);
      const studentKey = (student.email || student.name || '').toLowerCase();
      const isExcused = !!(excusedStudents[studentKey] && excusedStudents[studentKey].excused);
      let grade;
      if (p) {
        const durMs = (p._accumulatedMs || 0) + (p.present && p.joinTime ? (now.getTime() - new Date(p.joinTime).getTime()) : 0);
        const durMin = Math.round(durMs / 60000);
        grade = Math.min(100, Math.round((durMin / meetingMinutes) * 100));
        // The Settings "Min stay %" threshold: below it, the LMS grade is 0
        // (counted absent) — the setting was previously dead for gradebooks.
        const minPercent = Number(opts.minPercent) || 0;
        if (minPercent > 0 && grade < minPercent) grade = isExcused ? '' : 0;
      } else {
        grade = isExcused ? '' : 0;
      }
      rows.push({
        name: (p && p.displayName) || student.name,
        email: (p && p.email) || student.email || '',
        grade,
      });
    }
    return rows;
  }

  // Moodle gradebook import CSV: matches students by "Email address"; the
  // last column becomes the grade item.
  function buildMoodleGradebookCsv(parts, activeRoster, opts) {
    opts = opts || {};
    const itemName = `${opts.meetingTitle || 'Google Meet'} attendance (%)`;
    const rows = [['First name', 'Last name', 'Email address', itemName].map(escapeCsv).join(',')];
    for (const r of buildLmsGradebookRows(parts, activeRoster, opts)) {
      const { first, last } = splitName(r.name);
      rows.push([first, last, r.email, r.grade].map(escapeCsv).join(','));
    }
    return '\uFEFF' + rows.join('\r\n');
  }

  // Canvas gradebook import CSV: Canvas matches rows on the ID columns \u2014
  // SIS Login ID is usually the school email. The "Points Possible" row is
  // part of Canvas's expected format.
  function buildCanvasGradebookCsv(parts, activeRoster, opts) {
    opts = opts || {};
    const assignmentName = `${opts.meetingTitle || 'Google Meet'} attendance`;
    const rows = [
      ['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section', assignmentName].map(escapeCsv).join(','),
      ['Points Possible', '', '', '', '', 100].map(escapeCsv).join(','),
    ];
    for (const r of buildLmsGradebookRows(parts, activeRoster, opts)) {
      rows.push([r.name, '', '', r.email, '', r.grade].map(escapeCsv).join(','));
    }
    return '\uFEFF' + rows.join('\r\n');
  }

  const api = {
    escHtml, escJsArg, formatRelative, fmtTime, fmtDur, fmtDurMs, isoFmt, datestamp,
    latenessMin, avatarColor, participantKey, distinctAttendees,
    autoMatchAttendees, participantTotalMs, isSelfParticipant,
    isValidSlackWebhook, isValidGoogleChatWebhook, isValidDiscordWebhook, maskWebhookUrl,
    serializeSession, parseSession,
    parseStudentsInput, findParticipantForStudent, buildAttendanceCsv,
    splitName, buildLmsGradebookRows, buildMoodleGradebookCsv, buildCanvasGradebookCsv, escapeCsv,
    LATE_THRESHOLD_MIN, AVATAR_PALETTE, SLACK_WEBHOOK_PREFIX, CHAT_WEBHOOK_PREFIX, DISCORD_WEBHOOK_PREFIXES,
  };

  root.AttUtils = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
