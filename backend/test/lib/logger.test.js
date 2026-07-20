// The logger emits one JSON line per call and forwards ERROR-level entries to
// Sentry. Mock Sentry so we can assert the forward without a real DSN.

const mockWithScope = jest.fn((cb) => cb({ setLevel: jest.fn(), setExtras: jest.fn() }));
const mockCapture = jest.fn();
jest.mock('@sentry/node', () => ({ withScope: mockWithScope, captureMessage: mockCapture }));

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
  const scope = { setLevel: jest.fn(), setExtras: jest.fn() };
  mockWithScope.mockImplementationOnce((cb) => cb(scope));
  log.error('with-extras', { domain: 'acme.com' });
  expect(scope.setExtras).toHaveBeenCalledWith({ domain: 'acme.com' });
});
