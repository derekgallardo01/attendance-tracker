// Guard against the class of bug where a route imports a firestore helper that
// isn't actually exported. Route tests mock the firestore module, so a missing
// real export (e.g. getDb) passes tests but fails in production. This test
// requires the REAL module and asserts every name the routes destructure is a
// function.

const firestore = require('../../src/services/firestore');

// Names imported via `require('../services/firestore')` across the route files.
// Keep in sync when a route starts importing a new helper.
const REQUIRED_EXPORTS = [
  // public.js
  'getDb', 'resolveShareLink', 'getSharedSeriesView', 'suppressEmail',
  // settings.js
  'getUserSettings', 'updateUserSettings', 'isEmailSuppressed', 'unsuppressEmail',
  // billing.js
  'getTenantPlan', 'setTenantPlan',
  // team.js
  'getUser', 'getTeamOverview',
  // admin.js (a representative high-risk subset)
  'upsertTenantConfig', 'getTenantConfig', 'getAllUsersAcrossTenants',
  'getActivationFunnel', 'evaluateReengagementForUser', 'claimReengagementSlot',
  'claimDailyAlertSlot', 'recordAlertsSent', 'evaluateSeriesAlerts', 'logEvent',
  // core write path
  'persistAttendance', 'persistExport', 'persistCalendarData', 'countDistinctAttendees',
];

describe('firestore module exports (real, unmocked)', () => {
  test.each(REQUIRED_EXPORTS)('exports %s as a function', (name) => {
    expect(typeof firestore[name]).toBe('function');
  });
});
