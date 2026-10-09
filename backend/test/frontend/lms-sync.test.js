/** @jest-environment jsdom */
// Frontend tests for js/lms-sync.js (AttLmsSync modal & client controller).
const path = require('path');

describe('AttLmsSync', () => {
  let AttLmsSync;
  const originalFetch = global.fetch;

  beforeEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/classroom/courses') || u.includes('/canvas/courses')) {
        return { ok: true, status: 200, json: async () => ({ courses: [] }) };
      }
      if (u.includes('/canvas/settings')) {
        return { ok: true, status: 200, json: async () => ({ canvasConfigured: true, canvasInstanceUrl: 'https://canvas.test' }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    });
    global.t = (key, fallback) => fallback || key;
    global.toast = jest.fn();
    delete require.cache[require.resolve('../../../js/lms-sync.js')];
    AttLmsSync = require('../../../js/lms-sync.js');
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  test('creates modal DOM elements on openModal', () => {
    expect(document.getElementById('lms-sync-modal')).toBeNull();

    AttLmsSync.openModal({
      meetingTitle: 'History 201',
      meetingDate: '2026-10-04',
      records: [
        { name: 'Alice', email: 'alice@school.edu', status: 'present' },
        { name: 'Bob', email: 'bob@school.edu', status: 'late' },
        { name: 'Charlie', email: 'charlie@school.edu', status: 'absent' },
      ],
      getAuthToken: () => 'test-token',
      getBackendUrl: () => 'https://test.api',
    });

    const modal = document.getElementById('lms-sync-modal');
    expect(modal).not.toBeNull();
    expect(modal.style.display).toBe('flex');

    const sum = document.getElementById('lms-sync-summary-text');
    expect(sum.textContent).toContain('3 students ready to sync (1 present, 1 late, 1 absent)');

    const titleInput = document.getElementById('lms-classroom-new-title');
    expect(titleInput.value).toBe('History 201 Attendance (2026-10-04)');
  });

  test('switches tabs between classroom and canvas', () => {
    AttLmsSync.openModal({ records: [] });

    AttLmsSync.setTab('canvas');
    expect(document.getElementById('lms-panel-canvas').style.display).toBe('block');
    expect(document.getElementById('lms-panel-classroom').style.display).toBe('none');

    AttLmsSync.setTab('classroom');
    expect(document.getElementById('lms-panel-classroom').style.display).toBe('block');
    expect(document.getElementById('lms-panel-canvas').style.display).toBe('none');
  });

  test('closeModal hides the modal element', () => {
    AttLmsSync.openModal({ records: [] });
    expect(document.getElementById('lms-sync-modal').style.display).toBe('flex');

    AttLmsSync.closeModal();
    expect(document.getElementById('lms-sync-modal').style.display).toBe('none');
  });

  test('pushes grades to Classroom successfully', async () => {
    const onComplete = jest.fn();
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/classroom/sync-grades')) {
        return { ok: true, status: 200, json: async () => ({ success: true, syncedCount: 2 }) };
      }
      return { ok: true, status: 200, json: async () => ({ courses: [] }) };
    });

    AttLmsSync.openModal({
      records: [
        { name: 'Alice', email: 'alice@school.edu', status: 'present' },
        { name: 'Bob', email: 'bob@school.edu', status: 'late' },
      ],
      getAuthToken: () => 'tok',
      getBackendUrl: () => 'https://api.test',
      onSyncComplete: onComplete,
    });

    // Set course selection
    const courseSel = document.getElementById('lms-classroom-course-select');
    courseSel.innerHTML = '<option value="course-123" selected>Bio 101</option>';
    courseSel.value = 'course-123';

    await AttLmsSync.pushGrades();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/classroom/sync-grades',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer tok',
          'Content-Type': 'application/json',
        }),
      })
    );

    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ syncedCount: 2 }));
    const statusBox = document.getElementById('lms-sync-status-box');
    expect(statusBox.textContent).toContain('2 students');
  });

  test('pushes grades to Canvas successfully', async () => {
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/canvas/sync-grades')) {
        return { ok: true, status: 200, json: async () => ({ success: true, syncedCount: 1 }) };
      }
      if (u.includes('/canvas/settings')) {
        return { ok: true, status: 200, json: async () => ({ canvasConfigured: true, canvasInstanceUrl: 'https://canvas.instructure.com' }) };
      }
      return { ok: true, status: 200, json: async () => ({ courses: [] }) };
    });

    AttLmsSync.openModal({
      tab: 'canvas',
      records: [{ name: 'Alice', email: 'alice@school.edu', status: 'present' }],
      getAuthToken: () => 'tok',
      getBackendUrl: () => 'https://api.test',
    });

    AttLmsSync.setTab('canvas');
    const urlInput = document.getElementById('lms-canvas-url');
    urlInput.value = 'https://canvas.instructure.com';
    const courseSel = document.getElementById('lms-canvas-course-select');
    courseSel.innerHTML = '<option value="canvas-c1" selected>Math</option>';
    courseSel.value = 'canvas-c1';

    await AttLmsSync.pushGrades();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.test/canvas/sync-grades',
      expect.objectContaining({
        method: 'POST',
      })
    );

    const statusBox = document.getElementById('lms-sync-status-box');
    expect(statusBox.textContent).toContain('1 students');
  });

  test('displays error toast when grade push fails', async () => {
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/classroom/sync-grades')) {
        return { ok: false, status: 500, json: async () => ({ error: 'Classroom API quota exceeded' }) };
      }
      return { ok: true, status: 200, json: async () => ({ courses: [] }) };
    });

    AttLmsSync.openModal({
      records: [{ name: 'Alice', email: 'alice@school.edu', status: 'present' }],
      getAuthToken: () => 'tok',
      getBackendUrl: () => 'https://api.test',
    });

    const courseSel = document.getElementById('lms-classroom-course-select');
    courseSel.innerHTML = '<option value="c1" selected>Bio</option>';
    courseSel.value = 'c1';

    await AttLmsSync.pushGrades();

    const statusBox = document.getElementById('lms-sync-status-box');
    expect(statusBox.textContent).toContain('Classroom API quota exceeded');
  });

  test('displays partial sync message when some attendees are unmatched', async () => {
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/classroom/sync-grades')) {
        return { ok: true, status: 200, json: async () => ({ success: true, syncedCount: 2, totalCount: 5 }) };
      }
      return { ok: true, status: 200, json: async () => ({ courses: [] }) };
    });

    AttLmsSync.openModal({
      records: [
        { name: 'Alice', email: 'alice@school.edu', status: 'present' },
        { name: 'Bob', email: 'bob@school.edu', status: 'present' },
        { name: 'Charlie', email: 'charlie@school.edu', status: 'present' },
        { name: 'David', email: 'david@school.edu', status: 'present' },
        { name: 'Eve', email: 'eve@school.edu', status: 'present' },
      ],
      getAuthToken: () => 'tok',
      getBackendUrl: () => 'https://api.test',
    });

    const courseSel = document.getElementById('lms-classroom-course-select');
    courseSel.innerHTML = '<option value="c1" selected>Bio</option>';
    courseSel.value = 'c1';

    await AttLmsSync.pushGrades();

    const statusBox = document.getElementById('lms-sync-status-box');
    expect(statusBox.textContent).toContain('Synced 2 of 5 students (3 unmatched)');
  });

  test('surfaces permissions box if coursework endpoint returns scopeMissing', async () => {
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/courseWork')) {
        return { ok: false, status: 403, json: async () => ({ error: 'classroom_scope_missing', scopeMissing: true }) };
      }
      return { ok: true, status: 200, json: async () => ({ courses: [{ id: 'c1', name: 'Bio' }] }) };
    });

    AttLmsSync.openModal({ records: [] });
    const courseSel = document.getElementById('lms-classroom-course-select');
    courseSel.innerHTML = '<option value="c1" selected>Bio</option>';
    courseSel.value = 'c1';

    await AttLmsSync.onClassroomCourseChanged();

    const authBox = document.getElementById('lms-classroom-auth-box');
    expect(authBox.style.display).toBe('block');
    expect(document.getElementById('lms-classroom-auth-msg').textContent).toContain('Classroom write permission required');
  });

  test('calls root.applyTranslations on openModal if present', () => {
    const applyTranslations = jest.fn();
    global.applyTranslations = applyTranslations;
    AttLmsSync.openModal({ records: [] });
    expect(applyTranslations).toHaveBeenCalled();
    delete global.applyTranslations;
  });

  test('falls back to root.state and global constants for backend URL and session token', async () => {
    global.state = { backendUrl: 'https://state.test', sessionToken: 'state-tok' };
    AttLmsSync.openModal({
      records: [{ name: 'Test', email: 'test@school.edu', status: 'present' }],
      getAuthToken: null,
      getBackendUrl: null,
    });

    const courseSel = document.getElementById('lms-classroom-course-select');
    courseSel.innerHTML = '<option value="c-state" selected>State Course</option>';
    courseSel.value = 'c-state';

    await AttLmsSync.pushGrades();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://state.test/classroom/sync-grades',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer state-tok' }),
      })
    );
    delete global.state;

    // Test root.BACKEND_URL and root.sessionToken fallback
    global.BACKEND_URL = 'https://global.test';
    global.sessionToken = 'global-tok';
    AttLmsSync.openModal({
      records: [{ name: 'Test 2', email: 'test2@school.edu', status: 'present' }],
      getAuthToken: null,
      getBackendUrl: null,
    });
    const courseSel2 = document.getElementById('lms-classroom-course-select');
    courseSel2.innerHTML = '<option value="c-global" selected>Global Course</option>';
    courseSel2.value = 'c-global';
    await AttLmsSync.pushGrades();
    expect(global.fetch).toHaveBeenCalledWith(
      'https://global.test/classroom/sync-grades',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer global-tok' }),
      })
    );
    delete global.BACKEND_URL;
    delete global.sessionToken;
  });

  test('handles 401 AUTH_EXPIRED when loading classroom courses', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ code: 'AUTH_EXPIRED' }),
    }));
    AttLmsSync.openModal({ records: [] });
    await AttLmsSync.loadClassroomCourses();
    const msg = document.getElementById('lms-classroom-auth-msg');
    expect(msg.textContent).toContain('Sign in with Google first');
    const sel = document.getElementById('lms-classroom-course-select');
    expect(sel.innerHTML).toContain('(Session expired)');
  });

  test('handles 403 or scopeMissing when loading classroom courses', async () => {
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      json: async () => ({ scopeMissing: true }),
    }));
    AttLmsSync.openModal({ records: [] });
    await AttLmsSync.loadClassroomCourses();
    const msg = document.getElementById('lms-classroom-auth-msg');
    expect(msg.textContent).toContain('Classroom write permission required');
    const sel = document.getElementById('lms-classroom-course-select');
    expect(sel.innerHTML).toContain('(Permission required)');
  });

  test('handles network failure when loading classroom courses', async () => {
    global.fetch = jest.fn(async () => {
      throw new Error('Network failure');
    });
    AttLmsSync.openModal({ records: [] });
    await AttLmsSync.loadClassroomCourses();
    const statusBox = document.getElementById('lms-sync-status-box');
    expect(statusBox.textContent).toContain('Failed to load courses: Network failure');
  });

  test('handles empty classroom courses response', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ courses: [] }),
    }));
    AttLmsSync.openModal({ records: [] });
    await AttLmsSync.loadClassroomCourses();
    const sel = document.getElementById('lms-classroom-course-select');
    expect(sel.innerHTML).toContain('No courses found');
  });

  test('renders courses with sections and auto-triggers onClassroomCourseChanged', async () => {
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/courseWork')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            courseWork: [{ id: 'cw-1', title: 'HW 1', maxPoints: 75 }],
          }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          courses: [{ id: 'c-101', name: 'Physics 101', section: 'Sec 2' }],
        }),
      };
    });

    AttLmsSync.openModal({ records: [] });
    await AttLmsSync.loadClassroomCourses();

    const courseSel = document.getElementById('lms-classroom-course-select');
    expect(courseSel.innerHTML).toContain('Physics 101 (Sec 2)');

    const assignSel = document.getElementById('lms-classroom-assignment-select');
    expect(assignSel.innerHTML).toContain('HW 1 (75 pts)');

    // Select existing assignment and check maxPoints updates
    assignSel.value = 'cw-1';
    AttLmsSync.onClassroomAssignmentChanged();
    expect(document.getElementById('lms-classroom-max-points').value).toBe('75');
    expect(document.getElementById('lms-classroom-new-fields').style.display).toBe('none');

    // Switch back to __new__
    assignSel.value = '__new__';
    AttLmsSync.onClassroomAssignmentChanged();
    expect(document.getElementById('lms-classroom-new-fields').style.display).toBe('block');
  });

  test('handles network failure and error status in onClassroomCourseChanged', async () => {
    AttLmsSync.openModal({ records: [] });
    const courseSel = document.getElementById('lms-classroom-course-select');
    courseSel.innerHTML = '<option value="c-err" selected>Err Course</option>';
    courseSel.value = 'c-err';

    // Non-ok response
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Classroom server down' }),
    }));
    await AttLmsSync.onClassroomCourseChanged();
    expect(document.getElementById('lms-sync-status-box').textContent).toContain('Classroom server down');

    // Network throws
    global.fetch = jest.fn(async () => {
      throw new Error('Coursework socket error');
    });
    await AttLmsSync.onClassroomCourseChanged();
    expect(document.getElementById('lms-sync-status-box').textContent).toContain('Coursework socket error');

    // Course select has no value
    courseSel.value = '';
    await AttLmsSync.onClassroomCourseChanged();
  });

  test('requestClassroomConsent invokes signInWithGoogle or alerts', () => {
    global.signInWithGoogle = jest.fn();
    AttLmsSync.requestClassroomConsent();
    expect(global.signInWithGoogle).toHaveBeenCalledWith(expect.stringContaining('classroom.coursework.students'));
    delete global.signInWithGoogle;

    const origAlert = window.alert;
    window.alert = jest.fn();
    AttLmsSync.requestClassroomConsent();
    expect(window.alert).toHaveBeenCalled();
    window.alert = origAlert;
  });

  test('loadCanvasSettingsAndCourses populates instance URL and auto-loads courses if configured', async () => {
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      if (u.includes('/canvas/settings')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ configured: true, instanceUrl: 'https://myschool.instructure.com' }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          courses: [{ id: 'can-1', name: 'Art History', courseCode: 'ART101' }],
        }),
      };
    });

    AttLmsSync.openModal({ tab: 'canvas', records: [] });
    await AttLmsSync.loadCanvasSettingsAndCourses();

    expect(document.getElementById('lms-canvas-url').value).toBe('https://myschool.instructure.com');
    const courseSel = document.getElementById('lms-canvas-course-select');
    expect(courseSel.innerHTML).toContain('Art History (ART101)');
  });

  test('loadCanvasCourses handles errors, empty list, and network failures', async () => {
    AttLmsSync.openModal({ tab: 'canvas', records: [] });

    // Non-ok response
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Invalid Canvas API key' }),
    }));
    await AttLmsSync.loadCanvasCourses();
    expect(document.getElementById('lms-sync-status-box').textContent).toContain('Invalid Canvas API key');

    // Empty courses
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ courses: [] }),
    }));
    await AttLmsSync.loadCanvasCourses();
    expect(document.getElementById('lms-canvas-course-select').innerHTML).toContain('No courses found');

    // Throws exception
    global.fetch = jest.fn(async () => {
      throw new Error('Connection refused');
    });
    await AttLmsSync.loadCanvasCourses();
    expect(document.getElementById('lms-sync-status-box').textContent).toContain('Canvas connection error: Connection refused');
  });

  test('onCanvasCourseChanged and onCanvasAssignmentChanged handle errors and selection toggling', async () => {
    AttLmsSync.openModal({ tab: 'canvas', records: [] });
    const courseSel = document.getElementById('lms-canvas-course-select');
    courseSel.innerHTML = '<option value="can-10" selected>Calculus</option>';
    courseSel.value = 'can-10';

    // Successful assignments load
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        assignments: [{ id: 'assign-1', name: 'Quiz 1', pointsPossible: 20 }],
      }),
    }));
    await AttLmsSync.onCanvasCourseChanged();

    const assignSel = document.getElementById('lms-canvas-assignment-select');
    expect(assignSel.innerHTML).toContain('Quiz 1 (20 pts)');

    // Select existing quiz
    assignSel.value = 'assign-1';
    AttLmsSync.onCanvasAssignmentChanged();
    expect(document.getElementById('lms-canvas-max-points').value).toBe('20');
    expect(document.getElementById('lms-canvas-new-fields').style.display).toBe('none');

    // Switch back to __new__
    assignSel.value = '__new__';
    AttLmsSync.onCanvasAssignmentChanged();
    expect(document.getElementById('lms-canvas-new-fields').style.display).toBe('block');

    // Error response
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Assignments not found' }),
    }));
    await AttLmsSync.onCanvasCourseChanged();
    expect(document.getElementById('lms-sync-status-box').textContent).toContain('Assignments not found');

    // Network error
    global.fetch = jest.fn(async () => {
      throw new Error('Network timeout');
    });
    await AttLmsSync.onCanvasCourseChanged();
    expect(document.getElementById('lms-sync-status-box').textContent).toContain('Failed to load Canvas assignments: Network timeout');

    // No course value returns early
    courseSel.value = '';
    await AttLmsSync.onCanvasCourseChanged();
  });

  test('pushGrades validation and edge cases', async () => {
    // 1. Empty records
    AttLmsSync.openModal({ records: [] });
    await AttLmsSync.pushGrades();
    expect(document.getElementById('lms-sync-status-box').textContent).toContain('No meeting attendees available to sync');

    // 2. Classroom: missing course selection
    AttLmsSync.openModal({
      records: [{ name: 'Alice', email: 'alice@school.edu', status: 'present' }],
    });
    const classroomSel = document.getElementById('lms-classroom-course-select');
    classroomSel.value = '';
    await AttLmsSync.pushGrades();
    expect(document.getElementById('lms-sync-status-box').textContent).toContain('Please select a Classroom course');

    // 3. Classroom: syncedCount === 0 warning
    classroomSel.innerHTML = '<option value="c-1" selected>C1</option>';
    classroomSel.value = 'c-1';
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ syncedCount: 0, message: 'No email matches found' }),
    }));
    await AttLmsSync.pushGrades();
    expect(document.getElementById('lms-sync-status-box').textContent).toContain('No email matches found');

    // 4. Canvas: missing course selection
    AttLmsSync.openModal({
      tab: 'canvas',
      records: [{ name: 'Alice', email: 'alice@school.edu', status: 'present' }],
    });
    const canvasSel = document.getElementById('lms-canvas-course-select');
    canvasSel.value = '';
    await AttLmsSync.pushGrades();
    expect(document.getElementById('lms-sync-status-box').textContent).toContain('Please select a Canvas course');

    // 5. Canvas: syncedCount === 0 warning
    canvasSel.innerHTML = '<option value="can-1" selected>Can1</option>';
    canvasSel.value = 'can-1';
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ syncedCount: 0, message: 'No Canvas enrollment match' }),
    }));
    await AttLmsSync.pushGrades();
    expect(document.getElementById('lms-sync-status-box').textContent).toContain('No Canvas enrollment match');

    // 6. Canvas: partial match (unmatchedCount > 0)
    const onComplete = jest.fn();
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, syncedCount: 1, totalCount: 3 }),
    }));
    AttLmsSync.openModal({
      tab: 'canvas',
      records: () => [{ name: 'A', email: 'a@x.com', status: 'present' }],
      getRecords: () => [
        { name: 'A', email: 'a@x.com', status: 'present' },
        { name: 'B', email: 'b@x.com', status: 'present' },
        { name: 'C', email: 'c@x.com', status: 'present' },
      ],
      onSyncComplete: onComplete,
    });
    const canvasSel2 = document.getElementById('lms-canvas-course-select');
    canvasSel2.innerHTML = '<option value="can-2" selected>Can2</option>';
    canvasSel2.value = 'can-2';
    await AttLmsSync.pushGrades();
    expect(document.getElementById('lms-sync-status-box').textContent).toContain('Synced 1 of 3 students (2 unmatched)');
    expect(onComplete).toHaveBeenCalled();
  });

  test('covers all fallback and edge branches in lms-sync', async () => {
    // 1. root.t is not a function or returns key
    const origT = global.t;
    delete global.t;
    AttLmsSync.openModal(); // exercises (context.records || []), esc(undefined), t fallback
    expect(document.getElementById('lms-sync-summary-text').textContent).toContain('0 students ready to sync');

    global.t = (k) => k; // returns key
    AttLmsSync.openModal({
      records: [
        { name: 'NoStatus' }, // status undefined -> status || 'present'
        { name: 'Late', status: 'late' },
        { name: 'Absent', status: 'absent' },
      ],
    });
    global.t = origT;

    // 2. loadClassroomCourses when select is missing from DOM
    const classroomSel = document.getElementById('lms-classroom-course-select');
    classroomSel.remove();
    await AttLmsSync.loadClassroomCourses();

    // Remove old modal and re-create fresh modal
    document.getElementById('lms-sync-modal').remove();
    AttLmsSync.openModal({ records: [] });

    // 3. loadClassroomCourses data.courses is undefined
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    await AttLmsSync.loadClassroomCourses();

    // 4. onClassroomCourseChanged data.error is missing, and courseWork items without maxPoints
    const sel = document.getElementById('lms-classroom-course-select');
    sel.innerHTML = '<option value="c-1" selected>C1</option>';
    sel.value = 'c-1';
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    }));
    await AttLmsSync.onClassroomCourseChanged();

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        courseWork: [{ id: 'cw-nomax', title: 'HW' }], // maxPoints undefined
      }),
    }));
    await AttLmsSync.onClassroomCourseChanged();

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}), // courseWork undefined
    }));
    await AttLmsSync.onClassroomCourseChanged();

    // Test null records fallback in pushGrades
    AttLmsSync.openModal({ getRecords: null, records: null });
    await AttLmsSync.pushGrades();

    // 5. loadCanvasSettingsAndCourses catch block
    global.fetch = jest.fn(async () => {
      throw new Error('Settings net err');
    });
    await AttLmsSync.loadCanvasSettingsAndCourses();

    // 6. loadCanvasCourses with token, data.error missing, course without courseCode, courses undefined
    AttLmsSync.openModal({ tab: 'canvas', records: [] });
    const tokenInput = document.getElementById('lms-canvas-token');
    tokenInput.value = 'my-token';
    const urlInput = document.getElementById('lms-canvas-url');
    urlInput.value = 'https://canvas.test';

    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({}), // no error field
    }));
    await AttLmsSync.loadCanvasCourses();

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        courses: [{ id: 'can-nocode', name: 'Art' }], // no courseCode
      }),
    }));
    await AttLmsSync.loadCanvasCourses();

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}), // no courses field
    }));
    await AttLmsSync.loadCanvasCourses();

    // 7. onCanvasCourseChanged with tokenInput value, assignments without pointsPossible, error without error field
    const canvasCourseSel = document.getElementById('lms-canvas-course-select');
    canvasCourseSel.innerHTML = '<option value="can-1" selected>C1</option>';
    canvasCourseSel.value = 'can-1';

    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}), // no error field
    }));
    await AttLmsSync.onCanvasCourseChanged();

    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        assignments: [{ id: 'a-nopoints', name: 'Essay' }], // no pointsPossible
      }),
    }));
    await AttLmsSync.onCanvasCourseChanged();

    // 8. pushGrades classroom: existing assignment, blank title & invalid points, failure without error field, 0 matched without message
    AttLmsSync.openModal({
      records: [{ name: 'Stu', email: 'stu@test.com', status: 'present' }],
    });
    const cSel = document.getElementById('lms-classroom-course-select');
    cSel.innerHTML = '<option value="c-1" selected>C1</option>';
    cSel.value = 'c-1';
    const cAssignSel = document.getElementById('lms-classroom-assignment-select');
    cAssignSel.innerHTML = '<option value="cw-existing" selected>CW</option>';
    cAssignSel.value = 'cw-existing';
    document.getElementById('lms-classroom-new-title').value = '   '; // empty title
    document.getElementById('lms-classroom-max-points').value = 'not-a-number'; // invalid points

    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}), // no error field
    }));
    await AttLmsSync.pushGrades();
    expect(document.getElementById('lms-sync-status-box').textContent).toContain('Classroom sync failed');

    cSel.innerHTML = '<option value="c-1" selected>C1</option>';
    cSel.value = 'c-1';
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ syncedCount: 0 }), // no message field
    }));
    await AttLmsSync.pushGrades();
    expect(document.getElementById('lms-sync-status-box').textContent).toContain('No students matched the course roster');

    // 9. pushGrades canvas: blank title & invalid points, failure without error field, 0 matched without message
    AttLmsSync.openModal({
      tab: 'canvas',
      records: [{ name: 'Stu', email: 'stu@test.com', status: 'present' }],
    });
    const canSel = document.getElementById('lms-canvas-course-select');
    canSel.innerHTML = '<option value="can-1" selected>Can1</option>';
    canSel.value = 'can-1';
    document.getElementById('lms-canvas-new-title').value = '';
    document.getElementById('lms-canvas-max-points').value = '';

    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({}), // no error field
    }));
    await AttLmsSync.pushGrades();
    expect(document.getElementById('lms-sync-status-box').textContent).toContain('Canvas sync failed');

    canSel.innerHTML = '<option value="can-1" selected>Can1</option>';
    canSel.value = 'can-1';
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ syncedCount: 0 }), // no message field
    }));
    await AttLmsSync.pushGrades();
    expect(document.getElementById('lms-sync-status-box').textContent).toContain('No meeting attendees matched students');
  });

  test('pushGrades reports to root.captureError if available on error', async () => {
    global.captureError = jest.fn();
    AttLmsSync.openModal({
      records: [{ name: 'Test', email: 't@test.com', status: 'present' }],
    });
    const cSel = document.getElementById('lms-classroom-course-select');
    cSel.innerHTML = '<option value="c-err" selected>C-Err</option>';
    cSel.value = 'c-err';
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Sync broke down' }),
    }));
    await AttLmsSync.pushGrades();
    expect(global.captureError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ where: 'lms_sync_pushGrades', tab: 'classroom' })
    );
    delete global.captureError;
  });

  test('pushGrades handles 402 lmsSync for Classroom by calling showUpgradeModal and closing modal', async () => {
    global.showUpgradeModal = jest.fn();
    AttLmsSync.openModal({
      records: [{ name: 'Test', email: 't@test.com', status: 'present' }],
    });
    const cSel = document.getElementById('lms-classroom-course-select');
    cSel.innerHTML = '<option value="c-402" selected>C-402</option>';
    cSel.value = 'c-402';

    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 402,
      json: async () => ({ error: 'Pro required', feature: 'lmsSync' }),
    }));

    await AttLmsSync.pushGrades();
    expect(global.showUpgradeModal).toHaveBeenCalledWith('lmsSync');
    expect(document.getElementById('lms-sync-modal').style.display).toBe('none');

    // Without showUpgradeModal function
    delete global.showUpgradeModal;
    AttLmsSync.openModal({
      records: [{ name: 'Test', email: 't@test.com', status: 'present' }],
    });
    const cSel2 = document.getElementById('lms-classroom-course-select');
    cSel2.innerHTML = '<option value="c-402" selected>C-402</option>';
    cSel2.value = 'c-402';
    await AttLmsSync.pushGrades();
    expect(document.getElementById('lms-sync-modal').style.display).toBe('none');
  });

  test('pushGrades handles 402 lmsSync for Canvas by calling showUpgradeModal and closing modal', async () => {
    global.showUpgradeModal = jest.fn();
    AttLmsSync.openModal({
      tab: 'canvas',
      records: [{ name: 'Test', email: 't@test.com', status: 'present' }],
    });
    const canSel = document.getElementById('lms-canvas-course-select');
    canSel.innerHTML = '<option value="can-402" selected>Can-402</option>';
    canSel.value = 'can-402';

    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 402,
      json: async () => ({ error: 'Pro required', feature: 'lmsSync' }),
    }));

    await AttLmsSync.pushGrades();
    expect(global.showUpgradeModal).toHaveBeenCalledWith('lmsSync');
    expect(document.getElementById('lms-sync-modal').style.display).toBe('none');

    // Without showUpgradeModal function
    delete global.showUpgradeModal;
    AttLmsSync.openModal({
      tab: 'canvas',
      records: [{ name: 'Test', email: 't@test.com', status: 'present' }],
    });
    const canSel2 = document.getElementById('lms-canvas-course-select');
    canSel2.innerHTML = '<option value="can-402" selected>Can-402</option>';
    canSel2.value = 'can-402';
    await AttLmsSync.pushGrades();
    expect(document.getElementById('lms-sync-modal').style.display).toBe('none');
  });
});



