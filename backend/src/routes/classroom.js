// Google Classroom roster import & grade sync — lets a teacher pull a course's
// student list into the Class Roster, and write attendance grades directly
// into Classroom coursework assignments.
//
// All routes use the SIGNED-IN USER's OAuth token only (makeUserClient, no
// getGoogleClient service-account fallback — the SA impersonation path would
// read the wrong org's Classroom and must never be reachable here). The
// Classroom scopes are OPTIONAL and requested via incremental consent, so a
// 403 from Google is an expected state surfaced as { scopeMissing: true }.
const { Router } = require('express');
const { google } = require('googleapis');
const { makeUserClient } = require('../services/googleAuth');
const { requireAuth } = require('../middleware/auth');
const { planIsPro } = require('./billing');
const { isMeetingUnlocked } = require('../services/firestore');
const log = require('../lib/logger');

const router = Router();

// Scopes required for Classroom features:
//   classroom.courses.readonly        — list the teacher's courses
//   classroom.rosters.readonly        — list each course's students
//   classroom.profile.emails          — include student email addresses in profiles
//   classroom.coursework.students     — list/create coursework & write student grades
const scopeMissing = (err) =>
  err?.code === 403 || /insufficient|PERMISSION_DENIED/i.test(err?.message || '');

const isAuthExpired = (err) => {
  const gStatus = err?.status || err?.code || err?.response?.status;
  const msg = `${err?.message || ''} ${err?.response?.data?.error || ''} ${err?.response?.data?.error_description || ''}`;
  const hasAuthErrorReason = Array.isArray(err?.errors) && err.errors.some(e => e.reason === 'authError' || e.reason === 'invalidCredentials');
  return gStatus === 401 || hasAuthErrorReason || /invalid_grant|invalid credentials|unauthorized_client|no access, refresh token|invalid authentication cred/i.test(msg);
};

// Mirror sheets.js's explicit AUTH_EXPIRED contract.
function requireAccessToken(req, res) {
  if (req.user?.accessToken) return true;
  log.info('classroom: no access token — session needs re-auth', { email: req.user?.email });
  res.status(401).json({ error: 'Your Google session expired. Please sign in again.', code: 'AUTH_EXPIRED' });
  return false;
}

// Grade calculation helper
function calculateClassroomGrade(record, maxPoints = 100, opts = {}) {
  const pointsPresent = typeof opts.pointsPresent === 'number' ? opts.pointsPresent : maxPoints;
  const pointsLate = typeof opts.pointsLate === 'number' ? opts.pointsLate : Math.round(maxPoints * 0.8);
  const pointsAbsent = typeof opts.pointsAbsent === 'number' ? opts.pointsAbsent : 0;

  if (record.points !== undefined && record.points !== null && record.points !== '') {
    const num = Number(record.points);
    if (Number.isFinite(num)) {
      return Math.max(0, Math.min(maxPoints, Math.round(num)));
    }
  }
  if (record.grade !== undefined && record.grade !== null && record.grade !== '') {
    const num = Number(record.grade);
    if (Number.isFinite(num)) {
      return Math.max(0, Math.min(maxPoints, Math.round(num)));
    }
  }
  if (record.percentage !== undefined && record.percentage !== null && record.percentage !== '') {
    const num = Number(record.percentage);
    if (Number.isFinite(num)) {
      const pctVal = num <= 1 && num > 0 ? num * 100 : num;
      return Math.max(0, Math.min(maxPoints, Math.round((pctVal / 100) * maxPoints)));
    }
  }
  const status = (record.status || '').toLowerCase();
  if (status === 'present') return pointsPresent;
  if (status === 'late') return pointsLate;
  if (status === 'absent') return pointsAbsent;
  return pointsPresent;
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
    if (isAuthExpired(err)) {
      log.warn('classroom: google auth expired', { email: req.user.email, error: err.message });
      return res.status(401).json({ error: 'Your Google session expired. Please sign in again.', code: 'AUTH_EXPIRED' });
    }
    if (scopeMissing(err)) {
      log.info('classroom: courses scope not granted', { email: req.user.email });
      return res.status(403).json({ error: 'classroom_scope_missing', scopeMissing: true });
    }
    log.error('classroom: course list failed', { email: req.user.email, error: err.message });
    res.status(500).json({ error: 'Failed to list Classroom courses.' });
  }
});

