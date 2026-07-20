/**
 * @jest-environment node
 *
 * The shared js/ modules use a dual-export IIFE wrapper:
 *   (function (root) { ... })(typeof window !== 'undefined' ? window : globalThis)
 * The jsdom tests exercise the `window` branch; this node-environment test (no
 * window) exercises the `globalThis` / null fallback branch so the wrapper is
 * fully covered.
 */

const path = require('path');
const jsDir = path.join(__dirname, '..', '..', '..', 'js');

test('modules load and export in a non-browser (no window) environment', () => {
  expect(typeof window).toBe('undefined');
  const utils = require(path.join(jsDir, 'utils.js'));
  const api = require(path.join(jsDir, 'api.js'));
  const strings = require(path.join(jsDir, 'strings.js'));
  expect(typeof utils.escHtml).toBe('function');
  expect(typeof api.authedFetch).toBe('function');
  expect(typeof strings.t === 'function' || typeof strings.setLocale === 'function').toBe(true);
});
