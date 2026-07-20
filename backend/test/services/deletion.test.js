// Error-path + batch-chunking tests for the PII-deletion cascade. The happy
// path is covered via the oauth delete-account integration test; here we mock
// _core to force the failure branches (a batch commit that rejects, and a
// query that rejects mid-cascade) which fail-safe rather than throw.

jest.mock('../../src/services/firestore/_core', () => ({
  getDb: jest.fn(),
  tenantRef: jest.fn(),
  FieldValue: {},
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const _core = require('../../src/services/firestore/_core');
const { deleteUser, deleteRefsInBatches } = require('../../src/services/firestore/deletion');

afterEach(() => jest.clearAllMocks());

describe('deleteRefsInBatches', () => {
  test('returns 0 for an empty list and defaults ctx (no ctx arg)', async () => {
    _core.getDb.mockReturnValue({ batch: () => ({ delete() {}, commit: jest.fn() }) });
    await expect(deleteRefsInBatches([])).resolves.toBe(0);
  });

  test('counts deleted refs across chunks on success', async () => {
    const commit = jest.fn().mockResolvedValue({});
    _core.getDb.mockReturnValue({ batch: () => ({ delete() {}, commit }) });
    await expect(deleteRefsInBatches([{}, {}, {}], { domain: 'acme.com' })).resolves.toBe(3);
  });

  test('logs a warning and keeps going when a chunk commit fails', async () => {
    _core.getDb.mockReturnValue({ batch: () => ({ delete() {}, commit: jest.fn().mockRejectedValue(new Error('batch boom')) }) });
    await expect(deleteRefsInBatches([{}, {}], { domain: 'acme.com' })).resolves.toBe(0);
    expect(_core.log.warn).toHaveBeenCalledWith('firestore: batch delete failed', expect.objectContaining({ domain: 'acme.com' }));
  });
});

describe('deleteUser', () => {
  test('logs an error (does not throw) when a cascade query rejects', async () => {
    // keyed doc refs are fine, but the field-query Promise.all rejects → catch.
    _core.tenantRef.mockReturnValue({
      collection: () => ({
        doc: () => ({}),
        where: () => ({ get: () => Promise.reject(new Error('query boom')) }),
        get: () => Promise.reject(new Error('query boom')),
      }),
    });
    await expect(deleteUser('acme.com', 'User@Acme.com')).resolves.toBeUndefined();
    expect(_core.log.error).toHaveBeenCalledWith(
      'firestore: deleteUser failed',
      expect.objectContaining({ domain: 'acme.com', email: 'user@acme.com' }),
    );
  });
});