// GET /api/classroom/courses/:courseId/students — the course roster.
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
          email: (s.profile?.emailAddress || '').toLowerCase(),
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken && students.length < 1000);
    res.json({ students });
  } catch (err) {
    if (isAuthExpired(err)) {
      log.warn('classroom: google auth expired', { email: req.user.email, error: err.message });
      return res.status(401).json({ error: 'Your Google session expired. Please sign in again.', code: 'AUTH_EXPIRED' });
    }
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

// GET /api/classroom/courses/:courseId/courseWork — list assignments for a course
router.get('/classroom/courses/:courseId/courseWork', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!requireAccessToken(req, res)) return;
  const { courseId } = req.params;
  try {
    const classroom = google.classroom({ version: 'v1', auth: makeUserClient(req.user.accessToken) });
    const courseWork = [];
    let pageToken;
    do {
      const { data } = await classroom.courses.courseWork.list({
        courseId,
        pageSize: 100,
        pageToken,
      });
      for (const cw of (data.courseWork || [])) {
        courseWork.push({
          id: cw.id,
          title: cw.title || 'Untitled Assignment',
          state: cw.state,
          maxPoints: cw.maxPoints ?? 100,
          alternateLink: cw.alternateLink || '',
          creationTime: cw.creationTime,
        });
      }
      pageToken = data.nextPageToken;
    } while (pageToken && courseWork.length < 500);
    res.json({ courseWork });
  } catch (err) {
    if (isAuthExpired(err)) {
      log.warn('classroom: google auth expired', { email: req.user.email, error: err.message });
      return res.status(401).json({ error: 'Your Google session expired. Please sign in again.', code: 'AUTH_EXPIRED' });
    }
    if (scopeMissing(err)) {
      log.info('classroom: coursework scope not granted', { email: req.user.email });
      return res.status(403).json({ error: 'classroom_scope_missing', scopeMissing: true });
    }
    if (err?.code === 404) {
      return res.status(404).json({ error: 'Course not found.' });
    }
    log.error('classroom: coursework list failed', { email: req.user.email, courseId, error: err.message });
    res.status(500).json({ error: 'Failed to list course assignments.' });
  }
});

// POST /api/classroom/courses/:courseId/courseWork — create coursework assignment
router.post('/classroom/courses/:courseId/courseWork', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!requireAccessToken(req, res)) return;
  const confId = req.body?.conferenceId || req.query?.conferenceId;
  const isAllowed = (await planIsPro(req.user?.domain, req.user?.email))
    || (confId && typeof isMeetingUnlocked === 'function' && await isMeetingUnlocked(req.user?.domain, req.user?.email, confId));
  if (!isAllowed) {
    return res.status(402).json({ error: 'Google Classroom grade sync is a Pro feature.', feature: 'lmsSync' });
  }
  const { courseId } = req.params;
  const { title, maxPoints, description } = req.body || {};
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Assignment title is required.' });
  }
  try {
    const classroom = google.classroom({ version: 'v1', auth: makeUserClient(req.user.accessToken) });
    const { data } = await classroom.courses.courseWork.create({
      courseId,
      requestBody: {
        title: title.trim(),
        maxPoints: typeof maxPoints === 'number' && maxPoints > 0 ? maxPoints : 100,
        workType: 'ASSIGNMENT',
        state: 'PUBLISHED',
        description: description || 'Google Meet attendance record synced via Attendance Tracker',
      },
    });
    res.json({
      courseWork: {
        id: data.id,
        title: data.title,
        maxPoints: data.maxPoints,
        alternateLink: data.alternateLink || '',
      },
    });
  } catch (err) {
    if (isAuthExpired(err)) {
      log.warn('classroom: google auth expired', { email: req.user.email, error: err.message });
      return res.status(401).json({ error: 'Your Google session expired. Please sign in again.', code: 'AUTH_EXPIRED' });
    }
    if (scopeMissing(err)) {
      log.info('classroom: coursework create scope not granted', { email: req.user.email });
      return res.status(403).json({ error: 'classroom_scope_missing', scopeMissing: true });
    }
    log.error('classroom: coursework create failed', { email: req.user.email, courseId, error: err.message });
    res.status(500).json({ error: 'Failed to create coursework assignment.' });
  }
});

