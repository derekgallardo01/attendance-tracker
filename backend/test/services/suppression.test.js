// Unit tests for the email-suppression surface. These exercise both the happy
// paths and the fail-safe catch branches (Firestore errors), so we mock _core's
// getDb with a stub whose ops we can make resolve or reject per test. The design
// contract: writes fail closed (return false) and reads fail OPEN (return false
// = "not suppressed") so a Firestore hiccup never silently drops legit mail.

jest.mock('../../src/services/firestore/_core', () => ({
  getDb: jest.fn(),
  FieldValue: { serverTimestamp: () => 'TS' },
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const _core = require('../../src/services/firestore/_core');
const { suppressEmail, isEmailSuppressed, unsuppressEmail } = require('../../src/services/firestore/suppression');

// Build a db stub whose doc-level op (set/get/delete) resolves or rejects.
function stubDb({ set, get, del } = {}) {
  const doc = {
    set: set || jest.fn().mockResolvedValue({}),
    get: get || jest.fn().mockResolvedValue({ exists: false }),
    delete: del || jest.fn().mockResolvedValue({}),
  };
  _core.getDb.mockReturnValue({ collection: () => ({ doc: () => doc }) });
  return doc;
}

afterEach(() => jest.clearAllMocks());

describe('suppressEmail', () => {
  test('writes the record (lowercased) and returns true', async () => {
    const doc = stubDb();
    await expect(suppressEmail('User@Acme.com', { source: 'settings_toggle' })).resolves.toBe(true);
    expect(doc.set).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'user@acme.com', source: 'settings_toggle' }),
      { merge: true },
    );
  });

  test('defaults source to null when no meta is supplied', async () => {
    const doc = stubDb();
    await expect(suppressEmail('user@acme.com')).resolves.toBe(true);
    expect(doc.set).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'user@acme.com' }),
      { merge: true },
    );
    expect(_core.log.info).toHaveBeenCalledWith(
      'firestore: email suppressed',
      expect.objectContaining({ source: null }),
    );
  });

  test('returns false and logs error when the write fails', async () => {
    stubDb({ set: jest.fn().mockRejectedValue(new Error('boom')) });
    await expect(suppressEmail('user@acme.com')).resolves.toBe(false);
    expect(_core.log.error).toHaveBeenCalled();
  });
});

describe('isEmailSuppressed', () => {
  test('returns true when the doc exists', async () => {
    stubDb({ get: jest.fn().mockResolvedValue({ exists: true }) });
    await expect(isEmailSuppressed('user@acme.com')).resolves.toBe(true);
  });

  test('returns false when the doc does not exist', async () => {
    stubDb({ get: jest.fn().mockResolvedValue({ exists: false }) });
    await expect(isEmailSuppressed('user@acme.com')).resolves.toBe(false);
  });

  test('fails OPEN (returns false) and warns when the read errors', async () => {
    stubDb({ get: jest.fn().mockRejectedValue(new Error('boom')) });
    await expect(isEmailSuppressed('user@acme.com')).resolves.toBe(false);
    expect(_core.log.warn).toHaveBeenCalled();
  });
});

describe('unsuppressEmail', () => {
  test('deletes the record and returns true', async () => {
    const doc = stubDb();
    await expect(unsuppressEmail('User@Acme.com')).resolves.toBe(true);
    expect(doc.delete).toHaveBeenCalled();
  });

  test('returns false and warns when the delete fails', async () => {
    stubDb({ del: jest.fn().mockRejectedValue(new Error('boom')) });
    await expect(unsuppressEmail('user@acme.com')).resolves.toBe(false);
    expect(_core.log.warn).toHaveBeenCalled();
  });
});
