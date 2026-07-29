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

  const api = {
    fmtDate, fmtTime, fmtDuration, fmtMinutes, pct, computeRange, cssEscape,
    filterMeetings, filterPeople, filterSeries,
    activeDays, maxCalendarCount, calendarLevel,
  };
  root.AttHistory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
