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
});

