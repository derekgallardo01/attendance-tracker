// Coverage config for the shared frontend js/ modules (utils, api, strings).
// Separate from jest.config.js because these files live in the repo-root js/
// dir, outside the backend rootDir — so coverage needs rootDir at the repo root
// to instrument them. The jsdom tests themselves live under backend/test/frontend.
const path = require('path');

module.exports = {
  rootDir: path.join(__dirname, '..'), // repo root
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/backend/test/frontend/**/*.test.js'],
  collectCoverageFrom: ['js/**/*.js'],
  // v8 provider so the repo-root js/ modules (required by absolute path from the
  // jsdom tests) get instrumented — the babel provider misses them.
  coverageProvider: 'v8',
  coverageReporters: ['text', 'text-summary', 'html'],
  coverageDirectory: '<rootDir>/backend/coverage-frontend',
  clearMocks: true,
  restoreMocks: true,
  // The shared js/ modules are the pages' pure logic — hold them to 100%.
  coverageThreshold: {
    global: { statements: 100, branches: 100, functions: 100, lines: 100 },
  },
};
