// The logger emits one JSON line per call and forwards ERROR-level entries to
// Sentry. Mock Sentry so we can assert the forward without a real DSN.

const mockWithScope = jest.fn((cb) => cb({ setLevel: jest.fn(), setExtras: jest.fn(), setContext: jest.fn() }));
const mockCapture = jest.fn();
const mockCaptureException = jest.fn();
jest.mock('@sentry/node', () => ({ withScope: mockWithScope, captureMessage: mockCapture, captureException: mockCaptureException }));

const log = require('../../src/lib/logger');

let logSpy, warnSpy, errorSpy;
beforeEach(() => {
  jest.clearAllMocks();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { logSpy.mockRestore(); warnSpy.mockRestore(); errorSpy.mockRestore(); });

test('info() writes a JSON line to console.log and does NOT hit Sentry', () => {
  log.info('hello', { a: 1 });
  const entry = JSON.parse(logSpy.mock.calls[0][0]);
  expect(entry).toMatchObject({ severity: 'INFO', msg: 'hello', a: 1 });
  expect(entry.ts).toBeDefined();
  expect(mockCapture).not.toHaveBeenCalled();
});

test('info() works with no data arg (default-param branch)', () => {
  log.info('bare');
  expect(JSON.parse(logSpy.mock.calls[0][0])).toMatchObject({ severity: 'INFO', msg: 'bare' });
});

test('warn() uses console.warn and works with no data arg (default-param branch)', () => {
  log.warn('careful');
  const entry = JSON.parse(warnSpy.mock.calls[0][0]);
  expect(entry).toMatchObject({ severity: 'WARNING', msg: 'careful' });
  expect(mockCapture).not.toHaveBeenCalled();
});

test('error() uses console.error, forwards to Sentry, and works with no data arg', () => {
  log.error('boom');
  const entry = JSON.parse(errorSpy.mock.calls[0][0]);
  expect(entry).toMatchObject({ severity: 'ERROR', msg: 'boom' });
  expect(mockWithScope).toHaveBeenCalled();
  expect(mockCapture).toHaveBeenCalledWith('boom');
});

test('error() with data attaches it as Sentry extras', () => {
  const scope = { setLevel: jest.fn(), setExtras: jest.fn(), setContext: jest.fn() };
  mockWithScope.mockImplementationOnce((cb) => cb(scope));
  log.error('with-extras', { domain: 'acme.com' });
  expect(scope.setExtras).toHaveBeenCalledWith({ domain: 'acme.com' });
});

test('error() with an Error in `err` captures the EXCEPTION (stack), not a lumped message', () => {
  const scope = { setLevel: jest.fn(), setExtras: jest.fn(), setContext: jest.fn() };
  mockWithScope.mockImplementationOnce((cb) => cb(scope));
  const boom = new Error('export blew up');
  log.error('sheets export failed', { err: boom, error: boom.message });
  expect(mockCaptureException).toHaveBeenCalledWith(boom);   // real exception + stack
  expect(mockCapture).not.toHaveBeenCalled();                // not the message fallback
  expect(scope.setContext).toHaveBeenCalledWith('log', { message: 'sheets export failed' });
  // `err` (the Error object) is stripped from both the console line and the extras.
  const entry = JSON.parse(errorSpy.mock.calls[0][0]);
  expect(entry.err).toBeUndefined();
  expect(entry.error).toBe('export blew up'); // the readable string is kept
  expect(scope.setExtras.mock.calls[0][0].err).toBeUndefined();
});

test('error() falls back to captureMessage when `err` is not an Error', () => {
  const scope = { setLevel: jest.fn(), setExtras: jest.fn(), setContext: jest.fn() };
  mockWithScope.mockImplementationOnce((cb) => cb(scope));
  log.error('plain', { err: 'just a string', code: 1 });
  expect(mockCapture).toHaveBeenCalledWith('plain');
  expect(mockCaptureException).not.toHaveBeenCalled();
});

test('error() scrubs email + ip from Sentry extras but keeps them raw in the console line', () => {
  const scope = { setLevel: jest.fn(), setExtras: jest.fn() };
  mockWithScope.mockImplementationOnce((cb) => cb(scope));
  log.error('leak-check', { email: 'alex@acme.com', ip: '203.0.113.7', domain: 'acme.com', count: 3 });

  // Sentry (third party) gets hashed PII, never raw.
  const extras = scope.setExtras.mock.calls[0][0];
  expect(extras.email).toMatch(/^sha256:/);
  expect(extras.email).not.toContain('alex@acme.com');
  expect(extras.ip).toMatch(/^sha256:/);
  expect(extras.ip).not.toContain('203.0.113.7');
  expect(extras.domain).toBe('acme.com'); // non-PII preserved
  expect(extras.count).toBe(3);           // numbers untouched

  // First-party Cloud Logging keeps the raw values for debugging.
  const entry = JSON.parse(errorSpy.mock.calls[0][0]);
  expect(entry.email).toBe('alex@acme.com');
  expect(entry.ip).toBe('203.0.113.7');
});

test('error() redacts an inline email inside a message string (e.g. err.message)', () => {
  const scope = { setLevel: jest.fn(), setExtras: jest.fn() };
  mockWithScope.mockImplementationOnce((cb) => cb(scope));
  log.error('boom', { error: 'failed to email bob@corp.com about it' });
  const extras = scope.setExtras.mock.calls[0][0];
  expect(extras.error).not.toContain('bob@corp.com');
  expect(extras.error).toMatch(/failed to email sha256:[0-9a-f]{12} about it/);
});
