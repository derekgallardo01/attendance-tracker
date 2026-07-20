/**
 * @jest-environment jsdom
 *
 * Tests for the shared frontend API glue in js/api.js. The interesting parts
 * (signIn's Google popup, authedFetch's network call) depend on browser
 * globals we don't fully stub here, so this focuses on the module contract:
 * the constants the app pages depend on, and that authedFetch attaches the
 * bearer + resolves paths against BACKEND_URL.
 *
 * Loads from the root js/ directory, NOT backend/public/js/ (the synced copy).
 */

const path = require('path');
const api = require(path.join(__dirname, '..', '..', '..', 'js', 'api.js'));

describe('AttApi module contract', () => {
  test('exposes the backend URL, client id, and identity scopes', () => {
    expect(api.BACKEND_URL).toMatch(/^https:\/\/.*\/api$/);
    expect(api.CLIENT_ID).toMatch(/\.apps\.googleusercontent\.com$/);
    expect(api.SCOPES).toBe('openid email profile');
  });

  test('signIn and authedFetch are functions', () => {
    expect(typeof api.signIn).toBe('function');
    expect(typeof api.authedFetch).toBe('function');
  });
});

describe('authedFetch', () => {
  afterEach(() => { delete global.fetch; });

  test('attaches the bearer token and resolves the path against BACKEND_URL', () => {
    const calls = [];
    global.fetch = (url, opts) => { calls.push([url, opts]); return Promise.resolve({ ok: true }); };

    api.authedFetch('tok-123', '/history');

    expect(calls).toHaveLength(1);
    const [url, opts] = calls[0];
    expect(url).toBe(`${api.BACKEND_URL}/history`);
    expect(opts.headers.Authorization).toBe('Bearer tok-123');
  });

  test('preserves caller-supplied method and headers', () => {
    const calls = [];
    global.fetch = (url, opts) => { calls.push([url, opts]); return Promise.resolve({ ok: true }); };

    api.authedFetch('tok', '/event', { method: 'POST', headers: { 'Content-Type': 'application/json' } });

    const [, opts] = calls[0];
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });
});

describe('signIn (Google popup + code exchange)', () => {
  let lastOpts;
  function stubGoogle(response) {
    lastOpts = null;
    global.google = { accounts: { oauth2: { initCodeClient: (opts) => { lastOpts = opts; return { requestCode: () => opts.callback(response) }; } } } };
  }
  afterEach(() => { delete global.google; delete global.fetch; });

  test('initializes the code client with the client id + scopes and requests a code', () => {
    stubGoogle({ error: 'popup_closed' }); // benign — user closed popup
    const onStart = jest.fn(), onSuccess = jest.fn(), onError = jest.fn();
    api.signIn({ onStart, onSuccess, onError });
    expect(lastOpts.client_id).toBe(api.CLIENT_ID);
    expect(lastOpts.scope).toBe(api.SCOPES);
    expect(lastOpts.ux_mode).toBe('popup');
    // popup closed/denied → no callbacks fire
    expect(onStart).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test('on success: onStart fires, code is exchanged, onSuccess gets the data', async () => {
    const data = { sessionToken: 'jwt', email: 'u@acme.com' };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => data });
    stubGoogle({ code: 'auth-code' });
    const onStart = jest.fn(), onSuccess = jest.fn(), onError = jest.fn();
    api.signIn({ onStart, onSuccess, onError });
    await new Promise((r) => setTimeout(r, 0));
    expect(onStart).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(`${api.BACKEND_URL}/oauth/exchange`, expect.objectContaining({ method: 'POST' }));
    expect(onSuccess).toHaveBeenCalledWith(data);
    expect(onError).not.toHaveBeenCalled();
  });

  test('on a non-ok exchange: onError fires', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false });
    stubGoogle({ code: 'auth-code' });
    const onError = jest.fn();
    api.signIn({ onSuccess: jest.fn(), onError });
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalled();
  });

  test('on a fetch rejection: onError fires', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network'));
    stubGoogle({ code: 'auth-code' });
    const onError = jest.fn();
    api.signIn({ onError });
    await new Promise((r) => setTimeout(r, 0));
    expect(onError).toHaveBeenCalled();
  });

  test('tolerates being called with no callbacks (all optional)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    stubGoogle({ code: 'auth-code' });
    expect(() => api.signIn()).not.toThrow(); // default {} args
    await new Promise((r) => setTimeout(r, 0));
  });
});
