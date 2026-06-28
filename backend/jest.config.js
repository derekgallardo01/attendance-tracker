// Jest config for the Attendance Tracker backend.
// Node environment because we're testing Express + Firestore code (no DOM).
// Coverage targets the src/ tree only — node_modules and tests excluded.
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/test/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/instrument.js', // Sentry init, no logic to test
  ],
  coverageReporters: ['text', 'text-summary', 'html'],
  setupFiles: ['<rootDir>/test/setup-env.js'],
  // Each test file gets a fresh module registry — important because some of
  // our modules cache singletons (Firestore client, Resend client) and we
  // don't want test bleed.
  resetModules: false,
  clearMocks: true,
  restoreMocks: true,
  testTimeout: 10000,
  // Per-file environment override: frontend tests live in test/frontend/ and
  // need jsdom (window, document, Date timezone behavior). Everything else
  // runs in plain node for speed.
  projects: [
    {
      displayName: 'backend',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/test/services/**/*.test.js', '<rootDir>/test/lib/**/*.test.js', '<rootDir>/test/routes/**/*.test.js'],
      setupFiles: ['<rootDir>/test/setup-env.js'],
    },
    {
      displayName: 'frontend',
      testEnvironment: 'jsdom',
      testMatch: ['<rootDir>/test/frontend/**/*.test.js'],
    },
  ],
};
