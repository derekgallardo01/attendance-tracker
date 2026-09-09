// Error-path + batch-chunking tests for the PII-deletion cascade. The happy
// path is covered via the oauth delete-account integration test; here we mock
// _core to force the failure branches (a batch commit that rejects, and a
// query that rejects mid-cascade) which fail-safe rather than throw.

jest.mock('../../src/services/firestore/_core', () => ({
  getDb: jest.fn(),
  tenantRef: jest.fn(),
  FieldValue: { serverTimestamp: () => 'TS' },
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const _core = require('../../src/services/firestore/_core');
const { deleteUser, deleteRefsInBatches, isUserDeleted } = require('../../src/services/firestore/deletion');

// Minimal in-memory tenant fake: enough surface for the cascade (keyed docs,
// field queries, meetings scan) plus the tombstone write/read.
function makeFakeTenant() {
  const stores = {}; // collection -> { docId: data }
  const queried = []; // which collections got a where(email==) query
  const tenant = {
    collection: (name) => ({
      doc: (id) => ({
        set: async (data) => { (stores[name] ||= {})[id] = data; },
        get: async () => ({ exists: !!stores[name]?.[id], data: () => stores[name]?.[id] }),
      }),
      where: () => ({ get: async () => { queried.push(name); return { docs: [], size: 0 }; } }),
      get: async () => ({ docs: [] }), // meetings scan
    }),
  };
  return { tenant, stores, queried };
}

afterEach(() => jest.clearAllMocks());

describe('deleteRefsInBatches', () => {
  test('returns 0 for an empty list and defaults ctx (no ctx arg)', async () => {
    _core.getDb.mockReturnValue({ batch: () => ({ delete() {}, commit: jest.fn() }) });
    await expect(deleteRefsInBatches([])).resolves.toEqual({ deleted: 0, failedChunks: 0 });
  });

  test('counts deleted refs across chunks on success', async () => {
    const commit = jest.fn().mockResolvedValue({});
    _core.getDb.mockReturnValue({ batch: () => ({ delete() {}, commit }) });
    await expect(deleteRefsInBatches([{}, {}, {}], { domain: 'acme.com' })).resolves.toEqual({ deleted: 3, failedChunks: 0 });
  });

  test('logs a warning and reports the failed chunk when a commit fails', async () => {
    _core.getDb.mockReturnValue({ batch: () => ({ delete() {}, commit: jest.fn().mockRejectedValue(new Error('batch boom')) }) });
    await expect(deleteRefsInBatches([{}, {}], { domain: 'acme.com' })).resolves.toEqual({ deleted: 0, failedChunks: 1 });
    expect(_core.log.warn).toHaveBeenCalledWith('firestore: batch delete failed', expect.objectContaining({ domain: 'acme.com' }));
  });
});

describe('deleteUser', () => {
  test('writes a hashed tombstone FIRST and purges seriesAlertsSent; isUserDeleted flips true', async () => {
    const { tenant, stores, queried } = makeFakeTenant();
    _core.tenantRef.mockReturnValue(tenant);
    _core.getDb.mockReturnValue({
      collection: (name) => ({ where: () => ({ get: async () => ({ docs: [], size: 0 }) }) }),
      batch: () => ({ delete() {}, commit: jest.fn().mockResolvedValue({}) }),
    });
    await expect(isUserDeleted('acme.com', 'User@Acme.com')).resolves.toBe(false);
    const res = await deleteUser('acme.com', 'User@Acme.com');
    expect(res.ok).toBe(true);
    // Tombstone exists, keyed by a hash (no PII in the id or the doc).
    const tombstones = Object.keys(stores.deletedUsers || {});
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(stores.deletedUsers[tombstones[0]]).toEqual({ deletedAt: 'TS' });
    // seriesAlertsSent joined the purge (it was the missed collection).
    expect(queried).toContain('seriesAlertsSent');
    // And the tombstone is readable back through the same email (any casing).
    await expect(isUserDeleted('acme.com', 'user@acme.com')).resolves.toBe(true);
  });

  test('logs an error (does not throw) when a cascade query rejects', async () => {
    // keyed doc refs are fine, but the field-query Promise.all rejects → catch.
    const rejecting = { collection: () => rejecting, doc: () => ({}), where: () => rejecting, get: () => Promise.reject(new Error('query boom')) };
    _core.tenantRef.mockReturnValue(rejecting);
    _core.getDb.mockReturnValue(rejecting); // shareLinks/feedback top-level queries also go through getDb()
    await expect(deleteUser('acme.com', 'User@Acme.com')).resolves.toMatchObject({ ok: false });
    expect(_core.log.error).toHaveBeenCalledWith(
      'firestore: deleteUser failed',
      expect.objectContaining({ domain: 'acme.com', email: 'user@acme.com' }),
    );
  });
});
