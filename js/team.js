// Pure, dependency-free helpers for the team dashboard (team.html), extracted
// from that page's inline <script> so the formatters and the per-tab search
// filters can be unit-tested. DOM lookups + rendering stay inline in team.html;
// everything here takes its data as arguments.
//
// Exposed as both `window.AttTeam` (browser) and `module.exports` (Jest),
// mirroring js/utils.js.

(function (root) {
  'use strict';

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  // Duration in ms → "45m" / "1h" / "1h 20m"; em-dash when absent/non-positive.
  function fmtDuration(ms) {
    if (!ms || ms <= 0) return '—';
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? `${h}h ${mm}m` : `${h}h`;
  }

  // Whole minutes → "45m" / "1h" / "1h 20m"; em-dash when absent.
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

  const norm = (q) => String(q || '').toLowerCase().trim();
  const has = (s, q) => String(s || '').toLowerCase().includes(q);

  // The four tab search filters. Each takes the raw search-box value (normalised
  // internally) and returns the matching rows; an empty query returns all.
  function filterUsers(users, query) {
    const q = norm(query);
    return (users || []).filter(u => !q || has(u.displayName, q) || has(u.email, q));
  }
  function filterMeetings(meetings, query) {
    const q = norm(query);
    return (meetings || []).filter(m => !q || has(m.title, q) || (m.presentNames || []).some(n => has(n, q)));
  }
  function filterSeries(series, query) {
    const q = norm(query);
    return q ? (series || []).filter(s => has(s.title, q)) : (series || []);
  }
  function filterPeople(people, query) {
    const q = norm(query);
    return (people || []).filter(p => !q || has(p.displayName, q) || has(p.email, q));
  }

  const api = {
    fmtDate, fmtDuration, fmtMinutes, pct, computeRange,
    filterUsers, filterMeetings, filterSeries, filterPeople,
  };
  root.AttTeam = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
