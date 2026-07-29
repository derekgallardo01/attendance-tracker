// Pure, dependency-free helpers for the public share page (share.html),
// extracted from that page's inline <script> so the date / percent / range /
// row-render logic can be unit-tested. DOM lookups + fetch orchestration stay
// inline in share.html; everything here takes its data as arguments.
//
// Exposed as both `window.AttShare` (browser) and `module.exports` (Jest),
// mirroring js/utils.js. share.html re-declares thin wrappers so call sites are
// unchanged.

(function (root) {
  'use strict';

  // ISO date → "Mar 3, 2026" in the viewer's locale; em-dash when absent.
  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Attendance rate (0..1) → "83%".
  function pct(v) { return Math.round(v * 100) + '%'; }

  // "Mar 3, 2026 – Apr 1, 2026" when the series spans two distinct dates, else a
  // single date (whichever of last/first is present).
  function computeRange(firstAt, lastAt) {
    return firstAt && lastAt && firstAt !== lastAt
      ? `${fmtDate(firstAt)} – ${fmtDate(lastAt)}`
      : fmtDate(lastAt || firstAt);
  }

  // Build the <tr> rows for the people table. `esc` is injected (AttUtils.escHtml
  // in the browser) so this module stays dependency-free and unit-testable.
  // Falls back to a single "no participants" row when the list is empty.
  function renderPeopleRows(people, instanceCount, esc) {
    const rows = (people || []).map(p => `
          <tr>
            <td>${esc(p.displayName)}</td>
            <td class="right">${p.attended}/${instanceCount}</td>
            <td><div style="display:flex;align-items:center;gap:10px"><div class="progress-bar" style="flex:1"><div style="width:${Math.round(p.attendanceRate * 100)}%"></div></div><span style="font-size:.78rem;color:var(--muted);min-width:36px">${pct(p.attendanceRate)}</span></div></td>
          </tr>
        `).join('');
    return rows || '<tr><td colspan="3" class="muted">No participants tracked.</td></tr>';
  }

  const api = { fmtDate, pct, computeRange, renderPeopleRows };
  root.AttShare = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
