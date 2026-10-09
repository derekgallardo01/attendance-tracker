// Canvas LMS Grade Sync — allows teachers to write attendance grades directly
// into Canvas course assignments via the Canvas REST API.
//
// Supports:
// 1. Storing Canvas instance URL and API token in tenant-scoped userSettings
//    or passing credentials per request with optional save.
// 2. Listing courses where the user is an active teacher.
// 3. Listing and creating assignments within a course.
// 4. Batch grade writeback (POST /api/v1/courses/:courseId/assignments/:assignmentId/submissions/update_grades)
//    with student matching by email, login ID, or name, calculating attendance points or percentages.

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { planIsPro } = require('./billing');
const log = require('../lib/logger');
const { getUserSettings, updateUserSettings } = require('../services/firestore');

const router = Router();

function cleanCanvasUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    const hasDot = url.hostname.includes('.');
    const isLocal = url.hostname === 'localhost' || url.hostname.endsWith('.local');
    const hasPort = Boolean(url.port);
    if (!hasDot && !isLocal && !hasPort) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function maskCanvasToken(token) {
  if (!token || typeof token !== 'string') return '';
  const trimmed = token.trim();
  if (trimmed.length <= 4) return '••••';
  return '••••' + trimmed.slice(-4);
}

// Extract credentials from request headers/body/query or saved user settings.
async function resolveCanvasAuth(req) {
  const urlFromReq = req.headers['x-canvas-url'] || req.body?.instanceUrl || req.query?.instanceUrl;
  const tokenFromReq = req.headers['x-canvas-token'] || req.body?.canvasToken || req.body?.token || req.query?.token;

  let instanceUrl = cleanCanvasUrl(urlFromReq);
  let token = typeof tokenFromReq === 'string' && tokenFromReq.trim() ? tokenFromReq.trim() : null;

  if (!instanceUrl || !token) {
    const settings = await getUserSettings(req.user.domain, req.user.email);
    if (!instanceUrl && settings.canvasInstanceUrl) {
      instanceUrl = cleanCanvasUrl(settings.canvasInstanceUrl);
    }
    if (!token && settings.canvasToken) {
      token = settings.canvasToken.trim();
    }
  }

  return { instanceUrl, token };
}

// Grade calculation helper matching classroom and CSV export logic
function calculateAttendanceGrade(record, maxPoints = 100, opts = {}) {
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

// GET /api/canvas/settings — check if Canvas credentials are saved
router.get('/canvas/settings', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const settings = await getUserSettings(req.user.domain, req.user.email);
    res.json({
      configured: !!(settings.canvasInstanceUrl && settings.canvasToken),
      instanceUrl: settings.canvasInstanceUrl || '',
      tokenMasked: maskCanvasToken(settings.canvasToken),
    });
  } catch (err) {
    log.error('canvas: get settings failed', { email: req.user.email, error: err.message });
    res.status(500).json({ error: 'Failed to fetch Canvas settings.' });
  }
});

// POST /api/canvas/settings — save Canvas credentials in user settings
router.post('/canvas/settings', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { instanceUrl, token } = req.body || {};
  const cleaned = cleanCanvasUrl(instanceUrl);
  if (!cleaned && instanceUrl !== null && instanceUrl !== '') {
    return res.status(400).json({ error: 'Invalid Canvas instance URL. Must be a valid domain or http/https URL.' });
  }

  try {
    const patch = {};
    if (instanceUrl !== undefined) patch.canvasInstanceUrl = cleaned;
    if (token !== undefined) patch.canvasToken = token ? token.trim() : null;

    await updateUserSettings(req.user.domain, req.user.email, patch);
    res.json({
      saved: true,
      configured: !!(patch.canvasInstanceUrl && patch.canvasToken),
      instanceUrl: patch.canvasInstanceUrl || '',
      tokenMasked: maskCanvasToken(patch.canvasToken),
    });
  } catch (err) {
    log.error('canvas: save settings failed', { email: req.user.email, error: err.message });
    res.status(500).json({ error: 'Failed to save Canvas settings.' });
  }
});

