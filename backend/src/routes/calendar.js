const { Router } = require('express');
const { google } = require('googleapis');
const { getGoogleClient } = require('../services/googleAuth');
const CONFIG = require('../config');
const log = require('../lib/logger');
const { persistCalendarData } = require('../services/firestore');

const router = Router();

// Extract meeting code from a Meet URL (e.g., "https://meet.google.com/abc-defg-hij" → "abc-defg-hij")
function extractMeetCode(url) {
  const match = (url || '').match(/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})/);
  return match ? match[1] : null;
}

router.get('/calendar-attendees', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { meetingCode, calendarId } = req.query;
  if (!meetingCode) return res.status(400).json({ error: 'meetingCode is required' });

  try {
    // Use user's OAuth token if available, otherwise fall back to service account
    const calAuth = await getGoogleClient(req, 'https://www.googleapis.com/auth/calendar.readonly');
    const calendar = google.calendar({ version: 'v3', auth: calAuth });

    const timeMin = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(Date.now() +  7 * 24 * 60 * 60 * 1000).toISOString();

    const eventsResp = await calendar.events.list({
      calendarId:   calendarId || 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      maxResults:   250,
      conferenceDataVersion: 1, // ensure conferenceData is populated
    });

    const events = eventsResp.data.items || [];
    log.info('calendar events scanned', { count: events.length, meetingCode, calendarId: calendarId || 'primary' });

    // Find all events matching this meeting code — exact segment match, skip all-day events
    const matchingEvents = events.filter(e => {
      // Skip all-day events (they rarely have Meet links, and distance calc breaks)
      if (!e.start.dateTime) return false;
      const meetCode    = extractMeetCode(e.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri);
      const hangoutCode = extractMeetCode(e.hangoutLink);
      return meetCode === meetingCode || hangoutCode === meetingCode;
    });

    // Pick the event closest to the current time (handles recurring meetings)
    let matchedEvent = null;
    if (matchingEvents.length === 1) {
      matchedEvent = matchingEvents[0];
    } else if (matchingEvents.length > 1) {
      const now = Date.now();
      matchedEvent = matchingEvents.reduce((closest, e) => {
        const eStart = new Date(e.start.dateTime).getTime();
        const closestStart = new Date(closest.start.dateTime).getTime();
        return Math.abs(eStart - now) < Math.abs(closestStart - now) ? e : closest;
      });
      log.info('recurring meeting — picked closest instance', { total: matchingEvents.length, picked: matchedEvent.start.dateTime });
    }

    if (!matchedEvent) {
      log.info('no calendar event matched — instant meeting', { meetingCode });
      return res.json({ attendees: [], isScheduled: false });
    }

    log.info('calendar event matched', { title: matchedEvent.summary });

    const attendees = (matchedEvent.attendees || [])
      .filter(a => !a.resource)
      .map(a => ({
        email:       a.email,
        displayName: a.displayName || a.email.split('@')[0],
        status:      a.responseStatus,
      }));

    // recurringEventId is set by Google Calendar when this event is part of a
    // series (weekly standup, monthly review, etc.). It's the same value for
    // every instance — the join key for our Series roll-up view.
    const recurringEventId = matchedEvent.recurringEventId || null;
    const eventId = matchedEvent.id || null;
    const htmlLink = matchedEvent.htmlLink || null;

    res.json({
      isScheduled: true,
      eventTitle: matchedEvent.summary || 'Scheduled Meeting',
      eventStart: matchedEvent.start?.dateTime || matchedEvent.start?.date || null,
      eventEnd: matchedEvent.end?.dateTime || matchedEvent.end?.date || null,
      eventId,
      recurringEventId,
      htmlLink,
      attendees,
    });

    // Fire-and-forget: store title + invited attendees + series id for analytics
    const domain = req.user?.domain || 'default';
    persistCalendarData(domain, meetingCode, matchedEvent.summary || 'Scheduled Meeting', attendees, { recurringEventId, eventId });

  } catch (err) {
    // Insufficient Permission (403) means user didn't grant calendar scope during OAuth.
    // Degrade gracefully — let the rest of the add-on work without calendar features.
    if (err.code === 403 || /insufficient permission/i.test(err.message)) {
      log.info('calendar permission not granted, skipping calendar lookup', { email: req.user?.email });
      return res.json({ attendees: [], isScheduled: false, calendarPermissionMissing: true });
    }
    log.error('calendar lookup failed', { error: err.message });
    res.status(500).json({ error: 'Failed to look up calendar data.' });
  }
});

module.exports = router;
