const requestId = require('../../src/middleware/requestId');
const Sentry = require('@sentry/node');

describe('requestId middleware', () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {} };
    res = { setHeader: jest.fn() };
    next = jest.fn();
  });

  test('uses existing x-request-id header when present', () => {
    req.headers['x-request-id'] = 'custom-request-123';
    requestId(req, res, next);
    expect(req.id).toBe('custom-request-123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'custom-request-123');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('generates a UUID when x-request-id header is missing', () => {
    requestId(req, res, next);
    expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('tags Sentry isolation scope with request_id', () => {
    const setTagSpy = jest.fn();
    const getIsolationScopeSpy = jest.spyOn(Sentry, 'getIsolationScope').mockReturnValue({
      setTag: setTagSpy,
    });

    req.headers['x-request-id'] = 'req-trace-999';
    requestId(req, res, next);

    expect(setTagSpy).toHaveBeenCalledWith('request_id', 'req-trace-999');
    expect(next).toHaveBeenCalledTimes(1);
    getIsolationScopeSpy.mockRestore();
  });

  test('does not throw when Sentry getIsolationScope returns null or object without setTag', () => {
    const getIsolationScopeSpy = jest.spyOn(Sentry, 'getIsolationScope').mockReturnValue(null);

    req.headers['x-request-id'] = 'req-trace-null-scope';
    expect(() => requestId(req, res, next)).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);

    getIsolationScopeSpy.mockReturnValue({});
    expect(() => requestId(req, res, next)).not.toThrow();
    expect(next).toHaveBeenCalledTimes(2);

    getIsolationScopeSpy.mockRestore();
  });

  test('does not throw when Sentry getIsolationScope throws an error', () => {
    const getIsolationScopeSpy = jest.spyOn(Sentry, 'getIsolationScope').mockImplementation(() => {
      throw new Error('Sentry internal error');
    });

    req.headers['x-request-id'] = 'req-trace-throw';
    expect(() => requestId(req, res, next)).not.toThrow();
    expect(next).toHaveBeenCalledTimes(1);

    getIsolationScopeSpy.mockRestore();
  });
});
