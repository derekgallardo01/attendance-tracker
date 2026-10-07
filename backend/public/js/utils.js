// Pure, dependency-free helpers shared by index.html (loaded as a <script src>)
// and the Jest jsdom unit tests. NO references to `state`, `APP_CONFIG`, DOM
// nodes, or other inline-script globals — everything takes its data as args.
//
// Exposed as both `window.AttUtils` (for the browser) and `module.exports`
// (for Jest). The inline script in index.html re-declares thin wrappers for
// each function so existing call sites don't have to change.

(function (root) {
  'use strict';

  function t(key, fallback) {
    if (typeof root !== 'undefined' && typeof root.t === 'function') {
      return root.t(key, fallback);
    }
    return fallback;
  }

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

  const CSV_HEADER_LOCALIZATIONS = {
    "es": Object.assign(["Nombre","Correo","Estado","% Asistencia","Duración (min)","Hora de Entrada","Hora de Salida","Reingresos","Notas"], { meeting: ["Nombre","Correo","Estado","Estado de RSVP","Hora de entrada","Hora de salida","Duración (min)"], series: ["Nombre","Correo","Asistió","Ausente","% Asistencia","Minutos totales"] }),
    "pt": Object.assign(["Nome","E-mail","Status","% Presença","Duração (min)","Horário de Entrada","Horário de Saída","Reconexões","Notas"], { meeting: ["Nome","E-mail","Status","Status RSVP","Horário de entrada","Horário de saída","Duração (min)"], series: ["Nome","E-mail","Compareceu","Ausente","% Presença","Minutos totais"] }),
    "hi": Object.assign(["नाम","ईमेल","स्थिति","उपस्थिति %","अवधि (मिनट)","शामिल होने का समय","छोड़ने का समय","सत्र","Notes"], { meeting: ["नाम","ईमेल","स्थिति","RSVP स्थिति","शामिल होने का समय","छोड़ने का समय","अवधि (मिनट)"], series: ["नाम","ईमेल","Attended","Missed","उपस्थिति %","Total minutes"] }),
    "ta": Object.assign(["பெயர்","மின்னஞ்சல்","நிலை","வருகை %","காலம் (நிமிடம்)","சேர்ந்த நேரம்","வெளியேறிய நேரம்","அமர்வுகள்","Notes"], { meeting: ["பெயர்","மின்னஞ்சல்","நிலை","RSVP நிலை","சேர்ந்த நேரம்","வெளியேறிய நேரம்","காலம் (நிமிடம்)"], series: ["பெயர்","மின்னஞ்சல்","Attended","Missed","வருகை %","Total minutes"] }),
    "te": Object.assign(["పేరు","ఇమెయిల్","స్థితి","హాజరు %","వ్యవధి (నిమి)","చేరిన సమయం","నిష్క్రమించిన సమయం","సెషన్‌లు","Notes"], { meeting: ["పేరు","ఇమెయిల్","స్థితి","RSVP స్థితి","చేరిన సమయం","నిష్క్రమించిన సమయం","వ్యవధి (నిమి)"], series: ["పేరు","ఇమెయిల్","Attended","Missed","హాజరు %","Total minutes"] }),
    "bn": Object.assign(["নাম","ইমেইল","অবস্থা","উপস্থিতি %","সময়কাল (মিনিট)","যোগদানের সময়","ত্যাগের সময়","সেশন","Notes"], { meeting: ["নাম","ইমেইল","অবস্থা","RSVP অবস্থা","যোগদানের সময়","ত্যাগের সময়","সময়কাল (মিনিট)"], series: ["নাম","ইমেইল","Attended","Missed","উপস্থিতি %","Total minutes"] }),
    "ur": Object.assign(["نام","ای میل","حیثیت","حاضری %","مدت (منٹ)","شمولیت کا وقت","چھوڑنے کا وقت","سیشنز","Notes"], { meeting: ["نام","ای میل","حیثیت","RSVP کی حیثیت","شمولیت کا وقت","چھوڑنے کا وقت","مدت (منٹ)"], series: ["نام","ای میل","Attended","Missed","حاضری %","Total minutes"] }),
    "tl": Object.assign(["Pangalan","Email","Katayuan","Attendance %","Tagal (min)","Oras ng pagsali","Oras ng pag-alis","Mga session","Notes"], { meeting: ["Pangalan","Email","Katayuan","Katayuan ng RSVP","Oras ng pagsali","Oras ng pag-alis","Tagal (min)"], series: ["Pangalan","Email","Attended","Missed","Attendance %","Total minutes"] }),
    "ms": Object.assign(["Nama","E-mel","Status","Kehadiran %","Tempoh (min)","Masa sertai","Masa keluar","Sesi","Notes"], { meeting: ["Nama","E-mel","Status","Status RSVP","Masa sertai","Masa keluar","Tempoh (min)"], series: ["Nama","E-mel","Attended","Missed","Kehadiran %","Total minutes"] }),
    "id": Object.assign(["Nama","Email","Status","Kehadiran %","Durasi (menit)","Waktu bergabung","Waktu keluar","Sesi","Notes"], { meeting: ["Nama","Email","Status","Status RSVP","Waktu bergabung","Waktu keluar","Durasi (menit)"], series: ["Nama","Email","Attended","Missed","Kehadiran %","Total minutes"] }),
    "vi": Object.assign(["Tên","Email","Trạng thái","% Tham dự","Thời lượng (phút)","Thời gian tham gia","Thời gian rời đi","Phiên","Notes"], { meeting: ["Tên","Email","Trạng thái","Trạng thái RSVP","Thời gian tham gia","Thời gian rời đi","Thời lượng (phút)"], series: ["Tên","Email","Attended","Missed","% Tham dự","Total minutes"] }),
    "fr": Object.assign(["Nom","E-mail","Statut","% Présence","Durée (min)","Heure d'Arrivée","Heure de Départ","Reconnexions","Remarques"], { meeting: ["Nom","E-mail","Statut","Statut RSVP","Heure d'arrivée","Heure de départ","Durée (min)"], series: ["Nom","E-mail","Présent","Absent","% Présence","Minutes totales"] }),
    "de": Object.assign(["Name","E-Mail","Status","Anwesenheit %","Dauer (Min.)","Beitrittszeit","Verlassenszeit","Wiedereintritte","Notizen"], { meeting: ["Name","E-Mail","Status","RSVP-Status","Beitrittszeit","Verlassenszeit","Dauer (Min.)"], series: ["Name","E-Mail","Anwesend","Abwesend","Anwesenheit %","Gesamtminuten"] }),
    "it": Object.assign(["Nome","E-mail","Stato","% Presenze","Durata (min)","Ora di Entrata","Ora di Uscita","Riconnessioni","Note"], { meeting: ["Nome","Email","Stato","Stato RSVP","Ora di accesso","Ora di uscita","Durata (min)"], series: ["Nome","Email","Presente","Assente","Presenza %","Minuti totali"] }),
    "nl": Object.assign(["Naam","E-mail","Status","Aanwezigheid %","Duur (min)","Tijdstip van deelnemen","Tijdstip van verlaten","Sessies","Notes"], { meeting: ["Naam","E-mail","Status","RSVP-status","Tijdstip van deelnemen","Tijdstip van verlaten","Duur (min)"], series: ["Naam","E-mail","Attended","Missed","Aanwezigheid %","Total minutes"] }),
    "pl": Object.assign(["Imię i nazwisko","E-mail","Status","Obecność %","Czas trwania (min)","Czas dołączenia","Czas opuszczenia","Sesje","Notes"], { meeting: ["Imię i nazwisko","E-mail","Status","Status RSVP","Czas dołączenia","Czas opuszczenia","Czas trwania (min)"], series: ["Imię i nazwisko","E-mail","Attended","Missed","Obecność %","Total minutes"] }),
    "ro": Object.assign(["Nume","Email","Stare","Prezență %","Durată (min)","Ora conectării","Ora deconectării","Sesiuni","Notes"], { meeting: ["Nume","Email","Stare","Stare RSVP","Ora conectării","Ora deconectării","Durată (min)"], series: ["Nume","Email","Attended","Missed","Prezență %","Total minutes"] }),
    "ru": Object.assign(["Имя","E-mail","Статус","Посещаемость %","Длительность (мин)","Время входа","Время выхода","Сессии","Notes"], { meeting: ["Имя","E-mail","Статус","Статус RSVP","Время входа","Время выхода","Длительность (мин)"], series: ["Имя","E-mail","Attended","Missed","Посещаемость %","Total minutes"] }),
    "uk": Object.assign(["Ім'я","Ел. пошта","Статус","Відвідуваність %","Тривалість (хв)","Час приєднання","Час відключення","Сесії","Notes"], { meeting: ["Ім'я","Ел. пошта","Статус","Статус RSVP","Час приєднання","Час відключення","Тривалість (хв)"], series: ["Ім'я","Ел. пошта","Attended","Missed","Відвідуваність %","Total minutes"] }),
    "tr": Object.assign(["Ad","E-posta","Durum","Katılım %","Süre (dk)","Katılma saati","Ayrılma saati","Oturumlar","Notes"], { meeting: ["Ad","E-posta","Durum","RSVP Durumu","Katılma saati","Ayrılma saati","Süre (dk)"], series: ["Ad","E-posta","Attended","Missed","Katılım %","Total minutes"] }),
    "th": Object.assign(["ชื่อ","อีเมล","สถานะ","การเข้าร่วม %","ระยะเวลา (นาที)","เวลาเข้าร่วม","เวลาออก","เซสชัน","Notes"], { meeting: ["ชื่อ","อีเมล","สถานะ","สถานะ RSVP","เวลาเข้าร่วม","เวลาออก","ระยะเวลา (นาที)"], series: ["ชื่อ","อีเมล","Attended","Missed","การเข้าร่วม %","Total minutes"] }),
    "ar": Object.assign(["الاسم","البريد الإلكتروني","الحالة","نسبة الحضور %","المدة (دقيقة)","وقت الانضمام","وقت المغادرة","الجلسات","Notes"], { meeting: ["الاسم","البريد الإلكتروني","الحالة","حالة الرد","وقت الانضمام","وقت المغادرة","المدة (دقيقة)"], series: ["الاسم","البريد الإلكتروني","Attended","Missed","نسبة الحضور %","Total minutes"] }),
    "ko": Object.assign(["이름","이메일","상태","출석률 %","시간 (분)","참여 시간","퇴장 시간","세션","Notes"], { meeting: ["이름","이메일","상태","RSVP 상태","참여 시간","퇴장 시간","시간 (분)"], series: ["이름","이메일","Attended","Missed","출석률 %","Total minutes"] }),
    "zh": Object.assign(["姓名","電子郵件","狀態","出席率 %","時長 (分鐘)","加入時間","離開時間","會議場次","Notes"], { meeting: ["姓名","電子郵件","狀態","RSVP 狀態","加入時間","離開時間","時長 (分鐘)"], series: ["姓名","電子郵件","Attended","Missed","出席率 %","Total minutes"] }),
    "zh-CN": Object.assign(["姓名","电子邮件","状态","出席率 %","时长 (分钟)","加入时间","离开时间","会议场次","Notes"], { meeting: ["姓名","电子邮件","状态","RSVP 状态","加入时间","离开时间","时长 (分钟)"], series: ["姓名","电子邮件","Attended","Missed","出席率 %","Total minutes"] }),
    "ja": Object.assign(["氏名","メールアドレス","ステータス","出席率 %","滞在時間 (分)","参加時間","退出時間","セッション数","Notes"], { meeting: ["氏名","メールアドレス","ステータス","RSVPステータス","参加時間","退出時間","滞在時間 (分)"], series: ["氏名","メールアドレス","Attended","Missed","出席率 %","Total minutes"] }),
    "he": Object.assign(["שם","אימייל","סטטוס","% נוכחות","משך (דקות)","זמן כניסה","זמן עזיבה","מפגשים","Notes"], { meeting: ["שם","אימייל","סטטוס","סטטוס אישור","זמן כניסה","זמן עזיבה","משך (דקות)"], series: ["שם","אימייל","Attended","Missed","% נוכחות","Total minutes"] }),
    "mr": Object.assign(["नाव","ईमेल","स्थिती","उपस्थिती %","कालावधी (मिनिटे)","सामील होण्याची वेळ","सोडण्याची वेळ","सत्रे","Notes"], { meeting: ["नाव","ईमेल","स्थिती","RSVP स्थिती","सामील होण्याची वेळ","सोडण्याची वेळ","कालावधी (मिनिटे)"], series: ["नाव","ईमेल","Attended","Missed","उपस्थिती %","Total minutes"] }),
    "sv": Object.assign(["Namn","E-post","Status","Närvaro %","Längd (min)","Ankomsttid","Lämningstid","Sessioner","Notes"], { meeting: ["Namn","E-post","Status","RSVP-status","Ankomsttid","Lämningstid","Längd (min)"], series: ["Namn","E-post","Attended","Missed","Närvaro %","Total minutes"] }),
    "cs": Object.assign(["Jméno","E-mail","Stav","Docházka %","Délka (min)","Čas připojení","Čas odpojení","Relace","Notes"], { meeting: ["Jméno","E-mail","Stav","Stav RSVP","Čas připojení","Čas odpojení","Délka (min)"], series: ["Jméno","E-mail","Attended","Missed","Docházka %","Total minutes"] }),
    "da": Object.assign(["Navn","E-mail","Status","Fremmøde %","Varighed (min)","Tidspunkt for tilslutning","Tidspunkt for afgang","Sessioner","Notes"], { meeting: ["Navn","E-mail","Status","RSVP-status","Tidspunkt for tilslutning","Tidspunkt for afgang","Varighed (min)"], series: ["Navn","E-mail","Attended","Missed","Fremmøde %","Total minutes"] }),
    "fi": Object.assign(["Nimi","Sähköposti","Tila","Läsnäolo %","Kesto (min)","Liittymisaika","Poistumisaika","Istunnot","Notes"], { meeting: ["Nimi","Sähköposti","Tila","RSVP-tila","Liittymisaika","Poistumisaika","Kesto (min)"], series: ["Nimi","Sähköposti","Attended","Missed","Läsnäolo %","Total minutes"] }),
    "hu": Object.assign(["Név","E-mail","Állapot","Részvétel %","Időtartam (perc)","Csatlakozás ideje","Távozás ideje","Munkamenetek","Notes"], { meeting: ["Név","E-mail","Állapot","RSVP állapot","Csatlakozás ideje","Távozás ideje","Időtartam (perc)"], series: ["Név","E-mail","Attended","Missed","Részvétel %","Total minutes"] }),
    "so": Object.assign(["Magaca","Emailka","Xaaladda","Xaadirinta %","Muddada (daqiiqo)","Waqtiga ku biirista","Waqtiga ka bixitaanka","Kulamada","Notes"], { meeting: ["Magaca","Emailka","Xaaladda","Xaaladda RSVP","Waqtiga ku biirista","Waqtiga ka bixitaanka","Muddada (daqiiqo)"], series: ["Magaca","Emailka","Attended","Missed","Xaadirinta %","Total minutes"] }),
    "sw": Object.assign(["Jina","Barua pepe","Hali","% ya Mahudhurio","Muda (dakika)","Wakati wa Kujiunga","Wakati wa Kuondoka","Vipindi","Notes"], { meeting: ["Jina","Barua pepe","Hali","Hali ya RSVP","Wakati wa Kujiunga","Wakati wa Kuondoka","Muda (dakika)"], series: ["Jina","Barua pepe","Attended","Missed","% ya Mahudhurio","Total minutes"] }),
    "am": Object.assign(["ስም","ኢሜይል","ሁኔታ","የተሳትፎ %","ቆይታ (ደቂቃ)","የመቀላቀያ ሰዓት","የመውጫ ሰዓት","ክፍለ-ጊዜዎች","Notes"], { meeting: ["ስም","ኢሜይል","ሁኔታ","የRSVP ሁኔታ","የመቀላቀያ ሰዓት","የመውጫ ሰዓት","ቆይታ (ደቂቃ)"], series: ["ስም","ኢሜይል","Attended","Missed","የተሳትፎ %","Total minutes"] }),
    "si": Object.assign(["නම","විද්‍යුත් තැපෑල","තත්වය","පැමිණීම %","කාලය (මිනි)","සම්බන්ධ වූ වේලාව","ඉවත් වූ වේලාව","සැසි","Notes"], { meeting: ["නම","විද්‍යුත් තැපෑල","තත්වය","RSVP තත්වය","සම්බන්ධ වූ වේලාව","ඉවත් වූ වේලාව","කාලය (මිනි)"], series: ["නම","විද්‍යුත් තැපෑල","Attended","Missed","පැමිණීම %","Total minutes"] }),
    "el": Object.assign(["Όνομα","Email","Κατάσταση","% Παρουσίας","Διάρκεια (λεπτά)","Ώρα εισόδου","Ώρα εξόδου","Συνεδρίες","Notes"], { meeting: ["Όνομα","Email","Κατάσταση","Κατάσταση RSVP","Ώρα εισόδου","Ώρα εξόδου","Διάρκεια (λεπτά)"], series: ["Όνομα","Email","Attended","Missed","% Παρουσίας","Total minutes"] }),
    "no": Object.assign(["Navn","E-post","Status","Oppmøte %","Varighet (min)","Tidspunkt tilkoblet","Tidspunkt frakoblet","Økter","Notes"], { meeting: ["Navn","E-post","Status","RSVP-status","Tidspunkt tilkoblet","Tidspunkt frakoblet","Varighet (min)"], series: ["Navn","E-post","Attended","Missed","Oppmøte %","Total minutes"] }),
    "ca": Object.assign(["Nom","Correu electrònic","Estat","% Assistència","Durada (min)","Hora d'entrada","Hora de sortida","Sessions","Notes"], { meeting: ["Nom","Correu electrònic","Estat","Estat RSVP","Hora d'entrada","Hora de sortida","Durada (min)"], series: ["Nom","Correu electrònic","Attended","Missed","% Assistència","Total minutes"] }),
    "ne": Object.assign(["नाम","इमेल","स्थिति","उपस्थिति %","अवधि (मिनेट)","सामेल भएको समय","छोडेको समय","सत्रहरू","Notes"], { meeting: ["नाम","इमेल","स्थिति","RSVP स्थिति","सामेल भएको समय","छोडेको समय","अवधि (मिनेट)"], series: ["नाम","इमेल","Attended","Missed","उपस्थिति %","Total minutes"] }),
    "ml": Object.assign(["പേര്","ഇമെയിൽ","സ്റ്റാറ്റസ്","ഹാജർ %","ദൈർഘ്യം (മിനിറ്റ്)","ചേർന്ന സമയം","ഇറങ്ങിയ സമയം","സെഷനുകൾ","Notes"], { meeting: ["പേര്","ഇമെയിൽ","സ്റ്റാറ്റസ്","RSVP സ്റ്റാറ്റസ്","ചേർന്ന സമയം","ഇറങ്ങിയ സമയം","ദൈർഘ്യം (മിനിറ്റ്)"], series: ["പേര്","ഇമെയിൽ","Attended","Missed","ഹാജർ %","Total minutes"] }),
    "mn": Object.assign(["Нэр","Имэйл","Төлөв","Ирц %","Хугацаа (мин)","Нэвтэрсэн цаг","Гарсан цаг","Хичээлүүд","Notes"], { meeting: ["Нэр","Имэйл","Төлөв","RSVP төлөв","Нэвтэрсэн цаг","Гарсан цаг","Хугацаа (мин)"], series: ["Нэр","Имэйл","Attended","Missed","Ирц %","Total minutes"] }),
    "kn": Object.assign(["ಹೆಸರು","ಇಮೇಲ್","ಸ್ಥಿತಿ","ಹಾಜರಾತಿ %","ಅವಧಿ (ನಿಮಿಷ)","ಸೇರಿದ ಸಮಯ","ನಿರ್ಗಮಿಸಿದ ಸಮಯ","ಅಧಿವೇಶನಗಳು","Notes"], { meeting: ["ಹೆಸರು","ಇಮೇಲ್","ಸ್ಥಿತಿ","RSVP ಸ್ಥಿತಿ","ಸೇರಿದ ಸಮಯ","ನಿರ್ಗಮಿಸಿದ ಸಮಯ","ಅವಧಿ (ನಿಮಿಷ)"], series: ["ಹೆಸರು","ಇಮೇಲ್","Attended","Missed","ಹಾಜರಾತಿ %","Total minutes"] }),
    "gu": Object.assign(["નામ","ઇમેઇલ","સ્થિતિ","હાજરી %","સમયગાળો (મિનિટ)","જોડાયાનો સમય","છોડ્યાનો સમય","સત્રો","Notes"], { meeting: ["નામ","ઇમેઇલ","સ્થિતિ","RSVP સ્થિતિ","જોડાયાનો સમય","છોડ્યાનો સમય","સમયગાળો (મિનિટ)"], series: ["નામ","ઇમેઇલ","Attended","Missed","હાજરી %","Total minutes"] }),
    "pa": Object.assign(["ਨਾਮ","ਈਮੇਲ","ਸਥਿਤੀ","ਹਾਜ਼ਰੀ %","ਮਿਆਦ (ਮਿੰਟ)","ਸ਼ਾਮਲ ਹੋਣ ਦਾ ਸਮਾਂ","ਛੱਡਣ ਦਾ ਸਮਾਂ","ਸੈਸ਼ਨ","Notes"], { meeting: ["ਨਾਮ","ਈਮੇਲ","ਸਥਿਤੀ","RSVP ਸਥਿਤੀ","ਸ਼ਾਮਲ ਹੋਣ ਦਾ ਸਮਾਂ","ਛੱਡਣ ਦਾ ਸਮਾਂ","ਮਿਆਦ (ਮਿੰਟ)"], series: ["ਨਾਮ","ਈਮੇਲ","Attended","Missed","ਹਾਜ਼ਰੀ %","Total minutes"] }),
    "kk": Object.assign(["Аты-жөні","Эл. пошта","Күйі","Қатысу %","Ұзақтығы (мин)","Қосылу уақыты","Шығу уақыты","Сессиялар","Notes"], { meeting: ["Аты-жөні","Эл. пошта","Күйі","RSVP күйі","Қосылу уақыты","Шығу уақыты","Ұзақтығы (мин)"], series: ["Аты-жөні","Эл. пошта","Attended","Missed","Қатысу %","Total minutes"] }),
    "lv": Object.assign(["Vārds","E-pasts","Statuss","Apmeklējums %","Ilgums (min)","Pievienošanās laiks","Izrakstīšanās laiks","Sesijas","Notes"], { meeting: ["Vārds","E-pasts","Statuss","RSVP statuss","Pievienošanās laiks","Izrakstīšanās laiks","Ilgums (min)"], series: ["Vārds","E-pasts","Attended","Missed","Apmeklējums %","Total minutes"] }),
    "lt": Object.assign(["Vardas","El. paštas","Būsena","Lankomumas %","Trukmė (min.)","Prisijungimo laikas","Atsijungimo laikas","Sesijos","Notes"], { meeting: ["Vardas","El. paštas","Būsena","RSVP būsena","Prisijungimo laikas","Atsijungimo laikas","Trukmė (min.)"], series: ["Vardas","El. paštas","Attended","Missed","Lankomumas %","Total minutes"] }),
    "lo": Object.assign(["ຊື່","ອີເມວ","ສະຖານະ","ການເຂົ້າຮ່ວມ %","ໄລຍະເວລາ (ນາທີ)","ເວລາເຂົ້າຮ່ວມ","ເວລາອອກ","ຮອບການປະຊຸມ","Notes"], { meeting: ["ຊື່","ອີເມວ","ສະຖານະ","ສະຖານະ RSVP","ເວລາເຂົ້າຮ່ວມ","ເວລາອອກ","ໄລຍະເວລາ (ນາທີ)"], series: ["ຊື່","ອີເມວ","Attended","Missed","ການເຂົ້າຮ່ວມ %","Total minutes"] }),
    "my": Object.assign(["အမည်","အီးမေးလ်","အခြေအနေ","တက်ရောက်မှု %","ကြာချိန် (မိနစ်)","ဝင်ရောက်ချိန်","ထွက်ခွာချိန်","စက်ရှင်များ","Notes"], { meeting: ["အမည်","အီးမေးလ်","အခြေအနေ","RSVP အခြေအနေ","ဝင်ရောက်ချိန်","ထွက်ခွာချိန်","ကြာချိန် (မိနစ်)"], series: ["အမည်","အီးမေးလ်","Attended","Missed","တက်ရောက်မှု %","Total minutes"] }),
    "km": Object.assign(["ឈ្មោះ","អ៊ីមែល","ស្ថានភាព","វត្តមាន %","រយៈពេល (នាទី)","ម៉ោងចូលរួម","ម៉ោងចាកចេញ","វគ្គប្រជុំ","Notes"], { meeting: ["ឈ្មោះ","អ៊ីមែល","ស្ថានភាព","ស្ថានភាព RSVP","ម៉ោងចូលរួម","ម៉ោងចាកចេញ","រយៈពេល (នាទី)"], series: ["ឈ្មោះ","អ៊ីមែល","Attended","Missed","វត្តមាន %","Total minutes"] }),
    "ceb": Object.assign(["Ngalan","Email","Kahimtang","Pagtambong %","Gidugayon (min)","Oras sa Pagsulod","Oras sa Paggula","Mga Sesyon","Notes"], { meeting: ["Ngalan","Email","Kahimtang","Kahimtang sa RSVP","Oras sa Pagsulod","Oras sa Paggula","Gidugayon (min)"], series: ["Ngalan","Email","Attended","Missed","Pagtambong %","Total minutes"] }),
    "bg": Object.assign(["Име","Имейл","Статус","Присъствие %","Продължителност (мин)","Време на присъединяване","Време на напускане","Сесии","Notes"], { meeting: ["Име","Имейл","Статус","RSVP статус","Време на присъединяване","Време на напускане","Продължителност (мин)"], series: ["Име","Имейл","Attended","Missed","Присъствие %","Total minutes"] }),
    "hr": Object.assign(["Ime","E-pošta","Status","Prisutnost %","Trajanje (min)","Vrijeme ulaska","Vrijeme izlaska","Sesije","Notes"], { meeting: ["Ime","E-pošta","Status","RSVP status","Vrijeme ulaska","Vrijeme izlaska","Trajanje (min)"], series: ["Ime","E-pošta","Attended","Missed","Prisutnost %","Total minutes"] }),
    "sr": Object.assign(["Име","Е-пошта","Статус","Присуство %","Трајање (мин)","Време приступања","Време напуштања","Сесије","Notes"], { meeting: ["Име","Е-пошта","Статус","RSVP статус","Време приступања","Време напуштања","Трајање (мин)"], series: ["Име","Е-пошта","Attended","Missed","Присуство %","Total minutes"] }),
    "sk": Object.assign(["Meno","E-mail","Stav","Účasť %","Trvanie (min)","Čas pripojenia","Čas odchodu","Relácie","Notes"], { meeting: ["Meno","E-mail","Stav","Stav RSVP","Čas pripojenia","Čas odchodu","Trvanie (min)"], series: ["Meno","E-mail","Attended","Missed","Účasť %","Total minutes"] }),
    "sl": Object.assign(["Ime","E-pošta","Stanje","Prisotnost %","Trajanje (min)","Čas pridružitve","Čas odhoda","Seje","Notes"], { meeting: ["Ime","E-pošta","Stanje","Stanje RSVP","Čas pridružitve","Čas odhoda","Trajanje (min)"], series: ["Ime","E-pošta","Attended","Missed","Prisotnost %","Total minutes"] }),
    "af": Object.assign(["Naam","E-pos","Status","Bywoning %","Duur (min)","Aansluittyd","Verlaattyd","Sessies","Notes"], { meeting: ["Naam","E-pos","Status","RSVP-status","Aansluittyd","Verlaattyd","Duur (min)"], series: ["Naam","E-pos","Attended","Missed","Bywoning %","Total minutes"] }),
  };

  const CSV_STATUS_LOCALIZATIONS = {
    "es": {
      "Present": "Presente",
      "Left": "Salió",
      "Present (Left)": "Presente (Salió)",
      "Left Early / Incomplete": "Salió antes / Incompleto",
      "Late": "Tarde",
      "Excused (Short Stay)": "Justificado (Estadía corta)",
      "Absent": "Ausente",
      "Absent (Excused)": "Ausente (Justificado)",
      "Guest (Present)": "Invitado (Presente)",
      "Guest (Left)": "Invitado (Salió)",
      "Absent (excused)": "Ausente (Justificado)"
    },
    "pt": {
      "Present": "Presente",
      "Left": "Saiu",
      "Present (Left)": "Presente (Saiu)",
      "Left Early / Incomplete": "Saiu antes / Incompleto",
      "Late": "Atrasado",
      "Excused (Short Stay)": "Justificado (Estadia curta)",
      "Absent": "Ausente",
      "Absent (Excused)": "Ausente (Justificado)",
      "Guest (Present)": "Convidado (Presente)",
      "Guest (Left)": "Convidado (Saiu)",
      "Absent (excused)": "Ausente (Justificado)"
    },
    "hi": {
      "Present": "उपस्थित",
      "Left": "छोड़ दिया",
      "Present (Left)": "उपस्थित (छोड़ा)",
      "Left Early / Incomplete": "जल्दी छोड़ा / अधूरा",
      "Late": "देर",
      "Excused (Short Stay)": "माफ (कम समय)",
      "Absent": "अनुपस्थित",
      "Absent (Excused)": "अनुपस्थित (माफ)",
      "Absent (excused)": "अनुपस्थित (माफ)",
      "Guest (Present)": "अतिथि (उपस्थित)",
      "Guest (Left)": "अतिथि (छोड़ा)"
    },
    "ta": {
      "Present": "வந்தவர் (Present)",
      "Left": "வெளியேறினார்",
      "Present (Left)": "வந்தவர் (வெளியேறினார்)",
      "Left Early / Incomplete": "முன்னதாக வெளியேறினார் / முழுமையடையவில்லை",
      "Late": "தாமதம்",
      "Excused (Short Stay)": "விலக்களிக்கப்பட்டது (குறுகிய தங்கல்)",
      "Absent": "வராதவர் (Absent)",
      "Absent (Excused)": "வராதவர் (விலக்களிக்கப்பட்டவர்)",
      "Absent (excused)": "வராதவர் (விலக்களிக்கப்பட்டவர்)",
      "Guest (Present)": "விருந்தினர் (வந்தவர்)",
      "Guest (Left)": "விருந்தினர் (வெளியேறினார்)"
    },
    "te": {
      "Present": "హాజరయ్యారు (Present)",
      "Left": "నిష్క్రమించారు",
      "Present (Left)": "హాజరయ్యారు (నిష్క్రమించారు)",
      "Left Early / Incomplete": "ముందుగానే నిష్క్రమించారు / అసంపూర్ణం",
      "Late": "ఆలస్యం",
      "Excused (Short Stay)": "క్షమించబడింది (స్వల్ప బస)",
      "Absent": "హాజరుకాలేదు (Absent)",
      "Absent (Excused)": "హాజరుకాలేదు (క్షమించబడింది)",
      "Absent (excused)": "హాజరుకాలేదు (క్షమించబడింది)",
      "Guest (Present)": "అతిథి (హాజరయ్యారు)",
      "Guest (Left)": "అతిథి (నిష్క్రమించారు)"
    },
    "bn": {
      "Present": "উপস্থিত",
      "Left": "চলে গেছে",
      "Present (Left)": "উপস্থিত (চলে গেছে)",
      "Left Early / Incomplete": "আগে চলে গেছে / অসম্পূর্ণ",
      "Late": "দেরি",
      "Excused (Short Stay)": "অনুমোদিত (স্বল্প সময়)",
      "Absent": "অনুপস্থিত",
      "Absent (Excused)": "অনুপস্থিত (অনুমোদিত)",
      "Absent (excused)": "অনুপস্থিত (অনুমোদিত)",
      "Guest (Present)": "অতিথি (উপস্থিত)",
      "Guest (Left)": "অতিথি (চলে গেছে)"
    },
    "ur": {
      "Present": "حاضر (Present)",
      "Left": "چھوڑ دیا",
      "Present (Left)": "حاضر (چھوڑ دیا)",
      "Left Early / Incomplete": "جلدی چلے گئے / نامکمل",
      "Late": "تاخیر",
      "Excused (Short Stay)": "معذرت (مختصر قیام)",
      "Absent": "غیر حاضر (Absent)",
      "Absent (Excused)": "غیر حاضر (معذرت)",
      "Absent (excused)": "غیر حاضر (معذرت)",
      "Guest (Present)": "مہمان (حاضر)",
      "Guest (Left)": "مہمان (چھوڑ دیا)"
    },
    "tl": {
      "Present": "Dumalo (Present)",
      "Left": "Umalis",
      "Present (Left)": "Dumalo (Umalis)",
      "Left Early / Incomplete": "Umalis nang Maaga / Hindi Kumpleto",
      "Late": "Huli (Late)",
      "Excused (Short Stay)": "May Paumanhin (Maikling Pananatili)",
      "Absent": "Liban (Absent)",
      "Absent (Excused)": "Liban (may paumanhin)",
      "Absent (excused)": "Liban (may paumanhin)",
      "Guest (Present)": "Bisita (Dumalo)",
      "Guest (Left)": "Bisita (Umalis)"
    },
    "ms": {
      "Present": "Hadir",
      "Left": "Keluar",
      "Present (Left)": "Hadir (Keluar)",
      "Left Early / Incomplete": "Keluar Awal / Tidak Lengkap",
      "Late": "Lewat",
      "Excused (Short Stay)": "Dikecualikan (Tinggal Singkat)",
      "Absent": "Tidak Hadir",
      "Absent (Excused)": "Tidak Hadir (bersebab)",
      "Absent (excused)": "Tidak Hadir (bersebab)",
      "Guest (Present)": "Tetamu (Hadir)",
      "Guest (Left)": "Tetamu (Keluar)"
    },
    "id": {
      "Present": "Hadir",
      "Left": "Keluar",
      "Present (Left)": "Hadir (Keluar)",
      "Left Early / Incomplete": "Keluar Lebih Awal / Tidak Lengkap",
      "Late": "Terlambat",
      "Excused (Short Stay)": "Izin (Tinggal Singkat)",
      "Absent": "Tidak Hadir",
      "Absent (Excused)": "Tidak Hadir (izin)",
      "Absent (excused)": "Tidak Hadir (izin)",
      "Guest (Present)": "Tamu (Hadir)",
      "Guest (Left)": "Tamu (Keluar)"
    },
    "vi": {
      "Present": "Có mặt",
      "Left": "Đã rời",
      "Present (Left)": "Có mặt (Đã rời)",
      "Left Early / Incomplete": "Rời sớm / Chưa hoàn thành",
      "Late": "Đi muộn",
      "Excused (Short Stay)": "Có phép (Ở lại ngắn)",
      "Absent": "Vắng mặt",
      "Absent (Excused)": "Vắng mặt (có phép)",
      "Absent (excused)": "Vắng mặt (có phép)",
      "Guest (Present)": "Khách (Có mặt)",
      "Guest (Left)": "Khách (Đã rời)"
    },
    "fr": {
      "Present": "Présent",
      "Left": "Parti",
      "Present (Left)": "Présent (Parti)",
      "Left Early / Incomplete": "Parti plus tôt / Incomplet",
      "Late": "En retard",
      "Excused (Short Stay)": "Excusé (Court séjour)",
      "Absent": "Absent",
      "Absent (Excused)": "Absent (Excusé)",
      "Guest (Present)": "Invité (Présent)",
      "Guest (Left)": "Invité (Parti)",
      "Absent (excused)": "Absent (Excusé)"
    },
    "de": {
      "Present": "Anwesend",
      "Left": "Verlassen",
      "Present (Left)": "Anwesend (Verlassen)",
      "Left Early / Incomplete": "Frühzeitig verlassen / Unvollständig",
      "Late": "Verspätet",
      "Excused (Short Stay)": "Entschuldigt (Kurzer Aufenthalt)",
      "Absent": "Abwesend",
      "Absent (Excused)": "Abwesend (Entschuldigt)",
      "Guest (Present)": "Gast (Anwesend)",
      "Guest (Left)": "Gast (Verlassen)",
      "Absent (excused)": "Abwesend (Entschuldigt)"
    },
    "it": {
      "Present": "Presente",
      "Left": "Uscito",
      "Present (Left)": "Presente (Uscito)",
      "Left Early / Incomplete": "Uscito prima / Incompleto",
      "Late": "In ritardo",
      "Excused (Short Stay)": "Giustificato (Breve permanenza)",
      "Absent": "Assente",
      "Absent (Excused)": "Assente (Giustificato)",
      "Guest (Present)": "Ospite (Presente)",
      "Guest (Left)": "Ospite (Uscito)",
      "Absent (excused)": "Assente (Giustificato)"
    },
    "nl": {
      "Present": "Aanwezig",
      "Left": "Verlaten",
      "Present (Left)": "Aanwezig (Verlaten)",
      "Left Early / Incomplete": "Vroegtijdig verlaten / Onvolledig",
      "Late": "Te laat",
      "Excused (Short Stay)": "Vrijgesteld (Kort verblijf)",
      "Absent": "Afwezig",
      "Absent (Excused)": "Afwezig (met kennisgeving)",
      "Absent (excused)": "Afwezig (met kennisgeving)",
      "Guest (Present)": "Gast (Aanwezig)",
      "Guest (Left)": "Gast (Verlaten)"
    },
    "pl": {
      "Present": "Obecny",
      "Left": "Opuścił",
      "Present (Left)": "Obecny (Opuścił)",
      "Left Early / Incomplete": "Wyszedł wcześniej / Niepełny czas",
      "Late": "Spóźniony",
      "Excused (Short Stay)": "Usprawiedliwiony (Krótki pobyt)",
      "Absent": "Nieobecny",
      "Absent (Excused)": "Nieobecny (usprawiedliwiony)",
      "Absent (excused)": "Nieobecny (usprawiedliwiony)",
      "Guest (Present)": "Gość (Obecny)",
      "Guest (Left)": "Gość (Opuścił)"
    },
    "ro": {
      "Present": "Prezent",
      "Left": "A plecat",
      "Present (Left)": "Prezent (A plecat)",
      "Left Early / Incomplete": "Plecat devreme / Incomplet",
      "Late": "Întârziat",
      "Excused (Short Stay)": "Motivat (Scurtă durată)",
      "Absent": "Absent",
      "Absent (Excused)": "Absent (motivat)",
      "Absent (excused)": "Absent (motivat)",
      "Guest (Present)": "Oaspete (Prezent)",
      "Guest (Left)": "Oaspete (A plecat)"
    },
    "ru": {
      "Present": "Присутствовал",
      "Left": "Покинул",
      "Present (Left)": "Присутствовал (ушёл)",
      "Left Early / Incomplete": "Ушёл раньше / Не полностью",
      "Late": "Опоздал",
      "Excused (Short Stay)": "Уважительно (короткое преб.)",
      "Absent": "Отсутствовал",
      "Absent (Excused)": "Отсутствовал (уваж.)",
      "Absent (excused)": "Отсутствовал (уваж.)",
      "Guest (Present)": "Гость (присутствовал)",
      "Guest (Left)": "Гость (ушёл)"
    },
    "uk": {
      "Present": "Присутній",
      "Left": "Вийшов",
      "Present (Left)": "Присутній (Вийшов)",
      "Left Early / Incomplete": "Вийшов раніше / Неповний",
      "Late": "Запізнився",
      "Excused (Short Stay)": "Поважна причина (Коротке перебування)",
      "Absent": "Відсутній",
      "Absent (Excused)": "Відсутній (поважна причина)",
      "Absent (excused)": "Відсутній (поважна причина)",
      "Guest (Present)": "Гість (Присутній)",
      "Guest (Left)": "Гість (Вийшов)"
    },
    "tr": {
      "Present": "Katıldı",
      "Left": "Ayrıldı",
      "Present (Left)": "Katıldı (Ayrıldı)",
      "Left Early / Incomplete": "Erken Ayrıldı / Eksik",
      "Late": "Geç Kaldı",
      "Excused (Short Stay)": "Mazeretli (Kısa Süreli)",
      "Absent": "Katılmadı",
      "Absent (Excused)": "Mazeretli",
      "Absent (excused)": "Mazeretli",
      "Guest (Present)": "Misafir (Katıldı)",
      "Guest (Left)": "Misafir (Ayrıldı)"
    },
    "th": {
      "Present": "เข้าร่วม",
      "Left": "ออกจากการประชุม",
      "Present (Left)": "เข้าร่วม (ออกแล้ว)",
      "Left Early / Incomplete": "ออกก่อนเวลา / ไม่สมบูรณ์",
      "Late": "สาย",
      "Excused (Short Stay)": "ได้รับอนุญาต (อยู่ระยะสั้น)",
      "Absent": "ขาด",
      "Absent (Excused)": "ขาด (ลา)",
      "Absent (excused)": "ขาด (ลา)",
      "Guest (Present)": "ผู้มาเยือน (เข้าร่วม)",
      "Guest (Left)": "ผู้มาเยือน (ออกแล้ว)"
    },
    "ar": {
      "Present": "حاضر",
      "Left": "غادر",
      "Present (Left)": "حاضر (غادر)",
      "Left Early / Incomplete": "غادر مبكراً / غير مكتمل",
      "Late": "متأخر",
      "Excused (Short Stay)": "معذور (إقامة قصيرة)",
      "Absent": "غائب",
      "Absent (Excused)": "غائب (بعذر)",
      "Absent (excused)": "غائب (بعذر)",
      "Guest (Present)": "ضيف (حاضر)",
      "Guest (Left)": "ضيف (غادر)"
    },
    "ko": {
      "Present": "출석",
      "Left": "퇴장",
      "Present (Left)": "출석 (퇴장)",
      "Left Early / Incomplete": "조퇴 / 미완료",
      "Late": "지각",
      "Excused (Short Stay)": "공결 (짧은 체류)",
      "Absent": "결석",
      "Absent (Excused)": "공결",
      "Absent (excused)": "공결",
      "Guest (Present)": "게스트 (출석)",
      "Guest (Left)": "게스트 (퇴장)"
    },
    "zh": {
      "Present": "出席",
      "Left": "已離開",
      "Present (Left)": "出席 (已離開)",
      "Left Early / Incomplete": "早退 / 未全程參與",
      "Late": "遲到",
      "Excused (Short Stay)": "已請假 (短暫停留)",
      "Absent": "缺席",
      "Absent (Excused)": "缺席 (已請假)",
      "Absent (excused)": "缺席 (已請假)",
      "Guest (Present)": "來賓 (出席)",
      "Guest (Left)": "來賓 (已離開)"
    },
    "zh-CN": {
      "Present": "出席",
      "Left": "已离开",
      "Present (Left)": "出席 (已离开)",
      "Left Early / Incomplete": "早退 / 未全程参与",
      "Late": "迟到",
      "Excused (Short Stay)": "已请假 (短暂离开)",
      "Absent": "缺席",
      "Absent (Excused)": "缺席 (已请假)",
      "Absent (excused)": "缺席 (已请假)",
      "Guest (Present)": "来宾 (出席)",
      "Guest (Left)": "来宾 (已离开)"
    },
    "ja": {
      "Present": "出席",
      "Left": "退出済",
      "Present (Left)": "出席 (退出)",
      "Left Early / Incomplete": "早退 / 不完全",
      "Late": "遅刻",
      "Excused (Short Stay)": "公欠 (短時間滞在)",
      "Absent": "欠席",
      "Absent (Excused)": "公欠",
      "Absent (excused)": "公欠",
      "Guest (Present)": "ゲスト (出席)",
      "Guest (Left)": "ゲスト (退出)"
    },
    "he": {
      "Present": "נוכח",
      "Left": "עזב",
      "Present (Left)": "נוכח (עזב)",
      "Left Early / Incomplete": "עזב מוקדם / חלקי",
      "Late": "איחר",
      "Excused (Short Stay)": "מאושר (שהות קצרה)",
      "Absent": "נעדר",
      "Absent (Excused)": "נעדר (מאושר)",
      "Absent (excused)": "נעדר (מאושר)",
      "Guest (Present)": "אורח (נוכח)",
      "Guest (Left)": "אורח (עזב)"
    },
    "mr": {
      "Present": "उपस्थित",
      "Left": "सोडले",
      "Present (Left)": "उपस्थित (सोडले)",
      "Left Early / Incomplete": "लवकर सोडले / अपूर्ण",
      "Late": "उशिरा",
      "Excused (Short Stay)": "सूट दिली (अल्प मुक्काम)",
      "Absent": "अनुपस्थित",
      "Absent (Excused)": "अनुपस्थित (रजा)",
      "Absent (excused)": "अनुपस्थित (रजा)",
      "Guest (Present)": "पाहुणा (उपस्थित)",
      "Guest (Left)": "पाहुणा (सोडले)"
    },
    "sv": {
      "Present": "Närvarande",
      "Left": "Lämnade",
      "Present (Left)": "Närvarande (Lämnade)",
      "Left Early / Incomplete": "Lämnade tidigt / Ofullständig",
      "Late": "Sen",
      "Excused (Short Stay)": "Giltig (Kort vistelse)",
      "Absent": "Frånvarande",
      "Absent (Excused)": "Frånvarande (giltig)",
      "Absent (excused)": "Frånvarande (giltig)",
      "Guest (Present)": "Gäst (Närvarande)",
      "Guest (Left)": "Gäst (Lämnade)"
    },
    "cs": {
      "Present": "Přítomen",
      "Left": "Odešel",
      "Present (Left)": "Přítomen (Odešel)",
      "Left Early / Incomplete": "Odešel dříve / Neúplné",
      "Late": "Zpožděn",
      "Excused (Short Stay)": "Omluven (Krátký pobyt)",
      "Absent": "Nepřítomen",
      "Absent (Excused)": "Nepřítomen (omluven)",
      "Absent (excused)": "Nepřítomen (omluven)",
      "Guest (Present)": "Host (Přítomen)",
      "Guest (Left)": "Host (Odešel)"
    },
    "da": {
      "Present": "Til stede",
      "Left": "Forlod",
      "Present (Left)": "Til stede (Forlod)",
      "Left Early / Incomplete": "Gik tidligt / Ufuldstændig",
      "Late": "Forsinket",
      "Excused (Short Stay)": "Undskyldt (Kort ophold)",
      "Absent": "Fraværende",
      "Absent (Excused)": "Fraværende (undskyldt)",
      "Absent (excused)": "Fraværende (undskyldt)",
      "Guest (Present)": "Gæst (Til stede)",
      "Guest (Left)": "Gæst (Forlod)"
    },
    "fi": {
      "Present": "Paikalla",
      "Left": "Poistui",
      "Present (Left)": "Paikalla (Poistui)",
      "Left Early / Incomplete": "Lähti aikaisin / Keskeneräinen",
      "Late": "Myöhässä",
      "Excused (Short Stay)": "Luvallinen (Lyhyt viipymä)",
      "Absent": "Poissa",
      "Absent (Excused)": "Poissa (luvallinen)",
      "Absent (excused)": "Poissa (luvallinen)",
      "Guest (Present)": "Vieras (Paikalla)",
      "Guest (Left)": "Vieras (Poistui)"
    },
    "hu": {
      "Present": "Jelen van",
      "Left": "Távozott",
      "Present (Left)": "Jelen (Távozott)",
      "Left Early / Incomplete": "Korán távozott / Befejezetlen",
      "Late": "Késett",
      "Excused (Short Stay)": "Igazolt (Rövid tartózkodás)",
      "Absent": "Hiányzik",
      "Absent (Excused)": "Hiányzik (igazolt)",
      "Absent (excused)": "Hiányzik (igazolt)",
      "Guest (Present)": "Vendég (Jelen)",
      "Guest (Left)": "Vendég (Távozott)"
    },
    "so": {
      "Present": "Xaadir",
      "Left": "Baxay",
      "Present (Left)": "Xaadir (Baxay)",
      "Left Early / Incomplete": "Goor hore baxay / Aan dhamaystirnayn",
      "Late": "Daahay",
      "Excused (Short Stay)": "La cudurdaaray (Joogitaan gaaban)",
      "Absent": "Maqan",
      "Absent (Excused)": "Maqan (Cudurdaar)",
      "Absent (excused)": "Maqan (Cudurdaar)",
      "Guest (Present)": "Marti (Xaadir)",
      "Guest (Left)": "Marti (Baxay)"
    },
    "sw": {
      "Present": "Yupo",
      "Left": "Ameondoka",
      "Present (Left)": "Yupo (Ameondoka)",
      "Left Early / Incomplete": "Ameondoka Mapema / Haijakamilika",
      "Late": "Amechelewa",
      "Excused (Short Stay)": "Amesamehewa (Muda Mfupi)",
      "Absent": "Hayupo",
      "Absent (Excused)": "Hayupo (Udhuru)",
      "Absent (excused)": "Hayupo (Udhuru)",
      "Guest (Present)": "Mgeni (Yupo)",
      "Guest (Left)": "Mgeni (Ameondoka)"
    },
    "am": {
      "Present": "ተገኝቷል",
      "Left": "ወጥቷል",
      "Present (Left)": "ተገኝቷል (ወጥቷል)",
      "Left Early / Incomplete": "ቀድሞ ወጥቷል / ያልተሟላ",
      "Late": "ዘግይቷል",
      "Excused (Short Stay)": "ፈቃድ ተሰጥቷል (አጭር ቆይታ)",
      "Absent": "ቀርቷል",
      "Absent (Excused)": "ቀርቷል (በፈቃድ)",
      "Absent (excused)": "ቀርቷል (በፈቃድ)",
      "Guest (Present)": "እንግዳ (ተገኝቷል)",
      "Guest (Left)": "እንግዳ (ወጥቷል)"
    },
    "si": {
      "Present": "පැමිණ සිටී",
      "Left": "ඉවත් විය",
      "Present (Left)": "පැමිණ සිටී (ඉවත් විය)",
      "Left Early / Incomplete": "කලින් ඉවත් විය / අසම්පූර්ණයි",
      "Late": "ප්‍රමාදයි",
      "Excused (Short Stay)": "නිදහස් කරන ලදී (කෙටි කාලයක්)",
      "Absent": "නොපැමිණි",
      "Absent (Excused)": "නොපැමිණි (නිවාඩු)",
      "Absent (excused)": "නොපැමිණි (නිවාඩු)",
      "Guest (Present)": "ආරාධිතයා (පැමිණ සිටී)",
      "Guest (Left)": "ආරාධිතයා (ඉවත් විය)"
    },
    "el": {
      "Present": "Παρών",
      "Left": "Αποχώρησε",
      "Present (Left)": "Παρών (Αποχώρησε)",
      "Left Early / Incomplete": "Αποχώρησε νωρίς / Ημιτελές",
      "Late": "Καθυστερημένος",
      "Excused (Short Stay)": "Δικαιολογημένος (Σύντομη παραμονή)",
      "Absent": "Απών",
      "Absent (Excused)": "Απών (δικαιολογημένος)",
      "Absent (excused)": "Απών (δικαιολογημένος)",
      "Guest (Present)": "Επισκέπτης (Παρών)",
      "Guest (Left)": "Επισκέπτης (Αποχώρησε)"
    },
    "no": {
      "Present": "Tilstede",
      "Left": "Forlot",
      "Present (Left)": "Tilstede (Forlot)",
      "Left Early / Incomplete": "Forlot tidlig / Ufullstendig",
      "Late": "Forsinket",
      "Excused (Short Stay)": "Gyldig (Kort opphold)",
      "Absent": "Fraværende",
      "Absent (Excused)": "Fraværende (gyldig)",
      "Absent (excused)": "Fraværende (gyldig)",
      "Guest (Present)": "Gjest (Tilstede)",
      "Guest (Left)": "Gjest (Forlot)"
    },
    "ca": {
      "Present": "Present",
      "Left": "Ha marxat",
      "Present (Left)": "Present (Ha marxat)",
      "Left Early / Incomplete": "Ha marxat d'hora / Incomplet",
      "Late": "Tard",
      "Excused (Short Stay)": "Justificat (Estada curta)",
      "Absent": "Absent",
      "Absent (Excused)": "Absent (justificat)",
      "Absent (excused)": "Absent (justificat)",
      "Guest (Present)": "Convidat (Present)",
      "Guest (Left)": "Convidat (Ha marxat)"
    },
    "ne": {
      "Present": "उपस्थित",
      "Left": "छोडियो",
      "Present (Left)": "उपस्थित (छोडियो)",
      "Left Early / Incomplete": "छिटो छोडेको / अपूर्ण",
      "Late": "ढिलो",
      "Excused (Short Stay)": "माफ गरिएको (छोटो बसाइ)",
      "Absent": "अनुपस्थित",
      "Absent (Excused)": "अनुपस्थित (माफ गरिएको)",
      "Absent (excused)": "अनुपस्थित (माफ गरिएको)",
      "Guest (Present)": "अतिथि (उपस्थित)",
      "Guest (Left)": "अतिथि (छोडियो)"
    },
    "ml": {
      "Present": "ഹാജർ",
      "Left": "പുറത്തുപോയി",
      "Present (Left)": "ഹാജർ (പുറത്തുപോയി)",
      "Left Early / Incomplete": "നേരത്തെ ഇറങ്ങി / അപൂർണ്ണം",
      "Late": "വൈകി",
      "Excused (Short Stay)": "അനുവദിച്ചത് (കുറഞ്ഞ സമയം)",
      "Absent": "ഹാജരായില്ല",
      "Absent (Excused)": "ഹാജരായില്ല (അനുവദിച്ചത്)",
      "Absent (excused)": "ഹാജരായില്ല (അനുവദിച്ചത്)",
      "Guest (Present)": "അതിഥി (ഹാജർ)",
      "Guest (Left)": "അതിഥി (പുറത്തുപോയി)"
    },
    "mn": {
      "Present": "Ирсэн",
      "Left": "Гарсан",
      "Present (Left)": "Ирсэн (гарсан)",
      "Left Early / Incomplete": "Эрт гарсан / Дутуу",
      "Late": "Хоцорсон",
      "Excused (Short Stay)": "Чөлөөтэй (богино хугацаа)",
      "Absent": "Тасалсан",
      "Absent (Excused)": "Тасалсан (чөлөөтэй)",
      "Absent (excused)": "Тасалсан (чөлөөтэй)",
      "Guest (Present)": "Зочин (ирсэн)",
      "Guest (Left)": "Зочин (гарсан)"
    },
    "kn": {
      "Present": "ಹಾಜರಿದ್ದಾರೆ",
      "Left": "ನಿರ್ಗಮಿಸಿದ್ದಾರೆ",
      "Present (Left)": "ಹಾಜರು (ನಿರ್ಗಮಿಸಿದ್ದಾರೆ)",
      "Left Early / Incomplete": "ಬೇಗ ನಿರ್ಗಮಿಸಿದ್ದಾರೆ / ಅಪೂರ್ಣ",
      "Late": "ತಡವಾಗಿ",
      "Excused (Short Stay)": "ಅನುಮೋದಿತ (ಅಲ್ಪಾವಧಿ)",
      "Absent": "ಗೈರುಹಾಜರಾಗಿದ್ದಾರೆ",
      "Absent (Excused)": "ಗೈರುಹಾಜರಿ (ಅನುಮೋದಿತ)",
      "Absent (excused)": "ಗೈರುಹಾಜರಿ (ಅನುಮೋದಿತ)",
      "Guest (Present)": "ಅತಿಥಿ (ಹಾಜರು)",
      "Guest (Left)": "ಅತಿಥಿ (ನಿರ್ಗಮಿಸಿದ್ದಾರೆ)"
    },
    "gu": {
      "Present": "હાજર",
      "Left": "છોડ્યું",
      "Present (Left)": "હાજર (છોડ્યું)",
      "Left Early / Incomplete": "વહેલા છોડ્યું / અપૂર્ણ",
      "Late": "મોડું",
      "Excused (Short Stay)": "મંજૂર (ટૂંકું રોકાણ)",
      "Absent": "ગેરહાજર",
      "Absent (Excused)": "ગેરહાજર (મંજૂર)",
      "Absent (excused)": "ગેરહાજર (મંજૂર)",
      "Guest (Present)": "મહેમાન (હાજર)",
      "Guest (Left)": "મહેમાન (છોડ્યું)"
    },
    "pa": {
      "Present": "ਹਾਜ਼ਰ",
      "Left": "ਛੱਡਿਆ",
      "Present (Left)": "ਹਾਜ਼ਰ (ਛੱਡਿਆ)",
      "Left Early / Incomplete": "ਜਲਦੀ ਛੱਡਿਆ / ਅਧੂਰਾ",
      "Late": "ਦੇਰ ਨਾਲ",
      "Excused (Short Stay)": "ਮਨਜ਼ੂਰ (ਥੋੜ੍ਹੀ ਦੇਰ)",
      "Absent": "ਗੈਰ-ਹਾਜ਼ਰ",
      "Absent (Excused)": "ਗੈਰ-ਹਾਜ਼ਰ (ਛੁੱਟੀ)",
      "Absent (excused)": "ਗੈਰ-ਹਾਜ਼ਰ (ਛੁੱਟੀ)",
      "Guest (Present)": "ਮਹਿਮਾਨ (ਹਾਜ਼ਰ)",
      "Guest (Left)": "ਮਹਿਮਾਨ (ਛੱਡਿਆ)"
    },
    "kk": {
      "Present": "Қатысты",
      "Left": "Шықты",
      "Present (Left)": "Қатысты (Шықты)",
      "Left Early / Incomplete": "Ерте шықты / Толық емес",
      "Late": "Кешікті",
      "Excused (Short Stay)": "Себепті (Қысқа уақыт)",
      "Absent": "Қатыспады",
      "Absent (Excused)": "Қатыспады (себепті)",
      "Absent (excused)": "Қатыспады (себепті)",
      "Guest (Present)": "Қонақ (Қатысты)",
      "Guest (Left)": "Қонақ (Шықты)"
    },
    "lv": {
      "Present": "Piedalījās",
      "Left": "Pameta",
      "Present (Left)": "Piedalījās (Izgāja)",
      "Left Early / Incomplete": "Izgāja agrāk / Nepilnīgs",
      "Late": "Nokavēja",
      "Excused (Short Stay)": "Attaisnots (Īss laiks)",
      "Absent": "Kavēja",
      "Absent (Excused)": "Attaisnots kavējums",
      "Absent (excused)": "Attaisnots kavējums",
      "Guest (Present)": "Viesis (Piedalījās)",
      "Guest (Left)": "Viesis (Izgāja)"
    },
    "lt": {
      "Present": "Dalyvavo",
      "Left": "Išėjo",
      "Present (Left)": "Dalyvavo (Išėjo)",
      "Left Early / Incomplete": "Išėjo anksčiau / Neišbuvo",
      "Late": "Pavėlavo",
      "Excused (Short Stay)": "Pateisinta (Trumpas buvimas)",
      "Absent": "Nedalyvavo",
      "Absent (Excused)": "Nedalyvavo (pateisinta)",
      "Absent (excused)": "Nedalyvavo (pateisinta)",
      "Guest (Present)": "Svečias (Dalyvavo)",
      "Guest (Left)": "Svečias (Išėjo)"
    },
    "lo": {
      "Present": "ເຂົ້າຮ່ວມ",
      "Left": "ອອກແລ້ວ",
      "Present (Left)": "ເຂົ້າຮ່ວມ (ອອກແລ້ວ)",
      "Left Early / Incomplete": "ອອກກ່ອນ / ບໍ່ຄົບ",
      "Late": "ມາຊ້າ",
      "Excused (Short Stay)": "ອະນຸຍາດ (ຢູ່ຊົ່ວຄາວ)",
      "Absent": "ຂາດ",
      "Absent (Excused)": "ຂາດ (ມີເຫດຜົນ)",
      "Absent (excused)": "ຂາດ (ມີເຫດຜົນ)",
      "Guest (Present)": "ແຂກ (ເຂົ້າຮ່ວມ)",
      "Guest (Left)": "ແຂກ (ອອກແລ້ວ)"
    },
    "my": {
      "Present": "တက်ရောက်သည်",
      "Left": "ထွက်ခွာသွားသည်",
      "Present (Left)": "တက်ရောက် (ထွက်ခွာ)",
      "Left Early / Incomplete": "စောထွက် / မပြည့်စုံ",
      "Late": "နောက်ကျ",
      "Excused (Short Stay)": "ခွင့်ပြု (ခေတ္တသာ)",
      "Absent": "ပျက်ကွက်",
      "Absent (Excused)": "ပျက်ကွက် (ခွင့်နှင့်)",
      "Absent (excused)": "ပျက်ကွက် (ခွင့်နှင့်)",
      "Guest (Present)": "ဧည့်သည် (တက်ရောက်)",
      "Guest (Left)": "ဧည့်သည် (ထွက်ခွာ)"
    },
    "km": {
      "Present": "មានវត្តមាន",
      "Left": "បានចាកចេញ",
      "Present (Left)": "មានវត្តមាន (បានចាកចេញ)",
      "Left Early / Incomplete": "ចាកចេញមុន / មិនពេញលេញ",
      "Late": "យឺត",
      "Excused (Short Stay)": "លើកលែង (ស្នាក់នៅខ្លី)",
      "Absent": "អវត្តមាន",
      "Absent (Excused)": "អវត្តមាន (មានច្បាប់)",
      "Absent (excused)": "អវត្តមាន (មានច្បាប់)",
      "Guest (Present)": "ភ្ញៀវ (មានវត្តមាន)",
      "Guest (Left)": "ភ្ញៀវ (បានចាកចេញ)"
    },
    "ceb": {
      "Present": "Mitambong",
      "Left": "Mibiya",
      "Present (Left)": "Mitambong (Mibiya)",
      "Left Early / Incomplete": "Mibiya og Sayo / Wala Mahuman",
      "Late": "Naulahi",
      "Excused (Short Stay)": "Gipasaylo (Mubo nga Puyo)",
      "Absent": "Wala Mitambong",
      "Absent (Excused)": "Wala Mitambong (Gipasaylo)",
      "Absent (excused)": "Wala Mitambong (Gipasaylo)",
      "Guest (Present)": "Bisita (Mitambong)",
      "Guest (Left)": "Bisita (Mibiya)"
    },
    "bg": {
      "Present": "Присъствал",
      "Left": "Напуснал",
      "Present (Left)": "Присъствал (Напуснал)",
      "Left Early / Incomplete": "Напуснал по-рано / Непълен",
      "Late": "Закъснял",
      "Excused (Short Stay)": "Извинен (Кратък престой)",
      "Absent": "Отсъствал",
      "Absent (Excused)": "Отсъствал (уважително)",
      "Absent (excused)": "Отсъствал (уважително)",
      "Guest (Present)": "Гост (Присъствал)",
      "Guest (Left)": "Гост (Напуснал)"
    },
    "hr": {
      "Present": "Prisutan",
      "Left": "Izašao",
      "Present (Left)": "Prisutan (Izašao)",
      "Left Early / Incomplete": "Izašao ranije / Nepotpuno",
      "Late": "Zakasnio",
      "Excused (Short Stay)": "Opravdano (Kratak boravak)",
      "Absent": "Odsutan",
      "Absent (Excused)": "Odsutan (opravdano)",
      "Absent (excused)": "Odsutan (opravdano)",
      "Guest (Present)": "Gost (Prisutan)",
      "Guest (Left)": "Gost (Izašao)"
    },
    "sr": {
      "Present": "Присутан",
      "Left": "Изашао",
      "Present (Left)": "Присутан (Изашао)",
      "Left Early / Incomplete": "Изашао раније / Непотпуно",
      "Late": "Закаснио",
      "Excused (Short Stay)": "Оправдано (Кратак боравак)",
      "Absent": "Одсутан",
      "Absent (Excused)": "Одсутан (оправдано)",
      "Absent (excused)": "Одсутан (оправдано)",
      "Guest (Present)": "Гост (Присутан)",
      "Guest (Left)": "Гост (Изашао)"
    },
    "sk": {
      "Present": "Prítomný",
      "Left": "Odišiel",
      "Present (Left)": "Prítomný (Odišiel)",
      "Left Early / Incomplete": "Odišiel skôr / Neúplné",
      "Late": "Meškanie",
      "Excused (Short Stay)": "Ospravedlnené (Krátky pobyt)",
      "Absent": "Neprítomný",
      "Absent (Excused)": "Neprítomný (ospravedlnený)",
      "Absent (excused)": "Neprítomný (ospravedlnený)",
      "Guest (Present)": "Hosť (Prítomný)",
      "Guest (Left)": "Hosť (Odišiel)"
    },
    "sl": {
      "Present": "Prisoten",
      "Left": "Zapustil",
      "Present (Left)": "Prisoten (Zapustil)",
      "Left Early / Incomplete": "Zapustil prezgodaj / Nepopolno",
      "Late": "Zamuda",
      "Excused (Short Stay)": "Opravičeno (Kratko bivanje)",
      "Absent": "Odsoten",
      "Absent (Excused)": "Odsoten (opravičeno)",
      "Absent (excused)": "Odsoten (opravičeno)",
      "Guest (Present)": "Gost (Prisoten)",
      "Guest (Left)": "Gost (Zapustil)"
    },
    "af": {
      "Present": "Teenwoordig",
      "Left": "Het verlaat",
      "Present (Left)": "Teenwoordig (Het verlaat)",
      "Left Early / Incomplete": "Vroeg weg / Onvolledig",
      "Late": "Laat",
      "Excused (Short Stay)": "Verskoon (Kort kuier)",
      "Absent": "Afwesig",
      "Absent (Excused)": "Afwesig (verskoon)",
      "Absent (excused)": "Afwesig (verskoon)",
      "Guest (Present)": "Gas (Teenwoordig)",
      "Guest (Left)": "Gas (Het verlaat)"
    }
  };

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

    const loc = (opts.locale || 'en').split(/[-_]/)[0].toLowerCase();
    const locStatus = (s) => (CSV_STATUS_LOCALIZATIONS[loc]?.[s] || s);

    const fmtTime = (v) => {
      const d = new Date(v);
      if (isNaN(d.getTime())) return '';
      if (!opts.timezone && !opts.locale) return d.toLocaleTimeString();
      try {
        return d.toLocaleTimeString(opts.locale || undefined, {
          timeZone: opts.timezone || undefined,
        });
      } catch {
        return d.toLocaleTimeString();
      }
    };

    // Self-check-in attestation rides the Notes column: it augments whatever
    // note is already there rather than claiming a column of its own.
    const withCheckinNote = (note, p) => {
      const chk = p && p.checkedInAt ? t('export.checkedInPrefix', 'Checked in ') + fmtTime(p.checkedInAt) : '';
      return [note, chk].filter(Boolean).join('; ');
    };

    const rows = [];
    const headerCols = CSV_HEADER_LOCALIZATIONS[loc] || [
      'Name',
      'Email',
      'Status',
      'Attendance %',
      'Duration (min)',
      'Join Time',
      'Leave Time',
      'Rejoins',
      'Notes'
    ];
    rows.push(headerCols.map(escapeCsv).join(','));

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
            locStatus(status),
            `${pct}%`,
            durMin,
            p.joinTime ? fmtTime(p.joinTime) : '',
            (!p.present && p.leaveTime) ? fmtTime(p.leaveTime) : '',
            Math.max(0, (p.rejoins != null ? p.rejoins : (p.sessions || 1) - 1)),
            withCheckinNote(note, p)
          ].map(escapeCsv).join(','));
        } else {
          const status = isExcused ? 'Absent (Excused)' : 'Absent';
          rows.push([
            student.name,
            student.email || '',
            locStatus(status),
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
            locStatus(p.present ? 'Guest (Present)' : 'Guest (Left)'),
            `${pct}%`,
            durMin,
            p.joinTime ? fmtTime(p.joinTime) : '',
            (!p.present && p.leaveTime) ? fmtTime(p.leaveTime) : '',
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
          locStatus(p.present ? 'Present' : 'Left'),
          `${pct}%`,
          durMin,
          p.joinTime ? fmtTime(p.joinTime) : '',
          (!p.present && p.leaveTime) ? fmtTime(p.leaveTime) : '',
          Math.max(0, (p.rejoins != null ? p.rejoins : (p.sessions || 1) - 1)),
          withCheckinNote('', p)
        ].map(escapeCsv).join(','));
      }
    }

    if (opts.isFreePlan) {
      rows.push('# Generated with Attendance Tracker Free Plan. Upgrade to Pro for automated Google Sheets sync, LMS gradebooks, and unlimited exports: https://attendancetracker.dev/pricing.html');
    }

    return '\uFEFF' + rows.join('\r\n');
  }

  function escapeXml(val) {
    if (val == null) return '';
    return String(val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function buildAttendanceExcelXml(parts, activeRoster, opts = {}) {
    parts = parts || [];
    const meetingTitle = opts.meetingTitle || 'Meeting';
    const totalMeetingMs = opts.totalMeetingMs || 0;
    const meetingMinutes = totalMeetingMs > 0 ? Math.max(1, Math.round(totalMeetingMs / 60000)) : (opts.meetingMinutes || 1);
    const lateMinutes = (opts.lateMinutes !== undefined) ? Number(opts.lateMinutes) : 10;
    const minPercent = (opts.minPercent !== undefined) ? Number(opts.minPercent) : 0;
    const minMinutes = (opts.minMinutes !== undefined) ? Number(opts.minMinutes) : 0;
    const excusedStudents = opts.excusedStudents || {};
    const startTime = opts.startTime ? new Date(opts.startTime) : null;
    const now = opts.now ? new Date(opts.now) : new Date();

    const loc = (opts.locale || 'en').split(/[-_]/)[0].toLowerCase();
    const locStatus = (s) => (CSV_STATUS_LOCALIZATIONS[loc]?.[s] || s);

    const fmtTimeVal = (v) => {
      const d = new Date(v);
      if (isNaN(d.getTime())) return '';
      if (!opts.timezone && !opts.locale) return d.toLocaleTimeString();
      try {
        return d.toLocaleTimeString(opts.locale || undefined, {
          timeZone: opts.timezone || undefined,
        });
      } catch {
        return d.toLocaleTimeString();
      }
    };

    const withCheckinNote = (note, p) => {
      const chk = p && p.checkedInAt ? t('export.checkedInPrefix', 'Checked in ') + fmtTimeVal(p.checkedInAt) : '';
      return [note, chk].filter(Boolean).join('; ');
    };

    const headerCols = CSV_HEADER_LOCALIZATIONS[loc] || [
      'Name',
      'Email',
      'Status',
      'Attendance %',
      'Duration (min)',
      'Join Time',
      'Leave Time',
      'Rejoins',
      'Notes'
    ];

    const dataRows = [];

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

          dataRows.push({
            name: p.displayName || student.name,
            email: p.email || student.email || '',
            status: locStatus(status),
            pct: `${pct}%`,
            durMin,
            joinTime: p.joinTime ? fmtTimeVal(p.joinTime) : '',
            leaveTime: (!p.present && p.leaveTime) ? fmtTimeVal(p.leaveTime) : '',
            rejoins: Math.max(0, (p.rejoins != null ? p.rejoins : (p.sessions || 1) - 1)),
            notes: withCheckinNote(note, p),
          });
        } else {
          const status = isExcused ? 'Absent (Excused)' : 'Absent';
          dataRows.push({
            name: student.name,
            email: student.email || '',
            status: locStatus(status),
            pct: '0%',
            durMin: 0,
            joinTime: '',
            leaveTime: '',
            rejoins: 0,
            notes: note,
          });
        }
      }

      for (const p of parts) {
        if (!matchedParticipants.has(p)) {
          const durMs = (p._accumulatedMs || 0) + (p.present && p.joinTime ? (now.getTime() - new Date(p.joinTime).getTime()) : 0);
          const durMin = Math.round(durMs / 60000);
          const pct = meetingMinutes > 0 ? Math.min(100, Math.round((durMin / meetingMinutes) * 100)) : 100;
          dataRows.push({
            name: p.displayName,
            email: p.email || '',
            status: locStatus(p.present ? 'Guest (Present)' : 'Guest (Left)'),
            pct: `${pct}%`,
            durMin,
            joinTime: p.joinTime ? fmtTimeVal(p.joinTime) : '',
            leaveTime: (!p.present && p.leaveTime) ? fmtTimeVal(p.leaveTime) : '',
            rejoins: Math.max(0, (p.rejoins != null ? p.rejoins : (p.sessions || 1) - 1)),
            notes: withCheckinNote('Unregistered guest', p),
          });
        }
      }
    } else {
      for (const p of parts) {
        const durMs = (p._accumulatedMs || 0) + (p.present && p.joinTime ? (now.getTime() - new Date(p.joinTime).getTime()) : 0);
        const durMin = Math.round(durMs / 60000);
        const pct = meetingMinutes > 0 ? Math.min(100, Math.round((durMin / meetingMinutes) * 100)) : 100;
        dataRows.push({
          name: p.displayName,
          email: p.email || '',
          status: locStatus(p.present ? 'Present' : 'Left'),
          pct: `${pct}%`,
          durMin,
          joinTime: p.joinTime ? fmtTimeVal(p.joinTime) : '',
          leaveTime: (!p.present && p.leaveTime) ? fmtTimeVal(p.leaveTime) : '',
          rejoins: Math.max(0, (p.rejoins != null ? p.rejoins : (p.sessions || 1) - 1)),
          notes: withCheckinNote('', p),
        });
      }
    }

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\r\n' +
      '<?mso-application progid="Excel.Sheet"?>\r\n' +
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\r\n' +
      ' xmlns:o="urn:schemas-microsoft-com:office:office"\r\n' +
      ' xmlns:x="urn:schemas-microsoft-com:office:excel"\r\n' +
      ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"\r\n' +
      ' xmlns:html="http://www.w3.org/TR/REC-html40">\r\n' +
      ' <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">\r\n' +
      `  <Title>${escapeXml(meetingTitle)}</Title>\r\n` +
      `  <Created>${escapeXml(now.toISOString())}</Created>\r\n` +
      ' </DocumentProperties>\r\n' +
      ' <Styles>\r\n' +
      '  <Style ss:ID="Default" ss:Name="Normal">\r\n' +
      '   <Alignment ss:Vertical="Center"/>\r\n' +
      '   <Borders/>\r\n' +
      '   <Font ss:FontName="Calibri" ss:Size="11" ss:Color="#000000"/>\r\n' +
      '   <Interior/>\r\n' +
      '   <NumberFormat/>\r\n' +
      '   <Protection/>\r\n' +
      '  </Style>\r\n' +
      '  <Style ss:ID="Header">\r\n' +
      '   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>\r\n' +
      '   <Borders>\r\n' +
      '    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#15803D"/>\r\n' +
      '   </Borders>\r\n' +
      '   <Font ss:FontName="Calibri" ss:Size="11" ss:Bold="1" ss:Color="#FFFFFF"/>\r\n' +
      '   <Interior ss:Color="#15803D" ss:Pattern="Solid"/>\r\n' +
      '  </Style>\r\n' +
      '  <Style ss:ID="CellLeft">\r\n' +
      '   <Alignment ss:Horizontal="Left" ss:Vertical="Center"/>\r\n' +
      '   <Borders>\r\n' +
      '    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>\r\n' +
      '   </Borders>\r\n' +
      '  </Style>\r\n' +
      '  <Style ss:ID="CellCenter">\r\n' +
      '   <Alignment ss:Horizontal="Center" ss:Vertical="Center"/>\r\n' +
      '   <Borders>\r\n' +
      '    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>\r\n' +
      '   </Borders>\r\n' +
      '  </Style>\r\n' +
      '  <Style ss:ID="CellRight">\r\n' +
      '   <Alignment ss:Horizontal="Right" ss:Vertical="Center"/>\r\n' +
      '   <Borders>\r\n' +
      '    <Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E5E7EB"/>\r\n' +
      '   </Borders>\r\n' +
      '  </Style>\r\n' +
      '  <Style ss:ID="FooterNotice">\r\n' +
      '   <Font ss:FontName="Calibri" ss:Size="9" ss:Italic="1" ss:Color="#6B7280"/>\r\n' +
      '  </Style>\r\n' +
      ' </Styles>\r\n' +
      ' <Worksheet ss:Name="Attendance">\r\n' +
      '  <Table>\r\n' +
      '   <Column ss:Width="160"/>\r\n' +
      '   <Column ss:Width="190"/>\r\n' +
      '   <Column ss:Width="120"/>\r\n' +
      '   <Column ss:Width="95"/>\r\n' +
      '   <Column ss:Width="95"/>\r\n' +
      '   <Column ss:Width="90"/>\r\n' +
      '   <Column ss:Width="90"/>\r\n' +
      '   <Column ss:Width="65"/>\r\n' +
      '   <Column ss:Width="200"/>\r\n' +
      '   <Row ss:Height="26">\r\n' +
      headerCols.map(col => `    <Cell ss:StyleID="Header"><Data ss:Type="String">${escapeXml(col)}</Data></Cell>`).join('\r\n') +
      '\r\n   </Row>\r\n';

    for (const r of dataRows) {
      xml += '   <Row ss:Height="20">\r\n' +
        `    <Cell ss:StyleID="CellLeft"><Data ss:Type="String">${escapeXml(r.name)}</Data></Cell>\r\n` +
        `    <Cell ss:StyleID="CellLeft"><Data ss:Type="String">${escapeXml(r.email)}</Data></Cell>\r\n` +
        `    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXml(r.status)}</Data></Cell>\r\n` +
        `    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXml(r.pct)}</Data></Cell>\r\n` +
        `    <Cell ss:StyleID="CellRight"><Data ss:Type="Number">${Number(r.durMin) || 0}</Data></Cell>\r\n` +
        `    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXml(r.joinTime)}</Data></Cell>\r\n` +
        `    <Cell ss:StyleID="CellCenter"><Data ss:Type="String">${escapeXml(r.leaveTime)}</Data></Cell>\r\n` +
        `    <Cell ss:StyleID="CellRight"><Data ss:Type="Number">${Number(r.rejoins) || 0}</Data></Cell>\r\n` +
        `    <Cell ss:StyleID="CellLeft"><Data ss:Type="String">${escapeXml(r.notes)}</Data></Cell>\r\n` +
        '   </Row>\r\n';
    }

    if (opts.isFreePlan) {
      xml += '   <Row ss:Height="18">\r\n' +
        '    <Cell ss:StyleID="FooterNotice"><Data ss:Type="String">Generated with Attendance Tracker Free Plan. Upgrade to Pro for automated Google Sheets sync, LMS gradebooks, and unlimited exports: https://attendancetracker.dev/pricing.html</Data></Cell>\r\n' +
        '   </Row>\r\n';
    }

    xml += '  </Table>\r\n </Worksheet>\r\n</Workbook>';
    return xml;
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
    parseStudentsInput, findParticipantForStudent, buildAttendanceCsv, buildAttendanceExcelXml,
    splitName, buildLmsGradebookRows, buildMoodleGradebookCsv, buildCanvasGradebookCsv, escapeCsv, escapeXml,
    CSV_HEADER_LOCALIZATIONS, CSV_STATUS_LOCALIZATIONS,
    LATE_THRESHOLD_MIN, AVATAR_PALETTE, SLACK_WEBHOOK_PREFIX, CHAT_WEBHOOK_PREFIX, DISCORD_WEBHOOK_PREFIXES,
  };

  root.AttUtils = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
