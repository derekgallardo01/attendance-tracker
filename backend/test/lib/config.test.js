// config.js validates required env vars AT MODULE LOAD (calling process.exit on
// a missing one) and applies defaults for optional ones. Both behaviours only
// run during require(), so each test resets the module registry and re-requires
// under a tweaked environment.

describe('config module load', () => {
  const saved = {};
  const KEYS = ['SESSION_SECRET', 'ALLOWED_DOMAINS'];
  beforeEach(() => { KEYS.forEach((k) => { saved[k] = process.env[k]; }); jest.resetModules(); });
  afterEach(() => {
    KEYS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; });
  });

  test('required() prints FATAL and exits(1) when a required var is missing', () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => { throw new Error('EXIT'); });
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    delete process.env.SESSION_SECRET;
    expect(() => require('../../src/config')).toThrow('EXIT');
    expect(err).toHaveBeenCalledWith(expect.stringContaining('SESSION_SECRET'));
    expect(exit).toHaveBeenCalledWith(1);
    exit.mockRestore(); err.mockRestore();
  });

  test('defaults ALLOWED_DOMAINS to "*" when unset', () => {
    delete process.env.ALLOWED_DOMAINS;
    const CONFIG = require('../../src/config');
    expect(CONFIG.allowedDomains).toEqual(['*']);
  });

  test('splits a comma-separated ALLOWED_DOMAINS', () => {
    process.env.ALLOWED_DOMAINS = 'acme.com,globex.com';
    const CONFIG = require('../../src/config');
    expect(CONFIG.allowedDomains).toEqual(['acme.com', 'globex.com']);
  });
});
