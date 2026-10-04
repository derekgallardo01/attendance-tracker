// Direct Google Classroom & Canvas LMS Grade Sync — frontend controller & modal.
// Provides a 1-click grade writeback directly into Google Classroom coursework
// and Canvas LMS assignments. Matches students by email, calculates attendance points,
// and submits grades with live status toasts.
(function (root) {
  'use strict';

  let _activeContext = null;
  let _activeTab = 'classroom'; // 'classroom' | 'canvas'
  let _classroomCourses = [];
  let _canvasCourses = [];

  function t(key, fallback) {
    if (typeof root.t === 'function') {
      const val = root.t(key);
      if (val && val !== key) return val;
    }
    return fallback;
  }

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function ensureModalElement() {
    let modal = document.getElementById('lms-sync-modal');
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'lms-sync-modal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;align-items:flex-start;justify-content:center;padding:24px 16px;overflow-y:auto;box-sizing:border-box;backdrop-filter:blur(4px);';
    modal.innerHTML = `
      <div style="background:#161b22;border:1px solid #30363d;border-radius:12px;padding:22px;max-width:480px;width:100%;margin-top:24px;box-shadow:0 24px 54px rgba(0,0,0,.6);color:#e6edf3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
        <!-- Header -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;border-bottom:1px solid #21262d;padding-bottom:12px">
          <div style="display:flex;align-items:center;gap:8px">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><polyline points="10 9 12 11 16 7"/></svg>
            <span style="font-size:1.05rem;font-weight:600;color:#f0f6fc" data-i18n="lms.modalTitle">${esc(t('lms.modalTitle', 'Sync Grades to LMS'))}</span>
          </div>
          <button type="button" onclick="AttLmsSync.closeModal()" data-i18n-aria="common.close" aria-label="Close" style="background:none;border:none;color:#8b949e;cursor:pointer;font-size:20px;line-height:1;padding:4px 8px;border-radius:6px">&times;</button>
        </div>

        <!-- Provider Switcher -->
        <div style="display:flex;background:#0d1117;padding:3px;border-radius:8px;border:1px solid #30363d;margin-bottom:16px;gap:4px">
          <button type="button" id="lms-tab-btn-classroom" onclick="AttLmsSync.setTab('classroom')" style="flex:1;background:#21262d;color:#58a6ff;border:none;padding:7px 12px;font-size:.82rem;font-weight:600;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .15s ease">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
            <span data-i18n="lms.providerClassroom">${esc(t('lms.providerClassroom', 'Google Classroom'))}</span>
          </button>
          <button type="button" id="lms-tab-btn-canvas" onclick="AttLmsSync.setTab('canvas')" style="flex:1;background:transparent;color:#8b949e;border:none;padding:7px 12px;font-size:.82rem;font-weight:600;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:all .15s ease">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>
            <span data-i18n="lms.providerCanvas">${esc(t('lms.providerCanvas', 'Canvas LMS'))}</span>
          </button>
        </div>

        <!-- Google Classroom Section -->
        <div id="lms-panel-classroom" style="display:block">
          <div id="lms-classroom-auth-box" style="display:none;background:rgba(234,179,8,.1);border:1px solid rgba(234,179,8,.3);padding:10px 14px;border-radius:8px;font-size:.82rem;color:#facc15;margin-bottom:14px">
            <span id="lms-classroom-auth-msg" data-i18n="lms.needSignIn">${esc(t('lms.needSignIn', 'Sign in with Google to sync to Google Classroom.'))}</span>
            <div style="margin-top:8px">
              <button type="button" id="lms-classroom-auth-btn" onclick="AttLmsSync.requestClassroomConsent()" style="background:#facc15;color:#0d1117;font-weight:600;font-size:.78rem;border:none;padding:5px 12px;border-radius:6px;cursor:pointer">Grant Permission</button>
            </div>
          </div>

          <div style="margin-bottom:12px">
            <label style="display:block;font-size:.75rem;font-weight:600;color:#8b949e;margin-bottom:6px" data-i18n="lms.selectCourse">${esc(t('lms.selectCourse', 'Select Course'))}</label>
            <div style="display:flex;gap:6px">
              <select id="lms-classroom-course-select" onchange="AttLmsSync.onClassroomCourseChanged()" style="flex:1;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:.85rem;padding:7px 10px;outline:none">
                <option value="" data-i18n="lms.loadingCourses">${esc(t('lms.loadingCourses', 'Loading courses…'))}</option>
              </select>
              <button type="button" onclick="AttLmsSync.loadClassroomCourses()" title="Refresh Courses" style="background:#21262d;border:1px solid #30363d;color:#c9d1d9;padding:0 10px;border-radius:6px;cursor:pointer">↻</button>
            </div>
          </div>

          <div style="margin-bottom:12px">
            <label style="display:block;font-size:.75rem;font-weight:600;color:#8b949e;margin-bottom:6px" data-i18n="lms.selectAssignment">${esc(t('lms.selectAssignment', 'Select Assignment'))}</label>
            <select id="lms-classroom-assignment-select" onchange="AttLmsSync.onClassroomAssignmentChanged()" style="width:100%;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:.85rem;padding:7px 10px;outline:none">
              <option value="__new__" data-i18n="lms.createNewAssignment">${esc(t('lms.createNewAssignment', '+ Create new assignment'))}</option>
            </select>
          </div>

          <div id="lms-classroom-new-fields" style="display:block;margin-bottom:12px;background:#0d1117;border:1px solid #21262d;border-radius:8px;padding:10px">
            <div style="margin-bottom:8px">
              <label style="display:block;font-size:.72rem;color:#8b949e;margin-bottom:4px" data-i18n="lms.assignmentTitle">${esc(t('lms.assignmentTitle', 'Assignment Title'))}</label>
              <input type="text" id="lms-classroom-new-title" data-i18n-placeholder="lms.assignmentTitlePlaceholder" style="width:100%;box-sizing:border-box;background:#161b22;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:.82rem;padding:6px 10px;outline:none" placeholder="${esc(t('lms.assignmentTitlePlaceholder', 'e.g. Attendance - {date}'))}" />
            </div>
            <div>
              <label style="display:block;font-size:.72rem;color:#8b949e;margin-bottom:4px" data-i18n="lms.maxPoints">${esc(t('lms.maxPoints', 'Points / Max Grade'))}</label>
              <input type="number" id="lms-classroom-max-points" value="100" min="1" max="1000" style="width:100px;background:#161b22;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:.82rem;padding:6px 10px;outline:none" />
            </div>
          </div>
        </div>

        <!-- Canvas LMS Section -->
        <div id="lms-panel-canvas" style="display:none">
          <div style="margin-bottom:10px">
            <label style="display:block;font-size:.75rem;font-weight:600;color:#8b949e;margin-bottom:4px" data-i18n="lms.canvasInstanceUrl">${esc(t('lms.canvasInstanceUrl', 'Canvas Instance URL'))}</label>
            <input type="text" id="lms-canvas-url" data-i18n-placeholder="lms.canvasInstancePlaceholder" placeholder="${esc(t('lms.canvasInstancePlaceholder', 'https://canvas.instructure.com'))}" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:.85rem;padding:7px 10px;outline:none" />
          </div>

          <div style="margin-bottom:10px">
            <label style="display:block;font-size:.75rem;font-weight:600;color:#8b949e;margin-bottom:4px" data-i18n="lms.canvasToken">${esc(t('lms.canvasToken', 'Canvas Access Token'))}</label>
            <input type="password" id="lms-canvas-token" data-i18n-placeholder="lms.canvasTokenPlaceholder" placeholder="${esc(t('lms.canvasTokenPlaceholder', 'Paste your Canvas API token'))}" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:.85rem;padding:7px 10px;outline:none" />
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
            <label style="font-size:.75rem;color:#8b949e;display:flex;align-items:center;gap:6px;cursor:pointer">
              <input type="checkbox" id="lms-canvas-save" checked />
              <span data-i18n="lms.saveCanvasCredentials">${esc(t('lms.saveCanvasCredentials', 'Save Canvas credentials for future syncs'))}</span>
            </label>
            <button type="button" onclick="AttLmsSync.loadCanvasCourses()" style="background:#21262d;border:1px solid #30363d;color:#58a6ff;font-size:.76rem;font-weight:600;padding:5px 10px;border-radius:6px;cursor:pointer" data-i18n="lms.connectAndLoad">${esc(t('lms.connectAndLoad', 'Connect & Load Courses'))}</button>
          </div>

          <div style="margin-bottom:12px">
            <label style="display:block;font-size:.75rem;font-weight:600;color:#8b949e;margin-bottom:6px" data-i18n="lms.selectCourse">${esc(t('lms.selectCourse', 'Select Course'))}</label>
            <select id="lms-canvas-course-select" onchange="AttLmsSync.onCanvasCourseChanged()" style="width:100%;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:.85rem;padding:7px 10px;outline:none">
              <option value="">—</option>
            </select>
          </div>

          <div style="margin-bottom:12px">
            <label style="display:block;font-size:.75rem;font-weight:600;color:#8b949e;margin-bottom:6px" data-i18n="lms.selectAssignment">${esc(t('lms.selectAssignment', 'Select Assignment'))}</label>
            <select id="lms-canvas-assignment-select" onchange="AttLmsSync.onCanvasAssignmentChanged()" style="width:100%;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:.85rem;padding:7px 10px;outline:none">
              <option value="__new__" data-i18n="lms.createNewAssignment">${esc(t('lms.createNewAssignment', '+ Create new assignment'))}</option>
            </select>
          </div>

          <div id="lms-canvas-new-fields" style="display:block;margin-bottom:12px;background:#0d1117;border:1px solid #21262d;border-radius:8px;padding:10px">
            <div style="margin-bottom:8px">
              <label style="display:block;font-size:.72rem;color:#8b949e;margin-bottom:4px" data-i18n="lms.assignmentTitle">${esc(t('lms.assignmentTitle', 'Assignment Title'))}</label>
              <input type="text" id="lms-canvas-new-title" data-i18n-placeholder="lms.assignmentTitlePlaceholder" style="width:100%;box-sizing:border-box;background:#161b22;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:.82rem;padding:6px 10px;outline:none" placeholder="${esc(t('lms.assignmentTitlePlaceholder', 'e.g. Attendance - {date}'))}" />
            </div>
            <div>
              <label style="display:block;font-size:.72rem;color:#8b949e;margin-bottom:4px" data-i18n="lms.maxPoints">${esc(t('lms.maxPoints', 'Points / Max Grade'))}</label>
              <input type="number" id="lms-canvas-max-points" value="100" min="1" max="1000" style="width:100px;background:#161b22;border:1px solid #30363d;border-radius:6px;color:#e6edf3;font-size:.82rem;padding:6px 10px;outline:none" />
            </div>
          </div>
        </div>

        <!-- Attendees Ready Pill -->
        <div id="lms-sync-summary" style="margin-top:14px;padding:10px 14px;border-radius:8px;background:rgba(88,166,255,.08);border:1px solid rgba(88,166,255,.2);font-size:.82rem;color:#c9d1d9;display:flex;align-items:center;gap:8px">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#58a6ff" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          <span id="lms-sync-summary-text">0 students ready to sync</span>
        </div>

        <!-- Live Status Toast/Feedback inside Modal -->
        <div id="lms-sync-status-box" style="display:none;margin-top:12px;padding:10px 14px;border-radius:8px;font-size:.82rem;line-height:1.4"></div>

        <!-- Footer Actions -->
        <div style="display:flex;align-items:center;justify-content:flex-end;gap:10px;margin-top:18px;border-top:1px solid #21262d;padding-top:14px">
          <button type="button" onclick="AttLmsSync.closeModal()" class="btn btn-secondary" style="background:#21262d;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:8px 16px;font-size:.85rem;cursor:pointer" data-i18n="common.cancel">Cancel</button>
          <button type="button" id="btn-lms-push-action" onclick="AttLmsSync.pushGrades()" class="btn btn-primary" style="background:#238636;color:#ffffff;border:1px solid rgba(240,246,252,0.1);border-radius:6px;padding:8px 18px;font-size:.85rem;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px">
            <svg id="lms-push-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            <span id="btn-lms-push-label" data-i18n="lms.pushGrades">${esc(t('lms.pushGrades', 'Push Grades'))}</span>
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    if (typeof root.applyTranslations === 'function') {
      root.applyTranslations(modal);
    }
    return modal;
  }

  function showStatus(msg, type = 'info') {
    const box = document.getElementById('lms-sync-status-box');
    if (!box) return;
    box.style.display = 'block';
    if (type === 'error') {
      box.style.background = 'rgba(248,81,73,.12)';
      box.style.border = '1px solid rgba(248,81,73,.35)';
      box.style.color = '#f85149';
    } else if (type === 'success') {
      box.style.background = 'rgba(74,222,128,.12)';
      box.style.border = '1px solid rgba(74,222,128,.35)';
      box.style.color = '#4ade80';
    } else {
      box.style.background = 'rgba(88,166,255,.1)';
      box.style.border = '1px solid rgba(88,166,255,.3)';
      box.style.color = '#58a6ff';
    }
    box.innerHTML = msg;
  }

  function clearStatus() {
    const box = document.getElementById('lms-sync-status-box');
    if (box) box.style.display = 'none';
  }

  function getBackendUrl() {
    if (_activeContext && typeof _activeContext.getBackendUrl === 'function') {
      return _activeContext.getBackendUrl() || '/api';
    }
    if (typeof root.state !== 'undefined' && root.state.backendUrl) {
      return root.state.backendUrl;
    }
    return typeof root.BACKEND_URL !== 'undefined' ? root.BACKEND_URL : '/api';
  }

  function getAuthToken() {
    if (_activeContext && typeof _activeContext.getAuthToken === 'function') {
      return _activeContext.getAuthToken() || '';
    }
    if (typeof root.state !== 'undefined' && root.state.sessionToken) {
      return root.state.sessionToken;
    }
    return typeof root.sessionToken !== 'undefined' ? root.sessionToken : '';
  }

  async function apiFetch(endpoint, opts = {}) {
    const baseUrl = getBackendUrl();
    const token = getAuthToken();
    const headers = Object.assign({}, opts.headers || {});
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl.replace(/\/$/, '')}/${endpoint.replace(/^\//, '')}`;
    return fetch(url, { ...opts, headers });
  }

  const AttLmsSync = {
    openModal(context = {}) {
      _activeContext = context;
      _activeTab = context.tab || 'classroom';
      ensureModalElement();
      clearStatus();

      const modal = document.getElementById('lms-sync-modal');
      modal.style.display = 'flex';

      // Set default title in new assignment inputs
      const defaultTitle = `${context.meetingTitle || 'Meeting'} Attendance${context.meetingDate ? ` (${context.meetingDate})` : ''}`;
      const title1 = document.getElementById('lms-classroom-new-title');
      const title2 = document.getElementById('lms-canvas-new-title');
      if (title1) title1.value = defaultTitle;
      if (title2) title2.value = defaultTitle;

      // Calculate attendees summary
      const records = typeof context.getRecords === 'function' ? context.getRecords() : (context.records || []);
      const total = records.length;
      const present = records.filter(r => (r.status || 'present').toLowerCase() === 'present').length;
      const late = records.filter(r => (r.status || '').toLowerCase() === 'late').length;
      const absent = total - present - late;

      const sumText = document.getElementById('lms-sync-summary-text');
      if (sumText) {
        const readyTpl = t('lms.readyToSync', '{count} students ready to sync ({present} present, {late} late, {absent} absent)');
        sumText.textContent = readyTpl
          .replace('{count}', total)
          .replace('{present}', present)
          .replace('{late}', late)
          .replace('{absent}', absent);
      }

      this.setTab(_activeTab);
    },

    closeModal() {
      const modal = document.getElementById('lms-sync-modal');
      if (modal) modal.style.display = 'none';
      clearStatus();
    },

    setTab(tab) {
      _activeTab = tab;
      const btnClassroom = document.getElementById('lms-tab-btn-classroom');
      const btnCanvas = document.getElementById('lms-tab-btn-canvas');
      const panelClassroom = document.getElementById('lms-panel-classroom');
      const panelCanvas = document.getElementById('lms-panel-canvas');

      if (tab === 'classroom') {
        btnClassroom.style.background = '#21262d';
        btnClassroom.style.color = '#58a6ff';
        btnCanvas.style.background = 'transparent';
        btnCanvas.style.color = '#8b949e';
        panelClassroom.style.display = 'block';
        panelCanvas.style.display = 'none';
        if (_classroomCourses.length === 0) this.loadClassroomCourses();
      } else {
        btnCanvas.style.background = '#21262d';
        btnCanvas.style.color = '#58a6ff';
        btnClassroom.style.background = 'transparent';
        btnClassroom.style.color = '#8b949e';
        panelCanvas.style.display = 'block';
        panelClassroom.style.display = 'none';
        if (_canvasCourses.length === 0) this.loadCanvasSettingsAndCourses();
      }
    },

    async loadClassroomCourses() {
      const authBox = document.getElementById('lms-classroom-auth-box');
      const sel = document.getElementById('lms-classroom-course-select');
      if (!sel) return;
      sel.innerHTML = `<option value="">${esc(t('lms.loadingCourses', 'Loading courses…'))}</option>`;
      if (authBox) authBox.style.display = 'none';

      try {
        const res = await apiFetch('classroom/courses');
        const data = await res.json();

        if (res.status === 401 && data.code === 'AUTH_EXPIRED') {
          if (authBox) {
            authBox.style.display = 'block';
            document.getElementById('lms-classroom-auth-msg').textContent = t('roster.classroomSignIn', 'Sign in with Google first, then try again.');
          }
          sel.innerHTML = '<option value="">(Session expired)</option>';
          return;
        }

        if (res.status === 403 || data.scopeMissing) {
          if (authBox) {
            authBox.style.display = 'block';
            document.getElementById('lms-classroom-auth-msg').textContent = t('lms.reconsent', 'Classroom write permission required. Click here to approve.');
          }
          sel.innerHTML = '<option value="">(Permission required)</option>';
          return;
        }

        _classroomCourses = data.courses || [];
        if (_classroomCourses.length === 0) {
          sel.innerHTML = `<option value="">${esc(t('lms.noCourses', 'No courses found'))}</option>`;
          return;
        }

        sel.innerHTML = _classroomCourses.map(c => `
          <option value="${esc(c.id)}">${esc(c.name)}${c.section ? ` (${esc(c.section)})` : ''}</option>
        `).join('');

        await this.onClassroomCourseChanged();
      } catch (err) {
        sel.innerHTML = '<option value="">(Failed to load courses)</option>';
        showStatus(`Failed to load courses: ${err.message}`, 'error');
      }
    },

    requestClassroomConsent() {
      const CLASSROOM_WRITE_SCOPES = 'https://www.googleapis.com/auth/classroom.coursework.students https://www.googleapis.com/auth/classroom.courses.readonly https://www.googleapis.com/auth/classroom.rosters.readonly https://www.googleapis.com/auth/classroom.profile.emails';
      if (typeof root.signInWithGoogle === 'function') {
        root.signInWithGoogle(CLASSROOM_WRITE_SCOPES);
      } else {
        alert('Please sign in from the main panel to grant Google Classroom write permissions.');
      }
    },

    async onClassroomCourseChanged() {
      const courseSel = document.getElementById('lms-classroom-course-select');
      const assignSel = document.getElementById('lms-classroom-assignment-select');
      if (!courseSel || !assignSel) return;
      const courseId = courseSel.value;
      if (!courseId) return;

      assignSel.innerHTML = `
        <option value="__new__">${esc(t('lms.createNewAssignment', '+ Create new assignment'))}</option>
        <option value="" disabled>${esc(t('lms.loadingAssignments', 'Loading assignments…'))}</option>
      `;

      try {
        const res = await apiFetch(`classroom/courses/${encodeURIComponent(courseId)}/courseWork`);
        const data = await res.json();

        if (res.status === 403 || data.scopeMissing) {
          const authBox = document.getElementById('lms-classroom-auth-box');
          if (authBox) {
            authBox.style.display = 'block';
            document.getElementById('lms-classroom-auth-msg').textContent = t('lms.reconsent', 'Classroom write permission required. Click here to approve.');
          }
        }

        if (!res.ok) {
          showStatus(data.error || 'Failed to load assignments.', 'error');
          assignSel.innerHTML = `<option value="__new__">${esc(t('lms.createNewAssignment', '+ Create new assignment'))}</option>`;
          return;
        }

        const items = data.courseWork || [];
        assignSel.innerHTML = `
          <option value="__new__">${esc(t('lms.createNewAssignment', '+ Create new assignment'))}</option>
          ${items.map(cw => `<option value="${esc(cw.id)}" data-points="${cw.maxPoints || 100}">${esc(cw.title)} (${cw.maxPoints || 100} pts)</option>`).join('')}
        `;
        this.onClassroomAssignmentChanged();
      } catch (err) {
        showStatus(`Failed to load assignments: ${err.message}`, 'error');
        assignSel.innerHTML = `<option value="__new__">${esc(t('lms.createNewAssignment', '+ Create new assignment'))}</option>`;
      }
    },

    onClassroomAssignmentChanged() {
      const assignSel = document.getElementById('lms-classroom-assignment-select');
      const newFields = document.getElementById('lms-classroom-new-fields');
      const maxPtsInput = document.getElementById('lms-classroom-max-points');
      if (!assignSel || !newFields) return;

      if (assignSel.value === '__new__') {
        newFields.style.display = 'block';
      } else {
        newFields.style.display = 'none';
        const opt = assignSel.options[assignSel.selectedIndex];
        if (opt && opt.dataset.points && maxPtsInput) {
          maxPtsInput.value = opt.dataset.points;
        }
      }
    },

    async loadCanvasSettingsAndCourses() {
      try {
        const res = await apiFetch('canvas/settings');
        const data = await res.json();
        if (data.instanceUrl) {
          const urlInput = document.getElementById('lms-canvas-url');
          if (urlInput && !urlInput.value) urlInput.value = data.instanceUrl;
        }
        if (data.configured) {
          this.loadCanvasCourses();
        }
      } catch (e) {}
    },

    async loadCanvasCourses() {
      const urlInput = document.getElementById('lms-canvas-url');
      const tokenInput = document.getElementById('lms-canvas-token');
      const courseSel = document.getElementById('lms-canvas-course-select');
      if (!courseSel) return;

      const instanceUrl = urlInput ? urlInput.value.trim() : '';
      const token = tokenInput ? tokenInput.value.trim() : '';

      courseSel.innerHTML = `<option value="">${esc(t('lms.loadingCourses', 'Loading courses…'))}</option>`;
      clearStatus();

      try {
        const headers = {};
        if (instanceUrl) headers['x-canvas-url'] = instanceUrl;
        if (token) headers['x-canvas-token'] = token;

        const res = await apiFetch('canvas/courses', { headers });
        const data = await res.json();

        if (!res.ok) {
          showStatus(data.error || 'Failed to load Canvas courses. Check URL and token.', 'error');
          courseSel.innerHTML = '<option value="">(Failed to load courses)</option>';
          return;
        }

        _canvasCourses = data.courses || [];
        if (_canvasCourses.length === 0) {
          courseSel.innerHTML = `<option value="">${esc(t('lms.noCourses', 'No courses found'))}</option>`;
          return;
        }

        courseSel.innerHTML = _canvasCourses.map(c => `
          <option value="${esc(c.id)}">${esc(c.name)}${c.courseCode ? ` (${esc(c.courseCode)})` : ''}</option>
        `).join('');

        this.onCanvasCourseChanged();
      } catch (err) {
        showStatus(`Canvas connection error: ${err.message}`, 'error');
        courseSel.innerHTML = '<option value="">(Connection failed)</option>';
      }
    },

    async onCanvasCourseChanged() {
      const courseSel = document.getElementById('lms-canvas-course-select');
      const assignSel = document.getElementById('lms-canvas-assignment-select');
      const urlInput = document.getElementById('lms-canvas-url');
      const tokenInput = document.getElementById('lms-canvas-token');
      if (!courseSel || !assignSel) return;
      const courseId = courseSel.value;
      if (!courseId) return;

      assignSel.innerHTML = `
        <option value="__new__">${esc(t('lms.createNewAssignment', '+ Create new assignment'))}</option>
        <option value="" disabled>${esc(t('lms.loadingAssignments', 'Loading assignments…'))}</option>
      `;

      try {
        const headers = {};
        if (urlInput?.value) headers['x-canvas-url'] = urlInput.value.trim();
        if (tokenInput?.value) headers['x-canvas-token'] = tokenInput.value.trim();

        const res = await apiFetch(`canvas/courses/${encodeURIComponent(courseId)}/assignments`, { headers });
        const data = await res.json();

        if (!res.ok) {
          showStatus(data.error || 'Failed to load Canvas assignments.', 'error');
          assignSel.innerHTML = `<option value="__new__">${esc(t('lms.createNewAssignment', '+ Create new assignment'))}</option>`;
          return;
        }

        const items = data.assignments || [];
        assignSel.innerHTML = `
          <option value="__new__">${esc(t('lms.createNewAssignment', '+ Create new assignment'))}</option>
          ${items.map(a => `<option value="${esc(a.id)}" data-points="${a.pointsPossible || 100}">${esc(a.name)} (${a.pointsPossible || 100} pts)</option>`).join('')}
        `;
        this.onCanvasAssignmentChanged();
      } catch (err) {
        showStatus(`Failed to load Canvas assignments: ${err.message}`, 'error');
        assignSel.innerHTML = `<option value="__new__">${esc(t('lms.createNewAssignment', '+ Create new assignment'))}</option>`;
      }
    },

    onCanvasAssignmentChanged() {
      const assignSel = document.getElementById('lms-canvas-assignment-select');
      const newFields = document.getElementById('lms-canvas-new-fields');
      const maxPtsInput = document.getElementById('lms-canvas-max-points');
      if (!assignSel || !newFields) return;

      if (assignSel.value === '__new__') {
        newFields.style.display = 'block';
      } else {
        newFields.style.display = 'none';
        const opt = assignSel.options[assignSel.selectedIndex];
        if (opt && opt.dataset.points && maxPtsInput) {
          maxPtsInput.value = opt.dataset.points;
        }
      }
    },

    async pushGrades() {
      const pushBtn = document.getElementById('btn-lms-push-action');
      const pushLabel = document.getElementById('btn-lms-push-label');
      if (!pushBtn) return;

      const records = typeof _activeContext?.getRecords === 'function'
        ? _activeContext.getRecords()
        : (_activeContext?.records || []);

      if (!records || records.length === 0) {
        showStatus(t('lms.noAttendees', 'No meeting attendees available to sync.'), 'error');
        return;
      }

      pushBtn.disabled = true;
      pushLabel.textContent = t('lms.pushingGrades', 'Syncing grades…');
      showStatus(t('lms.pushingGrades', 'Syncing grades…'), 'info');

      try {
        if (_activeTab === 'classroom') {
          const courseSel = document.getElementById('lms-classroom-course-select');
          const assignSel = document.getElementById('lms-classroom-assignment-select');
          const newTitle = document.getElementById('lms-classroom-new-title');
          const maxPtsInput = document.getElementById('lms-classroom-max-points');

          const courseId = courseSel ? courseSel.value : '';
          const courseWorkId = assignSel ? assignSel.value : '__new__';
          const maxPoints = parseInt(maxPtsInput?.value || '100', 10) || 100;
          const title = newTitle?.value.trim() || 'Meeting Attendance';

          if (!courseId) {
            throw new Error('Please select a Classroom course.');
          }

          const res = await apiFetch('classroom/sync-grades', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              courseId,
              courseWorkId: courseWorkId === '__new__' ? null : courseWorkId,
              createAssignment: courseWorkId === '__new__',
              title,
              maxPoints,
              records,
            }),
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Classroom sync failed.');
          }

          if (data.syncedCount === 0) {
            showStatus(`Warning: ${data.message || 'No students matched the course roster.'}`, 'error');
          } else {
            const totalCount = data.totalCount || records.length;
            const unmatchedCount = totalCount - data.syncedCount;
            let successMsg;
            if (unmatchedCount > 0) {
              successMsg = t('lms.syncPartial', 'Synced {synced} of {total} students ({unmatched} unmatched)')
                .replace('{synced}', data.syncedCount)
                .replace('{total}', totalCount)
                .replace('{unmatched}', unmatchedCount);
            } else {
              successMsg = t('lms.syncSuccess', 'Successfully synced grades for {count} students!')
                .replace('{count}', data.syncedCount);
            }
            showStatus(`✓ ${successMsg}`, 'success');
            if (typeof root.toast === 'function') root.toast(successMsg, 4000);
            if (typeof _activeContext?.onSyncComplete === 'function') _activeContext.onSyncComplete(data);
            setTimeout(() => this.closeModal(), 2200);
          }
        } else {
          // Canvas LMS Sync
          const urlInput = document.getElementById('lms-canvas-url');
          const tokenInput = document.getElementById('lms-canvas-token');
          const saveCheckbox = document.getElementById('lms-canvas-save');
          const courseSel = document.getElementById('lms-canvas-course-select');
          const assignSel = document.getElementById('lms-canvas-assignment-select');
          const newTitle = document.getElementById('lms-canvas-new-title');
          const maxPtsInput = document.getElementById('lms-canvas-max-points');

          const instanceUrl = urlInput ? urlInput.value.trim() : '';
          const token = tokenInput ? tokenInput.value.trim() : '';
          const saveToken = saveCheckbox ? saveCheckbox.checked : false;
          const courseId = courseSel ? courseSel.value : '';
          const assignmentId = assignSel ? assignSel.value : '__new__';
          const maxPoints = parseInt(maxPtsInput?.value || '100', 10) || 100;
          const title = newTitle?.value.trim() || 'Meeting Attendance';

          if (!courseId) {
            throw new Error('Please select a Canvas course.');
          }

          const res = await apiFetch('canvas/sync-grades', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              instanceUrl,
              token,
              saveToken,
              courseId,
              assignmentId,
              title,
              maxPoints,
              records,
            }),
          });

          const data = await res.json();
          if (!res.ok) {
            throw new Error(data.error || 'Canvas sync failed.');
          }

          if (data.syncedCount === 0) {
            showStatus(`Warning: ${data.message || 'No meeting attendees matched students in the Canvas course roster.'}`, 'error');
          } else {
            const totalCount = data.totalCount || records.length;
            const unmatchedCount = totalCount - data.syncedCount;
            let successMsg;
            if (unmatchedCount > 0) {
              successMsg = t('lms.syncPartial', 'Synced {synced} of {total} students ({unmatched} unmatched)')
                .replace('{synced}', data.syncedCount)
                .replace('{total}', totalCount)
                .replace('{unmatched}', unmatchedCount);
            } else {
              successMsg = t('lms.syncSuccess', 'Successfully synced grades for {count} students!')
                .replace('{count}', data.syncedCount);
            }
            showStatus(`✓ ${successMsg}`, 'success');
            if (typeof root.toast === 'function') root.toast(successMsg, 4000);
            if (typeof _activeContext?.onSyncComplete === 'function') _activeContext.onSyncComplete(data);
            setTimeout(() => this.closeModal(), 2200);
          }
        }
      } catch (err) {
        showStatus(`Error: ${err.message}`, 'error');
      } finally {
        pushBtn.disabled = false;
        pushLabel.textContent = t('lms.pushGrades', 'Push Grades');
      }
    },
  };

  root.AttLmsSync = AttLmsSync;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AttLmsSync;
  }
})(typeof window !== 'undefined' ? window : globalThis);
