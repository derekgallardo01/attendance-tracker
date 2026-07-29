// Pure, dependency-free helpers for the admin/CRM dashboard (admin.html),
// extracted from that page's inline <script> so the formatters, badges, and
// email-template substitution can be unit-tested. DOM lookups, rendering, and
// fetch orchestration stay inline in admin.html.
//
// Exposed as both `window.AttAdmin` (browser) and `module.exports` (Jest),
// mirroring js/utils.js.

(function (root) {
  'use strict';

  // Attendance/ratio 0..1 → "83.3%" (1 decimal); em-dash when null/undefined.
  function pct(v) { return v == null ? '—' : (v * 100).toFixed(1) + '%'; }

  // Millisecond duration → the largest sensible unit (s / m / h / d).
  function fmtMs(ms) {
    if (ms == null) return '—';
    const s = ms / 1000;
    if (s < 60) return Math.round(s) + 's';
    if (s < 3600) return Math.round(s / 60) + 'm';
    if (s < 86400) return (s / 3600).toFixed(1) + 'h';
    return (s / 86400).toFixed(1) + 'd';
  }

  function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString() : '—'; }
  function fmtDateTime(iso) { return iso ? new Date(iso).toLocaleString() : '—'; }

  // Relative "…ago" label. `now` is injectable so tests are deterministic;
  // callers pass one arg and it defaults to the current time.
  function timeAgo(iso, now = Date.now()) {
    if (!iso) return '—';
    const sec = Math.floor((now - new Date(iso).getTime()) / 1000);
    if (sec < 60) return sec + 's ago';
    if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
    return Math.floor(sec / 86400) + 'd ago';
  }

  // Whole days since `iso`; '?' when absent. `now` injectable for tests.
  function ageDaysCalc(iso, now = Date.now()) {
    if (!iso) return '?';
    return String(Math.floor((now - new Date(iso).getTime()) / 86400000));
  }

  // Reach-out priority (1=hot, 2=today, else this-week) → a coloured badge.
  function priorityBadge(p) {
    if (p === 1) return '<span class="badge" style="background:rgba(248,81,73,.18);color:#ff7b72">🔥 HOT</span>';
    if (p === 2) return '<span class="badge" style="background:rgba(251,191,36,.18);color:#fbbf24">⚡ TODAY</span>';
    return '<span class="badge" style="background:rgba(88,166,255,.18);color:#58a6ff">📅 THIS WEEK</span>';
  }

  // Health score → a badge whose colour bands at 70 (good) / 40 (warn) / below.
  function healthBadge(score) {
    const color = score >= 70 ? 'var(--accent)' : score >= 40 ? '#fbbf24' : 'var(--error)';
    return `<span style="background:rgba(255,255,255,.05);border:1px solid var(--border);border-radius:10px;padding:2px 10px;font-size:.75rem;font-weight:600;color:${color}">Health ${score}</span>`;
  }

  // Email-template substitution. templateSubs builds the {{var}} map from the
  // compose context; fillTemplate applies it (missing keys → '').
  function templateSubs(ctx) {
    return {
      firstName: (ctx.displayName || ctx.email).split(' ')[0].split('@')[0],
      tracked: ctx.tracked,
      exported: ctx.exported,
      daysAgo: ctx.daysAgo,
      domain: ctx.domain,
    };
  }
  function fillTemplate(str, subs) {
    return String(str || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (subs[k] != null ? subs[k] : ''));
  }

  const api = {
    pct, fmtMs, fmtDate, fmtDateTime, timeAgo, ageDaysCalc,
    priorityBadge, healthBadge, templateSubs, fillTemplate,
  };
  root.AttAdmin = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
