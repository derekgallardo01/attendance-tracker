// Shared test helpers for route integration tests.
//
// Strategy: mock the service modules (firestore, googleAuth, notifications,
// meetApi) at the boundary so route handlers run against fast in-process
// fakes. Each test file installs its own mocks via jest.mock() at the top —
// then uses this helper to (re)build the Express app after mocks are in
// place. The app caches singletons internally, so we need a fresh require
// for each test file.

const jwt = require('jsonwebtoken');
const path = require('path');

const SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-do-not-use-in-prod-32bytes-min';

// Build a Bearer-token Authorization header for the given identity. The auth
// middleware will JWT-verify this with the same SESSION_SECRET set in
// setup-env.js, then call getUser() to refresh tokens — so most tests need
// to also mock firestore.getUser() to return a user doc with a refreshToken
// (so the middleware finds a "valid" user).
function authedHeader(email, domain, displayName) {
  const token = jwt.sign(
    { email, domain, displayName: displayName || email },
    SESSION_SECRET,
    { expiresIn: '8h' }
  );
  return { Authorization: `Bearer ${token}` };
}

// Build a JWT directly (no Bearer prefix) for tests that need it raw.
function makeJwt(payload, opts) {
  return jwt.sign(payload, SESSION_SECRET, { expiresIn: '8h', ...opts });
}

// Returns the Express app. jest.mock() at the top of the calling test file
// stays in effect for every require — no need to resetModules (which would
// invalidate the test's own firestore reference too).
function buildApp() {
  return require('../../src/app');
}

module.exports = { authedHeader, makeJwt, buildApp, SESSION_SECRET };
