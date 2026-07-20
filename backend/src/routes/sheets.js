const { Router } = require('express');
const { google } = require('googleapis');
const { getGoogleClient } = require('../services/googleAuth');
const CONFIG = require('../config');
const log = require('../lib/logger');
const { persistExport, getUserSheetId, setUserSheetId, countUserExports, getMeetingExcusedEmails, addMeetingExcusedEmails, getUserSettings } = require('../services/firestore');
const { sendExportNotification, sendSlackDigest } = require('../lib/notifications');

const router = Router();

// Prevent formula injection — cells starting with =, +, -, @, tab, CR can execute formulas
function sanitizeCell(val) {
  if (typeof val !== 'string') return val;
  if (/^[=+\-@\t\r]/.test(val)) return "'" + val;
  return val;
}

// Google Sheets tab names cannot contain these characters
function sanitizeTabName(name) {
  return name
    .replace(/[\[\]*?/\\]/g, '-')  // Replace forbidden chars with dash
    .replace(/^'|'$/g, '')         // Cannot start or end with apostrophe
    .slice(0, 100)                 // Google Sheets limit
    || 'Meeting';                  // Fallback if empty after sanitization
}

function fmtRsvp(status) {
  switch (status) {
    case 'accepted':    return 'Accepted';
    case 'declined':    return 'Declined';
    case 'tentative':   return 'Tentative';
    case 'needsAction': return 'No Response';
    default:            return '';
  }
}

// ── Digest row shaping ──
// The Slack post-export digest and the email digest both turn the raw
// participant + calendar-invitee lists into the same {displayName, email,
// status, durationMin} shape. Extracted so the two callers can't drift.

// Minutes a participant was actually in the meeting (0 if they never joined).
function digestDurationMin(p, fallbackEnd) {
  return p.joinTimeISO
    ? Math.round((new Date(p.leaveTimeISO || fallbackEnd) - new Date(p.joinTimeISO)) / 60000)
    : 0;
}

// The people who showed up. The email digest also wants a lateMin column;
// Slack omits it, so it's opt-in via lateMinFor.
function digestPresentRows(participants, fallbackEnd, lateMinFor) {
  return participants.map(p => {
    const row = {
      displayName: p.displayName,
      email: p.email || '',
      status: p.present ? 'Present' : (p.leaveTimeISO ? 'Left' : 'Present'),
      durationMin: digestDurationMin(p, fallbackEnd),
    };
    if (lateMinFor) row.lateMin = lateMinFor(p.joinTimeISO);
    return row;
  });
}

// The calendar invitees who never attended → Absent (or Excused) rows.
function digestAbsentRows(calendarAttendees, { attendedEmails, attendedNames, excusedSet }) {
  return calendarAttendees
    .filter(a => !attendedEmails.has(a.email.toLowerCase()) && !attendedNames.has((a.displayName || '').toLowerCase().trim()))
    .map(a => ({
      displayName: a.displayName,
      email: a.email,
      status: excusedSet.has(a.email.toLowerCase()) ? 'Excused' : 'Absent',
      durationMin: 0,
    }));
}

