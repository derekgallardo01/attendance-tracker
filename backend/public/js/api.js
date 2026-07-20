// Shared backend + Google sign-in glue for the signed-in app pages
// (index.html's add-on has its own APP_CONFIG-driven copy; this serves
// admin / history / team / setup, which otherwise each hard-coded the same
// backend URL, client id, scopes, and code-exchange popup flow).
//
// Exposed as `window.AttApi` (browser) and `module.exports` (Jest jsdom).
// Sign-in stays callback-driven so each page keeps full control of its own
// login → loading → dashboard DOM transitions; only the Google popup + the
// /oauth/exchange round-trip are shared here.

(function (root) {
  'use strict';

  // Cloud Run backend. Absolute URL because these pages are served from
  // GitHub Pages (attendancetracker.dev) and call the backend cross-origin;
  // it also resolves correctly when the same file is mirrored under the
  // backend's own origin, so the mirror needs no rewrite (unlike index.html).
  const BACKEND_URL = 'https://attendance-tracker-backend-829771833968.us-central1.run.app/api';
  const CLIENT_ID = '829771833968-92hq9toga2ga92mg7nfuf6dqclj7er2n.apps.googleusercontent.com';
  // The app pages only need identity — no Drive/Calendar/Meet scopes. (The
  // add-on requests those separately during its own onboarding.)
  const SCOPES = 'openid email profile';

  // Run the Google authorization-code popup, then exchange the code for a
  // backend session. Preserves the exact per-page flow via callbacks:
  //   onStart()      — fired once Google returns a code, before the exchange
  //                    (pages use it to swap to a "signing you in…" spinner)
  //   onSuccess(data)— the parsed /oauth/exchange response (sessionToken, email…)
  //   onError(err)   — exchange failed (network or non-2xx)
  // A user who closes/denies the popup triggers none of these — same as the
  // original inline handlers, which silently returned on response.error.
  function signIn({ onStart, onSuccess, onError } = {}) {
    const client = google.accounts.oauth2.initCodeClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      ux_mode: 'popup',
      access_type: 'offline',
      callback: async (response) => {
        if (response.error) return; // user closed the popup or denied
        if (onStart) onStart();
        try {
          const res = await fetch(`${BACKEND_URL}/oauth/exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: response.code }),
          });
          if (!res.ok) throw new Error('Auth failed');
          const data = await res.json();
          if (onSuccess) onSuccess(data);
        } catch (err) {
          if (onError) onError(err);
        }
      },
    });
    client.requestCode();
  }

  // fetch() against the backend with the session bearer attached. `path` is
  // the /api-relative path (e.g. '/history'). Returns the raw Response so
  // callers keep their existing res.ok / res.json() handling.
  function authedFetch(token, path, opts = {}) {
    return fetch(`${BACKEND_URL}${path}`, {
      ...opts,
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
    });
  }

  const api = { BACKEND_URL, CLIENT_ID, SCOPES, signIn, authedFetch };
  root.AttApi = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
