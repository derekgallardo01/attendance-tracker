// Pure, dependency-free helpers for the personal history page (history.html),
// extracted from that page's inline <script> so the formatters, tab search
// filters, and calendar-heatmap math can be unit-tested. DOM lookups, rendering,
// fetch, and clipboard orchestration stay inline in history.html.
//
// Exposed as both `window.AttHistory` (browser) and `module.exports` (Jest),
// mirroring js/utils.js.

(function (root) {
  'use strict';

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function fmtTime(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function fmtDuration(ms) {
    if (!ms || ms <= 0) return '—';
    const min = Math.round(ms / 60000);
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  function fmtMinutes(min) {
    if (!min) return '—';
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  function pct(v) { return Math.round(v * 100) + '%'; }

  // Series date range: "Mar 3, 2026 – Apr 1, 2026", or a single date.
  function computeRange(firstAt, lastAt) {
    return firstAt && lastAt && firstAt !== lastAt
      ? `${fmtDate(firstAt)} – ${fmtDate(lastAt)}`
      : fmtDate(lastAt || firstAt);
  }

  // CSS.escape-lite: backslash-escape anything that isn't a word char or hyphen,
  // so a recurringEventId can be dropped into a querySelector safely.
  function cssEscape(s) { return String(s).replace(/[^\w-]/g, c => '\\' + c); }

  const norm = (q) => String(q || '').toLowerCase().trim();
  const has = (s, q) => String(s || '').toLowerCase().includes(q);
  function filterMeetings(meetings, query) {
    const q = norm(query);
    return (meetings || []).filter(m => !q || has(m.title, q) || (m.presentNames || []).some(n => has(n, q)));
  }
  function filterPeople(people, query) {
    const q = norm(query);
    return (people || []).filter(p => !q || has(p.displayName, q) || has(p.email, q));
  }
  function filterSeries(series, query) {
    const q = norm(query);
    return q ? (series || []).filter(s => has(s.title, q)) : (series || []);
  }

  // Days with at least one tracked meeting — the "active days" stat.
  function activeDays(calendar) { return (calendar || []).filter(c => c.count > 0).length; }

  // Heatmap: the busiest day's count, floored at 1 so the ratio divide is safe.
  function maxCalendarCount(cells) { return Math.max(1, ...(cells || []).map(c => c.count)); }

  // Heatmap intensity class ('' / l1..l4) for a cell count relative to the max.
  function calendarLevel(count, maxCount) {
    if (count === 0) return '';
    const ratio = count / maxCount;
    if (ratio < 0.25) return 'l1';
    if (ratio < 0.5) return 'l2';
    if (ratio < 0.75) return 'l3';
    return 'l4';
  }

  // ── Series gradebook CSVs (generic / Moodle / Canvas) ──
  // Built from a /api/series entry: people[] carries attended/missed/
  // attendanceRate/totalMinutes with per-series canonicalized emails — the
  // exact shape an LMS gradebook import wants.

  // Mirrors AttUtils.escapeCsv, INCLUDING the formula-injection prefix: Excel
  // evaluates a leading = + - @ even inside quoted fields, and both display
  // names and series titles are attacker-controlled by anyone who joins a
  // meeting. This twin was missing the guard its sibling documented.
  function csvField(val) {
    if (val === null || val === undefined) return '""';
    let s = String(val);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return `"${s.replace(/"/g, '""')}"`;
  }

  // "Alice B Walker" -> first "Alice B", last "Walker" (mirrors js/utils.js).
  function splitPersonName(full) {
    const s = String(full || '').trim();
    const i = s.lastIndexOf(' ');
    return i === -1 ? { first: s, last: '' } : { first: s.slice(0, i), last: s.slice(i + 1) };
  }

  // format: 'generic' | 'moodle' | 'canvas'. Grade = attendance % across the
  // series' tracked sessions.
  function buildSeriesGradebookCsv(series, format) {
    const title = (series && series.title) || 'Recurring meeting';
    const people = (series && series.people) || [];
    const gradeOf = (p) => Math.round((p.attendanceRate || 0) * 100);
    const rows = [];

    if (format === 'moodle') {
      rows.push(['First name', 'Last name', 'Email address', `${title} attendance (%)`].map(csvField).join(','));
      for (const p of people) {
        const { first, last } = splitPersonName(p.displayName);
        rows.push([first, last, p.email || '', gradeOf(p)].map(csvField).join(','));
      }
    } else if (format === 'canvas') {
      rows.push(['Student', 'ID', 'SIS User ID', 'SIS Login ID', 'Section', `${title} attendance`].map(csvField).join(','));
      rows.push(['Points Possible', '', '', '', '', 100].map(csvField).join(','));
      for (const p of people) {
        rows.push([p.displayName, '', '', p.email || '', '', gradeOf(p)].map(csvField).join(','));
      }
    } else {
      rows.push(['Name', 'Email', 'Attended', 'Missed', 'Attendance %', 'Total minutes'].map(csvField).join(','));
      for (const p of people) {
        rows.push([p.displayName, p.email || '', p.attended || 0, p.missed || 0, gradeOf(p), p.totalMinutes || 0].map(csvField).join(','));
      }
    }
    return '﻿' + rows.join('\r\n');
  }

  const api = {
    fmtDate, fmtTime, fmtDuration, fmtMinutes, pct, computeRange, cssEscape,
    filterMeetings, filterPeople, filterSeries,
    activeDays, maxCalendarCount, calendarLevel,
    splitPersonName, buildSeriesGradebookCsv, csvField,
  };
  root.AttHistory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
