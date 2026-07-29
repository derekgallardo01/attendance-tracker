/**
 * @jest-environment jsdom
 *
 * Tests for the pure setup-wizard helpers in js/setup.js (extracted from
 * setup.html's inline script). Loaded from the root js/ dir (canonical source).
 */

const path = require('path');
const setup = require(path.join(__dirname, '..', '..', '..', 'js', 'setup.js'));

describe('parseDomain', () => {
  test('returns the domain part of a normal address', () => {
    expect(setup.parseDomain('admin@acme.com')).toBe('acme.com');
    expect(setup.parseDomain('  admin@acme.com  ')).toBe('acme.com'); // trims
  });

  test('returns "" for input without a real domain', () => {
    expect(setup.parseDomain('no-at-sign')).toBe('');
    expect(setup.parseDomain('trailing@')).toBe('');
    expect(setup.parseDomain('')).toBe('');
    expect(setup.parseDomain(null)).toBe('');
    expect(setup.parseDomain(undefined)).toBe('');
  });
});

describe('verifyResult', () => {
  test('success → green banner with the completion message', () => {
    const r = setup.verifyResult({ success: true });
    expect(r.className).toBe('result success');
    expect(r.message).toMatch(/Setup complete/);
  });

  test('failure with a server error → red banner echoing that error', () => {
    const r = setup.verifyResult({ success: false, error: 'SA not shared' });
    expect(r.className).toBe('result error');
    expect(r.message).toBe('SA not shared');
  });

  test('failure without an error → red banner with the generic fallback', () => {
    expect(setup.verifyResult({ success: false }).message).toMatch(/not configured correctly/);
    expect(setup.verifyResult(null).className).toBe('result error');
    expect(setup.verifyResult(undefined).message).toMatch(/not configured correctly/);
  });
});

describe('verifyNetworkError', () => {
  test('returns the red "could not reach the server" banner', () => {
    const r = setup.verifyNetworkError();
    expect(r.className).toBe('result error');
    expect(r.message).toMatch(/Could not reach the server/);
  });
});