// GET /api/canvas/courses — list active courses where user is teacher
router.get('/canvas/courses', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { instanceUrl, token } = await resolveCanvasAuth(req);
  if (!instanceUrl || !token) {
    return res.status(400).json({
      error: 'Canvas instance URL and access token are required. Provide them in settings or request headers.',
      code: 'CANVAS_AUTH_REQUIRED',
    });
  }

  try {
    const canvasRes = await fetch(`${instanceUrl}/api/v1/courses?enrollment_type=teacher&state[]=available&per_page=100`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (canvasRes.status === 401) {
      return res.status(401).json({ error: 'Canvas API token is invalid or expired.', code: 'CANVAS_UNAUTHORIZED' });
    }
    if (canvasRes.status === 403) {
      return res.status(403).json({ error: 'Canvas permissions insufficient to list courses.', code: 'CANVAS_FORBIDDEN' });
    }
    if (!canvasRes.ok) {
      const errText = await canvasRes.text().catch(() => '');
      log.warn('canvas: list courses upstream error', { status: canvasRes.status, body: errText });
      return res.status(canvasRes.status).json({ error: `Canvas error: ${canvasRes.statusText}` });
    }

    const data = await canvasRes.json();
    const courses = (Array.isArray(data) ? data : []).map(c => ({
      id: c.id,
      name: c.name || `Course ${c.id}`,
      courseCode: c.course_code || '',
    }));

    res.json({ courses });
  } catch (err) {
    log.error('canvas: list courses failed', { email: req.user.email, error: err.message });
    res.status(502).json({ error: `Could not connect to Canvas instance at ${instanceUrl}. Check URL.`, code: 'CANVAS_NETWORK_ERROR' });
  }
});

// GET /api/canvas/courses/:courseId/assignments — list assignments for a course
router.get('/canvas/courses/:courseId/assignments', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const { courseId } = req.params;
  const { instanceUrl, token } = await resolveCanvasAuth(req);
  if (!instanceUrl || !token) {
    return res.status(400).json({ error: 'Canvas credentials required.', code: 'CANVAS_AUTH_REQUIRED' });
  }

  try {
    const canvasRes = await fetch(`${instanceUrl}/api/v1/courses/${encodeURIComponent(courseId)}/assignments?per_page=100`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
      },
    });

    if (canvasRes.status === 401) {
      return res.status(401).json({ error: 'Canvas API token invalid or expired.', code: 'CANVAS_UNAUTHORIZED' });
    }
    if (canvasRes.status === 404) {
      return res.status(404).json({ error: 'Canvas course not found.', code: 'CANVAS_NOT_FOUND' });
    }
    if (!canvasRes.ok) {
      return res.status(canvasRes.status).json({ error: `Canvas error: ${canvasRes.statusText}` });
    }

    const data = await canvasRes.json();
    const assignments = (Array.isArray(data) ? data : []).map(a => ({
      id: a.id,
      name: a.name || `Assignment ${a.id}`,
      pointsPossible: a.points_possible ?? 100,
      published: a.published !== false,
      htmlUrl: a.html_url || '',
    }));

    res.json({ assignments });
  } catch (err) {
    log.error('canvas: list assignments failed', { courseId, error: err.message });
    res.status(502).json({ error: 'Failed to communicate with Canvas.', code: 'CANVAS_NETWORK_ERROR' });
  }
});

// POST /api/canvas/courses/:courseId/assignments — create an assignment in Canvas
router.post('/canvas/courses/:courseId/assignments', requireAuth, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const isPro = await planIsPro(req.user?.domain, req.user?.email);
  if (!isPro) {
    return res.status(402).json({ error: 'Canvas LMS grade sync is a Pro feature.', feature: 'lmsSync' });
  }
  const { courseId } = req.params;
  const { instanceUrl, token } = await resolveCanvasAuth(req);
  if (!instanceUrl || !token) {
    return res.status(400).json({ error: 'Canvas credentials required.', code: 'CANVAS_AUTH_REQUIRED' });
  }

  const { name, pointsPossible, description } = req.body || {};
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Assignment name is required.' });
  }

  try {
    const canvasRes = await fetch(`${instanceUrl}/api/v1/courses/${encodeURIComponent(courseId)}/assignments`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        assignment: {
          name: name.trim(),
          points_possible: typeof pointsPossible === 'number' && pointsPossible > 0 ? pointsPossible : 100,
          description: description || 'Google Meet attendance record synced via Attendance Tracker',
          submission_types: ['none'],
          grading_type: 'points',
          published: true,
        },
      }),
    });

    if (!canvasRes.ok) {
      const errText = await canvasRes.text().catch(() => '');
      log.warn('canvas: create assignment failed', { status: canvasRes.status, body: errText });
      return res.status(canvasRes.status).json({ error: `Canvas error: ${canvasRes.statusText}` });
    }

    const a = await canvasRes.json();
    res.json({
      assignment: {
        id: a.id,
        name: a.name,
        pointsPossible: a.points_possible,
        htmlUrl: a.html_url || '',
      },
    });
  } catch (err) {
    log.error('canvas: create assignment failed', { courseId, error: err.message });
    res.status(502).json({ error: 'Failed to create Canvas assignment.', code: 'CANVAS_NETWORK_ERROR' });
  }
});