router.post('/save-to-sheets', async (req, res) => {
  const { meetingTitle, tabName: clientTabName, exportedAt, participants, calendarAttendees = [], meetingStartTime, meetingType, eventStart, eventEnd, conferenceId, timezone, sendEmail, autoExport, recurringEventId, excusedEmails: excusedFromClient = [] } = req.body;
  if (!participants?.length) return res.status(400).json({ error: 'participants array is required' });

  try {
    // Use user's OAuth token if available, otherwise fall back to service account
    const sheetsAuth = await getGoogleClient(req, 'https://www.googleapis.com/auth/spreadsheets');
    const sheets = google.sheets({ version: 'v4', auth: sheetsAuth });

    // Resolve spreadsheet ID: per-user sheet (OAuth) or shared sheet (legacy)
    let spreadsheetId;
    if (req.user) {
      spreadsheetId = await getUserSheetId(req.user.domain, req.user.email);

      // Verify the stored spreadsheet still exists (user may have deleted it)
      if (spreadsheetId) {
        try {
          await sheets.spreadsheets.get({ spreadsheetId, fields: 'spreadsheetId' });
        } catch (e) {
          log.warn('stored spreadsheet not found, creating new one', { email: req.user.email, spreadsheetId });
          spreadsheetId = null;
          await setUserSheetId(req.user.domain, req.user.email, null);
        }
      }

      if (!spreadsheetId) {
        // First export: create folder + spreadsheet in user's Drive
        const drive = google.drive({ version: 'v3', auth: sheetsAuth });

        // Find or create "Meet Attendance Tracker" folder
        let folderId;
        const folderSearch = await drive.files.list({
          q: "name='Meet Attendance Tracker' and mimeType='application/vnd.google-apps.folder' and trashed=false",
          fields: 'files(id)',
          spaces: 'drive',
        });
        if (folderSearch.data.files?.length > 0) {
          folderId = folderSearch.data.files[0].id;
        } else {
          const folderResp = await drive.files.create({
            requestBody: {
              name: 'Meet Attendance Tracker',
              mimeType: 'application/vnd.google-apps.folder',
            },
            fields: 'id',
          });
          folderId = folderResp.data.id;
          log.info('created Drive folder', { email: req.user.email, folderId });
        }

        // Create spreadsheet
        const createResp = await sheets.spreadsheets.create({
          requestBody: {
            properties: { title: 'Meet Attendance Tracker' },
            sheets: [{ properties: { title: 'Info' } }],
          },
        });
        spreadsheetId = createResp.data.spreadsheetId;

        // Move spreadsheet into the folder
        const file = await drive.files.get({ fileId: spreadsheetId, fields: 'parents' });
        await drive.files.update({
          fileId: spreadsheetId,
          addParents: folderId,
          removeParents: (file.data.parents || []).join(','),
          fields: 'id, parents',
        });

        await setUserSheetId(req.user.domain, req.user.email, spreadsheetId);
        log.info('created user spreadsheet in folder', { email: req.user.email, spreadsheetId, folderId });
      }
    } else {
      spreadsheetId = CONFIG.sheetId;
      if (!spreadsheetId) {
        return res.status(400).json({ error: 'Sign in required to export (no shared sheet configured)' });
      }
    }

    // Load the union of previously-tagged and just-checked excused emails so
    // the sheet shows "Absent (excused)" consistently across re-exports.
    // Cheap single-doc read; on no auth (legacy shared-sheet path) we skip.
    const domain = req.user?.domain || 'default';
    const persistedExcused = req.user ? await getMeetingExcusedEmails(domain, conferenceId) : [];
    const excusedSet = new Set([
      ...persistedExcused,
      // excusedFromClient is destructured with a [] default, so it's always an
      // array here — the `|| []` is defensive-only.
      ...(/* istanbul ignore next */ (excusedFromClient || [])).map(e => (e || '').toLowerCase()),
    ]);

    let tabName = sanitizeTabName(clientTabName || `${meetingTitle || 'Meeting'} ${new Date(exportedAt).toISOString()}`);

    // Handle duplicate tab names by appending a counter
    let sheetId = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const tryName = attempt === 0 ? tabName : `${tabName} (${attempt + 1})`;
        const addResp = await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: tryName } } }] },
        });
        tabName = tryName;
        sheetId = addResp.data.replies[0].addSheet.properties.sheetId;
        break;
      } catch (e) {
        if (e.message?.includes('already exists') && attempt < 4) continue;
        throw e;
      }
    }

    // Meeting duration for attendance % calculation
    const joinTimes = participants.map(p => p.joinTimeISO).filter(Boolean).map(t => new Date(t));
    const meetStart = meetingStartTime ? new Date(meetingStartTime) : (joinTimes.length ? new Date(Math.min(...joinTimes)) : null);
    const meetEnd = new Date(exportedAt);
    const meetDurationMin = meetStart ? Math.round((meetEnd - meetStart) / 60000) : 0;

    // RSVP lookup from calendar attendees
    const rsvpMap = {};
    for (const a of calendarAttendees) {
      rsvpMap[a.email.toLowerCase()] = a.status;
    }

    // Format helpers — display in user's timezone (falls back to US Eastern)
    const tz = timezone || 'America/New_York';
    const tzAbbr = (() => { try {
      return new Date().toLocaleString('en-US', { timeZone: tz, timeZoneName: 'short' }).split(' ').pop();
    } catch { return 'ET'; } })();
    const fmtTime = (iso) => {
      if (!iso) return '';
      return new Date(iso).toLocaleString('en-US', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }) + ' ' + tzAbbr;
    };
    /* istanbul ignore next: only ever called with meetingStartTime||exportedAt (always truthy) */
    const fmtDate = iso => iso ? fmtTime(iso) : '';
    const totalInvited = calendarAttendees.length || participants.length;
    const totalAttended = participants.length;
    // participants is guaranteed non-empty (validated at the top), so
    // totalInvited is always >= 1 — the 'N/A' fallback is defensive-only.
    /* istanbul ignore next */
    const attendanceRate = totalInvited > 0 ? Math.round((totalAttended / totalInvited) * 100) + '%' : 'N/A';

    // Format scheduled time range
    const fmtTimeOnly = (iso) => {
      /* istanbul ignore next: only called when eventStart && eventEnd are truthy */
      if (!iso) return '';
      return new Date(iso).toLocaleString('en-US', { timeZone: tz, timeStyle: 'short' }) + ' ' + tzAbbr;
    };
    const scheduledRange = eventStart && eventEnd
      ? `${fmtTimeOnly(eventStart)} – ${fmtTimeOnly(eventEnd)}`
      : null;

    const summary = [
      ['Meeting', meetingTitle || 'Google Meet'],
      ['Meeting ID', conferenceId || 'N/A'],
      ['Type', meetingType === 'scheduled' ? 'Scheduled Event' : 'Instant Meeting'],
      ...(scheduledRange ? [['Scheduled Time', scheduledRange]] : []),
      ['Date', fmtDate(meetingStartTime || exportedAt)],
      ['Duration (min)', meetStart ? (meetDurationMin || '< 1') : 'N/A'],
      ['Total Invited', totalInvited],
      ['Total Attended', totalAttended],
      ['Attendance Rate', attendanceRate],
      [],
    ];

    // Build participant rows.
    // Late? column flags anyone who joined more than LATE_THRESHOLD_MIN past
    // the meeting's true start. Baseline is calendar start when scheduled,
    // else the actual Meet conference start — matches the in-panel chip.
    const LATE_THRESHOLD_MIN = 5;
    const lateBaselineMs = eventStart
      ? new Date(eventStart).getTime()
      : (meetingStartTime ? new Date(meetingStartTime).getTime() : 0);
    const lateMinFor = (joinIso) => {
      if (!lateBaselineMs || !joinIso) return 0;
      const diff = Math.round((new Date(joinIso).getTime() - lateBaselineMs) / 60000);
      return diff > LATE_THRESHOLD_MIN ? diff : 0;
    };

    const header = ['Name', 'Email', 'RSVP Status', 'Late?', `Join Time (${tzAbbr})`, `Leave Time (${tzAbbr})`, 'Duration (min)', 'Attendance %', 'Sessions', 'Status'];

    const attendedEmails = new Set();
    const attendedNames = new Set();
    const rows = participants.map(p => {
      const email = (p.email || '').toLowerCase();
      if (email) attendedEmails.add(email);
      const name = (p.displayName || '').toLowerCase().trim();
      if (name) attendedNames.add(name);
      const durRaw = p.joinTimeISO
        ? Math.round((new Date(p.leaveTimeISO || exportedAt) - new Date(p.joinTimeISO)) / 60000)
        : '';
      const dur = (durRaw === 0 && p.present) ? '< 1' : durRaw;
      const pct = (durRaw !== '' && meetDurationMin > 0)
        ? Math.min(100, Math.round((durRaw / meetDurationMin) * 100)) + '%'
        : (p.present ? '100%' : '');
      const lateMin = lateMinFor(p.joinTimeISO);
      const lateCell = lateMin > 0 ? `+${lateMin}m` : '';
      return [sanitizeCell(p.displayName), sanitizeCell(p.email || ''), fmtRsvp(rsvpMap[email]), lateCell, fmtTime(p.joinTimeISO), fmtTime(p.leaveTimeISO), dur, pct, p.sessions, p.present ? 'Present' : 'Left'];
    });

    // Fix 2: Also capture emails from rows (includes manual overrides from frontend)
    rows.forEach(row => {
      const email = (row[1] || '').toLowerCase();
      if (email) attendedEmails.add(email);
    });

    // No-shows: calendar invitees who never joined (check email AND exact full name)
    // First-name fallback removed — too many false matches with common names.
    // Directory API email enrichment handles the different-email-same-person case now.
    const noShows = calendarAttendees
      .filter(a => {
        if (attendedEmails.has(a.email.toLowerCase())) return false;
        const aName = (a.displayName || '').toLowerCase().trim();
        if (attendedNames.has(aName)) return false;
        return true;
      })
      .map(a => {
        const status = excusedSet.has(a.email.toLowerCase()) ? 'Absent (excused)' : 'Absent';
        return [sanitizeCell(a.displayName), sanitizeCell(a.email), fmtRsvp(a.status), '', '', '', '', '0%', 0, status];
      });

    const allRows = [...rows, ...noShows];

    const allValues = [...summary, header, ...allRows];
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!A1`,
      valueInputOption: 'RAW',
      requestBody: { values: allValues },
    });

    // Format the sheet: bold summary labels & header row, auto-resize columns
    const headerRowIndex = summary.length; // 0-based row index of the header
    const formatRequests = [
      // Bold summary labels (column A, rows 0 to summary.length-1)
      { repeatCell: {
        range: { sheetId, startRowIndex: 0, endRowIndex: summary.length - 1, startColumnIndex: 0, endColumnIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      }},
      // Bold + background on header row
      { repeatCell: {
        range: { sheetId, startRowIndex: headerRowIndex, endRowIndex: headerRowIndex + 1, startColumnIndex: 0, endColumnIndex: header.length },
        cell: { userEnteredFormat: {
          textFormat: { bold: true },
          backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
        }},
        fields: 'userEnteredFormat(textFormat.bold,backgroundColor)',
      }},
      // Freeze header row
      { updateSheetProperties: {
        properties: { sheetId, gridProperties: { frozenRowCount: headerRowIndex + 1 } },
        fields: 'gridProperties.frozenRowCount',
      }},
      // Auto-resize all columns
      { autoResizeDimensions: {
        dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: header.length },
      }},
    ];

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: formatRequests },
    });

    log.info('exported to sheets', { tabName, rows: allRows.length, noShows: noShows.length });
    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId}`;

    // First-export detection — drives the in-app celebration moment.
    // Check the event log before persisting this one.
    const isFirstExport = req.user?.email
      ? (await countUserExports(domain, req.user.email)) === 0
      : false;

    res.json({ success: true, sheetUrl, isFirstExport });

    // Fire-and-forget: audit trail for exports
    persistExport(domain, {
      meetingTitle: meetingTitle || 'Unknown',
      tabName,
      exportedAt,
      participantCount: allRows.length,
      sheetUrl,
      email: req.user?.email || null,
      autoExport: !!autoExport,
      recurringEventId: recurringEventId || null,
      conferenceId: conferenceId || null,
    });

    // Fire-and-forget: persist newly-checked excused emails to the meeting doc
    // so future re-exports remember the tagging without the user re-checking.
    // arrayUnion handles concurrent writes from parallel exports.
    if (req.user && excusedFromClient.length > 0 && conferenceId) {
      addMeetingExcusedEmails(domain, conferenceId, excusedFromClient);
    }

    // Fire-and-forget: Slack post-meeting digest if the user has a webhook
    // configured. Independent of the email send (sendEmail flag) — Slack
    // fires on EVERY export, manual or auto, because the user already opted
    // in by saving the webhook. Failure is logged, doesn't affect the export.
    if (req.user?.email) {
      (async () => {
        try {
          const settings = await getUserSettings(domain, req.user.email);
          if (!settings.slackWebhookUrl) return;
          await sendSlackDigest({
            webhookUrl: settings.slackWebhookUrl,
            meetingTitle: meetingTitle || 'Google Meet',
            totalAttended,
            totalInvited,
            participants: digestPresentRows(participants, exportedAt).concat(
              digestAbsentRows(calendarAttendees, { attendedEmails, attendedNames, excusedSet })
            ),
            sheetUrl,
            durationMin: meetDurationMin,
            startTime: meetingStartTime || exportedAt,
          });
        } catch (err) {
          log.warn('slack digest post-export failed', { error: err.message, email: req.user.email });
        }
      })();
    }

    // Fire-and-forget: email the organizer the sheet link. Only when explicitly
    // requested by the client (auto-export flow) — manual exports get the
    // in-product toast and don't need inbox noise.
    if (sendEmail && req.user?.email) {
      // Build a digest-friendly participant list (top 25, present first) so the
      // email can render an inline table without exposing the raw row arrays.
      const digestPresent = digestPresentRows(participants, exportedAt, lateMinFor);
      const digestAbsent = digestAbsentRows(calendarAttendees, { attendedEmails, attendedNames, excusedSet });
      const digestParticipants = [...digestPresent, ...digestAbsent].slice(0, 25);
      const digestOverflow = (digestPresent.length + digestAbsent.length) - digestParticipants.length;

      sendExportNotification({
        to: req.user.email,
        displayName: req.user.displayName || null,
        sheetUrl,
        meetingTitle: meetingTitle || 'Google Meet',
        totalAttended,
        totalInvited,
        exportedAt,
        participants: digestParticipants,
        overflow: digestOverflow > 0 ? digestOverflow : 0,
        conferenceId: conferenceId || null,
        recurringEventId: recurringEventId || null,
      });
    }

  } catch (err) {
    // 403 means the user didn't grant the drive.file scope during OAuth consent.
    // Google's consent screen lets users selectively uncheck non-sensitive scopes.
    if (err.code === 403 || /insufficient permission/i.test(err.message || '')) {
      log.warn('sheets export blocked by missing drive permission', { email: req.user?.email });
      return res.status(403).json({
        error: 'Google Drive permission is required to export attendance to Sheets. Please sign out and sign in again, keeping the Drive permission checked.',
        code: 'DRIVE_PERMISSION_MISSING',
      });
    }
    log.error('sheets export failed', { error: err.message });
    res.status(500).json({ error: 'Failed to export to Google Sheets.' });
  }
});

module.exports = router;