// Handler for Google Classroom grade writeback
async function handleClassroomGradeSync(req, res) {
  res.set('Cache-Control', 'no-store');
  if (!requireAccessToken(req, res)) return;
  const confId = req.body?.conferenceId || req.query?.conferenceId;
  const isAllowed = (await planIsPro(req.user?.domain, req.user?.email))
    || (confId && typeof isMeetingUnlocked === 'function' && await isMeetingUnlocked(req.user?.domain, req.user?.email, confId));
  if (!isAllowed) {
    return res.status(402).json({ error: 'Google Classroom grade sync is a Pro feature.', feature: 'lmsSync' });
  }

  const courseId = req.params.courseId || req.body?.courseId;
  let courseWorkId = req.params.courseWorkId || req.body?.courseWorkId;
  const records = req.body?.records || [];

  if (!courseId) {
    return res.status(400).json({ error: 'courseId is required.' });
  }
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'No attendance records provided to sync.' });
  }

  try {
    const classroom = google.classroom({ version: 'v1', auth: makeUserClient(req.user.accessToken) });

    // 1. If courseWorkId is '__new__' or empty, create the assignment first
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if ((!courseWorkId || courseWorkId === '__new__') && title) {
      const rawMax = req.body?.maxPoints;
      const pts = typeof rawMax === 'number' && rawMax > 0 ? rawMax : (parseInt(rawMax, 10) || 100);
      const created = await classroom.courses.courseWork.create({
        courseId,
        requestBody: {
          title,
          maxPoints: pts,
          workType: 'ASSIGNMENT',
          state: 'PUBLISHED',
          description: req.body?.description || 'Google Meet attendance record synced via Attendance Tracker',
        },
      });
      courseWorkId = created.data.id;
    }

    if (!courseWorkId || courseWorkId === '__new__') {
      return res.status(400).json({ error: 'courseWorkId is required (or provide title to create a new assignment).' });
    }

    // 2. Fetch course students to map emails & names to userIds
    const students = [];
    let studentPageToken;
    do {
      const { data } = await classroom.courses.students.list({
        courseId,
        pageSize: 100,
        pageToken: studentPageToken,
      });
      students.push(...(data.students || []));
      studentPageToken = data.nextPageToken;
    } while (studentPageToken && students.length < 1000);

    const emailToUserId = new Map();
    const nameToUserId = new Map();
    const userIdToProfile = new Map();

    for (const s of students) {
      const email = (s.profile?.emailAddress || '').toLowerCase().trim();
      const name = (s.profile?.name?.fullName || '').toLowerCase().trim();
      const uid = s.userId;
      if (email && uid) emailToUserId.set(email, uid);
      if (name && uid) nameToUserId.set(name, uid);
      if (uid) userIdToProfile.set(uid, { name: s.profile?.name?.fullName || '', email });
    }

    // 3. Fetch student submissions for the assignment
    const submissions = [];
    let subPageToken;
    do {
      const { data } = await classroom.courses.courseWork.studentSubmissions.list({
        courseId,
        courseWorkId,
        pageSize: 100,
        pageToken: subPageToken,
      });
      submissions.push(...(data.studentSubmissions || []));
      subPageToken = data.nextPageToken;
    } while (subPageToken && submissions.length < 1000);

    const userIdToSubmission = new Map();
    for (const sub of submissions) {
      if (sub.userId) userIdToSubmission.set(sub.userId, sub);
    }

    // 4. Match records and patch submissions
    const results = [];
    const rawMax = req.body?.maxPoints;
    const maxPoints = typeof rawMax === 'number' && rawMax > 0 ? rawMax : (parseInt(rawMax, 10) || 100);
    const opts = {
      pointsPresent: typeof req.body?.pointsPresent === 'number' ? req.body.pointsPresent : (req.body?.pointsPresent != null && !isNaN(Number(req.body.pointsPresent)) ? Number(req.body.pointsPresent) : undefined),
      pointsLate: typeof req.body?.pointsLate === 'number' ? req.body.pointsLate : (req.body?.pointsLate != null && !isNaN(Number(req.body.pointsLate)) ? Number(req.body.pointsLate) : undefined),
      pointsAbsent: typeof req.body?.pointsAbsent === 'number' ? req.body.pointsAbsent : (req.body?.pointsAbsent != null && !isNaN(Number(req.body.pointsAbsent)) ? Number(req.body.pointsAbsent) : undefined),
    };
    const returnGrades = req.body?.returnGrades === true;

    for (const rec of records) {
      const email = (rec.email || '').toLowerCase().trim();
      const name = (rec.name || '').toLowerCase().trim();
      let matchedUserId = null;

      if (rec.userId && userIdToSubmission.has(rec.userId)) {
        matchedUserId = rec.userId;
      } else if (email && emailToUserId.has(email)) {
        matchedUserId = emailToUserId.get(email);
      } else if (name && nameToUserId.has(name)) {
        matchedUserId = nameToUserId.get(name);
      }

      const submission = matchedUserId ? userIdToSubmission.get(matchedUserId) : null;
      if (submission) {
        const grade = calculateClassroomGrade(rec, maxPoints, opts);
        try {
          const isReturned = submission.state === 'RETURNED';
          await classroom.courses.courseWork.studentSubmissions.patch({
            courseId,
            courseWorkId,
            id: submission.id,
            updateMask: isReturned ? 'assignedGrade,draftGrade' : 'draftGrade',
            requestBody: isReturned ? {
              assignedGrade: grade,
              draftGrade: grade,
            } : {
              draftGrade: grade,
            },
          });

          if (returnGrades && classroom.courses.courseWork.studentSubmissions.return) {
            try {
              await classroom.courses.courseWork.studentSubmissions.return({
                courseId,
                courseWorkId,
                id: submission.id,
                requestBody: {},
              });
            } catch (retErr) {
              if (isAuthExpired(retErr)) throw retErr;
              log.warn('classroom: return grade warning', { error: retErr.message });
            }
          }

          const prof = userIdToProfile.get(matchedUserId) || {};
          results.push({
            userId: matchedUserId,
            name: prof.name || rec.name || '',
            email: prof.email || rec.email || '',
            grade,
            status: 'synced',
            submissionId: submission.id,
          });
        } catch (patchErr) {
          if (isAuthExpired(patchErr)) throw patchErr;
          results.push({
            userId: matchedUserId,
            email: rec.email || '',
            name: rec.name || '',
            grade,
            status: 'failed',
            error: patchErr.message,
          });
        }
      } else {
        results.push({
          email: rec.email || '',
          name: rec.name || '',
          status: 'unmatched',
          reason: 'Student not enrolled or no submission found in course',
        });
      }
    }

    const syncedCount = results.filter(r => r.status === 'synced').length;
    log.info('classroom: synced grades', {
      user: req.user.email,
      courseId,
      courseWorkId,
      syncedCount,
      totalCount: records.length,
    });

    if (syncedCount === 0) {
      return res.status(200).json({
        success: false,
        syncedCount: 0,
        totalCount: records.length,
        courseId,
        courseWorkId,
        message: 'No meeting attendees matched students in the Classroom course roster or grades could not be updated.',
        results,
      });
    }

    res.json({
      success: true,
      syncedCount,
      totalCount: records.length,
      courseId,
      courseWorkId,
      results,
    });
  } catch (err) {
    if (isAuthExpired(err)) {
      log.warn('classroom: google auth expired', { email: req.user.email, error: err.message });
      return res.status(401).json({ error: 'Your Google session expired. Please sign in again.', code: 'AUTH_EXPIRED' });
    }
    if (scopeMissing(err)) {
      log.info('classroom: grade sync scope not granted', { email: req.user.email });
      return res.status(403).json({ error: 'classroom_scope_missing', scopeMissing: true });
    }
    if (err?.code === 404) {
      return res.status(404).json({ error: 'Course or assignment not found in Classroom.' });
    }
    log.error('classroom: grade sync failed', { email: req.user.email, courseId, courseWorkId, error: err.message });
    res.status(500).json({ error: 'Failed to sync grades to Google Classroom.' });
  }
}

// POST /api/classroom/courses/:courseId/courseWork/:courseWorkId/sync-grades
router.post('/classroom/courses/:courseId/courseWork/:courseWorkId/sync-grades', requireAuth, handleClassroomGradeSync);

// POST /api/classroom/sync-grades (flexible signature)
router.post('/classroom/sync-grades', requireAuth, handleClassroomGradeSync);

module.exports = router;