// Sync handler implementation for Canvas
async function handleCanvasGradeSync(req, res) {
  res.set('Cache-Control', 'no-store');
  const isPro = await planIsPro(req.user?.domain, req.user?.email);
  if (!isPro) {
    return res.status(402).json({ error: 'Canvas LMS grade sync is a Pro feature.', feature: 'lmsSync' });
  }
  const courseId = req.params.courseId || req.body?.courseId;
  let assignmentId = req.params.assignmentId || req.body?.assignmentId;
  const records = req.body?.records || [];
  const saveToken = req.body?.saveToken === true;

  if (!courseId) {
    return res.status(400).json({ error: 'courseId is required.' });
  }
  if (!Array.isArray(records) || records.length === 0) {
    return res.status(400).json({ error: 'No attendance records provided to sync.' });
  }

  const { instanceUrl, token } = await resolveCanvasAuth(req);
  if (!instanceUrl || !token) {
    return res.status(400).json({ error: 'Canvas instance URL and access token are required.', code: 'CANVAS_AUTH_REQUIRED' });
  }

  // Optionally persist credentials to user settings if requested
  if (saveToken) {
    updateUserSettings(req.user.domain, req.user.email, {
      canvasInstanceUrl: instanceUrl,
      canvasToken: token,
    }).catch(err => log.warn('canvas: auto-save token failed', { error: err.message }));
  }

  try {
    // 1. If no assignmentId, or client requested createAssignment, create a new assignment
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const rawMax = req.body?.maxPoints;
    const maxPoints = typeof rawMax === 'number' && rawMax > 0 ? rawMax : (parseInt(rawMax, 10) || 100);

    if ((!assignmentId || assignmentId === '__new__') && title) {
      const createRes = await fetch(`${instanceUrl}/api/v1/courses/${encodeURIComponent(courseId)}/assignments`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          assignment: {
            name: title,
            points_possible: maxPoints,
            description: req.body?.description || 'Google Meet attendance grades',
            submission_types: ['none'],
            grading_type: 'points',
            published: true,
          },
        }),
      });
      if (!createRes.ok) {
        return res.status(createRes.status).json({ error: 'Failed to create assignment in Canvas before grade sync.' });
      }
      const newAssignment = await createRes.json();
      assignmentId = newAssignment.id;
    }

    if (!assignmentId || assignmentId === '__new__') {
      return res.status(400).json({ error: 'assignmentId is required (or provide title to create a new assignment).' });
    }

    // 2. Fetch enrolled students to match records by email / login_id / name (with pagination support)
    function getNextPageUrl(linkHeader) {
      if (!linkHeader) return null;
      const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/i);
      return match ? match[1] : null;
    }

    let nextUrl = `${instanceUrl}/api/v1/courses/${encodeURIComponent(courseId)}/users?enrollment_type[]=student&include[]=email&per_page=100`;
    const students = [];
    let pageCount = 0;

    while (nextUrl && pageCount < 10) {
      pageCount++;
      const studentsRes = await fetch(nextUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json',
        },
      });

      if (studentsRes.status === 401) {
        return res.status(401).json({ error: 'Canvas API token is invalid or expired.', code: 'CANVAS_UNAUTHORIZED' });
      }
      if (studentsRes.status === 404) {
        return res.status(404).json({ error: 'Canvas course or students not found.', code: 'CANVAS_NOT_FOUND' });
      }
      if (!studentsRes.ok) {
        return res.status(studentsRes.status).json({ error: `Canvas error: ${studentsRes.statusText}` });
      }

      const pageStudents = await studentsRes.json();
      if (Array.isArray(pageStudents)) {
        students.push(...pageStudents);
      }
      const linkHdr = typeof studentsRes.headers?.get === 'function' ? studentsRes.headers.get('link') : null;
      nextUrl = getNextPageUrl(linkHdr);
    }

    const emailToStudent = new Map();
    const loginToStudent = new Map();
    const nameToStudent = new Map();

    for (const s of (Array.isArray(students) ? students : [])) {
      if (s.email) emailToStudent.set(s.email.toLowerCase().trim(), s);
      if (s.login_id) loginToStudent.set(s.login_id.toLowerCase().trim(), s);
      if (s.name) nameToStudent.set(s.name.toLowerCase().trim(), s);
      if (s.sortable_name) nameToStudent.set(s.sortable_name.toLowerCase().trim(), s);
    }

    // 3. Match records and build grade_data payload
    const grade_data = {};
    const results = [];
    const opts = {
      pointsPresent: typeof req.body?.pointsPresent === 'number' ? req.body.pointsPresent : (req.body?.pointsPresent != null && !isNaN(Number(req.body.pointsPresent)) ? Number(req.body.pointsPresent) : undefined),
      pointsLate: typeof req.body?.pointsLate === 'number' ? req.body.pointsLate : (req.body?.pointsLate != null && !isNaN(Number(req.body.pointsLate)) ? Number(req.body.pointsLate) : undefined),
      pointsAbsent: typeof req.body?.pointsAbsent === 'number' ? req.body.pointsAbsent : (req.body?.pointsAbsent != null && !isNaN(Number(req.body.pointsAbsent)) ? Number(req.body.pointsAbsent) : undefined),
    };

    for (const rec of records) {
      const email = (rec.email || '').toLowerCase().trim();
      const name = (rec.name || '').toLowerCase().trim();
      const username = email.includes('@') ? email.split('@')[0] : '';
      let matchedStudent = null;

      if (rec.canvasUserId) {
        matchedStudent = { id: rec.canvasUserId, name: rec.name || '', email: rec.email || '' };
      } else if (email && emailToStudent.has(email)) {
        matchedStudent = emailToStudent.get(email);
      } else if (email && loginToStudent.has(email)) {
        matchedStudent = loginToStudent.get(email);
      } else if (username && loginToStudent.has(username)) {
        matchedStudent = loginToStudent.get(username);
      } else if (name && nameToStudent.has(name)) {
        matchedStudent = nameToStudent.get(name);
      }

      if (matchedStudent) {
        const grade = calculateAttendanceGrade(rec, maxPoints, opts);
        const statusLabel = rec.status ? (rec.status.charAt(0).toUpperCase() + rec.status.slice(1)) : 'Present';
        const comment = rec.comment || `Google Meet attendance: ${statusLabel} (${grade}/${maxPoints} pts)`;

        grade_data[matchedStudent.id] = {
          posted_grade: String(grade),
          text_comment: comment,
        };
        results.push({
          canvasUserId: matchedStudent.id,
          name: matchedStudent.name || rec.name || '',
          email: matchedStudent.email || rec.email || '',
          grade,
          status: 'synced',
        });
      } else {
        results.push({
          email: rec.email || '',
          name: rec.name || '',
          status: 'unmatched',
          reason: 'Student not found in Canvas course roster',
        });
      }
    }

    const matchedCount = Object.keys(grade_data).length;
    if (matchedCount === 0) {
      return res.status(200).json({
        success: false,
        syncedCount: 0,
        totalCount: records.length,
        courseId,
        assignmentId,
        message: 'No meeting attendees matched students in the Canvas course roster.',
        results,
      });
    }

    // 4. Batch push grades to Canvas REST API
    const pushRes = await fetch(`${instanceUrl}/api/v1/courses/${encodeURIComponent(courseId)}/assignments/${encodeURIComponent(assignmentId)}/submissions/update_grades`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ grade_data }),
    });

    if (!pushRes.ok) {
      const errText = await pushRes.text().catch(() => '');
      log.warn('canvas: push grades error', { status: pushRes.status, body: errText });
      return res.status(pushRes.status).json({ error: `Canvas error while updating grades: ${pushRes.statusText}` });
    }

    const pushData = await pushRes.json().catch(() => ({}));
    log.info('canvas: grades synced successfully', {
      user: req.user.email,
      courseId,
      assignmentId,
      syncedCount: matchedCount,
      totalCount: records.length,
    });

    res.json({
      success: true,
      syncedCount: matchedCount,
      totalCount: records.length,
      courseId,
      assignmentId,
      progress: pushData,
      results,
    });
  } catch (err) {
    log.error('canvas: sync grades failed', { email: req.user.email, courseId, assignmentId, error: err.message });
    res.status(502).json({ error: 'Failed to push grades to Canvas.', code: 'CANVAS_NETWORK_ERROR' });
  }
}

// POST /api/canvas/courses/:courseId/assignments/:assignmentId/sync-grades
router.post('/canvas/courses/:courseId/assignments/:assignmentId/sync-grades', requireAuth, handleCanvasGradeSync);

// POST /api/canvas/sync-grades (flexible signature with parameters in body)
router.post('/canvas/sync-grades', requireAuth, handleCanvasGradeSync);

module.exports = router;
