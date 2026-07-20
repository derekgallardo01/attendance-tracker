// Single backend HTML-escaper. Escapes the full 5-char set (incl. quotes) so
// output is safe in both text and attribute contexts. Mirrors the frontend
// AttUtils.escHtml in js/utils.js — keep the two in sync. Used by transactional
// email templates (lib/notifications.js) and server-rendered pages
// (routes/public.js).
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

module.exports = { escapeHtml };
