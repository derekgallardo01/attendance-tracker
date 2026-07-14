// i18n foundation for the Meet side panel.
//
// Groundwork only: a single source of user-facing strings + a t() lookup, so a
// locale layer can be added later without hunting strings out of the markup.
// Loaded synchronously in <head> (like js/utils.js) so window.t exists before
// any inline script runs. English is the only locale today; add a sibling key
// block (e.g. STRINGS.es) and call setLocale('es') to introduce another.
//
// Kept as a standalone file so it can be unit-tested in jsdom in isolation.
(function (root) {
  const STRINGS = {
    en: {
      // Status bar
      'status.initializing': 'Initializing…',
      'status.tracking': 'Tracking attendance…',
      'status.stopped': 'Tracking stopped',
      // Buttons
      'btn.start': 'Start',
      'btn.sync': 'Sync',
      'btn.sheet': 'Sheet',
      // Toasts
      'toast.autoExportOn': 'Auto-export on',
      'toast.autoExportOff': 'Auto-export off',
      'toast.emailOn': 'Email notifications on',
      'toast.emailOff': 'Email notifications off',
      'toast.signedOut': 'Signed out',
      'toast.signInFirst': 'Please sign in to start tracking',
      'toast.accountDeleted': 'Your account and data have been deleted.',
    },
  };

  let locale = 'en';

  // Look up a key for the active locale, falling back to English, then to the
  // provided fallback, then to the key itself (so a missing key is visible, not
  // blank).
  function t(key, fallback) {
    const table = STRINGS[locale] || STRINGS.en;
    if (table && Object.prototype.hasOwnProperty.call(table, key)) return table[key];
    if (Object.prototype.hasOwnProperty.call(STRINGS.en, key)) return STRINGS.en[key];
    return fallback != null ? fallback : key;
  }

  function setLocale(l) {
    if (STRINGS[l]) locale = l;
    return locale;
  }

  const api = { t, setLocale, STRINGS, getLocale: () => locale };

  // Browser: expose window.t + window.AttStrings. Node/jsdom test: module.exports.
  if (root) {
    root.t = t;
    root.setLocale = setLocale;
    root.AttStrings = api;
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
