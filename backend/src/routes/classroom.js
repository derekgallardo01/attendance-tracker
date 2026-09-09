// Google Classroom roster import — lets a teacher pull a course's student
// list into the side panel's Class Roster instead of pasting it by hand.
//
// Both routes use the SIGNED-IN USER's OAuth token only (makeUserClient, no
// getGoogleClient service-account fallback — the SA impersonation path would
// read the wrong org's Classroom and must never be reachable here). The
// Classroom scopes are OPTIONAL and requested via incremental consent from
// the roster modal, so a 403 from Google is an expected state the frontend
// uses to trigger the re-consent flow — surfaced as { scopeMissing: true }.
const { Router } = require('express');
const { google } = require('googleapis');
const { makeUserClient } = require('../services/googleAuth');
const { requireAuth } = require('../middleware/auth');
const log = require('../lib/logger');

const router = Router();

// Scopes the frontend must request for these routes to work (documented here;
// the actual request happens in index.html's incremental-consent flow):
//   classroom.courses.readonly  — list the teacher's courses
//   classroom.rosters.readonly  — list each course's students
//   classroom.profile.emails    — include student email addresses in profiles
const scopeMissing = (err) =>
  err?.code === 403 || /insufficient|PERMISSION_DENIED/i.test(err?.message || '');

// The auth middleware sets accessToken null when the refresh token is gone or
// the refresh failed. makeUserClient(null) then gets a 401 from Google — which
// scopeMissing() does NOT match — so this used to surface as a generic 500
// that never triggered the frontend's re-auth flow. Mirror sheets.js's
// explicit AUTH_EXPIRED contract instead.
function requireAccessToken(req, res) {
  if (req.user?.accessToken) return true;
  log.info('classroom: no access token — session needs re-auth', { email: req.user?.email });
  res.status(401).json({ error: 'Your Google session expired. Please sign in again.', code: 'AUTH_EXPIRED' });
  return false;
}

// GET /api/classroom/courses — active courses the user teaches.
router.get('/classroom/courses', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!requireAccessToken(req, res)) return;
  try {
    const classroom = google.classroom({ version: 'v1', auth: makeUserClient(req.user.accessToken) });
    const courses = [];
    let pageToken;
    do {
      const { data } = await classroom.courses.list({
        teacherId: 'me',
        courseStates: ['ACTIVE'],
        pageSize: 100,
        pageToken,
      });
      courses.push(...(data.courses || []));
      pageToken = data.nextPageToken;
    } while (pageToken && courses.length < 500);
    res.json({
      courses: courses.map(c => ({ id: c.id, name: c.name, section: c.section || '' })),
    });
  } catch (err) {
    if (scopeMissing(err)) {
      log.info('classroom: courses scope not granted', { email: req.user.email });
      return res.status(403).json({ error: 'classroom_scope_missing', scopeMissing: true });
    }
    log.error('classroom: course list failed', { email: req.user.email, error: err.message });
    res.status(500).json({ error: 'Failed to list Classroom courses.' });
  }
});

// GET /api/classroom/courses/:courseId/students — the course roster, shaped
// for the panel's parseStudentsInput contract ({ name, email }).
router.get('/classroom/courses/:courseId/students', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!requireAccessToken(req, res)) return;
  const { courseId } = req.params;
  try {
    const classroom = google.classroom({ version: 'v1', auth: makeUserClient(req.user.accessToken) });
    const students = [];
    let pageToken;
    do {
      const { data } = await classroom.courses.students.list({
        courseId,
        pageSize: 100,
        pageToken,
      });
      for (const s of (data.students || [])) {
        students.push({
          name: s.profile?.name?.fullName || '',
          // Requires classroom.profile.emails; empty when the scope (or the
          // school's privacy settings) withholds it — name-only entries still
          // work for display-name matching.
          email: (s.profile?.emailAddress || '').toLowerCase(),
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken && students.length < 1000);
    res.json({ students });
  } catch (err) {
    if (scopeMissing(err)) {
      log.info('classroom: roster scope not granted', { email: req.user.email });
      return res.status(403).json({ error: 'classroom_scope_missing', scopeMissing: true });
    }
    if (err?.code === 404) {
      return res.status(404).json({ error: 'Course not found.' });
    }
    log.error('classroom: student list failed', { email: req.user.email, courseId, error: err.message });
    res.status(500).json({ error: 'Failed to list course students.' });
  }
});

module.exports = router;
